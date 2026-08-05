import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StretchRoutines.module.css';
import {
  buildCueSequence, routineDurationSec, normalizeRoutine, emptyRoutine, newId, mmss, sideLabel,
  DEFAULT_HOLD_SEC, DEFAULT_TRANSITION_SEC, DEFAULT_SWITCH_SEC, MIN_SEC, MAX_SEC,
} from '../utils/stretchRoutine';
import {
  formatStretchDuration, clampGoalMin, STRETCH_GOAL_WINDOW_DAYS, MIN_GOAL_MIN, MAX_GOAL_MIN,
} from '../utils/stretchGoal';

// ── Cue tones ─────────────────────────────────────────────────────────────
// Synthesised through Web Audio rather than shipped as files: no asset to
// load, no autoplay-blocked <audio> element, and it matches the two tones the
// mobile player uses (a single 880Hz ping to start, a 660→495Hz fall to move).
// The AudioContext is created lazily on the first user gesture — browsers
// suspend one constructed before that.
function useCueTones() {
  const ctxRef = useRef(null);

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  // One decaying note. `at` is an offset in seconds from now, so a two-note
  // cue schedules both up front instead of relying on a timer.
  const note = useCallback((ctx, freq, at, durSec, gain) => {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + at;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008); // fast attack
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durSec + 0.02);
  }, []);

  const play = useCallback((which) => {
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      if (which === 'start') {
        note(ctx, 880, 0, 0.30, 0.34);
      } else {
        note(ctx, 660, 0, 0.16, 0.28);
        note(ctx, 495, 0.19, 0.30, 0.30);
      }
    } catch { /* a missed cue tone shouldn't break the routine */ }
  }, [ensureCtx, note]);

  // Unlock on the first gesture so the very first ping isn't swallowed.
  const unlock = useCallback(() => { ensureCtx(); }, [ensureCtx]);

  useEffect(() => () => { ctxRef.current?.close?.().catch(() => {}); }, []);
  return { play, unlock };
}

function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  // Cancel anything still being spoken so a short routine can't build a
  // backlog of pose names running behind the timer.
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0;
  u.pitch = 1.0;
  synth.speak(u);
}
function stopSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* not supported */ }
}

// ── Player ────────────────────────────────────────────────────────────────
/**
 * Timing is WALL-CLOCK, not tick counting: each cue records the timestamp it
 * should end at and a 100ms interval compares against Date.now(), carrying any
 * overshoot into the next cue. Browsers throttle timers hard in a background
 * tab, so a decrementing counter would let a 40-second hold quietly run long.
 */
function Player({ routine, onClose, onLog }) {
  const cues = useMemo(() => buildCueSequence(routine), [routine]);
  const [cueIdx, setCueIdx] = useState(0);
  const [remaining, setRemaining] = useState(cues[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  // Result of the automatic log, shown on the completion screen: '' until the
  // routine ends, then 'Logging…' and finally what was written (which workout,
  // and any habit it marked).
  const [logMsg, setLogMsg] = useState('');
  const endAtRef = useRef(null);
  const announcedRef = useRef(-1);
  const wakeRef = useRef(null);
  const { play, unlock } = useCueTones();

  // Keep the screen on while running, where supported. Progressive enhancement:
  // a browser without the API just behaves as before.
  useEffect(() => {
    if (!running || done) return;
    let released = false;
    navigator.wakeLock?.request('screen')
      .then(l => { if (released) l.release().catch(() => {}); else wakeRef.current = l; })
      .catch(() => {});
    return () => {
      released = true;
      wakeRef.current?.release?.().catch(() => {});
      wakeRef.current = null;
    };
  }, [running, done]);

  // Announce on ENTERING a cue, never on a re-render.
  useEffect(() => {
    if (!running || done) return;
    if (announcedRef.current === cueIdx) return;
    announcedRef.current = cueIdx;
    const cue = cues[cueIdx];
    if (!cue) return;
    // The side is spoken every time on a two-sided pose, never inferred from
    // "you must be on the second one by now" — eyes are shut and the whole
    // point of the cue is that you don't have to keep count.
    const side = sideLabel(cue.side).toLowerCase();
    // Tone first, words second — the order you want when your eyes are shut.
    if (cue.kind === 'hold') {
      play('start');
      const t = setTimeout(() => speak(side ? `${cue.stepName}, ${side} side` : cue.stepName), 320);
      return () => clearTimeout(t);
    }
    play('transition');
    const words = cue.kind === 'switch'
      ? `Switch sides. ${cue.stepName}, ${side} side`
      : side ? `Next, ${cue.stepName}, ${side} side first` : `Next, ${cue.stepName}`;
    const t = setTimeout(() => speak(words), 420);
    return () => clearTimeout(t);
  }, [cueIdx, running, done, cues, play]);

  useEffect(() => {
    if (!running || done) return;
    if (endAtRef.current == null) endAtRef.current = Date.now() + remaining * 1000;
    const id = setInterval(() => {
      const endAt = endAtRef.current;
      if (endAt == null) return;
      const left = (endAt - Date.now()) / 1000;
      if (left > 0) { setRemaining(left); return; }
      const overshoot = -left;
      const next = cueIdx + 1;
      if (next >= cues.length) {
        endAtRef.current = null;
        setRemaining(0);
        setRunning(false);
        setDone(true);
        stopSpeech();
        setTimeout(() => speak('Routine complete. Nice work.'), 250);
        return;
      }
      const secs = Math.max(0, cues[next].seconds - overshoot);
      endAtRef.current = Date.now() + secs * 1000;
      setRemaining(secs);
      setCueIdx(next);
    }, 100);
    return () => clearInterval(id);
  }, [running, done, cueIdx, cues, remaining]);

  const toggle = useCallback(() => {
    unlock(); // first gesture — lets the AudioContext start
    setRunning(r => {
      if (r) {
        if (endAtRef.current != null) setRemaining(Math.max(0, (endAtRef.current - Date.now()) / 1000));
        endAtRef.current = null;
        stopSpeech();
        return false;
      }
      endAtRef.current = Date.now() + remaining * 1000;
      return true;
    });
  }, [remaining, unlock]);

  const jump = useCallback((delta) => {
    const next = cueIdx + delta;
    if (next < 0 || next >= cues.length) return;
    announcedRef.current = -1; // re-announce whatever we land on
    setCueIdx(next);
    setRemaining(cues[next].seconds);
    endAtRef.current = running ? Date.now() + cues[next].seconds * 1000 : null;
    setDone(false);
  }, [cueIdx, cues, running]);

  const close = useCallback(() => { stopSpeech(); onClose(); }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') jump(1);
      else if (e.key === 'ArrowLeft') jump(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, toggle, jump]);

  useEffect(() => () => stopSpeech(), []);

  const cue = cues[cueIdx];
  const isHold = cue?.kind === 'hold';
  const totalLeft = cues.slice(cueIdx + 1).reduce((n, c) => n + c.seconds, 0) + remaining;
  const pct = cue ? Math.min(100, Math.max(0, (1 - remaining / cue.seconds) * 100)) : 0;
  const reached = useMemo(() => {
    const names = [];
    const upto = done ? cues.length : cueIdx + 1;
    for (let i = 0; i < upto; i++) {
      const c = cues[i];
      if (c.kind === 'hold' && !names.includes(c.stepName)) names.push(c.stepName);
    }
    return names;
  }, [cues, cueIdx, done]);

  // Finishing the routine IS the log. Waiting for a button press meant a run
  // you'd actually done vanished if you closed the player — the work was over
  // and the only thing missing was a click. The ref makes it fire exactly once
  // even though `jump` can clear `done` and let you re-cross the finish line.
  const loggedRef = useRef(false);
  useEffect(() => {
    if (!done || loggedRef.current) return;
    loggedRef.current = true;
    setLogMsg('Logging…');
    Promise.resolve(onLog(routine, reached))
      .then(msg => setLogMsg(msg || 'Logged.'))
      .catch(err => {
        console.error('[stretch] auto-log failed', err);
        setLogMsg('Couldn’t log this one — add it from the workout log.');
      });
  }, [done, onLog, routine, reached]);

  return (
    <div className={styles.playerOverlay} onMouseDown={close}>
      <div className={styles.player} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.playerHead}>
          <span className={styles.playerName}>{routine.name}</span>
          <span className={styles.playerCount}>
            {Math.min((cue?.stepIndex ?? 0) + 1, routine.steps.length)}/{routine.steps.length}
          </span>
          <button className={styles.playerClose} onClick={close} aria-label="Close">✕</button>
        </div>

        {done ? (
          <div className={styles.playerBody}>
            <div className={styles.doneMark}>✓</div>
            <div className={styles.doneTitle}>Routine complete</div>
            <div className={styles.doneSub}>{reached.length} pose{reached.length === 1 ? '' : 's'}</div>
            <div className={styles.logMsg}>{logMsg}</div>
            <button className={styles.primaryBtn} onClick={close}>Done</button>
          </div>
        ) : (
          <div className={styles.playerBody}>
            <div className={styles.phase}>
              {isHold ? 'HOLD' : cue?.kind === 'switch' ? 'SWITCH SIDES' : 'TRANSITION'}
              {/* The side sits in the phase line, not the pose name, so a glance
                  at the big word tells you which limb without reading further. */}
              {!!sideLabel(cue?.side) && (
                <span className={styles.sideTag}>{sideLabel(cue?.side).toUpperCase()}</span>
              )}
            </div>
            <div className={styles.poseName}>{isHold ? cue?.stepName : `Next: ${cue?.stepName}`}</div>
            <div className={`${styles.clock} ${isHold ? '' : styles.clockTransition}`}>{mmss(remaining)}</div>
            <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${pct}%` }} /></div>
            <div className={styles.totalLeft}>{mmss(totalLeft)} left</div>
            <div className={styles.controls}>
              <button className={styles.ctrlBtn} onClick={() => jump(-1)} disabled={cueIdx === 0} aria-label="Previous">⏮</button>
              <button className={styles.playBtn} onClick={toggle} aria-label={running ? 'Pause' : 'Play'}>{running ? '❚❚' : '▶'}</button>
              <button className={styles.ctrlBtn} onClick={() => jump(1)} disabled={cueIdx >= cues.length - 1} aria-label="Next">⏭</button>
            </div>
            <div className={styles.hint}>{running ? 'Space to pause · ← → to skip' : 'Press play — space also works'}</div>
          </div>
        )}

        {!done && (
          <ol className={styles.upNext}>
            {routine.steps.map((s, i) => (
              <li
                key={s.id}
                className={`${styles.upNextItem} ${i === cue?.stepIndex ? styles.upNextActive : ''} ${i < (cue?.stepIndex ?? 0) ? styles.upNextDone : ''}`}
              >
                {s.name}
                {s.bothSides && <span className={styles.upNextSides}>L/R</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// A step with one of its hold overrides removed. The key has to be absent, not
// empty: normalizeRoutine treats any non-null holdSec as an override.
function dropHold(step, key = 'holdSec') {
  const next = { ...step };
  delete next[key];
  return next;
}

// ── Tab ───────────────────────────────────────────────────────────────────
export function StretchRoutines({
  routines, onChange, stretchOptions, onLogRoutine, goalRows, goalEntries = {},
  goalMin, onGoalMinChange,
  workoutTypes = [], habits = [], defaultWorkoutType = 'Yoga',
}) {
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [addQuery, setAddQuery] = useState('');
  // Which region's breakdown is open (the popup behind a clicked number).
  const [goalDetail, setGoalDetail] = useState(null);

  const save = useCallback(() => {
    const name = editing.name.trim();
    if (!name) { alert('Give the routine a name so you can find it later.'); return; }
    if (editing.steps.length === 0) { alert('A routine needs at least one pose.'); return; }
    const next = normalizeRoutine({ ...editing, name, updatedAt: new Date().toISOString() });
    const idx = routines.findIndex(r => r.id === next.id);
    onChange(idx >= 0 ? routines.map((r, i) => (i === idx ? next : r)) : [...routines, next]);
    setEditing(null);
  }, [editing, routines, onChange]);

  const remove = useCallback((r) => {
    if (!window.confirm(`Delete "${r.name}"? This can't be undone.`)) return;
    onChange(routines.filter(x => x.id !== r.id));
  }, [routines, onChange]);

  const addStep = useCallback((name) => {
    const n = String(name || '').trim();
    if (!n) return;
    setEditing(e => ({ ...e, steps: [...e.steps, { id: newId(), name: n }] }));
    setAddQuery('');
  }, []);

  // Per-pose hold override. An empty box means "use the routine default", so
  // clearing it DELETES the key rather than storing '' — normalizeRoutine treats
  // any non-null holdSec as an override and would clamp '' up to DEFAULT_HOLD_SEC.
  // `key` is 'holdSec' (the left side, or the only one) or 'holdSecRight'.
  const setStepHold = useCallback((idx, raw, key = 'holdSec') => {
    setEditing(e => ({
      ...e,
      steps: e.steps.map((s, i) => {
        if (i !== idx) return s;
        const v = String(raw).trim();
        if (!v) return dropHold(s, key);
        return { ...s, [key]: v };
      }),
    }));
  }, []);

  const clampStepHold = useCallback((idx, key = 'holdSec') => {
    setEditing(e => ({
      ...e,
      steps: e.steps.map((s, i) => {
        if (i !== idx || s[key] == null) return s;
        const n = Number(s[key]);
        if (!isFinite(n) || n <= 0) return dropHold(s, key);
        return { ...s, [key]: Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(n))) };
      }),
    }));
  }, []);

  // Turn a pose into a left-and-right one, or back. Switching it off drops the
  // right-side time rather than parking it: leaving a stale number behind means
  // turning sides back on silently resurrects a time you set months ago.
  const toggleStepSides = useCallback((idx) => {
    setEditing(e => ({
      ...e,
      steps: e.steps.map((s, i) => {
        if (i !== idx) return s;
        if (s.bothSides) return dropHold(dropHold(s, 'bothSides'), 'holdSecRight');
        return { ...s, bothSides: true };
      }),
    }));
  }, []);

  const moveStep = useCallback((idx, delta) => {
    setEditing(e => {
      const steps = [...e.steps];
      const to = idx + delta;
      if (to < 0 || to >= steps.length) return e;
      [steps[idx], steps[to]] = [steps[to], steps[idx]];
      return { ...e, steps };
    });
  }, []);

  // Name of a linked habit, or '' if it's unset or has since been deleted —
  // a stale link shouldn't render a blank chip.
  const habitName = useCallback((habitId) => {
    if (!habitId) return '';
    return habits.find(h => h.id === habitId)?.name || '';
  }, [habits]);

  const suggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return [];
    return stretchOptions.filter(o => o.toLowerCase().includes(q)).slice(0, 8);
  }, [addQuery, stretchOptions]);

  if (editing) {
    return (
      <div className={styles.wrap}>
        <div className={styles.headRow}>
          <button className={styles.ghostBtn} onClick={() => setEditing(null)}>← Back</button>
          <h3 className={styles.h3}>{routines.some(r => r.id === editing.id) ? 'Edit routine' : 'New routine'}</h3>
          <button className={styles.primaryBtn} onClick={save}>Save</button>
        </div>

        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          value={editing.name}
          onChange={e => setEditing({ ...editing, name: e.target.value })}
          placeholder="Morning mobility"
        />

        <div className={styles.secRow}>
          <div>
            <label className={styles.label}>Hold each</label>
            {/* The routine-wide default. Any pose can pin its own time below. */}
            <input
              className={styles.numInput} type="number" min={MIN_SEC} max={MAX_SEC}
              value={editing.holdSec}
              onChange={e => setEditing({ ...editing, holdSec: e.target.value })}
              onBlur={e => setEditing(v => ({ ...v, holdSec: Math.min(MAX_SEC, Math.max(MIN_SEC, Number(e.target.value) || DEFAULT_HOLD_SEC)) }))}
            /> <span className={styles.unit}>sec</span>
          </div>
          <div>
            <label className={styles.label}>Transition</label>
            <input
              className={styles.numInput} type="number" min={MIN_SEC} max={MAX_SEC}
              value={editing.transitionSec}
              onChange={e => setEditing({ ...editing, transitionSec: e.target.value })}
              onBlur={e => setEditing(v => ({ ...v, transitionSec: Math.min(MAX_SEC, Math.max(MIN_SEC, Number(e.target.value) || DEFAULT_TRANSITION_SEC)) }))}
            /> <span className={styles.unit}>sec</span>
          </div>
          {/* Only shown once a pose actually has two sides — until then it's a
              knob that does nothing, and the row is crowded enough. */}
          {editing.steps.some(s => s.bothSides) && (
            <div>
              <label className={styles.label}>Switch sides</label>
              <input
                className={styles.numInput} type="number" min={MIN_SEC} max={MAX_SEC}
                value={editing.switchSec ?? DEFAULT_SWITCH_SEC}
                onChange={e => setEditing({ ...editing, switchSec: e.target.value })}
                onBlur={e => setEditing(v => ({ ...v, switchSec: Math.min(MAX_SEC, Math.max(MIN_SEC, Number(e.target.value) || DEFAULT_SWITCH_SEC)) }))}
                title="How long you get to swap legs or arms between the two sides of a pose."
              /> <span className={styles.unit}>sec</span>
            </div>
          )}
          <div className={styles.totalBadge}>
            {mmss(routineDurationSec(normalizeRoutine(editing) || editing))} total
          </div>
        </div>

        {/* Where a finished run of this routine lands. Both are per routine
            because a yoga flow and a five-minute desk-stretch aren't the same
            workout, and only one of them is the habit you're tracking. */}
        <div className={styles.linkRow}>
          <div className={styles.linkField}>
            <label className={styles.label}>Logs to</label>
            <select
              className={styles.select}
              value={editing.workoutType || ''}
              onChange={e => setEditing({ ...editing, workoutType: e.target.value })}
            >
              <option value="">{defaultWorkoutType} (default)</option>
              {workoutTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.linkField}>
            <label className={styles.label}>Marks habit</label>
            <select
              className={styles.select}
              value={editing.habitId || ''}
              onChange={e => setEditing({ ...editing, habitId: e.target.value })}
              disabled={habits.length === 0}
            >
              <option value="">None</option>
              {habits.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        </div>

        <label className={styles.label}>Poses ({editing.steps.length})</label>
        {editing.steps.length === 0 ? (
          <div className={styles.empty}>No poses yet — add your first below.</div>
        ) : (
          <div className={styles.poseHint}>
            Each pose holds for {editing.holdSec}s unless you give it its own time.
            Hit <strong>L/R</strong> for a pose you do on both sides — it gets held twice,
            with its own time for each side.
          </div>
        )}
        <ol className={styles.stepList}>
          {editing.steps.map((s, i) => (
            <li key={s.id} className={styles.stepRow}>
              <span className={styles.stepNum}>{i + 1}</span>
              <span className={styles.stepName}>{s.name}</span>
              {/* Two-sided poses get two boxes, one per side, because the point
                  of doing both sides is usually that they aren't equal. */}
              <button
                type="button"
                className={`${styles.sideToggle} ${s.bothSides ? styles.sideToggleOn : ''}`}
                onClick={() => toggleStepSides(i)}
                aria-pressed={!!s.bothSides}
                title={s.bothSides
                  ? `${s.name} is held on both sides. Click to make it one hold.`
                  : `Hold ${s.name} on the left and then the right, with its own time for each.`}
              >L/R</button>
              {/* Blank = inherit the routine's "Hold each". A pinned pose is
                  tinted so you can see at a glance which ones you've overridden. */}
              <input
                className={`${styles.stepHoldInput} ${s.holdSec != null ? styles.stepHoldSet : ''}`}
                type="number"
                min={MIN_SEC}
                max={MAX_SEC}
                value={s.holdSec ?? ''}
                placeholder={String(editing.holdSec)}
                onChange={e => setStepHold(i, e.target.value)}
                onBlur={() => clampStepHold(i)}
                aria-label={s.bothSides ? `Left-side hold time for ${s.name}` : `Hold time for ${s.name}`}
                title={s.bothSides
                  ? `How long to hold the LEFT side of ${s.name}. Blank uses the routine's ${editing.holdSec}s.`
                  : `How long to hold ${s.name}. Leave blank to use the routine's ${editing.holdSec}s.`}
              />
              {s.bothSides && (
                <>
                  <span className={styles.stepUnit}>s L</span>
                  {/* Placeholder is the LEFT time, not the routine default —
                      that's what an empty right box actually inherits. */}
                  <input
                    className={`${styles.stepHoldInput} ${s.holdSecRight != null ? styles.stepHoldSet : ''}`}
                    type="number"
                    min={MIN_SEC}
                    max={MAX_SEC}
                    value={s.holdSecRight ?? ''}
                    placeholder={String(s.holdSec ?? editing.holdSec)}
                    onChange={e => setStepHold(i, e.target.value, 'holdSecRight')}
                    onBlur={() => clampStepHold(i, 'holdSecRight')}
                    aria-label={`Right-side hold time for ${s.name}`}
                    title={`How long to hold the RIGHT side of ${s.name}. Blank matches the left side.`}
                  />
                  <span className={styles.stepUnit}>s R</span>
                </>
              )}
              {!s.bothSides && <span className={styles.stepUnit}>s</span>}
              <button className={styles.iconBtn} onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className={styles.iconBtn} onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1} aria-label="Move down">↓</button>
              <button className={styles.iconBtn} onClick={() => setEditing(e => ({ ...e, steps: e.steps.filter(x => x.id !== s.id) }))} aria-label="Remove">✕</button>
            </li>
          ))}
        </ol>

        <div className={styles.addRow}>
          <input
            className={styles.input}
            list="stretch-options"
            value={addQuery}
            onChange={e => setAddQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStep(addQuery); } }}
            placeholder="Search your stretches, or type a new pose"
          />
          <datalist id="stretch-options">
            {stretchOptions.map(o => <option key={o} value={o} />)}
          </datalist>
          <button className={styles.primaryBtn} onClick={() => addStep(addQuery)} disabled={!addQuery.trim()}>Add</button>
        </div>
        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map(o => (
              <button key={o} className={styles.suggestion} onClick={() => addStep(o)}>{o}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {/* Goal board. Time held per muscle group over a rolling window, which is
          the unit stretching is actually dosed in. Always the same seven regions
          in body order, so a neglected one shows as an empty bar rather than
          quietly dropping off the board. */}
      <div className={styles.goalCard}>
        <div className={styles.goalHead}>
          <span className={styles.goalTitle}>Last {STRETCH_GOAL_WINDOW_DAYS} days</span>
          <span className={styles.goalEdit}>
            <input
              type="number"
              className={styles.goalInput}
              min={MIN_GOAL_MIN}
              max={MAX_GOAL_MIN}
              value={goalMin}
              onChange={e => onGoalMinChange(e.target.value)}
              onBlur={e => onGoalMinChange(clampGoalMin(e.target.value))}
              aria-label="Stretch goal in minutes per muscle group"
            />
            <span className={styles.unit}>min / muscle group</span>
          </span>
        </div>
        {(!goalRows || goalRows.length === 0) ? (
          <div className={styles.empty}>
            Tag some exercises as “Stretching” and log a routine — each of the seven main
            muscle groups shows its progress toward {goalMin} minutes here.
          </div>
        ) : (
          <>
          {goalRows.every(r => r.seconds === 0) && (
            <div className={styles.empty}>
              Nothing held yet this week — tag exercises as “Stretching” and log a routine
              to fill these in.
            </div>
          )}
          <div className={styles.goalRows}>
            {goalRows.map(r => (
              <div key={r.group} className={styles.goalRow}>
                <span className={styles.goalGroup}>{r.group}</span>
                <span className={styles.goalTrack}>
                  <span
                    className={`${styles.goalFill} ${r.met ? styles.goalFillMet : ''}`}
                    style={{ width: `${r.pct * 100}%` }}
                  />
                </span>
                {/* The number is a button: a total is only trustworthy if you
                    can see what went into it — and a 0 is worth explaining too. */}
                <button
                  type="button"
                  className={`${styles.goalTime} ${styles.goalTimeBtn} ${r.met ? styles.goalTimeMet : ''}`}
                  onClick={() => setGoalDetail(r.group)}
                  title={`What makes up ${r.group}?`}
                >
                  {r.met ? '✓ ' : ''}{formatStretchDuration(r.seconds)}
                </button>
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      <div className={styles.headRow}>
        <h3 className={styles.h3}>Stretch routines</h3>
        <button className={styles.primaryBtn} onClick={() => setEditing(emptyRoutine())}>+ New routine</button>
      </div>

      {routines.length === 0 && (
        <div className={styles.empty}>
          No routines yet. Build one from your stretches — the player holds each pose for {DEFAULT_HOLD_SEC}s
          and gives you {DEFAULT_TRANSITION_SEC}s to move between them, calling each pose out loud.
          Routines sync with the phone, so one built here plays there too.
        </div>
      )}

      <div className={styles.cards}>
        {routines.map(r => (
          <div key={r.id} className={styles.card}>
            <button className={styles.cardMain} onClick={() => setEditing(r)}>
              <div className={styles.cardName}>{r.name}</div>
              <div className={styles.cardMeta}>
                {r.steps.length} pose{r.steps.length === 1 ? '' : 's'}
                {(() => {
                  const sided = r.steps.filter(s => s.bothSides).length;
                  return sided > 0 ? ` (${sided} both sides)` : '';
                })()} · {mmss(routineDurationSec(r))} · {(() => {
                  // "40s hold" is a lie once poses carry their own times, so say
                  // how many are pinned instead of quoting the default alone.
                  const pinned = r.steps.filter(s => s.holdSec != null).length;
                  if (pinned === 0) return `${r.holdSec}s hold`;
                  if (pinned === r.steps.length) return 'per-pose holds';
                  return `${r.holdSec}s hold · ${pinned} custom`;
                })()} / {r.transitionSec}s move
              </div>
              {/* Where it lands, visible without opening the routine — the
                  whole point of asking is not having to guess afterwards. */}
              <div className={styles.cardLinks}>
                <span className={styles.chip}>Logs to {r.workoutType || defaultWorkoutType}</span>
                {habitName(r.habitId) && (
                  <span className={styles.chip}>Marks {habitName(r.habitId)}</span>
                )}
              </div>
            </button>
            <button
              className={styles.playCardBtn}
              onClick={() => setPlaying(r)}
              disabled={r.steps.length === 0}
              aria-label={`Play ${r.name}`}
            >▶</button>
            <button className={styles.iconBtn} onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>🗑</button>
          </div>
        ))}
      </div>

      {playing && (
        <Player
          routine={playing}
          onClose={() => setPlaying(null)}
          // Does NOT close the player: the routine logs itself the moment it
          // ends, and the completion screen is where the result is reported.
          onLog={(r, poses) => onLogRoutine(r, poses)}
        />
      )}

      {/* Breakdown of one region: every stretch that fed its number, newest
          first. Opened by clicking the time on the goal board. */}
      {goalDetail && (() => {
        const entries = goalEntries[goalDetail] || [];
        const total = entries.reduce((n, e) => n + e.seconds, 0);
        const close = () => setGoalDetail(null);
        return (
          <div className={styles.detailOverlay} onClick={close} role="presentation">
            <div className={styles.detailCard} onClick={e => e.stopPropagation()}>
              <div className={styles.detailHead}>
                <div>
                  <div className={styles.detailTitle}>{goalDetail}</div>
                  <div className={styles.detailSub}>
                    {formatStretchDuration(total)} over the last {STRETCH_GOAL_WINDOW_DAYS} days
                    {entries.length > 0 && ` · ${entries.length} stretch${entries.length === 1 ? '' : 'es'}`}
                  </div>
                </div>
                <button className={styles.detailClose} onClick={close} type="button" aria-label="Close">&times;</button>
              </div>
              {entries.length === 0 ? (
                <div className={styles.empty}>
                  Nothing counted toward {goalDetail} this week. Time comes from stretches
                  logged with a <strong>duration</strong> (“40s”) — a stretch logged with plain
                  rep counts has no time in it to count, and an exercise not tagged
                  “Stretching” doesn’t count at all.
                </div>
              ) : (
                <ul className={styles.detailList}>
                  {entries.map((e, i) => (
                    <li key={`${e.date}-${e.exercise}-${i}`} className={styles.detailItem}>
                      <span className={styles.detailName}>{e.exercise}</span>
                      <span className={styles.detailMeta}>
                        {e.group ? `${e.group} · ` : ''}{e.date}
                      </span>
                      <span className={styles.detailSecs}>{formatStretchDuration(e.seconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

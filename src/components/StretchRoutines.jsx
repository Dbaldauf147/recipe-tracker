import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StretchRoutines.module.css';
import {
  buildCueSequence, routineDurationSec, normalizeRoutine, emptyRoutine, newId, mmss,
  DEFAULT_HOLD_SEC, DEFAULT_TRANSITION_SEC, MIN_SEC, MAX_SEC,
} from '../utils/stretchRoutine';

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
    // Tone first, words second — the order you want when your eyes are shut.
    if (cue.kind === 'hold') {
      play('start');
      const t = setTimeout(() => speak(cue.stepName), 320);
      return () => clearTimeout(t);
    }
    play('transition');
    const t = setTimeout(() => speak(`Next, ${cue.stepName}`), 420);
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
            <button className={styles.primaryBtn} onClick={() => onLog(routine, reached)}>Log this as a workout</button>
            <button className={styles.ghostBtn} onClick={close}>Done</button>
          </div>
        ) : (
          <div className={styles.playerBody}>
            <div className={styles.phase}>{isHold ? 'HOLD' : 'TRANSITION'}</div>
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
              >{s.name}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────
export function StretchRoutines({ routines, onChange, stretchOptions, onLogRoutine }) {
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [addQuery, setAddQuery] = useState('');

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

  const moveStep = useCallback((idx, delta) => {
    setEditing(e => {
      const steps = [...e.steps];
      const to = idx + delta;
      if (to < 0 || to >= steps.length) return e;
      [steps[idx], steps[to]] = [steps[to], steps[idx]];
      return { ...e, steps };
    });
  }, []);

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
          <div className={styles.totalBadge}>
            {mmss(routineDurationSec(normalizeRoutine(editing) || editing))} total
          </div>
        </div>

        <label className={styles.label}>Poses ({editing.steps.length})</label>
        {editing.steps.length === 0 && <div className={styles.empty}>No poses yet — add your first below.</div>}
        <ol className={styles.stepList}>
          {editing.steps.map((s, i) => (
            <li key={s.id} className={styles.stepRow}>
              <span className={styles.stepNum}>{i + 1}</span>
              <span className={styles.stepName}>{s.name}</span>
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
                {r.steps.length} pose{r.steps.length === 1 ? '' : 's'} · {mmss(routineDurationSec(r))} · {r.holdSec}s hold / {r.transitionSec}s move
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
          onLog={(r, poses) => { setPlaying(null); onLogRoutine(r, poses); }}
        />
      )}
    </div>
  );
}

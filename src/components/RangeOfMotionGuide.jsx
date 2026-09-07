// "Range of motion" — the reference half of the Stretch page.
//
// The goal board above it tracks a DOSE (minutes held per region). This tracks
// a CAPACITY: how far the joint actually moves, measured occasionally against a
// target and a floor. Two different questions, so two different cards.
//
// The whole card is one interaction: each test draws its own hinge, shades the
// band you are trying to land in, and lets you drag the limb to where yours
// actually stops. That is the reason there are no photographs here — a photo
// shows one angle, and the angle is the thing being asked about. See RomDial.
//
// Measurements save to `romMeasurements` on the user doc on release, with a
// per-day history, so the number is comparable to the one you took last month
// rather than a value you have to remember.
import { useMemo, useState } from 'react';
import styles from './RangeOfMotionGuide.module.css';
import { RomDial } from './RomDial';
import {
  ROM_TESTS, romRegions, romTestsInRegion, romSidesFor, romSideLabel,
  classifyRom, romRangeLabel, ROM_STATUS_META, romDialRange,
} from '../utils/rangeOfMotion';
import {
  romLatest, romEntry, romPrevious, romCoverage, romDayLabel,
} from '../utils/romMeasurements';

/** The last dozen readings, as a shape rather than a table. */
function Sparkline({ history, test }) {
  const pts = history.slice(-12);
  if (pts.length < 2) return null;
  const W = 120; const H = 30;
  const lo = Math.min(test.min, ...pts.map(p => p.value));
  const hi = Math.max(test.target, ...pts.map(p => p.value));
  const span = hi - lo || 1;
  const x = i => (i / (pts.length - 1)) * W;
  const y = v => H - ((v - lo) / span) * H;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className={styles.spark} viewBox={`0 -3 ${W} ${H + 6}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={0} y1={y(test.target)} x2={W} y2={y(test.target)} className={styles.sparkTarget} />
      <line x1={0} y1={y(test.min)} x2={W} y2={y(test.min)} className={styles.sparkMin} />
      <path d={path} className={styles.sparkLine} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].value)} r={2.5} className={styles.sparkDot} />
    </svg>
  );
}

function RomCard({ test, store, onSave, onClear, disabled }) {
  const sides = romSidesFor(test);
  const [side, setSide] = useState(sides[0]);
  // What the dial is showing right now. Null means "whatever is stored" — the
  // drag writes here on every pointer move and the release writes it through.
  const [draft, setDraft] = useState(null);

  const stored = romLatest(store, test.id, side);
  const shown = draft === null ? stored : draft;
  const status = classifyRom(shown, test);
  const meta = status ? ROM_STATUS_META[status] : null;
  const entry = romEntry(store, test.id, side);
  const prev = romPrevious(store, test.id, side);
  const delta = prev && stored !== null ? stored - prev.value : null;
  const { max } = romDialRange(test);

  const pickSide = (s) => { setSide(s); setDraft(null); };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <div className={styles.muscle}>{test.muscle}</div>
          <div className={styles.test}>{test.test}</div>
        </div>
        <div className={styles.band} title="Floor to target">{romRangeLabel(test)}</div>
      </div>

      {sides.length > 1 && (
        <div className={styles.sides} role="tablist" aria-label="Which side">
          {sides.map(s => {
            const v = romLatest(store, test.id, s);
            const st = classifyRom(v, test);
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === side}
                className={`${styles.sideBtn} ${s === side ? styles.sideBtnOn : ''}`}
                onClick={() => pickSide(s)}
              >
                {romSideLabel(s)}
                <span className={styles.sideVal} style={st ? { color: ROM_STATUS_META[st].color } : undefined}>
                  {v === null ? '—' : `${v}°`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <RomDial
        test={test}
        value={shown}
        disabled={disabled}
        onChange={setDraft}
        onCommit={(v) => { setDraft(v); onSave(test.id, side, v); }}
      />

      <div className={styles.measureRow}>
        <span className={styles.measureVal} style={meta ? { color: meta.color } : undefined}>
          {shown === null ? '—' : `${shown}°`}
        </span>
        {meta && (
          <span
            className={styles.status}
            style={{ color: meta.color, borderColor: `${meta.color}66`, background: `${meta.color}14` }}
          >
            {meta.label}
          </span>
        )}
        {/* A number box next to the dial, because a goniometer app or a
            protractor gives you an exact figure the dial can only approach. */}
        <label className={styles.exactLabel} htmlFor={`rom-${test.id}-${side}`}>Exact</label>
        <input
          id={`rom-${test.id}-${side}`}
          className={styles.exactInput}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={shown === null ? '' : shown}
          disabled={disabled}
          placeholder="—"
          // Typed digits move the dial as you go but only commit on the way
          // out: half a number ("6" on the way to "60") is not a measurement.
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') { setDraft(null); return; }
            const n = Math.round(Number(raw));
            if (!Number.isFinite(n)) return;
            setDraft(Math.min(max, Math.max(0, n)));
          }}
          onBlur={() => { if (draft !== null && draft !== stored) onSave(test.id, side, draft); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        {stored !== null && (
          <button type="button" className={styles.clearBtn} onClick={() => { setDraft(null); onClear(test.id, side); }}>
            Clear
          </button>
        )}
      </div>

      {entry && (
        <div className={styles.history}>
          <span className={styles.historyText}>
            Measured {romDayLabel(entry.at) || 'earlier'}
            {delta !== null && (
              <span className={delta >= 0 ? styles.deltaUp : styles.deltaDown}>
                {' '}{delta >= 0 ? '+' : ''}{delta}° since {romDayLabel(prev.at)}
              </span>
            )}
          </span>
          <Sparkline history={entry.history} test={test} />
        </div>
      )}

      {(test.startText || test.endText) && (
        <dl className={styles.steps}>
          {test.startText && (<><dt className={styles.stepLabel}>Start</dt><dd className={styles.stepText}>{test.startText}</dd></>)}
          {test.endText && (<><dt className={styles.stepLabel}>End</dt><dd className={styles.stepText}>{test.endText}</dd></>)}
        </dl>
      )}

      {Array.isArray(test.tips) && test.tips.length > 0 && (
        <ul className={styles.tips}>
          {test.tips.map(t => <li key={t}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

export function RangeOfMotionGuide({ measurements, onSave, onClear, loading }) {
  const [open, setOpen] = useState(false);
  const regions = useMemo(() => romRegions(), []);
  const [region, setRegion] = useState(regions[0]);
  // Memoised so the empty fallback isn't a fresh object every render, which
  // would re-run the coverage tallies below on each one.
  const store = useMemo(() => measurements || { entries: {} }, [measurements]);

  const overall = useMemo(
    () => romCoverage(ROM_TESTS, store, romSidesFor),
    [store],
  );
  const perRegion = useMemo(() => {
    const out = {};
    for (const r of regions) out[r] = romCoverage(romTestsInRegion(r), store, romSidesFor);
    return out;
  }, [regions, store]);

  if (ROM_TESTS.length === 0) return null;
  const tests = romTestsInRegion(region);

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={styles.title}>Range of motion</span>
        <span className={styles.count}>
          {overall.measured
            ? `${overall.atTarget}/${overall.measured} at target`
            : `${ROM_TESTS.length} tests`}
        </span>
        <span className={styles.chev}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          <p className={styles.intro}>
            Drag the limb to where yours actually stops. The shaded arc is the range you are
            aiming for — the red end is the floor, the green tick is the target. Saved when
            you let go, so next month&apos;s number has something to beat.
          </p>

          <div className={styles.summary}>
            <span className={styles.summaryMain}>
              {overall.measured} of {overall.slots} measured
            </span>
            {overall.measured > 0 && (
              <>
                <span className={styles.dot}>·</span>
                <span style={{ color: ROM_STATUS_META.target.color }}>{overall.atTarget} at target</span>
                {overall.below > 0 && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span style={{ color: ROM_STATUS_META.below.color }}>{overall.below} below the floor</span>
                  </>
                )}
              </>
            )}
          </div>

          <div className={styles.regions} role="tablist" aria-label="Body region">
            {regions.map(r => {
              const c = perRegion[r];
              return (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={r === region}
                  className={`${styles.regionBtn} ${r === region ? styles.regionBtnOn : ''}`}
                  onClick={() => setRegion(r)}
                >
                  {r}
                  <span className={styles.regionCount}>{c.measured}/{c.slots}</span>
                </button>
              );
            })}
          </div>

          {loading && <div className={styles.loading}>Loading your measurements…</div>}

          <div className={styles.cards}>
            {tests.map(t => (
              <RomCard
                key={t.id}
                test={t}
                store={store}
                onSave={onSave}
                onClear={onClear}
                disabled={loading}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The PR celebration: fireworks + "Congratulations!", shown when a completed
// row beats your best estimated 1RM for that exercise.
//
// Deliberately NOT a dialog. There is nothing to click, nothing to dismiss, and
// it never takes focus — you are mid-workout with a bar in your hands, and an
// interruption you have to clear is worse than no celebration at all. It sits
// under `pointer-events: none` so clicks land on whatever is beneath it, and it
// takes itself away after HOLD_MS.
//
// Under prefers-reduced-motion the fireworks don't animate: the banner still
// appears and still leaves on its own, so the information isn't lost — only the
// motion is.
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './PrCelebration.module.css';

const HOLD_MS = 3600;   // long enough to read, short enough not to be in the way
const FADE_MS = 400;    // matches the CSS transition

/** Deterministic-ish spark layout: a few bursts, each a ring of sparks. */
function useBursts(seed) {
  return useMemo(() => {
    const bursts = [];
    // Three bursts, spread across the upper half so they frame the banner
    // rather than covering it.
    const spots = [{ x: 22, y: 34 }, { x: 50, y: 22 }, { x: 78, y: 38 }];
    const hues = [45, 12, 200]; // gold, ember, sky — celebratory without confetti-clutter
    spots.forEach((spot, b) => {
      const sparks = [];
      const count = 14;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + b * 0.4;
        const dist = 60 + ((i * 37 + b * 11 + seed) % 45);
        sparks.push({
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          delay: b * 260 + (i % 3) * 60,
        });
      }
      bursts.push({ ...spot, hue: hues[b], sparks });
    });
    return bursts;
  }, [seed]);
}

export function PrCelebration({ record, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const timers = useRef([]);
  // A new PR while one is still on screen restarts the animation rather than
  // stacking a second copy.
  const key = record ? `${record.exercise}:${record.e1rmLb}` : '';
  const bursts = useBursts(key.length);

  useEffect(() => {
    if (!record) return undefined;
    setLeaving(false);
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setLeaving(true), HOLD_MS),
      setTimeout(() => onDone?.(), HOLD_MS + FADE_MS),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, [key, record, onDone]);

  if (!record) return null;

  return (
    <div
      className={`${styles.wrap}${leaving ? ` ${styles.leaving}` : ''}`}
      // Announced once, politely — a screen reader gets the achievement without
      // the focus being stolen mid-workout.
      role="status"
      aria-live="polite"
    >
      {bursts.map((b, i) => (
        <div key={i} className={styles.burst} style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          {b.sparks.map((s, j) => (
            <span
              key={j}
              className={styles.spark}
              style={{
                '--dx': `${s.dx}px`,
                '--dy': `${s.dy}px`,
                '--delay': `${s.delay}ms`,
                '--hue': b.hue,
              }}
            />
          ))}
        </div>
      ))}
      <div className={styles.banner}>
        <div className={styles.title}>Congratulations!</div>
        <div className={styles.line}>
          New 1-rep max on <strong>{record.exercise}</strong>
        </div>
        <div className={styles.stat}>
          {Math.round(record.e1rmLb)} {record.unit || 'lb'}
          <span className={styles.gain}>+{Math.round(record.gainLb)} {record.unit || 'lb'}</span>
        </div>
      </div>
    </div>
  );
}

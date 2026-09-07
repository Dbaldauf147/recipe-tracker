// The goniometer: drag the limb, read the angle.
//
// Everything on screen is derived from one test's `diagram` (see
// utils/rangeOfMotion.js) — a pivot, a fixed reference arm marking zero, and a
// moving arm. The band between the floor and the target is drawn as a shaded
// arc BEHIND the arm, so "what should it be" and "what is it" are the same
// picture rather than a picture plus a number underneath it.
//
// Drag maths lives in romValueFromPoint, not here: converting a pointer to an
// angle and clamping it to the dial's arc is the part worth testing, and it
// needs no DOM.
import { useCallback, useRef, useState } from 'react';
import styles from './RomDial.module.css';
import {
  ROM_VIEW, romPoint, romArmPoint, romScreenAngle, romValueFromPoint,
  romDialRange, classifyRom, ROM_STATUS_META,
} from '../utils/rangeOfMotion';

const NEUTRAL = '#94a3b8';

/** SVG arc path between two screen angles, sweeping the short way round. */
function arcPath(pivot, r, fromDeg, toDeg) {
  const [x1, y1] = romPoint(pivot, r, fromDeg);
  const [x2, y2] = romPoint(pivot, r, toDeg);
  const delta = toDeg - fromDeg;
  const large = Math.abs(delta) > 180 ? 1 : 0;
  // Screen y is flipped, so a counter-clockwise sweep in our angle convention
  // is sweep-flag 0 in SVG's.
  const sweep = delta > 0 ? 0 : 1;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function Scene({ scene }) {
  return (
    <g className={styles.scene}>
      {(scene || []).map((s, i) => {
        if (s.k === 'circle') {
          return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} className={styles.body} />;
        }
        if (s.k === 'floor') {
          return (
            <g key={i}>
              <line x1={s.x1} y1={s.y} x2={s.x2} y2={s.y} className={styles.ground} />
              {Array.from({ length: Math.floor((s.x2 - s.x1) / 14) }, (_, n) => {
                const x = s.x1 + 7 + n * 14;
                return <line key={n} x1={x} y1={s.y} x2={x - 6} y2={s.y + 6} className={styles.hatch} />;
              })}
            </g>
          );
        }
        if (s.k === 'wall') {
          return (
            <g key={i}>
              <line x1={s.x} y1={s.y1} x2={s.x} y2={s.y2} className={styles.ground} />
              {Array.from({ length: Math.floor((s.y2 - s.y1) / 14) }, (_, n) => {
                const y = s.y1 + 7 + n * 14;
                return <line key={n} x1={s.x} y1={y} x2={s.x + 6} y2={y - 6} className={styles.hatch} />;
              })}
            </g>
          );
        }
        return (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            strokeWidth={s.w} className={styles.body} />
        );
      })}
    </g>
  );
}

/**
 * @param {object}   test      a ROM_TESTS entry
 * @param {number?}  value     the measurement, or null when never measured
 * @param {Function} onChange  fired continuously while dragging
 * @param {Function} onCommit  fired once, on release — this is what saves
 */
export function RomDial({ test, value, onChange, onCommit, disabled }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const d = test.diagram;
  const { max } = romDialRange(test);

  // An unmeasured dial parks the arm at the FLOOR, not at zero: zero is a
  // legitimate reading on several of these tests, so resting there would look
  // like a catastrophic result you had actually recorded. The arm is drawn
  // hollow until it carries a real number.
  const shown = value === null || value === undefined ? test.min : value;
  const status = classifyRom(value, test);
  const color = status ? ROM_STATUS_META[status].color : NEUTRAL;

  const bandR = Math.round(d.arm * 0.78);
  const arm = romArmPoint(test, shown);
  const armDeg = romScreenAngle(test, shown);

  const pointToValue = useCallback((ev) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    // The viewBox is letterboxed by preserveAspectRatio="xMidYMid meet", so the
    // scale is the smaller of the two and the leftover is split evenly.
    const scale = Math.min(r.width / ROM_VIEW.w, r.height / ROM_VIEW.h);
    const x = (ev.clientX - r.left - (r.width - ROM_VIEW.w * scale) / 2) / scale;
    const y = (ev.clientY - r.top - (r.height - ROM_VIEW.h * scale) / 2) / scale;
    return romValueFromPoint(test, x, y);
  }, [test]);

  const onPointerDown = useCallback((ev) => {
    if (disabled) return;
    ev.preventDefault();
    const v = pointToValue(ev);
    if (v === null) return;
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    setDragging(true);
    onChange?.(v);
  }, [disabled, pointToValue, onChange]);

  const onPointerMove = useCallback((ev) => {
    if (!dragging) return;
    const v = pointToValue(ev);
    if (v !== null) onChange?.(v);
  }, [dragging, pointToValue, onChange]);

  const endDrag = useCallback((ev) => {
    if (!dragging) return;
    setDragging(false);
    ev.currentTarget.releasePointerCapture?.(ev.pointerId);
    const v = pointToValue(ev);
    onCommit?.(v === null ? shown : v);
  }, [dragging, pointToValue, onCommit, shown]);

  // Arrow keys nudge, so this is usable without a pointer — and a degree is a
  // fiddly thing to hit by hand even with one.
  const onKeyDown = useCallback((ev) => {
    if (disabled) return;
    const step = ev.shiftKey ? 5 : 1;
    let next = null;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') next = shown + step;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') next = shown - step;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = max;
    else if (ev.key === 'PageUp') next = shown + 10;
    else if (ev.key === 'PageDown') next = shown - 10;
    if (next === null) return;
    ev.preventDefault();
    next = Math.min(max, Math.max(0, next));
    onChange?.(next);
    onCommit?.(next);
  }, [disabled, shown, max, onChange, onCommit]);

  // The floor's label sits INSIDE the band and the target's outside. On a test
  // where they are close together (130° and 145° for the elbow) two labels on
  // the same radius overlap into an unreadable smudge.
  const tick = (v, cls, label, labelR) => {
    const [ix, iy] = romPoint(d.pivot, bandR - 7, romScreenAngle(test, v));
    const [ox, oy] = romPoint(d.pivot, bandR + 7, romScreenAngle(test, v));
    const [lx, ly] = romPoint(d.pivot, labelR, romScreenAngle(test, v));
    return (
      <g>
        <line x1={ix} y1={iy} x2={ox} y2={oy} className={cls} />
        <text x={lx} y={ly} className={styles.tickLabel} dominantBaseline="middle" textAnchor="middle">{label}</text>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={`${styles.svg} ${dragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''}`}
      viewBox={`0 0 ${ROM_VIEW.w} ${ROM_VIEW.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${test.muscle} — ${test.test}, in degrees`}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null || value === undefined
        ? 'not measured yet'
        : `${value} degrees, ${status ? ROM_STATUS_META[status].label.toLowerCase() : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <Scene scene={d.scene} />

      {/* Below the floor — drawn first so the good band paints over its edge. */}
      <path d={arcPath(d.pivot, bandR, romScreenAngle(test, 0), romScreenAngle(test, test.min))}
        className={styles.bandBelow} />
      {/* The band you are aiming to land in, floor → target. */}
      <path d={arcPath(d.pivot, bandR, romScreenAngle(test, test.min), romScreenAngle(test, test.target))}
        className={styles.bandGood} />
      {/* Past target is still fine — shown lighter so it doesn't read as a wall. */}
      {max > test.target && (
        <path d={arcPath(d.pivot, bandR, romScreenAngle(test, test.target), romScreenAngle(test, max))}
          className={styles.bandOver} />
      )}

      {tick(test.min, styles.tickMin, `${test.min}°`, bandR - 17)}
      {tick(test.target, styles.tickTarget, `${test.target}°`, bandR + 19)}

      {/* Where zero is measured from. Dashed, because it does not move. */}
      {d.ref && (() => {
        const [rx, ry] = romPoint(d.pivot, d.ref.len, d.ref.angle);
        const [lx, ly] = romPoint(d.pivot, d.ref.len + 12, d.ref.angle);
        return (
          <g>
            <line x1={d.pivot[0]} y1={d.pivot[1]} x2={rx} y2={ry} className={styles.refArm} />
            {d.refLabel && (
              <text x={lx} y={ly} className={styles.refLabel} dominantBaseline="middle" textAnchor="middle">
                {d.refLabel}
              </text>
            )}
          </g>
        );
      })()}

      {/* The limb you drag. */}
      <line
        x1={d.pivot[0]} y1={d.pivot[1]} x2={arm[0]} y2={arm[1]}
        stroke={color}
        className={`${styles.movingArm} ${value === null || value === undefined ? styles.movingArmUnset : ''}`}
      />
      <circle cx={d.pivot[0]} cy={d.pivot[1]} r={5} fill={color} className={styles.hinge} />
      <circle cx={arm[0]} cy={arm[1]} r={11} fill={color} className={styles.handle} />
      <circle cx={arm[0]} cy={arm[1]} r={4} className={styles.handleDot} />

      {/* The live number, held just outside the handle so the arm never covers it. */}
      {(() => {
        const [tx, ty] = romPoint(d.pivot, d.arm + 22, armDeg);
        const cx = Math.min(ROM_VIEW.w - 18, Math.max(18, tx));
        const cy = Math.min(ROM_VIEW.h - 10, Math.max(12, ty));
        return (
          <text x={cx} y={cy} className={styles.readout} fill={color}
            dominantBaseline="middle" textAnchor="middle">
            {value === null || value === undefined ? '—' : `${value}°`}
          </text>
        );
      })()}
    </svg>
  );
}

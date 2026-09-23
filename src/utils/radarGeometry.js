// Geometry for the Design a Meal goal radar.
//
// The chart is hand-drawn SVG rather than a recharts <RadarChart>, because what
// it has to show is per-GOAL: each goal owns a wedge, coloured by whether that
// goal was met. A recharts Radar is one polygon with one fill, so it can say
// "the meal" but never "this goal, green; that one, red".
//
// Everything here is pure trig on a fixed viewBox, which is also why it lives in
// its own module: the numbers are testable without a browser.

// Screen angles, in degrees, measured clockwise from twelve o'clock — so axis 0
// is straight up, where a reader expects the first goal to be.
export function axisAngle(index, count) {
  if (!count) return -90;
  return -90 + (360 / count) * index;
}

export function polarPoint(cx, cy, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The closed polygon through one point per axis, each at its own radius. Used
 * for the grid rings (every radius the same) and for the outline that ties the
 * wedges back into a single shape.
 */
export function polygonPoints(cx, cy, radii) {
  const n = radii.length;
  return radii
    .map((r, i) => {
      const p = polarPoint(cx, cy, r, axisAngle(i, n));
      return `${round(p.x)},${round(p.y)}`;
    })
    .join(' ');
}

/**
 * One goal's wedge: the share of the chart that goal owns, out to `radius`.
 *
 * Centred on the axis and not starting at it — otherwise every wedge would sit
 * a half-step clockwise of the label naming it.
 *
 * The outer edge is TWO straight segments, not a circular arc, because the
 * rings it is measured against are polygons. An arc at `radius` bulges past a
 * polygon of the same radius everywhere except on the axis itself, so a goal
 * that exactly met its target would render spilling over the target ring it is
 * supposed to touch. Two chords through the on-axis vertex instead means the
 * wedges tile the ring polygon exactly: full wedges for every goal fill the
 * target ring and not a pixel more.
 */
export function sectorPath(cx, cy, radius, index, count) {
  if (!(radius > 0) || !count) return '';
  const half = 360 / count / 2;
  const mid = axisAngle(index, count);
  // Between two axes the ring polygon's edge is closer to the centre than its
  // vertices are, by exactly cos(half).
  const edge = radius * Math.cos((half * Math.PI) / 180);
  const a = polarPoint(cx, cy, edge, mid - half);
  const peak = polarPoint(cx, cy, radius, mid);
  const b = polarPoint(cx, cy, edge, mid + half);
  return [
    `M ${round(cx)} ${round(cy)}`,
    `L ${round(a.x)} ${round(a.y)}`,
    `L ${round(peak.x)} ${round(peak.y)}`,
    `L ${round(b.x)} ${round(b.y)}`,
    'Z',
  ].join(' ');
}

/**
 * Where an axis label sits, and how to anchor it. A label directly above or
 * below the circle wants to be centred; one out to the side wants to hang off
 * its inner edge, or it overlaps the chart.
 */
export function labelAnchor(index, count, cx, cy, radius, gap = 18) {
  const angle = axisAngle(index, count);
  const p = polarPoint(cx, cy, radius + gap, angle);
  // cos near zero means the axis is vertical: straight up or straight down.
  const cos = Math.cos((angle * Math.PI) / 180);
  let textAnchor = 'middle';
  if (cos > 0.2) textAnchor = 'start';
  else if (cos < -0.2) textAnchor = 'end';
  return { x: round(p.x), y: round(p.y), textAnchor };
}

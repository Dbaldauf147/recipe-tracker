import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  axisAngle, polarPoint, polygonPoints, sectorPath, labelAnchor,
} from './radarGeometry.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} !== ${b}`);

test('the first axis points straight up', () => {
  assert.equal(axisAngle(0, 6), -90);
  const p = polarPoint(100, 100, 50, axisAngle(0, 6));
  near(p.x, 100);
  near(p.y, 50); // up is a SMALLER y in SVG
});

test('axes are evenly spaced all the way round', () => {
  const n = 8;
  const angles = Array.from({ length: n }, (_, i) => axisAngle(i, n));
  for (let i = 1; i < n; i += 1) {
    near(angles[i] - angles[i - 1], 360 / n);
  }
});

test('a point at radius zero is the centre, whatever the angle', () => {
  for (const a of [-90, 0, 37, 180]) {
    const p = polarPoint(50, 60, 0, a);
    near(p.x, 50);
    near(p.y, 60);
  }
});

test('polygonPoints emits one vertex per radius', () => {
  const pts = polygonPoints(100, 100, [50, 50, 50, 50]).split(' ');
  assert.equal(pts.length, 4);
});

test('a goal scoring zero draws no wedge at all', () => {
  // An empty path, not a zero-radius arc: a degenerate arc still renders a
  // dot of colour at the centre of the chart.
  assert.equal(sectorPath(100, 100, 0, 0, 6), '');
  assert.equal(sectorPath(100, 100, -5, 0, 6), '');
});

function wedgeNums(d) {
  // M cx cy L ax ay L px py L bx by Z
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  return { cx: n[0], cy: n[1], ax: n[2], ay: n[3], px: n[4], py: n[5], bx: n[6], by: n[7] };
}

test('a wedge is centred on its own axis, not offset from it', () => {
  // Six goals, so each wedge spans 60°: the one on the straight-up axis must
  // run from -120° to -60°, i.e. symmetrically about -90°.
  const { ax, ay, px, py, bx, by } = wedgeNums(sectorPath(0, 0, 100, 0, 6));
  near(ax, -bx, 0.05);   // mirrored across the vertical axis
  near(ay, by, 0.05);    // at the same height
  near(px, 0, 0.05);     // the peak sits ON the axis
  near(py, -100);        // at the full radius
  assert.ok(ay < 0, 'the wedge should open upward');
});

test('a full wedge reaches the ring polygon exactly, and does not bulge past it', () => {
  // The bug this guards: with a circular arc the wedge overshot the ring
  // everywhere except on its own axis, so a goal that exactly MET its target
  // drew outside the ring it was supposed to touch.
  const n = 6;
  const R = 100;
  const { ax, ay, px, py, bx, by } = wedgeNums(sectorPath(0, 0, R, 0, n));
  // The peak is a ring vertex.
  near(Math.hypot(px, py), R);
  // The two shoulders sit on the ring's EDGE, which is cos(half) in.
  const edge = R * Math.cos(Math.PI / n);
  near(Math.hypot(ax, ay), edge);
  near(Math.hypot(bx, by), edge);
  assert.ok(edge < R, 'the ring edge must be inside the ring vertices');
});

test('neighbouring wedges meet exactly, leaving no gap and no overlap', () => {
  const n = 7;
  const R = 90;
  const first = wedgeNums(sectorPath(0, 0, R, 0, n));
  const second = wedgeNums(sectorPath(0, 0, R, 1, n));
  // Wedge 0's trailing shoulder is wedge 1's leading shoulder.
  near(first.bx, second.ax, 0.05);
  near(first.by, second.ay, 0.05);
});

test('every wedge together covers the circle exactly once', () => {
  const n = 5;
  const spans = [];
  for (let i = 0; i < n; i += 1) {
    const half = 360 / n / 2;
    spans.push([axisAngle(i, n) - half, axisAngle(i, n) + half]);
  }
  for (let i = 1; i < n; i += 1) {
    near(spans[i][0], spans[i - 1][1]); // no gap, no overlap
  }
  near(spans[n - 1][1] - spans[0][0], 360);
});

test('side labels hang off the chart, top and bottom ones centre', () => {
  const n = 4; // up, right, down, left
  assert.equal(labelAnchor(0, n, 0, 0, 100).textAnchor, 'middle');
  assert.equal(labelAnchor(1, n, 0, 0, 100).textAnchor, 'start');
  assert.equal(labelAnchor(2, n, 0, 0, 100).textAnchor, 'middle');
  assert.equal(labelAnchor(3, n, 0, 0, 100).textAnchor, 'end');
});

test('labels sit outside the outer ring, never on it', () => {
  const n = 7;
  for (let i = 0; i < n; i += 1) {
    const { x, y } = labelAnchor(i, n, 200, 180, 120, 18);
    const dist = Math.hypot(x - 200, y - 180);
    assert.ok(dist > 120, `label ${i} at ${dist} is inside the ring`);
  }
});

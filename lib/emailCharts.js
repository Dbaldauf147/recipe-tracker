// Real line charts for the weekly email, drawn as SVG and sent as inline PNG
// attachments (cid: images).
//
// The email's trend charts used to be dots positioned with nested table cells —
// the only drawing every mail client honours — which meant no line between the
// dots: a table cell can't draw a diagonal. Gmail and Outlook strip inline
// <svg>, and a hosted chart service would mean sending weight and meal data to
// a third party, so the SVG is rasterised on our side (see
// api/send-weekly-summary.js) and attached to the message itself.
//
// The image carries almost no text. Axis labels and exact values stay in the
// HTML table rows under it: they stay selectable and readable with images off.
// The one exception is an optional number over each point (`labels`), which is
// drawn from glyph OUTLINES (chartGlyphs.js) rather than <text> — so it still
// needs no fonts on the server, where there may be none to find. So the image has to line up with those rows — point i
// sits at the centre of column i of an n-column, equal-width table, which is
// what `table-layout:fixed` gives the rows beneath.

/** Width the <img> is laid out at; the PNG is drawn at 2x for sharp screens. */
export const CHART_WIDTH = 688;
export const CHART_SCALE = 2;

import { GLYPHS } from './chartGlyphs.js';

const PAD_Y = 12;
// Room above the plot for a label over the topmost point.
const LABEL_PAD = 30;
const LABEL_SIZE = 13;

/**
 * `str` as filled glyph outlines, centred on x with its baseline at y. A
 * character with no outline is left as a gap rather than failing the chart.
 * The white stroke drawn first is a halo, so a label sitting on the line or the
 * goal rule stays legible.
 */
function labelSvg(str, x, y, color) {
  const k = LABEL_SIZE / 1000;
  const chars = [...String(str)];
  const total = chars.reduce((w, c) => w + (GLYPHS[c] ? GLYPHS[c].w : 300), 0) * k;
  let cx = x - total / 2;
  let d = '';
  for (const c of chars) {
    const g = GLYPHS[c];
    if (g) d += `<path transform="translate(${fmt(cx)} ${fmt(y)}) scale(${k})" d="${g.d}"/>`;
    cx += (g ? g.w : 300) * k;
  }
  if (!d) return '';
  return `<g fill="#ffffff" stroke="#ffffff" stroke-width="${fmt(3 / k)}" stroke-linejoin="round">${d}</g>`
    + `<g fill="${color}">${d}</g>`;
}

function fmt(n) {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '0';
}

/**
 * One chart as an SVG string.
 *
 * - `n`: number of columns (points per series).
 * - `series`: `[{ values, color, dotColors?, lineColor? }]` — `values[i]` is a
 *   number or null. A null breaks the line rather than dropping it to zero: a
 *   week that measured nothing is unknown, not 0.
 * - `lo`/`hi`: the y-range. `goal`: drawn as a dashed rule across the chart.
 * - `emphasizeLast`: the last point is drawn larger — it's the week the email
 *   is about.
 * - `s.labels[i]`: optional text drawn just above point i (digits and . , -).
 */
export function lineChartSvg({
  n, series = [], lo = 0, hi = 1, goal = null, height = 104, width = CHART_WIDTH, emphasizeLast = true,
}) {
  const span = hi - lo || 1;
  const hasLabels = series.some(s => Array.isArray(s.labels));
  const padTop = hasLabels ? LABEL_PAD : PAD_Y;
  const x = i => ((i + 0.5) / n) * width;
  const y = v => padTop + ((hi - v) / span) * (height - padTop - PAD_Y);
  const parts = [];

  // Baseline, so the plot has a floor to read heights against.
  parts.push(`<line x1="0" y1="${fmt(height - 0.5)}" x2="${width}" y2="${fmt(height - 0.5)}" stroke="#e5e7eb" stroke-width="1"/>`);

  if (Number.isFinite(goal)) {
    const gy = fmt(y(goal));
    parts.push(`<line x1="0" y1="${gy}" x2="${width}" y2="${gy}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 6"/>`);
  }

  for (const s of series) {
    const values = s.values || [];
    // Runs of consecutive known points, each drawn as its own polyline.
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        parts.push(`<polyline fill="none" stroke="${s.lineColor || s.color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" points="${run.join(' ')}"/>`);
      }
      run = [];
    };
    values.forEach((v, i) => {
      if (Number.isFinite(v)) run.push(`${fmt(x(i))},${fmt(y(v))}`);
      else flush();
    });
    flush();
  }

  // Dots last, so every line runs underneath them.
  for (const s of series) {
    (s.values || []).forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const last = emphasizeLast && i === n - 1;
      const fill = (s.dotColors && s.dotColors[i]) || s.color;
      parts.push(`<circle cx="${fmt(x(i))}" cy="${fmt(y(v))}" r="${last ? 8 : 6}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`);
    });
  }

  // Labels after the dots, so a neighbouring dot can't cover a number.
  for (const s of series) {
    if (!Array.isArray(s.labels)) continue;
    (s.values || []).forEach((v, i) => {
      const text = s.labels[i];
      if (!Number.isFinite(v) || text == null || text === '') return;
      const r = emphasizeLast && i === n - 1 ? 8 : 6;
      parts.push(labelSvg(text, x(i), y(v) - r - 6, '#374151'));
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    + `</svg>`;
}

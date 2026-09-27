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
// The image carries NO text. Labels and exact values stay in the HTML table
// rows under it: they stay selectable, readable with images off, and need no
// fonts on the server. So the image has to line up with those rows — point i
// sits at the centre of column i of an n-column, equal-width table, which is
// what `table-layout:fixed` gives the rows beneath.

/** Width the <img> is laid out at; the PNG is drawn at 2x for sharp screens. */
export const CHART_WIDTH = 688;
export const CHART_SCALE = 2;

const PAD_Y = 12;

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
 */
export function lineChartSvg({
  n, series = [], lo = 0, hi = 1, goal = null, height = 104, width = CHART_WIDTH, emphasizeLast = true,
}) {
  const span = hi - lo || 1;
  const x = i => ((i + 0.5) / n) * width;
  const y = v => PAD_Y + ((hi - v) / span) * (height - 2 * PAD_Y);
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    + `</svg>`;
}

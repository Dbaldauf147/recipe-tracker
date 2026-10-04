import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { lineChartSvg } from '../../lib/emailCharts.js';
import { lastCompleteWeek, previousWeek, summarizeWeek, renderWeeklySummary } from '../../lib/weeklySummary.js';

// The weekly email's trend charts as real line charts (lib/emailCharts.js),
// rasterised and attached by api/send-weekly-summary.js.

test('a null breaks the line instead of dropping it to zero', () => {
  const svg = lineChartSvg({ n: 5, lo: 0, hi: 10, series: [{ values: [1, 2, null, 4, 5], color: '#c96442' }] });
  assert.equal((svg.match(/<polyline/g) || []).length, 2, 'two runs, not one line through the gap');
  assert.equal((svg.match(/<circle/g) || []).length, 4, 'one dot per known point');
});

test('points sit at the centre of their column, so the image lines up with the table under it', () => {
  const svg = lineChartSvg({ n: 4, width: 400, lo: 0, hi: 10, series: [{ values: [5, 5, 5, 5], color: '#000' }] });
  assert.match(svg, /points="50,[\d.]+ 150,[\d.]+ 250,[\d.]+ 350,[\d.]+"/);
});

test('a goal draws a dashed rule; no goal draws none', () => {
  assert.match(lineChartSvg({ n: 2, hi: 10, goal: 5, series: [{ values: [1, 2], color: '#000' }] }), /stroke-dasharray/);
  assert.doesNotMatch(lineChartSvg({ n: 2, hi: 10, series: [{ values: [1, 2], color: '#000' }] }), /stroke-dasharray/);
});

test('with a rasteriser the email embeds cid images and returns them as attachments', () => {
  const week = lastCompleteWeek('2026-08-02');
  const weightLog = [
    { date: previousWeek(week).days[3], weight: 176.4 },
    { date: week.days[4], weight: 178.4 },
  ];
  const stats = summarizeWeek({ dailyLog: {}, weightLog, workouts: [], habits: [], habitLog: {} }, week);
  const prior = summarizeWeek({ dailyLog: {}, weightLog, workouts: [], habits: [], habitLog: {} }, previousWeek(week));
  const svgs = [];
  const email = renderWeeklySummary({
    stats, priorStats: prior, bodyStats: { goalWeight: 175 },
    rasterize: svg => { svgs.push(svg); return Buffer.from('png'); },
  });
  assert.ok(email.attachments.length >= 1);
  for (const a of email.attachments) {
    assert.equal(a.contentType, 'image/png');
    assert.ok(email.html.includes(`src="cid:${a.cid}"`), a.cid);
  }
  assert.ok(svgs.some(s => s.includes('<polyline')), 'the weight chart is a real line');
  assert.match(email.html, />178\.4</, 'exact values stay as text under the image');

  // No rasteriser (or a failing one) → the old table-cell dots, no attachments.
  const plain = renderWeeklySummary({ stats, priorStats: prior, bodyStats: { goalWeight: 175 } });
  assert.deepEqual(plain.attachments, []);
  assert.doesNotMatch(plain.html, /cid:/);
  const broken = renderWeeklySummary({ stats, priorStats: prior, rasterize: () => { throw new Error('no resvg'); } });
  assert.deepEqual(broken.attachments, []);
  assert.match(broken.html, /border-radius:50%/);
});

test('labels are drawn over their points as glyph outlines, never as <text>', () => {
  const plain = lineChartSvg({ n: 3, hi: 10, series: [{ values: [1, null, 3], color: '#000' }] });
  assert.doesNotMatch(plain, /<path/);
  const svg = lineChartSvg({ n: 3, hi: 20, series: [{ values: [1, null, 13.5], color: '#000', labels: ['1', '9', '13.5'] }] });
  assert.doesNotMatch(svg, /<text/, 'no font on the server to draw text with');
  // Halo + fill per label; "1" is one glyph, "13.5" four, and the null point none.
  assert.equal((svg.match(/<path/g) || []).length, 2 * (1 + 4));
});

test('the per-meal protein chart is a labelled line over the days, with no "this week" point', () => {
  const week = lastCompleteWeek('2026-08-02');
  const dailyLog = {
    [week.days[0]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 12 } }] },
    [week.days[4]]: { entries: [{ mealSlot: 'lunch', nutrition: { protein: 17 } }] },
  };
  const data = { dailyLog, weightLog: [], workouts: [], habits: [], habitLog: {} };
  const stats = summarizeWeek(data, week);
  const svgs = [];
  const email = renderWeeklySummary({
    stats, priorStats: stats, goals: { protein: 144 },
    rasterize: svg => { svgs.push(svg); return Buffer.from('png'); },
  });
  const protein = svgs[0];
  assert.match(protein, /<polyline|<circle/);
  assert.equal((protein.match(/<circle/g) || []).length, 2, 'one dot per day with a main meal');
  assert.doesNotMatch(protein, /r="8"/, 'Saturday is not singled out');
  assert.ok((protein.match(/<path/g) || []).length > 0, 'the averages are labelled');
  assert.match(email.html, />Sun<\/td>/);
  assert.match(email.html, />Thu<\/td>/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainScoreTerm } from './suggestScoreExplain.js';

const ones = () => 1;
const item = (b = {}, extra = {}) => ({
  recipe: { title: 'Salmon bowl' },
  seasonalMatches: [],
  breakdown: {
    lastCooked: '2026-10-01', recipeDays: 16, requeued: false,
    ingredientDetails: [], ingredientScore: 0,
    macroScore: 0, macroDetail: null, boostBonus: 0,
    seasonalRaw: 0, macroRaw: 0,
    stalenessPoints: 16, ingredientPoints: 0, seasonalBonus: 0, macroBonus: 0, totalScore: 16,
    ...b,
  },
  ...extra,
});

test('days since cooked', () => {
  const e = explainScoreTerm('staleness', item(), ones);
  assert.equal(e.lines[0], 'Last cooked Oct 1, 2026, 16 days ago.');
  assert.equal(e.formula, '16 days = 16');
  assert.equal(explainScoreTerm('staleness', item(), k => (k === 'staleness' ? 2 : 1)).formula, '16 days = 16 × 2 (weight) = 32');
  assert.match(explainScoreTerm('staleness', item({ recipeDays: 9999, lastCooked: null }), ones).lines[0], /^Never cooked/);
  assert.match(explainScoreTerm('staleness', item({ requeued: true }), ones).lines[0], /^Sent to the back of the line on Oct 1, 2026/);
});

test('key ingredients add up, never = 9999', () => {
  const e = explainScoreTerm('ingredients', item({
    ingredientScore: 10013,
    ingredientDetails: [
      { label: 'tofu', days: 9999, lastEaten: null },
      { label: 'salmon', days: 14, lastEaten: '2026-10-03' },
    ],
  }), ones);
  assert.deepEqual(e.lines.slice(0, 2), ['tofu: never eaten → 9,999 days', 'salmon: last eaten Oct 3, 2026 → 14 days']);
  assert.equal(e.formula, '9,999 + 14 = 10,013');
  assert.equal(explainScoreTerm('ingredients', item(), ones).formula, '0');
});

test('seasonal and macro', () => {
  const s = explainScoreTerm('seasonal', item({ seasonalRaw: 100 }, { seasonalMatches: ['squash', 'apple'] }), ones);
  assert.equal(s.formula, '2 × 50 = 100');
  const m = explainScoreTerm('macro', item({
    macroRaw: 166,
    macroDetail: { score: 83, meal: { protein: 30, carbs: 45, fat: 25 }, goal: { protein: 35, carbs: 40, fat: 25 } },
  }), ones);
  assert.equal(m.formula, '83 × 2 = 166');
  assert.match(m.lines[2], /^Average gap 3\.3 points → fit 83\/100/);
  assert.match(explainScoreTerm('macro', item(), ones).lines[0], /^No macro score/);
});

test('switched-off term and the total', () => {
  assert.equal(explainScoreTerm('seasonal', item(), k => (k === 'seasonal' ? 0 : 1)).formula, '0');
  const t = explainScoreTerm('total', item({ ingredientPoints: 20, seasonalBonus: 50, macroBonus: 100, totalScore: 186 }), ones);
  assert.equal(t.formula, 'Days 16 + Ingredients 20 + Season 50 + Macro 100 = 186');
});

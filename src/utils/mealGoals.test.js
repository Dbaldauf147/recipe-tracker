import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMeal, macroSplit, makeRow, totalsForRows, suggestFixes,
  niceQuantity, quantityStep, normalizeStore, profileFromDailyGoals,
  candidatesFromIngredientsDb, emptyProfile, profileHasGoals,
} from './mealGoals.js';

function row({ name, qty = 1, measurement = 'g', grams = 100, topping = false, ...nutrients }) {
  return makeRow({
    index: 0,
    ingredient: name,
    quantity: qty,
    measurement,
    topping,
    lookup: { name, grams, nutrients },
  });
}

// ── macro percentages ──────────────────────────────────────────────────────

test('macro percentages are of macro calories, not the reported calorie figure', () => {
  // 25g protein (100 kcal), 25g carbs (100 kcal), 10g fat (90 kcal) = 290 kcal
  // of macros. The label calories are deliberately different (500) — the split
  // must ignore them or the three percentages would not add to 100.
  const split = macroSplit({ protein: 25, carbs: 25, fat: 10, calories: 500 });
  assert.equal(Math.round(split.pct.protein), 34);
  assert.equal(Math.round(split.pct.carbs), 34);
  assert.equal(Math.round(split.pct.fat), 31);
  const sum = split.pct.protein + split.pct.carbs + split.pct.fat;
  assert.ok(Math.abs(sum - 100) < 1e-9, `percentages summed to ${sum}`);
});

test('a meal with no macros is unknown rather than 0% and failing', () => {
  const profile = { macros: { protein: { min: 25, max: 40 }, carbs: null, fat: null }, nutrients: [] };
  const { results } = evaluateMeal(profile, { calories: 0 });
  assert.equal(results[0].status, 'unknown');
  assert.equal(results[0].gap, 0);
});

// ── goal evaluation ────────────────────────────────────────────────────────

test('over, under and inside a macro range', () => {
  const profile = { macros: { fat: { min: 20, max: 35 }, protein: null, carbs: null }, nutrients: [] };
  const over = evaluateMeal(profile, { protein: 10, carbs: 10, fat: 20 }); // 69% fat
  assert.equal(over.results[0].status, 'over');
  assert.ok(over.results[0].gap < 0, 'over goal reports a negative gap');
  const under = evaluateMeal(profile, { protein: 40, carbs: 40, fat: 2 });  // 5% fat
  assert.equal(under.results[0].status, 'under');
  assert.ok(under.results[0].gap > 0, 'under goal reports a positive gap');
  const inside = evaluateMeal(profile, { protein: 30, carbs: 30, fat: 12 }); // 31% fat
  assert.equal(inside.results[0].status, 'pass');
});

test('atLeast ignores a max, atMost ignores a min, between honours both', () => {
  const perServing = { fiber: 6, sodium: 900, calories: 600 };
  const profile = {
    macros: {},
    nutrients: [
      { id: 'a', key: 'fiber', op: 'atLeast', min: 8, max: 4 },
      { id: 'b', key: 'sodium', op: 'atMost', min: 5000, max: 700 },
      { id: 'c', key: 'calories', op: 'between', min: 450, max: 750 },
    ],
  };
  const { results } = evaluateMeal(profile, perServing);
  assert.equal(results[0].status, 'under');   // 6 < 8; the stray max is ignored
  assert.equal(results[0].max, null);
  assert.equal(results[1].status, 'over');    // 900 > 700; the stray min is ignored
  assert.equal(results[1].min, null);
  assert.equal(results[2].status, 'pass');
});

test('a bound of zero is a real goal, a blank bound is not', () => {
  const profile = {
    macros: {},
    nutrients: [
      { id: 'a', key: 'transFat', op: 'atMost', min: null, max: 0 },
      { id: 'b', key: 'fiber', op: 'atLeast', min: null, max: null },
    ],
  };
  const { results } = evaluateMeal(profile, { transFat: 1.5, fiber: 0 });
  assert.equal(results.length, 1, 'the blank-bound goal is not scored');
  assert.equal(results[0].key, 'transFat');
  assert.equal(results[0].status, 'over');
});

// ── the meal model ─────────────────────────────────────────────────────────

test('base ingredients divide by servings, per-meal toppings do not', () => {
  const rows = [
    row({ name: 'chicken', protein: 120 }),
    row({ name: 'parmesan', protein: 6, topping: true }),
  ];
  const totals = totalsForRows(rows, 4);
  assert.equal(totals.protein, 36); // 120/4 + 6
});

test('changing a quantity rescales that row without another lookup', () => {
  const rows = [row({ name: 'olive oil', qty: 2, measurement: 'tbsp', grams: 28, fat: 28 })];
  assert.equal(totalsForRows(rows, 1).fat, 28);
  rows[0].quantity = 1;
  assert.equal(totalsForRows(rows, 1).fat, 14);
});

// ── suggestions ────────────────────────────────────────────────────────────

const FAT_PROFILE = {
  macros: { fat: { min: 0, max: 35 }, protein: null, carbs: null },
  nutrients: [],
};

test('cutting the fat-dense ingredient is suggested, and the projection lands inside', () => {
  const rows = [
    row({ name: 'chicken breast', qty: 300, measurement: 'g', grams: 300, protein: 90, fat: 9 }),
    row({ name: 'olive oil', qty: 3, measurement: 'tbsp', grams: 42, fat: 42 }),
  ];
  const before = evaluateMeal(FAT_PROFILE, totalsForRows(rows, 1));
  assert.equal(before.results[0].status, 'over');

  const fixes = suggestFixes({ rows, servings: 1, profile: FAT_PROFILE });
  assert.ok(fixes.length > 0, 'expected at least one suggestion');
  const top = fixes[0];
  assert.equal(top.name, 'olive oil', 'the fat-dense row is the lever, not the chicken');
  assert.ok(top.toQty < top.fromQty);
  assert.equal(top.projected.status, 'pass', 'the projected value must actually be inside the range');
});

test('a suggestion never claims a fix that its own rounding undoes', () => {
  // Ten runs over amounts that make the tidy quantity land right on the edge.
  for (let fat = 30; fat <= 60; fat += 3) {
    const rows = [
      row({ name: 'chicken', qty: 250, measurement: 'g', grams: 250, protein: 75, fat: 8 }),
      row({ name: 'butter', qty: 4, measurement: 'tbsp', grams: 56, fat }),
    ];
    for (const fix of suggestFixes({ rows, servings: 1, profile: FAT_PROFILE })) {
      if (fix.projected.status !== 'pass') continue;
      // Re-apply the suggestion the way the UI does and re-score from scratch.
      const applied = fix.type === 'add'
        ? [...rows, fix.addRow]
        : rows.map((r, i) => (i === fix.rowIndex ? { ...r, quantity: fix.toQty, disabled: fix.toQty <= 0 } : r));
      const after = evaluateMeal(FAT_PROFILE, totalsForRows(applied, 1));
      const goal = after.results.find(r => r.id === fix.goalId);
      assert.equal(goal.status, 'pass', `fat=${fat}: ${fix.name} → ${fix.toQty} claimed a fix it does not deliver`);
    }
  }
});

test('an ingredient that cannot fix the goal even at zero is not suggested', () => {
  // All the fat is in the butter; cutting the flour can never fix fat %.
  const rows = [
    row({ name: 'butter', qty: 4, measurement: 'tbsp', grams: 56, fat: 56 }),
    row({ name: 'flour', qty: 1, measurement: 'cup', grams: 120, carbs: 95, protein: 12 }),
  ];
  const fixes = suggestFixes({ rows, servings: 1, profile: FAT_PROFILE });
  assert.ok(fixes.every(f => f.name !== 'flour'), 'cutting the flour would raise fat %, not lower it');
  assert.ok(fixes.some(f => f.name === 'butter'));
});

test('removing is offered when reducing alone cannot get there', () => {
  const rows = [
    row({ name: 'heavy cream', qty: 1, measurement: 'cup', grams: 238, fat: 88, protein: 5, carbs: 7 }),
  ];
  const strict = { macros: { fat: { min: 0, max: 20 }, protein: null, carbs: null }, nutrients: [] };
  const fixes = suggestFixes({ rows, servings: 1, profile: strict });
  // A single fat-dominated ingredient can't be scaled into a 20% fat meal —
  // every reduction keeps the same ratio — so nothing false is offered.
  assert.ok(fixes.every(f => f.projected.status === 'pass' || f.type === 'remove'));
});

test('an under-target nutrient suggests raising an ingredient that carries it', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fiber', op: 'atLeast', min: 10, max: null }],
  };
  const rows = [
    row({ name: 'black beans', qty: 0.5, measurement: 'cup', grams: 90, fiber: 7, protein: 7, carbs: 20 }),
    row({ name: 'rice', qty: 1, measurement: 'cup', grams: 180, carbs: 45, protein: 4, fiber: 0.6 }),
  ];
  const fixes = suggestFixes({ rows, servings: 1, profile });
  const beans = fixes.find(f => f.name === 'black beans');
  assert.ok(beans, 'expected the fibre-dense row to be offered');
  assert.equal(beans.type, 'increase');
  assert.ok(beans.toQty > beans.fromQty);
  assert.equal(beans.projected.status, 'pass');
});

test('an addition is proposed from the ingredients DB with a real amount', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fiber', op: 'atLeast', min: 10, max: null }],
  };
  // Nothing in the meal carries fibre, so raising an amount cannot work.
  const rows = [row({ name: 'chicken breast', qty: 200, measurement: 'g', grams: 200, protein: 60, fat: 6 })];
  const candidates = candidatesFromIngredientsDb([
    { ingredient: 'chia seeds', grams: 28, measurement: 'oz', fiber: 10, fat: 9, protein: 5 },
    { ingredient: 'white bread', grams: 30, measurement: 'slice', fiber: 0.8, carbs: 15 },
    { ingredient: 'water', grams: 240, measurement: 'cup' },
  ]);
  const fixes = suggestFixes({ rows, servings: 1, profile, candidates });
  const add = fixes.find(f => f.type === 'add');
  assert.ok(add, 'expected an add suggestion');
  assert.equal(add.name, 'chia seeds', 'the densest source needs the smallest amount');
  assert.ok(add.toQty > 0 && add.grams > 0);
  assert.equal(add.projected.status, 'pass');
  assert.ok(fixes.every(f => f.name !== 'water'), 'a row with no nutrition is not a candidate');
});

test('a fix that breaks a passing goal is reported, not hidden', () => {
  const profile = {
    macros: {},
    nutrients: [
      { id: 'p', key: 'protein', op: 'atLeast', min: 24, max: null },
      { id: 'c', key: 'calories', op: 'atMost', min: null, max: 500 },
    ],
  };
  // Protein is short; the only lever is a calorie-heavy row, which pushes
  // calories past their (currently passing) cap.
  // 4x the amount is the solver ceiling: 6 tbsp reaches 24g protein but 570 cal.
  const rows = [row({ name: 'peanut butter', qty: 2, measurement: 'tbsp', grams: 32, protein: 8, fat: 16, calories: 190 })];
  const fixes = suggestFixes({ rows, servings: 1, profile });
  const proteinFix = fixes.find(f => f.goalId === 'nut:p');
  assert.ok(proteinFix);
  assert.ok(proteinFix.broke.length > 0, 'the calorie goal it breaks must be surfaced');
  assert.equal(proteinFix.broke[0].key, 'calories');
});

test('suggestions are ordered so the ones with no side effects come first', () => {
  const profile = {
    macros: {},
    nutrients: [
      { id: 'f', key: 'fiber', op: 'atLeast', min: 8, max: null },
      // Tight enough that doubling the lentils breaks it but a little more
      // psyllium does not — so the two fixes differ in collateral damage.
      { id: 'c', key: 'calories', op: 'atMost', min: null, max: 380 },
    ],
  };
  const rows = [
    row({ name: 'lentils', qty: 0.25, measurement: 'cup', grams: 50, fiber: 2, protein: 9, calories: 85 }),
    row({ name: 'olive oil', qty: 2, measurement: 'tbsp', grams: 28, fat: 28, calories: 250 }),
    row({ name: 'psyllium husk', qty: 1, measurement: 'tsp', grams: 5, fiber: 4, calories: 15 }),
  ];
  const fixes = suggestFixes({ rows, servings: 1, profile }).filter(f => f.goalId === 'nut:f');
  assert.ok(fixes.length > 0);
  const breakCounts = fixes.map(f => f.broke.length);
  assert.deepEqual([...breakCounts].sort((a, b) => a - b), breakCounts, 'clean fixes must sort first');
});

test('servings are respected — the same recipe cut four ways passes', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'c', key: 'calories', op: 'atMost', min: null, max: 600 }],
  };
  const rows = [row({ name: 'lasagna', qty: 1, measurement: 'pan', grams: 2000, calories: 2200, protein: 100, carbs: 200, fat: 90 })];
  assert.equal(evaluateMeal(profile, totalsForRows(rows, 1)).results[0].status, 'over');
  assert.equal(evaluateMeal(profile, totalsForRows(rows, 4)).results[0].status, 'pass');
});

// ── rounding ───────────────────────────────────────────────────────────────

test('solved amounts round to something measurable, per unit', () => {
  assert.equal(niceQuantity(1.37, 'tbsp'), 1.25);
  assert.equal(niceQuantity(0.31, 'tsp'), 0.25);
  assert.equal(niceQuantity(147.2, 'g'), 145);
  assert.equal(niceQuantity(7.4, 'g'), 7);
  assert.equal(niceQuantity(2.6, 'clove'), 2.5);
  // A wanted ingredient never rounds away to zero — that is a removal.
  assert.ok(niceQuantity(0.02, 'tbsp') > 0);
});

// ── storage ────────────────────────────────────────────────────────────────

test('a corrupt or empty store still yields one usable profile', () => {
  for (const raw of [null, {}, { profiles: 'nope' }, { profiles: [null, 7] }]) {
    const store = normalizeStore(raw);
    assert.equal(store.profiles.length, 1);
    assert.ok(profileHasGoals(store.profiles[0]));
    assert.equal(store.activeId, store.profiles[0].id);
  }
});

test('an unknown nutrient key is dropped rather than scored as NaN', () => {
  const store = normalizeStore({
    profiles: [{ id: 'p1', name: 'x', macros: {}, nutrients: [
      { key: 'unobtainium', op: 'atLeast', min: 5 },
      { key: 'fiber', op: 'atLeast', min: 5 },
    ] }],
    activeId: 'p1',
  });
  assert.deepEqual(store.profiles[0].nutrients.map(n => n.key), ['fiber']);
});

test('activeId falls back when it points at a profile that is gone', () => {
  const store = normalizeStore({
    profiles: [{ id: 'a', name: 'A', macros: { protein: { min: 20, max: 30 } }, nutrients: [] }],
    activeId: 'deleted',
  });
  assert.equal(store.activeId, 'a');
});

test('seeding from daily goals splits them across three meals', () => {
  const p = profileFromDailyGoals({
    calories: 2100, plateProtein: 30, plateCarbs: 45, plateFat: 25,
    fiber: 30, sodium: 2100,
  });
  assert.deepEqual(p.macros.protein, { min: 25, max: 35 });
  const cal = p.nutrients.find(n => n.key === 'calories');
  assert.equal(cal.op, 'between');
  assert.equal(cal.min, Math.round(700 * 0.85));
  const fiber = p.nutrients.find(n => n.key === 'fiber');
  assert.equal(fiber.op, 'atLeast');
  assert.equal(fiber.min, 10);
  const sodium = p.nutrients.find(n => n.key === 'sodium');
  assert.equal(sodium.op, 'atMost', 'sodium is a ceiling, not a floor');
  assert.equal(sodium.max, 700);
});

test('an empty profile has no goals and scores nothing', () => {
  const p = emptyProfile();
  assert.equal(profileHasGoals(p), false);
  assert.equal(evaluateMeal(p, { protein: 10 }).results.length, 0);
});

// ── yes/no goals ───────────────────────────────────────────────────────────

test('"must include" passes on any amount at all and fails on none', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fermentedServings', op: 'has', min: null, max: null }],
  };
  const absent = evaluateMeal(profile, { fermentedServings: 0 });
  assert.equal(absent.results[0].status, 'under');
  assert.equal(absent.results[0].boolean, true);
  // A splash of soy sauce is a small fraction of a serving — still a yes.
  const trace = evaluateMeal(profile, { fermentedServings: 0.19 });
  assert.equal(trace.results[0].status, 'pass');
});

test('"must avoid" is the mirror of it', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fermentedServings', op: 'hasNot', min: null, max: null }],
  };
  assert.equal(evaluateMeal(profile, { fermentedServings: 0 }).results[0].status, 'pass');
  assert.equal(evaluateMeal(profile, { fermentedServings: 0.5 }).results[0].status, 'over');
});

test('a yes/no goal counts as a goal even though it carries no number', () => {
  // Its bounds are implied by the operator, so the "have you set anything?"
  // check cannot look at min/max alone.
  const profile = {
    macros: { protein: null, carbs: null, fat: null },
    nutrients: [{ id: 'f', key: 'omega3Servings', op: 'has', min: null, max: null }],
  };
  assert.equal(profileHasGoals(profile), true);
});

test('a yes/no goal survives a save/load round trip', () => {
  const store = normalizeStore({
    profiles: [{
      id: 'p1', name: 'Gut health', macros: {},
      nutrients: [
        { id: 'a', key: 'fermentedServings', op: 'has' },
        { id: 'b', key: 'omega3Servings', op: 'has' },
      ],
    }],
    activeId: 'p1',
  });
  assert.equal(store.profiles[0].nutrients.length, 2);
  assert.deepEqual(store.profiles[0].nutrients.map(n => n.op), ['has', 'has']);
});

test('a missing fermented food is answered by adding one, not by shuffling amounts', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fermentedServings', op: 'has', min: null, max: null }],
  };
  const rows = [row({ name: 'chicken breast', qty: 200, measurement: 'g', grams: 200, protein: 60, fat: 6 })];
  const candidates = candidatesFromIngredientsDb([
    // Note neither row carries a fermented column — it is read off the name.
    { ingredient: 'kimchi', grams: 100, measurement: 'cup', carbs: 2, calories: 15 },
    { ingredient: 'white rice', grams: 150, measurement: 'cup', carbs: 45, calories: 200 },
  ]);
  const fixes = suggestFixes({ rows, servings: 1, profile, candidates });
  const add = fixes.find(f => f.type === 'add');
  assert.ok(add, 'expected an add suggestion');
  assert.equal(add.name, 'kimchi');
  assert.equal(add.projected.status, 'pass');
  assert.ok(fixes.every(f => f.name !== 'white rice'), 'rice is not a fermented food');
});

test('omega-3 presence is read from the ingredient, not from a blank data column', () => {
  const profile = {
    macros: {},
    nutrients: [{ id: 'o', key: 'omega3Servings', op: 'has', min: null, max: null }],
  };
  // The salmon row has omega3: 0 — exactly the case where the measured column
  // is unfilled. The name is what has to answer the question.
  const candidates = candidatesFromIngredientsDb([
    { ingredient: 'salmon fillet', grams: 170, measurement: 'each', protein: 34, fat: 12, omega3: 0 },
  ]);
  assert.ok(candidates[0].per100g.omega3Servings > 0, 'salmon must register as an omega-3 source');
  const rows = [row({ name: 'white rice', qty: 1, measurement: 'cup', grams: 150, carbs: 45 })];
  const fixes = suggestFixes({ rows, servings: 1, profile, candidates });
  assert.equal(fixes.find(f => f.type === 'add')?.name, 'salmon fillet');
});

test('a suggested amount is always something you could measure', () => {
  // The nudge that keeps rounding from undoing a fix has to move a whole step;
  // stepping by the rounding error alone rounds straight back and falls
  // through to an unusable number like "1.0266666666691688 cup".
  const profile = {
    macros: {},
    nutrients: [{ id: 'f', key: 'fiber', op: 'atLeast', min: 8, max: null }],
  };
  const rows = [row({ name: 'chicken breast', qty: 300, measurement: 'g', grams: 300, protein: 90 })];
  const candidates = candidatesFromIngredientsDb([
    { ingredient: 'black beans', grams: 180, measurement: 'cup', protein: 15, carbs: 40, fiber: 15, calories: 227 },
  ]);
  const fixes = suggestFixes({ rows, servings: 2, profile, candidates });
  assert.ok(fixes.length > 0);
  for (const fix of fixes) {
    const step = quantityStep(fix.toQty, fix.measurement);
    const offGrid = Math.abs(fix.toQty / step - Math.round(fix.toQty / step));
    assert.ok(offGrid < 1e-6, `${fix.name}: ${fix.toQty} ${fix.measurement} is not a multiple of ${step}`);
  }
});

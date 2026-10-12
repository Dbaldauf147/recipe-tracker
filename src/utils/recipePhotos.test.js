import test from 'node:test';
import assert from 'node:assert/strict';
import { batchPhotos, mergeRecipeParts, parseRecipePhotos } from './recipePhotos.js';

test('batchPhotos keeps everything in one request when it fits', () => {
  assert.deepEqual(batchPhotos(['aa', 'bb', 'cc'], 10), [['aa', 'bb', 'cc']]);
});

test('batchPhotos splits at the budget and keeps page order', () => {
  assert.deepEqual(batchPhotos(['aaaa', 'bbbb', 'cccc'], 9), [['aaaa', 'bbbb'], ['cccc']]);
});

test('batchPhotos gives an oversized photo its own batch instead of dropping it', () => {
  assert.deepEqual(batchPhotos(['a', 'bbbbbbbbbbbb', 'c'], 5), [['a'], ['bbbbbbbbbbbb'], ['c']]);
});

test('mergeRecipeParts: first title wins, ingredients dedupe, steps append in order', () => {
  const merged = mergeRecipeParts([
    { title: 'Lasagna', ingredients: ['1 lb beef', '2 cups ricotta'], instructions: 'Brown the beef\nMix cheese', servings: '', category: '' },
    { title: 'Lasagna (cont.)', ingredients: ['2 Cups Ricotta', '9 noodles'], instructions: 'Layer\n\nBake 45 min', servings: '8', category: 'lunch-dinner' },
  ]);
  assert.equal(merged.title, 'Lasagna');
  assert.deepEqual(merged.ingredients, ['1 lb beef', '2 cups ricotta', '9 noodles']);
  assert.equal(merged.instructions, 'Brown the beef\nMix cheese\nLayer\nBake 45 min');
  assert.equal(merged.servings, '8');
  assert.equal(merged.category, 'lunch-dinner');
});

test('parseRecipePhotos returns the single response untouched when one request suffices', async () => {
  const calls = [];
  const only = { title: 'Soup', ingredients: ['water'], instructions: 'Boil', servings: '2', category: '' };
  const out = await parseRecipePhotos(['x', 'y'], async batch => { calls.push(batch); return only; });
  assert.deepEqual(calls, [['x', 'y']]);
  assert.equal(out, only);
});

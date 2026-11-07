import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeText } from './parseRecipeText.js';

// The on-screen text of a TikTok cocktail post, as a user would paste it:
// no headings, a "#40" series number in front of the title, bare items with
// no amount, and bar-method steps (shake, strain) the parser didn't know.
const FIGGY_CHRISTMAS = [
  '#40 Figgy Christmas',
  '',
  '2 oz bourbon',
  '1/2 oz lemon juice',
  '1 oz maple syrup',
  '1 tbs fig jam',
  'Ice',
  'Figs',
  'Shake w/ ice ingredients',
  'strain into glass w/ fresh ice',
  'Garnish w/ fig',
].join('\n');

test('reads a TikTok cocktail with a series-numbered title', () => {
  const out = parseRecipeText(FIGGY_CHRISTMAS);
  assert.equal(out.title, 'Figgy Christmas');
  assert.deepEqual(out.ingredients.map(i => i.ingredient), ['bourbon', 'lemon juice', 'maple syrup', 'fig jam', 'Ice', 'Figs']);
  assert.deepEqual(out.ingredients[1], { quantity: '1/2', measurement: 'oz', ingredient: 'lemon juice' });
  assert.match(out.instructions, /^Shake w\/ ice ingredients\nstrain into glass w\/ fresh ice\nGarnish w\/ fig$/);
});

test('strips a series number from a title above headings too', () => {
  const out = parseRecipeText('#12 Spicy Margarita\nIngredients:\n2 oz tequila\nInstructions:\nShake and strain.');
  assert.equal(out.title, 'Spicy Margarita');
  assert.equal(out.ingredients.length, 1);
});

test('still skips ordinary hashtag lines', () => {
  const out = parseRecipeText('Garlic Pasta\n2 cups pasta\nBoil the pasta.\n#pasta #dinner #40daysofsoup');
  assert.equal(out.title, 'Garlic Pasta');
  assert.equal(out.ingredients.length, 1);
});

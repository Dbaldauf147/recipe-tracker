import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitClipboardRows, parsePastedSteps, isSpreadsheetHtml } from './pastedSteps.js';

test('a plain column of steps, one per row', () => {
  // Excel uses CRLF and ends the block with a newline.
  const clip = 'Preheat the oven\r\nChop the onions\r\nRoast for 20 minutes\r\n';
  assert.deepEqual(parsePastedSteps(clip), [
    'Preheat the oven',
    'Chop the onions',
    'Roast for 20 minutes',
  ]);
});

test('the trailing newline does not make a phantom empty step', () => {
  assert.equal(splitClipboardRows('a\r\nb\r\n').length, 2);
});

test('a cell with a line break stays ONE step', () => {
  // Alt+Enter inside a cell. Excel quotes the whole cell; splitting on raw
  // newlines used to tear it into two steps with stray quote characters.
  const clip = '"Mix the dry ingredients,\nthen fold in the wet"\r\nBake\r\n';
  const steps = parsePastedSteps(clip);
  assert.equal(steps.length, 2, `expected 2 steps, got ${JSON.stringify(steps)}`);
  // The break collapses to a space: RecipeForm stores steps newline-delimited,
  // so a surviving \n would split this step in two again on save.
  assert.equal(steps[0], 'Mix the dry ingredients, then fold in the wet');
  assert.equal(steps[1], 'Bake');
  assert.ok(steps.every(s => !s.includes('\n')), 'no step may contain a newline');
});

test('a doubled quote inside a quoted cell becomes one quote', () => {
  const clip = '"Use the 9"" pan"\r\n';
  assert.deepEqual(parsePastedSteps(clip), ['Use the 9" pan']);
});

test('a quote in the MIDDLE of an unquoted cell is literal', () => {
  // The old rule would have opened a quoted cell here and swallowed the row.
  const clip = 'Use a 9" pan\r\nBake\r\n';
  assert.deepEqual(parsePastedSteps(clip), ['Use a 9" pan', 'Bake']);
});

test('a quoted cell may contain a tab without splitting into columns', () => {
  const clip = '"Chop\tthen sear"\r\n';
  assert.deepEqual(splitClipboardRows(clip), [['Chop\tthen sear']]);
});

test('a multi-column row keeps its longest cell', () => {
  // Step number in one column, the instruction in another.
  const clip = '1\tPreheat the oven to 400F\r\n2\tChop\r\n';
  assert.deepEqual(parsePastedSteps(clip), ['Preheat the oven to 400F', 'Chop']);
});

test('leading step numbering is stripped', () => {
  const clip = 'Step 1: Preheat\r\n2. Chop\r\n3) Roast\r\n';
  assert.deepEqual(parsePastedSteps(clip), ['Preheat', 'Chop', 'Roast']);
});

test('blank rows in the middle are dropped', () => {
  assert.deepEqual(parsePastedSteps('Preheat\r\n\r\nChop\r\n'), ['Preheat', 'Chop']);
});

test('empty input yields no steps and no rows', () => {
  assert.deepEqual(parsePastedSteps(''), []);
  assert.deepEqual(splitClipboardRows(''), []);
  assert.deepEqual(parsePastedSteps(null), []);
});

test('spreadsheet HTML is recognised, ordinary rich text is not', () => {
  assert.equal(isSpreadsheetHtml('<table><tr><td>Preheat</td></tr></table>'), true);
  assert.equal(isSpreadsheetHtml('<meta name=Generator content="Microsoft Excel 15"><table>'), true);
  assert.equal(isSpreadsheetHtml('<div style="mso-line-height:1">x</div>'), true);
  // Word / web-page paste keeps working as rich text.
  assert.equal(isSpreadsheetHtml('<p><b>Preheat</b> the oven</p>'), false);
  assert.equal(isSpreadsheetHtml(''), false);
  assert.equal(isSpreadsheetHtml(undefined), false);
});

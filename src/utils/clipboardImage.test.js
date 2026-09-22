import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastedImageFile } from './clipboardImage.js';

// Minimal stand-in for a ClipboardEvent's DataTransfer.
function clip({ text = '', html = '', image = null }) {
  const items = [];
  if (text) items.push({ type: 'text/plain', getAsFile: () => null });
  if (html) items.push({ type: 'text/html', getAsFile: () => null });
  if (image) items.push({ type: 'image/png', getAsFile: () => image });
  return {
    clipboardData: {
      items,
      getData: t => (t === 'text/html' ? html : text),
    },
  };
}

test('a screenshot pastes as an image', () => {
  const blob = { name: 'shot.png' };
  assert.equal(pastedImageFile(clip({ image: blob })), blob);
});

test('an Excel range is text, even though it ships a picture too', () => {
  // This is the bug: Excel puts image/png on the clipboard next to the rows.
  const blob = { name: 'excel-bitmap.png' };
  const e = clip({
    text: '1\tcup\tflour\r\n2\ttbsp\tsugar\r\n',
    html: '<table><tr><td>1</td><td>cup</td><td>flour</td></tr></table>',
    image: blob,
  });
  assert.equal(pastedImageFile(e), null);
});

test('a spreadsheet table with no text/plain is still text', () => {
  const e = clip({ html: '<table><tr><td>flour</td></tr></table>', image: { name: 'x.png' } });
  assert.equal(pastedImageFile(e), null);
});

test('plain text with no image returns null', () => {
  assert.equal(pastedImageFile(clip({ text: 'flour' })), null);
});

test('whitespace-only text does not block a real image', () => {
  const blob = { name: 'shot.png' };
  assert.equal(pastedImageFile(clip({ text: '   \n', image: blob })), blob);
});

test('a missing clipboard is handled', () => {
  assert.equal(pastedImageFile({}), null);
  assert.equal(pastedImageFile(null), null);
});

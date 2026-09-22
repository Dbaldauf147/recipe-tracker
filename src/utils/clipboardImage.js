/**
 * Pull a genuine pasted picture off a clipboard event.
 *
 * Excel, Sheets and Word all put a *picture of the copied cells* on the
 * clipboard alongside the text/plain and text/html flavours. A handler that
 * simply scans `clipboardData.items` for `image/*` therefore sees a pasted
 * block of ingredients as a photo — which is how a screenshot of the
 * spreadsheet ended up saved as the recipe's meal image instead of the rows
 * landing in the ingredient table.
 *
 * A real screenshot or a copied photo carries no text flavour at all, so
 * "the clipboard also has text" is the signal that the user is pasting data,
 * not a picture. The text/html check catches the rarer case where a
 * spreadsheet ships a <table> with an empty text/plain.
 *
 * Returns the File to treat as an image, or null when the paste is text.
 */
export function pastedImageFile(e) {
  const dt = e?.clipboardData;
  if (!dt) return null;

  const text = dt.getData ? (dt.getData('text/plain') || '') : '';
  if (text.trim()) return null;

  const html = dt.getData ? (dt.getData('text/html') || '') : '';
  if (/<(table|tr|td|th)\b/i.test(html)) return null;

  const item = Array.from(dt.items || []).find(it => it.type?.startsWith('image/'));
  return item ? item.getAsFile() : null;
}

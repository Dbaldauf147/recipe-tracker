// Parsing a spreadsheet paste into recipe steps.
//
// Splitting on \n and \t is almost right and quietly wrong in two places, both
// of which Excel hits constantly:
//
//   • A cell containing a line break (Alt+Enter), a tab, or a quote is written
//     to the clipboard CSV-style — wrapped in double quotes, with any internal
//     quote doubled. Splitting on raw newlines tears that one cell into several
//     steps and leaves stray " characters on the ends.
//   • Excel ends the block with a trailing newline, so a naive split produces a
//     phantom empty row.
//
// So the clipboard text is parsed properly rather than split: quotes are only
// special at the START of a cell, which keeps a mid-cell quote (`a 9" pan`)
// literal instead of swallowing the rest of the row.

/**
 * Clipboard text → rows of cells, honouring quoted cells that contain tabs or
 * newlines.
 * @param {string} text
 * @returns {string[][]}
 */
export function splitClipboardRows(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s === '') return [];

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } // "" is an escaped quote
        else inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    // A quote only opens a quoted cell at the very start of that cell.
    if (ch === '"' && cell === '') { inQuotes = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);

  // Spreadsheets terminate the block with a newline, which leaves one empty row.
  while (rows.length > 0 && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

/**
 * Clipboard text → one step per row.
 *
 * A multi-column row keeps its LONGEST cell: pasting a table whose other
 * columns are step numbers, times or notes should still yield the instruction.
 * Leading "Step 3:" / "3." numbering is stripped, since the list numbers itself.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parsePastedSteps(text) {
  return splitClipboardRows(text)
    .map(cells => {
      const filled = cells.map(c => c.trim()).filter(Boolean);
      if (filled.length === 0) return '';
      const step = filled.length === 1
        ? filled[0]
        : filled.reduce((a, b) => (b.length > a.length ? b : a), '');
      return step
        // A line break INSIDE a cell becomes a space. The cell is one step —
        // that's the whole point of honouring the quotes — but RecipeForm keeps
        // its steps as one newline-delimited string, so a surviving \n would
        // split that step back in two the moment it was saved.
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^step\s*\d+\s*[:.)-]?\s*/i, '')
        .replace(/^\d+\s*[.)-]\s*/, '')
        .trim();
    })
    .filter(Boolean);
}

/**
 * Did this paste come out of a spreadsheet?
 *
 * Matters because the step editor is contentEditable: left alone, the browser
 * inserts the clipboard's text/html, and Excel's is a full <table> complete with
 * borders and mso- styles. That lands in the step as markup. A paste from Word
 * or a web page is ordinary rich text and is deliberately NOT caught here — the
 * editor supports bold/italic/underline and that paste should keep working.
 *
 * @param {string} html the clipboard's text/html flavour
 * @returns {boolean}
 */
export function isSpreadsheetHtml(html) {
  if (!html) return false;
  return /<table[\s>]/i.test(html)
    || /urn:schemas-microsoft-com:office:(excel|spreadsheet)/i.test(html)
    || /\bmso-/i.test(html);
}

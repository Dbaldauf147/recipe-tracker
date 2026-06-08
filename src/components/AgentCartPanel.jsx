import { useMemo, useState } from 'react';
import { buildGroceryRows } from './ShoppingList';

// Builds the copy-paste Claude prompt that drives a browser agent to fill a
// Whole Foods cart from the current shopping list.
function buildPrompt(rows) {
  const intro = [
    'Go to Whole Foods Market (wholefoodsmarket.com) and add the grocery list below to my cart.',
    'Each item includes an amount, unit, item name, and a hyperlink to the product page. For each item:',
    '',
    '1. Navigate to the product page using the provided link',
    '2. Set the quantity to match the amount/unit specified',
    '3. Add it to my cart',
    '4. Confirm it was added before moving to the next item',
    '',
    'If a product page shows the item is out of stock or unavailable, skip it and note it in a summary at the end. If the quantity/unit doesn\'t map cleanly to the site\'s options (e.g., I want "2 lbs" but it sells by the item), choose the closest match and flag it for my review.',
    '',
    'If an item has no link ([no link]), search Whole Foods for it by name and pick the closest match.',
    '',
    'When finished, give me a summary table showing: item, requested amount, quantity actually added, and any issues encountered. Do not proceed to checkout — stop once everything is in the cart.',
    '',
    'GROCERY LIST:',
    '| Amount | Unit | Item | Link |',
    '|--------|------|------|------|',
  ];
  const body = rows.map(
    r => `| ${r.amount} | ${r.unit || '-'} | ${r.item} | ${r.link || '[no link]'} |`,
  );
  return [...intro, ...body].join('\n');
}

export function AgentCartPanel({ recipes, weeklyServings, extraItems, pantryNames, dismissedNames }) {
  const rows = useMemo(
    () => buildGroceryRows(recipes, weeklyServings, extraItems, pantryNames, dismissedNames),
    [recipes, weeklyServings, extraItems, pantryNames, dismissedNames],
  );
  const prompt = useMemo(() => buildPrompt(rows), [rows]);
  const [copied, setCopied] = useState(false);

  const linked = rows.filter(r => r.link).length;
  const missing = rows.length - linked;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select the textarea so the user can Ctrl+C manually.
      const ta = document.getElementById('agent-prompt-text');
      if (ta) { ta.focus(); ta.select(); }
    }
  }

  const cardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md, 12px)',
    padding: '1.25rem',
    marginBottom: '1rem',
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', fontWeight: 700 }}>
          🛒 Fill my Whole Foods cart
        </h3>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          This turns your current shopping list into a ready-to-run prompt. Copy it, open
          Claude in a Chrome tab, and paste it — the agent visits each product link and adds
          it to your Whole Foods cart. Add product links on items (the 🔗 / Link column) for
          the most reliable matches; anything without a link, the agent searches by name.
        </p>

        <div style={{ display: 'flex', gap: '1.5rem', margin: '1rem 0' }}>
          <div><strong style={{ fontSize: '1.4rem' }}>{rows.length}</strong>{' '}
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>items</span></div>
          <div><strong style={{ fontSize: '1.4rem', color: 'var(--color-success, #16a34a)' }}>{linked}</strong>{' '}
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>with link</span></div>
          <div><strong style={{ fontSize: '1.4rem', color: missing ? 'var(--color-warning, #D4A017)' : 'var(--color-text-muted)' }}>{missing}</strong>{' '}
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>no link</span></div>
        </div>

        <button
          type="button"
          onClick={copyPrompt}
          disabled={rows.length === 0}
          style={{
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: '50px',
            padding: '0.55rem 1.1rem',
            fontSize: '0.9rem',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            opacity: rows.length === 0 ? 0.5 : 1,
          }}
        >
          {copied ? '✓ Copied!' : '📋 Copy prompt'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
          Your shopping list is empty — add recipes to this week or items to the list, then come back.
        </p>
      ) : (
        <>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
            Prompt preview
          </label>
          <textarea
            id="agent-prompt-text"
            readOnly
            value={prompt}
            onFocus={e => e.target.select()}
            style={{
              width: '100%',
              minHeight: 320,
              marginTop: '0.4rem',
              padding: '0.75rem',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '0.78rem',
              lineHeight: 1.5,
              color: 'var(--color-text)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md, 12px)',
              resize: 'vertical',
            }}
          />
        </>
      )}
    </div>
  );
}

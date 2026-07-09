import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchNutritionForIngredient, NUTRIENTS } from '../utils/nutrition';
import { loadIngredients } from '../utils/ingredientsStore';
import { ingredientMatchScore } from '../utils/ingredientMatch';

// Each component defaults to "1 serving" of the chosen ingredient (multiplier 1
// in the sheet lookup); the user adjusts quantity/unit to dial in the portion.
const UNIT_OPTIONS = ['serving', 'g', 'oz', 'cup', 'tbsp', 'tsp', 'ml', 'lb'];

function blankComp() {
  return { ingredient: '', quantity: '1', measurement: 'serving' };
}

/**
 * Modal to combine several ingredients (each with an adjustable portion) into
 * one reusable ingredient. 1 serving of the saved ingredient = the whole
 * combination; its component list is stored so it can be re-opened and edited.
 *
 * Props:
 *   open      — whether the modal is shown
 *   existing  — an ingredient row to edit (with `.components`), or null to create
 *   onClose   — close handler
 *   onSave    — (row, originalName|null) => void; persists into the DB
 */
export function CompositeIngredientBuilder({ open, existing, onClose, onSave }) {
  const [name, setName] = useState('');
  const [comps, setComps] = useState([blankComp()]);
  const [results, setResults] = useState([]); // parallel to comps: {nutrients, grams} | null
  const [computing, setComputing] = useState(false);
  const [searchIdx, setSearchIdx] = useState(null);
  const [error, setError] = useState('');
  const tokenRef = useRef(0);

  const db = useMemo(() => (open ? (loadIngredients() || []) : []), [open]);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.ingredient || '');
      setComps(existing.components?.length
        ? existing.components.map(c => ({
            ingredient: c.ingredient || '',
            quantity: c.quantity || '1',
            measurement: c.measurement || 'serving',
          }))
        : [blankComp()]);
    } else {
      setName('');
      setComps([blankComp()]);
    }
    setResults([]);
    setSearchIdx(null);
    setError('');
  }, [open, existing]);

  // Debounced recompute of every component's nutrition via the shared lookup
  // (local DB first, then external sources). Keyed on a signature of the rows.
  const signature = comps
    .map(c => `${c.ingredient.trim().toLowerCase()}|${c.quantity}|${c.measurement}`)
    .join('~');
  useEffect(() => {
    if (!open) return;
    const valid = comps.map((c, i) => ({ c, i })).filter(({ c }) => c.ingredient.trim());
    if (valid.length === 0) { setResults([]); setComputing(false); return; }
    const myToken = ++tokenRef.current;
    setComputing(true);
    const t = setTimeout(async () => {
      const out = [];
      for (const { c, i } of valid) {
        try {
          const r = await fetchNutritionForIngredient({
            ingredient: c.ingredient.trim(),
            quantity: c.quantity || '1',
            measurement: c.measurement,
          });
          out[i] = r ? { nutrients: r.nutrients || {}, grams: parseFloat(r.grams) || 0 } : null;
        } catch {
          out[i] = null;
        }
      }
      if (myToken === tokenRef.current) { setResults(out); setComputing(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [signature, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const sum = {};
    let grams = 0;
    let matched = 0;
    let rows = 0;
    comps.forEach((c, i) => {
      if (!c.ingredient.trim()) return;
      rows++;
      const r = results[i];
      if (!r || !r.nutrients) return;
      let any = false;
      for (const [k, v] of Object.entries(r.nutrients)) {
        const num = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(num)) { sum[k] = (sum[k] || 0) + num; any = true; }
      }
      grams += r.grams || 0;
      if (any) matched++;
    });
    return { sum, grams, matched, rows };
  }, [comps, results]);

  function updateComp(idx, field, value) {
    setComps(prev => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  }
  function addComp() { setComps(prev => [...prev, blankComp()]); }
  function removeComp(idx) { setComps(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))); }

  function suggestionsFor(value) {
    const q = (value || '').trim();
    if (!q) return [];
    return db
      .filter(item => (item.ingredient || '').toLowerCase().includes(q.toLowerCase()))
      .map((item, idx) => ({ item, idx, score: ingredientMatchScore(item.ingredient || '', q) }))
      .sort((a, b) => a.score - b.score || a.idx - b.idx)
      .slice(0, 8)
      .map(s => s.item);
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give your combined ingredient a name.'); return; }
    const components = comps
      .filter(c => c.ingredient.trim())
      .map(c => ({ ingredient: c.ingredient.trim(), quantity: (c.quantity || '1').trim() || '1', measurement: c.measurement }));
    if (components.length === 0) { setError('Add at least one ingredient.'); return; }

    const lower = trimmed.toLowerCase();
    const editingLower = (existing?.ingredient || '').trim().toLowerCase();
    const clash = db.some(r => (r.ingredient || '').toLowerCase().trim() === lower && lower !== editingLower);
    if (clash) { setError(`An ingredient called "${trimmed}" already exists.`); return; }

    // 1 serving of the saved ingredient = the whole combination.
    const row = {
      ingredient: trimmed,
      measurement: 'serving',
      components,
      notes: `Combined ingredient (${components.length} item${components.length === 1 ? '' : 's'})`,
    };
    if (totals.grams > 0) row.grams = String(Math.round(totals.grams));
    for (const n of NUTRIENTS) {
      const v = totals.sum[n.key];
      if (typeof v === 'number' && v > 0) row[n.key] = String(Math.round(v * 10) / 10);
    }
    onSave(row, existing?.ingredient || null);
    onClose();
  }

  if (!open) return null;

  const hasMacros = (totals.sum.calories || 0) > 0 || (totals.sum.protein || 0) > 0
    || (totals.sum.carbs || 0) > 0 || (totals.sum.fat || 0) > 0;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
            {existing ? 'Edit combined ingredient' : 'Combine ingredients'}
          </h3>
          <button style={S.close} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div style={S.body}>
          <label style={S.label}>Name</label>
          <input
            style={S.input}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. My Trail Mix"
          />

          <div style={{ ...S.label, marginTop: 16 }}>Ingredients</div>
          {comps.map((c, i) => {
            const suggestions = searchIdx === i ? suggestionsFor(c.ingredient) : [];
            const r = results[i];
            const macro = r?.nutrients;
            return (
              <div key={i} style={S.compCard}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
                  <input
                    style={{ ...S.input, flex: 1, margin: 0 }}
                    value={c.ingredient}
                    onChange={e => { updateComp(i, 'ingredient', e.target.value); setSearchIdx(i); }}
                    onFocus={() => setSearchIdx(i)}
                    onBlur={() => setTimeout(() => setSearchIdx(s => (s === i ? null : s)), 150)}
                    placeholder="Search an ingredient…"
                  />
                  <button style={S.removeBtn} onClick={() => removeComp(i)} title="Remove">&times;</button>
                  {suggestions.length > 0 && (
                    <div style={S.dropdown}>
                      {suggestions.map((item, si) => (
                        <div
                          key={si}
                          style={S.dropItem}
                          onMouseDown={() => { updateComp(i, 'ingredient', item.ingredient); setSearchIdx(null); }}
                        >
                          {item.ingredient}
                          {item.brand && <span style={S.dropBrand}>{item.brand}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input
                    style={{ ...S.input, width: 64, margin: 0, textAlign: 'center' }}
                    value={c.quantity}
                    onChange={e => updateComp(i, 'quantity', e.target.value)}
                    inputMode="decimal"
                  />
                  <select
                    style={{ ...S.input, width: 'auto', margin: 0 }}
                    value={c.measurement}
                    onChange={e => updateComp(i, 'measurement', e.target.value)}
                  >
                    {(UNIT_OPTIONS.includes(c.measurement) ? UNIT_OPTIONS : [c.measurement, ...UNIT_OPTIONS]).map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  <span style={S.compMacro}>
                    {macro
                      ? `${Math.round(macro.calories || 0)} cal · ${(macro.protein || 0).toFixed(0)}P · ${(macro.carbs || 0).toFixed(0)}C · ${(macro.fat || 0).toFixed(0)}F`
                      : (c.ingredient.trim() ? (computing ? '…' : 'not found') : '')}
                  </span>
                </div>
              </div>
            );
          })}

          <button style={S.addRow} onClick={addComp}>+ Add ingredient</button>

          <div style={S.totalBar}>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
              1 serving{totals.grams > 0 ? ` · ${Math.round(totals.grams)}g` : ''}
              {totals.rows > totals.matched ? `  (${totals.matched}/${totals.rows} matched)` : ''}
            </div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>
              {hasMacros
                ? `${Math.round(totals.sum.calories || 0)} cal · ${(totals.sum.protein || 0).toFixed(1)}g P · ${(totals.sum.carbs || 0).toFixed(1)}g C · ${(totals.sum.fat || 0).toFixed(1)}g F`
                : 'Add ingredients to see macros'}
            </div>
          </div>

          {error && <p style={S.error}>{error}</p>}
        </div>

        <div style={S.footer}>
          <button style={S.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={S.saveBtn} onClick={handleSave}>
            {existing ? 'Save changes' : 'Save as ingredient'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
  },
  modal: {
    background: 'var(--color-surface, #fff)', borderRadius: 14, width: 'min(560px, 100%)',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--color-border, #e5e7eb)',
  },
  close: { background: 'none', border: 'none', fontSize: '1.6rem', lineHeight: 1, cursor: 'pointer', color: 'var(--color-text-muted)' },
  body: { padding: 18, overflowY: 'auto' },
  label: { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 },
  input: {
    width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--color-border, #e5e7eb)',
    fontSize: '0.95rem', boxSizing: 'border-box', background: 'var(--color-bg, #fff)', color: 'inherit',
  },
  compCard: { border: '1px solid var(--color-border, #e5e7eb)', borderRadius: 10, padding: 10, marginBottom: 10 },
  removeBtn: { background: 'none', border: 'none', fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 4px' },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 40, zIndex: 5, marginTop: 4,
    background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e5e7eb)',
    borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', maxHeight: 220, overflowY: 'auto',
  },
  dropItem: { padding: '8px 11px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid var(--color-border, #f1f1f1)' },
  dropBrand: { color: 'var(--color-text-muted)', fontSize: '0.75rem', marginLeft: 8 },
  compMacro: { fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  addRow: { background: 'none', border: 'none', color: 'var(--color-accent)', fontWeight: 600, cursor: 'pointer', padding: '8px 0', fontSize: '0.95rem' },
  totalBar: { marginTop: 14, padding: '10px 12px', background: 'var(--color-bg, #f8fafc)', borderRadius: 10, border: '1px solid var(--color-border, #e5e7eb)' },
  error: { color: '#dc2626', fontSize: '0.85rem', marginTop: 10 },
  footer: {
    display: 'flex', gap: 10, justifyContent: 'flex-end',
    padding: '14px 18px', borderTop: '1px solid var(--color-border, #e5e7eb)',
  },
  cancelBtn: { padding: '9px 16px', borderRadius: 9, border: '1px solid var(--color-border, #e5e7eb)', background: 'none', cursor: 'pointer', fontWeight: 600 },
  saveBtn: { padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--color-accent)', color: '#fff', cursor: 'pointer', fontWeight: 700 },
};

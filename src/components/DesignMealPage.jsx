import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { NUTRIENTS } from '../utils/nutrition';
import { fetchNutritionForIngredient } from '../utils/nutrition';
import { loadIngredients, loadIngredientsFromFirestore } from '../utils/ingredientsStore';
import { saveField } from '../utils/firestoreSync';
import { parseIngredientLine } from '../utils/parseRecipeText';
import {
  MACRO_KEYS, NUTRIENT_OPS,
  loadMealGoals, saveMealGoals, activeProfile, emptyProfile, newNutrientGoal,
  profileFromDailyGoals, profileHasGoals, numOrNull, parseQty,
  BOOLEAN_OPS, PRESENCE_KEYS,
  makeRow, totalsForRows, evaluateMeal, suggestFixes, candidatesFromIngredientsDb,
  formatAmount, formatQty, nutrientLabel, nutrientUnit,
} from '../utils/mealGoals';
import styles from './DesignMealPage.module.css';

const UNIT_CHOICES = [
  'g', 'oz', 'lb', 'ml', 'cup', 'tbsp', 'tsp', 'fl oz',
  'each', 'whole', 'slice', 'piece', 'clove', 'can', 'stick',
  'small', 'medium', 'large',
];

// Nutrients offered in the "add a target" picker, most-used first. Everything
// the app tracks stays reachable underneath.
const COMMON_GOAL_KEYS = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium', 'sugar', 'addedSugar',
  'saturatedFat', 'cholesterol', 'potassium', 'calcium', 'iron', 'magnesium',
  'vitaminC', 'vitaminD', 'vegServings', 'fruitServings',
];

const STATUS_LABEL = { pass: 'on target', over: 'over', under: 'under', unknown: 'no data' };

function statusClass(status) {
  if (status === 'pass') return styles.statusPass;
  if (status === 'over') return styles.statusOver;
  if (status === 'under') return styles.statusUnder;
  return styles.statusUnknown;
}

// ── the goal bar ───────────────────────────────────────────────────────────
// A track with the accepted range shaded and a marker where the meal sits, so
// "outside the range" reads at a glance instead of from two numbers.
function GoalBar({ result }) {
  const { kind, actual, min, max, status, boolean } = result;
  // A yes/no goal has no scale to plot on — a full or empty track reads as
  // the answer, which is all there is to say.
  if (boolean) {
    return (
      <div className={styles.bar}>
        {actual > 0 && <div className={`${styles.barFill} ${statusClass(status)}`} />}
      </div>
    );
  }
  const domain = kind === 'macro'
    ? 100
    : Math.max(actual, max ?? 0, min ?? 0, 1) * 1.2;
  const pos = (v) => `${Math.max(0, Math.min(100, (v / domain) * 100))}%`;
  const bandStart = min ?? 0;
  const bandEnd = max ?? domain;
  return (
    <div className={styles.bar}>
      <div
        className={styles.barBand}
        style={{ left: pos(bandStart), right: `${100 - parseFloat(pos(bandEnd))}%` }}
      />
      <div
        className={`${styles.barMarker} ${statusClass(status)}`}
        style={{ left: pos(actual) }}
      />
    </div>
  );
}

function targetText(result) {
  const { kind, key, min, max, boolean, op } = result;
  if (boolean) return op === 'has' ? 'must include' : 'must avoid';
  const fmt = (v) => (kind === 'macro' ? `${v}%` : formatAmount(v, key));
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return `at least ${fmt(min)}`;
  return `at most ${fmt(max)}`;
}

function actualText(result) {
  // A yes/no goal answers its own question. The amount behind the answer is
  // still worth showing once there is one — "Yes (1.5)" says how much.
  if (result.boolean) {
    const present = result.actual > 0;
    if (!present) return 'No';
    const rounded = Math.round(result.actual * 10) / 10;
    return rounded >= 0.1 ? `Yes (${rounded})` : 'Yes';
  }
  return result.kind === 'macro'
    ? `${Math.round(result.actual)}%`
    : formatAmount(result.actual, result.key);
}

function ScorePanel({ evaluation, servings, totals }) {
  const { results, macro } = evaluation;
  const cal = Math.round(Number(totals.calories) || 0);
  return (
    <div className={styles.scorePanel}>
      <div className={styles.scoreSummary}>
        <span className={styles.scoreCal}>{cal} cal</span>
        <span className={styles.scoreSplit}>
          {MACRO_KEYS.map(k => (
            <span key={k} className={styles.scoreSplitItem}>
              {Math.round(macro.grams[k])}g {nutrientLabel(k).toLowerCase()}
              <span className={styles.scoreSplitPct}>{Math.round(macro.pct[k])}%</span>
            </span>
          ))}
        </span>
        <span className={styles.scorePer}>per serving · makes {servings}</span>
      </div>
      {results.length === 0 ? (
        <p className={styles.emptyNote}>No goals set yet — add a macro range or a nutrient target above.</p>
      ) : (
        <div className={styles.goalGrid}>
          {results.map(r => (
            <div key={r.id} className={styles.goalScoreRow}>
              <span className={styles.goalScoreLabel}>
                {r.label}
                {r.kind === 'macro' && <span className={styles.goalScoreSub}>% of calories</span>}
              </span>
              <GoalBar result={r} />
              <span className={styles.goalScoreActual}>{actualText(r)}</span>
              <span className={styles.goalScoreTarget}>{targetText(r)}</span>
              <span className={`${styles.goalScoreStatus} ${statusClass(r.status)}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── goals editor ───────────────────────────────────────────────────────────

function GoalsEditor({ store, setStore, profile, dailyGoals }) {
  const [renaming, setRenaming] = useState(false);

  function updateProfile(mutate) {
    setStore(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === profile.id ? mutate({ ...p }) : p)),
    }));
  }

  function setMacro(key, field, value) {
    updateProfile(p => {
      const current = p.macros?.[key] || { min: null, max: null };
      const next = { ...current, [field]: numOrNull(value) };
      const cleared = next.min === null && next.max === null;
      p.macros = { ...p.macros, [key]: cleared ? null : next };
      return p;
    });
  }

  function toggleMacro(key, on) {
    updateProfile(p => {
      p.macros = { ...p.macros, [key]: on ? { min: 20, max: 40 } : null };
      return p;
    });
  }

  function setGoalField(id, field, value) {
    updateProfile(p => {
      p.nutrients = p.nutrients.map(n => {
        if (n.id !== id) return n;
        if (field === 'op') return { ...n, op: value };
        if (field === 'key') {
          // Picking "Fermented Foods" almost always means asking a yes/no
          // question, and picking Protein almost never does. Move the operator
          // to the sensible default for the new key; the user can change it.
          const wasBoolean = BOOLEAN_OPS.has(n.op);
          const nowPresence = PRESENCE_KEYS.includes(value);
          let op = n.op;
          if (nowPresence && !wasBoolean) op = 'has';
          else if (!nowPresence && wasBoolean) op = 'atLeast';
          return { ...n, key: value, op };
        }
        return { ...n, [field]: numOrNull(value) };
      });
      return p;
    });
  }

  function addGoal() {
    updateProfile(p => {
      p.nutrients = [...p.nutrients, newNutrientGoal()];
      return p;
    });
  }

  function removeGoal(id) {
    updateProfile(p => {
      p.nutrients = p.nutrients.filter(n => n.id !== id);
      return p;
    });
  }

  function addProfile(seeded) {
    const p = seeded || emptyProfile(`Goals ${store.profiles.length + 1}`);
    setStore(prev => ({ profiles: [...prev.profiles, p], activeId: p.id }));
  }

  function duplicateProfile() {
    const copy = { ...profile, id: `${profile.id}-copy-${Date.now().toString(36)}`, name: `${profile.name} copy` };
    setStore(prev => ({ profiles: [...prev.profiles, copy], activeId: copy.id }));
  }

  function deleteProfile() {
    if (store.profiles.length <= 1) return;
    if (!window.confirm(`Delete the goal set "${profile.name}"?`)) return;
    setStore(prev => {
      const profiles = prev.profiles.filter(p => p.id !== profile.id);
      return { profiles, activeId: profiles[0].id };
    });
  }

  if (!profile) return null;

  return (
    <section className={styles.card}>
      <div className={styles.profileBar}>
        <span className={styles.cardLabel}>Goals</span>
        {renaming ? (
          <input
            className={styles.profileNameInput}
            value={profile.name}
            autoFocus
            onChange={e => updateProfile(p => { p.name = e.target.value; return p; })}
            onBlur={() => setRenaming(false)}
            onKeyDown={e => { if (e.key === 'Enter') setRenaming(false); }}
          />
        ) : (
          <select
            className={styles.profileSelect}
            value={profile.id}
            onChange={e => setStore(prev => ({ ...prev, activeId: e.target.value }))}
          >
            {store.profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <div className={styles.profileActions}>
          <button type="button" className={styles.linkBtn} onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className={styles.linkBtn} onClick={() => addProfile()}>New</button>
          <button type="button" className={styles.linkBtn} onClick={duplicateProfile}>Duplicate</button>
          {dailyGoals && Object.keys(dailyGoals).length > 0 && (
            <button
              type="button"
              className={styles.linkBtn}
              title="Build a goal set from your daily nutrition goals, split three ways"
              onClick={() => addProfile(profileFromDailyGoals(dailyGoals))}
            >
              From daily goals
            </button>
          )}
          {store.profiles.length > 1 && (
            <button type="button" className={`${styles.linkBtn} ${styles.linkDanger}`} onClick={deleteProfile}>Delete</button>
          )}
        </div>
      </div>

      <div className={styles.goalSection}>
        <h3 className={styles.goalSectionTitle}>
          Macro split
          <span className={styles.goalSectionHint}>as a % of the meal&apos;s calories</span>
        </h3>
        {MACRO_KEYS.map(key => {
          const range = profile.macros?.[key];
          return (
            <div key={key} className={styles.macroRow}>
              <label className={styles.macroToggle}>
                <input
                  type="checkbox"
                  checked={!!range}
                  onChange={e => toggleMacro(key, e.target.checked)}
                />
                {nutrientLabel(key)}
              </label>
              {range ? (
                <div className={styles.rangeInputs}>
                  <input
                    type="number" min="0" max="100" inputMode="decimal"
                    className={styles.numInput}
                    value={range.min ?? ''}
                    placeholder="min"
                    onChange={e => setMacro(key, 'min', e.target.value)}
                  />
                  <span className={styles.rangeDash}>–</span>
                  <input
                    type="number" min="0" max="100" inputMode="decimal"
                    className={styles.numInput}
                    value={range.max ?? ''}
                    placeholder="max"
                    onChange={e => setMacro(key, 'max', e.target.value)}
                  />
                  <span className={styles.unitTag}>%</span>
                </div>
              ) : (
                <span className={styles.macroOff}>not tracked</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.goalSection}>
        <h3 className={styles.goalSectionTitle}>
          Nutrient targets
          <span className={styles.goalSectionHint}>per serving</span>
        </h3>
        {profile.nutrients.length === 0 && (
          <p className={styles.emptyNote}>No nutrient targets yet.</p>
        )}
        {profile.nutrients.map(goal => (
          <div key={goal.id} className={styles.goalEditRow}>
            <select
              className={styles.goalKeySelect}
              value={goal.key}
              onChange={e => setGoalField(goal.id, 'key', e.target.value)}
            >
              <optgroup label="Yes / no">
                {PRESENCE_KEYS.map(k => (
                  <option key={k} value={k}>{nutrientLabel(k)}</option>
                ))}
              </optgroup>
              <optgroup label="Common">
                {COMMON_GOAL_KEYS.map(k => (
                  <option key={k} value={k}>{nutrientLabel(k)}</option>
                ))}
              </optgroup>
              <optgroup label="Everything else">
                {NUTRIENTS.filter(n => !COMMON_GOAL_KEYS.includes(n.key) && !PRESENCE_KEYS.includes(n.key)).map(n => (
                  <option key={n.key} value={n.key}>{n.label}</option>
                ))}
              </optgroup>
            </select>
            <select
              className={styles.goalOpSelect}
              value={goal.op}
              onChange={e => setGoalField(goal.id, 'op', e.target.value)}
            >
              {NUTRIENT_OPS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            {/* A yes/no goal has no amount to type — the operator is the goal. */}
            {!BOOLEAN_OPS.has(goal.op) && (
              <>
                {goal.op !== 'atMost' && (
                  <input
                    type="number" min="0" inputMode="decimal"
                    className={styles.numInput}
                    value={goal.min ?? ''}
                    placeholder={goal.op === 'between' ? 'min' : 'amount'}
                    onChange={e => setGoalField(goal.id, 'min', e.target.value)}
                  />
                )}
                {goal.op === 'between' && <span className={styles.rangeDash}>–</span>}
                {goal.op !== 'atLeast' && (
                  <input
                    type="number" min="0" inputMode="decimal"
                    className={styles.numInput}
                    value={goal.max ?? ''}
                    placeholder={goal.op === 'between' ? 'max' : 'amount'}
                    onChange={e => setGoalField(goal.id, 'max', e.target.value)}
                  />
                )}
                <span className={styles.unitTag}>
                  {nutrientUnit(goal.key) || (goal.key === 'calories' ? 'cal' : 'servings')}
                </span>
              </>
            )}
            {BOOLEAN_OPS.has(goal.op) && (
              <span className={styles.presenceHint}>
                {goal.key === 'fermentedServings'
                  ? 'read from ingredient names'
                  : 'salmon, sardines, chia, flax, walnuts…'}
              </span>
            )}
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove the ${nutrientLabel(goal.key)} target`}
              onClick={() => removeGoal(goal.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className={styles.addGoalBtn} onClick={addGoal}>+ Add a target</button>
      </div>
    </section>
  );
}

// ── meal picker ────────────────────────────────────────────────────────────

function MealPicker({ recipes, onPick, onScratch }) {
  const [query, setQuery] = useState('');
  const withIngredients = useMemo(
    () => (recipes || []).filter(r => (r.ingredients || []).some(i => (i.ingredient || '').trim())),
    [recipes],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? withIngredients.filter(r => (r.title || '').toLowerCase().includes(q))
      : withIngredients;
    return list.slice(0, 40);
  }, [withIngredients, query]);

  return (
    <section className={styles.card}>
      <div className={styles.pickerHead}>
        <span className={styles.cardLabel}>Pull in a meal</span>
        <button type="button" className={styles.linkBtn} onClick={onScratch}>Start from scratch</button>
      </div>
      <input
        className={styles.searchInput}
        placeholder="Search your recipes…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {matches.length === 0 ? (
        <p className={styles.emptyNote}>
          {withIngredients.length === 0
            ? 'No recipes with ingredients yet — start from scratch instead.'
            : 'No recipes match that search.'}
        </p>
      ) : (
        <ul className={styles.recipeList}>
          {matches.map(r => (
            <li key={r.id}>
              <button type="button" className={styles.recipeBtn} onClick={() => onPick(r)}>
                <span className={styles.recipeTitle}>{r.title || 'Untitled'}</span>
                <span className={styles.recipeMeta}>
                  {(r.ingredients || []).filter(i => (i.ingredient || '').trim()).length} ingredients
                  {r.servings ? ` · serves ${r.servings}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── suggestions ────────────────────────────────────────────────────────────

function changeText(fix) {
  const unit = fix.measurement ? ` ${fix.measurement}` : '';
  if (fix.type === 'remove') return `Remove ${fix.name}`;
  if (fix.type === 'add') {
    return `Add ${formatQty(fix.toQty)}${unit} ${fix.name}${fix.grams ? ` (${fix.grams}g)` : ''}`;
  }
  const verb = fix.type === 'reduce' ? 'Cut' : 'Raise';
  return `${verb} ${fix.name} ${formatQty(fix.fromQty)}${unit} → ${formatQty(fix.toQty)}${unit}`;
}

function SuggestionList({ fixes, evaluation, onApply, onAutoFix, busy }) {
  const failing = evaluation.failing.filter(r => r.status !== 'unknown');
  if (failing.length === 0) {
    return (
      <section className={styles.card}>
        <span className={styles.cardLabel}>Suggestions</span>
        <p className={styles.allGood}>This meal is inside every goal. Nothing to change.</p>
      </section>
    );
  }

  const anyCleanFix = fixes.some(f => f.broke.length === 0 && f.projected?.status === 'pass');

  return (
    <section className={styles.card}>
      <div className={styles.pickerHead}>
        <span className={styles.cardLabel}>Suggestions</span>
        {anyCleanFix && (
          <button type="button" className={styles.autoFixBtn} onClick={onAutoFix} disabled={busy}>
            Auto-fix what it can
          </button>
        )}
      </div>
      {failing.map(goal => {
        const forGoal = fixes.filter(f => f.goalId === goal.id);
        return (
          <div key={goal.id} className={styles.fixGroup}>
            <h4 className={styles.fixGoalTitle}>
              <span className={statusClass(goal.status)}>
                {goal.label} {actualText(goal)}
              </span>
              <span className={styles.fixGoalTarget}>
                {goal.status === 'over' ? 'over' : 'under'} {targetText(goal)}
              </span>
            </h4>
            {forGoal.length === 0 ? (
              <p className={styles.emptyNote}>
                No amount change in this meal can reach that target — the goal needs a different
                ingredient, or a looser range.
              </p>
            ) : forGoal.map(fix => (
              <div key={fix.id} className={styles.fixRow}>
                <div className={styles.fixMain}>
                  <span className={styles.fixChange}>{changeText(fix)}</span>
                  <span className={styles.fixProjection}>
                    → {fix.goalLabel} {actualText(fix.projected)}
                    <span className={statusClass(fix.projected.status)}>
                      {fix.projected.status === 'pass' ? ' ✓' : ` still ${STATUS_LABEL[fix.projected.status]}`}
                    </span>
                  </span>
                  {fix.alsoFixed.length > 0 && (
                    <span className={styles.fixAlso}>
                      also fixes {fix.alsoFixed.map(g => g.label).join(', ')}
                    </span>
                  )}
                  {fix.broke.length > 0 && (
                    <span className={styles.fixWarn}>
                      ⚠ would push {fix.broke.map(g => `${g.label} ${actualText(g)}`).join(', ')} outside
                    </span>
                  )}
                </div>
                <button type="button" className={styles.applyBtn} onClick={() => onApply(fix)} disabled={busy}>
                  Apply
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ── AI ideas ───────────────────────────────────────────────────────────────

function AiIdeas({ meal, rows, servings, evaluation, onAdd }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  async function ask() {
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await fetch('/api/suggest-meal-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meal?.title || 'this meal',
          servings,
          ingredients: rows
            .filter(r => !r.disabled)
            .map(r => ({
              ingredient: r.ingredient,
              quantity: formatQty(r.quantity),
              measurement: r.measurement,
            })),
          goals: evaluation.results.map(r => ({
            label: r.label,
            unit: r.unit,
            actual: Math.round(r.actual * 10) / 10,
            min: r.min,
            max: r.max,
            status: r.status,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setState({ status: 'done', data, error: null });
    } catch (err) {
      setState({ status: 'error', data: null, error: err.message || 'Could not get ideas' });
    }
  }

  const ideas = state.data;
  const rendered = [
    ...(ideas?.swaps || []).map(s => ({
      kind: 'Swap',
      text: `${s.remove} → ${s.amount ? `${s.amount} ` : ''}${s.add}`,
      reason: s.reason,
      add: s.add ? `${s.amount || ''} ${s.add}`.trim() : null,
    })),
    ...(ideas?.additions || []).map(a => ({
      kind: 'Add',
      text: `${a.amount ? `${a.amount} ` : ''}${a.ingredient}`,
      reason: a.reason,
      add: a.ingredient ? `${a.amount || ''} ${a.ingredient}`.trim() : null,
    })),
    ...(ideas?.removals || []).map(r => ({
      kind: 'Drop',
      text: r.ingredient,
      reason: r.reason,
      add: null,
    })),
  ];

  return (
    <section className={styles.card}>
      <div className={styles.pickerHead}>
        <span className={styles.cardLabel}>Ideas</span>
        <button type="button" className={styles.linkBtn} onClick={ask} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Thinking…' : ideas ? 'Ask again' : 'Ask for swap ideas'}
        </button>
      </div>
      <p className={styles.aiHint}>
        The suggestions above are computed from your nutrition data. This asks for ingredient
        swaps the arithmetic can&apos;t see — trading sour cream for Greek yogurt, say.
      </p>
      {state.status === 'error' && <p className={styles.error}>{state.error}</p>}
      {rendered.length > 0 && (
        <div className={styles.ideaList}>
          {rendered.map((idea, i) => (
            <div key={i} className={styles.ideaRow}>
              <span className={styles.ideaKind}>{idea.kind}</span>
              <span className={styles.ideaText}>
                {idea.text}
                {idea.reason && <span className={styles.ideaReason}>{idea.reason}</span>}
              </span>
              {idea.add && (
                <button type="button" className={styles.applyBtn} onClick={() => onAdd(idea.add)}>
                  Add &amp; score
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {(ideas?.notes || []).map((note, i) => (
        <p key={i} className={styles.aiNote}>{note}</p>
      ))}
    </section>
  );
}

// ── the page ───────────────────────────────────────────────────────────────

export function DesignMealPage({ recipes, savedGoals, onBack, onSelect, onUpdateRecipe, user }) {
  const [store, setStore] = useState(() => loadMealGoals());
  const [meal, setMeal] = useState(null);           // { recipeId, title, servings }
  const [rows, setRows] = useState([]);
  // The meal exactly as it was pulled in, so Reset can restore both the
  // amounts and the servings the recipe was written for.
  const [baseline, setBaseline] = useState([]);
  const [baseServings, setBaseServings] = useState(1);
  const [status, setStatus] = useState('idle');      // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [dbRows, setDbRows] = useState(() => {
    const stored = loadIngredients();
    return Array.isArray(stored) ? stored : [];
  });
  const [addDraft, setAddDraft] = useState({ ingredient: '', quantity: '', measurement: 'g' });
  const [addBusy, setAddBusy] = useState(false);
  const [saveNote, setSaveNote] = useState(null);
  const requestRef = useRef(0);
  const storedJsonRef = useRef(null);
  const syncTimerRef = useRef(null);

  const profile = activeProfile(store);
  const servings = Math.max(1, Number(meal?.servings) || 1);

  // Goals persist locally straight away and to Firestore on a delay — editing a
  // min/max field changes the store on every keystroke, and each of those is
  // not worth a write.
  useEffect(() => {
    const json = JSON.stringify(store);
    if (storedJsonRef.current === null) {
      // First render: the store was just loaded (and normalised). Writing it
      // back locally is fine; pushing it to Firestore on every page visit
      // is not.
      storedJsonRef.current = json;
      saveMealGoals(store);
      return undefined;
    }
    if (json === storedJsonRef.current) return undefined;
    storedJsonRef.current = json;
    saveMealGoals(store);
    if (!user?.uid) return undefined;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      saveField(user.uid, 'mealGoals', store).catch(() => { /* stays local */ });
    }, 1200);
    return () => clearTimeout(syncTimerRef.current);
  }, [store, user?.uid]);

  // The ingredients DB is the pool for "add this ingredient" suggestions. It
  // may not be in localStorage yet on a fresh device.
  useEffect(() => {
    if (dbRows.length > 0) return;
    let cancelled = false;
    loadIngredientsFromFirestore()
      .then(data => { if (!cancelled && Array.isArray(data)) setDbRows(data); })
      .catch(() => { /* candidates stay empty; amount changes still work */ });
    return () => { cancelled = true; };
  }, [dbRows.length]);

  const candidates = useMemo(() => candidatesFromIngredientsDb(dbRows), [dbRows]);
  const dbNames = useMemo(
    () => dbRows.map(r => (r.ingredient || '').trim()).filter(Boolean).slice(0, 400),
    [dbRows],
  );

  const totals = useMemo(() => totalsForRows(rows, servings), [rows, servings]);
  const evaluation = useMemo(() => evaluateMeal(profile, totals), [profile, totals]);
  const fixes = useMemo(() => {
    if (!profile || rows.length === 0) return [];
    return suggestFixes({ rows, servings, profile, candidates });
  }, [rows, servings, profile, candidates]);

  const dirty = useMemo(() => {
    if (servings !== baseServings) return true;
    if (rows.length !== baseline.length) return true;
    return rows.some((r, i) => r.quantity !== baseline[i]?.quantity || !!r.disabled !== !!baseline[i]?.disabled);
  }, [rows, baseline, servings, baseServings]);

  // ── pulling a meal in ──
  const lookupRows = useCallback(async (ingredients) => {
    const token = ++requestRef.current;
    setStatus('loading');
    setError(null);
    const usable = ingredients.filter(ing => (ing.ingredient || '').trim());
    // The lookup reads quantities with parseFloat, which turns "1/2" into 1.
    // Handing it the decimal keeps the grams it estimates and the amount this
    // page scales from in agreement.
    const decimals = usable.map(ing => parseQty(ing.quantity));
    const results = await Promise.all(
      usable.map((ing, i) => fetchNutritionForIngredient({
        ingredient: ing.ingredient,
        quantity: String(decimals[i]),
        measurement: ing.measurement,
      }).catch(() => null)),
    );
    if (token !== requestRef.current) return;   // a newer pull superseded this one
    // Index-aligned with `usable` on purpose: a failed lookup keeps its row so
    // the ingredient is still listed (and still saved), just not scored.
    const built = usable.map((ing, i) => ({
      ...makeRow({
        index: i,
        ingredient: ing.ingredient,
        quantity: decimals[i],
        measurement: ing.measurement,
        topping: ing.topping,
        lookup: results[i],
      }),
      origin: ing,
    }));
    setRows(built);
    setBaseline(built.map(r => ({ ...r })));
    setStatus('ready');
  }, []);

  function pickRecipe(recipe) {
    const recipeServings = Math.max(1, parseInt(recipe.servings, 10) || 1);
    setMeal({
      recipeId: recipe.id,
      title: recipe.title || 'Untitled',
      servings: recipeServings,
    });
    setBaseServings(recipeServings);
    setSaveNote(null);
    lookupRows(recipe.ingredients || []);
  }

  function startScratch() {
    setMeal({ recipeId: null, title: 'New meal', servings: 1 });
    setRows([]);
    setBaseline([]);
    setBaseServings(1);
    setStatus('ready');
    setSaveNote(null);
  }

  // ── editing the scratch copy ──
  function setRowQuantity(i, value) {
    const qty = value === '' ? 0 : Number(value);
    setRows(rs => rs.map((r, idx) => (
      idx === i ? { ...r, quantity: Number.isFinite(qty) && qty > 0 ? qty : 0, disabled: !(qty > 0) } : r
    )));
  }

  function toggleRow(i) {
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, disabled: !r.disabled } : r)));
  }

  function dropRow(i) {
    setRows(rs => rs.filter((_, idx) => idx !== i));
  }

  function applyFix(fix) {
    if (fix.type === 'add') {
      setRows(rs => [...rs, { ...fix.addRow, index: rs.length, origin: null }]);
      return;
    }
    setRows(rs => rs.map((r, i) => (
      i === fix.rowIndex ? { ...r, quantity: fix.toQty, disabled: fix.toQty <= 0 } : r
    )));
  }

  // Greedy repair: take the cleanest fix, re-solve against the new state, and
  // keep going. Only fixes with no collateral damage are applied automatically
  // — anything that trades one failure for another stays a manual decision.
  function autoFix() {
    let current = rows;
    for (let pass = 0; pass < 8; pass++) {
      const next = suggestFixes({ rows: current, servings, profile, candidates });
      const clean = next.find(f => f.broke.length === 0 && f.projected?.status === 'pass');
      if (!clean) break;
      current = clean.type === 'add'
        ? [...current, { ...clean.addRow, index: current.length, origin: null }]
        : current.map((r, i) => (i === clean.rowIndex ? { ...r, quantity: clean.toQty, disabled: clean.toQty <= 0 } : r));
    }
    setRows(current);
  }

  function resetRows() {
    setRows(baseline.map(r => ({ ...r })));
    setMeal(m => (m ? { ...m, servings: baseServings } : m));
    setSaveNote(null);
  }

  const addIngredient = useCallback(async (draft) => {
    const name = (draft.ingredient || '').trim();
    if (!name) return;
    setAddBusy(true);
    try {
      // Fractions arrive here from AI ideas ("1/2 cup yogurt"); normalise
      // before the lookup for the same reason as above.
      const qty = parseQty(draft.quantity || '1');
      const ing = {
        ingredient: name,
        quantity: String(qty),
        measurement: draft.measurement || '',
      };
      const lookup = await fetchNutritionForIngredient(ing).catch(() => null);
      setRows(rs => [...rs, {
        ...makeRow({ index: rs.length, ingredient: name, quantity: qty, measurement: ing.measurement, lookup }),
        added: true,
        origin: null,
      }]);
      setAddDraft({ ingredient: '', quantity: '', measurement: draft.measurement || 'g' });
    } finally {
      setAddBusy(false);
    }
  }, []);

  // An AI idea arrives as free text ("1/2 cup plain greek yogurt"); the recipe
  // parser already knows how to split that into amount, unit and name.
  function addFromText(text) {
    const parsed = parseIngredientLine(text);
    if (!parsed || !parsed.ingredient) return;
    addIngredient({
      ingredient: parsed.ingredient,
      quantity: parsed.quantity || '1',
      measurement: parsed.measurement || '',
    });
  }

  function saveToRecipe() {
    if (!meal?.recipeId || !onUpdateRecipe) return;
    const kept = rows.filter(r => !r.disabled);
    if (kept.length === 0) {
      setSaveNote({ kind: 'error', text: 'Nothing left to save — every ingredient is switched off.' });
      return;
    }
    const summary = `${kept.length} ingredient${kept.length === 1 ? '' : 's'}`;
    if (!window.confirm(`Overwrite "${meal.title}" with these amounts (${summary})? Ingredients you switched off will be removed from the recipe.`)) return;
    // Spread the original row first so anything else it carried (a topping
    // flag, a note) survives; only the amount is ours to overwrite.
    const ingredients = kept.map(r => ({
      ...(r.origin || {}),
      ingredient: r.ingredient,
      quantity: formatQty(r.quantity),
      measurement: r.measurement,
    }));
    const updates = { ingredients };
    // The amounts were solved against this serving count, so saving one
    // without the other would change what the recipe means.
    if (servings !== baseServings) updates.servings = String(servings);
    onUpdateRecipe(meal.recipeId, updates);
    setBaseline(rows.map(r => ({ ...r })));
    setBaseServings(servings);
    setSaveNote({ kind: 'ok', text: 'Saved to the recipe.' });
  }

  const noGoals = !profileHasGoals(profile);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onBack}>← Back</button>
        <h1 className={styles.title}>Design a Meal</h1>
        <span className={styles.subtitle}>Set goals for a meal, then bend a recipe to fit them.</span>
      </div>

      <GoalsEditor store={store} setStore={setStore} profile={profile} dailyGoals={savedGoals} />

      {!meal ? (
        <MealPicker recipes={recipes} onPick={pickRecipe} onScratch={startScratch} />
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.mealHead}>
              <div>
                <span className={styles.cardLabel}>Meal</span>
                <h2 className={styles.mealTitle}>{meal.title}</h2>
              </div>
              <div className={styles.mealActions}>
                <label className={styles.servingsLabel}>
                  Serves
                  <input
                    type="number" min="1" className={styles.servingsInput}
                    value={meal.servings}
                    onChange={e => setMeal(m => ({ ...m, servings: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                  />
                </label>
                {meal.recipeId && onSelect && (
                  <button type="button" className={styles.linkBtn} onClick={() => onSelect(meal.recipeId)}>View recipe</button>
                )}
                <button type="button" className={styles.linkBtn} onClick={() => { setMeal(null); setRows([]); setBaseline([]); setStatus('idle'); }}>
                  Change meal
                </button>
              </div>
            </div>

            {status === 'loading' && <p className={styles.loading}>Looking up ingredients…</p>}
            {error && <p className={styles.error}>{error}</p>}

            {status === 'ready' && (
              <>
                {noGoals ? (
                  <p className={styles.emptyNote}>Set at least one goal above to score this meal.</p>
                ) : (
                  <ScorePanel evaluation={evaluation} servings={servings} totals={totals} />
                )}

                <div className={styles.rowsHead}>
                  <span className={styles.cardLabel}>Amounts</span>
                  <div className={styles.rowsActions}>
                    {dirty && <span className={styles.dirtyTag}>edited</span>}
                    {dirty && <button type="button" className={styles.linkBtn} onClick={resetRows}>Reset</button>}
                    {meal.recipeId && onUpdateRecipe && (
                      <button
                        type="button"
                        className={styles.saveBtn}
                        onClick={saveToRecipe}
                        disabled={!dirty}
                      >
                        Save amounts to recipe
                      </button>
                    )}
                  </div>
                </div>
                {saveNote && (
                  <p className={saveNote.kind === 'ok' ? styles.savedNote : styles.error}>{saveNote.text}</p>
                )}

                {rows.length === 0 ? (
                  <p className={styles.emptyNote}>No ingredients yet — add one below.</p>
                ) : (
                  <ul className={styles.rowList}>
                    {rows.map((row, i) => {
                      const cal = Math.round((row.nutrients?.calories || 0)
                        * (row.quantity / (row.baseQty || 1))
                        / (row.topping ? 1 : servings));
                      return (
                        <li key={`${row.ingredient}-${i}`} className={`${styles.ingRow} ${row.disabled ? styles.ingRowOff : ''}`}>
                          <div className={styles.ingName}>
                            <span>{row.ingredient}</span>
                            <span className={styles.ingMeta}>
                              {row.nutrients
                                ? `${cal} cal/serving${row.topping ? ' · per meal' : ''}${row.added ? ' · added' : ''}`
                                : 'no nutrition data — not scored'}
                            </span>
                          </div>
                          <div className={styles.ingAmount}>
                            <input
                              type="number" min="0" step="any" inputMode="decimal"
                              className={styles.qtyInput}
                              value={row.disabled && row.quantity === 0 ? '' : row.quantity}
                              onChange={e => setRowQuantity(i, e.target.value)}
                            />
                            <span className={styles.ingUnit}>{row.measurement}</span>
                            <input
                              type="range"
                              className={styles.slider}
                              min="0"
                              max={Math.max(row.baseQty * 2, row.quantity * 1.5, 1)}
                              step={row.baseQty > 4 ? 1 : 0.05}
                              value={row.quantity}
                              onChange={e => setRowQuantity(i, e.target.value)}
                              aria-label={`Amount of ${row.ingredient}`}
                            />
                            <button
                              type="button"
                              className={styles.rowToggle}
                              onClick={() => toggleRow(i)}
                              title={row.disabled ? 'Put this ingredient back' : 'Leave this ingredient out'}
                            >
                              {row.disabled ? 'Restore' : 'Leave out'}
                            </button>
                            {row.added && (
                              <button type="button" className={styles.removeBtn} onClick={() => dropRow(i)} aria-label={`Delete ${row.ingredient}`}>×</button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <form
                  className={styles.addRow}
                  onSubmit={e => { e.preventDefault(); addIngredient(addDraft); }}
                >
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    className={styles.qtyInput}
                    placeholder="1"
                    value={addDraft.quantity}
                    onChange={e => setAddDraft(d => ({ ...d, quantity: e.target.value }))}
                  />
                  <input
                    className={styles.unitInput}
                    list="design-meal-units"
                    placeholder="unit"
                    value={addDraft.measurement}
                    onChange={e => setAddDraft(d => ({ ...d, measurement: e.target.value }))}
                  />
                  <datalist id="design-meal-units">
                    {UNIT_CHOICES.map(u => <option key={u} value={u} />)}
                  </datalist>
                  <input
                    className={styles.addNameInput}
                    list="design-meal-ingredients"
                    placeholder="Add an ingredient…"
                    value={addDraft.ingredient}
                    onChange={e => setAddDraft(d => ({ ...d, ingredient: e.target.value }))}
                  />
                  <datalist id="design-meal-ingredients">
                    {dbNames.map(n => <option key={n} value={n} />)}
                  </datalist>
                  <button type="submit" className={styles.applyBtn} disabled={addBusy || !addDraft.ingredient.trim()}>
                    {addBusy ? 'Looking up…' : 'Add'}
                  </button>
                </form>
              </>
            )}
          </section>

          {status === 'ready' && !noGoals && rows.length > 0 && (
            <>
              <SuggestionList
                fixes={fixes}
                evaluation={evaluation}
                onApply={applyFix}
                onAutoFix={autoFix}
                busy={addBusy}
              />
              <AiIdeas
                meal={meal}
                rows={rows}
                servings={servings}
                evaluation={evaluation}
                onAdd={addFromText}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

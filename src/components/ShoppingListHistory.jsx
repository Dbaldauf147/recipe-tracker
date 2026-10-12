import { useMemo, useState } from 'react';
import { shoppingListWeeks, lastShoppingListExtras } from '../utils/shoppingHistory';
import { todayKey } from '../utils/localDate';
import { eatenKey } from '../utils/eatenMatch';
import styles from './ShoppingListHistory.module.css';

const WEEKS_PER_PAGE = 12;

// Food-word keys of everything on the Shopping List's Snacks and Fruit widgets
// — only those are auto-added, so only those are "skipped this week".
function trackedSnackFruitKeys() {
  const keys = new Set();
  for (const k of ['sunday-pantry-snacks', 'sunday-pantry-fruit']) {
    try {
      for (const item of JSON.parse(localStorage.getItem(k) || '[]')) {
        const key = eatenKey(item?.ingredient || '');
        if (key) keys.add(key);
      }
    } catch { /* ignore */ }
  }
  return keys;
}

function readDailyLog() {
  try { return JSON.parse(localStorage.getItem('sunday-daily-log') || '{}') || {}; } catch { return {}; }
}

const KIND_BADGE = {
  auto: { label: 'Auto-saved', title: 'Saved automatically — a meal from it was logged, or it sat on the list 3+ days' },
  rebuilt: { label: 'From logged meals', title: 'No list was saved this week; these are the meals logged that week. Added items weren’t recorded.' },
};

function longDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Meal History → Shopping Lists: every list saved by "Reset Shopping List" or
 * auto-saved (utils/shoppingListAutoSave.js), plus weeks rebuilt from logged meals,
 * newest first, with all of its ingredients. The newest one (if it's from the
 * last two weeks) is what the Shopping List checks before auto-adding a snack
 * or fruit, so its added items are marked as skipped this week.
 */
export function ShoppingListHistory({ entries, getRecipe }) {
  const weeks = useMemo(
    () => shoppingListWeeks(entries, getRecipe, { dailyLog: readDailyLog(), today: todayKey() }),
    [entries, getRecipe],
  );
  const lastIdx = weeks.findIndex(w => w.kind !== 'rebuilt');
  // Last list's snacks/fruit — what this week's auto-add leaves out.
  const skipped = useMemo(() => {
    const tracked = trackedSnackFruitKeys();
    return new Set(lastShoppingListExtras(entries, todayKey())
      .filter(n => tracked.has(eatenKey(n)))
      .map(n => n.toLowerCase()));
  }, [entries]);
  const [open, setOpen] = useState(() => new Set(weeks[0] ? [weeks[0].timestamp] : []));
  const [limit, setLimit] = useState(WEEKS_PER_PAGE);
  const toggle = key => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (weeks.length === 0) {
    return (
      <p className={styles.empty}>
        No saved shopping lists yet. A list is saved when you press <strong>Reset Shopping List</strong>,
        or on its own once a meal from it is logged or it has been on the list for 3 days.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Every list saved by <strong>Reset Shopping List</strong> or automatically (a meal from it was logged,
        or it sat on the list 3 days); weeks with no saved list are rebuilt from the meals you logged.
        ✓ marks meals you logged while that list was current. The weekly snack and fruit are picked
        from items that were <em>not</em> on the most recent list, so neither repeats two weeks in a row.
      </p>
      {weeks.slice(0, limit).map((w, i) => {
        const isOpen = open.has(w.timestamp);
        const isLast = i === lastIdx && lastShoppingListExtras(entries, todayKey()).length > 0;
        const count = w.ingredients.length + w.extras.length;
        return (
          <section key={w.timestamp} className={styles.week}>
            <button type="button" className={styles.weekHead} aria-expanded={isOpen} onClick={() => toggle(w.timestamp)}>
              <span className={styles.caret} aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              <span className={styles.weekDate}>{longDate(w.date)}</span>
              {isLast && <span className={styles.lastBadge}>Last list</span>}
              {KIND_BADGE[w.kind] && <span className={styles.kindBadge} title={KIND_BADGE[w.kind].title}>{KIND_BADGE[w.kind].label}</span>}
              <span className={styles.weekMeta}>
                {w.recipes.length} meal{w.recipes.length === 1 ? '' : 's'} · {count} item{count === 1 ? '' : 's'}
              </span>
            </button>
            {isOpen && (
              <div className={styles.weekBody}>
                {w.extras.length > 0 && (
                  <div className={styles.group}>
                    <h4 className={styles.groupTitle}>Added items · snacks, fruit and extras</h4>
                    <ul className={styles.chips}>
                      {w.extras.map(n => {
                        const skip = isLast && skipped.has(n.toLowerCase());
                        return (
                          <li key={n} className={skip ? styles.chipSkip : styles.chip} title={skip ? 'On the last list — not auto-added this week' : undefined}>
                            {n}{skip && <span className={styles.skipNote}> · skipped this week</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {w.recipes.length > 0 && (
                  <div className={styles.group}>
                    <h4 className={styles.groupTitle}>Meals</h4>
                    <ul className={styles.mealList}>
                      {w.recipes.map(r => (
                        <li key={r.id} className={r.logged ? styles.mealLogged : styles.mealNotLogged}
                          title={r.logged ? `Logged on ${r.logged} day${r.logged === 1 ? '' : 's'}` : 'Not logged while this list was current'}>
                          {r.logged ? '✓ ' : ''}{r.title || 'Deleted recipe'}
                          {r.logged > 1 && <span className={styles.count}> ×{r.logged}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {w.ingredients.length > 0 && (
                  <div className={styles.group}>
                    <h4 className={styles.groupTitle}>Ingredients from those meals · {w.ingredients.length}</h4>
                    <ul className={styles.ingredients}>
                      {w.ingredients.map(ing => (
                        <li key={ing.name}>
                          {ing.name}
                          {ing.count > 1 && <span className={styles.count}> ×{ing.count}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {w.extras.length === 0 && w.ingredients.length === 0 && (
                  <p className={styles.emptyWeek}>Nothing recorded for this list.</p>
                )}
              </div>
            )}
          </section>
        );
      })}
      {weeks.length > limit && (
        <button type="button" className={styles.more} onClick={() => setLimit(l => l + WEEKS_PER_PAGE)}>
          Show {Math.min(WEEKS_PER_PAGE, weeks.length - limit)} more
        </button>
      )}
    </div>
  );
}

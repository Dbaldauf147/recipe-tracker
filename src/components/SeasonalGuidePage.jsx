import { useMemo, useState, useEffect } from 'react';
import SEASONAL_DATA from '../data/seasonalIngredients.js';
import { locationToRegion } from '../utils/seasonal';
import { lookupSeasonalData, loadSeasonalCache } from '../utils/seasonalCache';
import styles from './SeasonalGuidePage.module.css';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const REGIONS = [
  { key: 'northeast', label: 'Northeast' },
  { key: 'southeast', label: 'Southeast' },
  { key: 'midwest', label: 'Midwest' },
  { key: 'southwest', label: 'Southwest' },
  { key: 'west_coast', label: 'West Coast' },
  { key: 'pacific_northwest', label: 'Pacific Northwest' },
];

function capitalize(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

export function SeasonalGuidePage({ onClose }) {
  const [filterMonth, setFilterMonth] = useState(0); // 0 = all, 1-12 = specific month
  const [lookupValue, setLookupValue] = useState('');
  const [lookupResults, setLookupResults] = useState({}); // { name: months[] }
  const [lookupLoading, setLookupLoading] = useState(false);
  const [cachedData, setCachedData] = useState({}); // from Firestore cache

  const defaultRegion = useMemo(() => {
    try {
      const location = localStorage.getItem('sunday-seasonal-location') || '';
      return locationToRegion(location);
    } catch {
      return null;
    }
  }, []);

  const [region, setRegion] = useState(defaultRegion || 'northeast');

  const currentMonth = new Date().getMonth() + 1;
  const regionData = region ? SEASONAL_DATA[region] : null;

  // Load cached AI lookups when region changes
  useEffect(() => {
    if (!region) return;
    setLookupResults({});
    loadSeasonalCache(region).then(data => {
      setCachedData(data || {});
    });
  }, [region]);

  // Combine static + cached data
  const allIngredients = useMemo(() => {
    const combined = {};
    // Static data first
    if (regionData) {
      for (const [name, months] of Object.entries(regionData)) {
        combined[name] = { months, source: 'static' };
      }
    }
    // Cached AI lookups (only those with actual season months)
    for (const [name, months] of Object.entries(cachedData)) {
      if (!combined[name] && Array.isArray(months) && months.length > 0) {
        combined[name] = { months, source: 'ai' };
      }
    }
    // Current session lookups
    for (const [name, months] of Object.entries(lookupResults)) {
      if (!combined[name] && Array.isArray(months) && months.length > 0) {
        combined[name] = { months, source: 'ai' };
      }
    }
    return combined;
  }, [regionData, cachedData, lookupResults]);

  const ingredients = useMemo(() => {
    return Object.entries(allIngredients)
      .map(([name, { months, source }]) => ({
        name,
        months,
        source,
        isCurrentlyInSeason: months.includes(currentMonth),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allIngredients, currentMonth]);

  const filtered = useMemo(() => {
    if (filterMonth === 0) return ingredients;
    return ingredients.filter(i => i.months.includes(filterMonth));
  }, [ingredients, filterMonth]);

  const inSeasonCount = ingredients.filter(i => i.isCurrentlyInSeason).length;

  async function handleLookup() {
    const raw = lookupValue.trim();
    if (!raw || !region) return;
    const names = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return;

    setLookupLoading(true);
    try {
      const result = await lookupSeasonalData(names, region);
      setLookupResults(prev => ({ ...prev, ...result }));
      // Refresh cached data
      const freshCache = await loadSeasonalCache(region);
      setCachedData(freshCache || {});
      setLookupValue('');
    } catch (err) {
      console.error('Lookup failed:', err);
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Seasonal Guide</h2>
        <select
          className={styles.regionSelect}
          value={region}
          onChange={e => setRegion(e.target.value)}
        >
          {REGIONS.map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <span className={styles.count}>
          {inSeasonCount} in season now
        </span>
      </div>

      <div className={styles.lookupRow}>
        <input
          className={styles.lookupInput}
          type="text"
          placeholder="Look up an ingredient (e.g. mango, salmon, basil)…"
          value={lookupValue}
          onChange={e => setLookupValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
          disabled={lookupLoading}
        />
        <button
          className={styles.lookupBtn}
          onClick={handleLookup}
          disabled={lookupLoading || !lookupValue.trim()}
        >
          {lookupLoading ? 'Looking up…' : 'Look Up'}
        </button>
      </div>

      <div className={styles.filterRow}>
        <button
          className={`${styles.monthBtn} ${filterMonth === 0 ? styles.monthBtnActive : ''}`}
          onClick={() => setFilterMonth(0)}
        >
          All
        </button>
        {MONTH_ABBR.map((m, i) => (
          <button
            key={i}
            className={`${styles.monthBtn} ${filterMonth === i + 1 ? styles.monthBtnActive : ''} ${i + 1 === currentMonth ? styles.monthBtnCurrent : ''}`}
            onClick={() => setFilterMonth(i + 1)}
          >
            {m}
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colName}>Ingredient</th>
              {MONTH_ABBR.map((m, i) => (
                <th key={i} className={`${styles.colMonth} ${i + 1 === currentMonth ? styles.currentMonthCol : ''}`}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ name, months, isCurrentlyInSeason, source }) => (
              <tr key={name} className={isCurrentlyInSeason ? styles.inSeasonRow : undefined}>
                <td className={styles.ingredientName}>
                  {capitalize(name)}
                  {source === 'ai' && <span className={styles.aiBadge} title="Looked up via AI">AI</span>}
                </td>
                {MONTH_ABBR.map((_, i) => {
                  const month = i + 1;
                  const inSeason = months.includes(month);
                  const isCurrent = month === currentMonth;
                  return (
                    <td
                      key={i}
                      className={`${styles.monthCell} ${inSeason ? styles.inSeason : ''} ${isCurrent ? styles.currentMonthCol : ''} ${inSeason && isCurrent ? styles.inSeasonCurrent : ''}`}
                    >
                      {inSeason ? <span className={styles.dot} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.footer}>
        {filtered.length} ingredient{filtered.length !== 1 ? 's' : ''}
        {filterMonth > 0 ? ` in season in ${MONTH_ABBR[filterMonth - 1]}` : ' total'}
      </p>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MONTH_ABBR, SEASONS, cleanMonths, formatMonths, naturalSeasonMonths } from '../utils/pantrySeasons';
import styles from './SeasonPopover.module.css';

// "Which months should this be on my list?" for a Snacks / Fruit item, plus
// when the food is naturally in season (utils/pantrySeasons.js). Portalled to
// <body> with position: fixed next to the clicked name, so the grid widget's
// scroll box can't clip it; it follows the name on scroll.
export function SeasonPopover({ anchorEl, item, onChange, onClose }) {
  const ref = useRef(null);
  const [style, setStyle] = useState(() => place(anchorEl));
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    function follow() {
      if (!anchorEl.isConnected) { closeRef.current(); return; }
      setStyle(place(anchorEl));
    }
    function outside(e) {
      if (ref.current && !ref.current.contains(e.target) && !anchorEl.contains(e.target)) closeRef.current();
    }
    function esc(e) { if (e.key === 'Escape') closeRef.current(); }
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [anchorEl]);

  const months = cleanMonths(item.seasonMonths);
  const picked = new Set(months);
  const natural = naturalSeasonMonths(item.ingredient);
  const nowMonth = new Date().getMonth() + 1;
  const set = next => onChange(cleanMonths(next));
  const toggle = m => set(picked.has(m) ? months.filter(x => x !== m) : [...months, m]);
  // A season button adds its months, or takes them away when all are on.
  const toggleSeason = s => {
    const allOn = s.months.every(m => picked.has(m));
    set(allOn ? months.filter(m => !s.months.includes(m)) : [...months, ...s.months]);
  };
  const same = (a, b) => a.length === b.length && a.every((m, i) => m === b[i]);

  return createPortal(
    <div className={styles.popover} style={style} ref={ref} role="dialog" aria-label={`Season for ${item.ingredient}`}>
      <div className={styles.title}>{item.ingredient}</div>

      <div className={styles.natural}>
        {natural ? (
          <>
            <span>
              In season: <strong>{formatMonths(natural)}</strong>
              {natural.length < 12 && (
                <span className={natural.includes(nowMonth) ? styles.nowIn : styles.nowOut}>
                  {natural.includes(nowMonth) ? ' · in season now' : ' · not in season now'}
                </span>
              )}
            </span>
            <span className={styles.hint}>Peak months in the Northeast US</span>
            {natural.length < 12 && !same(natural, months) && (
              <button type="button" className={styles.linkBtn} onClick={() => set(natural)}>
                Use these months
              </button>
            )}
          </>
        ) : (
          <span className={styles.hint}>No natural season on file — available year-round.</span>
        )}
      </div>

      <div className={styles.label}>Include on my list in</div>
      <div className={styles.seasons}>
        {SEASONS.map(s => {
          const on = s.months.every(m => picked.has(m));
          return (
            <button key={s.key} type="button" className={on ? styles.chipOn : styles.chip} aria-pressed={on} onClick={() => toggleSeason(s)}>
              {s.label}
            </button>
          );
        })}
        <button type="button" className={months.length === 0 ? styles.chipOn : styles.chip} aria-pressed={months.length === 0} onClick={() => set([])}>
          All year
        </button>
      </div>
      <div className={styles.months}>
        {MONTH_ABBR.map((abbr, i) => {
          const m = i + 1;
          const on = picked.has(m);
          return (
            <button
              key={abbr}
              type="button"
              className={`${on ? styles.monthOn : styles.month} ${natural?.includes(m) ? styles.monthNatural : ''}`}
              aria-pressed={on}
              title={natural?.includes(m) ? `${abbr} — naturally in season` : abbr}
              onClick={() => toggle(m)}
            >
              {abbr}
            </button>
          );
        })}
      </div>
      <div className={styles.summary}>
        {months.length === 0
          ? 'On the list all year.'
          : `On the list ${formatMonths(months)}${picked.has(nowMonth) ? '' : ' — skipped this month'}.`}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.done} onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  );
}

// Below the name, or above it when there isn't room; clamped to the screen.
function place(el) {
  const rect = el.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const above = window.innerHeight - rect.bottom < 360 && rect.top > 360;
  return {
    left,
    width,
    top: above ? rect.top - 6 : rect.bottom + 6,
    transform: above ? 'translateY(-100%)' : undefined,
  };
}

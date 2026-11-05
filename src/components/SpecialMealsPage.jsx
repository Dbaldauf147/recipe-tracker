import React, { useEffect, useMemo, useState } from 'react';
import { saveDailyLog } from './DailyTrackerPage';
import {
  collectSpecialMeals, suggestedEventNames, untaggedHolidays, setEventTag, eventTagOf, entryName, holidayOn,
} from '../utils/specialMeals';
import styles from './SpecialMealsPage.module.css';

const DAILY_LOG_KEY = 'sunday-daily-log';
const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function loadDailyLog() {
  try {
    const raw = localStorage.getItem(DAILY_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function longDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function oneYearBefore(dateKey) {
  return `${Number(dateKey.slice(0, 4)) - 1}${dateKey.slice(4)}`;
}

const calsOf = e => Math.round(Number(e?.nutrition?.calories) || 0);

/**
 * Special Meals — meals and snacks tagged to a holiday or event, grouped by
 * event and then by the day they were eaten. Tagging happens here too: pick
 * a day, tick what you ate, name the occasion.
 *
 * Reads the same localStorage copy of the meal log the Food Log and Meal
 * History read, and writes through the Food Log's saveDailyLog so the change
 * syncs exactly like any other edit. Only the `specialEvent` field changes.
 */
export function SpecialMealsPage({ user, onClose }) {
  const [log, setLog] = useState(loadDailyLog);
  const [date, setDate] = useState(todayKey);
  const [selected, setSelected] = useState(() => new Set());
  const [name, setName] = useState(() => holidayOn(todayKey()) || '');
  const [savedMsg, setSavedMsg] = useState('');

  // Another view (or a Firestore pull) may change the log while this is open.
  useEffect(() => {
    const refresh = () => setLog(loadDailyLog());
    window.addEventListener('firestore-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('firestore-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const events = useMemo(() => collectSpecialMeals(log), [log]);
  const suggestions = useMemo(() => suggestedEventNames(log, date), [log, date]);
  const prompts = useMemo(() => untaggedHolidays(log, { since: oneYearBefore(todayKey()) }), [log]);
  const dayEntries = log[date]?.entries || [];

  function persist(next) {
    if (next === log) return;
    setLog(next);
    saveDailyLog(next, user);
  }

  function pickDate(next, presetName) {
    setDate(next);
    setSelected(new Set());
    setName(presetName ?? (holidayOn(next) || name));
    setSavedMsg('');
  }

  function toggle(id) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function applyTag() {
    const tag = name.trim();
    if (!tag || selected.size === 0) return;
    persist(setEventTag(log, date, [...selected], tag));
    setSavedMsg(`Tagged ${selected.size} as “${tag}”.`);
    setSelected(new Set());
  }

  function untag(dateKey, id) {
    persist(setEventTag(log, dateKey, [id], ''));
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Special Meals</h2>
      </div>
      <p className={styles.intro}>
        Meals and snacks from holidays and special occasions. Tag what you ate below, and it shows up here by event, year after year.
      </p>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Tag meals</h3>
        {prompts.length > 0 && (
          <div className={styles.prompts}>
            <span className={styles.promptsLabel}>Holidays with nothing tagged:</span>
            {prompts.map(p => (
              <button key={p.date} type="button" className={styles.promptChip} onClick={() => pickDate(p.date, p.name)}>
                {p.name} · {longDate(p.date)}
              </button>
            ))}
          </div>
        )}
        <div className={styles.formRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Day</span>
            <input type="date" value={date} max={todayKey()} onChange={e => e.target.value && pickDate(e.target.value)} className={styles.input} />
          </label>
          <label className={`${styles.field} ${styles.fieldGrow}`}>
            <span className={styles.fieldLabel}>Holiday or event</span>
            <input
              type="text"
              list="special-meal-events"
              value={name}
              placeholder="e.g. Thanksgiving, Mom's birthday"
              onChange={e => setName(e.target.value)}
              className={styles.input}
            />
            <datalist id="special-meal-events">
              {suggestions.map(s => <option key={s} value={s} />)}
            </datalist>
          </label>
        </div>

        {dayEntries.length === 0 ? (
          <p className={styles.empty}>Nothing logged on {longDate(date)}. Log the meal in Track Meals first, then tag it here.</p>
        ) : (
          <ul className={styles.entryList}>
            {dayEntries.map(e => {
              const tag = eventTagOf(e);
              return (
                <li key={e.id} className={styles.entryRow}>
                  <label className={styles.entryLabel}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    <span className={styles.slot}>{SLOT_LABELS[e.mealSlot] || 'Snack'}</span>
                    <span className={styles.entryName}>{entryName(e)}</span>
                    {calsOf(e) > 0 && <span className={styles.cals}>{calsOf(e)} cal</span>}
                  </label>
                  {tag && (
                    <span className={styles.tagChip}>
                      🎉 {tag}
                      <button type="button" className={styles.tagRemove} title="Remove tag" onClick={() => untag(date, e.id)}>×</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} disabled={!name.trim() || selected.size === 0} onClick={applyTag}>
            {selected.size > 0 ? `Tag ${selected.size} selected` : 'Tag selected'}
          </button>
          {savedMsg && <span className={styles.saved}>{savedMsg}</span>}
        </div>
      </section>

      {events.length === 0 ? (
        <p className={styles.empty}>No special meals yet. Tag a holiday dinner or a birthday treat above and it will appear here.</p>
      ) : events.map(ev => (
        <section key={ev.name} className={styles.card}>
          <h3 className={styles.cardTitle}>
            🎉 {ev.name}
            <span className={styles.count}>{ev.occasions.length === 1 ? '1 time' : `${ev.occasions.length} times`}</span>
          </h3>
          {ev.occasions.map(o => {
            const total = o.entries.reduce((s, e) => s + calsOf(e), 0);
            return (
              <div key={o.date} className={styles.occasion}>
                <div className={styles.occasionHead}>
                  <button type="button" className={styles.occasionDate} title="Tag more from this day" onClick={() => pickDate(o.date, ev.name)}>
                    {longDate(o.date)}
                  </button>
                  {total > 0 && <span className={styles.cals}>{total.toLocaleString()} cal</span>}
                </div>
                <ul className={styles.entryList}>
                  {o.entries.map(e => (
                    <li key={e.id} className={styles.entryRow}>
                      <span className={styles.entryLabel}>
                        <span className={styles.slot}>{SLOT_LABELS[e.mealSlot] || 'Snack'}</span>
                        <span className={styles.entryName}>{entryName(e)}</span>
                        {calsOf(e) > 0 && <span className={styles.cals}>{calsOf(e)} cal</span>}
                      </span>
                      <button type="button" className={styles.tagRemove} title="Remove from this event" onClick={() => untag(o.date, e.id)}>×</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { saveField } from '../utils/firestoreSync';
import styles from './WeightTracker.module.css';

const WEIGHT_KEY = 'sunday-weight-log';

function loadWeightLog() {
  try {
    return JSON.parse(localStorage.getItem(WEIGHT_KEY) || '[]');
  } catch { return []; }
}

function saveWeightLog(log, user) {
  localStorage.setItem(WEIGHT_KEY, JSON.stringify(log));
  if (user) saveField(user.uid, 'weightLog', log);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeighSettings() {
  try {
    const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
    return {
      repeatEvery: stats.weighRepeatEvery || 1,
      repeatUnit: stats.weighRepeatUnit || 'week',
      weekDays: stats.weighWeekDays || ['monday'],
      monthOption: stats.weighMonthOption || 'day', // 'day' or 'weekday'
      monthDay: stats.weighMonthDay || 1,
      monthWeek: stats.weighMonthWeek || '1st',
      monthWeekday: stats.weighMonthWeekday || 'monday',
    };
  } catch {}
  return { repeatEvery: 1, repeatUnit: 'week', weekDays: ['monday'], monthOption: 'day', monthDay: 1, monthWeek: '1st', monthWeekday: 'monday' };
}

// Legacy compat
function getWeighFrequency() {
  const s = getWeighSettings();
  if (s.repeatUnit === 'day') return 'daily';
  if (s.repeatUnit === 'week' && s.repeatEvery === 2) return 'biweekly';
  if (s.repeatUnit === 'week') return 'weekly';
  if (s.repeatUnit === 'month') return 'monthly';
  if (s.repeatUnit === 'year') return 'monthly';
  return 'weekly';
}

function getDaysSinceLastWeigh(log) {
  if (log.length === 0) return null;
  const last = log[log.length - 1].date;
  const diff = Math.floor((new Date() - new Date(last + 'T00:00:00')) / (1000 * 60 * 60 * 24));
  return diff;
}

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isWeighDay(date, settings) {
  const { repeatUnit, repeatEvery, weekDays, monthOption, monthDay, monthWeek, monthWeekday } = settings;
  if (repeatUnit === 'day') return true;
  if (repeatUnit === 'week') {
    const dayName = DAY_NAMES[date.getDay()];
    return (weekDays || ['monday']).includes(dayName);
  }
  if (repeatUnit === 'month') {
    if (monthOption === 'day') return date.getDate() === (monthDay || 1);
    // Nth weekday
    const weekNum = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, 'last': -1 };
    const targetDow = DAY_MAP[monthWeekday || 'monday'];
    if (weekNum[monthWeek] === -1) {
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      let d = lastDay.getDate();
      while (new Date(date.getFullYear(), date.getMonth(), d).getDay() !== targetDow) d--;
      return date.getDate() === d;
    }
    const n = weekNum[monthWeek] || 1;
    let count = 0;
    for (let d = 1; d <= date.getDate(); d++) {
      if (new Date(date.getFullYear(), date.getMonth(), d).getDay() === targetDow) count++;
    }
    return count === n && date.getDay() === targetDow;
  }
  if (repeatUnit === 'year') {
    return date.getMonth() === 0 && date.getDate() === 1; // Jan 1
  }
  return false;
}

function shouldWeighToday(log) {
  const settings = getWeighSettings();
  const days = getDaysSinceLastWeigh(log);
  if (days === null) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!isWeighDay(today, settings)) return false;
  // Check repeat interval
  if (settings.repeatUnit === 'day') return days >= settings.repeatEvery;
  if (settings.repeatUnit === 'week') {
    return days >= (settings.repeatEvery * 7 - 6); // Allow within the target week
  }
  if (settings.repeatUnit === 'month') {
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return !log.some(e => e.date.startsWith(thisMonth));
  }
  return days >= 7;
}

function getNextWeighDate(log) {
  const settings = getWeighSettings();
  if (log.length === 0) return 'Today';
  const last = new Date(log[log.length - 1].date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Scan forward up to 365 days to find next weigh day
  for (let i = 1; i <= 365; i++) {
    const candidate = new Date(last);
    candidate.setDate(candidate.getDate() + i);
    if (candidate < today && i < 365) continue; // skip past dates unless far future
    if (isWeighDay(candidate, settings)) {
      if (settings.repeatUnit === 'day' && i < settings.repeatEvery) continue;
      if (settings.repeatUnit === 'week' && i < settings.repeatEvery * 7 - 6) continue;
      return candidate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  return 'Today';
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendWeighReminder() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Prep Day - Weigh In Reminder', {
      body: 'Time to log your weight!',
      icon: '/prep-day-logo.png',
    });
  }
}

const SEED_DATA = [{"date":"2022-09-25","weight":163.2},{"date":"2022-10-01","weight":166.2},{"date":"2022-10-15","weight":162.6},{"date":"2022-10-23","weight":165},{"date":"2022-11-20","weight":159.8},{"date":"2022-11-27","weight":163},{"date":"2022-12-06","weight":163.6},{"date":"2022-12-11","weight":159},{"date":"2022-12-18","weight":162.4},{"date":"2022-12-26","weight":163.4},{"date":"2023-01-01","weight":166.6},{"date":"2023-01-08","weight":168.2},{"date":"2023-01-24","weight":165},{"date":"2023-01-29","weight":166.2},{"date":"2023-02-05","weight":168.4},{"date":"2023-02-12","weight":166.2},{"date":"2023-02-20","weight":166.4},{"date":"2023-02-27","weight":165},{"date":"2023-03-05","weight":166},{"date":"2023-03-12","weight":167.4},{"date":"2023-03-19","weight":168.2},{"date":"2023-03-27","weight":166.8},{"date":"2023-04-04","weight":169.4},{"date":"2023-04-16","weight":169.6},{"date":"2023-04-23","weight":168},{"date":"2023-04-30","weight":168.8},{"date":"2023-05-07","weight":169.4},{"date":"2023-05-15","weight":174},{"date":"2023-05-22","weight":170.2},{"date":"2023-05-29","weight":173.2},{"date":"2023-06-04","weight":172.2},{"date":"2023-06-11","weight":173.6},{"date":"2023-06-19","weight":172.8},{"date":"2023-06-28","weight":171.8},{"date":"2023-07-04","weight":172.8},{"date":"2023-07-09","weight":177},{"date":"2023-07-16","weight":172.8},{"date":"2023-07-24","weight":171.2},{"date":"2023-07-31","weight":171.6},{"date":"2023-08-06","weight":170.6},{"date":"2023-08-14","weight":171.8},{"date":"2023-08-21","weight":173},{"date":"2023-08-27","weight":176},{"date":"2023-09-06","weight":173.6},{"date":"2023-09-11","weight":173},{"date":"2023-09-17","weight":175.4},{"date":"2023-09-24","weight":175},{"date":"2023-10-01","weight":174.6},{"date":"2023-10-08","weight":174.2},{"date":"2023-10-15","weight":174.6},{"date":"2023-10-22","weight":173.2},{"date":"2023-10-31","weight":171},{"date":"2023-11-05","weight":174.6},{"date":"2023-11-12","weight":175.2},{"date":"2023-11-19","weight":173.6},{"date":"2023-11-27","weight":171.6},{"date":"2023-12-03","weight":174.4},{"date":"2023-12-10","weight":174.8},{"date":"2023-12-17","weight":173.2},{"date":"2024-01-01","weight":175},{"date":"2024-01-07","weight":173.4},{"date":"2024-01-16","weight":173.2},{"date":"2024-01-21","weight":173.2},{"date":"2024-01-28","weight":176.8},{"date":"2024-02-13","weight":170.8},{"date":"2024-02-18","weight":171.8},{"date":"2024-02-28","weight":172.4},{"date":"2024-03-03","weight":172.4},{"date":"2024-03-31","weight":170.8},{"date":"2024-04-07","weight":171.6},{"date":"2024-04-16","weight":168},{"date":"2024-04-21","weight":168.6},{"date":"2024-04-29","weight":166.6},{"date":"2024-05-05","weight":171.6},{"date":"2024-05-15","weight":169.4},{"date":"2024-05-19","weight":170.1},{"date":"2024-06-01","weight":168.2},{"date":"2024-06-04","weight":168.6},{"date":"2024-06-17","weight":171.6},{"date":"2024-06-23","weight":172.6},{"date":"2024-07-03","weight":173.3},{"date":"2024-07-08","weight":172.8},{"date":"2024-07-15","weight":172.6},{"date":"2024-07-21","weight":173},{"date":"2024-07-29","weight":174},{"date":"2024-08-06","weight":171.8},{"date":"2024-08-11","weight":174.2},{"date":"2024-08-19","weight":176},{"date":"2024-08-24","weight":176.2},{"date":"2024-09-02","weight":174},{"date":"2024-09-10","weight":176.4},{"date":"2024-09-15","weight":177.6},{"date":"2024-09-23","weight":174.6},{"date":"2024-09-30","weight":175},{"date":"2024-10-06","weight":177},{"date":"2024-10-14","weight":174.2},{"date":"2024-10-20","weight":176.8},{"date":"2024-10-30","weight":176.6},{"date":"2024-11-04","weight":178.2},{"date":"2024-11-11","weight":174.8},{"date":"2024-11-17","weight":176.6},{"date":"2024-11-24","weight":175.2},{"date":"2024-12-03","weight":175.2},{"date":"2024-12-14","weight":177.4},{"date":"2024-12-15","weight":176.6},{"date":"2024-12-22","weight":177},{"date":"2025-01-03","weight":175},{"date":"2025-01-11","weight":176.6},{"date":"2025-01-20","weight":175.2},{"date":"2025-01-28","weight":174.6},{"date":"2025-02-02","weight":175.2},{"date":"2025-02-08","weight":174.4},{"date":"2025-02-14","weight":174.4},{"date":"2025-02-16","weight":176.2},{"date":"2025-03-02","weight":175.2},{"date":"2025-03-09","weight":176.6},{"date":"2025-03-20","weight":175},{"date":"2025-03-29","weight":173},{"date":"2025-04-05","weight":175.4},{"date":"2025-04-06","weight":178.4},{"date":"2025-04-19","weight":174.6},{"date":"2025-04-25","weight":176.6},{"date":"2025-05-01","weight":174.4},{"date":"2025-05-10","weight":175.2},{"date":"2025-05-12","weight":176.4},{"date":"2025-05-18","weight":176},{"date":"2025-05-23","weight":177.2},{"date":"2025-06-01","weight":177},{"date":"2025-06-07","weight":176.4},{"date":"2025-06-15","weight":174.8},{"date":"2025-06-22","weight":177.2},{"date":"2025-06-29","weight":175.2},{"date":"2025-07-07","weight":176.2},{"date":"2025-07-14","weight":175.4},{"date":"2025-07-22","weight":176.6},{"date":"2025-07-28","weight":175},{"date":"2025-08-04","weight":172.6},{"date":"2025-08-12","weight":173.2},{"date":"2025-08-18","weight":174.2},{"date":"2025-08-24","weight":176.2},{"date":"2025-09-01","weight":174.2},{"date":"2025-09-07","weight":172.6},{"date":"2025-09-17","weight":174},{"date":"2025-09-25","weight":172.4},{"date":"2025-09-29","weight":172.4},{"date":"2025-10-08","weight":172.5},{"date":"2025-10-15","weight":173.5},{"date":"2025-10-22","weight":173.5},{"date":"2025-10-28","weight":178},{"date":"2025-11-02","weight":177.2},{"date":"2025-11-09","weight":174},{"date":"2025-11-20","weight":175.2},{"date":"2025-11-23","weight":174},{"date":"2025-11-30","weight":173.4},{"date":"2025-12-09","weight":174.8},{"date":"2025-12-14","weight":179.6},{"date":"2025-12-23","weight":174.8},{"date":"2025-12-29","weight":177.2},{"date":"2026-01-05","weight":175.8},{"date":"2026-01-11","weight":176.4},{"date":"2026-01-16","weight":177.2},{"date":"2026-01-25","weight":176.4},{"date":"2026-02-04","weight":175.4},{"date":"2026-02-08","weight":178.6},{"date":"2026-02-15","weight":178.8},{"date":"2026-02-22","weight":181.4},{"date":"2026-03-04","weight":178.6}];

function WeightCalendar({ log }) {
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const logDates = new Set(log.map(e => e.date));
  const settings = getWeighSettings();

  function isScheduledDay(year, month, day) {
    const d = new Date(year, month, day);
    return isWeighDay(d, settings);
  }

  const firstDay = new Date(calYear, calMonth, 1);
  const startDow = firstDay.getDay();
  const mondayStart = startDow === 0 ? 6 : startDow - 1;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayDate = todayStr();
  const monthLabel = new Date(calYear, calMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className={styles.calSection}>
      <div className={styles.calHeader}>
        <button className={styles.calArrow} onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}>&larr;</button>
        <span className={styles.calMonth}>{monthLabel}</span>
        <button className={styles.calArrow} onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}>&rarr;</button>
      </div>
      <div className={styles.calGrid}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => (
          <span key={i} className={styles.calDow}>{h}</span>
        ))}
        {Array(mondayStart).fill(null).map((_, i) => <span key={`e${i}`} className={styles.calEmpty} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const hasEntry = logDates.has(ds);
          const isScheduled = isScheduledDay(calYear, calMonth, day);
          const isToday = ds === todayDate;
          const entry = hasEntry ? log.find(e => e.date === ds) : null;
          return (
            <span
              key={day}
              className={`${styles.calDay} ${isToday ? styles.calToday : ''} ${hasEntry ? styles.calLogged : ''} ${isScheduled && !hasEntry ? styles.calScheduled : ''}`}
              title={entry ? `${entry.weight} lbs` : isScheduled ? 'Scheduled weigh-in' : ''}
            >
              {day}
            </span>
          );
        })}
      </div>
      <div className={styles.calLegend}>
        <span className={styles.calLegendItem}><span className={styles.calLegendDotLogged} /> Logged</span>
        <span className={styles.calLegendItem}><span className={styles.calLegendDotScheduled} /> Scheduled</span>
      </div>
    </div>
  );
}

export function checkWeighReminder() {
  const log = loadWeightLog();
  return shouldWeighToday(log) && !log.some(e => e.date === todayStr());
}

export function WeightTracker({ onClose, user }) {
  const [log, setLog] = useState(() => {
    const existing = loadWeightLog();
    // Merge seed data with existing — seed fills in any missing dates
    const dateSet = new Set(existing.map(e => e.date));
    const merged = [...existing];
    for (const entry of SEED_DATA) {
      if (!dateSet.has(entry.date)) {
        merged.push(entry);
        dateSet.add(entry.date);
      }
    }
    merged.sort((a, b) => a.date.localeCompare(b.date));
    if (merged.length !== existing.length) {
      saveWeightLog(merged, null);
    }
    return merged;
  });
  // Get user's weight goal for color-coding
  const weightGoal = useMemo(() => {
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      const goals = stats.weightGoals || [];
      if (goals.includes('gain')) return 'gain';
      if (goals.includes('lose')) return 'lose';
      if (goals.includes('maintain')) return 'maintain';
    } catch {}
    return 'lose'; // default assumption
  }, []);

  // Returns green if change aligns with goal, red if opposite, neutral if maintain/stable
  function changeColor(change) {
    if (Math.abs(change) < 0.2) return 'var(--color-text)';
    if (weightGoal === 'gain') return change > 0 ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)';
    if (weightGoal === 'lose') return change < 0 ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)';
    // maintain: any significant change is orange/neutral
    return Math.abs(change) > 1 ? 'var(--color-accent)' : 'var(--color-text)';
  }

  const [weight, setWeight] = useState('');
  const [rangeMode, setRangeMode] = useState('weeks'); // 'weeks' | 'years' | 'custom'
  const [rangeCount, setRangeCount] = useState(8);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try { return localStorage.getItem('sunday-weight-notif') === 'true'; } catch { return false; }
  });

  const [weighSettings, setWeighSettings] = useState(() => getWeighSettings());
  const [showReminderPopup, setShowReminderPopup] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef(null);
  const weighFreq = getWeighFrequency(); // legacy for display

  function updateWeighSettings(patch) {
    setWeighSettings(prev => {
      const next = { ...prev, ...patch };
      try {
        const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
        stats.weighRepeatEvery = next.repeatEvery;
        stats.weighRepeatUnit = next.repeatUnit;
        stats.weighWeekDays = next.weekDays;
        stats.weighMonthOption = next.monthOption;
        stats.weighMonthDay = next.monthDay;
        stats.weighMonthWeek = next.monthWeek;
        stats.weighMonthWeekday = next.monthWeekday;
        // Legacy goals compat
        const goals = (stats.mealTrackingGoals || []).filter(g => !g.startsWith('weigh'));
        if (next.repeatUnit === 'day') goals.push('weighDaily');
        else if (next.repeatUnit === 'week' && next.repeatEvery === 2) goals.push('weighBiweekly');
        else if (next.repeatUnit === 'week') goals.push('weighWeekly');
        else if (next.repeatUnit === 'month') goals.push('weighMonthly');
        stats.mealTrackingGoals = goals;
        localStorage.setItem('sunday-body-stats', JSON.stringify(stats));
        if (user) saveField(user.uid, 'bodyStats', stats);
      } catch {}
      // Show saved toast
      setShowSaved(true);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
      return next;
    });
  }

  const range = rangeMode === 'weeks' ? rangeCount * 7 : rangeMode === 'months' ? rangeCount * 30 : rangeMode === 'years' ? rangeCount * 365 : 0;
  const showCustom = rangeMode === 'custom';
  const today = todayStr();
  const frequency = `every ${weighSettings.repeatEvery} ${weighSettings.repeatUnit}${weighSettings.repeatEvery > 1 ? 's' : ''}`;
  const nextWeighDate = getNextWeighDate(log);

  // Send browser notification if weigh-in is due
  useEffect(() => {
    if (notificationsEnabled && needsWeighing && !todayEntry) {
      sendWeighReminder();
    }
  }, []);
  const needsWeighing = shouldWeighToday(log);

  // Check if today already has an entry
  const todayEntry = log.find(e => e.date === today);

  function handleAdd() {
    const w = parseFloat(weight);
    if (!w || w <= 0) return;
    setLog(prev => {
      // Replace today's entry if it exists, otherwise add
      const filtered = prev.filter(e => e.date !== today);
      const next = [...filtered, { date: today, weight: w }].sort((a, b) => a.date.localeCompare(b.date));
      saveWeightLog(next, user);
      return next;
    });
    setWeight('');
  }

  function handleDelete(date) {
    setLog(prev => {
      const next = prev.filter(e => e.date !== date);
      saveWeightLog(next, user);
      return next;
    });
  }

  const chartData = useMemo(() => {
    let filtered;
    if (showCustom && customStart && customEnd) {
      filtered = log.filter(e => e.date >= customStart && e.date <= customEnd);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - range);
      const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
      filtered = log.filter(e => e.date >= cutoffStr);
    }
    const useMonthYear = range > 70 || filtered.length > 20;
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Dynamic gap threshold based on schedule
    const ws = getWeighSettings();
    const baseInterval = ws.repeatUnit === 'day' ? ws.repeatEvery
      : ws.repeatUnit === 'week' ? ws.repeatEvery * 7
      : ws.repeatUnit === 'month' ? ws.repeatEvery * 30
      : ws.repeatEvery * 365;
    const GAP_THRESHOLD = baseInterval + Math.round(baseInterval * 0.3); // interval + 30% buffer (weekly = 9 days)
    // Collect all week numbers that have actual data
    const actualWeeks = new Set();
    if (ws.repeatUnit === 'week') {
      for (const e of filtered) {
        const dt = new Date(e.date + 'T00:00:00');
        const startOfYear = new Date(dt.getFullYear(), 0, 1);
        const wkDiff = (dt - startOfYear + ((startOfYear.getDay() + 6) % 7) * 86400000);
        actualWeeks.add(Math.ceil(wkDiff / 604800000));
      }
    }

    const usedWeekLabels = {};
    function getLabel(dateStr) {
      const [y, m, d] = dateStr.split('-');
      if (ws.repeatUnit === 'week') {
        const dt = new Date(dateStr + 'T00:00:00');
        const startOfYear = new Date(dt.getFullYear(), 0, 1);
        const wkDiff = (dt - startOfYear + ((startOfYear.getDay() + 6) % 7) * 86400000);
        const wk = Math.ceil(wkDiff / 604800000);
        const key = `Wk ${wk}`;
        if (usedWeekLabels[key]) {
          return `${parseInt(m)}/${parseInt(d)}`;
        }
        usedWeekLabels[key] = true;
        return key;
      } else if (ws.repeatUnit === 'month' || ws.repeatUnit === 'year') {
        return `${MONTH_NAMES[parseInt(m) - 1]} '${y.slice(2)}`;
      } else if (useMonthYear) {
        return `${MONTH_NAMES[parseInt(m) - 1]} '${y.slice(2)}`;
      }
      return `${parseInt(m)}/${parseInt(d)}`;
    }

    // Build points array, inserting estimated gap points for missing weeks/months
    const points = [];
    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];

      if (i > 0) {
        const prevDate = new Date(filtered[i - 1].date + 'T00:00:00');
        const currDate = new Date(e.date + 'T00:00:00');
        const daysBetween = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));

        if (daysBetween > GAP_THRESHOLD) {
          const prevWeight = filtered[i - 1].weight;
          const currWeight = e.weight;

          // Insert estimated points for each missing interval
          const intervalDays = ws.repeatUnit === 'month' ? 30 : ws.repeatUnit === 'week' ? ws.repeatEvery * 7 : GAP_THRESHOLD;
          const steps = Math.max(1, Math.ceil(daysBetween / intervalDays) - 1);
          for (let s = 1; s <= steps; s++) {
            const frac = s / (steps + 1);
            const estDate = new Date(prevDate.getTime() + frac * (currDate - prevDate));
            const estDateStr = `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, '0')}-${String(estDate.getDate()).padStart(2, '0')}`;
            const estWeight = Math.round((prevWeight + (currWeight - prevWeight) * frac) * 10) / 10;
            // Skip if this estimated point falls in a week that has actual data
            if (ws.repeatUnit === 'week') {
              const estDt = new Date(estDateStr + 'T00:00:00');
              const soy = new Date(estDt.getFullYear(), 0, 1);
              const estWk = Math.ceil((estDt - soy + ((soy.getDay() + 6) % 7) * 86400000) / 604800000);
              if (actualWeeks.has(estWk)) continue;
            }
            points.push({
              date: getLabel(estDateStr),
              weight: estWeight,
              rawDate: estDateStr,
              solidWeight: null, // no solid line through estimates
              gapWeight: estWeight,
              estimated: true,
            });
          }

          // Mark the boundaries
          if (points.length > 0 && !points[points.length - 1].estimated) {
            points[points.length - 1].gapWeight = points[points.length - 1].weight;
          }
          points.push({
            date: getLabel(e.date),
            weight: e.weight,
            rawDate: e.date,
            solidWeight: e.weight,
            gapWeight: e.weight,
            estimated: false,
          });
          continue;
        }
      }

      points.push({
        date: getLabel(e.date),
        weight: e.weight,
        rawDate: e.date,
        solidWeight: e.weight,
        gapWeight: null,
        estimated: false,
      });
    }
    return points;
  }, [log, range]);

  const stats = useMemo(() => {
    if (log.length < 2) return null;
    const current = log[log.length - 1].weight;
    const first = log[0].weight;
    const change = current - first;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
    const weekEntries = log.filter(e => e.date >= weekStr);
    const weekChange = weekEntries.length >= 2 ? weekEntries[weekEntries.length - 1].weight - weekEntries[0].weight : null;
    return { current, change, weekChange };
  }, [log]);

  // Statistical analysis over selected range
  const analysis = useMemo(() => {
    if (chartData.length < 3) return null;
    const weights = chartData.map(d => d.weight);
    const n = weights.length;

    // Mean
    const mean = weights.reduce((a, b) => a + b, 0) / n;

    // Standard deviation
    const variance = weights.reduce((sum, w) => sum + (w - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    // Linear regression (trend line)
    const xMean = (n - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (weights[i] - mean);
      den += (i - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0; // lbs per data point
    const totalDays = range || 30;
    const weeksInRange = totalDays / 7;
    const weeklyRate = n > 1 ? (slope * (n - 1)) / weeksInRange : 0;

    // R-squared (how well trend fits)
    const predicted = weights.map((_, i) => mean + slope * (i - xMean));
    const ssRes = weights.reduce((sum, w, i) => sum + (w - predicted[i]) ** 2, 0);
    const ssTot = weights.reduce((sum, w) => sum + (w - mean) ** 2, 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Find significant changes (>2 std devs from rolling 4-week avg)
    const alerts = [];
    if (n >= 5) {
      for (let i = 4; i < n; i++) {
        const window = weights.slice(i - 4, i);
        const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
        const windowStd = Math.sqrt(window.reduce((sum, w) => sum + (w - windowMean) ** 2, 0) / window.length);
        if (windowStd > 0) {
          const zScore = (weights[i] - windowMean) / windowStd;
          if (Math.abs(zScore) >= 2) {
            alerts.push({
              date: chartData[i].date,
              rawDate: chartData[i].rawDate,
              weight: weights[i],
              direction: zScore > 0 ? 'up' : 'down',
              zScore: Math.abs(zScore),
            });
          }
        }
      }
    }

    // Trend direction
    const trendChange = slope * (n - 1);
    let trendLabel;
    if (Math.abs(trendChange) < 0.5) trendLabel = 'Stable';
    else if (trendChange < -2) trendLabel = 'Losing';
    else if (trendChange < 0) trendLabel = 'Trending down';
    else if (trendChange > 2) trendLabel = 'Gaining';
    else trendLabel = 'Trending up';

    return {
      mean: Math.round(mean * 10) / 10,
      stdDev: Math.round(stdDev * 10) / 10,
      weeklyRate: Math.round(weeklyRate * 100) / 100,
      rSquared: Math.round(rSquared * 100),
      trendChange: Math.round(trendChange * 10) / 10,
      trendLabel,
      alerts,
      min: Math.round(Math.min(...weights) * 10) / 10,
      max: Math.round(Math.max(...weights) * 10) / 10,
    };
  }, [chartData, range]);

  const [goalWeight, setGoalWeight] = useState(() => {
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      return stats.goalWeight || '';
    } catch { return ''; }
  });

  function saveGoalWeight(val) {
    setGoalWeight(val);
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      stats.goalWeight = parseFloat(val) || null;
      localStorage.setItem('sunday-body-stats', JSON.stringify(stats));
      if (user) saveField(user.uid, 'bodyStats', stats);
    } catch {}
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Weight Tracker</h2>
      </div>

      <div className={styles.targetSection}>
        <span className={styles.targetLabel}>Target Weight</span>
        <input
          className={styles.targetInput}
          type="number"
          value={goalWeight}
          onChange={e => saveGoalWeight(e.target.value)}
          placeholder="Target lbs"
          min="50"
          max="500"
          step="0.1"
        />
      </div>

      {needsWeighing && !todayEntry && (
        <div className={styles.reminder}>
          Time to weigh in! ({frequency} tracking)
        </div>
      )}


      {stats && (
        <div className={styles.statsRow}>
          {stats.weekChange !== null && (
            <div className={styles.statCard}>
              <span className={styles.statValue} style={{ color: changeColor(stats.weekChange) }}>
                {stats.weekChange > 0 ? '+' : ''}{stats.weekChange.toFixed(1)}
              </span>
              <span className={styles.statLabel}>This Week</span>
            </div>
          )}
        </div>
      )}

      <div className={styles.mainWithCal}>
      <div className={styles.mainLeft}>
      {chartData.length >= 2 && (
        <div className={styles.chartCard}>
          <div className={styles.chartTitleRow}>
            <h3 className={styles.chartTitle}>Your Weight</h3>
            {analysis && Math.abs(analysis.trendChange) >= 0.5 && (
              <span className={styles.trendArrow} style={{ color: changeColor(analysis.trendChange) }}>
                {analysis.trendChange > 0 ? '↗' : '↘'} {analysis.trendLabel} ({analysis.trendChange > 0 ? '+' : ''}{analysis.trendChange} lbs)
              </span>
            )}
          </div>
          <div className={styles.chartControls}>
            <div className={styles.rangeToggle}>
              <button className={rangeMode === 'weeks' ? styles.rangeBtnActive : styles.rangeBtn} onClick={() => { setRangeMode('weeks'); setRangeCount(8); }}>Weeks</button>
              <button className={rangeMode === 'months' ? styles.rangeBtnActive : styles.rangeBtn} onClick={() => { setRangeMode('months'); setRangeCount(3); }}>Months</button>
              <button className={rangeMode === 'years' ? styles.rangeBtnActive : styles.rangeBtn} onClick={() => { setRangeMode('years'); setRangeCount(1); }}>Years</button>
              <button className={rangeMode === 'custom' ? styles.rangeBtnActive : styles.rangeBtn} onClick={() => setRangeMode('custom')}>Custom</button>
            </div>
            {rangeMode !== 'custom' && (
              <div className={styles.rangeCounter}>
                <button className={styles.counterBtn} onClick={() => setRangeCount(c => Math.max(1, c - 1))}>−</button>
                <span className={styles.counterValue}>{rangeCount} {rangeMode === 'weeks' ? (rangeCount === 1 ? 'week' : 'weeks') : rangeMode === 'months' ? (rangeCount === 1 ? 'month' : 'months') : (rangeCount === 1 ? 'year' : 'years')}</span>
                <button className={styles.counterBtn} onClick={() => setRangeCount(c => c + 1)}>+</button>
              </div>
            )}
            {rangeMode === 'custom' && (
              <div className={styles.customRange}>
                <input type="date" className={styles.dateInput} value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <span className={styles.dateSep}>to</span>
                <input type="date" className={styles.dateInput} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[dataMin => Math.floor((dataMin - 2) / 5) * 5, dataMax => Math.ceil((dataMax + 2) / 5) * 5]} ticks={(() => { const vals = chartData.map(d => d.weight); const min = Math.floor((Math.min(...vals) - 2) / 5) * 5; const max = Math.ceil((Math.max(...vals) + 2) / 5) * 5; const t = []; for (let i = min; i <= max; i += 5) t.push(i); return t; })()} unit=" lbs" />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload;
                  const alert = analysis?.alerts?.find(a => a.rawDate === d.rawDate);
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.82rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                      <div style={{ fontWeight: 700 }}>{d.date}: {d.weight} lbs{d.estimated ? ' (estimated)' : ''}</div>
                      {alert && !d.estimated && <div style={{ color: alert.direction === 'up' ? '#dc2626' : '#16a34a', fontWeight: 600, marginTop: 2 }}>
                        {alert.direction === 'up' ? '↑ Significant spike' : '↓ Significant drop'} ({alert.zScore.toFixed(1)}σ)
                      </div>}
                    </div>
                  );
                }} />
                {goalWeight && (
                  <ReferenceLine y={goalWeight} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Goal: ${goalWeight}`, position: 'right', fontSize: 10, fill: '#22c55e' }} />
                )}
                <Line type="monotone" dataKey="gapWeight" stroke="var(--color-accent, #2A8C7A)" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.4} dot={(props) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload.estimated) return null;
                  return <circle key={`est-${payload.rawDate}`} cx={cx} cy={cy} r={3} fill="none" stroke="#2A8C7A" strokeWidth={1.5} strokeDasharray="2 2" opacity={0.5} />;
                }} activeDot={false} connectNulls />
                <Line type="monotone" dataKey="solidWeight" stroke="var(--color-accent, #2A8C7A)" strokeWidth={2.5} connectNulls={false} dot={(props) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null) return null;
                  const alert = analysis?.alerts?.find(a => a.rawDate === payload.rawDate);
                  if (alert) {
                    return (
                      <g key={payload.rawDate}>
                        <circle cx={cx} cy={cy} r={6} fill={alert.direction === 'up' ? '#dc2626' : '#16a34a'} opacity={0.15} />
                        <circle cx={cx} cy={cy} r={4} fill={alert.direction === 'up' ? '#dc2626' : '#16a34a'} stroke="#fff" strokeWidth={2} />
                      </g>
                    );
                  }
                  return <circle key={payload.rawDate} cx={cx} cy={cy} r={3} fill="#fff" stroke="#2A8C7A" strokeWidth={2} />;
                }} activeDot={{ r: 6 }} />
                {/* Dots for real data points at gap boundaries */}
                <Line type="monotone" dataKey="weight" stroke="none" strokeWidth={0} dot={(props) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || payload.estimated || payload.solidWeight !== null) return null;
                  return <circle key={`gap-${payload.rawDate}`} cx={cx} cy={cy} r={3} fill="#fff" stroke="#2A8C7A" strokeWidth={2} />;
                }} activeDot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}


      {!needsWeighing && (
        <div className={styles.nextWeigh}>
          Next weigh-in: {nextWeighDate}
        </div>
      )}
      <div className={styles.logSection}>
        <h3 className={styles.logTitle}>Weight Log</h3>
        <button className={styles.addRowBtn} onClick={() => {
          setLog(prev => {
            const next = [{ date: todayStr(), weight: '' }, ...prev];
            return next;
          });
        }}>+ Add Row</button>
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Week</th>
              <th>Weight (lbs)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Show next upcoming weigh-in as a greyed row
              const existingDates = new Set(log.map(e => e.date));
              const todayDate = new Date();
              todayDate.setHours(0, 0, 0, 0);
              let nextDs = null;

              const ws = getWeighSettings();
              for (let i = 0; i < 90 && !nextDs; i++) {
                const d = new Date(todayDate); d.setDate(d.getDate() + i);
                if (!isWeighDay(d, ws)) continue;
                const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!existingDates.has(ds)) nextDs = ds;
              }

              if (!nextDs) return null;
              const nextDate = new Date(nextDs + 'T00:00:00');
              const isToday = nextDs === todayStr();
              const start = new Date(nextDate.getFullYear(), 0, 1);
              const wkDiff = (nextDate - start + ((start.getDay() + 6) % 7) * 86400000);
              const wk = Math.ceil(wkDiff / 604800000);

              return (
                <tr className={isToday ? styles.upcomingRowReady : styles.upcomingRowFuture}>
                  <td>{nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className={styles.weekCol}>{wk}</td>
                  <td>
                    {isToday ? (
                      <input
                        className={styles.logInput}
                        type="number"
                        placeholder="Enter weight"
                        step="0.1"
                        min="50"
                        max="500"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const w = parseFloat(e.target.value);
                            if (!w) return;
                            setLog(prev => {
                              const next = [...prev, { date: nextDs, weight: w }].sort((a, b) => a.date.localeCompare(b.date));
                              saveWeightLog(next, user);
                              return next;
                            });
                            e.target.value = '';
                          }
                        }}
                        onBlur={e => {
                          const w = parseFloat(e.target.value);
                          if (!w) return;
                          setLog(prev => {
                            const next = [...prev, { date: nextDs, weight: w }].sort((a, b) => a.date.localeCompare(b.date));
                            saveWeightLog(next, user);
                            return next;
                          });
                          e.target.value = '';
                        }}
                      />
                    ) : (
                      <span className={styles.upcomingPlaceholder}>—</span>
                    )}
                  </td>
                  <td></td>
                </tr>
              );
            })()}
            {(() => {
              // Build merged list: real entries + missed scheduled weigh-ins
              const ws = getWeighSettings();
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const merged = [];
              const reversedLog = [...log].reverse();

              // Build sets for week/month coverage from actual log entries
              const logWeeks = new Set(); // "YYYY-WW" for each logged entry
              const logMonths = new Set(); // "YYYY-MM" for each logged entry
              for (const e of log) {
                const d = new Date(e.date + 'T00:00:00');
                const startOfYear = new Date(d.getFullYear(), 0, 1);
                const wkDiff = (d - startOfYear + ((startOfYear.getDay() + 6) % 7) * 86400000);
                const wk = Math.ceil(wkDiff / 604800000);
                logWeeks.add(`${d.getFullYear()}-W${wk}`);
                logMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }

              function isCoveredByNearbyEntry(dateStr) {
                const d = new Date(dateStr + 'T00:00:00');
                if (ws.repeatUnit === 'month' || ws.repeatUnit === 'year') {
                  // Any entry in the same month counts
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  return logMonths.has(key);
                }
                if (ws.repeatUnit === 'week') {
                  // Any entry in the same week counts
                  const startOfYear = new Date(d.getFullYear(), 0, 1);
                  const wkDiff = (d - startOfYear + ((startOfYear.getDay() + 6) % 7) * 86400000);
                  const wk = Math.ceil(wkDiff / 604800000);
                  return logWeeks.has(`${d.getFullYear()}-W${wk}`);
                }
                // For daily, exact date match
                return log.some(e => e.date === dateStr);
              }

              for (let li = 0; li < reversedLog.length; li++) {
                const entry = reversedLog[li];
                merged.push({ type: 'entry', entry, logIndex: log.length - 1 - li });

                // Check for missed dates between this entry and the next (older) one
                if (li < reversedLog.length - 1) {
                  const nextEntry = reversedLog[li + 1];
                  const startDate = new Date(nextEntry.date + 'T00:00:00');
                  const endDate = new Date(entry.date + 'T00:00:00');
                  const missed = [];
                  const d = new Date(endDate);
                  d.setDate(d.getDate() - 1);
                  while (d > startDate) {
                    if (isWeighDay(d, ws) && d < today) {
                      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      if (!isCoveredByNearbyEntry(ds)) missed.push(ds);
                    }
                    d.setDate(d.getDate() - 1);
                  }
                  for (const mDate of missed) {
                    merged.push({ type: 'missed', date: mDate });
                  }
                }
              }

              return merged.map((item, mi) => {
                if (item.type === 'missed') {
                  const d = new Date(item.date + 'T00:00:00');
                  const start = new Date(d.getFullYear(), 0, 1);
                  const diff = (d - start + ((start.getDay() + 6) % 7) * 86400000);
                  const wk = Math.ceil(diff / 604800000);
                  return (
                    <tr key={`missed-${item.date}`} className={styles.missedRow}>
                      <td>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className={styles.weekCol}>{wk}</td>
                      <td className={styles.missedLabel}>Missing</td>
                      <td></td>
                    </tr>
                  );
                }
                const entry = item.entry;
                const i = log.length - 1 - item.logIndex; // reversed index for table
                return (
              <tr key={entry.date + '-' + mi}>
                <td>
                  <input
                    className={styles.logInput}
                    type="date"
                    value={entry.date}
                    onChange={e => {
                      const newDate = e.target.value;
                      if (!newDate) return;
                      setLog(prev => {
                        const idx = item.logIndex;
                        const next = [...prev];
                        next[idx] = { ...next[idx], date: newDate };
                        const map = {};
                        for (const en of next) { if (en.date && en.weight) map[en.date] = en; }
                        const sorted = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
                        saveWeightLog(sorted, user);
                        return sorted;
                      });
                    }}
                  />
                </td>
                <td className={styles.weekCol}>
                  {(() => {
                    const d = new Date(entry.date + 'T00:00:00');
                    const start = new Date(d.getFullYear(), 0, 1);
                    const diff = (d - start + ((start.getDay() + 6) % 7) * 86400000);
                    return Math.ceil(diff / 604800000);
                  })()}
                </td>
                <td>
                  <input
                    className={styles.logInput}
                    type="number"
                    value={entry.weight}
                    onChange={e => {
                      const w = e.target.value;
                      setLog(prev => {
                        const idx = item.logIndex;
                        const next = [...prev];
                        next[idx] = { ...next[idx], weight: parseFloat(w) || '' };
                        saveWeightLog(next.filter(en => en.date && en.weight), user);
                        return next;
                      });
                    }}
                    onPaste={e => {
                      const text = e.clipboardData.getData('text');
                      if (!text.includes('\n') && !text.includes('\t')) return;
                      e.preventDefault();
                      const lines = text.trim().split('\n').filter(l => l.trim());
                      const newEntries = [];
                      for (const line of lines) {
                        const parts = line.split('\t').map(s => s.trim());
                        let dateStr = '', weightVal = '';
                        for (const p of parts) {
                          const w = parseFloat(p);
                          if (!isNaN(w) && w > 50 && w < 500) { weightVal = w; continue; }
                          // Try parsing as date
                          const d = new Date(p);
                          if (!isNaN(d.getTime())) {
                            dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          }
                        }
                        if (dateStr && weightVal) newEntries.push({ date: dateStr, weight: weightVal });
                      }
                      if (newEntries.length > 0) {
                        setLog(prev => {
                          const map = {};
                          for (const en of prev) map[en.date] = en;
                          for (const en of newEntries) map[en.date] = en;
                          const sorted = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
                          saveWeightLog(sorted, user);
                          return sorted;
                        });
                      }
                    }}
                    step="0.1"
                    min="50"
                    max="500"
                    placeholder="lbs"
                  />
                </td>
                <td>
                  <button className={styles.logDelete} onClick={() => handleDelete(entry.date)}>&times;</button>
                </td>
              </tr>
                );
              });
            })()}
          </tbody>
        </table>
        {log.length === 0 && <p className={styles.emptyLog}>No entries yet. Log your first weight above.</p>}
      </div>
      </div>
      <div className={styles.mainRight}>
        <WeightCalendar log={log} />
        <button className={styles.setReminderBtn} onClick={() => setShowReminderPopup(true)}>
          Set Reminder Schedule
        </button>
        {showReminderPopup && (
          <div className={styles.reminderPopupOverlay} onClick={() => setShowReminderPopup(false)}>
            <div className={styles.reminderPopup} onClick={e => e.stopPropagation()}>
              <div className={styles.reminderPopupHeader}>
                <h4>Reminder Schedule</h4>
                <button className={styles.reminderPopupClose} onClick={() => setShowReminderPopup(false)}>&times;</button>
              </div>
              <div className={styles.reminderCol}>
                <span className={styles.reminderLabel}>Repeat every</span>
                <div className={styles.repeatEveryRow}>
                  <button className={styles.counterBtn} onClick={() => updateWeighSettings({ repeatEvery: Math.max(1, weighSettings.repeatEvery - 1) })}>&minus;</button>
                  <span className={styles.counterValue}>{weighSettings.repeatEvery}</span>
                  <button className={styles.counterBtn} onClick={() => updateWeighSettings({ repeatEvery: weighSettings.repeatEvery + 1 })}>+</button>
                  <div className={styles.reminderBtns}>
                    {['day', 'week', 'month', 'year'].map(u => (
                      <button key={u} className={weighSettings.repeatUnit === u ? styles.reminderBtnActive : styles.reminderBtn} onClick={() => updateWeighSettings({ repeatUnit: u })}>
                        {u}{weighSettings.repeatEvery > 1 ? 's' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {weighSettings.repeatUnit === 'week' && (
                <div className={styles.reminderCol}>
                  <span className={styles.reminderLabel}>Repeat on</span>
                  <div className={styles.reminderBtns}>
                    {['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(d => (
                      <button
                        key={d}
                        className={(weighSettings.weekDays || []).includes(d) ? styles.reminderBtnActive : styles.reminderBtn}
                        onClick={() => {
                          const current = weighSettings.weekDays || [];
                          const next = current.includes(d) ? current.filter(x => x !== d) : [...current, d];
                          if (next.length > 0) updateWeighSettings({ weekDays: next });
                        }}
                      >
                        {d.charAt(0).toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {weighSettings.repeatUnit === 'month' && (
                <div className={styles.reminderCol}>
                  <span className={styles.reminderLabel}>On</span>
                  <div className={styles.reminderBtns}>
                    <button className={weighSettings.monthOption === 'day' ? styles.reminderBtnActive : styles.reminderBtn} onClick={() => updateWeighSettings({ monthOption: 'day' })}>
                      Day {weighSettings.monthDay || 1}
                    </button>
                    <button className={weighSettings.monthOption === 'weekday' ? styles.reminderBtnActive : styles.reminderBtn} onClick={() => updateWeighSettings({ monthOption: 'weekday' })}>
                      {weighSettings.monthWeek || '1st'} {(weighSettings.monthWeekday || 'monday').charAt(0).toUpperCase() + (weighSettings.monthWeekday || 'monday').slice(1)}
                    </button>
                  </div>
                  {weighSettings.monthOption === 'day' && (
                    <div className={styles.repeatEveryRow} style={{ marginTop: '0.4rem' }}>
                      <button className={styles.counterBtn} onClick={() => updateWeighSettings({ monthDay: Math.max(1, (weighSettings.monthDay || 1) - 1) })}>&minus;</button>
                      <span className={styles.counterValue}>{weighSettings.monthDay || 1}</span>
                      <button className={styles.counterBtn} onClick={() => updateWeighSettings({ monthDay: Math.min(31, (weighSettings.monthDay || 1) + 1) })}>+</button>
                    </div>
                  )}
                  {weighSettings.monthOption === 'weekday' && (
                    <>
                      <div className={styles.reminderBtns} style={{ marginTop: '0.4rem' }}>
                        {['1st', '2nd', '3rd', '4th', 'last'].map(w => (
                          <button key={w} className={weighSettings.monthWeek === w ? styles.reminderBtnActive : styles.reminderBtn} onClick={() => updateWeighSettings({ monthWeek: w })}>{w}</button>
                        ))}
                      </div>
                      <div className={styles.reminderBtns} style={{ marginTop: '0.3rem' }}>
                        {['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(d => (
                          <button key={d} className={weighSettings.monthWeekday === d ? styles.reminderBtnActive : styles.reminderBtn} onClick={() => updateWeighSettings({ monthWeekday: d })}>
                            {d.slice(0, 3).charAt(0).toUpperCase() + d.slice(1, 3)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      {showSaved && <div className={styles.savedToast}>Saved!</div>}
    </div>
  );
}

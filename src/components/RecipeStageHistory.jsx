/**
 * Meal History → Stages: how many recipes sit at each development stage, week
 * by week.
 *
 * The stage chip on a recipe only ever says where that recipe stands today, so
 * the interesting question — is the work-in-progress pile actually shrinking? —
 * had no answer anywhere. A weekly count is taken automatically (see
 * recipeStageHistory.js, recorded from App whenever the counts move) and this
 * tab is the readout: where things stand now, and the run of weeks behind it.
 *
 * The history is drawn twice — breakfast, then lunch & dinner — from the
 * per-category breakdown each weekly row carries (`row.common`, COMMON recipes
 * only, the same counts the weekly email charts). Recipes with no stage are a
 * segment of their own at the bottom of the stack, so every recipe is counted.
 *
 * Colours default to RECIPE_STAGES (the chip and card-pill colours) and can be
 * changed per stage; the choice syncs as `recipeStageColors` so the app draws
 * the same bars. Because a picked colour can land close to another, the chart
 * never leans on hue alone: the stack order is fixed (no stage at the bottom,
 * nailed down on top), segments are separated by a 2px gap and carry their
 * count, the legend is always shown, and the same numbers sit in a table.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList,
} from 'recharts';
import { auth } from '../firebase';
import { listFullBackups, readBackupValue } from '../utils/firestoreSync';
import { RECIPE_STAGES } from '../utils/recipeStage';
import {
  loadStageHistory, saveStageHistory, countStages, stageSnapshot, weekStart,
  formatWeekLabel, backupsToBackfill, backfilledRow, mergeMissingWeeks,
  upsertWeek, UNSET_KEY, stageColors, categoryCounts, loadStageColors, saveStageColors,
} from '../utils/recipeStageHistory';
import styles from './RecipeStageHistory.module.css';

// The three real stages, for the tiles.
const SERIES = RECIPE_STAGES;
// Bottom-to-top in the stack, and left-to-right in the legend: the order a
// recipe travels — unstaged first — so the shape of the chart reads as progress.
const STACK = [{ key: UNSET_KEY, label: 'No stage' }, ...RECIPE_STAGES];
// The two charts, in the order the Recipes page lists the categories.
const CATEGORIES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch & dinner' },
];
const RANGES = [
  { key: 12, label: '12 weeks' },
  { key: 26, label: '26 weeks' },
  { key: 0, label: 'All' },
];
const TABLE_WEEKS = 12;
// Past this many points the per-week dots merge into the line and only add ink.
const DOT_LIMIT = 20;

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/** Recipes localStorage key, as the daily backup stores it. */
const RECIPES_BACKUP_KEYS = ['recipe-tracker-recipes', 'recipes'];

/**
 * Tooltip and legend are ours rather than recharts' own: both of recharts'
 * default orderings are alphabetical, which puts "Nailed down" first and so
 * disagrees with the stack, the tiles and the table. With three series that
 * look similar under deuteranopia, a stable order IS part of the encoding.
 */
function StageTooltip({ active, payload, label, colors }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>Week of {label}</div>
      {[...STACK].reverse().map(stage => (
        <div key={stage.key} className={styles.tooltipRow}>
          <span className={styles.swatch} style={{ background: colors[stage.key] }} aria-hidden="true" />
          <span className={styles.tooltipLabel}>{stage.label}</span>
          <span className={styles.tooltipValue}>{row[stage.key] || 0}</span>
        </div>
      ))}
      <div className={styles.tooltipFoot}>
        {row.total || 0} recipes
        {row.source === 'backup' ? ' · from backup' : ''}
      </div>
    </div>
  );
}

/** Black or white, whichever reads better on `hex` — the bar colour is the owner's choice. */
function labelInk(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return '#ffffff';
  const lin = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111827' : '#ffffff';
}

/**
 * The count printed inside a segment. Skipped for zero, and for a segment too
 * short to hold the digits — the tooltip and table still have that number.
 */
function SegmentLabel({ x, y, width, height, value, ink }) {
  if (!value || height < 11 || width < 14) return null;
  return (
    <text
      x={x + width / 2} y={y + height / 2} fill={ink} fontSize={10} fontWeight={600}
      textAnchor="middle" dominantBaseline="central"
    >
      {value}
    </text>
  );
}

/** One category's weeks: the chart, then the same numbers as a table. */
function CategoryStages({ category, rows, view, colors }) {
  const data = rows
    .map(row => {
      const c = categoryCounts(row, category.key);
      return c ? { ...c, week: row.week, source: row.source, label: formatWeekLabel(row.week) } : null;
    })
    .filter(Boolean);
  const axis = {
    x: <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} interval="preserveStartEnd" />,
    y: <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />,
  };
  return (
    <section className={styles.category}>
      <h3 className={styles.categoryTitle}>{category.label}</h3>
      {data.length === 0 ? (
        <p className={styles.empty}>
          No {category.label.toLowerCase()} breakdown recorded for these weeks yet. It starts with
          this week&apos;s reading; &ldquo;Rebuild earlier weeks from backups&rdquo; can fill in older ones.
        </p>
      ) : (
        <>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={260}>
              {view === 'bars' ? (
                <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  {axis.x}
                  {axis.y}
                  <Tooltip content={<StageTooltip colors={colors} />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
                  {STACK.map((stage, i) => (
                    <Bar
                      key={stage.key}
                      dataKey={stage.key}
                      name={stage.label}
                      stackId="stage"
                      fill={colors[stage.key]}
                      // A 2px surface-coloured edge is the gap between stacked
                      // segments, so two similar colours never read as one bar.
                      stroke="#ffffff"
                      strokeWidth={2}
                      radius={i === STACK.length - 1 ? [4, 4, 0, 0] : undefined}
                      isAnimationActive={false}
                    >
                      <LabelList dataKey={stage.key} content={<SegmentLabel ink={labelInk(colors[stage.key])} />} />
                      {/* The week's total over the stack, so it reads even when
                          a thin segment is too short to carry its own count. */}
                      {i === STACK.length - 1 && (
                        <LabelList dataKey="total" position="top" fontSize={11} fontWeight={600} fill="#4b5563" />
                      )}
                    </Bar>
                  ))}
                </BarChart>
              ) : (
                <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  {axis.x}
                  {axis.y}
                  <Tooltip content={<StageTooltip colors={colors} />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
                  {STACK.map(stage => (
                    <Line
                      key={stage.key}
                      type="monotone"
                      dataKey={stage.key}
                      name={stage.label}
                      stroke={colors[stage.key]}
                      strokeWidth={2}
                      dot={data.length <= DOT_LIMIT ? { r: 3, fill: colors[stage.key], stroke: '#ffffff', strokeWidth: 2 } : false}
                      activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>
                {category.label}, most recent week first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  {SERIES.map(stage => (
                    <th scope="col" key={stage.key} className={styles.num}>{stage.label}</th>
                  ))}
                  <th scope="col" className={styles.num}>No stage</th>
                  <th scope="col" className={styles.num}>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().slice(0, TABLE_WEEKS).map(row => (
                  <tr key={row.week}>
                    <th scope="row" className={styles.weekCell}>
                      {formatWeekLabel(row.week, { year: true })}
                      {row.source === 'backup' && (
                        <span className={styles.fromBackup} title="Counted from that week's backup, not recorded live">
                          {' '}from backup
                        </span>
                      )}
                    </th>
                    {SERIES.map(stage => (
                      <td key={stage.key} className={styles.num}>{row[stage.key] || 0}</td>
                    ))}
                    <td className={styles.num}>{row[UNSET_KEY] || 0}</td>
                    <td className={styles.num}>{row.total || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One colour picker per stack segment, plus a reset for any that were changed.
 * Doubles as the legend: each picker is the swatch, in stack order.
 */
function ColorPickers({ overrides, colors, onChange }) {
  return (
    <div className={styles.colorRow}>
      <span>Bar colors (tap a swatch to change):</span>
      {STACK.map(stage => (
        <label key={stage.key} className={styles.colorItem}>
          <input
            type="color"
            value={colors[stage.key]}
            onChange={e => onChange({ ...overrides, [stage.key]: e.target.value })}
            className={styles.colorInput}
            aria-label={`${stage.label} bar color`}
          />
          {stage.label}
        </label>
      ))}
      {Object.keys(overrides).length > 0 && (
        <button type="button" className={styles.colorReset} onClick={() => onChange({})}>
          Reset colors
        </button>
      )}
    </div>
  );
}

export function RecipeStageHistory({ recipes = [] }) {
  const [history, setHistory] = useState(loadStageHistory);
  const [view, setView] = useState('bars'); // 'bars' | 'lines'
  const [range, setRange] = useState(12);
  const [backfill, setBackfill] = useState(null); // null | { busy, done, total, message }
  const [colorOverrides, setColorOverrides] = useState(loadStageColors);
  const colors = useMemo(() => stageColors(colorOverrides), [colorOverrides]);

  function changeColors(next) {
    setColorOverrides(next);
    saveStageColors(next, auth.currentUser?.uid);
  }

  // App records the week whenever the counts move, and a save fires
  // `firestore-sync`; without this the tab would show whatever was cached when
  // Meal History opened.
  useEffect(() => {
    const refresh = () => {
      setHistory(loadStageHistory());
      setColorOverrides(loadStageColors());
    };
    window.addEventListener('firestore-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('firestore-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // The live count, and the series with this week's row forced to match it. The
  // recorded row is normally identical — but if a save hasn't landed yet, the
  // tiles and the last bar must still be telling the same story.
  const current = useMemo(() => countStages(recipes), [recipes]);
  const series = useMemo(() => {
    const rows = Array.isArray(history) ? history : [];
    if (!recipes.length) return rows;
    return upsertWeek(rows, { ...stageSnapshot(recipes), source: rows.find(r => r?.week === weekStart())?.source });
  }, [history, recipes]);

  const shown = useMemo(
    () => (range > 0 ? series.slice(-range) : series),
    [series, range]
  );

  // Movement since the previous recorded week — the point of the whole tab.
  const previous = series.length > 1 ? series[series.length - 2] : null;
  const settledPct = pct(current.nailed, current.total);
  const settledWas = previous ? pct(previous.nailed, previous.total) : null;

  async function runBackfill() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ok = window.confirm(
      'Rebuild the weeks before tracking started?\n\n'
      + "This reads your daily backups — one per week — and counts the stages each snapshot held. "
      + 'Weeks already recorded are left alone. It can take a minute.'
    );
    if (!ok) return;
    setBackfill({ busy: true, done: 0, total: 0, message: 'Looking for backups…' });
    try {
      const backups = await listFullBackups(uid);
      // A week recorded before the common-recipe breakdown existed still gets
      // its backup read, so the breakdown can be filled in beside its counts.
      const todo = backupsToBackfill(backups, series.filter(row => row?.common));
      if (todo.length === 0) {
        setBackfill({ busy: false, message: 'No earlier weeks to rebuild — every backed-up week is already recorded.' });
        return;
      }
      const rows = [];
      for (let i = 0; i < todo.length; i++) {
        const { week, backup } = todo[i];
        setBackfill({ busy: true, done: i, total: todo.length, message: `Reading ${formatWeekLabel(week, { year: true })}…` });
        try {
          const snapshotRecipes = await readBackupValue(uid, backup.id, RECIPES_BACKUP_KEYS);
          // A backup with no recipe cache in it says nothing about that week;
          // an invented zero row would read as "you deleted everything".
          if (Array.isArray(snapshotRecipes) && snapshotRecipes.length > 0) {
            rows.push(backfilledRow(week, snapshotRecipes, backup));
          }
        } catch (err) {
          console.warn(`Backfill skipped ${backup.id}:`, err);
        }
      }
      const { history: merged, added, filled } = mergeMissingWeeks(loadStageHistory(), rows);
      if (added > 0 || filled > 0) {
        saveStageHistory(merged, uid);
        setHistory(merged);
      }
      setBackfill({
        busy: false,
        message: added > 0 || filled > 0
          ? [
            added > 0 && `Rebuilt ${added} earlier week${added === 1 ? '' : 's'} from your backups.`,
            filled > 0 && `Added the breakfast / lunch & dinner breakdown to ${filled} recorded week${filled === 1 ? '' : 's'}.`,
          ].filter(Boolean).join(' ')
          : 'Your backups didn’t hold a recipe snapshot for any missing week.',
      });
    } catch (err) {
      setBackfill({ busy: false, message: `Couldn’t read your backups: ${err?.message || err}` });
    }
  }

  return (
    <div>
      <p className={styles.intro}>
        Where your recipes stand, counted once a week. The current week updates as you
        change a recipe&apos;s Stage; finished weeks stay as they were.
      </p>

      <div className={styles.tiles}>
        {SERIES.map(stage => {
          const now = current[stage.key] || 0;
          const before = previous ? previous[stage.key] || 0 : null;
          const delta = before == null ? null : now - before;
          return (
            <div key={stage.key} className={styles.tile} style={{ borderTopColor: colors[stage.key] }}>
              <span className={styles.tileLabel}>
                <span className={styles.swatch} style={{ background: colors[stage.key] }} aria-hidden="true" />
                {stage.label}
              </span>
              <span className={styles.tileValue}>{now}</span>
              <span className={styles.tileMeta}>
                {pct(now, current.total)}% of {current.total}
                {delta ? (
                  <span className={styles.tileDelta}>
                    {delta > 0 ? '+' : '−'}{Math.abs(delta)} vs last week
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
        <div className={styles.tile} style={{ borderTopColor: colors[UNSET_KEY] }}>
          <span className={styles.tileLabel}>
            <span className={styles.swatch} style={{ background: colors[UNSET_KEY] }} aria-hidden="true" />
            No stage set
          </span>
          <span className={styles.tileValue}>{current[UNSET_KEY] || 0}</span>
          <span className={styles.tileMeta}>{pct(current[UNSET_KEY] || 0, current.total)}% of {current.total}</span>
        </div>
      </div>

      <p className={styles.headline}>
        <strong>{settledPct}%</strong> of your recipes are nailed down
        {settledWas != null && settledWas !== settledPct && (
          <span className={styles.headlineDelta}>
            {settledPct > settledWas ? ' up' : ' down'} from {settledWas}% last week
          </span>
        )}
      </p>

      {shown.length === 0 ? (
        <p className={styles.empty}>
          Nothing recorded yet. The first week lands as soon as your recipes load —
          reopen this tab in a moment.
        </p>
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles.toggleGroup} role="group" aria-label="Chart type">
              <button
                className={`${styles.toggle} ${view === 'bars' ? styles.toggleOn : ''}`}
                onClick={() => setView('bars')}
                aria-pressed={view === 'bars'}
              >
                Stacked bars
              </button>
              <button
                className={`${styles.toggle} ${view === 'lines' ? styles.toggleOn : ''}`}
                onClick={() => setView('lines')}
                aria-pressed={view === 'lines'}
              >
                Lines
              </button>
            </div>
            <div className={styles.toggleGroup} role="group" aria-label="Weeks shown">
              {RANGES.map(r => (
                <button
                  key={r.key}
                  className={`${styles.toggle} ${range === r.key ? styles.toggleOn : ''}`}
                  onClick={() => setRange(r.key)}
                  aria-pressed={range === r.key}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <ColorPickers overrides={colorOverrides} colors={colors} onChange={changeColors} />
          <p className={styles.chartNote}>
            The charts count your common recipes — the ones the Recipes page lists
            under Common — split by meal.
          </p>

          {CATEGORIES.map(category => (
            <CategoryStages key={category.key} category={category} rows={shown} view={view} colors={colors} />
          ))}
        </>
      )}

      <div className={styles.backfill}>
        <button className={styles.backfillBtn} onClick={runBackfill} disabled={backfill?.busy}>
          {backfill?.busy ? 'Rebuilding…' : 'Rebuild earlier weeks from backups'}
        </button>
        {backfill?.busy && backfill.total > 0 && (
          <span className={styles.backfillNote}>{backfill.message} ({backfill.done}/{backfill.total})</span>
        )}
        {backfill && !backfill.busy && <span className={styles.backfillNote}>{backfill.message}</span>}
        {!backfill && (
          <span className={styles.backfillNote}>
            Weekly tracking starts the first time this loads. Your daily backups can fill in the weeks before that.
          </span>
        )}
      </div>
    </div>
  );
}

export default RecipeStageHistory;

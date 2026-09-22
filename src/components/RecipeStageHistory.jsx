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
 * Colours come from RECIPE_STAGES, the same list that paints the chip and the
 * card pill, so a bar can't end up a different colour from the recipe it counts.
 * Green and dark amber sit close together for deuteranopes (ΔE 7.4), so the
 * chart never leans on hue alone: the stack order is fixed (new at the bottom,
 * nailed down on top), every segment is separated by a 2px gap, the legend is
 * always shown, and the same numbers appear as a table underneath.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { auth } from '../firebase';
import { listFullBackups, readBackupValue } from '../utils/firestoreSync';
import { RECIPE_STAGES } from '../utils/recipeStage';
import {
  loadStageHistory, saveStageHistory, countStages, stageSnapshot, weekStart,
  formatWeekLabel, backupsToBackfill, backfilledRow, mergeMissingWeeks,
  upsertWeek, UNSET_KEY,
} from '../utils/recipeStageHistory';
import styles from './RecipeStageHistory.module.css';

// Bottom-to-top in the stack, and left-to-right in the legend: the order a
// recipe travels, so the shape of the chart reads as progress.
const SERIES = RECIPE_STAGES;
const UNSET_COLOR = '#94a3b8';
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
function StageTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>Week of {label}</div>
      {[...SERIES].reverse().map(stage => (
        <div key={stage.key} className={styles.tooltipRow}>
          <span className={styles.swatch} style={{ background: stage.color }} aria-hidden="true" />
          <span className={styles.tooltipLabel}>{stage.label}</span>
          <span className={styles.tooltipValue}>{row[stage.key] || 0}</span>
        </div>
      ))}
      <div className={styles.tooltipFoot}>
        {row[UNSET_KEY] || 0} unstaged · {row.total || 0} recipes
        {row.source === 'backup' ? ' · from backup' : ''}
      </div>
    </div>
  );
}

/** Stack order, left to right — the order a recipe travels. */
function StageLegend() {
  return (
    <ul className={styles.legend}>
      {SERIES.map(stage => (
        <li key={stage.key} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: stage.color }} aria-hidden="true" />
          {stage.label}
        </li>
      ))}
    </ul>
  );
}

export function RecipeStageHistory({ recipes = [] }) {
  const [history, setHistory] = useState(loadStageHistory);
  const [view, setView] = useState('bars'); // 'bars' | 'lines'
  const [range, setRange] = useState(12);
  const [backfill, setBackfill] = useState(null); // null | { busy, done, total, message }

  // App records the week whenever the counts move, and a save fires
  // `firestore-sync`; without this the tab would show whatever was cached when
  // Meal History opened.
  useEffect(() => {
    const refresh = () => setHistory(loadStageHistory());
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
  const chartData = useMemo(
    () => shown.map(row => ({ ...row, label: formatWeekLabel(row.week) })),
    [shown]
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
      const todo = backupsToBackfill(backups, series);
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
      const { history: merged, added } = mergeMissingWeeks(loadStageHistory(), rows);
      if (added > 0) {
        saveStageHistory(merged, uid);
        setHistory(merged);
      }
      setBackfill({
        busy: false,
        message: added > 0
          ? `Rebuilt ${added} earlier week${added === 1 ? '' : 's'} from your backups.`
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
            <div key={stage.key} className={styles.tile} style={{ borderTopColor: stage.color }}>
              <span className={styles.tileLabel}>
                <span className={styles.swatch} style={{ background: stage.color }} aria-hidden="true" />
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
        <div className={styles.tile} style={{ borderTopColor: UNSET_COLOR }}>
          <span className={styles.tileLabel}>
            <span className={styles.swatch} style={{ background: UNSET_COLOR }} aria-hidden="true" />
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

      {chartData.length === 0 ? (
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

          <StageLegend />

          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={280}>
              {view === 'bars' ? (
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                  <Tooltip content={<StageTooltip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
                  {SERIES.map((stage, i) => (
                    <Bar
                      key={stage.key}
                      dataKey={stage.key}
                      name={stage.label}
                      stackId="stage"
                      fill={stage.color}
                      // A 2px surface-coloured edge is the gap between stacked
                      // segments: green and dark amber are close enough under
                      // deuteranopia that a shared border would read as one bar.
                      stroke="#ffffff"
                      strokeWidth={2}
                      radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                  <Tooltip content={<StageTooltip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
                  {SERIES.map(stage => (
                    <Line
                      key={stage.key}
                      type="monotone"
                      dataKey={stage.key}
                      name={stage.label}
                      stroke={stage.color}
                      strokeWidth={2}
                      dot={chartData.length <= DOT_LIMIT ? { r: 3, fill: stage.color, stroke: '#ffffff', strokeWidth: 2 } : false}
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
              The same numbers, most recent week first
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
              {[...shown].reverse().slice(0, TABLE_WEEKS).map(row => (
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

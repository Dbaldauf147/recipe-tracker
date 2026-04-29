import { useMemo, useState } from 'react';
import styles from './BodyHeatmap.module.css';

// Workout MUSCLE_GROUP -> SVG slot ids (+1 each). Used as fallback when an
// entry's exercise can't be matched to the library.
const GROUP_SLOTS = {
  Chest: ['chestL', 'chestR'],
  Back: ['traps', 'latL', 'latR', 'midBack', 'lowerBack'],
  Shoulders: ['frontDeltL', 'frontDeltR', 'rearDeltL', 'rearDeltR'],
  Biceps: ['bicepsL', 'bicepsR'],
  Triceps: ['tricepsL', 'tricepsR'],
  Abs: ['abs', 'obliqueL', 'obliqueR'],
  Forearms: ['forearmFrontL', 'forearmFrontR', 'forearmBackL', 'forearmBackR'],
  Legs: ['quadL', 'quadR', 'gluteL', 'gluteR', 'hamL', 'hamR', 'calfFrontL', 'calfFrontR', 'calfBackL', 'calfBackR'],
};

// Map a free-text muscle name (from the Exercises library's primary/secondary
// columns) to one or more SVG slots. Best-effort regex matching.
function nameToSlots(raw) {
  const m = (raw || '').toLowerCase().trim();
  if (!m) return [];
  const out = new Set();
  if (/pec|chest/.test(m)) { out.add('chestL'); out.add('chestR'); }
  if (/lat\b|latissimus/.test(m)) { out.add('latL'); out.add('latR'); }
  if (/trap/.test(m)) out.add('traps');
  if (/rhomboid|mid[- ]?back|middle back|upper back/.test(m)) out.add('midBack');
  if (/lower back|erector|spinae/.test(m)) out.add('lowerBack');
  if (/anterior delt|front delt/.test(m)) { out.add('frontDeltL'); out.add('frontDeltR'); }
  if (/posterior delt|rear delt/.test(m)) { out.add('rearDeltL'); out.add('rearDeltR'); }
  if (/lateral delt|side delt|medial delt/.test(m)) { out.add('frontDeltL'); out.add('frontDeltR'); }
  if (out.size === 0 && /delt|shoulder/.test(m)) {
    out.add('frontDeltL'); out.add('frontDeltR'); out.add('rearDeltL'); out.add('rearDeltR');
  }
  if (/bicep/.test(m)) { out.add('bicepsL'); out.add('bicepsR'); }
  if (/tricep/.test(m)) { out.add('tricepsL'); out.add('tricepsR'); }
  if (/forearm|brachiorad/.test(m)) {
    out.add('forearmFrontL'); out.add('forearmFrontR'); out.add('forearmBackL'); out.add('forearmBackR');
  }
  if (/abs\b|abdominal|rectus abdom|^core$/.test(m)) out.add('abs');
  if (/oblique/.test(m)) { out.add('obliqueL'); out.add('obliqueR'); }
  if (/quad|rectus femoris|vastus/.test(m)) { out.add('quadL'); out.add('quadR'); }
  if (/glute|buttock|gluteus/.test(m)) { out.add('gluteL'); out.add('gluteR'); }
  if (/ham|biceps femoris|semitend|semimemb/.test(m)) { out.add('hamL'); out.add('hamR'); }
  if (/calf|calves|gastroc|soleus/.test(m)) {
    out.add('calfFrontL'); out.add('calfFrontR'); out.add('calfBackL'); out.add('calfBackR');
  }
  return Array.from(out);
}

function splitMuscles(s) {
  return String(s || '').split(/[,;/&]/).map(x => x.trim()).filter(Boolean);
}

const SLOT_LABELS = {
  chestL: 'Chest', chestR: 'Chest',
  frontDeltL: 'Front Delts', frontDeltR: 'Front Delts',
  bicepsL: 'Biceps', bicepsR: 'Biceps',
  forearmFrontL: 'Forearms', forearmFrontR: 'Forearms',
  abs: 'Abs',
  obliqueL: 'Obliques', obliqueR: 'Obliques',
  quadL: 'Quads', quadR: 'Quads',
  calfFrontL: 'Calves', calfFrontR: 'Calves',
  traps: 'Traps',
  rearDeltL: 'Rear Delts', rearDeltR: 'Rear Delts',
  tricepsL: 'Triceps', tricepsR: 'Triceps',
  forearmBackL: 'Forearms', forearmBackR: 'Forearms',
  latL: 'Lats', latR: 'Lats',
  midBack: 'Mid Back',
  lowerBack: 'Lower Back',
  gluteL: 'Glutes', gluteR: 'Glutes',
  hamL: 'Hamstrings', hamR: 'Hamstrings',
  calfBackL: 'Calves', calfBackR: 'Calves',
};

const WINDOWS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

function inWindow(dateStr, days) {
  if (days == null) return true;
  if (!dateStr) return false;
  const cutoff = Date.now() - days * 86400000;
  const t = new Date(dateStr + 'T00:00:00').getTime();
  return !isNaN(t) && t >= cutoff;
}

function formatCount(n) {
  if (n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function BodyHeatmap({ workouts, exerciseLibrary }) {
  const [windowId, setWindowId] = useState('30d');
  const [hover, setHover] = useState(null);
  const win = WINDOWS.find(w => w.id === windowId) || WINDOWS[1];

  const libBySlot = useMemo(() => {
    const map = {};
    for (const item of exerciseLibrary || []) {
      if (!item?.exercise) continue;
      const key = item.exercise.trim().toLowerCase();
      const primary = splitMuscles(item.primaryMuscles).flatMap(nameToSlots);
      const secondary = splitMuscles(item.secondaryMuscles).flatMap(nameToSlots);
      map[key] = { primary, secondary };
    }
    return map;
  }, [exerciseLibrary]);

  const slotCounts = useMemo(() => {
    const counts = {};
    for (const w of workouts || []) {
      if (!inWindow(w.date, win.days)) continue;
      for (const e of w.entries || []) {
        const key = e.exercise ? e.exercise.trim().toLowerCase() : '';
        const lib = libBySlot[key];
        let added = false;
        if (lib && (lib.primary.length || lib.secondary.length)) {
          for (const s of lib.primary) counts[s] = (counts[s] || 0) + 1;
          for (const s of lib.secondary) counts[s] = (counts[s] || 0) + 0.5;
          added = true;
        }
        if (!added) {
          const slots = GROUP_SLOTS[e.group];
          if (slots) for (const s of slots) counts[s] = (counts[s] || 0) + 1;
        }
      }
    }
    return counts;
  }, [workouts, win.days, libBySlot]);

  const max = Math.max(0, ...Object.values(slotCounts));

  function fillFor(slot) {
    const n = slotCounts[slot] || 0;
    if (max === 0 || n === 0) return 'var(--color-surface-alt)';
    const t = n / max;
    const pct = Math.round(22 + t * 78);
    return `color-mix(in srgb, var(--color-accent) ${pct}%, var(--color-surface-alt))`;
  }

  function bind(slot) {
    return {
      style: { fill: fillFor(slot) },
      onMouseEnter: ev => setHover({ slot, x: ev.clientX, y: ev.clientY }),
      onMouseMove: ev => setHover(prev => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev)),
      onMouseLeave: () => setHover(null),
      className: styles.muscle,
    };
  }

  const totalEngagements = Object.values(slotCounts).reduce((a, b) => a + b, 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <span className={styles.controlsLabel}>Window</span>
        {WINDOWS.map(w => (
          <button
            key={w.id}
            type="button"
            className={`${styles.windowBtn} ${windowId === w.id ? styles.windowBtnActive : ''}`}
            onClick={() => setWindowId(w.id)}
          >
            {w.label}
          </button>
        ))}
        <span className={styles.summary}>
          {formatCount(totalEngagements)} muscle-engagements
        </span>
      </div>

      <div className={styles.bodies}>
        <div className={styles.bodyCol}>
          <div className={styles.bodyLabel}>Front</div>
          <svg viewBox="0 0 220 480" className={styles.body} aria-label="Front body heatmap">
            <g className={styles.silhouette}>
              <ellipse cx="110" cy="36" rx="26" ry="30" />
              <path d="M 100 62 Q 100 76 110 78 Q 120 76 120 62 Z" />
              <path d="M 60 86 Q 92 74 110 75 Q 128 74 160 86
                       Q 168 110 170 140 Q 169 188 165 232
                       L 110 244 L 55 232
                       Q 51 188 50 140 Q 52 110 60 86 Z" />
              <path d="M 60 86 Q 50 100 46 130 Q 41 175 38 220
                       Q 36 248 32 256 Q 28 260 26 256 Q 22 250 24 240
                       Q 30 200 35 165 Q 40 122 50 96 Z" />
              <path d="M 160 86 Q 170 100 174 130 Q 179 175 182 220
                       Q 184 248 188 256 Q 192 260 194 256 Q 198 250 196 240
                       Q 190 200 185 165 Q 180 122 170 96 Z" />
              <path d="M 55 232 L 110 244 L 165 232
                       Q 164 258 160 280 Q 138 292 110 292 Q 82 292 60 280
                       Q 56 258 55 232 Z" />
              <path d="M 60 282 Q 56 320 60 380 Q 64 440 68 466
                       Q 70 472 80 472 Q 88 472 90 466 Q 96 420 100 372
                       Q 104 322 108 290 L 110 290 Z" />
              <path d="M 160 282 Q 164 320 160 380 Q 156 440 152 466
                       Q 150 472 140 472 Q 132 472 130 466 Q 124 420 120 372
                       Q 116 322 112 290 L 110 290 Z" />
            </g>

            <g>
              <path {...bind('chestL')} d="M 70 95 Q 90 88 106 96 Q 108 116 100 130 Q 84 134 72 124 Q 66 110 70 95 Z" />
              <path {...bind('chestR')} d="M 150 95 Q 130 88 114 96 Q 112 116 120 130 Q 136 134 148 124 Q 154 110 150 95 Z" />
              <ellipse {...bind('frontDeltL')} cx="58" cy="100" rx="14" ry="16" />
              <ellipse {...bind('frontDeltR')} cx="162" cy="100" rx="14" ry="16" />
              <ellipse {...bind('bicepsL')} cx="42" cy="140" rx="9" ry="22" />
              <ellipse {...bind('bicepsR')} cx="178" cy="140" rx="9" ry="22" />
              <ellipse {...bind('forearmFrontL')} cx="35" cy="200" rx="8" ry="24" />
              <ellipse {...bind('forearmFrontR')} cx="185" cy="200" rx="8" ry="24" />
              <path {...bind('abs')} d="M 92 138 Q 92 132 110 132 Q 128 132 128 138 L 128 224 Q 110 232 92 224 Z" />
              <ellipse {...bind('obliqueL')} cx="78" cy="190" rx="8" ry="26" />
              <ellipse {...bind('obliqueR')} cx="142" cy="190" rx="8" ry="26" />
              <ellipse {...bind('quadL')} cx="85" cy="335" rx="20" ry="46" />
              <ellipse {...bind('quadR')} cx="135" cy="335" rx="20" ry="46" />
              <ellipse {...bind('calfFrontL')} cx="82" cy="430" rx="13" ry="28" />
              <ellipse {...bind('calfFrontR')} cx="138" cy="430" rx="13" ry="28" />
            </g>
          </svg>
        </div>

        <div className={styles.bodyCol}>
          <div className={styles.bodyLabel}>Back</div>
          <svg viewBox="0 0 220 480" className={styles.body} aria-label="Back body heatmap">
            <g className={styles.silhouette}>
              <ellipse cx="110" cy="36" rx="26" ry="30" />
              <path d="M 100 62 Q 100 76 110 78 Q 120 76 120 62 Z" />
              <path d="M 60 86 Q 92 74 110 75 Q 128 74 160 86
                       Q 168 110 170 140 Q 169 188 165 232
                       L 110 244 L 55 232
                       Q 51 188 50 140 Q 52 110 60 86 Z" />
              <path d="M 60 86 Q 50 100 46 130 Q 41 175 38 220
                       Q 36 248 32 256 Q 28 260 26 256 Q 22 250 24 240
                       Q 30 200 35 165 Q 40 122 50 96 Z" />
              <path d="M 160 86 Q 170 100 174 130 Q 179 175 182 220
                       Q 184 248 188 256 Q 192 260 194 256 Q 198 250 196 240
                       Q 190 200 185 165 Q 180 122 170 96 Z" />
              <path d="M 55 232 L 110 244 L 165 232
                       Q 164 258 160 280 Q 138 292 110 292 Q 82 292 60 280
                       Q 56 258 55 232 Z" />
              <path d="M 60 282 Q 56 320 60 380 Q 64 440 68 466
                       Q 70 472 80 472 Q 88 472 90 466 Q 96 420 100 372
                       Q 104 322 108 290 L 110 290 Z" />
              <path d="M 160 282 Q 164 320 160 380 Q 156 440 152 466
                       Q 150 472 140 472 Q 132 472 130 466 Q 124 420 120 372
                       Q 116 322 112 290 L 110 290 Z" />
            </g>

            <g>
              <path {...bind('traps')} d="M 80 80 Q 110 70 140 80 Q 138 105 110 116 Q 82 105 80 80 Z" />
              <ellipse {...bind('rearDeltL')} cx="58" cy="100" rx="14" ry="16" />
              <ellipse {...bind('rearDeltR')} cx="162" cy="100" rx="14" ry="16" />
              <ellipse {...bind('tricepsL')} cx="42" cy="140" rx="9" ry="22" />
              <ellipse {...bind('tricepsR')} cx="178" cy="140" rx="9" ry="22" />
              <ellipse {...bind('forearmBackL')} cx="35" cy="200" rx="8" ry="24" />
              <ellipse {...bind('forearmBackR')} cx="185" cy="200" rx="8" ry="24" />
              <path {...bind('latL')} d="M 76 118 Q 70 140 70 170 Q 74 196 92 200 Q 100 184 102 156 Q 100 130 92 116 Q 82 116 76 118 Z" />
              <path {...bind('latR')} d="M 144 118 Q 150 140 150 170 Q 146 196 128 200 Q 120 184 118 156 Q 120 130 128 116 Q 138 116 144 118 Z" />
              <ellipse {...bind('midBack')} cx="110" cy="150" rx="14" ry="20" />
              <ellipse {...bind('lowerBack')} cx="110" cy="210" rx="22" ry="16" />
              <ellipse {...bind('gluteL')} cx="86" cy="262" rx="22" ry="24" />
              <ellipse {...bind('gluteR')} cx="134" cy="262" rx="22" ry="24" />
              <ellipse {...bind('hamL')} cx="85" cy="335" rx="20" ry="46" />
              <ellipse {...bind('hamR')} cx="135" cy="335" rx="20" ry="46" />
              <ellipse {...bind('calfBackL')} cx="82" cy="430" rx="14" ry="32" />
              <ellipse {...bind('calfBackR')} cx="138" cy="430" rx="14" ry="32" />
            </g>
          </svg>
        </div>
      </div>

      {hover && (
        <div className={styles.tooltip} style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className={styles.tooltipName}>{SLOT_LABELS[hover.slot] || hover.slot}</div>
          <div className={styles.tooltipCount}>
            {formatCount(slotCounts[hover.slot] || 0)} {(slotCounts[hover.slot] || 0) === 1 ? 'time' : 'times'} · {win.label}
          </div>
        </div>
      )}

      <div className={styles.legend}>
        <span className={styles.legendLabel}>Less</span>
        <div className={styles.legendBar}>
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <div
              key={t}
              className={styles.legendChip}
              style={{
                background: t === 0
                  ? 'var(--color-surface-alt)'
                  : `color-mix(in srgb, var(--color-accent) ${Math.round(22 + t * 78)}%, var(--color-surface-alt))`,
              }}
            />
          ))}
        </div>
        <span className={styles.legendLabel}>More</span>
        {max > 0 && <span className={styles.legendMax}>max {formatCount(max)}</span>}
      </div>

      {totalEngagements === 0 && (
        <div className={styles.empty}>
          No workouts logged in this window. Switch to a longer window or log a workout to start filling in the heatmap.
        </div>
      )}
    </div>
  );
}

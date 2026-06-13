// Front/back body map highlighting the muscles an exercise targets — built on
// the same realistic `react-body-highlighter` model the workout heatmap uses,
// so it matches the rest of the site. Primary muscles render in the solid
// accent, secondary in a lighter tint. Muscle names (from the demo match or the
// library's Primary/Secondary columns) are mapped to the model's muscle ids via
// the shared nameToMuscles helper.
import Model from 'react-body-highlighter';
import { nameToMuscles, splitMuscles } from './BodyHeatmap';

const PRIMARY_COLOR = '#3B6B9C';
const SECONDARY_COLOR = '#A8C4DE';
const BODY_COLOR = '#EBF0F5';

// Accepts an array, or a free-text string like "Chest, Triceps and Shoulders".
export function toMuscleList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return splitMuscles(value);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

export function MuscleBodyMap({ primary = [], secondary = [] }) {
  const primaryIds = uniq(toMuscleList(primary).flatMap(nameToMuscles));
  const primarySet = new Set(primaryIds);
  // A muscle that's both primary and secondary should read as primary only.
  const secondaryIds = uniq(toMuscleList(secondary).flatMap(nameToMuscles)).filter(id => !primarySet.has(id));

  if (primaryIds.length === 0 && secondaryIds.length === 0) return null;

  // highlightedColors[min(len-1, frequency-1)] selects the fill: freq 1 →
  // secondary tint, freq 2 → solid primary.
  const data = [];
  if (secondaryIds.length) data.push({ name: 'Secondary', muscles: secondaryIds, frequency: 1 });
  if (primaryIds.length) data.push({ name: 'Primary', muscles: primaryIds, frequency: 2 });

  const modelProps = {
    data,
    bodyColor: BODY_COLOR,
    highlightedColors: [SECONDARY_COLOR, PRIMARY_COLOR],
    style: { width: '100%' },
  };

  const col = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 130, maxWidth: '46%' };
  const label = { fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)' };
  const legendItem = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-secondary, #475569)' };
  const swatch = c => ({ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' });

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18 }}>
        <div style={col}>
          <Model {...modelProps} type="anterior" />
          <span style={label}>Front</span>
        </div>
        <div style={col}>
          <Model {...modelProps} type="posterior" />
          <span style={label}>Back</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6 }}>
        <span style={legendItem}><span style={swatch(PRIMARY_COLOR)} /> Primary</span>
        <span style={legendItem}><span style={swatch(SECONDARY_COLOR)} /> Secondary</span>
      </div>
    </div>
  );
}

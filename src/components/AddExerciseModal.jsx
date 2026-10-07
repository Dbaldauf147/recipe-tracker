import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EXERCISE_TYPES } from '../utils/exerciseTypes';
import { buildNewExercise, validateNewExercise } from '../utils/newExercise';

/**
 * The one "add a new exercise" form, used by every add button: the Exercise
 * Library's "+ Add exercise" and both add buttons on the Log Workout page.
 * It asks for the fields up front instead of dropping in a blank table row or
 * taking just a name — an exercise added with no muscle group or type is the
 * one the picker can't file and the KPI tabs can't count.
 *
 * Portalled to <body> above everything (the workout picker it can open from is
 * itself a z-index 10000 overlay).
 *
 *   initial       { exercise?, muscleGroup?, exerciseType? } — prefilled from
 *                 where it was opened (the group you were in, what you typed)
 *   muscleGroups  suggestions for the Muscle Group box (free text still allowed)
 *   existingNames every exercise name already in the library, for the
 *                 duplicate check
 *   lockMuscleGroup / lockType  show those prefilled values read-only — the
 *                 workout picker adds INTO the group (and type) you're in
 *   onSave(row)   gets a full library row; return a string to show it as an
 *                 error and keep the form open, anything else closes it
 */
export function AddExerciseModal({ initial = {}, muscleGroups = [], existingNames = [], lockMuscleGroup = false, lockType = false, onSave, onClose }) {
  const [values, setValues] = useState(() => ({
    exercise: initial.exercise || '',
    exerciseType: initial.exerciseType || '',
    muscleGroup: initial.muscleGroup || '',
    primaryMuscles: '',
    secondaryMuscles: '',
    alternative: '',
    nickname: '',
    videos: '',
    top: false,
  }));
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  const set = (k, v) => { setValues(prev => ({ ...prev, [k]: v })); setError(''); };

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    // Capture phase, so Escape closes this form and not the picker under it.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function submit(e) {
    e?.preventDefault();
    const problem = validateNewExercise(values, existingNames);
    if (problem) { setError(problem); return; }
    const result = onSave(buildNewExercise(values));
    if (typeof result === 'string') { setError(result); return; }
    onClose();
  }

  const label = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)', marginBottom: 4 };
  const input = {
    width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem', fontSize: '0.9rem',
    border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
    background: 'var(--color-surface, #fff)', color: 'var(--color-text, #0f172a)',
  };
  const field = (key, text, props = {}) => (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={label} htmlFor={`addex-${key}`}>{text}</label>
      <input id={`addex-${key}`} style={input} value={values[key]} onChange={e => set(key, e.target.value)} {...props} />
    </div>
  );

  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <form
        onMouseDown={e => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addex-title"
        style={{ width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--color-surface, #fff)', color: 'var(--color-text, #0f172a)', borderRadius: 14, padding: '1.1rem 1.2rem', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h3 id="addex-title" style={{ margin: 0, fontSize: '1.1rem', flex: 1 }}>Add a new exercise</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--color-text-muted, #64748b)' }}>✕</button>
        </div>

        {field('exercise', 'Exercise name *', { ref: nameRef, placeholder: 'e.g. Incline Dumbbell Press' })}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', marginBottom: '0.75rem' }}>
            <label style={label} htmlFor="addex-type">Type</label>
            <select id="addex-type" style={input} disabled={lockType} value={values.exerciseType} onChange={e => set('exerciseType', e.target.value)}>
              <option value="">Auto (guess from the name)</option>
              {EXERCISE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px', marginBottom: '0.75rem' }}>
            <label style={label} htmlFor="addex-muscleGroup">Muscle group</label>
            <input id="addex-muscleGroup" style={lockMuscleGroup ? { ...input, opacity: 0.7 } : input} readOnly={lockMuscleGroup} list="addex-groups" value={values.muscleGroup} onChange={e => set('muscleGroup', e.target.value)} placeholder="e.g. Chest" />
            <datalist id="addex-groups">{muscleGroups.map(g => <option key={g} value={g} />)}</datalist>
          </div>
        </div>

        {field('primaryMuscles', 'Primary muscles', { placeholder: 'e.g. Upper chest, front delts' })}
        {field('secondaryMuscles', 'Secondary muscles', { placeholder: 'e.g. Triceps' })}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>{field('alternative', 'Alternative', { placeholder: 'A swap if the kit is taken' })}</div>
          <div style={{ flex: '1 1 200px' }}>{field('nickname', 'Nickname', { placeholder: 'Optional' })}</div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={label} htmlFor="addex-videos">Video links</label>
          <textarea
            id="addex-videos"
            style={{ ...input, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }}
            value={values.videos}
            onChange={e => set('videos', e.target.value)}
            placeholder="One per line (or comma-separated) — YouTube, Instagram, TikTok…"
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', marginBottom: '0.9rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={values.top} onChange={e => set('top', e.target.checked)} />
          Top exercise (show it in “Top only”)
        </label>

        {error && (
          <div role="alert" style={{ marginBottom: '0.8rem', padding: '0.5rem 0.7rem', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ border: '1px solid var(--color-border, #e2e8f0)', background: 'var(--color-surface, #fff)', color: 'var(--color-text, #0f172a)', borderRadius: 8, padding: '0.5rem 0.95rem', cursor: 'pointer', fontSize: '0.88rem' }}>
            Cancel
          </button>
          <button type="submit" style={{ border: 'none', background: '#111', color: '#fff', borderRadius: 8, padding: '0.5rem 1.05rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 }}>
            Add exercise
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

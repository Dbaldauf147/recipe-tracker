// "Range of motion" — the reference half of the Stretch page.
//
// The goal board above tracks a DOSE (minutes held per region). This tracks a
// CAPACITY: how far the joint actually moves, measured occasionally against a
// target and a floor. Two different questions, so two different cards.
//
// Each entry is one test with its reference picture. The picture is the point —
// an angle means nothing without the position it's measured from — so a test
// whose image hasn't been added yet says so plainly instead of rendering a
// broken <img>.
import { useState } from 'react';
import styles from './RangeOfMotionGuide.module.css';
import { ROM_TESTS, classifyRom, romRangeLabel, ROM_STATUS_META } from '../utils/rangeOfMotion';

function RomCard({ test }) {
  // Measured values are deliberately NOT persisted yet — this is a reference
  // card you can check yourself against, and storing a number would need a
  // synced field and a history view to be worth anything.
  const [measured, setMeasured] = useState('');
  const status = classifyRom(measured, test);
  const meta = status ? ROM_STATUS_META[status] : null;
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = !!test.image && !imageBroken;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.muscle}>{test.muscle}</div>
          <div className={styles.test}>{test.test} · {test.region}</div>
        </div>
        <div className={styles.band} title="Floor to target">
          {romRangeLabel(test)}
        </div>
      </div>

      {showImage ? (
        <img
          className={styles.image}
          src={test.image}
          alt={`${test.muscle} — ${test.test} range of motion`}
          loading="lazy"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <div className={styles.imageMissing}>
          Reference image not added yet.
          <span className={styles.imagePath}>{test.image || 'no path set'}</span>
        </div>
      )}

      {(test.startText || test.endText) && (
        <dl className={styles.steps}>
          {test.startText && (<><dt className={styles.stepLabel}>Start</dt><dd className={styles.stepText}>{test.startText}</dd></>)}
          {test.endText && (<><dt className={styles.stepLabel}>End</dt><dd className={styles.stepText}>{test.endText}</dd></>)}
        </dl>
      )}

      <div className={styles.measureRow}>
        <label className={styles.measureLabel} htmlFor={`rom-${test.id}`}>Your measurement</label>
        <input
          id={`rom-${test.id}`}
          className={styles.measureInput}
          type="number"
          inputMode="numeric"
          value={measured}
          onChange={e => setMeasured(e.target.value)}
          placeholder="—"
          aria-label={`${test.muscle} measurement in degrees`}
        />
        <span className={styles.unit}>{test.unit}</span>
        {meta && (
          <span className={styles.status} style={{ color: meta.color, borderColor: meta.color + '66', background: meta.color + '14' }}>
            {meta.label}
          </span>
        )}
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span className={styles.scaleEnd}>min {test.min}{test.unit}</span>
        <span className={styles.scaleTrack} />
        <span className={styles.scaleEnd}>target {test.target}{test.unit}</span>
      </div>

      {Array.isArray(test.tips) && test.tips.length > 0 && (
        <ul className={styles.tips}>
          {test.tips.map(t => <li key={t}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

export function RangeOfMotionGuide() {
  const [open, setOpen] = useState(false);
  if (ROM_TESTS.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={styles.title}>Range of motion</span>
        <span className={styles.count}>
          {ROM_TESTS.length} {ROM_TESTS.length === 1 ? 'test' : 'tests'}
        </span>
        <span className={styles.chev}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.cards}>
          {ROM_TESTS.map(t => <RomCard key={t.id} test={t} />)}
        </div>
      )}
    </div>
  );
}

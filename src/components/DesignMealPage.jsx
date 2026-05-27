import React from 'react';

// Placeholder so the production build resolves. Real Design-a-Meal
// implementation is still WIP — this surface keeps the route navigable
// without crashing.
export function DesignMealPage({ onBack }) {
  return (
    <div style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: '0.5rem 0',
          fontSize: '0.95rem',
        }}
      >
        ← Back
      </button>
      <h1 style={{ marginTop: '1rem' }}>Design a Meal</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Coming soon.
      </p>
    </div>
  );
}

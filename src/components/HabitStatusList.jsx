/**
 * Habits → KPI: the habits behind one clicked data point — a "By status" bar or
 * a segment of "By status over time". Names open the habit popup when the
 * habit still exists; ones read from an old backup that have since been
 * deleted are listed but not clickable.
 */
import { canonStatus, statusHistoryColor } from '../utils/habitStatusHistory';

export function HabitStatusList({ status, title, note, habits, currentById, loading, error, onOpen, onClear }) {
  const list = [...(habits || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return (
    <div style={{ margin: '0.6rem 0 0.4rem', border: '1px solid var(--color-border, #e2e8f0)', borderLeft: `4px solid ${statusHistoryColor(status)}`, borderRadius: 10, padding: '0.6rem 0.8rem', background: 'var(--color-surface, #fff)', maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.86rem' }}>{title}</strong>
        {!loading && !error && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>{list.length} {list.length === 1 ? 'habit' : 'habits'}</span>}
        <button
          type="button"
          onClick={onClear}
          style={{ marginLeft: 'auto', border: '1px solid var(--color-border, #e2e8f0)', background: 'transparent', borderRadius: 999, padding: '1px 9px', fontSize: '0.74rem', cursor: 'pointer', color: 'var(--color-text-secondary, #475569)' }}
        >
          Clear
        </button>
      </div>
      {note && <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted, #64748b)', marginTop: 2 }}>{note}</div>}
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)', marginTop: 6 }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: 6 }}>{error}</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)', marginTop: 6 }}>None.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {list.map(h => {
            const now = currentById?.get(h.id);
            const moved = now && canonStatus(now.status) !== canonStatus(h.status);
            const meta = [(h.cadence || '').trim(), (h.routine || '').trim()].filter(Boolean).join(' · ');
            return (
              <li key={h.id || h.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '0.84rem' }}>
                {now && onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(h.id)}
                    title="Open this habit"
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600, color: 'var(--color-text, #0f172a)', textAlign: 'left' }}
                  >
                    {now.name || h.name || 'Untitled'}
                  </button>
                ) : (
                  <span style={{ fontWeight: 600, color: now ? 'inherit' : '#94a3b8' }} title={now ? undefined : 'Deleted since'}>
                    {h.name || 'Untitled'}
                  </span>
                )}
                {meta && <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted, #64748b)' }}>{meta}</span>}
                {moved && (
                  <span style={{ fontSize: '0.72rem', color: statusHistoryColor(canonStatus(now.status)), fontWeight: 600 }}>
                    now {canonStatus(now.status)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

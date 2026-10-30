// The status dropdown used across the Habits page. A custom menu rather than a
// native <select> because it shows, per option, how many habits are on that
// status, with a hover list of which ones, and ends in "Edit options…", where
// the menu's options themselves are set (utils/habitStatusOptions.js).
//
// The menu is portalled to <body> with fixed positioning: the status controls
// sit inside the Habits table's overflow:auto wrapper, which would clip it.
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { statusNameTaken } from '../utils/habitStatusOptions';
import { HabitStatusContext } from './habitStatusContext';


const HOVER_LIST_MAX = 25;

export function StatusSelect({ value, muted, onChange }) {
  const { options, byStatus, colorOf } = useContext(HabitStatusContext);
  const v = (value || '').trim();
  // Keep a habit's current value in the list even if it's a legacy status or
  // one since removed from the menu, so editing never silently drops it.
  const opts = !v || options.includes(v) ? options : [v, ...options];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const flyRef = useRef(null);

  // Placed from the button's rect at the moment it's clicked, rather than in
  // an effect: the menu only has to land in the right spot when it opens.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    const menuH = Math.min(420, 40 + opts.length * 30);
    const below = window.innerHeight - r.bottom;
    const top = below >= menuH || below > r.top ? r.bottom + 4 : Math.max(8, r.top - menuH - 4);
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)) });
    setOpen(true);
  };
  // The hover list sits beside the hovered row, flipping left when there is
  // no room on the right.
  const hoverRow = (s, el) => {
    const row = el.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const n = Math.min((byStatus[s] || []).length, HOVER_LIST_MAX);
    setHovered({
      status: s,
      top: Math.max(8, Math.min(row.top, window.innerHeight - 40 - n * 22)),
      left: Math.max(8, menu.right + 264 < window.innerWidth ? menu.right + 4 : menu.left - 264),
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target) || flyRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Scrolling anything but the menu itself moves the button out from under
    // a fixed-position menu, so just close it.
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target) && !flyRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const pick = (s) => {
    setOpen(false);
    setHovered(null);
    if (s !== v) onChange(s);
  };

  const hoverList = hovered ? (byStatus[hovered.status] || []) : [];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        style={{
          fontSize: '0.78rem', fontWeight: 600, padding: '3px 6px', borderRadius: 6,
          border: '1px solid var(--color-border, #e2e8f0)',
          background: muted ? 'transparent' : 'var(--color-surface, #fff)',
          color: muted ? '#94a3b8' : 'var(--color-text, #1e293b)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'inherit', whiteSpace: 'nowrap', maxWidth: '100%',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v || '—'}</span>
        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
      </button>
      {open && pos && createPortal(
        <>
          <div
            ref={menuRef}
            role="listbox"
            onMouseLeave={(e) => { if (!flyRef.current?.contains(e.relatedTarget)) setHovered(null); }}
            style={{
              position: 'fixed', top: pos.top, left: pos.left, zIndex: 3000, width: 240, maxHeight: 420,
              overflowY: 'auto', background: 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)', padding: 4,
            }}
          >
            {opts.map(s => {
              const count = (byStatus[s] || []).length;
              const color = colorOf(s);
              const active = s === v;
              return (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-status={s}
                  onClick={() => pick(s)}
                  onMouseEnter={(e) => hoverRow(s, e.currentTarget)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
                    border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: active ? 700 : 500,
                    color: 'var(--color-text, #1e293b)',
                    background: hovered?.status === s ? 'var(--color-surface-alt, #f1f5f9)' : 'transparent',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: color || '#cbd5e1' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {active ? '✓ ' : ''}{s}
                  </span>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, minWidth: 22, textAlign: 'center', padding: '1px 6px',
                    borderRadius: 999, color: count ? (color || '#475569') : '#94a3b8',
                    background: count ? (color || '#64748b') + '1a' : 'transparent',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
            <div style={{ height: 1, background: 'var(--color-border, #e2e8f0)', margin: '4px 2px' }} />
            <button
              type="button"
              onClick={() => { setOpen(false); setHovered(null); setEditing(true); }}
              onMouseEnter={() => setHovered(null)}
              style={{
                display: 'block', width: '100%', padding: '5px 8px', border: 'none', borderRadius: 6,
                background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-accent, #2563eb)',
              }}
            >
              ✎ Edit options…
            </button>
          </div>
          {hovered && hoverList.length > 0 && (
            <div
              ref={flyRef}
              onMouseLeave={(e) => { if (!menuRef.current?.contains(e.relatedTarget)) setHovered(null); }}
              style={{
                position: 'fixed', top: hovered.top, left: hovered.left, zIndex: 3001, width: 260,
                maxHeight: '60vh', overflowY: 'auto', background: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)', padding: '6px 10px',
              }}
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted, #64748b)', marginBottom: 4 }}>
                {hovered.status} · {hoverList.length}
              </div>
              {hoverList.slice(0, HOVER_LIST_MAX).map(h => (
                <div key={h.id} style={{ fontSize: '0.8rem', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.name || 'Untitled habit'}
                </div>
              ))}
              {hoverList.length > HOVER_LIST_MAX && (
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted, #64748b)', paddingTop: 2 }}>
                  +{hoverList.length - HOVER_LIST_MAX} more
                </div>
              )}
            </div>
          )}
        </>,
        document.body,
      )}
      {editing && <StatusOptionsEditor onClose={() => setEditing(false)} />}
    </>
  );
}

// Add, rename, reorder and remove the menu's options. Built-in statuses can be
// moved or taken off the menu but not renamed (see habitStatusOptions.js).
// Removing an option never touches a habit — habits already on it keep it,
// and their own menu still shows it.
function StatusOptionsEditor({ onClose }) {
  const { options, builtIns, byStatus, colorOf, onSave } = useContext(HabitStatusContext);
  // Each row remembers the name it started with, so a rename can be carried
  // over to the habits on it when you save.
  const [rows, setRows] = useState(() => options.map(s => ({ orig: s, name: s })));
  const [newName, setNewName] = useState('');
  const isBuiltIn = (s) => builtIns.includes(s);
  const hidden = builtIns.filter(b => !rows.some(r => r.orig === b));

  const names = rows.map(r => r.name.trim());
  const dupe = names.find((n, i) => n && names.findIndex(m => m.toLowerCase() === n.toLowerCase()) !== i);
  const blank = names.some(n => !n);
  const canSave = !dupe && !blank && rows.length > 0;

  const move = (i, d) => setRows(prev => {
    const j = i + d;
    if (j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const add = (name) => {
    const n = name.trim();
    if (!n || statusNameTaken(names, n)) return;
    setRows(prev => [...prev, { orig: null, name: n }]);
    setNewName('');
  };
  const save = () => {
    if (!canSave) return;
    const renames = rows
      .filter(r => r.orig && !isBuiltIn(r.orig) && r.name.trim() !== r.orig)
      .map(r => [r.orig, r.name.trim()]);
    onSave(rows.map(r => r.name.trim()), renames);
    onClose();
  };

  const inputStyle = {
    flex: 1, minWidth: 0, fontSize: '0.85rem', padding: '4px 8px', borderRadius: 6,
    border: '1px solid var(--color-border, #e2e8f0)', fontFamily: 'inherit',
    background: 'var(--color-surface, #fff)', color: 'var(--color-text, #1e293b)',
  };
  const iconBtn = {
    border: '1px solid var(--color-border, #e2e8f0)', background: 'var(--color-surface, #fff)',
    borderRadius: 6, cursor: 'pointer', fontSize: '0.72rem', padding: '3px 7px', fontFamily: 'inherit',
    color: 'var(--color-text, #1e293b)',
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ width: 'min(460px, 100%)', maxHeight: '85vh', overflowY: 'auto', background: 'var(--color-surface, #fff)', borderRadius: 12, padding: '1rem 1.1rem', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.25)' }}>
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem' }}>Status options</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>
          Set what the status menu offers, in order. Built-in statuses (🔒) drive features like the
          Current tab and Automatically, so they can be moved or removed but not renamed. Removing an
          option doesn't change any habit already on it.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => {
            const locked = r.orig && isBuiltIn(r.orig);
            const count = r.orig ? (byStatus[r.orig] || []).length : 0;
            return (
              <div key={r.orig || `new-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: colorOf(r.orig) || '#cbd5e1' }} />
                {locked ? (
                  <span style={{ ...inputStyle, border: '1px solid transparent', background: 'transparent' }}>🔒 {r.name}</span>
                ) : (
                  <input
                    value={r.name}
                    onChange={e => setRows(prev => prev.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
                    style={inputStyle}
                  />
                )}
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #64748b)', minWidth: 52, textAlign: 'right' }}>
                  {count} habit{count === 1 ? '' : 's'}
                </span>
                <button type="button" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} title="Move up">▲</button>
                <button type="button" style={iconBtn} disabled={i === rows.length - 1} onClick={() => move(i, 1)} title="Move down">▼</button>
                <button
                  type="button"
                  style={{ ...iconBtn, color: '#dc2626' }}
                  onClick={() => setRows(prev => prev.filter((_, k) => k !== i))}
                  title={count ? `Remove from the menu — the ${count} habit${count === 1 ? '' : 's'} on it keep it` : 'Remove from the menu'}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(newName); }}
            placeholder="New status…"
            style={inputStyle}
          />
          <button type="button" style={iconBtn} onClick={() => add(newName)} disabled={!newName.trim() || statusNameTaken(names, newName)}>
            + Add
          </button>
        </div>
        {hidden.length > 0 && (
          <div style={{ marginTop: 10, fontSize: '0.76rem', color: 'var(--color-text-muted, #64748b)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            Removed built-ins:
            {hidden.map(b => (
              <button key={b} type="button" style={iconBtn} onClick={() => setRows(prev => [...prev, { orig: b, name: b }])}>
                + {b}
              </button>
            ))}
          </div>
        )}
        {(dupe || blank) && (
          <div style={{ marginTop: 8, fontSize: '0.76rem', color: '#dc2626' }}>
            {blank ? 'Every option needs a name.' : `"${dupe}" is in the list twice.`}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" style={{ ...iconBtn, fontSize: '0.85rem', padding: '6px 12px' }} onClick={onClose}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            style={{ ...iconBtn, fontSize: '0.85rem', padding: '6px 12px', background: canSave ? 'var(--color-accent, #2563eb)' : '#cbd5e1', color: '#fff', borderColor: 'transparent', fontWeight: 600 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

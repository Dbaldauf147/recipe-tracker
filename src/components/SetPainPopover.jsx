import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SetPainPopover.module.css';

// "Felt pain on this set" + where, opened from a set cell's ! button on the
// workout log and History tables. Portalled to <body> with position: fixed so
// the tables' scroll boxes can't clip it, and kept pinned to the button while
// the page scrolls. The note commits on blur / Enter / close, not per key, so
// the trimmed value is what gets stored (utils/setPain.js).
export function SetPainPopover({ anchorEl, title, pain, onChange, onClose }) {
  const ref = useRef(null);
  const [note, setNote] = useState(pain?.note || '');
  const [style, setStyle] = useState(() => place(anchorEl));
  // Latest values for the document listeners and the blur/close commit.
  const noteRef = useRef(note);
  const painRef = useRef(pain);
  const closeRef = useRef(null);

  function commitNote() {
    if (painRef.current && (painRef.current.note || '') !== noteRef.current.trim()) {
      onChange({ note: noteRef.current });
    }
  }

  function close() {
    commitNote();
    onClose();
  }

  useLayoutEffect(() => {
    noteRef.current = note;
    painRef.current = pain;
    closeRef.current = close;
  });

  useEffect(() => {
    function follow() {
      if (!anchorEl.isConnected) { closeRef.current(); return; }
      setStyle(place(anchorEl));
    }
    function outside(e) {
      if (ref.current && !ref.current.contains(e.target) && !anchorEl.contains(e.target)) closeRef.current();
    }
    function esc(e) { if (e.key === 'Escape') closeRef.current(); }
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [anchorEl]);

  return createPortal(
    <div className={styles.popover} style={style} ref={ref} role="dialog" aria-label={title}>
      <div className={styles.title}>{title}</div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={!!pain}
          onChange={e => onChange(e.target.checked ? { note } : null)}
        />
        Felt pain on this set
      </label>
      {pain && (
        <input
          className={styles.note}
          type="text"
          value={note}
          autoFocus
          onChange={e => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={e => { if (e.key === 'Enter') close(); }}
          placeholder="Where? e.g. left shoulder"
        />
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.done} onClick={close}>Done</button>
      </div>
    </div>,
    document.body,
  );
}

// Above the button, or below it when there isn't room; clamped to the screen.
function place(el) {
  const rect = el.getBoundingClientRect();
  const width = Math.min(260, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
  const below = rect.top < 200;
  return {
    left,
    width,
    top: below ? rect.bottom + 6 : rect.top - 6,
    transform: below ? undefined : 'translateY(-100%)',
  };
}

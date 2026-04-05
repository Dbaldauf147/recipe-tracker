import { useState, useCallback, useMemo } from 'react';
import styles from './WidgetLayout.module.css';

const WIDGET_DEFS = {
  weeklyMeals: { label: "This Week's Meals", locked: true },
  suggestedMeals: { label: 'Suggested Meals', locked: true },
  myRecipes: { label: 'My Recipes', locked: true },
  breakfast: { label: 'Breakfast' },
  lunchDinner: { label: 'Lunch & Dinner' },
  snacks: { label: 'Snacks' },
  desserts: { label: 'Desserts' },
  drinks: { label: 'Drinks' },
};

function getKeys(userId) {
  const suffix = userId ? `-${userId}` : '';
  return {
    ORDER_KEY: `sunday-widget-order${suffix}`,
    HIDDEN_KEY: `sunday-hidden-widgets${suffix}`,
    CUSTOM_KEY: `sunday-custom-widgets${suffix}`,
  };
}

export function WidgetLayout({ children, onRequestAddWidget, userId }) {
  const { ORDER_KEY, HIDDEN_KEY, CUSTOM_KEY } = getKeys(userId);

  function loadOrder() {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY)); } catch { return null; }
  }
  function saveOrder(order) {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }
  function loadCustomWidgets() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch { return []; }
  }
  function saveCustomWidgets(widgets) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(widgets));
  }
  const childMap = useMemo(() => {
    const map = {};
    (Array.isArray(children) ? children : [children]).forEach(child => {
      if (child?.props?.['data-widget']) {
        map[child.props['data-widget']] = child;
      }
    });
    return map;
  }, [children]);

  const [hiddenWidgets, setHiddenWidgets] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
  });

  const [customWidgets, setCustomWidgets] = useState(loadCustomWidgets);
  const [addingWidget, setAddingWidget] = useState(false);
  const [newWidgetName, setNewWidgetName] = useState('');

  const defaultOrder = Object.keys(childMap);
  const [order, setOrder] = useState(() => {
    const saved = loadOrder();
    if (saved && saved.length > 0) return saved;
    return [...defaultOrder, ...customWidgets.map(w => w.id)];
  });

  // All widget IDs: built-in + custom
  const allIds = useMemo(() => {
    const builtIn = new Set(Object.keys(childMap));
    const customIds = customWidgets.map(w => w.id);
    return [...Object.keys(childMap), ...customIds.filter(id => !builtIn.has(id))];
  }, [childMap, customWidgets]);

  const visibleOrder = useMemo(() => {
    const allSet = new Set(allIds);
    const result = order.filter(id => allSet.has(id) && !hiddenWidgets.has(id));
    for (const id of allIds) {
      if (!result.includes(id) && !hiddenWidgets.has(id)) result.push(id);
    }
    return result;
  }, [order, allIds, hiddenWidgets]);

  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const handleDragStart = useCallback((e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const newOrder = [...visibleOrder];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    const fullOrder = [...newOrder, ...order.filter(id => hiddenWidgets.has(id))];
    setOrder(fullOrder);
    saveOrder(fullOrder);
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, visibleOrder, order, hiddenWidgets]);

  // Drop at very bottom
  const handleDropBottom = useCallback((e) => {
    e.preventDefault();
    if (dragIdx === null) return;
    const newOrder = [...visibleOrder];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.push(moved);
    const fullOrder = [...newOrder, ...order.filter(id => hiddenWidgets.has(id))];
    setOrder(fullOrder);
    saveOrder(fullOrder);
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, visibleOrder, order, hiddenWidgets]);

  const toggleWidget = useCallback((id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const addCustomWidget = useCallback(() => {
    const name = newWidgetName.trim();
    if (!name) return;
    const id = 'custom_' + Date.now();
    const widget = { id, label: name, content: '' };
    const next = [...customWidgets, widget];
    setCustomWidgets(next);
    saveCustomWidgets(next);
    setOrder(prev => { const o = [...prev, id]; saveOrder(o); return o; });
    setNewWidgetName('');
    setAddingWidget(false);
  }, [newWidgetName, customWidgets]);

  const updateCustomContent = useCallback((id, content) => {
    setCustomWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, content } : w);
      saveCustomWidgets(next);
      return next;
    });
  }, []);

  const removeCustomWidget = useCallback((id) => {
    setCustomWidgets(prev => { const next = prev.filter(w => w.id !== id); saveCustomWidgets(next); return next; });
    setOrder(prev => { const next = prev.filter(x => x !== id); saveOrder(next); return next; });
    setHiddenWidgets(prev => { const next = new Set(prev); next.delete(id); localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); return next; });
  }, []);

  const isCustom = (id) => id.startsWith('custom_');
  const getCustomWidget = (id) => customWidgets.find(w => w.id === id);
  const getLabel = (id) => {
    if (WIDGET_DEFS[id]) return WIDGET_DEFS[id].label;
    const cw = getCustomWidget(id);
    return cw ? cw.label : id;
  };
  const isLocked = (id) => WIDGET_DEFS[id]?.locked;

  const hasHidden = allIds.some(id => hiddenWidgets.has(id) && !id.startsWith('custom_'));

  const addWidgetUI = !addingWidget ? (
    <button className={styles.addWidgetBtn} onClick={() => setAddingWidget(true)}>
      + Add Widget
    </button>
  ) : (
    <div className={styles.addWidgetForm}>
      <input
        className={styles.addWidgetInput}
        type="text"
        placeholder="Widget name..."
        value={newWidgetName}
        onChange={e => setNewWidgetName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') addCustomWidget(); if (e.key === 'Escape') setAddingWidget(false); }}
        autoFocus
      />
      <button className={styles.addWidgetSave} onClick={addCustomWidget}>Add</button>
      <button className={styles.addWidgetCancel} onClick={() => { setAddingWidget(false); setNewWidgetName(''); }}>Cancel</button>
    </div>
  );

  return (
    <div className={styles.layout}>
      {hasHidden && (
        <div className={styles.hiddenBar}>
          {allIds.filter(id => hiddenWidgets.has(id) && !isCustom(id)).map(id => (
            <button key={id} className={styles.showBtn} onClick={() => toggleWidget(id)}>
              + Show {getLabel(id)}
            </button>
          ))}
        </div>
      )}
      {visibleOrder.map((id, idx) => (
        <div
          key={id}
          className={`${styles.section} ${dragOverIdx === idx ? styles.sectionDragOver : ''}`}
          draggable
          onDragStart={e => handleDragStart(e, idx)}
          onDragOver={e => handleDragOver(e, idx)}
          onDrop={e => handleDrop(e, idx)}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
        >
          {!isCustom(id) && (
            <div className={styles.sectionBar}>
              <span className={styles.dragHandle} title="Drag to reorder">⋮⋮</span>
              {!isLocked(id) && (
                <button className={styles.hideBtn} title={`Hide ${getLabel(id)}`} onClick={() => toggleWidget(id)}>✕</button>
              )}
            </div>
          )}
          {childMap[id] || (isCustom(id) && (() => {
            const cw = getCustomWidget(id);
            if (!cw) return null;
            return (
              <div className={styles.customWidget}>
                <div className={styles.customWidgetHeader}>
                  <h3 className={styles.customWidgetTitle}>{cw.label}</h3>
                  <div className={styles.customWidgetControls}>
                    <span className={styles.dragHandle} title="Drag to reorder">⋮⋮</span>
                    <button className={styles.hideBtn} title="Delete widget" onClick={() => { if (confirm(`Delete "${getLabel(id)}"?`)) removeCustomWidget(id); }}>🗑</button>
                  </div>
                </div>
                <div
                  className={styles.customWidgetContent}
                  contentEditable
                  suppressContentEditableWarning
                  ref={el => { if (el && !el.dataset.init) { el.innerHTML = cw.content || ''; el.dataset.init = '1'; } }}
                  onBlur={e => updateCustomContent(id, e.currentTarget.innerHTML)}
                  data-placeholder="Type notes, links, or anything here..."
                />
              </div>
            );
          })())}
        </div>
      ))}
      {/* Bottom drop zone */}
      <div
        className={`${styles.bottomDrop} ${dragIdx !== null ? styles.bottomDropActive : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOverIdx(visibleOrder.length); }}
        onDrop={handleDropBottom}
        onDragLeave={() => setDragOverIdx(null)}
      />
    </div>
  );
}

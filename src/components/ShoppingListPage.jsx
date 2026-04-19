import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
import { useAuth } from '../contexts/AuthContext';
import { saveField } from '../utils/firestoreSync';
import GridLayoutLib, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import styles from './ShoppingListPage.module.css';

const GridLayout = WidthProvider(GridLayoutLib);

const DEFAULT_SPICES = [];
const DEFAULT_SAUCES = [];

const EXTRAS_KEY = 'sunday-shop-extras';
const DISMISSED_KEY = 'sunday-shop-dismissed';

function loadExtras() {
  try {
    const data = localStorage.getItem(EXTRAS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveExtrasToStorage(extras) {
  localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras));
}

function loadDismissed() {
  try {
    const data = localStorage.getItem(DISMISSED_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

const SOURCE_KEYS = {
  staples: 'sunday-grocery-staples',
  spices: 'sunday-pantry-spices',
  sauces: 'sunday-pantry-sauces',
};

export function ShoppingListPage({ weeklyRecipes, weeklyServings = {}, onClose, onSaveToHistory }) {
  const { user } = useAuth();
  const [extras, setExtras] = useState(loadExtras);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [resetKey, setResetKey] = useState(0);
  const [saved, setSaved] = useState(false);

  // --- Resizable grid for spices/sauces/custom widgets ---
  const GRID_LAYOUT_KEY = user ? `sunday-shop-grid-layout-${user.uid}` : 'sunday-shop-grid-layout';
  const CUSTOM_WIDGETS_KEY = user ? `sunday-shop-custom-widgets-${user.uid}` : 'sunday-shop-custom-widgets';

  const FALLBACK_LAYOUT = [
    { i: 'spices', x: 0, y: 0, w: 6, h: 20 },
    { i: 'sauces', x: 6, y: 0, w: 6, h: 20 },
  ];

  const [gridLayout, setGridLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem(user ? `sunday-shop-grid-layout-${user?.uid}` : 'sunday-shop-grid-layout')) || FALLBACK_LAYOUT; } catch { return FALLBACK_LAYOUT; }
  });

  const [customWidgets, setCustomWidgets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(user ? `sunday-shop-custom-widgets-${user?.uid}` : 'sunday-shop-custom-widgets')) || []; } catch { return []; }
  });

  // Re-read grid layout + custom widgets whenever the user.uid becomes known
  // (after the initial mount) or whenever Firestore fires a sync event. The
  // useState initializers above only run once, so without this the first
  // render's anonymous/stale key sticks and resized widgets appear to reset.
  useEffect(() => {
    function loadFromStorage() {
      try {
        const layout = JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY));
        if (Array.isArray(layout) && layout.length > 0) setGridLayout(layout);
      } catch { /* ignore */ }
      try {
        const widgets = JSON.parse(localStorage.getItem(CUSTOM_WIDGETS_KEY));
        if (Array.isArray(widgets)) setCustomWidgets(widgets);
      } catch { /* ignore */ }
    }
    loadFromStorage();
    window.addEventListener('firestore-sync', loadFromStorage);
    return () => window.removeEventListener('firestore-sync', loadFromStorage);
  }, [GRID_LAYOUT_KEY, CUSTOM_WIDGETS_KEY]);

  const [addingWidget, setAddingWidget] = useState(false);
  const [newWidgetName, setNewWidgetName] = useState('');
  const [renamingWidgetId, setRenamingWidgetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const gridRef = useRef(null);

  const allGridKeys = ['spices', 'sauces', ...customWidgets.map(w => w.id)];
  const customWidgetIds = new Set(customWidgets.map(w => w.id));

  const visibleLayout = useMemo(() => {
    const existing = gridLayout.filter(l => allGridKeys.includes(l.i));
    const existingIds = new Set(existing.map(l => l.i));
    let maxY = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    for (const cw of customWidgets) {
      if (!existingIds.has(cw.id)) {
        existing.push({ i: cw.id, x: 0, y: maxY, w: 6, h: 16 });
        maxY += 16;
      }
    }
    return existing;
  }, [gridLayout, customWidgets]);

  function saveGridLayout(layout) {
    const clean = layout
      .filter(item => allGridKeys.includes(item.i))
      .map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setGridLayout(clean);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(clean));
    if (user) saveField(user.uid, 'shopGridLayout', clean);
  }

  function saveCustomWidgets(widgets) {
    localStorage.setItem(CUSTOM_WIDGETS_KEY, JSON.stringify(widgets));
    if (user) saveField(user.uid, 'shopCustomWidgets', widgets);
  }

  function addWidget() {
    const name = newWidgetName.trim();
    if (!name) return;
    const id = 'cw_' + Date.now();
    const widget = { id, label: name, content: '' };
    const next = [...customWidgets, widget];
    setCustomWidgets(next);
    saveCustomWidgets(next);
    const maxY = gridLayout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const nextLayout = [...gridLayout, { i: id, x: 0, y: maxY, w: 6, h: 16 }];
    setGridLayout(nextLayout);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'shopGridLayout', nextLayout);
    setNewWidgetName('');
    setAddingWidget(false);
  }

  function updateWidgetContent(id, content) {
    const next = customWidgets.map(w => w.id === id ? { ...w, content } : w);
    setCustomWidgets(next);
    saveCustomWidgets(next);
  }

  function renameWidget(id, newLabel) {
    const next = customWidgets.map(w => w.id === id ? { ...w, label: newLabel } : w);
    setCustomWidgets(next);
    saveCustomWidgets(next);
  }

  function removeWidget(id) {
    const nextWidgets = customWidgets.filter(w => w.id !== id);
    setCustomWidgets(nextWidgets);
    saveCustomWidgets(nextWidgets);
    const nextLayout = gridLayout.filter(l => l.i !== id);
    setGridLayout(nextLayout);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'shopGridLayout', nextLayout);
  }

  function saveExtras(list) {
    saveExtrasToStorage(list);
    if (user) saveField(user.uid, 'shopExtras', list);
  }

  const handleMoveToShop = useCallback((item, source) => {
    setExtras(prev => {
      const next = [...prev, { ...item, source }];
      saveExtras(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddCustomItem = useCallback((item) => {
    setExtras(prev => {
      const next = [...prev, { ...item, source: 'custom' }];
      saveExtras(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleClearExtras = useCallback(() => {
    // Group extras by source and append back to their localStorage keys
    const bySource = {};
    for (const item of extras) {
      if (!bySource[item.source]) bySource[item.source] = [];
      const { source, ...rest } = item;
      bySource[source].push(rest);
    }

    for (const [source, items] of Object.entries(bySource)) {
      const key = SOURCE_KEYS[source];
      if (!key) continue;
      try {
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        // Only add back items that aren't already in the list (prevent duplicates)
        const existingNames = new Set(existing.map(e => (e.ingredient || '').toLowerCase().trim()));
        const newItems = items.filter(item => {
          const name = (item.ingredient || '').toLowerCase().trim();
          return name && !existingNames.has(name);
        });
        if (newItems.length > 0) {
          localStorage.setItem(key, JSON.stringify([...existing, ...newItems]));
        }
      } catch {}
    }

    setExtras([]);
    saveExtras([]);
    setDismissed([]);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([]));
    if (user) saveField(user.uid, 'shopDismissed', []);
    setResetKey(k => k + 1);
  }, [extras, user]);

  const handleDismissItem = useCallback((ingredientName, recipes) => {
    setDismissed(prev => {
      const norm = ingredientName.toLowerCase().trim();
      if (prev.some(d => d.name === norm)) return prev;
      const next = [...prev, { name: norm, label: ingredientName.trim(), recipes: recipes || [] }];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      if (user) saveField(user.uid, 'shopDismissed', next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const pantryNames = useMemo(() => {
    const names = new Set();
    try {
      const spices = JSON.parse(localStorage.getItem('sunday-pantry-spices') || '[]');
      const sauces = JSON.parse(localStorage.getItem('sunday-pantry-sauces') || '[]');
      for (const item of [...spices, ...sauces]) {
        if (item.ingredient) names.add(item.ingredient.toLowerCase().trim());
      }
    } catch {}
    return names;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, extras.length]);

  const shopIngredientNames = useMemo(() => {
    const names = new Set();
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (name) names.add(name);
      }
    }
    for (const e of extras) {
      const name = (e.ingredient || '').toLowerCase().trim();
      if (name) names.add(name);
    }
    return names;
  }, [weeklyRecipes, extras]);

  function wordMatch(a, b) {
    if (a === b) return true;
    const cleanA = a.replace(/\s*\(.*?\)\s*/g, '').trim();
    const cleanB = b.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleanA === cleanB) return true;
    const re = (s) => new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    return re(cleanA).test(cleanB) || re(cleanB).test(cleanA);
  }

  function matchesPantry(name) {
    for (const pn of pantryNames) {
      if (wordMatch(name, pn)) return true;
    }
    return false;
  }

  const dismissedNames = useMemo(
    () => new Set(dismissed.map(d => d.name)),
    [dismissed]
  );

  // Items manually hidden (x'd) that aren't just pantry matches
  const hiddenItems = useMemo(
    () => dismissed.filter(d => d.recipes && d.recipes.length > 0),
    [dismissed]
  );

  const pantryMatchedItems = useMemo(() => {
    const matched = new Map();
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (name && matchesPantry(name) && !matched.has(name)) {
          matched.set(name, ing.ingredient.trim());
        }
      }
    }
    for (const e of extras) {
      const name = (e.ingredient || '').toLowerCase().trim();
      if (name && matchesPantry(name) && !matched.has(name)) {
        matched.set(name, e.ingredient.trim());
      }
    }
    // Also include dismissed items, but only if they're still in pantry
    for (const d of dismissed) {
      if (!matched.has(d.name) && matchesPantry(d.name)) {
        matched.set(d.name, d.label);
      }
    }
    return { names: new Set(matched.keys()), labels: [...matched.values()].sort() };
  }, [weeklyRecipes, extras, pantryNames, dismissed]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Shopping List</h2>
          {weeklyRecipes.length > 0 && (
            <div className={styles.mealBubbles}>
              {weeklyRecipes.map(r => (
                <span key={r.id} className={styles.mealBubble}>{r.title}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {weeklyRecipes.length > 0 && onSaveToHistory && (
        <div className={styles.completedRow}>
          <button
            className={styles.completedBtn}
            onClick={() => {
              onSaveToHistory();
              // Send grocery staples back to their boxes
              handleClearExtras();
              // Clear checked items for both the shopping list and grocery staples
              localStorage.removeItem('sunday-shopping-checked');
              localStorage.removeItem('sunday-staples-checked');
              if (user) {
                saveField(user.uid, 'shoppingChecked', []);
                saveField(user.uid, 'staplesChecked', []);
              }
              window.dispatchEvent(new Event('firestore-sync'));
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
            }}
          >
            Reset Shopping List
          </button>
          {saved && <span className={styles.savedToast}>Saved to history!</span>}
        </div>
      )}

      <div className={styles.pageLayout}>
        {/* Left side: fixed Shopping List + Grocery Staples columns */}
        <div className={styles.fixedLeft}>
          <div className={styles.fixedCol}>
            <ShoppingList
              weeklyRecipes={weeklyRecipes}
              weeklyServings={weeklyServings}
              extraItems={extras}
              onClearExtras={handleClearExtras}
              onAddCustomItem={handleAddCustomItem}
              pantryNames={pantryNames}
              dismissedNames={dismissedNames}
              onDismissItem={handleDismissItem}
              user={user}
            />
          </div>
          <div className={styles.fixedCol}>
            {hiddenItems.length > 0 && (
              <div className={styles.hiddenBox}>
                <h3 className={styles.hiddenHeading}>Hidden from Shopping List</h3>
                <ul className={styles.hiddenList}>
                  {hiddenItems.map(d => (
                    <li key={d.name} className={styles.hiddenItem}>
                      <div className={styles.hiddenItemTop}>
                        <span className={styles.hiddenItemName}>{d.label}</span>
                        <button
                          className={styles.hiddenUndoBtn}
                          onClick={() => {
                            setDismissed(prev => {
                              const next = prev.filter(x => x.name !== d.name);
                              localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
                              if (user) saveField(user.uid, 'shopDismissed', next);
                              return next;
                            });
                          }}
                          title="Add back to shopping list"
                        >
                          Unhide
                        </button>
                      </div>
                      {d.recipes.length > 0 && (
                        <span className={styles.hiddenItemMeals}>Used in: {d.recipes.join(', ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pantryMatchedItems.labels.length > 0 && (
              <div className={styles.pantryMatchBox}>
                <h3 className={styles.pantryMatchHeading}>Already In Your Pantry</h3>
                <p className={styles.pantryMatchSubtext}>
                  These recipe ingredients were removed from the shopping list
                </p>
                <ul className={styles.pantryMatchList}>
                  {pantryMatchedItems.labels.map(name => (
                    <li key={name} className={styles.pantryMatchItem}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
            <GroceryStaples key={resetKey} onMoveToShop={handleMoveToShop} highlightNames={shopIngredientNames} />
          </div>
        </div>

        {/* Right side: resizable Spices, Sauces, Custom Widgets */}
        <div className={styles.widgetRight}>
          <div ref={gridRef} className={styles.gridContainer}>
            <GridLayout
              className={styles.widgetGrid}
              layout={visibleLayout}
              cols={12}
              rowHeight={10}
              isDraggable
              isResizable
              resizeHandles={['se', 'e', 'w', 's', 'n']}
              onLayoutChange={saveGridLayout}
              draggableHandle={`.${styles.widgetHeadingRow}`}
              compactType="vertical"
              margin={[8, 8]}
            >
              <div key="spices" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Spices</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <PantryList
                    key={`spices-${resetKey}`}
                    title=""
                    subtitle=""
                    storageKey="sunday-pantry-spices"
                    initialItems={DEFAULT_SPICES}
                    onMoveToShop={handleMoveToShop}
                    source="spices"
                    highlightNames={pantryMatchedItems.names}
                    hideHeader
                  />
                </div>
              </div>
              <div key="sauces" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Sauces</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <PantryList
                    key={`sauces-${resetKey}`}
                    title=""
                    subtitle=""
                    storageKey="sunday-pantry-sauces"
                    initialItems={DEFAULT_SAUCES}
                    onMoveToShop={handleMoveToShop}
                    source="sauces"
                    highlightNames={pantryMatchedItems.names}
                    hideHeader
                  />
                </div>
              </div>
              {customWidgets.map(cw => (
                <div key={cw.id} className={styles.widgetBox}>
                  <div className={styles.widgetHeadingRow}>
                    {renamingWidgetId === cw.id ? (
                      <input
                        className={styles.widgetRenameInput}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => { if (renameValue.trim()) renameWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (renameValue.trim()) renameWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); } if (e.key === 'Escape') setRenamingWidgetId(null); }}
                        onMouseDown={e => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <h3 className={styles.widgetHeading} onDoubleClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }}>{cw.label}</h3>
                    )}
                    <div className={styles.widgetControls}>
                      <button className={styles.widgetEditBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }} title="Rename">&#9998;</button>
                      <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                      <button className={styles.widgetDeleteBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete "${cw.label}"?`)) removeWidget(cw.id); }} title={`Delete ${cw.label}`}>&#10005;</button>
                    </div>
                  </div>
                  <div className={styles.widgetBody}>
                    <div
                      className={styles.customWidgetContent}
                      contentEditable
                      suppressContentEditableWarning
                      ref={el => { if (el && !el.dataset.init) { el.innerHTML = cw.content || ''; el.dataset.init = '1'; } }}
                      onBlur={e => updateWidgetContent(cw.id, e.currentTarget.innerHTML)}
                      data-placeholder="Type notes, links, or anything here..."
                    />
                  </div>
                </div>
              ))}
            </GridLayout>
          </div>

          {/* Add Widget button */}
          <div className={styles.addWidgetRow}>
            {!addingWidget ? (
              <button className={styles.addWidgetBtn} onClick={() => setAddingWidget(true)}>+ Add Widget</button>
            ) : (
              <div className={styles.addWidgetForm}>
                <input
                  className={styles.addWidgetInput}
                  type="text"
                  placeholder="Widget name..."
                  value={newWidgetName}
                  onChange={e => setNewWidgetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addWidget(); if (e.key === 'Escape') { setAddingWidget(false); setNewWidgetName(''); } }}
                  autoFocus
                />
                <button className={styles.addWidgetSave} onClick={addWidget}>Add</button>
                <button className={styles.addWidgetCancel} onClick={() => { setAddingWidget(false); setNewWidgetName(''); }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

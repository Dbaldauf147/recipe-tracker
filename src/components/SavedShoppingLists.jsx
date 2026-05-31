import { useState, useEffect, useCallback } from 'react';
import { ShoppingList } from './ShoppingList';
import { saveField } from '../utils/firestoreSync';
import styles from './SavedShoppingLists.module.css';

const STORE_LISTS_KEY = 'sunday-store-lists';

function loadStoreLists() {
  try {
    const raw = localStorage.getItem(STORE_LISTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function newListId() {
  return 'sl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Named, persistent store-specific shopping lists (e.g. Whole Foods, Costco).
// Each list reuses the ShoppingList layout with no weekly meals — just the
// custom items the user adds. Persisted to localStorage + Firestore storeLists.
export function SavedShoppingLists({ user }) {
  const [lists, setLists] = useState(loadStoreLists);
  const [activeId, setActiveId] = useState(() => {
    const l = loadStoreLists();
    return l.length ? l[0].id : null;
  });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Re-hydrate from localStorage when Firestore syncs or another tab writes.
  useEffect(() => {
    function reload() {
      const l = loadStoreLists();
      setLists(l);
      setActiveId(prev => (prev && l.some(x => x.id === prev)) ? prev : (l[0]?.id ?? null));
    }
    window.addEventListener('firestore-sync', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('firestore-sync', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const persist = useCallback((next) => {
    setLists(next);
    localStorage.setItem(STORE_LISTS_KEY, JSON.stringify(next));
    if (user) saveField(user.uid, 'storeLists', next);
  }, [user]);

  const activeList = lists.find(l => l.id === activeId) || null;

  function createList() {
    const name = newName.trim();
    if (!name) return;
    const list = { id: newListId(), name, items: [] };
    persist([...lists, list]);
    setActiveId(list.id);
    setNewName('');
    setAdding(false);
  }

  function deleteList(id) {
    const list = lists.find(l => l.id === id);
    if (list && !window.confirm(`Delete "${list.name}"?`)) return;
    const next = lists.filter(l => l.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  }

  function commitRename(id) {
    const name = renameValue.trim();
    if (name) persist(lists.map(l => l.id === id ? { ...l, name } : l));
    setRenamingId(null);
  }

  const addItem = useCallback((item) => {
    setLists(prev => {
      const next = prev.map(l => l.id === activeId
        ? { ...l, items: [...l.items, {
            ingredient: item.ingredient,
            quantity: item.quantity || '',
            measurement: item.measurement || '',
          }] }
        : l);
      localStorage.setItem(STORE_LISTS_KEY, JSON.stringify(next));
      if (user) saveField(user.uid, 'storeLists', next);
      return next;
    });
  }, [activeId, user]);

  const removeItem = useCallback((ingredient) => {
    const norm = (ingredient || '').toLowerCase().trim();
    setLists(prev => {
      const next = prev.map(l => l.id === activeId
        ? { ...l, items: l.items.filter(it => (it.ingredient || '').toLowerCase().trim() !== norm) }
        : l);
      localStorage.setItem(STORE_LISTS_KEY, JSON.stringify(next));
      if (user) saveField(user.uid, 'storeLists', next);
      return next;
    });
  }, [activeId, user]);

  return (
    <div className={styles.wrap}>
      <div className={styles.listTabs}>
        {lists.map(l => (
          <div
            key={l.id}
            className={`${styles.listTab} ${l.id === activeId ? styles.listTabActive : ''}`}
          >
            {renamingId === l.id ? (
              <input
                className={styles.renameInput}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => commitRename(l.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(l.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={styles.listTabName}
                onClick={() => setActiveId(l.id)}
                onDoubleClick={() => { setRenamingId(l.id); setRenameValue(l.name); }}
                title="Click to open · double-click to rename"
              >
                {l.name}
              </button>
            )}
            {l.id === activeId && renamingId !== l.id && (
              <button
                type="button"
                className={styles.listTabDelete}
                onClick={() => deleteList(l.id)}
                title="Delete list"
              >
                &times;
              </button>
            )}
          </div>
        ))}

        {adding ? (
          <div className={styles.addListForm}>
            <input
              className={styles.addListInput}
              type="text"
              placeholder="List name (e.g. Whole Foods)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createList();
                if (e.key === 'Escape') { setAdding(false); setNewName(''); }
              }}
              autoFocus
            />
            <button type="button" className={styles.addListSave} onClick={createList}>Add</button>
            <button type="button" className={styles.addListCancel} onClick={() => { setAdding(false); setNewName(''); }}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={styles.newListBtn} onClick={() => setAdding(true)}>
            + New list
          </button>
        )}
      </div>

      {activeList ? (
        <ShoppingList
          key={activeList.id}
          weeklyRecipes={[]}
          extraItems={activeList.items}
          onAddCustomItem={addItem}
          onDismissItem={removeItem}
          user={user}
        />
      ) : (
        <div className={styles.empty}>
          No store lists yet. Create one with <strong>+ New list</strong> to start adding items.
        </div>
      )}
    </div>
  );
}

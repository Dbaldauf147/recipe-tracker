import { useState, useEffect } from 'react';
import { fetchStaplesFromSheet } from '../utils/sheetRecipes';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import styles from './GroceryStaples.module.css';

const STORAGE_KEY = 'sunday-grocery-staples';

function loadStaples() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveStaples(staples) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staples));
  const user = auth.currentUser;
  if (user) saveField(user.uid, 'groceryStaples', staples);
}

export function GroceryStaples({ onMoveToShop }) {
  const [staples, setStaples] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = loadStaples();
    if (saved) {
      setStaples(saved);
      setLoading(false);
    } else {
      fetchStaplesFromSheet()
        .then(data => {
          setStaples(data);
          saveStaples(data);
        })
        .catch(() => setStaples([]))
        .finally(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      saveStaples(staples);
    }
  }, [staples, loading]);

  function updateItem(index, field, value) {
    setStaples(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(index) {
    const item = staples[index];
    setStaples(prev => prev.filter((_, i) => i !== index));
    if (onMoveToShop) onMoveToShop(item, 'staples');
  }

  function addItem() {
    setStaples(prev => [...prev, { quantity: '', measurement: '', ingredient: '' }]);
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Grocery Staples <span className={styles.subtitle}>(Things you want everytime)</span></h2>
      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Measurement</th>
                <th>Ingredient</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...staples]
                .map((item, i) => ({ ...item, _i: i }))
                .sort((a, b) => (a.ingredient || '').localeCompare(b.ingredient || ''))
                .map(({ _i: i, ...item }) => (
                <tr key={i}>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', e.target.value)}
                      placeholder="1"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.measurement}
                      onChange={e => updateItem(i, 'measurement', e.target.value)}
                      placeholder="unit"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.ingredient}
                      onChange={e => updateItem(i, 'ingredient', e.target.value)}
                      placeholder="ingredient"
                    />
                  </td>
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeItem(i)}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className={styles.addBtn} onClick={addItem}>
            + Add item
          </button>
        </>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import styles from './GroceryStaples.module.css';

export function PantryList({ title, storageKey, initialItems }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    try {
      const data = localStorage.getItem(storageKey);
      if (data) {
        setItems(JSON.parse(data));
      } else if (initialItems) {
        setItems(initialItems);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, storageKey]);

  function updateItem(index, field, value) {
    setItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems(prev => [...prev, { quantity: '', measurement: '', ingredient: '' }]);
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>{title}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Measurement</th>
            <th>Item</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
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
                  placeholder="item"
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
    </div>
  );
}

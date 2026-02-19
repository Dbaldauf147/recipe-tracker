import { useState, useEffect } from 'react';
import { fetchStaplesFromSheet } from '../utils/sheetRecipes';
import styles from './GroceryStaples.module.css';

export function GroceryStaples() {
  const [staples, setStaples] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStaplesFromSheet()
      .then(setStaples)
      .catch(() => setStaples([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Grocery Staples</h2>
      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : staples.length === 0 ? (
        <p className={styles.loading}>No staples found</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Measurement</th>
              <th>Ingredient</th>
            </tr>
          </thead>
          <tbody>
            {staples.map((item, i) => (
              <tr key={i}>
                <td>{item.quantity}</td>
                <td>{item.measurement}</td>
                <td>{item.ingredient}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import styles from './ShoppingListPage.module.css';

export function ShoppingListPage({ weeklyRecipes, onClose }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Shopping List</h2>
      </div>

      <div className={styles.sections}>
        <div className={styles.section}>
          <ShoppingList weeklyRecipes={weeklyRecipes} />
        </div>
        <div className={styles.section}>
          <GroceryStaples />
        </div>
      </div>
    </div>
  );
}

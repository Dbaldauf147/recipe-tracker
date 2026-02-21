import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
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
        <ShoppingList weeklyRecipes={weeklyRecipes} />
        <GroceryStaples />
        <PantryList title="Spices" storageKey="sunday-pantry-spices" />
        <PantryList title="Sauces" storageKey="sunday-pantry-sauces" />
      </div>
    </div>
  );
}

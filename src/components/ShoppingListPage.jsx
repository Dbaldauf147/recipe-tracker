import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
import styles from './ShoppingListPage.module.css';

const DEFAULT_SPICES = [
  'Parsley Flakes',
  'Garam Masala',
  'Turmeric',
  'Himalayan Salt',
  'Fenugreek Leaves',
  'Cayenne Powder',
  'Bay Leaves',
  'Paprika',
  'Everything But the Bagel Seasoning',
  'Italian Seasoning',
  'Ground Black Pepper',
  'Coriander',
  'Garlic Powder',
  'Curry Powder',
  'Red Pepper Flakes',
  'Tajin Seasoning',
  'Cardamom',
  'Thyme (Dried)',
  'Oregano (Dried)',
  'Old Bay Seasoning',
  'Harissa Powder',
].map(name => ({ quantity: '', measurement: '', ingredient: name }));

const DEFAULT_SAUCES = [
  'Balsamic Vinegar',
  'Olive Oil',
  'Dijon Mustard',
  'Sesame Oil',
  'Vegetable Oil',
  'Teriyaki Sauce',
  "Frank's RedHot",
  'Brown Mustard',
  'Honey',
].map(name => ({ quantity: '', measurement: '', ingredient: name }));

export function ShoppingListPage({ weeklyRecipes, onClose }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Shopping List</h2>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <ShoppingList weeklyRecipes={weeklyRecipes} />
        </div>
        <div className={styles.cell}>
          <GroceryStaples />
        </div>
        <div className={styles.cell}>
          <PantryList title="Spices" storageKey="sunday-pantry-spices" initialItems={DEFAULT_SPICES} />
        </div>
        <div className={styles.cell}>
          <PantryList title="Sauces" storageKey="sunday-pantry-sauces" initialItems={DEFAULT_SAUCES} />
        </div>
      </div>
    </div>
  );
}

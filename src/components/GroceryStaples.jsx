import styles from './GroceryStaples.module.css';

const STAPLES = [
  { quantity: '5', measurement: 'lbs', ingredient: 'All-Purpose Flour' },
  { quantity: '5', measurement: 'lbs', ingredient: 'Sugar' },
  { quantity: '1', measurement: 'lb', ingredient: 'Brown Sugar' },
  { quantity: '1', measurement: 'lb', ingredient: 'Butter' },
  { quantity: '1', measurement: 'dozen', ingredient: 'Eggs' },
  { quantity: '1', measurement: 'gallon', ingredient: 'Whole Milk' },
  { quantity: '1', measurement: 'lb', ingredient: 'Cheddar Cheese' },
  { quantity: '1', measurement: 'block', ingredient: 'Cream Cheese' },
  { quantity: '1', measurement: 'container', ingredient: 'Sour Cream' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Olive Oil' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Vegetable Oil' },
  { quantity: '1', measurement: 'container', ingredient: 'Salt' },
  { quantity: '1', measurement: 'container', ingredient: 'Black Pepper' },
  { quantity: '1', measurement: 'container', ingredient: 'Garlic Powder' },
  { quantity: '1', measurement: 'container', ingredient: 'Onion Powder' },
  { quantity: '1', measurement: 'container', ingredient: 'Paprika' },
  { quantity: '1', measurement: 'container', ingredient: 'Cumin' },
  { quantity: '1', measurement: 'container', ingredient: 'Baking Soda' },
  { quantity: '1', measurement: 'container', ingredient: 'Baking Powder' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Vanilla Extract' },
  { quantity: '2', measurement: 'lbs', ingredient: 'Rice' },
  { quantity: '2', measurement: 'lbs', ingredient: 'Pasta' },
  { quantity: '1', measurement: 'loaf', ingredient: 'Bread' },
  { quantity: '1', measurement: 'jar', ingredient: 'Peanut Butter' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Honey' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Soy Sauce' },
  { quantity: '1', measurement: 'bottle', ingredient: 'Vinegar' },
  { quantity: '3', measurement: 'lbs', ingredient: 'Chicken Breast' },
  { quantity: '2', measurement: 'lbs', ingredient: 'Ground Beef' },
  { quantity: '3', measurement: 'lbs', ingredient: 'Onions' },
  { quantity: '1', measurement: 'head', ingredient: 'Garlic' },
  { quantity: '5', measurement: 'lbs', ingredient: 'Potatoes' },
  { quantity: '2', measurement: 'lbs', ingredient: 'Carrots' },
  { quantity: '1', measurement: 'bunch', ingredient: 'Celery' },
  { quantity: '6', measurement: 'each', ingredient: 'Bananas' },
  { quantity: '6', measurement: 'each', ingredient: 'Lemons' },
  { quantity: '1', measurement: 'can', ingredient: 'Diced Tomatoes' },
  { quantity: '1', measurement: 'can', ingredient: 'Tomato Sauce' },
  { quantity: '2', measurement: 'cans', ingredient: 'Chicken Broth' },
  { quantity: '1', measurement: 'container', ingredient: 'Oats' },
];

export function GroceryStaples() {
  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Grocery Staples</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Measurement</th>
            <th>Ingredient</th>
          </tr>
        </thead>
        <tbody>
          {STAPLES.map((item, i) => (
            <tr key={i}>
              <td>{item.quantity}</td>
              <td>{item.measurement}</td>
              <td>{item.ingredient}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

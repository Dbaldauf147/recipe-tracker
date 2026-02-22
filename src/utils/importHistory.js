import { auth } from '../firebase';
import { saveField } from './firestoreSync';

const HISTORY_KEY = 'sunday-plan-history';

const SHEET_HISTORY = [
  { date: "2022-01-30", recipes: ["Buddha Bowl", "House Salad", "Overnight Oats (Summer)", "Sauteed Kale"] },
  { date: "2022-02-06", recipes: ["Buffalo Cauliflower Wrap", "Overnight Oats (Summer)"] },
  { date: "2022-02-13", recipes: ["Lentil Soup", "Salmon Broccoli & Quinoa"] },
  { date: "2022-02-20", recipes: ["Extra Vegetables Fried Rice", "Overnight Oats (Summer)", "Veggie Omelette"] },
  { date: "2022-02-27", recipes: ["Overnight Oats (Summer)", "Pickled Beet Salad", "Tofu Bowl"] },
  { date: "2022-03-13", recipes: ["Channa Masala", "Johnny Salad", "Overnight Oats (Summer)"] },
  { date: "2022-03-20", recipes: ["Veggie Omelette"] },
  { date: "2022-03-27", recipes: ["Overnight Oats (Summer)", "Sauteed Kale", "Veggie Chilli"] },
  { date: "2022-04-03", recipes: ["Lentil Soup"] },
  { date: "2022-04-10", recipes: ["Channa Masala", "Overnight Oats (Summer)"] },
  { date: "2022-04-24", recipes: ["Buffalo Cauliflower Wrap", "Overnight Oats (Summer)"] },
  { date: "2022-05-08", recipes: ["Coconut Chickpea Curry", "Shakshuka"] },
  { date: "2022-05-15", recipes: ["Berry Smoothie", "Extra Vegetables Fried Rice", "Pickled Beet Salad"] },
  { date: "2022-05-22", recipes: ["Johnny Salad", "Overnight Oats (Summer)", "Pickled Beet Salad"] },
  { date: "2022-05-29", recipes: ["Overnight Oats (Summer)", "Tofu Tikka Masala"] },
  { date: "2022-06-12", recipes: ["Black Bean Dip", "Harvest Bowl"] },
  { date: "2022-06-19", recipes: ["Frozen Berry Ice Cream", "Overnight Oats (Summer)", "Red Cabbage", "Squash Spaghetti"] },
  { date: "2022-06-26", recipes: ["Black Bean Dip", "Brussels Sprout Slaw", "Overnight Oats (Summer)", "Pineapple Shrimp Fried Rice"] },
  { date: "2022-07-03", recipes: ["Lentil Soup", "Overnight Oats (Summer)", "Veggie Burrito"] },
  { date: "2022-07-17", recipes: ["Johnny Salad", "Overnight Oats (Summer)", "Veggie Omelette"] },
  { date: "2022-07-25", recipes: ["Channa Masala", "Overnight Oats (Summer)"] },
  { date: "2022-08-01", recipes: ["Kismet Shop", "Watermelon Feta Salad"] },
  { date: "2022-08-14", recipes: ["Coconut Chickpea Curry", "Overnight Oats (Summer)", "Sauteed Kale", "Veggie Chilli"] },
  { date: "2022-08-24", recipes: ["Salmon Tacos"] },
  { date: "2022-08-29", recipes: ["Anchovy Toast", "Cabage Soup", "Overnight Oats (Summer)"] },
  { date: "2022-09-09", recipes: ["Buffalo Cauliflower Wrap"] },
  { date: "2022-09-11", recipes: ["Avocado Toast", "Frozen Berry Ice Cream"] },
  { date: "2022-09-18", recipes: ["Extra Vegetables Fried Rice", "Overnight Oats (Summer)"] },
  { date: "2022-09-26", recipes: ["Pickled Beet Salad"] },
  { date: "2022-10-02", recipes: ["Lentil Soup"] },
  { date: "2022-10-14", recipes: ["Overnight Oats (Apple Pie)"] },
  { date: "2022-10-19", recipes: ["Sheezan's Moms Channa Masala"] },
  { date: "2022-10-29", recipes: ["Black Bean Dip", "Buffalo Cauliflower Wrap", "Overnight Oats (Apple Pie)"] },
  { date: "2022-10-30", recipes: ["Harvest Bowl"] },
  { date: "2022-11-01", recipes: ["Sauteed Kale", "Veggie Burrito"] },
  { date: "2022-11-03", recipes: ["Beyond Burger"] },
  { date: "2022-11-05", recipes: ["Chocolate Chia Seed Pudding", "Crispy Smashed Potatoes", "House Salad"] },
  { date: "2022-11-10", recipes: ["Pineapple Shrimp Fried Rice"] },
  { date: "2022-11-13", recipes: ["Banana Bread Baked Oats", "Buddha Bowl", "Overnight Oats (Summer)", "Smashed Chickpea Sandwich", "Sweets & Beets Salad"] },
  { date: "2022-11-20", recipes: ["Banana Bread Baked Oats", "Berry Smoothie", "Red Cabbage", "Tofu Tikka Masala"] },
  { date: "2022-11-27", recipes: ["Brussels Sprout Slaw", "Lentil Soup", "Overnight Oats (Apple Pie)", "Salmon Broccoli & Quinoa"] },
  { date: "2022-12-07", recipes: ["Johnny Salad", "Overnight Oats (Summer)"] },
  { date: "2022-12-15", recipes: ["Johnny Salad", "Overnight Oats (Summer)"] },
  { date: "2022-12-18", recipes: ["Anchovy Lettuce Wrap", "Berry Smoothie", "Tofu Bowl"] },
  { date: "2022-12-28", recipes: ["Baked Oatmeal", "Channa Masala", "Salmon Tacos"] },
  { date: "2023-01-08", recipes: ["Overnight Oats (Summer)", "Pickled Beet Salad", "Veggie Chilli"] },
  { date: "2023-01-19", recipes: ["Overnight Oats (Summer)"] },
  { date: "2023-01-22", recipes: ["Cherry Mango Smoothie", "Harvest Bowl"] },
  { date: "2023-01-29", recipes: ["Harvest Bowl", "Overnight Oats (Summer)", "Veggie Burrito"] },
  { date: "2023-02-05", recipes: ["Breakfast Burrito", "Coconut Chickpea Curry", "Garlic Parmesan Baked Eggplant", "Overnight Oats (Summer)"] },
  { date: "2023-02-12", recipes: ["Extra Vegetables Fried Rice", "Smashed Pea Toast"] },
  { date: "2023-02-20", recipes: ["Buffalo Cauliflower Wrap"] },
  { date: "2023-02-26", recipes: ["Breakfast Egg Muffins", "House Salad", "Lentil Soup"] },
  { date: "2023-03-05", recipes: ["Overnight Oats (Apple Pie)", "Tofu Tikka Masala"] },
  { date: "2023-03-15", recipes: ["Overnight Oats (Summer)", "Veggie Burrito"] },
  { date: "2023-03-27", recipes: ["Cabage Soup", "Quinoa Breakfast Bowl", "Smashed Chickpea Sandwich"] },
  { date: "2023-04-05", recipes: ["Beyond Burger", "Quinoa Breakfast Bowl"] },
  { date: "2023-04-10", recipes: ["Berry Smoothie", "Salmon Broccoli & Quinoa"] },
  { date: "2023-04-16", recipes: ["Lentil Salad", "Quinoa Breakfast Bowl"] },
  { date: "2023-04-27", recipes: ["Overnight Oats (Summer)", "Pineapple Shrimp Fried Rice"] },
  { date: "2023-04-29", recipes: ["Baked Feta Pasta"] },
  { date: "2023-05-03", recipes: ["Crunchwrap Supreme"] },
  { date: "2023-05-15", recipes: ["Berry Smoothie", "Brussels Sprout Slaw", "Cottage Cheese Toast", "Garlic Parmesan Baked Eggplant"] },
  { date: "2023-05-22", recipes: ["Overnight Oats (Summer)", "Salmon Tacos", "Tofu Bowl"] },
  { date: "2023-05-31", recipes: ["Anchovy Lettuce Wrap", "Breakfast Egg Muffins", "Johnny Salad"] },
  { date: "2023-06-04", recipes: ["Anchovy Toast", "Channa Masala", "Overnight Oats (Summer)"] },
  { date: "2023-06-11", recipes: ["Overnight Oats (Summer)", "Pickled Beet Salad"] },
  { date: "2023-06-19", recipes: ["Coconut Dal", "Veggie Chilli"] },
  { date: "2023-06-28", recipes: ["Veggie Omelette"] },
  { date: "2023-07-09", recipes: ["Overnight Oats (Summer)", "Smashed Pea Toast"] },
  { date: "2023-07-18", recipes: ["Cherry Mango Smoothie", "Extra Vegetables Fried Rice"] },
  { date: "2023-07-21", recipes: ["Baked Feta Pasta"] },
  { date: "2023-07-31", recipes: ["Berry Smoothie", "Lentil Soup", "Overnight Oats (Summer)"] },
  { date: "2023-08-06", recipes: ["Buddha Bowl", "Tofu Scrambled Eggs"] },
  { date: "2023-08-16", recipes: ["Overnight Oats (Apple Pie)"] },
  { date: "2023-08-21", recipes: ["Buffalo Cauliflower Wrap", "Eggplant Parmesan Meatballs"] },
  { date: "2023-08-27", recipes: ["Breakfast Wrap", "Veggie Burrito"] },
  { date: "2023-09-04", recipes: ["Quinoa Breakfast Bowl", "Tofu Tikka Masala"] },
  { date: "2023-09-17", recipes: ["Breakfast Egg Muffins", "Smashed Chickpea Sandwich"] },
  { date: "2023-09-24", recipes: ["House Salad", "Overnight Oats (Summer)"] },
  { date: "2023-10-02", recipes: ["Anchovy Lettuce Wrap", "Brussels Sprout Slaw", "Tofu Scrambled Eggs"] },
  { date: "2023-10-09", recipes: ["Avocado Toast", "Cabage Soup", "Tofu Scrambled Eggs"] },
  { date: "2023-10-15", recipes: ["Coconut Dal", "Feta Fried Egg", "Garlic Parmesan Baked Eggplant", "Overnight Oats (Apple Pie)"] },
  { date: "2023-10-22", recipes: ["Buffalo Cauliflower Wrap", "Pickled Beet Salad", "Quinoa Breakfast Bowl"] },
  { date: "2023-10-31", recipes: ["Banana Bread Baked Oats", "Lentil Salad", "Veggie Omelette"] },
  { date: "2023-11-05", recipes: ["Berry Smoothie", "Breakfast Wrap", "Channa Masala", "Harvest Bowl", "Overnight Oats (Summer)"] },
  { date: "2023-11-12", recipes: ["Cherry Mango Smoothie", "Smashed Pea Toast", "Veggie Burrito"] },
  { date: "2023-11-19", recipes: ["Coconut Chickpea Curry", "Overnight Oats (Apple Pie)", "Tofu Bowl"] },
  { date: "2023-11-26", recipes: ["Burrito Bowl"] },
  { date: "2023-12-03", recipes: ["Black Bean Dip", "Coconut Chickpea Curry", "Quinoa Breakfast Bowl", "Tofu Bowl"] },
  { date: "2023-12-04", recipes: ["Black Bean Dip", "Coconut Chickpea Curry", "Quinoa Breakfast Bowl", "Tofu Bowl"] },
  { date: "2023-12-10", recipes: ["Coconut Chickpea Curry", "Lentil Soup", "Overnight Oats (Summer)"] },
  { date: "2023-12-23", recipes: ["Burrito Bowl", "Magic Bars", "Overnight Oats (Summer)"] },
  { date: "2023-12-27", recipes: ["Harvest Bowl", "Salmon Broccoli & Quinoa", "Shakshouka"] },
  { date: "2024-01-02", recipes: ["Cherry Mango Smoothie", "Pineapple Shrimp Fried Rice", "Stuffed Bell Peppers", "Veggie Omelette"] },
  { date: "2024-01-07", recipes: ["Johnny Salad", "Overnight Oats (Apple Pie)"] },
  { date: "2024-01-16", recipes: ["Egg & Sweet Potatos", "Extra Vegetables Fried Rice", "Mediterranean Salad"] },
  { date: "2024-01-22", recipes: ["Coconut Dal", "Quinoa Breakfast Bowl"] },
  { date: "2024-01-28", recipes: ["Overnight Oats (Summer)", "Veggie Chilli"] },
  { date: "2024-02-13", recipes: ["Anchovy Lettuce Wrap", "Buddha Bowl", "Cherry Mango Smoothie", "Overnight Oats (Apple Pie)"] },
  { date: "2024-02-18", recipes: ["Buddha Bowl", "House Salad"] },
  { date: "2024-02-29", recipes: ["Brussels Sprout Slaw", "Lentil Soup", "Veggie Omelette"] },
  { date: "2024-03-12", recipes: ["Burrito Bowl", "Overnight Oats (Summer)"] },
  { date: "2024-03-17", recipes: ["Harvest Bowl", "Pickled Beet Salad", "Quinoa Breakfast Bowl"] },
  { date: "2024-03-24", recipes: ["Anchovy Lettuce Wrap", "Pickled Beet Salad", "Smashed Chickpea Sandwich"] },
  { date: "2024-04-02", recipes: ["Anchovy Lettuce Wrap", "Cabage Soup", "Cherry Mango Smoothie", "Egg & Sweet Potatos", "Smashed Chickpea Sandwich"] },
  { date: "2024-04-09", recipes: ["Chopped Egg Salad", "Overnight Oats (Summer)", "Protien Balls"] },
  { date: "2024-04-16", recipes: ["Buffalo Cauliflower Wrap", "Lentil Salad", "Sweet potato and goat cheese", "Trail Mix", "Veggie Omelette"] },
  { date: "2024-04-21", recipes: ["Buffalo Cauliflower Wrap", "Lentil Salad", "Overnight Oats (Apple Pie)", "Pickled Onions", "Smashed Broccoli"] },
  { date: "2024-04-30", recipes: ["Avocado Toast", "Channa Masala", "Lentil Salad", "Pickled Onions", "Smashed Broccoli", "Veggie Frittata"] },
  { date: "2024-05-07", recipes: ["Berry Smoothie", "Channa Masala", "Pickled Onions", "Smashed Broccoli", "Veggie Frittata"] },
  { date: "2024-05-15", recipes: ["Eggplant Parmesan Meatballs", "Lentil Soup", "Quinoa Breakfast Bowl", "Smashed Broccoli"] },
  { date: "2024-05-19", recipes: ["Smashed Broccoli"] },
  { date: "2024-05-27", recipes: ["Eggplant Parmesan Meatballs", "Johnny Salad", "Overnight Oats (Summer)"] },
  { date: "2024-06-03", recipes: ["Cherry Mango Smoothie", "Salmon Broccoli & Quinoa"] },
  { date: "2024-06-12", recipes: ["Anchovy Toast", "Chopped Egg Salad", "Egg & Sweet Potatos", "Salmon Broccoli & Quinoa"] },
  { date: "2024-06-17", recipes: ["Buddha Bowl", "Chopped Egg Salad", "Overnight Oats (Apple Pie)", "Salmon Broccoli & Quinoa"] },
  { date: "2024-06-23", recipes: ["Buddha Bowl", "Chicken Salad", "Salmon Broccoli & Quinoa", "Tofu Tikka Masala", "Veggie Omelette"] },
  { date: "2024-07-06", recipes: ["Kismet Shop"] },
  { date: "2024-07-08", recipes: ["Quinoa Breakfast Bowl", "Smashed Pea Toast", "Tofu Tikka Masala"] },
  { date: "2024-07-15", recipes: ["Chicken Salad", "Overnight Oats (Summer)", "Smashed Pea Toast"] },
  { date: "2024-07-22", recipes: ["Cherry Mango Smoothie", "Mediterranean Salad", "Smashed Pea Toast"] },
  { date: "2024-07-29", recipes: ["Chopped Egg Salad", "Salmon Broccoli & Quinoa", "Veggie Burrito"] },
  { date: "2024-08-06", recipes: ["Chopped Egg Salad", "Green Juice", "Mediterranean Salad", "Veggie Burrito"] },
  { date: "2024-08-11", recipes: ["Chopped Egg Salad", "Green Juice", "Mediterranean Salad", "Veggie Burrito"] },
  { date: "2024-08-15", recipes: ["Banana Bread Baked Oats", "Egg Bake"] },
  { date: "2024-08-18", recipes: ["Chopped Egg Salad", "Salmon Tacos", "Veggie Burrito"] },
  { date: "2024-08-26", recipes: ["Coconut Dal"] },
  { date: "2024-09-02", recipes: ["Coconut Dal", "Overnight Oats (Apple Pie)", "Salmon Tacos"] },
  { date: "2024-09-08", recipes: ["Extra Vegetables Fried Rice", "Lentil Soup", "Trail Mix", "Veggie Omelette"] },
  { date: "2024-09-15", recipes: ["Extra Vegetables Fried Rice", "Quinoa Breakfast Bowl", "Veggie Chilli"] },
  { date: "2024-09-25", recipes: ["Overnight Oats (Summer)", "Veggie Chilli"] },
  { date: "2024-09-30", recipes: ["Cherry Mango Smoothie", "Pickled Beet Salad"] },
  { date: "2024-10-10", recipes: ["Cherry Mango Smoothie", "Chopped Egg Salad", "Pickled Beet Salad", "Pickled Onions"] },
  { date: "2024-10-15", recipes: ["Beyond Burger", "Chopped Egg Salad", "Overnight Oats (Apple Pie)", "Pineapple Shrimp Fried Rice"] },
  { date: "2024-10-20", recipes: ["Anchovy Toast", "Burrito Bowl", "Overnight Oats (Apple Pie)", "Pickled Onions"] },
  { date: "2024-10-27", recipes: ["Anchovy Lettuce Wrap", "Feta Fried Egg", "Pickled Onions", "Smashed Chickpea Sandwich", "Tunacado", "Veggie Omelette"] },
  { date: "2024-11-03", recipes: ["Anchovy Lettuce Wrap", "Feta Fried Egg", "Pickled Onions", "Quinoa Breakfast Bowl", "Tofu Tikka Masala", "Tunacado"] },
  { date: "2024-11-09", recipes: ["Anchovy Lettuce Wrap", "Ginger Tea", "Harvest Bowl", "Overnight Oats (Summer)", "Pickled Onions"] },
  { date: "2024-11-17", recipes: ["Chicken Salad", "Egg & Sweet Potatos", "Lentil Soup", "Sweet Potato Cottage Cheese"] },
  { date: "2024-11-23", recipes: ["Anchovy Toast", "Cabage Soup", "Cherry Mango Smoothie"] },
  { date: "2024-12-02", recipes: ["Anchovy Toast", "Cabage Soup", "Chopped Egg Salad"] },
  { date: "2024-12-14", recipes: ["Anchovy Toast", "Cabage Soup", "Chopped Egg Salad", "Trail Mix"] },
  { date: "2024-12-22", recipes: ["Overnight Oats (Apple Pie)", "Salmon Tacos", "Turkey Stuffed Sweet Potatos"] },
  { date: "2024-12-30", recipes: ["Johnny Salad", "Salmon Tacos", "Shakshouka", "Sweet Potato Cottage Cheese"] },
  { date: "2025-01-04", recipes: ["Johnny Salad", "Salmon Tacos", "Shakshouka", "Sweet Potato Cottage Cheese"] },
  { date: "2025-01-12", recipes: ["Anchovy Toast", "Channa Masala", "Cottage Cheese Bowl", "Extra Vegetables Fried Rice", "Sweet Potato Cottage Cheese"] },
  { date: "2025-01-20", recipes: ["Anchovy Toast", "Channa Masala", "Ground Turkey and Eggs", "Quinoa Breakfast Bowl", "Sweet Potato Cottage Cheese"] },
  { date: "2025-01-27", recipes: ["Harvest Bowl", "Pineapple Shrimp Fried Rice", "Turkey and Eggs Breakfast Bowl"] },
  { date: "2025-02-01", recipes: ["Overnight Oats (Summer)"] },
  { date: "2025-02-05", recipes: ["Brussels Sprout Slaw", "Tofu Bowl"] },
  { date: "2025-02-16", recipes: ["Buffalo Cauliflower Wrap", "Tunacado", "Veggie Omelette"] },
  { date: "2025-02-23", recipes: ["Cherry Mango Smoothie", "Egg & Sweet Potatos", "Tunacado", "Veggie Chilli"] },
  { date: "2025-03-01", recipes: ["Banana Bread Baked Oats", "Egg & Sweet Potatos", "Mediterranean Salad", "Tofu Tikka Masala"] },
  { date: "2025-03-21", recipes: ["Chicken Salad", "Maca Smoothie", "Tofu Tikka Masala"] },
  { date: "2025-03-29", recipes: ["Chopped Egg Salad", "Lentil Salad", "Turkey Stuffed Sweet Potatos"] },
  { date: "2025-04-06", recipes: ["Extra Vegetables Fried Rice", "Lentil Salad", "Mediterranean Protein Pasta", "Overnight Oats (Apple Pie)"] },
  { date: "2025-04-12", recipes: ["Anchovy Lettuce Wrap", "Cottage Cheese Bowl", "Extra Vegetables Fried Rice", "Pickled Beet Salad"] },
  { date: "2025-04-22", recipes: ["Pickled Beet Salad", "Quinoa Breakfast Bowl", "Salmon Tacos"] },
  { date: "2025-04-27", recipes: ["Chopped Egg Salad", "Lentil Soup", "Turkey and Eggs Breakfast Bowl"] },
  { date: "2025-05-12", recipes: ["Green Juice", "Harvest Bowl", "Lentil Soup", "Overnight Oats (Summer)", "Trail Mix"] },
  { date: "2025-05-18", recipes: ["Anchovy Toast", "Smashed Chickpea Sandwich", "Veggie Omelette"] },
  { date: "2025-05-27", recipes: ["Anchovy Toast", "Brussels Sprout Slaw", "Cherry Mango Smoothie", "Smashed Chickpea Sandwich"] },
  { date: "2025-06-01", recipes: ["Chicken Salad", "Egg & Sweet Potatos", "Salmoncado"] },
  { date: "2025-06-11", recipes: ["Maca Smoothie", "Pineapple Shrimp Fried Rice", "Sweet Potato Cottage Cheese", "Tofu Bowl"] },
  { date: "2025-06-18", recipes: ["Buffalo Cauliflower Wrap", "Cottage Cheese Bowl"] },
  { date: "2025-06-22", recipes: ["Quinoa Breakfast Bowl", "Turkey Stuffed Sweet Potatos", "Veggie Chilli"] },
  { date: "2025-07-02", recipes: ["Airfried Chicken Nuggets"] },
  { date: "2025-07-07", recipes: ["Airfried Chicken Nuggets", "Anchovy Lettuce Wrap", "Chopped Egg Salad", "Tofu Tikka Masala"] },
  { date: "2025-07-21", recipes: ["Extra Vegetables Fried Rice", "Salmon Tacos", "Spirulina Smoothie", "Turkey and Eggs Breakfast Bowl"] },
  { date: "2025-07-27", recipes: ["Extra Vegetables Fried Rice", "Mediterranean Protein Pasta", "Overnight Oats (Summer)"] },
  { date: "2025-08-03", recipes: ["Cherry Mango Smoothie", "Lentil Soup", "Mediterranean Protein Pasta"] },
  { date: "2025-08-11", recipes: ["Harvest Bowl", "Shrimp Spring Roll", "Veggie Omelette"] },
  { date: "2025-08-18", recipes: ["Chicken Salad", "Egg & Sweet Potatos", "Shrimp Spring Roll"] },
  { date: "2025-08-23", recipes: ["Protein Pancakes", "Salmon Broccoli & Quinoa", "Veggie & Chicken Bowl", "Watermelon Feta Salad"] },
  { date: "2025-09-01", recipes: ["Coconut Dal", "Feta Fried Egg", "Overnight Oats (Apple Pie)", "Salmon Broccoli & Quinoa", "Watermelon Feta Salad"] },
  { date: "2025-09-07", recipes: ["Coconut Dal", "Maca Smoothie", "Turkey Stuffed Sweet Potatos"] },
  { date: "2025-09-15", recipes: ["Burrito Bowl", "Quinoa Breakfast Bowl"] },
  { date: "2025-10-01", recipes: ["Chicken Salad", "Chopped Egg Salad", "Lentil Salad"] },
  { date: "2025-10-05", recipes: ["Healthy Brownies", "Lentil Salad", "Salmoncado", "Turkey and Eggs Breakfast Bowl"] },
  { date: "2025-10-17", recipes: ["Overnight Oats (Summer)", "Pickled Beet Salad", "Salmoncado", "Spirulina Smoothie"] },
  { date: "2025-10-26", recipes: ["Cherry Mango Smoothie", "Pineapple Shrimp Fried Rice", "Tofu Bowl"] },
  { date: "2025-11-02", recipes: ["Chicken Salad", "Sweet Potato Cottage Cheese", "Veggie Chilli", "Veggie Omelette"] },
  { date: "2025-11-08", recipes: ["Brussels Sprout Slaw", "Egg & Sweet Potatos", "Sweet Potato Cottage Cheese", "Tuna Lettuce Wrap"] },
  { date: "2025-11-17", recipes: ["Protein Pancakes", "Sweet Potato Cottage Cheese", "Tuna Lettuce Wrap"] },
  { date: "2025-11-23", recipes: ["Cottage Cheese Bowl", "Johnny Salad", "Tuna Toast"] },
  { date: "2025-11-30", recipes: ["Extra Vegetables Fried Rice", "Overnight Oats (Apple Pie)", "Salmon Tacos"] },
  { date: "2025-12-14", recipes: ["Extra Vegetables Fried Rice", "Maca Smoothie", "Quinoa Breakfast Bowl", "Turkey Chilli"] },
  { date: "2025-12-20", recipes: ["Chopped Egg Salad", "Lentil Soup"] },
  { date: "2025-12-28", recipes: ["Shrimp Tacos", "Turkey and Eggs Breakfast Bowl"] },
  { date: "2026-01-05", recipes: ["Chopped Egg Salad", "Crispy Salmon Bites", "Shrimp Tacos"] },
  { date: "2026-01-11", recipes: ["Harvest Bowl", "Overnight Oats (Summer)", "Spirulina Smoothie", "Tofu Tikka Masala"] },
  { date: "2026-01-19", recipes: ["Spirulina Smoothie", "Tofu Tikka Masala"] },
  { date: "2026-01-26", recipes: ["Mediterranean Protein Pasta", "Tofu Tikka Masala", "Veggie Omelette"] },
  { date: "2026-01-31", recipes: ["Cherry Mango Smoothie", "Mediterranean Protein Pasta", "Tofu Tikka Masala", "Veggie Omelette"] },
  { date: "2026-02-07", recipes: ["Egg & Sweet Potatos", "Protein Pancakes", "Shrimp Spring Roll", "Tofu Tikka Masala"] },
];

export function importSheetHistory(recipes) {
  // Build case-insensitive title → id map
  const titleMap = new Map();
  for (const r of recipes) {
    titleMap.set(r.title.toLowerCase(), r.id);
  }

  // Load existing history
  let existing = [];
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    if (data) existing = JSON.parse(data);
  } catch {}

  const existingDates = new Set(existing.map(e => e.date));

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  const newEntries = [];

  for (const week of SHEET_HISTORY) {
    if (existingDates.has(week.date)) {
      skipped++;
      continue;
    }

    const recipeIds = [];
    for (const name of week.recipes) {
      const id = titleMap.get(name.toLowerCase());
      if (id) {
        recipeIds.push(id);
      } else {
        unmatched++;
      }
    }

    if (recipeIds.length > 0) {
      newEntries.push({
        date: week.date,
        recipeIds,
        timestamp: week.date + 'T12:00:00.000Z',
      });
      imported++;
    }
  }

  if (newEntries.length > 0) {
    const merged = [...existing, ...newEntries];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    const user = auth.currentUser;
    if (user) saveField(user.uid, 'planHistory', merged);
  }

  return { imported, skipped, unmatched };
}

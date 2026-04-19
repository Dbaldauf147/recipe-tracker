// Pending one-shot recipe fixes applied via the Admin Dashboard's
// "Apply Recipe Fixes" button. Each entry can specify fields to overwrite
// on the admin's own recipe by title. Leave a field undefined to skip it.
//
// Typical usage: add an entry here when you want to correct instructions
// or ingredients text on a live recipe without editing the sheet/Firestore
// by hand, then click Apply once in the Admin Dashboard.

const CHICKEN_SALAD_STEPS = [
  "Air Fryer: Set temperature to 370 F for 7 minutes and then flip and cook for another 11 minutes. Slow Cooker: Slow cook this on high for 1.5 hours (not sure how long exactly) w bone broth, paprika, italian seasoning, black pepper",
  "Pan Fried: 1 tbsp of butter.",
  "Slow Cooker: Slow cook this on high for 1.5 hours (not sure how long exactly) w bone broth (.25 cups), paprika, italian seasoning, black pepper",
  "Add seasoning to the chicken while it's cooking.",
  "Add all the remaining ingredients to a large container",
  "Dice celery, onion, and apple",
  "Stir everything up and serve on tortillas",
];
const CHICKEN_SALAD_INGREDIENTS = [
  { quantity: '3.00', measurement: 'regular',  ingredient: 'chicken breast' },
  { quantity: '0.00', measurement: 'tbsp',     ingredient: 'butter_unsalted' },
  { quantity: '0.00', measurement: 'cup(s)',   ingredient: 'bone broth' },
  { quantity: '0.5',  measurement: 'tbsp',     ingredient: 'italian seasoning' },
  { quantity: '0.5',  measurement: 'tbsp',     ingredient: 'garlic powder' },
  { quantity: '0.5',  measurement: 'tbsp',     ingredient: 'chilli powder' },
  { quantity: '1.00', measurement: 'cup(s)',   ingredient: 'siggis plain yogurt' },
  { quantity: '3.00', measurement: 'stalk(s)', ingredient: 'celery' },
  { quantity: '0.30', measurement: 'cup(s)',   ingredient: 'red onion(s)' },
  { quantity: '0.50', measurement: 'regular',  ingredient: 'apple(s)_honey crisp' },
  { quantity: '0.25', measurement: 'cup(s)',   ingredient: 'almonds, sliced' },
  { quantity: '1.00', measurement: 'tbsp',     ingredient: 'dijon mustard' },
  { quantity: '1.00', measurement: 'tbsp',     ingredient: 'honey mustard' },
  { quantity: '0.00', measurement: 'tsp',      ingredient: 'himalayan salt' },
  { quantity: '0.50', measurement: 'tsp',      ingredient: 'ground black pepper' },
  { quantity: '0.50', measurement: 'tbsp',     ingredient: 'flaxseed meal' },
  { quantity: '3.00', measurement: 'wrap',     ingredient: 'whole wheat tortillas_10 inch' },
];
const CHICKEN_SALAD_STEP_INGREDIENTS = {
  0: [0],
  1: [1],
  2: [2],
  3: [3, 4, 5],
  4: [6],
  5: [7, 8, 9, 10, 11, 12, 13, 14],
  6: [15, 16],
};

export const PENDING_RECIPE_FIXES = [
  {
    title: 'Mediterranean Protein Pasta',
    instructions: [
      'Preheat oven at 375F. Defrost salmon.',
      'Add items to a baking tray. Put cherry tomatoes under the spinach.',
      'Salmon skin facing up so you can take it off. Season them on a plate first.',
      'Bake in the oven for 30 mins at 375° F.',
      'In the meantime cook your pasta. In a large pan, bring bone broth to a boil. It says 8 cups, but give 4 a try.',
      'Then add the whole package of the pasta. Stir for 8 minutes and strain.',
      'Mix it all together. Pour lemon juice in a shot and pour on top.',
    ].join('\n'),
  },
  {
    title: 'Chicken Salad',
    ingredients: CHICKEN_SALAD_INGREDIENTS,
    instructions: CHICKEN_SALAD_STEPS.join('\n'),
    stepsArray: CHICKEN_SALAD_STEPS,
    stepIngredients: CHICKEN_SALAD_STEP_INGREDIENTS,
  },
];

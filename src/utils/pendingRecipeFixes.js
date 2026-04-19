// Pending one-shot recipe fixes applied via the Admin Dashboard's
// "Apply Recipe Fixes" button. Each entry can specify fields to overwrite
// on the admin's own recipe by title. Leave a field undefined to skip it.
//
// Typical usage: add an entry here when you want to correct instructions
// or ingredients text on a live recipe without editing the sheet/Firestore
// by hand, then click Apply once in the Admin Dashboard.

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
];

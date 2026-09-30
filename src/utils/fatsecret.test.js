import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asArray, parseFoodDescription, mapSearchResults, pickServing, mapFoodDetail, fatSecretConfigured,
} from '../../lib/fatsecret.js';

test('asArray normalises FatSecret single-object and missing results', () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray([{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
});

test('parseFoodDescription reads serving and macros', () => {
  const d = parseFoodDescription('Per 1 burger - Calories: 590kcal | Fat: 34.00g | Carbs: 46.00g | Protein: 25.00g');
  assert.deepEqual(d, { serving: '1 burger', calories: 590, fat: 34, carbs: 46, protein: 25 });
});

test('parseFoodDescription tolerates a hyphen inside the serving and junk input', () => {
  assert.equal(parseFoodDescription('Per 1 sandwich - large - Calories: 700kcal | Protein: 30g').calories, 700);
  assert.deepEqual(parseFoodDescription(''), { serving: '', calories: null, fat: null, carbs: null, protein: null });
});

test('mapSearchResults puts brand items first and keeps relevance order within groups', () => {
  const results = mapSearchResults({
    foods: {
      food: [
        { food_id: '1', food_name: 'Hamburger', food_type: 'Generic', food_description: 'Per 100g - Calories: 254kcal | Protein: 13g' },
        { food_id: '2', food_name: 'Big Mac', brand_name: "McDonald's", food_type: 'Brand', food_description: 'Per 1 burger - Calories: 590kcal | Protein: 25.00g' },
        { food_id: '3', food_name: 'Double Big Mac', brand_name: "McDonald's", food_type: 'Brand', food_description: 'Per 1 burger - Calories: 740kcal | Protein: 38.4g' },
      ],
    },
  });
  assert.deepEqual(results.map(r => r.id), ['2', '3', '1']);
  assert.deepEqual(results[0], {
    id: '2', source: 'fatsecret', name: 'Big Mac', brandName: "McDonald's",
    householdServing: '1 burger', calories: 590, protein: 25, isBrand: true,
  });
  assert.equal(results[1].protein, 38);
});

test('mapSearchResults handles a single match returned as an object, and no matches', () => {
  const one = mapSearchResults({ foods: { food: { food_id: 9, food_name: 'McFlurry', food_type: 'Brand', food_description: '' } } });
  assert.equal(one.length, 1);
  assert.equal(one[0].id, '9');
  assert.deepEqual(mapSearchResults({ foods: { total_results: '0' } }), []);
});

test('pickServing prefers a real portion over a metric row', () => {
  const s = pickServing([
    { serving_id: 'a', measurement_description: 'g' },
    { serving_id: 'b', measurement_description: 'serving' },
  ]);
  assert.equal(s.serving_id, 'b');
  assert.equal(pickServing({ serving_id: 'x', measurement_description: 'g' }).serving_id, 'x');
  assert.equal(pickServing(undefined), null);
});

test('mapFoodDetail returns the USDA-path nutrient keys from the chosen serving', () => {
  const detail = mapFoodDetail({
    food: {
      food_name: 'Big Mac',
      brand_name: "McDonald's",
      servings: {
        serving: [
          { serving_description: '100 g', measurement_description: 'g', metric_serving_amount: '100.000', metric_serving_unit: 'g', calories: '270' },
          {
            serving_description: '1 burger', measurement_description: 'serving',
            metric_serving_amount: '219.000', metric_serving_unit: 'g',
            calories: '590', protein: '25.00', carbohydrate: '46.00', fat: '34.00',
            saturated_fat: '11.000', sugar: '9.00', fiber: '3.0', sodium: '1050',
            potassium: '400', calcium: '110', iron: '4.5', vitamin_c: '1.2', cholesterol: '85',
          },
        ],
      },
    },
  });
  assert.equal(detail.name, 'Big Mac');
  assert.equal(detail.brandName, "McDonald's");
  assert.equal(detail.servingDescription, '1 burger');
  assert.equal(detail.servingSize, '219g');
  assert.deepEqual(detail.nutrients, {
    calories: 590, protein: 25, carbs: 46, fat: 34, saturatedFat: 11, sugar: 9, fiber: 3,
    sodium: 1050, potassium: 400, calcium: 110, iron: 4.5,
    magnesium: 0, zinc: 0, vitaminB12: 0, vitaminC: 1.2, cholesterol: 85,
  });
});

test('fatSecretConfigured needs both id and secret', () => {
  assert.equal(fatSecretConfigured({}), false);
  assert.equal(fatSecretConfigured({ FATSECRET_CLIENT_ID: 'a' }), false);
  assert.equal(fatSecretConfigured({ FATSECRET_CLIENT_ID: 'a', FATSECRET_CLIENT_SECRET: 'b' }), true);
});

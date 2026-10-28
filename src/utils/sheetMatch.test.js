import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchStrength, containsWords, findMatch } from './sheetMatch.js';

test('the rows from the bug report', () => {
  assert.equal(matchStrength('milk', 'milk (from your sheet)'), 'good');
  assert.equal(matchStrength('maple syrup', 'maple syrup (from your sheet)'), 'good');
  assert.equal(matchStrength('chia seeds', 'chia seeds (from your sheet)'), 'good');
  assert.equal(matchStrength('pumpkin puree', 'pumpkin, raw'), 'partial');
  assert.equal(matchStrength('pumpkin pie spice', 'ice (from your sheet)'), 'weak');
  assert.equal(matchStrength('salt', 'butter_salted (from your sheet)'), 'weak');
});

test('plurals, separators and filler words do not count against a match', () => {
  assert.equal(matchStrength('eggs', 'Egg, whole, raw, fresh'), 'good');
  assert.equal(matchStrength('fresh blueberries', 'blueberry'), 'good');
  assert.equal(matchStrength('black_beans', 'Black beans, cooked'), 'good');
});

test('containsWords needs whole words in order', () => {
  assert.equal(containsWords('sea salt', 'salt'), true);
  assert.equal(containsWords('butter_salted', 'salt'), false);
  assert.equal(containsWords('pumpkin pie spice', 'ice'), false);
  assert.equal(containsWords('greek yogurt plain', 'greek yogurt'), true);
  assert.equal(containsWords('yogurt greek', 'greek yogurt'), false);
});
const rows = ['milk', 'ice', 'butter_salted', 'chia seeds', 'maple syrup', 'sea salt', 'greek yogurt plain', 'eggs']
  .map(name => ({ name }));
const find = q => findMatch(rows, q)?.name ?? null;

test('substrings inside other words no longer match', () => {
  assert.equal(find('pumpkin pie spice'), null);
  assert.equal(find('chili spice'), null);
  assert.equal(find('salt'), 'sea salt');
  assert.equal(findMatch([{ name: 'butter_salted' }], 'salt'), null);
});

test('real matches still work', () => {
  assert.equal(find('milk'), 'milk');
  assert.equal(find('Chia Seeds'), 'chia seeds');
  assert.equal(find('greek yogurt'), 'greek yogurt plain');
  assert.equal(find('egg'), 'eggs');
  assert.equal(find('pure maple syrup'), 'maple syrup');
  assert.equal(find('whole milk'), 'milk');
});

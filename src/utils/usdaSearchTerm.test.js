import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSearchTerm } from './usdaSearchTerm.js';

describe('getSearchTerm', () => {
  it('swaps in the USDA term for known names', () => {
    assert.equal(getSearchTerm('salt'), 'salt, table');
    assert.equal(getSearchTerm('Sea Salt'), 'salt, table');
    assert.equal(getSearchTerm('eggs'), 'egg, whole, raw');
  });
  it('cleans up the rest', () => {
    assert.equal(getSearchTerm('pumpkin pie spice (optional)'), 'pumpkin pie spice');
    assert.equal(getSearchTerm('chia seeds or flax'), 'chia seeds');
  });
});

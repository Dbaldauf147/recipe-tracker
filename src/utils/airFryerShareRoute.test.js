import assert from 'node:assert/strict';
import { it } from 'node:test';
import { airFryerShareRoute } from './airFryerShareRoute.js';

it('reads the token from a clean link', () => {
  assert.equal(airFryerShareRoute('/air-fryer/fcpHVHYWEW'), 'fcpHVHYWEW');
  assert.equal(airFryerShareRoute('/air-fryer/fcpHVHYWEW/'), 'fcpHVHYWEW');
  assert.equal(airFryerShareRoute('/', '?airfryer=fcpHVHYWEW'), 'fcpHVHYWEW');
});

it('ignores whatever a paste dragged along', () => {
  for (const tail of ['**', '%2A%2A', '.', ')', '%20', '/foo', '!']) {
    assert.equal(airFryerShareRoute(`/air-fryer/fcpHVHYWEW${tail}`), 'fcpHVHYWEW', tail);
  }
  assert.equal(airFryerShareRoute('/', '?airfryer=fcpHVHYWEW**'), 'fcpHVHYWEW');
});

it('an unreadable token is still the public page, never the app', () => {
  assert.equal(airFryerShareRoute('/air-fryer/'), '');
  assert.equal(airFryerShareRoute('/air-fryer/**'), '');
});

it('other urls are not the air fryer link', () => {
  assert.equal(airFryerShareRoute('/'), null);
  assert.equal(airFryerShareRoute('/', '?share=abc'), null);
  assert.equal(airFryerShareRoute('/air-fryer-tips'), null);
});

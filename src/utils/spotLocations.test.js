import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodeAreaNames, locationsFromGeocode, mergeLocations } from './spotLocations.js';

// Filing an imported spot under a neighborhood. The fixtures below are real
// Nominatim `address` objects (addressdetails=1), kept verbatim because the
// whole difficulty here is that its field names don't mean the same thing in
// two different cities — a made-up fixture would quietly design that away.

// 567 Union Ave, Brooklyn: the neighborhood is `quarter`, `suburb` is a borough.
const LILIA = {
  house_number: '567', road: 'Union Avenue', quarter: 'Williamsburg',
  suburb: 'Brooklyn', county: 'Kings County', city: 'New York', state: 'New York',
};
// 237 St James Pl, Philadelphia: no `quarter` at all, and `suburb` is the
// neighborhood rather than a borough.
const ZAHAV = {
  house_number: '237', road: 'Saint James Place', suburb: 'Center City',
  city: 'Philadelphia', county: 'Philadelphia County', state: 'Pennsylvania',
};

test('candidates run most specific to broadest', () => {
  assert.deepEqual(geocodeAreaNames(LILIA), ['Williamsburg', 'Brooklyn', 'New York']);
  assert.deepEqual(geocodeAreaNames(ZAHAV), ['Center City', 'Philadelphia']);
});

test('a name the user already files under wins, in their spelling', () => {
  // Files by borough → Brooklyn, even though Williamsburg is more specific.
  assert.deepEqual(locationsFromGeocode(LILIA, ['Brooklyn', 'Manhattan']), ['Brooklyn']);
  // Files by neighborhood → Williamsburg.
  assert.deepEqual(locationsFromGeocode(LILIA, ['Williamsburg', 'Astoria']), ['Williamsburg']);
  // Uses both → gets both, most specific first.
  assert.deepEqual(
    locationsFromGeocode(LILIA, ['Brooklyn', 'Williamsburg']),
    ['Williamsburg', 'Brooklyn'],
  );
});

test('their casing and spelling survive the match', () => {
  // The list says "WILLIAMSBURG"; the geocoder says "Williamsburg". The chip
  // has to read the way the rest of their list does, or it looks like a second
  // different place.
  assert.deepEqual(locationsFromGeocode(LILIA, ['WILLIAMSBURG']), ['WILLIAMSBURG']);
});

test('nothing recognised falls back to the most specific area plus the city', () => {
  assert.deepEqual(locationsFromGeocode(LILIA, []), ['Williamsburg', 'New York']);
  assert.deepEqual(locationsFromGeocode(LILIA, ['Philadelphia']), ['Williamsburg', 'New York']);
});

test('the city is not repeated when it IS the area', () => {
  // A town with no sub-areas: city and area collapse to the same name, and one
  // chip saying it twice would be a bug on the very first import.
  const smallTown = { road: 'Main Street', city: 'Hudson', state: 'New York' };
  assert.deepEqual(locationsFromGeocode(smallTown, []), ['Hudson']);
});

test('a result with no place names at all yields nothing', () => {
  assert.deepEqual(locationsFromGeocode({ road: 'Main Street' }, []), []);
  assert.deepEqual(locationsFromGeocode(undefined, []), []);
  assert.deepEqual(locationsFromGeocode(null, ['Brooklyn']), []);
});

test('duplicate levels collapse', () => {
  // Nominatim repeats the same name across fields in some places.
  const dup = { suburb: 'Hoboken', city: 'Hoboken', town: 'Hoboken' };
  assert.deepEqual(geocodeAreaNames(dup), ['Hoboken']);
});

test('merging never disturbs what is already on the form', () => {
  assert.deepEqual(mergeLocations(['Brooklyn'], ['Williamsburg']), ['Brooklyn', 'Williamsburg']);
  // Already there, differently cased → left alone, not duplicated.
  assert.deepEqual(mergeLocations(['brooklyn'], ['Brooklyn']), ['brooklyn']);
  // Nothing new → the SAME array reference, so React state doesn't churn.
  const current = ['Brooklyn'];
  assert.equal(mergeLocations(current, ['Brooklyn']), current);
});

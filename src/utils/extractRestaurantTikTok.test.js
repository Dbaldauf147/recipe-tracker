import test from 'node:test';
import assert from 'node:assert/strict';
import { isTikTokUrl, parsePlaceFromModel } from '../../api/extract-restaurant.js';

// A TikTok place import reads the caption, and when that names nothing it
// transcribes the video's audio and asks the model who the video is about.
// These cover the two pure decisions in that path: is this a TikTok link, and
// is the model's answer good enough to put in the Name box.

test('TikTok links are recognised, including the short share form', () => {
  assert.equal(isTikTokUrl('https://www.tiktok.com/@someone/video/7300000000000000000'), true);
  assert.equal(isTikTokUrl('https://vm.tiktok.com/ZGeAbCdEf/'), true);
  assert.equal(isTikTokUrl('https://m.tiktok.com/v/7300000000000000000.html'), true);
  assert.equal(isTikTokUrl('https://www.instagram.com/reel/abc/'), false);
  assert.equal(isTikTokUrl('https://maps.app.goo.gl/abc'), false);
  assert.equal(isTikTokUrl(''), false);
  assert.equal(isTikTokUrl(null), false);
});

test('a confident answer gives the name, address and the phrase it came from', () => {
  const res = parsePlaceFromModel(
    '{"name": "Lucali", "address": "Carroll Gardens, Brooklyn", "quote": "we are at Lucali in Brooklyn", "confident": true}'
  );
  assert.equal(res.name, 'Lucali');
  assert.equal(res.address, 'Carroll Gardens, Brooklyn');
  assert.equal(res.quote, 'we are at Lucali in Brooklyn');
});

test('JSON wrapped in prose or a code fence is still read', () => {
  const res = parsePlaceFromModel('Here you go:\n```json\n{"name": "Tatiana", "confident": true}\n```');
  assert.equal(res.name, 'Tatiana');
});

test('an unsure model names nothing — better an empty box than a wrong spot', () => {
  assert.equal(parsePlaceFromModel('{"name": "Joe\'s", "confident": false}').name, '');
  assert.equal(parsePlaceFromModel('{"name": "", "confident": true}').name, '');
  assert.equal(parsePlaceFromModel('{"name": "Unknown", "confident": true}').name, '');
  assert.equal(parsePlaceFromModel('{"name": "not stated", "confident": true}').name, '');
});

test('a non-answer never becomes a name', () => {
  assert.equal(parsePlaceFromModel('').name, '');
  assert.equal(parsePlaceFromModel('I could not tell from this video.').name, '');
  assert.equal(parsePlaceFromModel('{broken json').name, '');
  // A whole sentence in the name field is the model narrating, not a venue.
  const long = 'x'.repeat(81);
  assert.equal(parsePlaceFromModel(`{"name": "${long}", "confident": true}`).name, '');
});

test('missing address and quote come back as empty strings, not undefined', () => {
  const res = parsePlaceFromModel('{"name": "Superiority Burger", "confident": true}');
  assert.equal(res.address, '');
  assert.equal(res.quote, '');
});

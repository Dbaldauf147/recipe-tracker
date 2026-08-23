import { test } from 'node:test';
import assert from 'node:assert';
import { sharedRecipeAppLink, detectMobilePlatform } from './openInApp.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

test('sharedRecipeAppLink builds the app route the token belongs to', () => {
  assert.equal(sharedRecipeAppLink('Ab3xY9'), 'prepday://share?token=Ab3xY9');
});

test('sharedRecipeAppLink escapes anything that would break the query string', () => {
  assert.equal(sharedRecipeAppLink('a b&c=d'), 'prepday://share?token=a%20b%26c%3Dd');
});

test('sharedRecipeAppLink returns empty for a missing token, so nothing is offered', () => {
  assert.equal(sharedRecipeAppLink(''), '');
  assert.equal(sharedRecipeAppLink(null), '');
  assert.equal(sharedRecipeAppLink('   '), '');
});

test('detectMobilePlatform identifies the phones', () => {
  assert.equal(detectMobilePlatform(IPHONE, 5), 'ios');
  assert.equal(detectMobilePlatform(ANDROID, 5), 'android');
});

test('detectMobilePlatform catches iPadOS, which lies about being a Mac', () => {
  assert.equal(detectMobilePlatform(IPAD_OS, 5), 'ios');
});

test('detectMobilePlatform leaves a real desktop alone', () => {
  // Same user agent as the iPad above — only the touch points tell them apart,
  // which is exactly why this case is pinned.
  assert.equal(detectMobilePlatform(IPAD_OS, 0), null);
  assert.equal(detectMobilePlatform(MAC, 0), null);
  assert.equal(detectMobilePlatform('', 0), null);
});

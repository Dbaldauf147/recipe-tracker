/* global process, Buffer */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoRecipeReply, hasRecipeAmounts } from '../../lib/videoRecipe.js';

test('hasRecipeAmounts spots real amounts, not hashtags', () => {
  assert.equal(hasRecipeAmounts('2 cups rice, 1 tbsp oil'), true);
  assert.equal(hasRecipeAmounts('150g chicken'), true);
  assert.equal(hasRecipeAmounts('50 grams of protein per serving'), true);
  assert.equal(hasRecipeAmounts('easy dinner 🔥 #recipe #highprotein'), false);
  assert.equal(hasRecipeAmounts('4 ingredients only'), false);
  assert.equal(hasRecipeAmounts(''), false);
});

test('parseVideoRecipeReply reads a fenced JSON reply', () => {
  const r = parseVideoRecipeReply('```json\n{"title":"Salsa Chicken","titleSource":"screen","servings":4,"ingredients":[{"quantity":"1","measurement":"cup","ingredient":"rice"},{"ingredient":""}],"instructions":["Mix.","Cook."],"amountsFromVideo":true}\n```');
  assert.equal(r.title, 'Salsa Chicken');
  assert.equal(r.titleSource, 'screen');
  assert.equal(r.servings, '4');
  assert.deepEqual(r.ingredients, [{ quantity: '1', measurement: 'cup', ingredient: 'rice' }]);
  assert.equal(r.instructions, 'Mix.\nCook.');
  assert.equal(r.amountsFromVideo, true);
});

test('parseVideoRecipeReply accepts plain-string ingredients', () => {
  const r = parseVideoRecipeReply('{"title":"Toast","ingredients":["bread"],"instructions":"Toast it."}');
  assert.deepEqual(r.ingredients, [{ quantity: '', measurement: '', ingredient: 'bread' }]);
  assert.equal(r.amountsFromVideo, false);
  assert.equal(r.titleSource, '');
});

test('parseVideoRecipeReply returns null for no recipe or junk', () => {
  assert.equal(parseVideoRecipeReply('{"error":"no recipe"}'), null);
  assert.equal(parseVideoRecipeReply('not json'), null);
  assert.equal(parseVideoRecipeReply('{"title":"","ingredients":[]}'), null);
  assert.equal(parseVideoRecipeReply(''), null);
});

import { tiktokMedia, imageMimeType, readRecipeFromImages } from '../../lib/videoRecipe.js';

test('tiktokMedia: a photo post yields slides, not its music as a video', () => {
  const m = tiktokMedia({ data: {
    title: '#figgychristmas #bourbondrink',
    play: 'https://cdn.example/music.mp3',
    cover: 'https://cdn.example/cover.jpeg',
    images: ['https://cdn.example/1.jpeg', 'https://cdn.example/2.jpeg', null],
    author: { unique_id: 'sexidrummer' },
  } });
  assert.deepEqual(m.imageUrls, ['https://cdn.example/1.jpeg', 'https://cdn.example/2.jpeg']);
  assert.equal(m.videoUrl, '');
  assert.equal(m.coverUrl, 'https://cdn.example/cover.jpeg');
  assert.equal(m.caption, '#figgychristmas #bourbondrink');
  assert.equal(m.author, 'sexidrummer');
});

test('tiktokMedia: a video post keeps its play URL', () => {
  const m = tiktokMedia({ data: { play: 'https://cdn.example/v.mp4' } });
  assert.equal(m.videoUrl, 'https://cdn.example/v.mp4');
  assert.deepEqual(m.imageUrls, []);
  assert.deepEqual(tiktokMedia(null).imageUrls, []);
});

test('imageMimeType accepts Gemini image types, falls back to the extension', () => {
  assert.equal(imageMimeType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(imageMimeType('image/jpg'), 'image/jpeg');
  assert.equal(imageMimeType('image/webp'), 'image/webp');
  assert.equal(imageMimeType('application/octet-stream', 'https://x/a.JPEG?sig=1'), 'image/jpeg');
  assert.equal(imageMimeType('image/gif', 'https://x/a.gif'), '');
  assert.equal(imageMimeType('', 'https://x/a'), '');
});

test('readRecipeFromImages sends every readable slide to Gemini and parses the reply', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let geminiBody = null;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      geminiBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text:
        '{"title":"Figgy Christmas","titleSource":"screen","ingredients":[{"quantity":"2","measurement":"oz","ingredient":"bourbon"},{"ingredient":"Ice"}],"instructions":"1. Shake w/ ice\\n2. Strain","amountsFromVideo":true}',
      }] } }] }), { status: 200 });
    }
    if (u.endsWith('bad.gif')) return new Response('GIF', { status: 200, headers: { 'content-type': 'image/gif' } });
    if (u.endsWith('gone.jpeg')) return new Response('', { status: 404 });
    return new Response(Buffer.from('jpegbytes'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const out = await readRecipeFromImages(
      ['https://cdn/1.jpeg', 'https://cdn/bad.gif', 'https://cdn/gone.jpeg', 'https://cdn/2.jpeg'],
      { caption: '#figgychristmas', author: 'sexidrummer' },
    );
    assert.equal(out.watched, true);
    assert.equal(out.recipe.title, 'Figgy Christmas');
    assert.deepEqual(out.recipe.ingredients[1], { quantity: '', measurement: '', ingredient: 'Ice' });
    assert.equal(out.recipe.amountsFromVideo, true);
    const parts = geminiBody.contents[0].parts;
    assert.equal(parts.filter(p => p.inline_data).length, 2, 'only the two readable JPEGs are sent');
    assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
    assert.match(parts.at(-1).text, /slides of one social media post/);
    assert.match(parts.at(-1).text, /Caption: #figgychristmas/);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = realKey;
  }
});

test('readRecipeFromImages reports why when no slide is readable', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let calledGemini = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage')) calledGemini = true;
    return new Response('', { status: 403 });
  };
  try {
    const out = await readRecipeFromImages(['https://cdn/1.jpeg']);
    assert.deepEqual(out, { recipe: null, watched: false, error: 'image fetch 403' });
    assert.equal(calledGemini, false);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = realKey;
  }
});

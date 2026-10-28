import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPageHtml, BROWSER_HEADERS, PLAIN_HEADERS } from '../../lib/fetchPage.js';

// A fake fetch answering each attempt from `replies` in turn, recording the
// User-Agent it was asked with.
function fakeFetch(replies) {
  const asked = [];
  const impl = async (_url, { headers }) => {
    asked.push(headers['User-Agent']);
    const r = replies[asked.length - 1];
    if (r instanceof Error) throw r;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: { get: k => (r.headers || {})[k.toLowerCase()] ?? null },
      text: async () => r.body ?? '',
    };
  };
  return { impl, asked };
}

test('a page that answers the browser request is used as is', async () => {
  const f = fakeFetch([{ status: 200, body: '<html>ok</html>' }]);
  assert.deepEqual(await fetchPageHtml('u', { fetchImpl: f.impl }), { html: '<html>ok</html>', status: 200 });
  assert.deepEqual(f.asked, [BROWSER_HEADERS['User-Agent']]);
});

test('a Cloudflare 403 challenge is retried with the plain User-Agent', async () => {
  const f = fakeFetch([{ status: 403, headers: { 'cf-mitigated': 'challenge' } }, { status: 200, body: 'recipe' }]);
  assert.deepEqual(await fetchPageHtml('u', { fetchImpl: f.impl }), { html: 'recipe', status: 200 });
  assert.deepEqual(f.asked, [BROWSER_HEADERS['User-Agent'], PLAIN_HEADERS['User-Agent']]);
});

test('a 200 challenge page is not taken for the recipe', async () => {
  const f = fakeFetch([{ status: 200, headers: { 'cf-mitigated': 'challenge' }, body: 'Just a moment' }, { status: 200, body: 'recipe' }]);
  assert.equal((await fetchPageHtml('u', { fetchImpl: f.impl })).html, 'recipe');
});

test('a 404 is not retried; blocked twice reports the last status', async () => {
  const notFound = fakeFetch([{ status: 404 }]);
  assert.deepEqual(await fetchPageHtml('u', { fetchImpl: notFound.impl }), { html: '', status: 404 });
  assert.equal(notFound.asked.length, 1);
  const walled = fakeFetch([{ status: 403 }, { status: 429 }]);
  assert.deepEqual(await fetchPageHtml('u', { fetchImpl: walled.impl }), { html: '', status: 429 });
});

test('a network error on the first try still gets the second', async () => {
  const f = fakeFetch([new Error('ECONNRESET'), { status: 200, body: 'ok' }]);
  assert.deepEqual(await fetchPageHtml('u', { fetchImpl: f.impl }), { html: 'ok', status: 200 });
});

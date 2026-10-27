import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore(), sentinel = 'FS_FAKE_KEY_SENTINEL_1234';
const settings = C.createSoundSettings(null); settings.set({ freesoundKey: sentinel });
const valid = { id: 1, name: 'kick', username: 'tester', url: 'https://freesound.org/people/tester/sounds/1/', license: 'http://creativecommons.org/publicdomain/zero/1.0/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/1/1_test.mp3' } };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
let clock = 0; const calls = [];
const fake = (url, opts) => { calls.push({ url, opts, time: clock }); return Promise.resolve(url.includes('/previews/') ? new Response(new Uint8Array([1, 2])) : json(url.includes('search/text') ? { results: [valid] } : valid)); };
const net = C.createNetwork({ fetch: fake, settings, now: () => clock, sleep: async (ms) => { clock += ms; } });
const a = net.freesoundSearch({ query: 'kick' }), b = net.freesoundSearch({ query: 'kick' });
assert.deepEqual(await a, await b); assert.equal(calls.length, 1);
await net.freesoundSound(1); await net.freesoundPreview(valid.previews['preview-hq-mp3']);
assert.ok(calls[1].time - calls[0].time >= 2000);
for (const c of calls) {
  assert.equal(c.opts.redirect, 'error'); assert.equal(c.opts.credentials, 'omit');
  assert.equal(c.opts.headers.Authorization, c.url.startsWith('https://freesound.org/apiv2/') ? 'Token ' + sentinel : undefined);
}
const q = new URL(calls[0].url).searchParams;
assert.match(q.get('filter'), /license:"Creative Commons 0"/); assert.match(q.get('filter'), /duration:\[0 TO 6\]/);
for (const params of [{ host: 'evil' }, { query: 'x&token=secret' }, { query: 'https://evil' }, { fields: ['token'] }, { pageSize: 31 }, { maxDuration: 100 }]) await assert.rejects(net.freesoundSearch(params), { code: 'invalid' });
for (const url of ['https://evil/previews/a.mp3', valid.previews['preview-hq-mp3'] + '?key=x', 'https://user@cdn.freesound.org/previews/a.mp3']) await assert.rejects(net.freesoundPreview(url), { code: 'invalid' });
const make = (fetch, opts = {}) => C.createNetwork({ fetch, settings, now: () => clock, sleep: async (ms) => { clock += ms; }, ...opts });
for (const status of [401, 429, 500]) {
  let count = 0; const start = clock;
  const n = make(async () => { count++; return json({ secret: sentinel }, status, { 'Retry-After': '8' }); });
  await assert.rejects(n.probe(), (e) => { for (const s of [e.message, String(e), JSON.stringify(e)]) assert.ok(!s.includes(sentinel)); return true; });
  assert.equal(count, status === 401 ? 1 : 3); if (status === 429) assert.ok(clock - start >= 16000);
}
await assert.rejects(make(async () => { throw new Error(sentinel); }).probe(), (e) => !String(e).includes(sentinel));
await assert.rejects(make(() => new Promise(() => {}), { timeout: 5 }).probe(), { code: 'timeout' });
for (const api of [true, false]) {
  const call = (n) => api ? n.probe() : n.freesoundPreview(valid.previews['preview-hq-mp3']);
  await assert.rejects(call(make(async () => new Response('', { headers: { 'Content-Length': '1600000' } }))), { code: 'size' });
  await assert.rejects(call(make(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(800001)); c.enqueue(new Uint8Array(800001)); c.close(); } })))), { code: 'size' });
}
await assert.rejects(C.createNetwork({ settings: C.createSoundSettings(null), fetch: () => { throw Error('must not fetch'); } }).probe(), { code: 'missing' });
let attempts = 0;
const recovered = make(async () => ++attempts < 3 ? json({}, 503) : json({ results: [valid, { ...valid, license: 'bad' }] }));
assert.equal((await recovered.probe()).results.length, 1); assert.equal(attempts, 3);
await assert.rejects(make(async () => new Response(new ReadableStream({ start() {} })), { timeout: 5 }).probe(), { code: 'timeout' });
const simultaneous = [];
const ordered = make(async (url) => { simultaneous.push(clock); return json(valid); });
await Promise.all([ordered.freesoundSound(1), ordered.freesoundSound(2), ordered.freesoundSound(3)]);
assert.ok(simultaneous[1] - simultaneous[0] >= 2000); assert.ok(simultaneous[2] - simultaneous[1] >= 2000);
console.log('network: endpoints, headers, limits, throttle, dedupe, retries, redaction OK');

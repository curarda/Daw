import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push(e.message));
  await page.route('https://**/*', (r) => /Tone\.js/.test(r.request().url()) ? r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }) : r.abort());
  const url = new URL('../index.html', import.meta.url).href;
  const ready = () => page.waitForFunction(() => window.__dawAPI?.soundSettings && /Hazır/.test(document.querySelector('#status').textContent));
  await page.goto(url); await ready();
  await page.locator('[data-key="s10"]').evaluate((e) => { e.open = true; });
  assert.match(await page.locator('[data-key="s10"] summary').innerText(), /10\s*Gerçek sesler\s*kapalı/);
  const fs = 'FS_FAKE_KEY_SENTINEL_1234', gem = 'GEM_FAKE_KEY_SENTINEL_5678';
  for (const id of ['inFreesoundKey', 'inGeminiKey']) { assert.equal(await page.locator('#' + id).getAttribute('type'), 'password'); assert.equal(await page.locator('#' + id).getAttribute('autocomplete'), 'off'); }
  await page.fill('#inFreesoundKey', fs); await page.fill('#inGeminiKey', gem); await page.click('#btnSoundSave');
  assert.notEqual(await page.inputValue('#inFreesoundKey'), fs);
  await page.reload(); await ready();
  await page.locator('[data-key="s10"]').evaluate((e) => { e.open = true; });
  assert.equal(await page.evaluate(() => window.__dawAPI.soundSettings.get().freesoundKey), fs);
  const fixture = await page.evaluate(() => {
    const p = window.Core.newProject(); p.piano.style = 'synth-arp';
    p.midiData = { name: 'settings-test', endQ: 4, notes: [{ q0: 0, q1: 1, midi: 60, vel: 80 }] }; return p;
  });
  await page.setInputFiles('#fileProject', { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
  await page.evaluate(() => document.querySelectorAll('details').forEach((e) => { e.open = true; }));
  await page.evaluate(() => {
    const { S, hist } = window.__dawAPI, h = hist();
    const prior = structuredClone(S.proj); prior.realSounds = { enabled: true, drums: { K: { id: 1, license: 'bad' } }, bass: [] };
    h.undo.push(JSON.stringify(prior)); h.last = 'proj';
  });
  await page.locator('#btnSave').focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(() => /Geri alındı/.test(document.querySelector('#status').textContent));
  assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.realSounds), { enabled: true, drums: {}, bass: [] });
  const locations = await page.evaluate(() => ({ session: JSON.stringify(sessionStorage), keys: Object.keys(localStorage).filter((k) => k !== 'miniDaw.soundSettings.v1').map((k) => localStorage.getItem(k)).join('') }));
  for (const key of [fs, gem]) assert.ok(!JSON.stringify(locations).includes(key));
  for (const button of ['btnSave', 'btnExpChart', 'btnExpMidi', 'btnExpMix']) {
    const wait = page.waitForEvent('download'); await page.click('#' + button); const dl = await wait;
    const bytes = readFileSync(await dl.path()); for (const key of [fs, gem]) assert.ok(!bytes.includes(Buffer.from(key)), button);
  }
  const state = await page.evaluate(() => JSON.stringify({ project: window.__dawAPI.S.proj, history: window.__dawAPI.hist(), dom: document.documentElement.outerHTML }));
  for (const key of [fs, gem]) { assert.ok(!state.includes(key)); assert.ok(!logs.join('\n').includes(key)); }
  for (const [outcome, expected] of [['ok', 'ok'], ['401', '401'], ['429', '429'], ['offline', 'Bağlantı kurulamadı']]) {
    await page.evaluate((outcome) => {
      window.__dawAPI.network.setFetch(async () => { if (outcome === 'offline') throw Error('offline'); return new Response(JSON.stringify({ results: [] }), { status: outcome === 'ok' ? 200 : Number(outcome) }); }, { now: () => 100000, sleep: async () => {} });
    }, outcome);
    await page.click('#btnSoundProbe'); await page.waitForFunction(() => !document.querySelector('#btnSoundProbe').disabled);
    assert.ok((await page.locator('#soundProbeStatus').innerText()).includes(expected));
  }
  const cache = await page.evaluate(async () => {
    const C = window.Core, c = C.createSoundCache({ cap: 1100 });
    const r = (id) => ({ id, name: 'kick', author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3` });
    for (const id of [1, 2]) await c.put(r(id), new Uint8Array(200));
    await c.get(1, r(1).previewUrl); await c.put(r(3), new Uint8Array(200));
    const reopened = C.createSoundCache({ cap: 1100 });
    return { stats: await reopened.stats(), hit: !!await reopened.get(1, r(1).previewUrl), miss: await reopened.get(2, r(2).previewUrl) };
  });
  assert.equal(cache.stats.backend, 'indexedDB'); assert.ok(cache.hit); assert.equal(cache.miss, null); assert.ok(cache.stats.bytes <= 1100);
  await page.click('#btnSoundClear'); assert.equal(await page.inputValue('#inFreesoundKey'), '');
  await page.click('#btnSoundProbe'); await page.waitForFunction(() => /Önce Freesound/.test(document.querySelector('#soundProbeStatus').textContent));
  await page.reload(); await ready(); assert.equal(await page.evaluate(() => window.__dawAPI.soundSettings.get().freesoundKey), '');
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } }); });
  await page.reload(); await ready();
  assert.match(await page.locator('#soundStorageStatus').textContent(), /Tarayıcı depolaması kapalı/);
  for (const key of [fs, gem]) assert.ok(!logs.join('\n').includes(key));
  console.log('sound-settings-ui: panel, isolation/exports, probe outcomes, IndexedDB, blocked storage OK');
} finally { await browser.close(); }

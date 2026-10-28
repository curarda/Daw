import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route('https://**/*', (r) => /Tone\.js/.test(r.request().url()) ? r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }) : r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI?.soundSelection && /Hazır/.test(document.querySelector('#status').textContent));
  const show = () => page.evaluate(() => document.querySelectorAll('details.step').forEach((el) => { el.open = true; })); await show();
  assert.equal(await page.locator('#btnBassSoundSelect').isDisabled(), true);
  const fs = 'FS_FAKE_KEY_SENTINEL_1234', gem = 'GEM_FAKE_KEY_SENTINEL_5678';
  await page.fill('#inFreesoundKey', fs); await page.click('#btnSoundSave');
  assert.equal(await page.locator('#btnBassSoundSelect').isEnabled(), true); assert.match(await page.locator('#bassSoundHint').textContent(), /deterministik/);
  assert.notEqual(await page.inputValue('#inFreesoundKey'), fs);
  const fixture = await page.evaluate(() => {
    const p = window.Core.newProject(); p.piano.style = 'synth-arp';
    p.sections = [{ id: 'private-id', name: 'PRIVATE_SECTION', type: 'verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }];
    p.midiData = { name: 'PRIVATE_FILE.mid', endQ: 16, notes: [{ q0: 0, q1: 1, midi: 60, vel: 80 }] }; return p;
  });
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Test projesi yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'bass-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent)); await show();
  };
  const configure = (mode = 'ok') => page.evaluate((mode) => {
    const A = window.__dawAPI, C = A.C, control = window.__bassTest = { mode, searches: 0, prompts: [], waiting: false, release: null };
    const network = {
      async freesoundSearch() { control.searches++; return { candidates: [1, 2, 3, 4, 5, 6].map((id) => ({ record: { id, name: '<img src=x onerror=alert(1)> bass note', author: '<b>tester</b>', url: `https://freesound.org/people/tester/sounds/${id}/`, previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, license: 'https://creativecommons.org/publicdomain/zero/1.0/' }, duration: 1, tags: ['bass', 'note'] })) }; },
      async freesoundPreview(url) { return Uint8Array.of(Number(/\/(\d+)_test/.exec(url)[1])); }
    };
    A.soundSelection.inject({ network, cache: C.createSoundCache({ indexedDB: null }), decode: async (bytes) => {
      if (control.mode === 'hold' && !control.waiting) { control.waiting = true; await new Promise((resolve) => { control.release = resolve; }); }
      const sr = 16000, midi = [0, 28, 40, 50, 29, 41, 51][bytes[0]], hz = 440 * 2 ** ((midi - 69) / 12);
      return { sampleRate: sr, channels: [Float32Array.from({ length: sr }, (_, i) => { const t = i / sr, phase = 2 * Math.PI * hz * t; return control.mode === 'fail' ? 0 : .35 * (1 - Math.exp(-100 * t)) * Math.exp(-1.5 * t) * (Math.sin(phase) + .3 * Math.sin(2 * phase)); })] };
    }, gemini: async (request) => {
      control.prompts.push(request); const data = JSON.parse(request.user.split('\n')[1]);
      return data.candidates ? { choices: data.candidates.bass.slice(-3).map((r) => ({ lane: 'bass', id: r.id, why: '<b>Kararlı</b>\x00 bas.' })) } : { queries: { bass: ['bass note'] } };
    } });
  }, mode);
  const state = () => page.evaluate(() => structuredClone(window.__dawAPI.S.proj.realSounds));
  const depth = () => page.evaluate(() => window.__dawAPI.hist().undo.length);
  const done = () => page.waitForFunction(() => /Bas sesleri seçildi/.test(document.querySelector('#bassSoundStatus').textContent));
  const undo = async (redo = false) => {
    await page.locator('#btnSave').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo);
  };
  await open(fixture); await configure(); let before = await depth(); await page.click('#btnBassSoundSelect'); await done();
  const chosen = await state(); assert.equal(await depth(), before + 1); assert.deepEqual(chosen.bass.map((r) => r.rootMidi), [28, 40, 50]); assert.equal(chosen.enabled, false);
  assert.equal(await page.locator('#bassSoundList [data-bass-sound-id]').count(), 3); assert.equal(await page.locator('#bassSoundList img, #bassSoundList b').count(), 0);
  assert.match(await page.locator('#bassSoundList').textContent(), /E1 \(\+\d+ cent\).*güven: %/);
  assert.match(await page.locator('#soundCredits').textContent(), /CC0/);
  for (const link of await page.locator('#bassSoundList a').all()) { assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('target'), '_blank'); }
  before = await depth(); await page.click('#btnBassSoundReroll'); await done(); const rerolled = await state(); assert.deepEqual(rerolled.bass.map((r) => r.id), [4, 5, 6]); assert.equal(await depth(), before + 1);
  await undo(); assert.deepEqual(await state(), chosen); await undo(true); assert.deepEqual(await state(), rerolled);
  before = await depth(); await page.click('#btnBassSoundReset'); assert.deepEqual((await state()).bass, []); assert.equal(await depth(), before + 1); await undo(); assert.deepEqual(await state(), rerolled);
  await configure('fail'); const intact = await state(); before = await depth(); await page.click('#btnBassSoundSelect');
  await page.waitForFunction(() => /kararlı perdeli.*bulunamadı/.test(document.querySelector('#bassSoundStatus').textContent)); assert.deepEqual(await state(), intact); assert.equal(await depth(), before);
  await page.fill('#inGeminiKey', gem); await page.click('#btnSoundSave'); await configure(); await page.click('#btnBassSoundSelect'); await done();
  const ai = await state(); assert.ok(ai.bass.every((r) => r.selector === 'gemini')); assert.match(await page.locator('#bassSoundList').textContent(), /Neden: Kararlı bas\./);
  assert.notEqual(await page.inputValue('#inGeminiKey'), gem);
  const prompts = await page.evaluate(() => window.__bassTest.prompts.map(({ system, user }) => ({ system, user })));
  assert.equal(prompts.length, 2); for (const p of prompts) assert.doesNotMatch(JSON.stringify(p), /PRIVATE_|rootMidi|rootCents|previewUrl|pitchConfidence/);
  for (const p of prompts) { const data = JSON.parse(p.user.split('\n')[1]); assert.deepEqual(Object.keys(data.summary).sort(), ['bpm', 'meter', 'keys', 'pack', 'sectionTypes', 'vocalEnergy'].sort()); if (data.candidates) for (const r of data.candidates.bass) assert.deepEqual(Object.keys(r).sort(), ['id', 'name', 'tags', 'duration'].sort()); }
  const aiCalls = await page.evaluate(() => window.__bassTest.prompts.length); await undo(); await undo(true); assert.deepEqual(await state(), ai); assert.equal(await page.evaluate(() => window.__bassTest.prompts.length), aiCalls);
  const pending = async () => { await configure('hold'); await page.click('#btnBassSoundSelect'); await page.waitForFunction(() => window.__bassTest.waiting); assert.match(await page.locator('#bassSoundStatus').textContent(), /indiriliyor.*ölçülüyor/); };
  const releaseAndCheck = async (expected) => { await page.evaluate(() => window.__bassTest.release()); await page.waitForTimeout(60); assert.deepEqual(await state(), expected); };
  await pending(); await open(fixture); await releaseAndCheck(fixture.realSounds);
  await pending(); await page.click('#btnNew'); await page.waitForFunction(() => /Yeni proje/.test(document.querySelector('#status').textContent)); await releaseAndCheck(fixture.realSounds);
  await open(fixture); await configure(); await page.click('#btnBassSoundSelect'); await done();
  await pending(); await undo(); await releaseAndCheck(fixture.realSounds);
  await configure(); await page.click('#btnBassSoundSelect'); await done();
  const version = await page.evaluate(() => { const A = window.__dawAPI; const r = A.C.saveVersion(A.S.proj, A.S.d, 'Bas test sürümü'); A.refresh(); return r.id; });
  await pending(); await page.click(`[data-version="${version}"] [data-version-act="switch"]`); await page.waitForFunction(() => /Bas test sürümü.*sürümüne geçildi/.test(document.querySelector('#status').textContent)); const versionState = await state(); await releaseAndCheck(versionState);
  const savedWait = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await savedWait).path()), json = JSON.parse(saved);
  assert.deepEqual(json.realSounds.bass, versionState.bass); assert.doesNotMatch(JSON.stringify(json.realSounds), /channels|decoded|sampleRate|mono|needsAnalysis/);
  await page.click('#btnNew'); await page.waitForFunction(() => /Yeni proje/.test(document.querySelector('#status').textContent));
  await page.evaluate(() => { window.__bassTest.searches = 0; window.__bassTest.prompts = []; }); await open(json); assert.deepEqual(await state(), versionState);
  assert.equal(await page.evaluate(() => window.__bassTest.searches), 0); assert.equal(await page.evaluate(() => window.__bassTest.prompts.length), 0);
  for (const button of ['btnExpChart', 'btnExpMidi', 'btnExpMix']) { const download = page.waitForEvent('download'); await page.click('#' + button); const bytes = readFileSync(await (await download).path()); for (const key of [fs, gem]) assert.ok(!bytes.includes(Buffer.from(key))); }
  const scan = await page.evaluate(() => JSON.stringify({ p: window.__dawAPI.S.proj, history: window.__dawAPI.hist(), dom: document.documentElement.outerHTML }));
  for (const key of [fs, gem]) { assert.ok(!scan.includes(key)); assert.ok(!saved.includes(Buffer.from(key))); assert.ok(!logs.join('\n').includes(key)); }
  console.log('bass-select-ui: buttons/progress, measured safe rows, atomic selection/reroll/clear, Gemini/privacy, failures, obsolete load/new/undo/version, save/open without search and sentinel scans passed');
} finally { await browser.close(); }

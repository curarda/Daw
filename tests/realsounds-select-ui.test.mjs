import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://**/*', (r) => /Tone\.js/.test(r.request().url()) ? r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }) : r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI?.soundSelection && /Hazır/.test(document.querySelector('#status').textContent));
  const show = () => page.locator('[data-key="s10"]').evaluate((e) => { e.open = true; });
  const state = () => page.evaluate(() => structuredClone(window.__dawAPI.S.proj.realSounds));
  const depth = () => page.evaluate(() => window.__dawAPI.hist().undo.length);
  await show(); await page.click('#btnSoundClear'); assert.equal(await page.locator('#btnSoundSelect').isDisabled(), true);
  assert.match(await page.locator('#soundSelectHint').textContent(), /Önce Freesound/);
  const sentinel = 'FS_FAKE_KEY_SENTINEL_1234';
  await page.fill('#inFreesoundKey', sentinel); await page.click('#btnSoundSave'); assert.equal(await page.locator('#btnSoundSelect').isEnabled(), true);
  const inject = (options = {}) => page.evaluate((options) => {
    const C = window.Core, control = window.__selectTest = { searches: 0, decodes: 0, waiting: false, release: null };
    const record = (id) => ({ id, name: '<img src=x onerror=alert(1)>\x00kick', author: '<b>tester</b>', url: `https://freesound.org/people/tester/sounds/${id}/`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, selector: 'fallback', why: '' });
    window.__dawAPI.soundSelection.inject({
      network: {
        async freesoundSearch(params) {
          const call = ++control.searches, spec = Object.values(C.LANE_SPECS).find((s) => s.query === params.query);
          if (options.hold && call === 1) { control.waiting = true; await new Promise((resolve) => { control.release = resolve; }); }
          if (options.fail || !['K', 'S', 'H', 'C'].includes(spec.kind)) return { candidates: [] };
          const id = (options.base || 0) + (options.hold && call > 1 ? 100 : 0) + C.DRUM_KINDS.indexOf(spec.kind) + 1;
          return { candidates: [{ record: record(id), duration: .5, tags: [] }] };
        },
        async freesoundPreview() { return new Uint8Array([1, 2, 3]); }
      },
      decode: async () => { control.decodes++; return { channels: [Float32Array.from({ length: 4000 }, (_, i) => .2 * Math.cos(i * .2))], sampleRate: 8000 }; },
      cache: C.createSoundCache({ indexedDB: null })
    });
  }, options);
  const done = () => page.waitForFunction(() => /Davul seti seçildi/.test(document.querySelector('#soundSelectStatus').textContent));
  const undo = async () => {
    await page.locator('#btnSave').focus(); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => /Geri alındı/.test(document.querySelector('#status').textContent));
  };
  await inject({ hold: true });
  const before = await state(), initialDepth = await depth();
  await page.click('#btnSoundSelect'); await page.waitForFunction(() => window.__selectTest.waiting);
  assert.match(await page.locator('#soundSelectStatus').textContent(), /K: CC0 ses aranıyor/);
  assert.deepEqual(await state(), before);
  await page.evaluate(() => window.__selectTest.release()); await done();
  const selected = await state(); assert.ok(selected.enabled); assert.deepEqual(Object.keys(selected.drums), ['K', 'S', 'H', 'C']);
  assert.equal(await depth(), initialDepth + 1);
  const row = page.locator('[data-sound-lane="K"]');
  assert.equal(await row.locator('img, b b').count(), 0); assert.match(await row.textContent(), /<img src=x onerror=alert\(1\)>kick/);
  assert.equal(await row.locator('a').getAttribute('target'), '_blank'); assert.equal(await row.locator('a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await row.locator('a').getAttribute('href'), selected.drums.K.url);
  assert.equal(await page.locator('#soundCredits img, #soundCredits b').count(), 0);
  assert.match(await page.locator('#soundCredits').textContent(), /CC0/);
  await page.evaluate(() => {
    window.__soundPreview = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__soundPreview.push({ length: this.buffer?.length, sampleRate: this.buffer?.sampleRate, first: this.buffer?.getChannelData(0)[0] }); return start.apply(this, args); };
  });
  await page.click('[data-sound-preview="K"]');
  await page.waitForFunction(() => window.__soundPreview.length > 0);
  const preview = await page.evaluate(() => window.__soundPreview.at(-1)); assert.equal(preview.length, 4000); assert.equal(preview.sampleRate, 8000); assert.ok(Math.abs(preview.first - .2) < 1e-6);
  await undo(); assert.deepEqual(await state(), before);
  const failureDepth = await depth(); await inject({ fail: true }); await page.click('#btnSoundSelect');
  await page.waitForFunction(() => /Uygun CC0/.test(document.querySelector('#soundSelectStatus').textContent));
  assert.deepEqual(await state(), before); assert.equal(await depth(), failureDepth);
  await inject({ hold: true }); await page.click('#btnSoundSelect'); await page.waitForFunction(() => window.__selectTest.waiting);
  await page.click('#btnSoundSelect'); await done(); const newer = await state(); assert.equal(newer.drums.K.id, 101);
  await page.evaluate(() => window.__selectTest.release());
  // Kuyruktaki eski işlemin sonucunu tüketmesi için tarayıcı görev kuyruğunu geçir.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.deepEqual(await state(), newer);
  const download = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await download).path());
  const project = JSON.parse(saved); assert.deepEqual(project.realSounds, newer);
  const rsJSON = JSON.stringify(project.realSounds); for (const word of ['channels', 'decoded', 'sampleRates', 'duration', 'tags', 'bytes']) assert.ok(!rsJSON.includes('"' + word + '"'));
  assert.ok(!saved.includes(Buffer.from(sentinel)));
  await inject({ hold: true, base: 1000 }); await page.click('#btnSoundSelect'); await page.waitForFunction(() => window.__selectTest.waiting);
  await page.setInputFiles('#fileProject', { name: 'kit.json', mimeType: 'application/json', buffer: saved });
  await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
  await page.evaluate(() => window.__selectTest.release()); await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.deepEqual(await state(), newer);
  await page.click('#btnNew'); await page.waitForFunction(() => /Yeni proje/.test(document.querySelector('#status').textContent));
  await inject(); assert.equal(await page.evaluate(() => window.__selectTest.searches), 0);
  await page.setInputFiles('#fileProject', { name: 'kit.json', mimeType: 'application/json', buffer: saved });
  await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
  await show(); assert.deepEqual(await state(), newer);
  assert.equal(await page.evaluate(() => window.__selectTest.searches), 0);
  assert.equal(await page.locator('[data-sound-preview="K"]').isDisabled(), true);
  assert.match(await page.locator('#soundCredits').textContent(), /CC0/);
  const snapshot = await page.evaluate(() => JSON.stringify({ project: window.__dawAPI.S.proj, history: window.__dawAPI.hist(), dom: document.documentElement.outerHTML }));
  assert.ok(!snapshot.includes(sentinel)); assert.ok(!logs.join('\n').includes(sentinel));
  await page.uncheck('#inRealSounds'); assert.equal((await state()).enabled, false);
  await page.click('#btnSoundReset'); assert.deepEqual(await state(), { enabled: false, drums: {}, bass: [] });
  console.log('realsounds-select-ui: key gate, progress, isolated undo, failure, stale runs, escaped credits, preview, save/load, no discovery and sentinel isolation passed');
} finally { await browser.close(); }

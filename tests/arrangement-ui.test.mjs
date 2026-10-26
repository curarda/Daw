import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }));
  await page.route(/\/salamander\//, (r) => r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI && /Hazır/.test(document.querySelector('#status').textContent));
  const result = await page.evaluate(async () => {
    const api = window.__dawAPI, { C, S } = api;
    const p = C.setMatrixEnabled(C.newProject(), true); p.guitar.instrument = 'both'; p.bass.enabled = true;
    p.drums.on = true; p.drums.loop = C.loopsFor('4/4')[0].id;
    p.piano.repeat = 'hold';
    p.sections = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, type: 'chorus', startBar: 1 + i * 4, endBar: 4 + i * 4, tonic: 9, mode: 'minor' }));
    p.matrix.rows.b = { piano: false, guitar: false, bass: false, drums: false };
    S.proj = p; S.d = C.derive(p, { duration: 24, rawNotes: [] });
    C.Bass.bassGenerateAll(p.bass, C.Bass.bassContext(S.d, p));
    const held = S.d.chords.filter((c) => c.section === 'a').at(-1);
    held.q1 = 20;
    p.bass.bars[3].notes = [{ midi: 45, startBeat: 3, durationBeats: 8, velocity: 90, role: 'root' }];
    const expected = C.arrangedEvents(S.d, p), scheduled = {};
    api.onScheduledEvents = (events) => Object.assign(scheduled, events);
    await api.player().play({ from: 0 }); api.stop(); delete api.onScheduledEvents;
    const sr = 22050, stems = await api.renderStems(sr, 25);
    const rms = (data, a, b) => {
      if (!data) return 0;
      let sum = 0; for (let i = a * sr; i < b * sr; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / ((b - a) * sr));
    };
    const levels = Object.fromEntries(['piano', 'guitar', 'bass', 'drums'].map((k) => [k, { on: rms(stems[k], 1, 3), off: rms(stems[k], 13, 15) }]));
    return { expected: JSON.parse(JSON.stringify(expected)), scheduled: JSON.parse(JSON.stringify(scheduled)), levels };
  });
  assert.deepEqual(result.scheduled, result.expected);
  for (const [layer, levels] of Object.entries(result.levels)) {
    assert.ok(levels.on > 1e-5, `${layer} audible: ${JSON.stringify(levels)}`);
    assert.ok(levels.off < 1e-4, `${layer} silent away from tails: ${JSON.stringify(levels)}`);
  }
  for (const matrix of [undefined, { enabled: false, rows: {} }, { enabled: true, rows: { _all: { piano: false } } }]) {
    const project = await page.evaluate(() => window.__dawAPI.C.newProject());
    assert.deepEqual(project.matrix, { enabled: false, rows: {} });
    if (matrix === undefined) delete project.matrix; else project.matrix = matrix;
    await page.setInputFiles('#fileProject', { name: 'matrix.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.matrix.enabled), matrix?.enabled === true);
    const download = page.waitForEvent('download');
    await page.evaluate(() => document.querySelector('#btnSave').click());
    const saved = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
    assert.deepEqual(saved.matrix, matrix || { enabled: false, rows: {} });
    await page.setInputFiles('#fileProject', { name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.matrix), saved.matrix);
  }
  console.log('Arrangement playback streams equal facade; all four mix stems audible/silent in enabled/disabled sections.');
} finally { await browser.close(); }

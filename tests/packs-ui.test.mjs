import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }));
  await page.route(/\/salamander\//, (r) => r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI && /Hazır/.test(document.querySelector('#status').textContent));
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Paket testi: proje yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'packs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await page.locator('details[data-key="s4a"]').evaluate((el) => { el.open = true; });
    await page.locator('details[data-key="s4b"]').evaluate((el) => { el.open = true; });
  };
  const state = () => page.evaluate(() => {
    const p = window.__dawAPI.S.proj;
    return JSON.parse(JSON.stringify(Object.fromEntries(['settings', 'drums', 'bass', 'piano', 'guitar', 'matrix', 'pack', 'sections'].map((k) => [k, p[k]]))));
  });
  const apply = async (id) => { await page.selectOption('#inPack', id); await page.click('#btnPackApply'); };
  const undo = async () => {
    await page.locator('#btnUndo').focus(); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => /Geri alındı/.test(document.querySelector('#status').textContent));
  };
  const p = await page.evaluate(() => {
    const p = window.__dawAPI.C.newProject(); p.settings.bpm = 120;
    p.sections = ['intro', 'verse', 'chorus', 'chorus'].map((type, i) => ({ id: `pack-${i}`, name: type, type, startBar: 1 + i * 2, endBar: 2 + i * 2, tonic: 9, mode: 'minor' }));
    return p;
  });
  await open(p);
  const suggestions = await page.evaluate(() => window.__dawAPI.C.topSuggestions(window.__dawAPI.S.proj).map((r) => r.id));
  assert.deepEqual(await page.locator('#packSuggestions [data-pack]').evaluateAll((els) => els.map((e) => e.dataset.pack)), suggestions);
  assert.equal(await page.locator('#inPack option').count(), 15);
  assert.deepEqual(await page.locator('#inPack option').evaluateAll((els) => els.map((e) => e.value)), await page.evaluate(() => window.__dawAPI.C.rankPacks(window.__dawAPI.S.proj).map((r) => r.id)));
  const initial = await state();
  await page.locator('#packSuggestions [data-pack]').first().click();
  assert.equal((await state()).pack.id, suggestions[0]); assert.equal(await page.evaluate(() => window.__dawAPI.player().playing), false);
  await undo(); assert.deepEqual(await state(), initial);
  await apply('dream-pop');
  const dream = await state();
  assert.equal(dream.pack.id, 'dream-pop'); assert.equal(dream.drums.on, true); assert.equal(dream.drums.loop, 'ht-flat');
  assert.equal(dream.matrix.enabled, true); assert.deepEqual(dream.settings, initial.settings);
  assert.equal(await page.locator('#chipPack').textContent(), 'Dream pop');
  for (const [id, layer, on] of [['pack-0', 'bass', false], ['pack-1', 'drums', false], ['pack-2', 'drums', true]]) {
    const cell = page.locator(`[data-section="${id}"][data-layer="${layer}"]`);
    assert.equal(await cell.getAttribute('aria-pressed'), String(on)); assert.match(await cell.getAttribute('aria-label'), /otomatik/);
  }
  // The verse has pack-specific dynamics; a cell click must invert those dynamics.
  await page.click('[data-section="pack-1"][data-layer="drums"]');
  assert.equal((await state()).matrix.rows['pack-1'].drums, true); await undo();
  assert.deepEqual(await state(), dream);
  const ranked = await page.evaluate(() => window.__dawAPI.C.rankPacks(window.__dawAPI.S.proj).map((r) => r.id));
  let current = 'dream-pop';
  for (let i = 0; i < ranked.length; i++) {
    const expected = ranked[(ranked.indexOf(current) + 1) % ranked.length];
    await page.click('#btnPackNext'); assert.equal((await state()).pack.id, expected); current = expected;
  }
  assert.equal(current, 'dream-pop');
  // Selection survives refresh, including a BPM/instrument change, while eligibility stays valid.
  await page.selectOption('#inPack', 'balad');
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.settings.bpm = 121; api.refresh(); });
  assert.equal(await page.inputValue('#inPack'), 'balad');
  assert.deepEqual(await page.locator('#packSuggestions [data-pack]').evaluateAll((els) => els.map((e) => e.dataset.pack)), await page.evaluate(() => window.__dawAPI.C.topSuggestions(window.__dawAPI.S.proj).map((r) => r.id)));
  // The toolbar genre picker next to Demo yap mirrors the 4a selection in both directions.
  assert.equal(await page.inputValue('#inPackToolbar'), 'balad');
  assert.deepEqual(await page.locator('#inPackToolbar option').evaluateAll((els) => els.map((e) => e.value)), await page.locator('#inPack option').evaluateAll((els) => els.map((e) => e.value)));
  await page.selectOption('#inPackToolbar', 'dream-pop');
  assert.equal(await page.inputValue('#inPack'), 'dream-pop'); assert.equal((await state()).pack.selectedId, 'dream-pop');
  await page.selectOption('#inPack', 'balad'); assert.equal(await page.inputValue('#inPackToolbar'), 'balad');
  await page.click('[data-pack-lock="drums"]');
  assert.equal((await state()).pack.locks.drums, true);
  await undo(); assert.equal((await state()).pack.locks.drums, false);
  await page.click('[data-pack-lock="drums"]');
  const locked = await state();
  const drumCells = await page.locator('.matrix-cell[data-layer="drums"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed')));
  const historyBefore = await page.evaluate(() => window.__dawAPI.hist().undo.length);
  await apply('electro-pop');
  assert.equal(await page.evaluate(() => window.__dawAPI.hist().undo.length), historyBefore + 1);
  assert.equal((await state()).drums.loop, locked.drums.loop);
  assert.deepEqual(await page.locator('.matrix-cell[data-layer="drums"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed'))), drumCells);
  assert.match(await page.locator('#packWarnings').textContent(), /Davul/); assert.match(await page.locator('#status').textContent(), /Davul/);
  await undo(); assert.deepEqual(await state(), locked, 'one undo restores all arrangement settings and bass bars');
  // Existing per-section parts produce an apply warning in both locations.
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.guitar.parts['pack-0'] = structuredClone(api.S.proj.guitar.parts._all); api.refresh(); });
  await apply('dream-pop');
  assert.match(await page.locator('#packWarnings').textContent(), /bölüm gitar partileri korundu/);
  assert.match(await page.locator('#status').textContent(), /bölüm gitar partileri korundu/);
  // Scheduled audio must obey the same disabled-matrix arrangement as a pack-less project.
  await page.uncheck('#inMatrixEnabled');
  const audible = await page.evaluate(async () => {
    const api = window.__dawAPI, { C, S } = api;
    for (const part of Object.values(S.proj.guitar.parts)) part.groove = false; // gitar groove pakete bağlıdır; bu adım matris geçidini sınar
    const plain = structuredClone(S.proj); plain.pack.id = null;
    const expected = C.arrangedEvents(S.d, plain), actual = C.arrangedEvents(S.d, S.proj), scheduled = {};
    api.onScheduledEvents = (ev) => Object.assign(scheduled, ev);
    await api.player().play({ from: 0 }); api.stop(); delete api.onScheduledEvents;
    return JSON.parse(JSON.stringify({ expected, actual, scheduled }));
  });
  assert.deepEqual(audible.actual, audible.expected); assert.deepEqual(audible.scheduled, audible.expected);
  await page.check('#inMatrixEnabled');
  // Applying while playing reschedules the new drum arrangement, without starting playback when stopped.
  const live = await page.evaluate(async () => {
    const api = window.__dawAPI, player = api.player(); await player.play({ from: 0 });
    const events = []; api.onScheduledEvents = (ev) => { if (ev.drums) events.push(ev.drums); };
    document.querySelector('#inPack').value = 'pop-rock'; document.querySelector('#btnPackApply').click();
    const deadline = performance.now() + 15000;
    while (!events.length && performance.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const expected = api.arrangement().drums, playing = player.playing;
    api.stop(); delete api.onScheduledEvents; return JSON.parse(JSON.stringify({ events, expected, playing }));
  });
  assert.ok(live.playing); assert.ok(live.events.length); assert.deepEqual(live.events.at(-1), live.expected);
  const savedState = await state(), download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('#btnSave').click());
  const saved = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  await page.evaluate(() => document.querySelector('#btnNew').click());
  assert.equal((await state()).pack.id, null);
  await open(saved);
  assert.deepEqual((await state()).pack, savedState.pack);
  assert.equal(await page.locator('[data-pack-lock="drums"]').getAttribute('aria-pressed'), 'true');
  for (const [meter, count] of [['3/4', 1], ['6/8', 1], ['2/4', 0]]) {
    const next = structuredClone(p); next.settings.meter = meter; await open(next);
    assert.equal(await page.locator('#inPack option').count(), count);
    if (meter === '3/4') { assert.equal(await page.inputValue('#inPack'), 'vals'); assert.match(await page.locator('#inPack').textContent(), /Vals/); }
    if (meter === '6/8') assert.equal(await page.inputValue('#inPack'), 'balad-68');
    if (!count) {
      assert.equal(await page.locator('#packUnavailable').isVisible(), true); assert.match(await page.locator('#packUnavailable').textContent(), /Bu ölçü için paket yok/);
      for (const sel of ['#inPack', '#btnPackApply', '#btnPackNext', ...['piano', 'guitar', 'bass', 'drums'].map((l) => `[data-pack-lock="${l}"]`)]) assert.equal(await page.locator(sel).isDisabled(), true);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Packs UI: ranked suggestions, apply/cycle/wrap, matrix, locks, one-step history, audio scheduling, meter eligibility and save/load passed.');
} finally { await browser.close(); }

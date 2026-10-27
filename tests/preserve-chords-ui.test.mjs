import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://**/*', (r) => /tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/.test(r.request().url())
    ? r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }) : r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI && /Hazır/.test(document.querySelector('#status').textContent));
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Koruma testi: yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'preserve.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await page.evaluate(() => document.querySelectorAll('details.step, #chartBox').forEach((el) => { el.open = true; }));
  };
  const state = () => page.evaluate(() => structuredClone(window.__dawAPI.S.proj));
  const chords = () => page.evaluate(() => window.__dawAPI.S.d.chords.map((c) => ({ bar: c.bar, half: c.half, q0: c.q0, q1: c.q1, chord: c.chord, locked: c.locked, pinned: c.pinned, lockSrc: c.lockSrc })));
  const depth = () => page.evaluate(() => window.__dawAPI.hist().undo.length);
  const sync = async (on) => {
    for (const id of ['inPreserveChords', 'inPreserveChordsToolbar']) assert.equal(await page.locator('#' + id).isChecked(), on);
    assert.equal((await state()).preserveChords, on);
  };
  const undo = async (redo = false) => {
    await page.locator('#btnUndo').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo);
  };
  const demo = async () => {
    await page.click('#btnDemo');
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 20000 });
    await page.evaluate(() => window.__dawAPI.stop());
  };
  const fixture = await page.evaluate(() => {
    const { C } = window.__dawAPI, p = C.newProject();
    p.piano.style = 'synth-arp'; p.mixer.touched = true; p.chordOpts.engine = 'greedy'; p.chordOpts.downbeatOnly = true;
    p.sections = ['verse', 'chorus'].map((type, i) => ({ id: 's' + i, name: type, type, startBar: i * 4 + 1, endBar: i * 4 + 4, tonic: 0, mode: 'major', link: null }));
    p.midiData = { name: 'preserve-melody', endQ: 32, notes: Array.from({ length: 8 }, (_, i) => ({ q0: i * 4, q1: i * 4 + 1, midi: [60, 64, 67, 65][i % 4], vel: 80 })) };
    return p;
  });
  await open(fixture);
  const initial = await chords(); assert.ok(initial.length);
  assert.equal((await state()).pack.selectedId, null, 'render does not persist the displayed default');
  await page.check('#inPreserveChordsToolbar'); await sync(true);
  assert.match(await page.locator('#status').textContent(), /\d+ akor donduruldu/);
  assert.equal(await depth(), 1); assert.deepEqual(await chords(), initial);
  await undo(); await sync(false); await undo(true); await sync(true);
  for (const id of ['btnApplySug', 'btnApplyAfter', 'btnUnlockAll', 'btnUnlockChords', 'btnChartRemove', 'btnReseed']) {
    assert.equal(await page.locator('#' + id).isDisabled(), true);
    assert.match(await page.locator('#' + id).getAttribute('title'), /önce korumayı kapat/);
  }
  assert.equal(await page.locator('#preserveChordsHint').isVisible(), true);
  const beforePack = await state();
  await page.selectOption('#inPack', 'electro-pop'); await page.click('#btnPackApply');
  assert.deepEqual(await chords(), initial);
  let p = await state(); assert.equal(p.pack.id, 'electro-pop'); assert.equal(p.drums.loop, 'clapsnare');
  assert.equal(p.bass.enabled, true); assert.equal(p.piano.style, 'synth-chord'); assert.equal(p.matrix.enabled, true);
  assert.notDeepEqual(p.drums, beforePack.drums); assert.notDeepEqual(p.bass, beforePack.bass); assert.notDeepEqual(p.guitar, beforePack.guitar);
  await page.click('#btnPackNext'); assert.notEqual((await state()).pack.id, 'electro-pop'); assert.deepEqual(await chords(), initial);
  await page.selectOption('#inPack', 'balad'); await demo();
  p = await state(); assert.equal(p.pack.id, 'balad'); assert.equal(p.pack.selectedId, 'balad'); assert.equal(p.drums.loop, 'ballad16');
  assert.match(await page.locator('#status').textContent(), /Demo hazır: Balad.*akorlar korundu/); assert.deepEqual(await chords(), initial);
  // OFF removes the freeze and permits a changed engine input to take effect.
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.sections.forEach((s) => { s.tonic = 9; s.mode = 'minor'; }); api.refresh(); });
  assert.deepEqual(await chords(), initial);
  await page.uncheck('#inPreserveChords'); await sync(false);
  assert.match(await page.locator('#status').textContent(), /Akorlar serbest/);
  assert.notDeepEqual(await chords(), initial); assert.ok((await state()).chordChoices.every((c) => c.source !== 'freeze'));
  // With preservation OFF, pack apply/cycle still do not change chord inputs.
  const free = await chords(); await page.selectOption('#inPack', 'dream-pop'); await page.click('#btnPackApply');
  assert.deepEqual(await chords(), free); await page.click('#btnPackNext'); assert.deepEqual(await chords(), free);
  // A single deliberate edit remains after OFF; untouched freeze records retain their provenance.
  await open(fixture); await page.check('#inPreserveChords'); const frozen = await chords();
  const frozenRecords = (await state()).chordChoices;
  await page.evaluate(() => { const api = window.__dawAPI, c = api.S.d.chords[0]; api.S.sel = { type: 'chord', q: (c.q0 + c.q1) / 2 }; api.refresh(); });
  await page.fill('#chInput', 'F#m'); await page.click('[data-act="manualChord"]');
  const edited = await chords(); assert.equal(edited[0].chord.root, 6); assert.equal(edited[0].locked, true);
  assert.deepEqual(edited.slice(1), frozen.slice(1));
  const byPosition = (a, b) => a.sectionId.localeCompare(b.sectionId) || a.relBar - b.relBar || a.half - b.half;
  assert.deepEqual((await state()).chordChoices.filter((c) => c.source === 'freeze').sort(byPosition), frozenRecords.slice(1).sort(byPosition));
  await page.evaluate(() => { const api = window.__dawAPI; api.S.sel = { type: 'section', id: 's0' }; api.refresh(); });
  assert.equal(await page.locator('[data-act="secUnlockAll"]').isDisabled(), true);
  assert.match(await page.locator('[data-act="secUnlockAll"]').getAttribute('title'), /önce korumayı kapat/);
  await page.uncheck('#inPreserveChords');
  p = await state(); assert.equal(p.chordLocks.length, 1); assert.equal(p.chordPins.length, 0);
  assert.equal((await chords())[0].chord.root, 6); assert.ok(p.chordChoices.every((c) => c.source !== 'freeze'));
  // Chart import and progression placement also leave unrelated frozen choices intact.
  await open(fixture); await page.check('#inPreserveChords'); const chartBefore = await chords();
  await page.fill('#chartText', 'Dm'); await page.click('#btnChartApply');
  assert.equal((await chords())[0].chord.root, 2); assert.deepEqual((await chords()).slice(1), chartBefore.slice(1));
  await page.evaluate(() => window.__dawAPI.placeChords([{ root: 7, q: '7' }], 2, { tonic: 0, mode: 'major' }));
  assert.equal((await chords()).find((c) => c.bar === 2).chord.root, 7);
  await page.uncheck('#inPreserveChords'); assert.equal((await state()).chordLocks.length, 2);
  // No section: Demo re-keys the implicit freeze before creating and confirming “Şarkı”.
  const implicit = structuredClone(fixture); implicit.sections = [];
  await open(implicit); await page.check('#inPreserveChordsToolbar'); const all = await chords();
  assert.ok((await state()).chordChoices.every((c) => c.sectionId === '_all'));
  await demo(); p = await state(); assert.equal(p.sections[0].name, 'Şarkı'); assert.equal(p.sections.length, 1);
  assert.ok(p.chordChoices.every((c) => c.sectionId === p.sections[0].id)); assert.deepEqual(await chords(), all);
  await undo(); p = await state(); assert.deepEqual(p.sections, []); assert.equal(p.pack.id, null); await sync(true);
  assert.ok(p.chordChoices.every((c) => c.sectionId === '_all')); assert.deepEqual(await chords(), all);
  // Both history edges: all three synchronous edits are inside the coalescing window.
  await open(fixture);
  const edges = await page.evaluate(() => {
    const api = window.__dawAPI, hist = api.hist(), set = (id, value) => { const el = document.querySelector(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#inMaxBars', api.S.proj.chordOpts.maxBars + 1); const before = api.S.proj.chordOpts.maxBars;
    document.querySelector('#btnDemo').click();
    set('#inHomeEvery', api.S.proj.chordOpts.homeEvery + 1);
    const result = { depth: hist.undo.length, before, after: api.S.proj.chordOpts.homeEvery };
    api.stop(); return result;
  });
  assert.equal(edges.depth, 3, 'before / Demo / after each has its own undo step');
  await undo(); p = await state(); assert.equal(p.pack.id, 'indie-pop'); assert.equal(p.chordOpts.homeEvery, fixture.chordOpts.homeEvery);
  await undo(); p = await state(); assert.equal(p.pack.id, null); assert.equal(p.chordOpts.maxBars, edges.before);
  await undo(); assert.equal((await state()).chordOpts.maxBars, fixture.chordOpts.maxBars);
  // Versions restore preservation; dropdown-only edits do not dirty snapshots or add history.
  await open(fixture); await page.click('#btnVersionSave'); const a = (await state()).versions.activeId;
  await page.check('#inPreserveChords'); await page.click('#btnVersionSave'); const b = (await state()).versions.activeId;
  const savedDepth = await depth(); await page.selectOption('#inPack', 'balad');
  await page.evaluate(() => window.__dawAPI.refresh());
  assert.equal(await depth(), savedDepth); assert.equal(await page.locator('.version-dirty').count(), 0);
  assert.equal(await page.evaluate(() => { const { C, S } = window.__dawAPI; return C.captureVersionState(S.proj, S.d).pack.selectedId; }), 'balad');
  for (const [id, on] of [[a, false], [b, true]]) {
    await page.click(`[data-version="${id}"] [data-version-act="switch"]`);
    await page.waitForFunction((id) => window.__dawAPI.S.proj.versions.activeId === id, id); await sync(on);
  }
  // Project round trip, fresh project and legacy defaults.
  const savedChords = await chords(), dl = page.waitForEvent('download'); await page.click('#btnSave');
  const saved = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
  await page.click('#btnNew'); await sync(false); await open(saved); await sync(true); assert.deepEqual(await chords(), savedChords);
  const legacy = structuredClone(fixture); delete legacy.preserveChords; delete legacy.pack.selectedId;
  await open(legacy); await sync(false);
  // 2/4 retains the old Demo path, with manual loop and bass availability intact.
  const two = structuredClone(fixture); two.settings.meter = '2/4'; two.drums.loop = 'pop24';
  await open(two); await page.check('#inPreserveChords'); const twoChords = await chords();
  await demo(); p = await state(); assert.deepEqual(await chords(), twoChords);
  assert.equal(p.pack.id, null); assert.equal(p.pack.selectedId, null); assert.equal(p.matrix.enabled, false);
  assert.equal(p.drums.on, true); assert.equal(p.drums.loop, 'pop24'); assert.equal(p.bass.enabled, true); assert.equal(p.bass.generated, true);
  assert.match(await page.locator('#status').textContent(), /Bu ölçü için paket yok; eski Demo/);
  // Demo keeps manual drum settings and section/chord-sound overrides without persisting locks.
  const manual = structuredClone(fixture); manual.settings.meter = '3/4'; manual.settings.bpm = 100;
  manual.drums = { on: true, loop: 'waltz', startBar: 2, fills: false };
  manual.sections[0].arr = { drums: 'off', piano: 'synth-chord' };
  await open(manual); await page.check('#inPreserveChords'); const manualChords = await chords();
  const manualBefore = await state(); await demo(); p = await state();
  assert.equal(p.pack.id, 'vals'); assert.equal(p.pack.selectedId, 'vals');
  assert.deepEqual(p.drums, manualBefore.drums); assert.deepEqual(p.sections[0].arr, manualBefore.sections[0].arr);
  assert.equal(p.piano.style, manualBefore.piano.style); assert.deepEqual(p.pack.locks, manualBefore.pack.locks);
  assert.deepEqual(await chords(), manualChords);
  assert.match(await page.locator('#status').textContent(), /Demo hazır: Vals/);
  assert.match(await page.locator('#status').textContent(), /elle seçtiklerin korundu: davul loop'u, akor sesi/);
  assert.match(await page.locator('#status').textContent(), /"verse" bölüm düzenlemesi/);
  for (const s of p.sections) { assert.equal(p.matrix.rows[s.id].drums, true); assert.equal(p.matrix.rows[s.id].piano, true); assert.equal(p.matrix.rows[s.id].bass, null); }
  // A previous Demo's own choices are automatic: another selected pack replaces them.
  const automatic = structuredClone(fixture); automatic.piano.style = 'piano-chord';
  await open(automatic); await page.selectOption('#inPack', 'dream-pop'); await demo();
  p = await state(); assert.equal(p.drums.loop, 'ht-flat'); assert.equal(p.piano.style, 'synth-chord');
  assert.equal(p.sections[0].arr.auto, true);
  await page.selectOption('#inPack', 'indie-pop'); await demo(); p = await state();
  assert.equal(p.pack.id, 'indie-pop'); assert.equal(p.pack.selectedId, 'indie-pop');
  assert.equal(p.drums.loop, 'backbeat'); assert.equal(p.piano.style, 'piano-arp');
  assert.equal(p.matrix.rows.s0.drums, null); assert.equal(p.matrix.rows.s0.piano, null);
  assert.deepEqual(p.pack.locks, automatic.pack.locks);
  assert.doesNotMatch(await page.locator('#status').textContent(), /elle seçtiklerin korundu:.*davul loop'u/);
  // A failed old Demo mix cannot overwrite the status or mixer of a newly opened project.
  const mixing = structuredClone(fixture); mixing.mixer.touched = false; await open(mixing);
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () {
      OfflineAudioContext.prototype.startRendering = original;
      return new Promise((resolve, reject) => { window.rejectOldDemoMix = () => reject(new Error('Eski demo ölçümü')); });
    };
    document.querySelector('#btnDemo').click();
  });
  await page.waitForFunction(() => window.rejectOldDemoMix, null, { timeout: 20000 });
  await open(fixture); const newMixer = (await state()).mixer;
  await page.evaluate(async () => { window.rejectOldDemoMix(); delete window.rejectOldDemoMix; await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual((await state()).mixer, newMixer); assert.equal((await state()).pack.id, null);
  assert.equal(await page.evaluate(() => window.__dawAPI.player().playing), false);
  assert.match(await page.locator('#status').textContent(), /Proje açıldı/);
  assert.deepEqual(errors, []);
  console.log('preserve UI: synchronized toggle/history, frozen apply/cycle/Demo, edits/OFF, chart/progression, implicit re-key/undo, adjacent history, versions/selection, persistence and 2/4 legacy passed');
} finally { await browser.close(); }

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }));
  await page.route(/\/salamander\//, (r) => r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI && /Hazır/.test(document.querySelector('#status').textContent));
  const panel = page.locator('details[data-key="s4c"]');
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Sürüm testi: yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'versions.json', mimeType: 'application/json', buffer: Buffer.isBuffer(p) ? p : Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await panel.evaluate((el) => { el.open = true; });
  };
  const row = (id) => page.locator(`[data-version="${id}"]`);
  const action = (id, act) => row(id).locator(`[data-version-act="${act}"]`).click();
  const library = () => page.evaluate(() => structuredClone(window.__dawAPI.S.proj.versions));
  const fader = async (value) => {
    await page.locator('details[data-key="s8e"]').evaluate((el) => { el.open = true; });
    await page.locator('.strip[data-track="piano"] .vol').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  };
  const save = async (name = '') => {
    await page.fill('#inVersionName', name); await page.click('#btnVersionSave');
    assert.match(await page.locator('#status').textContent(), /Sürüm kaydedildi/);
    return (await library()).activeId;
  };
  const sound = () => page.evaluate(() => {
    const { C, S } = window.__dawAPI;
    return { events: JSON.parse(JSON.stringify(C.arrangedEvents(S.d, S.proj))), midi: Array.from(C.exportMidi(S.proj, S.d)), mixer: Object.fromEntries(['vocal', 'piano', 'guitar', 'bass', 'drums'].map((k) => [k, structuredClone(S.proj.mixer[k])])) };
  });
  const switchTo = async (id) => {
    await action(id, 'switch');
    await page.waitForFunction((id) => window.__dawAPI.S.proj.versions.activeId === id && /sürümüne geçildi/.test(document.querySelector('#status').textContent), id);
  };
  const undo = async (redo = false) => {
    await page.locator('#btnUndo').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo);
  };
  const fixture = await page.evaluate(() => {
    const { C } = window.__dawAPI, p = C.newProject();
    p.settings.bpm = 120; p.piano.style = 'synth-chord'; p.guitar.instrument = 'both';
    p.drums = { ...p.drums, on: true, loop: 'backbeat', startBar: 1, fills: false };
    p.sections = ['verse', 'chorus'].map((type, i) => ({ id: 's' + i, name: i ? 'Nakarat' : 'Kıta', type, startBar: 1 + i * 2, endBar: 2 + i * 2, tonic: 0, mode: 'major', arr: {}, link: null }));
    p.matrix = { enabled: true, rows: { s0: { piano: true, guitar: true, bass: true, drums: true }, s1: { piano: true, guitar: true, bass: true, drums: true } } };
    p.midiData = { name: 'versions-melody', endQ: 16, notes: Array.from({ length: 4 }, (_, i) => ({ q0: i * 4, q1: i * 4 + 1, midi: 60 + i, vel: 80 })) };
    p.bass.enabled = true; p.bass.generated = true;
    const d = C.derive(p, { duration: 8, rawNotes: [] }); C.Bass.ensureBars(p.bass, C.Bass.bassContext(d, p));
    for (const b of p.bass.bars) { b.locked = true; b.source = 'manual'; b.notes = [{ midi: 36, startBeat: 0, durationBeats: 1, velocity: 85, role: 'root', gate: .7 }]; }
    return p;
  });
  await open(fixture);
  assert.equal(await page.locator('#chipVersions').textContent(), 'yok');
  const a = await save(); assert.equal((await library()).items[0].name, 'A');
  assert.equal(await row(a).locator('.version-dirty').count(), 0);
  const original = await sound();
  await page.locator('details[data-key="s8b"]').evaluate((el) => { el.open = true; });
  await page.selectOption('#inDrumLoop', 'four');
  await page.waitForFunction(() => document.querySelector('.version-dirty'));
  await page.locator('details[data-key="s4b"]').evaluate((el) => { el.open = true; });
  await page.locator('[data-section="s0"][data-layer="guitar"]').click();
  await page.evaluate(() => { const api = window.__dawAPI, sl = api.S.d.chords[0]; api.S.sel = { type: 'chord', q: (sl.q0 + sl.q1) / 2 }; api.refresh(); });
  await page.fill('#chInput', 'G'); await page.click('#inspector [data-act="manualChord"]');
  assert.ok(await page.evaluate(() => window.__dawAPI.S.proj.chordPins.length > 0), 'manual lock pins the other chords');
  await fader(-19);
  const b = await save(); assert.equal((await library()).items[1].name, 'B');
  const changed = await sound(); assert.notDeepEqual(changed.events, original.events);
  assert.equal(await row(b).locator('.version-dirty').count(), 0);
  const depth = await page.evaluate(() => window.__dawAPI.hist().undo.length);
  await switchTo(a); assert.deepEqual(await sound(), original, 'switch restores facade events, MIDI bytes and all mixer strips');
  assert.equal(await row(a).locator('.version-dirty').count(), 0);
  assert.equal(await page.evaluate(() => window.__dawAPI.hist().undo.length), depth + 1);
  assert.match(await page.locator('#status').textContent(), /Ctrl\+Z/);
  await undo(); assert.deepEqual(await sound(), changed, 'one undo restores pre-switch mixer and music');
  assert.equal((await library()).activeId, b);
  await undo(true); assert.deepEqual(await sound(), original); assert.equal((await library()).activeId, a);
  // Ordinary history still keeps the current mixer levels.
  await page.locator('[data-section="s0"][data-layer="piano"]').click();
  await fader(-23);
  await page.waitForFunction(() => document.querySelector('.version-dirty'));
  await undo();
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.mixer.piano.vol), -23);
  assert.deepEqual((await sound()).events, original.events);
  // The update needs a second click and never opens a modal dialog.
  await page.selectOption('#inDrumLoop', 'four');
  const savedA = (await library()).items.find((v) => v.id === a).state;
  await action(a, 'update'); assert.deepEqual((await library()).items.find((v) => v.id === a).state, savedA);
  assert.match(await row(a).textContent(), /onayla/);
  await action(a, 'update'); assert.equal(await row(a).locator('.version-dirty').count(), 0);
  const updated = await sound(); await switchTo(b); await switchTo(a); assert.deepEqual(await sound(), updated);
  await action(a, 'rename'); await row(a).locator('[data-version-name]').fill(' B '); await action(a, 'renameSave');
  assert.match(await page.locator('#status').textContent(), /kullanılıyor|aynı|başka/i);
  assert.equal((await library()).items.find((v) => v.id === a).name, 'A');
  await action(a, 'rename'); await row(a).locator('[data-version-name]').fill('  Deneme  '); await action(a, 'renameSave');
  assert.equal((await library()).items.find((v) => v.id === a).name, 'Deneme');
  assert.equal(await page.locator('#chipVersions').textContent(), 'Deneme');
  const kept = await sound(); await action(a, 'delete'); assert.deepEqual(await sound(), kept);
  assert.equal((await library()).activeId, null); assert.equal(await page.locator('#chipVersions').textContent(), 'yok');
  // Fresh library: automatic names, including deterministic reuse after deletion.
  await open(fixture); const na = await save(), nb = await save(), nc = await save();
  assert.deepEqual((await library()).items.map((v) => v.name), ['A', 'B', 'C']);
  await action(nb, 'delete'); const reused = await save();
  assert.equal((await library()).items.find((v) => v.id === reused).name, 'B');
  assert.ok(na && nc);
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.settings.meter = '3/4'; api.refresh(); });
  assert.equal(await page.locator('#versionList [data-version-act="switch"]:enabled').count(), 0);
  assert.match(await page.locator('#versionList').textContent(), /ölçü|bölüm|yapı/i);
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.settings.meter = '4/4'; api.refresh(); });
  await page.evaluate(() => { const api = window.__dawAPI; api.S.proj.sections[0].endBar = 1; api.refresh(); });
  assert.equal(await page.locator('#versionList [data-version-act="switch"]:enabled').count(), 0);
  // Playback scheduling uses a token across asynchronous preparation. The last click wins.
  await open(fixture); const pa = await save();
  await page.locator('details[data-key="s8b"]').evaluate((el) => { el.open = true; });
  await page.selectOption('#inDrumLoop', 'four'); const pb = await save();
  const sounds = { [pa]: await (async () => { await switchTo(pa); return sound(); })(), [pb]: await (async () => { await switchTo(pb); return sound(); })() };
  await page.evaluate(async () => {
    const api = window.__dawAPI; api.S.loop = { on: true, from: 0, to: 8 }; api.S.pos = 2;
    window.versionSchedules = [];
    api.onScheduledEvents = (events) => window.versionSchedules.push({ id: api.S.proj.versions.activeId, events: JSON.parse(JSON.stringify(events)) });
    await api.player().play();
  });
  const schedules = () => page.evaluate(() => window.versionSchedules);
  assert.equal((await schedules()).length, 2, 'one piano/drum/guitar callback and one bass callback');
  for (const id of [pa, pb]) {
    const count = (await schedules()).length;
    await page.evaluate((id) => {
      window.versionSwitchPosition = window.__dawAPI.S.pos;
      document.querySelector(`[data-version="${id}"] [data-version-act="switch"]`).click();
    }, id);
    await page.waitForFunction((id) => window.__dawAPI.S.proj.versions.activeId === id && /sürümüne geçildi/.test(document.querySelector('#status').textContent), id);
    const before = await page.evaluate(() => window.versionSwitchPosition);
    const player = await page.evaluate(() => { const api = window.__dawAPI, p = api.player(); return { playing: p.playing, from: p.from, region: p.region, loop: api.S.loop }; });
    assert.equal(player.playing, true); assert.ok(Math.abs(player.from - before) < 1e-6, 'same musical position');
    assert.deepEqual(player.region, player.loop); assert.deepEqual(player.loop, { on: true, from: 0, to: 8 });
    const scheduled = await schedules(); assert.equal(scheduled.length, count + 2, 'one new schedule per switch');
    const streams = Object.assign({}, ...scheduled.slice(-2).map((s) => s.events));
    assert.deepEqual(streams, sounds[id].events, 'actual scheduled streams match saved facade streams');
  }
  const count = (await schedules()).length;
  await page.evaluate(([a, b]) => {
    for (const id of [a, b, a, b]) document.querySelector(`[data-version="${id}"] [data-version-act="switch"]`).click();
  }, [pa, pb]);
  await page.waitForFunction((id) => window.__dawAPI.S.proj.versions.activeId === id && window.__dawAPI.player().playing && /sürümüne geçildi/.test(document.querySelector('#status').textContent), pb);
  assert.equal((await schedules()).length, count + 2, 'obsolete async renders never schedule');
  assert.ok((await schedules()).slice(count).every((s) => s.id === pb));
  assert.deepEqual(await sound(), sounds[pb]);
  await page.evaluate(() => { window.__dawAPI.stop(); delete window.__dawAPI.onScheduledEvents; });
  // Pins and versions survive switch, JSON save/open, and a fresh project; MIDI resets the library.
  await page.evaluate(() => { const api = window.__dawAPI, sl = api.S.d.chords[0]; api.S.sel = { type: 'chord', q: (sl.q0 + sl.q1) / 2 }; api.refresh(); });
  await page.fill('#chInput', 'F'); await page.click('#inspector [data-act="manualChord"]');
  const pinned = await save('Sabitli');
  const pins = await page.evaluate(() => structuredClone(window.__dawAPI.S.proj.chordPins)); assert.ok(pins.length);
  const pinnedSound = await sound(); await switchTo(pa); await switchTo(pinned);
  assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.chordPins), pins); assert.deepEqual(await sound(), pinnedSound);
  const dl = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await dl).path());
  const savedLibrary = await library();
  await page.click('#btnNew'); assert.equal((await library()).items.length, 0); assert.equal(await page.locator('#chipVersions').textContent(), 'yok');
  await open(saved); assert.deepEqual(await library(), savedLibrary);
  assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.chordPins), pins); assert.deepEqual(await sound(), pinnedSound);
  assert.equal(await row(pinned).locator('.version-dirty').count(), 0);
  const midi = pinnedSound.midi;
  await page.setInputFiles('#fileMidi', { name: 'versions.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi) });
  await page.waitForFunction(() => window.__dawAPI.S.midi?.name === 'versions.mid');
  assert.deepEqual(await library(), { activeId: null, items: [] });
  const legacy = structuredClone(fixture); delete legacy.versions; delete legacy.chordChoices;
  await open(legacy); assert.deepEqual(await library(), { activeId: null, items: [] });
  assert.equal(await page.locator('#versionList [data-version]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('versions UI: save/dirty, exact events/MIDI, mixer-aware and ordinary undo, update/rename/delete, compatibility, playback/loop/rapid switches, pins, persistence, MIDI and legacy passed');
} finally { await browser.close(); }

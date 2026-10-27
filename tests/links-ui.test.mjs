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
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Bağ testi: proje yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'links.json', mimeType: 'application/json', buffer: Buffer.isBuffer(p) ? p : Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await page.locator('details[data-key="s4"]').evaluate((el) => { el.open = true; });
  };
  const card = (id) => page.locator(`#sectionList [data-sec="${id}"]`);
  const link = (target, source) => card(target).locator('[data-act="secLink"]').selectOption(source);
  const section = (id) => page.evaluate((id) => structuredClone(window.__dawAPI.S.proj.sections.find((s) => s.id === id)), id);
  const undo = async (redo = false) => {
    await page.locator('#btnUndo').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo);
  };
  const chords = (id) => page.evaluate((id) => {
    const { S, C } = window.__dawAPI, sec = S.d.sections.find((s) => s.id === id), q = (sec.startBar - 1) * S.d.g.barQ;
    return S.d.chords.filter((s) => s.section === id).map((s) => ({ q0: s.q0 - q, q1: s.q1 - q, chord: s.chord, name: C.chordName(s.chord, s.flats), locked: s.locked, pinned: s.pinned }));
  }, id);
  const chooseChord = async (id) => {
    await page.evaluate((id) => {
      const { S } = window.__dawAPI, slot = S.d.chords.find((s) => s.section === id);
      S.sel = { type: 'chord', q: (slot.q0 + slot.q1) / 2 }; window.__dawAPI.refresh();
    }, id);
  };
  const events = () => page.evaluate(() => {
    const { C, S } = window.__dawAPI; return JSON.parse(JSON.stringify(C.arrangedEvents(S.d, S.proj)));
  });
  const targetSound = () => page.evaluate(() => {
    const { C, S } = window.__dawAPI, s = S.d.sections.find((s) => s.id === 's3'), a = (s.startBar - 1) * S.d.g.barSec, z = s.endBar * S.d.g.barSec;
    return Object.fromEntries(Object.entries(C.arrangedEvents(S.d, S.proj)).map(([layer, ev]) => [layer, ev.filter((e) => e.t >= a - 1e-8 && e.t < z - 1e-8).map((e) => {
      const n = { ...e }; delete n.slot; return n;
    })]));
  });
  const fixture = await page.evaluate(() => {
    const { C } = window.__dawAPI, p = C.newProject();
    p.settings.bpm = 120; p.piano = { ...p.piano, style: 'synth-chord', repeat: 'off' };
    p.guitar.instrument = 'both'; Object.assign(p.guitar.parts._all, { articulation: 'staccato', humanize: { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 } }); p.guitar.parts._all.fx.reverb = 0;
    p.drums = { ...p.drums, on: true, loop: 'backbeat', startBar: 1, fills: false };
    p.sections = ['verse', 'chorus', 'verse', 'chorus'].map((type, i) => ({ id: 's' + i, name: ['Kıta 1', 'Nakarat 1', 'Kıta 2', 'Nakarat 2'][i], type, startBar: 1 + i * 2, endBar: 2 + i * 2, tonic: 0, mode: 'major', link: null }));
    p.sections[3].arr = { piano: 'piano-arp', drums: 'off' };
    p.guitar.parts.s3 = structuredClone(p.guitar.parts._all); p.guitar.parts.s3.tone = 'drive'; p.guitar.parts.s3.articulation = 'letRing';
    p.matrix = { enabled: true, rows: Object.fromEntries(p.sections.map((s) => [s.id, Object.fromEntries(['piano', 'guitar', 'bass', 'drums'].map((l) => [l, s.type === 'chorus']))])) };
    p.matrix.rows.s3.piano = false; p.matrix.rows.s3.drums = false;
    p.chordLocks = Array.from({ length: 8 }, (_, i) => ({ bar: i + 1, half: null, chord: { root: i >= 6 ? 2 : 0, q: i >= 6 ? 'm' : '' } }));
    p.bass.enabled = true; p.bass.instrumentType = 'synth'; p.bass.instrumentPreset = 'Warm sub'; p.bass.styleProfileId = null;
    const d = C.derive(p, { duration: 0, rawNotes: [] }); C.Bass.ensureBars(p.bass, C.Bass.bassContext(d, p)); p.bass.generated = true;
    for (const b of p.bass.bars) { b.locked = true; b.source = 'manual'; b.notes = [{ midi: b.index >= 6 ? 38 : 36, startBeat: 0, durationBeats: 1, velocity: 90, role: 'root', gate: .6 }]; }
    p.midiData = { name: 'links-melody', endQ: 32, notes: Array.from({ length: 8 }, (_, i) => ({ q0: i * 4, q1: i * 4 + 1, midi: 60, vel: 80 })) };
    return p;
  });
  await open(fixture);
  for (const id of ['s0', 's1', 's2', 's3']) {
    assert.deepEqual(await card(id).locator('[data-act="secLink"] option').evaluateAll((els) => els.map((e) => e.value)), ['', ...['s0', 's1', 's2', 's3'].filter((v) => v !== id)]);
  }
  const beforeLink = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dawAPI.S.proj)));
  const depth = await page.evaluate(() => window.__dawAPI.hist().undo.length);
  await link('s3', 's1');
  assert.equal(await page.evaluate(() => window.__dawAPI.hist().undo.length), depth + 1);
  assert.match(await card('s3').textContent(), /↻ Nakarat 1'na bağlı/);
  const stripLabels = await page.evaluate(() => {
    const ctx = document.querySelector('#tl').getContext('2d'), original = ctx.fillText, labels = [];
    ctx.fillText = function (text, ...args) { if (String(text).startsWith('↻')) labels.push(text); return original.call(this, text, ...args); };
    const scroll = document.querySelector('#tlScroll'), oldScroll = scroll.scrollLeft;
    scroll.scrollLeft = 24 * window.__dawAPI.S.view.pxPerQ;
    try { window.__dawAPI.refresh(); } finally { ctx.fillText = original; scroll.scrollLeft = oldScroll; }
    return labels;
  });
  assert.ok(stripLabels.some((s) => s.includes('Nakarat 2')), 'timeline shows the link');
  assert.deepEqual(await chords('s3'), await chords('s1'));
  await undo(); assert.equal((await section('s3')).link, null);
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.__dawAPI.S.proj))), beforeLink, 'undo restores the whole project, including chords, arrangement, matrix and bass');
  await undo(true); assert.deepEqual((await section('s3')).link, { sourceId: 's1' });
  assert.match(await card('s3').textContent(), /bağlı/);
  await chooseChord('s1'); await page.fill('#chInput', 'G'); await page.click('#inspector [data-act="manualChord"]');
  assert.equal((await chords('s3'))[0].chord.root, 7); assert.deepEqual(await chords('s3'), await chords('s1'));
  await chooseChord('s3');
  for (const sel of ['#chInput', '#chScope', '#inspector [data-act="manualChord"]', '#inspector [data-act="unlockChord"]']) assert.equal(await page.locator(sel).isDisabled(), true, sel);
  assert.equal(await page.locator('#inspector [data-act="markSet"]:enabled').count(), 0);
  assert.equal(await page.locator('#inspector [data-act="pickChord"]:enabled').count(), 0);
  assert.equal(await page.locator('#inspector [data-link-source="s3"]').count(), 1);
  await page.click('#inspector [data-link-source="s3"]');
  assert.equal(await page.evaluate(() => window.__dawAPI.S.sel.id), 's1');
  await card('s3').dispatchEvent('click');
  assert.equal(await page.locator('#inspector [data-act="arr"]:enabled').count(), 0);
  await page.locator('details[data-key="s4b"]').evaluate((el) => { el.open = true; });
  assert.match(await page.locator('#matrixTable').textContent(), /↻ kaynaktan/);
  assert.equal(await page.locator('[data-section="s3"][data-layer="piano"]').isDisabled(), true);
  await page.locator('#guitarStep').evaluate((el) => { el.open = true; }); await page.selectOption('#gTarget', 's3');
  assert.equal(await page.locator('#guitarPanel button:enabled').count(), 0); assert.equal(await page.locator('#gSecInfo [data-link-source]').count(), 1);
  await page.locator('#bassStep').evaluate((el) => { el.open = true; }); await page.selectOption('#bassPanel [data-bs="sec"]', 's3');
  assert.equal(await page.locator('#bassPanel [data-bs="den"]').isDisabled(), true);
  await page.evaluate(() => { const api = window.__dawAPI; api.bass.BS.sel = [6, 7]; api.refresh(); });
  assert.equal(await page.locator('#bsBarMenu button[data-bk]:enabled').count(), 0);
  assert.equal(await page.locator('#bsBarMenu [data-link-unlink="s3"]').count(), 1);
  // Bulk operations keep the target's stored material, while source edits remain live.
  const ownLocks = await page.evaluate(() => window.__dawAPI.S.proj.chordLocks.filter((l) => l.bar >= 7));
  const placed = await page.evaluate(() => window.__dawAPI.placeChords([{ root: 5, q: '' }], 7, { tonic: 0, mode: 'major' }, [2]));
  assert.equal(placed, false); assert.match(await page.locator('#status').textContent(), /Bağlı bölümler atlandı/);
  await page.locator('details[data-key="s67"]').evaluate((el) => { el.open = true; }); await page.locator('#chartBox').evaluate((el) => { el.open = true; });
  await page.fill('#chartText', '[Şarkı: C major] ölçü 1–8\n| C | G | F | C | Am | F | Dm | G |'); await page.click('#btnChartApply');
  assert.match(await page.locator('#status').textContent(), /Bağlı bölümler atlandı/);
  assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.chordLocks.filter((l) => l.bar >= 7)), ownLocks);
  await page.click('#btnUnlockAll'); assert.match(await page.locator('#status').textContent(), /Bağlı bölümler atlandı/);
  assert.deepEqual(await page.evaluate(() => window.__dawAPI.S.proj.chordLocks.filter((l) => l.bar >= 7)), ownLocks);
  // Reload the deterministic fixture for source/target stream and stem comparisons.
  await open(fixture); await link('s3', 's1');
  const audio = await page.evaluate(async () => {
    const api = window.__dawAPI, { C, S } = api, scheduled = {};
    api.onScheduledEvents = (ev) => Object.assign(scheduled, ev);
    await api.player().play({ from: 0 }); api.stop(); delete api.onScheduledEvents;
    const all = C.arrangedEvents(S.d, S.proj);
    const relative = (ev, startBar) => ev.filter((e) => e.t >= (startBar - 1) * 2 - 1e-8 && e.t < (startBar + 1) * 2 - 1e-8).map((e) => {
      const n = { ...e }; n.t -= (startBar - 1) * 2;
      for (const k of ['q', 'q0', 'q1']) if (n[k] != null) n[k] -= (startBar - 1) * 4;
      if (n.bar != null) n.bar -= startBar - 1; delete n.slot;
      for (const k of ['t', 'q', 'q0', 'q1', 'dur', 'hold']) if (n[k] != null) n[k] = Math.round(n[k] * 1e8) / 1e8;
      return n;
    });
    const streams = Object.fromEntries(Object.entries(all).map(([k, ev]) => [k, { source: relative(ev, 3), target: relative(ev, 7) }]));
    const filter = C.Bass.filterAutomation(S.proj.bass, api.bass.ctx(), S.d.g), pump = [];
    if (S.proj.bass.pump > 0 && S.proj.bass.instrumentType === 'synth') {
      for (let t = 0; t < S.d.bars * S.d.g.barSec; t += S.d.g.pulseSec) pump.push({ t, depth: S.proj.bass.pump, release: .25 * S.d.g.pulseSec });
    }
    const shiftedPoints = (points, start) => points.filter((p) => p.t >= start && p.t < start + 4).map((p) => ({ ...p, t: p.t - start, ...(p.q == null ? {} : { q: p.q - start / S.d.g.spq }) }));
    const automation = Object.fromEntries(Object.entries({ filter, pump }).map(([k, points]) => [k, { source: shiftedPoints(points, 4), target: shiftedPoints(points, 12) }]));
    const sr = 22050, stems = await api.renderStems(sr, 18);
    const rms = (a, start, end) => { let sum = 0; for (let i = Math.round(start * sr); i < Math.round(end * sr); i++) sum += a[i] ** 2; return Math.sqrt(sum / Math.round((end - start) * sr)); };
    const levels = Object.fromEntries(['piano', 'guitar', 'bass', 'drums'].map((k) => {
      let delta = 0, peak = 0;
      for (let i = 0; i < 4 * sr; i++) {
        delta = Math.max(delta, Math.abs(stems[k][4 * sr + i] - stems[k][12 * sr + i]));
        peak = Math.max(peak, Math.abs(stems[k][4 * sr + i]));
      }
      return [k, { source: rms(stems[k], 4, 8), target: rms(stems[k], 12, 16), delta, peak }];
    }));
    window.__linkedStems = stems; window.__linkedEvents = JSON.parse(JSON.stringify(all));
    return { streams, automation, levels, scheduled: JSON.parse(JSON.stringify(scheduled)), all: JSON.parse(JSON.stringify(all)) };
  });
  assert.deepEqual(audio.scheduled, audio.all);
  for (const [layer, v] of Object.entries(audio.streams)) { assert.ok(v.source.length > 0, layer); assert.deepEqual(v.target, v.source, `${layer}: shifted source events`); }
  for (const [kind, points] of Object.entries(audio.automation)) assert.deepEqual(points.target, points.source, `bass: shifted ${kind} automation`);
  for (const [layer, v] of Object.entries(audio.levels)) {
    assert.ok(v.source > 1e-5 && v.target > 1e-5, layer);
    assert.ok(Math.abs(v.source - v.target) / v.source < .02, `${layer}: shifted stem RMS ${JSON.stringify(v)}`);
    // Bass envelope/filter updates align to 128-frame Web Audio quanta, so note releases
    // at different absolute times can differ slightly even with identical events and automation.
    assert.ok(layer === 'bass' ? v.delta <= .02 * v.peak : v.delta < 1e-4, `${layer}: shifted stem samples ${JSON.stringify(v)}`);
  }
  const beforeUnlink = await events();
  const midiBeforeUnlink = await page.evaluate(() => { const { C, S } = window.__dawAPI; return Array.from(C.exportMidi(S.proj, S.d)); });
  await card('s3').locator('[data-link-unlink]').click();
  assert.match(await page.locator('#status').textContent(), /bağımsız kopya oldu/); assert.equal(await card('s3').locator('.link-info').count(), 0);
  assert.deepEqual(await events(), beforeUnlink);
  assert.deepEqual(await page.evaluate(() => { const { C, S } = window.__dawAPI; return Array.from(C.exportMidi(S.proj, S.d)); }), midiBeforeUnlink);
  const rendered = await page.evaluate(async () => {
    const api = window.__dawAPI, next = await api.renderStems(22050, 18), deltas = {};
    for (const k of ['piano', 'guitar', 'bass', 'drums']) { let max = 0; const old = window.__linkedStems[k]; for (let i = 0; i < Math.min(next[k].length, old.length); i++) max = Math.max(max, Math.abs(next[k][i] - old[i])); deltas[k] = max; }
    return deltas;
  });
  for (const [layer, delta] of Object.entries(rendered)) assert.ok(delta < 1e-5, `${layer}: unlink stem difference ${delta}`);
  await undo(); assert.deepEqual((await section('s3')).link, { sourceId: 's1' });
  // A -> B -> C; the source menu omits both self and cyclic candidates.
  await link('s1', 's0');
  assert.equal(await page.evaluate(() => window.__dawAPI.C.resolveLinks(window.__dawAPI.S.proj, window.__dawAPI.S.d).s3.rootId), 's0');
  assert.equal(await card('s0').locator('[data-act="secLink"] option[value="s3"]').count(), 0);
  assert.equal(await card('s0').locator('[data-act="secLink"] option[value="s1"]').count(), 0);
  await open(fixture); await link('s3', 's1');
  const linkedEvents = await events(); await link('s3', ''); assert.equal((await section('s3')).link, null); assert.deepEqual(await events(), linkedEvents);
  await undo(); const sound = await targetSound();
  const deleteDepth = await page.evaluate(() => window.__dawAPI.hist().undo.length);
  await card('s1').locator('[data-act="secDel"]').click();
  assert.equal((await section('s3')).link, null); assert.match(await page.locator('#status').textContent(), /bağımsız kopya/);
  assert.deepEqual(await targetSound(), sound); assert.equal(await page.evaluate(() => window.__dawAPI.hist().undo.length), deleteDepth + 1);
  await undo(); assert.deepEqual((await section('s3')).link, { sourceId: 's1' }); assert.ok(await section('s1'));
  const resizeDepth = await page.evaluate(() => window.__dawAPI.hist().undo.length);
  await card('s1').locator('[data-act="secEnd"]').fill('3'); await card('s1').locator('[data-act="secEnd"]').dispatchEvent('change');
  assert.equal((await section('s3')).link, null); assert.deepEqual(await targetSound(), sound);
  assert.equal(await card('s3').locator('[data-act="secLink"] option[value="s1"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__dawAPI.hist().undo.length), resizeDepth + 1);
  await undo(); assert.equal((await section('s1')).endBar, 4); assert.deepEqual((await section('s3')).link, { sourceId: 's1' });
  const downloaded = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await downloaded).path());
  await page.click('#btnNew'); assert.equal(await page.locator('[data-act="secLink"]').count(), 0);
  await open(saved); assert.deepEqual((await section('s3')).link, { sourceId: 's1' }); assert.match(await card('s3').textContent(), /bağlı/);
  const legacy = structuredClone(fixture); delete legacy.chordChoices; legacy.sections.forEach((s) => delete s.link);
  await open(legacy); assert.equal((await section('s3')).link, null); assert.equal(await page.locator('#sectionList .link-info').count(), 0);
  const midi = await page.evaluate(() => { const { C, S } = window.__dawAPI; return Array.from(C.exportMidi(S.proj, S.d)); });
  await page.setInputFiles('#fileMidi', { name: 'links.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi) });
  await page.waitForFunction(() => window.__dawAPI.S.midi?.name === 'links.mid');
  assert.equal(await page.locator('#sectionList [data-act="secLink"]').count(), 4); assert.equal(await page.locator('#sectionList .link-info').count(), 0);
  const alone = structuredClone(fixture); alone.sections = [alone.sections[0]];
  await open(alone); assert.equal(await card('s0').locator('[data-act="secLink"]').isDisabled(), true); assert.match(await card('s0').textContent(), /Aynı uzunlukta başka bölüm yok/);
  assert.deepEqual(errors, []);
  console.log('links UI: sources, guards, bulk skips, propagation, streams/stems, unlink, history, chains, structure, save/load and legacy passed');
} finally { await browser.close(); }

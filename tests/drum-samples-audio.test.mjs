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
  await page.waitForFunction(() => window.__dawAPI?.realSounds && /Hazır/.test(document.querySelector('#status').textContent));
  const fixture = await page.evaluate(() => {
    const C = window.Core, record = (id) => ({ id, name: 'fixture ' + id, author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', selector: 'fallback', why: '' });
    const p = C.newProject(); p.matrix.enabled = false; p.piano.style = 'synth-arp';
    p.drums = { on: true, loop: C.loopsFor('4/4')[0].id, startBar: 1, fills: false };
    p.realSounds = { enabled: true, drums: { K: record(1) }, bass: [] };
    p.midiData = { name: 'drum-test', endQ: 16, notes: [{ q0: 0, q1: 1, midi: 60, vel: 80 }, { q0: 8, q1: 9, midi: 64, vel: 80 }] };
    p.mixer.drums.solo = true; return p;
  });
  await page.evaluate(async (fixture) => {
    const C = window.Core, control = window.__realTest = { searches: 0, fetches: [], decodes: 0, waiting: false, release: null, hold: 0, failure: '', hasKey: false };
    const cache = C.createSoundCache({ indexedDB: null });
    for (const id of [1, 2]) { const r = { ...fixture.realSounds.drums.K, id, url: fixture.realSounds.drums.K.url.replace('/1/', `/${id}/`), previewUrl: fixture.realSounds.drums.K.previewUrl.replace('/1_test', `/${id}_test`) }; await cache.put(r, new Uint8Array([id])); }
    control.cache = cache;
    window.__dawAPI.realSounds.inject({ cache, hasKey: () => control.hasKey,
      network: { async freesoundSearch() { control.searches++; throw Error('no search'); }, async freesoundPreview(id) { control.fetches.push(id); if (control.failure === 'rate') throw new C.NetError('rate'); return new Uint8Array([id]); } },
      decode: async (bytes) => {
        control.decodes++;
        if (control.failure === 'decode') throw Error('decoder failed');
        if (control.hold === bytes[0]) { control.waiting = true; await new Promise((resolve) => { control.release = resolve; }); }
        const sr = 44100, length = bytes[0] === 2 ? 2646 : 5292, lead = 220, data = new Float32Array(length + lead);
        for (let i = lead; i < data.length; i++) data[i] = .2 * Math.cos(2 * Math.PI * (bytes[0] === 2 ? 700 : 1000) * (i - lead) / sr);
        return { channels: [data], sampleRate: sr };
      }
    });
  }, fixture);
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Test projesi yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'drums.json', mimeType: 'application/json', buffer: Buffer.isBuffer(p) ? p : Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await page.evaluate(() => document.querySelectorAll('details.step').forEach((e) => { e.open = true; }));
  };
  await open(fixture);
  assert.equal(await page.evaluate(() => window.__realTest.fetches.length), 0, 'offline cache hit needs no key');
  assert.match(await page.locator('[data-sound-state="K"]').textContent(), /gerçek/);
  assert.equal(await page.locator('[data-sound-state="S"]').textContent(), 'sentetik');
  const sentinel = 'FS_FAKE_KEY_SENTINEL_1234';
  await page.fill('#inFreesoundKey', sentinel); await page.click('#btnSoundSave');
  const stems = await page.evaluate(async () => {
    const A = window.__dawAPI, C = A.C, ev = A.arrangement().drums;
    const midi = Array.from(C.exportMidi(A.S.proj, A.S.d, { name: 'same', events: ev }));
    const synth = C.renderDrums(ev, 44100, 44100 * 10);
    const snap = await A.realSounds.prepare(), bank = snap.bank(44100), expected = C.renderDrums(ev, 44100, synth.length, 1, bank);
    const st = await A.renderStems(44100, 10);
    let difference = 0, error = 0; for (let i = 0; i < synth.length; i++) { difference += Math.abs(st.drums[i] - synth[i]); error = Math.max(error, Math.abs(st.drums[i] - expected[i])); }
    snap.release();
    const saved = A.S.proj.realSounds.enabled; A.S.proj.realSounds.enabled = false;
    const off = await A.renderStems(44100, 10);
    let offError = 0; for (let i = 0; i < synth.length; i++) offError = Math.max(offError, Math.abs(off.drums[i] - synth[i]));
    const after = Array.from(C.exportMidi(A.S.proj, A.S.d, { name: 'same', events: A.arrangement().drums }));
    A.S.proj.realSounds.enabled = saved;
    return { difference, error, offError, midiSame: JSON.stringify(midi) === JSON.stringify(after) };
  });
  assert.ok(stems.difference > 1); assert.equal(stems.error, 0); assert.equal(stems.offError, 0); assert.ok(stems.midiSame);
  await page.evaluate(async () => {
    const A = window.__dawAPI, P = A.player(); await P.ensure();
    const sr = Tone.getContext().sampleRate, snap = await A.realSounds.prepare();
    window.__expectedDrum = Array.from(snap.bank(sr).K); snap.release(); window.__drumHits = [];
    const hit = P.hitDrum;
    window.__drumHitMode = 'real';
    P.hitDrum = function (e, time, bank = this.drumBufs) {
      const ctx = Tone.getContext().rawContext, sources = [], gains = [];
      const sourceDescriptor = Object.getOwnPropertyDescriptor(ctx, 'createBufferSource'), gainDescriptor = Object.getOwnPropertyDescriptor(ctx, 'createGain');
      const createSource = ctx.createBufferSource, createGain = ctx.createGain;
      const observed = { kind: e.kind, velocity: e.vel, completed: false };
      window.__drumHits.push(observed);
      // Tone ham bağlamı sarmalayabilir: yalnızca bu vuruşun gerçek fabrikalarını izle.
      Object.defineProperty(ctx, 'createBufferSource', { configurable: true, value: function (...args) { const source = createSource.apply(this, args); sources.push(source); return source; } });
      Object.defineProperty(ctx, 'createGain', { configurable: true, value: function (...args) { const gain = createGain.apply(this, args); gains.push(gain); return gain; } });
      try {
        const result = hit.call(this, e, time, bank), source = sources[0], gain = gains[0];
        observed.completed = true; observed.captured = !!source && !!gain;
        if (observed.captured) {
          const data = source.buffer.getChannelData(0);
          const error = (reference) => { if (!reference || data.length !== reference.length) return Infinity; let worst = 0; for (let i = 0; i < data.length; i++) worst = Math.max(worst, Math.abs(data[i] - reference[i])); return worst; };
          observed.fromBank = source.buffer === bank[e.kind]; observed.gain = gain.gain.value; observed.length = data.length;
          observed.synthBuffer = source.buffer === this.synthDrumBufs[e.kind];
          observed.synthError = error(this.synthDrumBufs[e.kind].getChannelData(0));
          if (e.kind === 'K') { observed.realError = error(window.__expectedDrum); observed.error = window.__drumHitMode === 'real' ? observed.realError : observed.synthError; }
        }
        return result;
      } finally {
        if (sourceDescriptor) Object.defineProperty(ctx, 'createBufferSource', sourceDescriptor); else delete ctx.createBufferSource;
        if (gainDescriptor) Object.defineProperty(ctx, 'createGain', gainDescriptor); else delete ctx.createGain;
      }
    };
    await P.play({ from: 0 });
  });
  await page.waitForFunction(() => window.__drumHits.some((h) => h.kind === 'K'));
  const realHit = await page.evaluate(() => window.__drumHits.find((h) => h.kind === 'K'));
  assert.ok(realHit.completed && realHit.captured && realHit.fromBank);
  assert.equal(realHit.error, 0); assert.ok(realHit.synthError > 1e-6); assert.equal(realHit.synthBuffer, false);
  assert.ok(Math.abs(realHit.gain - realHit.velocity) < 1e-7);
  assert.ok(await page.evaluate(() => window.__dawAPI.player().playing));
  await page.evaluate(() => window.__dawAPI.stop());
  // Negatif kontrol: kapalıyken aynı gözlemci gerçek örnek yerine sentez bankasını görmeli.
  await page.uncheck('#inRealSounds');
  await page.evaluate(async () => { window.__drumHits = []; window.__drumHitMode = 'synth'; await window.__dawAPI.player().play({ from: 0 }); });
  await page.waitForFunction(() => window.__drumHits.some((h) => h.kind === 'K'));
  const synthHit = await page.evaluate(() => window.__drumHits.find((h) => h.kind === 'K'));
  assert.ok(synthHit.completed && synthHit.captured && synthHit.fromBank && synthHit.synthBuffer);
  assert.equal(synthHit.error, 0); assert.ok(synthHit.realError > 1e-6);
  assert.ok(Math.abs(synthHit.gain - synthHit.velocity) < 1e-7);
  assert.ok(await page.evaluate(() => window.__dawAPI.player().playing));
  await page.evaluate(() => window.__dawAPI.stop());
  await page.check('#inRealSounds');
  await page.waitForFunction(() => document.querySelector('[data-sound-state="K"]').textContent === 'gerçek');
  await page.evaluate(() => { window.__drumHitMode = 'real'; });
  await page.evaluate(() => {
    window.__mixMeasurement = null;
    const C = window.Core, measure = C.autoMixLevels;
    C.autoMixLevels = (st, sr) => { window.__mixMeasurement = { sr, drums: st.drums.slice(), result: measure(st, sr) }; return window.__mixMeasurement.result; };
  });
  await page.click('#btnAutoMix'); await page.waitForFunction(() => /Seviyeler ayarlandı/.test(document.querySelector('#status').textContent));
  const measurement = await page.evaluate(async () => {
    const A = window.__dawAPI, measured = window.__mixMeasurement, snap = await A.realSounds.prepare();
    const expected = A.C.renderDrums(A.arrangement().drums, measured.sr, measured.drums.length, 1, snap.bank(measured.sr));
    let error = 0; for (let i = 0; i < expected.length; i++) error = Math.max(error, Math.abs(expected[i] - measured.drums[i])); snap.release();
    return { sr: measured.sr, error, level: measured.result.levels.drums };
  });
  assert.equal(measurement.sr, 22050); assert.equal(measurement.error, 0); assert.ok(Number.isFinite(measurement.level)); assert.ok(measurement.level >= -40 && measurement.level <= 6);
  const expectedWav = Buffer.from(await page.evaluate(async () => {
    const A = window.__dawAPI, sr = 44100, len = A.S.d.bars * A.S.d.g.barSec + 1.5;
    const st = await A.renderStems(sr, len), mixed = Float32Array.from(st.drums, (v) => v * Math.pow(10, A.S.proj.mixer.drums.vol / 20));
    mixed.set(A.C.vocalLimit(mixed, sr, -1)); return A.C.bytesToBase64(new Uint8Array(A.C.encodeWav([mixed, mixed], sr)));
  }), 'base64');
  const wavWait = page.waitForEvent('download'); await page.click('#btnExpMix'); const wav = readFileSync(await (await wavWait).path());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.deepEqual(wav, expectedWav);
  let wavPeak = 0; for (let i = 44; i + 1 < wav.length; i += 2) wavPeak = Math.max(wavPeak, Math.abs(wav.readInt16LE(i)) / 32768); assert.ok(wavPeak > .001 && wavPeak < .9);
  const undo = async (redo = false) => {
    await page.locator('#btnSave').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo);
  };
  await page.uncheck('#inRealSounds'); await undo();
  assert.equal(await page.locator('#inRealSounds').isChecked(), true); assert.match(await page.locator('[data-sound-state="K"]').textContent(), /gerçek/);
  await undo(true); assert.equal(await page.locator('#inRealSounds').isChecked(), false);
  await page.check('#inRealSounds'); await page.waitForFunction(() => document.querySelector('[data-sound-state="K"]').textContent === 'gerçek');
  // İki sürümün hızlı geçişi: eski çözücünün geç sonucu yeni bankayı değiştirmemeli.
  const versionIds = await page.evaluate(() => {
    const A = window.__dawAPI, C = A.C, p = A.S.proj;
    const first = C.saveVersion(p, A.S.d, 'Fixture A').id;
    p.realSounds.drums.K = { ...p.realSounds.drums.K, id: 2, url: p.realSounds.drums.K.url.replace('/1/', '/2/'), previewUrl: p.realSounds.drums.K.previewUrl.replace('/1_test', '/2_test') };
    const second = C.saveVersion(p, A.S.d, 'Fixture B').id; A.refresh(); return { first, second };
  });
  await page.evaluate(() => { window.__realTest.hold = 1; window.__realTest.waiting = false; });
  await page.click(`[data-version="${versionIds.first}"] [data-version-act="switch"]`);
  await page.waitForFunction(() => window.__realTest.waiting);
  await page.click(`[data-version="${versionIds.second}"] [data-version-act="switch"]`);
  await page.waitForFunction(() => /Fixture B.*sürümüne geçildi/.test(document.querySelector('#status').textContent));
  await page.evaluate(() => { window.__realTest.hold = 0; window.__realTest.release(); });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 2);
  assert.equal(await page.evaluate(async () => { const s = await window.__dawAPI.realSounds.prepare(); const n = s.bank(44100).K.length; s.release(); return n; }), 2646);
  // Yeni kayıt seçimi de tek geri alma adımıyla eski kimliğe döner ve yeniden hazırlanır.
  await undo(); assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 1);
  await undo(true); assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 2);
  await page.evaluate(() => {
    const A = window.__dawAPI, C = A.C, r = { ...A.S.proj.realSounds.drums.K, id: 1, url: 'https://freesound.org/people/tester/sounds/1/', previewUrl: 'https://cdn.freesound.org/previews/1/1_test.mp3' };
    A.soundSelection.inject({ cache: window.__realTest.cache,
      network: { async freesoundSearch(params) { const spec = Object.values(C.LANE_SPECS).find((s) => s.query === params.query); return { candidates: spec.required ? [{ record: r, duration: .12, tags: [] }] : [] }; }, async freesoundPreview() { return new Uint8Array([1]); } },
      decode: async () => ({ channels: [Float32Array.from({ length: 5292 }, (_, i) => .2 * Math.cos(2 * Math.PI * 1000 * i / 44100))], sampleRate: 44100 })
    });
  });
  await page.click('#btnSoundSelect'); await page.waitForFunction(() => /Davul seti seçildi/.test(document.querySelector('#soundSelectStatus').textContent));
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 1);
  await undo(); assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 2);
  await undo(true); assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.drums.K.id), 1);
  assert.equal(await page.evaluate(async () => { const s = await window.__dawAPI.realSounds.prepare(); const n = s.bank(44100).K.length; s.release(); return n; }), 5292);
  const savedWait = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await savedWait).path());
  await open(saved); assert.equal(await page.evaluate(() => window.__realTest.searches), 0); assert.equal(await page.evaluate(() => window.__realTest.fetches.length), 0);
  await page.evaluate(() => { window.__realTest.hasKey = false; });
  const absent = structuredClone(fixture); absent.realSounds.drums.K = { ...absent.realSounds.drums.K, id: 3, url: absent.realSounds.drums.K.url.replace('/1/', '/3/'), previewUrl: absent.realSounds.drums.K.previewUrl.replace('/1_test', '/3_test') };
  await open(absent); assert.match(await page.locator('#soundAudioStatus').textContent(), /önbellekte yok.*anahtar/);
  await page.evaluate(() => window.__dawAPI.player().play({ from: 0 })); assert.ok(await page.evaluate(() => window.__dawAPI.player().playing));
  await page.evaluate(() => window.__dawAPI.stop());
  await page.evaluate(() => { window.__realTest.hasKey = true; window.__realTest.failure = 'rate'; });
  await open(absent); assert.match(await page.locator('#soundAudioStatus').textContent(), /429/);
  await page.evaluate(() => { window.__realTest.failure = 'decode'; });
  await open(fixture); assert.match(await page.locator('#soundAudioStatus').textContent(), /çözülemedi/);
  await page.evaluate(() => window.__dawAPI.player().play({ from: 0 })); assert.ok(await page.evaluate(() => window.__dawAPI.player().playing));
  const scan = await page.evaluate(() => JSON.stringify({ p: window.__dawAPI.S.proj, history: window.__dawAPI.hist(), dom: document.documentElement.outerHTML }));
  assert.ok(!scan.includes(sentinel)); assert.ok(!saved.includes(Buffer.from(sentinel))); assert.ok(!wav.includes(Buffer.from(sentinel))); assert.ok(!logs.join('\n').includes(sentinel));
  assert.ok((await page.evaluate(() => window.__dawAPI.realSounds.stats())).bytes <= 24000000);
  console.log('drum-samples-audio: live buffers, stems/WAV, auto-mix rate, MIDI, undo/redo, rapid versions, offline cache, fallback status, clipping and sentinel isolation passed');
} finally { await browser.close(); }

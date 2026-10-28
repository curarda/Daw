import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route('https://**/*', (r) => /Tone\.js/.test(r.request().url()) ? r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }) : r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI?.bass && /Hazır/.test(document.querySelector('#status').textContent));
  const fixture = await page.evaluate(() => {
    const C = window.Core, p = C.newProject(); p.piano.style = 'synth-arp'; p.matrix.enabled = false;
    p.sections = [{ id: 'bass-test', name: 'Bas', startBar: 1, endBar: 3, tonic: 4, mode: 'minor', confirmed: true }];
    p.midiData = { name: 'bass-test', endQ: 12, notes: [{ q0: 0, q1: 1, midi: 64, vel: 90 }] };
    p.chordLocks = [1, 2, 3].map((bar) => ({ bar, half: null, chord: { root: 4, q: 'm', bass: null } }));
    p.bass.enabled = true; p.bass.doubleLow = false; p.bass.layer = null; p.bass.useSampler = false;
    const d = C.derive(p, { duration: 0, rawNotes: [] }); C.Bass.bassGenerateAll(p.bass, C.Bass.bassContext(d, p));
    // Bilinen notalar aynı olay hattından geçer; kilit, senkronun sınama notalarını değiştirmesini önler.
    p.bass.bars.slice(0, 3).forEach((bar, i) => { bar.locked = true; bar.notes = [{ startBeat: 0, durationBeats: 3.8, midi: [28, 40, 33][i], velocity: 110, role: 'root', gate: 1 }]; });
    const record = (id, rootMidi, rootCents) => ({ id, name: 'Bas örneği ' + id, author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', selector: 'fallback', why: '', rootMidi, rootCents, pitchConfidence: .98, detectorVersion: 1 });
    window.__bassRecords = [record(1, 28, 3), record(2, 33, -12.4), record(3, 28, 0)];
    p.realSounds = { enabled: true, drums: {}, bass: [window.__bassRecords[0]] }; p.mixer.bass.solo = true; return p;
  });
  await page.evaluate(async () => {
    const A = window.__dawAPI, C = A.C, control = window.__bassAudio = { searches: 0, gemini: 0, fetches: [], decodes: 0, hasKey: false, failure: '', hold: 0, waiting: false, release: null };
    const cache = C.createSoundCache({ indexedDB: null }); control.cache = cache;
    for (const r of window.__bassRecords) await cache.put(r, Uint8Array.of(r.id));
    A.realSounds.inject({ cache, hasKey: () => control.hasKey, network: {
      freesoundSearch() { control.searches++; throw Error('no discovery'); }, geminiGenerate() { control.gemini++; throw Error('no Gemini'); },
      async freesoundPreview(id) { control.fetches.push(id); if (control.failure === 'rate') throw new C.NetError('rate'); return Uint8Array.of(id); }
    }, decode: async (bytes) => {
      control.decodes++;
      if (control.failure === 'decode') throw Error('raw decoder error');
      if (control.hold === bytes[0]) { control.waiting = true; await new Promise((resolve) => { control.release = resolve; }); }
      const r = window.__bassRecords.find((r) => r.id === bytes[0]) || window.__bassRecords[0], sr = 44100, lead = 220, mono = new Float32Array(sr * 2 + lead), hz = 440 * 2 ** ((r.rootMidi + r.rootCents / 100 - 69) / 12);
      for (let i = lead; i < mono.length; i++) { const t = (i - lead) / sr, phase = 2 * Math.PI * hz * t; mono[i] = .35 * (1 - Math.exp(-t * 150)) * Math.exp(-t * 1.5) * (Math.sin(phase) + .25 * Math.sin(2 * phase)); }
      return { channels: [mono], sampleRate: sr };
    } });
    // FFT: parabolik tepe enterpolasyonu; üç tüketicinin perdesini aynı ölçümle karşılaştır.
    window.__bassPeak = (data, sr, start, expected) => {
      const n = 32768, re = new Float64Array(n), im = new Float64Array(n), count = Math.min(n, Math.floor(sr * .7));
      for (let i = 0; i < count; i++) re[i] = (data[Math.round(start * sr) + i] || 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / (count - 1)));
      for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= n; len <<= 1) for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const angle = -2 * Math.PI * k / len, wr = Math.cos(angle), wi = Math.sin(angle), ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; }
      const mag = (i) => Math.hypot(re[i], im[i]); let best = Math.round(expected * .85 * n / sr);
      for (let i = best; i <= Math.round(expected * 1.15 * n / sr); i++) if (mag(i) > mag(best)) best = i;
      const offset = .5 * (mag(best - 1) - mag(best + 1)) / (mag(best - 1) - 2 * mag(best) + mag(best + 1)); return (best + offset) * sr / n;
    };
  });
  const show = () => page.evaluate(() => document.querySelectorAll('details.step').forEach((el) => { el.open = true; }));
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Test projesi yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'bass-audio.json', mimeType: 'application/json', buffer: Buffer.isBuffer(p) ? p : Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent)); await show();
  };
  await open(fixture); assert.match(await page.locator('[data-bass-sound-state="1"]').textContent(), /gerçek/);
  assert.deepEqual(await page.evaluate(() => window.__bassAudio.fetches), []);
  const fs = 'FS_FAKE_KEY_SENTINEL_1234', gem = 'GEM_FAKE_KEY_SENTINEL_5678';
  await page.fill('#inFreesoundKey', fs); await page.fill('#inGeminiKey', gem); await page.click('#btnSoundSave');
  assert.notEqual(await page.inputValue('#inFreesoundKey'), fs); assert.notEqual(await page.inputValue('#inGeminiKey'), gem);
  const audio = await page.evaluate(async () => {
    const A = window.__dawAPI, C = A.C, ev = A.arrangement().bass, midi = Array.from(C.exportMidi(A.S.proj, A.S.d));
    const out = [], stems = {};
    for (const sr of [22050, 44100, 48000]) {
      const stem = await A.bass.renderOffline(sr, Math.round(7 * sr)); stems[sr] = stem;
      for (const e of ev.slice(0, 3)) { const expected = 440 * 2 ** ((e.midi - 69) / 12); out.push({ rate: sr, midi: e.midi, hz: window.__bassPeak(stem, sr, e.t + .12, expected), expected }); }
    }
    const sampleStem = stems[44100], snapshot = await A.realSounds.prepare();
    const oc = new OfflineAudioContext(1, 44100, 44100), voices = A.bass.makeVoices({ ...A.S.proj.bass, layer: { preset: 'Warm sub' }, doubleLow: true }, oc, (n) => n.connect(oc.destination), snapshot.bassSamples(oc), snapshot.retain);
    const layers = voices.map((v) => ({ sampler: v.inst instanceof C.Bass.BassSampler, source: v.inst.source || 'synth' })); for (const v of voices) v.inst.dispose(); snapshot.release();
    A.S.proj.realSounds.enabled = false; const synth = await A.bass.renderOffline(44100, sampleStem.length);
    const direct = new OfflineAudioContext(1, sampleStem.length, 44100), old = new C.Bass.BassSynth(direct, { preset: A.S.proj.bass.instrumentPreset, volume: A.S.proj.bass.volume, follow: false }); old.output.connect(direct.destination); for (const e of ev) C.Bass.hitBass(old, e, e.t); const legacy = (await direct.startRendering()).getChannelData(0);
    let difference = 0, offError = 0, peak = 0, realSquare = 0, synthSquare = 0; for (let i = 0; i < sampleStem.length; i++) { difference += Math.abs(sampleStem[i] - synth[i]); realSquare += sampleStem[i] ** 2; synthSquare += synth[i] ** 2; offError = Math.max(offError, Math.abs(synth[i] - legacy[i])); peak = Math.max(peak, Math.abs(sampleStem[i])); }
    const midiSame = JSON.stringify(midi) === JSON.stringify(Array.from(C.exportMidi(A.S.proj, A.S.d))); A.S.proj.realSounds.enabled = true;
    let ring = 0; for (let i = Math.round((ev[1].t + 1.25) * 44100); i < Math.round((ev[1].t + 1.7) * 44100); i++) ring = Math.max(ring, Math.abs(sampleStem[i]));
    return { out, layers, difference, offError, midiSame, peak, ring, levelRatio: Math.sqrt(realSquare / synthSquare), events: ev.map((e) => e.midi) };
  });
  assert.deepEqual(audio.events.slice(0, 3), [28, 40, 33]);
  for (const p of audio.out) assert.ok(Math.abs(1200 * Math.log2(p.hz / p.expected)) < 8, JSON.stringify(p));
  assert.ok(audio.difference > 1); assert.ok(audio.levelRatio > .2 && audio.levelRatio < 3, 'sample/synth RMS remains sane: ' + audio.levelRatio); assert.equal(audio.offError, 0); assert.ok(audio.midiSame); assert.ok(audio.peak < 1); assert.equal(audio.ring, 0);
  assert.deepEqual(audio.layers, [{ sampler: true, source: 'freesound' }, { sampler: false, source: 'synth' }, { sampler: false, source: 'synth' }]);
  const live = await page.evaluate(async () => {
    const A = window.__dawAPI, P = A.player(); await P.play({ from: 0 });
    const main = P.bassVoices[0].inst, result = { playing: P.playing, source: main.source, name: main.name, roots: main.samples.map((s) => s.midi), chosen: main._pick(40).midi, rate: 2 ** ((40 - main._pick(40).midi) / 12), sampleRate: main.samples[0].buffer.sampleRate };
    P.stop(true); return result;
  });
  assert.ok(live.playing); assert.equal(live.source, 'freesound'); assert.equal(live.name, 'Freesound bas'); assert.equal(live.chosen, 28.03); assert.ok(Math.abs(live.rate - 2 ** ((12 - .03) / 12)) < 1e-12);
  const own = await page.evaluate(async () => {
    const A = window.__dawAPI, P = A.player(); await P.ensure(); const rc = Tone.getContext().rawContext, buffer = rc.createBuffer(1, 1000, rc.sampleRate);
    A.bass.BS.bank = { samples: [{ midi: 33, buffer }], releases: [], names: ['user sample'] }; A.S.proj.bass.useSampler = true; A.refresh(); await P.play({ from: 0 });
    const result = { user: P.bassVoices[0].inst.samples[0].buffer === buffer, source: P.bassVoices[0].inst.source || 'user', sampler: P.bassVoices[0].inst instanceof A.C.Bass.BassSampler };
    P.stop(true); return result;
  });
  assert.deepEqual(own, { user: true, source: 'user', sampler: true }); assert.match(await page.locator('#bassAudioStatus').textContent(), /Kendi bas örneklerin etkin: Freesound bas kullanılmıyor/);
  await page.evaluate(() => { const A = window.__dawAPI; A.bass.BS.bank = { samples: [], releases: [], names: [] }; A.S.proj.bass.useSampler = false; A.refresh(); });
  await page.click('#btnAutoMix'); await page.waitForFunction(() => /Seviyeler ayarlandı/.test(document.querySelector('#status').textContent));
  const mix = await page.evaluate(async () => {
    const A = window.__dawAPI, sourceAfterAuto = A.bass.BS.lastOffline[0].inst.source, len = Math.min(A.S.d.bars * A.S.d.g.barSec + 1.5, 150), st = await A.renderStems(22050, len), ref = await A.bass.renderOffline(22050, Math.round(len * 22050)); let error = 0;
    for (let i = 0; i < ref.length; i++) error = Math.max(error, Math.abs(ref[i] - st.bass[i]));
    return { error, sourceAfterAuto, expected: A.C.autoMixLevels(st, 22050).levels.bass, source: A.bass.BS.lastOffline[0].inst.source, vol: A.S.proj.mixer.bass.vol, bytes: A.realSounds.stats().bytes };
  }); assert.equal(mix.error, 0); assert.equal(mix.sourceAfterAuto, 'freesound'); assert.equal(mix.vol, mix.expected); assert.equal(mix.source, 'freesound'); assert.ok(mix.vol >= -40 && mix.vol <= 6); assert.ok(mix.bytes <= 24000000);
  const depth = () => page.evaluate(() => window.__dawAPI.hist().undo.length);
  const undo = async (redo = false) => { await page.locator('#btnSave').focus(); await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z'); await page.waitForFunction((redo) => new RegExp(redo ? 'Yinelendi' : 'Geri alındı').test(document.querySelector('#status').textContent), redo); };
  const before = await depth(); await page.uncheck('#inRealSounds'); await page.waitForFunction(() => document.querySelector('[data-bass-sound-state="1"]').textContent.includes('sentetik')); assert.equal(await depth(), before + 1);
  await undo(); await page.waitForFunction(() => document.querySelector('[data-bass-sound-state="1"]').textContent.includes('gerçek')); await undo(true); assert.equal(await page.isChecked('#inRealSounds'), false); await undo();
  const versions = await page.evaluate(() => { const A = window.__dawAPI, first = A.C.saveVersion(A.S.proj, A.S.d, 'Bas E1'); A.S.proj.realSounds.bass = [window.__bassRecords[1]]; A.refresh(); const second = A.C.saveVersion(A.S.proj, A.S.d, 'Bas A1'); A.refresh(); return [first.id, second.id]; });
  const switchVersion = async (id, name) => { await page.click(`[data-version="${id}"] [data-version-act="switch"]`); await page.waitForFunction((name) => document.querySelector('#status').textContent.includes(name) && /sürümüne geçildi/.test(document.querySelector('#status').textContent), name); };
  await switchVersion(versions[0], 'Bas E1'); await switchVersion(versions[1], 'Bas A1');
  assert.deepEqual(await page.evaluate(async () => { const s = await window.__dawAPI.realSounds.prepare(); const roots = s.bassBank(44100).map((v) => v.midi); s.release(); return roots; }), [32.876]);
  await undo(); assert.deepEqual(await page.evaluate(async () => { const s = await window.__dawAPI.realSounds.prepare(); const roots = s.bassBank(44100).map((v) => v.midi); s.release(); return roots; }), [28.03]); await undo(true);
  // Eski çözümleme yeni sürüme geçildikten sonra tamamlansa da bankaya kurulmaz.
  await page.evaluate(() => { window.__bassAudio.hold = 3; window.__bassAudio.waiting = false; const A = window.__dawAPI; A.S.proj.realSounds.bass = [window.__bassRecords[2]]; A.refresh(); window.__staleBass = A.realSounds.prepare(); });
  await page.waitForFunction(() => window.__bassAudio.waiting); assert.match(await page.locator('[data-bass-sound-state="3"]').textContent(), /hazırlanıyor/);
  await switchVersion(versions[0], 'Bas E1'); await page.evaluate(async () => { window.__bassAudio.release(); await window.__staleBass.then((s) => s.release()); });
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.realSounds.bass[0].id), 1);
  const savedWait = page.waitForEvent('download'); await page.click('#btnSave'); const saved = readFileSync(await (await savedWait).path());
  await page.click('#btnNew'); await page.waitForFunction(() => /Yeni proje/.test(document.querySelector('#status').textContent)); await page.evaluate(() => { window.__bassAudio.fetches = []; }); await open(saved);
  assert.deepEqual(await page.evaluate(() => ({ searches: window.__bassAudio.searches, gemini: window.__bassAudio.gemini, fetches: window.__bassAudio.fetches })), { searches: 0, gemini: 0, fetches: [] });
  const wavWait = page.waitForEvent('download'); await page.click('#btnExpMix'); const wav = readFileSync(await (await wavWait).path());
  for (let i = 44; i + 1 < wav.length; i += 2) assert.ok(Math.abs(wav.readInt16LE(i)) < 32767);
  const expectedWav = await page.evaluate(async (n) => {
    const A = window.__dawAPI, sr = 44100, stem = (await A.renderStems(sr, n / sr)).bass, gain = 10 ** (A.S.proj.mixer.bass.vol / 20), mix = Float32Array.from(stem, (v) => v * gain);
    const limited = A.C.vocalLimit(mix, sr, -1), encoded = new Uint8Array(A.C.encodeWav([limited, limited], sr));
    return A.C.bytesToBase64(encoded.subarray(44, 44 + 65536));
  }, (wav.length - 44) / 4);
  assert.deepEqual(wav.subarray(44, 44 + 65536), Buffer.from(expectedWav, 'base64'), 'mix WAV contains the prepared bass stem at the mixer level');
  const afterOpen = await page.evaluate(() => JSON.stringify({ project: window.__dawAPI.S.proj, history: window.__dawAPI.hist(), dom: document.documentElement.outerHTML }));
  for (const key of [fs, gem]) { assert.ok(!afterOpen.includes(key)); assert.ok(!saved.includes(Buffer.from(key))); assert.ok(!wav.includes(Buffer.from(key))); assert.ok(!logs.join('\n').includes(key)); }
  // Hatalar çalmayı kesmez; her denemede önbellek boşaltılıp yeni nesil hazırlanır.
  for (const mode of ['missing', 'decode', 'rate']) {
    await page.evaluate(async (mode) => { const A = window.__dawAPI, t = window.__bassAudio, r = A.S.proj.realSounds.bass[0]; await t.cache.delete(r.id, r.previewUrl); t.hasKey = mode !== 'missing'; t.failure = mode === 'missing' ? '' : mode; A.realSounds.inject({ cache: t.cache, hasKey: () => t.hasKey, network: { freesoundPreview: async () => { if (t.failure === 'rate') throw new A.C.NetError('rate'); return Uint8Array.of(1); } }, decode: async () => { throw Error('raw decoder error'); } }); await A.player().play({ from: 0 }); }, mode);
    assert.equal(await page.evaluate(() => window.__dawAPI.player().playing), true);
    assert.match(await page.locator('#bassAudioStatus').textContent(), mode === 'missing' ? /önbellekte yok.*anahtar/ : mode === 'rate' ? /429/ : /çözülemedi/);
    assert.equal(await page.evaluate(() => window.__dawAPI.player().bassVoices[0].inst instanceof window.Core.Bass.BassSynth), true); await page.evaluate(() => window.__dawAPI.player().stop(true));
  }
  assert.equal(await page.evaluate(() => window.__dawAPI.realSounds.stats().bytes <= 24000000), true);
  console.log('bass-samples-audio: FFT pitch/cents/octave/rates, natural end, exact synth fallback/MIDI, live sampler/layers/user precedence, auto-mix/WAV, history/versions/stale/cache and failure/privacy passed');
} finally { await browser.close(); }

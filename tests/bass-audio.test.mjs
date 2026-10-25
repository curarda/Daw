// Bas sentezleyici ve oynatma (Playwright + Chromium): ses OfflineAudioContext'te render edilip analiz edilir.
// Kullanım: node tests/bass-audio.test.mjs   (Tone.js gerekmez; oynatma adımı için TONE_JS=/yol/Tone.js)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const toneLocal = process.env.TONE_JS;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|salamander|net::ERR/i.test(m.text())) errors.push(m.text()); });
if (toneLocal) await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
await page.route(/\/salamander\//, (r) => r.abort());
await page.goto(indexUrl);

// sayfada çözümleme araçları
await page.evaluate(() => {
  const sr = 44100;
  const fft = (re, im) => { // yinelemeli radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) { const a = (-2 * Math.PI) / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(a * k), wi = Math.sin(a * k), ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } }
  };
  const spec = (x, t0, n = 16384) => { const re = new Float64Array(n), im = new Float64Array(n), a = Math.round(t0 * sr); for (let i = 0; i < n; i++) re[i] = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); fft(re, im); const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]); return m; };
  const peakHz = (x, t0, lo = 30, hi = 400, n = 16384) => { const m = spec(x, t0, n), bin = sr / n; let b = Math.round(lo / bin), best = b; for (let i = b; i <= Math.round(hi / bin); i++) if (m[i] > m[best]) best = i; const d = (m[best - 1] - m[best + 1]) / (2 * (m[best - 1] - 2 * m[best] + m[best + 1]) || 1); return (best + d) * bin; };
  const centroid = (x, t0, n = 8192) => { const m = spec(x, t0, n), bin = sr / n; let s = 0, w = 0; for (let i = 1; i < n / 2; i++) { s += m[i] * i * bin; w += m[i]; } return s / (w || 1); };
  const rms = (x, a, b) => { let s = 0; const i0 = Math.round(a * sr), i1 = Math.round(b * sr); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
  const hf = (x, a, b) => { let d = 0, s = 0; for (let i = Math.round(a * sr) + 1; i < Math.round(b * sr); i++) { d += (x[i] - x[i - 1]) ** 2; s += x[i] * x[i]; } return d / (s || 1e-12); };
  const maxStep = (x, a, b) => { let m = 0; for (let i = Math.round(a * sr) + 1; i < Math.round(b * sr); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const render = async (fn, secs = 1.4) => { const oc = new OfflineAudioContext(1, Math.round(secs * sr), sr); const keep = fn(oc); const b = await oc.startRendering(); const out = b.getChannelData(0); out.keep = keep; return out; };
  window.__A = { sr, spec, peakHz, centroid, rms, hf, maxStep, render, B: window.Core.Bass };
});
const A = (fn, arg) => page.evaluate(fn, arg);
let failures = 0;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { const info = await fn(); results.push(`✔ ${name} (${Date.now() - t} ms)${info ? '\n    ' + info : ''}`); } catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}
const PRESETS = ['Dark pick', 'Warm sub', 'Synth saw', 'Fuzz', 'Moroder pulse', 'Sub drone', 'Acid squelch', 'Reese', 'Analog pluck'];

await step('Her preset doğru perdeyi çalar (sub ile en yüksek tepe f ya da f/2) ve seviyeleri dengeli', async () => {
  const r = await A(async (presets) => {
    const { render, peakHz, rms, B, sr } = window.__A, out = [];
    for (const name of presets) for (const midi of [28, 40, 52]) {
      const x = await render((oc) => { const s = new B.BassSynth(oc, { preset: name, volume: 1 }); s.output.connect(oc.destination); s.noteOn(midi, 100, 0.1, {}); s.noteOff(1.0); });
      const f = 440 * 2 ** ((midi - 69) / 12), p = peakHz(x, 0.3, f / 2 - 8, f * 2 + 8, 32768);
      const ratio = p / f;
      out.push({ name, midi, ratio, level: rms(x, 0.25, 0.7), peak: Math.max(...x.subarray(0, Math.round(1.2 * sr)).map(Math.abs)) });
    }
    return out;
  }, PRESETS);
  for (const x of r) assert.ok([0.5, 1, 2].some((k) => Math.abs(x.ratio / k - 1) < 0.015), `${x.name} midi ${x.midi}: tepe/f = ${x.ratio.toFixed(3)}`);
  const lv = r.filter((x) => x.midi === 40).map((x) => x.level);
  assert.ok(Math.max(...lv) / Math.min(...lv) < 1.6, 'seviyeler dengeli: ' + lv.map((v) => v.toFixed(2)));
  assert.ok(r.every((x) => x.peak < 1), 'tepe < 1 (kırpma yok): ' + r.filter((x) => x.peak >= 1).map((x) => `${x.name}/${x.midi}: ${x.peak.toFixed(2)}`).join(', '));
  return `27 render; seviye aralığı ${Math.min(...lv).toFixed(2)}–${Math.max(...lv).toFixed(2)}`;
});

await step('Nota sınırlarında tık yok: kesilen ses 5–10 ms\'de söner (yeni nota sessizken ölçülür), bırakma ve ilk atak yumuşak; her preset', async () => {
  const r = await A(async (presets) => {
    const { render, maxStep, B } = window.__A, out = [];
    for (const name of presets) {
      // 1) kesme: B notası hız 1 (neredeyse sessiz) — sınırdaki sıçrama yalnızca kesilen A sesinden gelir
      const cut = await render((oc) => { const s = new B.BassSynth(oc, { preset: name, volume: 1 }); s.output.connect(oc.destination); s.noteOn(40, 110, 0.1, {}); s.noteOn(47, 1, 0.6, {}); s.noteOff(1.0); }, 1.2);
      // 2) bırakma: noteOff sonrası sönüm
      const rel = await render((oc) => { const s = new B.BassSynth(oc, { preset: name, volume: 1 }); s.output.connect(oc.destination); s.noteOn(40, 110, 0.1, {}); s.noteOff(0.6); }, 1.2);
      const steady = maxStep(cut, 0.3, 0.55);
      out.push({ name, steady, cut: maxStep(cut, 0.594, 0.625), release: maxStep(rel, 0.598, 0.7), start: maxStep(rel, 0.1, 0.1015) });
    }
    return out;
  }, PRESETS);
  for (const x of r) { assert.ok(x.cut <= 1.5 * x.steady + 0.002, `${x.name}: kesme sıçraması ${x.cut.toFixed(4)} > ${x.steady.toFixed(4)}`); assert.ok(x.release <= 1.5 * x.steady + 0.002, `${x.name}: bırakma ${x.release.toFixed(4)}`); assert.ok(x.start <= 0.6 * x.steady + 0.002, `${x.name}: ilk atak ${x.start.toFixed(4)}`); }
  return r.map((x) => `${x.name} ${(x.cut / x.steady).toFixed(2)}`).join(' · ');
});

await step('Presetler birbirinden duyulur biçimde ayrışır (tını ağırlık merkezi, sönüm, tepe/RMS)', async () => {
  const r = await A(async (presets) => {
    const { render, centroid, rms, B } = window.__A, out = [];
    for (const name of presets) {
      const x = await render((oc) => { const s = new B.BassSynth(oc, { preset: name, volume: 1 }); s.output.connect(oc.destination); s.noteOn(40, 100, 0.1, {}); s.noteOff(1.1); });
      const pk = Math.max(...x.subarray(4410, 22050).map(Math.abs));
      out.push({ name, c: centroid(x, 0.12), decay: rms(x, 0.5, 0.6) / (rms(x, 0.12, 0.2) || 1e-9), crest: pk / (rms(x, 0.12, 0.5) || 1e-9) });
    }
    return out;
  }, PRESETS);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j], rel = (u, v) => Math.abs(u - v) / Math.max(u, v, 1e-9);
    assert.ok(rel(a.c, b.c) > 0.12 || rel(a.decay, b.decay) > 0.15 || rel(a.crest, b.crest) > 0.12, `${a.name} ≈ ${b.name}: ${JSON.stringify([a, b])}`);
  }
  return r.map((x) => `${x.name}: ${Math.round(x.c)} Hz, sönüm ${x.decay.toFixed(2)}`).join(' · ');
});

await step('Hız parlaklığı ve vurgu: sert nota daha parlak; vurgulu nota süzgeç zarfı 1.5× (daha parlak)', async () => {
  const r = await A(async () => {
    const { render, hf, B } = window.__A;
    const hit = (vel, accent) => render((oc) => { const s = new B.BassSynth(oc, { preset: 'Dark pick', volume: 1, follow: false }); s.output.connect(oc.destination); s.noteOn(40, vel, 0.1, { accent }); s.noteOff(0.5); }, 0.8);
    const soft = await hit(40, false), hard = await hit(115, false), plain = await hit(70, false), acc = await hit(70, true);
    return { soft: hf(soft, 0.1, 0.18), hard: hf(hard, 0.1, 0.18), plain: hf(plain, 0.1, 0.18), acc: hf(acc, 0.1, 0.18) };
  });
  assert.ok(r.hard > 1.3 * r.soft, `sert ${r.hard.toFixed(4)} > yumuşak ${r.soft.toFixed(4)}`);
  assert.ok(r.acc > 1.1 * r.plain, `vurgu ${r.acc.toFixed(4)} > düz ${r.plain.toFixed(4)}`);
  return `hf: yumuşak ${r.soft.toFixed(3)} · sert ${r.hard.toFixed(3)} · düz ${r.plain.toFixed(3)} · vurgulu ${r.acc.toFixed(3)}`;
});

await step('Bağlı (tie) nota zarfı yeniden tetiklemez; bağsız aynı iki nota yeniden vurulur', async () => {
  const r = await A(async () => {
    const { render, rms, B } = window.__A;
    const two = (tie) => render((oc) => { const s = new B.BassSynth(oc, { preset: 'Warm sub', volume: 1 }); s.output.connect(oc.destination); s.noteOn(60, 100, 0.1, {}); if (!tie) s.noteOff(0.5); s.noteOn(60, 100, 0.5, { tie }); s.noteOff(0.9); }, 1.2);
    const t = await two(true), n = await two(false);
    const dip = (x) => rms(x, 0.5, 0.508) / (rms(x, 0.44, 0.48) || 1e-9);
    return { tied: dip(t), plain: dip(n) };
  });
  assert.ok(r.tied > 0.85, 'bağlı: kesinti yok ' + r.tied.toFixed(2));
  assert.ok(r.plain < 0.6, 'bağsız: yeniden vuruş çukuru ' + r.plain.toFixed(2));
  return `zarf oranı: bağlı ${r.tied.toFixed(2)}, bağsız ${r.plain.toFixed(2)}`;
});

await step('Glide: perde hedefe kayar, genlik zarfı yeniden tetiklenmez; glide yokken hemen hedefte', async () => {
  const r = await A(async () => {
    const { render, peakHz, rms, B } = window.__A;
    const run = (glide) => render((oc) => { const s = new B.BassSynth(oc, { preset: 'Acid squelch', volume: 1 }); s.output.connect(oc.destination); s.noteOn(36, 100, 0.1, {}); s.noteOn(48, 100, 0.6, { glide }); s.noteOff(1.2); }, 1.4);
    const g = await run(true), n = await run(false);
    const f1 = 440 * 2 ** ((36 - 69) / 12), f2 = 440 * 2 ** ((48 - 69) / 12);
    return { early: peakHz(g, 0.6, 40, 400, 2048) / f1, late: peakHz(g, 0.9, 40, 400, 16384) / f2, noGlideEarly: peakHz(n, 0.62, 40, 400, 2048) / f2, dipG: rms(g, 0.598, 0.606) / (rms(g, 0.55, 0.59) || 1e-9) };
  });
  assert.ok(r.early > 0.9 && r.early < 1.9, 'kayma başında hedefe varmamış: ' + r.early.toFixed(2)); assert.ok(Math.abs(r.late - 1) < 0.03 || Math.abs(r.late - 0.5) < 0.02 || Math.abs(r.late - 2) < 0.04, 'kayma sonunda hedef perde ' + r.late.toFixed(3));
  assert.ok(Math.abs(r.noGlideEarly - 1) < 0.06, 'glide yok: hemen hedefte ' + r.noGlideEarly.toFixed(2)); assert.ok(r.dipG > 0.8, 'glide: genlik zarfı çukuru yok ' + r.dipG.toFixed(2));
});

await step('Tek ses: yeni nota öncekini 5–10 ms\'lik sönümle keser (eski perde kalmaz)', async () => {
  const r = await A(async () => {
    const { render, spec, B, sr } = window.__A;
    const x = await render((oc) => { const s = new B.BassSynth(oc, { preset: 'Warm sub', volume: 1 }); s.output.connect(oc.destination); s.noteOn(36, 100, 0.1, {}); s.noteOn(41, 100, 0.5, {}); s.noteOff(1.0); }, 1.3);
    const m = spec(x, 0.7, 16384), bin = sr / 16384, at = (f) => { const i = Math.round(f / bin); return Math.max(m[i - 1], m[i], m[i + 1]); };
    const f1 = 440 * 2 ** ((36 - 69) / 12), f2 = 440 * 2 ** ((41 - 69) / 12);
    return { old: at(f1), neu: at(f2) };
  });
  assert.ok(r.old < 0.05 * r.neu, `eski perde sönmüş: ${r.old.toFixed(1)} vs ${r.neu.toFixed(1)}`);
});

await step('Süzgeç: kesim ses saatinde rampayla açılır (parlaklık artar); 24 dB/okt (steep) 12 dB\'den dik', async () => {
  const r = await A(async () => {
    const { render, centroid, B, spec, sr } = window.__A;
    const sweep = await render((oc) => { const s = new B.BassSynth(oc, { preset: 'Moroder pulse', volume: 1, follow: true }); s.output.connect(oc.destination); s.setCutoff(200, 0, 0, true); s.setCutoff(5000, 0.05, 1.6); s.noteOn(40, 100, 0.1, {}); s.noteOff(1.9); return s.log; }, 2);
    const c1 = centroid(sweep, 0.3), c2 = centroid(sweep, 1.4);
    // eğim: aynı kesimde steep (24 dB) ve değil (12 dB): kesimin üstündeki / altındaki enerji oranı
    const mkp = (steep) => ({ wave: 'sawtooth', level: 1, wave2: null, detune2: 0, level2: 0, sub: 0, subWave: 'sine', cutoff: 500, q: 0.7, env: 0, fdecay: 0.15, velCut: 0, steep, a: 0.003, d: 0.2, s: 1, r: 0.08, drive: 0, glide: 0.04, trim: 1 });
    B.BASS_PRESETS.T12 = mkp(false); B.BASS_PRESETS.T24 = mkp(true);
    const slope = async (preset) => {
      const x = await render((oc) => { const s = new B.BassSynth(oc, { preset, volume: 1, follow: false }); s.output.connect(oc.destination); s.noteOn(28, 20, 0.05, {}); s.noteOff(0.9); }, 1); // düşük hız: doygunluk harmoniği süzgeç eğimini örtmesin
      const m = spec(x, 0.25, 16384), bin = sr / 16384; let lo = 0, hi = 0;
      for (let i = Math.round(60 / bin); i < Math.round(450 / bin); i++) lo += m[i] ** 2; for (let i = Math.round(2000 / bin); i < Math.round(3500 / bin); i++) hi += m[i] ** 2;
      return hi / lo;
    };
    return { c1, c2, logLen: sweep.keep ? sweep.keep.length : 0, soft: await slope('T12'), steep: await slope('T24') };
  });
  assert.ok(r.c2 > 1.5 * r.c1, `süzgeç açılır: ${Math.round(r.c1)} → ${Math.round(r.c2)} Hz`);
  assert.ok(r.steep < 0.25 * r.soft, `steep (24 dB/okt) daha dik: yüksek/alçak ${r.steep.toExponential(2)} < ${r.soft.toExponential(2)}`);
  return `ağırlık merkezi ${Math.round(r.c1)} → ${Math.round(r.c2)} Hz`;
});

await step('Pompa: her vuruşta tempo senkron kazanç dipi; derinlik ve bırakma (0.25 vuruş)', async () => {
  const r = await A(async () => {
    const { render, rms, B } = window.__A;
    const beat = 0.5;
    const x = await render((oc) => { const s = new B.BassSynth(oc, { preset: 'Warm sub', volume: 1 }); s.output.connect(oc.destination); s.noteOn(36, 100, 0.0, {}); s.noteOff(2.0); for (let t = 0.5; t < 2; t += beat) s.pumpAt(t, 0.5, 0.25 * beat); }, 2.2);
    return { dip: rms(x, 0.5, 0.505), mid: rms(x, 0.7, 0.8), recovered: rms(x, 0.63, 0.7) };
  });
  assert.ok(r.dip < 0.7 * r.mid, `dip ${r.dip.toFixed(3)} vs orta ${r.mid.toFixed(3)}`); assert.ok(r.recovered > 0.85 * r.mid, 'bırakma 0.25 vuruşta tamam');
});

await step('Üretici çıktısı çevrimdışı çalar: katman ve düşük nota ikilemesi aynı notalar, aynı zamanda, oktav kaymalı; süzgeç otomasyonu ses saatinde', async () => {
  await A(() => window.__dawAPI.bass.loadDemo());
  const r = await A(async () => {
    const api = window.__dawAPI.bass, S = window.__dawAPI.S, C = window.Core;
    const tr = S.proj.bass;
    tr.instrumentType = 'synth'; tr.range = { low: 24, high: 52 }; tr.instrumentPreset = 'Moroder pulse'; tr.layer = { preset: 'Warm sub', octaveOffset: -12 }; tr.doubleLow = true; tr.pump = 0.3;
    for (const k of Object.keys(tr.sections)) { tr.sections[k].filterStart = 0.2; tr.sections[k].filterEnd = 0.8; }
    C.Bass.bassGenerateAll(tr, api.ctx());
    const data = await api.renderOffline(44100, Math.round(8 * 44100));
    const voices = api.BS.lastOffline, main = voices[0].inst, layer = voices[1].inst, dbl = voices[2] ? voices[2].inst : null;
    const au = voices[0].inst.log;
    return {
      n: voices.length, mainHits: main.hits, layerHits: layer.hits, dblHits: dbl ? dbl.hits : 0,
      sameTimes: main.noteLog.every((e, i) => Math.abs(e.time - layer.noteLog[i].time) < 1e-9),
      oct: main.noteLog.every((e, i) => layer.noteLog[i].midi - e.midi === -12),
      low: main.noteLog.filter((e) => e.midi < 31).length, dblMidiOk: dbl ? dbl.noteLog.every((e) => e.midi >= 36 && e.midi - 12 < 31) : false,
      cutoffLogs: au.length, ramps: au.filter((x) => x.ramp > 1).length, rmsAll: Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length),
    };
  });
  assert.equal(r.n, 3); assert.equal(r.mainHits, r.layerHits); assert.ok(r.sameTimes && r.oct, 'katman: aynı zaman, −12'); assert.equal(r.dblHits, r.low, 'MIDI 31 altındaki her nota bir oktav yukarı ikilenir'); assert.ok(r.dblMidiOk);
  assert.ok(r.ramps >= 3 && r.cutoffLogs >= 8, 'süzgeç otomasyonu bar başlarında ramp: ' + r.ramps); assert.ok(r.rmsAll > 0.005, 'ses üretildi');
  return `${r.mainHits} nota; düşük ikileme ${r.dblHits}; süzgeç ramp ${r.ramps}`;
});

await step('Gerçek zamanlı oynatma: nota olayları Tone.Transport ile ses saatinde zamanlanır; setTimeout ile nota zamanlaması yok', async () => {
  if (!toneLocal) return 'atlandı (TONE_JS yok)';
  await A(() => window.__dawAPI.bass.loadDemo());
  await page.click('#btnPlay');
  await page.waitForFunction(() => window.__dawAPI.player().bassVoices && window.__dawAPI.player().bassVoices[0].inst.hits >= 4, null, { timeout: 30000 });
  const hits = await A(() => window.__dawAPI.player().bassVoices[0].inst.hits);
  await page.click('#btnPlay');
  assert.equal(await A(() => window.__dawAPI.player().bassVoices), null, 'durdurunca sesler susar');
  const src = readFileSync(path.join(here, '..', 'src', 'bassui.js'), 'utf8');
  const fn = /function scheduleBassPlay[\s\S]*?\n}\n/.exec(src)[0];
  assert.ok(!/setTimeout\(/.test(fn), 'scheduleBassPlay setTimeout kullanmaz');
  return `${hits} nota çalındı`;
});

await browser.close();
console.log(results.join('\n'));
if (errors.length) { console.log('Tarayıcı hataları:', errors); failures++; }
if (failures) { console.log(`\n${failures} adım başarısız`); process.exit(1); }
console.log('\nBas ses testleri geçti.');

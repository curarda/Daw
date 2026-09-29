// Test melodisiyle uçtan uca doğrulama (Node, DOM yok).
// Çekirdek, tek dosyalık index.html içindeki <script id="core"> bloğundan okunur.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
assert.ok(m, 'index.html içinde <script id="core"> bulunamadı');
const sandbox = {};
new Function('globalThis', 'module', m[1])(sandbox, undefined);
const Core = sandbox.Core;

let failures = 0;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const info = await fn();
    results.push(`✔ ${name} (${Date.now() - t} ms)${info ? '\n    ' + info : ''}`);
  } catch (e) {
    failures++;
    results.push(`✘ ${name}\n    ${e.stack || e.message}`);
  }
}

const test = Core.synthTestVocal(44100);
const proj = Core.newProject();
proj.settings.bpm = test.bpm;
proj.settings.meter = test.meter;
proj.audio.offsetSec = test.offsetSec;
proj.sections = test.sections.map((s, i) => ({ id: 's' + i, name: s.name, startBar: s.startBar, endBar: s.endBar, tonic: null, mode: null }));
const st = { duration: test.signal.length / test.sr };
const g = Core.makeGrid(proj.settings);
const nm = (m) => Core.noteName(m);

await step('1) Proje ayarı: 4/4, 120 BPM grid', () => {
  assert.equal(g.barSec, 2);
  assert.equal(g.barQ, 4);
  assert.equal(Core.makeGrid({ bpm: 120, meter: '6/8' }).barSec, 1); // 6/8: BPM = noktalı çeyrek
  return `ölçü=${g.barSec}s, ${Core.totalBars(proj, st.duration)} ölçü`;
});

let d;
await step('3) Pitch detection: nota olayları, medyan perde, nefes atılır', async () => {
  st.track = await Core.detectPitch(test.signal, test.sr, proj.pitch);
  st.rawNotes = Core.segmentNotes(st.track, proj.pitch);
  d = Core.derive(proj, st);
  const exp = test.score;
  const lines = d.notes.map((n) => `${nm(n.nearest)}${n.cents >= 0 ? '+' : ''}${n.cents}c @${(n.q0 / 4 + 1).toFixed(2)}`);
  assert.equal(d.notes.length, exp.length, `nota sayısı ${d.notes.length} ≠ ${exp.length}\n${lines.join(' ')}`);
  exp.forEach(([bar, beat, dur, midi, cents], i) => {
    const n = d.notes[i];
    const q0 = (bar - 1) * 4 + beat - 1;
    assert.equal(n.nearest, midi, `nota ${i}: ${nm(n.nearest)} ≠ ${nm(midi)}`);
    assert.ok(Math.abs(n.cents - cents) <= 8, `nota ${i}: ${n.cents}c, beklenen ${cents}c`);
    assert.ok(Math.abs(n.q0 - q0) < 0.15, `nota ${i} başlangıç ${n.q0.toFixed(2)} ≠ ${q0}`);
  });
  const flat = d.notes[3];
  return `${d.notes.length} nota · pes nota: ${nm(flat.nearest)} ${flat.cents}c\n    ${lines.join(' ')}`;
});

await step('3b) Etiket düzeltme ton önerisinden önce: histogram etiketleri kullanır, ses düzeltmelerini kullanmaz', () => {
  const h0 = Array.from(d.keyInfo.s0.hist);
  const n = d.notes[5]; // D4, ölçü 2 vuruş 3
  // etiket → histogram değişir
  proj.noteEdits = [{ t0: n.t0, t1: n.t1, label: 64 }];
  const hl = Array.from(Core.derive(proj, st).keyInfo.s0.hist);
  assert.ok(hl[4] > 0 && h0[4] === 0, 'etiketlenen E histograma girmedi');
  assert.ok(hl[2] < h0[2], 'D ağırlığı azalmadı');
  // ses düzeltmeleri (autotune + manuel) → histogram aynı kalır
  const n0 = d.notes[0];
  proj.noteEdits = [{ t0: n0.t0, t1: n0.t1, target: 63, locked: true }];
  proj.autotune = Object.assign({}, proj.autotune, { enabled: true });
  const dS = Core.derive(proj, st);
  assert.equal(dS.notes[0].corr.target, 63, 'manuel ses düzeltmesi uygulanmadı');
  assert.equal(dS.notes[0].effMidi, 61, 'ses düzeltmesi kastedilen notayı değiştirmemeli');
  assert.deepEqual(Array.from(dS.keyInfo.s0.hist), h0, 'ses düzeltmesi histogramı değiştirdi');
  proj.noteEdits = [];
  proj.autotune = Object.assign({}, proj.autotune, { enabled: false });
  const pct = (h, i) => (h[i] * 100).toFixed(0) + '%';
  return `verse histogramı C#/D/E: önce ${pct(h0, 1)}/${pct(h0, 2)}/${pct(h0, 4)} · D→E etiketiyle ${pct(hl, 1)}/${pct(hl, 2)}/${pct(hl, 4)} · autotune + manuel D#4 ile değişmedi`;
});

await step('4) Ton/mod önerisi: verse → C# Frig, nakarat → B Dorian (ilk 3 aday)', () => {
  const v = d.keyInfo.s0, c = d.keyInfo.s1;
  const fmt = (k) => k.candidates.map((x) => `${x.name} (${x.confidence}%)`).join(', ') + ` · son ağırlıklı nota: ${k.last.name}`;
  assert.ok(v.candidates.some((x) => x.tonic === 1 && x.mode === 'phrygian'), 'verse adaylarında C# Frig yok: ' + fmt(v));
  assert.ok(c.candidates.some((x) => x.tonic === 11 && x.mode === 'dorian'), 'nakarat adaylarında B Dorian yok: ' + fmt(c));
  assert.equal(v.candidates[0].name, 'C# Frig');
  assert.equal(c.candidates[0].name, 'B Dorian');
  assert.equal(v.last.name, 'C#');
  assert.equal(c.last.name, 'B');
  // Aynı notalara sahip modlar ayrı aday: C# Frig ile B Dorian aynı notalardır
  assert.deepEqual(Core.scalePcs(1, 'phrygian').sort(), Core.scalePcs(11, 'dorian').sort());
  return `verse: ${fmt(v)}\n    nakarat: ${fmt(c)}`;
});

// kullanıcı kararı: önerileri onayla
proj.sections[0].tonic = 1; proj.sections[0].mode = 'phrygian';
proj.sections[1].tonic = 11; proj.sections[1].mode = 'dorian';

await step('5a) Etiket düzeltme: ses değişmez, analizdeki nota değişir', () => {
  const n = Core.derive(proj, st).notes[5];
  proj.noteEdits.push({ t0: n.t0, t1: n.t1, label: 64 });
  const d2 = Core.derive(proj, st);
  assert.equal(d2.notes[5].effMidi, 64);
  assert.equal(d2.correction.shift.reduce((a, b) => a + Math.abs(b), 0), 0, 'etiket düzeltmesi sesi değiştirmemeli');
  proj.noteEdits = [];
  return `nota 6: ${nm(n.nearest)} → etiket E4, ses kaydırma = 0`;
});

let corrected;
await step('5b) Autotune: pes notayı düzeltir (TD-PSOLA render + yeniden analiz)', async () => {
  proj.autotune = Object.assign({}, proj.autotune, { enabled: true, amount: 100, retuneMs: 20, keepVibrato: true });
  d = Core.derive(proj, st);
  const flat = d.notes[3];
  assert.equal(flat.corr.target, 62);
  assert.ok(Math.abs(flat.corr.applied - 40) < 6, 'uygulanan kaydırma ' + flat.corr.applied);
  corrected = Core.psolaShift(test.signal, test.sr, st.track, d.correction.shift);
  const tr2 = await Core.detectPitch(corrected, test.sr, proj.pitch);
  const notes2 = Core.segmentNotes(tr2, proj.pitch);
  assert.equal(notes2.length, st.rawNotes.length, 'düzeltilmiş kayıtta nota sayısı değişti');
  const f2 = notes2[3];
  assert.equal(f2.nearest, 62);
  assert.ok(Math.abs(f2.cents) <= 8, `düzeltme sonrası ${f2.cents}c`);
  const worst = Math.max(...notes2.map((n) => Math.abs(n.cents)));
  assert.ok(worst <= 10, 'en kötü sapma ' + worst);
  // dokunulmayan bölgeler orijinalle birebir
  let diff = 0;
  for (let i = 0; i < Math.round(0.4 * test.sr); i++) diff = Math.max(diff, Math.abs(corrected[i] - test.signal[i]));
  assert.ok(diff < 1e-6, 'düzeltme olmayan bölge değişti');
  // enerji korunumu (formant/genlik)
  const rmsOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const a = Math.round((test.offsetSec + 2.1) * test.sr), b = Math.round((test.offsetSec + 2.7) * test.sr);
  const ratio = rmsOf(corrected, a, b) / rmsOf(test.signal, a, b);
  assert.ok(ratio > 0.85 && ratio < 1.15, 'genlik oranı ' + ratio);
  return `pes D4 ${d.notes[3].cents}c → render sonrası ${f2.cents}c · en kötü nota ${worst}c · RMS oranı ${ratio.toFixed(3)}`;
});

await step('5b) Manuel ses düzeltme kilitler; autotune dokunmaz; akor bulucu kastedilen notayı kullanır', () => {
  const n = d.notes[0];
  proj.noteEdits.push({ t0: n.t0, t1: n.t1, target: 63, locked: true });
  const d2 = Core.derive(proj, st);
  assert.equal(d2.notes[0].corr.source, 'manual');
  assert.equal(d2.notes[0].corr.target, 63);
  assert.ok(d2.notes[0].locked);
  assert.equal(d2.notes[0].effMidi, 61, 'ses kaydırma kastedilen notayı değiştirmemeli');
  proj.noteEdits = [];
  return 'nota 1: ses D#4\'e kaydırıldı (kilitli) · akor bulucu hâlâ C#4 görür';
});

await step('5b) Autotune notanın kimliğini değiştirmez; scale\'e çekme yalnızca açık seçenek; tam tonunda scale dışı nota işaretlenir', () => {
  // nakaratı bilerek yanlış moda (B minör) koy: G#4 (Dorian 6'lısı) tam tonunda söylendi
  const p2 = JSON.parse(JSON.stringify(proj));
  p2.sections[1].mode = 'minor';
  p2.autotune = Object.assign({}, p2.autotune, { enabled: true, target: 'semitone', retuneMs: 20 });
  const dS = Core.derive(p2, st);
  const gs = dS.notes.find((x) => x.nearest === 68);
  assert.equal(gs.corr.target, 68, 'en yakın yarım ses: G# G# kalmalı');
  assert.ok(Math.abs(gs.corr.applied) < 5);
  assert.equal(gs.effMidi, 68);
  assert.ok(gs.modeSuspect, 'tam tonunda scale dışı nota "mod yanlış olabilir" işaretlenmeli');
  // pes söylenen D (−40c) yine D'ye çekilir
  assert.equal(dS.notes[3].corr.target, 62);
  // scale'e çekme açıkça seçilirse G# başka yarım sese taşınır — ama akor bulucu etkilenmez
  p2.autotune.target = 'scale';
  const dC = Core.derive(p2, st);
  const gs2 = dC.notes.find((x) => x.nearest === 68);
  assert.ok(gs2.corr.identityChange && gs2.corr.target !== 68);
  assert.equal(gs2.effMidi, 68);
  const names = (dd) => dd.chords.map((c) => Core.chordName(c.chord)).join(' ');
  p2.autotune.enabled = false;
  assert.equal(names(dC), names(Core.derive(p2, st)), 'autotune akorları değiştirmemeli');
  return `B minör seçiliyken G#4: yarım ses modunda hedef G#4 (kayma ${gs.corr.applied.toFixed(1)}c), "mod yanlış olabilir" işaretli · scale modunda hedef ${Core.noteName(gs2.corr.target)} (kimlik değişti, uyarı) · akorlar her durumda aynı`;
});

await step('6) Akor bulma (varsayılan motor: süreli Viterbi): verse C#m / Dmaj7, nakarat sonu Bm', () => {
  assert.equal(Core.CHORD_DEFAULTS.engine, 'viterbi');
  const dv = Core.derive(proj, st);
  const byBar = {};
  for (const c of dv.chords) (byBar[c.bar] ||= []).push(Core.chordName(c.chord, c.flats));
  const bars = Object.values(byBar).map((cs) => cs.join(' '));
  assert.deepEqual(bars.slice(0, 4), ['C#m', 'Dmaj7', 'C#m', 'Dmaj7 C#m']);
  assert.equal(bars[7], 'Bm');
  assert.equal(Object.keys(dv.chords.alternatives).length, 2);
  return bars.map((b, i) => `${i + 1}:${b}`).join(' | ');
});

await step('6) Akor bulma (ölçü ölçü motor, kurallar): ev akoru her 2 ölçüde; M=0 ve renk cezası', () => {
  proj.chordOpts = Object.assign({}, proj.chordOpts, { engine: 'greedy' });
  d = Core.derive(proj, st);
  const chart = (dd) => {
    const byBar = {};
    for (const c of dd.chords) (byBar[c.bar] ||= []).push(Core.chordName(c.chord, c.flats));
    return Object.values(byBar).map((cs) => cs.join(' '));
  };
  const bars = chart(d);
  const txt = bars.map((b, i) => `${i + 1}:${b}`).join(' | ');
  assert.deepEqual(bars.slice(0, 4), ['C#m', 'Dmaj7', 'C#m', 'Dmaj7 C#m'], 'verse: ' + txt);
  assert.match(d.chords.find((c) => c.bar === 3).reason, /\(d\) ev akoru 2 ölçüdür/);
  assert.equal(bars[7], 'Bm', 'nakarat sonu: ' + txt);
  // ev akoru kuralı kapalıyken (M=0) renk akoru Dmaj7 cezasız devam eder
  const off = chart(Core.derive(Object.assign({}, proj, { chordOpts: Object.assign({}, proj.chordOpts, { homeEvery: 0 }) }), st));
  assert.equal(off[2], 'Dmaj7', 'M=0: ' + off.join(' | '));
  // renk notası cezası parametresi (0.1) eski sürümün sonucunu verir
  const pen = chart(Core.derive(Object.assign({}, proj, { chordOpts: Object.assign({}, proj.chordOpts, { homeEvery: 0, colorPenalty: 0.1 }) }), st));
  assert.equal(pen[2], 'C#m', 'ceza 0.1: ' + pen.join(' | '));
  assert.equal(Core.CHORD_DEFAULTS.colorPenalty, 0);
  // Frig ev akoru asla majör değil
  assert.ok(!Core.diatonicChords(1, 'phrygian').some((c) => c.root === 1 && Core.CHORD_Q[c.q].includes(4)));
  // kilit korunur
  proj.chordLocks = [{ bar: 1, half: null, chord: { root: 9, q: '' } }];
  const d3 = Core.derive(proj, st);
  assert.equal(Core.chordName(d3.chords[0].chord), 'A');
  assert.ok(d3.chords[0].locked);
  proj.chordLocks = [];
  proj.chordOpts = Object.assign({}, proj.chordOpts, { engine: 'viterbi' });
  return `${txt}\n    M=0: ${off.join(' | ')}\n    M=0 + renk cezası 0.1: ${pen.join(' | ')}`;
});

await step('1) Gecikme kalibrasyonu: 8 click, alkış ofsetlerinin medyanı', () => {
  const sr = 48000, n = sr * 5, x = new Float32Array(n);
  let r = 7;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < n; i++) x[i] = rnd() * 0.002;
  const clicks = Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.5);
  const jitter = [4, -6, 0, 9, -3, 2, 0, 0];
  clicks.forEach((c, i) => {
    if (i === 6) return; // bir alkış kaçırıldı
    const s0 = Math.round((c + 0.045 + jitter[i] / 1000) * sr);
    for (let k = 0; k < 0.03 * sr; k++) x[s0 + k] += rnd() * 0.6 * Math.exp(-k / (0.006 * sr));
  });
  const m = Core.measureLatency(x, sr, clicks);
  assert.equal(m.detected, 7);
  assert.ok(Math.abs(m.latencyMs - 47) <= 3, 'medyan ' + m.latencyMs);
  assert.equal(Core.measureLatency(new Float32Array(n), sr, clicks).detected, 0);
  return `${m.detected}/8 alkış · ofsetler ${m.offsets.map((v) => (v == null ? '—' : Math.round(v * 1000))).join(', ')} ms · medyan ${m.latencyMs} ms`;
});

await step('7) Akor düzenleme: en iyi 3 aday + melodi notalarının rolü', () => {
  const s = d.chords.find((c) => c.bar === 2);
  assert.equal(s.candidates.length, 3);
  const roles = s.roles.filter((r) => r.w >= 1).map((r) => `${Core.pcName(r.pc)}=${r.role}`);
  assert.ok(roles.includes('D=kök'));
  assert.ok(Core.parseChord('F#m7/A').bass === 9);
  return `ölçü 2 adayları: ${s.candidates.map((c) => `${Core.chordName(c.chord)} ${c.pct}`).join(', ')} · roller: ${roles.join(', ')}`;
});

await step('8) Seslendirme: akorlar vokal altında, ortak notalar yerinde, bas kökte başlar', () => {
  for (const s of d.sections) {
    const low = Math.min(...d.notes.filter((n) => n.section === s.id).map((n) => n.effMidi));
    for (const c of d.chords.filter((c) => c.section === s.id)) {
      assert.ok(Math.max(...c.voicing.notes) < low, `ölçü ${c.bar}: voicing vokalin üstüne çıktı`);
      assert.ok(c.voicing.bass < c.voicing.notes[0]);
    }
    const first = d.chords.find((c) => c.section === s.id);
    assert.equal(Core.mod12(first.voicing.bass), first.chord.root, 'bölüm başı bas kökte değil');
  }
  for (let i = 1; i < d.chords.length; i++) {
    const a = d.chords[i - 1], b = d.chords[i];
    if (a.section !== b.section) continue;
    const common = Core.chordPcs(a.chord).filter((p) => Core.chordPcs(b.chord).includes(p));
    for (const pc of common) {
      const ma = a.voicing.notes.find((x) => Core.mod12(x) === pc);
      assert.ok(b.voicing.notes.includes(ma), `ortak nota ${Core.pcName(pc)} yerinde kalmadı (ölçü ${b.bar})`);
    }
  }
  proj.mixer.pedal = true;
  const dp = Core.derive(proj, st);
  assert.ok(dp.chords.filter((c) => c.section === 's1').every((c) => Core.mod12(c.voicing.bass) === 11), 'pedal bas');
  proj.mixer.pedal = false;
  return d.chords.map((c) => `${Core.chordName(c.chord)}:[${Core.noteName(c.voicing.bass)} | ${c.voicing.notes.map((x) => Core.noteName(x)).join(' ')}]`).join('  ');
});

await step('9) Dışa aktarım: MIDI, akor şeması, WAV, proje JSON', () => {
  const mid = Core.exportMidi(proj, d);
  const pm = Core.parseMidi(mid);
  assert.equal(pm.tracks.length, 3);
  assert.equal(pm.tracks[1].notes.length, d.notes.length);
  assert.equal(pm.tracks[1].notes[3].midi, 62);
  assert.ok(pm.tracks[2].notes.length >= d.chords.length * 4);
  const chart = Core.chordChart(proj, d);
  assert.ok(chart.includes('[Verse] C# Frig'));
  assert.ok(chart.includes('[Nakarat] B Dorian'));
  const wav = Core.encodeWav([corrected], test.sr);
  const back = Core.decodeWav(wav);
  assert.equal(back.data.length, corrected.length);
  const json = JSON.stringify(proj);
  const p2 = JSON.parse(json);
  assert.deepEqual(p2.sections, proj.sections);
  return chart.replace(/\n/g, '\n    ');
});

await step('Kişisel akort referansı: genel sapma + kayma; yuvarlama referansa göre', async () => {
  // Tüm kayıt 30 cent pes, sonuna doğru 20 cent yükseliyor (−30 → −10). Pes D: −40 daha.
  const tv = Core.synthTestVocal(44100, { offsetCents: -30, driftCents: 20 });
  const stv = { duration: tv.signal.length / tv.sr };
  stv.track = await Core.detectPitch(tv.signal, tv.sr, proj.pitch);
  stv.rawNotes = Core.segmentNotes(stv.track, proj.pitch);
  const pA = JSON.parse(JSON.stringify(proj)); pA.autotune.enabled = false; pA.noteEdits = []; pA.chordLocks = [];
  const auto = Core.derive(pA, stv);
  pA.pitch.tuning = 'a440';
  const a440 = Core.derive(pA, stv);
  assert.equal(a440.notes[3].nearest, 61, 'A440 yuvarlaması pes D\'yi C# sanmalı (−67 cent)');
  assert.equal(auto.notes[3].nearest, 62, 'kişisel referansla D');
  assert.ok(Math.abs(auto.notes[3].cents + 40) <= 8, 'pes D referansa göre −40 cent: ' + auto.notes[3].cents);
  const others = auto.notes.filter((_, i) => i !== 3).map((x) => Math.abs(x.cents));
  assert.ok(Math.max(...others) <= 10, 'diğer notalar referansa göre tam tonunda: ' + Math.max(...others));
  assert.ok(auto.tuning.global < -12 && auto.tuning.global > -28, 'genel sapma ' + auto.tuning.global);
  assert.ok(auto.tuning.driftMax - auto.tuning.driftMin > 8, 'kayma yakalanmalı');
  const names = (dd) => dd.chords.map((c) => Core.chordName(c.chord)).join(' ');
  pA.pitch.tuning = 'auto';
  const ref = Core.derive(Object.assign({}, pA, { pitch: Object.assign({}, pA.pitch) }), st);
  assert.equal(names(auto), names(ref), 'kayık sesle akorlar tam tonundaki sesle aynı olmalı');
  // autotune: kimlik referanstan, hedef standart akort (piyanoyla uyum): pes D +~67 cent çekilir
  pA.autotune = Object.assign({}, pA.autotune, { enabled: true, target: 'semitone' });
  const at = Core.derive(pA, stv);
  assert.equal(at.notes[3].corr.target, 62);
  assert.ok(at.notes[3].corr.applied > 55, 'uygulanan ' + at.notes[3].corr.applied);
  return `A4 ≈ ${auto.tuning.a4.toFixed(1)} Hz (${auto.tuning.global.toFixed(0)} cent), kayma ${auto.tuning.driftMin.toFixed(0)}…+${auto.tuning.driftMax.toFixed(0)} cent · pes D: A440'a göre ${a440.notes[3].nearest === 61 ? 'C#4 (yanlış)' : '?'} ${a440.notes[3].cents}c, referansa göre D4 ${auto.notes[3].cents}c · akorlar: ${names(auto)}`;
});

await step('Mod belirsizliği: "ayırt edici nota yok" ve "merkez belirsiz" ayrı; ton sürekliliği yumuşak, onay üstün', () => {
  const gg = Core.makeGrid({ bpm: 120, meter: '4/4' });
  const mk = (seq) => seq.map(([m, q0, q1]) => ({ detMidi: m, q0, q1 }));
  // B merkezli, 6. derece (G / G#) hiç yok: B Dorian ile B minör ayırt edilemez
  const noSixth = mk([[59, 0, 2], [62, 2, 3], [66, 3, 4], [64, 4, 6], [61, 6, 7], [62, 7, 8], [59, 8, 12]]);
  const a = Core.suggestKeys(noSixth, gg, 3);
  const nd = a.ambiguity.find((x) => x.type === 'noDistinct');
  assert.ok(nd, 'ayırt edici nota yok mesajı çıkmalı: ' + a.candidates.map((c) => c.name).join(', '));
  assert.match(nd.text, /Ayırt edici nota yok: B (Dorian|minör) ile B (Dorian|minör)/);
  // aynı nota kümesi, merkez için zayıf kanıt (eşit ağırlıklı, sonu merkezsiz)
  const flat = mk([[57, 0, 1], [59, 1, 2], [61, 2, 3], [62, 3, 4], [64, 4, 5], [66, 5, 6], [68, 6, 7], [64, 7, 8]]);
  const b = Core.suggestKeys(flat, gg, 3);
  assert.ok(b.ambiguity.some((x) => x.type === 'sameSet'), 'merkez belirsiz mesajı çıkmalı: ' + b.candidates.map((c) => `${c.name} ${c.score.toFixed(2)}`).join(', '));
  // ton sürekliliği: önceki bölüm E Miksolidya ise aynı kümedeki belirsizlikte o öne geçer (+0.08), ama yalnızca itme
  const withPrior = Core.suggestKeys(flat, gg, 3, { tonic: 4, mode: 'mixolydian' });
  const em = withPrior.candidates.find((c) => c.tonic === 4 && c.mode === 'mixolydian');
  assert.ok(em && em.continuity === 'same');
  // güçlü kanıt varsa süreklilik kazanamaz: B'de biten, B ağırlıklı melodide önceki ton E Miksolidya olsa da B Dorian önde
  const strong = Core.suggestKeys(mk([[59, 0, 3], [68, 3, 4], [62, 4, 6], [59, 6, 8]]), gg, 3, { tonic: 4, mode: 'mixolydian' });
  assert.notEqual(strong.candidates[0].name, 'E Miksolidya');
  // onaylı ton her zaman üstün: derive onaylı bölümün tonunu değiştirmez
  const p3 = JSON.parse(JSON.stringify(proj));
  p3.sections[1].tonic = 4; p3.sections[1].mode = 'mixolydian';
  const d3 = Core.derive(p3, st);
  assert.deepEqual([d3.sections[1].tonic, d3.sections[1].mode, d3.sections[1].confirmed], [4, 'mixolydian', true]);
  return `${nd.text}\n    ${b.ambiguity.find((x) => x.type === 'sameSet').text}\n    süreklilik: önceki E Miksolidya → ${withPrior.candidates.map((c) => c.name + (c.continuity ? '*' : '')).join(', ')} (güçlü kanıtta ilk aday: ${strong.candidates[0].name})`;
});

await step('Kilitler hiçbir ölçüyü akorsuz bırakmaz (aynı köklü art arda kilitler, rastgele kilit kombinasyonları)', () => {
  const p4 = JSON.parse(JSON.stringify(proj));
  p4.sections.forEach((x) => { x.tonic = null; x.mode = null; });
  const base = Core.derive(p4, st);
  const bars = (d) => new Set(d.chords.map((c) => c.bar));
  // kullanıcının yaşadığı durum: D | Dmaj7 | D C#m — önceden verse tamamen siliniyordu
  p4.chordLocks = [
    { bar: 2, half: null, chord: { root: 2, q: '', bass: null } },
    { bar: 3, half: null, chord: { root: 2, q: 'maj7', bass: null } },
    { bar: 4, half: 0, chord: { root: 2, q: '', bass: null } },
    { bar: 4, half: 1, chord: { root: 1, q: 'm', bass: null } },
  ];
  const d = Core.derive(p4, st);
  const names = d.chords.filter((c) => c.bar <= 4).map((c) => Core.chordName(c.chord));
  assert.deepEqual(names, ['C#m', 'D', 'Dmaj7', 'D', 'C#m']);
  // rastgele kilitler: her ölçüde en az bir akor, her kilit aynen uygulanmış
  let r = 7; const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool = [[1, 'm'], [2, ''], [2, 'maj7'], [11, 'm'], [4, 'add9'], [6, 'm7'], [9, ''], [1, 'sus4'], [7, 'dim']];
  for (let t = 0; t < 60; t++) {
    p4.chordLocks = [];
    for (let b = 1; b <= 8; b++) if (rnd() < 0.5) {
      const halves = rnd() < 0.3 ? [0, 1] : [null];
      for (const h of halves) { const [root, q] = pool[Math.floor(rnd() * pool.length)]; p4.chordLocks.push({ bar: b, half: h, chord: { root, q, bass: null } }); }
    }
    const dd = Core.derive(p4, st);
    assert.deepEqual([...bars(dd)], [...bars(base)], 'deneme ' + t + ': ölçü eksik');
    for (const l of p4.chordLocks) {
      const sl = dd.chords.find((c) => c.bar === l.bar && (l.half == null || c.half == null || c.half === l.half));
      assert.ok(sl && Core.sameChord(sl.chord, l.chord), 'deneme ' + t + ': kilit uygulanmadı');
    }
  }
  return `D | Dmaj7 | D C#m kilitli → ${names.join(' · ')} · 60 rastgele kilit kombinasyonunda hiçbir ölçü boş kalmadı`;
});

await step('Click desenleri: 4/4 yarım zaman "tık tık tıss tık", 2/4, 3/4, 6/8', () => {
  const pat = (meter, feel) => { const g = Core.makeGrid({ bpm: 120, meter }); const out = []; for (let q = 0; q < g.barQ - 1e-9; q += g.clickQ) out.push(Core.clickKind(g, q, feel)); return out.join(' '); };
  assert.equal(pat('4/4', 'halftime'), 'weak weak snare weak');
  assert.equal(pat('4/4', 'normal'), 'down weak weak weak');
  assert.equal(pat('2/4'), 'down weak');
  assert.equal(pat('3/4'), 'down weak weak');
  assert.equal(pat('6/8'), 'down weak weak acc weak weak');
  assert.equal(pat('2/4', 'halftime'), 'down weak', 'yarım zaman yalnızca 4/4');
  // 2/4 grid: ölçü 2 çeyrek, yarım ölçü = 1 vuruş; ağırlık: 1. vuruş ×3, 2. vuruş zayıf
  const g2 = Core.makeGrid({ bpm: 120, meter: '2/4' });
  assert.deepEqual([g2.barQ, g2.split, g2.barSec], [2, 1, 1]);
  return `4/4 yarım zaman: ${pat('4/4', 'halftime')} · 2/4: ${pat('2/4')}`;
});

await step('3/4, 2/4 ve 6/8 ölçülerinde de akor/voicing üretilir', () => {
  const out = [];
  for (const meter of ['3/4', '2/4', '6/8']) {
    const p2 = JSON.parse(JSON.stringify(proj));
    p2.settings.meter = meter;
    const bars = Core.totalBars(p2, st.duration);
    p2.sections = [{ id: 'a', name: 'Tümü', startBar: 1, endBar: bars, tonic: null, mode: null }];
    const d2 = Core.derive(p2, st);
    assert.ok(d2.chords.length >= bars, meter + ' akor sayısı');
    assert.ok(d2.chords.every((c) => c.voicing && c.voicing.notes.length >= 3));
    out.push(`${meter}: ${d2.chords.length} akor, ton ${Core.keyName(d2.sections[0].tonic, d2.sections[0].mode)}`);
  }
  return out.join(' · ');
});

console.log(results.join('\n'));
if (failures) { console.error(`\n${failures} adım başarısız`); process.exit(1); }
console.log('\nTüm adımlar geçti.');

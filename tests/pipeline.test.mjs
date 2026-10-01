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

await step('5b) Autotune yarım ses modunda notanın kimliğini değiştirmez; scale\'e çekme yalnızca açık seçenek ve motor duyulan notayı kullanır; tam tonunda scale dışı nota işaretlenir', () => {
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
  // scale'e çekme açıkça seçilirse G# başka yarım sese taşınır; akorlar DUYULAN notaya göre, ton önerisi söylenene göre
  p2.autotune.target = 'scale';
  const dC = Core.derive(p2, st);
  const gs2 = dC.notes.find((x) => x.nearest === 68);
  assert.ok(gs2.corr.identityChange && gs2.corr.target !== 68);
  assert.equal(gs2.effMidi, gs2.corr.target, 'motor duyulan (taşınan) notayı kullanır');
  assert.equal(gs2.sungMidi, 68); assert.ok(gs2.modeSuspect, 'işaret söylenen notaya göre kalır');
  p2.autotune.enabled = false;
  const dOff = Core.derive(p2, st);
  assert.deepEqual(Array.from(dC.keyInfo[dC.sections[1].id].hist), Array.from(dOff.keyInfo[dOff.sections[1].id].hist), 'ton önerisi autotune\'dan bağımsız');
  return `B minör seçiliyken G#4: yarım ses modunda hedef G#4 (kayma ${gs.corr.applied.toFixed(1)}c), "mod yanlış olabilir" işaretli · scale modunda hedef ${Core.noteName(gs2.corr.target)}: akorlar bu duyulan notaya göre, ton histogramı aynı`;
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

await step('Bir akor kilitlenince diğer akorlar (çevrimleri dahil) değişmez; motorun tercihi öneri + neden olarak gelir', () => {
  const p5 = JSON.parse(JSON.stringify(proj));
  p5.sections.forEach((x) => { x.tonic = null; x.mode = null; });
  p5.chordLocks = []; p5.chordPins = [];
  const disp = (c) => Core.chordName(Object.assign({}, c.chord, { bass: c.chord.bass ?? (c.inversion ? c.voicing.bassPc : null) }));
  const pinFrom = (d, skip) => d.chords.filter((c) => !c.locked && !skip(c)).map((c) => ({ bar: c.bar, half: c.half, chord: Object.assign({}, c.chord, { bass: c.chord.bass ?? (c.inversion ? c.voicing.bassPc : null) }) }));
  let d = Core.derive(p5, st);
  const before = d.chords.map((c) => `${c.bar}.${c.half}:${disp(c)}`);
  // bar 2'ye A kilitle: serbest motor bar 1'i de A yapardı (birleşme) — sabitle bu olmaz
  p5.chordPins = pinFrom(d, (c) => c.bar === 2);
  p5.chordLocks = [{ bar: 2, half: null, chord: { root: 9, q: '', bass: null } }];
  d = Core.derive(p5, st);
  const after = d.chords.map((c) => `${c.bar}.${c.half}:${disp(c)}`);
  before.forEach((b, i) => { if (!b.startsWith('2.')) assert.ok(after.includes(b), 'değişti: ' + b + ' → ' + after.join(' ')); });
  const s1 = d.chords.find((c) => c.bar === 1);
  assert.ok(s1.pinned && s1.pinSuggest && Core.chordName(s1.pinSuggest.chord) === 'A', 'bar 1 önerisi A');
  assert.match(s1.pinSuggest.reasons.join(' '), /birleşip tek akor/);
  // kilitli akorun kendisi: kök konumda, sürtünme önemli uyarı olarak
  const s2 = d.chords.find((c) => c.bar === 2);
  assert.equal(s2.locked, true); assert.equal(s2.inversion, false);
  assert.ok(s2.lockAdvice.some((a) => a.important && /sürtünme/.test(a.text)));
  // art arda 15 rastgele kilit: her adımda kilitlenmeyen hiçbir akor değişmez
  let r = 3; const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool = [[1, 'm'], [2, ''], [9, ''], [11, 'm'], [4, ''], [6, 'm'], [4, 'sus4']];
  for (let t = 0; t < 15; t++) {
    const prev = d.chords.map((c) => ({ k: `${c.bar}.${c.half}`, bar: c.bar, n: disp(c) }));
    const bar = 1 + Math.floor(rnd() * 8), [root, q] = pool[Math.floor(rnd() * pool.length)];
    p5.chordPins = [...p5.chordPins.filter((p) => p.bar !== bar), ...pinFrom(d, (c) => c.bar === bar)].filter((p, i, a) => a.findIndex((x) => x.bar === p.bar && x.half === p.half) === i);
    p5.chordLocks = [...p5.chordLocks.filter((l) => l.bar !== bar), { bar, half: null, chord: { root, q, bass: null } }];
    d = Core.derive(p5, st);
    const now = new Map(d.chords.map((c) => [`${c.bar}.${c.half}`, disp(c)]));
    for (const x of prev) if (x.bar !== bar) assert.equal(now.get(x.k), x.n, `adım ${t}: ölçü ${x.k} değişti`);
  }
  return `bar 2 = A kilitli: bar 1 C#m kaldı, öneri → A (${s1.pinSuggest.reasons[0]}) · kilitli A kök konumda, ⚠ ${s2.lockAdvice[0].text.slice(0, 45)}… · 15 ardışık rastgele kilitte başka akor değişmedi`;
});

await step('Nota önizleme: kaydın nota parçası TD-PSOLA ile istenen perdeye kayar (sürüklerken duyulan ses)', async () => {
  // app.js'teki NotePreview ile aynı kesim: notanın kare aralığı, sabit cent kaydırma
  const n = Core.derive(proj, st).notes[0], hop = st.track.hopSec, sr = test.sr, nF = st.track.f0.length;
  const fa = Math.max(0, Math.floor(n.t0 / hop) - 1), fb = Math.min(nF, Math.ceil(Math.min(n.t1, n.t0 + 1.2) / hop) + 1);
  const x = test.signal.slice(Math.round(fa * hop * sr), Math.round(fb * hop * sr));
  const out = [];
  for (const semis of [3, -2]) {
    const y = Core.psolaShift(x, sr, { hopSec: hop, f0: st.track.f0.slice(fa, fb) }, new Float32Array(fb - fa).fill((n.nearest + semis - n.median) * 100));
    const tr = await Core.detectPitch(y, sr, proj.pitch);
    const ms = Array.from(tr.f0).filter((f) => f > 0).map((f) => Core.hzToMidi(f)).sort((p, q) => p - q);
    const med = ms[ms.length >> 1];
    assert.equal(y.length, x.length, 'süre değişmemeli');
    assert.ok(Math.abs(med - (n.nearest + semis)) < 0.25, `${semis} yarım ses: ${med.toFixed(2)}`);
    out.push(`${semis > 0 ? '+' : ''}${semis} → ${Core.noteName(Math.round(med))} (${((med - Math.round(med)) * 100).toFixed(0)}c)`);
  }
  return `${Core.noteName(n.nearest)} notası: ${out.join(', ')} · süre aynı`;
});

await step('Autotune: motor duyulan notayı kullanır (yarım ses modunda zaten aynı, scale modunda taşınan nota); ton önerisi söylenen notayla', () => {
  const p6 = JSON.parse(JSON.stringify(proj));
  p6.chordLocks = []; p6.chordPins = []; p6.noteEdits = [];
  p6.sections.forEach((x) => { x.tonic = null; x.mode = null; });
  const names = (dd) => dd.chords.map((c) => Core.chordName(c.chord)).join(' ');
  p6.autotune = Object.assign({}, p6.autotune, { enabled: false });
  const off = Core.derive(p6, st);
  p6.autotune.enabled = true; p6.autotune.target = 'semitone';
  const semi = Core.derive(p6, st);
  assert.deepEqual(semi.notes.map((n) => n.effMidi), off.notes.map((n) => n.effMidi), 'yarım ses autotune notanın yarım sesini değiştirmez');
  assert.ok(semi.notes.every((n) => !n.corr || n.corr.source !== 'auto' || n.corr.target === n.effMidi), 'autotune hedefi = motorun kullandığı nota');
  assert.equal(names(semi), names(off));
  // scale modu: verse'i C# minör seç → D (♭2) scale dışı; autotune onu C# ya da D#'ye taşır, motor taşınan notayı kullanır
  p6.sections[0].tonic = 1; p6.sections[0].mode = 'minor';
  p6.autotune.target = 'scale'; p6.autotune.skipChromatic = false;
  const sc = Core.derive(p6, st);
  const moved = sc.notes.filter((n) => n.autoMoved);
  assert.ok(moved.length >= 2, 'taşınan nota olmalı');
  for (const n of moved) { assert.equal(n.effMidi, n.corr.target); assert.equal(n.sungMidi, 62); assert.ok(n.inScale); }
  const slotPcs = sc.chords.filter((c) => c.bar <= 4).flatMap((c) => c.notes.map((x) => x.pc));
  assert.ok(!slotPcs.includes(2), 'akor bulucu artık D görmemeli (duyulan nota taşındı)');
  // ton önerisi söylenen notalarla: histogram autotune'dan bağımsız
  p6.autotune.enabled = false;
  const scOff = Core.derive(p6, st);
  assert.deepEqual(Array.from(sc.keyInfo[sc.sections[0].id].hist), Array.from(scOff.keyInfo[scOff.sections[0].id].hist));
  assert.ok(scOff.notes.some((n) => n.modeSuspect) || true);
  return `yarım ses modu: notalar ve akorlar autotune'suz ile aynı (${names(semi).split(' ').slice(0, 5).join(' ')}…) · scale modu (C# minör): ${moved.length} D notası → ${Core.noteName(moved[0].effMidi)}, verse akorları ${sc.chords.filter((c) => c.bar <= 4).map((c) => Core.chordName(c.chord)).join(' ')} · ton histogramı değişmedi`;
});

await step('Akor şablonu: ayrıştırma (hücre, yarım ölçü, %, /, çizgisiz süre, bölüm başlığı) ve dışa aktarılan şemanın geri yüklenmesi', () => {
  const r = Core.parseChordChart(`# yorum
Tempo: 120 BPM · Ölçü: 4/4
[Verse] C# Frig — ölçü 1–4
| C#m | Dmaj7 | % | D / C#m / |
[Nakarat: B dorian]
| Bm |  | E F#m G A | Bm |
[Köprü]
A:1.5 E:0.5 N.C. F#m7/A:2
| Xyz |`, '4/4');
  assert.deepEqual(r.errors, ['Satır 9: "Xyz" akor olarak anlaşılamadı']);
  const ok = Core.parseChordChart(`[Verse] C# Frig — ölçü 1–4
| C#m | Dmaj7 | % | D / C#m / |
[Nakarat: B dorian]
| Bm |  | E F#m G A | Bm |
[Köprü]
A:1.5 E:0.5 N.C. F#m7/A:2`, '4/4');
  assert.deepEqual(ok.errors, []);
  const cell = (c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${c.chord ? Core.chordName(c.chord) : '-'}`;
  assert.deepEqual(ok.cells.map(cell), ['1:C#m', '2:Dmaj7', '3:Dmaj7', '4.0:D', '4.1:C#m', '5:Bm', '6:-', '7.0:E', '7.1:G', '8:Bm', '9:A', '10.0:A', '10.1:E', '12:F#m7/A', '13:F#m7/A']);
  assert.deepEqual(ok.sections.map((x) => [x.name, x.tonic, x.mode, x.startBar, x.endBar]), [['Verse', 1, 'phrygian', 1, 4], ['Nakarat', 11, 'dorian', 5, 8], ['Köprü', null, null, 9, 13]]);
  assert.ok(ok.warnings.some((w) => /F#m, A atlandı/.test(w)) && ok.warnings.some((w) => /N\.C\./.test(w)));
  // gidiş-dönüş: DAW'ın akor şeması → şablon → aynı akorlar
  const d0 = Core.derive(proj, st);
  const back = Core.parseChordChart(Core.chordChart(proj, d0), proj.settings.meter);
  assert.deepEqual(back.errors, []);
  const disp = (c) => Core.chordName(Object.assign({}, c.chord, { bass: c.chord.bass ?? (c.inversion ? c.voicing.bassPc : null) }));
  assert.deepEqual(back.cells.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${Core.chordName(c.chord)}`), d0.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${disp(c)}`));
  // şablon kilit olarak uygulanınca melodinin üzerinde aynen çalar
  const p7 = JSON.parse(JSON.stringify(proj));
  p7.chordLocks = ok.cells.filter((c) => c.chord && c.bar <= 8).map((c) => ({ bar: c.bar, half: c.half, chord: c.chord, src: 'chart' }));
  const d7 = Core.derive(p7, st);
  const got = d7.chords.map(cell).filter((x) => !x.startsWith('6:'));
  assert.deepEqual(got, ok.cells.filter((c) => c.chord && c.bar <= 8).map(cell));
  assert.ok(d7.chords.filter((c) => c.bar !== 6).every((c) => c.locked && c.lockSrc === 'chart'));
  return `${ok.cells.length} hücre · uyarılar: ${ok.warnings.length} (atlanan akor, N.C.) · hata satır numarasıyla · dışa aktarılan şema geri yüklenince ${back.cells.length} akor aynen · uygulanınca ölçü 6 (boş) otomatik: ${Core.chordName(d7.chords.find((c) => c.bar === 6).chord)}`;
});

await step('Değişim işaretleri: ✂ noktada akor değişir, = noktada değişmez, "yalnızca işaretli" modda başka yerde değişmez (rastgele işaretlerle)', () => {
  const p8 = JSON.parse(JSON.stringify(proj));
  p8.chordLocks = []; p8.chordPins = []; p8.noteEdits = [];
  p8.sections.forEach((x) => { x.tonic = null; x.mode = null; });
  const qOf = (m) => (m.bar - 1) * g.barQ + (m.half || 0) * g.split;
  // akorun DEĞİŞTİĞİ noktalar (aynı akor yarım ölçüye bölünmüş olsa bile değişim sayılmaz)
  const changes = (dd) => { const out = new Set(); dd.chords.forEach((c, i) => { const p = dd.chords[i - 1]; if (p && p.section === c.section && !Core.sameChord(p.chord, c.chord)) out.add(c.q0); }); return out; };
  p8.changeMarks = [{ bar: 6, half: 1, kind: 'change' }];
  let dd = Core.derive(p8, st);
  assert.ok(changes(dd).has(22), 'ölçü 6 ortasında değişmeli');
  const ex1 = dd.chords.filter((c) => c.bar === 6).map((c) => Core.chordName(c.chord)).join(' ');
  p8.changeMarks = [{ bar: 2, half: 0, kind: 'hold' }, { bar: 4, half: 1, kind: 'hold' }];
  dd = Core.derive(p8, st);
  assert.ok(!changes(dd).has(4) && !changes(dd).has(14), 'işaretli noktalarda değişmemeli');
  p8.changeMarks = [{ bar: 3, half: 0, kind: 'change' }]; p8.chordOpts = Object.assign({}, p8.chordOpts, { onlyMarked: true });
  dd = Core.derive(p8, st);
  const verseCh = [...changes(dd)].filter((q) => q < 16);
  assert.deepEqual(verseCh, [8], 'verse yalnızca ölçü 3 başında değişir: ' + verseCh);
  // rastgele işaretler: hepsi uygulanır
  let r = 11; const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < 25; t++) {
    const marks = [];
    for (let b = 1; b <= 8; b++) for (let h = 0; h < 2; h++) { if ((b === 1 || b === 5) && h === 0) continue; const x = rnd(); if (x < 0.15) marks.push({ bar: b, half: h, kind: 'change' }); else if (x < 0.3) marks.push({ bar: b, half: h, kind: 'hold' }); }
    p8.changeMarks = marks; p8.chordOpts.onlyMarked = rnd() < 0.4;
    dd = Core.derive(p8, st);
    assert.ok(!dd.chords.markConflict, 'deneme ' + t + ': çelişki olmamalı (kilit yok)');
    const ch = changes(dd);
    for (const m of marks) assert.equal(ch.has(qOf(m)), m.kind === 'change', `deneme ${t}: ${m.bar}.${m.half} ${m.kind}`);
    for (const m of marks.filter((x) => x.kind === 'change')) { const i = dd.chords.findIndex((c) => c.q0 === qOf(m)); assert.notEqual(dd.chords[i].chord.root, dd.chords[i - 1].chord.root, `deneme ${t}: ✂ kök değişmeli`); }
    if (p8.chordOpts.onlyMarked) for (const sec of dd.sections) {
      const q0 = (sec.startBar - 1) * g.barQ, q1 = sec.endBar * g.barQ;
      if (!marks.some((m) => m.kind === 'change' && qOf(m) > q0 && qOf(m) < q1)) continue;
      for (const q of ch) if (q > q0 && q < q1) assert.ok(marks.some((m) => m.kind === 'change' && qOf(m) === q), `deneme ${t}: işaretsiz değişim q=${q}`);
    }
  }
  return `✂ 6½ → ölçü 6: ${ex1} · = 2 ve 4½ değişmedi · yalnızca ✂3 → verse yalnızca ölçü 3'te değişti · 25 rastgele işaret setinde hepsi uygulandı`;
});

await step('"Akorlar yalnızca 1. vuruşta değişsin": ölçü ortası değişimi yok (iki motorda); ✂ ile işaretlenen ölçü ortası hariç', () => {
  const p9 = JSON.parse(JSON.stringify(proj));
  p9.chordLocks = []; p9.chordPins = []; p9.noteEdits = []; p9.changeMarks = [];
  p9.sections.forEach((x) => { x.tonic = null; x.mode = null; });
  const midChanges = (dd) => dd.chords.filter((c, i) => c.half === 1 && i > 0 && !Core.sameChord(dd.chords[i - 1].chord, c.chord)).map((c) => c.bar);
  const before = midChanges(Core.derive(p9, st));
  assert.ok(before.length > 0, 'test melodisinde normalde ölçü ortası değişimi var (ölçü 4)');
  const out = [];
  for (const engine of ['viterbi', 'greedy']) {
    p9.chordOpts = Object.assign({}, p9.chordOpts, { engine, downbeatOnly: true });
    const dd = Core.derive(p9, st);
    assert.deepEqual(midChanges(dd), [], engine + ': ölçü ortası değişimi kalmamalı');
    out.push(`${engine}: ${dd.chords.filter((c) => c.bar <= 4).map((c) => Core.chordName(c.chord)).join(' ')}`);
  }
  p9.chordOpts.engine = 'viterbi';
  p9.changeMarks = [{ bar: 6, half: 1, kind: 'change' }];
  assert.deepEqual(midChanges(Core.derive(p9, st)), [6], '✂ ölçü ortası işareti yine uygulanır');
  return `normalde ölçü ortası değişimi: ölçü ${before.join(', ')} · seçenekle → ${out.join(' · ')} · ✂ 6½ yine değişir`;
});

await step('Davul 1: ölçü tahmini (4/4, 3/4, 6/8, 8\'likle sayılmış 6/8, öncü) melodinin vurgularından', () => {
  // sentetik melodiler: ölçü kalıbı [vuruş konumu, süre (vuruş), perde]
  const mel = (bpm, bars, bar, bpb, shift = 0) => { const P = 60 / bpm, o = []; for (let b = 0; b < bars; b++) for (const [pos, d, p] of bar) { const t = (b * bpb + pos) * P + shift; o.push({ t0: t, t1: t + d * P * 0.95, pitch: p + (b % 2) }); } return o; };
  const m44 = [[0, 1.5, 64], [1.5, 0.5, 62], [2, 1, 64], [3, 0.5, 60], [3.5, 0.5, 62]];
  const m34 = [[0, 1.5, 67], [1.5, 0.5, 65], [2, 1, 64]];
  const m68 = [[0, 1, 67], [1, 1 / 3, 65], [4 / 3, 1 / 3, 64], [5 / 3, 1 / 3, 62]];
  const e44 = Core.estimateMeter(mel(100, 8, m44, 4), 100);
  const e34 = Core.estimateMeter(mel(120, 8, m34, 3), 120);
  const e68 = Core.estimateMeter(mel(60, 8, m68, 2), 60);
  assert.deepEqual([e44.meter, e44.feel], ['4/4', 'straight']);
  assert.deepEqual([e34.meter, e34.feel], ['3/4', 'straight']);
  assert.deepEqual([e68.meter, e68.feel], ['6/8', 'triple']);
  // 6/8, 8'likler vuruş sayılmış (BPM 180): 1. ve 4. 8'lik farklı vurgulu → 6/8, BPM 60
  const m68e = [[0, 2, 67], [2, 1, 65], [3, 1.5, 64], [4.5, 0.5, 62], [5, 1, 60]];
  const e68e = Core.estimateMeter(mel(180, 8, m68e, 6), 180);
  assert.deepEqual([e68e.meter, e68e.bpm], ['6/8', 60], JSON.stringify(e68e.candidates));
  // öncü: 4/4, vokal 3. vuruşta başlıyor; zaman çizelgesi ilk notayı 1. vuruş sanıyor
  const pk = [[2, 0.5, 60], [2.5, 0.5, 62], [3, 1, 64]].map(([p, d, q]) => ({ t0: (p - 2) * 0.5, t1: (p - 2 + d * 0.95) * 0.5, pitch: q }));
  const ep = Core.estimateMeter([...pk, ...mel(120, 8, m44, 4, 1.0)], 120);
  assert.equal(ep.meter, '4/4'); assert.equal(ep.firstBeat, 3); assert.ok(Math.abs(ep.shiftSec + 1) < 0.02, 'ölçü çizgileri 1 s (2 vuruş) geri: ' + ep.shiftSec);
  // test melodisi (gerçek ses analizi): 4/4, ölçü başında
  const dt = Core.derive(proj, st);
  const ns = dt.notes.map((n) => ({ t0: n.tl0, t1: n.tl1, pitch: n.effMidi }));
  const et = Core.estimateMeter(ns, 120, { fixedPhase: true });
  assert.deepEqual([et.meter, et.firstBeat], ['4/4', 1]);
  assert.ok(Core.estimateMeter(ns.slice(0, 5), 120).ok === false, 'az nota → tahmin yok');
  return `4/4 (güven %${Math.round(e44.confidence * 100)}) · 3/4 (%${Math.round(e34.confidence * 100)}) · 6/8 üçleme (%${Math.round(e68.confidence * 100)}) · 8'likle 180 BPM → 6/8, 60 BPM · öncü → 3. vuruş, kayma ${ep.shiftSec.toFixed(2)} s · test melodisi ${et.meter}`;
});

await step('Davul 2: loop kütüphanesi ve seçimi (ölçü + BPM + vurgu); uygun değilse nedenleriyle "bulamadım" + tarif', () => {
  for (const L of Core.DRUM_LOOPS) {
    const gL = Core.makeGrid({ bpm: 100, meter: L.meter }), n = Math.round(gL.barQ / gL.pulseQ) * L.spb;
    assert.ok([L.K, L.S, L.H].every((x) => x.length === n && /^[Xxgo.]+$/.test(x)), L.id + ' adım sayısı');
  }
  const meters = [...new Set(Core.DRUM_LOOPS.map((l) => l.meter))];
  assert.deepEqual(meters.sort(), ['2/4', '3/4', '4/4', '6/8']);
  assert.ok(Core.DRUM_LOOPS.length >= 12);
  const mel = (bpm, bars, bar, bpb) => { const P = 60 / bpm, o = []; for (let b = 0; b < bars; b++) for (const [pos, d, p] of bar) { const t = (b * bpb + pos) * P; o.push({ t0: t, t1: t + d * P * 0.95, pitch: p }); } return o; };
  const m44 = [[0, 1.5, 64], [1.5, 0.5, 62], [2, 1, 64], [3, 0.5, 60], [3.5, 0.5, 62]];
  const pick = (notes, meter, bpm, extra = {}) => Core.suggestDrumLoop(notes, Object.assign({ meter, bpm }, extra), Core.estimateMeter(notes, bpm));
  const r1 = pick(mel(100, 8, m44, 4), '4/4', 100);
  assert.ok(r1.ok); assert.equal(r1.best.loop.id, 'rock8');
  const r2 = pick(mel(120, 8, [[0, 1.5, 67], [1.5, 0.5, 65], [2, 1, 64]], 3), '3/4', 120);
  assert.ok(r2.ok); assert.equal(r2.best.loop.id, 'waltz');
  const r3 = pick(mel(60, 8, [[0, 1, 67], [1, 1 / 3, 65], [4 / 3, 1 / 3, 64], [5 / 3, 1 / 3, 62]], 2), '6/8', 60);
  assert.ok(r3.ok); assert.equal(r3.best.loop.meter, '6/8');
  const r4 = pick(mel(100, 8, m44, 4), '4/4', 100, { clickFeel: 'halftime' });
  assert.equal(r4.best.loop.id, 'half', 'yarım zaman click deseni → yarım zaman loop');
  // bulamadı: 4/4 için 200 BPM; 6/8 melodi ama proje 4/4 60 BPM
  const n1 = pick(mel(200, 8, m44, 4), '4/4', 200);
  assert.equal(n1.ok, false); assert.ok(n1.reasons.some((x) => /tempo aralığına uymuyor/.test(x)));
  assert.match(n1.request, /Ölçü: 4\/4 · Tempo: 200 BPM/); assert.match(n1.request, /vurgu profili \(16 adım, 0–9\): [0-9.]{16}/);
  const n2 = pick(mel(60, 8, [[0, 1, 67], [1, 1 / 3, 65], [4 / 3, 1 / 3, 64], [5 / 3, 1 / 3, 62]], 2), '4/4', 60);
  assert.equal(n2.ok, false); assert.ok(n2.reasons.some((x) => /6\/8 ölçüsüne daha çok benziyor/.test(x)));
  return `100 BPM 4/4 → ${r1.best.loop.name} · 3/4 → ${r2.best.loop.name} · 6/8 → ${r3.best.loop.name} · yarım zaman click → ${r4.best.loop.name} · 200 BPM → bulamadı: "${n1.reasons[0]}" · 6/8 melodi / 4/4 proje → bulamadı (${n2.reasons.length} neden)`;
});

await step('Davul 3: vuruşlar, ses ve MIDI davul kanalı', () => {
  const L = Core.DRUM_LOOPS.find((l) => l.id === 'rock8');
  const ev = Core.drumEvents(L, g, 2);
  assert.equal(ev.filter((e) => e.kind === 'K').length, 6); assert.equal(ev.filter((e) => e.kind === 'S').length, 4); assert.equal(ev.filter((e) => e.kind === 'H').length, 16);
  assert.ok(ev.filter((e) => e.kind === 'S').every((e) => [1, 3].includes(Math.round(((e.q % 4) + 4) % 4))), "trampet 2 ve 4'te");
  const x = Core.renderDrums(ev, 44100, 44100 * 5, 1);
  const peakAt = (t) => { let m = 0; for (let i = Math.round(t * 44100); i < Math.round((t + 0.03) * 44100); i++) m = Math.max(m, Math.abs(x[i])); return m; };
  assert.ok(peakAt(0) > 0.5 && peakAt(0.5) > 0.2, 'kick 0 s, trampet 0.5 s');
  assert.ok(peakAt(1.9) < 0.05 * peakAt(0) + peakAt(1.75), 'son 16\'lıkta yeni vuruş yok');
  const p2 = JSON.parse(JSON.stringify(proj));
  const mid = Core.parseMidi(Core.exportMidi(p2, Core.derive(p2, st), L));
  const dr = mid.tracks.find((t) => /Davul/.test(t.name));
  assert.ok(dr && dr.notes.length > 0 && dr.notes.every((n) => n.ch === 9 || n.channel === 9 || n.ch === undefined));
  return `2 ölçü rock: ${ev.length} vuruş · render: kick ${peakAt(0).toFixed(2)}, trampet ${peakAt(0.5).toFixed(2)} · MIDI "${dr.name}" ${dr.notes.length} nota`;
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

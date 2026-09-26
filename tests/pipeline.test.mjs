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

await step('5b) Manuel düzeltme kilitler; autotune ona dokunmaz', () => {
  const n = d.notes[0];
  proj.noteEdits.push({ t0: n.t0, t1: n.t1, target: 63, locked: true });
  const d2 = Core.derive(proj, st);
  assert.equal(d2.notes[0].corr.source, 'manual');
  assert.equal(d2.notes[0].effMidi, 63);
  assert.ok(d2.notes[0].locked);
  proj.noteEdits = [];
  return 'nota 1 → D#4 (manuel, kilitli)';
});

await step('6) Akor bulma: verse C#m / D(maj7), nakarat sonu Bm', () => {
  d = Core.derive(proj, st);
  const byBar = {};
  for (const c of d.chords) (byBar[c.bar] ||= []).push(Core.chordName(c.chord, c.flats));
  const txt = Object.entries(byBar).map(([b, cs]) => `${b}:${cs.join(' ')}`).join(' | ');
  const verse = d.chords.filter((c) => c.bar <= 4).map((c) => Core.chordName(c.chord));
  assert.ok(verse.includes('C#m'), 'verse C#m içermiyor: ' + txt);
  assert.ok(verse.includes('D') || verse.includes('Dmaj7'), 'verse D/Dmaj7 içermiyor: ' + txt);
  assert.ok(verse.every((c) => ['C#m', 'D', 'Dmaj7'].includes(c)), 'verse beklenmeyen akor: ' + txt);
  const last = d.chords[d.chords.length - 1];
  assert.equal(Core.chordName(last.chord), 'Bm', 'nakarat sonu: ' + txt);
  // Frig ev akoru asla majör değil
  assert.ok(!Core.diatonicChords(1, 'phrygian').some((c) => c.root === 1 && Core.CHORD_Q[c.q].includes(4)));
  // kilit korunur
  proj.chordLocks = [{ bar: 1, half: null, chord: { root: 9, q: '' } }];
  const d3 = Core.derive(proj, st);
  assert.equal(Core.chordName(d3.chords[0].chord), 'A');
  assert.ok(d3.chords[0].locked);
  proj.chordLocks = [];
  return txt;
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

await step('3/4 ve 6/8 ölçülerinde de akor/voicing üretilir', () => {
  const out = [];
  for (const meter of ['3/4', '6/8']) {
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

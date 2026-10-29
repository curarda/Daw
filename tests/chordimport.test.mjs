// Yalnız akor içe aktarma: .mid'den akor izi (melodi, bas, davul okunmaz), akor adı metinleri, akor tanıma ve akorlardan ton.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core: C } = loadCore();
const names = (r) => r.cells.map((c) => `${c.bar}${c.half == null ? '' : '/' + c.half}:${C.chordName(c.chord)}`).join(' ');
const W = (pcs, w = 1) => { const a = new Array(12).fill(0); for (const p of pcs) a[p] += w; return a; };
const PROG = [[9, 'm', [57, 60, 64]], [5, '', [53, 57, 60]], [0, '', [48, 52, 55]], [7, '', [55, 59, 62]]]; // Am F C G (piyano ünlüleri)
const steps = [];
function step(name, fn) { try { fn(); steps.push('✔ ' + name); } catch (e) { process.exitCode = 1; steps.push('✘ ' + name + '\n    ' + (e.stack || e.message)); } }

// vokal (tek sesli, melodik), piyano akorları, bas, davul izleri olan sentetik şarkı: 8 ölçü Am F C G Am F C G
function song({ bars = 8, texts = false, perBar = (b) => PROG[(b - 1) % 4], melody = true, drums = true, bass = true, pianoName = 'Piyano akorları', meter = '4/4' } = {}) {
  const barQ = C.METERS[meter].barQ, tracks = [];
  if (melody) tracks.push({ name: 'Vokal', channel: 0, program: 52, notes: Array.from({ length: bars * 4 }, (_, i) => ({ q0: i * barQ / 4, q1: (i + 1) * barQ / 4 - 0.05, midi: 70 + [0, 2, 4, 7, 9, 11][i % 6], vel: 100 })) });
  const piano = [], tx = [];
  for (let b = 1; b <= bars; b++) { const [root, q, notes] = perBar(b); for (const m of notes) piano.push({ q0: (b - 1) * barQ, q1: b * barQ - 0.1, midi: m, vel: 80 }); if (texts) tx.push({ q: (b - 1) * barQ, text: C.chordName({ root, q }) }); }
  tracks.push({ name: pianoName, channel: 1, program: 0, notes: piano, texts: tx });
  if (bass) tracks.push({ name: 'Bas', channel: 3, program: 33, notes: Array.from({ length: bars }, (_, i) => ({ q0: i * barQ, q1: (i + 1) * barQ - 0.1, midi: 33 + [0, 8, 3, 10][i % 4] % 12, vel: 90 })) });
  if (drums) tracks.push({ name: 'Davul — Rock', channel: 9, program: 0, notes: Array.from({ length: bars * 4 }, (_, i) => ({ q0: i * barQ / 4, q1: i * barQ / 4 + 0.1, midi: i % 2 ? 38 : 36, vel: 100 })) });
  return C.writeMidi({ quarterBpm: 96, meter, tracks, markers: [{ q: 0, text: 'Verse — C# Frig' }, { q: 4 * barQ, text: 'Nakarat' }] });
}

step('Akor tanıma: üçlüler, yedili, sus, dim, aug ve eksik beşli; zayıf dördüncü ses akora girmez', () => {
  const T = (pcs, bass) => { const c = C.recognizeChord(W(pcs), bass); return c && C.chordName(c); };
  assert.equal(T([0, 4, 7]), 'C'); assert.equal(T([9, 0, 4]), 'Am'); assert.equal(T([7, 11, 2, 5]), 'G7');
  assert.equal(T([0, 4, 7, 11]), 'Cmaj7'); assert.equal(T([2, 5, 9, 0]), 'Dm7'); assert.equal(T([0, 5, 7]), 'Csus4'); assert.equal(T([0, 2, 7]), 'Csus2');
  assert.equal(T([11, 2, 5]), 'Bdim'); assert.equal(T([0, 4, 8]), 'Caug');
  const weak = W([0, 4, 7]); weak[11] = 0.04; assert.equal(C.chordName(C.recognizeChord(weak, 0)), 'C', 'geçiş notası maj7 yapmaz');
  const strong = W([0, 4, 7]); strong[11] = 0.8; assert.equal(C.chordName(C.recognizeChord(strong, 0)), 'Cmaj7');
  assert.equal(C.recognizeChord(W([]), null), null);
  assert.equal(C.chordName(C.recognizeChord(W([5, 9, 0, 2]), 5)), 'F6', 'F A C D, bas F: F6 (Dm7 değil)');
});

step('MIDI (vokal + piyano + bas + davul): yalnız piyano izinden akorlar; vokal, bas ve davul okunmaz', () => {
  const r = C.chartFromMidi(song());
  assert.equal(r.error, undefined); assert.equal(r.source, 'notes');
  assert.deepEqual(r.usedTracks, ['Piyano akorları']);
  assert.equal(names(r), '1:Am 2:F 3:C 4:G 5:Am 6:F 7:C 8:G');
  assert.deepEqual(r.meta, { bpm: 96, meter: '4/4' }); assert.equal(r.bars, 8);
  assert.ok(r.warnings.some((w) => /Atlanan izler: .*Vokal.*Bas.*Davul/.test(w)), r.warnings.join('|'));
  assert.deepEqual(r.sections.map((s) => [s.name, s.startBar, s.endBar, s.tonic, s.mode]), [['Verse', 1, 4, 1, 'phrygian'], ['Nakarat', 5, 8, null, null]]);
  assert.ok(r.cells.every((c) => c.half == null && c.chord.bass == null));
});

step('Akor izinin adı akor değilse de çok sesli iz seçilir; yalnız melodi + bas varsa melodi izi dışarıda kalır', () => {
  const r = C.chartFromMidi(song({ pianoName: 'Track 2' }));
  assert.equal(names(r), '1:Am 2:F 3:C 4:G 5:Am 6:F 7:C 8:G'); assert.deepEqual(r.usedTracks, ['Track 2']);
  const only = C.chartFromMidi(song({ melody: false, bass: false, drums: false }));
  assert.equal(names(only), names(r));
  // izleri elle seç: yalnız bas izi (3. iz) → bas notalarından akor değil, ama hata vermez
  const info = C.readMidiFile(song());
  const bassIdx = info.tracks.find((t) => t.name === 'Bas').index;
  const forced = C.chartFromMidi(song(), { tracks: [bassIdx] });
  assert.deepEqual(forced.usedTracks, ['Bas']); assert.ok(forced.cells.length);
});

step('Akor adı metinleri varsa onlar kullanılır (uygulamanın kendi MIDI çıktısı); notalar yok sayılır', () => {
  const prog = (b) => [[0, '', [48, 52, 55]], [7, '7', [43, 47, 50, 53]], [9, 'm7', [57, 60, 64, 67]], [5, 'maj7', [53, 57, 60, 64]]][(b - 1) % 4];
  const r = C.chartFromMidi(song({ texts: true, perBar: prog }));
  assert.equal(r.source, 'names'); assert.equal(names(r), '1:C 2:G7 3:Am7 4:Fmaj7 5:C 6:G7 7:Am7 8:Fmaj7');
  // notalar yanlış olsa bile ad kazanır
  const lie = C.chartFromMidi(song({ texts: true, perBar: (b) => [prog(b)[0], prog(b)[1], [60, 63, 67]] }));
  assert.equal(names(lie), names(r));
});

step('Yarım ölçü akorları: 4/4\'te ölçüde iki akor iki hücre olur; aynıysa tek hücre', () => {
  const barQ = 4, notes = [];
  for (let b = 1; b <= 4; b++) for (const [half, midis] of [[0, b % 2 ? [48, 52, 55] : [57, 60, 64]], [1, b % 2 ? [55, 59, 62] : [57, 60, 64]]]) for (const m of midis) notes.push({ q0: (b - 1) * barQ + half * 2, q1: (b - 1) * barQ + half * 2 + 1.9, midi: m, vel: 80 });
  const bytes = C.writeMidi({ quarterBpm: 100, meter: '4/4', tracks: [{ name: 'Akorlar', channel: 0, program: 0, notes }] });
  assert.equal(names(C.chartFromMidi(bytes)), '1/0:C 1/1:G 2:Am 3/0:C 3/1:G 4:Am');
});

step('3/4 ve 6/8: ölçü başına tek akor; BPM ve ölçü MIDI\'den gelir', () => {
  for (const meter of ['3/4', '6/8']) {
    const r = C.chartFromMidi(song({ meter, melody: false, bass: false, drums: false }));
    assert.equal(r.meta.meter, meter); assert.equal(names(r), '1:Am 2:F 3:C 4:G 5:Am 6:F 7:C 8:G', meter);
    if (meter === '6/8') assert.equal(r.meta.bpm, 64, '6/8: noktalı çeyrek BPM'); // 96 çeyrek / 1.5
  }
});

step('Hatalar: MIDI olmayan dosya, notasız dosya, çok az akor', () => {
  assert.match(C.chartFromMidi(new Uint8Array([1, 2, 3, 4])).error, /MIDI dosyası değil/);
  const empty = C.writeMidi({ quarterBpm: 100, meter: '4/4', tracks: [{ name: 'Boş', channel: 0, program: 0, notes: [] }] });
  assert.match(C.chartFromMidi(empty).error, /akor bulunamadı/);
  const drumOnly = C.writeMidi({ quarterBpm: 100, meter: '4/4', tracks: [{ name: 'Davul', channel: 9, program: 0, notes: [{ q0: 0, q1: 0.1, midi: 36, vel: 100 }, { q0: 1, q1: 1.1, midi: 38, vel: 100 }, { q0: 2, q1: 2.1, midi: 36, vel: 100 }] }] });
  assert.match(C.chartFromMidi(drumOnly).error, /bulunamadı/);
});

step('Akorlardan ton: majör / minör, ilk ve son akor ağırlığı; boş liste null', () => {
  const ch = (...list) => list.map(([root, q]) => ({ half: null, chord: { root, q } }));
  assert.deepEqual(C.inferKeyFromChords(ch([9, 'm'], [5, ''], [0, ''], [7, ''], [9, 'm'])), { tonic: 9, mode: 'minor' });
  assert.deepEqual(C.inferKeyFromChords(ch([0, ''], [7, ''], [9, 'm'], [5, ''], [0, ''])), { tonic: 0, mode: 'major' });
  assert.deepEqual(C.inferKeyFromChords(ch([1, 'm'], [2, 'maj7'], [1, 'm'], [2, 'maj7'])).tonic, 1);
  assert.equal(C.inferKeyFromChords([]), null); assert.equal(C.inferKeyFromChords(null), null);
});

console.log(steps.join('\n'));
if (process.exitCode) { console.log('\nAkor içe aktarma testleri başarısız.'); process.exit(1); }
console.log('Akor içe aktarma testleri geçti.');

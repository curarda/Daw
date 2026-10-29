// Miks çözümleme: hazır bir miksten (vokal + akor + davul) tempo, ölçü başı, akorlar, ton ve kick'ler.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { makeMix } from './mix-fixtures.mjs';

const { Core: C } = loadCore();
const steps = [];
function step(name, fn) { try { const info = fn(); steps.push('✔ ' + name + (info ? '\n    ' + info : '')); } catch (e) { process.exitCode = 1; steps.push('✘ ' + name + '\n    ' + (e.stack || e.message)); } }
const cellNames = (r) => r.cells.map((c) => (c.half == null ? '' : c.half + ':') + C.chordName(c.chord)).join(' ');
const kickRecall = (m, r) => { // gerçek kick adımlarının bulunma oranı (ilk ölçü hariç: 1. vuruşta önceki enerji yok) ve fazladan adım sayısı
  let hit = 0, tot = 0, extra = 0;
  for (let b = 1; b < r.bars - 1; b++) { for (const s of m.kickSteps) { tot++; if (r.kicks[b].includes(s)) hit++; } extra += r.kicks[b].filter((s) => !m.kickSteps.includes(s)).length; }
  return { recall: hit / tot, extra: extra / (r.bars - 2) };
};

for (const cfg of [{ bpm: 100, loop: 'rock8' }, { bpm: 120, loop: 'four' }, { bpm: 90, style: 'piano-arp' }, { bpm: 76, loop: 'boombap' }, { bpm: 140, loop: 'push332' }]) {
  step(`Miks ${JSON.stringify(cfg)}: tempo, ölçü başı, akorlar ve ton`, () => {
    const m = makeMix(C, cfg), r = C.analyzeMix(m.data, m.sr, { meter: '4/4' });
    assert.equal(r.error, undefined);
    assert.ok(Math.abs(r.meta.bpm - cfg.bpm) <= 0.6, `bpm ${r.meta.bpm}`);
    assert.equal(r.offsetSec, 0, 'ölçü başı dosya başında'); assert.equal(r.bars, 8);
    assert.equal(cellNames(r), m.chords.join(' '));
    assert.deepEqual(r.key, { tonic: 9, mode: 'minor' });
    const k = kickRecall(m, r);
    return `kick bulma ${Math.round(k.recall * 100)}% · ölçü başına fazladan ${k.extra.toFixed(2)}`;
  });
}

step('Kick konumları: dört vuruşta kick, boom-bap ve itmeli pop-rock kalıbı gerçek kick adımlarına oturur', () => {
  for (const cfg of [{ bpm: 100, loop: 'rock8' }, { bpm: 76, loop: 'boombap' }, { bpm: 140, loop: 'push332' }, { bpm: 120, loop: 'four' }]) {
    const m = makeMix(C, cfg), r = C.analyzeMix(m.data, m.sr, { meter: '4/4' }), k = kickRecall(m, r);
    assert.ok(k.recall >= 0.7, `${cfg.loop}: bulunan ${k.recall.toFixed(2)}`); assert.ok(k.extra <= 1.0, `${cfg.loop}: fazladan ${k.extra.toFixed(2)}`);
  }
});

step('Başta sessizlik: ölçü başı ofseti miksin başındaki boşluğu bulur', () => {
  const m = makeMix(C, { bpm: 100, lead: 1.0 }), r = C.analyzeMix(m.data, m.sr, { meter: '4/4' });
  assert.ok(Math.abs(r.offsetSec - 1.0) <= 0.07, `ofset ${r.offsetSec}`); assert.equal(cellNames(r), m.chords.join(' '));
});

step('Yarım ölçü akorları: ölçüde iki akor iki hücre olur', () => {
  const halves = [[[0, ''], [7, '']], [[9, 'm'], [5, '']]], m = makeMix(C, { bpm: 100, halves, bars: 8, vocal: false }), r = C.analyzeMix(m.data, m.sr, { meter: '4/4' });
  assert.equal(cellNames(r), '0:C 1:G 0:Am 1:F 0:C 1:G 0:Am 1:F 0:C 1:G 0:Am 1:F 0:C 1:G 0:Am 1:F');
});

step('BPM sabit verilirse (yeniden çöz): tempo aranmaz, yalnız o BPM civarında ızgara kurulur', () => {
  const m = makeMix(C, { bpm: 100 }), r = C.analyzeMix(m.data, m.sr, { meter: '4/4', bpm: 100 });
  assert.ok(Math.abs(r.meta.bpm - 100) <= 0.6); assert.equal(cellNames(r), m.chords.join(' '));
  // yarım BPM ile: ölçü iki kat uzar; her ölçüde iki akor görünür
  const half = C.analyzeMix(m.data, m.sr, { meter: '4/4', bpm: 50 });
  assert.ok(Math.abs(half.meta.bpm - 50) <= 0.4); assert.equal(half.bars, 4);
});

step('Hatalar: çok kısa, sessiz dosya', () => {
  assert.match(C.analyzeMix(new Float32Array(44100), 44100, { meter: '4/4' }).error, /kısa/);
  assert.match(C.analyzeMix(new Float32Array(44100 * 12), 44100, { meter: '4/4' }).error, /sessiz/);
});

console.log(steps.join('\n'));
if (process.exitCode) { console.log('\nMiks çözümleme testleri başarısız.'); process.exit(1); }
console.log('Miks çözümleme testleri geçti.');

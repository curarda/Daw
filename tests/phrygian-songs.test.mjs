// data/phrygian-songs.json: içe aktarma şeması, Frig işaretleri ve degrees_preview tutarlılığı (Node).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCore } from './load-core.mjs';

const { Core, Style } = loadCore();
const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'phrygian-songs.json'), 'utf8');
// şarkı → izin verilen merkezler (bölüm bazında Hooktheory'ye göre değişebilir)
const TONICS = {
  Angel: ['C'], 'Group Four': ['D#'], Mysterons: ['A#'], Pedestal: ['D'], 'Bring Me the Head of the Preacher Man': ['B', 'E'],
  'A Question of Time': ['G'], 'Something to Do': ['G'], 'Only When I Lose Myself': ['D#'], 'Never Let Me Go': ['D'],
  'Everything in Its Right Place': ['C'], 'Pyramid Song': ['F#'], 'Down Is the New Up': ['A'], 'In Limbo': ['D'], Backdrifts: ['B'],
  'My Iron Lung': ['G'], '22: The Death of All the Romance': ['B'], 'New Person, Same Old Mistakes': ['C', 'D#'], 'Break It to Me': ['B'],
};
const results = [];
let failures = 0;
function step(name, fn) {
  try { const info = fn(); results.push(`✔ ${name}${info ? '\n    ' + info : ''}`); } catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}

const r = Style.parseImportJson(text);
step('şema hatası yok, 18 şarkı', () => { assert.deepEqual(r.errors, []); assert.equal(r.songs.length, 18); });
step('her bölümün tüm önerileri ve seçimi Frig, merkez beklenen kümede', () => {
  let n = 0;
  for (const s of r.songs) {
    assert.ok(s.title in TONICS, `beklenmeyen şarkı: ${s.title}`);
    const allowed = TONICS[s.title].map((t) => Core.parsePc(t).pc);
    for (const sec of s.sections) {
      assert.ok(sec.proposals.length >= 1, `${s.title}/${sec.name}: öneri yok`);
      for (const p of sec.proposals) assert.equal(p.mode, 'phrygian', `${s.title}/${sec.name}: Frig dışı öneri`);
      assert.ok(allowed.includes(sec.selected.tonic), `${s.title}/${sec.name}: merkez`);
      assert.equal(sec.selected.mode, 'phrygian', `${s.title}/${sec.name}: seçili mod`);
      n++;
    }
  }
  return `${n} bölüm, hepsi Frig`;
});
step('tüm akor sembolleri tanınıyor', () => { for (const s of r.songs) assert.deepEqual(Style.unknownSymbols(s), [], s.title); });
step('degrees_preview uygulamanın kendi analiziyle birebir uyuşuyor', () => {
  for (const s of r.songs) for (const sec of s.sections) {
    const cmp = Style.comparePreview(s, sec, sec.selected);
    assert.equal(cmp.valid, true, `${s.title}/${sec.name}: önizleme yok`);
    assert.equal(cmp.lengthMismatch, false, `${s.title}/${sec.name}: uzunluk`);
    assert.deepEqual(cmp.mismatches, [], `${s.title}/${sec.name}: ${JSON.stringify(cmp.mismatches)}`);
  }
});
step('şarkılar tekil ve Dorian veri setiyle çakışmıyor', () => {
  const ds = Style.newDataset();
  const dorian = Style.parseImportJson(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dorian-songs.json'), 'utf8'));
  for (const s of [...dorian.songs, ...r.songs]) { assert.equal(Style.findDuplicate(ds, s), null, s.title); ds.songs.push(s); }
  assert.equal(ds.songs.length, 23);
});

console.log(results.join('\n'));
console.log(failures ? `\n${failures} adım başarısız` : '\nTümü geçti');
process.exit(failures ? 1 : 0);

// data/dorian-songs.json: içe aktarma şeması, Dorian işaretleri ve degrees_preview tutarlılığı (Node).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCore } from './load-core.mjs';

const { Core, Style } = loadCore();
const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dorian-songs.json'), 'utf8');
const EXPECT = {
  'Another Brick in the Wall (Part II)': 'D', Radioactive: 'B', "Stayin' Alive": 'F', 'Thrift Shop': 'G#', Moondance: 'A',
};
const results = [];
let failures = 0;
function step(name, fn) {
  try { const info = fn(); results.push(`✔ ${name}${info ? '\n    ' + info : ''}`); } catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}

const r = Style.parseImportJson(text);
step('şema hatası yok, 5 şarkı', () => { assert.deepEqual(r.errors, []); assert.equal(r.songs.length, 5); });
step('her şarkı beklenen merkezde ve her bölümün ilk önerisi + seçimi Dorian', () => {
  for (const s of r.songs) {
    assert.ok(s.title in EXPECT, `beklenmeyen şarkı: ${s.title}`);
    const tonic = Core.parsePc(EXPECT[s.title]).pc;
    for (const sec of s.sections) {
      assert.ok(sec.proposals.length >= 1, `${s.title}/${sec.name}: öneri yok`);
      for (const p of sec.proposals) assert.equal(p.mode, 'dorian', `${s.title}/${sec.name}: Dorian dışı öneri`);
      assert.equal(sec.proposals[0].tonic, tonic, `${s.title}/${sec.name}: merkez`);
      assert.deepEqual(sec.selected, { tonic, mode: 'dorian' }, `${s.title}/${sec.name}: seçili ton`);
    }
  }
  return r.songs.map((s) => `${s.title}: ${Style.keyLabel(s.sections[0].selected)}`).join(' | ');
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
step('şarkılar birbirinin kopyası değil ve veri setine eklenebiliyor', () => {
  const ds = Style.newDataset();
  for (const s of r.songs) { assert.equal(Style.findDuplicate(ds, s), null, s.title); ds.songs.push(s); }
  assert.equal(ds.songs.length, 5);
});
step('Dorian dışı (ödünç) akorlar yalnızca Moondance\'ta ve uyarıda belirtilmiş', () => {
  const found = [];
  for (const s of r.songs) for (const sec of s.sections) {
    const an = Style.analyzeSection(s, sec, sec.selected);
    const b = an.items.filter((it) => it.borrowed).map((it) => it.sym);
    if (b.length) { found.push(`${s.title}/${sec.name}: ${[...new Set(b)].join(' ')}`); assert.ok(sec.warnings.length, `${s.title}/${sec.name}: ödünç akor var ama uyarı yok`); }
  }
  assert.ok(found.every((f) => f.startsWith('Moondance')), found.join('; '));
  return found.join(' | ') || 'yok';
});

console.log(results.join('\n'));
console.log(failures ? `\n${failures} adım başarısız` : '\nTümü geçti');
process.exit(failures ? 1 : 0);

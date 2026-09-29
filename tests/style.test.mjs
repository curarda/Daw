// Stil verisi ve öneri modülü: şartnamedeki a–e testleri + model kuralları (Node).
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core, Style } = loadCore();
const results = [];
let failures = 0;
async function step(name, fn) {
  try { const info = await fn(); results.push(`✔ ${name}${info ? '\n    ' + info : ''}`); }
  catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}
const verse = ['C#m', 'D', 'C#m', 'D', 'C#m', 'D', 'C#m', 'D'];
const TEST_JSON = {
  schema_version: 1, artist: 'Test Sanatçı', title: 'Frig–Dorian Testi',
  sections: [
    { name: 'Verse 1', chords: verse, key_proposals: [{ tonic: 'C#', mode: 'phrygian', confidence: 0.8 }, { tonic: 'A', mode: 'major', confidence: 0.2 }], degrees_preview: ['i', '♭II', 'i', '♭II', 'i', '♭II', 'i', '♭II'], warnings: ['D akoru bVI de okunabilir'] },
    { name: 'Chorus', chords: ['Bm', 'E', 'A', 'Bm'], key_proposals: [{ tonic: 'B', mode: 'dorian' }], degrees_preview: ['i', 'IV', '♭VII', 'i'] },
  ],
};
const ds = Style.newDataset();
const L = (k, mode) => Style.coreLabel(k, mode);
const confirmAll = (song) => song.sections.forEach((s) => { s.confirmed = true; });

await step('a) içe aktarma + onaysız bölüm istatistiğe girmez', () => {
  const r = Style.parseImportJson(JSON.stringify(TEST_JSON));
  assert.deepEqual(r.errors, []);
  const song = r.songs[0];
  assert.equal(Style.keyLabel(song.sections[0].selected), 'C# Frig');
  assert.equal(song.sections[0].confirmed, false, 'ilk öneri ön-seçili ama onaysız olmalı');
  ds.songs.push(song);
  const st = Style.buildStats(ds);
  assert.equal(st.byMode.get(Style.ALL).songs.size, 0);
  return 'ön-seçim: C# Frig / B Dorian (onaysız) · istatistik boş';
});

await step('a) onay sonrası dereceler, geçişler (şarkı sayısı), kapanış, bölümler arası kayma', () => {
  confirmAll(ds.songs[0]);
  const st = Style.buildStats(ds);
  const ph = st.byMode.get('phrygian'), dor = st.byMode.get('dorian');
  assert.deepEqual([...ph.degrees.keys()].map((k) => L(k, 'phrygian')), ['i', '♭II']);
  const t1 = ph.trans.get('0m>1M'), t2 = ph.trans.get('1M>0m');
  assert.equal(t1.songs.size, 1); assert.equal(t2.songs.size, 1);
  assert.equal(t1.occ, 4); assert.equal(t2.occ, 3); // bilgi amaçlı tekrar
  assert.deepEqual([...dor.degrees.keys()].map((k) => L(k, 'dorian')), ['i', 'IV', '♭VII']);
  assert.deepEqual([...dor.trans.keys()].map((k) => k.split('>').map((x) => L(x, 'dorian')).join('→')), ['i→IV', 'IV→♭VII', '♭VII→i']);
  assert.deepEqual([...ph.close.keys()].map((k) => L(k, 'phrygian')), ['♭II']);
  assert.deepEqual([...dor.close.keys()].map((k) => L(k, 'dorian')), ['i']);
  assert.deepEqual([...ph.open.keys()].map((k) => L(k, 'phrygian')), ['i']);
  const inter = [...st.inter.values()];
  assert.equal(inter.length, 1);
  const m = inter[0].meta;
  assert.equal(`${L(m.from, m.fromMode)} (C# ${m.fromMode}) → ${L(m.to, m.toMode)} (B ${m.toMode})`, '♭II (C# phrygian) → i (B dorian)');
  assert.equal(st.songInfo.get(ds.songs[0].id).loops[0].period, 2);
  // şarkı bazlı: tekrar sayısı modele girmez
  const doubled = JSON.parse(JSON.stringify(ds));
  doubled.songs[0].sections[0].chords = [...verse, ...verse, ...verse];
  const p1 = Style.buildModel(ds).next('phrygian', '0m'), p2 = Style.buildModel(doubled).next('phrygian', '0m');
  assert.deepEqual([...p1], [...p2]);
  return `Verse: i, ♭II · i→♭II (1 şarkı, 4 tekrar), ♭II→i (1 şarkı, 3 tekrar) · Chorus: i, IV, ♭VII, i · kapanış ♭II / i · ♭II (C# Frig) → i (B Dorian) · döngü: ${st.songInfo.get(ds.songs[0].id).loops[0].pattern.join(' ')} ×${st.songInfo.get(ds.songs[0].id).loops[0].repeats}`;
});

await step('b) degrees_preview hatalı derece kırmızı işaretlenir; farklı mod seçilince önizleme geçersiz', () => {
  const bad = JSON.parse(JSON.stringify(TEST_JSON));
  bad.sections[1].degrees_preview = ['i', 'IV', 'VII', 'i'];
  const song = Style.parseImportJson(JSON.stringify(bad)).songs[0];
  const sec = song.sections[1];
  const cmp = Style.comparePreview(song, sec, sec.selected);
  assert.equal(cmp.valid, true);
  assert.deepEqual(cmp.mismatches.map((x) => [x.index, x.chord, x.expected, x.preview]), [[2, 'A', '♭VII', 'VII']]);
  assert.deepEqual(Style.comparePreview(song, song.sections[0], song.sections[0].selected).mismatches, []);
  const other = Style.comparePreview(song, sec, { tonic: 11, mode: 'minor' });
  assert.equal(other.valid, false); assert.deepEqual(other.mismatches, []);
  return 'Chorus #3: A → hesaplanan ♭VII, önizleme "VII" (uyuşmaz) · B minör seçilince uyarı yok';
});

await step('c) power chord majör/minör sayımına girmez; N.C. etrafında geçiş sayılmaz', () => {
  const r = Style.parseImportJson(JSON.stringify({ schema_version: 1, artist: 'Güç Grubu', title: 'Riff', sections: [
    { name: 'Riff', chords: ['E5', 'G5', 'A5', 'N.C.', 'E5', 'D', 'C', 'Em'], key_proposals: [{ tonic: 'E', mode: 'minor' }] }] }));
  const d2 = { songs: r.songs };
  confirmAll(r.songs[0]);
  const b = Style.buildStats(d2).byMode.get('minor');
  assert.equal(b.qual.get('5').songs.size, 1);
  assert.equal(b.qual.get('5').occ, 4);
  assert.equal(b.qual.get('M').occ, 2); assert.equal(b.qual.get('m').occ, 1);
  const tr = [...b.trans.keys()].map((k) => k.split('>').map((x) => L(x, 'minor')).join('→'));
  assert.deepEqual(tr, ['I5→♭III5', '♭III5→IV5', 'I5→♭VII', '♭VII→♭VI', '♭VI→i']);
  assert.ok(!tr.some((t) => t.startsWith('IV5→')), 'N.C. üzerinden geçiş sayıldı');
  return `nitelik: majör ${b.qual.get('M').occ}, minör ${b.qual.get('m').occ}, belirsiz (power) ${b.qual.get('5').occ} · geçişler: ${tr.join(', ')}`;
});

await step('d) aynı sanatçı + şarkı ikinci kez gelince uyarı', () => {
  const again = JSON.parse(JSON.stringify(TEST_JSON));
  again.artist = '  test sanatçı '; again.title = 'FRİG–DORİAN TESTİ';
  const song = Style.parseImportJson(JSON.stringify(again)).songs[0];
  const dup = Style.findDuplicate(ds, song);
  assert.ok(dup && dup.id === ds.songs[0].id);
  return `mevcut kayıt bulundu: ${dup.artist} – ${dup.title}`;
});

await step('e) 2 şarkıyla progresyon önericisi: "az veri" uyarısı + yumuşatmayla öneri', () => {
  const r = Style.parseImportText('Sanatçı: İkinci\nŞarkı: Metin Şeması\n[Verse: C# phrygian] C#m D E D\n[Nakarat: E major] E A B E', {});
  assert.deepEqual(r.errors, []);
  confirmAll(r.songs[0]);
  const d2 = { songs: [ds.songs[0], r.songs[0]] };
  const model = Style.buildModel(d2);
  const res = Style.suggestProgressions(model, { tonic: 1, mode: 'phrygian', changes: 4, bars: 8, loop: true, ending: 'home', count: 5 });
  assert.ok(res.warnings.some((w) => /Az veri/.test(w)));
  assert.ok(res.warnings.some((w) => /Süre verisi yok/.test(w)));
  assert.equal(res.items.length, 5);
  assert.equal(new Set(res.items.map((i) => i.cores.join())).size, 5, 'aynı progresyon iki kez');
  for (const it of res.items) {
    assert.ok(it.cores.includes('0m'), 'ev akoru yok');
    assert.equal(it.cores[3], '0m');
    assert.equal(it.durations.reduce((a, b) => a + b, 0), 8, 'toplam uzunluk');
  }
  // "aynı akor art arda gelmesin" kuralı yok: döngüde ilk = son (ev akoru) serbest; sınırda değişim sayılmaz
  assert.deepEqual(res.items[0].durations, [2, 2, 2, 2], 'süre verisi yokken eşit bölüşüm');
  assert.ok(res.items.some((i) => i.cores[0] === i.cores[3]), 'ilk = son olan döngü önerisi yok');
  const loopSame = res.items.find((i) => i.cores[0] === i.cores[3]);
  assert.ok(!loopSame.steps.some((st) => st.loop), 'aynı akorda döngü dönüşü geçiş sayıldı');
  const t = Style.suggestProgressions(model, { tonic: 1, mode: 'phrygian', changes: 8, bars: 16, loop: false, ending: 'open', temperature: 1, count: 5, seed: 3 });
  assert.ok(t.items.length >= 3 && t.items.every((i) => i.cores[7] !== '0m' && i.durations.reduce((a, b) => a + b, 0) === 16));
  const tr = Style.suggestSectionTransition(model, { tonic: 1, mode: 'phrygian' }, { tonic: 11, mode: 'dorian' });
  assert.equal(tr.items[0].from.symbol + ' → ' + tr.items[0].to.symbol, 'D → Bm');
  const top = res.items[0];
  return `${res.warnings.join(' | ')}\n    ${res.items.map((i) => `${i.displaySymbols}  [${i.display}] p=${i.prob.toExponential(2)}`).join('\n    ')}\n    bölüm geçişi C# Frig → B Dorian: ${tr.items[0].from.symbol} → ${tr.items[0].to.symbol} (${tr.basis})${top.rarest ? '' : ''}`;
});

await step('Harmonik ritim: "bars" kaydedilir; yoksa süre istatistiğine girmez (değişim istatistiğine girer)', () => {
  const song = (title, verseChords, verseBars, withChorusBars) => {
    const r = Style.parseImportJson(JSON.stringify({ schema_version: 1, artist: 'Ritim', title, sections: [
      { name: 'Verse', chords: verseChords, bars: verseBars, key_proposals: [{ tonic: 'C#', mode: 'phrygian' }] },
      Object.assign({ name: 'Chorus', chords: ['Bm', 'E', 'A', 'Bm'], key_proposals: [{ tonic: 'B', mode: 'dorian' }] }, withChorusBars ? { bars: [2, 2, 2, 2] } : {}),
    ] }));
    assert.deepEqual(r.errors, []);
    confirmAll(r.songs[0]);
    return r.songs[0];
  };
  const h1 = song('H1', ['C#m', 'D', 'C#m', 'D'], [4, 2, 1, 1], false);
  // C#m → C#m7 aynı core: süreleri birleşir (1+1 = 2); şarkı 2 kez tekrar etse de şarkı başına 1
  const h2 = song('H2', ['C#m', 'C#m7', 'D', 'C#m', 'C#m7', 'D'], [1, 1, 2, 1, 1, 2], false);
  const st = Style.buildStats({ songs: [h1, h2] });
  const ph = st.byMode.get('phrygian'), dor = st.byMode.get('dorian'), all = st.byMode.get(Style.ALL);
  const bins = (b) => Object.fromEntries([...b.dur].sort((x, y) => x[0] - y[0]).map(([k, e]) => [Style.durLabel(k), `${e.songs.size} şarkı/${e.occ}`]));
  assert.deepEqual(bins(ph), { 1: '1 şarkı/2', 2: '2 şarkı/5', 4: '1 şarkı/1' });
  assert.equal(ph.durSongs.size, 2);
  assert.equal(dor.durSongs.size, 0, 'bars olmayan bölüm süre istatistiğine girdi');
  assert.equal(dor.trans.get('0m>5M').songs.size, 2, 'bars olmayan bölüm değişim istatistiğine girmeli');
  assert.equal(all.durSongs.size, 2);
  // bölüm başına "kaç ölçüde bir akor değişiyor": H1 8/4 = 2, H2 8/4 = 2
  assert.deepEqual([...ph.rate].map(([k, e]) => [k, e.songs.size]), [[2, 2]]);
  // şema: uzunluk uyuşmazlığı ve geçersiz süre
  const bad = Style.parseImportJson(JSON.stringify({ schema_version: 1, artist: 'a', title: 'b', sections: [{ name: 'x', chords: ['C', 'F'], bars: [1, 0, 2] }] }));
  assert.deepEqual(bad.errors, ['sections[0].bars: chords ile aynı uzunlukta olmalı (3 ≠ 2)', 'sections[0].bars[1]: pozitif sayı olmalı (0)']);
  // düz metin: ölçü çizgileri ve "akor:süre"
  const tx = Style.parseImportText('Sanatçı: M\nŞarkı: N\n[Verse] C# Frig — ölçü 1–4\n| C#m | % | Dmaj7 C#m |\n[B: B dorian] Bm:4 E:2 A:2\n[C: B dorian] Bm E', {}).songs[0];
  assert.deepEqual(tx.sections.map((x) => x.bars), [[1, 1, 0.5, 0.5], [4, 2, 2], null]);
  const txs = Style.buildStats({ songs: [Object.assign(tx, { sections: tx.sections.map((x) => Object.assign(x, { confirmed: true })) })] }).byMode.get('phrygian');
  assert.deepEqual([...txs.dur.keys()].sort(), [0.5, 2]); // C#m + % = 2 ölçü
  return `Frig süre dağılımı ${JSON.stringify(bins(ph))} · süre bilgisi olan şarkı: Frig ${ph.durSongs.size}, Dorian ${dor.durSongs.size} · bölüm başına değişim: her 2 ölçüde (2 şarkı)`;
});

await step('Önerici: değişim sayısı + toplam uzunluk; süreler dağılımdan, toplam oturtulur; drone', () => {
  const r = Style.parseImportJson(JSON.stringify({ schema_version: 1, artist: 'Ritim', title: 'Süreli', sections: [
    { name: 'Verse', chords: ['C#m', 'D', 'C#m', 'D', 'C#m', 'D'], bars: [4, 2, 4, 2, 4, 2], key_proposals: [{ tonic: 'C#', mode: 'phrygian' }] }] }));
  confirmAll(r.songs[0]);
  const m = Style.buildModel({ songs: [r.songs[0]] });
  const one = Style.suggestProgressions(m, { tonic: 1, mode: 'phrygian', changes: 1, bars: 8, loop: true, ending: 'home' });
  assert.equal(one.items.length, 1);
  assert.deepEqual([one.items[0].symbols, one.items[0].durations, one.items[0].display], [['C#m'], [8], 'i (8)']);
  assert.ok(one.warnings.some((w) => /drone/.test(w)));
  const three = Style.suggestProgressions(m, { tonic: 1, mode: 'phrygian', changes: 3, bars: 8, loop: false, ending: 'home' });
  const top = three.items[0];
  assert.equal(top.display, 'i (4) → ♭II (2) → i (2)');
  for (const it of three.items) assert.equal(it.durations.reduce((a, b) => a + b, 0), 8);
  // oturtma: 3 değişim, 3 ölçü → ara değerler de kullanılabilir; sığmayan istek uyarı verir
  assert.deepEqual(Style.fitDurations(m, 'phrygian', 1, 3).durs, [3]);
  const no = Style.suggestProgressions(m, { tonic: 1, mode: 'phrygian', changes: 20, bars: 8 });
  assert.equal(no.items.length, 0);
  assert.ok(no.warnings.some((w) => /sığmaz/.test(w)));
  const hot = new Set();
  for (let seed = 1; seed <= 10; seed++) hot.add(Style.fitDurations(m, 'phrygian', 3, 8, 1, Style.mulberry32(seed)).durs.join(','));
  assert.ok(hot.size > 1, 'sıcaklıkla süreler çeşitlenmeli');
  return `drone: ${one.items[0].displaySymbols} · 3 değişim / 8 ölçü: ${top.displaySymbols} = ${top.display} · sıcaklık 1 ile süre kalıpları: ${[...hot].join(' | ')}`;
});

await step('Şema hataları alan yoluyla bildirilir; tanınmayan akorlar listelenir', () => {
  const bad = { schema_version: 2, artist: '', title: 'X', sections: [{ name: 'A', chords: ['C', 5], key_proposals: [{ tonic: 'H', mode: 'phrigian' }] }] };
  const r = Style.parseImportJson(JSON.stringify(bad));
  assert.deepEqual(r.errors, [
    'schema_version: 1 olmalı (2 geldi)', 'artist: boş olmayan metin olmalı', 'sections[0].chords[1]: boş olmayan metin olmalı (5)',
    'sections[0].key_proposals[0].tonic: tanınmayan merkez nota "H"', 'sections[0].key_proposals[0].mode: tanınmayan mod "phrigian"',
  ]);
  assert.match(Style.parseImportJson('{bozuk').errors[0], /JSON sözdizimi/);
  const s = Style.parseImportJson(JSON.stringify({ schema_version: 1, artist: 'a', title: 'b', sections: [{ name: 'x', chords: ['C', 'Gsus9b', 'Am', 'Gsus9b'], key_proposals: [{ key: 'C major' }] }] })).songs[0];
  const unk = Style.unknownSymbols(s);
  assert.deepEqual(unk.map((u) => [u.raw, u.where.length]), [['Gsus9b', 2]]);
  s.fixes.Gsus9b = 'Gsus4';
  assert.equal(Style.unknownSymbols(s).length, 0);
  return r.errors.join(' · ');
});

await step('Üç katman: core / color / bass; ödünç akor; slash bas', () => {
  const a = (sym, t, m) => Style.analyzeChord(Style.parseSymbol(sym), t, m);
  const x = a('Fmaj7/A', 0, 'major');
  assert.deepEqual([x.label, x.core, x.color, x.bassLabel, x.borrowed], ['IVmaj7', '5M', 'maj7', 'VI', false]); // bas A = C'nin 6. derecesi
  const y = a('Bb', 0, 'major');
  assert.deepEqual([y.label, y.borrowed], ['♭VII', true]);
  const z = a('Bm7b5', 0, 'major');
  assert.deepEqual([z.label, z.color, z.core], ['viiø7', 'ø7', '11d']);
  const s2 = a('Dsus2', 0, 'major');
  assert.deepEqual([s2.core, s2.color], ['2m', 'sus2']);
  assert.equal(a('Ab+', 0, 'minor').label, '♭VI+');
  return `Fmaj7/A → ${x.label} (bas ${x.bassLabel}) · Bb (C majör) → ${y.label} ödünç · Dsus2 → core ${Style.coreLabel(s2.core, 'major')} + sus2`;
});

await step('Model: kısmi havuzlama formülü, α yumuşatma, 2. derece backoff, geri bildirim sınırları', () => {
  const m = Style.buildModel(ds, { k: 10, alpha: 0.5 });
  // Dorian bağlamı i. Mod verisi (1 şarkı): i→IV. Havuz ayrıca Frig verse'ün i→♭II'sini içerir.
  // P_mod(IV) = (1+α)/(1 + 6α) = 1.5/4 ; P_havuz(IV) = 1.5/(1 + 1 + 5α) = 1.5/5 (♭II diatonik değil: α almaz)
  // P = (n_mod·P_mod + k·P_havuz)/(n_mod + k) = (1·0.375 + 10·0.3)/11
  const dm = m.next('dorian', '0m');
  const diaTargets = Style.diatonicCores('dorian').filter((c) => c !== '0m');
  const expectIV = (1 * (1.5 / 4) + 10 * (1.5 / 5)) / 11;
  assert.ok(dm.get('1M') > 0 && Math.abs(dm.get('1M') - (10 * (1 / 5)) / 11) < 1e-12, 'havuzdan gelen ödünç ♭II');
  assert.ok(Math.abs(dm.get('5M') - expectIV) < 1e-12, 'havuzlama/yumuşatma ' + dm.get('5M'));
  assert.ok(diaTargets.every((c) => dm.get(c) > 0), 'görülmemiş diatonik geçiş 0 olmamalı');
  assert.equal(dm.order, 1, '5 şarkıdan az bağlamda 2. derece kullanılmamalı');
  // 5 şarkıda görülen bağlam → 2. derece
  const many = { songs: Array.from({ length: 5 }, (_, i) => { const s = Style.parseImportText(`Sanatçı: S${i}\nŞarkı: T${i}\n[A: C major] C F G C`).songs[0]; confirmAll(s); return s; }) };
  assert.equal(Style.buildModel(many).next('major', '5M', '0M').order, 2);
  assert.equal(Style.buildModel(many).next('major', '5M', '2m').order, 1);
  // geri bildirim: çarpan 0.5–2 arası, katman kapatılabilir
  const fb = Style.newFeedback();
  for (let i = 0; i < 20; i++) fb.events.push({ kind: 'transition', mode: 'dorian', transitions: [['0m', '5M']], like: 1 });
  const mf = Style.buildModel(ds, {}, fb);
  assert.equal(mf.feedback.mult('dorian', '0m', '5M'), 2);
  const raw = m.next('dorian', '0m'), adj = mf.next('dorian', '0m');
  const ratio = (adj.get('5M') / adj.get('7m')) / (raw.get('5M') / raw.get('7m'));
  assert.ok(Math.abs(ratio - 2) < 1e-9, 'oran ' + ratio);
  fb.on = false;
  assert.deepEqual([...Style.buildModel(ds, {}, fb).next('dorian', '0m')], [...raw]);
  // beğenilmeyen progresyon tekrar önerilmez
  const fb2 = Style.newFeedback();
  const first = Style.suggestProgressions(Style.buildModel(ds), { tonic: 1, mode: 'phrygian', changes: 2, bars: 4, loop: true, ending: 'home', count: 5 }).items[0];
  fb2.banned.push(first.key);
  const again = Style.suggestProgressions(Style.buildModel(ds, {}, fb2), { tonic: 1, mode: 'phrygian', changes: 2, bars: 4, loop: true, ending: 'home', count: 5 }).items;
  assert.ok(!again.some((i) => i.key === first.key));
  return `P(IV | i, Dorian) = ${expectIV.toFixed(4)} · 20 beğeni → çarpan 2 (sınır) · beğenilmeyen "${first.symbols.join(' ')}" tekrar önerilmedi`;
});

await step('k ve α önerisi: şarkı bazlı bir-dışarıda çapraz doğrulama', () => {
  const songs = [];
  const progs = ['C F G C', 'C Am F G', 'C G Am F', 'C F C G', 'Am F C G'];
  progs.forEach((p, i) => { const s = Style.parseImportText(`Sanatçı: K${i}\nŞarkı: T${i}\n[A: C major] ${p}`).songs[0]; confirmAll(s); songs.push(s); });
  const r = Style.suggestKAlpha({ songs });
  assert.ok(r.ok && r.table.length === 42 && Number.isFinite(r.best.meanLL));
  assert.ok(!Style.suggestKAlpha({ songs: songs.slice(0, 2) }).ok);
  return `en iyi k=${r.best.k}, α=${r.best.alpha} (ortalama log-olabilirlik ${r.best.meanLL.toFixed(3)}, ${r.songs} şarkı)`;
});

await step('Akor bulucu entegrasyonu: λ=0 saf teori; stil payı ayrı; sıcaklık örneklemesi', () => {
  const test = Core.synthTestVocal(44100);
  return (async () => {
    const proj = Core.newProject();
    proj.audio.offsetSec = test.offsetSec;
    proj.sections = [{ id: 'v', name: 'Verse', startBar: 1, endBar: 4, tonic: 1, mode: 'phrygian' }, { id: 'c', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 11, mode: 'dorian' }];
    const st = { duration: test.signal.length / test.sr };
    st.track = await Core.detectPitch(test.signal, test.sr, proj.pitch);
    st.rawNotes = Core.segmentNotes(st.track, proj.pitch);
    const names = (d) => d.chords.map((c) => Core.chordName(c.chord)).join(' ');
    const base = names(Core.derive(proj, st));
    const model = Style.buildModel(ds);
    const d0 = Core.derive(proj, Object.assign({}, st, { style: Style.makeStyleScorer(model, { lambda: 0 }) }));
    assert.equal(names(d0), base, 'λ=0 kuralları değiştirmemeli');
    const d1 = Core.derive(proj, Object.assign({}, st, { style: Style.makeStyleScorer(model, { lambda: 1 }) }));
    const c = d1.chords.find((x) => x.bar === 2).candidates[0];
    assert.ok(Math.abs(c.melody + c.style - c.score) < 1e-9 && c.style !== 0, 'melodi + stil payı = toplam');
    // kurallar hâlâ geçerli: kilit korunur
    proj.chordLocks = [{ bar: 1, half: null, chord: { root: 9, q: '' } }];
    assert.equal(Core.chordName(Core.derive(proj, Object.assign({}, st, { style: Style.makeStyleScorer(model, { lambda: 1 }) })).chords[0].chord), 'A');
    proj.chordLocks = [];
    const hot = new Set();
    for (let seed = 1; seed <= 12; seed++) hot.add(names(Core.derive(proj, Object.assign({}, st, { style: Style.makeStyleScorer(model, { lambda: 1, temperature: 3, seed }) }))));
    assert.ok(hot.size > 1, 'sıcaklık > 0 çeşitlilik üretmeli');
    return `λ=0: ${base}\n    λ=1: ${names(d1)} (ölçü 2 en iyi aday ${Core.chordName(c.chord)}: melodi ${c.melody.toFixed(2)} + stil ${c.style.toFixed(2)})\n    sıcaklık 3 → ${hot.size} farklı sonuç (12 tohum)`;
  })();
});

console.log(results.join('\n'));
if (failures) { console.error(`\n${failures} adım başarısız`); process.exit(1); }
console.log('\nStil testleri geçti.');

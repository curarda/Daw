// Bölüm düzenlemeleri (sil / birleştir / böl / aralık): akorlar ve kilitler yerinde kalır; bölümsüz şarkıda ton saklanır.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core: C } = loadCore();
const clone = (v) => JSON.parse(JSON.stringify(v));
// ses süresi 12 ölçü: şarkı uzunluğu bölümlerden bağımsız (gerçek uygulamada ses belirler)
const derive = (p) => C.derive(p, { duration: 12 * C.makeGrid(p.settings).barSec, rawNotes: [] });
const sheet = (d) => d.chords.map((c) => `${c.bar}${c.half ? '/' + c.half : ''}:${C.chordName(c.chord)}${c.locked ? '🔒' : ''}`).join(' ');
const bars = (d, a, b) => d.chords.filter((c) => c.bar >= a && c.bar <= b).map((c) => `${c.bar}${c.half ? '/' + c.half : ''}:${C.chordName(c.chord)}${c.locked ? '🔒' : ''}`).join(' ');

function project(sections = [{ id: 'a', name: 'Şarkı', startBar: 1, endBar: 8, tonic: 8, mode: 'phrygian' }]) {
  const p = C.newProject(); p.settings.meter = '4/4'; p.guitar = C.defaultGuitarState('4/4');
  p.sections = clone(sections);
  p.chordLocks = [{ bar: 4, half: null, chord: { root: 1, q: 'm' }, src: 'user' }]; // kullanıcının kilitlediği akor (örn. C#m)
  return p;
}
const ops = [];
function step(name, fn) {
  try { fn(); ops.push('✔ ' + name); } catch (e) { ops.push('✘ ' + name + '\n    ' + (e.stack || e.message)); process.exitCode = 1; }
}

step('Tek bölümü silmek: bölüm yok / tüm şarkı olur; akorlar, kilit ve ton aynen kalır', () => {
  const p = project(), d0 = derive(p), before = bars(d0, 1, 8); // bölümsüz modda şarkının kalanı da (9–12) "tüm şarkı" olarak akor alır; silinen bölümün ölçülerine bakılır
  assert.ok(d0.chords.some((c) => c.locked), 'kilitli akor var');
  const r = C.removeSection(p, d0, 'a');
  assert.equal(r.ok, true); assert.equal(r.mode, 'implicit'); assert.deepEqual(r.key, { tonic: 8, mode: 'phrygian' });
  assert.equal(p.sections.length, 0); assert.deepEqual(p.implicitKey, { tonic: 8, mode: 'phrygian' });
  assert.equal(p.chordLocks.length, 1, 'kilit silinmedi');
  const d1 = derive(p);
  assert.equal(d1.sections.length, 1); assert.equal(d1.sections[0].implicit, true);
  assert.equal(bars(d1, 1, 8), before); assert.ok(d1.chords.some((c) => c.bar > 8), 'tüm şarkı: 8. ölçüden sonrası da akor alır');
  // ton saklanmasa bile (başka bir önerilen ton olsa bile) akorlar seçimlerden gelir
  const q = clone(p); q.implicitKey = { tonic: 0, mode: 'major' };
  assert.equal(bars(derive(q), 1, 8), before, 'akor seçimleri tonu bile yener');
  const noKey = clone(p); delete noKey.implicitKey;
  assert.equal(bars(derive(noKey), 1, 8), before, 'ton yokken de akorlar yerinde');
  // seçimler bölüm yok / tüm şarkı kimliğine bağlandı
  assert.ok(p.chordChoices.length >= d0.chords.length && p.chordChoices.every((c) => c.sectionId === '_all'));
});

step('Eski davranış: akorlarıyla sil (keepChords: false) bölümü, içindeki kilidi ve akorları götürür', () => {
  const p = project([{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }, { id: 'b', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 0, mode: 'major' }]);
  p.chordLocks = [{ bar: 6, half: null, chord: { root: 9, q: 'm' }, src: 'user' }];
  const r = C.removeSection(p, derive(p), 'b', { keepChords: false });
  assert.equal(r.mode, 'plain'); assert.deepEqual(p.chordLocks, []); assert.equal(derive(p).chords.filter((c) => c.bar >= 5).length, 0);
});

step('Bitişik komşu varsa bölüm silinince ölçüleri önceki (yoksa sonraki) bölüme katılır; akorlar ve kilitler aynı', () => {
  const secs = [{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }, { id: 'b', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 9, mode: 'minor' }];
  const p = project(secs); p.chordLocks = [{ bar: 6, half: null, chord: { root: 7, q: '7' }, src: 'user' }];
  const before = sheet(derive(p));
  const r = C.removeSection(p, derive(p), 'b');
  assert.equal(r.mode, 'prev'); assert.equal(r.into, 'Verse');
  assert.deepEqual(p.sections.map((s) => [s.id, s.startBar, s.endBar]), [['a', 1, 8]]);
  assert.equal(sheet(derive(p)), before);
  assert.equal(p.chordLocks.length, 1);
  // ilk bölümü silince sonrakine katılır
  const q = project(secs); q.chordLocks = [{ bar: 2, half: null, chord: { root: 5, q: '' }, src: 'user' }];
  const beforeQ = sheet(derive(q));
  assert.equal(C.removeSection(q, derive(q), 'a').mode, 'next');
  assert.deepEqual(q.sections.map((s) => [s.id, s.startBar, s.endBar]), [['b', 1, 8]]);
  assert.equal(sheet(derive(q)), beforeQ);
  assert.ok(q.chordChoices.every((c) => c.sectionId === 'b' && c.relBar >= 0 && c.relBar < 8));
});

step('Komşusu olmayan bölüm silinince o ölçülerde akor kalmaz (akor bölüm içinde üretilir); kilit de gider', () => {
  const p = project([{ id: 'a', name: 'Verse', startBar: 1, endBar: 2, tonic: 0, mode: 'major' }, { id: 'b', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 0, mode: 'major' }]);
  p.chordLocks = [{ bar: 2, half: null, chord: { root: 7, q: '' }, src: 'user' }];
  const r = C.removeSection(p, derive(p), 'a');
  assert.equal(r.mode, 'gap'); assert.deepEqual(p.chordLocks, []);
  assert.equal(derive(p).chords.filter((c) => c.bar <= 2).length, 0);
});

step('Birleştir: yan yana iki bölüm tek olur (ilkinin adı), akorlar ve kilitler aynı; bitişik olmayan reddedilir', () => {
  const secs = [{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }, { id: 'b', name: 'Köprü', startBar: 5, endBar: 8, tonic: 9, mode: 'minor' }, { id: 'c', name: 'Outro', startBar: 10, endBar: 12, tonic: 0, mode: 'major' }];
  const p = project(secs); const before = sheet(derive(p));
  assert.equal(C.mergeSections(clone(p), derive(p), 'b', 'c').ok, false);
  const r = C.mergeSections(p, derive(p), 'a', 'b');
  assert.equal(r.ok, true); assert.equal(r.name, 'Verse');
  assert.deepEqual(p.sections.map((s) => [s.id, s.startBar, s.endBar, s.tonic]), [['a', 1, 8, 0], ['c', 10, 12, 0]]);
  assert.equal(bars(derive(p), 1, 8), before.split(' ').filter((x) => +x.split(':')[0].split('/')[0] <= 8).join(' '));
});

step('Böl: imlecin ölçüsünden ikiye; ikinci bölüm adı, türü, tonu ve ayarları devralır; akorlar ve kilitler aynı', () => {
  const p = project([{ id: 'a', name: 'Verse', type: 'verse', startBar: 1, endBar: 8, tonic: 9, mode: 'minor', arr: { drums: 'minimal' } }]);
  p.matrix = { enabled: true, rows: { a: { bass: false } } }; p.guitar.parts.a = clone(p.guitar.parts._all); p.guitar.parts.a.tone = 'drive';
  const before = sheet(derive(p));
  assert.equal(C.splitSection(clone(p), derive(p), 'a', 1, 'n1').ok, false, 'ilk ölçüden bölünmez');
  assert.equal(C.splitSection(clone(p), derive(p), 'a', 9, 'n1').ok, false);
  const r = C.splitSection(p, derive(p), 'a', 5, 'n1');
  assert.equal(r.ok, true); assert.equal(r.second, 'Verse 2');
  assert.deepEqual(p.sections.map((s) => [s.id, s.name, s.startBar, s.endBar, s.tonic, s.mode, s.type]), [['a', 'Verse', 1, 4, 9, 'minor', 'verse'], ['n1', 'Verse 2', 5, 8, 9, 'minor', 'verse']]);
  assert.deepEqual(p.sections[1].arr, { drums: 'minimal' }); assert.deepEqual(p.matrix.rows.n1, { bass: false }); assert.equal(p.guitar.parts.n1.tone, 'drive');
  assert.equal(sheet(derive(p)), before);
  // sayıyla biten ad artar
  const q = project([{ id: 'a', name: 'Nakarat 2', startBar: 1, endBar: 8, tonic: 0, mode: 'major' }]);
  assert.equal(C.splitSection(q, derive(q), 'a', 3, 'n2').second, 'Nakarat 3');
});

step('Aralık: komşu gerekirse kısalır (akorlar aynı); tamamen kaplama ve başka bölümün içine girme reddedilir', () => {
  const secs = [{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }, { id: 'b', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 9, mode: 'minor' }];
  const p = project(secs); const before = sheet(derive(p));
  const r = C.setSectionRange(p, derive(p), 'a', 1, 6);
  assert.equal(r.ok, true); assert.deepEqual(r.trimmed, ['Nakarat']);
  assert.deepEqual(p.sections.map((s) => [s.id, s.startBar, s.endBar]), [['a', 1, 6], ['b', 7, 8]]);
  assert.equal(sheet(derive(p)), before);
  assert.equal(C.setSectionRange(clone(p), derive(p), 'a', 1, 8).ok, false, 'Nakarat tamamen kaplanır');
  const inner = project([{ id: 'a', name: 'Verse', startBar: 1, endBar: 8, tonic: 0, mode: 'major' }, { id: 'b', name: 'Köprü', startBar: 10, endBar: 12, tonic: 0, mode: 'major' }]);
  assert.equal(C.setSectionRange(clone(inner), derive(inner), 'b', 3, 4).ok, false, 'a bölümünün içine girer');
  assert.equal(C.setSectionRange(clone(inner), derive(inner), 'b', 9, 11).ok, true, 'boşluğa taşınabilir');
  const wrap = project(secs); wrap.sections[1].startBar = 5;
  assert.equal(C.setSectionRange(clone(wrap), derive(wrap), 'a', 0, 4).ok, false, 'ölçü 0 geçersiz');
  // küçültme: boşluk kalır, kalan ölçülerde akor kalmaz ama komşuya dokunulmaz
  const shrink = project(secs); C.setSectionRange(shrink, derive(shrink), 'b', 6, 8);
  assert.deepEqual(shrink.sections.map((s) => [s.id, s.startBar, s.endBar]), [['a', 1, 4], ['b', 6, 8]]);
});

step('Seçimler tutarlı: ölü bölüm kimliği kalmaz, etkilenmeyen bölümün seçimlerine dokunulmaz, donmuşsa freeze kaynağı işlenir', () => {
  const secs = [{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }, { id: 'b', name: 'Nakarat', startBar: 5, endBar: 8, tonic: 9, mode: 'minor' }, { id: 'c', name: 'Outro', startBar: 9, endBar: 10, tonic: 0, mode: 'major' }];
  const p = project(secs); p.chordLocks = [];
  p.chordChoices = [{ sectionId: 'c', relBar: 0, half: 0, chord: { root: 2, q: 'm' }, state: 'auto' }, { sectionId: 'ölü', relBar: 0, half: 0, chord: { root: 1, q: '' }, state: 'auto' }];
  C.removeSection(p, derive(p), 'b');
  assert.ok(!p.chordChoices.some((c) => c.sectionId === 'ölü' || c.sectionId === 'b'));
  assert.ok(p.chordChoices.some((c) => c.sectionId === 'c' && c.chord.root === 2), 'c bölümünün seçimi yerinde');
  const f = project(secs); C.freezeChords(f, derive(f));
  C.removeSection(f, derive(f), 'b');
  assert.ok(f.chordChoices.every((c) => c.source === 'freeze'), JSON.stringify(f.chordChoices.filter((c) => c.source !== 'freeze')));
  assert.ok(C.unfreezeChords(f).ok && f.chordChoices.length === 0);
});

step('Yeni bölüm, bölümsüzken saklanan tonu devralır; saklanan ton yoksa boş', () => {
  const p = project(); C.removeSection(p, derive(p), 'a');
  assert.deepEqual(C.inheritedSectionKey(p), { tonic: 8, mode: 'phrygian' });
  assert.deepEqual(C.inheritedSectionKey(project()), { tonic: null, mode: null });
  assert.deepEqual(C.inheritedSectionKey(Object.assign(C.newProject(), { sections: [] })), { tonic: null, mode: null });
});

step('Kaydet / yükle: bölümsüz projede saklanan ton ve akorlar JSON gidiş-dönüşte aynı kalır', () => {
  const p = project(), before = bars(derive(p), 1, 8);
  C.removeSection(p, derive(p), 'a');
  const q = JSON.parse(JSON.stringify(p));
  assert.equal(bars(derive(q), 1, 8), before); assert.deepEqual(q.implicitKey, { tonic: 8, mode: 'phrygian' });
});

console.log(ops.join('\n'));
if (process.exitCode) { console.log('\nBölüm testleri başarısız.'); process.exit(1); }
console.log('Bölüm testleri geçti.');

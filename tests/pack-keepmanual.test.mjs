import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
const clone = (v) => JSON.parse(JSON.stringify(v));
const derive = (p) => C.derive(p, { duration: 0, rawNotes: [] });
function project(meter = '4/4') {
  const p = C.newProject(); p.settings.meter = meter; p.guitar = C.defaultGuitarState(meter);
  p.sections = ['verse', 'chorus'].map((type, i) => ({ id: 's' + i, name: type, type, startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 0, mode: 'major', link: null }));
  return p;
}
function apply(p, id, opts = { keepManual: true }) { return C.applyPack(p, derive(p), id, opts); }
function column(p, d, layer) { return Object.fromEntries(d.sections.map((s) => [s.id, C.effectiveCell(p, d, s.id, layer)])); }
for (const on of [false, true]) {
  const p = project('3/4'); p.drums = { on, loop: 'waltz', startBar: 3, fills: false };
  const drums = clone(p.drums), locks = clone(p.pack.locks), d = derive(p), prior = column(p, d, 'drums');
  const result = C.applyPack(p, d, 'vals', { keepManual: true });
  assert.deepEqual(p.drums, drums); assert.deepEqual(p.pack.locks, locks);
  assert.ok(result.manual.includes('drums')); assert.ok(result.kept.includes('drums'));
  assert.deepEqual(column(p, derive(p), 'drums'), prior);
  for (const s of d.sections) { assert.equal(p.matrix.rows[s.id].drums, prior[s.id]); assert.equal(p.matrix.rows[s.id].bass, null); }
  assert.equal(p.pack.id, 'vals'); assert.equal(p.bass.enabled, true);
}
for (const layer of ['drums', 'piano']) {
  const p = project(); p.sections[0].arr = { [layer]: layer === 'drums' ? 'off' : 'synth-arp' };
  p.matrix = { enabled: true, rows: { s0: { [layer]: false }, s1: { [layer]: true } } };
  const arr = clone(p.sections[0].arr), settings = clone(layer === 'drums' ? p.drums : p.piano), locks = clone(p.pack.locks), before = column(p, derive(p), layer);
  const result = apply(p, 'electro-pop');
  assert.deepEqual(p.sections[0].arr, arr); assert.deepEqual(layer === 'drums' ? p.drums : p.piano, settings);
  assert.deepEqual(p.pack.locks, locks); assert.ok(result.manual.includes(layer));
  assert.deepEqual(column(p, derive(p), layer), before);
  for (const s of p.sections) assert.equal(p.matrix.rows[s.id][layer], before[s.id]);
}
for (const loop of ['ht-flat', 'ballad16']) {
  const p = project(); apply(p, 'dream-pop'); p.drums.loop = loop;
  const result = apply(p, 'indie-pop');
  assert.equal(p.drums.loop, 'backbeat'); assert.equal(p.piano.style, 'piano-arp');
  assert.deepEqual(result.manual, []); assert.equal(p.matrix.rows.s0.drums, null);
  assert.deepEqual(p.pack.locks, C.newProject().pack.locks);
}
{
  const p = project(); apply(p, 'dream-pop'); p.drums.loop = 'four';
  assert.ok(apply(p, 'indie-pop').manual.includes('drums')); assert.equal(p.drums.loop, 'four');
}
for (const [style, previous, kept] of [[C.PIANO_DEFAULTS.style, null, false], ['synth-arp', null, true], ['synth-chord', 'dream-pop', false], ['synth-arp', 'dream-pop', true]]) {
  const p = project(); p.pack.id = previous; p.piano.style = style;
  const locks = clone(p.pack.locks), result = apply(p, 'indie-pop');
  assert.equal(result.manual.includes('piano'), kept);
  assert.equal(p.piano.style, kept ? style : 'piano-arp'); assert.deepEqual(p.pack.locks, locks);
  assert.equal(p.matrix.rows.s0.piano, kept ? true : null);
}
{
  const p = project(); p.sections[0].arr = { auto: true, drums: 'minimal', piano: 'synth-arp' };
  const result = apply(p, 'dream-pop');
  assert.deepEqual(result.manual, []); assert.equal(p.drums.loop, 'ht-flat'); assert.equal(p.piano.style, 'synth-chord');
  assert.deepEqual(p.sections[0].arr, { auto: true });
}
{
  const p = project(); p.drums.loop = 'four'; p.piano.style = 'synth-arp'; p.pack.locks.bass = true;
  const locks = clone(p.pack.locks), bass = clone(p.bass), result = apply(p, 'dream-pop');
  assert.deepEqual(p.pack.locks, locks); assert.deepEqual(p.bass, bass);
  assert.deepEqual(result.kept, ['piano', 'bass', 'drums']);
}
{
  const p = project(); p.drums.loop = 'four'; p.piano.style = 'synth-arp'; p.sections[0].arr = { drums: 'off', piano: 'synth-arp' };
  const plain = clone(p), explicit = clone(p), result = C.applyPack(plain, derive(plain), 'dream-pop');
  apply(explicit, 'dream-pop', { keepManual: false }); assert.deepEqual(plain, explicit);
  assert.equal(plain.drums.loop, 'ht-flat'); assert.equal(plain.piano.style, 'synth-chord'); assert.deepEqual(plain.sections[0].arr, {});
  assert.equal(Object.hasOwn(result, 'manual'), false); assert.deepEqual(result.kept, []);
}
console.log('pack keepManual: manual loops/sections/styles, temporary matrix locks, previous pack loop/alt replacement, persistent locks and plain apply passed');

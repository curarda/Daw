import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore(), B = C.Bass;
const clone = (v) => JSON.parse(JSON.stringify(v));
const layers = ['piano', 'guitar', 'bass', 'drums'];
function project(meter = '4/4') {
  const p = C.newProject(); p.settings.meter = meter; p.guitar = C.defaultGuitarState(meter);
  p.guitar.instrument = 'both'; p.bass.enabled = true;
  p.sections = ['intro', 'verse', 'chorus', 'bridge', 'chorus', 'outro'].map((type, i) => ({ id: 's' + i, name: type, type, startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 9, mode: 'minor', arr: { piano: 'synth-arp', drums: 'off' } }));
  return p;
}
const derive = (p) => C.derive(p, { duration: 0, rawNotes: [] });
function frozen(v) { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
assert.equal(C.PACKS.length, 16); frozen(C.PACKS);
assert.deepEqual(C.PACKS.map((p) => p.id), ['dream-pop', 'indie-pop', 'electro-pop', 'alt-rock', 'indie-rock', 'post-punk', 'synthwave', 'darkwave', 'alternative-pop', 'pop-rock', 'akustik', 'balad', 'synthpop', 'dans-elektronik', 'vals', 'balad-68']);
assert.equal(new Set(C.PACKS.map((p) => p.id)).size, 16);
for (const [meter, count] of [['4/4', 14], ['3/4', 1], ['6/8', 1], ['2/4', 0]]) {
  const p = project(meter); assert.equal(C.eligiblePacks(p).length, count);
  if (!count) { assert.deepEqual(C.rankPacks(p), []); assert.equal(C.nextPack(p, null), null); }
}
for (const pack of C.PACKS) {
  assert.ok(pack.name.length); assert.ok(pack.pianoOn || pack.guitarOn);
  assert.equal(pack.meters.length, 1); assert.ok(pack.bpm[0] < pack.bpm[1]);
  for (const id of Object.values(pack.drums)) {
    const loop = C.DRUM_LOOPS.find((l) => l.id === id && l.meter === pack.meters[0]); assert.ok(loop, id);
    assert.ok(Math.max(loop.bpm[0], pack.bpm[0]) <= Math.min(loop.bpm[1], pack.bpm[1]) + 15);
  }
  assert.ok(C.PIANO_STYLES[pack.piano]); assert.ok(B.BASS_PRESETS[pack.bass.preset]);
  assert.ok(['guitar', 'synth'].includes(pack.bass.instrumentType));
  assert.ok(pack.bass.density >= 0 && pack.bass.density <= 1);
  if (pack.bass.profile) assert.ok(B.BUILTIN_PROFILES.some((p) => p.id === pack.bass.profile));
  if (pack.bass.templateFamily !== 'auto') assert.ok(B.BASS_TEMPLATES.some((t) => t.family === pack.bass.templateFamily && t.meter === pack.meters[0] && t.suits.includes(pack.bass.instrumentType === 'guitar' ? 'bass-guitar' : 'synth')));
  const pat = C.GUITAR_PATTERNS.find((g) => g.id === pack.guitar.pattern && g.meter === pack.meters[0]);
  assert.ok(pat?.compatibleModes.includes(pack.guitar.mode)); assert.ok(C.ARTICULATIONS.includes(pack.guitar.articulation));
  assert.ok(['clean', 'crunch', 'drive'].includes(pack.guitar.tone));
  for (const type of ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro', 'other']) for (const l of layers) assert.equal(typeof pack.template[type][l], 'boolean');
  const p = project(pack.meters[0]), d = derive(p), settings = clone(p.settings), swing = clone(p.swing);
  const a = clone(p), b = clone(p); C.applyPack(a, d, pack.id); C.applyPack(b, d, pack.id);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.deepEqual(a.settings, settings); assert.deepEqual(a.swing, swing);
  assert.equal(a.matrix.enabled, true); assert.equal(a.pack.id, pack.id);
  assert.equal(a.drums.loop, pack.drums.loop); assert.equal(a.piano.style, pack.piano);
  assert.equal(a.bass.instrumentPreset, pack.bass.preset); assert.ok(a.bass.generated);
  assert.ok(a.sections.every((s) => !('piano' in s.arr) && !('drums' in s.arr)));
  for (const s of d.sections) for (const l of layers) assert.equal(a.matrix.rows[s.id][l], null);
  p.settings.bpm = pack.bpm[0]; assert.equal(C.rankPacks(p).find((r) => r.id === pack.id).distance, 0);
}
{
  const p = project();
  for (const bpm of [40, 85, 120, 200]) {
    p.settings.bpm = bpm;
    const expected = C.eligiblePacks(p).map((pack) => ({ id: pack.id, distance: Math.max(0, pack.bpm[0] - bpm, bpm - pack.bpm[1]) })).sort((a, b) => a.distance - b.distance);
    assert.deepEqual(C.rankPacks(p), expected.map((r) => ({ ...r, fits: r.distance === 0 })));
    assert.deepEqual(C.topSuggestions(p), C.rankPacks(p).slice(0, 3));
    const ranks = C.rankPacks(p); ranks.forEach((r, i) => assert.equal(C.nextPack(p, r.id), ranks[(i + 1) % ranks.length].id));
    assert.equal(C.nextPack(p, 'missing'), ranks[0].id);
  }
  for (const id of ['unknown', 'vals']) { const before = JSON.stringify(p); assert.throws(() => C.applyPack(p, derive(p), id)); assert.equal(JSON.stringify(p), before); }
  // Engine reference validation also precedes all mutation.
  const loop = C.DRUM_LOOPS.find((l) => l.id === 'ht-flat'), id = loop.id; loop.id = 'missing';
  try { const before = JSON.stringify(p); assert.throws(() => C.applyPack(p, derive(p), 'dream-pop')); assert.equal(JSON.stringify(p), before); } finally { loop.id = id; }
}
{
  const p = project(), d = derive(p), before = JSON.stringify(p), original = B.bassGenerateAll;
  B.bassGenerateAll = () => { throw new Error('generation failed'); };
  try { assert.throws(() => C.applyPack(p, d, 'dream-pop'), /generation failed/); assert.equal(JSON.stringify(p), before); }
  finally { B.bassGenerateAll = original; }
}

for (const layer of layers) {
  const p = project(); p.drums.on = true; p.matrix.enabled = true;
  p.matrix.rows.s1 = { piano: false, guitar: true, bass: false, drums: true };
  p.pack.locks[layer] = true;
  const d = derive(p), before = clone(p), prior = d.sections.map((s) => C.effectiveCell(p, d, s.id, layer));
  const result = C.applyPack(p, d, 'electro-pop');
  assert.deepEqual(result.kept, [layer]); assert.ok(!result.changed.includes(layer));
  if (layer === 'guitar') assert.deepEqual(p.guitar.parts, before.guitar.parts); else assert.deepEqual(p[layer], before[layer]);
  if (['piano', 'drums'].includes(layer)) assert.deepEqual(p.sections.map((s) => s.arr[layer]), before.sections.map((s) => s.arr[layer]));
  d.sections.forEach((s, i) => { assert.equal(p.matrix.rows[s.id][layer], prior[i]); assert.equal(C.effectiveCell(p, d, s.id, layer), prior[i]); });
  for (const l of layers.filter((l) => l !== layer)) for (const s of d.sections) assert.equal(p.matrix.rows[s.id][l], null);
}
for (const instrument of ['piano', 'guitar', 'both']) for (const locked of ['piano', 'guitar']) for (const id of ['electro-pop', 'alt-rock', 'dream-pop']) {
  const p = project(); p.guitar.instrument = instrument; p.pack.locks[locked] = true;
  const pack = C.PACKS.find((v) => v.id === id), current = { piano: instrument !== 'guitar', guitar: instrument !== 'piano' };
  const on = { piano: locked === 'piano' ? current.piano : pack.pianoOn, guitar: locked === 'guitar' ? current.guitar : pack.guitarOn };
  const fallback = !on.piano && !on.guitar;
  if (fallback) on[locked === 'piano' ? 'guitar' : 'piano'] = current[locked === 'piano' ? 'guitar' : 'piano'];
  const result = C.applyPack(p, derive(p), id);
  assert.equal(p.guitar.instrument, on.piano && on.guitar ? 'both' : on.piano ? 'piano' : 'guitar');
  assert.equal(result.warnings.includes('Paket bu katmanı kapatamadı: en az bir akor çalgısı açık kalmalı'), fallback);
}
{
  const p = project(), d = derive(p); p.drums.startBar = 3; p.drums.fills = false;
  p.guitar.parts.s1 = clone(p.guitar.parts._all); p.guitar.parts.s1.locked = true;
  p.guitar.parts._all.locked = true;
  B.bassGenerateAll(p.bass, B.bassContext(d, p));
  p.bass.bars[0].locked = true; B.bassLockSection(p.bass, B.bassContext(d, p), 's1', true);
  const before = clone(p), result = C.applyPack(p, d, 'dream-pop');
  assert.equal(p.drums.startBar, 3); assert.equal(p.drums.fills, false);
  assert.deepEqual(p.guitar.parts, before.guitar.parts); assert.ok(result.warnings.includes('bölüm gitar partileri korundu'));
  assert.deepEqual(p.bass.bars[0], before.bass.bars[0]); assert.deepEqual(p.bass.sections.s1, before.bass.sections.s1);
  assert.deepEqual(p.bass.bars.slice(2, 4), before.bass.bars.slice(2, 4)); assert.ok(result.warnings.some((s) => s.includes('Kilitli bas')));
}
{
  const p = project(); p.drums = { startBar: null }; C.applyPack(p, derive(p), 'dream-pop');
  assert.equal(p.drums.startBar, 1); assert.equal(p.drums.fills, true);
}
for (const [id, section, layer, expected] of [['dream-pop', 's1', 'drums', false], ['electro-pop', 's0', 'bass', false], ['balad', 's5', 'guitar', true]]) {
  const p = project(), d = derive(p); C.applyPack(p, d, id);
  assert.deepEqual(C.matrixTemplate(d.sections.find((s) => s.id === section).typeNorm, p), C.PACKS.find((v) => v.id === id).template[d.sections.find((s) => s.id === section).typeNorm]);
  assert.equal(C.effectiveCell(p, d, section, layer), expected);
  assert.equal(C.effectiveCell(p, d, 's2', 'drums'), true);
}
{
  const p = project(); let d = derive(p); C.applyPack(p, d, 'dream-pop'); p.drums.fills = false;
  // A real linked chorus inherits settings; the extra follows the target's position.
  assert.equal(C.linkSection(p, d, 's4', 's2').ok, true); d = derive(p);
  const original = C.arrangeDrums, plans = [];
  C.arrangeDrums = (g, bars, start, plan) => { plans.push(Array.from({ length: bars }, (_, i) => plan(i + 1)?.id)); return []; };
  try {
    const before = JSON.stringify(p.sections); C.arrangedEvents(d, p, { layers: ['drums'] });
    assert.equal(plans.at(-1)[4], 'ht-flat'); assert.equal(plans.at(-1)[8], 'ballad16'); assert.equal(JSON.stringify(p.sections), before);
    p.sections.push({ ...p.sections[4], id: 'last', startBar: 13, endBar: 14 }); d = derive(p);
    C.arrangedEvents(d, p, { layers: ['drums'] }); assert.equal(plans.at(-1)[8], 'ht-flat'); assert.equal(plans.at(-1)[12], 'ballad16');
    p.sections.pop(); d = derive(p); C.arrangedEvents(d, p, { layers: ['drums'] }); assert.equal(plans.at(-1)[8], 'ballad16');
    p.sections[2].arr.drums = 'backbeat'; C.arrangedEvents(d, p, { layers: ['drums'] }); assert.equal(plans.at(-1)[8], 'backbeat');
    p.sections[2].arr.drums = 'off'; C.arrangedEvents(d, p, { layers: ['drums'] }); assert.equal(plans.at(-1)[8], undefined);
    p.sections[4].link = null; p.sections[4].arr.drums = 'backbeat'; d = derive(p);
    C.arrangedEvents(d, p, { layers: ['drums'] }); assert.equal(plans.at(-1)[8], 'backbeat');
    assert.equal(C.linkSection(p, d, 's4', 's2').ok, true); d = derive(p);
  } finally { C.arrangeDrums = original; }
  p.matrix.rows.s2.drums = false; assert.equal(C.effectiveCell(p, d, 's4', 'drums'), false);
  assert.equal(C.arrangedEvents(d, p, { layers: ['drums'] }).drums.some((e) => e.t >= 8 * d.g.barSec && e.t < 10 * d.g.barSec), false);
  // A light inherited chorus proves the positional extra independently of catalog density.
  const old = C.PACKS;
  C.PACKS = old.map((pack) => pack.id === 'dream-pop' ? { ...pack, template: { ...pack.template, chorus: Object.fromEntries(layers.map((l) => [l, false])) } } : pack);
  try {
    for (const l of layers) { p.pack.locks[l] = true; p.matrix.rows.s2[l] = null; p.matrix.rows.s4[l] = null; }
    for (const l of layers) { assert.equal(C.effectiveCell(p, d, 's4', l), true); assert.equal(C.effectiveCell(p, d, 's2', l), false); }
    p.matrix.rows.s2.bass = false; assert.equal(C.effectiveCell(p, d, 's4', 'bass'), false);
    p.guitar.instrument = 'piano'; assert.equal(C.effectiveCell(p, d, 's4', 'guitar'), false);
    p.bass.enabled = false; p.matrix.rows.s2.bass = null; assert.equal(C.effectiveCell(p, d, 's4', 'bass'), false);
    p.bass.enabled = true;
    d.sections = d.sections.filter((s) => s.id !== 's4'); assert.equal(C.effectiveCell(p, d, 's2', 'bass'), true);
  } finally { C.PACKS = old; }
}
{
  const p = project(), d = derive(p); C.applyPack(p, d, 'dream-pop'); p.drums.fills = false;
  const drums = (proj) => C.arrangedEvents(d, proj, { layers: ['drums'] }).drums;
  p.matrix.enabled = false;
  const plain = clone(p); plain.pack.id = null;
  assert.deepEqual(drums(p), drums(plain), 'disabled matrix suppresses the pack extra');
  p.matrix.enabled = true;
  const lastChorus = (events) => events.filter((e) => e.t >= 8 * d.g.barSec && e.t < 10 * d.g.barSec);
  const expected = clone(p); expected.pack.id = null; expected.sections[4].arr.drums = 'ballad16';
  assert.deepEqual(lastChorus(drums(p)), lastChorus(drums(expected)), 'enabling matrix restores the alt loop');
  assert.notDeepEqual(lastChorus(drums(p)), lastChorus(drums(plain)));
}
{
  const legacy = project(); delete legacy.pack;
  assert.deepEqual(C.migrateMatrix(clone(legacy)).pack, C.newProject().pack);
  const partial = { pack: { id: 'dream-pop', locks: { bass: true } } }; C.migrateMatrix(partial);
  assert.deepEqual(partial.pack, { id: 'dream-pop', selectedId: null, locks: { piano: false, guitar: false, bass: true, drums: false } });
  assert.deepEqual(C.migrateMatrix(clone(partial)), partial);
}
console.log('packs: catalog, ranking, atomic apply, locks, availability, matrix, positional chorus, determinism, migration passed');

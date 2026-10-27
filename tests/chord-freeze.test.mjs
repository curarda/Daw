import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
const clone = (v) => JSON.parse(JSON.stringify(v));
const derive = (p, extra = {}) => C.derive(p, { duration: 0, rawNotes: [], ...extra });
const presented = (d) => d.chords.map(({ section, bar, half, q0, q1, chord, locked, pinned, lockSrc }) => ({ section, bar, half, q0, q1, chord, locked, pinned, lockSrc }));
function project(meter = '4/4') {
  const p = C.newProject(); p.settings.meter = meter; p.guitar = C.defaultGuitarState(meter);
  p.sections = [{ id: 'a', startBar: 1, endBar: 4, tonic: 0, mode: 'major' }];
  return p;
}
for (const meter of ['4/4', '6/8', '3/4']) {
  const p = project(meter);
  p.chordLocks = [{ bar: 1, half: null, chord: { root: 7, q: '7' }, src: 'chart' }];
  p.chordPins = [{ bar: 2, half: null, chord: { root: 5, q: '' } }];
  if (meter !== '3/4') p.changeMarks = [{ bar: 3, half: 1, kind: 'change' }];
  const before = presented(derive(p));
  assert.ok(C.freezeChords(p, derive(p)).ok); assert.ok(C.chordsAreFrozen(p));
  assert.deepEqual(presented(derive(p)), before);
  const frozen = JSON.stringify(p); C.freezeChords(p, derive(p)); assert.equal(JSON.stringify(p), frozen);
  for (const c of p.chordChoices) assert.deepEqual(Object.keys(c).sort(), ['sectionId', 'relBar', 'half', 'chord', 'state', 'source'].sort());
  const state = C.captureVersionState(p, derive(p));
  assert.equal(state.preserveChords, true); assert.equal(state.pack.selectedId, null);
  C.unfreezeChords(p); assert.ok(C.applyVersionState(p, derive(p), state).ok);
  assert.deepEqual(p.chordChoices, state.chordChoices);
  p.chordOpts.engine = 'greedy'; p.chordOpts.colorPenalty = 99; p.swing.ratio = .67; p.sections[0].tonic = 9;
  assert.deepEqual(presented(derive(p)), before);
  const edit = p.chordChoices.find((c) => c.relBar !== 0);
  delete edit.source; edit.chord = { root: 2, q: 'm' }; edit.state = 'lock';
  C.unfreezeChords(p); assert.deepEqual(p.chordChoices, [edit]);
  assert.equal(derive(p).chords.find((c) => c.bar === edit.relBar + 1).chord.root, 2);
  const off = JSON.stringify(p); C.unfreezeChords(p); assert.equal(JSON.stringify(p), off);
}
{
  const p = project(), d = derive(p), untouched = clone(d.chords.slice(1));
  p.chordChoices = [{ sectionId: 'a', relBar: d.chords[0].bar - 1, half: 0, chord: { root: 2, q: 'm' }, state: 'auto' }];
  C.applyChordChoices(p, d); assert.deepEqual(d.chords.slice(1), untouched);
  // Yarım ölçüler ve uzun tutulan aralıklar, adlandırılmadıkça değişmez.
  const fake = { g: { barQ: 4 }, sections: p.sections, chords: [
    { section: 'a', bar: 1, half: 0, q0: 0, q1: 2, chord: { root: 0, q: '' } },
    { section: 'a', bar: 1, half: 1, q0: 2, q1: 12, chord: { root: 5, q: '' } },
    { section: 'a', bar: 4, half: null, q0: 12, q1: 16, chord: { root: 7, q: '' } }
  ] };
  const held = clone(fake.chords.slice(1)); C.applyChordChoices(p, fake); assert.deepEqual(fake.chords.slice(1), held);
  p.chordChoices = []; for (const c of fake.chords) Object.assign(c, { locked: false, pinned: false, lockSrc: null });
  const before = presented(fake); C.freezeChords(p, fake);
  const changed = clone(fake); changed.chords = [changed.chords[0]]; C.applyChordChoices(p, changed);
  assert.deepEqual(presented(changed), before);
}
{
  const p = C.newProject(), extra = { rawNotes: [{ t0: 0, t1: 2, median: 60, nearest: 60, cents: 0 }] }, d = derive(p, extra);
  assert.ok(d.chords.length); C.freezeChords(p, d);
  p.sections = [{ id: 'song', startBar: 1, endBar: d.bars, tonic: 9, mode: 'minor' }];
  C.rekeyChordChoices(p, '_all', 'song'); p.chordOpts.engine = 'greedy';
  assert.deepEqual(presented(derive(p, extra)).map((c) => ({ ...c, section: '_all' })), presented(d));
}
{
  const p = project(); p.sections[0].endBar = 2;
  p.sections.push({ id: 'b', startBar: 3, endBar: 4, tonic: 5, mode: 'minor', link: { sourceId: 'a' } });
  const before = presented(derive(p)); C.freezeChords(p, derive(p));
  assert.ok(p.chordChoices.every((c) => c.sectionId === 'a')); assert.deepEqual(presented(derive(p)), before);
  assert.ok(C.unlinkSection(p, derive(p), 'b').ok);
  assert.ok(p.chordChoices.filter((c) => c.sectionId === 'b').every((c) => c.source === 'freeze'));
  C.unfreezeChords(p); assert.deepEqual(p.chordChoices, []);
}
{
  const p = project(), d = derive(p); p.sections[0].startBar = 2; d.sections[0].startBar = 2; d.chords[0].section = null;
  C.freezeChords(p, d); assert.equal(p.chordLocks[0].src, 'freeze');
  assert.ok(C.saveVersion(p, derive(p)).warnings.some((w) => w.includes('boşluk')));
  C.unfreezeChords(p); assert.deepEqual(p.chordLocks, []);
}
{
  const p = project(); delete p.preserveChords; delete p.pack.selectedId; p.pack.id = 'dream-pop';
  const state = C.captureVersionState(project(), derive(project())); delete state.preserveChords; delete state.pack.selectedId;
  p.versions.items = [{ id: 'legacy', name: 'A', state }]; C.migrateMatrix(p);
  assert.equal(p.preserveChords, false); assert.equal(p.pack.selectedId, 'dream-pop');
  assert.equal(state.preserveChords, false); assert.equal(state.pack.selectedId, null);
  p.settings.meter = '3/4'; delete p.pack.selectedId; C.migrateMatrix(p); assert.equal(p.pack.selectedId, null);
}
{
  const p = project(), d = derive(p);
  p.chordChoices = [C.captureChordChoices(p, d, 'a')[0]];
  const own = clone(p.chordChoices[0]); C.freezeChords(p, derive(p));
  assert.deepEqual(p.chordChoices[0], own);
  const sl = derive(p).chords[1];
  p.chordLocks.push({ bar: sl.bar, half: sl.half, chord: { root: 2, q: 'm' } });
  assert.equal(derive(p).chords.find((c) => c.bar === sl.bar).chord.root, 2);
  C.unfreezeChords(p); assert.deepEqual(p.chordChoices, [own]);
  assert.equal(p.chordLocks.length, 1); assert.equal(derive(p).chords.find((c) => c.bar === sl.bar).chord.root, 2);
}
{
  const p = project(); p.chordOpts.engine = 'duration';
  const before = presented(derive(p)); C.freezeChords(p, derive(p));
  p.chordOpts.engine = 'greedy'; p.sections[0].tonic = 9;
  assert.deepEqual(presented(derive(p)), before);
  p.sections[0].link = { sourceId: 'missing' }; C.unfreezeChords(p);
  const saved = JSON.stringify(p); assert.equal(C.freezeChords(p, derive(p)).ok, false); assert.equal(JSON.stringify(p), saved);
}
{
  const partial = { pack: { id: 'dream-pop', locks: { bass: true } } }, legacy = {};
  assert.doesNotThrow(() => C.migrateMatrix(partial));
  assert.doesNotThrow(() => C.migrateMatrix(legacy));
  assert.equal(partial.pack.selectedId, null); assert.equal(legacy.pack.selectedId, null);
  const p = project('4/4'); p.pack.id = 'dream-pop'; delete p.pack.selectedId;
  assert.equal(C.migrateMatrix(p).pack.selectedId, p.pack.id);
}
for (const change of ['split', 'append']) {
  const p = project(); p.chordOpts.engine = 'greedy';
  if (change === 'split') p.sections[0].endBar = 8;
  const before = presented(derive(p));
  assert.ok(C.freezeChords(p, derive(p)).ok);
  p.sections[0].endBar = 4;
  p.sections.push({ id: 'b', startBar: 5, endBar: 8, tonic: 0, mode: 'major' });
  assert.ok(p.chordChoices.every((c) => c.sectionId === 'a'));
  const after = presented(derive(p)), unfrozen = clone(p);
  C.unfreezeChords(unfrozen);
  const generated = presented(derive(unfrozen)).filter((c) => c.section === 'b');
  assert.deepEqual(after.filter((c) => c.section === 'a'), before.filter((c) => c.bar <= 4), change + ': frozen A');
  assert.deepEqual(generated.map((c) => c.bar), [5, 6, 7, 8]);
  assert.deepEqual(after.filter((c) => c.section === 'b'), generated, change + ': new B uses engine chords');
}
{
  const p = project(), d = derive(p), saved = C.saveVersion(p, d);
  p.pack.selectedId = 'dream-pop';
  assert.equal(C.isVersionDirty(p, d, saved.id), false);
  assert.equal(C.captureVersionState(p, d).pack.selectedId, 'dream-pop');
  p.piano.style = 'synth-chord'; assert.equal(C.isVersionDirty(p, d, saved.id), true);
}
console.log('chord-freeze: sparse slots, meters, freeze/OFF edits, provenance, links, gaps, re-key, versions, migration and new sections passed');

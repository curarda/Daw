import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore(), B = C.Bass;
const clone = (v) => JSON.parse(JSON.stringify(v));
function project(meter = '4/4') {
  const p = C.newProject(); p.settings.meter = meter; p.guitar = C.defaultGuitarState(meter); p.guitar.instrument = 'both'; p.bass.enabled = true;
  p.sections = ['a', 'b', 'c'].map((id, i) => ({ id, name: 'Nakarat', type: 'chorus', startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 0, mode: 'major', link: null }));
  return p;
}
const derive = (p) => C.derive(p, { duration: 0, rawNotes: [] });
const events = (p, d) => JSON.stringify(C.arrangedEvents(d, p));
{
  const p = project(), d = derive(p);
  for (const [target, source, ok] of [['a', 'a', false], ['a', 'missing', false], ['a', 'b', true]]) assert.equal(C.validateLink(p, d, target, source).ok, ok);
  p.sections[1].endBar++; assert.equal(C.validateLink(p, derive(p), 'a', 'b').ok, false); p.sections[1].endBar--;
  assert.ok(C.linkSection(p, d, 'a', 'b').ok); assert.ok(C.linkSection(p, d, 'b', 'c').ok);
  const before = JSON.stringify(p); assert.equal(C.linkSection(p, d, 'c', 'a').ok, false); assert.equal(JSON.stringify(p), before);
  const links = C.resolveLinks(p, d); assert.deepEqual(links.a, { rootId: 'c', offsetBars: -4 }); assert.equal(links.b.rootId, 'c');
}
for (const meter of ['4/4', '6/8', '3/4']) {
  const p = project(meter);
  p.chordLocks = [{ bar: 1, half: null, chord: { root: 7, q: '7' } }, { bar: 3, half: null, chord: { root: 2, q: 'm' } }];
  p.changeMarks = [{ bar: 2, half: 0 }];
  if (meter !== '3/4') p.chordLocks.push({ bar: 2, half: 1, chord: { root: 5, q: '' } });
  p.sections[0].arr = { piano: 'synth-arp', drums: 'off' };
  p.matrix = { enabled: true, rows: { a: { piano: true, guitar: true, bass: true, drums: false }, b: { piano: false } } };
  let d = derive(p); B.bassGenerateAll(p.bass, B.bassContext(d, p));
  assert.ok(C.linkSection(p, d, 'b', 'a').ok); assert.ok(C.linkSection(p, d, 'c', 'b').ok); d = derive(p);
  for (const id of ['b', 'c']) {
    const source = d.chords.filter((c) => c.section === 'a'), target = d.chords.filter((c) => c.section === id);
    assert.deepEqual(target.map((c) => [c.chord, c.locked, c.half]), source.map((c) => [c.chord, c.locked, c.half]));
    assert.equal(C.effectiveCell(p, d, id, 'piano'), true);
    assert.equal(C.guitarPartFor(p.guitar, id, p, d), C.guitarPartFor(p.guitar, 'a'));
  }
  p.chordLocks[0].chord.root = 9; d = derive(p); assert.equal(d.chords.find((c) => c.section === 'c').chord.root, 9);
  const ctx = B.bassContext(d, p); B.bassSync(p.bass, ctx);
  const bass = C.resolvedBass(p, d); assert.deepEqual(bass.bars[2].notes, bass.bars[0].notes);
  const once = events(p, d); B.bassSync(p.bass, ctx); assert.equal(events(p, d), once);
  p.bass.loops.push({ id: 'ignored', sourceStart: 2, sourceLength: 1, targetStart: 4, targetEnd: 5, mode: 'exact' });
  assert.equal(C.resolvedBass(p, d).loops.length, 0); assert.ok(d.linkWarnings.some((s) => s.includes('döngüsü')));
  const before = events(p, d), midi = C.exportMidi(p, d);
  assert.ok(C.unlinkSection(p, d, 'b').ok); const after = derive(p);
  assert.equal(events(p, after), before); assert.deepEqual(C.exportMidi(p, after), midi);
  B.bassSync(p.bass, B.bassContext(after, p)); assert.equal(events(p, after), before);
  assert.equal(after.chords.find((c) => c.section === 'b').locked, true);
  assert.deepEqual(p.chordChoices.filter((c) => c.sectionId === 'b').map((c) => c.state), d.chords.filter((c) => c.section === 'b').map((c) => c.locked ? 'lock' : c.pinned ? 'pin' : 'auto'));
}
{
  const p = project(); C.applyPack(p, derive(p), 'dream-pop');
  C.linkSection(p, derive(p), 'c', 'a'); let d = derive(p);
  assert.equal(C.effectiveCell(p, d, 'c', 'drums'), true);
  p.sections[2].type = 'verse'; d = derive(p);
  assert.equal(C.effectiveCell(p, d, 'b', 'drums'), true);
  const a = C.arrangedEvents(d, p); assert.ok(a.drums.length);
}
for (const change of ['delete', 'resize']) {
  const p = project(); let d = derive(p); C.linkSection(p, d, 'b', 'a'); d = derive(p);
  const before = d.chords.filter((c) => c.section === 'b').map((c) => c.chord);
  assert.ok(C.materializeLinksBeforeStructuralChange(p, d, ['a']).ok);
  assert.equal(p.sections[1].link, null);
  if (change === 'delete') p.sections.shift(); else p.sections[0].endBar--;
  assert.deepEqual(derive(p).chords.filter((c) => c.section === 'b').map((c) => c.chord), before);
}
{
  const p = project(); delete p.chordChoices; p.sections.forEach((s) => delete s.link); C.migrateMatrix(p);
  assert.deepEqual(p.chordChoices, []); assert.ok(p.sections.every((s) => s.link === null));
  for (const bad of [{ sourceId: 'missing' }, {}, { sourceId: 'a' }]) {
    p.sections[0].link = bad; const d = derive(p); assert.ok(d.linkWarnings.length); assert.equal(C.resolveLinks(p, d).a, undefined);
  }
  p.sections[0].link = { sourceId: 'b' }; p.sections[1].link = { sourceId: 'a' }; assert.equal(Object.keys(C.resolveLinks(p, derive(p))).length, 0);
  p.sections[1].link = null; p.sections[1].endBar++; assert.ok(derive(p).linkWarnings.length);
}

{
  const p = project(); let d = derive(p); C.linkSection(p, d, 'b', 'a'); d = derive(p);
  assert.ok(C.unlinkSection(p, d, 'b').ok);
  assert.ok(p.chordChoices.filter((c) => c.sectionId === 'b').every((c) => c.state === 'auto'));
  assert.ok(derive(p).chords.filter((c) => c.section === 'b').every((c) => !c.locked && !c.pinned));
}
{
  const p = project(); p.bass.instrumentType = 'synth';
  p.sections[0].arr = { piano: 'synth-arp', drums: 'backbeat' };
  p.sections[1].arr = { piano: 'piano-chord', drums: 'off' };
  p.guitar.parts.a = C.defaultGuitarPart('4/4'); p.guitar.parts.a.articulation = 'staccato';
  p.guitar.parts.b = C.defaultGuitarPart('4/4'); p.guitar.parts.b.articulation = 'letRing';
  p.chordPins = [{ bar: 2, half: null, chord: { root: 5, q: 'm' } }];
  let d = derive(p); B.bassGenerateAll(p.bass, B.bassContext(d, p));
  p.bass.sections.a.filterStart = .1; p.bass.sections.a.filterEnd = .8;
  p.bass.sections.b.filterStart = .9;
  p.bass.bars[0].locked = true; p.bass.bars[0].notes[0].tie = true;
  const own = clone(p.sections[1].arr), part = clone(p.guitar.parts.b), settings = clone(p.bass.sections.b);
  C.linkSection(p, d, 'b', 'a'); d = derive(p);
  assert.deepEqual(p.sections[1].arr, own); assert.deepEqual(p.guitar.parts.b, part); assert.deepEqual(p.bass.sections.b, settings);
  const expected = clone(p); expected.sections[1].link = null; expected.sections[1].arr = clone(p.sections[0].arr);
  expected.guitar.parts.b = expected.guitar.parts.a;
  assert.deepEqual(C.arrangedEvents(d, p, { layers: ['piano', 'drums'] }), C.arrangedEvents(d, expected, { layers: ['piano', 'drums'] }));
  const resolved = C.resolvedBass(p, d);
  assert.deepEqual(resolved.sections.b, resolved.sections.a); assert.equal(resolved.bars[2].locked, true); assert.equal(resolved.bars[2].notes[0].tie, true);
  const au = B.filterAutomation(p.bass, B.bassContext(d, p), d.g); assert.equal(au[2].v, au[0].v);
  const before = events(p, d); assert.ok(C.unlinkSection(p, d, 'b').ok); d = derive(p);
  assert.equal(events(p, d), before); assert.ok(d.chords.some((c) => c.section === 'b' && c.pinned));
  const captured = C.captureChordChoices(p, d, 'b');
  p.chordChoices = captured; p.sections[1].startBar += 6; p.sections[1].endBar += 6;
  const moved = derive(p); assert.deepEqual(C.captureChordChoices(p, moved, 'b'), captured);
}
{
  const p = project(); p.chordOpts.engine = 'greedy'; p.changeMarks = [{ bar: 2, half: 1, kind: 'change' }];
  let d = derive(p); C.linkSection(p, d, 'b', 'a'); d = derive(p);
  const choices = (id, value = d) => value.chords.filter((c) => c.section === id).map((c) => [c.q0 - (p.sections.find((s) => s.id === id).startBar - 1) * value.g.barQ, c.chord, c.locked]);
  assert.deepEqual(choices('b'), choices('a'));
  const source = choices('a');
  const rawNotes = [{ t0: 4, t1: 5, median: 78, nearest: 78, cents: 0, confidence: 1 }];
  const vocal = C.derive(p, { duration: 0, rawNotes });
  assert.deepEqual(choices('b', vocal), choices('a', vocal)); assert.deepEqual(choices('a', vocal), source);
}
console.log('links: validation, chains, propagation, inheritance, bass, unlink/MIDI, structure and migration passed');

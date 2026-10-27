import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore(), B = C.Bass;
const clone = (v) => JSON.parse(JSON.stringify(v));
const keys = ['signature', 'sections', 'pack', 'matrix', 'drums', 'piano', 'guitar', 'bass', 'swing', 'chordOpts', 'chordStartBar', 'preserveChords', 'chordLocks', 'chordPins', 'changeMarks', 'chordChoices', 'mixer', 'realSounds'];
const derive = (p, extra = {}) => C.derive(p, { duration: 0, rawNotes: [], ...extra });
function project(meter = '4/4', bars = 12) {
  const p = C.newProject(); p.settings.meter = meter; p.guitar = C.defaultGuitarState(meter); p.guitar.instrument = 'both'; p.bass.enabled = true;
  const size = bars / 3;
  p.sections = ['a', 'b', 'c'].map((id, i) => ({ id, name: ['Kıta', 'Nakarat', 'Nakarat 2'][i], startBar: 1 + i * size, endBar: (i + 1) * size, tonic: 9, mode: 'minor', link: null }));
  p.drums = { ...p.drums, on: true, loop: C.loopsFor(meter)[0].id, fills: false };
  p.piano.style = 'synth-arp';
  p.guitar.parts.a = C.defaultGuitarPart(meter); p.guitar.parts.a.tone = 'crunch';
  p.matrix = { enabled: true, rows: { a: { piano: true, guitar: true, bass: true, drums: true }, b: { piano: false, guitar: true, bass: true, drums: true } } };
  p.sections[0].arr = { piano: 'synth-chord' };
  return p;
}
const presented = (d) => d.chords.map((c) => ({ section: c.section, bar: c.bar, half: c.half, q0: c.q0, q1: c.q1, chord: c.chord, locked: c.locked, pinned: c.pinned, lockSrc: c.lockSrc, voicing: c.voicing }));
const sound = (p, d) => JSON.stringify(C.arrangedEvents(d, p));
const midi = (p, d) => C.exportMidi(p, d, { name: p.drums.loop, events: C.arrangedEvents(d, p).drums });
function generate(p) { const d = derive(p); B.bassGenerateAll(p.bass, B.bassContext(d, p)); return d; }
function apply(p, state, extra = {}) {
  const r = C.applyVersionState(p, derive(p, extra), state);
  assert.equal(r.ok, true, r.warnings.join(' ')); assert.equal(r.needsPinSigRefresh, true);
  const d = derive(p, extra); B.bassSync(p.bass, B.bassContext(d, p)); return d;
}
{
  const p = project(), d = generate(p);
  p.audioData = { samples: [1, 2] }; p.midiData = { notes: [1, 2] };
  p.noteEdits = [{ t0: .1, t1: .2, target: 60 }]; p.noteSplits = [.15]; p.audio.offsetSec = .4;
  p.mixer.touched = true; p.mixer.ab = 'original'; p.mixer.click = true;
  const result = C.saveVersion(p, d); assert.ok(result.ok); assert.equal(p.versions.activeId, result.id);
  const state = p.versions.items[0].state;
  assert.deepEqual(Object.keys(state).sort(), keys.slice().sort());
  for (const section of Object.values(state.sections)) assert.deepEqual(Object.keys(section).sort(), ['arr', 'link']);
  assert.deepEqual(state.signature, ['4/4', 'a:4', 'b:4', 'c:4']);
  for (const forbidden of ['versions', 'audio', 'audioData', 'midi', 'midiData', 'noteEdits', 'noteSplits', 'settings', 'pitch', 'autotune', 'vocalFx', 'chordPinsSig']) assert.equal(state[forbidden], undefined, forbidden);
  assert.deepEqual(Object.keys(state.mixer).sort(), ['vocal', 'piano', 'guitar', 'bass', 'drums', 'pedal', 'touched'].sort());
  assert.equal(state.mixer.ab, undefined); assert.equal(state.mixer.click, undefined);
  assert.equal(JSON.stringify(C.captureVersionState(p, d)), JSON.stringify(C.captureVersionState(p, d)));
  const immutable = JSON.stringify(state); p.guitar.parts.a.fx.reverb = .8; p.sections[0].arr.drums = 'off'; p.bass.bars[0].notes[0].midi++;
  assert.equal(JSON.stringify(state), immutable);
  assert.ok(C.isVersionDirty(p, d, result.id));
}
for (const meter of ['4/4', '6/8', '3/4']) {
  const p = project(meter);
  p.chordLocks = [{ bar: 1, half: null, chord: { root: 9, q: 'm', bass: 4 }, src: 'chart' }];
  p.chordPins = [{ bar: 2, half: null, chord: { root: 5, q: '' } }];
  p.changeMarks = [{ bar: 3, half: 0, kind: 'change' }];
  if (meter !== '3/4') p.chordLocks.push({ bar: 4, half: 1, chord: { root: 7, q: '7' } });
  let d = generate(p);
  p.bass.bars[0].notes[0].tie = true; p.bass.bars[0].notes[0].gate = 1; p.bass.bars[0].locked = true;
  assert.ok(B.bassMakeLoop(p.bass, B.bassContext(d, p), { id: 'saved-loop', sourceStart: 0, sourceLength: 1, targetStart: 2, targetEnd: 3, mode: 'exact' }).ok);
  // Save stable post-sync events, including loop/tie policy, as a browser refresh would.
  B.bassSync(p.bass, B.bassContext(d, p));
  const a = C.saveVersion(p, d), stateA = clone(p.versions.items[0].state), original = sound(p, d), originalMidi = midi(p, d), originalChords = clone(presented(d));
  const locks = clone(p.chordLocks), pins = clone(p.chordPins), marks = clone(p.changeMarks), loops = clone(p.bass.loops);
  assert.equal(C.isVersionDirty(p, d, a.id), false);
  p.drums.loop = C.loopsFor(meter).at(-1).id; p.drums.fills = true; p.piano.style = 'piano-chord'; p.guitar.parts.a.mode = 'arpeggio';
  p.bass.bars[0].notes = []; p.bass.sections.a.density = .95; p.matrix.rows.a.piano = false; p.swing.ratio = .7;
  p.sections[0].arr = { drums: 'off' }; p.chordLocks = []; p.chordPins = []; p.changeMarks = []; p.chordOpts.engine = 'greedy'; p.mixer.piano.vol = -25;
  d = derive(p); B.bassSync(p.bass, B.bassContext(d, p)); assert.equal(C.isVersionDirty(p, d, a.id), true);
  const b = C.saveVersion(p, d); assert.ok(b.ok); const stateB = clone(p.versions.items[1].state), soundB = sound(p, d);
  d = apply(p, stateA);
  assert.equal(sound(p, d), original, meter + ' event bytes'); assert.deepEqual(midi(p, d), originalMidi, meter + ' MIDI bytes');
  assert.deepEqual(presented(d), originalChords); assert.deepEqual(p.chordLocks, locks); assert.deepEqual(p.chordPins, pins); assert.deepEqual(p.changeMarks, marks); assert.deepEqual(p.bass.loops.map(({ syncSig, ...loop }) => loop), loops);
  assert.equal(C.isVersionDirty(p, d, a.id), false);
  d = apply(p, stateB); assert.equal(sound(p, d), soundB);
  d = apply(p, stateA); assert.equal(sound(p, d), original);
  assert.deepEqual(p.pack, stateA.pack); assert.deepEqual(p.matrix, stateA.matrix);
}
{
  const p = project(), rawNotes = Array.from({ length: 12 }, (_, i) => ({ t0: i * 2, t1: i * 2 + 1, median: 69, nearest: 69, cents: 0 }));
  let d = derive(p, { rawNotes }); B.bassGenerateAll(p.bass, B.bassContext(d, p));
  const original = clone(presented(d)), state = C.captureVersionState(p, d);
  const style = { score: (prev, prev2, c) => ({ value: c.root === 7 ? 10000 : 0, trans: c.root === 7 ? 10000 : 0, color: 0 }), temperature: 0 };
  p.chordOpts.engine = 'greedy'; d = derive(p, { rawNotes, style }); assert.notDeepEqual(presented(d).map((c) => c.chord), original.map((c) => c.chord));
  d = apply(p, state, { rawNotes, style }); assert.deepEqual(presented(d), original, 'saved auto choices survive an external style change');
  assert.ok(d.chords.every((c) => !c.locked && !c.pinned));
}
{
  const p = project(); p.guitar.parts.a = clone(p.guitar.parts._all);
  const d = generate(p), state = C.captureVersionState(p, d), original = sound(p, d), bytes = midi(p, d);
  const after = apply(p, state); assert.equal(sound(p, after), original, 'identical independent guitar parts retain separate voicing groups'); assert.deepEqual(midi(p, after), bytes);
  assert.deepEqual(C.captureVersionState(p, after), state);
}
{
  const p = project(); let d = generate(p); C.applyPack(p, d, 'dream-pop');
  C.linkSection(p, derive(p), 'c', 'b'); d = derive(p); B.bassSync(p.bass, B.bassContext(d, p));
  const state = C.captureVersionState(p, d), before = sound(p, d), bytes = midi(p, d);
  assert.deepEqual(state.sections.c.link, { sourceId: 'b' }); assert.ok(state.chordChoices.every((c) => c.sectionId !== 'c'));
  assert.ok(state.bass.bars.every((b) => b.sectionId !== 'c')); assert.equal(state.bass.sections.c, undefined);
  p.sections[2].link = null; p.pack.id = null; p.pack.locks.bass = true; p.matrix.enabled = false; p.guitar.instrument = 'piano';
  d = apply(p, state); assert.deepEqual(p.sections[2].link, { sourceId: 'b' }); assert.equal(sound(p, d), before); assert.deepEqual(midi(p, d), bytes);
  assert.deepEqual(p.pack, state.pack); assert.deepEqual(p.matrix, state.matrix);
  assert.deepEqual(C.captureChordChoices(p, d, 'c').map((c) => c.chord), C.captureChordChoices(p, d, 'b').map((c) => c.chord));
  assert.ok(C.unlinkSection(p, d, 'c').ok); d = derive(p); B.bassSync(p.bass, B.bassContext(d, p));
  assert.equal(sound(p, d), before, 'unlink remains exact after a version has restored guitar groups');
}
{
  const p = project(); let d = generate(p);
  p.chordLocks = [{ bar: 2, half: 1, chord: { root: 2, q: 'm' } }]; p.chordPins = [{ bar: 3, half: 0, chord: { root: 0, q: '' } }]; p.changeMarks = [{ bar: 4, half: 1, kind: 'change' }];
  d = derive(p); B.bassSync(p.bass, B.bassContext(d, p));
  B.bassMakeLoop(p.bass, B.bassContext(d, p), { id: 'rebase-loop', sourceStart: 0, sourceLength: 1, targetStart: 2, targetEnd: 3, mode: 'exact' });
  const saved = C.saveVersion(p, d), state = clone(p.versions.items[0].state);
  const notes = clone(p.bass.bars.map((b) => b.notes)), boundaries = clone(p.sections);
  assert.equal(state.chordLocks[0].relBar, 1); assert.equal(state.chordLocks[0].bar, undefined);
  assert.equal(state.bass.bars[0].index, undefined); assert.equal(state.bass.bars[0].sig, undefined);
  assert.deepEqual(state.bass.loops[0].sourceStart, { sectionId: 'a', relBar: 0 });
  C.shiftSong(p, 2); d = derive(p); const live = clone(p.sections), shared = clone(p.audio);
  assert.ok(C.versionCompat(p, d, saved.id).ok); d = apply(p, state);
  assert.deepEqual(p.sections.map(({ startBar, endBar, tonic, mode, name }) => ({ startBar, endBar, tonic, mode, name })), live.map(({ startBar, endBar, tonic, mode, name }) => ({ startBar, endBar, tonic, mode, name })));
  assert.deepEqual(p.audio, shared); assert.equal(p.sections[0].startBar, boundaries[0].startBar + 2);
  assert.equal(p.chordLocks[0].bar, 4); assert.equal(p.chordPins[0].bar, 5); assert.equal(p.changeMarks[0].bar, 6);
  assert.equal(p.bass.loops[0].sourceStart, 2); assert.equal(p.bass.loops[0].targetStart, 4); assert.equal(p.bass.loops[0].targetEnd, 5);
  assert.deepEqual(p.bass.bars.slice(2, 14).map((b) => b.notes), notes);
  assert.deepEqual(C.captureVersionState(p, d), state, 'relative capture stays identical after a two-bar song shift');
  // Move just later sections, leaving a new gap; boundaries stay live on apply.
  p.sections[1].startBar += 2; p.sections[1].endBar += 2; p.sections[2].startBar += 2; p.sections[2].endBar += 2;
  d = apply(p, state); assert.equal(p.sections[1].startBar, 9); assert.deepEqual(C.captureVersionState(p, d), state);
}
for (const mode of ['exact', 'follow-chords']) {
  const p = project(); let d = generate(p);
  assert.ok(B.bassMakeLoop(p.bass, B.bassContext(d, p), { id: 'shift-' + mode, sourceStart: 1, sourceLength: 2, targetStart: 4, targetEnd: 7, mode }).ok);
  B.bassSync(p.bass, B.bassContext(d, p));
  const notes = clone(p.bass.bars.map((b) => b.notes)), state = C.captureVersionState(p, d);
  C.shiftSong(p, 2); d = apply(p, state);
  assert.deepEqual(p.bass.bars.slice(2, 14).map((b) => b.notes), notes, mode + ' survives rebase and refresh');
  B.bassSync(p.bass, B.bassContext(d, p)); assert.deepEqual(p.bass.bars.slice(2, 14).map((b) => b.notes), notes);
  assert.deepEqual(C.captureVersionState(p, d), state);
  p.bass.volume = .3; p.bass.sections.b.filterStart = .2;
  B.bassSync(p.bass, B.bassContext(d, p)); assert.deepEqual(p.bass.bars.slice(2, 14).map((b) => b.notes), notes, 'audio controls do not regenerate restored notes');
  const before = clone(p.bass.bars[6].notes);
  B.bassUpdateNote(p.bass, B.bassContext(d, p), 3, 0, { startBeat: p.bass.bars[3].notes[0].startBeat + .25 }); assert.notDeepEqual(p.bass.bars[6].notes, before, 'source edit invalidates restored loop sync');
}
for (const mode of ['exact', 'follow-chords']) {
  const p = project(); let d = generate(p);
  assert.ok(B.bassMakeLoop(p.bass, B.bassContext(d, p), { id: 'gap-' + mode, sourceStart: 3, sourceLength: 2, targetStart: 6, targetEnd: 11, mode }).ok);
  B.bassSync(p.bass, B.bassContext(d, p));
  const state = C.captureVersionState(p, d);
  p.sections[1].startBar += 2; p.sections[1].endBar += 2; p.sections[2].startBar += 4; p.sections[2].endBar += 4;
  d = apply(p, state);
  assert.deepEqual(B.loopSourceBars(p.bass.loops[0]), [3, 6]);
  assert.deepEqual(B.loopTargetBars(p.bass.loops[0]), [8, 9, 12, 13, 14, 15]);
  assert.deepEqual(C.captureVersionState(p, d), state, mode + ' loop anchors survive gaps within both ranges');
  const gaps = clone([p.bass.bars[4].notes, p.bass.bars[5].notes, p.bass.bars[10].notes, p.bass.bars[11].notes]);
  B.bassUpdateNote(p.bass, B.bassContext(d, p), 3, 0, { startBeat: p.bass.bars[3].notes[0].startBeat + .25 });
  assert.deepEqual([p.bass.bars[4].notes, p.bass.bars[5].notes, p.bass.bars[10].notes, p.bass.bars[11].notes], gaps, 'loop updates do not overwrite newly inserted gaps');
  assert.equal(B.loopCopyOf(p.bass, 10), null);
}
for (const mutate of [
  (p) => { p.settings.meter = '6/8'; },
  (p) => { p.sections[0].endBar--; },
  (p) => { p.sections.pop(); },
  (p) => { p.sections.push({ ...p.sections[2], id: 'extra', startBar: 13, endBar: 16 }); },
  (p) => { [p.sections[0].id, p.sections[1].id] = [p.sections[1].id, p.sections[0].id]; },
]) {
  const p = project(), state = C.captureVersionState(p, generate(p)); C.saveVersion(p, derive(p)); mutate(p);
  const before = JSON.stringify(p), d = derive(p), r = C.applyVersionState(p, d, state);
  assert.equal(r.ok, false); assert.match(r.warnings[0], /Sürüm.*bölüm/); assert.equal(JSON.stringify(p), before);
  assert.equal(C.versionCompat(p, d, p.versions.items[0].id).ok, false);
}
{
  const p = project(), d = generate(p), state = C.captureVersionState(p, d);
  for (const corrupt of [(s) => { s.audio = {}; }, (s) => { s.guitar = null; }, (s) => { s.mixer.click = true; }, (s) => { s.bass.bars[0].notes = null; }, (s) => { s.bass.bars[0].relBar = 999; }, (s) => { s.chordChoices[0].half = 4; }, (s) => { s.sections.a.link = { sourceId: 'missing' }; }, (s) => { s.bass.loops.push({ sourceStart: { sectionId: 'missing', relBar: 0 } }); }]) {
    const bad = clone(state); corrupt(bad); const before = JSON.stringify(p);
    assert.equal(C.applyVersionState(p, d, bad).ok, false); assert.equal(JSON.stringify(p), before);
  }
  assert.deepEqual(C.captureVersionState(p, d), state, 'apply never mutates the caller snapshot');
}
{
  const p = project(), d = generate(p), a = C.saveVersion(p, d), b = C.saveVersion(p, d);
  assert.deepEqual(p.versions.items.map((v) => v.name), ['A', 'B']);
  assert.ok(C.renameVersion(p, a.id, '  Kıta denemesi  ').ok); assert.equal(p.versions.items[0].name, 'Kıta denemesi');
  for (const name of [' ', 'B']) { const before = JSON.stringify(p); assert.equal(C.renameVersion(p, a.id, name).ok, false); assert.equal(JSON.stringify(p), before); }
  assert.equal(C.renameVersion(p, 'missing', 'Yeni').ok, false); assert.equal(C.deleteVersion(p, 'missing').ok, false); assert.equal(C.updateVersion(p, d, 'missing').ok, false);
  assert.equal(C.isVersionDirty(p, d, a.id), false); p.drums.loop = 'backbeat'; assert.equal(C.isVersionDirty(p, d, a.id), true);
  const old = clone(p.versions.items[0].state); assert.ok(C.updateVersion(p, d, a.id).ok); assert.notDeepEqual(p.versions.items[0].state, old); assert.equal(C.isVersionDirty(p, d, a.id), false);
  const working = sound(p, d); assert.ok(C.deleteVersion(p, a.id).ok); assert.equal(p.versions.activeId, b.id); assert.equal(sound(p, d), working);
  assert.ok(C.deleteVersion(p, b.id).ok); assert.equal(p.versions.activeId, null); assert.equal(sound(p, d), working);
  for (let i = 0; i < 28; i++) assert.ok(C.saveVersion(p, d).ok);
  assert.deepEqual(p.versions.items.slice(24).map((v) => v.name), ['Y', 'Z', 'A2', 'B2']);
  C.deleteVersion(p, p.versions.items.find((v) => v.name === 'B').id); C.saveVersion(p, d); assert.equal(p.versions.items.at(-1).name, 'B');
}
{
  const p = project(), d = generate(p); p.mixer.pedal = true; p.mixer.touched = { piano: true }; p.mixer.vocal.vol = -7;
  const state = C.captureVersionState(p, d);
  for (const strip of ['vocal', 'piano', 'guitar', 'bass', 'drums']) p.mixer[strip] = { vol: 3, mute: true, solo: true };
  p.mixer.ab = 'original'; p.mixer.click = true; p.mixer.pedal = false; p.mixer.touched = false; p.mixer.vocal.vol = 2;
  p.settings.bpm = 137; p.sections[0].tonic = 2; p.sections[0].mode = 'dorian'; p.sections[0].name = 'Yeni ad';
  p.noteEdits = [{ t0: 0, t1: 1, target: 60 }]; p.noteSplits = [.5]; p.audio.offsetSec = .2;
  const live = clone({ settings: p.settings, sections: p.sections, noteEdits: p.noteEdits, noteSplits: p.noteSplits, audio: p.audio });
  p.chordPinsSig = 'app-only-sig';
  const r = C.applyVersionState(p, derive(p), state); assert.ok(r.ok); assert.equal(r.needsPinSigRefresh, true); assert.equal(p.chordPinsSig, 'app-only-sig');
  for (const strip of ['vocal', 'piano', 'guitar', 'bass', 'drums']) assert.deepEqual(p.mixer[strip], state.mixer[strip]);
  assert.equal(p.mixer.ab, 'original'); assert.equal(p.mixer.click, true); assert.equal(p.mixer.vocal.vol, -7); assert.deepEqual(p.mixer.touched, { piano: true }); assert.equal(p.mixer.pedal, true);
  assert.deepEqual({ settings: p.settings, sections: p.sections.map((s) => { const x = { ...s }; if (!live.sections.find((a) => a.id === s.id).arr) delete x.arr; return x; }), noteEdits: p.noteEdits, noteSplits: p.noteSplits, audio: p.audio }, live);
}
{
  const p = project(); p.sections[0].startBar = 2; let d = generate(p);
  p.chordLocks = [{ bar: 1, chord: { root: 0, q: '' } }]; p.changeMarks = [{ bar: 1, half: 0, kind: 'change' }];
  const result = C.saveVersion(p, d); assert.ok(result.ok); assert.ok(result.warnings.some((s) => s.includes('Bölüm dış')));
  const state = p.versions.items[0].state; assert.deepEqual(state.chordLocks, []); assert.deepEqual(state.changeMarks, []); assert.ok(state.bass.bars.every((b) => b.sectionId));
  assert.equal(state.bass.bars.length, 11); assert.ok(C.applyVersionState(p, d, state).warnings.some((s) => s.includes('Bölüm dış')));
}
for (const bass of ['default', 'none']) {
  const p = project(); if (bass === 'none') p.bass = null;
  const d = derive(p), raw = JSON.stringify(p), state = C.captureVersionState(p, d);
  assert.equal(JSON.stringify(p), raw, 'capture is pure even before bass has ever been synchronized');
  const saved = C.saveVersion(p, d); assert.ok(saved.ok); p.mixer.touched = true;
  assert.ok(C.applyVersionState(p, d, state).ok); const after = derive(p);
  assert.equal(p.mixer.touched, undefined); assert.equal(C.isVersionDirty(p, after, saved.id), false);
}
{
  const p = C.newProject(); delete p.versions; C.migrateMatrix(p); assert.deepEqual(p.versions, { activeId: null, items: [] });
  const d = derive(p, { duration: 4 }); assert.deepEqual(C.versionSignature(p, d), ['4/4', '_all:4']);
  const result = C.saveVersion(p, d); assert.ok(result.ok); assert.ok(C.applyVersionState(p, d, p.versions.items[0].state).ok); assert.equal(C.isVersionDirty(p, d, result.id), false);
  assert.deepEqual(C.migrateMatrix(JSON.parse(JSON.stringify(p))).versions, p.versions);
}
{
  const p = C.newProject(); p.sections = Array.from({ length: 4 }, (_, i) => ({ id: 'long-' + i, name: 'Kıta', startBar: 1 + i * 16, endBar: (i + 1) * 16, tonic: 9, mode: 'minor', link: null }));
  p.bass.enabled = true; const d = generate(p), snapshot = C.captureVersionState(p, d);
  assert.ok(JSON.stringify(snapshot).length < 1500000); assert.equal(snapshot.bass.bars.length, 64);
  for (let i = 0; i < 5; i++) assert.ok(C.saveVersion(p, d).ok);
  assert.ok(JSON.stringify(p).length < 8500000);
  for (const v of p.versions.items) { assert.equal(v.state.versions, undefined); assert.equal(v.state.bass.bars.length, 64); }
  console.log(`versions size: 64-bar snapshot ${JSON.stringify(snapshot).length} bytes; five-version project ${JSON.stringify(p).length} bytes`);
}
console.log('versions: allowlist, exact events/MIDI, style, A/B/A, relative rebase, compatibility, atomicity, names, dirty state, migration and size passed');

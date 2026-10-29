import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
for (const type of ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro', 'other', '_all']) {
  const light = ['intro', 'bridge', 'outro'].includes(type);
  assert.deepEqual(C.matrixTemplate(type), { piano: true, guitar: true, bass: !light, drums: !light && type !== 'verse' });
}
for (const project of [C.newProject(), C.migrateMatrix({})]) {
  assert.deepEqual(project.matrix, { enabled: false, rows: {} });
  assert.deepEqual(C.migrateMatrix(JSON.parse(JSON.stringify(project))).matrix, project.matrix);
  project.matrix.rows.a = { piano: false, bass: null };
  const before = JSON.stringify(project), enabled = C.setMatrixEnabled(project, true);
  assert.equal(JSON.stringify(project), before, 'helper leaves input unchanged');
  assert.equal(enabled.matrix.enabled, true);
  assert.deepEqual(enabled.matrix.rows, project.matrix.rows, 'enabling keeps rows');
  assert.deepEqual(C.migrateMatrix(JSON.parse(JSON.stringify(enabled))).matrix, enabled.matrix);
  const disabled = C.setMatrixEnabled(enabled, false);
  assert.equal(disabled.matrix.enabled, false);
  assert.deepEqual(disabled.matrix.rows, enabled.matrix.rows);
}
const p = C.newProject(); p.guitar.instrument = 'both'; p.bass.enabled = true; p.bass.engine = 'legacy'; p.drums.on = true; // fixture eski şablon motoruyla kaydedildi
p.sections = ['a', 'b', 'c'].map((id, i) => ({ id, type: 'chorus', name: id, startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 9, mode: 'minor' }));
const d = C.derive(p, { duration: 6 * C.makeGrid(p.settings).barSec, rawNotes: [] });
C.Bass.bassGenerateAll(p.bass, C.Bass.bassContext(d, p));
const baseline = C.arrangedEvents(d, p);
p.matrix.enabled = false;
assert.deepEqual(C.arrangedEvents(d, p), baseline);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/arrangement-golden.json', import.meta.url)));
for (const expected of fixture) {
  const legacy = C.newProject(); legacy.matrix.enabled = false;
  const meter = expected.meter; legacy.settings.meter = meter; legacy.settings.bpm = 103; legacy.swing = { ratio: 0.63 };
  legacy.guitar = C.defaultGuitarState(meter); legacy.guitar.instrument = 'both';
  legacy.guitar.parts.b = JSON.parse(JSON.stringify(legacy.guitar.parts._all)); legacy.guitar.parts.b.articulation = 'letRing';
  const loops = C.loopsFor(meter);
  legacy.drums = { on: true, loop: loops[0].id, startBar: 2, fills: true };
  legacy.sections = ['a', 'b', 'c'].map((id, i) => ({ id, name: i === 1 ? 'Nakarat' : 'Verse', startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 9, mode: 'minor', arr: { piano: i === 1 ? 'synth-arp' : null, drums: i === 2 ? 'off' : loops[i % loops.length].id } }));
  const ld = C.derive(legacy, { duration: 6 * C.makeGrid(legacy.settings).barSec, rawNotes: [] });
  legacy.bass.enabled = true; legacy.bass.engine = 'legacy'; C.Bass.bassGenerateAll(legacy.bass, C.Bass.bassContext(ld, legacy));
  assert.deepEqual(JSON.parse(JSON.stringify(C.arrangedEvents(ld, legacy))), expected.events);
  assert.deepEqual(Array.from(C.exportMidi(legacy, ld, { name: loops[0].name, events: expected.events.drums })), expected.midi);
}
p.matrix.enabled = true;
p.matrix.rows.b = { piano: false, guitar: false, bass: false, drums: false };
const events = C.arrangedEvents(d, p), boundary = 2 * d.g.barSec, end = 4 * d.g.barSec;
for (const layer of Object.keys(events)) {
  assert.ok(events[layer].length, layer);
  assert.ok(events[layer].every((e) => e.t < boundary || e.t >= end), layer);
  if (layer !== 'drums') assert.ok(events[layer].every((e) => e.t >= boundary || e.t + e.dur <= boundary + 1e-8), layer);
}
p.matrix.rows.a = { bass: false }; assert.equal(C.effectiveCell(p, d, 'a', 'bass'), false);
p.matrix.rows.a.bass = true; assert.equal(C.effectiveCell(p, d, 'a', 'bass'), true);
p.guitar.instrument = 'piano'; assert.equal(C.effectiveCell(p, d, 'a', 'guitar'), false); p.guitar.instrument = 'both';
// Uzayan olaylar: motorların çıktıları üzerinde aynı kapı, iki zaman tabanı.
for (const [layer, name] of [['piano', 'pianoEvents'], ['guitar', 'guitarEvents'], ['bass', null]]) {
  const target = name ? C : C.Bass, key = name || 'bassEvents', original = target[key];
  target[key] = () => [{ t: boundary - 0.25, dur: 2, q0: (boundary - 0.25) / d.g.spq, q1: (boundary + 1.75) / d.g.spq, q: (boundary - 0.25) / d.g.spq, midi: 60, vel: 90, hold: 2 }];
  try { const e = C.arrangedEvents(d, p, { layers: [layer] })[layer][0]; assert.equal(e.dur, 0.25); assert.equal(e.hold, 0.25); assert.equal(e.q1, boundary / d.g.spq); } finally { target[key] = original; }
}
p.drums.fills = false;
assert.deepEqual(C.arrangedEvents(d, p).drums, events.drums, 'disabled boundary has no incoming/outgoing fill');
p.drums.fills = true;
const midi = C.readMidiFile(C.exportMidi(p, d, { name: 'Test', events: baseline.drums }));
for (const tr of midi.tracks.filter((t) => t.notes.some((n) => [1, 2, 3, 9].includes(n.ch)))) {
  assert.ok(tr.notes.every((n) => n.tick0 / midi.ppq < 8 || n.tick0 / midi.ppq >= 16));
  if (!tr.notes.some((n) => n.ch === 9)) assert.ok(tr.notes.every((n) => n.tick0 / midi.ppq >= 8 || n.tick1 / midi.ppq <= 8));
}
d.sections = d.sections.filter((s) => s.id !== 'b');
assert.equal(C.effectiveCell(p, d, undefined, 'drums'), true);
assert.ok(C.arrangedEvents(d, p).drums.some((e) => e.t >= boundary && e.t < end));
const u = C.setMatrixEnabled(C.newProject(), true), ud = C.derive(u, { duration: 4, rawNotes: [] });
u.matrix.rows._all = { piano: false }; assert.equal(C.arrangedEvents(ud, u).piano.length, 0);
console.log('Matrix templates, migration, gates, clipping, gaps, implicit section and parsed MIDI passed.');

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
const fixture = new URL('./fixtures/arrangement-golden.json', import.meta.url);
const results = [];
for (const meter of ['4/4', '6/8']) {
  const p = C.newProject();
  p.settings.meter = meter; p.settings.bpm = 103; p.swing = { ratio: 0.63 };
  p.guitar = C.defaultGuitarState(meter); p.guitar.instrument = 'both';
  p.guitar.parts.b = JSON.parse(JSON.stringify(p.guitar.parts._all));
  p.guitar.parts.b.articulation = 'letRing';
  const loops = C.loopsFor(meter);
  p.drums = { on: true, loop: loops[0].id, startBar: 2, fills: true };
  p.sections = ['a', 'b', 'c'].map((id, i) => ({ id, name: i === 1 ? 'Nakarat' : 'Verse', startBar: i * 2 + 1, endBar: i * 2 + 2, tonic: 9, mode: 'minor', arr: { piano: i === 1 ? 'synth-arp' : null, drums: i === 2 ? 'off' : loops[i % loops.length].id } }));
  const d = C.derive(p, { duration: 6 * C.makeGrid(p.settings).barSec, rawNotes: [] });
  p.bass.enabled = true;
  C.Bass.bassGenerateAll(p.bass, C.Bass.bassContext(d, p));
  const sec = (b) => d.sections.find((s) => !s.implicit && b >= s.startBar && b <= s.endBar);
  const plan = (b) => { const a = sec(b)?.arr || p.sections.find((s) => s.id === sec(b)?.id)?.arr; return a?.drums === 'off' ? null : loops.find((l) => l.id === a?.drums) || loops[0]; };
  const drums = C.arrangeDrums(d.g, d.bars, 2, plan, (b) => b < d.bars && sec(b)?.id !== sec(b + 1)?.id && !!plan(b) && !!plan(b + 1), 0.63);
  const legacy = {
    piano: C.arrangePiano(d.chords, d.g, (id) => C.pianoOpts(Object.assign({}, p.piano, p.sections.find((s) => s.id === id)?.arr.piano ? { style: p.sections.find((s) => s.id === id).arr.piano } : {}), 0.63)),
    guitar: C.guitarEvents(C.guitarSlotsFrom(d), d.g, (sl) => C.guitarPartFor(p.guitar, sl.section)),
    bass: C.Bass.bassEvents(p.bass, d.g, d.bars), drums,
  };
  const events = process.argv.includes('--record') ? legacy : C.arrangedEvents(d, p);
  results.push({ meter, events, midi: Array.from(C.exportMidi(p, d, { name: loops[0].name, events: drums })) });
}
const normalized = JSON.parse(JSON.stringify(results));
if (process.argv.includes('--record')) {
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  writeFileSync(fixture, JSON.stringify(normalized) + '\n');
  console.log('Arrangement golden recorded from legacy engines.');
} else {
  assert.deepEqual(normalized, JSON.parse(readFileSync(fixture, 'utf8')));
  console.log('Arrangement golden passed (4/4 + 6/8 events and MIDI bytes).');
}

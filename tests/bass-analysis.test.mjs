import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { tone } from './bass-fixtures.mjs';
const { Core: C } = loadCore();
const analyze = async (pcm) => C.analyzeBassSample(pcm, pcm.sampleRate);
for (const midi of [28, 31, 33, 36, 40, 43]) for (const cents of [-23.4, 0, 17.6]) {
  const r = await analyze(tone(midi, { cents })); assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.rootMidi, midi);
  assert.ok(Math.abs(r.rootCents - cents) < 10, `${midi}: ${r.rootCents}`); assert.ok(r.pitchConfidence >= C.BASS_ANALYSIS.confidence && r.pitchConfidence <= 1); assert.ok(r.usableSec >= .25); assert.equal(r.detectorVersion, 1);
}
for (const mode of ['slow', 'clipped']) { const r = await analyze(tone(33, { mode })); assert.ok(r.ok, JSON.stringify(r)); assert.ok(Math.abs(r.rootMidi * 100 + r.rootCents - 3300) < 10); }
const octave = await analyze(tone(33, { mode: 'octave' })); assert.ok(!octave.ok || Math.abs(octave.rootMidi * 100 + octave.rootCents - 3300) < 10);
for (const mode of ['noise', 'chord', 'gliss', 'dc']) assert.equal((await analyze(tone(33, { mode }))).ok, false, mode);
for (const midi of [12, 20, 65, 78]) assert.equal((await analyze(tone(midi))).ok, false, String(midi));
for (const pcm of [tone(33, { seconds: .07 }), { sampleRate: 16000, channels: [new Float32Array(16000)] }, { sampleRate: 16000, channels: [new Float32Array(16000).fill(.2)] }, { sampleRate: 16000, channels: [Float32Array.of(NaN)] }, { sampleRate: 16000, channels: [Float32Array.of(Infinity)] }, tone(33, { seconds: 6.01 })]) assert.equal((await analyze(pcm)).ok, false);
const quiet = tone(); quiet.channels[0] = Float32Array.from(quiet.channels[0], (v) => v * .0001); assert.equal((await analyze(quiet)).ok, false);
const stereo = tone(40); stereo.channels.push(Float32Array.from(stereo.channels[0], (v) => v * .5)); assert.equal((await analyze(stereo)).rootMidi, 40);
const cap = C.validateDecoded(tone(33, { seconds: 5 }), 16000, 4); assert.ok(cap.ok); assert.equal(cap.mono.length, 64000);
console.log('bass-analysis: E1–G2/fractional cents, slow attack, clipped tone, stereo, octave ambiguity, silence/noise/chord/gliss/DC/range/length rejection passed');

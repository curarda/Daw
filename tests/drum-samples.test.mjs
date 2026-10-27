import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
const record = (id) => ({ id, name: 'one shot', author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', selector: 'fallback', why: '' });
const project = (drums = { K: record(1) }) => ({ realSounds: { enabled: true, drums, bass: [] } });
const pcm = (sr = 44100, seconds = .12, leading = 0) => {
  const samples = new Float32Array(Math.round((seconds + leading) * sr));
  for (let i = Math.round(leading * sr); i < samples.length; i++) samples[i] = .2 * Math.cos(2 * Math.PI * 1000 * (i / sr - leading));
  return { channels: [samples], sampleRate: sr };
};
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
const peak = (a) => a.reduce((n, v) => Math.max(n, Math.abs(v)), 0);
const events = [{ t: .01, kind: 'K', vel: .5 }, { t: .012, kind: 'K', vel: .25 }, { t: .2, kind: 'S', vel: .7 }];
const sr = 1000, custom = Float32Array.of(.2, -.4, .6, 0), bank = { K: custom };
const rendered = C.renderDrums(events, sr, 700, .8, bank);
const expected = new Float32Array(700);
for (const e of events) { const sound = bank[e.kind] || C.synthDrum(e.kind, sr), start = Math.round(e.t * sr); for (let i = 0; i < sound.length; i++) expected[start + i] += sound[i] * e.vel * .8; }
assert.deepEqual(rendered, expected); assert.equal(rendered[16], 0, 'one-shots end naturally; overlapping hits do not extend them');
// Eski davul modülünü ayrı yükle: bankasız çıktı bayt düzeyinde aynı kalmalı.
const legacy = { Core: {} }; new Function('globalThis', readFileSync(new URL('../src/drums.js', import.meta.url), 'utf8'))(legacy);
assert.deepEqual(C.renderDrums(events, sr, 700), legacy.Core.renderDrums(events, sr, 700));
assert.deepEqual(C.renderDrums(events, sr, 700, 1, {}), legacy.Core.renderDrums(events, sr, 700));
let fetches = 0, decodes = 0, cacheReads = 0, active = 0;
const messages = [];
const cache = C.createSoundCache({ indexedDB: null }); await cache.put(record(1), new Uint8Array([1]));
const runtime = C.createRealSoundsRuntime({ cache: { async get(...args) { cacheReads++; return cache.get(...args); }, put: (...args) => cache.put(...args) }, network: { freesoundPreview() { fetches++; throw Error('must not fetch'); } }, decode: async () => { decodes++; return pcm(44100, .12, .005); }, onStatus: (s) => messages.push(s) });
const snapshot = await runtime.prepareRealSounds(project(), 1);
assert.equal(fetches, 0); assert.equal(decodes, 1); assert.equal(cacheReads, 1);
const hi = snapshot.bank(44100).K, lo = snapshot.bank(22050).K, live = snapshot.bank(48000).K;
assert.ok(Object.isFrozen(snapshot.bank(44100))); assert.equal(snapshot.bank(44100).K, hi);
assert.ok(Math.abs(hi.length / 44100 - lo.length / 22050) < 1 / 22050);
assert.ok(Math.abs(hi.length / 44100 - live.length / 48000) < 1 / 44100);
assert.ok(Math.abs(rms(hi) / rms(lo) - 1) < .005); assert.ok(Math.abs(rms(hi) / rms(live) - 1) < .005);
for (const [rate, samples] of [[22050, lo], [44100, hi], [48000, live]]) {
  assert.ok(Math.abs(samples[0]) > C.SOUND_TRIM_THRESHOLD);
  const output = C.renderDrums([{ t: .05, kind: 'K', vel: 1 }], rate, rate, 1, { K: samples });
  assert.equal(output.findIndex((v) => Math.abs(v) > C.SOUND_TRIM_THRESHOLD), Math.round(.05 * rate));
  assert.ok(peak(samples) <= 1); assert.equal(output[Math.round(.05 * rate) + samples.length], 0);
  let crossings = 0; for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  assert.ok(Math.abs(crossings * rate / samples.length - 1000) < 10, 'pitch preserved');
  // DFT güç merkezinin üç tüketicide de 1 kHz yakınında kalması gerekir.
  let power = 0, moment = 0;
  for (let hz = 100; hz <= 6000; hz += 100) {
    let re = 0, im = 0;
    for (let i = 0; i < samples.length; i++) { const v = samples[i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (samples.length - 1))), angle = 2 * Math.PI * hz * i / rate; re += v * Math.cos(angle); im += v * Math.sin(angle); }
    const energy = re * re + im * im; power += energy; moment += energy * hz;
  }
  assert.ok(Math.abs(moment / power - 1000) < 5, 'spectral centroid preserved');
}
assert.ok(Math.abs(rms(hi) / rms(C.synthDrum('K', 44100)) - 1) < .005, 'RMS targets synth voice');
const again = await runtime.prepareRealSounds(project(), 1); assert.equal(decodes, 1); assert.equal(again.bank(44100).K, hi);
const highTone = Float32Array.from({ length: 4410 }, (_, i) => .1 * Math.sin(2 * Math.PI * 15000 * i / 44100));
assert.ok(rms(C.resampleDrum(highTone, 44100, 22050).slice(100, -100)) < .001, 'downsampling rejects out-of-band energy');
const oldCopy = hi.slice(); runtime.invalidate(2); assert.deepEqual(snapshot.bank(44100).K, oldCopy, 'operation snapshot remains unchanged');
again.release(); snapshot.release(); assert.equal(runtime.stats().bytes, 0);
const bounded = C.createRealSoundsRuntime({ limit: 45000, cache, network: {}, decode: async () => pcm(44100, .1) });
const small = await bounded.prepareRealSounds(project(), 1); assert.ok(small.bank(44100).K); assert.ok(small.bank(22050).K); assert.equal(small.bank(48000).K, undefined); assert.ok(bounded.stats().bytes <= 45000); small.release(); bounded.invalidate(2); assert.equal(bounded.stats().bytes, 0);
const reservation = bounded.reserve(44000); assert.ok(reservation); assert.equal(bounded.reserve(1001), null); assert.equal(bounded.stats().bytes, 44000); reservation(); reservation(); assert.equal(bounded.stats().bytes, 0);
const idCalls = [], misses = C.createRealSoundsRuntime({ cache: C.createSoundCache({ indexedDB: null }), network: { async freesoundPreview(id) { idCalls.push(id); assert.equal(typeof id, 'number'); return new Uint8Array([id]); }, freesoundSearch() { throw Error('no discovery'); } }, decode: async () => { active++; assert.equal(active, 1); await Promise.resolve(); active--; return pcm(); } });
const many = await misses.prepareRealSounds(project({ K: record(1), S: record(2), H: record(1) }), 1);
assert.deepEqual(idCalls, [1, 2], 'one canonical decode per selected sound'); assert.deepEqual(Object.keys(many.bank(44100)), ['K', 'S', 'H']); many.release();
const failure = async ({ hasKey = () => true, bytes = new Uint8Array([1]), decode = async () => { throw Error('raw secret must not escape'); }, error } = {}) => {
  const status = []; let calls = 0;
  const rt = C.createRealSoundsRuntime({ cache: { get: async () => null, put: async () => {} }, network: { async freesoundPreview() { calls++; if (error) throw error; return bytes; } }, hasKey, decode, onStatus: (s) => status.push(s) });
  const s = await rt.prepareRealSounds(project(), 1); assert.deepEqual(s.bank(44100), {}); s.release(); assert.equal(rt.stats().bytes, 0); return { status, calls };
};
const missing = await failure({ hasKey: () => false }); assert.equal(missing.calls, 0); assert.match(missing.status.at(-1).message, /önbellekte yok.*anahtar/);
const broken = await failure(); assert.match(broken.status.at(-1).message, /çözülemedi/); assert.ok(!broken.status.at(-1).message.includes('raw secret'));
const rate = await failure({ error: new C.NetError('rate') }); assert.match(rate.status.at(-1).message, /429/);
await failure({ bytes: new Uint8Array(1500001), decode: async () => { throw Error('must not decode'); } });
await failure({ decode: async () => pcm(44100, 6.1) });
await failure({ decode: async () => ({ channels: [Float32Array.of(NaN)], sampleRate: 44100 }) });
const longRuntime = C.createRealSoundsRuntime({ cache, network: {}, decode: async () => pcm(44100, 3) });
const long = await longRuntime.prepareRealSounds(project({ H: record(1) }), 1); assert.equal(long.bank(44100).H.length, 88200); assert.equal(C.renderDrums([{ t: 0, kind: 'H', vel: 1 }], 44100, 100000, 1, long.bank(44100))[88200], 0); long.release();
let release, started;
const began = new Promise((resolve) => { started = resolve; });
const guarded = C.createRealSoundsRuntime({ cache: { get: async (id) => ({ record: record(id), bytes: new Uint8Array([id]) }) }, network: {}, decode: async (b) => { if (b[0] === 1) { started(); await new Promise((r) => { release = r; }); } return pcm(); } });
const obsolete = guarded.prepareRealSounds(project(), 1); await began;
const latest = await guarded.prepareRealSounds(project({ K: record(2) }), 2); assert.ok(latest.bank(44100).K);
release(); const stale = await obsolete; assert.equal(stale.stale, true); assert.deepEqual(stale.bank(44100), {}); assert.equal(guarded.stats().generation, 2); latest.release();
const disabled = await runtime.prepareRealSounds({ realSounds: { ...project().realSounds, enabled: false } }, 3); assert.deepEqual(disabled.bank(44100), {}); assert.equal(decodes, 1);
console.log('drum-samples: exact synth fallback, event gain/overlap, rates/onset/duration/RMS/pitch/centroid, normalization, cache/by-id, failures, sequential decode, stale generations and resident cap passed');

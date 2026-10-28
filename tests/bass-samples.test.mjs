import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { tone, record } from './bass-fixtures.mjs';
const { Core: C } = loadCore();
const measured = (id, rootMidi = 28, rootCents = 3) => ({ ...record(id), rootMidi, rootCents, pitchConfidence: .98, detectorVersion: 1 });
const project = (bass = [measured(1)], drums = {}) => ({ realSounds: { enabled: true, bass, drums } });
const messages = [], calls = [], cache = C.createSoundCache({ indexedDB: null }); await cache.put(record(1), Uint8Array.of(1));
let decodes = 0;
const runtime = C.createRealSoundsRuntime({ cache, network: { freesoundPreview(id) { calls.push(id); return Uint8Array.of(id); }, freesoundSearch() { throw Error('no search'); } }, decode: async () => { decodes++; return tone(28, { cents: 3, sampleRate: 44100 }); }, onStatus: (s) => messages.push(s) });
const ctx = (sampleRate) => ({ sampleRate, createBuffer(channels, length, rate) { const data = new Float32Array(length); return { numberOfChannels: channels, length, sampleRate: rate, copyToChannel(v) { data.set(v); }, getChannelData() { return data; } }; } });
const a = await runtime.prepareRealSounds(project(), 1); assert.deepEqual(calls, []); assert.equal(decodes, 1);
for (const rate of [22050, 44100, 48000]) {
  const samples = a.bassSamples(ctx(rate)); assert.ok(Object.isFrozen(samples)); assert.equal(samples.length, 1); assert.equal(samples[0].midi, 28.03); assert.equal(samples[0].buffer.sampleRate, rate);
  const data = samples[0].buffer.getChannelData(0); assert.ok(data.length <= rate * 4); assert.ok(Math.max(...data.subarray(0, 1000)) <= C.BASS_SAMPLE_PEAK);
  assert.equal(a.bassSamples(ctx(rate)), samples);
}
const rms = (x) => Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length);
assert.ok(Math.abs(rms(a.bassBank(44100)[0].data) - C.BASS_SAMPLE_RMS) < .002);
assert.ok(Math.abs(rms(a.bassBank(44100)[0].data) / rms(a.bassBank(22050)[0].data) - 1) < .005);
const again = await runtime.prepareRealSounds(project(), 1); assert.equal(decodes, 1); assert.equal(again.bassSamples(ctx(44100))[0].buffer, a.bassSamples(ctx(44100))[0].buffer);
const old = a.bassBank(44100)[0].data.slice(), keep = a.retain(); runtime.invalidate(2); a.release(); again.release(); assert.ok(runtime.stats().bytes > 0); assert.deepEqual(a.bassBank(44100)[0].data, old); keep(); assert.equal(runtime.stats().bytes, 0);
const miss = await runtime.prepareRealSounds(project([measured(2)]), 2); assert.deepEqual(calls, [2]); assert.equal(miss.bassBank(44100).length, 1); miss.release();
const off = await runtime.prepareRealSounds({ realSounds: { ...project().realSounds, enabled: false } }, 3); assert.deepEqual(off.bassSamples(ctx(44100)), []); assert.deepEqual(off.bank(44100), {}); assert.equal(decodes, 2);
const skipped = await runtime.prepareRealSounds(project(), 4, { skipBass: true }); assert.deepEqual(skipped.bassBank(44100), []); assert.equal(decodes, 2);
for (const useSampler of [false, true]) for (const user of [[], [{}]]) for (const real of [[], [{}]]) assert.equal(C.bassSampleSource({ useSampler }, user, real), useSampler && user.length ? 'user' : real.length ? 'freesound' : 'synth');
// DOM'suz sahte ses düğümleri: örnekleyicinin mevcut seçim/rate/velocity yolunu denetle.
const nodes = [], param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime() {} });
const fake = { createGain: () => ({ gain: param(), connect() {}, disconnect() {} }), createBufferSource() { const n = { playbackRate: param(), connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() {} }; nodes.push(n); return n; } };
const sampler = new C.Bass.BassSampler(fake); sampler.load([{ midi: 28.5, buffer: 'low' }, { midi: 40.5, buffer: 'high' }]);
assert.equal(sampler._pick(28).buffer, 'low'); assert.equal(sampler._pick(41).buffer, 'high');
const ties = new C.Bass.BassSampler(fake); ties.load([{ midi: 28.5, buffer: 'low' }, { midi: 40.5, buffer: 'high' }]); assert.deepEqual([ties._pick(34.5).buffer, ties._pick(34.5).buffer], ['low', 'high']);
sampler.noteOn(52.5, 127, 0); assert.equal(nodes.at(-1).playbackRate.value, 2);
sampler.noteOn(40, 80, 1, { ghost: true }); assert.ok(Math.abs(nodes.at(-1).playbackRate.value - 2 ** (-.5 / 12)) < 1e-12); assert.ok(sampler.cur.g.gain.value < .3);
let retained = 0; const leaseSampler = new C.Bass.BassSampler(fake, { retainSample: () => { retained++; let done = false; return () => { if (!done) { done = true; retained--; } }; } }); leaseSampler.load([{ midi: 28, buffer: 'tone' }]); leaseSampler.noteOn(40, 127, 0); assert.equal(retained, 1); nodes.at(-1).onended(); assert.equal(retained, 0); leaseSampler.noteOn(40, 127, 1); leaseSampler.releaseSamples(); assert.equal(retained, 0);
async function failure({ hasKey = () => true, decode = async () => { throw Error('SECRET_RAW_ERROR'); }, record: r = measured(1), error } = {}) {
  const status = [], requests = []; const rt = C.createRealSoundsRuntime({ cache: { get: async () => null }, hasKey, network: { freesoundPreview(id) { requests.push(id); if (error) throw error; return Uint8Array.of(id); } }, decode, onStatus: (s) => status.push(s) });
  const snap = await rt.prepareRealSounds(project([r]), 1); assert.deepEqual(snap.bassBank(44100), []); snap.release(); return { status, requests, rt };
}
const missing = await failure({ hasKey: () => false }); assert.deepEqual(missing.requests, []); assert.match(missing.status.at(-1).message, /önbellekte yok.*anahtar/);
assert.match((await failure({ decode: async () => { throw null; } })).status.at(-1).message, /çözülemedi/);
assert.match((await failure()).status.at(-1).message, /çözülemedi/); assert.ok(!JSON.stringify((await failure()).status).includes('SECRET_RAW_ERROR'));
assert.match((await failure({ error: new C.NetError('rate') })).status.at(-1).message, /429/);
const bad = await failure({ record: record(1), decode: async () => tone(33, { mode: 'noise' }) }); assert.match(bad.status.at(-1).message, /analizi başarısız/);
const legacyProject = project([record(1)]), legacy = C.createRealSoundsRuntime({ cache, network: {}, decode: async () => tone(33, { cents: -12.4 }) }); const remeasured = await legacy.prepareRealSounds(legacyProject, 1); assert.ok(Math.abs(remeasured.bassBank(44100)[0].midi - 32.876) < .01); assert.equal(legacyProject.realSounds.bass[0].rootMidi, undefined); remeasured.release();
const activity = []; let active = 0; const seq = C.createRealSoundsRuntime({ cache: { get: async (id) => ({ record: record(id), bytes: Uint8Array.of(id) }) }, decode: async (bytes) => { active++; assert.equal(active, 1); activity.push(bytes[0]); await Promise.resolve(); active--; return tone(28); } }); const multi = await seq.prepareRealSounds(project([measured(1), measured(2), measured(3)], { K: record(4) }), 1); assert.deepEqual(activity, [4, 1, 2, 3]); multi.release();
const bounded = C.createRealSoundsRuntime({ limit: 25000, cache, decode: async () => tone(28, { seconds: .5 }) }); const tight = await bounded.prepareRealSounds(project(), 1); assert.deepEqual(tight.bassBank(44100), []); assert.ok(bounded.stats().bytes <= 25000); tight.release();
const shared = C.createRealSoundsRuntime({ limit: 750000, cache: { get: async (id) => ({ record: record(id), bytes: Uint8Array.of(id) }) }, decode: async () => tone(28) }); const sharedSnap = await shared.prepareRealSounds(project([measured(1)], { K: record(2) }), 1); assert.ok(sharedSnap.bank(44100).K); assert.equal(sharedSnap.bassBank(48000).length, 1); assert.deepEqual(sharedSnap.bassSamples(ctx(48000)), []); assert.ok(shared.stats().bytes <= 750000); assert.equal(shared.reserve(750000), null); sharedSnap.release(); shared.invalidate(2); assert.equal(shared.stats().bytes, 0);
let resolve, began; const start = new Promise((r) => { began = r; }); const guarded = C.createRealSoundsRuntime({ cache: { get: async (id) => ({ record: record(id), bytes: Uint8Array.of(id) }) }, decode: async (bytes) => { if (bytes[0] === 1) { began(); await new Promise((r) => { resolve = r; }); } return tone(bytes[0] === 1 ? 28 : 33); } });
const staleWork = guarded.prepareRealSounds(project([measured(1)]), 1); await start; const current = await guarded.prepareRealSounds(project([measured(2, 33)]), 2); assert.equal(current.bassBank(44100)[0].midi, 33.03); resolve(); const stale = await staleWork; assert.equal(stale.stale, true); assert.deepEqual(stale.bassBank(44100), []); current.release();
// Davulun kapalı/yedek yolu da aynı paylaşılan hazırlıkta değişmeden kalır.
const events = [{ kind: 'K', t: .1, vel: .7 }]; assert.deepEqual(C.renderDrums(events, 1000, 1000, 1, off.bank(1000)), C.renderDrums(events, 1000, 1000));
console.log('bass-samples: fractional roots/pitch rates/ties/velocity, precedence/off, canonical rates/levels/cache/native leases, by-id/failures/analysis, stale generations, sequential preparation and shared resident cap passed');

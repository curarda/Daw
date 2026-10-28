import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore } from './load-core.mjs';
const { Core: C } = loadCore();
const record = (id, name = 'kick') => ({ id, name, author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, selector: 'fallback', why: '' });
const candidate = (id, patch = {}) => ({ record: record(id), duration: .1, tags: ['kick'], ...patch });
const pcm = (sampleRate = 1000, seconds = .1) => ({ channels: [Float32Array.from({ length: sampleRate * seconds }, (_, i) => .2 * Math.cos(i * .2))], sampleRate });
assert.deepEqual(Object.keys(C.LANE_SPECS).sort(), C.DRUM_KINDS.slice().sort());
for (const spec of Object.values(C.LANE_SPECS)) { assert.match(spec.query, /^[a-z ]+$/); assert.equal(spec.required, ['K', 'S', 'H'].includes(spec.kind)); assert.ok(spec.maxDuration <= 2); }
const ranked = C.rankCandidates(C.LANE_SPECS.K, [candidate(3), candidate(1), candidate(2), candidate(4, { tags: ['loop'] }), candidate(5, { duration: 3 }), candidate(6, { record: record(6, 'vocal kick') })]);
assert.deepEqual(ranked.map((c) => c.record.id), [1, 2, 3]);
assert.deepEqual(C.rankCandidates(C.LANE_SPECS.K, [...ranked].reverse()), ranked);
assert.equal(C.rankCandidates(C.LANE_SPECS.K, [candidate(2, { tags: [], duration: .05 }), candidate(1)])[0].record.id, 1);
assert.equal(C.rankCandidates(C.LANE_SPECS.K, [candidate(2, { duration: .2 }), candidate(1)])[0].record.id, 1);
assert.equal(C.rankCandidates(C.LANE_SPECS.H, [candidate(1, { record: record(1, 'open hihat') })]).length, 0);
for (const signal of [new Float32Array(100), new Float32Array(100).fill(.1), Float32Array.of(NaN), Float32Array.of(Infinity)]) assert.equal(C.validateDecoded([signal], 1000).ok, false);
assert.equal(C.validateDecoded(pcm(1000, 6.01), 1000).ok, false);
const trimmed = C.validateDecoded(pcm(1000, 4), 1000); assert.ok(trimmed.ok); assert.equal(trimmed.mono.length, 2000);
const leading = new Float32Array(110); leading.set(pcm().channels[0], 10);
const trim = C.validateDecoded([leading], 1000); assert.ok(trim.ok); assert.equal(trim.mono.length, 100); assert.equal(trim.mono[0], pcm().channels[0][0]);
const quiet = Float32Array.from({ length: 50 }, (_, i) => (i % 2 ? -1 : 1) * C.SOUND_TRIM_THRESHOLD / 2);
assert.equal(C.validateDecoded([quiet], 1000).ok, false);
const ch = pcm().channels[0], stereo = C.validateDecoded([ch, Float32Array.from(ch, (v) => v * .5)], 1000);
assert.ok(stereo.ok); assert.ok(Math.abs(stereo.mono[0] - ch[0] * .75) < 1e-7);
assert.equal(C.validateDecoded([ch, Float32Array.from(ch, (v) => -v)], 1000).ok, false);
function dependencies({ missing = [], invalidFirst = false, stop, sampleRate = 1000, seconds = .1, all = false } = {}) {
  const events = [], bytes = new Map(); let calls = 0, active = 0;
  const network = {
    async freesoundSearch(params) {
      assert.match(params.query, /^[a-z ]+$/); events.push('search'); calls++;
      assert.equal(active, 0, 'lanes and candidates are sequential');
      const lane = Object.values(C.LANE_SPECS).find((s) => s.query === params.query).kind;
      if (stop) stop(lane);
      if (missing.includes(lane) || (!all && !['K', 'S', 'H', 'C'].includes(lane))) return { candidates: [] };
      const id = C.DRUM_KINDS.indexOf(lane) * 10 + 1;
      return { candidates: invalidFirst ? [candidate(id), candidate(id + 1)] : [candidate(id)] };
    },
    async freesoundPreview(url) { events.push('fetch'); const id = Number(/\/(\d+)_test/.exec(url)[1]); return new Uint8Array([id]); }
  };
  return { network, decode: async (b) => { active++; events.push('decode'); await Promise.resolve(); active--; return invalidFirst && b[0] % 10 === 1 ? { channels: [new Float32Array(100)], sampleRate: 1000 } : pcm(sampleRate, seconds); }, cache: { async get(id, url) { return bytes.get(id + url); }, async put(r, b) { bytes.set(r.id + r.previewUrl, { record: r, bytes: b }); } }, events, calls: () => calls };
}
const deps = dependencies(), progress = [];
const happy = await C.selectDrumKit({ ...deps, onProgress: (s) => progress.push(s) });
assert.ok(happy.ok); assert.deepEqual(Object.keys(happy.kit), ['K', 'S', 'H', 'C']); assert.ok(happy.skipped.includes('O')); assert.ok(progress.length === C.DRUM_KINDS.length);
assert.ok(Object.values(happy.kit).every((r) => r.selector === 'fallback' && r.why === ''));
assert.equal(Object.values(happy.decoded).reduce((n, a) => n + a.byteLength, 0) <= C.SOUND_MEMORY_LIMIT, true);
const fetches = deps.events.filter((s) => s === 'fetch').length, searches = deps.calls();
assert.deepEqual((await C.selectDrumKit(deps)).kit, happy.kit); assert.equal(deps.calls(), searches); assert.equal(deps.events.filter((s) => s === 'fetch').length, fetches);
assert.deepEqual((await C.selectDrumKit(dependencies())).kit, happy.kit);
const missing = await C.selectDrumKit(dependencies({ missing: ['S'] })); assert.equal(missing.ok, false); assert.equal(missing.kit, null); assert.match(missing.reason, /S/);
const second = await C.selectDrumKit(dependencies({ invalidFirst: true })); assert.ok(second.ok); assert.equal(second.kit.K.id, 2);
let aborted = false; const abortedDeps = dependencies({ stop: (lane) => { if (lane === 'S') aborted = true; } });
const abort = await C.selectDrumKit({ ...abortedDeps, shouldAbort: () => aborted }); assert.equal(abort.ok, false); assert.equal(abort.kit, null); assert.equal(abortedDeps.calls(), 2);
const oversized = dependencies(); oversized.network.freesoundPreview = async () => new Uint8Array(1500001); let decodes = 0; oversized.decode = async () => { decodes++; return pcm(); };
assert.equal((await C.selectDrumKit(oversized)).ok, false); assert.equal(decodes, 0);
const memory = await C.selectDrumKit(dependencies({ sampleRate: 1000001, seconds: 2, all: true })); assert.equal(memory.ok, false); assert.equal(memory.kit, null);
const capped = await C.selectDrumKit(dependencies({ sampleRate: 900000, seconds: 2, all: true })); assert.ok(capped.ok); assert.deepEqual(Object.keys(capped.kit), ['K', 'S', 'H']); assert.ok(Object.values(capped.decoded).reduce((n, a) => n + a.byteLength, 0) <= C.SOUND_MEMORY_LIMIT);
const tries = dependencies(); tries.network.freesoundSearch = async () => ({ candidates: Array.from({ length: 20 }, (_, i) => candidate(i + 1)) }); tries.decode = async () => { decodes++; return { channels: [new Float32Array(100)], sampleRate: 1000 }; }; decodes = 0;
assert.equal((await C.selectDrumKit(tries)).ok, false); assert.equal(decodes, 5);
const shared = dependencies(); shared.network.freesoundSearch = async () => ({ results: [candidate(1)] }); let sharedDecodes = 0; shared.decode = async () => { sharedDecodes++; return pcm(); };
const common = await C.selectDrumKit(shared); assert.ok(common.ok); assert.equal(sharedDecodes, 1); assert.equal(common.decoded.K, common.decoded.S);
const settings = C.createSoundSettings(null); settings.set({ freesoundKey: 'FS_FAKE_KEY_SENTINEL_1234' });
const net = C.createNetwork({ settings, now: () => 100, sleep: async () => {}, fetch: async (url) => {
  assert.match(new URL(url).searchParams.get('fields'), /duration,tags/);
  return new Response(JSON.stringify({ results: [{ ...record(1), username: 'tester', duration: .2, tags: ['KICK', 'good-tag', '<script>', 'x'.repeat(25), ...Array.from({ length: 15 }, (_, i) => 'tag' + i)] }, { ...record(2), duration: '0.1' }] }));
} });
const result = await net.freesoundSearch(); assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].tags.length, 12); assert.equal(result.candidates[0].tags[0], 'kick'); assert.ok(result.candidates[0].tags.every((s) => /^[a-z0-9-]{1,24}$/.test(s)));
const p = C.newProject(), d = C.derive(p, { duration: 0, rawNotes: [] });
// Eski çekirdeği ayrı yükleyerek boş kredilerin çıktıyı hiç değiştirmediğini kanıtla.
const legacy = {}; new Function('globalThis', 'module', readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'))(legacy, undefined);
assert.equal(C.chordChart(p, d), legacy.Core.chordChart(p, d));
p.realSounds = { enabled: true, drums: { K: record(1, '<b>kick</b>\x00'), S: record(1) }, bass: [record(1)] };
assert.deepEqual(C.soundCredits(p), ['<b>kick</b> — tester — https://freesound.org/people/tester/sounds/1/ — CC0']); assert.ok(C.chordChart(p, d).endsWith(C.soundCredits(p)[0] + '\n'));
const state = C.captureVersionState(p, d); assert.deepEqual(state.realSounds, C.normalizeRealSounds(p.realSounds)); assert.ok(!JSON.stringify(state.realSounds).includes('channels'));
p.realSounds = C.normalizeRealSounds(null); assert.ok(C.applyVersionState(p, d, state).ok); assert.deepEqual(p.realSounds, state.realSounds);
state.realSounds.drums.K.license = 'bad'; assert.ok(C.applyVersionState(p, d, state).ok); assert.equal(p.realSounds.drums.K, undefined);
delete state.realSounds; assert.ok(C.applyVersionState(p, d, state).ok); assert.deepEqual(p.realSounds, C.normalizeRealSounds(null));
p.versions.items = [{ id: 'legacy', state }]; C.migrateVersions(p); assert.deepEqual(state.realSounds, C.normalizeRealSounds(null));
console.log('soundselect: vocabulary, ranking, PCM validation/trim, sequential selection/cache, abort, limits, credits and versions passed');

// Tek kanonik ses; her tüketici kendi örnekleme hızında değişmez bir banka tutar.
(function (root) {
const C = root.Core, DRUM_CANONICAL_RATE = 44100;
const empty = Object.freeze({});
function resampleDrum(input, from, to) {
  if (from === to) return input.slice();
  const out = new Float32Array(Math.max(1, Math.round(input.length * to / from)));
  const cutoff = Math.min(1, to / from), radius = Math.ceil(24 / cutoff);
  for (let i = 0; i < out.length; i++) {
    const p = i * from / to; let sum = 0, weight = 0;
    for (let j = Math.max(0, Math.ceil(p - radius)); j <= Math.min(input.length - 1, Math.floor(p + radius)); j++) {
      const d = j - p, x = Math.PI * d * cutoff;
      const w = (x === 0 ? cutoff : Math.sin(x) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos(Math.PI * d / radius));
      sum += input[j] * w; weight += w;
    }
    out[i] = Math.max(-1, Math.min(1, weight ? sum / weight : 0));
  }
  return out;
}
function drumRms(x) { let sum = 0; for (const v of x) sum += v * v; return Math.sqrt(sum / Math.max(1, x.length)); }
function normalizeDrumSample(mono, lane) {
  const target = C.synthDrum(lane, DRUM_CANONICAL_RATE), rms = drumRms(mono);
  let peak = 0, targetPeak = 0; for (const v of mono) peak = Math.max(peak, Math.abs(v)); for (const v of target) targetPeak = Math.max(targetPeak, Math.abs(v));
  const gain = Math.min(rms ? drumRms(target) / rms : 0, peak ? Math.min(0.95, targetPeak) / peak : 0);
  const out = new Float32Array(mono.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-0.95, Math.min(0.95, mono[i] * gain));
  return out;
}
function realDrumSignature(project) { const rs = C.normalizeRealSounds(project?.realSounds); return JSON.stringify([rs.enabled, Object.entries(rs.drums).map(([k, r]) => [k, r.id, r.previewUrl])]); }
const BASS_SAMPLE_RMS = .12, BASS_SAMPLE_PEAK = .8;
function normalizeBassSample(mono) {
  const rms = drumRms(mono); let peak = 0;
  for (const value of mono) peak = Math.max(peak, Math.abs(value));
  const gain = Math.min(rms ? BASS_SAMPLE_RMS / rms : 0, peak ? BASS_SAMPLE_PEAK / peak : 0);
  return Float32Array.from(mono, (v) => Math.max(-BASS_SAMPLE_PEAK, Math.min(BASS_SAMPLE_PEAK, v * gain)));
}
function bassSampleSource(track, userSamples, realSamples) {
  return track?.useSampler && userSamples?.length ? 'user' : realSamples?.length ? 'freesound' : 'synth';
}
function realSoundsSignature(project) {
  const rs = C.normalizeRealSounds(project?.realSounds);
  return JSON.stringify([realDrumSignature(project), rs.bass.map((r) => [r.id, r.previewUrl, r.rootMidi, r.rootCents, r.pitchConfidence, r.detectorVersion])]);
}
function createRealSoundsRuntime({ network, cache, decode, hasKey = () => true, onStatus = () => {}, limit = C.SOUND_MEMORY_LIMIT } = {}) {
  let generation = -1, signature = '', bytes = 0, clock = 0;
  const assets = new Map(), pending = new Map();
  function remove(key) { const a = assets.get(key); if (a) { bytes -= a.size; assets.delete(key); } }
  function invalidate(next) {
    generation = next; signature = '';
    for (const [key, a] of assets) { a.obsolete = true; if (!a.refs) remove(key); }
  }
  function room(n) {
    for (const [key, a] of [...assets].filter(([, a]) => !a.refs).sort((a, b) => a[1].used - b[1].used)) { if (bytes + n <= limit) break; remove(key); }
    return bytes + n <= limit;
  }
  function store(key, data, size = data.byteLength) { const a = { key, data, size, refs: 0, used: ++clock, obsolete: false }; assets.set(key, a); bytes += size; return a; }
  const idle = (stale = false) => Object.freeze({ stale, bank: () => empty, bassBank: () => Object.freeze([]), bassSamples: () => Object.freeze([]), retain: () => () => {}, release() {} });
  async function prepareRealSounds(project, nextGeneration, { skipBass = false } = {}) {
    if (nextGeneration < generation) return idle(true);
    const sig = realSoundsSignature(project) + (skipBass ? '|user' : '');
    if (generation !== nextGeneration || signature !== sig) { invalidate(nextGeneration); signature = sig; }
    const current = () => generation === nextGeneration && signature === sig;
    const rs = C.normalizeRealSounds(project?.realSounds);
    if (!rs.enabled || (!Object.keys(rs.drums).length && (!rs.bass.length || skipBass))) return idle();
    const held = new Set(), canonical = {}, bassCanonical = {}, banks = new Map(), bassBanks = new Map(), nativeBanks = new Map(); let released = false, owners = 1, ownerReleased = false;
    function pin(a) { if (!held.has(a)) { a.refs++; held.add(a); } a.used = ++clock; }
    function drop() { if (released || --owners > 0) return; released = true; banks.clear(); bassBanks.clear(); nativeBanks.clear(); for (const a of held) { a.refs--; if (!a.refs && a.obsolete && assets.get(a.key) === a) remove(a.key); } held.clear(); for (const lane of Object.keys(canonical)) delete canonical[lane]; for (const id of Object.keys(bassCanonical)) delete bassCanonical[id]; }
    function release() { if (!ownerReleased) { ownerReleased = true; drop(); } }
    function retain() { if (released) return () => {}; owners++; let done = false; return () => { if (!done) { done = true; drop(); } }; }
    const notify = (lane, state, message = '') => { if (current()) onStatus({ lane, state, message }); };
    for (const [lane, record] of [...Object.entries(rs.drums), ...(skipBass ? [] : rs.bass.map((r) => ['bass:' + r.id, r]))]) {
      const isBass = lane.startsWith('bass:');
      if (!current()) { release(); return idle(true); }
      notify(lane, 'hazırlanıyor');
      const key = (isBass ? 'bass-mono|' : 'mono|') + nextGeneration + '|' + sig + '|' + record.id + '|' + record.previewUrl;
      let a = assets.get(key);
      try {
        if (!a || a.obsolete) {
          const pendingKey = nextGeneration + '|' + sig + '|' + key;
          if (!pending.has(pendingKey)) {
            const task = (async () => {
              let entry;
              try { entry = await cache?.get(record.id, record.previewUrl); } catch (_) {}
              if (!current()) return null;
              const cached = C.normalizeSoundRecord(entry?.record);
              let data = cached?.id === record.id && cached.previewUrl === record.previewUrl ? entry.bytes : null;
              if (!(data instanceof Uint8Array)) {
                if (!hasKey()) throw new C.NetError('missing');
                data = await network.freesoundPreview(record.id);
                if (!current()) return null;
                if (!(data instanceof Uint8Array) || data.byteLength > 1500000) throw new C.NetError('size');
                try { await cache?.put(record, data); } catch (_) {}
              }
              if (data.byteLength > 1500000) throw new C.NetError('size');
              if (!current()) return null;
              let pcm = await decode(data);
              if (!current()) return null;
              const valid = C.validateDecoded(pcm, pcm?.sampleRate, isBass ? 4 : 2); pcm = null;
              if (!valid.ok) throw new Error('decode');
              let measured = record;
              if (isBass && record.needsAnalysis) {
                const pitch = await C.analyzeBassSample([valid.mono], valid.sampleRate);
                if (!current()) return null;
                if (!pitch.ok) throw new Error('analysis');
                measured = C.normalizeBassSoundRecord({ ...record, ...pitch });
              }
              if (isBass && measured.needsAnalysis) throw new Error('analysis');
              const n = Math.max(1, Math.round(valid.mono.length * DRUM_CANONICAL_RATE / valid.sampleRate)) * 4;
              if (!room(n)) throw new Error('memory');
              const resampled = resampleDrum(valid.mono, valid.sampleRate, DRUM_CANONICAL_RATE);
              const mono = isBass ? normalizeBassSample(resampled) : normalizeDrumSample(resampled, lane);
              if (!current()) return null;
              const asset = store(key, mono);
              if (isBass) asset.midi = measured.rootMidi + measured.rootCents / 100;
              return asset;
            })().finally(() => pending.delete(pendingKey));
            pending.set(pendingKey, task);
          }
          a = await pending.get(pendingKey);
        }
        if (!current()) { release(); return idle(true); }
        if (!a) continue;
        pin(a); if (isBass) bassCanonical[record.id] = a; else canonical[lane] = a;
        notify(lane, 'gerçek');
      } catch (e) {
        const fallback = isBass ? 'Sentetik bas kullanılıyor.' : 'Sentetik davul kullanılıyor.';
        const message = e instanceof C.NetError ? (e.code === 'missing' ? 'Ses önbellekte yok. ' : '') + e.message + ' ' + fallback : (e?.message === 'analysis' ? 'Bas perde analizi başarısız. ' : 'Ses çözülemedi veya bellek sınırı aşıldı. ') + fallback;
        notify(lane, 'hata', lane + ': ' + message);
      }
    }
    if (!current()) { release(); return idle(true); }
    return Object.freeze({ stale: false,
      bank(rate) {
        if (released || !Number.isSafeInteger(rate) || rate <= 0) return empty;
        if (banks.has(rate)) return banks.get(rate);
        const bank = {};
        for (const [lane, a] of Object.entries(canonical)) {
          const key = 'bank|' + nextGeneration + '|' + sig + '|' + rate + '|' + lane;
          let prepared = assets.get(key);
          if (!prepared) {
            const n = Math.max(1, Math.round(a.data.length * rate / DRUM_CANONICAL_RATE)) * 4;
            if (!room(n)) { notify(lane, 'hata', lane + ': Bellek sınırı; sentetik davul kullanılıyor.'); continue; }
            const normalized = normalizeDrumSample(a.data, lane);
            prepared = store(key, resampleDrum(normalized, DRUM_CANONICAL_RATE, rate)); prepared.obsolete = !current();
          }
          pin(prepared); bank[lane] = prepared.data;
        }
        const frozen = Object.freeze(bank); banks.set(rate, frozen); return frozen;
      },
      bassBank(rate) {
        if (released || !Number.isSafeInteger(rate) || rate <= 0) return Object.freeze([]);
        if (bassBanks.has(rate)) return bassBanks.get(rate);
        const samples = [];
        for (const [id, a] of Object.entries(bassCanonical)) {
          const key = 'bass-bank|' + nextGeneration + '|' + sig + '|' + rate + '|' + id;
          let prepared = assets.get(key);
          if (!prepared) {
            const n = Math.max(1, Math.round(a.data.length * rate / DRUM_CANONICAL_RATE)) * 4;
            if (!room(n)) { notify('bass:' + id, 'hata', 'Bas: Bellek sınırı; sentetik bas kullanılıyor.'); continue; }
            prepared = store(key, resampleDrum(a.data, DRUM_CANONICAL_RATE, rate)); prepared.obsolete = !current();
          }
          pin(prepared); samples.push(Object.freeze({ id: Number(id), midi: a.midi, data: prepared.data }));
        }
        const frozen = Object.freeze(samples); bassBanks.set(rate, frozen); return frozen;
      },
      bassSamples(ctx) {
        const rate = ctx.sampleRate;
        if (released) return Object.freeze([]);
        if (nativeBanks.has(rate)) return nativeBanks.get(rate);
        const samples = [];
        for (const sample of this.bassBank(rate)) {
          const key = 'bass-audio|' + nextGeneration + '|' + sig + '|' + rate + '|' + sample.id;
          let native = assets.get(key);
          try {
            if (!native) {
              if (!room(sample.data.byteLength)) throw new Error('memory');
              const buffer = ctx.createBuffer(1, sample.data.length, rate); buffer.copyToChannel(sample.data, 0);
              native = store(key, buffer, sample.data.byteLength); native.obsolete = !current();
            }
            pin(native); samples.push(Object.freeze({ midi: sample.midi, buffer: native.data }));
          } catch (_) { notify('bass:' + sample.id, 'hata', 'Bas tamponu hazırlanamadı veya bellek sınırı aşıldı; sentetik bas kullanılıyor.'); }
        }
        const frozen = Object.freeze(samples); nativeBanks.set(rate, frozen); return frozen;
      }, retain, release
    });
  }
  function reserve(n) {
    if (!Number.isSafeInteger(n) || n < 0 || !room(n)) return null;
    bytes += n; let released = false;
    return () => { if (!released) { released = true; bytes -= n; } };
  }
  return { prepareRealSounds, invalidate, reserve, stats: () => ({ bytes, limit, entries: assets.size, generation }) };
}
Object.assign(C, { DRUM_CANONICAL_RATE, BASS_SAMPLE_RMS, BASS_SAMPLE_PEAK, normalizeBassSample, bassSampleSource, realSoundsSignature, resampleDrum, normalizeDrumSample, realDrumSignature, createRealSoundsRuntime });
})(typeof window !== 'undefined' ? window : globalThis);

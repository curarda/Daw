// Sabit sözlükle seçim; çözülmüş sesler yalnızca bu işlemin belleğinde yaşar.
(function (root) {
const C = root.Core;
const SOUND_TRIM_THRESHOLD = 0.001, SOUND_RMS_THRESHOLD = 0.0001, SOUND_MEMORY_LIMIT = 24000000;
const rejected = ['loop', 'loops', 'break', 'breakbeat', 'pattern', 'melody', 'vocal', 'vocals'];
const vocabulary = {
  K: ['kick drum', ['kick', 'bass-drum']], S: ['snare drum', ['snare']], H: ['closed hihat', ['closed', 'hihat', 'hi-hat']],
  O: ['open hihat', ['open', 'hihat']], F: ['floor tom', ['floor', 'tom']], T: ['rack tom', ['rack', 'tom']],
  C: ['hand clap', ['clap']], R: ['rim click', ['rim', 'click']], D: ['ride cymbal', ['ride', 'cymbal']], P: ['pedal hihat', ['pedal', 'hihat']]
};
const LANE_SPECS = Object.freeze(Object.fromEntries(C.DRUM_KINDS.map((kind) => [kind, Object.freeze({ kind, required: ['K', 'S', 'H'].includes(kind), query: vocabulary[kind][0], minDuration: 0.05, maxDuration: 2, preferredTags: Object.freeze(vocabulary[kind][1]), rejectedTags: Object.freeze([...rejected, ...(kind === 'H' ? ['open'] : [])]) })])));
function normalizeSoundCandidate(raw) {
  const record = C.normalizeSoundRecord(raw?.record);
  if (!record || !Number.isFinite(raw.duration) || raw.duration < 0 || raw.duration > 6) return null;
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).filter((t) => typeof t === 'string').map((t) => t.toLowerCase()).filter((t) => /^[a-z0-9-]{1,24}$/.test(t)))].slice(0, 12);
  return { record, duration: raw.duration, tags };
}
function rankCandidates(spec, candidates) {
  if (!spec || !Array.isArray(candidates)) return [];
  return candidates.slice(0, 30).map(normalizeSoundCandidate).filter(Boolean).filter((c) => {
    const words = c.record.name.toLowerCase().split(/[^a-z0-9-]+/);
    return c.duration >= spec.minDuration && c.duration <= spec.maxDuration && !spec.rejectedTags.some((t) => c.tags.includes(t) || words.includes(t));
  }).map((candidate) => ({ candidate, score: spec.preferredTags.reduce((n, tag) => n + (candidate.tags.includes(tag) ? 4 : 0) + (candidate.record.name.toLowerCase().split(/[^a-z0-9-]+/).includes(tag) ? 2 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.candidate.duration - b.candidate.duration || a.candidate.record.id - b.candidate.record.id).map((v) => v.candidate);
}
function validateDecoded(pcm, sampleRate) {
  const fail = (reason) => ({ ok: false, reason, mono: null, sampleRate });
  const channels = Array.isArray(pcm) ? pcm : pcm?.channels;
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Array.isArray(channels) || !channels.length || !channels[0]?.length) return fail('Ses verisi geçersiz.');
  const length = channels[0].length;
  if (length > sampleRate * 6 || channels.some((c) => !c || c.length !== length)) return fail('Ses en fazla 6 saniye olmalı.');
  // Önce boyut ve örnekleri denetle; pahalı kopyalama bundan sonra.
  for (const channel of channels) for (let i = 0; i < length; i++) if (!Number.isFinite(channel[i])) return fail('Ses sonlu olmayan örnekler içeriyor.');
  const mixed = (i) => channels.reduce((sum, c) => sum + c[i] / channels.length, 0);
  let start = 0; while (start < length && Math.abs(mixed(start)) < SOUND_TRIM_THRESHOLD) start++;
  const end = Math.min(length, start + sampleRate * 2);
  if (start >= end) return fail('Ses sessiz.');
  let sum = 0, square = 0, min = Infinity, max = -Infinity;
  for (let i = start; i < end; i++) { const v = mixed(i); if (!Number.isFinite(v)) return fail('Ses geçersiz.'); sum += v; square += v * v; min = Math.min(min, v); max = Math.max(max, v); }
  const count = end - start, rms = Math.sqrt(square / count), variance = square / count - (sum / count) ** 2;
  if (!Number.isFinite(rms) || rms < SOUND_RMS_THRESHOLD) return fail('Ses çok kısık.');
  if (max - min < SOUND_TRIM_THRESHOLD || variance < SOUND_RMS_THRESHOLD ** 2) return fail('Ses sabit/DC sinyal içeriyor.');
  const mono = new Float32Array(count); for (let i = 0; i < count; i++) { mono[i] = mixed(start + i); if (!Number.isFinite(mono[i])) return fail('Ses geçersiz.'); }
  return { ok: true, reason: '', mono, sampleRate };
}
const searches = new WeakMap();
async function selectDrumKit({ network, decode, cache, shouldAbort = () => false, onProgress = () => {}, orderCandidates = (spec, candidates) => candidates }) {
  const kit = {}, decoded = {}, sampleRates = {}, skipped = [], chosen = new Map(); let resident = 0;
  const fail = (reason) => ({ ok: false, reason, kit: null });
  const cancelled = () => shouldAbort();
  if (!searches.has(network)) searches.set(network, new Map());
  const searchCache = searches.get(network);
  for (const spec of Object.values(LANE_SPECS)) {
    if (cancelled()) return fail('Seçim iptal edildi.');
    onProgress(spec.kind + ': CC0 ses aranıyor…');
    let candidates = [];
    try {
      const saved = searchCache.get(spec.kind);
      if (saved && Date.now() - saved.time < 600000) candidates = saved.candidates;
      else {
        const result = await network.freesoundSearch({ query: spec.query, minDuration: spec.minDuration, maxDuration: spec.maxDuration, pageSize: 20, fields: ['duration', 'tags'] });
        if (cancelled()) return fail('Seçim iptal edildi.');
        candidates = (result.candidates || result.results || []).slice(0, 30).map(normalizeSoundCandidate).filter(Boolean);
        searchCache.set(spec.kind, { time: Date.now(), candidates });
      }
    } catch (_) { if (spec.required) return fail(spec.kind + ': CC0 ses aranamadı; bağlantını ve anahtarını kontrol et.'); }
    for (const candidate of orderCandidates(spec, rankCandidates(spec, candidates)).slice(0, 5)) {
      if (cancelled()) return fail('Seçim iptal edildi.');
      const record = C.normalizeSoundRecord({ ...candidate.record, selector: 'fallback', why: '' });
      if (!record) continue;
      const key = record.id + '|' + record.previewUrl;
      try {
        let valid = chosen.get(key);
        if (!valid) {
          let entry = await cache?.get(record.id, record.previewUrl);
          if (cancelled()) return fail('Seçim iptal edildi.');
          let bytes = entry?.bytes;
          if (!(bytes instanceof Uint8Array)) bytes = await network.freesoundPreview(record.previewUrl);
          entry = null;
          if (cancelled()) return fail('Seçim iptal edildi.');
          if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1500000) continue;
          await cache?.put(record, bytes);
          if (cancelled()) return fail('Seçim iptal edildi.');
          let pcm = await decode(bytes);
          if (cancelled()) return fail('Seçim iptal edildi.');
          // Çıktı sınırını aşacak bir ses için mono tampon ayırma.
          if (resident + Math.min(pcm?.channels?.[0]?.length || 0, (pcm?.sampleRate || 0) * 2) * 4 > SOUND_MEMORY_LIMIT) { pcm = null; continue; }
          valid = validateDecoded(pcm, pcm?.sampleRate); pcm = null;
          if (!valid.ok) continue;
          if (resident + valid.mono.byteLength > SOUND_MEMORY_LIMIT) continue;
          resident += valid.mono.byteLength; chosen.set(key, valid);
        }
        kit[spec.kind] = record; decoded[spec.kind] = valid.mono; sampleRates[spec.kind] = valid.sampleRate;
        break;
      } catch (_) { /* Başarısız adaydan sonra sıradakini dene. */ }
    }
    if (cancelled()) return fail('Seçim iptal edildi.');
    if (!kit[spec.kind]) { if (spec.required) return fail(spec.kind + ': Uygun CC0 tek vuruş bulunamadı; tekrar dene.'); skipped.push(spec.kind); }
  }
  return { ok: true, kit, decoded, sampleRates, skipped };
}
Object.assign(C, { LANE_SPECS, SOUND_TRIM_THRESHOLD, SOUND_RMS_THRESHOLD, SOUND_MEMORY_LIMIT, normalizeSoundCandidate, rankCandidates, validateDecoded, selectDrumKit });
})(typeof window !== 'undefined' ? window : globalThis);

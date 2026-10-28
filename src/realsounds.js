// Her girişte yalnızca izin verilen kimlik ve kredi alanlarını tut.
(function (root) {
const C = root.Core;
const text = (v, n) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, n) : '';
function normalizeSoundRecord(raw, kind) {
  if (kind === 'bass') return normalizeBassSoundRecord(raw);
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0) return null;
  const { id } = raw;
  if (typeof raw.url !== 'string' || !new RegExp('^https://freesound\\.org/people/[A-Za-z0-9._~-]+/sounds/' + id + '/$').test(raw.url)) return null;
  if (typeof raw.previewUrl !== 'string' || !/^https:\/\/cdn\.freesound\.org\/previews\/[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(raw.previewUrl)) return null;
  if (typeof raw.license !== 'string' || !/^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/$/.test(raw.license)) return null;
  return { id, name: text(raw.name, 120), author: text(raw.author, 120), url: raw.url, license: 'https://creativecommons.org/publicdomain/zero/1.0/', previewUrl: raw.previewUrl, selector: raw.selector === 'gemini' ? 'gemini' : 'fallback', why: text(raw.why, 160) };
}
function normalizeBassSoundRecord(raw) {
  const record = normalizeSoundRecord(raw);
  if (!record) return null;
  if (['rootMidi', 'rootCents', 'pitchConfidence', 'detectorVersion'].every((key) => Object.hasOwn(raw, key)) && Number.isInteger(raw.rootMidi) && raw.rootMidi >= 24 && raw.rootMidi <= 60 && Number.isFinite(raw.rootCents) && Math.abs(raw.rootCents) <= 50 && Number.isFinite(raw.pitchConfidence) && raw.pitchConfidence >= 0 && raw.pitchConfidence <= 1 && Number.isSafeInteger(raw.detectorVersion) && raw.detectorVersion > 0) {
    return { ...record, rootMidi: raw.rootMidi, rootCents: raw.rootCents, pitchConfidence: raw.pitchConfidence, detectorVersion: raw.detectorVersion };
  }
  // Eski kimlik/kredi korunur; ölçülmemiş perde geçerli örnek sayılmaz.
  Object.defineProperty(record, 'needsAnalysis', { value: true });
  return record;
}
function normalizeRealSounds(v) {
  const out = { enabled: v?.enabled === true, drums: {}, bass: [] };
  for (const kind of C.DRUM_KINDS) if (Object.hasOwn(v?.drums || {}, kind)) { const r = normalizeSoundRecord(v.drums[kind]); if (r) out.drums[kind] = r; }
  if (Array.isArray(v?.bass)) out.bass = v.bass.map(normalizeBassSoundRecord).filter(Boolean).slice(0, 3);
  return out;
}
function soundCredits(proj) {
  const sounds = normalizeRealSounds(proj?.realSounds), seen = new Set();
  return [...Object.values(sounds.drums), ...sounds.bass].filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; }).map((r) => `${r.name} — ${r.author} — ${r.url} — CC0`);
}
const chart = C.chordChart;
C.chordChart = (proj, d) => { const credits = soundCredits(proj); return chart(proj, d) + (credits.length ? '\nGerçek sesler (CC0):\n' + credits.join('\n') + '\n' : ''); };
const fresh = C.newProject, migrate = C.migrateMatrix;
C.newProject = () => ({ ...fresh(), realSounds: normalizeRealSounds(null) });
C.migrateMatrix = (p) => { p.realSounds = normalizeRealSounds(p.realSounds); return migrate(p); };
Object.assign(C, { normalizeSoundRecord, normalizeBassSoundRecord, normalizeRealSounds, soundCredits });
})(typeof window !== 'undefined' ? window : globalThis);

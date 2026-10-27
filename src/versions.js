// Sürüm arşivi yalnızca düzenlemeyi saklar; kayıt, tonlar ve bölüm sınırları ortaktır.
(function (root) {
const C = root.Core, B = C.Bass;
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const fields = ['signature', 'sections', 'pack', 'matrix', 'drums', 'piano', 'guitar', 'bass', 'swing', 'chordOpts', 'chordStartBar', 'preserveChords', 'chordLocks', 'chordPins', 'changeMarks', 'chordChoices', 'mixer'];
const globals = ['pack', 'matrix', 'drums', 'piano', 'guitar', 'swing', 'chordOpts', 'chordStartBar', 'preserveChords'];
const mixerKeys = ['vocal', 'piano', 'guitar', 'bass', 'drums', 'pedal', 'touched'];
const fail = (reason) => ({ ok: false, warnings: [reason] });
const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const validChord = (c) => object(c) && Number.isFinite(c.root) && typeof c.q === 'string' && Object.prototype.hasOwnProperty.call(C.CHORD_Q, c.q);
function migrateVersions(proj) {
  const v = proj.versions || {};
  proj.versions = { activeId: v.activeId ?? null, items: Array.isArray(v.items) ? v.items : [] };
  for (const item of proj.versions.items) if (object(item.state)) {
    if (item.state.preserveChords === undefined) item.state.preserveChords = false;
    if (object(item.state.pack) && item.state.pack.selectedId === undefined) item.state.pack.selectedId = null;
  }
  return proj;
}
function versionSignature(proj, d) {
  return [proj.settings.meter, ...d.sections.map((s) => `${s.id}:${s.endBar - s.startBar + 1}`)];
}
function anchor(d, bar) {
  const s = d.sections.find((s) => bar >= s.startBar && bar <= s.endBar);
  return s ? { sectionId: s.id, relBar: bar - s.startBar } : null;
}
function atAnchor(d, a) {
  const s = a && d.sections.find((s) => s.id === a.sectionId);
  if (!s || !Number.isInteger(a.relBar) || a.relBar < 0 || a.relBar > s.endBar - s.startBar) throw new Error('Sürümde geçersiz bölüm ölçüsü var.');
  return s.startBar + a.relBar;
}
const selectMap = (map, ids) => Object.fromEntries(Object.entries(map || {}).filter(([id]) => ids.has(id)).map(([id, value]) => [id, clone(value)]));
function relativeRecords(proj, d, key, links) {
  return (proj[key] || []).flatMap((record) => {
    const a = anchor(d, record.bar);
    if (!a || links[a.sectionId]) return [];
    const { bar, ...rest } = record;
    return [{ ...clone(rest), ...a }];
  });
}
function captureBass(proj, d, links) {
  if (!proj.bass) return null;
  const track = clone(proj.bass);
  B.ensureBars(track, B.bassContext(d, proj));
  const { bars = [], loops = [], sections = {}, ...settings } = track;
  const independent = new Set(d.sections.filter((s) => !links[s.id]).map((s) => s.id));
  return { ...clone(settings), sections: selectMap(sections, independent),
    bars: bars.flatMap((bar, i) => {
      const a = anchor(d, i + 1);
      if (!a || links[a.sectionId]) return [];
      // İmza ve kirli bayrağı türetilir; mutlak ölçü/ton bilgisi sürüme taşınmaz.
      const { index, sectionId, sig, dirtyLocked, ...content } = bar;
      return [{ ...clone(content), ...a }];
    }),
    loops: loops.flatMap((loop) => {
      const sources = B.loopSourceBars(loop).map((i) => anchor(d, i + 1)), targets = B.loopTargetBars(loop).map((i) => anchor(d, i + 1));
      if ([...sources, ...targets].some((a) => !a || links[a.sectionId])) return [];
      const { sourceStart, targetStart, targetEnd, sourceBars, targetBars, syncSig, ...rest } = loop;
      return [{ ...clone(rest), sourceStart: sources[0], targetStart: targets[0], targetEnd: targets.at(-1), sourceBars: sources, targetBars: targets }];
    }) };
}
function captureVersionState(proj, d) {
  const links = C.resolveLinks(proj, d), ids = new Set(d.sections.map((s) => s.id));
  const state = { signature: versionSignature(proj, d), sections: Object.fromEntries(d.sections.map((s) => {
    const own = proj.sections.find((x) => x.id === s.id);
    return [s.id, { arr: clone(own?.arr || {}), link: links[s.id] ? clone(own.link) : null }];
  })) };
  for (const key of globals) state[key] = clone(proj[key]);
  state.matrix.rows = selectMap(state.matrix.rows, ids);
  state.guitar.parts = selectMap(state.guitar.parts, new Set(['_all', ...ids]));
  // Aynı ayarlı ayrı partiler, akor seçimleri geri gelince aynı seslendirme grubu olmaz.
  const groups = new Map();
  state.guitar.voiceGroups = Object.fromEntries(d.sections.map((s) => {
    const key = C.guitarGroupKey(proj, d, s.id, C.guitarPartFor(proj.guitar, s.id, proj, d));
    if (!groups.has(key)) groups.set(key, groups.size);
    return [s.id, groups.get(key)];
  }));
  state.bass = captureBass(proj, d, links);
  for (const key of ['chordLocks', 'chordPins', 'changeMarks']) state[key] = relativeRecords(proj, d, key, links);
  state.chordChoices = d.sections.filter((s) => !links[s.id]).flatMap((s) => C.captureChordChoices(proj, d, s.id));
  state.mixer = Object.fromEntries(mixerKeys.filter((key) => Object.prototype.hasOwnProperty.call(proj.mixer, key)).map((key) => [key, clone(proj.mixer[key])]));
  return state;
}
function captureWarnings(proj, d) {
  const outside = ['chordLocks', 'chordPins', 'changeMarks'].some((key) => (proj[key] || []).some((r) => !anchor(d, r.bar)))
    || (proj.bass?.bars || []).some((bar, i) => !anchor(d, i + 1))
    || (proj.bass?.loops || []).some((loop) => [...B.loopSourceBars(loop), ...B.loopTargetBars(loop)].some((i) => !anchor(d, i + 1)));
  return [...C.resolveLinks(proj, d).warnings, ...(outside ? ['Bölüm dışındaki ölçü içeriği sürümlere alınmaz; boşluklardaki içerik hariç bırakıldı.'] : [])];
}
function signatureCompat(proj, d, state) {
  if (!state || JSON.stringify(versionSignature(proj, d)) !== JSON.stringify(state.signature)) return fail('Sürüm uygulanamadı: ölçü türü, bölüm sırası, kimlikleri veya ölçü uzunlukları değişmiş.');
  return { ok: true, warnings: [] };
}
function restoreBass(saved, d) {
  if (!saved) return null;
  if (!Array.isArray(saved.bars) || !Array.isArray(saved.loops)) throw new Error('Sürümde geçersiz bas izi var.');
  if (!object(saved.sections) || !object(saved.range)) throw new Error('Sürümde geçersiz bas ayarları var.');
  const track = clone(saved), occupied = new Set();
  track.bars = Array.from({ length: d.bars }, (_, i) => B.emptyBar(i, anchor(d, i + 1)?.sectionId));
  for (const bar of saved.bars) {
    const { relBar, sectionId, ...content } = bar, index = atAnchor(d, bar) - 1;
    if (!Array.isArray(bar.notes) || occupied.has(index)) throw new Error('Sürümde geçersiz bas ölçüsü var.');
    occupied.add(index);
    track.bars[index] = { ...clone(content), index, sectionId, sig: '' };
  }
  track.loops = saved.loops.map((loop) => {
    if (!Array.isArray(loop.sourceBars) || !Array.isArray(loop.targetBars) || loop.sourceLength !== loop.sourceBars.length || ![1, 2, 3, 4, 5, 6, 7, 8].includes(loop.sourceLength) || !loop.targetBars.length || !['exact', 'follow-chords'].includes(loop.mode)) throw new Error('Sürümde geçersiz bas döngüsü var.');
    const sources = loop.sourceBars.map((a) => atAnchor(d, a) - 1), targets = loop.targetBars.map((a) => atAnchor(d, a) - 1);
    const ordered = (values) => values.every((v, i) => !i || v > values[i - 1]);
    if (!ordered(sources) || !ordered(targets) || targets[0] <= sources.at(-1)) throw new Error('Sürümde çakışan bas döngüsü var.');
    if (atAnchor(d, loop.sourceStart) - 1 !== sources[0] || atAnchor(d, loop.targetStart) - 1 !== targets[0] || atAnchor(d, loop.targetEnd) - 1 !== targets.at(-1)) throw new Error('Sürümde tutarsız bas döngüsü var.');
    const { sourceBars, targetBars, ...rest } = clone(loop);
    const restored = { ...rest, sourceStart: sources[0], targetStart: targets[0], targetEnd: targets.at(-1) };
    // Araya boşluk girmişse döngü yalnızca özgün bölüm ölçülerini izler.
    if (sources.some((v, i) => v !== sources[0] + i)) restored.sourceBars = sources;
    if (targets.some((v, i) => v !== targets[0] + i)) restored.targetBars = targets;
    return restored;
  });
  return track;
}
function applyVersionState(proj, d, state) {
  const compat = signatureCompat(proj, d, state);
  if (!compat.ok) return compat;
  try {
    if (fields.some((key) => !Object.prototype.hasOwnProperty.call(state, key)) || Object.keys(state).some((key) => !fields.includes(key))) throw new Error('Sürümde geçersiz düzenleme alanları var.');
    const saved = clone(state), q = clone(proj), warnings = captureWarnings(proj, d);
    if (['sections', 'pack', 'matrix', 'drums', 'piano', 'guitar', 'swing', 'chordOpts', 'mixer'].some((key) => !object(saved[key])) || !object(saved.matrix.rows) || !object(saved.guitar.parts) || !object(saved.guitar.parts._all) || !Number.isInteger(saved.chordStartBar) || saved.chordStartBar < 1) throw new Error('Sürümde geçersiz katman ayarları var.');
    if (Object.keys(saved.mixer).some((key) => !mixerKeys.includes(key))) throw new Error('Sürümde geçersiz mikser alanı var.');
    if (Object.keys(saved.sections).length !== d.sections.length) throw new Error('Sürümün bölüm listesi eksik veya fazla.');
    for (const s of d.sections) {
      const content = saved.sections[s.id];
      if (!object(content) || !object(content.arr) || !Object.prototype.hasOwnProperty.call(content, 'link') || Object.keys(content).some((key) => !['arr', 'link'].includes(key)) || content.link != null && (!object(content.link) || typeof content.link.sourceId !== 'string' || Object.keys(content.link).length !== 1)) throw new Error('Sürümde geçersiz bölüm ayarları var.');
    }
    for (const s of q.sections) {
      const content = saved.sections[s.id];
      if (!content || Object.keys(content).some((key) => !['arr', 'link'].includes(key))) throw new Error('Sürümde geçersiz bölüm ayarları var.');
      s.arr = clone(content.arr); s.link = clone(content.link);
    }
    for (const key of globals) q[key] = clone(saved[key]);
    for (const key of ['chordLocks', 'chordPins', 'changeMarks']) {
      if (!Array.isArray(saved[key])) throw new Error('Sürümde geçersiz akor verisi var.');
      q[key] = saved[key].map((record) => {
        const { sectionId, relBar, ...rest } = record;
        if (key !== 'changeMarks' && !validChord(record.chord)) throw new Error('Sürümde geçersiz akor var.');
        return { ...rest, bar: atAnchor(d, record) };
      });
    }
    if (!Array.isArray(saved.chordChoices)) throw new Error('Sürümde geçersiz akor seçimleri var.');
    for (const choice of saved.chordChoices) {
      atAnchor(d, choice);
      if (![0, 1].includes(choice.half) || !['auto', 'lock', 'pin'].includes(choice.state) || !validChord(choice.chord)) throw new Error('Sürümde geçersiz akor seçimi var.');
    }
    q.chordChoices = clone(saved.chordChoices);
    for (const key of mixerKeys) {
      if (Object.prototype.hasOwnProperty.call(saved.mixer, key)) q.mixer[key] = clone(saved.mixer[key]);
      else if (key === 'touched') delete q.mixer.touched;
    }
    const links = C.resolveLinks(q, d);
    if (links.warnings.length) throw new Error(links.warnings.join(' '));
    q.bass = restoreBass(saved.bass, d);
    if (q.bass) {
      const resolved = { ...d, chords: clone(d.chords) };
      C.resolveLinkedChords(q, resolved);
      const ctx = B.bassContext(resolved, q);
      B.ensureBars(q.bass, ctx);
      for (const bar of q.bass.bars) bar.sig = B.barSig(ctx, q.bass, bar.index);
      q.bass = C.resolvedBass(q, resolved);
      for (const loop of q.bass.loops) loop.syncSig = B.loopSyncSig(q.bass, ctx, loop);
    }
    // pinSig uygulamaya aittir; 4b refresh'ten önce yeni imzayı yazmalıdır.
    Object.assign(proj, q);
    return { ok: true, warnings, needsPinSigRefresh: true };
  } catch (e) { return fail('Sürüm uygulanamadı: ' + e.message); }
}
const items = (proj) => proj.versions?.items || [];
function versionCompat(proj, d, id) {
  const item = items(proj).find((v) => v.id === id);
  return item ? signatureCompat(proj, d, item.state) : fail('Sürüm bulunamadı.');
}
function validName(proj, name, id) {
  if (typeof name !== 'string' || !name.trim()) return fail('Sürüm adı boş olamaz.');
  if (items(proj).some((v) => v.id !== id && v.name === name.trim())) return fail('Bu sürüm adı zaten kullanılıyor.');
  return { ok: true, warnings: [] };
}
function autoName(proj) {
  for (let round = 1; ; round++) for (let i = 0; i < 26; i++) {
    const name = String.fromCharCode(65 + i) + (round === 1 ? '' : round);
    if (!items(proj).some((v) => v.name === name)) return name;
  }
}
function saveVersion(proj, d, name) {
  name = name == null ? autoName(proj) : name;
  const check = validName(proj, name);
  if (!check.ok) return check;
  try {
    const state = captureVersionState(proj, d), warnings = captureWarnings(proj, d);
    let n = 1; while (items(proj).some((v) => v.id === 'ver-' + n)) n++;
    const id = 'ver-' + n;
    proj.versions = { activeId: id, items: [...items(proj), { id, name: name.trim(), state }] };
    return { ok: true, id, warnings };
  } catch (e) { return fail('Sürüm kaydedilemedi: ' + e.message); }
}
function updateVersion(proj, d, id) {
  if (!items(proj).some((v) => v.id === id)) return fail('Sürüm bulunamadı.');
  try {
    const state = captureVersionState(proj, d), warnings = captureWarnings(proj, d);
    proj.versions.items = items(proj).map((v) => v.id === id ? { ...v, state } : v);
    return { ok: true, id, warnings };
  } catch (e) { return fail('Sürüm güncellenemedi: ' + e.message); }
}
function renameVersion(proj, id, name) {
  if (!items(proj).some((v) => v.id === id)) return fail('Sürüm bulunamadı.');
  const check = validName(proj, name, id);
  if (!check.ok) return check;
  proj.versions.items = items(proj).map((v) => v.id === id ? { ...v, name: name.trim() } : v);
  return { ok: true, warnings: [] };
}
function deleteVersion(proj, id) {
  if (!items(proj).some((v) => v.id === id)) return fail('Sürüm bulunamadı.');
  proj.versions.items = items(proj).filter((v) => v.id !== id);
  if (proj.versions.activeId === id) proj.versions.activeId = null;
  return { ok: true, warnings: [] };
}
const normalized = (v) => JSON.stringify(v, (key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value);
function isVersionDirty(proj, d, id) {
  const item = items(proj).find((v) => v.id === id);
  const compare = (state) => {
    const saved = clone(state);
    if (saved.pack) delete saved.pack.selectedId;
    return normalized(saved);
  };
  return !!item && compare(captureVersionState(proj, d)) !== compare(item.state);
}
Object.assign(C, { migrateVersions, versionSignature, captureVersionState, applyVersionState, saveVersion, updateVersion, renameVersion, deleteVersion, isVersionDirty, versionCompat });
})(typeof window !== 'undefined' ? window : globalThis);

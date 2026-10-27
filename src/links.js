// Canlı bölüm bağları ve bölüm başlangıcına göre saklanan akor seçimleri.
(function (root) {
const C = root.Core, clone = (v) => JSON.parse(JSON.stringify(v));
const length = (s) => s.endBar - s.startBar + 1;
function migrateLinks(proj) {
  for (const s of proj.sections || []) if (s.link === undefined) s.link = null;
  if (proj.preserveChords === undefined) proj.preserveChords = false;
  if (!Array.isArray(proj.chordChoices)) proj.chordChoices = [];
  if (C.migrateVersions) C.migrateVersions(proj);
  return proj;
}
function validateLink(proj, d, targetId, sourceId) {
  const sections = d.sections, target = sections.find((s) => s.id === targetId), source = sections.find((s) => s.id === sourceId);
  const fail = (reason) => ({ ok: false, reason });
  if (!target || !source) return fail('Kaynak veya hedef bölüm bulunamadı.');
  if (targetId === sourceId) return fail('Bölüm kendisine bağlanamaz.');
  if (length(target) !== length(source)) return fail('Bölümlerin ölçü uzunlukları eşit olmalı.');
  const seen = new Set([targetId]);
  let id = sourceId;
  while (id != null) {
    if (seen.has(id)) return fail('Bölüm bağı döngü oluşturamaz.');
    seen.add(id);
    id = (proj.sections || []).find((s) => s.id === id)?.link?.sourceId;
  }
  return { ok: true, reason: null };
}
function resolveLinks(proj, d) {
  const map = {}, warnings = [], visiting = new Set(), done = new Set();
  function visit(s) {
    if (done.has(s.id)) return;
    const link = (proj.sections || []).find((x) => x.id === s.id)?.link;
    if (!link) { done.add(s.id); return; }
    const check = validateLink(proj, d, s.id, link.sourceId);
    if (!check.ok || visiting.has(s.id)) { warnings.push(`${s.id}: ${check.reason || 'Geçersiz bölüm bağı.'}`); done.add(s.id); return; }
    const source = d.sections.find((x) => x.id === link.sourceId);
    visiting.add(s.id); visit(source); visiting.delete(s.id);
    const rootId = map[source.id]?.rootId || source.id;
    const base = d.sections.find((x) => x.id === rootId);
    map[s.id] = { rootId, offsetBars: s.startBar - base.startBar };
    done.add(s.id);
  }
  d.sections.forEach(visit);
  Object.defineProperty(map, 'warnings', { value: warnings, enumerable: false });
  return map;
}
const linkedRoot = (proj, d, id) => resolveLinks(proj, d)[id]?.rootId || id;
function captureChordChoices(proj, d, sectionId) {
  const s = d.sections.find((s) => s.id === sectionId);
  if (!s) return [];
  const rootId = linkedRoot(proj, d, sectionId);
  return d.chords.filter((c) => c.section === sectionId).map((c) => {
    const record = { sectionId, relBar: c.bar - s.startBar, half: c.half || 0, chord: clone(c.chord), state: c.locked ? 'lock' : c.pinned ? 'pin' : 'auto' };
    const prior = (proj.chordChoices || []).find((x) => x.sectionId === rootId && x.relBar === record.relBar && x.half === record.half);
    if (prior && Object.prototype.hasOwnProperty.call(prior, 'source')) record.source = prior.source;
    return record;
  });
}
function applyChordChoices(proj, d) {
  for (const s of d.sections) {
    const choices = (proj.chordChoices || []).filter((c) => c.sectionId === s.id && c.relBar >= 0 && c.relBar < length(s));
    if (!choices.length) continue;
    const old = d.chords.filter((c) => c.section === s.id);
    const at = (c) => (s.startBar - 1 + c.relBar + c.half / 2) * d.g.barQ;
    const complete = proj.preserveChords || Array.from({ length: length(s) }, (_, i) => i).every((i) => choices.some((c) => c.relBar === i && c.half === 0)) || old.every((x) => choices.some((c) => at(c) === x.q0));
    const ordered = choices.slice().sort((a, b) => at(a) - at(b));
    const slots = complete ? ordered.map((c, i) => {
      const q0 = at(c), q1 = ordered[i + 1] ? at(ordered[i + 1]) : s.endBar * d.g.barQ;
      return { ...clone(old.find((x) => x.q0 === q0) || old[0] || {}), section: s.id, bar: s.startBar + c.relBar, half: c.half || (q1 - q0 < d.g.barQ ? 0 : null), q0, q1 };
    }) : old;
    for (const sl of slots) {
      const c = choices.find((c) => at(c) === sl.q0);
      if (!c) continue;
      const lock = (proj.chordLocks || []).find((l) => l.bar === sl.bar && (l.half == null || l.half === (sl.half || 0)));
      // Kullanıcının yeni kilidi, yalnızca dondurmanın seçimini geçersiz kılar.
      if (c.source === 'freeze' && lock && lock.src !== 'freeze') {
        sl.chord = clone(lock.chord); sl.locked = true; sl.pinned = false; sl.lockSrc = lock.src || 'user';
      } else Object.assign(sl, { chord: clone(c.chord), locked: c.state === 'lock', pinned: c.state === 'pin', lockSrc: c.state === 'lock' ? lock?.src || 'user' : null });
    }
    d.chords = d.chords.filter((c) => c.section !== s.id).concat(slots).sort((a, b) => a.q0 - b.q0);
  }
  return d.chords;
}
const chordsAreFrozen = (proj) => proj.preserveChords === true;
function rekeyChordChoices(proj, fromId, toId) {
  proj.chordChoices = (proj.chordChoices || []).map((c) => c.sectionId === fromId ? { ...c, sectionId: toId } : c);
}
function freezeChords(proj, d) {
  if (chordsAreFrozen(proj)) return { ok: true, warnings: [] };
  try {
    const q = clone(proj), links = resolveLinks(proj, d);
    if (links.warnings.length) return { ok: false, warnings: links.warnings };
    q.chordChoices ||= []; q.chordLocks ||= [];
    for (const s of d.sections.filter((s) => !links[s.id])) {
      for (const c of captureChordChoices(proj, d, s.id)) {
        if (!q.chordChoices.some((x) => x.sectionId === c.sectionId && x.relBar === c.relBar && x.half === c.half)) q.chordChoices.push({ ...c, source: 'freeze' });
      }
    }
    for (const c of d.chords.filter((c) => !d.sections.some((s) => c.bar >= s.startBar && c.bar <= s.endBar))) {
      if (!q.chordLocks.some((l) => l.bar === c.bar && (l.half == null || l.half === c.half))) q.chordLocks.push({ bar: c.bar, half: c.half, chord: clone(c.chord), src: 'freeze' });
    }
    q.preserveChords = true;
    Object.assign(proj, q);
    return { ok: true, warnings: [] };
  } catch (e) { return { ok: false, warnings: [e.message] }; }
}
function unfreezeChords(proj) {
  if (!chordsAreFrozen(proj)) return { ok: true, warnings: [] };
  proj.chordChoices = (proj.chordChoices || []).filter((c) => c.source !== 'freeze');
  proj.chordLocks = (proj.chordLocks || []).filter((c) => c.src !== 'freeze');
  proj.preserveChords = false;
  return { ok: true, warnings: [] };
}

function resolveLinkedChords(proj, d) {
  applyChordChoices(proj, d);
  const links = resolveLinks(proj, d);
  for (const [id, l] of Object.entries(links)) {
    const shift = l.offsetBars * d.g.barQ;
    const slots = d.chords.filter((c) => c.section === l.rootId).map((c) => Object.assign(clone(c), { section: id, bar: c.bar + l.offsetBars, q0: c.q0 + shift, q1: c.q1 + shift }));
    d.chords = d.chords.filter((c) => c.section !== id).concat(slots);
  }
  d.chords.sort((a, b) => a.q0 - b.q0);
  d.linkWarnings = links.warnings;
  return d.chords;
}
function resolvedBass(proj, d, track = proj.bass) {
  if (!track) return track;
  const links = resolveLinks(proj, d);
  if (!Object.keys(links).length) return track;
  const t = clone(track); t.sections ||= {};
  const linkedBar = (i) => d.sections.some((s) => links[s.id] && i >= s.startBar - 1 && i < s.endBar);
  t.loops = (t.loops || []).filter((l) => {
    const hit = [...C.Bass.loopSourceBars(l), ...C.Bass.loopTargetBars(l)].some(linkedBar);
    if (hit) links.warnings.push('Bağlı bölüm ölçülerine başvuran bas döngüsü yok sayıldı.');
    return !hit;
  });
  for (const [id, l] of Object.entries(links)) {
    const s = d.sections.find((s) => s.id === id);
    if (t.sections[l.rootId]) t.sections[id] = clone(t.sections[l.rootId]);
    for (let i = s.startBar - 1; i < s.endBar; i++) if (track.bars[i - l.offsetBars]) t.bars[i] = Object.assign(clone(track.bars[i - l.offsetBars]), { index: i, sectionId: id });
  }
  d.linkWarnings = [...new Set([...links.warnings, ...(d.linkWarnings || [])])];
  return t;
}
function linkSection(proj, d, targetId, sourceId) {
  const check = validateLink(proj, d, targetId, sourceId);
  const target = (proj.sections || []).find((s) => s.id === targetId);
  if (!check.ok || !target) return { ok: false, warnings: [check.reason || 'Hedef bölüm bulunamadı.'] };
  target.link = { sourceId };
  return { ok: true, warnings: [] };
}
function unlinkSection(proj, d, targetId) {
  const links = resolveLinks(proj, d), l = links[targetId];
  if (!l) return { ok: false, warnings: links.warnings.length ? links.warnings : ['Bölüm bağlı değil.'] };
  try {
    const q = clone(proj), s = q.sections.find((s) => s.id === targetId), source = q.sections.find((s) => s.id === l.rootId);
    const choices = captureChordChoices(proj, d, targetId);
    q.chordChoices = (q.chordChoices || []).filter((c) => c.sectionId !== targetId).concat(choices);
    for (const field of ['chordLocks', 'chordPins', 'changeMarks']) q[field] = (q[field] || []).filter((c) => c.bar < s.startBar || c.bar > s.endBar).concat((proj[field] || []).filter((c) => c.bar >= source.startBar && c.bar <= source.endBar).map((c) => ({ ...clone(c), bar: c.bar + l.offsetBars })));
    s.arr = clone(source.arr || {});
    q.matrix ||= { enabled: false, rows: {} }; q.matrix.rows ||= {};
    q.matrix.rows[targetId] = Object.fromEntries(['piano', 'guitar', 'bass', 'drums'].map((layer) => [layer, C.effectiveCell(proj, d, targetId, layer)]));
    if (q.guitar) {
      q.guitar.parts[targetId] = clone(C.guitarPartFor(q.guitar, l.rootId));
      if (q.guitar.voiceGroups) q.guitar.voiceGroups[targetId] = q.guitar.voiceGroups[l.rootId];
    }
    if (q.bass) {
      const bass = resolvedBass(proj, d);
      if (bass.sections[targetId]) q.bass.sections[targetId] = clone(bass.sections[targetId]);
      for (let i = s.startBar - 1; i < s.endBar; i++) if (bass.bars[i]) q.bass.bars[i] = clone(bass.bars[i]);
      q.bass.loops = bass.loops;
    }
    s.link = null;
    if (q.bass) {
      const ctx = C.Bass.bassContext(d, q);
      for (let i = s.startBar - 1; i < s.endBar; i++) if (q.bass.bars[i]) q.bass.bars[i].sig = C.Bass.barSig(ctx, q.bass, i);
    }
    Object.assign(proj, q);
    return { ok: true, warnings: d.linkWarnings || [] };
  } catch (e) { return { ok: false, warnings: [e.message] }; }
}
function materializeLinksBeforeStructuralChange(proj, d, sectionIds) {
  const links = resolveLinks(proj, d), q = clone(proj), warnings = [];
  const affected = Object.keys(links).filter((id) => {
    let current = id;
    while (current) { if (sectionIds.includes(current)) return true; current = (proj.sections || []).find((s) => s.id === current)?.link?.sourceId; }
    return false;
  });
  for (const id of affected) { const r = unlinkSection(q, d, id); if (!r.ok) return r; warnings.push(...r.warnings); }
  Object.assign(proj, q);
  return { ok: true, warnings };
}
Object.assign(C, { freezeChords, unfreezeChords, chordsAreFrozen, rekeyChordChoices, migrateLinks, validateLink, resolveLinks, linkedRoot, captureChordChoices, applyChordChoices, resolveLinkedChords, resolvedBass, linkSection, unlinkSection, materializeLinksBeforeStructuralChange });
})(typeof window !== 'undefined' ? window : globalThis);

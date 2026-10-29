// ---------------------------------------------------------------- BÖLÜM DÜZENLEMELERİ: akorlar ve kilitler yerinde kalır
// DOM'suz; Core'a eklenir (build'de links.js'in ardından). Akorlar yalnızca bölümlerin içinde üretilir ve bölüm aralığı / tonu akor motorunu
// etkiler; bu yüzden bir bölümü silmek, birleştirmek, bölmek ya da sınırını kaydırmak akorları değiştirir ve kilitleri götürürdü.
// Burada her düzenleme: önce o anki akorlar (kilit / sabit / otomatik durumuyla) alınır, bölümler değiştirilir, etkilenen bölümler için
// akorlar bölüm başına göre "akor seçimi" (chordChoices) olarak yeniden yazılır, kilitler (ölçüye bağlı) olduğu gibi kalır.
// Seçimler, o bölümde akoru ya da notayı elle düzenleyene kadar geçerlidir (links.js ile aynı sözleşme).
(function (root) {
const C = root.Core;
const clone = (v) => JSON.parse(JSON.stringify(v));
const byStart = (a, b) => a.startBar - b.startBar;
const fail = (reason) => ({ ok: false, reason });

// d: düzenlemeden önceki türetme (S.d); mutate: proj.sections üzerinde düzenleme. Dönüş: { snap, affected: [bölüm kimlikleri] }
function keepChordsAcross(proj, d, mutate) {
  const snap = (d.chords || []).map((c) => ({ bar: c.bar, half: c.half || 0, chord: clone(c.chord), state: c.locked ? 'lock' : c.pinned ? 'pin' : 'auto' }));
  const before = new Map(proj.sections.map((s) => [s.id, s.startBar + ':' + s.endBar]));
  mutate();
  proj.sections.sort(byStart);
  const live = proj.sections.length ? proj.sections : [{ id: '_all', startBar: 1, endBar: d.bars }];
  const affected = live.filter((s) => before.get(s.id) !== s.startBar + ':' + s.endBar);
  const liveIds = new Set(live.map((s) => s.id)), affIds = new Set(affected.map((s) => s.id));
  proj.chordChoices = (proj.chordChoices || []).filter((c) => liveIds.has(c.sectionId) && !affIds.has(c.sectionId));
  for (const s of affected) {
    for (const c of snap) {
      if (c.bar < s.startBar || c.bar > s.endBar) continue;
      proj.chordChoices.push(Object.assign({ sectionId: s.id, relBar: c.bar - s.startBar, half: c.half, chord: clone(c.chord), state: c.state }, proj.preserveChords ? { source: 'freeze' } : {}));
    }
  }
  return { count: snap.length, affected: affected.map((s) => s.id) };
}
const keyOf = (d, id) => { const s = d.sections.find((x) => x.id === id); return s && s.tonic != null && s.mode ? { tonic: s.tonic, mode: s.mode } : null; };
const secById = (proj, id) => proj.sections.find((s) => s.id === id);
// yeni bölüm önceki yalnız-şarkı tonunu devralsın (bölüm yokken saklanan ton)
const inheritedKey = (proj) => (!proj.sections.length && proj.implicitKey && proj.implicitKey.tonic != null && proj.implicitKey.mode ? { tonic: proj.implicitKey.tonic, mode: proj.implicitKey.mode } : { tonic: null, mode: null });

// bölümün ayarlarını (gitar partisi, matris satırı, bas bölüm ayarı, düzenleme) başka bölüme kopyala
function copySectionSettings(proj, fromId, toId) {
  const from = secById(proj, fromId), to = secById(proj, toId);
  if (from && to && from.arr) to.arr = clone(from.arr);
  if (proj.guitar && proj.guitar.parts && proj.guitar.parts[fromId]) proj.guitar.parts[toId] = clone(proj.guitar.parts[fromId]);
  if (proj.matrix && proj.matrix.rows && proj.matrix.rows[fromId]) proj.matrix.rows[toId] = clone(proj.matrix.rows[fromId]);
  if (proj.bass && proj.bass.sections && proj.bass.sections[fromId]) proj.bass.sections[toId] = clone(proj.bass.sections[fromId]);
}

// ---------------------------------------------------------------- 1) SİL
// keepChords (varsayılan): akorlar ve kilitler kalır. Son bölüm silinirse "bölüm yok / tüm şarkı" olur ve ton saklanır (implicitKey);
// yoksa ölçüleri bitişik bölüme (önce öncekine) katılır. Komşusu olmayan bölüm silinirse ölçülerde akor kalmaz (akor bölüm içinde üretilir).
function removeSection(proj, d, id, opts = {}) {
  const sorted = proj.sections.slice().sort(byStart), s = sorted.find((x) => x.id === id);
  if (!s) return fail('Bölüm bulunamadı.');
  const prev = sorted.find((x) => x.endBar + 1 === s.startBar), next = sorted.find((x) => x.startBar === s.endBar + 1);
  const dropLocks = () => { proj.chordLocks = (proj.chordLocks || []).filter((l) => l.bar < s.startBar || l.bar > s.endBar); };
  if (opts.keepChords === false) {
    proj.sections = proj.sections.filter((x) => x.id !== id);
    dropLocks();
    return { ok: true, mode: 'plain', chords: 0, locks: 0 };
  }
  const locks = (proj.chordLocks || []).filter((l) => l.bar >= s.startBar && l.bar <= s.endBar).length;
  const key = keyOf(d, id);
  if (sorted.length === 1) {
    const r = keepChordsAcross(proj, d, () => { proj.sections = []; });
    proj.implicitKey = key || proj.implicitKey || null;
    return { ok: true, mode: 'implicit', chords: r.count, locks, key };
  }
  if (prev) {
    keepChordsAcross(proj, d, () => { secById(proj, prev.id).endBar = s.endBar; proj.sections = proj.sections.filter((x) => x.id !== id); });
    return { ok: true, mode: 'prev', into: prev.name, chords: d.chords.filter((c) => c.bar >= s.startBar && c.bar <= s.endBar).length, locks };
  }
  if (next) {
    keepChordsAcross(proj, d, () => { secById(proj, next.id).startBar = s.startBar; proj.sections = proj.sections.filter((x) => x.id !== id); });
    return { ok: true, mode: 'next', into: next.name, chords: d.chords.filter((c) => c.bar >= s.startBar && c.bar <= s.endBar).length, locks };
  }
  proj.sections = proj.sections.filter((x) => x.id !== id);
  dropLocks();
  return { ok: true, mode: 'gap', chords: 0, locks: 0 };
}

// ---------------------------------------------------------------- 2) BİRLEŞTİR (bitişik iki bölüm; ilkinin adı ve tonu kalır)
function mergeSections(proj, d, aId, bId) {
  const a = secById(proj, aId), b = secById(proj, bId);
  if (!a || !b) return fail('Bölüm bulunamadı.');
  if (a.endBar + 1 !== b.startBar) return fail('Yalnızca yan yana (bitişik) bölümler birleştirilir.');
  keepChordsAcross(proj, d, () => { a.endBar = b.endBar; proj.sections = proj.sections.filter((x) => x.id !== bId); });
  return { ok: true, name: a.name, startBar: a.startBar, endBar: a.endBar };
}

// ---------------------------------------------------------------- 3) BÖL (bar: ikinci bölümün ilk ölçüsü)
function splitSection(proj, d, id, bar, newId) {
  const s = secById(proj, id);
  if (!s) return fail('Bölüm bulunamadı.');
  if (!(bar > s.startBar && bar <= s.endBar)) return fail(`Bölmek için imleci bölümün içine koy (ölçü ${s.startBar + 1}–${s.endBar}).`);
  const secondName = /\d+$/.test(s.name) ? s.name.replace(/\d+$/, (n) => String(+n + 1)) : s.name + ' 2';
  keepChordsAcross(proj, d, () => {
    const second = { id: newId, link: null, name: secondName, type: s.type, startBar: bar, endBar: s.endBar, tonic: s.tonic ?? null, mode: s.mode ?? null };
    if (second.type == null) delete second.type;
    s.endBar = bar - 1;
    proj.sections.push(second);
    copySectionSettings(proj, id, newId);
  });
  return { ok: true, first: s.name, second: secondName, bar };
}

// ---------------------------------------------------------------- 4) ARALIK: komşu bölüm gerekirse kısalır (tamamen kaplanan bölüm hata)
function setSectionRange(proj, d, id, a, b) {
  const s = secById(proj, id), lo = Math.min(a, b), hi = Math.max(a, b);
  if (!s) return fail('Bölüm bulunamadı.');
  if (!(lo >= 1)) return fail('Ölçü aralığı geçersiz.');
  const others = proj.sections.filter((x) => x.id !== id);
  const swallowed = others.find((x) => x.startBar >= lo && x.endBar <= hi);
  if (swallowed) return fail(`“${swallowed.name}” bölümünü tamamen kaplıyor; önce onu silin ya da birleştirin.`);
  const inside = others.find((x) => x.startBar < lo && x.endBar > hi);
  if (inside) return fail(`Aralık “${inside.name}” bölümünün içinde kalıyor; önce onu bölün.`);
  const trimmed = [];
  keepChordsAcross(proj, d, () => {
    for (const x of others) {
      if (x.startBar < lo && x.endBar >= lo) { x.endBar = lo - 1; trimmed.push(x.name); }
      else if (x.startBar <= hi && x.endBar > hi) { x.startBar = hi + 1; trimmed.push(x.name); }
    }
    s.startBar = lo; s.endBar = hi;
  });
  return { ok: true, trimmed, startBar: lo, endBar: hi };
}

Object.assign(C, { removeSection, mergeSections, splitSection, setSectionRange, keepChordsAcross, inheritedSectionKey: inheritedKey });
})(typeof window !== 'undefined' ? window : globalThis);

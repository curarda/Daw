// Ortak düzenlenmiş olay akışı; ses üretimi ve zamanlama tüketicilerde kalır.
(function (root) {
const C = root.Core;
const layers = ['piano', 'guitar', 'bass', 'drums'];
function matrixTemplate(typeNorm, proj) {
  const template = activePack(proj)?.template;
  if (template) return { ...(template[typeNorm] || template.other) };
  const light = ['intro', 'bridge', 'outro'].includes(typeNorm);
  return { piano: true, guitar: true, bass: !light, drums: !light && typeNorm !== 'verse' };
}
function setMatrixEnabled(proj, on) {
  return { ...proj, matrix: { ...proj.matrix, enabled: !!on, rows: proj.matrix?.rows || {} } };
}
function migrateMatrix(proj) {
  if (!Object.prototype.hasOwnProperty.call(proj, 'matrix')) proj.matrix = { enabled: false, rows: {} };
  if (C.migratePack) C.migratePack(proj);
  return proj;
}
function activePack(proj) { return C.PACKS?.find((p) => p.id === proj?.pack?.id && p.meters.includes(proj.settings.meter)); }
function isLastChorus(proj, d, id) {
  return !!proj.matrix && proj.matrix.enabled !== false && !!activePack(proj) && id != null && d.sections.filter((s) => s.typeNorm === 'chorus').at(-1)?.id === id;
}
function effectiveCell(proj, d, sectionId, layer) {
  const ins = proj.guitar?.instrument || 'piano';
  if (layer === 'piano' && ins === 'guitar' || layer === 'guitar' && ins === 'piano' || layer === 'bass' && !proj.bass?.enabled) return false;
  if (!proj.matrix || proj.matrix.enabled === false) return true;
  const section = d.sections.find((s) => s.id === sectionId);
  // Bölümler arasındaki boşluklar genel düzeni izler.
  if (!section) return true;
  const cell = proj.matrix.rows?.[sectionId]?.[layer];
  return typeof cell === 'boolean' ? cell : isLastChorus(proj, d, sectionId) || matrixTemplate(section.implicit ? '_all' : section.typeNorm, proj)[layer];
}
function effectiveLayers(proj, d, sectionId) {
  return Object.fromEntries(layers.map((layer) => [layer, effectiveCell(proj, d, sectionId, layer)]));
}
function gateEvents(events, proj, d, layer) {
  const g = d.g;
  const sectionAt = (q) => d.sections.find((s) => q >= (s.startBar - 1) * g.barQ && q < s.endBar * g.barQ);
  const boundaries = [...new Set(d.sections.flatMap((s) => [(s.startBar - 1) * g.barQ, s.endBar * g.barQ]))].sort((a, b) => a - b);
  const gated = events.flatMap((e) => {
    const q = e.t / g.spq;
    if (!effectiveCell(proj, d, sectionAt(q)?.id, layer)) return [];
    if (layer === 'drums') return [e];
    const end = (e.t + e.dur) / g.spq;
    const boundary = boundaries.find((b) => b > q && b < end && !effectiveCell(proj, d, sectionAt(b)?.id, layer));
    if (boundary == null) return [e];
    const dur = boundary * g.spq - e.t, clipped = { ...e, dur };
    if (e.q1 != null) clipped.q1 = boundary;
    if (e.hold != null) clipped.hold = Math.min(e.hold, dur);
    return [clipped];
  });
  if (events.fxTable) gated.fxTable = events.fxTable;
  return gated;
}
function arrangedEvents(d, proj, opts = {}) {
  const out = { piano: [], guitar: [], bass: [], drums: [] };
  if (!d) return out;
  const wants = (k) => !opts.layers || opts.layers.includes(k);
  const g = d.g, sections = proj.sections || [], ds = proj.drums || {};
  const sw = opts.midi ? proj.swing && proj.swing.ratio : (proj.swing && proj.swing.ratio) || 0.5;
  const arr = (id) => sections.find((s) => s.id === id)?.arr || {};
  if (wants('piano')) {
    const separate = sections.some((s) => s.arr && s.arr.piano && (opts.midi || s.arr.piano !== 'off'));
    out.piano = separate
      ? C.arrangePiano(d.chords, g, (id) => C.pianoOpts(Object.assign({}, proj.piano, arr(id).piano ? { style: arr(id).piano } : {}), sw))
      : C.pianoEvents(d.chords, g, C.pianoOpts(proj.piano, sw));
  }
  if (wants('guitar') && proj.guitar && (!opts.midi || (proj.guitar.instrument || 'piano') !== 'piano')) out.guitar = C.guitarEvents(C.guitarSlotsFrom(d), g, (sl) => C.guitarPartFor(proj.guitar, sl.section));
  if (wants('bass') && proj.bass && proj.bass.enabled) out.bass = C.Bass.bassEvents(proj.bass, g, d.bars);
  if (wants('drums')) {
    if (Object.prototype.hasOwnProperty.call(opts, 'drums')) {
      const dr = opts.drums;
      out.drums = dr && dr.K ? C.drumEvents(dr, g, d.bars, ds.startBar || 1) : dr && dr.events || [];
    } else {
      const byId = (id) => C.DRUM_LOOPS.find((l) => l.id === id && l.meter === proj.settings.meter) || null;
      const globalLoop = opts.drumLoop || byId(ds.loop) || C.loopsFor(proj.settings.meter)[0] || null;
      const section = (b) => d.sections.find((s) => !s.implicit && b >= s.startBar && b <= s.endBar);
      const plan = (b) => {
        if (opts.previewDrums) return byId(opts.previewDrums);
        const a = arr(section(b)?.id).drums;
        return a === 'off' ? null : (a && byId(a)) || (ds.on ? (isLastChorus(proj, d, section(b)?.id) ? byId(activePack(proj).drums.alt) : globalLoop) : null);
      };
      const fill = (b) => ds.fills && !opts.previewDrums && b < d.bars && section(b) && section(b + 1) && section(b).id !== section(b + 1).id && !!plan(b) && !!plan(b + 1) && (!proj.matrix || proj.matrix.enabled === false || (effectiveCell(proj, d, section(b).id, 'drums') && effectiveCell(proj, d, section(b + 1).id, 'drums')));
      out.drums = C.arrangeDrums(g, d.bars, ds.startBar || 1, plan, fill, sw);
    }
  }
  if (proj.matrix && proj.matrix.enabled !== false) for (const layer of layers) out[layer] = gateEvents(out[layer], proj, d, layer);
  return out;
}
Object.assign(C, { arrangedEvents, matrixTemplate, setMatrixEnabled, migrateMatrix, effectiveCell, effectiveLayers });
})(typeof window !== 'undefined' ? window : globalThis);

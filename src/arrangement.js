// Ortak düzenlenmiş olay akışı; ses üretimi ve zamanlama tüketicilerde kalır.
(function (root) {
const C = root.Core;
function effectiveLayers(sectionId) {
  return { piano: true, guitar: true, bass: true, drums: true };
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
        return a === 'off' ? null : (a && byId(a)) || (ds.on ? globalLoop : null);
      };
      const fill = (b) => ds.fills && !opts.previewDrums && b < d.bars && section(b) && section(b + 1) && section(b).id !== section(b + 1).id && !!plan(b) && !!plan(b + 1);
      out.drums = C.arrangeDrums(g, d.bars, ds.startBar || 1, plan, fill, sw);
    }
  }
  return out;
}
Object.assign(C, { arrangedEvents, effectiveLayers });
})(typeof window !== 'undefined' ? window : globalThis);

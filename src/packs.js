// Tür paketleri: yalnızca mevcut motor ayarları; tempo ve ölçü projeye aittir.
(function (root) {
const C = root.Core, B = C.Bass;
const layers = ['piano', 'guitar', 'bass', 'drums'];
const clone = (v) => JSON.parse(JSON.stringify(v));
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const row = (ids) => Object.fromEntries(layers.map((l) => [l, ids.includes(l)]));
function template(intro, verse, outro = 'piano guitar') {
  return Object.fromEntries(Object.entries({ intro, verse, prechorus: 'piano guitar bass drums', chorus: 'piano guitar bass drums', bridge: 'piano guitar', outro, other: 'piano guitar bass drums' }).map(([k, v]) => [k, row(v)]));
}
function pack(id, name, bpm, loop, alt, piano, guitar, bass, dynamics, meter = '4/4') {
  const [pattern, mode, tone, articulation, chorus, delay, reverb, guitarOn = true, pianoOn = true] = guitar;
  const [instrumentType, preset, templateFamily, density, profile = null, pump = 0] = bass;
  return { id, name, meters: [meter], bpm, drums: { loop, alt }, piano, pianoOn, guitarOn,
    guitar: { pattern, mode, tone, articulation, fx: { chorus, delay: { mix: delay, time: '8n', feedback: 0.3 }, reverb } },
    bass: { instrumentType, preset, profile, templateFamily, density, pump }, template: dynamics };
}
const PACKS = freeze([
  // Sisli giriş; kıtada davul bekler.
  pack('dream-pop', 'Dream pop', [65, 90], 'ht-flat', 'ballad16', 'synth-chord', ['folk', 'arpeggio', 'clean', 'letRing', .5, .35, .65], ['synth', 'Warm sub', 'drone', .2], template('piano guitar', 'piano guitar bass')),
  // Folk kıtası nakaratta tam gruba açılır.
  pack('indie-pop', 'Indie pop', [100, 130], 'backbeat', 'pulse8', 'piano-arp', ['folk', 'strum', 'clean', 'normal', .3, 0, .2], ['guitar', 'Dark pick', 'walk', .6], template('piano guitar', 'piano guitar bass')),
  // Elektronik giriş yalnızca akorlarla başlar.
  pack('electro-pop', 'Electro-pop', [90, 120], 'clapsnare', 'ht-clap', 'synth-chord', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Synth saw', 'walk', .7, null, .5], template('piano', 'piano bass drums')),
  // Gitar kıtasına nakaratta bas ve davul eklenir.
  pack('alt-rock', 'Alt rock', [110, 130], 'syncokick', 'drive16', 'piano-chord', ['gallop', 'strum', 'drive', 'normal', 0, 0, .15, true, false], ['guitar', 'Fuzz', 'drive', .8], template('guitar', 'guitar')),
  // Kıtada gitar ve bas, nakaratta tam ritim.
  pack('indie-rock', 'Indie rock', [120, 155], 'train', 'backbeat', 'piano-chord', ['plain8', 'strum', 'crunch', 'normal', 0, 0, .2, true, false], ['guitar', 'Dark pick', 'walk', .65], template('guitar', 'guitar bass')),
  // Bas nabzı girişten itibaren duyulur.
  pack('post-punk', 'Post-punk', [110, 155], 'motorik', 'joydiv', 'synth-chord', ['skank', 'strum', 'clean', 'staccato', 0, .35, .2], ['guitar', 'Dark pick', 'auto', .8, 'post-punk-drive'], template('guitar bass', 'guitar bass drums')),
  // Synth arpeji ritimden önce girer.
  pack('synthwave', 'Synthwave', [100, 130], 'gated', 'pulse8', 'synth-arp', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Moroder pulse', 'auto', .8, 'synthwave-roll'], template('piano', 'piano bass drums')),
  // Karanlık bas girişi nakaratta akorlarla genişler.
  pack('darkwave', 'Darkwave', [110, 130], 'ebm', 'ht-cine', 'synth-chord', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Sub drone', 'auto', .6, 'darkwave-pulse'], template('bass', 'bass drums')),
  // Yalın kıta, dolu nakarat.
  pack('alternative-pop', 'Alternative pop', [70, 110], 'ht-kick', 'ht-hat16', 'piano-chord', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Warm sub', 'drone', .3], template('piano', 'piano bass')),
  // Crunch gitar kıtada ritmi taşır.
  pack('pop-rock', 'Pop rock', [120, 150], 'backbeat', 'push332', 'piano-chord', ['plain8', 'strum', 'crunch', 'normal', 0, 0, .2], ['guitar', 'Dark pick', 'drive', .7], template('guitar', 'piano guitar bass')),
  // Akustik giriş ve çıkışta vurmalılar susar.
  pack('akustik', 'Akustik', [65, 105], 'minimal', 'ht-rim', 'piano-arp', ['folk', 'strum', 'clean', 'normal', 0, 0, .2], ['guitar', 'Dark pick', 'drone', .15], template('piano guitar', 'piano guitar bass')),
  // Balad çıkışı akor ve gitarla kapanır.
  pack('balad', 'Balad (4/4)', [58, 90], 'ballad16', 'ht-flat', 'piano-chord', ['long', 'strum', 'clean', 'letRing', 0, .15, .4], ['guitar', 'Warm sub', 'drone', .2], template('piano', 'piano guitar bass')),
  // Arpej kıtası nakaratta tam elektronik ritme açılır.
  pack('synthpop', 'Synthpop', [105, 135], 'four', 'pulse8', 'synth-arp', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Synth saw', 'drive', .8], template('piano', 'piano bass')),
  // Davul ve bas girişi, nakaratta akor katmanı.
  pack('dans-elektronik', 'Dans / Elektronik', [120, 135], 'four', 'ebm', 'synth-chord', ['plain8', 'strum', 'clean', 'normal', 0, 0, .2, false], ['synth', 'Acid squelch', 'roll', .95], template('bass drums', 'bass drums')),
  // Vals kıtası hafif, nakaratı tam grup.
  pack('vals', 'Vals', [80, 110], 'w-basic', 'w-ballad', 'piano-arp', ['waltz', 'strum', 'clean', 'normal', 0, 0, .25], ['guitar', 'Dark pick', 'drone', .2], template('piano guitar', 'piano guitar bass'), '3/4'),
  // Noktalı çeyrek BPM; kıtada davulsuz 6/8.
  pack('balad-68', '6/8 Balad', [40, 75], 'e-rim', 'ballad68', 'piano-arp', ['six8', 'strum', 'clean', 'letRing', 0, .15, .35], ['guitar', 'Warm sub', 'walk', .35], template('piano', 'piano guitar bass'), '6/8'),
]);
function migratePack(proj) {
  const old = proj.pack || {};
  proj.pack = { ...old, id: old.id ?? null, locks: Object.fromEntries(layers.map((l) => [l, old.locks?.[l] === true])) };
  if (C.migrateLinks) C.migrateLinks(proj);
  return proj;
}
const eligiblePacks = (proj) => PACKS.filter((p) => p.meters.includes(proj.settings.meter));
function rankPacks(proj) {
  return eligiblePacks(proj).map((p) => { const distance = Math.max(0, p.bpm[0] - proj.settings.bpm, proj.settings.bpm - p.bpm[1]); return { id: p.id, distance, fits: distance === 0 }; }).sort((a, b) => a.distance - b.distance);
}
const topSuggestions = (proj, count = 3) => rankPacks(proj).slice(0, count);
function nextPack(proj, currentId) { const ranked = rankPacks(proj); return ranked.length ? ranked[(ranked.findIndex((p) => p.id === currentId) + 1) % ranked.length].id : null; }
function validatePack(p, meter) {
  const pattern = C.GUITAR_PATTERNS.find((g) => g.id === p.guitar.pattern && g.meter === meter);
  if (!p.meters.includes(meter) || ![p.drums.loop, p.drums.alt].every((id) => C.DRUM_LOOPS.some((l) => l.id === id && l.meter === meter)) || !C.PIANO_STYLES[p.piano] || !pattern || !pattern.compatibleModes.includes(p.guitar.mode) || !B.BASS_PRESETS[p.bass.preset] || (p.bass.profile && !B.BUILTIN_PROFILES.some((b) => b.id === p.bass.profile)) || !['guitar', 'synth'].includes(p.bass.instrumentType) || (p.bass.templateFamily !== 'auto' && !B.BASS_TEMPLATES.some((t) => t.family === p.bass.templateFamily && t.meter === meter))) throw new Error('Geçersiz paket ayarları');
}
function applyPack(proj, d, packId) {
  const p = PACKS.find((p) => p.id === packId);
  if (!p) throw new Error('Paket bulunamadı');
  validatePack(p, proj.settings.meter);
  const q = migratePack(clone(proj)), locks = q.pack.locks, warnings = [];
  const prior = Object.fromEntries(d.sections.map((s) => [s.id, C.effectiveLayers(proj, d, s.id)]));
  const ins = q.guitar?.instrument || 'piano', current = { piano: ins !== 'guitar', guitar: ins !== 'piano' };
  const on = { piano: locks.piano ? current.piano : p.pianoOn, guitar: locks.guitar ? current.guitar : p.guitarOn };
  if (!on.piano && !on.guitar) {
    for (const l of ['piano', 'guitar']) if (!locks[l]) on[l] = current[l];
    warnings.push('Paket bu katmanı kapatamadı: en az bir akor çalgısı açık kalmalı');
  }
  q.guitar ||= C.defaultGuitarState(q.settings.meter);
  q.guitar.instrument = on.piano && on.guitar ? 'both' : on.piano ? 'piano' : 'guitar';
  if (!locks.piano) { q.piano.style = p.piano; for (const s of q.sections) if (s.arr) delete s.arr.piano; }
  if (!locks.drums) {
    q.drums = { ...q.drums, on: true, loop: p.drums.loop, startBar: q.drums?.startBar ?? 1, fills: q.drums?.fills ?? true };
    for (const s of q.sections) if (s.arr) delete s.arr.drums;
  }
  if (!locks.guitar) {
    q.guitar.parts ||= {};
    if (Object.keys(q.guitar.parts).some((id) => id !== '_all')) warnings.push('bölüm gitar partileri korundu');
    if (q.guitar.parts._all?.locked) warnings.push('Kilitli gitar partisi korundu');
    else q.guitar.parts._all = { ...C.defaultGuitarPart(q.settings.meter), ...clone(p.guitar), pattern: clone(C.GUITAR_PATTERNS.find((g) => g.id === p.guitar.pattern)) };
  }
  if (!locks.bass) {
    const t = q.bass ||= B.defaultBassTrack(), b = p.bass;
    Object.assign(t, { enabled: true, instrumentType: b.instrumentType === 'guitar' ? 'bass-guitar' : 'synth', instrumentPreset: b.preset, styleProfileId: b.profile, styleMix: null, pump: b.pump, useSampler: false });
    const ctx = B.bassContext(d, q);
    B.ensureBars(t, ctx);
    const retained = t.bars.filter((bar) => bar.locked || t.sections[bar.sectionId]?.locked).map(clone);
    for (const s of d.sections) if (!t.sections[s.id].locked) t.sections[s.id] = { ...B.defaultBassSection(s.typeNorm, t.instrumentType), templateFamily: b.templateFamily, density: b.density };
    if (retained.length || Object.values(t.sections).some((s) => s.locked)) warnings.push('Kilitli bas ölçüleri ve bölüm ayarları korundu');
    for (const bar of retained) t.bars[bar.index].locked = true;
    B.bassGenerateAll(t, ctx);
    for (const bar of retained) t.bars[bar.index] = bar;
  }
  q.matrix ||= { rows: {} }; q.matrix.rows ||= {}; q.matrix.enabled = true; q.pack.id = p.id;
  for (const s of d.sections) {
    const r = q.matrix.rows[s.id] ||= {};
    for (const l of layers) r[l] = locks[l] ? prior[s.id][l] : null;
  }
  for (const r of Object.values(q.matrix.rows)) for (const l of layers) if (!locks[l]) r[l] = null;
  Object.assign(proj, q);
  return { warnings, changed: layers.filter((l) => !locks[l]), kept: layers.filter((l) => locks[l]) };
}
Object.assign(C, { PACKS, migratePack, eligiblePacks, rankPacks, topSuggestions, nextPack, applyPack });
})(typeof window !== 'undefined' ? window : globalThis);

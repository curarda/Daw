// ---------------------------------------------------------------- BAS: veri modeli, ritim şablonları, perde kuralları, üretici
// DOM'suz; Core'a eklenir (build'de guitar.js'in ardından aynı <script id="core"> içine girer). Plan: docs/bass-layer-plan.md
// Zaman birimi: vuruş = çeyrek nota (q); startBeat/durationBeats ölçü başına göre; ızgara adımı = 16'lık (0.25 q).
// Ölçü indeksi 0 tabanlı (bars[i] = i+1. ölçü). Akorlar akor izinden okunur, bas verisine kopyalanmaz.
(function (root) {
const C = root.Core;
const { clamp, mod12, METERS, CHORD_Q, pcName } = C;

const STEP_Q = 0.25;
const stepsOf = (meter) => Math.round(METERS[meter].barQ / STEP_Q);
const BASS_TYPES = ['bass-guitar', 'synth'];
const RANGE_DEFAULT = { 'bass-guitar': { low: 28, high: 55 }, synth: { low: 24, high: 52 } };
const CENTER = 40; // E2: kök perdelerinin en yakın oktavı

// ---------------------------------------------------------------- rastgele akış: tohum + anahtarlar → bağımsız, tekrarlanabilir
function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rngFor = (seed, ...keys) => mulberry(hash32(seed + '|' + keys.join('|')));
function pickW(rng, entries) { // [[anahtar, ağırlık]]
  const live = entries.filter(([, w]) => w > 0);
  if (!live.length) return entries.length ? entries[0][0] : null;
  const tot = live.reduce((a, [, w]) => a + w, 0);
  let r = rng() * tot;
  for (const [k, w] of live) { r -= w; if (r < 0) return k; }
  return live[live.length - 1][0];
}

// ---------------------------------------------------------------- 1) RİTİM ŞABLONLARI (veri; kod değil)
// slot: {step, len, role?, octave?, ghost?, vel?, accent?, glide?, tie?, degree?, gate?}; role = ritmik rol (anchor/strong/weak/pickup/ghost)
const S_ = (step, len, o) => Object.assign({ step, len }, o || {});
const every = (n, len, o) => Array.from({ length: n }, (_, i) => S_(i * (16 / n), len, typeof o === 'function' ? o(i) : o));
const BOTH = ['bass-guitar', 'synth'];
const mk = (id, name, family, window, suits, slots, extra) => Object.assign({ id, name, family, meter: '4/4', steps: 16, window, suits, slots }, extra || {});
const BASS_TEMPLATES = [
  mk('drone-halves', 'Drone — yarımlar', 'drone', [0, 0.4], BOTH, [S_(0, 8), S_(8, 8)], { gate: 0.95 }),
  mk('drone-pickup', 'Drone — öncüllü', 'drone', [0, 0.35], BOTH, [S_(0, 14), S_(14, 2)], { gate: 0.95 }),
  mk('walking-quarters', 'Yürüyen çeyrekler', 'walk', [0.2, 0.6], ['bass-guitar'], [0, 4, 8, 12].map((s) => S_(s, 4))),
  mk('push-offbeat', 'İtmeli senkop', 'walk', [0.2, 0.7], BOTH, [S_(0, 6), S_(6, 2), S_(8, 6), S_(14, 2)]),
  mk('dotted-push', 'Noktalı çeyrek nabzı', 'drone', [0.3, 0.7], BOTH, [S_(0, 6), S_(6, 6), S_(12, 4)]),
  mk('hook-walk', 'Hook yürüyüşü (3-3-2)', 'walk', [0.3, 0.8], ['bass-guitar'], [S_(0, 3), S_(3, 3), S_(6, 2), S_(8, 3), S_(11, 3), S_(14, 2)], { lift: 7 }),
  mk('pedal-eighths', 'Pedal sekizlikler', 'drive', [0.4, 1.0], BOTH, every(8, 2)),
  mk('octave-pulse', 'Oktav nabzı', 'drive', [0.5, 1.0], BOTH, every(8, 2, (i) => (i % 2 ? { octave: 12 } : null))),
  mk('gallop', 'Gallop', 'drive', [0.7, 1.0], BOTH, [0, 4, 8, 12].flatMap((b) => [S_(b, 2), S_(b + 2, 1), S_(b + 3, 1)])),
  mk('rolling-sixteenths', 'Yuvarlanan 16\'lıklar', 'roll', [0.7, 1.0], BOTH, every(16, 1, (i) => (i % 4 === 2 ? { octave: 12 } : null))),
  // ---- synth şablonları (yalnızca synth tipine uygun)
  mk('acid-sixteenths', 'Acid 16\'lıklar', 'roll', [0.6, 1.0], ['synth'], every(16, 1, (i) => Object.assign({}, [0, 3, 6, 10, 12].includes(i) ? { accent: true } : null, [7, 14].includes(i) ? { glide: true } : null)), { bias: { weak: { step: 60, repeat: 15, fifth: 5, octave: 20 } }, gate: 0.6 }),
  mk('offbeat-pulse', 'Offbeat zıplama', 'walk', [0.4, 0.9], ['synth'], [2, 6, 10, 14].map((s) => S_(s, 2, { gate: 0.5 }))),
  mk('moroder-run', 'Moroder koşusu', 'roll', [0.6, 1.0], ['synth'], every(16, 1, (i) => (i % 2 ? { octave: 12 } : null)), { gate: 0.6 }),
  mk('arp-root-fifth', 'Arpej: kök, beşli, oktav, beşli', 'drive', [0.5, 0.9], ['synth'], every(8, 2, (i) => ({ degree: ['root', 'fifth', 'octave', 'fifth'][i % 4] })), { gate: 0.6 }),
  mk('gated-quarters', 'Gate\'li çeyrekler', 'walk', [0.3, 0.7], ['synth'], [0, 4, 8, 12].map((s) => S_(s, 4, { gate: 0.3 }))),
  mk('sub-drone-sweep', 'Sub drone (filtre süpürmesi)', 'drone', [0, 0.5], ['synth'], [S_(0, 16)], { gate: 0.95, tieAcross: true, sweepBars: 4 }),
  // ---- 3/4 ve 6/8 (adım = 16'lık; 3/4 ve 6/8'de 12 adım)
  mk('drone-34', 'Drone (3/4)', 'drone', [0, 0.4], BOTH, [S_(0, 12)], { meter: '3/4', steps: 12, gate: 0.95 }),
  mk('pedal-34', 'Pedal sekizlikler (3/4)', 'drive', [0.4, 1.0], BOTH, every(6, 2), { meter: '3/4', steps: 12 }),
  mk('pulse-34', 'Çeyrek nabız (3/4)', 'walk', [0.2, 0.7], BOTH, [0, 4, 8].map((s) => S_(s, 4)), { meter: '3/4', steps: 12 }),
  mk('drone-68', 'Drone (6/8)', 'drone', [0, 0.4], BOTH, [S_(0, 6), S_(6, 6)], { meter: '6/8', steps: 12, gate: 0.95 }),
  mk('pedal-68', 'Pedal sekizlikler (6/8)', 'drive', [0.4, 1.0], BOTH, every(6, 2), { meter: '6/8', steps: 12 }),
  mk('pulse-68', 'Noktalı çeyrek nabzı (6/8)', 'walk', [0.2, 0.7], BOTH, [S_(0, 6), S_(6, 6)], { meter: '6/8', steps: 12 }),
];
// kullanıcı şablonları (kendi çizdiği / tap ile kaydedilen) projede tutulur; aynı biçim
const tplIndex = (track) => { const m = new Map(); for (const t of BASS_TEMPLATES) m.set(t.id, t); for (const t of (track && track.customTemplates) || []) m.set(t.id, t); return m; };
const SYNTH_HIDDEN_BY_DEFAULT = ['hook-walk', 'walking-quarters'];
// 2/4 gibi şablonu olmayan ölçüde: 1. vuruşta çapa, her vuruşta nabız, değişen akorda son nabız öncül
function fallbackTemplate(meter) {
  const m = METERS[meter], steps = stepsOf(meter), pulse = Math.max(1, Math.round(m.pulseQ / STEP_Q));
  const slots = []; for (let s = 0; s < steps; s += pulse) slots.push(S_(s, pulse));
  return { id: 'fallback-' + meter, name: 'Nabız (' + meter + ')', family: 'walk', meter, steps, window: [0, 1], suits: BOTH, slots };
}
function templatesFor(track, meter, type) {
  const gitarOk = type === 'synth' && track && track.synthGuitarTemplates; // gitar kalıpları synth'te kullanıcı isterse açılır
  const list = [...BASS_TEMPLATES, ...((track && track.customTemplates) || []).filter((t) => !t.temp)].filter((t) => t.meter === meter && ((t.suits || BOTH).includes(type) || (gitarOk && SYNTH_HIDDEN_BY_DEFAULT.includes(t.id))));
  return list.length ? list : [fallbackTemplate(meter)];
}
const onsetCount = (t) => t.slots.length;
// aileler yoğunluk sırasıyla (aynı ailede "bir adım yoğun" kardeş)
function siblingUp(list, tpl) {
  const fam = list.filter((t) => t.family === tpl.family).sort((a, b) => onsetCount(a) - onsetCount(b) || a.window[0] - b.window[0]);
  const i = fam.findIndex((t) => t.id === tpl.id);
  for (let j = i + 1; j < fam.length; j++) if (onsetCount(fam[j]) > onsetCount(tpl) || fam[j].window[0] > tpl.window[0]) return fam[j];
  return null;
}
function siblingDown(list, tpl) {
  const fam = list.filter((t) => t.family === tpl.family).sort((a, b) => onsetCount(a) - onsetCount(b) || a.window[0] - b.window[0]);
  const i = fam.findIndex((t) => t.id === tpl.id);
  for (let j = i - 1; j >= 0; j--) if (onsetCount(fam[j]) < onsetCount(tpl) || fam[j].window[0] < tpl.window[0]) return fam[j];
  return null;
}
// varsayılan ritmik rol: 0 çapa; vuruş başları güçlü; ızgara sonundaki (≥ steps-4) son onset öncül; geri kalan zayıf
function strongSteps(meter) { return { '4/4': [4, 8, 12], '3/4': [4, 8], '2/4': [4], '6/8': [6] }[meter] || [4, 8, 12]; }
function slotRoles(tpl) {
  const strong = strongSteps(tpl.meter), last = tpl.slots.reduce((a, s) => (s.step > a.step ? s : a), tpl.slots[0]);
  return tpl.slots.map((s) => {
    if (s.ghost) return 'ghost';
    if (s.role) return s.role;
    if (s.step === 0) return 'anchor';
    if (s === last && s.step >= tpl.steps - 4) return 'pickup';
    if (strong.includes(s.step)) return 'strong';
    return 'weak';
  });
}

// ---------------------------------------------------------------- 2) STİL PROFİLLERİ (ağırlıklar tek yerde; öğrenilen profiller bunları değiştirir)
const DEFAULT_ROLES = {
  anchor: { root: 100 },
  strong: { root: 55, fifth: 25, octave: 15, third: 5 },
  weak: { repeat: 50, step: 25, fifth: 15, octave: 10 },
  pickup: { 'approach-d': 65, 'approach-c': 25, fifth: 10 },
  ghost: { repeat: 100 },
};
// synth: kök ve oktava kayar
const SYNTH_ROLES = {
  anchor: { root: 100 },
  strong: { root: 55, fifth: 10, octave: 30, third: 5 },
  weak: { repeat: 60, step: 15, fifth: 5, octave: 20 },
  pickup: { 'approach-d': 65, 'approach-c': 25, fifth: 10 },
  ghost: { repeat: 100 },
};
const prof = (id, name, tw, roles, extra) => Object.assign({ id, name, builtin: true, templateWeights: tw, roles: Object.assign({}, DEFAULT_ROLES, roles), synthRoles: null, leapLimit: 12, legato: 0.92, templates: [] }, extra || {});
const BUILTIN_PROFILES = [
  prof('post-punk-drive', 'Post-punk drive',
    { 'hook-walk': 3, 'pedal-eighths': 3, 'push-offbeat': 2, gallop: 2, 'walking-quarters': 1.5, 'dotted-push': 1, 'drone-halves': 0.5, 'drone-pickup': 0.5, 'octave-pulse': 0.7, 'rolling-sixteenths': 0.3,
      'gated-quarters': 2, 'offbeat-pulse': 1, 'arp-root-fifth': 1, 'moroder-run': 0.3, 'acid-sixteenths': 0.3, 'sub-drone-sweep': 0.3 },
    { strong: { root: 45, fifth: 25, octave: 20, third: 10 }, weak: { repeat: 40, step: 30, fifth: 15, octave: 15 } }, { legato: 0.85 }),
  prof('darkwave-pulse', 'Darkwave pulse',
    { 'drone-halves': 3, 'drone-pickup': 2, 'pedal-eighths': 2, 'dotted-push': 2, 'push-offbeat': 1, 'octave-pulse': 1, 'hook-walk': 0.5, 'walking-quarters': 0.5, gallop: 0.3, 'rolling-sixteenths': 0.2,
      'sub-drone-sweep': 3, 'gated-quarters': 1, 'offbeat-pulse': 1, 'arp-root-fifth': 1.5, 'moroder-run': 0.2, 'acid-sixteenths': 0.2 },
    { strong: { root: 70, fifth: 20, octave: 8, third: 2 }, weak: { repeat: 65, step: 15, fifth: 10, octave: 10 } }, { legato: 1.0 }),
  prof('synthwave-roll', 'Synthwave roll',
    { 'octave-pulse': 3, 'rolling-sixteenths': 3, 'pedal-eighths': 2, gallop: 1.5, 'push-offbeat': 1, 'dotted-push': 0.7, 'drone-halves': 0.3, 'drone-pickup': 0.3, 'hook-walk': 0.3, 'walking-quarters': 0.3,
      'moroder-run': 3, 'acid-sixteenths': 1.5, 'offbeat-pulse': 2, 'arp-root-fifth': 2, 'gated-quarters': 1, 'sub-drone-sweep': 0.5 },
    { strong: { root: 50, fifth: 10, octave: 35, third: 5 }, weak: { repeat: 55, step: 10, fifth: 5, octave: 30 } }, { legato: 0.8 }),
];
const profileList = (track) => [...BUILTIN_PROFILES, ...((track && track.profiles) || [])];
const profileById = (track, id) => profileList(track).find((p) => p.id === id) || BUILTIN_PROFILES[0];
const lerpObj = (a, b, t) => { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = (a[k] || 0) * (1 - t) + (b[k] || 0) * t; return o; };
// iki profilin doğrusal karışımı (şablon ağırlıkları, rol ağırlıkları, öncül karışımı, sıçrama sınırı, legato); şablonlar ikisinden de gelir
function blendProfiles(A, B, t) {
  if (!B || t <= 0) return A;
  if (t >= 1) return B;
  const roles = {}, rolesOf = (p, type) => (type === 'synth' && p.synthRoles ? p.synthRoles : p.roles);
  const out = { id: A.id + '+' + B.id, name: `${A.name} ↔ ${B.name}`, templateWeights: {}, roles, synthRoles: null, templates: [...(A.templates || []), ...(B.templates || [])], leapLimit: A.leapLimit * (1 - t) + B.leapLimit * t, legato: A.legato * (1 - t) + B.legato * t, blend: true };
  for (const id of new Set([...Object.keys(A.templateWeights), ...Object.keys(B.templateWeights)])) out.templateWeights[id] = (A.templateWeights[id] ?? 1) * (1 - t) + (B.templateWeights[id] ?? 1) * t;
  for (const r of Object.keys(DEFAULT_ROLES)) roles[r] = lerpObj(A.roles[r] || {}, B.roles[r] || {}, t);
  out.synthRoles = {};
  for (const r of Object.keys(DEFAULT_ROLES)) out.synthRoles[r] = lerpObj(rolesOf(A, 'synth')[r] || {}, rolesOf(B, 'synth')[r] || {}, t);
  if (A.rolesByEnergy || B.rolesByEnergy) out.rolesByEnergy = null; // karışımda tek (orta) küme kullanılır
  return out;
}
function activeProfile(track) {
  const A = profileById(track, track.styleProfileId);
  const m = track.styleMix;
  return m && m.profileB && m.amount > 0 ? blendProfiles(A, profileById(track, m.profileB), clamp(m.amount, 0, 1)) : A;
}
// bir slot rolü için ağırlıklar: profil (öğrenilmişse enerjiye göre kovalar arasında), synth kayması, şablon önyargısı, enerji kayması
function roleWeights(prof_, type, role, energy, tplBias) {
  let w;
  if (prof_.rolesByEnergy && !(type === 'synth' && prof_.synthRoles)) {
    const b = prof_.rolesByEnergy, e = clamp(energy, 0, 1);
    const pts = [[0.17, b.low], [0.5, b.mid], [0.83, b.high]];
    let lo = pts[0], hi = pts[2];
    for (let i = 0; i < 2; i++) if (e >= pts[i][0] && e <= pts[i + 1][0]) { lo = pts[i]; hi = pts[i + 1]; }
    const t = clamp((e - lo[0]) / (hi[0] - lo[0] || 1), 0, 1);
    w = lerpObj((lo[1] && lo[1][role]) || prof_.roles[role] || {}, (hi[1] && hi[1][role]) || prof_.roles[role] || {}, e <= lo[0] ? 0 : e >= hi[0] ? 1 : t);
  } else w = Object.assign({}, type === 'synth' ? (prof_.synthRoles || SYNTH_ROLES)[role] || SYNTH_ROLES[role] : prof_.roles[role] || DEFAULT_ROLES[role]);
  if (tplBias && tplBias[role]) w = Object.assign({}, tplBias[role]);
  const home = role === 'strong' ? 'root' : role === 'weak' ? 'repeat' : null;
  if (home && w[home] != null && !(prof_.rolesByEnergy && !(type === 'synth' && prof_.synthRoles))) {
    // enerji kayması: 0'da 20 puan köke (diğerlerinden orantılı), 1'de 20 puan kökten oktava
    if (energy < 0.5) { const m = (20 * (0.5 - energy)) / 0.5, others = Object.keys(w).filter((k) => k !== home), tot = others.reduce((a, k) => a + w[k], 0); const take = Math.min(m, tot); if (tot > 0) for (const k of others) w[k] -= (take * w[k]) / tot; w[home] += take; }
    else { const m = Math.min(w[home], (20 * (energy - 0.5)) / 0.5); w[home] -= m; w.octave = (w.octave || 0) + m; }
  }
  return w;
}

// ---------------------------------------------------------------- 3) VERİ MODELİ
const ENERGY_DEFAULTS = { intro: [0.2, 0.3], verse: [0.3, 0.5], prechorus: [0.5, 0.7], chorus: [0.75, 0.9], postchorus: [0.6, 0.8], bridge: [0.2, 0.5], outro: [0.4, 0.1], instrumental: [0.5, 0.5], other: [0.5, 0.5] };
function defaultBassSection(type, instrumentType) {
  const [a, b] = ENERGY_DEFAULTS[type] || ENERGY_DEFAULTS.other;
  return { energyStart: a, energyEnd: b, templateFamily: 'auto', density: 0.5, registerOffset: 0, fills: instrumentType !== 'synth', hypnotic: false, filterStart: null, filterEnd: null, sweepBars: 0, locked: false };
}
function defaultBassTrack() {
  return {
    enabled: false, generated: false, volume: 0.8, seed: 1, instrumentType: 'bass-guitar', instrumentPreset: 'Dark pick', layer: null, doubleLow: false,
    styleProfileId: 'post-punk-drive', styleMix: null, range: Object.assign({}, RANGE_DEFAULT['bass-guitar']),
    synthGuitarTemplates: false, pump: 0, resonance: null, drive: null,
    sections: {}, bars: [], loops: [], customTemplates: [], profiles: [],
    tap: { grid: '16n', latencyMs: 0, mode: 'asPlayed', loopBars: 1 },
  };
}
const emptyBar = (i, sectionId) => ({ index: i, sectionId: sectionId || null, templateId: '', energy: 0.5, rerollCount: 0, locked: false, source: 'generated', notes: [], recipe: null, sig: '', warnings: [] });

// ---------------------------------------------------------------- 4) BAĞLAM: akor izi + bölüm anahtarı (akorlar kopyalanmaz, okunur)
function bassContext(d, proj) {
  const g = d.g, meter = proj.settings.meter, steps = stepsOf(meter);
  const secs = d.sections.slice().sort((a, b) => a.startBar - b.startBar);
  const byBar = [];
  for (const c of d.chords) (byBar[c.bar - 1] = byBar[c.bar - 1] || []).push(c);
  const ctx = { d, g, meter, steps, barQ: g.barQ, bars: d.bars, secs };
  ctx.secOf = (i) => secs.find((s) => i + 1 >= s.startBar && i + 1 <= s.endBar) || null;
  // bir ölçünün akor dilimleri: [{s0, s1, chord}] adım aralıkları; akorsuz boşluklar komşudan doldurulur
  ctx.segs = (i) => {
    const slots = d.chords.filter((c) => c.q1 > i * g.barQ + 1e-6 && c.q0 < (i + 1) * g.barQ - 1e-6);
    if (!slots.length) return null;
    const out = slots.map((c) => ({ s0: Math.round((Math.max(c.q0, i * g.barQ) - i * g.barQ) / STEP_Q), s1: Math.round((Math.min(c.q1, (i + 1) * g.barQ) - i * g.barQ) / STEP_Q), chord: c.chord }));
    out[0].s0 = 0; out[out.length - 1].s1 = steps;
    for (let k = 1; k < out.length; k++) out[k].s0 = out[k - 1].s1;
    return out.filter((s) => s.s1 > s.s0);
  };
  ctx.lastChord = (i) => { for (let k = i; k >= 0; k--) { const s = ctx.segs(k); if (s) return s[s.length - 1].chord; } return null; };
  ctx.firstChord = (i) => { for (let k = i; k < ctx.bars; k++) { const s = ctx.segs(k); if (s) return s[0].chord; } return null; };
  void byBar;
  return ctx;
}
// bölümün gamı: bölüm tonu + modu; ton yoksa akordan (minör akor → minör, aksi halde majör)
function sectionScale(sec, chord) {
  if (sec && sec.tonic != null && sec.mode && C.scalePcs) return C.scalePcs(sec.tonic, sec.mode);
  const t = chord ? mod12(chord.root) : 0, minor = chord && /^m(?!aj)/.test(chord.q);
  return (minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((x) => mod12(t + x));
}
function chordInfo(ch) {
  const q = CHORD_Q[ch.q] ? ch.q : '';
  const iv = CHORD_Q[q], root = mod12(ch.root);
  const dimLike = ['dim', 'm7b5', 'dim7'].includes(q), isAug = q === 'aug', sus = q === 'sus2' || q === 'sus4';
  const third = sus || q === '5' ? null : (iv.find((x, i) => i === 1 && (x === 3 || x === 4)) ?? null);
  const seventh = iv.find((x, i) => i >= 3 && (x === 10 || x === 11 || (q === 'dim7' && x === 9))) ?? null;
  return {
    q, root, bassPc: ch.bass != null ? mod12(ch.bass) : root,
    fifthPc: mod12(root + (dimLike ? 6 : isAug ? 8 : 7)),
    thirdPc: third != null ? mod12(root + third) : null,
    thirdOk: third != null && !dimLike && !isAug && !sus && q !== '5', // üçlü yalnızca majör, minör ve yedili akorlarda
    seventhPc: seventh != null ? mod12(root + seventh) : null,
    pcs: iv.map((x) => mod12(root + x)), minor: iv[1] === 3, dim: dimLike,
  };
}
const sameChord = (a, b) => !!a && !!b && mod12(a.root) === mod12(b.root) && a.q === b.q && (a.bass ?? null) === (b.bass ?? null);
// akor dışı bölümlerde akorun kendi gamı
function chordScale(ch) {
  const ci = chordInfo(ch), r = ci.root;
  const iv = ci.dim ? [0, 2, 3, 5, 6, 8, 10] : ci.q === 'aug' ? [0, 2, 4, 6, 8, 10] : ci.q === '7' || ci.q === '9' || ci.q === 'sus4' || ci.q === 'sus2' ? [0, 2, 4, 5, 7, 9, 10] : ci.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return iv.map((x) => mod12(r + x));
}
function scaleFor(sec, ch) {
  const sc = sectionScale(sec, ch);
  const ci = chordInfo(ch);
  const base = [ci.root, ci.thirdPc, ci.fifthPc].filter((x) => x != null);
  return base.every((p) => sc.includes(p)) ? sc : chordScale(ch);
}

// ---------------------------------------------------------------- 5) PERDE KURALLARI
const foldInto = (m, r) => { while (m > r.high) m -= 12; while (m < r.low) m += 12; return clamp(m, r.low, r.high); };
function nearestPc(pc, target, r, minMidi = -Infinity) {
  let best = null;
  for (let m = r.low; m <= r.high; m++) if (mod12(m) === mod12(pc) && m >= minMidi && (best == null || Math.abs(m - target) < Math.abs(best - target))) best = m;
  if (best == null) for (let m = r.low; m <= r.high; m++) if (mod12(m) === mod12(pc) && (best == null || Math.abs(m - target) < Math.abs(best - target))) best = m;
  return best == null ? foldInto(pc + 12 * Math.round((target - pc) / 12), r) : best;
}
const homeRoot = (pc, center, r) => nearestPc(pc, center, r);
function stepFrom(prev, dir, scale, r) { // gamdaki en yakın ses, yönde
  for (let k = 1; k <= 12; k++) { const m = prev + dir * k; if (m < r.low || m > r.high) return null; if (scale.includes(mod12(m))) return m; }
  return null;
}
// güçlü vuruşta akor sesinin yarım ton üstündeki gam sesine inilmez (kaçınılacak nota)
function avoidNote(m, ci) { const pc = mod12(m); return !ci.pcs.includes(pc) && ci.pcs.some((p) => mod12(p + 1) === pc); }

// pedal çözümü: derece (akorun o anki derecesi) ya da sabit perde sınıfı; çözülemezse köke düş + uyarı
function resolvePedalPc(ped, chord, scale) {
  const ci = chordInfo(chord), warn = [];
  if (ped.kind === 'pitch') { const p = C.parsePc ? C.parsePc(String(ped.pitchClass || 'C')) : null; return { pc: p ? p.pc : 0, warn }; }
  const d = ped.degree || 1;
  const scaleAbove = (a, b) => [a, b].find((x) => scale.includes(mod12(ci.root + x)));
  let iv = null;
  if (d === 1) iv = 0;
  else if (d === 3) iv = ci.thirdPc != null ? mod12(ci.thirdPc - ci.root) : null;
  else if (d === 5) iv = mod12(ci.fifthPc - ci.root);
  else if (d === 7) iv = ci.seventhPc != null ? mod12(ci.seventhPc - ci.root) : scaleAbove(11, 10) ?? null;
  else if (d === 9) iv = ci.pcs.some((p) => mod12(p - ci.root) === 2) && ci.q.includes('9') ? 2 : scaleAbove(2, 1) ?? null;
  else if (d === 11) iv = scaleAbove(5, 6) ?? null;
  else if (d === 13) iv = ci.q === '6' || ci.q === 'm6' ? 9 : scaleAbove(9, 8) ?? null;
  if (iv == null) { warn.push(`pedal derecesi ${d} bu akorda çözülemedi; kök çalındı`); iv = 0; }
  const pc = mod12(ci.root + iv);
  if (d !== 1 && ci.pcs.some((p) => mod12(p + 1) === pc) && !ci.pcs.includes(pc)) warn.push(`pedal derecesi ${d} kaçınılacak nota (akor sesinin yarım ton üstü); yine de çalındı`);
  return { pc, warn };
}
const pedalFor = (bar, sec) => bar.pedal || (sec && sec.pedal) || null;

// ---------------------------------------------------------------- 6) ÖLÇÜ ÜRETİMİ
const ROLE_ACCENT = { anchor: 8, strong: 4, weak: 0, pickup: 3, ghost: 0 };
const NOTE_ROLE = { root: 'root', fifth: 'fifth', octave: 'octave', third: 'third', step: 'passing', 'approach-d': 'approach', 'approach-c': 'chromatic', ghost: 'ghost', fill: 'fill' };
const PHRASE_SHAPE = [-0.03, 0, 0.02, 0.05];
function barEnergy(sec, secSet, i, withShape = true) {
  const n = sec ? sec.endBar - sec.startBar : 0, pos = sec ? i + 1 - sec.startBar : 0;
  const t = n > 0 ? pos / n : 0;
  const e = secSet.energyStart + (secSet.energyEnd - secSet.energyStart) * t;
  return clamp(withShape ? e + PHRASE_SHAPE[((pos % 4) + 4) % 4] : e, 0, 1);
}
// akorun 'iyi' tonu: seçilen pitch rolü → MIDI. Ses yönlendirme: kök = kayıt merkezine en yakın oktav; diğerleri öncekine en yakın oktav
function pitchFor(pr, st) {
  const { ci, range, prev, center, scale, rng, strong } = st;
  const home = homeRoot(ci.bassPc, center, range);
  switch (pr) {
    case 'root': return home;
    case 'octave': { const up = home + 12, dn = home - 12; return up <= range.high ? up : dn >= range.low ? dn : home; }
    case 'fifth': return nearestPc(ci.fifthPc, prev ?? home, range);
    case 'third': return ci.thirdOk ? nearestPc(ci.thirdPc, prev ?? home, range, 36) : nearestPc(ci.fifthPc, prev ?? home, range);
    case 'repeat': return prev == null ? home : prev;
    case 'step': {
      const base = prev ?? home, dirs = rng() < 0.5 ? [1, -1] : [-1, 1];
      for (const dir of dirs) { const m = stepFrom(base, dir, scale, range); if (m != null && !(strong && avoidNote(m, ci))) return m; }
      return base;
    }
    default: return home;
  }
}
// bir sonraki akor köküne öncül: 1–2 yarım ton uzakta; yön, önceki notaya en küçük sıçramayı verir
function approachTone(kind, st, target) {
  const { range, prev, scale, rng } = st;
  const deltas = kind === 'approach-c' ? [-1, 1] : [-2, -1, 1, 2];
  let cands = deltas.map((d) => target + d).filter((m) => m >= range.low && m <= range.high && (kind === 'approach-c' || scale.includes(mod12(m))));
  if (!cands.length) cands = [-1, 1].map((d) => target + d).filter((m) => m >= range.low && m <= range.high);
  if (!cands.length) return target;
  const ref = prev ?? target, bestD = Math.min(...cands.map((m) => Math.abs(m - ref)));
  const near = cands.filter((m) => Math.abs(m - ref) === bestD);
  return near[Math.floor(rng() * near.length)];
}

// planlar: bir ölçünün ritmi (şablon) + perde rolleri dizisi
function drawRoles(track, prof_, type, tpl, energy, rng) {
  const roles = slotRoles(tpl);
  return tpl.slots.map((s, k) => {
    if (s.degree) return s.degree === 'root' ? 'root' : s.degree; // sabit derece: root / fifth / octave
    const r = roles[k];
    if (r === 'anchor') return 'root';
    if (r === 'ghost') return 'repeat';
    return pickW(rng, Object.entries(roleWeights(prof_, type, r, energy, tpl.bias)));
  });
}
function pickTemplate(track, prof_, type, meter, energy, rng, o = {}) {
  const all = templatesFor(track, meter, type).concat(prof_.templates && prof_.templates.length ? prof_.templates.filter((t) => t.meter === meter) : []);
  let pool = all;
  if (o.family && o.family !== 'auto') { const f = all.filter((t) => t.family === o.family); if (f.length) pool = f; }
  if (o.excludeFamily) { const f = pool.filter((t) => t.family !== o.excludeFamily); if (f.length) pool = f; }
  let cand = pool.filter((t) => energy >= t.window[0] - 1e-9 && energy <= t.window[1] + 1e-9);
  if (!cand.length) { const dist = (t) => (energy < t.window[0] ? t.window[0] - energy : energy - t.window[1]); const m = Math.min(...pool.map(dist)); cand = pool.filter((t) => dist(t) === m); }
  const counts = cand.map(onsetCount), lo = Math.min(...counts), hi = Math.max(...counts);
  const dens = o.density ?? 0.5;
  const entries = cand.map((t) => {
    const r = hi > lo ? (onsetCount(t) - lo) / (hi - lo) : 0.5;
    const w = (prof_.templateWeights[t.id] ?? 1) * Math.exp((dens - 0.5) * 3 * (2 * r - 1));
    return [t.id, w];
  });
  const id = pickW(rng, entries);
  return cand.find((t) => t.id === id) || cand[0];
}
// bölümlerin 4 ölçülük cümleleri: A, A, A', B — cümle düzeyinde rastgele akış (tohum, bölüm, cümle no) → ölçüler tek tek yeniden hesaplanabilir
function planMotifs(track, ctx) {
  const type = track.instrumentType, prof_ = activeProfile(track), meter = ctx.meter;
  const plan = new Array(ctx.bars).fill(null);
  let prevFamily = null, prevEnergy = null;
  for (const sec of ctx.secs) {
    const set = track.sections[sec.id]; if (!set) continue;
    const list = templatesFor(track, meter, type);
    const len = sec.endBar - sec.startBar + 1;
    let motifBase = null; // hipnotik: bölümün ilk ölçüsünün ritmi ve rolleri tüm ölçülerde
    for (let p = 0; p * 4 < len; p++) {
      const b0 = sec.startBar - 1 + p * 4, n = Math.min(4, sec.endBar - b0);
      const rng = rngFor(track.seed, 'phrase', sec.id, p);
      const e0 = barEnergy(sec, set, b0);
      const e0free = barEnergy(sec, set, b0, false); // bölüm geçişi kuralı eğri enerjisine bakar (faz biçimi hariç)
      // aynı aile, enerji ailenin penceresinden çıkmadıkça; bölüm geçişinde enerji ≥ 0.25 oynadıysa farklı aile
      let fam = set.templateFamily !== 'auto' ? set.templateFamily : null, excl = null;
      if (!fam && prevFamily && list.some((t) => t.family === prevFamily && e0 >= t.window[0] && e0 <= t.window[1])) fam = prevFamily;
      if (p === 0 && prevEnergy != null && Math.abs(e0free - prevEnergy) >= 0.25 - 1e-9 && set.templateFamily === 'auto') { fam = null; excl = prevFamily; }
      const tplA = set.hypnotic && motifBase ? motifBase.tpl : pickTemplate(track, prof_, type, meter, e0, rng, { family: fam, excludeFamily: excl, density: set.density });
      const rolesA = set.hypnotic && motifBase ? motifBase.roles : drawRoles(track, prof_, type, tplA, e0, rng);
      if (!motifBase) motifBase = { tpl: tplA, roles: rolesA };
      // A': bir slotun rolü değişir (ya da öncül eklenir)
      const roles3 = rolesA.slice();
      const srl = slotRoles(tplA);
      const swappable = srl.map((r, k) => (r === 'strong' || r === 'weak') && !tplA.slots[k].degree ? k : -1).filter((k) => k >= 0);
      let addPickup = false;
      if (swappable.length && rng() < 0.65) {
        const k = swappable[Math.floor(rng() * swappable.length)];
        const w = roleWeights(prof_, type, srl[k], e0, tplA.bias);
        const alt = Object.entries(w).filter(([key]) => key !== roles3[k]);
        roles3[k] = pickW(rng, alt.length ? alt : Object.entries(w));
      } else addPickup = true;
      // B: bir adım yoğun kardeş şablon (varsa), taze roller
      const sib = siblingUp(list, tplA);
      const tplB = sib && e0 + 0.1 >= sib.window[0] - 0.15 ? sib : tplA;
      const rolesB = tplB === tplA && set.hypnotic ? rolesA : drawRoles(track, prof_, type, tplB, clamp(e0 + 0.05, 0, 1), rng);
      for (let k = 0; k < n; k++) {
        const bar = b0 + k;
        if (set.hypnotic) plan[bar] = { tpl: tplA, roles: rolesA, kind: 'H', pos: k, phrase: p, pickup: k === 3 };
        else if (k === 0 || k === 1) plan[bar] = { tpl: tplA, roles: rolesA, kind: k === 0 ? 'A' : 'A2', pos: k, phrase: p };
        else if (k === 2) plan[bar] = { tpl: tplA, roles: roles3, kind: 'A3', pos: k, phrase: p, pickup: addPickup };
        else plan[bar] = { tpl: tplB, roles: rolesB, kind: 'B', pos: k, phrase: p };
      }
      prevFamily = tplA.family;
    }
    prevEnergy = barEnergy(sec, set, sec.endBar - 1, false);
  }
  return plan;
}
// çapa dışı bir öncül yoksa son slotu kısalt, ızgara sonuna 2 adımlık öncül ekle
function withPickup(slots, steps) {
  if (slots.some((s) => s.step >= steps - 4)) return slots;
  const out = slots.map((s) => Object.assign({}, s));
  const last = out[out.length - 1];
  if (last.step + last.len > steps - 2) last.len = Math.max(1, steps - 2 - last.step);
  if (last.step + last.len <= steps - 2) out.push({ step: steps - 2, len: 2, role: 'pickup', pr: 'approach-d' });
  return out;
}
// kayıttan (recipe) plan: slotlar + ritmik rol + perde rolü; döngü, kopyalama, yeniden uydurma bunu kullanır
function recipeOf(bar) {
  if (bar.recipe && bar.recipe.slots) return bar.recipe;
  const slots = bar.notes.filter((n) => n.role !== 'fill' || true).map((n) => ({ step: Math.round(n.startBeat / STEP_Q), len: Math.max(1, Math.round(n.durationBeats / STEP_Q)), pr: n.role === 'passing' ? 'step' : n.role === 'approach' ? 'approach-d' : n.role === 'chromatic' ? 'approach-c' : n.role === 'fill' ? 'step' : n.role }));
  return { templateId: bar.templateId, slots };
}

const toVel = (v) => clamp(Math.round(v), 1, 127);
// ana işlev: bir ölçünün notalarını üretir. env: {track, ctx, i, plan:{slots[{step,len,role,pr,...}]}, rng, prevMidi, energy, secSet, sec}
function buildBarNotes(env) {
  const { track, ctx, i, rng, secSet, sec } = env;
  const type = track.instrumentType, range = track.range, prof_ = activeProfile(track);
  const segs = ctx.segs(i);
  if (!segs) return { notes: [], warnings: [] };
  const energy = env.energy, steps = ctx.steps, meter = ctx.meter;
  const bar = track.bars[i];
  const ped = pedalFor(bar, secSet);
  const tpl = env.tpl;
  const center = CENTER + (secSet.registerOffset || 0) + (tpl.lift && !ped ? tpl.lift : 0);
  const prevChord = ctx.lastChord(i - 1);
  const nextChord = ctx.firstChord(i + 1);
  const lastBarOfSection = sec ? i + 1 === sec.endBar : false;
  const firstBarOfSection = sec ? i + 1 === sec.startBar : i === 0;
  const segAt = (step) => segs.find((s) => step >= s.s0 && step < s.s1) || segs[segs.length - 1];
  let slots = env.slots.map((s, k) => Object.assign({}, s, { sr: s.sr || s.role || env.roles[k] || 'weak' })).sort((a, b) => a.step - b.step);
  // akor değişiminden geçen slot ikiye bölünür: sınırdan sonraki parça yeni akorun çapası olur
  for (const sg of segs.slice(1)) {
    const b = sg.s0, out = [];
    for (const s of slots) {
      if (s.step < b && s.step + s.len > b) { out.push(Object.assign({}, s, { len: b - s.step })); out.push(Object.assign({}, s, { step: b, len: s.step + s.len - b, sr: 'weak', glide: false, pr: 'root' })); }
      else out.push(s);
    }
    slots = out;
  }
  const lastSeg = segs[segs.length - 1];
  const nextDiffers = !!nextChord && !sameChord(lastSeg.chord, nextChord);
  // bölümün son ölçüsü (ya da sabit öncül isteği) her zaman bir sonraki köke öncül ile biter
  if ((lastBarOfSection && nextChord && !ped) || env.forcePickup) slots = withPickup(slots, steps).map((s) => (s.role === 'pickup' && !s.sr ? Object.assign(s, { sr: 'pickup' }) : s));
  const notes = [], warnings = [];
  let prev = env.prevMidi ?? null, prevRole = 'root';
  const nextRoot = nextChord ? homeRoot(chordInfo(nextChord).bassPc, center, range) : null;
  const lockedNext = env.nextFirst; // kilitli komşunun ilk notası
  const target = lockedNext != null ? lockedNext : nextRoot;
  let curChordForNew = prevChord;
  const seenSeg = new Set();
  for (const s of slots) {
    const seg = segAt(s.step), ci = chordInfo(seg.chord);
    // ritmik rol
    let sr = s.sr || 'weak';
    const firstInSeg = !seenSeg.has(seg);
    seenSeg.add(seg);
    const prevSegChord = seg === segs[0] ? curChordForNew : segs[segs.indexOf(seg) - 1].chord;
    const newChord = firstInSeg && (!prevSegChord || !sameChord(prevSegChord, seg.chord));
    if (newChord && !s.ghost) sr = 'anchor'; // yeni akorun ilk onset'i çapa
    const scale = scaleFor(sec, seg.chord);
    const st = { ci, range, prev, center, scale, rng, strong: sr === 'strong' };
    let pr = sr === 'anchor' ? 'root' : s.pr || 'repeat';
    let midi, role;
    const isPickup = sr === 'pickup';
    const nextChordHere = isPickup && seg === lastSeg ? nextChord : null;
    if (ped) {
      const rp = resolvePedalPc(ped, seg.chord, scale);
      for (const w of rp.warn) if (!warnings.includes(w)) warnings.push(w);
      let m = nearestPc(rp.pc, CENTER + (secSet.registerOffset || 0), range);
      m = foldInto(m + 12 * (ped.octave || 0), range);
      if (ped.octaves === 'allow-octave-jumps' && s.octave === 12 && m + 12 <= range.high) m += 12;
      if (ped.approach && isPickup && nextChordHere && !sameChord(seg.chord, nextChord)) {
        const kind = pickW(rng, [['approach-d', 65], ['approach-c', 25]]);
        midi = approachTone(kind, Object.assign({}, st, { prev: m }), target ?? m); role = kind === 'approach-c' ? 'chromatic' : 'approach';
      } else { midi = m; role = 'root'; }
    } else if (s.ghost || sr === 'ghost') {
      midi = prev ?? pitchFor('root', st); role = 'ghost';
    } else if (isPickup && nextChordHere && !sameChord(seg.chord, nextChord) && target != null) {
      const sameRoot = lockedNext == null && chordInfo(nextChord).bassPc === ci.bassPc;
      if (sameRoot) { midi = pitchFor(rng() < 0.7 ? 'root' : 'octave', st); role = 'root'; }
      else if (pr === 'fifth') { midi = pitchFor('fifth', st); role = 'fifth'; }
      else { midi = approachTone(pr === 'approach-c' ? 'approach-c' : 'approach-d', st, target); role = pr === 'approach-c' ? 'chromatic' : 'approach'; }
    } else {
      if (isPickup && (pr === 'approach-d' || pr === 'approach-c')) pr = pr === 'approach-d' ? 'step' : 'repeat'; // akor değişmiyor: öncül zayıf slot gibi
      if (pr === 'approach-d' || pr === 'approach-c') pr = 'repeat';
      if (pr === 'third' && !ci.thirdOk) pr = 'fifth';
      midi = pitchFor(pr, st);
      role = NOTE_ROLE[pr] || (pr === 'repeat' ? prevRole : 'root');
      if (pr === 'repeat' && role === 'ghost') role = 'root';
    }
    if (s.octave === 12 && !ped && !s.ghost && midi + 12 <= range.high) midi += 12;
    midi = foldInto(midi, range);
    // en büyük sıçrama: oktav ve dolgu dışında
    const leap = prof_.leapLimit ?? 12;
    if (prev != null && role !== 'octave' && role !== 'fill' && Math.abs(midi - prev) > leap && !ped && sr !== 'anchor') {
      const alt = [midi - 12, midi + 12].filter((m) => m >= range.low && m <= range.high && Math.abs(m - prev) < Math.abs(midi - prev));
      if (alt.length) midi = alt[0];
    }
    // dinamik
    let vel = (60 + 50 * energy + (ROLE_ACCENT[sr] ?? 0)) * (s.vel ?? 1);
    if (role === 'ghost') vel = (60 + 50 * energy) * 0.4;
    if (firstBarOfSection && sr === 'anchor' && s.step === 0) vel += 10;
    if (s.accent && type === 'synth') vel += 20;
    vel += (rng() - 0.5) * 4;
    const dur = s.len * STEP_Q;
    const n = { startBeat: s.step * STEP_Q, durationBeats: dur, midi, velocity: toVel(vel), role };
    if (s.glide) n.glide = true;
    if (s.accent && type === 'synth') n.accent = true;
    // kapı / legato
    if (role === 'ghost') n.gate = type === 'synth' ? 0.15 : 1;
    else if (type === 'synth') n.gate = s.gate ?? tpl.gate ?? (tpl.family === 'drone' ? 0.95 : 0.6);
    else n.gate = s.gate ?? Math.min(1, prof_.legato ?? 0.92);
    if (role === 'ghost' && type !== 'synth') n.durationBeats = STEP_Q; // ölü nota: bir adım
    if (s.pr) n.pr = s.pr;
    notes.push(n);
    prev = midi; prevRole = role;
    curChordForNew = seg.chord;
  }
  // bölümün ilk ölçüsü: çapa bir adım uzun tutulur (sonraki onset izin veriyorsa)
  if (firstBarOfSection && notes.length) {
    const a = notes[0];
    if (a.startBeat === 0 && (!notes[1] || notes[1].startBeat >= a.durationBeats + STEP_Q - 1e-9)) a.durationBeats += STEP_Q;
  }
  return { notes, warnings };
}
// dolgu: cümle sonunda son 1–2 vuruş yerine 3–4 notalık gam koşusu (ya da yüksek enerjide oktav sıçraması + glide), sıradaki köke doğru
function applyFill(env, res) {
  const { track, ctx, i, rng, secSet, sec } = env;
  const range = track.range, steps = ctx.steps, segs = ctx.segs(i);
  const nextChord = ctx.firstChord(i + 1);
  if (!nextChord || !res.notes.length) return false;
  const center = CENTER + (secSet.registerOffset || 0);
  const opts = [{ W: 4, n: 4, len: 1 }, { W: 6, n: 3, len: 2 }, { W: 8, n: 4, len: 2 }];
  const o = opts[Math.floor(rng() * opts.length)];
  if (steps < o.W + 4) return false;
  const w0 = steps - o.W;
  const before = res.notes.filter((n) => n.startBeat / STEP_Q < w0);
  if (!before.length) return false;
  const lastSeg = segs[segs.length - 1];
  if (lastSeg.s0 >= w0) return false; // akor değişimi pencerenin içinde ya da başında: çapa korunur
  const scale = scaleFor(sec, lastSeg.chord);
  const ci = chordInfo(lastSeg.chord);
  const target = env.nextFirst ?? homeRoot(chordInfo(nextChord).bassPc, center, range);
  const prev = before[before.length - 1].midi;
  const st = { ci, range, prev, center, scale, rng };
  const fills = [];
  const vel = toVel(60 + 50 * env.energy + 6);
  const ap = approachTone('approach-d', st, target);
  if (env.energy > 0.7 && rng() < 0.4) {
    const home = homeRoot(ci.bassPc, center, range), oct = home + 12 <= range.high ? home + 12 : home - 12;
    fills.push({ startBeat: w0 * STEP_Q, durationBeats: (o.W / 2) * STEP_Q, midi: foldInto(oct, range), velocity: vel, role: 'fill', glide: true, gate: 0.95 });
    fills.push({ startBeat: (w0 + o.W / 2) * STEP_Q, durationBeats: (o.W / 2) * STEP_Q, midi: ap, velocity: vel, role: 'fill', gate: 0.95 });
  } else {
    const dir = ap >= prev ? 1 : -1, ms = [ap];
    for (let k = 1; k < o.n; k++) { const m = stepFrom(ms[0], -dir, scale, range); ms.unshift(m != null ? m : ms[0]); }
    // başlangıç notasına yakın kalsın
    ms.forEach((m, k) => fills.push({ startBeat: (w0 + (k * o.W) / o.n) * STEP_Q, durationBeats: ((o.W / o.n) * STEP_Q), midi: m, velocity: vel + (k === o.n - 1 ? 2 : 0), role: 'fill', gate: 0.9 }));
  }
  // pencere içindeki eski notalar silinir, öncekiler pencere başında kesilir
  res.notes = before.map((n) => (n.startBeat + n.durationBeats > w0 * STEP_Q ? Object.assign({}, n, { durationBeats: w0 * STEP_Q - n.startBeat }) : n)).concat(fills);
  return true;
}
const noteKey = (n) => `${n.startBeat}|${n.durationBeats}|${n.midi}`;
const barKey = (b) => b.notes.map(noteKey).join(';');
// ölçü imzası: akorlar, bölüm anahtarı, ölçü ve bir sonraki ölçünün ilk akoru (öncül için) — değişirse "kirli"
function barSig(ctx, track, i) {
  const segs = ctx.segs(i), sec = ctx.secOf(i);
  const nx = ctx.firstChord(i + 1), pv = ctx.lastChord(i - 1);
  const f = (c) => (c ? `${mod12(c.root)}${c.q}/${c.bass ?? ''}` : '-');
  return [ctx.meter, sec ? `${sec.id}:${sec.tonic}:${sec.mode}:${i + 1 === sec.endBar ? 'E' : ''}${i + 1 === sec.startBar ? 'S' : ''}` : '-', segs ? segs.map((s) => `${s.s0}-${s.s1}:${f(s.chord)}`).join(',') : '-', f(nx), f(pv), track.instrumentType, track.range.low + ':' + track.range.high].join('|');
}

// bir ölçüyü üretir (planlı); locked/loop ölçüler atlanır. opts.free: kendi akışından şablon + roller seç (yeniden zar)
function generateBar(track, ctx, i, motifs, opts = {}) {
  const bar = track.bars[i], sec = ctx.secOf(i);
  const secSet = track.sections[sec ? sec.id : '_none'] || defaultBassSection('other', track.instrumentType);
  const type = track.instrumentType, prof_ = activeProfile(track), meter = ctx.meter;
  const energy = barEnergy(sec, secSet, i);
  const salt = opts.salt || 0;
  const hyp = secSet.hypnotic && bar.rerollCount === 0 && !opts.free && !opts.recipe; // hipnotik: her ölçüde aynı akış → birebir tekrar
  const rng = hyp ? rngFor(track.seed, 'hyp', sec ? sec.id : '_none', salt) : rngFor(track.seed, 'bar', i, bar.rerollCount, salt);
  const idx = tplIndex(track);
  let tpl, prs, kind = 'free';
  let plan = motifs && motifs[i];
  if (bar.source === 'tapped' && bar.recipe && bar.recipe.templateId && idx.get(bar.recipe.templateId)) {
    tpl = idx.get(bar.recipe.templateId); prs = drawRoles(track, prof_, type, tpl, energy, rng); kind = 'tapped';
  } else if (opts.recipe) {
    tpl = null; kind = 'recipe';
  } else if (plan && bar.rerollCount === 0 && !opts.free && plan.tpl.meter === meter) {
    tpl = plan.tpl; prs = plan.roles; kind = plan.kind;
  } else {
    tpl = pickTemplate(track, prof_, type, meter, energy, rng, { family: secSet.templateFamily, density: secSet.density });
    prs = drawRoles(track, prof_, type, tpl, energy, rng);
  }
  let slots, roles;
  if (opts.recipe) {
    slots = opts.recipe.slots.map((s) => Object.assign({}, s));
    const base = idx.get(opts.recipe.templateId) || {};
    tpl = Object.assign({ family: 'walk', window: [0, 1] }, base, { id: opts.recipe.templateId || 'recipe', meter, steps: ctx.steps, slots });
    roles = slotRoles(tpl);
  }
  else { slots = tpl.slots.map((s, k) => Object.assign({}, s, { pr: prs[k] })); roles = slotRoles(tpl); }
  // A' çeşitlemesi: öncül eklenir
  const nextC = ctx.firstChord(i + 1), curLast = ctx.lastChord(i);
  let forcePickup = !!(plan && plan.pickup && kind !== 'free' && !opts.recipe && (!secSet.hypnotic || (nextC && curLast && !sameChord(nextC, curLast))));
  const env = { track, ctx, i, rng, secSet, sec, tpl, slots, roles, energy, prevMidi: opts.prevMidi, nextFirst: opts.nextFirst, forcePickup };
  let res = buildBarNotes(env);
  // dolgu: cümle sonu (4. ölçü ya da bölümün son ölçüsü), bölüm izin veriyor, pedal yok
  const pos = sec ? (i + 1 - sec.startBar) % 4 : 0, phraseEnd = pos === 3 || (sec && i + 1 === sec.endBar);
  const ped = pedalFor(bar, secSet);
  if (phraseEnd && secSet.fills && !ped && !opts.noFill && !opts.recipe && rng() < 0.15 + 0.5 * energy) applyFill(env, res);
  bar.templateId = tpl.id; bar.energy = energy; bar.sectionId = sec ? sec.id : null; bar.warnings = res.warnings;
  bar.notes = res.notes;
  bar.recipe = { templateId: tpl.id, slots: slots.map((s) => ({ step: s.step, len: s.len, pr: s.pr, sr: s.sr, role: s.role, octave: s.octave, ghost: s.ghost, vel: s.vel, accent: s.accent, glide: s.glide, gate: s.gate, degree: s.degree })) };
  bar.sig = barSig(ctx, track, i);
  return res;
}

// ---------------------------------------------------------------- 7) YENİDEN YÜRÜTME: sıralı üretim, sıfır-üçlü kuralı, bağlar, döngüler
const isFixed = (b) => b.locked || b.source === 'loop';
function prevNote(track, i) { for (let k = i - 1; k >= 0; k--) { const b = track.bars[k]; if (b && b.notes.length) return b.notes[b.notes.length - 1].midi; } return null; }
function firstNoteOf(track, i) { const b = track.bars[i]; return b && isFixed(b) && b.notes.length ? b.notes[0].midi : null; }
function nextFixedFirst(track, i) { return firstNoteOf(track, i + 1); }
function triple(track, i) { // i, i-1, i-2 aynı notalar mı (kilit / döngü / hipnotik değilken)
  const b = track.bars;
  if (i < 2 || !b[i] || !b[i - 1] || !b[i - 2]) return false;
  const k = barKey(b[i]); if (!k) return false;
  return k === barKey(b[i - 1]) && k === barKey(b[i - 2]);
}
function noTriple(track, ctx, i, motifs, opts) {
  const sec = ctx.secOf(i), secSet = track.sections[sec ? sec.id : '_none'];
  if (secSet && secSet.hypnotic) return;
  const bad = () => [i, i + 1, i + 2].some((e) => track.bars[e] && !track.bars[e].locked && track.bars[e].source !== 'loop' && triple(track, e) && ![e, e - 1, e - 2].some((x) => isFixed(track.bars[x] || {}) && x !== i));
  for (let salt = 1; salt <= 6 && bad(); salt++) generateBar(track, ctx, i, motifs, Object.assign({}, opts, { salt, free: salt >= 3, prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i) }));
  if (bad()) { // son çare: son notayı beşliye / oktava al
    const b = track.bars[i], n = b.notes[b.notes.length - 1];
    if (n) { const alt = [n.midi + 7, n.midi - 5, n.midi + 12, n.midi - 12].find((m) => m >= track.range.low && m <= track.range.high && m !== n.midi); if (alt != null) n.midi = alt; }
  }
}
function applyTies(track, ctx, from = 0, to = track.bars.length - 1) {
  const idx = tplIndex(track);
  for (let i = Math.max(0, from); i <= Math.min(to, track.bars.length - 2); i++) {
    const a = track.bars[i], b = track.bars[i + 1];
    if (!a || !b || !a.notes.length || !b.notes.length) continue;
    const t = idx.get(a.templateId);
    const n = a.notes[a.notes.length - 1], m = b.notes[0];
    const want = !!(t && t.tieAcross) && track.instrumentType === 'synth' && m.startBeat === 0 && m.midi === n.midi && n.startBeat + n.durationBeats >= ctx.barQ - 1e-9 && idx.get(b.templateId) && idx.get(b.templateId).tieAcross;
    if (want) { n.tie = true; n.gate = 1; } else if (n.tie) delete n.tie;
  }
}
function sectionSettings(track, ctx) { // yeni bölümler için varsayılan ayarlar
  const live = new Set();
  const list = ctx.secs.length ? ctx.secs : [{ id: '_none', typeNorm: 'other' }];
  for (const s of list) { live.add(s.id); if (!track.sections[s.id]) track.sections[s.id] = defaultBassSection(s.typeNorm || C.normSectionType(s.type || s.name || ''), track.instrumentType); }
  return live;
}
function ensureBars(track, ctx) {
  while (track.bars.length < ctx.bars) track.bars.push(emptyBar(track.bars.length, null));
  track.bars.forEach((b, i) => { b.index = i; const s = ctx.secOf(i); b.sectionId = s ? s.id : null; });
  sectionSettings(track, ctx);
}
function seedBarRange(track, ctx, from, to, o = {}) {
  const motifs = planMotifs(track, ctx);
  for (let i = from; i <= to; i++) {
    const b = track.bars[i];
    if (!b || isFixed(b)) continue;
    if (o.only && !o.only.has(i)) continue;
    generateBar(track, ctx, i, motifs, { prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i), free: o.free });
    noTriple(track, ctx, i, motifs, { prevMidi: prevNote(track, i) });
  }
  applyTies(track, ctx, from - 1, to + 1);
}
function applyLoops(track, ctx) {
  for (const L of track.loops || []) {
    const src = [];
    for (let k = 0; k < L.sourceLength; k++) src.push(track.bars[L.sourceStart + k]);
    if (src.some((b) => !b)) continue;
    for (let i = L.targetStart; i <= L.targetEnd && i < track.bars.length; i++) {
      const s = src[(i - L.targetStart) % L.sourceLength], b = track.bars[i];
      b.source = 'loop'; b.locked = false; b.loopId = L.id;
      if (L.mode === 'exact') { b.notes = s.notes.map((n) => Object.assign({}, n)); b.templateId = s.templateId; b.recipe = s.recipe; b.pedal = s.pedal; b.energy = s.energy; b.warnings = s.warnings || []; b.sig = barSig(ctx, track, i); }
      else {
        const sec = ctx.secOf(i), secSet = track.sections[sec ? sec.id : '_none'];
        b.pedal = s.pedal ? Object.assign({}, s.pedal) : undefined;
        const rec = recipeOf(s);
        generateBar(track, ctx, i, null, { recipe: rec, prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i), noFill: true });
        b.source = 'loop'; b.loopId = L.id; void secSet;
      }
    }
  }
}
function invalidateLoopsFor(track, i) { return (track.loops || []).filter((L) => (i >= L.sourceStart && i < L.sourceStart + L.sourceLength) || (i >= L.targetStart && i <= L.targetEnd)); }

// bas izini projenin akor izine uydurur: yeni ölçüler eklenir, kirli kilitsiz ölçüler yeniden üretilir, kilitliler işaretlenir
function bassSync(track, ctx, o = {}) {
  ensureBars(track, ctx);
  if (!track.generated) return { regenerated: [], flagged: [] }; // henüz Generate'e basılmadı
  const regenerated = [], flagged = [];
  const dirty = [];
  for (let i = 0; i < ctx.bars; i++) {
    const b = track.bars[i], sig = barSig(ctx, track, i);
    if (b.sig === sig) { if (b.dirtyLocked) delete b.dirtyLocked; continue; }
    if (!b.notes.length && !b.sig) { dirty.push(i); continue; } // yeni ölçü
    if (b.source === 'loop') { dirty.push(i); continue; }
    if (b.locked || b.source === 'manual') { b.dirtyLocked = true; flagged.push(i); continue; }
    dirty.push(i);
  }
  if (dirty.length && (o.generate !== false)) {
    const only = new Set();
    for (const i of dirty) { only.add(i); }
    const first = Math.min(...dirty), last = Math.max(...dirty);
    // yalnızca kirli ölçüler; tohum + ölçü + yeniden zar sayısı aynı akışı verir
    const motifs = planMotifs(track, ctx);
    for (const i of dirty.sort((a, b) => a - b)) {
      const b = track.bars[i];
      if (b.source === 'loop') continue;
      generateBar(track, ctx, i, motifs, { prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i) });
      noTriple(track, ctx, i, motifs, { prevMidi: prevNote(track, i) });
      regenerated.push(i);
    }
    applyTies(track, ctx, first - 1, last + 1);
  }
  if (track.loops && track.loops.length) applyLoops(track, ctx);
  return { regenerated, flagged };
}
function bassGenerateAll(track, ctx) {
  ensureBars(track, ctx);
  track.generated = true;
  seedBarRange(track, ctx, 0, ctx.bars - 1);
  applyLoops(track, ctx);
  applyTies(track, ctx);
  for (const b of track.bars) delete b.dirtyLocked;
}
const bassNewSeed = (track, ctx, seed) => { track.seed = seed ?? ((Math.floor(Math.random() * 2147483646) + 1) | 0); bassGenerateAll(track, ctx); };
function bassReroll(track, ctx, i) {
  const b = track.bars[i];
  if (!b || isFixed(b)) return false;
  b.rerollCount++;
  const motifs = planMotifs(track, ctx);
  generateBar(track, ctx, i, motifs, { prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i), free: true });
  noTriple(track, ctx, i, motifs, { prevMidi: prevNote(track, i) });
  applyTies(track, ctx, i - 1, i + 1);
  applyLoops(track, ctx);
  return true;
}
// yoğunlaştır / seyrekleştir: ailedeki komşu şablona geç
function bassDensity(track, ctx, i, dir) {
  const b = track.bars[i]; if (!b || b.locked || b.source === 'loop') return false;
  const idx = tplIndex(track), tpl = idx.get(b.templateId); if (!tpl) return false;
  const list = templatesFor(track, ctx.meter, track.instrumentType).concat(tpl.custom ? [tpl] : []);
  const nb = dir > 0 ? siblingUp(list, tpl) : siblingDown(list, tpl);
  if (!nb) return false;
  const rng = rngFor(track.seed, 'dens', i, b.rerollCount, nb.id);
  const sec = ctx.secOf(i), secSet = track.sections[sec ? sec.id : '_none'], energy = barEnergy(sec, secSet, i);
  const roles = drawRoles(track, activeProfile(track), track.instrumentType, nb, energy, rng);
  const slots = nb.slots.map((s, k) => Object.assign({}, s, { pr: roles[k] }));
  generateBar(track, ctx, i, null, { recipe: { templateId: nb.id, slots }, prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i), noFill: true });
  applyTies(track, ctx, i - 1, i + 1); applyLoops(track, ctx);
  return true;
}
// ritmi ve rolleri ileri kopyala, her ölçünün akoruna yeniden perdele
function bassCopyForward(track, ctx, i, count) {
  const src = track.bars[i]; if (!src) return 0;
  const rec = recipeOf(src);
  let n = 0;
  for (let k = i + 1; k <= i + count && k < ctx.bars; k++) {
    const b = track.bars[k];
    if (b.locked || b.source === 'loop') continue;
    b.pedal = src.pedal ? Object.assign({}, src.pedal) : b.pedal;
    generateBar(track, ctx, k, null, { recipe: rec, prevMidi: prevNote(track, k), nextFirst: nextFixedFirst(track, k), noFill: true });
    n++;
  }
  applyTies(track, ctx, i, i + count + 1); applyLoops(track, ctx);
  return n;
}
// kilitli (ya da elle) ölçüyü yeni akora uydur: ritim ve roller aynı, perdeler yeni akora
function bassRefit(track, ctx, i) {
  const b = track.bars[i]; if (!b) return false;
  const rec = recipeOf(b), keep = { locked: b.locked, source: b.source, rc: b.rerollCount };
  generateBar(track, ctx, i, null, { recipe: rec, prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i), noFill: true });
  b.locked = keep.locked; b.source = keep.source; b.rerollCount = keep.rc; delete b.dirtyLocked;
  applyTies(track, ctx, i - 1, i + 1); applyLoops(track, ctx);
  return true;
}
function bassClear(track, ctx, i) { const b = track.bars[i]; if (!b) return; b.notes = []; b.recipe = null; b.locked = true; b.source = 'manual'; b.sig = barSig(ctx, track, i); delete b.dirtyLocked; applyLoops(track, ctx); }
function bassLock(track, i, on) { const b = track.bars[i]; if (b && b.source !== 'loop') b.locked = on; }
function bassLockRange(track, a, z, on) { for (let i = a; i <= z; i++) bassLock(track, i, on); }
function bassLockSection(track, ctx, secId, on) { const s = ctx.secs.find((x) => x.id === secId); if (!s) return; track.sections[secId].locked = on; bassLockRange(track, s.startBar - 1, s.endBar - 1, on); }
function bassSetPedal(track, ctx, a, z, pedal) {
  ensureBars(track, ctx);
  for (let i = a; i <= z; i++) { const b = track.bars[i]; if (!b) continue; if (pedal) b.pedal = Object.assign({ kind: 'degree', degree: 1, octave: 0, octaves: 'strict', approach: false }, pedal); else delete b.pedal; }
}
// ---- döngüler
function overlapsLoop(L, other) {
  const r = (x) => [[x.sourceStart, x.sourceStart + x.sourceLength - 1], [x.targetStart, x.targetEnd]];
  return r(L).some(([a, b]) => r(other).some(([c, d]) => a <= d && c <= b));
}
function bassMakeLoop(track, ctx, L) {
  L = Object.assign({ id: 'loop' + Math.random().toString(36).slice(2, 7), mode: 'follow-chords' }, L);
  if (L.sourceLength < 1 || L.sourceLength > 8) return { ok: false, reason: 'Kaynak 1–8 ölçü olmalı.' };
  if (L.targetStart < L.sourceStart + L.sourceLength) return { ok: false, reason: 'Hedef, kaynağın bittiği yerde ya da sonrasında başlamalı.' };
  if (L.targetEnd < L.targetStart || L.targetEnd >= ctx.bars) return { ok: false, reason: 'Hedef aralığı geçersiz.' };
  if ((track.loops || []).some((o) => overlapsLoop(L, o))) return { ok: false, reason: 'Döngüler birbiriyle çakışamaz.' };
  for (let k = 0; k < L.sourceLength; k++) { const b = track.bars[L.sourceStart + k]; if (!b || !b.notes.length) return { ok: false, reason: 'Kaynak ölçülerde nota yok.' }; if (b.source === 'loop') return { ok: false, reason: 'Kaynak ölçü başka bir döngünün kopyası.' }; b.locked = true; }
  track.loops = track.loops || []; track.loops.push(L);
  applyLoops(track, ctx);
  return { ok: true, loop: L };
}
function bassBreakLoop(track, ctx, id) {
  const L = (track.loops || []).find((x) => x.id === id); if (!L) return false;
  for (let i = L.targetStart; i <= L.targetEnd; i++) { const b = track.bars[i]; if (b && b.source === 'loop') { b.source = 'generated'; b.locked = true; delete b.loopId; } }
  track.loops = track.loops.filter((x) => x.id !== id);
  return true;
}
const loopCopyOf = (track, i) => { const b = track.bars[i]; return b && b.source === 'loop' ? (track.loops || []).find((L) => L.id === b.loopId) || null : null; };
// ---- elle düzenleme: nota ekle / sil / taşı / boyutlandır; ölçü 'manual' ve kilitli olur
function manualTouch(track, ctx, i) { const b = track.bars[i]; b.source = 'manual'; b.locked = true; b.recipe = null; b.sig = barSig(ctx, track, i); delete b.dirtyLocked; b.notes.sort((a, c) => a.startBeat - c.startBeat); applyLoops(track, ctx); }
function bassAddNote(track, ctx, i, n) { const b = track.bars[i]; if (!b || b.source === 'loop') return null; const note = Object.assign({ durationBeats: 0.5, velocity: 90, role: 'root' }, n); b.notes.push(note); manualTouch(track, ctx, i); return note; }
function bassDeleteNote(track, ctx, i, k) { const b = track.bars[i]; if (!b || b.source === 'loop' || !b.notes[k]) return false; b.notes.splice(k, 1); manualTouch(track, ctx, i); return true; }
function bassUpdateNote(track, ctx, i, k, patch) {
  const b = track.bars[i]; if (!b || b.source === 'loop' || !b.notes[k]) return false;
  const n = b.notes[k];
  Object.assign(n, patch);
  n.midi = clamp(Math.round(n.midi), 0, 127); n.startBeat = Math.max(0, Math.round(n.startBeat / STEP_Q) * STEP_Q); n.durationBeats = Math.max(STEP_Q, Math.round(n.durationBeats / STEP_Q) * STEP_Q);
  manualTouch(track, ctx, i); return true;
}

// enstrüman tipi: aralık + preset tipin varsayılanına, kilitli ve elle yazılan ölçüler korunur, geri kalan yeniden üretilir
const BASS_PRESET_NAMES = { 'bass-guitar': ['Dark pick', 'Warm sub', 'Synth saw', 'Fuzz'], synth: ['Moroder pulse', 'Sub drone', 'Acid squelch', 'Reese', 'Analog pluck', 'Synth saw', 'Fuzz'] };
function bassSwitchType(track, ctx, type) {
  if (!BASS_TYPES.includes(type) || type === track.instrumentType) return false;
  track.instrumentType = type;
  track.range = Object.assign({}, RANGE_DEFAULT[type]);
  if (!BASS_PRESET_NAMES[type].includes(track.instrumentPreset)) track.instrumentPreset = BASS_PRESET_NAMES[type][0];
  for (const k of Object.keys(track.sections)) track.sections[k].fills = type !== 'synth' ? track.sections[k].fills || false : false;
  if (track.generated) { seedBarRange(track, ctx, 0, ctx.bars - 1); applyLoops(track, ctx); applyTies(track, ctx); }
  return true;
}
// belirli ölçüleri (kilitsizleri) zar sayısını artırmadan yeniden üret — pedal / ayar değişince
function bassRegenRange(track, ctx, a, z) { seedBarRange(track, ctx, a, z); applyLoops(track, ctx); }
// bölüm ayarı değişince o bölümün kilitsiz ölçüleri yeniden üretilir
function bassRegenSection(track, ctx, secId) {
  const s = ctx.secs.find((x) => x.id === secId); if (!s) return;
  seedBarRange(track, ctx, s.startBar - 1, s.endBar - 1);
  applyLoops(track, ctx);
}

// ---------------------------------------------------------------- TAP: ritmi vuruşlayarak kaydet → özel şablon → perdeleri DAW seçer
// taps: [{q (şarkı başından çeyrek), dq (tuşun basılı kaldığı çeyrek), vel}]; gridSteps 2 = 8'lik, 1 = 16'lık ızgara
// Ham mesafesi bir ızgara adımından kısa iki vuruş birleşir; başlangıç ızgaraya yuvarlanır, uzunluk bırakma anından (≥ bir ızgara adımı)
function tapQuantize(taps, o) {
  const gq = o.gridSteps * STEP_Q, barQ = o.barQ;
  const lo = o.firstBar * barQ, hi = (o.lastBar + 1) * barQ;
  const sorted = taps.slice().sort((a, b) => a.q - b.q);
  const merged = [];
  for (const t of sorted) {
    const last = merged[merged.length - 1];
    if (last && t.q - last.q < gq - 1e-9) { last.dq = Math.max(last.dq, t.q + (t.dq || 0) - last.q); continue; } // birleştir
    merged.push({ q: t.q, dq: t.dq || 0, vel: t.vel });
  }
  const starts = [];
  for (const t of merged) {
    const q0 = Math.round(t.q / gq) * gq;
    if (q0 < lo - 1e-9 || q0 >= hi - 1e-9) continue;
    if (starts.length && Math.abs(starts[starts.length - 1].q0 - q0) < 1e-9) continue; // yuvarlayınca aynı yere düşenler
    starts.push({ q0, dq: Math.max(gq, Math.round(t.dq / gq) * gq), vel: t.vel });
  }
  const perBar = new Map();
  starts.forEach((t, k) => {
    const bar = Math.floor(t.q0 / barQ + 1e-9), nextStart = k + 1 < starts.length ? starts[k + 1].q0 : Infinity;
    const end = Math.min(t.q0 + t.dq, nextStart, (bar + 1) * barQ);
    const len = Math.max(1, Math.round((end - t.q0) / STEP_Q));
    if (!perBar.has(bar)) perBar.set(bar, []);
    perBar.get(bar).push({ step: Math.round((t.q0 - bar * barQ) / STEP_Q), len, vel: t.vel });
  });
  return perBar;
}
function tapTemplate(id, name, meter, onsets, extra) {
  const slots = onsets.map((x) => ({ step: x.step, len: x.len })).sort((a, b) => a.step - b.step);
  return Object.assign({ id, name, family: 'custom', meter, steps: stepsOf(meter), window: [0, 1], suits: BOTH, slots, custom: true }, extra || {});
}
// kaydedilen vuruşları ölçülere uygula. mode: 'asPlayed' (her ölçü kendi ritmi) | 'loop' (ilk 1–2 vuruşlu ölçü seçili aralıkta döngü)
function bassApplyTaps(track, ctx, perBar, o = {}) {
  ensureBars(track, ctx);
  const bars = [...perBar.keys()].sort((a, b) => a - b);
  if (!bars.length) return { ok: false, reason: 'Hiç vuruş yakalanmadı.' };
  const a = o.firstBar ?? bars[0], z = o.lastBar ?? bars[bars.length - 1];
  for (const L of (track.loops || []).slice()) if (overlapsLoop(L, { sourceStart: a, sourceLength: z - a + 1, targetStart: a, targetEnd: z })) bassBreakLoop(track, ctx, L.id); // yeniden vuruş yalnızca seçili ölçüleri değiştirir
  // eski geçici şablonları temizle
  const used = (id) => track.bars.some((b) => b.recipe && b.recipe.templateId === id);
  const motifs = planMotifs(track, ctx);
  const apply = (i) => {
    const b = track.bars[i];
    const id = `tap-${i}-${Math.random().toString(36).slice(2, 6)}`;
    track.customTemplates.push(tapTemplate(id, `Tap ${i + 1}. ölçü`, ctx.meter, perBar.get(i), { temp: true }));
    b.source = 'tapped'; b.locked = false; b.recipe = { templateId: id, slots: [] };
    generateBar(track, ctx, i, motifs, { prevMidi: prevNote(track, i), nextFirst: nextFixedFirst(track, i) });
    b.source = 'tapped';
  };
  if (o.mode === 'loop') {
    const len = Math.min(o.loopBars === 2 ? 2 : 1, bars.length);
    const src = bars.slice(0, len);
    if (src.some((x, k) => x !== src[0] + k)) return { ok: false, reason: 'Döngü için vuruşlu ölçüler art arda olmalı.' };
    src.forEach(apply);
    if (z > src[len - 1]) {
      const r = bassMakeLoop(track, ctx, { sourceStart: src[0], sourceLength: len, targetStart: src[len - 1] + 1, targetEnd: z, mode: o.loopMode || 'follow-chords' });
      if (!r.ok) return r;
    } else src.forEach((i) => { track.bars[i].locked = true; });
  } else for (const i of bars) if (i >= a && i <= z) apply(i);
  track.customTemplates = track.customTemplates.filter((t) => !t.temp || used(t.id));
  applyTies(track, ctx, a - 1, z + 1);
  return { ok: true, bars: bars.filter((i) => i >= a && i <= z).length };
}
// gecikme kalibrasyonu: her vuruşun en yakın tıka (±maxDev sn) farkının medyanı; en az 4 eşleşme gerekir
function tapOffset(clicks, taps, maxDev = 0.3) {
  const d = [];
  for (const t of taps) { let best = null; for (const c of clicks) if (best == null || Math.abs(t - c) < Math.abs(t - best)) best = c; if (best != null && Math.abs(t - best) <= maxDev) d.push(t - best); }
  if (d.length < 4) return { ok: false, n: d.length };
  d.sort((a, b) => a - b);
  const m = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  const mad = d.map((x) => Math.abs(x - m)).sort((a, b) => a - b)[Math.floor(d.length / 2)];
  return { ok: true, n: d.length, offsetMs: Math.round(m * 1000), madMs: Math.round(mad * 1000) };
}
// bir ölçüyü adlandırılmış şablon olarak sakla (üretici bundan sonra onu da seçebilir)
function bassSaveTemplate(track, ctx, i, name) {
  const b = track.bars[i]; if (!b || !b.notes.length) return null;
  const rec = recipeOf(b), nm = String(name || '').trim() || `Şablon ${track.customTemplates.filter((t) => t.saved).length + 1}`;
  const t = tapTemplate('user-' + hash32(nm + b.index + Date.now()).toString(36), nm, ctx.meter, rec.slots.map((s) => ({ step: s.step, len: s.len })), { saved: true });
  track.customTemplates.push(t);
  return t;
}

// ---------------------------------------------------------------- 8) OYNATMA: tek bir dizi nota olayı (saniye) + filtre otomasyonu
function bassEvents(track, g, bars) {
  const ev = [];
  const n = bars ?? track.bars.length;
  for (let i = 0; i < n; i++) {
    const b = track.bars[i]; if (!b) continue;
    for (const nt of b.notes) {
      const q = i * g.barQ + nt.startBeat;
      ev.push({ bar: i, t: q * g.spq, q, dur: nt.durationBeats * g.spq, midi: nt.midi, vel: nt.velocity, role: nt.role, glide: !!nt.glide, accent: !!nt.accent, tie: !!nt.tie, gate: nt.gate ?? 1, ghost: nt.role === 'ghost' });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  // bağlı nota: öncekinin tie bayrağı varsa aynı perdede sıradaki nota zarfı yeniden tetiklemez
  for (let k = 1; k < ev.length; k++) if (ev[k - 1].tie && ev[k - 1].midi === ev[k].midi) ev[k].tiedFrom = true;
  return ev;
}
// süzgeç: bölüm başına start/end (varsayılan: enerjiyi izler); süpürme (sweepBars) cümle başında sıfırlanır. değer → kesim frekansı
const cutoffHz = (v) => 120 * Math.pow(8000 / 120, clamp(v, 0, 1));
function filterAutomation(track, ctx, g) {
  const pts = [];
  for (let i = 0; i < ctx.bars; i++) {
    const sec = ctx.secOf(i), set = track.sections[sec ? sec.id : '_none']; if (!set) continue;
    const b = track.bars[i];
    const fs = set.filterStart ?? set.energyStart, fe = set.filterEnd ?? set.energyEnd;
    const n = sec ? sec.endBar - sec.startBar + 1 : 1, pos = sec ? i - (sec.startBar - 1) : 0;
    let sweep = set.sweepBars || 0;
    if (!sweep && b && b.templateId === 'sub-drone-sweep') sweep = 4;
    const val = (p) => { // p: ölçü içinde konum (ölçü sayısı, kesirli)
      if (sweep > 0) { const cyc = Math.ceil(sweep / 4) * 4, t = clamp(((pos % cyc) + p) / sweep, 0, 1); return fs + (fe - fs) * t; }
      return fs + (fe - fs) * (n > 1 ? clamp((pos + p) / (n - 1), 0, 1) : 0);
    };
    const e = b ? b.energy : 0.5;
    pts.push({ q: i * g.barQ, t: i * g.barQ * g.spq, v: val(0), v1: val(1), dur: g.barSec, res: track.resonance ?? 0.2 + 0.3 * e, drive: track.drive ?? 0.1 + 0.4 * e });
  }
  return pts;
}

// ---------------------------------------------------------------- 9) GERİ ALMA: bas izinin anlık görüntüleri (50 derinlik)
function newHistory() { return { undo: [], redo: [] }; }
function snapshot(track) { return JSON.stringify(track); }
function historyPush(h, track) { h.undo.push(snapshot(track)); if (h.undo.length > 50) h.undo.shift(); h.redo.length = 0; }
function historyUndo(h, track) { if (!h.undo.length) return null; h.redo.push(snapshot(track)); return JSON.parse(h.undo.pop()); }
function historyRedo(h, track) { if (!h.redo.length) return null; h.undo.push(snapshot(track)); return JSON.parse(h.redo.pop()); }

// ---------------------------------------------------------------- 10) MIDI'ye aktarma
function bassMidi(track, proj, d) {
  const g = d.g, notes = [];
  for (const e of bassEvents(track, g, d.bars)) notes.push({ q0: e.q, q1: e.q + Math.max(0.05, (e.dur * (e.gate ?? 1)) / g.spq), midi: e.midi, vel: e.vel });
  return C.writeMidi({ quarterBpm: g.quarterBpm, meter: proj.settings.meter, markers: d.sections.map((s) => ({ q: (s.startBar - 1) * g.barQ, text: s.name })), tracks: [{ name: 'Bas', channel: 3, program: track.instrumentType === 'synth' ? 38 : 33, notes }] });
}

const Bass = {
  STEP_Q, stepsOf, RANGE_DEFAULT, CENTER, BASS_TYPES, BASS_TEMPLATES, templatesFor, tplIndex, fallbackTemplate, siblingUp, siblingDown, slotRoles, strongSteps,
  BUILTIN_PROFILES, profileList, profileById, blendProfiles, activeProfile, roleWeights, DEFAULT_ROLES, SYNTH_ROLES,
  ENERGY_DEFAULTS, defaultBassSection, defaultBassTrack, emptyBar, bassContext, sectionScale, scaleFor, chordInfo, sameChord,
  rngFor, hash32, pickW, barEnergy, PHRASE_SHAPE, planMotifs, generateBar, barSig, recipeOf, applyTies, applyLoops, ensureBars,
  bassSync, bassGenerateAll, bassNewSeed, bassReroll, bassDensity, bassCopyForward, bassRefit, bassClear, bassLock, bassLockRange, bassLockSection, bassSetPedal,
  BASS_PRESET_NAMES, bassSwitchType, bassRegenSection, bassRegenRange, bassMakeLoop, bassBreakLoop, loopCopyOf, bassAddNote, bassDeleteNote, bassUpdateNote, resolvePedalPc, pedalFor,
  tapQuantize, tapTemplate, tapOffset, bassApplyTaps, bassSaveTemplate,
  bassEvents, filterAutomation, cutoffHz, newHistory, historyPush, historyUndo, historyRedo, bassMidi, noteKey, barKey, nearestPc, foldInto, homeRoot,
};
Object.assign(C, { Bass });
})(typeof window !== 'undefined' ? window : globalThis);

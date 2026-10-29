// ---------------------------------------------------------------- GİTAR GROOVE: türe, bölüme, davula ve diğer çalgılara bağlı gitar partisi
// DOM'suz; Core.GuitarGroove (build'de guitar.js'in ardından). Elle yazılmış parti yerine, çalma anında bölüm başına bir parti TÜRETİR:
//   1) tür (paket): her türün enerji kovasına (low / mid / high) göre rolleri vardır (halka, arpej, folk, palm-mute 8'lik, skank, kick vuruşu…),
//   2) bölüm enerjisi: giriş / köprü sade, kıta orta, nakarat dolu,
//   3) davul: o ölçüde çalan loop'un kick'ine kilitlenen roller kick'e vurgu koyar, skank / chop kick'ten kaçınır, vuruşlar trampette keser,
//   4) iş bölümü: piyano / synth arpej çalıyorsa gitar sade (halka, skank, chop, vuruş); piyano blok akor tutuyorsa gitar ritim ya da arpej;
//      piyano yoksa gitar harmoniyi taşır; piyano ya da bas varken üst üç tel (üçlü) çalınır, kalın tellerle çakışma olmaz,
//   5) rastgelelik yok: aynı girdi → aynı parti; insan titremesi küçültülür (davula sıkı).
// Part.groove === true ise geçerlidir; elle düzenlenen parti (groove: false) olduğu gibi çalar.
(function (root) {
const C = root.Core;
const { clamp } = C;
const STEP_Q = 0.25;

// ---------------------------------------------------------------- 1) ROLLER (16'lık ızgarada adım dizisi)
// d aşağı · u yukarı · x ölü · - es; BÜYÜK harf = vurgu. Dinamik roller (stab, chop) kick / trampet adımlarından kurulur.
const grid = (n) => new Array(n).fill('-');
const put = (g, list, ch) => { for (const s of list) if (s >= 0 && s < g.length) g[s] = ch; return g; };
const pick = (s) => s.split('');
const ROLES = {
  // halka: tek vuruş, akor sonuna kadar çalar
  pad: { mode: 'strum', art: 'letRing', sust: true, fit: 'free', steps: ({ n }) => put(grid(n), [0], 'D') },
  pad2: { mode: 'strum', art: 'letRing', sust: true, fit: 'free', steps: ({ n }) => put(put(grid(n), [0], 'D'), [Math.round(n / 2)], 'd') },
  // arpej: ızgara bir maskedir (arpej hızının her adımında bir ses)
  arp8: { mode: 'arpeggio', rate: '8n', dir: 'up', busy: true, fit: 'free', steps: ({ n }) => put(grid(n), range(0, n, 2), 'd').map((c, i) => (i === 0 ? 'D' : c)) },
  arp8ud: { mode: 'arpeggio', rate: '8n', dir: 'upDown', busy: true, fit: 'free', steps: ({ n }) => put(grid(n), range(0, n, 2), 'd').map((c, i) => (i === 0 ? 'D' : c)) },
  travis: { mode: 'arpeggio', rate: '8n', dir: 'travis', busy: true, fit: 'free', steps: ({ n }) => put(grid(n), range(0, n, 2), 'd').map((c, i) => (i === 0 ? 'D' : c)) },
  arp16: { mode: 'arpeggio', rate: '16n', dir: 'up', busy: true, fit: 'free', steps: ({ n }) => put(grid(n), range(0, n, 1), 'd').map((c, i) => (i === 0 ? 'D' : c)) },
  // strum
  folk: { mode: 'strum', busy: true, fit: 'lock', steps: () => pick('D---d-u---u-d-u-') },
  strum8: { mode: 'strum', busy: true, fit: 'lock', steps: ({ n }) => put(grid(n), range(0, n, 2), 'd') },
  strum8ud: { mode: 'strum', busy: true, fit: 'lock', steps: ({ n }) => pick('d-u-d-u-d-u-d-u-').slice(0, n) },
  pm8: { mode: 'strum', art: 'palmMute', busy: true, drive: true, fit: 'lock', steps: ({ n }) => put(grid(n), range(0, n, 2), 'd') },
  gallop: { mode: 'strum', busy: true, drive: true, fit: 'lock', steps: () => pick('d-dd'.repeat(4)) },
  sync: { mode: 'strum', fit: 'lock', steps: () => pick('d--d--d-d--d--d-') },
  // seyrek: yalnızca kick ya da offbeat / backbeat
  skank: { mode: 'strum', art: 'staccato', fit: 'dodge', steps: ({ n }) => put(grid(n), range(2, n, 4), 'u') },
  chop: { mode: 'strum', art: 'staccato', fit: 'free', steps: ({ n, S }) => put(grid(n), S && S.length ? S : [Math.round(n / 4), Math.round((3 * n) / 4)], 'd') },
  stab: { mode: 'strum', fit: 'lock', steps: ({ n, K }) => put(put(grid(n), (K || []).filter((k) => k % 2 === 0 || k === 3 || k === 11), 'd'), [0], 'D') },
};
// 3/4 ve 6/8: tek çeyrek / noktalı çeyrek nabzı; adım sayısı 12 (16'lık ızgara)
const ROLES_34 = {
  pad: ROLES.pad, pad2: { ...ROLES.pad2, steps: ({ n }) => put(put(grid(n), [0], 'D'), [8], 'd') },
  arp8: ROLES.arp8, arp8ud: ROLES.arp8ud, travis: ROLES.arp8,
  waltz: { mode: 'strum', busy: true, fit: 'lock', steps: () => pick('D---d---d---') },
  waltzbass: { mode: 'bassChord', busy: true, fit: 'lock', bassSteps: [0], steps: () => pick('D---d---d---') },
  sync: { mode: 'strum', fit: 'lock', steps: () => pick('D-----d-----') },
};
const ROLES_68 = {
  pad: ROLES.pad, pad2: { ...ROLES.pad2, steps: ({ n }) => put(put(grid(n), [0], 'D'), [6], 'd') },
  arp8: ROLES.arp8, arp8ud: ROLES.arp8ud, travis: ROLES.arp8,
  six8: { mode: 'strum', busy: true, fit: 'lock', steps: () => pick('D---d-u-d-u-') },
  dotted: { mode: 'strum', fit: 'lock', steps: () => pick('D-----d-----') },
};
function range(a, b, step) { const o = []; for (let i = a; i < b; i += step) o.push(i); return o; }
const ROLE_TABLE = { '4/4': ROLES, '3/4': ROLES_34, '6/8': ROLES_68 };

// ---------------------------------------------------------------- 2) TÜRLER: enerji kovasına göre aday roller (öncelik sırasıyla)
// off: bölüm enerjisine eklenen kayma · lift: yüksek kovada ton bir kademe yükselir (clean → crunch → drive) · led: gitar ana ritim çalgısı (piyano meşgulken de çalar)
const FEELS = {
  'dream-pop': { bands: { low: ['pad', 'arp8'], mid: ['arp8ud', 'arp8'], high: ['arp16', 'arp8ud'] } },
  'indie-pop': { bands: { low: ['arp8', 'pad'], mid: ['folk', 'strum8ud'], high: ['strum8ud', 'folk', 'strum8'] } },
  'electro-pop': { bands: { low: ['pad'], mid: ['skank', 'chop'], high: ['skank', 'strum8'] } },
  'alt-rock': { led: true, lift: true, bands: { low: ['pm8', 'pad'], mid: ['pm8', 'gallop'], high: ['gallop', 'strum8'] } },
  'indie-rock': { led: true, lift: true, bands: { low: ['arp8', 'pm8'], mid: ['strum8ud', 'pm8'], high: ['strum8', 'strum8ud'] } },
  'post-punk': { led: true, bands: { low: ['skank'], mid: ['skank', 'chop'], high: ['skank', 'sync'] } },
  synthwave: { bands: { low: ['pad'], mid: ['pm8'], high: ['strum8', 'pm8'] } },
  darkwave: { bands: { low: ['pad'], mid: ['arp8'], high: ['arp8ud', 'arp8'] } },
  'alternative-pop': { bands: { low: ['pad'], mid: ['arp8'], high: ['folk', 'arp8ud'] } },
  'pop-rock': { led: true, bands: { low: ['arp8', 'pad'], mid: ['strum8', 'folk'], high: ['strum8ud', 'strum8', 'sync'] } },
  akustik: { off: -0.05, bands: { low: ['travis', 'arp8'], mid: ['folk', 'travis'], high: ['folk', 'strum8ud'] } },
  balad: { off: -0.05, bands: { low: ['pad'], mid: ['pad2', 'arp8'], high: ['arp8ud', 'pad2'] } },
  synthpop: { bands: { low: ['pad'], mid: ['chop'], high: ['skank', 'chop'] } },
  'dans-elektronik': { bands: { low: ['pad'], mid: ['chop'], high: ['skank', 'chop'] } },
  'trip-hop': { off: -0.05, bands: { low: ['pad', 'arp8'], mid: ['pad2', 'arp8'], high: ['arp8', 'arp8ud', 'sync'] } },
  vals: { meter: '3/4', bands: { low: ['pad'], mid: ['waltzbass', 'arp8'], high: ['waltz', 'waltzbass'] } },
  'balad-68': { meter: '6/8', bands: { low: ['pad'], mid: ['arp8', 'dotted'], high: ['six8', 'dotted'] } },
};
const SPARSE = { low: ['pad'], mid: ['pad2', 'chop'], high: ['sync', 'stab', 'chop'] };
const METER_FEEL = { '3/4': 'vals', '6/8': 'balad-68' };
const TONES = ['clean', 'crunch', 'drive'];
const ENERGY = { intro: 0.25, verse: 0.4, prechorus: 0.6, chorus: 0.825, postchorus: 0.7, bridge: 0.3, outro: 0.25, instrumental: 0.5, other: 0.5 };

function feelOf(proj, meter) {
  if (meter !== '4/4') return METER_FEEL[meter] || null;
  const id = proj.pack && proj.pack.id;
  if (id && FEELS[id] && !FEELS[id].meter) return id;
  const tone = proj.guitar && proj.guitar.parts && proj.guitar.parts._all && proj.guitar.parts._all.tone;
  return tone === 'clean' ? 'indie-pop' : 'pop-rock'; // paketsiz: kayıt tonuna göre pop çizgisi
}
const bandOf = (e) => (e < 0.34 ? 'low' : e < 0.7 ? 'mid' : 'high');

// davul loop'unun bir şeridi → 16'lık adım listesi
function laneSteps(L, lane, barQ, n) {
  const str = L && L[lane];
  if (!str) return null;
  const out = [], per = barQ / str.length;
  for (let j = 0; j < str.length; j++) {
    if (str[j] !== 'x' && str[j] !== 'X') continue;
    const s = Math.round((j * per) / STEP_Q);
    if (s >= 0 && s < n && !out.includes(s)) out.push(s);
  }
  return out;
}
// aday rol ile davulun uyumu (bas groove'uyla aynı fikir): lock → kick'leri kapsar, dodge → kick'ten kaçınır
function fit(role, hits, K, index) {
  const bonus = -0.15 * index;
  if (role.fit === 'free') return 1 + bonus; // arpej / halka: tür sırasına göre; yalnızca iyi oturan kilitli rol bunu geçer
  if (!K || !K.length || !hits.length) return bonus;
  const hit = hits.filter((s) => K.includes(s)).length;
  if (role.fit === 'dodge') return 3 * (1 - hit / hits.length) * Math.min(1, (K.length - 1) / 3) + bonus;
  if (role.fit === 'lock') return 3 * (hit / K.length) - (hits.length - hit) / hits.length + bonus;
  return bonus;
}

// ---------------------------------------------------------------- 3) PARTİ TÜRETME
const cache = new Map();
const clone = (v) => JSON.parse(JSON.stringify(v));
function derive(proj, d, slot, part, o = {}) {
  if (!part || part.groove !== true || !d || !d.g) return part;
  const g = d.g, meter = g.meter, table = ROLE_TABLE[meter];
  const feelId = feelOf(proj, meter), feel = feelId && FEELS[feelId];
  if (!table || !feel) return part;
  const n = Math.round(g.barQ / STEP_Q), bar = Math.floor(slot.q0 / g.barQ + 1e-6) + 1;
  const sec = d.sections.find((s) => bar >= s.startBar && bar <= s.endBar) || null;
  const type = (sec && sec.typeNorm) || 'other';
  const band = bandOf(clamp((ENERGY[type] ?? 0.5) + (feel.off || 0), 0, 1));
  const layers = sec ? C.effectiveLayers(proj, d, sec.id) : { piano: false, guitar: true, bass: false, drums: false };
  const L = layers.drums && C.drumLoopForBar ? C.drumLoopForBar(proj, d, bar) : null;
  const K = laneSteps(L, 'K', g.barQ, n), S = laneSteps(L, 'S', g.barQ, n);
  // diğer akor çalgısı (piyano / synth): arpej ve shuffle meşguldür, blok akor sakindir
  const pianoStyle = (sec && (proj.sections || []).find((s) => s.id === (C.linkedRoot ? C.linkedRoot(proj, d, sec.id) : sec.id))?.arr?.piano) || (proj.piano && proj.piano.style) || 'piano-chord';
  const pianoKind = pianoStyle === 'off' ? null : (C.PIANO_STYLES[pianoStyle] || C.PIANO_STYLES['piano-chord']).pattern;
  const pianoOn = !!layers.piano && !!pianoKind, pianoBusy = pianoOn && pianoKind !== 'chord';
  let names = feel.bands[band].filter((r) => table[r]);
  const base = names;
  if (pianoBusy && !feel.led) names = names.filter((r) => !table[r].busy);
  else if (pianoOn && pianoKind === 'chord') names = names.filter((r) => !table[r].sust || band === 'low');
  if (!names.length) names = base.filter((r) => !table[r].busy);
  if (!names.length) names = SPARSE[band].filter((r) => table[r]); // piyano meşgul, türün adayı kalmadı: seyrek ama sönük olmayan roller
  if (!names.length) names = ['pad'].filter((r) => table[r]);
  const ctx = { n, K, S };
  const cands = names.map((name, index) => {
    const role = table[name], steps = role.steps(ctx), hits = steps.map((c, i) => (c === '-' ? -1 : i)).filter((i) => i >= 0);
    return { name, role, steps, hits, score: fit(role, hits, K, index) };
  }).sort((a, b) => b.score - a.score);
  const best = cands[(o.variant || 0) % cands.length];
  const role = best.role;
  const steps = best.steps.slice();
  // kick'e vurgu: kilitli rollerde kick adımlarındaki vuruşlar vurgulu (büyük harf); ilk vuruş her zaman
  if (role.fit === 'lock' && K) for (const k of K) if (steps[k] !== '-' && steps[k] !== 'x') steps[k] = steps[k].toUpperCase();
  const pattern = {
    id: `groove:${best.name}`, name: `Groove · ${best.name}`, meter, grid: '16n',
    steps: steps.map((c) => (c === '-' ? { type: 'rest' } : Object.assign({ type: c.toLowerCase() === 'u' ? 'U' : c.toLowerCase() === 'x' ? 'dead' : 'D' }, c === c.toUpperCase() && c !== '-' ? { accent: true } : {}, role.art ? { defaultArticulation: role.art } : {}))),
    compatibleModes: ['strum', 'arpeggio', 'bassChord'],
  };
  if (role.bassSteps) pattern.bassSteps = role.bassSteps;
  // ses şekli: piyano / synth varken üst üç tel, yoksa tam akor; sürüş rolleri bas varken power
  let shape = pianoOn && !feel.led ? 'triad' : 'full';
  if (role.drive) shape = layers.bass || pianoOn ? 'power' : 'full';
  else if (pianoOn && feel.led) shape = band === 'high' ? 'full' : 'triad';
  let tone = part.tone;
  if (feel.lift && band === 'high') tone = TONES[Math.min(TONES.indexOf(part.tone) + 1, 2)] || part.tone;
  const out = clone(part);
  Object.assign(out, {
    mode: role.mode, pattern, stepOverrides: {}, articulation: role.art || 'normal', directionMode: 'alternate', tone,
    humanize: { strumSpreadMs: part.humanize ? part.humanize.strumSpreadMs : 12, velocityJitter: Math.min(0.04, part.humanize ? part.humanize.velocityJitter : 0.04), timingJitterMs: Math.min(1.5, part.humanize ? part.humanize.timingJitterMs : 1.5) },
  });
  if (role.mode === 'arpeggio') out.arpeggio = { direction: role.dir, rate: role.rate };
  out.voicing = Object.assign({}, part.voicing, { shape });
  out.vgroup = JSON.stringify(out.voicing); // aynı sesleme ayarını paylaşan partiler tek el hareketi dizisi olur
  out.grooveInfo = { feel: feelId, band, role: best.name, shape, piano: pianoOn ? pianoKind : null, bass: !!layers.bass, kicks: K };
  const key = JSON.stringify([out.mode, out.pattern, out.arpeggio, out.articulation, out.tone, out.voicing, out.humanize, out.swing, out.fx, out.palmMuteAmount, out.directionMode]);
  if (!cache.has(key)) { if (cache.size > 400) cache.clear(); cache.set(key, out); }
  const hit = cache.get(key);
  return Object.assign(hit, { grooveInfo: out.grooveInfo }); // aynı biçim aynı nesne (arrangement gruplaması kimlik karşılaştırır)
}

Object.assign(C, { GuitarGroove: { ROLES, ROLES_34, ROLES_68, FEELS, METER_FEEL, derive, feelOf, bandOf } });
})(typeof window !== 'undefined' ? window : globalThis);

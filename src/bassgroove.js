// ---------------------------------------------------------------- BAS GROOVE: türe ve şarkıya bağlı, rastgelesiz bas hattı
// DOM'suz; Core.Bass'e eklenir (build'de bass.js'in ardından). Zar yok: bir ölçünün ritmi ve perdeleri şunlardan çıkar:
//   1) türün elle yazılmış desenleri (enerji kovasına göre: low / mid / high),
//   2) o ölçüde çalan davul loop'unun kick konumları (desen kick'e en iyi uyana seçilir, kaçan kick'e vuruş eklenir),
//   3) akor izi (kök, beşli, oktav; akor değişiminde öncül yalnızca cümle sonunda),
//   4) vokal melodisi (çakışan perde → çakışmayan akor sesi).
// Aynı bölümde aynı akor aynı çalınır; çeşitleme yalnızca "zar" (yeniden üret) ve yoğunluk düğmeleriyle gelir.
(function (root) {
const C = root.Core, B = C.Bass;
const { clamp, mod12 } = C;
const STEP_Q = B.STEP_Q;

// ---------------------------------------------------------------- 1) DESENLER (1 karakter = 16'lık adım)
// R kök · 5 beşli · 8 oktav · 3 üçlü · . önceki notayı uzat · _ sus. sus: sürekli (uzun nota) aile — kick'e vuruş eklenmez, öncül almaz.
const BANK = {
  '4/4': {
    whole: { p: 'R...............', sus: true, label: 'uzun nota' },
    halves: { p: 'R.......R.......', sus: true, label: 'yarımlar' },
    halves5: { p: 'R.......5.......', sus: true, label: 'kök, beşli' },
    dotted: { p: 'R.....R.....R...', label: 'noktalı çeyrekler' },
    push: { p: 'R.....R.R.......', label: 'itme (1, 2\'nin ve\'si, 3)' },
    q: { p: 'R...R...R...R...', label: 'çeyrekler' },
    q5: { p: 'R...R...R...5...', label: 'çeyrekler, 4\'te beşli' },
    k13: { p: 'R.......R.R.....', label: 'kick\'le: 1, 3, 3\'ün ve\'si' },
    sync: { p: 'R..R....R..R....', label: 'senkop (1, 1a, 3, 3a)' },
    sync332: { p: 'R..R....R..R..R.', label: '3+3+2 itme' },
    e8: { p: 'R.R.R.R.R.R.R.R.', label: 'sekizlikler' },
    'e8-5': { p: 'R.R.R.R.R.R.5.R.', label: 'sekizlikler, 4\'te beşli' },
    'e8-oct': { p: 'R.8.R.8.R.8.R.8.', label: 'kök-oktav sekizlikler' },
    pp1: { p: 'R..R..R.R..R..5.', label: 'hook (3-3-2)' },
    off: { p: '__R.__R.__R.__R.', label: 'offbeat', dodge: true },
    arp: { p: 'R.5.8.5.R.5.8.5.', label: 'arpej kök-beşli-oktav' },
    s16: { p: 'RR8RRR8RRR8RRR8R', label: '16\'lık koşu', accent: true },
    acid: { p: 'R.RR.R8.R.RR.R8.', label: 'acid', accent: true },
  },
  '3/4': {
    W1: { p: 'R...........', sus: true, label: 'ölçüde bir nota' },
    W13: { p: 'R.......5...', label: '1\'de kök, 3\'te beşli' },
    W123: { p: 'R...R...R...', label: 'her vuruşta' },
    W8: { p: 'R.R.R.R.R.R.', label: 'sekizlikler' },
  },
  '6/8': {
    S1: { p: 'R...........', sus: true, label: 'ölçüde bir nota' },
    Sdot: { p: 'R.....R.....', label: 'noktalı çeyrekler' },
    Sdot5: { p: 'R.....5.....', label: 'kök, beşli' },
    S8: { p: 'R.R.R.R.R.R.', label: 'sekizlikler' },
  },
};
const parsed = new Map();
function parsePattern(meter, name) {
  const key = meter + '|' + name;
  if (parsed.has(key)) return parsed.get(key);
  const def = BANK[meter][name], pat = def.p, on = [];
  for (let s = 0; s < pat.length; s++) {
    const ch = pat[s];
    if (ch === '.' || ch === '_') continue;
    let len = 1; while (pat[s + len] === '.') len++;
    on.push({ step: s, len, ch });
  }
  const out = Object.assign({ name, onsets: on }, def);
  parsed.set(key, out);
  return out;
}

// ---------------------------------------------------------------- 2) TÜRLER: enerji kovasına göre aday desenler (öncelik sırasıyla)
// gate: çalan notaların kapısı (yoksa profil / synth varsayılanı); approach:false → sürekli türlerde öncül yok
const FEELS = {
  'dream-pop': { name: 'Dream pop', bands: { low: ['whole'], mid: ['whole', 'halves'], high: ['halves', 'q'] }, approach: false },
  'indie-pop': { name: 'Indie pop', bands: { low: ['halves'], mid: ['k13', 'sync', 'dotted', 'q'], high: ['e8', 'k13', 'e8-5'] } },
  'electro-pop': { name: 'Electro-pop', bands: { low: ['halves'], mid: ['push', 'sync', 'off'], high: ['off', 'e8-oct', 'k13'] }, gate: 0.75 },
  'alt-rock': { name: 'Alt rock', bands: { low: ['halves'], mid: ['k13', 'e8'], high: ['e8', 'e8-5', 'sync332'] }, gate: 0.9 },
  'indie-rock': { name: 'Indie rock', bands: { low: ['halves'], mid: ['q', 'e8'], high: ['e8-5', 'e8', 'pp1'] } },
  'post-punk': { name: 'Post-punk', bands: { low: ['q'], mid: ['e8', 'pp1'], high: ['e8-oct', 'pp1', 'e8-5'] }, gate: 0.85 },
  synthwave: { name: 'Synthwave', bands: { low: ['q'], mid: ['e8', 'e8-oct'], high: ['e8-oct', 'arp', 's16'] }, gate: 0.6 },
  darkwave: { name: 'Darkwave', bands: { low: ['whole', 'halves'], mid: ['e8', 'halves'], high: ['e8', 's16'] }, gate: 0.65 },
  'alternative-pop': { name: 'Alternative pop', bands: { low: ['whole', 'halves'], mid: ['k13', 'halves', 'dotted'], high: ['dotted', 'push', 'sync'] } },
  'pop-rock': { name: 'Pop rock', bands: { low: ['halves'], mid: ['k13', 'sync', 'e8'], high: ['e8', 'sync332', 'e8-5'] } },
  akustik: { name: 'Akustik', bands: { low: ['whole'], mid: ['halves', 'halves5'], high: ['q', 'halves5'] }, approach: false },
  balad: { name: 'Balad', bands: { low: ['whole'], mid: ['halves'], high: ['halves', 'dotted'] }, approach: false },
  synthpop: { name: 'Synthpop', bands: { low: ['q'], mid: ['off', 'e8'], high: ['off', 'e8-oct', 'arp'] }, gate: 0.7 },
  'trip-hop': { name: 'Trip hop', bands: { low: ['whole', 'halves'], mid: ['dotted', 'push', 'halves'], high: ['push', 'dotted', 'sync'] }, gate: 0.97 },
  'dans-elektronik': { name: 'Dans / Elektronik', bands: { low: ['q'], mid: ['off', 'arp'], high: ['s16', 'acid', 'off'] }, gate: 0.6 },
  vals: { name: 'Vals', meter: '3/4', bands: { low: ['W1'], mid: ['W13', 'W1'], high: ['W123', 'W13'] } },
  'balad-68': { name: '6/8 Balad', meter: '6/8', bands: { low: ['S1'], mid: ['Sdot', 'S1'], high: ['Sdot', 'S8'] } },
};
for (const f of Object.values(FEELS)) f.meter = f.meter || '4/4';
const METER_DEFAULT = { '3/4': 'vals', '6/8': 'balad-68' };
const PROFILE_FEEL = { 'post-punk-drive': 'post-punk', 'darkwave-pulse': 'darkwave', 'synthwave-roll': 'synthwave' };
const BUILTIN_PROFILE = (id) => id == null || B.BUILTIN_PROFILES.some((p) => p.id === id);

// Grup motoru bu iz için geçerli mi? (2/4 gibi deseni olmayan ölçüler, öğrenilmiş profiller ve karışımlar eski motorda kalır)
function active(track, ctx) {
  return track.engine !== 'legacy' && !!BANK[ctx.meter] && !track.styleMix && BUILTIN_PROFILE(track.styleProfileId);
}
function feelFor(track, ctx) {
  if (ctx.meter !== '4/4') { const id = METER_DEFAULT[ctx.meter]; return { id, def: FEELS[id] }; }
  let id = track.feelId && FEELS[track.feelId] && FEELS[track.feelId].meter === '4/4' ? track.feelId : null;
  if (!id && track.styleProfileId && PROFILE_FEEL[track.styleProfileId]) id = PROFILE_FEEL[track.styleProfileId];
  if (!id && ctx.proj && ctx.proj.pack && FEELS[ctx.proj.pack.id] && FEELS[ctx.proj.pack.id].meter === '4/4') id = ctx.proj.pack.id;
  if (!id) id = track.instrumentType === 'synth' ? 'synthpop' : 'pop-rock';
  return { id, def: FEELS[id] };
}

// ---------------------------------------------------------------- 3) KOVA VE DESEN SEÇİMİ
const bandOf = (e) => (e < 0.34 ? 'low' : e < 0.7 ? 'mid' : 'high');
const FAMILY_BAND = { drone: 'low', walk: 'mid', drive: 'high', roll: 'high' };
// kovayı bölümün ortalama enerjisi belirler (faz biçimi hariç): bölüm içinde ölçüden ölçüye desen değişmez
function bandFor(secSet, bias) {
  if (secSet.templateFamily && FAMILY_BAND[secSet.templateFamily]) return FAMILY_BAND[secSet.templateFamily];
  const mean = ((secSet.energyStart ?? 0.5) + (secSet.energyEnd ?? 0.5)) / 2;
  return bandOf(clamp(mean + ((secSet.density ?? 0.5) - 0.5) * 0.6 + 0.25 * (bias || 0), 0, 1));
}
// desenin kick'e uyumu: kilitli desenler kick'lerin kaçını kapsadığına, offbeat desenler kick'ten ne kadar kaçındığına bakar
function fit(pat, K, index) {
  const O = pat.onsets.map((o) => o.step), bonus = -0.15 * index;
  if (!K || !K.length) return bonus;
  const hit = O.filter((s) => K.includes(s)).length;
  if (pat.dodge) return 3 * (1 - hit / O.length) * Math.min(1, (K.length - 1) / 3) + bonus;
  if (pat.sus) return 1.5 * hit - 0.3 * (O.length - hit) + bonus;
  return 3 * (hit / K.length) - (O.length - hit) / O.length + bonus;
}
function choosePattern(feel, ctx, band, K, variant, busy) {
  const meter = ctx.meter, names = feel.def.bands[band].filter((n) => BANK[meter][n]);
  let cands = names.map((n, k) => ({ pat: parsePattern(meter, n), index: k }));
  if (busy) { const calm = cands.filter((c) => c.pat.onsets.length <= 8); if (calm.length) cands = calm; }
  const ranked = cands.map((c) => ({ pat: c.pat, score: fit(c.pat, K, c.index) })).sort((a, b) => b.score - a.score);
  // 0: davula en iyi uyan; zar (variant ≥ 1): sıradaki adaylar — hepsi o türün o enerjideki desenleri, kick'e yine vuruş eklenir
  return ranked[((variant % ranked.length) + ranked.length) % ranked.length].pat;
}

// ---------------------------------------------------------------- 4) ÖLÇÜ PLANI
const PR = { R: 'root', 5: 'fifth', 8: 'octave', 3: 'third' };
const clashes = (bassPc, melPc) => { const ic = mod12(bassPc - melPc); return ic === 1 || ic === 11; };
// kick'e vuruş ekle: desende olmayan kick adımları (en çok 3); önceki nota o adımda biter, yeni nota sonraki vuruşa kadar sürer
function withKicks(onsets, K, steps) {
  const out = onsets.map((o) => Object.assign({}, o));
  let added = 0;
  for (const k of K) {
    if (added >= 3 || k <= 0 || k >= steps || out.some((o) => o.step === k)) continue;
    const prev = out.filter((o) => o.step < k).pop();
    if (prev && prev.step + prev.len > k) prev.len = k - prev.step;
    out.push({ step: k, len: 1, ch: 'R', kick: true });
    added++;
  }
  out.sort((a, b) => a.step - b.step);
  out.forEach((o, i) => { if (o.kick) o.len = Math.min(4, (out[i + 1] ? out[i + 1].step : steps) - o.step); });
  return out;
}
function plan(track, ctx, i, o) {
  const { secSet, sec, bar } = o, meter = ctx.meter, steps = ctx.steps;
  const feel = feelFor(track, ctx);
  const band = bandFor(secSet, bar ? bar.densityBias : 0);
  const K = ctx.kicks ? ctx.kicks(i) : null;
  const busy = ctx.melodyCount ? ctx.melodyCount(i) >= 10 : false;
  const pat = choosePattern(feel, ctx, band, K, o.variant || 0, busy);
  let onsets = pat.onsets;
  if (K && K.length && !pat.sus && !pat.dodge && band !== 'low') onsets = withKicks(onsets, K, steps);
  const segs = ctx.segs(i);
  const segAt = (s) => (segs ? segs.find((x) => s >= x.s0 && s < x.s1) || segs[segs.length - 1] : null);
  const nextChord = ctx.firstChord(i + 1), lastChord = segs ? segs[segs.length - 1].chord : null;
  const pos = sec ? (i + 1 - sec.startBar) : 0;
  const phraseEnd = !!sec && (pos % 4 === 3 || i + 1 === sec.endBar);
  const approach = phraseEnd && feel.def.approach !== false && !pat.sus && !secSet.hypnotic && !!nextChord && !!lastChord && !B.sameChord(lastChord, nextChord);
  const isSynth = track.instrumentType === 'synth';
  const lastIdx = onsets.length - 1;
  const slots = [], prs = [];
  onsets.forEach((on, k) => {
    const seg = segAt(on.step), ci = seg ? B.chordInfo(seg.chord) : null;
    const segStart = !!seg && on.step === seg.s0;
    let letter = on.ch;
    // vokal melodisiyle yarım ton çakışan akor dışı olmayan sesler yerine çakışmayan akor sesi
    if (ci && ctx.melodyPc && !segStart && on.step !== 0) {
      const mel = ctx.melodyPc(i * ctx.barQ + on.step * STEP_Q);
      const pcOf = { R: ci.bassPc, 5: ci.fifthPc, 8: ci.bassPc, 3: ci.thirdOk ? ci.thirdPc : ci.fifthPc };
      if (mel != null && clashes(pcOf[letter], mel)) letter = ['R', '5', '8'].find((l) => !clashes(pcOf[l], mel)) || letter;
    }
    const kickHere = !!K && K.includes(on.step);
    const pick = approach && k === lastIdx && on.step >= steps - 4;
    const slot = { step: on.step, len: on.len, sr: pick ? 'pickup' : on.step === 0 ? 'anchor' : kickHere || on.step % 4 === 0 ? 'strong' : 'weak' };
    const gate = pat.sus ? 0.98 : feel.def.gate;
    if (gate != null && isSynth) slot.gate = gate; else if (gate != null && !pat.sus) slot.gate = Math.min(1, gate + 0.05);
    if (pat.sus && !isSynth) slot.gate = 1;
    if (isSynth && pat.accent && on.step % 4 === 0) slot.accent = true;
    slots.push(slot);
    prs.push(pick ? 'approach-d' : PR[letter] || 'root');
  });
  const tpl = { id: `groove:${feel.id}:${pat.name}`, name: `${feel.def.name} · ${pat.label}`, family: band === 'low' ? 'drone' : band === 'mid' ? 'walk' : 'drive', meter, steps, window: [0, 1], suits: ['bass-guitar', 'synth'], slots, groove: true };
  return { tpl, prs, noPickup: !!pat.sus || feel.def.approach === false || !!secSet.hypnotic, band, pattern: pat.name };
}

Object.assign(B, { Groove: { BANK, FEELS, METER_DEFAULT, PROFILE_FEEL, active, feelFor, bandFor, choosePattern, plan, parsePattern } });
})(typeof window !== 'undefined' ? window : globalThis);

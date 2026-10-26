// ---------------------------------------------------------------- GİTAR: voicing motoru (tuning + capo parametreli), ritim → nota olayları, Karplus-Strong sentezi
// DOM'suz; Core'a eklenir (build'de core.js + drums.js + flex.js'in ardından aynı <script id="core"> içine girer).
// Akor / BPM / ölçü / bölüm yapısı yeniden yazılmaz, olduğu gibi okunur: her akor için {q0, q1 (çeyrek), chord:{root,q,bass?}, section}.
(function (root) {
const C = root.Core;
const { clamp, mod12, midiToHz, CHORD_Q, pcName } = C;

// ---------------------------------------------------------------- 1) VOICING
// Tel sırası: 0 = en kalın (6. tel) … 5 = en ince. Perde numaraları capo'dan sayılır; boş tel = tuning[i] + capo.
const TUNINGS = {
  standard: [40, 45, 50, 55, 59, 64], // E A D G B E
  dropD: [38, 45, 50, 55, 59, 64],
  dadgad: [38, 45, 50, 55, 57, 62],
};
const MAX_FRET = 15, SPAN = 3; // bir akorda basılan perdeler en fazla 4 perde aralığında
// Tanınmayan akor türü → en yakın temel akor (tek yer; yeni tür eklenince burası genişletilir).
// Uzantılı türler (maj7, 7, add9…) majöre, m7 gibi minöre iner; dim ve aug kendi üçlüsünü korur.
const GUITAR_FALLBACK = {
  '': '', 'maj7': '', '7': '', 'add9': '', '6': '', '9': '', 'maj9': '', '11': '', '13': '', 'maj13': '', '69': '', '7b9': '', '7#9': '', '7#11': '', '7b5': '',
  'm': 'm', 'm7': 'm', 'm6': 'm', 'm9': 'm', 'm11': 'm', 'm13': 'm', 'madd9': 'm', 'mMaj7': 'm', 'm69': 'm',
  'dim': 'dim', 'dim7': 'dim', 'm7b5': 'dim',
  'aug': 'aug', 'aug7': 'aug', '+7': 'aug', '7#5': 'aug', 'maj7#5': 'aug',
  'sus2': 'sus2', 'sus4': 'sus4', '7sus4': 'sus4', '9sus4': 'sus4', '7sus2': 'sus2',
  '5': '5',
};
const warned = new Set();
function warnOnce(msg) { if (!warned.has(msg)) { warned.add(msg); if (typeof console !== 'undefined') console.warn('[gitar] ' + msg); } }
function guitarBaseQuality(q) {
  if (Object.prototype.hasOwnProperty.call(GUITAR_FALLBACK, q)) return GUITAR_FALLBACK[q];
  const s = String(q || '');
  if (/^(dim|°|o)/.test(s) || /(m7b5|ø)/.test(s)) return 'dim';
  if (/(aug|\+)/.test(s)) return 'aug';
  if (/sus2/.test(s)) return 'sus2';
  if (/sus/.test(s)) return 'sus4';
  if (/^(m|min|-)(?!aj)/.test(s)) return 'm';
  return '';
}
// Voicing motorunun tanıdığı tür: akor motorunun CHORD_Q tablosu. Tanınmayan tür için sessiz kalma / hata verme: düş ve uyar.
function resolveQuality(q) {
  if (CHORD_Q[q]) return q;
  const b = guitarBaseQuality(q);
  warnOnce(`"${q}" akor türü voicing motorunda tanımlı değil; "${b || 'majör'}" akoruna düşüldü.`);
  return b;
}

// Akor sesleri: [{iv, role, req}] — role: root third fifth ext ninth
function toneSpec(chord, shape, color) {
  const q = resolveQuality(chord.q);
  const iv = CHORD_Q[q];
  const tones = [];
  if (q === '5') {
    tones.push({ iv: 0, role: 'root', req: true }, { iv: 7, role: 'fifth', req: true });
  } else {
    iv.forEach((x, i) => tones.push({ iv: x, role: i === 0 ? 'root' : i === 1 ? 'third' : i === 2 ? 'fifth' : i === 3 && x !== 2 ? 'ext' : 'ninth', req: true }));
    const f = tones.find((t) => t.role === 'fifth');
    if (f && f.iv === 7) f.req = false; // yalnızca doğal beşli atlanabilir; bozuk beşli (b5, #5) akorun kimliği
  }
  const hasThird = tones.some((t) => t.role === 'third'), isSus = q === 'sus2' || q === 'sus4';
  const hasNinth = tones.some((t) => t.role === 'ninth');
  // renk: üçlüyü sus2/sus4 ile değiştirir ya da add9 ekler; akor zaten sus ya da add (9) ise ya da üçlüsü yoksa dokunulmaz
  const COLORABLE = ['', 'm', '7', 'maj7', 'm7', '6', 'm6', 'mMaj7', '9', 'm9', 'maj9', 'add9', 'madd9'];
  if (color && color !== 'none' && hasThird && !isSus && COLORABLE.includes(q)) {
    const th = tones.find((t) => t.role === 'third');
    if (color === 'sus2') { th.iv = 2; th.role = 'third'; } else if (color === 'sus4') { th.iv = 5; th.role = 'third'; } else if (color === 'add9' && !hasNinth) tones.push({ iv: 2, role: 'ninth', req: true });
  }
  if (shape === 'power') {
    const f = tones.find((t) => t.role === 'fifth');
    return { q, tones: [{ iv: 0, role: 'root', req: true }, { iv: f ? f.iv : 7, role: 'fifth', req: true }] };
  }
  if (shape === 'triad') {
    // üst 3 tel: akorun kimliğini taşıyan üç ses (kök, üçlü/sus, beşli); 7'li ve 9'lu seslerden vazgeçilir. add9'da beşli yerine 9.
    const t3 = tones.filter((t) => t.role === 'root' || t.role === 'third' || t.role === 'fifth');
    const nin = tones.find((t) => t.role === 'ninth' && (color === 'add9' || q === 'add9' || q === 'madd9'));
    if (nin) { const i = t3.findIndex((t) => t.role === 'fifth'); if (i >= 0) t3.splice(i, 1); t3.push(nin); }
    return { q, tones: t3.map((t) => Object.assign({}, t, { req: true })) };
  }
  return { q, tones };
}

// ---- boş tel olarak tonik (drone)
function guitarDrone(tonicPc, tuning = 'standard', capo = 0) {
  const open = (TUNINGS[tuning] || TUNINGS.standard).map((m) => m + capo);
  const names = open.map((m) => pcName(m));
  if (tonicPc == null) return { ok: false, reason: 'Bölümün tonu belirlenmedi; drone için tonik gerekli.' };
  const idx = open.map((m, i) => (mod12(m) === mod12(tonicPc) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { ok: false, reason: `Tonik ${pcName(tonicPc)}, bu akortta (${names.join(' ')}${capo ? `, capo ${capo}` : ''}) boş tel olarak bulunamıyor.` };
  const s = idx.find((i) => i <= 2); // altında akor çalacak en az 3 tel kalsın
  if (s == null) return { ok: false, reason: `Tonik ${pcName(tonicPc)} yalnızca ${names[idx[0]]} (${6 - idx[0]}. tel) telinde bulunuyor; drone'un üstünde akor çalacak yeterli tel kalmıyor.` };
  return { ok: true, string: s, midi: open[s] };
}

// ---- tek akor için aday seslendirmeler
function enumerateVoicings(spec, shape, vo, bassPc, droneStr) {
  const open = (TUNINGS[vo.tuning] || TUNINGS.standard).map((m) => m + (vo.capo || 0));
  const pcs = new Set(spec.tones.map((t) => mod12(spec.root + t.iv)));
  const reqPcs = spec.tones.filter((t) => t.req).map((t) => mod12(spec.root + t.iv));
  const optFifth = spec.tones.find((t) => t.role === 'fifth' && !t.req);
  const rootPc = mod12(spec.root);
  const wantBass = shape === 'triad' ? null : bassPc ?? rootPc;
  const position = vo.position || 'auto';
  const minStr = droneStr != null ? droneStr + 1 : 0;
  // tel aralıkları
  const ranges = [];
  if (shape === 'triad') ranges.push([3, 5]);
  else if (shape === 'power') { for (let lo = minStr; lo <= 2; lo++) for (const n of [2, 3]) if (lo + n - 1 <= 5) ranges.push([lo, lo + n - 1]); }
  else for (let lo = minStr; lo <= 2; lo++) for (const hi of [4, 5]) if (hi - lo + 1 >= Math.min(4, 6 - minStr)) ranges.push([lo, hi]);
  const out = new Map();
  const noOpen = position === 'barre';
  for (const [lo, hi] of ranges) {
    const fretsFor = [];
    for (let s = lo; s <= hi; s++) {
      const l = [];
      for (let f = 0; f <= MAX_FRET; f++) { if (f === 0 && noOpen) continue; if (pcs.has(mod12(open[s] + f))) l.push(f); }
      fretsFor.push(l);
    }
    const cur = new Array(hi - lo + 1);
    const rec = (k, mn, mx) => {
      if (k === cur.length) {
        const got = new Set(cur.map((f, i) => mod12(open[lo + i] + f)));
        if (!reqPcs.every((p) => got.has(p))) return;
        if (shape === 'power') { // kök, beşli (, oktav): sırayla
          const seq = cur.map((f, i) => mod12(open[lo + i] + f));
          const fifthPc = mod12(spec.root + spec.tones[1].iv);
          if (seq[0] !== rootPc || seq[1] !== fifthPc || (seq.length > 2 && seq[2] !== rootPc)) return;
        }
        out.set(`${lo}:${cur.join(',')}`, { lo, hi, frets: cur.slice() });
        return;
      }
      for (const f of fretsFor[k]) {
        let a = mn, b = mx;
        if (f > 0) { a = Math.min(a, f); b = Math.max(b, f); if (b - a > SPAN) continue; }
        cur[k] = f;
        rec(k + 1, a, b);
      }
    };
    rec(0, 99, -1);
  }
  const res = [];
  for (const c of out.values()) {
    const frets = new Array(6).fill(null), midi = new Array(6).fill(null);
    for (let i = 0; i < c.frets.length; i++) { frets[c.lo + i] = c.frets[i]; midi[c.lo + i] = open[c.lo + i] + c.frets[i]; }
    const fretted = c.frets.filter((f) => f > 0), opens = c.frets.length - fretted.length;
    const mnF = fretted.length ? Math.min(...fretted) : 0, mxF = fretted.length ? Math.max(...fretted) : 0;
    // parmak sayısı: en alçak basılan perdede 2+ tel = tek parmakla çapraz (barre)
    const atMin = fretted.filter((f) => f === mnF).length;
    const barre = atMin >= 2;
    const fingers = fretted.length - (barre ? atMin - 1 : 0);
    if (fingers > 4) continue;
    if (opens > 0 && mxF > 4) continue; // boş tel çınlarken el ilk konumun dışında olamaz
    const lowest = midi[c.lo];
    let cost = 0;
    if (wantBass != null && mod12(lowest) !== mod12(wantBass)) cost += bassPc != null && bassPc !== rootPc ? 14 : 12; // kök (ya da eğik çizgili akorun) bası
    if (shape === 'triad' && mod12(lowest) !== rootPc) cost += 0.6;
    const got = new Set(c.frets.map((f, i) => mod12(open[c.lo + i] + f)));
    if (optFifth && !got.has(mod12(spec.root + optFifth.iv))) cost += 0.7;
    const n = c.frets.length;
    if (shape === 'full') cost += (6 - minStr - n) * 0.5 + (c.hi === 4 ? 0.5 : 0);
    cost += (mxF - mnF) * 0.35;
    if (position === 'open') cost += -0.9 * opens + 0.3 * mxF + (opens === 0 ? 1.5 : 0);
    else if (position === 'barre') cost += 0.15 * mnF + (barre ? 0 : 3);
    else cost += -0.35 * opens + 0.12 * mxF;
    if (mxF > 12) cost += 0.3 * (mxF - 12);
    res.push({ frets, midi, lo: c.lo, hi: c.hi, cost, centroid: fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0, minF: mnF, barre, fingers, opens });
  }
  res.sort((a, b) => a.cost - b.cost || a.lo - b.lo);
  return res.slice(0, 12);
}
const candCache = new Map();
function voicingCandidates(chord, vo, droneStr) {
  const asked = vo.shape || 'full';
  const shape = asked === 'full' && resolveQuality(chord.q) === '5' ? 'power' : asked; // power chord'un "tam" hali de kök + beşli (+ oktav)
  const key = [chord.q, chord.root, chord.bass ?? '', shape, vo.color || 'none', vo.position || 'auto', vo.tuning || 'standard', vo.capo || 0, droneStr ?? ''].join('|');
  if (candCache.has(key)) return candCache.get(key);
  const rootPc = mod12(chord.root);
  const bassPc = chord.bass != null && mod12(chord.bass) !== rootPc ? mod12(chord.bass) : null;
  const name = pcName(chord.root) + chord.q;
  // denemeler: istenen → rengi bırak → temel akor → kök + beşli. Hiçbiri sessiz kalmaz; düşüş konsola yazılır.
  const base = guitarBaseQuality(chord.q);
  const tries = [
    { spec: toneSpec(chord, shape, vo.color), shp: shape, note: null },
    ...(vo.color && vo.color !== 'none' ? [{ spec: toneSpec(chord, shape, 'none'), shp: shape, note: `${vo.color} rengi uygulanamadı` }] : []),
    ...(base !== chord.q ? [{ spec: toneSpec({ root: chord.root, q: base }, shape === 'power' ? 'power' : shape, 'none'), shp: shape, note: `"${base || 'majör'}" akoruna düşüldü` }] : []),
    { spec: { q: '5', tones: [{ iv: 0, role: 'root', req: true }, { iv: 7, role: 'fifth', req: true }] }, shp: 'power', note: 'kök + beşliye düşüldü' },
  ];
  let c = [], fb = null;
  for (const t of tries) {
    t.spec.root = rootPc;
    c = enumerateVoicings(t.spec, t.shp, vo, t.shp === 'power' ? null : bassPc, droneStr);
    if (c.length) { fb = t.note; break; }
  }
  if (fb) warnOnce(`${name}: ${shape} voicing tam olarak çalınamıyor (${fb}).`);
  c.forEach((x) => { x.shape = shape; x.fallback = fb; });
  candCache.set(key, c);
  return c;
}
// iki seslendirme arasındaki el hareketi: aynı tel + aynı perde ortak parmak sayılır, konum kayması pahalıdır
function moveCost(a, b) {
  let m = 0;
  for (let s = 0; s < 6; s++) {
    const fa = a.frets[s], fb = b.frets[s];
    if (fa == null && fb == null) continue;
    if (fa == null || fb == null) { m += 0.3; continue; }
    if (fa === fb) { if (fa > 0) m -= 0.6; continue; }
    m += fa > 0 && fb > 0 ? 0.4 * Math.abs(fa - fb) : 0.5 + 0.2 * Math.max(fa, fb);
  }
  const shift = Math.abs(a.centroid - b.centroid);
  return m + 0.35 * shift + (shift > 4 ? 1.5 : 0);
}
// items: [{chord:{root,q,bass?}, tonic?}] zaman sırasıyla (aynı bölüm / aynı Voicing ayarı); vo: Voicing.
// Dönüş: her akor için {strings:[midi|null ×6], frets, lo, hi, notes, shape, drone:{string,midi}|null, droneInfo, cost}
function guitarVoicings(items, vo = {}) {
  const v = Object.assign({ position: 'auto', shape: 'full', color: 'none', drone: false, capo: 0, tuning: 'standard' }, vo);
  const info = items.map((it) => (v.drone ? guitarDrone(it.tonic, v.tuning, v.capo) : null));
  const cands = items.map((it, i) => voicingCandidates(it.chord, v, info[i] && info[i].ok ? info[i].string : null));
  // Viterbi: birim maliyet + el hareketi
  const n = items.length, best = [], from = [];
  for (let i = 0; i < n; i++) {
    best[i] = []; from[i] = [];
    cands[i].forEach((c, j) => {
      if (i === 0) { best[i][j] = c.cost; from[i][j] = -1; return; }
      let b = Infinity, bk = 0;
      cands[i - 1].forEach((p, k) => { const x = best[i - 1][k] + moveCost(p, c); if (x < b) { b = x; bk = k; } });
      best[i][j] = b + c.cost; from[i][j] = bk;
    });
  }
  const pick = new Array(n);
  if (n) {
    let j = best[n - 1].indexOf(Math.min(...best[n - 1]));
    for (let i = n - 1; i >= 0; i--) { pick[i] = j; j = from[i][j]; }
  }
  return items.map((it, i) => {
    const c = cands[i][pick[i]];
    const d = info[i] && info[i].ok ? { string: info[i].string, midi: info[i].midi } : null;
    return Object.assign({}, c, { chord: it.chord, drone: d, droneInfo: info[i], notes: c.midi.filter((m) => m != null) });
  });
}


// ---------------------------------------------------------------- 2) PARTİ MODELİ + RİTİM KALIPLARI
const GRID_Q = { '4n': 1, '8n': 0.5, '16n': 0.25 };   // adım uzunluğu (çeyrek)
const RATE_Q = { '8n': 0.5, '16n': 0.25, '8t': 1 / 3 }; // arpej hızı (çeyrek)
const GUITAR_MODES = ['strum', 'arpeggio', 'bassChord', 'tremolo'];
const ALL3 = ['strum', 'arpeggio', 'bassChord'];
// Adım yazımı: D aşağı · U yukarı · x ölü vuruş · - es; başına ">" = vurgu
function mkPattern(id, name, meter, grid, spec, compatibleModes, extra = {}) {
  const steps = spec.trim().split(/\s+/).map((tok) => {
    const acc = tok[0] === '>', t = acc ? tok.slice(1) : tok;
    const type = { D: 'D', U: 'U', x: 'dead', '-': 'rest' }[t];
    if (!type) throw new Error('gitar kalıbı: adım anlaşılmadı ' + tok);
    const st = { type };
    if (acc) st.accent = true;
    if (extra.art && type !== 'rest') st.defaultArticulation = extra.art;
    return st;
  });
  const barQ = C.METERS[meter].barQ;
  if (steps.length !== Math.round(barQ / GRID_Q[grid])) throw new Error(`gitar kalıbı ${id}: ${steps.length} adım, ${meter} ${grid} için ${Math.round(barQ / GRID_Q[grid])} gerekir`);
  const p = { id, name, meter, grid, steps, compatibleModes };
  if (extra.bassSteps) p.bassSteps = extra.bassSteps;
  return p;
}
const GUITAR_PATTERNS = [
  mkPattern('plain8', "Düz 8'likler", '4/4', '8n', 'D D D D D D D D', ALL3),
  mkPattern('long', 'Uzun akor', '4/4', '4n', 'D - - -', ['strum'], { art: 'letRing' }),
  mkPattern('folk', 'Folk / pop', '4/4', '8n', 'D - D U - U D U', ALL3),
  mkPattern('skank', 'Offbeat / skank', '4/4', '8n', '- D - D - D - D', ['strum'], { art: 'staccato' }),
  mkPattern('funk16', "16'lık funk", '4/4', '16n', 'D x U x D x U x D x U x D x U x', ['strum']),
  mkPattern('gallop', 'Gallop', '4/4', '16n', 'D - D D D - D D D - D D D - D D', ['strum']),
  mkPattern('dotted', "Noktalı 8'lik vurgu", '4/4', '16n', 'D - - D - - D - D - - D - - D -', ['strum']),
  mkPattern('bossa', 'Bossa / senkop', '4/4', '8n', '>D - - D - - D -', ['strum', 'bassChord']),
  mkPattern('waltz', 'Vals', '3/4', '4n', '>D D D', ALL3, { bassSteps: [0] }),
  mkPattern('six8', '6/8', '6/8', '8n', 'D - D U D U', ALL3, { bassSteps: [0, 3] }),
  // 2/4 (uygulamada var; spec'in kalıp tablosunda yok): iki yalın kalıp
  mkPattern('plain8-24', "Düz 8'likler (2/4)", '2/4', '8n', 'D D D D', ALL3),
  mkPattern('long-24', 'Uzun akor (2/4)', '2/4', '4n', 'D -', ['strum'], { art: 'letRing' }),
];
const patternById = (id) => GUITAR_PATTERNS.find((p) => p.id === id) || null;
const clonePattern = (p) => JSON.parse(JSON.stringify(p));
// Kalıplar uygulamadaki ölçüye göre filtrelenir; arpejde yalnızca arpeje uyumlu olanlar gösterilir
function guitarPatternsFor(meter, mode = 'strum') {
  const m = mode === 'tremolo' ? 'strum' : mode;
  return GUITAR_PATTERNS.filter((p) => p.meter === meter && p.compatibleModes.includes(m));
}
function defaultGuitarPart(meter = '4/4') {
  const pat = guitarPatternsFor(meter, 'strum')[0] || GUITAR_PATTERNS[0];
  return {
    mode: 'strum',
    arpeggio: { direction: 'up', rate: '8n' },
    pattern: clonePattern(pat),
    directionMode: 'alternate',
    voicing: { position: 'auto', shape: 'full', color: 'none', drone: false, capo: 0, tuning: 'standard' },
    articulation: 'normal',
    palmMuteAmount: 0.7,
    stepOverrides: {},
    tone: 'clean',
    fx: { chorus: 0, delay: { mix: 0, time: '8n', feedback: 0.3 }, reverb: 0.15 },
    humanize: { strumSpreadMs: 12, velocityJitter: 0.08, timingJitterMs: 4 },
    swing: 0,
  };
}
function defaultGuitarState(meter = '4/4') { return { instrument: 'piano', parts: { _all: defaultGuitarPart(meter) }, presets: [] }; }
// Ölçü ya da vuruş modu değişince seçili kalıp uymuyorsa ilk uyumlu kalıba geç (özel ızgara adım sayısı uyuyorsa kalır)
function normalizeGuitarPart(part, meter) {
  const p = part.pattern, ok = p && p.meter === meter && (p.id === 'custom' || p.compatibleModes.includes(part.mode === 'tremolo' ? 'strum' : part.mode));
  if (!ok) {
    const nu = guitarPatternsFor(meter, part.mode)[0] || guitarPatternsFor(meter, 'strum')[0] || GUITAR_PATTERNS[0];
    part.pattern = clonePattern(nu); part.stepOverrides = {};
  }
  return part;
}
function normalizeGuitarState(st, meter) {
  st = st || defaultGuitarState(meter);
  st.instrument = ['piano', 'guitar', 'both'].includes(st.instrument) ? st.instrument : 'piano';
  st.parts = st.parts || {};
  if (!st.parts._all) st.parts._all = defaultGuitarPart(meter);
  const base = defaultGuitarPart(meter);
  for (const k of Object.keys(st.parts)) { // eksik alanları varsayılanla tamamla (eski proje dosyaları)
    const p = st.parts[k];
    st.parts[k] = Object.assign({}, base, p, { arpeggio: Object.assign({}, base.arpeggio, p.arpeggio), voicing: Object.assign({}, base.voicing, p.voicing),
      fx: Object.assign({}, base.fx, p.fx, { delay: Object.assign({}, base.fx.delay, p.fx && p.fx.delay) }), humanize: Object.assign({}, base.humanize, p.humanize), stepOverrides: p.stepOverrides || {} });
    normalizeGuitarPart(st.parts[k], meter);
  }
  st.presets = st.presets || [];
  return st;
}
const guitarPartFor = (st, sectionId) => (st.parts[sectionId] || st.parts._all);
// Adıma uygulanan nota süresi: adım ezmesi > global (normal dışındaysa) > kalıbın önerisi > normal
function stepArticulation(part, st, i) {
  const ov = part.stepOverrides && part.stepOverrides[i];
  if (ov && ov.articulation) return ov.articulation;
  if (part.articulation && part.articulation !== 'normal') return part.articulation;
  return (st && st.defaultArticulation) || 'normal';
}
// Bir adıma nota süresi atanır; tek değerli olduğundan letRing ile palmMute aynı adımda birlikte olamaz
const ARTICULATIONS = ['normal', 'letRing', 'staccato', 'palmMute'];
function setStepArticulation(part, i, art) {
  if (!ARTICULATIONS.includes(art)) throw new Error('bilinmeyen nota süresi: ' + art);
  const o = part.stepOverrides[i] = Object.assign({}, part.stepOverrides[i], { articulation: art });
  return o;
}

// ---------------------------------------------------------------- 3) PARTİ → NOTA OLAYLARI
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Akor listesi → gitar akor dilimleri (bölüm tonu dahil)
function guitarSlotsFrom(d) {
  const sec = new Map(d.sections.map((s) => [s.id, s]));
  return d.chords.map((c) => ({ q0: c.q0, q1: c.q1, chord: c.chord, section: c.section, tonic: sec.get(c.section) ? sec.get(c.section).tonic : null }));
}
const stringsFor = (v) => { const a = []; for (let s = 0; s < 6; s++) if (v.midi[s] != null) a.push(s); return a; };
// bas notası: kök ya da beşli; beşli kökün altında (mümkünse) — boom-chick'te kök ↔ beşli
function bassNotes(v, tuning, capo, droneStr) {
  const open = (TUNINGS[tuning] || TUNINGS.standard).map((m) => m + capo);
  const lowPlayable = open[droneStr != null ? droneStr + 1 : 0];
  const bassPc = v.chord.bass != null ? mod12(v.chord.bass) : mod12(v.chord.root);
  const lowest = v.notes[0];
  let rootMidi = lowest != null && mod12(lowest) === bassPc ? lowest : lowPlayable + mod12(bassPc - lowPlayable);
  let fifth = rootMidi - 5 >= lowPlayable ? rootMidi - 5 : rootMidi + 7;
  const strFor = (m) => { // en az perdeli tel (eşitlikte kalın tel); drone teli ve altı kullanılmaz
    let best = null;
    for (let s = droneStr != null ? droneStr + 1 : 0; s < 6; s++) { const f = m - open[s]; if (f >= 0 && f <= MAX_FRET && (best == null || f < best.f)) best = { s, f }; }
    return best ? best.s : 0;
  };
  return [{ midi: rootMidi, str: strFor(rootMidi) }, { midi: fifth, str: strFor(fifth) }];
}
function guitarEvents(slots, g, getPart, opts = {}) {
  const ev = [];
  ev.fxTable = {};
  if (!slots.length) return ev;
  const fxKey = (p) => { const k = JSON.stringify({ tone: p.tone, fx: p.fx }); ev.fxTable[k] = { tone: p.tone, fx: p.fx }; return k; };
  const barQ = g.barQ, spq = g.spq, meter = g.meter;
  const rnd = mulberry32(opts.seed ?? 0x51ed);
  // 1) voicing: aynı partiyi paylaşan akorlar zaman sırasıyla tek dizi (el hareketi minimum)
  const parts = slots.map((sl) => getPart(sl));
  const voic = new Array(slots.length);
  for (const p of new Set(parts)) {
    const idx = slots.map((_, i) => i).filter((i) => parts[i] === p);
    const vs = C.guitarVoicings(idx.map((i) => ({ chord: slots[i].chord, tonic: slots[i].tonic })), p.voicing);
    idx.forEach((i, k) => { voic[i] = vs[k]; });
  }
  const slotAt = (q) => { for (let i = 0; i < slots.length; i++) if (q >= slots[i].q0 - 1e-6 && q < slots[i].q1 - 1e-6) return i; return -1; };
  const hits = []; // adım düzeyinde vuruşlar (süreler ikinci geçişte)
  const first = Math.floor(slots[0].q0 / barQ + 1e-6), last = Math.ceil(slots[slots.length - 1].q1 / barQ - 1e-6);
  const bassCount = new Map(); // dilim → o dilimde çalınan bas sayısı
  for (let b = first; b < last; b++) {
    const bq = b * barQ, s0 = slotAt(bq + 1e-4);
    if (s0 < 0) continue;
    const part = parts[s0];
    let pat = part.pattern;
    if (!pat || pat.meter !== meter) pat = guitarPatternsFor(meter, part.mode)[0] || GUITAR_PATTERNS[0];
    const patQ = GRID_Q[pat.grid], nP = Math.round(barQ / patQ);
    const stepAt = (i) => pat.steps[i] || { type: 'rest' };
    const sw = clamp(Math.max(clamp(part.swing || 0, 0, 1), C.swingToPart(g.swing || 0)), 0, 1.5); // genel alt bölme (g.swing) parça swing'inin altına inemez
    const swingQ = (i, gq, ok = true) => (ok && sw > 0 && meter !== '6/8' && (gq === 0.5 || gq === 0.25) && i % 2 === 1 ? sw * gq / 3 : 0);
    const push = (h) => { const si = slotAt(h.q + 1e-6); if (si >= 0) { h.slot = si; h.part = parts[si]; hits.push(h); } };
    if (part.mode === 'arpeggio') {
      const rq = RATE_Q[part.arpeggio.rate] || 0.5, nA = Math.round(barQ / rq);
      for (let k = 0; k < nA; k++) {
        const q0 = bq + k * rq, pi = Math.min(nP - 1, Math.floor((k * rq) / patQ + 1e-6)), st = stepAt(pi);
        if (st.type !== 'D' && st.type !== 'U') continue; // es ve ölü vuruş: arpejde çalmaz
        push({ q: q0 + swingQ(k, rq, part.arpeggio.rate !== '8t'), qStep: rq, type: 'arp', accent: !!st.accent, art: stepArticulation(part, st, pi), pi, k, qGrid: q0 });
      }
    } else {
      for (let i = 0; i < nP; i++) {
        const st = stepAt(i);
        if (st.type === 'rest') continue;
        let type = st.type;
        if (part.directionMode === 'allDown' && type === 'U') type = 'D';
        push({ q: bq + i * patQ + swingQ(i, patQ), qStep: patQ, type, accent: !!st.accent, art: stepArticulation(part, st, i), pi: i });
      }
    }
  }
  hits.sort((a, c) => a.q - c.q);
  // 2) vuruşlar → nota olayları
  const slotEndT = (si) => slots[si].q1 * spq;
  const evAdd = (e) => { ev.push(e); return e; };
  const dropToSlot = new Map();
  hits.forEach((h, hi) => {
    const part = h.part, v = voic[h.slot], sl = slots[h.slot];
    const t0 = h.q * spq;
    const stepSec = h.qStep * spq;
    // sonraki vuruş (aynı dilim) → normal süre
    let nextT = slotEndT(h.slot);
    for (let j = hi + 1; j < hits.length; j++) { if (hits[j].slot !== h.slot) break; if (hits[j].q > h.q + 1e-6) { nextT = Math.min(nextT, hits[j].q * spq); break; } }
    const slotEnd = slotEndT(h.slot);
    let dur;
    if (h.art === 'letRing') dur = slotEnd - t0;
    else if (h.art === 'staccato') dur = Math.min(0.4 * stepSec, nextT - t0);
    else if (h.art === 'palmMute') dur = Math.min(nextT - t0, Math.max(0.1, 0.8 * stepSec));
    else dur = h.type === 'arp' ? Math.min(slotEnd - t0, Math.max(stepSec, (Math.max(v.notes.length, 3)) * stepSec)) : nextT - t0;
    dur = Math.max(0.03, dur);
    const base = { kind: 'note', art: h.art, step: h.pi, slot: h.slot, q: h.q, fxk: fxKey(part) };
    const ov = part.stepOverrides && part.stepOverrides[h.pi];
    const orn = ov && ov.ornament;
    const hum = part.humanize || {};
    const jit = () => 1 + (rnd() * 2 - 1) * clamp(hum.velocityJitter || 0, 0, 1);
    const tj = () => ((rnd() * 2 - 1) * (hum.timingJitterMs || 0)) / 1000;
    const tHit = Math.max(0, t0 + tj());
    const spread = clamp(hum.strumSpreadMs ?? 12, 0, 60) / 1000;
    // ölü vuruş
    if (h.type === 'dead') { evAdd({ kind: 'dead', fxk: fxKey(part), t: tHit, dur: 0.04, midi: null, str: null, vel: clamp(0.7 * (h.accent ? 1.25 : 1) * jit(), 0.05, 1), art: 'dead', step: h.pi, slot: h.slot, q: h.q, dir: 'D' }); return; }
    const vArt = (e) => { if (h.art === 'palmMute') e.pm = part.palmMuteAmount ?? 0.7; if (orn === 'slideIn') e.slideIn = 0.06; if (orn === 'slideOut') e.slideOut = 0.06; return e; };
    const vibOk = orn === 'vibrato' && dur >= g.pulseSec;
    const mkNote = (str, midi, t, d, vel, dir, extra) => evAdd(Object.assign(vArt(Object.assign({ t, dur: d, midi, str, vel: clamp(vel * (h.accent ? 1.2 : 1) * jit(), 0.05, 1), dir }, base)), vibOk ? { vib: { rate: 5.5, depth: 25, delay: 0.15 } } : {}, extra || {}));
    const strum = (strs, dir, vel) => {
      const m = strs.length, order = dir === 'U' ? strs.slice().reverse() : strs;
      order.forEach((s, k) => mkNote(s, v.midi[s], tHit + (m > 1 ? (k * spread) / (m - 1) : 0), Math.max(0.03, dur - (m > 1 ? (k * spread) / (m - 1) : 0)), vel, dir));
    };
    const all = stringsFor(v);
    const topN = (n) => all.slice(Math.max(0, all.length - n));
    const upStr = () => topN(all.length > 4 ? 4 : Math.min(3, all.length) || 1);
    if (h.type === 'arp') {
      const dir = part.arpeggio.direction, n = all.length;
      const bn = bassNotes(v, part.voicing.tuning, part.voicing.capo || 0, v.drone ? v.drone.string : null);
      const idx = Math.round((h.qGrid - sl.q0) / h.qStep);
      let pick;
      if (dir === 'travis') {
        const c = ((idx % 4) + 4) % 4;
        if (c === 0) pick = { midi: bn[0].midi, str: bn[0].str };
        else if (c === 2) pick = { midi: bn[1].midi, str: bn[1].str };
        else { const s = c === 1 ? all[n - 1] : all[Math.max(0, n - 2)]; pick = { midi: v.midi[s], str: s }; }
      } else {
        let i;
        if (dir === 'down') i = n - 1 - (((idx % n) + n) % n);
        else if (dir === 'upDown') { const per = Math.max(1, 2 * n - 2), r = ((idx % per) + per) % per; i = r < n ? r : per - r; } else i = ((idx % n) + n) % n;
        const s = all[i]; pick = { midi: v.midi[s], str: s };
      }
      mkNote(pick.str, pick.midi, tHit, dur, 0.8, 'D');
      return;
    }
    if (part.mode === 'bassChord') {
      const pat = part.pattern;
      let isBass;
      const ap = (pat.steps || []).map((x, i) => (x.type === 'D' || x.type === 'U' ? i : -1)).filter((i) => i >= 0);
      if (pat.bassSteps) isBass = pat.bassSteps.includes(h.pi);
      else isBass = ap.indexOf(h.pi) % 2 === 0;
      if (isBass) {
        const bn = bassNotes(v, part.voicing.tuning, part.voicing.capo || 0, v.drone ? v.drone.string : null);
        const c = bassCount.get(h.slot) || 0; bassCount.set(h.slot, c + 1);
        const nt = bn[c % 2];
        mkNote(nt.str, nt.midi, tHit, dur, 0.9, 'D');
      } else {
        const up = all.length > 3 ? all.slice(1) : all; // bas teli (en kalın) boom'a bırakılır
        strum(h.type === 'U' ? upStr() : up, h.type === 'U' ? 'U' : 'D', 0.7);
      }
      return;
    }
    // strum
    const strs = h.type === 'U' ? upStr() : all;
    const velU = h.type === 'U' ? 0.62 : 0.85; // aşağı vuruş yukarıdan biraz güçlü
    if (orn === 'hammerPull' && hammerOk(part, v)) {
      const hp = hammerPlan(v);
      if (hp) {
        const t1 = tHit + 0.45 * Math.min(stepSec, dur);
        strs.forEach((s, k) => {
          const off = strs.length > 1 ? ((h.type === 'U' ? strs.length - 1 - k : k) * spread) / (strs.length - 1) : 0;
          if (s !== hp.str) { mkNote(s, v.midi[s], tHit + off, Math.max(0.03, dur - off), velU, h.type); return; }
          mkNote(s, hp.from, tHit + off, Math.max(0.03, t1 - tHit - off), velU, h.type);
          mkNote(s, hp.to, t1, Math.max(0.03, tHit + dur - t1), 0.55, h.type, { soft: true, orn: hp.kind });
        });
        return;
      }
    }
    strum(strs, h.type, velU);
  });
  // 3) drone: bölümün toniği boş tel olarak her akorun altında, letRing gibi (hiçbir adım susturmaz)
  slots.forEach((sl, i) => {
    const v = voic[i];
    if (v && v.drone) evAdd({ kind: 'note', fxk: fxKey(parts[i]), t: sl.q0 * spq, dur: (sl.q1 - sl.q0) * spq, midi: v.drone.midi, str: v.drone.string, vel: 0.55, dir: 'D', art: 'letRing', drone: true, slot: i, q: sl.q0, step: -1 });
  });
  ev.sort((a, c) => a.t - c.t || (a.str ?? -1) - (c.str ?? -1));
  // 4) tel başına tek ses: aynı tel yeniden çalınınca öncekinin sesi kesilir; ölü vuruş susturulabilir sesleri keser
  const lastOn = new Map();
  const ringing = [];
  for (const e of ev) {
    if (e.kind === 'dead') {
      for (const r of ringing) if (!r.drone && r.art !== 'letRing' && r.t + r.dur > e.t) r.dur = Math.max(0.01, e.t - r.t);
      continue;
    }
    const prev = lastOn.get(e.str);
    if (prev && prev.t + prev.dur > e.t) prev.dur = Math.max(0.01, e.t - prev.t);
    lastOn.set(e.str, e);
    ringing.push(e);
  }
  for (const e of ev) if (e.vib && e.dur < g.pulseSec) delete e.vib; // vibrato yalnızca ≥ 1 vuruş süren notada (kesilen notada düşer)
  return ev;
}
// hammerPull: yalnızca renk seçili olmayan akorlarda ya da sus akorlarında anlamlı
function hammerOk(part, v) {
  const q = resolveQuality(v.chord.q), sus = q === 'sus2' || q === 'sus4';
  return v.shape !== 'power' && (sus || (!part.voicing.color || part.voicing.color === 'none')) && !['5', 'dim', 'aug', 'dim7', 'm7b5'].includes(q);
}
function hammerPlan(v) {
  const q = resolveQuality(v.chord.q), root = mod12(v.chord.root);
  const open = (TUNINGS[v.tuning || 'standard'] || TUNINGS.standard);
  const spec = CHORD_Q[q];
  const find = (iv) => { for (let s = 5; s >= 0; s--) if (v.midi[s] != null && mod12(v.midi[s] - root) === mod12(iv)) return s; return -1; };
  const ok = (m, s) => m >= open[s] - 0 && m - (v.midi[s] - v.frets[s]) >= 0; // boş telin altına inmesin
  if (q === 'sus4') { const s = find(5); return s >= 0 ? { str: s, from: v.midi[s], to: v.midi[s] - 1, kind: 'pull' } : null; }
  if (q === 'sus2') { const s = find(2); return s >= 0 ? { str: s, from: v.midi[s], to: v.midi[s] + 2, kind: 'hammer' } : null; }
  const th = spec[1], s = find(th);
  if (s < 0) return null;
  if (th === 4) { const from = v.midi[s] + 1; return { str: s, from, to: v.midi[s], kind: 'pull' }; } // majör: sus4 → üçlü (pull-off)
  const from = v.midi[s] - 1; // minör: sus2 → üçlü (hammer-on)
  return ok(from, s) ? { str: s, from, to: v.midi[s], kind: 'hammer' } : null;
}


// ---------------------------------------------------------------- 4) SENTEZ: Karplus-Strong + ton / FX (saf JS; çalma ve mix WAV aynı yolu kullanır)
const pluckCache = new Map();
// Bir telin yalın vuruşu (önbellekli, deterministik). Gecikme hattı: tamsayı + 2 kutuplu ortalama (alçak geçiren) + 1. derece tüm geçiren (ince akort).
function ksPluck(midi, sr) {
  const key = sr + '|' + midi;
  if (pluckCache.has(key)) return pluckCache.get(key);
  const f = midiToHz(midi), D = sr / f;
  const L = Math.max(2, Math.floor(D - 1)), frac = D - L - 0.5;
  const a = (1 - frac) / (1 + frac);
  const T60 = clamp(3.4 * Math.pow(110 / f, 0.35), 0.9, 4.5);
  const rho = Math.exp(-6.908 / (T60 * f));
  const len = Math.ceil(Math.min(T60 * 0.9, 4) * sr);
  const rnd = mulberry32(midi * 7919 + 17);
  const w = new Float32Array(L), buf = new Float32Array(L);
  for (let i = 0; i < L; i++) w[i] = rnd() * 2 - 1;
  const pk = Math.max(1, Math.round(0.13 * L)); // pena konumu: tarak süzgeç
  let mean = 0;
  for (let i = 0; i < L; i++) { buf[i] = w[i] - (i >= pk ? w[i - pk] : 0); mean += buf[i]; }
  mean /= L;
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += 0.55 * (buf[i] - mean - lp); buf[i] = lp; }
  let pk0 = 0; for (let i = 0; i < L; i++) pk0 = Math.max(pk0, Math.abs(buf[i]));
  for (let i = 0; i < L; i++) buf[i] *= 0.5 / (pk0 || 1);
  const out = new Float32Array(len);
  let idx = 0, prev = buf[L - 1], z = 0;
  for (let n = 0; n < len; n++) {
    const y = buf[idx];
    out[n] = y;
    const avg = 0.5 * (y + prev); prev = y;
    const ap = a * avg + z; z = avg - a * ap;
    buf[idx] = rho * ap;
    if (++idx === L) idx = 0;
  }
  pluckCache.set(key, out);
  return out;
}
const dbg = { notes: 0 };
// Tek nota: zarf (kesme + sönüm), palm mute (alçak geçiren + kısa decay), kayma / vibrato (zamana bağlı hız)
function mixNote(out, e, sr, gain) {
  const base = ksPluck(e.midi, sr);
  const start = Math.round(e.t * sr);
  const rel = 0.09, durN = Math.round(e.dur * sr), relN = Math.round(rel * sr);
  const total = durN + relN;
  const g = gain * Math.pow(e.vel, 1.4) * 0.5;
  const pm = e.pm != null;
  const tau = pm ? 0.12 - 0.06 * clamp(e.pm, 0, 1) : 0;
  const alpha = pm ? 1 - Math.exp((-2 * Math.PI * (3500 - 2800 * clamp(e.pm, 0, 1))) / sr) : 1;
  const mod = e.slideIn || e.slideOut || e.vib;
  const att = e.soft ? Math.round(0.008 * sr) : 0;
  let lpState = 0, pos = 0;
  for (let i = 0; i < total; i++) {
    const o = start + i;
    if (o < 0) continue;
    if (o >= out.length) break;
    let smp;
    if (mod) {
      const tt = i / sr; let c = 0;
      if (e.slideIn && tt < e.slideIn) c -= 100 * (1 - tt / e.slideIn);
      if (e.slideOut && tt > e.dur - e.slideOut) c -= 100 * clamp((tt - (e.dur - e.slideOut)) / e.slideOut, 0, 1);
      if (e.vib && tt > e.vib.delay) c += e.vib.depth * Math.sin(2 * Math.PI * e.vib.rate * (tt - e.vib.delay));
      pos += Math.pow(2, c / 1200);
      const i0 = Math.floor(pos);
      if (i0 + 1 >= base.length) break;
      smp = base[i0] + (base[i0 + 1] - base[i0]) * (pos - i0);
    } else { if (i >= base.length) break; smp = base[i]; }
    if (pm) { lpState += alpha * (smp - lpState); smp = lpState * Math.exp(-i / sr / tau); }
    let env = i < durN ? 1 : Math.exp((-(i - durN) / relN) * 5);
    if (att && i < att) env *= i / att;
    out[o] += smp * g * env;
  }
}
// Ölü vuruş: 30–50 ms, tonsuz, filtrelenmiş gürültü patlaması
function mixDead(out, e, sr, gain, seed) {
  const start = Math.round(e.t * sr), n = Math.round(0.04 * sr), rnd = mulberry32(seed);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const o = start + i;
    if (o < 0) continue;
    if (o >= out.length) break;
    const x = rnd() * 2 - 1;
    a += 0.45 * (x - a); b += 0.08 * (a - b); // yaklaşık band geçiren (1–3 kHz çevresi)
    out[o] += (a - b) * gain * e.vel * 0.55 * Math.exp(-i / sr / 0.011);
  }
}
const DELAY_Q = { '8n': 0.5, d8n: 0.75, '4n': 1 };
function guitarFx(x, sr, tone, fx, spq) {
  const n = x.length;
  let y = x;
  if (tone === 'crunch' || tone === 'drive') {
    const pre = tone === 'crunch' ? 4 : 14, post = tone === 'crunch' ? 0.3 : 0.13, fc = tone === 'crunch' ? 7000 : 4800; // doygun sinyalin seviyesi temizle aşağı yukarı eşit
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    y = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) { const v = Math.tanh(pre * x[i]) * post; lp += a * (v - lp); y[i] = lp; }
  }
  const ch = clamp(fx.chorus || 0, 0, 1);
  if (ch > 0) {
    const z = new Float32Array(n), d1 = 0.018 * sr, d2 = 0.026 * sr, m1 = 0.004 * sr, m2 = 0.005 * sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const read = (d) => { const p = i - d, i0 = Math.floor(p); if (i0 < 0) return 0; const fr = p - i0; return y[i0] * (1 - fr) + (y[i0 + 1] ?? 0) * fr; };
      const w = 0.5 * (read(d1 + m1 * Math.sin(2 * Math.PI * 0.7 * t)) + read(d2 + m2 * Math.sin(2 * Math.PI * 0.9 * t + 2)));
      z[i] = y[i] * (1 - 0.3 * ch) + w * 0.8 * ch;
    }
    y = z;
  }
  const dm = clamp((fx.delay && fx.delay.mix) || 0, 0, 1);
  if (dm > 0) {
    const D = Math.max(1, Math.round((DELAY_Q[fx.delay.time] || 0.5) * spq * sr)), fb = clamp(fx.delay.feedback ?? 0.3, 0, 0.85);
    const w = new Float32Array(n), z = new Float32Array(n);
    for (let i = 0; i < n; i++) { w[i] = (i >= D ? y[i - D] + fb * w[i - D] : 0); z[i] = y[i] + dm * w[i]; }
    y = z;
  }
  const rv = clamp(fx.reverb || 0, 0, 1);
  if (rv > 0) {
    const k = sr / 44100, combs = [1116, 1188, 1277, 1356].map((d) => ({ d: Math.round(d * k), b: null, i: 0, s: 0 }));
    combs.forEach((c) => { c.b = new Float32Array(c.d); });
    const aps = [556, 441].map((d) => ({ d: Math.round(d * k), b: new Float32Array(Math.round(d * k)), i: 0 }));
    const z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (const c of combs) { const o = c.b[c.i]; c.s += 0.7 * (o - c.s); c.b[c.i] = y[i] * 0.25 + 0.84 * c.s; if (++c.i === c.d) c.i = 0; w += o; }
      for (const a of aps) { const o = a.b[a.i], v = w + 0.5 * o; a.b[a.i] = v; w = o - 0.5 * v; if (++a.i === a.d) a.i = 0; }
      z[i] = y[i] * (1 - 0.25 * rv) + w * 0.45 * rv;
    }
    y = z;
  }
  return y;
}
// events: guitarEvents çıktısı. Ton / FX parti başına (aynı ayarı paylaşan olaylar birlikte işlenir)
function renderGuitar(events, sr, length, spq, gain = 1) {
  const out = new Float32Array(length);
  const groups = new Map();
  for (const e of events) { const k = e.fxk || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  let seed = 4242;
  for (const [k, evs] of groups) {
    const dry = new Float32Array(length);
    for (const e of evs) { if (e.kind === 'dead') mixDead(dry, e, sr, gain, (seed += 31)); else if (e.midi != null) mixNote(dry, e, sr, gain); }
    const cfg = (events.fxTable && events.fxTable[k]) || { tone: 'clean', fx: { chorus: 0, delay: { mix: 0 }, reverb: 0 } };
    const wet = guitarFx(dry, sr, cfg.tone, cfg.fx, spq);
    for (let i = 0; i < length; i++) out[i] += wet[i];
  }
  return out;
}

Object.assign(C, { TUNINGS, GUITAR_FALLBACK, guitarBaseQuality, guitarDrone, guitarVoicings, guitarMoveCost: moveCost, guitarToneSpec: toneSpec,
  GUITAR_PATTERNS, GUITAR_MODES, ARTICULATIONS, guitarPatternsFor, defaultGuitarPart, defaultGuitarState, normalizeGuitarPart, normalizeGuitarState, guitarPartFor, stepArticulation, setStepArticulation,
  guitarSlotsFrom, guitarEvents, patternById, clonePattern, GRID_Q, RATE_Q, ksPluck, renderGuitar, guitarFx });
})(typeof window !== 'undefined' ? window : globalThis);

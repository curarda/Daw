// ---------------------------------------------------------------- DAVUL: ölçü tahmini + basit loop kütüphanesi
// DOM'suz; Core'a eklenir (build'de core.js'in ardından aynı <script id="core"> içine girer).
(function (root) {
const C = root.Core;
const { clamp, makeGrid } = C;

// ---- 1) ÖLÇÜ TAHMİNİ
// Girdi: notalar {t0, t1 (zaman çizelgesi saniyesi), loud? (0–1), pitch? (MIDI)}, BPM (sayılan vuruş).
// Fikir: her notaya bir vurgu ağırlığı ver (uzun, yüksek sesli, perde tepesi olan notalar vurgulu);
// vuruş ızgarasındaki vurgu dizisini 2/3/4/6 vuruşluk kalıplarla karşılaştır; vuruş içi konumlardan
// 8'lik (düz) mü üçleme mi olduğuna bak.
const METER_TEMPLATES = { // ortalaması 0 olan "güçlü / zayıf" kalıplar (vuruş başına)
  2: [1, -1],
  3: [2, -1, -1],
  4: [1.5, -1, 0.5, -1],
  6: [2, -1, -1, 1, -0.5, -0.5],
};
for (const k in METER_TEMPLATES) { // birim varyansa ölçekle: farklı uzunluklar karşılaştırılabilsin
  const t = METER_TEMPLATES[k], sd = Math.sqrt(t.reduce((a, x) => a + x * x, 0) / t.length);
  METER_TEMPLATES[k] = t.map((x) => x / sd);
}
function noteAccents(notes, P) {
  const ws = notes.map((n, i) => {
    const dur = clamp((n.t1 - n.t0) / P, 0.25, 2);
    const ioi = i + 1 < notes.length ? clamp((notes[i + 1].t0 - n.t0) / P, 0.25, 2) : dur;
    let w = 0.5 * dur + 0.5 * ioi; // uzun nota / arkasından uzun boşluk = vurgu
    if (n.loud != null) w *= 0.6 + 0.8 * clamp(n.loud, 0, 1);
    if (n.pitch != null) {
      const a = notes[i - 1], b = notes[i + 1];
      if ((!a || a.pitch == null || n.pitch > a.pitch) && (!b || b.pitch == null || n.pitch >= b.pitch)) w *= 1.15; // perde tepesi
    }
    return w;
  });
  return ws;
}
// en iyi fazla, notaların ızgara noktasına (vuruş/sub) ±%22 adım içinde düşme oranı
function gridFit(ts, P, sub) {
  const step = P / sub, tol = 0.22;
  let best = 0;
  for (let k = 0; k < 24; k++) {
    const ph = (k / 24) * step;
    let c = 0;
    for (const t of ts) { const f = (t - ph) / step; if (Math.abs(f - Math.round(f)) < tol) c++; }
    best = Math.max(best, c / ts.length);
  }
  return best;
}
function estimateMeter(notes, bpm, opts = {}) {
  const out = { ok: false, candidates: [], reasons: [] };
  const ns = notes.filter((n) => n.t1 > n.t0).sort((a, b) => a.t0 - b.t0);
  if (ns.length < 8) { out.reasons.push(`Ölçü tahmini için en az 8 nota gerekir (${ns.length} var).`); return out; }
  const P = 60 / bpm;
  const w = noteAccents(ns, P);
  // vuruş fazı φ: kayıt click'le yapıldıysa ızgara zaten doğru (φ=0); değilse vurgulu notaların ağırlıklı dairesel ortalaması
  let phi = 0;
  if (!opts.fixedPhase) {
    let sx = 0, sy = 0;
    ns.forEach((n, i) => { const a = (2 * Math.PI * n.t0) / P, ww = w[i] * w[i]; sx += ww * Math.cos(a); sy += ww * Math.sin(a); });
    phi = (((Math.atan2(sy, sx) / (2 * Math.PI)) * P) % P + P) % P;
  }
  // vuruş içi konum: düz (½) mi üçleme (⅓, ⅔) mi
  let duple = 0, triple = 0, onBeat = 0;
  for (const n of ns) {
    const f = ((((n.t0 - phi) / P) % 1) + 1) % 1;
    if (f < 0.12 || f > 0.88) onBeat++;
    else if (Math.abs(f - 0.5) < 0.09) duple++;
    else if (Math.abs(f - 1 / 3) < 0.08 || Math.abs(f - 2 / 3) < 0.08) triple++;
  }
  const feel = triple >= 3 && triple > 1.5 * duple ? 'triple' : 'straight';
  // vuruş başına vurgu dizisi (vuruş dışı notalar ağırlığının yarısıyla en yakın vuruşa)
  const k0 = Math.floor((ns[0].t0 - phi) / P - 0.5);
  const nB = Math.ceil((ns[ns.length - 1].t0 - phi) / P) - k0 + 2;
  const A = new Float64Array(nB);
  ns.forEach((n, i) => {
    const x = (n.t0 - phi) / P, k = Math.round(x), f = Math.abs(x - k);
    A[k - k0] += f < 0.15 ? w[i] : 0.35 * w[i];
  });
  const tot = A.reduce((a, b) => a + b, 0) || 1;
  const score = {};
  for (const M of [2, 3, 4]) {
    const T = METER_TEMPLATES[M];
    let best = -Infinity, bp = 0;
    for (let p = 0; p < M; p++) {
      let s = 0;
      for (let j = 0; j < nB; j++) s += A[j] * T[(((j + k0 - p) % M) + M) % M];
      if (s > best) { best = s; bp = p; }
    }
    score[M] = { s: best / tot, p: bp };
  }
  // 6/8 (8'likler vuruş sayılmışsa): 3'lü kalıba ek olarak 1. ve 4. 8'lik farklı olmalı (ölçü = 6 vuruş)
  {
    const alt = [1, 0, 0, -1, 0, 0].map((x) => x / Math.sqrt(2 / 6));
    let bestAlt = -Infinity, bp = 0;
    for (let p = score[3].p; p < 6; p += 3) {
      let s = 0;
      for (let j = 0; j < nB; j++) s += A[j] * alt[(((j + k0 - p) % 6) + 6) % 6];
      if (s > bestAlt) { bestAlt = s; bp = p; }
    }
    score[6] = { s: score[3].s + 0.5 * (bestAlt / tot) - 0.06, p: bp };
  }
  // vuruş sayısı + his → ölçü adayları (BPM sayılan vuruş; 6/8'de vuruş = noktalı çeyrek)
  const cand = [];
  const add = (meter, M, extra = {}) => cand.push(Object.assign({ meter, beats: M, score: score[M].s + (extra.bonus || 0), downbeat: score[M].p }, extra));
  if (feel === 'triple') {
    add('6/8', 2, { bonus: 0.02 });
    add('6/8', 4, { note: '12/8 hissi: iki 6/8 ölçüsü bir 12/8 ölçüsü gibi düşünülebilir' });
    add('9/8', 3, { unsupported: true });
  } else {
    add('4/4', 4, { bonus: 0.03 }); // en yaygın ölçüye küçük öncelik
    add('3/4', 3);
    add('2/4', 2, { bonus: -0.01 });
    add('6/8', 6, { bpm: Math.round(bpm / 3), note: `vuruşları 8'lik saymışsın gibi: 6/8, BPM ≈ ${Math.round(bpm / 3)} (noktalı çeyrek)` });
  }
  cand.sort((a, b) => b.score - a.score);
  // aynı ölçünün iki okuması varsa birini tut
  const seen = new Set(), cs = [];
  for (const c of cand) { const k = c.meter + (c.bpm || ''); if (!seen.has(k)) { seen.add(k); cs.push(c); } }
  const best = cs[0];
  const fam = (m) => (m === '4/4' || m === '2/4' ? 'duple' : m);
  const second = cs.find((c) => fam(c.meter) !== fam(best.meter)); // 4/4 ↔ 2/4 aynı aile (ayrıca bildirilir)
  const conf = best.score > 0 ? clamp((best.score - Math.max(0, second ? second.score : 0)) / best.score, 0, 1) : 0;
  out.ok = true;
  out.feel = feel; out.phase = phi; out.beatSec = P;
  out.meter = best.meter; out.bpm = best.bpm || bpm; out.unsupported = !!best.unsupported; out.note = best.note || null;
  out.confidence = conf; out.candidates = cs.slice(0, 3).map((c) => ({ meter: c.meter, bpm: c.bpm || bpm, score: c.score, note: c.note || null, unsupported: !!c.unsupported }));
  // 2/4 ile 4/4 çoğu zaman ayırt edilemez (4/4 = iki 2/4)
  out.ambiguous24 = (best.meter === '4/4' || best.meter === '2/4') && Math.abs(score[4].s - score[2].s) < 0.08;
  // ölçü başı (1. vuruş): faz + kaçıncı vuruş; zaman çizelgesinin ölçü çizgilerine göre kayma ve öncü
  const M = best.beats, beatP = best.bpm ? 60 / best.bpm : P;
  const down = phi + best.downbeat * P; // bir ölçü başının zamanı (saniye)
  const barSec = M * P;
  // kayma: ölçü başları ≡ down (mod ölçü), ilk nota 1. ölçünün içinde kalsın; ölçü çizgisinden az önce başlayan nota (kayma/scoop) 1. vuruş sayılır
  const tf = ns[0].t0;
  let r = (((tf - down) % barSec) + barSec) % barSec;
  if (r > barSec - 0.15 * P) r -= barSec;
  out.shiftSec = tf - r; // ölçü çizgileri bu kadar kaymalı (ofset += shiftSec)
  out.firstBeat = Math.max(0, Math.round((r / beatP) * 2) / 2) + 1; // 1, 1.5, 2 … ("2.5" = 2. vuruşun ve'si)
  out.scores = score;
  // ızgaraya oturma: notalar bu BPM'in 16'lık (üçlemede ⅓) ızgarasına, yakın ama yanlış tempolardan (±%7–12)
  // belirgin biçimde daha iyi oturuyor mu? Rastgele notalar her tempoya aynı oturur; doğru tempo öne çıkar.
  // 8'lik / üçleme / 16'lık ızgaralardan en belirgin olanı (kaba ızgara zamanlama sapmasına daha toleranslı)
  const ts = ns.map((n) => n.t0);
  let fit = 0, mean = 0, sd = 1, zBest = -Infinity;
  for (const sub of [2, 3, 4]) {
    const f = gridFit(ts, P, sub);
    const near = [0.85, 0.87, 0.89, 0.91, 0.93, 0.95, 1.05, 1.07, 1.09, 1.11, 1.13, 1.15].map((x) => gridFit(ts, P * x, sub));
    const m = near.reduce((a, b) => a + b, 0) / near.length;
    const d = Math.max(0.015, Math.sqrt(near.reduce((a, b) => a + (b - m) ** 2, 0) / near.length));
    if ((f - m) / d > zBest) { zBest = (f - m) / d; fit = f; mean = m; sd = d; }
  }
  out.onGrid = fit; out.gridZ = (fit - mean) / sd;
  if (out.gridZ < 2) out.reasons.push(`Notalar ${bpm} BPM ızgarasına yakın tempolardan daha iyi oturmuyor (%${Math.round(fit * 100)}; yakın tempolarda ortalama %${Math.round(mean * 100)}) — BPM yanlış olabilir; tahmin de bu yüzden güvenilmez.`);
  if (conf < 0.12) out.reasons.push('Vurgular iki ölçüye de benzer uyuyor; tahmin zayıf — ölçüyü kendin seçebilirsin.');
  return out;
}

// ---- 2) LOOP KÜTÜPHANESİ
// Adımlar: düz ölçülerde vuruş başına 4 (16'lık), üçleme hisli loop'larda vuruş başına 3.
// Karakterler: X vurgulu · x normal · g hayalet (çok hafif) · o açık hi-hat · . boş
const DRUM_LOOPS = [
  { id: 'rock8', name: "Rock / pop — 8'lik", meter: '4/4', spb: 4, feel: 'straight', bpm: [85, 150], base: 0.05,
    K: 'x.......x.x.....', S: '....X.......X...', H: 'x.x.x.x.x.x.x.x.', desc: "kick 1 ve 3'te, trampet 2 ve 4'te (backbeat), hi-hat 8'lik" },
  { id: 'four', name: 'Four-on-the-floor (dans)', meter: '4/4', spb: 4, feel: 'straight', bpm: [100, 140], base: 0,
    K: 'x...x...x...x...', S: '....X.......X...', H: '..o...o...o...o.', desc: "her vuruşta kick, 2 ve 4'te trampet, ara 8'liklerde açık hi-hat" },
  { id: 'half', name: "Yarım zaman (trampet 3'te)", meter: '4/4', spb: 4, feel: 'straight', bpm: [60, 165], base: 0,
    K: 'x.........x.....', S: '........X.......', H: 'x.x.x.x.x.x.x.x.', desc: "kick 1'de, trampet yalnızca 3'te — tık tık TISS tık" },
  { id: 'ballad16', name: "Balad — 16'lık hi-hat", meter: '4/4', spb: 4, feel: 'straight', bpm: [58, 92], base: 0,
    K: 'x.....x.x.......', S: '....X.......X...', H: 'xgxgxgxgxgxgxgxg', desc: "yavaş: 16'lık hafif hi-hat, 2 ve 4'te trampet" },
  { id: 'boombap', name: 'Hip-hop / boom-bap', meter: '4/4', spb: 4, feel: 'straight', bpm: [78, 102], base: 0,
    K: 'x......x..x.....', S: '....X.......X...', H: 'x.x.x.x.x.x.x.x.', desc: "senkoplu kick, 2 ve 4'te sert trampet" },
  { id: 'onedrop', name: "One-drop (reggae — kick+trampet 3'te)", meter: '4/4', spb: 4, feel: 'straight', bpm: [60, 95], base: -0.02,
    K: '........x.......', S: '........X.......', H: '..x...x...x...x.', desc: "1. vuruş boş, kick ve trampet birlikte 3'te" },
  { id: 'shuffle', name: 'Shuffle / swing (üçleme)', meter: '4/4', spb: 3, feel: 'triple', bpm: [70, 140], base: 0,
    K: 'x.....x.....', S: '...X.....X..', H: 'x.xx.xx.xx.x', desc: "üçleme hissi: hi-hat 'uzun-kısa', 2 ve 4'te trampet" },
  { id: 'shufflecell', name: 'Shuffle hücresi — X . t (her vuruşta aynı)', meter: '4/4', spb: 3, feel: 'triple', bpm: [70, 140], base: 0,
    K: 'x.....x.....', S: '...X.....X..', H: 'x.gx.gx.gx.g', desc: "her vuruşta aynı hücre: güçlü (X) · boş · hafif ghost (t) — sayım \"1 ve-let 2 ve-let…\"; kick 1 ve 3'te, trampet 2 ve 4'te. Ghost (t) projenin swing oranına oturur" },
  { id: 'push332', name: 'İtmeli pop-rock (3+3+2 kick, 4\'ün ve\'sinde öncel)', meter: '4/4', spb: 4, feel: 'straight', bpm: [128, 180], base: 0,
    K: 'x..x....x..x..x.', S: '....X.......X...', H: 'x.x.x.x.x.x.x.o.', desc: "kick 1, 1'in son 16'lığı, 3, 3'ün son 16'lığı ve 4'ün ve'sinde (sonraki 1'i önden iter, açık hi-hat); trampet 2 ve 4'te. Melodisi vuruşların önüne/arkasına senkoplu hızlı şarkılar için" },
  { id: 'minimal', name: 'Sade — kick + hi-hat', meter: '4/4', spb: 4, feel: 'straight', bpm: [55, 150], base: -0.12,
    K: 'x.......x.......', S: '................', H: 'x.x.x.x.x.x.x.x.', desc: 'trampetsiz, en az müdahale' },
  { id: 'waltz', name: 'Vals', meter: '3/4', spb: 4, feel: 'straight', bpm: [84, 200], base: 0,
    K: 'x...........', S: '....g...g...', H: 'x...x...x...', desc: "kick 1'de, 2 ve 3 hafif — UM-pa-pa" },
  { id: 'ballad34', name: '3/4 balad', meter: '3/4', spb: 4, feel: 'straight', bpm: [50, 110], base: 0,
    K: 'x.....x.....', S: '........X...', H: 'x.x.x.x.x.x.', desc: "kick 1'de (+ 2'nin ve'si), trampet 3'te, 8'lik hi-hat" },
  { id: 'polka', name: 'Marş / polka', meter: '2/4', spb: 4, feel: 'straight', bpm: [90, 160], base: 0,
    K: 'x.......', S: '....X...', H: '..x...x.', desc: "kick 1'de, trampet 2'de, ara 8'liklerde hi-hat" },
  { id: 'pop24', name: "2/4 düz (8'lik)", meter: '2/4', spb: 4, feel: 'straight', bpm: [70, 140], base: -0.02,
    K: 'x.....x.', S: '....X...', H: 'x.x.x.x.', desc: "kick 1'de (+ 2'nin ve'si), trampet 2'de" },
  { id: 'ballad68', name: '6/8 balad', meter: '6/8', spb: 3, feel: 'triple', bpm: [36, 80], base: 0,
    K: 'x.....', S: '...X..', H: 'xxxxxx', desc: "kick 1'de, trampet 4. 8'likte, her 8'likte hi-hat" },
  { id: 'rock68', name: '6/8 rock / afro', meter: '6/8', spb: 3, feel: 'triple', bpm: [50, 100], base: 0,
    K: 'x...x.', S: '...X..', H: 'x.xx.x', desc: "kick 1 ve 5. 8'likte, trampet 4'te" },
];

// ---- 2b) KALIP KÜTÜPHANESİ (45 kalıp: A–E). Yazım: "vuruş + ek" — 1 2 3 4 = vuruş; e & a = 16'lıkların 2./3./4. adımı
// (üçlemede & = 2., a = 3. adım; 6/8'de rakam = 8'lik adımı 1–6). Başa harf: X vurgulu · x normal · g hayalet · o açık hi-hat.
// "*4" her vuruş, "*8" her 8'lik, "*16" her 16'lık, "*e" "*&" "*a" her vuruşun o adımı. Sonraki parça öncekini ezer.
// Şeritler: K kick · S trampet · H hi-hat · F floor tom · T tom · C clap · R rim click (cross-stick) · D ride · P hi-hat pedalı.
const LANES = ['K', 'S', 'H', 'F', 'T', 'C', 'R', 'D', 'P'];
const LANE_DEFAULT = { K: 'x', H: 'x', D: 'x', P: 'x' }; // diğer şeritlerin varsayılanı X (vurgulu)
const LANE_NAME = { K: 'Kick', S: 'Trampet', H: 'Hi-hat', F: 'Floor tom', T: 'Tom', C: 'Clap', R: 'Rim click', D: 'Ride', P: 'Hat pedal' };
const SUB = { 4: { '': 0, e: 1, '&': 2, a: 3 }, 3: { '': 0, '&': 1, a: 2 } };
function parsePattern(spec, steps, spb, stepMode, lane) {
  const out = new Array(steps).fill('.');
  for (const tok of String(spec || '').split(/\s+/).filter(Boolean)) {
    const m = /^([Xxgo]?)(?:\*(4|8|16|&|e|a)|(\d)([ea&]?))$/.exec(tok);
    if (!m) throw new Error(`kalıp jetonu anlaşılmadı: "${tok}"`);
    const ch = m[1] || LANE_DEFAULT[lane] || 'X';
    if (m[2]) {
      for (let i = 0; i < steps; i++) {
        const w = m[2], inBeat = i % spb;
        const hit = stepMode ? w === '8' // 6/8: her adım bir 8'lik
          : w === '4' ? inBeat === 0
          : w === '16' ? spb === 4
          : w === '8' ? spb === 4 && inBeat % 2 === 0
          : inBeat === SUB[spb][w];
        if (hit) out[i] = ch;
      }
    } else {
      const d = +m[3], i = stepMode ? d - 1 : (d - 1) * spb + (SUB[spb][m[4]] ?? NaN);
      if (!(i >= 0 && i < steps)) throw new Error(`kalıp adımı ızgaranın dışında: "${tok}"`);
      out[i] = ch;
    }
  }
  return out.join('');
}
const CATS = {
  A: '4/4 · temel rock kalıpları', B: '4/4 · post-punk, darkwave, synthwave', C: '4/4 · half-time ailesi',
  D: '3/4 · waltz', E: '6/8', Z: 'Diğer (ilk loop\'lar)',
};
const STEPS_OF = { '4/4': 16, '3/4': 12, '2/4': 8, '6/8': 6 };
// def: { no, cat, id, name, meter, spb (4 düz · 3 üçleme), bpm, base, K S H F T C R D P (jetonlar), lay, fill:{every, lanes}, desc }
// Otomatik öneri ilk 15 loop'un davranışını korusun: kalıplar elle seçilir; tempo/his başka loop'a uymayınca ya da vurgu çok daha iyi oturunca öne çıkar.
const NEW_BASE = -0.1;
function buildPattern(d) {
  const spb = d.spb || 4, meter = d.meter || '4/4', stepMode = meter === '6/8';
  const steps = stepMode ? 6 : (meter === '4/4' ? 4 : meter === '3/4' ? 3 : 2) * spb;
  const L = { id: d.id, no: d.no, cat: d.cat, name: d.name, meter, spb, feel: spb === 3 ? 'triple' : 'straight', bpm: d.bpm, base: d.base ?? NEW_BASE, desc: d.desc };
  for (const k of LANES) {
    const v = parsePattern(d[k], steps, spb, stepMode, k);
    if (k === 'K' || k === 'S' || k === 'H' || /[^.]/.test(v)) L[k] = v;
  }
  if (d.lay) L.lay = d.lay;
  if (d.fill) {
    L.fill = { every: d.fill.every, lanes: {} };
    for (const k of LANES) if (d.fill[k] != null) L.fill.lanes[k] = parsePattern(d.fill[k], steps, spb, stepMode, k);
  }
  return L;
}
const PATTERN_DEFS = [
  // ---------------- A) 4/4: temel rock kalıpları
  { no: 1, cat: 'A', id: 'backbeat', name: 'Basic backbeat', bpm: [70, 160], K: '1 3', S: '2 4', H: '*8',
    desc: "kick 1 ve 3'te, trampet 2 ve 4'te, hi-hat 8'lik — rock'ın ve synthwave'in varsayılanı" },
  { no: 3, cat: 'A', id: 'motorik', name: 'Motorik', bpm: [110, 160], K: '1 3', S: '2 4', H: 'X*8',
    desc: "kick 1 ve 3'te, trampet 2 ve 4'te, hi-hat sürekli ve eşit vurgulu 8'lik — hipnotik, makine gibi akış (Neu!, Joy Division, Stereolab)" },
  { no: 5, cat: 'A', id: 'train', name: 'Train beat', bpm: [120, 190], K: '1 3', S: 'x*4 g*& g*a X2 X4', H: '*4',
    desc: "trampet vuruş + & + a'da \"çuf-a çuf-a\" akar, 2 ve 4 vurgulu; kick 1 ve 3 (Johnny Cash, \"Folsom Prison Blues\")" },
  { no: 6, cat: 'A', id: 'bodiddley', name: 'Bo Diddley beat', bpm: [95, 140], K: '1 3', T: '1 1a 2& 3& 4', H: 'g*8',
    desc: "3-2 clave'ı tom'larda: 1, 1a, 2&, 3&, 4 — \"bomp, ba-bomp-bomp, bomp-bomp\"; kick 1 ve 3" },
  { no: 7, cat: 'A', id: 'levee', name: '"When the Levee Breaks" groove', bpm: [60, 85], K: '1 3& 3a', S: '2 4', H: '*8', lay: { S: 0.12 },
    desc: "yavaş ve geniş; trampet hafif geriden (backbeat gecikmeli) — en çok sample'lanan davul break'i" },
  // ---------------- B) 4/4: post-punk, darkwave, synthwave
  { no: 8, cat: 'B', id: 'tribal', name: 'Tom-ağırlıklı tribal', bpm: [90, 150], K: '1 3', T: '1 3', F: '2 4',
    desc: "hi-hat yok; rack ve floor tom 1-2-3-4 üzerinde dönüşümlü, kick 1 ve 3'te (Siouxsie, Bauhaus, Killing Joke)" },
  { no: 9, cat: 'B', id: 'fastpunk', name: 'Hızlı punk beat', bpm: [150, 210], K: '1 1&', S: '2 4', H: '*8',
    desc: "kick 1 ve 1&'de, trampet 2 ve 4'te, hızlı tempoda 8'lik hi-hat (Wire, Magazine, erken Siouxsie)" },
  { no: 10, cat: 'B', id: 'syncokick', name: 'Syncopated kick groove', bpm: [100, 150], K: '1 2& 3& 4&', S: '2 4', H: '*8',
    desc: "trampet 2 ve 4'te sabit, kick beklenmedik yerlerde (1, 2&, 3&, 4&) — gergin, hafif funky (Gang of Four, The Fall, Gary Numan)" },
  { no: 11, cat: 'B', id: 'dub', name: 'Dub / one-drop (swing hi-hat)', spb: 3, bpm: [60, 100], K: '3', S: '3', H: 'x*4 x*a',
    desc: "kick ve trampet 3. vuruşta, hi-hat swing'li üçleme (PiL, The Slits, The Clash)" },
  { no: 12, cat: 'B', id: 'joydiv', name: 'Joy Division tarzı hook', bpm: [110, 160], K: '1 3', S: '2 4', H: 'X*4 x*& g*e g*a', T: '4& 4a',
    desc: "kick 1 ve 3, trampet 2 ve 4; 16'lık hi-hat tonlaması (vuruş > & > e/a) ve her ölçü sonunda tom dolgusu — yalın ama sert" },
  { no: 13, cat: 'B', id: 'drive16', name: "16'lık hi-hat drive", bpm: [110, 130], K: '1 3 3a', S: '2 4', H: 'x*16 X*4',
    desc: "kick 1 ve 3 (+ 3a), trampet 2 ve 4, her 16'lıkta hi-hat, vuruşlar vurgulu — hızlı synthwave'in \"gece sürüşü\" hissi" },
  { no: 14, cat: 'B', id: 'pulse8', name: "Pulsing 8th-note kick", bpm: [100, 135], K: '*8', S: '2 4', H: 'g*&',
    desc: "kick her 8'likte, trampet 2 ve 4'te, hi-hat çok az — dark synthwave ve EBM'e yakın darkwave" },
  { no: 15, cat: 'B', id: 'gated', name: 'Gated-reverb snare + tom fill', bpm: [90, 130], K: '1 3', S: '2 4', H: '*8',
    fill: { every: 4, S: '2', T: '3 3& 4', F: '4& 4a' },
    desc: "backbeat üzerine dev gated trampet; her 4. ölçünün sonunda yüksekten alçağa tom inişi — 80'lerin imzası" },
  { no: 16, cat: 'B', id: 'clapsnare', name: 'Clap-layered snare', bpm: [85, 130], K: '1 2a 3', S: '2 4', C: '2 4', H: 'x*8 o4&',
    desc: "clap ve trampet 2 ve 4'te üst üste, kick 1, 2a ve 3'te, 8'lik hi-hat, 4&'de açık hi-hat — 808/909 havası" },
  { no: 17, cat: 'B', id: 'ebm', name: 'EBM / sequenced makine', bpm: [120, 135], K: '1 1a 2& 3 3a', S: '2 4', H: 'x*16',
    desc: "kick 16'lık dizilimde (1, 1a, 2&, 3, 3a), trampet 2 ve 4, sürekli 16'lık hi-hat (Front 242, Nitzer Ebb)" },
  // ---------------- C) 4/4: half-time ailesi (trampet 2 ve 4 yerine yalnızca 3'te)
  { no: 18, cat: 'C', id: 'ht-flat', name: 'Düz half-time', bpm: [60, 165], K: '1', S: '3', H: '*8',
    desc: "kick 1'de, trampet 3'te, 8'lik hi-hat — half-time'ın temel hali" },
  { no: 19, cat: 'C', id: 'ht-kick', name: "Kick'li half-time", bpm: [60, 165], K: '1 4&', S: '3', H: '*8',
    desc: "kick 1'de ve 4&'de (sonraki 1'i önden iter), trampet 3'te — groove'a ileri doğru itiş" },
  { no: 20, cat: 'C', id: 'ht-shuffle', name: 'Half-time shuffle', spb: 3, bpm: [55, 100], K: '1 2a', S: 'X3 g1& g2& g2a g3a g4& g4a', H: 'x*4 x*a',
    desc: "üçleme swing, trampet 3'te, aralarda çok hayalet nota (Toto \"Rosanna\", Purdie shuffle)" },
  { no: 21, cat: 'C', id: 'ht-hat16', name: "16'lık hat'li half-time", bpm: [65, 170], K: '1', S: '3', H: 'x*16',
    desc: "trampet 3'te, hi-hat her 16'lıkta — trap, modern pop ve hızlı synthwave" },
  { no: 22, cat: 'C', id: 'ht-rim', name: 'Rim click half-time', bpm: [60, 110], K: '1 3&', R: '3', H: '*4',
    desc: "trampet yerine cross-stick 3'te, kick 1'de (bazen 3&'de), hi-hat çeyreklik — soğuk, klinik coldwave/darkwave" },
  { no: 23, cat: 'C', id: 'ht-tom', name: 'Tom half-time', bpm: [55, 100], K: '1', F: '3',
    desc: "backbeat 3'te floor tom'a verilir, trampet yok — ağır ve tribal" },
  { no: 24, cat: 'C', id: 'ht-clap', name: 'Clap/snare katmanlı half-time', bpm: [60, 120], K: '1 2a', S: '3', C: '3', H: '*8',
    desc: "3'te clap ve trampet üst üste, kick 1 ve 2a'da — 808 sesli elektronik versiyon" },
  { no: 25, cat: 'C', id: 'ht-cine', name: 'Sinematik half-time', bpm: [65, 95], K: '1', S: '3', H: '1 3',
    fill: { every: 4, S: '3', T: '4 4&', F: '4a' },
    desc: "kick 1'de, trampet 3'te, hi-hat yalnızca 1 ve 3'te, her 4. ölçünün sonunda fill — baladlar ve gerilim bölümleri" },
  // ---------------- D) 3/4 (waltz)
  { no: 26, cat: 'D', id: 'w-basic', name: 'Temel waltz', meter: '3/4', bpm: [80, 180], K: '1', S: '2 3', H: '*4',
    desc: "kick 1'de, trampet 2 ve 3'te, hi-hat çeyreklik (\"oom-pah-pah\")" },
  { no: 27, cat: 'D', id: 'w-eighth', name: "Sekizlik hat'li waltz", meter: '3/4', bpm: [80, 180], K: '1', S: '2 3', H: '*8',
    desc: "temel waltz, hi-hat her 8'likte — pop/rock'ta en yaygın hali" },
  { no: 28, cat: 'D', id: 'w-ballad', name: 'Yavaş balad waltz', meter: '3/4', bpm: [50, 110], K: '1', S: '3', H: '*8',
    desc: "kick 1'de, trampet yalnızca 3'te, 8'lik hi-hat — half-time waltz hissi" },
  { no: 29, cat: 'D', id: 'w-rim', name: 'Rim click waltz', meter: '3/4', bpm: [60, 140], K: '1', R: '2 3',
    desc: "kick 1'de, cross-stick 2 ve 3'te, hi-hat yok — yumuşak ve minimal" },
  { no: 30, cat: 'D', id: 'w-syncopated', name: 'Senkoplu waltz', meter: '3/4', bpm: [70, 150], K: '1 2&', S: '3', H: '*8',
    desc: "kick 1 ve 2&'de, trampet 3'te, 8'lik hi-hat" },
  { no: 31, cat: 'D', id: 'w-dance', name: "Her vuruşta kick'li waltz", meter: '3/4', bpm: [100, 140], K: '1 2 3', S: '3', C: '3', H: 'o*&',
    desc: "kick 1, 2, 3'te, clap + trampet 3'te, açık hi-hat \"&\"lerde — dans versiyonu" },
  { no: 32, cat: 'D', id: 'w-tom', name: 'Tom waltz', meter: '3/4', bpm: [60, 130], K: '1', F: '1', T: '2 3',
    desc: "floor tom 1'de, rack tom 2 ve 3'te, kick 1'de — tribal, ritüel gibi" },
  { no: 33, cat: 'D', id: 'w-jazz', name: 'Jazz waltz', meter: '3/4', spb: 3, bpm: [90, 180], K: 'g1', D: '1 2 2a 3', P: '2 3',
    desc: "swing'li ride 1, 2 (+ 2a), 3'te, hi-hat pedalı 2 ve 3'te, hafif kick 1'de" },
  { no: 34, cat: 'D', id: 'w-rock', name: 'Rock waltz', meter: '3/4', bpm: [70, 140], K: '1 3&', S: '2 3', H: 'x*8 X1',
    desc: "kick 1 ve 3&'de, trampet 2 ve 3'te, 8'lik hi-hat ve 1'de vurgu — daha ağır ve sürükleyici" },
  { no: 35, cat: 'D', id: 'w-sparse', name: 'Seyrek waltz + açık hat', meter: '3/4', bpm: [55, 120], K: '1', S: '3', H: 'o3&',
    desc: "kick 1'de, trampet 3'te, açık hi-hat 3&'de — darkwave kıtaları için" },
  // ---------------- E) 6/8 (rakam = 8'lik adımı, 1–6)
  { no: 37, cat: 'E', id: 'e-dotted', name: 'Noktalı çeyrek nabzı', meter: '6/8', spb: 3, bpm: [40, 90], K: '1', S: '4', H: '1 4',
    desc: "kick 1'de, trampet 4'te, hi-hat yalnızca 1 ve 4'te — temel 6/8'in daha ferah hali" },
  { no: 38, cat: 'E', id: 'e-twokick', name: "İki kick'li 6/8", meter: '6/8', spb: 3, bpm: [40, 85], K: '1 3', S: '4', H: '*8',
    desc: "kick 1 ve 3'te, trampet 4'te, 8'lik hi-hat — biraz daha itiş" },
  { no: 39, cat: 'E', id: 'e-pickup', name: 'Pickup kick', meter: '6/8', spb: 3, bpm: [40, 85], K: '1 6', S: '4', H: '*8',
    desc: "kick 1 ve 6'da, trampet 4'te — 6'daki kick sonraki ölçüye iter" },
  { no: 40, cat: 'E', id: 'e-rim', name: 'Cross-stick balad', meter: '6/8', spb: 3, bpm: [36, 75], K: '1', R: '4', H: '*8',
    desc: "kick 1'de, rim click 4'te, hi-hat sekizlik — yavaş şarkılarda yumuşak seçenek" },
  { no: 41, cat: 'E', id: 'e-tom', name: 'Tom-driven tribal 6/8', meter: '6/8', spb: 3, bpm: [45, 90], K: '1', F: '1 4', T: '3 6',
    desc: "floor tom 1 ve 4'te, rack tom 3 ve 6'da, kick 1'de — yuvarlanan, ritüel gibi" },
  { no: 42, cat: 'E', id: 'e-hemiola', name: 'Hemiola (6/8 üzerinde 3/4)', meter: '6/8', spb: 3, bpm: [40, 85], K: '1', S: '3 5', H: '*8',
    desc: "vurgular 1, 3, 5'te (kick 1'de, trampet 3 ve 5'te) — waltz hissi 6/8 nabzını keser, gerilim yaratır" },
  { no: 43, cat: 'E', id: 'e-halftime', name: 'Half-time 6/8', meter: '6/8', spb: 3, bpm: [36, 70], K: '1', S: '4', H: 'g1 g4',
    fill: { every: 4, S: '4', T: '5', F: '6' },
    desc: "kick 1'de, trampet yalnızca 4'te, hi-hat 1 ve 4'te seyrek, her 4. ölçünün sonunda fill — ağır ve sinematik" },
  { no: 44, cat: 'E', id: 'e-march', name: 'March tarzı 6/8', meter: '6/8', spb: 3, bpm: [50, 100], K: '3 6', S: '1 3 4 6',
    desc: "trampet 1, 3, 4, 6'da, kick 3 ve 6'da — askeri / rudimental" },
  { no: 45, cat: 'E', id: 'e-openhat', name: 'Açık hat nabzı', meter: '6/8', spb: 3, bpm: [36, 80], K: '1', S: '4', H: 'x*8 o6',
    desc: "kick 1'de, trampet 4'te, 8'lik hi-hat, 6'da açık hi-hat — sonraki ölçüye geçişi hazırlar" },
];
// zaten var olan, birebir aynı kalıplar yeniden yazılmadı; numarasıyla işaretlendi
const TAGGED = { four: [2, 'A'], shuffle: [4, 'A'], ballad68: [36, 'E'] };
for (const L of DRUM_LOOPS) { if (TAGGED[L.id]) { L.no = TAGGED[L.id][0]; L.cat = TAGGED[L.id][1]; } else L.cat = 'Z'; }
for (const d of PATTERN_DEFS) DRUM_LOOPS.push(buildPattern(d));
const loopLabel = (L) => (L.no ? `${L.no} · ` : '') + L.name;
const VEL = { X: 1, x: 0.78, o: 0.7, g: 0.32 };
// loop'un "ağırlık merkezi" profili (adım başına): melodinin vurguları kick'le örtüşmeli; trampet (backbeat)
// melodinin vurgusuyla çakışmak zorunda değil, onu tamamlar — bu yüzden az sayılır.
function loopProfile(L) {
  const n = L.K.length, p = new Float64Array(n);
  const peak = (lanes, i) => Math.max(0, ...lanes.map((k) => (L[k] && L[k][i] !== '.' ? VEL[L[k][i]] : 0)));
  for (let i = 0; i < n; i++) {
    p[i] += 1 * peak(['K'], i);
    p[i] += 0.25 * peak(['S', 'C', 'R', 'F', 'T'], i); // trampet / clap / rim / tom'lar: aynı yerde üst üste olunca bir sayılır
    p[i] += 0.1 * peak(['H', 'D', 'P'], i);
  }
  return p;
}
const loopsFor = (meter) => DRUM_LOOPS.filter((l) => l.meter === meter);

// ---- 3) LOOP SEÇİMİ: ölçü + BPM + melodinin vurguları
// Melodinin ölçü içi vurgu profili, loop'un adım ızgarasına katlanır ve loop'un kick/trampet profiliyle karşılaştırılır.
function melodyProfile(notes, g, steps, P) {
  const prof = new Float64Array(steps);
  const ns = notes.filter((n) => n.t1 > n.t0).sort((a, b) => a.t0 - b.t0);
  const w = noteAccents(ns, P);
  const barSec = g.barSec;
  ns.forEach((n, i) => {
    const pos = ((n.t0 % barSec) + barSec) % barSec / barSec * steps;
    const s = Math.round(pos) % steps;
    if (Math.abs(pos - Math.round(pos)) < 0.35) prof[s] += w[i];
  });
  return prof;
}
function corr(a, b) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : 0;
}
function tempoFit(bpm, [lo, hi]) {
  if (bpm >= lo && bpm <= hi) return 1;
  const d = Math.abs(Math.log(bpm / (bpm < lo ? lo : hi)));
  return Math.exp(-d / 0.12); // %12 dışarıda → ~0.37
}
const PROFILE_DIGITS = (p) => { const mx = Math.max(...p) || 1; return Array.from(p, (x) => (x < 0.05 * mx ? '.' : String(Math.min(9, Math.round((9 * x) / mx))))).join(''); };
// notes: {t0, t1, loud?, pitch?} — zaman çizelgesi saniyesi (1. ölçü başı = 0)
function suggestDrumLoop(notes, settings, est = null) {
  const g = makeGrid(settings), meter = settings.meter, bpm = settings.bpm;
  const P = 60 / bpm;
  const res = { meter, bpm, ranked: [], best: null, ok: false, reasons: [], request: '' };
  const ns = notes.filter((n) => n.t1 > n.t0);
  // senin bildirdiğin swing oranı (≥ %60) varsa his üçlemedir; yoksa melodiden tahmin
  const declared = settings.swingRatio >= 0.6;
  const feel = declared ? 'triple' : est && est.ok ? est.feel : 'straight';
  const pool = loopsFor(meter);
  if (!pool.length) res.reasons.push(`${meter} ölçüsü için loop yok.`);
  for (const L of pool) {
    const steps = L.K.length;
    const mp = ns.length >= 4 ? melodyProfile(ns, g, steps, P) : null;
    const lp = loopProfile(L);
    const acc = mp ? corr(mp, lp) : 0;
    const tf = tempoFit(bpm, L.bpm);
    const ff = L.feel === feel ? 1 : 0;
    let total = 0.4 * acc + 0.4 * tf + 0.2 * ff + L.base;
    const why = [];
    if (settings.prefDelta) { const pd = settings.prefDelta(L); if (pd) { total += pd; why.push(pd > 0 ? `senin 👍 tercihin (+${pd.toFixed(2)})` : `senin 👎 tercihin (${pd.toFixed(2)})`); } }
    if (settings.clickFeel === 'halftime' && L.id === 'half') { total += 0.12; why.push('click deseni yarım zaman seçili'); }
    why.push(tf === 1 ? `tempo ${bpm} BPM aralıkta (${L.bpm[0]}–${L.bpm[1]})` : `tempo ${bpm} BPM aralık dışı (${L.bpm[0]}–${L.bpm[1]})`);
    if (mp) why.push(acc > 0.25 ? 'vurguları melodinin güçlü vuruşlarıyla örtüşüyor' : acc > 0 ? 'vurgularla zayıf örtüşme' : 'vurguları melodinin güçlü vuruşlarına ters düşüyor');
    if (declared && ff) why.push(`swing oranın %${Math.round(settings.swingRatio * 100)}: üçleme hisli loop'lar öne çıkar`);
    if (!ff) why.push(L.feel === 'triple' ? 'loop üçleme hisli, melodi düz' : 'loop düz, melodi üçleme hisli');
    res.ranked.push({ loop: L, score: total, accent: acc, tempo: tf, feelOk: !!ff, why });
  }
  res.ranked.sort((a, b) => b.score - a.score);
  const b = res.ranked[0];
  res.best = b || null;
  // ---- "uygun loop yok" kararı
  if (ns.length < 8) res.reasons.push(`Melodide ${ns.length} nota var; vurgulara göre seçim için en az 8 gerekir (seçim yalnızca tempoya göre).`);
  if (est && est.ok && est.meter !== meter && est.confidence >= 0.2) res.reasons.push(`Melodinin vurguları ${est.meter} ölçüsüne daha çok benziyor ama proje ${meter}; loop proje ölçüsüne göre seçildi.`);
  if (est && est.ok && est.gridZ < 2) res.reasons.push(`Melodi ${bpm} BPM ızgarasına oturmuyor; önce BPM'i kontrol et (oynatırken metronomu açıp dinle).`);
  if (est && est.unsupported) res.reasons.push(`Melodi ${est.meter} gibi görünüyor; bu ölçü için loop yok.`);
  if (b) {
    if (b.tempo < 0.5) res.reasons.push(`${bpm} BPM ${meter} için hiçbir loop'un tempo aralığına uymuyor (en yakın: ${b.loop.name}, ${b.loop.bpm[0]}–${b.loop.bpm[1]}).`);
    if (!b.feelOk) res.reasons.push(feel === 'triple' ? `Melodi üçleme (shuffle/swing) hisli; ${meter} için üçleme hisli loop yok.` : `En iyi loop'un hissi melodiye uymuyor.`);
    if (ns.length >= 8 && b.accent < 0.05) res.reasons.push(`Hiçbir loop'un vurguları melodinin vurgularıyla örtüşmüyor (en iyisi ${b.loop.name}: ${b.accent.toFixed(2)}).`);
    if (b.score < 0.45) res.reasons.push(`En iyi eşleşme bile zayıf (puan ${b.score.toFixed(2)}).`);
  }
  const blocking = res.reasons.filter((r) => !/loop proje ölçüsüne göre seçildi|seçim yalnızca tempoya göre/.test(r));
  res.ok = !!b && !blocking.length;
  // Claude'dan yeni loop istemek için kopyalanabilir tarif
  const steps16 = meter === '6/8' || feel === 'triple' ? Math.round((g.barQ / g.pulseQ) * 3) : Math.round((g.barQ / g.pulseQ) * 4);
  const mp = ns.length >= 4 ? melodyProfile(ns, g, steps16, P) : null;
  res.request = [
    'Mini DAW için yeni bir davul loop\'u istiyorum.',
    `Ölçü: ${meter} · Tempo: ${bpm} BPM (${meter === '6/8' ? 'noktalı çeyrek' : 'çeyrek'}) · His: ${feel === 'triple' ? 'üçleme (shuffle/swing)' : "düz 8'lik/16'lık"}`,
    mp ? `Melodinin ölçü içi vurgu profili (${steps16} adım, 0–9): ${PROFILE_DIGITS(mp)}` : '',
    est && est.ok ? `Ölçü tahmini: ${est.meter} (güven %${Math.round(est.confidence * 100)})` : '',
    `Neden mevcutlar uymadı: ${(blocking.length ? blocking : res.reasons).join(' ') || '—'}`,
    `Biçim: { id, name, meter: '${meter}', spb, feel, bpm: [min, max], K: '…', S: '…', H: '…' } (src/drums.js DRUM_LOOPS)`,
  ].filter(Boolean).join('\n');
  return res;
}

// ---- 4) SES: kick / trampet / hi-hat sentezi (tekrarlanabilir gürültü)
function noiseGen(seed) { let r = seed >>> 0; return () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
function synthDrum(kind, sr) {
  const dur = { K: 0.45, S: 0.25, O: 0.35, F: 0.5, T: 0.38, C: 0.22, R: 0.05, D: 0.7, P: 0.05 }[kind] || 0.07;
  const n = Math.round(dur * sr), x = new Float32Array(n), rnd = noiseGen(kind.charCodeAt(0) * 7919);
  if (kind === 'K') {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = 48 + 110 * Math.exp(-t / 0.035);
      ph += (2 * Math.PI * f) / sr;
      x[i] = 0.95 * Math.sin(ph) * Math.exp(-t / 0.16) + 0.25 * rnd() * Math.exp(-t / 0.004);
    }
  } else if (kind === 'S') {
    let ph = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; ph += (2 * Math.PI * 190) / sr;
      const nz = rnd(); lp += 0.55 * (nz - lp);
      x[i] = 0.45 * Math.sin(ph) * Math.exp(-t / 0.05) + 0.6 * (nz - 0.5 * lp) * Math.exp(-t / 0.085);
    }
  } else if (kind === 'F' || kind === 'T') { // tom'lar: perdesi düşen sinüs + kısa vuruş gürültüsü (F alçak floor, T rack)
    const f0 = kind === 'F' ? 78 : 125, bend = kind === 'F' ? 55 : 80, tau = kind === 'F' ? 0.2 : 0.14;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; ph += (2 * Math.PI * (f0 + bend * Math.exp(-t / 0.04))) / sr;
      x[i] = 0.9 * Math.sin(ph) * Math.exp(-t / tau) + 0.2 * rnd() * Math.exp(-t / 0.006);
    }
  } else if (kind === 'C') { // clap: üç kısa gürültü patlaması + kuyruk
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, nz = rnd(); lp += 0.35 * (nz - lp);
      const burst = [0, 0.011, 0.022].reduce((a, t0) => a + (t >= t0 ? Math.exp(-(t - t0) / 0.004) : 0), 0);
      x[i] = 0.7 * (nz - lp) * (burst * 0.6 + 0.5 * Math.exp(-t / 0.06));
    }
  } else if (kind === 'R') { // rim click (cross-stick): kısa, tahta gibi tıkırtı
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; ph += (2 * Math.PI * 1650) / sr;
      x[i] = 0.55 * Math.sin(ph) * Math.exp(-t / 0.006) + 0.35 * rnd() * Math.exp(-t / 0.003);
    }
  } else if (kind === 'D') { // ride: uyumsuz tizler + tizleştirilmiş gürültü
    let prev = 0;
    const fr = [3170, 4210, 5530, 6890, 8390];
    for (let i = 0; i < n; i++) {
      const t = i / sr, nz = rnd(), hp = nz - prev; prev = nz;
      let m = 0; for (const f of fr) m += Math.sin(2 * Math.PI * f * t);
      x[i] = (0.05 * m + 0.12 * hp) * Math.exp(-t / 0.28) + 0.12 * Math.exp(-t / 0.004) * rnd();
    }
  } else if (kind === 'P') { // hi-hat pedalı: kapalı hi-hat'ten daha yumuşak, kısa
    let prev = 0;
    for (let i = 0; i < n; i++) { const nz = rnd(), hp = nz - prev; prev = nz; x[i] = 0.2 * hp * Math.exp(-(i / sr) / 0.012); }
  } else { // H (kapalı) / O (açık): tizleştirilmiş gürültü
    let prev = 0;
    const tau = kind === 'O' ? 0.12 : 0.018;
    for (let i = 0; i < n; i++) { const nz = rnd(); const hp = nz - prev; prev = nz; x[i] = 0.35 * hp * Math.exp(-(i / sr) / tau); }
  }
  for (let i = 0; i < 32 && i < n; i++) x[n - 1 - i] *= i / 32;
  return x;
}
// Zaman çizelgesi boyunca davul vuruşları: {t (s), kind 'K'|'S'|'H'|'O'|'F'|'T'|'C'|'R'|'D'|'P', vel, q (çeyrek)}
// loop.lay: şerit başına gecikme (adımın kesri; ör. trampet hafif geriden). loop.fill: her N. ölçüde o şeritlerin yerine fill kalıbı.
function drumEvents(loop, g, bars, fromBar = 1) {
  const ev = [];
  if (!loop) return ev;
  const steps = loop.K.length, stepQ = g.barQ / steps;
  for (let b = fromBar - 1; b < bars; b++) {
    const fill = loop.fill && (b + 1) % loop.fill.every === 0 ? loop.fill.lanes : null;
    for (const lane of LANES) {
      const pat = (fill && fill[lane]) || loop[lane];
      if (!pat) continue;
      const lay = ((loop.lay && loop.lay[lane]) || 0) * stepQ;
      for (let i = 0; i < steps; i++) {
        if (pat[i] === '.') continue;
        const q = b * g.barQ + i * stepQ + lay;
        ev.push({ q, t: q * g.spq, kind: lane === 'H' && pat[i] === 'o' ? 'O' : lane, vel: VEL[pat[i]] });
      }
    }
  }
  return ev.sort((a, b) => a.q - b.q); // kararlı sıralama: aynı anda K, S, H … sırası korunur
}
function renderDrums(events, sr, length, gain = 1, preparedBank = null) {
  const out = new Float32Array(length), bank = {};
  for (const e of events) {
    const s = preparedBank?.[e.kind] || bank[e.kind] || (bank[e.kind] = synthDrum(e.kind, sr));
    const a = Math.round(e.t * sr);
    for (let i = 0; i < s.length && a + i < length; i++) if (a + i >= 0) out[a + i] += s[i] * e.vel * gain;
  }
  return out;
}
const GM_DRUM = { K: 36, S: 38, H: 42, O: 46, F: 41, T: 47, C: 39, R: 37, D: 51, P: 44 };
const DRUM_KINDS = Object.keys(GM_DRUM);
// ızgara metni (gösterim): her satır bir enstrüman, | vuruş ayracı; boş şeritler gösterilmez (kick hep), fill ayrı blok
function loopGridText(L) {
  const spb = L.spb, row = (s) => s.match(new RegExp(`.{1,${spb}}`, 'g')).join('|');
  const used = (src) => LANES.filter((k) => src[k] && (k === 'K' || /[^.]/.test(src[k])));
  const fillLanes = L.fill ? LANES.filter((k) => L.fill.lanes[k]) : [];
  const w = Math.max(8, ...used(L).concat(fillLanes).map((k) => LANE_NAME[k].length + 1));
  const rows = (src, lanes) => lanes.map((k) => `${LANE_NAME[k].padEnd(w)}|${row(src[k])}|`).join('\n');
  let t = rows(L, used(L));
  if (L.fill) t += `\n\nFill (her ${L.fill.every}. ölçü):\n` + rows(L.fill.lanes, fillLanes);
  if (L.lay) t += '\n\nGecikme: ' + Object.keys(L.lay).map((k) => `${LANE_NAME[k]} adımın %${Math.round(L.lay[k] * 100)}'i kadar geriden`).join(', ');
  return t;
}

Object.assign(C, { estimateMeter, DRUM_LOOPS, DRUM_CATS: CATS, DRUM_KINDS, LANES, parsePattern, loopLabel, loopsFor, suggestDrumLoop, synthDrum, drumEvents, renderDrums, GM_DRUM, loopGridText, loopProfile });
})(typeof window !== 'undefined' ? window : globalThis);

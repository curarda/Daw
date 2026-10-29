// ---------------------------------------------------------------- MİKS ÇÖZÜMLEME: hazır bir miksten (vokal + akor + davul) tempo, ölçü başı, akorlar, ton ve kick konumları
// DOM'suz; Core'a eklenir. Amaç: .wav miksi olduğu gibi çalıp üstüne bas (ve istenirse başka katman) üretebilmek.
// 1) Onset zarfı (spektral akı): tempo (öz-ilinti + ızgara uydurma), ölçü başı fazı (düşük bant = kick vurgusu).
// 2) Kroma (log sıkıştırılmış, 55–2200 Hz) ve bas kromasi: ölçü / yarım ölçü başına akor (şablon + Viterbi), sonra tona göre ikinci geçiş.
// 3) Düşük bantta onset tepeleri → ölçü başına 16'lık adımlarda kick konumları (bas groove'u bunlara kilitlenir).
(function (root) {
const C = root.Core;
const { clamp, mod12, METERS, CHORD_Q, makeGrid, getFFT, resample } = C;

const TARGET_SR = 11025;
const ONSET_N = 1024, ONSET_HOP = 128;
const CHROMA_N = 4096, CHROMA_HOP = 1024;
const hann = (n) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); return w; };

// ---------------------------------------------------------------- 1) ONSET ZARFI
function onsetEnvelopes(x, sr) {
  const N = ONSET_N, hop = ONSET_HOP, fft = getFFT(N), win = hann(N);
  const nF = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const re = new Float64Array(N), im = new Float64Array(N);
  const bin = (hz) => Math.round((hz * N) / sr);
  const allLo = bin(40), allHi = bin(4500), lowLo = bin(35), lowHi = bin(170);
  const env = new Float32Array(nF), low = new Float32Array(nF), prev = new Float64Array(N / 2);
  for (let f = 0; f < nF; f++) {
    const s = f * hop;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    let a = 0, l = 0;
    for (let k = allLo; k <= allHi; k++) {
      const m = Math.log(1 + 40 * Math.hypot(re[k], im[k]) / N * 8), d = m - prev[k];
      prev[k] = m;
      if (d > 0) { a += d; if (k >= lowLo && k <= lowHi) l += d; }
    }
    env[f] = a; low[f] = l;
  }
  return { env, low, hopSec: hop / sr, frames: nF };
}
const normalize = (v) => { let m = 0, s = 0; for (const a of v) m += a; m /= v.length; for (const a of v) s += (a - m) * (a - m); s = Math.sqrt(s / v.length) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = (v[i] - m) / s; return o; };
const at = (v, t) => { const i = Math.floor(t), f = t - i; return i < 0 || i >= v.length - 1 ? 0 : v[i] * (1 - f) + v[i + 1] * f; };

// ---------------------------------------------------------------- 2) TEMPO + FAZ
function estimateTempo(envN, hopSec, opts = {}) {
  const n = envN.length, lagOf = (bpm) => 60 / bpm / hopSec;
  const lagMin = Math.floor(lagOf(210)), lagMax = Math.ceil(lagOf(40) * 4);
  const R = new Float64Array(lagMax + 2);
  for (let lag = lagMin; lag <= Math.min(lagMax, n - 1); lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += envN[i] * envN[i + lag]; R[lag] = s / (n - lag); }
  let bpmHint = opts.bpm || null, best = null;
  const prior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.7, 2));
  if (!bpmHint) {
    for (let bpm = 55; bpm <= 200; bpm += 0.25) {
      const tau = lagOf(bpm), at1 = (l) => { const i = Math.floor(l); return R[i] * (1 - (l - i)) + R[i + 1] * (l - i); };
      const sc = (at1(tau) + 0.6 * at1(2 * tau) + 0.35 * at1(4 * tau) + 0.3 * at1(tau * 1.5)) * (0.4 + 0.6 * prior(bpm));
      if (!best || sc > best.sc) best = { bpm, sc };
    }
    bpmHint = best.bpm;
    while (bpmHint < 60) bpmHint *= 2; // yarım / çift tempo belirsizliği: 60–160 aralığı; kullanıcı ×2 / ÷2 ile düzeltebilir
    while (bpmHint >= 160) bpmHint /= 2;
  }
  // ızgara uydurma: bpm ± %4; her bpm için en iyi faz (vuruş + yarım vuruş zarf toplamı)
  const span = opts.bpm ? 0.006 : 0.04, step = opts.bpm ? 0.05 : 0.1;
  let fit = null;
  for (let bpm = bpmHint * (1 - span); bpm <= bpmHint * (1 + span) + 1e-9; bpm += step) {
    const T = lagOf(bpm), nb = Math.floor((n - 1) / T) - 1;
    if (nb < 4) continue;
    const phases = Math.max(8, Math.round(T));
    for (let p = 0; p < phases; p++) {
      const ph = (p / phases) * T;
      let s = 0;
      for (let k = 0; k < nb; k++) s += at(envN, ph + k * T) + 0.35 * at(envN, ph + (k + 0.5) * T);
      s /= nb;
      if (!fit || s > fit.s) fit = { s, bpm, ph, T };
    }
  }
  return fit ? { bpm: Math.round(fit.bpm * 10) / 10, phaseFrames: fit.ph, periodFrames: fit.T, score: fit.s, candidate: bpmHint } : null;
}

// ---------------------------------------------------------------- 3) KROMA
function chromaFrames(x, sr) {
  const N = CHROMA_N, hop = CHROMA_HOP, fft = getFFT(N), win = hann(N);
  const nF = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const re = new Float64Array(N), im = new Float64Array(N);
  const kLo = Math.ceil((55 * N) / sr), kHi = Math.floor((2200 * N) / sr), bassHi = Math.floor((250 * N) / sr), bassLo = Math.ceil((60 * N) / sr);
  const pcOf = new Int8Array(kHi + 1), wOf = new Float64Array(kHi + 1);
  for (let k = kLo; k <= kHi; k++) {
    const f = (k * sr) / N, m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), cents = Math.abs(m - r) * 100;
    pcOf[k] = mod12(r); wOf[k] = (cents < 35 ? 1 : 0.45) * (f < 130 ? 0.6 : f < 1000 ? 1 : 0.5);
  }
  const chroma = new Float32Array(nF * 12), bass = new Float32Array(nF * 12);
  for (let f = 0; f < nF; f++) {
    const s = f * hop;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = kLo; k <= kHi; k++) {
      const m = Math.log(1 + 60 * Math.hypot(re[k], im[k]) / N * 8);
      chroma[f * 12 + pcOf[k]] += m * wOf[k];
      if (k >= bassLo && k <= bassHi) bass[f * 12 + pcOf[k]] += m;
    }
  }
  return { chroma, bass, nF, hopSec: hop / sr, winSec: N / sr };
}

// ---------------------------------------------------------------- 4) AKOR ÇÖZME
const QUALS = [['', [0, 4, 7], [1, 0.85, 0.75]], ['m', [0, 3, 7], [1, 0.85, 0.75]], ['7', [0, 4, 7, 10], [1, 0.8, 0.7, 0.55]], ['maj7', [0, 4, 7, 11], [1, 0.8, 0.7, 0.55]], ['m7', [0, 3, 7, 10], [1, 0.8, 0.7, 0.55]]].filter((q) => q[0] === '' || CHORD_Q[q[0]]);
const STATES = []; for (let r = 0; r < 12; r++) for (const [q, iv, w] of QUALS) STATES.push({ root: r, q, iv, w });
function scoresFor(vec, bassVec) {
  const norm = Math.hypot(...vec) || 1, bn = Math.hypot(...bassVec) || 1, out = new Float64Array(STATES.length);
  // gürültü tabanı: ortalamanın altı yok sayılır (davul / vokal gürültüsü)
  const mean = vec.reduce((a, b) => a + b, 0) / 12, c = vec.map((v) => Math.max(0, v - 0.8 * mean));
  const cn = Math.hypot(...c) || 1;
  STATES.forEach((s, i) => {
    let dot = 0, tn = 0;
    s.iv.forEach((iv, j) => { const pc = (s.root + iv) % 12; dot += s.w[j] * c[pc]; tn += s.w[j] * s.w[j]; });
    const cos = dot / (cn * Math.sqrt(tn));
    out[i] = cos + 0.22 * (bassVec[s.root] / bn) - 0.012 * s.iv.length - (s.q === '' || s.q === 'm' ? 0 : s.iv.length === 4 ? 0.11 : 0.05);
  });
  return out;
}
function viterbi(seq, penalty, bonus) {
  const n = seq.length, S = STATES.length;
  if (!n) return [];
  let prev = Float64Array.from(seq[0]), back = [];
  if (bonus) for (let s = 0; s < S; s++) prev[s] += bonus[s];
  for (let t = 1; t < n; t++) {
    let bi = 0; for (let s = 1; s < S; s++) if (prev[s] > prev[bi]) bi = s;
    const cur = new Float64Array(S), bk = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      const stay = prev[s], move = prev[bi] - penalty;
      if (stay >= move) { cur[s] = stay; bk[s] = s; } else { cur[s] = move; bk[s] = bi; }
      cur[s] += seq[t][s] + (bonus ? bonus[s] : 0);
    }
    back.push(bk); prev = cur;
  }
  let s = 0; for (let k = 1; k < S; k++) if (prev[k] > prev[s]) s = k;
  const path = new Array(n); path[n - 1] = s;
  for (let t = n - 1; t > 0; t--) { s = back[t - 1][s]; path[t - 1] = s; }
  return path;
}
const stateKey = (s) => s;
const toChord = (i) => ({ root: STATES[i].root, q: STATES[i].q, bass: null });

// ---------------------------------------------------------------- TON: akorların ölçeğe uyumu + Krumhansl profili (şarkı kromasi) + ilk / son akor
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) { const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - ma) * (b[i] - mb); na += (a[i] - ma) ** 2; nb += (b[i] - mb) ** 2; } return d / (Math.sqrt(na * nb) || 1); }
function pickKey(cells, ch) {
  const list = cells.filter((c) => c.chord);
  if (!list.length) return null;
  const g = new Array(12).fill(0);
  for (let f = 0; f < ch.nF; f++) for (let p = 0; p < 12; p++) g[p] += ch.chroma[f * 12 + p] + 1.5 * ch.bass[f * 12 + p];
  let best = null;
  for (const mode of ['major', 'minor']) for (let tonic = 0; tonic < 12; tonic++) {
    const sc = new Set(C.scalePcs(tonic, mode)), prof = (mode === 'major' ? KS_MAJ : KS_MIN);
    let fit = 0;
    for (const c of list) { const pcs = (CHORD_Q[c.chord.q] || CHORD_Q['']).map((v) => (c.chord.root + v) % 12); fit += (c.half == null ? 1 : 0.5) * (pcs.filter((p) => sc.has(p)).length / pcs.length); }
    fit /= list.length;
    const rot = Array.from({ length: 12 }, (_, i) => prof[(i - tonic + 12) % 12]);
    let score = 1.4 * fit + 1.0 * corr(g, rot);
    if (list[0].chord.root === tonic) score += 0.12; if (list[list.length - 1].chord.root === tonic) score += 0.1;
    if ((CHORD_Q[list[0].chord.q] || [])[1] === 3 === (mode === 'minor') && list[0].chord.root === tonic) score += 0.05;
    if (!best || score > best.score) best = { score, tonic, mode };
  }
  return { tonic: best.tonic, mode: best.mode };
}

// ---------------------------------------------------------------- ANA İŞLEV
// data: tek kanal Float32Array, sr; opts: { meter, bpm (sabit tut), progress(x) }
function analyzeMix(data, sr, opts = {}) {
  const meter = opts.meter && METERS[opts.meter] ? opts.meter : '4/4', warnings = [];
  const spec = METERS[meter], beatsPerBar = Math.max(1, Math.round(spec.barQ / spec.pulseQ));
  const dur = data.length / sr;
  if (dur < 4) return { error: 'Dosya çok kısa (en az birkaç ölçü gerekir).' };
  { let pk = 0; for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > pk) pk = a; } if (pk < 1e-4) return { error: 'Dosya sessiz görünüyor (ses yok).' }; }
  const prog = (x) => { if (opts.progress) opts.progress(x); };
  const x = resample(data, sr, TARGET_SR); prog(0.1);
  // tempo
  const { env, low, hopSec } = onsetEnvelopes(x, TARGET_SR); prog(0.4);
  const envN = normalize(env), lowN = normalize(low);
  const ch = chromaFrames(x, TARGET_SR); prog(0.6);
  const frameT = (f) => f * hopSec + (ONSET_N / 2) / TARGET_SR; // onset çerçevesi merkezi (sn)
  const avgChroma = (a, z) => {
    const v = new Array(12).fill(0); let w = 0;
    for (let f = Math.max(0, Math.floor((a - ch.winSec / 2) / ch.hopSec)); f < ch.nF; f++) { const c = f * ch.hopSec + ch.winSec / 2; if (c >= z) break; if (c < a) continue; for (let q = 0; q < 12; q++) v[q] += ch.chroma[f * 12 + q]; w++; }
    return w ? v : null;
  };
  const cosv = (a, b) => { let d = 0, na = 0, nb2 = 0; for (let i = 0; i < 12; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb2 += b[i] * b[i]; } return d / (Math.sqrt(na * nb2) || 1); };
  // göreli sapma (ortalamaya oranla) ve alt sınır: dört vuruşta kick gibi eşit konumlarda gürültü büyütülmez
  const z = (v) => { const m = v.reduce((a, b2) => a + b2, 0) / v.length, sd = Math.max(Math.sqrt(v.reduce((a, b2) => a + (b2 - m) * (b2 - m), 0) / v.length), 0.25 * Math.abs(m), 1e-6); return v.map((a) => (a - m) / sd); };
  // bir tempo adayı için vuruş ızgarası + ölçü başı: kick / vurgu, "akor ölçünün içinde sabit, sınırında değişir" kontrastı ve dosya başına yakınlık
  const gridFor = (fixedBpm) => {
    const tempo = estimateTempo(envN, hopSec, { bpm: fixedBpm });
    if (!tempo) return null;
    const T = tempo.periodFrames, beatSecT = T * hopSec, nb = Math.floor((envN.length - 1 - tempo.phaseFrames) / T);
    const pos = new Array(beatsPerBar).fill(0), nov = new Array(beatsPerBar).fill(0), barS = beatSecT * beatsPerBar;
    for (let k = 1; k < nb; k++) pos[k % beatsPerBar] += at(lowN, tempo.phaseFrames + k * T) + 0.4 * at(envN, tempo.phaseFrames + k * T);
    for (let j = 0; j < beatsPerBar; j++) {
      let acc = 0, n = 0;
      for (let k = j; k + 2 * beatsPerBar <= nb; k += beatsPerBar) {
        const t = frameT(tempo.phaseFrames + k * T), A = avgChroma(t, t + barS / 2), B = avgChroma(t + barS / 2, t + barS), D = avgChroma(t + barS, t + 1.5 * barS);
        if (A && B && D) { acc += cosv(A, B) - cosv(B, D); n++; }
      }
      nov[j] = n ? acc / n : 0;
    }
    const firstT = (j) => { let t = frameT(tempo.phaseFrames) + j * beatSecT; t -= Math.floor((t + 0.25 * beatSecT) / barS) * barS; return t; };
    const zl = z(pos), zn = z(nov), zs = z(Array.from({ length: beatsPerBar }, (_, j) => -Math.abs(firstT(j))));
    let j0 = 0, bestJ = -Infinity;
    for (let j = 0; j < beatsPerBar; j++) { const sc = 0.5 * zl[j] + 1.6 * zn[j] + 0.7 * zs[j]; if (sc > bestJ) { bestJ = sc; j0 = j; } }
    return { tempo, bpm: tempo.bpm, beatSecT, j0, contrast: nov[j0], t0: frameT(tempo.phaseFrames) + j0 * beatSecT };
  };
  let grid = gridFor(opts.bpm);
  if (!grid) return { error: 'Tempo bulunamadı (dosyada belirgin vuruş yok).' };
  if (!opts.bpm) { // çift / yarım tempo: akorların ölçü içinde sabit kalma kontrastı daha yüksek olan ızgara seçilir
    for (const cand of [grid.bpm * 2, grid.bpm / 2]) {
      if (cand < 55 || cand > 185) continue;
      const alt = gridFor(cand);
      if (alt && alt.contrast > 0.05 && alt.contrast > grid.contrast * 1.2 + 0.005) { grid = alt; break; }
    }
  }
  const { tempo, bpm } = grid;
  const g = makeGrid({ bpm, meter }), barSec = g.barSec;
  let t0 = grid.t0;
  t0 -= Math.floor((t0 + 0.25 * grid.beatSecT) / barSec) * barSec; // [-çeyrek vuruş, bar − çeyrek vuruş)
  if (Math.abs(t0) < 0.045) t0 = 0;
  const offsetSec = Math.round(t0 * 1000) / 1000;
  // içerik sonu: 50 ms bloklarda ses seviyesi en yüksek değerin %3'ünün altına düşünce; sessiz kuyruk fazladan ölçü sayılmaz
  let endSec = dur;
  { const blk = Math.round(0.05 * TARGET_SR), rms = []; let mx = 0;
    for (let i = 0; i + blk <= x.length; i += blk) { let e = 0; for (let j = 0; j < blk; j++) e += x[i + j] * x[i + j]; const v = Math.sqrt(e / blk); rms.push(v); mx = Math.max(mx, v); }
    let last = rms.length - 1; while (last > 0 && rms[last] < 0.03 * mx) last--;
    endSec = Math.min(dur, (last + 1) * 0.05 + 0.3); }
  const bars = Math.max(2, Math.ceil((endSec - offsetSec) / barSec - 0.4));
  prog(0.8);
  // akorlar
  const per = g.split ? 2 : 1, unit = barSec / per;
  const segVec = (a, z) => { // [a, z) saniye: orta bölüm ağırlıklı ortalama
    const v = new Array(12).fill(0), b = new Array(12).fill(0), pad = 0.12 * (z - a);
    let wsum = 0;
    for (let f = 0; f < ch.nF; f++) {
      const c = f * ch.hopSec + ch.winSec / 2;
      if (c < a + pad || c >= z - pad) continue;
      for (let p = 0; p < 12; p++) { v[p] += ch.chroma[f * 12 + p]; b[p] += ch.bass[f * 12 + p]; }
      wsum++;
    }
    if (!wsum) { // çok kısa birim: en yakın çerçeve
      const f = clamp(Math.round(((a + z) / 2 - ch.winSec / 2) / ch.hopSec), 0, ch.nF - 1);
      for (let p = 0; p < 12; p++) { v[p] = ch.chroma[f * 12 + p]; b[p] = ch.bass[f * 12 + p]; }
    }
    return { v, b };
  };
  const barSeq = [], halfSeq = [];
  for (let bar = 0; bar < bars; bar++) {
    const a = offsetSec + bar * barSec, z = a + barSec;
    const w = segVec(a, z); barSeq.push(scoresFor(w.v, w.b));
    if (per === 2) { const h0 = segVec(a, a + unit), h1 = segVec(a + unit, z); halfSeq.push([scoresFor(h0.v, h0.b), scoresFor(h1.v, h1.b)]); }
  }
  let path = viterbi(barSeq, 0.12);
  // ton: ilk geçiş akorlarından; sonra ikinci geçiş diyatonik akorlara küçük bonus verir
  const cellsOf = (p) => p.map((s, i) => ({ bar: i + 1, half: null, chord: toChord(s), line: 0 }));
  let key = pickKey(cellsOf(path), ch);
  const pass1 = opts.debug ? { names: path.map((i) => C.chordName(toChord(i))), key } : null;
  if (key) {
    const sc = new Set(C.scalePcs(key.tonic, key.mode)), bonus = new Float64Array(STATES.length);
    STATES.forEach((s, i) => { const pcs = s.iv.map((v) => (s.root + v) % 12), inKey = pcs.filter((p) => sc.has(p)).length / pcs.length; bonus[i] = 0.07 * inKey + (s.root === key.tonic ? 0.02 : 0); });
    path = viterbi(barSeq, 0.12, bonus);
    key = pickKey(cellsOf(path), ch) || key;
  }
  // 4/4: bir ölçü iki akorsa böl (iki yarım da ölçü akorundan açıkça daha iyi uyuyorsa)
  const cells = [];
  path.forEach((s, i) => {
    const bar = i + 1;
    if (per === 2 && halfSeq[i]) {
      let b0 = 0, b1 = 0; for (let k = 1; k < STATES.length; k++) { if (halfSeq[i][0][k] > halfSeq[i][0][b0]) b0 = k; if (halfSeq[i][1][k] > halfSeq[i][1][b1]) b1 = k; }
      const gain = halfSeq[i][0][b0] + halfSeq[i][1][b1] - halfSeq[i][0][s] - halfSeq[i][1][s];
      // iki yarım da kendi akoruna güçlü uymalı ve en az biri ölçü akoruna belirgin biçimde daha iyi uymalı (komşu / ilişkili akorlar arasında gereksiz bölme olmasın)
      const fit = halfSeq[i][0][b0] >= 0.8 && halfSeq[i][1][b1] >= 0.8 && (halfSeq[i][0][b0] - halfSeq[i][0][s] > 0.18 || halfSeq[i][1][b1] - halfSeq[i][1][s] > 0.18);
      if (b0 !== b1 && gain > 0.15 && fit && STATES[b0].root !== STATES[b1].root) {
        cells.push({ bar, half: 0, chord: toChord(b0), line: 0 }, { bar, half: 1, chord: toChord(b1), line: 0 });
        return;
      }
    }
    cells.push({ bar, half: null, chord: toChord(s), line: 0 });
  });
  // kick: düşük bant onset tepeleri; düşük bant payı yüksek olanlar kick (trampetin gövdesi de düşük bantta bir miktar enerji verir)
  const stepsPerBar = Math.round(spec.barQ / 0.25), stepSec = barSec / stepsPerBar;
  const lowMean = lowN.reduce((a, b) => a + b, 0) / lowN.length, thr = lowMean + 1.1, peaks = [];
  for (let f = 2; f < lowN.length - 2; f++) {
    const v = lowN[f];
    if (v < thr || v < lowN[f - 1] || v < lowN[f + 1] || v < lowN[f - 2] || v < lowN[f + 2]) continue;
    peaks.push({ f, share: low[f] / (env[f] + 1e-9), t: f * hopSec + (ONSET_N / 2) / TARGET_SR - offsetSec });
  }
  const shares = peaks.map((k) => k.share).sort((a, b) => a - b), cut = shares.length ? 0.6 * shares[Math.floor(shares.length * 0.85)] : 0;
  const kicks = Array.from({ length: bars }, () => []);
  for (const pk of peaks) {
    if (pk.share < cut) continue;
    let bar = Math.floor(pk.t / barSec + 1e-9), s = Math.round((pk.t - bar * barSec) / stepSec);
    const dev = Math.abs(pk.t - bar * barSec - s * stepSec);
    if (s >= stepsPerBar) { s = 0; bar += 1; } // ölçü çizgisinden hemen önceki vuruş sonraki ölçünün başıdır
    if (bar < 0 || bar >= bars || s < 0 || dev > 0.4 * stepSec) continue;
    if (!kicks[bar].includes(s)) kicks[bar].push(s);
  }
  kicks.forEach((k) => k.sort((a, b) => a - b));
  // güven: ızgara uyum gücü (zarf standart sapma biriminde)
  const confidence = Math.round(clamp(tempo.score / 1.6, 0, 1) * 100) / 100;
  if (confidence < 0.35) warnings.push('Tempo düşük güvenle bulundu; 1. adımdan BPM değerini düzeltip "Miksi yeniden çöz" demek daha iyi olabilir.');
  prog(1);
  return { meta: { bpm, meter }, offsetSec, bars, cells, key, kicks, sections: [], errors: [], warnings, confidence, source: 'audio', usedTracks: [], ...(pass1 ? { pass1 } : {}) };
}

Object.assign(C, { analyzeMix, estimateTempoFromEnv: estimateTempo, mixChordScores: scoresFor, MIX_CHORD_STATES: STATES });
})(typeof window !== 'undefined' ? window : globalThis);

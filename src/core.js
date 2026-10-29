/* =====================================================================
   MINI DAW ÇEKİRDEĞİ — DOM'dan bağımsız. Tarayıcıda window.Core,
   Node'da module.exports olarak kullanılır (testler bunu çalıştırır).
   ===================================================================== */
(function (root) {
'use strict';

// ---------------------------------------------------------------- yardımcılar
const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const mod12 = (x) => ((x % 12) + 12) % 12;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function median(arr) {
  const a = [];
  for (const v of arr) if (Number.isFinite(v)) a.push(v);
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}
function percentile(arr, p) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[clamp(Math.round(p * (a.length - 1)), 0, a.length - 1)];
}
const pcName = (pc, flats) => (flats ? PC_FLAT : PC_SHARP)[mod12(pc)];
const noteName = (m, flats) => {
  const r = Math.round(m);
  return pcName(r, flats) + (Math.floor(r / 12) - 1);
};
function parsePc(s) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)/.exec(s || '');
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return { pc: mod12(base + acc), len: m[0].trimStart().length };
}
const yieldTick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- ölçü / grid
// Tüm müzikal zaman "q" (çeyrek nota) biriminde. BPM = vuruş (pulse) temposu:
// 4/4, 3/4 ve 2/4'te çeyrek, 6/8'de noktalı çeyrek.
const METERS = {
  '4/4': { barQ: 4, pulseQ: 1, strong: [2], split: 2, clickQ: 1, accents: [0] },
  '2/4': { barQ: 2, pulseQ: 1, strong: [], split: 1, clickQ: 1, accents: [0] },
  '3/4': { barQ: 3, pulseQ: 1, strong: [], split: null, clickQ: 1, accents: [0] },
  '6/8': { barQ: 3, pulseQ: 1.5, strong: [1.5], split: 1.5, clickQ: 0.5, accents: [0, 1.5] },
};
// Click deseni. 'normal': 1. vuruş vurgulu. 'halftime' (yalnızca 4/4, yarım zaman hissi):
// davulun trampeti 3. vuruşta — "tık tık tıss tık"; 1. vuruş diğer tıklarla aynı.
const CLICK_FEELS = { normal: '1. vuruş vurgulu', halftime: '3. vuruş vurgulu — yarım zaman (tık tık tıss tık)' };
function clickKind(g, inBarQ, feel = 'normal') {
  const at = (x) => Math.abs(inBarQ - x) < 1e-6;
  if (feel === 'halftime' && g.meter === '4/4') return at(2) ? 'snare' : 'weak';
  if (at(0)) return 'down';
  return g.accents.some(at) ? 'acc' : 'weak';
}
function makeGrid(settings) {
  const m = METERS[settings.meter] || METERS['4/4'];
  const pulseSec = 60 / settings.bpm;
  const spq = pulseSec / m.pulseQ;
  return Object.assign({}, m, { meter: settings.meter, bpm: settings.bpm, spq, pulseSec, barSec: m.barQ * spq, quarterBpm: 60 / spq });
}

// ---------------------------------------------------------------- ALT BÖLME / SWING
// r = vuruşun "ve"sinin (zayıf sekizliğin) vuruş içindeki yeri: 0,5 düz · 0,667 üçleme (her vuruş 3'e bölünür, 12/8 hissi) ·
// arası swing (ör. %70 ölçülmüş shuffle). Vuruş içi konum parçalı doğrusal eşlenir: anchor (içeriğin kendi "ve" yeri; düz ızgarada 0,5,
// üçleme ızgarasında 2/3) → r. Yalnızca çeyrek vuruşlu ölçülerde (4/4, 3/4, 2/4); 6/8'in vuruşu zaten üçe bölünür.
// Üçleme içeriği (anchor 2/3) r < 0,55 iken (düz proje) olduğu gibi kalır: shuffle loop'u düz projede de üçleme çalar.
function swingMap(q, g, r, anchor = 0.5) {
  if (!r || g.pulseQ !== 1 || Math.abs(r - anchor) < 1e-9 || (anchor > 0.6 && r < 0.55)) return q;
  const k = Math.floor(q + 1e-9), f = q - k;
  return k + (f < anchor ? f * (r / anchor) : r + (f - anchor) * ((1 - r) / (1 - anchor)));
}
function swingUnmap(q, g, r, anchor = 0.5) {
  if (!r || g.pulseQ !== 1 || Math.abs(r - anchor) < 1e-9 || (anchor > 0.6 && r < 0.55)) return q;
  const k = Math.floor(q + 1e-9), f = q - k;
  return k + (f < r ? f * (anchor / r) : anchor + (f - r) * ((1 - anchor) / (1 - r)));
}
// Melodinin swing oranı: ölçü içindeki zayıf vuruşa düşen (vuruşun %40–85'i) nota başlangıçlarının medyanı. notes: {q0}; ızgara hizalı olmalı
function estimateSwing(notes, g) {
  if (g.pulseQ !== 1) return null;
  const phis = notes.map((n) => n.q0 - Math.floor(n.q0 + 1e-9));
  const off = phis.filter((f) => f > 0.42 && f < 0.85).sort((a, b) => a - b);
  if (phis.length < 8 || off.length < 4) return null;
  const med = off.length % 2 ? off[(off.length - 1) / 2] : (off[off.length / 2 - 1] + off[off.length / 2]) / 2;
  const mad = off.map((f) => Math.abs(f - med)).sort((a, b) => a - b)[Math.floor(off.length / 2)];
  return { ratio: Math.max(0.5, med), raw: med, n: off.length, of: phis.length, spread: mad, confident: off.length >= 6 && mad < 0.06 }; // oran en az %50 (daha erken = düz)
}

// ---------------------------------------------------------------- mod / scale
const MODES = {
  major:         { name: 'Majör (İyonyen)',      short: 'majör',        steps: [0, 2, 4, 5, 7, 9, 11], prior: 1.0,  parent: 0 },
  minor:         { name: 'Doğal minör (Eolyen)', short: 'minör',        steps: [0, 2, 3, 5, 7, 8, 10], prior: 1.0,  parent: 3 },
  harmonicMinor: { name: 'Harmonik minör',       short: 'harmonik minör', steps: [0, 2, 3, 5, 7, 8, 11], prior: 0.88, parent: 3 },
  dorian:        { name: 'Dorian',               short: 'Dorian',       steps: [0, 2, 3, 5, 7, 9, 10], prior: 0.95, parent: 10 },
  phrygian:      { name: 'Frig',                 short: 'Frig',         steps: [0, 1, 3, 5, 7, 8, 10], prior: 0.95, parent: 8 },
  lydian:        { name: 'Lidya',                short: 'Lidya',        steps: [0, 2, 4, 6, 7, 9, 11], prior: 0.9,  parent: 7 },
  mixolydian:    { name: 'Miksolidya',           short: 'Miksolidya',   steps: [0, 2, 4, 5, 7, 9, 10], prior: 0.95, parent: 5 },
  locrian:       { name: 'Lokriyen',             short: 'Lokriyen',     steps: [0, 1, 3, 5, 6, 8, 10], prior: 0.8,  parent: 1 },
  majorPent:     { name: 'Majör pentatonik',     short: 'majör pent.',  steps: [0, 2, 4, 7, 9],        prior: 0.85, parent: 0, hepta: 'major' },
  minorPent:     { name: 'Minör pentatonik',     short: 'minör pent.',  steps: [0, 3, 5, 7, 10],       prior: 0.85, parent: 3, hepta: 'minor' },
};
const MODE_ORDER = Object.keys(MODES);
const FLAT_PARENTS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db majör aileleri
const scalePcs = (tonic, mode) => MODES[mode].steps.map((s) => mod12(tonic + s));
const keyUsesFlats = (tonic, mode) => tonic != null && mode && FLAT_PARENTS.has(mod12(tonic + MODES[mode].parent));
const keyName = (tonic, mode) => `${pcName(tonic, keyUsesFlats(tonic, mode))} ${MODES[mode].short}`;

// ---------------------------------------------------------------- FFT
const fftCache = new Map();
function getFFT(n) {
  if (fftCache.has(n)) return fftCache.get(n);
  const levels = Math.round(Math.log2(n));
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b); rev[i] = r; }
  const fft = (re, im, inverse) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const c = cos[k], s = inverse ? sin[k] : -sin[k];
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
  fftCache.set(n, fft);
  return fft;
}
const nextPow2 = (x) => 1 << Math.ceil(Math.log2(Math.max(2, x)));

// ---------------------------------------------------------------- yeniden örnekleme
function resample(x, srIn, srOut) {
  if (srIn === srOut) return Float32Array.from(x);
  let src = x;
  if (srOut < srIn) { // pencereli-sinc alçak geçiren
    const fc = (0.45 * srOut) / srIn, taps = 48;
    const h = new Float64Array(2 * taps + 1);
    let sum = 0;
    for (let k = -taps; k <= taps; k++) {
      const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / taps) + 0.08 * Math.cos((2 * Math.PI * k) / taps);
      const v = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
      h[k + taps] = v * w; sum += v * w;
    }
    for (let k = 0; k < h.length; k++) h[k] /= sum;
    src = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let acc = 0;
      const k0 = Math.max(-taps, i - x.length + 1), k1 = Math.min(taps, i);
      for (let k = k0; k <= k1; k++) acc += h[k + taps] * x[i - k];
      src[i] = acc;
    }
  }
  const n = Math.floor((x.length * srOut) / srIn);
  const out = new Float32Array(n), r = srIn / srOut;
  for (let i = 0; i < n; i++) {
    const p = i * r, i0 = Math.floor(p), f = p - i0;
    out[i] = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
  }
  return out;
}

// ---------------------------------------------------------------- PITCH (pYIN benzeri)
// Beta(2,18) eşik dağılımı — pYIN'deki gibi her eşik için YIN seçimi yapılır,
// olasılıklar adaylarda toplanır, sonra Viterbi ile en olası yol seçilir.
const BETA_CDF = (() => {
  const N = 1000, pdf = new Float64Array(N + 1), cdf = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { const x = i / N; pdf[i] = x * Math.pow(1 - x, 17); }
  for (let i = 1; i <= N; i++) cdf[i] = cdf[i - 1] + 0.5 * (pdf[i] + pdf[i - 1]);
  for (let i = 0; i <= N; i++) cdf[i] /= cdf[N];
  return cdf;
})();
const betaCdf = (v) => {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  const x = v * 1000, i = Math.floor(x), f = x - i;
  return BETA_CDF[i] * (1 - f) + BETA_CDF[i + 1] * f;
};

const PITCH_DEFAULTS = { fmin: 65, fmax: 1000, silenceDb: -45, hopMs: 5, analysisSr: 16000 };

async function detectPitch(signal, sr, opts = {}, onProgress) {
  const o = Object.assign({}, PITCH_DEFAULTS, opts);
  const a = o.analysisSr;
  const x = resample(signal, sr, a);
  const hop = Math.max(1, Math.round((a * o.hopMs) / 1000));
  const hopSec = hop / a;
  const W = Math.round(a * 0.03);
  const tauMin = Math.max(2, Math.floor(a / o.fmax));
  const tauMax = Math.ceil(a / o.fmin);
  const L = W + tauMax + 2;
  const N = nextPow2(L);
  const fft = getFFT(N);
  const nF = Math.max(1, Math.ceil(x.length / hop));
  const K = 5;
  const candMidi = new Float32Array(nF * K), candP = new Float32Array(nF * K);
  const candN = new Uint8Array(nF), Pv = new Float32Array(nF), rms = new Float32Array(nF), aper = new Float32Array(nF);
  const re = new Float64Array(N), im = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
  const frame = new Float64Array(L), cum = new Float64Array(L + 1), dp = new Float64Array(tauMax + 2);
  let maxRms = 0;
  for (let f = 0; f < nF; f++) {
    const start = f * hop - (W >> 1);
    for (let j = 0; j < L; j++) { const idx = start + j; frame[j] = idx >= 0 && idx < x.length ? x[idx] : 0; }
    cum[0] = 0;
    for (let j = 0; j < L; j++) cum[j + 1] = cum[j] + frame[j] * frame[j];
    const e0 = cum[W];
    rms[f] = Math.sqrt(e0 / W);
    if (rms[f] > maxRms) maxRms = rms[f];
    if (e0 < 1e-10) { aper[f] = 1; continue; }
    // iki gerçek diziyi tek karmaşık FFT'de paketle: z = a + i·b
    for (let j = 0; j < N; j++) { re[j] = j < W ? frame[j] : 0; im[j] = j < L ? frame[j] : 0; }
    fft(re, im, false);
    for (let k = 0; k < N; k++) {
      const nk = (N - k) % N;
      const zr = re[k], zi = im[k], wr = re[nk], wi = im[nk];
      const Ar = 0.5 * (zr + wr), Ai = 0.5 * (zi - wi);
      const Br = 0.5 * (zi + wi), Bi = -0.5 * (zr - wr);
      rr[k] = Ar * Br + Ai * Bi; ri[k] = Ar * Bi - Ai * Br;
    }
    fft(rr, ri, true);
    // CMNDF
    let run = 0;
    dp[0] = 1;
    for (let t = 1; t <= tauMax + 1 && t + W <= L; t++) {
      const d = Math.max(0, e0 + (cum[t + W] - cum[t]) - 2 * rr[t]);
      run += d;
      dp[t] = run > 0 ? (d * t) / run : 1;
    }
    // adaylar (yerel minimumlar)
    const cands = [];
    let gmin = Infinity, gminIdx = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (dp[t] < dp[t - 1] && dp[t] <= dp[t + 1]) {
        const y0 = dp[t - 1], y1 = dp[t], y2 = dp[t + 1];
        const den = y0 - 2 * y1 + y2;
        const off = den > 1e-12 ? clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5) : 0;
        const val = y1 - 0.25 * (y0 - y2) * off;
        cands.push({ tau: t + off, val, p: 0 });
        if (val < gmin) { gmin = val; gminIdx = cands.length - 1; }
      }
    }
    aper[f] = Math.min(1, gmin);
    if (!cands.length) continue;
    let prevMin = 1, sumP = 0;
    for (const c of cands) {
      if (c.val < prevMin) { c.p = betaCdf(prevMin) - betaCdf(c.val); prevMin = c.val; }
    }
    cands[gminIdx].p += 0.01 * betaCdf(gmin);
    cands.sort((u, v) => v.p - u.p);
    let n = 0;
    for (const c of cands) {
      if (n >= K || c.p < 1e-4) break;
      candMidi[f * K + n] = hzToMidi(a / c.tau);
      candP[f * K + n] = c.p;
      sumP += c.p; n++;
    }
    candN[f] = n;
    Pv[f] = Math.min(0.999, sumP);
    if (onProgress && f % 400 === 0) { onProgress(0.9 * (f / nF)); await yieldTick(); }
  }
  // sessizlik kapısı
  const thr = Math.max(maxRms * Math.pow(10, o.silenceDb / 20), 1e-5);
  for (let f = 0; f < nF; f++) if (rms[f] < thr) { candN[f] = 0; Pv[f] = 0; }
  // Viterbi (aday durumları + sessiz durum)
  const S = K + 1, NEG = -1e30;
  let prev = new Float64Array(S).fill(NEG), cur = new Float64Array(S);
  const bp = new Int8Array(nF * S);
  prev[K] = 0; // baslangic: sessiz
  let prevN = 0;
  const lam = 0.35, sw = Math.log(0.02);
  for (let f = 0; f < nF; f++) {
    const n = candN[f];
    for (let s = 0; s < S; s++) cur[s] = NEG;
    for (let s = 0; s <= n; s++) {
      const si = s === n ? K : s;
      const voiced = s < n;
      const em = voiced ? Math.log(candP[f * K + s] + 1e-4) : Math.log(1 - Pv[f] + 1e-3);
      let best = NEG, arg = K;
      for (let ps = 0; ps <= prevN; ps++) {
        const psi = ps === prevN ? K : ps;
        if (prev[psi] <= NEG) continue;
        const pv = ps < prevN;
        let tr;
        if (voiced && pv) tr = -lam * Math.max(0, Math.abs(candMidi[f * K + s] - candMidi[(f - 1) * K + ps]) - 0.25);
        else if (voiced !== pv) tr = sw;
        else tr = 0;
        const v = prev[psi] + tr;
        if (v > best) { best = v; arg = psi; }
      }
      cur[si] = best + em;
      bp[f * S + si] = arg;
    }
    const t = prev; prev = cur; cur = t;
    prevN = n;
  }
  const f0 = new Float32Array(nF), prob = new Float32Array(nF);
  let s = K, best = NEG;
  for (let i = 0; i < S; i++) if (prev[i] > best) { best = prev[i]; s = i; }
  for (let f = nF - 1; f >= 0; f--) {
    if (s !== K && s < candN[f]) { f0[f] = midiToHz(candMidi[f * K + s]); prob[f] = candP[f * K + s]; }
    s = bp[f * S + s];
  }
  // çok kısa sesli parçaları at (nefes/çıtırtı)
  const minRun = Math.round(0.03 / hopSec);
  for (let f = 0; f < nF;) {
    if (f0[f] > 0) { let e = f; while (e < nF && f0[e] > 0) e++; if (e - f < minRun) for (let k = f; k < e; k++) f0[k] = 0; f = e; } else f++;
  }
  const rmsN = new Float32Array(nF);
  for (let f = 0; f < nF; f++) rmsN[f] = maxRms > 0 ? rms[f] / maxRms : 0;
  if (onProgress) onProgress(1);
  return { hopSec, f0, prob, rms: rmsN, aper, sr, analysisSr: a, duration: signal.length / sr };
}

// ---------------------------------------------------------------- NOTA SEGMENTASYONU
// tuning: 'auto' = kişisel akort referansı (genel sapma + zamanla kayma), 'a440' = sabit A4 = 440 Hz
const SEG_DEFAULTS = { minNoteMs: 70, changeSemis: 0.5, tuning: 'auto', tuningWindowSec: 8 };
function segmentNotes(track, opts = {}) {
  const o = Object.assign({}, SEG_DEFAULTS, opts);
  const hop = track.hopSec, n = track.f0.length;
  const minF = Math.max(3, Math.round(o.minNoteMs / 1000 / hop));
  const midi = new Float32Array(n);
  for (let i = 0; i < n; i++) midi[i] = track.f0[i] > 0 ? hzToMidi(track.f0[i]) : NaN;
  const rms = track.rms;
  // 1) sesli bölgeler (kısa boşluklar köprülenir)
  const bridge = Math.round(0.02 / hop);
  const runs = [];
  for (let i = 0; i < n;) {
    if (!(midi[i] === midi[i])) { i++; continue; }
    const a = i;
    let b = i;
    for (;;) {
      while (b < n && midi[b] === midi[b]) b++;
      let c = b;
      while (c < n && !(midi[c] === midi[c]) && c - b <= bridge) c++;
      if (c < n && c > b && c - b <= bridge && midi[c] === midi[c] && Math.abs(midi[c] - midi[b - 1]) < 0.8) { b = c; continue; }
      break;
    }
    runs.push([a, b]);
    i = b;
  }
  const segs = [];
  const K = Math.round(0.18 / hop), K2 = Math.round(0.12 / hop); // K ≈ bir vibrato periyodu
  for (const [a, b] of runs) {
    if (b - a < minF) continue;
    // boşlukları doldur + 5'li medyan filtre
    const s = new Float32Array(b - a);
    let last = NaN;
    for (let i = a; i < b; i++) { if (midi[i] === midi[i]) last = midi[i]; s[i - a] = last; }
    for (let i = s.length - 1, nx = NaN; i >= 0; i--) { if (s[i] === s[i]) nx = s[i]; else s[i] = nx; }
    const sm = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) sm[i] = median(s.subarray(Math.max(0, i - 2), Math.min(s.length, i + 3)));
    // 2) perde değişim noktaları: sol/sağ pencere medyan farkı
    const D = new Float32Array(s.length);
    for (let i = minF; i <= s.length - minF; i++) {
      const L = median(sm.subarray(Math.max(0, i - K), i));
      const R = median(sm.subarray(i, Math.min(s.length, i + K)));
      D[i] = Math.abs(L - R);
    }
    const peaks = [];
    for (let i = minF; i <= s.length - minF; i++) {
      if (D[i] >= o.changeSemis && D[i] >= (D[i - 1] || 0) && D[i] >= (D[i + 1] || 0)) peaks.push(i);
    }
    peaks.sort((p, q) => D[q] - D[p]);
    const cuts = [];
    for (const p of peaks) if (cuts.every((c) => Math.abs(c.i - p) >= minF)) cuts.push({ i: p, kind: 'pitch' });
    // sınırı en dik perde değişimine oturt
    for (const c of cuts) {
      let bi = c.i, bv = -1;
      for (let j = Math.max(1, c.i - 6); j <= Math.min(s.length - 1, c.i + 6); j++) {
        const v = Math.abs(sm[j] - sm[j - 1]);
        if (v > bv) { bv = v; bi = j; }
      }
      c.i = bi;
    }
    // 3) enerji çukurları (aynı perdede tekrar eden hece)
    for (let i = a + 3; i < b - 3; i++) {
      const r = rms[i];
      let lm = true;
      for (let k = -3; k <= 3; k++) if (rms[i + k] < r) { lm = false; break; }
      if (!lm) continue;
      let ml = 0, mr = 0;
      for (let k = Math.max(a, i - K2); k < i; k++) ml = Math.max(ml, rms[k]);
      for (let k = i + 1; k < Math.min(b, i + K2); k++) mr = Math.max(mr, rms[k]);
      if (r < 0.35 * Math.min(ml, mr) && cuts.every((c) => Math.abs(c.i - (i - a)) >= minF)) cuts.push({ i: i - a, kind: 'energy' });
    }
    cuts.sort((p, q) => p.i - q.i);
    const bounds = [{ i: 0, kind: 'run' }, ...cuts, { i: b - a, kind: 'run' }];
    for (let k = 0; k + 1 < bounds.length; k++) {
      let s0 = a + bounds[k].i, s1 = a + bounds[k + 1].i;
      // kenarlardaki düşük enerjili kareleri kırp
      let pk = 0;
      for (let i = s0; i < s1; i++) pk = Math.max(pk, rms[i]);
      while (s0 < s1 && rms[s0] < 0.15 * pk) s0++;
      while (s1 > s0 && rms[s1 - 1] < 0.15 * pk) s1--;
      segs.push({ f0i: s0, f1i: s1, splitBefore: bounds[k].kind });
    }
  }
  // 4) notalar: vibrato/kaymalara karşı çekirdek bölgenin medyanı
  const notes = [];
  for (const sg of segs) {
    const len = sg.f1i - sg.f0i;
    if (len < minF) continue;
    const trim = len >= 10 ? Math.floor(len * 0.15) : 0;
    const core = midi.subarray(sg.f0i + trim, sg.f1i - trim);
    let valid = 0;
    for (const v of core) if (v === v) valid++;
    if (valid < core.length * 0.5) continue;
    const med = median(core);
    const prevN = notes[notes.length - 1];
    if (prevN && sg.splitBefore === 'pitch' && sg.f0i - prevN.f1i <= 1 && Math.abs(prevN.median - med) < 0.4) {
      prevN.f1i = sg.f1i; // vibrato kaynaklı aşırı bölünme — birleştir
      const len2 = prevN.f1i - prevN.f0i, tr2 = Math.floor(len2 * 0.15);
      prevN.median = median(midi.subarray(prevN.f0i + tr2, prevN.f1i - tr2));
      continue;
    }
    notes.push({ f0i: sg.f0i, f1i: sg.f1i, median: med });
  }
  return notes.map((nt) => {
    const nearest = Math.round(nt.median);
    return {
      f0i: nt.f0i, f1i: nt.f1i,
      t0: nt.f0i * hop, t1: nt.f1i * hop,
      median: nt.median, nearest, cents: Math.round((nt.median - nearest) * 100),
    };
  });
}

// ---------------------------------------------------------------- KİŞİSEL AKORT REFERANSI
// Eşliksiz söyleyen biri çoğu zaman A4=440'a göre hafif kayık söyler ve zamanla kayar. Notanın kimliği
// (hangi yarım ses) bu kişisel referansa göre yuvarlanır. Genel sapma: dairesel ortalama (±50 cent
// sarmasına dayanıklı) + süre ağırlıklı medyan. Kayma: ±window saniyedeki notaların kayan medyanı.
// Medyan olduğu için tek bir bilerek pes/tiz nota referansı sürüklemez.
const wrap50 = (c) => ((((c + 50) % 100) + 100) % 100) - 50;
function weightedMedian(vals, ws) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return vals[i]; }
  return 0;
}
function tuningReference(notes, opts = {}) {
  const win = opts.windowSec ?? 8, minN = opts.minNotes ?? 6;
  const n = notes.length;
  if (!n) return { global: 0, perNote: [], driftMin: 0, driftMax: 0 };
  const d = notes.map((x) => (x.median - Math.round(x.median)) * 100);
  const w = notes.map((x) => Math.max(0.05, x.t1 - x.t0));
  let C = 0, S = 0;
  d.forEach((v, i) => { C += w[i] * Math.cos((2 * Math.PI * v) / 100); S += w[i] * Math.sin((2 * Math.PI * v) / 100); });
  const c0 = (Math.atan2(S, C) / (2 * Math.PI)) * 100;
  const global = c0 + weightedMedian(d.map((v) => wrap50(v - c0)), w);
  const t = notes.map((x) => 0.5 * (x.t0 + x.t1));
  let local = notes.map((_, i) => {
    const js = [];
    for (let j = 0; j < n; j++) if (Math.abs(t[j] - t[i]) <= win) js.push(j);
    if (js.length < minN) return 0;
    return Math.max(-30, Math.min(30, weightedMedian(js.map((j) => wrap50(d[j] - global)), js.map((j) => w[j]))));
  });
  local = local.map((v, i) => (local[Math.max(0, i - 1)] + v + local[Math.min(n - 1, i + 1)]) / 3);
  const perNote = local.map((v) => global + v);
  return { global, perNote, driftMin: Math.min(...local), driftMax: Math.max(...local), a4: 440 * Math.pow(2, global / 1200) };
}

// ---------------------------------------------------------------- bölüm tipi normalizasyonu
// Serbest bölüm adlarını ortak tiplere toplar: "Verse 2", "Kıta" → verse; "Nakarat", "Refrain" → chorus …
const SECTION_TYPES = ['intro', 'verse', 'prechorus', 'chorus', 'postchorus', 'bridge', 'instrumental', 'outro', 'other'];
const SECTION_TYPE_NAMES = { intro: 'Giriş', verse: 'Verse', prechorus: 'Ön nakarat', chorus: 'Nakarat', postchorus: 'Nakarat sonrası', bridge: 'Köprü', instrumental: 'Enstrümantal', outro: 'Çıkış', other: 'Diğer' };
const TYPE_PATTERNS = [
  ['prechorus', /(pre\s*-?\s*(chorus|nakarat|hook)|ön\s*-?\s*nakarat|on\s*-?\s*nakarat|build\s*-?\s*up|lift|channel)/],
  ['postchorus', /(post\s*-?\s*(chorus|nakarat)|nakarat\s*sonrasi|tag)/],
  ['chorus', /(chorus|nakarat|refrain|hook|koro)/],
  ['verse', /(verse|kıta|kita|couplet|strophe|^v\d*$)/],
  ['bridge', /(bridge|köprü|kopru|middle\s*8|middle\s*eight)/],
  ['intro', /(intro|giriş|giris|baslangic)/],
  ['outro', /(outro|çıkış|cikis|bitiş|bitis|coda|ending|final|kapanis)/],
  ['instrumental', /(solo|instrumental|enstrümantal|enstrumantal|interlude|ara\s*(müzik|bölüm)?|break(down)?|riff)/],
];
function normSectionType(s) {
  // "Intro" → tr küçük harfte "ıntro" olur; eşleştirmeden önce Türkçe harfleri ASCII'ye indir
  const t = String(s || '').toLocaleLowerCase('tr').trim()
    .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
  if (!t) return 'other';
  if (SECTION_TYPES.includes(t)) return t;
  for (const [type, re] of TYPE_PATTERNS) if (re.test(t)) return type;
  return 'other';
}

// ---------------------------------------------------------------- nota ağırlıkları
function metricPos(q, g) {
  const tol = 0.12 * g.pulseQ;
  const bar = Math.floor((q + tol) / g.barQ);
  const pos = q - bar * g.barQ;
  const near = (x) => Math.abs(pos - x) <= tol;
  const down = near(0);
  const strong = !down && g.strong.some(near);
  const onBeat = down || strong || Math.abs(pos / g.pulseQ - Math.round(pos / g.pulseQ)) * g.pulseQ <= tol;
  return { bar, pos, down, strong, onBeat };
}
// Akor bulma ağırlığı (şartname): 1. vuruş x3, diğer güçlü vuruş x2,
// bir vuruştan uzun x2, kısa geçiş notası x0.5
function chordWeight(n, g) {
  const mp = metricPos(n.q0, g);
  const dur = n.q1 - n.q0, tol = 0.12 * g.pulseQ;
  let w = 1;
  if (mp.down) w *= 3; else if (mp.strong) w *= 2;
  if (dur > g.pulseQ + tol * 0.5) w *= 2;
  else if (dur <= 0.5 * g.pulseQ + tol && !mp.down && !mp.strong) w *= 0.5;
  return w;
}
// Ton önerisi histogram ağırlığı: süre (vuruş) x metrik ağırlık
function histWeight(n, g) {
  const mp = metricPos(n.q0, g);
  const dur = Math.min(n.q1 - n.q0, 4 * g.pulseQ) / g.pulseQ;
  return dur * (mp.down ? 2 : mp.strong ? 1.5 : mp.onBeat ? 1.2 : 1);
}

// ---------------------------------------------------------------- TON / MOD ÖNERİSİ
function lastWeightedNote(notes, g) {
  if (!notes.length) return null;
  const sorted = [...notes].sort((p, q) => p.q0 - q.q0);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = sorted[i], mp = metricPos(n.q0, g);
    if (n.q1 - n.q0 >= g.pulseQ * 0.9 || mp.down || mp.strong) return n;
  }
  return sorted[sorted.length - 1];
}
const keyMidi = (n) => (n.label != null ? n.label : n.detMidi);
// prior: önceki bölümün tonu (yumuşak ton sürekliliği: aynı ton +0.08, aynı nota kümesi +0.04; kullanıcı onayı her zaman üstün)
function suggestKeys(notes, g, topK = 3, prior = null) {
  const h = new Float64Array(12);
  let total = 0;
  // perde sınıfı: etiket düzeltmesi varsa etiket, yoksa algılanan en yakın nota.
  // Ses düzeltmeleri (autotune/manuel) BİLEREK dahil değil — seçili scale'i kendi kendine doğrulamasın.
  for (const n of notes) { const w = histWeight(n, g); h[mod12(keyMidi(n))] += w; total += w; }
  if (total <= 0) return { candidates: [], hist: h, last: null };
  for (let i = 0; i < 12; i++) h[i] /= total;
  const lastN = lastWeightedNote(notes, g);
  const lastPc = lastN ? mod12(keyMidi(lastN)) : null;
  const firstStrong = [...notes].sort((p, q) => p.q0 - q.q0).find((n) => metricPos(n.q0, g).down);
  const all = [];
  for (let t = 0; t < 12; t++) {
    for (const mode of MODE_ORDER) {
      const md = MODES[mode];
      const set = new Set(scalePcs(t, mode));
      let inS = 0;
      for (let pc = 0; pc < 12; pc++) if (set.has(pc)) inS += h[pc];
      let s = inS - 2.0 * (1 - inS);
      s += 0.45 * h[t];
      if (set.has(mod12(t + 7))) s += 0.15 * h[mod12(t + 7)];
      const third = md.steps.includes(3) ? 3 : md.steps.includes(4) ? 4 : null;
      if (third != null) s += 0.1 * h[mod12(t + third)];
      if (lastPc === t) s += 0.25;
      if (firstStrong && mod12(keyMidi(firstStrong)) === t) s += 0.05;
      s -= (1 - md.prior) * 0.5;
      let continuity = null;
      if (prior && prior.tonic != null && prior.mode) {
        if (prior.tonic === t && prior.mode === mode) { s += 0.08; continuity = 'same'; }
        else if (scalePcs(prior.tonic, prior.mode).sort((p, q) => p - q).join() === [...set].sort((p, q) => p - q).join()) { s += 0.04; continuity = 'set'; }
      }
      all.push({ tonic: t, mode, score: s, pcs: [...set].sort((p, q) => p - q), continuity });
    }
  }
  all.sort((p, q) => q.score - p.score);
  const top = all.slice(0, topK);
  const maxS = top[0].score;
  for (const c of top) {
    c.name = keyName(c.tonic, c.mode);
    c.confidence = Math.round(100 * Math.exp(3 * (c.score - maxS)));
    c.sameNotesAs = top.filter((o) => o !== c && o.pcs.join() === c.pcs.join()).map((o) => o.name);
    c.endsOnTonic = lastPc === c.tonic;
  }
  return { candidates: top, hist: h, ambiguity: keyAmbiguity(top, h), prior, last: lastN ? { pc: lastPc, name: pcName(lastPc, keyUsesFlats(top[0].tonic, top[0].mode)), q0: lastN.q0 } : null };
}

// Ton adaylarının belirsizlik notları (melodi histogramı ya da akor histogramı için ortak):
//  • noDistinct: aynı merkez, farklı mod; ayıran notalar (ör. G / G#) hiç duyulmuyor → "ayırt edici nota yok"
//  • sameSet:    aynı nota kümesi, farklı merkez; merkez kanıtı zayıf → "merkez belirsiz"
function keyAmbiguity(cands, h, gap = 0.2) {
  const out = [];
  const top = cands[0];
  if (!top) return out;
  for (const c of cands.slice(1)) {
    if (c.tonic === top.tonic && c.mode !== top.mode) {
      const a = new Set(top.pcs), b = new Set(c.pcs);
      const diff = [...new Set([...a, ...b])].filter((p) => a.has(p) !== b.has(p));
      const w = diff.reduce((acc, p) => acc + (h[p] || 0), 0);
      if (w < 0.02) out.push({ type: 'noDistinct', a: top, b: c, pcs: diff, text: `Ayırt edici nota yok: ${keyName(top.tonic, top.mode)} ile ${keyName(c.tonic, c.mode)} arasındaki fark (${diff.map((p) => pcName(p, keyUsesFlats(top.tonic, top.mode))).join(' / ')}) hiç duyulmuyor; bu ikisi ayırt edilemiyor.` });
    } else if (c.tonic !== top.tonic && c.pcs.join() === top.pcs.join() && top.score - c.score < gap) {
      out.push({ type: 'sameSet', a: top, b: c, text: `Aynı nota kümesi, merkez belirsiz: ${keyName(top.tonic, top.mode)} ile ${keyName(c.tonic, c.mode)} aynı notaları kullanıyor; hangisinin merkez olduğuna dair kanıt zayıf.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- AUTOTUNE / DÜZELTME EĞRİSİ
// target: 'semitone' (varsayılan) = söylenen notanın en yakın yarım sesine çek, notanın kimliği ASLA değişmez;
//         'scale' = scale'in, 'custom' = bölümün izin verilen kümesinin en yakın notasına çek (kimliği değiştirebilir)
const AUTOTUNE_DEFAULTS = { enabled: false, target: 'semitone', amount: 100, retuneMs: 30, keepVibrato: true, skipChromatic: true, customSets: {} };
function normalizeCustomSets(autotune, sectionIds) {
  const sets = autotune && autotune.customSets;
  const ids = sectionIds == null ? null : new Set(sectionIds.filter((id) => id !== '_all'));
  if (ids && !ids.size) ids.add('_all');
  const customSets = {};
  if (sets && typeof sets === 'object' && !Array.isArray(sets)) {
    for (const [id, pcs] of Object.entries(sets)) {
      if (ids && !ids.has(id)) continue;
      Object.defineProperty(customSets, id, { value: Array.isArray(pcs) ? [...new Set(pcs.filter((pc) => Number.isInteger(pc) && pc >= 0 && pc <= 11))].sort((a, b) => a - b) : [], enumerable: true, writable: true, configurable: true });
    }
  }
  return Object.assign({}, autotune || {}, { customSets });
}
function customFillSet(notes, sectionId) {
  const durations = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    const duration = n.t1 - n.t0;
    if (n.section !== sectionId || !Number.isFinite(duration) || duration <= 0) continue;
    total += duration;
    if (Number.isInteger(n.nearest)) durations[mod12(n.nearest)] += duration;
  }
  return total > 0 ? durations.flatMap((duration, pc) => duration >= 0.03 * total ? [pc] : []) : [];
}
// bu kadar cent içinde söylenen nota "tam tonunda" sayılır (kişisel akort referansına göre)
const IN_TUNE_CENTS = 20;
function nearestScaleNote(m, pcs) {
  if (!pcs) return Math.round(m);
  let best = Math.round(m), bd = Infinity;
  for (let k = Math.floor(m) - 6; k <= Math.ceil(m) + 6; k++) {
    if (!pcs.includes(mod12(k))) continue;
    const d = Math.abs(k - m);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
function isChromaticPassing(i, notes, pcs, g) {
  const n = notes[i], p = notes[i - 1], x = notes[i + 1];
  if (!pcs || !p || !x) return false;
  if (pcs.includes(mod12(n.nearest))) return false;
  if (n.q1 - n.q0 > g.pulseQ + 1e-6) return false;
  if (n.q0 - p.q1 > 0.5 * g.pulseQ || x.q0 - n.q1 > 0.5 * g.pulseQ) return false;
  const d1 = n.nearest - p.nearest, d2 = x.nearest - n.nearest;
  return d1 !== 0 && Math.sign(d1) === Math.sign(d2) && Math.abs(d1) <= 2 && Math.abs(d2) <= 2 && (Math.abs(d1) === 1 || Math.abs(d2) === 1);
}
// notes: zaman sıralı, her birinde { f0i, f1i, median, nearest, section, scalePcs, locked, manualTarget }
function computeCorrection(track, notes, at, g) {
  const nF = track.f0.length, hop = track.hopSec;
  const shift = new Float32Array(nF);
  const info = notes.map(() => ({ target: null, source: 'none', applied: 0, chromatic: false, identityChange: false }));
  notes.forEach((n, i) => {
    let target = null, tau, amount, keepVib;
    if (n.manualTarget != null) {
      target = n.manualTarget; tau = 0.01; amount = 1; keepVib = true; info[i].source = 'manual';
    } else if (at.enabled && !n.locked) {
      if (at.target === 'custom') {
        const pcs = n.section != null && at.customSets && Object.prototype.hasOwnProperty.call(at.customSets, n.section) ? at.customSets[n.section] : null;
        if (!Array.isArray(pcs) || !pcs.length) return;
        target = nearestScaleNote(n.median - (n.refCents || 0) / 100, pcs);
        info[i].identityChange = target !== n.nearest;
      } else if (at.target === 'scale') {
        if (at.skipChromatic && isChromaticPassing(i, notes, n.scalePcs, g)) { info[i].chromatic = true; return; }
        target = nearestScaleNote(n.median - (n.refCents || 0) / 100, n.scalePcs); // kişisel akort referansına göre
        info[i].identityChange = target !== n.nearest; // scale'e çekme notayı başka yarım sese taşıdı
      } else target = n.nearest; // en yakın yarım ses: tonlama düzeltmesi, kimlik aynı
      tau = at.retuneMs / 1000; amount = at.amount / 100; keepVib = at.keepVibrato; info[i].source = 'auto';
    }
    if (target == null) return;
    info[i].target = target;
    const alpha = tau > 0 ? 1 - Math.exp(-hop / tau) : 1;
    let y = 0, e = 0;
    for (let f = n.f0i; f < n.f1i; f++) {
      const m = track.f0[f] > 0 ? hzToMidi(track.f0[f]) : NaN;
      if (keepVib) e = (target - n.median) * 100;
      else if (m === m) e = (target - m) * 100;
      y += alpha * (e - y);
      shift[f] = y * amount;
    }
  });
  // kısa yumuşatma (nota geçişlerinde tıkırtı olmasın)
  const out = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const j = f + k; if (j >= 0 && j < nF) { s += shift[j]; c++; } }
    out[f] = track.f0[f] > 0 || shift[f] !== 0 ? s / c : 0;
  }
  notes.forEach((n, i) => {
    const len = n.f1i - n.f0i, tr = Math.floor(len * 0.15);
    info[i].applied = median(out.subarray(n.f0i + tr, Math.max(n.f0i + tr + 1, n.f1i - tr))) || 0;
  });
  return { shift: out, info, hopSec: hop };
}

// ---------------------------------------------------------------- TD-PSOLA PERDE KAYDIRMA
// Perde işaretleri algılanan f0'dan; tanecikler (grain) orijinal periyotlarla
// alındığı için spektral zarf (formantlar) korunur.
function psolaShift(x, sr, track, shiftCents, onProgress) {
  const n = x.length, hop = track.hopSec, nF = track.f0.length;
  const fAt = (i) => Math.min(nF - 1, Math.max(0, Math.round(i / sr / hop)));
  const f0At = (i) => {
    const p = i / sr / hop, a = Math.floor(p), fr = p - a;
    const f1 = track.f0[clamp(a, 0, nF - 1)], f2 = track.f0[clamp(a + 1, 0, nF - 1)];
    if (f1 > 0 && f2 > 0) return f1 * (1 - fr) + f2 * fr;
    return f1 > 0 ? f1 : f2;
  };
  const shAt = (i) => {
    const p = i / sr / hop, a = Math.floor(p), fr = p - a;
    return (shiftCents[clamp(a, 0, nF - 1)] || 0) * (1 - fr) + (shiftCents[clamp(a + 1, 0, nF - 1)] || 0) * fr;
  };
  // tepe seçimi için alçak geçirilmiş sinyal
  const lp = new Float32Array(n);
  const al = 1 - Math.exp((-2 * Math.PI * 900) / sr);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < n; i++) { z1 += al * (x[i] - z1); z2 += al * (z1 - z2); lp[i] = z2; }
  // sesli bölgeler (örnek cinsinden)
  const regions = [];
  for (let f = 0; f < nF;) {
    if (track.f0[f] > 0) { let e = f; while (e < nF && track.f0[e] > 0) e++; regions.push([Math.floor(f * hop * sr), Math.min(n, Math.floor(e * hop * sr))]); f = e; } else f++;
  }
  const Pu = Math.round(0.005 * sr);
  const marks = [], voicedMark = [];
  let pos = 0;
  const pushUnvoiced = (from, to) => { for (let p = from; p < to; p += Pu) { marks.push(p); voicedMark.push(0); } };
  for (const [s0, s1] of regions) {
    const P0 = sr / f0At(s0);
    let best = s0, bv = -Infinity;
    for (let i = s0; i < Math.min(s1, s0 + P0); i++) if (lp[i] > bv) { bv = lp[i]; best = i; }
    pushUnvoiced(pos, best - Pu / 2);
    let m = best;
    marks.push(m); voicedMark.push(1);
    for (;;) {
      const f = f0At(m);
      if (!(f > 0)) break;
      const P = sr / f, pred = m + P;
      if (pred >= s1) break;
      let bi = Math.round(pred), bvv = -Infinity;
      for (let i = Math.round(pred - 0.2 * P); i <= Math.round(pred + 0.2 * P); i++) if (i > m && i < n && lp[i] > bvv) { bvv = lp[i]; bi = i; }
      m = bi;
      marks.push(m); voicedMark.push(1);
    }
    pos = m + Pu;
  }
  pushUnvoiced(pos, n + Pu);
  const M = marks.length;
  const out = new Float32Array(n);
  let t = marks[0], k = 0, iter = 0;
  while (t < n) {
    while (k + 1 < M && Math.abs(marks[k + 1] - t) <= Math.abs(marks[k] - t)) k++;
    const m = marks[k];
    const Lh = Math.max(8, k > 0 ? m - marks[k - 1] : marks[1] - m);
    const Rh = Math.max(8, k + 1 < M ? marks[k + 1] - m : Lh);
    const r = voicedMark[k] ? Math.pow(2, shAt(t) / 1200) : 1;
    const g = 1 / r, ti = Math.round(t);
    for (let j = -Lh; j < Rh; j++) {
      const si = m + j, oi = ti + j;
      if (si < 0 || si >= n || oi < 0 || oi >= n) continue;
      const w = j < 0 ? 0.5 + 0.5 * Math.cos((Math.PI * j) / Lh) : 0.5 + 0.5 * Math.cos((Math.PI * j) / Rh);
      out[oi] += x[si] * w * g;
    }
    t += Rh / r;
    if (onProgress && ++iter % 4000 === 0) onProgress(t / n);
  }
  // kaydırma olmayan yerlerde orijinali birebir kullan (yumuşak geçişli maske)
  const maskF = new Float32Array(nF);
  for (let f = 0; f < nF; f++) if (Math.abs(shiftCents[f]) > 0.5) for (let k2 = -4; k2 <= 4; k2++) if (f + k2 >= 0 && f + k2 < nF) maskF[f + k2] = 1;
  const maskS = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0, c = 0; for (let k2 = -3; k2 <= 3; k2++) { const j = f + k2; if (j >= 0 && j < nF) { s += maskF[j]; c++; } } maskS[f] = s / c; }
  for (let i = 0; i < n; i++) {
    const p = i / sr / hop, a = Math.floor(p), fr = p - a;
    const mk = maskS[clamp(a, 0, nF - 1)] * (1 - fr) + maskS[clamp(a + 1, 0, nF - 1)] * fr;
    out[i] = mk * out[i] + (1 - mk) * x[i];
  }
  void fAt;
  return out;
}

// ---------------------------------------------------------------- AKORLAR
const CHORD_Q = {
  '':      [0, 4, 7],
  'm':     [0, 3, 7],
  'dim':   [0, 3, 6],
  'aug':   [0, 4, 8],
  'maj7':  [0, 4, 7, 11],
  'm7':    [0, 3, 7, 10],
  '7':     [0, 4, 7, 10],
  'sus2':  [0, 2, 7],
  'sus4':  [0, 5, 7],
  'add9':  [0, 4, 7, 2],
  'madd9': [0, 3, 7, 2],
  'm7b5':  [0, 3, 6, 10],
  'dim7':  [0, 3, 6, 9],
  '6':     [0, 4, 7, 9],
  'm6':    [0, 3, 7, 9],
  'mMaj7': [0, 3, 7, 11],
  '9':     [0, 4, 7, 10, 2],
  'm9':    [0, 3, 7, 10, 2],
  'maj9':  [0, 4, 7, 11, 2],
  '5':     [0, 7],
};
const Q_ALIASES = {
  '': '', 'M': '', 'maj': '', 'major': '',
  'm': 'm', 'min': 'm', '-': 'm', 'minor': 'm',
  'dim': 'dim', '°': 'dim', 'o': 'dim',
  'aug': 'aug', '+': 'aug',
  'maj7': 'maj7', 'M7': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', 'ma7': 'maj7',
  'm7': 'm7', 'min7': 'm7', '-7': 'm7',
  '7': '7', 'dom7': '7',
  'sus2': 'sus2', 'sus4': 'sus4', 'sus': 'sus4',
  'add9': 'add9', 'add2': 'add9', '(add9)': 'add9',
  'madd9': 'madd9', 'm(add9)': 'madd9', 'madd2': 'madd9',
  'm7b5': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'm7-5': 'm7b5',
  'dim7': 'dim7', '°7': 'dim7', 'o7': 'dim7',
  '6': '6', 'm6': 'm6', 'mMaj7': 'mMaj7', 'm(maj7)': 'mMaj7', 'mmaj7': 'mMaj7',
  '9': '9', 'm9': 'm9', 'maj9': 'maj9', '5': '5',
};
const chordPcs = (c) => CHORD_Q[c.q].map((i) => mod12(c.root + i));
const chordKey = (c) => (c ? `${c.root}:${c.q}` : '');
const sameChord = (a, b) => !!a && !!b && a.root === b.root && a.q === b.q;
function chordName(c, flats) {
  if (!c) return '';
  let s = pcName(c.root, flats) + c.q;
  if (c.bass != null && c.bass !== c.root) s += '/' + pcName(c.bass, flats);
  return s;
}
function parseChord(str) {
  const s = (str || '').trim();
  const r = parsePc(s);
  if (!r) return null;
  let rest = s.slice(r.len).trim();
  let bass = null;
  const sl = rest.lastIndexOf('/');
  if (sl >= 0) {
    const b = parsePc(rest.slice(sl + 1));
    if (!b) return null;
    bass = b.pc; rest = rest.slice(0, sl).trim();
  }
  const q = Q_ALIASES[rest];
  if (q === undefined) return null;
  return { root: r.pc, q, bass };
}
function roleLabel(interval, q) {
  switch (mod12(interval)) {
    case 0: return 'kök';
    case 1: return 'b9';
    case 2: return q === 'sus2' ? '2' : '9';
    case 3: return q === '' || q === '7' || q === 'maj7' ? '#9' : 'b3';
    case 4: return '3';
    case 5: return q === 'sus4' ? '4' : '11';
    case 6: return 'b5';
    case 7: return '5';
    case 8: return '#5';
    case 9: return '6';
    case 10: return 'b7';
    case 11: return '7';
  }
  return '?';
}
const ROLE_CREDIT = { 0: 1, 3: 1, 4: 1, 7: 0.9, 6: 0.8, 8: 0.8, 10: 0.8, 11: 0.8, 2: 0.75, 5: 0.75, 9: 0.75, 1: 0.5 };
// renk notaları (7, 9/2, 11/4, 6): isteğe bağlı ek ceza (colorPenalty, varsayılan 0)
const COLOR_IVS = new Set([10, 11, 2, 5, 9]);

// Bölümün modundan diatonik aday akorlar
function diatonicChords(tonic, mode) {
  const md = MODES[mode];
  const heptaMode = md.hepta || mode;
  const sc = scalePcs(tonic, heptaMode);
  const set = new Set(sc);
  const out = [], seen = new Set();
  const add = (root, q, deg, variant) => {
    const c = { root, q, deg, variant };
    const k = chordKey(c);
    if (seen.has(k)) return;
    // Frig kuralı: ev akoru asla majör olmasın
    if (mode === 'phrygian' && root === tonic && CHORD_Q[q].includes(4)) return;
    if (!chordPcs(c).every((p) => set.has(p))) return;
    seen.add(k); out.push(c);
  };
  for (let d = 0; d < 7; d++) {
    const r = sc[d], i3 = mod12(sc[(d + 2) % 7] - r), i5 = mod12(sc[(d + 4) % 7] - r);
    let tri = null;
    if (i3 === 4 && i5 === 7) tri = '';
    else if (i3 === 3 && i5 === 7) tri = 'm';
    else if (i3 === 3 && i5 === 6) tri = 'dim';
    else if (i3 === 4 && i5 === 8) tri = 'aug';
    if (tri == null) continue;
    add(r, tri, d, false);
    if (tri === '') { add(r, 'maj7', d, true); add(r, 'add9', d, true); add(r, 'sus2', d, true); add(r, 'sus4', d, true); }
    if (tri === 'm') { add(r, 'm7', d, true); add(r, 'sus2', d, true); add(r, 'sus4', d, true); }
  }
  return out;
}
function homeChord(tonic, mode) {
  const c = diatonicChords(tonic, mode).find((x) => x.root === tonic && !x.variant);
  return c ? { root: c.root, q: c.q } : { root: tonic, q: 'm' };
}

// slot içindeki notalar ve ağırlıkları
function slotNotes(notes, q0, q1, g) {
  const out = [];
  for (const n of notes) {
    if (n.q1 <= q0 + 1e-6 || n.q0 >= q1 - 1e-6) continue;
    const tol = 0.12 * g.pulseQ;
    if (n.q0 >= q0 - tol && n.q0 < q1 - tol) out.push({ n, pc: mod12(n.effMidi), w: n.cw, carried: false });
    else if (n.q0 < q0) {
      const ov = Math.min(n.q1, q1) - q0;
      if (ov > 0.25 * g.pulseQ) out.push({ n, pc: mod12(n.effMidi), w: 0.5 * Math.min(ov / g.pulseQ, 1.5), carried: true });
    }
  }
  return out;
}
function scoreChord(c, sn, colorPenalty = 0) {
  const pcs = chordPcs(c);
  let s = 0, W = 0, friction = false, frictionW = 0;
  const used = new Set();
  const roles = [];
  for (const { pc, w } of sn) {
    W += w;
    const iv = mod12(pc - c.root);
    if (pcs.includes(pc)) {
      s += w * ((ROLE_CREDIT[iv] ?? 0.7) - (COLOR_IVS.has(iv) ? colorPenalty : 0));
      used.add(iv);
      roles.push({ pc, w, role: roleLabel(iv, c.q), tone: true });
    } else {
      const near = Math.min(...pcs.map((p) => Math.min(mod12(pc - p), mod12(p - pc))));
      if (near === 1) {
        s -= 2 * w;
        if (w >= 2) friction = true;
        frictionW += w;
        roles.push({ pc, w, role: roleLabel(iv, c.q) + ' (sürtünme)', tone: false, clash: true });
      } else {
        s -= 0.15 * w;
        roles.push({ pc, w, role: roleLabel(iv, c.q) + ' (gerilim)', tone: false });
      }
    }
  }
  // karmaşıklık: uzantı melodide kullanılmıyorsa hafif ceza
  const base = CHORD_Q[c.q];
  const ext = base.filter((i) => ![0, 3, 4, 7].includes(i));
  for (const e of ext) if (!used.has(e)) s -= 0.12 * W;
  if (c.q === 'dim' || c.q === 'aug' || c.q === 'm7b5' || c.q === 'dim7') s -= 0.3 * W; // düşük öncelik
  return { score: s, W, friction, frictionW, roles };
}
const commonTones = (a, b) => (a && b ? chordPcs(a).filter((p) => chordPcs(b).includes(p)).length : 0);

// changePct: X, maxBars: N, homeEvery: M (0 = kapalı), colorPenalty: renk notası cezası,
// engine: 'greedy' (ölçü ölçü) | 'viterbi' (süreli, bölüm boyunca, 3 alternatif), altChoice: { bölümId: alternatif no }
const CHORD_DEFAULTS = { changePct: 25, maxBars: 4, homeEvery: 2, colorPenalty: 0, engine: 'viterbi', altChoice: {} };
// sections: [{startBar,endBar,tonic,mode,...}] (1 tabanlı, dahil), notes: {q0,q1,effMidi,cw}
function buildChords(notes, sections, g, opts = {}, locks = []) {
  const o = Object.assign({}, CHORD_DEFAULTS, opts);
  if (o.engine === 'viterbi') return buildChordsViterbi(notes, sections, g, o, locks);
  const pct = o.changePct / 100;
  const slots = [];
  let prevChord = null;
  const lockAt = (bar, half) => locks.find((l) => l.bar === bar && (l.half ?? null) === half);
  const secs = [...sections].sort((p, q) => p.startBar - q.startBar);
  secs.forEach((sec, si) => {
    if (sec.tonic == null || !sec.mode) return;
    const cands = diatonicChords(sec.tonic, sec.mode);
    const home = homeChord(sec.tonic, sec.mode);
    const flats = keyUsesFlats(sec.tonic, sec.mode);
    let cur = null, curBars = 0, sinceHome = 0;
    // stil modeli (isteğe bağlı): toplam = melodi uyumu + λ·log P(geçiş) + renk puanı
    const sty = o.style || null;
    const hist = []; // bu bölümde çalınan ardışık farklı akorlar (stil bağlamı)
    const ctxFor = (pending) => {
      const h = pending && !sameChord(hist[hist.length - 1], pending) ? [...hist, pending] : hist;
      return [h[h.length - 1] || null, h[h.length - 2] || null];
    };
    const styleOf = (c, pending) => {
      if (!sty) return { value: 0, trans: 0, color: 0 };
      const [p1, p2] = ctxFor(pending);
      return sty.score(p1, p2, c, sec);
    };
    // sıcaklık > 0: en iyi 3 aday arasından puanla orantılı (softmax) örnekle
    const pick = (list) => {
      if (!sty || !sty.temperature || list.length < 2) return list[0];
      let pool = list.slice(0, 3).filter((x) => !x.friction);
      if (!pool.length) pool = list.slice(0, 3);
      const mx = Math.max(...pool.map((x) => x.total));
      const w = pool.map((x) => Math.exp((x.total - mx) / sty.temperature));
      let r = sty.rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
      return pool[pool.length - 1];
    };
    // ev akoru sayılır: tonik kökte ve ev üçlüsünü içeren akor (ör. C#m, C#m7)
    const homeThird = CHORD_Q[home.q].find((i) => i === 3 || i === 4);
    const isHome = (c) => !!c && c.root === home.root && (homeThird == null || CHORD_Q[c.q].includes(homeThird));
    for (let bar = sec.startBar; bar <= sec.endBar; bar++) {
      const q0 = (bar - 1) * g.barQ, q1 = q0 + g.barQ;
      const isFirst = bar === sec.startBar, isLast = bar === sec.endBar;
      const bn = slotNotes(notes, q0, q1, g);
      const evalAll = (sn, extra, pending) => {
        const Wt = sn.reduce((a, b) => a + b.w, 0);
        return cands.map((c) => {
          const r = scoreChord(c, sn, o.colorPenalty);
          let bonus = 0;
          if (sameChord(c, home)) bonus += 0.06 * Wt;
          if (c.deg === 3 || c.deg === 4) bonus += 0.02 * Wt;
          if (extra) bonus += extra(c, Wt);
          const st = styleOf(c, pending);
          return Object.assign({ chord: c, melody: r.score + bonus, style: st.value, styleTrans: st.trans, styleColor: st.color, total: r.score + bonus + st.value }, r);
        }).sort((p, q) => q.total - p.total);
      };
      const evalOne = (c, sn, extra, pending) => {
        const r = scoreChord(c, sn, o.colorPenalty);
        const Wt = r.W;
        let bonus = sameChord(c, home) ? 0.06 * Wt : 0;
        if (extra) bonus += extra(c, Wt);
        const st = styleOf(c, pending);
        return Object.assign({ chord: c, melody: r.score + bonus, style: st.value, styleTrans: st.trans, styleColor: st.color, total: r.score + bonus + st.value }, r);
      };
      const firstExtra = (c, Wt) => {
        let b = 0;
        if (prevChord) b += 0.08 * Wt * commonTones(prevChord, c); // bölüm geçişi: ortak nota
        if (si === 0 && sameChord(c, home)) b += 0.15 * Wt;
        return b;
      };
      const homeExtra = (c, Wt) => (sameChord(c, home) ? 0.5 * Wt : 0);
      const lastNoSplit = isLast && !g.split;
      const extraBar = isFirst ? firstExtra : lastNoSplit ? homeExtra : null;
      let barChord, barReason = '', barCands = null, barRhythm = null;
      // (d) ev akoru en az her M ölçüde bir duyulsun: M dolunca ev akoru eşik beklemeden aday olur
      let homeDue = o.homeEvery > 0 && !isFirst && sinceHome >= o.homeEvery - 1;
      const homeReason = `(d) ev akoru ${o.homeEvery} ölçüdür duyulmadı`;
      const lockFull = lockAt(bar, null);
      if (lockFull) {
        barChord = lockFull.chord; barReason = 'kilitli';
      } else if (!bn.length) {
        barChord = cur && !homeDue ? cur : home; barReason = cur && !homeDue ? 'melodi yok — devam' : 'melodi yok — ev akoru';
      } else {
        barCands = evalAll(bn, extraBar);
        const best = pick(barCands);
        if (!cur) { barChord = best.chord; barReason = isFirst && prevChord ? 'bölüm başı (ortak nota tercihli)' : 'en iyi puan'; }
        else {
          const cs = evalOne(cur, bn, extraBar);
          // "Değiş mi kal mı": melodi puanı + politika + harmonik ritim verisi (bu akor n ölçüdür çalıyorken
          // değişme olasılığı). Stilin "hangi akora" payı bu karşılaştırmaya girmez; yalnızca adayı seçer.
          const margin = pct * Math.max(Math.abs(cs.melody), 0.25 * cs.W);
          const rh = sty && sty.changeTerm ? sty.changeTerm(sec, curBars, 1) : null;
          barRhythm = rh;
          const rhv = rh ? rh.value : 0;
          const rhTxt = rh ? ` · harmonik ritim: ${curBars} ölçüdür çalıyor, değişme olasılığı %${Math.round(rh.h * 100)}` : '';
          const hs = homeDue && !isHome(cur) ? evalOne(home, bn, extraBar) : null;
          if (hs && !hs.friction && hs.score > 0) { barChord = home; barReason = homeReason; }
          else if (cs.friction) { barChord = best.chord; barReason = '(a) ağırlıklı nota yarım ses sürtünüyor'; }
          else if (best.melody + rhv - cs.melody >= margin && !sameChord(best.chord, cur)) { barChord = best.chord; barReason = `(b) yeni akor ≥%${o.changePct} daha iyi${rhTxt}`; }
          else if (curBars >= o.maxBars) {
            const alt = barCands.find((c) => !sameChord(c.chord, cur) && !c.friction && c.total > 0);
            if (alt) { barChord = alt.chord; barReason = `(c) aynı akor ${o.maxBars} ölçüdür çalıyordu`; }
            else { barChord = cur; barReason = 'mevcut akor korunuyor'; }
          } else { barChord = cur; barReason = 'mevcut akor korunuyor' + rhTxt; }
        }
      }
      // senin ölçü başı işaretin (önceliği motor kararlarından yüksek): ✂ = akorun kökü burada değişir, = burada değişmez (ölçü ortası işaretleri süreli Viterbi motorunda)
      const mkB = !lockFull && cur && !isFirst ? (o.marks || []).find((m) => m.bar === bar && !m.half) : null;
      if (mkB && mkB.kind === 'change' && barChord.root === cur.root) {
        const cl = barCands || evalAll(bn, extraBar);
        const alt = cl.find((c) => c.chord.root !== cur.root && !c.friction) || cl.find((c) => c.chord.root !== cur.root);
        if (alt) { barChord = alt.chord; barReason = '✂ senin değişim noktan: akor burada değişir'; }
      } else if (mkB && mkB.kind === 'hold' && !sameChord(barChord, cur)) { barChord = cur; barReason = '= senin işaretin: akor burada değişmez'; }
      // yarım ölçü kontrolü
      const halves = [];
      if (g.split && !lockFull && (!o.downbeatOnly || lockAt(bar, 0) || lockAt(bar, 1))) {
        let hc = barChord;
        for (let h = 0; h < 2; h++) {
          const hq0 = q0 + h * g.split, hq1 = h ? q1 : q0 + g.split;
          const lk = lockAt(bar, h);
          const hn = slotNotes(notes, hq0, hq1, g);
          if (lk) { halves.push({ q0: hq0, q1: hq1, chord: lk.chord, reason: 'kilitli', locked: true, sn: hn }); hc = lk.chord; continue; }
          const endHalf = isLast && h === 1;
          let chord = hc, reason = null, hc2 = null;
          if (hn.length) {
            const ex = endHalf ? homeExtra : null;
            const pend = h === 1 ? hc : null;
            const cs = evalOne(hc, hn, ex, pend);
            hc2 = evalAll(hn, ex, pend);
            const hs = homeDue && !isHome(hc) && !isHome(barChord) ? evalOne(home, hn, ex, pend) : null;
            if (hs && !hs.friction && hs.score > 0) { chord = home; reason = homeReason; homeDue = false; }
            else if (cs.friction) { chord = pick(hc2).chord; reason = '(a) yarım ölçüde sürtünme'; }
            else if (endHalf && !sameChord(hc, home)) {
              const hs = hc2.find((c) => sameChord(c.chord, home));
              if (hs && !hs.friction && hs.total - cs.total >= pct * Math.max(Math.abs(cs.total), 0.25 * cs.W)) { chord = home; reason = 'bölüm sonu — ev akoruna dönüş'; }
            }
          }
          halves.push({ q0: hq0, q1: hq1, chord, reason, sn: hn, cands: hc2 });
          hc = chord;
        }
      }
      const pushSlot = (sq0, sq1, chord, reason, locked, sn, cList) => {
        const scored = (cList || evalAll(sn)).slice(0, 12);
        const top = scored.slice(0, 3).map((c) => ({ chord: c.chord, score: c.total, melody: c.melody ?? c.total, style: c.style || 0, styleTrans: c.styleTrans || 0, styleColor: c.styleColor || 0, pct: c.W > 0 ? Math.round((100 * c.total) / c.W) : 0, roles: c.roles, friction: c.friction }));
        const curEval = scoreChord(chord, sn, o.colorPenalty);
        const heavy = sn.filter((x) => x.w >= 2);
        const slot = {
          bar, q0: sq0, q1: sq1, half: sq1 - sq0 < g.barQ - 1e-6 ? (sq0 > q0 + 1e-6 ? 1 : 0) : null,
          section: sec.id, chord: Object.assign({}, chord), locked: !!locked, reason, flats,
          candidates: top, roles: curEval.roles, score: curEval.score, W: curEval.W, notes: sn.map((x) => ({ id: x.n.id, pc: x.pc, w: x.w })),
          suggest: null, rhythm: barRhythm,
        };
        // İstisna: melodi maj7 ise akoru maj7 yaz
        if (!locked && slot.chord.q === '' && sn.some((x) => x.w >= 0.5 && mod12(x.pc - slot.chord.root) === 11)) { slot.chord.q = 'maj7'; slot.reason = (slot.reason || '') + ' · melodi maj7 → maj7'; }
        // Minör akorda melodi 2'liye basıyorsa sus2 öner
        if (slot.chord.q === 'm' && heavy.some((x) => mod12(x.pc - slot.chord.root) === 2)) slot.suggest = { root: slot.chord.root, q: 'sus2' };
        slots.push(slot);
      };
      if (halves.length && !sameChord(halves[0].chord, halves[1].chord)) {
        halves.forEach((h, i) => pushSlot(h.q0, h.q1, h.chord, h.reason || (i === 0 ? barReason : 'devam'), h.locked, h.sn, h.cands));
        if (sameChord(halves[1].chord, cur)) curBars += 1; else curBars = 0.5;
        cur = halves[1].chord;
      } else {
        const ch = halves.length ? halves[0].chord : barChord;
        pushSlot(q0, q1, ch, (halves[0] && halves[0].reason) || barReason, !!lockFull || (halves[0] && halves[0].locked && halves[1].locked), bn, barCands && sameChord(ch, barChord) ? barCands : null);
        if (sameChord(ch, cur)) curBars += 1; else curBars = 1;
        cur = ch;
      }
      sinceHome = slots.some((sl) => sl.bar === bar && sl.section === sec.id && isHome(sl.chord)) ? 0 : sinceHome + 1;
      for (const sl of slots) if (sl.bar === bar && sl.section === sec.id && !sameChord(hist[hist.length - 1], sl.chord)) hist.push(sl.chord);
    }
    prevChord = cur;
  });
  return slots;
}

// ---------------------------------------------------------------- SÜRELİ VITERBI (gizli yarı-Markov)
// Bölüm yarım ölçü birimlerine bölünür; segment = bir akorun d birim çalması. Puan:
//   melodi uyumu (scoreChord + küçük bonuslar) + süre (λ_ritim·log(P(süre)·5), harmonik ritimden; veri yoksa 0)
//   + geçiş (λ·log(P·K) + renk, stil modelinden) − değişim maliyeti (%X × ölçü başına melodi ağırlığı; ölçü ortası 1.5×)
//   − ev akoru M ölçüdür duyulmadıysa ve akor N ölçüyü aştıysa yumuşak cezalar; bölüm sonunda ev akoru bonusu.
// Kısıtlar: kilitler; ağır vuruşta yarım ses sürtünmesi (hiçbir aday sürtünmesiz olamıyorsa o birimde gevşer).
// En iyi K yol tutulur; birbirinden en az 2 ölçüde farklı en iyi 3 progresyon döner.
function buildChordsViterbi(notes, sections, g, o, locks = []) {
  const per = g.split ? 2 : 1, unitQ = g.split ? g.split : g.barQ;
  const sty = o.style || null;
  const K = Math.max(1, o.nBest ?? 3) * 3;
  const slots = [];
  slots.alternatives = {};
  let prevChord = null;
  const secs = [...sections].sort((p, q) => p.startBar - q.startBar);
  secs.forEach((sec, si) => {
    if (sec.tonic == null || !sec.mode) return;
    const nBars = sec.endBar - sec.startBar + 1, U = nBars * per;
    const q0s = (sec.startBar - 1) * g.barQ;
    const qAt = (u) => q0s + u * unitQ;
    const home = homeChord(sec.tonic, sec.mode);
    const flats = keyUsesFlats(sec.tonic, sec.mode);
    const homeThird = CHORD_Q[home.q].find((i) => i === 3 || i === 4);
    const isHome = (c) => !!c && c.root === home.root && (homeThird == null || CHORD_Q[c.q].includes(homeThird));
    // birim kilitleri
    const lockU = new Array(U).fill(null);
    for (const l of locks) {
      if (l.bar < sec.startBar || l.bar > sec.endBar) continue;
      const b = l.bar - sec.startBar;
      if (l.half == null || per === 1) for (let h = 0; h < per; h++) lockU[b * per + h] = l.chord;
      else lockU[b * per + l.half] = l.chord;
    }
    const sameLock = (a, b) => sameChord(a, b) && (a.bass ?? null) === (b.bass ?? null);
    const lockPre = [0];
    for (let u = 0; u < U; u++) lockPre.push(lockPre[u] + (lockU[u] ? 1 : 0));
    const hasLock = (a, b) => lockPre[b] - lockPre[a] > 0;
    const cands = diatonicChords(sec.tonic, sec.mode).map((c) => ({ root: c.root, q: c.q, deg: c.deg }));
    for (const l of lockU) if (l && !cands.some((c) => sameLock(c, l))) cands.push(Object.assign({ deg: -1 }, l));
    const nC = cands.length;
    const coreOf = (c) => { const iv = CHORD_Q[c.q]; return `${c.root}:${iv.includes(4) ? 'M' : iv.includes(3) ? 'm' : c.q}`; };
    const coreK = cands.map(coreOf);
    // ölçü başına melodi ağırlığı → değişim maliyeti
    const secNotes = slotNotes(notes, qAt(0), qAt(U), g);
    const Wbar = Math.max(0.5, secNotes.reduce((a, x) => a + x.w, 0) / nBars);
    const kappa = (o.changePct / 100) * Wbar;
    const lastBarW = slotNotes(notes, qAt(U - per), qAt(U), g).reduce((a, x) => a + x.w, 0);
    const homeMiss = 0.5 * Wbar; // ev akoru M ölçüyü aşınca her yarım ölçü için (greedy'deki (d) kuralının karşılığı)
    const maxU = Math.max(per, (o.maxBars || 4) * per);
    // kullanıcının değişim işaretleri (birim başı): 'change' = burada akor değişmeli, 'hold' = burada değişmemeli.
    // onlyMarked: işaret konan bölümde akor YALNIZCA işaretli noktalarda değişir.
    const mChange = new Uint8Array(U + 1), mHold = new Uint8Array(U + 1);
    let nMarks = 0;
    for (const m of o.marks || []) {
      if (m.bar < sec.startBar || m.bar > sec.endBar) continue;
      const u = (m.bar - sec.startBar) * per + (per === 2 ? m.half || 0 : 0);
      if (u <= 0 || u >= U) continue;
      if (m.kind === 'change') { mChange[u] = 1; nMarks++; } else if (m.kind === 'hold') { mHold[u] = 1; nMarks++; }
    }
    // "yalnızca 1. vuruşta": ölçü ortası birimleri, kullanıcı orada ✂ koymadıysa "değişme" sayılır
    if (o.downbeatOnly && per === 2) for (let u = 1; u < U; u += 2) if (!mChange[u]) mHold[u] = 1;
    const preChange = [0];
    for (let u = 0; u < U; u++) preChange.push(preChange[u] + mChange[u]);
    const changeInside = (a, b) => preChange[b] - preChange[a + 1] > 0; // a < k < b
    const onlyMarked = !!o.onlyMarked && mChange.some((x) => x);
    const Dmax = nMarks ? U : Math.min(U, maxU * 2);
    const Mu = o.homeEvery > 0 ? o.homeEvery * per : 0;
    // "evden beri geçen" sayaç M'de doyar: ceza yalnızca M'yi aşan kısma bağlı olduğundan sonuç değişmez, durum sayısı küçülür
    const Hcap = Mu;
    const unitFriction = new Array(U).fill(false);
    for (let u = 0; u < U; u++) {
      const sn = slotNotes(notes, qAt(u), qAt(u + 1), g);
      unitFriction[u] = cands.every((c) => scoreChord(c, sn, o.colorPenalty).friction);
    }
    // segment melodi + süre puanları (s, d, c)
    const segCache = new Map();
    const seg = (s, d, ci) => {
      const key = (s * 128 + d) * 64 + ci;
      if (segCache.has(key)) return segCache.get(key);
      let v = null;
      const c = cands[ci];
      let lockOk = true, anyLock = false;
      for (let u = s; u < s + d; u++) if (lockU[u]) { anyLock = true; if (!sameLock(lockU[u], c)) { lockOk = false; break; } }
      if (lockOk) {
        const sn = slotNotes(notes, qAt(s), qAt(s + d), g);
        const r = scoreChord(c, sn, o.colorPenalty);
        const relax = d === 1 && unitFriction[s];
        if (!r.friction || relax || anyLock) {
          let val = r.score + (sameChord(c, home) ? 0.06 * r.W : 0) + (c.deg === 3 || c.deg === 4 ? 0.02 * r.W : 0);
          if (s + d === U && sameChord(c, home)) val += 0.5 * lastBarW; // bölüm sonu: ev akoru (son ölçünün ağırlığıyla)
          const dt = sty && sty.durTerm ? sty.durTerm(sec, d / per) : null;
          if (dt != null) val += dt;
          if (d > maxU && !onlyMarked) val -= (kappa * (d - maxU)) / per; // N ölçü sınırı (yumuşak; "yalnızca işaretli" modda yok)
          v = { val, dt };
        }
      }
      segCache.set(key, v);
      return v;
    };
    // geçiş puanları (stil) + ilk segment
    const trans = Array.from({ length: nC }, () => new Float64Array(nC));
    const first = new Float64Array(nC);
    for (let b = 0; b < nC; b++) {
      let f = sty ? sty.score(null, null, cands[b], sec).value : 0;
      if (prevChord) f += 0.04 * Wbar * commonTones(prevChord, cands[b]);
      if (si === 0 && sameChord(cands[b], home)) f += 0.15 * Wbar;
      first[b] = f;
      for (let a = 0; a < nC; a++) trans[a][b] = sty ? sty.score(cands[a], null, cands[b], sec).value : 0;
    }
    // list Viterbi: durum (bitiş u, akor c, evden beri geçen birim h) → en iyi K düğüm
    const H = Mu ? Hcap + 1 : 1;
    const table = Array.from({ length: U + 1 }, () => new Map());
    const push = (e, key, node) => {
      let arr = table[e].get(key);
      if (!arr) { arr = []; table[e].set(key, arr); }
      if (arr.length < K) { arr.push(node); arr.sort((x, y) => y.score - x.score); }
      else if (node.score > arr[K - 1].score) { arr[K - 1] = node; arr.sort((x, y) => y.score - x.score); }
    };
    const homeCi = cands.map((c) => isHome(c));
    const hStep = (hPrev, d, ci) => {
      if (!Mu || homeCi[ci]) return { h: 0, pen: 0 };
      const over = Math.max(0, hPrev + d - Mu); // hPrev ≤ Mu
      return { h: Math.min(Hcap, hPrev + d), pen: homeMiss * over };
    };
    for (let e = 1; e <= U; e++) {
      for (let d = 1; d <= Math.min(Dmax, e); d++) {
        const s = e - d;
        if (changeInside(s, e)) continue; // işaretli değişim noktasının üstünden geçen akor olmaz
        if (s > 0 && (mHold[s] || (onlyMarked && !mChange[s]))) continue; // burada değişmesin / yalnızca işaretlerde
        for (let ci = 0; ci < nC; ci++) {
          const sg = seg(s, d, ci);
          if (!sg) continue;
          if (s === 0) {
            const hp = hStep(0, d, ci);
            push(e, ci * H + hp.h, { score: first[ci] + sg.val - hp.pen, s, e, ci, prev: null });
            continue;
          }
          const mid = mChange[s] ? -kappa : s % per !== 0 ? 0.5 * kappa : 0; // kullanıcının istediği değişime maliyet yok
          for (const [key, arr] of table[s]) {
            const pci = Math.floor(key / H), ph = key % H;
            // aynı core art arda: tek akor sayılır (C → Cmaj7 ayrı değişim değil). Ama kullanıcı ikisinden
            // birini kilitlediyse (ör. D kilitli, ardından Dmaj7 kilitli) buna izin verilir — yoksa yol kalmaz.
            const sameCore = coreK[pci] === coreK[ci];
            if (sameCore && pci === ci) continue;
            const segLocked = sameCore && hasLock(s, e);
            // ✂ noktasında gerçek değişim: kök değişmeli (D → Dmaj7, C#m → C#sus2 değişim sayılmaz) — kullanıcı kilitlediyse hariç
            if (mChange[s] && cands[pci].root === cands[ci].root && !hasLock(s, e)) continue;
            const hp = hStep(ph, d, ci);
            const base = sg.val + trans[pci][ci] - kappa - mid - hp.pen;
            for (const nd of arr) {
              if (sameCore && !segLocked && !hasLock(nd.s, nd.e)) continue;
              push(e, ci * H + hp.h, { score: nd.score + base, s, e, ci, prev: nd });
            }
          }
        }
      }
    }
    // birbirinden en az 2 ölçüde farklı en iyi progresyonlar
    const finals = [];
    for (const arr of table[U].values()) finals.push(...arr);
    finals.sort((x, y) => y.score - x.score);
    const unitsOf = (nd) => { const u = new Array(U); const segs = []; for (let x = nd; x; x = x.prev) { segs.unshift(x); for (let k = x.s; k < x.e; k++) u[k] = x.ci; } return { u, segs }; };
    const barsDiff = (a, b) => { let n = 0; for (let bi = 0; bi < nBars; bi++) { let dif = false; for (let h = 0; h < per; h++) if (coreK[a[bi * per + h]] !== coreK[b[bi * per + h]] || a[bi * per + h] !== b[bi * per + h]) dif = true; if (dif) n++; } return n; };
    const alts = [];
    for (const nd of finals) {
      const r = unitsOf(nd);
      if (alts.every((a) => barsDiff(a.u, r.u) >= 2)) alts.push(Object.assign(r, { score: nd.score }));
      if (alts.length >= (o.nBest ?? 3)) break;
    }
    if (!alts.length) {
      // Kısıtlar (kilitler, sürtünme, değişim işaretleri) hiçbir yola izin vermediyse bölüm asla akorsuz kalmasın:
      // bu bölüm ölçü ölçü (greedy) motorla doldurulur.
      if (nMarks) (slots.markConflict = slots.markConflict || {})[sec.id] = true;
      const fb = buildChords(notes, [sec], g, Object.assign({}, o, { engine: 'greedy' }), locks);
      for (const x of fb) { x.reason = `${x.reason || ''} · süreli Viterbi bu kilitlerle yol bulamadı, ölçü ölçü motor kullanıldı`; slots.push(x); }
      if (fb.length) prevChord = fb[fb.length - 1].chord;
      return;
    }
    // alternatif seçimi: kullanıcının açık seçimi üstün; yoksa sıcaklık > 0 ise puanla orantılı (softmax) örnekle
    let choice = 0;
    if (o.altChoice && o.altChoice[sec.id] != null) choice = Math.min(alts.length - 1, o.altChoice[sec.id]);
    else if (sty && sty.temperature > 0 && alts.length > 1) {
      const w = alts.map((a) => Math.exp((a.score - alts[0].score) / sty.temperature));
      let r = sty.rng() * w.reduce((a, b) => a + b, 0);
      choice = w.findIndex((x) => (r -= x) <= 0);
      if (choice < 0) choice = alts.length - 1;
    }
    slots.alternatives[sec.id] = alts.map((a, i) => ({
      index: i, score: a.score, chosen: i === choice,
      segments: a.segs.map((x) => ({ chord: cands[x.ci], bars: (x.e - x.s) / per })),
      text: a.segs.map((x) => `${chordName(cands[x.ci], flats)} (${(x.e - x.s) / per})`).join(' → '),
    }));
    const pick = alts[choice];
    // slotlara çevir (ölçü ya da yarım ölçü) — adaylar ve roller DAW denetçisi için
    let prevC = prevChord;
    for (let bi = 0; bi < nBars; bi++) {
      const bar = sec.startBar + bi;
      const us = Array.from({ length: per }, (_, h) => pick.u[bi * per + h]);
      const parts = per === 2 && us[0] !== us[1] ? [[0, 1], [1, 2]] : [[0, per]];
      for (const [a, b] of parts) {
        const c = cands[us[a]];
        const sq0 = qAt(bi * per + a), sq1 = qAt(bi * per + b);
        const sn = slotNotes(notes, sq0, sq1, g);
        const segNode = pick.segs.find((x) => x.s <= bi * per + a && x.e > bi * per + a);
        const ctx = prevC && !sameChord(prevC, c) ? prevC : null;
        const scored = cands.map((cc) => {
          const r = scoreChord(cc, sn, o.colorPenalty);
          const stv = sty ? sty.score(ctx, null, cc, sec) : { value: 0, trans: 0, color: 0 };
          return Object.assign({ chord: cc, melody: r.score, style: stv.value, styleTrans: stv.trans, styleColor: stv.color, total: r.score + stv.value }, r);
        }).sort((x, y) => y.total - x.total);
        const curEval = scoreChord(c, sn, o.colorPenalty);
        const locked = !!lockU[bi * per + a];
        const slot = {
          bar, q0: sq0, q1: sq1, half: b - a < per ? a : null, section: sec.id, chord: { root: c.root, q: c.q, bass: c.bass ?? null }, locked,
          reason: locked ? 'kilitli' : `süreli Viterbi: ${chordName(c, flats)} ${(segNode.e - segNode.s) / per} ölçü${alts.length > 1 ? ` · alternatif ${choice + 1}/${alts.length}` : ''}`,
          flats, candidates: scored.slice(0, 3).map((x) => ({ chord: { root: x.chord.root, q: x.chord.q }, score: x.total, melody: x.melody, style: x.style, styleTrans: x.styleTrans, styleColor: x.styleColor, pct: x.W > 0 ? Math.round((100 * x.total) / x.W) : 0, roles: x.roles, friction: x.friction })),
          roles: curEval.roles, score: curEval.score, W: curEval.W, notes: sn.map((x) => ({ id: x.n.id, pc: x.pc, w: x.w })), suggest: null,
          rhythm: null, segBars: (segNode.e - segNode.s) / per, engine: 'viterbi',
          segDurTerm: (seg(segNode.s, segNode.e - segNode.s, segNode.ci) || {}).dt ?? null,
        };
        if (slot.chord.bass == null) delete slot.chord.bass;
        if (!locked && slot.chord.q === '' && sn.some((x) => x.w >= 0.5 && mod12(x.pc - slot.chord.root) === 11)) { slot.chord.q = 'maj7'; slot.reason += ' · melodi maj7 → maj7'; }
        if (slot.chord.q === 'm' && sn.filter((x) => x.w >= 2).some((x) => mod12(x.pc - slot.chord.root) === 2)) slot.suggest = { root: slot.chord.root, q: 'sus2' };
        slots.push(slot);
        if (!sameChord(prevC, c)) prevC = c;
      }
    }
    prevChord = cands[pick.u[U - 1]];
  });
  return slots;
}
const CHORD_ENGINES = ['greedy', 'viterbi'];

// ---------------------------------------------------------------- SESLENDİRME (voicing)
// ---------------------------------------------------------------- KİLİT SONRASI ÖNERİLER
const coreKeyOf = (c) => { const iv = CHORD_Q[c.q]; return `${c.root}:${iv.includes(4) ? 'M' : iv.includes(3) ? 'm' : c.q}`; };
// Melodideki sürtünen notalar: "D (melodi) ↔ C# (akor)"
function clashText(chord, sn, flats = false) {
  const pcs = chordPcs(chord), out = [];
  for (const x of sn) {
    if (x.w < 2) continue;
    const c = pcs.find((p) => mod12(x.pc - p) === 1 || mod12(p - x.pc) === 1);
    if (c != null) { const t = `${pcName(x.pc, flats)} (melodi) ↔ ${pcName(c, flats)} (akor)`; if (!out.includes(t)) out.push(t); }
  }
  return out.join(', ');
}
// cur yerine alt neden daha iyi? {important, reasons[]}
function adviseSwap(cur, alt, sn, prevC, nextC, sec, sty, colorPenalty = 0) {
  const a = scoreChord(cur, sn, colorPenalty), b = scoreChord(alt, sn, colorPenalty);
  const fl = !!sec && sec.tonic != null && keyUsesFlats(sec.tonic, sec.mode);
  const nm = (c) => chordName(c, fl);
  const reasons = [];
  let important = false;
  if (a.friction && !b.friction) { important = true; reasons.push(`melodiyle yarım ses sürtünmesi: ${clashText(cur, sn, fl)}`); }
  if (prevC && coreKeyOf(prevC) === coreKeyOf(cur) && coreKeyOf(prevC) !== coreKeyOf(alt)) { important = true; reasons.push(`önceki akorla (${nm(prevC)}) aynı kök — akor değişimi duyulmuyor`); }
  if (nextC && coreKeyOf(nextC) === coreKeyOf(cur) && coreKeyOf(nextC) !== coreKeyOf(alt)) { important = true; reasons.push(`sonraki akorla (${nm(nextC)}) aynı kök — akor değişimi duyulmuyor`); }
  if (nextC && coreKeyOf(nextC) === coreKeyOf(alt)) reasons.push(`sonraki akorla (${nm(nextC)}) birleşip tek akor olur — bir akor değişimi azalır`);
  if (prevC && coreKeyOf(prevC) === coreKeyOf(alt)) reasons.push(`önceki akorla (${nm(prevC)}) birleşip tek akor olur — bir akor değişimi azalır`);
  if (sec && sec.tonic != null && sameChord(alt, homeChord(sec.tonic, sec.mode)) && !sameChord(cur, alt)) reasons.push(`ev akoru (${nm(alt)}): bölümün merkezini duyurur`);
  const dm = b.score - a.score;
  if (dm > 0.1 * Math.max(1, a.W)) reasons.push(`melodiye daha uygun (puan ${a.score.toFixed(1)} → ${b.score.toFixed(1)})`);
  if (sty && prevC && !sameChord(prevC, cur)) {
    const ta = sty.score(prevC, null, cur, sec).trans, tb = sty.score(prevC, null, alt, sec).trans;
    if (tb - ta > 0.3) reasons.push(`stil verine göre ${nm(prevC)} → ${nm(alt)} geçişi daha olası`);
  }
  if (!reasons.length) reasons.push('bölümün bütününde (akor süreleri, ev akoruna dönüş, değişim sayısı) daha yüksek puan; tek başına zorunlu değil');
  return { important, reasons };
}
// Kilitli akor: önemli sorun (sürtünme) ya da isteğe bağlı renk önerisi
function lockAdvice(slot, sn, colorPenalty = 0) {
  const out = [];
  const c = slot.chord, r = scoreChord(c, sn, colorPenalty);
  if (r.friction) {
    const variants = ['', 'm', 'maj7', '7', 'm7', 'add9', 'sus2', 'sus4'].map((q) => ({ root: c.root, q })).filter((v) => CHORD_Q[v.q] && !sameChord(v, c));
    const alts = [...variants.map((v) => ({ chord: v, r: scoreChord(v, sn, colorPenalty) })), ...(slot.candidates || []).map((x) => ({ chord: { root: x.chord.root, q: x.chord.q }, r: scoreChord(x.chord, sn, colorPenalty) }))]
      .filter((x) => !x.r.friction).sort((p, q) => q.r.score - p.r.score);
    const uniq = [];
    for (const x of alts) if (!uniq.some((u) => sameChord(u, x.chord))) uniq.push(x.chord);
    out.push({ important: true, text: `Melodiyle yarım ses sürtünmesi: ${clashText(c, sn, slot.flats)}. Bilerek istiyorsan sorun yok; değilse sürtünmeyen seçenekler:`, chords: uniq.slice(0, 3) });
  }
  const heavy = sn.filter((x) => x.w >= 2).map((x) => mod12(x.pc - c.root));
  if (!r.friction && c.q === '' && heavy.includes(11)) out.push({ important: false, text: 'Renk: melodi güçlü vuruşta majör 7\'liye basıyor — maj7 rengi bunu akora katar (isteğe bağlı).', chords: [{ root: c.root, q: 'maj7' }] });
  if (!r.friction && c.q === 'm' && heavy.includes(2)) out.push({ important: false, text: 'Renk: melodi güçlü vuruşta 2\'liye (9) basıyor — sus2 ya da add9 rengi bunu yumuşatır (isteğe bağlı; minör 3\'lü sus2\'de düşer).', chords: [{ root: c.root, q: 'sus2' }] });
  return out;
}
function voiceChords(slots, notes, sections, opts = {}) {
  let prevV = null, prevBass = null, prevSec = null;
  const secById = new Map(sections.map((s) => [s.id, s]));
  const lowBySec = new Map();
  for (const s of sections) {
    const ms = notes.filter((n) => n.section === s.id).map((n) => n.effMidi);
    lowBySec.set(s.id, ms.length ? percentile(ms, 0.1) : 60);
  }
  slots.forEach((slot, i) => {
    const sec = secById.get(slot.section);
    const firstInSec = slot.section !== prevSec;
    const lastInSec = !slots[i + 1] || slots[i + 1].section !== slot.section;
    const low = lowBySec.get(slot.section) ?? 60;
    const pcs = chordPcs(slot.chord);
    let top = Math.min(Math.round(low) - 1, 76), lo = top - 15;
    let best = null;
    for (let attempt = 0; attempt < 8 && !best; attempt++) {
      const opt = pcs.map((pc) => { const a = []; for (let m = lo; m <= top; m++) if (mod12(m) === pc) a.push(m); return a; });
      if (opt.some((a) => !a.length)) { if (lo > 40) lo -= 3; else top += 3; continue; }
      const combos = [[]];
      for (const a of opt) { const nx = []; for (const c of combos) for (const m of a) nx.push([...c, m]); combos.length = 0; combos.push(...nx); }
      let bc = Infinity;
      for (const c of combos) {
        const v = [...c].sort((p, q) => p - q);
        const span = v[v.length - 1] - v[0];
        if (span > 14) continue;
        let cost = 0;
        if (prevV) {
          for (const m of v) cost += Math.min(...prevV.map((p) => Math.abs(p - m)));
          for (const p of prevV) cost += Math.min(...v.map((m) => Math.abs(p - m)));
        } else cost += Math.abs(v.reduce((a, b) => a + b, 0) / v.length - (top - 6));
        for (let k = 1; k < v.length; k++) if (v[k] - v[k - 1] === 1) cost += 1.5;
        if (v[0] < 48 && v[1] - v[0] < 3) cost += 1;
        cost += 0.05 * span;
        if (cost < bc) { bc = cost; best = v; }
      }
      if (!best) { if (lo > 40) lo -= 3; else top += 3; }
    }
    if (!best) best = pcs.map((pc) => 48 + pc).sort((p, q) => p - q);
    // bas
    const bassTop = Math.min(52, best[0] - 1);
    const place = (pc, near) => {
      let bm = null, bd = Infinity;
      for (let m = 28; m <= bassTop; m++) if (mod12(m) === pc) { const d = Math.abs(m - near); if (d < bd) { bd = d; bm = m; } }
      return bm ?? 36 + mod12(pc);
    };
    let bassPc, bass;
    const forcedBass = slot.chord.bass;
    // otomatik bas seçimi: kök, ya da bas hattı adım adım gitsin diye çevrim (3'lü / 5'li basta)
    const autoBass = () => {
      const iv = CHORD_Q[slot.chord.q];
      const opt = [{ pc: slot.chord.root, c: 0 }];
      if (prevBass != null && !firstInSec && !lastInSec) {
        const th = iv.find((x) => x === 3 || x === 4);
        if (th != null) opt.push({ pc: mod12(slot.chord.root + th), c: 2.0 });
        if (iv.includes(7)) opt.push({ pc: mod12(slot.chord.root + 7), c: 3.0 });
      }
      let bc = Infinity, r = null;
      for (const op of opt) {
        const m = place(op.pc, prevBass ?? 40);
        const d = prevBass == null ? 0 : Math.abs(m - prevBass);
        const mc = d <= 2 ? 0 : d <= 4 ? 1.5 : 3;
        if (op.c + mc < bc) { bc = op.c + mc; r = { pc: op.pc, m, leap: d }; }
      }
      const rootM = place(slot.chord.root, prevBass ?? 40);
      return Object.assign(r, { rootLeap: prevBass == null ? 0 : Math.abs(rootM - prevBass), prevBassPc: prevBass == null ? null : mod12(prevBass) });
    };
    slot.invWhy = null; slot.invAdvice = null;
    if (forcedBass != null) { bassPc = forcedBass; bass = place(bassPc, prevBass ?? 40); }
    else if (opts.pedal && sec) { bassPc = sec.tonic; bass = place(bassPc, 40); }
    else if (slot.locked || slot.pinned) {
      // kullanıcının kilitlediği (ya da kilit sonrası sabit tutulan) akorda çevrim zorlanmaz: kök basta.
      // Çevrim daha iyi bir bas hattı verecekse yalnızca öneri olarak yazılır.
      bassPc = slot.chord.root; bass = place(bassPc, prevBass ?? 40);
      const a = autoBass();
      if (slot.locked && a.pc !== slot.chord.root) slot.invAdvice = { bassPc: a.pc, prevBassPc: a.prevBassPc, leap: a.leap, rootLeap: a.rootLeap };
    } else {
      const a = autoBass();
      bassPc = a.pc; bass = a.m;
      if (a.pc !== slot.chord.root) slot.invWhy = { bassPc: a.pc, prevBassPc: a.prevBassPc, leap: a.leap, rootLeap: a.rootLeap };
    }
    slot.voicing = { bass, notes: best, bassPc };
    slot.inversion = bassPc !== slot.chord.root;
    prevV = best; prevBass = bass; prevSec = slot.section;
  });
  return slots;
}

// ---------------------------------------------------------------- MIDI
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
function strBytes(s) { return Array.from(new TextEncoder().encode(s)); }
function midiTrack(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data];
}
// tracks: [{name, channel, program, notes:[{q0,q1,midi,vel}], texts:[{q,text,type}]}]
function writeMidi({ quarterBpm, meter, tracks, markers = [] }, ppq = 480) {
  const [num, den] = meter.split('/').map(Number);
  const tempo = Math.round(60000000 / quarterBpm);
  const tick = (q) => Math.max(0, Math.round(q * ppq));
  const t0 = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, num, Math.log2(den), den === 8 ? 12 : 24, 8] },
  ];
  for (const m of markers) { const b = strBytes(m.text); t0.push({ tick: tick(m.q), order: 1, bytes: [0xff, 0x06, ...vlq(b.length), ...b] }); }
  const chunks = [midiTrack(t0)];
  for (const tr of tracks) {
    const ev = [];
    const nb = strBytes(tr.name);
    ev.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(nb.length), ...nb] });
    ev.push({ tick: 0, order: 0, bytes: [0xc0 | tr.channel, tr.program || 0] });
    for (const tx of tr.texts || []) { const b = strBytes(tx.text); ev.push({ tick: tick(tx.q), order: 1, bytes: [0xff, 0x01, ...vlq(b.length), ...b] }); }
    for (const n of tr.notes) {
      if (n.q1 <= 0) continue;
      const a = tick(n.q0), b = Math.max(a + 1, tick(n.q1));
      ev.push({ tick: a, order: 3, bytes: [0x90 | tr.channel, clamp(n.midi, 0, 127), n.vel || 90] });
      ev.push({ tick: b, order: 2, bytes: [0x80 | tr.channel, clamp(n.midi, 0, 127), 0] });
    }
    chunks.push(midiTrack(ev));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, chunks.length, (ppq >> 8) & 255, ppq & 255];
  return new Uint8Array([...header, ...chunks.flat()]);
}
function parseMidi(bytes) { // test amaçlı küçük okuyucu
  const d = bytes;
  let p = 14;
  const ntr = (d[10] << 8) | d[11], ppq = (d[12] << 8) | d[13];
  const tracks = [];
  const rv = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  for (let t = 0; t < ntr; t++) {
    p += 4;
    const len = (d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3];
    p += 4;
    const end = p + len;
    let tick = 0, name = '', run = 0;
    const notes = [], texts = [];
    while (p < end) {
      tick += rv();
      let st = d[p];
      if (st === 0xff) {
        p++; const type = d[p++]; const l = rv(); const txt = new TextDecoder().decode(d.slice(p, p + l)); p += l;
        if (type === 3) name = txt; else if (type === 1 || type === 6) texts.push({ tick, text: txt, type });
        continue;
      }
      if (st & 0x80) { run = st; p++; } else st = run;
      const hi = st & 0xf0;
      if (hi === 0x90 || hi === 0x80) { const n = d[p++], v = d[p++]; if (hi === 0x90 && v > 0) notes.push({ tick, midi: n, vel: v }); }
      else if (hi === 0xc0 || hi === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    tracks.push({ name, notes, texts });
  }
  return { ppq, tracks };
}

// ---------------------------------------------------------------- WAV
function encodeWav(channels, sr) {
  const nCh = channels.length, len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) { v.setInt16(o, Math.round(clamp(channels[c][i], -1, 1) * 32767), true); o += 2; }
  return buf;
}
function decodeWav(buf) {
  const v = new DataView(buf);
  let p = 12, fmt = null;
  while (p < v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { ch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true), fmt: v.getUint16(p + 8, true) };
    if (id === 'data' && fmt) {
      const bps = fmt.bits / 8, n = Math.floor(size / (bps * fmt.ch));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const o = p + 8 + (i * fmt.ch + c) * bps;
          s += fmt.fmt === 3 ? v.getFloat32(o, true) : bps === 2 ? v.getInt16(o, true) / 32768 : bps === 3 ? ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608) : (v.getUint8(o) - 128) / 128;
        }
        out[i] = s / fmt.ch;
      }
      return { sr: fmt.sr, data: out };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('WAV çözülemedi');
}

// ---------------------------------------------------------------- piyano render (çevrimdışı; örnek tabanlı)
// samples: [{midi, data:Float32Array, sr}] ; events: [{t, dur, midi, vel}]
function renderPiano(events, samples, sr, length, gain = 1) {
  const out = new Float32Array(length);
  if (!samples.length) return out;
  for (const e of events) {
    let s = samples[0];
    for (const c of samples) if (Math.abs(c.midi - e.midi) < Math.abs(s.midi - e.midi)) s = c;
    const rate = Math.pow(2, (e.midi - s.midi) / 12) * (s.sr / sr);
    const start = Math.round(e.t * sr), rel = e.rel != null ? e.rel : 0.35, relN = Math.max(1, Math.round(rel * sr));
    const holdN = Math.round((e.hold != null ? e.hold : e.dur) * sr);
    const v = gain * Math.pow((e.vel || 80) / 127, 1.6);
    for (let i = 0; i < holdN + relN; i++) {
      const o = start + i;
      if (o < 0) continue;
      if (o >= length) break;
      const sp = i * rate, i0 = Math.floor(sp);
      if (i0 + 1 >= s.data.length) break;
      const smp = s.data[i0] + (s.data[i0 + 1] - s.data[i0]) * (sp - i0);
      const env = i < holdN ? 1 : Math.exp((-(i - holdN) / relN) * 5);
      out[o] += smp * v * env;
    }
  }
  return out;
}
// Salamander yüklenemezse kullanılan basit sentetik piyano örneği
function synthPianoSample(midi, sr, dur = 3) {
  const n = Math.round(dur * sr), out = new Float32Array(n);
  const f = midiToHz(midi);
  const B = 0.0004;
  for (let h = 1; h <= 12; h++) {
    const fh = f * h * Math.sqrt(1 + B * h * h);
    if (fh > sr / 2.2) break;
    const amp = (1 / h) * (h === 1 ? 1 : 0.7);
    const dec = 1.2 + h * 0.9 + f / 400;
    const ph = Math.random() * 6.28;
    for (let i = 0; i < n; i++) out[i] += amp * Math.exp((-dec * i) / sr) * Math.sin(ph + (2 * Math.PI * fh * i) / sr);
  }
  const att = Math.round(0.004 * sr);
  let mx = 0;
  for (let i = 0; i < n; i++) { if (i < att) out[i] *= i / att; mx = Math.max(mx, Math.abs(out[i])); }
  for (let i = 0; i < n; i++) out[i] *= 0.6 / mx;
  return out;
}

// ---------------------------------------------------------------- synth klavye (canlı çalma app.js'te Web Audio ile, aynı parametreler)
// İki fark edilmiş testere + üçgen → alçak geçiren filtre; akor: yavaş atak, tutulan seviye · arpej: kısa, "pluck"
const SYNTH = {
  level: 0.2,
  chord: { a: 0.015, d: 0.4, s: 0.6, r: 0.6, cut0: 2600, cut1: 1500, det: 7 },
  arp: { a: 0.004, d: 0.22, s: 0.12, r: 0.25, cut0: 4200, cut1: 1100, det: 6 },
  lead: { a: 0.01, d: 0.12, s: 0.8, r: 0.12, cut0: 3600, cut1: 3000, det: 5 }, // MIDI melodisi (vokal yerine)
};
// zarf: atak → sürekli seviyeye çökme → (dur sonunda) bırakma; fade: tutma boyunca üstel olarak %6'ya iner. t: nota başından saniye
function synthEnv(arp, dur, fade, lead) {
  const P = lead ? SYNTH.lead : arp ? SYNTH.arp : SYNTH.chord;
  const hold = (t) => {
    const a = t < P.a ? t / P.a : P.s + (1 - P.s) * Math.exp(-(t - P.a) / (P.d / 3));
    return fade ? a * Math.pow(0.06, Math.min(t, dur) / dur) : a;
  };
  const endLvl = hold(dur);
  return { tail: P.r * 1.6, at: (t) => (t < dur ? hold(t) : endLvl * Math.exp(-(t - dur) / (P.r / 3))) };
}
function renderSynth(events, sr, length, gain = 1) {
  const out = new Float32Array(length);
  for (const e of events) {
    const P = e.lead ? SYNTH.lead : e.arp ? SYNTH.arp : SYNTH.chord, env = synthEnv(!!e.arp, e.dur, !!e.fade, !!e.lead);
    const f = midiToHz(e.midi), start = Math.round(e.t * sr), total = Math.round((e.dur + env.tail) * sr);
    const v = gain * SYNTH.level * Math.pow((e.vel || 80) / 127, 1.4);
    const inc1 = (f * Math.pow(2, P.det / 1200)) / sr, inc2 = (f * Math.pow(2, -P.det / 1200)) / sr, inc3 = f / sr;
    let ph1 = 0, ph2 = 0.37, ph3 = 0, y1 = 0, y2 = 0, k = 0, a = 0;
    for (let i = 0; i < total; i++) {
      const o = start + i;
      if (o >= length) break;
      if ((i & 31) === 0) { // zarf ve filtre kesimi her 32 örnekte güncellenir
        a = env.at(i / sr);
        const fc = P.cut1 + (P.cut0 - P.cut1) * Math.exp(-(i / sr) / (P.d / 2));
        k = 1 - Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr);
      }
      ph1 += inc1; if (ph1 >= 1) ph1 -= 1;
      ph2 += inc2; if (ph2 >= 1) ph2 -= 1;
      ph3 += inc3; if (ph3 >= 1) ph3 -= 1;
      const x = 0.5 * (2 * ph1 - 1) + 0.5 * (2 * ph2 - 1) + 0.4 * (4 * Math.abs(ph3 - 0.5) - 1);
      y1 += k * (x - y1); y2 += k * (y1 - y2); // iki kutuplu alçak geçiren
      if (o >= 0) out[o] += y2 * a * v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- TEST MELODİSİ
// 4/4, 120 BPM. Verse (1–4) C# Frig: her ölçüde C#–D; Nakarat (5–8) B Dorian, B'de biter.
// 2. ölçünün ilk notası (D4) bilerek 40 cent pes.
const TEST_SCORE = [
  // [ölçü, vuruş(1 tabanlı), süre(vuruş), midi, cent, legato(sonrakine kayarak bağlan)]
  [1, 1, 1.5, 61, 0, true], [1, 2.5, 0.5, 62, 0, false], [1, 3, 2, 61, 0, false],
  [2, 1, 1.5, 62, -40, true], [2, 2.5, 0.5, 61, 0, false], [2, 3, 2, 62, 0, false],
  [3, 1, 1.5, 61, 0, true], [3, 2.5, 0.5, 62, 0, true], [3, 3, 2, 61, 0, false],
  [4, 1, 1.5, 62, 0, true], [4, 2.5, 0.5, 61, 0, false], [4, 3, 1.5, 61, 0, false],
  [5, 1, 2, 59, 0, true], [5, 3, 1, 62, 0, true], [5, 4, 1, 66, 0, false],
  [6, 1, 1.5, 64, 0, true], [6, 2.5, 0.5, 68, 0, true], [6, 3, 1, 66, 0, true], [6, 4, 1, 64, 0, false],
  [7, 1, 2, 66, 0, true], [7, 3, 1, 64, 0, true], [7, 4, 1, 61, 0, false],
  [8, 1, 1, 62, 0, true], [8, 2, 3, 59, 0, false],
];
function synthTestVocal(sr = 44100, opts = {}) {
  const bpm = 120, spb = 60 / bpm, lead = opts.leadSec ?? 0.5;
  const totalSec = lead + 8 * 4 * spb + 0.6;
  const n = Math.round(totalSec * sr);
  const f0 = new Float32Array(n), amp = new Float32Array(n);
  let rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const ev = TEST_SCORE.map(([bar, beat, dur, midi, cents, legato]) => ({
    // isteğe bağlı: sabit akort sapması + zamanla doğrusal kayma (kişisel referans testleri için)
    t0: lead + ((bar - 1) * 4 + (beat - 1)) * spb, dur: dur * spb, legato,
    m: midi + cents / 100 + ((opts.offsetCents || 0) + (opts.driftCents || 0) * (((bar - 1) * 4 + (beat - 1)) / 32)) / 100,
  }));
  ev.forEach((e, i) => {
    const next = ev[i + 1];
    const legato = e.legato && next && Math.abs(next.t0 - (e.t0 + e.dur)) < 1e-6;
    const gap = legato ? 0 : 0.06;
    const t1 = e.t0 + e.dur - gap;
    const prevLeg = i > 0 && ev[i - 1].legato && Math.abs(ev[i - 1].t0 + ev[i - 1].dur - e.t0) < 1e-6;
    for (let s = Math.round(e.t0 * sr); s < Math.round(t1 * sr) && s < n; s++) {
      const t = s / sr - e.t0, rem = t1 - s / sr;
      let m = e.m;
      if (!prevLeg) m -= 0.5 * Math.exp(-t / 0.025); // başta hafif "scoop"
      if (legato && rem < 0.04) m += (next.m - e.m) * (0.5 - 0.5 * Math.cos((Math.PI * (0.04 - rem)) / 0.04)); // portamento
      if (e.dur >= 0.7) { // vibrato (±30 cent, 5.5 Hz)
        const vf = clamp((t - 0.15) / 0.15, 0, 1);
        m += vf * 0.3 * Math.sin(2 * Math.PI * 5.5 * t);
      }
      f0[s] = midiToHz(m);
      const att = prevLeg ? 1 : clamp(t / 0.03, 0, 1), rel = legato ? 1 : clamp(rem / 0.035, 0, 1);
      amp[s] = 0.32 * att * rel * (1 - 0.1 * Math.min(1, t / e.dur));
    }
  });
  // additive "a" ünlüsü: sabit formant zarfı, harmonikler f0'la hareket eder
  const formants = [[730, 90, 1.0], [1090, 110, 0.5], [2440, 160, 0.25], [3400, 250, 0.1]];
  const env = (f) => { let s = 0.015; for (const [F, B, G] of formants) s += G / (1 + ((f - F) / (B * 0.7)) ** 2); return s; };
  const sig = new Float32Array(n);
  let phase = 0;
  const H = 40, hA = new Float32Array(H + 1);
  for (let s0 = 0; s0 < n; s0 += 64) {
    const fb = f0[s0] || f0[Math.min(n - 1, s0 + 63)];
    for (let h = 1; h <= H; h++) hA[h] = fb > 0 && fb * h < 7000 ? env(fb * h) / Math.pow(h, 0.3) : 0;
    for (let s = s0; s < Math.min(n, s0 + 64); s++) {
      if (!(f0[s] > 0) || amp[s] <= 0) { continue; }
      phase += (2 * Math.PI * f0[s]) / sr;
      if (phase > 2 * Math.PI * 1000) phase -= 2 * Math.PI * 1000;
      let v = 0;
      for (let h = 1; h <= H; h++) if (hA[h] > 0) v += hA[h] * Math.sin(h * phase);
      sig[s] = v * amp[s] * 0.55;
    }
  }
  // nefes (verse sonu) + zemin gürültüsü
  const breath = [lead + 7.78, lead + 7.96];
  let b1 = 0, b2 = 0;
  for (let s = 0; s < n; s++) {
    const t = s / sr;
    let nz = (rand() * 2 - 1);
    sig[s] += nz * 0.0006;
    if (t >= breath[0] && t < breath[1]) {
      const e = Math.sin((Math.PI * (t - breath[0])) / (breath[1] - breath[0]));
      b1 += 0.25 * (nz - b1); b2 += 0.25 * (b1 - b2);
      sig[s] += (b1 - b2) * 0.12 * e;
    }
  }
  return {
    signal: sig, sr, bpm, meter: '4/4', offsetSec: lead,
    sections: [{ name: 'Verse', startBar: 1, endBar: 4 }, { name: 'Nakarat', startBar: 5, endBar: 8 }],
    flat: { bar: 2, beat: 1, midi: 62, cents: -40 },
    score: TEST_SCORE,
  };
}

// Bölüm başına farklı akor sesi: her bölümün akorları kendi ayarıyla (optsFor(bölümId) → pianoEvents seçenekleri) olaylara dönüşür
function arrangePiano(chords, g, optsFor) {
  const out = [];
  let cur = [], sec = null;
  const flush = () => { if (cur.length) out.push(...pianoEvents(cur, g, optsFor(sec))); };
  for (const c of chords) { if (c.section !== sec) { flush(); cur = []; sec = c.section; } cur.push(c); }
  flush();
  return out;
}

// ---------------------------------------------------------------- DAVUL DÜZENLEMESİ: bölüm başına loop + geçişlerde fill
// plan(ölçü) → o ölçünün davul loop'u ya da null; fillAt(ölçü) → bu ölçünün sonunda bölüm geçişi fill'i var mı
function arrangeDrums(g, bars, startBar, plan, fillAt, swing) {
  const DE = root.Core.drumEvents, ev = [];
  for (let b = Math.max(1, startBar || 1); b <= bars; b++) {
    const L = plan(b);
    if (!L) continue;
    let be = DE(L, g, b, b);
    if (fillAt && fillAt(b)) {
      const lastQ = b * g.barQ - g.pulseQ, n = g.meter === '6/8' || L.feel === 'triple' ? 3 : 4;
      be = be.filter((e) => e.q < lastQ - 1e-6);
      for (let i = 0; i < n; i++) { const q = lastQ + (i * g.pulseQ) / n; be.push({ q, t: q * g.spq, kind: 'S', vel: 0.45 + (0.5 * i) / (n - 1), fill: true }); }
    }
    if (swing) for (const e of be) { const q = swingMap(e.q, g, swing, L.feel === 'triple' ? 2 / 3 : 0.5); e.q = q; e.t = q * g.spq; } // swing: zayıf vuruşlar projenin oranına kayar
    ev.push(...be);
  }
  return ev;
}

// ---------------------------------------------------------------- NOTA BÖLME (çift tık): programın tek ses sandığı yeri ikiye ayır
// Bölme noktaları projede kayıttaki saniye olarak tutulur (proj.noteSplits); perde analizi yeniden yapılsa da uygulanır.
const SPLIT_MIN_FRAMES = 2;
function applyNoteSplits(notes, track, splits) {
  if (!splits || !splits.length || !track) return notes;
  const hop = track.hopSec, sorted = [...splits].sort((a, b) => a - b);
  const midiAt = (i) => (track.f0[i] > 0 ? hzToMidi(track.f0[i]) : NaN);
  const mk = (src, f0i, f1i, extra) => {
    const vals = [];
    const trim = f1i - f0i >= 10 ? Math.floor((f1i - f0i) * 0.15) : 0;
    for (let i = f0i + trim; i < f1i - trim; i++) { const m = midiAt(i); if (m === m) vals.push(m); }
    const med = vals.length ? median(vals) : src.median;
    const nearest = Math.round(med);
    return Object.assign({}, src, { f0i, f1i, t0: f0i * hop, t1: f1i * hop, median: med, nearest, cents: Math.round((med - nearest) * 100) }, extra);
  };
  const out = [];
  for (const nt of notes) {
    let parts = [nt];
    for (const t of sorted) {
      const idx = parts.findIndex((p) => t > p.t0 && t < p.t1);
      if (idx < 0) continue;
      const p = parts[idx], fi = Math.round(t / hop);
      if (fi - p.f0i < SPLIT_MIN_FRAMES || p.f1i - fi < SPLIT_MIN_FRAMES) continue;
      parts.splice(idx, 1, mk(p, p.f0i, fi, { splitEnd: fi * hop }), mk(p, fi, p.f1i, { splitStart: fi * hop }));
    }
    out.push(...parts);
  }
  return out;
}
// Bölme noktası ekle: notanın düzenlemesi (etiket, ses düzeltmesi, zaman kaydırması) iki yarıya da geçer
function addNoteSplit(proj, note, t, spq) {
  proj.noteSplits = proj.noteSplits || [];
  if (proj.noteSplits.some((x) => Math.abs(x - t) < 0.002)) return false;
  proj.noteSplits.push(t); proj.noteSplits.sort((a, b) => a - b);
  const e = findEdit(proj.noteEdits || [], note);
  if (e) {
    const e2 = Object.assign({}, e, { t0: t, t1: Math.max(e.t1, note.t1) });
    if (e.q0to != null) e2.q0to = e.q0to + (t - note.t0) / spq; // zamanı kaydırılmış notanın ikinci yarısı da aynı kadar kayar
    e.t1 = t;
    proj.noteEdits.push(e2);
  }
  return true;
}
// Bölmeyi geri al: iki yarının düzenlemeleri birleşir (soldaki öncelikli)
function removeNoteSplit(proj, t, spq) {
  const i = (proj.noteSplits || []).findIndex((x) => Math.abs(x - t) < 0.002);
  if (i < 0) return false;
  proj.noteSplits.splice(i, 1);
  const edits = proj.noteEdits || [];
  const left = edits.find((e) => Math.abs(e.t1 - t) < 0.002), right = edits.find((e) => Math.abs(e.t0 - t) < 0.002);
  if (left && right && left !== right) {
    left.t1 = right.t1;
    for (const k of ['target', 'label']) if (left[k] == null && right[k] != null) left[k] = right[k];
    if (!left.locked && right.locked) left.locked = true;
    if (left.q0to == null && right.q0to != null) left.q0to = right.q0to - (t - left.t0) / spq;
    proj.noteEdits = edits.filter((e) => e !== right);
  }
  return true;
}

// ---------------------------------------------------------------- ŞARKIYI KAYDIR (başa boşluk bırak / boşluğu azalt)
// Ses n ölçü geç (n<0: erken) başlar. Ölçü numarasına bağlı her şey (bölümler, akor kilitleri, işaretler, zaman kaydırmaları,
// akor/davul başlangıcı) şarkıyla birlikte kayar; orijinal ses ve tap noktaları (kayıt zamanı) değişmez.
// Akor/davul başlangıcı 1. ölçüdeyse (varsayılan) yerinde kalır: boşluğa giriş çalabilirsin.
function shiftSong(proj, nBars) {
  const g = makeGrid(proj.settings), n = Math.round(nBars);
  if (!n) return proj;
  proj.audio.leadBars = (proj.audio.leadBars || 0) + n;
  const mv = (b) => b + n;
  proj.sections = (proj.sections || []).map((s) => Object.assign({}, s, { startBar: Math.max(1, mv(s.startBar)), endBar: mv(s.endBar) })).filter((s) => s.endBar >= s.startBar);
  const byBar = (arr) => (arr || []).map((x) => Object.assign({}, x, { bar: mv(x.bar) })).filter((x) => x.bar >= 1);
  proj.chordLocks = byBar(proj.chordLocks); proj.chordPins = byBar(proj.chordPins); proj.changeMarks = byBar(proj.changeMarks);
  for (const e of proj.noteEdits || []) if (e.q0to != null) e.q0to += n * g.barQ;
  if ((proj.chordStartBar || 1) > 1) proj.chordStartBar = Math.max(1, mv(proj.chordStartBar));
  if (proj.drums && (proj.drums.startBar || 1) > 1) proj.drums.startBar = Math.max(1, mv(proj.drums.startBar));
  return proj;
}

// ---------------------------------------------------------------- PIPELINE (UI ve test ortak)
function newProject() {
  return {
    version: 1,
    settings: { bpm: 120, meter: '4/4', latencyMs: 0, clickFeel: 'normal' },
    audio: { offsetSec: 0, alignMode: 'none', leadBars: 0 }, // leadBars: şarkının başındaki boş ölçü sayısı (kaydırma)
    pitch: Object.assign({}, PITCH_DEFAULTS, SEG_DEFAULTS),
    sections: [],
    matrix: { enabled: false, rows: {} },
    preserveChords: false,
    pack: { id: null, selectedId: null, locks: { piano: false, guitar: false, bass: false, drums: false } },
    versions: { activeId: null, items: [] },
    noteEdits: [],
    autotune: Object.assign({}, AUTOTUNE_DEFAULTS, { customSets: {} }),
    chordOpts: Object.assign({}, CHORD_DEFAULTS),
    chordLocks: [], chordPins: [], changeMarks: [], chordChoices: [],
    swing: { ratio: 0.5 }, // alt bölme: 0,5 düz · 0,667 üçleme · arası swing (ölçülen %70 → 0,70); gitar ve bas da aynı ızgaraya oturur
    chordStartBar: 1, noteSplits: [], // akorların girdiği ilk ölçü (bu ölçü akorlar için 1. ölçüdür); çift tıkla bölünen yerler (kayıttaki saniye)
    piano: Object.assign({}, PIANO_DEFAULTS),
    mixer: { vocal: { vol: 0, mute: false, solo: false }, piano: { vol: -6, mute: false, solo: false }, drums: { vol: -8, mute: false, solo: false }, guitar: { vol: -4, mute: false, solo: false }, bass: { vol: -4, mute: false, solo: false }, ab: 'corrected', pedal: false, click: false },
    drums: { on: false, loop: 'auto', startBar: 1, fills: true }, // startBar: davulun girdiği ilk ölçü (loop'un 1. ölçüsü burası) · fills: bölüm geçişlerinde davul fill'i
    guitar: root.Core && root.Core.defaultGuitarState ? root.Core.defaultGuitarState('4/4') : null, // gitar katmanı (guitar.js): enstrüman seçimi, bölüm bazlı partiler, presetler
    bass: root.Core && root.Core.Bass ? root.Core.Bass.defaultBassTrack() : null, // bas katmanı (bass.js): üretilen notalar, bölüm ayarları, döngüler, profiller
    vocalFx: root.Core && root.Core.VFX_DEFAULTS ? Object.assign({}, root.Core.VFX_DEFAULTS) : { on: false }, // vokal temizliği (vocalfx.js)
    quant: { grid: '1/8', strength: 100 }, taps: [],
  };
}
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
function findEdit(edits, n) {
  let best = null, bo = 0;
  for (const e of edits) {
    const o = overlap(n.t0, n.t1, e.t0, e.t1);
    if (o > bo && o >= 0.5 * Math.min(n.t1 - n.t0, e.t1 - e.t0)) { bo = o; best = e; }
  }
  return best;
}
function totalBars(proj, duration) {
  const g = makeGrid(proj.settings);
  const d = duration ? duration - effectiveOffset(proj) : 0;
  const maxSec = Math.max(0, ...proj.sections.map((s) => s.endBar * g.barSec));
  return Math.max(4, Math.ceil(Math.max(d, maxSec) / g.barSec - 1e-6));
}
// Şarkıyı kaydırma (leadBars): ses zaman çizelgesinde bu kadar ölçü geç başlar; ölçü çizgileri, bölümler, kilitler yerinde kalır
const effectiveOffset = (proj) => (proj.audio.offsetSec || 0) + (proj.audio.source === 'record' ? (proj.settings.latencyMs || 0) / 1000 : 0) - (proj.audio.leadBars || 0) * makeGrid(proj.settings).barSec;

// Senkron türetme aşamaları: notlar → ton önerileri → düzeltme → akorlar → voicing
function derive(proj, st) {
  const g = makeGrid(proj.settings);
  g.swing = proj.swing && proj.swing.ratio > 0.5 ? proj.swing.ratio : 0; // genel alt bölme: gitar ve bas olayları da bu ızgaraya oturur
  const off = effectiveOffset(proj);
  const bars = totalBars(proj, st.duration);
  let sections = proj.sections.map((s) => Object.assign({ link: null }, s));
  if (!sections.length) { // bölüm yok: tüm şarkı; son bölüm silindiyse tonu saklanır (proj.implicitKey) ki akorlar aynı anahtarda kalsın
    const ik = proj.implicitKey && proj.implicitKey.tonic != null && proj.implicitKey.mode ? { tonic: proj.implicitKey.tonic, mode: proj.implicitKey.mode } : {};
    sections = [Object.assign({ id: '_all', name: 'Tümü', startBar: 1, endBar: bars, implicit: true }, ik)];
  }
  sections.sort((a, b) => a.startBar - b.startBar);
  const secOfQ = (q) => { const bar = Math.floor(q / g.barQ + 1e-6) + 1; return sections.find((s) => bar >= s.startBar && bar <= s.endBar) || null; };
  // 3) notalar (zaman çizelgesi + düzenlemeler)
  // kişisel akort referansı → notanın kimliği (yarım ses) bu referansa göre yuvarlanır
  const tuning = proj.pitch.tuning === 'a440' || !(st.rawNotes || []).length
    ? { global: 0, perNote: (st.rawNotes || []).map(() => 0), driftMin: 0, driftMax: 0, a4: 440, off: true }
    : tuningReference(st.rawNotes, { windowSec: proj.pitch.tuningWindowSec });
  // zaman haritası: quantize / yatay sürükleme ile notaların yeni başlangıçları (q0to, çeyrek) → ses bütün olarak kayar
  const timeMap = root.Core && root.Core.buildTimeMap
    ? root.Core.buildTimeMap((st.rawNotes || []).map((r) => { const ed = findEdit(proj.noteEdits, r); return { a: r.t0, e: r.t1, b: ed && ed.q0to != null ? ed.q0to * g.spq + off : null }; }), st.duration)
    : { identity: true, fwd: (t) => t, inv: (t) => t, sig: '' };
  const notes = (st.rawNotes || []).map((r0, i) => {
    const ref = tuning.perNote[i] || 0;
    const nearest = Math.round(r0.median - ref / 100);
    const r = Object.assign({}, r0, { nearest, cents: Math.round((r0.median - ref / 100 - nearest) * 100), refCents: ref, absNearest: r0.nearest, absCents: r0.cents });
    const t0 = timeMap.fwd(r.t0) - off, t1 = timeMap.fwd(r.t1) - off;
    const n = Object.assign({}, r, { idx: i, id: 'n' + Math.round(r.t0 * 1000), tl0: t0, tl1: t1, q0: t0 / g.spq, q1: t1 / g.spq, detMidi: r.nearest, qOrig: (r.t0 - off) / g.spq });
    const ed = findEdit(proj.noteEdits, r);
    n.edit = ed;
    n.q0to = ed && ed.q0to != null ? ed.q0to : null;
    n.label = ed && ed.label != null ? ed.label : null;
    n.manualTarget = ed && ed.target != null ? ed.target : null;
    n.locked = !!(ed && (ed.locked || ed.target != null));
    const s = secOfQ(n.q0 + 0.12 * g.pulseQ);
    n.section = s ? s.id : null;
    return n;
  });
  // 4) bölüm tonları (öneri her zaman algılanan notalardan)
  const keyInfo = {};
  let prevKey = null; // yumuşak ton sürekliliği: önceki bölümün (onaylı ya da önerilen) tonu
  for (const s of sections) {
    const q0 = (s.startBar - 1) * g.barQ, q1 = s.endBar * g.barQ;
    const sn = notes.filter((n) => n.q0 >= q0 - 0.12 * g.pulseQ && n.q0 < q1 - 0.12 * g.pulseQ);
    const sug = suggestKeys(sn, g, 3, prevKey);
    keyInfo[s.id] = sug;
    s.confirmed = s.tonic != null && !!s.mode;
    if (!s.confirmed && sug.candidates.length) { s.tonic = sug.candidates[0].tonic; s.mode = sug.candidates[0].mode; s.provisional = true; }
    s.pcs = s.tonic != null && s.mode ? scalePcs(s.tonic, s.mode) : null;
    s.typeNorm = normSectionType(s.type || s.name); // stil modelinde mod × tip havuzlaması için
    if (s.tonic != null && s.mode) prevKey = { tonic: s.tonic, mode: s.mode };
  }
  const secById = new Map(sections.map((s) => [s.id, s]));
  for (const n of notes) { const s = secById.get(n.section); n.scalePcs = s ? s.pcs : null; }
  // 5) düzeltme
  let correction = null;
  if (st.track) {
    correction = computeCorrection(st.track, notes, proj.autotune, g);
    notes.forEach((n, i) => {
      const inf = correction.info[i];
      n.corr = inf;
      n.soundMidi = n.median + inf.applied / 100;
    });
  }
  // Akor bulucu DUYULAN notayı kullanır:
  //  - etiket (kullanıcı düzeltmesi; "notayı taşı" da etiket koyar) varsa o,
  //  - yoksa autotune notayı başka bir yarım sese taşıdıysa (scale veya custom, miktar ≥ %50) autotune'un hedefi,
  //  - yoksa söylenen nota. "En yakın yarım ses" autotune'u notanın yarım sesini zaten değiştirmez.
  // Ton önerisi (4. adım) bundan önce, söylenen notalarla hesaplanır: autotune seçili scale'i kendi kendine doğrulamaz.
  for (const n of notes) {
    n.sungMidi = n.label != null ? n.label : n.nearest;
    const at = n.corr;
    n.autoMoved = n.label == null && !!at && at.source === 'auto' && at.identityChange && proj.autotune.amount >= 50 && at.target !== n.nearest;
    // duyulan nota: etiket (senin düzeltmen) > elle ses düzeltmesinin hedefi > autotune'un taşıdığı nota > söylenen
    const manualHeard = n.label == null && at && at.source === 'manual' && at.target != null ? Math.round(at.target) : null;
    n.effMidi = manualHeard != null ? manualHeard : n.autoMoved ? at.target : n.sungMidi;
    n.inScale = n.scalePcs ? n.scalePcs.includes(mod12(n.effMidi)) : true;
    // tam tonunda söylenmiş ama scale dışı → büyük ihtimalle kasıtlı: "mod yanlış olabilir" (söylenen notaya göre)
    n.modeSuspect = !!n.scalePcs && !n.scalePcs.includes(mod12(n.sungMidi)) && n.label == null && Math.abs(n.cents) <= IN_TUNE_CENTS;
  }
  for (const n of notes) n.cw = chordWeight(n, g);
  // 6) akorlar
  // engineOverride: etkileşim sırasında (nota sürükleme) hızlı motor; bırakınca seçili motorla yeniden hesaplanır
  const chordOpts = Object.assign({}, proj.chordOpts, { marks: proj.changeMarks || [] }, st.style ? { style: st.style } : {}, st.engineOverride ? { engine: st.engineOverride } : {});
  // Kullanıcı kilitleri + "kilit sonrası sabit tutulan" akorlar (pins). Bir akor kilitlenince diğer akorlar
  // olduğu gibi kalır; motorun aksi yöndeki tercihi yalnızca öneri (pinSuggest) olarak, gerekçesiyle gösterilir.
  const userLocks = proj.chordLocks || [];
  const covers = (l, bar, half) => l.bar === bar && (l.half == null || half == null || l.half === half);
  const pins = (proj.chordPins || []).filter((p) => !userLocks.some((l) => covers(l, p.bar, p.half)));
  // akorların girdiği ilk ölçü: bu ölçü akor motoru için 1. ölçüdür (bölüm başı = ev akoru tercihi, ortak nota vb.);
  // öncesinde akor ve piyano yoktur. Bölümler (ton önerisi, görünüm) olduğu gibi kalır.
  const chordStart = Math.max(1, Math.round(proj.chordStartBar || 1));
  const chordSections = chordStart > 1 ? sections.filter((s) => s.endBar >= chordStart).map((s) => (s.startBar < chordStart ? Object.assign({}, s, { startBar: chordStart }) : s)) : sections;
  let chords = buildChords(notes, chordSections, g, chordOpts, [...userLocks, ...pins]);
  for (const sl of chords) {
    const ul = userLocks.find((l) => covers(l, sl.bar, sl.half));
    sl.locked = !!ul;
    sl.lockSrc = ul ? ul.src || 'user' : null;
    sl.pinned = !sl.locked && pins.some((p) => covers(p, sl.bar, sl.half));
    if (sl.pinned) sl.reason = 'sabit: bir akoru kilitlediğinde diğerleri değişmez';
  }
  const linked = { g, sections, chords };
  if (root.Core.resolveLinkedChords) chords = root.Core.resolveLinkedChords(proj, linked);
  // 8) voicing
  voiceChords(chords, notes, sections, { pedal: proj.mixer.pedal });
  // motorun kilitler varken (pin olmadan) ne seçeceği → sabit akorlar için öneri + neden
  if (pins.length) {
    const free = buildChords(notes, chordSections, g, chordOpts, userLocks);
    chords.forEach((sl, i) => {
      if (!sl.pinned) return;
      const mid = (sl.q0 + sl.q1) / 2;
      const f = free.find((x) => mid >= x.q0 && mid < x.q1);
      if (!f || sameChord(f.chord, sl.chord)) return;
      const sec = sections.find((x) => x.id === sl.section);
      const sn = slotNotes(notes, sl.q0, sl.q1, g);
      const prevC = i > 0 && chords[i - 1].section === sl.section ? chords[i - 1].chord : null;
      const nextC = chords[i + 1] && chords[i + 1].section === sl.section ? chords[i + 1].chord : null;
      sl.pinSuggest = Object.assign({ chord: { root: f.chord.root, q: f.chord.q } }, adviseSwap(sl.chord, f.chord, sn, prevC, nextC, sec, st.style, chordOpts.colorPenalty || 0));
    });
  }
  // kilitli akor için uyarı/öneriler: sürtünme (önemli), renk ve çevrim (isteğe bağlı)
  chords.forEach((sl) => { if (sl.locked) { sl.lockAdvice = lockAdvice(sl, slotNotes(notes, sl.q0, sl.q1, g), chordOpts.colorPenalty || 0); sl.suggest = null; } });
  return { g, off, bars, sections, notes, keyInfo, correction, chords, tuning, timeMap, chordStart, linkWarnings: linked.linkWarnings || [] };
}

// ---------------------------------------------------------------- AKOR SESİ: piyano / synth klavye × akor / arpej
// style: 'piano-chord' | 'piano-arp' | 'synth-chord' | 'synth-arp'
// repeat: 'off' = her ölçüde akor yeniden basılır · 'hold' = aynı akor art arda gelince bir kez basılır, sonraki ölçülerde sürer ·
//         'fade' = bir kez basılır, uzayan ölçülerde yavaşça söner (fade-out). holdBars: tek vuruşun en fazla kaç ölçü süreceği.
const PIANO_STYLES = {
  'piano-chord': { inst: 'piano', pattern: 'chord', name: 'Piyano — akor' },
  'piano-arp': { inst: 'piano', pattern: 'arp', name: 'Piyano — arpej' },
  'synth-chord': { inst: 'synth', pattern: 'chord', name: 'Synth klavye — akor' },
  'synth-arp': { inst: 'synth', pattern: 'arp', name: 'Synth klavye — arpej' },
  'piano-shuffle': { inst: 'piano', pattern: 'shuffle', name: 'Piyano — shuffle (X . t)' },
  'synth-shuffle': { inst: 'synth', pattern: 'shuffle', name: 'Synth klavye — shuffle (X . t)' },
};
const ARP_RATES = { '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
const PIANO_DEFAULTS = { style: 'piano-chord', repeat: 'hold', holdBars: 2, rate: '1/8' };
// proje ayarından (proj.piano) pianoEvents / render seçenekleri
function pianoOpts(p, swing) {
  const q = Object.assign({}, PIANO_DEFAULTS, p || {});
  const st = PIANO_STYLES[q.style] || PIANO_STYLES['piano-chord'];
  return { inst: st.inst, pattern: st.pattern, repeat: ['off', 'hold', 'fade'].includes(q.repeat) ? q.repeat : 'hold', holdBars: clamp(Math.round(q.holdBars) || 2, 1, 16), rate: ARP_RATES[q.rate] ? q.rate : '1/8', swing: swing || 0.5 };
}
const sameVoicing = (a, b) => !!a && !!b && a.bass === b.bass && a.notes.length === b.notes.length && a.notes.every((m, i) => m === b.notes[i]);
// Art arda gelen AYNI akor (aynı seslendirme, aynı bölüm) tek vuruşta birleşir: ilk ölçünün başında bir kez basılır,
// sonraki ölçüye sürer. En fazla holdBars ölçü; sonrasında yeniden basılır.
function holdGroups(chords, g, o) {
  const groups = [], maxQ = o.holdBars * g.barQ;
  for (const c of chords) {
    if (!c.voicing) continue;
    const last = groups[groups.length - 1];
    if (o.repeat !== 'off' && last && last.section === c.section && Math.abs(last.q1 - c.q0) < 1e-6 && sameChord(last.chord, c.chord) && sameVoicing(last.voicing, c.voicing) && c.q1 - last.q0 <= maxQ + 1e-6) {
      last.q1 = c.q1; last.n++;
    } else groups.push({ q0: c.q0, q1: c.q1, chord: c.chord, voicing: c.voicing, section: c.section, n: 1 });
  }
  return groups;
}
// Nota olayları (oynatma + MIDI + mix): {t, dur, midi, vel, q0, q1, [hold, rel, fade, arp]}
//  dur = olayın kapladığı süre (MIDI nota uzunluğu); hold = piyanoda tuşun basılı kaldığı süre; rel = bırakma süresi;
//  fade = synth'te seviye dur boyunca söner; arp = arpej notası.
function pianoEvents(chords, g, opts = {}) {
  const o = Object.assign({ inst: 'piano', pattern: 'chord', repeat: 'off', holdBars: 2, rate: '1/8', swing: 0.5 }, opts);
  const ev = [];
  for (const gr of holdGroups(chords, g, o)) {
    const t = gr.q0 * g.spq, dur = (gr.q1 - gr.q0) * g.spq, fade = o.repeat === 'fade' && gr.n > 1;
    const v = gr.voicing;
    if (o.pattern === 'arp') {
      // bas + akor sesleri aşağıdan yukarı, sonra geri (yukarı-aşağı); tutulan akorda desen kesintisiz sürer
      const tones = [v.bass, ...v.notes].sort((a, b) => a - b), k = tones.length;
      const seq = [];
      for (let i = 0; i < k; i++) seq.push(i);
      for (let i = k - 2; i >= 1; i--) seq.push(i);
      const stepQ = ARP_RATES[o.rate] || 0.5, steps = Math.max(1, Math.floor((gr.q1 - gr.q0) / stepQ + 1e-6));
      for (let i = 0; i < steps; i++) {
        const q = swingMap(gr.q0 + i * stepQ, g, o.swing, 0.5), idx = seq[i % seq.length]; // swing: zayıf sekizlikler oranına kayar
        const f = fade ? 1 - 0.65 * ((q - gr.q0) / (gr.q1 - gr.q0)) : 1; // fade: desen yavaşça kısılır
        const vel = Math.round((idx === 0 ? 74 : 60) * f);
        const d = stepQ * g.spq * (o.inst === 'piano' ? 1.8 : 0.95);
        ev.push({ t: q * g.spq, dur: d, midi: tones[idx], vel, q0: q, q1: Math.min(gr.q1, q + d / g.spq), arp: true, inst: o.inst });
      }
      continue;
    }
    if (o.pattern === 'shuffle') {
      // her vuruşta aynı hücre: X (güçlü akor) . t (zayıf ghost akor, vuruşun 3'te 2'sinde = "let"); ghost swing oranına oturur
      const P = g.pulseQ, nb = Math.max(1, Math.floor((gr.q1 - gr.q0) / P + 1e-6));
      for (let j = 0; j < nb; j++) {
        const qx = gr.q0 + j * P, qg = swingMap(qx + (P * 2) / 3, g, o.swing, 2 / 3), f = fade ? 1 - 0.65 * (j / nb) : 1;
        const xd = (qg - qx) * g.spq * 0.95;
        const hit = (q, d, mids, vel) => { for (const m of mids) ev.push({ t: q * g.spq, dur: d, midi: m, vel: Math.max(1, Math.round(vel * f)), q0: q, q1: q + d / g.spq, shuf: true, inst: o.inst }); };
        hit(qx, xd, [v.bass], 80); hit(qx, xd, v.notes, 66);
        if (qg < gr.q1 - 1e-6) hit(qg, Math.max(0.05, Math.min(qx + P, gr.q1) - qg) * g.spq * 0.6, v.notes, 30); // t: hafif ghost
      }
      continue;
    }
    const add = (midi, vel) => {
      const e = { t, dur, midi, vel, q0: gr.q0, q1: gr.q1, inst: o.inst };
      if (fade) { e.fade = true; e.hold = dur * 0.35; e.rel = clamp(dur * 0.9, 0.8, 6); }
      ev.push(e);
    };
    add(v.bass, 78);
    for (const m of v.notes) add(m, 62);
  }
  return ev;
}
function chordChart(proj, d) {
  const lines = [`Tempo: ${proj.settings.bpm} BPM · Ölçü: ${proj.settings.meter}`, ''];
  for (const s of d.sections) {
    const key = s.tonic != null ? keyName(s.tonic, s.mode) + (s.provisional ? ' (öneri)' : '') : '—';
    lines.push(`[${s.name}] ${key} — ölçü ${s.startBar}–${s.endBar}`);
    const bars = [];
    for (let b = s.startBar; b <= s.endBar; b++) {
      const cs = d.chords.filter((c) => c.bar === b && c.section === s.id).map((c) => chordName(Object.assign({}, c.chord, { bass: c.chord.bass ?? (c.inversion ? c.voicing.bassPc : null) }), c.flats));
      bars.push(' ' + (cs.join(' ') || (b < (d.chordStart || 1) ? '' : '%')) + ' '); // akorların girdiği ilk ölçüden önce hücre boş (otomatik)
    }
    for (let i = 0; i < bars.length; i += 4) lines.push('|' + bars.slice(i, i + 4).join('|') + '|');
    lines.push('');
  }
  return lines.join('\n');
}
// ---------------------------------------------------------------- AKOR ŞABLONU (kendi progresyonun)
// Biçim (chordChart çıktısıyla aynı; geri yüklenebilir):
//   # yorum                          Tempo: 120 BPM · Ölçü: 4/4   (isteğe bağlı, yalnızca denetim)
//   [Verse] C# Frig — ölçü 1–4        (bölüm başlığı; ton ve ölçü aralığı isteğe bağlı)
//   | C#m | Dmaj7 | C#m | D C#m |     (her hücre 1 ölçü; hücrede 2 akor = yarım ölçü; "/" "-" "." önceki akor sürer)
//   |  %  |       |                   (% = önceki ölçü tekrar; boş hücre = otomatik, motor seçer)
//   C#m:2 D:1 C#m                     (çizgisiz: her akor 1 ölçü, ":n" ile n ölçü, 0.5 = yarım ölçü)
const MODE_WORDS = (() => {
  const m = new Map();
  const add = (k, v) => m.set(k.toLocaleLowerCase('tr'), v);
  for (const k of MODE_ORDER) { add(k, k); add(MODES[k].name, k); add(MODES[k].short, k); }
  [['major', 'major'], ['majör', 'major'], ['ionian', 'major'], ['iyonyen', 'major'], ['maj', 'major'], ['minor', 'minor'], ['minör', 'minor'], ['min', 'minor'], ['aeolian', 'minor'], ['eolyen', 'minor'], ['m', 'minor'],
    ['harmonic minor', 'harmonicMinor'], ['harmonik minör', 'harmonicMinor'], ['phrygian', 'phrygian'], ['frig', 'phrygian'], ['frigyen', 'phrygian'], ['dorian', 'dorian'], ['dor', 'dorian'],
    ['lydian', 'lydian'], ['lidya', 'lydian'], ['lidyen', 'lydian'], ['mixolydian', 'mixolydian'], ['miksolidya', 'mixolydian'], ['miksolidyen', 'mixolydian'], ['locrian', 'locrian'], ['lokriyen', 'locrian'],
    ['major pentatonic', 'majorPent'], ['majör pentatonik', 'majorPent'], ['minor pentatonic', 'minorPent'], ['minör pentatonik', 'minorPent']].forEach(([k, v]) => add(k, v));
  return m;
})();
function parseKeyText(t) {
  const s = String(t || '').replace(/\(öneri\)/g, '').trim();
  const r = parsePc(s);
  if (!r) return null;
  const rest = s.slice(r.len).trim().toLocaleLowerCase('tr').replace(/[.]+$/, '');
  const mode = rest === '' ? 'major' : MODE_WORDS.get(rest);
  return mode ? { tonic: r.pc, mode } : null;
}
function parseChordChart(text, meter = '4/4') {
  const g = makeGrid({ bpm: 120, meter });
  const per = g.split ? 2 : 1;
  const errors = [], warnings = [], sections = [], cells = []; // cells: {bar, half(0|1|null), chord|null, line}
  const meta = {};
  let bar = 1, prev = null, curSec = null;
  const NC = /^(n\.?c\.?|nc|x)$/i, CONT = /^(\/|-|\.|–)$/;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, li) => {
    const ln = li + 1, line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || /^(#|\/\/)/.test(line)) return;
    const tm = /tempo\s*[:=]\s*(\d+(?:[.,]\d+)?)/i.exec(line), mm = /ölçü\s*[:=]\s*(\d+\/\d+)|meter\s*[:=]\s*(\d+\/\d+)|time\s*[:=]\s*(\d+\/\d+)/i.exec(line);
    if ((tm || mm) && !line.includes('|') && !line.startsWith('[')) { if (tm) meta.bpm = +tm[1].replace(',', '.'); if (mm) meta.meter = mm[1] || mm[2] || mm[3]; return; }
    const hm = /^\[([^\]:]+)(?::\s*([^\]]+))?\]\s*(.*)$/.exec(line);
    if (hm) {
      let rest = hm[3] || '';
      const rg = /(?:ölçü|bars?|ölçüler)\s*(\d+)\s*(?:[–\-]\s*(\d+))?/i.exec(rest);
      if (rg) { bar = +rg[1]; rest = rest.slice(0, rg.index); }
      const keyTxt = (hm[2] || rest.replace(/[—–-]\s*$/, '')).trim();
      const key = keyTxt && keyTxt !== '—' ? parseKeyText(keyTxt) : null;
      if (keyTxt && keyTxt !== '—' && !key) warnings.push(`Satır ${ln}: "${keyTxt}" ton olarak anlaşılamadı; bölüm tonu öneriden gelecek.`);
      curSec = { name: hm[1].trim(), tonic: key ? key.tonic : null, mode: key ? key.mode : null, startBar: bar, endBar: bar - 1 + (rg && rg[2] ? +rg[2] - +rg[1] + 1 : 0), line: ln, explicitEnd: !!(rg && rg[2]) };
      sections.push(curSec);
      prev = null;
      return;
    }
    const chordOf = (tok) => {
      if (NC.test(tok)) return 'NC';
      const c = parseChord(tok);
      if (!c) { errors.push(`Satır ${ln}: "${tok}" akor olarak anlaşılamadı`); return undefined; }
      return c;
    };
    const putBar = (toks) => {
      // hücredeki her işaret ölçünün eşit bir parçası; devam işaretleri önceki akoru sürdürür
      if (!toks.length) { cells.push({ bar, half: null, chord: null, line: ln }); bar++; return; }
      if (toks.length === 1 && toks[0] === '%') { if (!prev) errors.push(`Satır ${ln}: "%" için önceki akor yok`); else cells.push({ bar, half: null, chord: prev, line: ln }); bar++; return; }
      const seq = [];
      for (const t of toks) {
        if (CONT.test(t) || t === '%') { if (!prev && !seq.length) { errors.push(`Satır ${ln}: "${t}" için önceki akor yok`); return; } seq.push(seq.length ? seq[seq.length - 1] : prev); continue; }
        const c = chordOf(t);
        if (c === undefined) return;
        seq.push(c);
      }
      const at = (pos) => seq[Math.min(seq.length - 1, Math.floor(pos * seq.length + 1e-9))];
      const h0 = at(0), h1 = per === 2 ? at(0.5) : h0;
      const distinct = seq.filter((c, i) => i === 0 || c !== seq[i - 1]);
      const kept = per === 2 ? [h0, h1] : [h0];
      const lost = distinct.filter((c) => !kept.includes(c));
      if (lost.length) warnings.push(`Satır ${ln}, ölçü ${bar}: ${per === 2 ? 'ölçüde en fazla 2 akor (yarım ölçü)' : `${meter} ölçüde ölçü başına 1 akor`} yerleşebilir; ${lost.map((c) => (c === 'NC' ? 'N.C.' : chordName(c))).join(', ')} atlandı.`);
      if (per === 2 && h0 !== h1) { cells.push({ bar, half: 0, chord: h0, line: ln }); cells.push({ bar, half: 1, chord: h1, line: ln }); }
      else cells.push({ bar, half: null, chord: h0, line: ln });
      prev = seq[seq.length - 1];
      bar++;
    };
    if (line.includes('|')) {
      const parts = line.split('|');
      if (parts[0].trim() === '') parts.shift();
      if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
      for (const p of parts) putBar(p.trim().split(/\s+/).filter(Boolean));
    } else {
      // çizgisiz: "C#m:2 D C#m:0.5" — süre ölçü cinsinden, yarım ölçü adımlı
      let halfAcc = 0; // bu ölçüde dolu yarım sayısı (0/1)
      for (const tok of line.split(/[\s,]+/).filter(Boolean)) {
        const m = /^(.+?)(?::(\d+(?:[.,]\d+)?))?$/.exec(tok);
        const dur = m[2] ? +m[2].replace(',', '.') : 1;
        let c = m[1] === '%' || CONT.test(m[1]) ? prev : chordOf(m[1]);
        if (c === undefined) continue;
        if (c == null) { errors.push(`Satır ${ln}: "${m[1]}" için önceki akor yok`); continue; }
        let halves = Math.round(dur * 2);
        if (halves < 1 || Math.abs(dur * 2 - halves) > 1e-6) { errors.push(`Satır ${ln}: "${tok}" süresi yarım ölçünün katı olmalı (0.5, 1, 1.5, 2…)`); continue; }
        if (per === 1 && halves % 2) { warnings.push(`Satır ${ln}: ${meter} ölçüde yarım ölçü yok; "${tok}" tam ölçüye yuvarlandı.`); halves += 1; }
        while (halves > 0) {
          if (halfAcc === 0 && halves >= 2) { cells.push({ bar, half: null, chord: c, line: ln }); bar++; halves -= 2; }
          else { cells.push({ bar, half: halfAcc, chord: c, line: ln }); halfAcc = 1 - halfAcc; if (halfAcc === 0) bar++; halves -= 1; }
        }
        prev = c;
      }
      if (halfAcc === 1) { warnings.push(`Satır ${ln}: son akor yarım ölçüde bitiyor; ölçünün ikinci yarısı otomatik kaldı.`); bar++; }
    }
    if (curSec && !curSec.explicitEnd) curSec.endBar = bar - 1;
  });
  for (const sct of sections) if (sct.endBar < sct.startBar) sct.endBar = sct.startBar;
  if (meta.meter && meta.meter !== meter) warnings.push(`Şablon ${meta.meter} ölçüye göre yazılmış, proje ${meter}: ölçüler kayabilir.`);
  // N.C. → kilit yok (o yer otomatik kalır)
  const place = [];
  for (const c of cells) {
    if (c.chord === 'NC') { warnings.push(`Satır ${c.line}, ölçü ${c.bar}: N.C. (akorsuz) desteklenmiyor; orası otomatik bırakıldı.`); continue; }
    place.push(c);
  }
  return { meta, sections, cells: place, errors, warnings, bars: bar - 1 };
}
// Boş şablon: projenin bölümleri ve ölçüleri, hücreler boş (boş = otomatik)
function blankChart(proj, d) {
  const lines = [`# Kendi akorların: her hücre 1 ölçü. Hücrede 2 akor = yarım ölçü. Boş hücre = otomatik (motor seçer). % = önceki ölçü tekrar.`,
    `Tempo: ${proj.settings.bpm} BPM · Ölçü: ${proj.settings.meter}`, ''];
  const secs = d.sections.filter((s) => !s.implicit);
  const list = secs.length ? secs : [{ name: 'Şarkı', startBar: 1, endBar: d.bars, tonic: null }];
  for (const s of list) {
    lines.push(`[${s.name}] ${s.tonic != null ? keyName(s.tonic, s.mode) : ''} — ölçü ${s.startBar}–${s.endBar}`.replace('  —', ' —'));
    const n = s.endBar - s.startBar + 1;
    for (let i = 0; i < n; i += 4) lines.push('|' + Array.from({ length: Math.min(4, n - i) }, () => '       ').join('|') + '|');
    lines.push('');
  }
  return lines.join('\n');
}
// Genel alt bölme (proj.swing.ratio; derive'da g.swing olur) gitar ve basa da uygulanır: gitar parçasının kendi swing'i (0..1: 0 düz, 1 üçleme)
// en az genel orana denk gelir (elle ayarlanan daha büyük değer korunur); bas olayları aynı vuruş içi eşleme (swingMap) ile kayar.
const swingToPart = (r) => (r > 0.5 ? Math.min(1.5, (r - 0.5) * 6) : 0); // 1 = tam üçleme (%67); %70 → 1,2
// drums: davul loop'u (eski kullanım) ya da { name, events } (bölüm düzenlemesi + fill'li hazır olaylar)
function exportMidi(proj, d, drums = null) {
  const g = d.g;
  const vocal = d.notes.filter((n) => n.effMidi != null).map((n) => ({ q0: n.q0, q1: n.q1, midi: n.effMidi, vel: 96 }));
  const sw = proj.swing && proj.swing.ratio, po = pianoOpts(proj.piano, sw);
  const ins = proj.guitar && proj.guitar.instrument ? proj.guitar.instrument : 'piano'; // piyano / gitar / ikisi
  const events = root.Core.arrangedEvents(d, proj, { midi: true, drums });
  const piano = events.piano.map((e) => ({ q0: e.q0, q1: e.q1, midi: e.midi, vel: e.vel }));
  const gtr = events.guitar.filter((e) => e.midi != null)
    .map((e) => ({ q0: e.t / g.spq, q1: (e.t + e.dur) / g.spq, midi: e.midi, vel: Math.round(30 + 90 * e.vel) }));
  const bass = events.bass.map((e) => {
    const durQ = e.dur / g.spq, length = Math.max(0.05, durQ * (e.gate ?? 1));
    return { q0: e.q, q1: e.q + (proj.matrix?.enabled ? Math.min(durQ, length) : length), midi: e.midi, vel: e.vel };
  });
  const texts = d.chords.map((c) => ({ q: c.q0, text: chordName(c.chord, c.flats) }));
  const markers = d.sections.map((s) => ({ q: (s.startBar - 1) * g.barQ, text: s.name + (s.tonic != null ? ' — ' + keyName(s.tonic, s.mode) : '') }));
  // GM programı: piyano 0 · synth akor "Pad 3 polysynth" 90 · synth arpej "Lead 2 sawtooth" 81
  const program = po.inst === 'piano' ? 0 : po.pattern === 'arp' ? 81 : 90;
  const dr = drums ? { name: drums.name, events: events.drums } : null;
  return writeMidi({
    quarterBpm: g.quarterBpm, meter: proj.settings.meter, markers,
    tracks: [
      { name: 'Vokal (düzeltilmiş melodi)', channel: 0, program: 53, notes: vocal },
      ...(ins === 'guitar' ? [] : [{ name: po.inst === 'piano' && po.pattern === 'chord' ? 'Piyano akorları' : PIANO_STYLES[`${po.inst}-${po.pattern}`].name, channel: 1, program, notes: piano, texts }]),
      ...(gtr.length ? [{ name: 'Gitar', channel: 2, program: 25, notes: gtr, ...(ins === 'guitar' ? { texts } : {}) }] : []),
      ...(bass.length ? [{ name: 'Bas', channel: 3, program: proj.bass.instrumentType === 'synth' ? 38 : 33, notes: bass }] : []),
      ...(dr && dr.events && dr.events.length && root.Core && root.Core.GM_DRUM ? [{ name: 'Davul — ' + dr.name, channel: 9, program: 0,
        notes: dr.events.map((e) => ({ q0: e.q, q1: e.q + 0.1, midi: root.Core.GM_DRUM[e.kind], vel: Math.round(30 + 90 * e.vel) })) }] : []),
    ],
  });
}

// ---------------------------------------------------------------- base64 (proje dosyasına ses gömme)
function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ilk ses başlangıcı (yükleme hizalaması)
function firstOnset(x, sr) {
  const win = Math.round(0.01 * sr);
  let mx = 0;
  const e = [];
  for (let i = 0; i + win <= x.length; i += win) { let s = 0; for (let j = 0; j < win; j++) s += x[i + j] * x[i + j]; const r = Math.sqrt(s / win); e.push(r); mx = Math.max(mx, r); }
  const thr = mx * 0.1;
  for (let k = 0; k < e.length; k++) if (e[k] > thr) return (k * win) / sr;
  return 0;
}

// ---------------------------------------------------------------- gecikme kalibrasyonu
// x: mikrofon kaydı, clickTimes: click'lerin kayıttaki zamanları (s).
// Her click'in [pre, post] penceresinde alkış başlangıcını bulur; ofsetlerin medyanı = gecikme.
function measureLatency(x, sr, clickTimes, opts = {}) {
  const interval = clickTimes.length > 1 ? clickTimes[1] - clickTimes[0] : 1;
  const pre = opts.pre ?? 0.08, post = opts.post ?? Math.min(0.4, 0.8 * interval - pre);
  const win = Math.max(1, Math.round(0.0005 * sr));
  // yüksek geçiren (fark) + 0.5 ms kayan ortalama zarf
  const e = new Float32Array(x.length);
  let acc = 0;
  for (let i = 1; i < x.length; i++) {
    acc += Math.abs(x[i] - x[i - 1]);
    if (i >= win) acc -= Math.abs(x[i - win] - x[i - win - 1] || 0);
    e[i] = acc / win;
  }
  const offsets = [];
  for (const ct of clickTimes) {
    const a = Math.max(1, Math.round((ct - pre) * sr)), b = Math.min(x.length, Math.round((ct + post) * sr));
    if (b - a < win * 10) { offsets.push(null); continue; }
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, e[i]);
    const floor = median(e.subarray(a, Math.min(b, a + Math.round(0.03 * sr))).filter((_, k) => k % 8 === 0)) || 0;
    if (!(peak > 1e-4 && peak > 6 * floor)) { offsets.push(null); continue; }
    const thr = floor + 0.3 * (peak - floor);
    let on = null;
    for (let i = a; i < b; i++) if (e[i] >= thr) { on = i / sr; break; }
    offsets.push(on == null ? null : on - ct);
  }
  const valid = offsets.filter((v) => v != null);
  const med = valid.length ? median(valid) : NaN;
  const mad = valid.length ? median(valid.map((v) => Math.abs(v - med))) : NaN;
  return { offsets, detected: valid.length, latencyMs: Math.round(med * 1000), madMs: Math.round(mad * 1000 * 10) / 10 };
}

// ---------------------------------------------------------------- MIDI İÇE AKTARMA (.mid → proje)
// Tam okuyucu: tempo / ölçü olayları, iz adları, notalar (kapanışlarıyla), metin ve marker olayları.
function readMidiFile(bytes) {
  const d = bytes;
  const u32 = (i) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  if (d.length < 14 || d[0] !== 0x4d || d[1] !== 0x54 || d[2] !== 0x68 || d[3] !== 0x64) return { error: 'Bu bir MIDI dosyası değil (MThd başlığı yok).' };
  const fmt = (d[8] << 8) | d[9], ntr = (d[10] << 8) | d[11], div = (d[12] << 8) | d[13];
  if (div & 0x8000) return { error: 'SMPTE zamanlı MIDI desteklenmiyor (çeyrek nota bölümlü dosya gerekir).' };
  if (fmt === 2) return { error: 'Format 2 (bağımsız şarkılı) MIDI desteklenmiyor.' };
  const ppq = div, utf = new TextDecoder('utf-8'), tempos = [], sigs = [], tracks = [];
  let p = 8 + u32(4);
  for (let t = 0; t < ntr && p + 8 <= d.length; t++) {
    if (d[p] !== 0x4d || d[p + 1] !== 0x54 || d[p + 2] !== 0x72 || d[p + 3] !== 0x6b) break;
    const len = u32(p + 4), end = Math.min(d.length, p + 8 + len);
    p += 8;
    const tr = { index: t, name: '', notes: [], texts: [], programs: {}, channels: new Set(), lastTick: 0 };
    const open = new Map();
    let tick = 0, run = 0;
    const rv = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while ((b & 0x80) && p < end); return v; };
    const close = (key, at) => { const o = open.get(key); if (!o) return; const st = o.pop(); if (!o.length) open.delete(key); if (st) tr.notes.push({ tick0: st.tick, tick1: Math.max(at, st.tick + 1), midi: st.midi, vel: st.vel, ch: st.ch }); };
    while (p < end) {
      tick += rv();
      let st = d[p];
      if (st === 0xff) {
        p++; const type = d[p++], l = rv(), data = d.slice(p, p + l); p += l;
        if (type === 0x03) tr.name = utf.decode(data);
        else if (type === 0x01 || type === 0x06) tr.texts.push({ tick, text: utf.decode(data), type });
        else if (type === 0x51 && l === 3) tempos.push({ tick, micro: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (type === 0x58 && l >= 2) sigs.push({ tick, num: data[0], den: Math.pow(2, data[1]) });
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { p++; p += rv(); continue; }
      if (st & 0x80) { run = st; p++; } else st = run;
      const hi = st & 0xf0, ch = st & 15;
      tr.channels.add(ch);
      if (hi === 0x90 || hi === 0x80) {
        const n = d[p++], v = d[p++];
        const key = ch * 128 + n;
        if (hi === 0x90 && v > 0) { if (!open.has(key)) open.set(key, []); open.get(key).push({ tick, midi: n, vel: v, ch }); } else close(key, tick);
      } else if (hi === 0xc0) { tr.programs[ch] = d[p++]; } else if (hi === 0xd0) p += 1; else p += 2;
    }
    for (const key of [...open.keys()]) while (open.has(key)) close(key, tick); // kapanmayan notalar iz sonunda biter
    tr.lastTick = tick; tr.notes.sort((a, b) => a.tick0 - b.tick0 || a.midi - b.midi);
    tracks.push(tr);
    p = end;
  }
  return { ppq, tracks, tempos, sigs };
}
const MIDI_BAD_NAME = /(^|\s)(bas|bass|piyano|piano|akor|chord|davul|drum|pad|synth klavye)/i;
const MIDI_GOOD_NAME = /vokal|vocal|melod|lead|voice|şarkı|sarki|ses\b/i;
// iz seçimi: davul olmayan, "melodi" gibi adlı, tek seslilik oranı yüksek, ağırlıklı olarak yüksek perdeli iz
function pickMelodyTrack(info) {
  const cands = info.tracks.filter((t) => t.notes.length >= 4 && !(t.channels.size && [...t.channels].every((c) => c === 9)));
  const score = (t) => {
    const ns = t.notes; let mono = 0;
    for (let i = 0; i < ns.length; i++) if (i + 1 >= ns.length || ns[i + 1].tick0 >= ns[i].tick1 - 1) mono++;
    const mean = ns.reduce((a, n) => a + n.midi, 0) / ns.length;
    return (MIDI_GOOD_NAME.test(t.name) ? 3 : 0) - (MIDI_BAD_NAME.test(t.name) ? 3 : 0) + 2 * (mono / ns.length) + (mean - 60) / 60 + Math.min(1, ns.length / 50);
  };
  cands.sort((a, b) => score(b) - score(a));
  return { best: cands[0] || null, cands: cands.map((t) => ({ index: t.index, name: t.name || `İz ${t.index + 1}`, count: t.notes.length })) };
}
// .mid → proje parçaları. opts.track: melodi izi (iz numarası). Notalar çeyrek cinsinden (q0, q1): tempo değişince müzikal yer korunur.
function importMidi(bytes, opts = {}) {
  const info = readMidiFile(bytes);
  if (info.error) return { error: info.error };
  const warnings = [];
  const pick = pickMelodyTrack(info);
  const mt = opts.track != null ? info.tracks.find((t) => t.index === opts.track) : pick.best;
  if (!mt || !mt.notes.length) return { error: 'MIDI dosyasında melodi olarak kullanılabilecek bir nota izi bulunamadı.' };
  // ölçü + tempo (ilk olay): uygulama BPM'i vuruş (♩ ya da 6/8'de ♩.) sayar
  const sg = info.sigs.slice().sort((a, b) => a.tick - b.tick)[0];
  let meter = '4/4';
  if (sg) { const k = `${sg.num}/${sg.den}`; if (METERS[k]) meter = k; else warnings.push(`${k} ölçüsü desteklenmiyor; 4/4 olarak açıldı (nota yerleri ölçü çizgilerine oturmayabilir).`); }
  if (info.sigs.length > 1) warnings.push('Ölçü değişimleri yok sayıldı (ilk ölçü kullanıldı).');
  const tp = info.tempos.slice().sort((a, b) => a.tick - b.tick), micro = tp.length ? tp[0].micro : 500000;
  if (tp.length > 1 && tp.some((x) => Math.abs(x.micro - micro) > 2000)) warnings.push('Tempo değişimleri yok sayıldı (ilk tempo kullanıldı).');
  const bpm = Math.round(((60000000 / micro) / METERS[meter].pulseQ) * 10) / 10;
  const g = makeGrid({ bpm, meter });
  const Q = (tick) => tick / info.ppq;
  // melodi: tek ses (aynı anda başlayanlardan en tiz; üst üste binenlerde sonraki not önceki notayı keser)
  const raw = mt.notes.map((n) => ({ q0: Q(n.tick0), q1: Q(n.tick1), midi: n.midi, vel: n.vel }));
  const mono = [];
  for (const n of raw) {
    const last = mono[mono.length - 1];
    if (last && Math.abs(n.q0 - last.q0) < 1e-6) { if (n.midi > last.midi) mono[mono.length - 1] = n; continue; }
    if (last && n.q0 < last.q1 - 1e-6) last.q1 = n.q0;
    mono.push(n);
  }
  const notes = mono.filter((n) => n.q1 - n.q0 >= 0.05);
  if (notes.length < mono.length) warnings.push(`${mono.length - notes.length} çok kısa nota atıldı.`);
  if (mono.length < raw.length) warnings.push(`Melodi izi çok sesliydi: ${raw.length - mono.length} nota tek sese indirildi (en tiz nota / sonraki nota öncelikli).`);
  let endQ = 0;
  for (const t of info.tracks) for (const n of t.notes) endQ = Math.max(endQ, Q(n.tick1));
  endQ = Math.max(endQ, notes[notes.length - 1].q1);
  const bars = Math.max(4, Math.ceil(endQ / g.barQ - 1e-6));
  // bölümler: marker (ve 'Ad — Ton' biçimli metin) olayları; uygulamanın örtük "Tümü" bölümü atlanır
  const marks = [];
  for (const t of info.tracks) for (const x of t.texts) if (x.type === 6 && x.text.trim() && x.text.trim() !== 'Tümü') marks.push({ q: Q(x.tick), text: x.text.trim() });
  marks.sort((a, b) => a.q - b.q);
  const sections = marks.map((m, i) => {
    const [nm, ...rest] = m.text.split(/\s[—–-]\s/);
    const key = rest.length ? parseKeyText(rest.join(' — ')) : null;
    const sb = Math.floor(m.q / g.barQ + 1e-6) + 1, nx = marks[i + 1] ? Math.floor(marks[i + 1].q / g.barQ + 1e-6) : bars;
    return { name: nm.trim() || 'Bölüm', startBar: sb, endBar: Math.max(sb, nx), tonic: key ? key.tonic : null, mode: key ? key.mode : null };
  }).filter((s, i, a) => i === 0 || s.startBar > a[i - 1].startBar);
  for (let i = 0; i < sections.length - 1; i++) sections[i].endBar = Math.min(sections[i].endBar, sections[i + 1].startBar - 1);
  // akorlar: akor adı metinleri (uygulamanın kendi MIDI çıktısı: piyano izinde her akorun başında). Sonraki metne kadar sürer
  let chordTrack = null, chordEvents = [];
  for (const t of info.tracks) {
    const ev = t.texts.filter((x) => x.type === 1).map((x) => ({ q: Q(x.tick), chord: parseChord(x.text) })).filter((x) => x.chord);
    if (ev.length >= 2 && ev.length > chordEvents.length) { chordEvents = ev; chordTrack = t; }
  }
  const locks = [];
  let chordStartBar = 1;
  if (chordEvents.length) {
    chordEvents.sort((a, b) => a.q - b.q);
    const per = g.split ? 2 : 1, unitQ = g.barQ / per, nU = bars * per, at = new Array(nU).fill(null);
    for (const e of chordEvents) { const u = Math.round(e.q / unitQ); if (u >= 0 && u < nU) at[u] = e.chord; }
    let cur = null;
    for (let u = 0; u < nU; u++) { if (at[u]) cur = at[u]; else at[u] = cur; }
    chordStartBar = Math.floor(Math.max(0, Math.round(chordEvents[0].q / unitQ)) / per) + 1;
    const lk = (bar, half, c) => locks.push({ bar, half, chord: { root: c.root, q: c.q, bass: c.bass ?? null }, src: 'chart' });
    for (let b = chordStartBar; b <= bars; b++) {
      const a = at[(b - 1) * per], c = per === 2 ? at[(b - 1) * per + 1] : a;
      if (!a) continue;
      if (per === 1 || !c || (a.root === c.root && a.q === c.q && a.bass === c.bass)) lk(b, null, a); else { lk(b, 0, a); lk(b, 1, c); }
    }
  }
  // uygulamanın kendi çıktısındaki iz adlarından ayarlar: akor sesi, bas, davul (loop adı + ilk vuruşun ölçüsü)
  let pianoStyle = null, bassOn = false, drum = null;
  for (const t of info.tracks) {
    if (t === chordTrack) {
      if (t.name === 'Piyano akorları') pianoStyle = 'piano-chord';
      else pianoStyle = Object.keys(PIANO_STYLES).find((k) => PIANO_STYLES[k].name === t.name) || null;
    }
    if (t.name === 'Bas') bassOn = true;
    const dm = /^Davul — (.+)$/.exec(t.name);
    if (dm && t.notes.length) drum = { name: dm[1], startBar: Math.floor(Q(t.notes[0].tick0) / g.barQ + 1e-6) + 1 };
  }
  if (!drum) { const dt = info.tracks.find((t) => t.notes.length && t.channels.size && [...t.channels].every((c) => c === 9)); if (dt) drum = { name: null, startBar: Math.floor(Q(dt.notes[0].tick0) / g.barQ + 1e-6) + 1 }; }
  if (sections.length) { // son bölüm: melodinin ve son akor metninin bittiği ölçüye kadar
    const lastQ = Math.max(notes[notes.length - 1].q1, chordEvents.length ? chordEvents[chordEvents.length - 1].q : 0);
    const L = sections[sections.length - 1];
    L.endBar = Math.max(L.startBar, Math.ceil(lastQ / g.barQ - 1e-6));
  }
  return { settings: { bpm, meter }, notes, endQ, bars, sections, locks, chordStartBar, pianoStyle, bassOn, drum, warnings, melodyTrack: { index: mt.index, name: mt.name || `İz ${mt.index + 1}` }, trackChoices: pick.cands, ppq: info.ppq, chordCount: chordEvents.length };
}

const Core = {
  PC_SHARP, PC_FLAT, MODES, MODE_ORDER, METERS, CHORD_Q, TEST_SCORE,
  PITCH_DEFAULTS, SEG_DEFAULTS, AUTOTUNE_DEFAULTS, CHORD_DEFAULTS, IN_TUNE_CENTS,
  mod12, clamp, median, percentile, hzToMidi, midiToHz, pcName, noteName, parsePc,
  makeGrid, scalePcs, keyUsesFlats, keyName, resample,
  detectPitch, segmentNotes, metricPos, chordWeight, histWeight, suggestKeys, lastWeightedNote,
  normalizeCustomSets, customFillSet, nearestScaleNote, isChromaticPassing, computeCorrection, psolaShift, keyAmbiguity, tuningReference, normSectionType, SECTION_TYPES, SECTION_TYPE_NAMES, CLICK_FEELS, clickKind, parseChordChart, blankChart, parseKeyText,
  diatonicChords, homeChord, chordPcs, chordName, parseChord, roleLabel, scoreChord, slotNotes, buildChords, buildChordsViterbi, CHORD_ENGINES, voiceChords, sameChord,
  writeMidi, parseMidi, encodeWav, decodeWav, renderPiano, renderSynth, SYNTH, synthEnv, synthPianoSample, synthTestVocal,
  PIANO_STYLES, PIANO_DEFAULTS, ARP_RATES, pianoOpts, readMidiFile, importMidi, pickMelodyTrack, arrangePiano, swingMap, swingUnmap, estimateSwing, swingToPart, getFFT, arrangeDrums, applyNoteSplits, addNoteSplit, removeNoteSplit, shiftSong,
  newProject, derive, totalBars, effectiveOffset, findEdit, pianoEvents, chordChart, exportMidi,
  bytesToBase64, base64ToBytes, firstOnset, measureLatency, keyMidi,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);

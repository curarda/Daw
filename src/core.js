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
// 4/4 ve 3/4'te çeyrek, 6/8'de noktalı çeyrek.
const METERS = {
  '4/4': { barQ: 4, pulseQ: 1, strong: [2], split: 2, clickQ: 1, accents: [0] },
  '3/4': { barQ: 3, pulseQ: 1, strong: [], split: null, clickQ: 1, accents: [0] },
  '6/8': { barQ: 3, pulseQ: 1.5, strong: [1.5], split: 1.5, clickQ: 0.5, accents: [0, 1.5] },
};
function makeGrid(settings) {
  const m = METERS[settings.meter] || METERS['4/4'];
  const pulseSec = 60 / settings.bpm;
  const spq = pulseSec / m.pulseQ;
  return Object.assign({}, m, { meter: settings.meter, bpm: settings.bpm, spq, pulseSec, barSec: m.barQ * spq, quarterBpm: 60 / spq });
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
//         'scale' = scale'in en yakın notasına çek (kimliği değiştirebilir; yalnızca açıkça seçilirse)
const AUTOTUNE_DEFAULTS = { enabled: false, target: 'semitone', amount: 100, retuneMs: 30, keepVibrato: true, skipChromatic: true };
// bu kadar cent içinde söylenen nota "tam tonunda" sayılır (kişisel akort referansına göre)
const IN_TUNE_CENTS = 20;
function nearestScaleNote(m, pcs) {
  if (!pcs) return Math.round(m);
  let best = Math.round(m), bd = Infinity;
  for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) {
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
// notes: zaman sıralı, her birinde { f0i, f1i, median, nearest, scalePcs, locked, manualTarget }
function computeCorrection(track, notes, at, g) {
  const nF = track.f0.length, hop = track.hopSec;
  const shift = new Float32Array(nF);
  const info = notes.map(() => ({ target: null, source: 'none', applied: 0, chromatic: false, identityChange: false }));
  notes.forEach((n, i) => {
    let target = null, tau, amount, keepVib;
    if (n.manualTarget != null) {
      target = n.manualTarget; tau = 0.01; amount = 1; keepVib = true; info[i].source = 'manual';
    } else if (at.enabled && !n.locked) {
      if (at.target === 'scale') {
        if (at.skipChromatic && isChromaticPassing(i, notes, n.scalePcs, g)) { info[i].chromatic = true; return; }
        target = nearestScaleNote(n.median, n.scalePcs);
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
      // yarım ölçü kontrolü
      const halves = [];
      if (g.split && !lockFull) {
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
    const Dmax = Math.min(U, maxU * 2);
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
          if (d > maxU) val -= (kappa * (d - maxU)) / per; // N ölçü sınırı (yumuşak)
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
        for (let ci = 0; ci < nC; ci++) {
          const sg = seg(s, d, ci);
          if (!sg) continue;
          if (s === 0) {
            const hp = hStep(0, d, ci);
            push(e, ci * H + hp.h, { score: first[ci] + sg.val - hp.pen, s, e, ci, prev: null });
            continue;
          }
          const mid = s % per !== 0 ? 0.5 * kappa : 0;
          for (const [key, arr] of table[s]) {
            const pci = Math.floor(key / H), ph = key % H;
            if (coreK[pci] === coreK[ci]) continue; // aynı core art arda: tek akor sayılır
            const hp = hStep(ph, d, ci);
            const base = sg.val + trans[pci][ci] - kappa - mid - hp.pen;
            for (const nd of arr) push(e, ci * H + hp.h, { score: nd.score + base, s, e, ci, prev: nd });
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
    if (!alts.length) return;
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
    if (forcedBass != null) { bassPc = forcedBass; bass = place(bassPc, prevBass ?? 40); }
    else if (opts.pedal && sec) { bassPc = sec.tonic; bass = place(bassPc, 40); }
    else {
      const iv = CHORD_Q[slot.chord.q];
      const opt = [{ pc: slot.chord.root, c: 0 }];
      if (prevBass != null && !firstInSec && !lastInSec) {
        const th = iv.find((x) => x === 3 || x === 4);
        if (th != null) opt.push({ pc: mod12(slot.chord.root + th), c: 2.0 });
        if (iv.includes(7)) opt.push({ pc: mod12(slot.chord.root + 7), c: 3.0 });
      }
      let bc = Infinity;
      for (const op of opt) {
        const m = place(op.pc, prevBass ?? 40);
        const d = prevBass == null ? 0 : Math.abs(m - prevBass);
        const mc = d <= 2 ? 0 : d <= 4 ? 1.5 : 3;
        if (op.c + mc < bc) { bc = op.c + mc; bassPc = op.pc; bass = m; }
      }
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
    const start = Math.round(e.t * sr), rel = 0.35, relN = Math.round(rel * sr);
    const holdN = Math.round(e.dur * sr);
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

// ---------------------------------------------------------------- PIPELINE (UI ve test ortak)
function newProject() {
  return {
    version: 1,
    settings: { bpm: 120, meter: '4/4', latencyMs: 0 },
    audio: { offsetSec: 0, alignMode: 'none' },
    pitch: Object.assign({}, PITCH_DEFAULTS, SEG_DEFAULTS),
    sections: [],
    noteEdits: [],
    autotune: Object.assign({}, AUTOTUNE_DEFAULTS),
    chordOpts: Object.assign({}, CHORD_DEFAULTS),
    chordLocks: [],
    mixer: { vocal: { vol: 0, mute: false, solo: false }, piano: { vol: -6, mute: false, solo: false }, ab: 'corrected', pedal: false, click: false },
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
const effectiveOffset = (proj) => (proj.audio.offsetSec || 0) + (proj.audio.source === 'record' ? (proj.settings.latencyMs || 0) / 1000 : 0);

// Senkron türetme aşamaları: notlar → ton önerileri → düzeltme → akorlar → voicing
function derive(proj, st) {
  const g = makeGrid(proj.settings);
  const off = effectiveOffset(proj);
  const bars = totalBars(proj, st.duration);
  let sections = proj.sections.map((s) => Object.assign({}, s));
  if (!sections.length) sections = [{ id: '_all', name: 'Tümü', startBar: 1, endBar: bars, implicit: true }];
  sections.sort((a, b) => a.startBar - b.startBar);
  const secOfQ = (q) => { const bar = Math.floor(q / g.barQ + 1e-6) + 1; return sections.find((s) => bar >= s.startBar && bar <= s.endBar) || null; };
  // 3) notalar (zaman çizelgesi + düzenlemeler)
  // kişisel akort referansı → notanın kimliği (yarım ses) bu referansa göre yuvarlanır
  const tuning = proj.pitch.tuning === 'a440' || !(st.rawNotes || []).length
    ? { global: 0, perNote: (st.rawNotes || []).map(() => 0), driftMin: 0, driftMax: 0, a4: 440, off: true }
    : tuningReference(st.rawNotes, { windowSec: proj.pitch.tuningWindowSec });
  const notes = (st.rawNotes || []).map((r0, i) => {
    const ref = tuning.perNote[i] || 0;
    const nearest = Math.round(r0.median - ref / 100);
    const r = Object.assign({}, r0, { nearest, cents: Math.round((r0.median - ref / 100 - nearest) * 100), refCents: ref, absNearest: r0.nearest, absCents: r0.cents });
    const t0 = r.t0 - off, t1 = r.t1 - off;
    const n = Object.assign({}, r, { idx: i, id: 'n' + Math.round(r.t0 * 1000), tl0: t0, tl1: t1, q0: t0 / g.spq, q1: t1 / g.spq, detMidi: r.nearest });
    const ed = findEdit(proj.noteEdits, r);
    n.edit = ed;
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
  // Akor bulucu SESİ değil kastedilen notayı kullanır: etiket düzeltmesi varsa o, yoksa algılanan nota.
  // Ses düzeltmeleri (autotune, manuel kaydırma) buna dokunmaz.
  for (const n of notes) {
    n.effMidi = n.label != null ? n.label : n.nearest;
    n.inScale = n.scalePcs ? n.scalePcs.includes(mod12(n.effMidi)) : true;
    // tam tonunda söylenmiş ama scale dışı → büyük ihtimalle kasıtlı: "mod yanlış olabilir"
    n.modeSuspect = !n.inScale && n.label == null && Math.abs(n.cents) <= IN_TUNE_CENTS;
  }
  for (const n of notes) n.cw = chordWeight(n, g);
  // 6) akorlar
  // engineOverride: etkileşim sırasında (nota sürükleme) hızlı motor; bırakınca seçili motorla yeniden hesaplanır
  const chordOpts = Object.assign({}, proj.chordOpts, st.style ? { style: st.style } : {}, st.engineOverride ? { engine: st.engineOverride } : {});
  const chords = buildChords(notes, sections, g, chordOpts, proj.chordLocks);
  // 8) voicing
  voiceChords(chords, notes, sections, { pedal: proj.mixer.pedal });
  return { g, off, bars, sections, notes, keyInfo, correction, chords, tuning };
}

// Nota olayları (oynatma + MIDI)
function pianoEvents(chords, g) {
  const ev = [];
  for (const c of chords) {
    if (!c.voicing) continue;
    const t = c.q0 * g.spq, dur = (c.q1 - c.q0) * g.spq;
    ev.push({ t, dur, midi: c.voicing.bass, vel: 78, q0: c.q0, q1: c.q1 });
    for (const m of c.voicing.notes) ev.push({ t, dur, midi: m, vel: 62, q0: c.q0, q1: c.q1 });
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
      bars.push(' ' + (cs.join(' ') || '%') + ' ');
    }
    for (let i = 0; i < bars.length; i += 4) lines.push('|' + bars.slice(i, i + 4).join('|') + '|');
    lines.push('');
  }
  return lines.join('\n');
}
function exportMidi(proj, d) {
  const g = d.g;
  const vocal = d.notes.filter((n) => n.effMidi != null).map((n) => ({ q0: n.q0, q1: n.q1, midi: n.effMidi, vel: 96 }));
  const piano = pianoEvents(d.chords, g).map((e) => ({ q0: e.q0, q1: e.q1, midi: e.midi, vel: e.vel }));
  const texts = d.chords.map((c) => ({ q: c.q0, text: chordName(c.chord, c.flats) }));
  const markers = d.sections.map((s) => ({ q: (s.startBar - 1) * g.barQ, text: s.name + (s.tonic != null ? ' — ' + keyName(s.tonic, s.mode) : '') }));
  return writeMidi({
    quarterBpm: g.quarterBpm, meter: proj.settings.meter, markers,
    tracks: [
      { name: 'Vokal (düzeltilmiş melodi)', channel: 0, program: 53, notes: vocal },
      { name: 'Piyano akorları', channel: 1, program: 0, notes: piano, texts },
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

const Core = {
  PC_SHARP, PC_FLAT, MODES, MODE_ORDER, METERS, CHORD_Q, TEST_SCORE,
  PITCH_DEFAULTS, SEG_DEFAULTS, AUTOTUNE_DEFAULTS, CHORD_DEFAULTS, IN_TUNE_CENTS,
  mod12, clamp, median, percentile, hzToMidi, midiToHz, pcName, noteName, parsePc,
  makeGrid, scalePcs, keyUsesFlats, keyName, resample,
  detectPitch, segmentNotes, metricPos, chordWeight, histWeight, suggestKeys, lastWeightedNote,
  nearestScaleNote, isChromaticPassing, computeCorrection, psolaShift, keyAmbiguity, tuningReference, normSectionType, SECTION_TYPES,
  diatonicChords, homeChord, chordPcs, chordName, parseChord, roleLabel, scoreChord, slotNotes, buildChords, buildChordsViterbi, CHORD_ENGINES, voiceChords, sameChord,
  writeMidi, parseMidi, encodeWav, decodeWav, renderPiano, synthPianoSample, synthTestVocal,
  newProject, derive, totalBars, effectiveOffset, findEdit, pianoEvents, chordChart, exportMidi,
  bytesToBase64, base64ToBytes, firstOnset, measureLatency, keyMidi,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);

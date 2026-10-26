// ---------------------------------------------------------------- VOKAL TEMİZLİĞİ + OTOMATİK MİKS (DOM'suz, çevrimdışı; oynatma ve dışa aktarım aynı yolu kullanır)
// Zincir: yüksek geçiren (80 Hz) → gürültü azaltma (STFT güç çıkarma, sessiz karelerden gürültü profili) → sıkıştırıcı → seviye eşitleme
//         (sesli karelerin RMS'i −18 dBFS) → reverb → tepe sınırlayıcı (−1 dBFS, ileri bakışlı). Hepsi çevrimdışı ve gecikmesizdir:
// çıkış, girişle aynı örnek konumundadır (reverb kuyruğu sona eklenir). Aynı giriş + aynı ayar = aynı çıkış.
(function (root) {
const C = root.Core;
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
const lin = (d) => Math.pow(10, d / 20);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const VFX_DEFAULTS = { on: false, denoise: 60, comp: 40, normalize: true, reverb: 12, touched: false };
const TARGET_RMS_DB = -18, PEAK_CEIL_DB = -1;

// 2. derece yüksek geçiren (RBJ), ileri yönde
function highpass(x, sr, fc = 80) {
  const w0 = (2 * Math.PI * fc) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2);
  const b0 = (1 + cs) / 2, b1 = -(1 + cs), b2 = (1 + cs) / 2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return out;
}
// 50 ms'lik karelerin RMS (dBFS) dizisi
function frameDb(x, sr, win = 0.05) {
  const n = Math.max(1, Math.round(win * sr)), F = Math.max(1, Math.floor(x.length / n)), out = new Float32Array(F);
  for (let f = 0; f < F; f++) { let s = 0; for (let i = f * n, e = i + n; i < e; i++) s += x[i] * x[i]; out[f] = db(Math.sqrt(s / n)); }
  return out;
}
const percentile = (arr, p) => { const a = Array.from(arr).sort((u, v) => u - v); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : -120; };
// kapılı RMS: en yüksek %10'luk dilimin 25 dB altındaki sessizlik / gürültü kareleri sayılmaz → "konuşulan / çalınan" seviye
function gatedRmsDb(x, sr) {
  const fd = frameDb(x, sr), ref = percentile(fd, 0.9), gate = ref - 25;
  let sum = 0, n = 0;
  for (const d of fd) if (d > gate && d > -70) { sum += Math.pow(10, d / 10); n++; }
  return n ? 10 * Math.log10(sum / n) : -120;
}
const peakDb = (x) => { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return db(p); };

// ---- gürültü azaltma: STFT güç çıkarma (sqrt-Hann, %50 örtüşme); gürültü profili en sessiz karelerin ortalama genliği
function denoise(x, sr, amount) {
  const N = 1024, H = 512, nb = N / 2 + 1, a = clamp(amount, 0, 1);
  const n = x.length;
  if (a <= 0 || n < N * 2) return { data: x, noiseDb: null };
  const fft = C.getFFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const F = Math.ceil(n / H) + 1; // kare f: [f·H − H, f·H − H + N)
  const re = new Float64Array(N), im = new Float64Array(N);
  const load = (f) => { const s0 = f * H - H; for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < n ? x[j] * win[i] : 0; im[i] = 0; } fft(re, im, false); };
  // 1) kare enerjileri → en sessiz %12 (en az 6 kare) gürültü profili
  const en = new Float64Array(F);
  for (let f = 0; f < F; f++) { const s0 = f * H - H; let s = 0; for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < n) s += x[j] * x[j]; } en[f] = s; }
  const order = Array.from({ length: F }, (_, i) => i).filter((f) => en[f] > 0).sort((p, q) => en[p] - en[q]);
  const pick = order.slice(0, Math.max(6, Math.floor(order.length * 0.12)));
  if (!pick.length) return { data: x, noiseDb: null };
  const noise = new Float64Array(nb);
  for (const f of pick) { load(f); for (let k = 0; k < nb; k++) noise[k] += Math.hypot(re[k], im[k]); }
  for (let k = 0; k < nb; k++) noise[k] /= pick.length;
  for (let k = 1; k < nb - 1; k++) noise[k] = 0.25 * noise[k - 1] + 0.5 * noise[k] + 0.25 * noise[k + 1]; // profil düzgünleştirme
  // 2) kare kare: Wiener benzeri güç çıkarma kazancı, frekansta ve zamanda yumuşatılmış
  const over = 1.2 + 1.8 * a, floor = lin(-(8 + 22 * a));
  const out = new Float64Array(n + N);
  const gPrev = new Float64Array(nb).fill(1), g = new Float64Array(nb);
  for (let f = 0; f < F; f++) {
    load(f);
    for (let k = 0; k < nb; k++) {
      const m2 = re[k] * re[k] + im[k] * im[k], n2 = over * noise[k] * noise[k];
      g[k] = m2 > 1e-18 ? Math.max(floor, Math.sqrt(Math.max(0, 1 - n2 / m2))) : floor;
    }
    for (let k = 1; k < nb - 1; k++) { const s = 0.25 * g[k - 1] + 0.5 * g[k] + 0.25 * g[k + 1]; g[k] = Math.min(g[k], s) * 0.5 + s * 0.5; }
    for (let k = 0; k < nb; k++) { const v = g[k] > gPrev[k] ? 0.75 * g[k] + 0.25 * gPrev[k] : 0.35 * g[k] + 0.65 * gPrev[k]; gPrev[k] = v; g[k] = v; } // hızlı açılış, yavaş kapanış: "müzikal gürültü" azalır
    for (let k = 0; k < nb; k++) { re[k] *= g[k]; im[k] *= g[k]; if (k > 0 && k < nb - 1) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
    fft(re, im, true);
    const s0 = f * H - H;
    for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < n) out[j] += re[i] * win[i]; }
  }
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = out[i];
  // gürültü tabanı (dBFS): profildeki ortalama güçten
  let pw = 0; for (let k = 0; k < nb; k++) pw += noise[k] * noise[k];
  return { data: res, noiseDb: db(Math.sqrt(pw / nb / N) * 1.4) };
}

// ---- sıkıştırıcı: zarf (5 ms / 100 ms) + yumuşak diz; kazanç 16 örnekte bir hesaplanıp aralanır
function compress(x, sr, amount) {
  const a = clamp(amount, 0, 1);
  if (a <= 0) return x;
  const fd = frameDb(x, sr), thr = percentile(fd, 0.85) - 4, ratio = 1 + 3 * a, knee = 6;
  const att = Math.exp(-1 / (0.005 * sr)), rel = Math.exp(-1 / (0.1 * sr));
  const gainDb = (envDb) => {
    const o = envDb - thr;
    if (o <= -knee / 2) return 0;
    if (o < knee / 2) return (1 / ratio - 1) * ((o + knee / 2) * (o + knee / 2)) / (2 * knee);
    return (1 / ratio - 1) * o;
  };
  const out = new Float32Array(x.length), B = 16;
  let env = 0, gPrev = 1, gNext = 1;
  for (let i = 0; i < x.length; i++) {
    const ab = Math.abs(x[i]);
    env = ab > env ? att * env + (1 - att) * ab : rel * env + (1 - rel) * ab;
    if (i % B === 0) { gPrev = gNext; gNext = lin(gainDb(db(env))); }
    const t = (i % B) / B;
    out[i] = x[i] * (gPrev + (gNext - gPrev) * t);
  }
  return out;
}

// ---- Freeverb (mono): 8 sönümlü comb + 4 allpass; ıslak seviye, kuru kapılı RMS'e göre ayarlanır (deterministik)
function reverb(x, sr, amount) {
  const a = clamp(amount, 0, 1);
  if (a <= 0) return { data: x, tail: 0 };
  const sc = sr / 44100, combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * sc)), aps = [556, 441, 341, 225].map((d) => Math.round(d * sc));
  const fb = 0.8, damp = 0.4, pre = Math.round(0.018 * sr), tail = Math.round(2.6 * sr), n = x.length, L = n + tail;
  const cb = combs.map((d) => new Float32Array(d)), ci = combs.map(() => 0), cs = combs.map(() => 0);
  const ab = aps.map((d) => new Float32Array(d)), ai = aps.map(() => 0);
  const wet = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const inp = (i - pre >= 0 && i - pre < n ? x[i - pre] : 0) * 0.015;
    let sum = 0;
    for (let c = 0; c < combs.length; c++) {
      const buf = cb[c], idx = ci[c], o = buf[idx];
      cs[c] = o * (1 - damp) + cs[c] * damp;
      buf[idx] = inp + cs[c] * fb;
      ci[c] = idx + 1 === buf.length ? 0 : idx + 1;
      sum += o;
    }
    for (let p = 0; p < aps.length; p++) {
      const buf = ab[p], idx = ai[p], bo = buf[idx], o = -sum + bo;
      buf[idx] = sum + bo * 0.5; sum = o;
      ai[p] = idx + 1 === buf.length ? 0 : idx + 1;
    }
    wet[i] = sum;
  }
  // ıslak seviye: kapılı RMS(ıslak) / kapılı RMS(kuru) = 0,35·miktar  (≈ −9 dB'e kadar)
  const wr = gatedRmsDb(wet.subarray(0, n), sr), dr = gatedRmsDb(x, sr);
  const k = wr > -100 ? lin(dr - wr) * 0.35 * a : 0;
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = (i < n ? x[i] : 0) + wet[i] * k;
  return { data: out, tail };
}

// ---- ileri bakışlı tepe sınırlayıcı: kazanç eğrisi min-süzgeç + hareketli ortalama (kuru tepe asla aşılmaz) + yavaş bırakma
function limit(x, sr, ceilDb = PEAK_CEIL_DB, lookMs = 5, relMs = 90) {
  const ceil = lin(ceilDb), n = x.length, Lk = Math.max(2, Math.round((lookMs / 1000) * sr));
  let peak = 0; for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
  if (peak <= ceil) return x;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); g[i] = v > ceil ? ceil / v : 1; }
  // [i−w, i+w] penceresinde en küçük kazanç (monoton kuyruk)
  const w = Lk - 1, mn = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, t = 0, nxt = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + w);
    while (nxt <= hi) { while (t > h && g[dq[t - 1]] >= g[nxt]) t--; dq[t++] = nxt++; }
    while (dq[h] < i - w) h++;
    mn[i] = g[dq[h]];
  }
  // ±Lk/2 hareketli ortalama (pencere ⊂ min penceresi → kazanç gereken değerin altında kalır)
  const ps = new Float64Array(n + 1), W2 = Math.floor(Lk / 2), sm = new Float32Array(n);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + mn[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - W2), hi = Math.min(n, i + W2 + 1); sm[i] = Math.min(mn[i], (ps[hi] - ps[lo]) / (hi - lo)); }
  const rel = Math.exp(-1 / ((relMs / 1000) * sr));
  const out = new Float32Array(n);
  let gs = 1;
  for (let i = 0; i < n; i++) { const target = sm[i]; gs = target < gs ? target : target + (gs - target) * rel; out[i] = x[i] * Math.min(gs, 1); }
  // son güvence: kalan aşımlar (yuvarlama) sert kırpılır
  for (let i = 0; i < n; i++) { if (out[i] > ceil) out[i] = ceil; else if (out[i] < -ceil) out[i] = -ceil; }
  return out;
}

// data: Float32Array (mono), fx: { denoise 0–100, comp 0–100, normalize, reverb 0–100 } → { data, info }
function processVocal(data, sr, fxIn) {
  const fx = Object.assign({}, VFX_DEFAULTS, fxIn || {});
  const info = { rmsBeforeDb: gatedRmsDb(data, sr), peakBeforeDb: peakDb(data), noiseDb: null, noiseReductionDb: null };
  let x = highpass(data, sr, 80);
  const dn = denoise(x, sr, fx.denoise / 100);
  x = dn.data; info.noiseDb = dn.noiseDb;
  if (dn.noiseDb != null) {
    // gürültü tabanındaki azalma: en sessiz karelerin gücü, öncesi / sonrası
    const q = (arr) => percentile(frameDb(arr, sr), 0.1);
    info.noiseReductionDb = Math.round((q(highpass(data, sr, 80)) - q(x)) * 10) / 10;
  }
  x = compress(x, sr, fx.comp / 100);
  if (fx.normalize) {
    const cur = gatedRmsDb(x, sr);
    if (cur > -100) { const gdb = clamp(TARGET_RMS_DB - cur, -12, 30), gn = lin(gdb); const y = new Float32Array(x.length); for (let i = 0; i < y.length; i++) y[i] = x[i] * gn; x = y; info.gainDb = Math.round(gdb * 10) / 10; }
  }
  const rv = reverb(x, sr, fx.reverb / 100);
  x = limit(rv.data, sr, PEAK_CEIL_DB);
  info.rmsAfterDb = gatedRmsDb(x, sr); info.peakAfterDb = peakDb(x); info.tailSec = rv.tail / sr;
  return { data: x, info };
}

// ---- otomatik miks: kapılı RMS'e göre sesler vokale oranlanır. Vokal 0 dB'de kalır (zaten −18 dBFS'e eşitlenmiştir).
// Hedefler (vokale göre dB): akor −7 · gitar −6 · bas −5 · davul −6. stems: { vocal, piano, guitar, bass, drums } (çalmayan = null)
const MIX_OFFSETS = { piano: -7, guitar: -6, bass: -5, drums: -6 };
function autoMixLevels(stems, sr) {
  const measured = {}, levels = { vocal: 0 };
  const vocalDb = stems.vocal ? gatedRmsDb(stems.vocal, sr) : TARGET_RMS_DB;
  measured.vocal = vocalDb;
  for (const k of Object.keys(MIX_OFFSETS)) {
    if (!stems[k]) continue;
    const m = gatedRmsDb(stems[k], sr);
    if (m < -100) continue;
    measured[k] = m;
    levels[k] = clamp(Math.round(vocalDb + MIX_OFFSETS[k] - m), -40, 6);
  }
  return { levels, measured };
}

Object.assign(C, { VFX_DEFAULTS, processVocal, autoMixLevels, gatedRmsDb, vocalLimit: limit, vocalHighpass: highpass, vocalDenoise: denoise, vocalCompress: compress, vocalReverb: reverb, MIX_OFFSETS });
})(typeof window !== 'undefined' ? window : globalThis);

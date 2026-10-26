// ---------------------------------------------------------------- PUNCH-IN + CANLI PERDE (DOM'suz çekirdek)
// punchTakeIndex: şarkı zamanı → yakalama tamponundaki örnek konumu (aynı AudioContext saati: fon müziği, click ve mikrofon hizalı)
// punchSplice:   yeni take'i eski kaydın [fa, fb) aralığına kenar geçişiyle (crossfade) yerleştirir; gerekirse başa / sona boşluk ekler
// livePitch:     tek karelik YIN; söylerken göstergeye (nota + sent) gider
(function (root) {
const C = root.Core;

// p: { T0 (fon çalmanın başladığı ses saati, sn), tS (o anda çalan şarkı zamanı, sn), latSec (gidiş-dönüş gecikmesi), sr (yakalama örnekleme hızı), firstFrame (ilk yakalanan çerçeve) }
// yakalanan i. örnek ses saatinde (firstFrame + i)/sr anındadır; o an çalan şarkı zamanı = tS + (saat − T0); söylenen, duyulandan latSec geç yakalanır
const punchTakeIndex = (tau, p) => Math.round((tau + (p.T0 - p.tS) + p.latSec) * p.sr - p.firstFrame);

// base: Float32Array (eski kayıt), [fa, fb): değişecek örnek aralığı (taşabilir), seg: yeni örnekler (fb − fa uzunlukta), fade: kenar geçişi örnek sayısı
// → { data, pad (başa eklenen örnek sayısı), fa, fb (yeni dizideki konum) }
function punchSplice(base, fa, fb, seg, fade = 0) {
  const n = fb - fa;
  if (n <= 0 || seg.length !== n) throw new Error('punchSplice: seg uzunluğu fb − fa olmalı');
  const pad = fa < 0 ? -fa : 0, a = fa + pad, b = fb + pad;
  const len = Math.max(base.length + pad, b);
  const out = new Float32Array(len);
  out.set(base, pad);
  const f = Math.max(0, Math.min(fade, n >> 1));
  for (let i = 0; i < n; i++) {
    const j = a + i, old = j < base.length + pad ? out[j] : 0;
    let w = 1;
    if (f) { if (i < f) w = (i + 0.5) / f; else if (i >= n - f) w = (n - i - 0.5) / f; }
    out[j] = old * (1 - w) + seg[i] * w;
  }
  return { data: out, pad, fa: a, fb: b };
}

// tek kare YIN: buf (≥ 2 periyot), sr → { hz, midi (kesirli), cents (en yakın yarım sese göre), note, clarity } ya da null (sessiz / perdesiz)
function livePitch(buf, sr, opts = {}) {
  const fmin = opts.fmin || 70, fmax = opts.fmax || 1000, thr = opts.threshold || 0.15;
  const n = buf.length, tauMin = Math.max(2, Math.floor(sr / fmax)), tauMax = Math.min(Math.floor(sr / fmin), (n >> 1) - 1);
  if (tauMax <= tauMin + 2) return null;
  let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
  if (Math.sqrt(e / n) < (opts.minRms || 0.004)) return null;
  const W = n - tauMax, d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = s; }
  let run = 0; const cm = new Float32Array(tauMax + 1); cm[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cm[t] < thr) { while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  }
  if (tau < 0) return null;
  // parabolik yuvarlama
  let t0 = tau;
  if (tau > 1 && tau < tauMax) { const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1], den = a - 2 * b + c; if (den !== 0) t0 = tau + (a - c) / (2 * den); }
  const hz = sr / t0, midi = 69 + 12 * Math.log2(hz / 440), near = Math.round(midi);
  return { hz, midi, cents: Math.round((midi - near) * 100), note: C.noteName ? C.noteName(near, false) : String(near), clarity: 1 - cm[tau] };
}

Object.assign(C, { punchTakeIndex, punchSplice, livePitch });
})(typeof window !== 'undefined' ? window : globalThis);

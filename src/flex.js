// ---------------------------------------------------------------- ZAMANLAMA: quantize, nota kaydırma (flex), tap ile ızgara
// DOM'suz; Core'a eklenir (build'de core.js + drums.js'in ardından aynı <script id="core"> içine girer).
(function (root) {
const C = root.Core;
const { clamp } = C;

// ---- 1) ZAMAN HARİTASI: kayıttaki zaman (s) → çıktı zamanı (s)
// Her notanın yeni başlangıcı (b) verilirse nota bütün olarak kayar (süresi aynı); notalar arasındaki boşluklar
// (nefes, geçiş) esner/sıkışır. Notalar sırasını değiştiremez: komşusunun üstüne kayan notanın önündeki notanın
// sonu kısalır, o da yetmezse nota komşusunun hemen arkasında durur.
const MIN_GAP = 0.005, MIN_NOTE = 0.03;
function buildTimeMap(items, duration) {
  // items: [{a: kayıttaki başlangıç, e: kayıttaki bitiş, b: istenen başlangıç (yoksa a)}] (zaman sıralı)
  const it = items.filter((x) => x.e > x.a).map((x) => ({ a: x.a, e: x.e, b: x.b != null ? x.b : x.a })).sort((p, q) => p.a - q.a);
  let moved = false;
  for (const x of it) { x.f = x.e + (x.b - x.a); if (Math.abs(x.b - x.a) > 5e-4) moved = true; }
  if (!moved || !it.length) return identityMap();
  it[0].b = Math.max(it[0].b, Math.min(it[0].a, 0.01)); it[0].f = Math.max(it[0].f, it[0].b + MIN_NOTE);
  for (let i = 1; i < it.length; i++) {
    const p = it[i - 1], x = it[i];
    if (x.b < p.f + MIN_GAP) p.f = Math.max(p.b + MIN_NOTE, x.b - MIN_GAP); // önceki notanın sonunu kısalt
    if (x.b < p.f + MIN_GAP) { x.b = p.f + MIN_GAP; x.f = Math.max(x.f, x.b + MIN_NOTE); } // yetmezse komşunun arkasında dur
    if (x.f < x.b + MIN_NOTE) x.f = x.b + MIN_NOTE;
  }
  const A = [], B = [];
  // legato: önceki notanın bitişi = sonrakinin başlangıcı (aynı giriş anı) → sonraki notanın başlangıcı geçerli
  const push = (a, b) => {
    if (A.length && a <= A[A.length - 1] + 1e-6) {
      if (A.length > 1) B[B.length - 1] = Math.max(b, B[B.length - 2] + 1e-6);
      return;
    }
    A.push(a); B.push(Math.max(b, B.length ? B[B.length - 1] + 1e-6 : -Infinity));
  };
  // boşluklarda notanın girişi (scoop, ünsüz: başlangıçtan önceki ~80 ms) ve bitişin hemen ardı (~30 ms)
  // notayla birlikte kayar; yalnızca boşluğun ortası esner/sıkışır
  it.forEach((x, i) => {
    const p = it[i - 1];
    if (p) {
      const gap = x.a - p.e, og = x.b - p.f;
      if (gap > 0.004) {
        let pre = Math.min(0.08, 0.45 * gap), post = Math.min(0.03, 0.45 * gap);
        const need = pre + post + 0.002;
        if (og < need) { const k = Math.max(0, og - 0.002) / need; pre *= k; post *= k; }
        if (post > 0.001) push(p.e + post, p.f + post);
        if (pre > 0.001) push(x.a - pre, x.b - pre);
      }
    }
    push(x.a, x.b); push(x.e, x.f);
  });
  const D = Math.max(duration || 0, A[A.length - 1]);
  const lead = B[0] - A[0], tail = B[B.length - 1] - A[A.length - 1];
  const interp = (X, Y, v, l, t) => {
    if (v <= X[0]) return v + l;
    if (v >= X[X.length - 1]) return v + t;
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= v) lo = m; else hi = m; }
    return Y[lo] + ((v - X[lo]) * (Y[hi] - Y[lo])) / (X[hi] - X[lo]);
  };
  return {
    identity: false, inA: A, outB: B, duration: D, outDuration: D + tail,
    fwd: (t) => interp(A, B, t, lead, tail),
    inv: (t) => interp(B, A, t, -lead, -tail),
    sig: A.map((a, i) => a.toFixed(4) + ':' + B[i].toFixed(4)).join(','),
  };
}
function identityMap() { return { identity: true, fwd: (t) => t, inv: (t) => t, sig: '' }; }

// ---- 2) WSOLA: sesi zaman haritasına göre yeniden yerleştir (perde değişmez)
// Haritanın eğimi 1 olan yerlerde (kaydırılmayan ya da bütün olarak kayan notalar) giriş birebir kopyalanır;
// yalnızca esneyen/sıkışan boşluklarda en benzer dalga parçası aranır (tıkırtısız birleşim).
function wsolaWarp(x, sr, map) {
  if (!map || map.identity) return x;
  // arama penceresi ±6 ms (~yarım perde periyodu): kayma birikmez, nota başları haritaya ±6 ms içinde oturur
  const N = 1 << Math.round(Math.log2(0.023 * sr)), Hs = N >> 1, tol = Math.round(0.006 * sr);
  const outLen = Math.max(1, Math.round(map.fwd(x.length / sr) * sr));
  const y = new Float32Array(outLen + 2 * N);
  const win = new Float32Array(N);
  for (let k = 0; k < N; k++) win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);
  const at = (i) => (i >= 0 && i < x.length ? x[i] : 0);
  let prev = null;
  for (let o = -Hs; o < outLen; o += Hs) {
    const d = Math.round(map.inv((o + N / 2) / sr) * sr - N / 2);
    let pos = d;
    if (prev != null) {
      const nat = prev + Hs;
      if (Math.abs(d - nat) <= 2) pos = nat;
      else {
        // kaba arama (adım 4) + ince arama (±3): doğal devamla en benzer parça
        // benzerlik − hedeften uzaklık cezası (eşit benzerlikte hedefe yakın olan seçilir)
        let en = 1e-9; for (let k = 0; k < N; k += 4) en += at(nat + k) * at(nat + k);
        const score = (p) => { let s = 0; for (let k = 0; k < N; k += 4) s += at(p + k) * at(nat + k); return s / en - 0.15 * Math.abs(p - d) / tol; };
        let best = -Infinity, bp = d;
        for (let dl = -tol; dl <= tol; dl += 4) { const v = score(d + dl); if (v > best) { best = v; bp = d + dl; } }
        let fine = bp;
        for (let dl = -3; dl <= 3; dl++) { const v = score(bp + dl); if (v > best) { best = v; fine = bp + dl; } }
        pos = fine;
      }
    }
    for (let k = 0; k < N; k++) { const oi = o + k; if (oi >= 0 && oi < y.length) y[oi] += at(pos + k) * win[k]; }
    prev = pos;
  }
  return y.subarray(0, outLen);
}

// ---- 3) QUANTIZE: başlangıçları ızgaraya çek (güç %)
// notes: türetilmiş notalar (qOrig = kayıttaki başlangıcın çeyrek konumu); gridQ: ızgara adımı (çeyrek cinsinden)
const QUANT_GRIDS = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/8T': 1 / 3, '1/16T': 1 / 6 };
function quantizeTargets(notes, g, opts = {}) {
  const gridQ = opts.gridQ || 0.5, strength = clamp(opts.strength == null ? 1 : opts.strength, 0, 1);
  const pick = opts.filter || (() => true);
  const minGapQ = 0.03 / g.spq;
  const ns = [...notes].sort((a, b) => a.qOrig - b.qOrig);
  const out = [];
  let prevQ = -Infinity, skipped = 0;
  for (const n of ns) {
    const cur = n.q0to != null ? n.q0to : n.qOrig;
    if (!pick(n)) { prevQ = Math.max(prevQ, cur); continue; }
    const snap = Math.round(n.qOrig / gridQ) * gridQ;
    let q = n.qOrig + strength * (snap - n.qOrig);
    if (q < prevQ + minGapQ) { // iki nota aynı ızgara noktasına düşüyor: bunu taşıma
      q = n.qOrig >= prevQ + minGapQ ? n.qOrig : null;
      skipped++;
    }
    if (q != null) { out.push({ note: n, q0to: Math.abs(q - n.qOrig) < 1e-4 ? null : q }); prevQ = q; }
  }
  return { targets: out, skipped };
}

// ---- 4) TAP: akor değişim noktalarından tempo, ölçü ve ızgara
// taps: değişim anları (çıktı saniyesi, oynatılan sesle aynı zaman); notes: {t0, t1} (aynı zaman ekseninde)
function estimateFromTaps(taps, notes, opts = {}) {
  const ts = [...taps].sort((a, b) => a - b);
  const out = { ok: false, reasons: [] };
  if (ts.length < 3) { out.reasons.push(`En az 3 değişim noktası gerekir (${ts.length} var).`); return out; }
  // birim u: tap'ler arası sürelerin "ortak katı" — tap'lerin hepsinin oturduğu en uzun periyot
  const R = (L) => { let sx = 0, sy = 0; for (const t of ts) { sx += Math.cos((2 * Math.PI * t) / L); sy += Math.sin((2 * Math.PI * t) / L); } return Math.hypot(sx, sy) / ts.length; };
  const span = ts[ts.length - 1] - ts[0];
  let u = null;
  for (let L = Math.min(8, span); L >= 0.6; L -= 0.002) {
    const r = R(L);
    if (r >= 0.9 && r >= R(L + 0.004) && r >= R(L - 0.004)) { u = L; break; }
  }
  if (!u) { out.reasons.push('Değişim noktaları düzenli bir periyoda oturmuyor (tempo sabit değil ya da noktalar kayık).'); return out; }
  // ince ayar: t_i = φ + k_i·u en küçük kareler
  const fitLine = (L) => {
    const ks = ts.map((t) => Math.round((t - ts[0]) / L));
    const n = ts.length, mk = ks.reduce((a, b) => a + b, 0) / n, mt = ts.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    ks.forEach((k, i) => { sxy += (k - mk) * (ts[i] - mt); sxx += (k - mk) ** 2; });
    const uu = sxx > 0 ? sxy / sxx : L, phi = mt - uu * mk;
    const res = Math.sqrt(ts.reduce((a, t, i) => a + (t - phi - ks[i] * uu) ** 2, 0) / n);
    return { u: uu, phi, ks, res };
  };
  const fl = fitLine(u);
  u = fl.u;
  out.residualMs = fl.res * 1000;
  // hipotezler: ölçü = u, 2u, u/2 (tap'ler ölçü başında / iki ölçüde bir / yarım ölçüde); ölçü türü melodiden
  const nts = notes.filter((n) => n.t1 > n.t0);
  const hyps = [];
  for (const [mult, prior, lbl] of [[1, 0.15, 'her değişim ölçü başında'], [2, 0.06, 'değişimler ölçü başı ve ortasında'], [0.5, 0.03, 'değişimler iki ölçüde bir']]) {
    const bar = u * mult;
    for (const [meter, beats] of [['4/4', 4], ['3/4', 3], ['2/4', 2], ['6/8', 2]]) {
      const bpm = (60 * beats) / bar;
      if (bpm < 50 || bpm > 200) continue;
      const est = nts.length >= 8 ? C.estimateMeter(nts, bpm) : null;
      const gz = est && est.ok ? clamp(est.gridZ, 0, 8) / 8 : 0;
      const mm = est && est.ok && est.meter === meter ? 0.15 + 0.3 * est.confidence : 0;
      const near = opts.bpm && Math.abs(bpm - opts.bpm) / opts.bpm < 0.03 && (!opts.meter || opts.meter === meter) ? 0.1 : 0;
      const pr = meter === '4/4' ? 0.03 : 0;
      const rb = Math.abs(bpm - Math.round(bpm)) < 0.35 ? Math.round(bpm) : Math.round(bpm * 10) / 10; // tap sapması: tama yuvarla
      hyps.push({ meter, bpm: rb, bar: (60 * beats) / rb, mult, why: lbl, score: 0.5 * gz + mm + prior + near + pr, gridZ: est && est.ok ? est.gridZ : null });
    }
  }
  if (!hyps.length) { out.reasons.push('Değişim noktaları 50–200 BPM aralığında bir tempoya karşılık gelmiyor.'); return out; }
  hyps.sort((a, b) => b.score - a.score);
  const h = hyps[0];
  // ölçü başı fazı: u ölçünün yarısıysa, tap'lerin çoğunun ölçü başına düştüğü faz
  let phase = fl.phi;
  if (h.mult === 2) {
    const even = fl.ks.filter((k) => k % 2 === 0).length, odd = ts.length - even;
    if (odd > even) phase = fl.phi + u;
  }
  // 1. ölçü: ilk notadan önceki (ya da çok az sonraki) ölçü çizgisi
  const P = 60 / h.bpm;
  const first = nts.length ? Math.min(...nts.map((n) => n.t0)) : ts[0];
  const k = Math.floor((first + 0.15 * P - phase) / h.bar);
  const barLine1 = phase + k * h.bar;
  out.ok = true;
  Object.assign(out, { bpm: h.bpm, meter: h.meter, barSec: h.bar, firstBarSec: barLine1, why: h.why, hypotheses: hyps.slice(0, 4), unitSec: u });
  // ✂ işaretleri: her tap, en yakın ölçü başı / ölçü ortasına
  const g = C.makeGrid({ bpm: h.bpm, meter: h.meter }), per = g.split ? 2 : 1, unit = h.bar / per;
  const marks = [], off = [];
  for (const t of ts) {
    const x = (t - barLine1) / unit, kk = Math.round(x);
    if (Math.abs(x - kk) > 0.25) { off.push(t); continue; }
    const bar = Math.floor(kk / per) + 1, half = kk % per;
    if (bar < 1 || (bar === 1 && half === 0)) continue;
    if (!marks.some((m) => m.bar === bar && m.half === half)) marks.push({ bar, half, kind: 'change' });
  }
  out.marks = marks;
  if (off.length) out.reasons.push(`${off.length} nokta ölçü başı/ortasına oturmadı; işaret konmadı.`);
  if (out.residualMs > 60) out.reasons.push(`Noktalar ortalama ${Math.round(out.residualMs)} ms sapıyor; tempo kayıyor olabilir.`);
  if (hyps[1] && hyps[1].score > h.score - 0.05) out.reasons.push(`Alternatif: ${hyps[1].meter}, ${hyps[1].bpm} BPM (${hyps[1].why}) neredeyse aynı olası.`);
  return out;
}

Object.assign(C, { buildTimeMap, identityMap, wsolaWarp, QUANT_GRIDS, quantizeTargets, estimateFromTaps });
})(typeof window !== 'undefined' ? window : globalThis);

// ---------------------------------------------------------------- BAS STİL ÖĞRENME (8d, faz 4): MIDI okuyucu, hızlı giriş, istatistik, profil üretimi
// DOM'suz. Ses hiçbir zaman nota yazıya çevrilmez; girdi bas izi olan bir MIDI dosyası ya da elle yazılan derecelerdir.
// Çıktı: bass.js'teki profil biçimi { id, name, templateWeights, roles, rolesByEnergy{low,mid,high}, leapLimit, legato, templates[] }.
(function (root) {
const C = root.Core, B = C.Bass;
const { STEP_Q, stepsOf, DEFAULT_ROLES, BASS_TEMPLATES, tapTemplate, hash32 } = B;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mod12 = (x) => ((x % 12) + 12) % 12;
const BUCKETS = ['low', 'mid', 'high'];
const BUCKET_E = { low: 0.17, mid: 0.5, high: 0.83 };
const METERS = { '4/4': 1, '3/4': 1, '6/8': 1, '2/4': 1 };

// ---------------------------------------------------------------- 1) MIDI okuyucu (süreli: nota başlangıcı + bitişi; tempo ve ölçü bilgisi)
function readMidi(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...d.slice(o, o + n));
  if (d.length < 14 || str(0, 4) !== 'MThd') throw new Error('Geçerli bir MIDI dosyası değil (MThd yok).');
  const ntr = (d[10] << 8) | d[11], div = (d[12] << 8) | d[13];
  if (div & 0x8000) throw new Error('SMPTE zamanlı MIDI desteklenmiyor (çeyreklik bölüm gerekir).');
  let p = 8 + ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]);
  const out = { division: div, tempo: null, timeSig: null, tracks: [] };
  for (let t = 0; t < ntr && p + 8 <= d.length; t++) {
    if (str(p, 4) !== 'MTrk') { p += 8 + ((d[p + 4] << 24) | (d[p + 5] << 16) | (d[p + 6] << 8) | d[p + 7]); t--; if (p >= d.length) break; continue; }
    const len = ((d[p + 4] << 24) | (d[p + 5] << 16) | (d[p + 6] << 8) | d[p + 7]) >>> 0;
    p += 8; const end = Math.min(d.length, p + len);
    const rv = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    let tick = 0, run = 0, name = '';
    const open = new Map(), notes = [];
    while (p < end) {
      tick += rv();
      let st = d[p];
      if (st === 0xff) {
        p++; const type = d[p++], l = rv();
        if (type === 0x03) name = new TextDecoder().decode(d.slice(p, p + l));
        else if (type === 0x51 && l === 3 && out.tempo == null) out.tempo = Math.round(60e6 / ((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]) * 100) / 100;
        else if (type === 0x58 && l >= 2 && !out.timeSig) out.timeSig = { num: d[p], den: 2 ** d[p + 1] };
        p += l; continue;
      }
      if (st === 0xf0 || st === 0xf7) { p++; const l = rv(); p += l; continue; }
      if (st & 0x80) { run = st; p++; } else st = run;
      const hi = st & 0xf0, ch = st & 0x0f;
      if (hi === 0x90 || hi === 0x80) {
        const n = d[p++], v = d[p++], key = ch * 128 + n;
        if (hi === 0x90 && v > 0) { if (!open.has(key)) open.set(key, []); open.get(key).push({ tick, midi: n, vel: v, ch }); }
        else { const q = open.get(key); if (q && q.length) { const o = q.shift(); notes.push({ tick: o.tick, dur: Math.max(1, tick - o.tick), midi: o.midi, vel: o.vel, ch }); } }
      } else if (hi === 0xc0 || hi === 0xd0) p += 1; else p += 2;
    }
    for (const q of open.values()) for (const o of q) notes.push({ tick: o.tick, dur: div / 4, midi: o.midi, vel: o.vel, ch: o.ch }); // bitişi olmayan nota: 16'lık
    p = end;
    notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    out.tracks.push({ index: out.tracks.length, name, notes, channels: [...new Set(notes.map((n) => n.ch))] });
  }
  return out;
}
// bas izi tahmini: perdesi en alçak, tek sesli ve notası yeterli iz (kanal 10 / davul hariç)
function guessBassTrack(m) {
  let best = null, bestScore = -1;
  for (const t of m.tracks) {
    const ns = t.notes.filter((n) => n.ch !== 9); if (ns.length < 4) continue;
    const mean = ns.reduce((a, n) => a + n.midi, 0) / ns.length, name = /bas|bass/i.test(t.name) ? 40 : 0;
    const score = name + (70 - mean) + Math.min(10, ns.length / 20);
    if (score > bestScore) { bestScore = score; best = t.index; }
  }
  return best;
}

// ---------------------------------------------------------------- 2) Ölçülere böl (16'lık ızgara); ölçünün kökü = 1. vuruştaki en alçak nota
function meterOf(m, override) {
  if (override && METERS[override]) return override;
  const ts = m && m.timeSig; if (!ts) return '4/4';
  const s = `${ts.num}/${ts.den}`; return METERS[s] ? s : '4/4';
}
function midiBars(m, trackIndex, o = {}) {
  const tr = m.tracks[trackIndex]; if (!tr) throw new Error('İz yok.');
  const meter = meterOf(m, o.meter), steps = stepsOf(meter), barQ = steps * STEP_Q;
  const mono = new Map();
  for (const n of tr.notes) {
    if (n.ch === 9) continue;
    const q = n.tick / m.division; let bar = Math.floor(q / barQ + 1e-9), step = Math.round((q - bar * barQ) / STEP_Q);
    if (step >= steps) { bar++; step = 0; }
    const key = bar * 64 + step, cur = mono.get(key);
    if (!cur || n.midi < cur.midi) mono.set(key, { bar, step, midi: n.midi, vel: n.vel, dur: n.dur / m.division / STEP_Q });
  }
  const byBar = new Map();
  for (const x of mono.values()) { if (!byBar.has(x.bar)) byBar.set(x.bar, []); byBar.get(x.bar).push(x); }
  const bars = [...byBar.keys()].sort((a, b) => a - b).map((i) => {
    const notes = byBar.get(i).sort((a, b) => a.step - b.step);
    return { index: i, notes: notes.map((n) => ({ step: n.step, midi: n.midi, vel: n.vel, dur: n.dur })), root: null };
  });
  for (const b of bars) b.root = autoRoot(b);
  return { meter, steps, bars, bpm: m.tempo };
}
function autoRoot(bar) {
  const first = bar.notes.filter((n) => n.step === 0);
  const pool = first.length ? first : bar.notes.filter((n) => n.step <= 1).length ? bar.notes.filter((n) => n.step <= 1) : bar.notes;
  return pool.length ? mod12(Math.min(...pool.map((n) => n.midi))) : 0;
}

// ---------------------------------------------------------------- 3) Hızlı giriş: 16'lık adım başına derece ("1", "b3", "5'", "7,", "8"; "." sus, boş = tut)
function parseDegree(s) {
  const m = /^([b#]?)([1-9])([',]*)$/.exec(String(s || '').trim()); if (!m) return null;
  const base = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12, 9: 14 }[m[2]];
  let v = base + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  for (const c of m[3]) v += c === "'" ? 12 : -12;
  return v;
}
function quickBars(rows, meter = '4/4') {
  const steps = stepsOf(meter), errors = [];
  const bars = rows.map((r, bi) => {
    const notes = [];
    let cur = null;
    for (let s = 0; s < steps; s++) {
      const c = String((r.cells || [])[s] ?? '').trim();
      if (c === '') { if (cur) cur.dur++; continue; }
      if (c === '.') { cur = null; continue; }
      const iv = parseDegree(c);
      if (iv == null) { errors.push(`${bi + 1}. satır, ${s + 1}. adım: "${c}" anlaşılmadı (örn. 1, b3, 5, 7, 1', 5,)`); cur = null; continue; }
      cur = { step: s, midi: 40 + iv, vel: 96, dur: 1 };
      notes.push(cur);
    }
    return { index: bi, notes, root: 4, energy: r.energy || null }; // kök sabit (E): derece tabanlı
  }).filter((b) => b.notes.length);
  return { meter, steps, bars, errors };
}

// ---------------------------------------------------------------- 4) Enerji kovaları (verilmediyse ölçü başına nota yoğunluğunun üçte birlikleri)
function assignBuckets(bars) {
  const have = bars.every((b) => BUCKETS.includes(b.energy));
  if (have) return bars.map((b) => b.energy);
  const cnt = bars.map((b) => b.notes.length), sorted = cnt.slice().sort((a, b) => a - b), n = sorted.length;
  const tLow = sorted[Math.floor((n - 1) / 3)], tHigh = sorted[Math.ceil((2 * (n - 1)) / 3)];
  return bars.map((b, i) => (BUCKETS.includes(b.energy) ? b.energy : tLow < tHigh ? (cnt[i] <= tLow ? 'low' : cnt[i] >= tHigh ? 'high' : 'mid') : 'mid'));
}

// ---------------------------------------------------------------- 5) İstatistik
const PRIOR_N = 6; // her rol dağılımına varsayılan ağırlıktan eklenen sanal örnek: az veride profil uç değerlere kaçmaz
const ROLE_KEYS = { strong: ['root', 'fifth', 'octave', 'third'], weak: ['repeat', 'step', 'fifth', 'octave'], pickup: ['approach-d', 'approach-c', 'fifth'] };
const emptyCounts = () => ({ strong: { root: 0, fifth: 0, octave: 0, third: 0, other: 0 }, weak: { repeat: 0, step: 0, fifth: 0, octave: 0 }, pickup: { 'approach-d': 0, 'approach-c': 0, fifth: 0 }, anchor: { root: 0, other: 0 } });
function analyze(input, o = {}) {
  const { bars, steps } = input, meter = input.meter, stride = meter === '6/8' ? 6 : 4;
  const bucketOf = assignBuckets(bars);
  const by = {};
  for (const k of BUCKETS) by[k] = { bars: 0, notes: 0, onsetCount: new Array(steps).fill(0), counts: emptyCounts(), leaps: [], legatoSum: 0, legatoN: 0, intervals: 0 };
  const patterns = new Map();
  bars.forEach((bar, bi) => {
    const k = bucketOf[bi], S = by[k], ns = bar.notes;
    S.bars++; S.notes += ns.length;
    const next = bars[bi + 1] && bars[bi + 1].index === bar.index + 1 ? bars[bi + 1] : null;
    const prevBar = bars[bi - 1] && bars[bi - 1].index === bar.index - 1 ? bars[bi - 1] : null;
    const lowRoot = Math.min(...ns.filter((n) => mod12(n.midi - bar.root) === 0).map((n) => n.midi), Infinity);
    ns.forEach((n, j) => {
      S.onsetCount[n.step]++;
      const iv = mod12(n.midi - bar.root), prev = j > 0 ? ns[j - 1] : prevBar ? prevBar.notes[prevBar.notes.length - 1] : null;
      const last = j === ns.length - 1, nextStep = last ? steps : ns[j + 1].step, gap = Math.max(1, nextStep - n.step);
      S.legatoSum += clamp(n.dur / gap, 0, 1); S.legatoN++;
      if (j > 0) { const dm = Math.abs(n.midi - ns[j - 1].midi); S.leaps.push(dm); S.intervals++; }
      const pickup = last && next && mod12(next.root - bar.root) !== 0 && n.step >= steps - 4 && j > 0;
      if (j === 0 && n.step === 0) { S.counts.anchor[iv === 0 ? 'root' : 'other']++; return; }
      if (pickup) {
        const dn = mod12(n.midi - next.root), c = dn === 1 || dn === 11 ? 'approach-c' : dn === 2 || dn === 10 ? 'approach-d' : 'fifth';
        S.counts.pickup[c]++; return;
      }
      if (n.step % stride === 0) {
        const c = iv === 0 ? (n.midi >= lowRoot + 12 ? 'octave' : 'root') : iv === 7 ? 'fifth' : iv === 3 || iv === 4 ? 'third' : 'other';
        S.counts.strong[c]++; return;
      }
      const dm = prev ? Math.abs(n.midi - prev.midi) : 99;
      const c = dm === 0 ? 'repeat' : dm <= 2 ? 'step' : iv === 7 ? 'fifth' : iv === 0 ? 'octave' : 'step';
      S.counts.weak[c]++;
    });
    const key = ns.map((n) => n.step).join(',');
    if (!patterns.has(key)) patterns.set(key, { key, steps: ns.map((n) => n.step), bars: [], lens: ns.map(() => []) });
    const P = patterns.get(key); P.bars.push(bi);
    ns.forEach((n, j) => { const nextStep = j === ns.length - 1 ? steps : ns[j + 1].step; P.lens[j].push(clamp(Math.round(n.dur), 1, nextStep - n.step)); });
  });
  return { by, bucketOf, patterns, steps, meter };
}

// sayımları yüzdeye çevir: varsayılan profil önsel olarak karışır
function rolePercent(counts, role, prior) {
  const keys = ROLE_KEYS[role], n = keys.reduce((a, k) => a + counts[k], 0), tot = keys.reduce((a, k) => a + (prior[k] || 0), 0) || 1, out = {};
  for (const k of keys) out[k] = Math.round(1000 * ((counts[k] + (PRIOR_N * (prior[k] || 0)) / tot) / (n + PRIOR_N))) / 10;
  return out;
}
const sumCounts = (list, role) => { const o = {}; for (const k of ROLE_KEYS[role]) o[k] = list.reduce((a, c) => a + c[role][k], 0); return o; };

// ---------------------------------------------------------------- 6) Profil üret
function buildProfile(input, o = {}) {
  const A = analyze(input, o), { by, patterns, steps } = A;
  const total = BUCKETS.reduce((a, k) => a + by[k].bars, 0);
  if (!total) throw new Error('Analiz edilecek nota yok.');
  const name = String(o.name || '').trim() || 'Öğrenilen stil';
  const id = o.id || 'learned-' + hash32(name + total + (o.salt ?? Date.now())).toString(36);
  const allCounts = BUCKETS.map((k) => by[k].counts);
  const mk = (countsList) => {
    const r = {};
    for (const role of ['strong', 'weak', 'pickup']) r[role] = rolePercent(sumCounts(countsList, role), role, DEFAULT_ROLES[role]);
    return r;
  };
  const rolesAll = Object.assign({}, DEFAULT_ROLES, mk(allCounts));
  const rolesByEnergy = {};
  for (const k of BUCKETS) rolesByEnergy[k] = Object.assign({}, DEFAULT_ROLES, by[k].bars ? mk([by[k].counts]) : mk(allCounts));
  // sıçrama sınırı: ölçü içi aralıkların %95'i; legato: not süresi / bir sonraki vuruşa uzaklık ortalaması
  const leaps = BUCKETS.flatMap((k) => by[k].leaps).sort((a, b) => a - b);
  const leapLimit = leaps.length >= 8 ? clamp(leaps[Math.min(leaps.length - 1, Math.floor(leaps.length * 0.95))], 5, 24) : 12;
  const legN = BUCKETS.reduce((a, k) => a + by[k].legatoN, 0), legato = legN ? clamp(BUCKETS.reduce((a, k) => a + by[k].legatoSum, 0) / legN, 0.3, 1) : 0.92;
  // vuruş yoğunluğu: tüm kovalar birlikte, kova başına ayrı da saklanır
  const onsetFreq = (S) => S.onsetCount.map((c) => (S.bars ? c / S.bars : 0));
  const overall = new Array(steps).fill(0).map((_, i) => BUCKETS.reduce((a, k) => a + by[k].onsetCount[i], 0) / total);
  // kalıplar → şablon: en sık görülen tek ölçülük vuruş desenleri
  const meter = input.meter, builtinSets = BASS_TEMPLATES.filter((t) => t.meter === meter).map((t) => ({ t, key: t.slots.map((s) => s.step).sort((a, b) => a - b).join(',') }));
  const ranked = [...patterns.values()].sort((a, b) => b.bars.length - a.bars.length || a.key.localeCompare(b.key));
  const minCount = total >= 4 ? 2 : 1, templates = [], boost = {};
  const familyOf = (n) => (n <= 2 ? 'drone' : n <= 5 ? 'walk' : n <= 9 ? 'drive' : 'roll');
  for (const P of ranked) {
    if (P.bars.length < minCount || templates.length >= 3) break;
    const same = builtinSets.find((x) => x.key === P.key);
    if (same) { boost[same.t.id] = Math.max(boost[same.t.id] || 1, 1 + Math.min(4, P.bars.length)); continue; }
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const slots = P.steps.map((st, j) => ({ step: st, len: med(P.lens[j]) }));
    const avgE = P.bars.reduce((a, bi) => a + BUCKET_E[A.bucketOf[bi]], 0) / P.bars.length;
    const t = tapTemplate(`${id}-t${templates.length + 1}`, `${name} ${templates.length + 1}`, meter, slots, { custom: false, learned: true, family: familyOf(slots.length), window: [clamp(avgE - 0.38, 0, 1), clamp(avgE + 0.38, 0, 1)] });
    templates.push(t);
  }
  // yerleşik şablonlar: her kovanın adım başına vuruş sıklığıyla ağırlıklı Jaccard benzerliği (Σmin / Σmax) → ağırlık; en iyi kova sayılır
  const templateWeights = {};
  const freqs = BUCKETS.filter((k) => by[k].bars).map((k) => onsetFreq(by[k]));
  for (const t of BASS_TEMPLATES) {
    if (t.meter !== meter) continue;
    const on = new Set(t.slots.map((s) => s.step));
    let J = 0;
    for (const f of freqs) {
      let mn = 0, mx = 0;
      f.forEach((x, i) => { const y = on.has(i) ? 1 : 0; mn += Math.min(x, y); mx += Math.max(x, y); });
      J = Math.max(J, mx ? mn / mx : 0);
    }
    templateWeights[t.id] = clamp((0.1 + 12 * J * J) * (boost[t.id] || 1), 0.1, 12);
  }
  for (const t of templates) templateWeights[t.id] = 12;
  const bucketStats = {};
  for (const k of BUCKETS) {
    const S = by[k], c = S.counts;
    const n3 = S.leaps.length;
    bucketStats[k] = {
      bars: S.bars, notes: S.notes, density: S.bars ? S.notes / S.bars : 0, onsetFreq: onsetFreq(S).map((x) => Math.round(x * 100) / 100),
      leapOver7: n3 ? S.leaps.filter((x) => x > 7).length / n3 : 0, leapMax: n3 ? Math.max(...S.leaps) : 0, legato: S.legatoN ? S.legatoSum / S.legatoN : null,
      roles: { strong: rolesByEnergy[k].strong, weak: rolesByEnergy[k].weak, pickup: rolesByEnergy[k].pickup }, counts: c, ignoredStrong: c.strong.other,
    };
  }
  return {
    id, name, builtin: false, learned: true, templateWeights, roles: rolesAll, rolesByEnergy, synthRoles: null, leapLimit, legato, templates,
    source: { kind: o.kind || 'midi', bars: total, meter }, stats: bucketStats,
  };
}

Object.assign(B, { readMidi, guessBassTrack, midiBars, autoRoot, parseDegree, quickBars, assignBuckets, analyzeStyle: analyze, buildProfile, LEARN_BUCKETS: BUCKETS });
})(typeof window !== 'undefined' ? window : globalThis);

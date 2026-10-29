// ---------------------------------------------------------------- BAS (8d): panel, bas şeridi (lane), oynatma, demo şarkı
// app.js'in IIFE'sinin içine girer (build'de /*__GUITARUI__*/ ile birlikte yerleşir): S, C, $, $$, esc, status, Player, grid, qToX, xToQ, sc, TL aynı kapsamda.
const Bs = C.Bass;
const BS = { sel: null, anchor: null, note: null, drag: null, hist: Bs.newHistory(), sec: null, form: null, hits: [], rows: null, timer: null, ready: false };
const BS_H = 150, BS_TOP = 34;
const bTrack = () => S.proj.bass;
const bCtx = () => (S.d ? Bs.bassContext(S.d, S.proj) : null);
const ROLE_COLOR = { root: '#5b9dff', fifth: '#3fc7b5', octave: '#3fc7b5', third: '#b48cff', passing: '#a9c8f5', approach: '#ffb454', chromatic: '#ff8a4c', ghost: '#7a8296', fill: '#ff6fa8' };
const BASS_TYPE_TR = { 'bass-guitar': 'Bas gitar', synth: 'Synth bas' };
const PED_DEG = [1, 3, 5, 7, 9, 11, 13];
const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---- izin + senkron (refresh'ten): akor izine uyar, kirli kilitsiz ölçüleri yeniden üretir
function bassNormalize() {
  const def = Bs.defaultBassTrack();
  S.proj.bass = Object.assign(def, S.proj.bass || {});
  const t = S.proj.bass;
  t.tap = Object.assign(def.tap, t.tap); t.range = Object.assign({}, Bs.RANGE_DEFAULT[t.instrumentType], t.range);
  for (const k of ['bars', 'loops', 'customTemplates', 'profiles']) if (!Array.isArray(t[k])) t[k] = [];
  if (!t.sections || typeof t.sections !== 'object') t.sections = {};
  S.proj.mixer.bass = S.proj.mixer.bass || { vol: -4, mute: false, solo: false };
  bassMergeStoredProfiles();
}
function bassSyncUI() {
  bassNormalize();
  if (!S.d || S.drag) return;
  const ctx = bCtx();
  const r = Bs.bassSync(bTrack(), ctx);
  BS.lastSync = r;
  if (r.regenerated.length && Player.playing) clearTimeout(BS.timer), (BS.timer = setTimeout(() => Player.play(), 250));
}
// ---- değişiklik akışı (geri alınabilir): her eylem önce anlık görüntü alır
function bsDo(fn, msg) {
  if (!S.d) { status('Önce bir akor izi gerekli (analiz ya da demo şarkı).', 'err'); return; }
  Bs.historyPush(BS.hist, bTrack()); HIST.last = 'bass';
  const linked = S.d.sections.filter((s) => linkSource(s.id)), t = bTrack();
  const saved = linked.map((s) => ({ id: s.id, settings: JSON.parse(JSON.stringify(t.sections[s.id] || {})) }));
  fn(t, bCtx());
  for (const s of saved) t.sections[s.id] = s.settings;
  bsAfter(msg);
}
function bsAfter(msg) {
  renderSoundSelection();
  queueVersions();
  const t = bTrack(), ctx = bCtx();
  if (ctx) { Bs.applyTies(t, ctx); if (Object.keys(C.resolveLinks(S.proj, S.d)).length) Bs.bassSync(t, ctx); }
  renderBass(); drawBass();
  if (msg) status(msg);
  if (Player.playing) { clearTimeout(BS.timer); BS.timer = setTimeout(() => Player.play(), 250); }
}
function bsUndo(redo) {
  const t = redo ? Bs.historyRedo(BS.hist, bTrack()) : Bs.historyUndo(BS.hist, bTrack());
  if (!t) { status(redo ? 'Yinelenecek bir şey yok.' : 'Geri alınacak bir şey yok.'); return; }
  S.proj.bass = t; BS.note = null;
  bsAfter(redo ? 'Yinelendi.' : 'Geri alındı.');
}
function clearBassSel() { if (BS.sel || BS.note) { BS.sel = null; BS.anchor = null; BS.note = null; renderBass(); drawBass(); } }
const selBars = () => { if (!BS.sel) return []; const a = []; for (let i = BS.sel[0]; i <= BS.sel[1]; i++) a.push(i); return a; };

// ---- ses örnekleri ve oynatma
function makeBassVoices(tr, ctx, connect, realSamples = [], retainRealSamples) {
  const follow = tr.instrumentType === 'synth';
  const mk = (preset, vol) => { const s = new Bs.BassSynth(ctx, { preset, volume: vol, follow }); connect(s.output); return s; };
  let main;
  const source = C.bassSampleSource(tr, BS.bank.samples, realSamples);
  if (tr.useSampler && BS.bank.samples.length) { const sm = new Bs.BassSampler(ctx, { volume: tr.volume }); sm.load(BS.bank.samples, BS.bank.releases); connect(sm.output); main = sm; }
  else if (source === 'freesound') {
    try { const sm = new Bs.BassSampler(ctx, { volume: tr.volume, retainSample: retainRealSamples }); sm.load(realSamples); sm.source = 'freesound'; sm.name = 'Freesound bas'; connect(sm.output); main = sm; }
    catch (_) { $('#bassAudioStatus').textContent = 'Bas örneği hazırlanamadı; sentetik bas kullanılıyor.'; main = mk(tr.instrumentPreset, tr.volume); }
  } else main = mk(tr.instrumentPreset, tr.volume);
  const voices = [{ inst: main, octave: 0, below: null }];
  if (tr.layer && tr.layer.preset && tr.layer.preset !== 'none') voices.push({ inst: mk(tr.layer.preset, tr.volume * 0.9), octave: tr.layer.octaveOffset || 0, below: null });
  if (tr.doubleLow) voices.push({ inst: mk(tr.instrumentPreset, tr.volume * 0.3), octave: 12, below: 31 }); // 31'in altı: bir oktav yukarısı %30 seviyede ikilenir
  return voices;
}
// bir olayı tüm seslere uygula (katman ve düşük nota ikilemesi dahil)
function bassHit(voices, e, time) {
  for (const v of voices) { if (v.below != null && e.midi >= v.below) continue; Bs.hitBass(v.inst, e, time, { octave: v.octave }); }
}
// süzgeç / rezonans / drive otomasyonu (synth tipi): ölçü başlarında ses saatinde rampa
function bassAutomation(tr, ctx, g) { return tr.instrumentType === 'synth' ? Bs.filterAutomation(tr, ctx, g) : []; }
function applyAutomationAt(voices, p, time, ramp) {
  for (const v of voices) {
    v.inst.setCutoff(Bs.cutoffHz(p.v), time, 0, true);
    if (ramp > 0) v.inst.setCutoff(Bs.cutoffHz(p.v1), time, ramp);
    v.inst.setResonance(p.res, time); v.inst.setDrive(p.drive, time);
  }
}
// gerçek zamanlı: Tone.Transport.schedule ile (diğer katmanlarla aynı ileri bakışlı zamanlayıcı)
function scheduleBassPlay(T, rounds, g, ctx, snapshot) {
  const tr = bTrack();
  Player.stopBass();
  const rc = Tone.getContext().rawContext;
  const voices = makeBassVoices(tr, rc, (n) => Tone.connect(n, Player.bassCh), snapshot?.bassSamples(rc) || [], snapshot?.retain);
  Player.bassVoices = voices;
  const ev = arrangedEventsAll(['bass']).bass, au = bassAutomation(tr, ctx, g);
  if (window.__dawAPI.onScheduledEvents) window.__dawAPI.onScheduledEvents({ bass: ev });
  // rounds: Player.play'in turları ({lo, hi} zaman çizelgesi aralığı, tau0 = lo'nun Transport zamanı); döngü yoksa tek tur
  for (const r of rounds) {
    const at = (t) => r.tau0 + (Math.max(t, r.lo) - r.lo), from = r.lo;
    for (const e of ev) { if (e.t < from - 0.01 || e.t >= r.hi) continue; T.schedule((time) => bassHit(voices, e, time), at(e.t)); }
    const fromBar = Math.max(0, Math.floor(from / g.barSec + 1e-9));
    au.forEach((p, i) => {
      if (i < fromBar || p.t >= r.hi) return;
      const ramp = Math.min(g.barSec, r.hi - Math.max(p.t, from)); // döngüde süzgeç rampası tur sonunu aşmaz (sonraki turun ilk olayı daha erken olurdu)
      T.schedule((time) => applyAutomationAt(voices, p, time, ramp), at(Math.max(p.t, from)));
    });
    if (r === rounds[0] && au[fromBar]) { // aradan başlarken süzgeç doğru yerde olsun
      const p = au[fromBar], fr = clamp01((from - p.t) / g.barSec), v = p.v + (p.v1 - p.v) * fr;
      for (const x of voices) { x.inst.setCutoff(Bs.cutoffHz(v), Tone.now(), 0, true); x.inst.setResonance(p.res, Tone.now()); x.inst.setDrive(p.drive, Tone.now()); }
    }
    if (tr.pump > 0 && tr.instrumentType === 'synth') {
      for (let t = Math.ceil(from / g.pulseSec) * g.pulseSec; t < Math.min(r.hi, S.d.bars * g.barSec); t += g.pulseSec) T.schedule((time) => voices.forEach((x) => x.inst.pumpAt(time, tr.pump, 0.25 * g.pulseSec)), at(t));
    }
  }
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// çevrimdışı (mix WAV): aynı sesler OfflineAudioContext içinde, olaylar mutlak zamanda
async function renderBassOffline(sr, n, suppliedSnapshot) {
  const tr = bTrack(), ctx = bCtx(), g = S.d.g;
  const events = arrangedEventsAll(['bass']).bass, automation = bassAutomation(tr, ctx, g);
  const snapshot = suppliedSnapshot || await prepareCurrentRealSounds();
  let voices;
  try {
    const oc = new OfflineAudioContext(1, n, sr);
    voices = makeBassVoices(tr, oc, (node) => node.connect(oc.destination), snapshot.bassSamples(oc), snapshot.retain);
    for (const e of events) bassHit(voices, e, e.t);
    for (const p of automation) applyAutomationAt(voices, p, p.t, g.barSec);
    if (tr.pump > 0 && tr.instrumentType === 'synth') for (let t = 0; t < S.d.bars * g.barSec; t += g.pulseSec) voices.forEach((x) => x.inst.pumpAt(t, tr.pump, 0.25 * g.pulseSec));
    BS.lastOffline = voices;
    const buf = await oc.startRendering();
    return buf.getChannelData(0);
  } finally {
    for (const v of voices || []) if (v.inst.source === 'freesound') { v.inst.releaseSamples(); v.inst.samples = []; v.inst.cur = null; v.inst.dispose(); }
    if (!suppliedSnapshot) snapshot.release();
  }
}
async function bassPreviewNote(midi, vel) {
  const project = S.proj;
  try { await Player.ensure(); } catch (e) { return; }
  if (project !== S.proj) return;
  const rc = Tone.getContext().rawContext, tr = bTrack(), generation = syncRealSoundGeneration();
  const snapshot = await prepareRealSounds(project, generation);
  if (snapshot.stale || project !== S.proj || generation !== DRUM_REAL.generation) { snapshot.release(); return; }
  try {
    const v = makeBassVoices(Object.assign({}, tr, { layer: null, doubleLow: false }), rc, (n) => Tone.connect(n, Player.bassCh), snapshot.bassSamples(rc), snapshot.retain);
    const t = Tone.now() + 0.02;
    v[0].inst.noteOn(midi, vel || 96, t, {}); v[0].inst.noteOff(t + 0.35);
  } finally { snapshot.release(); }
}

// ---- demo şarkı: 16 ölçülük yerleşik ilerleme, ses kaydı gerekmez
function loadDemoSong() {
  Player.stop(true);
  S.proj = C.newProject(); S.audio = null; S.midi = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0; HIST.reset = true;
  const p = S.proj;
  p.settings.bpm = 110; p.settings.meter = '4/4';
  p.sections = [
    { id: 'demoIntro', name: 'Intro', startBar: 1, endBar: 4, tonic: 9, mode: 'minor', confirmed: true },
    { id: 'demoVerse', name: 'Verse', startBar: 5, endBar: 8, tonic: 9, mode: 'minor', confirmed: true },
    { id: 'demoChorus', name: 'Chorus', startBar: 9, endBar: 12, tonic: 9, mode: 'minor', confirmed: true },
    { id: 'demoOutro', name: 'Outro', startBar: 13, endBar: 16, tonic: 9, mode: 'minor', confirmed: true },
  ];
  const prog = [[9, 'm'], [9, 'm'], [5, ''], [7, ''], [9, 'm'], [5, ''], [0, ''], [7, ''], [5, ''], [7, ''], [9, 'm'], [[9, 'm'], [4, '']], [5, ''], [0, ''], [7, ''], [9, 'm']];
  prog.forEach((c, i) => {
    const bar = i + 1;
    if (Array.isArray(c[0])) c.forEach((x, h) => p.chordLocks.push({ bar, half: h, chord: { root: x[0], q: x[1], bass: null }, src: 'chart' }));
    else p.chordLocks.push({ bar, half: null, chord: { root: c[0], q: c[1], bass: null }, src: 'chart' });
  });
  p.guitar = C.defaultGuitarState('4/4'); p.guitar.instrument = 'piano';
  bassNormalize();
  p.bass.enabled = true;
  BS.hist = Bs.newHistory(); BS.sel = null; BS.note = null; BS.sec = null; BS.lsMerged = false;
  syncInputs(); refresh();
  const t = bTrack(); Bs.bassGenerateAll(t, bCtx());
  renderBass(); drawBass(); renderInfo();
  status('Demo şarkı yüklendi (16 ölçü, La minör, 110 BPM): bas hattı üretildi. ▶ Çal ile dinle.');
}

// ---- şerit (lane)
function barRect(i) { const g = grid(); return { x0: qToX(i * g.barQ), x1: qToX((i + 1) * g.barQ) }; }
function bassPitchRange() {
  const t = bTrack(); let lo = Infinity, hi = -Infinity;
  for (const b of t.bars) for (const n of b.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
  if (!Number.isFinite(lo)) { lo = t.range.low + 4; hi = t.range.high - 8; }
  lo -= 2; hi += 2;
  if (hi - lo < 14) { const c = (hi + lo) / 2; lo = Math.floor(c - 7); hi = lo + 14; }
  return { lo, hi };
}
function drawBass() {
  const cvb = $('#bsCv');
  if (!cvb || !sc.clientWidth) return;
  const dpr = window.devicePixelRatio || 1, W = sc.clientWidth, H = BS_H;
  if (cvb.width !== Math.round(W * dpr) || cvb.height !== Math.round(H * dpr)) { cvb.width = Math.round(W * dpr); cvb.height = Math.round(H * dpr); cvb.style.width = W + 'px'; cvb.style.height = H + 'px'; }
  const c = cvb.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#101217'; c.fillRect(0, 0, W, H);
  const d = S.d, g = grid(), tr = bTrack(), barQ = g.barQ;
  BS.hits = [];
  if (!tr) return;
  const rg = bassPitchRange(); BS.rows = rg;
  const rowH = (H - BS_TOP - 6) / (rg.hi - rg.lo + 1), yOf = (m) => BS_TOP + (rg.hi - m + 0.5) * rowH;
  BS.rowH = rowH; BS.yOf = yOf;
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(C.mod12(m));
  for (let m = rg.lo; m <= rg.hi; m++) { c.fillStyle = isBlack(m) ? '#0d0f13' : '#12151b'; c.fillRect(TL.KW, yOf(m) - rowH / 2, W, rowH); }
  c.fillStyle = '#181b22'; c.fillRect(0, 0, TL.KW, H);
  c.fillStyle = '#9aa2b4'; c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText('Bas', 8, 12);
  c.fillStyle = '#5c6478'; c.font = '10px system-ui'; c.fillText(tr.enabled ? BASS_TYPE_TR[tr.instrumentType] : 'kapalı', 4, 26);
  const q0v = xToQ(TL.KW), q1v = xToQ(W), nBars = d ? d.bars : 8;
  // ölçü ve vuruş çizgileri
  for (let q = Math.floor(q0v); q <= q1v; q++) {
    const x = Math.round(qToX(q)) + 0.5; if (x < TL.KW) continue;
    const isBar = Math.abs(q / barQ - Math.round(q / barQ)) < 1e-6;
    c.strokeStyle = isBar ? '#3a4152' : '#1c2029'; c.beginPath(); c.moveTo(x, isBar ? 0 : BS_TOP); c.lineTo(x, H); c.stroke();
  }
  // akor adları (akor izinden): ölçülerle aynı hizada
  if (d) {
    c.font = '11px system-ui'; c.textBaseline = 'middle';
    for (const s of d.chords) { const x = qToX(s.q0), x1 = qToX(s.q1); if (x1 < TL.KW || x > W) continue; c.fillStyle = '#c8cfdf'; c.save(); c.beginPath(); c.rect(Math.max(TL.KW, x), 0, x1 - Math.max(TL.KW, x) - 2, 18); c.clip(); c.fillText(C.chordName(s.chord, s.flats), Math.max(TL.KW + 2, x + 4), 10); c.restore(); }
  }
  const hasNotes = tr.bars.some((b) => b.notes.length);
  if (!hasNotes) { c.fillStyle = '#6c7589'; c.font = '12px system-ui'; c.textAlign = 'center'; c.fillText(d ? 'Bas hattı yok — Generate\'e bas' : 'Önce akor izi: analiz et ya da "Demo şarkıyı yükle"', (TL.KW + W) / 2, BS_TOP + 40); c.textAlign = 'left'; }
  const pxq = S.view.pxPerQ;
  // döngü ayracı: kaynak ölçülerden hedefe
  for (const L of tr.loops || []) {
    const xs = barRect(L.sourceStart).x0, xe = barRect(L.sourceStart + L.sourceLength - 1).x1, ts = barRect(L.targetStart).x0, te = barRect(L.targetEnd).x1;
    c.strokeStyle = L.mode === 'exact' ? '#ffd166' : '#6ee7b7'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(xs + 2, 21); c.lineTo(xs + 2, 17); c.lineTo(te - 2, 17); c.lineTo(te - 2, 21); c.stroke();
    c.fillStyle = c.strokeStyle; c.font = '10px system-ui'; c.fillText(`⟲ ${L.mode === 'exact' ? 'birebir' : 'akora uy.'}`, Math.max(TL.KW + 2, xs + 6), 14);
    c.lineWidth = 1; void xe; void ts;
  }
  // ölçüler: seçim, kilit, pedal, uyarı simgeleri, notalar
  for (let i = 0; i < Math.min(tr.bars.length, nBars); i++) {
    const { x0, x1 } = barRect(i);
    if (x1 < TL.KW || x0 > W) continue;
    const b = tr.bars[i];
    if (BS.sel && i >= BS.sel[0] && i <= BS.sel[1]) { c.fillStyle = 'rgba(106,167,255,0.13)'; c.fillRect(Math.max(TL.KW, x0), 20, x1 - Math.max(TL.KW, x0), H - 20); c.strokeStyle = '#6aa7ff'; c.strokeRect(Math.max(TL.KW, x0) + 0.5, 20.5, x1 - Math.max(TL.KW, x0) - 1, H - 22); }
    if (b.source === 'loop') { c.fillStyle = 'rgba(110,231,183,0.06)'; c.fillRect(Math.max(TL.KW, x0), 20, x1 - Math.max(TL.KW, x0), H - 20); }
    const ped = Bs.pedalFor(b, tr.sections[b.sectionId || '_none']);
    c.font = '10px system-ui'; c.textBaseline = 'middle';
    let lab = ''; if (b.locked) lab += '🔒'; if (b.dirtyLocked) lab += '⚠'; if (b.warnings && b.warnings.length) lab += '❗'; if (b.source === 'tapped') lab += '👆';
    if (lab) { c.fillStyle = '#ffd166'; c.fillText(lab, Math.max(TL.KW + 2, x0 + 3), BS_TOP - 7); }
    if (ped) { c.fillStyle = '#ffb454'; c.fillText('⚓ ' + (ped.kind === 'pitch' ? ped.pitchClass : ped.degree), Math.max(TL.KW + 2, x0 + 3) + (lab ? 28 : 0), BS_TOP - 7); }
    for (let k = 0; k < b.notes.length; k++) {
      const n = (BS.drag && BS.drag.bar === i && BS.drag.k === k && BS.drag.cur) || b.notes[k];
      const nx = qToX(i * barQ + n.startBeat), nw = Math.max(3, n.durationBeats * pxq - 1), ny = yOf(n.midi) - rowH / 2;
      if (nx + nw < TL.KW || nx > W) continue;
      const col = ROLE_COLOR[n.role] || '#5b9dff';
      c.globalAlpha = (n.velocity || 90) / 127 * 0.5 + 0.5;
      c.fillStyle = col; c.fillRect(Math.max(TL.KW, nx), ny + 0.5, nw - (Math.max(TL.KW, nx) - nx), Math.max(3, rowH - 1));
      c.globalAlpha = 1;
      if (n.accent) { c.fillStyle = '#fff'; c.fillRect(Math.max(TL.KW, nx), ny, 3, Math.max(3, rowH)); }
      if (n.tie) { c.fillStyle = '#fff'; c.fillRect(nx + nw - 3, ny + rowH / 2 - 1, 5, 2); }
      if (BS.note && BS.note.bar === i && BS.note.k === k) { c.strokeStyle = '#fff'; c.strokeRect(Math.max(TL.KW, nx) + 0.5, ny + 0.5, nw - (Math.max(TL.KW, nx) - nx), Math.max(3, rowH - 1)); }
      BS.hits.push({ x: nx, y: ny, w: nw, h: Math.max(3, rowH), bar: i, k });
    }
  }
  // oynatma imleci
  if (d && S.pos != null) { const x = qToX(S.pos / g.spq); if (x >= TL.KW && x <= W) { c.strokeStyle = '#ff5a5f'; c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); } }
  c.fillStyle = '#181b22'; c.fillRect(0, 0, TL.KW, H); c.fillStyle = '#9aa2b4'; c.font = '11px system-ui'; c.textBaseline = 'middle'; c.fillText('Bas', 8, 12);
  c.fillStyle = '#5c6478'; c.font = '10px system-ui'; c.fillText(tr.enabled ? BASS_TYPE_TR[tr.instrumentType] : 'kapalı', 4, 26);
}
// ---- şerit etkileşimi: tıkla = ölçü seç (Shift = genişlet); nota: sürükle = taşı, sağ kenar = boyut; çift tık = nota ekle; Delete = sil
const bassLaneXY = (e) => { const r = $('#bsCv').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const barAtX = (x) => Math.floor(xToQ(x) / grid().barQ + 1e-9);
function bassNoteAt(x, y) { for (let k = BS.hits.length - 1; k >= 0; k--) { const h = BS.hits[k]; if (x >= h.x && x <= h.x + h.w && y >= h.y - 2 && y <= h.y + h.h + 2) return h; } return null; }
function selectBassBars(i, extend) {
  const t = bTrack(); if (!t || i < 0 || i >= (S.d ? S.d.bars : 0)) return;
  if (S.sel) { S.sel = null; renderInspector(); renderSections(); draw(); }
  if (extend && BS.anchor != null) BS.sel = [Math.min(BS.anchor, i), Math.max(BS.anchor, i)]; else { BS.anchor = i; BS.sel = [i, i]; }
  BS.note = null; renderBass(); drawBass();
}
$('#bsCv').addEventListener('mousedown', (e) => {
  const { x, y } = bassLaneXY(e);
  if (x < TL.KW || !S.d) return;
  const h = bassNoteAt(x, y), t = bTrack();
  if (h) {
    const b = t.bars[h.bar];
    BS.note = { bar: h.bar, k: h.k };
    if (!BS.sel || h.bar < BS.sel[0] || h.bar > BS.sel[1]) { BS.sel = [h.bar, h.bar]; BS.anchor = h.bar; }
    if (b.source !== 'loop' && !linkedAtBar(h.bar + 1)) {
      const n = b.notes[h.k], resize = x > h.x + h.w - Math.min(6, h.w * 0.3); // dar notada sağ kenar payı küçülür
      BS.drag = { bar: h.bar, k: h.k, mode: resize ? 'resize' : 'move', x0: x, y0: y, orig: Object.assign({}, n), cur: Object.assign({}, n), moved: false };
    }
    renderBass(); drawBass(); return;
  }
  selectBassBars(barAtX(x), e.shiftKey);
});
window.addEventListener('mousemove', (e) => {
  const dr = BS.drag; if (!dr) return;
  const { x, y } = bassLaneXY(e), g = grid(), pxq = S.view.pxPerQ;
  if (Math.abs(x - dr.x0) + Math.abs(y - dr.y0) > 3) dr.moved = true;
  const snap = (v) => Math.round(v / Bs.STEP_Q) * Bs.STEP_Q;
  if (dr.mode === 'move') {
    dr.cur.startBeat = Math.max(0, Math.min(g.barQ - Bs.STEP_Q, snap(dr.orig.startBeat + (x - dr.x0) / pxq)));
    dr.cur.midi = Math.max(0, Math.min(127, dr.orig.midi - Math.round((y - dr.y0) / BS.rowH)));
  } else dr.cur.durationBeats = Math.max(Bs.STEP_Q, snap(dr.orig.durationBeats + (x - dr.x0) / pxq));
  drawBass();
});
window.addEventListener('mouseup', () => {
  const dr = BS.drag; if (!dr) return;
  BS.drag = null;
  if (dr.moved) {
    const patch = dr.mode === 'move' ? { startBeat: dr.cur.startBeat, midi: dr.cur.midi } : { durationBeats: dr.cur.durationBeats };
    bsDo((t, ctx) => { Bs.bassUpdateNote(t, ctx, dr.bar, dr.k, patch); }, `Nota düzenlendi (${dr.bar + 1}. ölçü kilitlendi, kaynak: elle).`);
    if (dr.mode === 'move') bassPreviewNote(dr.cur.midi, dr.orig.velocity);
  } else drawBass();
});
$('#bsCv').addEventListener('dblclick', (e) => {
  const { x, y } = bassLaneXY(e);
  if (x < TL.KW || !S.d || bassNoteAt(x, y)) return;
  const i = barAtX(x), t = bTrack(), g = grid();
  if (i < 0 || i >= S.d.bars || !t.bars[i] || t.bars[i].source === 'loop' || y < BS_TOP) return;
  if (linkedAtBar(i + 1)) { guardLinked(linkedAtBar(i + 1).id); return; }
  const start = Math.max(0, Math.min(g.barQ - 0.5, Math.round((xToQ(x) - i * g.barQ) / Bs.STEP_Q) * Bs.STEP_Q));
  const midi = Math.max(0, Math.min(127, Math.round(BS.rows.hi - (y - BS_TOP) / BS.rowH + 0.0)));
  bsDo((tr, ctx) => { Bs.bassAddNote(tr, ctx, i, { startBeat: start, durationBeats: 0.5, midi, velocity: 92, role: 'root' }); }, `Nota eklendi (${i + 1}. ölçü kilitlendi, kaynak: elle).`);
  bassPreviewNote(midi, 92);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y') && bassUndoFirst()) { e.preventDefault(); bsUndo(e.key === 'y' || e.key === 'Y' || e.shiftKey); return; }
  if (!BS.sel && !BS.note) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { if (BS.note) { e.preventDefault(); if (linkedAtBar(BS.note.bar + 1)) { guardLinked(linkedAtBar(BS.note.bar + 1).id); return; } const nn = BS.note; BS.note = null; bsDo((t, ctx) => Bs.bassDeleteNote(t, ctx, nn.bar, nn.k), 'Nota silindi.'); } return; }
  if (mod || e.altKey) return;
  if (e.key === 'l' || e.key === 'L') { e.preventDefault(); bassBarAction('lock'); }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); bassBarAction('reroll'); }
});

// ---- ölçü menüsü eylemleri
function bassBarAction(act, arg) {
  const bars = selBars(); if (!bars.length) return;
  const linked = bars.map((i) => linkedAtBar(i + 1)).find(Boolean);
  if (linked) { guardLinked(linked.id); return; }
  const a = bars[0], z = bars[bars.length - 1];
  const fix = (t) => bars.filter((i) => t.bars[i] && t.bars[i].source !== 'loop');
  if (act === 'lock') bsDo((t) => { const all = bars.every((i) => t.bars[i].locked); Bs.bassLockRange(t, a, z, !all); }, 'Kilit değişti.');
  else if (act === 'reroll') bsDo((t, ctx) => { let n = 0; for (const i of bars) if (Bs.bassReroll(t, ctx, i)) n++; if (!n) status('Kilitli ölçüler yeniden zarlanmaz.'); else status(`${n} ölçü yeniden üretildi (başka ölçü değişmedi).`); });
  else if (act === 'denser' || act === 'sparser') bsDo((t, ctx) => { let n = 0; for (const i of bars) if (Bs.bassDensity(t, ctx, i, act === 'denser' ? 1 : -1)) n++; status(n ? `${n} ölçü ${act === 'denser' ? 'yoğunlaştı' : 'seyrekleşti'}.` : 'Ailede daha ' + (act === 'denser' ? 'yoğun' : 'seyrek') + ' kardeş şablon yok.'); });
  else if (act === 'copy') bsDo((t, ctx) => { const n = Bs.bassCopyForward(t, ctx, a, arg || 3); status(`${n} ölçüye kopyalandı (her ölçünün akoruna yeniden perdelendi).`); });
  else if (act === 'refit') bsDo((t, ctx) => { let n = 0; for (const i of bars) if (Bs.bassRefit(t, ctx, i)) n++; status(`${n} ölçü yeni akora uydu (ritim ve roller aynı).`); });
  else if (act === 'clear') bsDo((t, ctx) => { for (const i of fix(t)) Bs.bassClear(t, ctx, i); });
  else if (act === 'breakloop') bsDo((t, ctx) => { const ids = new Set(); for (const i of bars) { const L = Bs.loopCopyOf(t, i) || (t.loops || []).find((x) => i >= x.sourceStart && i < x.sourceStart + x.sourceLength); if (L) ids.add(L.id); } for (const id of ids) Bs.bassBreakLoop(t, ctx, id); status(ids.size ? 'Döngü çözüldü: kopyalar kilitli sıradan ölçü oldu, notalar değişmedi.' : 'Seçimde döngü yok.'); });
}

// ---- panel
const bchip = (k, v, label, on, extra = '') => `<button type="button" class="gchip${on ? ' on' : ''}" data-bk="${k}" data-bv="${esc(v)}"${extra}>${label}</button>`;
const bsl = (k, label, min, max, val, fmt, step = 1) => `<label class="gsl">${label}<input type="range" data-bs="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt(val)}</output></label>`;
const bgrow = (title, body) => `<div class="grow-l"><div class="gtitle">${title}</div>${body}</div>`;
const noteLabel = (m) => C.noteName(m);
function curSection() { const t = bTrack(), secs = S.d ? S.d.sections : []; return secs.find((s) => s.id === BS.sec) || secs[0] || null; }
function pedalFormHtml() {
  const f = BS.form; if (!f || f.type !== 'pedal') return '';
  const p = f.pedal;
  return `<div class="adv-opt"><div class="gtitle">Pedal notası</div>
    <div class="gsub"><span>Tür</span>${bchip('pk', 'degree', 'Akor derecesi', p.kind === 'degree')}${bchip('pk', 'pitch', 'Sabit perde', p.kind === 'pitch')}</div>
    ${p.kind === 'degree' ? `<div class="gsub"><span>Derece</span>${PED_DEG.map((d) => bchip('pd', d, String(d), p.degree === d)).join('')}</div>` : `<div class="gsub"><span>Perde</span>${PCS.map((x) => bchip('pp', x, x, p.pitchClass === x)).join('')}</div>`}
    <div class="gsub"><span>Oktav</span>${[[-1, '−1'], [0, '0'], [1, '+1']].map(([v, l]) => bchip('po', v, l, p.octave === v)).join('')}${bchip('pm', 'strict', 'Katı', p.octaves === 'strict')}${bchip('pm', 'allow-octave-jumps', 'Oktav sıçraması', p.octaves === 'allow-octave-jumps')}${bchip('pa', 'ap', 'Yaklaşma', !!p.approach)}</div>
    <div class="row"><button class="accent small" data-bk="pedalApply">${f.scope === 'section' ? 'Bölüme uygula' : 'Seçili ölçülere uygula'}</button><button class="small" data-bk="pedalRemove">Pedalı kaldır</button><button class="small" data-bk="formClose">Kapat</button></div></div>`;
}
function loopFormHtml() {
  const f = BS.form; if (!f || f.type !== 'loop') return '';
  const nb = S.d ? S.d.bars : 0;
  return `<div class="adv-opt"><div class="gtitle">Seçili ölçüleri döngüye al</div>
    <div class="hint">Kaynak: ${f.src[0] + 1}–${f.src[1] + 1}. ölçü (${f.src[1] - f.src[0] + 1} ölçü). Hedef: ${f.src[1] + 2}. ölçüden başlar.</div>
    <div class="row"><label class="grow">Hedefin son ölçüsü<input type="number" min="${f.src[1] + 2}" max="${nb}" value="${f.end + 1}" data-bs="loopEnd"></label></div>
    <div class="gsub"><span>Mod</span>${bchip('lm', 'follow-chords', 'Akora uy', f.mode === 'follow-chords')}${bchip('lm', 'exact', 'Birebir', f.mode === 'exact')}</div>
    <div class="row"><button class="accent small" data-bk="loopMake">Döngüyü kur</button><button class="small" data-bk="formClose">Kapat</button></div></div>`;
}
function barMenuHtml() {
  const t = bTrack(), bars = selBars();
  if (!bars.length || !t) return '<span class="hint">Şeritte bir ölçü seç (Shift: aralık). L kilit · R zar · Delete nota sil · çift tık nota ekler.</span>';
  const a = bars[0], z = bars[bars.length - 1], all = bars.every((i) => t.bars[i] && t.bars[i].locked);
  const anyLoop = bars.some((i) => (t.bars[i] && t.bars[i].source === 'loop') || (t.loops || []).some((L) => i >= L.sourceStart && i < L.sourceStart + L.sourceLength));
  const dirty = bars.some((i) => t.bars[i] && t.bars[i].dirtyLocked);
  const b0 = t.bars[a], info = b0 ? `${a === z ? `${a + 1}. ölçü` : `${a + 1}–${z + 1}. ölçüler`} · şablon: ${esc(b0.templateId || '—')} · enerji ${b0.energy.toFixed(2)} · kaynak: ${esc(b0.source)}${b0.rerollCount ? ` · zar ×${b0.rerollCount}` : ''}${b0.dirtyLocked ? ' · ⚠ akor değişti' : ''}` : '';
  const warns = bars.flatMap((i) => (t.bars[i] && t.bars[i].warnings) || []);
  return `<div class="hint">${info}</div>${warns.length ? `<div class="st-warn">❗ ${esc([...new Set(warns)].join(' · '))}</div>` : ''}
    <div class="gchips">${bchip('bar', 'lock', all ? '🔓 Kilidi aç (L)' : '🔒 Kilitle (L)', false)}${bchip('bar', 'pedal', '⚓ Pedal notası…', false)}${bchip('bar', 'loop', '⟲ Döngüye al…', false)}${anyLoop ? bchip('bar', 'breakloop', 'Döngüyü çöz', false) : ''}
    ${bchip('bar', 'reroll', '🎲 Zar (R)', false)}${bchip('bar', 'denser', 'Yoğun', false)}${bchip('bar', 'sparser', 'Seyrek', false)}${bchip('bar', 'copy', '⇥ İleri kopyala', false)}${dirty ? bchip('bar', 'refit', 'Yeniden uydur', false) : bchip('bar', 'refit', 'Yeniden uydur', false)}${bchip('bar', 'clear', 'Temizle', false)}</div>${pedalFormHtml()}${loopFormHtml()}`;
}
function sectionPanelHtml() {
  const t = bTrack(), sec = curSection();
  if (!sec) return '<span class="hint">Bölüm yok — önce akor izi ya da bölüm ekle.</span>';
  const linked = !!linkSource(sec.id);
  const set = (linked ? C.resolvedBass(S.proj, S.d) : t).sections[sec.id]; if (!set) return '';
  const synth = t.instrumentType === 'synth';
  const fams = [['auto', 'Otomatik'], ['drone', 'Drone'], ['walk', 'Yürüyüş'], ['drive', 'Sürüş'], ['roll', 'Yuvarlanma']];
  if ((t.customTemplates || []).some((x) => x.saved)) fams.push(['custom', 'Özel']);
  const opts = (S.d.sections || []).map((s) => `<option value="${esc(s.id)}"${s.id === sec.id ? ' selected' : ''}>${esc(s.name)} (${s.startBar}–${s.endBar})</option>`).join('');
  const ped = set.pedal ? `⚓ ${set.pedal.kind === 'pitch' ? set.pedal.pitchClass : set.pedal.degree}. derece` : 'yok';
  return `<label>Bölüm<select data-bs="sec">${opts}</select></label>${linked ? linkActions(sec.id) + '<fieldset class="link-readonly" disabled>' : ''}
    ${bsl('eS', 'Enerji başı', 0, 100, Math.round(set.energyStart * 100), (x) => x + '%')}${bsl('eE', 'Enerji sonu', 0, 100, Math.round(set.energyEnd * 100), (x) => x + '%')}
    <div class="gsub"><span>Şablon ailesi</span>${fams.map(([v, l]) => bchip('fam', v, l, set.templateFamily === v)).join('')}</div>
    ${bsl('den', 'Yoğunluk', 0, 100, Math.round(set.density * 100), (x) => x + '%')}
    <div class="gsub"><span>Kayıt</span>${[[-12, 'Alt oktav'], [0, 'Normal'], [12, 'Üst oktav']].map(([v, l]) => bchip('reg', v, l, set.registerOffset === v)).join('')}</div>
    <div class="gsub"><span>Dolgu</span>${bchip('fills', 'f', set.fills ? 'Açık' : 'Kapalı', set.fills)}<span>Bölüm kilidi</span>${bchip('seclock', 'l', set.locked ? '🔒 Kilitli' : 'Kilitsiz', set.locked)}<span>Pedal</span>${bchip('secpedal', 'p', ped, !!set.pedal)}</div>
    ${synth ? `<div class="gsub"><span>Hipnotik</span>${bchip('hyp', 'h', set.hypnotic ? 'Açık' : 'Kapalı', set.hypnotic)}</div>
    ${bsl('fS', 'Süzgeç başı', 0, 100, Math.round((set.filterStart ?? set.energyStart) * 100), (x) => x + '%')}${bsl('fE', 'Süzgeç sonu', 0, 100, Math.round((set.filterEnd ?? set.energyEnd) * 100), (x) => x + '%')}
    <div class="gsub"><span>Süpürme</span>${[[0, 'Yok'], [4, '4 ölçü'], [8, '8 ölçü']].map(([v, l]) => bchip('sweep', v, l, set.sweepBars === v)).join('')}${set.filterStart != null ? bchip('filterAuto', 'a', 'Süzgeç: enerjiyi izle', false) : ''}</div>` : ''}${linked ? '</fieldset>' : ''}`;
}
function bassPanelHtml() {
  const t = bTrack(), synth = t.instrumentType === 'synth', presets = Bs.BASS_PRESET_NAMES[t.instrumentType];
  const profs = Bs.profileList(t), mix = t.styleMix || { profileB: '', amount: 0 };
  const m = S.proj.mixer.bass;
  const sel = (id, list, cur, none) => `<select data-bs="${id}">${none ? `<option value="">${none}</option>` : ''}${list.map((x) => `<option value="${esc(x.id || x)}"${(x.id || x) === cur ? ' selected' : ''}>${esc(x.name || x)}</option>`).join('')}</select>`;
  const top = `<div class="row"><label class="chk"><input type="checkbox" data-bs="on"${t.enabled ? ' checked' : ''}> Oynatırken bas çalsın</label></div>
    <div class="row"><button class="accent" data-bk="generate" title="Kilitsiz tüm ölçüleri mevcut tohumla yeniden üretir">Generate</button><label class="grow">Tohum<input type="number" data-bs="seed" step="1" value="${t.seed}"></label><button data-bk="dice" title="Yeni tohum seç ve kilitsiz ölçüleri yeniden üret">🎲</button></div>
    <div class="row"><button class="small" data-bk="undo"${BS.hist.undo.length ? '' : ' disabled'}>↶ Geri al</button><button class="small" data-bk="redo"${BS.hist.redo.length ? '' : ' disabled'}>↷ Yinele</button><button class="small" data-bk="demo">Demo şarkıyı yükle</button><span class="hint">Ctrl+Z · ${BS.hist.undo.length} geri alınabilir</span></div>`;
  const inst = `<div class="gsub"><span>Tür</span>${Object.entries(BASS_TYPE_TR).map(([v, l]) => bchip('type', v, l, t.instrumentType === v)).join('')}</div>
    <label>Ses (preset)<select data-bs="preset">${presets.map((p) => `<option${p === t.instrumentPreset ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    ${bsl('vol', 'Ses seviyesi', 0, 100, Math.round(t.volume * 100), (x) => x + '%')}
    <div class="gsub"><span>Mikser</span>${bchip('mute', 'm', 'M', m.mute, ' title="Sustur"')}${bchip('solo', 's', 'S', m.solo, ' title="Solo"')}</div>
    <div class="gsub"><span>Katman</span><select data-bs="layerPreset"><option value="none">Yok</option>${Object.keys(Bs.BASS_PRESETS).map((p) => `<option${t.layer && t.layer.preset === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>${[[-12, '−12'], [0, '0'], [12, '+12']].map(([v, l]) => bchip('layerOct', v, l, (t.layer ? t.layer.octaveOffset : 0) === v, t.layer && t.layer.preset !== 'none' ? '' : ' disabled')).join('')}</div>
    ${samplerHtml()}
    <div class="gsub"><span>Düşük notalar</span>${bchip('dbl', 'd', t.doubleLow ? 'MIDI 31 altı oktav yukarı ikilenir (%30)' : 'İkileme kapalı', t.doubleLow)}</div>
    ${synth ? `${bsl('pump', 'Pompa (tempo senkron)', 0, 60, Math.round(t.pump * 100), (x) => x + '%')}
      <div class="gsub"><span>Rezonans</span>${t.resonance == null ? bchip('resAuto', 'a', 'Oto (enerji)', true) : bsl('res', '', 0, 100, Math.round(t.resonance * 100), (x) => x + '%') + bchip('resAuto', 'a', 'Oto', false)}${t.resonance == null ? bchip('resMan', 'm', 'Elle', false) : ''}</div>
      <div class="gsub"><span>Drive</span>${t.drive == null ? bchip('drvAuto', 'a', 'Oto (enerji)', true) : bsl('drv', '', 0, 100, Math.round(t.drive * 100), (x) => x + '%') + bchip('drvAuto', 'a', 'Oto', false)}${t.drive == null ? bchip('drvMan', 'm', 'Elle', false) : ''}</div>
      <div class="gsub"><span>Şablonlar</span>${bchip('gtpl', 'g', t.synthGuitarTemplates ? 'Gitar şablonları açık' : 'Gitar şablonları gizli', t.synthGuitarTemplates)}</div>` : ''}
    <div class="gsub"><span>Aralık</span><input type="number" data-bs="rlo" min="0" max="120" value="${t.range.low}" style="width:56px"> – <input type="number" data-bs="rhi" min="12" max="127" value="${t.range.high}" style="width:56px"> <span class="hint">${noteLabel(t.range.low)}–${noteLabel(t.range.high)}</span></div>`;
  const style = `<label>Stil profili<select data-bs="prof">${profs.map((p) => `<option value="${esc(p.id)}"${p.id === t.styleProfileId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label>Karışım: ikinci profil<select data-bs="profB"><option value="">Yok</option>${profs.filter((p) => p.id !== t.styleProfileId).map((p) => `<option value="${esc(p.id)}"${p.id === mix.profileB ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${bsl('mix', 'Karışım miktarı', 0, 100, Math.round((mix.amount || 0) * 100), (x) => x + '%')}`;
  const tapHtml = typeof bassTapHtml === 'function' ? bassTapHtml() : '';
  const learnHtml = typeof bassLearnHtml === 'function' ? bassLearnHtml() : '';
  return top + bgrow('Enstrüman', inst) + bgrow('Stil', style) + bgrow('Bölüm paneli', sectionPanelHtml()) + tapHtml + learnHtml
    + `<div class="row"><button data-bk="exportMidi">Bası .mid olarak aktar</button></div>`;
}
function renderBass() {
  if (!$('#bassPanel') || !S.proj.bass) return;
  const html = bassPanelHtml();
  if ($('#bassPanel').dataset.h !== html) { $('#bassPanel').innerHTML = html; $('#bassPanel').dataset.h = html; }
  const linked = selBars().map((i) => linkedAtBar(i + 1)).find(Boolean);
  const menu = linked ? linkActions(linked.id) + '<fieldset class="link-readonly" disabled>' + barMenuHtml() + '</fieldset>' : barMenuHtml();
  if ($('#bsBarMenu').dataset.h !== menu) { $('#bsBarMenu').innerHTML = menu; $('#bsBarMenu').dataset.h = menu; }
  const info = !S.d ? '' : BS.lastSync && BS.lastSync.flagged.length ? `⚠ ${BS.lastSync.flagged.length} kilitli ölçüde akor değişti — ölçüyü seçip "Yeniden uydur".` : '';
  const hint = $('#bsHint'); if (hint) hint.textContent = info;
}
// ---- panel olayları
function bsCommon(k, v) {
  if (['fam', 'reg', 'fills', 'hyp', 'sweep', 'filterAuto', 'seclock', 'secpedal'].includes(k) && guardLinked(curSection()?.id)) return;
  if (['bar', 'pedalApply', 'loopMake'].includes(k)) { const linked = selBars().map((i) => linkedAtBar(i + 1)).find(Boolean); if (linked) { guardLinked(linked.id); return; } }
  const t = bTrack();
  switch (k) {
    case 'generate': bsDo((tr, ctx) => { Bs.bassGenerateAll(tr, ctx); }, 'Bas hattı üretildi (kilitli ölçüler korundu).'); break;
    case 'dice': bsDo((tr, ctx) => { Bs.bassNewSeed(tr, ctx); }, 'Yeni tohum: ' + bTrack().seed); break;
    case 'undo': bsUndo(false); break;
    case 'redo': bsUndo(true); break;
    case 'demo': loadDemoSong(); break;
    case 'type': bsDo((tr, ctx) => { Bs.bassSwitchType(tr, ctx, v); }, `${BASS_TYPE_TR[v]}: kilitli ve elle yazılan ölçüler korundu, kalanı yeniden üretildi.`); break;
    case 'mute': S.proj.mixer.bass.mute = !S.proj.mixer.bass.mute; Player.applyMixer(); syncMixerStrip('bass'); renderBass(); break;
    case 'solo': S.proj.mixer.bass.solo = !S.proj.mixer.bass.solo; Player.applyMixer(); syncMixerStrip('bass'); renderBass(); break;
    case 'dbl': bsDo((tr) => { tr.doubleLow = !tr.doubleLow; }); break;
    case 'layerOct': bsDo((tr) => { tr.layer = Object.assign({ preset: 'none', octaveOffset: 0 }, tr.layer, { octaveOffset: +v }); }); break;
    case 'gtpl': bsDo((tr, ctx) => { tr.synthGuitarTemplates = !tr.synthGuitarTemplates; }); break;
    case 'resAuto': bsDo((tr) => { tr.resonance = null; }); break;
    case 'resMan': bsDo((tr) => { tr.resonance = 0.4; }); break;
    case 'drvAuto': bsDo((tr) => { tr.drive = null; }); break;
    case 'drvMan': bsDo((tr) => { tr.drive = 0.3; }); break;
    case 'fam': case 'reg': case 'fills': case 'hyp': case 'sweep': case 'filterAuto': case 'seclock': {
      const sec = curSection(); if (!sec) break;
      bsDo((tr, ctx) => {
        const s = tr.sections[sec.id];
        if (k === 'fam') s.templateFamily = v; else if (k === 'reg') s.registerOffset = +v; else if (k === 'fills') s.fills = !s.fills;
        else if (k === 'hyp') { s.hypnotic = !s.hypnotic; if (s.hypnotic) s.fills = false; } else if (k === 'sweep') s.sweepBars = +v; else if (k === 'filterAuto') { s.filterStart = null; s.filterEnd = null; }
        else if (k === 'seclock') Bs.bassLockSection(tr, ctx, sec.id, !s.locked);
        if (['fam', 'reg', 'fills', 'hyp'].includes(k)) Bs.bassRegenSection(tr, ctx, sec.id);
      });
      break;
    }
    case 'secpedal': { const sec = curSection(); if (!sec) break; BS.form = { type: 'pedal', scope: 'section', secId: sec.id, pedal: Object.assign({ kind: 'degree', degree: 1, octave: 0, octaves: 'strict', approach: false }, t.sections[sec.id].pedal) }; renderBass(); break; }
    case 'bar': {
      if (v === 'pedal') { const a = selBars()[0]; const cur = t.bars[a] && t.bars[a].pedal; BS.form = { type: 'pedal', scope: 'bars', pedal: Object.assign({ kind: 'degree', degree: 5, octave: 0, octaves: 'strict', approach: false }, cur) }; renderBass(); }
      else if (v === 'loop') { const bars = selBars(); BS.form = { type: 'loop', src: [bars[0], bars[bars.length - 1]], end: Math.min(S.d.bars - 1, bars[bars.length - 1] + (bars[bars.length - 1] - bars[0] + 1) * 3), mode: 'follow-chords' }; renderBass(); }
      else bassBarAction(v);
      break;
    }
    case 'pk': BS.form.pedal.kind = v; if (v === 'pitch' && !BS.form.pedal.pitchClass) BS.form.pedal.pitchClass = 'E'; renderBass(); break;
    case 'pd': BS.form.pedal.degree = +v; renderBass(); break;
    case 'pp': BS.form.pedal.pitchClass = v; renderBass(); break;
    case 'po': BS.form.pedal.octave = +v; renderBass(); break;
    case 'pm': BS.form.pedal.octaves = v; renderBass(); break;
    case 'pa': BS.form.pedal.approach = !BS.form.pedal.approach; renderBass(); break;
    case 'lm': BS.form.mode = v; renderBass(); break;
    case 'formClose': BS.form = null; renderBass(); break;
    case 'pedalApply': case 'pedalRemove': {
      const f = BS.form, ped = k === 'pedalApply' ? Object.assign({}, f.pedal) : null;
      bsDo((tr, ctx) => {
        if (f.scope === 'section') { const s = ctx.secs.find((x) => x.id === f.secId); if (ped) tr.sections[f.secId].pedal = ped; else delete tr.sections[f.secId].pedal; Bs.bassRegenSection(tr, ctx, f.secId); void s; }
        else { const bars = selBars(); Bs.bassSetPedal(tr, ctx, bars[0], bars[bars.length - 1], ped); Bs.bassRegenRange(tr, ctx, bars[0], bars[bars.length - 1]); }
      }, ped ? 'Pedal notası uygulandı (yalnızca perde kısıtı; ritim şablonlardan gelir).' : 'Pedal kaldırıldı.');
      BS.form = null; renderBass();
      break;
    }
    case 'loopMake': {
      const f = BS.form; let res;
      bsDo((tr, ctx) => { res = Bs.bassMakeLoop(tr, ctx, { sourceStart: f.src[0], sourceLength: f.src[1] - f.src[0] + 1, targetStart: f.src[1] + 1, targetEnd: f.end, mode: f.mode }); });
      if (res && !res.ok) { BS.hist.undo.pop(); status('Döngü kurulamadı: ' + res.reason, 'err'); } else { status('Döngü kuruldu: kaynak ölçüler kilitlendi, hedefler türetilir.'); BS.form = null; }
      renderBass(); drawBass();
      break;
    }
    case 'exportMidi': if (!S.d) { status('Önce akor izi gerekli.', 'err'); break; } download(Bs.bassMidi(t, S.proj, S.d), 'bas.mid', 'audio/midi'); status('Bas .mid olarak dışa aktarıldı (tempo, ölçü ve nota başına bir olay).'); break;
    default: if (typeof bassTapAction === 'function' && bassTapAction(k, v)) break; if (typeof bassLearnAction === 'function') bassLearnAction(k, v);
  }
}
function syncMixerStrip(tr) { const strip = document.querySelector(`.strip[data-track=${tr}]`); if (!strip) return; const m = S.proj.mixer[tr]; strip.querySelector('.mute').classList.toggle('on', m.mute); strip.querySelector('.solo').classList.toggle('on', m.solo); }
$('#bassPanel').addEventListener('click', (e) => { const b = e.target.closest('[data-bk]'); if (b && !b.disabled) bsCommon(b.dataset.bk, b.dataset.bv); });
$('#bsBarMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-bk]'); if (b && !b.disabled) bsCommon(b.dataset.bk, b.dataset.bv); });
$('#bsBarMenu').addEventListener('change', (e) => { const el = e.target; if (el.dataset.bs === 'loopEnd' && BS.form) { BS.form.end = Math.max(BS.form.src[1] + 1, Math.min(S.d.bars - 1, (+el.value || 1) - 1)); renderBass(); } });
function bsSelectChange(el) {
  const v = el.value, k = el.dataset.bs;
  if (k === 'sec') { BS.sec = v; renderBass(); return; }
  if (k === 'preset') bsDo((t) => { t.instrumentPreset = v; });
  else if (k === 'layerPreset') bsDo((t) => { t.layer = Object.assign({ octaveOffset: 0 }, t.layer, { preset: v }); });
  else if (k === 'prof') bsDo((t, ctx) => { t.styleProfileId = v; t.feelId = null; if (t.styleMix && t.styleMix.profileB === v) t.styleMix = null; Bs.bassGenerateAll(t, ctx); }, 'Stil profili uygulandı; kilitsiz ölçüler yeniden üretildi.');
  else if (k === 'profB') bsDo((t, ctx) => { t.styleMix = v ? { profileB: v, amount: (t.styleMix && t.styleMix.amount) || 0.5 } : null; Bs.bassGenerateAll(t, ctx); });
  else if (k === 'seed') bsDo((t, ctx) => { t.seed = (parseInt(el.value, 10) || 1) | 0; Bs.bassGenerateAll(t, ctx); }, 'Tohum değişti; kilitsiz ölçüler yeniden üretildi.');
  else if (k === 'rlo' || k === 'rhi') bsDo((t, ctx) => { const lo = k === 'rlo' ? +v : t.range.low, hi = k === 'rhi' ? +v : t.range.high; t.range = { low: Math.min(lo, hi - 12), high: Math.max(hi, lo + 12) }; Bs.bassGenerateAll(t, ctx); });
  else if (k === 'on') { bTrack().enabled = el.checked; renderMatrix(); drawBass(); renderBass(); if (Player.playing) Player.play(); }
  else if (bassTapChange(el)) { /* tap alanı */ }
  else if (typeof bassLearnChange === 'function') bassLearnChange(el);
}
$('#bassPanel').addEventListener('change', (e) => { if (e.target.dataset.bs && e.target.type !== 'range') bsSelectChange(e.target); });
// kaydırıcılar: sürüklerken yalnızca değeri ve sesi güncelle, bırakınca yeniden üret
let bsSliderSnap = null;
$('#bassPanel').addEventListener('input', (e) => {
  const el = e.target, k = el.dataset.bs;
  if (!k || el.type !== 'range') return;
  const t = bTrack(), x = +el.value, sec = curSection();
  if (['eS', 'eE', 'den', 'fS', 'fE'].includes(k) && (!sec || guardLinked(sec.id))) return;
  if (!bsSliderSnap) bsSliderSnap = Bs.historyPush(BS.hist, t) || true;
  const fmt = { fS: '%', fE: '%' };
  const set = {
    vol: () => { t.volume = x / 100; if (Player.bassVoices) Player.bassVoices.forEach((v) => v.inst.setVolume(t.volume)); }, mix: () => { t.styleMix = { profileB: (t.styleMix && t.styleMix.profileB) || '', amount: x / 100 }; }, pump: () => { t.pump = x / 100; },
    res: () => { t.resonance = x / 100; }, drv: () => { t.drive = x / 100; },
    eS: () => { t.sections[sec.id].energyStart = x / 100; }, eE: () => { t.sections[sec.id].energyEnd = x / 100; }, den: () => { t.sections[sec.id].density = x / 100; },
    fS: () => { t.sections[sec.id].filterStart = x / 100; }, fE: () => { t.sections[sec.id].filterEnd = x / 100; },
  }[k];
  if (!set) { if (typeof bassLearnInput === 'function') bassLearnInput(el); return; }
  set(); void fmt;
  const out = el.parentElement.querySelector('output'); if (out) out.textContent = x + '%';
  $('#bassPanel').dataset.h = '';
});
$('#bassPanel').addEventListener('change', (e) => {
  const el = e.target, k = el.dataset.bs;
  if (!k || el.type !== 'range') return;
  bsSliderSnap = null;
  const sec = curSection();
  if (['eS', 'eE', 'den', 'fS', 'fE'].includes(k) && guardLinked(sec?.id)) return;
  if (['eS', 'eE', 'den'].includes(k) && sec) { const t = bTrack(), ctx = bCtx(); Bs.bassRegenSection(t, ctx, sec.id); }
  if (k === 'mix') { const t = bTrack(), ctx = bCtx(); if (t.styleMix && !t.styleMix.profileB) t.styleMix = null; Bs.bassGenerateAll(t, ctx); }
  bsAfter();
});
// bas satırı çalan olay sayısı ve seçim ipucu panelin dışında da güncellenir
$('#bsBarMenu').addEventListener('input', () => {});

// ---------------------------------------------------------------- TAP İLE RİTİM KAYDI
// Seçili ölçülere bir ölçülük sayım + metronomla B tuşu (ya da ekrandaki pedle) ritim vurulur; vuruşlar ızgaraya yuvarlanır,
// perdeler üreticiden gelir (yalnızca ritim kaydedilir). Zaman: tuş anı → ses saati (getOutputTimestamp, yoksa currentTime), gecikme ayarı çıkarılır.
BS.tap = { phase: 'idle', taps: [], down: null, from: 0, startAt: 0, a: 0, z: 0, recBars: [0, 0], timer: null, calib: null, saveName: '', last: null };
const tapCfg = () => bTrack().tap;
function audioTimeOf(perfMs) {
  const rc = Tone.getContext().rawContext;
  const ts = rc.getOutputTimestamp ? rc.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  return rc.currentTime - (performance.now() - perfMs) / 1000 - (rc.outputLatency || 0);
}
// ses saatinden şarkı saniyesine (kayıt başlangıcına göre) ve gecikme düzeltmesi
const tapSongSec = (audioT) => BS.tap.from + (audioT - BS.tap.startAt) - tapCfg().latencyMs / 1000;
function tapRange() {
  const g = S.d.g, t = tapCfg(), bars = selBars();
  const a = bars[0], z = bars[bars.length - 1];
  const recZ = t.mode === 'loop' ? Math.min(z, a + (t.loopBars === 2 ? 2 : 1) - 1) : z;
  return { a, z, recZ, g };
}
async function tapStart(opts = {}) {
  const T = BS.tap;
  if (T.phase !== 'idle') return;
  if (!S.d) { status('Önce bir akor izi gerekli.', 'err'); return; }
  if (!BS.sel) { status('Önce bas şeridinde kaydedilecek ölçüleri seç (Shift: aralık).', 'err'); return; }
  const linked = selBars().map((i) => linkedAtBar(i + 1)).find(Boolean);
  if (linked) { guardLinked(linked.id); return; }
  const { a, z, recZ, g } = tapRange();
  T.a = a; T.z = z; T.recBars = [a, recZ]; T.taps = []; T.down = null; T.last = null; T.armed = false;
  T.phase = 'count'; renderBass();
  const countSec = g.barSec, fromSec = a * g.barSec, recSec = (recZ - a + 1) * g.barSec;
  await Player.play({
    from: fromSec, countIn: countSec, noBass: true, click: true,
    onStart: (now) => {
      T.startAt = now; T.from = fromSec; T.armed = true;
      // sayım tıkları: transport'tan önce, ses saatinde
      const pulses = Math.round(g.barQ / g.pulseQ);
      for (let k = 0; k < pulses; k++) Player.click.triggerAttackRelease(CLICK_HZ[k === 0 ? 'down' : 'weak'], 0.03, now - countSec + k * g.pulseQ * g.spq);
    },
  });
  if (!Player.playing) { T.phase = 'idle'; renderBass(); return; }
  clearInterval(T.timer);
  const endAudio = T.startAt + recSec;
  // evre ses saatine bağlı: sayım bitince 'rec'; sayımdaki erken vuruşlar toplanır, aralık dışı olanlar yuvarlamada atılır
  T.timer = setInterval(() => {
    const now = Tone.getContext().rawContext.currentTime;
    if (T.phase === 'count' && now >= T.startAt) { T.phase = 'rec'; renderBass(); }
    if (now >= endAudio + 0.1) tapFinish();
  }, 40);
  if (opts.auto) tapAuto(opts.auto); // sınama: sahte vuruşlar
}
// tuş basıldı/bırakıldı (perfMs: event.timeStamp)
function tapDown(perfMs) {
  const T = BS.tap;
  if (T.calib && T.calib.running) { T.calib.taps.push(audioTimeOf(perfMs)); return; }
  if (!(T.phase === 'rec' || (T.phase === 'count' && T.armed)) || T.down) return;
  const sec = tapSongSec(audioTimeOf(perfMs)), q = sec / S.d.g.spq;
  T.down = { q, vel: 96 };
  const pad = $('#bsTapPad'); if (pad) pad.classList.add('hit');
}
function tapUp(perfMs) {
  const T = BS.tap;
  const pad = $('#bsTapPad'); if (pad) pad.classList.remove('hit');
  if (!(T.phase === 'rec' || T.phase === 'count') || !T.down) return;
  const q1 = tapSongSec(audioTimeOf(perfMs)) / S.d.g.spq;
  T.taps.push({ q: T.down.q, dq: Math.max(0, q1 - T.down.q), vel: T.down.vel });
  T.down = null;
}
// kaydı bitir: yuvarla ve uygula (asPlayed: yalnızca vuruşlu ölçüler değişir)
function tapFinish(rawTaps) {
  const T = BS.tap, t = tapCfg();
  clearInterval(T.timer); T.timer = null;
  if (T.down) tapUp(performance.now());
  const taps = rawTaps || T.taps;
  Player.stop();
  T.phase = 'idle';
  const g = S.d.g;
  const perBar = Bs.tapQuantize(taps, { gridSteps: t.grid === '8n' ? 2 : 1, barQ: g.barQ, firstBar: T.recBars[0], lastBar: T.recBars[1] });
  T.last = { count: taps.length, bars: [...perBar.keys()].sort((x, y) => x - y) };
  if (!perBar.size) { status('Hiç vuruş yakalanmadı — kayıt uygulanmadı. Yeniden dene ya da gecikme ayarını kontrol et.', 'err'); renderBass(); return; }
  let res;
  bsDo((tr, ctx) => {
    res = Bs.bassApplyTaps(tr, ctx, perBar, { mode: t.mode, firstBar: T.a, lastBar: T.z, loopBars: t.loopBars, loopMode: 'follow-chords' });
  });
  if (res && !res.ok) { BS.hist.undo.pop(); status('Uygulanamadı: ' + res.reason, 'err'); } else status(`${taps.length} vuruş → ${res.bars} ölçüye yazıldı (ritim senin, perdeler üreticiden; Generate yalnızca perdeleri yeniden seçer).`);
  renderBass(); drawBass();
}
function tapCancel() { const T = BS.tap; clearInterval(T.timer); T.timer = null; T.phase = 'idle'; T.down = null; T.calib = null; Player.stop(); renderBass(); }
// gecikme kalibrasyonu: 100 BPM'de 8 tık, B ile eşlik et; medyan fark gecikme ayarına yazılır
async function tapCalibrate() {
  const T = BS.tap;
  if (T.phase !== 'idle') return;
  try { await Player.ensure(); } catch (e) { status(e.message, 'err'); return; }
  Player.stop(true);
  const rc = Tone.getContext().rawContext, lead = 0.6, clicks = [];
  for (let k = 0; k < 8; k++) { const at = Tone.now() + lead + k * 0.6; clicks.push(at); Player.click.triggerAttackRelease(CLICK_HZ[k % 4 ? 'weak' : 'down'], 0.03, at); }
  void rc;
  T.calib = { running: true, taps: [], clicks };
  status('Kalibrasyon: 8 tık duyacaksın — her tıkla birlikte B\'ye bas (ya da pede dokun).');
  renderBass();
  setTimeout(() => tapCalibDone(), (lead + 8 * 0.6) * 1000 + 400);
}
function tapCalibDone(forceClicks, forceTaps) {
  const T = BS.tap, c = T.calib;
  if (!c && !forceClicks) return;
  const r = Bs.tapOffset(forceClicks || c.clicks, forceTaps || c.taps);
  T.calib = null;
  if (!r.ok) status(`Kalibrasyon başarısız: yalnızca ${r.n} vuruş tıklara yakındı (en az 4 gerekir). Yeniden dene.`, 'err');
  else { tapCfg().latencyMs = r.offsetMs; status(`Gecikme ${r.offsetMs} ms olarak ayarlandı (${r.n} vuruş, sapma ±${r.madMs} ms).`); }
  renderBass();
  return r;
}
// sınama: kayıt başladıktan sonra sahte vuruşları gerçek ses saatine göre tuş olayları gibi besler
function tapAuto(list) {
  const T = BS.tap, rc = Tone.getContext().rawContext;
  for (const [sec, hold] of list) {
    const d = (T.startAt + sec - rc.currentTime) * 1000;
    setTimeout(() => { tapDown(performance.now()); setTimeout(() => tapUp(performance.now()), Math.max(10, hold * 1000)); }, Math.max(0, d));
  }
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey && (BS.tap.phase !== 'idle' || (BS.tap.calib && BS.tap.calib.running))) { e.preventDefault(); if (!e.repeat) tapDown(e.timeStamp); }
  if (e.key === 'Escape' && BS.tap.phase !== 'idle') tapCancel();
}, true);
document.addEventListener('keyup', (e) => { if ((e.key === 'b' || e.key === 'B') && BS.tap.phase !== 'idle') tapUp(e.timeStamp); }, true);
document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('#bsTapPad')) { e.preventDefault(); tapDown(e.timeStamp); } });
document.addEventListener('pointerup', () => { if (BS.tap.phase !== 'idle' && BS.tap.down) tapUp(performance.now()); });
function bassTapHtml() {
  const t = tapCfg(), T = BS.tap, bars = selBars();
  const rec = T.phase !== 'idle';
  const lastMsg = T.last ? `<div class="hint">Son kayıt: ${T.last.count} vuruş · ölçüler ${T.last.bars.map((i) => i + 1).join(', ') || '—'}</div>` : '';
  const sel = bars.length ? `${bars[0] + 1}${bars.length > 1 ? '–' + (bars[bars.length - 1] + 1) : ''}. ölçü` : 'ölçü seçilmedi';
  const sb = bars.length === 1 && bTrack().bars[bars[0]] && bTrack().bars[bars[0]].notes.length;
  const body = `<div class="hint">Bas şeridinde ölçü(ler) seç → Kaydet → 1 ölçü sayım + metronom, sonra ritmi <b>B</b> tuşuyla (ya da ped) vur. Esc iptal.</div>
    <div class="gsub"><span>Izgara</span>${bchip('tgrid', '16n', '16\'lık', t.grid === '16n')}${bchip('tgrid', '8n', '8\'lik', t.grid === '8n')}<span>Mod</span>${bchip('tmode', 'asPlayed', 'Çaldığım gibi', t.mode === 'asPlayed')}${bchip('tmode', 'loop', 'Bir kalıbı döngüle', t.mode === 'loop')}${t.mode === 'loop' ? `${bchip('tbars', 1, '1 ölçü', t.loopBars !== 2)}${bchip('tbars', 2, '2 ölçü', t.loopBars === 2)}` : ''}</div>
    <div class="gsub"><span>Gecikme</span><input type="number" data-bs="tlat" min="-300" max="500" step="5" value="${t.latencyMs}" style="width:64px"> <span class="hint">ms</span>${bchip('tcalib', 'c', T.calib ? 'Dinleniyor…' : 'Kalibre et', !!T.calib, rec ? ' disabled' : '')}</div>
    <div class="row">${rec ? `<button class="accent small" data-bk="tapStop">${T.phase === 'count' ? 'Sayım… (iptal)' : 'Bitir'}</button>` : `<button class="accent small" data-bk="tapStart"${bars.some((i) => linkedAtBar(i + 1)) ? ' disabled' : ''}>⏺ Kaydet (${sel})</button>`}<button id="bsTapPad" class="small" type="button" title="B tuşu ile aynı">🥁 Vuruş (B)</button></div>
    ${T.phase === 'count' ? '<div class="hint">Sayım… hazır ol.</div>' : T.phase === 'rec' ? '<div class="st-warn">● Kayıt — vur!</div>' : ''}${lastMsg}
    <div class="gsub"><span>Şablon</span><input type="text" data-bs="tname" placeholder="Şablon adı" value="${esc(T.saveName)}" style="width:130px">${bchip('tsave', 's', 'Seçili ölçüyü şablon olarak sakla', false, sb ? '' : ' disabled')}</div>`;
  return bgrow('Ritim kaydı (tap)', body);
}
function bassTapAction(k, v) {
  const t = tapCfg();
  switch (k) {
    case 'tgrid': t.grid = v; break;
    case 'tmode': t.mode = v; break;
    case 'tbars': t.loopBars = +v; break;
    case 'tcalib': tapCalibrate(); return true;
    case 'tapStart': tapStart(); return true;
    case 'tapStop': if (BS.tap.phase === 'rec') tapFinish(); else tapCancel(); return true;
    case 'tsave': {
      const i = selBars()[0], nm = BS.tap.saveName;
      let tpl = null;
      bsDo((tr, ctx) => { tpl = Bs.bassSaveTemplate(tr, ctx, i, nm); });
      if (tpl) { BS.tap.saveName = ''; status(`"${tpl.name}" şablonu saklandı — bölüm panelinde "Özel" ailesinden seçilebilir.`); } else { BS.hist.undo.pop(); status('Bu ölçüde nota yok.', 'err'); }
      return true;
    }
    default: return false;
  }
  renderBass();
  return true;
}
// sayısal / metin alanları (panel 'change' olayı)
function bassTapChange(el) {
  if (el.dataset.bs === 'tlat') { tapCfg().latencyMs = Math.max(-300, Math.min(500, Math.round(+el.value || 0))); renderBass(); return true; }
  if (el.dataset.bs === 'tname') { BS.tap.saveName = el.value; return true; }
  return false;
}

// ---------------------------------------------------------------- STİL ÖĞRENME (MIDI içe aktar / hızlı giriş) + profil saklama
// Ses nota yazıya çevrilmez: girdi bas izi olan bir MIDI dosyası ya da elle yazılan derecelerdir.
const LS_PROFILES = 'dawBassProfiles';
const lsRead = () => { try { const a = JSON.parse(localStorage.getItem(LS_PROFILES) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const lsWrite = (a) => { try { localStorage.setItem(LS_PROFILES, JSON.stringify(a)); } catch (e) { /* özel pencere / kota: yalnızca projede kalır */ } };
// proje açılınca / yenilenince bir kez: tarayıcıda saklı profilleri projeye ekle (aynı kimlik varsa projedeki kalır)
function bassMergeStoredProfiles() {
  if (BS.lsMerged) return;
  BS.lsMerged = true;
  const t = S.proj.bass; if (!t) return;
  for (const p of lsRead()) if (p && p.id && p.templateWeights && !t.profiles.some((x) => x.id === p.id)) t.profiles.push(p);
}
BS.learn = { mode: 'midi', fileName: '', midi: null, track: 0, meter: null, parsed: null, from: 1, to: 1, rows: 4, quick: [], name: '', result: null, error: '' };
const LN = BS.learn;
const energyTR = { low: 'düşük', mid: 'orta', high: 'yüksek' };
const SPARK = '▁▂▃▄▅▆▇█';
const spark = (f) => f.map((x) => (x <= 0 ? '·' : SPARK[Math.min(7, Math.floor(x * 7.999))])).join('');
const quickSteps = () => Bs.stepsOf(S.proj.settings.meter);
function learnEnsureQuick() {
  const n = quickSteps();
  while (LN.quick.length < LN.rows) LN.quick.push({ cells: new Array(n).fill(''), energy: 'mid' });
  LN.quick.length = LN.rows;
  for (const r of LN.quick) { while (r.cells.length < n) r.cells.push(''); r.cells.length = n; }
}
function learnParse() {
  LN.result = null; LN.error = '';
  if (!LN.midi) return;
  try {
    const tr = LN.midi.tracks[LN.track];
    if (!tr || !tr.notes.length) { LN.parsed = null; LN.error = 'Bu izde nota yok.'; return; }
    LN.parsed = Bs.midiBars(LN.midi, LN.track, { meter: LN.meter || undefined });
    if (!LN.meter) LN.meter = LN.parsed.meter;
    const idx = LN.parsed.bars.map((b) => b.index + 1);
    LN.from = Math.min(...idx); LN.to = Math.max(...idx);
  } catch (e) { LN.parsed = null; LN.error = e.message; }
}
async function learnLoadFile(file) {
  try {
    LN.midi = Bs.readMidi(new Uint8Array(await file.arrayBuffer()));
    LN.fileName = file.name;
    const g = Bs.guessBassTrack(LN.midi);
    LN.track = g ?? Math.max(0, LN.midi.tracks.findIndex((t) => t.notes.length));
    LN.meter = null; learnParse();
    if (!LN.error) status(`${file.name}: ${LN.midi.tracks.length} iz, bas izi tahmini: ${LN.midi.tracks[LN.track].name || LN.track + 1}. Köklere göz at, gerekirse düzelt, sonra "Analiz et".`);
  } catch (e) { LN.midi = null; LN.parsed = null; LN.error = e.message; status('MIDI okunamadı: ' + e.message, 'err'); }
  renderBass();
}
function learnInput() {
  if (LN.mode === 'midi') {
    if (!LN.parsed) return null;
    const bars = LN.parsed.bars.filter((b) => b.index + 1 >= LN.from && b.index + 1 <= LN.to);
    return { meter: LN.parsed.meter, steps: LN.parsed.steps, bars, kind: 'midi' };
  }
  learnEnsureQuick();
  const q = Bs.quickBars(LN.quick, S.proj.settings.meter);
  if (q.errors.length) { LN.error = q.errors[0] + (q.errors.length > 1 ? ` (+${q.errors.length - 1} hata)` : ''); return null; }
  LN.error = '';
  return { meter: q.meter, steps: q.steps, bars: q.bars, kind: 'quick' };
}
function learnAnalyze() {
  LN.result = null;
  const inp = learnInput();
  if (!inp) { renderBass(); if (LN.error) status(LN.error, 'err'); return; }
  if (!inp.bars.length) { LN.error = 'Analiz edilecek nota yok.'; status(LN.error, 'err'); renderBass(); return; }
  LN.error = '';
  try { LN.result = Bs.buildProfile(inp, { name: LN.name || (LN.mode === 'midi' ? (LN.fileName || 'Öğrenilen stil').replace(/\.[^.]+$/, '') : 'El ile stil'), kind: inp.kind, id: 'learned-' + Bs.hash32(String(Date.now()) + Math.random()).toString(36) }); }
  catch (e) { LN.error = e.message; status(e.message, 'err'); }
  if (LN.result) status(`Analiz tamam: ${LN.result.source.bars} ölçü, ${LN.result.templates.length} yeni şablon. Adı kontrol edip kaydet.`);
  renderBass();
}
function learnSave(apply) {
  const p = LN.result; if (!p) return;
  if (LN.name.trim()) p.name = LN.name.trim();
  bsDo((tr, ctx) => {
    tr.profiles = tr.profiles.filter((x) => x.id !== p.id); tr.profiles.push(JSON.parse(JSON.stringify(p)));
    if (apply) { tr.styleProfileId = p.id; tr.styleMix = null; Bs.bassGenerateAll(tr, ctx); }
  }, apply ? `"${p.name}" kaydedildi ve uygulandı; kilitsiz ölçüler bu stille yeniden üretildi.` : `"${p.name}" kaydedildi (Stil listesinden seçilebilir).`);
  lsWrite(lsRead().filter((x) => x.id !== p.id).concat([JSON.parse(JSON.stringify(p))]));
  LN.result = null;
  renderBass();
}
function learnDelete() {
  const t = bTrack(), id = t.styleProfileId, p = t.profiles.find((x) => x.id === id); if (!p) return;
  bsDo((tr, ctx) => { tr.profiles = tr.profiles.filter((x) => x.id !== id); if (tr.styleMix && tr.styleMix.profileB === id) tr.styleMix = null; tr.styleProfileId = Bs.BUILTIN_PROFILES[0].id; Bs.bassGenerateAll(tr, ctx); }, `"${p.name}" silindi; Post-punk drive'a dönüldü.`);
  lsWrite(lsRead().filter((x) => x.id !== id));
}
function learnResultHtml() {
  const P = LN.result; if (!P) return '';
  const cols = Bs.LEARN_BUCKETS, st = P.stats;
  const pct = (o) => Object.entries(o).map(([k, v]) => `${k.replace('approach-', 'yaklaşma-')} ${Math.round(v)}`).join(' · ');
  const row = (label, f) => `<tr><th>${label}</th>${cols.map((k) => `<td>${st[k].bars ? f(st[k], k) : '<span class="hint">—</span>'}</td>`).join('')}</tr>`;
  return `<div class="adv-opt"><div class="gtitle">Analiz: ${esc(P.name)}</div>
    <table class="bs-stat"><tr><th></th>${cols.map((k) => `<th>${energyTR[k]}</th>`).join('')}</tr>
    ${row('ölçü', (s) => s.bars)}${row('nota / ölçü', (s) => s.density.toFixed(1))}
    ${row('vuruş sıklığı (16\'lık)', (s) => `<code>${spark(s.onsetFreq)}</code>`)}
    ${row('sağlam vuruş', (s) => pct(s.roles.strong))}${row('zayıf vuruş', (s) => pct(s.roles.weak))}${row('öncül (ölçü sonu)', (s) => pct(s.roles.pickup))}
    ${row('7 yarım tondan büyük sıçrama', (s) => Math.round(s.leapOver7 * 100) + '%')}${row('legato', (s) => (s.legato == null ? '—' : Math.round(s.legato * 100) + '%'))}</table>
    <div class="hint">Sıçrama sınırı ${P.leapLimit} yarım ton · genel legato ${Math.round(P.legato * 100)}%${cols.some((k) => st[k].ignoredStrong) ? ' · sağlam vuruşta üçlü/beşli/oktav dışı notalar sayılmadı' : ''}</div>
    <div class="hint">${P.templates.length ? 'Yeni şablonlar: ' + P.templates.map((t) => `<code>${esc(t.name)} ${spark(Array.from({ length: P.source.meter === '4/4' ? 16 : 12 }, (_, i) => (t.slots.some((s) => s.step === i) ? 1 : 0)))}</code>`).join(' ') : 'Sık desenler zaten yerleşik şablonlarda var: onların ağırlığı yükseltildi.'}</div>
    <div class="row"><label class="grow">Profil adı<input type="text" data-bs="lName" value="${esc(LN.name || P.name)}"></label></div>
    <div class="row"><button class="accent small" data-bk="learnSave" data-bv="1">Kaydet ve uygula</button><button class="small" data-bk="learnSave" data-bv="0">Yalnızca kaydet</button></div></div>`;
}
function bassLearnHtml() {
  learnEnsureQuick();
  const mode = bchip('lmode', 'midi', 'MIDI içe aktar', LN.mode === 'midi') + bchip('lmode', 'quick', 'Hızlı giriş', LN.mode === 'quick');
  let body;
  if (LN.mode === 'midi') {
    const m = LN.midi, P = LN.parsed;
    const tracks = m ? `<label>Bas izi<select data-bs="lTrack">${m.tracks.map((t, i) => `<option value="${i}"${i === LN.track ? ' selected' : ''}>${i + 1}. ${esc(t.name || 'adsız')} (${t.notes.length} nota)</option>`).join('')}</select></label>
      <div class="gsub"><span>Ölçü</span>${['4/4', '3/4', '6/8', '2/4'].map((x) => bchip('lmeter', x, x, LN.meter === x)).join('')}<span>Aralık</span><input type="number" data-bs="lFrom" min="1" value="${LN.from}" style="width:56px"> – <input type="number" data-bs="lTo" min="1" value="${LN.to}" style="width:56px"></div>` : '';
    let table = '';
    if (P) {
      const buckets = Bs.assignBuckets(P.bars.filter((b) => b.index + 1 >= LN.from && b.index + 1 <= LN.to)), shown = P.bars.filter((b) => b.index + 1 >= LN.from && b.index + 1 <= LN.to);
      table = `<div class="bs-prev"><table class="bs-stat"><tr><th>Ölçü</th><th>Kök</th><th>Vuruşlar</th><th>Enerji</th></tr>${shown.slice(0, 400).map((b, i) => {
        const on = new Array(P.steps).fill('·'); b.notes.forEach((n) => { on[n.step] = 'x'; });
        return `<tr><td>${b.index + 1}</td><td><select data-bs="lRoot" data-i="${P.bars.indexOf(b)}">${PCS.map((x, k) => `<option value="${k}"${b.root === k ? ' selected' : ''}>${x}</option>`).join('')}</select></td><td><code>${on.join('')}</code></td><td>${energyTR[buckets[i]]}</td></tr>`;
      }).join('')}</table></div><div class="hint">Kök = ölçünün 1. vuruşundaki en alçak nota; yanlışsa değiştir. Enerji, ölçü başına nota sayısının üçte birliklerinden (düşük / orta / yüksek) gelir.</div>`;
    }
    body = `<div class="row"><button class="small" data-bk="learnPick">MIDI dosyası seç…</button><span class="hint">${LN.fileName ? esc(LN.fileName) + (m && m.tempo ? ` · ${m.tempo} BPM` : '') : 'bas izi olan .mid'}</span></div>${tracks}${table}`;
  } else {
    const n = quickSteps();
    body = `<div class="hint">Her kutuya o 16'lık adımda çalınan notanın derecesini yaz (akor köküne göre): <code>1</code> kök, <code>5</code> beşli, <code>b3</code>, <code>b7</code>, <code>8</code> oktav, <code>5'</code> bir oktav yukarı, <code>7,</code> bir oktav aşağı. <code>.</code> sus, boş kutu = notayı tut.</div>
      <div class="gsub"><span>Ölçü sayısı</span>${[2, 4, 8].map((v) => bchip('lrows', v, String(v), LN.rows === v)).join('')}</div>
      ${LN.quick.map((r, ri) => `<div class="bs-qrow"><div class="gsub"><span>${ri + 1}. ölçü</span><select data-bs="lEnergy" data-r="${ri}">${Bs.LEARN_BUCKETS.map((k) => `<option value="${k}"${r.energy === k ? ' selected' : ''}>enerji: ${energyTR[k]}</option>`).join('')}</select></div>
        <div class="bs-qgrid" style="grid-template-columns:repeat(${n === 16 ? 8 : 6},1fr)">${r.cells.map((c, ci) => `<input type="text" data-bq="${ri},${ci}" value="${esc(c)}" maxlength="4" title="adım ${ci + 1}${ci % 4 === 0 ? ' (vuruş)' : ''}"${ci % 4 === 0 ? ' class="beat"' : ''}>`).join('')}</div></div>`).join('')}`;
  }
  const t = bTrack(), cur = t.profiles.find((p) => p.id === t.styleProfileId);
  return bgrow('Stil öğren (referans şarkıdan)', `<div class="gsub"><span>Kaynak</span>${mode}</div>${body}
    <div class="row"><button class="accent small" data-bk="learnAnalyze">Analiz et</button>${cur ? `<button class="small" data-bk="learnDelete" title="Seçili öğrenilmiş profili sil">🗑 "${esc(cur.name)}" sil</button>` : ''}</div>
    ${LN.error ? `<div class="st-warn">${esc(LN.error)}</div>` : ''}${learnResultHtml()}`);
}
function bassLearnAction(k, v) {
  switch (k) {
    case 'lmode': LN.mode = v; LN.result = null; LN.error = ''; renderBass(); return true;
    case 'lmeter': LN.meter = v; learnParse(); renderBass(); return true;
    case 'lrows': LN.rows = +v; LN.result = null; renderBass(); return true;
    case 'learnPick': $('#bsMidiFile').click(); return true;
    case 'learnAnalyze': learnAnalyze(); return true;
    case 'learnSave': learnSave(v === '1'); return true;
    case 'learnDelete': learnDelete(); return true;
    case 'samplePick': $('#bsSampleFiles').click(); return true;
    case 'sampleUse': bsDo((tr) => { tr.useSampler = !tr.useSampler; }, tr_useMsg()); return true;
    case 'sampleClear': BS.bank = { samples: [], releases: [], names: [] }; bsDo((tr) => { tr.useSampler = false; }, 'Örnekler temizlendi.'); return true;
    default: return false;
  }
}
const tr_useMsg = () => (bTrack().useSampler ? 'Örnekçi kapalı: sentez kullanılıyor.' : 'Örnekçi açık: ana ses yüklediğin örneklerden çalar.');
function bassLearnChange(el) {
  const k = el.dataset.bs;
  if (k === 'lTrack') { LN.track = +el.value; LN.meter = null; learnParse(); renderBass(); }
  else if (k === 'lRoot') { const b = LN.parsed && LN.parsed.bars[+el.dataset.i]; if (b) { b.root = +el.value; LN.result = null; renderBass(); } }
  else if (k === 'lFrom' || k === 'lTo') { LN[k === 'lFrom' ? 'from' : 'to'] = Math.max(1, Math.round(+el.value) || 1); LN.result = null; renderBass(); }
  else if (k === 'lName') { LN.name = el.value; if (LN.result) LN.result.name = el.value.trim() || LN.result.name; }
  else if (k === 'lEnergy') { learnEnsureQuick(); LN.quick[+el.dataset.r].energy = el.value; LN.result = null; }
}
$('#bassPanel').addEventListener('input', (e) => {
  const q = e.target.dataset && e.target.dataset.bq; if (!q) return;
  const [r, c] = q.split(',').map(Number); learnEnsureQuick(); if (LN.quick[r]) { LN.quick[r].cells[c] = e.target.value; LN.result = null; }
});
{
  const f = document.createElement('input'); f.type = 'file'; f.id = 'bsMidiFile'; f.accept = '.mid,.midi,audio/midi'; f.hidden = true; document.body.appendChild(f);
  f.addEventListener('change', async () => { const file = f.files[0]; f.value = ''; if (file) await learnLoadFile(file); });
}

// ---------------------------------------------------------------- ÖRNEKÇİ (kullanıcının kendi örnekleri; bellekte, projeyle kaydedilmez)
// dosya adından perde: "E1.wav", "bass_A#2_rr1.wav"; adında "rel" geçen = bırakma örneği; aynı perdeden birden çok dosya = dönüşümlü (round-robin)
BS.bank = { samples: [], releases: [], names: [] };
userBassSamplerActive = () => !!bTrack()?.useSampler && !!BS.bank.samples.length;
function parseSampleName(name) {
  const base = name.replace(/\.[^.]+$/, ''), rel = /rel/i.test(base);
  const m = /(?:^|[^A-Za-z])([A-Ga-g])([#b]?)(-?\d)(?!\d)/.exec(base);
  if (!m) return rel ? { midi: 40, release: true } : null;
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { midi: (+m[3] + 1) * 12 + pc, release: rel };
}
async function bankLoad(files) {
  try { await Player.ensure(); } catch (e) { status(e.message, 'err'); return; }
  const rc = Tone.getContext().rawContext, bad = [];
  for (const f of files) {
    const info = parseSampleName(f.name);
    if (!info) { bad.push(f.name); continue; }
    try {
      const buffer = await rc.decodeAudioData(await f.arrayBuffer());
      (info.release ? BS.bank.releases : BS.bank.samples).push({ midi: info.midi, buffer, name: f.name });
      BS.bank.names.push(f.name);
    } catch (e) { bad.push(f.name); }
  }
  status(`${BS.bank.samples.length} örnek, ${BS.bank.releases.length} bırakma örneği yüklendi${bad.length ? ` · okunamadı / perde adı yok: ${bad.join(', ')}` : ''}.`, bad.length ? 'err' : undefined);
  if (BS.bank.samples.length && !bTrack().useSampler) bsDo((tr) => { tr.useSampler = true; });
  renderBass(); if (Player.playing) { clearTimeout(BS.timer); BS.timer = setTimeout(() => Player.play(), 250); }
}
function samplerHtml() {
  const t = bTrack(), n = BS.bank.samples.length, r = BS.bank.releases.length;
  const notes = [...new Set(BS.bank.samples.map((s) => s.midi))].sort((a, b) => a - b).map((m) => C.noteName(m)).join(' ');
  return `<div class="gsub"><span>Örnekçi</span><button class="small" data-bk="samplePick" type="button">Örnek dosyaları yükle…</button>${bchip('sampleUse', 'u', t.useSampler ? 'Açık' : 'Kapalı', !!t.useSampler, n ? '' : ' disabled')}${n ? bchip('sampleClear', 'c', 'Temizle', false) : ''}</div>
    <div class="hint">${n ? `${n} örnek (${notes}), ${r} bırakma. Aralarda perde kaydırılır; aynı perdeden iki dosya dönüşümlü çalar. Örnekler projeyle kaydedilmez — projeyi açınca yeniden yükle.` : 'Adında perde olan dosyalar (E1.wav, A#2_rr1.wav); "release" geçen dosya bırakma örneği olur.'}${t.useSampler && !n ? ' · örnek yok: sentez çalar' : ''}</div>`;
}
{
  const f = document.createElement('input'); f.type = 'file'; f.id = 'bsSampleFiles'; f.accept = 'audio/*,.wav,.mp3,.ogg,.flac'; f.multiple = true; f.hidden = true; document.body.appendChild(f);
  f.addEventListener('change', async () => { const files = [...f.files]; f.value = ''; if (files.length) await bankLoad(files); });
}

// sınamalar için
window.__dawAPI.bass = { makeVoices: makeBassVoices, hit: bassHit, renderOffline: renderBassOffline, BS, loadDemo: loadDemoSong, ctx: bCtx, tap: { start: tapStart, finish: tapFinish, down: tapDown, up: tapUp, auto: tapAuto, calibDone: tapCalibDone, audioTimeOf }, learn: LN, bank: () => BS.bank, parseSampleName };

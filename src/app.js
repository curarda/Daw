/* =====================================================================
   MINI DAW ARAYÜZÜ — zaman çizelgesi, kayıt, Tone.js oynatma, dışa aktarım
   ===================================================================== */
(function () {
'use strict';
const C = window.Core;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dbToGain = (db) => Math.pow(10, db / 20);
const uid = () => 's' + Math.random().toString(36).slice(2, 8);

const S = {
  proj: C.newProject(),
  audio: null,            // { data: Float32Array (mono, orijinal — asla değişmez), sr, name }
  onset: null,
  track: null, rawNotes: null,
  d: null,
  corrected: null, correctedShift: null,
  sel: null,              // {type:'note', id} | {type:'chord', q} | {type:'section', id}
  editMode: 'sound', // sürükleyince: 'sound' = notayı taşı (varsayılan), 'label' = yalnızca etiket, 'select' = yalnızca seç
  view: { pxPerQ: 44 },
  pos: 0,                 // oynatma imleci (zaman çizelgesi saniyesi)
  drag: null,
  loop: { on: false, from: 0, to: 0 }, // döngüde çalma: [from, to) saniye (zaman çizelgesi)
};
window.__daw = S; // hata ayıklama / testler için
window.__dawCal = () => Cal.last;
// stil modülünün (styleui.js) kullandığı arayüz
window.__dawAPI = {
  S, C, status, esc, getCtx, notePreview: () => NotePreview, player: () => Player,
  refresh: () => refresh(),
  preview: (chords, tonic, mode, durs) => Player.previewChords(chords, tonic, mode, durs),
  // doğrulama öğesi için mevcut analiz: kastedilen notalar + tonu belli bölümler
  snapshot() {
    if (!S.d || !S.rawNotes) return null;
    return {
      meter: S.proj.settings.meter,
      sections: S.d.sections.filter((s) => !s.implicit && s.tonic != null).map((s) => ({ id: s.id, name: s.name, type: s.type || null, startBar: s.startBar, endBar: s.endBar, tonic: s.tonic, mode: s.mode, confirmed: !!s.confirmed })),
      notes: S.d.notes.map((n) => ({ q0: n.q0, q1: n.q1, effMidi: n.effMidi })),
    };
  },
  stop: () => Player.stop(),
  arrangement: () => ({ drums: drumEventsAll(), bass: bassEventsAll(), piano: pianoEventsAll() }), // bölüm düzenlemeli olaylar (testler)
  hist: () => HIST,
  // progresyonu zaman çizelgesine akor şablonu (kilitli akorlar) olarak yerleştir
  // progresyonu zaman çizelgesine akor şablonu (kilitli akorlar) olarak yerleştir; durs: ölçü cinsinden süreler
  placeChords(chords, startBar, key, durs) {
    const g = C.makeGrid(S.proj.settings);
    let d = durs ? durs.slice() : chords.map(() => 1);
    let note = '';
    if (!g.split && d.some((x) => x % 1)) { d = d.map((x) => Math.max(1, Math.round(x))); note += ' Bu ölçüde yarım ölçü kilidi yok: süreler tam ölçüye yuvarlandı.'; }
    // yarım ölçü hücreleri
    const cells = [];
    d.forEach((x, i) => { for (let k = 0; k < Math.round(x * 2); k++) cells.push(chords[i]); });
    if (cells.length % 2) cells.push(cells[cells.length - 1]);
    const nBars = cells.length / 2, end = startBar + nBars - 1;
    const covering = S.proj.sections.filter((s) => !(end < s.startBar || startBar > s.endBar));
    if (!covering.length) {
      S.proj.sections.push({ id: uid(), name: 'Öneri', startBar, endBar: end, tonic: key.tonic, mode: key.mode });
      S.proj.sections.sort((a, b) => a.startBar - b.startBar);
      note = ` "Öneri" bölümü (${C.keyName(key.tonic, key.mode)}) oluşturuldu.` + note;
    } else if (covering.some((s) => s.startBar > startBar || s.endBar < end)) {
      status(`Ölçü ${startBar}–${end} birden fazla bölüme ya da bölüm dışına taşıyor; tek bir bölümün içine yerleştirin.`, 'err');
      return false;
    }
    pinOthers((b) => b >= startBar && b <= end);
    for (let i = 0; i < nBars; i++) {
      const bar = startBar + i, h0 = cells[2 * i], h1 = cells[2 * i + 1];
      S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar !== bar);
      const lk = (ch, half) => S.proj.chordLocks.push({ bar, half, chord: { root: ch.root, q: ch.q, bass: null } });
      if (C.sameChord(h0, h1) || !g.split) lk(h0, null); else { lk(h0, 0); lk(h1, 1); }
    }
    refresh();
    status(`${chords.length} akor ölçü ${startBar}–${end} arasına kilitli şablon olarak yerleştirildi (${d.join(' + ')} ölçü).${note}`);
    return true;
  },
};

// ---------------------------------------------------------------- durum satırı
function status(msg, kind) { const s = $('#status'); s.textContent = msg; s.className = kind || ''; s.title = msg; }
async function busy(msg, fn) {
  status(msg, 'busy');
  try { return await fn(); } catch (e) { console.error(e); status('Hata: ' + e.message, 'err'); throw e; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- ses bağlamı
let actx = null;
function getCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return actx;
}
// ---------------------------------------------------------------- nota önizleme
// Tıklanan / sürüklenen notayı duyurur: kaydın o notaya ait parçası, istenen perdeye TD-PSOLA ile
// kaydırılarak (hız değişmeden) çalınır — piyano değil, kendi sesin. Etiket sürüklemede ses aynıdır;
// karşılaştırma için etiket perdesinde kısık bir piyano notası eklenir.
const NotePreview = {
  src: null, gain: null, lastAt: 0, count: 0,
  play(n, cents = 0, refMidi = null) {
    if (!S.audio || !S.track || !n) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const sr = S.audio.sr, hop = S.track.hopSec, nF = S.track.f0.length;
    const fa = Math.max(0, Math.floor(n.t0 / hop) - 1), fb = Math.min(nF, Math.ceil(Math.min(n.t1, n.t0 + 1.2) / hop) + 1);
    const a = Math.round(fa * hop * sr), b = Math.min(S.audio.data.length, Math.round(fb * hop * sr));
    if (b - a < 64) return;
    const x = S.audio.data.slice(a, b);
    let y = x;
    if (Math.abs(cents) >= 1) y = C.psolaShift(x, sr, { hopSec: hop, f0: S.track.f0.slice(fa, fb) }, new Float32Array(fb - fa).fill(cents));
    const fl = Math.min(Math.round(0.012 * sr), y.length >> 2);
    for (let i = 0; i < fl; i++) { const g = i / fl; y[i] *= g; y[y.length - 1 - i] *= g; }
    this.stop();
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = toAudioBuffer(y, sr); g.gain.value = 0.9;
    src.connect(g).connect(ctx.destination);
    src.start();
    this.src = src; this.gain = g; this.lastAt = performance.now(); this.count++;
    if (refMidi != null) Player.ensure().then(() => Player.sampler.triggerAttackRelease(Tone.Frequency(refMidi, 'midi').toNote(), Math.min(1.2, n.t1 - n.t0), Tone.now() + 0.02, 0.3)).catch(() => {});
  },
  stop() { if (this.src) { try { this.src.stop(); } catch (e) { /* zaten bitti */ } this.src = null; } },
  // notanın şu anki sesi (autotune / elle düzeltme dahil) için kaydırma
  current(n) { return n.corr ? n.corr.applied || 0 : 0; },
};
function toAudioBuffer(data, sr) {
  const b = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(data, 0);
  return b;
}

// ---------------------------------------------------------------- pipeline
function setAudio(data, sr, name, source) {
  HIST.reset = true; // yeni ses: geri alma geçmişi sıfırlanır (ses verisi geri alınamaz)
  S.audio = { data, sr, name };
  S.proj.audio.source = source;
  S.onset = null; S.track = null; S.rawNotes = null;
  S.corrected = null; S.correctedShift = null;
  S.pos = 0;
  Player.buffersDirty = true;
}
async function analyze() {
  if (!S.audio) { refresh(); return; }
  await busy('Perde analizi…', async () => {
    const p = S.proj.pitch;
    S.track = await C.detectPitch(S.audio.data, S.audio.sr, p, (x) => status(`Perde analizi… %${Math.round(x * 100)}`, 'busy'));
    S.rawNotes = C.applyNoteSplits(C.segmentNotes(S.track, p), S.track, S.proj.noteSplits);
  });
  S.correctedShift = null;
  refresh();
  status(`Analiz tamam: ${S.rawNotes.length} nota.`);
}
function refresh() {
  // eski projelerde olmayan alanlar
  S.proj.drums = S.proj.drums || { on: false, loop: 'auto' };
  S.proj.quant = S.proj.quant || { grid: '1/8', strength: 100 };
  S.proj.taps = S.proj.taps || [];
  S.proj.drums.startBar = S.proj.drums.startBar || 1;
  S.proj.chordStartBar = S.proj.chordStartBar || 1;
  S.proj.noteSplits = S.proj.noteSplits || [];
  S.proj.audio.leadBars = S.proj.audio.leadBars || 0;
  S.proj.piano = Object.assign({}, C.PIANO_DEFAULTS, S.proj.piano || {});
  S.proj.bass = Object.assign({ on: false, pattern: 'auto' }, S.proj.bass || {});
  S.proj.swing = Object.assign({ ratio: 0.5 }, S.proj.swing || {});
  S.proj.mixer.bass = S.proj.mixer.bass || { vol: -5, mute: false, solo: false };
  S.proj.drums.fills = S.proj.drums.fills !== false;
  S.proj.mixer.drums = S.proj.mixer.drums || { vol: -8, mute: false, solo: false };
  if (S.proj.chordPins && S.proj.chordPins.length && S.proj.chordPinsSig !== pinSig()) S.proj.chordPins = []; // başka bir şey değişti: yeniden hesapla
  // stil modeli (varsa): akor bulucuya λ·log P(geçiş) + renk puanı olarak girer
  const style = window.StyleUI ? window.StyleUI.scorer() : null;
  S.d = C.derive(S.proj, { track: S.track, rawNotes: S.rawNotes, duration: S.audio ? S.audio.data.length / S.audio.sr : 0, style, engineOverride: S.drag ? 'greedy' : null });
  S.d.styleActive = !!style;
  { const ns = S.d.notes; S.vocalRate = ns.length >= 4 ? ns.length / Math.max(1, ns[ns.length - 1].tl1 - ns[0].tl0) : null; } // vokal yoğunluğu (nota / s): bas puanlamasında
  const nl = S.proj.chordLocks.length;
  $('#lockCount').textContent = nl ? `(${nl})` : ''; $('#btnUnlockAll').disabled = !nl;
  const nmk = (S.proj.changeMarks || []).length;
  $('#markCount').textContent = nmk ? `(${nmk})` : ''; $('#btnClearMarks').disabled = !nmk;
  const conf = S.d.chords.markConflict ? S.d.sections.filter((x) => S.d.chords.markConflict[x.id]).map((x) => x.name) : [];
  $('#markInfo').innerHTML = (nmk && S.proj.chordOpts.engine === 'greedy' ? '<div class="st-warn">⚠ Değişim işaretleri süreli Viterbi motorunda uygulanır; ölçü ölçü motor bunları yok sayar.</div>' : '')
    + (conf.length ? `<div class="st-warn">⚠ ${esc(conf.join(', '))}: işaretler kilitli akorlarla çelişiyor (ör. ✂ noktasının iki yanında aynı akor kilitli); bu bölüm işaretler olmadan dolduruldu.</div>` : '');
  const nch = S.proj.chordLocks.filter((l) => l.src === 'chart').length;
  $('#chartCount').textContent = nch ? `(${nch})` : ''; $('#btnChartRemove').disabled = !nch;
  const ns = S.d.chords.filter((c) => c.pinSuggest).length;
  $('#sugCount').textContent = ns ? `(${ns})` : ''; $('#btnApplySug').disabled = !ns;
  if (S.sel && S.sel.type === 'note' && !S.d.notes.some((n) => n.id === S.sel.id)) S.sel = null;
  if (S.sel && S.sel.type === 'notes') { // toplu seçim: kalmayan notalar düşer; 1 kalırsa tek seçim
    const ids = S.sel.ids.filter((id) => S.d.notes.some((n) => n.id === id));
    S.sel = ids.length > 1 ? { type: 'notes', ids } : ids.length ? { type: 'note', id: ids[0] } : null;
  }
  renderSections();
  renderInspector();
  renderInfo();
  renderDrums();
  renderBass();
  renderTaps();
  renderStarts();
  layoutTimeline();
  draw();
  scheduleRender();
  renderChips();
  histCommit();
}

// ---------------------------------------------------------------- sol panel: bölümler tıklayınca açılır, durum rozeti, açık/kapalı durumu hatırlanır
const PANEL_LS = 'miniDaw.panels';
function savePanels() {
  const o = {};
  $$('details[data-key]').forEach((d) => { o[d.dataset.key] = d.open; });
  try { localStorage.setItem(PANEL_LS, JSON.stringify(o)); } catch (e) { /* depolama kapalı olabilir */ }
}
(function initPanels() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PANEL_LS) || 'null') || {}; } catch (e) { saved = {}; }
  $$('details[data-key]').forEach((d) => { if (d.dataset.key in saved) d.open = !!saved[d.dataset.key]; d.addEventListener('toggle', savePanels); });
  $('#btnOpenAll').onclick = () => $$('details.step').forEach((d) => { d.open = true; });
  $('#btnCloseAll').onclick = () => $$('details.step').forEach((d) => { d.open = d.dataset.key === 's1' || d.dataset.key === 's2'; });
})();
function renderChips() {
  const set = (id, txt) => { const el = $(id); if (el && el.textContent !== txt) el.textContent = txt; };
  const p = S.proj, d = S.d;
  set('#chipS1', `${p.settings.meter} · ${p.settings.bpm} BPM${swingMode() === 'triplet' ? ' · üçleme' : swingMode() === 'swing' ? ' · swing %' + Math.round(swingR() * 100) : ''}`);
  set('#chipS2', S.audio ? `${(S.audio.data.length / S.audio.sr).toFixed(0)} s${p.audio.leadBars ? ` · ${p.audio.leadBars > 0 ? '+' : ''}${p.audio.leadBars} ölçü` : ''}` : 'ses yok');
  set('#chipS3', S.rawNotes ? `${S.rawNotes.length} nota` : '');
  set('#chipS4', d && p.sections.length ? `${p.sections.length} bölüm` : 'bölüm yok');
  const nEd = p.noteEdits.length + (p.noteSplits || []).length;
  set('#chipS5', `${p.autotune.enabled ? 'autotune açık' : 'autotune kapalı'}${nEd ? ` · ${nEd} düzeltme` : ''}`);
  set('#chipS67', d ? `${d.chords.length} akor${p.chordLocks.length ? ` · ✋ ${p.chordLocks.length} kilit` : ''}${p.chordStartBar > 1 ? ` · ölçü ${p.chordStartBar}'den` : ''}` : '');
  set('#chipS8', `${C.PIANO_STYLES[p.piano.style].name}${p.piano.repeat === 'off' ? '' : p.piano.repeat === 'fade' ? ' · söner' : ' · sürer'}`);
  const L = d ? currentLoop() : null;
  set('#chipS8b', anyDrums() ? `${p.drums.loop !== 'auto' ? '✋ ' : ''}${L ? L.name : 'açık'}${p.drums.startBar > 1 ? ` · ölçü ${p.drums.startBar}'den` : ''}` : 'kapalı');
  set('#chipS8c', anyBass() ? (p.bass.pattern !== 'auto' && C.BASS_PATTERNS[p.bass.pattern] ? '✋ ' + C.BASS_PATTERNS[p.bass.pattern].name : d ? 'otomatik: ' + C.BASS_PATTERNS[suggestBassFor(L).id].name : 'açık') : 'kapalı');
}
// ---------------------------------------------------------------- GENEL GERİ ALMA / YİNELEME (Ctrl+Z, Ctrl+Shift+Z)
// Proje durumunun anlık görüntüleri: her değişiklikten (refresh) sonra önceki durum geri alma yığınına girer.
// Sürükleme tek adımdır (bırakınca); 0,5 sn içindeki art arda değişiklikler (kaydırıcılar) tek adımda birleşir.
// Mikser seviyeleri ve A/B geri almaya dahil değil. Ses verisi (kayıt / yükleme) geri alınamaz: yeni ses geçmişi sıfırlar.
const HIST = { undo: [], redo: [], base: null, t: 0, hold: 0, reset: true };
function snapProj() {
  const p = JSON.parse(JSON.stringify(S.proj));
  for (const k of ['vocal', 'piano', 'drums', 'bass']) delete p.mixer[k];
  delete p.mixer.ab;
  return JSON.stringify(p);
}
function histButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (!u) return;
  u.disabled = !HIST.undo.length; r.disabled = !HIST.redo.length;
  u.title = HIST.undo.length ? `Geri al (Ctrl+Z) — ${HIST.undo.length} adım` : 'Geri alınacak bir şey yok';
  r.title = HIST.redo.length ? `Yinele (Ctrl+Shift+Z) — ${HIST.redo.length} adım` : 'Yinelenecek bir şey yok';
}
function histCommit() {
  if (HIST.hold || S.drag) return;
  const cur = snapProj();
  if (HIST.reset || HIST.base == null) { HIST.undo = []; HIST.redo = []; HIST.base = cur; HIST.reset = false; histButtons(); return; }
  if (cur === HIST.base) return;
  const now = performance.now();
  if (now - HIST.t > 500 || !HIST.undo.length) { HIST.undo.push(HIST.base); if (HIST.undo.length > 100) HIST.undo.shift(); }
  HIST.t = now; HIST.base = cur; HIST.redo = [];
  histButtons();
}
const detSig = (p) => JSON.stringify([p.fmin, p.fmax, p.silenceDb, p.hopMs, p.analysisSr]);
const segSig = (p, sp) => JSON.stringify([p.minNoteMs, p.changeSemis, sp]);
async function histRestore(str, was) {
  Player.stop(true);
  const keep = { ab: S.proj.mixer.ab }; for (const k of ['vocal', 'piano', 'drums', 'bass']) keep[k] = S.proj.mixer[k];
  const old = { det: detSig(S.proj.pitch), seg: segSig(S.proj.pitch, S.proj.noteSplits) };
  HIST.hold++;
  try {
    S.proj = mergeDefaults(C.newProject(), JSON.parse(str));
    Object.assign(S.proj.mixer, keep);
    S.sel = null;
    syncInputs();
    if (S.track) {
      if (detSig(S.proj.pitch) !== old.det) await analyze();
      else if (segSig(S.proj.pitch, S.proj.noteSplits) !== old.seg) resegment();
    }
    refresh(); scheduleRender(true);
  } finally { HIST.hold--; }
  HIST.base = snapProj(); HIST.t = 0;
  histButtons();
  if (was) Player.play();
}
async function histUndo() {
  if (!HIST.undo.length) { status('Geri alınacak bir şey yok.'); return; }
  const was = Player.playing;
  HIST.redo.push(snapProj());
  await histRestore(HIST.undo.pop(), was);
  status(`Geri alındı (${HIST.undo.length} adım daha geri alınabilir, ${HIST.redo.length} yinelenebilir).`);
}
async function histRedo() {
  if (!HIST.redo.length) { status('Yinelenecek bir şey yok.'); return; }
  const was = Player.playing;
  HIST.undo.push(snapProj());
  await histRestore(HIST.redo.pop(), was);
  status(`Yinelendi (${HIST.redo.length} adım daha yinelenebilir).`);
}

// ---------------------------------------------------------------- DÜZENLEME: genel ayar + bölüm başına üstüne yazma
// proj.sections[i].arr = { drums: null | 'off' | loopId, bass: null | 'off' | kalıpId, piano: null | akor sesi }  (null = genel ayar)
// ▶ önizleme: bir loop / bas kalıbı seçmeden 2 ölçü dinlenir (çalma bitince ya da durdurulunca temizlenir)
const PREVIEW = { bass: null, drums: null };
// alt bölme / swing oranı (0,5 düz · 0,667 üçleme · arası swing): davul, bas, akor desenleri, quantize ızgarası ve cetvel buna uyar
const swingR = () => (S.proj.swing && S.proj.swing.ratio) || 0.5;
const swingMode = (r = swingR()) => (Math.abs(r - 0.5) < 0.005 ? 'straight' : Math.abs(r - 2 / 3) < 0.006 ? 'triplet' : 'swing');
const bassCtx = (loop) => ({ loop, meter: S.proj.settings.meter, bpm: S.proj.settings.bpm, vocalRate: S.vocalRate ?? null, swing: swingR() });
const suggestBassFor = (loop) => { const c = bassCtx(loop); return C.suggestBass(c.loop, c.meter, c.bpm, c.vocalRate, c.swing); };
const secArr = (secId) => { const s = S.proj.sections.find((x) => x.id === secId); return (s && s.arr) || {}; };
const sectionOfBar = (bar) => (S.d ? S.d.sections.find((s) => !s.implicit && bar >= s.startBar && bar <= s.endBar) || null : null);
const loopById = (id) => C.DRUM_LOOPS.find((l) => l.id === id && l.meter === S.proj.settings.meter) || null;
function drumLoopForBar(bar) {
  if (PREVIEW.drums) return loopById(PREVIEW.drums);
  const sec = sectionOfBar(bar), a = sec ? secArr(sec.id).drums : null;
  if (a === 'off') return null;
  const own = a ? loopById(a) : null;
  return own || (S.proj.drums.on ? currentLoop() : null);
}
const anySectionArr = (k) => S.proj.sections.some((s) => s.arr && s.arr[k] && s.arr[k] !== 'off');
const anyDrums = () => !!PREVIEW.drums || S.proj.drums.on || anySectionArr('drums');
const anyBass = () => !!PREVIEW.bass || S.proj.bass.on || anySectionArr('bass');
function fillAt(b) {
  if (!S.proj.drums.fills || PREVIEW.drums || !S.d || b >= S.d.bars) return false;
  const a = sectionOfBar(b), n = sectionOfBar(b + 1);
  return !!a && !!n && a.id !== n.id && !!drumLoopForBar(b) && !!drumLoopForBar(b + 1);
}
const drumEventsAll = () => (S.d && anyDrums() ? C.arrangeDrums(S.d.g, S.d.bars, S.proj.drums.startBar || 1, drumLoopForBar, fillAt, swingR()) : []);
function bassPatternFor(slot) {
  if (PREVIEW.bass) return PREVIEW.bass;
  const a = secArr(slot.section).bass;
  if (a === 'off' || (!a && !S.proj.bass.on)) return null;
  const id = a || S.proj.bass.pattern;
  if (id && id !== 'auto' && C.bassPool(S.proj.settings.meter).includes(id)) return id;
  return suggestBassFor(drumLoopForBar(slot.bar) || currentLoop()).id;
}
const bassEventsAll = () => (S.d && anyBass() ? C.bassEvents(S.d.chords, S.d.g, { patternFor: bassPatternFor, loopFor: (bar) => drumLoopForBar(bar) || currentLoop(), swing: swingR() }) : []);
const pianoOptsFor = (secId) => { const a = secArr(secId).piano; return C.pianoOpts(a ? Object.assign({}, S.proj.piano, { style: a }) : S.proj.piano, swingR()); };
const pianoEventsAll = () => (anySectionArr('piano') ? C.arrangePiano(S.d.chords, S.d.g, pianoOptsFor) : C.pianoEvents(S.d.chords, S.d.g, C.pianoOpts(S.proj.piano, swingR())));

// ---------------------------------------------------------------- düzeltilmiş vokal render (TD-PSOLA)
let renderTimer = null;
const hasShift = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== 0) return true; return false; };
function shiftsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function scheduleRender(now) {
  const corr = S.d && S.d.correction;
  if (!corr || !S.audio) return;
  if (renderReady()) return;
  clearTimeout(renderTimer);
  $('#renderInfo').textContent = 'Düzeltilmiş vokal yeniden render edilecek…';
  renderTimer = setTimeout(doRender, now ? 0 : 350);
}
async function doRender() {
  if (S.drag) { renderTimer = setTimeout(doRender, 150); return; }
  const shift = S.d.correction.shift.slice(), map = S.d.timeMap;
  await busy(map && !map.identity ? 'Düzeltilmiş vokal render ediliyor (perde: TD-PSOLA · zamanlama: WSOLA)…' : 'Düzeltilmiş vokal render ediliyor (TD-PSOLA, formant korumalı)…', async () => {
    await tick();
    const pitched = hasShift(shift) ? C.psolaShift(S.audio.data, S.audio.sr, S.track, shift) : S.audio.data;
    S.corrected = map && !map.identity ? C.wsolaWarp(pitched, S.audio.sr, map) : pitched;
    S.correctedShift = shift; S.correctedWarp = map ? map.sig : '';
  });
  Player.buffersDirty = true;
  renderInfo();
  status('Düzeltilmiş vokal hazır (ayrı iz). A/B ile karşılaştırın.');
}
const renderReady = () => !!S.d && !!S.d.correction && shiftsEqual(S.d.correction.shift, S.correctedShift) && (S.d.timeMap ? S.d.timeMap.sig : '') === (S.correctedWarp || '');

// ---------------------------------------------------------------- piyano örnekleri (Salamander → yedek sentez)
// Aynı Salamander örnekleri için sırayla denenen kaynaklar (biri engelliyse diğeri): GitHub Pages, jsDelivr'in GitHub aynası
const SAL_SOURCES = ['https://tonejs.github.io/audio/salamander/', 'https://cdn.jsdelivr.net/gh/Tonejs/audio@master/salamander/'];
const SAL_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
const noteToMidi = (n) => { const p = C.parsePc(n); return p.pc + 12 * (parseInt(n.slice(p.len), 10) + 1); };
let pianoPromise = null;
function setPianoBadge(text, kind, title) {
  const b = $('#pianoBadge');
  b.textContent = text; b.className = 'tag ' + (kind || ''); b.title = title || text;
}
function loadPianoSamples() {
  if (pianoPromise) return pianoPromise;
  pianoPromise = (async () => {
    const ctx = getCtx();
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);
    const fails = [];
    for (const base of SAL_SOURCES) {
      const host = new URL(base).host;
      try {
        setPianoBadge('Piyano: yükleniyor…', '', `Salamander örnekleri indiriliyor (${host})`);
        const bufs = await Promise.all(SAL_NOTES.map(async (n) => {
          const r = await withTimeout(fetch(base + n.replace('#', 's') + '.mp3'), 10000);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const ab = await ctx.decodeAudioData(await r.arrayBuffer());
          return { name: n, midi: noteToMidi(n), buffer: ab, data: ab.getChannelData(0), sr: ab.sampleRate };
        }));
        $('#pianoInfo').textContent = `Piyano: Salamander Grand (gerçek örnekler, ${host}) yüklendi.`;
        setPianoBadge('Piyano: Salamander', 'ok', `Salamander Grand Piano örnekleri çalıyor (${host})`);
        return { kind: 'salamander', samples: bufs };
      } catch (e) { fails.push(`${host}: ${e.message}`); }
    }
    {
      const e = new Error(fails.join(' · '));
      console.info('Salamander piyano örnekleri indirilemedi, yedek sentetik piyano çalıyor (akor/analiz etkilenmez). Denenen kaynaklar:', fails.join(' · '));
      const sr = 44100;
      const samples = SAL_NOTES.filter((n) => { const m = noteToMidi(n); return m >= 24 && m <= 96; }).map((n) => {
        const m = noteToMidi(n), data = C.synthPianoSample(m, sr, 2.5);
        return { name: n, midi: m, data, sr, buffer: toAudioBuffer(data, sr) };
      });
      $('#pianoInfo').innerHTML = `Salamander örneklerine ulaşılamadı — yedek sentetik piyano çalıyor. Akorlar ve analiz etkilenmez, yalnızca piyano sesi. Olası nedenler: internet yok, reklam/içerik engelleyici, ya da dosyayı açtığın uygulama dış bağlantıları engelliyor (tarayıcıda doğrudan açmayı dene). <button id="btnPianoRetry" class="small">Tekrar dene</button> <span class="hint">(${esc(e.message)})</span>`;
      setPianoBadge('Piyano: yedek sentez', 'warn', 'Salamander indirilemedi (' + e.message + '); sentetik yedek piyano çalıyor');
      return { kind: 'synth', samples };
    }
  })();
  return pianoPromise;
}

// "Tekrar dene": örnekleri yeniden indir; oynatıcı hazırsa piyanoyu yerinde değiştir
$('#pianoInfo').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnPianoRetry')) return;
  pianoPromise = null;
  const piano = await loadPianoSamples();
  if (Player.ready && piano.kind === 'salamander') {
    const urls = {};
    for (const x of piano.samples) urls[x.name] = new Tone.ToneAudioBuffer(x.buffer);
    const old = Player.sampler;
    Player.sampler = new Tone.Sampler({ urls, release: 1.2 }).connect(Player.pianoCh);
    await Tone.loaded();
    old.dispose();
  }
  status(piano.kind === 'salamander' ? 'Salamander piyano yüklendi.' : 'Salamander yine indirilemedi; yedek piyano çalıyor.', piano.kind === 'salamander' ? '' : 'err');
});
// ---------------------------------------------------------------- ZAMANLAMA: quantize + yatay sürükleme
// ---------------------------------------------------------------- nota seçimi: tek ({type:'note'}) ya da toplu ({type:'notes', ids})
const selNoteIds = () => (!S.sel ? [] : S.sel.type === 'note' ? [S.sel.id] : S.sel.type === 'notes' ? S.sel.ids : []);
const selNotes = () => { const ids = selNoteIds(); return S.d ? S.d.notes.filter((n) => ids.includes(n.id)) : []; };
function selectNotes(ids) {
  const u = [...new Set(ids)];
  select(!u.length ? null : u.length === 1 ? { type: 'note', id: u[0] } : { type: 'notes', ids: u });
}
const quantGridQ = () => C.QUANT_GRIDS[S.proj.quant.grid] || 0.5;
// ızgara swing'i: düz ızgaralar (1/8, 1/16) her zaman projenin oranına uyar; üçleme ızgaraları (…T) yalnızca swing ilan edilmişse (düz projede gerçek üçleme kalır)
const gridAnchor = () => (/T$/.test(S.proj.quant.grid) ? 2 / 3 : 0.5);
const gridSwing = () => { const r = swingR(); return gridAnchor() > 0.6 && r < 0.55 ? 0 : r; };
const snapGrid = (q, dir = 0) => { const gq = quantGridQ(), g = grid(), r = gridSwing(), an = gridAnchor(); return C.swingMap((Math.round(C.swingUnmap(q, g, r, an) / gq) + dir) * gq, g, r, an); };
const quantGridLabel = () => S.proj.quant.grid;
function quantScope() {
  const sc = $('#inQuantScope').value;
  if (sc === 'section') { const sec = S.sel && S.sel.type === 'section' ? S.sel.id : selNotes().length ? selNotes()[0].section : null; return sec ? { f: (n) => n.section === sec, name: (S.d.sections.find((x) => x.id === sec) || {}).name } : null; }
  if (sc === 'note') { const ids = selNoteIds(); return ids.length ? { f: (n) => ids.includes(n.id), name: ids.length > 1 ? `${ids.length} seçili nota` : 'seçili nota' } : null; }
  return { f: () => true, name: 'tüm şarkı' };
}
function applyQuantize(scope, strength = S.proj.quant.strength / 100) {
  if (!S.d || !S.d.notes.length) { status('Önce kayıt / analiz.', 'err'); return; }
  if (!scope) { status('Önce bir bölüm ya da nota seç (kapsam).', 'err'); return; }
  const r = C.quantizeTargets(S.d.notes, S.d.g, { gridQ: quantGridQ(), strength, filter: scope.f, swing: gridSwing(), anchor: gridAnchor() });
  let n = 0;
  for (const x of r.targets) { const ed = editFor(x.note, true); ed.q0to = x.q0to; if (x.q0to != null) n++; }
  cleanupEdits(); refresh(); scheduleRender(true);
  status(`Quantize (${quantGridLabel()}, %${Math.round(strength * 100)}, ${scope.name}): ${n} nota kaydırıldı${r.skipped ? `, ${r.skipped} nota aynı ızgara noktasına düşeceği için yerinde kaldı` : ''}.`);
}
function clearTiming(scope) {
  if (!scope) return;
  let n = 0;
  for (const nt of S.d.notes) if (scope.f(nt) && nt.edit && nt.edit.q0to != null) { nt.edit.q0to = null; n++; }
  cleanupEdits(); refresh(); scheduleRender(true);
  status(`Zamanlama sıfırlandı (${scope.name}): ${n} nota kaydettiğin yere döndü.`);
}
$('#inQuantGrid').addEventListener('change', (e) => { S.proj.quant.grid = e.target.value; });
$('#inQuantStrength').addEventListener('input', (e) => { S.proj.quant.strength = +e.target.value; $('#outQuantStrength').textContent = '%' + e.target.value; });
$('#btnQuantize').onclick = () => applyQuantize(quantScope());
$('#btnQuantClear').onclick = () => clearTiming(quantScope());
// ---------------------------------------------------------------- TAP: oynatırken akor değişim noktalarını işaretle → tempo, ölçü, ızgara
function tapAt(x) {
  if (!S.d || !S.proj.taps) return -1;
  let best = -1, bd = 7;
  S.proj.taps.forEach((t, i) => { const d = Math.abs(qToX((t - S.d.off) / S.d.g.spq) - x); if (d < bd) { bd = d; best = i; } });
  return best;
}
// duyulan an: oynatma imleci Tone'un ileri planlama süresi + çıkış gecikmesi kadar öndedir
function heardNow() {
  const ctx = window.Tone ? Tone.getContext() : null;
  const la = ctx ? ctx.lookAhead || 0 : 0, ol = ctx && ctx.rawContext ? ctx.rawContext.outputLatency || ctx.rawContext.baseLatency || 0 : 0;
  return S.pos - la - ol;
}
function addTap() {
  if (!S.d) return;
  if (!Player.playing) { status('Değişim noktası için önce oynat (Boşluk), sonra akor değişiminde T\'ye bas.', 'err'); return; }
  const t = heardNow() + S.d.off;
  S.proj.taps.push(t); S.proj.taps.sort((a, b) => a - b);
  S.tapFlash = performance.now();
  renderTaps(); draw();
}
function tapEstimate() {
  if (!S.d || !S.proj.taps || S.proj.taps.length < 3) return null;
  const notes = S.d.notes.map((n) => ({ t0: n.tl0 + S.d.off, t1: n.tl1 + S.d.off }));
  return C.estimateFromTaps(S.proj.taps, notes, { bpm: S.proj.settings.bpm, meter: S.proj.settings.meter });
}
function renderTaps() {
  const box = $('#tapInfo');
  if (!box) return;
  const n = (S.proj.taps || []).length;
  $('#tapCount').textContent = n ? `(${n})` : '';
  const r = tapEstimate();
  S.tapEst = r;
  let h = '';
  if (!n) h = '<p class="hint">Henüz nokta yok.</p>';
  else if (!r) h = `<p class="hint">${n} nokta — tahmin için en az 3 gerekir.</p>`;
  else if (!r.ok) h = `<div class="st-warn">⚠ ${esc(r.reasons.join(' '))}</div>`;
  else {
    const set = S.proj.settings, curOff = C.effectiveOffset(S.proj) + (S.proj.audio.leadBars || 0) * S.d.g.barSec; // kaydırma (boş ölçü) ızgarayı bozmaz
    const shiftMs = Math.round((r.firstBarSec - curOff) * 1000);
    h = `<div class="adv-opt"><b>${n} noktadan: ${esc(r.meter)}, ${r.bpm} BPM</b> · ${esc(r.why)} · noktalar ortalama ${Math.round(r.residualMs)} ms sapıyor
      <div class="hint">1. ölçü ${r.firstBarSec.toFixed(2)} s'de başlıyor (ölçü çizgileri şu an ${Math.abs(shiftMs) < 15 ? 'doğru yerde' : `${shiftMs > 0 ? '+' : ''}${shiftMs} ms kayık`}) · ${r.marks.length} ✂ işareti${set.meter !== r.meter || Math.abs(set.bpm - r.bpm) > 0.05 ? ` · proje şu an ${esc(set.meter)}, ${set.bpm} BPM` : ''}</div>
      ${r.reasons.map((x) => `<div class="hint">ℹ ${esc(x)}</div>`).join('')}
      ${r.hypotheses.length > 1 ? `<div class="hint">Diğer okumalar: ${r.hypotheses.slice(1, 3).map((x) => `${esc(x.meter)} ${x.bpm} BPM`).join(', ')}</div>` : ''}
      <div class="row"><button class="accent" id="btnTapApply">Uygula: tempo + ölçü + ızgara + ✂ işaretleri</button></div></div>`;
  }
  if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; } // aynıysa dokunma: üstündeki düğmeye basılırken kaybolmasın
}
function applyTaps() {
  const r = S.tapEst;
  if (!r || !r.ok) return;
  const set = S.proj.settings, a = S.proj.audio;
  const before = `${set.meter}, ${set.bpm} BPM`;
  set.bpm = r.bpm; set.meter = r.meter;
  const lat = a.source === 'record' ? (set.latencyMs || 0) / 1000 : 0;
  a.offsetSec = r.firstBarSec - lat; a.alignMode = 'none';
  if (a.source === 'record') a.recOffsetSec = a.offsetSec;
  S.proj.changeMarks = r.marks.slice();
  S.proj.chordOpts.onlyMarked = true;
  S.proj.chordPins = [];
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.half == null || C.METERS[set.meter].split);
  syncInputs(); refresh();
  status(`Tap'lerden: ${before} → ${set.meter}, ${set.bpm} BPM · ölçü çizgileri hizalandı · ${r.marks.length} ✂ işareti, akorlar yalnızca bu noktalarda değişir.`);
}
$('#btnTap').onclick = () => addTap();
$('#btnTapUndo').onclick = () => { if (S.proj.taps.length) { S.proj.taps.pop(); refresh(); } };
$('#btnTapClear').onclick = () => { S.proj.taps = []; refresh(); };
$('#tapInfo').addEventListener('click', (e) => { if (e.target.closest('#btnTapApply')) applyTaps(); });
// ---------------------------------------------------------------- DAVUL: ölçü tahmini + loop seçimi
function drumNotes() {
  if (!S.d || !S.track) return [];
  const rms = S.track.rms;
  return S.d.notes.map((n) => {
    let loud = 0;
    for (let f = n.f0i; f < Math.min(n.f1i, n.f0i + 6); f++) loud = Math.max(loud, rms[f] || 0);
    return { t0: n.tl0, t1: n.tl1, pitch: n.effMidi, loud };
  });
}
function analyzeDrums() {
  const ns = drumNotes();
  // click'le kaydedildiyse ya da test melodisiyse ızgara zaten doğru: vuruş fazını tahmin etme
  const fixedPhase = S.proj.audio.source === 'test' || (S.proj.audio.source === 'record' && S.proj.audio.alignMode === 'none');
  S.meterEst = ns.length ? C.estimateMeter(ns, S.proj.settings.bpm, { fixedPhase }) : null;
  S.drumSug = C.suggestDrumLoop(ns, Object.assign({}, S.proj.settings, { swingRatio: swingR() }), S.meterEst); // senin bildirdiğin swing oranı his tahmininin üstündedir
}
function currentLoop() {
  const id = S.proj.drums.loop;
  const L = id && id !== 'auto' ? C.DRUM_LOOPS.find((l) => l.id === id && l.meter === S.proj.settings.meter) : null;
  return L || (S.drumSug && S.drumSug.best ? S.drumSug.best.loop : C.loopsFor(S.proj.settings.meter)[0] || null);
}
function renderDrums() {
  analyzeDrums();
  const est = S.meterEst, sug = S.drumSug, set = S.proj.settings;
  // ölçü tahmini
  let mh = '';
  if (!est) mh = '<p class="hint">Ölçü tahmini için önce kayıt / analiz.</p>';
  else if (!est.ok) mh = `<div class="st-warn">⚠ ${esc(est.reasons.join(' '))}</div>`;
  else {
    const differs = est.meter !== set.meter || (est.bpm && est.bpm !== set.bpm);
    const shifted = Math.abs(est.shiftSec) > 0.03;
    const others = est.candidates.slice(1).map((c) => `${c.meter}${c.bpm !== set.bpm ? ` (${c.bpm} BPM)` : ''}`).join(', ');
    mh = `<div class="${differs ? 'st-warn' : 'adv-opt'}"><b>Ölçü tahmini: ${esc(est.meter)}</b>${est.bpm !== set.bpm ? ` · BPM ${est.bpm}` : ''} · güven %${Math.round(est.confidence * 100)} · his: ${est.feel === 'triple' ? 'üçleme (shuffle / 6/8)' : "düz (8'lik)"}${others ? ` · diğer adaylar: ${esc(others)}` : ''}
      ${est.note ? `<div class="hint">${esc(est.note)}</div>` : ''}
      ${est.ambiguous24 ? '<div class="hint">2/4 ile 4/4 vurgudan ayırt edilemiyor (4/4 = iki 2/4); 4/4 öncelikli.</div>' : ''}
      ${est.unsupported ? `<div>⚠ ${esc(est.meter)} için uygulamada ölçü yok.</div>` : ''}
      ${differs ? `<div class="hint">✋ Proje ölçün <b>${esc(set.meter)}</b>, ${set.bpm} BPM — senin seçimin: hiçbir otomatik işlem (✨ Demo dahil) bunu değiştirmez. Bu tahmin yalnızca bilgi; istersen "Uygula".</div>` : ''}
      ${est.reasons.map((r) => `<div class="hint">${esc(r)}</div>`).join('')}
      <div class="hint">Vokal ${est.firstBeat === 1 ? 'ölçü başında (1. vuruşta)' : `${String(est.firstBeat).replace('.5', '. vuruşun ve\'sinde').replace(/^(\d)$/, '$1. vuruşta')} (öncü)`} başlıyor${shifted ? ` — ölçü çizgileri şu an ${Math.abs(est.shiftSec).toFixed(2)} s kayık görünüyor` : ''}.</div>
      ${differs || shifted ? `<div class="row"><button class="accent" id="btnMeterApply">Uygula: ${esc(est.meter)}${est.bpm !== set.bpm ? `, ${est.bpm} BPM` : ''}${shifted ? ' + ölçü çizgilerini hizala' : ''}</button> <span class="hint">proje şu an ${esc(set.meter)}, ${set.bpm} BPM</span></div>` : '<div class="hint">✓ Proje ölçüsüyle uyumlu.</div>'}</div>`;
  }
  if ($('#meterEst').dataset.h !== mh) { $('#meterEst').innerHTML = mh; $('#meterEst').dataset.h = mh; }
  // loop listesi (proje ölçüsü)
  const pool = C.loopsFor(set.meter), sel = $('#inDrumLoop');
  const bestId = sug && sug.best ? sug.best.loop.id : null;
  const opts = `<option value="auto">Otomatik${bestId ? ` (öneri: ${esc(sug.best.loop.name)})` : ''}</option>` + pool.map((l) => `<option value="${l.id}">${esc(l.name)} · ${l.bpm[0]}–${l.bpm[1]} BPM</option>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  const want = S.proj.drums.loop && pool.some((l) => l.id === S.proj.drums.loop) ? S.proj.drums.loop : 'auto';
  sel.value = want;
  $('#inDrumsOn').checked = !!S.proj.drums.on;
  const L = currentLoop();
  let ih = '';
  if (sug) {
    const r = sug.ranked.find((x) => x.loop === L);
    if (r) ih += `<div class="${sug.ok || want !== 'auto' ? 'adv-opt' : 'st-warn'}"><b>${esc(L.name)}</b> — ${esc(L.desc)}<div class="hint">${esc(r.why.join(' · '))} · puan ${r.score.toFixed(2)}</div></div>`;
    if (!sug.ok) {
      ih += `<div class="st-warn adv-imp">⚠ <b>Bu melodiye uygun bir loop bulamadım.</b><ul>${sug.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        En yakını çalıyor${want === 'auto' ? '' : ' (senin seçtiğin loop)'}. Yeni bir loop istemek için bu tarifi Claude'a gönder:
        <textarea id="drumRequest" rows="7" readonly>${esc(sug.request)}</textarea><button id="btnDrumCopy" class="small">Tarifi kopyala</button></div>`;
    } else if (sug.reasons.length) ih += sug.reasons.map((x) => `<div class="hint">ℹ ${esc(x)}</div>`).join('');
    // loop puanları artık Davul bölümünde görünür liste (#drumRank)
  }
  if ($('#drumInfo').dataset.h !== ih) { $('#drumInfo').innerHTML = ih; $('#drumInfo').dataset.h = ih; }
  $('#drumGrid').textContent = L ? C.loopGridText(L) : '';
  renderRank('#drumRank', 'drums', sug ? sug.ranked.map((x) => ({ id: x.loop.id, name: x.loop.name, score: x.score, sub: `vurgu ${x.accent.toFixed(2)} · tempo ${x.tempo.toFixed(2)}${x.feelOk ? '' : ' · his uymuyor'}`, why: x.why.join(' · ') })) : [], want !== 'auto' ? want : null, L ? L.id : null);
}
// puanlı öneri listesi (davul loop'ları ve bas kalıpları): ▶ seçmeden 2 ölçü dinle · Seç = elle seç (elle seçilen puana bakılmadan geçerli)
function renderRank(sel, kind, rows, manualId, currentId) {
  const box = $(sel);
  if (!box) return;
  const top = rows.length ? Math.max(...rows.map((r) => r.score)) : 1;
  const h = rows.length ? `<div class="rank-head hint">Puan sırası (en iyi üstte)${manualId ? ' · ✋ elle seçtiğin puana bakılmadan çalıyor' : ''}</div>` + rows.map((r, i) => `<div class="rank-row${r.id === currentId ? ' cur' : ''}" title="${esc(r.why || '')}">
      <button class="small" data-pv="${kind}" data-id="${r.id}" title="Seçmeden 2 ölçü dinle">▶</button>
      <span class="rk-name">${i + 1}. ${esc(r.name)}${r.id === manualId ? ' <span class="tag warn">✋ senin seçimin</span>' : r.id === currentId ? ' <span class="tag ok">çalan</span>' : ''}</span>
      <span class="rk-bar"><i style="width:${Math.max(4, Math.round((r.score / Math.max(top, 0.01)) * 100))}%"></i></span><span class="rk-score">${r.score.toFixed(2)}</span>
      <button class="small" data-pick="${kind}" data-id="${r.id}">${r.id === manualId ? '✓' : 'Seç'}</button>
      ${r.sub ? `<div class="rk-sub hint">${esc(r.sub)}</div>` : ''}</div>`).join('') : '';
  if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
}
function renderBass() {
  const meter = S.proj.settings.meter, pool = C.bassPool(meter), sel = $('#inBassPattern');
  const loop = currentLoop(), ctx = bassCtx(loop), rank = C.rankBass(ctx), sug = C.suggestBass(ctx.loop, ctx.meter, ctx.bpm, ctx.vocalRate, ctx.swing);
  const opts = `<option value="auto">Otomatik (öneri: ${esc(C.BASS_PATTERNS[sug.id].name)})</option>` + pool.map((id) => `<option value="${id}">${esc(C.BASS_PATTERNS[id].name)}</option>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  const want = pool.includes(S.proj.bass.pattern) ? S.proj.bass.pattern : 'auto';
  sel.value = want;
  $('#inBassOn').checked = !!S.proj.bass.on;
  $('#bassInfo').textContent = want === 'auto' ? `Otomatik: ${C.BASS_PATTERNS[sug.id].name} — ${sug.why}.` : `Elle seçtiğin kalıp çalıyor: ${C.BASS_PATTERNS[want].name} (otomatik öneri ${C.BASS_PATTERNS[sug.id].name} olurdu).`;
  renderRank('#bassRank', 'bass', rank.map((r) => ({ id: r.id, name: r.name, score: r.score, sub: `önsel ${r.prior.toFixed(1)} · uyum ${r.fit.toFixed(2)}`, why: r.why.join(' · ') })), want !== 'auto' ? want : null, want !== 'auto' ? want : sug.id);
}
// listeden ▶ (önizleme) ve Seç
function pickFromRank(kind, id) {
  if (kind === 'drums') { S.proj.drums.loop = id; S.proj.drums.on = true; }
  else { S.proj.bass.pattern = id; S.proj.bass.on = true; }
  syncInputs(); refresh();
  status(`${kind === 'drums' ? 'Davul' : 'Bas'}: ${kind === 'drums' ? loopById(id).name : C.BASS_PATTERNS[id].name} elle seçildi — otomatik öneriler bunu değiştirmez. Otomatiğe dönmek için listeden "Otomatik"i seç.`);
  if (Player.playing) Player.play();
}
function previewPattern(kind, id) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  const g = S.d.g, sec = S.sel && S.sel.type === 'section' ? S.d.sections.find((x) => x.id === S.sel.id && !x.implicit) : null;
  let bar = S.loop.on ? Math.floor(S.loop.from / g.barSec + 1e-6) + 1 : sec ? sec.startBar : barAtPlayheadQ();
  bar = Math.min(Math.max(bar, S.d.chordStart || 1), Math.max(1, S.d.bars - 1));
  const from = (bar - 1) * g.barSec, to = Math.min(S.d.bars, bar + 1) * g.barSec;
  status(`▶ ${kind === 'drums' ? loopById(id).name : C.BASS_PATTERNS[id].name} — ölçü ${bar}–${bar + 1} önizleme (seçilmedi).`);
  Player.play({ preview: { from, to, bass: kind === 'bass' ? id : null, drums: kind === 'drums' ? id : null } });
}
for (const [sel, kind] of [['#drumRank', 'drums'], ['#bassRank', 'bass']]) {
  $(sel).addEventListener('click', (e) => {
    const pv = e.target.closest('button[data-pv]'), pk = e.target.closest('button[data-pick]');
    if (pv) previewPattern(pv.dataset.pv, pv.dataset.id);
    else if (pk) pickFromRank(pk.dataset.pick, pk.dataset.id);
  });
}
$('#meterEst').addEventListener('click', (e) => {
  if (!e.target.closest('#btnMeterApply') || !S.meterEst) return;
  const est = S.meterEst, set = S.proj.settings;
  const before = `${set.meter}, ${set.bpm} BPM`;
  applyMeterEstimate(est);
  syncInputs(); refresh();
  status(`Ölçü ${before} → ${set.meter}, ${set.bpm} BPM${Math.abs(est.shiftSec) > 0.03 ? ' · ölçü çizgileri hizalandı' : ''}. Kilitli akorlar ölçü numarasına bağlı — gerekirse kontrol et.`);
});
$('#drumInfo').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnDrumCopy')) return;
  try { await navigator.clipboard.writeText($('#drumRequest').value); status('Tarif kopyalandı — Claude\'a yapıştır.'); } catch (err) { $('#drumRequest').select(); status('Kopyalanamadı; metin seçildi, Ctrl+C ile kopyala.', 'err'); }
});
$('#inDrumsOn').addEventListener('change', (e) => { S.proj.drums.on = e.target.checked; if (Player.playing) Player.play(); });
$('#inDrumLoop').addEventListener('change', (e) => { S.proj.drums.loop = e.target.value; renderDrums(); if (Player.playing) Player.play(); });
$('#btnDrumPreview').onclick = () => Player.previewDrums(currentLoop());
$('#btnDrumStop').onclick = () => Player.stop();
// ---------------------------------------------------------------- DÖNGÜ + "BAŞKA DENE" (alternatifi hemen dinle)
const barAtPlayheadQ = () => Math.floor(S.pos / S.d.g.barSec + 1e-6) + 1;
// döngü bölgesi: seçili bölüm → imlecin olduğu bölüm → imleçten 4 ölçü
function setLoopRegion() {
  if (!S.d) return;
  const g = S.d.g, bars = S.d.bars;
  let sec = S.sel && S.sel.type === 'section' ? S.d.sections.find((x) => x.id === S.sel.id && !x.implicit) : null;
  if (!sec) sec = sectionOfBar(barAtPlayheadQ());
  if (sec) { S.loop.from = (sec.startBar - 1) * g.barSec; S.loop.to = Math.min(bars, sec.endBar) * g.barSec; S.loop.name = sec.name; }
  else { const b = barAtPlayheadQ(); S.loop.from = (b - 1) * g.barSec; S.loop.to = Math.min(bars, b + 3) * g.barSec; S.loop.name = `ölçü ${b}–${Math.min(bars, b + 3)}`; }
}
function toggleLoop(on) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  S.loop.on = on === undefined ? !S.loop.on : on;
  if (S.loop.on) setLoopRegion();
  $('#btnLoop').classList.toggle('on', S.loop.on);
  draw();
  if (S.loop.on) status(`🔁 Döngü: ${S.loop.name} (${((S.loop.to - S.loop.from)).toFixed(1)} s). Başka bir bölüme tıklarsan döngü onu izler; ⟳ düğmeleriyle davul / bas / akor sesini değiştirip hemen dinle.`);
  else status('Döngü kapandı.');
  if (Player.playing) Player.play();
}
// alternatifi sırayla dene: kind = 'drums' | 'bass' | 'piano'; secId = bölüm düzenlemesi için (yoksa genel ayar)
function arrOptions(kind) {
  const meter = S.proj.settings.meter;
  if (kind === 'drums') { const pool = C.loopsFor(meter), rank = S.drumSug ? S.drumSug.ranked.map((x) => x.loop.id) : []; return pool.slice().sort((a, b) => (rank.indexOf(a.id) + 1 || 99) - (rank.indexOf(b.id) + 1 || 99)).map((l) => ({ id: l.id, name: l.name })); }
  if (kind === 'bass') return C.bassPool(meter).map((id) => ({ id, name: C.BASS_PATTERNS[id].name }));
  return Object.keys(C.PIANO_STYLES).map((id) => ({ id, name: C.PIANO_STYLES[id].name }));
}
function arrCurrent(kind, secId) {
  const a = secId ? secArr(secId)[kind] : null;
  if (a && a !== 'off') return a;
  if (kind === 'drums') return (currentLoop() || {}).id;
  if (kind === 'bass') { const p = S.proj.bass.pattern; return p && p !== 'auto' ? p : suggestBassFor(currentLoop()).id; }
  return S.proj.piano.style;
}
function arrNext(kind, secId) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  const opts = arrOptions(kind);
  if (!opts.length) return;
  const i = opts.findIndex((o) => o.id === arrCurrent(kind, secId)), nx = opts[(i + 1) % opts.length];
  if (secId) { const s = S.proj.sections.find((x) => x.id === secId); if (!s) return; s.arr = Object.assign({}, s.arr, { [kind]: nx.id }); delete s.arr.auto; }
  else if (kind === 'drums') { S.proj.drums.loop = nx.id; S.proj.drums.on = true; }
  else if (kind === 'bass') { S.proj.bass.pattern = nx.id; S.proj.bass.on = true; }
  else S.proj.piano.style = nx.id;
  syncInputs(); refresh();
  const label = { drums: 'Davul', bass: 'Bas', piano: 'Akor sesi' }[kind];
  status(`${label}${secId ? ' (bu bölüm)' : ''}: ${nx.name} — ${(i + 1) % opts.length + 1}/${opts.length}. Beğenmediysen ⟳ ile sıradakini dene.`);
  auditionNow();
}
// seçeneği hemen dinlet: çalıyorsa baştan (döngüdeyse bölgenin başından), çalmıyorsa seçili bölümün başından
function auditionNow() {
  if (!S.d) return;
  if (!Player.playing) {
    const sec = S.sel && S.sel.type === 'section' ? S.d.sections.find((x) => x.id === S.sel.id && !x.implicit) : null;
    if (S.loop.on) setLoopRegion();
    S.pos = S.loop.on ? S.loop.from : sec ? (sec.startBar - 1) * S.d.g.barSec : S.pos;
  } else if (S.loop.on) S.pos = S.loop.from;
  Player.play();
}

// ---------------------------------------------------------------- "DEMO YAP": ölçü + ton + akor + davul + bas tek tuşla
function applyMeterEstimate(est) { // 8b'deki "Uygula" ile aynı; yenilemeyi çağıran yapar
  const set = S.proj.settings;
  set.meter = est.meter; if (est.bpm) set.bpm = est.bpm;
  if (Math.abs(est.shiftSec) > 0.03) {
    S.proj.audio.offsetSec += est.shiftSec;
    S.proj.audio.alignMode = 'none';
    if (S.proj.audio.source === 'record') S.proj.audio.recOffsetSec = S.proj.audio.offsetSec;
  }
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.half == null || C.METERS[set.meter].split);
}
function makeDemo() {
  if (!S.d || !S.audio || !S.rawNotes || !S.rawNotes.length) { status('Demo için önce bir ses kaydı/yükleme ve analiz gerekli ("Test melodisi üret" ile de deneyebilirsin).', 'err'); return; }
  Player.stop(true);
  const did = [];
  HIST.hold++; // bütün adımlar tek geri alma adımı
  try {
    // 1) ölçü ve tempo: senin ayarındır, Demo asla değiştirmez; tahmin farklıysa yalnızca not düşer
    const est = S.meterEst, set = S.proj.settings;
    if (est && est.ok && !est.unsupported && est.confidence >= 0.55 && (est.meter !== set.meter || (est.bpm && est.bpm !== set.bpm))) {
      did.push(`ölçü/tempo senin ayarın: ${set.meter}, ${set.bpm} BPM (melodi ${est.meter}${est.bpm && est.bpm !== set.bpm ? `, ${est.bpm} BPM` : ''} gibi görünüyor — dokunmadım; 8b'den "Uygula" diyebilirsin)`);
    } else did.push(`ölçü/tempo: ${set.meter}, ${set.bpm} BPM`);
    { // swing: senin ayarın; melodide farklı bir oran ölçülürse yalnızca not düşer
      const sw = C.estimateSwing(S.d.notes.map((n) => ({ q0: n.qOrig })), S.d.g);
      if (sw && sw.confident && Math.abs(sw.ratio - swingR()) > 0.04) did.push(`alt bölme senin ayarın (${swingMode() === 'straight' ? 'düz' : '%' + Math.round(swingR() * 100)}); melodide ≈%${Math.round(sw.ratio * 100)} swing ölçüldü — dokunmadım, 1. adımdan uygulayabilirsin`);
    }
    // 2) bölüm ve ton: bölüm yoksa tek bölüm; onaylanmamış önerilen tonlar onaylanır
    if (!S.proj.sections.length) { S.proj.sections.push({ id: uid(), name: 'Şarkı', startBar: 1, endBar: S.d.bars, tonic: null, mode: null }); refresh(); }
    let keyed = 0;
    for (const s of S.proj.sections) if (s.tonic == null) { const ds = S.d.sections.find((x) => x.id === s.id); if (ds && ds.tonic != null) { s.tonic = ds.tonic; s.mode = ds.mode; keyed++; } }
    refresh();
    did.push(`ton: ${S.d.sections.filter((x) => !x.implicit && x.tonic != null).map((x) => `${x.name} ${C.keyName(x.tonic, x.mode)}`).join(', ') || '—'}${keyed ? ' (öneriler onaylandı)' : ''}`);
    // 3) davul + bas aç. Elle seçtiklerine (loop, bas kalıbı, fill, bölüm düzenlemesi) dokunmaz; yalnızca "otomatik" olanı doldurur
    S.proj.drums.on = true; S.proj.bass.on = true;
    const manual = [];
    if (S.proj.drums.loop && S.proj.drums.loop !== 'auto') manual.push('davul loop\'u');
    if (S.proj.bass.pattern && S.proj.bass.pattern !== 'auto') manual.push('bas kalıbı');
    // 4) bölüm başına çeşitlilik: nakarat varsa verse / giriş daha sade (sade davul + yarım notalı bas). Elle verilen bölüm düzenlemesi korunur; önceki demo'nun otomatik düzenlemesi yenilenir
    for (const s of S.proj.sections) if (s.arr && s.arr.auto) delete s.arr;
    const types = S.proj.sections.map((s) => C.normSectionType(s.type || s.name));
    if (S.proj.sections.length >= 2 && types.includes('chorus')) {
      const sade = loopById('minimal');
      S.proj.sections.forEach((s, i) => {
        if (s.arr) { manual.push(`"${s.name}" bölüm düzenlemesi`); return; }
        if (types[i] === 'verse' || types[i] === 'intro') {
          s.arr = { auto: true };
          if (C.bassPool(set.meter).includes('half') && S.proj.bass.pattern === 'auto') s.arr.bass = 'half';
          if (sade && S.proj.drums.loop === 'auto' && currentLoop() && currentLoop().id !== 'minimal') s.arr.drums = 'minimal';
          if (!s.arr.bass && !s.arr.drums) delete s.arr;
        }
      });
      if (S.proj.sections.some((s) => s.arr && s.arr.auto)) did.push('verse/giriş daha sade, nakarat dolu');
    }
    if (manual.length) did.push(`elle seçtiklerin korundu: ${manual.join(', ')}`);
    syncInputs(); refresh();
  } finally { HIST.hold--; }
  histCommit();
  const L = currentLoop(), b = S.d.chords.length ? bassPatternFor(S.d.chords[0]) : null;
  did.push(`davul: ${L ? L.name : '—'}`, `bas: ${b ? C.BASS_PATTERNS[b].name : '—'}`, `akor sesi: ${C.PIANO_STYLES[S.proj.piano.style].name}`);
  S.pos = 0; $('#tlScroll').scrollLeft = 0;
  status('✨ Demo hazır → ' + did.join(' · ') + '. Çalıyor; beğenmediğini ⟳ ile değiştir, Ctrl+Z ile geri al.');
  Player.play();
}

// ---------------------------------------------------------------- Tone.js oynatma
const TONE_URLS = [
  'https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/15.1.22/Tone.js',
  'https://unpkg.com/tone@15.1.22/build/Tone.js',
];
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error('yüklenemedi: ' + src)); };
    document.head.appendChild(s);
  });
}
async function loadTone() {
  if (window.Tone) return;
  for (const u of TONE_URLS) { try { await loadScript(u); if (window.Tone) return; } catch (e) { console.warn(e.message); } }
  throw new Error('Tone.js yüklenemedi (internet bağlantısı gerekli)');
}
const Player = {
  ready: false, init: null, playing: false, buffersDirty: true, t0: 0, from: 0, raf: 0,
  ensure() { if (!this.init) this.init = this._init().catch((e) => { this.init = null; throw e; }); return this.init; },
  async _init() {
    await loadTone();
    await Tone.start();
    const T = Tone;
    this.vocalCh = new T.Channel(0).toDestination();
    this.pianoCh = new T.Channel(-6).toDestination();
    this.synthBus = new T.Gain(1).connect(this.pianoCh); // synth klavye de "akor" kanalından geçer (ses seviyesi / mute / solo ortak)
    this.bassCh = new T.Channel(-5).toDestination();
    this.bassBus = new T.Gain(1).connect(this.bassCh);
    this.synthVoices = new Set();
    this.gA = new T.Gain(0).connect(this.vocalCh);
    this.gB = new T.Gain(1).connect(this.vocalCh);
    this.pA = new T.Player().connect(this.gA);
    this.pB = new T.Player().connect(this.gB);
    this.click = new T.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }, volume: -16 }).toDestination();
    this.snare = new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 }, volume: -12 }).toDestination();
    this.drumCh = new T.Channel(-8).toDestination();
    const rsr = T.getContext().sampleRate;
    this.drumBufs = {};
    for (const k of ['K', 'S', 'H', 'O']) this.drumBufs[k] = toAudioBuffer(C.synthDrum(k, rsr), rsr);
    const piano = await loadPianoSamples();
    const urls = {};
    for (const s of piano.samples) urls[s.name] = new T.ToneAudioBuffer(s.buffer);
    this.sampler = new T.Sampler({ urls, release: 1.2 }).connect(this.pianoCh);
    await T.loaded();
    this.ready = true;
    this.applyMixer();
  },
  transport() { return Tone.getTransport ? Tone.getTransport() : Tone.Transport; },
  updateBuffers() {
    if (!this.ready || !this.buffersDirty || !S.audio) return;
    this.bufA = new Tone.ToneAudioBuffer(toAudioBuffer(S.audio.data, S.audio.sr));
    this.bufB = new Tone.ToneAudioBuffer(toAudioBuffer(S.corrected || S.audio.data, S.audio.sr));
    this.buffersDirty = false;
  },
  // Tone, bir kaynağın önceden zamanlanmış gelecek başlangıçlarını durdurunca silmez; döngü turları bu yüzden her çalmada taze oynatıcılarla zamanlanır
  freshPlayers() {
    for (const k of ['A', 'B']) {
      const old = this['p' + k], np = new Tone.Player().connect(this['g' + k]);
      if (this['buf' + k]) np.buffer = this['buf' + k];
      this['p' + k] = np;
      try { old.stop(); old.dispose(); } catch (err) { /* zaten bırakıldı */ }
    }
  },
  applyMixer() {
    const m = S.proj.mixer;
    if (!this.ready) return;
    const anySolo = m.vocal.solo || m.piano.solo || m.drums.solo || m.bass.solo;
    const chans = { vocal: this.vocalCh, piano: this.pianoCh, drums: this.drumCh, bass: this.bassCh };
    for (const k of Object.keys(chans)) {
      chans[k].volume.value = m[k].vol;
      chans[k].mute = m[k].mute || (anySolo && !m[k].solo);
    }
    const corr = m.ab !== 'original';
    this.gA.gain.value = corr ? 0 : 1;
    this.gB.gain.value = corr ? 1 : 0;
  },
  async play(opts = {}) {
    if (!S.d) return;
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    this.stop(true);
    const pv = opts.preview || null; // tek seferlik önizleme: bölge bir kez çalar, seçili ayarlar değişmez
    PREVIEW.bass = pv ? pv.bass : null; PREVIEW.drums = pv ? pv.drums : null;
    this.updateBuffers();
    this.freshPlayers();
    this.applyMixer();
    const T = this.transport();
    T.cancel(0);
    const g = S.d.g, off = S.d.off;
    // döngü: seçili bölüm (ya da imleçten 4 ölçü) tekrar tekrar çalınır; tekrarlar baştan zamanlanır, aralarda boşluk olmaz
    const region = pv ? { from: pv.from, to: pv.to } : S.loop.on && S.loop.to > S.loop.from + 0.05 ? S.loop : null;
    let from = S.pos;
    if (region && (from < region.from - 1e-6 || from >= region.to - 1e-6)) from = region.from;
    const len = region ? region.to - region.from : 0;
    const now = Tone.now() + 0.12;
    // her tur: [lo, hi) zaman çizelgesi aralığı, tau0 = lo'nun Transport zamanı
    const rounds = [{ lo: from, hi: region ? region.to : Infinity, tau0: from }];
    if (region && !pv) for (let k = 0; k < Math.min(200, Math.ceil(600 / len)); k++) rounds.push({ lo: region.from, hi: region.to, tau0: from + (region.to - from) + k * len });
    const pev = pianoEventsAll(), dev = drumEventsAll(), bev = bassEventsAll();
    const poInst = C.pianoOpts(S.proj.piano).inst;
    for (const r of rounds) {
      const at = (t) => r.tau0 + (Math.max(t, r.lo) - r.lo); // Transport zamanı
      if (S.audio) {
        for (const p of [this.pA, this.pB]) {
          if (!p.loaded) continue;
          const bo = r.lo + off, when = now + (r.tau0 - from), dur = Math.min(r.hi, S.d.bars * g.barSec + 1) - r.lo - (region ? 0.002 : 0); // 2 ms pay: bir turun durması sonrakinin başlamasından önce olmalı (Tone zaman sırası)
          if (bo >= 0) { if (bo < p.buffer.duration) (region ? p.start(when, bo, dur) : p.start(when, bo)); }
          else p.start(when - bo, 0, region ? Math.max(0.01, dur + bo) : undefined);
        }
      }
      for (const e of pev) {
        if (e.t >= r.hi || e.t + e.dur <= r.lo + 0.01) continue;
        const st = Math.max(e.t, r.lo);
        T.schedule((time) => this.playNote(e.inst || poInst, e, time, st), at(st));
      }
      for (const e of dev) if (e.t >= r.lo - 0.01 && e.t < r.hi) T.schedule((time) => this.hitDrum(e, time), at(e.t));
      for (const e of bev) {
        if (e.t >= r.hi || e.t + e.dur <= r.lo + 0.01) continue;
        const st = Math.max(e.t, r.lo);
        T.schedule((time) => this.hitBass(e, time, Math.max(0.05, e.t + e.dur - st)), at(st));
      }
      if (S.proj.mixer.click) {
        const endQ = Math.min(S.d.bars * g.barQ, r.hi / g.spq);
        for (let q = Math.ceil(r.lo / g.spq / g.clickQ - 1e-6) * g.clickQ; q < endQ - 1e-9; q += g.clickQ) {
          const kind = C.clickKind(g, q % g.barQ, S.proj.settings.clickFeel);
          if (kind === 'snare') T.schedule((time) => this.snare.triggerAttackRelease(0.09, time), at(q * g.spq));
          else T.schedule((time) => this.click.triggerAttackRelease(CLICK_HZ[kind], 0.03, time), at(q * g.spq));
        }
      }
    }
    T.start(now, from);
    this.playing = true; this.t0 = now; this.from = from; this.region = region;
    $('#btnPlay').textContent = '❚❚ Duraklat';
    const loop = () => {
      if (!this.playing) return;
      const el = Math.max(0, Tone.now() - this.t0);
      if (region) {
        const first = region.to - this.from;
        S.pos = el < first ? this.from + el : region.from + ((el - first) % len);
        if (el > first + len * (rounds.length - 1) + (pv ? 0.5 : 0)) { this.stop(); if (pv) S.pos = pv.from; return; } // tekrarlar / önizleme bitti
      } else {
        S.pos = this.from + el;
        if (S.pos >= S.d.bars * g.barSec + 1) { this.stop(); S.pos = 0; }
      }
      followPlayhead();
      draw(); updateReadout();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  // melodisiz akor önizleme (progresyon önericisi): süreler ölçü cinsinden (yoksa akor başına 1 ölçü), DAW temposunda
  // Tek akoru hemen çal (kilitlemeden, seçmeden). Oynatma sürüyorsa durdurmaz, üstüne çalar.
  // Seslendirme, zaman çizelgesindeki gibi o konumun melodisinin altında hesaplanır.
  async audition(chord, sectionId, q0, q1) {
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    const g = C.makeGrid(S.proj.settings);
    const slot = { chord: { root: chord.root, q: chord.q, bass: chord.bass ?? null }, section: sectionId, q0, q1 };
    if (slot.chord.bass == null) delete slot.chord.bass;
    C.voiceChords([slot], S.d ? S.d.notes : [], S.d ? S.d.sections : [], { pedal: S.proj.mixer.pedal });
    const dur = Math.min(2.5, Math.max(0.6, (q1 - q0) * g.spq));
    const t = Tone.now() + 0.03, inst = C.pianoOpts(S.proj.piano).inst;
    for (const m of [slot.voicing.bass, ...slot.voicing.notes]) {
      const vel = m === slot.voicing.bass ? 0.6 : 0.5;
      if (inst === 'synth') this.hitSynth({ midi: m, vel: vel * 127 }, t, dur);
      else this.sampler.triggerAttackRelease(Tone.Frequency(m, 'midi').toNote(), dur, t, vel);
    }
    status(`▶ ${C.chordName(chord)}`);
  },
  // akor/arpej notası: piyano (örnekler; tuş bırakılınca rel kadar sönme) ya da synth klavye. st: çalmaya başlanan an (ortadan başlama)
  playNote(inst, e, time, st) {
    if (inst === 'synth') { this.hitSynth(e, time, Math.max(0.05, e.t + e.dur - st)); return; }
    const hold = Math.max(0.05, e.t + (e.hold != null ? e.hold : e.dur) - st);
    this.sampler.release = e.rel != null ? e.rel : 1.2; // örnek, vuruş anında kendi bırakma süresini alır
    this.sampler.triggerAttackRelease(Tone.Frequency(e.midi, 'midi').toNote(), hold, time, e.vel / 127);
  },
  // synth klavye notası (Web Audio): iki fark edilmiş testere + üçgen → alçak geçiren; zarf çekirdekteki synthEnv ile aynı (mix WAV'la birebir)
  hitSynth(e, time, dur) {
    const ctx = Tone.getContext().rawContext, P = e.arp ? C.SYNTH.arp : C.SYNTH.chord;
    const env = C.synthEnv(!!e.arp, dur, !!e.fade), total = dur + env.tail, n = Math.max(16, Math.ceil(total * 200));
    const peak = C.SYNTH.level * Math.pow((e.vel || 80) / 127, 1.4);
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = peak * env.at((i / (n - 1)) * total);
    const out = ctx.createGain(), lp = ctx.createBiquadFilter(), f = C.midiToHz(e.midi);
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(P.cut0, time); lp.frequency.exponentialRampToValueAtTime(P.cut1, time + P.d + 0.05);
    const oscs = [['sawtooth', P.det, 0.5], ['sawtooth', -P.det, 0.5], ['triangle', 0, 0.4]].map(([type, det, amp]) => {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = det; a.gain.value = amp;
      o.connect(a).connect(lp); o.start(time); o.stop(time + total + 0.05);
      return o;
    });
    lp.connect(out);
    out.gain.setValueAtTime(0, time); out.gain.setValueCurveAtTime(curve, time, total);
    Tone.connect(out, this.synthBus);
    const v = { out, oscs };
    this.synthVoices.add(v);
    oscs[0].onended = () => { this.synthVoices.delete(v); try { out.disconnect(); } catch (err) { /* zaten bağlı değil */ } };
    this.synthHits = (this.synthHits || 0) + 1;
  },
  // bas notası (Web Audio): testere + sinüs → alçak geçiren; zarf çekirdekteki bassEnv ile aynı
  hitBass(e, time, dur) {
    const ctx = Tone.getContext().rawContext, env = C.bassEnv(dur), total = dur + env.tail, n = Math.max(16, Math.ceil(total * 200));
    const f = C.midiToHz(e.midi), peak = C.BASS.level * Math.pow((e.vel || 90) / 127, 1.3);
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = peak * env.at((i / (n - 1)) * total);
    const out = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = C.BASS.fc + 3 * f; lp.Q.value = 0.7;
    const oscs = [['sawtooth', 0.6], ['sine', 0.7]].map(([type, amp]) => {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = type; o.frequency.value = f; a.gain.value = amp;
      o.connect(a).connect(lp); o.start(time); o.stop(time + total + 0.05);
      return o;
    });
    lp.connect(out);
    out.gain.setValueAtTime(0, time); out.gain.setValueCurveAtTime(curve, time, total);
    Tone.connect(out, this.bassBus);
    const v = { out, oscs };
    this.synthVoices.add(v);
    oscs[0].onended = () => { this.synthVoices.delete(v); try { out.disconnect(); } catch (err) { /* zaten bağlı değil */ } };
    this.bassHits = (this.bassHits || 0) + 1;
  },
  killSynth() {
    if (!this.synthVoices) return;
    const now = Tone.getContext().rawContext.currentTime;
    for (const v of this.synthVoices) {
      try { v.out.gain.cancelScheduledValues(now); v.out.gain.setTargetAtTime(0, now, 0.015); v.oscs.forEach((o) => o.stop(now + 0.1)); } catch (err) { /* zaten bitti */ }
    }
  },
  // tek davul vuruşu: önceden sentezlenmiş örnek, hıza göre kazanç
  hitDrum(e, time) {
    const ctx = Tone.getContext().rawContext;
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = this.drumBufs[e.kind]; gn.gain.value = e.vel;
    src.connect(gn); Tone.connect(gn, this.drumCh);
    src.start(time);
    this.drumHits = (this.drumHits || 0) + 1;
  },
  async previewDrums(L, bars = 2) {
    if (!L) return;
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    this.stop(true);
    this.applyMixer();
    const g = C.makeGrid(S.proj.settings), T = this.transport();
    T.cancel(0);
    for (const e of C.drumEvents(L, g, bars)) T.schedule((time) => this.hitDrum(e, time), e.t);
    T.start(Tone.now() + 0.1, 0);
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { T.stop(); T.cancel(0); }, (bars * g.barSec + 1) * 1000);
    status(`▶ ${L.name} · ${S.proj.settings.meter} · ${S.proj.settings.bpm} BPM`);
  },
  async previewChords(chords, tonic, mode, durs) {
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    this.stop(true);
    const g = C.makeGrid(S.proj.settings);
    const sec = { id: 'preview', tonic, mode };
    let at = 0;
    const slots = chords.map((ch, i) => { const d = durs ? durs[i] : 1; const sl = { chord: ch, section: 'preview', q0: at * g.barQ, q1: (at + d) * g.barQ }; at += d; return sl; });
    C.voiceChords(slots, [], [sec]);
    const T = this.transport();
    T.cancel(0);
    const po = C.pianoOpts(S.proj.piano);
    for (const e of C.pianoEvents(slots, g, po)) T.schedule((time) => this.playNote(po.inst, e, time, e.t), e.t);
    T.start(Tone.now() + 0.1, 0);
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { T.stop(); T.cancel(0); }, (at * g.barSec + 2) * 1000);
    status(`Önizleme: ${chords.map((c, i) => `${C.chordName(c)} (${durs ? durs[i] : 1})`).join(' → ')} · ${S.proj.settings.bpm} BPM`);
  },
  stop(silent) {
    if (!this.ready) return;
    const T = this.transport();
    T.stop(); T.cancel(0);
    this.pA.stop(); this.pB.stop();
    this.sampler.releaseAll();
    this.killSynth();
    this.playing = false;
    PREVIEW.bass = null; PREVIEW.drums = null;
    cancelAnimationFrame(this.raf);
    $('#btnPlay').textContent = '▶ Çal';
    if (!silent) { draw(); updateReadout(); }
  },
};
function followPlayhead() {
  const sc = $('#tlScroll');
  const x = C.clamp(S.pos / S.d.g.spq, 0, 1e9) * S.view.pxPerQ + TL.KW;
  if (x < sc.scrollLeft + TL.KW || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - TL.KW - 40);
}
function updateReadout() {
  const g = S.d ? S.d.g : C.makeGrid(S.proj.settings);
  const q = S.pos / g.spq, bar = Math.floor(q / g.barQ + 1e-9) + 1, beat = (q - (bar - 1) * g.barQ) / g.pulseQ + 1;
  $('#posReadout').textContent = `${bar} · ${beat.toFixed(2)}`;
}

// ---------------------------------------------------------------- kayıt (count-in + click kulaklığa)
const WORKLET_SRC = `class RecProc extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.buf = new Float32Array(8192); this.n = 0; this.f0 = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; } }; }
  flush() { if (this.n) { this.port.postMessage({ frame: this.f0, data: this.buf.slice(0, this.n) }); this.n = 0; } }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) { if (this.n === 0) this.f0 = currentFrame; this.buf.set(ch, this.n); this.n += ch.length; if (this.n + 128 > this.buf.length) this.flush(); }
    return true;
  }
}
registerProcessor('rec-proc', RecProc);`;
let workletLoaded = false;
const CLICK_HZ = { down: 1760, acc: 1320, weak: 990 };
// "tıss": kısa, tizleştirilmiş gürültü patlaması (yarım zaman desenindeki 3. vuruş)
function noiseClickAt(ctx, t, gain) {
  const len = Math.round(ctx.sampleRate * 0.1), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 1800;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35 * gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  src.connect(hp).connect(g).connect(ctx.destination); // yalnızca çıkışa — kayıt zincirine bağlı değil
  src.start(t); src.stop(t + 0.1);
}
function clickAt(ctx, t, freq, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25 * gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(ctx.destination); // yalnızca çıkışa — kayıt zincirine bağlı değil
  o.start(t); o.stop(t + 0.05);
}
// AudioWorklet (Blob, file:// altında data: URL); olmazsa ScriptProcessor yedeği
async function makeRecorderNode(ctx, onChunk) {
  if (!workletLoaded && ctx.audioWorklet) {
    const urls = [URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' })), 'data:application/javascript;base64,' + btoa(WORKLET_SRC)];
    if (location.protocol === 'file:') urls.reverse();
    for (const u of urls) { try { await ctx.audioWorklet.addModule(u); workletLoaded = true; break; } catch (e) { console.warn('worklet:', e.message); } }
  }
  if (workletLoaded) {
    const node = new AudioWorkletNode(ctx, 'rec-proc', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e) => onChunk(e.data.frame, e.data.data);
    return node;
  }
  const bs = 4096, node = ctx.createScriptProcessor(bs, 1, 1);
  node.onaudioprocess = (e) => { e.outputBuffer.getChannelData(0).fill(0); onChunk(Math.round((e.playbackTime - bs / ctx.sampleRate) * ctx.sampleRate), e.inputBuffer.getChannelData(0).slice()); };
  return node;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// mikrofon yakalama (kayıt ve kalibrasyon ortak) — click'ler bu zincire bağlı değil
async function openCapture() {
  const ctx = getCtx();
  await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  const src = ctx.createMediaStreamSource(stream);
  const st = { ctx, stream, src, node: null, chunks: [], firstFrame: null };
  st.node = await makeRecorderNode(ctx, (frame, data) => { if (st.firstFrame == null) st.firstFrame = frame; st.chunks.push(data); });
  src.connect(st.node);
  st.node.connect(ctx.destination); // node sessizlik üretir (izleme yok); yalnızca işlemenin sürmesi için
  return st;
}
async function closeCapture(st) {
  if (st.node.port) st.node.port.postMessage('stop'); else st.node.onaudioprocess = null;
  await sleep(120);
  st.src.disconnect(); st.node.disconnect();
  st.stream.getTracks().forEach((t) => t.stop());
  const len = st.chunks.reduce((a, c) => a + c.length, 0);
  const data = new Float32Array(len);
  let o = 0;
  for (const c of st.chunks) { data.set(c, o); o += c.length; }
  return data;
}
const Rec = {
  st: null,
  async start() {
    if (this.st || Cal.on) return;
    if (Player.playing) Player.stop();
    let st;
    try { st = await openCapture(); } catch (e) { status('Mikrofon izni alınamadı: ' + e.message, 'err'); return; }
    const ctx = st.ctx;
    const g = C.makeGrid(S.proj.settings);
    const t0 = ctx.currentTime + 0.3;
    st.barStart = t0 + g.barSec;
    const vol = +$('#inClickVol').value;
    let q = 0;
    const sched = () => {
      const horizon = ctx.currentTime + 0.25;
      while (t0 + q * g.spq < horizon) {
        const kind = C.clickKind(g, q % g.barQ, S.proj.settings.clickFeel);
        if (kind === 'snare') noiseClickAt(ctx, t0 + q * g.spq, vol);
        else clickAt(ctx, t0 + q * g.spq, CLICK_HZ[kind], vol * (kind === 'weak' ? 0.6 : 1));
        q += g.clickQ;
      }
      const el = ctx.currentTime - t0;
      if (el < g.barSec) status(`Count-in… ${Math.max(1, Math.ceil((g.barSec - el) / g.pulseSec))}`, 'busy');
      else status(`● Kayıt — ölçü ${Math.floor((el - g.barSec) / g.barSec) + 1}`, 'busy');
    };
    sched();
    st.timer = setInterval(sched, 40);
    this.st = st;
    $('#btnRec').classList.add('on'); $('#btnRecStop').disabled = false;
  },
  async stop() {
    const st = this.st;
    if (!st) return;
    this.st = null;
    clearInterval(st.timer);
    const data = await closeCapture(st);
    $('#btnRec').classList.remove('on'); $('#btnRecStop').disabled = true;
    if (!data.length) { status('Kayıt boş.', 'err'); return; }
    const sr = st.ctx.sampleRate;
    setAudio(data, sr, 'Kayıt ' + new Date().toLocaleTimeString(), 'record');
    // 1. ölçünün başı kayıttaki hangi saniyeye denk geliyor (gecikme ayrıca eklenir)
    S.proj.audio.offsetSec = st.barStart - st.firstFrame / sr;
    S.proj.audio.recOffsetSec = S.proj.audio.offsetSec; // "Yok" seçilince click'e göre hizaya dönülür
    S.proj.audio.alignMode = 'none';
    syncInputs();
    await analyze();
  },
};

// ---------------------------------------------------------------- gecikme kalibrasyonu (8 click + alkış)
const Cal = {
  on: false,
  async run() {
    if (this.on || Rec.st) return;
    if (Player.playing) Player.stop();
    let st;
    try { st = await openCapture(); } catch (e) { status('Mikrofon izni alınamadı: ' + e.message, 'err'); return; }
    this.on = true;
    $('#btnLatencyCal').disabled = true;
    const ctx = st.ctx, N = 8;
    const interval = C.clamp(C.makeGrid(S.proj.settings).pulseSec, 0.4, 1.0);
    const vol = Math.max(0.3, +$('#inClickVol').value);
    const t0 = ctx.currentTime + 1.0;
    const clicks = Array.from({ length: N }, (_, i) => t0 + i * interval);
    clicks.forEach((t, i) => clickAt(ctx, t, i === 0 ? 1760 : 1320, vol));
    const timer = setInterval(() => {
      const k = Math.floor((ctx.currentTime - t0) / interval) + 1;
      status(k < 1 ? 'Kalibrasyon: hazır olun — her click\'te el çırpın' : `Kalibrasyon: click ${Math.min(k, N)}/${N} — el çırpın`, 'busy');
    }, 60);
    await sleep((t0 - ctx.currentTime + (N - 1) * interval + 0.6) * 1000);
    clearInterval(timer);
    const data = await closeCapture(st);
    this.on = false;
    $('#btnLatencyCal').disabled = false;
    if (!data.length || st.firstFrame == null) { status('Kalibrasyon: mikrofondan ses gelmedi.', 'err'); return; }
    const sr = ctx.sampleRate, rec0 = st.firstFrame / sr;
    const m = C.measureLatency(data, sr, clicks.map((t) => t - rec0));
    const list = m.offsets.map((v) => (v == null ? '—' : Math.round(v * 1000))).join(', ');
    this.last = m;
    if (m.detected < 4) {
      $('#latencyInfo').textContent = `Son deneme: ${m.detected}/${N} alkış algılandı (ofsetler: ${list} ms) — gecikme değiştirilmedi.`;
      status(`Kalibrasyon başarısız: yalnızca ${m.detected} alkış algılandı. Mikrofona yakın, net çırpıp tekrar deneyin.`, 'err');
      return;
    }
    S.proj.settings.latencyMs = m.latencyMs;
    syncInputs(); refresh();
    $('#latencyInfo').textContent = `Kalibrasyon: ${m.detected}/${N} alkış · ofsetler ${list} ms · medyan ${m.latencyMs} ms (sapma ±${m.madMs} ms)`;
    status(`Kayıt gecikmesi ${m.latencyMs} ms olarak kaydedildi.`);
  },
};

// ---------------------------------------------------------------- dosya yükleme + hizalama
async function loadAudioFile(file) {
  await busy('Dosya çözülüyor…', async () => {
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    setAudio(mono, buf.sampleRate, file.name, 'file');
    S.proj.audio.alignMode = $('#inAlign').value;
    applyAlign();
    syncInputs();
  });
  await analyze();
}
function applyAlign() {
  const mode = S.proj.audio.alignMode;
  // öncü (pickup) hizalaması kayıt için de geçerli; diğerleri yalnızca yüklenen dosyada
  if (!S.audio || (S.proj.audio.source !== 'file' && mode !== 'pickup')) return;
  if (mode === 'none') return;
  if (S.onset == null) S.onset = C.firstOnset(S.audio.data, S.audio.sr);
  const g = C.makeGrid(S.proj.settings);
  if (mode === 'pickup') {
    // ilk ses 1. ölçünün N. vuruşuna: zaman çizelgesinde t = (N−1)·vuruş; ofset negatif olabilir (önüne sessizlik)
    const beats = Math.round(g.barQ / g.pulseQ), nb = C.clamp(S.proj.audio.pickupBeat || 1, 1, beats);
    // kayıtta gecikme telafisi ofsete ayrıca eklenir (effectiveOffset); burada çıkar ki iki kez sayılmasın
    const lat = S.proj.audio.source === 'record' ? (S.proj.settings.latencyMs || 0) / 1000 : 0;
    S.proj.audio.offsetSec = S.onset - (nb - 1) * g.pulseSec - lat;
    return;
  }
  S.proj.audio.offsetSec = mode === 'bar1' ? S.onset : S.onset - Math.round(S.onset / g.pulseSec) * g.pulseSec;
}

// ---------------------------------------------------------------- zaman çizelgesi
const TL = { KW: 46, RULER: 22, SEC: 26, CHORD: 36 };
TL.TOP = TL.RULER + TL.SEC + TL.CHORD;
const cv = $('#tl'), sc = $('#tlScroll');
const ctx2d = cv.getContext('2d');
const grid = () => (S.d ? S.d.g : C.makeGrid(S.proj.settings));
const totalQ = () => (S.d ? S.d.bars : 8) * grid().barQ;
const qToX = (q) => TL.KW + q * S.view.pxPerQ - sc.scrollLeft;
const xToQ = (x) => (x - TL.KW + sc.scrollLeft) / S.view.pxPerQ;
function layoutTimeline() {
  $('#tlInner').style.width = TL.KW + totalQ() * S.view.pxPerQ + 80 + 'px';
  resizeCanvas();
}
function resizeCanvas() {
  const w = sc.clientWidth, h = sc.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  }
}
function pitchRange() {
  let lo = Infinity, hi = -Infinity;
  if (S.d) for (const n of S.d.notes) { lo = Math.min(lo, n.effMidi, n.median); hi = Math.max(hi, n.effMidi, n.median); }
  if (!Number.isFinite(lo)) { lo = 55; hi = 74; }
  lo = Math.floor(lo) - 3; hi = Math.ceil(hi) + 3;
  if (hi - lo < 18) { const c = (lo + hi) / 2; lo = Math.floor(c - 9); hi = lo + 18; }
  return { lo, hi };
}
function rollGeom() {
  // nota sürüklenirken ölçek donar: aralık genişleyip satırlar küçülürse nota imleçten kaçardı
  if (S.drag && S.drag.type === 'note' && S.drag.geo) return S.drag.geo;
  const H = sc.clientHeight, { lo, hi } = pitchRange();
  const rowH = (H - TL.TOP) / (hi - lo + 1);
  return { lo, hi, rowH, yOf: (m) => TL.TOP + (hi - m + 0.5) * rowH, mOf: (y) => hi + 0.5 - (y - TL.TOP) / rowH };
}
const SEC_COLORS = ['#3d7be0', '#b560d4', '#2fa37a', '#d9823b', '#c94f6d', '#5c6bc0'];
const isBlack = (m) => [1, 3, 6, 8, 10].includes(C.mod12(m));

function draw() {
  resizeCanvas();
  const dpr = window.devicePixelRatio || 1, W = sc.clientWidth, H = sc.clientHeight;
  const c = ctx2d;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#101217'; c.fillRect(0, 0, W, H);
  const g = grid(), d = S.d, rg = rollGeom();
  const q0v = xToQ(TL.KW), q1v = xToQ(W);
  const pq = S.view.pxPerQ;
  const selSet = new Set(selNoteIds());
  // arka plan satırları
  for (let m = rg.lo; m <= rg.hi; m++) {
    c.fillStyle = isBlack(m) ? '#0d0f13' : '#12151b';
    c.fillRect(TL.KW, rg.yOf(m) - rg.rowH / 2, W, rg.rowH);
  }
  // bölüm scale şeritleri
  if (d) {
    for (const s of d.sections) {
      if (!s.pcs) continue;
      const x0 = Math.max(TL.KW, qToX((s.startBar - 1) * g.barQ)), x1 = Math.min(W, qToX(s.endBar * g.barQ));
      if (x1 <= x0) continue;
      for (let m = rg.lo; m <= rg.hi; m++) {
        const pc = C.mod12(m);
        if (!s.pcs.includes(pc)) continue;
        c.fillStyle = pc === s.tonic ? 'rgba(106,167,255,0.24)' : 'rgba(106,167,255,0.12)';
        c.fillRect(x0, rg.yOf(m) - rg.rowH / 2 + 0.5, x1 - x0, rg.rowH - 1);
      }
    }
  }
  // grid çizgileri
  const barQ = g.barQ, sub = pq * g.clickQ >= 10 ? g.clickQ : g.pulseQ;
  for (let q = Math.floor(q0v / sub) * sub; q <= q1v; q += sub) {
    const x = Math.round(qToX(C.swingMap(q, g, swingR(), 0.5))) + 0.5; // zayıf sekizlikler swing oranına kayar
    if (x < TL.KW) continue;
    const isBar = Math.abs(q / barQ - Math.round(q / barQ)) < 1e-6;
    const isPulse = Math.abs(q / g.pulseQ - Math.round(q / g.pulseQ)) < 1e-6;
    c.strokeStyle = isBar ? '#3a4152' : isPulse ? '#232834' : '#1a1e27';
    c.beginPath(); c.moveTo(x, isBar ? 0 : TL.RULER); c.lineTo(x, H); c.stroke();
  }
  // üçleme modu (12/8 hissi): her vuruşun üçte biri (ince çizgi); swing / üçlemede zayıf sekizlik oranına kayık
  if (swingMode() === 'triplet' && g.pulseQ === 1 && pq >= 20) {
    c.strokeStyle = '#1d2230';
    for (let k = Math.max(0, Math.floor(q0v)); k <= q1v; k++) { const x = Math.round(qToX(k + 1 / 3)) + 0.5; if (x >= TL.KW) { c.beginPath(); c.moveTo(x, TL.RULER); c.lineTo(x, H); c.stroke(); } }
  }
  // cetvel
  c.fillStyle = '#181b22'; c.fillRect(TL.KW, 0, W, TL.RULER);
  c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle';
  for (let b = Math.max(0, Math.floor(q0v / barQ)); b * barQ <= q1v; b++) {
    const x = qToX(b * barQ);
    if (x < TL.KW - 1) continue;
    c.fillStyle = '#9aa2b4'; c.fillText(String(b + 1), x + 4, TL.RULER / 2);
  }
  // döngü bölgesi (🔁): cetvelde yeşil bant
  if (S.loop.on && S.loop.to > S.loop.from) {
    const lx0 = Math.max(TL.KW, qToX(S.loop.from / g.spq)), lx1 = Math.min(W, qToX(S.loop.to / g.spq));
    if (lx1 > lx0) { c.fillStyle = 'rgba(95,208,138,0.22)'; c.fillRect(lx0, 0, lx1 - lx0, TL.RULER); c.strokeStyle = 'rgba(95,208,138,0.7)'; c.beginPath(); c.moveTo(lx0 + 0.5, 0); c.lineTo(lx0 + 0.5, H); c.moveTo(lx1 - 0.5, 0); c.lineTo(lx1 - 0.5, H); c.stroke(); }
  }
  // akor değişim noktaları (tap): cetvelde ◆, akor satırında ince çizgi
  if (d && S.proj.taps && S.proj.taps.length) {
    for (const t of S.proj.taps) {
      const x = Math.round(qToX((t - d.off) / g.spq)) + 0.5;
      if (x < TL.KW || x > W) continue;
      c.strokeStyle = 'rgba(255,209,102,0.8)'; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(x, TL.RULER); c.lineTo(x, TL.TOP); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#ffd166'; c.beginPath(); c.moveTo(x, 3); c.lineTo(x + 5, TL.RULER / 2); c.lineTo(x, TL.RULER - 3); c.lineTo(x - 5, TL.RULER / 2); c.fill();
    }
  }
  // giriş ölçüsü bayrakları: 🎹 akor ve 🥁 davul hangi ölçüden girer (sürükleyerek taşınır); o ölçü o çalgı için 1. ölçüdür
  if (d) {
    const st = curStarts();
    for (const [which, bar, col] of [['chord', st.cs, '#ff9f43'], ['drum', st.ds, '#35c4b0']]) {
      if (bar <= 1) continue;
      const x = Math.round(qToX((bar - 1) * barQ)) + 0.5;
      if (x < TL.KW || x > W) continue;
      c.strokeStyle = col; c.globalAlpha = 0.8; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(x, which === 'chord' ? TL.RULER : TL.RULER + TL.SEC + TL.CHORD); c.lineTo(x, H); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    }
    for (const f of startFlags()) {
      c.fillStyle = f.color; roundRect(c, f.x, f.y, f.w, f.h, 4); c.fill();
      c.fillStyle = '#0b0d12'; c.font = '11px system-ui, sans-serif'; c.fillText(f.label, f.x + 3, f.y + f.h / 2 + 0.5);
    }
  }
  // bölüm şeridi
  const secY = TL.RULER;
  c.fillStyle = '#15181f'; c.fillRect(TL.KW, secY, W, TL.SEC);
  if (d) {
    d.sections.forEach((s, i) => {
      const x0 = qToX((s.startBar - 1) * barQ), x1 = qToX(s.endBar * barQ);
      if (x1 < TL.KW || x0 > W) return;
      const col = s.implicit ? '#2a2f3b' : SEC_COLORS[i % SEC_COLORS.length];
      c.fillStyle = col; c.globalAlpha = s.implicit ? 1 : 0.85;
      roundRect(c, x0 + 1, secY + 3, x1 - x0 - 2, TL.SEC - 6, 4); c.fill();
      c.globalAlpha = 1;
      if (S.sel && S.sel.type === 'section' && S.sel.id === s.id) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; roundRect(c, x0 + 1, secY + 3, x1 - x0 - 2, TL.SEC - 6, 4); c.stroke(); c.lineWidth = 1; }
      c.save(); c.beginPath(); c.rect(Math.max(TL.KW, x0), secY, x1 - Math.max(TL.KW, x0) - 4, TL.SEC); c.clip();
      c.fillStyle = '#fff';
      c.font = (s.provisional ? 'italic ' : '') + '12px system-ui, sans-serif';
      const key = s.tonic != null ? ' · ' + C.keyName(s.tonic, s.mode) + (s.provisional ? ' (öneri)' : '') : '';
      c.fillText((s.implicit ? 'Bölüm yok — tüm şarkı' : s.name) + key, Math.max(TL.KW, x0) + 6, secY + TL.SEC / 2);
      c.restore();
    });
  }
  if (S.drag && S.drag.type === 'newSection') {
    const a = Math.min(S.drag.b0, S.drag.b1), b = Math.max(S.drag.b0, S.drag.b1);
    const x0 = qToX((a - 1) * barQ), x1 = qToX(b * barQ);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x0, secY + 2, x1 - x0, TL.SEC - 4);
    c.fillStyle = '#fff'; c.fillText(`ölçü ${a}–${b}`, x0 + 6, secY + TL.SEC / 2);
  }
  // akor şeridi
  const chY = TL.RULER + TL.SEC;
  c.fillStyle = '#171a21'; c.fillRect(TL.KW, chY, W, TL.CHORD);
  if (d) {
    for (const s of d.chords) {
      const x0 = qToX(s.q0), x1 = qToX(s.q1);
      if (x1 < TL.KW || x0 > W) continue;
      const sel = S.sel && S.sel.type === 'chord' && S.sel.q >= s.q0 - 1e-6 && S.sel.q < s.q1 - 1e-6;
      c.fillStyle = sel ? '#2b3a57' : s.locked ? '#2f2a18' : '#1f2430';
      roundRect(c, x0 + 1, chY + 3, x1 - x0 - 2, TL.CHORD - 6, 5); c.fill();
      c.strokeStyle = sel ? '#6aa7ff' : s.locked ? '#f4d35e' : '#323746';
      roundRect(c, x0 + 1.5, chY + 3.5, x1 - x0 - 3, TL.CHORD - 7, 5); c.stroke();
      c.save(); c.beginPath(); c.rect(Math.max(TL.KW, x0), chY, x1 - Math.max(TL.KW, x0) - 3, TL.CHORD); c.clip();
      const disp = Object.assign({}, s.chord, { bass: s.chord.bass ?? (s.inversion ? s.voicing.bassPc : null) });
      c.fillStyle = '#fff'; c.font = '600 14px system-ui, sans-serif';
      const warnLock = s.locked && s.lockAdvice && s.lockAdvice.some((a) => a.important);
      c.fillText((s.locked ? (s.lockSrc === 'chart' ? '📄 ' : '🔒 ') : '') + (warnLock ? '⚠ ' : '') + C.chordName(disp, s.flats), Math.max(TL.KW, x0) + 7, chY + TL.CHORD / 2);
      if (s.pinSuggest) { // motorun önerisi (uygulanmadı): turuncu "→ akor"
        c.font = '600 10px system-ui, sans-serif'; c.fillStyle = s.pinSuggest.important ? '#ff8a8f' : '#ffb454';
        c.fillText((s.pinSuggest.important ? '⚠→' : '→') + C.chordName(s.pinSuggest.chord, s.flats), Math.max(TL.KW, x0) + 7, chY + TL.CHORD - 7);
      } else if (s.suggest) { c.font = '10px system-ui, sans-serif'; c.fillStyle = '#ffb454'; c.fillText(C.chordName(s.suggest, s.flats) + '?', x1 - 44, chY + TL.CHORD - 9); }
      c.restore();
      if (s.locked && x1 - x0 > 30) { // kilidi kaldırma düğmesi
        c.fillStyle = '#d9545b'; roundRect(c, x1 - 24, chY + 7, 19, 19, 4); c.fill();
        c.fillStyle = '#fff'; c.font = '700 13px system-ui, sans-serif'; c.fillText('✕', x1 - 19, chY + 17);
      }
    }
  }
  // akorların girdiği ilk ölçüden önce: "akor yok" (soluk) + giriş çizgisi
  if (d) {
    const cs = curStarts().cs;
    if (cs > 1) {
      const xe = Math.min(W, qToX((cs - 1) * barQ));
      if (xe > TL.KW) {
        c.fillStyle = 'rgba(8,10,14,0.72)'; c.fillRect(TL.KW, chY, xe - TL.KW, TL.CHORD);
        c.fillStyle = '#8a93a6'; c.font = '11px system-ui, sans-serif'; c.fillText(`ölçü 1–${cs - 1}: akor yok`, TL.KW + 8, chY + TL.CHORD / 2);
        c.strokeStyle = '#ff9f43'; c.lineWidth = 2; c.beginPath(); c.moveTo(Math.round(xe) + 0.5, chY); c.lineTo(Math.round(xe) + 0.5, chY + TL.CHORD); c.stroke(); c.lineWidth = 1;
      }
    }
  }
  // yarım ölçü ve vuruşlar (akor satırında) + değişim işaretleri
  if (d) {
    const per = g.split ? 2 : 1;
    for (let b = Math.max(0, Math.floor(q0v / barQ)); b * barQ <= q1v; b++) {
      for (let k = 0; k * g.pulseQ < barQ - 1e-6; k++) { // vuruş çentikleri
        const x = Math.round(qToX(b * barQ + k * g.pulseQ)) + 0.5;
        if (x < TL.KW) continue;
        c.strokeStyle = k === 0 ? '#7d879c' : '#4a5263'; c.beginPath(); c.moveTo(x, chY + TL.CHORD - (k === 0 ? 7 : 4)); c.lineTo(x, chY + TL.CHORD); c.stroke();
      }
      if (per === 2) { // ölçü ortası: kesikli çizgi
        const x = Math.round(qToX(b * barQ + g.split)) + 0.5;
        if (x >= TL.KW) { c.setLineDash([3, 3]); c.strokeStyle = 'rgba(200,210,230,0.35)'; c.beginPath(); c.moveTo(x, chY + 2); c.lineTo(x, chY + TL.CHORD - 2); c.stroke(); c.setLineDash([]); }
      }
    }
    // tıklanabilir değişim noktaları: üst şeritte küçük tutamaçlar (ölçü başı dolu, ölçü ortası içi boş)
    for (let k = Math.max(1, Math.floor(q0v / (barQ / per))); k * (barQ / per) <= q1v; k++) {
      const x = qToX((k * barQ) / per);
      if (x < TL.KW + 2) continue;
      c.beginPath(); c.arc(x, chY + 5, k % per ? 2.5 : 3, 0, Math.PI * 2);
      if (k % per) { c.strokeStyle = '#8a93a6'; c.stroke(); } else { c.fillStyle = '#8a93a6'; c.fill(); }
    }
    const qOf = (bar, half) => (bar - 1) * barQ + (per === 2 ? (half || 0) * g.split : 0);
    for (const m of S.proj.changeMarks || []) {
      const x = Math.round(qToX(qOf(m.bar, m.half))) + 0.5;
      if (x < TL.KW || x > W) continue;
      if (m.kind === 'change') {
        c.strokeStyle = '#ff9f43'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, chY); c.lineTo(x, chY + TL.CHORD); c.stroke(); c.lineWidth = 1;
        c.fillStyle = '#ff9f43'; c.beginPath(); c.moveTo(x - 6, chY); c.lineTo(x + 6, chY); c.lineTo(x, chY + 7); c.fill();
      } else {
        c.fillStyle = '#3a4152'; roundRect(c, x - 8, chY + TL.CHORD / 2 - 8, 16, 16, 4); c.fill();
        c.fillStyle = '#b8c2d6'; c.font = '700 13px system-ui, sans-serif'; c.fillText('=', x - 4, chY + TL.CHORD / 2);
      }
    }
    if (S.hoverMark) {
      const x = S.hoverMark.x;
      const m = markAt(S.hoverMark.bar, S.hoverMark.half);
      c.strokeStyle = 'rgba(255,159,67,0.9)'; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(x, chY); c.lineTo(x, chY + TL.CHORD); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(11,13,18,0.9)'; roundRect(c, x - 9, chY + 1, 18, 14, 3); c.fill();
      c.fillStyle = '#ff9f43'; c.font = '700 11px system-ui, sans-serif'; c.fillText(!m ? '+' : m.kind === 'change' ? '=' : '✕', x - 4, chY + 8);
    }
  }
  // notalar
  if (d) {
    const ns = d.notes;
    c.font = '11px system-ui, sans-serif';
    for (const n of ns) {
      const x0 = qToX(n.q0), x1 = qToX(n.q1);
      if (x1 < TL.KW || x0 > W) continue;
      const y = rg.yOf(n.effMidi), h = Math.max(4, rg.rowH - 2);
      // ses düzeltmesiyle yeri değişen notanın orijinal yeri (hayalet)
      const timeMoved = Math.abs(n.q0 - n.qOrig) > 1e-3;
      if (n.nearest !== n.effMidi || n.label != null || timeMoved) {
        const gx0 = timeMoved ? qToX(n.qOrig) : x0, gx1 = gx0 + (x1 - x0);
        c.setLineDash([3, 3]); c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.strokeRect(gx0 + 0.5, rg.yOf(n.nearest) - h / 2 + 0.5, gx1 - gx0 - 1, h - 1);
        c.setLineDash([]);
      }
      c.fillStyle = n.inScale ? '#5b9dff' : '#ff8a4c';
      c.globalAlpha = 0.85;
      roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.fill();
      c.globalAlpha = 1;
      const selN = selSet.has(n.id);
      if (n.modeSuspect && !selN) { // tam tonunda scale dışı: mod yanlış olabilir
        c.lineWidth = 2; c.strokeStyle = '#c792ea'; c.setLineDash([2, 2]);
        roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.stroke();
        c.setLineDash([]); c.lineWidth = 1;
      }
      const moved = n.manualTarget != null;
      if (selN || n.locked || n.label != null) {
        c.lineWidth = selN ? 2 : 1.5;
        c.strokeStyle = selN ? '#fff' : moved ? '#5fd08a' : n.locked ? '#f4d35e' : '#ffb454';
        if (n.label != null && !selN) c.setLineDash([4, 2]);
        roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.stroke();
        c.setLineDash([]); c.lineWidth = 1;
      }
      if (x1 - x0 > 34 && h >= 10) {
        c.fillStyle = '#0b0d12';
        let t = C.noteName(n.effMidi, false);
        if ((moved && n.label != null && n.label !== n.nearest) || n.autoMoved) t = `${C.noteName(n.nearest, false)}→${t}`;
        else if (moved) { const mc = Math.round((n.manualTarget - Math.round(n.manualTarget)) * 100); t += mc ? ` ${mc > 0 ? '+' : ''}${mc}c` : ' ✓'; }
        else if (x1 - x0 > 70) t += ` ${n.cents > 0 ? '+' : ''}${n.cents}c`;
        if (n.locked) t = '🔒' + t;
        if (n.modeSuspect) t = '? ' + t;
        c.save(); c.beginPath(); c.rect(x0, y - h / 2, x1 - x0 - 2, h); c.clip();
        c.fillText(t, x0 + 4, y + 0.5);
        c.restore();
      }
    }
    // sürüklerken canlı ipucu: ne olacağı (taşı / ince akort / etiket)
    if (S.drag && S.drag.type === 'note' && S.drag.moved && S.drag.tip) {
      const n = ns.find((k) => k.id === S.drag.id);
      if (n) {
        c.font = '600 12px system-ui, sans-serif';
        const tw = c.measureText(S.drag.tip).width + 14, tx = Math.max(TL.KW + 4, Math.min(W - tw - 4, qToX(n.q0))), ty = Math.max(TL.TOP + 4, rg.yOf(n.effMidi) - rg.rowH / 2 - 28);
        c.fillStyle = 'rgba(11,13,18,0.92)'; roundRect(c, tx, ty, tw, 22, 5); c.fill();
        c.strokeStyle = S.drag.mode === 'label' ? '#ffb454' : '#5fd08a'; roundRect(c, tx + 0.5, ty + 0.5, tw - 1, 21, 5); c.stroke();
        c.fillStyle = '#fff'; c.fillText(S.drag.tip, tx + 7, ty + 12);
      }
    }
    // dikdörtgenle seçim
    if (S.drag && S.drag.type === 'marquee' && S.drag.moved) {
      const mx = Math.min(S.drag.x0, S.drag.x1), my = Math.min(S.drag.y0, S.drag.y1), mw = Math.abs(S.drag.x1 - S.drag.x0), mh = Math.abs(S.drag.y1 - S.drag.y0);
      c.fillStyle = 'rgba(106,167,255,0.14)'; c.fillRect(mx, my, mw, mh);
      c.strokeStyle = '#6aa7ff'; c.setLineDash([4, 3]); c.strokeRect(mx + 0.5, my + 0.5, mw, mh); c.setLineDash([]);
    }
    // ham ve düzeltilmiş perde eğrileri
    if (S.track) {
      const tr = S.track, hop = tr.hopSec, off = d.off, spq = g.spq;
      const tm = d.timeMap || C.identityMap();
      const f0s = Math.max(0, Math.floor(tm.inv((q0v * spq) + off) / hop) - 40), f1s = Math.min(tr.f0.length, Math.ceil(tm.inv((q1v * spq) + off) / hop) + 40);
      const sh = d.correction ? d.correction.shift : null;
      const curve = (withShift, color, width) => {
        c.strokeStyle = color; c.lineWidth = width; c.beginPath();
        let pen = false;
        for (let f = f0s; f < f1s; f++) {
          const on = tr.f0[f] > 0 && (!withShift || (sh && Math.abs(sh[f]) > 0.5));
          if (!on) { pen = false; continue; }
          const m = C.hzToMidi(tr.f0[f]) + (withShift ? sh[f] / 100 : 0);
          const x = qToX((tm.fwd(f * hop) - off) / spq), y = rg.yOf(m);
          if (!pen) { c.moveTo(x, y); pen = true; } else c.lineTo(x, y);
        }
        c.stroke(); c.lineWidth = 1;
      };
      curve(false, 'rgba(232,236,245,0.75)', 1);
      if (sh) curve(true, '#5fd08a', 1.5);
    }
  }
  // klavye
  c.fillStyle = '#0c0e12'; c.fillRect(0, 0, TL.KW, H);
  for (let m = rg.lo; m <= rg.hi; m++) {
    const y = rg.yOf(m) - rg.rowH / 2;
    c.fillStyle = m === S.keyDown ? '#ff9f43' : isBlack(m) ? '#22252c' : '#d8dbe2';
    c.fillRect(0, y + 0.5, isBlack(m) ? TL.KW * 0.62 : TL.KW - 2, rg.rowH - 1);
    if (C.mod12(m) === 0 && rg.rowH >= 8) { c.fillStyle = '#20242c'; c.font = '10px system-ui, sans-serif'; c.fillText('C' + (m / 12 - 1), TL.KW - 22, y + rg.rowH / 2); }
  }
  c.fillStyle = '#0c0e12'; c.fillRect(0, 0, TL.KW, TL.TOP);
  c.fillStyle = '#9aa2b4'; c.font = '10px system-ui, sans-serif';
  c.fillText('ölçü', 6, TL.RULER / 2); c.fillText('bölüm', 6, TL.RULER + TL.SEC / 2); c.fillText('akor', 6, TL.RULER + TL.SEC + TL.CHORD / 2);
  // imleç
  const px = qToX(S.pos / g.spq);
  if (px >= TL.KW && px <= W) { c.strokeStyle = '#ff5a5f'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.stroke(); c.lineWidth = 1; }
}
function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// ---------------------------------------------------------------- akor ve davulun girdiği ilk ölçü (bayraklar)
function curStarts() {
  const dr = S.drag && S.drag.type === 'startFlag' ? S.drag : null;
  return { cs: dr && dr.which === 'chord' ? dr.bar : S.proj.chordStartBar || 1, ds: dr && dr.which === 'drum' ? dr.bar : S.proj.drums.startBar || 1 };
}
// cetvelde ölçü numarasının sağında küçük sekmeler; aynı ölçüdeyse yan yana
function startFlags() {
  if (!S.d) return [];
  const g = S.d.g, st = curStarts(), bx = (b) => qToX((b - 1) * g.barQ);
  return [
    { which: 'chord', bar: st.cs, x: bx(st.cs) + 24, label: '🎹', color: '#ff9f43' },
    { which: 'drum', bar: st.ds, x: bx(st.ds) + 24 + (st.ds === st.cs ? 28 : 0), label: '🥁', color: '#35c4b0' },
  ].map((f) => Object.assign(f, { y: 3, w: 25, h: TL.RULER - 6 }));
}
const startFlagAt = (x, y) => startFlags().find((f) => x >= f.x && x <= f.x + f.w && y >= f.y - 1 && y <= f.y + f.h + 1) || null;
// ---------------------------------------------------------------- fare etkileşimi
// akor satırının üst şeridinde (12 px) ölçü başı / ölçü ortası noktasına yakın mı (±8 px)
const MARK_BAND = 12;
function boundaryAt(x, y) {
  if (!S.d || y < TL.RULER + TL.SEC || y > TL.RULER + TL.SEC + MARK_BAND) return null;
  const g = S.d.g, per = g.split ? 2 : 1, step = g.barQ / per;
  const q = xToQ(x), k = Math.round(q / step);
  if (k <= 0 || Math.abs(qToX(k * step) - x) > 8) return null;
  const bar = Math.floor(k / per) + 1, half = k % per;
  const sec = S.d.sections.find((s) => !s.implicit && bar >= s.startBar && bar <= s.endBar) || S.d.sections.find((s) => s.implicit);
  if (!sec || (bar === sec.startBar && half === 0) || bar > S.d.bars) return null; // bölüm başı her zaman değişim noktası
  return { bar, half, x: qToX(k * step) };
}
// klavyedeki tuşa basınca nota çalar (piyano)
async function playKey(m) {
  S.keyDown = m; draw();
  clearTimeout(S.keyTimer); S.keyTimer = setTimeout(() => { S.keyDown = null; draw(); }, 350);
  try { await Player.ensure(); } catch (e) { status(e.message, 'err'); return; }
  Player.sampler.triggerAttackRelease(Tone.Frequency(m, 'midi').toNote(), 0.9, Tone.now() + 0.01, 0.7);
  Player.keyHits = (Player.keyHits || 0) + 1;
  status(`♪ ${C.noteName(m, false)}`);
}
function noteAt(x, y) {
  if (!S.d) return null;
  const rg = rollGeom();
  const h = Math.max(6, rg.rowH);
  let best = null;
  for (const n of S.d.notes) {
    const x0 = qToX(n.q0), x1 = qToX(n.q1), yc = rg.yOf(n.effMidi);
    if (x >= x0 - 2 && x <= x1 + 2 && Math.abs(y - yc) <= h / 2 + 2) best = n;
  }
  return best;
}
const sectionAtBar = (bar) => S.proj.sections.find((s) => bar >= s.startBar && bar <= s.endBar);
function editFor(n, create) {
  let e = C.findEdit(S.proj.noteEdits, n);
  if (!e && create) { e = { t0: n.t0, t1: n.t1 }; S.proj.noteEdits.push(e); }
  return e;
}
function cleanupEdits() {
  S.proj.noteEdits = S.proj.noteEdits.filter((e) => e.label != null || e.target != null || e.locked || e.q0to != null);
}
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < TL.KW) { if (y > TL.TOP && S.d) playKey(Math.round(rollGeom().mOf(y))); return; }
  const g = grid(), q = xToQ(x);
  if (y < TL.RULER) {
    const fl = startFlagAt(x, y);
    if (fl) { S.drag = { type: 'startFlag', which: fl.which, bar: fl.bar, moved: false }; cv.setPointerCapture(e.pointerId); return; }
    const ti = tapAt(x);
    if (ti >= 0) {
      if (e.altKey) { S.proj.taps.splice(ti, 1); refresh(); status('Değişim noktası silindi.'); return; }
      S.drag = { type: 'tap', i: ti, x0: x, t0: S.proj.taps[ti] }; cv.setPointerCapture(e.pointerId); return;
    }
    seek(Math.max(0, q) * g.spq); return;
  }
  if (y < TL.RULER + TL.SEC) {
    const bar = Math.max(1, Math.floor(q / g.barQ) + 1);
    const s = sectionAtBar(bar);
    if (s) { select({ type: 'section', id: s.id }); return; }
    S.drag = { type: 'newSection', b0: bar, b1: bar, x0: x, moved: false };
    cv.setPointerCapture(e.pointerId); draw(); return;
  }
  if (y < TL.TOP) {
    // ölçü başı / ortası noktası: değişim işaretini döndür (yok → ✂ değiş → = değişme → yok)
    const bd = boundaryAt(x, y);
    if (bd) { cycleMark(bd.bar, bd.half); return; }
    const slot = S.d && S.d.chords.find((s) => q >= s.q0 && q < s.q1);
    if (!slot) return;
    // kilitli akorun sağ üstündeki ✕: kilidi doğrudan kaldır
    if (slot.locked && x >= qToX(slot.q1) - 26 && x <= qToX(slot.q1) - 6) { unlockSlot(slot); return; }
    select({ type: 'chord', q: (slot.q0 + slot.q1) / 2 });
    Player.audition(slot.chord, slot.section, slot.q0, slot.q1); // tıklayınca duyulur
    return;
  }
  const n = noteAt(x, y);
  if (!n) {
    // boş yerde sürükle: dikdörtgenle seçim (Shift/Ctrl/⌘: seçime ekle); sürüklemeden tıklamak seçimi temizler
    S.drag = { type: 'marquee', x0: x, y0: y, x1: x, y1: y, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey, base: selNoteIds() };
    cv.setPointerCapture(e.pointerId);
    return;
  }
  if (e.ctrlKey || e.metaKey) { // Ctrl/⌘+tık: nota seçime eklenir / seçimden çıkar (sürükleme başlamaz)
    const ids = selNoteIds();
    selectNotes(ids.includes(n.id) ? ids.filter((i) => i !== n.id) : [...ids, n.id]);
    return;
  }
  // seçili grubun içindeki bir notayı sürüklemek bütün grubu taşır; sürüklemeden bırakılırsa yalnızca o not seçilir
  const ids0 = selNoteIds(), inGroup = ids0.length > 1 && ids0.includes(n.id);
  const mode = e.altKey ? 'label' : S.editMode; // Alt + sürükle: her modda yalnızca etiket (ses aynı kalır)
  if (!inGroup || mode === 'select') select({ type: 'note', id: n.id });
  NotePreview.play(n, NotePreview.current(n)); // tıklayınca duyulur
  if (mode !== 'select') {
    const items = (inGroup ? ids0 : [n.id]).map((id) => {
      const k = S.d.notes.find((z) => z.id === id), ed0 = editFor(k);
      return { id, baseQ: k.q0, baseRow: k.effMidi, baseSound: k.manualTarget ?? k.soundMidi ?? k.median,
        prev: ed0 ? { target: ed0.target ?? null, label: ed0.label ?? null, locked: !!ed0.locked, q0to: ed0.q0to ?? null } : { target: null, label: null, locked: false, q0to: null } };
    });
    S.drag = { type: 'note', id: n.id, items, collapse: inGroup, y0: y, x0: x, axis: null, baseQ: n.q0, mode, geo: rollGeom(), heard: Math.round(n.effMidi), baseRow: n.effMidi, baseSound: n.manualTarget ?? n.soundMidi ?? n.median, orig: C.noteName(n.effMidi, false), moved: false };
    cv.setPointerCapture(e.pointerId);
  }
});
cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!S.drag) {
    if (x < TL.KW && y > TL.TOP) { cv.style.cursor = 'pointer'; cv.title = 'Tuşa bas: notayı duy'; return; }
    const ti = y < TL.RULER ? tapAt(x) : -1;
    if (ti >= 0) { cv.style.cursor = 'ew-resize'; cv.title = 'Değişim noktası (tap): sürükle = kaydır · Alt+tık = sil'; return; }
    const hb = boundaryAt(x, y);
    if (JSON.stringify(hb) !== JSON.stringify(S.hoverMark)) { S.hoverMark = hb; draw(); }
    if (hb) {
      const m = markAt(hb.bar, hb.half);
      cv.style.cursor = 'pointer';
      cv.title = `Ölçü ${hb.bar}${hb.half ? ' ortası' : ' başı'} — tıkla: ${!m ? '✂ burada akor değişsin' : m.kind === 'change' ? '= burada değişmesin' : 'işareti kaldır'}`;
      return;
    }
    const over = y > TL.TOP && noteAt(x, y);
    cv.style.cursor = over && (S.editMode !== 'select' || e.altKey) ? 'move' : over ? 'pointer' : y < TL.TOP && y > TL.RULER ? 'pointer' : 'default';
    cv.title = over ? 'Yukarı/aşağı sürükle: notayı taşı · sağa/sola sürükle: zamanı kaydır (ızgaraya yapışır; Ctrl/⌘ serbest) · Shift: cent ince ayar · Alt: yalnızca etiket · çift tık: notayı ikiye böl · Ctrl/⌘+tık: seçime ekle' : y > TL.TOP && x > TL.KW ? 'Boş yerde sürükle: birçok notayı seç (sonra birini sürükleyince hepsi birlikte taşınır)' : '';
    const fl = y < TL.RULER ? startFlagAt(x, y) : null;
    if (fl) { cv.style.cursor = 'ew-resize'; cv.title = fl.which === 'chord' ? '🎹 Akorların girdiği ilk ölçü — sürükle (ölçüye yapışır). Bu ölçü akorlar için 1. ölçü sayılır.' : '🥁 Davulun girdiği ilk ölçü — sürükle (ölçüye yapışır). Loop bu ölçüden başlar.'; return; }
    return;
  }
  const g = grid();
  if (S.drag.type === 'marquee') {
    S.drag.x1 = x; S.drag.y1 = Math.max(TL.TOP, y);
    if (Math.abs(x - S.drag.x0) > 4 || Math.abs(y - S.drag.y0) > 4) S.drag.moved = true;
    draw(); return;
  }
  if (S.drag.type === 'startFlag') {
    S.drag.bar = C.clamp(Math.floor(xToQ(x) / g.barQ) + 1, 1, S.d ? S.d.bars : 1);
    S.drag.moved = true; draw(); return;
  }
  if (S.drag.type === 'tap') {
    S.proj.taps[S.drag.i] = Math.max(0, S.drag.t0 + ((x - S.drag.x0) / S.view.pxPerQ) * g.spq);
    S.drag.moved = true; draw(); return;
  }
  if (S.drag.type === 'newSection') {
    if (Math.abs(x - S.drag.x0) >= 4) S.drag.moved = true;
    S.drag.b1 = Math.max(1, Math.floor(xToQ(x) / g.barQ) + 1);
    draw(); return;
  }
  if (S.drag.type === 'note') {
    const dy = S.drag.y0 - y, dx = x - S.drag.x0;
    if (!S.drag.moved && Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
    S.drag.moved = true;
    // eksen ilk harekete göre kilitlenir: yatay = zaman (sağa/sola), dikey = perde
    if (!S.drag.axis) S.drag.axis = Math.abs(dx) > Math.abs(dy) ? 'time' : 'pitch';
    const n = S.d.notes.find((k) => k.id === S.drag.id);
    if (!n) return;
    const items = S.drag.items, pre = items.length > 1 ? `${items.length} nota · ` : '';
    // seçili bütün notalara aynı hareket uygulanır (toplu taşıma); görünen ipucu ve duyulan nota sürüklenen nota için
    const each = (fn) => { for (const it of items) { const k = S.d.notes.find((z) => z.id === it.id); if (k) fn(it, k, editFor(k, true)); } };
    if (S.drag.axis === 'time') {
      const gq = quantGridQ();
      let q = S.drag.baseQ + dx / S.view.pxPerQ;
      const free = e.ctrlKey || e.metaKey;
      if (!free) q = snapGrid(q); // ızgaraya yapış (swing oranına uyar; Ctrl/⌘ ile serbest)
      const dq = q - S.drag.baseQ; // grupta notalar arası mesafe korunur
      each((it, k, ed) => { const qq = it.baseQ + dq; ed.q0to = Math.abs(qq - k.qOrig) < 1e-4 ? null : qq; });
      const mp = C.metricPos(q, g), ms = Math.round((q - n.qOrig) * g.spq * 1000);
      S.drag.tip = `${pre}Zaman: ölçü ${mp.bar + 1}, vuruş ${(mp.pos / g.pulseQ + 1).toFixed(2)} (${ms >= 0 ? '+' : ''}${ms} ms)${free ? ' · serbest' : ` · ızgara ${quantGridLabel()}`}`;
      refresh();
      return;
    }
    const semis = dy / rollGeom().rowH;
    const fine = S.drag.mode === 'sound' && e.shiftKey;
    each((it, k, ed) => {
      if (fine) {
        // ince akort: yalnızca cent, notanın kimliği değişmez (bir sonraki yarım sese geçemez)
        const lim = Math.round(it.baseSound);
        ed.target = Math.round(C.clamp(it.baseSound + semis * 0.25, lim - 0.49, lim + 0.49) * 100) / 100;
        ed.locked = true;
      } else if (S.drag.mode === 'sound') {
        // notayı taşı: ses yeni yarım sese kayar VE kastedilen nota o olur (akorlar onu kullanır)
        const R = Math.round(it.baseRow + semis);
        if (R === Math.round(it.baseRow)) Object.assign(ed, it.prev);
        else { ed.target = R; ed.locked = true; ed.label = R !== k.nearest ? R : null; }
      } else {
        const R = Math.round(it.baseRow + semis);
        ed.label = R !== k.nearest ? R : null;
      }
    });
    const ed = editFor(n, true);
    if (fine) {
      const c = Math.round((ed.target - Math.round(ed.target)) * 100);
      if (S.drag.heard == null || (Math.abs(ed.target - S.drag.heard) >= 0.05 && performance.now() - NotePreview.lastAt > 140)) { S.drag.heard = ed.target; NotePreview.play(n, (ed.target - n.median) * 100); }
      S.drag.tip = `${pre}İnce akort: ${C.noteName(Math.round(ed.target), false)} ${c >= 0 ? '+' : ''}${c} cent · nota aynı`;
    } else if (S.drag.mode === 'sound') {
      const R = Math.round(S.drag.baseRow + semis);
      if (S.drag.heard !== R) { S.drag.heard = R; NotePreview.play(n, R === Math.round(S.drag.baseRow) ? NotePreview.current(n) : (R - n.median) * 100); } // sürüklediğin yerde duyulur
      S.drag.tip = R === Math.round(S.drag.baseRow) ? `${pre}${S.drag.orig} — değişiklik yok` : `${pre}Taşı: ${S.drag.orig} → ${C.noteName(R, false)} · ses ve akorlar ${C.noteName(R, false)}`;
    } else {
      const R = Math.round(S.drag.baseRow + semis);
      if (S.drag.heard !== R) { S.drag.heard = R; NotePreview.play(n, NotePreview.current(n), R); } // ses aynı + etiket perdesinde kısık piyano
      S.drag.tip = R === Math.round(S.drag.baseRow) ? `${pre}${S.drag.orig} — değişiklik yok` : `${pre}Etiket: ${S.drag.orig} → ${C.noteName(R, false)} · ses aynı, akorlar ${C.noteName(R, false)}`;
    }
    refresh();
  }
});
cv.addEventListener('pointerup', () => {
  const dr = S.drag;
  S.drag = null;
  if (!dr) return;
  if (dr.type === 'tap') { S.proj.taps.sort((a, b) => a - b); refresh(); return; }
  if (dr.type === 'marquee') { finishMarquee(dr); return; }
  if (dr.type === 'startFlag') { if (dr.moved) setStartBar(dr.which, dr.bar); else draw(); return; }
  if (dr.type === 'newSection') {
    // tek tık bölüm açmaz (yanlışlıkla 1 ölçülük bölüm oluşuyordu); bölüm sürükleyerek açılır
    if (!dr.moved) status('Bölüm eklemek için bölüm şeridinde ölçüler boyunca sürükleyin (ya da 4. adımdaki "Ekle").');
    else addSection(null, Math.min(dr.b0, dr.b1), Math.max(dr.b0, dr.b1));
  } else if (dr.type === 'note' && dr.moved) {
    cleanupEdits(); refresh();
    if (dr.axis === 'time') { scheduleRender(true); if (dr.tip) status(dr.tip + ' · geri almak için notaya tıklayıp "✕ Zamanı geri al"'); draw(); return; }
    if (dr.tip) status(dr.tip.replace(' — değişiklik yok', ': değişiklik yok') + (dr.tip.includes('değişiklik yok') ? '' : ' · geri almak için notaya tıklayıp "✕ Geri al"'));
    if (dr.mode === 'sound') scheduleRender(true);
  } else if (dr.type === 'note' && dr.collapse) select({ type: 'note', id: dr.id }); // grup içindeki notaya sürüklemeden tıklandı
  draw();
});
cv.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, q = xToQ(x);
  setZoom(S.view.pxPerQ * (e.deltaY < 0 ? 1.15 : 1 / 1.15), q, x);
}, { passive: false });
function setZoom(z, anchorQ, anchorX) {
  S.view.pxPerQ = C.clamp(z, 12, 160);
  $('#inZoom').value = Math.round(S.view.pxPerQ);
  layoutTimeline();
  if (anchorQ != null) sc.scrollLeft = Math.max(0, TL.KW + anchorQ * S.view.pxPerQ - anchorX);
  draw();
}
sc.addEventListener('scroll', () => draw());
window.addEventListener('resize', () => { layoutTimeline(); draw(); });
function seek(sec) {
  const wasPlaying = Player.playing;
  if (wasPlaying) Player.stop(true);
  S.pos = sec;
  updateReadout(); draw();
  if (wasPlaying) Player.play();
}
function select(sel) {
  S.sel = sel; renderInspector(); renderSections(); draw();
  if (S.loop.on && sel && sel.type === 'section') { setLoopRegion(); if (Player.playing) Player.play(); } // döngü seçili bölümü izler
}

// ---------------------------------------------------------------- toplu seçim: dikdörtgen, toplu perde / zaman işlemleri
function finishMarquee(dr) {
  if (!dr.moved) { if (!dr.add) select(null); else draw(); return; }
  const rg = rollGeom(), h = Math.max(6, rg.rowH);
  const rx0 = Math.min(dr.x0, dr.x1), rx1 = Math.max(dr.x0, dr.x1), ry0 = Math.min(dr.y0, dr.y1), ry1 = Math.max(dr.y0, dr.y1);
  const hit = S.d.notes.filter((n) => {
    const a = qToX(n.q0), b = qToX(n.q1), yc = rg.yOf(n.effMidi);
    return b >= rx0 && a <= rx1 && yc + h / 2 >= ry0 && yc - h / 2 <= ry1;
  }).map((n) => n.id);
  selectNotes(dr.add ? [...dr.base, ...hit] : hit);
  const k = selNoteIds().length;
  if (k > 1) status(`${k} nota seçildi — birini sürükleyince hepsi birlikte taşınır (yukarı/aşağı = perde, sağa/sola = zaman) · ↑↓ ←→ tuşları · Esc seçimi kaldırır.`);
  else if (k === 1) status('1 nota seçildi.');
}
// bir grup işlemi: fn(n, ed) her seçili nota için; sonunda tek yenileme
function groupEdit(ns, fn) {
  for (const n of ns) fn(n, editFor(n, true));
  cleanupEdits(); refresh(); scheduleRender(true);
}
function groupMove(ns, dv) {
  groupEdit(ns, (n, ed) => { const R = n.effMidi + dv; ed.target = R; ed.locked = true; ed.label = R !== n.nearest ? R : null; });
  NotePreview.play(ns[0], (ns[0].effMidi + dv - ns[0].median) * 100);
  status(`${ns.length} nota ${Math.abs(dv) === 12 ? 'bir oktav' : Math.abs(dv) + ' yarım ses'} ${dv > 0 ? 'yukarı' : 'aşağı'} taşındı (ses ve akorlar). Geri almak için panelden "✕ Seçili notaların değişikliklerini kaldır".`);
}
function groupFine(ns, dv) {
  groupEdit(ns, (n, ed) => {
    const lim = Math.round(ed.target ?? n.manualTarget ?? n.nearest);
    ed.target = Math.round(C.clamp((ed.target ?? n.soundMidi) + dv, lim - 0.49, lim + 0.49) * 100) / 100; ed.locked = true;
  });
}
function groupSnapSemitone(ns) { groupEdit(ns, (n, ed) => { ed.target = n.nearest; ed.locked = true; }); }
function groupToScale(ns) {
  const todo = ns.filter((n) => n.scalePcs && !n.inScale);
  if (!todo.length) { status('Seçili notaların hepsi zaten scale içinde.'); return; }
  groupEdit(todo, (n, ed) => { const R = C.nearestScaleNote(n.effMidi, n.scalePcs); ed.target = R; ed.locked = true; ed.label = R !== n.nearest ? R : null; });
  status(`${todo.length} scale dışı nota en yakın scale notasına taşındı.`);
}
function groupLabel(ns, dv) { groupEdit(ns, (n, ed) => { const R = n.effMidi + dv; ed.label = R !== n.nearest ? R : null; }); }
// zaman: grup birlikte kayar (notalar arası mesafe korunur); tek nota ızgaraya yapışarak
function groupNudge(ns, dir) {
  const gq = quantGridQ(), one = ns.length === 1;
  groupEdit(ns, (n, ed) => { const q = one ? snapGrid(n.q0, dir) : n.q0 + gq * dir; ed.q0to = Math.abs(q - n.qOrig) < 1e-4 ? null : q; });
  status(`${ns.length > 1 ? ns.length + ' nota' : 'Nota'} ${quantGridLabel()} ${dir > 0 ? 'sağa' : 'sola'} kaydırıldı.`);
}
function groupResetAll(ns) {
  const eds = new Set(ns.map((n) => editFor(n)).filter(Boolean));
  S.proj.noteEdits = S.proj.noteEdits.filter((e) => !eds.has(e));
  refresh(); scheduleRender(true);
  status(`${ns.length} notadaki bütün değişiklikler kaldırıldı.`);
}
function renderNotesInspector(box, ns) {
  const g = S.d.g, nEdit = ns.filter((n) => n.edit && (n.edit.label != null || n.edit.target != null || n.edit.locked || n.edit.q0to != null)).length;
  const outScale = ns.filter((n) => n.scalePcs && !n.inScale).length;
  box.innerHTML = `<h3>${ns.length} nota seçili</h3>
    ${rmBar([nEdit && { text: `Seçili notalardan <b>${nEdit}</b> tanesinde elle değişiklik var`, act: 'gReset', btn: 'Seçili notaların değişikliklerini kaldır' }])}
    <div class="cols ops">
      <div class="box b"><h4>Perde <small class="hint">— hepsini birlikte taşı</small></h4>
        <div class="row"><button data-act="gMove" data-v="-12">▼ oktav</button><button data-act="gMove" data-v="-1">▼ yarım ses</button><button data-act="gMove" data-v="1">▲ yarım ses</button><button data-act="gMove" data-v="12">▲ oktav</button></div>
        <div class="row"><button data-act="gScale"${outScale ? '' : ' disabled'}>Scale dışındakileri scale'e çek${outScale ? ` (${outScale})` : ''}</button></div>
        <p class="hint">Sürükle ya da <kbd>↑</kbd>/<kbd>↓</kbd> (<kbd>Shift</kbd> = 5 cent). Ses yeni notaya kayar, akorlar onu kullanır.</p></div>
      <div class="box b"><h4>İnce akort <small class="hint">— yalnızca cent</small></h4>
        <div class="row"><button data-act="gFine" data-v="-0.05">−5 cent</button><button data-act="gFine" data-v="0.05">+5 cent</button><button data-act="gSnap">Tam yarım sese çek</button></div>
        <p class="hint">Notalar doğru ama pes/tiz ise. Her nota kendi cent'inden kayar.</p></div>
      <div class="box b"><h4>Zamanlama</h4>
        <div class="row"><button data-act="gNudge" data-v="-1">◀ ${esc(quantGridLabel())}</button><button data-act="gNudge" data-v="1">${esc(quantGridLabel())} ▶</button><button data-act="gQuant">Seçilileri quantize et</button></div>
        <p class="hint">Grup birlikte kayar, notalar arası mesafe korunur (<kbd>←</kbd>/<kbd>→</kbd>). Sürüklerken ızgaraya yapışır; <kbd>Ctrl</kbd>/<kbd>⌘</kbd> serbest. Quantize: 5. adımdaki ızgara ve güç.</p></div>
      <div class="box a"><h4>Etiketi düzelt <small class="hint">— yalnızca analiz, ses aynı</small></h4>
        <div class="row"><button data-act="gLabel" data-v="-1">−1</button><button data-act="gLabel" data-v="1">+1</button></div></div>
    </div>
    <p class="hint">Seçimi değiştir: boş yerde sürükle (yeni seçim) · <kbd>Shift</kbd>+sürükle ya da <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+tık (ekle / çıkar) · <kbd>Ctrl</kbd>+<kbd>A</kbd> hepsi · <kbd>Esc</kbd> kaldır. Süre: ${((ns[ns.length - 1].tl1 - ns[0].tl0)).toFixed(1)} s, ölçü ${C.metricPos(ns[0].q0, g).bar + 1}–${C.metricPos(ns[ns.length - 1].q0, g).bar + 1}.</p>`;
}

// ---------------------------------------------------------------- nota bölme (çift tık)
function resegment() { S.rawNotes = C.applyNoteSplits(C.segmentNotes(S.track, S.proj.pitch), S.track, S.proj.noteSplits); }
function splitNoteAt(n, x) {
  if (!S.track || !S.d) return;
  const d = S.d, g = d.g, hop = S.track.hopSec;
  // zaman çizelgesi konumu → kayıttaki zaman (ses kaydırma ve zamanlama düzeltmeleri geri alınır)
  let fi = Math.round(d.timeMap.inv((xToQ(x) * g.spq) + d.off) / hop);
  // tıklanan yerin yakınında (±30 ms) belirgin bir enerji çukuru varsa bölme oraya oturur (aynı perdede tekrar eden hece)
  const rms = S.track.rms, w = Math.round(0.03 / hop);
  let cand = fi, bv = Infinity;
  for (let f = Math.max(n.f0i + 2, fi - w); f <= Math.min(n.f1i - 2, fi + w); f++) if (rms[f] < bv) { bv = rms[f]; cand = f; }
  if (bv < 0.8 * (rms[fi] || 0)) fi = cand;
  const minF = Math.ceil(0.04 / hop);
  if (fi - n.f0i < minF || n.f1i - fi < minF) { status('Bölme noktası notanın kenarına çok yakın (her parça en az 40 ms olmalı): notanın ortasında çift tıkla.', 'err'); return; }
  const t = fi * hop;
  if (!C.addNoteSplit(S.proj, n, t, g.spq)) return;
  resegment();
  const id2 = 'n' + Math.round(t * 1000);
  refresh(); scheduleRender(true);
  selectNotes([n.id, id2]);
  status(`Nota ölçü ${C.metricPos(n.q0, g).bar + 1}'de ikiye bölündü (${Math.round((t - n.t0) * 1000)} ms | ${Math.round((n.t1 - t) * 1000)} ms). Her parçanın perdesi yeniden hesaplandı; birleştirmek için notanın panelindeki "✕ Bölmeyi geri al".`);
}
function unsplit(n, side) {
  const t = side === 'start' ? n.splitStart : n.splitEnd;
  if (t == null || !C.removeNoteSplit(S.proj, t, S.d.g.spq)) return;
  resegment();
  cleanupEdits(); refresh(); scheduleRender(true);
  status('Bölme geri alındı: iki parça tek nota oldu.');
}
cv.addEventListener('dblclick', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!S.d || y < TL.TOP || x < TL.KW) return;
  const n = noteAt(x, y);
  if (n) splitNoteAt(n, x);
});

// ---------------------------------------------------------------- akor / davul girişi + şarkıyı kaydır
function setStartBar(which, bar) {
  bar = Math.max(1, Math.round(bar) || 1);
  if (which === 'chord') S.proj.chordStartBar = bar; else S.proj.drums.startBar = bar;
  syncInputs(); refresh();
  status(which === 'chord'
    ? `Akorlar ölçü ${bar}'den girer: bu ölçü akorlar için 1. ölçü sayılır (öncesinde akor ve piyano yok).`
    : `Davul ölçü ${bar}'den girer: loop'un 1. ölçüsü burası (öncesinde davul yok).`);
  if (Player.playing) Player.play();
}
const barAtPlayhead = () => Math.floor(S.pos / grid().barSec + 1e-6) + 1;
function renderStarts() {
  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  set('#inChordStart', S.proj.chordStartBar || 1); set('#inDrumStart', S.proj.drums.startBar || 1);
  const cs = S.proj.chordStartBar || 1, nl = S.proj.chordLocks.filter((l) => l.bar < cs).length;
  $('#chordStartInfo').textContent = cs > 1 ? `Ölçü 1–${cs - 1}: akor ve piyano yok${nl ? ` (bu ölçülerdeki ${nl} kilit yok sayılır)` : ''}. Ölçü ${cs} akor motoru için 1. ölçüdür.` : 'Akorlar 1. ölçüden girer.';
  const ds = S.proj.drums.startBar || 1;
  $('#drumStartInfo').textContent = ds > 1 ? `Ölçü 1–${ds - 1}: davul yok. Loop ölçü ${ds}'de 1. ölçüsünden başlar.` : 'Davul 1. ölçüden girer.';
  const lead = S.proj.audio.leadBars || 0;
  $('#shiftInfo').textContent = lead ? `Şu an başta ${lead > 0 ? lead + ' ölçü boşluk var' : -lead + ' ölçü erken kesilmiş'} (ölçü çizgileri, bölümler, akor kilitleri ve düzenlemeler şarkıyla birlikte kaydı).` : 'Kaydırma yok.';
}
function shiftSongBars(n) {
  if (!S.d || !S.audio) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  const g = S.d.g;
  if (n < 0) {
    const first = S.d.notes.length ? Math.min(...S.d.notes.map((k) => k.q0)) : Infinity;
    if (first + n * g.barQ < -0.02) {
      status(`İlk nota ölçü ${Math.floor(first / g.barQ) + 1}'de; başta yalnızca ${Math.floor(first / g.barQ + 1e-6)} boş ölçü var, ${-n} ölçü geri alınırsa ses kesilir.`, 'err');
      return;
    }
  }
  Player.stop(true);
  C.shiftSong(S.proj, n);
  S.proj.chordPins = [];
  S.sel = null;
  syncInputs(); refresh(); scheduleRender(true);
  status(`Şarkı ${Math.abs(n)} ölçü ${n > 0 ? 'geri (başa boşluk eklendi)' : 'öne alındı'}: ses, ölçü çizgileri, bölümler, akor kilitleri ve düzenlemeler birlikte kaydı.${n > 0 ? ' Boş ölçülere akor/davul istersen bir bölüm ekleyip ton seç; girişi 🎹/🥁 bayraklarıyla ayarla.' : ''}`);
}


// ---------------------------------------------------------------- bölümler
function addSection(name, a, b) {
  const overl = S.proj.sections.find((s) => !(b < s.startBar || a > s.endBar));
  if (overl) { status(`Bölümler çakışamaz (“${overl.name}” ölçü ${overl.startBar}–${overl.endBar}).`, 'err'); return; }
  if (!name) {
    const used = new Set(S.proj.sections.map((s) => s.name));
    name = ['Verse', 'Nakarat', 'Köprü', 'Verse 2', 'Nakarat 2', 'Outro'].find((n) => !used.has(n)) || 'Bölüm ' + (S.proj.sections.length + 1);
  }
  const s = { id: uid(), name, startBar: a, endBar: b, tonic: null, mode: null };
  S.proj.sections.push(s);
  S.proj.sections.sort((p, q) => p.startBar - q.startBar);
  S.sel = { type: 'section', id: s.id };
  refresh();
  status(`“${name}” bölümü eklendi (ölçü ${a}–${b}). Tonunu 4. adımda seçin.`);
}
function deleteSection(id) {
  const s = S.proj.sections.find((x) => x.id === id);
  if (!s) return;
  S.proj.sections = S.proj.sections.filter((x) => x !== s);
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar < s.startBar || l.bar > s.endBar);
  if (S.sel && S.sel.id === s.id) S.sel = null;
  refresh();
  status(`“${s.name}” bölümü silindi (ölçü ${s.startBar}–${s.endBar}).`);
}
function renderSections() {
  const box = $('#sectionList');
  if (!S.d) { box.innerHTML = ''; return; }
  const secs = S.d.sections;
  const tonicOpts = (sel) => '<option value="">öneri</option>' + C.PC_SHARP.map((n, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${n}</option>`).join('');
  const modeOpts = (sel) => C.MODE_ORDER.map((m) => `<option value="${m}"${sel === m ? ' selected' : ''}>${C.MODES[m].name}</option>`).join('');
  box.innerHTML = secs.map((s) => {
    const src = S.proj.sections.find((x) => x.id === s.id);
    const ki = S.d.keyInfo[s.id] || { candidates: [] };
    const sel = S.sel && S.sel.type === 'section' && S.sel.id === s.id;
    const status = s.confirmed ? '<span class="tag ok">onaylı</span>' : ki.candidates.length ? '<span class="tag warn">öneri — onaylanmadı</span>' : '<span class="tag">nota yok</span>';
    const cands = ki.candidates.map((c) => `<li>
        <span class="nm">${esc(c.name)}</span>
        <span class="bar" title="göreli olasılık"><i style="width:${c.confidence}%"></i></span>
        <span class="sub">${c.confidence}%${c.endsOnTonic ? ' · son nota = ev notası' : ''}${c.sameNotesAs.length ? ' · aynı notalar: ' + esc(c.sameNotesAs.join(', ')) : ''}${c.continuity ? ` · ton sürekliliği (${c.continuity === 'same' ? 'önceki bölümle aynı ton' : 'önceki bölümle aynı nota kümesi'})` : ''}</span>
        <button data-act="pickKey" data-id="${s.id}" data-t="${c.tonic}" data-m="${c.mode}">Seç</button></li>`).join('');
    const head = s.implicit
      ? `<div class="head"><b>Tüm şarkı</b> <span class="hint">(bölüm tanımlanmadı)</span></div>`
      : `<div class="head">
          <input type="text" value="${esc(src.name)}" data-act="secName" data-id="${s.id}" aria-label="bölüm adı">
          <input type="number" min="1" value="${s.startBar}" data-act="secStart" data-id="${s.id}" title="başlangıç ölçüsü">
          <input type="number" min="1" value="${s.endBar}" data-act="secEnd" data-id="${s.id}" title="bitiş ölçüsü">
          <button class="danger" data-act="secDel" data-id="${s.id}" title="bölümü sil">✕ Sil</button></div>`;
    const keyRow = s.implicit ? '' : `<div class="keyrow">
          <select data-act="secTonic" data-id="${s.id}" aria-label="merkez nota">${tonicOpts(src.tonic)}</select>
          <select data-act="secMode" data-id="${s.id}" aria-label="mod">${modeOpts(src.mode || s.mode || 'major')}</select>
          ${status}</div>`;
    return `<div class="sec-card${sel ? ' sel' : ''}" data-sec="${s.id}">${head}${keyRow}
      ${ki.last ? `<div class="hint">Ayırt edici ipucu — bölümün son ağırlıklı notası: <b>${esc(ki.last.name)}</b></div>` : ''}
      ${(ki.ambiguity || []).map((a) => `<div class="st-warn amb-${a.type}">${a.type === 'noDistinct' ? '◐' : '◎'} ${esc(a.text)}${s.confirmed ? '' : ' Onayı sen ver.'}</div>`).join('')}
      ${(() => { const sus = S.d.notes.filter((n) => n.section === s.id && n.modeSuspect); return sus.length ? `<div class="st-warn">⚠ Mod yanlış olabilir: ${sus.length} nota tam tonunda söylenmiş ama ${esc(C.keyName(s.tonic, s.mode))} dışında (${[...new Set(sus.map((n) => C.pcName(n.effMidi, C.keyUsesFlats(s.tonic, s.mode))))].join(', ')}).</div>` : ''; })()}
      ${cands ? `<ul class="cands">${cands}</ul>` : ''}
      ${s.implicit && ki.candidates.length ? '<p class="hint">Mod seçmek için önce bir bölüm tanımlayın (tek bölüm için: 1–son ölçü).</p>' : ''}
    </div>`;
  }).join('');
}
$('#sectionList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) { const card = e.target.closest('.sec-card'); if (card && !e.target.closest('input,select')) select({ type: 'section', id: card.dataset.sec }); return; }
  const s = S.proj.sections.find((x) => x.id === b.dataset.id);
  if (b.dataset.act === 'pickKey') {
    if (!s) { // tek bölüm yokken öneriyi seçmek → tüm şarkıyı bölüm yap
      S.proj.sections.push({ id: uid(), name: 'Şarkı', startBar: 1, endBar: S.d.bars, tonic: +b.dataset.t, mode: b.dataset.m });
    } else { s.tonic = +b.dataset.t; s.mode = b.dataset.m; }
    refresh();
    status(`Ton seçildi: ${C.keyName(+b.dataset.t, b.dataset.m)}`);
  } else if (b.dataset.act === 'secDel' && s) deleteSection(s.id);
});
$('#sectionList').addEventListener('change', (e) => {
  const t = e.target, s = S.proj.sections.find((x) => x.id === t.dataset.id);
  if (!s) return;
  if (t.dataset.act === 'secName') s.name = t.value.trim() || s.name;
  if (t.dataset.act === 'secStart' || t.dataset.act === 'secEnd') {
    const a = t.dataset.act === 'secStart' ? +t.value : s.startBar, b = t.dataset.act === 'secEnd' ? +t.value : s.endBar;
    const ov = S.proj.sections.find((x) => x !== s && !(Math.max(a, b) < x.startBar || Math.min(a, b) > x.endBar));
    if (ov || a < 1 || b < 1) status('Geçersiz/çakışan ölçü aralığı.', 'err');
    else { s.startBar = Math.min(a, b); s.endBar = Math.max(a, b); }
  }
  if (t.dataset.act === 'secTonic') {
    if (t.value === '') { s.tonic = null; s.mode = null; }
    else { s.tonic = +t.value; s.mode = s.mode || S.d.sections.find((x) => x.id === s.id).mode || 'major'; }
  }
  if (t.dataset.act === 'secMode') {
    s.mode = t.value;
    if (s.tonic == null) s.tonic = S.d.sections.find((x) => x.id === s.id).tonic ?? 0;
  }
  S.proj.sections.sort((p, q) => p.startBar - q.startBar);
  refresh();
});
$('#btnSecAdd').onclick = () => {
  const a = +$('#inSecStart').value, b = +$('#inSecEnd').value;
  if (!(a >= 1 && b >= 1)) return;
  addSection($('#inSecName').value, Math.min(a, b), Math.max(a, b));
};

// ---------------------------------------------------------------- denetçi (inspector)
function renderInspector() {
  const box = $('#inspector');
  const d = S.d;
  if (!S.sel || !d) {
    box.innerHTML = S.audio
      ? `<p class="hint">Bir notaya, akora ya da bölüme tıklayın; <b>boş yerde sürükleyerek</b> birçok notayı birden seçin ve hepsini birlikte taşıyın; notaya <b>çift tıklayarak</b> ikiye bölün. Kısayollar: <kbd>Boşluk</kbd> çal/durdur · <kbd>↑</kbd>/<kbd>↓</kbd> seçili notaları düzelt (etiket/ses modunda; <kbd>Shift</kbd> = 5 cent) · <kbd>←</kbd>/<kbd>→</kbd> zamanda kaydır · <kbd>Ctrl</kbd>+<kbd>A</kbd> hepsini seç · <kbd>L</kbd> kilit · <kbd>Ctrl</kbd>+tekerlek yakınlaş.</p>`
      : `<p class="hint">Başlamak için bir kayıt yapın, dosya yükleyin ya da <b>Test melodisi üret</b>'e basın.</p>`;
    return;
  }
  if (S.sel.type === 'note') return renderNoteInspector(box, d.notes.find((n) => n.id === S.sel.id));
  if (S.sel.type === 'notes') { const ns = selNotes(); return ns.length ? renderNotesInspector(box, ns) : (box.innerHTML = ''); }
  if (S.sel.type === 'chord') return renderChordInspector(box, d.chords.find((s) => S.sel.q >= s.q0 && S.sel.q < s.q1));
  if (S.sel.type === 'section') {
    const s = d.sections.find((x) => x.id === S.sel.id);
    if (!s) { box.innerHTML = ''; return; }
    const ki = d.keyInfo[s.id];
    const hist = ki && ki.hist ? Array.from(ki.hist).map((v, i) => ({ v, i })).filter((x) => x.v > 0.005).sort((p, q) => q.v - p.v).map((x) => `${C.pcName(x.i, C.keyUsesFlats(s.tonic, s.mode))} ${(x.v * 100).toFixed(0)}%`).join(' · ') : '';
    const chords = d.chords.filter((c) => c.section === s.id).map((c) => C.chordName(c.chord, c.flats)).join(' – ');
    const nLocks = s.implicit ? 0 : S.proj.chordLocks.filter((l) => l.bar >= s.startBar && l.bar <= s.endBar).length;
    box.innerHTML = `<h3>${esc(s.name)} · ölçü ${s.startBar}–${s.endBar}</h3>
      ${s.implicit ? '' : rmBar([
        { text: `Bölüm: <b>${esc(s.name)}</b> (ölçü ${s.startBar}–${s.endBar}) <span class="hint">· Delete tuşu da siler</span>`, act: 'secDelete', btn: 'Bölümü sil' },
        nLocks && { text: `Bu bölümde ${nLocks} kilitli akor`, act: 'secUnlockAll', btn: 'Bölümdeki kilitleri kaldır' },
      ])}
      <div class="kv"><span>Ton</span><span>${s.tonic != null ? esc(C.keyName(s.tonic, s.mode)) + (s.provisional ? ' <span class="tag warn">öneri</span>' : ' <span class="tag ok">onaylı</span>') : '—'}</span>
      <span>Scale notaları</span><span>${s.pcs ? s.pcs.map((p) => C.pcName(p, C.keyUsesFlats(s.tonic, s.mode))).join(' ') : '—'}</span>
      <span>Ağırlıklı histogram</span><span>${hist || '—'}</span>
      <span>Son ağırlıklı nota</span><span>${ki && ki.last ? esc(ki.last.name) : '—'}</span>
      <span>Akorlar</span><span>${esc(chords)}</span></div>
      ${s.implicit ? '' : arrBlock(s)}
      <p class="hint">Ton/mod seçimini soldaki 4. adımdan yapın. Son karar her zaman sizde.</p>
      ${s.implicit ? '' : `<div class="row"><button data-act="secQuant">Bu bölümü quantize et (${esc(quantGridLabel())}, %${S.proj.quant.strength})</button><button data-act="secQuantClear">Bölümün zamanlamasını sıfırla</button></div>`}`;
  }
}
// bölüm düzenlemesi: bu bölümde davul / bas / akor sesi genel ayardan farklı olabilir; ⟳ ile sıradakini hemen dinle
function arrBlock(s) {
  const a = (S.proj.sections.find((x) => x.id === s.id) || {}).arr || {};
  const row = (kind, label) => `<div class="row"><label class="grow">${label}<select data-act="arr" data-kind="${kind}" data-id="${s.id}"><option value="">Genel ayar</option>${kind === 'piano' ? '' : `<option value="off"${a[kind] === 'off' ? ' selected' : ''}>Yok (bu bölümde çalma)</option>`}${arrOptions(kind).map((o) => `<option value="${o.id}"${a[kind] === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label><button data-act="arrNext" data-kind="${kind}" data-id="${s.id}" title="Sıradaki seçeneği dene ve hemen dinle">⟳ Başka dene</button></div>`;
  return `<fieldset class="arr"><legend>Bu bölümün düzenlemesi <span class="hint">(genel ayarın üstüne yazar)</span></legend>${row('drums', 'Davul')}${row('bass', 'Bas')}${row('piano', 'Akor sesi')}
    <p class="hint">Ör. verse'te sade davul + yarım notalı bas, nakaratta genel ayar. Bölüm geçişlerinde davul fill'i 8b'den açılır.</p></fieldset>`;
}
// Tıklayarak eklenen her şey (bölüm, akor kilidi, etiket, ses düzeltmesi, nota kilidi) tekrar
// tıklandığında denetçinin EN ÜSTÜNDE net bir "kaldır" satırıyla gelir.
function rmBar(rows) {
  const r = rows.filter(Boolean);
  if (!r.length) return '';
  return `<div class="rm-bar">${r.map((x) => `<div class="rm-row"><span>${x.text}</span><button class="danger" data-act="${x.act}">✕ ${esc(x.btn)}</button></div>`).join('')}</div>`;
}
function renderNoteInspector(box, n) {
  if (!n) { box.innerHTML = ''; return; }
  const g = S.d.g, sec = S.d.sections.find((s) => s.id === n.section);
  const flats = sec ? C.keyUsesFlats(sec.tonic, sec.mode) : false;
  const nn = (m) => C.noteName(m, flats);
  const mp = C.metricPos(n.q0, g);
  const beat = (mp.pos / g.pulseQ + 1).toFixed(2);
  const corr = n.corr || { source: 'none' };
  let soundDesc;
  if (corr.source === 'manual') soundDesc = `Manuel: ${nn(corr.target)}${Math.abs(corr.target - Math.round(corr.target)) > 0.001 ? ` ${Math.round((corr.target - Math.round(corr.target)) * 100)}c` : ''} (kaydırma ${Math.round(corr.applied)} cent) — kilitli`;
  else if (corr.source === 'auto') soundDesc = `Autotune → ${nn(corr.target)} (kaydırma ${Math.round(corr.applied)} cent)${corr.identityChange ? ' — UYARI: scale\'e çekme notayı başka yarım sese taşıdı' : ''}`;
  else if (corr.chromatic) soundDesc = 'Kromatik geçiş notası — autotune dokunmadı';
  else if (n.locked) soundDesc = 'Kilitli — autotune dokunmaz';
  else soundDesc = S.proj.autotune.enabled ? 'Düzeltme yok' : 'Düzeltme yok (autotune kapalı)';
  const manual = n.manualTarget != null;
  const isMove = manual && n.label != null && n.label === Math.round(n.manualTarget);
  const fine = manual && !isMove ? Math.round((n.manualTarget - Math.round(n.manualTarget)) * 100) : 0;
  const rms = isMove
    ? [{ text: `Taşındı: <b>${esc(nn(n.nearest))} → ${esc(nn(n.label))}</b> <span class="hint">(ses ${Math.round(corr.applied || 0) >= 0 ? '+' : ''}${Math.round(corr.applied || 0)} cent kaydırıldı; akorlar ${esc(nn(n.label))} kullanıyor)</span>`, act: 'noteResetAll', btn: 'Taşımayı geri al' }]
    : [
      n.label != null && { text: `Etiket (yalnızca analiz): algılanan ${esc(nn(n.nearest))} → <b>${esc(nn(n.label))}</b> <span class="hint">(ses aynı)</span>`, act: 'labelReset', btn: 'Etiketi kaldır' },
      manual && { text: `Elle ince akort: <b>${esc(nn(Math.round(n.manualTarget)))} ${fine >= 0 ? '+' : ''}${fine} cent</b> <span class="hint">(ses ${Math.round(corr.applied || 0)} cent kaydırıldı; nota aynı)</span>`, act: 'sndReset', btn: 'Elle akordu kaldır' },
      !manual && n.locked && { text: 'Autotune bu notada kapalı (bu nota olduğu gibi kalıyor)', act: 'noteUnlock', btn: 'Autotune\'a geri ver' },
    ].filter(Boolean);
  const tShift = n.q0to != null ? Math.round((n.q0to - n.qOrig) * g.spq * 1000) : 0;
  if (n.q0to != null) { const tm = C.metricPos(n.q0to, g); rms.push({ text: `Zaman: ölçü ${tm.bar + 1}, vuruş ${(tm.pos / g.pulseQ + 1).toFixed(2)}'ye kaydırıldı <span class="hint">(${tShift >= 0 ? '+' : ''}${tShift} ms)</span>`, act: 'timeReset', btn: 'Zamanı geri al' }); }
  if (rms.length > 1) rms.push({ text: 'Bu notadaki bütün değişiklikler', act: 'noteResetAll', btn: 'Hepsini kaldır' });
  // çift tıkla bölünen notanın bölmesi (birleştirme)
  if (n.splitStart != null) rms.push({ text: 'Bu nota çift tıkla bölünerek oluştu <span class="hint">(öncekinden ayrıldı)</span>', act: 'unsplitStart', btn: 'Bölmeyi geri al (öncekiyle birleştir)' });
  if (n.splitEnd != null) rms.push({ text: 'Bu nota çift tıkla bölündü <span class="hint">(sonrakiyle ayrıldı)</span>', act: 'unsplitEnd', btn: 'Bölmeyi geri al (sonrakiyle birleştir)' });
  const atLine = manual ? 'Elle düzeltildi — autotune bu notaya dokunmaz.'
    : corr.source === 'auto' ? `Autotune bu notayı ${Math.round(corr.applied) >= 0 ? '+' : ''}${Math.round(corr.applied)} cent kaydırıyor → ${esc(nn(corr.target))}.${n.autoMoved ? ` ⚠ Scale'e çekme notayı ${esc(nn(n.sungMidi))}'den ${esc(nn(n.effMidi))}'ye taşıdı: akorlar duyduğun ${esc(nn(n.effMidi))}'ye göre bulunuyor (ton önerisi söylediğin ${esc(nn(n.sungMidi))}'yi kullanır).` : ''}`
    : corr.chromatic ? 'Kromatik geçiş notası — autotune dokunmadı.'
    : n.locked ? 'Autotune bu notada kapalı.'
    : S.proj.autotune.enabled ? 'Autotune bu notada düzeltme gerektirmedi.' : 'Autotune kapalı (5. adım).';
  box.innerHTML = `<h3><button data-act="hearNote" title="notayı şu anki haliyle dinle">▶</button> Nota ${esc(nn(n.effMidi))}${manual || corr.source === 'auto' ? ' <button data-act="hearNote" data-orig="1" class="small" title="düzeltmesiz, kaydettiğin gibi">▶ orijinal</button>' : ''}${isMove ? ' <span class="tag" style="color:#5fd08a;border-color:#5fd08a">taşındı</span>' : n.label != null ? ' <span class="tag warn">etiket</span>' : ''}${manual && !isMove ? ' <span class="tag" style="color:#5fd08a;border-color:#5fd08a">elle akort</span>' : ''}</h3>
    ${rmBar(rms)}
    <div class="kv">
      <span>Algılanan</span><span>${esc(nn(n.nearest))} ${n.cents > 0 ? '+' : ''}${n.cents} cent <span class="hint">(kişisel akort referansına göre${n.refCents ? `; referans ${n.refCents >= 0 ? '+' : ''}${n.refCents.toFixed(0)}c` : ''} · A4=440'a göre ${esc(nn(n.absNearest))} ${n.absCents > 0 ? '+' : ''}${n.absCents}c · medyan MIDI ${n.median.toFixed(2)})</span></span>
      <span>Konum</span><span>ölçü ${mp.bar + 1}, vuruş ${beat} · ${(n.tl1 - n.tl0).toFixed(2)} s (${((n.q1 - n.q0) / g.pulseQ).toFixed(2)} vuruş)</span>
      <span>Bölüm</span><span>${sec ? esc(sec.name) + (sec.tonic != null ? ' · ' + esc(C.keyName(sec.tonic, sec.mode)) : '') : '—'} · ${n.inScale ? 'scale içinde' : '<b style="color:var(--note-out)">scale dışı</b>'}</span>
      <span>Akor ağırlığı</span><span>×${n.cw}</span>
      <span>Autotune</span><span>${atLine}</span>
      ${n.modeSuspect ? `<span>Mod</span><span><b style="color:#c792ea">Mod yanlış olabilir:</b> bu nota tam tonunda söylenmiş (${n.cents > 0 ? '+' : ''}${n.cents} cent) ama ${sec && sec.tonic != null ? esc(C.keyName(sec.tonic, sec.mode)) : 'seçili scale'} dışında. Büyük ihtimalle kasıtlı — bölümün modunu kontrol edin; autotune bu notanın kimliğini değiştirmez.</span>` : ''}
    </div>
    <div class="cols ops">
      <div class="box b"><h4>Notayı taşı <small class="hint">— ses + kastedilen nota</small></h4>
        <div class="row"><button data-act="move" data-v="-12">▼ oktav</button><button data-act="move" data-v="-1">▼ yarım ses</button><button data-act="move" data-v="1">▲ yarım ses</button><button data-act="move" data-v="12">▲ oktav</button></div>
        <div class="row"><label class="grow">Doğrudan nota seç<select data-act="setNote" aria-label="notayı doğrudan seç">${Array.from({ length: 25 }, (_, i) => n.effMidi - 12 + i).map((m) => `<option value="${m}"${m === Math.round(n.effMidi) ? ' selected' : ''}>${esc(nn(m))}${sec && sec.pcs && !sec.pcs.includes(C.mod12(m)) ? ' (scale dışı)' : ''}</option>`).join('')}</select></label>
          <button data-act="scaleSnap"${n.scalePcs && !n.inScale ? '' : ' disabled'} title="Scale dışındaysa en yakın scale notasına taşır">Scale'e çek</button></div>
        <p class="hint">Yanlış nota söylediysen. Ses yeni notaya kayar, akorlar da onu kullanır. Kısayol: <b>sürükle</b> ya da <kbd>↑</kbd>/<kbd>↓</kbd>. Birçok notayı birden taşımak için boş yerde sürükleyip seç.</p></div>
      <div class="box b"><h4>İnce akort <small class="hint">— yalnızca cent</small></h4>
        <div class="row"><button data-act="snd" data-v="-0.2">−20</button><button data-act="snd" data-v="-0.05">−5 cent</button><button data-act="snd" data-v="0.05">+5 cent</button><button data-act="snd" data-v="0.2">+20</button><button data-act="sndSnap">Tam yarım sese çek</button></div>
        <label class="chk"><input type="checkbox" data-act="lock"${n.locked ? ' checked' : ''}${manual ? ' disabled' : ''}> Autotune bu notaya dokunmasın</label>
        <p class="hint">Nota doğru ama biraz pes/tiz ise. Nota değişmez, akorlar etkilenmez. Kısayol: <kbd>Shift</kbd>+sürükle ya da <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>.</p></div>
      <div class="box b"><h4>Zamanlama <small class="hint">— sağa/sola</small></h4>
        <div class="row"><button data-act="timeNudge" data-v="-1">◀ ${esc(quantGridLabel())}</button><button data-act="timeSnap">Izgaraya çek (${esc(quantGridLabel())})</button><button data-act="timeNudge" data-v="1">${esc(quantGridLabel())} ▶</button></div>
        <p class="hint">Ses bütün olarak kayar, perde değişmez. Kısayol: notayı <b>sağa/sola sürükle</b> (ızgaraya yapışır; <kbd>Ctrl</kbd>/<kbd>⌘</kbd> ile serbest) ya da <kbd>←</kbd>/<kbd>→</kbd>. Izgara 5. adımdaki quantize ayarından.</p></div>
      <div class="box a"><h4>Notayı böl <small class="hint">— program tek ses sandıysa</small></h4>
        <p class="hint">Notanın üstünde <b>çift tıkla</b>: tıkladığın yerden ikiye bölünür (aynı perdede tekrar eden hece gibi), her parçanın perdesi yeniden hesaplanır.</p></div>
      <div class="box a"><h4>Etiketi düzelt <small class="hint">— yalnızca analiz, ses aynı</small></h4>
        <div class="row">Analizdeki nota: <b>${esc(nn(n.effMidi))}</b> <button data-act="label" data-v="-1">−1</button><button data-act="label" data-v="1">+1</button></div>
        <p class="hint">Program notayı yanlış algıladıysa (sen doğru söyledin). Ses değişmez; ton önerisi ve akorlar bu etiketi kullanır. Kısayol: <kbd>Alt</kbd>+sürükle.</p></div>
    </div>`;
}
// Notayı taşı: ses R yarım sesine kayar ve kastedilen nota R olur (akorlar onu kullanır)
function moveNote(n, R) {
  const ed = editFor(n, true);
  ed.target = R; ed.locked = true; ed.label = R !== n.nearest ? R : null;
  cleanupEdits(); refresh(); scheduleRender(true);
  NotePreview.play(n, (R - n.median) * 100);
  status(`Taşındı: ${C.noteName(n.nearest, false)} → ${C.noteName(R, false)} (ses ve akorlar). Geri almak için notanın panelindeki "✕ Taşımayı geri al".`);
}
function soundEdit(n, fn) {
  const ed = editFor(n, true);
  ed.target = fn(ed.target ?? n.soundMidi);
  NotePreview.play(n, (ed.target - n.median) * 100);
  ed.locked = true;
  cleanupEdits(); refresh(); scheduleRender(true);
}
$('#inspector').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !S.sel) return;
  const act = b.dataset.act;
  if (act === 'arrNext') { arrNext(b.dataset.kind, b.dataset.id); return; }
  if (act === 'secDelete' && S.sel.type === 'section') { deleteSection(S.sel.id); return; }
  if ((act === 'secQuant' || act === 'secQuantClear') && S.sel.type === 'section') {
    const sid = S.sel.id, sc = { f: (n) => n.section === sid, name: (S.d.sections.find((x) => x.id === sid) || {}).name };
    if (act === 'secQuant') applyQuantize(sc); else clearTiming(sc);
    return;
  }
  if (act === 'secUnlockAll' && S.sel.type === 'section') {
    const s = S.proj.sections.find((x) => x.id === S.sel.id);
    if (s) { S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar < s.startBar || l.bar > s.endBar); refresh(); status(`“${s.name}” bölümündeki akor kilitleri kaldırıldı.`); }
    return;
  }
  if (S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    if (!n) return;
    if (act === 'label') { const ed = editFor(n, true); const R = n.effMidi + +b.dataset.v; ed.label = R !== n.nearest ? R : null; cleanupEdits(); refresh(); NotePreview.play(n, NotePreview.current(n), R); }
    if (act === 'hearNote') NotePreview.play(n, b.dataset.orig ? 0 : NotePreview.current(n));
    if (act === 'move') moveNote(n, n.effMidi + +b.dataset.v);
    if (act === 'scaleSnap' && n.scalePcs && !n.inScale) moveNote(n, C.nearestScaleNote(n.effMidi, n.scalePcs));
    if (act === 'unsplitStart' || act === 'unsplitEnd') unsplit(n, act === 'unsplitStart' ? 'start' : 'end');
    if (act === 'labelReset') { const ed = editFor(n); if (ed) ed.label = null; cleanupEdits(); refresh(); }
    if (act === 'snd') soundEdit(n, (t) => { const v = +b.dataset.v; const lim = Math.round(n.manualTarget ?? n.nearest); return Math.round(C.clamp(t + v, lim - 0.49, lim + 0.49) * 100) / 100; });
    if (act === 'sndSnap') soundEdit(n, () => n.nearest);
    if (act === 'sndReset') { const ed = editFor(n); if (ed) { ed.target = null; ed.locked = false; } cleanupEdits(); refresh(); scheduleRender(true); }
    if (act === 'noteUnlock') { const ed = editFor(n); if (ed) ed.locked = false; cleanupEdits(); refresh(); }
    if (act === 'timeReset') { const ed = editFor(n); if (ed) ed.q0to = null; cleanupEdits(); refresh(); scheduleRender(true); }
    if (act === 'timeSnap' || act === 'timeNudge') {
      const gq = quantGridQ(), ed = editFor(n, true);
      const q = act === 'timeSnap' ? snapGrid(n.qOrig) : snapGrid(n.q0, +b.dataset.v);
      ed.q0to = Math.abs(q - n.qOrig) < 1e-4 ? null : q;
      cleanupEdits(); refresh(); scheduleRender(true);
    }
    if (act === 'noteResetAll') {
      const had = n.manualTarget != null || n.q0to != null;
      S.proj.noteEdits = S.proj.noteEdits.filter((e) => e !== editFor(n));
      refresh(); if (had) scheduleRender(true);
      status('Notadaki bütün değişiklikler kaldırıldı.');
    }
  } else if (S.sel.type === 'notes') {
    const ns = selNotes();
    if (!ns.length) return;
    const v = +b.dataset.v;
    if (act === 'gMove') groupMove(ns, v);
    if (act === 'gFine') groupFine(ns, v);
    if (act === 'gSnap') groupSnapSemitone(ns);
    if (act === 'gScale') groupToScale(ns);
    if (act === 'gLabel') groupLabel(ns, v);
    if (act === 'gNudge') groupNudge(ns, v);
    if (act === 'gQuant') applyQuantize({ f: (n) => ns.some((k) => k.id === n.id), name: `${ns.length} seçili nota` });
    if (act === 'gReset') groupResetAll(ns);
  } else if (S.sel.type === 'chord') {
    const slot = S.d.chords.find((s) => S.sel.q >= s.q0 && S.sel.q < s.q1);
    if (!slot) return;
    const scope = ($('#chScope') && $('#chScope').value) || 'slot';
    const half = scope === 'slot' ? slot.half : scope === 'bar' ? null : +scope;
    const bOf = () => (b.dataset.b != null && b.dataset.b !== '' ? +b.dataset.b : null);
    if (act === 'pickChord') { setLock(slot.bar, half, { root: +b.dataset.r, q: b.dataset.q, bass: bOf() }); }
    if (act === 'applyPinSug' && slot.pinSuggest) {
      const ps = slot.pinSuggest.chord;
      S.proj.chordPins = (S.proj.chordPins || []).filter((p) => !(p.bar === slot.bar && (slot.half == null || p.half == null || p.half === slot.half)));
      S.proj.chordPins.push({ bar: slot.bar, half: slot.half, chord: { root: ps.root, q: ps.q, bass: null } });
      refresh();
      status(`Ölçü ${slot.bar}: motorun önerisi (${C.chordName(ps, slot.flats)}) uygulandı; diğer akorlar değişmedi.`);
    }
    if (act === 'manualChord') {
      const ch = C.parseChord($('#chInput').value);
      if (!ch) { status('Akor anlaşılamadı. Örnek: C#m, Dmaj7, F#m7/A, Bsus2, Eadd9', 'err'); return; }
      setLock(slot.bar, half, ch);
    }
    if (act === 'unlockChord') unlockSlot(slot);
    if (act === 'markSet') { setMark(+b.dataset.bar, +b.dataset.half, b.dataset.kind || null); return; }
    if (act === 'hearChord') {
      const c = b.dataset.cur ? Object.assign({}, slot.chord, { bass: slot.chord.bass ?? (slot.inversion ? slot.voicing.bassPc : null) }) : { root: +b.dataset.r, q: b.dataset.q, bass: b.dataset.b != null && b.dataset.b !== '' ? +b.dataset.b : null };
      Player.audition(c, slot.section, slot.q0, slot.q1);
    }
    if (act === 'fbChord' && window.StyleUI) {
      const sec = S.d.sections.find((x) => x.id === slot.section);
      const same = S.d.chords.filter((x) => x.section === slot.section && x.q0 < slot.q0 && !C.sameChord(x.chord, slot.chord));
      const prev = same.length ? same[same.length - 1].chord : null;
      window.StyleUI.feedbackChord(prev, slot.chord, sec, +b.dataset.v);
    }
  }
});
$('#inspector').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'arr') {
    const sec = S.proj.sections.find((x) => x.id === t.dataset.id);
    if (!sec) return;
    sec.arr = Object.assign({}, sec.arr); delete sec.arr.auto; // elle değiştirilen düzenleme artık senin
    if (t.value) sec.arr[t.dataset.kind] = t.value; else delete sec.arr[t.dataset.kind];
    if (!Object.keys(sec.arr).length) delete sec.arr;
    refresh(); if (Player.playing) Player.play();
    return;
  }
  if (t.dataset.act === 'setNote' && S.sel && S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    if (n && +t.value !== Math.round(n.effMidi)) moveNote(n, +t.value);
    return;
  }
  if (t.dataset.act === 'lock' && S.sel && S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    const ed = editFor(n, true); ed.locked = t.checked; cleanupEdits(); refresh();
  }
});
$('#inspector').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'chInput') $('#inspector button[data-act=manualChord]').click(); });
function unlockSlot(slot) {
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === slot.bar && (slot.half == null || l.half == null || l.half === slot.half)));
  refresh();
  status(`Ölçü ${slot.bar}${slot.half != null ? ` (${slot.half + 1}. yarı)` : ''}: kilit kaldırıldı, akor otomatiğe döndü.`);
}
// ---- kilit sonrası sabitleme: bir akor kilitlenince diğer akorlar (çevrimleri dahil) olduğu gibi kalır.
// Sabitler, akorları etkileyen başka bir şey değişince (bölüm/ton, etiket, ayar, stil verisi…) kendiliğinden bırakılır.
function pinSig() {
  const p = S.proj, SU = window.StyleUI && window.StyleUI.state;
  return JSON.stringify({
    set: [p.settings.bpm, p.settings.meter], at: [p.autotune.enabled, p.autotune.target, p.autotune.amount >= 50], sec: p.sections.map((x) => [x.id, x.startBar, x.endBar, x.tonic, x.mode]),
    lab: p.noteEdits.filter((e) => e.label != null).map((e) => [e.t0, e.t1, e.label]),
    co: p.chordOpts, pi: p.pitch, off: p.audio.offsetSec, ped: p.mixer.pedal, rn: S.rawNotes ? S.rawNotes.length : 0,
    st: SU ? [SU.settings, SU.dataset.songs.length, SU.feedback.events.length, SU.feedback.on] : null,
  });
}
// ---- akor değişim işaretleri: ölçü başı ya da ölçü ortası (yarım ölçü) noktasında "değiş" (✂) / "değişme" (=)
const markAt = (bar, half) => (S.proj.changeMarks || []).find((m) => m.bar === bar && (m.half || 0) === (half || 0));
// sıradaki durum: yok → değiş → değişme → yok
function cycleMark(bar, half) { const m = markAt(bar, half); setMark(bar, half, !m ? 'change' : m.kind === 'change' ? 'hold' : null); }
function setMark(bar, half, kind) {
  if (!S.d) return;
  const g = S.d.g, per = g.split ? 2 : 1;
  half = per === 2 ? half || 0 : 0;
  const unit = (b, h) => (b - 1) * per + (h || 0);
  const u0 = unit(bar, half);
  // bu noktadan başlayan akor (aynı akorun devam ettiği yarım ölçüler) serbest kalır; diğer akorlar sabit
  const qU = (u) => (u * g.barQ) / per;
  const at = S.d.chords.find((c) => qU(u0) + 1e-6 >= c.q0 && qU(u0) < c.q1 - 1e-6);
  let u1 = u0 + 1;
  if (at) {
    let c = at;
    while (c) {
      u1 = Math.max(u1, Math.round((c.q1 * per) / g.barQ));
      const nx = S.d.chords.find((x) => Math.abs(x.q0 - c.q1) < 1e-6);
      c = nx && C.sameChord(nx.chord, at.chord) && nx.section === at.section ? nx : null;
    }
  }
  const cov = (b, h) => { const u = unit(b, h); return u >= u0 && u < u1; };
  if (kind) {
    pinOthers(cov);
    const out = [];
    for (const p of S.proj.chordPins || []) {
      const hs = p.half != null ? [p.half] : per === 2 ? [0, 1] : [0];
      const keep = hs.filter((h) => !cov(p.bar, h));
      if (keep.length === hs.length) out.push(p);
      else for (const h of keep) out.push(Object.assign({}, p, { half: per === 2 ? h : null }));
    }
    S.proj.chordPins = out;
  }
  S.proj.changeMarks = (S.proj.changeMarks || []).filter((m) => !(m.bar === bar && (m.half || 0) === half));
  if (kind) S.proj.changeMarks.push({ bar, half, kind });
  refresh();
  const where = `ölçü ${bar}${half ? ' ortası' : ' başı'}`;
  status(kind === 'change' ? `✂ ${where}: akor burada değişecek (diğer akorlar aynı).` : kind === 'hold' ? `= ${where}: akor burada değişmeyecek.` : `${where}: işaret kaldırıldı.`);
}
// covers(bar, half): yeni kilitlerin (bar, yarım) konumunu kapsayıp kapsamadığı; half null = tüm ölçü
function pinOthers(covers) {
  if (!S.d) return;
  if (S.proj.chordPinsSig !== pinSig()) S.proj.chordPins = [];
  const pins = S.proj.chordPins || (S.proj.chordPins = []);
  const split = !!S.d.g.split;
  const has = (bar, half) => pins.some((p) => p.bar === bar && (p.half == null || half == null || p.half === half));
  for (const sl of S.d.chords) {
    if (sl.locked) continue;
    const ch = { root: sl.chord.root, q: sl.chord.q, bass: sl.chord.bass ?? (sl.inversion ? sl.voicing.bassPc : null) };
    const halves = sl.half != null ? [sl.half] : split ? [0, 1] : [null];
    const free = halves.filter((h) => !covers(sl.bar, h));
    if (!free.length) continue;
    // tam ölçülük akorun yalnızca bir yarısı kilitleniyorsa diğer yarısı aynen kalsın
    const hs = free.length === halves.length ? [sl.half] : free;
    for (const h of hs) if (!has(sl.bar, h)) pins.push({ bar: sl.bar, half: h, chord: ch });
  }
  S.proj.chordPinsSig = pinSig();
}
function setLock(bar, half, chord) {
  pinOthers((b, h) => b === bar && (half == null || h == null || h === half));
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => !(p.bar === bar && (half == null || p.half == null || p.half === half)));
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === bar && (half == null || l.half == null || l.half === half)));
  S.proj.chordLocks.push({ bar, half, chord: { root: chord.root, q: chord.q, bass: chord.bass ?? null } });
  refresh();
  status(`Ölçü ${bar}${half != null ? ` (${half + 1}. yarı)` : ''}: ${C.chordName(chord)} kilitlendi.`);
}
function renderChordInspector(box, slot) {
  if (!slot) { box.innerHTML = '<p class="hint">Bu konumda akor yok. Bölümün tonu belirlenmemiş olabilir (4. adım); başka bir akora tıklayın.</p>'; return; }
  const g = S.d.g, sec = S.d.sections.find((s) => s.id === slot.section);
  const nm = (c) => C.chordName(c, slot.flats), pn = (pc) => C.pcName(pc, slot.flats);
  const roleChips = (roles) => roles.filter((r) => r.w >= 0.5).map((r) => `<span class="role ${r.clash ? 'clash' : r.tone ? 'tone' : ''}">${esc(pn(r.pc))}: ${esc(r.role)} <small>×${r.w}</small></span>`).join('') || '<span class="hint">melodi yok</span>';
  const sty = !!S.d.styleActive;
  const fx = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
  const rows = slot.candidates.map((c) => `<tr><td><b>${esc(nm(c.chord))}</b>${C.sameChord(c.chord, slot.chord) ? ' ✓' : ''}</td><td>${sty ? `<span title="toplam">${c.score.toFixed(2)}</span> = <span title="melodi uyumu">${fx(c.melody)}</span> <span class="hint">melodi</span> ${fx(c.style)} <span class="hint" title="stil: geçiş ${fx(c.styleTrans)}, renk ${fx(c.styleColor)}">stil</span>` : c.pct}</td><td>${roleChips(c.roles)}</td>
      <td><button data-act="hearChord" data-r="${c.chord.root}" data-q="${c.chord.q}" title="dinle (kilitlemez)">▶</button> <button data-act="pickChord" data-r="${c.chord.root}" data-q="${c.chord.q}">Seç + kilitle</button></td></tr>`).join('');
  const sug = slot.suggest ? `<tr><td><b>${esc(nm(slot.suggest))}</b></td><td>öneri</td><td class="hint">Minör akorda melodi 2'liye basıyor → sus2 varyantı</td><td><button data-act="hearChord" data-r="${slot.suggest.root}" data-q="${slot.suggest.q}" title="dinle (kilitlemez)">▶</button> <button data-act="pickChord" data-r="${slot.suggest.root}" data-q="${slot.suggest.q}">Seç + kilitle</button></td></tr>` : '';
  const halfTxt = slot.half == null ? 'tüm ölçü' : `${slot.half + 1}. yarı`;
  const scopeSel = g.split ? `<select id="chScope" aria-label="kapsam" style="width:auto"><option value="slot">bu slot (${halfTxt})</option>${slot.half != null ? '<option value="bar">tüm ölçü</option>' : ''}<option value="0">1. yarı</option><option value="1">2. yarı</option></select>` : '';
  const disp = Object.assign({}, slot.chord, { bass: slot.chord.bass ?? (slot.inversion ? slot.voicing.bassPc : null) });
  // ---- öneriler ve "neden"ler: hiçbiri kendiliğinden uygulanmaz
  const bAttr = (ch) => `data-r="${ch.root}" data-q="${ch.q}" data-b="${ch.bass ?? ''}"`;
  const chBtns = (ch, pickTxt = 'Seç + kilitle') => `<button data-act="hearChord" ${bAttr(ch)} title="dinle (kilitlemez)">▶ ${esc(nm(ch))}</button><button data-act="pickChord" ${bAttr(ch)}>${esc(pickTxt)}</button>`;
  const box2 = (important, html) => `<div class="${important ? 'st-warn adv-imp' : 'adv-opt'}">${important ? '⚠ ' : 'ℹ '}${html}</div>`;
  const adv = [];
  const bassLine = (a) => `${a.prevBassPc != null ? `önceki bas ${esc(pn(a.prevBassPc))} → ${esc(pn(a.bassPc))}: ${a.leap} yarım ses` : ''}; kök konumda bas ${a.rootLeap} yarım ses atlıyor`;
  if (slot.locked) {
    for (const a of slot.lockAdvice || []) adv.push(box2(a.important, `${esc(a.text)} <div class="row">${a.chords.map((ch) => chBtns(ch)).join(' ')}</div>`));
    if (slot.invAdvice) {
      const inv = Object.assign({}, slot.chord, { bass: slot.invAdvice.bassPc });
      adv.push(box2(false, `Çevrim (isteğe bağlı): <b>${esc(nm(inv))}</b> bas hattını adım adım götürür (${bassLine(slot.invAdvice)}). Kilitlediğin için kök konumda çalıyor. <div class="row">${chBtns(inv, 'Bu çevrimle kilitle')}</div>`));
    }
  } else if (slot.pinned) {
    adv.push(`<div class="adv-opt">📌 Sabit: başka bir akoru kilitlediğin için bu akor değiştirilmedi.</div>`);
    if (slot.pinSuggest) {
      const ps = slot.pinSuggest;
      adv.push(box2(ps.important, `Motor burada <b>${esc(nm(ps.chord))}</b> önerir — ${esc(ps.reasons.join('; '))}. <div class="row"><button data-act="hearChord" ${bAttr(ps.chord)}>▶ ${esc(nm(ps.chord))}</button><button data-act="applyPinSug" class="accent">Öneriyi uygula</button><button data-act="pickChord" ${bAttr(ps.chord)}>Seç + kilitle</button></div>`));
    }
  } else if (slot.invWhy) {
    const root = Object.assign({}, slot.chord, { bass: slot.chord.root });
    const lockedRoot = S.d.chords.find((x) => x !== slot && x.locked && C.sameChord(x.chord, slot.chord) && !x.inversion);
    adv.push(box2(false, `Neden çevrim (<b>${esc(nm(disp))}</b>): bas hattı adım adım gitsin diye (${bassLine(slot.invWhy)}).${lockedRoot ? ` Şarkıda başka yerde (ölçü ${lockedRoot.bar}) ${esc(nm(slot.chord))} akorunu kök konumda kilitledin.` : ''} Zorunlu değil. <div class="row">${chBtns(root, 'Kök konumda kilitle')}</div>`));
  }
  // tutarlılık: aynı kökte başka bir akoru başka yerde kilitlediysen
  if (!slot.locked) {
    const other = S.d.chords.find((x) => x !== slot && x.locked && x.chord.root === slot.chord.root && !C.sameChord(x.chord, slot.chord));
    if (other) adv.push(box2(false, `Şarkıda başka yerde (ölçü ${other.bar}) <b>${esc(nm(other.chord))}</b> kilitledin; burada <b>${esc(nm(slot.chord))}</b> çünkü: ${esc(slot.reason || 'melodi')}. Aynı kalmasını istersen: <div class="row">${chBtns(Object.assign({}, other.chord, { bass: other.chord.bass ?? null }), 'Buradakini de böyle kilitle')}</div>`));
  }
  // değişim noktaları: bu akorun başı ve (tam ölçülükse) ölçü ortası
  const per2 = g.split ? 2 : 1, h0 = slot.half || 0;
  const secStart = sec && slot.bar === sec.startBar && h0 === 0;
  const mk = (bar, half) => markAt(bar, half);
  const mBtn = (bar, half, kind, txt) => `<button data-act="markSet" data-bar="${bar}" data-half="${half}" data-kind="${kind}"${kind === 'change' ? ' class="accent"' : ''}>${txt}</button>`;
  const markRow = [];
  if (per2 === 2 && slot.half == null) {
    const m = mk(slot.bar, 1);
    markRow.push(m ? `<span class="tag">${m.kind === 'change' ? '✂ ölçü ortasında değişecek' : '= ölçü ortasında değişmeyecek'}</span>${mBtn(slot.bar, 1, '', '✕')}` : mBtn(slot.bar, 1, 'change', '✂ Ölçünün ortasında değiştir'));
  }
  if (!secStart) {
    const m = mk(slot.bar, h0);
    markRow.push(m ? `<span class="tag">${m.kind === 'change' ? '✂ bu akorun başında değişecek' : '= bu akorun başında değişmeyecek'}</span>${mBtn(slot.bar, h0, '', '✕')}` : `${mBtn(slot.bar, h0, 'change', '✂ Tam burada değiştir')}${mBtn(slot.bar, h0, 'hold', '= Burada değiştirme (önceki sürsün)')}`);
  }
  const markHtml = markRow.length ? `<div class="row mark-row"><span class="hint">Akor değişimi:</span> ${markRow.join(' ')}</div>` : '';
  box.innerHTML = `<h3>Ölçü ${slot.bar} · ${halfTxt} · ${esc(sec ? sec.name : '')}${sec && sec.tonic != null ? ' (' + esc(C.keyName(sec.tonic, sec.mode)) + ')' : ''}</h3>
    ${slot.locked ? rmBar([{ text: slot.lockSrc === 'chart' ? `📄 Bu akor senin şablonundan: <b>${esc(C.chordName(disp, slot.flats))}</b>` : `🔒 Bu akor elle seçildi / kilitlendi: <b>${esc(C.chordName(disp, slot.flats))}</b>`, act: 'unlockChord', btn: 'Kilidi kaldır (otomatiğe dön)' }]) : ''}
    ${adv.join('')}
    ${markHtml}
    <div class="kv"><span>Akor</span><span><button data-act="hearChord" data-cur="1" title="dinle">▶</button> <b style="font-size:16px">${esc(C.chordName(disp, slot.flats))}</b> ${slot.locked ? '<span class="tag" style="color:var(--lock);border-color:var(--lock)">🔒 kilitli</span>' : slot.pinned ? '<span class="tag">📌 sabit</span>' : '<span class="tag">otomatik</span>'}</span>
      <span>Neden</span><span>${esc(slot.reason || '')}</span>
      <span>Melodi notalarının rolü</span><span>${roleChips(slot.roles)}</span>
      ${slot.engine === 'viterbi' ? `<span>Değiş mi kal mı</span><span>süreli model: bu akor ${slot.segBars} ölçü sürüyor${slot.segDurTerm != null ? ` — harmonik ritim payı ${slot.segDurTerm >= 0 ? '+' : ''}${slot.segDurTerm.toFixed(2)} (λ_ritim·log(P(süre)·5))` : ' — harmonik ritim verisi yok, süre karara katılmıyor'}</span>` : ''}
      ${slot.rhythm ? `<span>Değiş mi kal mı</span><span>harmonik ritim: bu akor ${slot.rhythm.held} ölçüdür çalıyordu → bu modda değişme olasılığı %${Math.round(slot.rhythm.h * 100)} (payı ${slot.rhythm.value >= 0 ? '+' : ''}${slot.rhythm.value.toFixed(2)})</span>` : sty ? '<span>Değiş mi kal mı</span><span class="hint">harmonik ritim verisi yok — stil bu karara katılmıyor</span>' : ''}
      <span>Seslendirme</span><span>bas ${esc(C.noteName(slot.voicing.bass, slot.flats))} · ${slot.voicing.notes.map((m) => esc(C.noteName(m, slot.flats))).join(' ')}${slot.inversion ? ' (çevrim)' : ''}</span></div>
    <table><thead><tr><th>En iyi adaylar</th><th>${sty ? 'puan = melodi payı + stil payı ("hangi akor")' : 'puan'}</th><th>ağırlıklı melodi notalarının rolü (kök/3/5/7/9)</th><th></th></tr></thead><tbody>${rows}${sug}</tbody></table>
    ${sec && sec.tonic != null && window.StyleUI ? `<div class="row" style="margin-top:6px"><span class="hint">Bu akor seçimi (önceki akordan geçiş) — kişisel geri bildirim:</span>
      <button data-act="fbChord" data-v="1" title="beğen">👍</button><button data-act="fbChord" data-v="-1" title="beğenme">👎</button></div>` : ''}
    <div class="row" style="margin-top:8px">Elle yaz: <input type="text" id="chInput" placeholder="ör. Dmaj7, C#m, F#m7/A" style="width:170px"> ${scopeSel}
      <button data-act="manualChord" class="accent">Uygula + kilitle</button></div>`;
}

// ---------------------------------------------------------------- bilgi satırları
function renderInfo() {
  const a = S.audio;
  $('#audioInfo').textContent = a ? `${a.name} · ${(a.data.length / a.sr).toFixed(1)} s · ${a.sr} Hz${S.proj.audio.source === 'record' ? ` · gecikme telafisi ${S.proj.settings.latencyMs} ms` : ''}` : 'Ses yok';
  const tu = S.d && S.d.tuning;
  $('#pitchInfo').textContent = S.d && S.rawNotes ? `${tu && !tu.off ? `Akort referansı: A4 ≈ ${tu.a4.toFixed(1)} Hz (${tu.global >= 0 ? '+' : ''}${tu.global.toFixed(0)} cent), zamanla kayma ${tu.driftMin.toFixed(0)}…+${tu.driftMax.toFixed(0)} cent · ` : 'Akort referansı: A4 = 440 Hz · '}${S.d.notes.length} nota · ${S.d.notes.filter((n) => !n.inScale).length} scale dışı · ${S.d.notes.filter((n) => n.label != null).length} etiket · ${S.d.notes.filter((n) => n.manualTarget != null).length} manuel` : '';
  const at = S.proj.autotune;
  const nAuto = S.d ? S.d.notes.filter((n) => n.corr && n.corr.source === 'auto' && Math.abs(n.corr.applied) >= 1).length : 0;
  const ns = S.d ? S.d.notes : [];
  const cnt = {
    move: ns.filter((n) => n.manualTarget != null && n.label != null && n.label === Math.round(n.manualTarget)).length,
    fine: ns.filter((n) => n.manualTarget != null && !(n.label != null && n.label === Math.round(n.manualTarget))).length,
    label: ns.filter((n) => n.label != null && !(n.manualTarget != null && n.label === Math.round(n.manualTarget))).length,
    atOff: ns.filter((n) => n.locked && n.manualTarget == null).length,
    time: ns.filter((n) => n.q0to != null).length,
  };
  const row = (k, txt, what) => cnt[k] ? `<div class="rm-row"><span>${txt} <b>${cnt[k]}</b></span><button class="danger" data-clear="${k}" data-what="${what}">✕ Hepsini geri al</button></div>` : '';
  const nSplit = (S.proj.noteSplits || []).length;
  const splitRow = nSplit ? `<div class="rm-row"><span>Çift tıkla bölünen yer: <b>${nSplit}</b></span><button class="danger" data-clear="splits" data-what="bölmeler">✕ Hepsini geri al</button></div>` : '';
  const sum = splitRow + row('move', 'Taşınan nota:', 'taşımalar') + row('fine', 'Elle ince akort:', 'ince akortlar') + row('label', 'Etiket düzeltmesi:', 'etiketler') + row('atOff', 'Autotune\'un dokunmadığı (kilitli) nota:', 'autotune kilitleri') + row('time', 'Zamanı kaydırılan (quantize / sürükleme) nota:', 'zaman kaydırmaları');
  $('#editSummary').innerHTML = sum ? `<div class="rm-bar"><div class="hint">Elle yapılan değişiklikler — tek tek geri almak için notaya tıkla</div>${sum}</div>` : (a ? '<p class="hint">Henüz elle değişiklik yok.</p>' : '');
  const avg = nAuto ? Math.round(ns.filter((n) => n.corr && n.corr.source === 'auto' && Math.abs(n.corr.applied) >= 1).reduce((s2, n) => s2 + Math.abs(n.corr.applied), 0) / nAuto) : 0;
  $('#renderInfo').textContent = !a ? '' : (at.enabled ? `Autotune AÇIK · ${nAuto} nota kaydırıldı (ortalama ${avg} cent)${cnt.move + cnt.fine + cnt.atOff ? ` · ${cnt.move + cnt.fine + cnt.atOff} notaya dokunmadı (elle / kilitli)` : ''}. ` : 'Autotune KAPALI. ') + (renderReady() ? 'Düzeltilmiş iz güncel.' : 'Render bekliyor…');
  $('#btnAutoApply').classList.toggle('on', at.enabled); $('#btnAutoOff').classList.toggle('on', !at.enabled);
  $('#btnAB').textContent = 'A/B: ' + (S.proj.mixer.ab === 'original' ? 'Orijinal' : 'Düzeltilmiş');
  $('#btnAB').classList.toggle('on', S.proj.mixer.ab === 'original');
  renderAlternatives();
  updateReadout();
}
// süreli Viterbi: her bölüm için birbirinden en az 2 ölçüde farklı en iyi 3 progresyon
function renderAlternatives() {
  const alts = S.d && S.d.chords && S.d.chords.alternatives;
  const box = $('#altBox');
  if (!alts || !Object.keys(alts).length) { box.innerHTML = ''; return; }
  box.innerHTML = S.d.sections.filter((s) => alts[s.id]).map((s) => `<div class="alt-sec"><b>${esc(s.name)}</b> <span class="hint">alternatif progresyonlar</span>
    ${alts[s.id].map((a) => `<label class="chk alt"><input type="radio" name="alt-${s.id}" data-sec="${s.id}" value="${a.index}"${a.chosen ? ' checked' : ''}> <span>${esc(a.text)} <small class="hint">puan ${a.score.toFixed(1)}</small></span></label>`).join('')}</div>`).join('');
}
$('#altBox').addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset.sec) return;
  S.proj.chordOpts.altChoice = Object.assign({}, S.proj.chordOpts.altChoice, { [t.dataset.sec]: +t.value });
  refresh();
  status(`Alternatif ${+t.value + 1} seçildi.`);
});

// ---------------------------------------------------------------- giriş alanları
function syncInputs() {
  const p = S.proj;
  $('#inBpm').value = p.settings.bpm; $('#inMeter').value = p.settings.meter; $('#inLatency').value = p.settings.latencyMs;
  const gq = C.makeGrid(p.settings);
  $('#inClickFeel').value = p.settings.clickFeel || 'normal';
  { const r = (p.swing && p.swing.ratio) || 0.5, m = swingMode(r); $('#inSubdiv').value = m; $('#swingWrap').hidden = m === 'straight'; if (document.activeElement !== $('#inSwing')) $('#inSwing').value = Math.round(r * 100); }
  $('#inOnlyMarked').checked = !!p.chordOpts.onlyMarked;
  $('#inDownbeatOnly').checked = !!p.chordOpts.downbeatOnly;
  $('#inClickFeel').disabled = p.settings.meter !== '4/4';
  $('#bpmUnit').textContent = p.settings.meter === '6/8' ? `(♩. = noktalı çeyrek; ♩ = ${Math.round(gq.quarterBpm)})` : '(♩ = çeyrek nota)';
  $('#inOffset').value = Math.round(p.audio.offsetSec * 1000);
  if (p.audio.alignMode) $('#inAlign').value = p.audio.alignMode;
  { // öncü vuruş seçenekleri ölçüye göre (4/4: 1–4, 3/4: 1–3, 6/8: 1–2 noktalı çeyrek)
    const gq = C.makeGrid(p.settings), beats = Math.round(gq.barQ / gq.pulseQ), sel = $('#inPickupBeat');
    if (sel.options.length !== beats) sel.innerHTML = Array.from({ length: beats }, (_, i) => `<option value="${i + 1}">${i + 1}. vuruş</option>`).join('');
    sel.value = String(C.clamp(p.audio.pickupBeat || 3, 1, beats));
    $('#pickupWrap').hidden = p.audio.alignMode !== 'pickup';
  }
  $('#inFmin').value = p.pitch.fmin; $('#inFmax').value = p.pitch.fmax; $('#inSilence').value = p.pitch.silenceDb;
  $('#inMinNote').value = p.pitch.minNoteMs; $('#inChange').value = p.pitch.changeSemis;
  $('#inTuning').value = p.pitch.tuning || 'auto'; $('#inTuneWin').value = p.pitch.tuningWindowSec ?? 8;
  $('#inAmount').value = p.autotune.amount; $('#outAmount').textContent = p.autotune.amount + '%';
  $('#inRetune').value = p.autotune.retuneMs; $('#outRetune').textContent = p.autotune.retuneMs + ' ms';
  $('#inKeepVib').checked = p.autotune.keepVibrato; $('#inSkipChrom').checked = p.autotune.skipChromatic;
  document.querySelectorAll('input[name=atTarget]').forEach((r) => { r.checked = r.value === (p.autotune.target || 'semitone'); });
  $('#scaleWarn').hidden = p.autotune.target !== 'scale';
  $('#inSkipChrom').disabled = p.autotune.target !== 'scale';
  $('#inPct').value = p.chordOpts.changePct; $('#outPct').textContent = '%' + p.chordOpts.changePct; $('#inMaxBars').value = p.chordOpts.maxBars;
  $('#inEngine').value = p.chordOpts.engine || 'greedy';
  $('#inHomeEvery').value = p.chordOpts.homeEvery; $('#inColorPen').value = p.chordOpts.colorPenalty; $('#outColorPen').textContent = p.chordOpts.colorPenalty;
  $('#inPedal').checked = p.mixer.pedal; $('#inPlayClick').checked = p.mixer.click;
  { const pp = Object.assign({}, C.PIANO_DEFAULTS, p.piano || {});
    $('#inPianoStyle').value = pp.style; $('#inPianoRepeat').value = pp.repeat; $('#inHoldBars').value = pp.holdBars; $('#inArpRate').value = pp.rate;
    $('#arpWrap').hidden = !/arp$/.test(pp.style); $('#holdWrap').hidden = pp.repeat === 'off'; }
  p.quant = p.quant || { grid: '1/8', strength: 100 };
  $('#inQuantGrid').value = p.quant.grid; $('#inQuantStrength').value = p.quant.strength; $('#outQuantStrength').textContent = '%' + p.quant.strength;
  p.mixer.drums = p.mixer.drums || { vol: -8, mute: false, solo: false };
  p.mixer.bass = p.mixer.bass || { vol: -5, mute: false, solo: false };
  $('#inDrumFills').checked = p.drums.fills !== false;
  for (const tr of ['vocal', 'piano', 'drums', 'bass']) {
    const strip = document.querySelector(`.strip[data-track=${tr}]`), m = p.mixer[tr];
    strip.querySelector('.vol').value = m.vol; strip.querySelector('output').textContent = m.vol + ' dB';
    strip.querySelector('.mute').classList.toggle('on', m.mute); strip.querySelector('.solo').classList.toggle('on', m.solo);
  }
}
const onNum = (id, fn) => $(id).addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) fn(v); });
onNum('#inBpm', (v) => { S.proj.settings.bpm = C.clamp(v, 30, 300); applyAlign(); syncInputs(); refresh(); });
$('#inMeter').addEventListener('change', (e) => { /* BPM birimi syncInputs'ta güncellenir */ S.proj.settings.meter = e.target.value; S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.half == null || C.METERS[e.target.value].split); applyAlign(); syncInputs(); refresh(); });
onNum('#inLatency', (v) => { S.proj.settings.latencyMs = v; refresh(); });
onNum('#inOffset', (v) => { S.proj.audio.offsetSec = v / 1000; S.proj.audio.alignMode = 'none'; $('#inAlign').value = 'none'; refresh(); });
$('#inPickupBeat').addEventListener('change', (e) => { S.proj.audio.pickupBeat = +e.target.value; S.proj.audio.alignMode = 'pickup'; applyAlign(); syncInputs(); refresh(); });
$('#inAlign').addEventListener('change', (e) => { if (e.target.value === 'pickup' && !S.proj.audio.pickupBeat) S.proj.audio.pickupBeat = +$('#inPickupBeat').value || 3; S.proj.audio.alignMode = e.target.value; if (e.target.value === 'none' && S.proj.audio.source === 'file') S.proj.audio.offsetSec = 0;
  if (e.target.value === 'none' && S.proj.audio.source === 'record' && S.proj.audio.recOffsetSec != null) S.proj.audio.offsetSec = S.proj.audio.recOffsetSec; applyAlign(); syncInputs(); refresh(); });
$('#btnLatencyGuess').onclick = () => {
  const ctx = getCtx();
  const ms = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) + 10;
  S.proj.settings.latencyMs = ms; syncInputs(); refresh();
  status(`Tahmini gecikme ${ms} ms (çıkış + ~10 ms giriş). Daha doğrusu için "Kalibre et".`);
};
// akor / davul girişi, şarkıyı kaydır
onNum('#inChordStart', (v) => setStartBar('chord', v));
onNum('#inDrumStart', (v) => setStartBar('drum', v));
$('#btnChordHere').onclick = () => setStartBar('chord', barAtPlayhead());
$('#btnDrumHere').onclick = () => setStartBar('drum', barAtPlayhead());
$$('[data-shift]').forEach((b) => { b.onclick = () => shiftSongBars(+b.dataset.shift); });
// akor sesi: piyano / synth klavye × akor / arpej, aynı akorun tekrarı
const pianoSet = (k, v) => { S.proj.piano[k] = v; syncInputs(); if (Player.playing) Player.play(); };
$('#inPianoStyle').addEventListener('change', (e) => pianoSet('style', e.target.value));
$('#inPianoRepeat').addEventListener('change', (e) => pianoSet('repeat', e.target.value));
$('#inArpRate').addEventListener('change', (e) => pianoSet('rate', e.target.value));
onNum('#inHoldBars', (v) => pianoSet('holdBars', C.clamp(Math.round(v), 1, 16)));
$('#inBassOn').addEventListener('change', (e) => { S.proj.bass.on = e.target.checked; refresh(); if (Player.playing) Player.play(); });
$('#inBassPattern').addEventListener('change', (e) => { S.proj.bass.pattern = e.target.value; refresh(); if (Player.playing) Player.play(); });
$('#inDrumFills').addEventListener('change', (e) => { S.proj.drums.fills = e.target.checked; refresh(); if (Player.playing) Player.play(); });
$('#btnDrumNext').onclick = () => arrNext('drums', null);
$('#btnBassNext').onclick = () => arrNext('bass', null);
$('#btnStyleNext').onclick = () => arrNext('piano', null);
$('#btnLoop').onclick = () => toggleLoop();
$('#btnDemo').onclick = () => makeDemo();
$('#btnUndo').onclick = () => histUndo();
$('#btnRedo').onclick = () => histRedo();
const pitchInput = (id, key) => onNum(id, (v) => { S.proj.pitch[key] = v; });
pitchInput('#inFmin', 'fmin'); pitchInput('#inFmax', 'fmax'); pitchInput('#inSilence', 'silenceDb'); pitchInput('#inMinNote', 'minNoteMs'); pitchInput('#inChange', 'changeSemis');
$('#btnAnalyze').onclick = () => analyze();
$('#inTuning').addEventListener('change', (e) => { S.proj.pitch.tuning = e.target.value; refresh(); });
onNum('#inTuneWin', (v) => { S.proj.pitch.tuningWindowSec = Math.max(2, v); refresh(); });
$('#inAmount').addEventListener('input', (e) => { S.proj.autotune.amount = +e.target.value; $('#outAmount').textContent = e.target.value + '%'; if (S.proj.autotune.enabled) refresh(); });
$('#inRetune').addEventListener('input', (e) => { S.proj.autotune.retuneMs = +e.target.value; $('#outRetune').textContent = e.target.value + ' ms'; if (S.proj.autotune.enabled) refresh(); });
$('#inKeepVib').addEventListener('change', (e) => { S.proj.autotune.keepVibrato = e.target.checked; if (S.proj.autotune.enabled) refresh(); });
$('#inSkipChrom').addEventListener('change', (e) => { S.proj.autotune.skipChromatic = e.target.checked; if (S.proj.autotune.enabled) refresh(); });
document.querySelectorAll('input[name=atTarget]').forEach((r) => r.addEventListener('change', (e) => {
  S.proj.autotune.target = e.target.value;
  $('#scaleWarn').hidden = e.target.value !== 'scale';
  $('#inSkipChrom').disabled = e.target.value !== 'scale';
  refresh();
  if (e.target.value === 'scale') status('Uyarı: scale\'e çekme notaların kimliğini değiştirebilir (bkz. kırmızı uyarı).', 'err');
}));
$('#btnAutoApply').onclick = () => { S.proj.autotune.enabled = true; refresh(); scheduleRender(true); };
$('#btnAutoOff').onclick = () => { S.proj.autotune.enabled = false; refresh(); scheduleRender(true); };
// ---- kendi akor şablonun: metin / .txt → kilitli akorlar (src: 'chart'); diğer akorlar sabit kalır
function applyChart(text) {
  const msg = $('#chartMsg');
  if (!S.d || !S.rawNotes || !S.d.notes.length) { msg.innerHTML = '<div class="st-warn">⚠ Önce kaydını yükle ya da kaydet: akorlar melodinin üzerine yerleşir.</div>'; return false; }
  const r = C.parseChordChart(text, S.proj.settings.meter);
  if (r.errors.length) {
    msg.innerHTML = `<div class="st-warn adv-imp">⚠ Şablon uygulanmadı — düzeltilmesi gerekenler:<ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    status('Şablonda hata var; uygulanmadı.', 'err');
    return false;
  }
  const notes = [...r.warnings];
  // bölümler: başlık + ölçü aralığı çakışmıyorsa oluştur; aynı aralıkta tonu boş bölüme ton yaz
  let created = 0;
  for (const ps of r.sections) {
    const end = Math.min(ps.endBar, S.d.bars);
    if (ps.startBar > S.d.bars) continue;
    const ov = S.proj.sections.filter((x) => !(end < x.startBar || ps.startBar > x.endBar));
    if (!ov.length) { S.proj.sections.push({ id: uid(), name: ps.name, startBar: ps.startBar, endBar: end, tonic: ps.tonic, mode: ps.mode }); created++; continue; }
    const ex = ov.find((x) => x.startBar === ps.startBar && x.endBar === end);
    if (ex && ps.tonic != null && ex.tonic == null) { ex.tonic = ps.tonic; ex.mode = ps.mode; }
    else if (ex && ps.tonic != null && (ex.tonic !== ps.tonic || ex.mode !== ps.mode)) notes.push(`"${ex.name}" bölümünün tonu ${C.keyName(ex.tonic, ex.mode)}; şablondaki ${C.keyName(ps.tonic, ps.mode)} uygulanmadı (4. adımdan değiştirebilirsin).`);
  }
  if (created) { S.proj.sections.sort((a, b) => a.startBar - b.startBar); refresh(); }
  const cells = r.cells.filter((c) => c.chord && c.bar >= 1 && c.bar <= S.d.bars);
  const over = r.cells.filter((c) => c.chord && c.bar > S.d.bars).length;
  if (over) notes.push(`Şablon ${r.bars} ölçü, kayıt ${S.d.bars} ölçü: fazladan ${over} akor yok sayıldı.`);
  if (!cells.length) { msg.innerHTML = '<div class="st-warn">⚠ Yerleştirilecek akor bulunamadı.</div>'; return false; }
  const cov = (b, h) => cells.some((c) => c.bar === b && (c.half == null || h == null || c.half === h));
  pinOthers(cov);
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => !cov(p.bar, p.half));
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !cov(l.bar, l.half));
  for (const c of cells) S.proj.chordLocks.push({ bar: c.bar, half: c.half, chord: { root: c.chord.root, q: c.chord.q, bass: c.chord.bass ?? null }, src: 'chart' });
  refresh();
  const bars = new Set(cells.map((c) => c.bar)).size;
  msg.innerHTML = `<div class="adv-opt">✓ ${cells.length} akor ${bars} ölçüye kilitli olarak yerleşti${created ? `, ${created} bölüm oluşturuldu` : ''}. ▶ Oynat ile melodinin üzerinde dinle. Boş bıraktığın ölçüler otomatik.</div>${notes.length ? `<div class="st-warn">⚠ Notlar:<ul>${notes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
  status(`Şablon uygulandı: ${cells.length} akor, ${bars} ölçü.`);
  return true;
}
$('#btnChartApply').onclick = () => applyChart($('#chartText').value);
$('#fileChart').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const t = await f.text();
  $('#chartText').value = t; $('#chartBox').open = true;
  applyChart(t);
});
$('#btnChartBlank').onclick = () => { if (!needData()) return; const t = C.blankChart(S.proj, S.d); $('#chartText').value = t; $('#chartBox').open = true; download(t, 'akor-sablonu.txt', 'text/plain;charset=utf-8'); };
$('#btnChartCurrent').onclick = () => { if (!needData()) return; const t = '# Şu anki akorlar — düzenleyip "Zaman çizelgesine uygula" ya da .txt olarak geri yükle\n' + C.chordChart(S.proj, S.d); $('#chartText').value = t; $('#chartBox').open = true; download(t, 'akor-sablonu.txt', 'text/plain;charset=utf-8'); };
$('#btnChartRemove').onclick = () => {
  const n = S.proj.chordLocks.filter((l) => l.src === 'chart').length;
  if (!n) return;
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.src !== 'chart'); refresh();
  $('#chartMsg').innerHTML = `<div class="adv-opt">Şablondan gelen ${n} akor kaldırıldı; o ölçüler otomatiğe döndü.</div>`;
};
$('#inOnlyMarked').addEventListener('change', (e) => { S.proj.chordOpts.onlyMarked = e.target.checked; refresh(); });
$('#inDownbeatOnly').addEventListener('change', (e) => { S.proj.chordOpts.downbeatOnly = e.target.checked; refresh(); });
$('#btnClearMarks').onclick = () => { const n = (S.proj.changeMarks || []).length; S.proj.changeMarks = []; refresh(); status(`${n} değişim işareti kaldırıldı (akorlar yerinde kaldı).`); };
$('#btnApplySug').onclick = () => {
  const n = S.d.chords.filter((c) => c.pinSuggest).length;
  S.proj.chordPins = []; refresh();
  status(`Motorun ${n} önerisi uygulandı: kilitlerin dışındaki akorlar yeniden hesaplandı.`);
};
$('#btnUnlockAll').onclick = () => {
  const n = S.proj.chordLocks.length;
  if (!n) return;
  S.proj.chordLocks = []; S.proj.chordPins = []; refresh();
  status(`${n} akor kilidi kaldırıldı; bütün akorlar otomatiğe döndü.`);
};
const isMoveEdit = (e) => e.target != null && e.label != null && e.label === Math.round(e.target);
function clearEdits(kind) {
  if (kind === 'splits') {
    for (const t of [...(S.proj.noteSplits || [])]) C.removeNoteSplit(S.proj, t, S.d.g.spq);
    resegment(); cleanupEdits(); refresh(); scheduleRender(true);
    return;
  }
  for (const e of S.proj.noteEdits) {
    if (kind === 'move' && isMoveEdit(e)) { e.target = null; e.label = null; e.locked = false; }
    if (kind === 'fine' && e.target != null && !isMoveEdit(e)) { e.target = null; e.locked = false; }
    if (kind === 'label' && e.label != null && !isMoveEdit(e)) e.label = null;
    if (kind === 'atOff' && e.target == null) e.locked = false;
    if (kind === 'time') e.q0to = null;
    if (kind === 'all') { e.target = null; e.label = null; e.locked = false; e.q0to = null; }
  }
  cleanupEdits(); refresh(); scheduleRender(true);
}
$('#btnClearManual').onclick = () => { clearEdits('move'); clearEdits('fine'); };
$('#editSummary').addEventListener('click', (e) => { const b = e.target.closest('button[data-clear]'); if (b) { clearEdits(b.dataset.clear); status('Kaldırıldı: ' + b.dataset.what + '.'); } });
$('#btnClearLabels').onclick = () => { S.proj.noteEdits.forEach((e) => { e.label = null; }); cleanupEdits(); refresh(); };
$('#inPct').addEventListener('input', (e) => { S.proj.chordOpts.changePct = +e.target.value; $('#outPct').textContent = '%' + e.target.value; refresh(); });
onNum('#inMaxBars', (v) => { S.proj.chordOpts.maxBars = Math.max(1, Math.round(v)); refresh(); });
onNum('#inHomeEvery', (v) => { S.proj.chordOpts.homeEvery = Math.max(0, Math.round(v)); refresh(); });
$('#inEngine').addEventListener('change', (e) => { S.proj.chordOpts.engine = e.target.value; refresh(); });
$('#inColorPen').addEventListener('input', (e) => { S.proj.chordOpts.colorPenalty = +e.target.value; $('#outColorPen').textContent = e.target.value; refresh(); });
$('#btnModeLabel').onclick = () => setEditMode('label');
$('#btnLatencyCal').onclick = () => Cal.run();
$('#btnUnlockChords').onclick = () => { S.proj.chordLocks = []; refresh(); };
$('#inPedal').addEventListener('change', (e) => { S.proj.mixer.pedal = e.target.checked; refresh(); });
$('#inClickFeel').addEventListener('change', (e) => { S.proj.settings.clickFeel = e.target.value; });
// alt bölme / swing
function setSwing(r, why) {
  S.proj.swing.ratio = Math.round(C.clamp(r, 0.5, 0.75) * 1000) / 1000;
  syncInputs(); refresh();
  const m = swingMode();
  status(`Alt bölme: ${m === 'straight' ? 'düz (%50)' : m === 'triplet' ? "üçleme (%67): her vuruş 3'e bölünür, 12/8 hissi" : `swing %${Math.round(swingR() * 100)}`}${why ? ' — ' + why : ''}. Davul, bas, akor desenleri, quantize ızgarası ve cetvel buna uydu.`);
  if (Player.playing) Player.play();
}
$('#inSubdiv').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'straight') setSwing(0.5); else if (v === 'triplet') setSwing(2 / 3); else setSwing(swingMode() === 'swing' ? swingR() : S.swingEst && S.swingEst.ratio > 0.52 ? S.swingEst.ratio : 0.62);
});
onNum('#inSwing', (v) => setSwing(v / 100));
$('#btnSwingMeasure').onclick = () => {
  if (!S.d || !S.d.notes.length) { status('Önce kayıt / analiz.', 'err'); return; }
  const est = C.estimateSwing(S.d.notes.map((n) => ({ q0: n.qOrig })), S.d.g);
  S.swingEst = est;
  const box = $('#swingInfo');
  if (!est) box.textContent = S.d.g.pulseQ !== 1 ? '6/8 ölçüsünde vuruş zaten üçe bölünür; swing ölçülmez.' : 'Ölçülemedi: zayıf vuruşa düşen en az 4 nota (ve ≥ 8 nota) gerekir. Ölçü çizgileri / BPM kayıksa önce onları düzelt.';
  else box.innerHTML = `Bu kayıtta zayıf vuruşlar vuruşun <b>%${Math.round(est.ratio * 100)}</b>'inde (${est.n}/${est.of} nota, sapma ±%${Math.round(est.spread * 100)}${est.confident ? '' : ' — az güvenilir'}). <span class="hint">%50 düz, %67 saf üçleme.</span> <button id="btnSwingApply" class="small">%${Math.round(est.ratio * 100)} uygula</button>`;
};
$('#swingInfo').addEventListener('click', (e) => { if (e.target.closest('#btnSwingApply') && S.swingEst) setSwing(S.swingEst.ratio, 'ölçülen oran uygulandı'); });
$('#inPlayClick').addEventListener('change', (e) => { S.proj.mixer.click = e.target.checked; });
$$('input[name=editMode]').forEach((r) => r.addEventListener('change', (e) => setEditMode(e.target.value)));
function setEditMode(m) {
  S.editMode = m;
  $$('input[name=editMode]').forEach((r) => { r.checked = r.value === m; });
}
$$('.strip').forEach((strip) => {
  const tr = strip.dataset.track, m = () => S.proj.mixer[tr];
  strip.querySelector('.vol').addEventListener('input', (e) => { m().vol = +e.target.value; strip.querySelector('output').textContent = e.target.value + ' dB'; Player.applyMixer(); });
  strip.querySelector('.mute').onclick = (e) => { m().mute = !m().mute; e.target.classList.toggle('on', m().mute); Player.applyMixer(); };
  strip.querySelector('.solo').onclick = (e) => { m().solo = !m().solo; e.target.classList.toggle('on', m().solo); Player.applyMixer(); };
});
$('#inZoom').addEventListener('input', (e) => { const W = sc.clientWidth; setZoom(+e.target.value, xToQ(W / 2), W / 2); });

// ---------------------------------------------------------------- üst çubuk
$('#btnPlay').onclick = () => (Player.playing ? (Player.stop(), updateReadout()) : Player.play());
$('#btnStop').onclick = () => { Player.stop(); S.pos = 0; sc.scrollLeft = 0; updateReadout(); draw(); };
$('#btnAB').onclick = () => { S.proj.mixer.ab = S.proj.mixer.ab === 'original' ? 'corrected' : 'original'; Player.applyMixer(); renderInfo(); };
$('#btnRec').onclick = () => Rec.start();
$('#btnRecStop').onclick = () => Rec.stop();
$('#fileAudio').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadAudioFile(f); });
$('#btnTest').onclick = () => loadTest();
$('#btnNew').onclick = () => {
  if (S.audio && !confirm('Yeni proje? Kaydedilmemiş değişiklikler kaybolur.')) return;
  Player.stop(true); HIST.reset = true; S.loop.on = false; $('#btnLoop').classList.remove('on');
  S.proj = C.newProject(); S.audio = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0;
  syncInputs(); refresh(); status('Yeni proje.');
};
$('#btnSave').onclick = () => saveProject();
$('#btnOpen').onclick = () => $('#fileProject').click();
$('#fileProject').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openProject(f); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) histRedo(); else histUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); histRedo(); return; }
  if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); return; }
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); addTap(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && S.d && S.d.notes.length) { e.preventDefault(); selectNotes(S.d.notes.map((n) => n.id)); status(`${S.d.notes.length} nota seçildi.`); return; }
  if (!S.sel) return;
  if (S.sel.type === 'note' || S.sel.type === 'notes') {
    const ns = selNotes();
    if (!ns.length) return;
    const n = ns[0], multi = ns.length > 1;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.editMode !== 'select') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      if (S.editMode === 'label' || e.altKey) { if (multi) groupLabel(ns, dir); else { const ed = editFor(n, true); const R = n.effMidi + dir; ed.label = R !== n.nearest ? R : null; cleanupEdits(); refresh(); NotePreview.play(n, NotePreview.current(n), R); } }
      else if (e.shiftKey) { if (multi) groupFine(ns, dir * 0.05); else soundEdit(n, (t) => Math.round((t + dir * 0.05) * 100) / 100); }
      else if (multi) groupMove(ns, dir);
      else moveNote(n, n.effMidi + dir);
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); groupNudge(ns, e.key === 'ArrowRight' ? 1 : -1); }
    if (e.key === 'l' || e.key === 'L') { const lock = !ns.every((k) => k.locked); groupEdit(ns, (k, ed) => { ed.locked = lock; }); }
  }
  if (S.sel.type === 'chord' && (e.key === 'Delete' || e.key === 'Backspace')) {
    const slot = S.d.chords.find((x) => S.sel.q >= x.q0 && S.sel.q < x.q1);
    if (slot && slot.locked) { e.preventDefault(); unlockSlot(slot); }
    return;
  }
  if (S.sel.type === 'section' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteSection(S.sel.id); return; }
  if (e.key === 'Escape') select(null);
});

// ---------------------------------------------------------------- test melodisi
async function loadTest() {
  Player.stop(true);
  const t = C.synthTestVocal(44100);
  S.proj = C.newProject();
  S.proj.settings.bpm = t.bpm; S.proj.settings.meter = t.meter;
  S.proj.sections = t.sections.map((s) => ({ id: uid(), name: s.name, startBar: s.startBar, endBar: s.endBar, tonic: null, mode: null }));
  setAudio(t.signal, t.sr, 'Test melodisi (sentetik vokal)', 'test');
  S.proj.audio.offsetSec = t.offsetSec;
  S.sel = null;
  syncInputs();
  await analyze();
  status('Test melodisi hazır → 4. adımda önerileri onaylayın, 5. adımda autotune uygulayın.');
}

// ---------------------------------------------------------------- proje dosyası
function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function saveProject() {
  const p = JSON.parse(JSON.stringify(S.proj));
  p.savedAt = new Date().toISOString();
  if ($('#chkEmbed').checked && S.audio) {
    const wav = C.encodeWav([S.audio.data], S.audio.sr);
    p.audioData = { name: S.audio.name, sr: S.audio.sr, wavBase64: C.bytesToBase64(new Uint8Array(wav)) };
  }
  download(JSON.stringify(p), 'mini-daw-proje.json', 'application/json');
  status('Proje kaydedildi (ayarlar, bölümler, düzeltmeler, kilitler' + (p.audioData ? ', orijinal ses' : '') + ').');
}
function mergeDefaults(base, p) {
  for (const k of Object.keys(p)) {
    if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) mergeDefaults(base[k], p[k]);
    else base[k] = p[k];
  }
  return base;
}
async function openProject(file) {
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { status('Proje dosyası okunamadı: ' + e.message, 'err'); return; }
  Player.stop(true); HIST.reset = true;
  const audioData = p.audioData;
  delete p.audioData; delete p.savedAt;
  S.proj = mergeDefaults(C.newProject(), p);
  S.audio = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0;
  if (audioData) {
    const w = C.decodeWav(C.base64ToBytes(audioData.wavBase64).buffer);
    S.audio = { data: w.data, sr: w.sr, name: audioData.name };
    Player.buffersDirty = true;
  }
  syncInputs();
  await analyze();
  status(`Proje açıldı${audioData ? '' : ' (ses gömülü değildi — kaydı yeniden yükleyin)'}.`);
}

// ---------------------------------------------------------------- dışa aktarım
function needData() { if (!S.d || !S.audio) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return false; } return true; }
function alignedVocal(src, sr, lenSec) {
  const n = Math.round(lenSec * sr), out = new Float32Array(n), o = Math.round(S.d.off * sr);
  for (let i = 0; i < n; i++) { const j = i + o; if (j >= 0 && j < src.length) out[i] = src[j]; }
  return out;
}
const exportLenSec = () => Math.max(S.d.bars * S.d.g.barSec, S.audio.data.length / S.audio.sr - S.d.off) + 1.5;
async function ensureRendered() {
  if (!renderReady()) { clearTimeout(renderTimer); await doRender(); }
}
$('#btnExpMidi').onclick = () => { if (!needData()) return; { const dev = drumEventsAll(), bev = bassEventsAll(), L = currentLoop();
  download(C.exportMidi(S.proj, S.d, dev.length ? { name: L ? L.name : 'loop', events: dev } : null, bev), 'akorlar-ve-melodi.mid', 'audio/midi');
  status(`MIDI dışa aktarıldı (tempo, ölçü, bölüm işaretleri, melodi + akor izi${bev.length ? ' + bas' : ''}${dev.length ? ' + davul' : ''}).`); } };
$('#btnExpChart').onclick = () => { if (!needData()) return; download(C.chordChart(S.proj, S.d), 'akor-semasi.txt', 'text/plain;charset=utf-8'); };
$('#btnExpVocal').onclick = async () => {
  if (!needData()) return;
  await ensureRendered();
  const v = alignedVocal(S.corrected || S.audio.data, S.audio.sr, exportLenSec());
  download(new Blob([C.encodeWav([v], S.audio.sr)], { type: 'audio/wav' }), 'duzeltilmis-vokal.wav');
  status('Düzeltilmiş vokal WAV (1. ölçü başından hizalı) dışa aktarıldı.');
};
$('#btnExpMix').onclick = async () => {
  if (!needData()) return;
  await ensureRendered();
  await busy('Mix render ediliyor…', async () => {
    const piano = await loadPianoSamples();
    const sr = 44100, lenSec = exportLenSec(), n = Math.round(lenSec * sr);
    const src = S.proj.mixer.ab === 'original' ? S.audio.data : S.corrected || S.audio.data;
    const vocal = alignedVocal(S.audio.sr === sr ? src : C.resample(src, S.audio.sr, sr), sr, lenSec);
    const ev = pianoEventsAll();
    const pno = C.renderPiano(ev.filter((e) => e.inst !== 'synth'), piano.samples, sr, n, 0.35);
    const syn = C.renderSynth(ev.filter((e) => e.inst === 'synth'), sr, n, 1);
    for (let i = 0; i < n; i++) pno[i] += syn[i];
    const m = S.proj.mixer, anySolo = m.vocal.solo || m.piano.solo || m.drums.solo || m.bass.solo;
    const gain = (k) => (m[k].mute || (anySolo && !m[k].solo) ? 0 : dbToGain(m[k].vol));
    const gv = gain('vocal'), gp = gain('piano');
    const gd = !anyDrums() ? 0 : gain('drums'), gb = !anyBass() ? 0 : gain('bass');
    const drm = gd ? C.renderDrums(drumEventsAll(), sr, n, 1) : null;
    const bas = gb ? C.renderBass(bassEventsAll(), sr, n, 1) : null;
    const mix = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) { mix[i] = vocal[i] * gv + pno[i] * gp + (drm ? drm[i] * gd : 0) + (bas ? bas[i] * gb : 0); peak = Math.max(peak, Math.abs(mix[i])); }
    if (peak > 0.98) for (let i = 0; i < n; i++) mix[i] *= 0.98 / peak;
    download(new Blob([C.encodeWav([mix, mix], sr)], { type: 'audio/wav' }), 'vokal-piyano-mix.wav');
  });
  status(`Vokal + ${C.pianoOpts(S.proj.piano).inst === 'synth' ? 'synth' : 'piyano'}${anyBass() ? ' + bas' : ''}${anyDrums() ? ' + davul' : ''} mix WAV dışa aktarıldı.`);
};

// ---------------------------------------------------------------- başlangıç
setEditMode('sound'); // varsayılan: notayı sürükleyerek taşı
syncInputs();
refresh();
loadPianoSamples(); // hangi piyanonun çalacağı baştan görünsün
status('Hazır. Kayıt yapın, dosya yükleyin ya da test melodisi üretin.');
})();

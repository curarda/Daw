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
  customSection: null,
  sel: null,              // {type:'note', id} | {type:'chord', q} | {type:'section', id}
  editMode: 'sound', // sürükleyince: 'sound' = notayı taşı (varsayılan), 'label' = yalnızca etiket, 'select' = yalnızca seç
  view: { pxPerQ: 44 },
  pos: 0,                 // oynatma imleci (zaman çizelgesi saniyesi)
  drag: null,
  midi: null,             // .mid'den açılan proje: { name, bytes, notes:[{q0,q1,midi,vel}], endQ, tracks, trackIndex, warnings } (ses yok; melodi MIDI notalarından)
  loop: { on: false, from: 0, to: 0 }, // döngüde çalma: [from, to) saniye (zaman çizelgesi)
};
window.__daw = S; // hata ayıklama / testler için
window.__dawCal = () => Cal.last;
const soundSettings = C.createSoundSettings();
let soundNetwork = C.createNetwork({ settings: soundSettings });

const REAL = { generation: 0, decoded: {}, sampleRates: {}, signature: '', source: null, injected: null };
const soundCache = C.createSoundCache();
const DRUM_NATIVE = new WeakMap();
const DRUM_REAL = { generation: 0, signature: '', project: null, states: {}, messages: {}, injected: null };
const realSoundDeps = () => DRUM_REAL.injected || REAL.injected || {};
const realSoundRuntime = C.createRealSoundsRuntime({
  network: { freesoundPreview: (id) => (realSoundDeps().network || soundNetwork).freesoundPreview(id) },
  cache: { get: (...args) => (realSoundDeps().cache || soundCache).get(...args), put: (...args) => (realSoundDeps().cache || soundCache).put(...args) },
  decode: (bytes) => (realSoundDeps().decode || decodeSoundPreview)(bytes),
  hasKey: () => realSoundDeps().hasKey ? realSoundDeps().hasKey() : !!soundSettings.get().freesoundKey,
  onStatus({ lane, state, message }) {
    DRUM_REAL.states[lane] = state; DRUM_REAL.messages[lane] = message;
    renderSoundSelection();
  }
});
function cancelRealSoundPreparation() {
  DRUM_REAL.generation++; realSoundRuntime.invalidate(DRUM_REAL.generation);
  DRUM_REAL.states = {}; DRUM_REAL.messages = {};
}
function syncRealSoundGeneration() {
  const signature = C.realDrumSignature(S.proj);
  if (DRUM_REAL.project !== S.proj || DRUM_REAL.signature !== signature) {
    cancelRealSoundPreparation(); DRUM_REAL.project = S.proj; DRUM_REAL.signature = signature;
  }
  return DRUM_REAL.generation;
}
async function prepareRealSounds(project, generation) {
  return realSoundRuntime.prepareRealSounds(project, generation);
}
async function prepareCurrentRealSounds() {
  const generation = syncRealSoundGeneration(), project = S.proj;
  const snapshot = await prepareRealSounds(project, generation);
  return snapshot;
}
function liveDrumBank(snapshot, rate) {
  const bank = { ...Player.synthDrumBufs }, leases = new Map();
  for (const [lane, pcm] of Object.entries(snapshot.bank(rate))) {
    const release = realSoundRuntime.reserve(pcm.byteLength);
    if (!release) { DRUM_REAL.states[lane] = 'hata'; DRUM_REAL.messages[lane] = lane + ': Bellek sınırı; sentetik davul kullanılıyor.'; continue; }
    try { bank[lane] = toAudioBuffer(pcm, rate); leases.set(lane, { refs: 1, release }); }
    catch (_) { release(); DRUM_REAL.states[lane] = 'hata'; DRUM_REAL.messages[lane] = lane + ': Ses tamponu hazırlanamadı; sentetik davul kullanılıyor.'; }
  }
  DRUM_NATIVE.set(bank, leases); renderSoundSelection(); return bank;
}
function releaseLiveDrumBank(bank) {
  const leases = DRUM_NATIVE.get(bank);
  if (!leases) return;
  for (const lease of leases.values()) if (--lease.refs === 0) lease.release();
  DRUM_NATIVE.delete(bank);
}
async function applyRealSoundsNow() {
  REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = '';
  const project = S.proj, generation = syncRealSoundGeneration();
  const snapshot = await prepareRealSounds(project, generation); snapshot.release();
  if (project === S.proj && generation === DRUM_REAL.generation && Player.playing) void Player.play({ from: S.pos });
}

function invalidateSoundSelection(keepDecoded = false) {
  cancelRealSoundPreparation();
  REAL.generation++;
  if (!keepDecoded) { REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = ''; }
  if (!keepDecoded && REAL.source) { try { REAL.source.stop(); } catch (_) {} REAL.source = null; }
  $('#soundSelectStatus').textContent = '';
}
async function decodeSoundPreview(bytes) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
  return { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate };
}
function renderSoundSelection() {
  syncRealSoundGeneration();
  const rs = C.normalizeRealSounds(S.proj.realSounds), hasKey = !!soundSettings.get().freesoundKey;
  $('#btnSoundSelect').disabled = !hasKey;
  $('#btnSoundReroll').disabled = !hasKey || !Object.keys(rs.drums).length;
  $('#soundSelectHint').textContent = hasKey ? (soundSettings.get().geminiKey ? 'Gemini arama ve seçim önerir; hata olursa deterministik seçim kullanılır.' : 'Gemini anahtarı yok: deterministik CC0 seçimi kullanılır.') : 'Önce Freesound API anahtarını kaydet.';
  $('#inRealSounds').checked = rs.enabled;
  $('#chipRealSounds').textContent = rs.enabled ? 'açık' : 'kapalı';
  const signature = JSON.stringify(rs.drums);
  if (REAL.signature && REAL.signature !== signature) { REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = ''; }
  $('#soundKitList').innerHTML = Object.keys(rs.drums).length ? C.DRUM_KINDS.map((lane) => {
    const r = rs.drums[lane];
    if (!r) return `<div data-sound-lane="${lane}"><b>${lane}</b> <span data-sound-state="${lane}">sentetik</span></div>`;
    return `<div data-sound-lane="${lane}"><b>${lane}</b> <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a> — ${esc(r.author)} — CC0 <span data-sound-state="${lane}">${rs.enabled ? (DRUM_REAL.states[lane] || 'sentetik') : 'sentetik'}</span> <button data-sound-preview="${lane}" ${REAL.decoded[lane] ? '' : 'disabled'} aria-label="${lane} önizle">▶</button>${r.selector === 'gemini' ? `<p class="hint" data-sound-why="${lane}"></p>` : ''}</div>`;
  }).join('') : '';
  for (const [lane, r] of Object.entries(rs.drums)) { const el = $(`[data-sound-why="${lane}"]`); if (el) el.textContent = 'Neden: ' + r.why; }
  $('#soundCredits').textContent = C.soundCredits(S.proj).join('\n');
  $('#soundAudioStatus').textContent = Object.values(DRUM_REAL.messages).filter(Boolean).join(' ');
}
function editRealSounds(fn) {
  histCommit(); HIST.t = -Infinity;
  fn(); refresh(); HIST.t = -Infinity;
}
async function runSoundSelection(reroll = false) {
  invalidateSoundSelection();
  const generation = REAL.generation, project = S.proj;
  const shouldAbort = () => generation !== REAL.generation || project !== S.proj;
  const deps = REAL.injected || { network: soundNetwork, decode: decodeSoundPreview, cache: soundCache };
  $('#soundSelectStatus').textContent = 'CC0 davul seti seçiliyor…';
  let result;
  const settings = soundSettings.get();
  let vocalLevel = null;
  if (settings.geminiKey && S.audio?.data?.length) { let square = 0; for (const sample of S.audio.data) square += sample * sample; vocalLevel = Math.sqrt(square / S.audio.data.length); }
  const summary = C.buildSongSummary(S.proj, { ...S.d, vocalLevel, hasRecordedVocal: !!S.audio });
  const gemini = settings.geminiKey ? (deps.gemini || ((request) => (deps.network?.geminiGenerate ? deps.network : soundNetwork).geminiGenerate({ ...request, model: settings.geminiModel }))) : null;
  try { result = await C.selectDrumKitWithGemini({ ...deps, gemini, summary, exclude: reroll ? Object.fromEntries(Object.entries(S.proj.realSounds.drums).map(([lane, r]) => [lane, r.id])) : undefined, shouldAbort, onProgress: (text) => { if (!shouldAbort()) $('#soundSelectStatus').textContent = text; } }); }
  catch (_) { result = { ok: false, reason: 'Ses seçilemedi; bağlantını kontrol edip yeniden dene.' }; }
  if (shouldAbort()) return;
  if (!result.ok) { $('#soundSelectStatus').textContent = result.reason; return; }
  editRealSounds(() => { S.proj.realSounds = C.normalizeRealSounds({ ...S.proj.realSounds, enabled: true, drums: result.kit }); });
  REAL.decoded = result.decoded; REAL.sampleRates = result.sampleRates; REAL.signature = JSON.stringify(S.proj.realSounds.drums);
  renderSoundSelection();
  $('#soundSelectStatus').textContent = 'Davul seti seçildi. ' + (result.status || '');
  if (Player.playing) void applyRealSoundsNow();
}
$('#btnSoundSelect').onclick = () => runSoundSelection();
$('#btnSoundReroll').onclick = () => runSoundSelection(true);
$('#inRealSounds').onchange = (e) => { invalidateSoundSelection(true); editRealSounds(() => { S.proj.realSounds.enabled = e.target.checked; }); void applyRealSoundsNow(); };
$('#btnSoundReset').onclick = () => { invalidateSoundSelection(); editRealSounds(() => { S.proj.realSounds = C.normalizeRealSounds(null); }); void applyRealSoundsNow(); };
$('#soundKitList').onclick = async (e) => {
  const lane = e.target.closest('[data-sound-preview]')?.dataset.soundPreview, mono = REAL.decoded[lane];
  if (!mono) return;
  const generation = REAL.generation;
  try {
    const ctx = getCtx(); await ctx.resume();
    if (generation !== REAL.generation) return;
    if (REAL.source) { try { REAL.source.stop(); } catch (_) {} }
    const buffer = ctx.createBuffer(1, mono.length, REAL.sampleRates[lane]); buffer.copyToChannel(mono, 0);
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination); REAL.source = source;
    source.onended = () => { source.disconnect(); if (REAL.source === source) REAL.source = null; };
    source.start();
  } catch (_) { $('#soundSelectStatus').textContent = 'Önizleme çalınamadı; yeniden dene.'; }
};

function renderSoundSettings() {
  const v = soundSettings.get();
  $('#inFreesoundKey').value = C.maskKey(v.freesoundKey);
  $('#inGeminiKey').value = C.maskKey(v.geminiKey);
  $('#inGeminiModel').value = v.geminiModel;
  renderSoundSelection();
  const st = soundSettings.status();
  $('#soundStorageStatus').textContent = (st.storageFailed ? 'Tarayıcı depolaması kapalı: ayarlar yalnızca bu oturumda tutulur' : 'Ayarlar yalnızca bu tarayıcıda saklanır.') + ' ' + st.message;
}
$('#btnSoundSave').onclick = () => {
  const old = soundSettings.get(), key = (id, previous) => $(id).value === C.maskKey(previous) ? previous : $(id).value;
  soundSettings.set({ freesoundKey: key('#inFreesoundKey', old.freesoundKey), geminiKey: key('#inGeminiKey', old.geminiKey), geminiModel: $('#inGeminiModel').value });
  renderSoundSettings();
};
$('#btnSoundClear').onclick = () => { soundSettings.clear(); renderSoundSettings(); $('#soundProbeStatus').textContent = 'Anahtarlar silindi.'; };
$('#btnSoundProbe').onclick = async () => {
  $('#btnSoundProbe').disabled = true;
  try { await soundNetwork.probe(); $('#soundProbeStatus').textContent = 'Bağlantı tamam (ok).'; }
  catch (e) { $('#soundProbeStatus').textContent = e instanceof C.NetError ? e.message : 'Bağlantı kurulamadı; yeniden dene.'; }
  finally { $('#btnSoundProbe').disabled = false; }
};
renderSoundSettings();

// stil modülünün (styleui.js) kullandığı arayüz
window.__dawAPI = {
  soundSettings,
  realSounds: { prepare: () => prepareCurrentRealSounds(), inject(deps) { cancelRealSoundPreparation(); DRUM_REAL.injected = deps; }, stats: () => realSoundRuntime.stats() },
  soundSelection: { inject(deps) { invalidateSoundSelection(); REAL.injected = deps; }, preview: () => REAL.source },
  network: { setFetch(fetch, options = {}) { soundNetwork = C.createNetwork({ ...options, fetch, settings: soundSettings }); }, probe: () => soundNetwork.probe() },
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
  arrangement: () => ({ drums: drumEventsAll(), bass: arrangedEventsAll(['bass']).bass, piano: pianoEventsAll() }), // bölüm düzenlemeli olaylar (testler)
  renderStems: (sr, lenSec) => renderStems(sr, lenSec),
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
      S.proj.sections.push({ id: uid(), link: null, name: 'Öneri', startBar, endBar: end, tonic: key.tonic, mode: key.mode });
      S.proj.sections.sort((a, b) => a.startBar - b.startBar);
      note = ` "Öneri" bölümü (${C.keyName(key.tonic, key.mode)}) oluşturuldu.` + note;
    } else if (!covering.some((s) => linkSource(s.id)) && covering.some((s) => s.startBar > startBar || s.endBar < end)) {
      status(`Ölçü ${startBar}–${end} birden fazla bölüme ya da bölüm dışına taşıyor; tek bir bölümün içine yerleştirin.`, 'err');
      return false;
    }
    if (Array.from({ length: nBars }, (_, i) => startBar + i).every((bar) => linkedAtBar(bar))) { status('Progresyon yerleştirilmedi.' + linkedSkipNote()); return false; }
    pinOthers((b) => b >= startBar && b <= end && !linkedAtBar(b));
    for (const sec of covering) if (!C.chordsAreFrozen(S.proj) && !linkSource(sec.id)) S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== sec.id);
    for (let i = 0; i < nBars; i++) {
      const bar = startBar + i;
      if (linkedAtBar(bar)) continue;
      const h0 = cells[2 * i], h1 = cells[2 * i + 1];
      S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar !== bar);
      const lk = (ch, half) => { editFrozenChoice(bar, half, { root: ch.root, q: ch.q, bass: null }); S.proj.chordLocks.push({ bar, half, chord: { root: ch.root, q: ch.q, bass: null } }); };
      if (C.sameChord(h0, h1) || !g.split) lk(h0, null); else { lk(h0, 0); lk(h1, 1); }
    }
    refresh();
    status(`${chords.length} akor ölçü ${startBar}–${end} arasına kilitli şablon olarak yerleştirildi (${d.join(' + ')} ölçü).${note}${linkedSkipNote()}`);
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
    if (S.midi && n) { // MIDI projesinde ses kaydı yok: nota synth ile çalınır (sürüklediğin perdede)
      const m = refMidi != null ? refMidi : Math.round(n.median + cents / 100);
      Player.ensure().then(() => Player.hitSynth({ midi: m, vel: 90, lead: true }, Tone.now() + 0.02, 0.45)).catch(() => {});
      this.lastAt = performance.now(); this.count++;
      return;
    }
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
  S.comps = []; if (typeof renderTakes === 'function') renderTakes();
  HIST.reset = true; // yeni ses: geri alma geçmişi sıfırlanır (ses verisi geri alınamaz)
  S.midi = null;
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
  S.proj.autotune = C.normalizeCustomSets(S.proj.autotune, S.proj.sections.map((s) => s.id));
  // eski projelerde olmayan alanlar
  S.proj.drums = S.proj.drums || { on: false, loop: 'auto' };
  S.proj.quant = S.proj.quant || { grid: '1/8', strength: 100 };
  S.proj.taps = S.proj.taps || [];
  S.proj.drums.startBar = S.proj.drums.startBar || 1;
  S.proj.chordStartBar = S.proj.chordStartBar || 1;
  S.proj.noteSplits = S.proj.noteSplits || [];
  S.proj.audio.leadBars = S.proj.audio.leadBars || 0;
  S.proj.piano = Object.assign({}, C.PIANO_DEFAULTS, S.proj.piano || {});
  if (S.proj.bass && S.proj.bass.pattern !== undefined && !S.proj.bass.bars) { const old = S.proj.bass; S.proj.bass = null; bassNormalize(); S.proj.bass.enabled = !!old.on; } // eski basit bas ayarı → bas katmanı (8d); notalar Üret ile oluşur
  S.proj.swing = Object.assign({ ratio: 0.5 }, S.proj.swing || {});
  S.proj.vocalFx = Object.assign({}, C.VFX_DEFAULTS, S.proj.vocalFx || {});
  S.proj.drums.fills = S.proj.drums.fills !== false;
  S.proj.mixer.drums = S.proj.mixer.drums || { vol: -8, mute: false, solo: false };
  S.proj.mixer.guitar = S.proj.mixer.guitar || { vol: -4, mute: false, solo: false };
  S.proj.guitar = C.normalizeGuitarState(S.proj.guitar, S.proj.settings.meter);
  bassNormalize();
  if (S.versionPinsOnLoad) { syncMidi(); S.proj.chordPinsSig = pinSig(); S.versionPinsOnLoad = false; }
  if (S.proj.chordPins && S.proj.chordPins.length && S.proj.chordPinsSig !== pinSig()) S.proj.chordPins = S.proj.chordPins.filter((p) => linkedAtBar(p.bar)); // başka bir şey değişti: yeniden hesapla
  // stil modeli (varsa): akor bulucuya λ·log P(geçiş) + renk puanı olarak girer
  const style = window.StyleUI ? window.StyleUI.scorer() : null;
  syncMidi();
  S.d = C.derive(S.proj, { track: S.track, rawNotes: S.rawNotes, duration: S.audio ? S.audio.data.length / S.audio.sr : S.midi ? S.midi.endQ * C.makeGrid(S.proj.settings).spq : 0, style, engineOverride: S.drag ? 'greedy' : null });
  S.d.styleActive = !!style;
  bassSyncUI();
  const nl = S.proj.chordLocks.length;
  $('#lockCount').textContent = nl ? `(${nl})` : ''; $('#btnUnlockAll').disabled = !nl;
  const nmk = (S.proj.changeMarks || []).length;
  $('#markCount').textContent = nmk ? `(${nmk})` : ''; $('#btnClearMarks').disabled = !nmk;
  const conf = S.d.chords.markConflict ? S.d.sections.filter((x) => S.d.chords.markConflict[x.id]).map((x) => x.name) : [];
  $('#markInfo').innerHTML = (nmk && S.proj.chordOpts.engine === 'greedy' ? '<div class="st-warn">ℹ Ölçü ölçü motor yalnızca <b>ölçü başı</b> işaretlerini (✂ / =) uygular; ölçü ortası işaretleri süreli Viterbi motorunda uygulanır.</div>' : '')
    + (conf.length ? `<div class="st-warn">⚠ ${esc(conf.join(', '))}: işaretler kilitli akorlarla çelişiyor (ör. ✂ noktasının iki yanında aynı akor kilitli); bu bölüm işaretler olmadan dolduruldu.</div>` : '');
  const nch = S.proj.chordLocks.filter((l) => l.src === 'chart').length;
  $('#chartCount').textContent = nch ? `(${nch})` : ''; $('#btnChartRemove').disabled = !nch;
  renderFinishInfo(); renderVfxInfo(); punchInfoUpdate();
  { const lb = lastManualBar(); $('#afterInfo').textContent = lb ? `(ölçü ${lb}'den sonrası)` : ''; $('#btnApplyAfter').disabled = !lb; }
  const ns = S.d.chords.filter((c) => c.pinSuggest).length;
  $('#sugCount').textContent = ns ? `(${ns})` : ''; $('#btnApplySug').disabled = !ns;
  if (S.sel && S.sel.type === 'note' && !S.d.notes.some((n) => n.id === S.sel.id)) S.sel = null;
  if (S.sel && S.sel.type === 'notes') { // toplu seçim: kalmayan notalar düşer; 1 kalırsa tek seçim
    const ids = S.sel.ids.filter((id) => S.d.notes.some((n) => n.id === id));
    S.sel = ids.length > 1 ? { type: 'notes', ids } : ids.length ? { type: 'note', id: ids[0] } : null;
  }
  renderSections();
  renderCustomPicker();
  renderMatrix();
  renderPacks();
  renderVersions();
  renderInspector();
  renderInfo();
  renderChordPreservation();
  renderDrums();
  renderGuitar();
  renderBass();
  renderTaps();
  renderStarts();
  layoutTimeline();
  draw();
  scheduleRender();
  renderChips();
  renderSoundSelection();
  histCommit();
}

const PRESERVE_HINT = 'Akorları koru açık: toplu motor işlemleri için önce korumayı kapat.';
function guardFrozenChords() {
  if (!C.chordsAreFrozen(S.proj)) return false;
  status(PRESERVE_HINT); return true;
}
function renderChordPreservation() {
  const frozen = C.chordsAreFrozen(S.proj);
  for (const id of ['inPreserveChords', 'inPreserveChordsToolbar']) $('#' + id).checked = frozen;
  $('#preserveChordsHint').hidden = !frozen;
  for (const el of $$('#btnApplyAfter, #btnApplySug, #btnUnlockAll, #btnUnlockChords, #btnChartRemove, #btnReseed, [data-act="secUnlockAll"], #altBox input')) {
    if (el.dataset.unfrozenTitle === undefined) el.dataset.unfrozenTitle = el.title;
    el.title = frozen ? PRESERVE_HINT : el.dataset.unfrozenTitle;
    if (['btnUnlockChords', 'btnReseed'].includes(el.id) || el.matches('#altBox input, [data-act="secUnlockAll"]')) el.disabled = frozen;
    else if (frozen) el.disabled = true;
  }
}
function toggleChordPreservation(e) {
  const on = e.target.checked, n = S.d.chords.length;
  let result;
  const restarting = matrixEdit(() => { result = on ? C.freezeChords(S.proj, S.d) : C.unfreezeChords(S.proj); });
  const message = result.ok ? on ? `${n} akor donduruldu` : 'Akorlar serbest: motor yeniden belirleyebilir' : result.warnings.join(' ');
  status(message, result.ok ? undefined : 'err');
  if (restarting) restarting.then(() => status(message, result.ok ? undefined : 'err'));
}
$('#inPreserveChords').onchange = toggleChordPreservation;
$('#inPreserveChordsToolbar').onchange = toggleChordPreservation;

// ---------------------------------------------------------------- MIDI İÇE AKTARMA: .mid → proje (ses yok; melodi MIDI notalarından)
// Notalar çeyrek cinsinden saklanır: BPM değişince müzikal yerleri korunur; ham zamanlar (düzenlemelerin t0/t1'i) oranla ölçeklenir.
const midiRaw = (notes, spq) => notes.map((n) => ({ t0: n.q0 * spq, t1: n.q1 * spq, f0i: 0, f1i: 0, median: n.midi, nearest: n.midi, cents: 0, vel: n.vel }));
function syncMidi() {
  if (!S.midi) return;
  const spq = C.makeGrid(S.proj.settings).spq, pm = S.proj.midi || (S.proj.midi = { spq });
  if (Math.abs(pm.spq - spq) > 1e-9) { const r = spq / pm.spq; for (const e of S.proj.noteEdits) { e.t0 *= r; e.t1 *= r; } pm.spq = spq; }
  S.rawNotes = midiRaw(S.midi.notes, pm.spq);
}
// MIDI melodisi çalma / mix için olaylar (düzenlenmiş notalar)
const melodyEvents = () => (S.d && S.midi ? S.d.notes.map((n) => ({ t: n.q0 * S.d.g.spq, dur: Math.max(0.05, (n.q1 - n.q0) * S.d.g.spq * 0.97), midi: n.effMidi, vel: n.vel || 90, lead: true, q0: n.q0, q1: n.q1 })) : []);
function importMidiBytes(bytes, name, trackIdx, keep) {
  const r = C.importMidi(bytes, trackIdx != null ? { track: trackIdx } : {});
  if (r.error) { status('MIDI açılamadı: ' + r.error, 'err'); return false; }
  if (!keep && (S.audio || S.midi) && !confirm('MIDI açılsın mı? Şu anki proje (kaydetmediysen) kaybolur.')) return false;
  Player.stop(true); HIST.reset = true;
  S.loop.on = false; $('#btnLoop').classList.remove('on');
  invalidateSoundSelection();
  S.proj = C.newProject(); S.customSection = null; S.audio = null; S.track = null; S.corrected = null; S.correctedShift = null; S.onset = null; S.sel = null; S.pos = 0;
  const p = S.proj;
  p.settings.bpm = r.settings.bpm; p.settings.meter = r.settings.meter;
  p.matrix = { enabled: false, rows: {} };
  p.audio = { offsetSec: 0, alignMode: 'none', leadBars: 0, source: 'midi' };
  p.pitch.tuning = 'a440'; // MIDI notaları tam yarım sestir
  p.sections = r.sections.map((x) => ({ id: uid(), link: null, name: x.name, startBar: x.startBar, endBar: x.endBar, tonic: x.tonic, mode: x.mode }));
  p.chordLocks = r.locks; p.chordStartBar = r.chordStartBar;
  if (r.pianoStyle) p.piano.style = r.pianoStyle;
  if (r.bassOn) p.bass.enabled = true;
  if (r.drum) {
    p.drums.on = true; p.drums.startBar = r.drum.startBar;
    const L = r.drum.name && C.DRUM_LOOPS.find((l) => l.name === r.drum.name && l.meter === r.settings.meter);
    if (L) p.drums.loop = L.id;
  }
  S.midi = { name, bytes, notes: r.notes, endQ: r.endQ, tracks: r.trackChoices, trackIndex: r.melodyTrack.index, warnings: r.warnings };
  p.midi = { spq: C.makeGrid(p.settings).spq };
  syncInputs(); refresh();
  if (r.bassOn && S.d && S.d.chords.length && !p.bass.generated) { Bs.bassGenerateAll(p.bass, bCtx()); renderBass(); drawBass(); } // MIDI'de bas izi vardı: bas katmanı (8d) akorlardan üretir
  const bits = [`melodi izi "${r.melodyTrack.name}" (${r.notes.length} nota)`, `${r.settings.meter} · ${r.settings.bpm} BPM`];
  if (r.sections.length) bits.push(`${r.sections.length} bölüm${r.sections.some((x) => x.tonic != null) ? ' + ton' : ''}`);
  if (r.chordCount) bits.push(`${r.locks.length} akor 📄 (MIDI'deki akor adlarından)`);
  if (r.pianoStyle && r.pianoStyle !== 'piano-chord') bits.push(C.PIANO_STYLES[r.pianoStyle].name);
  if (r.bassOn) bits.push('bas'); if (r.drum) bits.push(`davul${r.drum.name ? ' (' + r.drum.name + ')' : ''}`);
  status(`MIDI açıldı: ${name} — ${bits.join(' · ')}.${r.warnings.length ? ' ⚠ ' + r.warnings.join(' ') : ''}${r.chordCount ? '' : ' Akor adı bulunamadı: akorlar melodiden üretildi (6–7. adım).'}`);
  return true;
}
async function loadMidiFile(file) {
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (e) { status('MIDI dosyası okunamadı: ' + e.message, 'err'); return; }
  importMidiBytes(bytes, file.name, null, false);
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
  set('#chipS2', S.midi ? `MIDI · ${S.midi.notes.length} nota` : S.audio ? `${(S.audio.data.length / S.audio.sr).toFixed(0)} s${p.audio.leadBars ? ` · ${p.audio.leadBars > 0 ? '+' : ''}${p.audio.leadBars} ölçü` : ''}` : 'ses yok');
  set('#chipS3', S.rawNotes ? `${S.rawNotes.length} nota` : '');
  set('#chipS4', d && p.sections.length ? `${p.sections.length} bölüm` : 'bölüm yok');
  const nEd = p.noteEdits.length + (p.noteSplits || []).length;
  set('#chipS5', `${p.autotune.enabled ? 'autotune açık' : 'autotune kapalı'}${nEd ? ` · ${nEd} düzeltme` : ''}`);
  set('#chipS67', d ? `${d.chords.length} akor${p.chordLocks.length ? ` · ✋ ${p.chordLocks.length} kilit` : ''}${p.chordStartBar > 1 ? ` · ölçü ${p.chordStartBar}'den` : ''}` : '');
  set('#chipS8', `${C.PIANO_STYLES[p.piano.style].name}${p.piano.repeat === 'off' ? '' : p.piano.repeat === 'fade' ? ' · söner' : ' · sürer'}`);
  const L = d ? currentLoop() : null;
  set('#chipS8b', anyDrums() ? `${p.drums.loop !== 'auto' ? '✋ ' : ''}${L ? L.name : 'açık'}${p.drums.startBar > 1 ? ` · ölçü ${p.drums.startBar}'den` : ''}` : 'kapalı');
  const ins = p.guitar && p.guitar.instrument;
  set('#chipS8c', ins === 'guitar' ? 'gitar' : ins === 'both' ? 'piyano + gitar' : 'kapalı');
  const bt = p.bass;
  set('#chipS8d', bt && bt.enabled ? (bt.generated ? `${bt.instrumentType === 'synth' ? 'synth bas' : 'bas gitar'} · ${(Bs.profileById(bt, bt.styleProfileId) || {}).name || ''}` : 'üretilmedi') : 'kapalı');
}
// ---------------------------------------------------------------- GENEL GERİ ALMA / YİNELEME (Ctrl+Z, Ctrl+Shift+Z)
// Proje durumunun anlık görüntüleri: her değişiklikten (refresh) sonra önceki durum geri alma yığınına girer.
// Sürükleme tek adımdır (bırakınca); 0,5 sn içindeki art arda değişiklikler (kaydırıcılar) tek adımda birleşir.
// Sürüm geçişi dışında mikser seviyeleri ve A/B geri almaya dahil değil. Ses verisi (kayıt / yükleme) geri alınamaz: yeni ses geçmişi sıfırlar.
// last: son geri alınabilir eylem kimin? 'bass' → Ctrl+Z bas şeridinin kendi geçmişini (bassui.js) geri alır, 'proj' → genel geçmişi
const HIST = { undo: [], redo: [], base: null, t: 0, hold: 0, reset: true, last: 'proj' };
const bassUndoFirst = () => HIST.last === 'bass' && (BS.hist.undo.length || BS.hist.redo.length);
function snapProj() {
  const p = JSON.parse(JSON.stringify(S.proj));
  for (const k of ['vocal', 'piano', 'drums', 'guitar', 'bass']) delete p.mixer[k];
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
  const prior = JSON.parse(HIST.base);
  if (prior.pack) prior.pack.selectedId = S.proj.pack.selectedId;
  if (JSON.stringify(prior) === cur) return; // paket seçimi tek başına geçmiş adımı değildir
  const now = performance.now();
  if (now - HIST.t > 500 || !HIST.undo.length) { HIST.undo.push(HIST.base); if (HIST.undo.length > 100) HIST.undo.shift(); }
  HIST.t = now; HIST.base = cur; HIST.redo = []; HIST.last = 'proj';
  histButtons();
}
const detSig = (p) => JSON.stringify([p.fmin, p.fmax, p.silenceDb, p.hopMs, p.analysisSr]);
const segSig = (p, sp) => JSON.stringify([p.minNoteMs, p.changeSemis, sp]);
// Yalnızca sürüm geçişleri mikser şeritlerini de geri alır; A/B ortak kalır.
function historyEntry(withMixer) {
  return withMixer ? { project: snapProj(), mixer: Object.fromEntries(['vocal', 'piano', 'guitar', 'bass', 'drums'].map((k) => [k, jclone(S.proj.mixer[k])])) } : snapProj();
}
async function histRestore(entry, was) {
  invalidateSoundSelection();
  const str = typeof entry === 'string' ? entry : entry.project;
  Player.stop(true);
  const keep = { ab: S.proj.mixer.ab }; for (const k of ['vocal', 'piano', 'drums', 'guitar', 'bass']) keep[k] = S.proj.mixer[k];
  const old = { det: detSig(S.proj.pitch), seg: segSig(S.proj.pitch, S.proj.noteSplits) };
  HIST.hold++;
  try {
    S.proj = mergeDefaults(C.newProject(), C.migrateMatrix(JSON.parse(str)));
    S.proj.autotune = C.normalizeCustomSets(S.proj.autotune, S.proj.sections.map((s) => s.id));
    Object.assign(S.proj.mixer, keep, typeof entry === 'string' ? {} : entry.mixer);
    GT.cache = null;
    BS.hist = Bs.newHistory(); BS.sel = null; BS.note = null; // bas geçmişi eski izin anlık görüntüleriydi
    S.sel = null;
    syncInputs(); Player.applyMixer();
    if (S.track) {
      if (detSig(S.proj.pitch) !== old.det) await analyze();
      else if (segSig(S.proj.pitch, S.proj.noteSplits) !== old.seg) resegment();
    }
    refresh(); scheduleRender(true);
  } finally { HIST.hold--; }
  HIST.base = snapProj(); HIST.t = 0;
  histButtons();
  const soundGeneration = syncRealSoundGeneration();
  const restoredSounds = await prepareCurrentRealSounds(); restoredSounds.release();
  if (was && soundGeneration === DRUM_REAL.generation) Player.play();
}
async function histUndo() {
  if (!HIST.undo.length) { status('Geri alınacak bir şey yok.'); return; }
  const was = Player.playing;
  const entry = HIST.undo.pop();
  HIST.redo.push(historyEntry(typeof entry !== 'string'));
  await histRestore(entry, was);
  status(`Geri alındı (${HIST.undo.length} adım daha geri alınabilir, ${HIST.redo.length} yinelenebilir).`);
}
async function histRedo() {
  if (!HIST.redo.length) { status('Yinelenecek bir şey yok.'); return; }
  const was = Player.playing;
  const entry = HIST.redo.pop();
  HIST.undo.push(historyEntry(typeof entry !== 'string'));
  await histRestore(entry, was);
  status(`Yinelendi (${HIST.redo.length} adım daha yinelenebilir).`);
}

// ---------------------------------------------------------------- DÜZENLEME: genel ayar + bölüm başına üstüne yazma
// proj.sections[i].arr = { drums: null | 'off' | loopId, piano: null | akor sesi }  (null = genel ayar; bas bölümü kendi panelinde 8d)
// ▶ önizleme: bir loop seçmeden 2 ölçü dinlenir (çalma bitince ya da durdurulunca temizlenir)
const PREVIEW = { drums: null };
// alt bölme / swing oranı (0,5 düz · 0,667 üçleme · arası swing): davul, bas, akor desenleri, quantize ızgarası ve cetvel buna uyar
const swingR = () => (S.proj.swing && S.proj.swing.ratio) || 0.5;
const swingMode = (r = swingR()) => (Math.abs(r - 0.5) < 0.005 ? 'straight' : Math.abs(r - 2 / 3) < 0.006 ? 'triplet' : 'swing');
const secArr = (secId) => { const s = S.proj.sections.find((x) => x.id === secId); return (s && s.arr) || {}; };
const sectionOfBar = (bar) => (S.d ? S.d.sections.find((s) => !s.implicit && bar >= s.startBar && bar <= s.endBar) || null : null);
const loopById = (id) => C.DRUM_LOOPS.find((l) => l.id === id && l.meter === S.proj.settings.meter) || null;
const anySectionArr = (k) => S.proj.sections.some((s) => s.arr && s.arr[k] && s.arr[k] !== 'off');
const anyDrums = () => !!PREVIEW.drums || S.proj.drums.on || anySectionArr('drums');
const arrangedEventsAll = (layers) => C.arrangedEvents(S.d, S.proj, { layers, drumLoop: currentLoop(), previewDrums: PREVIEW.drums });
const drumEventsAll = () => arrangedEventsAll(['drums']).drums;
const pianoEventsAll = () => arrangedEventsAll(['piano']).piano;

// ---------------------------------------------------------------- düzeltilmiş vokal render (TD-PSOLA)
let renderTimer = null, renderGeneration = 0, renderWork = null;
const customRenderSig = () => JSON.stringify([S.proj.autotune.target, S.proj.autotune.target === 'custom'
  ? Object.keys(S.proj.autotune.customSets).sort().map((id) => [id, S.proj.autotune.customSets[id]]) : null]);
const hasShift = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== 0) return true; return false; };
function shiftsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function scheduleRender(now) {
  renderGeneration++;
  clearTimeout(renderTimer);
  const corr = S.d && S.d.correction;
  if (!corr || !S.audio || renderReady()) return;
  $('#renderInfo').textContent = 'Düzeltilmiş vokal yeniden render edilecek…';
  renderTimer = setTimeout(doRender, now ? 0 : 350);
}
async function doRender() {
  if (renderWork) return renderWork;
  if (!S.d || !S.d.correction || !S.audio) return;
  if (S.drag) { renderTimer = setTimeout(doRender, 150); return; }
  const shift = S.d.correction.shift.slice(), map = S.d.timeMap, audio = S.audio, track = S.track;
  const generation = renderGeneration, sig = customRenderSig();
  renderWork = busy(map && !map.identity ? 'Düzeltilmiş vokal render ediliyor (perde: TD-PSOLA · zamanlama: WSOLA)…' : 'Düzeltilmiş vokal render ediliyor (TD-PSOLA, formant korumalı)…', async () => {
    await tick();
    if (generation !== renderGeneration || audio !== S.audio || track !== S.track) return;
    const pitched = hasShift(shift) ? C.psolaShift(audio.data, audio.sr, track, shift) : audio.data;
    const corrected = map && !map.identity ? C.wsolaWarp(pitched, audio.sr, map) : pitched;
    if (generation !== renderGeneration) return;
    S.corrected = corrected; S.correctedShift = shift; S.correctedWarp = map ? map.sig : ''; S.correctedSig = sig;
    Player.buffersDirty = true;
    renderInfo();
    status('Düzeltilmiş vokal hazır (ayrı iz). A/B ile karşılaştırın.');
  });
  try { await renderWork; } finally {
    renderWork = null;
    if (S.audio && S.d && S.d.correction && !renderReady()) scheduleRender(true);
  }
}
const renderReady = () => !!S.d && !!S.d.correction && shiftsEqual(S.d.correction.shift, S.correctedShift) && (S.d.timeMap ? S.d.timeMap.sig : '') === (S.correctedWarp || '') && S.correctedSig === customRenderSig();

// ---------------------------------------------------------------- VOKAL TEMİZLİĞİ (gürültü azaltma · sıkıştırıcı · seviye eşitleme · reverb) — oynatma ve dışa aktarım aynı işlenmiş sesi kullanır
// Kaynak değişince (yeni kayıt / yeniden render) ya da ayar değişince bir sonraki çalmada / dışa aktarmada yeniden işlenir; sonuç ref + ayar anahtarıyla önbelleklenir.
const VFX = { A: null, B: null, info: null };
const vfxOn = () => !!(S.proj.vocalFx && S.proj.vocalFx.on) && !!S.audio;
const vfxKey = () => { const f = S.proj.vocalFx; return JSON.stringify([f.denoise, f.comp, f.normalize, f.reverb]); };
function vfxSources() { return { A: S.audio ? S.audio.data : null, B: S.audio ? S.corrected || S.audio.data : null }; }
// işlenmiş (açıksa) ya da ham vokal; senkron: önce vfxEnsure çağrılmış olmalı
function vfxData(which) {
  const src = vfxSources()[which];
  if (!src) return null;
  const c = VFX[which];
  return vfxOn() && c && c.src === src && c.key === vfxKey() ? c.data : src;
}
async function vfxEnsure() {
  if (!vfxOn()) return false;
  const srcs = vfxSources(), key = vfxKey();
  const need = ['B', 'A'].filter((w) => srcs[w] && !(VFX[w] && VFX[w].src === srcs[w] && VFX[w].key === key));
  if (!need.length) return false;
  await busy('Vokal temizleniyor (gürültü azaltma · sıkıştırma · seviye · reverb)…', async () => {
    await tick();
    const fx = S.proj.vocalFx;
    for (const w of need) {
      if (w === 'A' && srcs.A === srcs.B && VFX.B && VFX.B.src === srcs.B && VFX.B.key === key) { VFX.A = VFX.B; continue; } // düzeltme yoksa A = B
      const r = C.processVocal(srcs[w], S.audio.sr, fx);
      VFX[w] = { src: srcs[w], key, data: r.data };
      if (w === 'B') VFX.info = r.info;
      await tick();
    }
  });
  Player.buffersDirty = true;
  renderVfxInfo();
  return true;
}
function renderVfxInfo() {
  const el = $('#vfxInfo');
  if (!el) return;
  const i = VFX.info, f = S.proj.vocalFx;
  let t = '';
  if (!S.audio) t = 'Vokal kaydı yok (MIDI / demo): temizlik yalnızca kayıtlı vokal için.';
  else if (!f.on) t = 'Kapalı: vokal olduğu gibi çalar.';
  else if (i && VFX.B && VFX.B.key === vfxKey()) t = `Gürültü tabanı ${i.noiseDb != null ? i.noiseDb.toFixed(0) + ' dBFS' : '—'}${i.noiseReductionDb != null ? ` (−${Math.max(0, i.noiseReductionDb).toFixed(0)} dB)` : ''} · ses seviyesi ${i.rmsBeforeDb.toFixed(0)} → ${i.rmsAfterDb.toFixed(0)} dBFS · tepe ${i.peakAfterDb.toFixed(1)} dBFS`;
  else t = 'Açık: bir sonraki çalmada işlenir.';
  if (el.textContent !== t) el.textContent = t;
}
let vfxTimer = null;
function vfxChanged() {
  S.proj.vocalFx.touched = true;
  Player.buffersDirty = true;
  renderVfxInfo();
  clearTimeout(vfxTimer);
  if (Player.playing) vfxTimer = setTimeout(() => Player.play(), 400); // çalarken ayar değişince işlenmiş sesle baştan çal
}

// ---------------------------------------------------------------- KANAL RENDER (dışa aktarım + otomatik miks): her iz fader'sız, aynı yolla
async function renderStems(sr, lenSec) {
  REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = '';
  const snapshot = await prepareCurrentRealSounds(), drumBank = snapshot.bank(sr);
  const drumEvents = anyDrums() ? drumEventsAll() : null;
  try {
    const n = Math.round(lenSec * sr), ins = S.proj.guitar.instrument;
    let vocal = null;
    if (S.audio) {
      await vfxEnsure();
      const src = vfxData(S.proj.mixer.ab === 'original' ? 'A' : 'B');
      vocal = alignedVocal(S.audio.sr === sr ? src : C.resample(src, S.audio.sr, sr), sr, lenSec);
    } else if (S.midi) vocal = C.renderSynth(melodyEvents(), sr, n, 1); // MIDI projesi: melodi synth ile
    let piano = null;
    if (ins !== 'guitar') {
      const samples = await loadPianoSamples(), ev = pianoEventsAll();
      piano = C.renderPiano(ev.filter((e) => e.inst !== 'synth'), samples.samples, sr, n, 0.35);
      const syn = C.renderSynth(ev.filter((e) => e.inst === 'synth'), sr, n, 1);
      for (let i = 0; i < n; i++) piano[i] += syn[i];
    }
    return {
      vocal, piano,
      guitar: ins === 'piano' ? null : guitarTrack(sr).data,
      bass: S.proj.bass.enabled ? await renderBassOffline(sr, n) : null,
      drums: drumEvents ? C.renderDrums(drumEvents, sr, n, 1, drumBank) : null,
    };
  } finally { snapshot.release(); }
}
// 🎚 otomatik miks: izler fader'sız render edilip vokalin kapılı RMS'ine göre dengelenir (akor −7, gitar −6, bas −5, davul −6 dB); vokal 0 dB
async function autoMix(quiet, current = () => true) {
  const project = S.proj, soundGeneration = syncRealSoundGeneration(), callerCurrent = current;
  current = () => callerCurrent() && project === S.proj && soundGeneration === DRUM_REAL.generation;
  if (!S.d) { status('Önce bir akor izi gerekli.', 'err'); return false; }
  let res;
  await busy('Ses dengesi ölçülüyor…', async () => {
    await tick();
    if (!current()) return;
    try {
      const sr = 22050, st = await renderStems(sr, Math.min(S.d.bars * S.d.g.barSec + 1.5, 150));
      if (current()) res = C.autoMixLevels(st, sr);
    } catch (e) { if (current()) throw e; }
  });
  if (!current() || !res) return false;
  const m = S.proj.mixer, names = { piano: 'akor', guitar: 'gitar', bass: 'bas', drums: 'davul' };
  for (const k of Object.keys(res.levels)) if (m[k]) m[k].vol = res.levels[k];
  syncInputs(); Player.applyMixer(); queueVersions();
  const txt = Object.entries(res.levels).filter(([k]) => k !== 'vocal').map(([k, v]) => `${names[k]} ${v > 0 ? '+' : ''}${v} dB`).join(' · ');
  $('#mixInfo').textContent = `Vokal referans (0 dB, ${res.measured.vocal.toFixed(0)} dBFS) → ${txt || 'çalan iz yok'}`;
  if (!quiet) status(`🎚 Seviyeler ayarlandı: ${txt || 'çalan iz yok'} (vokala göre). Fader'larla istediğin gibi değiştirebilirsin.`);
  return true;
}

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
  if (!S.d) return [];
  if (!S.track) return S.midi ? S.d.notes.map((n) => ({ t0: n.tl0, t1: n.tl1, pitch: n.effMidi, loud: (n.vel || 80) / 127 })) : []; // MIDI: ses şiddeti yerine vuruş hızı
  const rms = S.track.rms;
  return S.d.notes.map((n) => {
    let loud = 0;
    for (let f = n.f0i; f < Math.min(n.f1i, n.f0i + 6); f++) loud = Math.max(loud, rms[f] || 0);
    return { t0: n.tl0, t1: n.tl1, pitch: n.effMidi, loud };
  });
}
// ---------------------------------------------------------------- 👍 / 👎 TERCİH ÖĞRENME (davul loop'ları, akor sesi)
// ⟳ ile dinlediğini beğenir / beğenmezsin; tercihler tarayıcıda saklanır (bütün projelerde geçerli) ve yalnızca OTOMATİK sıralamayı etkiler:
// davul puanı (loop başına ±0,08, aynı aile ±0,03 — en çok ±0,3) ve ⟳ sırası. Elle seçtiğin hiçbir zaman değiştirilmez.
const PREF_LS = 'miniDaw.prefs';
const PREF = (() => { try { const v = JSON.parse(localStorage.getItem(PREF_LS)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } })();
const prefSave = () => { try { localStorage.setItem(PREF_LS, JSON.stringify(PREF)); } catch (e) { /* depolama kapalı olabilir */ } };
const prefNet = (kind, id) => { const e = PREF[kind] && PREF[kind][id]; return e ? e.l - e.d : 0; };
function prefBump(kind, id, v) { const m = PREF[kind] || (PREF[kind] = {}), e = m[id] || (m[id] = { l: 0, d: 0 }); if (v > 0) e.l++; else e.d++; }
const prefTag = (kind, id) => { const e = PREF[kind] && PREF[kind][id]; return e && (e.l || e.d) ? ` ${e.l ? '👍' + e.l : ''}${e.d ? '👎' + e.d : ''}` : ''; };
const drumPrefDelta = (L) => Math.max(-0.3, Math.min(0.3, 0.08 * prefNet('drums', L.id) + 0.03 * prefNet('drumsCat', L.cat || '')));
function analyzeDrums() {
  const ns = drumNotes();
  // click'le kaydedildiyse ya da test melodisiyse ızgara zaten doğru: vuruş fazını tahmin etme
  const fixedPhase = S.proj.audio.source === 'test' || S.proj.audio.source === 'midi' || (S.proj.audio.source === 'record' && S.proj.audio.alignMode === 'none');
  S.meterEst = ns.length ? C.estimateMeter(ns, S.proj.settings.bpm, { fixedPhase }) : null;
  S.drumSug = C.suggestDrumLoop(ns, Object.assign({}, S.proj.settings, { swingRatio: swingR(), prefDelta: drumPrefDelta }), S.meterEst); // senin bildirdiğin swing oranı his tahmininin üstündedir
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
  const opt = (l) => `<option value="${l.id}">${esc(C.loopLabel(l))} · ${l.bpm[0]}–${l.bpm[1]} BPM</option>`;
  // numaralı kalıplar kategorilere göre (optgroup), numarasız ilk loop'lar "Diğer"de; kategori içinde numara sırası
  const groups = Object.keys(C.DRUM_CATS).map((c) => [c, pool.filter((l) => l.cat === c).sort((a, b) => (a.no || 99) - (b.no || 99))]).filter(([, ls]) => ls.length);
  const opts = `<option value="auto">Otomatik${bestId ? ` (öneri: ${esc(C.loopLabel(sug.best.loop))})` : ''}</option>` + groups.map(([c, ls]) => `<optgroup label="${esc(C.DRUM_CATS[c])}">${ls.map(opt).join('')}</optgroup>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  const want = S.proj.drums.loop && pool.some((l) => l.id === S.proj.drums.loop) ? S.proj.drums.loop : 'auto';
  sel.value = want;
  $('#inDrumsOn').checked = !!S.proj.drums.on;
  const L = currentLoop();
  let ih = '';
  if (sug) {
    const r = sug.ranked.find((x) => x.loop === L);
    if (r) ih += `<div class="${sug.ok || want !== 'auto' ? 'adv-opt' : 'st-warn'}"><b>${esc(C.loopLabel(L))}</b> — ${esc(L.desc)}<div class="hint">${esc(r.why.join(' · '))} · puan ${r.score.toFixed(2)}</div></div>`;
    if (!sug.ok) {
      ih += `<div class="st-warn adv-imp">⚠ <b>Bu melodiye uygun bir loop bulamadım.</b><ul>${sug.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        En yakını çalıyor${want === 'auto' ? '' : ' (senin seçtiğin loop)'}. Yeni bir loop istemek için bu tarifi Claude'a gönder:
        <textarea id="drumRequest" rows="7" readonly>${esc(sug.request)}</textarea><button id="btnDrumCopy" class="small">Tarifi kopyala</button></div>`;
    } else if (sug.reasons.length) ih += sug.reasons.map((x) => `<div class="hint">ℹ ${esc(x)}</div>`).join('');
    // loop puanları artık Davul bölümünde görünür liste (#drumRank)
  }
  if ($('#drumInfo').dataset.h !== ih) { $('#drumInfo').innerHTML = ih; $('#drumInfo').dataset.h = ih; }
  $('#drumGrid').textContent = L ? C.loopGridText(L) : '';
  renderRank('#drumRank', 'drums', sug ? sug.ranked.map((x) => ({ id: x.loop.id, name: x.loop.name + prefTag('drums', x.loop.id), score: x.score, sub: `vurgu ${x.accent.toFixed(2)} · tempo ${x.tempo.toFixed(2)}${x.feelOk ? '' : ' · his uymuyor'}`, why: x.why.join(' · ') })) : [], want !== 'auto' ? want : null, L ? L.id : null);
}
// puanlı öneri listesi (davul loop'ları): ▶ seçmeden 2 ölçü dinle · Seç = elle seç (elle seçilen puana bakılmadan geçerli)
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
// listeden ▶ (önizleme) ve Seç
function pickFromRank(kind, id) {
  S.proj.drums.loop = id; S.proj.drums.on = true;
  syncInputs(); refresh();
  status(`Davul: ${C.loopLabel(loopById(id))} elle seçildi — otomatik öneriler bunu değiştirmez. Otomatiğe dönmek için listeden "Otomatik"i seç.`);
  if (Player.playing) Player.play();
}
function previewPattern(kind, id) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  const g = S.d.g, sec = S.sel && S.sel.type === 'section' ? S.d.sections.find((x) => x.id === S.sel.id && !x.implicit) : null;
  let bar = S.loop.on ? Math.floor(S.loop.from / g.barSec + 1e-6) + 1 : sec ? sec.startBar : barAtPlayheadQ();
  bar = Math.min(Math.max(bar, S.d.chordStart || 1), Math.max(1, S.d.bars - 1));
  const from = (bar - 1) * g.barSec, to = Math.min(S.d.bars, bar + 1) * g.barSec;
  status(`▶ ${C.loopLabel(loopById(id))} — ölçü ${bar}–${bar + 1} önizleme (seçilmedi).`);
  Player.play({ preview: { from, to, drums: id } });
}
$('#drumRank').addEventListener('click', (e) => {
  const pv = e.target.closest('button[data-pv]'), pk = e.target.closest('button[data-pick]');
  if (pv) previewPattern(pv.dataset.pv, pv.dataset.id);
  else if (pk) pickFromRank(pk.dataset.pick, pk.dataset.id);
});
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
$('#inDrumsOn').addEventListener('change', (e) => { S.proj.drums.on = e.target.checked; renderMatrix(); if (Player.playing) Player.play(); });
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
  if (S.loop.on) status(`🔁 Döngü: ${S.loop.name} (${((S.loop.to - S.loop.from)).toFixed(1)} s). Başka bir bölüme tıklarsan döngü onu izler; ⟳ düğmeleriyle davul / akor sesini değiştirip hemen dinle.`);
  else status('Döngü kapandı.');
  if (Player.playing) Player.play();
}
// alternatifi sırayla dene: kind = 'drums' | 'piano'; secId = bölüm düzenlemesi için (yoksa genel ayar)
function arrOptions(kind) {
  const meter = S.proj.settings.meter;
  if (kind === 'drums') { const pool = C.loopsFor(meter), rank = S.drumSug ? S.drumSug.ranked.map((x) => x.loop.id) : []; return pool.slice().sort((a, b) => (rank.indexOf(a.id) + 1 || 99) - (rank.indexOf(b.id) + 1 || 99)).map((l) => ({ id: l.id, name: l.name })); }
  return Object.keys(C.PIANO_STYLES).map((id, i) => ({ id, name: C.PIANO_STYLES[id].name, i })).sort((a, b) => prefNet('piano', b.id) - prefNet('piano', a.id) || a.i - b.i); // beğendiklerin önde, beğenmediklerin sonda
}
function arrCurrent(kind, secId) {
  const a = secId ? secArr(secId)[kind] : null;
  if (a && a !== 'off') return a;
  if (kind === 'drums') return (currentLoop() || {}).id;
  return S.proj.piano.style;
}
function arrNext(kind, secId, targetId) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  if (secId && guardLinked(secId)) return;
  const opts = arrOptions(kind);
  if (!opts.length) return;
  const i = opts.findIndex((o) => o.id === arrCurrent(kind, secId)), nx = targetId ? opts.find((o) => o.id === targetId) || opts[(i + 1) % opts.length] : opts[(i + 1) % opts.length];
  if (secId) { const s = S.proj.sections.find((x) => x.id === secId); if (!s) return; s.arr = Object.assign({}, s.arr, { [kind]: nx.id }); delete s.arr.auto; }
  else if (kind === 'drums') { S.proj.drums.loop = nx.id; S.proj.drums.on = true; }
  else S.proj.piano.style = nx.id;
  syncInputs(); refresh();
  const label = { drums: 'Davul', piano: 'Akor sesi' }[kind];
  status(`${label}${secId ? ' (bu bölüm)' : ''}: ${nx.name}${prefTag(kind === 'piano' ? 'piano' : 'drums', nx.id)} — ${opts.findIndex((o) => o.id === nx.id) + 1}/${opts.length}. Beğenmediysen ⟳ ile sıradakini dene, 👍 / 👎 ile öğret.`);
  auditionNow();
}
// 👍 / 👎: çalan seçeneği oyla; 👎 ise en iyi sıradaki (çalandan farklı) hemen denenir
function voteOption(kind, v, secId = null) {
  if (!S.d) { status('Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return; }
  const id = arrCurrent(kind, secId);
  if (!id) { status('Önce bir davul loop\'u / akor sesi seç.', 'err'); return; }
  const L = kind === 'drums' ? loopById(id) : null, name = kind === 'drums' ? (L ? C.loopLabel(L) : id) : C.PIANO_STYLES[id].name;
  prefBump(kind, id, v);
  if (L && L.cat) prefBump('drumsCat', L.cat, v);
  prefSave();
  if (kind === 'drums') { analyzeDrums(); renderDrums(); }
  status(`${v > 0 ? '👍' : '👎'} ${kind === 'drums' ? 'Davul' : 'Akor sesi'}: ${name}${kind === 'drums' && L && L.cat ? ' ve benzer kalıplar (aynı aile)' : ''} — ${v > 0 ? 'otomatik öneride ve ⟳ sırasında öne çıkar' : 'otomatik öneride ve ⟳ sırasında geriye düşer'}; elle seçtiklerin etkilenmez.`);
  if (v < 0) { const nx = arrOptions(kind).find((o) => o.id !== id); if (nx) arrNext(kind, secId, nx.id); }
}
function prefReset() { for (const k of Object.keys(PREF)) delete PREF[k]; prefSave(); analyzeDrums(); renderDrums(); status('👍 / 👎 tercihleri sıfırlandı.'); }
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
let demoGeneration = 0;
function makeDemo() {
  if (!S.d || (!S.audio && !S.midi) || !S.rawNotes || !S.rawNotes.length) { status('Demo için önce bir ses kaydı/yükleme ve analiz gerekli ("Test melodisi üret" ile de deneyebilirsin).', 'err'); return; }
  const selectedPackId = $('#inPack').value, pack = C.eligiblePacks(S.proj).find((p) => p.id === selectedPackId);
  const project = S.proj, generation = ++demoGeneration;
  const current = () => S.proj === project && generation === demoGeneration;
  histCommit(); HIST.t = -Infinity;
  Player.stop(true);
  clearTimeout(BS.timer);
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
    if (!S.proj.sections.length) {
      const id = uid(); C.rekeyChordChoices(S.proj, '_all', id);
      S.proj.sections.push({ id, link: null, name: 'Şarkı', startBar: 1, endBar: S.d.bars, tonic: null, mode: null }); refresh();
    }
    let keyed = 0;
    for (const s of S.proj.sections) if (s.tonic == null) { const ds = S.d.sections.find((x) => x.id === s.id); if (ds && ds.tonic != null) { s.tonic = ds.tonic; s.mode = ds.mode; keyed++; } }
    refresh();
    did.push(`ton: ${S.d.sections.filter((x) => !x.implicit && x.tonic != null).map((x) => `${x.name} ${C.keyName(x.tonic, x.mode)}`).join(', ') || '—'}${keyed ? ' (öneriler onaylandı)' : ''}`);
    if (S.audio && !S.proj.vocalFx.touched) { S.proj.vocalFx.on = true; did.push('vokal temizliği açık'); }
    if (pack) {
      S.proj.pack.selectedId = selectedPackId;
      const result = C.applyPack(S.proj, S.d, selectedPackId, { keepManual: true });
      if (result.manual.includes('drums')) S.proj.drums.on = true; // elle seçilen loop korunur ama Demo davulu yine açar
      const manual = [];
      if (result.manual.includes('drums')) manual.push("davul loop'u");
      if (result.manual.includes('piano')) manual.push('akor sesi');
      for (const s of S.proj.sections) if (!s.arr?.auto && (s.arr?.drums != null || s.arr?.piano != null)) manual.push(`"${s.name}" bölüm düzenlemesi`);
      if (S.proj.bass.bars.some((b) => b.locked || b.source === 'manual')) manual.push('bas ölçüleri');
      if (manual.length) did.push(`elle seçtiklerin korundu: ${manual.join(', ')}`);
      const types = S.proj.sections.map((s) => C.normSectionType(s.type || s.name));
      if (types.includes('chorus')) S.proj.sections.forEach((s, i) => {
        if (!s.arr && ['verse', 'intro'].includes(types[i])) s.arr = { auto: true }; // dinamikleri artık matris kurar
      });
      PACK_UI.project = S.proj; PACK_UI.warnings = result.warnings; PACK_UI.kept = result.kept.filter((l) => S.proj.pack.locks[l]);
      did.push(...result.warnings);
      syncInputs(); refresh();
    } else {
      did.push('Bu ölçü için paket yok; eski Demo düzenlemesi kullanıldı');
      // 3) davul + bas aç. Elle seçtiklerine (loop, bas kalıbı, fill, bölüm düzenlemesi) dokunmaz; yalnızca "otomatik" olanı doldurur
      S.proj.drums.on = true; bassNormalize(); S.proj.bass.enabled = true; // bas: 8d'deki üretici (elle düzenlenmiş / kilitli ölçüler zaten üretilmişse korunur)
      const manual = [];
      if (S.proj.drums.loop && S.proj.drums.loop !== 'auto') manual.push('davul loop\'u');
      if (S.proj.bass.generated && S.proj.bass.bars.some((b) => b.locked || b.source === 'manual')) manual.push('bas ölçüleri');
      // 4) bölüm başına çeşitlilik: nakarat varsa verse / giriş daha sade davul (bas enerji eğrisini kendi üreticisi izler). Elle verilen bölüm düzenlemesi korunur; önceki demo'nun otomatik düzenlemesi yenilenir
      for (const s of S.proj.sections) if (s.arr && s.arr.auto) delete s.arr;
      const types = S.proj.sections.map((s) => C.normSectionType(s.type || s.name));
      if (S.proj.sections.length >= 2 && types.includes('chorus')) {
        const sade = loopById('minimal');
        S.proj.sections.forEach((s, i) => {
          if (s.arr) { manual.push(`"${s.name}" bölüm düzenlemesi`); return; }
          if (types[i] === 'verse' || types[i] === 'intro') {
            s.arr = { auto: true };
            if (sade && S.proj.drums.loop === 'auto' && currentLoop() && currentLoop().id !== 'minimal') s.arr.drums = 'minimal';
            if (!s.arr.drums) delete s.arr;
          }
        });
        if (S.proj.sections.some((s) => s.arr && s.arr.auto)) did.push('verse/giriş daha sade davul, nakarat dolu');
      }
      if (manual.length) did.push(`elle seçtiklerin korundu: ${manual.join(', ')}`);
      syncInputs(); refresh();
      if (S.d.chords.length && !S.proj.bass.generated) { Bs.bassGenerateAll(S.proj.bass, bCtx()); renderBass(); drawBass(); } // 8d'deki üretici; tek geri alma adımının içinde
    }
  } finally { HIST.hold--; }
  histCommit(); HIST.t = -Infinity;
  clearTimeout(BS.timer);
  const L = currentLoop(), bt = S.proj.bass;
  did.push(`davul: ${L ? C.loopLabel(L) : '—'}`, `bas: ${bt.generated ? (Bs.profileById(bt, bt.styleProfileId) || {}).name : '—'}`, `akor sesi: ${C.PIANO_STYLES[S.proj.piano.style].name}`);
  S.pos = 0; $('#tlScroll').scrollLeft = 0;
  const msg = () => `✨ Demo hazır: ${pack ? pack.name : 'eski düzenleme'}${C.chordsAreFrozen(project) ? ' · akorlar korundu' : ''} → ` + did.join(' · ') + '. Çalıyor; beğenmediğini ⟳ ile değiştir, Ctrl+Z ile geri al.';
  status(msg());
  (async () => { // ses dengesi: fader'a hiç dokunmadıysan izler vokale göre otomatik dengelenir (mikser geri almaya dahil değil)
    if (!S.proj.mixer.touched) { try { if (await autoMix(true, current)) did.push('ses dengesi otomatik'); } catch (e) { /* ölçüm başarısızsa mevcut seviyeler kalır */ } }
    if (!current()) return;
    status(msg());
    await Player.play();
    if (current() && Player.playing) status(msg());
  })();
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
    this.master = new T.Limiter(-1).toDestination(); // ana çıkış: sert tepe sınırı (−1 dB); kanallar toplanırken kırpılmaz
    this.vocalCh = new T.Channel(0).connect(this.master);
    this.pianoCh = new T.Channel(-6).connect(this.master);
    this.synthBus = new T.Gain(1).connect(this.pianoCh); // synth klavye de "akor" kanalından geçer (ses seviyesi / mute / solo ortak)
    this.vocalBus = new T.Gain(1).connect(this.vocalCh); // MIDI melodisi (synth) Vokal kanalından geçer
    this.synthVoices = new Set();
    this.gA = new T.Gain(0).connect(this.vocalCh);
    this.gB = new T.Gain(1).connect(this.vocalCh);
    this.pA = new T.Player().connect(this.gA);
    this.pB = new T.Player().connect(this.gB);
    this.makeClicks();
    this.drumCh = new T.Channel(-8).connect(this.master);
    this.guitarCh = new T.Channel(-4).connect(this.master);
    this.bassCh = new T.Channel(-4).connect(this.master);
    const rsr = T.getContext().sampleRate;
    this.drumBufs = {};
    for (const k of C.DRUM_KINDS) this.drumBufs[k] = toAudioBuffer(C.synthDrum(k, rsr), rsr);
    this.synthDrumBufs = this.drumBufs;
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
    this.bufA = new Tone.ToneAudioBuffer(toAudioBuffer(vfxData('A'), S.audio.sr));
    this.bufB = new Tone.ToneAudioBuffer(toAudioBuffer(vfxData('B'), S.audio.sr));
    this.buffersDirty = false;
  },
  // Tone, bir kaynağın önceden zamanlanmış gelecek başlangıçlarını durdurunca silmez; döngü turları bu yüzden her çalmada taze oynatıcılarla zamanlanır
  // metronom sentezleri de taze kurulur: önceden gelecek zamana verilmiş tıklar (iptal edilen sayım) yeni zamanlamayı bozmaz
  makeClicks() {
    for (const k of ['click', 'snare']) if (this[k]) { try { this[k].dispose(); } catch (err) { /* zaten bırakıldı */ } }
    this.click = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }, volume: -16 }).connect(this.master);
    this.snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 }, volume: -12 }).connect(this.master);
  },
  freshPlayers() {
    this.makeClicks();
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
    const mg = m.guitar || (m.guitar = { vol: -4, mute: false, solo: false });
    const mb = m.bass || (m.bass = { vol: -4, mute: false, solo: false });
    const anySolo = m.vocal.solo || m.piano.solo || m.drums.solo || mg.solo || mb.solo;
    this.vocalCh.volume.value = m.vocal.vol;
    this.pianoCh.volume.value = m.piano.vol;
    this.drumCh.volume.value = m.drums.vol;
    this.guitarCh.volume.value = mg.vol;
    this.bassCh.volume.value = mb.vol;
    this.vocalCh.mute = m.vocal.mute || (anySolo && !m.vocal.solo);
    this.pianoCh.mute = m.piano.mute || (anySolo && !m.piano.solo);
    this.drumCh.mute = m.drums.mute || (anySolo && !m.drums.solo);
    this.guitarCh.mute = mg.mute || (anySolo && !mg.solo);
    this.bassCh.mute = mb.mute || (anySolo && !mb.solo);
    const corr = m.ab !== 'original';
    this.gA.gain.value = corr ? 0 : 1;
    this.gB.gain.value = corr ? 1 : 0;
  },
  // opts.preview: tek seferlik önizleme · opts.from: başlangıç sn · opts.countIn: başlamadan önce beklenecek sn (tap kaydı sayımı) · opts.onStart(ses saati) · opts.noBass: bas çalmasın · opts.click: metronomu zorla
  async play(opts = {}) {
    const generation = this.generation = (this.generation || 0) + 1;
    if (!S.d) return;
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    if (generation !== this.generation) return;
    const deferDrumStop = S.proj.realSounds.enabled && Object.keys(S.proj.realSounds.drums).length;
    if (!deferDrumStop) this.stop(true, true);
    REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = '';
    const soundGeneration = syncRealSoundGeneration();
    const drumSnapshot = await prepareRealSounds(S.proj, soundGeneration);
    if (generation !== this.generation || soundGeneration !== DRUM_REAL.generation) { drumSnapshot.release(); return; }
    if (deferDrumStop) this.stop(true, true);
    this.realDrumSnapshot = drumSnapshot;
    const drumRate = Tone.getContext().sampleRate, drumBufs = liveDrumBank(drumSnapshot, drumRate);
    this.drumBufs = drumBufs;
    const discardDrums = () => {
      releaseLiveDrumBank(drumBufs); drumSnapshot.release();
      if (this.realDrumSnapshot === drumSnapshot) { this.realDrumSnapshot = null; this.drumBufs = this.synthDrumBufs; }
    };
    const pv = opts.preview || null; // tek seferlik önizleme: bölge bir kez çalar, seçili ayarlar değişmez
    PREVIEW.drums = pv ? pv.drums : null;
    await vfxEnsure();
    if (generation !== this.generation || soundGeneration !== DRUM_REAL.generation) { discardDrums(); return; }
    this.updateBuffers();
    this.freshPlayers();
    this.applyMixer();
    const ins = S.proj.guitar.instrument; // 'piano' | 'guitar' | 'both'
    let gtr = null;
    if (ins !== 'piano') { status('Gitar partisi hazırlanıyor…', 'busy'); await tick(); if (generation !== this.generation || soundGeneration !== DRUM_REAL.generation) { discardDrums(); return; } gtr = guitarTrack(Tone.getContext().rawContext.sampleRate); }
    const T = this.transport();
    T.cancel(0);
    const g = S.d.g, off = S.d.off;
    // döngü: seçili bölüm (ya da imleçten 4 ölçü) tekrar tekrar çalınır; tekrarlar baştan zamanlanır, aralarda boşluk olmaz
    const region = pv ? { from: pv.from, to: pv.to } : opts.region || (opts.from == null && S.loop.on && S.loop.to > S.loop.from + 0.05 ? S.loop : null);
    let from = opts.from ?? S.pos;
    if (region && (from < region.from - 1e-6 || from >= region.to - 1e-6)) from = region.from;
    const len = region ? region.to - region.from : 0;
    // her tur: [lo, hi) zaman çizelgesi aralığı, tau0 = lo'nun Transport zamanı
    const rounds = [{ lo: from, hi: region ? region.to : Infinity, tau0: from }];
    if (region && !pv) for (let k = 0; k < Math.min(200, Math.ceil(600 / len)); k++) rounds.push({ lo: region.from, hi: region.to, tau0: from + (region.to - from) + k * len });
    const pev = ins === 'guitar' ? [] : pianoEventsAll(), dev = drumEventsAll(), mev = melodyEvents();
    if (window.__dawAPI.onScheduledEvents) window.__dawAPI.onScheduledEvents({ piano: pev, drums: dev, guitar: gtr ? gtr.events : [] });
    if (S.proj.bass.enabled && !opts.noBass && S.proj.bass.bars.some((b) => b.notes.length)) scheduleBassPlay(T, rounds, g, bCtx());
    const poInst = C.pianoOpts(S.proj.piano).inst;
    // ses saati ağır hazırlıktan SONRA alınır: tap kaydı (onStart) sayımı bu ana göre ölçer
    const now = Tone.now() + 0.12 + (opts.countIn || 0);
    if (opts.onStart) opts.onStart(now);
    const sr = Tone.getContext().rawContext.sampleRate;
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
      if (gtr) this.startGuitar(gtr.data, sr, now + (r.tau0 - from), r.lo, false, region ? Math.max(0.01, r.hi - r.lo - 0.002) : undefined);
      for (const e of pev) {
        if (e.t >= r.hi || e.t + e.dur <= r.lo + 0.01) continue;
        const st = Math.max(e.t, r.lo);
        T.schedule((time) => this.playNote(e.inst || poInst, e, time, st), at(st));
      }
      for (const e of mev) {
        if (e.t >= r.hi || e.t + e.dur <= r.lo + 0.01) continue;
        const st = Math.max(e.t, r.lo);
        T.schedule((time) => this.hitSynth(e, time, Math.max(0.05, e.t + e.dur - st)), at(st));
      }
      for (const e of dev) if (e.t >= r.lo - 0.01 && e.t < r.hi) T.schedule((time) => this.hitDrum(e, time, drumBufs), at(e.t));
      if (opts.click ?? S.proj.mixer.click) {
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
    const ctx = Tone.getContext().rawContext, P = e.lead ? C.SYNTH.lead : e.arp ? C.SYNTH.arp : C.SYNTH.chord;
    const env = C.synthEnv(!!e.arp, dur, !!e.fade, !!e.lead), total = dur + env.tail, n = Math.max(16, Math.ceil(total * 200));
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
    Tone.connect(out, e.lead ? this.vocalBus : this.synthBus);
    const v = { out, oscs };
    this.synthVoices.add(v);
    oscs[0].onended = () => { this.synthVoices.delete(v); try { out.disconnect(); } catch (err) { /* zaten bağlı değil */ } };
    this.synthHits = (this.synthHits || 0) + 1;
  },
  killSynth() {
    if (!this.synthVoices) return;
    const now = Tone.getContext().rawContext.currentTime;
    for (const v of this.synthVoices) {
      try { v.out.gain.cancelScheduledValues(now); v.out.gain.setTargetAtTime(0, now, 0.015); v.oscs.forEach((o) => o.stop(now + 0.1)); } catch (err) { /* zaten bitti */ }
    }
  },
  // gitar: parti tek bir tampona render edilir (saf JS), çalma tamponu tutar; mix WAV aynı tamponu kullanır
  // dur: yalnızca bu kadar çal (bölge döngüsünün turları); turlar ayrı kaynaklardır
  startGuitar(data, sr, when, offsetSec, loop, dur) {
    const ctx = Tone.getContext().rawContext, src = ctx.createBufferSource();
    src.buffer = toAudioBuffer(data, sr);
    if (loop) { src.loop = true; src.loopEnd = data.length / sr; }
    Tone.connect(src, this.guitarCh);
    try { if (dur != null) src.start(when, Math.max(0, offsetSec), dur); else src.start(when, Math.max(0, offsetSec)); } catch (e) { /* tampon sonundan sonra: çalacak bir şey yok */ }
    if (loop) this.gAud = src; else { (this.gSrcs = this.gSrcs || []).push(src); this.gSrc = src; }
  },
  stopBass() {
    if (this.bassVoices) { const t = Tone.now(); for (const v of this.bassVoices) v.inst.panic(t); this.bassVoices = null; }
  },
  stopGuitar() {
    for (const src of [...(this.gSrcs || []), this.gAud]) if (src) { try { src.stop(); } catch (e) { /* zaten bitti */ } }
    this.gSrcs = []; this.gSrc = null; this.gAud = null;
    GT.auditioning = false; syncGuitarButtons();
  },
  async auditionGuitar() {
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    this.stop(true);
    this.applyMixer();
    const sr = Tone.getContext().rawContext.sampleRate;
    const a = guitarAudition(sr);
    this.startGuitar(a.data, sr, Tone.now() + 0.05, 0, true);
    GT.auditioning = true; syncGuitarButtons();
    status(`▶ Gitar önizleme · ${a.real ? 'projenin akorları' : 'Am–F–C–G'} · ${S.proj.settings.meter} · ${S.proj.settings.bpm} BPM (2 ölçü döngü)`);
  },
  // tek davul vuruşu: önceden sentezlenmiş örnek, hıza göre kazanç
  hitDrum(e, time, bank = this.drumBufs) {
    const ctx = Tone.getContext().rawContext;
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = bank[e.kind]; gn.gain.value = e.vel;
    src.connect(gn); Tone.connect(gn, this.drumCh);
    const lease = DRUM_NATIVE.get(bank)?.get(e.kind);
    if (lease) lease.refs++;
    src.onended = () => { src.disconnect(); gn.disconnect(); if (lease && --lease.refs === 0) lease.release(); };
    try { src.start(time); } catch (e) { if (lease && --lease.refs === 0) lease.release(); throw e; }
    this.drumHits = (this.drumHits || 0) + 1;
  },
  async previewDrums(L, bars = L && L.fill ? L.fill.every : 2) { // fill'li kalıpta fill'i de duyur
    if (!L) return;
    const generation = this.generation = (this.generation || 0) + 1;
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    if (generation !== this.generation) return;
    REAL.decoded = {}; REAL.sampleRates = {}; REAL.signature = '';
    const soundGeneration = syncRealSoundGeneration(), snapshot = await prepareCurrentRealSounds();
    if (generation !== this.generation || soundGeneration !== DRUM_REAL.generation) { snapshot.release(); return; }
    this.stop(true, true); VERS.resume = null; this.realDrumSnapshot = snapshot;
    const sr = Tone.getContext().sampleRate, bank = liveDrumBank(snapshot, sr);
    this.drumBufs = bank;
    this.applyMixer();
    const g = C.makeGrid(S.proj.settings), T = this.transport();
    T.cancel(0);
    for (const e of C.drumEvents(L, g, bars)) T.schedule((time) => this.hitDrum(e, time, bank), e.t);
    T.start(Tone.now() + 0.1, 0);
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { if (generation === this.generation) { T.stop(); T.cancel(0); } releaseLiveDrumBank(bank); snapshot.release(); if (this.drumBufs === bank) this.drumBufs = this.synthDrumBufs; if (this.realDrumSnapshot === snapshot) this.realDrumSnapshot = null; }, (bars * g.barSec + 1) * 1000);
    status(`▶ ${C.loopLabel(L)} · ${S.proj.settings.meter} · ${S.proj.settings.bpm} BPM`);
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
  stop(silent, preparing) {
    if (this.realDrumSnapshot) { releaseLiveDrumBank(this.drumBufs); this.realDrumSnapshot.release(); this.realDrumSnapshot = null; this.drumBufs = this.synthDrumBufs; }
    if (!preparing) { this.generation = (this.generation || 0) + 1; VERS.resume = null; }
    if (!this.ready) return;
    const T = this.transport();
    T.stop(); T.cancel(0);
    this.pA.stop(); this.pB.stop();
    this.sampler.releaseAll();
    this.killSynth();
    this.stopGuitar();
    this.stopBass();
    this.playing = false;
    PREVIEW.drums = null;
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
  constructor() { super(); this.on = true; this.buf = new Float32Array(2048); this.n = 0; this.f0 = 0;
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
      liveMeter(st);
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
    hideLivePitch();
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

// ---------------------------------------------------------------- CANLI PERDE GÖSTERGESİ (kayıt ve punch-in sırasında)
function captureTail(st, n = 2048) {
  const parts = []; let need = n;
  for (let k = st.chunks.length - 1; k >= 0 && need > 0; k--) { const c = st.chunks[k]; parts.unshift(c.length > need ? c.subarray(c.length - need) : c); need -= Math.min(need, c.length); }
  const out = new Float32Array(n - Math.max(0, need)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function liveMeter(st) {
  const tail = captureTail(st, 2048);
  showLivePitch(tail.length >= 2048 ? C.livePitch(tail, st.ctx.sampleRate) : null);
}
function showLivePitch(r) {
  const box = $('#livePitch');
  if (!box) return;
  box.hidden = false;
  const nd = $('#lpNeedle');
  if (!r) { $('#lpText').textContent = '♪ —'; nd.className = ''; nd.style.left = '50%'; return; }
  const a = Math.abs(r.cents);
  $('#lpText').textContent = `♪ ${r.note} ${r.cents > 0 ? '+' : ''}${r.cents}¢`;
  nd.className = a <= 20 ? 'ok' : a <= 40 ? 'warn' : 'bad';
  nd.style.left = (50 + Math.max(-50, Math.min(50, r.cents))) + '%';
}
const hideLivePitch = () => { const b = $('#livePitch'); if (b) b.hidden = true; };

// ---------------------------------------------------------------- PUNCH-IN: yalnızca seçilen ölçüleri yeniden çek
// Fon müziği (miksin render'ı) + click, mikrofon yakalamasıyla AYNI AudioContext'te çalınır → örnek hassasiyetinde hizalı.
// Yeni take, eski kaydın [bölge başı, bölge sonu) aralığına 10 ms kenar geçişiyle yerleştirilir; eski ve yeni take'ler saklanır (S.comps)
// ve tek tıkla değiştirilir. Take'ler oturum boyunca durur (proje dosyasına yalnızca çalan hali gömülür).
S.comps = [];
const MAX_TAKES = 6;
function punchRegion() {
  const a = Math.round(+$('#inPunchA').value), b = Math.round(+$('#inPunchB').value);
  if (!S.d || !(a >= 1) || !(b >= a) || b > S.d.bars) return null;
  const g = S.d.g;
  return { a, b, tA: (a - 1) * g.barSec, tB: b * g.barSec };
}
function setPunchRegion(a, b) {
  if (!S.d) return;
  a = Math.max(1, Math.min(S.d.bars, a)); b = Math.max(a, Math.min(S.d.bars, b));
  $('#inPunchA').value = a; $('#inPunchB').value = b;
  punchInfoUpdate(); draw();
}
function punchInfoUpdate() {
  const r = punchRegion(), el = $('#punchInfo');
  if (!el || Punch.st) return;
  el.textContent = !S.audio ? 'Punch-in için önce bir kayıt ya da yüklenmiş ses gerekli.' : r ? `Ölçü ${r.a}–${r.b} yeniden çekilecek (${(r.tB - r.tA).toFixed(1)} sn).` : 'Geçerli bir ölçü aralığı gir.';
  $('#btnPunch').disabled = !S.audio || !r;
}
async function renderPunchBacking(sr, tS, tA, tB, withOld) {
  const st = await renderStems(sr, tB + 1.0);
  const n = Math.round((tB + 1.0) * sr), mix = new Float32Array(n);
  const m = S.proj.mixer, anySolo = m.vocal.solo || m.piano.solo || m.drums.solo || m.guitar.solo || m.bass.solo;
  const gain = (k) => (m[k].mute || (anySolo && !m[k].solo) ? 0 : dbToGain(m[k].vol));
  for (const k of ['vocal', 'piano', 'guitar', 'bass', 'drums']) {
    const arr = st[k], gk = arr ? gain(k) : 0;
    if (!gk) continue;
    let end = Math.min(n, arr.length);
    if (k === 'vocal') { if (!withOld) continue; end = Math.min(end, Math.round(tA * sr)); } // eski vokal bölge başında susar
    const fade = Math.round(0.02 * sr);
    for (let i = 0; i < end; i++) mix[i] += arr[i] * gk * (k === 'vocal' && i > end - fade ? (end - i) / fade : 1);
  }
  const i0 = Math.max(0, Math.floor(tS * sr));
  return mix.subarray(i0);
}
const Punch = {
  st: null,
  async start() {
    if (this.st || Rec.st || Cal.on) return;
    if (!S.audio || !S.d) { status('Punch-in için önce bir kayıt ya da yüklenmiş ses gerekli.', 'err'); return; }
    const r = punchRegion();
    if (!r) { status('Geçerli bir ölçü aralığı gir (1–' + S.d.bars + ').', 'err'); return; }
    if (Player.playing) Player.stop();
    const g = S.d.g, pre = +$('#inPunchPre').value, tS = Math.max(0, r.tA - pre * g.barSec);
    let st;
    try { st = await openCapture(); } catch (e) { status('Mikrofon izni alınamadı: ' + e.message, 'err'); return; }
    const ctx = st.ctx, sr = ctx.sampleRate;
    let back;
    try {
      await busy('Fon müziği hazırlanıyor…', async () => { await tick(); back = await renderPunchBacking(sr, tS, r.tA, r.tB, $('#inPunchOld').checked); });
    } catch (e) { await closeCapture(st); return; }
    const T0 = ctx.currentTime + 0.5;
    const buf = ctx.createBuffer(1, Math.max(1, back.length), sr);
    buf.copyToChannel(back, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(T0);
    Object.assign(st, { src, region: r, p: { T0, tS, sr, firstFrame: 0 }, tS, T0 });
    const vol = +$('#inClickVol').value, click = $('#inPunchClick').checked;
    let q = Math.ceil(tS / g.spq / g.clickQ - 1e-6) * g.clickQ;
    const sched = () => {
      const now = ctx.currentTime, horizon = now + 0.25;
      while (click && T0 + q * g.spq - tS < horizon && q * g.spq <= r.tB + 1e-6) {
        const kind = C.clickKind(g, q % g.barQ, S.proj.settings.clickFeel), at = T0 + q * g.spq - tS;
        if (at >= now - 0.01) { if (kind === 'snare') noiseClickAt(ctx, at, vol); else clickAt(ctx, at, CLICK_HZ[kind], vol * (kind === 'weak' ? 0.6 : 1)); }
        q += g.clickQ;
      }
      const song = tS + (now - T0);
      if (song < r.tA) status(`Ön çalma… ölçü ${Math.max(1, Math.floor(Math.max(0, song) / g.barSec) + 1)} → ${r.a}'da gir`, 'busy');
      else status(`● Punch-in — ölçü ${Math.min(r.b, Math.floor(song / g.barSec) + 1)} (${r.a}–${r.b})`, 'busy');
      liveMeter(st);
      if (now >= T0 + (r.tB - tS) + 0.2) Punch.finish(false);
    };
    st.timer = setInterval(sched, 40);
    this.st = st;
    $('#btnPunch').disabled = true; $('#btnPunchStop').disabled = false; $('#btnRec').disabled = true;
    S.punchShow = r; draw();
  },
  async finish(early) {
    const st = this.st;
    if (!st) return;
    this.st = null;
    clearInterval(st.timer);
    const r = st.region, ctx = st.ctx, sr = ctx.sampleRate;
    const nowSong = st.tS + (ctx.currentTime - st.T0);
    try { st.src.stop(); } catch (e) { /* zaten bitti */ }
    const take = await closeCapture(st);
    hideLivePitch();
    $('#btnPunchStop').disabled = true; $('#btnRec').disabled = false;
    S.punchShow = null;
    const tEnd = early ? Math.min(r.tB, nowSong - 0.12) : r.tB;
    if (st.firstFrame == null || tEnd - r.tA < 0.3) { status('Punch-in çok kısa kaldı: kayıt değişmedi.', 'err'); punchInfoUpdate(); draw(); return; }
    const p = Object.assign({}, st.p, { firstFrame: st.firstFrame, latSec: (S.proj.settings.latencyMs || 0) / 1000 });
    const ia = C.punchTakeIndex(r.tA, p), ib = C.punchTakeIndex(tEnd, p);
    const raw = new Float32Array(Math.max(0, ib - ia));
    for (let i = 0; i < raw.length; i++) { const j = ia + i; if (j >= 0 && j < take.length) raw[i] = take[j]; }
    await applyPunch(r, tEnd, raw, sr);
  },
};
// yeni take'i (raw: yakalama hızında, bölge başından tEnd'e) kayda yerleştirir
async function applyPunch(r, tEnd, raw, capSr) {
  const fileSr = S.audio.sr, off = S.d.off;
  let seg = fileSr === capSr ? raw : C.resample(raw, capSr, fileSr);
  let faFull = Math.round((r.tA + off) * fileSr);
  const fbFull = Math.round((r.tB + off) * fileSr), n = fbFull - faFull;
  const want = Math.min(n, Math.round((tEnd - r.tA) * fileSr));
  if (seg.length !== want) { const t = new Float32Array(want); t.set(seg.subarray(0, Math.min(want, seg.length))); seg = t; }
  // dosya başından önceye taşan kısım atılır (başa boşluk eklemek bütün analizi kaydırırdı)
  let cut = 0;
  if (faFull < 0) { cut = -faFull; faFull = 0; seg = seg.subarray(Math.min(cut, seg.length)); }
  if (!seg.length) { status('Punch-in bölgesi kaydın başından önce kalıyor.', 'err'); return; }
  const fa = faFull, fb = fbFull;
  const base = S.audio.data;
  const old = new Float32Array(fb - fa); // eski içerik (dosya sonundan taşan kısım sessizlik)
  for (let i = 0; i < old.length; i++) { const j = fa + i; if (j < base.length) old[i] = base[j]; }
  const sp = C.punchSplice(base, fa, fa + seg.length, seg, Math.round(0.01 * fileSr));
  const region = sp.data.slice(fa, fb > sp.data.length ? sp.data.length : fb);
  const full = new Float32Array(fb - fa); full.set(region.subarray(0, full.length));
  // take listesi: aynı ölçü aralığı → yeni take eklenir; çakışan farklı aralıklar kapanır
  let comp = S.comps.find((c) => c.a === r.a && c.b === r.b);
  const dropped = S.comps.filter((c) => c !== comp && !(c.b < r.a || c.a > r.b));
  S.comps = S.comps.filter((c) => !dropped.includes(c));
  if (!comp) { comp = { id: 'c' + Date.now().toString(36), a: r.a, b: r.b, fa, fb, takes: [{ name: 'Orijinal', data: old }], cur: 0 }; S.comps.push(comp); }
  if (comp.takes.length >= MAX_TAKES) comp.takes.splice(1, 1); // en eski ara take'i at (orijinal kalır)
  comp.takes.push({ name: 'Take ' + (comp.takes.length + 1), data: full });
  comp.cur = comp.takes.length - 1;
  S.audio.data = sp.data; S.corrected = null; S.correctedShift = null;
  Player.buffersDirty = true; HIST.reset = true;
  status(`Punch-in yerleştirildi: ölçü ${r.a}–${r.b}. Perde yeniden analiz ediliyor…${dropped.length ? ' (çakışan önceki bölgenin take\'leri kapandı)' : ''}`, 'busy');
  await analyze();
  renderTakes(); punchInfoUpdate();
  status(`⏺ Punch-in tamam: ölçü ${r.a}–${r.b} (${comp.takes[comp.cur].name}). Take'ler arasında geçebilirsin; bu bölgedeki elle nota düzeltmelerini kontrol et.`);
}
async function switchTake(compId, idx) {
  const c = S.comps.find((x) => x.id === compId);
  if (!c || !c.takes[idx] || c.cur === idx) return;
  const d = Float32Array.from(S.audio.data), t = c.takes[idx].data;
  for (let i = 0; i < t.length && c.fa + i < d.length; i++) d[c.fa + i] = t[i];
  S.audio.data = d; c.cur = idx; S.corrected = null; S.correctedShift = null;
  Player.buffersDirty = true; HIST.reset = true;
  status(`${c.takes[idx].name} yerleştiriliyor (ölçü ${c.a}–${c.b})…`, 'busy');
  await analyze();
  renderTakes();
  status(`Ölçü ${c.a}–${c.b}: ${c.takes[idx].name}.`);
}
function renderTakes() {
  const el = $('#takeList');
  if (!el) return;
  const h = S.comps.map((c) => `<div class="take-row"><b>Ölçü ${c.a}–${c.b}</b>${c.takes.map((t, i) => `<button class="small${i === c.cur ? ' on' : ''}" data-comp="${c.id}" data-take="${i}" title="Bu take'i çal / yerleştir">${esc(t.name)}</button>`).join('')}<button class="small" data-keep="${c.id}" title="Şu anki take'i sabitle, diğerlerini sil (bellek)">sabitle</button></div>`).join('');
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
$('#takeList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.take != null) switchTake(b.dataset.comp, +b.dataset.take);
  if (b.dataset.keep) { S.comps = S.comps.filter((c) => c.id !== b.dataset.keep); renderTakes(); status('Take sabitlendi: diğer take\'ler silindi.'); }
});
$('#btnPunch').onclick = () => Punch.start();
$('#btnPunchStop').onclick = () => Punch.finish(true);
$('#inPunchA').addEventListener('input', () => { punchInfoUpdate(); draw(); });
$('#inPunchB').addEventListener('input', () => { punchInfoUpdate(); draw(); });
$('#btnPunchSec').onclick = () => {
  const sec = S.sel && S.sel.type === 'section' ? S.d && S.d.sections.find((x) => x.id === S.sel.id && !x.implicit) : null;
  if (!sec) { status('Önce zaman çizelgesinde bir bölüme tıkla.', 'err'); return; }
  setPunchRegion(sec.startBar, sec.endBar);
};
$('#btnPunchLoop').onclick = () => {
  if (!S.d || !S.loop.on) { status('Önce 🔁 döngüyü aç (bölge oradan alınır).', 'err'); return; }
  const g = S.d.g; setPunchRegion(Math.floor(S.loop.from / g.barSec + 1e-6) + 1, Math.ceil(S.loop.to / g.barSec - 1e-6));
};
$('#btnPunchPos').onclick = () => { if (S.d) { const b = barAtPlayheadQ(); setPunchRegion(b, b); } };

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
  // punch-in bölgesi (⏺): cetvelde kırmızı bant (panel açıkken ya da kayıt sürerken)
  { const pr = S.punchShow || ($('#punchBox') && $('#punchBox').open && S.audio ? punchRegion() : null);
    if (pr) {
      const px0 = Math.max(TL.KW, qToX(pr.tA / g.spq)), px1 = Math.min(W, qToX(pr.tB / g.spq));
      if (px1 > px0) { c.fillStyle = 'rgba(255,90,95,0.20)'; c.fillRect(px0, 0, px1 - px0, TL.RULER); c.strokeStyle = 'rgba(255,90,95,0.8)'; c.strokeRect(px0 + 0.5, 0.5, px1 - px0 - 1, TL.RULER - 1); c.fillStyle = '#ffb3b5'; c.fillText('⏺ punch-in', px0 + 4, TL.RULER - 4); }
    } }
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
      c.fillText((s.implicit ? 'Bölüm yok — tüm şarkı' : (linkSource(s.id) ? '↻ ' : '') + s.name) + key, Math.max(TL.KW, x0) + 6, secY + TL.SEC / 2);
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
      if (s.locked && !linkSource(s.section) && x1 - x0 > 30) { // kilidi kaldırma düğmesi
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
    for (const m of effectiveMarks()) {
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
  drawBass(); // bas şeridi aynı yatay kaydırma ve yakınlaştırmayı izler
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
  if (sel && sel.type === 'section') S.customSection = sel.id;
  renderCustomPicker();
  S.sel = sel; if (sel) clearBassSel(); renderInspector(); renderSections(); renderChordPreservation(); draw();
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
  if (!S.track || !S.d) { if (S.midi) status('MIDI notaları zaten ayrı nota olarak geldi; bölmek için ses analizi gerekir.'); return; }
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
  structuralEdit(S.proj.sections.map((s) => s.id), () => {
    C.shiftSong(S.proj, n);
    S.proj.chordPins = []; S.sel = null;
  }, `Şarkı ${Math.abs(n)} ölçü ${n > 0 ? 'geri (başa boşluk eklendi)' : 'öne alındı'}: ses, ölçü çizgileri, bölümler, akor kilitleri ve düzenlemeler birlikte kaydı.`);
  scheduleRender(true);
}


// ---------------------------------------------------------------- bölümler
function addSection(name, a, b) {
  const overl = S.proj.sections.find((s) => !(b < s.startBar || a > s.endBar));
  if (overl) { status(`Bölümler çakışamaz (“${overl.name}” ölçü ${overl.startBar}–${overl.endBar}).`, 'err'); return; }
  if (!name) {
    const used = new Set(S.proj.sections.map((s) => s.name));
    name = ['Verse', 'Nakarat', 'Köprü', 'Verse 2', 'Nakarat 2', 'Outro'].find((n) => !used.has(n)) || 'Bölüm ' + (S.proj.sections.length + 1);
  }
  const s = { id: uid(), link: null, name, startBar: a, endBar: b, tonic: null, mode: null };
  S.proj.sections.push(s);
  S.proj.sections.sort((p, q) => p.startBar - q.startBar);
  S.sel = { type: 'section', id: s.id }; S.customSection = s.id;
  refresh();
  status(`“${name}” bölümü eklendi (ölçü ${a}–${b}). Tonunu 4. adımda seçin.`);
}
function deleteSection(id) {
  const s = S.proj.sections.find((x) => x.id === id);
  if (!s) return;
  structuralEdit([id], () => {
    S.proj.sections = S.proj.sections.filter((x) => x.id !== id);
    S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar < s.startBar || l.bar > s.endBar);
    if (S.sel && S.sel.id === id) S.sel = null;
  }, `“${s.name}” bölümü silindi (ölçü ${s.startBar}–${s.endBar}).`);
}
// Paket paneli; uyarılar yalnızca son uygulama için gösterilir.
const PACK_UI = { project: null, warnings: [], kept: [] };
const PACK_LAYER_NAMES = { piano: 'Akor', guitar: 'Gitar', bass: 'Bas', drums: 'Davul' };
function renderPacks() {
  const p = S.proj;
  C.migratePack(p);
  if (PACK_UI.project !== p) { PACK_UI.project = p; PACK_UI.warnings = []; PACK_UI.kept = []; }
  const ranked = C.rankPacks(p), select = $('#inPack');
  const record = (id) => C.PACKS.find((pack) => pack.id === id);
  const fit = (r) => r.fits ? 'BPM aralığına uyuyor' : `±${r.distance} BPM dışında`;
  $('#chipPack').textContent = record(p.pack.id)?.name || 'yok';
  select.innerHTML = ranked.map((r) => `<option value="${r.id}">${esc(record(r.id).name)} — ${fit(r)}</option>`).join('');
  select.value = ranked.some((r) => r.id === p.pack.selectedId) ? p.pack.selectedId : ranked.some((r) => r.id === p.pack.id) ? p.pack.id : ranked[0]?.id || '';
  $('#packSuggestions').innerHTML = C.topSuggestions(p).map((r) => `<button data-pack="${r.id}">${esc(record(r.id).name)}<small>${fit(r)}</small></button>`).join('');
  $('#packUnavailable').hidden = !!ranked.length;
  for (const el of [select, $('#btnPackApply'), $('#btnPackNext'), ...$$('[data-pack-lock]')]) el.disabled = !ranked.length;
  for (const el of $$('[data-pack-lock]')) { const locked = p.pack.locks[el.dataset.packLock]; el.setAttribute('aria-pressed', String(locked)); el.classList.toggle('on', locked); }
  const messages = [...PACK_UI.warnings, ...(PACK_UI.kept.length ? ['Kilitli katmanlar korundu: ' + PACK_UI.kept.map((l) => PACK_LAYER_NAMES[l]).join(', ')] : [])];
  $('#packWarnings').innerHTML = messages.map((msg) => `<li>${esc(msg)}</li>`).join('');
}
function applyPackUI(id) {
  if (!id || !S.d) return;
  try {
    const restarting = matrixEdit(() => {
      const result = C.applyPack(S.proj, S.d, id);
      PACK_UI.project = S.proj; PACK_UI.warnings = result.warnings; PACK_UI.kept = result.kept;
      S.proj.pack.selectedId = id;
      $('#inPack').value = id;
    });
    clearTimeout(BS.timer);
    const name = C.PACKS.find((p) => p.id === id).name;
    const message = [`Tür paketi: ${name}`, ...PACK_UI.warnings, ...(PACK_UI.kept.length ? ['Kilitli katmanlar korundu: ' + PACK_UI.kept.map((l) => PACK_LAYER_NAMES[l]).join(', ')] : [])].join(' · ');
    status(message);
    if (restarting) restarting.then(() => status(message));
  } catch (e) { status(e.message, 'err'); }
}
$('#packSuggestions').onclick = (e) => { const b = e.target.closest('[data-pack]'); if (b) applyPackUI(b.dataset.pack); };
$('#inPack').onchange = (e) => {
  histCommit();
  S.proj.pack.selectedId = e.target.value || null;
  renderVersions();
};
$('#btnPackApply').onclick = () => applyPackUI($('#inPack').value);
$('#btnPackNext').onclick = () => applyPackUI(C.nextPack(S.proj, S.proj.pack.id || $('#inPack').value));
$('#packLocks').onclick = (e) => {
  const b = e.target.closest('[data-pack-lock]'); if (!b || b.disabled) return;
  matrixEdit(() => { const l = b.dataset.packLock; S.proj.pack.locks[l] = !S.proj.pack.locks[l]; });
};

// ---------------------------------------------------------------- SÜRÜMLER: çalışma kopyası, tek adımlı geçiş ve karşılaştırmalı dinleme
const VERS = { confirm: null, rename: null, timer: null, generation: 0, resume: null, project: null };
function queueVersions() {
  if (!S.proj.versions.items.length) return;
  clearTimeout(VERS.timer);
  VERS.timer = setTimeout(renderVersions, 120);
}
function renderVersions() {
  clearTimeout(VERS.timer);
  if (VERS.project !== S.proj) { VERS.project = S.proj; VERS.confirm = null; VERS.rename = null; }
  const versions = S.proj.versions, active = versions.items.find((v) => v.id === versions.activeId);
  $('#chipVersions').textContent = active ? active.name : 'yok';
  const dirty = active && C.isVersionDirty(S.proj, S.d, active.id);
  $('#versionList').innerHTML = versions.items.map((v) => {
    const compat = C.versionCompat(S.proj, S.d, v.id);
    return `<div class="version-row" data-version="${esc(v.id)}">
      <div><b>${esc(v.name)}</b> ${v.id === versions.activeId ? '<span class="chip">aktif</span>' + (dirty ? ' <span class="chip version-dirty">Değiştirildi</span>' : '') : ''}</div>
      ${compat.ok ? '' : `<p class="hint">${esc(compat.warnings.join(' '))}</p>`}
      <div class="row"><button data-version-act="switch" ${compat.ok ? '' : 'disabled'}>Geç</button><button data-version-act="update">${VERS.confirm === v.id ? 'Güncelle — onayla' : 'Güncelle'}</button><button data-version-act="rename">Ad ver</button><button data-version-act="delete">Sil</button></div>
      ${VERS.rename === v.id ? `<div class="row"><input type="text" data-version-name aria-label="Sürüm adı" value="${esc(v.name)}"><button data-version-act="renameSave">Adı kaydet</button></div>` : ''}
    </div>`;
  }).join('') || '<p class="hint">Henüz sürüm yok.</p>';
}
function versionEdit(fn, message) {
  let result;
  matrixEdit(() => { result = fn(); });
  status(result.ok ? message + (result.warnings.length ? ' ' + result.warnings.join(' ') : '') : result.warnings.join(' '), result.ok ? undefined : 'err');
}
async function switchVersion(id) {
  const item = S.proj.versions.items.find((v) => v.id === id), compat = C.versionCompat(S.proj, S.d, id);
  if (!item || !compat.ok) { status(compat.warnings.join(' '), 'err'); return; }
  invalidateSoundSelection();
  const generation = ++VERS.generation;
  const resume = VERS.resume || (Player.playing ? { from: S.pos, region: Player.region ? { ...Player.region } : null } : null);
  histCommit(); HIST.t = -Infinity;
  const before = historyEntry(true);
  const result = C.applyVersionState(S.proj, S.d, item.state);
  if (!result.ok) { status(result.warnings.join(' '), 'err'); return; }
  Player.stop(true);
  clearTimeout(BS.timer); clearTimeout(GT.timer); clearTimeout(vfxTimer);
  VERS.resume = resume;
  S.proj.versions.activeId = id;
  if (result.needsPinSigRefresh) S.proj.chordPinsSig = pinSig();
  BS.hist = Bs.newHistory(); BS.sel = null; BS.note = null; BS.drag = null; BS.form = null;
  GT.cache = null;
  syncInputs(); Player.applyMixer();
  HIST.hold++;
  try { refresh(); } finally { HIST.hold--; }
  HIST.undo.push(before); if (HIST.undo.length > 100) HIST.undo.shift();
  HIST.redo = []; HIST.base = snapProj(); HIST.t = -Infinity; HIST.last = 'proj'; histButtons();
  VERS.confirm = null; VERS.rename = null; renderVersions();
  const versionSounds = await prepareCurrentRealSounds(); versionSounds.release();
  if (generation !== VERS.generation) return;
  if (resume) { S.pos = resume.from; await Player.play({ from: resume.from, region: resume.region }); }
  if (generation !== VERS.generation) return;
  VERS.resume = null;
  status(`“${item.name}” sürümüne geçildi. Değişiklikler Ctrl+Z ile geri alınabilir.` + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''));
}
$('#btnVersionSave').onclick = () => {
  const name = $('#inVersionName').value.trim();
  versionEdit(() => C.saveVersion(S.proj, S.d, name || undefined), 'Sürüm kaydedildi.');
  $('#inVersionName').value = '';
};
$('#versionList').onclick = (e) => {
  const b = e.target.closest('[data-version-act]'), row = b && b.closest('[data-version]');
  if (!row || b.disabled) return;
  const id = row.dataset.version, act = b.dataset.versionAct;
  if (act === 'switch') { void switchVersion(id); return; }
  if (act === 'rename') { VERS.rename = id; renderVersions(); $('#versionList [data-version-name]').focus(); return; }
  if (act === 'update' && VERS.confirm !== id) { VERS.confirm = id; renderVersions(); status('Kaydedilmiş sürümü değiştirmek için Güncelle düğmesine yeniden basın.'); return; }
  const name = row.querySelector('[data-version-name]')?.value;
  VERS.confirm = null; VERS.rename = null;
  if (act === 'update') versionEdit(() => C.updateVersion(S.proj, S.d, id), 'Sürüm güncellendi.');
  if (act === 'delete') versionEdit(() => C.deleteVersion(S.proj, id), 'Sürüm silindi; mevcut aranje korundu.');
  if (act === 'renameSave') versionEdit(() => C.renameVersion(S.proj, id, name), 'Sürümün adı değiştirildi.');
};
// Yenileme yapmayan çalgı kontrolleri de rozeti günceller; ses karelerinde hesap yapılmaz.
for (const event of ['input', 'change', 'click']) document.addEventListener(event, (e) => {
  if (!e.target.closest('details[data-key="s4c"]')) queueVersions();
});

// Matris ve paket eylemleri komşu düzenlemelerle birleşmeyen ayrı geri alma adımlarıdır.
function matrixEdit(fn) {
  histCommit(); HIST.t = -Infinity;
  fn(); GT.cache = null;
  refresh(); HIST.t = -Infinity;
  if (Player.playing) return Player.play();
}
// Bağlı içerik yalnızca kaynağında düzenlenir; bütün paneller aynı korumayı kullanır.
function linkSource(id) {
  if (!C.resolveLinks(S.proj, { sections: S.proj.sections })[id]) return null;
  const sourceId = S.proj.sections.find((s) => s.id === id)?.link?.sourceId;
  return S.proj.sections.find((s) => s.id === sourceId) || null;
}
function linkedAtBar(bar) {
  const sec = S.proj.sections.find((s) => bar >= s.startBar && bar <= s.endBar);
  return sec && linkSource(sec.id) ? sec : null;
}
function linkedSkipNote() {
  return S.d && Object.keys(C.resolveLinks(S.proj, S.d)).length ? ' Bağlı bölümler atlandı; kaynağı düzenleyin ya da bağı koparın.' : '';
}
function guardLinked(id) {
  const source = linkSource(id);
  if (!source) return false;
  if (S.sel?.type !== 'chord' || !S.d.chords.some((c) => c.section === id && S.sel.q >= c.q0 && S.sel.q < c.q1)) select({ type: 'section', id });
  status(`Bu bölüm “${source.name}” kaynağını izliyor. Kaynağı düzenle ya da Bağı kopar.`, 'warn');
  return true;
}
function linkActions(id) {
  const source = linkSource(id);
  return source ? `<div class="link-info"><span class="tag">↻ ${esc(source.name)}'na bağlı</span> <span class="hint">Akorlar, kilitler, düzenleme, matris, gitar ve bas kaynaktan.</span><button data-link-source="${esc(id)}">Kaynağı düzenle</button><button data-link-unlink="${esc(id)}">Bağı kopar</button></div>` : '';
}
function changeSectionLink(id, sourceId) {
  let result;
  const name = S.proj.sections.find((s) => s.id === id)?.name || 'Bölüm';
  matrixEdit(() => {
    result = sourceId ? C.linkSection(S.proj, S.d, id, sourceId) : C.unlinkSection(S.proj, S.d, id);
    if (result.ok) { S.proj.chordPinsSig = pinSig(); BS.drag = null; BS.note = null; BS.form = null; }
  });
  status(result.ok ? sourceId ? `“${name}” kaynağa bağlandı.` : `“${name}” bağımsız kopya oldu; sesi aynı kaldı.` : result.warnings.join(' '), result.ok ? '' : 'err');
}
function structuralEdit(ids, fn, message) {
  const before = Object.keys(C.resolveLinks(S.proj, S.d)).length;
  matrixEdit(() => {
    const result = C.materializeLinksBeforeStructuralChange(S.proj, S.d, ids);
    if (!result.ok) throw new Error(result.warnings.join(' '));
    fn();
    S.proj.chordPinsSig = pinSig();
    syncInputs();
  });
  const count = before - Object.keys(C.resolveLinks(S.proj, S.d)).length;
  status(message + (count ? ` ${count} bağlı bölüm sesi korunarak bağımsız kopya oldu.` : ''));
}
document.addEventListener('click', (e) => {
  const source = e.target.closest('[data-link-source]'), unlink = e.target.closest('[data-link-unlink]');
  if (source) {
    const sec = linkSource(source.dataset.linkSource);
    if (!sec) return;
    GT.target = sec.id; BS.sec = sec.id;
    select({ type: 'section', id: sec.id }); seek((sec.startBar - 1) * S.d.g.barSec);
    renderGuitar(); renderBass();
    $(`#sectionList [data-sec="${CSS.escape(sec.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  if (unlink) changeSectionLink(unlink.dataset.linkUnlink, null);
});
function renderMatrix() {
  const p = S.proj, d = S.d, matrix = p.matrix || { enabled: false, rows: {} };
  $('#inMatrixEnabled').checked = !!matrix.enabled;
  $('#matrixOff').hidden = !!matrix.enabled;
  $('#chipMatrix').textContent = matrix.enabled ? 'açık' : 'kapalı';
  const box = $('#matrixTable');
  box.classList.toggle('matrix-dim', !matrix.enabled);
  const layers = { piano: 'Akor', guitar: 'Gitar', bass: 'Bas', drums: 'Davul' };
  const ins = p.guitar.instrument;
  const reasons = {
    piano: ins === 'guitar' ? 'Akor katmanı kapalı: piyano çalgısını aç' : '',
    guitar: ins === 'piano' ? 'Gitar katmanı kapalı: gitar çalgısını aç' : '',
    bass: !p.bass.enabled ? 'Bas katmanı kapalı: bası aç' : '',
    drums: !p.drums.on && !anySectionArr('drums') ? 'Davul katmanı kapalı: davulu aç' : ''
  };
  box.innerHTML = '<table class="matrix"><thead><tr><th scope="col">Bölüm</th>' + Object.values(layers).map((name) => `<th scope="col">${name}</th>`).join('') + '<th scope="col">Sıfırla</th></tr></thead><tbody>' + (d ? d.sections : []).map((sec) => {
    const name = sec.implicit ? 'Tümü' : sec.name, linked = !!linkSource(sec.id);
    return `<tr><th scope="row">${esc(name)}${linked ? ' <span class="hint">↻ kaynaktan</span>' + linkActions(sec.id) : ''}</th>` + Object.entries(layers).map(([layer, label]) => {
      const manual = typeof matrix.rows?.[C.linkedRoot(p, d, sec.id)]?.[layer] === 'boolean';
      const on = C.effectiveCell(p, d, sec.id, layer);
      const state = `${manual ? 'elle' : 'otomatik'} ${on ? 'açık' : 'kapalı'}`;
      return `<td><button data-section="${esc(sec.id)}" data-layer="${layer}" class="matrix-cell ${manual ? 'manual' : 'automatic'} ${on ? 'on' : 'off'}" aria-pressed="${on}" aria-label="${esc(name)}, ${label}: ${state}" title="${esc(reasons[layer] || 'İlk tık: otomatiğin tersi; sonraki tık: otomatiğe dön')}"${reasons[layer] || linked ? ' disabled' : ''}>${manual ? 'Elle' : 'Oto'} ${on ? '●' : '○'}</button></td>`;
    }).join('') + `<td><button data-reset="${esc(sec.id)}"${linked ? ' disabled' : ''}>Otomatiğe dön</button></td></tr>`;
  }).join('') + '</tbody></table>';
}
$('#inMatrixEnabled').onchange = (e) => matrixEdit(() => { S.proj.matrix = C.setMatrixEnabled(S.proj, e.target.checked).matrix; });
$('#btnMatrixReset').onclick = () => { matrixEdit(() => { S.proj.matrix.rows = Object.fromEntries(Object.entries(S.proj.matrix.rows).filter(([id]) => linkSource(id))); }); if (linkedSkipNote()) status('Matris sıfırlandı.' + linkedSkipNote()); };
$('#matrixTable').onclick = (e) => {
  const button = e.target.closest('button');
  if (!button || button.disabled || !button.matches('[data-reset],[data-layer]')) return;
  if (guardLinked(button.dataset.reset || button.dataset.section)) return;
  matrixEdit(() => {
    const rows = S.proj.matrix.rows;
    if (button.dataset.reset) { delete rows[button.dataset.reset]; return; }
    const { section: id, layer } = button.dataset;
    const sec = S.d.sections.find((s) => s.id === id);
    const row = rows[id] || (rows[id] = {});
    row[layer] = typeof row[layer] === 'boolean' ? null : !C.matrixTemplate(sec.implicit ? '_all' : sec.typeNorm, S.proj)[layer];
  });
};

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
    const sources = s.implicit ? [] : secs.filter((other) => !other.implicit && C.validateLink(S.proj, S.d, s.id, other.id).ok);
    const linkRow = s.implicit ? '' : `<div class="section-link"><label>Bağla: <select data-act="secLink" data-id="${esc(s.id)}" aria-label="${esc(s.name)}: Bağla"${sources.length ? '' : ' disabled'}><option value="">— bağsız —</option>${sources.map((other) => `<option value="${esc(other.id)}"${src.link?.sourceId === other.id ? ' selected' : ''}>${esc(other.name)} (${other.startBar}–${other.endBar})</option>`).join('')}</select></label>${sources.length ? '' : '<span class="hint">Aynı uzunlukta başka bölüm yok</span>'}${linkActions(s.id)}</div>`;
    const keyRow = s.implicit ? '' : `<div class="keyrow">
          <select data-act="secTonic" data-id="${s.id}" aria-label="merkez nota">${tonicOpts(src.tonic)}</select>
          <select data-act="secMode" data-id="${s.id}" aria-label="mod">${modeOpts(src.mode || s.mode || 'major')}</select>
          ${status}</div>`;
    return `<div class="sec-card${sel ? ' sel' : ''}" data-sec="${s.id}">${head}${linkRow}${keyRow}
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
      S.proj.sections.push({ id: uid(), link: null, name: 'Şarkı', startBar: 1, endBar: S.d.bars, tonic: +b.dataset.t, mode: b.dataset.m });
    } else { s.tonic = +b.dataset.t; s.mode = b.dataset.m; }
    refresh();
    status(`Ton seçildi: ${C.keyName(+b.dataset.t, b.dataset.m)}`);
  } else if (b.dataset.act === 'secDel' && s) deleteSection(s.id);
});
$('#sectionList').addEventListener('change', (e) => {
  const t = e.target, s = S.proj.sections.find((x) => x.id === t.dataset.id);
  if (!s) return;
  if (t.dataset.act === 'secLink') { changeSectionLink(s.id, t.value || null); return; }
  if (t.dataset.act === 'secName') s.name = t.value.trim() || s.name;
  if (t.dataset.act === 'secStart' || t.dataset.act === 'secEnd') {
    const a = t.dataset.act === 'secStart' ? +t.value : s.startBar, b = t.dataset.act === 'secEnd' ? +t.value : s.endBar;
    const ov = S.proj.sections.find((x) => x !== s && !(Math.max(a, b) < x.startBar || Math.min(a, b) > x.endBar));
    if (ov || a < 1 || b < 1) status('Geçersiz/çakışan ölçü aralığı.', 'err');
    else { structuralEdit([s.id], () => { const sec = S.proj.sections.find((x) => x.id === s.id); sec.startBar = Math.min(a, b); sec.endBar = Math.max(a, b); S.proj.sections.sort((p, q) => p.startBar - q.startBar); }, 'Bölüm aralığı değişti.'); return; }
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
  if (S.sel.type === 'chord') {
    const slot = d.chords.find((s) => S.sel.q >= s.q0 && S.sel.q < s.q1);
    renderChordInspector(box, slot);
    if (slot && linkSource(slot.section)) {
      box.querySelectorAll('input,select,button:not([data-act=hearChord]):not([data-act=fbChord])').forEach((el) => { el.disabled = true; });
      box.insertAdjacentHTML('afterbegin', linkActions(slot.section));
    }
    return;
  }
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
        !linkSource(s.id) && nLocks && { text: `Bu bölümde ${nLocks} kilitli akor`, act: 'secUnlockAll', btn: 'Bölümdeki kilitleri kaldır' },
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
// bölüm düzenlemesi: bu bölümde davul / akor sesi genel ayardan farklı olabilir; ⟳ ile sıradakini hemen dinle
function arrBlock(s) {
  const linked = !!linkSource(s.id);
  const a = (S.proj.sections.find((x) => x.id === C.linkedRoot(S.proj, S.d, s.id)) || {}).arr || {};
  const row = (kind, label) => `<div class="row"><label class="grow">${label}<select${linked ? ' disabled' : ''} data-act="arr" data-kind="${kind}" data-id="${s.id}"><option value="">Genel ayar</option>${kind === 'piano' ? '' : `<option value="off"${a[kind] === 'off' ? ' selected' : ''}>Yok (bu bölümde çalma)</option>`}${arrOptions(kind).map((o) => `<option value="${o.id}"${a[kind] === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label><button${linked ? ' disabled' : ''} data-act="arrNext" data-kind="${kind}" data-id="${s.id}" title="Sıradaki seçeneği dene ve hemen dinle">⟳ Başka dene</button></div>`;
  return `${linkActions(s.id)}<fieldset class="arr"><legend>Bu bölümün düzenlemesi <span class="hint">(genel ayarın üstüne yazar)</span></legend>${row('drums', 'Davul')}${row('piano', 'Akor sesi')}
    <p class="hint">Ör. verse'te sade davul, nakaratta genel ayar. Bölüm basının ayarı 8d'de; geçişlerde davul fill'i 8b'den açılır.</p></fieldset>`;
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
  else if (corr.source === 'auto') soundDesc = `Autotune → ${nn(corr.target)} (kaydırma ${Math.round(corr.applied)} cent)${corr.identityChange ? ` — UYARI: ${S.proj.autotune.target === 'custom' ? 'kendi kümene' : "scale'e"} çekme notayı başka yarım sese taşıdı` : ''}`;
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
    : corr.source === 'auto' ? `Autotune bu notayı ${Math.round(corr.applied) >= 0 ? '+' : ''}${Math.round(corr.applied)} cent kaydırıyor → ${esc(nn(corr.target))}.${n.autoMoved ? ` ⚠ ${S.proj.autotune.target === 'custom' ? 'Kendi kümene' : "Scale'e"} çekme notayı ${esc(nn(n.sungMidi))}'den ${esc(nn(n.effMidi))}'ye taşıdı: akorlar duyduğun ${esc(nn(n.effMidi))}'ye göre bulunuyor (ton önerisi söylediğin ${esc(nn(n.sungMidi))}'yi kullanır).` : ''}`
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
    if (guardFrozenChords()) return;
    const s = S.proj.sections.find((x) => x.id === S.sel.id);
    if (s && !guardLinked(s.id)) { S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== s.id); S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar < s.startBar || l.bar > s.endBar); refresh(); status(`“${s.name}” bölümündeki akor kilitleri kaldırıldı.`); }
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
    if (!['hearChord', 'fbChord'].includes(act) && guardLinked(slot.section)) return;
    const scope = ($('#chScope') && $('#chScope').value) || 'slot';
    const half = scope === 'slot' ? slot.half : scope === 'bar' ? null : +scope;
    const bOf = () => (b.dataset.b != null && b.dataset.b !== '' ? +b.dataset.b : null);
    if (act === 'pickChord') { setLock(slot.bar, half, { root: +b.dataset.r, q: b.dataset.q, bass: bOf() }); }
    if (act === 'applyPinSug' && slot.pinSuggest) {
      const ps = slot.pinSuggest.chord;
      if (!C.chordsAreFrozen(S.proj)) S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== slot.section);
      editFrozenChoice(slot.bar, slot.half, ps, 'pin');
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
      // komşu FARKLI akorlar (aynı bölümde): öncesinin öncesi, sonrası, sonrasının sonrası → önce + sonra ve üçlü bağlam
      const seq = []; for (const x of S.d.chords) if (x.section === slot.section && (!seq.length || !C.sameChord(seq[seq.length - 1].chord, x.chord))) seq.push(x);
      const at = seq.findIndex((x) => x.q0 <= slot.q0 && x.q1 > slot.q0);
      const ch = (j) => (at >= 0 && seq[j] ? seq[j].chord : null);
      window.StyleUI.feedbackChord(prev, slot.chord, sec, +b.dataset.v, { prev2: ch(at - 2), next: ch(at + 1), next2: ch(at + 2) });
    }
  }
});
$('#inspector').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'arr') {
    const sec = S.proj.sections.find((x) => x.id === t.dataset.id);
    if (!sec || guardLinked(sec.id)) return;
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
  if (guardLinked(slot.section)) return;
  if (!C.chordsAreFrozen(S.proj) && S.proj.chordChoices.some((c) => c.sectionId === slot.section)) {
    pinOthers((bar, half) => bar === slot.bar && (slot.half == null || half == null || half === slot.half));
    S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== slot.section);
  }
  editFrozenChoice(slot.bar, slot.half, slot.chord, 'auto');
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === slot.bar && (slot.half == null || l.half == null || l.half === slot.half)));
  refresh();
  status(`Ölçü ${slot.bar}${slot.half != null ? ` (${slot.half + 1}. yarı)` : ''}: kilit kaldırıldı, akor otomatiğe döndü.`);
}
// ---- kilit sonrası sabitleme: bir akor kilitlenince diğer akorlar (çevrimleri dahil) olduğu gibi kalır.
// Sabitler, akorları etkileyen başka bir şey değişince (bölüm/ton, etiket, ayar, stil verisi…) kendiliğinden bırakılır.
function pinSig() {
  const p = S.proj, SU = window.StyleUI && window.StyleUI.state;
  return JSON.stringify({
    ...(p.autotune.target === 'custom' ? { custom: customRenderSig() } : {}),
    set: [p.settings.bpm, p.settings.meter], at: [p.autotune.enabled, p.autotune.target, p.autotune.amount >= 50], sec: p.sections.map((x) => [x.id, x.startBar, x.endBar, x.tonic, x.mode]),
    lab: p.noteEdits.filter((e) => e.label != null).map((e) => [e.t0, e.t1, e.label]),
    co: p.chordOpts, pi: p.pitch, off: p.audio.offsetSec, ped: p.mixer.pedal, rn: S.rawNotes ? S.rawNotes.length : 0,
    st: SU ? [SU.settings, SU.dataset.songs.length, SU.feedback.events.length, SU.feedback.on] : null,
  });
}
// ---- akor değişim işaretleri: ölçü başı ya da ölçü ortası (yarım ölçü) noktasında "değiş" (✂) / "değişme" (=)
function effectiveMarks() {
  const marks = S.proj.changeMarks || [], links = S.d ? C.resolveLinks(S.proj, S.d) : {};
  if (!Object.keys(links).length) return marks;
  return marks.filter((m) => !linkedAtBar(m.bar)).concat(Object.entries(links).flatMap(([id, link]) => {
    const source = S.d.sections.find((s) => s.id === link.rootId);
    return marks.filter((m) => m.bar >= source.startBar && m.bar <= source.endBar).map((m) => ({ ...m, bar: m.bar + link.offsetBars }));
  }));
}
const markAt = (bar, half) => effectiveMarks().find((m) => m.bar === bar && (m.half || 0) === (half || 0));
// sıradaki durum: yok → değiş → değişme → yok
function cycleMark(bar, half) { const m = markAt(bar, half); setMark(bar, half, !m ? 'change' : m.kind === 'change' ? 'hold' : null); }
function setMark(bar, half, kind) {
  if (!S.d) return;
  if (linkedAtBar(bar)) { guardLinked(linkedAtBar(bar).id); return; }
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
  const sec = sectionAtBar(bar);
  if (!C.chordsAreFrozen(S.proj)) S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== sec?.id);
  S.proj.changeMarks = (S.proj.changeMarks || []).filter((m) => !(m.bar === bar && (m.half || 0) === half));
  if (kind) S.proj.changeMarks.push({ bar, half, kind });
  refresh();
  const where = `ölçü ${bar}${half ? ' ortası' : ' başı'}`;
  status(kind === 'change' ? `✂ ${where}: akor burada değişecek (diğer akorlar aynı).` : kind === 'hold' ? `= ${where}: akor burada değişmeyecek.` : `${where}: işaret kaldırıldı.`);
}
// covers(bar, half): yeni kilitlerin (bar, yarım) konumunu kapsayıp kapsamadığı; half null = tüm ölçü
function pinOthers(covers) {
  if (!S.d || C.chordsAreFrozen(S.proj)) return;
  if (S.proj.chordPinsSig !== pinSig()) S.proj.chordPins = (S.proj.chordPins || []).filter((p) => linkedAtBar(p.bar));
  const pins = S.proj.chordPins || (S.proj.chordPins = []);
  const split = !!S.d.g.split;
  const has = (bar, half) => pins.some((p) => p.bar === bar && (p.half == null || half == null || p.half === half));
  for (const sl of S.d.chords) {
    if (sl.locked || linkedAtBar(sl.bar)) continue;
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
// Dondurulmuş aralıkta yalnızca elle düzenlenen hücre kaynağını bırakır.
function editFrozenChoice(bar, half, chord, state = 'lock') {
  if (!C.chordsAreFrozen(S.proj)) return;
  const sec = S.d.sections.find((s) => bar >= s.startBar && bar <= s.endBar);
  if (!sec || !S.proj.chordChoices.some((c) => c.sectionId === sec.id)) return;
  const start = bar - sec.startBar + (half || 0) / 2, end = start + (half == null ? 1 : .5);
  const pos = (c) => c.relBar + c.half / 2;
  const choices = S.proj.chordChoices.filter((c) => c.sectionId === sec.id).sort((a, b) => pos(a) - pos(b));
  const prior = choices.filter((c) => pos(c) <= end).at(-1);
  const keep = choices.filter((c) => pos(c) < start || pos(c) >= end);
  if (prior && end < sec.endBar - sec.startBar + 1 && !keep.some((c) => pos(c) === end)) keep.push({ ...jclone(prior), relBar: Math.floor(end), half: end % 1 ? 1 : 0 });
  keep.push({ sectionId: sec.id, relBar: Math.floor(start), half: start % 1 ? 1 : 0, chord: jclone(chord), state });
  S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== sec.id).concat(keep);
}
function setLock(bar, half, chord) {
  if (linkedAtBar(bar)) { guardLinked(linkedAtBar(bar).id); return; }
  pinOthers((b, h) => b === bar && (half == null || h == null || h === half));
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => !(p.bar === bar && (half == null || p.half == null || p.half === half)));
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === bar && (half == null || l.half == null || l.half === half)));
  const section = sectionAtBar(bar);
  if (!C.chordsAreFrozen(S.proj)) S.proj.chordChoices = S.proj.chordChoices.filter((c) => c.sectionId !== section?.id);
  editFrozenChoice(bar, half, { root: chord.root, q: chord.q, bass: chord.bass ?? null });
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
      <button data-act="manualChord" class="accent" title="Yazdığın akor senindir: motor ve puanlar onu değiştirmez; diğer akorlar da aynı kalır">Uygula</button></div>
    <p class="hint">Elle yazdığın akor önceliklidir (🔒): motor değiştirmez, diğer akorlar da yerinde kalır. Sonrasını tamamlamak için 6–7. adımdaki <b>"Son elle yaptığımdan sonrasını otomatik uygula"</b>.</p>`;
}

// ---------------------------------------------------------------- bilgi satırları
function renderInfo() {
  const a = S.audio;
  $('#audioInfo').textContent = S.midi ? `MIDI: ${S.midi.name} · ${S.midi.notes.length} nota · ses kaydı yok` : a ? `${a.name} · ${(a.data.length / a.sr).toFixed(1)} s · ${a.sr} Hz${S.proj.audio.source === 'record' ? ` · gecikme telafisi ${S.proj.settings.latencyMs} ms` : ''}` : 'Ses yok';
  { // MIDI melodi izi seçimi (birden çok aday iz varsa) + uyarılar
    const row = $('#midiTrackRow'), sel = $('#inMidiTrack'), m = S.midi;
    const show = !!m && m.bytes && m.tracks.length > 1;
    row.hidden = !show;
    if (show) { const o = m.tracks.map((t) => `<option value="${t.index}">${esc(t.name)} (${t.count} nota)</option>`).join(''); if (sel.innerHTML !== o) sel.innerHTML = o; sel.value = String(m.trackIndex); }
    $('#midiInfo').textContent = m ? `Melodi, MIDI notalarından; ses yok (vokal yerine synth çalar). Sesli düzeltmeler (autotune, WSOLA) MIDI'de yoktur.${m.warnings.length ? ' ⚠ ' + m.warnings.join(' ') : ''}` : '';
  }
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
  if (!t.dataset.sec || guardFrozenChords()) return;
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
  renderCustomPicker();
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
  p.mixer.guitar = p.mixer.guitar || { vol: -4, mute: false, solo: false };
  p.mixer.bass = p.mixer.bass || { vol: -4, mute: false, solo: false };
  $('#inDrumFills').checked = p.drums.fills !== false;
  { const f = p.vocalFx || C.VFX_DEFAULTS;
    $('#inVfxOn').checked = !!f.on; $('#inVfxNorm').checked = f.normalize !== false;
    for (const [id, k] of [['Denoise', 'denoise'], ['Comp', 'comp'], ['Reverb', 'reverb']]) { $('#inVfx' + id).value = f[k]; $('#outVfx' + id).textContent = '%' + f[k]; } }
  for (const tr of ['vocal', 'piano', 'drums', 'guitar', 'bass']) {
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
$('#inDrumFills').addEventListener('change', (e) => { S.proj.drums.fills = e.target.checked; refresh(); if (Player.playing) Player.play(); });
$('#btnDrumNext').onclick = () => arrNext('drums', null);
$('#btnStyleNext').onclick = () => arrNext('piano', null);
$('#btnDrumLike').onclick = () => voteOption('drums', 1); $('#btnDrumDislike').onclick = () => voteOption('drums', -1);
$('#btnStyleLike').onclick = () => voteOption('piano', 1); $('#btnStyleDislike').onclick = () => voteOption('piano', -1);
$('#btnPrefReset').onclick = () => prefReset();
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
const CUSTOM_NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
function renderCustomPicker() {
  const at = S.proj.autotune, custom = at.target === 'custom';
  $('#customPanel').hidden = !custom; $('#customWarn').hidden = !custom;
  $('#customChromHint').hidden = !custom;
  $('#scaleWarn').hidden = at.target !== 'scale'; $('#inSkipChrom').disabled = at.target !== 'scale';
  const sections = S.proj.sections.length ? S.proj.sections : [{ id: '_all', name: 'Tümü' }];
  if (!sections.some((s) => s.id === S.customSection)) S.customSection = sections[0].id;
  const select = $('#inCustomSection');
  const options = sections.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = S.customSection;
  const pcs = at.customSets && at.customSets[S.customSection] || [];
  $$('#customNotes input').forEach((input) => { input.checked = pcs.includes(+input.dataset.customPc); });
  $('#customSetHint').textContent = pcs.length ? pcs.map((pc) => CUSTOM_NAMES[pc]).join(', ') : 'Bu bölümün kümesi boş: autotune bu bölümde çalışmaz';
}
// Küme eylemleri tek başına geri alınır; bağlı bölümün vokali kendi kümesini kullanır.
function customEdit(fn) {
  histCommit(); HIST.t = -Infinity;
  fn(); refresh(); HIST.t = -Infinity;
  if (Player.playing) Player.play();
}
$('#inCustomSection').onchange = (e) => { S.customSection = e.target.value; renderCustomPicker(); };
$('#customNotes').onchange = (e) => {
  const input = e.target.closest('input[data-custom-pc]'); if (!input) return;
  customEdit(() => {
    const pcs = new Set(S.proj.autotune.customSets[S.customSection] || []), pc = +input.dataset.customPc;
    if (input.checked) pcs.add(pc); else pcs.delete(pc);
    S.proj.autotune.customSets[S.customSection] = [...pcs].sort((a, b) => a - b);
  });
};
$('#btnCustomFill').onclick = () => customEdit(() => { S.proj.autotune.customSets[S.customSection] = C.customFillSet(S.d ? S.d.notes : [], S.customSection); });
$('#btnCustomCopy').onclick = () => customEdit(() => {
  const pcs = S.proj.autotune.customSets[S.customSection] || [];
  for (const s of S.d.sections) S.proj.autotune.customSets[s.id] = pcs.slice();
});
$('#customPanel').addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.closest('button')) { e.stopPropagation(); return; }
  if ((e.ctrlKey || e.metaKey) && 'zZyY'.includes(e.key)) {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey || 'yY'.includes(e.key)) histRedo(); else histUndo();
  }
});
$('#inSkipChrom').addEventListener('change', (e) => { S.proj.autotune.skipChromatic = e.target.checked; if (S.proj.autotune.enabled) refresh(); });
document.querySelectorAll('input[name=atTarget]').forEach((r) => r.addEventListener('change', (e) => {
  S.proj.autotune.target = e.target.value;
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
    if (!ov.length) { S.proj.sections.push({ id: uid(), link: null, name: ps.name, startBar: ps.startBar, endBar: end, tonic: ps.tonic, mode: ps.mode }); created++; continue; }
    const ex = ov.find((x) => x.startBar === ps.startBar && x.endBar === end);
    if (ex && linkSource(ex.id)) continue;
    if (ex && ps.tonic != null && ex.tonic == null) { ex.tonic = ps.tonic; ex.mode = ps.mode; }
    else if (ex && ps.tonic != null && (ex.tonic !== ps.tonic || ex.mode !== ps.mode)) notes.push(`"${ex.name}" bölümünün tonu ${C.keyName(ex.tonic, ex.mode)}; şablondaki ${C.keyName(ps.tonic, ps.mode)} uygulanmadı (4. adımdan değiştirebilirsin).`);
  }
  if (created) { S.proj.sections.sort((a, b) => a.startBar - b.startBar); refresh(); }
  const cells = r.cells.filter((c) => c.chord && c.bar >= 1 && c.bar <= S.d.bars && !linkedAtBar(c.bar));
  if (linkedSkipNote()) notes.push(linkedSkipNote().trim());
  const over = r.cells.filter((c) => c.chord && c.bar > S.d.bars).length;
  if (over) notes.push(`Şablon ${r.bars} ölçü, kayıt ${S.d.bars} ölçü: fazladan ${over} akor yok sayıldı.`);
  if (!cells.length) { msg.innerHTML = `<div class="st-warn">⚠ Yerleştirilecek akor bulunamadı.${esc(linkedSkipNote())}</div>`; status('Yerleştirilecek akor bulunamadı.' + linkedSkipNote()); return false; }
  const cov = (b, h) => cells.some((c) => c.bar === b && (c.half == null || h == null || c.half === h));
  pinOthers(cov);
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => !cov(p.bar, p.half));
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !cov(l.bar, l.half));
  const edited = new Set(cells.map((c) => sectionAtBar(c.bar)?.id));
  if (!C.chordsAreFrozen(S.proj)) S.proj.chordChoices = S.proj.chordChoices.filter((c) => !edited.has(c.sectionId));
  for (const c of cells) editFrozenChoice(c.bar, c.half, { root: c.chord.root, q: c.chord.q, bass: c.chord.bass ?? null });
  for (const c of cells) S.proj.chordLocks.push({ bar: c.bar, half: c.half, chord: { root: c.chord.root, q: c.chord.q, bass: c.chord.bass ?? null }, src: 'chart' });
  refresh();
  const bars = new Set(cells.map((c) => c.bar)).size;
  msg.innerHTML = `<div class="adv-opt">✓ ${cells.length} akor ${bars} ölçüye kilitli olarak yerleşti${created ? `, ${created} bölüm oluşturuldu` : ''}. ▶ Oynat ile melodinin üzerinde dinle. Boş bıraktığın ölçüler otomatik.</div>${notes.length ? `<div class="st-warn">⚠ Notlar:<ul>${notes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
  status(`Şablon uygulandı: ${cells.length} akor, ${bars} ölçü.${linkedSkipNote()}`);
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
  if (guardFrozenChords()) return;
  const n = S.proj.chordLocks.filter((l) => l.src === 'chart').length;
  if (!n) return;
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.src !== 'chart' || linkedAtBar(l.bar)); refresh(); status('Şablon kilitleri kaldırıldı.' + linkedSkipNote());
  $('#chartMsg').innerHTML = `<div class="adv-opt">Şablondan gelen ${n} akor kaldırıldı; o ölçüler otomatiğe döndü.</div>`;
};
$('#inOnlyMarked').addEventListener('change', (e) => { S.proj.chordOpts.onlyMarked = e.target.checked; refresh(); });
$('#inDownbeatOnly').addEventListener('change', (e) => { S.proj.chordOpts.downbeatOnly = e.target.checked; refresh(); });
$('#btnClearMarks').onclick = () => { const n = (S.proj.changeMarks || []).length; S.proj.changeMarks = (S.proj.changeMarks || []).filter((m) => linkedAtBar(m.bar)); refresh(); status(`${n} değişim işareti kaldırıldı (akorlar yerinde kaldı).${linkedSkipNote()}`); };
// senin kararların: ✂ değişim noktaları ve elle yazılan / kilitlenen akorlar (öncelik: 1) ✂ noktaları 2) elle yazdığın akorlar 3) motor)
function lastManualBar() {
  const bars = [...S.proj.chordLocks.filter((l) => !linkedAtBar(l.bar)).map((l) => l.bar), ...(S.proj.changeMarks || []).filter((m) => !linkedAtBar(m.bar)).map((m) => m.bar)];
  return bars.length ? Math.max(...bars) : 0;
}
function applyAfterLast() {
  if (guardFrozenChords()) return;
  const last = lastManualBar();
  if (!last) { status('Önce bir ✂ değişim noktası işaretle ya da bir akoru elle yaz / kilitle.', 'err'); return; }
  if (S.proj.chordChoices.some((c) => !linkSource(c.sectionId))) {
    pinOthers((bar) => bar > last && !linkedAtBar(bar));
    S.proj.chordChoices = S.proj.chordChoices.filter((c) => linkSource(c.sectionId));
  }
  const had = (S.proj.chordPins || []).filter((p) => p.bar > last).length;
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => p.bar <= last || linkedAtBar(p.bar)); // son yaptığın ölçüye kadar her şey aynen kalır; sonrası serbest
  refresh();
  const n = S.d.chords.filter((c) => c.bar > last).length;
  status(`Ölçü ${last}'ye kadar (✂ noktaların, elle yazdığın akorlar ve aradaki akorlar) aynen kaldı; ölçü ${last + 1}'den sonrası (${n} akor) motorca bütün olarak, işaretlerine ve kilitlerine uyarak yeniden belirlendi${had ? '' : ' (zaten serbestti)'}.${linkedSkipNote()}`);
}
$('#btnApplyAfter').onclick = () => applyAfterLast();
// ---------------------------------------------------------------- "PROGRESYONU BİTİRDİM": bitirilen progresyondan öğren
// Bütün progresyon (ton onaylı bölümler) ağırlıklı bir şarkı olarak, seçtiğin (kilitlediğin / elle yazdığın) akorlar ise öncesi ve sonrasıyla
// birlikte (ikili geçiş + üçlü bağlam) beğeni olarak stil modeline işlenir. Motorun bulduğu akorlar bu işlemle değişmez (📌 sabitlenir).
function progressionSpec() {
  const d = S.d, g = d.g;
  return {
    id: S.proj.learnId, title: 'Progresyonum' + (S.audio && S.audio.name ? ' — ' + S.audio.name : S.midi && S.midi.name ? ' — ' + S.midi.name : ''),
    sections: d.sections.filter((x) => x.tonic != null).map((sec) => ({
      name: sec.name, type: sec.type || null, tonic: sec.tonic, mode: sec.mode,
      chords: d.chords.filter((c) => c.section === sec.id).map((c) => ({ chord: { root: c.chord.root, q: c.chord.q, bass: c.chord.bass ?? null }, bars: (c.q1 - c.q0) / g.barQ, chosen: !!c.locked })),
    })),
  };
}
function finishProgression() {
  if (!window.StyleUI) { status('Stil modülü yüklenmedi.', 'err'); return; }
  if (!S.d || !S.d.chords.length) { status('Önce bir progresyon gerekli (akorlar).', 'err'); return; }
  if (!S.proj.learnId) S.proj.learnId = 'learn-' + uid() + Date.now().toString(36);
  const spec = progressionSpec();
  if (!spec.sections.some((x) => x.chords.length)) { status('Ton onaylı akorlu bölüm yok: önce 4. adımda bölüm ve ton seç (ya da ✨ Demo).', 'err'); return; }
  const was = StyleUI.progressionInfo(S.proj.learnId).song;
  pinOthers(() => false); // motorun akorları olduğu gibi kalsın
  const r = StyleUI.learnProgression(spec, { refresh: false });
  if (!r.ok) { status('Öğrenilemedi: ' + r.why, 'err'); return; }
  S.proj.chordPinsSig = pinSig();
  refresh();
  const m = r.summary;
  status(`✅ ${was ? 'Güncellendi' : 'Öğrenildi'}: ${m.sections} bölüm, ${m.chords} akor${m.chosen ? `, bunlardan ${m.chosen}'i senin seçtiğin → ${m.pairs} geçiş ve ${m.triples} üçlü bağlam (öncesi + sonrası) beğeni olarak işlendi` : ' (kilitli akor yok: yalnızca bütün progresyon öğrenildi)'}. Progresyon ${r.weight}× ağırlıklı şarkı sayılır; sonraki akor önerileri bunu kullanır.`);
}
function forgetProgression() {
  if (!window.StyleUI || !S.proj.learnId) return;
  const r = StyleUI.forgetProgression(S.proj.learnId);
  refresh();
  status(`Bu projeden öğrenilenler silindi (${r.songs} şarkı, ${r.events} beğeni).`);
}
function renderFinishInfo() {
  const el = $('#finishInfo');
  if (!el) return;
  const info = window.StyleUI && S.proj.learnId ? StyleUI.progressionInfo(S.proj.learnId) : { song: null, events: 0 };
  $('#btnFinishProg').textContent = info.song ? '✅ Progresyonu güncelle — bundan yeniden öğren' : '✅ Progresyonu bitirdim — bundan öğren';
  $('#btnForgetProg').hidden = !info.song;
  const txt = info.song ? `Öğrenildi: ${info.song.sections.reduce((a, x) => a + x.chords.length, 0)} akor (${info.song.weight}× ağırlık) · ${info.events} bölümde seçtiğin akorların komşu ilişkileri.` : '';
  if (el.textContent !== txt) el.textContent = txt;
}
$('#btnFinishProg').onclick = () => finishProgression();
$('#btnForgetProg').onclick = () => forgetProgression();
// vokal temizliği + otomatik miks
$('#inVfxOn').addEventListener('change', (e) => { S.proj.vocalFx.on = e.target.checked; vfxChanged(); });
$('#inVfxNorm').addEventListener('change', (e) => { S.proj.vocalFx.normalize = e.target.checked; vfxChanged(); });
for (const [id, k] of [['Denoise', 'denoise'], ['Comp', 'comp'], ['Reverb', 'reverb']]) {
  $('#inVfx' + id).addEventListener('input', (e) => { S.proj.vocalFx[k] = +e.target.value; $('#outVfx' + id).textContent = '%' + e.target.value; vfxChanged(); });
}
$('#btnAutoMix').onclick = () => autoMix(false);

$('#btnApplySug').onclick = () => {
  if (guardFrozenChords()) return;
  const n = S.d.chords.filter((c) => c.pinSuggest).length;
  S.proj.chordPins = (S.proj.chordPins || []).filter((p) => linkedAtBar(p.bar));
  S.proj.chordChoices = S.proj.chordChoices.filter((c) => linkSource(c.sectionId)); refresh();
  status(`Motorun ${n} önerisi uygulandı: kilitlerin dışındaki akorlar yeniden hesaplandı.${linkedSkipNote()}`);
};
$('#btnUnlockAll').onclick = () => {
  if (guardFrozenChords()) return;
  const n = S.proj.chordLocks.filter((l) => !linkedAtBar(l.bar)).length;
  if (!n) { if (linkedSkipNote()) status('Kaldırılacak bağımsız akor kilidi yok.' + linkedSkipNote()); return; }
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => linkedAtBar(l.bar)); S.proj.chordPins = (S.proj.chordPins || []).filter((p) => linkedAtBar(p.bar));
  S.proj.chordChoices = S.proj.chordChoices.filter((c) => linkSource(c.sectionId)); refresh();
  status(`${n} akor kilidi kaldırıldı; ${linkedSkipNote() ? 'bağımsız' : 'bütün'} akorlar otomatiğe döndü.${linkedSkipNote()}`);
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
$('#btnUnlockChords').onclick = () => { if (guardFrozenChords()) return; S.proj.chordLocks = S.proj.chordLocks.filter((l) => linkedAtBar(l.bar)); refresh(); status('Akor kilitleri kaldırıldı.' + linkedSkipNote()); };
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
  strip.querySelector('.vol').addEventListener('input', (e) => { m().vol = +e.target.value; S.proj.mixer.touched = true; strip.querySelector('output').textContent = e.target.value + ' dB'; Player.applyMixer(); queueVersions(); });
  strip.querySelector('.mute').onclick = (e) => { m().mute = !m().mute; e.target.classList.toggle('on', m().mute); Player.applyMixer(); queueVersions(); };
  strip.querySelector('.solo').onclick = (e) => { m().solo = !m().solo; e.target.classList.toggle('on', m().solo); Player.applyMixer(); queueVersions(); };
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
  if ((S.audio || S.midi) && !confirm('Yeni proje? Kaydedilmemiş değişiklikler kaybolur.')) return;
  Player.stop(true); HIST.reset = true; S.loop.on = false; $('#btnLoop').classList.remove('on');
  invalidateSoundSelection();
  S.proj = C.newProject(); S.customSection = null; S.audio = null; S.comps = []; S.midi = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0;
  BS.hist = Bs.newHistory(); BS.sel = null; BS.note = null; BS.lsMerged = false;
  syncInputs(); refresh(); status('Yeni proje.');
};
$('#btnSave').onclick = () => saveProject();
$('#btnOpenMidi').onclick = () => $('#fileMidi').click();
$('#btnMidiLoad').onclick = () => $('#fileMidi').click();
$('#fileMidi').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await loadMidiFile(f); });
$('#inMidiTrack').addEventListener('change', (e) => { if (S.midi && S.midi.bytes) importMidiBytes(S.midi.bytes, S.midi.name, +e.target.value, true); });
$('#btnOpen').onclick = () => $('#fileProject').click();
$('#fileProject').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openProject(f); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  const undoKey = (e.ctrlKey || e.metaKey) && 'zZyY'.includes(e.key);
  if (undoKey && bassUndoFirst()) return; // bas şeridinin geri alması (bassui.js) işler
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
  invalidateSoundSelection();
  S.proj = C.newProject();
  S.proj.settings.bpm = t.bpm; S.proj.settings.meter = t.meter;
  S.proj.sections = t.sections.map((s) => ({ id: uid(), link: null, name: s.name, startBar: s.startBar, endBar: s.endBar, tonic: null, mode: null }));
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
  if (S.midi) p.midiData = { name: S.midi.name, endQ: S.midi.endQ, notes: S.midi.notes }; // MIDI projesi: melodi notaları (ses yok)
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
  invalidateSoundSelection();
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { status('Proje dosyası okunamadı: ' + e.message, 'err'); return; }
  Player.stop(true); HIST.reset = true;
  const audioData = p.audioData, midiData = p.midiData;
  delete p.audioData; delete p.midiData; delete p.savedAt;
  S.proj = mergeDefaults(C.newProject(), C.migrateMatrix(p));
  S.proj.autotune = C.normalizeCustomSets(S.proj.autotune, S.proj.sections.map((s) => s.id));
  S.customSection = null;
  S.versionPinsOnLoad = !!(S.proj.versions.activeId && S.proj.chordChoices.length);
  BS.hist = Bs.newHistory(); BS.sel = null; BS.note = null; BS.lsMerged = false;
  S.audio = null; S.comps = []; S.midi = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0;
  if (midiData) S.midi = { name: midiData.name, bytes: null, notes: midiData.notes, endQ: midiData.endQ, tracks: [], trackIndex: null, warnings: [] };
  if (audioData) {
    const w = C.decodeWav(C.base64ToBytes(audioData.wavBase64).buffer);
    S.audio = { data: w.data, sr: w.sr, name: audioData.name };
    Player.buffersDirty = true;
  }
  syncInputs();
  await analyze();
  const loadedSounds = await prepareCurrentRealSounds(); loadedSounds.release();
  status(`Proje açıldı${audioData || midiData ? '' : ' (ses gömülü değildi — kaydı yeniden yükleyin)'}.`);
}

// ---------------------------------------------------------------- dışa aktarım
// noAudio: akor izi yeterli (demo şarkı, MIDI, şema, mix); vokal WAV ses ister
function needData(noAudio) { if (!S.d || (!noAudio && !S.audio && !S.midi)) { status(noAudio ? 'Önce bir akor izi gerekli (analiz ya da demo şarkı).' : 'Önce ses kaydı/yükleme ve analiz gerekli.', 'err'); return false; } return true; }
function alignedVocal(src, sr, lenSec) {
  const n = Math.round(lenSec * sr), out = new Float32Array(n), o = Math.round(S.d.off * sr);
  for (let i = 0; i < n; i++) { const j = i + o; if (j >= 0 && j < src.length) out[i] = src[j]; }
  return out;
}
const exportLenSec = () => (S.audio ? Math.max(S.d.bars * S.d.g.barSec, S.audio.data.length / S.audio.sr - S.d.off) + 1.5 : S.d.bars * S.d.g.barSec + 1.5);
async function ensureRendered() {
  while (S.audio && S.d && S.d.correction && !renderReady()) { clearTimeout(renderTimer); await doRender(); }
}
$('#btnExpMidi').onclick = () => { if (!needData(true)) return; { const dev = drumEventsAll(), L = currentLoop();
  download(C.exportMidi(S.proj, S.d, dev.length ? { name: L ? L.name : 'loop', events: dev } : null), 'akorlar-ve-melodi.mid', 'audio/midi');
  status(`MIDI dışa aktarıldı (tempo, ölçü, bölüm işaretleri, melodi + akor izi${S.proj.guitar.instrument !== 'piano' ? ' + gitar' : ''}${S.proj.bass.enabled ? ' + bas' : ''}${dev.length ? ' + davul' : ''}).`); } };
$('#btnExpChart').onclick = () => { if (!needData(true)) return; download(C.chordChart(S.proj, S.d), 'akor-semasi.txt', 'text/plain;charset=utf-8'); };
$('#btnExpVocal').onclick = async () => {
  if (!needData()) return;
  if (!S.audio) { status('MIDI projesinde vokal kaydı yok: melodi MIDI çıktısında ve "Vokal + akor mix" WAV\'ında (synth melodi) var.', 'err'); return; }
  await ensureRendered();
  await vfxEnsure();
  const v = alignedVocal(vfxData('B'), S.audio.sr, exportLenSec());
  download(new Blob([C.encodeWav([v], S.audio.sr)], { type: 'audio/wav' }), 'duzeltilmis-vokal.wav');
  status('Düzeltilmiş vokal WAV (1. ölçü başından hizalı) dışa aktarıldı.');
};
$('#btnExpMix').onclick = async () => {
  if (!needData(true)) return;
  if (S.audio) await ensureRendered();
  await busy('Mix render ediliyor…', async () => {
    const sr = 44100, lenSec = exportLenSec(), n = Math.round(lenSec * sr);
    const st = await renderStems(sr, lenSec);
    const m = S.proj.mixer, anySolo = m.vocal.solo || m.piano.solo || m.drums.solo || m.guitar.solo || m.bass.solo;
    const gain = (k) => (m[k].mute || (anySolo && !m[k].solo) ? 0 : dbToGain(m[k].vol));
    const mix = new Float32Array(n);
    for (const k of ['vocal', 'piano', 'guitar', 'bass', 'drums']) {
      const arr = st[k], g = arr ? gain(k) : 0;
      if (!g) continue;
      for (let i = 0, e = Math.min(n, arr.length); i < e; i++) mix[i] += arr[i] * g;
    }
    mix.set(C.vocalLimit(mix, sr, -1)); // ana çıkış sınırlayıcı (−1 dBFS): oynatmadaki Limiter ile aynı hedef
    download(new Blob([C.encodeWav([mix, mix], sr)], { type: 'audio/wav' }), 'vokal-piyano-mix.wav');
  });
  status(`Vokal + ${{ piano: C.pianoOpts(S.proj.piano).inst === 'synth' ? 'synth' : 'piyano', guitar: 'gitar', both: 'piyano + gitar' }[S.proj.guitar.instrument]}${S.proj.bass.enabled ? ' + bas' : ''}${anyDrums() ? ' + davul' : ''} mix WAV dışa aktarıldı.`);
};

/*__GUITARUI__*/
// ---------------------------------------------------------------- başlangıç
setEditMode('sound'); // varsayılan: notayı sürükleyerek taşı
syncInputs();
refresh();
loadPianoSamples(); // hangi piyanonun çalacağı baştan görünsün
status('Hazır. Kayıt yapın, dosya yükleyin ya da test melodisi üretin.');
})();

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
  editMode: 'select',
  view: { pxPerQ: 44 },
  pos: 0,                 // oynatma imleci (zaman çizelgesi saniyesi)
  drag: null,
};
window.__daw = S; // hata ayıklama / testler için
window.__dawCal = () => Cal.last;
// stil modülünün (styleui.js) kullandığı arayüz
window.__dawAPI = {
  S, C, status, esc, getCtx,
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
function toAudioBuffer(data, sr) {
  const b = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(data, 0);
  return b;
}

// ---------------------------------------------------------------- pipeline
function setAudio(data, sr, name, source) {
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
    S.rawNotes = C.segmentNotes(S.track, p);
  });
  S.correctedShift = null;
  refresh();
  status(`Analiz tamam: ${S.rawNotes.length} nota.`);
}
function refresh() {
  // stil modeli (varsa): akor bulucuya λ·log P(geçiş) + renk puanı olarak girer
  const style = window.StyleUI ? window.StyleUI.scorer() : null;
  S.d = C.derive(S.proj, { track: S.track, rawNotes: S.rawNotes, duration: S.audio ? S.audio.data.length / S.audio.sr : 0, style });
  S.d.styleActive = !!style;
  if (S.sel && S.sel.type === 'note' && !S.d.notes.some((n) => n.id === S.sel.id)) S.sel = null;
  renderSections();
  renderInspector();
  renderInfo();
  layoutTimeline();
  draw();
  scheduleRender();
}

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
  if (shiftsEqual(corr.shift, S.correctedShift)) return;
  clearTimeout(renderTimer);
  $('#renderInfo').textContent = 'Düzeltilmiş vokal yeniden render edilecek…';
  renderTimer = setTimeout(doRender, now ? 0 : 350);
}
async function doRender() {
  if (S.drag) { renderTimer = setTimeout(doRender, 150); return; }
  const shift = S.d.correction.shift.slice();
  await busy('Düzeltilmiş vokal render ediliyor (TD-PSOLA, formant korumalı)…', async () => {
    await tick();
    S.corrected = hasShift(shift) ? C.psolaShift(S.audio.data, S.audio.sr, S.track, shift) : S.audio.data;
    S.correctedShift = shift;
  });
  Player.buffersDirty = true;
  renderInfo();
  status('Düzeltilmiş vokal hazır (ayrı iz). A/B ile karşılaştırın.');
}
const renderReady = () => !!S.d && !!S.d.correction && shiftsEqual(S.d.correction.shift, S.correctedShift);

// ---------------------------------------------------------------- piyano örnekleri (Salamander → yedek sentez)
const SAL_BASE = 'https://tonejs.github.io/audio/salamander/';
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
    try {
      const bufs = await Promise.all(SAL_NOTES.map(async (n) => {
        const r = await withTimeout(fetch(SAL_BASE + n.replace('#', 's') + '.mp3'), 10000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ab = await ctx.decodeAudioData(await r.arrayBuffer());
        return { name: n, midi: noteToMidi(n), buffer: ab, data: ab.getChannelData(0), sr: ab.sampleRate };
      }));
      $('#pianoInfo').textContent = 'Piyano: Salamander Grand (gerçek örnekler) yüklendi.';
      setPianoBadge('Piyano: Salamander', 'ok', 'Salamander Grand Piano örnekleri çalıyor');
      return { kind: 'salamander', samples: bufs };
    } catch (e) {
      console.warn('Salamander yüklenemedi, sentetik piyano kullanılıyor:', e);
      const sr = 44100;
      const samples = SAL_NOTES.filter((n) => { const m = noteToMidi(n); return m >= 24 && m <= 96; }).map((n) => {
        const m = noteToMidi(n), data = C.synthPianoSample(m, sr, 2.5);
        return { name: n, midi: m, data, sr, buffer: toAudioBuffer(data, sr) };
      });
      $('#pianoInfo').textContent = 'Salamander örneklerine ulaşılamadı (ağ) — yedek sentetik piyano kullanılıyor.';
      setPianoBadge('Piyano: yedek sentez', 'warn', 'Salamander yüklenemedi (' + e.message + '); sentetik yedek piyano çalıyor');
      return { kind: 'synth', samples };
    }
  })();
  return pianoPromise;
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
    this.gA = new T.Gain(0).connect(this.vocalCh);
    this.gB = new T.Gain(1).connect(this.vocalCh);
    this.pA = new T.Player().connect(this.gA);
    this.pB = new T.Player().connect(this.gB);
    this.click = new T.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }, volume: -16 }).toDestination();
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
    this.pA.buffer = new Tone.ToneAudioBuffer(toAudioBuffer(S.audio.data, S.audio.sr));
    this.pB.buffer = new Tone.ToneAudioBuffer(toAudioBuffer(S.corrected || S.audio.data, S.audio.sr));
    this.buffersDirty = false;
  },
  applyMixer() {
    const m = S.proj.mixer;
    if (!this.ready) return;
    const anySolo = m.vocal.solo || m.piano.solo;
    this.vocalCh.volume.value = m.vocal.vol;
    this.pianoCh.volume.value = m.piano.vol;
    this.vocalCh.mute = m.vocal.mute || (anySolo && !m.vocal.solo);
    this.pianoCh.mute = m.piano.mute || (anySolo && !m.piano.solo);
    const corr = m.ab !== 'original';
    this.gA.gain.value = corr ? 0 : 1;
    this.gB.gain.value = corr ? 1 : 0;
  },
  async play() {
    if (!S.d) return;
    try { await this.ensure(); } catch (e) { status(e.message, 'err'); return; }
    this.stop(true);
    this.updateBuffers();
    this.applyMixer();
    const T = this.transport();
    T.cancel(0);
    const g = S.d.g, off = S.d.off, from = S.pos;
    const now = Tone.now() + 0.12;
    if (S.audio) {
      for (const p of [this.pA, this.pB]) {
        if (!p.loaded) continue;
        const bo = from + off;
        if (bo >= 0) { if (bo < p.buffer.duration) p.start(now, bo); } else p.start(now - bo, 0);
      }
    }
    for (const e of C.pianoEvents(S.d.chords, g)) {
      const end = e.t + e.dur;
      if (end <= from + 0.01) continue;
      const st = Math.max(e.t, from);
      const name = Tone.Frequency(e.midi, 'midi').toNote();
      T.schedule((time) => this.sampler.triggerAttackRelease(name, end - st, time, e.vel / 127), st);
    }
    if (S.proj.mixer.click) {
      const endQ = S.d.bars * g.barQ;
      for (let q = Math.ceil(from / g.spq / g.clickQ - 1e-6) * g.clickQ; q < endQ; q += g.clickQ) {
        const inBar = q % g.barQ, acc = g.accents.some((a) => Math.abs(inBar - a) < 1e-6);
        T.schedule((time) => this.click.triggerAttackRelease(acc ? (inBar < 1e-6 ? 1760 : 1320) : 990, 0.03, time), q * g.spq);
      }
    }
    T.start(now, from);
    this.playing = true; this.t0 = now; this.from = from;
    $('#btnPlay').textContent = '❚❚ Duraklat';
    const loop = () => {
      if (!this.playing) return;
      S.pos = this.from + Math.max(0, Tone.now() - this.t0);
      const endSec = S.d.bars * g.barSec + 1;
      if (S.pos >= endSec) { this.stop(); S.pos = 0; }
      followPlayhead();
      draw(); updateReadout();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  // melodisiz akor önizleme (progresyon önericisi): süreler ölçü cinsinden (yoksa akor başına 1 ölçü), DAW temposunda
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
    for (const e of C.pianoEvents(slots, g)) {
      const name = Tone.Frequency(e.midi, 'midi').toNote();
      T.schedule((time) => this.sampler.triggerAttackRelease(name, e.dur, time, e.vel / 127), e.t);
    }
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
    this.playing = false;
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
        const inBar = q % g.barQ, acc = g.accents.some((a) => Math.abs(inBar - a) < 1e-6);
        clickAt(ctx, t0 + q * g.spq, inBar < 1e-6 ? 1760 : acc ? 1320 : 990, vol * (acc ? 1 : 0.6));
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
  if (!S.audio || S.proj.audio.source !== 'file') return;
  const mode = S.proj.audio.alignMode;
  if (mode === 'none') return;
  if (S.onset == null) S.onset = C.firstOnset(S.audio.data, S.audio.sr);
  const g = C.makeGrid(S.proj.settings);
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
    const x = Math.round(qToX(q)) + 0.5;
    if (x < TL.KW) continue;
    const isBar = Math.abs(q / barQ - Math.round(q / barQ)) < 1e-6;
    const isPulse = Math.abs(q / g.pulseQ - Math.round(q / g.pulseQ)) < 1e-6;
    c.strokeStyle = isBar ? '#3a4152' : isPulse ? '#232834' : '#1a1e27';
    c.beginPath(); c.moveTo(x, isBar ? 0 : TL.RULER); c.lineTo(x, H); c.stroke();
  }
  // cetvel
  c.fillStyle = '#181b22'; c.fillRect(TL.KW, 0, W, TL.RULER);
  c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle';
  for (let b = Math.max(0, Math.floor(q0v / barQ)); b * barQ <= q1v; b++) {
    const x = qToX(b * barQ);
    if (x < TL.KW - 1) continue;
    c.fillStyle = '#9aa2b4'; c.fillText(String(b + 1), x + 4, TL.RULER / 2);
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
      c.fillText((s.locked ? '🔒 ' : '') + C.chordName(disp, s.flats), Math.max(TL.KW, x0) + 7, chY + TL.CHORD / 2);
      if (s.suggest) { c.font = '10px system-ui, sans-serif'; c.fillStyle = '#ffb454'; c.fillText(C.chordName(s.suggest, s.flats) + '?', x1 - 44, chY + TL.CHORD - 9); }
      c.restore();
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
      if (n.nearest !== n.effMidi || n.label != null) {
        c.setLineDash([3, 3]); c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.strokeRect(x0 + 0.5, rg.yOf(n.nearest) - h / 2 + 0.5, x1 - x0 - 1, h - 1);
        c.setLineDash([]);
      }
      c.fillStyle = n.inScale ? '#5b9dff' : '#ff8a4c';
      c.globalAlpha = 0.85;
      roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.fill();
      c.globalAlpha = 1;
      const selN = S.sel && S.sel.type === 'note' && S.sel.id === n.id;
      if (n.modeSuspect && !selN) { // tam tonunda scale dışı: mod yanlış olabilir
        c.lineWidth = 2; c.strokeStyle = '#c792ea'; c.setLineDash([2, 2]);
        roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.stroke();
        c.setLineDash([]); c.lineWidth = 1;
      }
      if (selN || n.locked || n.label != null) {
        c.lineWidth = selN ? 2 : 1.5;
        c.strokeStyle = selN ? '#fff' : n.locked ? '#f4d35e' : '#ffb454';
        if (n.label != null && !selN) c.setLineDash([4, 2]);
        roundRect(c, x0, y - h / 2, Math.max(3, x1 - x0 - 1), h, 3); c.stroke();
        c.setLineDash([]); c.lineWidth = 1;
      }
      if (x1 - x0 > 34 && h >= 10) {
        c.fillStyle = '#0b0d12';
        let t = C.noteName(n.effMidi, false);
        if (x1 - x0 > 70) t += ` ${n.cents > 0 ? '+' : ''}${n.cents}c`;
        if (n.locked) t = '🔒' + t;
        if (n.modeSuspect) t = '? ' + t;
        c.save(); c.beginPath(); c.rect(x0, y - h / 2, x1 - x0 - 2, h); c.clip();
        c.fillText(t, x0 + 4, y + 0.5);
        c.restore();
      }
    }
    // ham ve düzeltilmiş perde eğrileri
    if (S.track) {
      const tr = S.track, hop = tr.hopSec, off = d.off, spq = g.spq;
      const f0s = Math.max(0, Math.floor(((q0v * spq) + off) / hop) - 1), f1s = Math.min(tr.f0.length, Math.ceil(((q1v * spq) + off) / hop) + 1);
      const sh = d.correction ? d.correction.shift : null;
      const curve = (withShift, color, width) => {
        c.strokeStyle = color; c.lineWidth = width; c.beginPath();
        let pen = false;
        for (let f = f0s; f < f1s; f++) {
          const on = tr.f0[f] > 0 && (!withShift || (sh && Math.abs(sh[f]) > 0.5));
          if (!on) { pen = false; continue; }
          const m = C.hzToMidi(tr.f0[f]) + (withShift ? sh[f] / 100 : 0);
          const x = qToX((f * hop - off) / spq), y = rg.yOf(m);
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
    c.fillStyle = isBlack(m) ? '#22252c' : '#d8dbe2';
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

// ---------------------------------------------------------------- fare etkileşimi
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
  S.proj.noteEdits = S.proj.noteEdits.filter((e) => e.label != null || e.target != null || e.locked);
}
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < TL.KW) return;
  const g = grid(), q = xToQ(x);
  if (y < TL.RULER) { seek(Math.max(0, q) * g.spq); return; }
  if (y < TL.RULER + TL.SEC) {
    const bar = Math.max(1, Math.floor(q / g.barQ) + 1);
    const s = sectionAtBar(bar);
    if (s) { select({ type: 'section', id: s.id }); return; }
    S.drag = { type: 'newSection', b0: bar, b1: bar };
    cv.setPointerCapture(e.pointerId); draw(); return;
  }
  if (y < TL.TOP) {
    const slot = S.d && S.d.chords.find((s) => q >= s.q0 && q < s.q1);
    if (slot) select({ type: 'chord', q: (slot.q0 + slot.q1) / 2 });
    return;
  }
  const n = noteAt(x, y);
  if (!n) { select(null); return; }
  select({ type: 'note', id: n.id });
  if (S.editMode !== 'select') {
    S.drag = { type: 'note', id: n.id, y0: y, mode: S.editMode, base: S.editMode === 'sound' ? (n.manualTarget ?? n.soundMidi) : n.effMidi, moved: false };
    cv.setPointerCapture(e.pointerId);
  }
});
cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!S.drag) {
    cv.style.cursor = y > TL.TOP && S.editMode !== 'select' && noteAt(x, y) ? 'ns-resize' : y < TL.TOP && y > TL.RULER ? 'pointer' : 'default';
    return;
  }
  const g = grid();
  if (S.drag.type === 'newSection') {
    S.drag.b1 = Math.max(1, Math.floor(xToQ(x) / g.barQ) + 1);
    draw(); return;
  }
  if (S.drag.type === 'note') {
    const dy = S.drag.y0 - y;
    if (!S.drag.moved && Math.abs(dy) < 4) return;
    S.drag.moved = true;
    const n = S.d.notes.find((k) => k.id === S.drag.id);
    if (!n) return;
    const semis = dy / rollGeom().rowH;
    const ed = editFor(n, true);
    if (S.drag.mode === 'sound') {
      ed.target = e.shiftKey ? Math.round((S.drag.base + semis) * 100) / 100 : Math.round(S.drag.base + semis);
      ed.locked = true;
    } else {
      ed.label = Math.round(S.drag.base + semis);
    }
    refresh();
  }
});
cv.addEventListener('pointerup', () => {
  const dr = S.drag;
  S.drag = null;
  if (!dr) return;
  if (dr.type === 'newSection') {
    const a = Math.min(dr.b0, dr.b1), b = Math.max(dr.b0, dr.b1);
    addSection(null, a, b);
  } else if (dr.type === 'note' && dr.moved) {
    cleanupEdits(); refresh();
    if (dr.mode === 'sound') scheduleRender(true);
  }
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
function select(sel) { S.sel = sel; renderInspector(); renderSections(); draw(); }

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
        <span class="sub">${c.confidence}%${c.endsOnTonic ? ' · son nota = ev notası' : ''}${c.sameNotesAs.length ? ' · aynı notalar: ' + esc(c.sameNotesAs.join(', ')) : ''}</span>
        <button data-act="pickKey" data-id="${s.id}" data-t="${c.tonic}" data-m="${c.mode}">Seç</button></li>`).join('');
    const head = s.implicit
      ? `<div class="head"><b>Tüm şarkı</b> <span class="hint">(bölüm tanımlanmadı)</span></div>`
      : `<div class="head">
          <input type="text" value="${esc(src.name)}" data-act="secName" data-id="${s.id}" aria-label="bölüm adı">
          <input type="number" min="1" value="${s.startBar}" data-act="secStart" data-id="${s.id}" title="başlangıç ölçüsü">
          <input type="number" min="1" value="${s.endBar}" data-act="secEnd" data-id="${s.id}" title="bitiş ölçüsü">
          <button data-act="secDel" data-id="${s.id}" title="bölümü sil">✕</button></div>`;
    const keyRow = s.implicit ? '' : `<div class="keyrow">
          <select data-act="secTonic" data-id="${s.id}" aria-label="merkez nota">${tonicOpts(src.tonic)}</select>
          <select data-act="secMode" data-id="${s.id}" aria-label="mod">${modeOpts(src.mode || s.mode || 'major')}</select>
          ${status}</div>`;
    return `<div class="sec-card${sel ? ' sel' : ''}" data-sec="${s.id}">${head}${keyRow}
      ${ki.last ? `<div class="hint">Ayırt edici ipucu — bölümün son ağırlıklı notası: <b>${esc(ki.last.name)}</b></div>` : ''}
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
  } else if (b.dataset.act === 'secDel' && s) {
    S.proj.sections = S.proj.sections.filter((x) => x !== s);
    S.proj.chordLocks = S.proj.chordLocks.filter((l) => l.bar < s.startBar || l.bar > s.endBar);
    if (S.sel && S.sel.id === s.id) S.sel = null;
    refresh();
  }
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
      ? `<p class="hint">Bir notaya, akora ya da bölüme tıklayın. Kısayollar: <kbd>Boşluk</kbd> çal/durdur · <kbd>↑</kbd>/<kbd>↓</kbd> seçili notayı düzelt (etiket/ses modunda; <kbd>Shift</kbd> = 5 cent) · <kbd>L</kbd> kilit · <kbd>Ctrl</kbd>+tekerlek yakınlaş.</p>`
      : `<p class="hint">Başlamak için bir kayıt yapın, dosya yükleyin ya da <b>Test melodisi üret</b>'e basın.</p>`;
    return;
  }
  if (S.sel.type === 'note') return renderNoteInspector(box, d.notes.find((n) => n.id === S.sel.id));
  if (S.sel.type === 'chord') return renderChordInspector(box, d.chords.find((s) => S.sel.q >= s.q0 && S.sel.q < s.q1));
  if (S.sel.type === 'section') {
    const s = d.sections.find((x) => x.id === S.sel.id);
    if (!s) { box.innerHTML = ''; return; }
    const ki = d.keyInfo[s.id];
    const hist = ki && ki.hist ? Array.from(ki.hist).map((v, i) => ({ v, i })).filter((x) => x.v > 0.005).sort((p, q) => q.v - p.v).map((x) => `${C.pcName(x.i, C.keyUsesFlats(s.tonic, s.mode))} ${(x.v * 100).toFixed(0)}%`).join(' · ') : '';
    const chords = d.chords.filter((c) => c.section === s.id).map((c) => C.chordName(c.chord, c.flats)).join(' – ');
    box.innerHTML = `<h3>${esc(s.name)} · ölçü ${s.startBar}–${s.endBar}</h3>
      <div class="kv"><span>Ton</span><span>${s.tonic != null ? esc(C.keyName(s.tonic, s.mode)) + (s.provisional ? ' <span class="tag warn">öneri</span>' : ' <span class="tag ok">onaylı</span>') : '—'}</span>
      <span>Scale notaları</span><span>${s.pcs ? s.pcs.map((p) => C.pcName(p, C.keyUsesFlats(s.tonic, s.mode))).join(' ') : '—'}</span>
      <span>Ağırlıklı histogram</span><span>${hist || '—'}</span>
      <span>Son ağırlıklı nota</span><span>${ki && ki.last ? esc(ki.last.name) : '—'}</span>
      <span>Akorlar</span><span>${esc(chords)}</span></div>
      <p class="hint">Ton/mod seçimini soldaki 4. adımdan yapın. Son karar her zaman sizde.</p>`;
  }
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
  box.innerHTML = `<h3>Nota ${esc(nn(n.effMidi))}${n.label != null ? ' <span class="tag warn">etiket</span>' : ''}${n.locked ? ' <span class="tag" style="color:var(--lock);border-color:var(--lock)">🔒 kilitli</span>' : ''}</h3>
    <div class="kv">
      <span>Algılanan</span><span>${esc(nn(n.nearest))} ${n.cents > 0 ? '+' : ''}${n.cents} cent <span class="hint">(kişisel akort referansına göre${n.refCents ? `; referans ${n.refCents >= 0 ? '+' : ''}${n.refCents.toFixed(0)}c` : ''} · A4=440'a göre ${esc(nn(n.absNearest))} ${n.absCents > 0 ? '+' : ''}${n.absCents}c · medyan MIDI ${n.median.toFixed(2)})</span></span>
      <span>Konum</span><span>ölçü ${mp.bar + 1}, vuruş ${beat} · ${(n.tl1 - n.tl0).toFixed(2)} s (${((n.q1 - n.q0) / g.pulseQ).toFixed(2)} vuruş)</span>
      <span>Bölüm</span><span>${sec ? esc(sec.name) + (sec.tonic != null ? ' · ' + esc(C.keyName(sec.tonic, sec.mode)) : '') : '—'} · ${n.inScale ? 'scale içinde' : '<b style="color:var(--note-out)">scale dışı</b>'}</span>
      <span>Akor ağırlığı</span><span>×${n.cw}</span>
      ${n.modeSuspect ? `<span>Mod</span><span><b style="color:#c792ea">Mod yanlış olabilir:</b> bu nota tam tonunda söylenmiş (${n.cents > 0 ? '+' : ''}${n.cents} cent) ama ${sec && sec.tonic != null ? esc(C.keyName(sec.tonic, sec.mode)) : 'seçili scale'} dışında. Büyük ihtimalle kasıtlı — bölümün modunu kontrol edin; autotune bu notanın kimliğini değiştirmez.</span>` : ''}
    </div>
    <div class="cols">
      <div class="box a"><h4>a) Etiket düzeltme — ses değişmez</h4>
        <div class="row">Analizdeki nota: <b>${esc(nn(n.label ?? n.detMidi))}</b>
          <button data-act="label" data-v="-1">−1</button><button data-act="label" data-v="1">+1</button>
          <button data-act="labelReset"${n.label == null ? ' disabled' : ''}>Sıfırla</button></div>
        <p class="hint">Pitch detection yanlış algıladığında kullanın. Ton önerisi (4. adım) ve akor bulma bu etiketi kullanır.</p></div>
      <div class="box b"><h4>b) Ses düzeltme — perde kaydırılır</h4>
        <div class="row">${esc(soundDesc)}</div>
        <p class="hint">Yalnızca sesi değiştirir: ton önerisine ve akor bulmaya girmez — ikisi de kastedilen notayı (algılanan nota ya da etiket) kullanır. Notanın kendisi yanlışsa (a) etiketini düzeltin.</p>
        <div class="row">Hedef: <button data-act="snd" data-v="-1">−1 yarım ses</button><button data-act="snd" data-v="1">+1 yarım ses</button>
          <button data-act="snd" data-v="-0.05">−5c</button><button data-act="snd" data-v="0.05">+5c</button>
          <button data-act="sndSnap">En yakın yarım sese çek</button>
          <button data-act="sndReset"${n.manualTarget == null ? ' disabled' : ''}>Sıfırla</button></div>
        <label class="chk"><input type="checkbox" data-act="lock"${n.locked ? ' checked' : ''}${n.manualTarget != null ? ' disabled' : ''}> Kilitli (autotune dokunmaz)</label></div>
    </div>`;
}
function soundEdit(n, fn) {
  const ed = editFor(n, true);
  ed.target = fn(ed.target ?? n.soundMidi);
  ed.locked = true;
  cleanupEdits(); refresh(); scheduleRender(true);
}
$('#inspector').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !S.sel) return;
  const act = b.dataset.act;
  if (S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    if (!n) return;
    if (act === 'label') { const ed = editFor(n, true); ed.label = (n.label ?? n.detMidi) + +b.dataset.v; refresh(); }
    if (act === 'labelReset') { const ed = editFor(n); if (ed) ed.label = null; cleanupEdits(); refresh(); }
    if (act === 'snd') soundEdit(n, (t) => { const v = +b.dataset.v; return Math.abs(v) >= 1 ? Math.round(t) + v : Math.round((t + v) * 100) / 100; });
    if (act === 'sndSnap') soundEdit(n, () => n.nearest);
    if (act === 'sndReset') { const ed = editFor(n); if (ed) { ed.target = null; ed.locked = false; } cleanupEdits(); refresh(); scheduleRender(true); }
  } else if (S.sel.type === 'chord') {
    const slot = S.d.chords.find((s) => S.sel.q >= s.q0 && S.sel.q < s.q1);
    if (!slot) return;
    const scope = ($('#chScope') && $('#chScope').value) || 'slot';
    const half = scope === 'slot' ? slot.half : scope === 'bar' ? null : +scope;
    if (act === 'pickChord') { setLock(slot.bar, half, { root: +b.dataset.r, q: b.dataset.q }); }
    if (act === 'manualChord') {
      const ch = C.parseChord($('#chInput').value);
      if (!ch) { status('Akor anlaşılamadı. Örnek: C#m, Dmaj7, F#m7/A, Bsus2, Eadd9', 'err'); return; }
      setLock(slot.bar, half, ch);
    }
    if (act === 'unlockChord') { S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === slot.bar && (slot.half == null || l.half == null || l.half === slot.half))); refresh(); }
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
  if (t.dataset.act === 'lock' && S.sel && S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    const ed = editFor(n, true); ed.locked = t.checked; cleanupEdits(); refresh();
  }
});
$('#inspector').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'chInput') $('#inspector button[data-act=manualChord]').click(); });
function setLock(bar, half, chord) {
  S.proj.chordLocks = S.proj.chordLocks.filter((l) => !(l.bar === bar && (half == null || l.half == null || l.half === half)));
  S.proj.chordLocks.push({ bar, half, chord: { root: chord.root, q: chord.q, bass: chord.bass ?? null } });
  refresh();
  status(`Ölçü ${bar}${half != null ? ` (${half + 1}. yarı)` : ''}: ${C.chordName(chord)} kilitlendi.`);
}
function renderChordInspector(box, slot) {
  if (!slot) { box.innerHTML = ''; return; }
  const g = S.d.g, sec = S.d.sections.find((s) => s.id === slot.section);
  const nm = (c) => C.chordName(c, slot.flats), pn = (pc) => C.pcName(pc, slot.flats);
  const roleChips = (roles) => roles.filter((r) => r.w >= 0.5).map((r) => `<span class="role ${r.clash ? 'clash' : r.tone ? 'tone' : ''}">${esc(pn(r.pc))}: ${esc(r.role)} <small>×${r.w}</small></span>`).join('') || '<span class="hint">melodi yok</span>';
  const sty = !!S.d.styleActive;
  const fx = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
  const rows = slot.candidates.map((c) => `<tr><td><b>${esc(nm(c.chord))}</b>${C.sameChord(c.chord, slot.chord) ? ' ✓' : ''}</td><td>${sty ? `<span title="toplam">${c.score.toFixed(2)}</span> = <span title="melodi uyumu">${fx(c.melody)}</span> <span class="hint">melodi</span> ${fx(c.style)} <span class="hint" title="stil: geçiş ${fx(c.styleTrans)}, renk ${fx(c.styleColor)}">stil</span>` : c.pct}</td><td>${roleChips(c.roles)}</td>
      <td><button data-act="pickChord" data-r="${c.chord.root}" data-q="${c.chord.q}">Seç + kilitle</button></td></tr>`).join('');
  const sug = slot.suggest ? `<tr><td><b>${esc(nm(slot.suggest))}</b></td><td>öneri</td><td class="hint">Minör akorda melodi 2'liye basıyor → sus2 varyantı</td><td><button data-act="pickChord" data-r="${slot.suggest.root}" data-q="${slot.suggest.q}">Seç + kilitle</button></td></tr>` : '';
  const halfTxt = slot.half == null ? 'tüm ölçü' : `${slot.half + 1}. yarı`;
  const scopeSel = g.split ? `<select id="chScope" aria-label="kapsam" style="width:auto"><option value="slot">bu slot (${halfTxt})</option>${slot.half != null ? '<option value="bar">tüm ölçü</option>' : ''}<option value="0">1. yarı</option><option value="1">2. yarı</option></select>` : '';
  const disp = Object.assign({}, slot.chord, { bass: slot.chord.bass ?? (slot.inversion ? slot.voicing.bassPc : null) });
  box.innerHTML = `<h3>Ölçü ${slot.bar} · ${halfTxt} · ${esc(sec ? sec.name : '')}${sec && sec.tonic != null ? ' (' + esc(C.keyName(sec.tonic, sec.mode)) + ')' : ''}</h3>
    <div class="kv"><span>Akor</span><span><b style="font-size:16px">${esc(C.chordName(disp, slot.flats))}</b> ${slot.locked ? '<span class="tag" style="color:var(--lock);border-color:var(--lock)">🔒 kilitli</span>' : '<span class="tag">otomatik</span>'}</span>
      <span>Neden</span><span>${esc(slot.reason || '')}</span>
      <span>Melodi notalarının rolü</span><span>${roleChips(slot.roles)}</span>
      ${slot.rhythm ? `<span>Değiş mi kal mı</span><span>harmonik ritim: bu akor ${slot.rhythm.held} ölçüdür çalıyordu → bu modda değişme olasılığı %${Math.round(slot.rhythm.h * 100)} (payı ${slot.rhythm.value >= 0 ? '+' : ''}${slot.rhythm.value.toFixed(2)})</span>` : sty ? '<span>Değiş mi kal mı</span><span class="hint">harmonik ritim verisi yok — stil bu karara katılmıyor</span>' : ''}
      <span>Seslendirme</span><span>bas ${esc(C.noteName(slot.voicing.bass, slot.flats))} · ${slot.voicing.notes.map((m) => esc(C.noteName(m, slot.flats))).join(' ')}${slot.inversion ? ' (çevrim)' : ''}</span></div>
    <table><thead><tr><th>En iyi adaylar</th><th>${sty ? 'puan = melodi payı + stil payı ("hangi akor")' : 'puan'}</th><th>ağırlıklı melodi notalarının rolü (kök/3/5/7/9)</th><th></th></tr></thead><tbody>${rows}${sug}</tbody></table>
    ${sec && sec.tonic != null && window.StyleUI ? `<div class="row" style="margin-top:6px"><span class="hint">Bu akor seçimi (önceki akordan geçiş) — kişisel geri bildirim:</span>
      <button data-act="fbChord" data-v="1" title="beğen">👍</button><button data-act="fbChord" data-v="-1" title="beğenme">👎</button></div>` : ''}
    <div class="row" style="margin-top:8px">Elle yaz: <input type="text" id="chInput" placeholder="ör. Dmaj7, C#m, F#m7/A" style="width:170px"> ${scopeSel}
      <button data-act="manualChord" class="accent">Uygula + kilitle</button>
      <button data-act="unlockChord"${slot.locked ? '' : ' disabled'}>Kilidi kaldır (otomatiğe dön)</button></div>`;
}

// ---------------------------------------------------------------- bilgi satırları
function renderInfo() {
  const a = S.audio;
  $('#audioInfo').textContent = a ? `${a.name} · ${(a.data.length / a.sr).toFixed(1)} s · ${a.sr} Hz${S.proj.audio.source === 'record' ? ` · gecikme telafisi ${S.proj.settings.latencyMs} ms` : ''}` : 'Ses yok';
  const tu = S.d && S.d.tuning;
  $('#pitchInfo').textContent = S.d && S.rawNotes ? `${tu && !tu.off ? `Akort referansı: A4 ≈ ${tu.a4.toFixed(1)} Hz (${tu.global >= 0 ? '+' : ''}${tu.global.toFixed(0)} cent), zamanla kayma ${tu.driftMin.toFixed(0)}…+${tu.driftMax.toFixed(0)} cent · ` : 'Akort referansı: A4 = 440 Hz · '}${S.d.notes.length} nota · ${S.d.notes.filter((n) => !n.inScale).length} scale dışı · ${S.d.notes.filter((n) => n.label != null).length} etiket · ${S.d.notes.filter((n) => n.manualTarget != null).length} manuel` : '';
  const at = S.proj.autotune;
  const nAuto = S.d ? S.d.notes.filter((n) => n.corr && n.corr.source === 'auto' && Math.abs(n.corr.applied) >= 1).length : 0;
  $('#renderInfo').textContent = !a ? '' : (at.enabled ? `Autotune açık · ${nAuto} nota kaydırıldı. ` : 'Autotune kapalı. ') + (renderReady() ? 'Düzeltilmiş iz güncel.' : 'Render bekliyor…');
  $('#btnAB').textContent = 'A/B: ' + (S.proj.mixer.ab === 'original' ? 'Orijinal' : 'Düzeltilmiş');
  $('#btnAB').classList.toggle('on', S.proj.mixer.ab === 'original');
  updateReadout();
}

// ---------------------------------------------------------------- giriş alanları
function syncInputs() {
  const p = S.proj;
  $('#inBpm').value = p.settings.bpm; $('#inMeter').value = p.settings.meter; $('#inLatency').value = p.settings.latencyMs;
  const gq = C.makeGrid(p.settings);
  $('#bpmUnit').textContent = p.settings.meter === '6/8' ? `(♩. = noktalı çeyrek; ♩ = ${Math.round(gq.quarterBpm)})` : '(♩ = çeyrek nota)';
  $('#inOffset').value = Math.round(p.audio.offsetSec * 1000);
  if (p.audio.alignMode) $('#inAlign').value = p.audio.alignMode;
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
  $('#inHomeEvery').value = p.chordOpts.homeEvery; $('#inColorPen').value = p.chordOpts.colorPenalty; $('#outColorPen').textContent = p.chordOpts.colorPenalty;
  $('#inPedal').checked = p.mixer.pedal; $('#inPlayClick').checked = p.mixer.click;
  for (const tr of ['vocal', 'piano']) {
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
$('#inAlign').addEventListener('change', (e) => { S.proj.audio.alignMode = e.target.value; if (e.target.value === 'none' && S.proj.audio.source === 'file') S.proj.audio.offsetSec = 0; applyAlign(); syncInputs(); refresh(); });
$('#btnLatencyGuess').onclick = () => {
  const ctx = getCtx();
  const ms = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) + 10;
  S.proj.settings.latencyMs = ms; syncInputs(); refresh();
  status(`Tahmini gecikme ${ms} ms (çıkış + ~10 ms giriş). Daha doğrusu için "Kalibre et".`);
};
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
$('#btnClearManual').onclick = () => { S.proj.noteEdits.forEach((e) => { e.target = null; e.locked = false; }); cleanupEdits(); refresh(); scheduleRender(true); };
$('#btnClearLabels').onclick = () => { S.proj.noteEdits.forEach((e) => { e.label = null; }); cleanupEdits(); refresh(); };
$('#inPct').addEventListener('input', (e) => { S.proj.chordOpts.changePct = +e.target.value; $('#outPct').textContent = '%' + e.target.value; refresh(); });
onNum('#inMaxBars', (v) => { S.proj.chordOpts.maxBars = Math.max(1, Math.round(v)); refresh(); });
onNum('#inHomeEvery', (v) => { S.proj.chordOpts.homeEvery = Math.max(0, Math.round(v)); refresh(); });
$('#inColorPen').addEventListener('input', (e) => { S.proj.chordOpts.colorPenalty = +e.target.value; $('#outColorPen').textContent = e.target.value; refresh(); });
$('#btnModeLabel').onclick = () => setEditMode('label');
$('#btnModeSound').onclick = () => setEditMode('sound');
$('#btnLatencyCal').onclick = () => Cal.run();
$('#btnUnlockChords').onclick = () => { S.proj.chordLocks = []; refresh(); };
$('#inPedal').addEventListener('change', (e) => { S.proj.mixer.pedal = e.target.checked; refresh(); });
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
  Player.stop(true);
  S.proj = C.newProject(); S.audio = null; S.track = null; S.rawNotes = null; S.corrected = null; S.correctedShift = null; S.sel = null; S.pos = 0;
  syncInputs(); refresh(); status('Yeni proje.');
};
$('#btnSave').onclick = () => saveProject();
$('#btnOpen').onclick = () => $('#fileProject').click();
$('#fileProject').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openProject(f); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); return; }
  if (!S.sel) return;
  if (S.sel.type === 'note') {
    const n = S.d.notes.find((x) => x.id === S.sel.id);
    if (!n) return;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.editMode !== 'select') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      if (S.editMode === 'label') { const ed = editFor(n, true); ed.label = (n.label ?? n.detMidi) + dir; refresh(); }
      else soundEdit(n, (t) => (e.shiftKey ? Math.round((t + dir * 0.05) * 100) / 100 : Math.round(t) + dir));
    }
    if (e.key === 'l' || e.key === 'L') { const ed = editFor(n, true); ed.locked = !n.locked; cleanupEdits(); refresh(); }
  }
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
  Player.stop(true);
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
$('#btnExpMidi').onclick = () => { if (!needData()) return; download(C.exportMidi(S.proj, S.d), 'akorlar-ve-melodi.mid', 'audio/midi'); status('MIDI dışa aktarıldı (tempo, ölçü, bölüm işaretleri, melodi + piyano izi).'); };
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
    const ev = C.pianoEvents(S.d.chords, S.d.g);
    const pno = C.renderPiano(ev, piano.samples, sr, n, 0.35);
    const m = S.proj.mixer, anySolo = m.vocal.solo || m.piano.solo;
    const gv = m.vocal.mute || (anySolo && !m.vocal.solo) ? 0 : dbToGain(m.vocal.vol);
    const gp = m.piano.mute || (anySolo && !m.piano.solo) ? 0 : dbToGain(m.piano.vol);
    const mix = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) { mix[i] = vocal[i] * gv + pno[i] * gp; peak = Math.max(peak, Math.abs(mix[i])); }
    if (peak > 0.98) for (let i = 0; i < n; i++) mix[i] *= 0.98 / peak;
    download(new Blob([C.encodeWav([mix, mix], sr)], { type: 'audio/wav' }), 'vokal-piyano-mix.wav');
  });
  status('Vokal + piyano mix WAV dışa aktarıldı.');
};

// ---------------------------------------------------------------- başlangıç
setEditMode('select');
syncInputs();
refresh();
loadPianoSamples(); // hangi piyanonun çalacağı baştan görünsün
status('Hazır. Kayıt yapın, dosya yükleyin ya da test melodisi üretin.');
})();

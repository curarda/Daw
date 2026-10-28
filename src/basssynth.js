// ---------------------------------------------------------------- BAS SES MOTORU: Web Audio sentezleyici (BassInstrument arayüzü) + örnekleyici
// DOM'suz; AudioContext yalnızca örnek oluşturulurken kullanılır (gerçek zamanlı ya da OfflineAudioContext). Üreticiden bağımsız:
// BassInstrument { noteOn(midi, velocity, time, opts?), noteOff(time), setPreset(name), output }.
(function (root) {
const C = root.Core;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const P = (o) => Object.assign({ wave: 'sawtooth', level: 1, wave2: null, detune2: 0, level2: 0, sub: 0, subWave: 'sine', cutoff: 1200, q: 1, env: 2, fdecay: 0.15, velCut: 1, steep: false, a: 0.004, d: 0.2, s: 0.5, r: 0.08, drive: 0, glide: 0.04, trim: 1 }, o);
// cutoff: bas gitar tipinde sabit kesim; synth tipinde bölüm süzgeci kesimi sürer (env üstüne biner). env = süzgeç zarfı, oktav
const BASS_PRESETS = {
  'Dark pick': P({ wave: 'sawtooth', sub: 0.12, cutoff: 900, q: 1.4, env: 2.4, fdecay: 0.16, velCut: 1.6, a: 0.003, d: 0.28, s: 0.3, r: 0.07, drive: 0.12, trim: 0.47 }),
  'Warm sub': P({ wave: 'triangle', level: 0.8, sub: 0.7, cutoff: 520, q: 0.7, env: 0.4, fdecay: 0.3, velCut: 0.6, a: 0.012, d: 0.4, s: 0.85, r: 0.16, trim: 0.32 }),
  'Synth saw': P({ wave: 'sawtooth', sub: 0.3, cutoff: 1100, q: 4, env: 3, fdecay: 0.22, velCut: 1.2, a: 0.003, d: 0.2, s: 0.6, r: 0.08, trim: 0.54 }),
  'Fuzz': P({ wave: 'sawtooth', wave2: 'square', level2: 0.5, detune2: 7, sub: 0.2, cutoff: 2400, q: 1.2, env: 1.2, fdecay: 0.12, velCut: 1, a: 0.002, d: 0.2, s: 0.7, r: 0.06, drive: 0.85, trim: 0.19 }),
  'Moroder pulse': P({ wave: 'sawtooth', sub: 0.3, subWave: 'square', cutoff: 1500, q: 3, env: 2.2, fdecay: 0.1, velCut: 1.4, a: 0.002, d: 0.12, s: 0.3, r: 0.05, trim: 0.96 }),
  'Sub drone': P({ wave: 'sine', wave2: 'triangle', level2: 0.5, sub: 0.5, cutoff: 600, q: 0.7, env: 0, fdecay: 0.3, velCut: 0.3, a: 0.03, d: 0.1, s: 1, r: 0.3, glide: 0.07, trim: 0.24 }),
  'Acid squelch': P({ wave: 'sawtooth', cutoff: 700, q: 12, env: 3.6, fdecay: 0.12, velCut: 1.2, steep: true, a: 0.002, d: 0.14, s: 0.5, r: 0.05, glide: 0.05, trim: 0.58 }),
  'Reese': P({ wave: 'sawtooth', wave2: 'sawtooth', level2: 1, detune2: 12, sub: 0.3, cutoff: 700, q: 1, env: 0.5, fdecay: 0.4, velCut: 0.6, a: 0.01, d: 0.3, s: 0.9, r: 0.2, trim: 0.43 }),
  'Analog pluck': P({ wave: 'square', sub: 0.15, cutoff: 800, q: 2, env: 2.6, fdecay: 0.08, velCut: 1.4, a: 0.002, d: 0.15, s: 0.15, r: 0.05, trim: 1.0 }),
};
const SHAPER_K = 1.5;
// çıkışta yumuşak sınırlayıcı: 0.8'e kadar doğrusal, üstünde tanh ile 1'e (kırpma yok); giriş ±2 aralığını kapsar
function limiterCurve(n = 4096) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(x), y = a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2); c[i] = Math.sign(x) * y / 2; } return c; }
function shaperCurve(n = 2048) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(SHAPER_K * x) / Math.tanh(SHAPER_K); } return c; }

class BassSynth {
  constructor(ctx, o = {}) {
    this.ctx = ctx;
    this.cur = null; this.voices = [];
    this.hits = 0; this.log = []; this.noteLog = []; // sınama için: nota sayısı, nota ve süzgeç otomasyonu kaydı
    this.follow = !!o.follow; // true: kesim bölüm süzgeci otomasyonundan (synth tipi)
    this.level = o.level ?? 1;
    this.cutoffHz = 1200; this.pumpDepth = 0;
    const c = ctx;
    this.bus = c.createGain();
    this.f1 = c.createBiquadFilter(); this.f1.type = 'lowpass';
    this.f2 = c.createBiquadFilter(); this.f2.type = 'lowpass'; // 24 dB/okt için ikinci kutup
    this.fenv = c.createConstantSource(); this.fenv.offset.value = 0; this.fenv.connect(this.f1.detune); this.fenv.connect(this.f2.detune); this.fenv.start();
    this.pre = c.createGain(); this.shaper = c.createWaveShaper(); this.shaper.curve = shaperCurve(); this.shaper.oversample = '2x'; this.post = c.createGain();
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 30; this.hp.Q.value = 0.7; // duyulmayan gümbürtüyü ayır
    this.limPre = c.createGain(); this.limPre.gain.value = 0.5; this.lim = c.createWaveShaper(); this.lim.curve = limiterCurve(); this.limPost = c.createGain(); this.limPost.gain.value = 2;
    this.pump = c.createGain();
    this.output = c.createGain(); this.output.gain.value = o.volume ?? 0.8;
    this.bus.connect(this.f1); this.f1.connect(this.f2); this.f2.connect(this.pre); this.pre.connect(this.shaper); this.shaper.connect(this.post); this.post.connect(this.hp); this.hp.connect(this.limPre); this.limPre.connect(this.lim); this.lim.connect(this.limPost); this.limPost.connect(this.pump); this.pump.connect(this.output);
    this.setPreset(o.preset || 'Dark pick');
  }
  setPreset(name) {
    const p = BASS_PRESETS[name] || BASS_PRESETS['Dark pick'];
    this.name = BASS_PRESETS[name] ? name : 'Dark pick'; this.p = p;
    this.f1.Q.value = p.q; this.f2.Q.value = p.steep ? p.q * 0.6 : 0.5;
    this.f2.frequency.value = p.steep ? 1e5 : 1e5; // ikinci kutup yalnızca steep'te devrede (kesim aşağıda ayarlanır)
    this.setCutoff(this.follow ? this.cutoffHz : p.cutoff, 0, 0, true);
    this.setDrive(p.drive, 0);
    this.post.gain.value = p.trim;
  }
  setVolume(v) { this.output.gain.value = clamp(v, 0, 1.5); }
  // kesim frekansı: ramp > 0 ise zaman çizelgesinde zamana doğru (ses saatinde) kayar
  setCutoff(hz, time = 0, ramp = 0, now = false) {
    hz = clamp(hz, 20, 18000);
    if (this.log.length < 800) this.log.push({ hz, time, ramp });
    const set = (param, v) => {
      if (now || !ramp) { param.cancelScheduledValues(time); param.setValueAtTime(v, time); } else { param.setValueAtTime(clamp(this.cutoffHz, 20, 18000), time); param.exponentialRampToValueAtTime(v, time + ramp); }
    };
    set(this.f1.frequency, hz); set(this.f2.frequency, this.p.steep ? hz : 1e5);
    this.cutoffHz = hz;
  }
  setResonance(res, time = 0) { const q = 0.5 + clamp(res, 0, 1) * 14; this.f1.Q.setValueAtTime(q, time); this.f2.Q.setValueAtTime(this.p.steep ? q * 0.6 : 0.5, time); }
  setDrive(d, time = 0) { d = clamp(d, 0, 1); this.pre.gain.setValueAtTime(1 + d * 9, time); this.driveNow = d; }
  // tempoya senkron pompa: her vuruşta kazanç dipten 1'e (release = saniye)
  pumpAt(time, depth, release) { if (depth <= 0) return; this.pump.gain.setValueAtTime(1 - depth, time); this.pump.gain.linearRampToValueAtTime(1, time + release); }
  _voice(midi, vel, time, o) {
    const c = this.ctx, p = this.p, f = mtof(midi);
    const amp = c.createGain(); amp.gain.value = 0; amp.connect(this.bus);
    const oscs = [];
    const add = (type, mul, level, detune) => { const os = c.createOscillator(); os.type = type; os.frequency.value = f * mul; os.detune.value = detune || 0; const g = c.createGain(); g.gain.value = level; os.connect(g); g.connect(amp); os.start(time); oscs.push(os); return os; };
    add(p.wave, 1, p.level * (p.wave2 && p.detune2 ? 0.55 : 0.8), p.detune2 ? -p.detune2 : 0);
    if (p.wave2) add(p.wave2, 1, p.level2 * 0.55, p.detune2 || 0);
    if (p.sub > 0) add(p.subWave, 0.5, p.sub * 0.8, 0);
    return { amp, oscs, midi, freq: f, offTime: null, endTime: Infinity, ghost: !!o.ghost };
  }
  _end(v, at) { // sesi at'te durdurur
    for (const os of v.oscs) { try { os.stop(at); } catch (e) { /* zaten durmuş */ } }
    v.endTime = at;
    if (v.oscs[0]) v.oscs[0].onended = () => { try { v.amp.disconnect(); } catch (e) { /* */ } };
  }
  noteOn(midi, velocity, time, o = {}) {
    if (typeof o === 'boolean') o = { glide: o };
    const p = this.p, vel = clamp(velocity, 1, 127) / 127;
    this.hits++;
    if (this.noteLog.length < 800) this.noteLog.push({ time, midi, vel: velocity, tie: !!o.tie, glide: !!o.glide, accent: !!o.accent });
    const glideSec = o.glide ? (typeof o.glide === 'number' ? o.glide / 1000 : p.glide) : 0;
    const cur = this.cur;
    const sounding = cur && cur.endTime > time && (cur.offTime == null || cur.offTime >= time - 0.003);
    const peak = Math.pow(vel, 1.25) * (o.ghost ? 0.85 : 1);
    // süzgeç zarfı her notada yeniden tetiklenir (hız ve vurguyla ölçeklenir)
    const fenvAt = () => {
      const base = p.velCut * vel * 1200, top = base + p.env * (o.accent ? 1.5 : 1) * (o.ghost ? 0 : 1) * (0.4 + 0.6 * vel) * 1200;
      this.fenv.offset.cancelScheduledValues(time); this.fenv.offset.setValueAtTime(o.ghost ? -1500 : top, time);
      this.fenv.offset.setTargetAtTime(o.ghost ? -1500 : base, time, Math.max(0.01, p.fdecay / 3));
    };
    // legato: bağ ya da kayma → genlik zarfı yeniden tetiklenmez, perde kayar
    if (sounding && (o.tie || glideSec > 0)) {
      cur.amp.gain.cancelScheduledValues(time); // bekleyen sönümü iptal et
      cur.offTime = null;
      if (glideSec > 0 && cur.midi !== midi) {
        const f = mtof(midi);
        cur.oscs.forEach((os, k) => { const mul = k === cur.oscs.length - 1 && p.sub > 0 ? 0.5 : 1; os.frequency.cancelScheduledValues(time); os.frequency.setValueAtTime(cur.freq * mul, time); os.frequency.exponentialRampToValueAtTime(f * mul, time + glideSec); });
        cur.freq = f; cur.midi = midi;
      }
      fenvAt();
      return;
    }
    // tek ses: önceki ses 5–10 ms'lik sönümle kesilir (tık yok)
    if (cur && cur.endTime > time) {
      const cut = Math.max(0, time - 0.007);
      cur.amp.gain.cancelScheduledValues(cut); cur.amp.gain.setTargetAtTime(0, cut, 0.0018);
      this._end(cur, time + 0.03);
    }
    const v = this._voice(midi, vel, time, o);
    this.cur = v;
    const a = o.ghost ? 0.001 : p.a, g = v.amp.gain;
    g.setValueAtTime(0, time); g.linearRampToValueAtTime(peak, time + a);
    if (o.ghost) g.setTargetAtTime(0, time + a, 0.012);
    else g.setTargetAtTime(peak * p.s, time + a, Math.max(0.005, p.d / 3));
    fenvAt();
    if (glideSec > 0 && cur && cur.endTime > time) { // kayan ses yeni sesten önce biten bir önceki sesle (kesildi) — perde kaymasını yeni sese uygula
      v.oscs.forEach((os) => { os.frequency.cancelScheduledValues(time); os.frequency.setValueAtTime(cur.freq * (os === v.oscs[v.oscs.length - 1] && p.sub > 0 ? 0.5 : 1), time); os.frequency.exponentialRampToValueAtTime(v.freq * (os === v.oscs[v.oscs.length - 1] && p.sub > 0 ? 0.5 : 1), time + glideSec); });
    }
    this.voices.push(v);
    if (this.voices.length > 6) this.voices.shift();
  }
  noteOff(time) {
    const v = this.cur; if (!v || v.endTime <= time) return;
    const r = v.ghost ? 0.02 : this.p.r;
    v.amp.gain.cancelScheduledValues(time); v.amp.gain.setTargetAtTime(0, time, Math.max(0.004, r / 4));
    v.offTime = time;
    this._end(v, time + r * 2 + 0.06);
  }
  // durdur: her sesi çabuk söndür
  panic(time) {
    for (const v of this.voices) { try { v.amp.gain.cancelScheduledValues(time); v.amp.gain.setTargetAtTime(0, time, 0.004); for (const os of v.oscs) os.stop(time + 0.05); } catch (e) { /* */ } }
    this.voices = []; this.cur = null;
    this.pump.gain.cancelScheduledValues(time); this.pump.gain.setValueAtTime(1, time);
    this.fenv.offset.cancelScheduledValues(time); this.fenv.offset.setValueAtTime(0, time);
  }
  dispose() { try { this.panic(0); this.fenv.stop(); this.output.disconnect(); } catch (e) { /* */ } }
}

// ---------------------------------------------------------------- örnekleyici (aynı arayüz): kullanıcının yüklediği örneklerle çalar
// Örnekler: {midi, buffer (AudioBuffer)} — nota başına ya da küçük üçlü başına; en yakın örnek perdeyle kaydırılır. İki dönüşümlü varyant ve bırakma örneği desteklenir.
class BassSampler {
  constructor(ctx, o = {}) {
    this.ctx = ctx; this.samples = []; this.releases = []; this.rr = 0; this.cur = null; this.name = 'Sampler';
    this.retainSample = o.retainSample; this.sampleReleases = new Set();
    this.output = ctx.createGain(); this.output.gain.value = o.volume ?? 0.8;
    this.bus = ctx.createGain(); this.bus.connect(this.output);
  }
  load(samples, releaseSamples) { this.samples = samples.slice().sort((a, b) => a.midi - b.midi); this.releases = releaseSamples || []; }
  get ready() { return this.samples.length > 0; }
  setPreset() { /* örnek seti kullanıcıdan gelir */ }
  setVolume(v) { this.output.gain.value = clamp(v, 0, 1.5); }
  setCutoff() {} setResonance() {} setDrive() {} pumpAt() {}
  _pick(midi) {
    const cands = this.samples.filter((s) => Math.abs(s.midi - midi) === Math.min(...this.samples.map((x) => Math.abs(x.midi - midi))));
    const k = this.rr++ % cands.length; // iki dönüşümlü (round-robin) varyant
    return cands[k];
  }
  noteOn(midi, velocity, time, o = {}) {
    if (!this.ready) return;
    const c = this.ctx, s = this._pick(midi);
    if (this.cur && this.cur.endTime > time) { const cut = Math.max(0, time - 0.007); this.cur.g.gain.cancelScheduledValues(cut); this.cur.g.gain.setTargetAtTime(0, cut, 0.0018); try { this.cur.src.stop(time + 0.03); } catch (e) { /* */ } }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = s.buffer; src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);
    g.gain.value = Math.pow(clamp(velocity, 1, 127) / 127, 1.2) * (o.ghost ? 0.3 : 1);
    src.connect(g); g.connect(this.bus);
    const release = this.retainSample?.();
    if (release) { this.sampleReleases.add(release); src.onended = () => { src.disconnect(); g.disconnect(); release(); this.sampleReleases.delete(release); }; }
    try { src.start(time); } catch (e) { release?.(); this.sampleReleases.delete(release); throw e; }
    this.cur = { src, g, endTime: Infinity, midi };
  }
  noteOff(time) {
    const v = this.cur; if (!v || v.endTime <= time) return;
    v.g.gain.cancelScheduledValues(time); v.g.gain.setTargetAtTime(0, time, 0.02);
    try { v.src.stop(time + 0.15); } catch (e) { /* */ }
    v.endTime = time + 0.15;
    if (this.releases.length) { const r = this.releases[this.rr % this.releases.length], rs = this.ctx.createBufferSource(), rg = this.ctx.createGain(); rs.buffer = r.buffer; rs.playbackRate.value = Math.pow(2, (v.midi - r.midi) / 12); rg.gain.value = 0.25; rs.connect(rg); rg.connect(this.bus); rs.start(time); }
  }
  releaseSamples() { for (const release of this.sampleReleases) release(); this.sampleReleases.clear(); }
  panic(time) { if (this.cur) { try { this.cur.src.stop(time + 0.02); } catch (e) { /* */ } this.cur = null; } }
  dispose() { try { this.output.disconnect(); } catch (e) { /* */ } }
}

// ---------------------------------------------------------------- olayları örneğe uygula (gerçek zamanlı ve çevrimdışı aynı yol)
// e: Bass.bassEvents öğesi; offset: oktav kayması; levelMul: hız çarpanı (katman / düşük nota ikilemesi)
function hitBass(inst, e, time, o = {}) {
  const midi = clamp(e.midi + (o.octave || 0), 0, 127), vel = clamp(Math.round(e.vel * (o.velMul ?? 1)), 1, 127);
  inst.noteOn(midi, vel, time, { glide: e.glide, accent: e.accent, tie: e.tiedFrom, ghost: e.ghost });
  if (!e.tie) inst.noteOff(time + Math.max(0.02, e.dur * (e.gate ?? 1)));
}
Object.assign(C.Bass, { BASS_PRESETS, BassSynth, BassSampler, hitBass, mtof });
})(typeof window !== 'undefined' ? window : globalThis);

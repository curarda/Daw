// Test için uygulamanın kendi sentezleriyle "miks WAV" üretir: vokal (sinüs melodi) + akorlar (synth) + davul (loop). Tempo, ölçü başı, akor ve kick'ler bilinir.
export function makeMix(C, { bpm = 100, bars = 8, prog = [[9, 'm'], [5, ''], [0, ''], [7, '']], halves = null, loop = 'rock8', style = 'synth-chord', meter = '4/4', sr = 44100, lead = 0, vocal = true, tail = 1 } = {}) {
  const p = C.newProject(); p.settings.bpm = bpm; p.settings.meter = meter;
  p.sections = [{ id: 'a', name: 'Şarkı', startBar: 1, endBar: bars, tonic: 9, mode: 'minor' }];
  p.piano.style = style; p.drums = { on: true, loop, startBar: 1, fills: false };
  p.chordLocks = [];
  for (let b = 1; b <= bars; b++) {
    const h = halves && halves[(b - 1) % halves.length];
    if (h) p.chordLocks.push({ bar: b, half: 0, chord: { root: h[0][0], q: h[0][1] }, src: 'chart' }, { bar: b, half: 1, chord: { root: h[1][0], q: h[1][1] }, src: 'chart' });
    else { const [r, q] = prog[(b - 1) % prog.length]; p.chordLocks.push({ bar: b, half: null, chord: { root: r, q }, src: 'chart' }); }
  }
  const d = C.derive(p, { duration: 0, rawNotes: [] }), ev = C.arrangedEvents(d, p), g = d.g;
  const len = Math.round((bars * g.barSec + tail) * sr), body = new Float32Array(len);
  const add = (a, gain) => { for (let i = 0; i < Math.min(len, a.length); i++) body[i] += a[i] * gain; };
  add(C.renderSynth(ev.piano, sr, len, 1), 1);
  add(C.renderDrums(ev.drums, sr, len, 1), 0.9);
  if (vocal) { // akor sesleri üzerinde vibratolu sinüs melodi
    const v = new Float32Array(len);
    for (const c of d.chords) {
      const third = c.chord.q === 'm' ? 3 : 4, span = c.q1 - c.q0;
      for (let k = 0; k < 4; k++) {
        const m = 69 + ((c.chord.root - 9 + 12) % 12) + [third, 7, 12, 7][k] - 12 * (c.chord.root > 9 ? 1 : 0), f = 440 * Math.pow(2, (m - 69) / 12);
        const t0 = (c.q0 + (k * span) / 4) * g.spq, t1 = (c.q0 + ((k + 0.9) * span) / 4) * g.spq;
        for (let s = Math.round(t0 * sr); s < Math.min(len, Math.round(t1 * sr)); s++) { const t = s / sr; v[s] += 0.25 * Math.sin(2 * Math.PI * f * t + 2 * Math.sin(2 * Math.PI * 5 * t)) * Math.min(1, (t - t0) * 40); }
      }
    }
    add(v, 1);
  }
  let peak = 0; for (const a of body) peak = Math.max(peak, Math.abs(a));
  const padN = Math.round(lead * sr), out = new Float32Array(len + padN);
  for (let i = 0; i < len; i++) out[padN + i] = (body[i] / (peak * 1.05)) || 0;
  const loopDef = C.DRUM_LOOPS.find((l) => l.id === loop && l.meter === meter);
  return { data: out, sr, p, d, g, chords: d.chords.map((c) => C.chordName(c.chord)), kickSteps: loopDef ? [...loopDef.K].map((c, j) => ((c === 'x' || c === 'X') ? Math.round((j * (g.barQ / loopDef.K.length)) / 0.25) : -1)).filter((x) => x >= 0) : [] };
}

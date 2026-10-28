// Bas perdesi dosya adından değil, yerel YIN ölçümünden gelir.
(function (root) {
const C = root.Core;
const BASS_ANALYSIS = Object.freeze({ minMidi: 24, maxMidi: 60, attackSec: .06, minSustainSec: .25, minFrames: 6, spreadCents: 35, maxSeconds: 4, confidence: .75, minRms: .001, maxDcRatio: .2, maxAperiodicity: .08, octaveEnergyRatio: .02, analysisSr: 8000, hopMs: 20, detectorVersion: 1 });
const BASS_LANE_SPEC = Object.freeze({ kind: 'bass', required: true, query: 'bass note', queries: Object.freeze(['bass note', 'bass guitar single note', 'synth bass one shot', 'sub bass note']), minDuration: .3, maxDuration: 4, preferredTags: Object.freeze(['bass', 'note', 'single', 'one-shot']), rejectedTags: Object.freeze(['loop', 'loops', 'riff', 'chord', 'chords', 'melody', 'arp', 'arpeggio', 'drums', 'drum', 'beat', 'vocal', 'vocals', 'pad', 'fx', 'noise', 'pattern', 'break']) });
const SOUND_LANE_SPECS = Object.freeze({ ...C.LANE_SPECS, bass: BASS_LANE_SPEC });
const median = (xs) => { const a = xs.slice().sort((a, b) => a - b), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
async function analyzeBassSample(pcm, sampleRate) {
  const fail = (reason) => ({ ok: false, reason });
  const channels = Array.isArray(pcm) ? pcm : pcm?.channels;
  if (Math.min(channels?.[0]?.length || 0, sampleRate * BASS_ANALYSIS.maxSeconds) * 4 > C.SOUND_MEMORY_LIMIT) return fail('Bas sesi bellek sınırını aşıyor.');
  const valid = C.validateDecoded(pcm, sampleRate, BASS_ANALYSIS.maxSeconds);
  if (!valid.ok) return fail(valid.reason);
  const x = valid.mono;
  let square = 0, sum = 0, peakEnergy = 0, peakAt = 0;
  const block = Math.max(1, Math.floor(sampleRate * .02));
  for (let i = 0; i < x.length; i += block) {
    let energy = 0;
    for (let j = i; j < Math.min(x.length, i + block); j++) { energy += x[j] * x[j]; square += x[j] * x[j]; sum += x[j]; }
    if (energy > peakEnergy) { peakEnergy = energy; peakAt = i; }
  }
  const rms = Math.sqrt(square / x.length), mean = sum / x.length;
  if (rms < BASS_ANALYSIS.minRms || Math.abs(mean) > rms * BASS_ANALYSIS.maxDcRatio) return fail('Bas sesi sessiz veya DC bileşeni içeriyor.');
  const start = Math.max(Math.floor(sampleRate * BASS_ANALYSIS.attackSec), peakAt);
  if ((x.length - start) / sampleRate < BASS_ANALYSIS.minSustainSec) return fail('Bas sesi kararlı ölçüm için çok kısa.');
  const track = await C.detectPitch(x.subarray(start), sampleRate, { fmin: 25, fmax: 400, analysisSr: BASS_ANALYSIS.analysisSr, hopMs: BASS_ANALYSIS.hopMs, silenceDb: -30 });
  const frames = [];
  for (let i = 0; i < track.f0.length; i++) {
    const time = i * track.hopSec;
    if (time < .06 || time > track.duration - .09 || track.rms[i] < .04) continue;
    if (track.f0[i] > 0 && track.prob[i] >= BASS_ANALYSIS.confidence && track.aper[i] < BASS_ANALYSIS.maxAperiodicity) frames.push({ midi: 69 + 12 * Math.log2(track.f0[i] / 440), time, confidence: track.prob[i] });
  }
  if (frames.length < BASS_ANALYSIS.minFrames) return fail('Bas perdesi güvenilir ölçülemedi; gürültü veya çok sesli örnek.');
  const pitch = median(frames.map((f) => f.midi)), first = median(frames.slice(0, Math.ceil(frames.length / 2)).map((f) => f.midi)), last = median(frames.slice(Math.floor(frames.length / 2)).map((f) => f.midi));
  if (Math.abs(Math.abs(first - last) - 12) < .7) return fail('Bas perdesinde oktav belirsizliği var.');
  if (frames.some((f) => Math.abs(f.midi - pitch) * 100 > BASS_ANALYSIS.spreadCents)) return fail('Bas perdesi kararsız veya çok sesli.');
  const usableSec = frames.at(-1).time - frames[0].time + track.hopSec;
  if (usableSec < BASS_ANALYSIS.minSustainSec || frames.length * track.hopSec < usableSec * .8) return fail('Bas sesinin kararlı bölümü çok kısa.');
  if (pitch < BASS_ANALYSIS.minMidi - .5 || pitch > BASS_ANALYSIS.maxMidi + .5) return fail('Bas perdesi desteklenen aralığın dışında.');
  // Bağımsız iki pencerede yarım periyot da güçlü ise oktavı tahmin etme.
  const hz = 440 * 2 ** ((pitch - 69) / 12), period = sampleRate / hz;
  for (const fraction of [.3, .65]) {
    const offset = start + Math.floor((x.length - start) * fraction), length = Math.min(Math.floor(sampleRate * .12), x.length - offset - Math.ceil(period));
    if (length <= 0) continue;
    const difference = (lag) => { let diff = 0, energy = 0; for (let i = 0; i < length; i++) { const p = offset + i + lag, j = Math.floor(p), v = x[j] * (1 - (p - j)) + x[j + 1] * (p - j); diff += (x[offset + i] - v) ** 2; energy += x[offset + i] ** 2 + v * v; } return diff / Math.max(energy, 1e-12); };
    if (difference(period / 2) < .12) return fail('Bas perdesinde güçlü oktav belirsizliği var.');
  }
  const spectralLength = Math.min(x.length - start, Math.floor(sampleRate * .5));
  const amplitude = (frequency) => {
    let re = 0, im = 0;
    for (let i = 0; i < spectralLength; i++) { const v = x[start + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (spectralLength - 1))), phase = 2 * Math.PI * frequency * i / sampleRate; re += v * Math.cos(phase); im += v * Math.sin(phase); }
    return Math.hypot(re, im);
  };
  if (amplitude(hz / 2) > amplitude(hz) * BASS_ANALYSIS.octaveEnergyRatio) return fail('Bas perdesinde alt oktav belirsizliği var.');
  const rootMidi = Math.round(pitch);
  if (rootMidi < BASS_ANALYSIS.minMidi || rootMidi > BASS_ANALYSIS.maxMidi) return fail('Bas perdesi desteklenen aralığın dışında.');
  return { ok: true, rootMidi, rootCents: (pitch - rootMidi) * 100, pitchConfidence: Math.max(0, Math.min(1, median(frames.map((f) => f.confidence)))), detectorVersion: BASS_ANALYSIS.detectorVersion, usableSec };
}
Object.assign(C, { BASS_ANALYSIS, BASS_LANE_SPEC, SOUND_LANE_SPECS, analyzeBassSample });
})(typeof window !== 'undefined' ? window : globalThis);

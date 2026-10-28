export const record = (id, name = 'bass note') => ({ id, name, author: 'tester', url: `https://freesound.org/people/tester/sounds/${id}/`, license: 'https://creativecommons.org/publicdomain/zero/1.0/', previewUrl: `https://cdn.freesound.org/previews/1/${id}_test.mp3`, selector: 'fallback', why: '' });
export function tone(midi = 33, { cents = 0, seconds = 1, sampleRate = 16000, mode = 'plucked' } = {}) {
  const hz = 440 * 2 ** ((midi + cents / 100 - 69) / 12); let seed = 7;
  return { sampleRate, channels: [Float32Array.from({ length: Math.floor(seconds * sampleRate) }, (_, i) => {
    const t = i / sampleRate, phase = 2 * Math.PI * hz * t;
    let v = .35 * (1 - Math.exp(-t * 100)) * Math.exp(-t * 1.5) * (Math.sin(phase) + .3 * Math.sin(2 * phase) + .15 * Math.sin(3 * phase));
    if (mode === 'noise') { seed = (1664525 * seed + 1013904223) >>> 0; v = seed / 2 ** 32 - .5; }
    if (mode === 'chord') v += .3 * Math.sin(phase * 2 ** (7 / 12));
    if (mode === 'gliss') v = .3 * Math.sin(phase * (1 + t * .2));
    if (mode === 'octave') v = .02 * Math.sin(phase) + .4 * Math.sin(2 * phase);
    if (mode === 'slow') v *= Math.min(1, t / .3);
    if (mode === 'clipped') v = Math.max(-.07, Math.min(.07, v));
    if (mode === 'dc') v += .4;
    return v;
  })] };
}

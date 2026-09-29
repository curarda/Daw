// Doğrulama testleri için sentetik şarkılar: bilinen akor progresyonundan melodi üretilir
// (güçlü vuruşlarda akor sesleri, zayıf vuruşlarda gam içi geçiş notaları). Gerçek kayıtların yerini tutmaz;
// değerlendirme altyapısını ve motorların göreli davranışını sınamak içindir.
export function synthEvalItem(Core, { id, tonic, mode, bars, seed = 1, type = 'verse' }) {
  let r = seed * 7919;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  const scale = Core.scalePcs(tonic, mode);
  const near = (pc, around) => { let best = null; for (let m = around - 7; m <= around + 7; m++) if (Core.mod12(m) === pc && (best == null || Math.abs(m - around) < Math.abs(best - around))) best = m; return best; };
  const notes = [];
  let last = 64;
  const chordTone = (ch, pick) => { const pcs = Core.chordPcs(ch); return near(pcs[pick % pcs.length], last); };
  const passing = () => { const cand = [last - 2, last - 1, last + 1, last + 2].filter((m) => scale.includes(Core.mod12(m))); return cand[Math.floor(rnd() * cand.length)]; };
  const add = (q0, q1, m) => { notes.push({ q0, q1, effMidi: m }); last = m; };
  bars.forEach((cell, b) => {
    const chs = cell.split(' ').map((x) => Core.parseChord(x));
    const q = b * 4;
    if (chs.length === 1) {
      add(q, q + 1.5, chordTone(chs[0], Math.floor(rnd() * 2)));
      add(q + 1.5, q + 2, passing());
      add(q + 2, q + 3, chordTone(chs[0], 1 + Math.floor(rnd() * 2)));
      add(q + 3, q + 4, rnd() < 0.5 ? chordTone(chs[0], Math.floor(rnd() * 3)) : passing());
    } else {
      chs.forEach((ch, h) => { add(q + 2 * h, q + 2 * h + 1, chordTone(ch, Math.floor(rnd() * 2))); add(q + 2 * h + 1, q + 2 * h + 2, chordTone(ch, 2)); });
    }
  });
  const sec = { id: id + '-s', name: type, type, startBar: 1, endBar: bars.length, tonic, mode };
  return { id, artist: 'Doğrulama', title: id, meter: '4/4', sections: [sec], notes, truth: { [sec.id]: '| ' + bars.join(' | ') + ' |' } };
}
export const EVAL_SONGS = [
  { id: 'pop-I-V-vi-IV', tonic: 0, mode: 'major', bars: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'], seed: 1 },
  { id: 'minor-i-VI-III-VII', tonic: 9, mode: 'minor', bars: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am'], seed: 2 },
  { id: 'dorian-i-IV', tonic: 2, mode: 'dorian', bars: ['Dm', 'Dm', 'G', 'G', 'Dm', 'Dm', 'G', 'Dm'], seed: 3 },
  { id: 'mixo-I-bVII-IV', tonic: 7, mode: 'mixolydian', bars: ['G', 'F', 'C', 'G', 'G', 'F', 'C G', 'G'], seed: 4 },
  { id: 'major-slow', tonic: 5, mode: 'major', bars: ['F', 'F', 'Bb', 'Bb', 'C', 'C', 'F', 'F'], seed: 5 },
  { id: 'minor-halves', tonic: 4, mode: 'minor', bars: ['Em', 'C D', 'Em', 'Am B', 'Em', 'C D', 'G B', 'Em'], seed: 6 },
];

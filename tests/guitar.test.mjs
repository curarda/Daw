// Gitar katmanı (DOM'suz çekirdek): voicing motoru, ritim → nota olayları, Karplus-Strong sentezi, ton/FX.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core } = loadCore();
let failures = 0;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const info = await fn();
    results.push(`✔ ${name} (${Date.now() - t} ms)${info ? '\n    ' + info : ''}`);
  } catch (e) {
    failures++;
    results.push(`✘ ${name}\n    ${e.stack || e.message}`);
  }
}
const mod12 = (x) => ((x % 12) + 12) % 12;
const clone = (x) => JSON.parse(JSON.stringify(x));
const noWarn = (fn) => { const w = console.warn, got = []; console.warn = (m) => got.push(m); try { return [fn(), got]; } finally { console.warn = w; } };
const voice = (root, q, vo = {}, bass) => Core.guitarVoicings([{ chord: { root, q, bass }, tonic: 0 }], vo)[0];
const fr = (v) => v.frets.map((f) => (f == null ? 'x' : f)).join('');
const g44 = Core.makeGrid({ bpm: 120, meter: '4/4' });
const amFCG = [[9, 'm'], [5, ''], [0, ''], [7, '']].map(([r, q], i) => ({ q0: i * 2, q1: i * 2 + 2, chord: { root: r, q }, section: '_all', tonic: 9 }));
const part0 = (over = {}, meter = '4/4') => Object.assign(Core.defaultGuitarPart(meter), over);
const evs = (part, slots = amFCG, g = g44) => Core.guitarEvents(slots, g, () => part);
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

await step('Voicing 1: akor motorundaki her tür × 12 kök × şekil × konum × renk için çalınabilir voicing (yanlış nota yok, 4 perde aralığı, kök bas)', () => {
  const [res, warns] = noWarn(() => {
    let n = 0, fb = 0, rootless = 0;
    for (const q of Object.keys(Core.CHORD_Q)) for (let r = 0; r < 12; r++) for (const shape of ['full', 'power', 'triad']) for (const position of ['auto', 'open', 'barre']) for (const color of ['none', 'sus2', 'sus4', 'add9']) {
      const v = voice(r, q, { shape, position, color });
      n++;
      assert.ok(v && v.notes.length >= 2, `${r}${q} ${shape} ${position} ${color}: voicing yok`);
      const spec = Core.guitarToneSpec({ root: r, q }, shape, color), pcs = new Set(spec.tones.map((t) => mod12(r + t.iv)));
      if (v.fallback) { fb++; continue; }
      assert.ok(v.notes.every((m) => pcs.has(mod12(m))), `${r}${q} ${shape} ${position} ${color}: akor dışı nota ${fr(v)}`);
      for (const t of spec.tones.filter((x) => x.req)) assert.ok(v.notes.some((m) => mod12(m - r) === mod12(t.iv)), `${r}${q} ${shape} ${color}: zorunlu ses eksik ${fr(v)}`);
      const fret = v.frets.filter((f) => f > 0);
      if (fret.length) assert.ok(Math.max(...fret) - Math.min(...fret) <= 3, 'perde aralığı ' + fr(v));
      if (v.frets.some((f) => f === 0)) assert.ok(Math.max(...fret, 0) <= 4, 'boş tel + yüksek perde ' + fr(v));
      if (position === 'barre') assert.ok(!v.frets.some((f) => f === 0), 'barre: boş tel yok ' + fr(v));
      if (shape !== 'triad' && color === 'none') assert.equal(mod12(v.notes[0]), mod12(r), `${r}${q} ${shape}: kök bas değil ${fr(v)}`);
      else if (shape !== 'triad' && mod12(v.notes[0]) !== mod12(r)) rootless++;
      if (shape === 'triad') assert.deepEqual([v.lo, v.hi], [3, 5], 'triad: üst 3 tel');
      if (shape === 'power') assert.ok(v.notes.length <= 3);
    }
    return { n, fb, rootless };
  });
  return `${res.n} kombinasyon · renkli ${res.rootless} voicing'de kök bas değil (uzantılı akor + sus/add9) · ${res.fb} tanesi temel akora düştü (yalnızca minör + add9 üçlü: ${new Set(warns).size} farklı uyarı)`;
});

await step('Voicing 2: bilinen şekiller (açık C Am G E D Em Dm A Am7 ve kapalı F, Bm); eğik çizgili akor; tuning/capo parametreli', () => {
  const open = { 'C': [0, '', 'x32010'], 'Am': [9, 'm', 'x02210'], 'G': [7, '', '320003'], 'E': [4, '', '022100'], 'D': [2, '', 'xx0232'], 'Em': [4, 'm', '022000'], 'Dm': [2, 'm', 'xx0231'], 'A': [9, '', 'x02220'], 'Am7': [9, 'm7', 'x02010'] };
  for (const [n, [r, q, want]] of Object.entries(open)) assert.equal(fr(voice(r, q, { position: 'open' })), want, n);
  assert.equal(fr(voice(5, '', { position: 'barre' })), '133211', 'F kapalı');
  assert.equal(fr(voice(11, 'm', { position: 'barre' })), 'x24432', 'Bm kapalı');
  const cg = voice(0, '', {}, 7); // C/G
  assert.equal(mod12(cg.notes[0]), 7, 'C/G: bas G');
  // capo 2: açık şekil aynı, perdeler capo'dan sayılır → sesler 2 yarım ses yukarı
  const c0 = voice(0, '', { position: 'open' }), c2 = voice(2, '', { position: 'open', capo: 2 });
  assert.equal(fr(c2), fr(c0), 'D akoru capo 2\'de C şekli');
  assert.deepEqual(c2.midi, c0.midi.map((m) => (m == null ? null : m + 2)), 'sesler capo kadar yukarı');
  // Drop D: D bas teli boş çalınan D akoru
  const dd = voice(2, '', { position: 'open', tuning: 'dropD' });
  assert.equal(dd.midi[0], 38); assert.ok(dd.notes.every((m) => [2, 6, 9].includes(mod12(m))));
});

await step('Voicing 3: akor türü düşüşü tek tabloda; tanınmayan tür sessiz kalmaz ve konsola uyarı yazar', () => {
  assert.equal(Core.guitarBaseQuality('maj7'), ''); assert.equal(Core.guitarBaseQuality('7'), ''); assert.equal(Core.guitarBaseQuality('add9'), '');
  assert.equal(Core.guitarBaseQuality('m7'), 'm'); assert.equal(Core.guitarBaseQuality('dim7'), 'dim'); assert.equal(Core.guitarBaseQuality('aug7'), 'aug');
  assert.equal(Core.guitarBaseQuality('m11'), 'm'); assert.equal(Core.guitarBaseQuality('13'), ''); assert.equal(Core.guitarBaseQuality('7sus4'), 'sus4'); assert.equal(Core.guitarBaseQuality('foo'), '');
  const [v, w] = noWarn(() => ({ a: voice(0, '13', { position: 'open' }), b: voice(9, 'm11b9x'), c: voice(0, 'zzz') }));
  assert.equal(fr(v.a), 'x32010', '13 → majör');
  assert.ok(v.b.notes.length >= 3 && mod12(v.b.notes[0]) === 9 && v.b.notes.every((m) => [9, 0, 4].includes(mod12(m))), 'm11b9x → minör ' + fr(v.b));
  assert.ok(v.c.notes.length >= 3);
  assert.ok(w.some((m) => /"13".*majör/.test(m)) && w.some((m) => /"m11b9x".*"m"/.test(m)), 'konsol uyarısı: ' + w.join(' | '));
  // aynı tür için uyarı tekrarlanmaz
  const [, w2] = noWarn(() => voice(5, '13'));
  assert.equal(w2.length, 0);
  return w.join(' | ');
});

await step('Voicing 4: ardışık akorlar arasında gereksiz konum sıçraması yok (Viterbi + el hareketi maliyeti)', () => {
  const seqs = [[[0, ''], [9, 'm'], [5, ''], [7, '']], [[9, 'm'], [5, ''], [0, ''], [7, '']], [[2, ''], [11, 'm'], [7, ''], [9, '']], [[4, 'm'], [0, ''], [7, ''], [2, '']]];
  for (const position of ['auto', 'open', 'barre']) for (const seq of seqs) {
    const items = seq.map(([r, q]) => ({ chord: { root: r, q } }));
    const vs = Core.guitarVoicings(items, { position });
    const alone = items.map((it) => Core.guitarVoicings([it], { position })[0]);
    const total = (a) => a.reduce((sum, v, i) => sum + v.cost + (i ? Core.guitarMoveCost(a[i - 1], v) : 0), 0);
    assert.ok(total(vs) <= total(alone) + 1e-9, `${position}: ortak seçim (el hareketi dahil) bağımsız seçimden pahalı olamaz`);
    vs.slice(1).forEach((v, i) => assert.ok(Math.abs(v.centroid - vs[i].centroid) <= 5, `${position}: ${fr(vs[i])} → ${fr(v)} sıçrama`));
  }
  const far = [[9, 'm'], [4, ''], [11, 'm'], [6, 'm']].map(([r, q]) => ({ chord: { root: r, q } }));
  const joint = Core.guitarVoicings(far, { position: 'auto' }), sepa = far.map((it) => Core.guitarVoicings([it], { position: 'auto' })[0]);
  const jmp = (a) => a.slice(1).reduce((s, v, i) => s + Math.abs(v.centroid - a[i].centroid), 0);
  return `Am–E–Bm–F#m ortak seçim: ${joint.map(fr).join(' → ')} (konum kayması ${jmp(joint).toFixed(1)}, bağımsız ${jmp(sepa).toFixed(1)})`;
});

await step('Voicing 5: drone — bölüm toniği boş tel olarak akorun altında; bulunamazsa devre dışı ve neden', () => {
  const a = Core.guitarDrone(9);
  assert.deepEqual([a.ok, a.string, a.midi], [true, 1, 45], 'A: 5. tel');
  assert.deepEqual([Core.guitarDrone(4).ok, Core.guitarDrone(4).string], [true, 0], 'E: en kalın tel');
  const eb = Core.guitarDrone(3); assert.equal(eb.ok, false); assert.match(eb.reason, /D#.*boş tel olarak bulunamıyor/);
  const gg = Core.guitarDrone(7); assert.equal(gg.ok, false); assert.match(gg.reason, /yeterli tel kalmıyor/);
  assert.match(Core.guitarDrone(null).reason, /tonu belirlenmedi/);
  assert.equal(Core.guitarDrone(2, 'dropD').string, 0, 'Drop D: D = en kalın tel');
  assert.equal(Core.guitarDrone(2, 'standard', 2).ok, false, 'capo 2 → boş teller yükselir (F# B E A C# F#): D yok');
  // voicing drone telinin üstünde kalır
  const vs = Core.guitarVoicings([[9, 'm'], [5, ''], [0, ''], [7, '']].map(([r, q]) => ({ chord: { root: r, q }, tonic: 9 })), { drone: true });
  for (const v of vs) { assert.ok(v.drone && v.drone.string === 1); for (let s = 0; s <= 1; s++) assert.equal(v.midi[s], null, 'drone teli ve altı akorda çalmaz'); assert.ok(v.notes.length >= 3); }
  // olaylar: her akorun altında letRing drone; adımlar drone telini çalmaz ve susturmaz (palm mute / staccato global olsa bile)
  for (const art of ['normal', 'palmMute', 'staccato']) {
    const p = part0({ articulation: art }); p.voicing.drone = true;
    const e = evs(p);
    const dr = e.filter((x) => x.drone);
    assert.equal(dr.length, 4); dr.forEach((x, i) => { assert.equal(x.midi, 45); assert.equal(x.art, 'letRing'); assert.ok(Math.abs(x.dur - 1) < 1e-9 && Math.abs(x.t - i) < 1e-9, 'drone akor boyunca (1 s)'); });
    assert.ok(e.filter((x) => !x.drone && x.str != null).every((x) => x.str > 1), 'adımlar drone telini çalmaz');
  }
  const noTonic = Core.guitarVoicings([{ chord: { root: 0, q: '' }, tonic: 3 }], { drone: true })[0];
  assert.equal(noTonic.drone, null); assert.match(noTonic.droneInfo.reason, /bulunamıyor/);
  assert.ok(noTonic.notes.length >= 4, 'drone yoksa akor normal çalınır');
});

await step('Olaylar 1: strum + düz 8\'likler; aşağı vuruşta teller bas→tiz, yukarıda tiz→bas (yalnızca ince 3–4 tel), aşağı vuruş daha güçlü', () => {
  const p = part0(); p.humanize = { strumSpreadMs: 20, velocityJitter: 0, timingJitterMs: 0 };
  const e = evs(p);
  const am = e.filter((x) => x.slot === 0 && x.step === 0);
  assert.deepEqual(am.map((x) => x.str), [1, 2, 3, 4, 5], 'bas → tiz');
  assert.ok(am.every((x, i) => i === 0 || x.t > am[i - 1].t) && Math.abs(am[4].t - am[0].t - 0.02) < 1e-9, '20 ms yayılma');
  assert.equal(e.filter((x) => x.slot === 0).length, 8 / 2 * 5 /* Am 2 vuruş = 4 adım × 5 tel */);
  const fk = part0({ pattern: Core.clonePattern(Core.patternById('folk')) }); fk.humanize = p.humanize;
  const ef = evs(fk);
  const up = ef.filter((x) => x.dir === 'U' && x.slot === 0 && x.step === 3), dn = ef.filter((x) => x.dir === 'D' && x.slot === 0 && x.step === 2);
  assert.equal(up.length, 4); assert.deepEqual(up.map((x) => x.str), [5, 4, 3, 2], 'tiz → bas, en ince 4 tel');
  assert.ok(dn.length === 5 && dn[0].vel > up[0].vel, 'D, U\'dan güçlü');
  assert.ok(ef.every((x) => x.t >= 0 && x.dur > 0 && Number.isFinite(x.t)));
});

await step('Olaylar 2: directionMode — allDown\'da hiçbir U çalmaz; alternate\'e dönünce kalıp aynen geri gelir', () => {
  const p = part0({ pattern: Core.clonePattern(Core.patternById('folk')) });
  const a = evs(p);
  assert.ok(a.some((x) => x.dir === 'U'));
  p.directionMode = 'allDown';
  const d = evs(p);
  assert.ok(!d.some((x) => x.dir === 'U'), 'allDown: U yok');
  assert.equal(d.filter((x) => x.step === 3 && x.slot === 0).length, 5, 'U adımı D olarak, tam akor');
  p.directionMode = 'alternate';
  assert.deepEqual(evs(p), a, 'geri dönüşte aynı olaylar');
});

await step('Kalıplar: ölçüye ve vuruş moduna göre filtre; tablo adımları; 3/4 ve 6/8 üretimi', () => {
  const ids = (m, mode) => Core.guitarPatternsFor(m, mode).map((p) => p.id);
  assert.deepEqual(ids('4/4', 'strum'), ['plain8', 'long', 'folk', 'skank', 'funk16', 'gallop', 'dotted', 'bossa']);
  assert.deepEqual(ids('3/4', 'strum'), ['waltz']); assert.deepEqual(ids('6/8', 'strum'), ['six8']);
  assert.ok(!ids('3/4', 'strum').some((i) => ids('4/4', 'strum').includes(i)), '3/4: 4/4 kalıpları yok');
  for (const bad of ['skank', 'gallop', 'funk16', 'dotted', 'long']) assert.ok(!ids('4/4', 'arpeggio').includes(bad), bad + ' arpejde kapalı');
  assert.deepEqual(ids('4/4', 'arpeggio'), ['plain8', 'folk']);
  assert.deepEqual(ids('4/4', 'tremolo'), ids('4/4', 'strum'));
  const stepStr = (id) => Core.patternById(id).steps.map((s) => (s.accent ? '>' : '') + { D: 'D', U: 'U', dead: 'x', rest: '-' }[s.type]).join(' ');
  assert.equal(stepStr('folk'), 'D - D U - U D U'); assert.equal(stepStr('skank'), '- D - D - D - D'); assert.equal(stepStr('long'), 'D - - -');
  assert.equal(stepStr('funk16'), 'D x U x D x U x D x U x D x U x'); assert.equal(stepStr('gallop'), 'D - D D D - D D D - D D D - D D');
  assert.equal(Core.patternById('dotted').steps.map((s, i) => (s.type === 'D' ? i : null)).filter((x) => x != null).join(','), '0,3,6,8,11,14');
  assert.equal(stepStr('waltz'), '>D D D'); assert.equal(stepStr('six8'), 'D - D U D U');
  assert.equal(Core.patternById('skank').steps[1].defaultArticulation, 'staccato'); assert.equal(Core.patternById('long').steps[0].defaultArticulation, 'letRing');
  assert.equal(Core.patternById('plain8').steps.length * 0.5, 4);
  // ölçü değişince seçili kalıp uyumsuzsa ilk uyumlu kalıba geçilir
  const p = part0({ pattern: Core.clonePattern(Core.patternById('gallop')) });
  Core.normalizeGuitarPart(p, '3/4'); assert.equal(p.pattern.id, 'waltz');
  const q = part0(); q.mode = 'arpeggio'; q.pattern = Core.clonePattern(Core.patternById('skank')); Core.normalizeGuitarPart(q, '4/4'); assert.equal(q.pattern.id, 'plain8', 'arpej: skank uyumsuz');
  // 3/4 ve 6/8'de olay üretimi
  const g34 = Core.makeGrid({ bpm: 120, meter: '3/4' }), s34 = [{ q0: 0, q1: 3, chord: { root: 0, q: '' }, section: '_all' }, { q0: 3, q1: 6, chord: { root: 7, q: '' }, section: '_all' }];
  const w = Core.guitarEvents(s34, g34, () => part0({}, '3/4'), {});
  assert.equal(new Set(w.filter((x) => x.slot === 0).map((x) => x.q)).size, 3, 'vals: bar başına 3 vuruş');
  const g68 = Core.makeGrid({ bpm: 60, meter: '6/8' }), s68 = [{ q0: 0, q1: 3, chord: { root: 0, q: '' }, section: '_all' }];
  const e68 = Core.guitarEvents(s68, g68, () => part0({}, '6/8'), {});
  assert.deepEqual([...new Set(e68.map((x) => x.q))], [0, 1, 1.5, 2, 2.5], '6/8: D - D U D U');
});

await step('Nota süresi: normal / letRing / staccato / palmMute / dead; adım ezmesi; tek değerli (letRing + palmMute birlikte olamaz)', () => {
  const p = part0(); p.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const step0 = (e) => e.find((x) => x.slot === 0 && x.step === 0);
  assert.ok(Math.abs(step0(evs(p)).dur - 0.25) < 1e-9, 'normal: sonraki vuruşa kadar');
  // letRing ile normal farkı: folk'ta U vuruşu bas telini çalmaz → letRing bas teli akor değişimine kadar tutar, normal sonraki vuruşta keser
  const fk0 = part0({ pattern: Core.clonePattern(Core.patternById('folk')) }); fk0.humanize = p.humanize;
  const bassDur = (part) => evs(part).find((x) => x.slot === 0 && x.step === 2 && x.str === 1).dur;
  assert.ok(Math.abs(bassDur(fk0) - 0.25) < 1e-9, 'normal: sonraki (U) vuruşta kesilir'); fk0.articulation = 'letRing'; assert.ok(Math.abs(bassDur(fk0) - 0.5) < 1e-9, 'letRing: akor değişimine kadar (1 s − 0.5 s)');
  p.articulation = 'letRing'; assert.ok(Math.abs(step0(evs(p)).dur - 0.25) < 1e-9, 'aynı teli yeniden çalmak sesi keser');
  p.articulation = 'staccato'; assert.ok(Math.abs(step0(evs(p)).dur - 0.4 * 0.25) < 1e-9, 'staccato: adımın %40\'ı');
  p.articulation = 'palmMute'; p.palmMuteAmount = 0.5; const pm = step0(evs(p)); assert.equal(pm.pm, 0.5); assert.ok(pm.dur <= 0.25);
  // adım ezmesi: global ne olursa olsun 2. adım palm mute
  p.articulation = 'letRing'; Core.setStepArticulation(p, 2, 'palmMute');
  const e = evs(p);
  assert.equal(e.find((x) => x.slot === 0 && x.step === 2).art, 'palmMute'); assert.equal(e.find((x) => x.slot === 0 && x.step === 1).art, 'letRing');
  assert.equal(p.stepOverrides[2].articulation, 'palmMute');
  Core.setStepArticulation(p, 2, 'letRing'); assert.equal(p.stepOverrides[2].articulation, 'letRing', 'tek değer: palmMute silinir, ikisi birlikte tutulamaz');
  assert.throws(() => Core.setStepArticulation(p, 2, 'palmMute+letRing'), /bilinmeyen/);
  // kalıbın önerisi: skank staccato; global normal → kalıp önerisi, adım ezmesi her ikisini ezer
  const sk = part0({ pattern: Core.clonePattern(Core.patternById('skank')) });
  assert.ok(evs(sk).filter((x) => x.slot === 0).every((x) => x.art === 'staccato'));
  Core.setStepArticulation(sk, 1, 'normal'); assert.equal(evs(sk).find((x) => x.slot === 0 && x.step === 1).art, 'normal');
  // ölü vuruş: 30–50 ms tonsuz
  const fk = part0({ pattern: Core.clonePattern(Core.patternById('funk16')) });
  const dead = evs(fk).filter((x) => x.kind === 'dead');
  assert.ok(dead.length > 0 && dead.every((x) => x.dur >= 0.03 && x.dur <= 0.05 && x.midi == null && x.str == null));
  assert.equal(dead.filter((x) => x.slot === 0).length, 4, 'funk: 8 adımın 4\'ü ölü vuruş');
});

await step('Swing: yalnızca zayıf (off) konumlar gecikir; 0 → düz; 6/8\'de etkisiz', () => {
  const base = part0(); base.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const t = (e, step, slot = 0) => e.find((x) => x.slot === slot && x.step === step).t;
  const e0 = evs(base), sw = part0(); sw.humanize = base.humanize; sw.swing = 0.6;
  const e1 = evs(sw);
  for (const i of [0, 2]) assert.equal(t(e1, i), t(e0, i), 'ön vuruşlar yerinde');
  for (const i of [1, 3]) assert.ok(Math.abs(t(e1, i) - t(e0, i) - 0.6 * 0.5 / 3 * g44.spq) < 1e-9, 'off: ' + (t(e1, i) - t(e0, i)));
  sw.swing = 1; assert.ok(Math.abs(t(evs(sw), 1) - t(e0, 1) - 0.5 / 3 * g44.spq) < 1e-9, 'swing 1 = üçleme (2:1)');
  const g68 = Core.makeGrid({ bpm: 60, meter: '6/8' }), s68 = [{ q0: 0, q1: 3, chord: { root: 0, q: '' }, section: '_all' }];
  const p68 = part0({}, '6/8'); p68.humanize = base.humanize; const a = Core.guitarEvents(s68, g68, () => p68, {}); p68.swing = 1;
  assert.deepEqual(Core.guitarEvents(s68, g68, () => p68, {}), a);
});

await step('Arpej: yön (up / down / upDown / travis) ve hız (8n / 16n / 8t); maske kalıp; power + arpej geçerli', () => {
  const p = part0(); p.mode = 'arpeggio'; p.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const am = (e) => e.filter((x) => x.slot === 0);
  p.arpeggio = { direction: 'up', rate: '8n' }; const up = am(evs(p));
  assert.deepEqual(up.map((x) => x.str), [1, 2, 3, 4]);
  assert.equal(up.length, 4, 'Am 2 vuruşta 4 sekizlik');
  p.arpeggio.direction = 'down'; assert.deepEqual(am(evs(p)).slice(0, 5).map((x) => x.str), [5, 4, 3, 2]);
  p.arpeggio.direction = 'upDown'; p.arpeggio.rate = '16n'; assert.deepEqual(am(evs(p)).slice(0, 8).map((x) => x.str), [1, 2, 3, 4, 5, 4, 3, 2]);
  p.arpeggio = { direction: 'up', rate: '16n' }; assert.equal(am(evs(p)).length, 8);
  p.arpeggio = { direction: 'up', rate: '8t' }; const tr = am(evs(p)); assert.equal(tr.length, 6); assert.ok(Math.abs(tr[1].q - tr[0].q - 1 / 3) < 1e-9);
  // travis: bas (kök) – ince tel – bas (beşli) – ince tel
  p.arpeggio = { direction: 'travis', rate: '8n' };
  const tv = am(evs(p));
  assert.equal(mod12(tv[0].midi), 9, 'kök bas (A)'); assert.equal(mod12(tv[2].midi), 4, 'beşli bas (E)'); assert.ok(tv[1].midi > tv[0].midi && tv[3].midi > tv[2].midi);
  assert.ok(tv[2].midi < tv[0].midi, 'beşli kökün altından');
  // kalıp maskesi: folk'ta es adımlarında arpej notası çalmaz; skank arpejde yok
  p.arpeggio = { direction: 'up', rate: '8n' }; p.pattern = Core.clonePattern(Core.patternById('folk'));
  assert.deepEqual([...new Set(evs(p).filter((x) => x.slot === 0).map((x) => x.q))], [0, 1, 1.5], 'folk: D - D U - U D U');
  // power + arpej: nota sayısı azalır, hata yok
  p.pattern = Core.clonePattern(Core.patternById('plain8')); p.voicing.shape = 'power';
  const pw = evs(p); assert.ok(pw.length > 0 && pw.filter((x) => x.slot === 0).every((x) => mod12(x.midi) === 9 || mod12(x.midi) === 4));
  assert.ok(new Set(pw.filter((x) => x.slot === 0).map((x) => x.str)).size <= 3);
});

await step('bassChord (boom-chick): bas notası kök ↔ beşli, akor vuruşları bas telsiz; vals ve 6/8\'de bas yerleri', () => {
  const p = part0({ mode: 'bassChord' }); p.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const e = evs(p).filter((x) => x.slot === 0);
  const bass = e.filter((x) => x.vel >= 0.9 && x.str <= 1), chick = e.filter((x) => x.vel < 0.9);
  assert.deepEqual(bass.map((x) => mod12(x.midi)), [9, 4], 'Am: A, E, …');
  assert.ok(chick.length > 0 && chick.every((x) => x.str >= 2), 'chick: bas teli yok');
  // F: kök F, beşli C (altta); G: kök G (3. perde), beşli D (boş D teli)
  const bs = (r, q) => { const s = [{ q0: 0, q1: 4, chord: { root: r, q }, section: '_all' }]; return Core.guitarEvents(s, g44, () => p, {}).filter((x) => x.vel >= 0.9).map((x) => mod12(x.midi)); };
  assert.deepEqual(bs(7, '').slice(0, 4), [7, 2, 7, 2]); assert.deepEqual(bs(0, '').slice(0, 2), [0, 7]);
  // vals: yalnızca 1. vuruş bas
  const g34 = Core.makeGrid({ bpm: 120, meter: '3/4' }), pw = part0({ mode: 'bassChord' }, '3/4'); pw.humanize = p.humanize;
  const ew = Core.guitarEvents([{ q0: 0, q1: 3, chord: { root: 0, q: '' }, section: '_all' }], g34, () => pw, {});
  assert.equal(ew.filter((x) => x.vel >= 0.9).length, 1);
  assert.equal(ew.filter((x) => x.vel < 0.9).length > 4, true);
});

await step('Süslemeler: slideIn/slideOut (60 ms, bir perde), hammerPull (sus ↔ üçlü), vibrato (yalnızca ≥ 1 vuruş)', () => {
  const quiet = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const p = part0(); p.humanize = quiet; p.stepOverrides = { 0: { ornament: 'slideIn' }, 2: { ornament: 'slideOut' } };
  const e = evs(p, [{ q0: 0, q1: 4, chord: { root: 9, q: 'm' }, section: '_all' }]);
  const at = (s) => e.filter((x) => x.step === s && x.kind === 'note');
  assert.ok(at(0).length > 0 && at(0).every((x) => x.slideIn === 0.06) && at(2).every((x) => x.slideOut === 0.06) && at(1).every((x) => !x.slideIn && !x.slideOut));
  // vibrato: kalıp "uzun akor" (tek vuruş, letRing) → ≥ 1 vuruş; staccato'da (< 1 vuruş) uygulanmaz
  const lg = part0({ pattern: Core.clonePattern(Core.patternById('long')) }); lg.humanize = quiet; lg.stepOverrides = { 0: { ornament: 'vibrato' } };
  const vb = evs(lg, [{ q0: 0, q1: 4, chord: { root: 9, q: 'm' }, section: '_all' }]);
  assert.ok(vb.length > 0 && vb.every((x) => x.vib && x.vib.rate >= 5 && x.vib.rate <= 6 && x.vib.depth >= 20 && x.vib.depth <= 30 && x.vib.delay === 0.15 && x.dur >= g44.pulseSec), 'letRing → uzun nota: vibrato');
  Core.setStepArticulation(lg, 0, 'staccato');
  assert.ok(evs(lg, [{ q0: 0, q1: 4, chord: { root: 9, q: 'm' }, section: '_all' }]).every((x) => !x.vib), 'staccato (< 1 vuruş): vibrato uygulanmaz');
  const sh = part0({ articulation: 'letRing' }); sh.humanize = quiet; sh.stepOverrides = { 4: { ornament: 'vibrato' } }; // sonraki vuruş telleri keser → < 1 vuruş
  assert.ok(evs(sh, [{ q0: 0, q1: 4, chord: { root: 9, q: 'm' }, section: '_all' }]).filter((x) => x.step === 4).every((x) => !x.vib), 'sonradan kesilen nota: vibrato düşer');
  // hammerPull: D majör → üçlü (F#) sus4 notasından (G) pull-off
  const hp = part0(); hp.humanize = quiet; hp.stepOverrides = { 0: { ornament: 'hammerPull' } };
  const d = evs(hp, [{ q0: 0, q1: 4, chord: { root: 2, q: '' }, section: '_all' }]).filter((x) => x.step === 0);
  const th = d.filter((x) => x.str === d.find((y) => y.orn).str);
  assert.equal(th.length, 2); assert.equal(th[0].midi, th[1].midi + 1, 'sus4 → üçlü (pull-off)'); assert.ok(th[1].soft && th[1].t > th[0].t);
  assert.equal(mod12(th[1].midi), 6, 'F#');
  // minör: sus2 → üçlü (hammer-on); sus4 akoru: sus4 → majör üçlü
  const dm = evs(hp, [{ q0: 0, q1: 4, chord: { root: 9, q: 'm' }, section: '_all' }]).filter((x) => x.step === 0 && x.orn === 'hammer');
  assert.equal(dm.length, 1); assert.equal(mod12(dm[0].midi), 0, 'Am: üçlü C');
  const ds = evs(hp, [{ q0: 0, q1: 4, chord: { root: 2, q: 'sus4' }, section: '_all' }]).filter((x) => x.step === 0 && x.orn === 'pull');
  assert.equal(ds.length, 1); assert.equal(mod12(ds[0].midi), 6);
  // renk seçiliyken (sus olmayan akorda) hammerPull anlamsız → uygulanmaz
  const hc = clone(hp); hc.voicing.color = 'sus2';
  assert.ok(!evs(hc, [{ q0: 0, q1: 4, chord: { root: 2, q: '' }, section: '_all' }]).some((x) => x.orn));
});

await step('Humanize: deterministik tohumlu sapma; jitter 0 → birebir; U/D ayrımı korunur', () => {
  const p = part0(); p.humanize = { strumSpreadMs: 15, velocityJitter: 0.2, timingJitterMs: 8 };
  const a = evs(p), b = evs(clone(p));
  assert.deepEqual(a, b, 'aynı ayar → aynı olaylar');
  const z = part0(); z.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const ez = evs(z); assert.ok(ez.filter((x) => x.step === 0 && x.slot === 0).every((x) => x.t === 0));
  assert.ok(new Set(a.filter((x) => x.step === 1).map((x) => x.vel.toFixed(3))).size > 1, 'hız sapması');
  assert.ok(a.some((x) => Math.abs(x.t - x.q * g44.spq) > 0.002), 'zamanlama sapması');
});

await step('Sentez 1: Karplus-Strong perde doğruluğu (±6 cent), sönüm, deterministik; palm mute ve ölü vuruş', () => {
  const sr = 44100;
  const f0 = (x) => { // otokorelasyon tepesi + parabolik ara değer
    const a = 1500, L = 8192; let best = -1, bl = 0; const r = [];
    for (let l = 30; l < 1600; l++) { let s = 0; for (let i = 0; i < L; i++) s += x[a + i] * x[a + i + l]; r[l] = s; if (s > best) { best = s; bl = l; } }
    const d = (r[bl - 1] - r[bl + 1]) / (2 * (r[bl - 1] - 2 * r[bl] + r[bl + 1]));
    return sr / (bl + d);
  };
  for (const m of [40, 45, 52, 57, 64, 69, 76]) {
    const hz = 440 * 2 ** ((m - 69) / 12), est = f0(Core.ksPluck(m, sr));
    assert.ok(Math.abs(1200 * Math.log2(est / hz)) < 6, `midi ${m}: ${(1200 * Math.log2(est / hz)).toFixed(1)} cent`);
  }
  const lo = Core.ksPluck(40, sr), hi = Core.ksPluck(76, sr);
  assert.ok(lo.length > hi.length, 'kalın tel daha uzun sürer'); assert.ok(rms(lo, 0, 4410) > rms(lo, 44100, 48510), 'sönümlenir');
  assert.equal(Core.ksPluck(52, sr), Core.ksPluck(52, sr), 'önbellek'); assert.ok(peak(lo) > 0.05 && peak(lo) <= 1.0 && lo.every(Number.isFinite));
  const note = (over) => ({ kind: 'note', t: 0.1, dur: 1, midi: 52, str: 2, vel: 0.9, ...over });
  const L = sr * 2, spq = 0.5;
  const plain = Core.renderGuitar([note({})], sr, L, spq), pmEv = Core.renderGuitar([note({ pm: 0.8 })], sr, L, spq);
  const a = Math.round(0.45 * sr), b = Math.round(0.55 * sr);
  assert.ok(rms(pmEv, a, b) < 0.1 * rms(plain, a, b), `palm mute çabuk söner: ${rms(pmEv, a, b)} vs ${rms(plain, a, b)}`);
  assert.ok(rms(Core.renderGuitar([note({ pm: 1 })], sr, L, spq), 4410, 8000) > 0 && rms(Core.renderGuitar([note({ pm: 0 })], sr, L, spq), 4410, 8000) > 0, 'palm mute duyulur');
  // ölü vuruş: tonsuz, ≤ 50 ms
  const dead = Core.renderGuitar([{ kind: 'dead', t: 0.1, dur: 0.04, vel: 0.8, midi: null }], sr, L, spq);
  const last = (() => { for (let i = dead.length - 1; i >= 0; i--) if (Math.abs(dead[i]) > 1e-3) return i; return 0; })();
  assert.ok(peak(dead) > 0.01 && (last / sr - 0.1) <= 0.05, 'ölü vuruş ≤ 50 ms: ' + (last / sr - 0.1));
  // staccato: kesilen nota sonrası sessizlik; letRing sürer
  const st = Core.renderGuitar([note({ dur: 0.1 })], sr, L, spq), lr = Core.renderGuitar([note({ dur: 1.4 })], sr, L, spq);
  assert.ok(rms(st, Math.round(0.45 * sr), Math.round(0.55 * sr)) < 0.02 * rms(lr, Math.round(0.45 * sr), Math.round(0.55 * sr)));
  return `perde ±6 cent · palm mute 0.45–0.55 s: ${(rms(pmEv, a, b) / rms(plain, a, b)).toFixed(3)} · ölü vuruş ${((last / sr - 0.1) * 1000).toFixed(0)} ms`;
});

await step('Sentez 2: kayma (60 ms, bir perde aşağıdan), vibrato (5–6 Hz), hammer-on soft atak', () => {
  const sr = 44100, L = sr * 2, spq = 0.5;
  const f0 = (x, t, len = 1400) => { // kısa pencerede otokorelasyon + parabolik ara değer
    const a = Math.round(t * sr); let best = -1, bl = 0; const r = [];
    for (let l = 150; l < 420; l++) { let s = 0; for (let i = 0; i < len; i++) s += x[a + i] * x[a + i + l]; r[l] = s; if (s > best) { best = s; bl = l; } }
    return sr / (bl + (r[bl - 1] - r[bl + 1]) / (2 * (r[bl - 1] - 2 * r[bl] + r[bl + 1])));
  };
  const cents = (a, b) => 1200 * Math.log2(a / b);
  const base = { kind: 'note', t: 0, dur: 1.2, midi: 52, str: 2, vel: 0.9 };
  const plain = Core.renderGuitar([base], sr, L, spq), sl = Core.renderGuitar([Object.assign({}, base, { slideIn: 0.06 })], sr, L, spq);
  assert.ok(cents(f0(sl, 0), f0(plain, 0)) < -40, `slideIn başta bir perdeye yakın aşağıda: ${cents(f0(sl, 0), f0(plain, 0)).toFixed(0)} cent`);
  assert.ok(Math.abs(cents(f0(sl, 0.3), f0(plain, 0.3))) < 8, 'sonra hedef perde');
  const out = Core.renderGuitar([Object.assign({}, base, { dur: 0.5, slideOut: 0.06 })], sr, L, spq);
  assert.ok(cents(f0(out, 0.46), f0(plain, 0.46)) < -40, 'slideOut: sonda perde düşer');
  const vb = Core.renderGuitar([Object.assign({}, base, { vib: { rate: 5.5, depth: 25, delay: 0.15 } })], sr, L, spq);
  const ts = Array.from({ length: 14 }, (_, i) => 0.3 + i * 0.03);
  const dev = (x) => { const c = ts.map((t) => cents(f0(x, t, 1100), 164.81)); const m = c.reduce((s, v) => s + v, 0) / c.length; return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / c.length); };
  assert.ok(dev(vb) > 2 * dev(plain) + 4, `vibrato: perde salınır (σ ${dev(vb).toFixed(1)} cent vs ${dev(plain).toFixed(1)})`);
  const soft = Core.renderGuitar([Object.assign({}, base, { soft: true })], sr, L, spq);
  assert.ok(peak(soft.subarray(0, 100)) < 0.3 * peak(plain.subarray(0, 100)) + 1e-9, 'soft: yumuşak atak');
});

await step('Ton / FX: clean < crunch < drive doygunluğu; chorus, delay (tempo senkron), reverb kuyruğu; ayar bazlı gruplama', () => {
  const sr = 44100, L = sr * 3, spq = 0.5;
  const ev = [45, 52, 57].map((m, i) => ({ kind: 'note', t: 0.1, dur: 0.1, midi: m, str: i + 1, vel: 0.9 }));
  const withFx = (tone, fx) => { const e = ev.map((x) => Object.assign({ fxk: 'k' }, x)); e.fxTable = { k: { tone, fx } }; return Core.renderGuitar(e, sr, L, spq); };
  const off = { chorus: 0, delay: { mix: 0, time: '8n', feedback: 0.3 }, reverb: 0 };
  const clean = withFx('clean', off), crunch = withFx('crunch', off), drive = withFx('drive', off);
  const crest = (x) => peak(x) / rms(x, 0, 30000);
  assert.ok(crest(drive) < crest(crunch) && crest(crunch) < crest(clean), `tepe/RMS: ${crest(clean).toFixed(2)} > ${crest(crunch).toFixed(2)} > ${crest(drive).toFixed(2)}`);
  const lvl = (x) => rms(x, Math.round(0.12 * sr), Math.round(0.28 * sr));
  assert.ok(lvl(drive) < 2.5 * lvl(clean) && lvl(drive) > 0.4 * lvl(clean), 'seviye dengeli');
  const dist = (x, y) => { let d = 0, e = 0; for (let i = 0; i < 20000; i++) { d += (x[i] - y[i]) ** 2; e += x[i] ** 2; } return d / e; };
  assert.ok(dist(clean, crunch) > 0.05 && dist(crunch, drive) > 0.05, 'üç ton birbirinden farklı çalar');
  const del = withFx('clean', { chorus: 0, delay: { mix: 0.6, time: '8n', feedback: 0.4 }, reverb: 0 });
  const echoAt = Math.round((0.1 + 0.5 * spq + 0.02) * sr); // 8n = çeyreğin yarısı = 0.25 s sonra
  assert.ok(rms(del, echoAt, echoAt + 4000) > 5 * rms(clean, echoAt, echoAt + 4000) + 1e-4, '8n: yankı 0.25 s sonra');
  const d8 = withFx('clean', { chorus: 0, delay: { mix: 0.6, time: 'd8n', feedback: 0 }, reverb: 0 });
  assert.ok(rms(d8, Math.round(0.5 * sr), Math.round(0.56 * sr)) > 5 * rms(d8, Math.round(0.33 * sr), Math.round(0.39 * sr)), 'noktalı 8n: 0.375 s sonra, 0.25 s\'de yok');
  const d4 = withFx('clean', { chorus: 0, delay: { mix: 0.6, time: '4n', feedback: 0 }, reverb: 0 });
  assert.ok(rms(d4, Math.round(0.62 * sr), Math.round(0.68 * sr)) > 5 * rms(d4, Math.round(0.33 * sr), Math.round(0.39 * sr)), '4n: 0.5 s sonra');
  const rev = withFx('clean', { chorus: 0, delay: { mix: 0, time: '8n', feedback: 0 }, reverb: 0.8 });
  assert.ok(rms(rev, Math.round(0.9 * sr), Math.round(1.2 * sr)) > rms(clean, Math.round(0.9 * sr), Math.round(1.2 * sr)), 'reverb kuyruğu');
  const cho = withFx('clean', { chorus: 0.8, delay: { mix: 0, time: '8n', feedback: 0 }, reverb: 0 });
  let diff = 0; for (let i = 0; i < 20000; i++) diff += Math.abs(cho[i] - clean[i]); assert.ok(diff > 1, 'chorus dalga biçimini değiştirir');
  // farklı ton ayarlı iki parti: gruplar ayrı işlenir ve toplanır
  const a = ev.map((x) => Object.assign({ fxk: 'a' }, x)), b = ev.map((x) => Object.assign({}, x, { fxk: 'b', t: 1.5 }));
  const both = a.concat(b); both.fxTable = { a: { tone: 'clean', fx: off }, b: { tone: 'drive', fx: off } };
  const mix = Core.renderGuitar(both, sr, L, spq);
  assert.ok(rms(mix, Math.round(0.12 * sr), Math.round(0.28 * sr)) > 0 && rms(mix, Math.round(1.52 * sr), Math.round(1.68 * sr)) > 0);
});

await step('Preset: kaydedilip yeniden yüklenince aynı olaylar ve aynı ses; eski proje dosyaları varsayılanla tamamlanır', () => {
  const p = part0({ mode: 'bassChord', swing: 0.3, tone: 'crunch', articulation: 'palmMute' });
  p.pattern = Core.clonePattern(Core.patternById('folk')); p.voicing = { position: 'open', shape: 'full', color: 'sus4', drone: true, capo: 0, tuning: 'standard' };
  p.fx = { chorus: 0.3, delay: { mix: 0.25, time: 'd8n', feedback: 0.4 }, reverb: 0.3 }; p.stepOverrides = { 2: { articulation: 'staccato', ornament: 'slideIn' } };
  const reloaded = JSON.parse(JSON.stringify({ name: 'Benim', part: p })).part;
  const sr = 22050;
  const render = (part) => { const e = evs(part); return Core.renderGuitar(e, sr, sr * 9, g44.spq); };
  const a = render(p), b = render(reloaded);
  assert.deepEqual(evs(p), evs(reloaded)); assert.equal(a.length, b.length); let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; } assert.ok(same, 'aynı örnekler');
  assert.ok(peak(a) > 0.05);
  const st = Core.normalizeGuitarState({ instrument: 'both', parts: { _all: { mode: 'arpeggio' } } }, '4/4');
  assert.equal(st.instrument, 'both'); assert.equal(st.parts._all.mode, 'arpeggio'); assert.equal(st.parts._all.pattern.id, 'plain8'); assert.equal(st.parts._all.fx.delay.time, '8n'); assert.deepEqual(st.presets, []);
  assert.equal(Core.normalizeGuitarState(null, '3/4').parts._all.pattern.id, 'waltz'); assert.equal(Core.normalizeGuitarState({ instrument: 'x' }, '4/4').instrument, 'piano');
});

await step('Akor değişince parti o akora göre yeniden üretilir; bölüm bazlı parti; akor dilimleri akor zaman çizelgesinden', () => {
  const p = part0(); p.humanize = { strumSpreadMs: 0, velocityJitter: 0, timingJitterMs: 0 };
  const e1 = evs(p), alt = clone(amFCG); alt[1].chord = { root: 7, q: '7' };
  const e2 = evs(p, alt);
  const pcsOf = (e, slot) => new Set(e.filter((x) => x.slot === slot).map((x) => mod12(x.midi)));
  assert.ok([...pcsOf(e2, 0)].every((x) => [9, 0, 4].includes(x)) && [...pcsOf(e2, 3)].every((x) => [7, 11, 2].includes(x)), 'komşu akorlar kendi seslerinde');
  const cur = e2.filter((x) => x.slot === 1).map((x) => mod12(x.midi));
  assert.ok(cur.includes(7) && cur.includes(5), 'G7: kök ve 7\'li'); assert.ok(!e1.filter((x) => x.slot === 1).some((x) => mod12(x.midi) === 7), 'önceki F akorunda G yok');
  // bölüm başına farklı parti
  const verse = part0(), chorus = part0({ mode: 'arpeggio' });
  const slots = [{ q0: 0, q1: 4, chord: { root: 0, q: '' }, section: 'v', tonic: 0 }, { q0: 4, q1: 8, chord: { root: 7, q: '' }, section: 'c', tonic: 7 }];
  const e = Core.guitarEvents(slots, g44, (sl) => (sl.section === 'v' ? verse : chorus), {});
  assert.equal(e.filter((x) => x.slot === 0).length, 8 * 5, 'verse: strum'); assert.equal(e.filter((x) => x.slot === 1).length, 8, 'chorus: arpej, 8 sekizlik tek nota');
  const d = { sections: [{ id: 'v', tonic: 2 }], chords: [{ q0: 0, q1: 4, chord: { root: 2, q: '' }, section: 'v', bar: 1 }] };
  assert.deepEqual(Core.guitarSlotsFrom(d), [{ q0: 0, q1: 4, chord: { root: 2, q: '' }, section: 'v', tonic: 2 }]);
});

console.log(results.join('\n'));
if (failures) { console.log(`\n${failures} adım başarısız`); process.exit(1); }
console.log('\nGitar testleri geçti.');

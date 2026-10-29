// Bas groove motoru: türe, davulun kick'ine, akor izine ve vokal melodisine bağlı rastgelesiz bas hattı.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core: C } = loadCore(), B = C.Bass, G = B.Groove;
const PROG = [[9, 'm'], [5, ''], [0, ''], [7, '']]; // Am F C G
const mod = (x) => ((x % 12) + 12) % 12;
const LAYOUT = [['intro', 4], ['verse', 8], ['prechorus', 4], ['chorus', 8], ['bridge', 4], ['outro', 4]];

// packId verilirse paket uygulanır (bas, matris ve davul paketten); melody: (bar, g) → [{q0,q1,effMidi}]
function song({ meter = '4/4', pack = null, bpm = 110, melody = null, chords = null, layout = LAYOUT } = {}) {
  const p = C.newProject(); p.settings.meter = meter; p.settings.bpm = bpm;
  p.guitar = C.defaultGuitarState(meter); p.guitar.instrument = 'both'; p.bass.enabled = true;
  let at = 1;
  p.sections = layout.map(([type, n], i) => { const s = { id: 's' + i, name: type, type, startBar: at, endBar: at + n - 1, tonic: 9, mode: 'minor' }; at += n; return s; });
  const bars = at - 1, g = C.makeGrid({ bpm, meter });
  const secs = p.sections.map((s) => ({ ...s, typeNorm: C.normSectionType(s.type), confirmed: true, pcs: C.scalePcs(9, 'minor') }));
  const slots = [];
  for (let b = 1; b <= bars; b++) {
    const list = chords ? chords(b) : [PROG[(b - 1) % 4]];
    list.forEach(([root, q], k) => slots.push({ bar: b, q0: (b - 1) * g.barQ + (k * g.barQ) / list.length, q1: (b - 1) * g.barQ + ((k + 1) * g.barQ) / list.length, chord: { root, q, bass: null }, section: secs.find((s) => b >= s.startBar && b <= s.endBar).id }));
  }
  const notes = [];
  for (let b = 1; b <= bars; b++) notes.push(...(melody ? melody(b, g) : [{ q0: (b - 1) * g.barQ, q1: b * g.barQ, effMidi: 69 }]));
  const d = { g, bars, sections: secs, chords: slots, notes };
  if (pack) C.applyPack(p, d, pack);
  return { p, d, g, bars, ctx: () => B.bassContext(d, p) };
}
const stepsOfNote = (n) => Math.round(n.startBeat / B.STEP_Q);
const bySection = (s, type) => s.p.sections.filter((x) => x.type === type);
const barRange = (sec) => Array.from({ length: sec.endBar - sec.startBar + 1 }, (_, k) => sec.startBar - 1 + k);
let failures = 0;
const results = [];
function step(name, fn) {
  try { const info = fn(); results.push(`✔ ${name}${info ? '\n    ' + info : ''}`); }
  catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}

step('Motor seçimi: varsayılan iz groove; 2/4, öğrenilmiş profil ve karışım eski motorda kalır', () => {
  const s = song();
  const t = B.defaultBassTrack(); assert.equal(t.engine, 'groove'); assert.equal(t.feelId, null);
  assert.equal(G.active(t, s.ctx()), true);
  assert.equal(G.active({ ...t, engine: 'legacy' }, s.ctx()), false);
  assert.equal(G.active({ ...t, styleProfileId: 'benim-profilim' }, s.ctx()), false, 'öğrenilmiş profil eski motorda');
  assert.equal(G.active({ ...t, styleMix: { profileB: 'darkwave-pulse', amount: 0.5 } }, s.ctx()), false);
  assert.equal(G.active({ ...t, styleProfileId: null }, s.ctx()), true, 'paketin profilsiz izi groove');
  const two = song({ meter: '2/4' }); assert.equal(G.active(t, two.ctx()), false);
  // 4/4 dışındaki ölçüler ölçüye uygun türle çalar
  assert.equal(G.feelFor(t, song({ meter: '3/4' }).ctx()).id, 'vals');
  assert.equal(G.feelFor(t, song({ meter: '6/8' }).ctx()).id, 'balad-68');
});

step('Desen verisi: 16 türün bütün adayları var, uzunluklar ölçüye uyar, ilk nota 1. adımda ya da offbeat', () => {
  for (const [meter, steps] of [['4/4', 16], ['3/4', 12], ['6/8', 12]]) for (const [name, def] of Object.entries(G.BANK[meter])) {
    assert.equal(def.p.length, steps, `${meter} ${name}`);
    assert.ok(/^[R58_3.]+$/.test(def.p), `${meter} ${name}`);
    assert.ok(G.parsePattern(meter, name).onsets.length >= 1);
  }
  for (const [id, f] of Object.entries(G.FEELS)) for (const band of ['low', 'mid', 'high']) {
    assert.ok(f.bands[band].length, `${id} ${band}`);
    for (const n of f.bands[band]) assert.ok(G.BANK[f.meter][n], `${id}/${band}: ${n} yok`);
  }
  assert.deepEqual(C.PACKS.map((p) => p.id).sort(), Object.keys(G.FEELS).sort(), 'her paketin bir türü var');
});

step('Her tür her paket için: akorlu bütün ölçülerde nota var, kayıt aralığında, kökler akor köküne oturur', () => {
  let total = 0;
  for (const pack of C.PACKS) {
    const s = song({ meter: pack.meters[0], pack: pack.id, bpm: pack.bpm[0] + 5 }), t = s.p.bass;
    assert.equal(t.engine, 'groove'); assert.equal(t.feelId, pack.id);
    t.bars.forEach((b, i) => {
      assert.ok(b.notes.length >= 1, `${pack.id} ölçü ${i + 1} boş`);
      assert.ok(b.templateId.startsWith(`groove:${pack.id}:`), `${pack.id} ${b.templateId}`);
      for (const n of b.notes) { assert.ok(n.midi >= t.range.low && n.midi <= t.range.high, `${pack.id} aralık dışı`); total++; }
      const first = b.notes[0], chordRoot = PROG[i % 4][0];
      if (stepsOfNote(first) === 0) assert.equal(mod(first.midi), chordRoot, `${pack.id} ölçü ${i + 1}: 1. vuruş kök`);
    });
  }
  return `${total} nota`;
});

step('Aynı girdi aynı hat: ölçü ölçü birebir; aynı bölümde aynı akor tekrarı özdeş (zar yok)', () => {
  for (const pack of ['pop-rock', 'synthwave', 'post-punk', 'dream-pop', 'dans-elektronik']) {
    const a = song({ pack }), b = song({ pack });
    assert.equal(JSON.stringify(a.p.bass.bars.map((x) => x.notes)), JSON.stringify(b.p.bass.bars.map((x) => x.notes)), pack);
    const verse = barRange(bySection(a, 'verse')[0]);
    // 8 ölçülük kıta: akor döngüsü 4 ölçü; ilk 4 ölçü = sonraki 4 ölçü (cümle sonu öncülü hariç aynı)
    const shape = (bar) => JSON.stringify(bar.notes.map((n) => [n.startBeat, n.durationBeats, n.midi, n.role])); // velocity insan titremesi tohumlu, perde / ritim sabit
    for (let k = 0; k < 3; k++) assert.equal(shape(a.p.bass.bars[verse[k]]), shape(a.p.bass.bars[verse[k + 4]]), `${pack} kıta ${k + 1}`);
    // zar atma tohumu: tohum değişse de groove hattı değişmez (rastgelelik yok)
    const c = song({ pack }); c.p.bass.seed = 99; B.bassGenerateAll(c.p.bass, c.ctx());
    assert.equal(JSON.stringify(a.p.bass.bars.map((x) => x.notes.map((n) => [n.startBeat, n.durationBeats, n.midi]))), JSON.stringify(c.p.bass.bars.map((x) => x.notes.map((n) => [n.startBeat, n.durationBeats, n.midi]))), `${pack} tohum`);
  }
});

step('Kick kilidi: çalan loop\'un her kick adımında bas vuruşu var (kilitli desenler; sürekli ve offbeat aileler hariç)', () => {
  let checked = 0;
  for (const pack of C.PACKS.filter((p) => p.meters[0] === '4/4')) {
    const s = song({ pack: pack.id, bpm: pack.bpm[0] + 5 }), ctx = s.ctx();
    s.p.bass.bars.forEach((b, i) => {
      const K = ctx.kicks(i); if (!K || !K.length) return;
      const name = b.templateId.split(':')[2], pat = G.BANK['4/4'][name];
      if (pat.sus || pat.dodge) return;
      const sec = ctx.secOf(i), band = s.p.bass.sections[sec.id];
      const onsets = new Set(b.notes.map(stepsOfNote));
      const missing = K.filter((k) => !onsets.has(k));
      // en çok 3 kick eklenir; geri kalan kaçan kick yoksa tamamı örtülür
      if (K.filter((k) => !G.parsePattern('4/4', name).onsets.some((o) => o.step === k)).length <= 3) assert.deepEqual(missing, [], `${pack.id} ölçü ${i + 1} ${name} kick ${K} bas ${[...onsets]}`);
      checked++;
      void band;
    });
  }
  assert.ok(checked > 100); return `${checked} ölçü`;
});

step('Dört vuruşta kick (four-on-the-floor): synthpop / dans offbeat çalar, kick\'le üst üste binmez', () => {
  for (const pack of ['synthpop', 'dans-elektronik']) {
    const s = song({ pack }), ctx = s.ctx();
    let offbeat = 0;
    s.p.bass.bars.forEach((b, i) => {
      const K = ctx.kicks(i); if (!K || K.length < 4 || !b.templateId.endsWith(':off')) return;
      offbeat++;
      for (const n of b.notes) assert.ok(!K.includes(stepsOfNote(n)), `${pack} ölçü ${i + 1}: bas kick'e denk geldi (${stepsOfNote(n)})`);
    });
    assert.ok(offbeat >= 4, `${pack}: offbeat ölçü yok`);
  }
});

step('Davul yoksa (matris) bas kendi ritmini taşır; kick sızması yok', () => {
  const s = song({ pack: 'pop-rock' }), ctx = s.ctx();
  const verse = bySection(s, 'verse')[0];
  for (const i of barRange(verse)) assert.equal(ctx.kicks(i), null, 'kıtada davul susar');
  for (const i of barRange(verse)) assert.ok(s.p.bass.bars[i].notes.length >= 2);
  s.p.drums.on = false;
  for (let i = 0; i < s.bars; i++) assert.equal(ctx.kicks(i), null);
});

step('Türler birbirinden ayrışır: her tür kendi desen ailesini çalar; aynı şarkıda en az 10 farklı desen kümesi', () => {
  const sets = new Map();
  for (const pack of C.PACKS.filter((p) => p.meters[0] === '4/4')) {
    const s = song({ pack: pack.id, bpm: pack.bpm[0] + 5 });
    sets.set(pack.id, [...new Set(s.p.bass.bars.map((b) => b.templateId.split(':')[2]))].sort().join(','));
  }
  assert.ok(new Set(sets.values()).size >= 10, [...sets].map(([k, v]) => `${k}=${v}`).join(' | '));
  // sürekli (sus) aileler: dream-pop, balad, akustik hiç 8'lik koşu çalmaz
  for (const id of ['dream-pop', 'balad', 'akustik']) assert.ok(!/e8|s16|acid|off/.test(sets.get(id)), `${id}: ${sets.get(id)}`);
  // dans / synthwave tarafı sürekli kıta değil, hareketli
  assert.ok(/off|s16|acid|arp/.test(sets.get('dans-elektronik')), sets.get('dans-elektronik'));
  return [...sets].map(([k, v]) => `${k}=${v}`).join(' | ');
});

step('Şarkı dinamiği: her türde nakarat kıtadan seyrek değildir, giriş / köprü kıtadan yoğun değildir', () => {
  for (const pack of C.PACKS.filter((p) => p.meters[0] === '4/4')) {
    const s = song({ pack: pack.id, bpm: pack.bpm[0] + 5 });
    const density = (type) => { const sec = bySection(s, type)[0]; return barRange(sec).reduce((a, i) => a + G.parsePattern('4/4', s.p.bass.bars[i].templateId.split(':')[2]).onsets.length, 0) / barRange(sec).length; }; // desenin vuruş sayısı (öncül / kick eklemeleri hariç)
    assert.ok(density('chorus') >= density('verse') - 1e-9, `${pack.id}: nakarat ${density('chorus')} < kıta ${density('verse')}`);
    assert.ok(density('intro') <= density('verse') + 1e-9, `${pack.id}: giriş ${density('intro')} > kıta ${density('verse')}`);
    assert.ok(density('bridge') <= density('chorus') + 1e-9, `${pack.id}: köprü nakaratı geçti`);
  }
});

step('Akor değişimi: ölçü ortasında akor değişince yeni akorun kökü o adımda çalar; akor sürekliyse nota yeni akora geçer', () => {
  const s = song({ pack: 'pop-rock', chords: (b) => (b % 2 ? [[9, 'm'], [5, '']] : [[0, ''], [7, '']]) });
  s.p.bass.bars.forEach((b, i) => {
    const two = i % 2 ? [0, 7] : [9, 5];
    for (const n of b.notes) {
      const pc = mod(n.midi), st = stepsOfNote(n), want = st < 8 ? two[0] : two[1];
      if (n.role === 'root') assert.equal(pc, want, `ölçü ${i + 1} adım ${st}`);
    }
    const at8 = b.notes.find((n) => stepsOfNote(n) === 8);
    assert.ok(at8 && mod(at8.midi) === two[1], `ölçü ${i + 1}: 3. vuruşta yeni akor`);
    for (const n of b.notes) assert.ok(n.startBeat + n.durationBeats <= s.g.barQ + 1e-9);
  });
});

step('Cümle sonu öncülü: yalnızca 4. ölçüde (ya da bölüm sonunda), akor değişiyorsa ve sürekli tür değilse', () => {
  const s = song({ pack: 'indie-rock' });
  const verse = bySection(s, 'verse')[0], rows = barRange(verse);
  rows.forEach((i, k) => {
    const approach = s.p.bass.bars[i].notes.some((n) => n.role === 'approach' || n.role === 'chromatic');
    assert.equal(approach, k % 4 === 3, `kıta ölçü ${k + 1} öncül ${approach}`);
  });
  for (const id of ['dream-pop', 'balad', 'akustik']) {
    const d = song({ pack: id });
    for (const i of barRange(bySection(d, 'verse')[0])) assert.ok(!d.p.bass.bars[i].notes.some((n) => n.role === 'approach' || n.role === 'chromatic'), `${id} ölçü ${i + 1}`);
  }
});

step('Vokal melodisi: yarım ton çakışan beşli, çakışmayan akor sesiyle değişir; melodisiz aynı yerde beşli kalır', () => {
  const at = (q0, q1, effMidi) => ({ q0, q1, effMidi });
  // Am: beşli E (4). Melodi 3. vuruşun 4. 8'liğinde F (5) → E-F yarım ton. Nakaratın 12. adımında beşli çalar (e8-5).
  const withMelody = song({ pack: 'indie-rock', melody: (b, g) => [at((b - 1) * g.barQ, (b - 1) * g.barQ + 2.9, 69), at((b - 1) * g.barQ + 2.9, b * g.barQ, [65, 65, 59, 65][(b - 1) % 4])] });
  const plain = song({ pack: 'indie-rock' });
  const chorus = barRange(bySection(plain, 'chorus')[0]);
  const fifthAt12 = (s, i) => s.p.bass.bars[i].notes.filter((n) => stepsOfNote(n) === 12 && n.role === 'fifth').length;
  assert.ok(chorus.reduce((a, i) => a + fifthAt12(plain, i), 0) >= 6, 'melodisiz nakaratta 4. vuruşta beşli çalıyor');
  const ctx = withMelody.ctx();
  for (const i of chorus) {
    const n = withMelody.p.bass.bars[i].notes.find((x) => stepsOfNote(x) === 12);
    const mel = ctx.melodyPc(i * withMelody.g.barQ + 3);
    const ic = mod(n.midi - mel);
    assert.ok(ic !== 1 && ic !== 11, `ölçü ${i + 1}: bas ${mod(n.midi)} melodi ${mel} yarım ton`);
  }
  assert.ok(chorus.some((i) => fifthAt12(withMelody, i) < fifthAt12(plain, i)), 'en az bir ölçüde beşli değişti');
});

step('Melodi yoğunsa (10+ nota / ölçü) bas sadeleşir: 8\'den fazla vuruşlu desen elenir', () => {
  const busy = (b, g) => Array.from({ length: 12 }, (_, k) => ({ q0: (b - 1) * g.barQ + k * g.barQ / 12, q1: (b - 1) * g.barQ + (k + 1) * g.barQ / 12, effMidi: 69 }));
  const calm = song({ pack: 'dans-elektronik' }), crowded = song({ pack: 'dans-elektronik', melody: busy });
  const chorusDensity = (s) => { const sec = bySection(s, 'chorus')[0]; return barRange(sec).reduce((a, i) => a + s.p.bass.bars[i].notes.length, 0); };
  assert.ok(chorusDensity(crowded) < chorusDensity(calm), `${chorusDensity(crowded)} < ${chorusDensity(calm)}`);
});

step('Davul değişince bas yeniden hesaplanır: loop kick\'leri imzaya girer, bassSync kirli ölçüleri yeniler', () => {
  const s = song({ pack: 'pop-rock' }), ctx0 = s.ctx();
  const chorusBar = barRange(bySection(s, 'prechorus')[0])[0]; // tek nakarat "son nakarat" sayılır ve alt loop çalar; global loop pre-nakaratta
  assert.equal(B.bassSync(s.p.bass, ctx0).regenerated.length, 0, 'paket uygulandıktan sonra bas zaten güncel');
  const before = JSON.stringify(s.p.bass.bars[chorusBar].notes), name = s.p.bass.bars[chorusBar].templateId;
  s.p.drums.loop = 'four'; // her vuruşta kick
  for (const sec of s.p.sections) if (sec.arr) delete sec.arr.drums;
  const r = B.bassSync(s.p.bass, s.ctx());
  assert.ok(r.regenerated.includes(chorusBar), 'pre-nakarat ölçüleri yenilendi');
  assert.ok(s.p.bass.bars[chorusBar].sig.includes('0.4.8.12'), 'imza yeni kick\'leri taşır'); // sekizlik desen iki loop\'ta da uyar: notalar aynı kalabilir
  void before; void name;
  const K = s.ctx().kicks(chorusBar);
  assert.deepEqual(K, [0, 4, 8, 12]);
  assert.equal(B.bassSync(s.p.bass, s.ctx()).regenerated.length, 0, 'ikinci eşitleme sessiz');
});

step('Kilitli ölçü davul değişse de korunur ve işaretlenir', () => {
  const s = song({ pack: 'pop-rock' }), i = barRange(bySection(s, 'prechorus')[0])[1];
  B.bassLock(s.p.bass, i, true);
  const keep = JSON.stringify(s.p.bass.bars[i].notes);
  s.p.drums.loop = 'four'; for (const sec of s.p.sections) if (sec.arr) delete sec.arr.drums;
  const r = B.bassSync(s.p.bass, s.ctx());
  assert.equal(JSON.stringify(s.p.bass.bars[i].notes), keep); assert.ok(r.flagged.includes(i));
});

step('Zar ve yoğunluk: yeniden üret aday desenler arasında döner (aynı ölçüde farklı ama türe uygun); yoğunlaştır bir kova yukarı', () => {
  const s = song({ pack: 'pop-rock' }), i = barRange(bySection(s, 'prechorus')[0])[0], t = s.p.bass, ctx = s.ctx();
  const seen = new Set([t.bars[i].templateId]);
  for (let k = 0; k < 4; k++) { assert.equal(B.bassReroll(t, ctx, i), true); seen.add(t.bars[i].templateId); assert.ok(t.bars[i].templateId.startsWith('groove:pop-rock:')); }
  assert.ok(seen.size >= 2, [...seen].join(','));
  const j = barRange(bySection(s, 'verse')[0])[1], was = t.bars[j].notes.length;
  assert.equal(B.bassDensity(t, ctx, j, +1), true);
  assert.ok(t.bars[j].notes.length >= was); assert.equal(t.bars[j].densityBias, 1);
  assert.equal(B.bassDensity(t, ctx, j, -1), true); assert.equal(t.bars[j].densityBias, 0);
});

step('3/4 ve 6/8: kök 1. vuruşta, noktalı çeyrek / vuruş ızgarasına oturur', () => {
  const w = song({ meter: '3/4', pack: 'vals', bpm: 90 });
  w.p.bass.bars.forEach((b, i) => { assert.equal(mod(b.notes[0].midi), PROG[i % 4][0]); assert.equal(stepsOfNote(b.notes[0]), 0); for (const n of b.notes) assert.ok(n.startBeat + n.durationBeats <= 3 + 1e-9); });
  const six = song({ meter: '6/8', pack: 'balad-68', bpm: 55 });
  six.p.bass.bars.forEach((b, i) => { assert.equal(mod(b.notes[0].midi), PROG[i % 4][0]); for (const n of b.notes) assert.ok([0, 6].includes(stepsOfNote(n)) || b.notes.length > 2 || n.role === 'approach'); });
  // 6/8'de kick adımları (8'lik) bas ızgarasına iki katıyla taşınır
  const ctx = six.ctx(), chorus = barRange(bySection(six, 'chorus')[0])[0];
  assert.deepEqual(ctx.kicks(chorus), [0]);
});

step('Eski motor korunur: engine legacy şablon üretir; paket yine groove', () => {
  const s = song({ pack: 'pop-rock' });
  s.p.bass.engine = 'legacy'; B.bassGenerateAll(s.p.bass, s.ctx());
  assert.ok(s.p.bass.bars.every((b) => !b.templateId.startsWith('groove:')));
  const t = B.defaultBassTrack(); t.engine = 'legacy'; assert.equal(G.active(t, s.ctx()), false);
});

step('Bas profili değişince tür profilden gelir (Post-punk drive → post-punk, Darkwave → darkwave, Synthwave → synthwave)', () => {
  const s = song();
  const t = B.defaultBassTrack();
  for (const [profile, feel] of [['post-punk-drive', 'post-punk'], ['darkwave-pulse', 'darkwave'], ['synthwave-roll', 'synthwave']]) { t.styleProfileId = profile; assert.equal(G.feelFor(t, s.ctx()).id, feel); }
  t.feelId = 'balad'; assert.equal(G.feelFor(t, s.ctx()).id, 'balad', 'açık tür profilden önce gelir');
  t.styleProfileId = null; t.feelId = null; assert.equal(G.feelFor(t, s.ctx()).id, 'pop-rock'); t.instrumentType = 'synth'; assert.equal(G.feelFor(t, s.ctx()).id, 'synthpop');
});

console.log(results.join('\n'));
if (failures) { console.log(`\n${failures} bas groove adımı başarısız.`); process.exit(1); }
console.log('Bas groove testleri geçti.');

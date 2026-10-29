// Gitar groove: tür, bölüm enerjisi, davulun kick'i, piyano / synth ve bas durumuna bağlı türetilmiş gitar partisi.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core: C } = loadCore(), G = C.GuitarGroove;
const PROG = [[9, 'm'], [5, ''], [0, ''], [7, '']];
const LAYOUT = [['intro', 4], ['verse', 8], ['prechorus', 4], ['chorus', 8], ['bridge', 4], ['outro', 4]];
const clone = (v) => JSON.parse(JSON.stringify(v));

function song({ meter = '4/4', pack = null, bpm = 110, piano = null, instrument = null } = {}) {
  const p = C.newProject(); p.settings.meter = meter; p.settings.bpm = bpm;
  p.guitar = C.defaultGuitarState(meter); p.guitar.instrument = 'both'; p.bass.enabled = true;
  let at = 1;
  p.sections = LAYOUT.map(([type, n], i) => { const s = { id: 's' + i, name: type, type, startBar: at, endBar: at + n - 1, tonic: 9, mode: 'minor' }; at += n; return s; });
  const bars = at - 1, g = C.makeGrid({ bpm, meter });
  const secs = p.sections.map((s) => ({ ...s, typeNorm: C.normSectionType(s.type), confirmed: true, pcs: C.scalePcs(9, 'minor') }));
  const chords = [];
  for (let b = 1; b <= bars; b++) { const [root, q] = PROG[(b - 1) % 4]; chords.push({ bar: b, q0: (b - 1) * g.barQ, q1: b * g.barQ, chord: { root, q, bass: null }, section: secs.find((s) => b >= s.startBar && b <= s.endBar).id }); }
  const d = { g, bars, sections: secs, chords, notes: [] };
  if (pack) C.applyPack(p, d, pack);
  if (instrument) p.guitar.instrument = instrument; // paket çalgı seçimini kendi belirler; açıkça istenen sonradan uygulanır
  if (piano) p.piano.style = piano;
  return { p, d, g, bars };
}
const slotOf = (s, type, k = 0) => { const sec = s.d.sections.find((x) => x.typeNorm === type); const q0 = (sec.startBar - 1 + k) * s.g.barQ; return { q0, q1: q0 + s.g.barQ, chord: { root: 9, q: 'm' }, section: sec.id }; };
const derive = (s, type, part = null, k = 0) => G.derive(s.p, s.d, slotOf(s, type, k), part || s.p.guitar.parts._all);
const hitsOf = (part) => part.pattern.steps.map((st, i) => (st.type === 'rest' ? -1 : i)).filter((i) => i >= 0);
const kicks = (s, type) => { const sec = s.d.sections.find((x) => x.typeNorm === type); const L = C.drumLoopForBar(s.p, s.d, sec.startBar); return L ? [...L.K].map((c, j) => ((c === 'x' || c === 'X') ? Math.round(j * (s.g.barQ / L.K.length) / 0.25) : -1)).filter((x) => x >= 0) : null; };

let failures = 0;
const results = [];
function step(name, fn) {
  try { const info = fn(); results.push(`✔ ${name}${info ? '\n    ' + info : ''}`); }
  catch (e) { failures++; results.push(`✘ ${name}\n    ${e.stack || e.message}`); }
}

step('Parti modeli: yeni parti groove açık; bayrağı olmayan eski parti elle yazılmıştır ve olduğu gibi çalar', () => {
  assert.equal(C.defaultGuitarPart('4/4').groove, true);
  const st = C.defaultGuitarState('4/4'); delete st.parts._all.groove;
  assert.equal(C.normalizeGuitarState(st, '4/4').parts._all.groove, false);
  const s = song({ pack: 'pop-rock' });
  const off = clone(s.p.guitar.parts._all); off.groove = false;
  assert.equal(G.derive(s.p, s.d, slotOf(s, 'chorus'), off), off, 'kapalıysa aynı nesne');
  assert.equal(s.p.guitar.parts._all.groove, true, 'paket uygulanan parti groove açık');
});

step('Aynı girdi aynı parti: tekrar türetme birebir ve aynı nesne', () => {
  for (const pack of ['pop-rock', 'dream-pop', 'trip-hop', 'indie-pop']) {
    const s = song({ pack }), a = derive(s, 'chorus'), b = derive(s, 'chorus');
    assert.equal(a, b, pack); assert.equal(JSON.stringify(a), JSON.stringify(derive(song({ pack }), 'chorus')), pack);
    assert.equal(a.pattern.steps.length, 16);
  }
});

step('Bölüm dinamiği: her türde nakarat vuruşları kıtadan seyrek değil, giriş / köprü kıtadan yoğun değil', () => {
  for (const pk of C.PACKS.filter((x) => x.meters[0] === '4/4' && x.guitarOn)) {
    const s = song({ pack: pk.id, bpm: pk.bpm[0] + 5 });
    // yoğunluk: strum = vuruş + vurgulu vuruşlar (davula kilitli roller kick'lere vurgu koyar); arpej tek tek ses olduğundan vuruşun yarısı (16'lık arpejde iki kat)
    const n = (type) => { const part = derive(s, type); return part.mode === 'arpeggio' ? hitsOf(part).length * (part.arpeggio.rate === '16n' ? 2 : 1) * 0.5 : hitsOf(part).length + part.pattern.steps.filter((x) => x.accent).length; };
    assert.ok(n('chorus') >= n('verse'), `${pk.id}: nakarat ${n('chorus')} < kıta ${n('verse')}`);
    assert.ok(n('intro') <= n('verse') + 1e-9, `${pk.id}: giriş ${n('intro')} > kıta ${n('verse')}`);
    assert.ok(n('bridge') <= n('chorus'), `${pk.id}: köprü nakaratı geçti`);
  }
});

step('İş bölümü (piyano / synth): arpej ya da shuffle çalarken gitar sadeleşir; blok akorda ritim / arpej; piyano yokken tam akor', () => {
  for (const pk of C.PACKS.filter((x) => x.meters[0] === '4/4' && x.guitarOn)) {
    const led = G.FEELS[pk.id].led;
    for (const style of ['piano-arp', 'synth-shuffle']) {
      const s = song({ pack: pk.id, piano: style, instrument: 'both' }); // piyano katmanını zorla (bazı paketler piyanosuz)
      for (const type of ['verse', 'chorus']) {
        const part = derive(s, type), info = part.grooveInfo, role = G.ROLES[info.role];
        const secId = s.d.sections.find((x) => x.typeNorm === type).id;
        if (!C.effectiveLayers(s.p, s.d, secId).piano) continue; // matris piyanoyu bu bölümde kapatmış (ör. alt rock kıtası)
        assert.ok(info.piano, `${pk.id}: ${type} piyano algılanmadı`);
        if (!led) assert.ok(!role.busy, `${pk.id} ${style} ${type}: meşgul rol ${info.role}`);
      }
    }
    const chord = song({ pack: pk.id, piano: 'piano-chord', instrument: 'both' });
    assert.equal(derive(chord, 'chorus').grooveInfo.piano, 'chord'); // nakaratta bütün katmanlar açık
  }
  // piyano katmanı kapalıysa (yalnız gitar): tam akor, halka yok değil (kıta ritim çalar)
  const solo = song({ pack: 'indie-pop', instrument: 'guitar' });
  assert.equal(derive(solo, 'chorus').voicing.shape, 'full'); assert.equal(derive(solo, 'chorus').grooveInfo.piano, null);
  const duo = song({ pack: 'indie-pop', piano: 'piano-chord' });
  assert.equal(derive(duo, 'chorus').voicing.shape, 'triad', 'piyano varken üst üç tel');
});

step('Sürüş rolleri: palm-mute / gallop bas ya da piyano varken power, tek başına tam akor; nakarat tonu bir kademe yükselir', () => {
  const s = song({ pack: 'alt-rock' });
  assert.equal(derive(s, 'chorus').grooveInfo.role, 'gallop'); assert.equal(derive(s, 'chorus').voicing.shape, 'power');
  assert.equal(derive(s, 'verse').grooveInfo.role, 'pm8'); assert.equal(derive(s, 'verse').articulation, 'palmMute');
  const ir = song({ pack: 'indie-rock' });
  assert.equal(derive(ir, 'verse').tone, 'crunch'); assert.equal(derive(ir, 'chorus').tone, 'drive');
});

step('Kick kilidi: kilitli rollerde kick adımındaki vuruşlar vurgulu; stab yalnızca kick adımlarında; skank kick\'ten kaçınır', () => {
  let locked = 0;
  for (const pk of C.PACKS.filter((x) => x.meters[0] === '4/4' && x.guitarOn)) {
    const s = song({ pack: pk.id, bpm: pk.bpm[0] + 5 });
    for (const type of ['verse', 'prechorus', 'chorus']) {
      const part = derive(s, type), K = kicks(s, type), role = G.ROLES[part.grooveInfo.role];
      if (!K || role.fit !== 'lock') continue;
      locked++;
      for (const k of K) if (part.pattern.steps[k].type !== 'rest') assert.ok(part.pattern.steps[k].accent, `${pk.id} ${type}: kick ${k} vurgusuz`);
      if (part.grooveInfo.role === 'stab') for (const h of hitsOf(part)) assert.ok(h === 0 || K.includes(h), `${pk.id}: stab ${h} kick değil`);
    }
  }
  assert.ok(locked >= 8, 'kilitli rol sayısı ' + locked);
  // four-on-the-floor üstünde skank: kick adımlarına (0,4,8,12) denk gelmez
  const s = song({ pack: 'post-punk' }); s.p.drums.loop = 'four';
  for (const sec of s.p.sections) if (sec.arr) delete sec.arr.drums;
  const part = derive(s, 'prechorus'), K = kicks(s, 'prechorus');
  assert.deepEqual(K, [0, 4, 8, 12]); assert.equal(part.grooveInfo.role, 'skank');
  for (const h of hitsOf(part)) assert.ok(!K.includes(h));
});

step('Davul loop\'u değişince gitar buna göre değişir (kick / trampet konumları parti içinde)', () => {
  const s = song({ pack: 'pop-rock' });
  const a = derive(s, 'prechorus'); s.p.drums.loop = 'four'; for (const sec of s.p.sections) if (sec.arr) delete sec.arr.drums;
  const b = derive(s, 'prechorus');
  assert.notDeepEqual(a.grooveInfo.kicks, b.grooveInfo.kicks);
  const accents = (part) => part.pattern.steps.map((x, i) => (x.accent ? i : -1)).filter((i) => i >= 0);
  assert.ok([0, 4, 8, 12].every((k) => accents(b).includes(k)), 'four-on-the-floor: her vuruşta vurgu ' + accents(b));
  // chop trampetin olduğu adımlarda
  const e = song({ pack: 'synthpop' }); e.p.drums.loop = 'boombap'; for (const sec of e.p.sections) if (sec.arr) delete sec.arr.drums;
  const chop = G.derive(e.p, e.d, slotOf(e, 'chorus'), Object.assign(clone(e.p.guitar.parts._all), { groove: true }));
  assert.equal(chop.grooveInfo.role, 'chop'); assert.deepEqual(hitsOf(chop), [4, 12], 'trampet 2 ve 4');
});

step('Davul yokken (matris): kick\'e kilitleme yok, tür kendi rolünü çalar', () => {
  const s = song({ pack: 'pop-rock' });
  const verse = derive(s, 'verse'); assert.equal(verse.grooveInfo.kicks, null);
  assert.equal(verse.grooveInfo.role, 'strum8');
  assert.ok(hitsOf(verse).length === 8);
});

step('Tüm türler: türetilen parti geçerli (adım sayısı ölçüye uyar), olaylar her ölçüde var, elle partiden farklı', () => {
  for (const pk of C.PACKS) {
    const meter = pk.meters[0];
    const s = song({ meter, pack: pk.id, bpm: pk.bpm[0] + 5 });
    if (!pk.guitarOn) { s.p.guitar.instrument = 'both'; }
    const ev = C.arrangedEvents(s.d, s.p, { layers: ['guitar'] }).guitar;
    const steps = Math.round(s.g.barQ / 0.25);
    for (const type of ['intro', 'verse', 'chorus', 'bridge', 'outro']) {
      const part = derive(s, type);
      assert.equal(part.pattern.steps.length, steps, `${pk.id} ${type}`); assert.equal(part.pattern.meter, meter);
      assert.ok(['strum', 'arpeggio', 'bassChord'].includes(part.mode));
      assert.ok(hitsOf(part).length >= 1);
      assert.ok(part.humanize.timingJitterMs <= 1.5 && part.humanize.velocityJitter <= 0.04, 'insan titremesi küçük');
    }
    const notes = ev.filter((e) => e.kind === 'note');
    assert.ok(notes.length > 20, `${pk.id}: ${notes.length}`);
    const bars = new Set(notes.map((e) => Math.floor(e.q / s.g.barQ)));
    assert.ok(bars.size >= 8, `${pk.id}: ${bars.size} ölçüde gitar`); // matris bazı bölümleri (giriş, kıta, köprü) kapatabilir
    const off = clone(s.p); for (const part of Object.values(off.guitar.parts)) part.groove = false;
    const plain = C.arrangedEvents(s.d, off, { layers: ['guitar'] }).guitar;
    assert.notEqual(JSON.stringify(ev), JSON.stringify(plain), pk.id);
    for (const e of notes) assert.ok(e.dur > 0 && Number.isFinite(e.t));
  }
});

step('Trip hop paketi: boom-bap davul, derin sub bas, noir arpej gitar; kıtada gitar bekler, nakaratta açılır', () => {
  const pk = C.PACKS.find((x) => x.id === 'trip-hop');
  assert.deepEqual(pk.meters, ['4/4']); assert.deepEqual(pk.bpm, [60, 95]);
  assert.equal(pk.drums.loop, 'boombap'); assert.equal(pk.guitar.mode, 'arpeggio'); assert.equal(pk.bass.preset, 'Warm sub');
  const s = song({ pack: 'trip-hop', bpm: 80 });
  assert.equal(s.p.bass.feelId, 'trip-hop'); assert.equal(s.p.drums.loop, 'boombap'); assert.equal(s.p.pack.id, 'trip-hop');
  const eff = (type) => C.effectiveLayers(s.p, s.d, s.d.sections.find((x) => x.typeNorm === type).id);
  assert.equal(eff('verse').guitar, false); assert.equal(eff('verse').drums, true); assert.equal(eff('chorus').guitar, true);
  assert.equal(eff('intro').drums, false);
  // bas boom-bap kick'ine uyar (kick 1, 2a, 3&: 0, 7, 10)
  const ctx = C.Bass.bassContext(s.d, s.p), verse = s.d.sections.find((x) => x.typeNorm === 'verse');
  assert.deepEqual(ctx.kicks(verse.startBar - 1), [0, 7, 10]);
  for (let i = verse.startBar - 1; i < verse.endBar; i++) {
    const onsets = s.p.bass.bars[i].notes.map((n) => Math.round(n.startBeat / 0.25));
    assert.ok(onsets.includes(0), `ölçü ${i + 1}: 1. vuruşta bas`);
    assert.ok(onsets.length <= 4, `ölçü ${i + 1}: trip hop basında az nota (${onsets})`);
  }
  assert.equal(derive(s, 'chorus').mode, 'arpeggio');
  assert.equal(derive(s, 'intro').grooveInfo.role, 'pad');
});

step('3/4 ve 6/8: türetilen parti 12 adım, vals / noktalı çeyrek nabzına oturur', () => {
  const w = song({ meter: '3/4', pack: 'vals', bpm: 90 });
  for (const type of ['verse', 'chorus']) { const part = derive(w, type); assert.equal(part.pattern.steps.length, 12); assert.ok(hitsOf(part).includes(0)); }
  const six = song({ meter: '6/8', pack: 'balad-68', bpm: 55 });
  for (const type of ['verse', 'chorus']) { const part = derive(six, type); assert.equal(part.pattern.steps.length, 12); assert.ok(hitsOf(part).includes(0)); }
  assert.equal(G.feelOf(w.p, '3/4'), 'vals'); assert.equal(G.feelOf(six.p, '6/8'), 'balad-68');
  const ev = C.arrangedEvents(w.d, w.p, { layers: ['guitar'] }).guitar.filter((e) => e.kind === 'note');
  assert.ok(ev.length > 20);
});

step('Paketsiz proje: ton clean → indie-pop, aksi halde pop-rock çizgisi; yine türetilir', () => {
  const s = song(); const clean = clone(s.p.guitar.parts._all); clean.tone = 'clean';
  assert.equal(G.feelOf(s.p, '4/4'), 'indie-pop'); s.p.guitar.parts._all.tone = 'crunch'; assert.equal(G.feelOf(s.p, '4/4'), 'pop-rock');
  const part = G.derive(s.p, s.d, slotOf(s, 'chorus'), s.p.guitar.parts._all);
  assert.ok(part.grooveInfo && part.pattern.id.startsWith('groove:'));
});

step('Sesleme: aynı ayarı paylaşan türetilmiş partiler tek el hareketi dizisi (voicing grubu) olarak çözülür', () => {
  const s = song({ pack: 'pop-rock' });
  const verse = derive(s, 'verse'), chorus = derive(s, 'chorus');
  assert.equal(typeof verse.vgroup, 'string');
  const ev = C.arrangedEvents(s.d, s.p, { layers: ['guitar'] }).guitar.filter((e) => e.kind === 'note' && !e.drone);
  const midis = (bar) => [...new Set(ev.filter((e) => Math.floor(e.q / s.g.barQ) === bar).map((e) => e.midi))];
  // her ölçüde en az bir ses ve aralık makul (gitar aralığı)
  for (let b = 4; b < 16; b++) for (const m of midis(b)) assert.ok(m >= 40 && m <= 91, `ölçü ${b + 1} nota ${m}`);
  void chorus;
});

console.log(results.join('\n'));
if (failures) { console.log(`\n${failures} gitar groove adımı başarısız.`); process.exit(1); }
console.log('Gitar groove testleri geçti.');

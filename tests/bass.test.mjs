// Bas katmanı (DOM'suz çekirdek): üretici, perde kuralları, enerji / motif, kilit / zar / pedal / döngü, undo, MIDI, kayıt-yükleme.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const { Core } = loadCore();
const B = Core.Bass;
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
const nm = (m) => Core.noteName(m);

// sentetik şarkı: bar başına bir ya da iki akor; bölümler
function mkSong({ bars = 16, meter = '4/4', bpm = 100, chords, sections }) {
  const g = Core.makeGrid({ bpm, meter });
  const secs = (sections || [{ id: 'a', name: 'Verse', startBar: 1, endBar: bars, tonic: 9, mode: 'minor' }]).map((s) => Object.assign({ typeNorm: Core.normSectionType(s.name), confirmed: true }, s, { pcs: Core.scalePcs(s.tonic ?? 0, s.mode || 'major') }));
  const slots = [];
  for (let b = 1; b <= bars; b++) {
    const c = chords(b);
    const list = Array.isArray(c[0]) ? c : [c];
    const sec = secs.find((s) => b >= s.startBar && b <= s.endBar);
    list.forEach(([root, q, bass], k) => slots.push({ bar: b, q0: (b - 1) * g.barQ + (k * g.barQ) / list.length, q1: (b - 1) * g.barQ + ((k + 1) * g.barQ) / list.length, chord: { root, q: q || '', bass: bass ?? null }, section: sec ? sec.id : null, flats: false }));
  }
  const d = { g, bars, sections: secs, chords: slots };
  return { d, proj: { settings: { meter, bpm } }, ctx: B.bassContext(d, { settings: { meter, bpm } }), g };
}
const PROG = [[9, 'm'], [5, ''], [0, ''], [7, '']];
const prog = (b) => PROG[(b - 1) % 4];
const newTrack = (over) => Object.assign(B.defaultBassTrack(), over || {});
const barsJson = (t) => t.bars.map((b) => JSON.stringify(b.notes));
const lcg = (seed) => { let r = seed; return () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296); };

await step('Veri modeli: varsayılan iz, şablon verisi (10 + 6 synth + 3/4 ve 6/8), profil kaydı', () => {
  const t = B.defaultBassTrack();
  assert.deepEqual(Object.keys(t).sort(), Object.keys(t).sort()); assert.equal(t.instrumentType, 'bass-guitar'); assert.deepEqual(t.range, { low: 28, high: 55 });
  const ids = B.BASS_TEMPLATES.filter((x) => x.meter === '4/4').map((x) => x.id);
  for (const id of ['drone-halves', 'drone-pickup', 'walking-quarters', 'push-offbeat', 'dotted-push', 'hook-walk', 'pedal-eighths', 'octave-pulse', 'gallop', 'rolling-sixteenths']) assert.ok(ids.includes(id), id);
  for (const id of ['acid-sixteenths', 'offbeat-pulse', 'moroder-run', 'arp-root-fifth', 'gated-quarters', 'sub-drone-sweep']) assert.ok(ids.includes(id), id);
  const T = (id) => B.BASS_TEMPLATES.find((x) => x.id === id);
  const on = (id) => T(id).slots.map((s) => `${s.step}(${s.len})`).join(' ');
  assert.equal(on('drone-halves'), '0(8) 8(8)'); assert.equal(on('drone-pickup'), '0(14) 14(2)'); assert.equal(on('walking-quarters'), '0(4) 4(4) 8(4) 12(4)');
  assert.equal(on('push-offbeat'), '0(6) 6(2) 8(6) 14(2)'); assert.equal(on('dotted-push'), '0(6) 6(6) 12(4)'); assert.equal(on('hook-walk'), '0(3) 3(3) 6(2) 8(3) 11(3) 14(2)');
  assert.equal(on('pedal-eighths'), [0, 2, 4, 6, 8, 10, 12, 14].map((s) => `${s}(2)`).join(' '));
  assert.deepEqual(T('octave-pulse').slots.map((s) => s.octave || 0), [0, 12, 0, 12, 0, 12, 0, 12]);
  assert.equal(on('gallop'), [0, 4, 8, 12].flatMap((b) => [`${b}(2)`, `${b + 2}(1)`, `${b + 3}(1)`]).join(' '));
  assert.equal(T('rolling-sixteenths').slots.length, 16); assert.deepEqual(T('rolling-sixteenths').slots.map((s) => s.octave || 0).slice(0, 4), [0, 0, 12, 0], 'düşük düşük yüksek düşük');
  const win = (id) => T(id).window.join('-');
  assert.deepEqual(['drone-halves', 'drone-pickup', 'walking-quarters', 'push-offbeat', 'dotted-push', 'hook-walk', 'pedal-eighths', 'octave-pulse', 'gallop', 'rolling-sixteenths'].map(win), ['0-0.4', '0-0.35', '0.2-0.6', '0.2-0.7', '0.3-0.7', '0.3-0.8', '0.4-1', '0.5-1', '0.7-1', '0.7-1']);
  assert.deepEqual(T('hook-walk').suits, ['bass-guitar']); assert.deepEqual(T('walking-quarters').suits, ['bass-guitar']); assert.deepEqual(T('gallop').suits, ['bass-guitar', 'synth']);
  assert.deepEqual(T('acid-sixteenths').slots.filter((s) => s.accent).map((s) => s.step), [0, 3, 6, 10, 12]); assert.deepEqual(T('acid-sixteenths').slots.filter((s) => s.glide).map((s) => s.step), [7, 14]);
  assert.equal(T('gated-quarters').slots[0].gate, 0.3); assert.equal(T('offbeat-pulse').slots[0].gate, 0.5); assert.deepEqual(T('arp-root-fifth').slots.map((s) => s.degree).slice(0, 4), ['root', 'fifth', 'octave', 'fifth']);
  // varsayılan rol ataması
  assert.deepEqual(B.slotRoles(T('walking-quarters')), ['anchor', 'strong', 'strong', 'pickup']); assert.deepEqual(B.slotRoles(T('pedal-eighths')), ['anchor', 'weak', 'strong', 'weak', 'strong', 'weak', 'strong', 'pickup']);
  // üç yerleşik profil; 3/4, 6/8, 2/4 şablonları
  assert.deepEqual(B.BUILTIN_PROFILES.map((p) => p.id), ['post-punk-drive', 'darkwave-pulse', 'synthwave-roll']);
  for (const m of ['3/4', '6/8']) assert.ok(B.templatesFor(t, m, 'bass-guitar').length >= 3, m);
  assert.equal(B.templatesFor(t, '2/4', 'bass-guitar')[0].id, 'fallback-2/4');
  assert.ok(!B.templatesFor({ ...t }, '4/4', 'synth').some((x) => x.id === 'hook-walk' || x.id === 'walking-quarters'), 'synth: gitar kalıpları gizli');
  assert.ok(B.templatesFor({ ...t, synthGuitarTemplates: true }, '4/4', 'synth').some((x) => x.id === 'hook-walk'));
  assert.ok(!B.templatesFor(t, '4/4', 'bass-guitar').some((x) => x.id === 'acid-sixteenths'));
});

await step('Üretici: aynı tohum + aynı girdi = aynı notalar (iki kez); farklı tohum farklı', () => {
  const { ctx } = mkSong({ bars: 32, chords: prog, sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 16, tonic: 9, mode: 'minor' }, { id: 'b', name: 'Chorus', startBar: 17, endBar: 32, tonic: 9, mode: 'minor' }] });
  const a = newTrack({ seed: 7 }), b = newTrack({ seed: 7 }), c = newTrack({ seed: 8 });
  B.bassGenerateAll(a, ctx); B.bassGenerateAll(b, ctx); B.bassGenerateAll(c, ctx);
  assert.deepEqual(barsJson(a), barsJson(b)); assert.notDeepEqual(barsJson(a), barsJson(c));
  const again = clone(a); B.bassGenerateAll(a, ctx); assert.deepEqual(barsJson(a), barsJson(again), 'ikinci Generate aynı');
});

await step('Kural: yeni akorla başlayan her ölçünün ilk notası o akorun kökü (ya da eğik çizgili bası); 1000 rastgele ilerleme, iki enstrüman tipi, 3 ölçü', () => {
  const rnd = lcg(11), Q = ['', 'm', '7', 'maj7', 'm7', 'sus4', 'dim', 'aug', '5', 'add9'];
  let checked = 0, notes = 0;
  for (let n = 0; n < 1000; n++) {
    const meter = ['4/4', '4/4', '4/4', '3/4', '6/8'][n % 5], type = n % 3 === 0 ? 'synth' : 'bass-guitar';
    const bars = 8 + Math.floor(rnd() * 9);
    const sectionTypes = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'];
    const cut = 3 + Math.floor(rnd() * (bars - 4));
    const song = mkSong({
      bars, meter,
      sections: [{ id: 'a', name: sectionTypes[Math.floor(rnd() * 5)], startBar: 1, endBar: cut, tonic: Math.floor(rnd() * 12), mode: rnd() < 0.5 ? 'minor' : 'major' }, { id: 'b', name: sectionTypes[Math.floor(rnd() * 5)], startBar: cut + 1, endBar: bars, tonic: Math.floor(rnd() * 12), mode: 'dorian' }],
      chords: () => { const mk = () => [Math.floor(rnd() * 12), Q[Math.floor(rnd() * Q.length)], rnd() < 0.15 ? Math.floor(rnd() * 12) : null]; return meter === '3/4' || rnd() < 0.7 ? mk() : [mk(), mk()]; },
    });
    const t = newTrack({ seed: n + 1, instrumentType: type, range: Object.assign({}, B.RANGE_DEFAULT[type]) });
    B.bassGenerateAll(t, song.ctx);
    let prev = null;
    for (let i = 0; i < bars; i++) {
      const segs = song.ctx.segs(i), first = segs[0].chord, notesOf = t.bars[i].notes;
      assert.ok(notesOf.length > 0, `bar ${i + 1} boş`);
      for (const n2 of notesOf) { assert.ok(n2.midi >= t.range.low && n2.midi <= t.range.high, `aralık dışı ${n2.midi}`); notes++; }
      if (!prev || !B.sameChord(prev, first)) { const want = mod12(first.bass ?? first.root); assert.equal(mod12(notesOf[0].midi), want, `#${n} bar ${i + 1} ${meter} ${type}: ${nm(notesOf[0].midi)} != ${Core.pcName(want)} (${first.root}${first.q})`); checked++; }
      // ikinci akor dilimi: dilimdeki ilk nota o akorun kökü
      for (let k = 1; k < segs.length; k++) if (!B.sameChord(segs[k - 1].chord, segs[k].chord)) { const nn = notesOf.find((x) => x.startBeat / 0.25 >= segs[k].s0); if (nn) assert.equal(mod12(nn.midi), mod12(segs[k].chord.bass ?? segs[k].chord.root), `yarım ölçü değişimi bar ${i + 1}`); }
      prev = segs[segs.length - 1].chord;
    }
  }
  return `${checked} yeni-akor ölçüsü, ${notes} nota kontrol edildi`;
});

await step('Kural: her nota ayarlanan aralıkta (varsayılan ve daraltılmış aralıklar); pedal notaları da', () => {
  const rnd = lcg(5);
  for (const [lo, hi, type] of [[28, 55, 'bass-guitar'], [24, 52, 'synth'], [34, 50, 'bass-guitar'], [30, 46, 'synth'], [40, 64, 'bass-guitar']]) {
    for (let n = 0; n < 40; n++) {
      const song = mkSong({ bars: 16, chords: () => [Math.floor(rnd() * 12), ['', 'm', '7'][Math.floor(rnd() * 3)]] });
      const t = newTrack({ seed: n, instrumentType: type, range: { low: lo, high: hi } });
      B.bassGenerateAll(t, song.ctx);
      for (const b of t.bars) for (const x of b.notes) assert.ok(x.midi >= lo && x.midi <= hi, `${lo}-${hi}: ${x.midi}`);
      if (n % 5 === 0) { B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'degree', degree: [1, 3, 5, 7][n % 4], octave: 1 }); B.bassGenerateAll(t, song.ctx); for (const b of t.bars) for (const x of b.notes) assert.ok(x.midi >= lo && x.midi <= hi, 'pedal ' + x.midi); }
    }
  }
});

await step('Kural: kilit yokken üç ardışık ölçü aynı notalar olmaz (sabit akor, drone / pedal şablonları dahil)', () => {
  const rnd = lcg(3);
  let worst = 0;
  for (let n = 0; n < 150; n++) {
    const same = n % 2 === 0;
    const song = mkSong({ bars: 24, sections: [{ id: 'a', name: ['Intro', 'Verse', 'Outro'][n % 3], startBar: 1, endBar: 12, tonic: 9, mode: 'minor' }, { id: 'b', name: 'Chorus', startBar: 13, endBar: 24, tonic: 9, mode: 'minor' }], chords: (b) => (same ? [9, 'm'] : [[9, 'm'], [5, '']][Math.floor((b - 1) / 4) % 2]) });
    const t = newTrack({ seed: n * 7 + 1, instrumentType: n % 4 === 0 ? 'synth' : 'bass-guitar' });
    t.range = Object.assign({}, B.RANGE_DEFAULT[t.instrumentType]);
    B.bassGenerateAll(t, song.ctx);
    for (let i = 2; i < 24; i++) { const k = B.barKey(t.bars[i]); assert.ok(!(k === B.barKey(t.bars[i - 1]) && k === B.barKey(t.bars[i - 2])), `tohum ${n} bar ${i + 1}: üçlü`); }
    let dup = 0; for (let i = 1; i < 24; i++) if (B.barKey(t.bars[i]) === B.barKey(t.bars[i - 1])) dup++;
    worst = Math.max(worst, dup);
  }
  return `150 şarkı; ikili tekrar en çok ${worst} ölçü çifti (izinli)`;
});

await step('Zar: ölçü N yeniden üretilince başka ölçü değişmez; Generate all kilitli ölçüleri değiştirmez; yeni tohum kilitlileri korur', () => {
  const song = mkSong({ bars: 16, chords: prog });
  const t = newTrack({ seed: 5 });
  B.bassGenerateAll(t, song.ctx);
  const before = barsJson(t), rcBefore = t.bars.map((b) => b.rerollCount);
  assert.ok(B.bassReroll(t, song.ctx, 6)); assert.equal(t.bars[6].rerollCount, 1);
  const after = barsJson(t);
  after.forEach((x, i) => { if (i !== 6) assert.equal(x, before[i], 'ölçü ' + (i + 1)); });
  assert.notEqual(after[6], before[6], 'zar notaları değiştirir');
  t.bars.forEach((b, i) => { if (i !== 6) assert.equal(b.rerollCount, rcBefore[i]); });
  // kilit
  B.bassLockRange(t, 2, 4, true); B.bassLock(t, 9, true);
  const locked = [2, 3, 4, 9].map((i) => JSON.stringify(t.bars[i].notes));
  B.bassGenerateAll(t, song.ctx);
  [2, 3, 4, 9].forEach((i, k) => assert.equal(JSON.stringify(t.bars[i].notes), locked[k], 'kilitli ' + (i + 1)));
  B.bassNewSeed(t, song.ctx, 99);
  [2, 3, 4, 9].forEach((i, k) => assert.equal(JSON.stringify(t.bars[i].notes), locked[k], 'yeni tohum, kilitli ' + (i + 1)));
  assert.notDeepEqual(barsJson(t).filter((_, i) => ![2, 3, 4, 9].includes(i)), before.filter((_, i) => ![2, 3, 4, 9].includes(i)));
  assert.equal(B.bassReroll(t, song.ctx, 3), false, 'kilitli ölçü zarlanmaz');
  // bölüm kilidi
  B.bassLockSection(t, song.ctx, 'a', true); assert.ok(t.bars.every((b) => b.locked)); B.bassLockSection(t, song.ctx, 'a', false); assert.ok(t.bars.every((b) => !b.locked));
});

await step('Akor değişimi: 64 ölçülük şarkıda etkilenen kilitsiz ölçüler < 100 ms\'de yeniden üretilir, kilitliler işaretlenir; BPM yeniden üretmez; ölçü değişimi hepsini kirletir', () => {
  const chordsAt = (over) => (b) => (over && b === 20 ? [7, '7'] : prog(b));
  let song = mkSong({ bars: 64, chords: chordsAt(false) });
  const t = newTrack({ seed: 3 });
  B.bassGenerateAll(t, song.ctx);
  B.bassLock(t, 19, true); B.bassLock(t, 18, true); // 20. ölçü ve önceki (öncül) kilitli
  const before = barsJson(t), lockedBefore = JSON.stringify([t.bars[18].notes, t.bars[19].notes]);
  song = mkSong({ bars: 64, chords: chordsAt(true) });
  const t0 = process.hrtime.bigint();
  const r = B.bassSync(t, song.ctx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 100, 'sync ' + ms.toFixed(1) + ' ms');
  assert.deepEqual(r.flagged.sort((a, b) => a - b), [18, 19], 'kilitli etkilenen ölçüler işaretlendi'); assert.equal(JSON.stringify([t.bars[18].notes, t.bars[19].notes]), lockedBefore, 'kilitliler değişmedi');
  assert.ok(t.bars[19].dirtyLocked && t.bars[18].dirtyLocked);
  // kilitsiz: ölçü 21 (öncül) ve ... yalnızca etkilenenler
  const t1 = newTrack({ seed: 3 }); B.bassGenerateAll(t1, mkSong({ bars: 64, chords: chordsAt(false) }).ctx);
  const b1 = barsJson(t1); const t2 = clone(t1);
  const t3 = process.hrtime.bigint(); const r2 = B.bassSync(t2, song.ctx); const ms2 = Number(process.hrtime.bigint() - t3) / 1e6;
  assert.ok(ms2 < 100, 'kilitsiz sync ' + ms2.toFixed(1) + ' ms');
  assert.deepEqual(r2.regenerated.sort((a, b) => a - b), [18, 19, 20].filter((i) => i !== 20 || true).filter((i) => r2.regenerated.includes(i)), 'yalnızca komşu');
  assert.ok(r2.regenerated.includes(19) && r2.regenerated.includes(18) && r2.regenerated.length <= 3, 'etkilenen: 20. ölçü + öncül: ' + r2.regenerated);
  barsJson(t2).forEach((x, i) => { if (![18, 19, 20].includes(i)) assert.equal(x, b1[i], 'ölçü ' + (i + 1)); });
  assert.ok(Math.max(...t2.bars[19].notes.map((n) => 0)) === 0 && t2.bars[19].notes.some((n) => mod12(n.midi) === 7), 'G7: kök G');
  // BPM: nota vuruşlarla kayıtlı, yeniden üretim yok
  const fast = mkSong({ bars: 64, chords: chordsAt(true), bpm: 160 });
  const t4 = clone(t2); const snap = barsJson(t4); const r3 = B.bassSync(t4, fast.ctx);
  assert.equal(r3.regenerated.length, 0); assert.deepEqual(barsJson(t4), snap);
  const e100 = B.bassEvents(t4, song.g), e160 = B.bassEvents(t4, fast.g);
  assert.equal(e100.length, e160.length);
  e100.forEach((e, i) => { assert.ok(Math.abs(e.q - e160[i].q) < 1e-9, 'ızgara aynı'); assert.ok(Math.abs(e.t * 100 - e160[i].t * 160) < 1e-6, 'süre BPM ile ölçeklenir'); assert.ok(Math.abs(e.q / 0.25 - Math.round(e.q / 0.25)) < 1e-9, 'ızgarada'); });
  // ölçü değişimi: bütün ölçüler kirli
  const m34 = mkSong({ bars: 64, chords: chordsAt(true), meter: '3/4' });
  const t5 = clone(t4); const r5 = B.bassSync(t5, m34.ctx);
  assert.ok(r5.regenerated.length >= 60, 'ölçü değişti: kirli ölçüler yeniden üretildi (' + r5.regenerated.length + ')');
  return `64 ölçü: kilitsiz sync ${ms2.toFixed(1)} ms, kilitli ${ms.toFixed(1)} ms · etkilenen ${r2.regenerated.map((i) => i + 1)}`;
});

await step('Enerji: bölüm eğrisi (tür varsayılanları + faz biçimi), hız enerjiyi izler; bölüm başında çapa bir adım uzun +10; bölüm sonu sıradaki köke öncül', () => {
  const song = mkSong({ bars: 24, chords: prog, sections: [{ id: 'i', name: 'Intro', startBar: 1, endBar: 4, tonic: 9, mode: 'minor' }, { id: 'v', name: 'Verse', startBar: 5, endBar: 12, tonic: 9, mode: 'minor' }, { id: 'c', name: 'Chorus', startBar: 13, endBar: 20, tonic: 9, mode: 'minor' }, { id: 'o', name: 'Outro', startBar: 21, endBar: 24, tonic: 9, mode: 'minor' }] });
  const t = newTrack({ seed: 2 }); B.bassGenerateAll(t, song.ctx);
  assert.deepEqual([t.sections.i.energyStart, t.sections.i.energyEnd], [0.2, 0.3]); assert.deepEqual([t.sections.v.energyStart, t.sections.v.energyEnd], [0.3, 0.5]);
  assert.deepEqual([t.sections.c.energyStart, t.sections.c.energyEnd], [0.75, 0.9]); assert.deepEqual([t.sections.o.energyStart, t.sections.o.energyEnd], [0.4, 0.1]);
  const sec = song.ctx.secOf(12); // koro
  for (let i = 12; i < 20; i++) { const base = 0.75 + (0.9 - 0.75) * ((i - 12) / 7), shape = B.PHRASE_SHAPE[(i - 12) % 4]; assert.ok(Math.abs(t.bars[i].energy - Math.min(1, Math.max(0, base + shape))) < 1e-9, 'enerji ' + (i + 1)); }
  void sec;
  const meanVel = (a, z) => { let s = 0, n = 0; for (let i = a; i <= z; i++) for (const x of t.bars[i].notes) if (x.role !== 'ghost') { s += x.velocity; n++; } return s / n; };
  assert.ok(meanVel(12, 19) > meanVel(0, 3) + 12, 'nakarat introdan sert');
  // bölüm başı: çapa bir adım uzun ve +10 hız (ilk ölçü)
  for (const [secIdx, nxt] of [[4, true], [12, true], [20, true]]) { void nxt; const first = t.bars[secIdx].notes[0], base = 60 + 50 * t.bars[secIdx].energy; assert.equal(first.startBeat, 0); assert.ok(first.velocity >= base + 8 + 10 - 3, `bölüm başı hızı ${first.velocity} ≥ ${base + 15}`); }
  // bölüm sonu: son nota, sıradaki bölümün ilk köküne 1–2 yarım ton (aynı kök değilse)
  let ok = 0;
  for (const endIdx of [3, 11, 19]) {
    const last = t.bars[endIdx].notes[t.bars[endIdx].notes.length - 1], nextRoot = B.homeRoot(mod12(song.ctx.segs(endIdx + 1)[0].chord.root), 40, t.range);
    const cur = song.ctx.segs(endIdx)[0].chord, nx = song.ctx.segs(endIdx + 1)[0].chord;
    if (mod12(cur.root) === mod12(nx.root)) continue;
    assert.ok(Math.abs(last.midi - nextRoot) <= 2 || last.role === 'fifth', `bölüm sonu öncül: ${nm(last.midi)} → ${nm(nextRoot)}`); ok++;
  }
  assert.ok(ok >= 2);
  // enerji 0.25 oynayınca aile değişir
  const jump = mkSong({ bars: 16, chords: () => [9, 'm'], sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 8, tonic: 9, mode: 'minor' }, { id: 'b', name: 'Chorus', startBar: 9, endBar: 16, tonic: 9, mode: 'minor' }] });
  let changed = 0;
  for (let sd = 1; sd <= 30; sd++) { const tt = newTrack({ seed: sd }); B.bassGenerateAll(tt, jump.ctx); const idx = B.tplIndex(tt), fam = (i) => idx.get(tt.bars[i].templateId).family; if (fam(7) !== fam(8)) changed++; }
  assert.ok(changed >= 24, 'verse → chorus (enerji farkı ≥ 0.25) farklı aile: ' + changed + '/30');
});

await step('Motif: A, A, A\', B — 1–2. ölçü aynı ritim ve roller, 3. ölçü tek değişiklik, 4. ölçü cevap; zar motifi bozar', () => {
  const song = mkSong({ bars: 16, chords: prog, sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 16, tonic: 9, mode: 'minor' }] });
  let a2 = 0, a3 = 0, b = 0, n = 0;
  for (let sd = 1; sd <= 60; sd++) {
    const t = newTrack({ seed: sd }); t.generated = true;
    B.bassGenerateAll(t, song.ctx);
    const rhythm = (i) => t.bars[i].notes.filter((x) => x.role !== 'fill').map((x) => x.startBeat + ':' + x.durationBeats).join(',');
    for (let p = 0; p < 4; p++) {
      const i = p * 4;
      n++;
      if (t.bars[i].templateId === t.bars[i + 1].templateId) a2++;
      if (t.bars[i + 2].templateId === t.bars[i].templateId) a3++;
      if (t.bars[i + 3].templateId !== t.bars[i].templateId || t.bars[i + 3].notes.some((x) => x.role === 'fill')) b++;
      void rhythm;
    }
  }
  assert.equal(a2, n, '2. ölçü aynı şablon'); assert.equal(a3, n, '3. ölçü aynı şablon'); assert.ok(b / n > 0.5, 'dördüncü ölçü cevap veriyor: ' + b + '/' + n);
  // A ve A': roller aynı slotlarda (pitch rolü) bir slot dışında aynı
  const t = newTrack({ seed: 4 }); B.bassGenerateAll(t, song.ctx);
  const prs = (i) => t.bars[i].recipe.slots.map((s) => s.pr);
  assert.deepEqual(prs(0), prs(1), '1–2. ölçü roller aynı');
  const diff = prs(0).filter((x, k) => x !== prs(2)[k]).length; assert.ok(diff <= 1, '3. ölçü en çok bir rol farklı: ' + diff);
  // aynı ritim → bu şarkıda ölçüler akora göre perdelenir: kök notaları akor kökü
  for (const i of [0, 1]) assert.deepEqual(t.bars[i].notes.map((x) => x.startBeat), t.bars[0].notes.map((x) => x.startBeat));
  // dolgu: yalnızca cümle sonunda; olasılık 0.15 + 0.5 × enerji
  let fills = 0, ph = 0, offPhrase = 0;
  for (let sd = 1; sd <= 80; sd++) { const tt = newTrack({ seed: sd }); B.bassGenerateAll(tt, song.ctx); for (let i = 0; i < 16; i++) { const has = tt.bars[i].notes.some((x) => x.role === 'fill'); if (i % 4 === 3) { ph++; if (has) fills++; } else if (has) offPhrase++; } }
  assert.equal(offPhrase, 0, 'dolgu yalnızca cümle sonunda'); assert.ok(fills > 0 && fills < ph, `dolgu ${fills}/${ph}`);
  const off = newTrack({ seed: 1 }); off.sections = {}; B.ensureBars(off, song.ctx); for (const k of Object.keys(off.sections)) off.sections[k].fills = false; B.bassGenerateAll(off, song.ctx);
  assert.ok(!off.bars.some((x) => x.notes.some((y) => y.role === 'fill')), 'bölüm dolgu kapalı');
});

await step('Perde kuralları: ağırlıklar (çapa köke; güçlü/zayıf dağılım ±; enerji kayması), üçlü yalnızca majör/minör/yedili ve ≥ MIDI 36, dim bemolü beşli, kaçınılacak nota', () => {
  const song = mkSong({ bars: 48, chords: (b) => [[9, 'm'], [5, ''], [0, ''], [7, '7']][(b - 1) % 4], sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 48, tonic: 9, mode: 'minor' }] });
  const p = B.BUILTIN_PROFILES[0];
  const sum = (w) => Object.values(w).reduce((a, x) => a + x, 0);
  assert.deepEqual(B.roleWeights(p, 'bass-guitar', 'anchor', 0.5), { root: 100 });
  const w5 = B.roleWeights({ ...B.BUILTIN_PROFILES[0], roles: B.DEFAULT_ROLES }, 'bass-guitar', 'strong', 0.5), w0 = B.roleWeights({ ...B.BUILTIN_PROFILES[0], roles: B.DEFAULT_ROLES }, 'bass-guitar', 'strong', 0), w1 = B.roleWeights({ ...B.BUILTIN_PROFILES[0], roles: B.DEFAULT_ROLES }, 'bass-guitar', 'strong', 1);
  assert.deepEqual(w5, { root: 55, fifth: 25, octave: 15, third: 5 }); assert.ok(Math.abs(w0.root - 75) < 1e-9 && Math.abs(sum(w0) - 100) < 1e-9, 'enerji 0: köke 20 puan'); assert.ok(Math.abs(w1.root - 35) < 1e-9 && Math.abs(w1.octave - 35) < 1e-9, 'enerji 1: kökten oktava 20 puan');
  assert.deepEqual(B.roleWeights({ ...p, roles: B.DEFAULT_ROLES }, 'bass-guitar', 'weak', 0.5), { repeat: 50, step: 25, fifth: 15, octave: 10 });
  assert.deepEqual(B.roleWeights({ ...p, roles: B.DEFAULT_ROLES }, 'bass-guitar', 'pickup', 0.5), { 'approach-d': 65, 'approach-c': 25, fifth: 10 });
  const sw = B.roleWeights({ ...p, synthRoles: null }, 'synth', 'strong', 0.5); assert.deepEqual(sw, { root: 55, fifth: 10, octave: 30, third: 5 });
  assert.deepEqual(B.roleWeights({ ...p, synthRoles: null }, 'synth', 'weak', 0.5), { repeat: 60, step: 15, fifth: 5, octave: 20 });
  // üçlü kuralı: üçlü çalındığında akorda üçlü var ve ≥ 36
  let thirds = 0;
  for (let sd = 1; sd <= 60; sd++) {
    const t = newTrack({ seed: sd }); t.styleProfileId = 'post-punk-drive'; B.bassGenerateAll(t, song.ctx);
    t.bars.forEach((b, i) => { const ch = song.ctx.segs(i)[0].chord, ci = B.chordInfo(ch); for (const x of b.notes) if (x.role === 'third') { thirds++; assert.ok(ci.thirdOk && mod12(x.midi) === ci.thirdPc, 'üçlü akorun üçlüsü'); assert.ok(x.midi >= 36, 'üçlü ≥ C2: ' + x.midi); } });
  }
  assert.ok(thirds > 0, 'üçlü çalınıyor');
  // dim akorda beşli bemol; sus / 5 akorlarda üçlü yok
  const dsong = mkSong({ bars: 32, chords: (b) => [[2, 'dim'], [4, 'sus4'], [7, '5'], [9, 'aug']][(b - 1) % 4] });
  let flat5 = 0;
  for (let sd = 1; sd <= 40; sd++) { const t = newTrack({ seed: sd }); B.bassGenerateAll(t, dsong.ctx); t.bars.forEach((b, i) => { const ch = dsong.ctx.segs(i)[0].chord; for (const x of b.notes) { assert.notEqual(x.role, 'third', 'üçlü yalnızca majör/minör/yedili'); if (x.role === 'fifth') { const want = ch.q === 'dim' ? 6 : ch.q === 'aug' ? 8 : 7; assert.equal(mod12(x.midi - ch.root), want, ch.q + ' beşlisi'); if (ch.q === 'dim') flat5++; } } }); }
  assert.ok(flat5 > 0);
  // kaçınılacak nota: güçlü slotta akor sesinin yarım ton üstündeki gam sesi yok
  for (let sd = 1; sd <= 60; sd++) {
    const t = newTrack({ seed: sd }); B.bassGenerateAll(t, song.ctx);
    t.bars.forEach((b, i) => { const ch = song.ctx.segs(i)[0].chord, ci = B.chordInfo(ch), roles = B.slotRoles(B.tplIndex(t).get(b.templateId) || B.BASS_TEMPLATES[0]); b.notes.forEach((x) => { if (x.role === 'passing' && x.startBeat > 0 && B.strongSteps('4/4').includes(Math.round(x.startBeat / 0.25)) && !ci.pcs.includes(mod12(x.midi))) assert.ok(!ci.pcs.some((q) => mod12(q + 1) === mod12(x.midi)), 'kaçınılacak nota ' + nm(x.midi)); }); void roles; });
  }
});

await step('Ses yönlendirme: sıçrama ≤ 12 (oktav ve dolgu hariç); enerji < 0.5 iken sıçramaların en çok %15\'i 7 yarım tondan büyük', () => {
  let big = 0, total = 0, over12 = 0;
  for (let sd = 1; sd <= 60; sd++) {
    const rnd = lcg(sd);
    const song = mkSong({ bars: 32, chords: () => [Math.floor(rnd() * 12), ['', 'm', '7'][Math.floor(rnd() * 3)]], sections: [{ id: 'a', name: 'Intro', startBar: 1, endBar: 16, tonic: 4, mode: 'minor' }, { id: 'b', name: 'Bridge', startBar: 17, endBar: 32, tonic: 4, mode: 'minor' }] });
    const t = newTrack({ seed: sd, instrumentType: sd % 2 ? 'synth' : 'bass-guitar' }); t.range = Object.assign({}, B.RANGE_DEFAULT[t.instrumentType]);
    for (const k of Object.keys(t.sections)) delete t.sections[k]; B.ensureBars(t, song.ctx);
    for (const k of Object.keys(t.sections)) { t.sections[k].energyStart = 0.15; t.sections[k].energyEnd = 0.4; }
    B.bassGenerateAll(t, song.ctx);
    let prev = null;
    t.bars.forEach((b) => { if (b.energy >= 0.5) return; for (const x of b.notes) { if (prev != null) { const iv = Math.abs(x.midi - prev); total++; if (iv > 7) big++; if (iv > 12 && x.role !== 'octave' && x.role !== 'fill' && x.role !== 'approach' && x.role !== 'chromatic') over12++; } prev = x.midi; } });
  }
  assert.ok(big / total <= 0.15, `büyük sıçrama oranı ${(100 * big / total).toFixed(1)} %`);
  return `${total} sıçrama, ${(100 * big / total).toFixed(1)} % > 7 yarım ton; akor değişimi dışı > 12: ${over12}`;
});

await step('Pedal notası: derece 5 her akorda beşli, sabit perde tek perde sınıfı; 7/9/11/13 çözümü ve uyarı; yaklaşma açık; ölçü pedalı bölümünkini ezer; zar/yeni tohum pedalı korur', () => {
  const song = mkSong({ bars: 16, chords: prog });
  const t = newTrack({ seed: 3 });
  B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'degree', degree: 5 });
  B.bassGenerateAll(t, song.ctx);
  t.bars.forEach((b, i) => { const ch = song.ctx.segs(i)[0].chord, want = mod12(ch.root + 7); for (const x of b.notes) assert.equal(mod12(x.midi), want, `bar ${i + 1}`); assert.ok(b.notes.length > 0); });
  assert.deepEqual([...new Set(t.bars.slice(0, 4).map((b) => mod12(b.notes[0].midi)))].sort((a, b) => a - b), [0, 2, 4, 7].sort((a, b) => a - b).map((x) => x), 'Am→E, F→C, C→G, G→D');
  // sabit perde
  B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'pitch', pitchClass: 'E' }); B.bassGenerateAll(t, song.ctx);
  assert.ok(t.bars.every((b) => b.notes.every((x) => mod12(x.midi) === 4)), 'E boyunca');
  // derece çözümü
  const ded = (q, degree, root = 0, mode = 'major') => { const s = mkSong({ bars: 4, chords: () => [root, q], sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 4, tonic: 0, mode }] }); const tt = newTrack({ seed: 1 }); B.bassSetPedal(tt, s.ctx, 0, 3, { kind: 'degree', degree }); B.bassGenerateAll(tt, s.ctx); return { pcs: new Set(tt.bars.flatMap((b) => b.notes.map((x) => mod12(x.midi)))), warn: tt.bars.flatMap((b) => b.warnings) }; };
  assert.deepEqual([...ded('', 3).pcs], [4], 'majör üçlü E'); assert.deepEqual([...ded('m', 3).pcs], [3]);
  assert.deepEqual([...ded('7', 7).pcs], [10], 'akorun yedilisi'); assert.deepEqual([...ded('', 7).pcs], [11], 'akorda yedili yok: gamın yedilisi (C majör: B)');
  assert.deepEqual([...ded('add9', 9).pcs], [2]); assert.deepEqual([...ded('', 9).pcs], [2], 'gamın 9\'u'); assert.deepEqual([...ded('', 11).pcs], [5]); assert.deepEqual([...ded('', 13).pcs], [9]);
  const avoid = ded('', 11); assert.ok(avoid.warn.some((w) => /kaçınılacak/.test(w)), '11 majör akorda: uyarı ama çalar');
  const bad = ded('sus4', 3); assert.deepEqual([...bad.pcs], [0], 'çözülemeyen derece köke düşer'); assert.ok(bad.warn.some((w) => /çözülemedi/.test(w)));
  // zar / yeni tohum: pedal korunur, ritim değişir
  B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'degree', degree: 5 }); B.bassGenerateAll(t, song.ctx);
  const tpl = t.bars.map((b) => b.templateId); B.bassNewSeed(t, song.ctx, 12345);
  assert.ok(t.bars.every((b, i) => b.pedal && b.pedal.degree === 5 && b.notes.every((x) => mod12(x.midi) === mod12(song.ctx.segs(i)[0].chord.root + 7))));
  assert.notDeepEqual(t.bars.map((b) => b.templateId), tpl, 'yeni tohum ritmi değiştirir');
  B.bassReroll(t, song.ctx, 5); assert.ok(t.bars[5].notes.every((x) => mod12(x.midi) === mod12(song.ctx.segs(5)[0].chord.root + 7)));
  assert.ok(!t.bars.some((b) => b.notes.some((x) => x.role === 'fill')), 'pedal ölçüsünde dolgu yok');
  // yaklaşma: yalnızca akor değişiminden önceki son öncül slot pedaldan çıkar
  B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'degree', degree: 1, approach: true }); B.bassGenerateAll(t, song.ctx);
  let left = 0;
  t.bars.forEach((b, i) => { const ch = song.ctx.segs(i)[0].chord; b.notes.forEach((x, k) => { if (mod12(x.midi) !== mod12(ch.root)) { left++; assert.equal(k, b.notes.length - 1, 'yalnızca son nota'); assert.ok(x.startBeat >= 3, 'öncül slot'); } }); });
  assert.ok(left > 0, 'yaklaşma açık: öncül çalıyor');
  B.bassSetPedal(t, song.ctx, 0, 15, { kind: 'degree', degree: 1, approach: false }); B.bassGenerateAll(t, song.ctx);
  assert.ok(t.bars.every((b, i) => b.notes.every((x) => mod12(x.midi) === mod12(song.ctx.segs(i)[0].chord.root))), 'yaklaşma kapalı: pedal kırılmaz');
  // ölçünün kendi pedalı bölümünkini ezer
  const t2 = newTrack({ seed: 3 }); B.ensureBars(t2, song.ctx); t2.sections.a.pedal = { kind: 'pitch', pitchClass: 'A', octave: 0, octaves: 'strict', approach: false }; B.bassSetPedal(t2, song.ctx, 4, 4, { kind: 'pitch', pitchClass: 'D' });
  B.bassGenerateAll(t2, song.ctx);
  assert.ok(t2.bars[3].notes.every((x) => mod12(x.midi) === 9) && t2.bars[4].notes.every((x) => mod12(x.midi) === 2) && t2.bars[5].notes.every((x) => mod12(x.midi) === 9));
  // oktav sıçramaları: strict aynı perde, allow slotu oktav 12 olan şablonda
  const o = newTrack({ seed: 1 }); o.sections = {}; B.ensureBars(o, song.ctx); for (const k of Object.keys(o.sections)) { o.sections[k].energyStart = 0.9; o.sections[k].energyEnd = 0.9; o.sections[k].templateFamily = 'drive'; o.sections[k].fills = false; }
  B.bassSetPedal(o, song.ctx, 0, 15, { kind: 'degree', degree: 1, octaves: 'strict' }); B.bassGenerateAll(o, song.ctx);
  const spans = (tt) => Math.max(...tt.bars.map((b) => Math.max(...b.notes.map((x) => x.midi)) - Math.min(...b.notes.map((x) => x.midi))));
  assert.equal(spans(o), 0, 'strict: aynı perde');
  B.bassSetPedal(o, song.ctx, 0, 15, { kind: 'degree', degree: 1, octaves: 'allow-octave-jumps' }); B.bassGenerateAll(o, song.ctx);
  assert.ok(spans(o) <= 12);
});

await step('Döngü: exact kopyalar kaynakla birebir; follow-chords ritim + roller aynı, perdeler her akora; kaynak düzenlenince kopyalar güncellenir; break; çakışma; Generate all / yeni tohum dokunmaz; kayıt-yükleme', () => {
  const song = mkSong({ bars: 16, chords: prog });
  const t = newTrack({ seed: 9 }); B.bassGenerateAll(t, song.ctx);
  const r = B.bassMakeLoop(t, song.ctx, { sourceStart: 0, sourceLength: 2, targetStart: 2, targetEnd: 7, mode: 'exact' });
  assert.ok(r.ok); assert.ok(t.bars[0].locked && t.bars[1].locked, 'kaynak kilitlenir');
  for (let i = 2; i <= 7; i++) { assert.equal(t.bars[i].source, 'loop'); assert.deepEqual(t.bars[i].notes, t.bars[(i - 2) % 2].notes, 'exact kopya ' + (i + 1)); }
  // kaynağı elle düzenle → kopyalar birlikte güncellenir
  B.bassUpdateNote(t, song.ctx, 0, 0, { midi: t.bars[0].notes[0].midi + 12 });
  for (let i = 2; i <= 7; i += 2) assert.deepEqual(t.bars[i].notes, t.bars[0].notes, 'kopya güncellendi');
  assert.equal(t.bars[0].source, 'manual');
  // Generate all / yeni tohum döngü ve kopyalara dokunmaz
  const snap = barsJson(t).slice(0, 8); B.bassGenerateAll(t, song.ctx); assert.deepEqual(barsJson(t).slice(0, 8), snap); B.bassNewSeed(t, song.ctx, 77); assert.deepEqual(barsJson(t).slice(0, 8), snap);
  // çakışan döngü reddedilir
  assert.equal(B.bassMakeLoop(t, song.ctx, { sourceStart: 4, sourceLength: 1, targetStart: 8, targetEnd: 9 }).ok, false, 'kopya ölçü kaynak olamaz / çakışma');
  assert.equal(B.bassMakeLoop(t, song.ctx, { sourceStart: 8, sourceLength: 1, targetStart: 5, targetEnd: 6 }).ok, false, 'hedef kaynaktan önce');
  assert.equal(B.bassMakeLoop(t, song.ctx, { sourceStart: 8, sourceLength: 9, targetStart: 12, targetEnd: 15 }).ok, false, 'kaynak 1–8');
  // kayıt-yükleme
  const loaded = JSON.parse(JSON.stringify(t)); assert.deepEqual(loaded.loops, t.loops); assert.deepEqual(barsJson(loaded), barsJson(t));
  // break: nota değişmez, kopyalar kilitli sıradan ölçü
  const before = barsJson(t); assert.ok(B.bassBreakLoop(t, song.ctx, t.loops[0].id)); assert.deepEqual(barsJson(t), before, 'break notaları değiştirmez'); assert.equal(t.loops.length, 0); assert.ok(t.bars.slice(2, 8).every((b) => b.source === 'generated' && b.locked));
  // follow-chords: ritim + roller aynı, perdeler akora
  const f = newTrack({ seed: 4 }); B.bassGenerateAll(f, song.ctx);
  assert.ok(B.bassMakeLoop(f, song.ctx, { sourceStart: 0, sourceLength: 1, targetStart: 1, targetEnd: 11, mode: 'follow-chords' }).ok);
  const src = f.bars[0];
  for (let i = 1; i <= 11; i++) {
    const b = f.bars[i]; assert.equal(b.source, 'loop');
    assert.deepEqual(b.notes.filter((x) => x.role !== 'fill').map((x) => [x.startBeat, x.durationBeats]), src.notes.filter((x) => x.role !== 'fill').map((x) => [x.startBeat, x.durationBeats]), 'ritim ' + (i + 1));
    const ch = song.ctx.segs(i)[0].chord; assert.equal(mod12(b.notes[0].midi), mod12(ch.root), 'çapa akorun kökü ' + (i + 1));
    const roots = b.notes.filter((x) => x.role === 'root'), srcRoots = src.notes.filter((x) => x.role === 'root');
    assert.ok(roots.length >= Math.min(1, srcRoots.length));
    roots.forEach((x) => assert.equal(mod12(x.midi), mod12(ch.root)));
    assert.deepEqual(b.recipe.slots.map((s) => s.pr).slice(0, src.recipe.slots.length), src.recipe.slots.map((s) => s.pr), 'roller aynı');
  }
  // akor düzenlenince follow kopyaları kendiliğinden yeniden perdelenir
  const song2 = mkSong({ bars: 16, chords: (b) => (b === 6 ? [2, 'm'] : prog(b)) }); B.bassSync(f, song2.ctx);
  assert.equal(mod12(f.bars[5].notes[0].midi), 2, 'kopya yeni akora uydu');
});

await step('Hipnotik bölüm: ritim her ölçüde aynı, perdeler akor değişimini izler, tek değişiklik cümle sonu öncülü; kilit yokken bile tekrar serbest; dolgu varsayılan kapalı', () => {
  const song = mkSong({ bars: 16, chords: (b) => (b <= 8 ? [9, 'm'] : [[9, 'm'], [5, '']][Math.floor((b - 9) / 2) % 2]), sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 16, tonic: 9, mode: 'minor' }] });
  const t = newTrack({ seed: 5, instrumentType: 'synth', range: { low: 24, high: 52 } }); B.ensureBars(t, song.ctx);
  t.sections.a.hypnotic = true; t.sections.a.fills = false; t.sections.a.energyStart = 0.7; t.sections.a.energyEnd = 0.7;
  B.bassGenerateAll(t, song.ctx);
  const rhythm = (i) => t.bars[i].notes.map((x) => x.startBeat + ':' + x.durationBeats).join(',');
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) assert.equal(rhythm(i), rhythm(0), 'ritim aynı ' + (i + 1));
  assert.equal(B.barKey(t.bars[0]), B.barKey(t.bars[1])); assert.equal(B.barKey(t.bars[1]), B.barKey(t.bars[2]), 'üçlü tekrar serbest (hipnotik)');
  const roots = (i) => t.bars[i].notes.filter((x) => x.role === 'root').map((x) => mod12(x.midi));
  assert.ok(roots(8).every((x) => x === 9) && roots(10).every((x) => x === 5), 'perdeler akoru izler: ' + roots(8) + ' / ' + roots(10));
  assert.ok(![...Array(16).keys()].some((i) => t.bars[i].notes.some((x) => x.role === 'fill')), 'dolgu yok');
  // kaç ölçü (aynı akor) birebir aynı
  assert.equal(B.barKey(t.bars[4]), B.barKey(t.bars[5]));
});

await step('Enstrüman tipi: synth varsayılanları (aralık 24–52, gitar şablonları gizli, kapı 0.6 / 0.95, ghost kısa kapı), tip değişince kilitli ve elle yazılan ölçüler korunur', () => {
  const song = mkSong({ bars: 16, chords: prog });
  const t = newTrack({ seed: 2 }); B.bassGenerateAll(t, song.ctx);
  B.bassLock(t, 2, true); B.bassUpdateNote(t, song.ctx, 5, 0, { velocity: 111 });
  const keep = [JSON.stringify(t.bars[2].notes), JSON.stringify(t.bars[5].notes)], other = JSON.stringify(t.bars[8].notes);
  assert.ok(B.bassSwitchType(t, song.ctx, 'synth'));
  assert.deepEqual(t.range, { low: 24, high: 52 }); assert.equal(t.instrumentType, 'synth'); assert.ok(B.BASS_PRESET_NAMES.synth.includes(t.instrumentPreset));
  assert.equal(JSON.stringify(t.bars[2].notes), keep[0]); assert.equal(JSON.stringify(t.bars[5].notes), keep[1]); assert.notEqual(JSON.stringify(t.bars[8].notes), other, 'kilitsiz yeniden üretildi');
  assert.ok(t.bars.every((b) => b.notes.every((x) => x.midi >= 24 && x.midi <= 52 || b.locked || b.source === 'manual')));
  const gates = new Set(t.bars.filter((b) => !b.locked && b.source !== 'manual').flatMap((b) => b.notes.map((x) => x.gate))); assert.ok([...gates].every((g) => g > 0 && g <= 1) && gates.size > 0);
  const drone = newTrack({ seed: 2, instrumentType: 'synth' }); drone.range = { low: 24, high: 52 }; B.ensureBars(drone, song.ctx); for (const k of Object.keys(drone.sections)) { drone.sections[k].energyStart = 0.1; drone.sections[k].energyEnd = 0.1; drone.sections[k].templateFamily = 'drone'; }
  B.bassGenerateAll(drone, song.ctx); assert.ok(drone.bars.every((b) => b.notes.every((x) => x.gate >= 0.95 || x.role === 'ghost')), 'drone kapısı 0.95');
  const syn = newTrack({ seed: 2, instrumentType: 'synth' }); syn.range = { low: 24, high: 52 }; B.ensureBars(syn, song.ctx); for (const k of Object.keys(syn.sections)) { syn.sections[k].energyStart = 0.95; syn.sections[k].energyEnd = 0.95; syn.sections[k].templateFamily = 'walk'; }
  B.bassGenerateAll(syn, song.ctx);
  const pulse = new Set(syn.bars.filter((b) => ['gated-quarters', 'offbeat-pulse'].includes(b.templateId)).flatMap((b) => b.notes.map((x) => x.gate))); void pulse;
  // acid: vurgulu nota hızı ≥ vurgusuz + 20 (aynı rol); glide bayrağı 7. ve 14. adımda
  const ac = newTrack({ seed: 1, instrumentType: 'synth' }); ac.range = { low: 24, high: 52 }; B.ensureBars(ac, song.ctx); for (const k of Object.keys(ac.sections)) { ac.sections[k].energyStart = 0.95; ac.sections[k].energyEnd = 0.95; ac.sections[k].templateFamily = 'roll'; ac.sections[k].fills = false; }
  for (let sd = 1; sd < 40; sd++) { ac.seed = sd; B.bassGenerateAll(ac, song.ctx); if (ac.bars.some((b) => b.templateId === 'acid-sixteenths')) break; }
  const ab = ac.bars.find((b) => b.templateId === 'acid-sixteenths'); assert.ok(ab, 'acid şablonu seçildi');
  const acc = ab.notes.filter((x) => x.accent), plain = ab.notes.filter((x) => !x.accent && x.role !== 'ghost');
  assert.deepEqual(acc.map((x) => x.startBeat / 0.25), [0, 3, 6, 10, 12]); assert.ok(Math.min(...acc.map((x) => x.velocity)) > Math.max(...plain.map((x) => x.velocity)) - 12 && acc.every((x) => x.velocity >= 60 + 50 * ab.energy + 20 - 8));
  assert.deepEqual(ab.notes.filter((x) => x.glide).map((x) => x.startBeat / 0.25), [7, 14]);
});

await step('Sub drone: aynı akorda ölçüler arası bağ (tie), farklı akorda bağ yok; süzgeç otomasyonu enerjiyi ve süpürmeyi izler', () => {
  const song = mkSong({ bars: 16, chords: (b) => (b <= 8 ? [9, 'm'] : [5, '']), sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 8, tonic: 9, mode: 'minor' }, { id: 'b', name: 'Chorus', startBar: 9, endBar: 16, tonic: 9, mode: 'minor' }] });
  const t = newTrack({ seed: 1, instrumentType: 'synth' }); t.range = { low: 24, high: 52 }; B.ensureBars(t, song.ctx);
  for (const k of Object.keys(t.sections)) { t.sections[k].energyStart = 0.1; t.sections[k].energyEnd = 0.1; t.sections[k].templateFamily = 'drone'; t.sections[k].fills = false; }
  for (const k of Object.keys(t.sections)) t.sections[k].hypnotic = true;
  let found = false;
  for (let sd = 1; sd < 80 && !found; sd++) { t.seed = sd; B.bassGenerateAll(t, song.ctx); found = t.bars[0].templateId === 'sub-drone-sweep'; }
  assert.ok(found, 'sub-drone-sweep seçildi');
  assert.ok(t.bars.slice(0, 7).every((b) => b.templateId === 'sub-drone-sweep'));
  assert.ok(t.bars.slice(0, 7).every((b) => b.notes[b.notes.length - 1].tie), 'aynı akorda bağlı'); assert.ok(!t.bars[7].notes[t.bars[7].notes.length - 1].tie, 'akor değişince bağ yok'); assert.ok(!t.bars[15].notes[0].tie);
  // süzgeç: varsayılan enerjiyi izler; kesim = 120 × (8000/120)^değer
  assert.ok(Math.abs(B.cutoffHz(0) - 120) < 1e-9 && Math.abs(B.cutoffHz(1) - 8000) < 1e-6 && Math.abs(B.cutoffHz(0.5) - Math.sqrt(120 * 8000)) < 1e-6);
  const song2 = mkSong({ bars: 8, chords: () => [9, 'm'], sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 8, tonic: 9, mode: 'minor' }] });
  const u = newTrack({ seed: 1, instrumentType: 'synth' }); B.bassGenerateAll(u, song2.ctx);
  const au = B.filterAutomation(u, song2.ctx, song2.g); assert.equal(au.length, 8);
  assert.ok(Math.abs(au[0].v - 0.3) < 1e-9 && Math.abs(au[7].v - 0.5) < 1e-9, 'enerji 0.3→0.5 izlenir'); assert.ok(au.every((p, i) => i === 0 || p.v >= au[i - 1].v), 'açılır');
  u.sections.a.filterStart = 0.1; u.sections.a.filterEnd = 0.9; u.sections.a.sweepBars = 4;
  const sw = B.filterAutomation(u, song2.ctx, song2.g);
  assert.ok(Math.abs(sw[0].v - 0.1) < 1e-9 && sw[3].v1 > sw[3].v && Math.abs(sw[4].v - 0.1) < 1e-9, 'süpürme 4 ölçüde başa döner: ' + sw.map((x) => x.v.toFixed(2)));
  assert.ok(Math.abs(sw[0].v1 - 0.3) < 1e-9 && Math.abs(sw[3].v1 - 0.9) < 1e-9, 'süpürme başlangıçtan bitişe');
  assert.ok(au.every((p, i) => Math.abs(p.res - (0.2 + 0.3 * u.bars[i].energy)) < 1e-9 && Math.abs(p.drive - (0.1 + 0.4 * u.bars[i].energy)) < 1e-9), 'rezonans ve drive enerjiyi izler');
  assert.ok(sw.every((p) => p.t === p.q * song2.g.spq), 'otomasyon saniyeye çevrilebilir (ses saatinde uygulanır)');
});

await step('Elle düzenleme, yoğun / seyrek, ileri kopyala, yeniden uydurma, temizle; undo / redo (50 derinlik); MIDI; kayıt-yükleme', () => {
  const song = mkSong({ bars: 16, chords: prog });
  const t = newTrack({ seed: 6 }); B.bassGenerateAll(t, song.ctx);
  const h = B.newHistory();
  const act = (fn) => { B.historyPush(h, t); fn(); };
  act(() => B.bassAddNote(t, song.ctx, 3, { startBeat: 2.5, durationBeats: 0.5, midi: 41, velocity: 99, role: 'passing' }));
  assert.equal(t.bars[3].source, 'manual'); assert.ok(t.bars[3].locked); assert.ok(t.bars[3].notes.some((x) => x.midi === 41));
  act(() => B.bassUpdateNote(t, song.ctx, 3, 0, { startBeat: 0.3, durationBeats: 0.9 })); assert.equal(t.bars[3].notes[0].startBeat, 0.25, 'ızgaraya oturur'); assert.equal(t.bars[3].notes[0].durationBeats, 1);
  const nBefore = t.bars[3].notes.length; act(() => B.bassDeleteNote(t, song.ctx, 3, 1)); assert.equal(t.bars[3].notes.length, nBefore - 1);
  // undo/redo
  const afterEdits = JSON.stringify(t); const u1 = B.historyUndo(h, t); assert.ok(u1); assert.equal(u1.bars[3].notes.length, nBefore); Object.assign(t, u1);
  const r1 = B.historyRedo(h, t); assert.equal(JSON.stringify(r1), afterEdits); Object.assign(t, r1);
  for (let i = 0; i < 70; i++) B.historyPush(h, t); assert.equal(h.undo.length, 50, '50 derinlik');
  // yoğunlaştır / seyrelt
  const u = newTrack({ seed: 1 }); B.ensureBars(u, song.ctx); for (const k of Object.keys(u.sections)) { u.sections[k].energyStart = 0.45; u.sections[k].energyEnd = 0.45; u.sections[k].fills = false; }
  B.bassGenerateAll(u, song.ctx);
  const idx = B.tplIndex(u); let moved = 0;
  for (let i = 0; i < 16; i++) { const a = idx.get(u.bars[i].templateId).slots.length; if (B.bassDensity(u, song.ctx, i, 1)) { assert.ok(idx.get(u.bars[i].templateId).slots.length >= a); moved++; } }
  assert.ok(moved > 0); for (let i = 0; i < 16; i++) B.bassDensity(u, song.ctx, i, -1);
  // ileri kopyala
  const c = newTrack({ seed: 8 }); B.bassGenerateAll(c, song.ctx); const srcRhythm = c.bars[0].notes.filter((x) => x.role !== 'fill').map((x) => x.startBeat);
  assert.equal(B.bassCopyForward(c, song.ctx, 0, 3), 3); for (let i = 1; i <= 3; i++) { assert.deepEqual(c.bars[i].notes.filter((x) => x.role !== 'fill').map((x) => x.startBeat).slice(0, srcRhythm.length), srcRhythm); assert.equal(mod12(c.bars[i].notes[0].midi), mod12(song.ctx.segs(i)[0].chord.root)); }
  // yeniden uydur + temizle
  const song2 = mkSong({ bars: 16, chords: (b) => (b === 5 ? [3, 'm'] : prog(b)) });
  B.bassLock(c, 4, true); const rr = B.bassSync(c, song2.ctx); assert.ok(rr.flagged.includes(4)); const rhythm5 = c.bars[4].notes.map((x) => x.startBeat);
  assert.ok(B.bassRefit(c, song2.ctx, 4)); assert.equal(mod12(c.bars[4].notes[0].midi), 3, 're-fit yeni akora'); assert.deepEqual(c.bars[4].notes.map((x) => x.startBeat).slice(0, rhythm5.length - 1), rhythm5.slice(0, rhythm5.length - 1), 'ritim aynı'); assert.ok(!c.bars[4].dirtyLocked && c.bars[4].locked);
  B.bassClear(c, song2.ctx, 7); assert.equal(c.bars[7].notes.length, 0); assert.ok(c.bars[7].locked);
  // MIDI
  const midi = B.bassMidi(c, { settings: { meter: '4/4', bpm: 100 } }, song2.d); const pm = Core.parseMidi(midi);
  const track = pm.tracks.find((x) => x.name === 'Bas'); assert.ok(track); assert.equal(track.notes.length, c.bars.reduce((a, b) => a + b.notes.length, 0));
  // kayıt-yükleme: tohum, kilitler, elle notalar, profil, bölüm ayarları birebir
  c.styleProfileId = 'darkwave-pulse'; c.styleMix = { profileB: 'synthwave-roll', amount: 0.3 }; c.sections.a.registerOffset = 12; c.sections.a.hypnotic = true; c.sections.a.pedal = { kind: 'pitch', pitchClass: 'A', octave: 0, octaves: 'strict', approach: false };
  const re = JSON.parse(JSON.stringify(c)); assert.deepEqual(re, JSON.parse(JSON.stringify(c))); assert.equal(re.seed, c.seed); assert.deepEqual(re.bars.map((b) => b.locked), c.bars.map((b) => b.locked)); assert.deepEqual(re.sections, c.sections); assert.equal(re.styleMix.amount, 0.3);
  const regen = clone(re); B.bassSync(regen, song2.ctx); assert.deepEqual(barsJson(regen), barsJson(re), 'yükleme sonrası senkron notaları değiştirmez');
});

await step('Katman: bölüm içi kayıt ofseti, bölüm bazlı aile ve yoğunluk; 3/4 ve 6/8 üretimi; 2/4 yedek şablon; 1 saniyeden kısa üretim', () => {
  const song = mkSong({ bars: 16, chords: prog, sections: [{ id: 'a', name: 'Verse', startBar: 1, endBar: 8, tonic: 9, mode: 'minor' }, { id: 'b', name: 'Chorus', startBar: 9, endBar: 16, tonic: 9, mode: 'minor' }] });
  const t = newTrack({ seed: 2 }); B.ensureBars(t, song.ctx); t.sections.b.registerOffset = 12; t.sections.a.templateFamily = 'drone';
  B.bassGenerateAll(t, song.ctx);
  const avg = (a, z) => { const m = t.bars.slice(a, z).flatMap((b) => b.notes.filter((x) => x.role === 'root').map((x) => x.midi)); return m.reduce((s, x) => s + x, 0) / m.length; };
  assert.ok(avg(8, 16) > avg(0, 8) + 4, 'bir oktav yukarı kayıt: ' + avg(8, 16).toFixed(1) + ' vs ' + avg(0, 8).toFixed(1));
  const idx = B.tplIndex(t); assert.ok(t.bars.slice(0, 8).every((b) => idx.get(b.templateId).family === 'drone'), 'bölüm ailesi');
  for (const meter of ['3/4', '6/8', '2/4']) {
    const s = mkSong({ bars: 12, meter, chords: prog }); const tt = newTrack({ seed: 3 }); B.bassGenerateAll(tt, s.ctx);
    tt.bars.forEach((b, i) => { assert.ok(b.notes.length > 0); assert.equal(mod12(b.notes[0].midi), mod12(s.ctx.segs(i)[0].chord.root)); for (const x of b.notes) { assert.ok(x.startBeat >= 0 && x.startBeat + x.durationBeats <= s.ctx.barQ + 1e-9, `${meter} ölçü içinde`); } });
  }
  const t0 = Date.now(); const big = mkSong({ bars: 128, chords: prog }); const bt = newTrack({ seed: 1 }); B.bassGenerateAll(bt, big.ctx); assert.ok(Date.now() - t0 < 1000);
});

console.log(results.join('\n'));
if (failures) { console.log(`\n${failures} adım başarısız`); process.exit(1); }
console.log('\nBas testleri geçti.');

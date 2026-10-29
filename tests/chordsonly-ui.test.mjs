// "Akor şablonu aç": .txt ve .mid'den yalnız akorlar; melodi, vokal, bas ve davul izleri okunmaz; yalnız akor projesiyle çalışılır.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(process.env.TONE_JS), contentType: 'application/javascript' }));
  await page.route(/\/salamander\//, (r) => r.abort());
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__dawAPI && /Hazır/.test(document.querySelector('#status').textContent));
  const status = () => page.textContent('#status');
  const st = () => page.evaluate(() => { const { S, C } = window.__dawAPI; return {
    only: !!(S.midi && S.midi.chordsOnly), notes: S.d.notes.length, midiNotes: S.midi ? S.midi.notes.length : -1, bars: S.d.bars, bpm: S.proj.settings.bpm, meter: S.proj.settings.meter,
    secs: S.proj.sections.map((s) => `${s.name} ${s.startBar}–${s.endBar} ${s.tonic != null ? C.keyName(s.tonic, s.mode) : '—'}`),
    chords: S.d.chords.map((c) => `${c.bar}${c.half ? '/' + c.half : ''}:${C.chordName(c.chord, c.flats)}${c.locked ? '🔒' : ''}`).join(' '),
    charts: S.proj.chordLocks.filter((l) => l.src === 'chart').length, bass: S.proj.bass.enabled, drums: S.proj.drums.on, audio: !!S.audio }; });
  const load = (name, mime, buf) => page.setInputFiles('#fileChords', { name, mimeType: mime, buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf) });
  const waitStatus = (re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status').textContent), re);

  // 1) .txt: şarkı yokken yalnız akor projesi açılır (kayıt, melodi, vokal yok)
  const txt = 'Tempo: 96 BPM · Ölçü: 4/4\n[Verse]\n| Am | F | C | G |\n| Am | F | C | G |\n[Nakarat]\n| F | C | G | Am |\n';
  await load('sarki.txt', 'text/plain', txt);
  await waitStatus('Şablon uygulandı');
  let s = await st();
  assert.equal(s.only, true); assert.equal(s.notes, 0); assert.equal(s.midiNotes, 0); assert.equal(s.audio, false);
  assert.equal(s.bpm, 96); assert.equal(s.meter, '4/4'); assert.equal(s.bars, 12);
  assert.deepEqual(s.secs, ['Verse 1–8 A minör', 'Nakarat 9–12 A minör'], JSON.stringify(s.secs));
  assert.equal(s.chords, '1:Am🔒 2:F🔒 3:C🔒 4:G🔒 5:Am🔒 6:F🔒 7:C🔒 8:G🔒 9:F🔒 10:C🔒 11:G🔒 12:Am🔒');
  assert.equal(s.charts, 12);
  assert.match(await status(), /yalnız akorlar/);
  assert.match(await page.textContent('#audioInfo'), /Yalnız akor şablonu/); assert.match(await page.textContent('#chipS2'), /yalnız akor şablonu/);

  // 2) yalnız akorlarla çalışılır: Demo yap (tür paketi), çalma, MIDI dışa aktarma
  await page.selectOption('#inPackToolbar', 'pop-rock');
  await page.click('#btnDemo');
  await waitStatus('Demo');
  s = await st();
  assert.equal(s.bass, true); assert.equal(s.drums, true); assert.equal(s.chords.split(' ').length, 12); assert.equal(s.notes, 0);
  const ev = await page.evaluate(() => { const { C, S } = window.__dawAPI; const e = C.arrangedEvents(S.d, S.proj); return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.length])); });
  assert.ok(ev.piano > 0 && ev.bass > 0 && ev.drums > 0, JSON.stringify(ev));
  const midiTracks = await page.evaluate(() => { const { C, S } = window.__dawAPI; return C.parseMidi(C.exportMidi(S.proj, S.d, null)).tracks.map((t) => `${t.name}:${t.notes.length}`); });
  assert.ok(!midiTracks.some((t) => /^(Vokal|Melodi)/i.test(t)), midiTracks.join(' | '));
  const played = await page.evaluate(async () => { const api = window.__dawAPI, got = {}; api.onScheduledEvents = (e) => Object.assign(got, e); await api.player().play({ from: 0 }); api.stop(); delete api.onScheduledEvents; return Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.length])); });
  assert.ok(played.piano > 0, JSON.stringify(played));

  // 3) kaydet / yükle: yalnız akor projesi olarak geri gelir
  const dl = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('#btnSave').click());
  const saved = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
  assert.equal(saved.midiData.chordsOnly, true); assert.deepEqual(saved.midiData.notes, []);
  const before = (await st()).chords;
  await page.evaluate(() => document.querySelector('#btnNew').click());
  await page.setInputFiles('#fileProject', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await waitStatus('Proje açıldı');
  s = await st(); assert.equal(s.only, true); assert.equal(s.chords, before); assert.equal(s.notes, 0);

  // 4) .mid: vokal + piyano akorları + bas + davul izleri olan dosyadan yalnız akorlar gelir
  const midiBytes = await page.evaluate(() => {
    const { C } = window.__dawAPI, PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], tracks = [];
    tracks.push({ name: 'Vokal', channel: 0, program: 52, notes: Array.from({ length: 32 }, (_, i) => ({ q0: i, q1: i + 0.9, midi: 74 + [0, 2, 4, 7, 9, 11][i % 6], vel: 100 })) });
    tracks.push({ name: 'Piyano akorları', channel: 1, program: 0, notes: PROG.flatMap((c, i) => [0, 1].flatMap((k) => c.map((m) => ({ q0: (i + 4 * k) * 4, q1: (i + 4 * k) * 4 + 3.9, midi: m, vel: 80 })))) });
    tracks.push({ name: 'Bas', channel: 3, program: 33, notes: Array.from({ length: 8 }, (_, i) => ({ q0: i * 4, q1: i * 4 + 3.9, midi: 33 + [0, 8, 3, 10][i % 4] % 12, vel: 90 })) });
    tracks.push({ name: 'Davul — Rock', channel: 9, program: 0, notes: Array.from({ length: 32 }, (_, i) => ({ q0: i, q1: i + 0.1, midi: i % 2 ? 38 : 36, vel: 100 })) });
    return Array.from(C.writeMidi({ quarterBpm: 120, meter: '4/4', tracks, markers: [] }));
  });
  await load('akorlar.mid', 'audio/midi', Buffer.from(midiBytes));
  await waitStatus('Şablon uygulandı');
  s = await st();
  assert.equal(s.only, true); assert.equal(s.notes, 0, 'vokal MIDI\'si yüklenmedi'); assert.equal(s.midiNotes, 0);
  assert.equal(s.bpm, 120); assert.equal(s.bars, 8);
  assert.equal(s.chords, '1:Am🔒 2:F🔒 3:C🔒 4:G🔒 5:Am🔒 6:F🔒 7:C🔒 8:G🔒');
  assert.equal(s.bass, false, 'MIDI\'deki bas izi bası açmadı'); assert.equal(s.drums, false, 'davul izi davulu açmadı');
  assert.match(await status(), /Piyano akorları/); assert.match(await status(), /Atlanan izler|izlerin notalarından/);
  // bölüm ve ton akorlardan çıkarıldı
  assert.equal(s.secs.length, 1); assert.match(s.secs[0], /A minör/);

  // 5) uygulamanın kendi MIDI çıktısı (akor adı metinleri): aynı akorlar
  const own = await page.evaluate(() => { const { C, S } = window.__dawAPI; return Array.from(C.exportMidi(S.proj, S.d, null)); });
  const withNames = (await st()).chords;
  await load('kendi.mid', 'audio/midi', Buffer.from(own));
  await waitStatus('Şablon uygulandı'); s = await st();
  assert.equal(s.chords, withNames); assert.match(await status(), /akor adlarından|notalarından/);

  // 6) şarkı (melodi) yüklüyse akorlar onun üstüne yerleşir, yeni proje açılmaz
  await page.evaluate(() => document.querySelector('#btnNew').click());
  await page.click('#btnTest'); await waitStatus('Test melodisi hazır');
  const notes0 = (await st()).notes; assert.ok(notes0 >= 8);
  await load('ust.txt', 'text/plain', '| C | G | Am | F |\n| C | G | Am | F |\n');
  await waitStatus('Şablon uygulandı'); s = await st();
  assert.equal(s.only, false); assert.equal(s.notes, notes0, 'melodi yerinde'); assert.equal(s.charts, 8);
  assert.match(s.chords, /^1:C🔒 2:G🔒 3:Am🔒 4:F🔒/);

  // 7) hatalı şablon uygulanmaz, proje açılmaz
  await page.evaluate(() => document.querySelector('#btnNew').click());
  await load('bozuk.txt', 'text/plain', '| Am | Xyz? | C |');
  await waitStatus('hata var'); s = await st().catch(() => null);
  assert.equal(await page.evaluate(() => !!(window.__dawAPI.S.midi && window.__dawAPI.S.midi.chordsOnly)), false);
  // melodisiz, akorsuz MIDI: anlaşılır hata
  await load('bos.mid', 'audio/midi', Buffer.from(await page.evaluate(() => Array.from(window.__dawAPI.C.writeMidi({ quarterBpm: 100, meter: '4/4', tracks: [{ name: 'Boş', channel: 0, program: 0, notes: [] }] })))));
  await waitStatus('Akor şablonu açılamadı');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Yalnız akor arayüz testi geçti: .txt ve .mid → yalnız akorlar (vokal / bas / davul izleri okunmadı), Demo, çalma, kaydet / yükle, melodili şarkının üstüne yerleşme, hatalar.');
} finally { await browser.close(); }

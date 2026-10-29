// "Miks WAV aç": .wav olarak indirilmiş bir miks (vokal + akor + davul) çözümlenir; olduğu gibi çalar, üstüne yalnız bas üretilir.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { makeMix } from './mix-fixtures.mjs';

const { Core: CC } = loadCore();
const wavOf = (m) => Buffer.from(CC.encodeWav([m.data], m.sr));
const rock = makeMix(CC, { bpm: 100, loop: 'rock8' });
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
  const waitStatus = (re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status').textContent), re, { timeout: 120000 });
  const st = () => page.evaluate(() => { const { S, C } = window.__dawAPI; const ev = C.arrangedEvents(S.d, S.proj); return {
    mix: !!(S.proj.audio && S.proj.audio.mix), audio: !!S.audio, notes: S.d.notes.length, track: !!S.track, bars: S.d.bars, end: S.proj.sections[0].endBar, bpm: S.proj.settings.bpm, meter: S.proj.settings.meter, off: S.proj.audio.offsetSec,
    chords: S.d.chords.map((c) => `${c.half != null ? c.bar + '/' + c.half : c.bar}:${C.chordName(c.chord, c.flats)}${c.locked ? '🔒' : ''}`).join(' '),
    key: S.proj.sections[0].tonic != null ? C.keyName(S.proj.sections[0].tonic, S.proj.sections[0].mode) : null, secs: S.proj.sections.length,
    bass: S.proj.bass.enabled, drumsOn: S.proj.drums.on, vfx: !!(S.proj.vocalFx && S.proj.vocalFx.on), kicksBars: S.proj.mixKicks ? S.proj.mixKicks.length : -1,
    ev: Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, v.length])), pack: S.proj.pack && S.proj.pack.id, locks: S.proj.pack && S.proj.pack.locks }; });
  const loadMix = (name, buf) => page.setInputFiles('#fileMix', { name, mimeType: 'audio/wav', buffer: buf });

  // 1) mix yükle: tempo, ölçü başı, akorlar (kilitli), ton; perde analizi / melodi yok
  await loadMix('benim-sarkim.wav', wavOf(rock));
  await waitStatus('Miks çözüldü');
  let s = await st();
  assert.equal(s.mix, true); assert.equal(s.audio, true); assert.equal(s.track, false, 'perde analizi yapılmadı'); assert.equal(s.notes, 0, 'vokal notaya çevrilmedi');
  assert.ok(Math.abs(s.bpm - 100) <= 0.6, 'bpm ' + s.bpm); assert.equal(s.meter, '4/4'); assert.equal(s.end, 8, JSON.stringify(s)); assert.equal(s.off, 0);
  assert.equal(s.chords, '1:Am🔒 2:F🔒 3:C🔒 4:G🔒 5:Am🔒 6:F🔒 7:C🔒 8:G🔒'); assert.equal(s.key, 'A minör'); assert.equal(s.secs, 1);
  assert.equal(s.kicksBars, 8);
  assert.match(await status(), /BPM · 4\/4 · 8 ölçü · ton A minör/);
  assert.ok(await page.isVisible('#mixRow')); assert.match(await page.textContent('#mixInfo'), /100 BPM · 4\/4/);

  // 2) yalnız bas üretildi (miksin içinde piyano / davul zaten var); gitar, piyano, davul açılmadı
  assert.equal(s.bass, true); assert.equal(s.drumsOn, false); assert.equal(s.vfx, false, 'miks olduğu gibi çalar: vokal temizliği yok');
  assert.ok(s.ev.bass >= 16, 'bas notaları ' + s.ev.bass);
  assert.ok(!s.ev.piano && !s.ev.guitar && !s.ev.drums, JSON.stringify(s.ev));
  assert.equal(s.locks.piano && s.locks.guitar && s.locks.drums && !s.locks.bass, true, JSON.stringify(s.locks));
  // basın vuruşları miksin kick'leriyle örtüşür: bas notalarının çoğu kick adımında ya da ölçü akorunun 1. vuruşunda başlar
  const fit = await page.evaluate(() => { const { S, C } = window.__dawAPI, kicks = S.proj.mixKicks, g = S.d.g, ev = C.arrangedEvents(S.d, S.proj).bass; let on = 0;
    for (const e of ev) { const bar = Math.floor(e.q / g.barQ), step = Math.round((e.q - bar * g.barQ) / 0.25); if (step === 0 || (kicks[bar] || []).includes(step)) on++; }
    return { on, n: ev.length, kicks: kicks.map((k) => k.join(',')) }; });
  assert.ok(fit.on / fit.n >= 0.7, `bas notalarının ${fit.on}/${fit.n}'i kick ya da ölçü başında`);
  assert.ok(fit.kicks.slice(1, 8).every((k) => k.split(',').includes('0') && k.split(',').includes('8')), 'kalıp kick konumları bulundu: ' + fit.kicks.join(' | '));

  // 3) çalma: yalnız bas zamanlanır; miks sesi (S.audio) çalar
  const played = await page.evaluate(async () => { const api = window.__dawAPI, got = {}; api.onScheduledEvents = (e) => Object.assign(got, e); await api.player().play({ from: 0 }); api.stop(); delete api.onScheduledEvents; return Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.length])); });
  assert.ok(played.bass > 0, JSON.stringify(played)); assert.ok(!played.piano && !played.drums && !played.guitar, JSON.stringify(played));

  // 4) başka paket / bas yeniden üret: miks ve akorlar aynı kalır, yalnız bas yeni üretilir; piyano / gitar / davul kilitli kalır
  const before = s.chords, bass1 = await page.evaluate(() => JSON.stringify(window.__dawAPI.S.proj.bass.bars));
  await page.locator('details[data-key="s4a"]').evaluate((el) => { el.open = true; });
  for (const pid of ['trip-hop', 'dream-pop', 'alt-rock']) {
    await page.selectOption('#inPack', pid); await page.click('#btnPackApply');
    s = await st();
    assert.equal(s.mix, true); assert.equal(s.chords, before); assert.equal(s.notes, 0);
    assert.ok(!s.ev.piano && !s.ev.guitar && !s.ev.drums && s.drumsOn === false, `${pid}: miksin üstüne piyano / gitar / davul eklenmedi: ` + JSON.stringify(s.ev));
    assert.ok(s.ev.bass > 0, pid);
  }
  const bass2 = await page.evaluate(() => JSON.stringify(window.__dawAPI.S.proj.bass.bars));
  assert.notEqual(bass2, bass1, 'paket değişince bas hattı yeniden üretildi');

  // 5) dışa aktarım: mix WAV = orijinal miks + bas (süre miksle aynı), MIDI'de vokal / melodi yok
  const dl = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('#btnExpMix').click());
  const wav = CC.decodeWav(new Uint8Array(readFileSync(await (await dl).path())).buffer);
  { const d = wav.data.length / wav.sr - rock.data.length / rock.sr; assert.ok(d > -0.1 && d < 4, 'süre farkı ' + d.toFixed(2)); } // miksin tamamı + bas kuyruğu
  const rms = (a, from, to) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return Math.sqrt(e / (to - from)); };
  assert.ok(rms(wav.data, 0, wav.data.length) > 0.05, 'çıktı sessiz değil');
  // basın katkısı: aynı dosya basız miksle farklı (düşük bantta fazladan enerji)
  const lowE = (a, sr) => { let e = 0, y = 0; const k = 1 - Math.exp(-2 * Math.PI * 120 / sr); for (let i = 0; i < a.length; i++) { y += k * (a[i] - y); e += y * y; } return e / a.length; };
  const ratio = lowE(wav.data, wav.sr) / lowE(rock.data, rock.sr); assert.ok(ratio > 1.15, 'düşük bant enerjisi miks + basta artmalı: ×' + ratio.toFixed(2));
  const midiTracks = await page.evaluate(() => { const { C, S } = window.__dawAPI; return C.parseMidi(C.exportMidi(S.proj, S.d, null)).tracks.map((t) => `${t.name}:${t.notes.length}`); });
  assert.ok(midiTracks.some((t) => /^Bas:[1-9]/.test(t)) && midiTracks.filter((t) => !/:0$/.test(t)).length === 1, 'MIDI\'de yalnız bas notası var: ' + midiTracks.join(' | '));

  // 6) kaydet / yükle: ses her zaman gömülür; açınca aynı miks projesi (akorlar, kick'ler, bas)
  const dl2 = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('#btnSave').click());
  const saved = JSON.parse(readFileSync(await (await dl2).path(), 'utf8'));
  assert.equal(saved.audio.mix, true); assert.ok(saved.audioData && saved.audioData.wavBase64.length > 1000, 'miks sesi gömüldü'); assert.equal(saved.mixKicks.length, 8);
  const bassBefore = await page.evaluate(() => { const { S, C } = window.__dawAPI; return JSON.stringify(C.arrangedEvents(S.d, S.proj).bass); });
  await page.evaluate(() => document.querySelector('#btnNew').click());
  assert.equal((await st().catch(() => ({ mix: false }))).mix, false);
  await page.setInputFiles('#fileProject', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await waitStatus('Proje açıldı');
  s = await st();
  assert.equal(s.mix, true); assert.equal(s.track, false); assert.equal(s.chords, before); assert.equal(s.kicksBars, 8); assert.ok(await page.isVisible('#mixRow'));
  assert.equal(await page.evaluate(() => JSON.stringify(window.__dawAPI.C.arrangedEvents(window.__dawAPI.S.d, window.__dawAPI.S.proj).bass)), bassBefore, 'bas aynı geri geldi');

  // 7) tempo yarı / çift çıktıysa: BPM ÷2 ile yeniden çöz → 4 ölçü; ↻ ile aynı BPM'de yeniden çözülür
  await page.click('#btnMixD2'); await waitStatus('Miks çözüldü');
  s = await st(); assert.ok(Math.abs(s.bpm - 50) <= 0.5, 'bpm ' + s.bpm); assert.equal(s.end, 4); assert.equal(s.mix, true);
  await page.click('#btnMixX2'); await waitStatus('Miks çözüldü');
  s = await st(); assert.ok(Math.abs(s.bpm - 100) <= 0.6, 'bpm ' + s.bpm); assert.equal(s.end, 8); assert.equal(s.chords, before);
  await page.click('#btnMixRe'); await waitStatus('Miks çözüldü');
  s = await st(); assert.ok(Math.abs(s.bpm - 100) <= 0.6); assert.equal(s.chords, before);

  // 8) 2. adımdaki düğmeden aç, başta sessizlik olan dosya: ölçü başı ofseti bulunur
  const lead = makeMix(CC, { bpm: 90, lead: 0.8, loop: 'boombap' });
  await page.setInputFiles('#fileMix', { name: 'bosluklu.wav', mimeType: 'audio/wav', buffer: wavOf(lead) });
  await waitStatus('Miks çözüldü');
  s = await st(); assert.ok(Math.abs(s.bpm - 90) <= 0.6, 'bpm ' + s.bpm); assert.ok(Math.abs(s.off - 0.8) <= 0.07, 'ofset ' + s.off); assert.equal(s.chords.split(' ').length, 8);

  // 9) hata: çok kısa dosya miks açmaz, mevcut proje yerinde kalır
  const short = Buffer.from(CC.encodeWav([new Float32Array(22050)], 44100));
  await page.setInputFiles('#fileMix', { name: 'kisa.wav', mimeType: 'audio/wav', buffer: short });
  await waitStatus('Miks çözülemedi');
  assert.match(await status(), /çok kısa/);
  s = await st(); assert.equal(s.mix, true); assert.ok(Math.abs(s.bpm - 90) <= 0.6, 'önceki proje yerinde');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Miks arayüz testi geçti: .wav → tempo / ölçü başı / akor / ton / kick çözümü, yalnız bas üretimi (kick\'lere oturan), çalma, mix WAV + MIDI dışa aktarımı, kaydet / yükle, BPM ×2 / ÷2 / yeniden çöz, boşluklu dosya, hata.');
} finally { await browser.close(); }

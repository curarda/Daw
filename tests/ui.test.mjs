// Tarayıcı testi (Playwright + Chromium): test melodisiyle arayüz akışının tamamı.
// Kullanım: TONE_JS=/yol/Tone.js node tests/ui.test.mjs
//  - Tone.js CDN isteği yerel kopyaya yönlendirilir (TONE_JS verilmezse CDN'e gider).
//  - Kayıt ve gecikme kalibrasyonu, Chromium'un sahte mikrofonuna verilen alkış dosyasıyla test edilir.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const toneLocal = process.env.TONE_JS;
const shotDir = process.env.SHOT_DIR;

// çekirdek (dosya üretimi için)
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const sb = {};
new Function('globalThis', 'module', /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1])(sb, undefined);
const Core = sb.Core;
// sahte mikrofon: her 0,5 s'de bir alkış (döngüde çalar)
const clapPath = path.join(here, '..', '.tmp-claps.wav');
{
  const sr = 48000, x = new Float32Array(sr * 8);
  let r = 3;
  for (let c = 0.25; c < 8; c += 0.5) {
    const s0 = Math.round(c * sr);
    for (let k = 0; k < 0.03 * sr; k++) { r = (r * 1103515245 + 12345) & 0x7fffffff; x[s0 + k] = (r / 0x7fffffff * 2 - 1) * 0.7 * Math.exp(-k / (0.006 * sr)); }
  }
  writeFileSync(clapPath, Buffer.from(Core.encodeWav([x], sr)));
}
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${clapPath}`],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true, permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|salamander|net::ERR/i.test(m.text())) errors.push(m.text()); });
if (toneLocal) await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
await page.route(/tonejs\.github\.io\/audio\/salamander/, (r) => r.abort());

const log = [];
async function step(name, fn) {
  const t = Date.now();
  const info = await fn();
  log.push(`✔ ${name} (${Date.now() - t} ms)${info ? ' — ' + info : ''}`);
}
const waitStatus = (re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status').textContent), re.source, { timeout });
const S = (fn) => page.evaluate(fn);
async function download(btn) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), data: readFileSync(p) };
}

const noteGeo = (i) => S(`(() => {
  const d = window.__daw.d, n = d.notes[${i}], sc = document.querySelector('#tlScroll');
  const H = sc.clientHeight; let lo = Infinity, hi = -Infinity;
  for (const k of d.notes) { lo = Math.min(lo, k.effMidi, k.median); hi = Math.max(hi, k.effMidi, k.median); }
  lo = Math.floor(lo) - 3; hi = Math.ceil(hi) + 3; if (hi - lo < 18) { const c = (lo + hi) / 2; lo = Math.floor(c - 9); hi = lo + 18; }
  const rowH = (H - 84) / (hi - lo + 1);
  return { x: 46 + (n.q0 + 0.3) * window.__daw.view.pxPerQ - sc.scrollLeft, y: 84 + (hi - n.effMidi + 0.5) * rowH, rowH };
})()`);

let projFile;
try {
  await page.goto(indexUrl);
  await step('sayfa yüklendi; hangi piyanonun çaldığı üst çubukta', async () => {
    await waitStatus(/Hazır/);
    await page.waitForFunction(() => /yedek|Salamander/.test(document.querySelector('#pianoBadge').textContent), null, { timeout: 30000 });
    const b = await page.textContent('#pianoBadge');
    assert.equal(b, 'Piyano: yedek sentez');
    return b;
  });

  await step('test melodisi → pitch detection', async () => {
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const n = await S(() => window.__daw.d.notes.length);
    assert.equal(n, 24);
    return `${n} nota`;
  });

  await step('3b) etiket düzeltme ton önerisinden önce yapılır ve histograma girer', async () => {
    const box0 = await page.locator('#tl').boundingBox();
    await page.click('#btnModeLabel');
    assert.equal(await page.isChecked('input[name=editMode][value=label]'), true);
    const h0 = await S(() => Array.from(window.__daw.d.keyInfo[window.__daw.d.sections[0].id].hist));
    const geo = await noteGeo(5);
    await page.mouse.click(box0.x + geo.x, box0.y + geo.y);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    const r = await S(() => { const d = window.__daw.d; return { lbl: d.notes[5].label, h: Array.from(d.keyInfo[d.sections[0].id].hist) }; });
    assert.equal(r.lbl, 64);
    assert.ok(r.h[4] > 0 && h0[4] === 0 && r.h[2] < h0[2]);
    await page.click('#btnClearLabels');
    assert.equal(await S(() => window.__daw.d.notes[5].label), null);
    await page.click('.seg input[value=select] + span');
    return `D4 → E4 etiketi: verse histogramında E %${Math.round(r.h[4] * 100)}; sıfırlandı`;
  });

  await step('4) ton önerileri görünüyor ve onaylanıyor', async () => {
    const txt = await page.textContent('#sectionList');
    assert.match(txt, /C# Frig/); assert.match(txt, /B Dorian/);
    assert.match(txt, /son ağırlıklı notası: C#/); assert.match(txt, /son ağırlıklı notası: B/);
    const cards = page.locator('.sec-card');
    await cards.nth(0).locator('li', { hasText: 'C# Frig' }).locator('button').click();
    await page.locator('.sec-card').nth(1).locator('li', { hasText: 'B Dorian' }).locator('button').click();
    const keys = await S(() => window.__daw.d.sections.map((s) => [s.name, window.Core.keyName(s.tonic, s.mode), s.confirmed]));
    assert.deepEqual(keys, [['Verse', 'C# Frig', true], ['Nakarat', 'B Dorian', true]]);
    return keys.map((k) => k.slice(0, 2).join(': ')).join(', ');
  });

  await step('5b) autotune pes notayı düzeltir, ayrı iz render edilir', async () => {
    await page.click('#btnAutoApply');
    await waitStatus(/Düzeltilmiş vokal hazır/);
    const r = await S(() => {
      const d = window.__daw.d, n = d.notes[3];
      return { cents: n.cents, applied: n.corr.applied, target: n.corr.target, same: window.__daw.corrected !== window.__daw.audio.data };
    });
    assert.equal(r.target, 62); assert.ok(Math.abs(r.applied - 40) < 6); assert.ok(r.same);
    return `D4 ${r.cents}c → +${Math.round(r.applied)}c kaydırma`;
  });

  await step('6) akorlar: verse C#m | Dmaj7 | C#m | Dmaj7 C#m, nakarat sonu Bm; M ve renk cezası ayarları', async () => {
    const names = () => S(() => window.__daw.d.chords.map((c) => window.Core.chordName(c.chord, c.flats)));
    const ch = await names();
    assert.deepEqual(ch.slice(0, 5), ['C#m', 'Dmaj7', 'C#m', 'Dmaj7', 'C#m']);
    assert.equal(ch[ch.length - 1], 'Bm');
    await page.fill('#inHomeEvery', '0'); await page.dispatchEvent('#inHomeEvery', 'change');
    const off = await names();
    assert.equal(off[2], 'Dmaj7');
    await page.locator('#inColorPen').fill('0.1');
    const pen = await names();
    assert.equal(pen[2], 'C#m');
    await page.locator('#inColorPen').fill('0');
    await page.fill('#inHomeEvery', '2'); await page.dispatchEvent('#inHomeEvery', 'change');
    assert.deepEqual(await names(), ch);
    return `${ch.join(' · ')} | M=0: ${off.slice(0, 4).join(' · ')} | +ceza 0.1: ${pen.slice(0, 4).join(' · ')}`;
  });

  const box = await page.locator('#tl').boundingBox();
  const slotX = async (bar) => S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); const s = d.chords.find((c) => c.bar === ${bar}); return 46 + ((s.q0 + s.q1) / 2) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);

  await step('7) akora tıklayınca 3 aday + roller; seçip kilitleme', async () => {
    await page.mouse.click(box.x + (await slotX(2)), box.y + 22 + 26 + 18);
    await page.waitForSelector('#inspector table');
    const rows = await page.locator('#inspector tbody tr').count();
    assert.ok(rows >= 3);
    const insp = await page.textContent('#inspector');
    assert.match(insp, /kök/);
    await page.locator('#inspector tbody tr').nth(1).locator('button').click();
    const lk = await S(() => window.__daw.proj.chordLocks.length);
    assert.equal(lk, 1);
    await page.fill('#chInput', 'F#m7/A');
    await page.click('#inspector button[data-act=manualChord]');
    const c2 = await S(() => { const s = window.__daw.d.chords.find((c) => c.bar === 2); return [window.Core.chordName(s.chord), s.locked, s.voicing.bass % 12]; });
    assert.deepEqual(c2, ['F#m7/A', true, 9]);
    await page.click('#inspector button[data-act=unlockChord]');
    assert.equal(await S(() => window.__daw.proj.chordLocks.length), 0);
    return `${rows} aday satırı, elle yazılan F#m7/A kilitlendi ve kaldırıldı`;
  });

  await step('5a) etiket düzeltme (sürükle) — ses değişmez', async () => {
    await page.click('.seg input[value=label] + span');
    const geo = await S(() => {
      const d = window.__daw.d, n = d.notes[12], sc = document.querySelector('#tlScroll');
      const H = sc.clientHeight; let lo = Infinity, hi = -Infinity;
      for (const k of d.notes) { lo = Math.min(lo, k.effMidi, k.median); hi = Math.max(hi, k.effMidi, k.median); }
      lo = Math.floor(lo) - 3; hi = Math.ceil(hi) + 3; if (hi - lo < 18) { const c = (lo + hi) / 2; lo = Math.floor(c - 9); hi = lo + 18; }
      const rowH = (H - 84) / (hi - lo + 1);
      return { x: 46 + (n.q0 + 0.3) * window.__daw.view.pxPerQ - sc.scrollLeft, y: 84 + (hi - n.effMidi + 0.5) * rowH, rowH, id: n.id };
    });
    const before = await S(() => Array.from(window.__daw.d.correction.shift.slice(0, 5000)).join());
    await page.mouse.move(box.x + geo.x, box.y + geo.y);
    await page.mouse.down();
    await page.mouse.move(box.x + geo.x, box.y + geo.y - geo.rowH * 2, { steps: 6 });
    await page.mouse.up();
    const r = await S(() => { const n = window.__daw.d.notes[12]; return [n.label, n.nearest]; });
    assert.equal(r[0], r[1] + 2);
    const after = await S(() => Array.from(window.__daw.d.correction.shift.slice(0, 5000)).join());
    assert.equal(before, after);
    return `B3 etiketi → C#4, ses kaydırma değişmedi`;
  });

  await step('5b) manuel ses düzeltme (sürükle) → kilitlenir, autotune dokunmaz', async () => {
    await page.click('.seg input[value=sound] + span');
    const geo = await S(() => {
      const d = window.__daw.d, n = d.notes[0], sc = document.querySelector('#tlScroll');
      const H = sc.clientHeight; let lo = Infinity, hi = -Infinity;
      for (const k of d.notes) { lo = Math.min(lo, k.effMidi, k.median); hi = Math.max(hi, k.effMidi, k.median); }
      lo = Math.floor(lo) - 3; hi = Math.ceil(hi) + 3; if (hi - lo < 18) { const c = (lo + hi) / 2; lo = Math.floor(c - 9); hi = lo + 18; }
      const rowH = (H - 84) / (hi - lo + 1);
      return { x: 46 + (n.q0 + 0.3) * window.__daw.view.pxPerQ - sc.scrollLeft, y: 84 + (hi - n.effMidi + 0.5) * rowH, rowH };
    });
    await page.mouse.move(box.x + geo.x, box.y + geo.y);
    await page.mouse.down();
    await page.mouse.move(box.x + geo.x, box.y + geo.y - geo.rowH, { steps: 5 });
    await page.mouse.up();
    await waitStatus(/Düzeltilmiş vokal hazır/);
    const r = await S(() => { const n = window.__daw.d.notes[0]; return { t: n.corr.target, src: n.corr.source, locked: n.locked, eff: n.effMidi, ap: n.corr.applied }; });
    assert.equal(r.t, 62); assert.equal(r.src, 'manual'); assert.ok(r.locked);
    assert.equal(r.eff, 61, 'ses kaydırma akor bulucunun gördüğü notayı değiştirmemeli');
    // Shift ile cent hassasiyeti
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    const t2 = await S(() => window.__daw.d.notes[0].corr.target);
    assert.equal(t2, 62.05);
    await page.click('#btnClearManual');
    await page.click('.seg input[value=select] + span');
    return `ses C#4 → D4 (+${Math.round(r.ap)}c), akor bulucu C#4 görmeye devam ediyor · Shift+↑ → +5c`;
  });

  await step('8) oynatma (Tone.js) + mikser + A/B', async () => {
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__daw.pos > 0.6, null, { timeout: 20000 });
    const st = await S(() => ({ pos: window.__daw.pos, tone: !!window.Tone, ctx: window.Tone.getContext().state }));
    await page.click('#btnAB');
    await page.locator('.strip[data-track=piano] .solo').click();
    await page.locator('.strip[data-track=piano] .solo').click();
    await page.click('#btnAB');
    await page.click('#btnPlay');
    assert.equal(st.ctx, 'running');
    const piano = await page.textContent('#pianoInfo');
    return `imleç ${st.pos.toFixed(2)} s · ${piano}`;
  });

  await step('9) dışa aktarım: MIDI, şema, WAV, mix', async () => {
    const mid = await download('#btnExpMidi');
    assert.equal(mid.data.slice(0, 4).toString(), 'MThd');
    const chart = await download('#btnExpChart');
    const ct = chart.data.toString('utf8');
    assert.match(ct, /\[Verse\] C# Frig/); assert.match(ct, /\[Nakarat\] B Dorian/);
    const voc = await download('#btnExpVocal');
    assert.equal(voc.data.slice(0, 4).toString(), 'RIFF');
    const mix = await download('#btnExpMix');
    assert.equal(mix.data.slice(0, 4).toString(), 'RIFF');
    assert.ok(mix.data.length > 44100 * 2 * 2 * 16);
    return `${mid.name} ${mid.data.length} B · ${voc.name} ${(voc.data.length / 1e6).toFixed(1)} MB · ${mix.name} ${(mix.data.length / 1e6).toFixed(1)} MB\n${ct}`;
  });

  await step('proje kaydet → yeni → aç (kilitler, düzeltmeler, ses dahil)', async () => {
    await page.mouse.click(box.x + (await slotX(3)), box.y + 22 + 26 + 18);
    await page.fill('#chInput', 'A');
    await page.click('#inspector button[data-act=manualChord]');
    const pj = await download('#btnSave');
    projFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-proje.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(projFile, pj.data);
    const j = JSON.parse(pj.data.toString());
    assert.ok(j.audioData && j.audioData.wavBase64.length > 1000);
    page.once('dialog', (d) => d.accept());
    await page.click('#btnNew');
    assert.equal(await S(() => window.__daw.audio), null);
    await page.setInputFiles('#fileProject', projFile);
    await waitStatus(/Proje açıldı/);
    const r = await S(() => ({ n: window.__daw.d.notes.length, locks: window.__daw.proj.chordLocks.length, bar3: window.Core.chordName(window.__daw.d.chords.find((c) => c.bar === 3).chord), sec: window.__daw.d.sections.map((s) => s.confirmed), at: window.__daw.proj.autotune.enabled, lbl: window.__daw.d.notes[12].label }));
    assert.equal(r.n, 24); assert.equal(r.locks, 1); assert.equal(r.bar3, 'A'); assert.deepEqual(r.sec, [true, true]); assert.ok(r.at); assert.equal(r.lbl, 61);
    await waitStatus(/Düzeltilmiş vokal hazır|Proje açıldı/);
    return `${(pj.data.length / 1e6).toFixed(1)} MB JSON; geri yüklendi`;
  });

  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'daw.png') });

  await step('2) WAV yükleme → verilen BPM\'e hizalama', async () => {
    const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
    const sb = {};
    new Function('globalThis', 'module', /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1])(sb, undefined);
    const t = sb.Core.synthTestVocal(44100, { leadSec: 0.37 });
    const wavPath = path.join(here, '..', '.tmp-upload.wav');
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(wavPath, Buffer.from(sb.Core.encodeWav([t.signal], t.sr)));
    await page.selectOption('#inAlign', 'bar1');
    await page.setInputFiles('#fileAudio', wavPath);
    await waitStatus(/Analiz tamam/);
    rmSync(wavPath, { force: true });
    const a = await S(() => ({ off: window.__daw.proj.audio.offsetSec, q0: window.__daw.d.notes[0].q0, n: window.__daw.d.notes.length }));
    assert.ok(Math.abs(a.off - 0.37) < 0.04, 'ofset ' + a.off);
    assert.ok(Math.abs(a.q0) < 0.1, 'ilk nota ' + a.q0);
    await page.selectOption('#inAlign', 'beat');
    const b = await S(() => ({ off: window.__daw.proj.audio.offsetSec, q0: window.__daw.d.notes[0].q0 }));
    assert.ok(Math.abs(b.q0 - 1) < 0.1, 'en yakın vuruş ' + b.q0);
    return `${a.n} nota · 1. ölçüye: ofset ${a.off.toFixed(3)} s → ilk nota q=${a.q0.toFixed(2)} · en yakın vuruşa: ofset ${b.off.toFixed(3)} s → q=${b.q0.toFixed(2)}`;
  });

  await step('2) kayıt: count-in + click, sahte mikrofonla', async () => {
    await page.fill('#inBpm', '120'); await page.dispatchEvent('#inBpm', 'change');
    await page.fill('#inLatency', '20'); await page.dispatchEvent('#inLatency', 'change');
    await page.click('#btnRec');
    await page.waitForFunction(() => /Kayıt — ölçü 2/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    await page.click('#btnRecStop');
    await waitStatus(/Analiz tamam/);
    const r = await S(() => ({ src: window.__daw.proj.audio.source, off: window.__daw.proj.audio.offsetSec, eff: window.Core.effectiveOffset(window.__daw.proj), dur: window.__daw.audio.data.length / window.__daw.audio.sr }));
    assert.equal(r.src, 'record');
    assert.ok(r.off > 2.0 && r.off < 2.6, 'ofset ' + r.off); // 0.3 s + 1 ölçü (2 s) count-in
    assert.ok(Math.abs(r.eff - r.off - 0.02) < 1e-9);
    return `kayıt ${r.dur.toFixed(1)} s, 1. ölçü ofseti ${r.off.toFixed(3)} s (+20 ms gecikme telafisi)`;
  });

  await step('1) gecikme kalibrasyonu: 8 click, alkış ofsetlerinin medyanı kaydedilir', async () => {
    await page.click('#btnLatencyCal');
    await page.waitForFunction(() => /Kayıt gecikmesi|Kalibrasyon başarısız/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    const r = await S(() => ({ m: window.__dawCal(), lat: window.__daw.proj.settings.latencyMs, info: document.querySelector('#latencyInfo').textContent }));
    assert.ok(r.m.detected >= 6, r.info);
    assert.ok(r.m.madMs <= 3, r.info);
    assert.equal(r.lat, r.m.latencyMs);
    assert.equal(await page.inputValue('#inLatency'), String(r.m.latencyMs));
    return r.info;
  });

  await step('1) BPM alanı 6/8\'de sayılan birimi gösterir', async () => {
    await page.selectOption('#inMeter', '6/8');
    const u = await page.textContent('#bpmUnit');
    assert.match(u, /noktalı çeyrek/);
    await page.selectOption('#inMeter', '4/4');
    assert.match(await page.textContent('#bpmUnit'), /çeyrek nota/);
    return `6/8: ${u}`;
  });

  assert.deepEqual(errors, [], 'tarayıcı hataları');
  console.log(log.join('\n'));
  console.log('\nArayüz testi geçti.');
} catch (e) {
  console.log(log.join('\n'));
  console.error('✘', e.stack || e);
  console.error('Tarayıcı hataları:', errors);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'fail.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (projFile) rmSync(projFile, { force: true });
  rmSync(clapPath, { force: true });
  await browser.close();
}

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
await page.route(/\/salamander\//, (r) => r.abort()); // iki kaynak da (github.io, jsDelivr)

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

  await step('5) süreli Viterbi (varsayılan): bölüm başına 3 alternatif, seçim zaman çizelgesini değiştirir', async () => {
    const names = () => S(() => window.__daw.d.chords.map((c) => window.Core.chordName(c.chord, c.flats)));
    assert.equal(await page.inputValue('#inEngine'), 'viterbi');
    const v = await names();
    assert.deepEqual(v.slice(0, 5), ['C#m', 'Dmaj7', 'C#m', 'Dmaj7', 'C#m']);
    assert.equal(v[v.length - 1], 'Bm');
    const radios = page.locator('#altBox input[type=radio]');
    assert.equal(await radios.count(), 6);
    await radios.nth(1).check();
    const alt = await names();
    assert.notDeepEqual(alt.slice(0, 5), v.slice(0, 5));
    await page.locator('#altBox input[type=radio]').nth(0).check();
    assert.deepEqual(await names(), v);
    const texts = await page.locator('#altBox label.alt').allTextContents();
    return `${v.join(' · ')} · verse alternatif 2: ${alt.slice(0, 5).join(' · ')} · ${texts[0].replace(/\s+/g, ' ').trim()}`;
  });

  await step('6) akorlar (ölçü ölçü motor): verse C#m | Dmaj7 | C#m | Dmaj7 C#m, nakarat sonu Bm; M ve renk cezası ayarları', async () => {
    await page.selectOption('#inEngine', 'greedy');
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
    await page.selectOption('#inEngine', 'viterbi');
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
    await page.locator('#inspector tbody tr').nth(1).locator('button[data-act=pickChord]').click();
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

  await step('5b) notayı sürükle: taşı / Shift ince akort / Alt etiket; her biri geri alınır', async () => {
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
    assert.equal(r.eff, 62, 'notayı taşı: kastedilen nota da D4 olur (akorlar onu kullanır)');
    assert.match(await page.textContent('#inspector .rm-bar'), /Taşındı: C#4 → D4/);
    assert.match(await page.textContent('#editSummary'), /Taşınan nota: 1/);
    // Shift ile cent hassasiyeti
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    const t2 = await S(() => window.__daw.d.notes[0].corr.target);
    assert.equal(t2, 62.05);
    // taşımayı geri al (panelin üstündeki ✕)
    await page.click('#inspector .rm-bar button');
    assert.deepEqual(await S(() => { const n = window.__daw.d.notes[0]; return [n.effMidi, n.manualTarget, n.locked]; }), [61, null, false]);
    // hassasiyet: 3 satır sürükle → tam 3 yarım ses (ölçek sürüklerken donar); tıklayınca ve her yeni yarım seste nota duyulur
    let g0 = await noteGeo(0);
    const heard = () => S(() => window.__dawAPI.notePreview().count);
    const h0 = await heard();
    await page.mouse.move(box.x + g0.x, box.y + g0.y); await page.mouse.down();
    const h1 = await heard();
    await page.mouse.move(box.x + g0.x, box.y + g0.y - g0.rowH * 3, { steps: 12 });
    const h2 = await heard();
    await page.mouse.up();
    assert.equal(h1 - h0, 1, 'tıklayınca nota çalmalı');
    assert.ok(h2 - h1 >= 3, 'sürüklerken her yeni yarım seste çalmalı: ' + (h2 - h1));
    assert.equal(await S(() => window.__daw.d.notes[0].effMidi), 64, '3 satır = 3 yarım ses');
    await page.click('#editSummary button[data-clear=move]');
    assert.equal(await S(() => window.__daw.d.notes[0].effMidi), 61);
    // Shift+sürükle: ince akort — nota aynı, yalnızca cent
    g0 = await noteGeo(0);
    await page.mouse.move(box.x + g0.x, box.y + g0.y);
    await page.keyboard.down('Shift'); await page.mouse.down();
    await page.mouse.move(box.x + g0.x, box.y + g0.y - g0.rowH * 0.6, { steps: 5 });
    await page.mouse.up(); await page.keyboard.up('Shift');
    const fine = await S(() => { const n = window.__daw.d.notes[0]; return { t: n.manualTarget, eff: n.effMidi }; });
    assert.equal(fine.eff, 61); assert.ok(fine.t > 61 && fine.t < 61.5, 'ince akort ' + fine.t);
    assert.match(await page.textContent('#inspector .rm-bar'), /Elle ince akort: C#4 \+\d+ cent/);
    // Alt+sürükle: yalnızca etiket — ses aynı
    await page.click('#editSummary button[data-clear=fine]');
    g0 = await noteGeo(0);
    await page.mouse.move(box.x + g0.x, box.y + g0.y);
    await page.keyboard.down('Alt'); await page.mouse.down();
    await page.mouse.move(box.x + g0.x, box.y + g0.y - g0.rowH, { steps: 5 });
    await page.mouse.up(); await page.keyboard.up('Alt');
    const lab = await S(() => { const n = window.__daw.d.notes[0]; return { l: n.label, t: n.manualTarget, eff: n.effMidi }; });
    assert.deepEqual(lab, { l: 62, t: null, eff: 62 });
    assert.match(await page.textContent('#inspector .rm-bar'), /Etiket \(yalnızca analiz\)/);
    await page.click('#inspector .rm-bar button[data-act=labelReset]');
    assert.equal(await S(() => window.__daw.d.notes[0].edit), null);
    return `tıkla → nota çaldı, 3 satır sürükle → ${h2 - h1} kez (her yarım seste) çaldı · sürükle → ses ve nota C#4 → D4 (+${Math.round(r.ap)}c), panelde "Taşındı" + ✕ · Shift+↑ → +5c · Shift+sürükle → ince akort ${Math.round((fine.t - 61) * 100)}c, nota aynı · Alt+sürükle → yalnızca etiket`;
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
    // öncü: vokal 3. vuruşta başlıyor → ilk nota q = 2 (1. ölçünün 3. vuruşu), ölçü çizgisi (1. vuruş) 2 vuruş sonra
    await page.selectOption('#inAlign', 'pickup');
    assert.ok(await page.isVisible('#inPickupBeat'));
    await page.selectOption('#inPickupBeat', '3');
    const pk = await S(() => ({ off: window.__daw.proj.audio.offsetSec, q0: window.__daw.d.notes[0].q0 }));
    assert.ok(Math.abs(pk.q0 - 2) < 0.1, 'öncü 3. vuruş: ilk nota ' + pk.q0);
    await page.check('#inDownbeatOnly');
    const mids = await S(() => window.__daw.d.chords.filter((c, i, a) => c.half === 1 && i > 0 && !window.__dawAPI.C.sameChord(a[i - 1].chord, c.chord)).length);
    assert.equal(mids, 0, 'yalnızca 1. vuruşta değişim');
    await page.uncheck('#inDownbeatOnly');
    await page.selectOption('#inAlign', 'beat');
    const b = await S(() => ({ off: window.__daw.proj.audio.offsetSec, q0: window.__daw.d.notes[0].q0 }));
    assert.ok(Math.abs(b.q0 - 1) < 0.1, 'en yakın vuruş ' + b.q0);
    return `${a.n} nota · 1. ölçüye: ofset ${a.off.toFixed(3)} s → ilk nota q=${a.q0.toFixed(2)} · öncü 3. vuruş: ofset ${pk.off.toFixed(3)} s → q=${pk.q0.toFixed(2)}, yalnızca 1. vuruşta değişim ✓ · en yakın vuruşa: ofset ${b.off.toFixed(3)} s → q=${b.q0.toFixed(2)}`;
  });

  await step('2) kayıt: count-in + click, sahte mikrofonla', async () => {
    await page.fill('#inBpm', '120'); await page.dispatchEvent('#inBpm', 'change');
    await page.fill('#inLatency', '20'); await page.dispatchEvent('#inLatency', 'change');
    await page.selectOption('#inClickFeel', 'halftime'); // kayıt click'i "tık tık tıss tık"
    await page.click('#btnRec');
    await page.waitForFunction(() => /Kayıt — ölçü 2/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    await page.click('#btnRecStop');
    await waitStatus(/Analiz tamam/);
    const r = await S(() => ({ src: window.__daw.proj.audio.source, off: window.__daw.proj.audio.offsetSec, eff: window.Core.effectiveOffset(window.__daw.proj), dur: window.__daw.audio.data.length / window.__daw.audio.sr }));
    assert.equal(r.src, 'record');
    assert.ok(r.off > 2.0 && r.off < 2.6, 'ofset ' + r.off); // 0.3 s + 1 ölçü (2 s) count-in
    assert.ok(Math.abs(r.eff - r.off - 0.02) < 1e-9);
    // kayıtta da öncü: ilk ses 1. ölçünün 3. vuruşuna; gecikme telafisi iki kez sayılmaz
    await page.selectOption('#inAlign', 'pickup');
    await page.selectOption('#inPickupBeat', '3');
    const pk = await S(() => ({ onset: window.__daw.onset, eff: window.Core.effectiveOffset(window.__daw.proj) }));
    assert.ok(Math.abs(pk.onset - pk.eff - 1.0) < 1e-6, `ilk ses t=${(pk.onset - pk.eff).toFixed(3)} s (3. vuruş = 1.000 s)`);
    await page.selectOption('#inAlign', 'none');
    assert.equal(await S(() => window.__daw.proj.audio.offsetSec), r.off, '"Yok" → kaydın click hizasına dönülür');
    return `kayıt ${r.dur.toFixed(1)} s, 1. ölçü ofseti ${r.off.toFixed(3)} s (+20 ms gecikme telafisi) · öncü 3. vuruş: ilk ses t=${(pk.onset - pk.eff).toFixed(3)} s`;
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

  await step('1) BPM alanı 6/8\'de sayılan birimi gösterir; 2/4; click deseni', async () => {
    await page.selectOption('#inMeter', '6/8');
    const u = await page.textContent('#bpmUnit');
    assert.match(u, /noktalı çeyrek/);
    assert.ok(await page.isDisabled('#inClickFeel'), 'yarım zaman deseni yalnızca 4/4');
    await page.selectOption('#inMeter', '2/4');
    assert.match(await page.textContent('#bpmUnit'), /çeyrek nota/);
    await page.selectOption('#inMeter', '4/4');
    assert.match(await page.textContent('#bpmUnit'), /çeyrek nota/);
    assert.ok(!(await page.isDisabled('#inClickFeel')));
    assert.equal(await page.inputValue('#inClickFeel'), 'halftime');
    await page.selectOption('#inClickFeel', 'normal');
    return `6/8: ${u} · 2/4 seçilebilir · click deseni yalnızca 4/4'te`;
  });

  await step('4) bölüm şeridi: tek tık bölüm açmaz; sürükle → bölüm; denetçiden ve Delete ile silinir', async () => {
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const tl = await page.locator('#tl').boundingBox();
    const barX = (bar) => S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); return 46 + ((${bar} - 1 + 0.5) * d.g.barQ) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    const y = tl.y + 22 + 13;
    const secs = () => S(() => window.__daw.proj.sections.map((x) => `${x.name} ${x.startBar}–${x.endBar}`));
    assert.deepEqual(await secs(), ['Verse 1–4', 'Nakarat 5–8']);
    // bölüme tıkla → seçilir; denetçideki "Bölümü sil"
    await page.mouse.click(tl.x + (await barX(6)), y);
    await page.click('#inspector button[data-act=secDelete]');
    assert.deepEqual(await secs(), ['Verse 1–4']);
    // boş şeride tek tık: bölüm açılmaz
    await page.mouse.click(tl.x + (await barX(6)), y);
    assert.deepEqual(await secs(), ['Verse 1–4']);
    assert.match(await page.textContent('#status'), /sürükleyin/);
    // sürükle: ölçü 5–7
    await page.mouse.move(tl.x + (await barX(5)), y); await page.mouse.down();
    await page.mouse.move(tl.x + (await barX(7)), y, { steps: 5 }); await page.mouse.up();
    const added = await secs();
    assert.equal(added.length, 2); assert.match(added[1], /5–7$/);
    // seç + Delete tuşu
    await page.mouse.click(tl.x + (await barX(6)), y);
    await page.keyboard.press('Delete');
    assert.deepEqual(await secs(), ['Verse 1–4']);
    return `denetçiden silindi · tek tık → bölüm yok · sürükle → ${added[1]} · Delete ile silindi`;
  });

  await step('Eklenen her şey tekrar tıklanınca en üstte "kaldır" satırıyla gelir (nota, akor kilidi, bölüm kilitleri)', async () => {
    const tl = await page.locator('#tl').boundingBox();
    const rm = () => page.locator('#inspector .rm-bar button').allTextContents();
    // nota: etiket + kilit → iki satır + "Hepsini kaldır"
    const geo = await noteGeo(2);
    await page.mouse.click(tl.x + geo.x, tl.y + geo.y);
    assert.deepEqual(await rm(), []);
    await page.click('#inspector button[data-act=label][data-v="1"]');
    await page.check('#inspector input[data-act=lock]');
    assert.deepEqual(await rm(), ['✕ Etiketi kaldır', "✕ Autotune'a geri ver", '✕ Hepsini kaldır']);
    if (shotDir) await page.locator('#inspector').screenshot({ path: path.join(shotDir, 'remove-bar.png') });
    await page.click('#inspector button[data-act=labelReset]');
    assert.deepEqual(await rm(), ["✕ Autotune'a geri ver"]);
    await page.click('#inspector button[data-act=noteUnlock]');
    assert.deepEqual(await rm(), []);
    assert.equal(await S(() => window.__daw.proj.noteEdits.length), 0);
    // akor: seç + kilitle → üstte "Kilidi kaldır"
    const sx = await S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); const s = d.chords.find((c) => c.bar === 2); return 46 + ((s.q0 + s.q1) / 2) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    await page.mouse.click(tl.x + sx, tl.y + 22 + 26 + 18);
    await page.locator('#inspector tbody button[data-act=pickChord]').nth(1).click();
    await page.mouse.click(tl.x + sx, tl.y + 22 + 26 + 18);
    assert.deepEqual(await rm(), ['✕ Kilidi kaldır (otomatiğe dön)']);
    // bölüm: kilitli akor varsa "Bölümdeki kilitleri kaldır"
    const bx = await S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); return 46 + 1.5 * d.g.barQ * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    await page.mouse.click(tl.x + bx, tl.y + 22 + 13);
    assert.deepEqual(await rm(), ['✕ Bölümü sil', '✕ Bölümdeki kilitleri kaldır']);
    await page.click('#inspector button[data-act=secUnlockAll]');
    assert.deepEqual(await rm(), ['✕ Bölümü sil']);
    assert.equal(await S(() => window.__daw.proj.chordLocks.length), 0);
    return 'nota: etiket / kilit / hepsi · akor: kilidi kaldır · bölüm: sil / kilitleri kaldır';
  });

  await step('Akora tıklayınca duyulur; adaylar ▶ ile kilitlemeden dinlenir; kilit ✕ / Delete / "Tüm kilitleri kaldır" ile kalkar', async () => {
    const tl = await page.locator('#tl').boundingBox();
    const cy = tl.y + 22 + 26 + 18;
    const geo = (bar) => S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); const s = d.chords.find((c) => c.bar === ${bar}); const px = window.__daw.view.pxPerQ; return { mid: 46 + ((s.q0 + s.q1) / 2) * px - sc.scrollLeft, right: 46 + s.q1 * px - sc.scrollLeft }; })()`);
    const locks = () => S(() => window.__daw.proj.chordLocks.length);
    // tıkla → çalar (durum satırı "▶ akor"), kilit yok
    let g2 = await geo(2);
    await page.mouse.click(tl.x + g2.mid, cy);
    await waitStatus(/^▶ /);
    const heard = await page.textContent('#status');
    assert.equal(await locks(), 0);
    // aday ▶: çalar, kilitlemez
    await page.locator('#inspector tbody button[data-act=hearChord]').nth(1).click();
    await page.waitForFunction((h) => document.querySelector('#status').textContent !== h, heard);
    assert.match(await page.textContent('#status'), /^▶ /);
    assert.equal(await locks(), 0);
    // kilitle → ✕ ile kaldır
    await page.locator('#inspector tbody button[data-act=pickChord]').nth(1).click();
    assert.equal(await locks(), 1);
    g2 = await geo(2);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'chord-lock-x.png'), clip: { x: tl.x, y: tl.y, width: 700, height: 90 } });
    await page.mouse.click(tl.x + g2.right - 10, cy - 4);
    assert.equal(await locks(), 0);
    assert.match(await page.textContent('#status'), /kilit kaldırıldı/);
    // kilitle → seçiliyken Delete
    await page.mouse.click(tl.x + g2.mid, cy);
    await page.locator('#inspector tbody button[data-act=pickChord]').nth(1).click();
    assert.equal(await locks(), 1);
    await page.keyboard.press('Delete');
    assert.equal(await locks(), 0);
    // iki kilit → "Tüm akor kilitlerini kaldır (2)"
    await page.locator('#inspector tbody button[data-act=pickChord]').nth(1).click();
    const g3 = await geo(3);
    await page.mouse.click(tl.x + g3.mid, cy);
    await page.locator('#inspector tbody button[data-act=pickChord]').nth(1).click();
    assert.match(await page.textContent('#btnUnlockAll'), /\(2\)/);
    await page.click('#btnUnlockAll');
    assert.equal(await locks(), 0);
    assert.ok(await page.isDisabled('#btnUnlockAll'));
    return `tıkla → "${heard}" · aday ▶ kilitlemedi · ✕, Delete ve "Tüm akor kilitlerini kaldır (2)" çalıştı`;
  });

  await step('Akor kilitlenince diğerleri değişmez; motorun önerisi "→" ve nedeniyle gelir, istenirse uygulanır', async () => {
    const tl = await page.locator('#tl').boundingBox();
    const cy = tl.y + 22 + 26 + 18;
    const mid = (bar) => S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); const s = d.chords.find((c) => c.bar === ${bar}); return 46 + ((s.q0 + s.q1) / 2) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    const names = () => S(() => window.__daw.d.chords.map((c) => window.__dawAPI.C.chordName(Object.assign({}, c.chord, { bass: c.chord.bass ?? (c.inversion ? c.voicing.bassPc : null) }))));
    const n0 = await names();
    await page.mouse.click(tl.x + (await mid(2)), cy);
    await page.fill('#chInput', 'A'); await page.click('#inspector button[data-act=manualChord]');
    const n1 = await names();
    n0.forEach((x, i) => { if (i !== 1) assert.equal(n1[i], x, 'akor ' + i + ' değişti'); });
    assert.equal(n1[1], 'A');
    assert.match(await page.textContent('#btnApplySug'), /\(1\)/);
    // bar 1: sabit + öneri ve neden
    await page.mouse.click(tl.x + (await mid(1)), cy);
    const insp = await page.textContent('#inspector');
    assert.match(insp, /Sabit: başka bir akoru kilitlediğin için/);
    assert.match(insp, /Motor burada A önerir — sonraki akorla \(A\) birleşip tek akor olur/);
    if (shotDir) await page.locator('#inspector').screenshot({ path: path.join(shotDir, 'pin-suggest.png') });
    // kilitli akor: sürtünme uyarısı
    await page.mouse.click(tl.x + (await mid(2)), cy);
    assert.match(await page.textContent('#inspector'), /⚠ Melodiyle yarım ses sürtünmesi/);
    // öneriyi uygula (yalnızca o akor)
    await page.mouse.click(tl.x + (await mid(1)), cy);
    await page.click('#inspector button[data-act=applyPinSug]');
    const n2 = await names();
    assert.equal(n2[0], 'A');
    n1.forEach((x, i) => { if (i > 1) assert.equal(n2[i], x); });
    await page.click('#btnUnlockAll');
    assert.deepEqual(await names(), n0);
    return `kilit sonrası değişen yok · ölçü 1 önerisi: "${insp.match(/Motor burada[^.]*/)[0].slice(0, 80)}" · uygula → yalnızca ölçü 1 değişti · tüm kilitleri kaldır → başlangıç`;
  });

  await step('Kendi akor şablonun: yaz / .txt yükle → melodinin üzerinde kilitli çalar; hata satırıyla; diğer akorlar değişmez; kaldır', async () => {
    page.once('dialog', (d) => d.accept());
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const names = () => S(() => window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}${c.lockSrc === 'chart' ? '📄' : ''}`));
    const n0 = await names();
    assert.ok(n0.some((x) => x.startsWith('5:')), 'nakarat var');
    await page.click('#chartBox summary');
    // hata: hiçbir şey uygulanmaz
    await page.fill('#chartText', '[Verse]\n| A | Xyz |');
    await page.click('#btnChartApply');
    assert.match(await page.textContent('#chartMsg'), /Satır 2: "Xyz" akor olarak anlaşılamadı/);
    assert.deepEqual(await names(), n0);
    // metinle: verse'te 1–2 ve 4 (yarım ölçü), 3 boş (otomatik)
    await page.fill('#chartText', '[Verse] — ölçü 1–4\n| A | E / / / |   | F#m Bm |');
    await page.click('#btnChartApply');
    const n1 = await names();
    assert.deepEqual(n1.slice(0, 2), ['1:A📄', '2:E📄']);
    assert.ok(n1.includes('4.0:F#m📄') && n1.includes('4.1:Bm📄'));
    assert.ok(!n1.some((x) => x.startsWith('3') && x.includes('📄')), 'boş hücre otomatik');
    n0.filter((x) => +x.split(/[.:]/)[0] >= 5).forEach((x) => assert.ok(n1.includes(x), 'nakarat değişmemeli: ' + x));
    assert.match(await page.textContent('#chartMsg'), /4 akor 3 ölçüye kilitli olarak yerleşti/);
    assert.match(await page.textContent('#btnChartRemove'), /\(4\)/);
    // panelde kaynak
    const tl = await page.locator('#tl').boundingBox();
    const mid = await S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); const s = d.chords.find((c) => c.bar === 1); return 46 + ((s.q0 + s.q1) / 2) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    await page.mouse.click(tl.x + mid, tl.y + 22 + 26 + 18);
    assert.match(await page.textContent('#inspector .rm-bar'), /Bu akor senin şablonundan: A/);
    // kaldır → başlangıç
    await page.click('#btnChartRemove');
    assert.deepEqual(await names(), n0);
    // .txt dosyası: DAW'ın "şu anki akorlar" şablonu → değiştir → yükle (gidiş-dönüş)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnChartCurrent')]);
    const txt = readFileSync(await dl.path(), 'utf8').replace('| Bm |', '| G |');
    await page.setInputFiles('#fileChart', { name: 'sarkim.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
    await page.waitForFunction(() => /yerleşti/.test(document.querySelector('#chartMsg').textContent));
    const n2 = await names();
    assert.equal(n2.find((x) => x.startsWith('5:')), '5:G📄');
    assert.ok(n2.every((x) => x.endsWith('📄')), 'şablondaki her ölçü kilitli');
    await page.click('#btnChartRemove');
    return `hata satırıyla, uygulanmadı · metin → ${n1.slice(0, 5).join(' ')} (3. ölçü otomatik, nakarat aynı) · indir → değiştir (5: Bm→G) → .txt yükle → ${n2.length} akor 📄 · kaldır → başlangıç`;
  });

  await step('Değişim noktaları: üst şeritteki noktaya tıkla → ✂ değiş → = değişme → yok; diğer akorlar aynı; panelden "ölçünün ortasında değiştir"; yalnızca işaretli', async () => {
    page.once('dialog', (d) => d.accept());
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const tl = await page.locator('#tl').boundingBox();
    const bandY = tl.y + 22 + 26 + 5;
    const bx = (bar, half) => S(`(() => { const d = window.__daw.d, sc = document.querySelector('#tlScroll'); return 46 + ((${bar} - 1) * d.g.barQ + ${half} * d.g.split) * window.__daw.view.pxPerQ - sc.scrollLeft; })()`);
    const chords = () => S(() => window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}`));
    const marks = () => S(() => JSON.stringify(window.__daw.proj.changeMarks));
    const n0 = await chords();
    // ölçü 6 ortası (Eadd9 tam ölçü) → ✂
    await page.mouse.click(tl.x + (await bx(6, 1)), bandY);
    assert.equal(await marks(), '[{"bar":6,"half":1,"kind":"change"}]');
    const n1 = await chords();
    assert.ok(n1.some((x) => x.startsWith('6.1:')) && n1.some((x) => x.startsWith('6.0:')), 'ölçü 6 ikiye bölünmeli: ' + n1.join(' '));
    n0.filter((x) => !x.startsWith('6')).forEach((x) => assert.ok(n1.includes(x), 'değişmemeli: ' + x));
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'marks.png'), clip: { x: tl.x, y: tl.y, width: 1150, height: 90 } });
    // tekrar → = ; tekrar → yok
    await page.mouse.click(tl.x + (await bx(6, 1)), bandY);
    assert.equal(await marks(), '[{"bar":6,"half":1,"kind":"hold"}]');
    await page.mouse.click(tl.x + (await bx(6, 1)), bandY);
    assert.equal(await marks(), '[]');
    // akor gövdesine tıklamak işaret koymaz, akoru seçer
    await page.mouse.click(tl.x + (await bx(2, 1)), tl.y + 22 + 26 + 18);
    assert.equal(await marks(), '[]');
    // panelden: ölçünün ortasında değiştir
    await page.click('#inspector button[data-act=markSet][data-half="1"][data-kind=change]');
    assert.equal(await marks(), '[{"bar":2,"half":1,"kind":"change"}]');
    const n2 = await chords();
    assert.ok(n2.some((x) => x.startsWith('2.0:')) && n2.some((x) => x.startsWith('2.1:')));
    const root = (x) => x.split(':')[1].match(/^[A-G][#b]?/)[0];
    assert.notEqual(root(n2.find((x) => x.startsWith('2.0:'))), root(n2.find((x) => x.startsWith('2.1:'))), '✂ noktasında kök değişmeli');
    // yalnızca işaretli: verse yalnızca ölçü 2 ortasında değişir
    await page.check('#inOnlyMarked');
    const n3 = await chords();
    const verse = n3.filter((x) => +x.split(/[.:]/)[0] <= 4).map((x) => x.split(':')[1]);
    const runs = verse.filter((c, i) => i === 0 || c !== verse[i - 1]);
    assert.equal(runs.length, 2, 'verse 2 akor (tek değişim): ' + verse.join(' '));
    await page.uncheck('#inOnlyMarked');
    await page.click('#btnClearMarks');
    assert.equal(await marks(), '[]');
    return `✂ 6½ → ${n1.filter((x) => x.startsWith('6')).join(' ')}, diğerleri aynı · tekrar tık → = → yok · akor gövdesi seçer · panel "✂ Ölçünün ortasında değiştir" → ${n2.filter((x) => x.startsWith('2')).join(' ')} · yalnızca işaretli → verse ${runs.join(' → ')}`;
  });

  await step('Davul: ölçü tahmini paneli + Uygula; vurgulara göre loop; oynatmada davul; uymayınca "bulamadım" + tarif', async () => {
    page.once('dialog', (d) => d.accept());
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    assert.match(await page.textContent('#meterEst'), /Ölçü tahmini: 4\/4/);
    assert.match(await page.textContent('#meterEst'), /Proje ölçüsüyle uyumlu/);
    // proje ölçüsünü yanlış seç (3/4) → tahmin uyarır, Uygula ile 4/4'e döner
    await page.selectOption('#inMeter', '3/4');
    assert.match(await page.textContent('#meterEst'), /Uygula: 4\/4/);
    const loops34 = await page.locator('#inDrumLoop option').allTextContents();
    assert.ok(loops34.some((x) => /Vals/.test(x)) && !loops34.some((x) => /Rock \/ pop|Basic backbeat/.test(x)), 'loop listesi proje ölçüsüne göre');
    await page.click('#btnMeterApply');
    assert.equal(await page.inputValue('#inMeter'), '4/4');
    const auto = await page.textContent('#inDrumLoop option[value=auto]');
    assert.match(auto, /Otomatik \(öneri: .+\)/);
    assert.match(await page.textContent('#drumGrid'), /Kick\s+\|/);
    // oynatmada davul vuruşları zamanlanır
    await page.check('#inDrumsOn');
    const h0 = await S(() => window.__dawAPI.player().drumHits || 0);
    await page.click('#btnPlay');
    await page.waitForFunction((h) => (window.__dawAPI.player().drumHits || 0) > h + 4, h0, { timeout: 15000 });
    await page.click('#btnPlay');
    // tek loop'u elle seç; ▶ Loop
    await page.selectOption('#inDrumLoop', 'half');
    assert.match(await page.textContent('#drumInfo'), /Yarım zaman/);
    await page.click('#btnDrumPreview');
    await waitStatus(/▶ Yarım zaman/);
    await page.click('#btnDrumStop');
    // 45 kalıp: kategorilere göre gruplanmış liste; tom'lu kalıp seçilince ızgarada tom şeritleri, ▶ Loop çalar
    const groups = await page.locator('#inDrumLoop optgroup').evaluateAll((els) => els.map((e) => e.label));
    assert.deepEqual(groups.slice(0, 3), ['4/4 · temel rock kalıpları', '4/4 · post-punk, darkwave, synthwave', '4/4 · half-time ailesi']);
    assert.ok((await page.locator('#inDrumLoop option').allTextContents()).some((x) => /^8 · Tom-ağırlıklı tribal/.test(x)));
    await page.selectOption('#inDrumLoop', 'tribal');
    assert.match(await page.textContent('#drumGrid'), /Floor tom\s+\|[\s\S]*Tom\s+\|/);
    assert.doesNotMatch(await page.textContent('#drumGrid'), /Hi-hat/);
    const h1 = await S(() => window.__dawAPI.player().drumHits || 0);
    await page.click('#btnDrumPreview');
    await page.waitForFunction((h) => (window.__dawAPI.player().drumHits || 0) > h + 8, h1, { timeout: 15000 });
    await page.click('#btnDrumStop');
    await page.selectOption('#inDrumLoop', 'gated');
    assert.match(await page.textContent('#drumGrid'), /Fill \(her 4\. ölçü\)/);
    // uygun loop yok: 260 BPM
    await page.selectOption('#inDrumLoop', 'auto');
    await page.fill('#inBpm', '260'); await page.dispatchEvent('#inBpm', 'change');
    const info = await page.textContent('#drumInfo');
    assert.match(info, /Bu melodiye uygun bir loop bulamadım/);
    assert.match(await page.inputValue('#drumRequest'), /Tempo: 260 BPM/);
    if (shotDir) await page.locator('details.step:has(#drumInfo)').screenshot({ path: path.join(shotDir, 'drums-notfound.png') });
    await page.fill('#inBpm', '120'); await page.dispatchEvent('#inBpm', 'change');
    if (shotDir) await page.locator('details.step:has(#drumInfo)').screenshot({ path: path.join(shotDir, 'drums.png') });
    // mikserde davul kanalı
    await page.locator('.strip[data-track=drums] .mute').click();
    assert.equal(await S(() => window.__daw.proj.mixer.drums.mute), true);
    await page.locator('.strip[data-track=drums] .mute').click();
    await page.uncheck('#inDrumsOn');
    return `tahmin 4/4 · 3/4 seçilince "Uygula" → 4/4 · ${auto.trim()} · oynatmada davul çaldı · 260 BPM → bulamadım + tarif`;
  });

  await step('Gitar: altı katman birbirini sıfırlamadan sesi değiştirir; allDown / meter filtresi / letRing ↔ palmMute; ön dinleme; bölüme atama; preset; enstrüman seçimi ve dışa aktarım', async () => {
    assert.equal(await S(() => window.__daw.d.notes.length), 24, 'önceki adımdan yüklü test melodisi');
    await S(() => { window.confirm = () => true; }); // "yeni proje?" onayı
    const part = () => S(() => JSON.parse(JSON.stringify(window.__daw.proj.guitar.parts._all)));
    const flat = (o, pre = '', out = {}) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, pre + k + '.', out); else out[pre + k] = JSON.stringify(v); } return out; };
    const diff = (a, b) => { const x = flat(a), y = flat(b); return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]); };
    const evSig = () => S(() => { const s = window.__daw, C = window.Core; return JSON.stringify(C.guitarEvents(C.guitarSlotsFrom(s.d), s.d.g, (sl) => C.guitarPartFor(s.proj.guitar, sl.section)).map((e) => [e.kind, +e.t.toFixed(4), e.midi, +e.dur.toFixed(3), e.dir, e.art, e.step])); });
    const midiTracks = () => S(() => { const s = window.__daw, C = window.Core; return C.parseMidi(C.exportMidi(s.proj, s.d, null)).tracks.map((t) => `${t.name}:${t.notes.length}`); });
    const click = (k, v) => page.click(`#guitarPanel [data-k=${k}][data-v="${v}"]`);
    // varsayılan: piyano; piyano izi gitar eklenmeden önceki gibi
    assert.equal(await S(() => window.__daw.proj.guitar.instrument), 'piano');
    const tracks0 = await midiTracks();
    assert.ok(tracks0.some((t) => /^Piyano akorları:[1-9]/.test(t)) && !tracks0.some((t) => /^Gitar/.test(t)), tracks0.join(' | '));
    // panel: 6 satır, tremolo v2'de kapalı
    assert.equal(await page.locator('#guitarPanel .grow-l').count(), 6);
    assert.equal(await page.locator('#guitarPanel [data-k=mode]').count(), 4); assert.ok(await page.locator('#guitarPanel [data-k=mode][data-v=tremolo]').isDisabled());
    // 1) hiçbir seçim diğer katmanları sıfırlamaz
    const changes = [];
    let a = await part();
    await click('pat', 'folk'); let b = await part(); changes.push(['kalıp', diff(a, b)]); assert.ok(diff(a, b).every((k) => /^(pattern|stepOverrides)/.test(k)) && diff(a, b).length, 'kalıp: ' + diff(a, b));
    const sigU = await evSig(); assert.ok(JSON.parse(sigU).some((e) => e[4] === 'U'));
    a = b; await click('dmode', 'allDown'); b = await part(); assert.deepEqual(diff(a, b), ['directionMode']);
    assert.ok(!JSON.parse(await evSig()).some((e) => e[4] === 'U'), 'allDown: U vuruşu çalmaz');
    await click('dmode', 'alternate'); assert.equal(await evSig(), sigU, 'alternate: kalıp aynen geri gelir');
    a = await part(); await click('mode', 'bassChord'); b = await part(); assert.deepEqual(diff(a, b), ['mode']); changes.push(['vuruş modu', diff(a, b)]);
    const sigBc = await evSig(); assert.notEqual(sigBc, sigU);
    a = b; await click('pos', 'open'); b = await part(); assert.deepEqual(diff(a, b), ['voicing.position']); changes.push(['voicing', diff(a, b)]);
    a = b; await click('color', 'sus4'); b = await part(); assert.deepEqual(diff(a, b), ['voicing.color']);
    a = b; await click('shape', 'power'); b = await part(); assert.deepEqual(diff(a, b), ['voicing.shape']);
    assert.ok(await page.locator('#guitarPanel [data-k=drone]').isDisabled(), 'tonik boş telde yok → drone kapalı, neden gösterilir');
    assert.match(await page.textContent('#guitarPanel'), /boş tel olarak bulunamıyor|yeterli tel kalmıyor/);
    await click('shape', 'full'); await click('color', 'none'); await click('pos', 'auto');
    a = await part(); await click('art', 'staccato'); b = await part(); assert.deepEqual(diff(a, b), ['articulation']); changes.push(['nota süresi', diff(a, b)]);
    a = b; await click('tone', 'crunch'); b = await part(); assert.deepEqual(diff(a, b), ['tone']); changes.push(['ton/FX', diff(a, b)]);
    a = b; await page.locator('#guitarPanel [data-s=chorus]').fill('40'); await page.dispatchEvent('#guitarPanel [data-s=chorus]', 'input'); b = await part(); assert.deepEqual(diff(a, b), ['fx.chorus']);
    await click('mode', 'strum'); await click('art', 'normal'); await click('tone', 'clean'); await page.locator('#guitarPanel [data-s=chorus]').fill('0'); await page.dispatchEvent('#guitarPanel [data-s=chorus]', 'input');
    // adım ızgarası: tıkla = döngü + seç; süsleme + nota süresi ezmesi; letRing ile palmMute birlikte atanamaz
    const t0 = await part();
    await page.click('#guitarPanel .gstep[data-i="1"]'); // folk: 2. adım es → D
    assert.equal((await part()).pattern.steps[1].type, 'D'); assert.equal((await part()).pattern.id, 'custom');
    a = await part(); await click('orn', 'slideIn'); b = await part(); assert.deepEqual(diff(a, b), ['stepOverrides.1.ornament']);
    await click('orn', 'none');
    await page.click('#guitarPanel .gstep[data-i="1"]'); assert.equal((await part()).pattern.steps[1].type, 'U');
    await page.click('#guitarPanel .gstep[data-i="1"]'); assert.equal((await part()).pattern.steps[1].type, 'dead');
    await page.click('#guitarPanel .gstep[data-i="1"]'); assert.equal((await part()).pattern.steps[1].type, 'rest');
    await page.click('#guitarPanel .gstep[data-i="0"]'); await page.click('#guitarPanel .gstep[data-i="0"]'); await page.click('#guitarPanel .gstep[data-i="0"]'); await page.click('#guitarPanel .gstep[data-i="0"]'); // D → U → ✕ → es → D
    assert.equal((await part()).pattern.steps[0].type, 'D');
    await click('sart', 'letRing'); assert.equal((await part()).stepOverrides[0].articulation, 'letRing');
    await click('sart', 'palmMute');
    const so = (await part()).stepOverrides[0];
    assert.equal(so.articulation, 'palmMute'); assert.equal(await page.locator('#guitarPanel [data-k=sart].on').count(), 1, 'tek seçim: letRing kalkar');
    assert.ok(!JSON.stringify(so).includes('letRing'));
    await page.dispatchEvent('#guitarPanel .gstep[data-i="2"]', 'pointerdown'); await page.waitForTimeout(600); // uzun bas = vurgu
    assert.equal((await part()).pattern.steps[2].accent, true);
    // meter 3/4: 4/4 kalıpları listeden kalkar
    await page.selectOption('#inMeter', '3/4');
    const pats34 = await page.locator('#guitarPanel [data-k=pat]').allTextContents();
    assert.deepEqual(pats34, ['Vals']); assert.equal((await part()).pattern.id, 'waltz');
    await page.selectOption('#inMeter', '4/4');
    const pats44 = await page.locator('#guitarPanel [data-k=pat]').allTextContents();
    assert.ok(pats44.includes("Düz 8'likler") && !pats44.includes('Vals'));
    await click('mode', 'arpeggio');
    const patsArp = await page.locator('#guitarPanel [data-k=pat]').allTextContents();
    assert.ok(!patsArp.some((x) => /skank|Gallop|funk/.test(x)), 'arpejde strum kalıpları kapalı: ' + patsArp.join(','));
    await click('mode', 'strum'); await click('pat', 'folk');
    // ön dinleme: gerçek akor akışı; seçim anında sese yansır
    await page.click('#btnGAudition');
    await waitStatus(/Gitar önizleme · projenin akorları/);
    const same = await S(() => { window.__t = window.__dawAPI.player().gAud; return !!window.__t; });
    assert.ok(same);
    await click('tone', 'drive');
    await page.waitForFunction(() => window.__dawAPI.player().gAud && window.__dawAPI.player().gAud !== window.__t, null, { timeout: 15000 });
    await page.click('#btnGStop');
    assert.equal(await S(() => window.__dawAPI.player().gAud), null);
    await click('tone', 'clean');
    // akor değişince gitar o akora göre yeniden üretilir
    const before = await evSig();
    await S(() => { const s = window.__daw; s.proj.chordLocks.push({ bar: 1, half: null, chord: { root: 7, q: '7', bass: null } }); window.__dawAPI.refresh(); });
    const after = await evSig();
    assert.notEqual(before, after); assert.ok(JSON.parse(after).some((e) => e[2] != null && e[2] % 12 === 5), 'G7: 7\'li (F) çalar');
    await S(() => { window.__daw.proj.chordLocks = []; window.__dawAPI.refresh(); });
    // bölüme atama
    await page.selectOption('#gTarget', { index: 2 });
    assert.ok(await page.isVisible('#gSecOwn')); assert.ok(await page.locator('#guitarPanel .gdis').count() === 1);
    await page.click('#gSecOwn');
    const secId = await S(() => Object.keys(window.__daw.proj.guitar.parts).find((k) => k !== '_all'));
    assert.ok(secId);
    await click('mode', 'arpeggio');
    assert.deepEqual(await S(() => [window.__daw.proj.guitar.parts._all.mode, window.__daw.proj.guitar.parts[Object.keys(window.__daw.proj.guitar.parts).find((k) => k !== '_all')].mode]), ['strum', 'arpeggio']);
    const evTwo = JSON.parse(await evSig());
    assert.ok(evTwo.length > 0);
    // 2. bölümde arpej (tek nota / adım), 1. bölümde strum: aynı ölçüde olay sayıları çok farklı
    const perSec = await S(() => { const s = window.__daw, C = window.Core; const ev = C.guitarEvents(C.guitarSlotsFrom(s.d), s.d.g, (sl) => C.guitarPartFor(s.proj.guitar, sl.section)); const bar = (e) => Math.floor(e.q / s.d.g.barQ) + 1; const n = (b) => ev.filter((e) => bar(e) === b).length; return [n(2), n(6)]; });
    assert.ok(perSec[0] > 2 * perSec[1], `1. bölüm strum (${perSec[0]}) > 2. bölüm arpej (${perSec[1]})`);
    await page.click('#gSecReset');
    assert.equal(await S(() => Object.keys(window.__daw.proj.guitar.parts).length), 1);
    await page.selectOption('#gTarget', '_all');
    // preset: kaydet → değiştir → yükle → aynı kombinasyon; proje dosyasıyla geri gelir
    await click('tone', 'crunch'); await click('art', 'letRing'); await click('pos', 'open');
    const saved = await part();
    await page.fill('#gPresetName', 'Demo 1'); await page.click('#gPresetSave');
    assert.equal(await S(() => window.__daw.proj.guitar.presets.length), 1);
    await click('tone', 'drive'); await click('art', 'palmMute'); await click('pos', 'barre');
    await page.click('#gPresets [data-pl="0"]');
    assert.deepEqual(await part(), saved, 'yüklenen preset kaydedilenle aynı');
    assert.equal(await evSig() === (await (async () => { await click('tone', 'drive'); await click('tone', 'crunch'); return evSig(); })()), true, 'aynı kombinasyon aynı olaylar');
    await page.click('#gInstr input[value=both] + span');
    const pj = await download('#btnSave');
    const { writeFileSync: wf } = await import('node:fs');
    const f2 = path.join(here, '..', '.tmp-gitar.json'); wf(f2, pj.data);
    await page.click('#btnNew');
    assert.equal(await S(() => window.__daw.proj.guitar.presets.length), 0);
    await page.setInputFiles('#fileProject', f2);
    await waitStatus(/Proje açıldı/);
    const back = await S(() => ({ ins: window.__daw.proj.guitar.instrument, pre: window.__daw.proj.guitar.presets.map((p) => p.name), part: window.__daw.proj.guitar.parts._all }));
    assert.equal(back.ins, 'both'); assert.deepEqual(back.pre, ['Demo 1']); assert.deepEqual(back.part, saved);
    rmSync(f2, { force: true });
    // oynatma: piyano + gitar birlikte; gitar kanalı mikserde; durdurunca gitar da durur
    await page.click('#btnPlay');
    await page.waitForFunction(() => !!window.__dawAPI.player().gSrc, null, { timeout: 30000 });
    await page.locator('.strip[data-track=guitar] .mute').click();
    assert.equal(await S(() => window.__daw.proj.mixer.guitar.mute), true);
    await page.locator('.strip[data-track=guitar] .mute').click();
    await page.click('#btnPlay');
    assert.equal(await S(() => window.__dawAPI.player().gSrc), null);
    // enstrüman seçimi: MIDI + mix WAV
    assert.deepEqual(await midiTracks().then((t) => t.map((x) => x.split(':')[0]).filter(Boolean)), ['Vokal (düzeltilmiş melodi)', 'Piyano akorları', 'Gitar']);
    await page.click('#gInstr input[value=guitar] + span');
    const tg = await midiTracks();
    assert.ok(!tg.some((t) => /^Piyano/.test(t)) && tg.some((t) => /^Gitar:[1-9]/.test(t)), tg.join(' | '));
    const rmsOf = (wav) => { const d = Core.decodeWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)).data; let e = 0; for (const v of d) e += v * v; return Math.sqrt(e / d.length); };
    const mixG = await download('#btnExpMix');
    await page.click('#gInstr input[value=piano] + span');
    const mixP = await download('#btnExpMix');
    assert.equal(mixG.data.slice(0, 4).toString(), 'RIFF'); assert.ok(Math.abs(rmsOf(mixG.data) - rmsOf(mixP.data)) > 1e-4 || mixG.data.compare(mixP.data) !== 0, 'gitar mix\'i piyano mix\'inden farklı');
    assert.deepEqual(await midiTracks(), tracks0, 'piyano seçiliyken MIDI gitar eklenmeden önceki gibi');
    return `değişen alanlar: ${changes.map(([k, d]) => `${k}→${d.join('+')}`).join(' · ')} · 3/4 kalıpları ${JSON.stringify(pats34)} · 1. bölüm ${perSec[0]} / 2. bölüm (arpej) ${perSec[1]} olay · MIDI gitar izi`;
  });

  await step('Bas: demo şarkı → Generate (aynı tohum = aynı notalar), şerit seçimi, kilit L, zar R (yalnızca o ölçü), geri al, elle nota, pedal, döngü, tip değişimi, mikser, MIDI, mix, kayıt-yükleme, kısayol çakışması yok', async () => {
    await S(() => { window.confirm = () => true; });
    await page.click('#bassPanel [data-bk=demo]');
    await waitStatus(/Demo şarkı yüklendi/);
    await S(() => { document.querySelector('#inZoom').value = 18; document.querySelector('#inZoom').dispatchEvent(new Event('input')); });
    const bass = () => S(() => JSON.parse(JSON.stringify(window.__daw.proj.bass)));
    const notesOf = async () => (await bass()).bars.map((b) => JSON.stringify(b.notes));
    const laneXY = async (bar, y = 25) => { const bx = await page.locator('#bsCv').boundingBox(); const x = await page.evaluate((b) => { const s = window.__daw, sc = document.querySelector('#tlScroll'); return 46 + (b + 0.5) * s.d.g.barQ * s.view.pxPerQ - sc.scrollLeft; }, bar); return [bx.x + x, bx.y + y]; };
    const shiftClick = async (x, y) => { await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift'); };
    let t0 = await bass();
    assert.equal(t0.bars.length, 16); assert.ok(t0.enabled && t0.bars.every((b) => b.notes.length > 0), 'demo: 16 ölçünün hepsinde nota');
    // akor kökleri: yeni akorla başlayan ölçünün ilk notası kök (La minör demo)
    assert.deepEqual([0, 4, 8, 12].map((i) => t0.bars[i].notes[0].midi % 12), [9, 9, 5, 5]);
    const before = await notesOf();
    await page.click('#bassPanel [data-bk=generate]'); assert.deepEqual(await notesOf(), before, 'aynı tohum aynı notalar');
    const seed0 = (await bass()).seed;
    await page.click('#bassPanel [data-bk=dice]'); const t1 = await bass(); assert.notEqual(t1.seed, seed0); assert.notDeepEqual(await notesOf(), before, 'yeni tohum yeni notalar');
    await page.click('#bassPanel [data-bk=undo]'); assert.equal((await bass()).seed, seed0, 'geri al: eski tohum'); assert.deepEqual(await notesOf(), before);
    // şerit: tıkla = ölçü seç; Shift = aralık; L kilit; R zar
    await page.mouse.click(...(await laneXY(5)));
    assert.deepEqual(await S(() => window.__dawAPI.bass.BS.sel), [5, 5]);
    await page.keyboard.press('l'); assert.equal((await bass()).bars[5].locked, true); await page.keyboard.press('l'); assert.equal((await bass()).bars[5].locked, false);
    const b6 = await notesOf();
    await page.keyboard.press('r');
    const after = await notesOf();
    after.forEach((x, i) => { if (i !== 5) assert.equal(x, b6[i], 'zar yalnızca 6. ölçü: ' + (i + 1)); });
    assert.notEqual(after[5], b6[5]); assert.equal((await bass()).bars[5].rerollCount, 1);
    await page.keyboard.press('l'); const lockedNotes = (await notesOf())[5]; await page.keyboard.press('r'); assert.equal((await notesOf())[5], lockedNotes, 'kilitli ölçü zarlanmaz'); await page.keyboard.press('l');
    await page.keyboard.press('Control+z'); // son geri alınabilir eylem: kilit aç → geri al ...
    await shiftClick(...(await laneXY(6)));
    assert.deepEqual(await S(() => window.__dawAPI.bass.BS.sel), [5, 6]);
    // kısayol çakışması: zaman çizelgesinde bir akor seçilince bas seçimi kalkar (L / R yalnızca bas seçimi varken bas ölçüsüne işler)
    await page.mouse.click(...(await laneXY(2))); assert.deepEqual(await S(() => window.__dawAPI.bass.BS.sel), [2, 2]);
    const tl = await page.locator('#tl').boundingBox(), cx = await S(() => { const s = window.__daw, sc = document.querySelector('#tlScroll'); return 46 + (s.d.chords[3].q0 + s.d.chords[3].q1) / 2 * s.view.pxPerQ - sc.scrollLeft; });
    await page.mouse.click(tl.x + cx, tl.y + 22 + 26 + 18);
    assert.equal(await S(() => window.__dawAPI.bass.BS.sel), null, 'zaman çizelgesi seçimi bas seçimini kaldırır');
    const lk = (await bass()).bars.map((b) => b.locked).join(); await page.keyboard.press('l'); assert.equal((await bass()).bars.map((b) => b.locked).join(), lk, 'bas seçimi yokken L basa dokunmaz');
    // --- demo yeniden: elle düzenleme
    await page.click('#bassPanel [data-bk=demo]'); await waitStatus(/Demo şarkı yüklendi/);
    await S(() => { document.querySelector('#inZoom').value = 18; document.querySelector('#inZoom').dispatchEvent(new Event('input')); });
    const bx = await page.locator('#bsCv').boundingBox();
    const noteGeoB = (bar, midi, beat) => page.evaluate((a) => { const s = window.__daw, B = window.__dawAPI.bass.BS, sc = document.querySelector('#tlScroll'); return { x: 46 + (a.bar * s.d.g.barQ + a.beat) * s.view.pxPerQ - sc.scrollLeft, y: B.yOf(a.midi) }; }, { bar, midi, beat });
    const g1 = await noteGeoB(3, 45, 1.0);
    const nBefore = (await bass()).bars[3].notes.length;
    await page.mouse.dblclick(bx.x + g1.x + 1, bx.y + g1.y);
    let tb = await bass();
    assert.equal(tb.bars[3].source, 'manual'); assert.equal(tb.bars[3].locked, true); assert.ok(tb.bars[3].notes.length === nBefore + 1, 'çift tık nota ekler');
    const added = tb.bars[3].notes.findIndex((n) => n.midi === 45 && n.startBeat === 1);
    assert.ok(added >= 0, 'eklenen nota La2 (45), 2. vuruş');
    // taşı (sürükle): sağa 1 vuruş, yukarı 2 yarım ton
    const ng = await noteGeoB(3, 45, 1.0); const px = await S(() => window.__daw.view.pxPerQ), rowH = await S(() => window.__dawAPI.bass.BS.rowH);
    await page.mouse.move(bx.x + ng.x + 1.5, bx.y + ng.y); await page.mouse.down(); await page.mouse.move(bx.x + ng.x + 1.5 + px, bx.y + ng.y - 2 * rowH, { steps: 4 }); await page.mouse.up();
    tb = await bass(); const moved = tb.bars[3].notes.find((n) => n.midi === 47 && n.startBeat === 2); assert.ok(moved, 'sürükle: +1 vuruş, +2 yarım ton: ' + JSON.stringify(tb.bars[3].notes.map((n) => [n.startBeat, n.midi])));
    await page.keyboard.press('Delete'); assert.equal((await bass()).bars[3].notes.length, nBefore, 'Delete notayı siler');
    await page.keyboard.press('Control+z'); assert.equal((await bass()).bars[3].notes.length, nBefore + 1, 'silme geri alındı');
    // pedal: seçili ölçüler için derece 5
    await page.mouse.click(...(await laneXY(8))); await shiftClick(...(await laneXY(10)));
    await page.click('#bsBarMenu [data-bk=bar][data-bv=pedal]'); await page.click('#bsBarMenu [data-bk=pd][data-bv="5"]'); await page.click('#bsBarMenu [data-bk=pedalApply]');
    tb = await bass();
    for (const i of [8, 9, 10]) { const ch = await page.evaluate((b) => window.__daw.d.chords.filter((c) => c.bar === b + 1)[0].chord.root, i); assert.ok(tb.bars[i].notes.every((n) => n.midi % 12 === (ch + 7) % 12), `pedal 5. ölçü ${i + 1}`); assert.equal(tb.bars[i].pedal.degree, 5); }
    // zar ve yeni tohum pedalı korur
    await page.click('#bassPanel [data-bk=dice]'); tb = await bass(); assert.ok([8, 9, 10].every((i) => tb.bars[i].pedal && tb.bars[i].notes.every((n) => n.midi % 12 === (tb.bars[i].notes[0].midi % 12))));
    // döngü: 1–2. ölçü kaynak, hedef 3–8
    await page.mouse.click(...(await laneXY(0))); await shiftClick(...(await laneXY(1)));
    await page.click('#bsBarMenu [data-bk=bar][data-bv=loop]'); await page.fill('#bsBarMenu [data-bs=loopEnd]', '8'); await page.dispatchEvent('#bsBarMenu [data-bs=loopEnd]', 'change'); await page.click('#bsBarMenu [data-bk=lm][data-bv=exact]'); await page.click('#bsBarMenu [data-bk=loopMake]');
    tb = await bass(); assert.equal(tb.loops.length, 1); assert.ok(tb.bars[0].locked && tb.bars[1].locked); for (let i = 2; i <= 7; i++) { assert.equal(tb.bars[i].source, 'loop'); assert.deepEqual(tb.bars[i].notes, tb.bars[i % 2].notes); }
    const loopSnap = JSON.stringify(tb.bars.slice(0, 8).map((b) => b.notes));
    await page.click('#bassPanel [data-bk=generate]'); assert.equal(JSON.stringify((await bass()).bars.slice(0, 8).map((b) => b.notes)), loopSnap, 'Generate döngüye dokunmaz');
    await page.mouse.click(...(await laneXY(3))); await page.click('#bsBarMenu [data-bk=bar][data-bv=breakloop]'); tb = await bass(); assert.equal(tb.loops.length, 0); assert.equal(JSON.stringify(tb.bars.slice(0, 8).map((b) => b.notes)), loopSnap, 'döngü çözülünce notalar aynı');
    // tür değişimi: synth, preset listesi, kilitli ölçüler korunur
    const lockedBefore = JSON.stringify(tb.bars[1].notes);
    await page.click('#bassPanel [data-bk=type][data-bv=synth]'); tb = await bass();
    assert.equal(tb.instrumentType, 'synth'); assert.deepEqual(tb.range, { low: 24, high: 52 }); assert.equal(JSON.stringify(tb.bars[1].notes), lockedBefore, 'kilitli ölçü korundu');
    assert.ok((await page.locator('#bassPanel [data-bs=preset] option').allTextContents()).includes('Acid squelch'));
    // synth: hipnotik, süzgeç, süpürme
    await page.click('#bassPanel [data-bk=hyp]'); assert.equal((await bass()).sections[(await S(() => window.__daw.d.sections[0].id))].hypnotic, true);
    await page.click('#bassPanel [data-bk=sweep][data-bv="4"]'); await page.click('#bassPanel [data-bk=type][data-bv="bass-guitar"]');
    // mikser: bas kanalı
    await page.locator('.strip[data-track=bass] .mute').click(); assert.equal(await S(() => window.__daw.proj.mixer.bass.mute), true); await page.locator('.strip[data-track=bass] .mute').click();
    // MIDI + mix WAV: bas izi var, bas mix'e girer
    const mid = await download('#btnExpMidi'); const pm = Core.parseMidi(mid.data); assert.ok(pm.tracks.some((t) => t.name === 'Bas' && t.notes.length > 20), 'ana MIDI: Bas izi');
    const bm = await download('#bassPanel [data-bk=exportMidi]'); const pb = Core.parseMidi(bm.data); assert.equal(pb.tracks.find((t) => t.name === 'Bas').notes.length, (await bass()).bars.reduce((a, b) => a + b.notes.length, 0), 'bas .mid: nota başına bir olay');
    const rmsWav = (wav) => { const d = Core.decodeWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)).data; let e = 0; for (const v of d) e += v * v; return Math.sqrt(e / d.length); };
    const withB = await download('#btnExpMix'); await S(() => { window.__daw.proj.bass.enabled = false; });
    const noB = await download('#btnExpMix'); await S(() => { window.__daw.proj.bass.enabled = true; });
    assert.ok(rmsWav(withB.data) > rmsWav(noB.data) * 1.02 + 1e-5, `bas mix'e girer: ${rmsWav(withB.data).toFixed(4)} > ${rmsWav(noB.data).toFixed(4)}`);
    // kayıt-yükleme: tohum, kilitler, pedal, elle notalar, profil, bölüm ayarları
    const snapB = await bass();
    const pj = await download('#btnSave'); const f3 = path.join(here, '..', '.tmp-bas.json'); writeFileSync(f3, pj.data);
    await page.click('#btnNew'); await page.setInputFiles('#fileProject', f3); await waitStatus(/Proje açıldı/);
    const back = await bass(); rmSync(f3, { force: true });
    assert.equal(back.seed, snapB.seed); assert.deepEqual(back.bars.map((b) => [b.locked, b.source, JSON.stringify(b.notes), JSON.stringify(b.pedal || null)]), snapB.bars.map((b) => [b.locked, b.source, JSON.stringify(b.notes), JSON.stringify(b.pedal || null)])); assert.deepEqual(back.sections, snapB.sections); assert.equal(back.styleProfileId, snapB.styleProfileId);
    return `16 ölçü, tohum ${snapB.seed}; elle nota, pedal, döngü, tür değişimi, MIDI (${pb.tracks.find((t) => t.name === 'Bas').notes.length} nota), mix, kayıt-yükleme`;
  });

  await step('Bas tap kaydı: sayım + metronom, B tuşu, gerçek ses saatinden ızgaraya yuvarlama, gecikme ayarı, döngü kipi, şablon saklama, kalibrasyon', async () => {
    await S(() => { window.confirm = () => true; });
    await page.click('#bassPanel [data-bk=demo]'); await waitStatus(/Demo şarkı yüklendi/);
    await S(() => { document.querySelector('#inZoom').value = 18; document.querySelector('#inZoom').dispatchEvent(new Event('input')); });
    const bass = () => S(() => JSON.parse(JSON.stringify(window.__daw.proj.bass)));
    const laneXY = async (bar, y = 25) => { const bx = await page.locator('#bsCv').boundingBox(); const x = await page.evaluate((b) => { const s = window.__daw, sc = document.querySelector('#tlScroll'); return 46 + (b + 0.5) * s.d.g.barQ * s.view.pxPerQ - sc.scrollLeft; }, bar); return [bx.x + x, bx.y + y]; };
    const phase = () => S(() => window.__dawAPI.bass.BS.tap.phase);
    const idle = () => page.waitForFunction(() => window.__dawAPI.bass.BS.tap.phase === 'idle', null, { timeout: 20000 });
    const onsets = (b) => b.notes.map((n) => n.startBeat);
    const qs = [0, 1, 1.5, 2.75, 3]; // 16'lık adımlar: 0, 4, 6, 11, 12
    const spq = await S(() => window.__daw.d.g.spq);
    const secs = (shift = 0) => qs.map((q) => [q * spq + shift, 0.12]);
    // seçim yokken uyarı
    await S(() => window.__dawAPI.bass.tap.start()); await waitStatus(/kaydedilecek ölçüleri seç/);
    // 1) asPlayed, 3. ölçü (index 2)
    const before = await bass();
    await page.mouse.click(...(await laneXY(2)));
    await S(() => { window.__tapP = window.__dawAPI.bass.tap.start({ auto: [[0, 0.12], [1 * window.__daw.d.g.spq, 0.12], [1.5 * window.__daw.d.g.spq, 0.12], [2.75 * window.__daw.d.g.spq, 0.12], [3 * window.__daw.d.g.spq, 0.12]] }); });
    assert.equal(await phase(), 'count', 'başlarken sayım evresi');
    await page.waitForFunction(() => window.__dawAPI.bass.BS.tap.phase === 'rec', null, { timeout: 8000 });
    assert.equal(await S(() => window.__dawAPI.bass.BS.tap.from), await S(() => 2 * window.__daw.d.g.barSec), 'kayıt seçili ölçünün başından');
    await idle(); await waitStatus(/vuruş → 1 ölçüye yazıldı/);
    let tb = await bass();
    assert.deepEqual(onsets(tb.bars[2]), qs, 'ritim vuruşlardan: ' + JSON.stringify(onsets(tb.bars[2])));
    assert.equal(tb.bars[2].source, 'tapped');
    tb.bars.forEach((b, i) => { if (i !== 2) assert.equal(JSON.stringify(b.notes), JSON.stringify(before.bars[i].notes), 'diğer ölçüler aynı: ' + i); });
    assert.equal(tb.bars[2].notes[0].midi % 12, await S(() => window.__dawAPI.bass.ctx().segs(2)[0].chord.root), 'perde akoru izler (ölçü başı akor kökü)');
    // 2) gecikme ayarı: 150 ms geç basılan aynı ritim, +150 ms gecikmeyle aynı yere düşer
    await page.fill('#bassPanel [data-bs=tlat]', '150'); await page.locator('#bassPanel [data-bs=tlat]').dispatchEvent('change');
    assert.equal((await bass()).tap.latencyMs, 150);
    await S(() => window.__dawAPI.bass.tap.start({ auto: [[0.15, 0.12], [1 * window.__daw.d.g.spq + 0.15, 0.12], [2 * window.__daw.d.g.spq + 0.15, 0.12], [3 * window.__daw.d.g.spq + 0.15, 0.12]] }));
    await page.waitForFunction(() => window.__dawAPI.bass.BS.tap.phase === 'rec', null, { timeout: 8000 }); await idle();
    tb = await bass(); assert.deepEqual(onsets(tb.bars[2]), [0, 1, 2, 3], 'gecikme düzeltilmiş: ' + JSON.stringify(onsets(tb.bars[2])));
    await page.fill('#bassPanel [data-bs=tlat]', '0'); await page.locator('#bassPanel [data-bs=tlat]').dispatchEvent('change');
    // 3) B tuşu gerçek kayıtta vuruş toplar; Esc iptal eder ve hiçbir şeyi değiştirmez
    const snap = JSON.stringify((await bass()).bars.map((b) => b.notes));
    await S(() => window.__dawAPI.bass.tap.start());
    await page.waitForFunction(() => window.__dawAPI.bass.BS.tap.phase === 'rec', null, { timeout: 8000 });
    await page.keyboard.down('b'); await page.waitForTimeout(120); await page.keyboard.up('b');
    assert.equal(await S(() => window.__dawAPI.bass.BS.tap.taps.length), 1, 'B tuşu bir vuruş');
    assert.equal(await S(() => { const t = window.__dawAPI.bass.BS.tap.taps[0]; return t.dq > 0.1; }), true, 'basılı kalma süresi ölçülür');
    await page.keyboard.press('Escape'); assert.equal(await phase(), 'idle');
    assert.equal(JSON.stringify((await bass()).bars.map((b) => b.notes)), snap, 'iptal: değişiklik yok');
    assert.equal(await S(() => window.__daw.playing ?? false), false);
    // 4) döngü kipi: 5–8. ölçü seçili, 1 ölçülük kalıp vurulur → 5. ölçü kaynak, 6–8 döngü kopyası
    await page.mouse.click(...(await laneXY(4))); await page.keyboard.down('Shift'); await page.mouse.click(...(await laneXY(7))); await page.keyboard.up('Shift');
    assert.deepEqual(await S(() => window.__dawAPI.bass.BS.sel), [4, 7]);
    await page.click('#bassPanel [data-bk=tmode][data-bv=loop]');
    await S(() => window.__dawAPI.bass.tap.start({ auto: [[0, 0.1], [1.5 * window.__daw.d.g.spq, 0.1], [2 * window.__daw.d.g.spq, 0.1], [3.5 * window.__daw.d.g.spq, 0.1]] }));
    await page.waitForFunction(() => window.__dawAPI.bass.BS.tap.phase === 'rec', null, { timeout: 8000 }); await idle();
    tb = await bass();
    assert.deepEqual(onsets(tb.bars[4]), [0, 1.5, 2, 3.5]); assert.equal(tb.bars[4].locked, true);
    for (const i of [5, 6, 7]) { assert.equal(tb.bars[i].source, 'loop'); assert.deepEqual(onsets(tb.bars[i]), [0, 1.5, 2, 3.5]); }
    assert.equal(tb.loops.length, 1);
    assert.equal(tb.bars[8].source !== 'loop', true, 'döngü yalnızca seçilen aralığa');
    // 5) şablon sakla: seçili tek ölçü → özel aile çipi çıkar, şablon slotları kayıtla aynı
    await page.mouse.click(...(await laneXY(2)));
    await page.fill('#bassPanel [data-bs=tname]', 'Benim kalıbım'); await page.locator('#bassPanel [data-bs=tname]').dispatchEvent('change');
    await page.click('#bassPanel [data-bk=tsave]');
    tb = await bass(); const saved = tb.customTemplates.filter((t) => t.saved);
    assert.equal(saved.length, 1); assert.equal(saved[0].name, 'Benim kalıbım'); assert.deepEqual(saved[0].slots.map((s) => s.step), [0, 4, 8, 12]);
    assert.ok(await page.locator('#bassPanel [data-bk=fam][data-bv=custom]').count(), 'Özel şablon ailesi çipi');
    // 6) kalibrasyon: tıklara 50 ms geç basılan 8 vuruş → +50 ms; yetersiz vuruş reddedilir
    await S(() => { const c = [10, 10.6, 11.2, 11.8, 12.4, 13, 13.6, 14.2]; window.__dawAPI.bass.tap.calibDone(c, c.map((x) => x + 0.05)); });
    assert.equal((await bass()).tap.latencyMs, 50);
    await S(() => window.__dawAPI.bass.tap.calibDone([1, 2, 3], [1.01])); await waitStatus(/Kalibrasyon başarısız/);
    assert.equal((await bass()).tap.latencyMs, 50, 'başarısız kalibrasyon ayarı değiştirmez');
    // kayıt-yükleme için tap ayarları
    return 'sayım→kayıt→yuvarlama, gecikme ±150 ms, B tuşu, Esc, döngü (5–8), şablon, kalibrasyon';
  });

  await step('Bas stil öğrenme: MIDI içe aktar → kök düzeltme → analiz → kaydet+uygula (tarayıcıda da saklı) · hızlı giriş + hata · profil silme · örnekçi (kendi örnekleri)', async () => {
    await S(() => { window.confirm = () => true; });
    await page.click('#bassPanel [data-bk=demo]'); await waitStatus(/Demo şarkı yüklendi/);
    await S(() => { try { localStorage.removeItem('dawBassProfiles'); } catch (e) { /* */ } });
    const bass = () => S(() => JSON.parse(JSON.stringify(window.__daw.proj.bass)));
    // referans MIDI: 8 seyrek (kök + 3. vuruş) + 8 yoğun ölçü (tipik post-punk), tek bas izi
    const roots = [9, 5, 0, 7], notes = [];
    for (let b = 0; b < 16; b++) {
      const root = roots[b % 4], nextRoot = roots[(b + 1) % 4], high = b % 8 >= 4, base = 33 + (((root - 33) % 12) + 12) % 12, steps = high ? [0, 4, 7, 8, 11, 14] : [0, 8];
      steps.forEach((s, k) => { let m = base; if (high && s === 8) m = base + 12; else if (high && s === 7) m = base + 7; if (high && k === steps.length - 1) m = 33 + (((nextRoot - 1 - 33) % 12) + 12) % 12; const nx = k + 1 < steps.length ? steps[k + 1] : 16; notes.push({ q0: b * 4 + s * 0.25, q1: b * 4 + (s + Math.max(1, nx - s - (high ? 1 : 0))) * 0.25, midi: m, vel: 96 }); });
    }
    const midPath = path.join(here, '..', '.tmp-ref.mid'); writeFileSync(midPath, Buffer.from(Core.writeMidi({ quarterBpm: 100, meter: '4/4', tracks: [{ name: 'Bass', channel: 0, program: 33, notes }] })));
    await page.setInputFiles('#bsMidiFile', midPath); await waitStatus(/bas izi tahmini: Bass/); rmSync(midPath, { force: true });
    assert.equal(await page.locator('#bassPanel .bs-prev select[data-bs=lRoot]').count(), 16, '16 ölçülük önizleme');
    const rootOf = (i) => S(`window.__dawAPI.bass.learn.parsed.bars[${i}].root`);
    assert.equal(await rootOf(0), 9); assert.equal(await rootOf(1), 5);
    // kök düzeltme: 2. ölçünün kökünü D#'ye çevir, sonra geri al
    await page.locator('#bassPanel select[data-bs=lRoot][data-i="1"]').selectOption('3'); assert.equal(await rootOf(1), 3);
    await page.locator('#bassPanel select[data-bs=lRoot][data-i="1"]').selectOption('5'); assert.equal(await rootOf(1), 5);
    // aralık: yalnızca 1–8. ölçüler (hepsi seyrek) → tek kova; sonra tümü
    await page.fill('#bassPanel [data-bs=lTo]', '16'); await page.locator('#bassPanel [data-bs=lTo]').dispatchEvent('change');
    await page.click('#bassPanel [data-bk=learnAnalyze]');
    let lr = await S(() => JSON.parse(JSON.stringify(window.__dawAPI.bass.learn.result)));
    assert.equal(lr.stats.low.bars, 8); assert.equal(lr.stats.high.bars, 8); assert.ok(lr.stats.high.density > lr.stats.low.density);
    assert.ok(await page.locator('#bassPanel .bs-stat').count(), 'analiz tablosu görünür');
    assert.ok(lr.templates.length >= 1 && lr.templates[0].slots.map((s) => s.step).join() === '0,4,7,8,11,14', 'yeni şablon: ' + JSON.stringify(lr.templates.map((t) => t.slots.map((s) => s.step))));
    // kaydet + uygula (adı değiştir)
    await page.fill('#bassPanel [data-bs=lName]', 'Referans şarkı'); await page.locator('#bassPanel [data-bs=lName]').dispatchEvent('change');
    const beforeNotes = JSON.stringify((await bass()).bars.map((b) => b.notes));
    await page.click('#bassPanel [data-bk=learnSave][data-bv="1"]'); await waitStatus(/kaydedildi ve uygulandı/);
    let tb = await bass(); assert.equal(tb.profiles.length, 1); assert.equal(tb.profiles[0].name, 'Referans şarkı'); assert.equal(tb.styleProfileId, tb.profiles[0].id);
    assert.notEqual(JSON.stringify(tb.bars.map((b) => b.notes)), beforeNotes, 'profil uygulanınca kilitsiz ölçüler yeniden üretildi');
    assert.deepEqual(await page.locator('#bassPanel select[data-bs=prof] option:checked').allTextContents(), ['Referans şarkı']);
    assert.equal(await S(() => JSON.parse(localStorage.getItem('dawBassProfiles')).length), 1, 'tarayıcıda da saklandı');
    // üretici öğrenilen şablonu seçer (cümle başına bir seçim olduğundan birkaç tohum denenir)
    let used = false; for (let k = 0; k < 8 && !used; k++) { tb = await bass(); used = tb.bars.some((b) => b.templateId.startsWith(tb.profiles[0].id)); if (!used) await page.click('#bassPanel [data-bk=dice]'); }
    assert.ok(used, 'üretici öğrenilen şablonu seçer');
    // Generate aynı tohumla aynı notalar
    const g1 = JSON.stringify((await bass()).bars.map((b) => b.notes)); await page.click('#bassPanel [data-bk=generate]'); assert.equal(JSON.stringify((await bass()).bars.map((b) => b.notes)), g1);
    // karışım: öğrenilen ↔ Darkwave
    await page.locator('#bassPanel select[data-bs=profB]').selectOption('darkwave-pulse'); tb = await bass(); assert.equal(tb.styleMix.profileB, 'darkwave-pulse'); assert.ok(tb.bars.every((b) => b.notes.length));
    await page.locator('#bassPanel select[data-bs=profB]').selectOption('');
    // proje kaydet → yeni proje: profil projede kalır; yeni projeye tarayıcı kaydından gelir
    const pj = await download('#btnSave'); const f3 = path.join(here, '..', '.tmp-prof.json'); writeFileSync(f3, pj.data);
    await page.click('#btnNew'); assert.equal((await bass()).profiles.length, 1, 'yeni projede tarayıcıda saklı profil var');
    await page.setInputFiles('#fileProject', f3); await waitStatus(/Proje açıldı/); rmSync(f3, { force: true });
    tb = await bass(); assert.equal(tb.profiles.length, 1); assert.equal(tb.profiles[0].templates.length, lr.templates.length); assert.equal(tb.styleProfileId, tb.profiles[0].id, 'seçili profil geri geldi');
    // hızlı giriş: hata satırı ve başarılı analiz
    await page.click('#bassPanel [data-bk=demo]'); await waitStatus(/Demo şarkı yüklendi/);
    await page.click('#bassPanel [data-bk=lmode][data-bv=quick]');
    await page.fill('#bassPanel input[data-bq="0,0"]', 'zz'); await page.click('#bassPanel [data-bk=learnAnalyze]');
    assert.match(await page.locator('#bassPanel .st-warn').first().textContent(), /zz/); assert.equal(await S(() => window.__dawAPI.bass.learn.result), null, 'hatalıyken sonuç yok');
    for (let r = 0; r < 4; r++) { await page.fill(`#bassPanel input[data-bq="${r},0"]`, '1'); await page.fill(`#bassPanel input[data-bq="${r},8"]`, '5'); }
    await page.click('#bassPanel [data-bk=learnAnalyze]'); await waitStatus(/Analiz tamam/);
    lr = await S(() => JSON.parse(JSON.stringify(window.__dawAPI.bass.learn.result))); assert.equal(lr.source.kind, 'quick'); assert.equal(lr.stats.mid.bars, 4);
    // silme: öğrenilmiş seçiliyken sil
    assert.equal((await bass()).profiles.length, 1, 'demo (yeni proje) tarayıcıdaki profili de getirir');
    await page.locator('#bassPanel select[data-bs=prof]').selectOption({ label: 'Referans şarkı' });
    assert.ok(await page.locator('#bassPanel [data-bk=learnDelete]').count(), 'silme düğmesi öğrenilmiş profil seçiliyken görünür');
    await page.click('#bassPanel [data-bk=learnDelete]'); tb = await bass(); assert.equal(tb.profiles.length, 0); assert.equal(tb.styleProfileId, 'post-punk-drive');
    assert.equal(await S(() => JSON.parse(localStorage.getItem('dawBassProfiles')).length), 0, 'tarayıcı kaydından da silindi');
    // örnekçi: kendi örneklerin (E1, A1, bırakma) → perde kaydırmalı çalar
    const sine = (hz, secs, sr = 44100) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = 0.6 * Math.sin((2 * Math.PI * hz * i) / sr) * Math.exp(-i / (sr * 1.2)); return x; };
    const dir = path.join(here, '..'); const files = [['E1.wav', sine(41.2034, 1.5)], ['A1.wav', sine(55, 1.5)], ['A1_rr2.wav', sine(55, 1.5)], ['release.wav', sine(300, 0.1)], ['rastgele.wav', sine(100, 0.1)]].map(([n, x]) => { const p = path.join(dir, '.tmp-' + n); writeFileSync(p, Buffer.from(Core.encodeWav([x], 44100))); return p; });
    await page.setInputFiles('#bsSampleFiles', files); await waitStatus(/örnek, 1 bırakma/); files.forEach((f) => rmSync(f, { force: true }));
    assert.match(await S(() => document.querySelector('#status').textContent), /rastgele\.wav/, 'perdesi olmayan dosya bildirilir');
    const bank = await S(() => ({ n: window.__dawAPI.bass.bank().samples.length, r: window.__dawAPI.bass.bank().releases.length, notes: window.__dawAPI.bass.bank().samples.map((s) => s.midi).sort() }));
    assert.deepEqual(bank, { n: 3, r: 1, notes: [28, 33, 33] }); assert.equal((await bass()).useSampler, true);
    const pitch = await S(async () => {
      const A = window.__dawAPI.bass, d = window.__daw.d, Bs = window.Core.Bass, t = window.__daw.proj.bass;
      const ev = Bs.bassEvents(t, d.g, d.bars)[0], x = await A.renderOffline(44100, Math.round((ev.t + 1.2) * 44100)), a = Math.round((ev.t + 0.05) * 44100), b = Math.round((ev.t + Math.min(0.4, ev.dur) ) * 44100);
      let z = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
      return { hz: z / ((b - a) / 44100), want: 440 * 2 ** ((ev.midi - 69) / 12), kind: A.BS.lastOffline[0].inst.constructor.name, peak: Math.max(...x.subarray(a, b).map(Math.abs)) };
    });
    assert.equal(pitch.kind, 'BassSampler'); assert.ok(Math.abs(pitch.hz / pitch.want - 1) < 0.04, `örnekçi perdesi ${pitch.hz.toFixed(1)} ≈ ${pitch.want.toFixed(1)}`); assert.ok(pitch.peak > 0.02, 'ses var');
    await page.click('#bassPanel [data-bk=sampleUse]'); assert.equal((await bass()).useSampler, false, 'kapatınca sentez döner');
    assert.equal(await S(async () => { await window.__dawAPI.bass.renderOffline(44100, 44100); return window.__dawAPI.bass.BS.lastOffline[0].inst.constructor.name; }), 'BassSynth');
    await page.click('#bassPanel [data-bk=sampleUse]'); await page.click('#bassPanel [data-bk=sampleClear]'); assert.equal((await bass()).useSampler, false);
    return `MIDI → ${lr.source.bars} ölçü analiz, profil kaydı/silme/LS, hızlı giriş, örnekçi ${pitch.hz.toFixed(0)} Hz`;
  });

  await step('Zamanlama: notayı sağa sürükle (ızgaraya yapışır) → ses kayar; quantize; zamanı geri al; piyano tuşu çalar; T ile tap → tempo/ölçü/ızgara', async () => {
    page.once('dialog', (d) => d.accept());
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const tl = await page.locator('#tl').boundingBox();
    // nota 6'yı sağa sürükle: ~0.4 vuruş → 1/8 ızgaraya yapışır
    const g6 = await noteGeo(6);
    const q6 = await S(() => window.__daw.d.notes[6].q0);
    const pxq = await S(() => window.__daw.view.pxPerQ);
    await page.mouse.move(tl.x + g6.x, tl.y + g6.y); await page.mouse.down();
    await page.mouse.move(tl.x + g6.x + pxq * 0.4, tl.y + g6.y, { steps: 8 });
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'time-drag.png'), clip: { x: tl.x, y: tl.y + g6.y - 120, width: 700, height: 200 } });
    await page.mouse.up();
    const m6 = await S(() => { const n = window.__daw.d.notes[6]; return { q0: n.q0, q0to: n.q0to, eff: n.effMidi }; });
    assert.ok(m6.q0to != null && Math.abs(m6.q0to * 2 - Math.round(m6.q0to * 2)) < 1e-9, '1/8 ızgarada: ' + m6.q0to);
    assert.ok(m6.q0 > q6 + 0.2, 'nota sağa kaydı');
    await waitStatus(/Düzeltilmiş vokal hazır/);
    assert.ok(await S(() => !!window.__daw.d.timeMap && !window.__daw.d.timeMap.identity));
    assert.match(await page.textContent('#inspector .rm-bar'), /Zaman: ölçü \d+, vuruş [\d.]+'ye kaydırıldı/);
    assert.match(await page.textContent('#editSummary'), /Zamanı kaydırılan .* 1/);
    await page.click('#inspector .rm-bar button[data-act=timeReset]');
    assert.equal(await S(() => window.__daw.d.notes[6].q0to), null);
    // quantize: 1/16, tüm şarkı → hepsi ızgarada
    await page.selectOption('#inQuantGrid', '1/16');
    await page.click('#btnQuantize');
    await waitStatus(/Düzeltilmiş vokal hazır|Quantize/);
    const off16 = await S(() => Math.max(...window.__daw.d.notes.map((n) => Math.abs(n.q0 * 4 - Math.round(n.q0 * 4)))));
    assert.ok(off16 < 1e-6, 'quantize sonrası 1/16 ızgarada: ' + off16);
    await page.click('#btnQuantClear');
    assert.equal(await S(() => window.__daw.d.notes.filter((n) => n.q0to != null).length), 0);
    await page.selectOption('#inQuantGrid', '1/8');
    // piyano tuşu
    const k0 = await S(() => window.__dawAPI.player().keyHits || 0);
    await page.mouse.click(tl.x + 20, tl.y + g6.y);
    await page.waitForFunction((k) => (window.__dawAPI.player().keyHits || 0) > k, k0, { timeout: 15000 });
    assert.match(await page.textContent('#status'), /^♪ /);
    // tap: oynatırken T → nokta eklenir (zaman ~ duyulan an)
    await page.click('#btnPlay');
    await page.waitForTimeout(700);
    await page.keyboard.press('t');
    await page.waitForTimeout(400);
    await page.keyboard.press('t');
    await page.click('#btnPlay');
    const taps = await S(() => window.__daw.proj.taps.slice());
    assert.equal(taps.length, 2);
    assert.ok(taps[1] - taps[0] > 0.25 && taps[1] - taps[0] < 0.7, 'iki tap arası ~0.4 s: ' + (taps[1] - taps[0]));
    // gerçek akor değişimlerinde tap (120 BPM, 4/4): proje 100 BPM'e alınmışken → Uygula → 120 BPM
    await page.fill('#inBpm', '100'); await page.dispatchEvent('#inBpm', 'change');
    await S(() => { const off = window.__daw.proj.audio.offsetSec; window.__daw.proj.taps = [1, 2, 3, 3.5, 4, 5, 6, 7].map((b, i) => off + b * 2 + [0.02, -0.01, 0.015, -0.02, 0.01, 0, -0.015, 0.02][i]); window.__dawAPI.refresh(); });
    assert.match(await page.textContent('#tapInfo'), /8 noktadan: 4\/4, 120 BPM/);
    if (shotDir) await page.locator('.tapbox').screenshot({ path: path.join(shotDir, 'taps.png') });
    await page.click('#btnTapApply');
    assert.equal(await page.inputValue('#inBpm'), '120');
    assert.ok(await page.isChecked('#inOnlyMarked'));
    const mk = await S(() => window.__daw.proj.changeMarks.length);
    assert.equal(mk, 8);
    await page.click('#btnTapClear'); await page.click('#btnClearMarks'); await page.uncheck('#inOnlyMarked');
    return `sürükle → nota ${q6.toFixed(2)} → ${m6.q0to} (1/8), ses render edildi · quantize 1/16 ✓ · piyano tuşu çaldı · T ile 2 nokta (${(taps[1] - taps[0]).toFixed(2)} s arayla) · 8 tap → 4/4, 120 BPM, ${mk} ✂`;
  });

  await step('Piyano örnekleri: birinci kaynak (github.io) engelliyse jsDelivr aynasından yüklenir; ikisi de yoksa yedek + "Tekrar dene"', async () => {
    const wav = Buffer.from(Core.encodeWav([Core.synthPianoSample(69, 44100, 0.5)], 44100));
    const p2 = await context.newPage();
    if (toneLocal) await p2.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
    await p2.route(/tonejs\.github\.io\/audio\/salamander\//, (r) => r.abort());
    await p2.route(/cdn\.jsdelivr\.net\/gh\/Tonejs\/audio@master\/salamander\//, (r) => r.fulfill({ body: wav, contentType: 'audio/wav' }));
    await p2.goto(indexUrl);
    await p2.waitForFunction(() => /Salamander/.test(document.querySelector('#pianoBadge').textContent) && !/yükleniyor/.test(document.querySelector('#pianoBadge').textContent), null, { timeout: 30000 });
    const info = await p2.textContent('#pianoInfo');
    assert.match(info, /cdn\.jsdelivr\.net/);
    await p2.close();
    // ikisi de yok (bu sayfa): yedek piyano + açıklama + Tekrar dene
    assert.match(await page.textContent('#pianoInfo'), /Akorlar ve analiz etkilenmez/);
    assert.equal(await page.locator('#btnPianoRetry').count(), 1);
    return `github.io engelli → ${info.trim()} · ikisi de engelliyken: "${(await page.textContent('#pianoBadge')).trim()}" + Tekrar dene`;
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

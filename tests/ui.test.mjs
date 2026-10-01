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
    assert.ok(loops34.some((x) => /Vals/.test(x)) && !loops34.some((x) => /Rock/.test(x)), 'loop listesi proje ölçüsüne göre');
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
    // uygun loop yok: 200 BPM
    await page.selectOption('#inDrumLoop', 'auto');
    await page.fill('#inBpm', '200'); await page.dispatchEvent('#inBpm', 'change');
    const info = await page.textContent('#drumInfo');
    assert.match(info, /Bu melodiye uygun bir loop bulamadım/);
    assert.match(await page.inputValue('#drumRequest'), /Tempo: 200 BPM/);
    if (shotDir) await page.locator('details.step:has(#drumInfo)').screenshot({ path: path.join(shotDir, 'drums-notfound.png') });
    await page.fill('#inBpm', '120'); await page.dispatchEvent('#inBpm', 'change');
    if (shotDir) await page.locator('details.step:has(#drumInfo)').screenshot({ path: path.join(shotDir, 'drums.png') });
    // mikserde davul kanalı
    await page.locator('.strip[data-track=drums] .mute').click();
    assert.equal(await S(() => window.__daw.proj.mixer.drums.mute), true);
    await page.locator('.strip[data-track=drums] .mute').click();
    await page.uncheck('#inDrumsOn');
    return `tahmin 4/4 · 3/4 seçilince "Uygula" → 4/4 · ${auto.trim()} · oynatmada davul çaldı · 200 BPM → bulamadım + tarif`;
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

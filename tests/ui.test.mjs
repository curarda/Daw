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
  await step('sol panel: yalnızca 1 ve 2 açık, diğer bölümler tıklayınca açılır; başlıkta durum rozeti; açık/kapalı durumu yenilemede hatırlanır', async () => {
    await waitStatus(/Hazır/);
    const open = () => page.$$eval('details.step', (ds) => ds.map((d) => [d.dataset.key, d.open]));
    const st = await open();
    assert.deepEqual(st.filter(([, o]) => o).map(([k]) => k), ['s1', 's2'], 'ilk açılışta yalnızca proje ayarı ve kayıt açık');
    assert.deepEqual(st.map(([k]) => k), ['s1', 's2', 's3', 's3b', 's4', 's5', 's67', 's8', 's8b', 's8c', 's8d', 's9']);
    assert.equal(await page.isVisible('#inBassPattern'), false, 'kapalı bölümün içeriği görünmez');
    assert.equal((await page.textContent('#chipS1')).trim(), '4/4 · 120 BPM');
    assert.equal((await page.textContent('#chipS8b')).trim(), 'kapalı'); assert.equal((await page.textContent('#chipS8c')).trim(), 'kapalı');
    await page.click('details[data-key=s8c] > summary');
    assert.equal(await page.isVisible('#inBassPattern'), true);
    assert.equal(await page.locator('details[data-key=s8d] .strip').count(), 4, 'mikser ayrı bölümde: vokal, akor, davul, bas');
    assert.ok(await page.locator('details[data-key=s8] #inPianoStyle').count(), 'akor sesi kendi bölümünde');
    await page.reload(); await waitStatus(/Hazır/);
    assert.equal(await page.isVisible('#inBassPattern'), true, 'açık bölüm yenilemede açık kalır');
    await page.click('#btnCloseAll');
    assert.deepEqual((await open()).filter(([, o]) => o).map(([k]) => k), ['s1', 's2']);
    return 'ilk açılış: 1, 2 açık · rozetler · mikser / akor sesi / davul / bas ayrı · durum hatırlanır';
  });
  await page.evaluate(() => document.querySelectorAll('details.step, details.sub:not(#chartBox)').forEach((d) => { d.open = true; })); // diğer adımlar bütün alanlara erişir
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

  // ---------------------------------------------------------------- toplu seçim, bölme, giriş ölçüsü, kaydırma, akor sesi
  const noteBox = (i) => S(`(() => {
    const d = window.__daw.d, n = d.notes[${i}], sc = document.querySelector('#tlScroll'), ppq = window.__daw.view.pxPerQ;
    const H = sc.clientHeight; let lo = Infinity, hi = -Infinity;
    for (const k of d.notes) { lo = Math.min(lo, k.effMidi, k.median); hi = Math.max(hi, k.effMidi, k.median); }
    lo = Math.floor(lo) - 3; hi = Math.ceil(hi) + 3; if (hi - lo < 18) { const c = (lo + hi) / 2; lo = Math.floor(c - 9); hi = lo + 18; }
    const rowH = (H - 84) / (hi - lo + 1);
    return { x0: 46 + n.q0 * ppq - sc.scrollLeft, x1: 46 + n.q1 * ppq - sc.scrollLeft, y: 84 + (hi - n.effMidi + 0.5) * rowH, rowH, H, top: 84 + 3, ppq };
  })()`);
  const resetTest = async () => {
    await page.click('#btnTest'); await waitStatus(/Test melodisi hazır/);
    await S(() => { document.querySelector('#tlScroll').scrollLeft = 0; window.__daw.sel = null; });
    await page.click('.seg input[value=sound] + span');
    await page.waitForTimeout(150);
    return page.locator('#tl').boundingBox();
  };
  const marquee = async (tl, ia, ib) => {
    const a = await noteBox(ia), b = await noteBox(ib);
    await page.mouse.move(tl.x + a.x0 + 5, tl.y + a.top - 1);
    await page.mouse.down();
    await page.mouse.move(tl.x + b.x1 - 5, tl.y + a.H - 4, { steps: 8 });
    await page.mouse.up();
  };
  const effs = () => S(() => window.__daw.d.notes.map((n) => n.effMidi));
  const q0s = () => S(() => window.__daw.d.notes.map((n) => n.q0));
  const selIds = () => S(() => { const s = window.__daw.sel; return !s ? [] : s.type === 'note' ? [s.id] : s.type === 'notes' ? s.ids.slice() : []; });

  await step('Toplu seçim: boş yerde sürükle → dikdörtgenle seç; birini sürükle → hepsi birlikte taşınır (perde + zaman); Ctrl+tık ekler; ↑↓ ←→ ; Ctrl+A; Esc; toplu geri al', async () => {
    const tl = await resetTest();
    const e0 = await effs(), t0 = await q0s();
    await marquee(tl, 0, 3);
    const ids = await selIds();
    const exp = await S(() => window.__daw.d.notes.filter((n) => n.q0 < 8 && n.q1 > 0).length);
    assert.ok(ids.length >= 4, 'dikdörtgenle en az 4 nota seçilmeli: ' + ids.length);
    assert.match(await page.textContent('#inspector h3'), /\d+ nota seçili/);
    const sel = await S(() => window.__daw.sel.ids.map((id) => window.__daw.d.notes.findIndex((n) => n.id === id)));
    // perde: seçili notalardan birini 2 yarım ses yukarı sürükle → hepsi +2; seçilmeyenler aynı
    const b1 = await noteBox(sel[1]);
    await page.mouse.move(tl.x + (b1.x0 + b1.x1) / 2, tl.y + b1.y); await page.mouse.down();
    await page.mouse.move(tl.x + (b1.x0 + b1.x1) / 2, tl.y + b1.y - 2 * b1.rowH, { steps: 8 });
    const tip = await S(() => window.__daw.drag && window.__daw.drag.tip);
    await page.mouse.up();
    assert.match(tip, new RegExp(`^${sel.length} nota · Taşı`));
    const e1 = await effs();
    e0.forEach((m, i) => assert.equal(e1[i], sel.includes(i) ? m + 2 : m, `nota ${i}`));
    assert.equal((await selIds()).length, sel.length, 'sürükleyince seçim bozulmaz');
    // zaman: sağa 1/8 (0.5 çeyrek = 22 px) → hepsi birlikte, aralarındaki mesafe korunur
    const b2 = await noteBox(sel[0]);
    await page.mouse.move(tl.x + (b2.x0 + b2.x1) / 2, tl.y + b2.y); await page.mouse.down();
    await page.mouse.move(tl.x + (b2.x0 + b2.x1) / 2 + b2.ppq * 0.5, tl.y + b2.y, { steps: 8 });
    await page.mouse.up();
    const t1 = await q0s();
    t0.forEach((q, i) => assert.ok(Math.abs(t1[i] - (q + (sel.includes(i) ? 0.5 : 0))) < 0.02, `nota ${i}: ${q} → ${t1[i]}`));
    // sürüklemeden tıkla: grup bozulur, yalnızca o not
    const b3 = await noteBox(sel[2]);
    await page.mouse.click(tl.x + (b3.x0 + b3.x1) / 2, tl.y + b3.y);
    assert.equal((await selIds()).length, 1);
    // Ctrl+tık: seçime ekle / çıkar
    const b4 = await noteBox(sel[3]);
    await page.keyboard.down('Control'); await page.mouse.click(tl.x + (b4.x0 + b4.x1) / 2, tl.y + b4.y); await page.keyboard.up('Control');
    assert.equal((await selIds()).length, 2);
    await page.keyboard.down('Control'); await page.mouse.click(tl.x + (b4.x0 + b4.x1) / 2, tl.y + b4.y); await page.keyboard.up('Control');
    assert.equal((await selIds()).length, 1);
    // klavye: Ctrl+A → hepsi; ↑ hepsi +1; → hepsi bir 1/8 sağa; Esc
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    assert.equal((await selIds()).length, e0.length);
    const e2 = await effs(), t2 = await q0s();
    await page.keyboard.press('ArrowUp');
    const e3 = await effs();
    e2.forEach((m, i) => assert.equal(e3[i], m + 1));
    await page.keyboard.press('ArrowRight');
    const t3 = await q0s();
    t2.forEach((q, i) => assert.ok(Math.abs(t3[i] - (q + 0.5)) < 0.02, `→ nota ${i}`));
    // toplu işlemler: panel (oktav, ince akort, scale'e çek) ve geri al
    await page.click('#inspector button[data-act=gMove][data-v="-12"]');
    const e4 = await effs();
    e3.forEach((m, i) => assert.equal(e4[i], m - 12));
    await page.click('#inspector button[data-act=gFine][data-v="0.05"]');
    assert.ok(await S(() => window.__daw.d.notes.every((n) => n.manualTarget != null && Math.abs(n.manualTarget - Math.round(n.manualTarget) - 0.05) < 0.011 || Math.abs(n.manualTarget - n.effMidi) <= 0.5)));
    await page.click('#inspector .rm-bar button[data-act=gReset]');
    assert.deepEqual(await effs(), e0, 'seçili notaların değişiklikleri kaldırılınca başlangıç');
    assert.equal(await S(() => window.__daw.d.notes.filter((n) => n.q0to != null || n.manualTarget != null).length), 0);
    await page.keyboard.press('Escape');
    assert.equal((await selIds()).length, 0);
    // boş yere tek tık seçimi temizler
    await marquee(tl, 0, 1);
    assert.ok((await selIds()).length >= 2);
    await page.mouse.click(tl.x + 300, tl.y + (await noteBox(0)).top - 1);
    assert.equal((await selIds()).length, 0);
    return `dikdörtgen ${sel.length} nota · perde +2 ve zaman +1/8 hepsinde birlikte · Ctrl+tık ekle/çıkar · Ctrl+A ${e0.length} nota · ↑ → ✓ · oktav/ince akort/geri al`;
  });

  await step('Çift tık: tek sanılan nota ikiye bölünür (perdeler yeniden), seçilir; panelden ve özetten geri alınır; projede saklanır', async () => {
    const tl = await resetTest();
    const before = await S(() => window.__daw.d.notes.length);
    const idx = await S(() => { const ns = window.__daw.d.notes; let b = 0; ns.forEach((n, i) => { if (n.q1 - n.q0 > ns[b].q1 - ns[b].q0) b = i; }); return b; });
    await S(`(() => { const n = window.__daw.d.notes[${idx}]; document.querySelector('#tlScroll').scrollLeft = Math.max(0, 46 + n.q0 * window.__daw.view.pxPerQ - 200); })()`);
    await page.waitForTimeout(150);
    const b = await noteBox(idx);
    const mid = tl.x + (b.x0 + b.x1) / 2;
    await page.mouse.dblclick(mid, tl.y + b.y);
    await page.waitForFunction((n) => window.__daw.d.notes.length === n + 1, before, { timeout: 5000 });
    const r = await S(`(() => { const d = window.__daw.d, a = d.notes[${idx}], c = d.notes[${idx + 1}], s = window.__daw.sel; return { a0: a.q0, a1: a.q1, c0: c.q0, c1: c.q1, sel: s && s.type, ids: s && s.ids && s.ids.length, med: [a.median, c.median], splits: window.__daw.proj.noteSplits.length }; })()`);
    assert.equal(r.sel, 'notes'); assert.equal(r.ids, 2);
    assert.ok(r.c0 >= r.a1 - 0.2 && r.c0 > r.a0 + 0.2, 'ikinci parça birincinin ardında');
    assert.ok(Math.abs(r.c1 - (b.x1 - 46 + (await S(() => document.querySelector('#tlScroll').scrollLeft))) / b.ppq) < 0.05, 'dış sınır aynı');
    assert.equal(r.splits, 1);
    assert.match(await page.textContent('#status'), /ikiye bölündü/);
    assert.match(await page.textContent('#editSummary'), /Çift tıkla bölünen yer: 1/);
    // ilk parçayı seç → panelde "bölmeyi geri al" (sonrakiyle birleştir)
    const nb = await noteBox(idx);
    await page.mouse.click(tl.x + (nb.x0 + nb.x1) / 2, tl.y + nb.y);
    assert.match(await page.textContent('#inspector .rm-bar'), /çift tıkla bölündü/);
    await page.click('#inspector .rm-bar button[data-act=unsplitEnd]');
    assert.equal(await S(() => window.__daw.d.notes.length), before);
    assert.equal(await S(() => window.__daw.proj.noteSplits.length), 0);
    // bir daha böl → yeniden analizde de uygulanır → özetten hepsini geri al
    await page.mouse.dblclick(tl.x + (b.x0 + b.x1) / 2, tl.y + b.y);
    await page.waitForFunction((n) => window.__daw.d.notes.length === n + 1, before, { timeout: 5000 });
    await page.click('#btnAnalyze'); await waitStatus(/Analiz tamam/);
    assert.equal(await S(() => window.__daw.d.notes.length), before + 1, 'yeniden analizde bölme korunur');
    // kenara çok yakın çift tık reddedilir
    await page.click('#editSummary button[data-clear=splits]');
    assert.equal(await S(() => window.__daw.d.notes.length), before);
    const b2 = await noteBox(idx);
    await page.mouse.dblclick(tl.x + b2.x0 + 3, tl.y + b2.y);
    await page.waitForTimeout(200);
    assert.equal(await S(() => window.__daw.d.notes.length), before);
    assert.match(await page.textContent('#status'), /kenarına çok yakın/);
    return `${before} → ${before + 1} → ${before} nota; parçalar ${r.med.map((x) => x.toFixed(1)).join(' / ')} · yeniden analizde korunur · kenar reddedilir`;
  });

  await step('Şarkıyı kaydır: +2 ölçü boşluk (bölümler, kilitler, ölçü sayısı, ses birlikte), geri alınır; başta boşluk yoksa öne alma reddedilir', async () => {
    await resetTest();
    const g = await S(() => ({ bars: window.__daw.d.bars, secs: window.__daw.proj.sections.map((x) => [x.startBar, x.endBar]), q: window.__daw.d.notes[0].q0, off: window.__daw.d.off }));
    await page.click('[data-shift="-1"]');
    assert.match(await page.textContent('#status'), /boş ölçü var|ses kesilir/);
    assert.equal(await S(() => window.__daw.proj.audio.leadBars), 0);
    await page.click('[data-shift="2"]');
    const a = await S(() => ({ bars: window.__daw.d.bars, secs: window.__daw.proj.sections.map((x) => [x.startBar, x.endBar]), q: window.__daw.d.notes[0].q0, lead: window.__daw.proj.audio.leadBars, off: window.__daw.d.off, info: document.querySelector('#shiftInfo').textContent }));
    assert.equal(a.lead, 2); assert.equal(a.bars, g.bars + 2);
    assert.deepEqual(a.secs, g.secs.map(([x, y]) => [x + 2, y + 2]));
    assert.ok(Math.abs(a.q - (g.q + 8)) < 1e-6, 'ilk nota 2 ölçü sonra'); assert.ok(Math.abs(g.off - a.off - 4) < 1e-6, 'ofset 2 ölçü (4 s) azaldı');
    assert.match(a.info, /başta 2 ölçü boşluk var/);
    // ilk 2 ölçüde akor yok (bölüm yok) — 3. ölçüden başlar
    assert.ok(await S(() => window.__daw.d.chords.every((c) => c.bar >= 3)));
    await page.click('[data-shift="-2"]');
    const z = await S(() => ({ bars: window.__daw.d.bars, secs: window.__daw.proj.sections.map((x) => [x.startBar, x.endBar]), q: window.__daw.d.notes[0].q0, lead: window.__daw.proj.audio.leadBars }));
    assert.deepEqual(z.secs, g.secs); assert.equal(z.lead, 0); assert.equal(z.bars, g.bars); assert.ok(Math.abs(z.q - g.q) < 1e-6);
    return `+2 ölçü: ${g.bars} → ${a.bars} ölçü, bölümler ${JSON.stringify(a.secs)}, ilk nota q ${g.q.toFixed(2)} → ${a.q.toFixed(2)} · −2 ile döndü · başta boşluk yokken −1 reddedildi`;
  });

  await step('Akor ve davul girişi: sayı kutusu + cetveldeki 🎹/🥁 bayraklarını sürükle; o ölçü akor için 1. ölçü; öncesinde akor yok; imleçten', async () => {
    const tl = await resetTest();
    await page.fill('#inChordStart', '3'); await page.dispatchEvent('#inChordStart', 'change');
    const a = await S(() => ({ cs: window.__daw.proj.chordStartBar, first: Math.min(...window.__daw.d.chords.map((c) => c.bar)), first0: window.__daw.d.chords[0].chord, st: window.__daw.d.chordStart, info: document.querySelector('#chordStartInfo').textContent }));
    assert.equal(a.cs, 3); assert.equal(a.first, 3); assert.equal(a.st, 3);
    assert.match(a.info, /Ölçü 1–2: akor ve piyano yok/);
    // bayrağı sürükle: ölçü 3 → 2
    const geo = await S(() => { const g = window.__daw.d.g; return { bx: (3 - 1) * g.barQ * window.__daw.view.pxPerQ, w: g.barQ * window.__daw.view.pxPerQ }; });
    const fx = tl.x + 46 + geo.bx + 24 + 12, fy = tl.y + 10;
    await page.mouse.move(fx, fy); await page.mouse.down();
    await page.mouse.move(fx - geo.w * 0.7, fy, { steps: 8 });
    const live = await S(() => window.__daw.drag && window.__daw.drag.bar);
    await page.mouse.up();
    assert.equal(live, 2, 'sürüklerken bayrak ölçüye yapışır');
    assert.equal(await S(() => window.__daw.proj.chordStartBar), 2);
    assert.equal(await S(() => Math.min(...window.__daw.d.chords.map((c) => c.bar))), 2);
    assert.match(await page.textContent('#status'), /Akorlar ölçü 2'den girer/);
    // davul: sayı kutusu + imleçten (imleç 3. ölçüye)
    await page.fill('#inDrumStart', '4'); await page.dispatchEvent('#inDrumStart', 'change');
    assert.equal(await S(() => window.__daw.proj.drums.startBar), 4);
    assert.match(await page.textContent('#drumStartInfo'), /Ölçü 1–3: davul yok/);
    await S(() => { window.__daw.pos = 2 * window.__daw.d.g.barSec + 0.3; });
    await page.click('#btnDrumHere');
    assert.equal(await S(() => window.__daw.proj.drums.startBar), 3);
    // 🥁 bayrağı sürükle → 5; aynı ölçüdeyse yan yana (çakışmaz)
    const fx2 = tl.x + 46 + 2 * geo.w + 24 + 12;
    await page.mouse.move(fx2, fy); await page.mouse.down();
    await page.mouse.move(fx2 + geo.w * 2, fy, { steps: 8 }); await page.mouse.up();
    assert.equal(await S(() => window.__daw.proj.drums.startBar), 5);
    // MIDI davul 5. ölçüden başlar
    await S(() => { window.__daw.proj.drums.on = true; window.__dawAPI.refresh(); });
    const mid = await download('#btnExpMidi');
    const pm = Core.parseMidi(new Uint8Array(mid.data));
    const dr = pm.tracks.find((t) => /Davul/.test(t.name));
    assert.ok(dr && dr.notes.length > 0);
    const firstDrum = Math.min(...dr.notes.map((n) => (n.q0 != null ? n.q0 : n.tick / 480)));
    assert.ok(firstDrum >= 16 - 1e-6, 'davul 5. ölçüden (q=16) başlar: ' + firstDrum);
    await page.fill('#inChordStart', '1'); await page.dispatchEvent('#inChordStart', 'change');
    await page.fill('#inDrumStart', '1'); await page.dispatchEvent('#inDrumStart', 'change');
    await S(() => { window.__daw.proj.drums.on = false; window.__dawAPI.refresh(); });
    return `akor girişi 3 → bayrakla 2 · davul 4 → imleçten 3 → bayrakla 5 · MIDI davul q=${firstDrum} ve sonrası`;
  });

  await step('Akor sesi: piyano / synth × akor / arpej seçilir; tekrar basma modları; synth çalar ve mix WAV / MIDI\'ye girer', async () => {
    await resetTest();
    const opts = await page.$$eval('#inPianoStyle option', (o) => o.map((x) => x.textContent));
    assert.deepEqual(opts, ['Piyano — akor', 'Piyano — arpej', 'Synth klavye — akor', 'Synth klavye — arpej', 'Piyano — shuffle (X . t)', 'Synth klavye — shuffle (X . t)']);
    assert.equal(await page.inputValue('#inPianoRepeat'), 'hold', 'varsayılan: aynı akor bir kez basılır');
    assert.equal(await page.isHidden('#arpWrap'), true);
    await page.selectOption('#inPianoStyle', 'synth-arp');
    assert.equal(await S(() => window.__daw.proj.piano.style), 'synth-arp');
    assert.equal(await page.isVisible('#arpWrap'), true);
    await page.selectOption('#inArpRate', '1/16');
    await page.selectOption('#inPianoRepeat', 'fade');
    assert.equal(await page.isVisible('#holdWrap'), true);
    const h0 = await S(() => window.__dawAPI.player().synthHits || 0);
    await page.click('#btnPlay');
    await page.waitForFunction((h) => (window.__dawAPI.player().synthHits || 0) > h + 8, h0, { timeout: 20000 });
    await page.click('#btnPlay');
    const hits = (await S(() => window.__dawAPI.player().synthHits)) - h0;
    const mix = await download('#btnExpMix');
    assert.equal(mix.data.slice(0, 4).toString(), 'RIFF');
    // synth akor + sönme: MIDI'de uzun notalar
    await page.selectOption('#inPianoStyle', 'synth-chord');
    await page.selectOption('#inPianoRepeat', 'hold');
    await page.fill('#inHoldBars', '4'); await page.dispatchEvent('#inHoldBars', 'change');
    const mid = await download('#btnExpMidi');
    const pm = Core.parseMidi(new Uint8Array(mid.data));
    const tr = pm.tracks[2];
    assert.ok(/Synth klavye/.test(tr.name) || /Akorlar/.test(tr.name), tr.name);
    const dur = (n) => (n.q1 != null ? n.q1 - n.q0 : (n.endTick - n.tick) / 480);
    await page.selectOption('#inPianoRepeat', 'off');
    const pm2 = Core.parseMidi(new Uint8Array((await download('#btnExpMidi')).data));
    assert.ok(pm2.tracks[2].notes.length >= tr.notes.length, 'her ölçüde yeniden bas: nota sayısı en az hold kadar');
    await page.selectOption('#inPianoStyle', 'piano-chord');
    await page.selectOption('#inPianoRepeat', 'hold');
    return `synth arpej 1/16 çalarken ${hits} nota tetiklendi · mix WAV ${(mix.data.length / 1e6).toFixed(1)} MB · MIDI "${tr.name}": hold ${tr.notes.length} nota, off ${pm2.tracks[2].notes.length}`;
  });

  // ---------------------------------------------------------------- bas, düzenleme, döngü, demo, geri alma
  const hist = () => S(() => { const h = window.__dawAPI.hist(); return { u: h.undo.length, r: h.redo.length }; });
  const pause = (ms = 650) => page.waitForTimeout(ms); // 0,5 sn içindeki değişiklikler tek geri alma adımında birleşir

  await step('Genel geri alma (Ctrl+Z / Ctrl+Shift+Z / düğmeler): sürükleme tek adım; akor girişi, şarkıyı kaydır, nota bölme geri alınır; ses yeni yüklenince geçmiş sıfırlanır', async () => {
    const tl = await resetTest();
    assert.equal(await page.isDisabled('#btnUndo'), true, 'yeni ses: geri alınacak şey yok');
    const e0 = await effs();
    await pause();
    await marquee(tl, 0, 3);
    await pause();
    const sel = await S(() => window.__daw.sel.ids.map((id) => window.__daw.d.notes.findIndex((n) => n.id === id)));
    const b1 = await noteBox(sel[1]);
    await page.mouse.move(tl.x + (b1.x0 + b1.x1) / 2, tl.y + b1.y); await page.mouse.down();
    await page.mouse.move(tl.x + (b1.x0 + b1.x1) / 2, tl.y + b1.y - 2 * b1.rowH, { steps: 12 });
    await page.mouse.up();
    const e1 = await effs();
    assert.deepEqual(await hist(), { u: 1, r: 0 }, 'bir sürükleme = tek geri alma adımı');
    assert.equal(await page.isDisabled('#btnUndo'), false);
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await page.waitForFunction(() => window.__dawAPI.hist().undo.length === 0, null, { timeout: 5000 });
    assert.deepEqual(await effs(), e0, 'Ctrl+Z: notalar eski yerinde');
    assert.deepEqual(await hist(), { u: 0, r: 1 });
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await page.waitForFunction(() => window.__dawAPI.hist().redo.length === 0, null, { timeout: 5000 });
    assert.deepEqual(await effs(), e1, 'Ctrl+Shift+Z: yeniden');
    // akor girişi + kaydırma → düğmelerle geri al
    await pause();
    await page.fill('#inChordStart', '3'); await page.dispatchEvent('#inChordStart', 'change');
    await pause();
    await page.click('[data-shift="2"]');
    assert.equal(await S(() => window.__daw.proj.audio.leadBars), 2);
    await pause();
    await page.click('#btnUndo');
    await page.waitForFunction(() => window.__daw.proj.audio.leadBars === 0, null, { timeout: 5000 });
    assert.equal(await S(() => window.__daw.proj.chordStartBar), 3);
    await page.click('#btnUndo');
    await page.waitForFunction(() => window.__daw.proj.chordStartBar === 1, null, { timeout: 5000 });
    assert.equal(await page.inputValue('#inChordStart'), '1', 'sayı kutusu da geri döndü');
    await pause();
    // nota bölme geri alınır (yeniden bölütleme)
    const before = await S(() => window.__daw.d.notes.length);
    const idx = await S(() => { const ns = window.__daw.d.notes; let b = 0; ns.forEach((n, i) => { if (n.q1 - n.q0 > ns[b].q1 - ns[b].q0) b = i; }); return b; });
    await S(`(() => { const n = window.__daw.d.notes[${idx}]; document.querySelector('#tlScroll').scrollLeft = Math.max(0, 46 + n.q0 * window.__daw.view.pxPerQ - 200); })()`);
    await pause(200);
    const bx = await noteBox(idx);
    await page.mouse.dblclick(tl.x + (bx.x0 + bx.x1) / 2, tl.y + bx.y);
    await page.waitForFunction((n) => window.__daw.d.notes.length === n + 1, before, { timeout: 5000 });
    await pause();
    await page.keyboard.press('Control+z');
    await page.waitForFunction((n) => window.__daw.d.notes.length === n, before, { timeout: 5000 });
    assert.equal(await S(() => window.__daw.proj.noteSplits.length), 0);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction((n) => window.__daw.d.notes.length === n + 1, before, { timeout: 5000 });
    // yeni ses → geçmiş sıfırlanır
    await resetTest();
    assert.deepEqual(await hist(), { u: 0, r: 0 });
    assert.equal(await page.isDisabled('#btnUndo'), true);
    return 'sürükleme tek adım · Ctrl+Z / Ctrl+Shift+Z · düğmeler · akor girişi, kaydırma, bölme geri alınır · yeni ses geçmişi sıfırlar';
  });

  await step('Bas: panel, kalıp seçimi, çalarken bas çalar; ⟳ Başka (bas / davul / akor sesi) seçeneği değiştirip hemen çalar', async () => {
    await resetTest();
    assert.equal(await S(() => window.__daw.proj.bass.on), false);
    assert.match(await page.textContent('#bassInfo'), /Otomatik: /);
    const opts = await page.$$eval('#inBassPattern option', (o) => o.map((x) => x.value));
    assert.deepEqual(opts.slice(0, 4), ['auto', 'kick', 'shuffle', 'pop']);
    await page.check('#inBassOn');
    await page.selectOption('#inBassPattern', 'pop');
    const ev = await S(() => window.__dawAPI.arrangement().bass);
    assert.ok(ev.length > 20 && ev.every((e) => e.midi >= 28 && e.midi <= 55));
    const h0 = await S(() => window.__dawAPI.player().bassHits || 0);
    await page.click('#btnPlay');
    await page.waitForFunction((h) => (window.__dawAPI.player().bassHits || 0) > h + 3, h0, { timeout: 20000 });
    await page.click('#btnPlay');
    // ⟳ bas
    const p0 = await S(() => window.__daw.proj.bass.pattern);
    await page.click('#btnBassNext');
    const p1 = await S(() => window.__daw.proj.bass.pattern);
    assert.notEqual(p1, p0); assert.match(await page.textContent('#status'), /^Bas: /);
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 10000 });
    // ⟳ davul: sıradaki loop, davul açılır
    const l0 = await S(() => window.__daw.proj.drums.loop);
    await page.click('#btnDrumNext');
    const l1 = await S(() => ({ loop: window.__daw.proj.drums.loop, on: window.__daw.proj.drums.on }));
    assert.notEqual(l1.loop, l0); assert.equal(l1.on, true); assert.match(await page.textContent('#status'), /^Davul: /);
    // ⟳ akor sesi: dört seçenek sırayla
    const st0 = await S(() => window.__daw.proj.piano.style);
    await page.click('#btnStyleNext');
    const st1 = await S(() => window.__daw.proj.piano.style);
    assert.notEqual(st1, st0); assert.equal(await page.inputValue('#inPianoStyle'), st1);
    const seen = new Set([st0, st1]);
    for (let i = 0; i < 5; i++) { await page.click('#btnStyleNext'); seen.add(await S(() => window.__daw.proj.piano.style)); }
    assert.equal(seen.size, 6, 'altı akor sesi sırayla geziliyor');
    await page.click('#btnPlay');
    // mix WAV ve MIDI bas içerir
    const mid = await download('#btnExpMidi');
    const pm = Core.parseMidi(new Uint8Array(mid.data));
    assert.ok(pm.tracks.some((t) => t.name === 'Bas' && t.notes.length > 20) && pm.tracks.some((t) => /Davul/.test(t.name)));
    const mix = await download('#btnExpMix');
    assert.equal(mix.data.slice(0, 4).toString(), 'RIFF');
    await page.uncheck('#inBassOn');
    return `bas ${ev.length} nota; ⟳ bas ${p0} → ${p1}, davul ${l0} → ${l1.loop}, akor sesi ${[...seen].join(' / ')} · MIDI "Bas" + davul izi`;
  });

  await step('Bölüm düzenlemesi: bölüme tıkla → davul / bas / akor sesi genel ayardan farklı; geçişte fill; ⟳ bölüm için; döngü seçili bölümü çalar ve baştan sarar', async () => {
    const tl = await resetTest();
    await page.check('#inDrumsOn'); await page.check('#inBassOn');
    const secId = await S(() => window.__daw.d.sections[0].id);
    // bölüm şeridine tıkla → denetçide düzenleme alanı
    await page.mouse.click(tl.x + 46 + 120, tl.y + 22 + 13);
    assert.equal(await S(() => window.__daw.sel.type), 'section');
    assert.equal(await page.locator('#inspector fieldset.arr').count(), 1);
    // davul: bu bölümde yok
    await page.selectOption('#inspector select[data-kind=drums]', 'off');
    const sec1 = await S(() => { const d = window.__daw.d; return [d.sections[0].startBar, d.sections[0].endBar, d.sections[1].startBar]; });
    let arr = await S(() => window.__dawAPI.arrangement());
    const bar = (e) => Math.floor((e.q ?? e.q0) / 4) + 1;
    assert.ok(arr.drums.every((e) => bar(e) > sec1[1]), 'verse: davul yok, nakarat: var');
    assert.ok(arr.drums.length > 0);
    // davul bu bölümde sade loop; geçişte fill
    await page.selectOption('#inspector select[data-kind=drums]', 'minimal');
    arr = await S(() => window.__dawAPI.arrangement());
    const fills = arr.drums.filter((e) => e.fill);
    assert.ok(fills.length === 4 && fills.every((e) => bar(e) === sec1[1]), 'bölüm geçişinde (verse son ölçüsü) 4 vuruşluk fill: ' + fills.length);
    await page.uncheck('#inDrumFills');
    assert.equal((await S(() => window.__dawAPI.arrangement().drums.filter((e) => e.fill).length)), 0, 'fill kapatılabilir');
    await page.check('#inDrumFills');
    // bas: bu bölümde yarım notalar; akor sesi: bu bölümde synth arpej
    await page.selectOption('#inspector select[data-kind=bass]', 'half');
    await page.selectOption('#inspector select[data-kind=piano]', 'synth-arp');
    arr = await S(() => window.__dawAPI.arrangement());
    assert.ok(arr.piano.filter((e) => bar({ q: e.q0 }) <= sec1[1]).every((e) => e.inst === 'synth' && e.arp));
    assert.ok(arr.piano.filter((e) => bar({ q: e.q0 }) > sec1[1]).every((e) => e.inst === 'piano'));
    const bassV = arr.bass.filter((e) => bar(e) <= sec1[1]), bassC = arr.bass.filter((e) => bar(e) > sec1[1]);
    assert.ok(bassV.length > 0 && bassV.length < bassC.length * 1.2 && new Set(bassV.map((e) => e.q0 % 4)).size <= 2, 'verse: yarım notalı bas (ölçüde en çok 2 vuruş)');
    // ⟳ bu bölüm için
    await page.click('#inspector button[data-act=arrNext][data-kind=bass]');
    assert.match(await page.textContent('#status'), /^Bas \(bu bölüm\): /);
    // genel ayara dön
    for (const k of ['drums', 'bass', 'piano']) await page.selectOption(`#inspector select[data-kind=${k}]`, '');
    assert.equal(await S(() => window.__daw.proj.sections[0].arr === undefined), true);
    // döngü: bölümü seç → 🔁 → bölge bölüm; bir sonraki bölüme tıklayınca bölge ona geçer
    await page.click('#btnLoop');
    let lp = await S(() => ({ ...window.__daw.loop }));
    assert.equal(lp.on, true); assert.ok(Math.abs(lp.from - 0) < 1e-6 && Math.abs(lp.to - sec1[1] * 2) < 1e-6, JSON.stringify(lp));
    await page.mouse.click(tl.x + 46 + (sec1[2] - 1) * 4 * 44 + 100, tl.y + 22 + 13);
    lp = await S(() => ({ ...window.__daw.loop }));
    assert.ok(Math.abs(lp.from - (sec1[2] - 1) * 2) < 1e-6, 'döngü seçilen bölümü izler: ' + JSON.stringify(lp));
    // dar bir bölgeyle sarma testi: 1,2 s (önce çalmayı durdur: ⟳ düğmeleri çalmaya başlatmıştı)
    await S(() => { window.__dawAPI.stop(); });
    await S(() => { const l = window.__daw.loop; l.from = 0.4; l.to = 1.6; window.__daw.pos = 0.4; });
    await page.click('#btnPlay');
    const seen = await S(async () => {
      const out = [];
      for (let i = 0; i < 38; i++) { await new Promise((r) => setTimeout(r, 100)); out.push(window.__daw.pos); }
      return out;
    });
    await page.click('#btnPlay');
    assert.ok(Math.max(...seen) < 1.7 && Math.min(...seen) >= 0.39, 'imleç bölgede kalır: ' + Math.min(...seen) + '…' + Math.max(...seen));
    assert.ok(seen.some((v, i) => i && v < seen[i - 1] - 0.5), 'bölge sonunda baştan sarar');
    await page.click('#btnLoop');
    assert.equal(await S(() => window.__daw.loop.on), false);
    await page.uncheck('#inDrumsOn'); await page.uncheck('#inBassOn');
    return `verse: davul yok → sade loop + ${fills.length} vuruşluk fill · bas yarım notalar · akor sesi synth arpej · döngü ${seen.length} örnek, ${Math.min(...seen).toFixed(2)}…${Math.max(...seen).toFixed(2)} s`;
  });

  await step('Elle seçimler otomatiğin üstünde: Demo ölçü / BPM / loop / bas kalıbı / bölüm düzenlemesine dokunmaz; loop ve bas listeleri puanlı ve görünür, ▶ seçmeden dinletir, Seç elle seçtirir', async () => {
    await resetTest();
    // ölçüyü ve tempoyu sen seç: melodi 4/4 ama proje 3/4, 100 BPM
    await page.selectOption('#inMeter', '3/4');
    await page.fill('#inBpm', '100'); await page.dispatchEvent('#inBpm', 'change');
    // elle: loop, bas kalıbı, bölüm düzenlemesi
    await page.selectOption('#inDrumLoop', 'waltz');
    await page.selectOption('#inBassPattern', 'walk');
    await S(() => { const p = window.__daw.proj; p.sections[0].arr = { drums: 'off' }; window.__dawAPI.refresh(); });
    await pause();
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    const r = await S(() => { const p = window.__daw.proj; return { meter: p.settings.meter, bpm: p.settings.bpm, loop: p.drums.loop, bass: p.bass.pattern, arr0: p.sections[0].arr, arr1: p.sections[1].arr || null, drums: p.drums.on, bassOn: p.bass.on }; });
    assert.equal(r.meter, '3/4', 'Demo ölçüyü değiştirmedi'); assert.equal(r.bpm, 100);
    assert.equal(r.loop, 'waltz'); assert.equal(r.bass, 'walk');
    assert.deepEqual(r.arr0, { drums: 'off' }, 'elle verilen bölüm düzenlemesi korundu');
    assert.equal(r.drums, true); assert.equal(r.bassOn, true);
    const st = await page.textContent('#status');
    assert.match(st, /ölçü\/tempo[^·]*3\/4, 100 BPM/); assert.match(st, /elle seçtiklerin korundu: davul loop'u, bas kalıbı/);
    await S(() => window.__dawAPI.stop());
    // otomatik demo (elle seçim yok): verse için otomatik düzenleme "auto" işaretli; elle değiştirince senin olur
    await resetTest();
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    assert.equal(await S(() => window.__daw.proj.sections[0].arr.auto), true);
    assert.equal(await S(() => window.__daw.proj.settings.meter), '4/4');
    await S(() => window.__dawAPI.stop());
    await page.click('#btnDemo'); // ikinci demo otomatik düzenlemeyi yeniler, çoğaltmaz
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    await S(() => window.__dawAPI.stop());
    // puanlı listeler görünür
    await resetTest();
    const nDrum = await page.locator('#drumRank .rank-row').count(), nBass = await page.locator('#bassRank .rank-row').count();
    assert.equal(nDrum, 10, "4/4'te 10 davul loop'u puanlı listede (itmeli pop-rock ve shuffle hücresi dahil)"); assert.equal(nBass, 8);
    assert.ok(await page.isVisible('#drumRank .rank-row'), 'liste açık bölümde görünür');
    const names = await page.$$eval('#drumRank .rk-name', (e) => e.map((x) => x.textContent));
    assert.ok(names.some((x) => /İtmeli pop-rock/.test(x)) && names.some((x) => /Sade/.test(x)) && names.some((x) => /X \. t/.test(x)), 'yeni loop\'lar listede: ' + names.join(' | '));
    const scores = await page.$$eval('#drumRank .rk-score', (e) => e.map((x) => +x.textContent));
    assert.ok(scores.every((v, i) => i === 0 || scores[i - 1] >= v), "loop'lar puan sırasıyla");
    // ▶ seçmeden dinletir: ayarlar değişmez, bas / davul çalar
    const before = await S(() => JSON.stringify({ l: window.__daw.proj.drums.loop, o: window.__daw.proj.drums.on, b: window.__daw.proj.bass.pattern }));
    const h0 = await S(() => (window.__dawAPI.player().drumHits || 0) + (window.__dawAPI.player().bassHits || 0));
    await page.click('#drumRank button[data-pv=drums][data-id=four]');
    await page.waitForFunction((h) => (window.__dawAPI.player().drumHits || 0) + (window.__dawAPI.player().bassHits || 0) > h + 4, h0, { timeout: 20000 });
    await page.waitForFunction(() => !window.__dawAPI.player().playing, null, { timeout: 15000 }); // 2 ölçü sonra kendiliğinden biter
    assert.equal(await S(() => JSON.stringify({ l: window.__daw.proj.drums.loop, o: window.__daw.proj.drums.on, b: window.__daw.proj.bass.pattern })), before, 'önizleme ayarı değiştirmez');
    await page.click('#bassRank button[data-pv=bass][data-id=walk]');
    await page.waitForFunction((h) => (window.__dawAPI.player().bassHits || 0) > h, await S(() => window.__dawAPI.player().bassHits || 0), { timeout: 20000 });
    await S(() => window.__dawAPI.stop());
    // Seç → elle seçim: ✋ rozeti, puana bakılmadan geçerli
    await page.click('#bassRank button[data-pick=bass][data-id=eighths]');
    assert.equal(await S(() => window.__daw.proj.bass.pattern), 'eighths');
    assert.match(await page.textContent('#chipS8c'), /✋/);
    assert.match(await page.textContent('#bassRank .rank-row.cur'), /senin seçimin/);
    await page.click('#drumRank button[data-pick=drums][data-id=boombap]');
    assert.equal(await S(() => window.__daw.proj.drums.loop), 'boombap'); assert.match(await page.textContent('#chipS8b'), /✋/);
    await S(() => window.__dawAPI.stop());
    await page.selectOption('#inBassPattern', 'auto'); await page.selectOption('#inDrumLoop', 'auto');
    return `Demo: 3/4, 100 BPM, waltz, walk, bölüm düzenlemesi korundu · listeler ${nDrum} loop / ${nBass} bas kalıbı puanlı · ▶ seçmeden çalar · Seç → ✋`;
  });

  await step('Öncelik ✂ > elle akor > motor: işaretleyince o ölçünün akoru hemen yenilenir; elle "Uygula"; "Son elle yaptığımdan sonrasını otomatik uygula" öncesine dokunmadan kalanı bütün olarak belirler', async () => {
    const tl = await resetTest();
    assert.equal(await page.isDisabled('#btnApplyAfter'), true, 'henüz elle yapılmış bir şey yok');
    const names = () => S(() => window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}`));
    const n0 = await names();
    // 6. ölçü başında ✂ → o noktadaki akor hemen yeniden belirlenir; diğerleri sabitlenir (📌)
    await S(() => { document.querySelector('#tlScroll').scrollLeft = Math.max(0, 46 + 20 * window.__daw.view.pxPerQ - 420); });
    await page.waitForTimeout(150);
    const sl = await S(() => document.querySelector('#tlScroll').scrollLeft), ppq = await S(() => window.__daw.view.pxPerQ);
    await page.mouse.click(tl.x + 46 + 20 * ppq - sl, tl.y + 22 + 26 + 5);
    assert.equal(await S(() => window.__daw.proj.changeMarks.length), 1);
    assert.equal(await S(() => window.__daw.proj.changeMarks[0].bar), 6);
    const n1 = await names();
    for (const c of n0) if (!/^6:/.test(c)) assert.ok(n1.includes(c), 'diğer akorlar yerinde: ' + c);
    // 7. ölçüde elle akor: sadece "Uygula"
    await page.mouse.click(tl.x + 46 + (24 + 2) * ppq - sl, tl.y + 22 + 26 + 18);
    assert.equal(await S(() => window.__daw.sel.type), 'chord');
    assert.equal((await page.textContent('#inspector button[data-act=manualChord]')).trim(), 'Uygula', 'elle yaz düğmesi yalnızca "Uygula"');
    await page.fill('#chInput', 'A'); await page.click('#inspector button[data-act=manualChord]');
    assert.equal(await S(() => window.__daw.d.chords.find((c) => c.bar === 7).locked), true);
    assert.equal(await S(() => window.__dawAPI.C.chordName(window.__daw.d.chords.find((c) => c.bar === 7).chord)), 'A');
    assert.equal(await page.isDisabled('#btnApplyAfter'), false); assert.match(await page.textContent('#afterInfo'), /ölçü 7/);
    // kalan ölçüler şu an sabit (📌); düğme son yapılan ölçü (7) sonrasını serbest bırakır
    assert.ok(await S(() => window.__daw.d.chords.filter((c) => c.bar > 7).every((c) => c.pinned)), 'sonraki akorlar sabit');
    const before = await names();
    await page.click('#btnApplyAfter');
    const after = await names();
    assert.deepEqual(after.filter((c) => +c.split(':')[0].split('.')[0] <= 7), before.filter((c) => +c.split(':')[0].split('.')[0] <= 7), "ölçü 7'ye kadar hiçbir şey değişmedi");
    assert.ok(await S(() => window.__daw.d.chords.filter((c) => c.bar > 7).every((c) => !c.pinned)), 'sonrası serbest: motor belirledi');
    assert.equal(await S(() => window.__daw.proj.changeMarks.length), 1); assert.equal(await S(() => window.__daw.proj.chordLocks.length), 1);
    assert.match(await page.textContent('#status'), /Ölçü 7'ye kadar .* aynen kaldı; ölçü 8'den sonrası/);
    await page.click('#btnUnlockAll'); await page.click('#btnClearMarks');
    return `✂ 6. ölçü → akor yenilendi · 7. ölçü elle A · düğme: ≤7 aynı, 8+ motor (${after.filter((c) => +c.split(':')[0] > 7).join(' ')})`;
  });

  await step('✨ Demo yap: ölçü + ton + akor + davul + bas tek tuşla, çalar; verse sade / nakarat dolu; tek Ctrl+Z ile geri', async () => {
    await resetTest();
    const pre = await S(() => ({ drums: window.__daw.proj.drums.on, bass: window.__daw.proj.bass.on, secs: window.__daw.proj.sections.map((s) => s.tonic) }));
    assert.equal(pre.drums, false); assert.equal(pre.bass, false); assert.deepEqual(pre.secs, [null, null]);
    await pause();
    await page.click('#btnDemo');
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 20000 });
    const st = await page.textContent('#status');
    assert.match(st, /Demo hazır/); assert.match(st, /ton: Verse C# Frig, Nakarat B Dorian/); assert.match(st, /davul: /); assert.match(st, /bas: /);
    const r = await S(() => { const p = window.__daw.proj; return { drums: p.drums.on, bass: p.bass.on, loop: p.drums.loop, fills: p.drums.fills, secs: p.sections.map((s) => [s.tonic != null, s.arr || null]), ev: window.__dawAPI.arrangement() }; });
    assert.equal(r.drums, true); assert.equal(r.bass, true); assert.equal(r.fills, true);
    assert.ok(r.secs.every(([k]) => k), 'tonlar onaylandı');
    assert.ok(r.secs[0][1] && r.secs[0][1].bass === 'half', 'verse: sade bas'); assert.equal(r.secs[1][1], null, 'nakarat: genel ayar');
    assert.ok(r.ev.drums.length > 0 && r.ev.bass.length > 0 && r.ev.drums.some((e) => e.fill));
    await page.waitForFunction(() => window.__daw.pos > 0.4, null, { timeout: 15000 });
    await page.click('#btnPlay');
    // tek adımda geri
    assert.equal((await hist()).u, 1, 'demo tek geri alma adımı');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.__daw.proj.bass.on, null, { timeout: 5000 });
    const z = await S(() => { const p = window.__daw.proj; return { drums: p.drums.on, bass: p.bass.on, secs: p.sections.map((s) => [s.tonic, !!s.arr]) }; });
    assert.deepEqual(z, { drums: false, bass: false, secs: [[null, false], [null, false]] });
    return `davul ${r.loop}, ${r.ev.drums.length} vuruş (fill var), bas ${r.ev.bass.length} nota; Ctrl+Z ile hepsi geri`;
  });

  await step('Alt bölme / swing: düz · üçleme (12/8) · özel oran; kayıttan ölç; davul, bas ve akor shuffle (X . t) aynı ızgarada; quantize ve cetvel orana uyar; geri alınır', async () => {
    const tl = await resetTest();
    assert.equal(await page.inputValue('#inSubdiv'), 'straight'); assert.equal(await page.isHidden('#swingWrap'), true);
    // üçleme modu: oran 2/3, çip, thirds çizgileri
    await page.selectOption('#inSubdiv', 'triplet');
    assert.ok(Math.abs((await S(() => window.__daw.proj.swing.ratio)) - 2 / 3) < 1e-3);
    assert.match(await page.textContent('#chipS1'), /üçleme/);
    // özel oran: %70
    await page.fill('#inSwing', '70'); await page.dispatchEvent('#inSwing', 'change');
    assert.equal(await S(() => window.__daw.proj.swing.ratio), 0.7);
    assert.equal(await page.inputValue('#inSubdiv'), 'swing'); assert.match(await page.textContent('#chipS1'), /swing %70/);
    // kayıttan ölç: test melodisi düz sekizliklerle yazılmış → ölçülen oran ≈ %50 ya da ölçülemedi; swing'li sentetik nota seti için çekirdek testinde doğrulanır
    await page.click('#btnSwingMeasure');
    assert.match(await page.textContent('#swingInfo'), /%\d+|Ölçülemedi/);
    // katmanlar: davul 'shuffle hücresi', bas 'shuffle', akor sesi 'piyano shuffle'; hepsinin "let" yeri aynı (%70)
    await S(() => { const p = window.__daw.proj; p.drums.on = true; p.drums.loop = 'shufflecell'; p.bass.on = true; p.bass.pattern = 'shuffle'; p.piano.style = 'piano-shuffle'; p.piano.repeat = 'off'; window.__dawAPI.refresh(); });
    const fr = (q) => Math.round((q - Math.floor(q + 1e-9)) * 1000) / 1000;
    const arr = await S(() => window.__dawAPI.arrangement());
    const ghostBass = arr.bass.filter((e) => e.vel < 60).map((e) => fr(e.q0)), ghostDrum = arr.drums.filter((e) => e.kind === 'H' && e.vel < 0.5).map((e) => fr(e.q)), ghostKeys = arr.piano.filter((e) => e.vel < 40).map((e) => fr(e.q0));
    for (const [n, a] of [['bas', ghostBass], ['davul', ghostDrum], ['akor', ghostKeys]]) { assert.ok(a.length > 8, n + ' ghost sayısı'); assert.deepEqual([...new Set(a)], [0.7], `${n}: ghost vuruşun %70'inde`); }
    assert.ok(arr.bass.filter((e) => e.vel >= 90).every((e) => fr(e.q0) === 0), 'X vuruşun başında');
    // quantize swing ızgarasına: 1/8 → zayıf sekizlik %70
    await page.selectOption('#inQuantGrid', '1/8');
    const snap = await S(() => { const d = window.__daw.d; const r = window.__dawAPI.C.quantizeTargets(d.notes, d.g, { gridQ: 0.5, strength: 1, swing: 0.7, anchor: 0.5 }); return r.targets.filter((t) => t.q0to != null).map((t) => Math.round((t.q0to - Math.floor(t.q0to + 1e-9)) * 100) / 100); });
    assert.ok(snap.every((v) => v === 0 || v === 0.7 || v === 0.5 + 0.2 || v === 0.35 || v === 0.85), 'quantize hedefleri swing ızgarasında: ' + JSON.stringify(snap));
    // geri al: oran %50'ye döner
    await pause();
    await page.selectOption('#inSubdiv', 'straight');
    assert.equal(await S(() => window.__daw.proj.swing.ratio), 0.5);
    await pause();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__daw.proj.swing.ratio === 0.7, null, { timeout: 5000 });
    assert.equal(await page.inputValue('#inSwing'), '70');
    await page.selectOption('#inSubdiv', 'straight');
    return `oran %70: bas / davul / akor ghost'ları ${[...new Set(ghostBass)]} / ${[...new Set(ghostDrum)]} / ${[...new Set(ghostKeys)]} · quantize ızgarası ${[...new Set(snap)].join(', ')} · Ctrl+Z`;
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

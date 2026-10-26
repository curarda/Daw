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
let curStep = '';
page.on('pageerror', (e) => errors.push(e.message + ' [adım: ' + curStep.slice(0, 50) + ']' + (process.env.SHOW_STACK ? '\n' + e.stack : '')));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|salamander|net::ERR/i.test(m.text())) errors.push(m.text() + ' [adım: ' + curStep.slice(0, 50) + ']'); });
if (toneLocal) await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
await page.route(/\/salamander\//, (r) => r.abort()); // iki kaynak da (github.io, jsDelivr)

const log = [];
async function step(name, fn, tries = 1) { // tries > 1: gerçek ses saatine bağlı (zamanlama) adımlar yük altında bir kez daha denenir
  const t = Date.now(); curStep = name;
  if (typeof box !== 'undefined') Object.assign(box, await page.locator('#tl').boundingBox());
  let info;
  for (let k = 1; ; k++) { try { info = await fn(); break; } catch (e) { if (k >= tries) throw e; console.log(`(zamanlama adımı yeniden deneniyor: ${name.slice(0, 40)}…)`); } }
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
    assert.deepEqual(st.map(([k]) => k), ['s1', 's2', 's3', 's3b', 's4', 's5', 's67', 's8', 's8b', 's8c', 's8d', 's8e', 's9']);
    assert.equal(await page.isVisible('#bassPanel'), false, 'kapalı bölümün içeriği görünmez');
    assert.equal((await page.textContent('#chipS1')).trim(), '4/4 · 120 BPM');
    assert.equal((await page.textContent('#chipS8b')).trim(), 'kapalı'); assert.equal((await page.textContent('#chipS8c')).trim(), 'kapalı');
    await page.click('details[data-key=s8d] > summary');
    assert.equal(await page.isVisible('#bassPanel'), true);
    assert.equal(await page.locator('details[data-key=s8e] .strip').count(), 5, 'mikser ayrı bölümde: vokal, akor, davul, gitar, bas');
    assert.ok(await page.locator('details[data-key=s8] #inPianoStyle').count(), 'akor sesi kendi bölümünde');
    await page.reload(); await waitStatus(/Hazır/);
    assert.equal(await page.isVisible('#bassPanel'), true, 'açık bölüm yenilemede açık kalır');
    await page.click('#btnCloseAll');
    assert.deepEqual((await open()).filter(([, o]) => o).map(([k]) => k), ['s1', 's2']);
    return 'ilk açılış: 1, 2 açık · rozetler · mikser / akor sesi / davul / gitar / bas ayrı · durum hatırlanır';
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

  var box = await page.locator('#tl').boundingBox(); // her adımın başında yeniden ölçülür (sayfa kayması)
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
    assert.ok(added >= 0, 'eklenen nota La2 (45), 2. vuruş ');
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
  }, 3);

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
    await S(() => { const z = document.querySelector('#inZoom'); if (+z.value !== 44) { z.value = 44; z.dispatchEvent(new Event('input')); } document.querySelector('#tlScroll').scrollLeft = 0; window.__daw.sel = null; }); // bas adımları yakınlaştırmayı değiştirir
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

  await step('Bas (8d): üret, çalarken bas sesi, MIDI "Bas" izi; ⟳ Başka (davul / akor sesi) seçeneği değiştirip hemen çalar', async () => {
    await resetTest();
    assert.equal(await S(() => window.__daw.proj.bass.enabled), false);
    await page.check('#bassPanel [data-bs=on]');
    await page.click('#bassPanel [data-bk=generate]');
    const ev = await S(() => window.__dawAPI.arrangement().bass);
    assert.ok(ev.length > 20 && ev.every((e) => e.midi >= 24 && e.midi <= 60), 'bas notaları üretildi: ' + ev.length);
    await page.click('#btnPlay');
    await page.waitForFunction(() => !!window.__dawAPI.player().bassVoices, null, { timeout: 20000 });
    await page.click('#btnPlay');
    // ⟳ davul: sıradaki loop, davul açılır
    const l0 = await S(() => window.__daw.proj.drums.loop);
    await page.click('#btnDrumNext');
    const l1 = await S(() => ({ loop: window.__daw.proj.drums.loop, on: window.__daw.proj.drums.on }));
    assert.notEqual(l1.loop, l0); assert.equal(l1.on, true); assert.match(await page.textContent('#status'), /^Davul: /);
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 10000 });
    // ⟳ akor sesi: altı seçenek sırayla
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
    await page.uncheck('#bassPanel [data-bs=on]');
    return `bas ${ev.length} nota; ⟳ davul ${l0} → ${l1.loop}, akor sesi ${[...seen].join(' / ')} · MIDI "Bas" + davul izi`;
  });

  await step('Bölüm düzenlemesi: bölüme tıkla → davul / akor sesi genel ayardan farklı; geçişte fill; ⟳ bölüm için; döngü seçili bölümü çalar ve baştan sarar', async () => {
    const tl = await resetTest();
    await page.check('#inDrumsOn');
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
    // akor sesi: bu bölümde synth arpej
    await page.selectOption('#inspector select[data-kind=piano]', 'synth-arp');
    arr = await S(() => window.__dawAPI.arrangement());
    assert.ok(arr.piano.filter((e) => bar({ q: e.q0 }) <= sec1[1]).every((e) => e.inst === 'synth' && e.arp));
    assert.ok(arr.piano.filter((e) => bar({ q: e.q0 }) > sec1[1]).every((e) => e.inst === 'piano'));
    // ⟳ bu bölüm için
    await page.click('#inspector button[data-act=arrNext][data-kind=drums]');
    assert.match(await page.textContent('#status'), /^Davul \(bu bölüm\): /);
    // genel ayara dön
    for (const k of ['drums', 'piano']) await page.selectOption(`#inspector select[data-kind=${k}]`, '');
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
    await page.uncheck('#inDrumsOn');
    return `verse: davul yok → sade loop + ${fills.length} vuruşluk fill · akor sesi synth arpej · döngü ${seen.length} örnek, ${Math.min(...seen).toFixed(2)}…${Math.max(...seen).toFixed(2)} s`;
  });

  await step('Elle seçimler otomatiğin üstünde: Demo ölçü / BPM / loop / bölüm düzenlemesine dokunmaz; loop listesi puanlı ve görünür, ▶ seçmeden dinletir, Seç elle seçtirir', async () => {
    await resetTest();
    // ölçüyü ve tempoyu sen seç: melodi 4/4 ama proje 3/4, 100 BPM
    await page.selectOption('#inMeter', '3/4');
    await page.fill('#inBpm', '100'); await page.dispatchEvent('#inBpm', 'change');
    // elle: loop, bölüm düzenlemesi
    await page.selectOption('#inDrumLoop', 'waltz');
    await S(() => { const p = window.__daw.proj; p.sections[0].arr = { drums: 'off' }; window.__dawAPI.refresh(); });
    await pause();
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    const r = await S(() => { const p = window.__daw.proj; return { meter: p.settings.meter, bpm: p.settings.bpm, loop: p.drums.loop, arr0: p.sections[0].arr, arr1: p.sections[1].arr || null, drums: p.drums.on, bassOn: p.bass.enabled }; });
    assert.equal(r.meter, '3/4', 'Demo ölçüyü değiştirmedi'); assert.equal(r.bpm, 100);
    assert.equal(r.loop, 'waltz');
    assert.deepEqual(r.arr0, { drums: 'off' }, 'elle verilen bölüm düzenlemesi korundu');
    assert.equal(r.drums, true); assert.equal(r.bassOn, true);
    const st = await page.textContent('#status');
    assert.match(st, /ölçü\/tempo[^·]*3\/4, 100 BPM/); assert.match(st, /elle seçtiklerin korundu: davul loop'u/);
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
    const nDrum = await page.locator('#drumRank .rank-row').count(), nPool = await S(() => window.__dawAPI.C.loopsFor('4/4').length);
    assert.equal(nDrum, nPool, "4/4'te bütün davul loop'ları (numaralı kalıplar + temel loop'lar) puanlı listede"); assert.ok(nDrum >= 30, 'loop sayısı ' + nDrum);
    assert.ok(await page.isVisible('#drumRank .rank-row'), 'liste açık bölümde görünür');
    const names = await page.$$eval('#drumRank .rk-name', (e) => e.map((x) => x.textContent));
    assert.ok(names.some((x) => /İtmeli pop-rock/.test(x)) && names.some((x) => /Sade/.test(x)) && names.some((x) => /X \. t/.test(x)), 'yeni loop\'lar listede: ' + names.join(' | '));
    const scores = await page.$$eval('#drumRank .rk-score', (e) => e.map((x) => +x.textContent));
    assert.ok(scores.every((v, i) => i === 0 || scores[i - 1] >= v), "loop'lar puan sırasıyla");
    // ▶ seçmeden dinletir: ayarlar değişmez, bas / davul çalar
    const before = await S(() => JSON.stringify({ l: window.__daw.proj.drums.loop, o: window.__daw.proj.drums.on }));
    const h0 = await S(() => window.__dawAPI.player().drumHits || 0);
    await page.click('#drumRank button[data-pv=drums][data-id=four]');
    await page.waitForFunction((h) => (window.__dawAPI.player().drumHits || 0) > h + 4, h0, { timeout: 20000 });
    await page.waitForFunction(() => !window.__dawAPI.player().playing, null, { timeout: 15000 }); // 2 ölçü sonra kendiliğinden biter
    assert.equal(await S(() => JSON.stringify({ l: window.__daw.proj.drums.loop, o: window.__daw.proj.drums.on })), before, 'önizleme ayarı değiştirmez');
    // Seç → elle seçim: ✋ rozeti, puana bakılmadan geçerli
    await page.click('#drumRank button[data-pick=drums][data-id=boombap]');
    assert.equal(await S(() => window.__daw.proj.drums.loop), 'boombap'); assert.match(await page.textContent('#chipS8b'), /✋/);
    await S(() => window.__dawAPI.stop());
    await page.selectOption('#inDrumLoop', 'auto');
    return `Demo: 3/4, 100 BPM, waltz, bölüm düzenlemesi korundu · liste ${nDrum} loop puanlı · ▶ seçmeden çalar · Seç → ✋`;
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

  await step('MIDI aç: kendi .mid çıktını projeye çevirip devam et (melodi, bölümler, akorlar 📄, bas, davul); ses yok → synth melodi; düzenle, BPM değiştir, kaydet / aç, geri al', async () => {
    await resetTest();
    // Demo ile davul + bas aç, bölümlere ton ver; MIDI olarak dışa aktar
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    await S(() => window.__dawAPI.stop());
    const orig = await S(() => ({ notes: window.__daw.d.notes.map((n) => [n.effMidi, Math.round(n.q0 * 100) / 100, Math.round(n.q1 * 100) / 100]), chords: window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}`), secs: window.__daw.d.sections.map((s) => [s.name, s.startBar, s.endBar, s.tonic, s.mode]), loop: window.__daw.proj.drums.loop }));
    const mid = await download('#btnExpMidi');
    const midPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-proje.mid');
    writeFileSync(midPath, mid.data);
    try {
      // yeni proje → MIDI aç
      page.removeAllListeners('dialog'); page.once('dialog', (d) => d.accept());
      await page.click('#btnNew');
      assert.equal(await S(() => window.__daw.audio), null);
      await page.setInputFiles('#fileMidi', midPath);
      await page.waitForFunction(() => /MIDI açıldı/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
      const back = await S(() => ({ notes: window.__daw.d.notes.map((n) => [n.effMidi, Math.round(n.q0 * 100) / 100, Math.round(n.q1 * 100) / 100]), chords: window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}`), secs: window.__daw.d.sections.map((s) => [s.name, s.startBar, s.endBar, s.tonic, s.mode]), midi: !!window.__daw.midi, audio: window.__daw.audio, source: window.__daw.proj.audio.source, bass: window.__daw.proj.bass.enabled, drums: window.__daw.proj.drums.on, loop: window.__daw.proj.drums.loop, bpm: window.__daw.proj.settings.bpm, locks: window.__daw.proj.chordLocks.filter((l) => l.src === 'chart').length }));
      assert.deepEqual(back.notes, orig.notes, 'melodi aynı notalar, aynı yerler'); assert.deepEqual(back.secs, orig.secs, 'bölümler ve tonlar');
      assert.deepEqual(back.chords, orig.chords, 'akorlar aynı');
      assert.equal(back.midi, true); assert.equal(back.audio, null); assert.equal(back.source, 'midi'); assert.equal(back.bass, true); assert.equal(back.drums, true); assert.equal(back.bpm, 120); assert.ok(back.locks > 0);
      assert.match(await page.textContent('#chipS2'), /MIDI · 24 nota/);
      assert.match(await page.textContent('#audioInfo'), /MIDI: .*mid · 24 nota/);
      // melodi synth ile çalar (ses yok); nota tıklayınca synth çalar
      const h0 = await S(() => window.__dawAPI.player().synthHits || 0);
      await page.click('#btnPlay');
      await page.waitForFunction((h) => (window.__dawAPI.player().synthHits || 0) > h + 6, h0, { timeout: 20000 });
      await page.click('#btnPlay');
      // notayı sürükle (MIDI'de de çalışır): +2 yarım ses; geri al
      const tl = await page.locator('#tl').boundingBox();
      const b0 = await noteBox(0);
      const e0 = (await effs())[0];
      await page.mouse.move(tl.x + (b0.x0 + b0.x1) / 2, tl.y + b0.y); await page.mouse.down();
      await page.mouse.move(tl.x + (b0.x0 + b0.x1) / 2, tl.y + b0.y - 2 * b0.rowH, { steps: 8 }); await page.mouse.up();
      assert.equal((await effs())[0], e0 + 2);
      await pause();
      await page.keyboard.press('Control+z');
      await page.waitForFunction((v) => window.__daw.d.notes[0].effMidi === v, e0, { timeout: 5000 });
      // BPM 60: melodi müzikal yerinde kalır (çeyrek konumları aynı), saniyeler iki katı
      const qs0 = await q0s();
      await page.fill('#inBpm', '60'); await page.dispatchEvent('#inBpm', 'change');
      const after = await S(() => ({ q: window.__daw.d.notes.map((n) => Math.round(n.q0 * 100) / 100), sec: window.__daw.d.notes[3].tl0, spq: window.__daw.d.g.spq }));
      assert.deepEqual(after.q, qs0.map((v) => Math.round(v * 100) / 100), 'BPM değişince nota çeyrek konumları korunur'); assert.ok(Math.abs(after.sec - qs0[3] * 1) < 1e-6, 'saniye = çeyrek × 1 s (60 BPM)');
      await page.fill('#inBpm', '120'); await page.dispatchEvent('#inBpm', 'change');
      // proje JSON kaydet → yeni → aç: MIDI projesi (ses yok) geri gelir
      const pj = await download('#btnSave');
      const j = JSON.parse(pj.data.toString());
      assert.ok(j.midiData && j.midiData.notes.length === 24 && !j.audioData);
      const projPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-proje-midi.json');
      writeFileSync(projPath, pj.data);
      try {
        page.removeAllListeners('dialog'); page.once('dialog', (d) => d.accept());
        await page.click('#btnNew');
        await page.setInputFiles('#fileProject', projPath);
        await page.waitForFunction(() => window.__daw.midi && window.__daw.d && window.__daw.d.notes.length === 24, null, { timeout: 15000 });
        assert.deepEqual(await S(() => window.__daw.d.chords.map((c) => `${c.bar}${c.half != null ? '.' + c.half : ''}:${window.__dawAPI.C.chordName(c.chord)}`)), orig.chords);
      } finally { rmSync(projPath, { force: true }); }
      // mix WAV (synth melodi) ve MIDI çıktısı çalışır; vokal WAV'ı açıklayıcı hata verir
      const mix = await download('#btnExpMix');
      assert.equal(mix.data.slice(0, 4).toString(), 'RIFF');
      await page.click('#btnExpVocal');
      assert.match(await page.textContent('#status'), /MIDI projesinde vokal kaydı yok/);
      // bozuk dosya
      writeFileSync(midPath, Buffer.from([1, 2, 3, 4, 5]));
      await page.setInputFiles('#fileMidi', midPath);
      await page.waitForFunction(() => /MIDI açılamadı/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
      assert.ok(await S(() => !!window.__daw.midi), 'bozuk dosya mevcut projeyi bozmaz');
      return `MIDI geri geldi: ${back.notes.length} nota, ${back.secs.length} bölüm, ${back.chords.length} akor, bas, davul (${back.loop}); synth melodi çaldı; BPM 60'ta çeyrek konumları sabit; JSON kaydet / aç; mix WAV ${(mix.data.length / 1e6).toFixed(1)} MB`;
    } finally { rmSync(midPath, { force: true }); }
  });

  await step('✨ Demo yap: ölçü + ton + akor + davul + bas tek tuşla, çalar; verse sade / nakarat dolu; tek Ctrl+Z ile geri', async () => {
    await resetTest();
    const pre = await S(() => ({ drums: window.__daw.proj.drums.on, bass: window.__daw.proj.bass.enabled, secs: window.__daw.proj.sections.map((s) => s.tonic) }));
    assert.equal(pre.drums, false); assert.equal(pre.bass, false); assert.deepEqual(pre.secs, [null, null]);
    await pause();
    await page.click('#btnDemo');
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 20000 });
    const st = await page.textContent('#status');
    assert.match(st, /Demo hazır/); assert.match(st, /ton: Verse C# Frig, Nakarat B Dorian/); assert.match(st, /davul: /); assert.match(st, /bas: /);
    const r = await S(() => { const p = window.__daw.proj; return { drums: p.drums.on, bass: p.bass.enabled, loop: p.drums.loop, fills: p.drums.fills, secs: p.sections.map((s) => [s.tonic != null, s.arr || null]), ev: window.__dawAPI.arrangement() }; });
    assert.equal(r.drums, true); assert.equal(r.bass, true); assert.equal(r.fills, true);
    assert.ok(r.secs.every(([k]) => k), 'tonlar onaylandı');
    assert.ok(r.secs[0][1] && r.secs[0][1].drums === 'minimal', 'verse: sade davul'); assert.equal(r.secs[1][1], null, 'nakarat: genel ayar');
    assert.ok(r.ev.drums.length > 0 && r.ev.bass.length > 0 && r.ev.drums.some((e) => e.fill));
    await page.waitForFunction(() => window.__daw.pos > 0.4, null, { timeout: 15000 });
    await page.click('#btnPlay');
    // tek adımda geri
    assert.equal((await hist()).u, 1, 'demo tek geri alma adımı');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.__daw.proj.bass.enabled, null, { timeout: 5000 });
    const z = await S(() => { const p = window.__daw.proj; return { drums: p.drums.on, bass: p.bass.enabled, secs: p.sections.map((s) => [s.tonic, !!s.arr]) }; });
    assert.deepEqual(z, { drums: false, bass: false, secs: [[null, false], [null, false]] });
    return `davul ${r.loop}, ${r.ev.drums.length} vuruş (fill var), bas ${r.ev.bass.length} nota; Ctrl+Z ile hepsi geri`;
  });

  await step('Progresyonu bitirdim: bütün progresyon ağırlıklı şarkı + seçtiğin akorların komşu ilişkileri öğrenilir, motorun akorları değişmez, güncellenir, silinir', async () => {
    await resetTest();
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    await S(() => window.__dawAPI.stop());
    // elle bir akor seç (kilitle)
    await S(() => { const p = window.__daw.proj, d = window.__daw.d, c = d.chords[3]; p.chordLocks.push({ bar: c.bar, half: c.half ?? null, chord: { root: (c.chord.root + 7) % 12, q: '', bass: null } }); window.__dawAPI.refresh(); });
    const names = () => S(() => window.__daw.d.chords.map((c) => `${c.bar}:${window.__dawAPI.C.chordName(c.chord)}`).join(' '));
    const before = await names();
    assert.equal(await S(() => window.StyleUI.state.dataset.songs.length), 0);
    assert.equal(await page.isHidden('#btnForgetProg'), true);
    await page.click('#btnFinishProg');
    assert.match(await page.textContent('#status'), /Öğrenildi: .*senin seçtiğin → \d+ geçiş ve \d+ üçlü bağlam/);
    assert.equal(await names(), before, 'bitirince motorun akorları değişmez');
    const st = await S(() => { const s = window.StyleUI.state; return { songs: s.dataset.songs.length, w: s.dataset.songs[0].weight, secs: s.dataset.songs[0].sections.length, ev: s.feedback.events.filter((e) => e.kind === 'learn').length, tri: s.feedback.events.reduce((a, e) => a + (e.triples ? e.triples.length : 0), 0), sc: !!window.StyleUI.scorer() }; });
    assert.equal(st.songs, 1); assert.equal(st.w, 5); assert.equal(st.secs, 2); assert.ok(st.ev >= 1 && st.tri >= 1); assert.equal(st.sc, true, 'öğrenilen veriyle stil puanlayıcı açıldı');
    assert.match(await page.textContent('#finishInfo'), /Öğrenildi: \d+ akor \(5× ağırlık\)/);
    assert.match(await page.textContent('#btnFinishProg'), /güncelle/); assert.equal(await page.isVisible('#btnForgetProg'), true);
    // yeniden bitir: çoğalmaz
    await page.click('#btnFinishProg');
    assert.equal(await S(() => window.StyleUI.state.dataset.songs.length), 1); assert.match(await page.textContent('#status'), /Güncellendi/);
    // proje dosyasında öğrenme kimliği saklanır
    assert.match(await S(() => window.__daw.proj.learnId), /^learn-/);
    // sil
    await page.click('#btnForgetProg');
    assert.equal(await S(() => window.StyleUI.state.dataset.songs.length), 0);
    assert.equal(await S(() => window.StyleUI.state.feedback.events.filter((e) => e.kind === 'learn').length), 0);
    assert.equal(await page.isHidden('#btnForgetProg'), true);
    return `1 şarkı (5×), ${st.ev} öğrenme olayı, ${st.tri} üçlü bağlam; akorlar aynı kaldı; güncelle / sil`;
  });

  await step('👍 / 👎: davul loop\'u ve akor sesi tercihi öğrenilir (listede işaret, 👎 → en iyi sıradaki denenir, otomatik sıralama değişir); elle seçilen etkilenmez; sıfırlanır', async () => {
    await resetTest();
    await S(() => { localStorage.removeItem('miniDaw.prefs'); });
    await page.reload(); await waitStatus(/Hazır/);
    await page.evaluate(() => document.querySelectorAll('details.step, details.sub:not(#chartBox)').forEach((d) => { d.open = true; }));
    await resetTest();
    await page.check('#inDrumsOn');
    const rankIds = () => page.$$eval('#drumRank button[data-pick]', (b) => b.map((x) => x.dataset.id));
    const r0 = await rankIds(), cur0 = await S(() => window.__dawAPI.C.loopsFor('4/4').length && document.querySelector('#drumRank .rank-row.cur button[data-pick]').dataset.id);
    assert.equal(cur0, r0[0], 'otomatik: en iyi puanlı çalıyor');
    await page.click('#btnDrumLike');
    assert.match(await page.textContent('#status'), /👍 Davul: .*aynı aile/);
    assert.equal(await S(() => JSON.parse(localStorage.getItem('miniDaw.prefs')).drums['%ID%'.replace('%ID%', document.querySelector('#drumRank .rank-row.cur button[data-pick]').dataset.id)].l), 1);
    assert.match(await page.textContent('#drumRank .rank-row.cur .rk-name'), /👍1/);
    // 👎: en iyi sıradaki denenir, beğenilmeyen listede geriye düşer
    await page.click('#btnDrumDislike');
    assert.match(await page.textContent('#status'), /^Davul: /);
    const r1 = await rankIds(), cur1 = await S(() => window.__daw.proj.drums.loop);
    assert.notEqual(cur1, cur0); assert.equal(await S(() => window.__daw.proj.drums.on), true);
    assert.ok(r1.indexOf(cur0) >= 0);
    // 👎 aynı loop'a iki kez (+1 −1 −1): net −1 → otomatik sırada eskisinden aşağıda
    await page.selectOption('#inDrumLoop', cur0);
    await page.click('#btnDrumDislike'); await S(() => window.__dawAPI.stop());
    await page.selectOption('#inDrumLoop', 'auto');
    const r2 = await rankIds();
    assert.ok(r2.indexOf(cur0) > r0.indexOf(cur0), `net 👎'lı loop geriye düştü: ${r0.indexOf(cur0)} → ${r2.indexOf(cur0)}`);
    // akor sesi
    const ps0 = await S(() => window.__daw.proj.piano.style);
    await page.click('#btnStyleLike');
    await S(() => window.__dawAPI.stop());
    await page.click('#btnStyleDislike'); await S(() => window.__dawAPI.stop());
    const ps1 = await S(() => window.__daw.proj.piano.style);
    assert.notEqual(ps1, ps0, '👎 → sıradaki akor sesi');
    const pp = await S(() => JSON.parse(localStorage.getItem('miniDaw.prefs')).piano);
    assert.equal(pp[ps0].l, 1); assert.equal(pp[ps0].d, 1);
    // elle seçim her zaman geçerli
    await page.selectOption('#inDrumLoop', cur0);
    assert.equal(await S(() => window.__daw.proj.drums.loop), cur0, '👎\'lı olsa da elle seçilen çalar');
    await page.click('#btnPrefReset');
    assert.equal(await S(() => localStorage.getItem('miniDaw.prefs')), '{}');
    assert.deepEqual(await rankIds(), r0, 'sıfırlanınca ilk sıra döndü');
    await page.selectOption('#inDrumLoop', 'auto'); await S(() => window.__dawAPI.stop());
    return `en iyi ${cur0} → 👍 sonra 👎'lerle ${r0.indexOf(cur0) + 1}. → ${r2.indexOf(cur0) + 1}. sıra; akor sesi ${ps0} 👍👎 → ${ps1}; elle seçim korunur; sıfırlama`;
  });

  await step('Vokal temizliği + otomatik miks: açılınca işlenmiş vokal (−18 dBFS, tepe ≤ −1) çalar ve dışa aktarılır; 🎚 otomatik miks vokala göre dengeler; Demo ikisini de yapar, elle ayara dokunmaz', async () => {
    await resetTest();
    assert.equal(await S(() => window.__daw.proj.vocalFx.on), false);
    assert.match(await page.textContent('#vfxInfo'), /Kapalı/);
    const wavStats = async () => { const d = await download('#btnExpVocal'); const w = Core.decodeWav(d.data.buffer.slice(d.data.byteOffset, d.data.byteOffset + d.data.byteLength)); let pk = 1e-9; for (let i = 0; i < w.data.length; i++) pk = Math.max(pk, Math.abs(w.data[i])); return { rms: Core.gatedRmsDb(w.data, w.sr), peak: 20 * Math.log10(pk) }; };
    const off = await wavStats();
    // aç: çalınca işlenir
    await page.check('#inVfxOn');
    await page.fill('#inVfxReverb', '0'); await page.dispatchEvent('#inVfxReverb', 'input');
    assert.equal(await S(() => window.__daw.proj.vocalFx.touched), true);
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__dawAPI.player().playing && /ses seviyesi/.test(document.querySelector('#vfxInfo').textContent), null, { timeout: 60000 });
    assert.match(await page.textContent('#vfxInfo'), /ses seviyesi -?\d+ → -18 dBFS · tepe -?[\d.]+ dBFS/);
    await page.click('#btnPlay');
    const on = await wavStats();
    assert.ok(Math.abs(on.rms - (-18)) < 1.5, `dışa aktarılan vokal ${on.rms.toFixed(1)} dBFS`); assert.ok(on.peak <= -0.9, `tepe ${on.peak.toFixed(1)}`);
    assert.ok(Math.abs(off.rms - on.rms) > 0.3 || Math.abs(off.peak - on.peak) > 0.3, `kapalı ${off.rms.toFixed(1)} / açık ${on.rms.toFixed(1)}`);
    // otomatik miks
    await S(() => { const p = window.__daw.proj; p.drums.on = true; p.guitar.instrument = 'both'; window.__dawAPI.refresh(); });
    await page.check('#bassPanel [data-bs=on]'); await page.click('#bassPanel [data-bk=generate]');
    await page.click('#btnAutoMix');
    await page.waitForFunction(() => /Vokal referans/.test(document.querySelector('#mixInfo').textContent), null, { timeout: 120000 });
    const mx = await S(() => { const m = window.__daw.proj.mixer; return { v: m.vocal.vol, p: m.piano.vol, g: m.guitar.vol, b: m.bass.vol, d: m.drums.vol, touched: !!m.touched }; });
    assert.equal(mx.v, 0); assert.equal(mx.touched, false, 'otomatik miks "elle dokundum" sayılmaz');
    for (const k of ['p', 'g', 'b', 'd']) assert.ok(mx[k] >= -40 && mx[k] <= 6, `${k} ${mx[k]}`);
    assert.match(await page.textContent('#status'), /Seviyeler ayarlandı/);
    assert.equal(await page.inputValue('.strip[data-track=bass] .vol'), String(mx.b), 'fader\'lar güncellendi');
    // fader'a dokununca Demo mikseri bozmaz
    await page.fill('.strip[data-track=drums] .vol', '-3'); await page.dispatchEvent('.strip[data-track=drums] .vol', 'input');
    assert.equal(await S(() => window.__daw.proj.mixer.touched), true);
    await resetTest();
    await page.click('#btnDemo');
    await page.waitForFunction(() => window.__dawAPI.player().playing, null, { timeout: 90000 });
    assert.equal(await S(() => window.__daw.proj.vocalFx.on), true, 'Demo vokal temizliğini açtı');
    assert.match(await page.textContent('#status'), /vokal temizliği açık/);
    await S(() => window.__dawAPI.stop());
    // Demo, elle ayarlanmış vokal temizliğine dokunmaz
    await resetTest();
    await page.check('#inVfxOn'); await page.uncheck('#inVfxOn');
    await page.click('#btnDemo');
    await page.waitForFunction(() => /Demo hazır/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
    assert.equal(await S(() => window.__daw.proj.vocalFx.on), false, 'elle kapatılan temizlik Demo ile açılmaz');
    await S(() => window.__dawAPI.stop());
    return `vokal ${off.rms.toFixed(1)} → ${on.rms.toFixed(1)} dBFS, tepe ${on.peak.toFixed(1)} · miks: akor ${mx.p}, gitar ${mx.g}, bas ${mx.b}, davul ${mx.d} dB · Demo açar, elle ayara dokunmaz`;
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
    // katmanlar: davul 'shuffle hücresi', akor sesi 'piyano shuffle', üretilmiş bas ve gitar; hepsinin "let" yeri aynı (%70)
    await S(() => { const p = window.__daw.proj; p.drums.on = true; p.drums.loop = 'shufflecell'; p.piano.style = 'piano-shuffle'; p.piano.repeat = 'off'; p.guitar.instrument = 'both'; window.__dawAPI.refresh(); });
    await page.check('#bassPanel [data-bs=on]'); await page.click('#bassPanel [data-bk=generate]');
    const fr = (q) => Math.round((q - Math.floor(q + 1e-9)) * 1000) / 1000;
    const arr = await S(() => window.__dawAPI.arrangement());
    const ghostDrum = arr.drums.filter((e) => e.kind === 'H' && e.vel < 0.5).map((e) => fr(e.q)), ghostKeys = arr.piano.filter((e) => e.vel < 40).map((e) => fr(e.q0));
    for (const [n, a] of [['davul', ghostDrum], ['akor', ghostKeys]]) { assert.ok(a.length > 8, n + ' ghost sayısı'); assert.deepEqual([...new Set(a)], [0.7], `${n}: ghost vuruşun %70'inde`); }
    const bq = arr.bass.map((e) => fr(e.q));
    assert.ok(bq.length > 20 && bq.some((v) => v === 0.7) && bq.every((v) => v === 0 || v > 0.3), 'bas: ve vuruşları %70\'e oturdu');
    const gt = await S(() => { const d = window.__daw.d, C = window.__dawAPI.C, p = window.__daw.proj, g = d.g; return C.guitarEvents(C.guitarSlotsFrom(d), g, (sl) => C.guitarPartFor(p.guitar, sl.section)).map((e) => e.t / g.spq); });
    assert.ok(gt.length > 20 && gt.some((v) => Math.abs(fr(v) - 0.7) < 0.01), 'gitar: ve vuruşları %70\'e oturdu');
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
    return `oran %70: davul / akor ghost'ları ${[...new Set(ghostDrum)]} / ${[...new Set(ghostKeys)]} · bas ve gitar ve vuruşları %70'te · quantize ızgarası ${[...new Set(snap)].join(', ')} · Ctrl+Z`;
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

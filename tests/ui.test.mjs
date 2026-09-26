// Tarayıcı testi (Playwright + Chromium): test melodisiyle arayüz akışının tamamı.
// Kullanım: TONE_JS=/yol/Tone.js node tests/ui.test.mjs
//  - Tone.js CDN isteği yerel kopyaya yönlendirilir (TONE_JS verilmezse CDN'e gider).
//  - Kayıt, Chromium'un sahte mikrofonu ile test edilir.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const toneLocal = process.env.TONE_JS;
const shotDir = process.env.SHOT_DIR;

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
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

let projFile;
try {
  await page.goto(indexUrl);
  await step('sayfa yüklendi', async () => { await waitStatus(/Hazır/); });

  await step('test melodisi → pitch detection', async () => {
    await page.click('#btnTest');
    await waitStatus(/Test melodisi hazır/);
    const n = await S(() => window.__daw.d.notes.length);
    assert.equal(n, 24);
    return `${n} nota`;
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

  await step('6) akorlar: verse C#m / Dmaj7, nakarat sonu Bm', async () => {
    const ch = await S(() => window.__daw.d.chords.map((c) => window.Core.chordName(c.chord, c.flats)));
    assert.ok(ch.includes('C#m') && (ch.includes('Dmaj7') || ch.includes('D')));
    assert.equal(ch[ch.length - 1], 'Bm');
    return ch.join(' · ');
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
    await page.check('input[name=editMode][value=label]');
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
    await page.check('input[name=editMode][value=sound]');
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
    assert.equal(r.t, 62); assert.equal(r.src, 'manual'); assert.ok(r.locked); assert.equal(r.eff, 62);
    // Shift ile cent hassasiyeti
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    const t2 = await S(() => window.__daw.d.notes[0].corr.target);
    assert.equal(t2, 62.05);
    await page.click('#btnClearManual');
    await page.check('input[name=editMode][value=select]');
    return `C#4 → D4 (+${Math.round(r.ap)}c), Shift+↑ → +5c`;
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
  if (projFile) { const { rmSync } = await import('node:fs'); rmSync(projFile, { force: true }); }
  await browser.close();
}

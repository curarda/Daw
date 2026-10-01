// Stil verisi ve öneri modülü — tarayıcı testi (Playwright + Chromium).
// Kullanım: TONE_JS=node_modules/tone/build/Tone.js node tests/style-ui.test.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { synthEvalItem, EVAL_SONGS } from './eval-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const toneLocal = process.env.TONE_JS;
const shotDir = process.env.SHOT_DIR;

// Sohbetin ürettiği biçim: label, type, source_notes, bars (dizi/null), degrees_preview {core, color, bass}
const P = (cores) => cores.map((c) => ({ core: c, color: null, bass: null }));
const TEST_JSON = {
  schema_version: 1, artist: 'Test Sanatçı', title: 'Frig–Dorian Testi',
  source_notes: { capo: 2, tuning: 'standart', other: null }, warnings: [],
  sections: [
    { label: 'Verse 1', type: 'verse', chords: ['C#m', 'D', 'C#m', 'D', 'C#m', 'D', 'C#m', 'D'], bars: [2, 1, 2, 1, 2, 1, 2, 1],
      key_proposals: [{ tonic: 'C#', mode: 'phrygian', confidence: 0.8, reason: 'C# merkez' }, { tonic: 'A', mode: 'major', confidence: 0.2, reason: 'D = IV' }],
      degrees_preview: P(['i', '♭II', 'i', '♭II', 'i', '♭II', 'i', '♭II']), warnings: ['D, A majörde IV de olabilir'] },
    // (b) bilerek yanlış: A, B Dorian'da ♭VII'dir
    { label: 'Chorus', type: 'chorus', chords: ['Bm', 'E', 'A', 'Bm'], bars: null, key_proposals: [{ tonic: 'B', mode: 'dorian', confidence: 0.7, reason: 'G#' }], degrees_preview: P(['i', 'IV', 'VII', 'i']) },
  ],
};
const POWER_JSON = { schema_version: 1, artist: 'Güç Grubu', title: 'Riff', sections: [
  { name: 'Riff', chords: ['E5', 'G5', 'A5', 'N.C.', 'E5', 'D', 'Cmaj7#9x', 'Em'], key_proposals: [{ tonic: 'E', mode: 'minor' }] }] };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|salamander|net::ERR/i.test(m.text())) errors.push(m.text()); });
if (toneLocal) await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
await page.route(/\/salamander\//, (r) => r.abort()); // iki kaynak da (github.io, jsDelivr)

const log = [];
async function step(name, fn) { const t = Date.now(); const info = await fn(); log.push(`✔ ${name} (${Date.now() - t} ms)${info ? ' — ' + info : ''}`); }
const E = (fn, arg) => page.evaluate(fn, arg);
const tab = (name) => page.click(`.st-tabs button:has-text("${name}")`);
async function importJson(obj) {
  await tab('İçe aktar');
  await page.fill('#stText', typeof obj === 'string' ? obj : JSON.stringify(obj));
  await page.click('button[data-act=doImport]');
}
async function download(sel) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
}
const tmp = [];

try {
  await page.goto(indexUrl);
  await page.waitForFunction(() => window.StyleUI && /Hazır/.test(document.querySelector('#status').textContent));

  await step('görünüm: Stil verisi ve öneri', async () => {
    await page.click('.views input[value=style] + span');
    assert.equal(await page.isVisible('#styleView'), true);
    assert.equal(await page.isVisible('#dawView'), false);
  });

  await step('1) şema hatası alan yoluyla gösterilir, sessizce atılmaz', async () => {
    await importJson({ schema_version: 1, artist: 'X', sections: [{ name: 'A', chords: [] }] });
    const txt = await page.textContent('.st-err');
    assert.match(txt, /title: boş olmayan metin olmalı/);
    assert.match(txt, /sections\[0\]\.chords: boş olmayan dizi olmalı/);
    assert.equal(await E(() => window.StyleUI.state.dataset.songs.length), 0);
    return txt.replace(/\s+/g, ' ').trim();
  });

  await step('a/b) içe aktar → onay ekranı: ilk öneri ön-seçili ama onaysız; yanlış derece kırmızı', async () => {
    await importJson(TEST_JSON);
    await page.waitForSelector('.st-sec');
    const secs = page.locator('.st-sec');
    assert.match(await secs.nth(0).textContent(), /onaysız/);
    assert.equal(await secs.nth(0).locator('input[type=radio]').first().isChecked(), true);
    assert.match(await page.textContent('.st-song'), /D, A majörde IV de olabilir/);
    const bad = secs.nth(1).locator('.chip.bad');
    assert.equal(await bad.count(), 1);
    assert.match(await bad.textContent(), /A.*♭VII.*önizleme: VII.*core/s);
    assert.match(await page.textContent('.st-song'), /capo 2 · akort: standart/);
    assert.match(await secs.nth(1).textContent(), /chorus/);
    assert.equal(await secs.nth(0).locator('.chip.bad').count(), 0);
    // farklı mod seçilince önizleme geçersiz → kırmızı yok
    await secs.nth(1).locator('select[data-act=secMode]').selectOption('minor');
    assert.equal(await page.locator('.st-sec').nth(1).locator('.chip.bad').count(), 0);
    assert.match(await page.locator('.st-sec').nth(1).textContent(), /önizleme geçersiz/);
    await page.locator('.st-sec').nth(1).locator('select[data-act=secMode]').selectOption('dorian');
    assert.equal(await page.locator('.st-sec').nth(1).locator('.chip.bad').count(), 1);
    // onaysızken istatistik boş
    assert.equal(await E(() => window.StyleUI.model().stats.byMode.get('*').songs.size), 0);
    await page.locator('.st-sec').nth(0).locator('button[data-act=confirmSec]').click();
    await page.locator('.st-sec').nth(1).locator('button[data-act=confirmSec]').click();
    assert.equal(await page.locator('.st-sec.ok').count(), 2);
    return 'Chorus #3 A: hesaplanan ♭VII ≠ önizleme VII (kırmızı); B minör seçilince uyarı yok';
  });

  await step('4–6) istatistik: dereceler, geçiş ısı haritası, hücre → şarkılar, kapanış, modal kayma', async () => {
    await tab('İstatistik');
    await page.click('.st-modes button[data-m=phrygian]');
    const body = await page.textContent('.st-body');
    assert.match(body, /az veri/);
    const cells = page.locator('table.heat td.clk');
    assert.equal(await cells.count(), 2);
    const titles = await cells.evaluateAll((els) => els.map((e) => e.title));
    assert.ok(titles.some((t) => /^i → ♭II: 1 şarkı \(%100\), 4 tekrar/.test(t)), titles.join(' | '));
    assert.ok(titles.some((t) => /^♭II → i: 1 şarkı \(%100\), 3 tekrar/.test(t)));
    await cells.first().click();
    assert.match(await page.textContent('#stDrill'), /Test Sanatçı – Frig–Dorian Testi.*Verse 1/s);
    // harmonik ritim: verse'te bars var (C#m 2, D 1), chorus'ta yok
    const hr = await page.locator('h3:has-text("Harmonik ritim")').textContent();
    assert.match(hr, /süre bilgisi olan 1 \/ 1 şarkı/);
    const durRows = await page.locator('h4:has-text("Akor süresi dağılımı") ~ table tbody tr').allTextContents();
    assert.match(durRows[1], /^1\s*1\s*100%\s*4/); assert.match(durRows[2], /^2\s*1\s*100%\s*4/);
    const rateRows = await page.locator('h4:has-text("kaç ölçüde bir") ~ table tbody tr').allTextContents();
    assert.match(rateRows[2], /^2\s*1\s*100%/); // 12 ölçü / 8 akor = 1.5 → 2 sınıfı
    await page.click('.st-modes button[data-m=dorian]');
    const dor = await page.textContent('.st-body');
    assert.match(dor, /♭VII/); assert.match(dor, /IV/);
    assert.match(dor, /süre bilgisi olan 0 \/ 1 şarkı/);
    assert.match(dor, /süre istatistiğine girmez/);
    const shift = await page.locator('h3:has-text("modal kayma") + table').textContent();
    assert.match(shift, /Frig → Dorian.*-2 yarım ses.*1/s);
    const inter = await page.locator('h3:has-text("modal kayma") + table + table').textContent();
    assert.match(inter, /♭II.*Frig.*→ i.*Dorian/s);
    assert.match(inter, /verse: C# Frig D → chorus: B Dorian Bm/);
    // bölüm tipi filtresi: Frig modunda yalnızca "Verse" tipi var; seçilince yalnız o tipin kovası
    await page.click('.st-modes button[data-m=phrygian]');
    const typeBtns = await page.locator('.st-types button').allTextContents();
    assert.deepEqual(typeBtns.map((t) => t.trim()), ['Hepsi', 'Verse 1']);
    await page.click('.st-types button[data-t=verse]');
    assert.match(await page.textContent('.st-body'), /bu kapsamda \(Verse\) 1 şarkı/);
    assert.equal(await page.locator('table.heat td.clk').count(), 2);
    await page.click('.st-types button[data-t=""]');
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'style-stats.png'), fullPage: false });
    return titles.join(' · ') + ' · tip filtresi: ' + typeBtns.join(' / ');
  });

  await step('d) aynı sanatçı + şarkı → uyarı (üzerine yaz / vazgeç)', async () => {
    const again = JSON.parse(JSON.stringify(TEST_JSON));
    again.title = 'FRİG–DORİAN TESTİ';
    await importJson(again);
    const w = await page.textContent('#styleView .st-warn');
    assert.match(w, /zaten veri setinde/);
    await page.click('button[data-act=dupCancel]');
    assert.equal(await E(() => window.StyleUI.state.dataset.songs.length), 1);
    return w.replace(/\s+/g, ' ').trim();
  });

  await step('1/c) tanınmayan akor listelenir, düzeltilir; power chord ve N.C.', async () => {
    await importJson(POWER_JSON);
    await page.waitForSelector('.st-err');
    assert.match(await page.textContent('.st-err'), /Cmaj7#9x/);
    assert.equal(await page.locator('.st-sec button[data-act=confirmSec]').isDisabled(), true);
    await page.fill('input[data-fix="Cmaj7#9x"]', 'Cmaj7');
    await page.click('button[data-act=applyFixes]');
    await page.locator('.st-sec button[data-act=confirmSec]').click();
    const q = await E(() => { const b = window.StyleUI.model().stats.byMode.get('minor'); return { p: b.qual.get('5').occ, M: b.qual.get('M').occ, tr: [...b.trans.keys()] }; });
    assert.equal(q.p, 4); assert.equal(q.M, 2);
    assert.ok(!q.tr.some((k) => k.startsWith('5x>')), 'N.C. üzerinden geçiş');
    assert.ok(q.tr.includes('0x>3x'), 'power chord: belirsiz nitelik (x)');
    return `power ${q.p} (belirsiz), majör ${q.M} · geçişler ${q.tr.join(', ')}`;
  });

  await step('e) progresyon önerici: az veri uyarısı + öneriler, çal, beğen/beğenme', async () => {
    await tab('Progresyon önerici');
    await page.click('button[data-act=runProg]');
    assert.match(await page.textContent('.st-body'), /Az veri/);
    const n = await page.locator('.st-prog').count();
    assert.equal(n, 5);
    const first = await page.locator('.st-prog .syms').first().textContent();
    const degs = await page.locator('.st-prog .degs').first().textContent();
    assert.match(degs, /^i \([\d.]+\) → .+ → .+$/, degs);
    const sums = await E(() => window.StyleUI.state.prog.items.map((i) => i.durations.reduce((a, b) => a + b, 0)));
    assert.deepEqual(sums, [8, 8, 8, 8, 8]);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'style-prog.png') });
    assert.match(await page.locator('.st-prog').first().textContent(), /Sürpriz noktası/);
    await page.locator('.st-prog').first().locator('button[data-act=playProg]').click();
    await page.waitForFunction(() => /Önizleme:/.test(document.querySelector('#status').textContent), null, { timeout: 20000 });
    await page.locator('.st-prog').first().locator('button[data-act=stopProg]').click();
    await page.locator('.st-prog').first().locator('button[data-act=fbProg][data-v="-1"]').click();
    await page.click('button[data-act=runProg]');
    const after = await page.locator('.st-prog .syms').allTextContents();
    assert.ok(!after.includes(first), 'beğenilmeyen tekrar önerildi');
    // bölüm tipi girdisi: DAW'daki "Nakarat" bölümünden → tip nakarat; sonuç satırında tip ve şarkı sayısı
    await page.selectOption('select[data-k=type]', 'chorus');
    await page.click('button[data-act=runProg]');
    assert.match(await page.textContent('.st-body'), /Nakarat \(0 şarkı\)/);
    assert.match(await page.textContent('.st-body'), /Tip verisi az/);
    await page.selectOption('select[data-k=type]', '');
    // bölümler arası geçiş
    await page.click('button[data-act=runTrans]');
    const tr = await page.locator('h3:has-text("İki bölüm arası") ~ ul').textContent();
    assert.match(tr, /D.*♭II.*→.*Bm.*i/s);
    return `${n} öneri, ilk: ${degs} ("${first.replace('↻', '').trim()}") beğenilmedi → listeden çıktı · geçiş: ${tr.replace(/\s+/g, ' ').trim().slice(0, 60)}`;
  });

  await step('10) değişim sayısı 1 → ev akorunda drone önerisi', async () => {
    await page.fill('input[data-act=prog][data-k=changes]', '1'); await page.dispatchEvent('input[data-act=prog][data-k=changes]', 'change');
    await page.click('button[data-act=runProg]');
    assert.equal(await page.locator('.st-prog').count(), 1);
    const t = (await page.locator('.st-prog .degs').textContent()).trim();
    assert.equal(t, 'i (8)');
    assert.match(await page.locator('.st-prog').textContent(), /değişim yok \(tek akor \/ drone\)/);
    await page.fill('input[data-act=prog][data-k=changes]', '3'); await page.dispatchEvent('input[data-act=prog][data-k=changes]', 'change');
    return `${(await E(() => window.StyleUI.state.prog.items[0].displaySymbols))} = ${t}`;
  });

  await step('9) akor bulucu: aday puanı melodi + stil payı; geri bildirim; λ=0 saf teori', async () => {
    await page.click('.views input[value=daw] + span');
    await page.click('#btnTest');
    await page.waitForFunction(() => /Test melodisi hazır/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    await E(() => { const S = window.__daw; S.proj.sections[0].tonic = 1; S.proj.sections[0].mode = 'phrygian'; S.proj.sections[1].tonic = 11; S.proj.sections[1].mode = 'dorian'; window.__dawAPI.refresh(); });
    assert.equal(await E(() => window.__daw.d.styleActive), true);
    await E(() => { const s = window.__daw.d.chords.find((c) => c.bar === 2); window.__daw.sel = { type: 'chord', q: (s.q0 + s.q1) / 2 }; window.__dawAPI.refresh(); });
    const head = await page.textContent('#inspector thead');
    assert.match(head, /melodi payı \+ stil payı/);
    const row = await page.locator('#inspector tbody tr').first().textContent();
    assert.match(row, /melodi.*stil/s);
    // varsayılan motor süreli Viterbi: ritim segment süresinden girer
    assert.match(await page.textContent('#inspector'), /Değiş mi kal mı\s*süreli model: bu akor [\d.]+ ölçü sürüyor — harmonik ritim payı [+-][\d.]+/);
    assert.equal(await page.locator('#altBox input[type=radio]').count(), 6); // 2 bölüm × 3 alternatif
    await page.click('#inspector button[data-act=fbChord][data-v="1"]');
    assert.match(await page.textContent('#status'), /Beğenildi: i → ♭II/);
    // λ = 0: "hangi akor" payı sıfır, ritim (λ_ritim) hâlâ etkin; ikisi de 0 → saf teori
    await page.locator('#inLambda').fill('0');
    assert.equal(await E(() => window.__daw.d.styleActive), true);
    assert.ok(await E(() => window.__daw.d.chords.every((c) => c.candidates.every((x) => x.style === 0))));
    await page.locator('#inLambdaR').fill('0');
    assert.equal(await E(() => window.__daw.d.styleActive), false);
    assert.doesNotMatch(await page.textContent('#inspector thead'), /stil payı/);
    await page.locator('#inLambda').fill('1'); await page.locator('#inLambdaR').fill('1');
    return row.replace(/\s+/g, ' ').trim().slice(0, 90);
  });

  await step('10) progresyonu zaman çizelgesine akor şablonu olarak yerleştir', async () => {
    await page.click('.views input[value=style] + span');
    await tab('Progresyon önerici');
    await page.fill('input[data-act=prog][data-k=bars]', '4'); await page.dispatchEvent('input[data-act=prog][data-k=bars]', 'change');
    await page.click('button[data-act=runProg]');
    // süreleri elle değiştir: 1.5 + 0.5 + 2
    for (const [j, v] of [[0, '1.5'], [1, '0.5'], [2, '2']]) {
      const inp = page.locator(`.st-prog input[data-act=progDur][data-i="0"][data-j="${j}"]`);
      await inp.fill(v); await inp.dispatchEvent('change');
    }
    const it = await E(() => window.StyleUI.state.prog.items[0]);
    assert.deepEqual(it.durations, [1.5, 0.5, 2]);
    assert.match(await page.locator('.st-prog .degs').first().textContent(), /\(1\.5\) → .+ \(0\.5\) → .+ \(2\)/);
    assert.match(await page.locator('.st-prog').first().textContent(), /toplam 4 ölçü \(süreler elle değiştirildi\)/);
    await page.fill('#stPlace0', '1');
    await page.locator('.st-prog').first().locator('button[data-act=placeProg]').click();
    const placed = await E(() => window.__daw.d.chords.filter((c) => c.bar <= 4).map((c) => [c.bar, c.half, window.Core.chordName(c.chord), c.locked]));
    const [a, b, c] = it.symbols;
    assert.deepEqual(placed, [[1, null, a, true], [2, 0, a, true], [2, 1, b, true], [3, null, c, true], [4, null, c, true]]);
    return `${it.displaySymbols} → ölçü 1: ${a} | ölçü 2: ${a} ${b} (yarım) | ölçü 3–4: ${c}`;
  });

  await step('4) doğrulama: DAW kaydını gerçek akorlarıyla ekle, değerlendir, sentetik seti içe aktar, referans kaydet', async () => {
    await page.click('.views input[value=style] + span');
    await tab('Doğrulama');
    await page.fill('#evArtist', 'Test Sanatçı'); await page.fill('#evTitle', 'Frig–Dorian Testi');
    const truths = page.locator('input[id^=evTruth-]');
    assert.equal(await truths.count(), 2);
    await truths.nth(0).fill('| C#m | D | C#m |'); // bilerek eksik
    await truths.nth(1).fill('| Bm | E | F#m | Bm |');
    await page.click('button[data-act=evalAdd]');
    assert.match(await page.textContent('#styleView .st-err'), /3 ölçü girildi, bölüm 4 ölçü/);
    await page.locator('input[id^=evTruth-]').nth(0).fill('| C#m | D | C#m | D C#m |');
    await page.click('button[data-act=evalAdd]');
    assert.equal(await E(() => window.StyleUI.state.evalSet.items.length), 1);
    await page.click('button[data-act=evalRun]');
    await page.waitForFunction(() => /Sonuç — motor/.test(document.querySelector('#styleView').textContent), null, { timeout: 30000 });
    const body = await page.textContent('#styleView');
    assert.match(body, /en az 2 doğrulama şarkısı/);
    const one = await E(() => window.StyleUI.state.evalRes.fixed.metrics);
    assert.equal(one.units, 16);
    // sentetik doğrulama seti (+ bu kayıt) içe aktar → şarkı bazlı dışarıda bırakmayla ayar
    const { Core } = loadCore();
    const set = { schema: 'mini-daw-eval-set', version: 1, reference: null, items: [...(await E(() => window.StyleUI.state.evalSet.items)), ...EVAL_SONGS.map((x) => synthEvalItem(Core, x))] };
    const fp = path.join(here, '..', '.tmp-eval.json'); writeFileSync(fp, JSON.stringify(set)); tmp.push(fp);
    await page.setInputFiles('input[data-act=evalImp]', fp);
    await page.waitForFunction(() => window.StyleUI.state.evalSet.items.length === 7);
    await page.click('button[data-act=evalRun]');
    await page.waitForFunction(() => { const r = window.StyleUI.state.evalRes; return r && r.tuned && !window.StyleUI.state.evalBusy; }, null, { timeout: 60000 });
    const r = await E(() => window.StyleUI.state.evalRes);
    assert.equal(r.tuned.folds.length, 7);
    assert.ok(r.tuned.folds.every((f) => !f.trainedOn.includes(f.heldOut)));
    await page.click('button[data-act=evalRef]');
    assert.ok(await E(() => !!window.StyleUI.state.evalSet.reference));
    const pc = (x) => Math.round(x * 100) + '%';
    return `test melodisi tek başına core ${pc(one.core)} · 7 şarkı, sabit ayar core ${pc(r.fixed.metrics.core)}, ayarlı (dışarıda bırakılanda) core ${pc(r.tuned.metrics.core)}, ilk 3 ${pc(r.tuned.metrics.top3)}, değişim F1 ${pc(r.tuned.metrics.change)} · referans kaydedildi`;
  });

  await step('7) k ve α öner (20 şarkıdan az → "güvenilir değil" uyarısı) + 11) üç ayrı JSON dışa/içe aktarım', async () => {
    await tab('Model ve geri bildirim');
    await page.click('button[data-act=suggestKA]');
    await page.waitForFunction(() => /Önerilen:/.test(document.querySelector('#styleView').textContent));
    assert.match(await page.textContent('.st-body'), /Sonuç güvenilir değil: yalnızca 2 onaylı şarkı var/);
    await tab('Saklama');
    const ds = await download('button[data-act=exp][data-k=dataset]');
    const st = await download('button[data-act=exp][data-k=settings]');
    const fb = await download('button[data-act=exp][data-k=feedback]');
    const dso = JSON.parse(ds.data), fbo = JSON.parse(fb.data);
    assert.equal(dso.schema, 'mini-daw-style-dataset'); assert.equal(dso.songs.length, 2);
    assert.equal(JSON.parse(st.data).schema, 'mini-daw-style-settings');
    assert.equal(fbo.events.length, 2); assert.equal(fbo.banned.length, 1);
    // içe aktarım: geri bildirim dosyasını sıfırladıktan sonra geri yükle
    const fbPath = path.join(here, '..', '.tmp-fb.json'); writeFileSync(fbPath, fb.data); tmp.push(fbPath);
    await tab('Model ve geri bildirim');
    page.once('dialog', (d) => d.accept());
    await page.click('button[data-act=fbReset]');
    assert.equal(await E(() => window.StyleUI.state.feedback.events.length), 0);
    await tab('Saklama');
    await page.setInputFiles('input[data-act=imp][data-k=feedback]', fbPath);
    await page.waitForFunction(() => window.StyleUI.state.feedback.events.length === 2);
    return `${ds.name} (${dso.songs.length} şarkı), ${st.name}, ${fb.name} (${fbo.events.length} geri bildirim, ${fbo.banned.length} yasak)`;
  });

  await step('11) şarkı sil / düzenle → istatistik anında güncellenir; yeniden yüklemede kalıcı', async () => {
    await tab('Şarkılar ve onay');
    await page.click('a[data-act=editSong]:has-text("Güç Grubu")');
    await page.locator('.st-sec button[data-act=editChords]').click();
    await page.fill('#stChordEdit', 'E5 G5 A5 N.C. E5 D C Em Am');
    await page.click('button[data-act=saveChords]');
    assert.ok(await E(() => window.StyleUI.model().stats.byMode.get('minor').degrees.has('5m')));
    page.once('dialog', (d) => d.accept());
    await page.click('button[data-act=delSong]');
    assert.equal(await E(() => { const b = window.StyleUI.model().stats.byMode.get('minor'); return b ? b.songs.size : 0; }), 0);
    await page.reload();
    await page.waitForFunction(() => window.StyleUI);
    const r = await E(() => ({ n: window.StyleUI.state.dataset.songs.length, fb: window.StyleUI.state.feedback.events.length, conf: window.StyleUI.model().stats.byMode.get('*').songs.size }));
    assert.deepEqual(r, { n: 1, fb: 2, conf: 1 });
    return 'Am eklendi (iv), şarkı silindi; sayfa yenilenince 1 şarkı + 2 geri bildirim duruyor';
  });

  assert.deepEqual(errors, [], 'tarayıcı hataları');
  console.log(log.join('\n'));
  console.log('\nStil arayüz testi geçti.');
} catch (e) {
  console.log(log.join('\n'));
  console.error('✘', e.stack || e);
  console.error('Tarayıcı hataları:', errors);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'style-fail.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const f of tmp) rmSync(f, { force: true });
  await browser.close();
}

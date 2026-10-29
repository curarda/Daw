// Bölüm düzenleme arayüzü: silme (akorlar ve kilitler kalır), birleştir, böl, aralık ve zaman çizelgesinde sınır sürükleme.
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
  const open = async (p) => {
    await page.evaluate(() => window.__dawAPI.status('Bölüm testi: proje yükleniyor…'));
    await page.setInputFiles('#fileProject', { name: 'sections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => /Proje açıldı/.test(document.querySelector('#status').textContent));
    await page.locator('details[data-key="s4"]').evaluate((el) => { el.open = true; });
  };
  const fixture = (sections) => page.evaluate((sections) => {
    const { C } = window.__dawAPI, p = C.newProject();
    p.settings.bpm = 120;
    p.sections = sections.map(([id, name, a, b]) => ({ id, name, startBar: a, endBar: b, tonic: 8, mode: 'phrygian', link: null }));
    p.chordLocks = [{ bar: 4, half: null, chord: { root: 1, q: 'm' }, src: 'user' }]; // kilitli C#m
    p.midiData = { name: 'bolum', endQ: 32, notes: Array.from({ length: 8 }, (_, i) => ({ q0: i * 4, q1: i * 4 + 1, midi: 56 + (i % 3), vel: 80 })) };
    return p;
  }, sections);
  const card = (id) => page.locator(`#sectionList [data-sec="${id}"]`);
  const secs = () => page.evaluate(() => window.__dawAPI.S.proj.sections.map((s) => `${s.name} ${s.startBar}–${s.endBar}`));
  const sheet = () => page.evaluate(() => { const { S, C } = window.__dawAPI; return S.d.chords.filter((c) => c.bar <= 8).map((c) => `${c.bar}:${C.chordName(c.chord, c.flats)}${c.locked ? '🔒' : ''}`).join(' '); });
  const status = () => page.textContent('#status');
  const undo = async () => { await page.locator('#btnUndo').focus(); await page.keyboard.press('Control+z'); await page.waitForFunction(() => /Geri alındı/.test(document.querySelector('#status').textContent)); };
  const depth = () => page.evaluate(() => window.__dawAPI.hist().undo.length);

  // 1) kullanıcının senaryosu: tek bölüm silinince akorlar ve kilit değişmez
  await open(await fixture([['a', 'Şarkı', 1, 8]]));
  const before = await sheet();
  assert.match(before, /4:C#m🔒/, before);
  const d0 = await depth();
  await card('a').locator('[data-act="secDel"]').click();
  assert.deepEqual(await secs(), []);
  assert.equal(await sheet(), before, 'silince akorlar ve kilit aynı');
  assert.match(await status(), /artık bölüm yok, tüm şarkı \(ton: G# Frig\)\. Akorlar ve kilitler yerinde kaldı/);
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.chordLocks.length), 1);
  assert.equal(await page.evaluate(() => window.__dawAPI.S.d.sections[0].implicit), true);
  assert.equal(await depth(), d0 + 1, 'tek geri alma adımı');
  await undo();
  assert.deepEqual(await secs(), ['Şarkı 1–8']); assert.equal(await sheet(), before);
  // bölüm yokken yeni bölüm eklenince ton ve akorlar yine aynı
  await card('a').locator('[data-act="secDel"]').click();
  await page.fill('#inSecStart', '1'); await page.fill('#inSecEnd', '8'); await page.click('#btnSecAdd');
  assert.equal(await page.evaluate(() => `${window.__dawAPI.S.proj.sections[0].tonic}:${window.__dawAPI.S.proj.sections[0].mode}`), '8:phrygian', 'ton devralındı');
  assert.equal(await sheet(), before);

  // 2) iki bölüm: silme komşuya katılır, birleştir, böl, aralık, sürükleme
  const two = await fixture([['a', 'Verse', 1, 4], ['b', 'Nakarat', 5, 8]]);
  await open(two);
  const base = await sheet();
  await card('b').locator('[data-act="secDel"]').click();
  assert.deepEqual(await secs(), ['Verse 1–8']); assert.equal(await sheet(), base);
  assert.match(await status(), /“Nakarat” bölümü kaldırıldı; ölçü 5–8 “Verse” bölümüne katıldı/);
  await undo(); assert.deepEqual(await secs(), ['Verse 1–4', 'Nakarat 5–8']);
  // akorlarıyla sil: bölümün akorları gider
  await card('b').locator('[data-act="secDelChords"]').click();
  assert.deepEqual(await secs(), ['Verse 1–4']);
  assert.equal(await page.evaluate(() => window.__dawAPI.S.d.chords.filter((c) => c.bar > 4).length), 0);
  await undo();
  // birleştir
  assert.ok(await card('a').locator('[data-act="secMergePrev"]').isDisabled(), 'ilk bölümün öncesi yok');
  await card('b').locator('[data-act="secMergePrev"]').click();
  assert.deepEqual(await secs(), ['Verse 1–8']); assert.equal(await sheet(), base);
  assert.match(await status(), /birleşti/);
  // böl: imleç 5. ölçüde
  await page.evaluate(() => { const { S } = window.__dawAPI; S.pos = 4.2 * S.d.g.barSec; });
  await card(await page.evaluate(() => window.__dawAPI.S.proj.sections[0].id)).locator('[data-act="secSplit"]').first().click();
  assert.deepEqual(await secs(), ['Verse 1–4', 'Verse 2 5–8']); assert.equal(await sheet(), base);
  assert.equal(await page.evaluate(() => window.__dawAPI.S.proj.sections[1].tonic), 8);
  // imleç bölümün dışında: reddedilir, değişiklik yok
  const d1 = await depth();
  await page.evaluate(() => { const { S } = window.__dawAPI; S.pos = 0; });
  await card(await page.evaluate(() => window.__dawAPI.S.proj.sections[1].id)).locator('[data-act="secSplit"]').click();
  assert.deepEqual(await secs(), ['Verse 1–4', 'Verse 2 5–8']); assert.equal(await depth(), d1); assert.match(await status(), /imleci bölümün içine koy/);
  // aralık: sayı kutusu komşuyu kısaltır, akorlar aynı
  const firstId = await page.evaluate(() => window.__dawAPI.S.proj.sections[0].id);
  await card(firstId).locator('[data-act="secEnd"]').evaluate((el) => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.deepEqual(await secs(), ['Verse 1–6', 'Verse 2 7–8']); assert.equal(await sheet(), base);
  assert.match(await status(), /“Verse 2” buna göre kısaldı/);
  // tamamen kaplama reddedilir
  await card(firstId).locator('[data-act="secEnd"]').evaluate((el) => { el.value = '8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.deepEqual(await secs(), ['Verse 1–6', 'Verse 2 7–8']); assert.match(await status(), /tamamen kaplıyor/);
  // zaman çizelgesi: ortak sınırı sürükle (ölçü 6 sonu → ölçü 4 sonu)
  const tl = await page.locator('#tl').boundingBox();
  const edgeX = (bar) => page.evaluate((bar) => { const s = window.__daw, sc = document.querySelector('#tlScroll'); return 46 + bar * s.d.g.barQ * s.view.pxPerQ - sc.scrollLeft; }, bar);
  const y = tl.y + 22 + 13;
  const d2 = await depth();
  await page.mouse.move(tl.x + (await edgeX(6)), y); await page.mouse.down();
  await page.mouse.move(tl.x + (await edgeX(4)), y, { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await secs(), ['Verse 1–4', 'Verse 2 5–8']); assert.equal(await sheet(), base);
  assert.match(await status(), /sınırı ölçü 5'ye taşındı/); assert.equal(await depth(), d2 + 1);
  // dışarı sürükleme (bitiş kenarı) komşuyu kısaltmaz, boş yere uzar
  await undo(); assert.deepEqual(await secs(), ['Verse 1–6', 'Verse 2 7–8']);
  // kaydet / yükle: bölümsüz proje
  await open(await fixture([['a', 'Şarkı', 1, 8]]));
  await card('a').locator('[data-act="secDel"]').click();
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dawAPI.S.proj)));
  saved.midiData = (await fixture([['a', 'Şarkı', 1, 8]])).midiData; // kaydetme yolu melodiyi ayrıca ekler; burada proje nesnesini doğrudan alıyoruz
  await open(saved);
  assert.deepEqual(await secs(), []); assert.equal(await sheet(), before);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Bölüm arayüz testi geçti: silme (akor + kilit + ton korunur), komşuya katılma, akorlarıyla sil, birleştir, böl, aralık, sınır sürükleme, kaydet / yükle.');
} finally { await browser.close(); }

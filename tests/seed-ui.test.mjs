// Hazır şarkılar (data/*.json): ilk açılışta onaysız eklenir, kopyalanmaz, silinen geri gelmez (Playwright + Chromium).
// Kullanım: TONE_JS=node_modules/tone/build/Tone.js node tests/seed-ui.test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const total = ['dorian-songs', 'phrygian-songs'].reduce((n, f) => n + JSON.parse(readFileSync(path.join(here, '..', 'data', `${f}.json`), 'utf8')).songs.length, 0);
const toneLocal = process.env.TONE_JS;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
if (toneLocal) await page.route(/tone@15\.1\.22\/build\/Tone\.js|libs\/tone\/15\.1\.22\/Tone\.js/, (r) => r.fulfill({ body: readFileSync(toneLocal), contentType: 'application/javascript' }));
await page.route(/\/salamander\//, (r) => r.abort());
const open = async () => {
  await page.goto(indexUrl);
  await page.waitForFunction(() => window.StyleUI && /Hazır/.test(document.querySelector('#status').textContent));
  await page.click('.views input[value=style] + span');
};
const count = async () => (await page.textContent('.st-count')).trim();
const log = [];
async function step(name, fn) { const info = await fn(); log.push(`✔ ${name}${info ? ' — ' + info : ''}`); }

try {
  await step('temiz açılış: tüm hazır şarkılar onay bekliyor olarak listelenir', async () => {
    await open();
    assert.equal(await count(), `${total} şarkı · 0 şarkıda onaylı bölüm`);
    assert.equal(await page.locator('.st-tabs button.on').textContent(), 'Şarkılar ve onay');
    assert.equal(await page.locator('.st-list li').count(), total);
    assert.equal(await page.locator('.st-list .tag.warn:has-text("onay bekliyor")').count(), total);
    assert.match(await page.textContent('#styleView .st-warn'), new RegExp(`${total} hazır şarkı veri setine eklendi`));
    return `${total} şarkı`;
  });
  await step('yeniden yükleme kopya eklemez', async () => { await open(); assert.equal(await count(), `${total} şarkı · 0 şarkıda onaylı bölüm`); });
  await step('silinen şarkı yeniden yüklemede geri gelmez, düğme geri getirir', async () => {
    await page.click('.st-tabs button:has-text("Şarkılar ve onay")');
    await page.locator('.st-list a', { hasText: 'Moondance' }).click();
    page.once('dialog', (d) => d.accept());
    await page.click('button[data-act=delSong]');
    assert.equal(await count(), `${total - 1} şarkı · 0 şarkıda onaylı bölüm`);
    await open();
    assert.equal(await count(), `${total - 1} şarkı · 0 şarkıda onaylı bölüm`);
    await page.click('.st-tabs button:has-text("İçe aktar")');
    await page.click('button[data-act=seedAll]');
    assert.equal(await count(), `${total} şarkı · 0 şarkıda onaylı bölüm`);
  });
  await step('bölüm onayı çalışır ve istatistiğe girer', async () => {
    await page.click('.st-tabs button:has-text("Şarkılar ve onay")');
    await page.locator('.st-list a', { hasText: 'Radioactive' }).click();
    await page.click('button[data-act=confirmAll]');
    assert.match(await count(), new RegExp(`${total} şarkı · 1 şarkıda onaylı bölüm`));
    assert.equal(await page.locator('.st-list li:has-text("Radioactive") .tag.warn').count(), 0);
  });
  assert.deepEqual(errors, [], 'tarayıcı hataları');
  console.log(log.join('\n') + '\n\nHazır şarkı arayüz testi geçti.');
} catch (e) {
  console.log(log.join('\n') + `\n✘ ${e.stack || e.message}\nTarayıcı hataları: ${JSON.stringify(errors)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

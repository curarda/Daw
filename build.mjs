// src/ altındaki parçaları tek dosyalık index.html'e birleştirir.
import { readFileSync, writeFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tpl = read('./src/template.html');
const out = tpl
  .replace('/*__STYLE__*/', () => read('./src/style.css'))
  .replace('/*__CORE__*/', () => read('./src/core.js') + '\n' + read('./src/drums.js') + '\n' + read('./src/flex.js'))
  .replace('/*__STYLECORE__*/', () => read('./src/styledata.js'))
  .replace('/*__APP__*/', () => read('./src/app.js'))
  .replace('/*__STYLEAPP__*/', () => read('./src/styleui.js')
    // içe aktarma istemi tek kaynak: src/import-prompt.txt
    .replace("/*__IMPORT_PROMPT__*/''", () => JSON.stringify(read('./src/import-prompt.txt').trim())));
writeFileSync(new URL('./index.html', import.meta.url), out);
console.log('index.html yazıldı (' + (out.length / 1024).toFixed(0) + ' KB)');

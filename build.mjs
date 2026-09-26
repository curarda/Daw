// src/ altındaki parçaları tek dosyalık index.html'e birleştirir.
import { readFileSync, writeFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tpl = read('./src/template.html');
const out = tpl
  .replace('/*__STYLE__*/', () => read('./src/style.css'))
  .replace('/*__CORE__*/', () => read('./src/core.js'))
  .replace('/*__APP__*/', () => read('./src/app.js'));
writeFileSync(new URL('./index.html', import.meta.url), out);
console.log('index.html yazıldı (' + (out.length / 1024).toFixed(0) + ' KB)');

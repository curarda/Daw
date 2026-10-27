// src/ altındaki parçaları tek dosyalık index.html'e birleştirir.
import { readFileSync, writeFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tpl = read('./src/template.html');
const out = tpl
  .replace('/*__STYLE__*/', () => read('./src/style.css'))
  .replace('/*__CORE__*/', () => read('./src/core.js') + '\n' + read('./src/drums.js') + '\n' + read('./src/guitar.js') + '\n' + read('./src/vocalfx.js') + '\n' + read('./src/punch.js') + '\n' + read('./src/bass.js') + '\n' + read('./src/basssynth.js') + '\n' + read('./src/basslearn.js') + '\n' + read('./src/flex.js') + '\n' + read('./src/arrangement.js') + '\n' + read('./src/packs.js') + '\n' + read('./src/links.js') + '\n' + read('./src/versions.js') + '\n' + read('./src/soundsettings.js') + '\n' + read('./src/realsounds.js') + '\n' + read('./src/network.js') + '\n' + read('./src/soundcache.js') + '\n' + read('./src/soundselect.js'))
  .replace('/*__STYLECORE__*/', () => read('./src/styledata.js'))
  .replace('/*__APP__*/', () => read('./src/app.js').replace('/*__GUITARUI__*/', () => read('./src/guitarui.js') + '\n' + read('./src/bassui.js')))
  .replace('/*__STYLEAPP__*/', () => read('./src/styleui.js')
    // içe aktarma istemi tek kaynak: src/import-prompt.txt
    .replace("/*__IMPORT_PROMPT__*/''", () => JSON.stringify(read('./src/import-prompt.txt').trim())));
writeFileSync(new URL('./index.html', import.meta.url), out);
console.log('index.html yazıldı (' + (out.length / 1024).toFixed(0) + ' KB)');

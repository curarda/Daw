// index.html içindeki DOM'suz çekirdek bloklarını (core + stylecore) Node'da yükler.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function loadCore() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
  const sandbox = {};
  for (const id of ['core', 'stylecore']) {
    const m = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html);
    if (!m) throw new Error(`index.html içinde <script id="${id}"> yok`);
    new Function('globalThis', 'module', m[1])(sandbox, undefined);
  }
  return sandbox;
}

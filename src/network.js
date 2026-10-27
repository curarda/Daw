// Sabit uç noktalar; hata nesneleri ağın ham yanıtlarını taşımaz.
(function (root) {
const C = root.Core, API = 'https://freesound.org/apiv2/', CDN = 'https://cdn.freesound.org/previews/';
const PREVIEW_LIMIT = 1500000, JSON_LIMIT = 1000000;
class NetError extends Error {
  constructor(code) { super(({ missing: 'Önce Freesound anahtarını kaydet.', unauthorized: 'Anahtar kabul edilmedi (401); anahtarı kontrol et.', rate: 'İstek sınırı (429); biraz bekleyip yeniden dene.', timeout: 'Bağlantı zaman aşımına uğradı; yeniden dene.', size: 'Ses veya yanıt çok büyük; daha kısa bir ses seç.', invalid: 'İstek veya ses kaydı geçersiz; ayarları kontrol et.', network: 'Bağlantı kurulamadı; internet bağlantını kontrol et.' })[code] || 'İstek başarısız; yeniden dene.'); this.name = 'NetError'; this.code = code; }
}
function createNetwork({ fetch: fetcher = (...args) => root.fetch(...args), now = () => root.performance?.now() ?? performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), settings = C.createSoundSettings(), timeout = 10000 } = {}) {
  let queue = Promise.resolve(), next = -Infinity;
  const pending = new Map();
  async function request(url, api) {
    const key = settings.get().freesoundKey;
    if (api && !key) throw new NetError('missing');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (api) { await sleep(Math.max(0, next - now())); next = now() + 2000; }
      const controller = new AbortController(); let timer;
      try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new NetError('timeout')); }, timeout); });
        const work = async () => {
          const res = await fetcher(url, { redirect: 'error', credentials: 'omit', signal: controller.signal, headers: api ? { Authorization: 'Token ' + key } : {} });
          if (!res.ok) {
            if (res.status === 429 || res.status >= 500) {
              const retry = res.headers.get('Retry-After');
              const seconds = /^\d+(\.\d+)?$/.test(retry || '') ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
              if (api) next = Math.max(next, now() + Math.max(seconds, 2000 * (attempt + 1)));
              throw new NetError(res.status === 429 ? 'rate' : 'network');
            }
            throw new NetError(res.status === 401 ? 'unauthorized' : 'invalid');
          }
          const limit = api ? JSON_LIMIT : PREVIEW_LIMIT;
          if (Number(res.headers.get('Content-Length')) > limit) throw new NetError('size');
          let bytes;
          if (res.body?.getReader) {
            const reader = res.body.getReader(), chunks = []; let size = 0;
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); throw new NetError('size'); } chunks.push(part.value); }
            bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          } else { bytes = new Uint8Array(await res.arrayBuffer()); if (bytes.length > limit) throw new NetError('size'); }
          if (!api) return bytes;
          try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new NetError('invalid'); }
        };
        return await Promise.race([work(), deadline]);
      } catch (error) {
        const safe = error instanceof NetError ? error : new NetError(controller.signal.aborted ? 'timeout' : 'network');
        if (attempt === 2 || !['rate', 'network'].includes(safe.code)) throw safe;
        await sleep(1000 * (attempt + 1));
      } finally { clearTimeout(timer); }
    }
  }
  function run(path, api = true) {
    const url = api ? API + path : path;
    if (pending.has(url)) return pending.get(url);
    const task = api ? queue.then(() => request(url, true)) : request(url, false);
    if (api) queue = task.catch(() => {});
    const done = task.finally(() => pending.delete(url)); pending.set(url, done); return done;
  }
  const record = (r) => r && C.normalizeSoundRecord({ ...r, author: r.username ?? r.author, previewUrl: r.previews?.['preview-hq-mp3'] ?? r.previews?.['preview-hq-ogg'] ?? r.previewUrl });
  function freesoundSearch(params = {}) {
    if (Object.keys(params).some((k) => !['query', 'minDuration', 'maxDuration', 'pageSize', 'fields'].includes(k))) return Promise.reject(new NetError('invalid'));
    const { query = '', minDuration = 0, maxDuration = 6, pageSize = 10, fields = ['id', 'name', 'username', 'url', 'license', 'previews'] } = params;
    if (typeof query !== 'string' || !/^[A-Za-z0-9 _-]{0,120}$/.test(query) || !Number.isFinite(minDuration) || !Number.isFinite(maxDuration) || minDuration < 0 || maxDuration > 6 || minDuration > maxDuration || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 30 || !Array.isArray(fields) || fields.some((f) => !['id', 'name', 'username', 'url', 'license', 'previews', 'duration', 'tags'].includes(f))) return Promise.reject(new NetError('invalid'));
    const qs = new URLSearchParams({ query, filter: 'license:"Creative Commons 0" duration:[' + minDuration + ' TO ' + maxDuration + ']', page_size: pageSize, fields: [...new Set(['id', 'name', 'username', 'url', 'license', 'previews', ...fields])].join(',') });
    return run('search/text/?' + qs).then((v) => ({ results: (Array.isArray(v?.results) ? v.results : []).slice(0, pageSize).map(record).filter(Boolean) }));
  }
  function freesoundSound(id) { return Number.isSafeInteger(id) && id > 0 ? run('sounds/' + id + '/').then(record) : Promise.reject(new NetError('invalid')); }
  function freesoundPreview(urlOrId) {
    if (Number.isSafeInteger(urlOrId)) return freesoundSound(urlOrId).then((r) => { if (!r) throw new NetError('invalid'); return freesoundPreview(r.previewUrl); });
    if (typeof urlOrId !== 'string' || !/^https:\/\/cdn\.freesound\.org\/previews\/[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(urlOrId) || !urlOrId.startsWith(CDN)) return Promise.reject(new NetError('invalid'));
    return run(urlOrId, false);
  }
  return { freesoundSearch, freesoundSound, freesoundPreview, probe: () => freesoundSearch({ query: 'kick', pageSize: 1 }) };
}
Object.assign(C, { createNetwork, NetError });
})(typeof window !== 'undefined' ? window : globalThis);

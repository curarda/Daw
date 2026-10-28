// Sabit uç noktalar; hata nesneleri ağın ham yanıtlarını taşımaz.
(function (root) {
const C = root.Core, API = 'https://freesound.org/apiv2/', CDN = 'https://cdn.freesound.org/previews/';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
const PREVIEW_LIMIT = 1500000, JSON_LIMIT = 1000000;
class NetError extends Error {
  constructor(code) { super(({ gemini_missing: 'Gemini anahtarı eksik; deterministik seçim kullanılıyor.', gemini_400: 'Gemini isteği reddedildi (400); ayarları kontrol et.', gemini_401: 'Gemini anahtarı kabul edilmedi (401); anahtarı kontrol et.', gemini_403: 'Gemini erişimi reddedildi (403); anahtar izinlerini kontrol et.', gemini_404: 'Gemini model adı geçersiz: ayarlardan değiştir', gemini_429: 'Gemini istek sınırı (429); biraz bekle.', gemini_5xx: 'Gemini sunucu hatası (5xx); yeniden dene.', gemini_timeout: 'Gemini zaman aşımı; deterministik seçim kullanılıyor.', gemini_network: 'Gemini bağlantısı kurulamadı; internet bağlantını kontrol et.', gemini_size: 'Gemini isteği veya yanıtı boyut sınırını aşıyor.', gemini_invalid: 'Gemini geçersiz JSON veya seçim döndürdü.', aborted: 'Seçim iptal edildi.', missing: 'Önce Freesound anahtarını kaydet.', unauthorized: 'Anahtar kabul edilmedi (401); anahtarı kontrol et.', rate: 'İstek sınırı (429); biraz bekleyip yeniden dene.', timeout: 'Bağlantı zaman aşımına uğradı; yeniden dene.', size: 'Ses veya yanıt çok büyük; daha kısa bir ses seç.', invalid: 'İstek veya ses kaydı geçersiz; ayarları kontrol et.', network: 'Bağlantı kurulamadı; internet bağlantını kontrol et.' })[code] || 'İstek başarısız; yeniden dene.'); this.name = 'NetError'; this.code = code; }
}
function createNetwork({ fetch: fetcher = (...args) => root.fetch(...args), now = () => root.performance?.now() ?? performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), settings = C.createSoundSettings(), timeout = 10000, geminiTimeout = 15000 } = {}) {
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
    const qs = new URLSearchParams({ query, filter: 'license:"Creative Commons 0" duration:[' + minDuration + ' TO ' + maxDuration + ']', page_size: pageSize, fields: [...new Set(['id', 'name', 'username', 'url', 'license', 'previews', 'duration', 'tags', ...fields])].join(',') });
    return run('search/text/?' + qs).then((v) => ({ results: (Array.isArray(v?.results) ? v.results : []).slice(0, pageSize).map(record).filter(Boolean), candidates: (Array.isArray(v?.results) ? v.results : []).slice(0, pageSize).map((r) => C.normalizeSoundCandidate({ record: record(r), duration: r?.duration, tags: r?.tags })).filter(Boolean) }));
  }
  function freesoundSound(id) { return Number.isSafeInteger(id) && id > 0 ? run('sounds/' + id + '/').then(record) : Promise.reject(new NetError('invalid')); }
  function freesoundPreview(urlOrId) {
    if (Number.isSafeInteger(urlOrId)) return freesoundSound(urlOrId).then((r) => { if (!r) throw new NetError('invalid'); return freesoundPreview(r.previewUrl); });
    if (typeof urlOrId !== 'string' || !/^https:\/\/cdn\.freesound\.org\/previews\/[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(urlOrId) || !urlOrId.startsWith(CDN)) return Promise.reject(new NetError('invalid'));
    return run(urlOrId, false);
  }
  async function geminiGenerate({ model, system, user, schema, signal } = {}) {
    if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(model)) throw new NetError('gemini_404');
    const keys = settings.get(), key = keys.geminiKey;
    if (!key) throw new NetError('gemini_missing');
    if (typeof system !== 'string' || typeof user !== 'string') throw new NetError('gemini_invalid');
    if ([key, keys.freesoundKey].filter(Boolean).some((secret) => system.includes(secret) || user.includes(secret))) throw new NetError('gemini_invalid');
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' } });
    if (new TextEncoder().encode(body).length > 20000) throw new NetError('gemini_size');
    const controller = new AbortController(); let timer, abort;
    const stopped = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(new NetError('aborted')); };
      timer = setTimeout(() => { controller.abort(); reject(new NetError('gemini_timeout')); }, geminiTimeout);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      const work = async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (controller.signal.aborted) throw new NetError('aborted');
          let res;
          try { res = await fetcher(GEMINI + model + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body, redirect: 'error', credentials: 'omit', signal: controller.signal }); }
          catch (_) { throw new NetError('gemini_network'); }
          if (!res.ok) {
            if ((res.status === 429 || res.status >= 500) && attempt === 0) {
              const retry = res.headers.get('Retry-After');
              const delay = /^\d+(\.\d+)?$/.test(retry || '') ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 1000;
              await sleep(Math.min(3000, delay)); continue;
            }
            throw new NetError(res.status >= 500 ? 'gemini_5xx' : [400, 401, 403, 404, 429].includes(res.status) ? 'gemini_' + res.status : 'gemini_invalid');
          }
          if (Number(res.headers.get('Content-Length')) > 64000) throw new NetError('gemini_size');
          let bytes;
          if (res.body?.getReader) {
            const reader = res.body.getReader(), chunks = []; let length = 0;
            while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 64000) { await reader.cancel(); throw new NetError('gemini_size'); } chunks.push(part.value); }
            bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          } else { bytes = new Uint8Array(await res.arrayBuffer()); if (bytes.length > 64000) throw new NetError('gemini_size'); }
          try {
            const answer = JSON.parse(new TextDecoder().decode(bytes))?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof answer !== 'string' || [key, keys.freesoundKey].filter(Boolean).some((secret) => answer.includes(secret))) throw new Error();
            const parsed = JSON.parse(answer);
            if ([key, keys.freesoundKey].filter(Boolean).some((secret) => JSON.stringify(parsed).includes(secret))) throw new Error();
            return parsed;
          } catch (_) { throw new NetError('gemini_invalid'); }
        }
      };
      return await Promise.race([work(), stopped]);
    } catch (e) { throw e instanceof NetError ? e : new NetError('gemini_network'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return { geminiGenerate, freesoundSearch, freesoundSound, freesoundPreview, probe: () => freesoundSearch({ query: 'kick', pageSize: 1 }) };
}
Object.assign(C, { createNetwork, NetError });
})(typeof window !== 'undefined' ? window : globalThis);

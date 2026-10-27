// Önizleme baytları ve doğrulanmış krediler; çözülmüş ses burada tutulmaz.
(function (root) {
const C = root.Core;
function createSoundCache({ indexedDB = root.indexedDB, cap = 40000000, backend } = {}) {
  const memory = new Map(); let failed = false, dbPromise, serial = Promise.resolve(), tick = 0;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('miniDaw.sounds.v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('entries', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result); req.onerror = req.onblocked = () => reject(new Error('storage'));
    });
    return dbPromise;
  }
  async function store(op, value) {
    if (backend) return backend[op](value);
    if (!indexedDB || failed) {
      if (op === 'all') return [...memory.values()];
      if (op === 'put') memory.set(value.key, value);
      if (op === 'delete') memory.delete(value);
      return;
    }
    try {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', op === 'all' ? 'readonly' : 'readwrite'), s = tx.objectStore('entries');
        const req = op === 'all' ? s.getAll() : op === 'put' ? s.put(value) : s.delete(value);
        tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(new Error('storage'));
      });
    } catch (_) { failed = true; return store(op, value); }
  }
  const key = (id, url) => id + '|' + url;
  const size = (r, bytes) => bytes.byteLength + new TextEncoder().encode(JSON.stringify(r)).length;
  function guarded(fn, fallback) {
    const p = serial.then(fn).catch(() => { failed = true; return fallback; }); serial = p.then(() => {}); return p;
  }
  async function entries() { return await store('all') || []; }
  return {
    get(id, url) { return guarded(async () => {
      const e = (await entries()).find((e) => e.key === key(id, url)); if (!e) return null;
      const record = C.normalizeSoundRecord(e.record);
      if (!record || record.id !== id || record.previewUrl !== url || !(e.bytes instanceof Uint8Array) || e.bytes.length > 1500000) { await store('delete', e.key); return null; }
      await store('put', { ...e, used: ++tick + Date.now() }); return { record, bytes: e.bytes.slice() };
    }, null); },
    put(record, bytes) { return guarded(async () => {
      record = C.normalizeSoundRecord(record);
      if (!record || !(bytes instanceof Uint8Array) || bytes.length > 1500000) return false;
      const n = size(record, bytes); if (n > cap) return false;
      const k = key(record.id, record.previewUrl), all = (await entries()).filter((e) => e.key !== k).sort((a, b) => a.used - b.used);
      let total = all.reduce((n, e) => n + e.size, 0);
      while (total + n > cap && all.length) { const e = all.shift(); await store('delete', e.key); total -= e.size; }
      await store('put', { key: k, record, bytes: bytes.slice(), size: n, used: ++tick + Date.now() }); return true;
    }, false); },
    delete(id, url) { return guarded(async () => { await store('delete', key(id, url)); return true; }, false); },
    stats() { return guarded(async () => { const all = await entries(); return { entries: all.length, bytes: all.reduce((n, e) => n + e.size, 0), storageFailed: failed, backend: indexedDB && !failed ? 'indexedDB' : 'memory' }; }, { entries: 0, bytes: 0, storageFailed: true, backend: 'memory' }); }
  };
}
C.createSoundCache = createSoundCache;
})(typeof window !== 'undefined' ? window : globalThis);

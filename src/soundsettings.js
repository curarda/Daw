// Anahtarlar proje verisinden ayrı, yalnızca tarayıcıda tutulur.
(function (root) {
const DEFAULT_MODEL = 'gemini-2.5-flash', STORAGE_KEY = 'miniDaw.soundSettings.v1';
function maskKey(key) { return key ? (key.length > 4 ? key.slice(0, 2) + '••••' + key.slice(-2) : '••••') : ''; }
function createSoundSettings(storage) {
  let value = { freesoundKey: '', geminiKey: '', geminiModel: DEFAULT_MODEL }, storageFailed = false, message = '';
  const clean = (v) => {
    const model = typeof v?.geminiModel === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v.geminiModel);
    message = model || !v?.geminiModel ? '' : 'Model adı geçersiz; varsayılan model kullanılıyor.';
    return { freesoundKey: typeof v?.freesoundKey === 'string' ? v.freesoundKey : '', geminiKey: typeof v?.geminiKey === 'string' ? v.geminiKey : '', geminiModel: model ? v.geminiModel : DEFAULT_MODEL };
  };
  try { storage = storage === undefined ? root.localStorage : storage; value = clean(JSON.parse(storage.getItem(STORAGE_KEY)) || value); } catch (_) { storageFailed = true; }
  return {
    get: () => ({ ...value }),
    set(v) { value = clean(v); try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (_) { storageFailed = true; } return this.get(); },
    clear() { value = clean({}); try { storage.removeItem(STORAGE_KEY); } catch (_) { storageFailed = true; } },
    status: () => ({ storageFailed, message }), maskKey
  };
}
Object.assign(root.Core, { createSoundSettings, maskKey });
})(typeof window !== 'undefined' ? window : globalThis);

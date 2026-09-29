/* =====================================================================
   STİL VERİSİ VE ÖNERİ — arayüz (içe aktarma, onay, istatistik, model,
   geri bildirim, progresyon önericisi, saklama)
   ===================================================================== */
(function () {
'use strict';
const St = window.Style, A = window.__dawAPI, C = A.C;
const $ = (s, r = document) => r.querySelector(s);
const esc = A.esc;
const LS = { dataset: 'miniDaw.style.dataset', settings: 'miniDaw.style.settings', feedback: 'miniDaw.style.feedback' };
const lsGet = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* depolama kapalı olabilir */ } };

const SS = {
  dataset: St.newDataset(), settings: Object.assign({}, St.MODEL_DEFAULTS), feedback: St.newFeedback(),
  model: null, tab: 'import', editing: null, statMode: St.ALL, drill: null, importErrors: [], pending: [],
  cv: null, prog: null, progOpts: Object.assign({ tonic: 1, mode: 'phrygian' }, St.PROG_DEFAULTS), trans: null,
};
try {
  const d = lsGet(LS.dataset); if (d) SS.dataset = St.checkFile(d, 'mini-daw-style-dataset');
  const s = lsGet(LS.settings); if (s) Object.assign(SS.settings, St.checkFile(s, 'mini-daw-style-settings').settings);
  const f = lsGet(LS.feedback); if (f) SS.feedback = St.checkFile(f, 'mini-daw-style-feedback');
} catch (e) { console.warn('stil verisi yüklenemedi:', e.message); }

const settingsFile = () => ({ schema: 'mini-daw-style-settings', version: 1, settings: SS.settings });
function persist() { lsSet(LS.dataset, SS.dataset); lsSet(LS.settings, settingsFile()); lsSet(LS.feedback, SS.feedback); }
function model() { if (!SS.model) SS.model = St.buildModel(SS.dataset, SS.settings, SS.feedback); return SS.model; }
const confirmedSongs = () => model().stats.byMode.get(St.ALL).songs.size;
// veri / ayar / geri bildirim değişti → istatistik + model + DAW akorları anında güncellenir
function changed(what = 'data') {
  SS.model = null;
  if (what !== 'view') persist();
  render();
  A.refresh();
  renderDawBox();
}
const songById = (id) => SS.dataset.songs.find((s) => s.id === id);
const songName = (s) => (s ? `${s.artist} – ${s.title}` : '(silinmiş)');
const PCS = C.PC_SHARP;
const tonicSel = (v, act, extra = '') => `<select data-act="${act}" ${extra}>${PCS.map((n, i) => `<option value="${i}"${v === i ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
const modeSel = (v, act, extra = '') => `<select data-act="${act}" ${extra}>${C.MODE_ORDER.map((m) => `<option value="${m}"${v === m ? ' selected' : ''}>${C.MODES[m].name}</option>`).join('')}</select>`;
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const download = (text, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};

// ---------------------------------------------------------------- görünüm
const view = $('#styleView');
function setView(v) {
  $('#dawView').hidden = v !== 'daw';
  view.hidden = v !== 'style';
  document.querySelectorAll('input[name=view]').forEach((r) => { r.checked = r.value === v; });
  if (v === 'style') render();
  else window.dispatchEvent(new Event('resize'));
}
document.querySelectorAll('input[name=view]').forEach((r) => r.addEventListener('change', (e) => setView(e.target.value)));

const TABS = [['import', 'İçe aktar'], ['songs', 'Şarkılar ve onay'], ['stats', 'İstatistik'], ['model', 'Model ve geri bildirim'], ['prog', 'Progresyon önerici'], ['store', 'Saklama']];
function render() {
  if (view.hidden) return;
  const n = SS.dataset.songs.length, nc = confirmedSongs();
  view.innerHTML = `<div class="st-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${SS.tab === k ? 'on' : ''}" aria-selected="${SS.tab === k}">${l}</button>`).join('')}
    <span class="hint st-count">${n} şarkı · ${nc} şarkıda onaylı bölüm</span></div>
    <div class="st-body">${({ import: tabImport, songs: tabSongs, stats: tabStats, model: tabModel, prog: tabProg, store: tabStore })[SS.tab]()}</div>`;
}
view.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { SS.tab = t.dataset.tab; render(); return; }
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act] && (b.tagName === 'BUTTON' || b.tagName === 'TD' || b.tagName === 'A' || b.tagName === 'TR' || b.dataset.click)) ACTIONS[b.dataset.act](b, e);
});
view.addEventListener('change', (e) => { const t = e.target; if (t.dataset.act && CHANGES[t.dataset.act]) CHANGES[t.dataset.act](t, e); });

// ---------------------------------------------------------------- 1) İÇE AKTARMA
// tek kaynak: src/import-prompt.txt (derlemede buraya gömülür)
const PROMPT = /*__IMPORT_PROMPT__*/'';
function tabImport() {
  const errs = SS.importErrors.length ? `<div class="st-err" role="alert"><b>İçe aktarılamadı — bozuk alanlar:</b><ul>${SS.importErrors.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul></div>` : '';
  const pend = SS.pending.map((p, i) => `<div class="st-warn" role="alert">⚠ <b>${esc(songName(p.song))}</b> zaten veri setinde (${esc(songName(p.dup))}).
      <button data-act="dupOverwrite" data-i="${i}">Üzerine yaz</button> <button data-act="dupCancel" data-i="${i}">Vazgeç</button></div>`).join('');
  return `<div class="st-grid2">
    <div>
      <h3>Şarkı ekle</h3>
      <p class="hint">Claude chat'in ürettiği JSON'u (schema_version 1) yapıştırın ya da dosyadan yükleyin. Yedek olarak düz metin akor şeması da olur: <code>[Verse: C# phrygian] C#m D C#m D</code>, süreli <code>C#m:4 D:2</code> ya da ölçü çizgili <code>| C#m | D C#m |</code> (DAW'ın dışa aktardığı akor şeması da olur).</p>
      <div class="row">
        <label>Biçim <select id="stFmt" style="width:auto"><option value="auto">otomatik</option><option value="json">JSON</option><option value="text">düz metin</option></select></label>
        <label class="file-btn">Dosyadan yükle<input type="file" id="stFile" accept=".json,.txt,application/json,text/plain" hidden></label>
      </div>
      <textarea id="stText" rows="14" spellcheck="false" placeholder='{"schema_version": 1, "artist": "...", ...}'>${esc(SS.lastText || '')}</textarea>
      <div class="grid2"><label>Sanatçı (düz metin için)<input type="text" id="stArtist"></label><label>Şarkı (düz metin için)<input type="text" id="stTitle"></label></div>
      <div class="row"><button class="accent" data-act="doImport">Çözümle ve ekle</button> <button data-act="loadExample">Örnek JSON'u doldur</button></div>
      ${errs}${pend}
    </div>
    <div>
      <h3>Claude chat için istem</h3>
      <p class="hint">Bu metni şarkı adıyla birlikte Claude'a verin; çıktıyı soldaki alana yapıştırın.</p>
      <pre class="st-pre" id="stPrompt">${esc(PROMPT)}</pre>
      <button data-act="copyPrompt">İstemi kopyala</button>
    </div></div>`;
}
const EXAMPLE = {
  schema_version: 1, artist: 'Örnek Sanatçı', title: 'Frig ve Dorian',
  source_notes: { capo: null, tuning: null, other: null },
  warnings: [],
  sections: [
    { label: 'Verse 1', type: 'verse', chords: ['C#m', 'D', 'C#m', 'D', 'C#m', 'D', 'C#m', 'D'], bars: [1, 1, 1, 1, 1, 1, 1, 1],
      key_proposals: [{ tonic: 'C#', mode: 'phrygian', confidence: 0.8, reason: 'C# merkez, D ♭II' }, { tonic: 'A', mode: 'major', confidence: 0.2, reason: 'D, A majörde IV' }],
      degrees_preview: ['i', '♭II', 'i', '♭II', 'i', '♭II', 'i', '♭II'].map((c) => ({ core: c, color: null, bass: null })) },
    { label: 'Chorus', type: 'chorus', chords: ['Bm', 'E', 'A', 'Bm'], bars: null, key_proposals: [{ tonic: 'B', mode: 'dorian', confidence: 0.7, reason: 'B merkez, G#' }],
      degrees_preview: ['i', 'IV', '♭VII', 'i'].map((c) => ({ core: c, color: null, bass: null })) },
  ],
};
function addSongs(songs) {
  let added = 0;
  for (const song of songs) {
    const dup = St.findDuplicate(SS.dataset, song);
    if (dup) { SS.pending.push({ song, dup }); continue; }
    SS.dataset.songs.push(song); added++;
    SS.editing = song.id;
  }
  return added;
}
function doImport(text, fmt) {
  SS.lastText = text;
  const isJson = fmt === 'json' || (fmt === 'auto' && /^\s*[{[]/.test(text));
  const r = isJson ? St.parseImportJson(text) : St.parseImportText(text, { artist: ($('#stArtist') || {}).value, title: ($('#stTitle') || {}).value });
  SS.importErrors = r.errors;
  if (r.errors.length) { A.status(`İçe aktarma: ${r.errors.length} şema hatası (alanlar listelendi).`, 'err'); render(); return; }
  const added = addSongs(r.songs);
  if (added) { SS.tab = SS.pending.length ? 'import' : 'songs'; A.status(`${added} şarkı eklendi — bölümleri onaylayın (onaysız bölüm istatistiğe girmez).`); }
  else A.status('Şarkı zaten var: üzerine yazmak ya da vazgeçmek için seçin.', 'err');
  changed();
}
const ACTIONS = {
  doImport: () => doImport($('#stText').value, $('#stFmt').value),
  loadExample: () => { SS.lastText = JSON.stringify(EXAMPLE, null, 2); render(); },
  copyPrompt: () => { try { navigator.clipboard.writeText(PROMPT); A.status('İstem panoya kopyalandı.'); } catch (e) { A.status('Kopyalanamadı; metni elle seçin.', 'err'); } },
  dupOverwrite: (b) => {
    const p = SS.pending.splice(+b.dataset.i, 1)[0];
    const idx = SS.dataset.songs.findIndex((s) => s.id === p.dup.id);
    p.song.id = p.dup.id;
    SS.dataset.songs[idx] = p.song;
    SS.editing = p.song.id; SS.tab = SS.pending.length ? 'import' : 'songs';
    A.status(`${songName(p.song)} üzerine yazıldı (onaylar sıfırlandı).`);
    changed();
  },
  dupCancel: (b) => { const p = SS.pending.splice(+b.dataset.i, 1)[0]; A.status(`${songName(p.song)} eklenmedi.`); render(); },
  // ---- şarkılar
  editSong: (b) => { SS.editing = b.dataset.id; render(); },
  delSong: (b) => {
    const s = songById(b.dataset.id);
    if (!confirm(`${songName(s)} silinsin mi?`)) return;
    SS.dataset.songs = SS.dataset.songs.filter((x) => x.id !== s.id);
    if (SS.editing === s.id) SS.editing = null;
    changed();
  },
  confirmSec: (b) => {
    const s = songById(b.dataset.id), sec = s.sections[+b.dataset.si];
    if (!sec.selected) { A.status('Önce merkez + mod seçin.', 'err'); return; }
    sec.confirmed = true; changed();
  },
  unconfirmSec: (b) => { const s = songById(b.dataset.id); s.sections[+b.dataset.si].confirmed = false; changed(); },
  confirmAll: (b) => {
    const s = songById(b.dataset.id);
    const unk = new Set(St.unknownSymbols(s).map((u) => u.raw));
    s.sections.forEach((sec) => { if (sec.selected && !sec.chords.some((c) => unk.has(c))) sec.confirmed = true; });
    changed();
  },
  pickProposal: (b) => {
    const s = songById(b.dataset.id), sec = s.sections[+b.dataset.si], p = sec.proposals[+b.dataset.pi];
    sec.selected = { tonic: p.tonic, mode: p.mode }; sec.confirmed = false; changed();
  },
  applyFixes: (b) => {
    const s = songById(b.dataset.id);
    view.querySelectorAll(`input[data-fix][data-id="${s.id}"]`).forEach((inp) => {
      const v = inp.value.trim();
      if (!v) return;
      if (!St.parseSymbol(v).ok) { A.status(`"${v}" de tanınmadı.`, 'err'); return; }
      s.fixes[inp.dataset.fix] = v;
    });
    changed();
  },
  editChords: (b) => { SS.chordEdit = `${b.dataset.id}:${b.dataset.si}`; render(); },
  saveChords: (b) => {
    const s = songById(b.dataset.id), sec = s.sections[+b.dataset.si];
    const toks = $(`#stChordEdit`).value.split(/[\s|,]+/).filter(Boolean);
    if (!toks.length) { A.status('Bölümde en az bir akor olmalı.', 'err'); return; }
    // "akor:süre" (ölçü); ya hepsinde ya hiçbirinde
    const parsed = toks.map((t) => { const m = /^(.+?):(\d+(?:[.,]\d+)?)$/.exec(t); return m ? [m[1], parseFloat(m[2].replace(',', '.'))] : [t, null]; });
    const withDur = parsed.filter((x) => x[1] != null).length;
    if (withDur && withDur !== parsed.length) { A.status('Süre ya tüm akorlarda ya hiçbirinde olmalı (ör. C#m:2 D:2).', 'err'); return; }
    if (parsed.some((x) => x[1] != null && !(x[1] > 0))) { A.status('Süreler pozitif olmalı.', 'err'); return; }
    sec.chords = parsed.map((x) => x[0]);
    sec.bars = withDur ? parsed.map((x) => x[1]) : null;
    SS.chordEdit = null; changed();
  },
  cancelChords: () => { SS.chordEdit = null; render(); },
  // ---- istatistik
  statMode: (b) => { SS.statMode = b.dataset.m; SS.drill = null; render(); },
  drill: (b) => { SS.drill = { title: b.dataset.title, refs: JSON.parse(b.dataset.refs) }; render(); const d = $('#stDrill'); if (d) d.scrollIntoView({ block: 'nearest' }); },
  // ---- model
  suggestKA: () => {
    A.status('Çapraz doğrulama çalışıyor…', 'busy');
    setTimeout(() => { SS.cv = St.suggestKAlpha(SS.dataset, SS.settings); A.status(SS.cv.ok ? `Önerilen k=${SS.cv.best.k}, α=${SS.cv.best.alpha}` : SS.cv.reason, SS.cv.ok ? '' : 'err'); render(); }, 20);
  },
  applyKA: () => { if (!SS.cv || !SS.cv.ok) return; SS.settings.k = SS.cv.best.k; SS.settings.alpha = SS.cv.best.alpha; if (SS.cv.bestDur) SS.settings.alphaDur = SS.cv.bestDur.alphaDur; changed(); },
  fbReset: () => { if (!confirm('Tüm kişisel geri bildirim silinsin mi? (şarkı verisi etkilenmez)')) return; SS.feedback = Object.assign(St.newFeedback(), { on: SS.feedback.on }); changed(); },
  // ---- progresyon
  runProg: () => runProg(),
  playProg: (b) => { const it = SS.prog.items[+b.dataset.i]; A.preview(it.chords, SS.prog.opts.tonic, SS.prog.opts.mode, it.durations); },
  stopProg: () => A.stop(),
  fbProg: (b) => {
    const it = SS.prog.items[+b.dataset.i], like = +b.dataset.v;
    const tr = [[ '^', it.cores[0]], ...it.steps.map((s) => [s.a, s.b])];
    SS.feedback.events.push({ t: Date.now(), kind: 'progression', mode: SS.prog.opts.mode, transitions: tr, like, prog: it.key, symbols: it.symbols });
    if (like < 0 && !SS.feedback.banned.includes(it.key)) SS.feedback.banned.push(it.key);
    it.fb = like;
    A.status(like > 0 ? 'Beğenildi: geçişlerin olasılığı artırıldı (en fazla ×2).' : 'Beğenilmedi: bu progresyon bir daha önerilmeyecek; geçişler azaltıldı (en az ×0.5).');
    SS.model = null; persist(); render(); A.refresh();
  },
  placeProg: (b) => {
    const it = SS.prog.items[+b.dataset.i];
    const bar = Math.max(1, parseInt($(`#stPlace${b.dataset.i}`).value, 10) || 1);
    A.placeChords(it.chords, bar, { tonic: SS.prog.opts.tonic, mode: SS.prog.opts.mode }, it.durations);
  },
  runTrans: () => {
    const g = (id) => +$(id).value;
    const from = { tonic: g('#stTrFromT'), mode: $('#stTrFromM').value }, to = { tonic: g('#stTrToT'), mode: $('#stTrToM').value };
    SS.trans = { from, to, res: St.suggestSectionTransition(model(), from, to) };
    render();
  },
  playTrans: (b) => { const it = SS.trans.res.items[+b.dataset.i]; A.preview([it.from.chord, it.to.chord], SS.trans.from.tonic, SS.trans.from.mode); },
  fromDaw: (b) => {
    const d = A.S.d, s = d && d.sections.find((x) => x.id === b.dataset.sec);
    if (!s || s.tonic == null) return;
    if (b.dataset.target === 'prog') { SS.progOpts.tonic = s.tonic; SS.progOpts.mode = s.mode; }
    else if (b.dataset.target === 'from') SS.trFrom = { tonic: s.tonic, mode: s.mode };
    else SS.trTo = { tonic: s.tonic, mode: s.mode };
    render();
  },
  // ---- saklama
  exp: (b) => {
    const k = b.dataset.k;
    if (k === 'dataset') download(JSON.stringify(SS.dataset, null, 1), 'stil-veri-seti.json');
    if (k === 'settings') download(JSON.stringify(settingsFile(), null, 1), 'stil-model-ayarlari.json');
    if (k === 'feedback') download(JSON.stringify(SS.feedback, null, 1), 'stil-geri-bildirim.json');
  },
  clearAll: () => { if (!confirm('Tüm şarkılar silinsin mi? (ayarlar ve geri bildirim kalır)')) return; SS.dataset = St.newDataset(); SS.editing = null; changed(); },
};
const CHANGES = {
  secTonic: (t) => { const s = songById(t.dataset.id), sec = s.sections[+t.dataset.si]; sec.selected = { tonic: +t.value, mode: sec.selected ? sec.selected.mode : 'major' }; sec.confirmed = false; changed(); },
  secMode: (t) => { const s = songById(t.dataset.id), sec = s.sections[+t.dataset.si]; sec.selected = { tonic: sec.selected ? sec.selected.tonic : 0, mode: t.value }; sec.confirmed = false; changed(); },
  songField: (t) => {
    const s = songById(t.dataset.id);
    const old = s[t.dataset.f];
    s[t.dataset.f] = t.value.trim() || old;
    const dup = St.findDuplicate(SS.dataset, s);
    if (dup) { s[t.dataset.f] = old; A.status(`Bu ad zaten var: ${songName(dup)}`, 'err'); }
    changed();
  },
  set: (t) => {
    const v = t.type === 'checkbox' ? t.checked : +t.value;
    if (t.type !== 'checkbox' && !Number.isFinite(v)) return;
    SS.settings[t.dataset.k] = v; changed();
  },
  fbOn: (t) => { SS.feedback.on = t.checked; changed(); },
  prog: (t) => { const k = t.dataset.k; SS.progOpts[k] = t.type === 'checkbox' ? t.checked : k === 'mode' || k === 'ending' ? t.value : +t.value; },
  // kullanıcı süreleri elle değiştirir (yarım ölçü adımı); gösterim ve toplam güncellenir
  progDur: (t) => {
    const it = SS.prog.items[+t.dataset.i];
    const v = Math.max(0.5, Math.round((parseFloat(t.value) || 0.5) * 2) / 2);
    it.durations[+t.dataset.j] = v;
    it.display = St.progDisplay(it.degrees, it.durations);
    it.displaySymbols = St.progDisplay(it.symbols, it.durations);
    it.edited = true;
    render();
  },
  imp: async (t) => {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const k = t.dataset.k;
      if (k === 'dataset') { St.checkFile(obj, 'mini-daw-style-dataset'); const inc = obj.songs.filter((s) => !St.findDuplicate(SS.dataset, s)); const dup = obj.songs.length - inc.length;
        if (SS.dataset.songs.length && !confirm(`Veri seti değiştirilsin mi? Tamam = tamamen değiştir, İptal = birleştir (${dup} kopya atlanır).`)) SS.dataset.songs.push(...inc); else SS.dataset = obj; }
      if (k === 'settings') Object.assign(SS.settings, St.checkFile(obj, 'mini-daw-style-settings').settings);
      if (k === 'feedback') SS.feedback = St.checkFile(obj, 'mini-daw-style-feedback');
      A.status(`${f.name} içe aktarıldı.`);
      changed();
    } catch (e) { A.status('İçe aktarılamadı: ' + e.message, 'err'); }
  },
};
view.addEventListener('change', async (e) => {
  if (e.target.id === 'stFile') {
    const f = e.target.files[0]; e.target.value = '';
    if (f) { const txt = await f.text(); SS.lastText = txt; render(); doImport(txt, f.name.endsWith('.json') ? 'json' : $('#stFmt').value); }
  }
});

// ---------------------------------------------------------------- 2) ONAY EKRANI
function tabSongs() {
  const stats = model().stats;
  const list = SS.dataset.songs.map((s) => {
    const info = stats.songInfo.get(s.id) || { confirmed: 0 };
    const unk = St.unknownSymbols(s).length;
    return `<li class="${SS.editing === s.id ? 'on' : ''}"><a href="#" data-act="editSong" data-id="${s.id}">${esc(songName(s))}</a>
      <span class="hint">${info.confirmed}/${s.sections.length} onaylı${unk ? ` · <b class="bad">${unk} tanınmayan akor</b>` : ''}</span></li>`;
  }).join('');
  const song = songById(SS.editing) || null;
  return `<div class="st-split"><div><h3>Şarkılar</h3>${list ? `<ul class="st-list">${list}</ul>` : '<p class="hint">Henüz şarkı yok.</p>'}</div>
    <div>${song ? songEditor(song, stats) : '<p class="hint">Düzenlemek için soldan bir şarkı seçin.</p>'}</div></div>`;
}
function songEditor(s, stats) {
  const info = stats.songInfo.get(s.id) || { loops: [] };
  const unk = St.unknownSymbols(s);
  const unkBox = unk.length ? `<div class="st-err"><b>Tanınamayan akor sembolleri</b> — düzeltin (N.C. de yazılabilir); düzeltilmeden o bölüm onaylanamaz:
      <table>${unk.map((u) => `<tr><td><code>${esc(u.raw)}</code></td><td class="hint">${esc(u.why)} · ${esc(u.where.join(', '))}</td><td><input type="text" data-fix="${esc(u.raw)}" data-id="${s.id}" placeholder="ör. Gsus4" style="width:110px"></td></tr>`).join('')}</table>
      <button data-act="applyFixes" data-id="${s.id}">Düzeltmeleri uygula</button></div>` : '';
  const fixes = Object.entries(s.fixes || {});
  const loops = info.loops.length ? `<div class="hint">Döngüler: ${info.loops.map((l) => `<b>${esc(l.section)}</b>: ${esc(l.pattern.join(' – '))} ×${l.repeats}`).join(' · ')}</div>` : '';
  return `<div class="st-song">
    <div class="row"><input type="text" value="${esc(s.artist)}" data-act="songField" data-f="artist" data-id="${s.id}" aria-label="sanatçı" style="max-width:220px">
      <input type="text" value="${esc(s.title)}" data-act="songField" data-f="title" data-id="${s.id}" aria-label="şarkı" style="max-width:260px">
      <button data-act="confirmAll" data-id="${s.id}">Tüm seçili tonları onayla</button>
      <button data-act="delSong" data-id="${s.id}" class="danger">Şarkıyı sil</button></div>
    <div class="hint">Kaynak: ${s.source === 'json' ? 'JSON (schema_version 1)' : 'düz metin'} · ${esc(new Date(s.importedAt).toLocaleString())}${fixes.length ? ` · düzeltmeler: ${fixes.map(([a, b]) => `${esc(a)}→${esc(b)}`).join(', ')}` : ''}</div>
    ${s.sourceNotes && (s.sourceNotes.capo != null || s.sourceNotes.tuning || s.sourceNotes.other) ? `<div class="hint">Kaynak notları: ${[s.sourceNotes.capo != null ? `capo ${esc(s.sourceNotes.capo)}` : '', s.sourceNotes.tuning ? `akort: ${esc(s.sourceNotes.tuning)}` : '', s.sourceNotes.other ? esc(s.sourceNotes.other) : ''].filter(Boolean).join(' · ')} <span class="hint">(akorlar kaynaktaki gibi; dereceler göreli olduğu için kapo istatistiği etkilemez)</span></div>` : ''}
    ${s.warnings.length ? `<div class="st-warn"><b>Uyarılar (şarkı):</b> ${s.warnings.map(esc).join(' · ')}</div>` : ''}
    ${loops}${unkBox}
    ${s.sections.map((sec, si) => sectionCard(s, sec, si, unk)).join('')}
  </div>`;
}
function sectionCard(s, sec, si, unk) {
  const key = sec.selected;
  const an = St.analyzeSection(s, sec, key);
  const cmp = St.comparePreview(s, sec, key);
  const bad = new Set(cmp.mismatches.map((m) => m.index));
  const unkRaw = new Set(unk.map((u) => u.raw));
  const blocked = sec.chords.some((c) => unkRaw.has(c));
  const chips = an.items.map((it, i) => {
    const cls = it.unknown ? 'unk' : it.nc ? 'nc' : bad.has(i) ? 'bad' : it.borrowed ? 'borrow' : '';
    const mm = bad.has(i) ? cmp.mismatches.find((m) => m.index === i) : null;
    const pv = mm ? mm.preview : null;
    const title = it.unknown ? 'tanınmadı' : mm ? `uyuşmayan katman: ${mm.layers.join(', ')} — önizleme "${pv}", hesaplanan ${mm.expected}` : it.borrowed ? 'moda ait değil (ödünç)' : it.power ? 'power chord: nitelik belirsiz' : it.sus ? 'sus: nitelik belirsiz' : '';
    return `<span class="chip ${cls}" title="${esc(title)}"><b>${esc(sec.chords[i])}</b><small>${it.unknown ? '?' : it.nc ? '—' : esc(it.label)}${an.hasDur ? `<br>${St.fmtDur(sec.bars[i])} ölçü` : ''}${it.bassLabel ? `<br>bas ${esc(it.bassLabel)}` : ''}${pv ? `<br>önizleme: ${esc(pv)}<br><b>${esc(mm.layers.join('+'))}</b>` : ''}${it.borrowed ? '<br>ödünç' : ''}</small></span>`;
  }).join('');
  const props = sec.proposals.map((p, pi) => `<label class="chk"><input type="radio" name="prop-${s.id}-${si}" data-act="pickProposal" data-click="1" data-id="${s.id}" data-si="${si}" data-pi="${pi}"${St.sameKey(p, key) ? ' checked' : ''}>
      ${esc(St.keyLabel(p))}${p.confidence != null ? ` <span class="hint">${Math.round(p.confidence * 100)}%</span>` : ''}${p.reason ? ` <span class="hint">— ${esc(p.reason)}</span>` : ''}${pi === 0 ? ' <span class="hint">(ilk öneri)</span>' : ''}</label>`).join('');
  let pvTxt;
  if (!cmp.valid) pvTxt = sec.degreesPreview || sec.proposals.some((p) => p.degreesPreview) ? '<span class="hint">degrees_preview: seçili ton önizlemenin tonundan farklı → önizleme geçersiz (karşılaştırılmadı)</span>' : '<span class="hint">degrees_preview yok</span>';
  else if (cmp.mismatches.length) pvTxt = `<span class="bad">degrees_preview ile ${cmp.mismatches.length} uyuşmazlık (kırmızı)</span>`;
  else pvTxt = '<span class="good">degrees_preview ile uyumlu</span>';
  if (cmp.valid && cmp.lengthMismatch) pvTxt += ` <span class="bad">· önizleme ${cmp.previewLength} öğe, akor ${sec.chords.length}</span>`;
  const editing = SS.chordEdit === `${s.id}:${si}`;
  return `<div class="st-sec ${sec.confirmed ? 'ok' : ''}">
    <div class="row"><b>${esc(sec.name)}</b>${sec.type ? ` <span class="tag">${esc(sec.type)}</span>` : ''} ${sec.confirmed ? '<span class="tag ok">onaylı — istatistikte</span>' : '<span class="tag warn">onaysız — istatistiğe girmez</span>'}
      ${an.loop ? `<span class="hint">döngü: ${esc(an.loop.pattern.join(' '))} ×${an.loop.repeats}</span>` : ''}
      <span class="hint">${an.hasDur ? `süre: ${St.fmtDur(sec.bars.reduce((a, b) => a + b, 0))} ölçü` : 'süre bilgisi yok — süre istatistiğine girmez'}</span></div>
    ${editing ? `<div class="row"><input type="text" id="stChordEdit" value="${esc(sec.chords.map((c, i) => (St.sectionHasBars(sec) ? `${c}:${St.fmtDur(sec.bars[i])}` : c)).join(' '))}" style="flex:1" title="süre için akor:ölçü (ör. C#m:2)"><button data-act="saveChords" data-id="${s.id}" data-si="${si}" class="accent">Kaydet</button><button data-act="cancelChords">Vazgeç</button></div>`
      : `<div class="chips">${chips}</div>`}
    <div class="st-keys">
      <div>${props || '<span class="hint">Öneri yok — elle girin.</span>'}</div>
      <div class="row">Elle: ${tonicSel(key ? key.tonic : null, 'secTonic', `data-id="${s.id}" data-si="${si}" style="width:70px"`)} ${modeSel(key ? key.mode : null, 'secMode', `data-id="${s.id}" data-si="${si}" style="width:auto"`)}
        ${sec.confirmed ? `<button data-act="unconfirmSec" data-id="${s.id}" data-si="${si}">Onayı kaldır</button>` : `<button class="accent" data-act="confirmSec" data-id="${s.id}" data-si="${si}"${blocked || !key ? ' disabled title="önce tanınmayan akorları düzeltin"' : ''}>Onayla: ${esc(St.keyLabel(key))}</button>`}
        ${editing ? '' : `<button data-act="editChords" data-id="${s.id}" data-si="${si}">Akorları düzenle</button>`}</div>
    </div>
    <div>${pvTxt}</div>
    ${sec.warnings.length ? `<div class="st-warn"><b>Uyarılar:</b> ${sec.warnings.map(esc).join(' · ')}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- 6) İSTATİSTİK
const SEQ = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
const heat = (v, max) => SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1) + 1e-9))];
const inkOn = (bg) => (SEQ.indexOf(bg) >= 4 ? '#0b0d12' : '#e4e7ee');
const refsAttr = (e) => esc(JSON.stringify(e.refs));
function drillCell(e, title, content, extra = '') {
  return `<td data-act="drill" data-title="${esc(title)}" data-refs="${refsAttr(e)}" class="clk" title="${esc(title)} — tıkla: şarkılar" ${extra}>${content}</td>`;
}
function tabStats() {
  const m = model(), st = m.stats;
  const counts = St.modeSongCounts(st);
  const low = m.settings.lowDataSongs;
  const modes = [St.ALL, ...C.MODE_ORDER.filter((x) => counts[x] > 0)];
  if (!st.byMode.has(SS.statMode)) SS.statMode = St.ALL;
  const mode = SS.statMode;
  const b = st.byMode.get(mode);
  const N = b.songs.size;
  const dmode = mode === St.ALL ? 'major' : mode;
  const lab = (k) => St.coreLabel(k, dmode);
  const chips = modes.map((x) => `<button data-act="statMode" data-m="${x}" class="${x === mode ? 'on' : ''}">${x === St.ALL ? 'Tüm modlar (havuz)' : esc(C.MODES[x].name)} <b>${counts[x]}</b>${x !== St.ALL && counts[x] < low ? ' <span class="tag warn">az veri</span>' : ''}</button>`).join('');
  if (!N) return `<div class="row st-modes">${chips}</div><p class="hint">Onaylı bölüm yok. İstatistik yalnızca onaylanan bölümlerden hesaplanır.</p>`;
  const lowTxt = mode !== St.ALL && N < low ? `<div class="st-warn">⚠ Az veri: bu modda ${N} şarkı (&lt; ${low}). Oranlar güvenilir değil; model havuzdan destek alır.</div>` : '';
  // nitelik
  const qual = ['M', 'm', 'd', 'a', '5'].filter((q) => b.qual.has(q)).map((q) => { const e = b.qual.get(q); return `<span class="role clk" data-act="drill" data-click="1" data-title="${esc(St.QUALITY_NAMES[q])}" data-refs="${refsAttr(e)}">${esc(St.QUALITY_NAMES[q])}: ${e.songs.size} şarkı (${e.occ} tekrar)</span>`; }).join(' ');
  // derece tablosu
  const degs = [...b.degrees].sort((x, y) => y[1].songs.size - x[1].songs.size || St.coreParts(x[0]).iv - St.coreParts(y[0]).iv);
  const topColor = (core) => {
    const cm = b.colors.get(core);
    if (!cm) return '—';
    const arr = [...cm].filter(([c]) => c).sort((x, y) => y[1].songs.size - x[1].songs.size);
    return arr.length ? `${esc(arr[0][0])} <span class="hint">(${arr[0][1].songs.size} şarkı)</span>` : '<span class="hint">yalın</span>';
  };
  const dia = new Set(St.diatonicCores(dmode));
  const degRows = degs.map(([k, e]) => `<tr><td><b>${esc(lab(k))}</b>${mode !== St.ALL && !dia.has(k) ? ' <span class="hint">ödünç</span>' : ''}</td>${drillCell(e, `${lab(k)} derecesi`, e.songs.size)}<td>${pct(e.songs.size, N)}%</td><td class="hint">${e.occ}</td><td>${topColor(k)}</td></tr>`).join('');
  // geçiş matrisi
  const vocab = [...new Set([...b.degrees.keys()])].sort((x, y) => St.coreParts(x).iv - St.coreParts(y).iv || x.localeCompare(y));
  let max = 1;
  for (const e of b.trans.values()) max = Math.max(max, e.songs.size);
  const unsure = 3;
  const matrix = `<table class="heat"><thead><tr><th>önce ↓ / sonra →</th>${vocab.map((v) => `<th>${esc(lab(v))}</th>`).join('')}</tr></thead><tbody>
    ${vocab.map((a) => `<tr><th>${esc(lab(a))}</th>${vocab.map((c) => {
      const e = b.trans.get(`${a}>${c}`);
      if (!e) return `<td class="empty">${a === c ? '·' : ''}</td>`;
      const n = e.songs.size, bg = heat(n, max);
      return drillCell(e, `${lab(a)} → ${lab(c)}: ${n} şarkı (%${pct(n, N)}), ${e.occ} tekrar${n < unsure ? ' — belirsiz (3 şarkıdan az)' : ''}`, `${n}${n < unsure ? '<sup>?</sup>' : ''}`, `style="background:${bg};color:${inkOn(bg)}" class="clk${n < unsure ? ' unsure' : ''}"`);
    }).join('')}</tr>`).join('')}</tbody></table>
    <div class="heat-legend"><span>1</span><span class="bar">${SEQ.map((c) => `<i style="background:${c}"></i>`).join('')}</span><span>${max} şarkı</span>
      <span class="hint">· <sup>?</sup> = 3'ten az şarkıda görüldü (belirsiz) · tekrar sayısı yalnızca ipucunda</span></div>`;
  const top = [...b.trans].sort((x, y) => y[1].songs.size - x[1].songs.size || y[1].occ - x[1].occ).slice(0, 15);
  const topRows = top.map(([k, e]) => { const [a, c] = k.split('>'); return `<tr><td>${esc(lab(a))} → ${esc(lab(c))}${e.songs.size < unsure ? ' <span class="tag warn">belirsiz</span>' : ''}</td>${drillCell(e, `${lab(a)} → ${lab(c)}`, e.songs.size)}<td>${pct(e.songs.size, N)}%</td><td class="hint">${e.occ}</td></tr>`; }).join('');
  const edge = (map, name) => [...map].sort((x, y) => y[1].songs.size - x[1].songs.size).map(([k, e]) => `<tr><td>${esc(lab(k))}</td>${drillCell(e, `${name}: ${lab(k)}`, e.songs.size)}<td>${pct(e.songs.size, N)}%</td></tr>`).join('');
  const shifts = [...st.shifts].sort((x, y) => y[1].songs.size - x[1].songs.size).map(([, e]) => {
    const mt = e.meta, ivs = mt.iv > 6 ? mt.iv - 12 : mt.iv;
    return `<tr><td>${esc(C.MODES[mt.fromMode].name)} → ${esc(C.MODES[mt.toMode].name)}</td><td>${ivs > 0 ? '+' : ''}${ivs} yarım ses</td>${drillCell(e, 'modal kayma', e.songs.size)}</tr>`;
  }).join('');
  const inter = [...st.inter].sort((x, y) => y[1].songs.size - x[1].songs.size).map(([, e]) => {
    const mt = e.meta;
    return `<tr><td>${esc(St.coreLabel(mt.from, mt.fromMode))} <span class="hint">(${esc(C.MODES[mt.fromMode].short)})</span> → ${esc(St.coreLabel(mt.to, mt.toMode))} <span class="hint">(${esc(C.MODES[mt.toMode].short)}, ${mt.iv > 6 ? mt.iv - 12 : mt.iv} yarım ses)</span></td>${drillCell(e, 'bölümler arası geçiş', e.songs.size)}<td class="hint">${e.examples.map((x) => `${x.from.type || x.from.name}: ${St.keyLabel(x.from)} ${x.from.sym} → ${x.to.type || x.to.name}: ${St.keyLabel(x.to)} ${x.to.sym}`).slice(0, 2).map(esc).join('; ')}</td></tr>`;
  }).join('');
  const drill = SS.drill ? `<div id="stDrill" class="st-drill"><b>${esc(SS.drill.title)}</b> — geldiği şarkılar:<ul>${SS.drill.refs.map((r) => `<li>${esc(songName(songById(r.song)))} <span class="hint">· ${esc(r.section)}</span></li>`).join('')}</ul></div>` : '';
  return `<div class="row st-modes">${chips}</div>${lowTxt}
    <p class="hint">Ana istatistik "kaç şarkıda" (şarkı başına en fazla 1); gri sayılar toplam tekrar — yalnızca bilgi, modele girmez. Hücrelere tıklayınca şarkılar listelenir. "?" = nitelik belirsiz (power / sus): kök derecesi. Aynı kökte kalan akorlar (C → Cmaj7, Csus4 → C) geçiş sayılmaz, süreleri birleşir.${mode === St.ALL ? ' Havuz: dereceler iç temsille (merkezden yarım ses + nitelik) sayılır; yazım majör gamına göre.' : ''}</p>
    <div class="row">Nitelik: ${qual}</div>
    ${drill}
    <div class="st-grid2">
      <div><h3>Dereceler (${N} şarkı)</h3><table class="st-t"><thead><tr><th>derece</th><th>şarkı</th><th>%</th><th>tekrar</th><th>en sık renk</th></tr></thead><tbody>${degRows}</tbody></table></div>
      <div><h3>En sık 15 geçiş</h3><table class="st-t"><thead><tr><th>geçiş</th><th>şarkı</th><th>%</th><th>tekrar</th></tr></thead><tbody>${topRows || '<tr><td class="hint">geçiş yok</td></tr>'}</tbody></table></div>
    </div>
    <h3>Geçiş matrisi</h3>${vocab.length ? matrix : ''}
    <div class="st-grid2">
      <div><h3>Açılış (bölümün ilk akoru)</h3><table class="st-t"><tbody>${edge(b.open, 'açılış')}</tbody></table></div>
      <div><h3>Kapanış (bölümün son akoru)</h3><table class="st-t"><tbody>${edge(b.close, 'kapanış')}</tbody></table></div>
    </div>
    <h3>Harmonik ritim <span class="hint">(süre bilgisi olan ${b.durSongs.size} / ${N} şarkı)</span></h3>
    ${b.durSongs.size ? `<div class="st-grid2">
      <div><h4>Akor süresi dağılımı</h4><p class="hint">Bir akorda (core'da) kalma süresi; % = süre bilgisi olan şarkılar içinde.</p>${durTable(b.dur, b.durSongs.size, 'akor süresi')}</div>
      <div><h4>Bölüm başına: kaç ölçüde bir akor değişiyor</h4><p class="hint">bölüm uzunluğu ÷ akor sayısı</p>${durTable(b.rate, b.durSongs.size, 'değişim aralığı')}</div>
    </div>` : '<p class="hint">Bu kapsamda süre bilgisi (JSON "bars") olan onaylı bölüm yok. Bu bölümler değişim istatistiğine girer, süre istatistiğine girmez.</p>'}
    <h3>Bas hareketi <span class="hint">(aynı akor içinde bas değişimi, ör. C → C/B)</span></h3>
    ${b.bassMoves.size ? `<table class="st-t"><thead><tr><th>bas derecesi</th><th>şarkı</th><th>%</th><th>tekrar</th></tr></thead><tbody>${[...b.bassMoves].sort((x, y) => y[1].songs.size - x[1].songs.size).map(([k, e]) => { const [x, y] = k.split('>').map(Number); const t = `${St.romanNumeral(x, dmode)} → ${St.romanNumeral(y, dmode)}`; return `<tr><td>${esc(t)}</td>${drillCell(e, `bas hareketi ${t}`, e.songs.size)}<td>${pct(e.songs.size, N)}%</td><td class="hint">${e.occ}</td></tr>`; }).join('')}</tbody></table>` : '<p class="hint">Aynı akor içinde bas hareketi yok.</p>'}
    <h3>Bölümler arası modal kayma <span class="hint">(tüm modlar)</span></h3>
    <table class="st-t"><thead><tr><th>modlar</th><th>merkez aralığı</th><th>şarkı</th></tr></thead><tbody>${shifts || '<tr><td class="hint">Bölüm geçişi yok (ardışık iki onaylı bölüm gerekir; N.C. sınırında sayılmaz).</td></tr>'}</tbody></table>
    <table class="st-t"><thead><tr><th>son akor → ilk akor</th><th>şarkı</th><th>örnek</th></tr></thead><tbody>${inter}</tbody></table>`;
}

function durTable(map, n, what) {
  let max = 1;
  for (const e of map.values()) max = Math.max(max, e.songs.size);
  return `<table class="st-t"><thead><tr><th>ölçü</th><th>şarkı</th><th>%</th><th>tekrar</th><th></th></tr></thead><tbody>${St.DUR_BINS.map((bin) => {
    const e = map.get(bin);
    const k = e ? e.songs.size : 0;
    return `<tr><td>${St.durLabel(bin)}</td>${e ? drillCell(e, `${what}: ${St.durLabel(bin)} ölçü`, k) : '<td class="hint">0</td>'}<td>${pct(k, n)}%</td><td class="hint">${e ? e.occ : 0}</td><td class="durbar"><i style="width:${Math.round((100 * k) / max)}%"></i></td></tr>`;
  }).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- 7–8) MODEL + GERİ BİLDİRİM
function tabModel() {
  const o = SS.settings;
  const num = (k, label, step, min, max, help) => `<label title="${esc(help)}">${label}<input type="number" data-act="set" data-k="${k}" value="${o[k]}" step="${step}" min="${min}" max="${max}"></label>`;
  const cv = SS.cv ? (SS.cv.ok ? `${SS.cv.warnings.map((w) => `<div class="st-warn">⚠ ${esc(w)}</div>`).join('')}<p>Önerilen: <b>k = ${SS.cv.best.k}, α = ${SS.cv.best.alpha}</b> (geçişler; ortalama log-olabilirlik ${SS.cv.best.meanLL.toFixed(3)}, ${SS.cv.songs} şarkı, bir-şarkı-dışarıda)${SS.cv.bestDur ? ` · <b>α_ritim = ${SS.cv.bestDur.alphaDur}</b> (süreler; ${SS.cv.bestDur.meanLL.toFixed(3)}, ${SS.cv.durSongs} şarkı)` : ''}. <button class="accent" data-act="applyKA">Uygula</button></p>
      <table class="st-t"><thead><tr><th>k</th><th>α</th><th>ort. log-olabilirlik</th></tr></thead><tbody>${SS.cv.table.slice(0, 8).map((r) => `<tr><td>${r.k}</td><td>${r.alpha}</td><td>${r.meanLL.toFixed(3)}</td></tr>`).join('')}</tbody></table>` : `<p class="bad">${esc(SS.cv.reason)}</p>`) : '';
  const fb = model().feedback;
  const adj = [...(fb.counts || new Map())].map(([k, c]) => {
    const [mode, tr] = k.split('|'); const [a, b] = tr.split('>');
    return `<tr><td>${esc(C.MODES[mode] ? C.MODES[mode].short : mode)}</td><td>${esc(St.coreLabel(a, mode))} → ${esc(St.coreLabel(b, mode))}</td><td>👍${c.like} 👎${c.dislike}</td><td>×${fb.mult(mode, a, b).toFixed(3)}</td></tr>`;
  }).join('');
  return `<div class="st-grid2"><div>
      <h3>Model</h3>
      <p class="hint">Akor bulucuda stil iki pay: <b>"değiş mi kal mı"</b> = melodi + politika + harmonik ritim (bu akor n ölçüdür çalıyorken değişme olasılığı; süre verisi yoksa katılmaz) ve <b>"değişirsem hangi akora"</b> = λ·log(P·K), K = moddaki diatonik core sayısı (7).<br>Birinci derece Markov P(sonraki core | önceki core, mod); ikinci derece yalnızca bağlam en az "min bağlam" şarkıda görüldüyse (yoksa birinci dereceye geri dönülür). Kısmi havuzlama P = (n_mod·P_mod + k·P_havuz)/(n_mod + k); moda uygun ama görülmemiş her geçişe α eklenir. Renk ayrı dağılım: P(color | core, mod), aynı havuzlama ve yumuşatma.</p>
      <div class="grid2">
        ${num('k', 'Havuz ağırlığı k', 1, 0, 1000, 'kısmi havuzlama')}
        ${num('alpha', 'Geçiş yumuşatması α (şarkı)', 0.05, 0, 10, 'görülmemiş diatonik geçişe eklenen sanal şarkı sayısı')}
        ${num('alphaDur', 'Ritim yumuşatması α_ritim (şarkı)', 0.05, 0, 10, 'her süre sınıfına eklenen sanal şarkı sayısı')}
        ${num('lambda', 'Geçiş ağırlığı λ ("hangi akora")', 0.25, 0, 10, '0 = saf teori')}
        ${num('lambdaRhythm', 'Ritim ağırlığı λ_ritim ("değiş mi kal mı")', 0.25, 0, 10, '0 = ritim karara katılmaz')}
        ${num('chordTemperature', 'Akor bulucu sıcaklığı', 0.1, 0, 5, '0 = hep en iyisi')}
        ${num('minCtxSongs', 'Min bağlam (2. derece)', 1, 1, 100, 'ikinci derece için gereken şarkı sayısı')}
        ${num('lowDataSongs', '"Az veri" eşiği (şarkı)', 1, 1, 1000, 'bu sayının altındaki modlar uyarılır')}
      </div>
      <label class="chk"><input type="checkbox" data-act="set" data-k="secondOrder"${o.secondOrder ? ' checked' : ''}> İkinci derece Markov (backoff'lu)</label>
      <h3>k ve α öner</h3>
      <p class="hint">Her seferinde bir şarkı dışarıda bırakılır; kalanlarla kurulan model o şarkının geçişlerini ne kadar iyi tahmin ediyor (log-olabilirlik) bakılır. 20 onaylı şarkıdan az veriyle de çalışır ama sonuç güvenilir değildir.</p>
      <button data-act="suggestKA">k ve α öner</button>${cv}
    </div><div>
      <h3>Kişisel geri bildirim katmanı</h3>
      <p class="hint">Şarkı verisinden ayrı tutulur, veri setini değiştirmez. Her beğeni ilgili geçişi ×${St.FB_LIKE}, her beğenmeme ×${St.FB_DISLIKE} ile çarpar; toplam çarpan 0.5 ile 2 arasında sınırlıdır. Beğenilmeyen progresyon (katman açıkken) bir daha önerilmez.</p>
      <label class="chk"><input type="checkbox" data-act="fbOn"${SS.feedback.on ? ' checked' : ''}> Katman açık</label>
      <p>${SS.feedback.events.length} geri bildirim · ${SS.feedback.banned.length} yasaklı progresyon <button data-act="fbReset" class="danger">Sıfırla</button></p>
      ${adj ? `<table class="st-t"><thead><tr><th>mod</th><th>geçiş</th><th>geri bildirim</th><th>çarpan</th></tr></thead><tbody>${adj}</tbody></table>` : '<p class="hint">Henüz ayarlanmış geçiş yok.</p>'}
    </div></div>`;
}

// ---------------------------------------------------------------- 10) PROGRESYON ÖNERİCİ
function dawSectionButtons(target) {
  const d = A.S.d;
  if (!d) return '';
  const secs = d.sections.filter((s) => s.tonic != null && !s.implicit);
  return secs.length ? `<span class="hint">DAW'dan:</span> ${secs.map((s) => `<button data-act="fromDaw" data-target="${target}" data-sec="${s.id}" class="small">${esc(s.name)} (${esc(C.keyName(s.tonic, s.mode))})</button>`).join(' ')}` : '';
}
function runProg() {
  const o = SS.progOpts;
  SS.prog = Object.assign({ opts: Object.assign({}, o) }, St.suggestProgressions(model(), o));
  render();
}
function tabProg() {
  const o = SS.progOpts;
  const P = SS.prog;
  const lab = (k) => St.coreLabel(k, P.opts.mode);
  const items = P ? P.items.map((it, i) => {
    const r = it.rarest;
    const songs = r ? (r.mode.length ? r.mode : r.pool) : [];
    const surprise = r ? `${esc(lab(r.a))} → ${esc(lab(r.b))}${r.loop ? ' (döngü dönüşü)' : ''} · p=${r.p.toFixed(3)} · ${songs.length ? `görüldüğü şarkılar${r.mode.length ? '' : ' (havuz)'}: ${songs.map((id) => esc(songName(songById(id)))).join(', ')}` : '<span class="bad">hiç görülmedi — yalnızca yumuşatmadan</span>'}` : 'değişim yok (tek akor / drone)';
    const total = it.durations.reduce((a, x) => a + x, 0);
    const durInputs = it.symbols.map((sy, j) => `<label class="dur">${esc(sy)} <input type="number" data-act="progDur" data-i="${i}" data-j="${j}" value="${it.durations[j]}" min="0.5" step="0.5" aria-label="${esc(sy)} süresi (ölçü)"></label>`).join('');
    return `<li class="st-prog ${it.fb > 0 ? 'liked' : it.fb < 0 ? 'disliked' : ''}">
      <div class="syms">${esc(it.displaySymbols)}${P.opts.loop ? ' <span class="hint">↻</span>' : ''}</div>
      <div class="degs">${esc(it.display)}</div>
      <div class="hint">toplam ${St.fmtDur(total)} ölçü${it.edited ? ' (süreler elle değiştirildi)' : ''} · toplam olasılık ${it.prob.toExponential(2)} (log: değişim ${it.logPHarm.toFixed(2)} + süre ${it.logPDur.toFixed(2)})</div>
      <div class="hint">Sürpriz noktası: ${surprise}</div>
      <div class="row durs"><span class="hint">Süreler (ölçü):</span> ${durInputs}</div>
      <div class="row"><button data-act="playProg" data-i="${i}">▶ Çal</button><button data-act="stopProg">■</button>
        <button data-act="fbProg" data-v="1" data-i="${i}" title="beğen">👍</button><button data-act="fbProg" data-v="-1" data-i="${i}" title="beğenme — bir daha önerilmez">👎</button>
        <span class="hint">Zaman çizelgesine yerleştir: ölçü</span><input type="number" id="stPlace${i}" min="1" value="1" style="width:60px"><button data-act="placeProg" data-i="${i}">Yerleştir</button></div></li>`;
  }).join('') : '';
  const trFrom = SS.trFrom || { tonic: 1, mode: 'phrygian' }, trTo = SS.trTo || { tonic: 11, mode: 'dorian' };
  const tr = SS.trans;
  const trRes = tr ? (tr.res.items.length ? `<p class="hint">Dayanak: ${esc(tr.res.basis)}</p><ul class="st-list">${tr.res.items.map((it, i) => `<li><b>${esc(it.from.symbol)}</b> <span class="hint">(${esc(it.from.label)} · ${esc(St.keyLabel(tr.from))})</span> → <b>${esc(it.to.symbol)}</b> <span class="hint">(${esc(it.to.label)} · ${esc(St.keyLabel(tr.to))})</span>
      · ${it.songs.length} şarkı${it.pivot ? ` · ${it.pivot} ortak nota` : ''} <button data-act="playTrans" data-i="${i}" class="small">▶</button>
      <div class="hint">${it.songs.map((id) => esc(songName(songById(id)))).join(', ')}</div></li>`).join('')}</ul>` : '<p class="hint">Veride bölüm geçişi yok.</p>') : '';
  return `<div class="st-grid2"><div>
      <h3>Melodisiz progresyon önerici</h3>
      <div class="row">${tonicSel(o.tonic, 'prog', 'data-k="tonic" style="width:70px"')} ${modeSel(o.mode, 'prog', 'data-k="mode" style="width:auto"')} ${dawSectionButtons('prog')}</div>
      <div class="grid2">
        <label title="Kaç farklı akor (değişim) — 1 = tek akorda kalma / drone">Değişim sayısı (akor)<input type="number" data-act="prog" data-k="changes" value="${o.changes}" min="1" max="32"></label>
        <label title="Değişimlerin süreleri süre dağılımından seçilip bu toplama oturtulur">Toplam uzunluk (ölçü)<input type="number" data-act="prog" data-k="bars" value="${o.bars}" min="0.5" max="128" step="0.5"></label>
        <label>Kapanış<select data-act="prog" data-k="ending"><option value="home"${o.ending === 'home' ? ' selected' : ''}>eve dön</option><option value="open"${o.ending === 'open' ? ' selected' : ''}>açık bırak</option><option value="data"${o.ending === 'data' ? ' selected' : ''}>verideki kapanış dağılımı</option></select></label>
        <label>Sıcaklık (0 = en olası)<input type="number" data-act="prog" data-k="temperature" value="${o.temperature}" min="0" max="5" step="0.1"></label>
        <label>Kaç öneri<input type="number" data-act="prog" data-k="count" value="${o.count}" min="1" max="20"></label>
        <label>Tohum<input type="number" data-act="prog" data-k="seed" value="${o.seed}" min="1"></label>
        <label class="chk"><input type="checkbox" data-act="prog" data-k="loop"${o.loop ? ' checked' : ''}> Döngü (son akor başa bağlanır)</label>
      </div>
      <button class="accent" data-act="runProg">Öner</button>
      ${P ? P.warnings.map((w) => `<div class="st-warn">⚠ ${esc(w)}</div>`).join('') : ''}
      ${P ? `<p class="hint">${esc(St.keyLabel(P.opts))} · ev akoru ${esc(lab(P.home))} · ${P.opts.changes} akor, ${St.fmtDur(P.opts.bars)} ölçü${P.opts.loop ? ', döngü' : ''} · süre verisi: bu modda ${P.nd}, havuzda ${P.ndAll} şarkı</p><ol class="st-progs">${items}</ol>` : ''}
    </div><div>
      <h3>İki bölüm arası geçiş</h3>
      <p class="hint">Verideki bölümler arası geçişlerden (bir bölümün son akoru → sonrakinin ilk akoru) aynı mod çiftine ve merkez aralığına göre öneri.</p>
      <div class="row">Önceki bölüm: ${tonicSel(trFrom.tonic, 'noop', 'id="stTrFromT" style="width:70px"')} ${modeSel(trFrom.mode, 'noop', 'id="stTrFromM" style="width:auto"')}</div>
      <div class="row">${dawSectionButtons('from')}</div>
      <div class="row">Sonraki bölüm: ${tonicSel(trTo.tonic, 'noop', 'id="stTrToT" style="width:70px"')} ${modeSel(trTo.mode, 'noop', 'id="stTrToM" style="width:auto"')}</div>
      <div class="row">${dawSectionButtons('to')}</div>
      <button data-act="runTrans">Geçiş akoru öner</button>
      ${trRes}
    </div></div>`;
}

// ---------------------------------------------------------------- 11) SAKLAMA
function tabStore() {
  const box = (k, title, desc) => `<div class="st-store"><h4>${title}</h4><p class="hint">${desc}</p>
    <button data-act="exp" data-k="${k}">Dışa aktar (.json)</button>
    <label class="file-btn">İçe aktar<input type="file" data-act="imp" data-k="${k}" accept=".json,application/json" hidden></label></div>`;
  return `<p class="hint">Üç ayrı dosya. Tarayıcıda da otomatik saklanır (bu tarayıcıya özel).</p>
    <div class="st-grid3">
      ${box('dataset', 'Veri seti', `Şarkılar, bölümler, düzeltmeler ve onaylar (${SS.dataset.songs.length} şarkı).`)}
      ${box('settings', 'Model ayarları', `k=${SS.settings.k}, α=${SS.settings.alpha}, λ=${SS.settings.lambda}…`)}
      ${box('feedback', 'Geri bildirim katmanı', `${SS.feedback.events.length} geri bildirim, ${SS.feedback.banned.length} yasaklı progresyon.`)}
    </div>
    <p><button data-act="clearAll" class="danger">Tüm şarkıları sil</button></p>`;
}

// ---------------------------------------------------------------- DAW paneli (λ, sıcaklık) + kancalar
function renderDawBox() {
  const n = confirmedSongs();
  $('#styleInfo').textContent = n ? `${n} şarkıdan model · k=${SS.settings.k}, α=${SS.settings.alpha}${SS.feedback.on && SS.feedback.events.length ? ` · ${SS.feedback.events.length} geri bildirim` : ''}` : 'Onaylı stil verisi yok — akor bulucu saf teoriyle çalışıyor.';
  $('#inLambda').value = SS.settings.lambda; $('#outLambda').textContent = SS.settings.lambda;
  $('#inLambdaR').value = SS.settings.lambdaRhythm; $('#outLambdaR').textContent = SS.settings.lambdaRhythm;
  $('#inChordTemp').value = SS.settings.chordTemperature; $('#outChordTemp').textContent = SS.settings.chordTemperature;
}
$('#inLambda').addEventListener('input', (e) => { SS.settings.lambda = +e.target.value; $('#outLambda').textContent = e.target.value; persist(); A.refresh(); });
$('#inLambdaR').addEventListener('input', (e) => { SS.settings.lambdaRhythm = +e.target.value; $('#outLambdaR').textContent = e.target.value; persist(); A.refresh(); });
$('#inChordTemp').addEventListener('input', (e) => { SS.settings.chordTemperature = +e.target.value; $('#outChordTemp').textContent = e.target.value; persist(); A.refresh(); });
$('#btnReseed').onclick = () => { SS.settings.seed = (SS.settings.seed || 1) + 1; persist(); A.refresh(); A.status(`Yeniden örneklendi (tohum ${SS.settings.seed}).`); };

window.StyleUI = {
  // akor bulucuya stil puanlayıcı: veri yoksa ya da λ = 0 ise null (saf teori, davranış birebir aynı)
  scorer() {
    if ((!SS.settings.lambda && !SS.settings.lambdaRhythm) || !confirmedSongs()) return null;
    return St.makeStyleScorer(model(), { lambda: SS.settings.lambda, lambdaRhythm: SS.settings.lambdaRhythm, temperature: SS.settings.chordTemperature, seed: SS.settings.seed });
  },
  feedbackChord(prev, chord, sec, like) {
    const to = St.chordToCore(chord, sec.tonic, sec.mode).core;
    const from = prev ? St.chordToCore(prev, sec.tonic, sec.mode).core : '^';
    if (from === to) { A.status('Önceki akorla aynı core — geçiş yok.', 'err'); return; }
    SS.feedback.events.push({ t: Date.now(), kind: 'chord', mode: sec.mode, transitions: [[from, to]], like });
    A.status(`${like > 0 ? 'Beğenildi' : 'Beğenilmedi'}: ${St.coreLabel(from, sec.mode)} → ${St.coreLabel(to, sec.mode)} (${St.modeName(sec.mode)}) — çarpan ×${St.buildModel(SS.dataset, SS.settings, SS.feedback).feedback.mult(sec.mode, from, to).toFixed(2)}`);
    SS.model = null; persist(); A.refresh(); renderDawBox();
  },
  state: SS, setView, render, doImport, model,
};
renderDawBox();
A.refresh();
})();

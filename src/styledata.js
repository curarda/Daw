/* =====================================================================
   STİL VERİSİ VE ÖNERİ — DOM'dan bağımsız (Node testleri de kullanır).
   Şarkı akor verisi → derece istatistiği → Markov modeli → öneri.
   Temel sayım birimi ŞARKIDIR: her derece/geçiş/açılış/kapanış bir şarkıda
   en fazla 1 kez sayılır; toplam tekrar sayısı yalnızca bilgi amaçlıdır.
   ===================================================================== */
(function (root) {
'use strict';
const C = root.Core;
const { mod12, MODES, MODE_ORDER, scalePcs, parsePc, pcName, keyUsesFlats } = C;

// ---------------------------------------------------------------- akor sembolü
// tq (core niteliği): M majör, m minör, d dim, a aug, 5 power (belirsiz), s sus (moddan çıkarılır)
const SUFFIX = {
  '': ['M', ''], 'M': ['M', ''], 'maj': ['M', ''], 'major': ['M', ''],
  'm': ['m', ''], 'min': ['m', ''], '-': ['m', ''], 'minor': ['m', ''],
  '5': ['5', ''], 'no3': ['5', ''],
  'dim': ['d', ''], '°': ['d', ''], 'o': ['d', ''],
  'aug': ['a', ''], '+': ['a', ''], '#5': ['a', ''], '+5': ['a', ''],
  '7': ['M', '7'], 'dom7': ['M', '7'],
  'maj7': ['M', 'maj7'], 'M7': ['M', 'maj7'], 'ma7': ['M', 'maj7'], 'Maj7': ['M', 'maj7'], 'j7': ['M', 'maj7'],
  'm7': ['m', '7'], 'min7': ['m', '7'], '-7': ['m', '7'],
  'mmaj7': ['m', 'maj7'], 'mMaj7': ['m', 'maj7'], 'mM7': ['m', 'maj7'], 'minmaj7': ['m', 'maj7'], '-maj7': ['m', 'maj7'],
  '6': ['M', '6'], 'm6': ['m', '6'], '-6': ['m', '6'], '69': ['M', '6/9'], '6/9': ['M', '6/9'], 'm69': ['m', '6/9'], 'm6/9': ['m', '6/9'],
  '9': ['M', '9'], 'maj9': ['M', 'maj9'], 'M9': ['M', 'maj9'], 'm9': ['m', '9'], 'min9': ['m', '9'], 'mmaj9': ['m', 'maj9'],
  '11': ['M', '11'], 'm11': ['m', '11'], 'maj11': ['M', 'maj11'],
  '13': ['M', '13'], 'maj13': ['M', 'maj13'], 'm13': ['m', '13'],
  'add9': ['M', 'add9'], 'add2': ['M', 'add9'], '2': ['M', 'add9'],
  'madd9': ['m', 'add9'], 'madd2': ['m', 'add9'], 'm2': ['m', 'add9'],
  'add11': ['M', 'add11'], 'add4': ['M', 'add11'], 'madd11': ['m', 'add11'], 'madd4': ['m', 'add11'],
  'sus2': ['s', 'sus2'], 'sus4': ['s', 'sus4'], 'sus': ['s', 'sus4'],
  '7sus4': ['s', '7sus4'], '7sus': ['s', '7sus4'], '9sus4': ['s', '9sus4'], '9sus': ['s', '9sus4'], '7sus2': ['s', '7sus2'], 'sus2sus4': ['s', 'sus2sus4'], 'sus24': ['s', 'sus2sus4'],
  'dim7': ['d', '°7'], '°7': ['d', '°7'], 'o7': ['d', '°7'],
  'm7b5': ['d', 'ø7'], 'ø': ['d', 'ø7'], 'ø7': ['d', 'ø7'], 'm7-5': ['d', 'ø7'], 'min7b5': ['d', 'ø7'], '-7b5': ['d', 'ø7'],
  '7b9': ['M', '7b9'], '7#9': ['M', '7#9'], '7b5': ['M', '7b5'], '7#11': ['M', '7#11'], '7b13': ['M', '7b13'], '7alt': ['M', '7alt'], '9#11': ['M', '9#11'], '13b9': ['M', '13b9'],
  'aug7': ['a', '7'], '+7': ['a', '7'], '7#5': ['a', '7'], '7+5': ['a', '7'], '7+': ['a', '7'],
  'augmaj7': ['a', 'maj7'], '+maj7': ['a', 'maj7'], 'maj7#5': ['a', 'maj7'],
  'maj7#11': ['M', 'maj7#11'], 'maj9#11': ['M', 'maj9#11'],
};
const NC_RE = /^(n\.?\s*c\.?|no\s*chord)$/i;
function normSuffix(s) {
  return s.replace(/\s+/g, '').replace(/[()]/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/−/g, '-')
    .replace(/^Δ7?/, 'maj7').replace(/^min(?=maj)/, 'm');
}
// Sembol → { ok, nc, repeat, root, bass, tq, color, sym } ; tanınmazsa { ok:false }
function parseSymbol(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { ok: false, raw: s, why: 'boş' };
  if (NC_RE.test(s)) return { ok: true, nc: true, sym: 'N.C.', raw: s };
  if (s === '%' || s === '/' || s === '-') return { ok: true, repeat: true, sym: '%', raw: s };
  const r = /^([A-Ga-g])([#b♯♭]?)/.exec(s);
  if (!r) return { ok: false, raw: s, why: 'kök nota yok' };
  const rootPc = parsePc(r[0]).pc;
  let rest = s.slice(r[0].length);
  let bass = null;
  const bm = /\/\s*([A-Ga-g][#b♯♭]?)\s*$/.exec(rest);
  if (bm) { bass = parsePc(bm[1]).pc; rest = rest.slice(0, bm.index); }
  const suf = normSuffix(rest);
  const hit = SUFFIX[suf];
  if (!hit) return { ok: false, raw: s, why: `tanınmayan ek "${rest}"` };
  return { ok: true, root: rootPc, bass: bass === rootPc ? null : bass, tq: hit[0], color: hit[1], sym: s, raw: s };
}

// ---------------------------------------------------------------- mod adları
const MODE_ALIASES = {
  major: 'major', ionian: 'major', majör: 'major', majr: 'major', iyonyen: 'major', maj: 'major',
  minor: 'minor', aeolian: 'minor', naturalminor: 'minor', minör: 'minor', eolyen: 'minor', doğalminör: 'minor', dogalminor: 'minor', min: 'minor',
  harmonicminor: 'harmonicMinor', harmonikminör: 'harmonicMinor', harmonikminor: 'harmonicMinor',
  dorian: 'dorian', dor: 'dorian',
  phrygian: 'phrygian', frig: 'phrygian', frigyen: 'phrygian', phryg: 'phrygian',
  lydian: 'lydian', lidya: 'lydian', lidyen: 'lydian',
  mixolydian: 'mixolydian', miksolidya: 'mixolydian', miksolidyen: 'mixolydian', mixo: 'mixolydian',
  locrian: 'locrian', lokriyen: 'locrian',
  majorpentatonic: 'majorPent', pentatonicmajor: 'majorPent', majörpentatonik: 'majorPent', majorpent: 'majorPent', majörpent: 'majorPent',
  minorpentatonic: 'minorPent', pentatonicminor: 'minorPent', minörpentatonik: 'minorPent', minorpent: 'minorPent', minörpent: 'minorPent',
};
function parseMode(s) {
  if (s == null) return null;
  if (MODES[s]) return s;
  const k = String(s).toLocaleLowerCase('tr').replace(/[^a-zçğıöşü]/g, '').replace(/ı/g, 'i');
  return MODE_ALIASES[k] || MODE_ALIASES[k.replace(/i/g, 'ı')] || null;
}
// "C# phrygian", "B Dorian", "C#m" (→ minör), "A" (→ majör)
function parseKeyText(s) {
  const t = String(s || '').trim();
  const r = parsePc(t);
  if (!r) return null;
  let rest = t.slice(r.len).trim();
  if (rest === '' || rest === 'M') return { tonic: r.pc, mode: 'major' };
  if (rest === 'm') return { tonic: r.pc, mode: 'minor' };
  const mode = parseMode(rest);
  return mode ? { tonic: r.pc, mode } : null;
}
const modeName = (m) => (MODES[m] ? MODES[m].short : m);
const keyLabel = (k) => (k ? `${pcName(k.tonic, keyUsesFlats(k.tonic, k.mode))} ${modeName(k.mode)}` : '—');
const sameKey = (a, b) => !!a && !!b && a.tonic === b.tonic && a.mode === b.mode;

// ---------------------------------------------------------------- dereceler
const ROMAN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const MAJOR_IV = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
const heptaOf = (mode) => MODES[mode].hepta || mode;
const TQ_IV = { M: [0, 4, 7], m: [0, 3, 7], d: [0, 3, 6], a: [0, 4, 8], 5: [0, 7] };
// Romen rakamı merkezin MAJÖR gamına göre; büyük harf majör, küçük minör, ° dim, + aug, 5 power (belirsiz)
function romanOf(iv, tq, mode) {
  let r = ROMAN[mod12(iv)];
  if (iv === 6 && mode === 'lydian') r = '♯IV';
  const acc = /^[♭♯]/.test(r) ? r[0] : '';
  let num = acc ? r.slice(1) : r;
  if (tq === 'm' || tq === 'd') num = num.toLowerCase();
  return acc + num + (tq === 'd' ? '°' : tq === 'a' ? '+' : tq === '5' ? '5' : '');
}
const coreKey = (iv, tq) => `${mod12(iv)}${tq}`;
function coreParts(key) { const m = /^(\d+)(.)$/.exec(key); return { iv: +m[1], tq: m[2] }; }
const coreLabel = (key, mode) => { if (key === '^') return 'başlangıç'; const p = coreParts(key); return romanOf(p.iv, p.tq, mode); };
// core + renk eki: "IVmaj7", "vø7" (yarım dim), "vii°7"
function degreeLabel(core, color, mode) {
  const lab = coreLabel(core, mode);
  if (color === 'ø7' || color === '°7') return lab.replace('°', '') + color;
  return lab + (color || '');
}
// eşitlikte (kayan nokta toleransıyla) öndeki anahtarı — düz triad'ı ('') — tercih et
function argmaxKey(dist) {
  let best = null, bv = -Infinity;
  for (const [k, v] of dist) if (v > bv + 1e-9 || (Math.abs(v - bv) <= 1e-9 && k === '')) { best = k; bv = Math.max(bv, v); }
  return best;
}
function parseRoman(s) {
  const t = String(s || '').trim();
  if (NC_RE.test(t)) return { nc: true };
  const m = /^([♭b#♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|o|ø|\+|5)?/.exec(t);
  if (!m) return null;
  const up = m[2] === m[2].toUpperCase();
  const iv = mod12(MAJOR_IV[m[2].toUpperCase()] + (/[b♭]/.test(m[1]) ? -1 : /[#♯]/.test(m[1]) ? 1 : 0));
  const tq = m[3] === '5' ? '5' : m[3] === '+' ? 'a' : m[3] ? 'd' : up ? 'M' : 'm';
  return { iv, tq };
}
// sus akorunun core niteliği: moddaki diatonik üçlüden çıkarılır (yoksa majör)
function susQuality(ivRoot, tonic, mode) {
  const pcs = scalePcs(tonic, heptaOf(mode));
  const r = mod12(tonic + ivRoot);
  if (pcs.includes(mod12(r + 3)) && !pcs.includes(mod12(r + 4))) return 'm';
  return 'M';
}
const SUS_TONES = { sus2: [2], sus4: [5], '7sus4': [5, 10], '9sus4': [5, 10, 2], '7sus2': [2, 10], sus2sus4: [2, 5] };
// Tek akorun derece analizi (üç katman: core, color, bass)
function analyzeChord(p, tonic, mode) {
  if (!p || !p.ok) return { unknown: true };
  if (p.nc) return { nc: true, sym: 'N.C.' };
  const iv = mod12(p.root - tonic);
  let tq = p.tq, susTones = null;
  if (tq === 's') { tq = susQuality(iv, tonic, mode); susTones = SUS_TONES[p.color] || [5]; }
  const pcsScale = scalePcs(tonic, heptaOf(mode));
  const corePcs = susTones ? [0, 7, ...susTones.filter((x) => x !== 10)] : TQ_IV[tq];
  const borrowed = !corePcs.every((i) => pcsScale.includes(mod12(p.root + i)));
  const bassIv = p.bass == null ? null : mod12(p.bass - tonic);
  return {
    sym: p.sym, root: p.root, iv, tq, color: p.color, core: coreKey(iv, tq), bassIv, borrowed,
    power: tq === '5', label: degreeLabel(coreKey(iv, tq), p.color, mode),
    bassLabel: bassIv == null ? null : ROMAN[bassIv],
    ident: `${p.root}|${tq}|${p.color}|${p.bass}`,
  };
}
const QUALITY_NAMES = { M: 'majör', m: 'minör', d: 'dim', a: 'aug', 5: 'belirsiz (power)' };

// ---------------------------------------------------------------- şema doğrulama (schema_version 1)
function validateSongJson(obj, path = '') {
  const errs = [];
  const P = (k) => (path ? `${path}.${k}` : k);
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errs.push(`${path || 'kök'}: nesne olmalı`); return errs; }
  if (!isStr(obj.artist)) errs.push(`${P('artist')}: boş olmayan metin olmalı`);
  if (!isStr(obj.title)) errs.push(`${P('title')}: boş olmayan metin olmalı`);
  if (obj.warnings != null && !(Array.isArray(obj.warnings) && obj.warnings.every((w) => typeof w === 'string'))) errs.push(`${P('warnings')}: metin dizisi olmalı`);
  if (!Array.isArray(obj.sections) || !obj.sections.length) { errs.push(`${P('sections')}: boş olmayan dizi olmalı`); return errs; }
  obj.sections.forEach((s, i) => {
    const sp = `${P('sections')}[${i}]`;
    if (!s || typeof s !== 'object') { errs.push(`${sp}: nesne olmalı`); return; }
    if (!isStr(s.name)) errs.push(`${sp}.name: boş olmayan metin olmalı`);
    if (!Array.isArray(s.chords) || !s.chords.length) errs.push(`${sp}.chords: boş olmayan dizi olmalı`);
    else s.chords.forEach((c, j) => { if (typeof c !== 'string' || !c.trim()) errs.push(`${sp}.chords[${j}]: boş olmayan metin olmalı (${JSON.stringify(c)})`); });
    if (s.key_proposals != null) {
      if (!Array.isArray(s.key_proposals)) errs.push(`${sp}.key_proposals: dizi olmalı`);
      else s.key_proposals.forEach((k, j) => {
        const kp = `${sp}.key_proposals[${j}]`;
        if (!k || typeof k !== 'object') { errs.push(`${kp}: nesne olmalı`); return; }
        if (k.key != null && k.tonic == null) { if (!parseKeyText(k.key)) errs.push(`${kp}.key: tanınmayan ton "${k.key}"`); }
        else {
          if (!parsePc(String(k.tonic ?? ''))) errs.push(`${kp}.tonic: tanınmayan merkez nota ${JSON.stringify(k.tonic)}`);
          if (!parseMode(k.mode)) errs.push(`${kp}.mode: tanınmayan mod ${JSON.stringify(k.mode)}`);
        }
        if (k.confidence != null && !(typeof k.confidence === 'number' && k.confidence >= 0 && k.confidence <= 1)) errs.push(`${kp}.confidence: 0–1 arası sayı olmalı`);
        if (k.degrees_preview != null && !(Array.isArray(k.degrees_preview) && k.degrees_preview.every((d) => typeof d === 'string'))) errs.push(`${kp}.degrees_preview: metin dizisi olmalı`);
      });
    }
    if (s.degrees_preview != null && !(Array.isArray(s.degrees_preview) && s.degrees_preview.every((d) => typeof d === 'string'))) errs.push(`${sp}.degrees_preview: metin dizisi olmalı`);
    // isteğe bağlı: her akorun süresi (ölçü), chords ile aynı uzunlukta
    if (s.bars != null) {
      if (!Array.isArray(s.bars)) errs.push(`${sp}.bars: sayı dizisi olmalı`);
      else {
        if (Array.isArray(s.chords) && s.bars.length !== s.chords.length) errs.push(`${sp}.bars: chords ile aynı uzunlukta olmalı (${s.bars.length} ≠ ${s.chords.length})`);
        s.bars.forEach((b, j) => { if (!(typeof b === 'number' && Number.isFinite(b) && b > 0)) errs.push(`${sp}.bars[${j}]: pozitif sayı olmalı (${JSON.stringify(b)})`); });
      }
    }
    if (s.warnings != null && !(Array.isArray(s.warnings) && s.warnings.every((w) => typeof w === 'string'))) errs.push(`${sp}.warnings: metin dizisi olmalı`);
  });
  return errs;
}
// JSON metni → { songs:[kayıt], errors:[yol: mesaj] }
function parseImportJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { songs: [], errors: [`JSON sözdizimi: ${e.message}`] }; }
  const errors = [];
  if (!obj || typeof obj !== 'object') return { songs: [], errors: ['kök: nesne olmalı'] };
  if (obj.schema_version !== 1) errors.push(`schema_version: 1 olmalı (${JSON.stringify(obj.schema_version)} geldi)`);
  const list = Array.isArray(obj.songs) ? obj.songs : [obj];
  if (Array.isArray(obj.songs) && !obj.songs.length) errors.push('songs: boş olmayan dizi olmalı');
  list.forEach((s, i) => errors.push(...validateSongJson(s, Array.isArray(obj.songs) ? `songs[${i}]` : '')));
  if (errors.length) return { songs: [], errors };
  return { songs: list.map((s) => songFromJson(s)), errors: [] };
}
function proposalFrom(k) {
  const kk = k.tonic == null && k.key != null ? parseKeyText(k.key) : { tonic: parsePc(String(k.tonic)).pc, mode: parseMode(k.mode) };
  return { tonic: kk.tonic, mode: kk.mode, confidence: k.confidence ?? null, reason: k.reason ?? k.rationale ?? null, degreesPreview: k.degrees_preview || null };
}
function songFromJson(o) {
  return {
    id: newId(), artist: o.artist.trim(), title: o.title.trim(), source: 'json', importedAt: new Date().toISOString(),
    warnings: o.warnings || [], fixes: {},
    sections: o.sections.map((s) => {
      const proposals = (s.key_proposals || []).map(proposalFrom);
      return {
        name: s.name.trim(), chords: s.chords.map((c) => c.trim()), bars: s.bars ? s.bars.slice() : null, proposals,
        degreesPreview: s.degrees_preview || null, warnings: s.warnings || [],
        selected: proposals[0] ? { tonic: proposals[0].tonic, mode: proposals[0].mode } : null, confirmed: false,
      };
    }),
  };
}
// Yedek düz metin: başlık satırları + "[Verse] C#m D ..." ya da DAW'ın akor şeması
function parseImportText(text, meta = {}) {
  const errors = [];
  let artist = meta.artist || '', title = meta.title || '';
  const sections = [];
  let cur = null;
  text.split(/\r?\n/).forEach((line, li) => {
    const l = line.trim();
    if (!l) return;
    const hm = /^(sanatçı|sanatci|artist|şarkı|sarki|title|başlık|baslik)\s*:\s*(.+)$/i.exec(l);
    if (hm) { if (/sanat|artist/i.test(hm[1])) artist = hm[2].trim(); else title = hm[2].trim(); return; }
    if (/^tempo\s*:/i.test(l)) return;
    const sm = /^\[([^\]]+)\]\s*(.*)$/.exec(l);
    let body = l;
    if (sm) {
      const inner = sm[1].split(/[:|]/);
      cur = { name: inner[0].trim(), chords: [], durs: [], proposals: [], degreesPreview: null, warnings: [], selected: null, confirmed: false };
      // anahtar: "[Chorus: B dorian]" ya da başlıktan sonra mod adıyla "B Dorian — ölçü 5–8"
      // (başlıktan sonraki "A" / "C#m" tek başına akordur, ton sayılmaz)
      let k = inner[1] ? parseKeyText(inner[1].replace(/\(öneri\)/, '').trim()) : null;
      if (!k) {
        const tail = (/^(.*?)(?:\s*[—-]\s*ölçü.*)?$/.exec(sm[2]) || [])[1] || '';
        const pk = parsePc(tail.trim());
        const rest = pk ? tail.trim().slice(pk.len).replace(/\(öneri\)/, '').trim() : '';
        if (pk && rest.length > 1 && parseMode(rest)) { k = { tonic: pk.pc, mode: parseMode(rest) }; body = ''; }
        else body = sm[2];
      } else body = sm[2];
      if (k) { cur.proposals.push({ tonic: k.tonic, mode: k.mode, confidence: null, reason: 'metin başlığından', degreesPreview: null }); cur.selected = { tonic: k.tonic, mode: k.mode }; }
      if (/^\s*[—-]\s*ölçü/.test(body)) body = '';
      sections.push(cur);
    }
    if (!body) return;
    if (!cur) { cur = { name: 'Bölüm', chords: [], durs: [], proposals: [], degreesPreview: null, warnings: [], selected: null, confirmed: false }; sections.push(cur); }
    const push = (tok, dflt) => {
      const m = /^(.+?):(\d+(?:[.,]\d+)?)$/.exec(tok);
      cur.chords.push(m ? m[1] : tok);
      cur.durs.push(m ? parseFloat(m[2].replace(',', '.')) : dflt);
    };
    if (body.includes('|')) { // ölçü çizgileri: her hücre 1 ölçü, içindeki akorlara eşit bölünür
      for (const cell of body.split('|').map((x) => x.trim()).filter(Boolean)) {
        const toks = cell.split(/\s+/).filter(Boolean);
        for (const t of toks) push(t, 1 / toks.length);
      }
    } else for (const tok of body.split(/\s+/)) if (tok) push(tok, null);
    void li;
  });
  for (const sec of sections) {
    const durs = sec.durs || [];
    delete sec.durs;
    sec.bars = durs.length && durs.every((d) => d > 0) ? durs : null;
    if (!sec.bars && durs.some((d) => d > 0)) sec.warnings.push('Süre bilgisi yalnızca bazı akorlarda var — bölüm süre istatistiğine girmez.');
  }
  if (!artist.trim()) errors.push('artist: sanatçı adı gerekli (başlık satırı "Sanatçı: …" ya da form alanı)');
  if (!title.trim()) errors.push('title: şarkı adı gerekli (başlık satırı "Şarkı: …" ya da form alanı)');
  if (!sections.length) errors.push('sections: en az bir "[Bölüm] akorlar" satırı gerekli');
  sections.forEach((s, i) => { if (!s.chords.length) errors.push(`sections[${i}] (${s.name}): akor yok`); });
  if (errors.length) return { songs: [], errors };
  return { songs: [{ id: newId(), artist: artist.trim(), title: title.trim(), source: 'text', importedAt: new Date().toISOString(), warnings: [], fixes: {}, sections }], errors: [] };
}
let idCounter = 0;
function newId() { idCounter++; return 'song-' + Date.now().toString(36) + '-' + idCounter.toString(36) + Math.random().toString(36).slice(2, 5); }
const normText = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ığüşöç]+/g, ' ').trim();
const songKey = (s) => `${normText(s.artist)}|${normText(s.title)}`;
function findDuplicate(dataset, song) { return dataset.songs.find((x) => x.id !== song.id && songKey(x) === songKey(song)) || null; }

// ---------------------------------------------------------------- bölüm analizi
// Düzeltilmiş semboller (song.fixes) uygulanır; "%" önceki akoru tekrarlar.
function sectionSymbols(song, sec) { return sec.chords.map((c) => (song.fixes && song.fixes[c] != null ? song.fixes[c] : c)); }
function unknownSymbols(song) {
  const out = new Map();
  song.sections.forEach((sec, si) => sectionSymbols(song, sec).forEach((c, ci) => {
    const p = parseSymbol(c);
    if (!p.ok) { const raw = sec.chords[ci]; if (!out.has(raw)) out.set(raw, { raw, why: p.why, where: [] }); out.get(raw).where.push(`${sec.name} #${ci + 1}`); void si; }
  }));
  return [...out.values()];
}
function analyzeSection(song, sec, key) {
  const syms = sectionSymbols(song, sec);
  const items = [];
  let prev = null;
  for (const s of syms) {
    let p = parseSymbol(s);
    if (p.ok && p.repeat) p = prev || { ok: true, nc: true, sym: 'N.C.' };
    items.push(key ? analyzeChord(p, key.tonic, key.mode) : (p.ok ? { sym: p.sym, nc: !!p.nc } : { unknown: true }));
    if (p.ok && !p.nc) prev = p;
    if (p.ok && p.nc) prev = null;
  }
  const unknown = items.some((x) => x.unknown);
  const hasDur = sectionHasBars(sec);
  if (hasDur) items.forEach((it, i) => { it.dur = sec.bars[i]; });
  // harmonik ritim: aynı core'da kalma süresi (C → Cmaj7 tek akor sayılır); N.C. süresi sayılmaz
  const durRuns = [];
  if (hasDur) {
    let run = [];
    for (const it of items) {
      if (it.unknown) continue;
      if (it.nc) { if (run.length) durRuns.push(run); run = []; continue; }
      const last = run[run.length - 1];
      if (last && last.core === it.core) last.dur += it.dur; else run.push({ core: it.core, dur: it.dur, sym: it.sym });
    }
    if (run.length) durRuns.push(run);
  }
  // aynı akor art arda → tek akor; N.C. segmentleri böler
  const segments = [];
  let seg = [];
  const chordSeq = [];
  for (const it of items) {
    if (it.unknown) continue;
    if (it.nc) { if (seg.length) segments.push(seg); seg = []; chordSeq.push(it); continue; }
    if (seg.length && seg[seg.length - 1].ident === it.ident) continue;
    seg.push(it);
    if (!(chordSeq.length && chordSeq[chordSeq.length - 1].ident === it.ident)) chordSeq.push(it);
  }
  if (seg.length) segments.push(seg);
  // core geçişleri: aynı core'a geçiş (ör. C → Cmaj7) harmonik değişim sayılmaz
  const coreSegs = segments.map((sg) => sg.reduce((a, it) => { if (!a.length || a[a.length - 1].core !== it.core) a.push(it); return a; }, []));
  const nonNc = items.filter((x) => !x.nc && !x.unknown);
  return {
    items, segments, coreSegs, unknown, hasDur, durRuns: hasDur ? durRuns : null,
    first: nonNc[0] || null, last: nonNc[nonNc.length - 1] || null,
    startsNc: !!items[0] && !!items[0].nc, endsNc: !!items[items.length - 1] && !!items[items.length - 1].nc,
    loop: key ? detectLoop(chordSeq.filter((x) => !x.nc)) : null,
  };
}
function sectionHasBars(sec) {
  return Array.isArray(sec.bars) && sec.bars.length === sec.chords.length && sec.bars.every((b) => typeof b === 'number' && b > 0);
}
// süre sınıfları (ölçü): 0.5, 1, 2, 4, 8+ — log ölçekte en yakın sınıf
const DUR_BINS = [0.5, 1, 2, 4, 8];
function durBin(d) {
  if (!(d > 0)) return 0.5;
  if (d >= 4 * Math.SQRT2) return 8;
  const e = Math.round(Math.log2(d));
  return Math.pow(2, Math.max(-1, Math.min(2, e)));
}
const durLabel = (b) => (b === 8 ? '8+' : String(b));
const fmtDur = (d) => String(Math.round(d * 100) / 100);
// Tekrar eden döngü: en kısa periyot p (≥2) ile dizinin tamamı kendini tekrarlıyorsa
function detectLoop(seq) {
  const n = seq.length;
  for (let p = 2; p <= Math.floor(n / 2); p++) {
    let ok = true;
    for (let i = p; i < n; i++) if (seq[i].ident !== seq[i - p].ident) { ok = false; break; }
    if (ok) return { period: p, repeats: Math.round((n / p) * 10) / 10, pattern: seq.slice(0, p).map((x) => x.label), symbols: seq.slice(0, p).map((x) => x.sym) };
  }
  return null;
}
// degrees_preview karşılaştırması: yalnızca seçili ton, önizlemenin ait olduğu önerinin tonuyla aynıysa
function previewFor(sec, key) {
  if (!key) return null;
  const withOwn = sec.proposals.find((p) => sameKey(p, key) && p.degreesPreview);
  if (withOwn) return withOwn.degreesPreview;
  if (sec.degreesPreview && sec.proposals[0] && sameKey(sec.proposals[0], key)) return sec.degreesPreview;
  return null;
}
function comparePreview(song, sec, key) {
  const prev = previewFor(sec, key);
  if (!prev) return { valid: false, mismatches: [], lengthMismatch: false };
  const an = analyzeSection(song, sec, key);
  const mismatches = [];
  an.items.forEach((it, i) => {
    if (i >= prev.length || it.unknown) return;
    const pr = parseRoman(prev[i]);
    let ok;
    if (!pr) ok = false;
    else if (it.nc || pr.nc) ok = !!it.nc === !!pr.nc;
    else if (it.power || pr.tq === '5' || it.color.startsWith('sus') || /sus/.test(it.color)) ok = pr.iv === it.iv; // nitelik belirsiz: yalnız kök
    else ok = pr.iv === it.iv && pr.tq === it.tq;
    if (!ok) mismatches.push({ index: i, chord: it.sym, expected: it.nc ? 'N.C.' : it.label, preview: prev[i] });
  });
  return { valid: true, mismatches, lengthMismatch: prev.length !== an.items.length, previewLength: prev.length };
}

// ---------------------------------------------------------------- istatistik
const ALL = '*';
function emptyBucket() {
  return { songs: new Set(), degrees: new Map(), colors: new Map(), trans: new Map(), trans2: new Map(), ctx1: new Map(), ctx2: new Map(), open: new Map(), close: new Map(), qual: new Map(),
    dur: new Map(), rate: new Map(), durSongs: new Set() };
}
// map: key → { songs:Set, occ, refs:[{song, section}] }
function bump(map, key, songId, secName, occ = 1) {
  let e = map.get(key);
  if (!e) { e = { songs: new Set(), occ: 0, refs: [] }; map.set(key, e); }
  e.occ += occ;
  if (!e.songs.has(songId)) e.songs.add(songId);
  if (!e.refs.some((r) => r.song === songId && r.section === secName)) e.refs.push({ song: songId, section: secName });
}
function confirmedKey(sec) { return sec.confirmed && sec.selected ? sec.selected : null; }
function buildStats(dataset) {
  const byMode = new Map();
  const bucket = (m) => { if (!byMode.has(m)) byMode.set(m, emptyBucket()); return byMode.get(m); };
  bucket(ALL);
  const inter = new Map(), shifts = new Map();
  const songInfo = new Map();
  for (const song of dataset.songs) {
    const info = { loops: [], confirmed: 0, sections: song.sections.length, unknown: unknownSymbols(song).length };
    songInfo.set(song.id, info);
    const analyzed = song.sections.map((sec) => { const k = confirmedKey(sec); return k ? { sec, key: k, an: analyzeSection(song, sec, k) } : null; });
    analyzed.forEach((a) => {
      if (!a || a.an.unknown) return;
      info.confirmed++;
      if (a.an.loop) info.loops.push({ section: a.sec.name, ...a.an.loop });
      for (const b of [bucket(a.key.mode), bucket(ALL)]) {
        b.songs.add(song.id);
        const nm = a.sec.name;
        for (const it of a.an.items) {
          if (it.nc || it.unknown) continue;
          bump(b.qual, it.tq, song.id, nm);
        }
        for (const sg of a.an.segments) for (const it of sg) {
          bump(b.degrees, it.core, song.id, nm);
          let cm = b.colors.get(it.core);
          if (!cm) { cm = new Map(); b.colors.set(it.core, cm); }
          bump(cm, it.color, song.id, nm);
        }
        for (const cs of a.an.coreSegs) {
          for (let i = 1; i < cs.length; i++) {
            bump(b.trans, `${cs[i - 1].core}>${cs[i].core}`, song.id, nm);
            bump(b.ctx1, cs[i - 1].core, song.id, nm);
            if (i >= 2) {
              bump(b.trans2, `${cs[i - 2].core}>${cs[i - 1].core}>${cs[i].core}`, song.id, nm);
              bump(b.ctx2, `${cs[i - 2].core}>${cs[i - 1].core}`, song.id, nm);
            }
          }
        }
        if (a.an.hasDur) {
          b.durSongs.add(song.id);
          let total = 0, n = 0;
          for (const run of a.an.durRuns) for (const r of run) { bump(b.dur, durBin(r.dur), song.id, nm); total += r.dur; n++; }
          if (n) bump(b.rate, durBin(total / n), song.id, nm); // bu bölümde kaç ölçüde bir akor değişiyor
        }
        if (a.an.first) bump(b.open, a.an.first.core, song.id, nm);
        if (a.an.last) bump(b.close, a.an.last.core, song.id, nm);
      }
    });
    // bölümler arası geçiş (N.C. sınırında sayılmaz); iki bölümün merkez+modu da kaydedilir
    for (let i = 1; i < analyzed.length; i++) {
      const A = analyzed[i - 1], B = analyzed[i];
      if (!A || !B || A.an.unknown || B.an.unknown || A.an.endsNc || B.an.startsNc || !A.an.last || !B.an.first) continue;
      const iv = mod12(B.key.tonic - A.key.tonic);
      const k = `${A.key.mode}|${B.key.mode}|${iv}|${A.an.last.core}>${B.an.first.core}`;
      bump(inter, k, song.id, `${A.sec.name} → ${B.sec.name}`);
      const e = inter.get(k);
      e.meta = { fromMode: A.key.mode, toMode: B.key.mode, iv, from: A.an.last.core, to: B.an.first.core };
      (e.examples ||= []).push({ song: song.id, from: { ...A.key, sym: A.an.last.sym }, to: { ...B.key, sym: B.an.first.sym } });
      bump(shifts, `${A.key.mode}|${B.key.mode}|${iv}`, song.id, `${A.sec.name} → ${B.sec.name}`);
      shifts.get(`${A.key.mode}|${B.key.mode}|${iv}`).meta = { fromMode: A.key.mode, toMode: B.key.mode, iv };
    }
  }
  return { byMode, inter, shifts, songInfo, songs: new Map(dataset.songs.map((s) => [s.id, s])) };
}
const nSongs = (e) => (e ? e.songs.size : 0);
function modeSongCounts(stats) {
  const out = {};
  for (const m of MODE_ORDER) out[m] = stats.byMode.has(m) ? stats.byMode.get(m).songs.size : 0;
  out[ALL] = stats.byMode.get(ALL).songs.size;
  return out;
}

// ---------------------------------------------------------------- MODEL
const MODEL_DEFAULTS = { k: 10, alpha: 0.5, lambda: 1, chordTemperature: 0, seed: 1, minCtxSongs: 5, secondOrder: true, lowDataSongs: 20 };
// moda uygun (diatonik) core'lar
function diatonicCores(mode) {
  const sc = MODES[heptaOf(mode)].steps;
  const out = [];
  for (let d = 0; d < 7; d++) {
    const r = sc[d], i3 = mod12(sc[(d + 2) % 7] - r), i5 = mod12(sc[(d + 4) % 7] - r);
    const tq = i3 === 4 && i5 === 7 ? 'M' : i3 === 3 && i5 === 7 ? 'm' : i3 === 3 && i5 === 6 ? 'd' : i3 === 4 && i5 === 8 ? 'a' : null;
    if (tq) out.push(coreKey(r, tq));
  }
  return out;
}
const COLOR_TONES = { '': [], '7': [10], 'maj7': [11], '6': [9], 'add9': [2], '9': [10, 2], 'sus2': [2], 'sus4': [5], 'ø7': [10], '°7': [9] };
function modeColors(core, mode) {
  const { iv, tq } = coreParts(core);
  const sc = MODES[heptaOf(mode)].steps;
  const out = [];
  for (const [col, tones] of Object.entries(COLOR_TONES)) {
    if ((col === 'ø7' || col === '°7') !== (tq === 'd')) continue;
    if (tq === '5' && col !== '') continue;
    if (tq === 'd' && col === '') { out.push(col); continue; }
    if (tones.every((t) => sc.includes(mod12(iv + t)))) out.push(col);
  }
  return out;
}
const homeCore = (mode) => { const h = C.homeChord(0, mode); return coreKey(0, h.q === 'm' ? 'm' : h.q === 'dim' ? 'd' : 'M'); };

function feedbackIndex(fb) {
  const net = new Map();
  if (!fb || !fb.on) return { mult: () => 1, banned: new Set() };
  for (const e of fb.events || []) for (const [a, b] of e.transitions || []) {
    const k = `${e.mode}|${a}>${b}`;
    net.set(k, (net.get(k) || 0) + (e.like > 0 ? 1 : -1));
  }
  return {
    mult: (mode, a, b) => { const n = net.get(`${mode}|${a}>${b}`) || 0; return Math.min(2, Math.max(0.5, Math.pow(1.25, n))); },
    banned: new Set(fb.banned || []),
    net,
  };
}
function buildModel(dataset, settings = {}, feedback = null, prebuiltStats = null) {
  const o = Object.assign({}, MODEL_DEFAULTS, settings);
  const stats = prebuiltStats || buildStats(dataset);
  const fb = feedbackIndex(feedback);
  const B = (m) => stats.byMode.get(m) || emptyBucket();
  const pool = B(ALL);
  const nMode = (m) => B(m).songs.size;
  const vocabCache = new Map();
  function vocab(mode) {
    if (vocabCache.has(mode)) return vocabCache.get(mode);
    const set = new Set(diatonicCores(mode));
    for (const k of B(mode).degrees.keys()) set.add(k);
    for (const k of pool.degrees.keys()) set.add(k);
    const v = [...set];
    vocabCache.set(mode, v);
    return v;
  }
  // sayım haritasından yumuşatılmış dağılım
  function smooth(countOf, support, dia) {
    const w = new Map();
    let sum = 0;
    for (const b of support) { const x = countOf(b) + (dia.has(b) ? o.alpha : 0); if (x > 0) { w.set(b, x); sum += x; } }
    if (sum <= 0) { const d = support.filter((b) => dia.has(b)); for (const b of d) w.set(b, 1 / d.length); return w; }
    for (const [b, x] of w) w.set(b, x / sum);
    return w;
  }
  function pooled(pm, pp, n) {
    const out = new Map();
    const keys = new Set([...pm.keys(), ...pp.keys()]);
    const den = n + o.k;
    for (const b of keys) out.set(b, den > 0 ? (n * (pm.get(b) || 0) + o.k * (pp.get(b) || 0)) / den : pm.get(b) || 0);
    return out;
  }
  function withFeedback(mode, a, dist) {
    if (!feedback || !feedback.on) return dist;
    let sum = 0;
    const out = new Map();
    for (const [b, p] of dist) { const q = p * fb.mult(mode, a, b); out.set(b, q); sum += q; }
    for (const [b, q] of out) out.set(b, q / sum);
    return out;
  }
  const cache = new Map();
  // P(sonraki core | önceki core(lar), mod)
  function next(mode, a, a2 = null) {
    const ck = `${mode}|${a2}|${a}`;
    if (cache.has(ck)) return cache.get(ck);
    const dia = new Set(diatonicCores(mode));
    const support = vocab(mode).filter((b) => b !== a);
    const order2 = (bk) => o.secondOrder && a2 != null && nSongs(bk.ctx2.get(`${a2}>${a}`)) >= o.minCtxSongs;
    const distOf = (bk) => (order2(bk)
      ? smooth((b) => nSongs(bk.trans2.get(`${a2}>${a}>${b}`)), support, dia)
      : smooth((b) => nSongs(bk.trans.get(`${a}>${b}`)), support, dia));
    const d = withFeedback(mode, a, pooled(distOf(B(mode)), distOf(pool), nMode(mode)));
    d.order = order2(B(mode)) || order2(pool) ? 2 : 1;
    cache.set(ck, d);
    return d;
  }
  function edge(mode, which) {
    const ck = `${mode}|${which}`;
    if (cache.has(ck)) return cache.get(ck);
    const dia = new Set(diatonicCores(mode));
    const support = vocab(mode);
    const d0 = pooled(smooth((b) => nSongs(B(mode)[which].get(b)), support, dia), smooth((b) => nSongs(pool[which].get(b)), support, dia), nMode(mode));
    const d = which === 'open' ? withFeedback(mode, '^', d0) : d0;
    cache.set(ck, d);
    return d;
  }
  function color(mode, core) {
    const ck = `${mode}|c|${core}`;
    if (cache.has(ck)) return cache.get(ck);
    const fit = modeColors(core, mode);
    const cm = B(mode).colors.get(core) || new Map(), cp = pool.colors.get(core) || new Map();
    const support = [...new Set([...fit, ...cm.keys(), ...cp.keys(), ''])];
    const dia = new Set(fit.length ? fit : ['']);
    const d = pooled(smooth((c) => nSongs(cm.get(c)), support, dia), smooth((c) => nSongs(cp.get(c)), support, dia), nMode(mode));
    cache.set(ck, d);
    return d;
  }
  function songsFor(mode, key, kind = 'trans') {
    const e = B(mode)[kind].get(key);
    const ep = pool[kind].get(key);
    return { mode: e ? [...e.songs] : [], pool: ep ? [...ep.songs] : [], refs: (e || ep || { refs: [] }).refs };
  }
  // P(süre sınıfı | mod): süre verisi olan şarkılardan, aynı havuzlama + yumuşatma
  function dur(mode) {
    const ck = `${mode}|dur`;
    if (cache.has(ck)) return cache.get(ck);
    const all = new Set(DUR_BINS);
    const d = pooled(smooth((b) => nSongs(B(mode).dur.get(b)), DUR_BINS, all), smooth((b) => nSongs(pool.dur.get(b)), DUR_BINS, all), B(mode).durSongs.size);
    cache.set(ck, d);
    return d;
  }
  const durSongs = (m) => B(m).durSongs.size;
  return { settings: o, stats, vocab, next, open: (m) => edge(m, 'open'), close: (m) => edge(m, 'close'), color, dur, durSongs, nMode, songsFor, feedback: fb, diatonic: diatonicCores };
}

// ---------------------------------------------------------------- k ve α önerisi: şarkı bazlı çapraz doğrulama
function songTransitions(song) {
  const out = [];
  for (const sec of song.sections) {
    const k = confirmedKey(sec);
    if (!k) continue;
    const an = analyzeSection(song, sec, k);
    if (an.unknown) continue;
    const seen = new Set();
    for (const cs of an.coreSegs) for (let i = 1; i < cs.length; i++) {
      const key = `${cs[i - 1].core}>${cs[i].core}`;
      if (seen.has(key)) continue; // şarkı başına 1
      seen.add(key);
      out.push({ mode: k.mode, a: cs[i - 1].core, b: cs[i].core });
    }
  }
  return out;
}
function suggestKAlpha(dataset, base = {}, grid = {}) {
  const ks = grid.k || [0, 1, 2, 5, 10, 20, 50];
  const alphas = grid.alpha || [0.05, 0.1, 0.25, 0.5, 1, 2];
  const songs = dataset.songs.filter((s) => songTransitions(s).length);
  if (songs.length < 3) return { ok: false, reason: `Çapraz doğrulama için geçişi olan en az 3 onaylı şarkı gerekli (${songs.length} var).`, table: [] };
  const folds = songs.map((s) => ({ held: s, trans: songTransitions(s), stats: buildStats({ songs: dataset.songs.filter((x) => x.id !== s.id) }) }));
  const table = [];
  for (const k of ks) for (const alpha of alphas) {
    let ll = 0, n = 0;
    for (const f of folds) {
      const m = buildModel(null, Object.assign({}, base, { k, alpha, secondOrder: false }), null, f.stats);
      for (const t of f.trans) { ll += Math.log(Math.max(1e-4, m.next(t.mode, t.a).get(t.b) || 0)); n++; }
    }
    table.push({ k, alpha, meanLL: ll / n, n });
  }
  table.sort((a, b) => b.meanLL - a.meanLL);
  return { ok: true, best: table[0], table, songs: songs.length };
}

// ---------------------------------------------------------------- akor bulucu entegrasyonu
const Q2TC = { '': ['M', ''], m: ['m', ''], dim: ['d', ''], aug: ['a', ''], maj7: ['M', 'maj7'], m7: ['m', '7'], 7: ['M', '7'], sus2: ['s', 'sus2'], sus4: ['s', 'sus4'], add9: ['M', 'add9'], madd9: ['m', 'add9'], m7b5: ['d', 'ø7'], dim7: ['d', '°7'], 6: ['M', '6'], m6: ['m', '6'], mMaj7: ['m', 'maj7'], 9: ['M', '9'], m9: ['m', '9'], maj9: ['M', 'maj9'], 5: ['5', ''] };
function chordToCore(ch, tonic, mode) {
  const tc = Q2TC[ch.q] || ['M', ''];
  const iv = mod12(ch.root - tonic);
  const tq = tc[0] === 's' ? susQuality(iv, tonic, mode) : tc[0];
  return { core: coreKey(iv, tq), color: tc[1] };
}
function coreToChord(core, color, tonic) {
  const { iv, tq } = coreParts(core);
  const root = mod12(tonic + iv);
  const pick = Object.entries(Q2TC).find(([, v]) => (v[0] === tq || (v[0] === 's' && (tq === 'M' || tq === 'm'))) && v[1] === color);
  const q = pick ? pick[0] : { M: '', m: 'm', d: 'dim', a: 'aug', 5: '5' }[tq];
  return { root, q };
}
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Core.buildChords için stil puanlayıcı: λ × log P(geçiş) + λ × log P(renk)
// log olasılıklar uniform'a göre normalize edilir (veri yokken etkisi 0; akorda kalmak 0).
function makeStyleScorer(model, opts = {}) {
  const lambda = opts.lambda ?? model.settings.lambda;
  const rng = mulberry32((opts.seed ?? model.settings.seed) * 9973 + 17);
  return {
    lambda, temperature: opts.temperature ?? model.settings.chordTemperature, rng,
    score(prev, prev2, ch, sec) {
      if (!lambda || sec.tonic == null) return { value: 0, trans: 0, color: 0 };
      const c = chordToCore(ch, sec.tonic, sec.mode);
      let trans = 0, color = 0, p = null;
      const pr = prev ? chordToCore(prev, sec.tonic, sec.mode) : null;
      if (!pr || pr.core !== c.core) {
        const d = pr ? model.next(sec.mode, pr.core, prev2 ? chordToCore(prev2, sec.tonic, sec.mode).core : null) : model.open(sec.mode);
        p = d.get(c.core) || 0;
        trans = lambda * Math.log(Math.max(1e-4, p * d.size));
      }
      if (!pr || pr.core !== c.core || pr.color !== c.color) {
        const dc = model.color(sec.mode, c.core);
        color = lambda * Math.log(Math.max(1e-4, (dc.get(c.color) || 0) * dc.size));
      }
      return { value: trans + color, trans, color, p, core: c.core };
    },
  };
}

// ---------------------------------------------------------------- PROGRESYON ÖNERİCİ
// changes: akor (değişim) sayısı — 1 = tek akorda kalma / drone; bars: toplam uzunluk (ölçü)
const PROG_DEFAULTS = { changes: 3, bars: 8, loop: true, ending: 'home', temperature: 0, count: 5, seed: 1 };
const progKey = (mode, cores, loop) => `${mode}|${cores.join(',')}|${loop ? 'L' : ''}`;
// Değişim sürelerini süre dağılımından seçip toplamı tam olarak `bars`a oturtur (yarım ölçü adımlı DP).
// Her sınıfın olasılığı kanonik değerine (0.5, 1, 2, 4, 8) gider; ara değerler (1.5, 3…) küçük pay alır,
// böylece her toplam uzunluk tutturulabilir. Sıcaklık 0 → en olası; > 0 → örnekleme.
function fitDurations(model, mode, n, bars, temperature = 0, rng = Math.random) {
  const U = Math.round(bars * 2);
  if (n < 1 || n > U) return null;
  const pb = model.dur(mode);
  const maxU = U - (n - 1);
  const cnt = new Map();
  for (let u = 1; u <= maxU; u++) { const b = durBin(u / 2); cnt.set(b, (cnt.get(b) || 0) + 1); }
  const pd = new Float64Array(maxU + 1);
  for (let u = 1; u <= maxU; u++) {
    const d = u / 2, b = durBin(d), c = cnt.get(b), canon = d === b;
    // kanonik değer sınıf olasılığının %90'ını, ara değerler kalan %10'u paylaşır (tüm sınıflarda aynı oran)
    const hasCanon = b * 2 <= maxU;
    const share = canon ? 0.9 : 0.1 / (hasCanon ? c - 1 : c);
    pd[u] = (pb.get(b) || 0) * share;
  }
  const T = temperature;
  const w = (u) => (T ? Math.pow(pd[u], 1 / T) : pd[u]);
  // f[i][s]: ilk i akor s yarım ölçü → T=0'da en iyi log olasılık, T>0'da ağırlık toplamı
  const f = Array.from({ length: n + 1 }, () => new Float64Array(U + 1).fill(T ? 0 : -Infinity));
  f[0][0] = T ? 1 : 0;
  for (let i = 1; i <= n; i++) for (let sum = i; sum <= U; sum++) {
    let acc = T ? 0 : -Infinity;
    for (let u = 1; u <= Math.min(maxU, sum); u++) {
      if (!(pd[u] > 0)) continue;
      if (T) acc += f[i - 1][sum - u] * w(u);
      else acc = Math.max(acc, f[i - 1][sum - u] + Math.log(pd[u]));
    }
    f[i][sum] = acc;
  }
  if (T ? !(f[n][U] > 0) : f[n][U] === -Infinity) return null;
  const durs = new Array(n);
  let sum = U;
  for (let i = n; i >= 1; i--) {
    let pick = -1;
    if (T) {
      let r = rng() * f[i][sum];
      for (let u = 1; u <= Math.min(maxU, sum); u++) { if (!(pd[u] > 0)) continue; r -= f[i - 1][sum - u] * w(u); if (r <= 0) { pick = u; break; } }
      if (pick < 0) for (let u = Math.min(maxU, sum); u >= 1; u--) if (pd[u] > 0 && f[i - 1][sum - u] > 0) { pick = u; break; }
    } else {
      let best = -Infinity;
      for (let u = 1; u <= Math.min(maxU, sum); u++) {
        if (!(pd[u] > 0)) continue;
        const v = f[i - 1][sum - u] + Math.log(pd[u]);
        // eşitlikte kalan uzunluğun eşit bölüşümüne en yakın süre (veri yokken 2-2-2-2 gibi)
        if (v > best + 1e-9 || (Math.abs(v - best) <= 1e-9 && Math.abs(u - sum / i) < Math.abs(pick - sum / i))) { best = Math.max(best, v); pick = u; }
      }
    }
    durs[i - 1] = pick / 2;
    sum -= pick;
  }
  const logP = durs.reduce((a, d) => a + Math.log(pd[d * 2]), 0);
  return { durs, logP };
}
function progDisplay(labels, durs) { return labels.map((l, i) => `${l} (${fmtDur(durs[i])})`).join(' → '); }
function suggestProgressions(model, opts) {
  const o = Object.assign({}, PROG_DEFAULTS, opts);
  const { tonic, mode } = o;
  const N = Math.max(1, Math.round(o.changes));
  const home = homeCore(mode);
  const warnings = [];
  const n = model.nMode(mode), nAll = model.stats.byMode.get(ALL).songs.size;
  if (n < model.settings.lowDataSongs) warnings.push(`Az veri: ${modeName(mode)} modunda ${n} şarkı var (${model.settings.lowDataSongs}'den az). Öneriler havuzdan (${nAll} şarkı) ve yumuşatmadan (α=${model.settings.alpha}) besleniyor.`);
  const nd = model.durSongs(mode), ndAll = model.durSongs(ALL);
  if (!ndAll) warnings.push(`Süre verisi yok: süreler tekdüze dağılımdan seçilip ${fmtDur(o.bars)} ölçüye oturtuldu.`);
  else if (nd < model.settings.lowDataSongs) warnings.push(`Süre verisi az: bu modda ${nd}, havuzda ${ndAll} şarkıda akor süresi var.`);
  if (N > Math.round(o.bars * 2)) {
    warnings.push(`${N} akor ${fmtDur(o.bars)} ölçüye sığmaz (en kısa süre yarım ölçü).`);
    return { items: [], warnings, home, n, nAll, nd, ndAll };
  }
  if (N === 1) warnings.push('Tek akor: ev akorunda kalan drone önerisi.');
  const rng = mulberry32(o.seed * 7919 + N);
  const lp = (d, b) => Math.log(Math.max(1e-9, d.get(b) || 0));
  // Model akor DEĞİŞİMLERİNİ üretir (bir core'dan kendisine geçiş yok); kalma süresi ayrı modellenir.
  // Döngüde son akor ilk akorla aynıysa sınırda değişim yoktur (süreler birleşir), geçiş puanı eklenmez.
  function scoreSeq(seq) {
    let s = lp(model.open(mode), seq[0]);
    const steps = [];
    for (let i = 1; i < seq.length; i++) {
      const d = model.next(mode, seq[i - 1], i >= 2 ? seq[i - 2] : null);
      s += lp(d, seq[i]); steps.push({ a: seq[i - 1], b: seq[i], p: d.get(seq[i]) || 0 });
    }
    if (o.loop && seq.length > 1 && seq[N - 1] !== seq[0]) {
      const d = model.next(mode, seq[N - 1], N >= 2 ? seq[N - 2] : null);
      s += lp(d, seq[0]); steps.push({ a: seq[N - 1], b: seq[0], p: d.get(seq[0]) || 0, loop: true });
    }
    if (o.ending === 'data') s += lp(model.close(mode), seq[N - 1]);
    return { logP: s, steps };
  }
  const banned = model.feedback.banned;
  const valid = (seq) => {
    if (!seq.includes(home)) return false; // ev akoru en az bir kez
    if (o.ending === 'home' && seq[seq.length - 1] !== home) return false;
    if (o.ending === 'open' && seq[seq.length - 1] === home) return false;
    if (banned.has(progKey(mode, seq, o.loop))) return false;
    return true;
  };
  const found = new Map();
  if (!o.temperature) {
    let beam = [...model.open(mode)].map(([b, p]) => ({ seq: [b], s: Math.log(p) }));
    for (let i = 1; i < N; i++) {
      const nx = [];
      for (const it of beam) for (const [b, p] of model.next(mode, it.seq[i - 1], i >= 2 ? it.seq[i - 2] : null)) nx.push({ seq: [...it.seq, b], s: it.s + Math.log(p) });
      nx.sort((a, b) => b.s - a.s);
      beam = nx.slice(0, 400);
    }
    for (const it of beam) if (valid(it.seq)) { const k = it.seq.join(','); if (!found.has(k)) found.set(k, it.seq); }
  } else {
    const T = o.temperature;
    const sample = (d) => {
      const arr = [...d].map(([b, p]) => [b, Math.pow(p, 1 / T)]);
      let r = rng() * arr.reduce((a, x) => a + x[1], 0);
      for (const [b, w] of arr) { r -= w; if (r <= 0) return b; }
      return arr[arr.length - 1][0];
    };
    for (let tries = 0; tries < 3000 && found.size < o.count * 4; tries++) {
      const seq = [sample(model.open(mode))];
      for (let i = 1; i < N; i++) seq.push(sample(model.next(mode, seq[i - 1], i >= 2 ? seq[i - 2] : null)));
      if (valid(seq)) { const k = seq.join(','); if (!found.has(k)) found.set(k, seq); }
    }
  }
  const flats = keyUsesFlats(tonic, mode);
  const items = [...found.values()].map((seq) => {
    const sc = scoreSeq(seq);
    const fit = fitDurations(model, mode, N, o.bars, o.temperature, rng);
    const colors = seq.map((c) => {
      const d = model.color(mode, c);
      if (!o.temperature) return argmaxKey(d);
      const arr = [...d].map(([k, p]) => [k, Math.pow(p, 1 / o.temperature)]);
      let r = rng() * arr.reduce((a, x) => a + x[1], 0);
      for (const [k, w] of arr) { r -= w; if (r <= 0) return k; }
      return arr[arr.length - 1][0];
    });
    const chords = seq.map((c, i) => coreToChord(c, colors[i], tonic));
    const rare = sc.steps.slice().sort((a, b) => a.p - b.p)[0] || null;
    const rarest = rare ? Object.assign({}, rare, model.songsFor(mode, `${rare.a}>${rare.b}`)) : null;
    const symbols = chords.map((c) => C.chordName(c, flats));
    const degrees = seq.map((c, i) => degreeLabel(c, colors[i], mode));
    return {
      cores: seq, colors, chords, key: progKey(mode, seq, o.loop), durations: fit.durs,
      symbols, degrees, display: progDisplay(degrees, fit.durs), displaySymbols: progDisplay(symbols, fit.durs),
      logPHarm: sc.logP, logPDur: fit.logP, logP: sc.logP + fit.logP, prob: Math.exp(sc.logP + fit.logP), steps: sc.steps, rarest,
    };
  }).sort((a, b) => b.logP - a.logP).slice(0, o.count);
  if (!items.length) warnings.push('Kurallara uyan progresyon bulunamadı (kapanış tipi / beğenilmeyenler).');
  return { items, warnings, home, n, nAll, nd, ndAll };
}
// İki bölüm arası: "verse modu → nakarat modu" için modal kayma istatistiğinden geçiş akoru
function suggestSectionTransition(model, from, to, top = 3) {
  const iv = mod12(to.tonic - from.tonic);
  const rows = [];
  for (const [k, e] of model.stats.inter) {
    const m = e.meta;
    const tier = m.fromMode === from.mode && m.toMode === to.mode && m.iv === iv ? 0 : m.fromMode === from.mode && m.toMode === to.mode ? 1 : 2;
    rows.push({ k, e, tier });
  }
  const pick = (tier) => rows.filter((r) => r.tier === tier).sort((a, b) => nSongs(b.e) - nSongs(a.e));
  let list = pick(0), basis = 'aynı modlar ve aynı merkez aralığı';
  if (!list.length) { list = pick(1); basis = 'aynı modlar (farklı merkez aralığı)'; }
  if (!list.length) { list = pick(2); basis = 'tüm bölüm geçişleri (havuz)'; }
  const fl = keyUsesFlats(from.tonic, from.mode), tl = keyUsesFlats(to.tonic, to.mode);
  const out = list.slice(0, top).map(({ e }) => {
    const m = e.meta;
    const a = coreToChord(m.from, '', from.tonic), b = coreToChord(m.to, '', to.tonic);
    return {
      from: { core: m.from, label: coreLabel(m.from, from.mode), symbol: C.chordName(a, fl), chord: a },
      to: { core: m.to, label: coreLabel(m.to, to.mode), symbol: C.chordName(b, tl), chord: b },
      songs: [...e.songs], occ: e.occ, examples: e.examples,
      pivot: C.chordPcs(a).filter((p) => C.chordPcs(b).includes(p)).length,
    };
  });
  return { basis, items: out, iv };
}

// ---------------------------------------------------------------- saklama
function newDataset() { return { schema: 'mini-daw-style-dataset', version: 1, songs: [] }; }
function newFeedback() { return { schema: 'mini-daw-style-feedback', version: 1, on: true, events: [], banned: [] }; }
function checkFile(obj, schema) {
  if (!obj || obj.schema !== schema) throw new Error(`Beklenen dosya türü "${schema}", gelen "${obj && obj.schema}"`);
  if (obj.version !== 1) throw new Error(`Desteklenmeyen sürüm: ${obj.version}`);
  return obj;
}

root.Style = {
  parseSymbol, parseMode, parseKeyText, keyLabel, modeName, sameKey, romanOf, parseRoman, coreKey, coreParts, coreLabel, degreeLabel, argmaxKey,
  analyzeChord, analyzeSection, detectLoop, comparePreview, previewFor, unknownSymbols, QUALITY_NAMES,
  validateSongJson, parseImportJson, parseImportText, songKey, findDuplicate,
  buildStats, modeSongCounts, nSongs, ALL, confirmedKey,
  MODEL_DEFAULTS, PROG_DEFAULTS, buildModel, diatonicCores, modeColors, homeCore, suggestKAlpha, songTransitions,
  chordToCore, coreToChord, makeStyleScorer, mulberry32, suggestProgressions, suggestSectionTransition, progKey,
  fitDurations, progDisplay, durBin, durLabel, fmtDur, DUR_BINS, sectionHasBars,
  newDataset, newFeedback, checkFile,
};
if (typeof module !== 'undefined' && module.exports) module.exports = root.Style;
})(typeof window !== 'undefined' ? window : globalThis);

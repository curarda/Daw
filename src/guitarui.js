// ---------------------------------------------------------------- GİTAR PANELİ (8c): katmanlar, adım ızgarası, ön dinleme, bölüme atama, preset
// app.js'in IIFE'sinin içine girer (build'de /*__GUITARUI__*/ yerine konur): S, C, $, $$, esc, status, Player aynı kapsamda.
const GT = { target: '_all', sel: null, auditioning: false, cache: null, timer: null, lp: false, lpTimer: null, presetName: '' };
const MODE_TR = { strum: 'Strum', arpeggio: 'Arpej', bassChord: 'Boom-chick', tremolo: 'Tremolo' };
const ART_TR = { normal: 'Normal', letRing: 'Let ring', staccato: 'Staccato', palmMute: 'Palm mute' };
const ORN_TR = { slideIn: 'Slide in', slideOut: 'Slide out', hammerPull: 'Hammer / pull', vibrato: 'Vibrato' };
const ORN_SYM = { slideIn: '⤴', slideOut: '⤵', hammerPull: 'h', vibrato: '~' };
const ART_SYM = { letRing: 'L', staccato: 'S', palmMute: 'M' };
const STEP_SYM = { D: '↓', U: '↑', dead: '✕', rest: '·' };
const STEP_NEXT = { rest: 'D', D: 'U', U: 'dead', dead: 'rest' };
const STEP_NAME = { rest: 'es', D: 'aşağı vuruş', U: 'yukarı vuruş', dead: 'ölü vuruş' };
const gState = () => S.proj.guitar;
const gOwn = (target = GT.target) => (target === '_all' ? gState().parts._all : gState().parts[target] || null);
const gEff = (target = GT.target) => S.d ? C.guitarPartFor(gState(), target, S.proj, S.d) : gOwn(target) || gState().parts._all;
const gSections = () => (S.d ? S.d.sections.filter((s) => !s.implicit) : []);
const jclone = (x) => JSON.parse(JSON.stringify(x));

// ---- parti → ses (çalma, ön dinleme ve mix WAV aynı yolu kullanır; render önbellekli)
function guitarTrack(sr) {
  const g = S.d.g, slots = C.guitarSlotsFrom(S.d);
  const key = sr + '|' + g.bpm + '|' + g.meter + '|' + JSON.stringify(slots) + JSON.stringify(S.proj.guitar.parts) + JSON.stringify(C.resolveLinks(S.proj, S.d)) + JSON.stringify(S.d.sections.map((s) => [s.id, s.startBar, s.endBar, C.effectiveLayers(S.proj, S.d, s.id)]));
  if (GT.cache && GT.cache.key === key) return GT.cache;
  const events = arrangedEventsAll(['guitar']).guitar;
  const n = Math.ceil((S.d.bars * g.barSec + 2.5) * sr);
  return (GT.cache = { key, events, data: C.renderGuitar(events, sr, n, g.spq, 1) });
}
// 2 ölçülük döngü: projedeki gerçek akor akışı (seçili bölümün başından); akor yoksa Am–F–C–G
function guitarAudition(sr) {
  const g = C.makeGrid(S.proj.settings), part = gEff(GT.target), barQ = g.barQ;
  let slots = null, real = false;
  if (S.d && S.d.chords.length) {
    const sec = GT.target !== '_all' ? S.d.sections.find((s) => s.id === GT.target) : null;
    const startQ = sec ? (sec.startBar - 1) * barQ : Math.floor(S.d.chords[0].q0 / barQ + 1e-6) * barQ;
    slots = C.guitarSlotsFrom(S.d).filter((sl) => sl.q1 > startQ + 1e-6 && sl.q0 < startQ + 2 * barQ - 1e-6)
      .map((sl) => Object.assign({}, sl, { q0: Math.max(sl.q0, startQ) - startQ, q1: Math.min(sl.q1, startQ + 2 * barQ) - startQ }));
    real = slots.length > 0;
  }
  if (!real) slots = [[9, 'm'], [5, ''], [0, ''], [7, '']].map(([r, q], i) => ({ q0: (i * barQ) / 2, q1: ((i + 1) * barQ) / 2, chord: { root: r, q }, section: '_all', tonic: 9 }));
  const events = C.guitarEvents(slots, g, () => part);
  return { real, events, data: C.renderGuitar(events, sr, Math.round(2 * g.barSec * sr), g.spq, 1) };
}

// ---- değişiklik akışı
function gRefreshSound() {
  clearTimeout(GT.timer);
  if (GT.auditioning) GT.timer = setTimeout(() => Player.auditionGuitar(), 140); // seçim anında sese yansır
  else if (Player.playing) GT.timer = setTimeout(() => Player.play(), 140);
}
function gChanged() { renderGuitar(); gRefreshSound(); }
function gEdit(fn) {
  if (guardLinked(GT.target)) return;
  const p = gOwn();
  if (!p) return;
  fn(p);
  C.normalizeGuitarPart(p, S.proj.settings.meter);
  gChanged();
}
function syncGuitarButtons() { const b = $('#btnGAudition'); if (b) b.classList.toggle('on', GT.auditioning); }
// hazır kalıp elle düzenlenince "özel ızgara"ya dönüşür
function toCustom(p) {
  if (p.pattern.id === 'custom') return;
  const q = jclone(p.pattern);
  p.pattern = { id: 'custom', name: 'Özel ızgara', meter: q.meter, grid: q.grid, steps: q.steps, compatibleModes: ['strum', 'arpeggio', 'bassChord'] };
}
function resampleGrid(p, grid) {
  const old = p.pattern, oq = C.GRID_Q[old.grid], nq = C.GRID_Q[grid], n = Math.round(C.METERS[old.meter].barQ / nq);
  const steps = Array.from({ length: n }, () => ({ type: 'rest' }));
  old.steps.forEach((s, i) => { const k = (i * oq) / nq; if (Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) < n) steps[Math.round(k)] = s; });
  const ov = {};
  for (const [i, o] of Object.entries(p.stepOverrides)) { const k = (i * oq) / nq; if (Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) < n) ov[Math.round(k)] = o; }
  old.steps = steps; old.grid = grid; p.stepOverrides = ov; GT.sel = null;
}
function gAction(k, v) {
  const meter = S.proj.settings.meter;
  gEdit((p) => {
    switch (k) {
      case 'mode': p.mode = v; GT.sel = null; break;
      case 'adir': p.arpeggio.direction = v; break;
      case 'arate': p.arpeggio.rate = v; break;
      case 'pat': p.pattern = C.clonePattern(C.patternById(v)); p.stepOverrides = {}; GT.sel = null; break;
      case 'custom': toCustom(p); break;
      case 'pgrid': toCustom(p); resampleGrid(p, v); break;
      case 'dmode': p.directionMode = v; break;
      case 'pos': p.voicing.position = v; break;
      case 'shape': case 'color': p.voicing[k] = v; break;
      case 'drone': p.voicing.drone = !p.voicing.drone; break;
      case 'art': p.articulation = v; break;
      case 'sart': {
        if (GT.sel == null) break;
        if (v === 'inherit') { const o = p.stepOverrides[GT.sel]; if (o) { delete o.articulation; if (!Object.keys(o).length) delete p.stepOverrides[GT.sel]; } } else C.setStepArticulation(p, GT.sel, v);
        break;
      }
      case 'orn': {
        if (GT.sel == null) break;
        const o = p.stepOverrides[GT.sel] = Object.assign({}, p.stepOverrides[GT.sel]);
        if (v === 'none') delete o.ornament; else o.ornament = v;
        if (!Object.keys(o).length) delete p.stepOverrides[GT.sel];
        break;
      }
      case 'stype': if (GT.sel != null) { toCustom(p); p.pattern.steps[GT.sel].type = v; } break;
      case 'sacc': if (GT.sel != null) { toCustom(p); const s = p.pattern.steps[GT.sel]; if (s.accent) delete s.accent; else s.accent = true; } break;
      case 'tone': p.tone = v; break;
      case 'dtime': p.fx.delay.time = v; break;
      default: break;
    }
  });
  void meter;
}
// ---- adım ızgarası: tıkla = döngü (es → D → U → ölü) ve seç; uzun bas = vurgu
function gStepClick(i) {
  GT.sel = i;
  gEdit((p) => { toCustom(p); const s = p.pattern.steps[i]; s.type = STEP_NEXT[s.type]; });
}
function gStepAccent(i) {
  GT.sel = i;
  gEdit((p) => { toCustom(p); const s = p.pattern.steps[i]; if (s.accent) delete s.accent; else s.accent = true; });
}

// ---- panel
const gchip = (k, v, label, on, extra = '') => `<button type="button" class="gchip${on ? ' on' : ''}" data-k="${k}" data-v="${esc(v)}"${extra}>${label}</button>`;
const gslider = (k, label, min, max, val, fmt) => `<label class="gsl">${label}<input type="range" data-s="${k}" min="${min}" max="${max}" step="1" value="${val}"><output>${fmt(val)}</output></label>`;
const grow = (title, body) => `<div class="grow-l"><div class="gtitle">${title}</div>${body}</div>`;
function droneReport(part) {
  const st = gState(), tuning = part.voicing.tuning, capo = part.voicing.capo || 0;
  if (!S.d) return { ok: true, lines: [] };
  const served = S.d.sections.filter((s) => (GT.target === '_all' ? !st.parts[s.id] : s.id === GT.target));
  const rs = served.map((s) => ({ name: s.implicit ? 'Tüm şarkı' : s.name, r: C.guitarDrone(s.tonic, tuning, capo) }));
  return { ok: rs.length === 0 || rs.some((x) => x.r.ok), lines: rs.map((x) => `${esc(x.name)}: ${x.r.ok ? `✓ ${C.noteName(x.r.midi)} boş teli` : '✗ ' + esc(x.r.reason)}`) };
}
function gridHtml(part, meter) {
  const pat = part.pattern, patQ = C.GRID_Q[pat.grid], perBeat = Math.max(1, Math.round(C.METERS[meter].pulseQ / patQ));
  let h = '<div class="gsteps" role="group" aria-label="Adım ızgarası">';
  for (let b = 0; b * perBeat < pat.steps.length; b++) {
    h += '<div class="gbeat">';
    for (let i = b * perBeat; i < Math.min(pat.steps.length, (b + 1) * perBeat); i++) {
      const s = pat.steps[i], art = C.stepArticulation(part, s, i), ov = part.stepOverrides[i] || {};
      const badge = (s.type !== 'rest' && art !== 'normal' ? ART_SYM[art] : '') + (ov.ornament ? ORN_SYM[ov.ornament] : '');
      h += `<button type="button" class="gstep t-${s.type}${s.accent ? ' acc' : ''}${GT.sel === i ? ' sel' : ''}" data-i="${i}" title="adım ${i + 1}: ${STEP_NAME[s.type]}${s.accent ? ', vurgulu' : ''}${s.type !== 'rest' ? ' · ' + ART_TR[art] : ''}${ov.ornament ? ' · ' + ORN_TR[ov.ornament] : ''}">${STEP_SYM[s.type]}<small>${badge || '&nbsp;'}</small></button>`;
    }
    h += '</div>';
  }
  return h + '</div>';
}
function panelHtml(part, meter) {
  const patterns = C.guitarPatternsFor(meter, part.mode), pat = part.pattern, v = part.voicing, selI = GT.sel, selStep = selI != null ? pat.steps[selI] : null;
  const selOv = selI != null ? part.stepOverrides[selI] || {} : {};
  // 1) vuruş modu
  let r1 = ['strum', 'arpeggio', 'bassChord', 'tremolo'].map((m) => gchip('mode', m, MODE_TR[m] + (m === 'tremolo' ? ' <small>(v2)</small>' : ''), part.mode === m, m === 'tremolo' ? ' disabled title="v2: tremolo henüz yok"' : '')).join('');
  if (part.mode === 'arpeggio') {
    r1 += `<div class="gsub"><span>Yön</span>${[['up', 'Yukarı'], ['down', 'Aşağı'], ['upDown', 'Yukarı-aşağı'], ['travis', 'Travis']].map(([x, l]) => gchip('adir', x, l, part.arpeggio.direction === x)).join('')}</div>`
      + `<div class="gsub"><span>Hız</span>${[['8n', "8'lik"], ['16n', "16'lık"], ['8t', "8'lik üçleme"]].map(([x, l]) => gchip('arate', x, l, part.arpeggio.rate === x)).join('')}</div>`;
  }
  // 2) ritim kalıbı
  let r2 = patterns.map((p) => gchip('pat', p.id, esc(p.name), pat.id === p.id)).join('') + gchip('custom', 'custom', 'Kendi ızgaram', pat.id === 'custom');
  r2 += `<div class="gsub"><span>Vuruş yönü</span>${gchip('dmode', 'alternate', 'Alternate (D/U)', part.directionMode === 'alternate')}${gchip('dmode', 'allDown', 'Hep aşağı', part.directionMode === 'allDown')}</div>`;
  if (pat.id === 'custom') r2 += `<div class="gsub"><span>Izgara</span>${[['4n', "4'lük"], ['8n', "8'lik"], ['16n', "16'lık"]].map(([x, l]) => gchip('pgrid', x, l, pat.grid === x)).join('')}</div>`;
  r2 += gslider('swing', 'Swing', 0, 100, Math.round(part.swing * 100), (x) => x + '%');
  r2 += gridHtml(part, meter);
  r2 += `<div class="hint">${part.mode === 'arpeggio' ? 'Arpejde ızgara bir maskedir: es adımlarında nota çalmaz, vurgulu adımlar güçlü çalar. ' : ''}Adıma tıkla: es → ↓ → ↑ → ✕ döngüsü (ve seçer) · uzun bas: vurgu.</div>`;
  if (selStep) {
    r2 += `<div class="gsub"><span>Adım ${selI + 1}</span>${['rest', 'D', 'U', 'dead'].map((t) => gchip('stype', t, STEP_SYM[t] + ' ' + STEP_NAME[t], selStep.type === t)).join('')}${gchip('sacc', 'acc', 'Vurgu', !!selStep.accent)}</div>`;
  } else r2 += '<div class="hint">Süsleme ve nota süresi ezmesi için bir adım seç.</div>';
  // 3) voicing
  const dr = droneReport(part);
  let r3 = `<div class="gsub"><span>Konum</span>${[['auto', 'Otomatik'], ['open', 'Açık'], ['barre', 'Kapalı (barre)']].map(([x, l]) => gchip('pos', x, l, v.position === x)).join('')}</div>`
    + `<div class="gsub"><span>Şekil</span>${[['full', 'Tam akor'], ['power', 'Power'], ['triad', 'Üçlü (üst 3 tel)']].map(([x, l]) => gchip('shape', x, l, v.shape === x)).join('')}</div>`
    + `<div class="gsub"><span>Renk</span>${[['none', 'Yok'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['add9', 'add9']].map(([x, l]) => gchip('color', x, l, v.color === x)).join('')}</div>`
    + `<div class="gsub"><span>Drone</span>${gchip('drone', 'drone', v.drone ? 'Açık' : 'Kapalı', v.drone, dr.ok ? '' : ' disabled')}</div>`;
  if (v.drone || !dr.ok) r3 += `<div class="hint">${dr.lines.join('<br>')}</div>`;
  // 4) süsleme (seçili adım)
  const r4 = selStep && selStep.type !== 'rest' && selStep.type !== 'dead'
    ? [['none', 'Yok'], ...Object.entries(ORN_TR)].map(([x, l]) => gchip('orn', x, l, (selOv.ornament || 'none') === x)).join('') + '<div class="hint">Süsleme seçili adıma uygulanır. Vibrato yalnızca ≥ 1 vuruş süren notada, hammer/pull yalnızca renk seçili olmayan ya da sus akorlarında duyulur.</div>'
    : '<div class="hint">Önce ızgaradan çalan bir adım (↓ ↑) seç.</div>';
  // 5) nota süresi
  let r5 = `<div class="gsub"><span>Genel</span>${Object.entries(ART_TR).map(([x, l]) => gchip('art', x, l + (x === 'normal' ? ' <small>(kalıp önerisi)</small>' : ''), part.articulation === x)).join('')}</div>`;
  if (selStep && selStep.type !== 'rest' && selStep.type !== 'dead') {
    const cur = selOv.articulation || 'inherit';
    r5 += `<div class="gsub"><span>Adım ${selI + 1}</span>${gchip('sart', 'inherit', 'Genel', cur === 'inherit')}${Object.entries(ART_TR).map(([x, l]) => gchip('sart', x, l, cur === x)).join('')}</div>`;
  }
  const usesPm = part.articulation === 'palmMute' || Object.values(part.stepOverrides).some((o) => o.articulation === 'palmMute') || pat.steps.some((s) => s.defaultArticulation === 'palmMute');
  if (usesPm) r5 += gslider('pm', 'Palm mute miktarı', 0, 100, Math.round(part.palmMuteAmount * 100), (x) => x + '%');
  // 6) ton / FX
  const fx = part.fx, hu = part.humanize;
  const r6 = `<div class="gsub"><span>Ton</span>${[['clean', 'Clean'], ['crunch', 'Crunch'], ['drive', 'Drive']].map(([x, l]) => gchip('tone', x, l, part.tone === x)).join('')}</div>`
    + gslider('chorus', 'Chorus', 0, 100, Math.round(fx.chorus * 100), (x) => x + '%') + gslider('reverb', 'Reverb', 0, 100, Math.round(fx.reverb * 100), (x) => x + '%')
    + gslider('dmix', 'Delay karışımı', 0, 100, Math.round(fx.delay.mix * 100), (x) => x + '%')
    + `<div class="gsub"><span>Delay süresi</span>${[['8n', "8'lik"], ['d8n', "noktalı 8'lik"], ['4n', "4'lük"]].map(([x, l]) => gchip('dtime', x, l, fx.delay.time === x)).join('')}</div>`
    + gslider('dfb', 'Delay geri besleme', 0, 85, Math.round(fx.delay.feedback * 100), (x) => x + '%')
    + gslider('spread', 'Strum yayılması', 5, 25, hu.strumSpreadMs, (x) => x + ' ms') + gslider('vjit', 'Vuruş gücü sapması', 0, 50, Math.round(hu.velocityJitter * 100), (x) => x + '%') + gslider('tjit', 'Zamanlama sapması', 0, 20, hu.timingJitterMs, (x) => x + ' ms');
  return grow('1 · Vuruş modu (sağ el)', r1) + grow('2 · Ritim kalıbı', r2) + grow('3 · Voicing (sol el)', r3) + grow('4 · Süsleme (sol el, adım bazlı)', r4) + grow('5 · Nota süresi ve kesme', r5) + grow('6 · Ton / FX', r6);
}
function renderGuitar() {
  const st = gState(), meter = S.proj.settings.meter;
  if (!st || !$('#guitarPanel')) return;
  $$('input[name=gInstr]').forEach((r) => { r.checked = r.value === st.instrument; });
  const secs = gSections();
  if (GT.target !== '_all' && !secs.some((s) => s.id === GT.target)) { GT.target = '_all'; GT.sel = null; }
  const opts = '<option value="_all">Tüm şarkı (varsayılan)</option>' + secs.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${st.parts[s.id] ? ' ●' : ''}</option>`).join('');
  const sel = $('#gTarget');
  if (sel.dataset.h !== opts) { sel.innerHTML = opts; sel.dataset.h = opts; }
  sel.value = GT.target;
  const own = gOwn(), part = gEff(), linked = !!linkSource(GT.target);
  if (GT.sel != null && !part.pattern.steps[GT.sel]) GT.sel = null;
  let info = '';
  if (GT.target === '_all') info = secs.length ? `<div class="hint">Bölümlerin ayrı partisi yoksa hepsi bu partiyi çalar${secs.some((s) => st.parts[s.id]) ? ` (ayrı partisi olanlar: ${esc(secs.filter((s) => st.parts[s.id]).map((s) => s.name).join(', '))})` : ''}.</div>` : '';
  else info = own ? '<div class="row"><span class="hint grow">Bu bölümün kendi partisi var (●).</span><button id="gSecReset" class="small">Varsayılana dön</button></div>'
    : '<div class="adv-opt">Bu bölüm tüm şarkının partisini çalıyor. <button id="gSecOwn" class="accent small">Bu bölüm için ayrı parti oluştur</button></div>';
  if (linked) info = linkActions(GT.target);
  if ($('#gSecInfo').dataset.h !== info) { $('#gSecInfo').innerHTML = info; $('#gSecInfo').dataset.h = info; }
  const html = linked ? `<fieldset class="link-readonly" disabled>${panelHtml(part, meter)}</fieldset>` : `<div class="${GT.target !== '_all' && !own ? 'gdis' : ''}">${panelHtml(part, meter)}</div>`;
  if ($('#guitarPanel').dataset.h !== html) { $('#guitarPanel').innerHTML = html; $('#guitarPanel').dataset.h = html; }
  renderGuitarPresets();
  syncGuitarButtons();
}
function renderGuitarPresets() {
  const st = gState();
  const h = `<div class="gtitle">Kayıtlı kombinasyonlar</div><div class="gchips">${st.presets.map((p, i) => `<span class="gpre"><button type="button" class="gchip" data-pl="${i}"${linkSource(GT.target) ? ' disabled' : ''} title="Seçili bölüme yükle">${esc(p.name)}</button><button type="button" class="gchip gx" data-pd="${i}" title="Sil" aria-label="${esc(p.name)} presetini sil">✕</button></span>`).join('') || '<span class="hint">Henüz yok.</span>'}</div>`
    + `<div class="row"><input type="text" id="gPresetName" placeholder="Kombinasyona isim ver" value="${esc(GT.presetName)}"><button id="gPresetSave" class="small">Kaydet</button></div>`;
  const box = $('#gPresets');
  if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
}
// ---- olaylar
$('#guitarPanel').addEventListener('click', (e) => {
  const st = e.target.closest('.gstep');
  if (st) { if (GT.lp) { GT.lp = false; return; } gStepClick(+st.dataset.i); return; }
  const b = e.target.closest('[data-k]');
  if (b && !b.disabled) gAction(b.dataset.k, b.dataset.v);
});
$('#guitarPanel').addEventListener('pointerdown', (e) => {
  const st = e.target.closest('.gstep');
  if (!st) return;
  GT.lp = false; clearTimeout(GT.lpTimer);
  GT.lpTimer = setTimeout(() => { GT.lp = true; gStepAccent(+st.dataset.i); }, 450);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#guitarPanel').addEventListener(ev, () => clearTimeout(GT.lpTimer));
$('#guitarPanel').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.s || guardLinked(GT.target)) return;
  const p = gOwn();
  if (!p) return;
  const x = +el.value;
  const set = { swing: () => { p.swing = x / 100; }, pm: () => { p.palmMuteAmount = x / 100; }, chorus: () => { p.fx.chorus = x / 100; }, reverb: () => { p.fx.reverb = x / 100; },
    dmix: () => { p.fx.delay.mix = x / 100; }, dfb: () => { p.fx.delay.feedback = x / 100; }, spread: () => { p.humanize.strumSpreadMs = x; }, vjit: () => { p.humanize.velocityJitter = x / 100; }, tjit: () => { p.humanize.timingJitterMs = x; } }[el.dataset.s];
  if (!set) return;
  set();
  const out = el.parentElement.querySelector('output');
  if (out) out.textContent = x + ({ spread: ' ms', tjit: ' ms' }[el.dataset.s] || '%');
  // ızgara değişmedi: paneli yeniden kurma (sürükleme bozulmasın), yalnızca sesi tazele
  $('#guitarPanel').dataset.h = '';
  gRefreshSound();
});
$('#guitarPanel').addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.s) renderGuitar(); });
$$('input[name=gInstr]').forEach((r) => r.addEventListener('change', (e) => { S.proj.guitar.instrument = e.target.value; renderMatrix(); renderPacks(); if (Player.playing) Player.play(); }));
$('#gTarget').addEventListener('change', (e) => { GT.target = e.target.value; GT.sel = null; renderGuitar(); if (GT.auditioning) gRefreshSound(); });
$('#gSecInfo').addEventListener('click', (e) => {
  if (e.target.closest('#gSecOwn,#gSecReset') && guardLinked(GT.target)) return;
  if (e.target.closest('#gSecOwn')) { gState().parts[GT.target] = jclone(gState().parts._all); gChanged(); }
  if (e.target.closest('#gSecReset')) { delete gState().parts[GT.target]; GT.sel = null; gChanged(); }
});
$('#btnGAudition').onclick = () => Player.auditionGuitar();
$('#btnGStop').onclick = () => { Player.stop(); Player.stopGuitar(); };
$('#gPresets').addEventListener('input', (e) => { if (e.target.id === 'gPresetName') GT.presetName = e.target.value; });
$('#gPresets').addEventListener('click', (e) => {
  const st = gState();
  if (e.target.closest('#gPresetSave')) {
    const name = GT.presetName.trim();
    if (!name) { status('Kombinasyona bir isim ver.', 'err'); return; }
    const entry = { name, part: jclone(gEff()) };
    const i = st.presets.findIndex((p) => p.name === name);
    if (i >= 0) st.presets[i] = entry; else st.presets.push(entry);
    status(`"${name}" kaydedildi (proje dosyasıyla birlikte saklanır).`); renderGuitar(); return;
  }
  const d = e.target.closest('[data-pd]');
  if (d) { st.presets.splice(+d.dataset.pd, 1); renderGuitar(); return; }
  const l = e.target.closest('[data-pl]');
  if (l) {
    if (guardLinked(GT.target)) return;
    const pr = st.presets[+l.dataset.pl];
    if (GT.target !== '_all' && !st.parts[GT.target]) st.parts[GT.target] = jclone(st.parts._all);
    const loaded = jclone(pr.part);
    const dst = gOwn();
    for (const k of Object.keys(dst)) delete dst[k];
    Object.assign(dst, loaded);
    C.normalizeGuitarPart(dst, S.proj.settings.meter);
    GT.sel = null;
    status(`"${pr.name}" yüklendi.`); gChanged();
  }
});

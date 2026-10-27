# PLAN-3 — Autotune'u kendi nota kümene çek (Rock 9)

Source: Codex draft (read-only), reviewed by the Visionary. VTO-3.md decisions stand; cycle-1/2 conventions hold.

## Visionary decisions (override the draft where they differ)

1. Per-section sets, fill = pitch classes with >= 3 % of the section's sung time, nearest allowed note by the reference-adjusted measured pitch, tie -> lower (all from VTO-3.md).
2. New tests may be APPENDED to tests/pipeline.test.mjs and tests/ui.test.mjs (as the draft lists); no existing assertion may change except where the draft reconciles the README statement.
3. Stale section ids in `customSets` (deleted sections) are ignored on use and dropped on normalization; the implicit `_all` set is not migrated when sections are later created (note it in ISSUES, no extra work now).
4. The widened `nearestScaleNote` window must not change any existing scale-mode or manual-snap result: keep a regression assertion.

## Same Page amendments (round 1) — normative

- **C1 (1):** normalize `customSets` against current section ids on every refresh before signatures/history capture; `_all` valid only while there are no explicit sections, dropped afterwards; tests: delete, save/load, undo, later section creation.
- **C2 (2):** fill / copy / toggles are isolated history transactions (`histCommit()` before, no intermediate commits, `HIST.t = -Infinity` after); test the toggle -> fill -> copy -> toggle sequence undone step by step.
- **C3 (3, 4):** integration tests through real derive/split/quantize (unequal time warp, a note moved across a section boundary, `noteSplits` with different pitches) asserting original-duration weighting and whole-note membership; label-only override test (fill uses detected pitch, audio targets the set, chord identity keeps the label, key histogram unaffected by set changes).
- **C4 (5):** `doRender()` generation check: obsolete results are discarded and the latest pending state is scheduled; test edit + undo during the render yield.
- **C5 (6):** export tests are output-level: parse exported MIDI pitches and analyze a stable interior of the exported vocal WAV against the expected custom target, with original and empty-set controls, starting while rendering is pending.
- **C6 (7):** native checkboxes / `aria-pressed` buttons in a labeled group, labeled section selector, hints associated, keyboard operation, focus retained after toggle, fill, copy, undo (in-place update or focus restore); browser assertions.

## Facts

- Defaults: disabled, `target: "semitone"`, amount 100, retune 30 ms, keep vibrato and skip chromatic enabled (`src/core.js:609`).
- `computeCorrection` prioritizes `manualTarget`; otherwise enabled autotune acts only on unlocked notes. Semitone mode targets `n.nearest` (`src/core.js:632`).
- Scale mode targets `nearestScaleNote(n.median - n.refCents/100, n.scalePcs)`; ascending search with strict distance improvement makes ties go lower. Its current floor/ceil ±2 search is insufficient for sparse custom sets; missing scale falls back to rounding (`src/core.js:612`, `src/core.js:643`).
- `skipChromatic` currently applies only inside scale mode: short, adjacent, same-direction stepwise passing notes are skipped (`src/core.js:622`, `src/core.js:642`).
- `derive` assigns section membership from mapped note onset plus `0.12 * pulseQ`; absent explicit sections create `_all`. Confirmed or suggested section tonic/mode produces `s.pcs`, copied to `n.scalePcs`, then passed with `proj.autotune` into correction (`src/core.js:1928`, `src/core.js:1953`, `src/core.js:1967`, `src/core.js:1972`).
- Per-note inputs include frame bounds, original seconds `t0/t1`, measured MIDI `median`, reference-adjusted `nearest/refCents`, mapped `q0/q1`, section ID and edits. Fill can use `t1-t0` and `mod12(nearest)` without feeding back corrected pitch (`src/core.js:434`, `src/core.js:1942`).
- `identityChange` marks changed targets; `autoMoved` requires no label override, automatic correction, changed identity and amount ≥50%. `effMidi` then supplies the target to chords; key suggestions run beforehand on sung notes. Custom mode must preserve this path (`src/core.js:644`, `src/core.js:1960`, `src/core.js:1991`).
- Piano-roll arrows and inspector feedback consume `autoMoved`/`identityChange`; inspector text currently assumes scale mode and needs custom wording (`src/app.js:2041`, `src/app.js:2922`, `src/app.js:2943`). Manual scale-snap and scale diagnostics must retain `scalePcs` semantics (`src/app.js:2404`, `src/app.js:3015`).
- `refresh()` re-derives correction, redraws, schedules audio rendering and commits history (`src/app.js:189`, `src/app.js:224`). Audio reuse currently compares shift arrays plus time-map signature; rendering waits 350 ms or runs immediately (`src/app.js:441`, `src/app.js:463`). There is no current settings signature containing sets.
- Chord-pin signature includes autotune enabled/target/amount threshold, but no custom sets; changed signatures release ordinary pins during refresh (`src/app.js:185`, `src/app.js:3122`).
- Target radios always refresh; amount/retune/vibrato/skip controls refresh only when enabled. Apply/off refresh and request immediate rendering; `syncInputs` restores radios/warnings after load/undo (`src/app.js:3375`, `src/app.js:3444`, `src/template.html:222`).
- Section selection uses `S.sel`; linked-section guards protect arrangement edits, so custom vocal-set editing must bypass those guards and address the target section itself (`src/app.js:2367`, `src/app.js:2691`).
- Global history snapshots the whole project except mixer channels/A–B, coalesces changes within 500 ms, and restores through migration/default merging, input synchronization and rendering (`src/app.js:345`, `src/app.js:360`, `src/app.js:378`).
- Save serializes all `proj.autotune`; open merges migrated JSON into `newProject()`. Current migration handles matrix/pack state, without autotune-specific normalization (`src/app.js:3753`, `src/app.js:3764`, `src/app.js:3777`, `src/arrangement.js:14`).
- Named versions exclude autotune; custom sets therefore remain shared vocal state (`src/versions.js:5`). Existing tests cover correction, manual precedence, heard-note feedback, render and project round-trip (`tests/pipeline.test.mjs:118`, `tests/pipeline.test.mjs:144`, `tests/pipeline.test.mjs:445`, `tests/ui.test.mjs:137`, `tests/ui.test.mjs:321`).
- README explains heard-note feedback correctly at `README.tr.md:144`, but its step-5 table says autotune never changes chord suggestions; Rock 9 must reconcile that statement (`README.tr.md:17`).

### Rock 9

**Done looks like**

- Third target **“Kendi nota kümene çek”** exposes a section selector and 12 accessible C…B toggles.
- **“Şarkıdaki notalardan doldur”** replaces the selected section’s set with pitch classes occupying ≥3% of its sung time; manual toggling remains available.
- **“Şarkının hepsine uygula”** copies independent arrays to every current section, including linked targets.
- Custom correction finds the nearest allowed pitch in either direction using measured pitch minus personal reference; exact ties go lower. Empty sets leave automatic correction off for those notes.
- Existing amount, retune, vibrato, manual precedence, locks, heard-note chord feedback, exports, undo/redo and save/load work with custom mode.
- Turkish hints explain empty sets, the fill threshold, ignored chromatic skipping and changed note identity. Legacy project behavior stays unchanged.

**Files touched**

`src/core.js`, `src/app.js`, `src/template.html`, `tests/pipeline.test.mjs`, `tests/ui.test.mjs`, `README.tr.md`; generated `index.html` via `node build.mjs`. No new dependencies; no hand edits to generated HTML.

**Data model**

Only one new property; existing `target` additionally accepts `"custom"`:

```json
{
  "enabled": false,
  "target": "semitone",
  "amount": 100,
  "retuneMs": 30,
  "keepVibrato": true,
  "skipChromatic": true,
  "customSets": {}
}
```

A populated example is `"customSets": {"verse": [0, 2, 3, 4, 6, 7, 11], "chorus": []}`.

- Keys are section IDs; `_all` represents the implicit whole-song section. Missing entry, `[]` or legacy `""` means no automatic correction; sectionless gaps are untouched.
- Normalize entries to sorted, unique integer pitch classes 0–11; invalid/empty entries become `[]`. Missing map becomes `{}`.
- Add a core normalization helper used on project open and history restore; tolerate missing sets in direct `derive`/correction calls.
- Keep project version 1 and existing scalar defaults. Allocate a fresh map per project—shallow-copying a mutable defaults map would share state.
- Legacy files acquire only the empty map in memory; preserve their existing target/settings and audible behavior. Sets stay outside named versions.

**Approach**

1. **9a — core:** Add defaults/normalization and look up custom sets by `n.section`, never by linked source or section scale.
2. Widen `nearestScaleNote` to floor/ceil ±6; preserve ascending iteration and strict `<` comparison for lower ties.
3. Guard empty custom sets before nearest-note lookup; preserve manual-first and locked-note behavior.
4. In custom mode use `median - refCents/100` for target distance; retain measured `median` for actual cents shifting toward the standard target.
5. Set `identityChange` as in scale mode, ignore `skipChromatic`, and retain the existing `autoMoved`/`effMidi` chord path and amount threshold.
6. Export a pure fill helper: filter by `n.section`; sum positive finite original durations `t1-t0` by `mod12(n.nearest)`; include classes with duration ≥0.03 × total.
7. Define “sung time” as that sum of detected-note durations: exclude gaps/silence, include all detected notes regardless of locks/edits, assign each whole note by existing section membership; zero total returns `[]`.
8. Add core tests for sparse sets, reference-adjusted distance, lower ties, empty sets, chromatic bypass, controls/manual locks, section isolation, fill boundaries and heard-note feedback.
9. **9b — UI:** Add Turkish controls; keep selected editor section in transient UI state, synchronize explicit timeline section selection, and fall back to the first current section/`_all` when necessary.
10. Route toggles/fill/copy through a history transaction with refresh even while disabled; fill and whole-song copy each form one undo step; refresh and input synchronization restore picker/warnings.
11. Add canonical custom-set signatures to audio render readiness and `pinSig`; capture the render signature with its shift snapshot so changed sets invalidate cached audio, including equal-shift cases.
12. Adapt inspector/warning text, update both README passages, add browser interaction/persistence/cache/export assertions, rebuild from `src/`, then run the proof command.

**Risks**

- Widening the shared nearest-note helper also affects manual scale-snap callers: retain scale/semitone regression assertions.
- Rounded-pitch targeting can choose the wrong allowed note; test fractional measured pitches and a nonzero personal reference explicitly.
- Linked arrangements still follow their source under existing link rules; local vocal targets must nevertheless use their own set and feed ordinary heard-note derivation.
- Refresh/history coalescing, mutable copied arrays and stale section IDs can hide persistence bugs; test transaction boundaries, copy independence and selection fallback.
- A render signature must describe the captured work, not later mutable state. Verify readiness after rapid edits and undo/redo.

**Proof command**

```sh
npm test && npm run test:ui
```

Named new tests in `tests/pipeline.test.mjs`:

- `Custom autotune: sparse sets, actual pitch, personal reference and lower ties`
- `Custom autotune: empty sets, chromatic bypass, controls and manual locks`
- `Custom autotune: own section sets, heard-note chords and unchanged key histogram`
- `Custom fill: sung-duration weighting, exact 3% boundary and empty sections`
- `Custom state: defaults isolation, normalization and legacy compatibility`

Named new tests in `tests/ui.test.mjs`:

- `Custom picker: section selection, fill, independent whole-song copy and linked targets`
- `Custom autotune: render and chord-pin invalidation after set edits`
- `Custom autotune: undo/redo, save/load and legacy project restoration`
- `Custom autotune: corrected MIDI and vocal WAV exports`

These are future implementation checks; no build or tests were run during this read-only planning pass.

## Open questions

None required. VTO-3 fixes the product decisions; the duration, membership and persistence rules above make them concrete.
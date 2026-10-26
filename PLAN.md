# PLAN — paketler, bölüm matrisi, bölüm bağı, sürümler

Source: Codex draft (read-only), corrected by the Visionary. Decisions in VTO.md stand. Read VTO.md first.

## Visionary decisions (override the draft where they differ)

1. **Default (no-pack) matrix template** follows the user's own example, by `typeNorm`: intro = Akor + Gitar · verse = Akor + Gitar + Bas · prechorus = Akor + Gitar + Bas + Davul · chorus = all · bridge = Akor + Gitar · outro = Akor + Gitar · other / `_all` = all. "Akor" and "Gitar" still obey the global instrument mode (piano / guitar / both); a cell never turns on a layer that is globally off.
2. **Last-chorus extra is positional, not inherited.** It is computed after link resolution from the section's position (the last section with `typeNorm === 'chorus'` in the song), so a linked last chorus still gets the extra. It is never written into a linked source.
3. **Versions do not capture section boundaries, keys or modes.** A version stores per-section arrangement (`arr`, `link`, matrix row, guitar part, bass section settings) keyed by section id, plus global layer settings, chord choices/locks/pins and mixer. Each version carries a structure signature (ordered section ids + bar lengths); if the live signature differs, switching is blocked with a Turkish explanation (draft Open Question 2, recommended answer). Draft Open Question 1 is answered **no**.
4. **Legacy projects** (no `matrix` key) load with `matrix.enabled = false`: audible behaviour unchanged. Fresh projects get `enabled = true`.
5. Chord-choice storage in Rock 4 must be the **minimal** design that restores the exact chords after style-model changes; the Same Page meeting may simplify the draft's `chordChoices` scheme.
6. "Demo yap" using the best-ranked pack is a **deferred issue**, not part of these rocks (see ISSUES.md).

## Same Page amendments (round 1) — normative, override the draft below

- **A1 (findings 2, 3, 8):** the saved chord choice primitive is `{sectionId, relBar, half, chord}` (+ lock/pin state kept separately), built in **Rock 3** (used by unlink) and reused by Rock 4. Section-owned content in versions is captured section-relative and rebased onto live boundaries on apply. Drop the draft's section-relative quarter ranges.
- **A2 (1):** after applying a version snapshot recompute `chordPinsSig` before `refresh()`.
- **A3 (4):** a version's structure signature = meter + ordered `id:barLength`; any mismatch blocks switching.
- **A4 (5):** Rock 2 defines an explicit availability merge for locked piano/guitar layers against the single `guitar.instrument` value.
- **A5 (6):** packs store base settings only; the last-chorus extra is computed in the effective-arrangement resolver after link resolution.
- **A6 (7):** bass order: synchronize independent sources → resolve linked target bars → loop/tie policy (target bars always from source; loops referencing a linked target are ignored with a warning). Two consecutive refreshes yield identical events.
- **A7 (9):** bars not covered by any section follow the global arrangement.
- **A8 (10):** Rock 1 is built in stages 1a (shared event facade, legacy output equivalent, equivalence test first) → 1b (gating and boundary clipping in playback, mix, MIDI) → 1c (migration, undo/redo, UI); each stage has its own proof.
- **A9 (11):** proof for every rock = `npm test && npm run test:ui` with the rock's new tests registered once in `package.json`; browser assertions cover scheduled events and rendered stems (held notes, fills at disabled boundaries).

## Rocks (dependency order: 1 → 2 → 3 → 4)

## Facts

- Sections persist in `proj.sections`; `Core.derive()` copies them into `d.sections`, creates implicit `_all` when absent, and computes `typeNorm`: `src/core.js:1924`, `src/core.js:1964`. Matrix and links should resolve against these IDs.
- Chords are derived into `d.chords` from section keys, options, absolute-bar `chordLocks` and `chordPins`, then voiced: `src/core.js:1998`. Links plug in before voicing; versions must preserve actual chord choices.
- Section drum loop and chord sound overrides already live in `sections[].arr.drums/piano`; null inherits globally, drums supports `"off"`: `src/app.js:369`. Matrix adds enablement without duplicating these settings.
- Bass owns section settings, generated/edited bars, locks and loops: `src/bass.js:174`, `src/bass.js:658`; `bassSyncUI()` synchronizes after derivation: `src/bassui.js:24`. Packs and links must preserve this model.
- Guitar uses `guitar.parts[sectionId]`, falling back to `_all`: `src/guitar.js:325`; its rendered audio cache currently keys chords and parts: `src/guitarui.js:20`. Matrix/link changes must invalidate it.
- Global undo serializes the project, coalesces within 500 ms, excludes mixer strips and vocal A/B, and clears bass history on restore: `src/app.js:305`. New actions need explicit transaction boundaries.
- Bass has a separate snapshot history and keyboard priority: `src/bassui.js:33`, `src/bass.js:981`, `src/app.js:3321`. Arrangement transactions must become the latest global action.
- `__dawAPI.snapshot()` supplies sections and notes to style tools; it is not a complete arrangement snapshot: `src/app.js:36`, `src/styleui.js:622`. Named versions need a separate serializer.
- Save clones the project and optionally embeds audio/MIDI; load recursively merges defaults, but replaces arrays: `src/app.js:3376`, `src/app.js:3387`. All Rocks need migration after merge, including section-array entries.
- Playback cancels and rebuilds transport scheduling from the playhead/loop; piano/drum events and rendered guitar feed playback, while bass schedules separately: `src/app.js:1057`, `src/bassui.js:81`.
- Mix WAV renders stems, applies mixer mute/solo/gain and limiting: `src/app.js:483`, `src/app.js:3439`; bass uses `OfflineAudioContext`: `src/bassui.js:109`.
- MIDI independently assembles piano, guitar and bass events, accepting arranged drum events: `src/core.js:2268`, `src/app.js:3427`. Shared layer resolvers must replace divergent assembly paths.
- UI insertion points are sections and arrangement panels: `src/template.html:162`, `src/template.html:288`; style tools access the app through `__dawAPI`: `src/styleui.js:7`.
- The build script is **root `build.mjs`**, not `src/build.mjs`; it concatenates source into committed `index.html`: `build.mjs:1`. Tests load that generated file: `tests/load-core.mjs:6`, `package.json:8`.

### Rock 1: Section × layer matrix

**Done looks like**

- “Bölüm × katman” displays Akor, Gitar, Bas and Davul for every section, including “Tümü” for an unsectioned song.
- New projects fill rows by normalized section type; clicking a cell overrides it, and “Otomatiğe dön” restores automatic behavior.
- Playback, mix WAV and MIDI use identical effective cells; muted sections generate no new layer notes.
- Matrix edits support undo/redo and project round trips.
- Old projects retain their existing audible arrangement until the user enables automatic matrix filling.

**Files touched**

`src/arrangement.js` (new), `src/core.js`, `src/app.js`, `src/guitarui.js`, `src/bassui.js`, `src/template.html`, `src/style.css`, root `build.mjs`, `package.json`, `tests/matrix.test.mjs` (new), `tests/arrangement-ui.test.mjs` (new), both READMEs; rebuild `index.html`.

**Data model**

Add to fresh projects:

```json
{
  "matrix": {
    "enabled": true,
    "rows": {}
  }
}
```

Each populated `rows` entry uses the section ID, including `_all`:

```json
{
  "sec-1": {
    "piano": null,
    "guitar": null,
    "bass": null,
    "drums": null
  }
}
```

Cell values are exactly `null` (automatic), `true` or `false`.
Automatic values come from the built-in section template, later selected by `pack.id`.
Missing row/cell means `null`; no duplicated loop, sound, part or bass settings.
For files lacking `matrix`, migrate to `{"enabled":false,"rows":{}}` **before default merging**.
Disabled matrix preserves current behavior; enabling it is one undoable action.

**Approach**

1. Add pure matrix normalization, type defaults and effective-cell helpers to `src/arrangement.js`.
2. Load it after the existing engines through root `build.mjs`.
3. Use the default template in Visionary decision 1 (intro Akor+Gitar, verse Akor+Gitar+Bas, prechorus Akor+Gitar+Bas+Davul, chorus all, bridge Akor+Gitar, outro Akor+Gitar, other all).
4. Treat cells as gates on existing layer availability; show unavailable global layers with an explanatory Turkish hint.
5. Share arranged piano, guitar, bass and drum event generation between app playback, stem rendering and `Core.exportMidi()`.
6. Preserve start bars, section `"off"` settings, global instrument mode, fills, swing and mixer semantics.
7. Gate by section boundaries before rendering; clip held note bodies at disabled boundaries, allowing normal release/effect tails.
8. Include effective matrix state in guitar cache keys; expose all four effective event streams through the test API.
9. Add explicit global history transactions that flush pending edits and prevent adjacent matrix clicks from coalescing.
10. Wire Turkish accessible cell buttons and migration tests; register new tests in the existing npm scripts.

**Risks**

Legacy projects must not acquire automatic muting on load. Notes spanning boundaries, drum fills and guitar cache reuse can bypass naïve event filtering. Audible reverb tails require tests to distinguish tails from newly scheduled notes.

**Proof command**

```sh
npm test && npm run test:ui
```

(See A9; the rock's new tests are registered in package.json scripts.)

Assertions: legacy event equivalence, automatic/manual cells, boundary clipping, parsed MIDI notes, actual stem silence away from release tails, UI undo/redo and save/load.

### Rock 2: Genre packs

**Done looks like**

- “Tür paketi” offers exactly the VTO’s 16 packs, filtered to 14/1/1 by meter, with up to three best-fit suggestions.
- “Uygula” sets drums, bass, chord sound, guitar and section dynamics without changing tempo or meter.
- “⟳ Başka paket” cycles deterministically through the current ranked list.
- “Kilitle” preserves a layer’s settings and its matrix column across apply/cycle.
- One undo restores the complete previous arrangement; final-chorus energy is visibly and audibly higher where the pack supports it.

**Files touched**

`src/packs.js` (new), `src/arrangement.js`, `src/core.js`, `src/app.js`, `src/bassui.js`, `src/guitarui.js`, `src/template.html`, `src/style.css`, root `build.mjs`, `package.json`, `tests/packs.test.mjs` (new), `tests/arrangement-ui.test.mjs`, both READMEs; rebuild `index.html`.

**Data model**

Add:

```json
{
  "pack": {
    "id": null,
    "locks": {
      "piano": false,
      "guitar": false,
      "bass": false,
      "drums": false
    }
  }
}
```

`id` is null or one of 16 stable catalog IDs.
Missing object/fields migrate to these defaults.
Ranking and cycle position are derived from current BPM, meter and selected ID.
Applied values use existing `drums`, `piano`, `guitar`, `bass`, `sections[].arr` and `matrix.rows`.

**Approach**

1. Define 16 immutable catalog records using the VTO names/map and verified existing engine IDs.
2. Express guitar descriptions through existing pattern, articulation, tone and FX fields; add no presets or patterns.
3. Rank eligible packs by normalized distance outside pack BPM range, then best candidate loop range, with stable catalog order as tie-break.
4. Use the meter’s existing BPM convention, particularly dotted-quarter BPM in 6/8.
5. Build the entire candidate project on a clone; validate all referenced IDs before committing.
6. For unlocked layers, replace song settings and stale section overrides; regenerate bass through existing APIs.
7. Preserve existing bass bar/section locks and guitar part locks where present; report retained locked material.
8. Write each unlocked matrix column from the pack template; materialize locked columns’ prior effective cells so changing pack ID cannot alter them.
9. Set section energy through existing bass settings and selected drum/guitar settings; apply extra energy to the last chorus.
10. Commit once, invalidate caches and reschedule playback once; keep individual drum/style cycling controls separate.
11. Recompute rankings after BPM/meter changes; changing meter alone must not silently apply another pack.

**Risks**

VTO descriptions are musical intentions, not always literal preset IDs. Existing bass locks/loops need careful treatment during regeneration. A globally locked guitar layer also requires preserving instrument-mode behavior while changing chord sound.

**Proof command**

```sh
npm test && npm run test:ui
```

(See A9; the rock's new tests are registered in package.json scripts.)

Assertions: all catalog references exist, 14/1/1 eligibility, stable ranking/cycle/wrap, unchanged tempo/meter, locked-column preservation, final-chorus dynamics and single-step undo of the whole apply.

### Rock 3: Linked sections

**Done looks like**

- A section can select “Bölüme bağla” only from compatible sections of equal bar length.
- “Nakarat 2 = Nakarat 1” follows source chord choices/locks, section arrangement, guitar/bass content and matrix cells immediately.
- Linked targets display their source; editing inherited content directs the user to the source.
- “Bağı kopar” produces an independent copy with identical effective content and sound.
- Invalid/cyclic links are rejected; source deletion or incompatible resizing preserves the target as an independent copy.
- Link/unlink, propagation and project reload work with undo, playback and both exports.

**Files touched**

`src/arrangement.js`, `src/core.js`, `src/app.js`, `src/bass.js`, `src/bassui.js`, `src/guitarui.js`, `src/styleui.js`, `src/template.html`, `src/style.css`, `package.json`, `tests/links.test.mjs` (new), `tests/arrangement-ui.test.mjs`, both READMEs; rebuild `index.html`.

**Data model**

Add to each stored section:

```json
{
  "link": null
}
```

A linked target contains:

```json
{
  "link": {
    "sourceId": "sec-1"
  }
}
```

Missing `link` migrates to null. Source/target IDs remain stable.
Store references, not duplicate effective source settings.
On unlink, write the effective copy into existing target chord locks/pins, `arr`, bass settings/bars, guitar part and matrix row.

**Approach**

1. Validate source existence, equal inclusive bar length, self-links and cycles in a pure resolver.
2. Resolve chains in dependency order; map content using relative bar/quarter offsets.
3. Derive source chords first, then copy chord slots and lock metadata into target coordinates before voicing.
4. Resolve target section arrangement and matrix through its source while retaining target ID, name, location and vocal data.
5. Copy effective bass notes/settings by relative bar, including edits, ties and locks; rebase loop references safely.
6. Resolve guitar parts through the same source map; never rename target sections or move recorded notes.
7. Make inherited target controls read-only with “Kaynağı düzenle” and “Bağı kopar”.
8. Route chord picker, chart import, style progression placement and bulk edits through the same linked-target guard.
9. Apply packs to independent/source sections; targets inherit source templates (matrix row, section settings) but the positional last-chorus extra is applied after resolution.
10. Before source deletion or incompatible resizing, materialize affected targets; perform mutation and detachments in one transaction.
11. Normalize malformed loaded links deterministically, retaining local fallback data and showing a Turkish warning.

**Risks**

Absolute-bar chord locks, bass ties/loops and chained sources require rebasing. Local target vocal analysis must not regenerate linked chords. The positional last-chorus extra (Visionary decision 2) must still apply to a linked last chorus: apply it after link resolution, never store it in the source.

**Proof command**

```sh
npm test && npm run test:ui
```

(See A9; the rock's new tests are registered in package.json scripts.)

Assertions: source changes propagate through chains, target-relative offsets, equal-length/cycle validation, identical effective events before/after unlink, delete/resize preservation, import guards and MIDI/mix parity.

### Rock 4: Named versions

**Done looks like**

- “Sürüm kaydet” creates A/B/C… with arrangement, resolved chord choices/locks and mixer levels.
- Users switch, rename and delete versions; project save/load retains them.
- Switching during playback resumes at the same musical position and retains the active loop for A/B listening.
- Switching restores exact saved chords even if style-model preferences have since changed.
- Audio, corrected notes and timing remain shared; switching versions is undoable, including mixer restoration.

**Files touched**

`src/arrangement.js`, `src/core.js`, `src/app.js`, `src/styleui.js`, `src/bassui.js`, `src/guitarui.js`, `src/template.html`, `src/style.css`, `package.json`, `tests/versions.test.mjs` (new), `tests/arrangement-ui.test.mjs`, both READMEs; rebuild `index.html`.

**Data model**

Add:

```json
{
  "versions": {
    "activeId": null,
    "items": []
  },
  "chordChoices": []
}
```

An item has exactly these keys:

```json
{
  "id": "ver-1",
  "name": "A",
  "state": {
    "signature": [],
    "sections": {},
    "pack": null,
    "matrix": null,
    "drums": null,
    "piano": null,
    "guitar": null,
    "bass": null,
    "swing": null,
    "chordOpts": null,
    "chordLocks": [],
    "chordPins": [],
    "changeMarks": [],
    "chordStartBar": 1,
    "chordChoices": [],
    "mixer": {}
  }
}
```

The nulls above are schema placeholders: captured objects are deep copies of the corresponding project fields, using their existing JSON shapes.
`sections` is a map `sectionId -> { arr, link }` (no boundaries, keys or modes: Visionary decision 3); `signature` is the ordered list of `id:barLength` of the live sections at capture time.
`mixer` copies `vocal/piano/guitar/bass/drums` strips plus `pedal` and optional `touched`; excludes vocal `ab` and metronome `click`.

Each `chordChoices` entry has exactly:

```json
{
  "sectionId": "sec-1",
  "q0": 0,
  "q1": 4,
  "chord": { "root": 0, "q": "", "bass": null }
}
```

Quarter positions are relative to section start; lock/pin status remains in existing arrays.
Missing version state defaults to empty library and choices; capture no implicit version on legacy load.
Version snapshots never contain `versions`, audio, MIDI melody, `noteEdits`, `noteSplits`, alignment or tempo/meter.

**Approach**

1. Implement an allowlisted capture/apply serializer; never deep-copy the whole project into a version.
2. Save actual independent-section chord choices separately from locks; resolve linked targets through Rock 3.
3. Add chord-choice overrides before voicing, preserving automatic versus user-locked presentation.
4. Chord edits update affected choices; explicit regeneration clears affected choices before deriving again.
5. Keep the live project as a working copy; saved items remain immutable until explicitly updated.
6. Show “Değiştirildi” when the working arrangement differs; provide “Sürümü güncelle” and “Yeni sürüm kaydet”.
7. Apply a selected snapshot in one transaction, reset stale bass history and invalidate arrangement/audio caches.
8. Extend history entries so version switches restore mixer strips; ordinary undo retains its existing mixer policy.
9. Capture playhead/loop, cancel old schedules, prepare the new arrangement, then resume from the captured position.
10. Use a switch generation token so rapid A/B clicks cannot start an obsolete asynchronous render.
11. Warn before discarding dirty working changes; deleting an active version retains the current arrangement and clears `activeId`.

**Risks**

Snapshotting only chord options is insufficient for reproducible chords because style settings live outside the project. Large bass tracks increase JSON/history size. Structural edits and rapid asynchronous switches can invalidate section IDs or resume stale audio.

**Proof command**

```sh
npm test && npm run test:ui
```

(See A9; the rock's new tests are registered in package.json scripts.)

Assertions: snapshot allowlist and non-recursion, exact chord restoration after style changes, rename/delete/save/load, mixer-aware undo/redo, shared audio/timing invariance, dirty-state handling and rapid playback switching without duplicate schedules.

## Open questions

Both answered by the Visionary (decision 3): section boundaries are not versioned; incompatible structure signature blocks switching with a Turkish explanation.

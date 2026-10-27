# PLAN-2 — Akorları koru, Freesound + Gemini ile gerçek sesler

Source: Codex draft (read-only) corrected by the Visionary. Decisions in VTO-2.md stand; the cycle-1 conventions of VTO.md/PLAN.md still hold. Read VTO-2.md first.

## Visionary decisions (override the draft where they differ)

1. **"Akorları koru" OFF really releases the chords.** Choices created by the freeze are flagged (`source: 'freeze'` on the `chordChoices` record; absent/other = user/other origin). Turning the switch OFF removes exactly the flagged records (and nothing else), so the chord engine decides again and Demo/pack/⟳ may change chords. Chords the user edited while frozen are normal locks/choices (unflagged) and stay. The draft's "disabling keeps the current choices until explicit regeneration" is rejected.
2. **Demo yap works one-click without prior panel interaction.** It applies the pack currently selected in the pack dropdown (the value the user sees, which defaults to the tempo-ranked first), and persists it as `pack.selectedId` at that moment. No "select a pack first" error except when the meter has no eligible pack (Turkish explanation, nothing changed).
3. **Demo yap's genre behaviour replaces its bespoke drum/bass/arrangement steps** (its tempo/meter estimate, section creation, key confirmation, vocal cleanup and auto-mix stay). The existing UI test step "✨ Demo yap: … verse sade / nakarat dolu; tek Ctrl+Z …" (tests/ui.test.mjs) asserts the old drum/bass behaviour: it is the ONE sanctioned existing-test update for Rock 5; keep its intent (one undo step, plays, verse sparse / chorus full via the matrix) and say exactly what changed.
4. **Do NOT route the existing piano sample fetches or the Tone.js loader through the new network module** (draft Rock 6 approach step 2 is cut). The new module serves only the new Freesound and Gemini calls; existing network code stays untouched.
5. **Drum kit lanes (Rock 6):** required real lanes are K (kick), S (snare), H (hi-hat; plus O open hat only if the drum engine models it as a separate kind); other lanes (F, T, C, R, D, P) are OPTIONAL, each independently falls back to the built-in synth voice if no usable CC0 sound is found. The draft's "all ten kinds" is relaxed accordingly.
6. Real-API behaviour cannot be verified in the build sandbox (no keys); every automated test uses fixtures/mocks. The final report of Rocks 6-8 must list which behaviours the user has to check with real keys.

## Same Page amendments (round 1) — normative, override the draft below

- **B1 (findings 1, 2, 3):** `applyChordChoices` becomes a sparse slot-level override (relBar + half); generated slots, holds and half-bar boundaries not named are untouched. `source: 'freeze'` is set only by the freeze and preserved per record through `captureChordChoices`, unlink/materialization and version capture/restore. Bars outside every section: flagged absolute `chordLocks` (`src: 'freeze'`), removed on OFF; version capture keeps its gap limitation with a warning.
- **B2 (4):** Demo's section creation and key confirmation stay; when Demo creates the whole-song section while `_all` choices exist, re-key those choices to the new section id.
- **B3 (5):** Demo is a single history transaction isolated on both edges (`histCommit()` before, `HIST.t = -Infinity` after, no nested playback restart); tests for immediately adjacent edits.
- **B4 (6, 7):** keys/model live only in a separate browser settings store (never in `S.proj`, history, versions, exports, logs, errors, fixtures). Fixed endpoint constants; Freesound key only as `Authorization` header to `https://freesound.org/apiv2/`; Gemini key only as `x-goog-api-key` to `https://generativelanguage.googleapis.com/`; no credentials on CDN preview requests; `redirect: 'error'`; model id `^[A-Za-z0-9._-]{1,64}$`; errors redacted. Sound records normalized on every ingress (`url` = `https://freesound.org/people/<name>/sounds/<id>/`, `previewUrl` = `https://cdn.freesound.org/previews/...` without query/credentials, exact CC0 license URL, bounded strings). Sentinel-key tests over project JSON, history, versions, exports, status text and console.
- **B5 (8):** metadata sent to Gemini is delimited data; queries restricted to a fixed vocabulary and allowlisted parameters; "why" rendered as text, length-bounded; tests assert outgoing bodies against malicious fixtures.
- **B6 (9):** one canonical mono decoded buffer per sound; rate-keyed prepared banks (live context rate, 22,050 auto-mix, 44,100 WAV); shared trim threshold; tests compare onset, duration, level, pitch across the three paths.
- **B7 (10):** limits: preview <= 1.5 MB, decoded <= 6 s (drum one-shots trimmed to <= 2 s), IndexedDB cache <= 40 MB LRU, resident prepared banks <= 24 MB, sequential preparation, release obsolete buffers; undo/versions keep ids only; oversized inputs fail before expensive processing.
- **B8 (11):** one generation-guarded `prepareRealSounds(project, generation)` from load, undo/redo, version switch, play and render; immutable bank snapshot per operation; late completions ignored.
- **B9 (12):** acceptance gates: Rock 6 = 6a (settings, transport, cache, normalizers) -> 6b (deterministic selection, credits) -> 6c (audio integration: playback, stems, WAV); Rock 8 = 8a (analysis) -> 8b (integration); tests registered at each gate; the Tone/piano centralization text in the draft is void.

## Rocks (dependency order: 5 -> 6 -> 7 -> 8)

## Facts

- `makeDemo()` requires analyzed melody, stops playback, groups project changes into one undo, then starts playback: `src/app.js:912`.
- It preserves tempo/meter/swing, creates “Şarkı” if sections are absent, confirms suggested section keys, and refreshes derived chords: `src/app.js:921–937`.
- It enables drums/bass, preserves manual settings, replaces previous automatic section arrangements, simplifies verse/intro drums, and generates bass if needed: `src/app.js:938–960`.
- It optionally enables untouched vocal cleanup and runs automatic mixing; it currently applies no genre pack: `src/app.js:940`, `src/app.js:965`.
- Pack selection is the DOM value of `#inPack`; refresh preserves eligible selection. `proj.pack.id` stores the **applied** pack: `src/app.js:2484`, `src/core.js:1886`.
- `applyPack()` updates unlocked layer settings/matrix and preserves existing layer/content locks: `src/packs.js:68`; UI apply/cycle use `matrixEdit()`: `src/app.js:2497`.
- Absolute-bar `chordLocks` constrain generation; `chordPins` hold other chords after locking. Pins can be invalidated by `pinSig()`: `src/core.js:2002`, `src/app.js:185`.
- Exact section-relative choices already use `{sectionId,relBar,half,chord,state}`, with `state` = `auto|lock|pin`: `src/links.js:46`.
- Choices replace derived slots before linked-section copying and voicing: `src/links.js:51`, `src/core.js:2019`. Persistent freezing can use a boolean plus these existing choices, without turning every chord into a user lock.
- Matrix gates shared arranged events; linked sources resolve before positional last-chorus behavior: `src/arrangement.js:23`, `src/arrangement.js:65`.
- `synthDrum(kind,sr)` creates deterministic mono PCM voices; `drumEvents()` supplies timed lane/velocity events; `renderDrums()` sums synthesized voices: `src/drums.js:450`, `src/drums.js:508`, `src/drums.js:527`.
- `Player` builds drum buffers, schedules arranged hits through Tone transport, and plays buffer sources with event velocity: `src/app.js:1012`, `src/app.js:1122`, `src/app.js:1240`.
- Real drum voices therefore plug into both Player’s buffer preparation and `renderStems()`’ drum bank, leaving arranged events unchanged: `src/app.js:507`.
- `BassSampler.load(samples,releases)` accepts `{midi,buffer}` entries, selects nearest pitch, round-robins ties, and pitch-shifts with playback rate: `src/basssynth.js:151`.
- Its interface includes `output`, `ready`, `noteOn`, `noteOff`, `panic`, `dispose`, volume and synth-compatible automation methods: `src/basssynth.js:157–186`.
- User samples currently decode into memory-only `BS.bank`; root MIDI comes from filenames. `useSampler` selects sampler or synth: `src/bassui.js:874`, `src/bassui.js:64`.
- Live and offline bass already share `makeBassVoices()`/`bassHit()`; fetched bass plugs into that factory. Pitch measurement can reuse `Core.detectPitch()`: `src/bassui.js:85`, `src/bassui.js:114`, `src/core.js:194`.
- Guarded localStorage exists for panels, preferences and bass profiles; credentials need a separate browser settings store: `src/app.js:279`, `src/app.js:712`, `src/bassui.js:712`.
- Mix WAV renders stems at 44.1 kHz, applies mute/solo/faders, limits to −1 dBFS and encodes dual-mono WAV: `src/app.js:3724`.
- Project loading merges defaults; version snapshots use strict allowlists. New fields need migration in both paths: `src/app.js:3675`, `src/versions.js:5`, `src/versions.js:133`.
- Credits plug into `Core.chordChart()`, shared by text exports: `src/core.js:2124`, `src/app.js:3711`.
- The build file is **root `build.mjs`**, not `src/build.mjs`; it concatenates sources into `index.html`. Tests read that artifact: `build.mjs:1`, `tests/load-core.mjs:6`.
- Existing Node tests cover engines/golden/matrix/packs/links/versions; Playwright covers UI and rendered audio: `package.json:9`, `tests/bass-audio.test.mjs:1`.
- Existing external loading includes piano `fetch` and Tone script loading; centralize their transport alongside new calls: `src/app.js:549`, `src/app.js:977`.

### Rock 5: Akorları koru + Demo yap with the selected pack

**Done looks like**

- “Akorları koru” persists through save/load and undo/redo.
- While enabled, Demo, “Uygula” and “⟳ Başka paket” preserve exact chord slots, symbols and lock/pin presentation.
- Demo applies the selected dropdown pack, including its layer settings and matrix, respecting existing locks.
- Tempo, meter and swing remain unchanged; linked sections and named versions continue working.
- With no eligible pack for the meter, Demo gives a Turkish explanation and changes nothing; otherwise it uses the dropdown's current value (Visionary decision 2).

**Files touched**

`src/core.js`, `src/app.js`, `src/packs.js`, `src/links.js`, `src/versions.js`, `src/template.html`, `src/style.css`; `tests/chord-freeze.test.mjs`, `tests/demo-pack-ui.test.mjs`, `package.json`, both READMEs; rebuild `index.html` with root `node build.mjs`.

**Data model**

Add project defaults:

```json
{
  "preserveChords": false,
  "pack": {
    "selectedId": null
  }
}
```

`pack` retains existing `id` and `locks`. Missing `selectedId` migrates to the eligible applied `pack.id`, otherwise `null`. Fresh projects use null; Demo persists the dropdown's current value when it runs (Visionary decision 2). `chordChoices` records gain an optional `source: 'freeze'` flag.

Reuse existing `chordChoices` records; no second frozen-chord array. On enabling preservation, capture current independent-section choices before refresh. Linked targets inherit their source. Retain existing lock/pin arrays and choice states.

Include `preserveChords` and the extended pack object in version capture/apply. Legacy version snapshots migrate preservation to false and selection from their applied pack.

**Approach**

1. Persist dropdown changes separately from applied pack identity; rendering must not accidentally persist its first option.
2. Add one undoable toggle that captures current choices flagged `source: 'freeze'`; disabling removes exactly the flagged records (Visionary decision 1).
3. Preserve choices across Demo/apply/cycle; route direct chord edits through existing choice updates so deliberate edits remain possible.
4. Capture Demo’s selected ID before any refresh; validate meter eligibility before mutations.
5. Replace Demo’s bespoke drum/bass/section-arrangement steps with `C.applyPack()` inside the same transaction.
6. While frozen, avoid Demo’s section creation/key confirmation changing chord anchors; keep existing structure/keys.
7. When unfrozen, retain Demo’s section/key preparation, then apply the explicitly selected pack.
8. Preserve vocal-cleanup, automatic-mix and playback behavior; ensure asynchronous completion cannot affect a subsequently opened project.
9. Extend version migration/allowlists and refresh pin signatures before derivation.
10. Verify `_all`, linked sections, half-bars, held chords and adjacent history actions.

**Risks**

Creating a section can invalidate `_all` choices. Refresh can clear pins. Existing chord-edit handlers sometimes clear whole-section choices; they must preserve unaffected frozen slots. Demo must not create nested undo transactions.

**Proof command**

```sh
npm test && npm run test:ui
```

Register `tests/chord-freeze.test.mjs` and `tests/demo-pack-ui.test.mjs` once. Assert selected-versus-applied pack behavior, frozen slot equality, explicit edits, locks, links, legacy/version migration, save/load and single-step undo. Mock all network access with fixtures.

### Rock 6: Freesound client, settings and CC0 drum kit

**Done looks like**

- “Ses ayarları” provides masked Freesound/Gemini key inputs and editable Gemini model; credentials stay browser-only.
- “Gerçek sesler” installs deterministic CC0 one-shots for the required lanes K, S, H (and O if modelled separately); optional lanes use a real sound when a usable one is found, else the built-in voice (Visionary decision 5).
- Playback, automatic mixing and mix WAV use the same selected sounds and unchanged pack events.
- Reopening uses cached selections offline; cache misses restore the same IDs online rather than selecting replacements.
- Rejected licenses, missing keys, decode errors, quota/storage failures and 429 responses show Turkish status while synth playback remains available.
- Project and chord-sheet text list each selected sound’s name, author, Freesound link and CC0 license.

**Files touched**

New `src/network.js`, `src/soundsettings.js`, `src/realsounds.js`; `src/drums.js`, `src/app.js`, `src/core.js`, `src/versions.js`, `src/template.html`, `src/style.css`, root `build.mjs`; new tests/fixtures, `package.json`, both READMEs; rebuild `index.html`.

**Data model**

Add:

```json
{
  "realSounds": {
    "enabled": false,
    "drums": {},
    "bass": []
  }
}
```

Each populated `drums` key is one of the drum lane kinds the engine defines (K,S,H required; others optional; read src/drums.js for the real kind list), with exactly this record shape:

```json
{
  "id": 123,
  "name": "Kick one shot",
  "author": "fixture-author",
  "url": "https://freesound.org/people/fixture-author/sounds/123/",
  "license": "https://creativecommons.org/publicdomain/zero/1.0/",
  "previewUrl": "https://cdn.freesound.org/previews/fixture.mp3",
  "selector": "fallback",
  "why": ""
}
```

Values above illustrate schema, not production defaults. `bass` remains empty until Rock 8. Missing/invalid fields normalize to disabled/empty; reject non-CC0 records. Persist IDs and credits, never audio or credentials.

Browser-only `miniDaw.soundSettings.v1` stores both credentials and `geminiModel`, defaulting to `gemini-2.5-flash`; missing values are empty. Storage exceptions retain settings in memory with status.

IndexedDB `miniDaw.sounds.v1` stores validated metadata, bounded search results and preview bytes keyed by sound ID plus preview URL; decoded buffers remain memory-only. Include `realSounds` in version snapshots, with legacy disabled defaults.

**Approach**

1. **Stage 6a:** create one `Network` module with injectable fetch, deadlines, aborts, endpoint validation and redacted errors.
2. (Cut by Visionary decision 4: existing piano and Tone requests are NOT routed through the new module.)
3. Implement browser-only settings, masked inputs, deletion and guarded persistence; serialize project data through an explicit sound-field allowlist.
4. **Stage 6b:** implement Freesound search/detail/preview requests using previews only; require canonical CC0 before downloading and again on cache reads.
5. Queue Freesound requests at least two seconds apart, deduplicate requests, bound retries, honor `Retry-After`, and pause on 429.
6. Cache aggressively; bypass expired search results offline but retain selected metadata/audio. Handle blocked IndexedDB without breaking playback.
7. Rank bounded candidates deterministically by lane tags/name, short duration and stable ID tie-break; validate decoded length, energy and finite samples.
8. **Stage 6c:** prepare a mono/resampled runtime bank; extend `renderDrums()` with an optional bank whose missing kinds use the existing synth path.
9. Give Player the same prepared bank and invalidate it when selection changes; snapshot readiness once per playback/render operation.
10. Commit selected metadata once after preparation; loading a project resolves stored IDs without discovery. Guard async work by project/generation tokens.
11. Generate escaped, deduplicated credits from selected records in the panel and chord chart; keep off-state output unchanged.

**Risks**

Partial kits, browser codec differences and cache eviction can change available timbres. Metadata alone cannot guarantee a usable one-shot. Tone’s current script loader needs careful transport centralization. A status may describe fallback even though playback itself remains uninterrupted.

**Proof command**

```sh
npm test && npm run test:ui
```

Register `tests/network.test.mjs`, `tests/realsounds.test.mjs`, `tests/realsounds-ui.test.mjs`, and `tests/drum-samples-audio.test.mjs`. Use sanitized API fixtures and local audio; inject fetch and fake time, block unexpected requests. Cover per-lane fallback to synth, CC0 rejection, throttling/429, cache reload/offline, storage failure, credential exclusion, stale completion, credits, actual scheduled buffers, stem samples and WAV output. Retain existing golden assertions.

### Rock 7: Gemini selection

**Done looks like**

- Gemini proposes bounded drum searches and selects only validated candidate IDs from metadata.
- Each selected sound displays a short Turkish “Neden” explanation.
- Missing credentials, timeout, HTTP errors or invalid output visibly trigger deterministic selection.
- “Sesleri yeniden seç” creates an undoable new selection; undo restores IDs, credits and sound.
- Requests contain only allowlisted song analysis and candidate metadata, never audio, filenames, lyrics or credentials in prompts.

**Files touched**

New `src/soundselection.js`; `src/network.js`, `src/realsounds.js`, `src/app.js`, `src/template.html`, `src/style.css`; tests/fixtures, `package.json`, both READMEs; root `build.mjs` and rebuilt `index.html`.

**Data model**

No new project fields. Existing sound records permit:

```json
{
  "selector": "gemini",
  "why": "Kısa ve tok atak, seçilen pakete uyuyor."
}
```

Default remains `selector:"fallback", why:""`. Runtime validation allows only `fallback|gemini`, bounded plain-text reasons and IDs from the current candidate set. Do not persist prompts, raw responses or analysis payloads.

**Approach**

1. Use two bounded stages: query proposal → Freesound candidate collection → metadata-only choice.
2. Construct an allowlisted summary: BPM, meter, derived key/mode, selected pack, normalized section types and aggregate vocal energy.
3. Compute vocal energy locally; use null when no recorded vocal exists. Exclude raw notes, section names and user text.
4. Call the editable model through `Network`, sending its key only in the request header.
5. Require exact JSON schemas: query records by allowed lane, then `{lane,id,why}` choices; bound counts, lengths and response size.
6. Treat candidate descriptions as untrusted data; never follow generated URLs or model-proposed IDs outside candidate sets.
7. Validate every choice again against CC0 metadata and decoded usability; failures use Rock 6’s deterministic path with visible status.
8. Cap the complete selection operation by a deadline; no unbounded model retries.
9. For re-roll, exclude current IDs when alternatives exist; explain when no alternative is usable.
10. Prepare before committing one global transaction; abort obsolete runs on new selection, project load, undo or version switch.

**Risks**

A model can return valid JSON with unsuitable choices. Search scarcity can prevent an audible re-roll. Undo must restore saved IDs rather than rerunning Gemini. Model retirement requires an actionable Turkish error and fallback.

**Proof command**

```sh
npm test && npm run test:ui
```

Register `tests/soundselection.test.mjs` and `tests/soundselection-ui.test.mjs`. Fixture every model/search response. Cover malformed/extra fields, unknown IDs, prompt-injection descriptions, every HTTP failure class, timeout, privacy allowlists, fallback determinism, re-roll undo/redo and obsolete responses. Block unexpected network access.

### Rock 8: Bass sampler from Freesound

**Done looks like**

- Real-sound selection finds CC0 bass one-shots through Gemini or deterministic fallback.
- Locally measured root pitches feed the existing nearest-sample BassSampler; filenames are not trusted for pitch.
- Existing bass notes, timing, ties and arrangement gates play through the selected sampler in playback and mix WAV.
- Unusable or unavailable samples retain synth bass with a visible Turkish explanation.
- Save/load, offline cache, versions, undo and credits retain the selected bass sounds; user-loaded samples remain usable.

**Files touched**

`src/realsounds.js`, `src/soundselection.js`, `src/bassui.js`, `src/basssynth.js` if adapter changes are needed, `src/core.js`, `src/app.js`, `src/template.html`, `src/style.css`; tests/fixtures, `package.json`, both READMEs; rebuild with root `node build.mjs`.

**Data model**

Add optional fields to each `realSounds.bass` record. Each has all Rock 6 sound fields plus:

```json
{
  "rootMidi": 40,
  "rootCents": 0,
  "pitchConfidence": 0.94,
  "detectorVersion": 1
}
```

Use one to three records; defaults remain `bass:[]`. Require finite values, integer root MIDI within the supported bass range and confidence within `[0,1]`. Missing pitch fields trigger cached-preview analysis before use; invalid records cannot activate the sampler.

Do not set or repurpose `bass.useSampler` for Freesound. Source precedence is: explicitly enabled user sampler with samples → enabled/ready Freesound bass → synth. Disabling “Gerçek sesler” restores existing user-sampler/synth behavior.

**Approach**

1. **Stage 8a:** extend the selection pipeline with bounded bass-one-shot queries and candidate validation, reusing transport, CC0 guard, cache and credits.
2. Analyze decoded mono previews with `Core.detectPitch()` using bass-range options and locally measured usable duration.
3. Ignore attack/silence frames; require stable voiced pitch across multiple frames, sufficient confidence and usable sustain.
4. Reject noisy, polyphonic, excessively short or unstable candidates; try the next bounded candidate before retaining synth.
5. Store measured pitch metadata with detector version; convert cents to a fractional runtime MIDI root for accurate playback-rate tuning.
6. **Stage 8b:** keep fetched and user banks separate; extend `makeBassVoices()` to choose the effective bank by the documented precedence.
7. Feed `{midi,buffer}` to the existing sampler and preserve `bassHit()`, generated events, synth layers and low-note doubling.
8. Use the same effective bank in live and offline factories; resolve readiness before each operation and avoid network calls inside audio callbacks.
9. Commit bass selections atomically with undo/version support; restore buffers by saved IDs after load or version switch.
10. Update sampler hints and credits in Turkish, including pitch-analysis rejection and synth fallback reasons.

**Risks**

Octave errors and MP3 attacks can mislead pitch detection. One-shots may end before long generated notes; do not introduce looping or time-stretching. Wide transposition can sound poor, so prioritize roots covering the generated bass range. Existing sampler automation methods intentionally do nothing.

**Proof command**

```sh
npm test && npm run test:ui
```

Register `tests/bass-samples.test.mjs` and `tests/bass-samples-audio.test.mjs`; extend real-sound UI fixtures. Test measured roots/cents, octave-error fixtures, silence/noise rejection, nearest-root playback rate, note-off/ties, actual offline spectra, live scheduling, user-bank precedence, cache reload, undo/version switching and synth fallback. All network responses and audio are local fixtures.

## Open questions

None blocking. Visionary decisions 1-6 settle the review points.

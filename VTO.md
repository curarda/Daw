# VTO — "Şarkı gibi demo": paketler, bölüm matrisi, bölüm bağı, sürümler

## Core Focus

A singer with no music theory should turn a vocal into a *song-shaped* demo (intro, verse, chorus with different density) in minutes by picking a genre pack, then fine-tuning a section × layer table, linking repeated sections and comparing named versions.

## What done looks like

- Press one button, pick one of 16 genre packs: drums, bass, chord sound, guitar and a per-section dynamics template are all set at once; ⟳ cycles to the next pack fit for the current tempo and meter.
- A section × layer table shows at a glance which layer (chords, guitar, bass, drums) plays in which section; it fills itself from the section type, the user can flip any cell, and playback, mix WAV and MIDI export all obey it.
- "Nakarat 2 = Nakarat 1": a linked section follows its source (chords, locks, section arrangement, matrix row) until the link is broken.
- Named versions A/B/C… of the arrangement (+ chords) can be saved, switched (also during playback for A/B listening), renamed and deleted; stored in the project JSON.
- `npm test` and `npm run test:ui` stay green; old project JSON files open unchanged.

## Decisions already made by the user (do not re-litigate)

1. **Pack list (16)**: Dream pop, Indie pop, Electro-pop, Alt rock, Indie rock, Post-punk, Synthwave, Darkwave, Alternative pop, Pop rock, Akustik, Balad (4/4), Synthpop, Dans/Elektronik, Vals (3/4 only), 6/8 Balad (6/8 only). The first 14 appear only in 4/4. Vals and 6/8 Balad appear only in their meter. (Duplicates "indie pop" and "4/4 balad" were merged.)
2. **Tempo never changes** when a pack is applied. The packs are ranked by fit to the user's current BPM and meter (pack BPM range / drum loop `bpm` range) and the top 3 are suggested first.
3. **Both scopes now**: a pack applies to the whole song AND carries a per-section dynamics template (which layers play in intro / verse / prechorus / chorus / bridge / outro, and extra energy for the last chorus). The template is written into the section × layer matrix.
4. **Apply behaviour**: applying a pack overwrites drums, bass, chord sound, guitar and the matrix; a layer the user marked **locked** is not touched. One undo step (Ctrl+Z) reverts the whole pack. ⟳ "Başka paket" moves to the next ranked pack under the same rules (locks keep the layer the user liked).
5. **Linked sections** are *live links* (source change propagates), only between sections of the same bar length; "bağı kopar" turns the target into an independent copy.
6. **Versions** store arrangement + chords (pack, matrix, section links, per-layer settings incl. drum loop / bass track / guitar parts / chord sound, chord choices and locks, mixer levels). They do not store recorded audio, note corrections or timing.

## Starting pack map (a starting point to tune by ear later; use only ids that exist in src/)

| Pack | Drums | Chord sound | Guitar | Bass |
|---|---|---|---|---|
| Dream pop | `ht-flat`, `ballad16` | synth-chord (hold) | arpeggio / long let-ring, Clean + chorus + delay + big reverb | `drone-halves`, Warm sub |
| Indie pop | `backbeat`, `pulse8` | piano-arp | folk / 8ths, Clean + chorus | bass guitar, `hook-walk` |
| Electro-pop | `clapsnare`, `ht-clap` | synth-chord | off | Synth saw, `offbeat-pulse`, pump |
| Alt rock | `syncokick`, `drive16` | piano-chord / off | Drive, `gallop` / `dotted` | Fuzz, `pedal-eighths` |
| Indie rock | `train`, `backbeat` | off / piano | Crunch, 8ths | bass guitar, `hook-walk` |
| Post-punk | `motorik`, `joydiv`, `fastpunk` | synth-chord | `skank` / `gallop`, Clean + delay | profile `post-punk-drive` |
| Synthwave | `gated`, `pulse8` | synth-arp | off | Moroder pulse, profile `synthwave-roll` |
| Darkwave | `ebm`, `ht-cine` | synth-chord | off | profile `darkwave-pulse`, Sub drone |
| Alternative pop | `ht-kick`, `ht-hat16` | piano-chord | off | Warm sub, `drone-pickup` |
| Pop rock | `backbeat`, `push332` | piano-chord | 8ths, Crunch | bass guitar, `pedal-eighths` |
| Akustik | `minimal`, `ht-rim` | piano-arp | folk, Clean | bass guitar, low density |
| Balad (4/4) | `ballad16`, `ht-flat` | piano-chord (hold) | long chord / arpeggio | `drone-halves` |
| Synthpop | `four`, `pulse8` | synth-arp | off | Synth saw, `octave-pulse` |
| Dans / Elektronik | `four`, `ebm` | synth-chord | off | Acid squelch, `acid-sixteenths` |
| Vals (3/4) | `w-basic`, `w-ballad` | piano-arp | Vals | `drone-34` |
| 6/8 Balad | `e-rim`, `ballad68` | piano-arp | 6/8 | `pulse-68` |

Known weak spots: Electro-pop / Synthpop / Dans / Synthwave are close; Alt rock / Indie rock / Pop rock are close. Bass profiles that exist: only post-punk-drive, darkwave-pulse, synthwave-roll (others use template family + density).

## Non-goals

- User-defined / saved custom packs, importing packs.
- New drum patterns, bass profiles or synth presets (reuse what exists).
- Vocal harmony, transpose, stem export, MP3 export, vocal FX in packs.
- Changing tempo or meter from a pack.
- Rewriting the existing guitar / bass / drum engines.

## Constraints and stack

- Single-file app built from `src/` by `node build.mjs` (writes `index.html`, which is committed). Edit `src/`, rebuild, commit both. New source files must be added to `build.mjs`.
- Plain JS, Web Audio + Tone transport, no new dependencies.
- UI text in Turkish, matching the surrounding wording and style; README.tr.md and README.md get a short section for each feature.
- Project JSON stays backward compatible: `openProject()` merges into `newProject()` defaults.
- The global undo stack (Ctrl+Z / Ctrl+Shift+Z) must cover pack apply, matrix edits, link / unlink; version switching must be undoable too.
- Matrix must be honoured by live playback, mix WAV export (offline render) and MIDI export.
- Section data lives in `d.sections` (`typeNorm` from `Core.normSectionType`); chords in `d.chords`; existing per-section settings for drums, bass, chord sound are the thing the matrix and links must build on, not duplicate.
- Existing tests keep passing (`npm test`, `npm run test:ui` with `TONE_JS=node_modules/tone/build/Tone.js`); each rock adds tests.

## Goals (Rocks, in dependency order)

1. **Section × layer matrix** with auto-fill by `typeNorm`, manual override, playback / mix / MIDI honouring it.
2. **Genre packs** (16, tempo-ranked, apply + ⟳ + layer lock, each with a matrix template).
3. **Linked sections** (live link, same bar length, break link).
4. **Named versions** (save / switch / rename / delete / A-B listen).

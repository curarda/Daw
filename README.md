# Mini DAW — Vocal to Harmony

A browser-based mini digital audio workstation. Record or upload a single-voice vocal, let it analyze the pitch, optionally correct it, then generate a piano accompaniment and a drum loop. Everything runs in one HTML file.

**Live app (installable on iPhone):** https://curarda.github.io/Daw/

## Who it is for

- Singers and songwriters who want a harmonized version of their own melody.
- Music students learning how a melody fits under chords.

## Why I built it

I wanted to hear how my own singing would sit over chords, and to get a chord progression and a MIDI file out of a melody without installing a desktop DAW.

## What it does

1. **Project setup:** tempo, time signature (4/4, 3/4, 2/4, 6/8) and click pattern, with latency calibration.
2. **Record or load:** count-in with metronome, or load a WAV/MP3 and align it to the bar grid. Projects saved only as **MIDI** can be reopened (**MIDI aç**): melody, sections and keys, chords, tempo, chord sound, bass and drums come back, and you keep editing (the melody plays as a synth).
3. **Pitch detection:** finds note events (start, length, pitch in cents) and separates them from breaths and silence.
4. **Sections and key:** mark sections and get key and mode suggestions for each one.
5. **Pitch and timing correction:** optional autotune (TD-PSOLA) and quantization, both reversible. Drag on empty space to select many notes and move them together (pitch and time), double-click a note to split it in two when the detector heard one sound, and shift the whole song by 1–2 bars to leave an intro gap.
6. **Chord detection:** diatonic chords and common extensions, using a sequence model that favors fewer chord changes and avoids clashing notes.
7. **Piano, synth, guitar, bass and drums:** piano (Salamander samples, built-in synthetic fallback offline) or a synth keyboard, each as block chords or an arpeggio, repeated chords struck once and held or faded, and an optional shuffle (X . t) cell;  a guitar rhythm layer built from independent choices (strum / arpeggio / boom-chick, 10 rhythm patterns with an editable step grid, voicing position / shape / sus-add9 colour / drone, slides, hammer-pull, vibrato, let ring / staccato / palm mute, tone and FX, per-section parts and saved presets) synthesised in the browser with Karplus-Strong; a generated bass line (the notes come from the chord track and each section's key, never from audio: 16 rhythm templates for bass guitar and synth bass, energy curve per section, 4-bar motifs with fills and boundary approaches, seeds, locks, re-rolls, pedal notes, loops, manual edits, undo, a Web Audio synth with 9 presets, tap-the-rhythm recording, and style profiles you can learn from a MIDI bass track or typed scale degrees, with an optional sampler for your own bass samples); and a drum library of 57 loops: 45 numbered rhythm patterns (backbeat, motorik, train, Bo Diddley, post-punk / darkwave / synthwave grooves, the half-time family, 3/4 waltz and 6/8 patterns, with toms, clap, rim click, ride, fills and a laid-back snare) plus the original basic loops. The app suggests a loop from the meter, tempo and melody accents; you can pick any pattern by hand. Pick the bar where chords enter and the bar where drums enter (drag the 🎹 / 🥁 flags on the ruler); each section can have its own drum loop, bass and chord sound, drum fills at section changes. A global sub-division (straight / triplet / swing, e.g. 70 %) puts guitar, bass and drums on the same grid.
8. **Fast demo:** one **✨ Demo yap** button estimates meter and tempo, confirms the keys, and switches on chords, drums and the generated bass line; **🔁 loop** a section and press **⟳** to hear the next drum loop or chord sound right away; **Ctrl+Z / Ctrl+Shift+Z** undo and redo everything except recording and mixer levels.
9. **Learn from your choices:** press **✅ Progresyonu bitirdim** when a progression is done. The whole progression is learned as a weighted song (transitions, three-chord context, openings and closings, durations), and for every chord you chose by hand its relation to the chord before and after it counts as a like. 👍 / 👎 on the chord panel do the same, and 👍 / 👎 next to ⟳ teach the drum-loop and chord-sound ranking. Anything you pick by hand always wins.
10. **Vocal cleanup and auto mix:** optional noise reduction, compressor, level matching (−18 dBFS) and reverb on the recorded vocal, the same processed sound for playback and export; 🎚 sets the instrument levels relative to the vocal, and the master output is limited to −1 dBFS.
11. **Punch-in:** re-record only the bars you pick while the backing music, metronome and the old vocal play before the region; the new take is spliced into just that range (sample-aligned, same AudioContext) and the old and new takes are kept so you can switch between them. A live pitch meter (note name and cents) shows while you sing.
12. **Export:** MIDI (vocal, piano / guitar, bass, drums), chord sheet (.txt), corrected vocal WAV, vocal + piano / guitar / bass (+ drums) mix WAV, and a project JSON file.

## Run locally

Open `index.html` in a browser. To rebuild it from `src/` after editing:

```bash
node build.mjs
```

Tests:

```bash
npm install
npm test
```

## Install on iPhone

1. Open the live link in **Safari**.
2. Tap Share → **Add to Home Screen**.

The piano samples load from a CDN, so the first playback needs a connection. The app shell works offline.

## Tech

JavaScript, Web Audio API, Tone.js, custom pitch detection (YIN-based), Playwright for UI tests.

The original Turkish documentation is in [README.tr.md](README.tr.md).

## Section × layer matrix

**4b → Otomatik aranje** is off by default. Enabling it keeps manual choices. Rows are sections (or **Tümü** without sections); columns are Akor (piano), Gitar, Bas and Davul. Dashed cells are automatic, solid cells manual. Click once for the opposite of the template, again to return to automatic. **Otomatiğe dön** resets a row; **Hepsini otomatiğe döndür** resets all rows. Every action is a separate Ctrl+Z / Ctrl+Shift+Z step and survives project save/load. Globally disabled layers cannot be enabled here.

| Section type | Piano | Guitar | Bass | Drums |
|---|---|---|---|---|
| Intro | On | On | Off | Off |
| Verse | On | On | On | Off |
| Prechorus | On | On | On | On |
| Chorus | On | On | On | On |
| Bridge | On | On | Off | Off |
| Outro | On | On | Off | Off |
| Other / All | On | On | On | On |

Playback, mix WAV and MIDI follow the same matrix. Held notes stop at disabled section boundaries; normal release and effect tails may remain audible. Gaps between sections follow the global arrangement. With the matrix off, the existing arrangement is unchanged.

## Genre packs

**4a → Tür paketi** sets the drum loop, bass sound and generated line, chord sound, guitar part, instrument availability and section dynamics together. It enables the matrix without changing BPM or meter. Packs are ranked by distance from their BPM range; **Tempoya uygun** offers the top three. **Uygula** applies the selection; **⟳ Başka paket** cycles through the ranking and wraps. Playback restarts only if already playing.

| Pack | Character |
|---|---|
| Dream pop | Spacious synth chords, ringing arpeggios and warm drone bass; drumless verses. |
| Indie pop | Piano arpeggios, clean folk guitar and walking bass. |
| Electro-pop | Synth chords, clap drums and pumping synth bass; chords-only intro. |
| Alt rock | Driven gallop guitar, fuzz bass and syncopated drums. |
| Indie rock | Crunch eighths, walking bass and train drums. |
| Post-punk | Clean skank guitar with delay, driving bass and motorik drums. |
| Synthwave | Synth arpeggios, Moroder bass and gated drums. |
| Darkwave | Sub bass and electronic drums with a sparse opening. |
| Alternative pop | Piano chords, warm drone bass and half-time drums. |
| Pop rock | Piano chords, crunch guitar and pedal bass. |
| Akustik | Clean folk guitar, piano arpeggios and sparse bass. |
| Balad (4/4) | Held piano chords, ringing guitar and gentle drone bass. |
| Synthpop | Synth arpeggios, pulsing synth bass and four-on-the-floor drums. |
| Dans / Elektronik | Acid bass and electronic dance drums. |
| Vals | 3/4 piano arpeggios, waltz guitar and drone bass. |
| 6/8 Balad | 6/8 piano arpeggios, ringing guitar and dotted-quarter bass pulse. |

The first 14 packs support 4/4; Vals supports 3/4 and 6/8 Balad supports 6/8 (dotted-quarter BPM). There are no 2/4 packs. **Kilitle: Akor / Gitar / Bas / Davul** keeps that layer's settings and effective matrix column when another pack is applied. Existing section guitar parts and locked bass material are preserved; warnings and kept layers appear below the controls and in the status bar. At least one chord instrument stays available.

The last chorus uses the pack's alternate drum loop unless a section drum choice overrides it, and opens all globally available layers unless a manual matrix cell says off. Turning **Otomatik aranje** off disables both the pack template and this extra; the pack's global sounds and settings remain. Applying a pack and each lock toggle are separate Ctrl+Z / Ctrl+Shift+Z steps, including bass settings and notes. Pack selection and locks survive project save/load.

## Linked sections

In the sections panel, **Bağla:** connects a section to another section of the same bar length. Chains are allowed; cycles are rejected. The **↻** badge and timeline label identify live links. Chords and their lock/pin/change marks, section arrangement, matrix row, guitar part and bass bars/settings follow the source. The last-chorus extra still follows the target's position.

Inherited controls are read-only. **Kaynağı düzenle** jumps to the source; **Bağı kopar** creates an independent copy with identical sound. Link/unlink and structural changes are separate Ctrl+Z / Ctrl+Shift+Z steps. Deleting or resizing a source/target, or shifting the song's bars, first materializes affected links. Bulk chord/chart/style tools skip linked targets and report it. Links survive project save/load.

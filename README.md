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
11. **Export:** MIDI (vocal, piano / guitar, bass, drums), chord sheet (.txt), corrected vocal WAV, vocal + piano / guitar / bass (+ drums) mix WAV, and a project JSON file.

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

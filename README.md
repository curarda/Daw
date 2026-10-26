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
7. **Chord sound and drums:** piano (Salamander samples, built-in synthetic fallback offline) or a synth keyboard, each as block chords or an arpeggio; a repeated chord is struck once and held or faded instead of every bar; pick the bar where chords enter and the bar where drums enter (drag the 🎹 / 🥁 flags on the ruler). Simple drum loops with fills at section changes, plus a bass line (locked to the kick, root–fifth, walking, …) chosen automatically from the drums and meter. Each section can have its own drum loop, bass and chord sound.
8. **Fast demo:** one **✨ Demo yap** button estimates meter and tempo, confirms the keys, and switches on chords, drums and bass; **🔁 loop** a section and press **⟳** to hear the next drum loop, bass pattern or chord sound right away; **Ctrl+Z / Ctrl+Shift+Z** undo and redo everything except recording and mixer levels.
9. **Export:** MIDI, chord sheet (.txt), corrected vocal WAV, vocal + piano mix WAV, and a project JSON file.

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

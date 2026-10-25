# Bass layer — plan (step zero)

Written before the code, from reading the app. The bass plugs into what exists; nothing is replaced.

## What I found

1. **Chords.** `derive()` returns `d.chords`: one slot per chord, `{q0, q1, bar, chord:{root,q,bass?}, section, flats}`. Time unit is the **quarter note** (`q`); `bar` is 1-based; one bar can hold two chords (half-bar slots in 4/4 and 6/8). The guitar layer reads them through `Core.guitarSlotsFrom(d)` → `{q0,q1,chord,section,tonic}`. The bass uses the same slots. Chords can exist without a melody: sections with a key plus locked chart chords are enough, so the demo song needs no audio.
2. **Sections.** `d.sections`: `{id, name, startBar, endBar, tonic, mode, confirmed, pcs, typeNorm}`. `typeNorm` (intro, verse, prechorus, chorus, postchorus, bridge, instrumental, outro, other) comes from `Core.normSectionType(name)`, so energy defaults can be keyed by it. With no sections an implicit `_all` section exists.
3. **BPM / meter / transport.** `proj.settings.{bpm, meter}`; `Core.makeGrid()` gives `barQ`, `spq` (seconds per quarter), `pulseSec`. Meters: 4/4, 3/4, 2/4, 6/8 (`barQ` 4, 3, 2, 3). Playback uses `Tone.Transport.schedule(cb, seconds)`; the callback gets the audio-clock `time`. Drums and piano schedule that way. The guitar renders one offline buffer instead.
4. **Piano / guitar interface.** `Core.pianoEvents(chords, g)` and `Core.guitarEvents(slots, g, getPart)` turn the chord track into events in seconds. The bass follows the guitar pattern: `Core.bassEvents(...)` turns stored bass bars into events, and a `Player` method schedules them.
5. **Audio.** One `Tone` context. Each layer has a `Tone.Channel` going straight to the destination (no master chain). Gain staging is the mixer strip (dB, mute, solo). The bass gets `bassCh` and a `bass` strip.
6. **Save / load / undo.** `saveProject()` stringifies `S.proj`; `openProject()` merges into `newProject()` defaults. There is **no general undo** (only per-feature "reset"). I add a 50-deep snapshot stack for the bass track, as the spec allows.
7. **UI.** The timeline is one canvas with ruler, section and chord strips, then the pitch roll, with horizontal scroll through `qToX()`. Controls live in the left `aside` as `<details class="step">` blocks; chips and sliders reuse the guitar panel's CSS. Existing keys: Space, `T` (chord-change tap), `L` on a selected note, arrows, Delete, Esc.

## Conflicts and decisions (spec ambiguities, simplest option)

- **Beat = quarter note.** `startBeat` and `durationBeats` are quarters relative to the bar start. The 16-step grid is sixteenth notes (0.25 q), so 4/4 has 16 steps, 3/4 and 6/8 have 12, 2/4 has 8.
- **No audio library.** The synth is plain Web Audio nodes. Tone is used only for the transport and the channel, as the other layers do.
- **One lane, drawn below the pitch roll** on its own canvas that shares `qToX()` (same bar alignment as the chord names, which are repeated in a thin strip inside the lane). Changing the existing canvas layout was not worth the risk.
- **Shortcuts.** `L` and `R` act on the bass selection only when bars are selected in the bass lane. Selecting a bass bar clears the timeline selection and the other way round, so the note-lock `L` does not clash. Tap recording uses `B` (`T` is taken).
- **Volume** is the spec's 0..1 on the track; the mixer strip (dB, M, S) stays for consistency with the other layers.
- **Motif = template + pitch-role sequence.** A phrase motif is drawn from a phrase-level random stream (seed, section, phrase index), so every bar of a phrase can be recomputed alone. Re-roll gives a bar its own stream (seed, bar, reroll count) and a fresh template and roles.
- **Phrase shape** (spec does not give numbers): energy offset −0.03, 0, +0.02, +0.05 for bars 1..4 of a phrase.
- **First onset of every chord segment is the anchor**, even when the template has no step-0 onset (offbeat-pulse), so "bar that starts a new chord begins on the root" always holds.
- **Missing pickup.** At a section end, if the template has no pickup slot, the last slot is shortened and a 2-step pickup is appended.
- **Energy shift** moves weight between root↔octave for strong slots and repeat↔octave for weak slots (the weak table has no root).
- **Hammer of the spec's "avoid note"** rule: a scale step that sits a half step above a chord tone is skipped on strong slots.
- **Dirty detection.** Each bar stores a signature of its chords, key, meter and the next bar's first chord. A mismatch means dirty; unlocked dirty bars regenerate in `refresh()`, locked ones get a warning and a Re-fit button.
- **Tapped bars** keep their custom rhythm template; Generate all re-pitches them but never changes the rhythm. A re-tap replaces only the selected bars.
- **No MIDI keyboard input** (the app has none), so tap velocity is fixed.
- **Filter automation** is derived at playback from section settings and applied with ramps on the audio clock; the offline mix export builds the same graph in an `OfflineAudioContext`.
- **Stereo:** the whole bass stays mono; no widening is added.
- **Sampler.** The repo ships no bass recordings. The sampler implements `BassInstrument` and loads user-supplied sample files (one per note or per minor third, two round-robins, a release sample). It stays inactive until samples are loaded.
- **Style learning energy.** Reference songs have no energy track, so each reference bar gets an energy from its onset density and velocity, then bars are split into three tertile buckets.
- **Profiles** live in the project and are mirrored to `localStorage` (guarded) so they survive new projects.

## Files

- new `src/bass.js` (DOM-less, in the core script): data model, templates, profiles, pitch rules, generator, loops, pedal, tap quantising, MIDI read/write, style learning, snapshots.
- new `src/basssynth.js` (core script, Web Audio only when instantiated): `BassSynth`, `BassSampler`, presets.
- new `src/bassui.js` (inside the app IIFE): lane, panel, player integration, tap recorder, demo song.
- changed `src/core.js` (project default, MIDI export), `src/app.js` (Player hooks, refresh, export, mixer), `src/template.html`, `src/style.css`, `build.mjs`, tests, README.

## Phases

1. Foundation. 2. Movement and control. 3. Tap rhythm. 4. Style profiles. Each phase is committed after its checks pass.

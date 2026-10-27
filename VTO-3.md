# VTO-3 — Autotune'u kendi nota kümene çek

Cycle 3 (one rock). Conventions of VTO.md / VTO-2.md still hold (single-file app built from `src/` by `node build.mjs`, plain JS, Turkish UI, no new dependencies, global undo, project JSON backward compatible, tests for everything, `npm test && npm run test:ui` stay green).

## Core Focus

The user marks which notes of a section are "allowed" (e.g. D, E, G, F#, D#, C, B: not a scale) and autotune moves every sung note to the nearest allowed note, looking both up and down, so a singer whose melody is not a standard scale can still be tuned in one step.

## What done looks like

- In the "Otomatik (autotune)" box a third target **"Kendi nota kümene çek"** next to "En yakın yarım ses" and "Bölüm scale'i".
- Choosing it shows a 12-key pitch-class picker (C, C#, D … B) **per section** (section selector; the selected section's set is edited), a button **"Şarkıdaki notalardan doldur"** and a shortcut **"Şarkının hepsine uygula"** (copies the current section's set to all sections).
- "Şarkıdaki notalardan doldur" marks the pitch classes that are sung for at least **3 % of the section's total sung time** (stray mis-detected notes stay out); the user then toggles keys by hand.
- Autotune moves each detected note (using its actual measured pitch, not only its rounded name) to the **nearest allowed pitch class**, up or down; on an exact tie it goes **down** (e.g. C# with C and D both allowed → C), matching the existing scale mode. Sections whose set is empty are not touched by autotune.
- Works with the existing amount / retune speed / keep-vibrato controls, manual note edits still win, locked notes untouched, undo/redo, save/load; MIDI/WAV exports use the corrected vocal as today. The sets belong to the vocal correction, not to named versions (see non-goals).

## Decisions already made by the user (do not re-litigate)

1. The note set is **per section** (with a "whole song" shortcut).
2. "Şarkıdaki notalardan doldur" marks only **frequently sung** pitch classes (>= 3 % of the section's sung time).
3. Rounding rule: **nearest allowed note by actual pitch, tie -> lower** (her iki yöne bak: yukarı ve aşağı).

## Design notes (from reading the code; keep unless a test shows otherwise)

- `computeCorrection` (src/core.js, AUTOTUNE_DEFAULTS at ~609) already has `target: 'scale'` using `nearestScaleNote(median - refCents/100, n.scalePcs)`; ties already go down. The new target `'custom'` reuses that path with the section's custom pitch-class set instead of the scale. `nearestScaleNote` searches only +-2 semitones around the pitch: with a sparse set the nearest allowed note can be further away, so the search window must be widened (any non-empty set has a member within 6 semitones).
- In custom mode the "Kromatik geçiş notalarına dokunma" option does not apply (the user wants every note snapped); say so in the UI hint.
- Same bookkeeping as scale mode: the note's identity may change (`identityChange`); chords keep following the heard (corrected) notes exactly as the existing scale mode does; warn in the UI like the scale mode warning, adapted ("kümen dışındaki notalar başka notaya taşınır").
- The sets are part of the vocal-correction state, stored in the project (e.g. `autotune.customSets: { [sectionId]: [pcs…] }` and `autotune.target: 'custom'`); `''` / missing sets mean "not touched". Legacy projects load unchanged. Linked sections: a linked target uses its own set (links cover arrangement/chords, not vocal correction).

## Rock

9. **Custom note set autotune**: core target + per-section sets + fill helper + UI + undo + save/load + tests + README. One pass is enough (small); stages optional: 9a core + tests, 9b UI + docs.

## Non-goals

- Changing the chord engine, key/scale suggestion, or the detector.
- Putting the sets into named versions (vocal correction is not arrangement).
- Per-note allowed sets, octave restrictions, microtonal sets.
- Any Freesound/Gemini work (Rocks 6-8 are separate).

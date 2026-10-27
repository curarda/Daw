# SAME PAGE LOG — cycle 3

## Round 1 — Codex review (verbatim)

1. [major] Stale-set cleanup is specified only for open/history restore; deleting sections or shifting bars can leave stale entries in saved projects. `_all` also needs explicit validity handling when `proj.sections` is empty. @ PLAN-3 Data model; src/core.js:1868; src/app.js:2539 -> Normalize against current section IDs before signatures/history capture on refresh, preserving `_all` only for the implicit section; test deletion, save, undo, and later section creation.

2. [major] “One undo step” lacks transaction boundaries: ordinary `refresh()` commits coalesce within 500 ms, so fill/copy can merge with preceding or subsequent edits. @ PLAN-3 Approach 10; src/app.js:360 -> Specify isolated before/after commits, suppress intermediate commits, and reset the coalescing clock afterward. Test toggle→fill→copy→toggle without delays, undoing each separately.

3. [major] Duration tests do not explicitly exercise the real derive/split pipeline. Quantize changes mapped section membership, while `noteSplits` recomputes each fragment’s median and duration; synthetic helper inputs alone cannot verify the agreed original-duration rule. @ PLAN-3 Approach 6–8; src/core.js:1802; src/core.js:1937 -> Add integration fixtures with unequal time warping, a note moved across a section boundary, and split fragments with different pitches; assert original-duration weighting and whole-note membership.

4. [major] Label overrides have two distinct effects that the proposed tests leave unspecified: fill deliberately uses `nearest`, key histograms use `label`, and automatic audio correction still runs despite a label. @ PLAN-3 Facts / Approach 5–8; src/core.js:538; src/core.js:632; src/core.js:1989 -> Test a label-only override explicitly: fill uses detected pitch, audio targets the custom set, chord identity retains the label, and changing custom sets leaves the label-aware key histogram unchanged.

5. [major] Render-signature capture alone does not complete rapid-edit handling. `doRender()` yields after capturing work; a newer refresh can occur before the older result is published, and completion does not itself schedule the latest pending state. @ PLAN-3 Approach 11 / Risks; src/app.js:449–463 -> Define a generation/completion check that rejects obsolete results or schedules current work afterward. Test an edit and undo during the render yield, asserting final readiness and audio correspond to the latest state.

6. [major] Named export tests lack output-level acceptance criteria; successful downloads, WAV headers, or altered shift arrays would not prove corrected export pitch. @ PLAN-3 Proof command / named export test -> Parse exported MIDI pitches and analyze a stable interior portion of exported vocal WAV against the expected custom target, with original/custom-empty controls and rendering initially pending.

7. [minor] “12 accessible toggles” does not specify semantics or focus preservation during refresh-driven picker rebuilding. Keyboard users could lose focus after every toggle. @ PLAN-3 Done looks like / Approach 9–10; src/app.js:166 -> Specify native checkboxes or buttons with `aria-pressed`, a labeled section selector/group, keyboard operation, associated hints, and retained focus after toggles, fill, copy, and undo; add browser assertions.

VERDICT: NOT YET (reasons above)
## Round 1 — Visionary responses

1. **Accept.** `customSets` is normalized against the CURRENT section ids on every refresh, before signatures and history capture; `_all` is valid only while `proj.sections` is empty and is dropped once real sections exist (Visionary decision 3 made precise). Tests: delete a section, save/load, undo, later section creation.
2. **Accept.** Fill / whole-song copy / toggles use the isolated transaction pattern: `histCommit()` before, intermediate commits suppressed, `HIST.t = -Infinity` after. Test toggle -> fill -> copy -> toggle without delays, undone one by one.
3. **Accept.** Integration fixtures through the real derive/split pipeline: unequal time warping, a note moved across a section boundary by quantize, `noteSplits` fragments with different pitches; assert original-duration weighting and whole-note membership.
4. **Accept.** Label-only override test: fill uses detected pitch (`nearest`), the audio targets the custom set, the chord identity keeps the label, and changing custom sets leaves the label-aware key histogram unchanged.
5. **Accept.** `doRender()` gets a generation check: an obsolete result is discarded and the latest pending state is scheduled afterward. Test an edit and an undo during the render yield; final readiness and audio correspond to the latest state.
6. **Accept.** Export acceptance is output-level: parse the exported MIDI pitches and analyze a stable interior portion of the exported vocal WAV against the expected custom target, with original and empty-set controls, starting while rendering is pending.
7. **Accept.** Native checkboxes (or `aria-pressed` buttons) inside a labeled group with a labeled section selector, associated hints, full keyboard operation; the picker updates in place (or restores focus) after toggle, fill, copy and undo. Browser assertions for focus retention.

No finding rejected.

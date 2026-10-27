# VTO-2 — "Akorlarım kalsın, gerisini tür kursun" + gerçek sesler (Freesound + Gemini)

Cycle 2. Cycle 1 (VTO.md: matrix, packs, linked sections, versions) is merged to main; read VTO.md for conventions that still hold (single-file app built from `src/` by `node build.mjs`, plain JS, Turkish UI, no new dependencies, global undo, project JSON backward compatible, every rock adds tests, `npm test && npm run test:ui` stay green).

## Core Focus

A singer keeps the chords they chose, picks a genre pack, presses Demo yap, and gets a full arrangement; optionally the drums and bass play real CC0 sounds fetched from Freesound and chosen by Gemini, with no server and no sound ever leaving the user's browser.

## What done looks like

- A persistent switch **"Akorları koru"**: while on, Demo yap, applying a pack and ⟳ never change the chords; everything else (drums, bass, chord sound, guitar, dynamics, matrix) follows the pack the user selected.
- **Demo yap** applies the pack currently selected in the "Tür paketi" panel (it never picks one itself); with the switch on it leaves chords alone.
- A settings area where the user enters their own **Freesound API key** and **Gemini API key** (kept only in the browser).
- **Gerçek sesler** (real sounds): a drum **one-shot kit** (kick, snare, hat, … per drum lane, CC0 only) fetched from Freesound drives the existing pack drum patterns instead of the built-in synthesized drums; a **bass sampler** is fed with CC0 bass one-shots. Choices are made per song by Gemini (search queries + picking among candidates by metadata) with a deterministic non-Gemini fallback. Playback, mix WAV and project save/load all work; fetched sounds are cached in the browser so a song is stable and works offline after the first fetch.
- Every fetched sound used is listed (name, author, Freesound link, license CC0) in the project and in the chord-sheet/export text.

## Decisions already made by the user (do not re-litigate)

1. **Akorları koru** is a persistent on/off switch (not a one-shot lock). The user chooses the pack; Demo yap uses the selected pack.
2. **Sound source: Freesound** (official API, CC0 only). Splice is out of scope (no public developer API found; its terms reportedly restrict AI use of Sounds).
3. **Layers in the first version: drums + bass.** (The user said "davul + bas / pad"; a new pad layer is deferred, see non-goals.)
4. **Keys: the user's own Freesound and Gemini keys**, entered in settings, stored only in the browser (guarded localStorage), no server.
5. Previews only (Freesound original downloads need OAuth); lower quality is accepted.

## Verified facts (do not assume otherwise; re-verify only if a call fails)

- `https://freesound.org/apiv2/...` and `https://cdn.freesound.org/...` both send `access-control-allow-origin: *`; preflight allows the `authorization` header. Unauthenticated search returns 401 (a key is required). Sound previews (`previews.preview-hq-mp3` / `preview-hq-ogg`) are available with the API key; original files need OAuth2 (not used).
- The Gemini API (`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`) answers CORS preflight for the Pages origin `https://curarda.github.io` and allows the `x-goog-api-key` and `content-type` headers, so it can be called directly from the page. The model name must be an editable setting with a sensible default (names change over time).
- Freesound rate limits are not officially verified (third-party figure ~60 requests/min and a few thousand/day on free keys): the client must throttle, cache aggressively (IndexedDB), stay well under that, and show a clear message on 429.
- Whether Freesound lets one filter by BPM/key analysis fields with an ordinary key is NOT verified; tests must not depend on it. Use text search, `duration`, `license` and tag filters, and measure pitch/length locally with the app's own detector on the decoded preview.
- Sessions that build this have no Freesound/Gemini key: all automated tests must run against recorded/mocked responses (fixtures) and offline fixture audio; real-API behaviour is verified later by the user with their keys.

## Rocks (dependency order; do less better)

5. **Akorları koru + Demo yap with the selected pack.**
6. **Freesound client, settings and CC0 drum kit**: keys UI, throttled client with IndexedDB cache, license guard (CC0 only, reject anything else even if returned), decoded one-shot kit per drum lane replacing the synth drum voices in playback and mix WAV (the pack's drum pattern engine is unchanged; only the voice source changes), deterministic non-Gemini selection, credits list. Project stores the chosen sound ids (not audio) and re-fetches/caches on open.
7. **Gemini selection**: from the song analysis (tempo, key/mode, genre pack, section types, user's vocal energy) Gemini proposes search queries and picks one candidate per lane from candidate metadata only (names, tags, durations, descriptions; never audio), returning strict JSON that is validated; any failure, timeout, 4xx/5xx or invalid JSON falls back to Rock 6's deterministic selection with a visible message; re-roll button (new choice, undoable); a short "why" text per choice.
8. **Bass sampler from Freesound**: the existing `BassSampler` (user sampler: pitch-shifts the nearest sample) is fed with CC0 bass one-shots; the root pitch of each fetched sample is measured with the app's detector; bass notes from the existing generated bass track play through it; chosen by Gemini/fallback like drums; if no usable sample is found the synth bass stays.

## Non-goals

- Splice, any other sample marketplace, uploading/sharing the user's audio, original-quality downloads/OAuth, a server or proxy.
- A pad / sample chord layer, loop (stretch-to-tempo) drums, melodic samples beyond bass one-shots, AI audio generation.
- Changing the existing packs' catalog, patterns or the chord engine; auto-picking a pack.

## Constraints

- No API key is ever written into the project JSON, a README, a log or a test fixture; keys live only in the settings store and are masked in the UI; the Gemini request must send no audio and no personal data beyond song analysis summary and candidate metadata.
- No new npm dependencies; Web Audio only; same single-file build.
- All new network code goes through one small module with injectable `fetch` so tests run with fixtures; failures never break playback (silent fallback to built-in sounds plus a visible status).
- Existing behaviour is byte-identical when the new features are off (golden/matrix/packs/links/versions tests unchanged).

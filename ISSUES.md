# ISSUES — deferred (not in the current rocks)

- **Demo yap should pick the best-ranked genre pack** for the current BPM / meter (instead of the single hard-wired demo arrangement). Natural follow-up once Rock 2 lands. (Visionary, deferred.)
- User-defined / saved custom packs.
- Bass style profiles for pop / folk / ballad (only post-punk-drive, darkwave-pulse, synthwave-roll exist today).
- **Matrix cell click on a pack's last chorus**: the automatic cell of the last chorus is "on" because of the positional extra, but the first click computes "opposite of the *template*" (which may also be "on"), so the first click can look like a no-op; the second click returns to automatic. Cosmetic; fix by deriving the click target from `effectiveCell` instead of the template.
- **Locked-layer matrix columns that are globally off** get explicit `false` cells when a pack is applied; if the user later turns that layer on, those cells stay off until reset. Edge case.
- **Pack templates are a starting map** (VTO): several verses are sparse (e.g. alt-rock verse = guitar only); tune by ear.

## Next cycle (decided by the user; start with Grill -> VTO-2.md after Rock 4)

**Rock 5 — "Akorları koru" + Demo yap with the user's chosen pack**
- A persistent on/off switch "Akorları koru" (not a one-shot lock): while on, Demo yap, pack apply and ⟳ never change the chords (all current chords are treated as locked).
- The user picks the pack; Demo yap applies the currently selected pack (it does not auto-pick). Drums / bass / chord sound / guitar / dynamics follow the genre pack; only chords stay as chosen.

**Rock 6 — Real sounds from Freesound (instead of the built-in synth drums/bass), chosen by Gemini**
- Source: Freesound API (official). Browser calls work directly: verified `access-control-allow-origin: *` on both `freesound.org/apiv2` and `cdn.freesound.org`. Previews (HQ mp3/ogg) only; original downloads need OAuth, so previews are the source (lower quality, accepted).
- License policy: **CC0 only** (no attribution needed).
- Layers in the first version: **drums + bass / pad** (tempo-stretch for loops; pitch/key fit for bass/pad using the app's existing TD-PSOLA/WSOLA tools).
- Keys: the user enters their own **Freesound and Gemini API keys** in settings, stored only in the browser (localStorage, guarded); no server. A deterministic non-Gemini fallback (tag/duration/BPM heuristics) must exist when no Gemini key is set.
- Gemini role: from the song analysis (key, tempo, genre pack, sections) it proposes search queries and picks among candidate metadata (tags, duration, name, analysis fields); it never receives audio.
- Splice is out of scope: no public developer API found and its terms reportedly restrict AI use of Sounds (unverified, to be read by the user).
- Check before building: Freesound rate limits (third-party figure ~60 req/min, unverified), how `analysis`/BPM/key fields can be filtered with the user's key.

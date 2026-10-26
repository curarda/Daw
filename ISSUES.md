# ISSUES — deferred (not in the current rocks)

- **Demo yap should pick the best-ranked genre pack** for the current BPM / meter (instead of the single hard-wired demo arrangement). Natural follow-up once Rock 2 lands. (Visionary, deferred.)
- User-defined / saved custom packs.
- Bass style profiles for pop / folk / ballad (only post-punk-drive, darkwave-pulse, synthwave-roll exist today).
- **Matrix cell click on a pack's last chorus**: the automatic cell of the last chorus is "on" because of the positional extra, but the first click computes "opposite of the *template*" (which may also be "on"), so the first click can look like a no-op; the second click returns to automatic. Cosmetic; fix by deriving the click target from `effectiveCell` instead of the template.
- **Locked-layer matrix columns that are globally off** get explicit `false` cells when a pack is applied; if the user later turns that layer on, those cells stay off until reset. Edge case.
- **Pack templates are a starting map** (VTO): several verses are sparse (e.g. alt-rock verse = guitar only); tune by ear.

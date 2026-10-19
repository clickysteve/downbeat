# Kits

**KITS** (the KITS button, or AUDIO → KITS) saves, loads and exchanges kits, and holds the
sample library. It is DOWNBEAT's view of the shared Slop Factory kit system in Slop Factory Core
(`@slopfactory/core/kits`, see Core's
[docs/KITS.md](https://github.com/clickysteve/slopfactory-core/blob/main/docs/KITS.md)): the same
library, kit workflow and kit files as The Breakery.

## What a kit is here

A kit is **the samples of the drum sounds** (the SAMPLE BANK): which sample each drum sound
plays, with its sample settings (volume, pan, tune, fine, velocity sensitivity, mode, release,
sample transformation, choke group). Loading a kit changes only those, as **one undoable step**
(UNDO brings the previous sounds back). It never changes voices, their notes, internal sounds,
gates or MIDI channels; patterns, strikes, density, fills, probability, groove, evolution, the
song; voice and master processing, the OUTPUT CHAIN or VOLUME; or MIDI. Sample assignment and
rhythm are separate: changing a kit never regenerates or resets a pattern.

Drum sounds playing their INTERNAL sound are not part of a kit. **OTHER SOUNDS** (beside LOAD)
says what happens to drum sounds a kit has nothing for: **KEEP** (the default) leaves them as
they are; **INTERNAL** puts them back on their internal sound.

## The window

- **CURRENT KIT**: the name, SAVED or UNSAVED CHANGES, **SAVE** (over the current kit, renamed
  to NAME if you changed it; or a new kit), **SAVE AS NEW**, **NEW KIT** (every drum sound back
  to INTERNAL, undoable), **EXPORT KIT** (the current sounds, unsaved changes included, as a kit
  file), **IMPORT KIT…** (a kit file: saved here, then loaded).
- **SAVED KITS**: select one (click, or Tab to the list, ↑ ↓, Enter or Space) to see what
  loading it would do to each drum sound before you load it, then **LOAD**, **DUPLICATE** (shares
  the samples), **EXPORT**, **SET DEFAULT** (★), **DELETE** and **RENAME**.
- **SAMPLE LIBRARY**: every sample kept in this browser, with its length, sample rate,
  channels, format, size, how many kits use it and which drum sounds play it. Import files
  (IMPORT SAMPLES…, several at once, or drop them on the drop zone), **▶** or **PREVIEW** to hear
  one on its own (it never goes through the sequencer, a voice or the transport), **ASSIGN** it
  to the drum sound selected in the list below (no second import; undoable), **DELETE SAMPLE**
  (refused while a kit or a project uses it), **DELETE UNUSED**.

Anything that would lose work asks first in the window (a bar with the action and CANCEL):
NEW KIT, LOAD and IMPORT with unsaved kit changes, saving under the name of another kit,
DELETE. Escape closes the window. While it is open the keyboard shortcuts are off, so typing a
kit name (spaces included) never starts or stops playback.

## Drum sounds and roles

Kits name instruments by role, so they map onto any instrument. A drum sound's role comes from
its voice's internal sound (KICK `kick`, SNARE `snare`, CLAP `clap`, RIM `rim`, CL HAT
`hat-closed`, OP HAT `hat-open`, LO / MID / HI TOM `tom-low` / `tom-mid` / `tom-high`, COWBELL
`cowbell`, SHAKER `shaker`, CLAVE `clave`, CONGA `conga`, CRASH `crash`, RIDE `ride`, ZAP `fx`;
a voice with no internal sound from its family). A later sound step takes the role of its
General MIDI note when it has one (CL HAT step 2 sends 44: `hat-pedal`), else its voice's.
Several drum sounds of one role are told apart by index (SNARE 1 and SNARE 2).

Loading a kit: each drum sound takes the kit's instrument of its role and index; a drum sound
still without one takes the closest role it accepts (toms each other, crash and ride each
other, PEDAL HAT a closed hat, CLAP / RIM / COWBELL / SHAKER / CLAVE / CONGA a PERC instrument,
in voice order). A drum sound plays one sample.

**Nothing is dropped.** A kit from The Breakery may have GHOST SNARE (no drum sound plays it),
or several HAT samples (CL HAT 1 plays the first): those instruments and samples stay in the
kit, and their audio in the library. The window lists them ("GHOST: not played here; 1 sample
kept in the kit and the library"). Saving the kit again in DOWNBEAT keeps them, so a kit that
goes from The Breakery to DOWNBEAT and back comes back whole.

## Storage

| Where | What |
|---|---|
| IndexedDB `downbeat-samples` (as before) | the original bytes of every sample, once, keyed by SHA-256 |
| IndexedDB `downbeat-kit-library` | saved kits, the sample index (names, formats, durations), the default and current kit |
| the project (as before) | the drum sounds' sample ids and settings, autosaved |

Kits refer to samples; duplicating or renaming a kit copies no audio. A sample used by a saved
kit is never deleted (PURGE UNUSED SAMPLES and DELETE UNUSED keep it). At startup DOWNBEAT
opens your autosaved project with its own sounds, as always, and takes the kit you last saved or
loaded as the current kit (UNSAVED CHANGES if the sounds changed since).

Browser storage belongs to the page's address and browser profile: The Breakery (another
address) cannot see these kits. **Kit files** carry them: EXPORT KIT writes `<name>.kit.zip`
(Core's portable format: a manifest and the original audio of every sample, plus DOWNBEAT's
sample settings), which IMPORT KIT reads in any browser, and The Breakery imports too.

**Existing data.** Nothing is migrated destructively. Projects keep their format (2) and their
sounds. On first start, the samples your autosave and saved projects use are added to the
library index (their audio is already stored; nothing is copied). DOWNBEAT had no kits before,
so there is nothing else to move. The internal sounds and the default kit of voices (NEW
PROJECT) are unchanged.

## Bundled kits

`src/audio/bundledKits.ts` lists kits shipped with DOWNBEAT, installed into the library on first
launch by Core's `installBundledKits` (once per id and version, never over your kits; deleting
one is respected). There are none yet. To add one (for example a kit recorded by Keith): build it
in DOWNBEAT or The Breakery and EXPORT it, put the file in `public/kits/` (for example
`public/kits/keith.kit.zip`), and add `servedKit('keith', 1, 'keith.kit.zip')` to `BUNDLED_KITS`.
It then appears in SAVED KITS (it does not replace your project's sounds at startup).

## Testing

- `tests/unit/kits.test.ts`: roles of the default kit; save, change and load as one undoable
  edit that changes nothing else; a kit from The Breakery (fewer and other roles, extra samples:
  kept); OTHER SOUNDS and NEW KIT; a missing sample makes LOAD change nothing; resuming after a
  reload; assigning library samples; PURGE keeps kit samples; indexing older projects' samples;
  export with audio and settings.
- `tests/e2e/kits.spec.ts` (Chromium, real IndexedDB): import, preview, assign, save, export
  (the downloaded file opened: playable WAVs), reload, keyboard load after confirming, a kit from
  another application, delete after confirming, Escape, and that typing never plays.
- `tests/cross-app/portability.spec.ts` (`BREAKERY_DIR=../the-breakery npm run test:cross`, both
  applications built): a kit made in The Breakery is exported, imported here on another origin
  (sample bytes compared by SHA-256, mapping checked, rendered drum-sound stems compared with the
  original waveforms), exported again and imported into a fresh Breakery profile, whose rendered
  stems are compared too. Not in CI (it needs The Breakery).

## Limitations

- One sample per drum sound: a kit's other samples for it are kept but not played (no velocity
  layers or round robin in DOWNBEAT yet).
- Kits do not include voices, patterns or processing (by design); a kit made for twelve voices
  loaded into a project with other voices plays on the drum sounds whose roles match.
- Only the drum sounds' sample settings travel in a kit file to DOWNBEAT; The Breakery keeps them
  in the kit without using them.

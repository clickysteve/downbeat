# Samples, processing and audio export

DOWNBEAT's internal audio runs on **Slop Factory Core** (`@slopfactory/core`,
<https://github.com/clickysteve/slopfactory-core>), the audio package shared with ANVIL: its
sample engine, choke groups, Good Bits output processing and sample transformations, offline
renderer, WAV encoder, ZIP writer and IndexedDB sample storage. DOWNBEAT has no audio engine of
its own beyond its synthesised internal drum sounds; everything here is Core plus a thin
DOWNBEAT adapter (`src/audio/`).

All of it happens in the browser. Nothing is uploaded, and there is no server.

## Sequencer voices and drum sounds

DOWNBEAT distinguishes the two, and so do the sample bank and the stems:

- A **sequencer voice** is a track: a row of the grid with its strikes, density, fills, loop
  and so on. The default kit has 12 voices; a project can have up to 16.
- A **drum sound** is one **sound step** of one voice: the note (or chord) that step sends
  over MIDI, and the sound that plays it inside DOWNBEAT. KICK has one sound step, SNARE two
  (38 and 40), CL HAT two (42 and 44), so the default kit (NEW PROJECT) has 14 drum sounds; a voice can have
  up to 16 sound steps.

A voice can play several drum sounds (its sound steps, chosen by the strikes or at random), and
a drum sound can be played by several voices: a voice whose FILL SOUND is another voice plays
that voice's drum sounds in its fills (and ECHO jams do the same). Every note the engine plays
names its drum sound explicitly (the voice whose sound plays it and the step), so DOWNBEAT never
has to guess a drum from a pitch.

## SAMPLE BANK (AUDIO → SAMPLE BANK)

One row per drum sound. Each plays its voice's **INTERNAL** synthesised sound, exactly as
DOWNBEAT always has, or a **SAMPLE**.

- **Load** a sample with LOAD… or by **dropping a file** on a row or on the drop zone. WAV and
  AIFF are read at their own sample rate; MP3, OGG, FLAC and others are decoded by the browser.
  Files up to 40 MB and 2 minutes. Loading a sample switches the sound to SAMPLE. REPLACE loads
  another file; CLEAR removes it (the sound is INTERNAL again).
- **HEAR** / **AUDITION** play the drum sound now, through its voice's processing.
- **Playback**: VOLUME, PAN, TUNE (semitones), FINE (cents), VEL SENS (how much the strikers'
  velocities change the level), MODE (ONE SHOT plays the whole sample and lets repeats overlap;
  GATED stops after the voice's GATE with RELEASE; LOOP loops while the note lasts). The sample
  plays at its own pitch for the step's note: changing the note a step sends over MIDI never
  retunes it. The other notes of a chord step transpose it.
- **Sample transformation**: Good Bits STRETCH FX applied once to the sample before it plays
  (the original file is kept): a stretch character, STRETCH ratio, varispeed PITCH, REVERSE,
  DRIVE and CRUNCH baked into the sample. It is computed in a background Worker and cached.
- While a sample is loading, processing, or missing, the sound plays its internal sound.

### Choke groups

A choke group lets one sound cut another that is still ringing.

- **AUTO** (the default) is DOWNBEAT's original behaviour: a voice whose internal sound is HAT
  cuts the ringing notes of voices whose internal sound is OPEN HAT, one way, with an 8 ms
  fade. It keeps working when those sounds play samples.
- **OFF**: never cuts, never cut.
- **GROUP 1-4** with a **ROLE**: CUTS + CUT BY (also cuts its own previous hit), CUTS only (a
  closed hat) or CUT BY only (an open hat). Groups work across voices.

Notes that start at the same moment never cut each other. Choke groups behave identically live
and in exports.

## PROCESSING (AUDIO → PROCESSING)

Good Bits output processing (Core's output engine) on each **sequencer voice** and on the
**master**: presets (CLEAN, 12-BIT, BITCRUSH, RATE REDUCE, DRIVE, CASSETTE, VINYL, AM RADIO),
an OUTPUT STAGE character (Good Bits' generic names: Cassette, Reel-to-Reel, Vinyl, AM Radio,
and so on), DRIVE (tape, tube, diode, fuzz), CRUNCH (bit depth and sample-rate reduction),
TONE, IN and OUT gain, and BYPASS. None of these is presented as an emulation of a particular
machine.

The signal chain:

```
drum sound: internal synthesis, or sample (+ sample transformation, volume, pan, tuning)
  -> sequencer voice processing
  -> master bus -> master processing -> OUTPUT CHAIN -> VOLUME -> master compressor -> speakers
```

The master compressor is DOWNBEAT's own (threshold -10 dB, ratio 4, 3 ms attack, 120 ms
release), unchanged and always on. With every processor CLEAN the chain is exactly the one
DOWNBEAT always had. Processing needs AudioWorklet (https or localhost); without it audio plays
unprocessed and the window says so.

## OUTPUT CHAIN (AUDIO → OUTPUT CHAIN)

A serial chain of **output engines** from Slop Factory Core on the master, after master
processing and before VOLUME and the compressor. The engines are the same code The Good Bits
uses for its exports and The Breakery and emmm use live: OUTPUT STAGE (ten characters), DRIVE,
CRUNCH and TONE, with the same parameter meanings everywhere. Unlike PROCESSING (one fixed
processor per voice and master), the chain is open-ended: **ADD** an engine (up to eight),
select a row to edit it, **ON** to bypass one stage, ▲ ▼ to reorder, **ENGINE** to swap it,
**DEFAULTS**, **REMOVE**, **BYPASS ALL** and **PRESET** (CLEAN, 12-BIT, BITCRUSH, ...). The
controls come from the engines' own parameter descriptions, so new Core engines appear here
with no change to DOWNBEAT.

- Changes are heard at once without clicks (ramps and crossfades in the worklet), are part of
  the project (saved, undoable like PROCESSING) and render into EXPORT AUDIO's master exactly
  where they play live. **Stems are never processed by the chain** (voice or drum-sound,
  baked or dry), and it never reaches MIDI.
- A project without a chain (every project made before it) has an empty one and sounds exactly
  as before. A stage saved by another application with an engine DOWNBEAT does not have is kept
  and passes audio through.
- Core has no MIDI engines yet, so DOWNBEAT's MIDI output goes through no chain.
- `tests/e2e/audio-verify.spec.ts` checks that a chain DRIVE renders the same master as the
  PROCESSING DRIVE with the same settings (within one 16-bit step), that stems are untouched and
  that BYPASS ALL gives the clean master back.

## EXPORT AUDIO (AUDIO → EXPORT AUDIO, or FILE)

Renders DOWNBEAT's own sounds to WAV in the browser: 44.1 kHz, 16-bit PCM, stereo. Several files
come as one ZIP. External MIDI instruments are not rendered.

**What** is exported is frozen first and never regenerated during rendering:

| Range | What plays |
| --- | --- |
| PATTERN · PERFORMED | a pattern for 1-64 cycles, exactly as PLAY plays it from the start with this seed: fills, density, groove, evolution, rules, autopilot, with LOCK, SOURCE and an auditioned breed as they are set now |
| PATTERN · AS WRITTEN | only the written strikes |
| SONG | the song once through, performed |
| RECORDED TAKE | the notes recorded with REC TAKE, at the times they actually played |

DOWNBEAT's performance is deterministic: every random decision is a hash of the seed, so
PERFORMED reproduces PLAY note for note. What happens *during* playback by hand (a jam, a mute,
NEW VARIATION, a morph, a tempo change, an external clock) is not part of the project and is
not in a PATTERN or SONG export. To keep it, record a TAKE: it holds every note that played,
including those changes.

**Files**:

| Output | Contains | Leaves out |
| --- | --- | --- |
| MASTER | everything, as you hear it: voice processing, master processing, VOLUME, master compressor | nothing |
| VOICE STEMS (one per sequencer voice) | everything the voice plays, fills borrowing other sounds included, with the voice's processing (or dry) | master processing, VOLUME, compressor |
| DRUM-SOUND STEMS (one per drum sound that plays) | every note of that sound, wherever it comes from (another voice's fills included), with the sound's own processing: sample transformation, volume, pan, tuning | voice processing, master processing, VOLUME, compressor |

Every file starts at sample 0 and has the same length (the music plus one shared tail of 0-8 s),
so the files line up in any DAW. Nothing is trimmed or normalised; the window lists each file's
peak and the number of clipped samples.

**Why drum-sound stems leave out voice processing.** A voice's processor receives all of that
voice's sounds at once. Drive, crunch and the output stages are non-linear: processing the
sum is not the same as processing each sound alone and adding them. A drum-sound stem with its
voice's processing baked in would therefore not add up to the processed voice, and nothing could
make it exact. So drum-sound stems carry only the processing that belongs to the sound itself.
With voice processing CLEAN, the voice stems and the drum-sound stems each add up exactly to the
mix before the master. The master can never be rebuilt exactly from stems while the master
compressor (or master processing) is non-linear.

**Two details of the master.** The master compressor looks ahead (6 ms in Chromium), which
would put the master behind the stems; DOWNBEAT measures that delay and removes it, so the master
lines up with the stems sample for sample. And a compressor created fresh for an export would
hold its first ~100 ms down, where the live one has long been running; exports render a quarter
second of silence first and discard it.

## Persistence and portable projects

- Projects are **format 2**. The `audio` section holds each drum sound's source, sample id and
  file name, playback settings, transformation and choke group, and the processing settings.
  It never holds audio: samples are stored in this browser's IndexedDB (`downbeat-samples`),
  keyed by the SHA-256 of the file, so identical files are stored once.
- **Old projects** (format 1, and every project made before samples) load unchanged and have
  no `audio` section until something is changed; they play their internal sounds with the
  original hat choke and no processing, exactly as before. Older versions of DOWNBEAT refuse
  format 2 files instead of silently dropping their samples.
- **Portable bundles** (FILE → DOWNLOAD BUNDLE, `.downbeatpack`): the project and every sample it
  uses, hash-checked when opened (FILE → OPEN). A plain project file opened in another browser
  shows its samples as MISSING; those sounds play their internal sounds until the samples are
  loaded again or the bundle is opened.
- **PURGE UNUSED SAMPLES** deletes stored samples that neither the open project, the autosave
  nor any project in the browser library uses.
- Undo and redo include every audio setting.

## MIDI

Unchanged. Samples and processing are only for the internal sounds; MIDI output sends the same
notes as before. Slop Factory Core contains MIDI *interfaces* only (see Core's
`docs/MIDI-ROADMAP.md`); DOWNBEAT's MIDI code stays its own.

## Limitations

- One sample per drum sound; no multi-sample layers, velocity layers or keyboard zones.
- No per-drum-sound continuous processing (processing is per voice and on the master);
  per-sound processing is the sample transformation.
- Live internal-sound timing uses DOWNBEAT's original mapping of the scheduler's times to the
  audio clock; the first note after PLAY can sound a few milliseconds late. Exports are exact.
- The internal sounds' noise starts at a point derived from each hit's time (it used to be
  random); exports are repeatable, and the live sound is statistically the same.
- Exports longer than 20 minutes are refused. Sample transformations are limited to 24 s of
  output.
- Tested in Chromium only (Firefox and Safari have the APIs but are not tested automatically).
- No listening tests were part of the automated verification; see
  [AUDIO-VERIFICATION.md](AUDIO-VERIFICATION.md) for what was measured.

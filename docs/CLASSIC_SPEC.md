# CLASSIC specification

CLASSIC is DOWNBEAT's independently implemented reading of UpBeat 2.0's
documented behaviour (see [HISTORICAL_RESEARCH.md](HISTORICAL_RESEARCH.md)).
Each behaviour carries its evidence level: **DOCUMENTED** (contemporary
reviews and adverts; no manual survives), **INFERRED** (DOWNBEAT's own design
where the sources give only an outline) or **EXTENDED** (new; listed here
only where CLASSIC needs a modern facility to be usable at all, such as a
browser audio engine). Nothing is OBSERVED: the original was not available.

All INFERRED algorithms are versioned (`project.algorithms.classic = 1`), so a
later, better approximation can be added as version 2 without changing how
saved projects play.

## Time

| Item | Behaviour | Evidence |
| --- | --- | --- |
| Engine time | Ticks at 24 per quarter note (one MIDI Clock pulse), with fractional positions, so placement is finer than UpBeat's 96 PPQN. Fine offsets are entered in 1/96-quarter units (UpBeat's resolution: 1/384 of a 4/4 bar). | DOCUMENTED (96 PPQN, 1/384 bar shift); engine unit EXTENDED |
| Pattern | Time signature (1-15 over 4, 8 or 16), length 1-8 bars, an **Edit grid** of 1-8 steps per beat (16ths in 4/4 = 4; triplets = 3 or 6), at most 64 steps. Optional per-pattern tempo. | DOCUMENTED (length, time signature, tempo, sub-beats); limits INFERRED |
| Cycle | One repetition of a pattern. Every random decision is keyed to the cycle number, so a cycle replays identically for the same seed. | INFERRED |

## Voices and tracks

| Item | Behaviour | Evidence |
| --- | --- | --- |
| Voices | Up to 16 drum voices per project (the kit), each with a name, MIDI channel, a **step list** of MIDI notes (a note or chord per step), an internal sound, a gate length, mute and solo. | DOCUMENTED (Devices / Sounds, 16 channels); 16-voice limit INFERRED from the 14-track screenshot and the 16-line Device List |
| Tracks | Each pattern has one track per voice holding its strikes and its playback variables (velocity, fills, time). | DOCUMENTED |
| Step list ("sound variation") | Each strike names a step (`S:1`, `S:2` ...) or **random step** (`S:?`), which chooses among the voice's steps each time it plays. Up to 16 steps per voice in DOWNBEAT (UpBeat 2.0 allowed 127). | DOCUMENTED (2.0); 16-step limit INFERRED |

## Strikes and velocity

| Item | Behaviour | Evidence |
| --- | --- | --- |
| Strikers | Five striker tools (1 ghost, 2 soft, 3 normal, 4 loud, 5 **accent**) and a **random striker** (`?`). Each striker has a central velocity and ± range per track (defaults 28, 52, 80, 104, 124; ranges 4-6). | DOCUMENTED (five strikers + random, centre ± range); default values INFERRED |
| Random velocity | The random striker picks one of the five by per-track weights (Random Velocity). | DOCUMENTED (2.0) |
| Accent | Striker 5 is the accent. Accents are protected by density and lead fills (below). | Accent = loudest striker: INFERRED |
| Flam | A strike can be flammed: a grace note one tick (about 20 ms at 120 BPM) earlier at 55 % velocity. | DOCUMENTED that flam existed (SOS88); behaviour INFERRED |
| Display | A strike's glyph shows its striker; accents are drawn as solid blocks with a cap. | DOCUMENTED (glyph per striker in screenshots); DOWNBEAT's glyphs are its own |

## Density (Time display)

Per-track **DENSITY 0-100 %**. Written strikes are never removed; on each
cycle a deterministic subset plays. **INFERRED (v1):** a strike of striker
level *L* plays when `u < d ^ w(L)`, with `u` the cycle's hash value for that
strike and `w = 1.6, 1.3, 1.0, 0.7, 0.4` for levels 1-5. At 50 % a ghost plays
about a third of the time, a normal strike half the time and an accent about
three quarters of the time; at 100 % everything plays; at 0 % nothing does.
DOCUMENTED: density 0-100 %, "about half the time" at 50 %.

## Time placement

| Item | Behaviour | Evidence |
| --- | --- | --- |
| ± placement | Per-track TIMING ± *n* fine units: each played note is moved by a deterministic random amount within ± *n*/96 of a quarter. | DOCUMENTED (2.0: ± ticks) |
| Shift | Per-track SHIFT moves the whole track by fine units (early or late), e.g. a lazy snare. | DOCUMENTED (shift tracks by 1/384 bar) |
| Rotate | SHIFT ◀ ▶ rotates a track's (or every track's) strikes by one step with wraparound. | Wraparound rotation INFERRED (only fine shifting is documented) |
| Start | No note is ever placed before the transport's start (negative offsets on the first step are clamped). | EXTENDED (scheduling safety) |

## Fills

Per-track FILL settings: on / off, **SOUND** (this voice, or another voice's
sound, e.g. fill a snare pattern with toms), **AMOUNT** (percentage of empty
space filled), **RATE** (fill speed relative to the grid: ½, 1, 2, 3, 4),
**SPACING** (minimum distance, in steps, from written strikes), **MAX**
(maximum fill notes in any one gap between written strikes), **ZONE** (where
fills may occur: anywhere, last bar, last half bar, last beat), and
**FILL VELOCITY** weights over the five strikers. DOCUMENTED: sound, amount /
probability, rate / speed, spacing, the number of beats a fill can occupy
between written notes, fill velocity probabilities. ZONE is EXTENDED.

**INFERRED algorithm (v1), per cycle and track:**

1. Candidate slots lie on the fill-rate grid within the zone.
2. A slot is *empty* if it is more than SPACING steps from every written
   strike of the track (the cycle wraps, so the last slots also respect the
   first strike of the next cycle).
3. Empty slots form *gaps* between written strikes. In each gap, slots are
   considered from the end of the gap backwards (fills lead **into** the next
   written strike), each playing with probability AMOUNT, until MAX fill notes
   have been placed.
4. A fill note's striker is drawn from the fill velocity weights; if the next
   written strike is an accent, the striker is raised by one (a lead-in rises
   to the accent).
5. Fill notes play the fill SOUND voice's step list (random step).
6. Fill decisions are keyed to the cycle, so fills change on every repetition
   and replay identically for the same seed.

Fill notes are **generated** events: they never alter the written pattern.

## Loops (polymeter)

Per-track **LOOP** length (1 step to the pattern length) and **LOOP %**: when a
track reaches its loop point it jumps back to its start with probability
LOOP %, otherwise it plays on to the end of the pattern before wrapping.
Several looped tracks of different lengths form polyrhythms against the
pattern. PHASE: tracks restart when a pattern starts (default) or run free
across pattern changes; RESYNC realigns every track at the next cycle.
DOCUMENTED (2.0 loop points and loop percentages, polyrhythmic effects); one
loop point per track and the phase options INFERRED.

## Jam

Holding **JAM** on a voice plays a continuous roll on that voice at its fill
rate, with fill velocities, superimposed on the pattern (ROLL). In ECHO mode
the held voice also plays its fill-sound voice's rhythm. Jam acts within one
lookahead window of the press. DOCUMENTED (1.0: continuous rolls,
superimposing track rhythms); all details INFERRED.

## Patterns and songs

| Item | Behaviour | Evidence |
| --- | --- | --- |
| Library | Named patterns; new, duplicate, rename, delete. Selecting a pattern while playing cues it for the end of the current cycle. | DOCUMENTED (Library; cueing INFERRED) |
| Song | An ordered list of patterns with repeat counts; SONG mode plays it through (looping optionally) and highlights the playing entry and repeat. | DOCUMENTED |
| Tempo | Project tempo, optional per-pattern tempo applied at the pattern's start. | DOCUMENTED |
| Program change | Optional per-voice program change sent once at Start. | DOCUMENTED (2.0: first play only) |

## Editing

Paint strikes with the current striker (keys 1-5, `?` random), erase with
right-click or the eraser, drag to paint, flam with Alt-click, choose the
sound step for new strikes. Track and pattern operations: rotate, reverse,
clear, copy / paste track, double length, undo / redo. Paste modes and the
Compander are not implemented (see UNCERTAINTIES.md).

## Transport, MIDI and files

Start / Pause (Continue) / Stop, MIDI note output per voice, MIDI Clock in and
out, Standard MIDI File export of the written pattern, of a rendered
performance and of a captured take, and MIDI File import into a pattern. The
transport and clock are modern facilities shared with Extended; see
[MIDI.md](MIDI.md).

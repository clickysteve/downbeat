# MIDI, sync and sound

DOWNBEAT is first a MIDI instrument; its internal sounds are there so it is
audible without equipment.

**Hardware status:** no physical MIDI device was used while building
DOWNBEAT. Everything below was verified with unit tests and with a
simulated Web MIDI device in Chrome. See "Needs checking on real hardware".

## Output

- **SEND TO** (top bar OUT, or the MIDI dialog): INTERNAL, MIDI or BOTH.
- Press **MIDI → ENABLE MIDI** once; DOWNBEAT then remembers the choice and
  the device. Web MIDI needs Chrome, Edge, Opera or Firefox.
- Each voice has its own **channel** and **step list** of notes (VOICE
  tab). Defaults are General MIDI drums on channel 10. A step can be a
  chord (`42+46`). Fills played "with another voice's sound" use that
  voice's channel and notes.
- **GATE** is the note length in clock ticks (24 per quarter), which
  matters for gates and envelopes on modular systems.
- **PROGRAM** sends a program change on the voice's channel at Start (once
  per channel).

### Note safety

- Every note-on has an id; a (channel, note) pair is released only when
  every id holding it is released, so voices or fills sharing a note never
  cut each other, and stale note-offs are ignored. A note struck while
  already held is preceded by a note-off (clean retrigger).
- Simultaneous identical triggers are merged: when two mechanisms strike
  the same channel and note at the same instant (a fill borrowing a voice
  that has its own strike there, an extra hit on a fill slot, a jam over a
  written note), one note is sent at the louder velocity, preferring the
  written strike. A flam on the very first step cannot sound before the
  start, so it merges into its strike.
- Note-offs are queued until they fall inside the lookahead window.
- **Stop** and **Panic** call `MIDIOutput.clear()` (where supported) to
  drop queued messages, then release every held note at once, including
  note-offs that were queued and dropped. Without `clear()`, emergency
  note-offs are stamped after the latest queued message so a queued note-on
  cannot overtake them.
- **PANIC** also sends All Notes Off (CC 123) and All Sound Off (CC 120) on
  all 16 channels.
- **Device changes**: switching device releases held notes on the old one
  first. If the device disappears, its notes are forgotten (nothing can be
  sent), playback continues, the chip shows OUT LOST, and the device is
  re-attached when it returns.

## Clock out

**CLK OUT** sends MIDI Clock (F8) at 24 per quarter, aligned to the notes
(the first clock and the first downbeat share a timestamp), with:

| DOWNBEAT | Sends |
| --- | --- |
| PLAY from stopped | FA, then F8 |
| PAUSE | FC |
| CONTINUE | FB; F8 resumes at the next whole tick |
| STOP | FC, then Song Position 0 (F2 00 00) |
| Tempo change | the F8 period changes at the scheduling horizon |

Clock is only sent while running. Clock out is forced off while following
an external clock, so clock is never echoed back to its source.

## Following an external clock

MIDI dialog: choose the **input** and **CLOCK: EXTERNAL**.

- Incoming pulse *n* **is** engine tick *n* (both 24 PPQN); nothing is
  converted to a tempo and back. Each pulse releases the events up to the
  next pulse; events between pulses (swing, shifts, flams, fills) are
  placed using the measured pulse period.
- **FA Start**: from the top (engine reset, program changes); the next F8 is
  tick 0.
- **F8 while stopped** never starts DOWNBEAT; it only feeds the tempo
  display (SYNC chip shows CLOCK).
- **FC Stop**: releases held notes and keeps the position; **FB Continue**
  carries on from it (nothing reset).
- **F2 Song Position** while stopped: moves to the position (sixteenths ×
  6 ticks), reproducing the performance's state there; FB then continues
  from it.
- **Loss**: no pulse for 500 ms while running → LOST (blinking chip), notes
  released, position held; the next pulse carries on. Unplugging the input
  does the same. There is no free-running fallback.
- The incoming tempo is measured over two beats (least squares) for
  display only.

Internally, the transport keys (PLAY etc.) are disabled while EXTERNAL.

### Typical setups

- **DOWNBEAT as master** (e.g. driving a Hermod+ or drum machine): OUT =
  MIDI or BOTH, CLK OUT on, the other device set to external MIDI clock.
- **DOWNBEAT as follower** (e.g. of a DAW or sequencer): input = that
  device, CLOCK EXTERNAL; start and stop from the master.
- **Recording into a DAW**: either follow the DAW's clock, or use FILE →
  MIDI to export the performance, the song or a recorded take.

## MIDI input: recording strikes

With **RECORD STRIKES FROM INPUT** on, notes arriving at the input that
match a voice's step list are written into the playing pattern at the
nearest step (velocity chooses the striker; the matching step is kept).
Matching notes are also auditioned. This mirrors UpBeat's real-time
recording; it is the only performance-time edit.

## MIDI files

FILE → MIDI FILES, as type 1 (a track per voice) or type 0, at 96 PPQN:

- **WRITTEN PATTERN**: exactly as written, repeated (no fills or density).
- **PERFORMANCE**: the selected pattern as performed from the start with
  the current seed: fills, density, groove, evolution, rules. Rendered
  offline by the same engine, so it matches playback.
- **SONG**: the whole song, performed, once.
- **RECORDED TAKE**: everything that played while REC TAKE was on,
  including live changes.

**Import**: notes are matched to voices by note number and quantised to a
sixteenth grid (up to four bars, the file's time signature) into a new
pattern; unmatched notes are reported.

## Internal sounds

Synthesised with Web Audio (no samples): two kicks, two snares, rim, clap,
closed and open hats (closed chokes open), three toms, cowbell, clave,
shaker, conga, crash, ride and a zap. Each voice chooses its sound, tune,
decay and level; a step list's later notes shift the pitch (so a two-step
hat or a three-step conga varies). Internal sound timing is mapped onto the
AudioContext clock from the same millisecond timestamps as MIDI.

## Needs checking on real hardware

- Timing and jitter of MIDI output through real interfaces (USB, DIN).
- Clock out stability against a real follower (Hermod+, drum machines),
  including tempo changes and Pause / Continue.
- Following a real external clock: lock, drift, Start / Stop / Continue /
  Song Position from DAWs and hardware sequencers; behaviour on cable
  unplug.
- `MIDIOutput.clear()` support in the browser and driver in use (affects
  how quickly Stop silences notes already queued).
- Note-off handling on devices that ignore or require note-offs; gate
  lengths on modular systems.
- Program change and channel mapping on specific drum machines.

# Historical research: Intelligent Music's UpBeat

DOWNBEAT is an independent instrument inspired by **UpBeat**, the
"intelligent rhythm programmer" published for the Apple Macintosh by
Intelligent Music (Intelligent Computer Music Systems, Inc., Albany, New York)
in 1987, and updated as **UpBeat 2.0** (2.01) by 1990. This page records what
could be established about the original, and how firmly. Source keys (MT87,
EM87, MT90 ...) refer to [SOURCES.md](SOURCES.md).

DOWNBEAT is not affiliated with or endorsed by Intelligent Music, its
successors or the original developers. "UpBeat" is used here only to identify
the historical product.

## Evidence levels

| Level | Meaning in this project |
| --- | --- |
| **DOCUMENTED** | Explicitly described in contemporary documentation. *No original manual was found*, so every DOCUMENTED item rests on contemporary magazine reviews (MT87, EM87, MT90, SOS88), the publisher's adverts and product listing (AD87, EM87-new), or the screenshots printed in them. |
| **OBSERVED** | Established by controlled testing of the original software. **Nothing is OBSERVED**: no copy of UpBeat could be found. |
| **INFERRED** | Independently designed by DOWNBEAT to approximate a behaviour that is documented only in outline. |
| **EXTENDED** | A new DOWNBEAT feature with no historical claim. |

## History in brief

- **1984**: Joel Chadabe founds Intelligent Music, which publishes M and Jam
  Factory (1986). [ROOS24]
- **1987**: UpBeat 1.0, created by John Offenhartz [ROOS24], released at
  $150 [EM87]. MT87 reviewed a pre-release version.
- **1990**: UpBeat 2.0 (2.01), $249, reviewed in MT90 on a Mac II under
  MultiFinder with Apple's MIDI Manager.
- **Early 1990s**: the catalogue is published by Dr. T's Music Software.
  [INFOMAC93, USI3]
- **2024**: Kristen Roos makes *Universal Synthesizer Interface Vol. III*
  with UpBeat and interviews Offenhartz, who describes the aim as controlled,
  "opinionated" randomness informed by the source material rather than random
  note dropping. [ROOS24]

## The design idea

UpBeat separated a drum machine's sounds from its programming: the Mac held
the patterns and sent MIDI to the drum machine, which "plays as soon as you
click" [EM87]. The distinctive part was that each track's playback was put
"under control" of the program: density, timing, velocity, articulation and
fills were variables, so a looping pattern could be played *differently*
every time while the musician adjusted it live [MT90, USI3]. MT90 stresses
that in 2.0 every function works in real time while the music plays.

That is DOWNBEAT's central idea: **the written pattern is the source; what
plays is a performance of it**.

## Findings by topic

### 1. Pattern structure and editing

- **DOCUMENTED.** A Pattern is the basic unit; each Pattern "may have a unique
  length, tempo and time signature" [MT87]. Patterns live in the Library
  window and are edited in a Pattern window [MT87, MT90].
- **DOCUMENTED.** The Pattern window is a grid: tracks vertically, time
  horizontally, beat marks across the top [MT87; screenshots EM87, MT90].
  Notes are called **strikes** and are painted with tools from a palette or
  recorded from MIDI [MT87, MT90].
- **DOCUMENTED.** Parameters shown in the window: Tempo, Time (signature),
  Length (number of bars), Pos (Bar / Unit), Edit grid (e.g. 16) [EM87
  screenshot]; in 2.0, Cursor (Bar / Beat / Tick), Time, Length (bars),
  Quantize Display / Record [MT90 screenshot].
- **DOCUMENTED.** Editing tools: striker, eraser, highlighter (select),
  magnifying glass (edit one strike's pitch or velocity) [MT87]; paste modes
  Merge, Swap, Repeat and Fill/Fit paste (scale to fit) [MT87], plus Clipped
  paste and the real-time **Compander** in 2.0 [MT90].
- **DOCUMENTED.** 2.0 adds strikes that send program changes, and per-track
  loop points (below) [MT90].

### 2. Drum instruments, voices and MIDI note assignment

- **DOCUMENTED.** Instruments are described as **Devices** containing named
  **Sounds** (note numbers), e.g. C1 "kick", D1 "snare" [MT90]. A Sound
  Set-Up window mapped note numbers to sound names [MT87].
- **DOCUMENTED.** In Drum Machine mode (2.0: *Rhythm*), each Sound / note
  number gets its own track; Synth mode (2.0: *Normal*) tracks hold many
  notes on one channel [MT87, MT90].
- **DOCUMENTED.** The Device List & Input Setup has 16 lines, one per MIDI
  channel; separate input channels can be set [MT90]. 1.0's Device window held
  MIDI In / Out channel, output port, echo, record mode, enable [MT87].
- **Not documented:** the maximum number of tracks. The 1.0 screenshot shows
  14 drum tracks in one pattern (Kick, HiTo, Snar, MidT, Rim, LoTo, Clos,
  OpHi, Crash, Cow, Clap, Cab, Tam and a second kick) [EM87].

### 3. Pattern length and time signatures

- **DOCUMENTED.** Per-pattern length in bars and time signature [MT87, EM87];
  "number of sub-beats per measure" [EM87]; the Edit grid (e.g. 16 = sixteenth
  notes) sets the step resolution for painting and recording [MT87].
- **DOCUMENTED.** Internal resolution 96 ticks per quarter note [MT87];
  shifting by 1/384 of a measure [EM87] (= one tick of a 4/4 bar at 96 PPQN).
- **Not documented:** maximum bars per pattern.

### 4. Fill generation

- **DOCUMENTED (1.0).** Fills are generated automatically from the recorded
  strikes and the fill settings, enabled per track [MT87]. Controls: which
  instrument plays the fill ("fill" a snare pattern with toms), the probability
  of fill notes, the number of beats on which a fill can play between written
  notes, the speed of fill notes, their quantisation, and the probability of
  five fill volumes [EM87; also MT87, EM87-new].
- **DOCUMENTED (2.0).** Fills "fill in" empty spaces with notes; controls are
  the source track for the fill sound, the rhythmic division, the percentage
  of empty space to fill, and the spacing between existing notes and fill
  notes [MT90].
- **Not documented:** the exact selection algorithm; whether generated notes
  persist between repetitions; whether accents influence fills.

### 5. Note density

- **DOCUMENTED.** A per-track Note Density control 0-100 %: at 50 % notes
  "will play about half the time" [MT87]. In 2.0 it is in the Time display
  [MT90]. The written strikes are not deleted (density is a playback
  variable).
- **Not documented:** whether density favours or protects particular strikes.

### 6. Accent and velocity behaviour

- **DOCUMENTED.** Five velocity **strikers** (painting tools) and a random
  striker [MT87]. Each striker has a central velocity and a ± range (1.0 calls
  it velocity deviation: 110 ± 15 gives 95-125 [MT87]; 2.0: 30 ± 10 gives 20-40
  [MT90]). 2.0's Random Velocity display sets how likely the random tool is to
  choose each of the five [MT90].
- **DOCUMENTED.** Strikes are drawn with a different glyph per striker [EM87
  and MT90 screenshots].
- **Not documented:** a separate accent function. The loudest strikers
  serve as accents.

### 7. Strike and Fill views

- **DOCUMENTED (1.0).** Six Pattern-window views: Strike, MIDI, Velocity,
  Staccato/Legato, Fill, Fill Velocity [MT87].
- **DOCUMENTED (2.0).** Eight per-track displays: Main, Output, Velocity,
  Random Velocity, Articulation, Random Articulation, Fills, Time [MT90].

### 8. Sound variation

- **DOCUMENTED (2.0).** Each Sound has up to 127 **steps**, each a note or
  chord; a strike can name a step (shown as `S:1`) or use a **random step**
  indicator, used for hi-hats that "sound slightly different each time"
  [MT90]. 1.0 could already define Sounds with several notes [MT90] and could
  have the computer "randomly select pitches" [EM87-new].
- **DOCUMENTED (2.0).** Articulation (length) strikers, 3 %-350 % with ± range,
  and a random articulation striker [MT90].

### 9. Pattern shifting and rotation

- **DOCUMENTED.** Notes or whole tracks can be shifted by as little as 1/384
  of a measure [EM87].
- **DOCUMENTED.** "Flam" is listed as a facility [SOS88] (no detail).
- **Not documented:** wraparound rotation by steps.

### 10. Rhythmic transformations

- **DOCUMENTED.** Density, fills, velocity and articulation ranges, ± tick
  placement ("allowances for 'human' feel") [MT90, EM87-new].
- **DOCUMENTED (2.0).** Per-track **loop points** anywhere in the track, with
  a **loop percentage** (a 50 % loop repeats half the time); several loops per
  track; "very complex polyrhythmic effects" when several tracks loop [MT90].
- **DOCUMENTED (2.0).** Fit paste and the real-time Compander (scale a section
  into a longer or shorter space) [MT90].

### 11. Pattern and song arrangement

- **DOCUMENTED.** Songs are lists of Patterns with repeat counts, built by
  dragging Patterns from the Library; the playing segment is highlighted; a
  play position shows the current repeat [MT87, EM87]. Songs can be nested;
  a global tempo change in percent [MT87]. In 2.0, MIDI Files can be placed
  in Songs and play alongside [MT90].

### 12. Jam Tool

- **DOCUMENTED (1.0).** A drummer-shaped tool clicked on tracks in the Strike
  View; it generates "continuous rolls" and superimposes track rhythms on each
  other [MT87].
- **Not documented:** its parameters, or whether it survives in 2.0 (MT90
  does not mention it).

### 13. Timing and quantisation

- **DOCUMENTED.** 96 PPQN recording; record and display quantise settings;
  ± tick placement in the Time display [MT87, MT90].
- **DOCUMENTED.** No swing in 1.0 [MT87]. Not mentioned in MT90.

### 14. MIDI input and output

- **DOCUMENTED.** Real-time recording from pads, keyboards, Octapad, MIDI
  guitar [MT87]; MIDI Thru / echo [MT87, MT90]; up to 16 channels [MT90];
  program change per track (1.0: at every pattern loop, which could cause a
  hiccup; 2.0: on the first play only) and MIDI Volume [MT87, MT90].
- **DOCUMENTED.** Standard MIDI File output: 1.0 Movies; 2.0 Capture of a
  live performance, pattern export (Pattern file, type 0, type 1, number of
  repetitions) and MIDI File import [MT87, MT90].

### 15. MIDI clock and transport

- **DOCUMENTED.** Control Strip with Start (PLAY), Stop, Continue and Record
  [MT90; EM87 screenshot shows PLAY, Cont., REC]. Counter window in Bar / Beat
  / Tick with count-in [MT90].
- **Only indirect:** 2.0 supports Apple's MIDI Manager, which provides clock
  in / out ports [MT90 sidebar]. Whether UpBeat itself sent or followed MIDI
  Clock is **not documented**.

### 16. User interface

- **DOCUMENTED.** Classic Macintosh windows: Control Strip, Palette (tools),
  Counter, Pattern window(s), Library; Song window; Device List [MT87, MT90].
  The screenshots show a 1-bit interface with tracks named down the left,
  strikes as small glyphs on a light grid with beat marks, and a vertical
  tool palette at the left edge.

### 17. Differences between 1.0 and 2.0

| Area | 1.0 (1987) | 2.0 (1990) |
| --- | --- | --- |
| Track types | Drum Machine / Synthesiser | Rhythm / Normal |
| Sounds | name + note(s) | up to 127 steps per Sound, random step |
| Views | Strike, MIDI, Velocity, Staccato/Legato, Fill, Fill Velocity | Main, Output, Velocity, Random Velocity, Articulation, Random Articulation, Fills, Time |
| Density | Staccato/Legato view | Time display, with ± tick placement |
| Loops | whole pattern | loop points anywhere, loop percentage, several per track |
| Recording | Movies | Capture |
| MIDI Files | export | export (type 0 / 1, repetitions) and import; MIDI Files in Songs |
| Program change | every loop | first play only; program change strikes |
| Paste | Merge, Swap, Repeat, Fill | adds Clipped and Fit, real-time Compander |
| Display | strikes | strike / note name / length per track |
| Jam Tool | yes | not mentioned |

## What DOWNBEAT takes from this

See [CLASSIC_SPEC.md](CLASSIC_SPEC.md) for the Classic behaviour derived from
these findings, and [UNCERTAINTIES.md](UNCERTAINTIES.md) for every point
where DOWNBEAT had to design its own answer.

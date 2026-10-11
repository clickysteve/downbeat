# Architecture

TypeScript, Vite, no UI framework, one runtime dependency (the Silkscreen
font). Source layout:

| Path | Role |
| --- | --- |
| `src/engine/types.ts` | Data model: Project, Voice, Pattern, Track, Strike; time constants |
| `src/engine/defaults.ts`, `patternOps.ts` | Factories; the only edits to written strikes (paint, rotate, regrid, ...) |
| `src/engine/rng.ts` | Keyed hash randomness and a small seeded generator |
| `src/engine/realize.ts` | **Realisation**: one cycle's performance from the source (Classic v1 algorithms, Extended probability and groove) |
| `src/engine/plan.ts`, `engine.ts` | **Planner** (cycles, song, loops, evolution, rules, autopilot, morph) and event emission |
| `src/engine/groove.ts` | Swing warp, templates, accent emphasis |
| `src/extended/` | Mutation, morph, breeding, Euclid, rules, autopilot |
| `src/scheduler/` | Lookahead scheduler, transport, clock out, external clock, pulse estimator |
| `src/midi/` | Message helpers, note-safe output, Web MIDI access, Standard MIDI Files |
| `src/audio/drums.ts` | Synthesised internal drum voices (Web Audio) |
| `src/persistence/` | Project format, migration and repair; browser storage; demos |
| `src/app/app.ts` | Application state and every action; wiring of engine, scheduler, MIDI, sound |
| `src/ui/` | Views (grid, tools, panels, monitor, top bar, side, dialogs), palette, styles |

## Source and performance

The central rule: **the pattern is the source; what plays is a performance
of it.** Only explicit editing actions (painting, rotate, Euclid APPLY,
CAPTURE, KEEP, MIDI recording) change strikes. Density, fills, probability,
groove, evolution, rules and morphs act on the performance.

### Cycles

A *cycle* is one repetition of a pattern. The engine works in two layers.

**Planner** (`Engine.planNext`). Cycles are planned in order, only shortly
before they start (one quarter note ahead, `PLAN_MARGIN`), so a pattern
change, a rule or a morph takes effect at the next cycle. A `CyclePlan`
fixes the structural facts:

- which pattern plays (cue, song entry and repeat, audition, morph);
- for each voice, the track position played at every step (loop points and
  loop percentages: polymeter);
- the **variant**: the strikes after evolution, rule / autopilot mutations
  and morphing, with each position marked as source, added, changed or
  removed. An untransformed track is marked *live* and is read from the
  pattern at realisation time, so edits during playback are heard within
  one lookahead window;
- temporary per-voice modifications (density multiplier, fill boost, forced
  fill, mute) from rules and the autopilot;
- the random key (the cycle number, or a locked cycle), SOURCE, tempo
  changes, song end, and monitor labels.

**Realisation** (`realize()`). A pure function of (project settings,
pattern, plan) that returns every event of the cycle and, for display, the
state of every cell (played, suppressed and why, generated, added, changed)
and per-voice statistics. It is cached per settings version: any change
bumps `Engine.version`, so a density or fill change is heard at the next
lookahead window and the grid redraws at once.

**Emission** (`Engine.generate(until)`). Emits every event whose tick lies
in `[horizon, until)`, applying mute, solo and Jam at that moment (so they
act within one lookahead window). Each cycle remembers which event keys it
has sent, so re-realising a cycle after a change can never send a note
twice. Early-shifted notes of the next cycle are covered by planning one
quarter note ahead; nothing is placed before tick 0. Finally, notes that
strike the same channel and pitch at the same tick are merged into one
(`mergeSimultaneous`), so overlapping mechanisms never double a drum hit.
Switching to CLASSIC also cancels a morph in progress and a breeding
audition.

### Determinism

Every performance decision uses `rand(seed, purpose, voice, cycleKey, step)`,
a 32-bit hash. Results do not depend on the order of evaluation or on how
lookahead windows fall (tested by generating the same performance in
1.7-tick windows and in one window). Sequential operations (mutation chains,
breeding) use a seeded mulberry32 generator whose seed is itself a hash of
(seed, pattern, generation). Consequences:

- same project, seed and interventions → identical output (REPLAY);
- NEW VARIATION = new seed; LOCK = fixed cycle key;
- `Engine.seek(tick)` reproduces the state at any position by planning
  forward (used for MIDI Song Position);
- offline rendering (`renderCycles`) for MIDI export produces exactly what
  playback would.

### Versioned algorithms

`project.algorithms = {classic: 1, extended: 1}`. All inferred algorithms are
version 1. An improved approximation would be added as version 2 and chosen
by this number, so saved projects keep their sound. Locked evolution
generations are stored as strikes, so they are independent of the mutation
algorithm.

## Time and transport

Engine time is ticks since Start at 24 per quarter (one MIDI Clock pulse),
with fractional positions for shifts, swing, flams and fills between steps.
UpBeat's 96 PPQN fine resolution is the "fine" unit (¼ tick).

The scheduler (`src/scheduler/scheduler.ts`) maps ticks to
`performance.now()` milliseconds through an anchor
`ms = anchorMs + (tick − anchorTick) × 60000 / (bpm × 24)`. A ticker in a
dedicated Worker (background tabs throttle it far less than main-thread
timers) pumps every 25 ms and schedules everything up to now + 100 ms; MIDI
goes to Web MIDI with absolute timestamps and internal sounds are mapped to
the AudioContext clock with `getOutputTimestamp()`. No wall-clock timer ever
decides musical time; the animation loop only draws what is heard.

| Action | Engine | Scheduler | MIDI (CLOCK OUT on) |
| --- | --- | --- | --- |
| Start | reset | anchor at now + 40 ms; program changes | FA, then F8 × 24 per quarter |
| Pause | kept | stops at the horizon; held notes released there | FC |
| Continue | kept | re-anchor the paused tick at now + 40 ms | FB; clock resumes at the next whole tick |
| Stop | reset | cancel queued messages, release all notes now | FC, F2 00 00 |
| Tempo change | — | re-anchor at the horizon (no gap, no overlap) | clock period follows |
| Pattern tempo | tempo item at the cycle start | re-anchor at that tick | — |

External clock, note safety, panic and device handling: see [MIDI.md](MIDI.md).

## Application and views

`App` owns the project, the engine, the scheduler, MIDI output, Web MIDI
access, the internal synth, storage and palettes. Views subscribe to topics
(`pattern`, `voices`, `track`, `selection`, `transport`, `midi`, `ext`,
`feed`, ...) and call App actions. Undo snapshots the project (60 levels; a
drag is one step). Panel controls are built once and refreshed in place, so
a slider is never rebuilt under the pointer.

The grid draws from `App.heard()`: the plan containing the transport
position (or a cached preview plan while stopped) and its realisation. A
cell is redrawn only when its signature changes. Label flashes follow the
note events' sounding times, not their scheduling times.

## Persistence

`{format: "downbeat-project", version: 1, savedAt, project}`. Loading
migrates (version 0, the pre-release bare-object shape, is converted and
reported), then validates and repairs: numbers clamped, missing parts
defaulted, unknown fields dropped, strikes resized to their pattern,
references to missing voices and patterns removed. The current project
autosaves 600 ms after changes and on page hide; named projects live in a
browser library. Preferences (output routing, devices, clock, volume, tab)
and palettes are browser preferences, never part of a project.

## Testing

| Suite | |
| --- | --- |
| `tests/unit/engine.test.ts` | timing, voices, velocity and accents, random striker and steps, flams, density, timing / shift / rotation / regrid, fills (empty space, spacing, max per gap, lead-in, zones, rate, other sound, determinism), loops and polymeter, cue, song, pattern tempo, mute / solo / live edits, jam, SOURCE, LOCK, seek, offline render, window independence |
| `tests/unit/extended.test.ts` | Euclid, mutation strength, evolution ORIGINAL vs EVOLVING, drift guard, reset and lock, breeding, morph monotonicity and completion, rules (conditions, fill, mute, no recursion), autopilot, swing, groove only in EXTENDED, probability |
| `tests/unit/scheduler.test.ts` | clock out at 24 PPQN, Start / Stop / Continue / Song Position, pause and resume, note pairing, stop cancellation (with and without `clear()`), tempo changes, pattern tempo, song end, device change, panic, program changes, external clock (clock while stopped, FA, FC, FB, F2, loss, tempo estimate, no echo) |
| `tests/unit/persistence.test.ts` | save / load equality and identical playback, locked variations, invalid files, repair, v0 migration, storage failures, demos, palettes |
| `tests/e2e/downbeat.spec.ts` | the built site in Chrome with a simulated Web MIDI device (see README) |

# EXTENDED specification

Everything here is **EXTENDED**: new to DOWNBEAT, with no historical claim.
EXTENDED shares CLASSIC's engine, scheduler and MIDI system: it changes how
the written pattern is *performed*, never the pattern itself (except the
explicit editing tools: Euclid APPLY, CAPTURE, KEEP).

- The **EXTENDED / CLASSIC** switch in the top bar turns everything here
  off at once. CLASSIC playback then ignores every setting below (they are
  kept in the project for when you switch back).
- Each family can also be switched off on its own: PROBABILITY ON, GROOVE
  ON, EVOLVE (per pattern), RULES ON, AUTOPILOT ON.
- **SOURCE** (performance panel, key S) plays only what is written, with
  nothing generated or suppressed, in either mode.

All randomness is a keyed hash of the project seed with the cycle, voice
and step (see [ARCHITECTURE.md](ARCHITECTURE.md)), so a performance is
reproducible. Extended algorithms are version 1 (`project.algorithms.extended`).

## Probability (PROB tab)

Per voice: **PLAY** (chance each written strike plays), **EXTRA HITS**
(chance of a ghost note half a step after a played strike), **ACCENT**
(chance a non-accent plays as an accent), **VELOCITY ±** (extra variation).
Per step: the **P%** tool sets a strike's own chance of playing (shown as a
small number in the cell). Probability is applied after Classic density.

## Groove (GROOVE tab)

- **SWING** 50-75 %: a time warp over pairs of grid steps, so the second of
  each pair falls at SWING % of the pair (66 % is triplet swing). Notes
  between steps (fills, extra hits) move with the warp. No swing on odd grids.
- **TEMPLATE** (SHUFFLE, PUSH, LAZY, BREAK) with **DEPTH**: timing offsets
  and velocity factors for the four quarters of each beat.
- **TIMING ±** and **VELOCITY ±**: seeded humanisation for all voices.
- **ACCENTS**: accent emphasis (accents louder, others softer).

Everything is in fractional ticks against the 24 PPQN clock, so groove is
exact under internal or external clock. Nothing is ever placed before the
transport's start.

## Euclidean generator (EUCLID tab)

STEPS, HITS, ROTATE, ACCENTS (none, first, 1 in 2, 1 in 3, or a Euclidean
pattern of ACCENT HITS over the hits), LEVEL for the other hits, and how to
**COMBINE** with the selected voice: REPLACE, MERGE, AND (intersection), XOR.
**SET LOOP TO STEPS** also loops the voice at STEPS, so a 5-step Euclid
plays as true polymeter against the pattern. APPLY writes into the pattern
(undoable): Euclid is source material, one tool among several.

## Mutation (version 1)

`src/extended/mutate.ts`. A mutation is a list of musical edits on a copy:
add hit, remove hit, shift a hit to a neighbour, swap neighbours, change a
striker level, toggle an accent, change density (two hits), introduce a rest
(clear 2-4 steps), recombine (copy one beat over another), rotate a track,
reverse a beat. **Strength** (0-100 %) sets the number of edits
(≈ strength^1.4 × (hits/2 + 3)) and which kinds are allowed: rests,
recombination, rotation and reversal only above 35-60 %. At low strength
positions are chosen by metric weakness, so downbeats and the accented
backbeat are rarely touched and the groove stays recognisable (tested: at
10 % the average change is under 15 % of hits; the accented snare survives).

## Evolution (EVOLVE tab)

Per pattern. A new **generation** every EVERY cycles of that pattern.

| Mode | Generation *n* |
| --- | --- |
| **ORIGINAL** | mutate(source, seed *n*): always one mutation away from what you wrote |
| **PREVIOUS** (evolving) | mutate(generation *n−1*, seed *n*): accumulates |

Controls: STRENGTH, TARGETS (voices allowed to change; none = every voice
with hits), **RETURN** every *k* generations (the cycle of variations starts
again from the source), **MAX DRIFT** (PREVIOUS: if more than this share of
the pattern differs from the source, the generation is re-derived from the
source; uncontrolled drift needs MAX DRIFT 100 %), **RESET TO SOURCE**
(generation 0 from the next cycle), **LOCK** (stores the generation you hear
in the project: it plays from then on, saved and reloaded exactly, immune to
later algorithm changes), **CAPTURE** (writes the playing variation into a
new pattern). The monitor shows the generation; the grid shows added
(hatched), changed (outlined) and removed (suppressed) hits.

## Breeding (BREED tab)

Two parents, A (the selected pattern) and B, are never changed. B is mapped
onto A's grid by position. Methods: ALTERNATE STEPS, ALTERNATE BEATS,
ALTERNATE HALVES, CROSSOVER (random point), VOICE BY VOICE (instrument
participation), RANDOM MIX (probability-based selection), A RHYTHM / B
ACCENTS (accent inheritance), FRAGMENT SWAP (one beat replaced from B).
**AUDITION** plays the child in place of the current pattern (the grid shows
it, with a banner); **ANOTHER** re-breeds with a new seed; **KEEP** adds it
to the library; **DISCARD** returns.

## Morphing (MORPH tab)

From the playing pattern to another over 4, 8 or 16 bars (rounded to whole
cycles). Every hit has a fixed threshold: a hit only in A leaves when the
progress passes its threshold and never returns; a hit only in B arrives and
stays. Thresholds combine a per-hit random value, a per-voice bias (voices
tend to move as groups) and metric weight (A's weak notes leave first and
its downbeats last; B's strong notes arrive first). Hits in both blend their
striker level. At 100 % the pattern is exactly B, which then plays. The
monitor and the MORPH tab show progress.

## Conditional triggers (RULES tab)

`WHEN <condition> THEN <action> [target] [amount] [for n cycles]`.

| Conditions | Actions |
| --- | --- |
| EVERY *n* CYCLES (at cycle *k*) | FILL (force a fill: last beat, half bar or bar by amount) |
| ON REPEAT *n* of the pattern | MUTATE (temporary mutation of the targets) |
| PATTERN STARTS | THIN (density × (1 − amount)) |
| VOICE PLAYS LESS THAN *x* % (previous cycle) | BOOST (more fills and extra hits) |
| EVERY *n* GENERATIONS (when one begins) | MUTE / UNMUTE |
| BY CHANCE *p* % (seeded) | RETURN TO SOURCE (evolution reset) |
| | PLAY SOURCE · NEXT PATTERN |

Targets: a voice, a family (kicks, snares, hats, toms, percussion) or all.

**Safety:** rules are evaluated once per cycle, when the cycle is planned,
from the state at the cycle's start; actions never trigger rule evaluation
(no recursion); at most 16 rules; every effect has a fixed duration in
cycles; effects are temporary modifications, never edits to the project.
Examples from the brief: *WHEN bar 4 begins THEN fill* = EVERY 4 AT 4 →
FILL; *EVERY 8 THEN mutate the hats* = EVERY 8 → MUTATE HATS; *WHEN kick
density falls below 50 % THEN increase percussion* = KICK PLAYS < 50 % →
BOOST PERCUSSION; *WHEN a variation reaches its final repetition THEN return
to the original* = EVERY *n* GENERATIONS → RETURN TO SOURCE.

## Polymeter

Per-voice loop lengths are part of CLASSIC (UpBeat 2.0 loop points). EXTENDED
adds nothing to the mechanism, but Euclid's SET LOOP and the polymetric demo
use it. Phase options: RESTART with each pattern, or FREE; RESYNC realigns.

## Generative performance: AUTOPILOT (AUTO tab, right panel)

One control, **ACTIVITY**, and a phrase length. Each phrase gets a section
from the seeded hash weighted by activity:

| Section | Effect |
| --- | --- |
| HOME | the groove as it is |
| VARY | light mutation of hats and percussion, shared across the phrase |
| BUSY | fills boosted on snares, toms, percussion; extra hits on hats |
| SPARSE | hats and percussion thinned |
| BREAK | kick and hats pulled back (released on the phrase's last cycle) |

After any other section the next phrase favours HOME (60 %), so the music
keeps returning to familiar material. The last cycle of every phrase fills
on snares, toms and fill-enabled voices (zone and amount scale with
activity). Every effect is expressed as the same temporary per-voice
modifications rules use, is listed in WHAT CHANGED, and is fully determined
by the seed.

## Variations and takes

NEW VARIATION (new seed), REPLAY (same seed from the top: identical output,
tested), LOCK (every cycle reuses one cycle's random decisions), SOURCE
(A/B), CAPTURE (write the heard cycle into a new pattern, including generated notes that fall on grid steps),
REC TAKE (record every played note, with live changes, for MIDI export).

# Uncertainties

Where the historical record stops, DOWNBEAT makes its own decision. Each
decision below is labelled INFERRED (an approximation of a documented but
incompletely described behaviour) or a deliberate omission. Source keys refer
to [SOURCES.md](SOURCES.md).

## No primary documentation or software

No UpBeat manual, help screen, tutorial file or application was found. Every
DOCUMENTED behaviour therefore comes from three reviews (MT87, EM87, MT90), an
advert, a product listing and a passing mention (SOS88). Reviews summarise;
they rarely give algorithms or limits. Nothing in DOWNBEAT is OBSERVED.

If a manual or a working copy surfaces, the items below are the first to
check. Algorithms are versioned (`project.algorithms`), so a corrected
version can be added without changing how existing projects play.

## Open questions and DOWNBEAT's answers

| # | Question | What the sources say | DOWNBEAT's answer |
| --- | --- | --- | --- |
| 1 | Maximum tracks per pattern | Not stated; 14 tracks visible in a 1.0 screenshot; 16-channel Device List (2.0). | 16 voices per project (INFERRED). |
| 2 | Maximum pattern length | Not stated. | 8 bars, 64 steps (INFERRED; a browser-grid limit). |
| 3 | Which strikes density removes | "About half the time" at 50 % (MT87). | Seeded per cycle; louder strikers survive more often (INFERRED v1, see CLASSIC_SPEC). Offenhartz's stated dislike of pure random note dropping (ROOS24) motivated the accent bias, but that is not evidence of the original algorithm. |
| 4 | Where fills go inside a gap | Amount, rate, spacing, a per-gap limit (EM87, MT90). | Considered backwards from the next written strike: fills lead into it (INFERRED v1). |
| 5 | Whether fills change each repetition | Not stated; described as automatic, intelligent improvisation (AD87). | They change every cycle, deterministically for a seed; Extended LOCK freezes a variation. |
| 6 | Whether accents influence fills | Not stated. | A fill note before an accent is raised one striker level (INFERRED). |
| 7 | Fill "quantisation" (1.0) vs "rhythmic division" (2.0) | Both named, not explained. | One RATE control (½ to 4 times the grid); fill notes always sit on that grid. |
| 8 | "Number of beats on which a fill can play between written drum notes" (EM87) | Named only. | MAX: fill notes per gap. |
| 9 | Fill zones | Not documented. | ZONE is an EXTENDED addition (anywhere / last bar / last half bar / last beat). Default is anywhere. |
| 10 | Jam Tool | Rolls and superimposed rhythms (MT87); absent from MT90. | Hold-to-jam ROLL or ECHO on a voice (INFERRED). Included in CLASSIC because it is documented for 1.0. |
| 11 | Flam | "Facilities such as 'flam'" (SOS88). | A per-strike grace note one tick early at 55 % velocity (INFERRED). |
| 12 | Rotation with wraparound | Only fine shifting is documented (EM87). | Step rotation with wraparound (INFERRED) plus fine SHIFT (DOCUMENTED). |
| 13 | Loop points | Anywhere, several per track, each with a percentage (MT90). | One loop point per track with a loop percentage (simplification). Loop length cannot exceed the pattern length. |
| 14 | Swing | Absent in 1.0 (MT87), unmentioned in 2.0. | Swing and groove are EXTENDED. |
| 15 | MIDI Clock | Only via Apple's MIDI Manager (MT90 sidebar). | 24 PPQN clock in and out, Start / Stop / Continue, Song Position on stop: modern facilities, no historical claim. |
| 16 | Articulation strikers | Five plus random, 3 %-350 % with ± (MT90). | One gate length per voice. Most drum machines ignore note length; per-strike articulation is not implemented. |
| 17 | Paste modes, Compander | Merge, Swap, Repeat, Fill/Fit, Clipped; real-time Compander (MT87, MT90). | Not implemented: track copy / paste only. Recorded here as a known gap. |
| 18 | Program change strikes, MIDI Volume | 2.0 (MT90). | Per-voice program change at Start only; no program change strikes; no MIDI Volume. |
| 19 | Normal (synth) tracks, chords | 2.0 (MT90). | Out of scope: DOWNBEAT is a drum instrument. A step may still be a chord. |
| 20 | Nested songs, MIDI Files inside songs | MT87, MT90. | Not implemented. Songs are flat lists of patterns. |
| 21 | Count-in, MIDI Thru / echo | MT90. | Not implemented. |
| 22 | Default velocities | Two example settings only (110 ± 15, 30 ± 10). | 28 / 52 / 80 / 104 / 124 with small ranges (INFERRED). |
| 23 | Device files | Up to 16 Device definitions loaded from disk (MT90). | Voices are saved with the project; there is no separate device library. |
| 24 | Velocity of fill notes for a different sound | Not stated. | Uses the filled track's striker velocities. |

## Hardware

No physical MIDI hardware was available while building DOWNBEAT. MIDI output,
clock in and out and transport were tested with simulated Web MIDI devices
only. Behaviour with real devices (including a Hermod+) is untested; see
[MIDI.md](MIDI.md).

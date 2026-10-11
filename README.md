# DOWNBEAT

**An intelligent rhythm machine.** You establish a rhythm; DOWNBEAT explores
what that rhythm could become.

DOWNBEAT is a browser instrument for drums and percussion. Write a pattern,
press PLAY, and keep intervening: thin it out, fill the gaps, shift it, let
it evolve, breed it with another pattern, morph between two, or leave the
autopilot running. What you wrote is never changed by the performance: the
grid always shows which hits are yours, which were **generated**, which were
**suppressed** this time round, and where each voice is playing.

It plays immediately through its own synthesised drum sounds, and it is a
full MIDI instrument: per-voice channels and notes, 24 PPQN clock in and out
with Start / Stop / Continue, Standard MIDI File export and import. It is
meant to sit beside external drum machines, samplers and modular systems
(a Hermod+, for example).

![DOWNBEAT playing the jungle demo](docs/images/downbeat.png)

**Live:** <https://downbeat.allmyfriendsaresynths.com> (deployed with GitHub Pages from `main`) ·
**Quick Start:** [docs/QUICK_START.md](docs/QUICK_START.md)

## Inspiration

DOWNBEAT is inspired by **UpBeat**, "the intelligent rhythm programmer"
published for the Apple Macintosh by Intelligent Music in 1987 (created by
John Offenhartz) and updated as UpBeat 2.0 in 1990. UpBeat treated each
drum track's playback as something the program could vary: note density,
timing, velocity ranges, automatic fills, loops of their own length. DOWNBEAT
is an independent, clean-room instrument built from what the contemporary
reviews document, with modern generative extensions.

DOWNBEAT is not affiliated with or endorsed by Intelligent Music, its
successors or the original developers. It contains none of their code,
artwork, samples or presets; no original software or manual was available
during development. See [docs/HISTORICAL_RESEARCH.md](docs/HISTORICAL_RESEARCH.md)
and [docs/SOURCES.md](docs/SOURCES.md).

It joins a family of instruments: **emmm** (Intelligent Music's M),
**Feelers** (Dr. T's Fingers), **FrakMC** (Fractal Music Composer),
**ANVIL** (Dr. T's Tunesmith) and **Good Bits**.

## CLASSIC and EXTENDED

| | What it is |
| --- | --- |
| **CLASSIC** | UpBeat's documented behaviour, independently implemented: five velocity strikers and a random striker with centre ± range, sound step lists with random steps (sound variation), flams, note density, ± timing and track shift, automatic fills (fill sound, amount, rate, spacing, notes per gap, fill velocity), per-track loop points with loop percentages (polyrhythm), the Jam roll, patterns, songs, MIDI files. Where the sources stop, DOWNBEAT's approximations are labelled INFERRED and versioned. See [docs/CLASSIC_SPEC.md](docs/CLASSIC_SPEC.md). |
| **EXTENDED** | New: per-voice and per-step probability, extra hits, groove and swing, a Euclidean generator, evolution (from the original, or from the previous variation), mutation, breeding, morphing, WHEN / THEN rules and an autopilot with one ACTIVITY control. Every feature can be switched off; CLASSIC switches them all off. See [docs/EXTENDED_SPEC.md](docs/EXTENDED_SPEC.md). |

Both modes share one engine, one scheduler and one MIDI system. Every random
decision is a keyed hash of a seed, so the same project and seed replay the
same take; NEW VARIATION changes the seed, LOCK repeats the variation you
hear, SOURCE plays only what you wrote, CAPTURE writes what you hear into a
new pattern.

## Demos

Six original demos (FILE → DEMOS): Basic Electro, Four to the Floor,
Broken Beat, Jungle Pressure, Minimal Generative, Polymetric Percussion.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints. Other scripts:

| Command | |
| --- | --- |
| `npm test` | unit tests (Vitest): engine, MIDI and transport, persistence, palettes |
| `npm run typecheck` | TypeScript |
| `npm run build` | production build in `dist/` (relative paths: works at any address) |
| `npm run test:e2e` | browser tests (Playwright) against the built site, using the installed Google Chrome locally |

Web MIDI needs Chrome, Edge, Opera or Firefox. Internal sounds work in any
modern browser.

## Documentation

- [Quick Start](docs/QUICK_START.md)
- [Historical research](docs/HISTORICAL_RESEARCH.md), [Classic spec](docs/CLASSIC_SPEC.md), [Uncertainties](docs/UNCERTAINTIES.md), [Sources](docs/SOURCES.md)
- [Extended spec](docs/EXTENDED_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md), [Design](docs/DESIGN.md), [MIDI and sync](docs/MIDI.md)

## How historical is CLASSIC?

No UpBeat manual or executable could be found. CLASSIC is built from three
contemporary magazine reviews (1987 and 1990), adverts and screenshots, not
from observing the original program. The reviews describe *what* UpBeat's
controls did, rarely *how*: the exact density, fill, jam and flam algorithms
are DOWNBEAT's own approximations, labelled INFERRED and versioned so they can
be corrected later without changing saved projects. CLASSIC is a faithful
reading of the documented feature set, not an exact reproduction of UpBeat's
output.

## Known limitations

- Songs are flat lists of patterns with repeat counts (UpBeat could nest songs).
- Patterns are at most 8 bars and 64 steps; a track's loop cannot be longer than its pattern.
- Not implemented from UpBeat: paste modes and the Compander, articulation strikers, program-change strikes, MIDI Volume, count-in, MIDI Thru, Normal (synth) tracks, MIDI files inside songs. See [docs/UNCERTAINTIES.md](docs/UNCERTAINTIES.md).
- The fill ZONE control is an EXTENDED addition that stays available in CLASSIC (set it to ANYWHERE for the documented behaviour).
- No physical MIDI hardware has been tested: MIDI was verified with simulated Web MIDI devices only. See [docs/MIDI.md](docs/MIDI.md) for what needs checking on real equipment.
- The internal sounds were checked in code and in the browser, not by ear in automated tests.

## Licence

MIT (see [LICENSE](LICENSE)) for DOWNBEAT's own code. "UpBeat" and
"Intelligent Music" are named only to describe the historical inspiration.

# Design

DOWNBEAT belongs to a family of instruments (emmm, Feelers, FrakMC, ANVIL).
The aim, as Feelers' design notes put it, is *same designer, same family,
different instrument*: the collection's conventions are kept, and the
interface is shaped by DOWNBEAT's own musical model. Historical sources
informed the behaviour, not the look: no original artwork was reproduced.

## Shared conventions kept

- Paper and ink; 1px ink frames; square corners; hard 2px offset shadows on
  panels and the main transport buttons.
- "On" and "selected" by inverting ink and paper (selected tool and voice
  use the selection colour).
- Compact uppercase labels, monospaced type; Silkscreen (a bitmap-style
  font) for the wordmark and panel titles only.
- No hover decoration, no eased animation; the only blink is the stepped
  LOST clock chip.
- Transport first in the top bar (PLAY / PAUSE / CONTINUE, STOP), a status
  line that explains whatever is under the pointer, in-app dialogs instead
  of browser alerts.
- Mutually exclusive choices as segmented buttons; PANIC with a 2px warning
  border; SYNC INT / EXT with a status chip (WAITING, CLOCK, RUNNING,
  STOPPED, LOST).
- Extended features tagged **EXT** (a small dashed tag), and gathered under
  an EXTENDED tab group that only appears in EXTENDED mode.
- Palettes: semantic roles only, built-ins never edited, custom copies,
  import / export, emmm and Feelers palette files import by shared role
  names, contrast warnings that never change a colour, stored as browser
  preferences (`downbeat.palette.*`).
- Files named `<name>.downbeat.json`; preferences under `downbeat.*`.

## DOWNBEAT's own identity: the rhythm ledger

The grid is the instrument. Voices run down the side with an identity
colour tag, mute, solo and a hold-to-JAM button; steps run across with heavy
bar lines and alternating beat shading. Each cell answers four questions:

| What | Drawn as | Palette role |
| --- | --- | --- |
| **Source** hit (written, playing) | solid bar; height = striker 1-5; accents get a cap | `source`, `accent` |
| **Suppressed** hit (written, resting this cycle) | the same bar hollow, dashed and struck through | `suppressed` |
| **Generated** hit (fill / extra / jam) | diamond (fill) or dot (extra), placed inside the cell by its timing, so triplet rolls show three marks | `generated` |
| **Mutated** hit (added / changed by a variation) | hatched bar (added), outlined bar (changed) | `generated` |
| **Playhead** | a tinted column and the step number inverted; plus a frame on each row's own position | `playhead` |

Further marks: flam (double tick at the left), sound step (`2`, `?`) and
per-step probability (`50`) as tiny corner figures, cells outside a voice's
loop hatched with a heavy loop-end edge. Every distinction is carried by
shape as well as colour, so the 1-bit **Classic** palette loses nothing.

While stopped the grid shows a *preview* of the first cycle, so changing
density or fills is visible before playing. While playing it shows the
cycle being heard (not the one being scheduled).

### Making the engine visible

- **NOW PLAYING**: pattern (with song entry and repeat), cycle and repeat,
  generation, generated / suppressed counts this cycle, mode, autopilot
  section, morph progress.
- **WHAT CHANGED**: a feed, in heard order, of pattern and song changes,
  fills per voice, extra hits, generations, what a variation changed
  (+added −removed ~changed, and which voices), rules that fired, autopilot
  sections, morph percentages, SOURCE and LOCK.
- The right-hand column of the grid shows each voice's loop length, the
  number generated this cycle and a meter of how much of what was written is
  playing.

### Layout

| Width | Layout |
| --- | --- |
| ≥ 1240 px | patterns · grid and panels · monitor |
| 760-1240 px | patterns · grid and panels; monitor below |
| < 760 px | one column; the grid scrolls sideways inside its panel |

Panels use tabs so the parameters of one voice are visible at a time:
CLASSIC tabs (VOICE, VELOCITY, FILL, TIME, PATTERN, SONG) follow UpBeat's
per-track displays; EXTENDED tabs (PROB, GROOVE, EUCLID, EVOLVE, BREED,
MORPH, RULES, AUTO) appear after an EXTENDED divider.

## Palette roles

| Role | CSS | Used for |
| --- | --- | --- |
| Desktop | `--desktop` | page background |
| Paper | `--paper` | panels, grid |
| Ink | `--ink` | frames, text, controls |
| Dim | `--dim` | labels, guides |
| Source hits | `--src` | written strikes |
| Generated hits | `--gen` | fills, extra hits, jams, mutations, EXT tags |
| Suppressed hits | `--sup` | resting strikes |
| Playhead | `--play` | the playing step and loop positions |
| Accent | `--accent` | accent caps, SOURCE active |
| Running | `--activity` | PLAY while playing, clock running |
| Selected | `--selection` | selected voice, tool, LOCK |
| Warning | `--warn` | PANIC, MUTE, lost clock |
| Voice identities | `--v1`..`--v6` | kick, snare, hats, toms, percussion, cymbals |

Built-in palettes: **Downbeat** (default: warm paper, signal orange for
generated material, blue playhead), **Classic** (1-bit), **Dark**,
**Colour**. Derived colours (rules, wells, washes) are `color-mix` of roles.

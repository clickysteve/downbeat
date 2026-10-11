# Sources

Every historical statement in the DOWNBEAT documentation can be traced to one
of the sources below. Research was carried out in October 2026. No original
UpBeat manual, disk image or application binary was found (see "Searched,
nothing found"), so no behaviour has been **OBSERVED** in the original
software. Nothing from these sources (text, artwork, screenshots, presets) is
included in this repository; the scans were read from the publishers' public
archives and kept outside the repository.

## Primary sources (contemporary, 1987-1990)

| Key | Source | What it covers |
| --- | --- | --- |
| **MT87** | Jim Burgess, "Intelligent Music UpBeat", *Music Technology* (UK), September 1987. Muzines archive: <https://www.muzines.co.uk/articles/intelligent-music-upbeat/2089> | UpBeat 1.0 (reviewed as a pre-release). Patterns, Library, Song window, Strike View, Drum Machine / Synthesiser modes, Device window, Sound Set-Up, the six Pattern-window views (Strike, MIDI, Velocity, Staccato/Legato, Fill, Fill Velocity), 96 PPQN internal resolution, Edit grid, five velocity strikers plus a random striker, velocity deviation, note density 0-100 %, fills (timing, probability, speed, quantisation, fill-with-another-track), the Jam Tool, paste modes, program change per loop, Movies saved as MIDI Files. Notes that swing is absent. |
| **EM87** | Tim Tully, "Intelligent Music UpBeat Rhythm Programmer for MIDI Drum Machines and Synthesizers ($150)", *Electronic Musician*, November 1987, pp. 24-25. <https://www.worldradiohistory.com/Archive-All-Music/Electronic-Musician/1987/Electronic-Musician-1987-11.pdf> | UpBeat 1.0. Includes a screenshot of the Pattern, Library and Song ("HitSong") windows. Fill controls: which instrument fills, probability of fill notes, "the number of beats on which a fill can play between written drum notes", speed, quantisation, probability of five fill volumes. Mute, solo, velocity, tempo, meter, measure length, sub-beats per measure. Shifting notes or whole tracks by 1/384 of a measure. Song window with repeat counts. |
| **EM87-new** | "What's New" entry, *Electronic Musician*, October 1987, p. 102 (same archive, 1987-10 issue). | Fills "according to a user-settable probability percentage that dictates speed, degree of quantization, and velocity"; quantising "with allowances for 'human' feel"; mute, solo, Merge / Cut / Paste; patterns linked into songs; "having the computer randomly select pitches". |
| **AD87** | Intelligent Music advertisement, *Electronic Musician* October 1987 p. 28 and *Music Technology* (US) October 1987 p. 43. | "The smart rhythm programmer for all MIDI drum machines and synthesizers"; "intelligent fills and improvisation, multi-track/multi-device capability, MIDI recording, and a song structure editor". |
| **MT90** | Lachlan Westfall, "Intelligent Music UpBeat 2.0", *Music Technology* (US edition), April 1990, pp. 60-63. <https://worldradiohistory.com/UK/Elecctronics-Music-Maker/Music-Technology-UK-1990-04.pdf> | UpBeat 2.0 (2.01). Five working areas (Control Strip, Palette, Counter, Pattern window, Library). Devices and Sounds; Sounds of up to 127 "steps" with a random step indicator; Rhythm / Normal track types (formerly Drum / Synth); 16-line Device List & Input Setup. Eight per-track displays: Main, Output, Velocity, Random Velocity, Articulation, Random Articulation, Fills, Time. Fill source track, rhythmic division, percentage of empty space, spacing. Note density and ± tick placement. Program-change strikes, fit paste and the real-time Compander, merge / clipped / swap / repeat paste. Per-track loop points with loop percentages ("very complex polyrhythmic effects"). Capture to Standard MIDI File, pattern export as type 0 / type 1 with repetitions, MIDI File import. Two screenshots (Step List, Main window) and two dialog figures (import, Song window). Everything usable in real time while playing. |
| **SOS88** | Ed Jones, "Intelligent Music's M Software", *Sound On Sound*, August 1988. <https://www.muzines.co.uk/articles/intelligent-music/3953> | Passing mention: UpBeat "works with a drum machine-like grid" and has facilities "such as 'flam'". |

## Secondary and retrospective sources

| Key | Source | What it covers |
| --- | --- | --- |
| **ROOS24** | Kristen Roos, "Intelligent Music: Unearthing the human intention behind vintage algorithmic sequencing software", *CLOT Magazine*, 12 November 2024. <https://clotmag.com/oped/intelligent-music-unearthing-the-human-intention-behind-vintage-algorithmic-sequencing-software> | Names John Offenhartz as UpBeat's creator; interview (2024). Offenhartz on wanting "opinionated" controlled randomness informed by the source material rather than random note dropping, and on sequencers being too precise. Roos used UpBeat on a PowerBook with an Oberheim DMX. |
| **USI3** | Kristen Roos, *Universal Synthesizer Interface Vol. III* (album, 2024), release notes at Rough Trade / Audiopile. <https://kristenroos.ca/work/usi> | UpBeat described as "The Intelligent Rhythm Sequencer" (1987); looping patterns adjusted live; algorithmic per-drum control of density, timing, articulation and velocity. |
| **INFOMAC93** | Info-Mac MIDI software list, August 1993. <https://sunsite.icm.edu.pl/packages/info-mac/_Information/sft/midi.txt> | UpBeat listed with Dr. T's Music Software as contact (Intelligent Music's catalogue later published by Dr. T's). |

## Sibling instruments consulted (design conventions, not history)

- emmm (`clickysteve/emmm`) and FrakMC (`clickysteve/frakmc`): stack (Vite,
  TypeScript, Vitest), Pages workflow, palette system, transport history.
- Feelers (`clickysteve/feelers`): `docs/DESIGN.md` (the collection's shared
  conventions), `docs/ARCHITECTURE.md` (lookahead scheduler, note safety,
  external clock). DOWNBEAT re-implements these ideas for a drum instrument.
- ANVIL (`clickysteve/anvil`): repository empty at the time of writing.

## Searched, nothing found

- Internet Archive full-text and metadata search for "UpBeat" with
  "Intelligent Music": no manual, disk image or scan.
- All 87 `Macintosh_Garden_Manuals_*` collections on the Internet Archive
  (file names searched for "upbeat" and "intelligent music"): no UpBeat
  manual.
- Macintosh Repository and Macintosh Garden searches: no UpBeat listing
  found.
- Sound On Sound, Keyboard: no dedicated UpBeat review found (SOS88 is the
  only SOS mention located).

Because the original software was not available, no emulator testing was
attempted. No binary was disassembled or decompiled.

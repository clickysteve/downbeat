/**
 * How DOWNBEAT plays notes through Slop Factory Core: which instrument plays a drum sound,
 * which choke group a note belongs to, the sequencer voices' processing strips and the
 * master stage after Core's mixer. Shared by live playback and export, so both make the same
 * decisions.
 */
import type { ChokeSettings, Instrument, NoteHandle, NoteRequest, ResolveChoke, ResolveInstrument, StripSettings } from '@slopfactory/core/audio';
import type { SampleInstrument } from '@slopfactory/core/sampler';
import type { Project, Voice } from '../engine/types';
import { DrumInstrument } from './drums';
import type { SampleLibrary } from './library';
import { audioOf, chokeFor, parseSoundKey, type ProjectAudio, type SoundSlot } from './settings';

/** Seed for the output processors' noise (fixed, so exports are reproducible). */
export const FX_SEED = 0xd0b3;

/** Notes a voice may have sounding at once before the oldest is stopped. */
export const MAX_PER_VOICE = 64;

/**
 * A sample playing a drum sound: at its own pitch for the sound step's (first) note, so
 * changing the note a step sends over MIDI never retunes the sample; the other notes of a
 * chord, and TUNE / FINE, transpose it.
 */
export class StepSample implements Instrument {
  constructor(readonly sample: SampleInstrument, readonly base: number) {}
  start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null {
    return this.sample.start(ctx, out, { ...note, pitch: this.sample.zone.root + note.pitch - this.base });
  }
}

interface Resolved {
  voice: Voice;
  step: number;
  slot: SoundSlot | null;
}

function lookup(project: Project, audio: ProjectAudio | null, key: string | undefined): Resolved | null {
  const k = parseSoundKey(key);
  if (!k) return null;
  const voice = project.voices.find((v) => v.id === k.voice);
  if (!voice) return null;
  return { voice, step: k.step, slot: audio?.sounds[voice.id]?.[k.step] ?? null };
}

/** Which drum sound a note plays is carried by its instrument key (see timeline.ts). */
export function instrumentFor(project: Project, library: SampleLibrary, key: string | undefined): Instrument | null {
  const r = lookup(project, project.audio ?? null, key);
  if (!r) return null;
  const notes = r.voice.notes[r.step] ?? r.voice.notes[0] ?? [];
  if (r.slot?.source === 'sample') {
    // a SAMPLE sound whose sample is missing, failed or still loading plays the internal sound
    const s = library.instrument(key!);
    if (s) return new StepSample(s, notes[0] ?? s.zone.root);
  }
  return new DrumInstrument(r.voice.sound, r.voice.notes[0]?.[0] ?? notes[0] ?? 60);
}

export function makeResolver(getProject: () => Project, library: SampleLibrary): ResolveInstrument {
  return (_voice, note) => instrumentFor(getProject(), library, note.instrument);
}

export function chokeOf(project: Project, key: string | undefined): ChokeSettings | null {
  const r = lookup(project, project.audio ?? null, key);
  return r ? chokeFor(r.slot, r.voice.sound.kind) : null;
}

export function makeChoke(getProject: () => Project): ResolveChoke {
  return (_voice, note) => chokeOf(getProject(), note.instrument);
}

/** Sequencer voice strips: each voice's output processing (gain and pan stay at unity). */
export function voiceStrips(project: Project): Record<string, Partial<StripSettings>> {
  const a = audioOf(project);
  const out: Record<string, Partial<StripSettings>> = {};
  for (const v of project.voices) if (a.voiceFx[v.id]) out[v.id] = { fx: a.voiceFx[v.id] };
  return out;
}

/**
 * DOWNBEAT's own master stage after Core's master processing and VOLUME: the master
 * compressor it has always had, with the same settings. It is applied to the master only:
 * never to stems.
 */
export function masterCompressor(ctx: BaseAudioContext, input: AudioNode): AudioNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  input.connect(comp);
  return comp;
}

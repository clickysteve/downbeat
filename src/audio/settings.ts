/**
 * DOWNBEAT's audio settings (project format 2): what each drum sound plays, its choke group,
 * and the output processing of each sequencer voice and of the master.
 *
 * Sequencer voice and drum sound are different things:
 *
 * - A **sequencer voice** is a track (a row of the grid). Its performance can play other
 *   voices' sounds (a fill with FILL SOUND set) and several sounds of its own (its sound
 *   steps).
 * - A **drum sound** is one sound step of one voice: the note or chord that step sends over
 *   MIDI and the sound that plays it internally. Every generated event names the voice whose
 *   sound plays (`sound`) and the step (`note`), so the drum sound of every note is explicit;
 *   it is never guessed from the pitch.
 *
 * Each drum sound plays either its voice's INTERNAL synthesised sound (as DOWNBEAT always
 * did) or a SAMPLE. Settings are plain JSON stored in the project; audio is never stored
 * here, only sample ids (SHA-256 of the file) and names.
 *
 * Projects without an `audio` section (every project made before format 2, and new projects
 * until something is changed) use the defaults: every sound INTERNAL, the hat choke as it
 * always worked, all processing CLEAN. They sound exactly as before.
 */
import { cleanFx, identityTransform, repairFx, repairTransform, type OutputFxSettings, type SampleTransform } from '@slopfactory/core/dsp';
import { defaultZone, repairZone, type SampleZone } from '@slopfactory/core/sampler';
import type { ChokeSettings } from '@slopfactory/core/audio';
import { MAX_SOUND_STEPS, type InternalSound, type Project, type Voice } from '../engine/types';

export type SoundSource = 'internal' | 'sample';

/** AUTO: the internal sound decides (a closed hat cuts open hats); OFF: never; GROUP: choke group 1-4. */
export type ChokeMode = 'auto' | 'off' | 'group';
/** In a group: BOTH cuts and can be cut; CUTS only cuts (a closed hat); CUT BY only gets cut (an open hat). */
export type ChokeRole = 'both' | 'cuts' | 'cutby';
export const CHOKE_GROUPS = 4;

export interface SoundChoke {
  mode: ChokeMode;
  group: number;
  role: ChokeRole;
}

export interface SoundSlot {
  source: SoundSource;
  /** SHA-256 of the sample file in browser storage, or null */
  sampleId: string | null;
  /** the sample's file name */
  name: string;
  /**
   * How the sample plays (Core zone): TUNE, FINE, VOLUME, PAN, mode, start/end, loop,
   * release, velocity sensitivity, mute. The sample plays at its own pitch for the sound step's
   * (first) note; `root` stays at its default and is not shown.
   */
  zone: SampleZone;
  /** whole-sample processing (Good Bits STRETCH FX), applied before playback */
  transform: SampleTransform;
  choke: SoundChoke;
}

export interface ProjectAudio {
  /** voice id -> one slot per sound step (index = step) */
  sounds: Record<string, SoundSlot[]>;
  /** voice id -> output processing of that sequencer voice */
  voiceFx: Record<string, OutputFxSettings>;
  /** master output processing (before VOLUME and the master compressor) */
  master: OutputFxSettings;
}

export const defaultChoke = (): SoundChoke => ({ mode: 'auto', group: 1, role: 'both' });

export function defaultSlot(): SoundSlot {
  return { source: 'internal', sampleId: null, name: '', zone: { ...defaultZone(), mode: 'oneshot' }, transform: identityTransform(), choke: defaultChoke() };
}

export function defaultAudio(project: Pick<Project, 'voices'>): ProjectAudio {
  const a: ProjectAudio = { sounds: {}, voiceFx: {}, master: cleanFx() };
  syncAudioShape(a, project.voices);
  return a;
}

/** Give every voice a slot per sound step and a processor; drop entries of deleted voices. */
export function syncAudioShape(a: ProjectAudio, voices: Voice[]): void {
  const ids = new Set(voices.map((v) => v.id));
  for (const v of voices) {
    const slots = a.sounds[v.id] ?? [];
    while (slots.length < v.notes.length) slots.push(defaultSlot());
    if (slots.length > v.notes.length) slots.length = v.notes.length;
    a.sounds[v.id] = slots;
    a.voiceFx[v.id] ??= cleanFx();
  }
  for (const id of Object.keys(a.sounds)) if (!ids.has(id)) delete a.sounds[id];
  for (const id of Object.keys(a.voiceFx)) if (!ids.has(id)) delete a.voiceFx[id];
}

/** The project's audio settings, or the defaults when it has none (not stored). */
export function audioOf(project: Pick<Project, 'voices' | 'audio'>): ProjectAudio {
  return project.audio ?? defaultAudio(project);
}

/** Give the project its own audio section (before the first change), in shape with its voices. */
export function ensureAudio(project: Project): ProjectAudio {
  if (!project.audio) project.audio = defaultAudio(project);
  else syncAudioShape(project.audio, project.voices);
  return project.audio;
}

// ------------------------------------------------------------------ drum sounds

/** The key of a drum sound: the voice whose sound plays and the sound step. */
export const soundKey = (voiceId: string, step: number): string => `${voiceId}#${step}`;

export function parseSoundKey(key: string | undefined): { voice: string; step: number } | null {
  if (!key) return null;
  const i = key.lastIndexOf('#');
  if (i <= 0) return null;
  const step = Number(key.slice(i + 1));
  return Number.isInteger(step) && step >= 0 ? { voice: key.slice(0, i), step } : null;
}

export interface DrumSound {
  key: string;
  voice: Voice;
  step: number;
  /** "CL HAT" or "CL HAT 2" (voices with several steps) */
  label: string;
  /** the step's notes */
  notes: number[];
}

/** Every drum sound of the project: each sound step of each voice, in voice order. */
export function drumSounds(project: Pick<Project, 'voices'>): DrumSound[] {
  return project.voices.flatMap((v) => v.notes.map((notes, step) => ({ key: soundKey(v.id, step), voice: v, step, label: v.notes.length > 1 ? `${v.name} ${step + 1}` : v.name, notes })));
}

export function slotOf(audio: ProjectAudio, key: string): SoundSlot | null {
  const k = parseSoundKey(key);
  return k ? audio.sounds[k.voice]?.[k.step] ?? null : null;
}

/** Samples a project refers to, each once. */
export function referencedSamples(audio: ProjectAudio | undefined): string[] {
  if (!audio) return [];
  const ids = new Set<string>();
  for (const slots of Object.values(audio.sounds)) for (const s of slots) if (s.sampleId) ids.add(s.sampleId);
  return [...ids];
}

// ------------------------------------------------------------------ choke groups

/** The fade (seconds) of a choked note: the time constant of the old closed-hat choke. */
export const CHOKE_FADE = 0.008;

/**
 * The choke settings of a note of a drum sound. AUTO keeps DOWNBEAT's original behaviour for
 * the internal sounds: a voice whose sound is HAT cuts the ringing notes of voices whose sound
 * is OPEN HAT (one way; open hats never cut anything), whatever plays them.
 */
export function chokeFor(slot: SoundSlot | null, kind: InternalSound): ChokeSettings | null {
  const c = slot?.choke ?? defaultChoke();
  if (c.mode === 'off') return null;
  if (c.mode === 'auto') {
    if (kind === 'hat') return { group: 'auto:hat', cutBy: false, fade: CHOKE_FADE };
    if (kind === 'openhat') return { group: 'auto:hat', cuts: false, fade: CHOKE_FADE };
    return null;
  }
  return { group: `group:${c.group}`, cuts: c.role !== 'cutby', cutBy: c.role !== 'cuts', fade: CHOKE_FADE };
}

export function chokeLabel(c: SoundChoke): string {
  if (c.mode === 'auto') return 'AUTO';
  if (c.mode === 'off') return 'OFF';
  return `${c.group}${c.role === 'cuts' ? ' CUTS' : c.role === 'cutby' ? ' CUT BY' : ''}`;
}

// ------------------------------------------------------------------ repair

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, xs: readonly T[], d: T): T => (xs.includes(v as T) ? (v as T) : d);

function repairSlot(v: unknown): SoundSlot {
  const d = defaultSlot();
  if (!isObj(v)) return d;
  const sampleId = typeof v.sampleId === 'string' && /^[0-9a-f]{64}$/.test(v.sampleId) ? v.sampleId : null;
  const c = isObj(v.choke) ? v.choke : {};
  const g = typeof c.group === 'number' && Number.isFinite(c.group) ? Math.round(c.group) : 1;
  return {
    source: oneOf(v.source, ['internal', 'sample'] as const, 'internal'),
    sampleId,
    name: sampleId && typeof v.name === 'string' ? v.name.slice(0, 120) : '',
    zone: isObj(v.zone) ? repairZone(v.zone) : d.zone,
    transform: repairTransform(v.transform),
    choke: { mode: oneOf(c.mode, ['auto', 'off', 'group'] as const, 'auto'), group: Math.max(1, Math.min(CHOKE_GROUPS, g)), role: oneOf(c.role, ['both', 'cuts', 'cutby'] as const, 'both') },
  };
}

/** Repair a stored audio section against the project's (repaired) voices. */
export function repairAudio(v: unknown, voices: Voice[]): ProjectAudio {
  const a: ProjectAudio = { sounds: {}, voiceFx: {}, master: cleanFx() };
  if (isObj(v)) {
    const sounds = isObj(v.sounds) ? v.sounds : {};
    const fx = isObj(v.voiceFx) ? v.voiceFx : {};
    for (const voice of voices) {
      const s = sounds[voice.id];
      if (Array.isArray(s)) a.sounds[voice.id] = s.slice(0, MAX_SOUND_STEPS).map(repairSlot);
      if (fx[voice.id] !== undefined) a.voiceFx[voice.id] = repairFx(fx[voice.id]);
    }
    a.master = repairFx(v.master);
  }
  syncAudioShape(a, voices);
  return a;
}

/**
 * KITS: DOWNBEAT's side of Slop Factory Core's kit system (`@slopfactory/core/kits`).
 *
 * Core owns the sample library, kits, their storage, portable kit files and the kit workflow
 * (KitSession). This adapter decides what a kit means here:
 *
 * - A kit is the **samples of the drum sounds** (the SAMPLE BANK): which sample each drum sound
 *   plays, with its playback settings (zone, transformation, choke group). Loading a kit never
 *   changes voices, notes, patterns, strikes, density, fills, the song, the mixer (voice and
 *   master processing, the output chain) or MIDI. It is one undoable edit.
 * - Each drum sound (a sound step of a voice) is a target with a role from its internal sound
 *   (KICK, SNARE, CL HAT ...), or for a later step from its General MIDI note (CL HAT step 2 sends
 *   44: PEDAL HAT). Several of one role are told apart by index (SNARE steps 1 and 2).
 * - A drum sound plays one sample. A kit's extra samples for it, and its instruments DOWNBEAT
 *   has no drum sound for (The Breakery's GHOST), stay in the kit: saving it again keeps them.
 */
import { mapKit, pickOrder, type KitData, type KitHost, type KitInstrument, type KitMapping, type KitTarget } from '@slopfactory/core/kits';
import type { Project, Voice, InternalSound, Family } from '../engine/types';
import { audioOf, defaultSlot, drumSounds, repairSlot, type SoundSlot } from './settings';

export const APP_ID = 'downbeat';
/** The library's database (kits and the sample index; audio stays in `downbeat-samples`). */
export const KIT_LIBRARY_DB = 'downbeat-kit-library';

const KIND_ROLE: Partial<Record<InternalSound, string>> = {
  kick: 'kick',
  kick2: 'kick',
  snare: 'snare',
  snare2: 'snare',
  rim: 'rim',
  clap: 'clap',
  hat: 'hat-closed',
  openhat: 'hat-open',
  tomlo: 'tom-low',
  tommid: 'tom-mid',
  tomhi: 'tom-high',
  cowbell: 'cowbell',
  clave: 'clave',
  shaker: 'shaker',
  conga: 'conga',
  crash: 'crash',
  ride: 'ride',
  zap: 'fx',
};
const FAMILY_ROLE: Record<Family, string> = { kick: 'kick', snare: 'snare', clap: 'clap', hat: 'hat-closed', openhat: 'hat-open', tom: 'tom-mid', perc: 'perc', cymbal: 'crash' };
/** General MIDI drum notes, for the roles of later sound steps. */
const GM_ROLE: Record<number, string> = {
  35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tom-low', 42: 'hat-closed', 43: 'tom-low', 44: 'hat-pedal', 45: 'tom-low', 46: 'hat-open', 47: 'tom-mid', 48: 'tom-mid', 49: 'crash', 50: 'tom-high', 51: 'ride', 52: 'crash', 53: 'ride', 54: 'perc', 55: 'crash', 56: 'cowbell', 57: 'crash', 59: 'ride', 62: 'conga', 63: 'conga', 64: 'conga', 69: 'shaker', 70: 'shaker', 75: 'clave',
};
/** The roles a drum sound also takes when a kit has none of its own. */
const ACCEPTS: Record<string, string[]> = {
  'tom-low': ['tom-mid', 'tom-high'],
  'tom-mid': ['tom-low', 'tom-high'],
  'tom-high': ['tom-mid', 'tom-low'],
  'hat-pedal': ['hat-closed'],
  crash: ['ride'],
  ride: ['crash'],
  clap: ['perc'],
  rim: ['perc'],
  cowbell: ['perc'],
  shaker: ['perc'],
  clave: ['perc'],
  conga: ['perc'],
  perc: ['clap', 'rim', 'cowbell', 'shaker', 'clave', 'conga'],
};

/** The kit role of a drum sound. */
export function roleOf(voice: Voice, step: number): string {
  const base = KIND_ROLE[voice.sound.kind] ?? FAMILY_ROLE[voice.family];
  if (step === 0) return base;
  return GM_ROLE[voice.notes[step]?.[0] ?? -1] ?? base;
}

/** Every drum sound as a kit target (one sample each). */
export function downbeatTargets(project: Pick<Project, 'voices'>): KitTarget[] {
  return drumSounds(project).map((d) => {
    const role = roleOf(d.voice, d.step);
    return { id: d.key, role, label: d.label, ...(ACCEPTS[role] ? { accepts: ACCEPTS[role] } : {}) };
  });
}

/** What DOWNBEAT keeps of a drum sound in a kit (`ext.downbeat` of its instrument). */
interface SoundExt {
  voice: string;
  step: number;
  source: SoundSlot['source'];
  zone: SoundSlot['zone'];
  transform: SoundSlot['transform'];
  choke: SoundSlot['choke'];
}

/** The project's drum sounds as kit instruments (sounds with a sample only). */
export function instrumentsOf(project: Pick<Project, 'voices' | 'audio'>, base: KitData | null = null): KitInstrument[] {
  const a = audioOf(project);
  const targets = downbeatTargets(project);
  const prior = base ? mapKit(base, targets) : null;
  const out: KitInstrument[] = [];
  // which of several drum sounds of one role (SNARE 1, SNARE 2): written, so the kit says it
  const seen = new Map<string, number>();
  const index = new Map(targets.map((t) => {
    const n = seen.get(t.role) ?? 0;
    seen.set(t.role, n + 1);
    return [t.id, n];
  }));
  for (const d of drumSounds(project)) {
    const slot = a.sounds[d.voice.id]?.[d.step];
    if (!slot?.sampleId) continue;
    const ext: SoundExt = { voice: d.voice.name, step: d.step, source: slot.source, zone: slot.zone, transform: slot.transform, choke: slot.choke };
    const was = prior?.mapped.find((m) => m.target.id === d.key);
    const ins: KitInstrument = { role: roleOf(d.voice, d.step), label: d.label, samples: [{ sample: slot.sampleId, name: slot.name }] };
    if (index.get(d.key)) ins.index = index.get(d.key);
    // the same sample as the kit gave it: keep the kit's other samples and other applications' data
    if (was && pickOrder(was.instrument)[0]?.sample === slot.sampleId) {
      ins.samples = was.instrument.samples.map((s) => (s.sample === slot.sampleId ? { ...s, name: slot.name } : s));
      if (was.instrument.selection) ins.selection = was.instrument.selection;
      if (was.instrument.choke) ins.choke = was.instrument.choke;
      if (was.instrument.ext) ins.ext = { ...was.instrument.ext };
    }
    ins.ext = { ...(ins.ext ?? {}), [APP_ID]: ext };
    out.push(ins);
  }
  // instruments DOWNBEAT does not play stay in the kit
  for (const u of prior?.unmapped ?? []) if (u.reason === 'no-target') out.push(u.instrument);
  return out;
}

/** Drum sounds the kit does not cover: keep what they play, or go back to the internal sound. */
export type OtherSounds = 'keep' | 'internal';

/** The drum sound settings a kit mapping gives (only the sounds it changes). */
export function planKit(project: Pick<Project, 'voices' | 'audio'>, m: KitMapping, others: OtherSounds = 'keep'): Map<string, SoundSlot> {
  const a = audioOf(project);
  const out = new Map<string, SoundSlot>();
  for (const x of m.mapped) {
    const ref = x.samples[0];
    if (!ref) continue;
    const [voice, step] = [x.target.id.slice(0, x.target.id.lastIndexOf('#')), Number(x.target.id.slice(x.target.id.lastIndexOf('#') + 1))];
    const cur = a.sounds[voice]?.[step] ?? defaultSlot();
    const ext = (x.instrument.ext?.[APP_ID] as Partial<SoundExt> | undefined) ?? null;
    // DOWNBEAT's own settings when the kit came from DOWNBEAT, else a plain one-shot (choke kept)
    const slot = ext ? repairSlot({ ...ext, sampleId: ref.sample, name: ref.name || 'sample' }) : { ...defaultSlot(), choke: cur.choke, source: 'sample' as const, sampleId: ref.sample, name: (ref.name || 'sample').slice(0, 120) };
    out.set(x.target.id, slot);
  }
  if (others === 'internal') for (const t of m.empty) out.set(t.id, { ...(slotAt(a, t.id) ?? defaultSlot()), source: 'internal', sampleId: null, name: '' });
  return out;
}

function slotAt(a: ReturnType<typeof audioOf>, key: string): SoundSlot | null {
  const i = key.lastIndexOf('#');
  return a.sounds[key.slice(0, i)]?.[Number(key.slice(i + 1))] ?? null;
}

/** A fingerprint of the drum sounds' samples and settings (what a kit holds), for UNSAVED. */
export function soundSignature(project: Pick<Project, 'voices' | 'audio'>): string {
  const a = audioOf(project);
  return JSON.stringify(drumSounds(project).map((d) => {
    const s = a.sounds[d.voice.id]?.[d.step];
    return s?.sampleId ? [d.key, s.source, s.sampleId, s.name, s.zone, s.transform, s.choke] : [d.key];
  }));
}

/** The application's side of the session (the App supplies the edits). */
export interface DownbeatKitApp {
  project: Project;
  /** apply drum sound settings as one undoable edit (decoded and checked first) */
  applyKitSounds(sounds: Map<string, SoundSlot>, label: string): Promise<void>;
  /** the policy for drum sounds a kit does not cover */
  otherSounds: OtherSounds;
}

export class DownbeatKitHost implements KitHost {
  constructor(private app: DownbeatKitApp) {}
  targets(): KitTarget[] {
    return downbeatTargets(this.app.project);
  }
  async capture(base: KitData | null): Promise<{ instruments: KitInstrument[] }> {
    return { instruments: instrumentsOf(this.app.project, base) };
  }
  async apply(kit: KitData, mapping: KitMapping): Promise<void> {
    await this.app.applyKitSounds(planKit(this.app.project, mapping, this.app.otherSounds), kit.name);
  }
  async clear(): Promise<void> {
    // NEW KIT: every drum sound back to its internal sound (undoable)
    const all = new Map<string, SoundSlot>();
    const a = audioOf(this.app.project);
    for (const d of drumSounds(this.app.project)) {
      const s = a.sounds[d.voice.id]?.[d.step];
      if (s?.sampleId || s?.source === 'sample') all.set(d.key, { ...s, source: 'internal', sampleId: null, name: '' });
    }
    if (all.size) await this.app.applyKitSounds(all, 'a new kit');
  }
  signature(): string {
    return soundSignature(this.app.project);
  }
}

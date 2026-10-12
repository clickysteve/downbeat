/**
 * EXPORT AUDIO: renders DOWNBEAT's performance to WAV with Slop Factory Core's offline renderer
 * (the same instruments, routing, choke groups and processing as live playback; no renderer of
 * DOWNBEAT's own) and Core's WAV encoder and ZIP writer.
 *
 * What is rendered is frozen before rendering and never regenerated:
 *
 * - PATTERN: a pattern for N cycles as PLAY plays it from the start with this seed (fills,
 *   density, groove, evolution, rules, autopilot), with LOCK, SOURCE and an auditioned breed
 *   as they are set now; or exactly as WRITTEN.
 * - SONG: the song once through, performed.
 * - TAKE: the notes recorded with REC TAKE, at the times they played, so live changes (jams,
 *   mutes, NEW VARIATION, morphs, tempo, an external clock) are kept.
 *
 * Outputs:
 *
 * - MASTER: the full chain as heard: voice processing, master processing, VOLUME and the
 *   master compressor.
 * - VOICE STEMS: one per sequencer voice, with that voice's processing ("bake" on) or dry.
 *   Never master processing, VOLUME or the compressor.
 * - DRUM-SOUND STEMS: one per drum sound (voice sound step) that plays, including sounds
 *   borrowed by other voices' fills, with the sound's own processing only (its sample
 *   transformation, tuning, level and pan). Voice processing is left out: a non-linear
 *   processor (drive, crunch, the output stages) fed several sounds at once cannot be
 *   separated into one output per sound, so baking it in would not add up to the voice.
 *
 * Every file starts at sample 0, has the same length (music plus one shared tail) and rate,
 * and is neither trimmed nor normalised. With voice processing CLEAN, the voice stems and the
 * drum-sound stems each sum to the mix before master processing.
 */
import { createZip, encodeWav16, fileName, levelStats, slug, uniqueNames, type LevelStats } from '@slopfactory/core/export';
import { EXPORT_SAMPLE_RATE, renderTimeline, type RenderResult } from '@slopfactory/core/render';
import type { Timeline } from '@slopfactory/core/events';
import { AUDITION_ID, renderCycles, type NoteItem } from '../engine/engine';
import type { Pattern, Project } from '../engine/types';
import type { SampleLibrary } from './library';
import { FX_SEED, makeChoke, makeResolver, masterCompressor, MAX_PER_VOICE, voiceStrips } from './routing';
import { audioOf } from './settings';
import { freezeItems, freezeTake, performanceTimeline, soundsUsed, type FrozenPerformance } from './timeline';

export type ExportRange = { kind: 'pattern'; patternId: string; cycles: number; written: boolean } | { kind: 'song' } | { kind: 'take' };
export type ExportOutputs = 'master' | 'stems' | 'both';
export type StemGrouping = 'voices' | 'sounds' | 'both';

export interface AudioExportOptions {
  range: ExportRange;
  outputs: ExportOutputs;
  stems: StemGrouping;
  /** voice stems carry their voice's processing (master processing never reaches stems) */
  bake: boolean;
  /** a stem for every voice / drum sound, not only those that play */
  all: boolean;
  tailSeconds: number;
}

export const defaultExportOptions = (patternId: string): AudioExportOptions => ({ range: { kind: 'pattern', patternId, cycles: 4, written: false }, outputs: 'master', stems: 'voices', bake: true, all: false, tailSeconds: 2 });

/** The engine state PLAY would use besides the project (see Engine). */
export interface EngineState {
  lockKey: number | null;
  sourceOnly: boolean;
  audition: Pattern | null;
}

export interface TakeData {
  notes: NoteItem[];
  ms: number[];
  startTick: number;
  tempo: number;
}

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
  kind: 'master' | 'voice' | 'sound';
  /** voice id or sound key */
  id?: string;
  stats: LevelStats;
}

export interface ExportPlan {
  perf: FrozenPerformance;
  /** routed by sequencer voice (master and voice stems) */
  voiceTimeline: Timeline;
  /** routed by drum sound (drum-sound stems) */
  soundTimeline: Timeline;
  master: boolean;
  voiceStems: string[];
  soundStems: string[];
  /** file names: master first, then voice stems, then drum-sound stems */
  names: string[];
  prefix: string;
  label: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function rangeTag(project: Project, r: ExportRange, audition: Pattern | null): string {
  if (r.kind === 'song') return 'song';
  if (r.kind === 'take') return 'take';
  const p = r.patternId === AUDITION_ID ? audition : project.patterns.find((x) => x.id === r.patternId);
  return `${slug(p?.name ?? 'pattern', 16)}${r.written ? '-written' : ''}${r.cycles > 1 ? `-x${r.cycles}` : ''}`;
}

/** Freeze the performance to render (pure: the project is not changed). */
export function freezeRange(project: Project, r: ExportRange, state: EngineState, take: TakeData | null): FrozenPerformance {
  if (r.kind === 'take') {
    if (!take || !take.notes.length) throw new Error('No take recorded yet: press REC TAKE while playing, then export the take.');
    return freezeTake(take.notes, take.ms, take.startTick, take.tempo);
  }
  const copy = structuredClone(project) as Project;
  let cycles: number;
  if (r.kind === 'song') {
    if (!copy.song.entries.length) throw new Error('The song is empty: add patterns to the song first.');
    copy.playMode = 'song';
    copy.song.loop = false;
    cycles = copy.song.entries.reduce((a, e) => a + e.repeats, 0) || 1;
  } else {
    copy.playMode = 'pattern';
    if (r.patternId === AUDITION_ID && !state.audition) throw new Error('No breeding result is being auditioned.');
    if (r.patternId !== AUDITION_ID && !copy.patterns.some((p) => p.id === r.patternId)) throw new Error('That pattern no longer exists.');
    copy.current = r.patternId === AUDITION_ID ? copy.current : r.patternId;
    cycles = Math.max(1, Math.min(64, Math.round(r.cycles)));
  }
  const audition = r.kind === 'pattern' && r.patternId === AUDITION_ID ? state.audition : null;
  const res = renderCycles(copy, cycles, { sourceOnly: (r.kind === 'pattern' && r.written) || state.sourceOnly, lockKey: state.lockKey, audition });
  return freezeItems(res.notes, res.tempos, res.endTick, copy.tempo);
}

/** Everything about an export that can be decided without rendering (pure, testable). */
export function planExport(project: Project, opts: AudioExportOptions, state: EngineState, take: TakeData | null): ExportPlan {
  const perf = freezeRange(project, opts.range, state, take);
  const voiceTimeline = performanceTimeline(project, perf, 'voice');
  const soundTimeline = performanceTimeline(project, perf, 'sound');
  const master = opts.outputs !== 'stems';
  const wantStems = opts.outputs !== 'master';
  const playing = new Set(voiceTimeline.events.map((e) => e.voice));
  const voiceStems = wantStems && opts.stems !== 'sounds' ? project.voices.map((v) => v.id).filter((id) => opts.all || playing.has(id)) : [];
  const soundStems = wantStems && opts.stems !== 'voices' ? (opts.all ? soundTimeline.voices.map((v) => v.id) : soundsUsed(project, soundTimeline)) : [];
  if (!master && !voiceStems.length && !soundStems.length) throw new Error('Nothing plays in that range, so there are no stems to export.');
  const nameSlug = slug(project.name, 24);
  const prefix = ['downbeat', nameSlug === 'untitled' ? '' : nameSlug, rangeTag(project, opts.range, state.audition)].filter(Boolean).join('_');
  const vIndex = new Map(project.voices.map((v, i) => [v.id, i] as const));
  const voiceName = (id: string) => `voice-${pad2((vIndex.get(id) ?? 0) + 1)}-${slug(project.voices.find((v) => v.id === id)?.name ?? id, 16)}`;
  const soundName = (id: string) => `sound-${slug(soundTimeline.voices.find((v) => v.id === id)?.name ?? id, 20)}`;
  const names = uniqueNames([...(master ? [fileName([prefix, 'master'], 'wav')] : []), ...voiceStems.map((id) => fileName([prefix, voiceName(id)], 'wav')), ...soundStems.map((id) => fileName([prefix, soundName(id)], 'wav'))]);
  const label = opts.range.kind === 'take' ? 'the recorded take' : opts.range.kind === 'song' ? 'the song' : rangeTag(project, opts.range, state.audition);
  return { perf, voiceTimeline, soundTimeline, master, voiceStems, soundStems, names, prefix, label };
}

export interface ExportResult {
  files: ExportFile[];
  /** the single download: a WAV, or a ZIP of several */
  download: { name: string; bytes: Uint8Array; type: string };
  renders: RenderResult[];
  plan: ExportPlan;
}

export interface ExportEnv {
  workletUrl: string | null;
  /** VOLUME: part of the master as heard */
  volume: number;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

export async function exportAudio(project: Project, library: SampleLibrary, opts: AudioExportOptions, state: EngineState, take: TakeData | null, env: ExportEnv): Promise<ExportResult> {
  // a snapshot: editing the project during the render changes nothing
  const snapshot = structuredClone(project) as Project;
  const plan = planExport(snapshot, opts, state, take);
  env.onProgress?.(0, 'Preparing samples');
  library.sync(audioOf(snapshot));
  await library.ready();
  const getProject = () => snapshot;
  const common = {
    sampleRate: EXPORT_SAMPLE_RATE,
    tailSeconds: Math.max(0, Math.min(30, opts.tailSeconds)),
    fxSeed: FX_SEED,
    resolve: makeResolver(getProject, library),
    choke: makeChoke(getProject),
    maxPerVoice: MAX_PER_VOICE,
    fxModuleUrl: env.workletUrl ?? undefined,
    signal: env.signal,
  };
  const renders: RenderResult[] = [];
  const passes = (plan.master || plan.voiceStems.length ? 1 : 0) + (plan.soundStems.length ? 1 : 0);
  let done = 0;
  const progress = (f: number) => env.onProgress?.(((done + f) / passes) * 0.9, 'Rendering');
  if (plan.master || plan.voiceStems.length) {
    renders.push(
      await renderTimeline({
        ...common,
        timeline: plan.voiceTimeline,
        master: plan.master,
        stems: plan.voiceStems.map((voice) => ({ voice, processed: opts.bake })),
        strips: voiceStrips(snapshot),
        masterFx: audioOf(snapshot).master,
        masterGain: env.volume,
        masterInsert: masterCompressor,
        onProgress: progress,
      }),
    );
    done++;
  }
  if (plan.soundStems.length) {
    renders.push(await renderTimeline({ ...common, timeline: plan.soundTimeline, master: false, stems: plan.soundStems.map((voice) => ({ voice, processed: true })), onProgress: progress }));
    done++;
  }
  if (renders.length === 2 && renders[0]!.frames !== renders[1]!.frames) throw new Error('Internal error: the stems were rendered with different lengths.');
  env.onProgress?.(0.9, 'Writing WAV files');
  const outputs = renders.flatMap((r, ri) => r.outputs.map((o) => ({ o, rate: r.sampleRate, kind: (o.kind === 'master' ? 'master' : ri === 0 && (plan.master || plan.voiceStems.length) ? 'voice' : 'sound') as ExportFile['kind'] })));
  const files: ExportFile[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const { o, rate, kind } = outputs[i]!;
    files.push({ name: plan.names[i]!, bytes: await encodeWav16(o.channels, rate), kind, id: o.voice, stats: levelStats(o.channels) });
  }
  const download = files.length === 1 ? { name: files[0]!.name, bytes: files[0]!.bytes, type: 'audio/wav' } : { name: `${plan.prefix}.zip`, bytes: createZip(files.map((f) => ({ name: f.name, data: f.bytes }))), type: 'application/zip' };
  env.onProgress?.(1, 'Done');
  return { files, download, renders, plan };
}

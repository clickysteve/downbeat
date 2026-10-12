/**
 * DOWNBEAT -> Slop Factory Core events.
 *
 * The engine's performance (`NoteItem`s from `renderCycles`, or a recorded take) becomes a
 * Core `Timeline`. Nothing is regenerated: the items are already the frozen performance.
 *
 * - **Timing.** Engine ticks are 24 per quarter and fractional (fine units, swing, groove,
 *   humanise, shifts and flams all land between ticks). Core ticks are integers, so DOWNBEAT
 *   uses 96 000 per quarter (4 000 per engine tick): a position is rounded by at most
 *   1/192 000 of a quarter note (about 3 microseconds at 120 BPM, a tenth of a sample).
 * - **Tempo.** The performance starts at the project tempo and changes where the engine emits
 *   a pattern tempo, as the scheduler does.
 * - **Voice and sound.** Each note keeps its sequencer voice (the track it belongs to) and
 *   names its drum sound in `instrument` (`<sound voice id>#<sound step>`). Chords become one
 *   event per pitch with the same drum sound.
 * - **Grouping.** `group: 'voice'` routes every note to its sequencer voice (voice stems, the
 *   master mix); `group: 'sound'` routes it to its drum sound (drum-sound stems). The events
 *   are identical apart from that routing key.
 */
import { sortEvents, type NoteEvent, type TempoMap, type Timeline, type VoiceInfo } from '@slopfactory/core/events';
import type { NoteItem, TempoItem } from '../engine/engine';
import { PPQ, type Project } from '../engine/types';
import { drumSounds, parseSoundKey, soundKey } from './settings';

export const CORE_PPQ = 96000;
export const TICK_SCALE = CORE_PPQ / PPQ;

/** A performance frozen for rendering: notes at Core ticks, with the tempo map. */
export interface FrozenPerformance {
  notes: { tick: number; duration: number; item: NoteItem }[];
  tempo: TempoMap;
  /** Core ticks: the end of the last cycle (or of the take) */
  length: number;
}

/** The engine's notes (engine ticks) at the given starting tempo. */
export function freezeItems(notes: NoteItem[], tempos: TempoItem[], endTick: number, startBpm: number): FrozenPerformance {
  const changes = [{ tick: 0, bpm: startBpm }];
  for (const t of tempos) {
    const tick = Math.round(t.tick * TICK_SCALE);
    const last = changes[changes.length - 1]!;
    if (last.tick === tick) last.bpm = t.bpm;
    else if (last.bpm !== t.bpm) changes.push({ tick, bpm: t.bpm });
  }
  return {
    notes: notes.map((item) => ({ tick: Math.round(item.tick * TICK_SCALE), duration: Math.max(1, Math.round(item.duration * TICK_SCALE)), item })),
    tempo: { ppq: CORE_PPQ, changes },
    length: Math.max(1, Math.round(endTick * TICK_SCALE)),
  };
}

/**
 * A recorded take, placed by the times its notes actually played (performance.now()
 * milliseconds), so tempo changes and an external clock are reproduced as they happened.
 * Represented at 60 BPM, where a quarter note is one second.
 */
export function freezeTake(notes: NoteItem[], ms: number[], startTick: number, bpm: number): FrozenPerformance {
  const msPerTick = 60000 / bpm / PPQ;
  const first = notes.findIndex((_, i) => ms[i] !== undefined);
  const ms0 = first >= 0 ? ms[first]! - (notes[first]!.tick - startTick) * msPerTick : 0;
  const placed = notes.map((item, i) => ({
    tick: Math.max(0, Math.round((((ms[i] ?? ms0 + (item.tick - startTick) * msPerTick) - ms0) / 1000) * CORE_PPQ)),
    duration: Math.max(1, Math.round(((item.duration * msPerTick) / 1000) * CORE_PPQ)),
    item,
  }));
  const end = placed.reduce((m, n) => Math.max(m, n.tick + n.duration), 1);
  return { notes: placed, tempo: { ppq: CORE_PPQ, changes: [{ tick: 0, bpm: 60 }] }, length: end };
}

export type Grouping = 'voice' | 'sound';

/** Voice ids of a sound-grouped timeline are sound keys; their names read like "CL HAT 2". */
export function performanceTimeline(project: Project, perf: FrozenPerformance, group: Grouping): Timeline {
  const events: NoteEvent[] = [];
  for (const n of perf.notes) {
    const it = n.item;
    const sound = soundKey(it.sound, it.note);
    for (const pitch of it.pitches) {
      events.push({ type: 'note', tick: n.tick, duration: n.duration, voice: group === 'voice' ? it.voice : sound, pitch, velocity: Math.max(1, Math.min(127, Math.round(it.velocity))), channel: it.channel, instrument: sound });
    }
  }
  let voices: VoiceInfo[];
  if (group === 'voice') voices = project.voices.map((v) => ({ id: v.id, name: v.name }));
  else {
    const all = drumSounds(project);
    const used = new Set(events.map((e) => e.voice));
    // every drum sound of the project, plus any a take recorded that no longer exists
    voices = all.map((d) => ({ id: d.key, name: d.label }));
    for (const k of used) if (!all.some((d) => d.key === k)) voices.push({ id: k, name: `${parseSoundKey(k)?.voice ?? k} ${(parseSoundKey(k)?.step ?? 0) + 1}` });
  }
  const length = events.reduce((m, e) => Math.max(m, e.tick + 1), perf.length);
  return { tempo: perf.tempo, length, voices, events: sortEvents(events), meta: { app: 'DOWNBEAT', group } };
}

/** The drum sounds a timeline actually plays (sound keys), in project order. */
export function soundsUsed(project: Project, t: Timeline): string[] {
  const used = new Set(t.events.map((e) => (e.type === 'note' ? e.instrument ?? '' : '')));
  const known = drumSounds(project).map((d) => d.key);
  return [...known.filter((k) => used.has(k)), ...[...used].filter((k) => k && !known.includes(k))];
}

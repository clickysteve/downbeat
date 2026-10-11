import { makePattern, makeVoice, defaultExt } from '../../src/engine/defaults';
import type { Engine, NoteItem } from '../../src/engine/engine';
import type { CyclePlan } from '../../src/engine/plan';
import type { Pattern, Project, Strike, Voice } from '../../src/engine/types';

/** A small project: KICK, SNARE, HAT, TOM with fixed ids, one empty 16-step pattern. */
export function smallProject(): Project {
  const voices: Voice[] = [
    makeVoice({ name: 'KICK', family: 'kick', notes: [[36]], sound: 'kick' }, 'k'),
    makeVoice({ name: 'SNARE', family: 'snare', notes: [[38], [40]], sound: 'snare' }, 's'),
    makeVoice({ name: 'HAT', family: 'hat', notes: [[42], [44], [46]], sound: 'hat' }, 'h'),
    makeVoice({ name: 'TOM', family: 'tom', notes: [[45]], sound: 'tomlo' }, 't'),
  ];
  const p = makePattern(voices, 'A');
  p.id = 'A';
  return {
    name: 'TEST',
    tempo: 120,
    seed: 12345,
    algorithms: { classic: 1, extended: 1 },
    voices,
    patterns: [p],
    song: { entries: [{ patternId: 'A', repeats: 2 }], loop: true },
    playMode: 'pattern',
    current: 'A',
    ext: defaultExt(),
    notes: '',
  };
}

export function put(p: Pattern, voice: string, steps: number[], v = 3, extra: Partial<Strike> = {}): void {
  for (const s of steps) p.tracks[voice]!.strikes[s] = { v, s: 1, ...extra };
}

export const notesOf = (items: { type: string }[]): NoteItem[] => items.filter((i): i is NoteItem => i.type === 'note');

/** A compact signature of note events for equality checks. */
export const sig = (ns: NoteItem[]): string[] => ns.map((n) => `${n.tick.toFixed(4)}:${n.voice}:${n.sound}:${n.pitches.join('+')}:${n.velocity}:${n.kind}`);

/** Generate `cycles` cycles of 96 ticks, keeping every plan (the engine prunes its own history). */
export function history(e: Engine, cycles: number, cycleTicks = 96): CyclePlan[] {
  const out = new Map<number, CyclePlan>();
  for (let c = 1; c <= cycles; c++) {
    e.generate(c * cycleTicks);
    for (const p of e.plans) out.set(p.index, p);
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}

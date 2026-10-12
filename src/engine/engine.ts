/**
 * The DOWNBEAT engine: plans cycles and emits note events.
 *
 * Two layers:
 *
 *  - The **planner** decides, cycle by cycle and in order, the structural
 *    facts of each repetition: which pattern plays (cue, song, morph), each
 *    track's loop positions (polymeter), the evolved / mutated / morphed
 *    variant, and the temporary modifications from rules and the autopilot.
 *    A cycle is planned only shortly before it starts (one quarter note of
 *    margin), so pattern changes and rules take effect at the next cycle.
 *
 *  - The **realisation** (realize.ts) turns a plan into events with the
 *    *current* settings. It is pure and cached per settings version, so a
 *    density or fill change is heard within one lookahead window, and the
 *    display always shows what the cycle will actually play.
 *
 * Mute, solo and Jam are applied at emission time, so they act within one
 * lookahead window. Every random decision is a keyed hash of the seed, so the
 * same project, seed and interventions produce the same events.
 */
import { autoEffect, type AutoEffect } from '../extended/auto';
import { distance, mutate, summariseOps, type TrackStrikes } from '../extended/mutate';
import { morphTracks } from '../extended/morph';
import { ACTION_LABEL, evaluateRules, type Fired } from '../extended/rules';
import { SALT, Rng, hash32, rand, strCode, weighted } from './rng';
import { endTick, noMods, type CyclePlan, type Label, type Variant, type VariantTrack, type VoiceMods } from './plan';
import { flagsOf, realize, velocityFor, type EventKind, type PerfEvent, type Realization } from './realize';
import { clamp, geometry, type Pattern, type Project, type Strike } from './types';

/** Plan this many ticks ahead of the horizon (covers early-shifted notes). */
export const PLAN_MARGIN = 24;

export interface NoteItem {
  type: 'note';
  tick: number;
  /** Note length in ticks. */
  duration: number;
  channel: number;
  pitches: number[];
  velocity: number;
  /** Track voice. */
  voice: string;
  /** Voice whose sound plays (fills may borrow another voice's sound). */
  sound: string;
  /** Sound step of that voice (index into its step list) whose note or chord `pitches` holds. */
  note: number;
  kind: EventKind;
  level: number;
  cycle: number;
  step: number;
}

export interface TempoItem {
  type: 'tempo';
  tick: number;
  bpm: number;
}

export interface EndItem {
  type: 'end';
  tick: number;
}

export type EngineItem = NoteItem | TempoItem | EndItem;

export type JamMode = 'roll' | 'echo';

interface TimedMod {
  from: number;
  until: number;
  voices: string[];
  apply: (m: VoiceMods) => void;
  label: string;
}

interface TimedMutation {
  from: number;
  until: number;
  voices: string[];
  strength: number;
  seed: number;
}

interface MorphRun {
  from: string;
  to: string;
  cycles: number;
  done: number;
}

export const AUDITION_ID = '__audition__';

export class Engine {
  /** Bumped by the app whenever anything that affects playback changes. */
  version = 0;
  /** Everything before this tick has been emitted. */
  horizon = 0;
  plans: CyclePlan[] = [];
  /** Play the plain written pattern (A/B against the performance). */
  sourceOnly = false;
  /** Lock the performance: every cycle reuses this cycle's random decisions. */
  lockKey: number | null = null;
  /** A pattern being auditioned (breeding result); plays instead of the current pattern. */
  audition: Pattern | null = null;
  /** Never plan further (offline rendering of a fixed number of cycles). */
  frozen = false;
  /** Always play this pattern (display previews). */
  private forcePattern: string | null = null;

  private jam = new Map<string, JamMode>();
  private realCache = new Map<number, { version: number; real: Realization }>();
  private emitted = new Map<number, Set<string>>();
  private runPattern: string | null = null;
  private runRep = 0;
  private reps = new Map<string, number>();
  private genBase = new Map<string, number>();
  private lastGen = new Map<string, number>();
  private trackPos = new Map<string, number>();
  private resyncPending = false;
  private songIdx = 0;
  private songRep = -1;
  private morph: MorphRun | null = null;
  private timedMods: TimedMod[] = [];
  private timedMutations: TimedMutation[] = [];
  private variantCache = new Map<string, { version: number; gens: Map<number, TrackStrikes> }>();
  private ended = false;
  private nextCue: string | null = null;

  constructor(public project: Project) {}

  // ------------------------------------------------------------------ control

  /** Back to the starting state (Start and Stop). */
  reset(): void {
    this.horizon = 0;
    this.plans = [];
    this.realCache.clear();
    this.emitted.clear();
    this.runPattern = null;
    this.runRep = 0;
    this.reps.clear();
    this.genBase.clear();
    this.lastGen.clear();
    this.trackPos.clear();
    this.resyncPending = false;
    this.songIdx = 0;
    this.songRep = -1;
    this.morph = null;
    this.timedMods = [];
    this.timedMutations = [];
    this.ended = false;
    this.nextCue = null;
  }

  /** Something changed that affects the performance. */
  touch(): void {
    this.version++;
  }

  /** Start / stop jamming on a voice. */
  setJam(voice: string, mode: JamMode | null): void {
    if (mode) this.jam.set(voice, mode);
    else this.jam.delete(voice);
  }

  jamming(voice: string): JamMode | null {
    return this.jam.get(voice) ?? null;
  }

  /** Realign every track's loop position at the next cycle. */
  resync(): void {
    this.resyncPending = true;
  }

  /** Return a pattern's evolution to the source (generation 0) from the next cycle. */
  resetEvolution(patternId: string): void {
    this.genBase.set(patternId, this.reps.get(patternId) ?? 0);
    this.variantCache.delete(patternId);
  }

  /** Morph from the playing pattern to another over `cycles` cycles. */
  startMorph(to: string, cycles: number): void {
    const from = this.runPattern ?? this.project.current;
    if (from === to) return;
    this.morph = { from, to, cycles: Math.max(1, Math.floor(cycles)), done: 0 };
  }

  cancelMorph(): void {
    this.morph = null;
  }

  morphState(): MorphRun | null {
    return this.morph ? { ...this.morph } : null;
  }

  /** The pattern the engine is running (or will start with). */
  playingPatternId(): string {
    return this.runPattern ?? this.project.current;
  }

  getPattern(id: string): Pattern | undefined {
    if (this.audition && id === this.audition.id) return this.audition;
    return this.project.patterns.find((p) => p.id === id);
  }

  /** Move to `tick` as if the performance had run there (Song Position). */
  seek(tick: number): void {
    this.reset();
    let guard = 0;
    while (!this.ended && guard++ < 100000) {
      const last = this.plans[this.plans.length - 1];
      if (last && endTick(last) > tick) break;
      this.planNext();
    }
    this.horizon = Math.max(0, tick);
  }

  // ------------------------------------------------------------------ queries

  /** The plan containing `tick`, if planned. */
  cycleAt(tick: number): CyclePlan | null {
    for (let i = this.plans.length - 1; i >= 0; i--) {
      const p = this.plans[i]!;
      if (tick >= p.startTick && tick < endTick(p)) return p;
    }
    return null;
  }

  realization(plan: CyclePlan): Realization {
    const hit = this.realCache.get(plan.index);
    if (hit && hit.version === this.version && hit.real.plan === plan) return hit.real;
    const pattern = this.getPattern(plan.patternId);
    const real = pattern
      ? realize(this.project, pattern, plan, flagsOf(this.project))
      : { plan, events: [], cells: {}, stats: {} };
    this.realCache.set(plan.index, { version: this.version, real });
    return real;
  }

  /**
   * A plan for display while stopped: the current pattern's first cycle as it
   * would play now (no history). Does not affect the engine state.
   */
  previewPlan(patternId = this.project.current): CyclePlan | null {
    const shadow = new Engine(this.project);
    shadow.audition = this.audition;
    shadow.sourceOnly = this.sourceOnly;
    shadow.lockKey = this.lockKey;
    shadow.version = this.version;
    if (!shadow.getPattern(patternId)) return null;
    shadow.forcePattern = patternId;
    return shadow.planNext();
  }

  // ------------------------------------------------------------------ generation

  /** Emit everything in [horizon, until). */
  generate(until: number): EngineItem[] {
    if (until <= this.horizon) return [];
    let guard = 0;
    while (!this.ended && !this.frozen && guard++ < 1000) {
      const last = this.plans[this.plans.length - 1];
      if (last && endTick(last) >= until + PLAN_MARGIN) break;
      this.planNext();
    }
    const items: EngineItem[] = [];
    const h0 = this.horizon;
    const anySolo = this.project.voices.some((v) => v.solo);
    const voiceById = new Map(this.project.voices.map((v) => [v.id, v] as const));
    for (const plan of this.plans) {
      const end = endTick(plan);
      if (plan.startTick >= until + PLAN_MARGIN || end + PLAN_MARGIN <= h0) continue;
      let sent = this.emitted.get(plan.index);
      if (!sent) {
        sent = new Set();
        this.emitted.set(plan.index, sent);
      }
      if (plan.tempo !== null && plan.startTick >= h0 && plan.startTick < until && !sent.has('tempo')) {
        sent.add('tempo');
        items.push({ type: 'tempo', tick: plan.startTick, bpm: plan.tempo });
      }
      const real = this.realization(plan);
      const audible = (voiceId: string): boolean => {
        const v = voiceById.get(voiceId);
        if (!v) return false;
        const m = plan.mods[voiceId];
        if (anySolo) return v.solo;
        if (m && m.mute !== null) return !m.mute;
        return !v.mute;
      };
      for (const ev of real.events) {
        if (ev.tick < h0 - 1e-9 || ev.tick >= until || sent.has(ev.key)) continue;
        sent.add(ev.key);
        if (!audible(ev.voice)) continue;
        const item = this.noteItem(ev, plan);
        if (item) items.push(item);
      }
      this.jamEvents(plan, real, h0, until, sent, items, audible);
      if (plan.endsSong && end >= h0 && end < until && !sent.has('end')) {
        sent.add('end');
        items.push({ type: 'end', tick: end });
      }
    }
    this.horizon = until;
    this.prune();
    items.sort((a, b) => a.tick - b.tick || order(a) - order(b));
    return mergeSimultaneous(items);
  }

  private noteItem(ev: PerfEvent, plan: CyclePlan): NoteItem | null {
    const sound = this.project.voices.find((v) => v.id === ev.sound);
    if (!sound) return null;
    const note = sound.notes[ev.note] ? ev.note : 0;
    const pitches = sound.notes[note] ?? [];
    if (!pitches.length) return null;
    return {
      type: 'note',
      tick: ev.tick,
      duration: Math.max(0.5, sound.gate),
      channel: sound.channel,
      pitches,
      velocity: ev.velocity,
      voice: ev.voice,
      sound: ev.sound,
      note,
      kind: ev.kind,
      level: ev.level,
      cycle: plan.index,
      step: ev.step,
    };
  }

  /** Jam: ROLL plays a continuous roll; ECHO superimposes the fill-sound voice's rhythm. */
  private jamEvents(
    plan: CyclePlan,
    real: Realization,
    h0: number,
    until: number,
    sent: Set<string>,
    items: EngineItem[],
    audible: (v: string) => boolean,
  ): void {
    if (!this.jam.size) return;
    const pattern = this.getPattern(plan.patternId);
    if (!pattern) return;
    const { steps, stepTicks } = plan.geo;
    for (const [voiceId, mode] of this.jam) {
      const track = pattern.tracks[voiceId];
      if (!track || !audible(voiceId)) continue;
      if (mode === 'roll') {
        const rate = Math.max(1, Math.round(track.fill.rate));
        const vc = strCode(voiceId);
        for (let k = 0; k < steps * rate; k++) {
          const x = k / rate;
          const tick = plan.startTick + x * stepTicks;
          if (tick < h0 || tick >= until) continue;
          const key = `jam|${voiceId}|${x}`;
          if (sent.has(key)) continue;
          sent.add(key);
          const level = 1 + weighted(track.fill.weights, rand(this.project.seed, SALT.jam, vc, plan.key, x));
          const ev: PerfEvent = {
            key,
            tick,
            voice: voiceId,
            sound: voiceId,
            velocity: velocityFor(track, level, rand(this.project.seed, SALT.jam, vc, plan.key, x, 1)),
            level,
            note: 0,
            kind: 'jam',
            step: Math.floor(x),
            x,
          };
          const item = this.noteItem(ev, plan);
          if (item) items.push(item);
        }
      } else {
        const src = track.fill.sound;
        if (!src || src === voiceId) continue;
        for (const ev of real.events) {
          if (ev.voice !== src || ev.kind !== 'source') continue;
          if (ev.tick < h0 || ev.tick >= until) continue;
          const key = `echo|${voiceId}|${ev.x}`;
          if (sent.has(key)) continue;
          sent.add(key);
          const item = this.noteItem({ ...ev, key, voice: voiceId, sound: voiceId, note: 0, kind: 'echo' }, plan);
          if (item) items.push(item);
        }
      }
    }
  }

  private prune(): void {
    while (this.plans.length > 6 && endTick(this.plans[0]!) + PLAN_MARGIN * 4 < this.horizon) {
      const p = this.plans.shift()!;
      this.emitted.delete(p.index);
      this.realCache.delete(p.index);
    }
    this.timedMods = this.timedMods.filter((m) => m.until > (this.plans[0]?.index ?? 0));
    this.timedMutations = this.timedMutations.filter((m) => m.until > (this.plans[0]?.index ?? 0));
  }

  // ------------------------------------------------------------------ planning

  /** Which pattern plays next, from the song or the current selection. */
  private choosePattern(n: number): { id: string; song: CyclePlan['song']; endsSong: boolean; label: Label | null } | null {
    const pr = this.project;
    if (this.forcePattern) return { id: this.forcePattern, song: null, endsSong: false, label: null };
    if (this.audition) return { id: this.audition.id, song: null, endsSong: false, label: n === 0 || this.runPattern !== this.audition.id ? { kind: 'pattern', text: 'AUDITION' } : null };
    if (this.morph) return { id: this.morph.from, song: null, endsSong: false, label: null };
    if (pr.playMode === 'song') {
      const entries = pr.song.entries.filter((e) => pr.patterns.some((p) => p.id === e.patternId) && e.repeats > 0);
      if (entries.length) {
        if (this.nextCue === '__next__') {
          this.nextCue = null;
          this.songRep = Number.MAX_SAFE_INTEGER;
        }
        this.songRep++;
        let label: Label | null = null;
        if (this.songIdx >= entries.length) this.songIdx = 0;
        if (this.songRep >= entries[this.songIdx]!.repeats) {
          this.songRep = 0;
          this.songIdx = n === 0 ? 0 : this.songIdx + 1;
          if (this.songIdx >= entries.length) this.songIdx = 0;
          label = { kind: 'song', text: `SONG ${this.songIdx + 1}/${entries.length}` };
        }
        if (n === 0) label = { kind: 'song', text: `SONG 1/${entries.length}` };
        const e = entries[this.songIdx]!;
        const last = !pr.song.loop && this.songIdx === entries.length - 1 && this.songRep === e.repeats - 1;
        return { id: e.patternId, song: { entry: this.songIdx, repeat: this.songRep, of: e.repeats }, endsSong: last, label };
      }
    }
    if (this.nextCue && this.nextCue !== '__next__') {
      const id = this.nextCue;
      this.nextCue = null;
      if (pr.patterns.some((p) => p.id === id)) pr.current = id;
    } else if (this.nextCue === '__next__') {
      this.nextCue = null;
      const i = pr.patterns.findIndex((p) => p.id === pr.current);
      const nxt = pr.patterns[(i + 1) % pr.patterns.length];
      if (nxt) pr.current = nxt.id;
    }
    const id = pr.patterns.some((p) => p.id === pr.current) ? pr.current : pr.patterns[0]?.id;
    if (!id) return null;
    return { id, song: null, endsSong: false, label: null };
  }

  /** Plan the next cycle. */
  planNext(): CyclePlan | null {
    const pr = this.project;
    const last = this.plans[this.plans.length - 1];
    const n = last ? last.index + 1 : 0;
    const startTick = last ? endTick(last) : 0;
    const choice = this.choosePattern(n);
    if (!choice) {
      this.ended = true;
      return null;
    }
    const pattern = this.getPattern(choice.id)!;
    const geo = geometry(pattern);
    const labels: Label[] = [];
    const changed = this.runPattern !== pattern.id;
    if (changed) {
      if (!choice.label && pattern.id !== AUDITION_ID) labels.push({ kind: 'pattern', text: `PATTERN ${pattern.name}` });
      this.runRep = 0;
    } else this.runRep++;
    if (choice.label) labels.push(choice.label);
    const prevPattern = last ? this.getPattern(last.patternId) : undefined;
    this.runPattern = pattern.id;
    const totalReps = (this.reps.get(pattern.id) ?? 0) + 1;
    this.reps.set(pattern.id, totalReps);

    // Tempo: a pattern's own tempo applies at its start; leaving it restores the project tempo.
    let tempo: number | null = null;
    if (pattern.tempo !== null && (changed || n === 0)) tempo = pattern.tempo;
    else if (pattern.tempo === null && changed && prevPattern && prevPattern.tempo !== null) tempo = pr.tempo;

    // Loop positions (polymeter).
    const pos: Record<string, number[]> = {};
    const resync = this.resyncPending;
    this.resyncPending = false;
    if (resync) labels.push({ kind: 'loop', text: 'RESYNC' });
    for (const v of pr.voices) {
      const track = pattern.tracks[v.id];
      const arr: number[] = new Array<number>(geo.steps).fill(0);
      pos[v.id] = arr;
      if (!track) continue;
      const L = clamp(Math.floor(track.loop), 1, geo.steps);
      let p = this.trackPos.get(v.id) ?? 0;
      if (n === 0 || resync || (changed && track.phase === 'pattern')) p = 0;
      if (p >= geo.steps) p = p % geo.steps;
      const vc = strCode(v.id);
      for (let i = 0; i < geo.steps; i++) {
        arr[i] = p;
        let next = p + 1;
        if (next === L && L < geo.steps) {
          if (track.loopPct >= 100 || rand(pr.seed, SALT.loop, vc, n, i) < track.loopPct / 100) next = 0;
        }
        if (next >= geo.steps) next = 0;
        p = next;
      }
      this.trackPos.set(v.id, p);
    }

    const ext = pr.ext.enabled;
    const sourceTracks: TrackStrikes = {};
    for (const v of pr.voices) sourceTracks[v.id] = pattern.tracks[v.id]?.strikes ?? [];
    const lengths: Record<string, number> = {};
    for (const v of pr.voices) lengths[v.id] = clamp(Math.floor(pattern.tracks[v.id]?.loop ?? geo.steps), 1, geo.steps);

    // Evolution.
    let tracks: TrackStrikes | null = null;
    let generation = 0;
    let genChanged = false;
    const ev = pattern.evolve;
    if (ext && pr.ext.features.evolve && ev.on && !this.sourceOnly) {
      if (ev.locked) {
        tracks = ev.locked.tracks;
        generation = ev.locked.generation;
        if (changed || n === 0) labels.push({ kind: 'lock', text: `LOCKED GEN ${generation}` });
      } else {
        const base = this.genBase.get(pattern.id) ?? 0;
        const abs = Math.max(0, Math.floor((totalReps - 1 - base) / Math.max(1, ev.every)));
        generation = ev.returnEvery > 0 ? abs % ev.returnEvery : abs;
        const blockStart = abs - generation;
        tracks = generation === 0 ? null : this.evolved(pattern, sourceTracks, lengths, blockStart, generation);
        const prevGen = this.lastGen.get(pattern.id);
        genChanged = prevGen !== undefined && prevGen !== generation;
        this.lastGen.set(pattern.id, generation);
        if (genChanged || (generation > 0 && changed)) {
          labels.push({
            kind: 'evolve',
            text: generation === 0 ? 'RETURN TO SOURCE' : `GEN ${generation} (${ev.mode === 'original' ? 'FROM ORIGINAL' : 'EVOLVING'})`,
          });
        }
      }
    }

    // Rules.
    const mods: Record<string, VoiceMods> = {};
    for (const v of pr.voices) mods[v.id] = noMods();
    let sourceOnly = this.sourceOnly;
    if (ext && pr.ext.features.rules && pr.ext.rules.length && !this.sourceOnly) {
      const prevStats = last ? this.realization(last).stats : null;
      const fired = evaluateRules(
        pr.ext.rules,
        { cycle: n, rep: this.runRep, patternStart: changed, generation, generationChanged: genChanged, prev: prevStats, seed: pr.seed },
        pr.voices,
      );
      for (const f of fired) {
        if (this.applyRule(f, n, pattern.id)) sourceOnly = sourceOnly || f.action === 'source';
        const names = f.voices.length === pr.voices.length ? 'ALL' : f.voices.map((id) => pr.voices.find((v) => v.id === id)?.name ?? '?').join(', ');
        labels.push({ kind: 'rule', text: `RULE ${pr.ext.rules.indexOf(f.rule) + 1}: ${ACTION_LABEL[f.action]}${f.action === 'reset' || f.action === 'next' || f.action === 'source' ? '' : ' ' + names}` });
      }
    }
    // Timed modifications in force this cycle.
    for (const m of this.timedMods) {
      if (n < m.from || n >= m.until) continue;
      for (const id of m.voices) if (mods[id]) m.apply(mods[id]!);
      if (m.label === 'source') sourceOnly = true;
    }

    // Autopilot.
    let auto: AutoEffect | null = null;
    if (ext && pr.ext.features.auto && !this.sourceOnly) {
      const fillVoices = pr.voices.filter((v) => pattern.tracks[v.id]?.fill.on).map((v) => v.id);
      auto = autoEffect(n, pr.ext.phrase, pr.ext.activity, pr.seed, pr.voices, fillVoices);
      for (const [id, x] of Object.entries(auto.densityMul)) if (mods[id]) mods[id]!.densityMul *= x;
      for (const [id, x] of Object.entries(auto.fillBoost)) if (mods[id]) mods[id]!.fillBoost += x;
      for (const [id, x] of Object.entries(auto.extraBoost)) if (mods[id]) mods[id]!.extraBoost += x;
      for (const [id, x] of Object.entries(auto.forceFill)) if (mods[id] && !mods[id]!.forceFill) mods[id]!.forceFill = x;
      if (auto.position === 0) labels.push({ kind: 'auto', text: `AUTO PHRASE ${auto.phrase + 1}: ${auto.section}` });
      if (Object.keys(auto.forceFill).length) labels.push({ kind: 'fill', text: 'AUTO FILL (PHRASE END)' });
    }

    // One-off mutations from rules and the autopilot (on top of evolution).
    const muts: { voices: string[]; strength: number; seed: number }[] = [];
    for (const m of this.timedMutations) if (n >= m.from && n < m.until) muts.push(m);
    if (auto?.mutate) muts.push(auto.mutate);
    if (muts.length && !sourceOnly) {
      let cur = tracks ?? sourceTracks;
      for (const m of muts) {
        const r = mutate(cur, lengths, geo, new Rng(m.seed), m.strength, m.voices);
        cur = r.tracks;
      }
      tracks = cur;
    }

    // Morph.
    let morph: CyclePlan['morph'] = null;
    if (this.morph && !this.audition) {
      const to = this.getPattern(this.morph.to);
      if (!to) this.morph = null;
      else {
        const toTracks: TrackStrikes = {};
        for (const v of pr.voices) toTracks[v.id] = to.tracks[v.id]?.strikes ?? [];
        const t = (this.morph.done + 1) / this.morph.cycles;
        tracks = morphTracks(tracks ?? sourceTracks, toTracks, t, geo, hash32(pr.seed, strCode(this.morph.from), strCode(this.morph.to)), pr.voices.map((v) => v.id));
        morph = { from: this.morph.from, to: this.morph.to, t };
        labels.push({ kind: 'morph', text: `MORPH ${Math.round(t * 100)}% → ${to.name}` });
        this.morph.done++;
        if (this.morph.done >= this.morph.cycles) {
          if (pr.playMode === 'pattern') pr.current = this.morph.to;
          this.morph = null;
        }
      }
    }

    const variant = this.buildVariant(sourceTracks, tracks, pr.voices.map((v) => v.id));
    if (this.lockKey !== null && (n === 0 || changed)) labels.push({ kind: 'lock', text: 'PERFORMANCE LOCKED' });
    if (sourceOnly && (n === 0 || !last?.sourceOnly)) labels.push({ kind: 'source', text: 'SOURCE ONLY' });

    const plan: CyclePlan = {
      index: n,
      patternId: pattern.id,
      rep: this.runRep,
      startTick,
      geo,
      pos,
      variant,
      generation,
      mods,
      sourceOnly,
      key: this.lockKey ?? n,
      labels,
      tempo,
      morph,
      song: choice.song,
      endsSong: choice.endsSong,
    };
    this.plans.push(plan);
    if (choice.endsSong) this.ended = true;
    return plan;
  }

  /** Evolved strikes for a generation (cached per settings version). */
  private evolved(pattern: Pattern, source: TrackStrikes, lengths: Record<string, number>, blockStart: number, generation: number): TrackStrikes {
    const ev = pattern.evolve;
    let cache = this.variantCache.get(pattern.id);
    if (!cache || cache.version !== this.version) {
      cache = { version: this.version, gens: new Map() };
      this.variantCache.set(pattern.id, cache);
    }
    const key = blockStart * 100000 + generation;
    const hit = cache.gens.get(key);
    if (hit) return hit;
    const geo = geometry(pattern);
    const pc = strCode(pattern.id);
    const strength = clamp(ev.strength, 0, 100) / 100;
    const seedFor = (k: number, alt = 0) => hash32(this.project.seed, SALT.mutate, pc, blockStart + k, alt);
    let out: TrackStrikes;
    if (ev.mode === 'original') {
      out = mutate(source, lengths, geo, new Rng(seedFor(generation)), strength, ev.targets).tracks;
    } else {
      out = source;
      for (let k = 1; k <= generation; k++) {
        const prevKey = blockStart * 100000 + k;
        const cached = cache.gens.get(prevKey);
        if (cached) {
          out = cached;
          continue;
        }
        let next = mutate(out, lengths, geo, new Rng(seedFor(k)), strength, ev.targets).tracks;
        if (distance(source, next, lengths) * 100 > ev.maxDrift) next = mutate(source, lengths, geo, new Rng(seedFor(k, 1)), strength, ev.targets).tracks;
        cache.gens.set(prevKey, next);
        out = next;
      }
    }
    cache.gens.set(key, out);
    return out;
  }

  /** Describe the difference between source and variant per position. */
  private buildVariant(source: TrackStrikes, tracks: TrackStrikes | null, ids: string[]): Variant {
    const out: Variant = {};
    for (const id of ids) {
      const src = source[id] ?? [];
      if (!tracks) {
        out[id] = { strikes: src, origin: [], removed: [], live: true };
        continue;
      }
      const t = tracks[id] ?? src;
      const vt: VariantTrack = { strikes: t, origin: [], removed: [] };
      for (let i = 0; i < Math.max(src.length, t.length); i++) {
        const a: Strike | null = src[i] ?? null;
        const b: Strike | null = t[i] ?? null;
        vt.removed[i] = !!a && !b;
        vt.origin[i] = !b ? null : !a ? 'added' : a.v !== b.v || a.s !== b.s || !!a.f !== !!b.f ? 'changed' : 'source';
      }
      out[id] = vt;
    }
    return out;
  }

  /** Apply a fired rule. Returns true if it applied. */
  private applyRule(f: Fired, n: number, patternId: string): boolean {
    const r = f.rule;
    const cycles = Math.max(1, Math.floor(r.cycles));
    const amt = clamp(r.amount, 0, 100);
    const timed = (apply: (m: VoiceMods) => void, label = '') =>
      this.timedMods.push({ from: n, until: n + cycles, voices: f.voices, apply, label });
    switch (f.action) {
      case 'fill': {
        const zone = amt >= 75 ? 'bar' : amt >= 40 ? 'half' : 'beat';
        timed((m) => (m.forceFill = { zone, amount: 50 + amt / 2 }));
        return true;
      }
      case 'thin':
        timed((m) => (m.densityMul *= 1 - amt / 100));
        return true;
      case 'boost':
        timed((m) => {
          m.fillBoost += amt;
          m.extraBoost += amt / 2;
        });
        return true;
      case 'mute':
        timed((m) => (m.mute = true));
        return true;
      case 'unmute':
        timed((m) => (m.mute = false));
        return true;
      case 'mutate':
        this.timedMutations.push({ from: n, until: n + cycles, voices: f.voices, strength: amt / 100, seed: hash32(this.project.seed, SALT.rule, strCode(r.id), n) });
        return true;
      case 'reset':
        this.genBase.set(patternId, (this.reps.get(patternId) ?? 1) - 1);
        this.variantCache.delete(patternId);
        this.timedMods = [];
        this.timedMutations = [];
        return true;
      case 'source':
        this.timedMods.push({ from: n, until: n + cycles, voices: [], apply: () => {}, label: 'source' });
        return true;
      case 'next':
        this.nextCue = '__next__';
        return true;
    }
  }

  /** Summary of the mutation ops for a generation (for the monitor). */
  describeGeneration(pattern: Pattern, generation: number): string {
    if (generation <= 0) return 'SOURCE';
    const geo = geometry(pattern);
    const lengths: Record<string, number> = {};
    const src: TrackStrikes = {};
    for (const v of this.project.voices) {
      src[v.id] = pattern.tracks[v.id]?.strikes ?? [];
      lengths[v.id] = pattern.tracks[v.id]?.loop ?? geo.steps;
    }
    const r = mutate(src, lengths, geo, new Rng(hash32(this.project.seed, SALT.mutate, strCode(pattern.id), generation, 0)), pattern.evolve.strength / 100, pattern.evolve.targets);
    return summariseOps(r.ops);
  }
}

/**
 * Several mechanisms can strike the same sound at the same instant (a fill
 * borrowing a voice that has its own strike there, an extra hit on a fill
 * slot, a jam over a written note). A drum hit twice at once is not a
 * louder hit, so they become one note: the loudest, preferring a written
 * strike. Items must be sorted by tick.
 */
export function mergeSimultaneous(items: EngineItem[]): EngineItem[] {
  const out: EngineItem[] = [];
  const at = new Map<string, number>();
  let tick = Number.NaN;
  for (const it of items) {
    if (it.type !== 'note') {
      out.push(it);
      continue;
    }
    if (!(Math.abs(it.tick - tick) <= 1e-6)) {
      at.clear();
      tick = it.tick;
    }
    const key = `${it.channel}:${it.pitches.join('+')}`;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push(it);
      continue;
    }
    const prev = out[i] as NoteItem;
    const keepNew = (it.kind === 'source' && prev.kind !== 'source') || (it.kind === prev.kind && it.velocity > prev.velocity) || (prev.kind !== 'source' && it.kind !== 'source' && it.velocity > prev.velocity);
    const winner = keepNew ? it : prev;
    out[i] = { ...winner, velocity: Math.max(it.velocity, prev.velocity), duration: Math.max(it.duration, prev.duration) };
  }
  return out;
}

function order(i: EngineItem): number {
  return i.type === 'tempo' ? 0 : i.type === 'note' ? 1 : 2;
}

/**
 * Render a performance offline (MIDI and audio export): `cycles` cycles from Start. The
 * optional engine state (LOCK, a breeding audition) is what PLAY would use with the same
 * settings, so an export can reproduce it.
 */
export function renderCycles(
  project: Project,
  cycles: number,
  opts: { sourceOnly?: boolean; lockKey?: number | null; audition?: Pattern | null } = {},
): { notes: NoteItem[]; tempos: TempoItem[]; endTick: number } {
  const e = new Engine(project);
  e.sourceOnly = !!opts.sourceOnly;
  e.lockKey = opts.lockKey ?? null;
  e.audition = opts.audition ?? null;
  for (let c = 0; c < cycles; c++) if (!e.planNext()) break;
  const last = e.plans[e.plans.length - 1];
  const end = last ? endTick(last) : 0;
  e.frozen = true;
  const items = e.generate(end);
  return {
    notes: items.filter((i): i is NoteItem => i.type === 'note'),
    tempos: items.filter((i): i is TempoItem => i.type === 'tempo'),
    endTick: end,
  };
}

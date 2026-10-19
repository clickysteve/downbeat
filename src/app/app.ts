/**
 * The application: the project, the engine, the scheduler, MIDI and sound,
 * and every action the interface can take. Views subscribe to topics and
 * call actions; they never change the project directly.
 */
import { cleanFx, WorkerTransformRunner, type AudioData, type OutputFxSettings, type SampleTransform, type TransformRunner } from '@slopfactory/core/dsp';
import { RenderCancelled } from '@slopfactory/core/render';
import type { ChainConfig } from '@slopfactory/core/engines';
import type { DecodedSample, SampleZone } from '@slopfactory/core/sampler';
import { IndexedDbSampleStore, type SampleStore } from '@slopfactory/core/storage';
import { Auditioner, IndexedDbKitStore, installBundledKits, KitLibrary, KitSession, MemoryKitStore, migrateOnce, type KitStore } from '@slopfactory/core/kits';
import { makeBundle, unpackBundle } from '../audio/bundle';
import { BUNDLED_KITS } from '../audio/bundledKits';
import { APP_ID, DownbeatKitHost, KIT_LIBRARY_DB, type OtherSounds } from '../audio/kits';
import { exportAudio, type AudioExportOptions, type ExportResult } from '../audio/export';
import { SampleLibrary } from '../audio/library';
import { LiveAudio } from '../audio/live';
import { audioOf, ensureAudio, parseSoundKey, referencedSamples, slotOf, syncAudioShape, type SoundChoke, type SoundSlot, type SoundSource } from '../audio/settings';
import { CHAIN_WORKLET_URL, OUTPUT_FX_WORKLET_URL, TRANSFORM_WORKER_URL } from '../audio/urls';
import { EXTRA_VOICES, KIT, makeId, makePattern, makeVoice, newProject, syncTracks } from '../engine/defaults';
import { AUDITION_ID, Engine, renderCycles, type NoteItem } from '../engine/engine';
import { clonePattern, doubleLength, pasteStrikes, regrid, reverse, rotate } from '../engine/patternOps';
import type { CyclePlan } from '../engine/plan';
import type { Realization } from '../engine/realize';
import { randomSeed } from '../engine/rng';
import { MAX_PATTERNS, MAX_RULES, MAX_VOICES, PPQ, clamp, geometry, type Pattern, type Project, type Rule, type Strike, type Track, type Voice } from '../engine/types';
import { breed, type BreedMethod } from '../extended/breed';
import { combine, euclidStrikes, type EuclidMode, type EuclidSpec } from '../extended/euclid';
import { noteName } from '../midi/messages';
import { MidiOutput, type MidiSink } from '../midi/output';
import { MidiAccess, type MidiAccessEvents } from '../midi/webmidi';
import { parseSmf, writeSmf, type SmfTrack } from '../midi/smf';
import { DEMOS, demoProject } from '../persistence/demos';
import { ProjectError, fileName, parseProject, serialize } from '../persistence/format';
import { Store, type KV, type Prefs } from '../persistence/storage';
import { Scheduler, WorkerTicker, type SyncStatus, type Ticker, type TransportState } from '../scheduler/scheduler';
import { PaletteStore, applyPalette, type PaletteKV } from '../ui/palette';

export type Topic =
  | 'project'
  | 'pattern'
  | 'voices'
  | 'track'
  | 'selection'
  | 'transport'
  | 'tempo'
  | 'midi'
  | 'status'
  | 'ext'
  | 'song'
  | 'library'
  | 'audio'
  | 'feed'
  | 'palette'
  | 'kits'
  | 'perf'
  | 'mode';

export type Tool = { kind: 'strike'; level: number } | { kind: 'erase' } | { kind: 'flam' } | { kind: 'prob'; value: number };

export interface FeedLine {
  cycle: number;
  kind: string;
  text: string;
}

export interface AppDeps {
  now?: () => number;
  ticker?: Ticker;
  kv?: KV | null;
  /** Sample storage (default: IndexedDB in the browser; null: none) */
  sampleStore?: SampleStore | null;
  /** Kit library storage: kits and the sample index (default: IndexedDB in the browser) */
  kitStore?: KitStore | null;
  /** Sample decoding, AudioBuffers and transformations (tests replace them) */
  decode?: (bytes: ArrayBuffer, name: string) => Promise<DecodedSample>;
  makeBuffer?: (audio: AudioData) => AudioBuffer;
  transformRunner?: TransformRunner;
  /** Core's output-processing AudioWorklet (null: no processing) */
  workletUrl?: string | null;
  /** Core's output-chain AudioWorklet (null: the OUTPUT CHAIN does not run) */
  chainWorkletUrl?: string | null;
  /** Download hook (tests capture files here). */
  download?: (name: string, data: Blob | string, type: string) => void;
}

const UNDO_LIMIT = 60;

export class App {
  project: Project;
  readonly engine: Engine;
  readonly out: MidiOutput;
  readonly sched: Scheduler;
  /** Live internal audio (Slop Factory Core): internal sounds and samples. */
  readonly audio: LiveAudio;
  /** Samples of the drum sounds, shared by live audio and audio export. */
  readonly library: SampleLibrary;
  /** Slop Factory Core's kit library: every sample kept in this browser, and the saved kits. */
  readonly kitLibrary: KitLibrary;
  /** The current kit (KITS): Core's kit workflow on DOWNBEAT's drum sounds. */
  readonly kits: KitSession;
  /** Resolves when the kit library has started (migration, bundled kits, the current kit). */
  readonly kitsReady: Promise<void>;
  /** LOAD KIT: drum sounds the kit does not cover keep their sounds, or go back to INTERNAL. */
  otherSounds: OtherSounds = 'keep';
  /** Previews of library samples (on the live AudioContext, outside the sequencer). */
  readonly audition: Auditioner;
  /** An audio export in progress. */
  exporting: AbortController | null = null;
  readonly midi: MidiAccess;
  readonly store: Store;
  readonly palettes: PaletteStore;
  prefs: Prefs;
  sel: { voice: string; tool: Tool; soundStep: number; tab: string } = { voice: '', tool: { kind: 'strike', level: 3 }, soundStep: 1, tab: 'voice' };
  feed: FeedLine[] = [];
  status = '';
  statusKind: 'info' | 'warn' = 'info';
  /** Recording a take (every note played, for MIDI export). */
  take: { recording: boolean; notes: NoteItem[]; startTick: number; tempo: number; ms: number[] } = { recording: false, notes: [], startTick: 0, tempo: 120, ms: [] };
  /** Record strikes from the MIDI input while playing. */
  recArmed = false;
  /** MIDI LEARN in progress: the next incoming note is assigned here. */
  learn: { voice: string; step: number } | null = null;
  /** Copied track strikes. */
  clipboard: (Strike | null)[] | null = null;
  /** Breeding parameters and the auditioned child. */
  breedState: { partner: string | null; method: BreedMethod; seed: number } = { partner: null, method: 'crossover', seed: 1 };
  euclid: EuclidSpec & { mode: EuclidMode; setLoop: boolean } = { steps: 16, hits: 5, rotation: 0, accent: 'first', accentHits: 2, level: 3, mode: 'replace', setLoop: false };
  morphBars = 8;
  syncStatus: SyncStatus = 'internal';
  midiLog: string[] = [];
  outputLost = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Map<Topic, Set<() => void>>();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private now: () => number;
  private downloadFn: (name: string, data: Blob | string, type: string) => void;
  private workletUrl: string | null;
  private chainWorkletUrl: string | null;
  private lastEdit: { key: string; at: number } | null = null;
  private lastHeardCycle = -1;
  private preview: { key: string; plan: CyclePlan | null } | null = null;

  constructor(deps: AppDeps = {}) {
    this.now = deps.now ?? (() => performance.now());
    const kv = deps.kv === undefined ? safeLocalStorage() : deps.kv;
    this.store = new Store(kv);
    this.palettes = new PaletteStore(kv as PaletteKV | null);
    this.prefs = this.store.prefs();
    const restored = this.store.loadAutosave();
    this.project = restored?.project ?? demoProject('electro');
    syncTracks(this.project);
    this.engine = new Engine(this.project);
    this.out = new MidiOutput(this.now);
    this.sched = new Scheduler(this.engine, this.out, this.now, deps.ticker ?? new WorkerTicker());
    const store = deps.sampleStore !== undefined ? deps.sampleStore : typeof indexedDB !== 'undefined' ? new IndexedDbSampleStore('downbeat-samples') : null;
    const runner = deps.transformRunner ?? (typeof Worker !== 'undefined' ? new WorkerTransformRunner(() => new Worker(TRANSFORM_WORKER_URL, { type: 'module' })) : undefined);
    // kits and the sample index in their own database; audio stays in `downbeat-samples`
    const kitStore = deps.kitStore !== undefined ? deps.kitStore : typeof indexedDB !== 'undefined' ? new IndexedDbKitStore(KIT_LIBRARY_DB) : store ? new MemoryKitStore() : null;
    this.kitLibrary = new KitLibrary({ app: APP_ID, audio: store, store: kitStore, decode: deps.decode, inUse: () => this.samplesInUse() });
    this.library = new SampleLibrary({ store, runner, decode: deps.decode, makeBuffer: deps.makeBuffer, source: (id, name) => this.kitLibrary.decoded(id, name) });
    this.kits = new KitSession(this.kitLibrary, new DownbeatKitHost(this), { untitled: 'UNTITLED KIT' });
    this.kits.onChange(() => this.emit(['kits']));
    this.library.onChange = () => this.emit(['audio']);
    this.workletUrl = deps.workletUrl !== undefined ? deps.workletUrl : OUTPUT_FX_WORKLET_URL;
    this.chainWorkletUrl = deps.chainWorkletUrl !== undefined ? deps.chainWorkletUrl : CHAIN_WORKLET_URL;
    this.audio = new LiveAudio(() => this.project, this.library, this.workletUrl, this.chainWorkletUrl);
    this.audio.volume = this.prefs.volume;
    if (this.project.audio) this.library.sync(this.project.audio);
    this.downloadFn = deps.download ?? browserDownload;
    this.sel.voice = this.project.voices[0]!.id;
    this.sel.tab = this.prefs.tab;
    const events: MidiAccessEvents = {
      onPorts: () => this.emit(['midi']),
      onOutputLost: () => {
        this.out.deviceLost();
        this.outputLost = true;
        this.setStatus('MIDI output disconnected. Playback continues; it reconnects when the device returns.', 'warn');
        this.emit(['midi']);
      },
      onOutputReturned: () => {
        this.outputLost = false;
        this.applyRouting();
        this.setStatus('MIDI output reconnected.');
      },
      onInputLost: () => {
        this.sched.setInputReady(false);
        this.sched.clockInterrupted();
        this.setStatus('MIDI input disconnected.', 'warn');
      },
      onInputReturned: () => {
        this.sched.setInputReady(true);
        this.setStatus('MIDI input reconnected.');
      },
    };
    this.midi = new MidiAccess(events);
    this.sched.clockOutSetting = this.prefs.clockOut;
    this.sched.on((e) => {
      if (e.type === 'transport') {
        if (e.state === 'stopped') {
          this.audio.cancel();
          this.lastHeardCycle = -1;
          if (this.take.recording) this.stopTake();
        }
        this.emit(['transport']);
      } else if (e.type === 'note') {
        this.onNote(e.note.item, e.note.ms, e.note.offMs);
      } else if (e.type === 'sync') {
        this.syncStatus = e.status;
        this.emit(['midi', 'transport']);
      } else if (e.type === 'tempo') {
        this.emit(['tempo']);
      } else if (e.type === 'realtime') {
        this.logMidi(`IN ${e.message}`);
      }
    });
    this.out.onClear(() => this.audio.cancel());
    this.audition = new Auditioner({ context: async () => ((await this.audio.ensure()) ? this.audio.ctx : null) });
    this.kitsReady = this.startKits();
    if (restored?.report.length) this.setStatus(`Restored your last session. ${restored.report.join(' ')}`);
    else if (restored) this.setStatus('Restored your last session.');
    else this.setStatus('Welcome to DOWNBEAT. Press PLAY (space bar), then change DENSITY or FILL on a voice.');
  }

  // ------------------------------------------------------------------ events

  on(topics: Topic | Topic[], fn: () => void): () => void {
    const ts = Array.isArray(topics) ? topics : [topics];
    for (const t of ts) {
      let set = this.listeners.get(t);
      if (!set) {
        set = new Set();
        this.listeners.set(t, set);
      }
      set.add(fn);
    }
    return () => ts.forEach((t) => this.listeners.get(t)?.delete(fn));
  }

  emit(topics: Topic[]): void {
    const fns = new Set<() => void>();
    for (const t of topics) this.listeners.get(t)?.forEach((f) => fns.add(f));
    fns.forEach((f) => f());
  }

  setStatus(msg: string, kind: 'info' | 'warn' = 'info'): void {
    this.status = msg;
    this.statusKind = kind;
    this.emit(['status']);
  }

  // ------------------------------------------------------------------ accessors

  /** The pattern shown and edited: the auditioned child, or the current pattern. */
  pattern(): Pattern {
    return this.engine.audition ?? this.project.patterns.find((p) => p.id === this.project.current) ?? this.project.patterns[0]!;
  }

  voice(id = this.sel.voice): Voice {
    return this.project.voices.find((v) => v.id === id) ?? this.project.voices[0]!;
  }

  track(id = this.sel.voice): Track {
    const p = this.pattern();
    return p.tracks[id] ?? p.tracks[this.project.voices[0]!.id]!;
  }

  get ext(): boolean {
    return this.project.ext.enabled;
  }

  get transport(): TransportState {
    return this.sched.state;
  }

  /** The heard cycle (playing), or a preview of the shown pattern (stopped). */
  heard(): { plan: CyclePlan | null; real: Realization | null; tick: number; playing: boolean } {
    const playing = this.sched.state !== 'stopped';
    const tick = this.sched.positionTick();
    let plan = playing ? this.engine.cycleAt(tick) : null;
    if (!plan) {
      const key = `${this.engine.version}:${this.pattern().id}:${this.engine.sourceOnly}:${this.engine.lockKey}:${!!this.engine.audition}`;
      if (this.preview?.key !== key) this.preview = { key, plan: this.engine.previewPlan(this.pattern().id) };
      plan = this.preview.plan;
    }
    const real = plan ? this.engine.realization(plan) : null;
    if (playing && plan && plan.index !== this.lastHeardCycle && this.engine.cycleAt(tick) === plan) {
      this.lastHeardCycle = plan.index;
      for (const l of plan.labels) this.pushFeed({ cycle: plan.index + 1, kind: l.kind, text: l.text });
      if (real) for (const l of this.cycleSummary(plan, real)) this.pushFeed({ cycle: plan.index + 1, ...l });
      this.followSong(plan);
    }
    return { plan, real, tick, playing };
  }

  /** What the performance did this cycle, for the monitor: fills, extra hits, variant changes. */
  private cycleSummary(plan: CyclePlan, real: Realization): { kind: string; text: string }[] {
    const out: { kind: string; text: string }[] = [];
    const name = (id: string) => this.project.voices.find((v) => v.id === id)?.name ?? '?';
    const gen = new Map<string, number>();
    for (const ev of real.events) {
      if (ev.kind !== 'fill' && ev.kind !== 'extra') continue;
      const k = `${ev.kind}:${ev.voice}:${ev.sound}`;
      gen.set(k, (gen.get(k) ?? 0) + 1);
    }
    const fills: string[] = [];
    const extras: string[] = [];
    for (const [k, n] of gen) {
      const [kind, voice, sound] = k.split(':') as [string, string, string];
      if (kind === 'fill') fills.push(`${name(voice)}${sound !== voice ? `→${name(sound)}` : ''} ×${n}`);
      else extras.push(`${name(voice)} ×${n}`);
    }
    if (fills.length) out.push({ kind: 'fill', text: `FILL ${fills.join(', ')}` });
    if (extras.length) out.push({ kind: 'fill', text: `EXTRA ${extras.join(', ')}` });
    const changed = plan.labels.some((l) => l.kind === 'evolve' || l.kind === 'morph' || l.kind === 'rule' || l.kind === 'auto');
    if (changed) {
      let add = 0;
      let rem = 0;
      let chg = 0;
      const voices = new Set<string>();
      for (const [id, vt] of Object.entries(plan.variant)) {
        if (vt.live) continue;
        vt.origin.forEach((o, i) => {
          if (o === 'added') (add++, voices.add(id));
          if (o === 'changed') (chg++, voices.add(id));
          if (vt.removed[i]) (rem++, voices.add(id));
        });
      }
      if (add + rem + chg) out.push({ kind: 'mutate', text: `CHANGED +${add} −${rem} ~${chg} (${[...voices].map(name).join(', ')})` });
    }
    let sup = 0;
    for (const st of Object.values(real.stats)) sup += st.written - st.played;
    if (sup && plan.index % 4 === 0) out.push({ kind: 'rest', text: `${sup} WRITTEN HIT${sup > 1 ? 'S' : ''} RESTING (DENSITY / PROBABILITY)` });
    return out;
  }

  /** FOLLOW: the grid shows the pattern the song is playing, and scrolls with the playhead. */
  setFollow(on: boolean): void {
    this.prefs.follow = on;
    this.store.savePrefs(this.prefs);
    if (on && this.sched.state !== 'stopped') {
      const { plan } = this.heard();
      if (plan) this.followSong(plan);
    }
    this.emit(['selection', 'pattern']);
  }

  private followSong(plan: CyclePlan): void {
    if (!this.prefs.follow) return;
    if (this.project.playMode === 'song' && plan.patternId !== this.project.current && plan.patternId !== AUDITION_ID) {
      if (this.project.patterns.some((p) => p.id === plan.patternId)) {
        this.project.current = plan.patternId;
        this.emit(['pattern', 'selection']);
      }
    }
  }

  pushFeed(line: FeedLine): void {
    this.feed.push(line);
    if (this.feed.length > 200) this.feed.splice(0, this.feed.length - 200);
    this.emit(['feed']);
  }

  // ------------------------------------------------------------------ change management

  private snapshot(): string {
    return JSON.stringify(this.project);
  }

  /**
   * Make an undoable edit. Edits with the same `coalesce` key in quick succession (a slider
   * being dragged) make one undo step.
   */
  edit(fn: () => void, topics: Topic[] = ['pattern'], coalesce?: string): void {
    const now = Date.now();
    if (!coalesce || this.lastEdit?.key !== coalesce || now - this.lastEdit.at > 1500) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.lastEdit = coalesce ? { key: coalesce, at: now } : null;
    this.redoStack = [];
    fn();
    this.touch(topics);
  }

  /** Something changed (not undoable: live performance controls). */
  touch(topics: Topic[] = ['pattern']): void {
    this.engine.touch();
    this.scheduleAutosave();
    this.emit(topics);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.setStatus('Undone.');
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.setStatus('Redone.');
  }

  private restore(s: string): void {
    const p = JSON.parse(s) as Project;
    if (!p.audio) delete this.project.audio;
    Object.assign(this.project, p);
    this.fixSelection();
    this.audioChanged();
    this.touch(['project', 'pattern', 'voices', 'track', 'song', 'ext', 'selection']);
  }

  private fixSelection(): void {
    if (!this.project.voices.some((v) => v.id === this.sel.voice)) this.sel.voice = this.project.voices[0]!.id;
    if (!this.project.patterns.some((p) => p.id === this.project.current)) this.project.current = this.project.patterns[0]!.id;
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.store.saveAutosave(this.project);
    }, 600);
  }

  /** Save now (page hide). */
  flushAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.store.saveAutosave(this.project);
  }

  /** Replace the whole project (new, open, import, demo). */
  loadProjectObject(p: Project, message: string): void {
    this.sched.stop();
    this.engine.audition = null;
    this.engine.cancelMorph();
    this.engine.lockKey = null;
    this.engine.sourceOnly = false;
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    for (const k of Object.keys(this.project)) delete (this.project as unknown as Record<string, unknown>)[k];
    Object.assign(this.project, p);
    syncTracks(this.project);
    this.audioChanged();
    this.sel.voice = this.project.voices[0]!.id;
    this.feed = [];
    this.touch(['project', 'pattern', 'voices', 'track', 'song', 'ext', 'selection', 'feed', 'perf', 'mode', 'tempo']);
    this.sched.setTempo(this.project.tempo);
    this.setStatus(message);
  }

  // ------------------------------------------------------------------ selection and tools

  selectVoice(id: string, audition = true): void {
    if (!this.project.voices.some((v) => v.id === id)) return;
    this.sel.voice = id;
    if (this.sel.soundStep > this.voice().notes.length) this.sel.soundStep = 1;
    this.emit(['selection', 'track']);
    if (audition) this.auditionVoice(id);
  }

  setTool(t: Tool): void {
    this.sel.tool = t;
    this.emit(['selection']);
  }

  setTab(tab: string): void {
    this.sel.tab = tab;
    this.prefs.tab = tab;
    this.store.savePrefs(this.prefs);
    this.emit(['selection']);
  }

  setSoundStep(s: number): void {
    this.sel.soundStep = clamp(Math.round(s), 0, this.voice().notes.length);
    this.emit(['selection']);
  }

  // ------------------------------------------------------------------ strike editing

  /**
   * What a press on a cell will do with the current tool: used for the whole
   * drag so painting is consistent.
   */
  strikeAction(voiceId: string, step: number, alt = false, erase = false): 'paint' | 'erase' | 'flam' | 'prob' {
    const t = this.sel.tool;
    if (erase || t.kind === 'erase') return 'erase';
    if (alt || t.kind === 'flam') return 'flam';
    if (t.kind === 'prob') return 'prob';
    const s = this.track(voiceId).strikes[step];
    if (s && s.v === t.level && (s.s === this.sel.soundStep || this.sel.soundStep === 1)) return 'erase';
    return 'paint';
  }

  applyStrike(voiceId: string, step: number, action: 'paint' | 'erase' | 'flam' | 'prob', undoable = true): void {
    const track = this.pattern().tracks[voiceId];
    if (!track || step < 0 || step >= track.strikes.length) return;
    const t = this.sel.tool;
    const before = JSON.stringify(track.strikes[step] ?? null);
    const run = () => {
      const cur = track.strikes[step] ?? null;
      switch (action) {
        case 'erase':
          track.strikes[step] = null;
          break;
        case 'paint':
          track.strikes[step] = { v: t.kind === 'strike' ? t.level : 3, s: this.sel.soundStep, ...(cur?.f ? { f: true } : {}) };
          break;
        case 'flam':
          if (cur) {
            if (cur.f) delete cur.f;
            else cur.f = true;
          } else track.strikes[step] = { v: 4, s: this.sel.soundStep, f: true };
          break;
        case 'prob':
          if (cur) {
            const v = t.kind === 'prob' ? t.value : 50;
            if (v >= 100) delete cur.p;
            else cur.p = v;
          }
          break;
      }
    };
    if (undoable) this.edit(run, ['pattern']);
    else {
      run();
      this.touch(['pattern']);
    }
    const after = track.strikes[step];
    if (after && JSON.stringify(after) !== before && this.sched.state === 'stopped' && action === 'paint') {
      this.auditionVoice(voiceId, after.v || 3, after.s);
    }
  }

  /** Start a drag gesture: one undo step for the whole stroke. */
  beginStroke(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  // ------------------------------------------------------------------ track operations

  rotateTrack(dir: number, all = false): void {
    this.edit(() => {
      const p = this.pattern();
      const ids = all ? this.project.voices.map((v) => v.id) : [this.sel.voice];
      for (const id of ids) if (p.tracks[id]) rotate(p.tracks[id]!, dir);
    });
    this.setStatus(`${all ? 'Pattern' : this.voice().name} shifted ${dir > 0 ? 'later' : 'earlier'} by one step (wraps around).`);
  }

  reverseTrack(): void {
    this.edit(() => reverse(this.track()));
  }

  clearTrack(all = false): void {
    this.edit(() => {
      const p = this.pattern();
      const ids = all ? Object.keys(p.tracks) : [this.sel.voice];
      for (const id of ids) p.tracks[id]!.strikes.fill(null);
    });
  }

  copyTrack(): void {
    this.clipboard = this.track().strikes.map((s) => (s ? { ...s } : null));
    this.setStatus(`Copied ${this.voice().name}.`);
    this.emit(['selection']);
  }

  pasteTrack(): void {
    const c = this.clipboard;
    if (!c) return;
    this.edit(() => pasteStrikes(this.track(), c));
  }

  setTrack(fn: (t: Track) => void, undoable = false): void {
    if (undoable) this.edit(() => fn(this.track()), ['track', 'pattern']);
    else {
      fn(this.track());
      this.touch(['track', 'pattern']);
    }
  }

  /** Apply a track setting to every voice (or the same setting across patterns). */
  setTrackAll(fn: (t: Track) => void): void {
    this.edit(() => {
      for (const t of Object.values(this.pattern().tracks)) fn(t);
    }, ['track', 'pattern']);
  }

  setVoice(fn: (v: Voice) => void, topics: Topic[] = ['voices', 'track']): void {
    this.edit(() => fn(this.voice()), topics);
  }

  toggleMute(id: string): void {
    const v = this.project.voices.find((x) => x.id === id);
    if (!v) return;
    v.mute = !v.mute;
    this.touch(['voices']);
  }

  toggleSolo(id: string): void {
    const v = this.project.voices.find((x) => x.id === id);
    if (!v) return;
    v.solo = !v.solo;
    this.touch(['voices']);
  }

  setJam(id: string, mode: 'roll' | 'echo' | null): void {
    this.engine.setJam(id, mode);
    this.emit(['voices']);
  }

  addVoice(templateName?: string): void {
    if (this.project.voices.length >= MAX_VOICES) {
      this.setStatus(`A project holds at most ${MAX_VOICES} voices.`, 'warn');
      return;
    }
    const used = new Set(this.project.voices.map((v) => v.name));
    const t = [...KIT, ...EXTRA_VOICES].find((x) => (templateName ? x.name === templateName : !used.has(x.name))) ?? EXTRA_VOICES[0]!;
    this.edit(() => {
      const v = makeVoice(t);
      if (used.has(v.name)) v.name = `${v.name.slice(0, 9)} ${this.project.voices.length + 1}`;
      this.project.voices.push(v);
      syncTracks(this.project);
      if (this.project.audio) syncAudioShape(this.project.audio, this.project.voices);
      this.sel.voice = v.id;
    }, ['voices', 'pattern', 'track', 'selection']);
  }

  removeVoice(id = this.sel.voice): void {
    if (this.project.voices.length <= 1) return;
    this.edit(() => {
      this.project.voices = this.project.voices.filter((v) => v.id !== id);
      for (const p of this.project.patterns) for (const t of Object.values(p.tracks)) if (t.fill.sound === id) t.fill.sound = null;
      for (const r of this.project.ext.rules) if (r.target === id) r.target = 'all';
      this.project.ext.rules = this.project.ext.rules.filter((r) => !(r.when.type === 'density' && r.when.voice === id));
      syncTracks(this.project);
      if (this.project.audio) syncAudioShape(this.project.audio, this.project.voices);
      this.fixSelection();
    }, ['voices', 'pattern', 'track', 'selection', 'ext', 'audio']);
    this.audioChanged();
  }

  moveVoice(id: string, dir: number): void {
    const i = this.project.voices.findIndex((v) => v.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.project.voices.length) return;
    this.edit(() => {
      const vs = this.project.voices;
      [vs[i], vs[j]] = [vs[j]!, vs[i]!];
    }, ['voices', 'pattern']);
  }

  // ------------------------------------------------------------------ patterns

  selectPattern(id: string): void {
    if (!this.project.patterns.some((p) => p.id === id)) return;
    if (this.engine.audition) this.discardBreed();
    // Choosing a pattern to look at while a song plays: stop the view following the song.
    if (this.sched.state !== 'stopped' && this.project.playMode === 'song' && this.prefs.follow) {
      this.prefs.follow = false;
      this.store.savePrefs(this.prefs);
      this.setStatus('FOLLOW is off so you can edit this pattern while the song plays. Switch FOLLOW on (above the grid) to follow the song again.');
    }
    this.project.current = id;
    this.touch(['pattern', 'selection', 'track']);
    if (this.sched.state === 'playing' && this.project.playMode === 'pattern') this.setStatus(`${this.pattern().name} cued: it starts at the end of this cycle.`);
  }

  newPattern(): void {
    if (this.project.patterns.length >= MAX_PATTERNS) return;
    this.edit(() => {
      const cur = this.pattern();
      const p = makePattern(this.project.voices, `PATTERN ${this.project.patterns.length + 1}`, { beats: cur.beats, unit: cur.unit, bars: cur.bars, grid: cur.grid });
      this.project.patterns.push(p);
      this.project.current = p.id;
    }, ['project', 'pattern', 'track', 'song']);
  }

  duplicatePattern(): void {
    if (this.project.patterns.length >= MAX_PATTERNS) return;
    this.edit(() => {
      const p = clonePattern(this.pattern());
      p.name = `${this.pattern().name.slice(0, 12)} +`;
      p.evolve.locked = null;
      this.project.patterns.push(p);
      this.project.current = p.id;
    }, ['project', 'pattern', 'track', 'song']);
  }

  renamePattern(name: string): void {
    const n = name.trim().toUpperCase().slice(0, 16);
    if (!n) return;
    this.edit(() => (this.pattern().name = n), ['project', 'pattern', 'song']);
  }

  deletePattern(id = this.project.current): void {
    if (this.project.patterns.length <= 1) return;
    this.edit(() => {
      this.project.patterns = this.project.patterns.filter((p) => p.id !== id);
      this.project.song.entries = this.project.song.entries.filter((e) => e.patternId !== id);
      this.fixSelection();
    }, ['project', 'pattern', 'track', 'song']);
  }

  setGeometry(g: Partial<Pick<Pattern, 'beats' | 'unit' | 'bars' | 'grid'>>): boolean {
    let ok = false;
    this.edit(() => {
      ok = regrid(this.pattern(), g);
    }, ['pattern', 'track']);
    if (!ok) this.setStatus('That would make the pattern longer than 64 steps.', 'warn');
    return ok;
  }

  doublePattern(): void {
    let ok = false;
    this.edit(() => (ok = doubleLength(this.pattern())), ['pattern', 'track']);
    if (!ok) this.setStatus('That would make the pattern longer than 64 steps.', 'warn');
  }

  setPatternTempo(t: number | null): void {
    this.edit(() => (this.pattern().tempo = t === null ? null : clamp(t, 20, 300)), ['pattern']);
  }

  // ------------------------------------------------------------------ song

  setPlayMode(m: 'pattern' | 'song'): void {
    this.project.playMode = m;
    this.touch(['song', 'transport']);
  }

  songAdd(id = this.project.current): void {
    this.edit(() => this.project.song.entries.push({ patternId: id, repeats: 2 }), ['song']);
  }

  songRemove(i: number): void {
    this.edit(() => this.project.song.entries.splice(i, 1), ['song']);
  }

  songMove(i: number, dir: number): void {
    const e = this.project.song.entries;
    const j = i + dir;
    if (j < 0 || j >= e.length) return;
    this.edit(() => ([e[i], e[j]] = [e[j]!, e[i]!]), ['song']);
  }

  songRepeats(i: number, n: number): void {
    const e = this.project.song.entries[i];
    if (!e) return;
    this.edit(() => (e.repeats = clamp(Math.round(n), 1, 99)), ['song']);
  }

  // ------------------------------------------------------------------ transport

  async ensureAudio(): Promise<void> {
    if (this.prefs.output !== 'midi') await this.audio.ensure();
  }

  play(): void {
    void this.ensureAudio();
    if (this.sched.external) {
      this.setStatus('Following external MIDI Clock: start and stop from the clock source.', 'warn');
      return;
    }
    this.sched.setTempo(this.project.tempo);
    if (this.sched.state === 'paused') this.sched.resume();
    else if (this.sched.state === 'stopped') {
      this.feed = [];
      this.emit(['feed']);
      this.audio.resetFx();
      this.sched.start();
    }
  }

  pause(): void {
    this.sched.pause();
  }

  togglePlay(): void {
    if (this.sched.state === 'playing') this.pause();
    else this.play();
  }

  stop(): void {
    this.sched.stop();
  }

  panic(): void {
    this.out.panic();
    this.audio.cancel();
    this.setStatus('PANIC: all notes off on all 16 channels.');
  }

  setTempo(bpm: number): void {
    const b = clamp(Math.round(bpm * 10) / 10, 20, 300);
    this.project.tempo = b;
    if (this.pattern().tempo === null || this.sched.state === 'stopped') this.sched.setTempo(b);
    this.scheduleAutosave();
    this.emit(['tempo']);
  }

  // ------------------------------------------------------------------ performance

  /** A new variation: a new seed changes every random decision. */
  newVariation(): void {
    this.project.seed = randomSeed();
    this.touch(['perf']);
    this.setStatus(`New variation (seed ${this.project.seed}).`);
  }

  setSeed(seed: number): void {
    this.project.seed = clamp(Math.round(seed), 1, 4294967295);
    this.touch(['perf']);
  }

  /** Replay the identical take from the beginning. */
  replay(): void {
    if (this.sched.external) return;
    this.sched.stop();
    this.play();
    this.setStatus(`Replaying seed ${this.project.seed} from the start.`);
  }

  toggleSource(): void {
    this.engine.sourceOnly = !this.engine.sourceOnly;
    this.touch(['perf']);
    this.setStatus(this.engine.sourceOnly ? 'SOURCE: the written pattern only, nothing generated.' : 'Performance restored.');
  }

  toggleLock(): void {
    if (this.engine.lockKey !== null) {
      this.engine.lockKey = null;
      this.setStatus('Variation unlocked: each cycle varies again.');
    } else {
      const { plan } = this.heard();
      this.engine.lockKey = plan?.key ?? 0;
      this.setStatus('Variation locked: every cycle repeats this one.');
    }
    this.touch(['perf']);
  }

  resync(): void {
    this.engine.resync();
    this.setStatus('Loops realign at the next cycle.');
  }

  setMode(ext: boolean): void {
    if (!ext) {
      // CLASSIC stops every Extended transformation, including ones in progress.
      this.engine.cancelMorph();
      this.engine.audition = null;
    }
    this.project.ext.enabled = ext;
    this.touch(['mode', 'ext', 'pattern', 'perf']);
    this.setStatus(ext ? 'EXTENDED: probability, groove, evolution, rules and the autopilot are available.' : 'CLASSIC: UpBeat-style density, fills, velocity, loops and jam. Extended transformations are off.');
  }

  /** Capture the heard cycle (with its generated notes) as a new pattern. */
  captureVariation(): void {
    const { plan, real } = this.heard();
    if (!plan || !real) return;
    const src = this.engine.getPattern(plan.patternId);
    if (!src || this.project.patterns.length >= MAX_PATTERNS) return;
    this.edit(() => {
      const p = clonePattern(src);
      p.name = `${src.name.slice(0, 10)} V${plan.index + 1}`;
      p.evolve = { ...p.evolve, on: false, locked: null };
      const steps = geometry(p).steps;
      for (const t of Object.values(p.tracks)) {
        t.strikes = new Array<null>(steps).fill(null);
        t.loop = steps;
        t.density = 100;
        t.fill.on = false;
        t.timing = 0;
        t.ext = { ...t.ext, prob: 100, extra: 0, accent: 0 };
      }
      for (const ev of real.events) {
        if (ev.kind === 'flam' || Math.abs(ev.x - Math.round(ev.x)) > 1e-6) continue;
        const i = Math.round(ev.x);
        const t = p.tracks[ev.sound];
        if (!t || i >= steps || t.strikes[i]) continue;
        t.strikes[i] = { v: ev.level, s: ev.note + 1 };
      }
      for (const ev of real.events) {
        if (ev.kind !== 'flam') continue;
        const s = p.tracks[ev.sound]?.strikes[Math.round(ev.x)];
        if (s) s.f = true;
      }
      this.project.patterns.push(p);
      this.project.current = p.id;
    }, ['project', 'pattern', 'track', 'song']);
    this.setStatus('Captured the playing variation as a new pattern (generated notes written in).');
  }

  // ------------------------------------------------------------------ extended

  setExt(fn: (p: Project['ext']) => void, topics: Topic[] = ['ext', 'pattern']): void {
    fn(this.project.ext);
    this.touch(topics);
  }

  setEvolve(fn: (e: Pattern['evolve']) => void): void {
    fn(this.pattern().evolve);
    this.touch(['ext', 'pattern']);
  }

  resetEvolution(): void {
    this.engine.resetEvolution(this.pattern().id);
    this.setStatus('Evolution returns to the source at the next cycle.');
    this.emit(['ext']);
  }

  lockEvolution(): void {
    const p = this.pattern();
    if (p.evolve.locked) {
      this.edit(() => (p.evolve.locked = null), ['ext', 'pattern']);
      this.setStatus('Evolution unlocked.');
      return;
    }
    const { plan } = this.heard();
    if (!plan || plan.patternId !== p.id) {
      this.setStatus('Play the pattern to lock the generation you hear.', 'warn');
      return;
    }
    const tracks: Record<string, (Strike | null)[]> = {};
    for (const [id, vt] of Object.entries(plan.variant)) tracks[id] = (vt.live ? p.tracks[id]!.strikes : vt.strikes).map((s) => (s ? { ...s } : null));
    this.edit(() => (p.evolve.locked = { generation: plan.generation, tracks }), ['ext', 'pattern']);
    this.setStatus(`Locked generation ${plan.generation}. It is saved with the project.`);
  }

  applyEuclid(): void {
    const e = this.euclid;
    this.edit(() => {
      const t = this.track();
      const steps = t.strikes.length;
      const n = clamp(e.steps, 1, steps);
      const gen = euclidStrikes({ ...e, steps: n });
      const row: (Strike | null)[] = Array.from({ length: steps }, (_, i) => (e.setLoop ? gen[i] ?? null : gen[i % n] ?? null));
      t.strikes = combine(t.strikes, row, e.mode);
      if (e.setLoop) t.loop = n;
    }, ['pattern', 'track']);
    this.setStatus(`Euclidean ${e.hits}/${e.steps} written into ${this.voice().name} (${e.mode}).`);
  }

  addRule(): void {
    if (this.project.ext.rules.length >= MAX_RULES) return;
    this.edit(() => {
      this.project.ext.rules.push({ id: makeId('r'), on: true, when: { type: 'every', n: 4, offset: 3 }, then: 'fill', target: this.sel.voice, amount: 60, cycles: 1 });
    }, ['ext']);
  }

  setRule(id: string, fn: (r: Rule) => void): void {
    const r = this.project.ext.rules.find((x) => x.id === id);
    if (!r) return;
    this.edit(() => fn(r), ['ext']);
  }

  removeRule(id: string): void {
    this.edit(() => (this.project.ext.rules = this.project.ext.rules.filter((r) => r.id !== id)), ['ext']);
  }

  /** Breed the current pattern with the partner and audition the child. */
  auditionBreed(newSeed = false): void {
    const a = this.project.patterns.find((p) => p.id === this.project.current)!;
    const b = this.project.patterns.find((p) => p.id === this.breedState.partner) ?? this.project.patterns.find((p) => p.id !== a.id);
    if (!b) {
      this.setStatus('Breeding needs two patterns. Make another pattern first.', 'warn');
      return;
    }
    this.breedState.partner = b.id;
    if (newSeed) this.breedState.seed = randomSeed();
    const geo = geometry(a);
    const ta: Record<string, (Strike | null)[]> = {};
    const tb: Record<string, (Strike | null)[]> = {};
    for (const v of this.project.voices) {
      ta[v.id] = a.tracks[v.id]?.strikes ?? [];
      tb[v.id] = b.tracks[v.id]?.strikes ?? [];
    }
    const child = breed(ta, tb, this.breedState.method, geo, this.breedState.seed, this.project.voices.map((v) => v.id));
    const p = clonePattern(a, false);
    p.id = AUDITION_ID;
    p.name = `${a.name.slice(0, 6)}×${b.name.slice(0, 6)}`;
    p.evolve = { ...p.evolve, on: false, locked: null };
    for (const v of this.project.voices) {
      const t = p.tracks[v.id];
      if (t) {
        t.strikes = child[v.id] ?? t.strikes;
        t.loop = geo.steps;
      }
    }
    this.engine.audition = p;
    this.touch(['pattern', 'ext', 'track']);
    this.setStatus(`Auditioning ${a.name} × ${b.name}. KEEP adds it to the library; both parents are unchanged.`);
  }

  keepBreed(): void {
    const c = this.engine.audition;
    if (!c) return;
    this.engine.audition = null;
    this.edit(() => {
      const p = clonePattern(c);
      this.project.patterns.push(p);
      this.project.current = p.id;
    }, ['project', 'pattern', 'ext', 'song', 'track']);
    this.setStatus('Kept the child pattern.');
  }

  discardBreed(): void {
    if (!this.engine.audition) return;
    this.engine.audition = null;
    this.touch(['pattern', 'ext', 'track']);
  }

  startMorph(to: string): void {
    const target = this.project.patterns.find((p) => p.id === to);
    if (!target) return;
    if (this.sched.state !== 'playing') {
      this.setStatus('Start playing, then MORPH.', 'warn');
      return;
    }
    const from = this.engine.getPattern(this.engine.playingPatternId());
    const cycles = Math.max(1, Math.round(this.morphBars / Math.max(1, from?.bars ?? 1)));
    this.engine.startMorph(to, cycles);
    this.setStatus(`Morphing to ${target.name} over ${this.morphBars} bars.`);
    this.emit(['ext', 'perf']);
  }

  cancelMorph(): void {
    this.engine.cancelMorph();
    this.emit(['ext', 'perf']);
  }

  // ------------------------------------------------------------------ sound and MIDI

  private onNote(item: NoteItem, ms: number, offMs?: number): void {
    if (this.prefs.output !== 'midi') this.audio.play(item, ms, offMs);
    if (this.take.recording && item.tick >= 0) {
      this.take.notes.push(item);
      this.take.ms.push(ms);
    }
    noteListeners.forEach((f) => f(item, ms));
  }

  auditionVoice(id: string, level = 4, step = 1): void {
    const v = this.project.voices.find((x) => x.id === id);
    if (!v) return;
    void this.ensureAudio().then(() => {
      const t = this.track(id);
      const n = step <= 0 ? Math.floor(Math.random() * v.notes.length) : Math.min(step, v.notes.length) - 1;
      this.sched.audition({ type: 'note', duration: v.gate, channel: v.channel, pitches: v.notes[n] ?? v.notes[0]!, velocity: t.vel.center[level - 1] ?? 100, voice: v.id, sound: v.id, note: v.notes[n] ? n : 0, kind: 'source', level });
    });
  }

  setOutput(o: Prefs['output']): void {
    this.prefs.output = o;
    this.store.savePrefs(this.prefs);
    if (o === 'midi') this.audio.cancel();
    else void this.audio.ensure();
    this.applyRouting();
    if (o !== 'internal' && this.midi.state !== 'ready') void this.enableMidi();
  }

  setVolume(v: number): void {
    this.prefs.volume = clamp(v, 0, 1);
    this.audio.setVolume(this.prefs.volume);
    this.store.savePrefs(this.prefs);
    this.emit(['midi']);
  }

  /** Ask for Web MIDI access and reopen the remembered ports. */
  async enableMidi(): Promise<void> {
    await this.midi.request();
    this.prefs.midiEnabled = this.midi.state === 'ready';
    this.store.savePrefs(this.prefs);
    if (this.midi.state === 'ready') {
      if (this.prefs.midiOut && !this.midi.outputs().some((p) => p.id === this.prefs.midiOut)) this.prefs.midiOut = null;
      if (!this.prefs.midiOut) this.prefs.midiOut = this.midi.outputs().find((p) => p.connected)?.id ?? null;
      this.applyRouting();
      this.openInput();
      this.setStatus(this.midi.outputs().length ? 'MIDI ready.' : 'MIDI ready, but no output devices were found.');
    } else this.setStatus(this.midi.message, 'warn');
    this.emit(['midi']);
  }

  /** Attach the MIDI sink according to the output routing. */
  applyRouting(): void {
    let sink: MidiSink | null = null;
    if (this.prefs.output !== 'internal') sink = this.midi.openOutput(this.prefs.midiOut);
    this.out.setSink(sink);
    this.emit(['midi']);
  }

  selectOutput(id: string | null): void {
    this.prefs.midiOut = id;
    this.store.savePrefs(this.prefs);
    this.applyRouting();
    if (id && this.prefs.output === 'internal') this.setStatus('Output is set to INTERNAL. Choose MIDI or BOTH to send notes to this device.');
  }

  selectInput(id: string | null): void {
    this.prefs.midiIn = id;
    this.store.savePrefs(this.prefs);
    this.openInput();
  }

  private openInput(): void {
    const ok = this.midi.openInput(this.prefs.midiIn, (data, t) => this.onMidiIn(data, t));
    this.sched.setInputReady(ok);
    this.emit(['midi']);
  }

  setClockSource(src: 'internal' | 'external'): void {
    this.sched.setSource(src);
    this.prefs.clockSource = src;
    this.store.savePrefs(this.prefs);
    this.syncStatus = this.sched.syncStatus();
    if (src === 'external' && this.midi.state === 'ready') this.openInput();
    if (src === 'external' && this.midi.state !== 'ready') void this.enableMidi();
    this.emit(['midi', 'transport']);
  }

  setClockOut(on: boolean): void {
    this.prefs.clockOut = on;
    this.sched.clockOutSetting = on;
    this.store.savePrefs(this.prefs);
    this.emit(['midi']);
  }

  private onMidiIn(data: Uint8Array, t: number): void {
    const b0 = data[0] ?? 0;
    if (b0 >= 0xf8 || b0 === 0xf2) {
      this.sched.receive(data, t);
      return;
    }
    if ((b0 & 0xf0) === 0x90 && (data[2] ?? 0) > 0) this.noteIn(b0 & 0x0f, data[1] ?? 0, data[2] ?? 0);
  }

  setVoiceChannel(voiceId: string, channel: number): void {
    const v = this.project.voices.find((x) => x.id === voiceId);
    if (!v) return;
    this.edit(() => (v.channel = clamp(Math.round(channel), 1, 16)), ['voices', 'track', 'midi']);
  }

  /** Set the note (or chord) a voice plays for one of its sound steps (0-based). */
  setVoiceNotes(voiceId: string, step: number, notes: number[]): void {
    const v = this.project.voices.find((x) => x.id === voiceId);
    const clean = notes.map((n) => clamp(Math.round(n), 0, 127)).slice(0, 8);
    if (!v || step < 0 || step >= v.notes.length || !clean.length) return;
    this.edit(() => (v.notes[step] = clean), ['voices', 'track', 'midi']);
  }

  /** Move a voice's step up or down by semitones (every note of a chord moves). */
  shiftVoiceNotes(voiceId: string, step: number, delta: number): void {
    const v = this.project.voices.find((x) => x.id === voiceId);
    const cur = v?.notes[step];
    if (!v || !cur) return;
    if (cur.some((n) => n + delta < 0 || n + delta > 127)) return;
    this.setVoiceNotes(voiceId, step, cur.map((n) => n + delta));
  }

  /** MIDI LEARN: the next note arriving at the MIDI input becomes this voice step's note. */
  startLearn(voiceId: string, step = 0): void {
    if (this.midi.state !== 'ready' || !this.midi.inputReady) {
      this.setStatus('LEARN needs a MIDI input: choose one in the MIDI dialog (INPUT AND SYNC), then press LEARN and hit a pad.', 'warn');
      return;
    }
    this.learn = { voice: voiceId, step };
    this.setStatus(`LEARN: play a note on ${this.midi.inputs().find((p) => p.id === this.prefs.midiIn)?.name ?? 'the MIDI input'} for ${this.voice(voiceId).name}. Press LEARN again to cancel.`);
    this.emit(['midi', 'voices']);
  }

  cancelLearn(): void {
    if (!this.learn) return;
    this.learn = null;
    this.setStatus('LEARN cancelled.');
    this.emit(['midi', 'voices']);
  }

  /** An incoming note: LEARN it, or play the matching voice; with REC armed while playing, write a strike. */
  noteIn(_channel: number, note: number, velocity: number): void {
    if (this.learn) {
      const { voice, step } = this.learn;
      this.learn = null;
      this.setVoiceNotes(voice, step, [note]);
      this.setStatus(`${this.voice(voice).name} now plays note ${note} (${noteName(note)}).`);
      this.auditionVoice(voice, 4, step + 1);
      return;
    }
    const v = this.project.voices.find((x) => x.notes.some((n) => n.includes(note)));
    if (!v) return;
    const level = velocity >= 118 ? 5 : velocity >= 96 ? 4 : velocity >= 64 ? 3 : velocity >= 36 ? 2 : 1;
    this.auditionVoice(v.id, level, v.notes.findIndex((n) => n.includes(note)) + 1);
    if (!this.recArmed || this.sched.state !== 'playing') return;
    const { plan } = this.heard();
    if (!plan || plan.patternId !== this.pattern().id) return;
    const pos = this.sched.positionTick() - plan.startTick;
    const step = Math.round(pos / plan.geo.stepTicks) % plan.geo.steps;
    const tp = plan.pos[v.id]?.[step] ?? step;
    const track = this.pattern().tracks[v.id];
    if (!track) return;
    track.strikes[tp] = { v: level, s: v.notes.findIndex((n) => n.includes(note)) + 1 || 1 };
    this.touch(['pattern']);
  }

  logMidi(s: string): void {
    this.midiLog.push(s);
    if (this.midiLog.length > 30) this.midiLog.shift();
  }

  // ------------------------------------------------------------------ files

  newProject(): void {
    const p = newProject();
    this.loadProjectObject(p, 'New project.');
  }

  openDemo(id: string): void {
    const d = DEMOS.find((x) => x.id === id);
    this.loadProjectObject(demoProject(id), d ? `${d.name}: ${d.blurb}` : 'Demo loaded.');
  }

  saveToLibrary(name?: string): void {
    if (name) this.project.name = name.trim().toUpperCase().slice(0, 40) || this.project.name;
    const ok = this.store.saveToLibrary(this.project);
    this.setStatus(ok ? `Saved "${this.project.name}" in this browser.` : 'This browser would not store the project (storage blocked). Use EXPORT instead.', ok ? 'info' : 'warn');
    this.emit(['library', 'project']);
  }

  openFromLibrary(name: string): void {
    const r = this.store.loadFromLibrary(name);
    if (!r) {
      this.setStatus('Could not read that saved project.', 'warn');
      return;
    }
    this.loadProjectObject(r.project, `Opened "${name}".${r.report.length ? ' ' + r.report.join(' ') : ''}`);
  }

  deleteFromLibrary(name: string): void {
    this.store.removeFromLibrary(name);
    this.emit(['library']);
  }

  exportProject(): void {
    this.downloadFn(fileName(this.project.name), serialize(this.project), 'application/json');
    this.setStatus(`Exported ${fileName(this.project.name)}.`);
  }

  importProjectText(text: string): boolean {
    try {
      const r = parseProject(text);
      this.loadProjectObject(r.project, `Imported "${r.project.name}".${r.report.length ? ' ' + r.report.join(' ') : ''}`);
      return true;
    } catch (e) {
      this.setStatus(e instanceof ProjectError ? e.message : 'Could not read that file.', 'warn');
      return false;
    }
  }

  /** Export MIDI: the written pattern, a rendered performance, the song, or the recorded take. */
  exportMidi(what: 'pattern' | 'performance' | 'song' | 'take', cycles = 8, format: 0 | 1 = 1): void {
    const ppq = PPQ * 4;
    const scale = ppq / PPQ;
    const pr = this.project;
    let notes: NoteItem[] = [];
    let end = 0;
    let bpm = pr.tempo;
    const pat = this.pattern();
    let name = `${pr.name}-${what}`;
    if (what === 'take') {
      if (!this.take.notes.length) {
        this.setStatus('No take recorded yet: press REC TAKE while playing.', 'warn');
        return;
      }
      const t0 = this.take.startTick;
      notes = this.take.notes.map((n) => ({ ...n, tick: n.tick - t0 }));
      end = Math.max(...notes.map((n) => n.tick + n.duration));
      bpm = this.take.tempo;
    } else {
      const copy = structuredClone(pr) as Project;
      if (what === 'song') copy.playMode = 'song';
      else {
        copy.playMode = 'pattern';
        copy.current = pat.id === AUDITION_ID ? copy.current : pat.id;
        if (pat.id === AUDITION_ID) copy.patterns.push(structuredClone(pat));
        if (pat.id === AUDITION_ID) copy.current = AUDITION_ID;
      }
      if (what === 'song') {
        copy.song.loop = false;
        cycles = copy.song.entries.reduce((a, e) => a + e.repeats, 0) || 1;
      }
      const r = renderCycles(copy, cycles, { sourceOnly: what === 'pattern' });
      notes = r.notes;
      end = r.endTick;
      bpm = what === 'song' ? pr.tempo : pat.tempo ?? pr.tempo;
      name = `${pr.name}-${what === 'pattern' ? pat.name : what}`;
    }
    const byVoice = new Map<string, SmfTrack>();
    for (const n of notes) {
      const v = pr.voices.find((x) => x.id === n.sound);
      const key = format === 0 ? 'all' : n.sound;
      let tr = byVoice.get(key);
      if (!tr) {
        tr = { name: format === 0 ? pr.name : v?.name ?? 'VOICE', events: [] };
        byVoice.set(key, tr);
      }
      const ch = (Math.max(1, Math.min(16, n.channel)) - 1) & 15;
      for (const p of n.pitches) {
        tr.events.push({ tick: n.tick * scale, bytes: [0x90 | ch, p, n.velocity] });
        tr.events.push({ tick: (n.tick + n.duration) * scale, bytes: [0x80 | ch, p, 0] });
      }
    }
    const data = writeSmf({ format, ppq, bpm, timeSig: [pat.beats, pat.unit], tracks: [...byVoice.values()], endTick: end * scale });
    this.downloadFn(fileName(name, '.mid'), new Blob([data as BlobPart], { type: 'audio/midi' }), 'audio/midi');
    this.setStatus(`Exported ${fileName(name, '.mid')} (${notes.length} notes).`);
  }

  /** Import a MIDI file into a new pattern: notes are matched to voices by note number. */
  importMidi(data: Uint8Array, name = 'MIDI'): boolean {
    let parsed;
    try {
      parsed = parseSmf(data);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : 'Could not read that MIDI file.', 'warn');
      return false;
    }
    if (!parsed.notes.length) {
      this.setStatus('The MIDI file has no notes.', 'warn');
      return false;
    }
    const [beats, unit] = parsed.timeSig ?? [4, 4];
    const ticksPerBar = (parsed.ppq * 4 * beats) / unit;
    const bars = clamp(Math.ceil((parsed.lastTick + 1) / ticksPerBar), 1, 4);
    const grid = 4;
    const p = makePattern(this.project.voices, name.toUpperCase().slice(0, 16) || 'MIDI', { beats: clamp(beats, 1, 15), unit: [4, 8, 16].includes(unit) ? unit : 4, bars, grid });
    const g = geometry(p);
    while (g.steps > 64 && p.bars > 1) p.bars--;
    const geo = geometry(p);
    const stepFileTicks = (geo.stepTicks / PPQ) * parsed.ppq;
    let placed = 0;
    let unmatched = 0;
    for (const n of parsed.notes) {
      const i = Math.round(n.tick / stepFileTicks);
      if (i >= geo.steps) continue;
      const v = this.project.voices.find((x) => x.notes.some((s) => s.includes(n.note)));
      if (!v) {
        unmatched++;
        continue;
      }
      const t = p.tracks[v.id]!;
      const level = n.velocity >= 118 ? 5 : n.velocity >= 96 ? 4 : n.velocity >= 64 ? 3 : n.velocity >= 36 ? 2 : 1;
      const step = v.notes.findIndex((s) => s.includes(n.note)) + 1;
      const cur = t.strikes[i];
      if (!cur || cur.v < level) t.strikes[i] = { v: level, s: step };
      placed++;
    }
    if (!placed) {
      this.setStatus(`No notes matched this kit's voices (${unmatched} unmatched). Set the voices' notes to match the file.`, 'warn');
      return false;
    }
    for (const t of Object.values(p.tracks)) t.strikes.length = geo.steps;
    if (this.project.patterns.length >= MAX_PATTERNS) return false;
    this.edit(() => {
      this.project.patterns.push(p);
      this.project.current = p.id;
      if (parsed.bpm && this.project.patterns.length === 1) this.project.tempo = Math.round(parsed.bpm);
    }, ['project', 'pattern', 'track', 'song']);
    this.setStatus(`Imported ${placed} notes into ${p.name}${unmatched ? ` (${unmatched} notes had no matching voice)` : ''}.`);
    return true;
  }

  startTake(): void {
    this.take = { recording: true, notes: [], startTick: Math.floor(this.engine.horizon), tempo: this.sched.bpm, ms: [] };
    if (this.sched.state === 'stopped') {
      this.take.startTick = 0;
      this.play();
    }
    this.setStatus('Recording a take: everything that plays, including your changes.');
    this.emit(['perf']);
  }

  stopTake(): void {
    this.take.recording = false;
    this.setStatus(`Take recorded: ${this.take.notes.length} notes. Export it from FILE → MIDI, or as audio (EXPORT AUDIO).`);
    this.emit(['perf']);
  }

  // ------------------------------------------------------------------ samples, processing, audio export

  /** After the audio settings changed or the project was replaced: bring samples and live audio up to date. */
  audioChanged(): void {
    if (this.project.audio) syncAudioShape(this.project.audio, this.project.voices);
    this.library.sync(audioOf(this.project));
    this.audio.sync();
    this.emit(['audio']);
  }

  /** The settings of a drum sound (voice sound step), defaults included. */
  sound(key: string): SoundSlot | null {
    return slotOf(audioOf(this.project), key);
  }

  /** Change a drum sound's settings (undoable). */
  setSound(key: string, fn: (s: SoundSlot) => void, coalesce?: string): void {
    const k = parseSoundKey(key);
    const v = k && this.project.voices.find((x) => x.id === k.voice);
    if (!k || !v || k.step >= v.notes.length) return;
    this.edit(
      () => {
        const slot = ensureAudio(this.project).sounds[k.voice]?.[k.step];
        if (slot) fn(slot);
      },
      ['audio'],
      coalesce && `${key}:${coalesce}`,
    );
    this.audioChanged();
  }

  setSoundSource(key: string, source: SoundSource): void {
    this.setSound(key, (s) => (s.source = source));
  }

  setSoundZone(key: string, patch: Partial<SampleZone>): void {
    this.setSound(key, (s) => (s.zone = { ...s.zone, ...patch }), `zone:${Object.keys(patch).join(',')}`);
  }

  setSoundTransform(key: string, patch: Partial<SampleTransform>): void {
    this.setSound(key, (s) => (s.transform = { ...s.transform, ...patch }), `transform:${Object.keys(patch).join(',')}`);
  }

  setSoundChoke(key: string, patch: Partial<SoundChoke>): void {
    this.setSound(key, (s) => (s.choke = { ...s.choke, ...patch }));
  }

  /** Decode, store and assign a sample file to a drum sound (which then plays SAMPLE). It joins the kit library. */
  async loadSample(key: string, file: { bytes: ArrayBuffer; name: string; type?: string }): Promise<boolean> {
    if (!this.sound(key)) return false;
    try {
      const r = await this.kitLibrary.addSample(file.bytes, file.name, file.type ?? '');
      if (!r.stored) throw new Error('Browser storage is unavailable, so the sample cannot be kept.');
      this.setSound(key, (s) => {
        s.sampleId = r.sample.id;
        s.name = file.name;
        s.source = 'sample';
      });
      const warnings = r.decoded.warnings;
      this.setStatus(`Loaded "${file.name}".${warnings.length ? ' ' + warnings.join(' ') : ''}`, warnings.length ? 'warn' : 'info');
      this.emit(['kits']);
      return true;
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), 'warn');
      return false;
    }
  }

  /** Remove a drum sound's sample: it plays its internal sound again. */
  clearSample(key: string): void {
    this.setSound(key, (s) => {
      s.sampleId = null;
      s.name = '';
      s.source = 'internal';
    });
  }

  /** Play one drum sound now through its voice (processing included). */
  auditionSound(key: string): void {
    void this.audio.ensure().then((ok) => {
      if (!ok) this.setStatus('Audio is not available in this browser.', 'warn');
      else this.audio.audition(key);
    });
  }

  /** Output processing of a sequencer voice (undoable). */
  setVoiceFx(voiceId: string, fx: OutputFxSettings, coalesce?: string): void {
    if (!this.project.voices.some((v) => v.id === voiceId)) return;
    this.edit(() => (ensureAudio(this.project).voiceFx[voiceId] = structuredClone(fx)), ['audio'], coalesce && `fx:${voiceId}:${coalesce}`);
    this.audioChanged();
  }

  /** Master output processing (undoable). */
  setMasterFx(fx: OutputFxSettings, coalesce?: string): void {
    this.edit(() => (ensureAudio(this.project).master = structuredClone(fx)), ['audio'], coalesce && `fx:master:${coalesce}`);
    this.audioChanged();
  }

  /** The OUTPUT CHAIN (undoable, like the master processing). */
  setOutputChain(chain: ChainConfig, coalesce?: string): void {
    this.edit(() => (ensureAudio(this.project).chain = structuredClone(chain)), ['audio'], coalesce && `chain:${coalesce}`);
    this.audioChanged();
  }

  /** Every voice and the master back to CLEAN. */
  clearProcessing(): void {
    if (!this.project.audio) return;
    this.edit(() => {
      const a = ensureAudio(this.project);
      for (const id of Object.keys(a.voiceFx)) a.voiceFx[id] = cleanFx();
      a.master = cleanFx();
    }, ['audio']);
    this.audioChanged();
  }

  /** Add a sound step to a voice (a note one above the last); its drum sound starts INTERNAL. */
  addSoundStep(voiceId = this.sel.voice): void {
    const v = this.project.voices.find((x) => x.id === voiceId);
    if (!v || v.notes.length >= 16) return;
    this.edit(() => {
      v.notes.push([...(v.notes[v.notes.length - 1] ?? [36])].map((n) => Math.min(127, n + 1)));
      if (this.project.audio) syncAudioShape(this.project.audio, this.project.voices);
    }, ['voices', 'track', 'audio']);
    this.audioChanged();
  }

  /** Remove a voice's sound step and its drum sound settings (the steps after it move up). */
  removeSoundStep(voiceId: string, step: number): void {
    const v = this.project.voices.find((x) => x.id === voiceId);
    if (!v || v.notes.length <= 1 || step < 0 || step >= v.notes.length) return;
    this.edit(() => {
      v.notes.splice(step, 1);
      this.project.audio?.sounds[voiceId]?.splice(step, 1);
      if (this.project.audio) syncAudioShape(this.project.audio, this.project.voices);
    }, ['voices', 'track', 'audio']);
    this.audioChanged();
  }

  /** Render audio and download it (a WAV, or a ZIP of several). */
  async exportAudio(opts: AudioExportOptions, onProgress?: (fraction: number, stage: string) => void): Promise<ExportResult | null> {
    if (this.exporting) return null;
    const ac = new AbortController();
    this.exporting = ac;
    this.emit(['audio']);
    try {
      const state = { lockKey: this.engine.lockKey, sourceOnly: this.engine.sourceOnly, audition: this.engine.audition };
      const take = this.take.notes.length ? { notes: this.take.notes, ms: this.take.ms, startTick: this.take.startTick, tempo: this.take.tempo } : null;
      const r = await exportAudio(this.project, this.library, opts, state, take, { workletUrl: this.workletUrl, chainUrl: this.chainWorkletUrl, volume: this.prefs.volume, onProgress, signal: ac.signal });
      this.downloadFn(r.download.name, new Blob([r.download.bytes as BlobPart], { type: r.download.type }), r.download.type);
      const clipped = r.files.filter((f) => f.stats.clipped > 0);
      const unprocessed = (r.renders.some((x) => !x.processed) && this.usesProcessing()) || r.renders.some((x) => !x.chainProcessed);
      this.setStatus(
        `Exported ${r.download.name}: ${r.files.length} WAV file${r.files.length > 1 ? 's' : ''}, ${r.renders[0]!.seconds.toFixed(1)} s.` +
          (clipped.length ? ` ${clipped.length} file${clipped.length > 1 ? 's' : ''} clipped (not normalised): ${clipped.map((f) => f.name).join(', ')}.` : '') +
          (unprocessed ? ' Output processing could not run in this browser, so the files are unprocessed.' : ''),
        clipped.length || unprocessed ? 'warn' : 'info',
      );
      return r;
    } catch (e) {
      this.setStatus(e instanceof RenderCancelled ? 'Audio export cancelled.' : e instanceof Error ? e.message : String(e), 'warn');
      return null;
    } finally {
      this.exporting = null;
      this.emit(['audio']);
    }
  }

  cancelExport(): void {
    this.exporting?.abort();
  }

  /** Whether any voice or the master has output processing switched on. */
  usesProcessing(): boolean {
    const a = this.project.audio;
    if (!a) return false;
    const on = (fx: OutputFxSettings) => !fx.bypass && (fx.outputStage.enabled || fx.drive.enabled || fx.crunch.enabled || fx.tone.enabled || fx.inDb !== 0 || fx.outDb !== 0);
    return on(a.master) || Object.values(a.voiceFx).some(on);
  }

  /** Download a portable bundle: the project and every sample it uses. */
  async downloadBundle(): Promise<void> {
    const b = await makeBundle(this.project, this.library.store);
    this.downloadFn(b.name, new Blob([b.bytes as BlobPart], { type: 'application/zip' }), 'application/zip');
    this.setStatus(`Exported ${b.name}${b.missing.length ? `. Not in this browser, so not included: ${b.missing.join(', ')}.` : '.'}`, b.missing.length ? 'warn' : 'info');
  }

  /** Open a portable bundle: its samples go into this browser's storage, then the project opens. */
  async openBundle(bytes: Uint8Array): Promise<boolean> {
    try {
      const r = await unpackBundle(bytes, this.library.store);
      const loaded = parseProject(r.projectText);
      this.library.retry();
      this.loadProjectObject(loaded.project, `Opened bundle "${loaded.project.name}" (${r.stored} sample${r.stored === 1 ? '' : 's'}).${[...loaded.report, ...r.problems].length ? ' ' + [...loaded.report, ...r.problems].join(' ') : ''}`);
      return true;
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : 'Could not read that bundle.', 'warn');
      return false;
    }
  }

  /** Samples this project, the autosave or a saved project uses (never deleted from the kit library). */
  samplesInUse(): Set<string> {
    const keep = new Set(referencedSamples(this.project.audio));
    const autosave = this.store.loadAutosave();
    for (const id of referencedSamples(autosave?.project.audio)) keep.add(id);
    for (const e of this.store.library()) for (const id of referencedSamples(this.store.loadFromLibrary(e.name)?.project.audio)) keep.add(id);
    return keep;
  }

  /** Delete stored samples that neither this project, the autosave, any saved project nor any saved kit uses. */
  async purgeSamples(): Promise<number> {
    const store = this.library.store;
    if (!store) return 0;
    const keep = this.samplesInUse();
    for (const k of await this.kitLibrary.listKits()) for (const i of (await this.kitLibrary.getKit(k.id))?.instruments ?? []) for (const r of i.samples) keep.add(r.sample);
    let n = 0;
    for (const m of await store.list()) {
      if (keep.has(m.id)) continue;
      await store.delete(m.id);
      this.library.forget(m.id);
      n++;
    }
    // and their entries in the kit library's index
    if (this.kitLibrary.persistent) await this.kitLibrary.removeUnused().catch(() => 0);
    this.setStatus(n ? `Deleted ${n} unused sample${n > 1 ? 's' : ''} from this browser.` : 'No unused samples.');
    this.emit(['audio', 'kits']);
    return n;
  }

  // ------------------------------------------------------------------ kits

  /**
   * Start the kit library: index the samples existing projects use (their audio is already
   * stored; nothing is copied or changed), install bundled kits, and take the kit last used as
   * the current one. The project's own sounds are never replaced at startup.
   */
  private async startKits(): Promise<void> {
    try {
      const r = await migrateOnce(this.kitLibrary, 'downbeat-samples-v1', async (m) => {
        const names = new Map<string, string>();
        const projects = [this.project, this.store.loadAutosave()?.project, ...this.store.library().map((e) => this.store.loadFromLibrary(e.name)?.project)];
        for (const p of projects) for (const slots of Object.values(p?.audio?.sounds ?? {})) for (const sl of slots) if (sl.sampleId && !names.has(sl.sampleId)) names.set(sl.sampleId, sl.name);
        for (const [id, name] of names) await m.step(id, async () => void (await this.kitLibrary.indexSample(id, { name: name || 'sample' })));
      });
      await installBundledKits(this.kitLibrary, BUNDLED_KITS);
      await this.kits.resume();
      if (r.error) this.setStatus(`The kit library could not index existing samples yet (it will try again): ${r.error}`, 'warn');
    } catch (e) {
      this.setStatus(`The kit library is unavailable: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    }
  }

  /**
   * Apply a kit's drum sound settings: every sample decodes first (a missing or broken one
   * changes nothing), then one undoable edit. Voices, patterns, mixer and MIDI are untouched.
   */
  async applyKitSounds(sounds: Map<string, SoundSlot>, label: string): Promise<void> {
    for (const s of sounds.values()) if (s.sampleId) await this.kitLibrary.decoded(s.sampleId, s.name);
    this.edit(
      () => {
        const a = ensureAudio(this.project);
        for (const [key, slot] of sounds) {
          const k = parseSoundKey(key);
          if (k && a.sounds[k.voice]?.[k.step]) a.sounds[k.voice]![k.step] = slot;
        }
      },
      ['audio'],
    );
    this.audioChanged();
    this.setStatus(`Kit: ${label} (${sounds.size} drum sound${sounds.size === 1 ? '' : 's'} changed; patterns, voices, mixer and MIDI unchanged). UNDO reverts it.`);
  }

  /** Assign a sample already in the library to a drum sound (no second import). */
  async assignLibrarySample(key: string, sampleId: string): Promise<boolean> {
    if (!this.sound(key)) return false;
    const info = await this.kitLibrary.getSample(sampleId);
    if (!info) return false;
    try {
      await this.kitLibrary.decoded(sampleId, info.name);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), 'warn');
      return false;
    }
    this.setSound(key, (s) => {
      s.sampleId = sampleId;
      s.name = info.name.slice(0, 120);
      s.source = 'sample';
    });
    this.setStatus(`Assigned "${info.name}".`);
    return true;
  }

  /** Import sample files into the kit library (without assigning them). */
  async importSamples(files: { name: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> }[]): Promise<number> {
    const r = await this.kitLibrary.importFiles(files, (done, total) => total > 3 && this.setStatus(`Importing samples… ${done} / ${total}`));
    const parts = [`Imported ${r.added.length} sample${r.added.length === 1 ? '' : 's'}.`];
    if (r.duplicates.length) parts.push(`${r.duplicates.length} already in the library.`);
    if (r.errors.length) parts.push(`Not imported: ${r.errors.map((e) => `${e.name} (${e.message})`).join('; ')}`);
    if (r.added.some((a) => !a.stored)) parts.push('Browser storage is unavailable: they last until the page is closed.');
    this.setStatus(parts.join(' '), r.errors.length ? 'warn' : 'info');
    this.emit(['kits']);
    return r.added.length;
  }

  /** Hear a library sample now, on its own (never through the sequencer or a voice). */
  async previewSample(sampleId: string): Promise<void> {
    const info = await this.kitLibrary.getSample(sampleId);
    try {
      if (!(await this.audition.playSample(this.kitLibrary, sampleId, { name: info?.name }))) this.setStatus('Audio is not available in this browser.', 'warn');
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  // ------------------------------------------------------------------ palette

  applyPalette(): void {
    applyPalette(this.palettes.current());
    this.emit(['palette']);
  }

  download(name: string, data: Blob | string, type: string): void {
    this.downloadFn(name, data, type);
  }
}

/** Global note listeners (the grid's label flashes). */
export const noteListeners = new Set<(item: NoteItem, ms: number) => void>();

function safeLocalStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__downbeat__', '1');
    s.removeItem('__downbeat__');
    return s;
  } catch {
    return null;
  }
}

function browserDownload(name: string, data: Blob | string, type: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

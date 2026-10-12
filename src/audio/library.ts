/**
 * DOWNBEAT's sample library: turns the drum sounds' sample assignments into playable Slop
 * Factory Core sample instruments (Core's sample engine; DOWNBEAT has no player of its own).
 *
 * For each drum sound with a sample it fetches the original bytes from browser storage,
 * decodes them once per sample (shared by every sound using that sample), applies the sound's
 * sample transformation through Core's cache (an expensive stretch runs once per sample and
 * settings, in a Worker), and keeps one AudioBuffer per (sample, transformation). Live
 * playback and offline export use the same instruments and buffers.
 */
import { syncRunner, TransformCache, transformKey, type AudioData, type TransformRunner } from '@slopfactory/core/dsp';
import { decodeSample, SampleError, SampleInstrument, toAudioBuffer, type DecodedSample } from '@slopfactory/core/sampler';
import { sampleFromBytes, StorageError, type SampleStore } from '@slopfactory/core/storage';
import { soundKey, type ProjectAudio, type SoundSlot } from './settings';

export type SlotStatus = 'empty' | 'loading' | 'processing' | 'ready' | 'missing' | 'error';

export interface SlotState {
  status: SlotStatus;
  /** length of the (transformed) audio in seconds */
  duration: number;
  /** of the original sample */
  sampleRate: number;
  channels: number;
  message: string;
  instrument: SampleInstrument | null;
  /** the audio the instrument plays (after transformation), for the waveform */
  audio: AudioData | null;
  /** sample id and transformation this state was built for */
  key: string;
}

const blank = (status: SlotStatus = 'empty', message = '', key = ''): SlotState => ({ status, duration: 0, sampleRate: 0, channels: 0, message, instrument: null, audio: null, key });

export interface LibraryDeps {
  store: SampleStore | null;
  runner?: TransformRunner;
  /** AudioBuffer factory (tests replace it) */
  makeBuffer?: (audio: AudioData) => AudioBuffer;
  decode?: (bytes: ArrayBuffer, name: string) => Promise<DecodedSample>;
}

export interface LoadedSample {
  id: string;
  name: string;
  warnings: string[];
}

export class SampleLibrary {
  private decoded = new Map<string, Promise<DecodedSample>>();
  private buffers = new Map<string, Promise<{ buffer: AudioBuffer; audio: AudioData }>>();
  private states = new Map<string, SlotState>();
  private pending = new Set<Promise<unknown>>();
  readonly transforms: TransformCache;
  onChange: () => void = () => {};

  constructor(private deps: LibraryDeps) {
    this.transforms = new TransformCache(deps.runner ?? syncRunner);
  }

  get store(): SampleStore | null {
    return this.deps.store;
  }

  /** The state of a drum sound's sample (by sound key). */
  state(key: string): SlotState {
    return this.states.get(key) ?? blank();
  }

  private decodeFn(bytes: ArrayBuffer, name: string): Promise<DecodedSample> {
    return (this.deps.decode ?? ((b, n) => decodeSample(b, n)))(bytes, name);
  }

  /** Decode, validate and store a user file. Throws SampleError or StorageError with a message for the user. */
  async importFile(bytes: ArrayBuffer, name: string, type = ''): Promise<LoadedSample> {
    const decoded = await this.decodeFn(bytes, name);
    const stored = await sampleFromBytes(bytes, name, type);
    if (!this.deps.store) throw new StorageError('unavailable', 'Browser storage is unavailable, so the sample cannot be kept.');
    await this.deps.store.put(stored);
    this.decoded.set(stored.id, Promise.resolve(decoded));
    return { id: stored.id, name, warnings: decoded.warnings };
  }

  private decodedSample(id: string, name: string): Promise<DecodedSample> {
    let p = this.decoded.get(id);
    if (!p) {
      p = (async () => {
        const s = await this.deps.store?.get(id);
        if (!s) throw new SampleError('empty', 'missing');
        return this.decodeFn(s.bytes, s.name || name);
      })();
      this.decoded.set(id, p);
      p.catch(() => this.decoded.delete(id));
    }
    return p;
  }

  private buffer(id: string, slot: SoundSlot, decoded: DecodedSample) {
    const key = `${id}|${transformKey(slot.transform)}`;
    let p = this.buffers.get(key);
    if (!p) {
      p = this.transforms.get(id, decoded, slot.transform).then((audio) => ({ audio, buffer: (this.deps.makeBuffer ?? toAudioBuffer)(audio) }));
      this.buffers.set(key, p);
      p.catch(() => this.buffers.delete(key));
    }
    return p;
  }

  /** Bring every drum sound up to date with the project's settings. Cheap when nothing changed. */
  sync(audio: ProjectAudio): void {
    const seen = new Set<string>();
    for (const [voice, slots] of Object.entries(audio.sounds)) {
      slots.forEach((slot, step) => {
        const k = soundKey(voice, step);
        seen.add(k);
        this.syncOne(k, slot);
      });
    }
    for (const k of [...this.states.keys()]) {
      if (!seen.has(k)) {
        this.states.delete(k);
        this.onChange();
      }
    }
  }

  private syncOne(k: string, slot: SoundSlot): void {
    const st = this.state(k);
    if (!slot.sampleId) {
      if (st.status !== 'empty') {
        this.states.set(k, blank());
        this.onChange();
      }
      return;
    }
    const id = slot.sampleId;
    const key = `${id}|${transformKey(slot.transform)}`;
    if (st.key === key && st.status === 'ready' && st.instrument) {
      st.instrument.zone = slot.zone;
      return;
    }
    if (st.key === key && st.status !== 'empty') return;
    const loading = blank(this.transforms.has(id, slot.transform) || !slot.transform.enabled ? 'loading' : 'processing', '', key);
    this.states.set(k, loading);
    const job = (async () => {
      try {
        const decoded = await this.decodedSample(id, slot.name);
        const { buffer, audio: a } = await this.buffer(id, slot, decoded);
        if (this.states.get(k) !== loading) return;
        const instrument = new SampleInstrument(buffer, slot.zone);
        this.states.set(k, { status: 'ready', duration: buffer.duration, sampleRate: decoded.sampleRate, channels: decoded.channels.length, message: decoded.warnings.join(' '), instrument, audio: a, key });
      } catch (e) {
        if (this.states.get(k) !== loading) return;
        const missing = e instanceof SampleError && e.message === 'missing';
        this.states.set(k, blank(missing ? 'missing' : 'error', missing ? `"${slot.name}" is not in this browser's storage. Load it again, or open the project's bundle.` : e instanceof Error ? e.message : String(e), key));
      } finally {
        this.onChange();
      }
    })();
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
    this.onChange();
  }

  /** Resolves when every sound has finished loading or processing. */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** The playable sample instrument of a drum sound, or null (none, missing, failed, still loading). */
  instrument(key: string): SampleInstrument | null {
    const s = this.states.get(key);
    return s?.status === 'ready' ? s.instrument : null;
  }

  /** Try again for sounds whose sample was missing or failed (after importing samples). */
  retry(): void {
    for (const [k, st] of this.states) if (st.status === 'missing' || st.status === 'error') this.states.set(k, blank());
  }

  /** Forget decoded audio for a sample (after it is deleted from storage). */
  forget(id: string): void {
    this.decoded.delete(id);
    for (const k of [...this.buffers.keys()]) if (k.startsWith(`${id}|`)) this.buffers.delete(k);
    this.transforms.drop(id);
  }
}

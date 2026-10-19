/** Top bar: transport, tempo, position, mode, routing, sync and menus. */
import type { App } from '../app/app';
import { button, h, seg, stepper, toggle, type Refreshers } from './dom';

const SYNC_LABEL: Record<string, string> = {
  internal: 'INT',
  'no-input': 'NO INPUT',
  waiting: 'WAITING',
  clock: 'CLOCK',
  running: 'RUNNING',
  stopped: 'STOPPED',
  lost: 'LOST',
};

export class TopBar {
  readonly el: HTMLElement;
  private r: Refreshers = [];
  private pos = h('div', { class: 'pos', testid: 'position', help: 'Bar . beat . step of the cycle being heard, and the cycle number' });
  private playBtn: HTMLButtonElement;
  private syncChip = h('span', { class: 'chip', testid: 'sync-status' });
  private midiChip = h('span', { class: 'chip', testid: 'midi-status' });

  constructor(private app: App, menus: { file: () => void; midi: () => void; palette: () => void; help: () => void; samples: () => void; kits: () => void }) {
    this.playBtn = button('PLAY', () => app.togglePlay(), { cls: 'big playbtn', help: 'Play / pause (Return). Pause keeps the position; CONTINUE carries on from there. The space bar plays and stops.', testid: 'play' });
    const stop = button('STOP', () => app.stop(), { cls: 'big', help: 'Stop and return to the start (Esc). All notes are released.', testid: 'stop' });
    const panic = button('PANIC', () => app.panic(), { cls: 'warn', help: 'All notes off on every MIDI channel', testid: 'panic' });
    const tempo = stepper(this.r, { label: 'BPM', min: 20, max: 300, get: () => Math.round(app.sched.external ? app.sched.pulses.bpm() ?? app.project.tempo : app.project.tempo), set: (b) => app.setTempo(b), help: 'Tempo in beats per minute (ignored while following external clock)', testid: 'tempo' });
    const mode = h(
      'div',
      { class: 'group mode' },
      seg(this.r, {
        options: [
          [false as unknown as string, 'CLASSIC'],
          [true as unknown as string, 'EXTENDED'],
        ] as never,
        get: () => app.ext as never,
        set: (v) => app.setMode(v as unknown as boolean),
        helps: { false: 'CLASSIC: UpBeat-style rhythm transformation only', true: 'EXTENDED: probability, groove, Euclid, evolution, breeding, morphing, rules, autopilot' },
        testid: 'mode',
      }),
    );
    // seg uses String(value) for test ids: give them readable names.
    mode.querySelectorAll('button').forEach((b, i) => (b.dataset.testid = i === 0 ? 'mode-classic' : 'mode-extended'));
    const out = seg(this.r, {
      label: 'OUT',
      options: [
        ['internal', 'INT'],
        ['midi', 'MIDI'],
        ['both', 'BOTH'],
      ] as const,
      get: () => app.prefs.output,
      set: (o) => app.setOutput(o),
      helps: { internal: 'Internal sounds only', midi: 'MIDI output only', both: 'Internal sounds and MIDI' },
      testid: 'output',
    });
    const clockOut = toggle(this.r, { label: 'CLK OUT', get: () => app.prefs.clockOut && !app.sched.external, set: (on) => app.setClockOut(on), help: 'Send MIDI Clock (24 per quarter) and Start / Stop / Continue on the MIDI output', testid: 'clock-out' });
    const brand = h('div', { class: 'brand' }, h('span', { class: 'word', 'aria-label': 'DOWNBEAT' }, h('b', { text: 'D' }), 'OWNBEAT'), h('span', { class: 'sub', text: 'intelligent rhythm machine' }));
    this.el = h(
      'header',
      { class: 'top' },
      brand,
      h('div', { class: 'group transport' }, this.playBtn, stop),
      tempo,
      this.pos,
      mode,
      h('span', { class: 'spacer' }),
      out,
      h('div', { class: 'group' }, h('span', { class: 'lab', text: 'SYNC' }), this.syncChip),
      h('div', { class: 'group' }, clockOut, button('MIDI', menus.midi, { help: 'MIDI devices, clock and routing', testid: 'open-midi' }), this.midiChip),
      panic,
      h('div', { class: 'group' }, button('AUDIO', menus.samples, { help: 'Samples, output processing and audio (WAV) export', testid: 'open-audio' }), button('KITS', menus.kits, { help: 'Saved kits, kit files (shared with The Breakery) and the sample library', testid: 'open-kits' })),
      h('div', { class: 'group' }, button('FILE', menus.file, { help: 'New, demos, save, open, export and import (projects and MIDI files)', testid: 'open-file' }), button('PALETTE', menus.palette, { help: 'Colour palettes', testid: 'open-palette' }), button('?', menus.help, { help: 'Help and about DOWNBEAT', testid: 'open-help' })),
    );
    app.on(['transport', 'tempo', 'midi', 'mode', 'project'], () => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const app = this.app;
    for (const f of this.r) f();
    const st = app.transport;
    this.playBtn.textContent = st === 'playing' ? 'PAUSE' : st === 'paused' ? 'CONTINUE' : 'PLAY';
    this.playBtn.classList.toggle('on', st === 'playing');
    this.playBtn.disabled = app.sched.external;
    document.body.dataset.transport = st;
    const s = app.syncStatus;
    this.syncChip.textContent = s === 'internal' ? 'INT' : `EXT ${SYNC_LABEL[s] ?? s}`;
    this.syncChip.className = `chip${s === 'running' ? ' run' : s === 'lost' ? ' lost' : s === 'internal' ? ' dim' : ''}`;
    const m = app.midi;
    const outName = m.outputs().find((p) => p.id === app.prefs.midiOut)?.name;
    this.midiChip.textContent = m.state === 'ready' ? (app.outputLost ? 'OUT LOST' : outName ? outName.slice(0, 14) : 'NO OUTPUT') : m.state === 'unsupported' ? 'NO WEB MIDI' : m.state === 'denied' ? 'DENIED' : 'OFF';
    this.midiChip.className = `chip${app.outputLost ? ' lost' : m.state === 'ready' && outName ? '' : ' dim'}`;
  }

  /** Position readout (every frame). */
  frame(): void {
    const { plan, tick, playing } = this.app.heard();
    if (!plan || !playing) {
      this.pos.textContent = '1.1.1  ·  –';
      return;
    }
    const g = plan.geo;
    const rel = Math.max(0, tick - plan.startTick);
    const step = Math.min(g.steps - 1, Math.floor(rel / g.stepTicks));
    const bar = Math.floor(step / g.stepsPerBar) + 1;
    const beat = Math.floor((step % g.stepsPerBar) / g.grid) + 1;
    const sub = (step % g.grid) + 1;
    this.pos.textContent = `${bar}.${beat}.${sub}  ·  C${plan.index + 1}`;
  }
}

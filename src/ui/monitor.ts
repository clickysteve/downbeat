/**
 * Right column: the performance monitor. It makes the engine visible: which
 * pattern, cycle and generation is playing, morph progress, the autopilot
 * section, and a running feed of every fill, mutation, rule and section
 * change as it is heard. Below it, the performance controls.
 */
import type { App } from '../app/app';
import { button, clear, h, slider, toggle, type Refreshers } from './dom';

export class MonitorView {
  readonly el: HTMLElement;
  private now = h('dl', { class: 'now', testid: 'now' });
  private feed = h('div', { class: 'feed', testid: 'feed', 'aria-live': 'off' });
  private morph = h('div', { class: 'bar-prog', hidden: true, testid: 'monitor-morph' }, h('i'));
  private r: Refreshers = [];
  private macro: HTMLElement;
  private shownFeed = -1;
  private nowSig = '';

  constructor(private app: App) {
    const perf = h(
      'div',
      { class: 'perf' },
      button('NEW VARIATION', () => app.newVariation(), { help: 'A new seed: every fill, density choice and mutation changes (N)', testid: 'new-variation' }),
      button('REPLAY', () => app.replay(), { help: 'Restart from the beginning with the same seed: the identical take (R)', testid: 'replay' }),
      toggle(this.r, { label: 'SOURCE', get: () => app.engine.sourceOnly, set: () => app.toggleSource(), help: 'A/B: hear only the written pattern, nothing generated or suppressed (S)', testid: 'source' }),
      toggle(this.r, { label: 'LOCK', get: () => app.engine.lockKey !== null, set: () => app.toggleLock(), help: 'Lock the variation you hear: every cycle repeats it (L)', testid: 'lock' }),
      button('CAPTURE', () => app.captureVariation(), { help: 'Write the variation you hear into a new pattern (C)', testid: 'capture-variation' }),
      toggle(this.r, { label: 'REC TAKE', get: () => app.take.recording, set: (on) => (on ? app.startTake() : app.stopTake()), help: 'Record everything that plays (with your changes) for MIDI export', testid: 'rec-take' }),
    );
    this.macro = h(
      'div',
      { class: 'macro' },
      toggle(this.r, { label: 'AUTOPILOT', get: () => app.project.ext.features.auto, set: (on) => app.setExt((x) => (x.features.auto = on)), help: 'Leave DOWNBEAT running: it fills, thins, varies and returns home', testid: 'auto-on' }),
      slider(this.r, { label: 'ACTIVITY', min: 0, max: 100, get: () => app.project.ext.activity, set: (x) => app.setExt((y) => (y.activity = x)), help: 'One control for how much the autopilot changes things', testid: 'macro-activity' }),
    );
    const seed = h('input', { type: 'text', class: 'num', 'aria-label': 'seed', testid: 'seed', style: 'width:100px' });
    seed.addEventListener('change', () => app.setSeed(Number(seed.value) || 1));
    seed.addEventListener('keydown', (e) => e.stopPropagation());
    this.r.push(() => {
      if (document.activeElement !== seed) seed.value = String(app.project.seed);
    });
    this.el = h(
      'div',
      { class: 'col right' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-t' }, h('span', { text: 'NOW PLAYING' })), h('div', { class: 'panel-b' }, this.now, this.morph)),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-t' }, h('span', { text: 'PERFORM' })),
        h('div', { class: 'panel-b' }, perf, h('div', { class: 'ctl', help: 'The seed decides every random choice. The same seed replays the same performance.', style: 'margin-top:6px' }, h('span', { class: 'lab', text: 'SEED' }), seed), this.macro),
      ),
      h('div', { class: 'panel' }, h('div', { class: 'panel-t' }, h('span', { text: 'WHAT CHANGED' }), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'tiny', text: 'CLEAR', on: { click: () => ((app.feed = []), app.emit(['feed'])) } })), this.feed),
    );
    app.on(['perf', 'mode', 'ext', 'project', 'transport'], () => this.refresh());
    app.on(['feed'], () => this.drawFeed());
    this.refresh();
  }

  refresh(): void {
    for (const f of this.r) f();
    this.macro.hidden = !this.app.ext;
    this.drawFeed();
  }

  private drawFeed(): void {
    const f = this.app.feed;
    if (f.length === this.shownFeed && f.length) return;
    this.shownFeed = f.length;
    clear(this.feed);
    if (!f.length) this.feed.append(h('div', {}, h('span', { class: 'c', text: '' }), h('span', { text: this.app.transport === 'stopped' ? 'Press PLAY. Fills, mutations, rules and sections appear here as you hear them.' : '…' })));
    for (const l of f.slice(-60)) this.feed.append(h('div', { class: `k-${l.kind}` }, h('span', { class: 'c', text: `C${l.cycle}` }), h('span', { text: l.text })));
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  /** Called every frame. */
  frame(): void {
    const app = this.app;
    const { plan, real, playing } = app.heard();
    const pat = plan ? app.engine.getPattern(plan.patternId) : null;
    let fills = 0;
    let sup = 0;
    if (real) {
      for (const s of Object.values(real.stats)) {
        fills += s.generated;
        sup += s.written - s.played;
      }
    }
    const m = plan?.morph;
    const auto = app.ext && app.project.ext.features.auto ? [...app.feed].reverse().find((l) => l.kind === 'auto')?.text.replace(/^AUTO /, '') ?? '…' : null;
    const items: [string, string][] = [
      ['PATTERN', pat ? `${pat.name}${plan?.song ? ` (${plan.song.entry + 1}: ${plan.song.repeat + 1}/${plan.song.of})` : ''}` : '–'],
      ['CYCLE', playing && plan ? `${plan.index + 1} · REPEAT ${plan.rep + 1}` : 'STOPPED'],
      ['GENERATION', plan && app.ext && pat?.evolve.on ? (pat.evolve.locked ? `${plan.generation} LOCKED` : plan.generation ? String(plan.generation) : 'SOURCE') : '–'],
      ['THIS CYCLE', real ? `${fills} GENERATED · ${sup} SUPPRESSED` : '–'],
      ['MODE', `${app.ext ? 'EXTENDED' : 'CLASSIC'}${app.engine.sourceOnly ? ' · SOURCE' : ''}${app.engine.lockKey !== null ? ' · LOCKED' : ''}`],
    ];
    if (auto) items.push(['AUTOPILOT', auto]);
    if (m) items.push(['MORPH', `${Math.round(m.t * 100)}%`]);
    const sig = items.map((i) => i.join(':')).join('|');
    if (sig !== this.nowSig) {
      this.nowSig = sig;
      clear(this.now);
      for (const [k, v] of items) this.now.append(h('dt', { text: k }), h('dd', { text: v, testid: `now-${k.toLowerCase().replace(/\s+/g, '-')}` }));
      this.morph.hidden = !m;
      if (m) (this.morph.firstChild as HTMLElement).style.width = `${Math.round(m.t * 100)}%`;
    }
  }
}

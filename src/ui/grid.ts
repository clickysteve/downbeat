/**
 * The rhythm ledger: voices down the side, steps across, and for every cell
 * what was written and what the performance is doing with it.
 *
 *   SOURCE      a solid bar; its height is the striker (accents carry a cap)
 *   SUPPRESSED  the same bar hollow and struck through (density, probability,
 *               rules, mutation) for the cycle being heard
 *   GENERATED   diamonds where fills land (placed within the cell by timing),
 *               dots for extra hits, hatched bars for strikes a mutation or
 *               morph added, outlined bars for strikes it changed
 *   PLAYHEAD    the column now playing, and a frame on each row's own position
 *               (rows with their own loop length show their own playhead)
 *
 * The grid shows the cycle being heard while playing, and a preview of the
 * next performance while stopped.
 */
import type { App } from '../app/app';
import { noteListeners } from '../app/app';
import type { CyclePlan } from '../engine/plan';
import type { Realization } from '../engine/realize';
import { geometry, type Pattern, type Strike } from '../engine/types';
import { noteName } from '../midi/messages';
import { clear, h } from './dom';

interface RowRefs {
  id: string;
  label: HTMLElement;
  cells: HTMLElement[];
  sigs: string[];
  right: HTMLElement;
  rph: number;
  flashUntil: number;
}

const SUPPRESS_TEXT: Record<string, string> = {
  density: 'thinned by DENSITY',
  prob: 'skipped by PROBABILITY',
  mutation: 'removed by MUTATION',
  morph: 'faded out by MORPH',
  rule: 'thinned by a RULE / AUTOPILOT',
};

export class GridView {
  readonly el: HTMLElement;
  private banner = h('div', { class: 'banner', hidden: true, testid: 'grid-banner' });
  private wrap = h('div', { class: 'gridwrap' });
  private grid = h('div', { class: 'grid', testid: 'grid' });
  private head: HTMLElement[] = [];
  private rows: RowRefs[] = [];
  private sig = '';
  private paintSig = '';
  private phStep = -1;
  private drag: { action: 'paint' | 'erase' | 'flam' | 'prob'; seen: Set<string> } | null = null;
  private pending: { voice: string; ms: number }[] = [];
  private followBtn = h('button', {
    type: 'button',
    class: 'tiny follow',
    text: 'FOLLOW',
    testid: 'follow',
    help: 'FOLLOW on: the grid shows the pattern the song is playing and scrolls with the playhead. Off: the grid stays on the pattern you chose.',
    on: { click: () => this.app.setFollow(!this.app.prefs.follow) },
  });

  constructor(private app: App) {
    this.el = h(
      'div',
      { class: 'panel', testid: 'grid-panel' },
      h('div', { class: 'panel-t' }, h('span', { text: 'RHYTHM', testid: 'grid-title' }), h('span', { class: 'sp' }), h('span', { class: 'gtitle-r', testid: 'grid-info' }), this.followBtn),
      this.banner,
      this.wrap,
      this.legend(),
    );
    this.wrap.append(this.grid);
    this.grid.addEventListener('pointerdown', (e) => this.down(e));
    this.grid.addEventListener('pointermove', (e) => this.move(e));
    const end = () => {
      if (this.drag) this.drag = null;
    };
    this.grid.addEventListener('pointerup', end);
    this.grid.addEventListener('pointercancel', end);
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
    app.on(['pattern', 'voices', 'project', 'selection', 'mode', 'perf', 'ext', 'track'], () => this.render());
    noteListeners.add((item, ms) => {
      if (item.tick >= 0 || item.cycle === -1) this.pending.push({ voice: item.voice, ms });
      if (this.pending.length > 256) this.pending.splice(0, this.pending.length - 256);
    });
    new ResizeObserver(() => this.fit()).observe(this.wrap);
    this.render();
  }

  private legend(): HTMLElement {
    const sw = (inner: HTMLElement, label: string, help: string) => h('span', { help }, h('i', { class: 'sw' }, inner), label);
    return h(
      'div',
      { class: 'legend' },
      sw(h('i', { class: 'hit', style: '--lv:3' }), 'source', 'Strikes you wrote, playing this cycle'),
      sw(h('i', { class: 'hit acc', style: '--lv:5' }), 'accent', 'Striker 5: accent'),
      sw(h('i', { class: 'hit sup', style: '--lv:3' }), 'suppressed', 'Written, but not playing this cycle (density, probability, rules, mutation)'),
      sw(h('i', { class: 'g' }), 'generated', 'Added by fills, extra hits or jam: never written into your pattern'),
      sw(h('i', { class: 'hit added', style: '--lv:3' }), 'mutated', 'Added or changed by evolution, mutation or morph'),
      h('span', { help: 'The step now playing; a frame marks each row\'s own loop position' }, h('i', { class: 'sw', style: 'border:2px solid var(--play)' }), 'playhead'),
    );
  }

  /** Fit the cell width to the available space. */
  private fit(): void {
    const steps = geometry(this.app.pattern()).steps;
    const label = window.innerWidth <= 760 ? 124 : 168;
    const avail = this.wrap.clientWidth - label - 46;
    const cell = Math.max(18, Math.min(40, Math.floor(avail / Math.max(1, steps))));
    this.grid.style.setProperty('--cell', `${cell}px`);
  }

  private structureSig(p: Pattern): string {
    const v = this.app.project.voices.map((x) => `${x.id}:${x.name}:${x.color}`).join('|');
    return `${p.id}:${p.beats}/${p.unit}x${p.bars}g${p.grid}:${v}`;
  }

  render(): void {
    const p = this.app.pattern();
    const s = this.structureSig(p);
    if (s !== this.sig) {
      this.sig = s;
      this.build(p);
      this.fit();
    }
    this.paintSig = '';
    this.frame(true);
  }

  private build(p: Pattern): void {
    clear(this.grid);
    this.rows = [];
    const g = geometry(p);
    const nums = h('div', { class: 'steps' });
    this.head = [];
    for (let i = 0; i < g.steps; i++) {
      const bar = i % g.stepsPerBar === 0;
      const beat = i % g.grid === 0;
      const n = h('div', { class: `snum${bar ? ' bar' : beat ? ' beat' : ''}`, text: bar ? String(i / g.stepsPerBar + 1) : beat ? '·' : '' });
      this.head.push(n);
      nums.append(n);
    }
    this.grid.append(h('div', { class: 'ghead' }, h('div', { class: 'lh' }), nums, h('div', { class: 'rh' })));
    for (const v of this.app.project.voices) {
      const name = h('button', { type: 'button', class: 'name', text: v.name, testid: `voice-${v.name}`, help: `${v.name}: click to select and hear it. Notes ${v.notes.map((n) => n.map(noteName).join('+')).join(', ')} on channel ${v.channel}.`, on: { click: () => this.app.selectVoice(v.id) } });
      const ms = (k: string, text: string, help: string, fn: () => void) => h('button', { type: 'button', class: 'ms tiny', 'data-k': k, text, help, testid: `${k}-${v.name}`, on: { click: fn } });
      const jam = h('button', { type: 'button', class: 'ms tiny', 'data-k': 'j', text: 'J', testid: `j-${v.name}`, help: 'JAM: hold for a continuous roll on this voice (Shift: echo the fill-sound voice\'s rhythm)' });
      const stopJam = () => this.app.setJam(v.id, null);
      jam.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        jam.setPointerCapture(e.pointerId);
        this.app.setJam(v.id, e.shiftKey ? 'echo' : 'roll');
        void this.app.ensureAudio();
      });
      jam.addEventListener('pointerup', stopJam);
      jam.addEventListener('pointercancel', stopJam);
      const label = h('div', { class: 'vl', style: `--vc: var(--v${v.color + 1})`, 'data-voice': v.id }, h('span', { class: 'tag' }), name, ms('m', 'M', 'Mute', () => this.app.toggleMute(v.id)), ms('s', 'S', 'Solo', () => this.app.toggleSolo(v.id)), jam);
      const row = h('div', { class: 'row', 'data-voice': v.id });
      const cells: HTMLElement[] = [];
      for (let i = 0; i < g.steps; i++) {
        const bar = i % g.stepsPerBar === 0;
        const beat = i % g.grid === 0;
        const alt = Math.floor(i / g.grid) % 2 === 1;
        const c = h('div', { class: `cell${bar ? ' bar' : beat ? ' beat' : ''}${alt ? ' alt' : ''}`, 'data-step': i, 'data-voice': v.id, testid: `cell-${v.name}-${i}` });
        cells.push(c);
        row.append(c);
      }
      const right = h('div', { class: 'rr', 'data-voice': v.id, testid: `rr-${v.name}` });
      this.grid.append(label, row, right);
      this.rows.push({ id: v.id, label, cells, sigs: cells.map(() => ''), right, rph: -1, flashUntil: 0 });
    }
  }

  /** Called every animation frame (and after edits). */
  frame(force = false): void {
    const app = this.app;
    // What is heard first: following the song may change the pattern shown.
    const { plan, real, tick, playing } = app.heard();
    const shown = app.pattern();
    const live = !!plan && plan.patternId === shown.id;
    const usePlan = live ? plan : null;
    const ps = `${app.prefs.follow}:${playing}:${plan?.index ?? -1}:${plan?.patternId}:${app.engine.version}:${shown.id}:${live}:${app.project.voices.map((v) => `${v.mute}${v.solo}${app.engine.jamming(v.id) ?? ''}`).join('')}:${app.sel.voice}:${app.ext}`;
    if (force || ps !== this.paintSig) {
      this.paintSig = ps;
      this.paint(shown, usePlan, live ? real : null);
      this.updateBanner(shown, plan, playing);
    }
    // Playhead.
    let step = -1;
    if (playing && usePlan) step = Math.floor((tick - usePlan.startTick) / usePlan.geo.stepTicks);
    if (step >= (usePlan?.geo.steps ?? 0)) step = -1;
    if (step !== this.phStep) {
      if (this.phStep >= 0) {
        this.head[this.phStep]?.classList.remove('ph');
        for (const r of this.rows) r.cells[this.phStep]?.classList.remove('ph');
      }
      if (step >= 0) {
        this.head[step]?.classList.add('ph');
        for (const r of this.rows) r.cells[step]?.classList.add('ph');
      }
      this.phStep = step;
      if (step >= 0 && app.prefs.follow) this.scrollTo(step);
    }
    for (const r of this.rows) {
      const p = step >= 0 && usePlan ? usePlan.pos[r.id]?.[step] ?? -1 : -1;
      if (p !== r.rph) {
        if (r.rph >= 0) r.cells[r.rph]?.classList.remove('rph');
        if (p >= 0) r.cells[p]?.classList.add('rph');
        r.rph = p;
      }
    }
    // Label flashes for notes as they are heard.
    const now = performance.now();
    if (this.pending.length) {
      const keep: typeof this.pending = [];
      for (const n of this.pending) {
        if (n.ms <= now) {
          const r = this.rows.find((x) => x.id === n.voice);
          if (r) r.flashUntil = now + 90;
        } else keep.push(n);
      }
      this.pending = keep;
    }
    for (const r of this.rows) r.label.classList.toggle('flash', r.flashUntil > now);
  }

  /** Keep the playing step in view when the grid is wider than its panel. */
  private scrollTo(step: number): void {
    const w = this.wrap;
    if (w.scrollWidth <= w.clientWidth + 1) return;
    const cell = this.head[step];
    if (!cell) return;
    const label = this.rows[0]?.label.offsetWidth ?? 0;
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    if (left < w.scrollLeft + label || right > w.scrollLeft + w.clientWidth) w.scrollLeft = Math.max(0, left - label);
  }

  private updateBanner(shown: Pattern, plan: CyclePlan | null, playing: boolean): void {
    const app = this.app;
    let text = '';
    let cls = 'banner';
    if (app.engine.audition) {
      text = `AUDITION: ${shown.name} (bred) · KEEP or DISCARD in the BREED panel`;
      cls += ' aud';
    } else if (playing && plan && plan.patternId !== shown.id) {
      const pl = app.engine.getPattern(plan.patternId);
      text =
        app.project.playMode === 'song'
          ? `THE SONG IS PLAYING ${pl?.name ?? '?'} · YOU ARE EDITING ${shown.name} · FOLLOW IS OFF`
          : `${shown.name} IS CUED: IT STARTS WHEN ${pl?.name ?? '?'} FINISHES THIS CYCLE`;
    } else if (app.engine.sourceOnly) text = 'SOURCE ONLY: the written pattern, nothing generated or suppressed';
    else if (app.engine.lockKey !== null) text = 'VARIATION LOCKED: every cycle repeats this performance';
    this.followBtn.classList.toggle('on', app.prefs.follow);
    this.followBtn.setAttribute('aria-pressed', String(app.prefs.follow));
    this.banner.hidden = !text;
    this.banner.className = cls;
    this.banner.textContent = text;
    const info = this.el.querySelector('[data-testid="grid-info"]');
    const g = geometry(shown);
    if (info) info.textContent = `${shown.name} · ${shown.beats}/${shown.unit} · ${shown.bars} BAR${shown.bars > 1 ? 'S' : ''} · ${g.steps} STEPS${!playing ? ' · PREVIEW' : ''}`;
  }

  private paint(p: Pattern, plan: CyclePlan | null, real: Realization | null): void {
    const app = this.app;
    const g = geometry(p);
    const anySolo = app.project.voices.some((v) => v.solo);
    // Generated marks per voice and track position.
    const marks = new Map<string, { frac: number; kind: string; sound: string }[]>();
    if (real && plan) {
      for (const ev of real.events) {
        if (ev.kind === 'source' || ev.kind === 'flam') continue;
        const pos = plan.pos[ev.voice]?.[ev.step];
        if (pos === undefined) continue;
        const key = `${ev.voice}:${pos}`;
        const list = marks.get(key) ?? [];
        list.push({ frac: ev.x - ev.step, kind: ev.kind, sound: ev.sound });
        marks.set(key, list);
      }
    }
    for (const r of this.rows) {
      const v = app.project.voices.find((x) => x.id === r.id);
      const t = p.tracks[r.id];
      if (!v || !t) continue;
      const muted = anySolo ? !v.solo : v.mute;
      r.label.classList.toggle('muted', muted);
      r.label.classList.toggle('sel', app.sel.voice === r.id);
      r.label.querySelector('[data-k="m"]')?.classList.toggle('on', v.mute);
      r.label.querySelector('[data-k="s"]')?.classList.toggle('on', v.solo);
      r.label.querySelector('[data-k="j"]')?.classList.toggle('on', !!app.engine.jamming(r.id));
      r.cells[0]?.parentElement?.classList.toggle('muted', muted);
      r.right.classList.toggle('muted', muted);
      const cells = real?.cells[r.id];
      const loop = Math.max(1, Math.min(t.loop, g.steps));
      for (let i = 0; i < r.cells.length; i++) {
        const src = t.strikes[i] ?? null;
        const cell = cells?.[i];
        const shownStrike: Strike | null = cell ? cell.strike ?? (cell.suppressed && src ? src : null) : src;
        const sup = !!cell && !!cell.suppressed && cell.played === 0 && !!shownStrike;
        const gm = marks.get(`${r.id}:${i}`) ?? [];
        const s = `${shownStrike ? `${shownStrike.v}.${shownStrike.s}.${shownStrike.f ? 1 : 0}.${shownStrike.p ?? ''}` : '-'}|${sup ? cell!.suppressed : ''}|${cell?.added ? 'a' : ''}${cell?.changed ? 'c' : ''}|${gm.map((m) => `${m.kind}${m.frac.toFixed(2)}`).join(',')}|${i >= loop ? 'o' : ''}${i === loop - 1 && loop < g.steps ? 'e' : ''}|${v.notes.length}|${t.fill.rate}`;
        if (s === r.sigs[i]) continue;
        r.sigs[i] = s;
        this.paintCell(r.cells[i]!, shownStrike, sup ? cell!.suppressed! : null, !!cell?.added, !!cell?.changed, gm, i >= loop, i === loop - 1 && loop < g.steps, t.fill.rate, v.notes.length);
      }
      // Right column: loop length and what played.
      const st = real?.stats[r.id];
      const pct = st && st.written ? Math.round((st.played / st.written) * 100) : t.density;
      clear(r.right);
      r.right.append(
        h('span', { text: `${loop < g.steps ? `↺${loop}` : `${g.steps}`}${st && st.generated ? ` +${st.generated}` : ''}` }),
        h('span', { class: 'meter', title: `${pct}% of written strikes play` }, h('i', { style: `width:${pct}%` })),
      );
      r.right.dataset.help = `${v.name}: ${loop < g.steps ? `loops every ${loop} steps (${t.loopPct}%)` : `${g.steps} steps`}. ${st ? `${st.played} of ${st.written} written strikes play this cycle, ${st.generated} generated.` : ''}`;
    }
  }

  private paintCell(c: HTMLElement, s: Strike | null, sup: string | null, added: boolean, changed: boolean, gm: { frac: number; kind: string; sound: string }[], out: boolean, loopEnd: boolean, rate: number, nSteps: number): void {
    clear(c);
    c.classList.toggle('out', out);
    c.classList.toggle('loopend', loopEnd);
    const help: string[] = [];
    if (s) {
      const lv = s.v === 0 ? 0 : s.v;
      const cls = ['hit'];
      if (lv === 0) cls.push('rnd');
      if (lv === 5) cls.push('acc');
      if (sup) cls.push('sup');
      if (added) cls.push('added');
      else if (changed) cls.push('changed');
      c.append(h('i', { class: cls.join(' '), style: `--lv:${lv || 3}` }));
      if (s.f) c.append(h('i', { class: 'fl' }));
      if (s.s !== 1 && nSteps > 1) c.append(h('i', { class: 'sn', text: s.s === 0 ? '?' : String(s.s) }));
      if (s.p !== undefined && s.p < 100) c.append(h('i', { class: 'pb', text: String(s.p) }));
      help.push(`${lv === 0 ? 'random striker' : lv === 5 ? 'accent' : `striker ${lv}`}${s.s === 0 ? ', random sound step' : s.s > 1 ? `, sound step ${s.s}` : ''}${s.f ? ', flam' : ''}${s.p !== undefined && s.p < 100 ? `, ${s.p}% chance` : ''}`);
      if (added) help.push('added by the variation');
      if (changed) help.push('changed by the variation');
      if (sup) help.push(SUPPRESS_TEXT[sup] ?? 'not playing');
    }
    for (const m of gm) {
      const r = m.kind === 'fill' ? rate : 2;
      const left = Math.min(92, Math.max(8, (m.frac + 0.5 / Math.max(0.5, r)) * 100));
      c.append(h('i', { class: `g ${m.kind}`, style: `left:${left}%` }));
    }
    if (gm.length) help.push(`${gm.length} generated (${[...new Set(gm.map((m) => m.kind))].join(', ')})`);
    if (out) help.push('outside this track\'s loop');
    c.dataset.help = help.length ? help.join('; ') : 'Click to paint with the current striker; right-click erases; Alt-click flams; drag to paint a run.';
    c.dataset.state = `${s ? 'hit' : 'empty'}${sup ? ' sup' : ''}${gm.length ? ' gen' : ''}${added ? ' added' : ''}${changed ? ' changed' : ''}`;
  }

  // ---------------------------------------------------------------- painting

  private cellAt(e: PointerEvent): HTMLElement | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const c = el?.closest('.cell') as HTMLElement | null;
    return c && this.grid.contains(c) ? c : null;
  }

  private down(e: PointerEvent): void {
    const c = (e.target as HTMLElement).closest('.cell') as HTMLElement | null;
    if (!c) return;
    e.preventDefault();
    const voice = c.dataset.voice!;
    const step = Number(c.dataset.step);
    const action = this.app.strikeAction(voice, step, e.altKey, e.button === 2 || e.ctrlKey);
    this.grid.setPointerCapture(e.pointerId);
    this.drag = { action, seen: new Set([`${voice}:${step}`]) };
    this.app.beginStroke();
    if (this.app.sel.voice !== voice) this.app.selectVoice(voice, false);
    this.app.applyStrike(voice, step, action, false);
  }

  private move(e: PointerEvent): void {
    if (!this.drag || !(e.buttons & 3)) return;
    const c = this.cellAt(e);
    if (!c) return;
    const key = `${c.dataset.voice}:${c.dataset.step}`;
    if (this.drag.seen.has(key)) return;
    this.drag.seen.add(key);
    const action = this.drag.action === 'flam' ? 'flam' : this.drag.action;
    this.app.applyStrike(c.dataset.voice!, Number(c.dataset.step), action, false);
  }
}

/**
 * Control panels for the selected voice and pattern. CLASSIC tabs mirror
 * UpBeat's per-track displays (velocity, fills, time / density, loops);
 * EXTENDED tabs hold DOWNBEAT's own generative tools and appear only in
 * EXTENDED mode.
 */
import type { App } from '../app/app';
import { TEMPLATES } from '../engine/groove';
import { FILL_RATES, MAX_SOUND_STEPS, SOUNDS, clamp, geometry, type Family, type FillZone, type GrooveTemplate, type Rule, type RuleAction, type RuleWhen } from '../engine/types';
import { SECTION_HELP, type Section } from '../extended/auto';
import { BREED_LABEL, BREED_METHODS, type BreedMethod } from '../extended/breed';
import { euclidStrikes, type EuclidAccent, type EuclidMode } from '../extended/euclid';
import { ACTION_LABEL } from '../extended/rules';
import { button, clear, ext, h, section, seg, select, slider, stepper, toggle, weights, type Refreshers } from './dom';
import { noteControl } from './notes';

const LV = ['1', '2', '3', '4', 'A'];
const FAMILIES: Family[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'perc', 'cymbal'];

interface TabDef {
  id: string;
  label: string;
  ext: boolean;
  help: string;
  build: (r: Refreshers) => HTMLElement;
}

export class PanelsView {
  readonly el: HTMLElement;
  private tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  private body = h('div', { class: 'tabbody', testid: 'tab-body' });
  private refreshers: Refreshers = [];
  private builtSig = '';
  private tabs: TabDef[];

  constructor(private app: App) {
    this.tabs = [
      { id: 'voice', label: 'VOICE', ext: false, help: 'The selected voice: its sound, MIDI note(s) and channel', build: (r) => this.voiceTab(r) },
      { id: 'velocity', label: 'VELOCITY', ext: false, help: 'The five strikers\' velocities and the random striker', build: (r) => this.velocityTab(r) },
      { id: 'fill', label: 'FILL', ext: false, help: 'Automatic fills in the spaces between written strikes', build: (r) => this.fillTab(r) },
      { id: 'time', label: 'TIME', ext: false, help: 'Density, placement, shift and loops', build: (r) => this.timeTab(r) },
      { id: 'pattern', label: 'PATTERN', ext: false, help: 'Time signature, length, grid and tempo', build: (r) => this.patternTab(r) },
      { id: 'song', label: 'SONG', ext: false, help: 'Arrange patterns with repeat counts', build: (r) => this.songTab(r) },
      { id: 'prob', label: 'PROB', ext: true, help: 'Probability of playing, extra hits, accents', build: (r) => this.probTab(r) },
      { id: 'groove', label: 'GROOVE', ext: true, help: 'Swing, groove templates, humanising', build: (r) => this.grooveTab(r) },
      { id: 'euclid', label: 'EUCLID', ext: true, help: 'Euclidean rhythm generator', build: (r) => this.euclidTab(r) },
      { id: 'evolve', label: 'EVOLVE', ext: true, help: 'Let the pattern evolve over repetitions', build: (r) => this.evolveTab(r) },
      { id: 'breed', label: 'BREED', ext: true, help: 'Combine two patterns into a new one', build: (r) => this.breedTab(r) },
      { id: 'morph', label: 'MORPH', ext: true, help: 'Gradually transform one pattern into another', build: (r) => this.morphTab(r) },
      { id: 'rules', label: 'RULES', ext: true, help: 'WHEN ... THEN ... conditional triggers', build: (r) => this.rulesTab(r) },
      { id: 'auto', label: 'AUTO', ext: true, help: 'Autopilot: leave it running and it varies the groove', build: (r) => this.autoTab(r) },
    ];
    this.el = h('div', { class: 'panel', testid: 'panels' }, this.tabsEl, this.body);
    app.on(['selection', 'voices', 'project', 'mode', 'pattern', 'track', 'ext', 'song', 'perf', 'transport', 'tempo', 'feed'], () => this.render());
    this.render();
  }

  private render(): void {
    const app = this.app;
    let tab = this.tabs.find((t) => t.id === app.sel.tab) ?? this.tabs[0]!;
    if (tab.ext && !app.ext) tab = this.tabs[0]!;
    const v = app.voice();
    const p = app.pattern();
    const sig = `${tab.id}:${v.id}:${v.notes.length}:${p.id}:${app.ext}:${app.project.voices.map((x) => x.id + x.name).join(',')}:${app.project.patterns.map((x) => x.id + x.name).join(',')}:${app.project.song.entries.length}:${app.project.ext.rules.map((r) => r.id + r.when.type).join(',')}:${p.evolve.on}:${!!p.evolve.locked}:${!!app.engine.audition}`;
    if (sig !== this.builtSig) {
      this.builtSig = sig;
      clear(this.tabsEl);
      let sep = false;
      for (const t of this.tabs) {
        if (t.ext && !app.ext) continue;
        if (t.ext && !sep) {
          sep = true;
          this.tabsEl.append(h('span', { class: 'tsep xt', text: 'EXTENDED' }));
        }
        this.tabsEl.append(h('button', { type: 'button', role: 'tab', class: `${t.id === tab.id ? 'on' : ''}${t.ext ? ' xt' : ''}`, text: t.label, help: t.help, testid: `tab-${t.id}`, on: { click: () => app.setTab(t.id) } }));
      }
      clear(this.body);
      this.refreshers = [];
      this.body.append(tab.build(this.refreshers));
    } else for (const f of this.refreshers) f();
  }

  // ---------------------------------------------------------------- CLASSIC

  private voiceTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const v = () => app.voice();
    const name = h('input', { type: 'text', value: v().name, maxlength: 12, testid: 'voice-name', 'aria-label': 'voice name' });
    name.addEventListener('change', () => app.setVoice((x) => (x.name = name.value.trim().toUpperCase().slice(0, 12) || x.name), ['voices', 'pattern']));
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const steps = h('div', { class: 'notes-list', testid: 'step-list' });
    let controls: { refresh: () => void }[] = [];
    let builtFor = '';
    const renderSteps = () => {
      const key = `${v().id}:${v().notes.length}`;
      if (key === builtFor) {
        for (const c of controls) c.refresh();
        return;
      }
      builtFor = key;
      clear(steps);
      controls = [];
      v().notes.forEach((_, i) => {
        const c = noteControl(app, v().id, i, `step-${i + 1}`);
        controls.push(c);
        steps.append(h('span', { class: 'group' }, h('span', { class: 'lab', text: `S:${i + 1}` }), c.el, v().notes.length > 1 ? button('×', () => app.removeSoundStep(v().id, i), { cls: 'tiny', help: 'Remove this step' }) : null));
      });
      if (v().notes.length < MAX_SOUND_STEPS) steps.append(button('+ STEP', () => app.addSoundStep(v().id), { cls: 'tiny', help: 'Add a sound step (a note or chord, e.g. 42 or 42+46)', testid: 'add-step' }));
    };
    r.push(renderSteps);
    renderSteps();
    return h(
      'div',
      { class: 'cols' },
      section(
        'VOICE',
        h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'NAME' }), name, button('▲', () => app.moveVoice(v().id, -1), { cls: 'tiny', help: 'Move up' }), button('▼', () => app.moveVoice(v().id, 1), { cls: 'tiny', help: 'Move down' })),
        select(r, { label: 'FAMILY', options: () => FAMILIES.map((f) => [f, f.toUpperCase()] as const), get: () => v().family, set: (f) => app.setVoice((x) => (x.family = f as Family)), help: 'What kind of drum this is: rules and the autopilot target voices by family' }),
        select(r, { label: 'COLOUR', options: () => ['KICK', 'SNARE', 'HATS', 'TOMS', 'PERC', 'CYMBAL'].map((l, i) => [String(i), l] as const), get: () => String(v().color), set: (c) => app.setVoice((x) => (x.color = Number(c)), ['voices', 'pattern']), help: 'Identity colour (palette roles)' }),
        h('div', { class: 'btnrow' }, button('HEAR', () => app.auditionVoice(v().id), { help: 'Play this voice now', testid: 'hear-voice' }), button('+ VOICE', () => app.addVoice(), { help: 'Add a voice (up to 16)', testid: 'add-voice' }), button('DELETE VOICE', () => app.removeVoice(), { help: 'Delete this voice from the project (undoable)', testid: 'delete-voice' })),
      ),
      section(
        'MIDI',
        stepper(r, { label: 'CHANNEL', min: 1, max: 16, get: () => v().channel, set: (c) => app.setVoice((x) => (x.channel = c)), help: 'MIDI channel for this voice (10 = General MIDI drums)', testid: 'voice-channel' }),
        h('div', { class: 'ctl ctl-notes', help: 'The MIDI note(s) this voice sends. With several steps, each strike plays one step, chosen in the strike (S:1, S:2 ...) or at random (S:?). A step can be a chord: 42+46. All voices at once: MIDI → DRUM MAP.' }, h('span', { class: 'lab', text: 'NOTE' }), steps),
        stepper(r, { label: 'GATE', min: 1, max: 96, get: () => v().gate, set: (g) => app.setVoice((x) => (x.gate = g)), fmt: (g) => `${g}`, help: 'Note length in clock ticks (24 per quarter). Most drum machines ignore it; gates and envelopes on modular systems do not.' }),
        stepper(r, { label: 'PROGRAM', min: -1, max: 127, get: () => v().program ?? -1, set: (p) => app.setVoice((x) => (x.program = p < 0 ? null : p)), fmt: (p) => (p < 0 ? 'OFF' : String(p)), help: 'Program change sent on this channel at Start (OFF = none)' }),
      ),
      section(
        'INTERNAL SOUND',
        select(r, { label: 'SOUND', options: () => SOUNDS.map((s) => [s, s.toUpperCase()] as const), get: () => v().sound.kind, set: (k) => app.setVoice((x) => (x.sound.kind = k as never)), help: 'Which built-in synthesised sound plays this voice', testid: 'voice-sound' }),
        slider(r, { label: 'TUNE', min: -12, max: 12, get: () => v().sound.tune, set: (t) => ((v().sound.tune = t), app.touch(['voices'])), help: 'Pitch of the internal sound in semitones' }),
        slider(r, { label: 'DECAY', min: 0.25, max: 4, step: 0.05, get: () => v().sound.decay, set: (d) => ((v().sound.decay = d), app.touch(['voices'])), fmt: (d) => `×${d.toFixed(2)}`, help: 'Length of the internal sound' }),
        slider(r, { label: 'LEVEL', min: 0, max: 1, step: 0.01, get: () => v().sound.level, set: (l) => ((v().sound.level = l), app.touch(['voices'])), fmt: (l) => `${Math.round(l * 100)}`, help: 'Volume of the internal sound' }),
      ),
    );
  }

  private velocityTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const t = () => app.track();
    const tools = section('STRIKERS', h('p', { class: 'hint', text: 'Each striker has a central velocity and a ± range; every hit picks within it.' }));
    for (let i = 0; i < 5; i++) {
      tools.append(
        h(
          'div',
          { class: 'ctl' },
          h('span', { class: 'lab', text: i === 4 ? 'ACCENT' : `STRIKER ${i + 1}` }),
          slider(r, { label: '', min: 1, max: 127, get: () => t().vel.center[i]!, set: (x) => app.setTrack((tr) => (tr.vel.center[i] = x)), help: `Central velocity of striker ${LV[i]}`, testid: `vel-center-${i + 1}` }),
          slider(r, { label: '±', min: 0, max: 40, get: () => t().vel.range[i]!, set: (x) => app.setTrack((tr) => (tr.vel.range[i] = x)), help: `Velocity range (±) of striker ${LV[i]}` }),
        ),
      );
    }
    return h(
      'div',
      { class: 'cols' },
      tools,
      section(
        'RANDOM VELOCITY',
        h('p', { class: 'hint', text: 'How likely the random striker (?) is to choose each striker.' }),
        weights(r, { label: 'WEIGHTS', labels: LV, get: () => t().vel.weights, set: (i, x) => app.setTrack((tr) => (tr.vel.weights[i] = x)), help: 'Drag the bars: random striker weights', testid: 'rand-weights' }),
        h('div', { class: 'btnrow' }, button('COPY TO ALL VOICES', () => { const s = t().vel; app.setTrackAll((tr) => (tr.vel = { center: [...s.center], range: [...s.range], weights: [...s.weights] })); }, { help: 'Use these striker settings on every voice of this pattern' })),
      ),
    );
  }

  private fillTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const t = () => app.track();
    const f = () => t().fill;
    const set = (fn: (x: ReturnType<typeof f>) => void) => app.setTrack((tr) => fn(tr.fill));
    return h(
      'div',
      { class: 'cols' },
      section(
        'FILL',
        h('p', { class: 'hint', text: 'Fills add notes in the empty space between written strikes. They change every cycle and never alter what you wrote.' }),
        toggle(r, { label: 'FILLS ON', get: () => f().on, set: (on) => set((x) => (x.on = on)), help: 'Fills on or off for this voice', testid: 'fill-on' }),
        select(r, { label: 'SOUND', options: () => [['', 'THIS VOICE'] as const, ...app.project.voices.filter((x) => x.id !== app.sel.voice).map((x) => [x.id, x.name] as const)], get: () => f().sound ?? '', set: (id) => set((x) => (x.sound = id || null)), help: 'Which voice plays the fill: fill a snare pattern with toms, a kick with claps', testid: 'fill-sound' }),
        slider(r, { label: 'AMOUNT', min: 0, max: 100, get: () => f().amount, set: (x) => set((y) => (y.amount = x)), fmt: (x) => `${x}%`, help: 'Percentage of the empty space that is filled', testid: 'fill-amount' }),
        seg(r, { label: 'RATE', options: FILL_RATES.map((x) => [x, x === 0.5 ? '½' : `${x}`] as const), get: () => f().rate, set: (x) => set((y) => (y.rate = x)), help: 'Fill speed relative to the grid: 2 = twice as fast, 3 = triplet rolls', testid: 'fill-rate' }),
      ),
      section(
        'SHAPE',
        stepper(r, { label: 'SPACING', min: 0, max: 4, get: () => f().spacing, set: (x) => set((y) => (y.spacing = x)), help: 'Minimum distance (steps) between fill notes and written strikes', testid: 'fill-spacing' }),
        stepper(r, { label: 'MAX / GAP', min: 1, max: 16, get: () => f().max, set: (x) => set((y) => (y.max = x)), help: 'At most this many fill notes between two written strikes. Fills lead into the next strike.', testid: 'fill-max' }),
        h('div', { class: 'ctl' }, seg(r, { label: 'ZONE', options: [['all', 'ANYWHERE'], ['bar', 'LAST BAR'], ['half', 'LAST ½ BAR'], ['beat', 'LAST BEAT']] as const, get: () => f().zone, set: (x) => set((y) => (y.zone = x as FillZone)), help: 'Where fills may occur in the pattern (EXTENDED addition; ANYWHERE is the classic behaviour)', testid: 'fill-zone' }), ext()),
      ),
      section(
        'FILL VELOCITY',
        h('p', { class: 'hint', text: 'How likely each striker is for fill notes. A fill just before an accent rises one level.' }),
        weights(r, { label: 'WEIGHTS', labels: LV, get: () => f().weights, set: (i, x) => set((y) => (y.weights[i] = x)), help: 'Drag the bars: fill velocity probabilities', testid: 'fill-weights' }),
      ),
    );
  }

  private timeTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const t = () => app.track();
    const steps = () => geometry(app.pattern()).steps;
    return h(
      'div',
      { class: 'cols' },
      section(
        'DENSITY',
        h('p', { class: 'hint', text: 'How many written strikes play. Below 100% a different subset plays each cycle; louder strikes survive more often. Nothing is deleted.' }),
        slider(r, { label: 'DENSITY', min: 0, max: 100, get: () => t().density, set: (x) => app.setTrack((tr) => (tr.density = x)), fmt: (x) => `${x}%`, help: 'Note density of the selected voice', testid: 'density' }),
        h('div', { class: 'btnrow' }, button('ALL VOICES', () => { const d = t().density; app.setTrackAll((tr) => (tr.density = d)); }, { cls: 'tiny', help: 'Set every voice to this density' })),
      ),
      section(
        'PLACEMENT',
        slider(r, { label: 'TIMING ±', min: 0, max: 24, get: () => t().timing, set: (x) => app.setTrack((tr) => (tr.timing = x)), fmt: (x) => `${x}/96`, help: 'Each note moves by up to this much (96ths of a quarter): human feel', testid: 'timing' }),
        stepper(r, { label: 'SHIFT', min: -48, max: 48, get: () => t().shift, set: (x) => app.setTrack((tr) => (tr.shift = x)), fmt: (x) => `${x > 0 ? '+' : ''}${x}`, help: 'Move the whole voice early (−) or late (+) in 96ths of a quarter (1/384 bar): a lazy snare, a pushed hat', testid: 'shift' }),
        h('div', { class: 'btnrow' }, button('◀ STEP', () => app.rotateTrack(-1), { cls: 'tiny', help: 'Rotate earlier by one step' }), button('STEP ▶', () => app.rotateTrack(1), { cls: 'tiny', help: 'Rotate later by one step' })),
      ),
      section(
        'LOOP',
        h('p', { class: 'hint', text: 'A track can loop before the pattern ends: different loop lengths make polyrhythms.' }),
        stepper(r, { label: 'LENGTH', min: 1, max: steps(), get: () => Math.min(t().loop, steps()), set: (x) => app.setTrack((tr) => (tr.loop = clamp(x, 1, steps())), true), help: 'Loop point: the track jumps back to its start after this many steps', testid: 'loop-length' }),
        slider(r, { label: 'LOOP %', min: 0, max: 100, get: () => t().loopPct, set: (x) => app.setTrack((tr) => (tr.loopPct = x)), fmt: (x) => `${x}%`, help: 'Chance of jumping back at the loop point; otherwise the track plays on to the pattern end', testid: 'loop-pct' }),
        seg(r, { label: 'PHASE', options: [['pattern', 'RESTART'], ['free', 'FREE']] as const, get: () => t().phase, set: (x) => app.setTrack((tr) => (tr.phase = x)), help: 'RESTART: the loop restarts when a pattern starts. FREE: keeps running across pattern changes.' }),
        h('div', { class: 'btnrow' }, button('RESYNC', () => app.resync(), { cls: 'tiny', help: 'Line every loop up again at the next cycle', testid: 'resync' })),
      ),
    );
  }

  private patternTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const p = () => app.pattern();
    const name = h('input', { type: 'text', value: p().name, maxlength: 16, testid: 'pattern-name', 'aria-label': 'pattern name' });
    name.addEventListener('change', () => app.renamePattern(name.value));
    name.addEventListener('keydown', (e) => e.stopPropagation());
    r.push(() => {
      if (document.activeElement !== name) name.value = p().name;
    });
    return h(
      'div',
      { class: 'cols' },
      section(
        'PATTERN',
        h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'NAME' }), name),
        stepper(r, { label: 'BEATS', min: 1, max: 15, get: () => p().beats, set: (x) => app.setGeometry({ beats: x }), help: 'Time signature: beats per bar', testid: 'beats' }),
        seg(r, { label: 'BEAT UNIT', options: [[4, '4'], [8, '8'], [16, '16']] as const, get: () => p().unit, set: (x) => app.setGeometry({ unit: x }), help: 'Time signature: the beat is a quarter, eighth or sixteenth' }),
        stepper(r, { label: 'BARS', min: 1, max: 8, get: () => p().bars, set: (x) => app.setGeometry({ bars: x }), help: 'Pattern length in bars (at most 64 steps)', testid: 'bars' }),
        seg(r, { label: 'GRID', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8']] as const, get: () => p().grid, set: (x) => app.setGeometry({ grid: x }), help: 'Steps per beat (the Edit grid): 4 = sixteenths in 4/4, 3 or 6 = triplets', testid: 'grid' }),
      ),
      section(
        'TEMPO',
        toggle(r, { label: 'OWN TEMPO', get: () => p().tempo !== null, set: (on) => app.setPatternTempo(on ? app.project.tempo : null), help: 'Give this pattern its own tempo, applied when it starts' }),
        slider(r, { label: 'TEMPO', min: 40, max: 240, get: () => p().tempo ?? app.project.tempo, set: (x) => app.setPatternTempo(x), disabled: () => p().tempo === null, help: 'This pattern\'s tempo' }),
      ),
      section(
        'ACTIONS',
        h(
          'div',
          { class: 'btnrow' },
          button('NEW', () => app.newPattern(), { help: 'A new empty pattern with the same time signature', testid: 'new-pattern' }),
          button('DUPLICATE', () => app.duplicatePattern(), { help: 'Copy this pattern', testid: 'dup-pattern' }),
          button('DOUBLE', () => app.doublePattern(), { help: 'Double the length, copying the strikes', testid: 'double-pattern' }),
          button('CLEAR ALL', () => app.clearTrack(true), { help: 'Clear every voice in this pattern (undoable)' }),
          button('DELETE', () => app.deletePattern(), { help: 'Delete this pattern (undoable)', testid: 'delete-pattern' }),
        ),
      ),
    );
  }

  private songTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const list = h('div', { class: 'list', testid: 'song-list' });
    const render = () => {
      clear(list);
      const now = app.heard().plan?.song;
      app.project.song.entries.forEach((e, i) => {
        const pn = app.project.patterns.find((p) => p.id === e.patternId)?.name ?? '?';
        const rep = h('input', { type: 'text', class: 'num', value: e.repeats, 'aria-label': 'repeats', testid: `song-rep-${i}` });
        rep.addEventListener('change', () => app.songRepeats(i, Number(rep.value)));
        rep.addEventListener('keydown', (ev) => ev.stopPropagation());
        list.append(
          h(
            'div',
            { class: `song-e${now && now.entry === i && app.transport !== 'stopped' ? ' now' : ''}` },
            h('span', { class: 'ix', text: String(i + 1) }),
            h('span', { text: pn }),
            h('span', { class: 'group' }, h('span', { class: 'lab', text: '×' }), rep),
            h('span', { class: 'group' }, button('▲', () => app.songMove(i, -1), { cls: 'tiny' }), button('▼', () => app.songMove(i, 1), { cls: 'tiny' }), button('×', () => app.songRemove(i), { cls: 'tiny', help: 'Remove' })),
          ),
        );
      });
      if (!app.project.song.entries.length) list.append(h('div', { class: 'li', text: 'Empty: add patterns below.' }));
    };
    r.push(render);
    render();
    return h(
      'div',
      { class: 'cols' },
      section(
        'PLAY',
        seg(r, { label: 'MODE', options: [['pattern', 'PATTERN'], ['song', 'SONG']] as const, get: () => app.project.playMode, set: (m) => app.setPlayMode(m), help: 'PATTERN: loop the selected pattern (selecting another cues it). SONG: play the arrangement.', testid: 'play-mode' }),
        toggle(r, { label: 'LOOP SONG', get: () => app.project.song.loop, set: (on) => app.edit(() => (app.project.song.loop = on), ['song']), help: 'Loop the song, or stop at its end' }),
      ),
      section('ARRANGEMENT', list, h('div', { class: 'btnrow' }, button(`ADD ${app.pattern().name}`, () => app.songAdd(), { help: 'Add the selected pattern to the end of the song', testid: 'song-add' }))),
    );
  }

  // ---------------------------------------------------------------- EXTENDED

  private probTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const e = () => app.track().ext;
    const feat = () => app.project.ext.features;
    return h(
      'div',
      { class: 'cols' },
      section(
        'PROBABILITY',
        h('span', {}, ext()),
        toggle(r, { label: 'PROBABILITY ON', get: () => feat().prob, set: (on) => app.setExt((x) => (x.features.prob = on)), help: 'Switch all probability controls on or off (the settings are kept)', testid: 'feat-prob' }),
        slider(r, { label: 'PLAY', min: 0, max: 100, get: () => e().prob, set: (x) => app.setTrack((t) => (t.ext.prob = x)), fmt: (x) => `${x}%`, help: 'Probability that each written strike of this voice plays', testid: 'prob-play' }),
        slider(r, { label: 'EXTRA HITS', min: 0, max: 100, get: () => e().extra, set: (x) => app.setTrack((t) => (t.ext.extra = x)), fmt: (x) => `${x}%`, help: 'Chance of a ghost note half a step after each played strike', testid: 'prob-extra' }),
        slider(r, { label: 'ACCENT', min: 0, max: 100, get: () => e().accent, set: (x) => app.setTrack((t) => (t.ext.accent = x)), fmt: (x) => `${x}%`, help: 'Chance that a non-accent strike plays as an accent' }),
        slider(r, { label: 'VELOCITY ±', min: 0, max: 50, get: () => e().velVar, set: (x) => app.setTrack((t) => (t.ext.velVar = x)), fmt: (x) => `${x}%`, help: 'Extra velocity variation for this voice' }),
      ),
      section('PER STEP', h('p', { class: 'hint', text: 'Choose the P% tool in the strip above the grid and click strikes to give each its own chance of playing. Decisions use the seed, so a take replays exactly.' })),
    );
  }

  private grooveTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const g = () => app.project.ext.groove;
    const set = (fn: (x: ReturnType<typeof g>) => void) => app.setExt((x) => fn(x.groove));
    return h(
      'div',
      { class: 'cols' },
      section(
        'SWING',
        h('span', {}, ext()),
        toggle(r, { label: 'GROOVE ON', get: () => app.project.ext.features.groove, set: (on) => app.setExt((x) => (x.features.groove = on)), help: 'Switch swing and groove on or off (settings kept)', testid: 'feat-groove' }),
        slider(r, { label: 'SWING', min: 50, max: 75, get: () => g().swing, set: (x) => set((y) => (y.swing = x)), fmt: (x) => `${x}%`, help: 'Delay every second grid step: 50% straight, 66% triplet swing', testid: 'swing' }),
        seg(r, { label: 'TEMPLATE', options: (Object.keys(TEMPLATES) as GrooveTemplate[]).map((k) => [k, TEMPLATES[k].label] as const), get: () => g().template, set: (x) => set((y) => (y.template = x)), help: 'Timing and velocity shapes within each beat', testid: 'template' }),
        slider(r, { label: 'DEPTH', min: 0, max: 100, get: () => g().depth, set: (x) => set((y) => (y.depth = x)), fmt: (x) => `${x}%`, help: 'How strongly the template applies' }),
      ),
      section(
        'HUMANISE',
        slider(r, { label: 'TIMING ±', min: 0, max: 24, get: () => g().humanize, set: (x) => set((y) => (y.humanize = x)), fmt: (x) => `${x}/96`, help: 'Seeded timing variation for every voice' }),
        slider(r, { label: 'VELOCITY ±', min: 0, max: 50, get: () => g().velVar, set: (x) => set((y) => (y.velVar = x)), fmt: (x) => `${x}%`, help: 'Seeded velocity variation for every voice' }),
        slider(r, { label: 'ACCENTS', min: 0, max: 100, get: () => g().accent, set: (x) => set((y) => (y.accent = x)), fmt: (x) => `${x}%`, help: 'Accent emphasis: accents louder, the rest softer' }),
      ),
    );
  }

  private euclidTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const e = app.euclid;
    const preview = h('div', { class: 'mini', testid: 'euclid-preview' });
    const draw = () => {
      clear(preview);
      const steps = Math.min(e.steps, geometry(app.pattern()).steps);
      const st = euclidStrikes({ ...e, steps });
      preview.style.gridTemplateColumns = `repeat(${steps}, 8px)`;
      for (const s of st) preview.append(h('i', { class: s ? (s.v === 5 ? 'acc' : 'on') : '' }));
    };
    r.push(draw);
    const change = () => this.render();
    const maxSteps = () => geometry(app.pattern()).steps;
    return h(
      'div',
      { class: 'cols' },
      section(
        'EUCLIDEAN',
        h('span', {}, ext()),
        stepper(r, { label: 'STEPS', min: 1, max: maxSteps(), get: () => Math.min(e.steps, maxSteps()), set: (x) => ((e.steps = x), (e.hits = Math.min(e.hits, x)), change()), testid: 'eu-steps', help: 'Length of the Euclidean cycle' }),
        stepper(r, { label: 'HITS', min: 0, max: 64, get: () => e.hits, set: (x) => ((e.hits = Math.min(x, e.steps)), change()), testid: 'eu-hits', help: 'Hits spread as evenly as possible over the steps' }),
        stepper(r, { label: 'ROTATE', min: -32, max: 32, get: () => e.rotation, set: (x) => ((e.rotation = x), change()), help: 'Rotate the result' }),
        seg(r, { label: 'ACCENTS', options: [['none', 'NONE'], ['first', '1ST'], ['every2', '1 IN 2'], ['every3', '1 IN 3'], ['euclid', 'EUCLID']] as const, get: () => e.accent, set: (x) => ((e.accent = x as EuclidAccent), change()), help: 'Which hits are accents (EUCLID: spread ACCENT HITS evenly over the hits)' }),
        stepper(r, { label: 'ACCENT HITS', min: 0, max: 16, get: () => e.accentHits, set: (x) => ((e.accentHits = x), change()) }),
        seg(r, { label: 'LEVEL', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] as const, get: () => e.level, set: (x) => ((e.level = x), change()), help: 'Striker for the non-accent hits' }),
      ),
      section(
        `INTO ${app.voice().name}`,
        preview,
        seg(r, { label: 'COMBINE', options: [['replace', 'REPLACE'], ['merge', 'MERGE'], ['intersect', 'AND'], ['xor', 'XOR']] as const, get: () => e.mode, set: (x) => ((e.mode = x as EuclidMode), change()), help: 'REPLACE the voice, MERGE with it, keep only shared hits (AND) or the difference (XOR)', testid: 'eu-mode' }),
        toggle(r, { label: 'SET LOOP TO STEPS', get: () => e.setLoop, set: (x) => ((e.setLoop = x), change()), help: 'Also loop the voice every STEPS steps (polymeter: 5 against 16)' }),
        h('div', { class: 'btnrow' }, button('APPLY', () => app.applyEuclid(), { cls: 'big', help: 'Write the rhythm into the selected voice (undoable)', testid: 'eu-apply' })),
      ),
    );
  }

  private evolveTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const ev = () => app.pattern().evolve;
    const status = h('div', { class: 'hint', testid: 'evolve-status' });
    r.push(() => {
      const { plan } = app.heard();
      const p = app.pattern();
      const gen = plan && plan.patternId === p.id ? plan.generation : 0;
      status.textContent = p.evolve.locked ? `LOCKED at generation ${p.evolve.locked.generation}.` : p.evolve.on ? `Generation ${gen}${gen ? ` · ${app.engine.describeGeneration(p, gen)}` : ' (source)'}` : 'Evolution is off for this pattern.';
    });
    const targets = h('div', { class: 'notes-list' });
    const drawTargets = () => {
      clear(targets);
      for (const v of app.project.voices) {
        const on = ev().targets.includes(v.id);
        targets.append(
          h('button', {
            type: 'button',
            class: `tiny${on ? ' on' : ''}`,
            text: v.name,
            help: 'Voices that may mutate (none selected = every voice with hits)',
            on: {
              click: () => app.setEvolve((x) => (x.targets = on ? x.targets.filter((y) => y !== v.id) : [...x.targets, v.id])),
            },
          }),
        );
      }
    };
    r.push(drawTargets);
    drawTargets();
    return h(
      'div',
      { class: 'cols' },
      section(
        'EVOLUTION',
        h('span', {}, ext()),
        toggle(r, { label: 'EVOLVE', get: () => ev().on, set: (on) => app.setEvolve((x) => (x.on = on)), help: 'Let this pattern change from generation to generation', testid: 'evolve-on' }),
        seg(r, {
          label: 'FROM',
          options: [['original', 'ORIGINAL'], ['evolving', 'PREVIOUS']] as const,
          get: () => ev().mode,
          set: (m) => app.setEvolve((x) => (x.mode = m)),
          helps: { original: 'ORIGINAL: every variation is a fresh mutation of the written pattern (it never drifts)', evolving: 'EVOLVING: every variation mutates the previous one (it can wander; MAX DRIFT pulls it back)' },
          testid: 'evolve-mode',
        }),
        stepper(r, { label: 'EVERY', min: 1, max: 64, get: () => ev().every, set: (x) => app.setEvolve((y) => (y.every = x)), fmt: (x) => `${x} CYC`, help: 'A new generation every n cycles', testid: 'evolve-every' }),
        slider(r, { label: 'STRENGTH', min: 0, max: 100, get: () => ev().strength, set: (x) => app.setEvolve((y) => (y.strength = x)), fmt: (x) => `${x}%`, help: 'How much each mutation changes: low keeps the groove recognisable', testid: 'evolve-strength' }),
        stepper(r, { label: 'RETURN', min: 0, max: 64, get: () => ev().returnEvery, set: (x) => app.setEvolve((y) => (y.returnEvery = x)), fmt: (x) => (x ? `${x} GEN` : 'NEVER'), help: 'Go back to the source every n generations' }),
        slider(r, { label: 'MAX DRIFT', min: 5, max: 100, get: () => ev().maxDrift, set: (x) => app.setEvolve((y) => (y.maxDrift = x)), fmt: (x) => `${x}%`, help: 'PREVIOUS mode: if more than this much has changed, start again from the source' }),
      ),
      section(
        'NOW',
        status,
        h(
          'div',
          { class: 'btnrow' },
          button('RESET TO SOURCE', () => app.resetEvolution(), { help: 'Back to generation 0 from the next cycle', testid: 'evolve-reset' }),
          button(ev().locked ? 'UNLOCK' : 'LOCK', () => app.lockEvolution(), { help: 'Keep playing the generation you hear (saved with the project)', testid: 'evolve-lock' }),
          button('CAPTURE', () => app.captureVariation(), { help: 'Write what is playing now into a new pattern', testid: 'capture' }),
        ),
        h('div', { class: 'sect-t', text: 'TARGETS' }),
        targets,
      ),
    );
  }

  private breedTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const b = app.breedState;
    const partners = () => app.project.patterns.filter((p) => p.id !== app.project.current).map((p) => [p.id, p.name] as const);
    if (!b.partner || !app.project.patterns.some((p) => p.id === b.partner && p.id !== app.project.current)) b.partner = partners()[0]?.[0] ?? null;
    const aud = !!app.engine.audition;
    const cur = app.project.patterns.find((p) => p.id === app.project.current);
    return h(
      'div',
      { class: 'cols' },
      section(
        'PARENTS',
        h('span', {}, ext()),
        h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'A' }), h('b', { text: cur?.name ?? '' })),
        select(r, { label: 'B', options: () => (partners().length ? partners() : [['', '(make another pattern)'] as const]), get: () => b.partner ?? '', set: (id) => (b.partner = id || null), help: 'The second parent', testid: 'breed-partner' }),
        select(r, { label: 'METHOD', options: () => BREED_METHODS.map((m) => [m, BREED_LABEL[m]] as const), get: () => b.method, set: (m) => ((b.method = m as BreedMethod), aud && app.auditionBreed()), help: 'How the child takes material from A and B', testid: 'breed-method' }),
        h('p', { class: 'hint', text: 'Both parents stay as they are. The child plays (AUDITION) before you decide to keep it.' }),
      ),
      section(
        aud ? 'AUDITIONING' : 'CHILD',
        h(
          'div',
          { class: 'btnrow' },
          button(aud ? 'ANOTHER' : 'AUDITION', () => app.auditionBreed(aud), { cls: 'big', help: 'Breed and play the child (ANOTHER: a new random crossover)', testid: 'breed-audition' }),
          button('KEEP', () => app.keepBreed(), { help: 'Add the child to the pattern library', testid: 'breed-keep' }),
          button('DISCARD', () => app.discardBreed(), { help: 'Forget the child and return to A', testid: 'breed-discard' }),
        ),
        aud ? h('p', { class: 'hint', text: 'The grid shows the child. Edits you make now are kept if you KEEP it.' }) : null,
      ),
    );
  }

  private morphTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const targets = () => app.project.patterns.filter((p) => p.id !== app.engine.playingPatternId()).map((p) => [p.id, p.name] as const);
    let target = targets()[0]?.[0] ?? '';
    const prog = h('div', { class: 'bar-prog', testid: 'morph-progress' }, h('i'));
    const txt = h('div', { class: 'hint', testid: 'morph-status' });
    r.push(() => {
      const m = app.engine.morphState();
      const { plan } = app.heard();
      const t = plan?.morph?.t ?? 0;
      (prog.firstChild as HTMLElement).style.width = `${m || plan?.morph ? Math.round(t * 100) : 0}%`;
      txt.textContent = m ? `Morphing to ${app.engine.getPattern(m.to)?.name}: cycle ${m.done} of ${m.cycles}.` : plan?.morph ? 'Morph complete.' : 'Hits of A fade out (weakest beats first), hits of B fade in (strongest first); shared hits blend their velocity.';
    });
    return h(
      'div',
      { class: 'cols' },
      section(
        'MORPH',
        h('span', {}, ext()),
        select(r, { label: 'TO', options: () => (targets().length ? targets() : [['', '(make another pattern)'] as const]), get: () => target, set: (id) => (target = id), help: 'Pattern to morph into', testid: 'morph-target' }),
        seg(r, { label: 'OVER', options: [[4, '4 BARS'], [8, '8 BARS'], [16, '16 BARS']] as const, get: () => app.morphBars, set: (x) => ((app.morphBars = x), this.render()), help: 'Length of the transition', testid: 'morph-bars' }),
        h('div', { class: 'btnrow' }, button('START MORPH', () => app.startMorph(target), { cls: 'big', help: 'Begin the transition at the next cycle (while playing)', testid: 'morph-start' }), button('CANCEL', () => app.cancelMorph(), { help: 'Stop the morph where it is' })),
      ),
      section('PROGRESS', prog, txt),
    );
  }

  private rulesTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const list = h('div', { class: 'sect', testid: 'rules' });
    const voices = app.project.voices;
    const targets = (): [string, string][] => [
      ['all', 'ALL VOICES'],
      ['@kick', 'KICKS'],
      ['@snare', 'SNARES'],
      ['@hat', 'HATS'],
      ['@tom', 'TOMS'],
      ['@perc', 'PERCUSSION'],
      ...voices.map((v) => [v.id, v.name] as [string, string]),
    ];
    const whenTypes: [RuleWhen['type'], string][] = [
      ['every', 'EVERY N CYCLES'],
      ['rep', 'ON REPEAT N'],
      ['patternStart', 'PATTERN STARTS'],
      ['density', 'VOICE PLAYS LESS THAN'],
      ['generation', 'EVERY N GENERATIONS'],
      ['chance', 'BY CHANCE'],
    ];
    const actions = Object.keys(ACTION_LABEL) as RuleAction[];
    const numIn = (val: number, set: (n: number) => void, label: string, testid?: string) => {
      const i = h('input', { type: 'text', class: 'num', value: val, 'aria-label': label, testid });
      i.addEventListener('change', () => set(Number(i.value) || 0));
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return i;
    };
    const sel = <T extends string>(opts: [T, string][], val: T, set: (v: T) => void, label: string, testid?: string) => {
      const s = h('select', { 'aria-label': label, testid }, ...opts.map(([v, l]) => h('option', { value: v, text: l })));
      s.value = val;
      s.addEventListener('change', () => set(s.value as T));
      return s;
    };
    app.project.ext.rules.forEach((rule: Rule, idx) => {
      const w = rule.when;
      const whenParams: HTMLElement[] = [];
      const setWhen = (fn: (w: RuleWhen) => void) => app.setRule(rule.id, (x) => fn(x.when));
      if (w.type === 'every') whenParams.push(numIn(w.n, (n) => setWhen((x) => x.type === 'every' && (x.n = clamp(n, 1, 64))), 'every n', `rule-${idx}-n`), h('span', { text: 'AT' }), numIn(w.offset + 1, (n) => setWhen((x) => x.type === 'every' && (x.offset = clamp(n - 1, 0, 63))), 'at cycle'));
      if (w.type === 'rep') whenParams.push(numIn(w.n, (n) => setWhen((x) => x.type === 'rep' && (x.n = clamp(n, 1, 64))), 'repeat'));
      if (w.type === 'density')
        whenParams.push(
          sel(voices.map((v) => [v.id, v.name] as [string, string]), w.voice, (id) => setWhen((x) => x.type === 'density' && (x.voice = id)), 'voice'),
          numIn(w.below, (n) => setWhen((x) => x.type === 'density' && (x.below = clamp(n, 0, 100))), 'percent'),
          h('span', { text: '%' }),
        );
      if (w.type === 'generation') whenParams.push(numIn(w.every, (n) => setWhen((x) => x.type === 'generation' && (x.every = clamp(n, 1, 64))), 'generations'));
      if (w.type === 'chance') whenParams.push(numIn(w.p, (n) => setWhen((x) => x.type === 'chance' && (x.p = clamp(n, 0, 100))), 'chance'), h('span', { text: '%' }));
      const newWhen = (t: RuleWhen['type']): RuleWhen =>
        t === 'every' ? { type: 'every', n: 4, offset: 3 } : t === 'rep' ? { type: 'rep', n: 4 } : t === 'patternStart' ? { type: 'patternStart' } : t === 'density' ? { type: 'density', voice: voices[0]!.id, below: 50 } : t === 'generation' ? { type: 'generation', every: 4 } : { type: 'chance', p: 25 };
      const needsTarget = !['reset', 'source', 'next'].includes(rule.then);
      list.append(
        h(
          'div',
          { class: `rule${rule.on ? '' : ' off'}`, testid: `rule-${idx}` },
          h('button', { type: 'button', class: `tiny${rule.on ? ' on' : ''}`, text: rule.on ? 'ON' : 'OFF', on: { click: () => app.setRule(rule.id, (x) => (x.on = !x.on)) } }),
          h('span', { class: 'kw', text: 'WHEN' }),
          sel(whenTypes, w.type, (t) => app.setRule(rule.id, (x) => (x.when = newWhen(t))), 'condition', `rule-${idx}-when`),
          ...whenParams,
          h('span', { class: 'kw', text: 'THEN' }),
          sel(actions.map((a) => [a, ACTION_LABEL[a]] as [RuleAction, string]), rule.then, (a) => app.setRule(rule.id, (x) => (x.then = a)), 'action', `rule-${idx}-then`),
          needsTarget ? sel(targets(), rule.target, (t) => app.setRule(rule.id, (x) => (x.target = t)), 'target', `rule-${idx}-target`) : null,
          ['fill', 'mutate', 'thin', 'boost'].includes(rule.then) ? h('span', {}, 'AMT ', numIn(rule.amount, (n) => app.setRule(rule.id, (x) => (x.amount = clamp(n, 0, 100))), 'amount')) : null,
          rule.then !== 'reset' && rule.then !== 'next' ? h('span', {}, 'FOR ', numIn(rule.cycles, (n) => app.setRule(rule.id, (x) => (x.cycles = clamp(n, 1, 64))), 'cycles'), ' CYC') : null,
          button('×', () => app.removeRule(rule.id), { cls: 'tiny', help: 'Delete this rule' }),
        ),
      );
    });
    if (!app.project.ext.rules.length) list.append(h('p', { class: 'hint', text: 'No rules yet. Example: WHEN EVERY 4 CYCLES AT 4 THEN FILL SNARE.' }));
    return h(
      'div',
      { class: 'sect' },
      h('div', { class: 'sect-t' }, 'RULES', ext()),
      toggle(r, { label: 'RULES ON', get: () => app.project.ext.features.rules, set: (on) => app.setExt((x) => (x.features.rules = on)), help: 'Switch all rules on or off', testid: 'feat-rules' }),
      list,
      h('div', { class: 'btnrow' }, button('+ RULE', () => app.addRule(), { help: 'Add a rule (at most 16)', testid: 'add-rule' })),
      h('p', { class: 'hint', text: 'Rules are checked once at the start of every cycle; an action never triggers another rule, and every effect lasts a fixed number of cycles.' }),
    );
  }

  private autoTab(r: Refreshers): HTMLElement {
    const app = this.app;
    const cur = h('div', { class: 'hint', testid: 'auto-status' });
    r.push(() => {
      const plan = app.heard().plan;
      const line = [...app.feed].reverse().find((l) => l.kind === 'auto');
      cur.textContent = app.project.ext.features.auto ? (line ? line.text : 'Waiting for the first phrase.') : 'The autopilot is off.';
      void plan;
    });
    const rows = (Object.keys(SECTION_HELP) as Section[]).map((s) => h('div', { class: 'ctl' }, h('span', { class: 'lab', text: s }), h('span', { text: SECTION_HELP[s] })));
    return h(
      'div',
      { class: 'cols' },
      section(
        'AUTOPILOT',
        h('span', {}, ext()),
        toggle(r, { label: 'AUTOPILOT ON', get: () => app.project.ext.features.auto, set: (on) => app.setExt((x) => (x.features.auto = on)), help: 'Leave it running: it introduces fills, thins, varies and returns home', testid: 'feat-auto' }),
        slider(r, { label: 'ACTIVITY', min: 0, max: 100, get: () => app.project.ext.activity, set: (x) => app.setExt((y) => (y.activity = x)), fmt: (x) => `${x}`, help: 'How adventurous the autopilot is', testid: 'activity' }),
        stepper(r, { label: 'PHRASE', min: 1, max: 64, get: () => app.project.ext.phrase, set: (x) => app.setExt((y) => (y.phrase = x)), fmt: (x) => `${x} CYC`, help: 'Cycles per phrase; the last cycle of each phrase gets a fill' }),
        cur,
      ),
      section('SECTIONS', ...rows, h('p', { class: 'hint', text: 'After any section the next phrase favours HOME. Each phrase end fills on snares and toms.' })),
    );
  }
}


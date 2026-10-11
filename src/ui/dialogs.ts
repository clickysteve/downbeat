/** In-app dialogs (never browser alert / confirm). */
import type { App } from '../app/app';
import { MidiAccess } from '../midi/webmidi';
import { DEMOS } from '../persistence/demos';
import { button, clear, h, seg, select, toggle, type Refreshers } from './dom';
import { noteControl } from './notes';
import { ROLES, ROLE_INFO, contrastWarnings, exportPalette, importPalette, PaletteError } from './palette';

export class Dialogs {
  private scrim: HTMLElement | null = null;
  private unsub: (() => void) | null = null;

  constructor(private app: App) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.scrim) {
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  get open(): boolean {
    return !!this.scrim;
  }

  close(): void {
    this.scrim?.remove();
    this.scrim = null;
    this.unsub?.();
    this.unsub = null;
  }

  private show(title: string, testid: string, body: (r: Refreshers) => (HTMLElement | null)[], topics: Parameters<App['on']>[0] = []): void {
    this.close();
    const r: Refreshers = [];
    const content = h('div', { class: 'panel-b' });
    const build = () => {
      r.length = 0;
      clear(content);
      content.append(...body(r).filter((x): x is HTMLElement => !!x));
    };
    // Never rebuild under a field being typed in: wait until it loses focus.
    let pending = false;
    const editing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && content.contains(a) && ((a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text') || a.tagName === 'SELECT');
    };
    const rebuild = () => {
      if (editing()) pending = true;
      else build();
    };
    content.addEventListener('focusout', () => {
      if (!pending) return;
      setTimeout(() => {
        if (pending && !editing()) {
          pending = false;
          build();
        }
      });
    });
    build();
    const dlg = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-label': title, testid },
      h('div', { class: 'panel-t' }, h('span', { text: title }), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'tiny', text: 'CLOSE', testid: 'dialog-close', on: { click: () => this.close() } })),
      content,
    );
    this.scrim = h('div', { class: 'scrim', on: { pointerdown: (e: PointerEvent) => e.target === this.scrim && this.close() } }, dlg);
    document.body.append(this.scrim);
    if (topics.length) this.unsub = this.app.on(topics, rebuild);
    (dlg.querySelector('button, input, select') as HTMLElement | null)?.focus();
  }

  // ---------------------------------------------------------------- FILE

  file(): void {
    const app = this.app;
    this.show(
      'FILE',
      'file-dialog',
      () => {
        const name = h('input', { type: 'text', value: app.project.name, maxlength: 40, testid: 'project-name', 'aria-label': 'project name' });
        name.addEventListener('keydown', (e) => e.stopPropagation());
        const fileIn = h('input', { type: 'file', accept: '.json,application/json', testid: 'import-project', 'aria-label': 'import project file' });
        fileIn.addEventListener('change', async () => {
          const f = fileIn.files?.[0];
          if (!f) return;
          if (app.importProjectText(await f.text())) this.close();
        });
        const midiIn = h('input', { type: 'file', accept: '.mid,.midi,audio/midi', testid: 'import-midi', 'aria-label': 'import MIDI file' });
        midiIn.addEventListener('change', async () => {
          const f = midiIn.files?.[0];
          if (!f) return;
          if (app.importMidi(new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.midi?$/i, ''))) this.close();
        });
        const cycles = h('select', { testid: 'export-cycles', 'aria-label': 'cycles to export' }, ...[1, 2, 4, 8, 16, 32].map((n) => h('option', { value: n, text: `${n} CYCLES`, selected: n === 8 })));
        const fmt = h('select', { testid: 'export-format', 'aria-label': 'MIDI file type' }, h('option', { value: '1', text: 'TYPE 1 (TRACK PER VOICE)' }), h('option', { value: '0', text: 'TYPE 0 (ONE TRACK)' }));
        const exp = (what: 'pattern' | 'performance' | 'song' | 'take') => () => app.exportMidi(what, Number(cycles.value), Number(fmt.value) as 0 | 1);
        const lib = app.store.library();
        return [
          h('h3', { text: 'START' }),
          h('div', { class: 'btnrow' }, button('NEW PROJECT', () => (app.newProject(), this.close()), { help: 'A fresh project with the default kit and a simple beat (undoable)', testid: 'new-project' })),
          h('h3', { text: 'DEMOS' }),
          h('div', { class: 'list', testid: 'demos' }, ...DEMOS.map((d) => h('div', { class: 'li' }, h('span', { class: 'nm' }, h('b', { text: d.name }), h('div', { class: 'd', text: d.blurb })), button('OPEN', () => (app.openDemo(d.id), this.close()), { testid: `demo-${d.id}` })))),
          h('h3', { text: 'THIS BROWSER' }),
          h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'NAME' }), name, button('SAVE', () => (app.saveToLibrary(name.value), this.file()), { help: 'Save in this browser\'s library (the current project is also autosaved continuously)', testid: 'save-library' })),
          lib.length
            ? h('div', { class: 'list', testid: 'library' }, ...lib.map((e) => h('div', { class: 'li' }, h('span', { class: 'nm', text: e.name }), h('span', { class: 'd', text: new Date(e.savedAt).toLocaleString() }), button('OPEN', () => (app.openFromLibrary(e.name), this.close()), { testid: `open-${e.name}` }), button('DELETE', () => (app.deleteFromLibrary(e.name), this.file()), { cls: 'tiny' }))))
            : h('p', { class: 'hint', text: app.store.available ? 'Nothing saved yet.' : 'This browser is not letting DOWNBEAT store anything: use EXPORT.' }),
          h('h3', { text: 'PROJECT FILES' }),
          h('div', { class: 'btnrow' }, button('EXPORT PROJECT', () => app.exportProject(), { help: 'Download the project as a .downbeat.json file', testid: 'export-project' }), h('label', { class: 'ctl' }, h('span', { class: 'lab', text: 'IMPORT' }), fileIn)),
          h('h3', { text: 'MIDI FILES' }),
          h('div', { class: 'btnrow' }, cycles, fmt),
          h(
            'div',
            { class: 'btnrow' },
            button('WRITTEN PATTERN', exp('pattern'), { help: 'The selected pattern exactly as written (no fills, no density), repeated', testid: 'export-pattern' }),
            button('PERFORMANCE', exp('performance'), { help: 'The selected pattern as DOWNBEAT plays it from the start with this seed: fills, density, groove, evolution', testid: 'export-performance' }),
            button('SONG', exp('song'), { help: 'The whole song, performed', testid: 'export-song' }),
            button('RECORDED TAKE', exp('take'), { help: 'Everything that played while REC TAKE was on, including your live changes', testid: 'export-take' }),
          ),
          h('label', { class: 'ctl', help: 'Notes are matched to voices by note number and placed on a sixteenth grid (up to 4 bars).' }, h('span', { class: 'lab', text: 'IMPORT MIDI' }), midiIn),
        ];
      },
      ['library'],
    );
  }

  // ---------------------------------------------------------------- MIDI

  midi(): void {
    const app = this.app;
    this.show(
      'MIDI',
      'midi-dialog',
      (r) => {
        const m = app.midi;
        const outSel = h('select', { testid: 'midi-out', 'aria-label': 'MIDI output' }, h('option', { value: '', text: '(NONE)' }), ...m.outputs().map((p) => h('option', { value: p.id, text: `${p.name}${p.connected ? '' : ' (disconnected)'}` })));
        outSel.value = app.prefs.midiOut ?? '';
        outSel.addEventListener('change', () => app.selectOutput(outSel.value || null));
        const inSel = h('select', { testid: 'midi-in', 'aria-label': 'MIDI input' }, h('option', { value: '', text: '(NONE)' }), ...m.inputs().map((p) => h('option', { value: p.id, text: `${p.name}${p.connected ? '' : ' (disconnected)'}` })));
        inSel.value = app.prefs.midiIn ?? '';
        inSel.addEventListener('change', () => app.selectInput(inSel.value || null));
        const bpm = app.sched.pulses.bpm();
        return [
          h('p', { text: m.message, testid: 'midi-message' }),
          m.state !== 'ready' && MidiAccess.supported() ? h('div', { class: 'btnrow' }, button('ENABLE MIDI', () => void app.enableMidi(), { cls: 'big', help: 'Ask the browser for MIDI access', testid: 'enable-midi' })) : null,
          h('h3', { text: 'OUTPUT' }),
          seg(r, { label: 'SEND TO', options: [['internal', 'INTERNAL SOUNDS'], ['midi', 'MIDI'], ['both', 'BOTH']] as const, get: () => app.prefs.output, set: (o) => app.setOutput(o), testid: 'dlg-output' }),
          h('label', { class: 'ctl' }, h('span', { class: 'lab', text: 'DEVICE' }), outSel),
          toggle(r, { label: 'SEND CLOCK + TRANSPORT', get: () => app.prefs.clockOut, set: (on) => app.setClockOut(on), help: '24 PPQN MIDI Clock with Start, Stop, Continue and Song Position (off while following external clock)', testid: 'dlg-clock-out' }),
          toggle(r, { label: 'PROGRAM CHANGES AT START', get: () => app.sched.programOnStart, set: (on) => ((app.sched.programOnStart = on), app.emit(['midi'])) }),
          h('label', { class: 'ctl' }, h('span', { class: 'lab', text: 'VOLUME' }), (() => {
            const v = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: app.prefs.volume, 'aria-label': 'internal volume', testid: 'volume' });
            v.addEventListener('input', () => app.setVolume(Number(v.value)));
            return v;
          })()),
          h('h3', { text: 'DRUM MAP' }),
          h('p', { class: 'hint', text: 'The MIDI channel and note each voice sends. Type a number (36) or a name (C1, where C3 = 60), use − / +, or press LEARN and hit a pad on the MIDI input. Voices with several sound steps: edit the others in the VOICE tab.' }),
          this.drumMap(r),
          h('h3', { text: 'INPUT AND SYNC' }),
          h('label', { class: 'ctl' }, h('span', { class: 'lab', text: 'DEVICE' }), inSel),
          seg(r, { label: 'CLOCK', options: [['internal', 'INTERNAL'], ['external', 'EXTERNAL']] as const, get: () => (app.sched.external ? 'external' : 'internal'), set: (s) => app.setClockSource(s), help: 'EXTERNAL: follow MIDI Clock and Start / Stop / Continue / Song Position from the input', testid: 'clock-source' }),
          h('p', { class: 'hint', testid: 'sync-detail', text: app.sched.external ? `Status: ${app.syncStatus.toUpperCase()}${bpm ? ` · incoming ${bpm.toFixed(1)} BPM` : ''}. Clock while stopped never starts DOWNBEAT; Start (FA) starts from the top, Continue (FB) from where Stop (FC) left off.` : 'Internal clock. Choose EXTERNAL to follow another instrument (for example a Hermod+ or a DAW).' }),
          toggle(r, { label: 'RECORD STRIKES FROM INPUT', get: () => app.recArmed, set: (on) => ((app.recArmed = on), app.emit(['midi'])), help: 'While playing, notes from the input that match a voice are written into the pattern at the nearest step', testid: 'rec-arm' }),
          h('h3', { text: 'NOTES' }),
          h('p', { class: 'hint', text: 'Each voice has its own channel and notes (DRUM MAP above, or the VOICE tab). PANIC sends All Notes Off and All Sound Off on every channel. No physical MIDI hardware was used in DOWNBEAT\'s automated tests.' }),
          app.midiLog.length ? h('pre', { class: 'hint', text: app.midiLog.slice(-8).join('\n') }) : null,
        ];
      },
      ['midi'],
    );
  }

  /** Every voice's channel and first note in one table. */
  private drumMap(r: Refreshers): HTMLElement {
    const app = this.app;
    const rows = app.project.voices.map((v) => {
      const note = noteControl(app, v.id, 0, `dm-note-${v.name}`);
      r.push(note.refresh);
      const ch = select(r, {
        options: () => Array.from({ length: 16 }, (_, i) => [String(i + 1), `CH ${i + 1}`] as const),
        get: () => String(app.project.voices.find((x) => x.id === v.id)?.channel ?? 10),
        set: (c) => app.setVoiceChannel(v.id, Number(c)),
        help: `MIDI channel for ${v.name}`,
        testid: `dm-ch-${v.name}`,
      });
      const more = v.notes.length > 1 ? button(`+${v.notes.length - 1} STEP${v.notes.length > 2 ? 'S' : ''}`, () => (this.close(), app.selectVoice(v.id, false), app.setTab('voice')), { cls: 'tiny', help: `${v.name} has ${v.notes.length} sound steps: edit the others in the VOICE tab` }) : h('span');
      return h('div', { class: 'dm-row', testid: `dm-${v.name}` }, h('span', { class: 'dm-name', style: `--vc: var(--v${v.color + 1})`, text: v.name }), ch, note.el, more, button('HEAR', () => app.auditionVoice(v.id), { cls: 'tiny', help: `Play ${v.name} now` }));
    });
    return h('div', { class: 'drum-map', testid: 'drum-map' }, ...rows);
  }

  // ---------------------------------------------------------------- PALETTE

  palette(): void {
    const app = this.app;
    const ps = app.palettes;
    this.show(
      'PALETTE',
      'palette-dialog',
      () => {
        const cur = ps.current();
        const list = h(
          'div',
          { class: 'list', testid: 'palettes' },
          ...ps.all().map((p) =>
            h(
              'div',
              { class: 'li' },
              h('span', { style: `display:inline-flex;border:1px solid ${p.colors.ink}` }, ...(['paper', 'ink', 'source', 'generated', 'suppressed', 'playhead', 'accent'] as const).map((r) => h('i', { style: `display:block;width:12px;height:16px;background:${p.colors[r]}` }))),
              h('span', { class: 'nm', text: `${p.name}${p.builtIn ? '' : ' (custom)'}` }),
              button(p.id === cur.id ? 'IN USE' : 'USE', () => (ps.select(p.id), app.applyPalette(), this.palette()), { cls: p.id === cur.id ? 'on' : '', testid: `palette-${p.id}` }),
              button('COPY', () => (ps.duplicate(p.id), app.applyPalette(), this.palette()), { cls: 'tiny', help: 'Make an editable copy' }),
              p.builtIn ? null : button('DELETE', () => (ps.remove(p.id), app.applyPalette(), this.palette()), { cls: 'tiny' }),
            ),
          ),
        );
        const warns = contrastWarnings(cur.colors);
        const sw = h(
          'div',
          { class: 'swatches' },
          ...ROLES.map((role) => {
            const inp = h('input', { type: 'color', value: cur.colors[role], disabled: cur.builtIn, 'aria-label': ROLE_INFO[role].label, testid: `swatch-${role}` });
            inp.addEventListener('input', () => {
              if (ps.setColor(cur.id, role, inp.value)) app.applyPalette();
            });
            inp.addEventListener('change', () => this.palette());
            return h('label', { help: ROLE_INFO[role].help }, inp, h('span', { text: ROLE_INFO[role].label }));
          }),
        );
        const imp = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'import palette', testid: 'import-palette' });
        const msg = h('p', { class: 'hint' });
        imp.addEventListener('change', async () => {
          const f = imp.files?.[0];
          if (!f) return;
          try {
            const res = importPalette(await f.text());
            ps.addImported(res);
            app.applyPalette();
            app.setStatus(`Imported palette "${res.name}" (${res.from} file${res.filled.length ? `; ${res.filled.length} roles filled from the default` : ''}).`);
            this.palette();
          } catch (e) {
            msg.textContent = e instanceof PaletteError ? e.message : 'Could not read that palette.';
          }
        });
        return [
          h('p', { class: 'hint', text: 'Palettes change colours only, never the music. Every distinction is also drawn by shape, so the 1-bit Classic palette works too. Palettes are kept in this browser, not in projects.' }),
          list,
          h('h3', { text: cur.builtIn ? `${cur.name.toUpperCase()} (COPY IT TO EDIT)` : `EDIT ${cur.name.toUpperCase()}` }),
          sw,
          warns.length ? h('p', { class: 'hint', testid: 'contrast-warnings', text: `Low contrast against paper: ${warns.map((w) => `${ROLE_INFO[w.role].label} ${w.ratio.toFixed(1)}:1`).join(', ')}.` }) : null,
          h('div', { class: 'btnrow' }, button('EXPORT PALETTE', () => app.download(`${cur.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.downbeat-palette.json`, exportPalette(cur), 'application/json'), { testid: 'export-palette' }), h('label', { class: 'ctl', help: 'DOWNBEAT, emmm and Feelers palette files' }, h('span', { class: 'lab', text: 'IMPORT' }), imp)),
          msg,
        ];
      },
    );
  }

  // ---------------------------------------------------------------- HELP

  help(): void {
    const sec = (t: string, ...ps: string[]) => [h('h4', { text: t }), ...ps.map((p) => h('p', { text: p }))];
    this.show('DOWNBEAT', 'help-dialog', () => [
      h(
        'div',
        { class: 'help-body' },
        ...sec('What it is', 'DOWNBEAT is an intelligent rhythm machine. You write a rhythm; DOWNBEAT plays a performance of it: thinning it, filling it, accenting it, shifting it, and in EXTENDED mode evolving, breeding and morphing it. What you wrote is never changed by the performance.'),
        ...sec(
          'The grid',
          'Solid bars are your strikes (taller = louder; accents have a cap). Hollow, struck-through bars are strikes that did not play this cycle. Diamonds are generated notes (fills), dots are extra hits, hatched bars were added by a mutation or morph. The blue column is the step playing; a blue frame marks each row\'s own position when it loops at its own length.',
        ),
        ...sec('Painting', 'Choose a striker (keys 1-5, 0 for random), click or drag across cells. Click a strike with the same striker to erase it; right-click erases; Alt-click adds a flam. Select a voice by clicking its name.'),
        ...sec(
          'CLASSIC',
          'Based on what is documented about Intelligent Music\'s UpBeat (1987-1990): five velocity strikers and a random striker, sound step lists with random steps, note density, ± timing, track shift, fills (sound, amount, rate, spacing, notes per gap, fill velocity), loop points with loop percentages, jam rolls, patterns, songs, MIDI files. See docs/CLASSIC_SPEC.md.',
        ),
        ...sec('EXTENDED', 'New to DOWNBEAT: probability per voice and step, groove and swing, a Euclidean generator, evolution (from the original or from the previous variation), breeding, morphing, WHEN/THEN rules and an autopilot with one ACTIVITY control. Each can be switched off; CLASSIC switches them all off.'),
        ...sec('Variations', 'NEW VARIATION picks a new seed. REPLAY restarts with the same seed: the identical take. LOCK repeats the variation you hear. SOURCE plays only what you wrote. CAPTURE writes what you hear into a new pattern.'),
        ...sec('Keys', 'Space play/pause · Esc stop · 1-5, 0 strikers · E eraser · F flam · P probability · [ ] shift voice · Cmd/Ctrl-Z undo · N new variation · R replay · S source · L lock · C capture · Up/Down select voice · H hear voice.'),
        ...sec('MIDI and sync', 'MIDI sends each voice on its own channel and notes. CLK OUT sends 24 PPQN clock with Start/Stop/Continue. In the MIDI dialog choose EXTERNAL to follow another instrument\'s clock. Internal sounds work without any equipment.'),
        ...sec(
          'About',
          'DOWNBEAT is an independent, clean-room instrument inspired by the musical ideas of Intelligent Music\'s UpBeat (John Offenhartz, 1987; version 2.0, 1990). It is not affiliated with or endorsed by Intelligent Music or the original developers, and contains none of their code, artwork or presets. One of a family of instruments with emmm, Feelers, FrakMC and ANVIL. MIT licence. Source: github.com/clickysteve/downbeat.',
        ),
      ),
    ]);
  }
}

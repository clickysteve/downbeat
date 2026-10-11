/** Left column: the pattern library and play mode. */
import type { App } from '../app/app';
import { AUDITION_ID } from '../engine/engine';
import { geometry } from '../engine/types';
import { button, clear, h, seg, type Refreshers } from './dom';

export class SideView {
  readonly el: HTMLElement;
  private list = h('div', { class: 'plist', testid: 'patterns' });
  private r: Refreshers = [];
  private sig = '';

  constructor(private app: App) {
    this.el = h(
      'div',
      { class: 'panel' },
      h('div', { class: 'panel-t' }, h('span', { text: 'PATTERNS' }), h('span', { class: 'sp' })),
      h('div', { class: 'btnrow' }, seg(this.r, { options: [['pattern', 'PATTERN'], ['song', 'SONG']] as const, get: () => app.project.playMode, set: (m) => app.setPlayMode(m), help: 'PATTERN: loop the selected pattern; selecting another cues it for the next cycle. SONG: play the arrangement (SONG tab).', testid: 'side-mode' })),
      this.list,
      h(
        'div',
        { class: 'btnrow' },
        button('NEW', () => app.newPattern(), { cls: 'tiny', help: 'New empty pattern', testid: 'side-new' }),
        button('DUP', () => app.duplicatePattern(), { cls: 'tiny', help: 'Duplicate the selected pattern', testid: 'side-dup' }),
        button('DEL', () => app.deletePattern(), { cls: 'tiny', help: 'Delete the selected pattern (undoable)', testid: 'side-del' }),
        button('+SONG', () => app.songAdd(), { cls: 'tiny', help: 'Add the selected pattern to the song', testid: 'side-song-add' }),
      ),
    );
    app.on(['project', 'pattern', 'song', 'transport', 'selection', 'feed', 'ext'], () => this.render());
    this.render();
  }

  render(): void {
    const app = this.app;
    for (const f of this.r) f();
    const playing = app.transport !== 'stopped' ? app.heard().plan?.patternId : null;
    const sig = `${app.project.patterns.map((p) => `${p.id}${p.name}${p.bars}${p.beats}${p.unit}${p.grid}${p.evolve.on}${!!p.evolve.locked}`).join(',')}:${app.project.current}:${playing}:${app.project.song.entries.map((e) => e.patternId + e.repeats).join(',')}:${!!app.engine.audition}`;
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.list);
    app.project.patterns.forEach((p, i) => {
      const g = geometry(p);
      const inSong = app.project.song.entries.filter((e) => e.patternId === p.id).length;
      const row = h(
        'div',
        {
          class: `prow${p.id === app.project.current && !app.engine.audition ? ' sel' : ''}${playing === p.id ? ' playing' : ''}`,
          testid: `pattern-${p.name}`,
          role: 'button',
          tabindex: 0,
          help: `${p.name}: ${p.beats}/${p.unit}, ${p.bars} bar${p.bars > 1 ? 's' : ''}, ${g.steps} steps${p.tempo ? `, ${p.tempo} BPM` : ''}${inSong ? `, in the song ${inSong}×` : ''}. Click to select${app.project.playMode === 'pattern' ? ' (and cue it while playing)' : ''}.`,
          on: {
            click: () => app.selectPattern(p.id),
            keydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter') app.selectPattern(p.id);
            },
          },
        },
        h('span', { class: 'meta', text: String(i + 1).padStart(2, '0') }),
        h('span', { class: 'nm', text: p.name }),
        h('span', { class: 'meta', text: `${p.beats}/${p.unit}${p.bars > 1 ? `×${p.bars}` : ''}${p.evolve.on ? ' EV' : ''}${p.evolve.locked ? ' LK' : ''}` }),
      );
      this.list.append(row);
    });
    if (app.engine.audition) this.list.append(h('div', { class: `prow sel${playing === AUDITION_ID ? ' playing' : ''}` }, h('span', { class: 'meta', text: '··' }), h('span', { class: 'nm', text: app.engine.audition.name }), h('span', { class: 'meta', text: 'AUD' })));
  }
}

/** The striker palette and edit operations above the grid. */
import type { App, Tool } from '../app/app';
import { noteName } from '../midi/messages';
import { button, clear, h } from './dom';

const STRIKERS = [
  { level: 1, name: 'GHOST', key: '1' },
  { level: 2, name: 'SOFT', key: '2' },
  { level: 3, name: 'NORMAL', key: '3' },
  { level: 4, name: 'LOUD', key: '4' },
  { level: 5, name: 'ACCENT', key: '5' },
];

export class ToolsView {
  readonly el = h('div', { class: 'tools', testid: 'tools' });
  private toolBtns: { el: HTMLElement; match: (t: Tool) => boolean }[] = [];
  private stepBox = h('span', { class: 'group', testid: 'sound-steps' });
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private pasteBtn: HTMLButtonElement;
  private probBtn: HTMLElement;

  constructor(private app: App) {
    const tools = h('span', { class: 'group' }, h('span', { class: 'lab', text: 'STRIKE' }));
    for (const s of STRIKERS) {
      const t = this.toolButton(
        { kind: 'strike', level: s.level },
        h('span', { class: 'glyph', style: `height:${4 + s.level * 3}px;${s.level === 5 ? 'border-top:3px solid var(--accent)' : ''}` }),
        `${s.name} striker (key ${s.key}): velocity ${'·'.repeat(s.level)}. Click a cell to paint; click again to erase.`,
        `tool-${s.level}`,
      );
      tools.append(t);
    }
    tools.append(this.toolButton({ kind: 'strike', level: 0 }, '?', 'RANDOM striker (key 0): picks a striker each time it plays, by the Random Velocity weights.', 'tool-0'));
    tools.append(this.toolButton({ kind: 'flam' }, 'FLAM', 'FLAM (key F): click a strike to add or remove a grace note just before it. Alt-click does the same with any tool.', 'tool-flam'));
    tools.append(this.toolButton({ kind: 'erase' }, 'ERASE', 'ERASER (key E). Right-click erases with any tool.', 'tool-erase'));
    this.probBtn = this.toolButton({ kind: 'prob', value: 50 }, 'P%', 'EXTENDED per-step PROBABILITY (key P): click a strike to give it a chance of playing; set the value with the number beside it.', 'tool-prob');
    const probVal = h('select', { testid: 'prob-value', 'aria-label': 'step probability' }, ...[90, 75, 50, 33, 25, 10, 100].map((v) => h('option', { value: v, text: v === 100 ? 'CLEAR' : `${v}%` })));
    probVal.addEventListener('change', () => this.app.setTool({ kind: 'prob', value: Number(probVal.value) }));
    probVal.value = '50';
    const probGroup = h('span', { class: 'group prob' }, this.probBtn, probVal);
    const ops = h(
      'span',
      { class: 'group' },
      button('◀', () => app.rotateTrack(-1), { cls: 'tiny', help: 'Shift the selected voice one step earlier (wraps around). Key [', testid: 'rot-left' }),
      button('▶', () => app.rotateTrack(1), { cls: 'tiny', help: 'Shift the selected voice one step later (wraps around). Key ]', testid: 'rot-right' }),
      button('◀◀', () => app.rotateTrack(-1, true), { cls: 'tiny', help: 'Shift every voice one step earlier', testid: 'rot-all-left' }),
      button('▶▶', () => app.rotateTrack(1, true), { cls: 'tiny', help: 'Shift every voice one step later', testid: 'rot-all-right' }),
      button('REV', () => app.reverseTrack(), { cls: 'tiny', help: 'Reverse the selected voice', testid: 'reverse' }),
      button('CLR', () => app.clearTrack(), { cls: 'tiny', help: 'Clear the selected voice (undoable)', testid: 'clear-track' }),
      button('COPY', () => app.copyTrack(), { cls: 'tiny', help: 'Copy the selected voice\'s strikes', testid: 'copy-track' }),
    );
    this.pasteBtn = button('PASTE', () => app.pasteTrack(), { cls: 'tiny', help: 'Paste strikes into the selected voice', testid: 'paste-track' });
    ops.append(this.pasteBtn);
    this.undoBtn = button('UNDO', () => app.undo(), { cls: 'tiny', help: 'Undo (Cmd/Ctrl-Z)', testid: 'undo' });
    this.redoBtn = button('REDO', () => app.redo(), { cls: 'tiny', help: 'Redo (Shift-Cmd/Ctrl-Z)', testid: 'redo' });
    this.el.append(tools, probGroup, this.stepBox, ops, h('span', { class: 'group' }, this.undoBtn, this.redoBtn));
    app.on(['selection', 'pattern', 'voices', 'mode', 'track'], () => this.refresh());
    this.refresh();
  }

  private toolButton(t: Tool, content: Node | string, help: string, testid: string): HTMLElement {
    const b = h('button', { type: 'button', class: 'tool', help, testid, on: { click: () => this.app.setTool(t) } }, content);
    const match = (x: Tool) => x.kind === t.kind && (x.kind !== 'strike' || (t.kind === 'strike' && x.level === t.level));
    this.toolBtns.push({ el: b, match });
    return b;
  }

  refresh(): void {
    const app = this.app;
    for (const b of this.toolBtns) b.el.classList.toggle('sel', b.match(app.sel.tool));
    (this.probBtn.parentElement as HTMLElement).hidden = !app.ext;
    if (!app.ext && app.sel.tool.kind === 'prob') app.sel.tool = { kind: 'strike', level: 3 };
    this.undoBtn.disabled = !app.canUndo;
    this.redoBtn.disabled = !app.canRedo;
    this.pasteBtn.disabled = !app.clipboard;
    const v = app.voice();
    clear(this.stepBox);
    if (v.notes.length > 1) {
      this.stepBox.append(h('span', { class: 'lab', text: 'SOUND' }));
      const opts: [number, string][] = v.notes.map((n, i) => [i + 1, `S:${i + 1}`] as [number, string]);
      opts.push([0, 'S:?']);
      for (const [s, l] of opts) {
        const title = s === 0 ? 'Random step: a different sound from the step list each time' : `Step ${s}: ${v.notes[s - 1]!.map(noteName).join('+')}`;
        const b = h('button', { type: 'button', class: `tiny${app.sel.soundStep === s ? ' on' : ''}`, text: l, help: `New strikes use ${title}. (Sound variation: each voice has a step list of notes.)`, testid: `sound-step-${s}`, on: { click: () => app.setSoundStep(s) } });
        this.stepBox.append(b);
      }
    }
  }
}

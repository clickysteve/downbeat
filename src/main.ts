import '@fontsource/silkscreen/400.css';
import './ui/style.css';
import { App } from './app/app';
import { Dialogs } from './ui/dialogs';
import { h } from './ui/dom';
import { GridView } from './ui/grid';
import { installKeys } from './ui/keys';
import { MonitorView } from './ui/monitor';
import { PanelsView } from './ui/panels';
import { SideView } from './ui/side';
import { ToolsView } from './ui/tools';
import { TopBar } from './ui/topbar';

const app = new App();
app.applyPalette();
const dialogs = new Dialogs(app);
const top = new TopBar(app, { file: () => dialogs.file(), midi: () => dialogs.midi(), palette: () => dialogs.palette(), help: () => dialogs.help(), samples: () => dialogs.sampleBank() });
const side = new SideView(app);
const tools = new ToolsView(app);
const grid = new GridView(app);
const panels = new PanelsView(app);
const monitor = new MonitorView(app);

grid.el.insertBefore(tools.el, grid.el.children[1] ?? null);

const msg = h('span', { class: 'msg', testid: 'status' });
const statusBar = h('footer', { class: 'status', role: 'status' }, msg, h('span', { class: 'keys', text: 'SPACE play · ESC stop · 1-5 strikers · [ ] shift · ⌘Z undo · ? help' }));
let hover: string | null = null;
const showStatus = () => {
  msg.textContent = hover ?? app.status;
  statusBar.classList.toggle('warn', !hover && app.statusKind === 'warn');
};
app.on('status', () => {
  hover = null;
  showStatus();
});
const helpAt = (el: EventTarget | null) => ((el as HTMLElement | null)?.closest?.('[data-help]') as HTMLElement | null)?.dataset.help ?? null;
document.addEventListener('mouseover', (e) => {
  hover = helpAt(e.target);
  showStatus();
});
document.addEventListener('focusin', (e) => {
  const t = helpAt(e.target);
  if (t) {
    hover = t;
    showStatus();
  }
});
showStatus();

const root = document.getElementById('app')!;
root.append(top.el, h('main', { class: 'main' }, h('div', { class: 'col left' }, side.el), h('div', { class: 'col center' }, grid.el, panels.el), monitor.el), statusBar);

installKeys(app, () => dialogs.open);

// Audio needs a user gesture: resume on the first interaction.
const unlock = () => {
  void app.ensureAudio();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// Remembered MIDI and clock choices.
if (app.prefs.midiEnabled) void app.enableMidi();
if (app.prefs.clockSource === 'external') app.setClockSource('external');

window.addEventListener('pagehide', () => app.flushAutosave());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') app.flushAutosave();
});

// Display loop: what is heard, drawn when it is heard. Never decides musical time.
const loop = () => {
  grid.frame();
  top.frame();
  monitor.frame();
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// For debugging and browser tests.
(window as unknown as { __downbeat: App; __dialogs: Dialogs }).__downbeat = app;
(window as unknown as { __dialogs: Dialogs }).__dialogs = dialogs;

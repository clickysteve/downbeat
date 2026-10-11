/** Keyboard shortcuts. Typing in a field never triggers them. */
import type { App } from '../app/app';

export function installKeys(app: App, dialogsOpen: () => boolean): void {
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (dialogsOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
      return;
    }
    if (mod || e.altKey) return;
    const k = e.key;
    const voices = app.project.voices;
    const vi = voices.findIndex((v) => v.id === app.sel.voice);
    switch (k) {
      case ' ':
        e.preventDefault();
        if (t?.tagName === 'BUTTON') t.blur();
        app.togglePlay();
        break;
      case 'Escape':
        app.stop();
        break;
      case '0':
      case '?':
        app.setTool({ kind: 'strike', level: 0 });
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        app.setTool({ kind: 'strike', level: Number(k) });
        break;
      case 'e':
        app.setTool({ kind: 'erase' });
        break;
      case 'f':
        app.setTool({ kind: 'flam' });
        break;
      case 'p':
        if (app.ext) app.setTool({ kind: 'prob', value: 50 });
        break;
      case '[':
        app.rotateTrack(-1);
        break;
      case ']':
        app.rotateTrack(1);
        break;
      case '{':
        app.rotateTrack(-1, true);
        break;
      case '}':
        app.rotateTrack(1, true);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (vi > 0) app.selectVoice(voices[vi - 1]!.id, false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (vi < voices.length - 1) app.selectVoice(voices[vi + 1]!.id, false);
        break;
      case 'h':
        app.auditionVoice(app.sel.voice);
        break;
      case 'm':
        app.toggleMute(app.sel.voice);
        break;
      case 'n':
        app.newVariation();
        break;
      case 'r':
        app.replay();
        break;
      case 's':
        app.toggleSource();
        break;
      case 'l':
        app.toggleLock();
        break;
      case 'c':
        app.captureVariation();
        break;
      default:
        return;
    }
  });
}

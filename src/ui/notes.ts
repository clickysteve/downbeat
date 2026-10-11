/**
 * The MIDI note control for one sound step of a voice: − / + by semitone,
 * type a number or a name (36, C1, F#1, or a chord 42+46), or LEARN from the
 * MIDI input. Refreshed in place, never rebuilt while it has focus.
 */
import type { App } from '../app/app';
import { noteName, parseNotes } from '../midi/messages';
import { h } from './dom';

export interface NoteControl {
  el: HTMLElement;
  refresh: () => void;
}

export function noteControl(app: App, voiceId: string, step: number, testid: string): NoteControl {
  const notes = () => app.project.voices.find((v) => v.id === voiceId)?.notes[step] ?? [];
  const label = () => app.project.voices.find((v) => v.id === voiceId)?.name ?? '';
  const input = h('input', { type: 'text', class: 'note-in', testid, 'aria-label': `MIDI note for ${label()} step ${step + 1}`, spellcheck: 'false', autocomplete: 'off' });
  const name = h('span', { class: 'note-name', testid: `${testid}-name` });
  const commit = () => {
    const parsed = parseNotes(input.value);
    if (!parsed) {
      app.setStatus(`"${input.value}" is not a MIDI note: use 0-127 or a name such as C1 or F#1 (C3 = 60).`, 'warn');
      refresh(true);
      return;
    }
    if (parsed.join('+') !== notes().join('+')) app.setVoiceNotes(voiceId, step, parsed);
    refresh(true);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commit();
      input.blur();
    } else if (e.key === 'Escape') {
      refresh(true);
      input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      app.shiftVoiceNotes(voiceId, step, e.key === 'ArrowUp' ? (e.shiftKey ? 12 : 1) : e.shiftKey ? -12 : -1);
      refresh(true);
    }
  });
  const dec = h('button', { type: 'button', class: 'tiny', text: '−', 'aria-label': 'note down', testid: `${testid}-dec`, help: 'One semitone down (Shift-↓ in the field: an octave)', on: { click: () => app.shiftVoiceNotes(voiceId, step, -1) } });
  const inc = h('button', { type: 'button', class: 'tiny', text: '+', 'aria-label': 'note up', testid: `${testid}-inc`, help: 'One semitone up (Shift-↑ in the field: an octave)', on: { click: () => app.shiftVoiceNotes(voiceId, step, 1) } });
  const learn = h('button', {
    type: 'button',
    class: 'tiny',
    text: 'LEARN',
    testid: `${testid}-learn`,
    help: 'Press, then hit a pad or key on the MIDI input: that note is assigned. Press again to cancel.',
    on: {
      click: () => {
        const l = app.learn;
        if (l && l.voice === voiceId && l.step === step) app.cancelLearn();
        else app.startLearn(voiceId, step);
      },
    },
  });
  const el = h('span', { class: 'note-ctl', help: 'MIDI note this voice sends: a number (36) or a name (C1, where C3 = 60); 42+46 sends a chord.' }, dec, input, inc, name, learn);
  function refresh(force = false) {
    const ns = notes();
    if (force || document.activeElement !== input) input.value = ns.join('+');
    name.textContent = ns.map(noteName).join('+');
    const l = app.learn;
    learn.classList.toggle('on', !!l && l.voice === voiceId && l.step === step);
    dec.disabled = ns.some((n) => n <= 0);
    inc.disabled = ns.some((n) => n >= 127);
  }
  refresh(true);
  return { el, refresh: () => refresh() };
}

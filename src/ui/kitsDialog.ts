/**
 * KITS (AUDIO → KITS): DOWNBEAT's view of Slop Factory Core's kit workflow. The current kit
 * (NEW, SAVE, SAVE AS, EXPORT, IMPORT), the saved kits (LOAD, DUPLICATE, RENAME, DELETE, SET
 * DEFAULT, EXPORT) with what a kit would do to the drum sounds before it is loaded, and the
 * sample library (import, preview, assign to a drum sound, delete). Everything that would lose
 * work asks first, in the window itself; loading a kit is undoable.
 *
 * Lists are keyboard-operable (Tab to a row, ↑ ↓ to move, Enter or Space to select); the global
 * shortcuts are off while a dialog is open, so typing a name never starts the transport.
 */
import { describeMapping, KitError, type KitMapping } from '@slopfactory/core/kits';
import type { App } from '../app/app';
import { downbeatTargets } from '../audio/kits';
import { audioOf, drumSounds } from '../audio/settings';
import { audioTabs } from './audioDialogs';
import type { Dialogs } from './dialogs';
import { button, h, seg } from './dom';

const KIT_ACCEPT = '.zip,application/zip';
const SAMPLE_ACCEPT = '.wav,.wave,.aif,.aiff,.aifc,.mp3,.ogg,.flac,.m4a,audio/*';

/** What the window remembers between rebuilds. */
const ui = {
  kit: '',
  sample: '',
  sound: '',
  name: null as string | null,
  rename: null as string | null,
  confirm: null as null | { text: string; ok: string; run: () => Promise<void> | void },
  preview: null as null | { id: string; lines: string[]; missing: number },
};

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A list of selectable rows: Enter / Space select, ↑ ↓ move. */
function listbox(label: string, testid: string, rows: { key: string; selected: boolean; onSelect: () => void; children: (HTMLElement | string | null)[]; testid?: string; help?: string }[], cls = ''): HTMLElement {
  const list = h('div', { class: `list ${cls}`, role: 'listbox', 'aria-label': label, testid });
  const els = rows.map((r) =>
    h(
      'div',
      { class: `li bank-row kit-row${r.selected ? ' sel' : ''}`, role: 'option', tabindex: 0, 'aria-selected': String(r.selected), testid: r.testid, help: r.help, on: { click: r.onSelect } },
      ...r.children,
    ),
  );
  els.forEach((el, i) =>
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return; // a button inside the row keeps its keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rows[i]!.onSelect();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        (els[i + (e.key === 'ArrowDown' ? 1 : -1)] as HTMLElement | undefined)?.focus();
      }
    }),
  );
  list.append(...els);
  return list;
}

export function kitsWindow(d: Dialogs, app: App): void {
  const kits = app.kits;
  const lib = app.kitLibrary;
  let samples: Awaited<ReturnType<typeof lib.listSamples>> = [];
  let usage = new Map<string, number>();
  let loaded = false;
  const refresh = async () => {
    await kits.refresh();
    samples = await lib.listSamples();
    usage = new Map();
    for (const k of kits.kits) for (const id of new Set((await lib.getKit(k.id))?.instruments.flatMap((i) => i.samples.map((s) => s.sample)) ?? [])) usage.set(id, (usage.get(id) ?? 0) + 1);
    loaded = true;
    app.emit(['kits']);
  };
  /** Run an action; failures go to the status line, nothing half-done. */
  const run = (f: () => Promise<void> | void) => async () => {
    ui.confirm = null;
    try {
      await f();
    } catch (e) {
      app.setStatus(e instanceof Error ? e.message : String(e), 'warn');
    }
    await refresh();
  };
  const ask = (text: string, ok: string, f: () => Promise<void> | void) => {
    ui.confirm = { text, ok, run: f };
    app.emit(['kits']);
  };
  /** Do `f`, first asking when it would discard unsaved kit changes. */
  const unlessDirty = (what: string, f: () => Promise<void>) => (kits.dirty ? ask(`The current sounds have unsaved kit changes. ${what} anyway? (UNDO brings the sounds back.)`, what.toUpperCase(), f) : void run(f)());
  /** SAVE / SAVE AS NEW: a taken name asks before that kit is replaced. */
  const save = async (asNew: boolean, replace = false): Promise<void> => {
    const name = (ui.name ?? kits.name).trim();
    try {
      await (asNew ? kits.saveAs(name, { replace }) : kits.save(name, { replace }));
      ui.name = null;
      app.setStatus(`Saved kit "${kits.name}" in this browser.`);
      await refresh();
    } catch (e) {
      if (e instanceof KitError && e.code === 'exists' && !replace) ask(`${e.message} Replace it with the current sounds?`, 'REPLACE', () => save(asNew, true));
      else app.setStatus(e instanceof Error ? e.message : String(e), 'warn');
    }
  };
  const describe = (m: KitMapping) => describeMapping(m, { sampleName: (r) => r.name ?? samples.find((s) => s.id === r.sample)?.name ?? r.sample.slice(0, 8) });
  const selectKit = (id: string) => {
    ui.kit = id;
    ui.rename = null;
    ui.preview = null;
    app.emit(['kits']);
    void kits.preview(id).then((p) => {
      ui.preview = { id, lines: describe(p.mapping), missing: p.missing.length };
      app.emit(['kits']);
    }, () => {});
  };
  const report = (m: KitMapping | undefined, what: string) => {
    const kept = m?.unmapped.length ?? 0;
    app.setStatus(`${what}.${kept ? ` ${kept} instrument${kept === 1 ? '' : 's'} DOWNBEAT does not play ${kept === 1 ? 'is' : 'are'} kept in the kit (see KITS).` : ''}`);
  };

  const kitFile = h('input', { type: 'file', accept: KIT_ACCEPT, hidden: true, testid: 'kit-file', 'aria-label': 'kit file' });
  kitFile.addEventListener('change', () => {
    const f = kitFile.files?.[0];
    kitFile.value = '';
    if (!f) return;
    const go = run(async () => {
      if (f.size > 512 * 1024 * 1024) throw new Error('The kit file is larger than 512 MB.');
      const r = await kits.importFile(new Uint8Array(await f.arrayBuffer()), { save: true });
      ui.kit = r.kit.id;
      report(r.mapping, `Imported kit "${r.kit.name}"${r.renamed ? ' (renamed: the name was taken)' : ''}${r.added ? `, ${r.added} new sample${r.added === 1 ? '' : 's'}` : ''} and loaded it`);
    });
    if (kits.dirty) ask('The current sounds have unsaved kit changes. Import and load the kit anyway? (UNDO brings the sounds back.)', 'IMPORT', go);
    else void go();
  });
  const sampleFiles = h('input', { type: 'file', accept: SAMPLE_ACCEPT, multiple: true, hidden: true, testid: 'library-files', 'aria-label': 'sample files' });
  sampleFiles.addEventListener('change', () => {
    const fs = [...(sampleFiles.files ?? [])];
    sampleFiles.value = '';
    if (fs.length) void run(async () => void (await app.importSamples(fs)))();
  });

  const structure = () => JSON.stringify([loaded, kits.kits, kits.defaultId, kits.currentId, kits.name, kits.dirty, ui, samples.map((s) => s.id), [...usage], drumSounds(app.project).map((x) => [x.key, x.label]), audioOf(app.project).sounds, app.otherSounds]);

  d.show(
    'KITS',
    'kits-dialog',
    (r) => {
      const sounds = drumSounds(app.project);
      const a = audioOf(app.project);
      const current = sounds.find((s) => s.key === ui.sound) ?? sounds[0];
      if (current) ui.sound = current.key;
      const kitSel = kits.kits.find((k) => k.id === ui.kit) ?? null;
      const sample = samples.find((s) => s.id === ui.sample) ?? null;
      const nameIn = h('input', { type: 'text', value: ui.name ?? kits.name, maxlength: 64, testid: 'kit-name', 'aria-label': 'kit name' });
      nameIn.addEventListener('input', () => (ui.name = nameIn.value));
      nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), void save(false)));
      const renameIn = h('input', { type: 'text', value: ui.rename ?? kitSel?.name ?? '', maxlength: 64, testid: 'kit-rename', 'aria-label': 'new name for the selected kit' });
      renameIn.addEventListener('input', () => (ui.rename = renameIn.value));
      const doRename = run(async () => {
        if (!kitSel) return;
        await kits.rename(kitSel.id, renameIn.value);
        ui.rename = null;
      });
      renameIn.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), void doRename()));
      const usedBy = (id: string) => sounds.filter((s) => a.sounds[s.voice.id]?.[s.step]?.sampleId === id).map((s) => s.label);
      const targetsTip = `Drum sounds and their roles: ${downbeatTargets(app.project).map((t) => `${t.label} = ${t.role}`).join(', ')}.`;
      return [
        audioTabs(d, app, 'kits'),
        h('p', { class: 'hint', text: 'A kit is the samples of the drum sounds (SAMPLE BANK): which sample each plays, and how. Loading one changes only those, as one undoable step: patterns, voices, the mixer and MIDI stay. Kits and samples are kept in this browser; a kit file (EXPORT) carries a kit with its audio to another browser, or to The Breakery.' }),
        ui.confirm
          ? h('div', { class: 'kit-confirm', role: 'alertdialog', 'aria-label': 'confirm', testid: 'kit-confirm' }, h('span', { class: 'nm', text: ui.confirm.text }), button(ui.confirm.ok, () => void run(ui.confirm!.run)(), { cls: 'warn', testid: 'kit-confirm-ok' }), button('CANCEL', () => ((ui.confirm = null), app.emit(['kits'])), { testid: 'kit-confirm-cancel' }))
          : null,

        h('h3', { text: `CURRENT KIT${kits.dirty ? ' · UNSAVED CHANGES' : kits.currentId ? ' · SAVED' : ''}` }),
        h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'NAME' }), nameIn),
        h(
          'div',
          { class: 'btnrow' },
          button('SAVE', () => void save(false), { help: kits.currentId ? 'Save the current sounds over this kit (renamed to NAME if you changed it)' : 'Save the current sounds as a new kit named NAME', testid: 'kit-save' }),
          button('SAVE AS NEW', () => void save(true), { help: 'Save the current sounds as a new kit named NAME', testid: 'kit-save-as' }),
          button('NEW KIT', () => unlessDirty('Start a new kit', async () => void (await kits.newKit())), { help: 'Every drum sound back to its internal sound (undoable)', testid: 'kit-new' }),
          button('EXPORT KIT', run(async () => {
            const f = await kits.exportCurrent((ui.name ?? kits.name).trim() || kits.name);
            app.download(f.fileName, new Blob([f.bytes as BlobPart], { type: 'application/zip' }), 'application/zip');
            app.setStatus(`Exported ${f.fileName}: the current sounds with their audio (for DOWNBEAT in another browser, or The Breakery).`);
          }), { help: 'Download the current sounds (unsaved changes included) as a portable kit file with their audio', testid: 'kit-export' }),
          kitFile,
          button('IMPORT KIT…', () => kitFile.click(), { help: 'Open a kit file (.kit.zip from DOWNBEAT or The Breakery): it is saved here and loaded', testid: 'kit-import' }),
        ),

        h('h3', { text: `SAVED KITS (${kits.kits.length})` }),
        kits.kits.length
          ? listbox('saved kits', 'kit-list', kits.kits.map((k) => ({
              key: k.id,
              selected: k.id === ui.kit,
              onSelect: () => selectKit(k.id),
              testid: `kit-${k.name}`,
              children: [h('span', { class: 'nm', text: `${k.id === kits.defaultId ? '★ ' : ''}${k.name}${k.id === kits.currentId ? ' (CURRENT)' : ''}` }), h('span', { class: 'd', text: `${k.samples} SAMPLE${k.samples === 1 ? '' : 'S'}${k.bundled ? ' · BUNDLED' : ''} · ${new Date(k.modified).toLocaleDateString()}` })],
            })))
          : h('p', { class: 'hint', text: lib.persistent ? 'No saved kits yet: SAVE keeps the current sounds as one.' : 'This browser is not letting DOWNBEAT store kits: EXPORT KIT still works.' }),
        kitSel
          ? h(
              'div',
              { class: 'kit-detail', testid: 'kit-detail' },
              h(
                'div',
                { class: 'btnrow' },
                button('LOAD', () => unlessDirty('Load the kit', async () => report(await kits.load(kitSel.id), `Loaded kit "${kitSel.name}"`)), { cls: 'big', help: 'Play this kit on the drum sounds (undoable)', testid: 'kit-load' }),
                seg(r, {
                  label: 'OTHER SOUNDS',
                  options: [['keep', 'KEEP'], ['internal', 'INTERNAL']] as const,
                  get: () => app.otherSounds,
                  set: (v) => ((app.otherSounds = v), app.emit(['kits'])),
                  helps: { keep: 'Drum sounds the kit has nothing for keep what they play', internal: 'Drum sounds the kit has nothing for go back to their internal sounds' },
                  testid: 'kit-others',
                }),
                button('DUPLICATE', run(async () => void (ui.kit = (await kits.duplicate(kitSel.id)).id)), { help: 'Copy this kit (its samples are shared, not copied)', testid: 'kit-duplicate' }),
                button('EXPORT', run(async () => {
                  const f = await kits.exportSaved(kitSel.id);
                  app.download(f.fileName, new Blob([f.bytes as BlobPart], { type: 'application/zip' }), 'application/zip');
                }), { help: 'Download this kit as a portable kit file with its audio', testid: 'kit-export-saved' }),
                button(kitSel.id === kits.defaultId ? 'UNSET DEFAULT' : 'SET DEFAULT', run(() => kits.setDefault(kitSel.id === kits.defaultId ? null : kitSel.id)), { help: 'The default kit is marked ★ (DOWNBEAT keeps your project\'s sounds at startup; the default is the kit to reach for)', testid: 'kit-default' }),
                button('DELETE', () => ask(`Delete the kit "${kitSel.name}"? Its samples stay in the library; samples other kits use are never deleted.`, 'DELETE', async () => {
                  await kits.delete(kitSel.id);
                  ui.kit = '';
                }), { cls: 'warn', testid: 'kit-delete' }),
              ),
              h('div', { class: 'ctl' }, h('span', { class: 'lab', text: 'RENAME' }), renameIn, button('RENAME', doRename, { testid: 'kit-rename-go' })),
              ui.preview?.id === kitSel.id
                ? h('div', { class: 'list kit-map', testid: 'kit-mapping', help: targetsTip }, h('div', { class: 'li' }, h('b', { text: 'LOADING IT WOULD PLAY' })), ...ui.preview.lines.map((l) => h('div', { class: 'li', text: l })), ui.preview.missing ? h('div', { class: 'li warn-text', text: `${ui.preview.missing} sample${ui.preview.missing === 1 ? ' is' : 's are'} not in this browser: import the kit file again.` }) : null)
                : null,
            )
          : null,

        h('h3', { text: `SAMPLE LIBRARY (${samples.length})` }),
        (() => {
          const drop = h('div', { class: 'dropzone', testid: 'library-drop', help: 'Drop sample files here to import them into the library' }, 'DROP SAMPLE FILES HERE · OR ', sampleFiles, button('IMPORT SAMPLES…', () => sampleFiles.click(), { testid: 'library-import' }));
          drop.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            drop.classList.add('drop');
          });
          drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
          drop.addEventListener('drop', (e) => {
            drop.classList.remove('drop');
            const fs = [...(e.dataTransfer?.files ?? [])];
            if (!fs.length) return;
            e.preventDefault();
            void run(async () => void (await app.importSamples(fs)))();
          });
          return drop;
        })(),
        samples.length
          ? listbox('samples in this browser', 'library-list', samples.map((s) => ({
              key: s.id,
              selected: s.id === ui.sample,
              onSelect: () => ((ui.sample = s.id), app.emit(['kits'])),
              testid: `sample-${s.name}`,
              children: [
                button('▶', (e) => (e.stopPropagation(), void app.previewSample(s.id)), { cls: 'tiny', help: `Hear ${s.name} (on its own)`, testid: `preview-${s.name}` }),
                h('span', { class: 'nm', text: s.name }),
                h('span', { class: 'd', text: [s.duration ? `${s.duration.toFixed(2)} s` : '', s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '', s.channels ? (s.channels === 1 ? 'MONO' : 'STEREO') : '', s.format.toUpperCase(), s.size ? kb(s.size) : '', `${usage.get(s.id) ?? 0} KIT${usage.get(s.id) === 1 ? '' : 'S'}`, usedBy(s.id).length ? `ON ${usedBy(s.id).join(', ')}` : ''].filter(Boolean).join(' · ') }),
              ],
            })), 'library-list')
          : h('p', { class: 'hint', text: 'No samples yet: import some, or a kit.' }),
        h(
          'div',
          { class: 'btnrow' },
          h('span', { class: 'lab', text: 'ASSIGN TO' }),
          ...(current ? [h('span', { class: 'chip', testid: 'assign-target', text: current.label })] : []),
          button(sample && current ? `ASSIGN ${sample.name.slice(0, 24)} → ${current.label}` : 'ASSIGN', run(async () => {
            if (!sample || !current) throw new Error('Select a sample and a drum sound first.');
            await app.assignLibrarySample(current.key, sample.id);
          }), { cls: 'big', help: 'The selected drum sound plays the selected sample (undoable; the SAMPLE BANK has its settings)', testid: 'library-assign' }),
          button('PREVIEW', () => sample && void app.previewSample(sample.id), { help: 'Hear the selected sample on its own', testid: 'library-preview' }),
          button('DELETE SAMPLE', () => sample && ask(`Delete "${sample.name}" from this browser? (Refused while a kit or a project uses it.)`, 'DELETE', async () => {
            await lib.removeSample(sample.id);
            app.audition.forget(sample.id);
            ui.sample = '';
          }), { cls: 'warn', testid: 'library-delete' }),
          button('DELETE UNUSED', () => ask('Delete every sample that no saved kit and no project in this browser uses?', 'DELETE', async () => void app.setStatus(`Deleted ${await app.purgeSamples()} unused sample(s).`)), { testid: 'library-delete-unused' }),
        ),
        listbox('drum sounds', 'assign-list', sounds.map((s) => {
          const slot = a.sounds[s.voice.id]?.[s.step];
          return {
            key: s.key,
            selected: s.key === ui.sound,
            onSelect: () => ((ui.sound = s.key), app.emit(['kits'])),
            testid: `assign-${s.label}`,
            children: [h('span', { class: 'bank-name', style: `--vc: var(--v${s.voice.color + 1})`, text: s.label }), h('span', { class: 'nm', text: slot?.source === 'sample' && slot.sampleId ? slot.name : `INTERNAL ${s.voice.sound.kind.toUpperCase()}` }), button('HEAR', (e) => (e.stopPropagation(), app.auditionSound(s.key)), { cls: 'tiny', help: `Play ${s.label} now`, testid: `kit-hear-${s.label}` })],
          };
        }), 'assign-list'),
      ];
    },
    ['audio', 'voices', 'kits'],
    structure,
  );
  if (!loaded) void refresh();
}

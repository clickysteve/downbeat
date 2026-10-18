/**
 * The SAMPLE BANK, OUTPUT PROCESSING, OUTPUT CHAIN and EXPORT AUDIO windows (in DOWNBEAT's
 * dialog style). All audio work is done by Slop Factory Core through the App; these only edit
 * settings. The OUTPUT CHAIN's controls are built from the engines' parameter descriptions.
 */
import { DRIVE_SHAPES, FX_PRESETS, fxLabel, matchPreset, OUTPUT_STAGE_MODES, stretchCharacters, type OutputFxSettings } from '@slopfactory/core/dsp';
import { formatParam, matchChainPreset, OutputChain, presetsFor, type ParamDef } from '@slopfactory/core/engines';
import { MAX_RENDER_SECONDS } from '@slopfactory/core/render';
import { waveformPeaks } from '@slopfactory/core/sampler';
import type { App } from '../app/app';
import { defaultExportOptions, planExport, type AudioExportOptions, type ExportResult } from '../audio/export';
import { chainOf, OUTPUT_ENGINES } from '../audio/output';
import { audioOf, CHOKE_GROUPS, chokeFor, chokeLabel, drumSounds, type DrumSound } from '../audio/settings';
import { AUDITION_ID } from '../engine/engine';
import { noteName } from '../midi/messages';
import type { Dialogs } from './dialogs';
import { button, h, seg, select, slider, stepper, toggle } from './dom';

const SAMPLE_ACCEPT = '.wav,.wave,.aif,.aiff,.aifc,.mp3,.ogg,.flac,.m4a,audio/*';

/** The row that switches between the audio windows. */
function audioTabs(d: Dialogs, app: App, current: 'bank' | 'fx' | 'chain' | 'export'): HTMLElement {
  const tab = (id: 'bank' | 'fx' | 'chain' | 'export', label: string, open: () => void, help: string) => h('button', { type: 'button', class: id === current ? 'on' : '', text: label, help, testid: `audio-tab-${id}`, 'aria-pressed': String(id === current), on: { click: () => id !== current && open() } });
  return h(
    'div',
    { class: 'seg audio-tabs', role: 'group' },
    tab('bank', 'SAMPLE BANK', () => sampleBank(d, app), 'Samples for the drum sounds, choke groups, sample transformations'),
    tab('fx', 'PROCESSING', () => outputFx(d, app), 'Output processing per voice and on the master'),
    tab('chain', 'OUTPUT CHAIN', () => outputChain(d, app), 'A chain of output engines on the master, before VOLUME'),
    tab('export', 'EXPORT AUDIO', () => exportAudioDialog(d, app), 'Render WAV: master, voice stems, drum-sound stems'),
  );
}

const notesText = (ns: number[]) => ns.map((n) => `${n} ${noteName(n)}`).join(' + ');

async function readFile(f: File): Promise<{ bytes: ArrayBuffer; name: string; type: string }> {
  return { bytes: await f.arrayBuffer(), name: f.name, type: f.type };
}

/** Let an element take dropped audio files. */
function dropTarget(el: HTMLElement, onFile: (f: File) => void): void {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    onFile(f);
  });
}

// ---------------------------------------------------------------- SAMPLE BANK

const bank = { sel: '' };

export function sampleBank(d: Dialogs, app: App, select0?: string): void {
  if (select0) bank.sel = select0;
  const sounds = () => drumSounds(app.project);
  const cur = (): DrumSound | undefined => sounds().find((s) => s.key === bank.sel) ?? sounds()[0];
  const fileIn = h('input', { type: 'file', accept: SAMPLE_ACCEPT, hidden: true, testid: 'sample-file', 'aria-label': 'sample file' });
  const load = async (key: string, f: File) => {
    bank.sel = key;
    await app.loadSample(key, await readFile(f));
  };
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    const s = cur();
    fileIn.value = '';
    if (f && s) await load(s.key, f);
  });
  const structure = () => {
    const a = audioOf(app.project);
    return JSON.stringify([
      cur()?.key,
      sounds().map((s) => {
        const slot = a.sounds[s.voice.id]?.[s.step];
        return [s.key, s.label, s.notes, slot?.source, slot?.sampleId, slot?.name, slot?.transform.enabled, slot?.zone.mode, slot?.choke, app.library.state(s.key).status, app.library.state(s.key).message, s.voice.sound.kind];
      }),
    ]);
  };
  d.show(
    'SAMPLE BANK',
    'sample-bank',
    (r) => {
      const all = sounds();
      const s = cur();
      if (s) bank.sel = s.key;
      const a = audioOf(app.project);
      const rows = all.map((x) => {
        const slot = a.sounds[x.voice.id]?.[x.step];
        const st = app.library.state(x.key);
        const usesSample = slot?.source === 'sample';
        const what = usesSample ? (slot?.sampleId ? (st.status === 'ready' ? slot.name : `${slot.name} (${st.status.toUpperCase()})`) : 'NO SAMPLE: INTERNAL') : x.voice.sound.kind === 'none' ? 'NONE' : `INTERNAL ${x.voice.sound.kind.toUpperCase()}`;
        const row = h(
          'div',
          {
            class: `li bank-row${x.key === bank.sel ? ' sel' : ''}${usesSample && st.status !== 'ready' && slot?.sampleId ? ' bad' : ''}`,
            testid: `bank-${x.label}`,
            help: `${x.label}: ${notesText(x.notes)}. Click to edit; drop a sample file here to load it.`,
            on: { click: () => ((bank.sel = x.key), sampleBank(d, app)) },
          },
          h('span', { class: 'bank-name', style: `--vc: var(--v${x.voice.color + 1})`, text: x.label }),
          h('span', { class: 'bank-note', text: notesText(x.notes) }),
          h('span', { class: `bank-src${usesSample ? ' on' : ''}`, text: usesSample ? 'SMP' : 'INT' }),
          h('span', { class: 'nm bank-what', text: what }),
          h('span', { class: 'd', text: slot && chokeFor(slot, x.voice.sound.kind) ? `CHOKE ${chokeLabel(slot.choke)}` : '' }),
          button('HEAR', (e) => (e.stopPropagation(), app.auditionSound(x.key)), { cls: 'tiny', help: `Play ${x.label} now, through its voice's processing`, testid: `hear-${x.label}` }),
        );
        dropTarget(row, (f) => void load(x.key, f));
        return row;
      });
      const list = h('div', { class: 'list bank-list', testid: 'bank-list' }, ...rows);
      if (!s) return [audioTabs(d, app, 'bank'), h('p', { text: 'No drum sounds.' })];
      const key = s.key;
      const slot = () => app.sound(key)!;
      const st = app.library.state(key);
      const zone = () => slot().zone;
      const hasSample = !!slot().sampleId;
      const auto = chokeFor({ ...slot(), choke: { mode: 'auto', group: 1, role: 'both' } }, s.voice.sound.kind);
      const wave = h('canvas', { class: 'wave', width: 600, height: 56, testid: 'waveform', 'aria-label': 'waveform' });
      if (st.audio) drawWave(wave, st.audio);
      const drop = h('div', { class: 'dropzone', testid: 'sample-drop', help: 'Drop a WAV (or AIFF, MP3, OGG, FLAC) file here, or press LOAD' }, hasSample ? `${slot().name}${st.status === 'ready' ? ` · ${(st.sampleRate / 1000).toFixed(1)} kHz · ${st.channels === 1 ? 'MONO' : 'STEREO'} · ${st.duration.toFixed(2)} s` : ` · ${st.status.toUpperCase()}`}` : 'DROP A SAMPLE FILE HERE', hasSample ? wave : null);
      dropTarget(drop, (f) => void load(key, f));
      const chars = stretchCharacters().flatMap((g) => g.characters.map((c) => [c.key, `${g.label}: ${c.label}`] as const));
      const tf = () => slot().transform;
      const zoneOff = () => !hasSample;
      const tfOff = () => !hasSample || !tf().enabled;
      return [
        audioTabs(d, app, 'bank'),
        h('p', { class: 'hint', text: `Every drum sound is one sound step of one voice (${all.length} here). It plays its voice's INTERNAL sound, as always, or a SAMPLE. Fills that borrow another voice's sound play that voice's drum sounds.` }),
        list,
        h('h3', { text: `${s.label} · ${s.voice.name} STEP ${s.step + 1} · ${notesText(s.notes)}` }),
        seg(r, {
          label: 'SOURCE',
          options: [['internal', 'INTERNAL'], ['sample', 'SAMPLE']] as const,
          get: () => slot().source,
          set: (v) => app.setSoundSource(key, v),
          helps: { internal: `The voice's internal synthesised sound (${s.voice.sound.kind.toUpperCase()})`, sample: 'The loaded sample (the internal sound plays while it is missing or loading)' },
          testid: 'sound-source',
        }),
        drop,
        h('div', { class: 'btnrow' }, fileIn, button(hasSample ? 'REPLACE…' : 'LOAD…', () => fileIn.click(), { help: 'Load a sample file into this drum sound', testid: 'sample-load' }), hasSample ? button('CLEAR', () => app.clearSample(key), { help: 'Remove the sample: the internal sound plays again', testid: 'sample-clear' }) : null, button('AUDITION', () => app.auditionSound(key), { cls: 'big', help: 'Play this drum sound now', testid: 'sample-audition' })),
        st.message ? h('p', { class: 'hint warn-text', testid: 'sample-message', text: st.message }) : null,
        h('h3', { text: 'SAMPLE PLAYBACK' }),
        h(
          'div',
          { class: 'grid2' },
          slider(r, { label: 'VOLUME', min: 0, max: 2, step: 0.01, get: () => zone().volume, set: (v) => app.setSoundZone(key, { volume: v }), fmt: (v) => `${Math.round(v * 100)}%`, testid: 'zone-volume', disabled: zoneOff }),
          slider(r, { label: 'PAN', min: -1, max: 1, step: 0.01, get: () => zone().pan, set: (v) => app.setSoundZone(key, { pan: v }), fmt: (v) => (Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`), testid: 'zone-pan', disabled: zoneOff }),
          stepper(r, { label: 'TUNE', min: -24, max: 24, get: () => zone().tune, set: (v) => app.setSoundZone(key, { tune: Math.round(v) }), fmt: (v) => `${v > 0 ? '+' : ''}${v} st`, help: 'Semitones; the sample plays at its own pitch for the step\'s note at 0', testid: 'zone-tune' }),
          stepper(r, { label: 'FINE', min: -100, max: 100, step: 5, get: () => zone().fine, set: (v) => app.setSoundZone(key, { fine: Math.round(v) }), fmt: (v) => `${v > 0 ? '+' : ''}${v} ct`, help: 'Cents', testid: 'zone-fine' }),
          slider(r, { label: 'VEL SENS', min: 0, max: 1, step: 0.05, get: () => zone().velocitySens, set: (v) => app.setSoundZone(key, { velocitySens: v }), fmt: (v) => `${Math.round(v * 100)}%`, help: 'How much velocity (the strikers) changes the level', testid: 'zone-vel', disabled: zoneOff }),
          slider(r, { label: 'RELEASE', min: 0.005, max: 2, step: 0.005, get: () => zone().release, set: (v) => app.setSoundZone(key, { release: v }), fmt: (v) => `${Math.round(v * 1000)} ms`, help: 'Fade after the note ends (GATED and LOOP)', testid: 'zone-release', disabled: () => zoneOff() || zone().mode === 'oneshot' }),
        ),
        seg(r, {
          label: 'MODE',
          options: [['oneshot', 'ONE SHOT'], ['gated', 'GATED'], ['loop', 'LOOP']] as const,
          get: () => zone().mode,
          set: (v) => app.setSoundZone(key, { mode: v }),
          helps: { oneshot: 'Plays the whole sample; repeated hits overlap (unless a choke group cuts them)', gated: 'Stops after the voice\'s GATE length, with RELEASE', loop: 'Loops while the note lasts' },
          testid: 'zone-mode',
        }),
        h('h3', { text: 'CHOKE GROUP' }),
        seg(r, {
          label: 'CHOKE',
          options: [['auto', 'AUTO'], ['off', 'OFF'], ['group', 'GROUP']] as const,
          get: () => slot().choke.mode,
          set: (v) => app.setSoundChoke(key, { mode: v }),
          helps: { auto: 'As DOWNBEAT always did: a voice whose internal sound is HAT cuts ringing OPEN HAT voices', off: 'Never cuts and is never cut', group: 'Cuts, or is cut by, the other sounds in the same group (on any voice)' },
          testid: 'choke-mode',
        }),
        slot().choke.mode === 'group'
          ? h(
              'div',
              { class: 'btnrow' },
              seg(r, { label: 'GROUP', options: Array.from({ length: CHOKE_GROUPS }, (_, i) => [i + 1, String(i + 1)] as const), get: () => slot().choke.group, set: (v) => app.setSoundChoke(key, { group: v }), testid: 'choke-group' }),
              seg(r, {
                label: 'ROLE',
                options: [['both', 'CUTS + CUT BY'], ['cuts', 'CUTS'], ['cutby', 'CUT BY']] as const,
                get: () => slot().choke.role,
                set: (v) => app.setSoundChoke(key, { role: v }),
                helps: { both: 'Cuts the group and can be cut (also cuts its own previous hit)', cuts: 'Only cuts the others (a closed hat)', cutby: 'Only gets cut (an open hat)' },
                testid: 'choke-role',
              }),
            )
          : h('p', { class: 'hint', testid: 'choke-note', text: slot().choke.mode === 'off' ? 'No choke.' : auto ? (auto.cuts === false ? 'AUTO: this OPEN HAT sound is cut by HAT sounds.' : 'AUTO: this HAT sound cuts ringing OPEN HAT sounds.') : `AUTO: no choke for a ${s.voice.sound.kind.toUpperCase()} sound.` }),
        h('h3', { text: 'SAMPLE TRANSFORMATION (WHOLE SAMPLE, BEFORE PLAYBACK)' }),
        h(
          'div',
          { class: 'btnrow' },
          toggle(r, { label: 'TRANSFORM', get: () => tf().enabled, set: (v) => app.setSoundTransform(key, { enabled: v }), help: 'Good Bits STRETCH FX applied once to the sample (the original is kept); computed in the background and cached', testid: 'tf-on' }),
          st.status === 'processing' ? h('span', { class: 'chip', testid: 'tf-processing', text: 'PROCESSING…' }) : null,
        ),
        h(
          'div',
          { class: 'grid2' },
          select(r, { label: 'CHARACTER', options: () => chars, get: () => tf().character, set: (v) => app.setSoundTransform(key, { character: v }), help: 'Stretch engine (Good Bits names)', testid: 'tf-character' }),
          slider(r, { label: 'STRETCH', min: 0.25, max: 4, step: 0.05, get: () => tf().ratio, set: (v) => app.setSoundTransform(key, { ratio: v }), fmt: (v) => `×${v.toFixed(2)}`, help: 'Output length / input length (1 = no stretch)', testid: 'tf-ratio', disabled: tfOff }),
          stepper(r, { label: 'PITCH', min: -24, max: 24, get: () => tf().pitch, set: (v) => app.setSoundTransform(key, { pitch: Math.round(v) }), fmt: (v) => `${v > 0 ? '+' : ''}${v} st`, help: 'Varispeed pitch in semitones (the length changes with it)', testid: 'tf-pitch' }),
          seg(r, { label: 'REVERSE', options: [['none', 'OFF'], ['pre', 'BEFORE'], ['post', 'AFTER']] as const, get: () => tf().reverse, set: (v) => app.setSoundTransform(key, { reverse: v }), help: 'Reverse before or after the stretch', testid: 'tf-reverse' }),
          slider(r, { label: 'DRIVE', min: 0, max: 100, step: 5, get: () => (tf().drive.enabled ? tf().drive.amountPct : 0), set: (v) => app.setSoundTransform(key, { drive: { ...tf().drive, enabled: v > 0, amountPct: v || tf().drive.amountPct } }), fmt: (v) => `${v}%`, help: 'Tape drive baked into the sample (0 = off)', testid: 'tf-drive', disabled: tfOff }),
          slider(r, { label: 'CRUNCH', min: 1, max: 16, step: 1, get: () => (tf().crunch.enabled ? tf().crunch.bits : 16), set: (v) => app.setSoundTransform(key, { crunch: { ...tf().crunch, enabled: v < 16, bits: v } }), fmt: (v) => (v >= 16 ? 'OFF' : `${v} BIT`), help: 'Bit depth baked into the sample (16 = off)', testid: 'tf-crunch', disabled: tfOff }),
        ),
        h('h3', { text: 'STORAGE' }),
        h('p', { class: 'hint', text: 'Samples are kept in this browser (IndexedDB) and saved with the project by reference. FILE → DOWNLOAD BUNDLE carries a project with its samples to another browser.' }),
        h('div', { class: 'btnrow' }, button('PURGE UNUSED SAMPLES', () => void app.purgeSamples(), { help: 'Delete stored samples that no project in this browser uses', testid: 'purge-samples' })),
      ];
    },
    ['audio', 'voices'],
    structure,
  );
}

function drawWave(c: HTMLCanvasElement, audio: { sampleRate: number; channels: Float32Array[] }): void {
  const g = c.getContext('2d');
  if (!g) return;
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#141412';
  const peaks = waveformPeaks(audio, c.width);
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = ink;
  const mid = c.height / 2;
  peaks.forEach((p, x) => {
    const hgt = Math.max(1, Math.min(1, p) * (c.height - 4));
    g.fillRect(x, mid - hgt / 2, 1, hgt);
  });
}

// ---------------------------------------------------------------- OUTPUT PROCESSING

const fxState = { target: 'master' };

export function outputFx(d: Dialogs, app: App, target?: string): void {
  if (target) fxState.target = target;
  const isMaster = () => fxState.target === 'master' || !app.project.voices.some((v) => v.id === fxState.target);
  const fx = (): OutputFxSettings => {
    const a = audioOf(app.project);
    return isMaster() ? a.master : a.voiceFx[fxState.target]!;
  };
  const setFx = (f: OutputFxSettings, coalesce?: string) => (isMaster() ? app.setMasterFx(f, coalesce) : app.setVoiceFx(fxState.target, f, coalesce));
  const patch = <K extends keyof OutputFxSettings>(k: K, v: Partial<OutputFxSettings[K]> | OutputFxSettings[K], coalesce?: string) =>
    setFx({ ...fx(), [k]: typeof v === 'object' && v !== null ? { ...(fx()[k] as object), ...v } : v } as OutputFxSettings, coalesce);
  d.show(
    'OUTPUT PROCESSING',
    'output-fx',
    (r) => {
      const dis = () => fx().bypass;
      const targets = () => [['master', 'MASTER'] as const, ...app.project.voices.map((v) => [v.id, `VOICE ${v.name}`] as const)];
      const overview = h(
        'div',
        { class: 'list fx-list', testid: 'fx-overview' },
        ...targets().map(([id, label]) => {
          const lab = h('span', { class: 'd' });
          r.push(() => {
            const a = audioOf(app.project);
            lab.textContent = fxLabel(id === 'master' ? a.master : a.voiceFx[id]!);
          });
          return h('div', { class: `li${(isMaster() ? 'master' : fxState.target) === id ? ' sel' : ''}`, testid: `fx-row-${label}`, on: { click: () => outputFx(d, app, id) } }, h('span', { class: 'nm', text: label }), lab);
        }),
      );
      const unavailable = app.audio.ctx && !app.audio.processing;
      return [
        audioTabs(d, app, 'fx'),
        h('p', { class: 'hint', text: 'Signal chain: drum sound (internal sound, or sample with its transformation) → VOICE processing → MASTER processing → OUTPUT CHAIN → VOLUME → master compressor (DOWNBEAT\'s own, always on). Everything CLEAN sounds exactly as DOWNBEAT always did. Live playback and EXPORT AUDIO run the same processing.' }),
        overview,
        select(r, { label: 'EDIT', options: targets, get: () => (isMaster() ? 'master' : fxState.target), set: (v) => outputFx(d, app, v), testid: 'fx-target' }),
        unavailable ? h('p', { class: 'hint warn-text', testid: 'fx-unavailable', text: 'This browser cannot run the processors (AudioWorklet needs https or localhost): audio plays unprocessed.' }) : null,
        h(
          'div',
          { class: 'btnrow' },
          select(r, {
            label: 'PRESET',
            options: () => [['', '(CUSTOM)'] as const, ...FX_PRESETS.map((p) => [p.key, p.label] as const)],
            get: () => matchPreset(fx()) ?? '',
            set: (k) => {
              const p = FX_PRESETS.find((x) => x.key === k);
              if (p) setFx({ ...p.apply(fx()), bypass: false });
            },
            help: 'Starting points; every setting below stays editable',
            testid: 'fx-preset',
          }),
          toggle(r, { label: 'BYPASS', get: () => fx().bypass, set: (v) => patch('bypass', v), help: 'Pass audio through unchanged (settings kept)', testid: 'fx-bypass' }),
        ),
        h(
          'div',
          { class: 'grid2' },
          toggle(r, { label: 'OUTPUT STAGE', get: () => fx().outputStage.enabled, set: (v) => patch('outputStage', { enabled: v }), help: 'Good Bits output-stage character', testid: 'fx-stage' }),
          select(r, { label: 'MODE', options: () => OUTPUT_STAGE_MODES.map((m) => [m.key, m.label.toUpperCase()] as const), get: () => fx().outputStage.mode, set: (v) => patch('outputStage', { mode: v }), help: 'Character mode (Good Bits\' generic names)', testid: 'fx-stage-mode' }),
          slider(r, { label: 'MIX', min: 0, max: 100, step: 5, get: () => fx().outputStage.mixPct, set: (v) => patch('outputStage', { mixPct: v }, 'mix'), fmt: (v) => `${v}%`, disabled: dis, testid: 'fx-mix' }),
          slider(r, { label: 'INTENSITY', min: 0, max: 100, step: 5, get: () => fx().outputStage.intensityPct, set: (v) => patch('outputStage', { intensityPct: v }, 'int'), fmt: (v) => `${v}%`, disabled: dis, testid: 'fx-intensity' }),
          toggle(r, { label: 'DRIVE', get: () => fx().drive.enabled, set: (v) => patch('drive', { enabled: v }), help: 'Good Bits drive (saturation)', testid: 'fx-drive' }),
          seg(r, { label: 'SHAPE', options: DRIVE_SHAPES.map((m) => [m.key, m.label.toUpperCase()] as const), get: () => fx().drive.type, set: (v) => patch('drive', { type: v }), testid: 'fx-drive-type' }),
          slider(r, { label: 'AMOUNT', min: 0, max: 100, step: 5, get: () => fx().drive.amountPct, set: (v) => patch('drive', { amountPct: v }, 'drive'), fmt: (v) => `${v}%`, disabled: dis, testid: 'fx-drive-amt' }),
          toggle(r, { label: 'CRUNCH', get: () => fx().crunch.enabled, set: (v) => patch('crunch', { enabled: v }), help: 'Good Bits crunch: bit depth and sample-and-hold rate reduction (no anti-alias filter: aliasing is part of the sound)', testid: 'fx-crunch' }),
          slider(r, { label: 'BITS', min: 1, max: 16, get: () => fx().crunch.bits, set: (v) => patch('crunch', { bits: v }, 'bits'), fmt: (v) => (v >= 16 ? '16 (OFF)' : String(v)), disabled: dis, testid: 'fx-bits' }),
          slider(r, { label: 'RATE ÷', min: 1, max: 32, get: () => fx().crunch.rateDivide, set: (v) => patch('crunch', { rateDivide: v }, 'rate'), fmt: (v) => (v <= 1 ? '1 (OFF)' : `${v} ≈${Math.round(44100 / v)} Hz`), disabled: dis, testid: 'fx-rate' }),
          toggle(r, { label: 'TONE', get: () => fx().tone.enabled, set: (v) => patch('tone', { enabled: v }), help: 'One-pole low-pass after the chain', testid: 'fx-tone' }),
          slider(r, { label: 'TONE Hz', min: 200, max: 20000, step: 100, get: () => fx().tone.hz, set: (v) => patch('tone', { hz: v }, 'tone'), disabled: dis, testid: 'fx-tone-hz' }),
          slider(r, { label: 'IN dB', min: -24, max: 24, step: 0.5, get: () => fx().inDb, set: (v) => patch('inDb', v, 'in'), disabled: dis, testid: 'fx-in' }),
          slider(r, { label: 'OUT dB', min: -24, max: 24, step: 0.5, get: () => fx().outDb, set: (v) => patch('outDb', v, 'out'), disabled: dis, testid: 'fx-out' }),
        ),
        h('div', { class: 'btnrow' }, button('ALL CLEAN', () => app.clearProcessing(), { help: 'Every voice and the master back to CLEAN', testid: 'fx-clear-all' })),
        h('p', { class: 'hint', text: 'Sample transformations (which change a sample once, before it plays) are in the SAMPLE BANK. Processing never reaches external MIDI instruments.' }),
      ];
    },
    ['audio', 'voices'],
    () => JSON.stringify([isMaster() ? 'master' : fxState.target, app.project.voices.map((v) => [v.id, v.name]), !!app.audio.ctx && !app.audio.processing]),
  );
}

// ---------------------------------------------------------------- OUTPUT CHAIN

const chainState = { sel: '' };

/** One parameter's control, from its description. */
function paramCtl(r: Parameters<typeof slider>[0], def: ParamDef, get: () => number | boolean | string, set: (v: number | boolean | string, coalesce?: string) => void, testid: string): HTMLElement {
  const label = def.label.toUpperCase();
  const help = def.description;
  if (def.type === 'continuous' || def.type === 'integer') {
    const fmt = (v: number) => formatParam(def, v).toUpperCase();
    if (def.type === 'continuous' && def.scale === 'log' && def.min > 0) {
      // a log control over 0..1000 steps, rounded to the parameter's step
      const k = Math.log(def.max / def.min);
      const toV = (x: number) => {
        const v = def.min * Math.exp((x / 1000) * k);
        const st = def.step ?? 0;
        return Math.max(def.min, Math.min(def.max, st ? Math.round(v / st) * st : v));
      };
      return slider(r, { label, min: 0, max: 1000, get: () => Math.round((Math.log(Number(get()) / def.min) / k) * 1000), set: (x) => set(toV(x), testid), fmt: (x) => fmt(toV(x)), help, testid });
    }
    return slider(r, { label, min: def.min, max: def.max, step: def.type === 'integer' ? 1 : (def.step ?? 0.01), get: () => Number(get()), set: (v) => set(v, testid), fmt, help, testid });
  }
  if (def.type === 'boolean') return toggle(r, { label, get: () => !!get(), set: (v) => set(v), help, testid });
  const options = def.options.map((o) => [o.value, o.label.toUpperCase()] as const);
  const helps = Object.fromEntries(def.options.map((o) => [o.value, o.description]));
  if (options.length <= 4) return seg(r, { label, options, get: () => String(get()), set: (v) => set(v), help, helps, testid });
  return select(r, { label, options: () => options, get: () => String(get()), set: (v) => set(v), help, testid });
}

export function outputChain(d: Dialogs, app: App): void {
  // every change goes through Core's headless controller (validated), then to the project (undoable)
  const ctl = () => new OutputChain(OUTPUT_ENGINES, chainOf(audioOf(app.project)));
  const change = (fn: (c: OutputChain) => unknown, coalesce?: string) => {
    const c = ctl();
    fn(c);
    app.setOutputChain(c.config, coalesce);
  };
  const stages = () => chainOf(audioOf(app.project)).stages;
  const selected = () => stages().find((s) => s.id === chainState.sel) ?? stages()[0];
  d.show(
    'OUTPUT CHAIN',
    'output-chain',
    (r) => {
      const cur = selected();
      const def = cur ? OUTPUT_ENGINES.audio(cur.engine) : undefined;
      const presets = presetsFor(OUTPUT_ENGINES);
      const unavailable = app.audio.ctx && !app.audio.chainProcessing;
      const list = h(
        'div',
        { class: 'list fx-list', testid: 'chain-list' },
        ...stages().map((s, i) => {
          const e = OUTPUT_ENGINES.audio(s.engine);
          const lab = h('span', { class: 'd' });
          const refresh = () => {
            const now = stages().find((x) => x.id === s.id);
            lab.textContent = !e ? 'UNAVAILABLE (PASSES AUDIO THROUGH)' : !now?.enabled ? 'OFF' : e.params.map((p) => formatParam(p, now.params[p.id] ?? p.default).toUpperCase()).join(' · ');
          };
          r.push(refresh);
          refresh();
          return h('div', { class: `li${cur?.id === s.id ? ' sel' : ''}`, testid: `chain-row-${i + 1}`, on: { click: () => ((chainState.sel = s.id), outputChain(d, app)) } }, h('span', { class: 'nm', text: `${i + 1} ${e ? e.name.toUpperCase() : s.engine}` }), lab);
        }),
      );
      return [
        audioTabs(d, app, 'chain'),
        h('p', { class: 'hint', text: 'Output engines in series on the master: MASTER processing → 1 → 2 → … → VOLUME → master compressor. The same engines as The Good Bits, The Breakery and emmm (Slop Factory Core). Live playback and EXPORT AUDIO\'s master run the same chain; stems and MIDI are never processed by it. An empty chain changes nothing.' }),
        unavailable ? h('p', { class: 'hint warn-text', testid: 'chain-unavailable', text: 'This browser cannot run the output chain (AudioWorklet needs https or localhost): audio plays unprocessed.' }) : null,
        h(
          'div',
          { class: 'btnrow' },
          select(r, {
            label: 'ADD',
            options: () => [['', '(ENGINE…)'] as const, ...OUTPUT_ENGINES.list({ kind: 'audio' }).map((e) => [e.id, e.name.toUpperCase()] as const)],
            get: () => '',
            set: (id) => {
              if (!id) return;
              let added: string | null = null;
              change((c) => (added = c.add(id)));
              if (added) chainState.sel = added;
              outputChain(d, app);
            },
            help: 'Add an engine at the end of the chain (up to 8)',
            testid: 'chain-add',
          }),
          select(r, {
            label: 'PRESET',
            options: () => [['', '(CUSTOM)'] as const, ...presets.map((p) => [p.key, p.label] as const)],
            get: () => matchChainPreset(chainOf(audioOf(app.project)), presets) ?? '',
            set: (k) => {
              const p = presets.find((x) => x.key === k);
              if (p) change((c) => c.applyPreset(p));
              outputChain(d, app);
            },
            help: 'Replace the chain with a starting point',
            testid: 'chain-preset',
          }),
          toggle(r, { label: 'BYPASS ALL', get: () => chainOf(audioOf(app.project)).bypass, set: (v) => change((c) => c.setBypass(v)), help: 'Pass audio through the chain unchanged (settings kept)', testid: 'chain-bypass' }),
        ),
        stages().length ? list : h('p', { class: 'hint', testid: 'chain-empty', text: 'No engines: ADD one, or pick a PRESET.' }),
        cur
          ? h(
              'div',
              { class: 'btnrow' },
              toggle(r, { label: 'ON', get: () => !!selected()?.enabled, set: (v) => change((c) => c.setEnabled(cur.id, v)), help: 'Off: this engine is bypassed (settings kept)', testid: 'chain-on' }),
              button('▲', () => change((c) => c.move(cur.id, -1)), { help: 'Earlier in the chain', testid: 'chain-up' }),
              button('▼', () => change((c) => c.move(cur.id, 1)), { help: 'Later in the chain', testid: 'chain-down' }),
              def
                ? select(r, {
                    label: 'ENGINE',
                    options: () => OUTPUT_ENGINES.list({ kind: 'audio' }).map((e) => [e.id, e.name.toUpperCase()] as const),
                    get: () => cur.engine,
                    set: (id) => change((c) => c.replace(cur.id, id)),
                    help: 'Swap this stage for another engine, in the same place',
                    testid: 'chain-engine',
                  })
                : null,
              def ? button('DEFAULTS', () => change((c) => c.resetParams(cur.id)), { help: 'Every parameter back to its default', testid: 'chain-defaults' }) : null,
              button('REMOVE', () => change((c) => c.remove(cur.id)), { help: 'Remove this engine from the chain', testid: 'chain-remove' }),
            )
          : null,
        cur && def ? h('p', { class: 'hint', text: `${def.name.toUpperCase()}: ${def.description}` }) : null,
        cur && !def ? h('p', { class: 'hint warn-text', text: `"${cur.engine}" was saved by an application with an engine DOWNBEAT does not have. It is kept unchanged and passes audio through; REMOVE drops it.` }) : null,
        cur && def
          ? h(
              'div',
              { class: 'grid2' },
              ...def.params.map((p) => paramCtl(r, p, () => selected()?.params[p.id] ?? p.default, (v, coalesce) => change((c) => c.setParam(cur.id, p.id, v), coalesce && `${cur.id}:${coalesce}`), `chain-p-${p.id}`)),
            )
          : null,
      ];
    },
    ['audio'],
    () => JSON.stringify([stages().map((s) => [s.id, s.engine]), selected()?.id, !!app.audio.ctx && !app.audio.chainProcessing]),
  );
}

// ---------------------------------------------------------------- EXPORT AUDIO

const exp: { opts: AudioExportOptions | null; result: ExportResult | null; progress: string } = { opts: null, result: null, progress: '' };

export function exportAudioDialog(d: Dialogs, app: App): void {
  if (!exp.opts || (exp.opts.range.kind === 'pattern' && exp.opts.range.patternId !== AUDITION_ID && !app.project.patterns.some((p) => p.id === (exp.opts!.range as { patternId: string }).patternId))) exp.opts = defaultExportOptions(app.project.current);
  const o = exp.opts;
  const set = (patch: Partial<AudioExportOptions>) => {
    exp.opts = { ...exp.opts!, ...patch };
    exportAudioDialog(d, app);
  };
  const state = () => ({ lockKey: app.engine.lockKey, sourceOnly: app.engine.sourceOnly, audition: app.engine.audition });
  const take = () => (app.take.notes.length ? { notes: app.take.notes, ms: app.take.ms, startTick: app.take.startTick, tempo: app.take.tempo } : null);
  d.show(
    'EXPORT AUDIO',
    'export-audio',
    (r) => {
      let summary = '';
      let ok = true;
      try {
        const plan = planExport(app.project, o, state(), take());
        const secs = (n: number) => n / plan.perf.tempo.ppq;
        const tm = plan.voiceTimeline.tempo;
        // seconds of music (constant tempo segments)
        let sec = 0;
        for (let i = 0; i < tm.changes.length; i++) {
          const c = tm.changes[i]!;
          const end = tm.changes[i + 1]?.tick ?? plan.voiceTimeline.length;
          sec += (secs(Math.max(0, end - c.tick)) * 60) / c.bpm;
        }
        const total = sec + o.tailSeconds;
        ok = total <= MAX_RENDER_SECONDS;
        const n = plan.names.length;
        summary = `${plan.label.toUpperCase()}: ${sec.toFixed(1)} s of music + ${o.tailSeconds} s tail · ${n} file${n > 1 ? 's' : ''} (${plan.master ? 'master' : ''}${plan.master && (plan.voiceStems.length || plan.soundStems.length) ? ', ' : ''}${plan.voiceStems.length ? `${plan.voiceStems.length} voice stem${plan.voiceStems.length > 1 ? 's' : ''}` : ''}${plan.voiceStems.length && plan.soundStems.length ? ', ' : ''}${plan.soundStems.length ? `${plan.soundStems.length} drum-sound stem${plan.soundStems.length > 1 ? 's' : ''}` : ''})${n > 1 ? ' in one ZIP' : ''}.${ok ? '' : ` Too long: the limit is ${MAX_RENDER_SECONDS / 60} minutes.`}`;
      } catch (e) {
        ok = false;
        summary = e instanceof Error ? e.message : String(e);
      }
      const patterns = () => [...app.project.patterns.map((p) => [p.id, p.name] as const), ...(app.engine.audition ? [[AUDITION_ID, 'AUDITION (BREED)'] as const] : [])];
      const range = o.range;
      const running = !!app.exporting;
      const res = exp.result;
      const notes: string[] = [];
      if (app.engine.lockKey !== null && range.kind !== 'take') notes.push('LOCK is on: the locked variation is exported.');
      if (app.engine.sourceOnly && range.kind !== 'take') notes.push('SOURCE is on: only the written strikes are exported.');
      return [
        audioTabs(d, app, 'export'),
        h('p', { class: 'hint', text: 'Renders DOWNBEAT\'s own sounds (internal sounds and samples) with the same routing, choke groups and processing as playback, in this browser. External MIDI instruments are not rendered. WAV, 44.1 kHz, 16-bit PCM, stereo; several files come as one ZIP. Nothing is normalised or trimmed.' }),
        h('h3', { text: 'WHAT' }),
        seg(r, {
          label: 'RANGE',
          options: [['pattern', 'PATTERN'], ['song', 'SONG'], ['take', 'RECORDED TAKE']] as const,
          get: () => range.kind,
          set: (k) => set({ range: k === 'pattern' ? { kind: 'pattern', patternId: app.project.current, cycles: 4, written: false } : { kind: k } }),
          helps: {
            pattern: 'A pattern for a number of cycles, as PLAY plays it from the start with this seed (fills, density, groove, evolution, rules, autopilot)',
            song: 'The whole song once through, performed',
            take: 'Exactly what played while REC TAKE was on, including your live changes',
          },
          testid: 'exp-range',
        }),
        range.kind === 'pattern'
          ? h(
              'div',
              { class: 'btnrow' },
              select(r, { label: 'PATTERN', options: patterns, get: () => range.patternId, set: (v) => set({ range: { ...range, patternId: v } }), testid: 'exp-pattern' }),
              select(r, { label: 'CYCLES', options: () => [1, 2, 4, 8, 16, 32, 64].map((n) => [String(n), String(n)] as const), get: () => String(range.cycles), set: (v) => set({ range: { ...range, cycles: Number(v) } }), testid: 'exp-cycles' }),
              seg(r, { label: 'PLAY', options: [['perf', 'PERFORMED'], ['written', 'AS WRITTEN']] as const, get: () => (range.written ? 'written' : 'perf'), set: (v) => set({ range: { ...range, written: v === 'written' } }), helps: { perf: 'As DOWNBEAT performs it', written: 'Only the written strikes: no fills, density or groove' }, testid: 'exp-written' }),
            )
          : range.kind === 'take'
            ? h('p', { class: 'hint', testid: 'exp-take-info', text: app.take.notes.length ? `Take: ${app.take.notes.length} notes${app.take.recording ? ' (still recording)' : ''}.` : 'No take yet: press REC TAKE while playing.' })
            : null,
        notes.length ? h('p', { class: 'hint', testid: 'exp-notes', text: notes.join(' ') }) : null,
        h('h3', { text: 'FILES' }),
        seg(r, { label: 'OUTPUT', options: [['master', 'MASTER'], ['stems', 'STEMS'], ['both', 'MASTER + STEMS']] as const, get: () => o.outputs, set: (v) => set({ outputs: v }), testid: 'exp-outputs' }),
        o.outputs !== 'master'
          ? h(
              'div',
              {},
              seg(r, {
                label: 'STEMS BY',
                options: [['voices', 'SEQUENCER VOICE'], ['sounds', 'DRUM SOUND'], ['both', 'BOTH']] as const,
                get: () => o.stems,
                set: (v) => set({ stems: v }),
                helps: {
                  voices: 'One stem per voice (track): everything the voice plays, its fills included, with the voice\'s processing',
                  sounds: 'One stem per drum sound (a voice\'s sound step), wherever it is played from (fills borrowing it included), with only the sound\'s own processing',
                  both: 'Both sets of stems',
                },
                testid: 'exp-stems',
              }),
              h(
                'div',
                { class: 'btnrow' },
                toggle(r, { label: 'VOICE PROCESSING IN VOICE STEMS', get: () => o.bake, set: (v) => set({ bake: v }), help: 'On: each voice stem carries its voice\'s output processing. Off: dry voice stems', testid: 'exp-bake' }),
                toggle(r, { label: 'SILENT STEMS TOO', get: () => o.all, set: (v) => set({ all: v }), help: 'Also export stems of voices and sounds that do not play in this range', testid: 'exp-all' }),
              ),
              h('p', {
                class: 'hint',
                testid: 'exp-stem-note',
                text: 'Every stem starts at 0:00 and has the same length as the master, so stems line up in any DAW. Stems never include master processing, VOLUME or the master compressor. Drum-sound stems leave out voice processing: a non-linear processor (drive, crunch, the output stages) fed several sounds cannot be split into one exact stem per sound. With voice processing CLEAN, either set of stems adds up to the mix before the master.',
              }),
            )
          : null,
        select(r, { label: 'TAIL', options: () => [0, 0.5, 1, 2, 4, 8].map((n) => [String(n), `${n} s`] as const), get: () => String(o.tailSeconds), set: (v) => set({ tailSeconds: Number(v) }), testid: 'exp-tail' }),
        h('p', { class: 'hint', testid: 'exp-master-note', text: o.outputs === 'stems' ? '' : `MASTER is what you hear: voice and master processing, VOLUME (${Math.round(app.prefs.volume * 100)}%) and the master compressor.` }),
        h('p', { class: `hint${ok ? '' : ' warn-text'}`, testid: 'exp-summary', text: summary }),
        h(
          'div',
          { class: 'btnrow' },
          button(running ? 'EXPORTING…' : 'EXPORT', () => void run(), { cls: 'big', help: 'Render and download', testid: 'exp-go' }),
          running ? button('CANCEL', () => app.cancelExport(), { testid: 'exp-cancel' }) : null,
          h('span', { class: 'hint', testid: 'exp-progress', text: exp.progress }),
        ),
        res
          ? h(
              'div',
              { class: 'list', testid: 'exp-result' },
              ...res.files.map((f) =>
                h('div', { class: 'li' }, h('span', { class: 'nm', text: f.name }), h('span', { class: `d${f.stats.clipped ? ' warn-text' : ''}`, text: f.stats.silent ? 'SILENT' : `PEAK ${f.stats.peakDb.toFixed(1)} dBFS${f.stats.clipped ? ` · ${f.stats.clipped} CLIPPED SAMPLES` : ''}` })),
              ),
            )
          : null,
      ];
      async function run(): Promise<void> {
        if (app.exporting || !ok) return;
        exp.result = null;
        exp.progress = 'Starting';
        exportAudioDialog(d, app);
        const res = await app.exportAudio(o, (f, stage) => {
          exp.progress = `${stage} ${Math.round(f * 100)}%`;
          const el = document.querySelector('[data-testid="exp-progress"]');
          if (el) el.textContent = exp.progress;
        });
        exp.result = res;
        exp.progress = res ? 'Done.' : '';
        if (d.open) exportAudioDialog(d, app);
      }
    },
    ['audio', 'project', 'perf'],
    () => JSON.stringify([exp.opts, !!app.exporting, app.take.notes.length, !!app.engine.audition, app.project.patterns.map((p) => [p.id, p.name]), app.engine.lockKey, app.engine.sourceOnly]),
  );
}

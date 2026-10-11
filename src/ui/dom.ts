/**
 * DOM helpers and the small set of controls every panel uses. Controls are
 * built once and refreshed in place, so a slider being dragged is never
 * rebuilt underneath the pointer.
 */

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  text?: string;
  help?: string;
  testid?: string;
  title?: string;
  style?: string;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
  [k: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'help') el.dataset.help = String(v);
    else if (k === 'testid') el.dataset.testid = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export type Refresh = () => void;
export type Refreshers = Refresh[];

const focused = (el: Element) => document.activeElement === el;

export function button(label: string, onClick: (e: MouseEvent) => void, o: { help?: string; testid?: string; cls?: string; title?: string } = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: o.cls, help: o.help, testid: o.testid, title: o.title, text: label, on: { click: onClick } });
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  get: () => number;
  set: (v: number) => void;
  fmt?: (v: number) => string;
  help?: string;
  testid?: string;
  disabled?: () => boolean;
}

export function slider(r: Refreshers, o: SliderOpts): HTMLElement {
  const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 1, testid: o.testid, 'aria-label': o.label });
  const out = h('output', { class: 'val' });
  const fmt = o.fmt ?? ((v: number) => String(v));
  input.addEventListener('input', () => {
    o.set(Number(input.value));
    out.textContent = fmt(Number(input.value));
  });
  const row = h('label', { class: 'ctl slider', help: o.help }, h('span', { class: 'lab', text: o.label }), input, out);
  const refresh = () => {
    const v = o.get();
    if (!focused(input)) input.value = String(v);
    out.textContent = fmt(v);
    const dis = o.disabled?.() ?? false;
    input.disabled = dis;
    row.classList.toggle('disabled', dis);
  };
  r.push(refresh);
  refresh();
  return row;
}

export interface SegOpts<T extends string | number> {
  label?: string;
  options: readonly (readonly [T, string])[];
  get: () => T;
  set: (v: T) => void;
  help?: string;
  testid?: string;
  /** Help per option. */
  helps?: Partial<Record<string, string>>;
}

export function seg<T extends string | number>(r: Refreshers, o: SegOpts<T>): HTMLElement {
  const btns = o.options.map(([v, l]) =>
    h('button', {
      type: 'button',
      text: l,
      testid: o.testid ? `${o.testid}-${v}` : undefined,
      help: o.helps?.[String(v)] ?? o.help,
      on: { click: () => o.set(v) },
    }),
  );
  const box = h('div', { class: 'seg', role: 'group' }, ...btns);
  const row = o.label ? h('div', { class: 'ctl', help: o.help }, h('span', { class: 'lab', text: o.label }), box) : box;
  const refresh = () => {
    const cur = o.get();
    o.options.forEach(([v], i) => {
      btns[i]!.classList.toggle('on', v === cur);
      btns[i]!.setAttribute('aria-pressed', String(v === cur));
    });
  };
  r.push(refresh);
  refresh();
  return row;
}

export function toggle(r: Refreshers, o: { label: string; get: () => boolean; set: (v: boolean) => void; help?: string; testid?: string; cls?: string }): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `tog ${o.cls ?? ''}`, text: o.label, help: o.help, testid: o.testid, on: { click: () => o.set(!o.get()) } });
  const refresh = () => {
    const on = o.get();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  };
  r.push(refresh);
  refresh();
  return b;
}

export interface StepperOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  get: () => number;
  set: (v: number) => void;
  fmt?: (v: number) => string;
  help?: string;
  testid?: string;
}

export function stepper(r: Refreshers, o: StepperOpts): HTMLElement {
  const st = o.step ?? 1;
  const input = h('input', { type: 'text', class: 'num', inputmode: 'numeric', testid: o.testid, 'aria-label': o.label });
  const commit = () => {
    const v = Number(input.value.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(v)) o.set(Math.min(o.max, Math.max(o.min, v)));
    refresh();
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.blur();
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      o.set(Math.min(o.max, Math.max(o.min, o.get() + (e.key === 'ArrowUp' ? st : -st))));
      refresh();
    }
    e.stopPropagation();
  });
  const dec = h('button', { type: 'button', class: 'tiny', text: '−', 'aria-label': `${o.label} down`, testid: o.testid ? `${o.testid}-dec` : undefined, on: { click: () => o.set(Math.max(o.min, o.get() - st)) } });
  const inc = h('button', { type: 'button', class: 'tiny', text: '+', 'aria-label': `${o.label} up`, testid: o.testid ? `${o.testid}-inc` : undefined, on: { click: () => o.set(Math.min(o.max, o.get() + st)) } });
  const row = h('div', { class: 'ctl stepper', help: o.help }, h('span', { class: 'lab', text: o.label }), h('span', { class: 'stp' }, dec, input, inc));
  const fmt = o.fmt ?? ((v: number) => String(v));
  const refresh = () => {
    if (!focused(input)) input.value = fmt(o.get());
  };
  r.push(refresh);
  refresh();
  return row;
}

export function select<T extends string>(r: Refreshers, o: { label?: string; options: () => readonly (readonly [T, string])[]; get: () => T; set: (v: T) => void; help?: string; testid?: string }): HTMLElement {
  const sel = h('select', { testid: o.testid, 'aria-label': o.label ?? 'choice' });
  sel.addEventListener('change', () => o.set(sel.value as T));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  const row = o.label ? h('label', { class: 'ctl', help: o.help }, h('span', { class: 'lab', text: o.label }), sel) : sel;
  if (!o.label && o.help) sel.dataset.help = o.help;
  let sig = '';
  const refresh = () => {
    const opts = o.options();
    const s = opts.map(([v, l]) => `${v}\u0000${l}`).join('\u0001');
    if (s !== sig) {
      clear(sel);
      for (const [v, l] of opts) sel.append(h('option', { value: v, text: l }));
      sig = s;
    }
    if (!focused(sel)) sel.value = o.get();
  };
  r.push(refresh);
  refresh();
  return row;
}

/** Five (or n) vertical bars edited by pointer: probability weights. */
export function weights(r: Refreshers, o: { label: string; labels: string[]; max?: number; get: () => number[]; set: (i: number, v: number) => void; help?: string; testid?: string }): HTMLElement {
  const max = o.max ?? 100;
  const bars = o.labels.map((l, i) => {
    const fill = h('span', { class: 'wfill' });
    const col = h('span', { class: 'wcol', 'data-i': i, title: l }, fill, h('span', { class: 'wlab', text: l }));
    return { col, fill };
  });
  const box = h('div', { class: 'weights', testid: o.testid }, ...bars.map((b) => b.col));
  const setFrom = (e: PointerEvent) => {
    const t = (e.target as HTMLElement).closest('.wcol') as HTMLElement | null;
    const target = t ?? (document.elementFromPoint(e.clientX, e.clientY)?.closest('.wcol') as HTMLElement | null);
    if (!target || !box.contains(target)) return;
    const i = Number(target.dataset.i);
    const rect = target.getBoundingClientRect();
    const v = Math.round(Math.min(1, Math.max(0, (rect.bottom - 12 - e.clientY) / Math.max(1, rect.height - 12))) * max);
    o.set(i, v);
    refresh();
  };
  let drag = false;
  box.addEventListener('pointerdown', (e) => {
    drag = true;
    box.setPointerCapture(e.pointerId);
    setFrom(e);
  });
  box.addEventListener('pointermove', (e) => drag && setFrom(e));
  box.addEventListener('pointerup', () => (drag = false));
  box.addEventListener('pointercancel', () => (drag = false));
  const row = h('div', { class: 'ctl wrow', help: o.help }, h('span', { class: 'lab', text: o.label }), box);
  const refresh = () => {
    const w = o.get();
    bars.forEach((b, i) => {
      const v = w[i] ?? 0;
      b.fill.style.height = `${(v / max) * 100}%`;
      b.col.title = `${o.labels[i]}: ${v}`;
    });
  };
  r.push(refresh);
  refresh();
  return row;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('div', { class: 'sect' }, h('div', { class: 'sect-t', text: title }), ...children);
}

export function ext(): HTMLElement {
  return h('span', { class: 'ext-tag', text: 'EXT', title: 'Extended: a new DOWNBEAT feature, not part of the historical model' });
}

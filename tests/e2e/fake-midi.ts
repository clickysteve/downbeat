/**
 * Simulated Web MIDI for browser tests, installed before the app loads.
 * One output records every message with its timestamp (window.__midi.sent);
 * one input can stream MIDI Clock and transport bytes. No hardware involved.
 */
export const installFakeMidi = (): void => {
  type Msg = { bytes: number[]; t: number };
  const sent: Msg[] = [];
  let access: { onstatechange: ((e: unknown) => void) | null } | null = null;
  const out = {
    id: 'fake-out',
    name: 'Simulated Drum Machine',
    manufacturer: 'Test',
    type: 'output',
    state: 'connected',
    connection: 'open',
    send(bytes: number[], t?: number) {
      if (out.state !== 'connected') throw new Error('InvalidStateError');
      sent.push({ bytes: Array.from(bytes), t: t ?? performance.now() });
    },
    clear() {
      const now = performance.now();
      for (let i = sent.length - 1; i >= 0; i--) if (sent[i]!.t > now) sent.splice(i, 1);
    },
  };
  const inp = {
    id: 'fake-in',
    name: 'Simulated Clock Source',
    manufacturer: 'Test',
    type: 'input',
    state: 'connected',
    connection: 'open',
    onmidimessage: null as null | ((e: { data: Uint8Array; timeStamp: number }) => void),
  };
  let clock: ReturnType<typeof setInterval> | null = null;
  const sendIn = (b: number[]) => inp.onmidimessage?.({ data: new Uint8Array(b), timeStamp: performance.now() });
  (window as unknown as { __midi: unknown }).__midi = {
    sent,
    reset: () => sent.splice(0, sent.length),
    sendIn,
    clockStart: (bpm: number) => {
      if (clock) clearInterval(clock);
      clock = setInterval(() => sendIn([0xf8]), 60000 / (bpm * 24));
    },
    clockStop: () => {
      if (clock) clearInterval(clock);
      clock = null;
    },
    unplugOut: () => {
      out.state = 'disconnected';
      access?.onstatechange?.({ port: out });
    },
    replugOut: () => {
      out.state = 'connected';
      access?.onstatechange?.({ port: out });
    },
  };
  const a = {
    outputs: new Map([[out.id, out]]),
    inputs: new Map([[inp.id, inp]]),
    onstatechange: null as ((e: unknown) => void) | null,
    sysexEnabled: false,
  };
  access = a;
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: () => Promise.resolve(a), configurable: true });
};

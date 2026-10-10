/** MIDI message helpers. Channels are 1-16 at the API surface. */

export const CLOCK = 0xf8;
export const START = 0xfa;
export const CONTINUE = 0xfb;
export const STOP = 0xfc;
export const SONG_POSITION = 0xf2;

const ch = (c: number) => (Math.min(16, Math.max(1, Math.round(c))) - 1) & 0x0f;
const d7 = (v: number) => Math.min(127, Math.max(0, Math.round(v))) & 0x7f;

export const noteOn = (c: number, note: number, vel: number): number[] => [0x90 | ch(c), d7(note), Math.max(1, d7(vel))];
export const noteOff = (c: number, note: number): number[] => [0x80 | ch(c), d7(note), 0];
export const programChange = (c: number, p: number): number[] => [0xc0 | ch(c), d7(p)];
export const controlChange = (c: number, cc: number, v: number): number[] => [0xb0 | ch(c), d7(cc), d7(v)];
export const allNotesOff = (c: number): number[] => controlChange(c, 123, 0);
export const allSoundOff = (c: number): number[] => controlChange(c, 120, 0);

/** Song Position Pointer in MIDI beats (sixteenth notes = 6 clocks). */
export const songPosition = (beats: number): number[] => {
  const b = Math.max(0, Math.min(16383, Math.round(beats)));
  return [SONG_POSITION, b & 0x7f, (b >> 7) & 0x7f];
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note name with the octave numbering where middle C (60) is C3, as many drum machines use. */
export const noteName = (n: number): string => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`;

/** Human readable description of a message (for the MIDI monitor). */
export function describe(bytes: readonly number[]): string {
  const [s = 0, a = 0, b = 0] = bytes;
  switch (s) {
    case CLOCK:
      return 'Clock';
    case START:
      return 'Start';
    case CONTINUE:
      return 'Continue';
    case STOP:
      return 'Stop';
    case SONG_POSITION:
      return `Song Position ${a | (b << 7)}`;
  }
  const c = (s & 0x0f) + 1;
  switch (s & 0xf0) {
    case 0x90:
      return `Ch${c} Note On ${noteName(a)} (${a}) vel ${b}`;
    case 0x80:
      return `Ch${c} Note Off ${noteName(a)} (${a})`;
    case 0xc0:
      return `Ch${c} Program ${a}`;
    case 0xb0:
      return `Ch${c} CC ${a} = ${b}`;
  }
  return bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

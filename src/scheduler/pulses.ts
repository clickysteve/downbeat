/**
 * Measures an incoming 24 PPQN MIDI Clock stream. Display and placement only:
 * incoming pulses themselves advance musical time (see scheduler.ts).
 */
import { PPQ } from '../engine/types';

const SHORT = 6;
const LONG = 48;
const GAP_FACTOR = 4;

export class PulseEstimator {
  private times: number[] = [];
  private shown: number | null = null;

  add(t: number): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined) {
      const dt = t - last;
      const p = this.periodMs();
      // A long silence (clock stopped and restarted) is not a slow tempo.
      if (dt <= 0 || dt > 1000 || (p !== null && dt > p * GAP_FACTOR)) this.times = [];
    }
    this.times.push(t);
    if (this.times.length > LONG + 1) this.times.splice(0, this.times.length - (LONG + 1));
  }

  reset(): void {
    this.times = [];
    this.shown = null;
  }

  /** Mean of the last few intervals (places events between pulses), or null. */
  periodMs(): number | null {
    const n = Math.min(SHORT, this.times.length - 1);
    if (n < 1) return null;
    return (this.times[this.times.length - 1]! - this.times[this.times.length - 1 - n]!) / n;
  }

  /** Least-squares tempo over up to two beats, or null before a quarter beat. */
  rawBpm(): number | null {
    const n = this.times.length;
    if (n - 1 < PPQ / 4) return null;
    const t0 = this.times[0]!;
    const mx = (n - 1) / 2;
    let my = 0;
    for (const t of this.times) my += t - t0;
    my /= n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - mx;
      sxy += dx * (this.times[i]! - t0 - my);
      sxx += dx * dx;
    }
    const p = sxy / sxx;
    return p > 0 ? 60000 / (p * PPQ) : null;
  }

  /** Displayed tempo with hysteresis, so jitter does not make it flicker. */
  bpm(): number | null {
    const raw = this.rawBpm();
    if (raw === null) {
      this.shown = null;
      return null;
    }
    const tol = Math.max(0.15, raw * 0.002);
    if (this.shown === null || Math.abs(raw - this.shown) > tol) this.shown = Math.round(raw * 10) / 10;
    return this.shown;
  }
}

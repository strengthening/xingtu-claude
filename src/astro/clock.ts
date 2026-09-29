/**
 * Simulation clock: sim = anchorSim + (real − anchorReal) · rate.
 * Re-anchoring on every change keeps time continuous when the rate changes.
 */

/** Time-rate presets (simulated seconds per real second). */
export const RATE_STEPS = [-86400, -3600, -600, -60, -10, -1, 1, 10, 60, 600, 3600, 86400] as const;

export class SimClock {
  private anchorReal: number;
  private anchorSim: number;
  private _rate = 1;
  private _paused = false;

  constructor(
    private readonly realNow: () => number = () => Date.now(),
    startMs?: number,
  ) {
    this.anchorReal = realNow();
    this.anchorSim = startMs ?? this.anchorReal;
  }

  /** Current simulated time, ms since Unix epoch (UTC). */
  now(): number {
    if (this._paused) return this.anchorSim;
    return this.anchorSim + (this.realNow() - this.anchorReal) * this._rate;
  }

  get rate(): number {
    return this._rate;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** True when running at ×1 and within 2 s of the wall clock. */
  get isLive(): boolean {
    return !this._paused && this._rate === 1 && Math.abs(this.now() - this.realNow()) < 2000;
  }

  setTime(ms: number): void {
    this.anchorReal = this.realNow();
    this.anchorSim = ms;
  }

  setRate(rate: number): void {
    this.reanchor();
    this._rate = rate;
  }

  setPaused(paused: boolean): void {
    this.reanchor();
    this._paused = paused;
  }

  /** Jump to the wall clock, real-time rate, running. */
  resetToNow(): void {
    this._rate = 1;
    this._paused = false;
    this.setTime(this.realNow());
  }

  /** Step to the next faster (+1) or slower (−1) preset. */
  stepRate(direction: 1 | -1): number {
    const steps: readonly number[] = RATE_STEPS;
    let i = steps.findIndex((s) => s >= this._rate);
    if (i === -1) i = steps.length - 1;
    const exact = steps[i] === this._rate;
    const next = direction > 0 ? (exact ? i + 1 : i) : i - 1;
    const rate = steps[Math.max(0, Math.min(steps.length - 1, next))] ?? 1;
    this.setRate(rate);
    return rate;
  }

  private reanchor(): void {
    this.anchorSim = this.now();
    this.anchorReal = this.realNow();
  }
}

export function formatRate(rate: number): string {
  const abs = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  if (abs >= 86400) return `${sign}${abs / 86400} 天/秒`;
  if (abs >= 3600) return `${sign}${abs / 3600} 时/秒`;
  if (abs >= 60) return `${sign}${abs / 60} 分/秒`;
  return `${sign}×${abs}`;
}

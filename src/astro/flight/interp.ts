/**
 * Monotone piecewise-cubic interpolation (Fritsch–Carlson PCHIP): smooth
 * through sparse telemetry-style key points without overshooting them, so an
 * altitude profile never dips below the ground between two samples.
 */
export class Pchip {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly ms: Float64Array;

  /** Points as [x, y] pairs with strictly increasing x. */
  constructor(points: readonly (readonly [number, number])[]) {
    const n = points.length;
    if (n < 2) throw new Error('Pchip needs at least two points');
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    points.forEach(([x, y], i) => {
      this.xs[i] = x;
      this.ys[i] = y;
    });
    for (let i = 1; i < n; i++) {
      if (!(this.x(i) > this.x(i - 1))) throw new Error('Pchip x values must increase');
    }
    const d = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      d[i] = (this.y(i + 1) - this.y(i)) / (this.x(i + 1) - this.x(i));
    }
    const m = new Float64Array(n);
    m[0] = d[0] ?? 0;
    m[n - 1] = d[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) {
      const a = d[i - 1] ?? 0;
      const b = d[i] ?? 0;
      if (a * b <= 0) {
        m[i] = 0;
      } else {
        // weighted harmonic mean (Fritsch–Butland), respects unequal spacing
        const h0 = this.x(i) - this.x(i - 1);
        const h1 = this.x(i + 1) - this.x(i);
        const w1 = 2 * h1 + h0;
        const w2 = h1 + 2 * h0;
        m[i] = (w1 + w2) / (w1 / a + w2 / b);
      }
    }
    this.ms = m;
  }

  private x(i: number): number {
    return this.xs[i] ?? 0;
  }

  private y(i: number): number {
    return this.ys[i] ?? 0;
  }

  get first(): number {
    return this.x(0);
  }

  get last(): number {
    return this.x(this.xs.length - 1);
  }

  /** Value at x; held constant outside the key points. */
  at(x: number): number {
    const n = this.xs.length;
    if (x <= this.x(0)) return this.y(0);
    if (x >= this.x(n - 1)) return this.y(n - 1);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.x(mid) <= x) lo = mid;
      else hi = mid;
    }
    const h = this.x(hi) - this.x(lo);
    const t = (x - this.x(lo)) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.y(lo) +
      (t3 - 2 * t2 + t) * h * (this.ms[lo] ?? 0) +
      (-2 * t3 + 3 * t2) * this.y(hi) +
      (t3 - t2) * h * (this.ms[hi] ?? 0)
    );
  }
}

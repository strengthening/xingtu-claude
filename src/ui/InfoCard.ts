import {
  bodyRiseTransitSet,
  starRiseTransitSet,
  type ObserverLocation,
  type RiseTransitSet,
} from '../astro';
import type { App } from '../app';
import type { FrameContext } from '../render/context';
import { targetKey, type Target } from '../selection';
import { describeTarget } from './describe';
import { h } from './dom';

/** Recompute rise / transit / set after this much simulated time (ms). */
const RTS_STALE_MS = 20 * 60_000;

/** Top-right card with details of the clicked object; centre / track / close. */
export class InfoCard {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly aliases: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly trackBtn: HTMLButtonElement;
  private last = 0;
  private rts:
    | { key: string; atMs: number; observer: ObserverLocation; value: RiseTransitSet | null }
    | undefined;

  constructor(private readonly app: App) {
    // only the title is announced (the rows change every quarter second)
    this.title = h('h3#info-card-title', { 'aria-live': 'polite' });
    this.aliases = h('div.aliases');
    this.kind = h('div.kind');
    this.rows = h('dl');
    const close = h(
      'button.close',
      { type: 'button', title: '关闭 (Esc)', 'aria-label': '关闭' },
      '×',
    );
    const centre = h('button', { type: 'button', title: '把视野中心移到该天体' }, '居中');
    this.trackBtn = h('button.track', { type: 'button', title: '视野持续跟随该天体' }, '跟踪');
    this.el = h(
      'section.info-card',
      { 'aria-labelledby': 'info-card-title' },
      h('header', {}, h('div.titles', {}, this.title, this.aliases), close),
      this.kind,
      this.rows,
      h('div.actions', {}, centre, this.trackBtn),
    );
    this.el.hidden = true;

    close.addEventListener('click', () => app.select(null));
    centre.addEventListener('click', () => app.centreOnSelection());
    this.trackBtn.addEventListener('click', () => app.setTracking(!app.tracking));
    window.addEventListener('keydown', this.onKey);
    this.unsubscribe = app.onSelect((t) => {
      this.last = 0;
      document.body.classList.toggle('has-selection', t !== null);
      if (app.lastFrame) this.update(app.lastFrame);
    });
  }

  private readonly unsubscribe: () => void;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (this.app.selection || this.app.hasPendingSelection) this.app.select(null);
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.unsubscribe();
    this.el.remove();
  }

  update(ctx: FrameContext): void {
    const t = this.app.selection;
    this.el.hidden = !t;
    if (!t) return;
    this.trackBtn.classList.toggle('active', this.app.tracking);
    this.trackBtn.setAttribute('aria-pressed', String(this.app.tracking));
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;

    const simMs = this.app.clock.now();
    const d = describeTarget(
      t,
      ctx,
      this.app.namedStar(t),
      this.riseTransitSet(t, ctx, simMs),
      simMs,
    );
    this.title.textContent = d.title;
    this.aliases.textContent = d.aliases.join(' · ');
    this.aliases.hidden = d.aliases.length === 0;
    this.kind.textContent = d.kind;
    this.rows.replaceChildren(...d.rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  /** Rise / transit / set, cached: the searches take a few ms each. */
  private riseTransitSet(t: Target, ctx: FrameContext, simMs: number): RiseTransitSet | null {
    if (t.kind === 'vehicle') return null;
    const key = targetKey(t);
    const observer = ctx.settings.observer;
    const c = this.rts;
    if (c && c.key === key && c.observer === observer && Math.abs(simMs - c.atMs) < RTS_STALE_MS) {
      return c.value;
    }
    let value: RiseTransitSet | null = null;
    try {
      const from = new Date(simMs);
      value =
        t.kind === 'body'
          ? bodyRiseTransitSet(t.id, observer, from)
          : starRiseTransitSet(t.p0, t.dist, observer, from);
    } catch (err) {
      console.warn('rise/set search failed', err);
    }
    this.rts = { key, atMs: simMs, observer, value };
    return value;
  }
}

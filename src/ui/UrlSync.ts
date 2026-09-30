import { isValidLocation } from '../astro';
import type { App } from '../app';
import type { ReplayController } from '../replay/ReplayController';
import { parseTargetKey } from '../selection';
import type { Settings } from '../state';
import { h, showToast } from './dom';
import { PLACES } from './locations';
import { formatUrlState, parseUrlState, type UrlState } from './url-state';

/** How often the address bar is refreshed (history.replaceState is rate-limited by browsers). */
const WRITE_INTERVAL_MS = 1000;

/**
 * Keeps the URL hash in step with the view (location, time, direction, zoom,
 * selection) and applies hashes that are opened or pasted.
 */
export class UrlSync {
  private lastWrite = 0;
  private lastHash = '';

  constructor(
    private readonly app: App,
    private readonly replay: ReplayController,
  ) {
    this.apply(parseUrlState(location.hash), true);
    window.addEventListener('hashchange', this.onHashChange);
  }

  private readonly onHashChange = (): void => {
    if (location.hash !== this.lastHash) this.apply(parseUrlState(location.hash), false);
  };

  dispose(): void {
    window.removeEventListener('hashchange', this.onHashChange);
  }

  /** Apply a parsed hash. At startup a missing time means "now" already. */
  apply(u: UrlState, startup: boolean): void {
    const { app, replay } = this;
    // the replay first: it sets its own time, place and view, which the link may then override
    const replaying = u.replay !== undefined && replay.enter(u.replay);
    if (!replaying && replay.active) replay.exit();
    const patch: Partial<Settings> = {};
    if (u.lat !== undefined && u.lon !== undefined) {
      const observer = { latitude: u.lat, longitude: u.lon, elevation: u.elev ?? 0 };
      if (isValidLocation(observer)) {
        patch.observer = observer;
        patch.locationName = u.name ?? placeNameAt(observer.latitude, observer.longitude);
      }
    }
    if (u.proj) patch.projection = u.proj;
    if (u.cons) patch.constellations = u.cons;
    if (u.mw) patch.milkyWay = u.mw;
    if (Object.keys(patch).length) app.settings.set(patch);

    const clock = app.clock;
    if (u.t !== undefined) clock.setTime(u.t);
    else if (!startup && !replaying) clock.resetToNow();
    if (u.rate !== undefined && u.rate !== 0) clock.setRate(u.rate);
    else if (u.t !== undefined) clock.setRate(1);
    if (!replaying || u.paused !== undefined) clock.setPaused(u.paused ?? false);
    if (replaying) replay.setAutoObserver(u.auto ?? true);

    const view: { az?: number; alt?: number; fov?: number } = {};
    if (u.az !== undefined) view.az = u.az;
    if (u.alt !== undefined) view.alt = u.alt;
    if (u.fov !== undefined) view.fov = u.fov;
    if (Object.keys(view).length) app.view.set(view);

    const key = u.sel ? parseTargetKey(u.sel) : null;
    // turn to the object only if the link does not say where to look
    const centre = u.az === undefined && u.alt === undefined;
    if (key) app.selectByKey(key, { track: u.track ?? false, centre });
    else if (!startup && !replaying) app.select(null);
  }

  /** Current state; `withTime` forces the simulated time in (for shared links). */
  current(withTime: boolean): UrlState {
    const { app } = this;
    const s = app.settings.get();
    const v = app.view.state;
    const clock = app.clock;
    const u: UrlState = {
      lat: s.observer.latitude,
      lon: s.observer.longitude,
      elev: s.observer.elevation,
      name: s.locationName,
      az: v.az,
      alt: v.alt,
      fov: v.fov,
    };
    if (withTime || !clock.isLive) {
      u.t = clock.now();
      if (clock.rate !== 1) u.rate = clock.rate;
      if (clock.paused) u.paused = true;
    }
    // always spelled out: the recipient's own saved settings may differ from the defaults
    u.proj = s.projection;
    u.cons = s.constellations;
    u.mw = s.milkyWay;
    const sel = app.selectionUrlKey;
    if (sel) u.sel = sel;
    if (app.trackingForUrl) u.track = true;
    if (this.replay.mission) {
      u.replay = this.replay.mission.id;
      u.auto = this.replay.autoObserver;
    }
    return u;
  }

  /** Called every frame; writes the hash at most once per second, only when it changed. */
  update(): void {
    const now = performance.now();
    if (now - this.lastWrite < WRITE_INTERVAL_MS) return;
    this.lastWrite = now;
    const hash = `#${formatUrlState(this.current(false))}`;
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    try {
      history.replaceState(history.state, '', hash);
    } catch {
      /* sandboxed iframes, rate limits: the link button still works */
    }
  }

  shareUrl(): string {
    const { origin, pathname, search } = location;
    return `${origin}${pathname}${search}#${formatUrlState(this.current(true))}`;
  }

  /** Copy a link to the current view and time; falls back to showing it. */
  async copyShareUrl(): Promise<void> {
    const url = this.shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast('已复制分享链接（地点、时间、视角与选中天体）');
    } catch {
      showLinkBox(url);
    }
  }
}

/** Clipboard unavailable (e.g. plain http on a LAN address): show the link, pre-selected. */
function showLinkBox(url: string): void {
  document.querySelector('.link-box')?.remove();
  const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': '分享链接' });
  const close = h('button', { type: 'button' }, '关闭');
  const box = h('div.link-box', {}, h('div', {}, '复制下面的链接：'), input, close);
  close.addEventListener('click', () => box.remove());
  document.getElementById('ui')?.append(box);
  input.focus();
  input.select();
}

/** Preset place at these coordinates (links without a name), or ''. */
function placeNameAt(lat: number, lon: number): string {
  const p = PLACES.find(
    (x) => Math.abs(x.latitude - lat) < 0.01 && Math.abs(x.longitude - lon) < 0.01,
  );
  return p?.name ?? '';
}

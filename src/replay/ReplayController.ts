import type { App } from '../app';
import type { ObserverLocation } from '../astro';
import { missionById, presetFor, type Mission, type ObserverPreset } from '../missions';
import type { ViewState } from '../render/ViewController';
import type { Target } from '../selection';

/** What entering a replay changes, to put back on exit. */
interface Saved {
  observer: ObserverLocation;
  locationName: string;
  live: boolean;
  timeMs: number;
  rate: number;
  paused: boolean;
  view: ViewState;
  selection: Target | null;
  tracking: boolean;
}

/** Simulated seconds per real second when a replay starts. */
const START_RATE = 10;

/**
 * Drives a launch replay: puts the app's clock, observer and view on the
 * mission, follows the vehicle from site to site ("automatic observer"),
 * stops at the end, and restores the previous state on exit.
 */
export class ReplayController {
  mission: Mission | null = null;
  /** Move the observer along with the flight (see Mission.observers). */
  autoObserver = true;
  private saved: Saved | null = null;
  private lastTPlus = Number.NaN;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: App) {}

  get active(): boolean {
    return this.mission !== null;
  }

  /** Seconds from lift-off at the clock's time (NaN when inactive). */
  get tPlus(): number {
    const m = this.mission;
    return m ? (this.app.clock.now() - m.t0Ms) / 1000 : Number.NaN;
  }

  /** Start replaying a mission from shortly before lift-off. Returns false for an unknown id. */
  enter(id: string): boolean {
    const mission = missionById(id);
    if (!mission) return false;
    const { app } = this;
    if (!this.saved) {
      const s = app.settings.get();
      const clock = app.clock;
      this.saved = {
        observer: s.observer,
        locationName: s.locationName,
        live: clock.isLive,
        timeMs: clock.now(),
        rate: clock.rate,
        paused: clock.paused,
        view: { ...app.view.state },
        selection: app.selection,
        tracking: app.tracking,
      };
    }
    this.mission = mission;
    app.mission = mission;
    this.autoObserver = true;
    this.seek(mission.start);
    app.clock.setRate(START_RATE);
    app.clock.setPaused(false);
    this.applyAutoObserver(true);
    app.view.set({ fov: 60 });
    app.select({ kind: 'vehicle', id: 'ship' }, { track: true });
    this.notify();
    return true;
  }

  exit(): void {
    if (!this.mission) return;
    const { app } = this;
    this.mission = null;
    app.mission = null;
    const s = this.saved;
    this.saved = null;
    if (s) {
      app.settings.set({ observer: s.observer, locationName: s.locationName });
      if (s.live) app.clock.resetToNow();
      else {
        app.clock.setTime(s.timeMs);
        app.clock.setRate(s.rate);
        app.clock.setPaused(s.paused);
      }
      app.view.set(s.view);
      app.select(s.selection, { track: s.tracking });
    } else if (app.selection?.kind === 'vehicle') {
      app.select(null);
    }
    this.notify();
  }

  /** Jump to T+ seconds (clamped to the replay range). */
  seek(tPlus: number): void {
    const m = this.mission;
    if (!m) return;
    const t = Math.min(Math.max(tPlus, m.start), m.end);
    this.app.clock.setTime(m.t0Ms + t * 1000);
    this.lastTPlus = t;
    this.applyAutoObserver();
  }

  setObserver(p: ObserverPreset): void {
    this.autoObserver = false;
    this.moveTo(p);
    this.notify();
  }

  setAutoObserver(on: boolean): void {
    this.autoObserver = on;
    this.applyAutoObserver();
    this.notify();
  }

  /** The preset the observer is at now, if any. */
  currentPreset(): ObserverPreset | undefined {
    const o = this.app.settings.get().observer;
    return this.mission?.observers.find(
      (p) => p.latitude === o.latitude && p.longitude === o.longitude,
    );
  }

  /** Called every frame: stop at the ends of the replay, move the observer along. */
  update(): void {
    const m = this.mission;
    if (!m) return;
    const clock = this.app.clock;
    const t = this.tPlus;
    const prev = this.lastTPlus;
    this.lastTPlus = t;
    // playing past either end pauses there (a jump far outside, e.g. 现在, is left alone)
    if (!clock.paused && Number.isFinite(prev)) {
      if (t > m.end && prev <= m.end && clock.rate > 0) {
        clock.setTime(m.t0Ms + m.end * 1000);
        clock.setPaused(true);
        this.lastTPlus = m.end;
      } else if (t < m.start && prev >= m.start && clock.rate < 0) {
        clock.setTime(m.t0Ms + m.start * 1000);
        clock.setPaused(true);
        this.lastTPlus = m.start;
      }
    }
    this.applyAutoObserver();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private applyAutoObserver(force = false): void {
    const m = this.mission;
    if (!m || (!this.autoObserver && !force)) return;
    const t = this.tPlus;
    if (t < m.start - 1 || t > m.end + 1) return;
    const p = presetFor(m, t);
    if (p && p !== this.currentPreset()) this.moveTo(p);
  }

  private moveTo(p: ObserverPreset): void {
    this.app.settings.set({
      observer: { latitude: p.latitude, longitude: p.longitude, elevation: p.elevation },
      locationName: p.name,
    });
  }
}

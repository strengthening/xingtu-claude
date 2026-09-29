import { SHANGHAI, isValidLocation, type ObserverLocation } from './astro';
import type { ProjectionMode } from './astro/projection';
import type { SurveyId } from './data/hips';
import type { SkyCultureId } from './data/skyculture';

export interface Settings {
  observer: ObserverLocation;
  locationName: string;
  showEquatorialGrid: boolean;
  showAzimuthalGrid: boolean;
  showGround: boolean;
  /**
   * How strongly the atmosphere shows, 0–1 (1 = physically modelled): scales
   * the sky glow of day, twilight and moonlight, the magnitudes they cost, and
   * extinction. Refraction applies at any strength above 0; 0 = no atmosphere.
   */
  atmosphereStrength: number;
  showStarLabels: boolean;
  showBodies: boolean;
  showCardinals: boolean;
  chineseNames: boolean;
  starScale: number;
  projection: ProjectionMode;
  constellations: 'off' | SkyCultureId;
  showConstellationLines: boolean;
  showConstellationLabels: boolean;
  showMansionBoundaries: boolean;
  milkyWay: 'off' | SurveyId;
  milkyWayBrightness: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  observer: { ...SHANGHAI },
  locationName: '上海',
  showEquatorialGrid: false,
  showAzimuthalGrid: false,
  showGround: true,
  atmosphereStrength: 0.6,
  showStarLabels: true,
  showBodies: true,
  showCardinals: true,
  chineseNames: true,
  starScale: 1,
  projection: 'stereographic',
  constellations: 'chinese',
  showConstellationLines: true,
  showConstellationLabels: true,
  showMansionBoundaries: false,
  milkyWay: 'mellinger',
  milkyWayBrightness: 1,
};

const STORAGE_KEY = 'xingtu.settings.v1';

type Listener<T> = (value: Readonly<T>, prev: Readonly<T>) => void;

/** Minimal observable store for UI ↔ app state. */
export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();

  constructor(private value: T) {}

  get(): Readonly<T> {
    return this.value;
  }

  set(patch: Partial<T>): void {
    const prev = this.value;
    this.value = { ...prev, ...patch };
    for (const fn of this.listeners) fn(this.value, prev);
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Settings persisted per browser (best effort — storage may be unavailable). */
export function createSettingsStore(): Store<Settings> {
  const store = new Store<Settings>(loadSettings());
  store.subscribe((s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* private mode etc. */
    }
  });
  return store;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings> & { showAtmosphere?: boolean };
    // the former 大气 on/off switch: "off" becomes strength 0
    if (parsed.showAtmosphere === false && parsed.atmosphereStrength === undefined) {
      parsed.atmosphereStrength = 0;
    }
    delete parsed.showAtmosphere;
    const merged: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
    if (!isValidLocation(merged.observer)) merged.observer = { ...SHANGHAI };
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

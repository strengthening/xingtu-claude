import type { Vec3 } from '../astro';

export type SkyCultureId = 'western' | 'chinese';

export interface Figure {
  id: string;
  zh: string;
  en: string;
  native?: string;
  group?: string;
  mansion?: boolean;
  rank: number;
  lines: number[][];
  label: [number, number, number];
}

export interface SkyCulture {
  id: SkyCultureId;
  source: string;
  license: string;
  url: string;
  epoch: number;
  /** [x, y, z, pmx, pmy, pmz] per vertex. */
  vertices: [number, number, number, number, number, number][];
  figures: Figure[];
  /** Flattened xyz polylines (J2000), e.g. 二十八宿 boundaries. */
  boundaries?: number[][];
}

const cache = new Map<SkyCultureId, Promise<SkyCulture>>();

export function loadSkyCulture(id: SkyCultureId): Promise<SkyCulture> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/skycultures/${id}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for sky culture ${id} (run pnpm data)`);
      return (await res.json()) as SkyCulture;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** 三垣 / 四象 colours (四象 follow tradition; 玄武's black is drawn as indigo). */
export const GROUP_COLORS: Record<string, number> = {
  紫微垣: 0xf2c14e,
  太微垣: 0xe0a94a,
  天市垣: 0xd49545,
  东方苍龙: 0x46c9a0,
  北方玄武: 0x8c7cf0,
  西方白虎: 0xdfe3ea,
  南方朱雀: 0xff6a45,
  近南极天区: 0x7f93b5,
};

export const WESTERN_COLOR = 0x5b8fd9;

export function figureColor(culture: SkyCultureId, f: Figure): number {
  if (culture === 'western') return WESTERN_COLOR;
  return (f.group ? GROUP_COLORS[f.group] : undefined) ?? 0x9aa6c0;
}

export function labelDirection(f: Figure): Vec3 {
  return f.label;
}

import { raDecToVector } from '../astro/coords';
import type { Vec3 } from '../astro/math';

/** One record of names.json (see scripts/build-stars.ts). */
interface NameRecord {
  /** AT-HYG id. */
  id: number;
  hip?: number;
  mag: number;
  /** degrees, J2000 */
  ra: number;
  /** degrees, J2000 */
  dec: number;
  /** proper motion of the unit vector, rad/yr (J2000 frame) */
  pm: [number, number, number];
  /** IAU proper name */
  name?: string;
  /** traditional Chinese names, formal first (Stellarium "Chinese" sky culture) */
  zh?: string[];
  /** Bayer / Flamsteed designation, e.g. "α¹ Cen" */
  des?: string;
  hd?: number;
  spect?: string;
}

export interface NamedStar extends NameRecord {
  nameZh: string | undefined;
  /** J2000 unit vector at epoch J2000.0. */
  eqj: Vec3;
}

/** Named / designated stars, brightest first. */
export async function loadNamedStars(url: string): Promise<NamedStar[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const records = (await res.json()) as NameRecord[];
  return records
    .map((r) => ({ ...r, nameZh: r.zh?.[0], eqj: raDecToVector(r.ra, r.dec) }))
    .sort((a, b) => a.mag - b.mag);
}

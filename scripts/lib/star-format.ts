/**
 * Layout of the generated star files (format v2). Imported by the build
 * scripts (Node) and mirrored by src/data/manifest.ts (browser); keep in sync.
 */
export const STAR_FORMAT = 'xingtu-stars';
export const STAR_FORMAT_VERSION = 2;

/**
 * Float32 fields per star, in order.
 *   x, y, z       unit vector, J2000 mean equator & equinox, epoch J2000.0
 *   pmx, pmy, pmz proper motion as a tangential velocity of that vector, rad / Julian year
 *   mag           V magnitude (Tycho VT converted to V)
 *   ci            B−V (Tycho BT−VT converted), NaN when unknown
 *   dist          distance in parsecs, NaN when unknown
 *   hip           Hipparcos number, 0 when none
 *   cat           AT-HYG v3.2 id (exact in float32: < 2^24)
 */
export const STAR_FIELDS = [
  'x',
  'y',
  'z',
  'pmx',
  'pmy',
  'pmz',
  'mag',
  'ci',
  'dist',
  'hip',
  'cat',
] as const;
export const STAR_STRIDE = STAR_FIELDS.length;
export const STAR_EPOCH = 2000.0;

export interface TierSpec {
  id: string;
  /** Inclusive lower bound (−Infinity for the first tier). */
  magMin: number;
  /** Exclusive upper bound (+Infinity for the last tier). */
  magMax: number;
  /** HEALPix order for spatially tiled tiers; null = one all-sky file. */
  order: number | null;
}

/**
 * Bright tiers load whole; faint tiers are split into HEALPix tiles and
 * fetched (HTTP Range) only for the part of the sky in view.
 */
export const TIERS: readonly TierSpec[] = [
  { id: 'm0', magMin: -Infinity, magMax: 4, order: null },
  { id: 'm1', magMin: 4, magMax: 6.5, order: null },
  { id: 'm2', magMin: 6.5, magMax: 8, order: null },
  { id: 'm3', magMin: 8, magMax: 10, order: 3 },
  { id: 'm4', magMin: 10, magMax: Infinity, order: 4 },
];

/** Tiled tiers are packed into files of at most this size (tiles never straddle files). */
export const PACK_BYTES = 16 * 1024 * 1024;

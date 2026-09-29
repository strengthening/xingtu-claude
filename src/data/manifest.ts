/**
 * Star data manifest (written by scripts/build-stars.ts, format v2).
 * Mirrors scripts/lib/star-format.ts — keep both in sync.
 */

export const STAR_FORMAT = 'xingtu-stars';
export const STAR_FORMAT_VERSION = 2;
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
export type StarField = (typeof STAR_FIELDS)[number];

interface TierBase {
  id: string;
  /** Inclusive lower bound; null = unbounded. */
  magMin: number | null;
  /** Exclusive upper bound; null = unbounded. */
  magMax: number | null;
  count: number;
  bytes: number;
}

export interface AllSkyTier extends TierBase {
  order: null;
  file: string;
}

export interface TiledTier extends TierBase {
  order: number;
  packs: { file: string; count: number; bytes: number }[];
  /** Flattened [pack, startStar, count] per nested HEALPix tile. */
  tiles: number[];
  maxTileCount: number;
}

export type StarTier = AllSkyTier | TiledTier;

export interface StarManifest {
  format: typeof STAR_FORMAT;
  version: number;
  generated: string;
  source: {
    name: string;
    version: string;
    author: string;
    url: string;
    license: string;
    licenseUrl: string;
  };
  namesSource: { name: string; license: string; url: string } | null;
  frame: string;
  epoch: number;
  encoding: 'float32-le';
  stride: number;
  fields: StarField[];
  tiers: StarTier[];
  names: { file: string; count: number; bytes: number };
}

/** Base URL of the generated star data (respects Vite's `base`). */
export const STAR_DATA_URL = `${import.meta.env.BASE_URL}data/stars/`;

export class StarDataMissingError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      `未找到星表数据（${url}）。请先运行 \`pnpm data\`：下载 AT-HYG 与星空文化数据并生成 public/data/。\n` +
        `Star data not found — run \`pnpm data\` to download AT-HYG and build public/data/.`,
      { cause },
    );
    this.name = 'StarDataMissingError';
  }
}

export async function loadManifest(baseUrl = STAR_DATA_URL): Promise<StarManifest> {
  const url = `${baseUrl}manifest.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new StarDataMissingError(url, err);
  }
  // Vite's dev server answers unknown paths with index.html, so check the type too.
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new StarDataMissingError(url);

  const m = (await res.json()) as StarManifest;
  if (m.format !== STAR_FORMAT) throw new Error(`Unexpected star data format "${m.format}"`);
  if (m.version !== STAR_FORMAT_VERSION) {
    throw new Error(
      `星表数据是旧格式 v${m.version}（需要 v${STAR_FORMAT_VERSION}），请运行 \`pnpm data\` 重新生成。`,
    );
  }
  if (m.stride !== STAR_FIELDS.length || STAR_FIELDS.some((f, i) => m.fields[i] !== f)) {
    throw new Error(`Unexpected star field layout: ${m.fields.join(',')}`);
  }
  return m;
}

/**
 * Build constellation figures from Stellarium sky cultures (CC BY-SA 4.0).
 *
 *   pnpm data:build   (runs after build-stars.ts, whose output it reads)
 *
 * Input : data/raw/skycultures/{modern,chinese}/index.json
 *         data/raw/skycultures/chinese/star_names.zh_CN.fab   (三垣 / 四象 grouping)
 *         data/raw/skycultures/chinese/constellation_boundaries.dat (二十八宿 分界)
 *         public/data/stars/*  (HIP → position + proper motion, epoch-checked)
 * Output: public/data/skycultures/{western,chinese}.json
 *
 * Line vertices carry the star's J2000 position and proper-motion vector, so
 * the renderer moves figures together with their stars (same apparent.glsl).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseChineseStarNames, properMotionVector, raDecToUnit } from './lib/catalog.ts';
import { parseNum, splitCsvLine } from './lib/csv.ts';
import { STAR_STRIDE } from './lib/star-format.ts';
import { IAU_CONSTELLATION_ZH as IAU_ZH } from '../src/data/constellations.ts';

const RAW = 'data/raw/skycultures';
const STARS = 'public/data/stars';
const OUT = 'public/data/skycultures';

type Vec6 = [number, number, number, number, number, number];

/** Asterisms whose stars are not listed in star_names.zh_CN.fab (both belong to 尾宿). */
const GROUP_OVERRIDES: Record<string, string> = {
  '神宫(附尾宿)': '东方苍龙',
  鱼: '东方苍龙',
};

/** Deep-sky objects used as line vertices by the Chinese culture (J2000, degrees). */
const DSO: Record<string, [number, number]> = {
  'DSO:NGC2632': [130.1, 19.667], // Praesepe / 积尸气
  'DSO:NGC6231': [253.542, -41.825],
  'DSO:NGC6475': [268.463, -34.793], // M7
};

interface CultureIndex {
  id: string;
  constellations: {
    id: string;
    lines: (number | string)[][];
    common_name: { english?: string; native?: string; pronounce?: string };
  }[];
  lunar_system?: {
    names: { native: string; english: string }[];
    defining_stars: number[];
  };
}

interface Figure {
  id: string;
  /** Display names. */
  zh: string;
  en: string;
  native?: string;
  /** 三垣 / 四象 / 近南极天区 (Chinese culture only). */
  group?: string;
  /** One of the twenty-eight lunar mansions. */
  mansion?: boolean;
  /** Label rank: 0 = always, 1 = normal, 2 = only when zoomed in. */
  rank: number;
  /** Polylines as indices into `stars`. */
  lines: number[][];
  /** Label anchor: normalised mean of the member stars (J2000). */
  label: [number, number, number];
}

function loadStarTable(): { byHip: Map<number, Vec6>; byCat: Map<number, Vec6> } {
  const manifest = JSON.parse(readFileSync(path.join(STARS, 'manifest.json'), 'utf8')) as {
    stride: number;
    tiers: ({ file: string } | { packs: { file: string }[] })[];
  };
  if (manifest.stride !== STAR_STRIDE) throw new Error('star data format mismatch — rebuild stars');
  const files = manifest.tiers.flatMap((t) =>
    'file' in t ? [t.file] : t.packs.map((p) => p.file),
  );
  const byHip = new Map<number, Vec6>();
  const byCat = new Map<number, Vec6>();
  const brightest = new Map<number, number>();
  for (const f of files) {
    const b = readFileSync(path.join(STARS, f));
    const a = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    for (let i = 0; i < a.length; i += STAR_STRIDE) {
      const v: Vec6 = [
        a[i] ?? 0,
        a[i + 1] ?? 0,
        a[i + 2] ?? 0,
        a[i + 3] ?? 0,
        a[i + 4] ?? 0,
        a[i + 5] ?? 0,
      ];
      const mag = a[i + 6] ?? 99;
      const hip = a[i + 9] ?? 0;
      byCat.set(a[i + 10] ?? 0, v);
      if (hip > 0 && mag < (brightest.get(hip) ?? Infinity)) {
        brightest.set(hip, mag);
        byHip.set(hip, v);
      }
    }
  }
  return { byHip, byCat };
}

/**
 * A few Hipparcos components (e.g. ξ UMa B) are not separate AT-HYG entries;
 * fall back to HYG v4.1 (epoch 2000) for those.
 */
function hygFallback(hips: ReadonlySet<number>): Map<number, Vec6> {
  const out = new Map<number, Vec6>();
  const file = 'data/raw/hygdata_v41.csv';
  if (hips.size === 0 || !existsSync(file)) return out;
  const lines = readFileSync(file, 'utf8').split('\n');
  const header = splitCsvLine(lines[0] ?? '');
  const col = (n: string) => header.indexOf(n);
  for (const line of lines.slice(1)) {
    const c = line.includes('"') ? splitCsvLine(line) : line.split(',');
    const hip = parseNum(c[col('hip')]);
    if (!hips.has(hip)) continue;
    const ra = parseNum(c[col('ra')]);
    const dec = parseNum(c[col('dec')]);
    const pm = properMotionVector(ra, dec, parseNum(c[col('pmra')]), parseNum(c[col('pmdec')]));
    out.set(hip, [...raDecToUnit(ra, dec), ...pm]);
  }
  return out;
}

function normalise(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1;
  return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l];
}

function round(v: number, sig = 7): number {
  return Number(v.toPrecision(sig));
}

async function buildCulture(
  cultureId: 'western' | 'chinese',
  index: CultureIndex,
  stars: { byHip: Map<number, Vec6>; byCat: Map<number, Vec6> },
  gaiaToCat: Map<string, number>,
  zhGroups: ReturnType<typeof parseChineseStarNames> | undefined,
): Promise<{ figures: number; segments: number; missing: string[] }> {
  const vertices: Vec6[] = [];
  const vertexIndex = new Map<string, number>();
  const missing: string[] = [];

  const vertexFor = (ref: number | string): number | undefined => {
    const key = String(ref);
    const cached = vertexIndex.get(key);
    if (cached !== undefined) return cached;
    let v: Vec6 | undefined;
    if (typeof ref === 'number') v = stars.byHip.get(ref);
    else if (DSO[ref]) {
      const [ra, dec] = DSO[ref];
      v = [...raDecToUnit(ra / 15, dec), 0, 0, 0];
    } else if (/^\d{10,}$/.test(ref)) {
      const cat = gaiaToCat.get(ref);
      if (cat !== undefined) v = stars.byCat.get(cat);
    }
    if (!v) {
      missing.push(key);
      return undefined;
    }
    vertexIndex.set(key, vertices.length);
    vertices.push(v);
    return vertices.length - 1;
  };

  const mansionNames = new Set(index.lunar_system?.names.map((n) => `${n.native}宿`) ?? []);
  const figures: Figure[] = [];
  let segments = 0;
  for (const c of index.constellations) {
    const lines: number[][] = [];
    const members = new Set<number>();
    for (const poly of c.lines) {
      let cur: number[] = [];
      for (const ref of poly) {
        const vi = vertexFor(ref);
        if (vi === undefined) {
          if (cur.length > 1) lines.push(cur);
          cur = [];
          continue;
        }
        cur.push(vi);
        members.add(vi);
      }
      if (cur.length > 1) lines.push(cur);
    }
    if (lines.length === 0) continue;
    segments += lines.reduce((n, l) => n + l.length - 1, 0);

    const sum = [0, 0, 0];
    for (const m of members) {
      const v = vertices[m];
      if (!v) continue;
      sum[0] = (sum[0] ?? 0) + v[0];
      sum[1] = (sum[1] ?? 0) + v[1];
      sum[2] = (sum[2] ?? 0) + v[2];
    }
    const label = normalise(sum).map((x) => round(x)) as [number, number, number];
    const native = c.common_name.native ?? '';
    const english = c.common_name.english ?? native;

    if (cultureId === 'western') {
      const abbr = c.id.split(' ').at(-1) ?? '';
      figures.push({
        id: abbr,
        zh: IAU_ZH[abbr] ?? native,
        en: native || english,
        native: english,
        rank: members.size >= 6 ? 0 : 1,
        lines,
        label,
      });
    } else {
      // group = section of star_names.zh_CN.fab where most member stars are listed
      const votes = new Map<string, number>();
      for (const poly of c.lines) {
        for (const ref of poly) {
          if (typeof ref !== 'number') continue;
          const g = zhGroups?.groupOfHip.get(ref);
          if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
        }
      }
      let group = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      group ??=
        zhGroups?.groupOf.get(native.replace(/\((.*)\)/, '[$1]')) ??
        zhGroups?.groupOf.get(native) ??
        GROUP_OVERRIDES[native];
      const mansion = mansionNames.has(native);
      figures.push({
        id: c.id.split(' ').at(-1) ?? c.id,
        zh: native,
        en: english,
        ...(group ? { group } : {}),
        ...(mansion ? { mansion } : {}),
        rank: mansion ? 0 : members.size >= 4 ? 1 : 2,
        lines,
        label,
      });
    }
  }

  // 二十八宿 boundaries: hour circles through each mansion's determinative star (距星)
  let boundaries: number[][] | undefined;
  if (cultureId === 'chinese' && index.lunar_system) {
    boundaries = [];
    for (const hip of index.lunar_system.defining_stars) {
      const v = stars.byHip.get(hip);
      if (!v) {
        missing.push(`boundary HIP ${hip}`);
        continue;
      }
      const ra = Math.atan2(v[1], v[0]);
      const line: number[] = [];
      for (let dec = -90; dec <= 90; dec += 2) {
        const d = (dec * Math.PI) / 180;
        line.push(
          round(Math.cos(d) * Math.cos(ra)),
          round(Math.cos(d) * Math.sin(ra)),
          round(Math.sin(d)),
        );
      }
      boundaries.push(line);
    }
  }

  const out = {
    id: cultureId,
    source:
      cultureId === 'western'
        ? 'Stellarium sky culture “Modern (IAU)”'
        : 'Stellarium sky culture “Chinese” (三垣二十八宿)',
    license: 'CC BY-SA 4.0',
    url: `https://github.com/Stellarium/stellarium/tree/master/skycultures/${cultureId === 'western' ? 'modern' : 'chinese'}`,
    epoch: 2000.0,
    /** [x, y, z, pmx, pmy, pmz] per vertex (J2000 unit vector, rad/yr). */
    vertices: vertices.map((v) => v.map((x, i) => (i < 3 ? round(x, 8) : round(x, 5)))),
    figures,
    ...(boundaries ? { boundaries } : {}),
  };
  await writeFile(path.join(OUT, `${cultureId}.json`), JSON.stringify(out));
  return { figures: figures.length, segments, missing };
}

async function main(): Promise<void> {
  for (const f of [
    `${RAW}/modern/index.json`,
    `${RAW}/chinese/index.json`,
    `${STARS}/manifest.json`,
  ]) {
    if (!existsSync(f)) {
      console.error(`${f} missing — run \`pnpm data:fetch\` and build-stars first.`);
      process.exit(1);
    }
  }
  await mkdir(OUT, { recursive: true });
  const stars = loadStarTable();
  const wanted = new Set<number>();
  for (const dir of ['modern', 'chinese']) {
    const index = JSON.parse(readFileSync(`${RAW}/${dir}/index.json`, 'utf8')) as CultureIndex;
    for (const c of index.constellations)
      for (const poly of c.lines)
        for (const r of poly) if (typeof r === 'number' && !stars.byHip.has(r)) wanted.add(r);
  }
  for (const [hip, v] of hygFallback(wanted)) stars.byHip.set(hip, v);
  const zhFile = `${RAW}/chinese/star_names.zh_CN.fab`;
  const zh = existsSync(zhFile) ? parseChineseStarNames(readFileSync(zhFile, 'utf8')) : undefined;
  // the one Gaia-only vertex in the Chinese culture (AT-HYG id resolved once)
  const gaiaToCat = new Map<string, number>([['5350358584482202880', 1125268]]);

  const report = [];
  for (const [id, dir] of [
    ['western', 'modern'],
    ['chinese', 'chinese'],
  ] as const) {
    const index = JSON.parse(readFileSync(`${RAW}/${dir}/index.json`, 'utf8')) as CultureIndex;
    const r = await buildCulture(id, index, stars, gaiaToCat, zh);
    report.push({
      culture: id,
      figures: r.figures,
      segments: r.segments,
      unresolved: r.missing.length,
    });
    if (r.missing.length)
      console.warn(`${id}: unresolved vertices ${r.missing.slice(0, 10).join(', ')}`);
  }
  console.table(report);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

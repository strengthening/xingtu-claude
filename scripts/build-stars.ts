/**
 * Preprocess the AT-HYG star catalogue into compact binary tiles for the browser.
 *
 *   pnpm data:build [--input a.csv.gz,b.csv.gz] [--out public/data/stars]
 *
 * Input : AT-HYG v3.x CSV parts (default data/raw/athyg_v32-*.csv[.gz]);
 *         a HYG v4.x CSV also works (legacy schema is detected).
 *         Optional: Stellarium's chinese/star_names.zh_CN.fab for Chinese names,
 *         and HYG v4.1 (data/raw/hygdata_v41.csv[.gz]) as an epoch check, see fixEpochs().
 * Output: public/data/stars/
 *           manifest.json          tiers, field layout, tile tables, source & licence
 *           stars-m0/m1/m2.bin     all-sky tiers (mag < 4, 4–6.5, 6.5–8)
 *           stars-m3-p*.bin        mag 8–10, HEALPix order-3 tiles (packed)
 *           stars-m4-p*.bin        mag ≥ 10, HEALPix order-4 tiles (packed)
 *           names.json             named / designated / Chinese-named stars (mag < 7.5)
 *
 * Every .bin is little-endian Float32, STAR_STRIDE floats per star (see
 * scripts/lib/star-format.ts). Within a file stars are ordered by tile, then
 * by magnitude, so a tile is one contiguous byte range (fetched with HTTP Range).
 */
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import { npix, vecToNest } from '../src/astro/healpix.ts';
import {
  formatDesignation,
  parseChineseStarNames,
  properMotionVector,
  raDecToUnit,
  tychoToJohnson,
  type ZhStarNames,
} from './lib/catalog.ts';
import { parseNum, splitCsvLine } from './lib/csv.ts';
import {
  PACK_BYTES,
  STAR_EPOCH,
  STAR_FIELDS,
  STAR_FORMAT,
  STAR_FORMAT_VERSION,
  STAR_STRIDE,
  TIERS,
} from './lib/star-format.ts';

const RAW = 'data/raw';
const HYG_REF = existsSync(`${RAW}/hygdata_v41.csv`)
  ? `${RAW}/hygdata_v41.csv`
  : `${RAW}/hygdata_v41.csv.gz`;
const ZH_NAMES = `${RAW}/skycultures/chinese/star_names.zh_CN.fab`;
const NAMED_MAG_LIMIT = 7.5;

type Schema = 'athyg' | 'hyg';

/** Growable columnar store: 44 bytes per star instead of a JS object. */
class Columns {
  n = 0;
  ra = new Float64Array(0);
  dec = new Float64Array(0);
  mag = new Float32Array(0);
  ci = new Float32Array(0);
  pmra = new Float32Array(0);
  pmdec = new Float32Array(0);
  dist = new Float32Array(0);
  hip = new Float32Array(0);
  cat = new Float32Array(0);

  constructor(capacity: number) {
    this.grow(capacity);
  }

  private grow(capacity: number): void {
    const f64 = (a: Float64Array) => {
      const b = new Float64Array(capacity);
      b.set(a.subarray(0, this.n));
      return b;
    };
    const f32 = (a: Float32Array) => {
      const b = new Float32Array(capacity);
      b.set(a.subarray(0, this.n));
      return b;
    };
    this.ra = f64(this.ra);
    this.dec = f64(this.dec);
    this.mag = f32(this.mag);
    this.ci = f32(this.ci);
    this.pmra = f32(this.pmra);
    this.pmdec = f32(this.pmdec);
    this.dist = f32(this.dist);
    this.hip = f32(this.hip);
    this.cat = f32(this.cat);
  }

  push(r: {
    ra: number;
    dec: number;
    mag: number;
    ci: number;
    pmra: number;
    pmdec: number;
    dist: number;
    hip: number;
    cat: number;
  }): number {
    if (this.n === this.ra.length) this.grow(Math.ceil(this.ra.length * 1.5) + 1024);
    const i = this.n++;
    this.ra[i] = r.ra;
    this.dec[i] = r.dec;
    this.mag[i] = r.mag;
    this.ci[i] = r.ci;
    this.pmra[i] = r.pmra;
    this.pmdec[i] = r.pmdec;
    this.dist[i] = r.dist;
    this.hip[i] = r.hip;
    this.cat[i] = r.cat;
    return i;
  }
}

interface NameRecord {
  /** Row in the column store; positions are filled in after the epoch check. */
  row?: number;
  id: number;
  hip?: number;
  mag: number;
  ra: number;
  dec: number;
  pm: [number, number, number];
  name?: string;
  zh?: string[];
  des?: string;
  hd?: number;
  spect?: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      out: { type: 'string', short: 'o', default: 'public/data/stars' },
      'names-zh': { type: 'string', default: ZH_NAMES },
      'epoch-ref': { type: 'string', default: HYG_REF },
    },
  });
  const inputs = values.input ? values.input.split(',') : defaultInputs();
  if (inputs.length === 0 || inputs.some((p) => !existsSync(p))) {
    console.error(
      `Catalogue not found: ${inputs.join(', ') || '(no data/raw/athyg_v32-*.csv[.gz])'}\n` +
        'Run `pnpm data:fetch` first, or pass --input a.csv.gz,b.csv.gz',
    );
    process.exit(1);
  }
  const outDir = values.out;
  const zh = existsSync(values['names-zh'])
    ? parseChineseStarNames(readFileSync(values['names-zh'], 'utf8'))
    : undefined;
  if (!zh) console.warn(`(no ${values['names-zh']} — Chinese star names skipped)`);

  // ---- read -----------------------------------------------------------------
  const t0 = performance.now();
  const cols = new Columns(2_700_000);
  const named: NameRecord[] = [];
  const skipped = { sun: 0, invalid: 0 };
  let schema: Schema = 'athyg';
  let header: Record<string, number> | undefined;
  for (const file of inputs) {
    ({ schema, header } = await readCatalogue(file, cols, named, skipped, zh, header));
  }
  const epochFix =
    schema === 'athyg' && existsSync(values['epoch-ref'])
      ? await fixEpochs(cols, values['epoch-ref'])
      : undefined;
  if (!epochFix) console.warn(`(no ${values['epoch-ref']} — epoch check skipped)`);
  const readMs = performance.now() - t0;

  // ---- tier + tile assignment -------------------------------------------------
  // Remove stale outputs but keep the directory: a running Vite dev server
  // keeps serving a directory it is watching, not one that was re-created.
  await mkdir(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (/^stars-.*\.bin$|^names\.json$|^manifest\.json$/.test(f)) await rm(path.join(outDir, f));
  }

  const tiers = [];
  for (const tier of TIERS) {
    const idx: number[] = [];
    for (let i = 0; i < cols.n; i++) {
      const m = cols.mag[i] ?? 0;
      if (m >= tier.magMin && m < tier.magMax) idx.push(i);
    }
    const tile = new Int32Array(cols.n);
    if (tier.order !== null) {
      for (const i of idx) {
        tile[i] = vecToNest(tier.order, raDecToUnit(cols.ra[i] ?? 0, cols.dec[i] ?? 0));
      }
    }
    idx.sort((a, b) => (tile[a] ?? 0) - (tile[b] ?? 0) || (cols.mag[a] ?? 0) - (cols.mag[b] ?? 0));
    const buf = encode(cols, idx);

    if (tier.order === null) {
      const file = `stars-${tier.id}.bin`;
      await writeFile(path.join(outDir, file), new Uint8Array(buf.buffer));
      tiers.push({
        id: tier.id,
        magMin: finiteOrNull(tier.magMin),
        magMax: finiteOrNull(tier.magMax),
        order: null,
        file,
        count: idx.length,
        bytes: buf.byteLength,
      });
      continue;
    }

    // tiles are contiguous in `idx`; split into packs at tile boundaries
    const n = npix(tier.order);
    const counts = new Int32Array(n);
    for (const i of idx) {
      const t = tile[i] ?? 0;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    const tileBytes = STAR_STRIDE * 4;
    const packs: { file: string; start: number; count: number }[] = [];
    const table: number[] = []; // [pack, startInPack, count] per tile
    let packStart = 0;
    let packCount = 0;
    for (let t = 0; t < n; t++) {
      const c = counts[t] ?? 0;
      if (packCount > 0 && (packCount + c) * tileBytes > PACK_BYTES) {
        packs.push({
          file: `stars-${tier.id}-p${packs.length}.bin`,
          start: packStart,
          count: packCount,
        });
        packStart += packCount;
        packCount = 0;
      }
      table.push(packs.length, packCount, c);
      packCount += c;
    }
    packs.push({
      file: `stars-${tier.id}-p${packs.length}.bin`,
      start: packStart,
      count: packCount,
    });
    for (const p of packs) {
      const slice = buf.subarray(p.start * STAR_STRIDE, (p.start + p.count) * STAR_STRIDE);
      await writeFile(
        path.join(outDir, p.file),
        new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength),
      );
    }
    tiers.push({
      id: tier.id,
      magMin: finiteOrNull(tier.magMin),
      magMax: finiteOrNull(tier.magMax),
      order: tier.order,
      packs: packs.map((p) => ({ file: p.file, count: p.count, bytes: p.count * tileBytes })),
      tiles: table,
      count: idx.length,
      bytes: buf.byteLength,
      maxTileCount: Math.max(...counts),
    });
  }

  // ---- names ------------------------------------------------------------------
  for (const rec of named) {
    const i = rec.row ?? 0;
    const ra = cols.ra[i] ?? 0;
    const dec = cols.dec[i] ?? 0;
    rec.ra = round(ra * 15, 6);
    rec.dec = round(dec, 6);
    const pm = properMotionVector(ra, dec, cols.pmra[i] ?? 0, cols.pmdec[i] ?? 0);
    rec.pm = [pm[0], pm[1], pm[2]].map((v) => Number(v.toPrecision(5))) as [number, number, number];
    delete rec.row;
  }
  named.sort((a, b) => a.mag - b.mag);
  const namesJson = JSON.stringify(named);
  await writeFile(path.join(outDir, 'names.json'), namesJson);

  const athyg = schema === 'athyg';
  const manifest = {
    format: STAR_FORMAT,
    version: STAR_FORMAT_VERSION,
    generated: new Date().toISOString(),
    source: athyg
      ? {
          name: 'AT-HYG',
          version: '3.2',
          author: 'David Nash (astronexus)',
          url: 'https://codeberg.org/astronexus/athyg',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          files: inputs.map((f) => path.basename(f)),
        }
      : {
          name: 'HYG Database',
          version: '4.x',
          author: 'David Nash (astronexus)',
          url: 'https://codeberg.org/astronexus/hyg',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          files: inputs.map((f) => path.basename(f)),
        },
    namesSource: zh
      ? {
          name: 'Stellarium sky culture “Chinese” (star_names.zh_CN.fab)',
          license: 'CC BY-SA 4.0',
          url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures/chinese',
        }
      : null,
    frame: 'EQJ (J2000 mean equator & equinox), unit vectors',
    epoch: STAR_EPOCH,
    encoding: 'float32-le',
    stride: STAR_STRIDE,
    fields: STAR_FIELDS,
    tiers,
    names: { file: 'names.json', count: named.length, bytes: Buffer.byteLength(namesJson) },
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest) + '\n');

  // ---- report -------------------------------------------------------------------
  let inBytes = 0;
  for (const f of inputs) inBytes += (await stat(f)).size;
  console.log(
    `\n${manifest.source.name} → ${outDir}  (${inputs.map((f) => path.basename(f)).join(' + ')}, ${fmtBytes(inBytes)})`,
  );
  console.log(
    `read ${cols.n.toLocaleString()} stars in ${(readMs / 1000).toFixed(1)} s; skipped ${skipped.sun} (Sun) + ${skipped.invalid} (invalid rows)\n`,
  );
  const table = tiers.map((t) => ({
    tier: t.id,
    'mag range': `${t.magMin ?? '-∞'} … ${t.magMax ?? '+∞'}`,
    layout: t.order === null ? 'all-sky' : `HEALPix order ${t.order} (${npix(t.order)} tiles)`,
    files: 'packs' in t && t.packs ? t.packs.length : 1,
    stars: t.count,
    size: fmtBytes(t.bytes),
  }));
  table.push({
    tier: 'names',
    'mag range': `< ${NAMED_MAG_LIMIT}`,
    layout: 'names.json',
    files: 1,
    stars: named.length,
    size: fmtBytes(manifest.names.bytes),
  });
  if (epochFix) {
    console.log(
      `epoch check vs HYG: ${epochFix.checked.toLocaleString()} HIP stars compared, ` +
        `${epochFix.fixed} moved from J1991.25 to J2000.0 (e.g. ${epochFix.examples.join(', ')})\n`,
    );
  }
  console.table(table);
  const total = tiers.reduce((s, t) => s + t.bytes, 0) + manifest.names.bytes;
  console.log(`total ${cols.n.toLocaleString()} stars, ${fmtBytes(total)}\n`);
}

function defaultInputs(): string[] {
  if (!existsSync(RAW)) return [];
  const files = readdirSync(RAW).sort();
  const athyg = files.filter((f) => /^athyg_v3\d*-\d+\.csv(\.gz)?$/.test(f));
  if (athyg.length) return athyg.map((f) => path.join(RAW, f));
  const hyg = files.find((f) => /^hygdata_v4\d*\.csv(\.gz)?$/.test(f));
  return hyg ? [path.join(RAW, hyg)] : [];
}

async function readCatalogue(
  file: string,
  cols: Columns,
  named: NameRecord[],
  skipped: { sun: number; invalid: number },
  zh: ZhStarNames | undefined,
  previousHeader: Record<string, number> | undefined,
): Promise<{ schema: Schema; header: Record<string, number> }> {
  const raw = createReadStream(file);
  const stream = file.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // Later AT-HYG parts continue the first file without repeating its header.
  let col: Record<string, number> = previousHeader ?? {};
  let schema: Schema = 'pm_ra' in col || !previousHeader ? 'athyg' : 'hyg';
  const get = (cells: string[], name: string): string => {
    const i = col[name];
    return i === undefined ? '' : (cells[i] ?? '');
  };

  let first = true;
  for await (const line of rl) {
    if (line === '') continue;
    const cells = line.includes('"') ? splitCsvLine(line) : line.split(',');
    const isHeader = first && !/^\d/.test((cells[0] ?? '').trim());
    if (first && !isHeader && !previousHeader) throw new Error(`${file}: no CSV header`);
    first = false;
    if (isHeader) {
      col = Object.fromEntries(cells.map((h, i) => [h.trim(), i]));
      schema = 'pm_ra' in col ? 'athyg' : 'hyg';
      const need = ['id', 'ra', 'dec', 'mag', 'ci', 'hip', 'proper'];
      const missing = need.filter((c) => !(c in col));
      if (missing.length) throw new Error(`${file}: header lacks ${missing.join(', ')}`);
      continue;
    }

    const proper = get(cells, 'proper').trim();
    if (proper === 'Sol') {
      skipped.sun++;
      continue;
    }
    const ra = parseNum(get(cells, 'ra'));
    const dec = parseNum(get(cells, 'dec'));
    let mag = parseNum(get(cells, 'mag'));
    let ci = parseNum(get(cells, 'ci'));
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag)) {
      skipped.invalid++;
      continue;
    }
    if (schema === 'athyg' && get(cells, 'mag_src') === 'T') {
      const j = tychoToJohnson(mag, ci);
      mag = j.v;
      ci = j.bv;
    }
    let dist = parseNum(get(cells, 'dist'));
    if (!(dist > 0) || dist >= 100000) dist = Number.NaN;
    const hip = parseNum(get(cells, 'hip'));
    const pmra = parseNum(get(cells, schema === 'athyg' ? 'pm_ra' : 'pmra'));
    const pmdec = parseNum(get(cells, schema === 'athyg' ? 'pm_dec' : 'pmdec'));
    const id = parseNum(get(cells, 'id'));

    const row = cols.push({
      ra,
      dec,
      mag,
      ci,
      pmra: Number.isFinite(pmra) ? pmra : 0,
      pmdec: Number.isFinite(pmdec) ? pmdec : 0,
      dist,
      hip: Number.isFinite(hip) ? hip : 0,
      cat: id,
    });

    if (mag < NAMED_MAG_LIMIT) {
      const des = formatDesignation(get(cells, 'bayer'), get(cells, 'flam'), get(cells, 'con'));
      const gaia = get(cells, 'gaia').trim();
      const zhNames =
        (Number.isFinite(hip) ? zh?.byHip.get(hip) : undefined) ??
        (gaia ? zh?.byGaia.get(gaia) : undefined);
      if (proper || des || zhNames) {
        const rec: NameRecord = { row, id, mag: round(mag, 2), ra: 0, dec: 0, pm: [0, 0, 0] };
        if (Number.isFinite(hip)) rec.hip = hip;
        if (proper) rec.name = proper;
        if (zhNames) rec.zh = zhNames;
        if (des) rec.des = des;
        const hd = parseNum(get(cells, 'hd'));
        if (Number.isFinite(hd)) rec.hd = hd;
        const spect = get(cells, 'spect').trim();
        if (spect) rec.spect = spect;
        named.push(rec);
      }
    }
  }
  return { schema, header: col };
}

/**
 * AT-HYG v3.2 takes positions of stars from the Tycho-2 supplement (mostly
 * bright Hipparcos stars) at the Hipparcos epoch J1991.25 although the
 * catalogue is documented as epoch 2000 — e.g. Sirius sits ~11″ off. HYG
 * v4.1 positions are propagated to J2000, so for every HIP star we check
 * which epoch the AT-HYG position matches and, if it is J1991.25, advance it
 * by 8.75 years of its own proper motion.
 */
async function fixEpochs(
  cols: Columns,
  hygFile: string,
): Promise<{ checked: number; fixed: number; examples: string[] }> {
  const ref = new Map<number, [number, number]>();
  const raw = createReadStream(hygFile);
  const input = hygFile.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  const rl = createInterface({ input, crlfDelay: Infinity });
  let col: Record<string, number> | undefined;
  for await (const line of rl) {
    const cells = line.includes('"') ? splitCsvLine(line) : line.split(',');
    if (!col) {
      col = Object.fromEntries(cells.map((h, i) => [h.trim(), i]));
      continue;
    }
    const hip = parseNum(cells[col['hip'] ?? -1]);
    if (!Number.isFinite(hip)) continue;
    ref.set(hip, [parseNum(cells[col['ra'] ?? -1]), parseNum(cells[col['dec'] ?? -1])]);
  }

  const ARCSEC = Math.PI / (180 * 3600);
  const sep = (a: readonly number[], b: readonly number[]) =>
    Math.acos(
      Math.min(
        1,
        (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0),
      ),
    ) / ARCSEC;
  let checked = 0;
  let fixed = 0;
  const examples: string[] = [];
  const dt = 2000 - 1991.25;
  for (let i = 0; i < cols.n; i++) {
    const hip = cols.hip[i] ?? 0;
    const r = hip > 0 ? ref.get(hip) : undefined;
    if (!r) continue;
    checked++;
    const ra = cols.ra[i] ?? 0;
    const dec = cols.dec[i] ?? 0;
    const p = raDecToUnit(ra, dec);
    const v = properMotionVector(ra, dec, cols.pmra[i] ?? 0, cols.pmdec[i] ?? 0);
    const moved = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    const q = raDecToUnit(r[0], r[1]);
    const before = sep(p, q);
    const after = sep(moved, q);
    // only when the proper-motion shift explains the offset clearly
    if (before > 0.5 && after < before / 4) {
      const len = Math.hypot(moved[0] ?? 0, moved[1] ?? 0, moved[2] ?? 0);
      const x = (moved[0] ?? 0) / len;
      const y = (moved[1] ?? 0) / len;
      const z = (moved[2] ?? 0) / len;
      let raH = (Math.atan2(y, x) * 12) / Math.PI;
      if (raH < 0) raH += 24;
      cols.ra[i] = raH;
      cols.dec[i] = (Math.asin(z) * 180) / Math.PI;
      fixed++;
      if (examples.length < 4)
        examples.push(`HIP ${hip} ${before.toFixed(1)}″→${after.toFixed(2)}″`);
    }
  }
  return { checked, fixed, examples };
}

function encode(cols: Columns, idx: readonly number[]): Float32Array {
  const buf = new Float32Array(idx.length * STAR_STRIDE);
  idx.forEach((i, k) => {
    const ra = cols.ra[i] ?? 0;
    const dec = cols.dec[i] ?? 0;
    const [x, y, z] = raDecToUnit(ra, dec);
    const [px, py, pz] = properMotionVector(ra, dec, cols.pmra[i] ?? 0, cols.pmdec[i] ?? 0);
    const o = k * STAR_STRIDE;
    buf[o] = x;
    buf[o + 1] = y;
    buf[o + 2] = z;
    buf[o + 3] = px;
    buf[o + 4] = py;
    buf[o + 5] = pz;
    buf[o + 6] = cols.mag[i] ?? 0;
    buf[o + 7] = cols.ci[i] ?? Number.NaN;
    buf[o + 8] = cols.dist[i] ?? Number.NaN;
    buf[o + 9] = cols.hip[i] ?? 0;
    buf[o + 10] = cols.cat[i] ?? 0;
  });
  return buf;
}

function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

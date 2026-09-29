/**
 * Download raw inputs into data/raw/ (git-ignored, never shipped as-is).
 *
 *   pnpm data:fetch              # AT-HYG v3.2 + Stellarium sky cultures
 *   pnpm data:fetch -- --force   # re-download
 *
 * Sources (all CC BY-SA 4.0):
 *   AT-HYG v3.2      https://codeberg.org/astronexus/athyg (canonical);
 *                    default download from the archived GitHub mirror, which serves v3.2 unchanged.
 *                    Override with ATHYG_BASE_URL=<dir containing athyg_v32-1.csv.gz …>.
 *   HYG v4.1         epoch-2000 reference positions for Hipparcos stars (see build-stars.ts).
 *   Sky cultures     Stellarium "modern" and "chinese", pinned to one upstream commit.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { parseArgs } from 'node:util';

const RAW = 'data/raw';
const ATHYG_BASE =
  process.env['ATHYG_BASE_URL'] ??
  'https://raw.githubusercontent.com/astronexus/ATHYG-Database/main/data';
const ATHYG_PARTS = ['athyg_v32-1.csv.gz', 'athyg_v32-2.csv.gz'];
/** HYG v4.1 — only used as an epoch-2000 position reference for Hipparcos stars. */
const HYG_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';

const STELLARIUM_COMMIT = '9910a2f05c52d4d9f351ff490c9bc4d99670df1f';
const STELLARIUM_BASE = `https://raw.githubusercontent.com/Stellarium/stellarium/${STELLARIUM_COMMIT}/skycultures`;
const SKYCULTURE_FILES = [
  'modern/index.json',
  'modern/description.md',
  'chinese/index.json',
  'chinese/description.md',
  'chinese/star_names.zh_CN.fab',
  'chinese/constellation_boundaries.dat',
];

async function download(url: string, out: string, force: boolean): Promise<void> {
  if (existsSync(out) && !force) {
    const { size } = await stat(out);
    console.log(`✓ ${out} (${(size / 1e6).toFixed(1)} MB, cached)`);
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  process.stdout.write(`↓ ${url}\n`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const tmp = `${out}.part`;
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    createWriteStream(tmp),
  );
  await rename(tmp, out);
  const { size } = await stat(out);
  console.log(`✓ ${out} (${(size / 1e6).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', short: 'f', default: false } },
  });
  const force = values.force;
  for (const part of ATHYG_PARTS) {
    await download(`${ATHYG_BASE}/${part}`, path.join(RAW, part), force);
  }
  // a gzipped copy (e.g. placed by hand) serves the epoch check just as well
  if (force || !existsSync(path.join(RAW, 'hygdata_v41.csv.gz'))) {
    await download(HYG_URL, path.join(RAW, 'hygdata_v41.csv'), force);
  }
  for (const f of SKYCULTURE_FILES) {
    await download(`${STELLARIUM_BASE}/${f}`, path.join(RAW, 'skycultures', f), force);
  }
  console.log('Next: pnpm data:build');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

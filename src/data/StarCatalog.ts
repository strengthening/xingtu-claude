/**
 * Lazy access to the star tiers.
 *
 * - All-sky tiers load whole once the limiting magnitude reaches them.
 * - Tiled tiers (HEALPix) load only the tiles intersecting the view cone,
 *   each tile being one HTTP Range request into a pack file; least recently
 *   visible tiles are evicted beyond a star budget.
 */
import { angularSeparationDeg, npix, queryDisc, vecToNest, type Vec3 } from '../astro';
import {
  STAR_DATA_URL,
  STAR_FIELDS,
  loadManifest,
  type StarManifest,
  type StarTier,
  type TiledTier,
} from './manifest';

export interface StarChunk {
  /** Unique key: tier id, or "tier/tile". */
  key: string;
  tier: StarTier;
  tile: number | null;
  /** Interleaved Float32 records, `stride` floats per star (see STAR_FIELDS). */
  data: Float32Array;
  stride: number;
  count: number;
}

export const FIELD_OFFSET = Object.fromEntries(STAR_FIELDS.map((f, i) => [f, i])) as Record<
  (typeof STAR_FIELDS)[number],
  number
>;

type ChunkListener = (chunk: StarChunk) => void;

interface TileState {
  chunk: StarChunk;
  lastSeen: number;
}

/** Stars kept in memory for tiled tiers before least-recently-seen tiles are dropped. */
const TILED_STAR_BUDGET = 1_200_000;
const MAX_CONCURRENT = 6;

export class StarCatalog {
  private readonly loaded = new Map<string, StarChunk>();
  private readonly tiles = new Map<string, TileState>();
  private readonly pending = new Set<string>();
  private readonly addListeners = new Set<ChunkListener>();
  private readonly removeListeners = new Set<ChunkListener>();
  private readonly packCache = new Map<string, Promise<ArrayBuffer>>();
  private queue: { tier: TiledTier; tile: number; priority: number }[] = [];
  /** Requests that must survive view changes (e.g. a star selected by URL). */
  private urgent: { tier: TiledTier; tile: number; priority: number }[] = [];
  private inFlight = 0;
  private tiledStars = 0;
  private lastView: { centre: Vec3; radius: number; limMag: number } | undefined;
  private readonly visible = new Map<string, Set<number>>();

  private constructor(
    readonly manifest: StarManifest,
    private readonly baseUrl: string,
  ) {}

  static async open(baseUrl = STAR_DATA_URL): Promise<StarCatalog> {
    return new StarCatalog(await loadManifest(baseUrl), baseUrl);
  }

  get namesUrl(): string {
    return `${this.baseUrl}${this.manifest.names.file}`;
  }

  get totalCount(): number {
    return this.manifest.tiers.reduce((n, t) => n + t.count, 0);
  }

  get loadedCount(): number {
    let n = 0;
    for (const c of this.loaded.values()) n += c.count;
    return n;
  }

  isLoading(): boolean {
    return this.pending.size > 0 || this.queue.length > 0 || this.urgent.length > 0;
  }

  /**
   * Load every tier's data around one direction, whatever the magnitude limit
   * (to find a star selected by URL before the user zooms in on it).
   */
  loadAt(eqj: Vec3): void {
    const now = performance.now();
    for (const tier of this.manifest.tiers) {
      if (tier.order === null) {
        void this.loadAllSky(tier);
        continue;
      }
      const tile = vecToNest(tier.order, eqj);
      if ((tier.tiles[tile * 3 + 2] ?? 0) === 0) continue;
      const key = `${tier.id}/${tile}`;
      const state = this.tiles.get(key);
      if (state) state.lastSeen = now;
      else if (!this.pending.has(key)) this.urgent.push({ tier, tile, priority: 1 });
    }
    this.pump();
  }

  /** Every chunk currently in memory (for picking). */
  chunks(): IterableIterator<StarChunk> {
    return this.loaded.values();
  }

  onChunk(fn: ChunkListener): () => void {
    this.addListeners.add(fn);
    for (const c of this.loaded.values()) fn(c);
    return () => this.addListeners.delete(fn);
  }

  onEvict(fn: ChunkListener): () => void {
    this.removeListeners.add(fn);
    return () => this.removeListeners.delete(fn);
  }

  /**
   * Make sure what is needed for the current view is (being) loaded.
   * @param centre view centre, J2000 unit vector
   * @param radiusDeg angular radius of the view (corner), degrees
   */
  update(limMag: number, centre: Vec3, radiusDeg: number): void {
    for (const tier of this.manifest.tiers) {
      const needed = tier.magMin === null || tier.magMin < limMag;
      if (!needed) {
        this.visible.set(tier.id, new Set());
        continue;
      }
      if (tier.order === null) {
        void this.loadAllSky(tier);
      }
    }
    // Recompute tile visibility only when the view moved noticeably.
    const v = this.lastView;
    const moved =
      !v ||
      v.limMag !== limMag ||
      Math.abs(v.radius - radiusDeg) > radiusDeg * 0.05 ||
      angularSeparationDeg(v.centre, centre) > radiusDeg * 0.1;
    if (!moved) return;
    this.lastView = { centre, radius: radiusDeg, limMag };

    const now = performance.now();
    this.queue = [];
    for (const tier of this.manifest.tiers) {
      if (tier.order === null || !(tier.magMin === null || tier.magMin < limMag)) continue;
      const tiles = queryDisc(tier.order, centre, Math.min(radiusDeg, 180) * (Math.PI / 180));
      const set = new Set<number>();
      for (const t of tiles) {
        const count = tier.tiles[t * 3 + 2] ?? 0;
        if (count === 0) continue;
        set.add(t);
        const key = `${tier.id}/${t}`;
        const state = this.tiles.get(key);
        if (state) state.lastSeen = now;
        else if (!this.pending.has(key)) this.queue.push({ tier, tile: t, priority: 0 });
      }
      this.visible.set(tier.id, set);
    }
    // brighter tiers first, then the order returned by queryDisc (roughly by position)
    this.queue.sort((a, b) => (a.tier.magMin ?? 0) - (b.tier.magMin ?? 0));
    this.pump();
    this.evict();
  }

  /** Tiles of a tiered layer intersecting the current view. */
  visibleTiles(tierId: string): ReadonlySet<number> | undefined {
    return this.visible.get(tierId);
  }

  private pump(): void {
    while (this.inFlight < MAX_CONCURRENT && this.urgent.length + this.queue.length > 0) {
      const job = this.urgent.shift() ?? this.queue.shift();
      if (!job) break;
      const key = `${job.tier.id}/${job.tile}`;
      if (this.tiles.has(key) || this.pending.has(key)) continue;
      this.pending.add(key);
      this.inFlight++;
      this.fetchTile(job.tier, job.tile)
        .then((chunk) => {
          this.tiles.set(key, { chunk, lastSeen: performance.now() });
          this.tiledStars += chunk.count;
          this.add(chunk);
        })
        .catch((err: unknown) => console.error(`star tile ${key}`, err))
        .finally(() => {
          this.pending.delete(key);
          this.inFlight--;
          this.pump();
        });
    }
  }

  private evict(): void {
    if (this.tiledStars <= TILED_STAR_BUDGET) return;
    const candidates = [...this.tiles.entries()]
      .filter(([, s]) => {
        const vis = this.visible.get(s.chunk.tier.id);
        return !(s.chunk.tile !== null && vis?.has(s.chunk.tile));
      })
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [key, s] of candidates) {
      if (this.tiledStars <= TILED_STAR_BUDGET * 0.8) break;
      this.tiles.delete(key);
      this.loaded.delete(key);
      this.tiledStars -= s.chunk.count;
      for (const fn of this.removeListeners) fn(s.chunk);
    }
  }

  private add(chunk: StarChunk): void {
    this.loaded.set(chunk.key, chunk);
    for (const fn of this.addListeners) fn(chunk);
  }

  private async loadAllSky(tier: StarTier & { order: null }): Promise<void> {
    if (this.loaded.has(tier.id) || this.pending.has(tier.id)) return;
    this.pending.add(tier.id);
    try {
      const res = await fetch(`${this.baseUrl}${tier.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${tier.file}`);
      const buf = await res.arrayBuffer();
      const stride = this.manifest.stride;
      if (buf.byteLength !== tier.count * stride * 4) {
        throw new Error(`${tier.file}: ${buf.byteLength} bytes, expected ${tier.count * stride * 4}`);
      }
      this.add({ key: tier.id, tier, tile: null, data: new Float32Array(buf), stride, count: tier.count });
    } catch (err) {
      console.error(`Failed to load ${tier.file}`, err);
    } finally {
      this.pending.delete(tier.id);
    }
  }

  private async fetchTile(tier: TiledTier, tile: number): Promise<StarChunk> {
    const stride = this.manifest.stride;
    const pack = tier.tiles[tile * 3] ?? 0;
    const start = tier.tiles[tile * 3 + 1] ?? 0;
    const count = tier.tiles[tile * 3 + 2] ?? 0;
    const file = tier.packs[pack]?.file;
    if (!file) throw new Error(`tile ${tile}: bad pack ${pack}`);
    const from = start * stride * 4;
    const to = (start + count) * stride * 4; // exclusive
    const url = `${this.baseUrl}${file}`;

    let bytes: ArrayBuffer;
    const cached = this.packCache.get(url);
    if (cached) {
      bytes = (await cached).slice(from, to);
    } else {
      const res = await fetch(url, { headers: { Range: `bytes=${from}-${to - 1}` } });
      if (res.status === 206) {
        bytes = await res.arrayBuffer();
      } else if (res.ok) {
        // Server ignored Range: keep the whole pack around for its other tiles.
        const whole = res.arrayBuffer();
        this.packCache.set(url, whole);
        bytes = (await whole).slice(from, to);
      } else {
        throw new Error(`HTTP ${res.status} for ${file}`);
      }
    }
    if (bytes.byteLength !== to - from) {
      throw new Error(`${file} tile ${tile}: got ${bytes.byteLength} bytes, expected ${to - from}`);
    }
    return {
      key: `${tier.id}/${tile}`,
      tier,
      tile,
      data: new Float32Array(bytes),
      stride,
      count,
    };
  }
}

/** Number of tiles for a tiled tier (for status read-outs). */
export function tileCount(tier: TiledTier): number {
  return npix(tier.order);
}

import * as THREE from 'three';
import {
  DARK_SKY_NL,
  GAL_TO_EQJ,
  allskyRect,
  hipsOrderFor,
  mat3Transpose,
  mat3MulVec,
  queryDisc,
  subdivFor,
  tileAngle,
  tileMesh,
  type Mat3,
  type Vec3,
} from '../../astro';
import { ALLSKY_COLUMNS, SURVEYS, allskyUrl, tileUrl, type HipsSurvey } from '../../data/hips';
import type { FrameContext, Layer } from '../context';
import { atmosphereUniforms } from '../atmosphere';
import { projectionUniforms } from '../projection';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import hipsFrag from '../shaders/hips.frag.glsl?raw';
import hipsVert from '../shaders/hips.vert.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import { ORDER, setSkyMatrix } from '../util';

const MAX_TILES = 160;
const MAX_CONCURRENT = 6;
/** After a failure, wait this long before asking the server again (offline, blocked, …). */
const RETRY_MS = 30_000;
const BACKOFF_AFTER = 3;
const EQJ_TO_GAL: Mat3 = mat3Transpose(GAL_TO_EQJ);

interface Tile {
  key: string;
  order: number;
  ipix: number;
  mesh: THREE.Mesh | undefined;
  texture: THREE.Texture | undefined;
  state: 'loading' | 'ready' | 'failed';
  lastUsed: number;
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false; // HiPS orientation is defined with row 0 at the top (see astro/hips.ts)
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Milky Way / survey background from a HiPS: the order-3 Allsky mosaic as an
 * always-present base, plus individual tiles at the order matching the zoom.
 * Tiles are drawn highest order first with a stencil so every pixel receives
 * light from exactly one level (additive blending on top of the sky colour).
 */
export class HipsLayer implements Layer {
  readonly object = new THREE.Group();
  private survey: HipsSurvey | undefined;
  private override: HipsSurvey | undefined;
  private allsky: THREE.Mesh | undefined;
  private allskyState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private allskyFailedAt = 0;
  /** Bumped on every survey switch, so late responses for an old choice are dropped. */
  private generation = 0;
  /** Consecutive failed requests (Allsky or tiles); several in a row = server unreachable. */
  private failures = 0;
  private lastFailure = 0;
  private readonly tiles = new Map<string, Tile>();
  private queue: { order: number; ipix: number }[] = [];
  private inFlight = 0;
  private lastQuery = '';
  private readonly uniforms = {
    ...projectionUniforms,
    ...atmosphereUniforms,
    uBrightness: { value: 0.8 },
    uBlackPoint: { value: 0.02 },
  };
  /** Human-readable status for the UI. */
  status = '';

  constructor() {
    this.object.name = 'hips';
    this.object.matrixAutoUpdate = false;
  }

  /** Use a custom survey (e.g. a local test HiPS); undefined restores the settings choice. */
  useSurvey(s: HipsSurvey | undefined): void {
    this.override = s;
    this.setSurvey(undefined);
  }

  get activeSurvey(): HipsSurvey | undefined {
    return this.survey;
  }

  private material(texture: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name: 'HipsMaterial',
      uniforms: { ...this.uniforms, uMap: { value: texture } },
      vertexShader: `${projectionGlsl}\n${atmosphereGlsl}\n${hipsVert}`,
      fragmentShader: `${atmosphereGlsl}\n${hipsFrag}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // seen from inside the sphere, winding depends on the projection
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
  }

  private setSurvey(s: HipsSurvey | undefined): void {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.queue = [];
    this.lastQuery = '';
    if (this.allsky) {
      this.object.remove(this.allsky);
      this.allsky.geometry.dispose();
      const m = this.allsky.material as THREE.ShaderMaterial;
      (m.uniforms['uMap']?.value as THREE.Texture | undefined)?.dispose();
      m.dispose();
      this.allsky = undefined;
    }
    this.allskyState = 'none';
    this.failures = 0;
    this.generation++;
    this.survey = s;
  }

  /** Pause new requests for a while after several failures in a row (offline, blocked, …). */
  private backingOff(now: number): boolean {
    return this.failures >= BACKOFF_AFTER && now - this.lastFailure < RETRY_MS;
  }

  private noteFailure(): void {
    this.failures++;
    this.lastFailure = performance.now();
  }

  private toEqj(): Mat3 | undefined {
    return this.survey?.frame === 'galactic' ? GAL_TO_EQJ : undefined;
  }

  private loadAllsky(s: HipsSurvey): void {
    this.allskyState = 'loading';
    const gen = this.generation;
    loadTexture(allskyUrl(s))
      .then((tex) => {
        if (this.generation !== gen) {
          tex.dispose();
          return;
        }
        this.failures = 0;
        const img = tex.image as ImageBitmap;
        const positions: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const sub = subdivFor(3);
        for (let ipix = 0; ipix < 768; ipix++) {
          const rect = allskyRect(ipix, img.width, img.height, ALLSKY_COLUMNS);
          const m = tileMesh(3, ipix, sub, this.toEqj(), rect);
          const base = positions.length / 3;
          positions.push(...m.positions);
          uvs.push(...m.uvs);
          for (const i of m.indices) indices.push(base + i);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(indices);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
        tex.generateMipmaps = false; // mipmaps would bleed across the mosaic's tiles
        tex.minFilter = THREE.LinearFilter;
        const mesh = new THREE.Mesh(g, this.material(tex));
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = ORDER.hips + 0.09; // lowest priority level
        this.allsky = mesh;
        this.object.add(mesh);
        this.allskyState = 'ready';
      })
      .catch((err: unknown) => {
        if (this.generation !== gen) return;
        this.allskyState = 'failed';
        this.allskyFailedAt = performance.now();
        this.noteFailure();
        console.warn('HiPS Allsky failed', err);
      });
  }

  update(ctx: FrameContext): void {
    const choice = ctx.settings.milkyWay;
    const wanted = choice === 'off' ? undefined : (this.override ?? SURVEYS[choice]);
    if (wanted !== this.survey) this.setSurvey(wanted);
    const s = this.survey;
    this.object.visible = !!s;
    if (!s) {
      this.status = '';
      return;
    }
    const now = performance.now();
    if (this.allskyState === 'failed' && now - this.allskyFailedAt > RETRY_MS) {
      this.allskyState = 'none';
    }
    if (this.allskyState === 'none') this.loadAllsky(s);
    setSkyMatrix(this.object, ctx.eqjToWorld);
    // contrast against the sky: daylight/twilight and moonlight wash the survey out
    this.uniforms.uBrightness.value =
      s.brightness *
      ctx.settings.milkyWayBrightness *
      Math.max(0, 1 - 1.4 * ctx.sky.level * ctx.atmStrength) *
      (DARK_SKY_NL / (DARK_SKY_NL + ctx.moonSkyNl));

    // ---- which tiles --------------------------------------------------------
    const pixelAngle = 1 / (ctx.projection.pxPerRad * ctx.pixelRatio);
    const allskyTexel = tileAngle(3) / (s.tileWidth / 8);
    const visible = new Set<string>();
    const backoff = this.backingOff(now);
    if (backoff) {
      // stop asking an unreachable server; re-queue from scratch once the pause is over
      this.queue = [];
      this.lastQuery = '';
    }
    if (pixelAngle * 1.25 < allskyTexel) {
      const order = hipsOrderFor(pixelAngle, s.tileWidth, s.minOrder, s.maxOrder);
      const c = ctx.viewCentreEqj;
      const centre: Vec3 = s.frame === 'galactic' ? mat3MulVec(EQJ_TO_GAL, c) : c;
      const radius = Math.min(ctx.projection.viewRadiusDeg, 180) * (Math.PI / 180);
      const tiles = queryDisc(order, centre, radius);
      const query = `${order}:${tiles.length}:${tiles[0]}:${tiles.at(-1)}`;
      const requeue = !backoff && query !== this.lastQuery;
      if (!backoff) this.lastQuery = query;
      if (requeue) this.queue = [];
      for (const ipix of tiles) {
        const key = `${order}/${ipix}`;
        let t = this.tiles.get(key);
        if (t?.state === 'ready') {
          visible.add(key);
          t.lastUsed = now;
          continue;
        }
        // a failed tile is retried once its pause is over
        const retry = t?.state === 'failed' && !backoff && now - t.lastUsed > RETRY_MS;
        if (retry) {
          this.tiles.delete(key);
          t = undefined;
        }
        if (!t && (requeue || retry)) this.queue.push({ order, ipix });
        // until it arrives, show the nearest loaded ancestor
        for (let o = order - 1, a = ipix >> 2; o >= s.minOrder; o--, a >>= 2) {
          const parent = this.tiles.get(`${o}/${a}`);
          if (parent?.state === 'ready') {
            visible.add(parent.key);
            parent.lastUsed = now;
            break;
          }
        }
      }
      if (!backoff) this.pump(s);
    }
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = visible.has(t.key);
    this.evict();
    const loading = this.inFlight + this.queue.length;
    if (this.allskyState === 'failed' || backoff) {
      this.status = `银河背景加载失败（${s.url}），稍后自动重试`;
    } else {
      this.status = loading > 0 ? `${s.name}：加载 ${loading} 块…` : s.name;
    }
  }

  private pump(s: HipsSurvey): void {
    const gen = this.generation;
    while (
      this.inFlight < MAX_CONCURRENT &&
      this.queue.length > 0 &&
      !this.backingOff(performance.now())
    ) {
      const job = this.queue.shift();
      if (!job) break;
      const key = `${job.order}/${job.ipix}`;
      if (this.tiles.has(key)) continue;
      const tile: Tile = {
        key,
        order: job.order,
        ipix: job.ipix,
        mesh: undefined,
        texture: undefined,
        state: 'loading',
        lastUsed: performance.now(),
      };
      this.tiles.set(key, tile);
      this.inFlight++;
      loadTexture(tileUrl(s, job.order, job.ipix))
        .then((tex) => {
          if (this.generation !== gen || this.tiles.get(key) !== tile) {
            tex.dispose();
            return;
          }
          this.failures = 0;
          const m = tileMesh(job.order, job.ipix, subdivFor(job.order), this.toEqj());
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
          g.setIndex(new THREE.BufferAttribute(m.indices, 1));
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
          const mesh = new THREE.Mesh(g, this.material(tex));
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          // higher orders draw first and win the stencil
          mesh.renderOrder = ORDER.hips + (12 - job.order) * 0.005;
          mesh.visible = false;
          tile.mesh = mesh;
          tile.texture = tex;
          tile.state = 'ready';
          this.object.add(mesh);
        })
        .catch(() => {
          tile.state = 'failed';
          tile.lastUsed = performance.now();
          if (this.generation === gen) this.noteFailure();
        })
        .finally(() => {
          this.inFlight--;
          if (this.generation === gen) this.pump(s);
        });
    }
  }

  private evict(): void {
    if (this.tiles.size <= MAX_TILES) return;
    const now = performance.now();
    // failed tiles are remembered for a while so they are not re-requested every frame
    const old = [...this.tiles.values()]
      .filter((t) =>
        t.state === 'ready'
          ? !t.mesh?.visible
          : t.state === 'failed' && now - t.lastUsed > RETRY_MS,
      )
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of old) {
      if (this.tiles.size <= MAX_TILES * 0.8) break;
      this.disposeTile(t);
      this.tiles.delete(t.key);
    }
  }

  private disposeTile(t: Tile): void {
    if (t.mesh) {
      this.object.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    t.texture?.dispose();
  }

  dispose(): void {
    this.setSurvey(undefined);
  }
}

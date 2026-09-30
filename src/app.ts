import * as THREE from 'three';
import { MakeTime } from 'astronomy-engine';
import {
  EXTINCTION_K,
  SimClock,
  aberrationBeta,
  angularSeparationDeg,
  clamp,
  ksAirmass,
  moonIllumFactor,
  moonSkyBrightness,
  skyBrightnessPenalty,
  yearsSinceJ2000,
  computeBodies,
  computeFrames,
  labelMagnitudeLimit,
  limitingMagnitude,
  mat3MulVec,
  skyBrightness,
  worldToAltAz,
  type BodyState,
  type Vec3,
} from './astro';
import { StarDataMissingError } from './data/manifest';
import { loadNamedStars, type NamedStar } from './data/names';
import { FIELD_OFFSET, StarCatalog, type StarChunk } from './data/StarCatalog';
import { computeReplayFrame, vehicleView, type Mission, type ReplayFrame } from './missions';
import type { FrameContext } from './render/context';
import { LabelOverlay } from './render/LabelOverlay';
import {
  addBodyLabels,
  addCardinalLabels,
  addFigureLabels,
  addGridLabels,
  addStarLabels,
  addVehicleLabels,
  pxPerDegree,
  starRadiusPx,
} from './render/labels';
import { bodyMarkerRadiusPx } from './render/layers/BodyLayer';
import { effectiveMagnitude, pickTarget, starTargetAt } from './render/picking';
import { ConstellationLayer } from './render/layers/ConstellationLayer';
import { GridLayer } from './render/layers/GridLayer';
import { HipsLayer } from './render/layers/HipsLayer';
import { BodyLayer } from './render/layers/BodyLayer';
import { HorizonLayer } from './render/layers/HorizonLayer';
import { StarLayer } from './render/layers/StarLayer';
import { VehicleLayer, vehicleSpritePx } from './render/layers/VehicleLayer';
import { SkyRenderer } from './render/SkyRenderer';
import { updateApparentUniforms } from './render/apparent';
import { updateAtmosphereUniforms } from './render/atmosphere';
import { makeProjectionState, updateProjectionUniforms, worldToScreen } from './render/projection';
import { mat3ToMatrix4, vec3 } from './render/util';
import { ViewController } from './render/ViewController';
import {
  formatTargetKey,
  sameTarget,
  targetKey,
  targetUrlKey,
  targetWorld,
  type StarTarget,
  type Target,
  type TargetKey,
} from './selection';
import { createSettingsStore } from './state';
import { targetTitle } from './ui/describe';

export class App {
  readonly settings = createSettingsStore();
  readonly clock = new SimClock();
  readonly sky: SkyRenderer;
  readonly view: ViewController;
  readonly horizon = new HorizonLayer();
  readonly hips = new HipsLayer();
  readonly grids = new GridLayer();
  readonly figures = new ConstellationLayer();
  readonly stars = new StarLayer();
  readonly bodies = new BodyLayer();
  readonly vehicles = new VehicleLayer();
  readonly labels: LabelOverlay;
  catalog: StarCatalog | undefined;
  namedStars: NamedStar[] = [];
  catalogError: unknown;
  /** Launch being replayed (set by the ReplayController), drawn in the observer's sky. */
  mission: Mission | null = null;

  /** Clicked object shown in the info card, and whether the view follows it. */
  selection: Target | null = null;
  tracking = false;
  /** Selection requested by URL, waiting for its star data to load. */
  private pending: { key: TargetKey; track: boolean; centre: boolean } | null = null;
  private readonly selectListeners = new Set<(t: Target | null) => void>();
  private readonly namedById = new Map<number, NamedStar>();
  private readonly marker: HTMLElement;
  private readonly trackWorld = new THREE.Vector3();

  /** Last computed frame, for UI read-outs. */
  lastFrame: FrameContext | undefined;
  private readonly eqjToWorld = new THREE.Matrix4();
  private readonly eqdToWorld = new THREE.Matrix4();
  private readonly sunWorld = new THREE.Vector3();
  private readonly moonWorld = new THREE.Vector3();
  private readonly worldToEqj = new THREE.Matrix3();
  private readonly forward = new THREE.Vector3();
  private readonly listeners = new Set<(ctx: FrameContext) => void>();
  private raf = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
    private readonly overlay: HTMLElement,
  ) {
    this.sky = new SkyRenderer(canvas);
    this.view = new ViewController(this.sky.camera, canvas, () => this.settings.get().projection);
    this.view.onClick = (x, y) => this.select(this.pickAt(x, y));
    this.view.onUserPan = () => this.setTracking(false);
    this.settings.subscribe((s, prev) => {
      if (s.projection !== prev.projection) this.view.apply(); // re-clamp FOV
    });
    this.labels = new LabelOverlay(labelRoot);
    this.marker = document.createElement('div');
    this.marker.className = 'selection-ring';
    this.marker.hidden = true;
    labelRoot.append(this.marker);
    this.sky.add(this.horizon);
    this.sky.add(this.hips);
    this.sky.add(this.grids);
    this.sky.add(this.figures);
    this.sky.add(this.stars);
    this.sky.add(this.bodies);
    this.sky.add(this.vehicles);
  }

  async start(): Promise<void> {
    this.loop();
    try {
      this.catalog = await StarCatalog.open();
      this.catalog.onChunk((chunk) => {
        this.stars.addChunk(chunk);
        this.resolvePending([chunk]);
      });
      this.catalog.onEvict((chunk) => this.stars.removeChunk(chunk));
      this.requestPending();
      this.namedStars = await loadNamedStars(this.catalog.namesUrl);
      for (const s of this.namedStars) this.namedById.set(s.id, s);
      this.requestPending(); // a URL key without a position can now be located by name
      this.notifySelect(); // names may improve the card's title
    } catch (err) {
      this.catalogError = err;
      this.showError(err);
    }
  }

  // ---- selection ---------------------------------------------------------------

  /** Object under a client-space point, or null for empty sky. */
  pickAt(clientX: number, clientY: number): Target | null {
    const ctx = this.lastFrame;
    if (!ctx) return null;
    const r = this.canvas.getBoundingClientRect();
    const world = this.view.directionAt(clientX, clientY);
    return pickTarget(ctx, clientX - r.left, clientY - r.top, world, this.catalog?.chunks() ?? []);
  }

  /**
   * Select an object (null clears). `track` given explicitly (URL) sets tracking;
   * otherwise tracking survives only re-selecting the same object.
   */
  select(t: Target | null, opts: { track?: boolean } = {}): void {
    this.pending = null;
    const changed = !sameTarget(t, this.selection);
    this.selection = t;
    if (opts.track !== undefined) this.tracking = opts.track && t !== null;
    else if (changed || !t) this.tracking = false;
    if (this.tracking) this.centreOnSelection();
    this.notifySelect();
  }

  /**
   * Select by URL key. Stars resolve once their data is loaded: the tiles
   * around the key's position (or the named star's) are fetched right away.
   * `centre` turns the view to the star when it resolves (the URL had no view).
   */
  selectByKey(key: TargetKey, opts: { track?: boolean; centre?: boolean } = {}): void {
    if (key.kind === 'body' || key.kind === 'vehicle') {
      this.select(key, { track: opts.track ?? false });
      if (opts.centre) this.centreOnSelection();
      return;
    }
    this.select(null);
    this.pending = { key, track: opts.track ?? false, centre: opts.centre ?? false };
    this.requestPending();
  }

  /** True while a URL-selected star is still being looked up. */
  get hasPendingSelection(): boolean {
    return this.pending !== null;
  }

  private requestPending(): void {
    const p = this.pending;
    if (!p || p.key.kind === 'body' || p.key.kind === 'vehicle' || !this.catalog) return;
    this.resolvePending(this.catalog.chunks());
    if (!this.pending) return;
    const k = p.key;
    const named =
      k.kind === 'hip' ? this.namedStars.find((s) => s.hip === k.hip) : this.namedById.get(k.cat);
    const near = k.near ?? named?.eqj;
    if (near) this.catalog.loadAt(near);
  }

  private resolvePending(chunks: Iterable<StarChunk>): void {
    const p = this.pending;
    if (!p || p.key.kind === 'body' || p.key.kind === 'vehicle') return;
    for (const chunk of chunks) {
      const t = findStar(chunk, p.key);
      if (t) {
        this.select(t, { track: p.track });
        if (p.centre) this.centreOnSelection();
        return;
      }
    }
  }

  onSelect(fn: (t: Target | null) => void): () => void {
    this.selectListeners.add(fn);
    return () => this.selectListeners.delete(fn);
  }

  private notifySelect(): void {
    for (const fn of this.selectListeners) fn(this.selection);
  }

  namedStar(t: Target): NamedStar | undefined {
    return t.kind === 'star' ? this.namedById.get(t.cat) : undefined;
  }

  /** Selection as written to the URL (stars with their position), including one still loading. */
  get selectionUrlKey(): string | undefined {
    if (this.selection) return targetUrlKey(this.selection);
    return this.pending ? formatTargetKey(this.pending.key) : undefined;
  }

  /** Tracking as written to the URL (a pending selection keeps its requested tracking). */
  get trackingForUrl(): boolean {
    return this.tracking || (this.pending?.track ?? false);
  }

  centreOnSelection(): void {
    const ctx = this.lastFrame;
    if (!ctx || !this.selection) return;
    const w = targetWorld(this.selection, ctx);
    if (w) this.view.lookAt(w);
  }

  setTracking(on: boolean): void {
    const next = on && this.selection !== null;
    if (next === this.tracking) return;
    this.tracking = next;
    if (next) this.centreOnSelection();
    this.notifySelect();
  }

  /** Subscribe to per-frame updates (UI read-outs). */
  onFrame(fn: (ctx: FrameContext) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.sky.resize();
    const ctx = this.buildFrame();
    if (this.catalog) {
      // view centre in J2000: world forward rotated back through eqjToWorldᵀ
      this.worldToEqj.setFromMatrix4(ctx.eqjToWorld).transpose();
      const c = this.forward
        .set(0, 0, -1)
        .applyQuaternion(ctx.camera.quaternion)
        .applyMatrix3(this.worldToEqj);
      this.catalog.update(ctx.limMag, [c.x, c.y, c.z], ctx.projection.viewRadiusDeg);
    }
    this.sky.render(ctx);
    this.renderLabels(ctx);
    this.lastFrame = ctx;
    for (const fn of this.listeners) fn(ctx);
  };

  private buildFrame(): FrameContext {
    const settings = this.settings.get();
    const atmOn = settings.atmosphereStrength > 0;
    const time = MakeTime(new Date(this.clock.now()));
    const frames = computeFrames(time, settings.observer);
    const years = yearsSinceJ2000(time);
    const beta = aberrationBeta(time);
    updateApparentUniforms(years, beta);
    const bodies: BodyState[] = computeBodies(time, settings.observer);
    const replay: ReplayFrame | null = this.mission
      ? computeReplayFrame(this.mission, this.clock.now(), settings.observer)
      : null;
    mat3ToMatrix4(frames.eqjToWorld, this.eqjToWorld);
    mat3ToMatrix4(frames.eqdToWorld, this.eqdToWorld);
    if (this.tracking && this.selection) {
      // follow before anything reads the camera, so labels and stars agree this frame
      const w = targetWorld(
        this.selection,
        { eqjToWorld: this.eqjToWorld, years, beta, bodies, atmosphere: atmOn, replay },
        this.trackWorld,
      );
      if (w && this.selection.kind === 'vehicle') keepAboveHorizon(w);
      if (w) this.view.lookAt(w);
    }

    const sun = bodies[0];
    const sunW = sun ? mat3MulVec(frames.eqjToWorld, sun.eqj) : ([0, -1, 0] as const);
    vec3(sunW, this.sunWorld);
    const sunAltDeg = worldToAltAz(sunW).alt;
    const sky = skyBrightness(sunAltDeg);
    // atmosphere strength: 1 = as modelled; lower values let the stars show through
    const atmStrength = clamp(settings.atmosphereStrength, 0, 1);
    const extinctionK = EXTINCTION_K * atmStrength;
    const skyPenalty = sky.magPenalty * atmStrength;
    const fov = this.view.state.fov;

    // Moon: world direction + Krisciunas–Schaefer factor for the shaders
    const moon = bodies.find((b) => b.id === 'Moon');
    const moonW = moon ? mat3MulVec(frames.eqjToWorld, moon.eqj) : ([0, -1, 0] as const);
    vec3(moonW, this.moonWorld);
    const moonAlt = worldToAltAz(moonW).alt;
    const moonFactor =
      moon && moonAlt > 0
        ? moonIllumFactor(moon.phaseAngleDeg) * 10 ** (-0.4 * EXTINCTION_K * ksAirmass(moonAlt))
        : 0;
    updateAtmosphereUniforms(atmOn, this.moonWorld, moonFactor, atmStrength);
    const centreEqj = this.viewCentreEqj();
    const centreW = mat3MulVec(frames.eqjToWorld, centreEqj);
    const moonSkyNl =
      atmOn && moon
        ? moonSkyBrightness({
            phaseAngleDeg: moon.phaseAngleDeg,
            moonAltDeg: moonAlt,
            targetAltDeg: Math.max(worldToAltAz(centreW).alt, 0.5),
            separationDeg: angularSeparationDeg(moonW, centreW),
          })
        : 0;
    // like the twilight penalty, moonlight's cost in magnitudes scales with the strength
    const moonPenalty = skyBrightnessPenalty(moonSkyNl) * atmStrength;
    const projection = makeProjectionState(
      { mode: settings.projection, fov, aspect: this.sky.width / this.sky.height },
      this.sky.height,
    );
    updateProjectionUniforms(projection);

    return {
      frames,
      years,
      beta,
      bodies,
      replay,
      eqjToWorld: this.eqjToWorld,
      eqdToWorld: this.eqdToWorld,
      sunWorld: this.sunWorld,
      sunAltDeg,
      sky,
      atmStrength,
      atmosphere: atmOn,
      extinctionK,
      limMag: limitingMagnitude(fov, skyPenalty),
      moonPenalty,
      moonSkyNl: moonSkyNl * atmStrength,
      labelMag: labelMagnitudeLimit(fov, skyPenalty + moonPenalty),
      settings,
      camera: this.sky.camera,
      projection,
      viewCentreEqj: centreEqj,
      width: this.sky.width,
      height: this.sky.height,
      pixelRatio: this.sky.pixelRatio,
    };
  }

  /** View centre in J2000: world forward rotated back through eqjToWorldᵀ. */
  private viewCentreEqj(): Vec3 {
    this.worldToEqj.setFromMatrix4(this.eqjToWorld).transpose();
    const c = this.forward
      .set(0, 0, -1)
      .applyQuaternion(this.sky.camera.quaternion)
      .applyMatrix3(this.worldToEqj);
    return [c.x, c.y, c.z];
  }

  private renderLabels(ctx: FrameContext): void {
    this.labels.begin();
    addCardinalLabels(this.labels, ctx);
    addBodyLabels(this.labels, ctx);
    addStarLabels(this.labels, ctx, this.namedStars);
    addGridLabels(this.labels, ctx);
    addFigureLabels(this.labels, ctx, this.figures.active);
    addVehicleLabels(this.labels, ctx);
    this.placeMarker(ctx);
    this.labels.end(ctx.camera, ctx.projection, ctx.width, ctx.height);
  }

  /** Ring around the selected object, plus its name even if it is not normally labelled. */
  private placeMarker(ctx: FrameContext): void {
    const t = this.selection;
    const w = t ? targetWorld(t, ctx, this.trackWorld) : null;
    const p = w && worldToScreen(w, ctx.camera, ctx.projection, ctx.width, ctx.height);
    if (!t || !w || !p) {
      this.marker.hidden = true;
      return;
    }
    let r: number;
    if (t.kind === 'body') {
      const b = ctx.bodies.find((x) => x.id === t.id);
      r = b ? bodyMarkerRadiusPx(b, pxPerDegree(ctx)) : 6;
    } else if (t.kind === 'vehicle') {
      const v = vehicleView(ctx.replay, t.id);
      r = v ? (vehicleSpritePx(v) * ctx.settings.starScale) / 2 : 6;
    } else {
      const eff = Math.min(effectiveMagnitude(ctx, t.mag, w), ctx.limMag);
      r = starRadiusPx(eff, ctx.limMag, ctx.settings.starScale);
    }
    r = Math.max(r + 5, 9);
    this.marker.hidden = false;
    this.marker.style.width = this.marker.style.height = `${2 * r}px`;
    this.marker.style.transform = `translate(${(p[0] - r).toFixed(1)}px, ${(p[1] - r).toFixed(1)}px)`;
    this.marker.classList.toggle('tracking', this.tracking);
    this.labels.add({
      id: `selected-${targetKey(t)}`,
      text: targetTitle(t, this.namedStar(t), ctx.settings.chineseNames),
      world: w,
      kind: 'selected',
      priority: -1,
      dx: r * 0.72 + 3,
      dy: -r * 0.72 - 4,
    });
  }

  private showError(err: unknown): void {
    console.error(err);
    const box = document.createElement('div');
    box.className = 'error-box';
    const msg = err instanceof StarDataMissingError ? err.message : String(err);
    box.textContent = msg;
    this.overlay.append(box);
  }

  dispose(): void {
    this.marker.remove();
    cancelAnimationFrame(this.raf);
    this.view.dispose();
    this.labels.clear();
    this.sky.dispose();
  }
}

/**
 * A tracked vehicle below the horizon (not yet risen, or set) is followed
 * along the horizon a little above it, so the view shows sky rather than ground.
 */
const MIN_TRACK_ALT = Math.sin(8 * (Math.PI / 180));
function keepAboveHorizon(w: THREE.Vector3): void {
  w.normalize();
  if (w.y >= MIN_TRACK_ALT) return;
  const h = Math.hypot(w.x, w.z) || 1;
  const c = Math.sqrt(1 - MIN_TRACK_ALT ** 2);
  w.set((w.x / h) * c, MIN_TRACK_ALT, (w.z / h) * c);
}

/** Find a star by HIP / AT-HYG id in a loaded chunk. */
function findStar(
  chunk: StarChunk,
  key: Extract<TargetKey, { kind: 'hip' | 'athyg' }>,
): StarTarget | null {
  const field = key.kind === 'hip' ? FIELD_OFFSET.hip : FIELD_OFFSET.cat;
  const want = key.kind === 'hip' ? key.hip : key.cat;
  const { data, stride, count } = chunk;
  for (let i = 0; i < count; i++) {
    if (data[i * stride + field] === want) return starTargetAt(chunk, i);
  }
  return null;
}

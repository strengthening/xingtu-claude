import * as THREE from 'three';
import {
  BODY_IDS,
  DEG,
  altAzToWorld,
  apparentStarDirection,
  extinctionMag,
  raDecToVector,
} from '../astro';
import { refractWorld } from './atmosphere';
import type { NamedStar } from '../data/names';
import { figureColor, type SkyCulture } from '../data/skyculture';
import type { FrameContext } from './context';
import type { LabelOverlay } from './LabelOverlay';
import { BODY_NAMES_ZH, bodyMarkerRadiusPx } from './layers/BodyLayer';
import { vehicleSpritePx } from './layers/VehicleLayer';

/** Altitude (as world y = sin alt) below which labels are hidden behind opaque ground. */
export const GROUND_Y = Math.sin(-0.3 * DEG);

/** Pixels per degree at the view centre. */
export function pxPerDegree(ctx: FrameContext): number {
  return ctx.projection.pxPerRad * DEG;
}

const CARDINALS: readonly { az: number; text: string; major: boolean }[] = [
  { az: 0, text: '北', major: true },
  { az: 45, text: '东北', major: false },
  { az: 90, text: '东', major: true },
  { az: 135, text: '东南', major: false },
  { az: 180, text: '南', major: true },
  { az: 225, text: '西南', major: false },
  { az: 270, text: '西', major: true },
  { az: 315, text: '西北', major: false },
];

const cardinalDirs = CARDINALS.map((c) => {
  const [x, y, z] = altAzToWorld(0, c.az);
  return new THREE.Vector3(x, y, z);
});

/** Compass points on the horizon. */
export function addCardinalLabels(overlay: LabelOverlay, ctx: FrameContext): void {
  if (!ctx.settings.showCardinals) return;
  CARDINALS.forEach((c, i) => {
    const world = cardinalDirs[i];
    if (!world) return;
    overlay.add({
      id: `cardinal-${c.az}`,
      text: c.text,
      world,
      kind: c.major ? 'cardinal' : 'cardinal-minor',
      priority: c.major ? 0 : 1,
      anchor: 'center',
      dy: -14,
    });
  });
}

const bodyWorld = BODY_IDS.map(() => new THREE.Vector3());

/** Sun, Moon and planet names. */
export function addBodyLabels(overlay: LabelOverlay, ctx: FrameContext): void {
  if (!ctx.settings.showBodies) return;
  const ppd = pxPerDegree(ctx);
  ctx.bodies.forEach((b, i) => {
    const world = bodyWorld[i];
    if (!world) return;
    world.set(b.eqj[0], b.eqj[1], b.eqj[2]).applyMatrix4(ctx.eqjToWorld);
    refractWorld(world, ctx.atmosphere);
    if (ctx.settings.showGround && world.y < GROUND_Y) return;
    const alwaysShown = b.id === 'Sun' || b.id === 'Moon';
    if (!alwaysShown && b.mag > ctx.limMag) return;
    const r = bodyMarkerRadiusPx(b, ppd);
    overlay.add({
      id: `body-${b.id}`,
      text: ctx.settings.chineseNames ? BODY_NAMES_ZH[b.id] : b.id,
      world,
      kind: b.id === 'Sun' ? 'sun' : b.id === 'Moon' ? 'moon' : 'body',
      priority: 2 + i * 0.01,
      dx: r * 0.75 + 5,
      dy: -r * 0.75 - 4,
    });
  });
}

const starWorld: THREE.Vector3[] = [];

/** Approximate on-screen core radius of a star (CSS px), mirroring common.glsl. */
export function starRadiusPx(mag: number, limMag: number, scale: number): number {
  const f = 10 ** (0.4 * Math.min(Math.max(limMag - mag, 0), 14));
  return scale * Math.min(Math.max(f ** 0.27, 1), 12);
}

/** Proper names of bright stars; more appear as the view zooms in. */
export function addStarLabels(
  overlay: LabelOverlay,
  ctx: FrameContext,
  stars: readonly NamedStar[],
): void {
  if (!ctx.settings.showStarLabels) return;
  const { labelMag, limMag, settings } = ctx;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s || s.mag > labelMag) break; // sorted brightest first
    const text = settings.chineseNames ? (s.nameZh ?? s.name) : s.name;
    if (!text) continue;
    let world = starWorld[i];
    if (!world) {
      world = new THREE.Vector3();
      starWorld[i] = world;
    }
    const d = apparentStarDirection(s.eqj, s.pm, ctx.years, ctx.beta);
    world.set(d[0], d[1], d[2]).applyMatrix4(ctx.eqjToWorld);
    refractWorld(world, ctx.atmosphere);
    if (settings.showGround && world.y < GROUND_Y) continue;
    // stars dimmed by extinction near the horizon lose their labels too
    const ext = extinctionMag(Math.asin(world.y) / DEG, ctx.extinctionK);
    if (ctx.atmosphere && s.mag + ext > labelMag) continue;
    const r = starRadiusPx(s.mag, limMag, settings.starScale);
    overlay.add({
      id: `star-${s.id}`,
      text,
      world,
      kind: 'star',
      priority: 10 + s.mag,
      dx: r + 3,
      dy: -r * 0.5 - 2,
      opacity: s.mag > labelMag - 0.5 ? 0.75 : 1,
    });
  }
}

const raHourDirs = Array.from({ length: 24 }, (_, h) => {
  const [x, y, z] = raDecToVector(h * 15, 0);
  return { h, eqd: new THREE.Vector3(x, y, z), world: new THREE.Vector3() };
});
const altMarks = Array.from({ length: 8 }, (_, i) => ({
  alt: (i + 1) * 10,
  world: new THREE.Vector3(),
}));

/** Hour marks on the celestial equator; altitude marks along the view's azimuth. */
export function addGridLabels(overlay: LabelOverlay, ctx: FrameContext): void {
  const { settings } = ctx;
  if (settings.showEquatorialGrid) {
    for (const m of raHourDirs) {
      m.world.copy(m.eqd).applyMatrix4(ctx.eqdToWorld);
      refractWorld(m.world, ctx.atmosphere);
      if (settings.showGround && m.world.y < GROUND_Y) continue;
      overlay.add({
        id: `ra-${m.h}`,
        text: `${m.h}h`,
        world: m.world,
        kind: 'grid-eq',
        priority: 60,
        dx: 3,
        dy: -8,
      });
    }
  }
  if (settings.showAzimuthalGrid) {
    const az = Math.round(viewAzimuth(ctx) / 15) * 15;
    for (const m of altMarks) {
      const [x, y, z] = altAzToWorld(m.alt, az);
      m.world.set(x, y, z);
      overlay.add({
        id: `alt-${m.alt}`,
        text: `${m.alt}°`,
        world: m.world,
        kind: 'grid-az',
        priority: 61,
        dx: 3,
        dy: -8,
      });
    }
  }
}

const tmpDir = new THREE.Vector3();
function viewAzimuth(ctx: FrameContext): number {
  ctx.camera.getWorldDirection(tmpDir);
  const az = Math.atan2(tmpDir.x, -tmpDir.z) / DEG;
  return az < 0 ? az + 360 : az;
}

const figureWorld = new Map<string, THREE.Vector3>();

/** Constellation / 星官 names at the figures' centroids; small ones only when zoomed in. */
export function addFigureLabels(
  overlay: LabelOverlay,
  ctx: FrameContext,
  culture: SkyCulture | undefined,
): void {
  const { settings } = ctx;
  if (!culture || !settings.showConstellationLabels) return;
  const fov = ctx.projection.fov;
  const maxRank = fov < 40 ? 2 : fov < 110 ? 1 : 0;
  for (const f of culture.figures) {
    if (f.rank > maxRank) continue;
    const key = `${culture.id}/${f.id}`;
    let world = figureWorld.get(key);
    if (!world) {
      world = new THREE.Vector3();
      figureWorld.set(key, world);
    }
    world.set(f.label[0], f.label[1], f.label[2]).applyMatrix4(ctx.eqjToWorld);
    refractWorld(world, ctx.atmosphere);
    if (settings.showGround && world.y < GROUND_Y) continue;
    const hex = figureColor(culture.id, f).toString(16).padStart(6, '0');
    overlay.add({
      id: `fig-${key}`,
      text: settings.chineseNames ? f.zh : f.en,
      world,
      kind: f.mansion ? 'mansion' : 'figure',
      priority: f.mansion ? 5 : 20 + f.rank,
      anchor: 'center',
      color: `#${hex}`,
      opacity: f.mansion ? 0.95 : 0.7,
    });
  }
}

const vehicleWorld = new Map<string, THREE.Vector3>();

/**
 * Replayed vehicles: ship and booster by name and height; the satellites get
 * one label for the whole group (at its middle satellite).
 */
export function addVehicleLabels(overlay: LabelOverlay, ctx: FrameContext): void {
  const r = ctx.replay;
  if (!r) return;
  const sats = r.vehicles.filter((v) => v.kind === 'starlink');
  const lead = sats[Math.floor((sats.length - 1) / 2)];
  for (const v of r.vehicles) {
    if (v.kind === 'starlink' && v !== lead) continue;
    let world = vehicleWorld.get(v.id);
    if (!world) {
      world = new THREE.Vector3();
      vehicleWorld.set(v.id, world);
    }
    world.set(v.world[0], v.world[1], v.world[2]);
    refractWorld(world, ctx.atmosphere);
    if (ctx.settings.showGround && world.y < GROUND_Y) continue;
    const text =
      v.kind === 'starlink'
        ? `星链 V3 ×${sats.length}`
        : `${v.name} · ${Math.round(v.geo.altKm)} km`;
    const rad = (vehicleSpritePx(v) * ctx.settings.starScale) / 2;
    overlay.add({
      id: `vehicle-${v.kind === 'starlink' ? 'starlink' : v.id}`,
      text,
      world,
      kind: 'vehicle',
      priority: v.kind === 'ship' ? 0.5 : 1.5,
      dx: rad + 4,
      dy: -rad - 3,
    });
  }
}

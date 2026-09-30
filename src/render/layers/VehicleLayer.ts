import * as THREE from 'three';
import { trailDirections, type ReplayFrame, type VehicleView } from '../../missions';
import { atmosphereUniforms } from '../atmosphere';
import type { FrameContext, Layer } from '../context';
import { projectionUniforms } from '../projection';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import fragGlsl from '../shaders/vehicles.frag.glsl?raw';
import vertGlsl from '../shaders/vehicles.vert.glsl?raw';
import { ORDER, makeSkyObject } from '../util';
import { lineMaterial } from './GridLayer';

/** Most sprites drawn at once (ship, booster, satellites). */
const MAX_POINTS = 64;
/** Samples along each trail. */
const TRAIL_SAMPLES = 240;
/** How far back / ahead the ship's trail reaches, s. */
const PAST_S = 20 * 60;
const FUTURE_S = 10 * 60;

const COLORS = {
  plume: new THREE.Color(1.0, 0.62, 0.25),
  ship: new THREE.Color(0.93, 0.95, 1.0),
  booster: new THREE.Color(0.75, 0.85, 1.0),
  starlink: new THREE.Color(0.8, 0.9, 1.0),
  shadow: new THREE.Color(0.42, 0.46, 0.58),
};

/** Size of a vehicle's sprite, CSS px. */
export function vehicleSpritePx(v: VehicleView): number {
  if (v.burning) return v.kind === 'booster' ? 15 : 17;
  return v.kind === 'starlink' ? 6 : 10;
}

function vehicleColor(v: VehicleView): THREE.Color {
  if (v.burning) return COLORS.plume;
  if (!v.sunlit) return COLORS.shadow;
  return COLORS[v.kind];
}

class Trail {
  readonly lines: THREE.LineSegments;
  private readonly positions: THREE.BufferAttribute;

  constructor(color: number, opacity: number) {
    this.positions = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.positions);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.lines = makeSkyObject(
      new THREE.LineSegments(g, lineMaterial(color, opacity)),
      ORDER.vehicles,
    );
  }

  /** Polyline through `dirs` (xyz triples); `dashed` keeps every other segment. */
  set(dirs: Float32Array, dashed: boolean): void {
    const out = this.positions.array as Float32Array;
    const n = dirs.length / 3;
    let k = 0;
    for (let i = 0; i + 1 < n; i++) {
      if (dashed && i % 2 === 1) continue;
      for (let j = 0; j < 6; j++) out[k++] = dirs[i * 3 + j] ?? 0;
    }
    this.positions.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, k / 3);
    this.lines.visible = k > 0;
  }

  hide(): void {
    this.lines.visible = false;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

/** Replayed launch vehicles: sprites plus the ship's and booster's paths across the sky. */
export class VehicleLayer implements Layer {
  readonly object = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly shipPast = new Trail(0xffb36b, 0.75);
  private readonly shipFuture = new Trail(0xffd9a8, 0.35);
  private readonly boosterPast = new Trail(0x8fb6ff, 0.7);
  private readonly uniforms = {
    ...projectionUniforms,
    ...atmosphereUniforms,
    uPixelRatio: { value: 1 },
  };

  constructor() {
    this.object.name = 'vehicles';
    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1);
    for (const a of [this.position, this.color, this.size]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.position);
    g.setAttribute('aColor', this.color);
    g.setAttribute('aSize', this.size);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.material = new THREE.ShaderMaterial({
      name: 'VehicleMaterial',
      uniforms: this.uniforms,
      vertexShader: `${projectionGlsl}\n${atmosphereGlsl}\n${vertGlsl}`,
      fragmentShader: fragGlsl,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = makeSkyObject(new THREE.Points(g, this.material), ORDER.vehicles + 1);
    this.object.add(
      this.shipFuture.lines,
      this.shipPast.lines,
      this.boosterPast.lines,
      this.points,
    );
    this.object.visible = false;
  }

  update(ctx: FrameContext): void {
    const r = ctx.replay;
    this.object.visible = r !== null;
    if (!r) return;
    this.uniforms.uPixelRatio.value = ctx.pixelRatio;

    const n = Math.min(r.vehicles.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      const v = r.vehicles[i];
      if (!v) continue;
      this.position.setXYZ(i, v.world[0], v.world[1], v.world[2]);
      const c = vehicleColor(v);
      this.color.setXYZ(i, c.r, c.g, c.b);
      this.size.setX(i, vehicleSpritePx(v) * ctx.settings.starScale);
    }
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);

    this.updateTrails(r);
  }

  private updateTrails(r: ReplayFrame): void {
    const { mission, tPlus: t, observer } = r;
    const [shipFrom, shipTo] = mission.lifetime('ship');
    const past0 = Math.max(Math.max(shipFrom, 0), t - PAST_S);
    const past1 = Math.min(t, shipTo);
    if (past1 > past0) {
      this.shipPast.set(
        trailDirections(mission, 'ship', past0, past1, TRAIL_SAMPLES, observer),
        false,
      );
    } else this.shipPast.hide();
    const fut1 = Math.min(t + FUTURE_S, shipTo);
    const fut0 = Math.max(t, shipFrom);
    if (fut1 > fut0) {
      this.shipFuture.set(
        trailDirections(mission, 'ship', fut0, fut1, TRAIL_SAMPLES, observer),
        true,
      );
    } else this.shipFuture.hide();

    const [bFrom, bTo] = mission.lifetime('booster');
    const b1 = Math.min(t, bTo);
    if (t >= bFrom && b1 > 0) {
      this.boosterPast.set(
        trailDirections(mission, 'booster', 0, b1, TRAIL_SAMPLES, observer),
        false,
      );
    } else this.boosterPast.hide();
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    for (const t of [this.shipPast, this.shipFuture, this.boosterPast]) t.dispose();
  }
}

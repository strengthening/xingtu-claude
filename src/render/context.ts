import type * as THREE from 'three';
import type { BodyState, SkyBrightness, SkyFrames, Vec3 } from '../astro';
import type { ReplayFrame } from '../missions';
import type { Settings } from '../state';
import type { ProjectionState } from './projection';

/** Everything a layer needs to draw one frame. Built once per frame by the App. */
export interface FrameContext {
  frames: SkyFrames;
  /** Julian years since J2000.0 (for proper motion). */
  years: number;
  /** Earth velocity / c (annual aberration), J2000 frame. */
  beta: Vec3;
  bodies: readonly BodyState[];
  /** Launch replay in progress (vehicles in this observer's sky), else null. */
  replay: ReplayFrame | null;
  /** J2000 → world, as a Three.js matrix (shared by stars, bodies, labels). */
  eqjToWorld: THREE.Matrix4;
  /** Equator of date → world (equatorial grid). */
  eqdToWorld: THREE.Matrix4;
  sunWorld: THREE.Vector3;
  sunAltDeg: number;
  /** Twilight / daylight as modelled for the Sun's altitude (before atmosphereStrength). */
  sky: SkyBrightness;
  /** Atmosphere strength 0–1 (settings.atmosphereStrength). */
  atmStrength: number;
  /** Any atmosphere at all (strength > 0): refraction on. */
  atmosphere: boolean;
  /** Extinction coefficient in use (mag per airmass) = EXTINCTION_K × atmStrength. */
  extinctionK: number;
  /* moonPenalty and moonSkyNl below are already scaled by atmStrength. */
  /** FOV- and twilight-limited magnitude (shaders add extinction and moonlight per star). */
  limMag: number;
  /** Magnitudes lost to moonlight at the view centre. */
  moonPenalty: number;
  /** Moon's contribution to the sky brightness at the view centre, nanolamberts. */
  moonSkyNl: number;
  labelMag: number;
  settings: Readonly<Settings>;
  camera: THREE.PerspectiveCamera;
  projection: ProjectionState;
  /** View centre direction in J2000. */
  viewCentreEqj: Vec3;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  pixelRatio: number;
}

export interface Layer {
  readonly object: THREE.Object3D;
  update(ctx: FrameContext): void;
  dispose(): void;
}

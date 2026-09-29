import * as THREE from 'three';
import { DEG, altAzToWorld } from '../../astro';
import type { FrameContext, Layer } from '../context';
import linesFrag from '../shaders/lines.frag.glsl?raw';
import linesVert from '../shaders/lines.vert.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import { atmosphereUniforms } from '../atmosphere';
import { projectionUniforms } from '../projection';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import { ORDER, makeSkyObject, setSkyMatrix } from '../util';

type ToVector = (latDeg: number, lonDeg: number) => readonly [number, number, number];

interface GridSpec {
  lonStep: number;
  latStep: number;
  /** Tessellation step along each line (deg); perspective draws chords, so keep it fine. */
  seg: number;
}

/** Line segments for a lat/lon graticule on the unit sphere. */
export function graticule(spec: GridSpec, toVec: ToVector, skipLat0 = false): Float32Array {
  const out: number[] = [];
  const push = (a: readonly number[], b: readonly number[]) => out.push(...a, ...b);
  for (let lon = 0; lon < 360; lon += spec.lonStep) {
    for (let lat = -90; lat < 90; lat += spec.seg) {
      push(toVec(lat, lon), toVec(Math.min(lat + spec.seg, 90), lon));
    }
  }
  for (let lat = -90 + spec.latStep; lat < 90; lat += spec.latStep) {
    if (skipLat0 && Math.abs(lat) < 1e-9) continue;
    for (let lon = 0; lon < 360; lon += spec.seg) {
      push(toVec(lat, lon), toVec(lat, lon + spec.seg));
    }
  }
  return new Float32Array(out);
}

/** A single small circle of constant latitude. */
export function parallel(lat: number, seg: number, toVec: ToVector): Float32Array {
  const out: number[] = [];
  for (let lon = 0; lon < 360; lon += seg) out.push(...toVec(lat, lon), ...toVec(lat, lon + seg));
  return new Float32Array(out);
}

const equatorialVec: ToVector = (dec, ra) => {
  const c = Math.cos(dec * DEG);
  return [c * Math.cos(ra * DEG), c * Math.sin(ra * DEG), Math.sin(dec * DEG)];
};

const horizontalVec: ToVector = (alt, az) => altAzToWorld(alt, az);

/** Material for sky polylines: projected in the vertex shader like everything else. */
export function lineMaterial(color: number, opacity: number, refract = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SkyLineMaterial',
    uniforms: {
      ...projectionUniforms,
      ...atmosphereUniforms,
      uRefract: { value: refract ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `${projectionGlsl}\n${atmosphereGlsl}\n${linesVert}`,
    fragmentShader: linesFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

function lines(
  positions: Float32Array,
  color: number,
  opacity: number,
  refract = true,
): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return makeSkyObject(
    new THREE.LineSegments(g, lineMaterial(color, opacity, refract)),
    ORDER.grids,
  );
}

/**
 * Equatorial grid (equator of date: 1h × 10°, equator emphasised) and
 * azimuthal grid (15° × 10°). The equatorial group is posed with eqdToWorld;
 * the azimuthal grid is fixed in the world frame.
 */
export class GridLayer implements Layer {
  readonly object = new THREE.Group();
  private readonly equatorial = new THREE.Group();
  private readonly azimuthal = new THREE.Group();

  constructor() {
    this.object.name = 'grids';
    const seg = 1;
    this.equatorial.add(
      lines(graticule({ lonStep: 15, latStep: 10, seg }, equatorialVec, true), 0x4a78c8, 0.32),
      lines(parallel(0, seg, equatorialVec), 0x6d9cf0, 0.7),
    );
    this.azimuthal.add(
      lines(
        graticule({ lonStep: 15, latStep: 10, seg }, horizontalVec, true),
        0xb0603a,
        0.32,
        false,
      ),
    );
    for (const g of [this.equatorial, this.azimuthal]) {
      g.matrixAutoUpdate = false;
      this.object.add(g);
    }
  }

  update(ctx: FrameContext): void {
    this.equatorial.visible = ctx.settings.showEquatorialGrid;
    this.azimuthal.visible = ctx.settings.showAzimuthalGrid;
    if (this.equatorial.visible) setSkyMatrix(this.equatorial, ctx.eqdToWorld);
  }

  dispose(): void {
    this.object.traverse((o) => {
      if (o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

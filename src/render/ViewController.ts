import * as THREE from 'three';
import { DEG, clamp, worldToAltAz } from '../astro';
import { FOV_LIMITS, unprojectNdc, type ProjectionMode } from '../astro/projection';

/** A press that moves less than this (CSS px) and is released quickly is a click. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 600;

export interface ViewState {
  /** Azimuth of the view centre, degrees from north via east. */
  az: number;
  /** Altitude of the view centre, degrees. */
  alt: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

/**
 * Planetarium-style camera control: the camera stays at the centre of the
 * celestial sphere. Dragging "grabs" the sky (the point under the cursor stays
 * under the cursor); the wheel / pinch zooms toward the cursor by changing FOV.
 */
export class ViewController {
  readonly state: ViewState = { az: 180, alt: 35, fov: 70 };
  onChange: (() => void) | undefined;
  /** A tap / click that did not drag (client coordinates). */
  onClick: ((clientX: number, clientY: number) => void) | undefined;
  /** The user panned the view (drag or arrow keys) — e.g. to stop tracking. */
  onUserPan: (() => void) | undefined;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private grab: THREE.Vector3 | undefined;
  private pinchDist = 0;
  /** Press that may become a click: cleared once it moves, times out or goes multi-touch. */
  private press: { id: number; x: number; y: number; t: number } | undefined;
  private readonly tmp = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly el: HTMLElement,
    private readonly projectionMode: () => ProjectionMode = () => 'stereographic',
  ) {
    this.camera.rotation.order = 'YXZ';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    this.apply();
  }

  set(patch: Partial<ViewState>): void {
    Object.assign(this.state, patch);
    this.apply();
  }

  /** Push the view state into the camera. */
  apply(): void {
    const s = this.state;
    s.az = ((s.az % 360) + 360) % 360;
    s.alt = clamp(s.alt, -90, 90);
    const lim = FOV_LIMITS[this.projectionMode()];
    s.fov = clamp(s.fov, lim.min, lim.max);
    this.camera.rotation.set(s.alt * DEG, -s.az * DEG, 0);
    if (this.camera.fov !== s.fov) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.onChange?.();
  }

  /** Turn the view centre to a world direction. */
  lookAt(world: THREE.Vector3): void {
    const { az, alt } = worldToAltAz([world.x, world.y, world.z]);
    this.set({ az, alt });
  }

  /** World direction under a client-space point (for the active projection). */
  directionAt(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -((clientY - r.top) / r.height) * 2 + 1;
    const [vx, vy, vz] = unprojectNdc(x, y, {
      mode: this.projectionMode(),
      fov: this.state.fov,
      aspect: r.width / Math.max(r.height, 1),
    });
    return out.set(vx, vy, vz).applyMatrix3(this.rotation.setFromMatrix4(this.camera.matrixWorld));
  }

  /** Rotate the view so that world direction `target` appears under the client point. */
  private keepUnder(target: THREE.Vector3, clientX: number, clientY: number): void {
    // Two fixed-point iterations are plenty for interactive drags.
    for (let i = 0; i < 2; i++) {
      const now = this.directionAt(clientX, clientY, this.tmp);
      const a = worldToAltAz([target.x, target.y, target.z]);
      const b = worldToAltAz([now.x, now.y, now.z]);
      let dAz = a.az - b.az;
      if (dAz > 180) dAz -= 360;
      if (dAz < -180) dAz += 360;
      this.state.az += dAz;
      this.state.alt += a.alt - b.alt;
      this.apply();
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.grab = this.directionAt(e.clientX, e.clientY);
      this.el.classList.add('dragging');
      // only a plain primary press can become a click (not right / middle buttons)
      this.press =
        e.button === 0 && e.isPrimary
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
          : undefined;
    } else if (this.pointers.size === 2) {
      this.press = undefined;
      this.grab = undefined;
      this.pinchDist = this.pinchDistance();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1 && this.grab) {
      const p = this.press;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) this.press = undefined;
      if (!this.press) this.onUserPan?.();
      this.keepUnder(this.grab, e.clientX, e.clientY);
    } else if (this.pointers.size === 2) {
      const d = this.pinchDistance();
      if (this.pinchDist > 0 && d > 0) {
        const c = this.pinchCentre();
        this.zoomAt(this.pinchDist / d, c.x, c.y);
      }
      this.pinchDist = d;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.press;
    if (
      e.type === 'pointerup' &&
      p?.id === e.pointerId &&
      this.pointers.size === 1 &&
      performance.now() - p.t < CLICK_MAX_MS &&
      Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP_PX
    ) {
      this.onClick?.(e.clientX, e.clientY);
    }
    this.press = undefined;
    this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.pointers.size === 1) {
      const [p] = this.pointers.values();
      if (p) this.grab = this.directionAt(p.x, p.y);
    } else if (this.pointers.size === 0) {
      this.grab = undefined;
      this.el.classList.remove('dragging');
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoomAt(Math.exp(clamp(px, -400, 400) * 0.0015), e.clientX, e.clientY);
  };

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const step = this.state.fov * 0.06;
    switch (e.key) {
      case 'ArrowLeft':
        this.onUserPan?.();
        this.set({ az: this.state.az - step });
        break;
      case 'ArrowRight':
        this.onUserPan?.();
        this.set({ az: this.state.az + step });
        break;
      case 'ArrowUp':
        this.onUserPan?.();
        this.set({ alt: this.state.alt + step });
        break;
      case 'ArrowDown':
        this.onUserPan?.();
        this.set({ alt: this.state.alt - step });
        break;
      case '+':
      case '=':
      case 'PageUp':
        this.set({ fov: this.state.fov / 1.25 });
        break;
      case '-':
      case '_':
      case 'PageDown':
        this.set({ fov: this.state.fov * 1.25 });
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** Multiply the FOV by `factor`, keeping the sky point under the cursor fixed. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const target = this.directionAt(clientX, clientY);
    const before = this.state.fov;
    const lim = FOV_LIMITS[this.projectionMode()];
    this.state.fov = clamp(before * factor, lim.min, lim.max);
    if (this.state.fov === before) return;
    this.apply();
    this.keepUnder(target, clientX, clientY);
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }

  /** Current centre direction in alt/az (for the status bar). */
  get centre(): { az: number; alt: number } {
    return { az: this.state.az, alt: this.state.alt };
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('pointercancel', this.onPointerUp);
    this.el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
  }
}

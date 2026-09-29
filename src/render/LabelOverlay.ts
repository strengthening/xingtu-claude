import type * as THREE from 'three';
import { worldToScreen, type ProjectionState } from './projection';

export type LabelKind =
  | 'star'
  | 'body'
  | 'sun'
  | 'moon'
  | 'cardinal'
  | 'cardinal-minor'
  | 'grid-eq'
  | 'grid-az'
  | 'figure'
  | 'mansion'
  | 'selected';

export interface LabelSpec {
  id: string;
  text: string;
  /** World-space direction (need not be normalised). */
  world: THREE.Vector3;
  kind: LabelKind;
  /** Lower draws first and wins collisions. */
  priority: number;
  /** Pixel offset of the label's anchor from the projected point. */
  dx?: number;
  dy?: number;
  /** 'left' puts the text to the right of the point; 'center' centres it. */
  anchor?: 'left' | 'center';
  opacity?: number;
  /** Optional CSS colour. */
  color?: string;
}

interface Slot {
  el: HTMLDivElement;
  text: string;
  kind: LabelKind;
  w: number;
  h: number;
  used: boolean;
}

const PAD = 2;

/**
 * DOM labels positioned over the WebGL canvas: crisp CJK text for free, with
 * greedy priority-based collision avoidance. Elements are pooled by id.
 */
export class LabelOverlay {
  private readonly slots = new Map<string, Slot>();
  private specs: LabelSpec[] = [];

  constructor(private readonly root: HTMLElement) {}

  begin(): void {
    this.specs = [];
  }

  add(spec: LabelSpec): void {
    this.specs.push(spec);
  }

  end(camera: THREE.Camera, projection: ProjectionState, width: number, height: number): void {
    for (const s of this.slots.values()) s.used = false;
    this.specs.sort((a, b) => a.priority - b.priority);
    const placed: [number, number, number, number][] = [];

    for (const spec of this.specs) {
      const screen = worldToScreen(spec.world, camera, projection, width, height);
      if (!screen) continue;
      const px = screen[0] + (spec.dx ?? 0);
      const py = screen[1] + (spec.dy ?? 0);

      const slot = this.slot(spec);
      const x0 = spec.anchor === 'center' ? px - slot.w / 2 : px;
      const y0 = py - slot.h / 2;
      if (x0 > width || y0 > height || x0 + slot.w < 0 || y0 + slot.h < 0) continue;
      const box: [number, number, number, number] = [
        x0 - PAD,
        y0 - PAD,
        x0 + slot.w + PAD,
        y0 + slot.h + PAD,
      ];
      if (placed.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) {
        continue;
      }
      placed.push(box);
      slot.used = true;
      slot.el.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px)`;
      slot.el.style.opacity = String(spec.opacity ?? 1);
      if (spec.color && slot.el.style.color !== spec.color) slot.el.style.color = spec.color;
      if (slot.el.hidden) slot.el.hidden = false;
    }

    for (const s of this.slots.values()) if (!s.used && !s.el.hidden) s.el.hidden = true;
  }

  private slot(spec: LabelSpec): Slot {
    let s = this.slots.get(spec.id);
    if (!s) {
      const el = document.createElement('div');
      el.className = `label label-${spec.kind}`;
      this.root.append(el);
      s = { el, text: '', kind: spec.kind, w: 0, h: 0, used: false };
      this.slots.set(spec.id, s);
    }
    if (s.text !== spec.text || s.kind !== spec.kind) {
      s.text = spec.text;
      s.kind = spec.kind;
      s.el.className = `label label-${spec.kind}`;
      s.el.textContent = spec.text;
      s.el.hidden = false;
      s.w = s.el.offsetWidth;
      s.h = s.el.offsetHeight;
    }
    return s;
  }

  clear(): void {
    for (const s of this.slots.values()) s.el.remove();
    this.slots.clear();
  }
}

import * as THREE from 'three';
import type { FrameContext, Layer } from './context';

/** Owns the WebGL renderer, scene and camera; layers plug in via `add`. */
export class SkyRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly layers: Layer[] = [];
  private readonly resizeObserver: ResizeObserver;
  width = 1;
  height = 1;
  pixelRatio = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: true, // HiPS levels composite through the stencil buffer
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.sortObjects = true; // honour renderOrder
    // Unit celestial sphere around the camera: keep near/far tight for precision.
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  add(layer: Layer): void {
    this.layers.push(layer);
    this.scene.add(layer.object);
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.width && h === this.height && this.renderer.getPixelRatio() === this.pixelRatio)
      return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(ctx: FrameContext): void {
    for (const layer of this.layers) layer.update(ctx);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const layer of this.layers) layer.dispose();
    this.renderer.dispose();
  }
}

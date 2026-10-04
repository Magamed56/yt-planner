/**
 * Owns the WebGL renderer, scene, main camera and key lights. Supports a fixed
 * output resolution (video recording) or responsive sizing (play).
 */
import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

export interface RenderContextOptions {
  parent: HTMLElement;
  /** fixed output size (recording); otherwise follows the parent element */
  fixedSize?: { width: number; height: number };
  quality?: Quality;
  preserveDrawingBuffer?: boolean;
}

export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  quality: Quality;
  private fixed: { width: number; height: number } | null;
  private readonly onResize = () => this.resize();
  /** distance of the sun from its target */
  private readonly sunOffset = new THREE.Vector3(-14, 26, 10);
  shadowRange = 26;

  constructor(private readonly opts: RenderContextOptions) {
    this.quality = opts.quality ?? 'high';
    this.fixed = opts.fixedSize ?? null;
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== 'low',
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.fixed ? 1 : Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25));
    opts.parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
    this.hemi = new THREE.HemisphereLight('#dbe8ff', '#5a4a3a', 1.1);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.15);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff3df', 2.2);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    const size = this.quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 90;
    this.setShadowRange(this.shadowRange);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  setShadowRange(r: number): void {
    this.shadowRange = r;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }

  /** Keeps the shadow frustum centred on the action (texel-snapped to avoid shimmering). */
  focusShadows(x: number, y: number, z: number): void {
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx + this.sunOffset.x, y + this.sunOffset.y, sz + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  setSunDirection(dx: number, dy: number, dz: number): void {
    const l = Math.hypot(dx, dy, dz) || 1;
    this.sunOffset.set((dx / l) * 32, (dy / l) * 32, (dz / l) * 32);
  }

  setFixedSize(size: { width: number; height: number } | null): void {
    this.fixed = size;
    this.renderer.setPixelRatio(size ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
  }

  get size(): { width: number; height: number } {
    if (this.fixed) return this.fixed;
    const el = this.opts.parent;
    return { width: Math.max(1, el.clientWidth || window.innerWidth), height: Math.max(1, el.clientHeight || window.innerHeight) };
  }

  get aspect(): number {
    const s = this.size;
    return s.width / s.height;
  }

  resize(): void {
    const { width, height } = this.size;
    this.renderer.setSize(width, height, !this.fixed);
    if (this.fixed) {
      // fit the fixed-size canvas inside the window for preview purposes
      const el = this.renderer.domElement;
      const pw = this.opts.parent.clientWidth || window.innerWidth;
      const ph = this.opts.parent.clientHeight || window.innerHeight;
      const k = Math.min(pw / width, ph / height);
      el.style.width = `${Math.floor(width * k)}px`;
      el.style.height = `${Math.floor(height * k)}px`;
      el.style.margin = '0 auto';
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

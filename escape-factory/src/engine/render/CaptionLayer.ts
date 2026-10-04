/**
 * Big comic captions rendered INSIDE the WebGL frame (camera-attached plane
 * with a canvas texture) so they appear in recordings. Used for hooks
 * ("CAN I ESCAPE?!"), labels and outros in video mode.
 */
import * as THREE from 'three';

export class CaptionLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private text = '';
  private style = 'label';
  private shownAt = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly portrait: boolean,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.3125), this.mat);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  private draw(text: string, style: string): void {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const lines = wrap(text.toUpperCase(), 18);
    const color = style === 'hook' ? '#ffd23f' : style === 'outro' ? '#5cff9d' : style === 'title' ? '#ffffff' : '#ffd23f';
    let size = lines.length > 1 ? 120 : 150;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const font = (s: number) => `900 ${s}px "Lilita One", "Luckiest Guy", "Arial Black", Impact, sans-serif`;
    g.font = font(size);
    while (lines.some((l) => g.measureText(l).width > W * 0.94) && size > 40) {
      size -= 6;
      g.font = font(size);
    }
    lines.forEach((l, i) => {
      const y = H / 2 + (i - (lines.length - 1) / 2) * size * 0.98;
      g.lineJoin = 'round';
      g.lineWidth = size * 0.22;
      g.strokeStyle = '#000000';
      g.strokeText(l, W / 2, y + size * 0.06);
      g.fillStyle = color;
      g.fillText(l, W / 2, y);
    });
    this.tex.needsUpdate = true;
  }

  /** Shows `text` (or hides when null). `t` = video time for the pop animation. */
  set(text: string | null, style = 'label', t = 0): void {
    if (!text) {
      this.mesh.visible = false;
      this.text = '';
      return;
    }
    if (text !== this.text || style !== this.style) {
      this.text = text;
      this.style = style;
      this.shownAt = t;
      this.draw(text, style);
    }
    this.mesh.visible = true;
  }

  update(t: number): void {
    if (!this.mesh.visible) return;
    const dist = 0.5;
    const vh = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    const vw = vh * this.camera.aspect;
    const w = Math.min(vw * 0.95, vh * 1.2);
    const k = Math.min(1, (t - this.shownAt) / 0.18);
    const pop = k < 1 ? 0.6 + 0.5 * Math.sin(k * Math.PI * 0.75) : 1;
    this.mesh.scale.set(w * pop, w * pop, 1);
    this.mesh.position.set(0, this.portrait ? vh * 0.3 : vh * 0.3, -dist);
    this.mesh.rotation.z = -0.04;
  }

  dispose(): void {
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

import * as THREE from 'three';
import { rand, mesh, std } from './util.js';

// Sand bed spans x∈[-W/2,W/2], z∈[-D/2,D/2]. Raking is painted into a height canvas that
// drives the sand's bump map; canvas row 0 maps to z = -D/2.
export const SAND = { W: 40, D: 24, Y: 0.12 };
export const ISLANDS = [
  { x: -8, z: -1, r: 2.6, rings: 4, main: 2.2 },
  { x: 9, z: 2, r: 2.2, rings: 4, main: 1.8 },
  { x: 1, z: 6.5, r: 1.4, rings: 3, main: 1.1 },
  { x: 0, z: -6.5, r: 1.1, rings: 3, main: 0.9 },
];
const PPU = 50;             // canvas pixels per world unit
const HALF = 0.5;           // rake half-width (world)
const PERIOD = 0.25;        // groove period (world); 2*HALF must be a multiple so bands tile
const LAG = 0.14;           // ripple groove trails the erase front by this much (world)

export function createSand(ctx) {
  const cw = SAND.W * PPU, ch = SAND.D * PPU;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext('2d');
  const toPx = (x, z) => [(x + SAND.W / 2) * PPU, (z + SAND.D / 2) * PPU];

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  const geo = new THREE.PlaneGeometry(SAND.W, SAND.D, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe9e4d6, roughness: 0.97, bumpMap: tex, bumpScale: 3,
  });
  const sand = mesh(geo, mat, 0, SAND.Y, 0);
  sand.castShadow = false;
  sand.userData.noSnow = true;
  ctx.scene.add(sand);

  // Grain speckle overlay so the sand doesn't look like plastic.
  const speck = document.createElement('canvas');
  speck.width = speck.height = 512;
  const sg = speck.getContext('2d');
  sg.fillStyle = '#ece7da'; sg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 200 + Math.random() * 55 | 0;
    sg.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    sg.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  const speckTex = new THREE.CanvasTexture(speck);
  speckTex.wrapS = speckTex.wrapT = THREE.RepeatWrapping;
  speckTex.repeat.set(10, 6);
  speckTex.colorSpace = THREE.SRGBColorSpace;
  mat.map = speckTex;
  mat.color.set(0xffffff);

  // Paint a band of parallel grooves along a path: widest stroke first, cosine height profile.
  function bands(pathFn, half = HALF, cap = 'butt') {
    g.lineCap = cap; g.lineJoin = 'round';
    const steps = 22;
    for (let i = steps; i >= 1; i--) {
      const r = (half * i) / steps;
      const h = 0.5 + 0.5 * Math.cos((2 * Math.PI * r) / PERIOD);
      const edge = Math.min(1, (half - r) / 0.05 + 0.25);
      const v = Math.round(128 + (h - 0.5) * 150 * edge);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = r * 2 * PPU;
      g.beginPath(); pathFn(); g.stroke();
    }
  }

  function paintBase() {
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(0, 0, cw, ch);
    for (let z = -SAND.D / 2 + HALF; z < SAND.D / 2; z += HALF * 2) {
      bands(() => { g.moveTo(...toPx(-SAND.W / 2 - 1, z)); g.lineTo(...toPx(SAND.W / 2 + 1, z)); });
    }
    for (const isl of ISLANDS) {
      for (let k = isl.rings; k >= 1; k--) {
        const rr = isl.r + (k - 0.5) * HALF * 2;
        bands(() => { const [px, pz] = toPx(isl.x, isl.z); g.arc(px, pz, rr * PPU, 0, Math.PI * 2); });
      }
      // smooth flat collar right under the mound
      g.fillStyle = 'rgb(140,140,140)';
      const [px, pz] = toPx(isl.x, isl.z);
      g.beginPath(); g.arc(px, pz, isl.r * PPU, 0, Math.PI * 2); g.fill();
    }
    tex.needsUpdate = true;
  }
  paintBase();

  // Live rake stroke: redraw only the trailing window of points each move.
  class Stroke {
    constructor() { this.pts = []; }
    add(x, z) {
      const last = this.pts[this.pts.length - 1];
      if (last && Math.hypot(last[0] - x, last[1] - z) < 0.12) return false;
      this.pts.push([x, z]);
      if (this.pts.length > 40) this.pts.shift();
      if (this.pts.length < 2) return true;
      bands(() => {
        g.moveTo(...toPx(...this.pts[0]));
        for (let i = 1; i < this.pts.length; i++) g.lineTo(...toPx(...this.pts[i]));
      });
      tex.needsUpdate = true;
      return true;
    }
  }

  // Ripples from a dropped pebble: erase front + concentric grooves growing outward.
  const ripples = [];
  const ringGeo = new THREE.RingGeometry(0.96, 1, 64);
  ringGeo.rotateX(-Math.PI / 2);
  function ripple(x, z, max = rand(2.2, 3.2)) {
    ripples.push({ x, z, r: 0, max, prevG: 0, rings: [] });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false,
      }));
      m.position.set(x, SAND.Y + 0.06, z);
      m.userData.delay = i * 0.25;
      ctx.scene.add(m);
      ripples[ripples.length - 1].rings.push(m);
    }
    // a small pebble that stays where it landed
    const peb = mesh(new THREE.SphereGeometry(0.12, 8, 6), std(0x55524c), x, SAND.Y + 0.05, z);
    peb.scale.y = 0.6;
    ctx.scene.add(peb);
  }

  function drawRippleAnnulus(rp, r0, r1) {
    const [px, pz] = toPx(rp.x, rp.z);
    const step = 0.02;
    for (let r = r0; r < r1; r += step) {
      const h = 0.5 + 0.5 * Math.cos((2 * Math.PI * r) / PERIOD);
      const fade = Math.min(1, (rp.max - r) / 0.4);
      const v = Math.round(128 + (h - 0.5) * 150 * Math.max(0, fade));
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = step * PPU + 1;
      g.beginPath(); g.arc(px, pz, r * PPU, 0, Math.PI * 2); g.stroke();
    }
  }

  ctx.updaters.push((dt) => {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r = Math.min(rp.max + LAG, rp.r + dt * 1.4);
      const gr = Math.max(0, rp.r - LAG);
      if (gr > rp.prevG) { drawRippleAnnulus(rp, rp.prevG, gr); rp.prevG = gr; tex.needsUpdate = true; }
      for (const m of rp.rings) {
        const t = Math.max(0, rp.r - m.userData.delay);
        m.scale.setScalar(Math.max(0.01, t * 1.3));
        m.material.opacity = Math.max(0, 0.6 * (1 - t / rp.max));
      }
      if (rp.r >= rp.max + LAG && rp.rings.every((m) => m.material.opacity <= 0.01)) {
        rp.rings.forEach((m) => { ctx.scene.remove(m); m.material.dispose(); });
        ripples.splice(i, 1);
      }
    }
  });

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SAND.Y);
  const hit = new THREE.Vector3();
  function pick(raycaster) {
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    if (Math.abs(hit.x) > SAND.W / 2 || Math.abs(hit.z) > SAND.D / 2) return null;
    return hit.clone();
  }
  const onIsland = (p) => ISLANDS.some((i) => Math.hypot(p.x - i.x, p.z - i.z) < i.r);

  ctx.sand = { mesh: sand, Stroke, ripple, pick, onIsland, reset: paintBase };
}

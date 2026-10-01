import * as THREE from 'three';
import { rand } from './util.js';
import { SAND } from './sand.js';

const BOX = { x: 70, z: 56, h: 32, cz: -2 };

function softDot() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

export function createWeather(ctx) {
  // ——— rain: short line streaks recycled inside a box over the garden ———
  const RN = 2600, STREAK = 0.7;
  const rpos = new Float32Array(RN * 6);
  const drops = Array.from({ length: RN }, () => ({ x: rand(-BOX.x / 2, BOX.x / 2), y: rand(0, BOX.h), z: BOX.cz + rand(-BOX.z / 2, BOX.z / 2), v: rand(22, 30) }));
  const rgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  const rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0xc8d4dc, transparent: true, opacity: 0, depthWrite: false }));
  rain.frustumCulled = false;
  ctx.scene.add(rain);

  // ——— splash rings on the sand ———
  const ringGeo = new THREE.RingGeometry(0.7, 1, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const splashes = Array.from({ length: 60 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    ctx.scene.add(m);
    return { m, t: 1 };
  });
  let splashNext = 0, splashAcc = 0;

  // ——— snowfall ———
  const SN = 3000;
  const spos = new Float32Array(SN * 3);
  const flakes = Array.from({ length: SN }, () => ({ x: rand(-BOX.x / 2, BOX.x / 2), y: rand(0, BOX.h), z: BOX.cz + rand(-BOX.z / 2, BOX.z / 2), v: rand(0.8, 1.6), ph: rand(0, 6) }));
  const sgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const snow = new THREE.Points(sgeo, new THREE.PointsMaterial({ size: 0.22, map: softDot(), transparent: true, opacity: 0, depthWrite: false }));
  snow.frustumCulled = false;
  ctx.scene.add(snow);

  // ——— lightning ———
  ctx.flash = 0;
  let boltIn = rand(6, 12), secondFlash = -1;

  let audioT = 0;
  ctx.updaters.push((dt, t) => {
    const R = ctx.env.rain, S = ctx.env.snowfall, wind = ctx.uWind.value;

    rain.visible = R > 0.01;
    if (rain.visible) {
      const sx = 0.12 * wind * STREAK;
      for (let i = 0; i < RN; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        d.x += wind * 3 * dt;
        if (d.y < 0) { d.y += BOX.h; d.x = rand(-BOX.x / 2, BOX.x / 2); }
        if (d.x > BOX.x / 2) d.x -= BOX.x;
        const k = i * 6;
        rpos[k] = d.x; rpos[k + 1] = d.y; rpos[k + 2] = d.z;
        rpos[k + 3] = d.x - sx; rpos[k + 4] = d.y + STREAK; rpos[k + 5] = d.z;
      }
      rgeo.attributes.position.needsUpdate = true;
      rain.material.opacity = 0.45 * R;

      splashAcc += dt * 40 * R;
      while (splashAcc > 1) {
        splashAcc -= 1;
        const s = splashes[splashNext]; splashNext = (splashNext + 1) % splashes.length;
        s.t = 0;
        s.m.position.set(rand(-SAND.W / 2, SAND.W / 2), SAND.Y + 0.03, rand(-SAND.D / 2, SAND.D / 2));
        s.m.visible = true;
      }
    }
    for (const s of splashes) {
      if (!s.m.visible) continue;
      s.t += dt * 2.5;
      s.m.scale.setScalar(0.05 + s.t * 0.3);
      s.m.material.opacity = Math.max(0, 0.5 * (1 - s.t));
      if (s.t >= 1) s.m.visible = false;
    }

    snow.visible = S > 0.01;
    if (snow.visible) {
      for (let i = 0; i < SN; i++) {
        const f = flakes[i];
        f.y -= f.v * dt;
        f.x += (Math.sin(t * 0.8 + f.ph) * 0.5 + wind * 0.4) * dt;
        f.z += Math.cos(t * 0.6 + f.ph) * 0.3 * dt;
        if (f.y < 0) { f.y += BOX.h; f.x = rand(-BOX.x / 2, BOX.x / 2); }
        if (f.x > BOX.x / 2) f.x -= BOX.x;
        spos.set([f.x, f.y, f.z], i * 3);
      }
      sgeo.attributes.position.needsUpdate = true;
      snow.material.opacity = 0.9 * S;
    }

    // thunderstorms only when the rain is heavy
    ctx.flash = Math.max(0, ctx.flash - dt * 4);
    if (R > 0.7) {
      boltIn -= dt;
      if (boltIn <= 0) {
        ctx.flash = 1; secondFlash = 0.15; boltIn = rand(8, 18);
        ctx.sfx.thunder(rand(0.6, 1.8));
      }
    }
    if (secondFlash > 0) { secondFlash -= dt; if (secondFlash <= 0) ctx.flash = 0.8; }

    audioT -= dt;
    if (audioT <= 0) { audioT = 0.25; ctx.sfx.setRain(R); }
  });
}

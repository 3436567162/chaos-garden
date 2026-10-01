import * as THREE from 'three';
import { rand, lerp, mesh } from './util.js';
import { groundHeight } from './garden.js';

const C = (h) => new THREE.Color(h);
const PAL = {
  top: [C(0x7fb0dc), C(0x070b1e)],
  hor: [C(0xe9e0cf), C(0x1a1d33)],
  hemiSky: [C(0xdfe8f0), C(0x3a4870)],
  hemiGround: [C(0x5a6a3a), C(0x101418)],
  sun: [C(0xfff0d8), C(0xa8bce8)],
  snowGround: C(0xc8d0d8),
  bolt: C(0xdfe6ff),
};

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export function createScenery(ctx) {
  const { scene, renderer } = ctx;
  scene.fog = new THREE.Fog(PAL.hor[0].clone(), 80, 320);

  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a6a3a, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
  sun.castShadow = true;
  const big = renderer.capabilities.maxTextureSize >= 8192;
  sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 220 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Gradient sky with sun / moon disc; colours share the fog palette so the horizon blends.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uNight: { value: 0 }, uSunDir: { value: new THREE.Vector3() },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform float uNight; uniform vec3 uSunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uHor, uTop, pow(clamp(d.y, 0.0, 1.0), 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        vec3 sunC = vec3(1.0, 0.9, 0.7) * (smoothstep(0.9985, 0.999, s) * 6.0 + pow(s, 10.0) * 0.35);
        vec3 moonC = vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9995, s) * 2.5 + pow(s, 60.0) * 0.25);
        col += mix(sunC, moonC, uNight);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat));

  // Stars
  const sp = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(0.04, 1), rand(-1, 1)).normalize().multiplyScalar(560);
    sp.set([v.x, v.y, v.z], i * 3);
  }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  // Fireflies
  const FN = 90, glow = glowTexture();
  const fpos = new Float32Array(FN * 3), fcol = new Float32Array(FN * 3);
  const flies = Array.from({ length: FN }, () => ({ x: rand(-26, 26), y: rand(0.4, 3), z: rand(-18, 13), ph: rand(0, 20), sp: rand(0.3, 0.8) }));
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  const fireflies = new THREE.Points(fgeo, new THREE.PointsMaterial({
    size: 0.35, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // Distant mountains (shakkei — borrowed scenery)
  const mMat = new THREE.MeshStandardMaterial({ color: 0x6f7f7a, flatShading: true, roughness: 1 });
  for (let i = 0; i < 30; i++) {
    const a = rand(-Math.PI * 1.05, Math.PI * 0.05), d = rand(125, 220), h = rand(22, 75);
    const geo = new THREE.ConeGeometry(rand(28, 55), h, 8, 4);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) < h / 2 - 0.01) p.setXYZ(k, p.getX(k) * rand(0.85, 1.15), p.getY(k) + rand(-2, 2), p.getZ(k) * rand(0.85, 1.15));
    }
    geo.computeVertexNormals();
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const m = mesh(geo, mMat, x, h / 2 + groundHeight(x, z) - 8, z);
    m.castShadow = false;
    scene.add(m);
  }

  // Drifting clouds
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.9, flatShading: true });
  const clouds = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(5, 9), 1), cloudMat);
      b.position.set(k * 6 - 12 + rand(-2, 2), rand(-1, 2), rand(-3, 3));
      b.scale.y = 0.45;
      g.add(b);
    }
    g.position.set(rand(-200, 200), rand(55, 80), rand(-200, -60));
    scene.add(g);
    clouds.push(g);
  }

  const dir = new THREE.Vector3();
  const dayDir = new THREE.Vector3(-30, 30, -16).normalize();
  const nightDir = new THREE.Vector3(18, 60, -24).normalize();
  ctx.updaters.push((dt, t) => {
    const n = ctx.night, e = ctx.env, fl = ctx.flash || 0;
    const overcast = Math.max(e.rain, e.snowfall * 0.6);
    hemi.intensity = lerp(1.0, 0.45, n) * (1 + overcast * 0.35) + fl * 3;
    hemi.color.lerpColors(...PAL.hemiSky, n);
    hemi.groundColor.lerpColors(...PAL.hemiGround, n).lerp(PAL.snowGround, e.snow * (1 - n));
    sun.intensity = lerp(2.8 * e.sunMul, 0.6 * (1 - overcast * 0.6), n);
    sun.shadow.intensity = 1 - overcast * 0.5;
    // strong bumps alias under moonlight; snow fills in the grooves
    if (ctx.sand) ctx.sand.mesh.material.bumpScale = lerp(3, 1.2, n) * (1 - e.snow * 0.75);
    sun.color.lerpColors(e.sun, PAL.sun[1], n);
    dir.lerpVectors(dayDir, nightDir, n).normalize();
    sun.position.copy(dir).multiplyScalar(100);
    skyMat.uniforms.uSunDir.value.copy(dir);
    skyMat.uniforms.uNight.value = Math.max(n, overcast * 0.85); // hide the sun disc behind cloud
    skyMat.uniforms.uTop.value.lerpColors(e.top, PAL.top[1], n);
    skyMat.uniforms.uHor.value.lerpColors(e.hor, PAL.hor[1], n);
    if (fl > 0) { skyMat.uniforms.uTop.value.lerp(PAL.bolt, fl * 0.6); skyMat.uniforms.uHor.value.lerp(PAL.bolt, fl * 0.6); }
    scene.fog.color.copy(skyMat.uniforms.uHor.value);
    scene.fog.near = e.fogNear; scene.fog.far = e.fogFar;
    renderer.toneMappingExposure = lerp(1.05, 1.25, n) + fl * 0.6;
    stars.material.opacity = n * (1 - overcast);
    stars.rotation.y = t * 0.004;
    cloudMat.opacity = lerp(e.cloud, 0.25, n);
    cloudMat.color.copy(e.cloudColor);
    for (const c of clouds) { c.position.x += dt * (1.2 + overcast * 3); if (c.position.x > 230) c.position.x = -230; }
    const flyOn = n * (1 - e.snow) * (1 - e.rain * 0.7);
    for (let i = 0; i < FN; i++) {
      const f = flies[i], k = t * f.sp + f.ph;
      fpos[i * 3] = f.x + Math.sin(k * 0.7) * 1.5;
      fpos[i * 3 + 1] = f.y + Math.sin(k * 1.3) * 0.4;
      fpos[i * 3 + 2] = f.z + Math.cos(k * 0.5) * 1.5;
      const b = flyOn * Math.max(0, Math.sin(k * 2.2)) ** 3;
      fcol[i * 3] = 0.8 * b; fcol[i * 3 + 1] = 1.0 * b; fcol[i * 3 + 2] = 0.35 * b;
    }
    fgeo.attributes.position.needsUpdate = true;
    fgeo.attributes.color.needsUpdate = true;
  });
}

import * as THREE from 'three';

const SAKURA = [0xf9c9d6, 0xf4b3c6, 0xfde2ea, 0xf09ab4];
const MOMIJI = [0xc8341f, 0xe0562a, 0xb3201c, 0xf08a2a];
const SNOWY = [0xf4f6f9, 0xe4e9ef, 0xd5dce4];

// Each preset drives tree foliage, falling leaves, weather and sky. Colours in `env` are lerped.
export const SEASONS = {
  spring: {
    id: 'spring', key: '1', label: '春 · 樱吹雪', sub: 'SPRING · 花见',
    trees: {
      cherry: { colors: SAKURA, full: 1, fall: 1.5, say: '花吹雪 · 物哀' },
      maple: { colors: [0x9bc45a, 0x86b44e, 0xb7d46c], full: 0.9, fall: 0, say: '青枫 · 新绿' },
    },
    env: { top: 0x7fb0dc, hor: 0xe9e0cf, sun: 0xfff0d8, sunMul: 1, snow: 0, rain: 0, snowfall: 0, fogNear: 80, fogFar: 320, cloud: 0.9, cloudColor: 0xffffff },
  },
  summer: {
    id: 'summer', key: '2', label: '夏 · 梅雨', sub: 'SUMMER · 梅雨',
    trees: {
      cherry: { colors: [0x4f7f3a, 0x5c8d40, 0x3f6e32], full: 1, fall: 0, say: '叶樱 · 听雨' },
      maple: { colors: [0x4a7a30, 0x5a8a38, 0x3d6a2a], full: 1, fall: 0, say: '青枫 · 雨滴' },
    },
    env: { top: 0x8693a0, hor: 0xbcc3c6, sun: 0xe8eef2, sunMul: 0.35, snow: 0, rain: 1, snowfall: 0, fogNear: 30, fogFar: 170, cloud: 1, cloudColor: 0x8f989f },
  },
  autumn: {
    id: 'autumn', key: '3', label: '秋 · 红叶狩', sub: 'AUTUMN · 红叶',
    trees: {
      cherry: { colors: [0xd9a03a, 0xe3b64a, 0xc77a2a, 0xb85a24], full: 0.85, fall: 0.6, say: '黄叶 · 秋深' },
      maple: { colors: MOMIJI, full: 1, fall: 2.2, say: '秋 · 红叶狩' },
    },
    env: { top: 0x6a9bd0, hor: 0xf2d4a8, sun: 0xffd29a, sunMul: 1.05, snow: 0, rain: 0, snowfall: 0, fogNear: 70, fogFar: 300, cloud: 0.8, cloudColor: 0xfff4e6 },
  },
  winter: {
    id: 'winter', key: '4', label: '冬 · 雪见', sub: 'WINTER · 雪见',
    trees: {
      cherry: { colors: SNOWY, full: 0.45, fall: 0, say: '枝头落雪' },
      maple: { colors: SNOWY, full: 0.4, fall: 0, say: '雪压枝' },
    },
    env: { top: 0xa3b1bf, hor: 0xe2e7ec, sun: 0xeef3ff, sunMul: 0.7, snow: 1, rain: 0, snowfall: 1, fogNear: 35, fogFar: 220, cloud: 1, cloudColor: 0xe8ecf0 },
  },
};

const COLOR_KEYS = new Set(['top', 'hor', 'sun', 'cloudColor']);
export function makeEnv(preset) {
  const e = {};
  for (const [k, v] of Object.entries(preset.env)) e[k] = COLOR_KEYS.has(k) ? new THREE.Color(v) : v;
  return e;
}

// Whiten upward-facing surfaces by uSnow. Wraps any existing onBeforeCompile (e.g. wind sway) and
// extends the program cache key so patched and unpatched variants never share a program.
function patchSnow(ctx, mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uSnow = ctx.uSnow;
    sh.fragmentShader = 'uniform float uSnow;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float snowUp = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.25, 0.65, snowUp));`);
  };
  mat.customProgramCacheKey = () => prevKey + '|snow';
}

export function createSeasons(ctx) {
  ctx.uSnow = { value: 0 };
  const done = new WeakSet();
  (function walk(o) {
    if (o.userData.noSnow) return;
    const mats = o.material ? [].concat(o.material) : [];
    for (const m of mats) {
      if (m.isMeshStandardMaterial && !m.userData.noSnow && !done.has(m)) { done.add(m); patchSnow(ctx, m); }
    }
    o.children.forEach(walk);
  })(ctx.scene);

  const targets = Object.fromEntries(Object.values(SEASONS).map((s) => [s.id, makeEnv(s)]));
  ctx.updaters.push((dt) => {
    const tgt = targets[ctx.season.id], k = 1 - Math.exp(-dt * 0.9);
    for (const key in tgt) {
      if (COLOR_KEYS.has(key)) ctx.env[key].lerp(tgt[key], k);
      else ctx.env[key] += (tgt[key] - ctx.env[key]) * k;
    }
    ctx.uSnow.value = ctx.env.snow;
  });

  return function setSeason(id, quiet = false) {
    const s = SEASONS[id];
    if (!s || s === ctx.season) return;
    ctx.season = s;
    history.replaceState(null, '', '#' + id);
    if (!quiet) { ctx.sfx.chime(); ctx.toast(s.label); }
  };
}

/*!
 * assembly3d.js — animated 3D assembly player (visual aid for setup guides)
 * Requires vendor/three.bundle.js (window.THREE). No other dependencies.
 *
 * QUICK START
 *   const player = Assembly3D.mount(containerEl, {
 *     model: "placeholder-quad",            // builder name, registered model name, or URL to a .glb
 *     steps: [
 *       { label: "Drop the motors onto the arms", parts: "motor*", from: "up", stagger: 0.3 }
 *     ]
 *   });
 *
 * The full config reference is in ASSEMBLY_ANIMATION_GUIDE.md.
 * Core idea: the model is loaded in its ASSEMBLED pose. Each step says where a part comes FROM
 * (insert), goes TO (remove/move), or how it spins. The engine animates it smoothly into place.
 */
(function () {
'use strict';
const T = window.THREE;
if (!T) { console.error('[assembly3d] window.THREE not found. Load vendor/three.bundle.js first.'); return; }

const VERSION = '1.0.0';
const MODELS = window.ASSEMBLY_MODELS = window.ASSEMBLY_MODELS || {};     // name -> URL or data: URI (see tools/glb-to-js.mjs)
const BUILDERS = window.ASSEMBLY_BUILDERS = window.ASSEMBLY_BUILDERS || {}; // name -> function(THREE) returning an Object3D
const ACTIONS = ['insert', 'remove', 'move', 'spin', 'highlight', 'show', 'hide', 'fade', 'camera', 'wait'];
const EASE = {
  linear: k => k,
  in: k => k * k * k,
  out: k => 1 - Math.pow(1 - k, 3),
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  snap: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const D2R = Math.PI / 180;
const ACCENT = 0xffb020;
const live = new Set();

/* ------------------------------------------------------------------ realistic material presets
   Procedural (no texture files), shared textures, private material per mesh so parts can still fade/glow.
   Use from a builder:  mesh.userData.preset = "carbon"  or  { preset: "anodized", color: 0xd8342c }
   Use from a config:   materials: { "Arm*": "carbon", "Motor*": { preset: "anodized", color: "#222" } }
   Presets that take a colour keep the part's own CAD colour unless one is given. */
const TEX = {};
function canvasTex(key, size, draw, srgb) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  return (TEX[key] = t);
}
const weaveTex = () => canvasTex('weave', 256, (g, n) => {          // 2x2 twill carbon weave
  const k = 8, w = n / k;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const horiz = ((i + j) >> 1) % 2 === 0, x = i * w, y = j * w;
    const grd = horiz ? g.createLinearGradient(x, y, x, y + w) : g.createLinearGradient(x, y, x + w, y);
    grd.addColorStop(0, '#0e0f11'); grd.addColorStop(0.5, horiz ? '#3a3d42' : '#2a2c30'); grd.addColorStop(1, '#0e0f11');
    g.fillStyle = grd; g.fillRect(x, y, w, w);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    for (let f = 1; f < 4; f++) { g.beginPath(); if (horiz) { g.moveTo(x, y + f * w / 4); g.lineTo(x + w, y + f * w / 4); } else { g.moveTo(x + f * w / 4, y); g.lineTo(x + f * w / 4, y + w); } g.stroke(); }
  }
}, true);
const brushedTex = () => canvasTex('brushed', 256, (g, n) => {      // roughness map: fine directional streaks
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 900; i++) { const v = 110 + Math.random() * 60 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, Math.random() * n, n, 0.6 + Math.random()); }
});
const pcbTex = () => canvasTex('pcb', 256, (g, n) => {              // subtle traces + pads, multiplied by the board colour
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(255,255,255,.0)';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(${200 + Math.random() * 40 | 0},${210 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},1)`;
    g.lineWidth = 1 + Math.random() * 2; g.beginPath(); let x = Math.random() * n, y = Math.random() * n; g.moveTo(x, y);
    for (let s = 0; s < 3; s++) { if (Math.random() < 0.5) x += (Math.random() - .5) * 120; else y += (Math.random() - .5) * 120; g.lineTo(x, y); } g.stroke();
  }
  g.fillStyle = '#d9b44a'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * n, Math.random() * n, 3, 3);
}, true);
const PRESETS = {
  carbon:        () => new T.MeshPhysicalMaterial({ color: 0xffffff, map: weaveTex(), roughness: 0.45, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12 }),
  aluminum:      c => new T.MeshStandardMaterial({ color: c ?? 0xc9ced6, metalness: 1, roughness: 0.3, roughnessMap: brushedTex() }),
  anodized:      c => new T.MeshStandardMaterial({ color: c ?? 0xd8342c, metalness: 0.85, roughness: 0.32, roughnessMap: brushedTex() }),
  steel:         c => new T.MeshStandardMaterial({ color: c ?? 0xa4aab2, metalness: 1, roughness: 0.22 }),
  'black-metal': c => new T.MeshStandardMaterial({ color: c ?? 0x2a2c30, metalness: 0.8, roughness: 0.38, roughnessMap: brushedTex() }),
  copper:        () => new T.MeshStandardMaterial({ color: 0xc8794a, metalness: 1, roughness: 0.3 }),
  plastic:       c => new T.MeshStandardMaterial({ color: c ?? 0x3a3f46, metalness: 0, roughness: 0.62 }),
  'glossy-plastic': c => new T.MeshPhysicalMaterial({ color: c ?? 0xf2f2f2, metalness: 0, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  rubber:        c => new T.MeshStandardMaterial({ color: c ?? 0x16171a, metalness: 0, roughness: 0.92 }),
  pcb:           c => new T.MeshStandardMaterial({ color: c ?? 0x1d6b3e, map: pcbTex(), metalness: 0.1, roughness: 0.42 }),
  lipo:          c => new T.MeshPhysicalMaterial({ color: c ?? 0x2b5fb3, metalness: 0, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  lens:          () => new T.MeshPhysicalMaterial({ color: 0x0a1626, metalness: 0.4, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0 }),
  prop:          c => new T.MeshPhysicalMaterial({ color: c ?? 0x2f8fff, metalness: 0, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25 })
};
function makePreset(spec, keepColor, low) {
  const o = typeof spec === 'string' ? { preset: spec } : (spec || {});
  const f = PRESETS[o.preset]; if (!f) return null;
  const col = o.color != null ? new T.Color(o.color) : (keepColor || undefined);
  let m = f(col);
  if (low && m.isMeshPhysicalMaterial) {                              // low quality: drop clearcoat, keep colour/texture
    const s = new T.MeshStandardMaterial({ color: m.color, map: m.map, roughness: m.roughness, metalness: m.metalness, roughnessMap: m.roughnessMap }); m.dispose(); m = s;
  }
  m.name = 'preset:' + o.preset; m.userData.textured = !!(m.map || m.roughnessMap);
  return m;
}
/* box-projected UVs so procedural textures work on any mesh (CAD meshes often have none) */
function boxUV(mesh, density) {
  const g = mesh.geometry; if (!g || !g.attributes.position) return;
  const ws = mesh.getWorldScale(new T.Vector3()), key = density.toFixed(6) + '|' + ws.x.toFixed(5);
  if (g.userData.a3dUV === key) return;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, nrm = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = p.getX(i) * ws.x * density, y = p.getY(i) * ws.y * density, z = p.getZ(i) * ws.z * density;
    if (nx >= ny && nx >= nz) { uv[2 * i] = z; uv[2 * i + 1] = y; } else if (ny >= nz) { uv[2 * i] = x; uv[2 * i + 1] = z; } else { uv[2 * i] = x; uv[2 * i + 1] = y; }
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.userData.a3dUV = key;
}

/* soft contact shadow: top-down depth render, blurred. Follows moving parts; cheap enough for phones. */
const BLUR_FRAG = dir => `uniform sampler2D tDiffuse; uniform float d; varying vec2 vUv;
void main(){ vec4 s=vec4(0.0); vec2 o=${dir};
 s+=texture2D(tDiffuse,vUv-4.0*o*d)*0.051; s+=texture2D(tDiffuse,vUv-3.0*o*d)*0.0918; s+=texture2D(tDiffuse,vUv-2.0*o*d)*0.12245; s+=texture2D(tDiffuse,vUv-o*d)*0.1531;
 s+=texture2D(tDiffuse,vUv)*0.1633; s+=texture2D(tDiffuse,vUv+o*d)*0.1531; s+=texture2D(tDiffuse,vUv+2.0*o*d)*0.12245; s+=texture2D(tDiffuse,vUv+3.0*o*d)*0.0918; s+=texture2D(tDiffuse,vUv+4.0*o*d)*0.051;
 gl_FragColor=s; }`;
const BLUR_VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
function contactShadow(renderer, res, size, height, opacity) {
  const rt = new T.WebGLRenderTarget(res, res), rtB = new T.WebGLRenderTarget(res, res);
  rt.texture.generateMipmaps = rtB.texture.generateMipmaps = false;
  const group = new T.Group(); group.name = 'a3d_contact_shadow';
  const geo = new T.PlaneGeometry(size, size).rotateX(Math.PI / 2);
  const plane = new T.Mesh(geo, new T.MeshBasicMaterial({ map: rt.texture, opacity, transparent: true, depthWrite: false }));
  plane.renderOrder = 1; plane.scale.y = -1; group.add(plane);
  const blurPlane = new T.Mesh(geo); blurPlane.visible = false; group.add(blurPlane);
  const cam = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height); cam.rotation.x = Math.PI / 2; group.add(cam);
  const depth = new T.MeshDepthMaterial(); depth.userData.darkness = { value: 1.6 }; depth.depthTest = depth.depthWrite = false;
  depth.onBeforeCompile = sh => { sh.uniforms.darkness = depth.userData.darkness;
    sh.fragmentShader = 'uniform float darkness;\n' + sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'); };
  const hB = new T.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, d: { value: 0 } }, vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG('vec2(1.0,0.0)'), depthTest: false });
  const vB = new T.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, d: { value: 0 } }, vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG('vec2(0.0,1.0)'), depthTest: false });
  const blur = amt => {
    blurPlane.visible = true;
    blurPlane.material = hB; hB.uniforms.tDiffuse.value = rt.texture; hB.uniforms.d.value = amt / res; renderer.setRenderTarget(rtB); renderer.render(blurPlane, cam);
    blurPlane.material = vB; vB.uniforms.tDiffuse.value = rtB.texture; vB.uniforms.d.value = amt / res; renderer.setRenderTarget(rt); renderer.render(blurPlane, cam);
    blurPlane.visible = false;
  };
  return {
    group,
    update(scene, hide) {
      const bg = scene.background, alpha = renderer.getClearAlpha(), old = renderer.getRenderTarget();
      scene.background = null; plane.visible = false; hide.forEach(o => { o.userData.a3dWasVis = o.visible; o.visible = false; });
      scene.overrideMaterial = depth; renderer.setClearAlpha(0);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
      scene.overrideMaterial = null; blur(2.2); blur(0.9);
      renderer.setRenderTarget(old); renderer.setClearAlpha(alpha); scene.background = bg; plane.visible = true;
      hide.forEach(o => { o.visible = o.userData.a3dWasVis; });
    },
    dispose() { rt.dispose(); rtB.dispose(); geo.dispose(); plane.material.dispose(); depth.dispose(); hB.dispose(); vB.dispose(); }
  };
}

/* ------------------------------------------------------------------ styles (injected once) */
function injectCSS() {
  if (document.getElementById('a3d-css')) return;
  const css = `
.a3d{position:relative;border-radius:var(--radius,10px);overflow:hidden;background:var(--panel,#11171e);border:1px solid var(--line,#232e3b);font:14px var(--sans,system-ui,sans-serif);color:var(--text,#e6edf3);user-select:none}
.a3d-stage{position:relative;background:radial-gradient(ellipse at 50% 40%,color-mix(in srgb,var(--panel2,#171f28) 100%,transparent),var(--panel,#11171e) 75%);touch-action:none}
.a3d-stage canvas{display:block;width:100%;height:100%;cursor:grab}
.a3d-stage canvas:active{cursor:grabbing}
.a3d-msg{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;color:var(--muted,#8a97a7);font-size:14px;pointer-events:none}
.a3d-tag{position:absolute;top:10px;left:12px;font:600 11px var(--mono,monospace);letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#8a97a7);pointer-events:none}
.a3d-wide{}@media(max-width:520px){.a3d-wide{display:none}}
.a3d-view{position:absolute;top:8px;right:8px;border:1px solid var(--line2,#2f3d4e);background:var(--panel,#11171e);color:inherit;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;opacity:.85}
.a3d-callouts{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.a3d-callout{position:absolute;transform:translate(-50%,-130%);background:var(--accent,#ffb020);color:var(--accent-ink,#1a1200);font:600 12px var(--sans,sans-serif);padding:3px 9px;border-radius:99px;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35);transition:opacity .2s}
.a3d-callout::after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:var(--accent,#ffb020)}
.a3d-cap{display:flex;gap:10px;align-items:baseline;padding:10px 14px 4px;min-height:42px}
.a3d-num{font:600 12px var(--mono,monospace);color:var(--accent,#ffb020);white-space:nowrap}
.a3d-txt{font-weight:600;line-height:1.35}
.a3d-bar{display:flex;gap:6px;align-items:center;padding:6px 10px 10px}
.a3d-bar button{border:1px solid var(--line2,#2f3d4e);background:var(--panel2,#171f28);color:inherit;border-radius:8px;min-width:34px;height:32px;cursor:pointer;font-size:13px}
.a3d-bar button.a3d-play{background:var(--accent,#ffb020);color:var(--accent-ink,#1a1200);border-color:var(--accent,#ffb020);min-width:44px;font-weight:700}
.a3d-scrub{flex:1;accent-color:var(--accent,#ffb020);min-width:60px}
.a3d-dots{display:flex;gap:4px;flex-wrap:wrap;padding:0 14px 8px}
.a3d-dots button{width:22px;height:6px;border-radius:99px;border:0;background:var(--line2,#2f3d4e);cursor:pointer;padding:0}
.a3d-dots button.on{background:var(--accent,#ffb020)}
.a3d-dots button.done{background:color-mix(in srgb,var(--accent,#ffb020) 45%,var(--line2,#2f3d4e))}
.a3d-issues{margin:0;padding:8px 14px 10px 30px;color:var(--danger,#ff5b5b);font:12px var(--mono,monospace);border-top:1px dashed var(--line,#232e3b)}`;
  const s = document.createElement('style'); s.id = 'a3d-css'; s.textContent = css; document.head.appendChild(s);
}

/* ------------------------------------------------------------------ model loading */
const modelCache = new Map();
function loadModel(spec) {
  if (spec && typeof spec === 'object' && spec.isObject3D) return Promise.resolve(spec);
  if (spec && typeof spec === 'object' && spec.buffer) {           // { buffer: ArrayBuffer } from a dropped file
    return new Promise((res, rej) => { const l = gltfLoader(); l.parse(spec.buffer, '', g => res(g.scene), rej); });
  }
  if (typeof spec === 'string' && BUILDERS[spec]) return Promise.resolve(BUILDERS[spec](T, { preset: makePreset, presets: Object.keys(PRESETS) }));
  const src = MODELS[spec] || spec;
  if (!src) return Promise.reject(new Error('No model specified.'));
  if (!modelCache.has(src)) {
    modelCache.set(src, new Promise((res, rej) => gltfLoader().load(src, g => res(g.scene), undefined, err => {
      modelCache.delete(src);
      const fileProto = location.protocol === 'file:' && !/^(data|blob):/.test(src);
      rej(new Error(fileProto
        ? `Browsers block loading "${src}" when the guide is opened as a file. Convert it with tools/glb-to-js.mjs (or Assembly Studio → "Make offline model file") and list the .js file in GUIDE.settings.models, or host the guide on a web server.`
        : `Could not load model "${spec}" (${err && err.message || err}).`));
    })));
  }
  return modelCache.get(src).then(scene => scene.clone(true));
}
function gltfLoader() { const l = new T.GLTFLoader(); if (T.MeshoptDecoder) l.setMeshoptDecoder(T.MeshoptDecoder); return l; }

/* ------------------------------------------------------------------ helpers */
function globToRe(p) { return new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }
function asList(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
const tmpBox = new T.Box3(), tmpV = new T.Vector3();

/* direction strings: "up", "down", "left", "right", "front", "back", "out", "in", or axis form "+y", "-x+z", combos "up front" */
function parseDir(spec, ctx, part) {
  if (Array.isArray(spec)) return new T.Vector3().fromArray(spec.map(Number));
  if (spec && typeof spec === 'object') return new T.Vector3(spec.x || 0, spec.y || 0, spec.z || 0);
  if (typeof spec !== 'string') return null;
  const s = spec.toLowerCase().trim(), v = new T.Vector3();
  const named = { up: ctx.up, down: ctx.up.clone().negate(), front: ctx.front, forward: ctx.front, back: ctx.front.clone().negate(), rear: ctx.front.clone().negate(), right: ctx.right, left: ctx.right.clone().negate() };
  let ok = false;
  s.split(/[\s,]+/).forEach(tok => {
    if (named[tok]) { v.add(named[tok]); ok = true; return; }
    if (tok === 'out' || tok === 'in') {
      const d = part ? part.center.clone().sub(ctx.center) : new T.Vector3();
      d.addScaledVector(ctx.up, -d.dot(ctx.up));                     // horizontal radial direction
      if (d.lengthSq() < 1e-9) d.copy(ctx.up);
      d.normalize(); if (tok === 'in') d.negate(); v.add(d); ok = true; return;
    }
    const re = /([+-]?)([xyz])/g; let m, any = false;
    while ((m = re.exec(tok))) { any = true; v.setComponent('xyz'.indexOf(m[2]), v.getComponent('xyz'.indexOf(m[2])) + (m[1] === '-' ? -1 : 1)); }
    if (any) ok = true;
  });
  if (!ok || v.lengthSq() < 1e-12) return null;
  return v.normalize();
}

/* ------------------------------------------------------------------ the player */
function mount(container, config, opts) {
  injectCSS(); opts = opts || {};
  for (const p of [...live]) if (!document.body.contains(p.container)) p.destroy();   // free GPU contexts from removed views

  const cfg0 = config || {};
  const height = cfg0.height || opts.height || 380;
  container.innerHTML = `<div class="a3d">
    <div class="a3d-stage" style="height:${height}px"><canvas></canvas><div class="a3d-callouts"></div>
      <div class="a3d-tag">3D · drag to rotate<span class="a3d-wide"> · scroll/pinch to zoom</span></div><button class="a3d-view" title="Reset the camera">⟲ view</button><div class="a3d-msg">Loading 3D model…</div></div>
    <div class="a3d-cap"><span class="a3d-num"></span><span class="a3d-txt"></span></div>
    <div class="a3d-dots"></div>
    <div class="a3d-bar"><button class="a3d-prev" title="Previous step">⏮</button><button class="a3d-play" title="Play / pause">▶</button><button class="a3d-next" title="Next step">⏭</button>
      <input class="a3d-scrub" type="range" min="0" max="1000" value="0" aria-label="Animation position"><button class="a3d-speed" title="Speed">1×</button><button class="a3d-replay" title="Replay from start">↺</button></div>
  </div>`;
  const $ = s => container.querySelector(s);
  const canvas = $('canvas'), msg = $('.a3d-msg'), stage = $('.a3d-stage');

  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer }); }
  catch (e) { msg.textContent = '3D view unavailable: this browser or computer has WebGL turned off.'; return { ready: Promise.reject(e), destroy() {} }; }
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;           // phones/tablets start at lower resolution
  let quality = opts.quality || cfg0.quality || (coarse ? 'low' : 'high');
  const applyQuality = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
  applyQuality();
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping || T.ACESFilmicToneMapping;   // keeps CAD colours true
  renderer.toneMappingExposure = 1.0;
  const scene = new T.Scene();
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  /* studio lighting: warm key, cool fill, white rim (positions are re-scaled to the model in applyConfig) */
  const lights = { key: new T.DirectionalLight(0xfff1e0, 2.0), fill: new T.DirectionalLight(0xdbe6ff, 0.55), rim: new T.DirectionalLight(0xffffff, 1.3) };
  Object.values(lights).forEach(l => scene.add(l, l.target));
  scene.add(new T.HemisphereLight(0xe8eeff, 0x2a241c, 0.35));
  let shadow = null, shadowT = -1, shadowAt = 0, frames = 0, frameTimeSum = 0;
  const camera = new T.PerspectiveCamera(cfg0.fov || 35, 1, 0.01, 1000);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;

  const self = { container, version: VERSION, issues: [], parts: [], duration: 0 };
  let root = null, idx = new Map(), tracked = new Map(), meshInfo = [], trails = [], callouts = [], ground = null;
  let timeline = null, t = 0, playing = false, speed = 1, lastNow = 0, loopWait = 0, camFollow = true, raf = 0, visible = true, destroyed = false, curCap = -1;
  let ctx = null, cfg = cfg0, homeCam = null;

  /* ---------- size & visibility */
  const resize = () => {
    const w = stage.clientWidth || 600, h = stage.clientHeight || height;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (ctx && homeCam && !(cfg.camera && cfg.camera.position)) {          // keep the model fitted when the view changes shape
      const d = fitDistance(), dir = homeCam.position.clone().sub(homeCam.target).normalize();
      homeCam.position.copy(homeCam.target).addScaledVector(dir, d * (cfg.camera && cfg.camera.zoom ? 1 / cfg.camera.zoom : 1));
      if (timeline && camFollow && !timeline.camSegs.length) { camera.position.copy(homeCam.position); controls.target.copy(homeCam.target); }
      if (timeline) evaluate(t);
    }
  };
  function fitDistance() {                                                   // fits both the vertical and the horizontal field of view
    const vf = camera.fov * D2R, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    return ctx.radius / Math.sin(Math.min(vf, hf) / 2) * (camera.aspect < 1 ? 1.0 : 0.82);   // portrait phones need more room
  }
  const ro = new ResizeObserver(resize); ro.observe(stage);
  const io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); }); io.observe(stage);
  controls.addEventListener('start', () => { camFollow = false; });

  /* ---------- load */
  self.ready = loadModel(cfg.model || opts.model).then(obj => {
    if (destroyed) return self;
    root = obj;
    if (!(cfg.modelLights)) {                                   // CAD/Blender exports often carry scene lights & cameras: drop them
      const extras = []; root.traverse(o => { if (o.isLight || o.isCamera) extras.push(o); });
      extras.forEach(o => o.parent && o.parent.remove(o));
      if (extras.length) console.info(`[assembly3d] ignored ${extras.length} light/camera node(s) embedded in the model (set modelLights: true to keep them)`);
    }
    scene.add(root); root.updateMatrixWorld(true);
    indexParts();
    msg.textContent = '';
    applyConfig(cfg);
    resize(); loop();
    if (opts.onReady) opts.onReady(self);
    return self;
  }).catch(err => { msg.textContent = '⚠ ' + (err && err.message || err); console.error('[assembly3d]', err); throw err; });

  function indexParts() {
    idx = new Map();
    root.traverse(o => {
      if (o.isMesh) {                                                  // private material copies so parts can fade/glow independently
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        asList(o.material).forEach(m => { m.userData.a3d = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity }; });
      }
      if (o !== root && o.name && !idx.has(o.name)) idx.set(o.name, o);
      o.userData.a3dHome = { p: o.position.clone(), q: o.quaternion.clone(), visible: o.visible };
    });
    const box = new T.Box3().setFromObject(root);
    self.parts = [...idx.entries()].map(([name, o]) => { tmpBox.setFromObject(o); const s = tmpBox.getSize(new T.Vector3());
      return { name, type: o.isMesh ? 'mesh' : 'group', size: s.toArray().map(v => +v.toFixed(4)), center: tmpBox.getCenter(new T.Vector3()).toArray().map(v => +v.toFixed(4)), parent: o.parent && o.parent !== root ? o.parent.name : null }; });
    self.modelBox = { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new T.Vector3()).toArray() };
  }
  function resolve(patterns, issues, where) {
    const out = [];
    asList(patterns).forEach(p => {
      const re = globToRe(p); let hit = false;
      idx.forEach((o, name) => { if (re.test(name)) { out.push(o); hit = true; } });
      if (!hit && issues) issues.push(`${where}: no part matches "${p}"`);
    });
    const set = new Set(out);                                          // drop matches whose ancestor also matched (parent carries child)
    return [...set].filter(o => { for (let a = o.parent; a; a = a.parent) if (set.has(a)) return false; return true; });
  }

  /* ---------- reset & compile */
  function resetPose() {
    root.traverse(o => { const h = o.userData.a3dHome; o.userData.a3dHidden = false; if (h) { o.position.copy(h.p); o.quaternion.copy(h.q); o.visible = h.visible; } });
    trails.forEach(tr => { scene.remove(tr.obj); tr.obj.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); });
    trails = []; tracked = new Map();
    callouts.forEach(c => c.el.remove()); callouts = [];
    if (ground) { scene.remove(ground); if (shadow) { shadow.dispose(); shadow = null; } ground = null; }
    root.updateMatrixWorld(true);
  }

  function applyMaterials() {
    root.traverse(o => { if (o.isMesh && o.userData.a3dOrigMat) { o.material = o.userData.a3dOrigMat; delete o.userData.a3dOrigMat; } });
    const jobs = [];
    root.traverse(o => { if (o.isMesh && o.userData.preset) jobs.push([o, o.userData.preset]); });   // tagged by builders
    Object.entries(cfg.materials || {}).forEach(([pat, spec]) => {
      const hits = resolve(pat, self.issues, 'materials');
      hits.forEach(h => h.traverse(o => { if (o.isMesh) jobs.push([o, spec]); }));
      const name = typeof spec === 'string' ? spec : spec && spec.preset;
      if (!PRESETS[name]) self.issues.push(`materials: unknown preset "${name}" (use ${Object.keys(PRESETS).join(', ')})`);
    });
    if (!jobs.length) return;
    const rb = new T.Box3().setFromObject(root), density = 40 / Math.max(rb.getSize(tmpV).length(), 1e-6);   // ~40 weave tiles across the model
    jobs.forEach(([o, spec]) => {
      const cur = asList(o.material)[0], keep = cur && cur.color ? cur.color.clone() : null;
      const m = makePreset(spec, keep, quality !== 'high'); if (!m) return;
      if (!o.userData.a3dOrigMat) o.userData.a3dOrigMat = o.material;
      m.userData.a3d = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity };
      if (cur) m.side = cur.side;                                    // e.g. double-sided props
      o.material = m;
      if (m.userData.textured) boxUV(o, density);
    });
  }

  function applyConfig(newCfg) {
    cfg = newCfg || {}; resetPose();
    const issues = self.issues = [];
    applyMaterials();
    if (cfg.steps != null && !Array.isArray(cfg.steps)) issues.push('"steps" must be an array');
    const steps = Array.isArray(cfg.steps) ? cfg.steps : [];

    /* visibility: hide / show / ghost */
    const hidden = new Set(resolve(cfg.hide, issues, 'hide'));
    const ghosts = new Set(resolve(cfg.ghost, issues, 'ghost'));
    const animated = new Set();
    steps.forEach((s, i) => resolve(s.parts, null).forEach(o => animated.add(o)));
    if (cfg.show) {
      const keep = new Set([...resolve(cfg.show, issues, 'show'), ...animated]);
      const keepWithFamily = o => { for (let a = o; a && a !== root; a = a.parent) if (keep.has(a)) return true; return false; };
      const hasKeptDescendant = o => { let f = false; o.traverse(c => { if (c !== o && keep.has(c)) f = true; }); return f; };
      idx.forEach(o => { if (!keepWithFamily(o) && !hasKeptDescendant(o)) hidden.add(o); });
    }
    hidden.forEach(o => { o.visible = false; o.userData.a3dHidden = true; });          // per-config; home pose stays untouched
    root.updateMatrixWorld(true);

    /* framing context (computed from visible parts at assembled pose) */
    const box = new T.Box3(); root.traverse(o => { if (o.isMesh && isShown(o)) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromObject(root);
    const center = box.getCenter(new T.Vector3()), radius = Math.max(box.getSize(new T.Vector3()).length() / 2, 1e-6);
    ctx = { center, radius, box,
      up: parseDir(cfg.up || '+y', { up: new T.Vector3(0, 1, 0), front: new T.Vector3(0, 0, -1), right: new T.Vector3(1, 0, 0), center }) || new T.Vector3(0, 1, 0),
      front: null, right: null };
    ctx.front = parseDir(cfg.front || '-z', { up: ctx.up, front: new T.Vector3(0, 0, -1), right: new T.Vector3(1, 0, 0), center }) || new T.Vector3(0, 0, -1);
    ctx.right = new T.Vector3().crossVectors(ctx.front, ctx.up).normalize();
    const autoDist = cfg.distance || radius * 0.7;

    /* camera home */
    const cam = cfg.camera || {};
    const dirDefault = ctx.front.clone().multiplyScalar(1.15).add(ctx.right.clone().multiplyScalar(0.9)).add(ctx.up.clone().multiplyScalar(0.95)).normalize();   // front-right, above
    resize(); const fitDist = fitDistance();
    homeCam = {
      position: cam.position ? new T.Vector3().fromArray(cam.position) : center.clone().addScaledVector(cam.direction ? new T.Vector3().fromArray(cam.direction).normalize() : dirDefault, fitDist * (cam.zoom ? 1 / cam.zoom : 1)),
      target: cam.target ? new T.Vector3().fromArray(cam.target) : center.clone()
    };
    camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.3; controls.maxDistance = radius * 12;

    /* studio lights placed relative to the model and camera framing */
    const place = (l, f, r, u) => { l.position.copy(center).addScaledVector(ctx.front, f * radius * 4).addScaledVector(ctx.right, r * radius * 4).addScaledVector(ctx.up, u * radius * 4); l.target.position.copy(center); };
    place(lights.key, 0.9, 1.0, 1.4); place(lights.fill, 0.6, -1.2, 0.5); place(lights.rim, -1.3, -0.3, 0.9);

    /* soft contact shadow under the model (follows moving parts) */
    if (cfg.ground !== false) {
      const low = box.min.clone().sub(center).dot(ctx.up);
      shadow = contactShadow(renderer, quality === 'high' ? 512 : 256, radius * 3, radius * 2.2, cfg.shadowOpacity ?? 0.8);
      shadow.group.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), ctx.up);
      shadow.group.position.copy(center).addScaledVector(ctx.up, low - radius * 0.005);
      ground = shadow.group; scene.add(ground); shadowT = -1;
    }

    /* compile the timeline */
    let tCursor = 0, lastStart = 0;
    const caps = [], camSegs = [], labels = cfg.labels || {};
    const partInfo = o => {
      if (!tracked.has(o)) {
        tmpBox.setFromObject(o);
        const pinv = new T.Matrix3().setFromMatrix4(o.parent.matrixWorld.clone().invert());
        tracked.set(o, { obj: o, segs: [], center: tmpBox.getCenter(new T.Vector3()), size: tmpBox.getSize(new T.Vector3()).length(), pinv, ghost: false });
      }
      return tracked.get(o);
    };
    steps.forEach((s, i) => {
      const where = `step ${i + 1}${s.label ? ' ("' + String(s.label).slice(0, 30) + '")' : ''}`;
      const action = s.action || (s.parts ? 'insert' : s.camera ? 'camera' : 'wait');
      if (!ACTIONS.includes(action)) { issues.push(`${where}: unknown action "${action}" (use ${ACTIONS.join(', ')})`); return; }
      if (s.ease && !EASE[s.ease]) issues.push(`${where}: unknown ease "${s.ease}" (use ${Object.keys(EASE).join(', ')})`);
      const parts = ['camera', 'wait'].includes(action) ? [] : resolve(s.parts, issues, where);
      if (!['camera', 'wait'].includes(action) && !asList(s.parts).length) issues.push(`${where}: "${action}" needs "parts"`);
      const dur = Math.max(0.01, +(s.duration ?? { wait: 1, camera: 1.6, highlight: 1.6, show: 0.5, hide: 0.5, fade: 0.6 }[action] ?? 1.2));
      const stagger = +(s.stagger || 0), parallel = s.with === 'previous' || s.with === 'prev';
      const start = (parallel ? lastStart : tCursor) + (+s.delay || 0);
      const end = start + Math.max(0, parts.length - 1) * stagger + dur;
      const ease = EASE[s.ease] || (action === 'insert' ? EASE.out : EASE.inOut);
      parts.forEach((o, j) => {
        const P = partInfo(o), segStart = start + j * stagger;
        const dirSpec = action === 'insert' ? (s.from ?? 'up') : s.to;
        let off = null;
        if (dirSpec != null) {
          if (Array.isArray(dirSpec)) off = new T.Vector3().fromArray(dirSpec.map(Number));            // exact offset, model units
          else if (typeof dirSpec === 'object') off = new T.Vector3(+dirSpec.x || 0, +dirSpec.y || 0, +dirSpec.z || 0);
          else { const d = parseDir(dirSpec, ctx, P); if (!d) issues.push(`${where}: can't read direction ${JSON.stringify(dirSpec)}`); else off = d.multiplyScalar(+(s.distance ?? autoDist)); }
        }
        const path = asList(s.path).map(p => Array.isArray(p) ? new T.Vector3().fromArray(p) : (parseDir(p, ctx, P) || new T.Vector3()).multiplyScalar(+(s.distance ?? autoDist)));
        P.segs.push({ action, start: segStart, dur, ease, off, path, rotate: s.rotate ? new T.Vector3().fromArray(s.rotate) : null,
          spin: s.spin ? { axis: new T.Vector3().fromArray(Array.isArray(s.spin.axis) ? s.spin.axis : ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[s.spin.axis || 'y'] || [0, 1, 0])).normalize(), turns: +(s.spin.turns ?? 1) } : null,
          highlight: s.highlight ?? ['insert', 'move', 'remove', 'spin', 'highlight'].includes(action),
          trail: s.trail ?? (action === 'insert' || action === 'move'), opacity: s.opacity, hideAfter: s.hideAfter ?? true,
          callout: s.callout === true ? (labels[o.name] || o.name) : typeof s.callout === 'string' ? (parts.length > 1 ? (labels[o.name] || s.callout) : s.callout) : null });
      });
      if (s.camera) camSegs.push({ start, dur: +(s.camera.duration ?? Math.max(dur, 1.2)), to: s.camera, ease: EASE.inOut });
      if (!parallel) { caps.push({ start, label: s.label || '', step: i }); lastStart = start; }
      tCursor = Math.max(tCursor, end + +(s.hold ?? cfg.hold ?? 0.4));
    });
    caps.forEach((c, k) => c.end = k + 1 < caps.length ? caps[k + 1].start : tCursor);
    ghosts.forEach(o => { partInfo(o).ghost = true; });

    /* per-part state chains (deterministic → scrubbing works) */
    tracked.forEach(P => {
      P.segs.sort((a, b) => a.start - b.start);
      const first = P.segs[0];
      let st = { off: new T.Vector3(), rot: new T.Vector3(), spin: new T.Quaternion(), op: 1 };
      if (first && first.action === 'insert') { st.off = (first.off || new T.Vector3()).clone(); st.rot = first.rotate ? first.rotate.clone() : new T.Vector3(); st.op = 0; }
      P.initial = cloneSt(st);
      P.segs.forEach(sg => {
        const s0 = cloneSt(st);
        if (sg.action === 'insert') { s0.off = (sg.off || new T.Vector3()).clone(); if (sg.rotate) s0.rot = sg.rotate.clone(); }
        const s1 = cloneSt(s0);
        const spinQ = sg.spin ? new T.Quaternion().setFromAxisAngle(sg.spin.axis, sg.spin.turns * Math.PI * 2) : null;
        if (spinQ) s1.spin.multiply(spinQ);
        switch (sg.action) {
          case 'insert': s1.off.set(0, 0, 0); s1.rot.set(0, 0, 0); s1.op = 1; break;
          case 'remove': if (sg.off) s1.off.copy(sg.off); if (sg.rotate) s1.rot.copy(sg.rotate); s1.op = sg.hideAfter ? 0 : s0.op; break;
          case 'move': if (sg.off) s1.off.copy(sg.off); if (sg.rotate) s1.rot.copy(sg.rotate); break;
          case 'show': s1.op = 1; break;
          case 'hide': s1.op = 0; break;
          case 'fade': s1.op = clamp(+(sg.opacity ?? 0.3), 0, 1); break;
        }
        sg.s0 = s0; sg.s1 = s1;
        if (sg.path.length || !s0.off.equals(s1.off)) sg.curve = sg.path.length ? new T.CatmullRomCurve3([s0.off, ...sg.path, s1.off], false, 'centripetal') : null;
        st = cloneSt(s1);
      });
      /* dashed guide trail + arrow head for moves */
      P.segs.forEach(sg => {
        if (!sg.trail || sg.s0.off.distanceTo(sg.s1.off) < ctx.radius * 0.02) return;
        const home = P.obj.userData.a3dHome.p, parent = P.obj.parent, pts = [];
        const centerOffset = P.center.clone().sub(P.obj.getWorldPosition(new T.Vector3()));   // trail follows the part's visual centre
        for (let k = 0; k <= 24; k++) {
          const local = home.clone().add(offAt(sg, k / 24).applyMatrix3(P.pinv));
          pts.push(parent.localToWorld(local).add(centerOffset));
        }
        const geo = new T.BufferGeometry().setFromPoints(pts);
        const line = new T.Line(geo, new T.LineDashedMaterial({ color: ACCENT, dashSize: ctx.radius * 0.035, gapSize: ctx.radius * 0.025, transparent: true, opacity: 0, depthTest: false }));
        line.computeLineDistances(); line.renderOrder = 999;
        const tip = pts[pts.length - 1], dir = tip.clone().sub(pts[pts.length - 3]).normalize();
        const cone = new T.Mesh(new T.ConeGeometry(ctx.radius * 0.025, ctx.radius * 0.07, 12), new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthTest: false }));
        cone.position.copy(tip).addScaledVector(dir, -ctx.radius * 0.06); cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); cone.renderOrder = 999;
        const g = new T.Group(); g.add(line, cone); scene.add(g);
        trails.push({ obj: g, mats: [line.material, cone.material], start: sg.start, end: sg.start + sg.dur });
      });
      /* callouts */
      P.segs.forEach(sg => {
        if (!sg.callout) return;
        const el = document.createElement('div'); el.className = 'a3d-callout'; el.textContent = sg.callout; el.style.opacity = 0;
        $('.a3d-callouts').appendChild(el);
        const cap = caps.find(c => sg.start >= c.start - 1e-6 && sg.start < c.end) || { end: sg.start + sg.dur + 1 };
        callouts.push({ el, P, start: sg.start, end: Math.max(cap.end, sg.start + sg.dur + 0.6) });
      });
    });

    /* camera chain */
    let camSt = { position: homeCam.position.clone(), target: homeCam.target.clone() };
    camSegs.sort((a, b) => a.start - b.start).forEach(c => {
      c.s0 = { position: camSt.position.clone(), target: camSt.target.clone() };
      const dir = c.to.direction ? new T.Vector3().fromArray(c.to.direction).normalize() : null;
      const tgt = c.to.target ? new T.Vector3().fromArray(c.to.target) : c.to.focus ? (() => { const fb = new T.Box3(); resolve(c.to.focus).forEach(o => fb.expandByObject(o)); return fb.isEmpty() ? camSt.target.clone() : fb.getCenter(new T.Vector3()); })() : camSt.target.clone();
      const dist = c.to.zoom ? homeCam.position.distanceTo(homeCam.target) / c.to.zoom : camSt.position.distanceTo(camSt.target);
      c.s1 = { target: tgt, position: c.to.position ? new T.Vector3().fromArray(c.to.position) : tgt.clone().addScaledVector(dir || camSt.position.clone().sub(camSt.target).normalize(), dist) };
      camSt = { position: c.s1.position.clone(), target: c.s1.target.clone() };
    });

    /* mesh → chain of tracked ancestors (for cascading fade/glow) */
    meshInfo = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const chain = []; let ghost = false;
      for (let a = o; a && a !== root.parent; a = a.parent) { if (tracked.has(a)) { chain.push(tracked.get(a)); if (tracked.get(a).ghost) ghost = true; } }
      meshInfo.push({ mesh: o, chain, ghost, mats: asList(o.material) });
    });

    timeline = { duration: tCursor, caps, camSegs };
    self.duration = tCursor;
    if (!caps.length && !steps.length) $('.a3d-cap').style.display = 'none'; else $('.a3d-cap').style.display = '';
    $('.a3d-dots').innerHTML = caps.length > 1 ? caps.map((c, k) => `<button data-k="${k}" title="Step ${k + 1}: ${String(c.label).replace(/"/g, '&quot;')}"></button>`).join('') : '';
    const issEl = container.querySelector('.a3d-issues'); if (issEl) issEl.remove();
    if (issues.length && (opts.debug || cfg.debug)) container.querySelector('.a3d').insertAdjacentHTML('beforeend', `<ul class="a3d-issues">${issues.map(x => `<li>${x.replace(/</g, '&lt;')}</li>`).join('')}</ul>`);
    if (issues.length) console.warn('[assembly3d] config issues:\n' + issues.join('\n'));

    camera.position.copy(homeCam.position); controls.target.copy(homeCam.target); controls.update();
    camFollow = true; curCap = -1;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const autoplay = (cfg.autoplay ?? opts.autoplay ?? true) && !reduce;
    seek(0); setPlaying(autoplay && timeline.duration > 0);
  }

  function isShown(o) { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; }
  function cloneSt(s) { return { off: s.off.clone(), rot: s.rot.clone(), spin: s.spin.clone(), op: s.op }; }
  function offAt(sg, k) { return sg.curve ? sg.curve.getPoint(k) : sg.s0.off.clone().lerp(sg.s1.off, k); }

  /* ---------- evaluate a time */
  const qTmp = new T.Quaternion(), eTmp = new T.Euler();
  function evaluate(time) {
    tracked.forEach(P => {
      let off = P.initial.off, rot = P.initial.rot, spin = P.initial.spin, op = P.initial.op, glow = 0;
      for (const sg of P.segs) {
        if (time < sg.start) break;
        const raw = clamp((time - sg.start) / sg.dur, 0, 1), k = sg.ease(raw), kl = clamp(raw, 0, 1);
        off = offAt(sg, k);
        rot = sg.s0.rot.clone().lerp(sg.s1.rot, k);
        spin = sg.spin ? sg.s0.spin.clone().multiply(qTmp.setFromAxisAngle(sg.spin.axis, sg.spin.turns * Math.PI * 2 * k)) : sg.s1.spin;
        if (sg.action === 'insert') op = sg.s0.op + (1 - sg.s0.op) * clamp(kl / 0.2, 0, 1);
        else if (sg.action === 'remove' && sg.hideAfter) op = sg.s0.op * (1 - clamp((kl - 0.8) / 0.2, 0, 1));
        else op = sg.s0.op + (sg.s1.op - sg.s0.op) * k;
        if (sg.highlight) { const end = sg.start + sg.dur; glow = Math.max(glow, time <= end ? 0.55 + 0.3 * Math.sin((time - sg.start) * 7) : clamp(0.55 * (1 - (time - end) / 0.6), 0, 1)); }
      }
      const h = P.obj.userData.a3dHome;
      P.obj.position.copy(h.p).add(off.clone().applyMatrix3(P.pinv));
      P.obj.quaternion.copy(h.q).multiply(qTmp.setFromEuler(eTmp.set(rot.x * D2R, rot.y * D2R, rot.z * D2R))).multiply(spin);
      P.op = op; P.glow = glow;
      P.obj.visible = h.visible && !P.obj.userData.a3dHidden && op > 0.004;
    });
    meshInfo.forEach(mi => {
      let op = mi.ghost ? 0.22 : 1, glow = 0;
      mi.chain.forEach(P => { op *= P.op; glow = Math.max(glow, P.glow); });
      mi.mats.forEach(m => {
        const b = m.userData.a3d; if (!b) return;
        const o = b.opacity * op, tr = b.transparent || o < 0.999;
        if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
        m.opacity = o; m.depthWrite = tr ? (mi.ghost ? false : o > 0.6) && b.depthWrite : b.depthWrite;
        if (b.emissive && m.emissive) {
          if (glow > 0.001) { m.emissive.setHex(ACCENT); m.emissiveIntensity = glow * 0.7; }
          else { m.emissive.copy(b.emissive); m.emissiveIntensity = b.ei; }
        }
      });
    });
    trails.forEach(tr => {
      const a = time < tr.start - 0.05 ? 0 : time <= tr.end ? clamp((time - tr.start + 0.05) / 0.25, 0, 1) : clamp(1 - (time - tr.end) / 0.7, 0, 1);
      tr.mats.forEach(m => m.opacity = a * 0.95); tr.obj.visible = a > 0.01;
    });
    if (camFollow && timeline.camSegs.length) {
      let cs = null; for (const c of timeline.camSegs) { if (time >= c.start) cs = c; }
      if (cs) { const k = cs.ease(clamp((time - cs.start) / cs.dur, 0, 1)); camera.position.copy(cs.s0.position).lerp(cs.s1.position, k); controls.target.copy(cs.s0.target).lerp(cs.s1.target, k); }
      else { camera.position.copy(homeCam.position); controls.target.copy(homeCam.target); }
    }
    /* caption */
    const caps = timeline.caps; let ci = -1;
    for (let k = 0; k < caps.length; k++) if (time >= caps[k].start - 1e-6) ci = k;
    if (ci !== curCap) {
      curCap = ci; const c = caps[Math.max(0, ci)];
      $('.a3d-num').textContent = caps.length ? `${Math.max(1, ci + 1)}/${caps.length}` : '';
      $('.a3d-txt').textContent = c ? c.label : '';
      [...container.querySelectorAll('.a3d-dots button')].forEach((b, k) => { b.classList.toggle('on', k === ci); b.classList.toggle('done', k < ci); });
      if (opts.onStep) opts.onStep(ci, c);
    }
    $('.a3d-scrub').value = timeline.duration ? Math.round(time / timeline.duration * 1000) : 0;
  }

  function placeCallouts(time) {
    if (!callouts.length) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    callouts.forEach(c => {
      const on = time >= c.start && time <= c.end && c.P.obj.visible;
      c.el.style.opacity = on ? 1 : 0; if (!on) return;
      tmpBox.setFromObject(c.P.obj); tmpBox.getCenter(tmpV); tmpV.addScaledVector(ctx.up, tmpBox.getSize(new T.Vector3()).dot(ctx.up) / 2);
      tmpV.project(camera);
      c.el.style.left = ((tmpV.x + 1) / 2 * w) + 'px'; c.el.style.top = ((1 - tmpV.y) / 2 * h) + 'px';
    });
  }

  /* ---------- playback */
  function seek(time) { t = clamp(time, 0, timeline ? timeline.duration : 0); if (timeline) evaluate(t); }
  function setPlaying(p) {
    playing = p; loopWait = 0; lastNow = performance.now();
    $('.a3d-play').textContent = playing ? '⏸' : '▶';
    if (playing && timeline && t >= timeline.duration - 1e-3) { camFollow = true; seek(0); }
  }
  function capIndex() { const caps = timeline.caps; let ci = 0; caps.forEach((c, k) => { if (t >= c.start - 1e-6) ci = k; }); return ci; }
  function goStep(k, autoPlay) { const caps = timeline.caps; if (!caps.length) return; k = clamp(k, 0, caps.length - 1); camFollow = true; seek(caps[k].start); if (autoPlay !== false) setPlaying(true); }
  function loop() {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (!visible) return;
    if (playing && timeline) {
      if (t < timeline.duration) seek(t + dt * speed);
      else if ((cfg.loop ?? opts.loop ?? true)) { loopWait += dt; if (loopWait > (cfg.loopDelay ?? 1.8)) { loopWait = 0; camFollow = true; seek(0); } }
      else setPlaying(false);
    }
    controls.update();
    placeCallouts(t);
    if (shadow && t !== shadowT && now - shadowAt > ({ high: 0, low: 250, minimal: 1000 }[quality] ?? 250)) {   // re-shadow only when parts moved
      shadow.update(scene, trails.map(tr => tr.obj)); shadowT = t; shadowAt = now;
    }
    renderer.render(scene, camera);
    /* adaptive quality, two stages: high → low (lower resolution, shadow 4×/s, no clearcoat on new materials)
       → minimal (shadow refreshed once a second) if the device still averages below ~25 fps */
    if (quality !== 'minimal' && frames < 120 && !opts.quality && !cfg.quality) {
      frames++; if (frames > 20) frameTimeSum += dt;
      if (frames === 120) {
        const avg = frameTimeSum / 100; frames = 0; frameTimeSum = 0;
        if (quality === 'high' && avg > 0.028) { quality = 'low'; applyQuality(); resize(); console.info('[assembly3d] switched to low quality for smoother playback'); }
        else if (quality === 'low' && avg > 0.04) { quality = 'minimal'; console.info('[assembly3d] switched to minimal quality (slow device)'); }
        else frames = 120;                                                   // fast enough: stop measuring
      }
    }
  }

  /* ---------- UI events */
  $('.a3d-play').onclick = () => setPlaying(!playing);
  $('.a3d-next').onclick = () => goStep(capIndex() + 1);
  $('.a3d-prev').onclick = () => { const k = capIndex(), c = timeline.caps[k]; goStep(c && t - c.start > 0.4 ? k : k - 1); };
  $('.a3d-replay').onclick = () => { camFollow = true; seek(0); setPlaying(true); };
  $('.a3d-speed').onclick = e => { speed = speed === 1 ? 0.5 : speed === 0.5 ? 2 : 1; e.target.textContent = speed + '×'; };
  $('.a3d-scrub').oninput = e => { setPlaying(false); seek(e.target.value / 1000 * timeline.duration); };
  $('.a3d-view').onclick = () => { camFollow = true; if (timeline && !timeline.camSegs.length) { camera.position.copy(homeCam.position); controls.target.copy(homeCam.target); } evaluate(t); };
  $('.a3d-dots').onclick = e => { const b = e.target.closest('button'); if (b) goStep(+b.dataset.k); };

  /* picking (Assembly Studio uses this to show part names & coordinates) */
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!opts.onPick || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObject(root, true).find(h => isShown(h.object));
    if (!hit) { opts.onPick(null); return; }
    const chain = []; for (let a = hit.object; a && a !== root; a = a.parent) if (a.name) chain.push(a.name);
    opts.onPick({ name: chain[0] || '(unnamed)', chain, point: hit.point.toArray().map(v => +v.toFixed(4)) });
  });

  /* ---------- public API */
  Object.assign(self, {
    play: () => setPlaying(true), pause: () => setPlaying(false), toggle: () => setPlaying(!playing),
    seek, goStep, get time() { return t; }, get playing() { return playing; },
    setConfig: c => { if (root) applyConfig(c); else cfg = c; },
    flash(name) { const objs = resolve(name); objs.forEach(o => o.traverse(m => { if (m.isMesh) asList(m.material).forEach(mt => { if (mt.emissive) { mt.emissive.setHex(ACCENT); mt.emissiveIntensity = 0.9; } }); })); setTimeout(() => evaluate(t), 900); },
    get quality() { return quality; },
    inspect: () => [...tracked.values()].map(P => ({ name: P.obj.name, visible: P.obj.visible, opacity: +(P.op ?? 1).toFixed(3), glow: +(P.glow || 0).toFixed(2), position: P.obj.position.toArray().map(v => +v.toFixed(2)), segments: P.segs.map(sg => sg.action + '@' + sg.start.toFixed(2) + '+' + sg.dur) })),
    snapshot: () => { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    destroy() {
      if (destroyed) return; destroyed = true; cancelAnimationFrame(raf); if (shadow) { shadow.dispose(); shadow = null; } ro.disconnect(); io.disconnect(); controls.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); asList(o.material).forEach(m => m && m.dispose && m.dispose()); });
      pmrem.dispose(); renderer.dispose(); live.delete(self);
    }
  });
  live.add(self);
  return self;
}

window.Assembly3D = {
  version: VERSION, mount, models: MODELS, builders: BUILDERS, actions: ACTIONS, easings: Object.keys(EASE),
  registerModel: (name, src) => { MODELS[name] = src; },
  registerBuilder: (name, fn) => { BUILDERS[name] = fn; },
  destroyAll: () => { [...live].forEach(p => p.destroy()); }
};
})();

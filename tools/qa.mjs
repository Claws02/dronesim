#!/usr/bin/env node
/*
 * qa.mjs: one-command quality check for the setup guide and its 3D models.
 *
 *   node tools/qa.mjs                      check the whole guide (index.html + every model it uses)
 *   node tools/qa.mjs path/to/model.glb    check one model file (.glb or .glb.js): fit, size, colours, names
 *   node tools/qa.mjs --list-parts NAME    print the part names of a model (builder name, registered name or file)
 *
 * Writes QA_REPORT.md (paste it to the AI that edits the guide) and qa-report.json; exits 1 if anything FAILS.
 * Needs only Node.js 18+. No npm install: it reuses vendor/three.bundle.js and assembly3d.js from this repo.
 * Windows: double-click qa.bat (or drag a model onto it). macOS: double-click qa.command. Linux: ./qa.sh
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (+process.versions.node.split('.')[0] < 18) { console.error(`Node.js 18 or newer is needed (you have ${process.versions.node}). Install the LTS version from nodejs.org.`); process.exit(2); }

/* ------------------------------------------------------------------ arguments */
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['list-parts', 'guide', 'out', 'model'].includes(argv[i - 1].replace(/^--/, ''))));
let mode = 'guide', modelArg = opt('model'), guidePath = resolve(opt('guide') || join(ROOT, 'index.html'));
const outDir = resolve(opt('out') || ROOT);
if (opt('list-parts')) mode = 'list';
else if (modelArg) mode = 'model';
else if (positional[0]) {
  const p = positional[0];
  if (/\.(step|stp)$/i.test(p)) { console.log(`STEP files must be converted first:\n  npm install occt-import-js   (one time)\n  node tools/step-to-glb.mjs "${p}" model.glb --up z --front +x\nThen run QA on model.glb.`); process.exit(2); }
  if (/\.html?$/i.test(p)) guidePath = resolve(p); else { mode = 'model'; modelArg = p; }
}

/* ------------------------------------------------------------------ findings */
const findings = [];
const ERR = (code, where, msg, fix) => findings.push({ level: 'error', code, where, msg, fix });
const WARN = (code, where, msg, fix) => findings.push({ level: 'warning', code, where, msg, fix });
const checksRun = [];
const rel = p => relative(ROOT, p).split(sep).join('/') || p;

/* ------------------------------------------------------------------ load three.js + player into Node (no browser) */
function shimDOM() {
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && /^(create|get|measure)/.test(k) ? () => ({ addColorStop: noop, width: 0 }) : noop)), set: (t, k, v) => { t[k] = v; return true; } });
  const fakeCanvas = () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d, addEventListener: noop, toDataURL: () => '' });
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.document = { createElement: t => t === 'canvas' ? fakeCanvas() : { style: {}, appendChild: noop, setAttribute: noop }, createElementNS: () => fakeCanvas(), head: { appendChild: noop }, getElementById: () => null, body: { contains: () => false } };
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
}
function runFile(file) { vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file }); }
shimDOM();
try { runFile(join(ROOT, 'vendor/three.bundle.js')); runFile(join(ROOT, 'assembly3d.js')); }
catch (e) { console.error('Could not load vendor/three.bundle.js or assembly3d.js: ' + e.message + '\nIs this the repository folder?'); process.exit(2); }
const THREE = globalThis.THREE, A3D = globalThis.Assembly3D;

/* ------------------------------------------------------------------ model loading */
const modelCache = new Map();
function b64ToArrayBuffer(dataUri) { const b64 = dataUri.slice(dataUri.indexOf(',') + 1); const buf = Buffer.from(b64, 'base64'); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }
function parseGLB(arrayBuffer) {
  return new Promise((res, rej) => { const l = new THREE.GLTFLoader(); if (THREE.MeshoptDecoder) l.setMeshoptDecoder(THREE.MeshoptDecoder); l.parse(arrayBuffer, '', g => res(g.scene), e => rej(e instanceof Error ? e : new Error(String(e && e.message || e)))); });
}
async function loadModel(name) {
  if (modelCache.has(name)) return modelCache.get(name);
  let p;
  if (A3D.builders[name]) p = Promise.resolve(A3D.builders[name](THREE, {}));
  else if (A3D.models[name]) {
    const src = A3D.models[name];
    if (/^data:/.test(src)) p = parseGLB(b64ToArrayBuffer(src));
    else { const f = resolve(dirname(guidePath), src); p = existsSync(f) ? parseGLB(new Uint8Array(readFileSync(f)).buffer) : Promise.reject(new Error(`file not found: ${src}`)); }
  } else p = Promise.reject(new Error(`no model named "${name}"`));
  modelCache.set(name, p); return p;
}
function partNames(root) { const n = []; root.traverse(o => { if (o !== root && o.name && !n.includes(o.name)) n.push(o.name); }); return n; }
const globRe = p => new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

/* ------------------------------------------------------------------ fit check (clashes, floating parts, seated posts) */
function closestOnTri(px, py, pz, t, o) {           // Ericson, Real-Time Collision Detection 5.1.5; t = Float64Array, o = offset
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [ax + v * abx, ay + v * aby, az + v * abz]; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [ax + w * acx, ay + w * acy, az + w * acz]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}
function buildPart(obj) {
  const tris = [], solid = [], v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const g = m.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, M = m.matrixWorld, pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M); pts[3 * i] = v.x; pts[3 * i + 1] = v.y; pts[3 * i + 2] = v.z; }
    let vol = 0; const bb = new THREE.Box3();
    for (let i = 0; i < n; i += 3) {
      const a = 3 * i; vol += (pts[a] * (pts[a + 4] * pts[a + 8] - pts[a + 5] * pts[a + 7]) - pts[a + 1] * (pts[a + 3] * pts[a + 8] - pts[a + 5] * pts[a + 6]) + pts[a + 2] * (pts[a + 3] * pts[a + 7] - pts[a + 4] * pts[a + 6])) / 6;
      bb.expandByPoint(v.set(pts[a], pts[a + 1], pts[a + 2]));
    }
    const s = bb.getSize(new THREE.Vector3()), bbVol = Math.max(s.x * s.y * s.z, 1e-30);
    const isSolid = Math.abs(vol) > 0.02 * bbVol, flip = vol < 0;      // open surfaces (labels, sheets) can't contain points
    for (let i = 0; i < n; i += 3) {
      const a = 3 * i;
      if (flip) tris.push(pts[a], pts[a + 1], pts[a + 2], pts[a + 6], pts[a + 7], pts[a + 8], pts[a + 3], pts[a + 4], pts[a + 5]);
      else for (let k = 0; k < 9; k++) tris.push(pts[a + k]);
      solid.push(isSolid ? 1 : 0);
    }
  });
  const T = new Float64Array(tris), nt = solid.length, box = new THREE.Box3();
  for (let i = 0; i < T.length; i += 3) box.expandByPoint(v.set(T[i], T[i + 1], T[i + 2]));
  // uniform grid for fast nearest-triangle queries
  const size = box.getSize(new THREE.Vector3()), cell = Math.max(size.length() / 18, 1e-9);
  const dims = [0, 1, 2].map(k => Math.max(1, Math.ceil(size.getComponent(k) / cell)));
  const grid = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  const cellOf = (x, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((x - box.min.getComponent(k)) / cell)));
  for (let t = 0; t < nt; t++) {
    const o = 9 * t; let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let q = 0; q < 3; q++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], T[o + 3 * q + k]); hi[k] = Math.max(hi[k], T[o + 3 * q + k]); }
    const a = lo.map((x, k) => cellOf(x, k)), b = hi.map((x, k) => cellOf(x, k));
    for (let i = a[0]; i <= b[0]; i++) for (let j = a[1]; j <= b[1]; j++) for (let k = a[2]; k <= b[2]; k++) { const h = key(i, j, k); let L = grid.get(h); if (!L) grid.set(h, L = []); L.push(t); }
  }
  return { name: obj.name || '(unnamed)', obj, T, solid, nt, box, cell, dims, grid, key, cellOf, stamp: new Uint32Array(nt), stampN: 0 };
}
function nearest(P, x, y, z, maxR) {               // → { d, cx, cy, cz, tri } or null within maxR
  let best = null, bd = maxR * maxR; P.stampN++;
  const r = maxR, a = [x - r, y - r, z - r].map((v, k) => P.cellOf(v, k)), b = [x + r, y + r, z + r].map((v, k) => P.cellOf(v, k));
  for (let i = a[0]; i <= b[0]; i++) for (let j = a[1]; j <= b[1]; j++) for (let k = a[2]; k <= b[2]; k++) {
    const L = P.grid.get(P.key(i, j, k)); if (!L) continue;
    for (const t of L) { if (P.stamp[t] === P.stampN) continue; P.stamp[t] = P.stampN;
      const c = closestOnTri(x, y, z, P.T, 9 * t), dx = c[0] - x, dy = c[1] - y, dz = c[2] - z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = { d: Math.sqrt(d2), cx: c[0], cy: c[1], cz: c[2], tri: t }; } }
  }
  return best;
}
function samplePoints(P, count) {                  // area-weighted surface samples + vertices (deterministic)
  const pts = [], areas = new Float64Array(P.nt); let total = 0, seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < P.nt; t++) { const o = 9 * t, T = P.T;
    const ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], wx = T[o + 6] - T[o], wy = T[o + 7] - T[o + 1], wz = T[o + 8] - T[o + 2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx; total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2; areas[t] = total; }
  for (let s = 0; s < count && total > 0; s++) {
    const r = rnd() * total; let lo = 0, hi = P.nt - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < r) lo = mid + 1; else hi = mid; }
    let u = rnd(), w = rnd(); if (u + w > 1) { u = 1 - u; w = 1 - w; } const o = 9 * lo, T = P.T;
    pts.push([T[o] + u * (T[o + 3] - T[o]) + w * (T[o + 6] - T[o]), T[o + 1] + u * (T[o + 4] - T[o + 1]) + w * (T[o + 7] - T[o + 1]), T[o + 2] + u * (T[o + 5] - T[o + 2]) + w * (T[o + 8] - T[o + 2])]);
  }
  const stride = Math.max(1, Math.floor(P.nt / 300));
  for (let t = 0; t < P.nt; t += stride) for (let q = 0; q < 3; q++) pts.push([P.T[9 * t + 3 * q], P.T[9 * t + 3 * q + 1], P.T[9 * t + 3 * q + 2]]);
  return pts;
}
function triNormal(P, t) {
  const o = 9 * t, T = P.T, ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], wx = T[o + 6] - T[o], wy = T[o + 7] - T[o + 1], wz = T[o + 8] - T[o + 2];
  return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
}
function fitCheck(modelName, root, partObjs, qa) {
  root.updateMatrixWorld(true);
  const modelBox = new THREE.Box3().setFromObject(root), diag = modelBox.getSize(new THREE.Vector3()).length();
  const tol = (qa.tolerance ?? 0.0015) * diag;          // ≈0.5 mm on a 330 mm drone; scales with model units
  const fmt = d => { const mm = diag > 5 ? d : d * 1000; return (mm < 10 ? mm.toFixed(1) : mm.toFixed(0)) + (diag > 5 ? ' mm' : ' mm (model is in metres)'); };
  const allow = (qa.allow || []).map(pair => pair.map(globRe)), floatOK = (qa.floatingOK || []).map(globRe), ignore = (qa.ignore || []).map(globRe);
  const allowed = (a, b) => allow.some(([x, y]) => (x.test(a) && y.test(b)) || (x.test(b) && y.test(a)));
  const parts = partObjs.filter(o => !ignore.some(r => r.test(o.name))).map(buildPart).filter(P => P.nt > 0);
  const contact = new Map(parts.map(P => [P, []]));
  const near = (A, B, pad) => A.box.clone().expandByScalar(pad).intersectsBox(B.box);
  let clashes = 0;
  for (let i = 0; i < parts.length; i++) for (let j = 0; j < parts.length; j++) {
    if (i === j) continue; const A = parts[i], B = parts[j];
    if (!near(A, B, tol * 2)) continue;
    const pts = samplePoints(A, 1200); let touching = false, inside = 0, deepest = 0, where = null;
    for (const [x, y, z] of pts) {
      if (!B.box.clone().expandByScalar(tol * 2).containsPoint(new THREE.Vector3(x, y, z))) continue;
      const nb = nearest(B, x, y, z, Math.max(tol * 2, B.cell * 0.5)) || (B.box.containsPoint(new THREE.Vector3(x, y, z)) ? nearest(B, x, y, z, B.box.getSize(new THREE.Vector3()).length()) : null);
      if (!nb) continue;
      if (nb.d <= tol) { touching = true; continue; }
      if (!B.solid[nb.tri] || !B.box.containsPoint(new THREE.Vector3(x, y, z))) continue;
      const n = triNormal(B, nb.tri);
      if ((x - nb.cx) * n[0] + (y - nb.cy) * n[1] + (z - nb.cz) * n[2] < 0) { inside++; if (nb.d > deepest) { deepest = nb.d; where = [x, y, z]; } touching = true; }
    }
    if (touching) contact.get(A).push(B.name);
    if (inside >= 3 && deepest > tol && !allowed(A.name, B.name)) {
      const key = [A.name, B.name].sort().join('|');
      if (!fitCheck.seen) fitCheck.seen = new Set();
      if (!fitCheck.seen.has(modelName + key)) {
        fitCheck.seen.add(modelName + key); clashes++;
        ERR('FIT-CLASH', `model "${modelName}": ${A.name} × ${B.name}`, `"${A.name}" overlaps "${B.name}" by up to ${fmt(deepest)} (near x=${where.map(v => +v.toFixed(diag > 5 ? 1 : 4)).join(', ')})`,
          `Real CAD: do NOT move parts in the guide. Tell the person who owns the CAD that these two parts interfere. If the overlap is intended (shaft in a hub, screw in a hole, press fit), add ["${A.name}", "${B.name}"] to GUIDE.settings.qa.allow. Procedural/placeholder models: move one part apart by at least ${fmt(deepest + tol)}.`);
      }
    }
  }
  let floats = 0;
  parts.forEach(A => {
    if (contact.get(A).length || floatOK.some(r => r.test(A.name)) || parts.length < 2) return;
    // also count allowed pairs as contact
    if (parts.some(B => B !== A && allowed(A.name, B.name) && near(A, B, tol * 2))) return;
    let gap = Infinity, who = '';
    const pts = samplePoints(A, 300);
    parts.forEach(B => { if (B === A || !near(A, B, diag * 0.25)) return; for (const [x, y, z] of pts) { const nb = nearest(B, x, y, z, diag * 0.25); if (nb && nb.d < gap) { gap = nb.d; who = B.name; } } });
    floats++;
    ERR('FIT-FLOAT', `model "${modelName}": ${A.name}`, `"${A.name}" touches nothing${who ? ` (nearest: "${who}", ${fmt(gap)} away)` : ''}`,
      `Real CAD: check the part is mated/constrained in the CAD assembly before export. If it legitimately hangs free (e.g. a battery lead), add "${A.name}" to GUIDE.settings.qa.floatingOK. Procedural/placeholder models: move it ${who ? `by about ${fmt(gap)} so it touches "${who}"` : 'so it rests on another part'}.`);
  });
  // posts/standoffs must be seated at both ends
  let posts = 0;
  root.traverse(m => {
    if (!m.isMesh || !/standoff|(^|_)post\d*$|spacer/i.test(m.name)) return;
    const g = m.geometry; g.computeBoundingBox(); const bb = g.boundingBox, h = bb.max.y, r = (bb.max.x - bb.min.x) / 2 * 0.8, cxl = (bb.max.x + bb.min.x) / 2, czl = (bb.max.z + bb.min.z) / 2;
    const own = parts.find(P => { let f = false; P.obj.traverse(x => { if (x === m) f = true; }); return f; });
    // candidates: every other part, plus the post's own part's other pieces (an ESC post seats on the ESC board)
    const cands = parts.filter(P => P !== own);
    if (own) own.obj.traverse(x => { if (x.isMesh && x !== m && !/standoff|(^|_)post\d*$|spacer/i.test(x.name)) { if (!x.userData.qaPart) x.userData.qaPart = buildPart(x); cands.push(x.userData.qaPart); } });
    [bb.min.y, h].forEach((y, k) => {
      let best = Infinity, who = '';
      for (let a = 0; a < 6; a++) {
        const p = new THREE.Vector3(cxl + Math.cos(a * Math.PI / 3) * r, y, czl + Math.sin(a * Math.PI / 3) * r).applyMatrix4(m.matrixWorld);
        cands.forEach(P => { const nb = nearest(P, p.x, p.y, p.z, tol * 6); if (nb && nb.d < best) { best = nb.d; who = P.name; } });
      }
      if (best > tol) { posts++; ERR('FIT-POST', `model "${modelName}": ${m.name}`, `${k ? 'top' : 'bottom'} end of "${m.name}" isn't seated on anything${isFinite(best) ? ` (${fmt(best)} from "${who}")` : ''}`,
        'Standoffs and posts must touch a part at both ends. Real CAD: fix the mate. Procedural models: adjust its length or position.'); }
    });
  });
  checksRun.push({ check: `Fit: ${modelName}`, detail: `${parts.length} parts, tolerance ${fmt(tol)}`, ok: !clashes && !floats && !posts, counts: { clashes, floating: floats, posts } });
}
function selectParts(root, animated) {              // parts that move in animations, plus the model's other top-level pieces
  let base = root; while (base.children.length === 1 && !base.isMesh) base = base.children[0];
  const animSet = new Set(animated);
  const hasAnimBelow = o => { let f = false; o.traverse(x => { if (x !== o && animSet.has(x)) f = true; }); return f; };
  const expand = o => animSet.has(o) ? [o] : hasAnimBelow(o) ? o.children.flatMap(expand) : [o];
  return base.children.flatMap(expand).filter(o => { let mesh = false; o.traverse(x => { if (x.isMesh) mesh = true; }); return mesh; });
}
function modelHygiene(name, root, fileForSize) {
  let tris = 0, unnamed = 0, white = new Set(), lights = 0;
  root.traverse(o => {
    if (o.isLight || o.isCamera) lights++;
    if (!o.isMesh) return; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (!o.name) unnamed++;
    [].concat(o.material).forEach(m => { if (m && m.color && !m.map && m.color.r > 0.97 && m.color.g > 0.97 && m.color.b > 0.97 && !(o.userData && o.userData.preset)) white.add(m.name || o.name || '(unnamed)'); });
  });
  const dup = []; const seen = {}; root.traverse(o => { if (o.name) { seen[o.name] = (seen[o.name] || 0) + 1; if (seen[o.name] === 2) dup.push(o.name); } });
  if (tris > 400000) ERR('MODEL-HEAVY', `model "${name}"`, `${Math.round(tris).toLocaleString()} triangles is far too heavy for phones`, 'Shrink it (see "Shrinking a heavy model" in ASSEMBLY_ANIMATION_GUIDE.md) or export from CAD at a coarser resolution.');
  else if (tris > 100000) WARN('MODEL-HEAVY', `model "${name}"`, `${Math.round(tris).toLocaleString()} triangles may stutter on phones`, 'Aim for under ~50k: see "Shrinking a heavy model" in ASSEMBLY_ANIMATION_GUIDE.md.');
  if (fileForSize && existsSync(fileForSize)) { const mb = statSync(fileForSize).size / 1e6; if (mb > 8) WARN('MODEL-SIZE', `model "${name}"`, `${mb.toFixed(1)} MB file is slow to open`, 'Shrink it to under ~5 MB (weld + prune + meshopt keeps part names).'); }
  if (white.size) WARN('MODEL-WHITE', `model "${name}"`, `${white.size} material(s) render plain white: ${[...white].slice(0, 6).join(', ')}`, 'Usually a lost texture. Give them a base colour in CAD, or use a material preset in the animation config (materials: { "part": "plastic" }).');
  if (lights) WARN('MODEL-LIGHTS', `model "${name}"`, `contains ${lights} light/camera node(s) from the CAD scene`, 'Harmless (the player ignores them) but remove them from the export to keep the file clean.');
  if (unnamed > 3) WARN('MODEL-NAMES', `model "${name}"`, `${unnamed} unnamed parts can't be animated`, 'Name the parts in CAD before export (one name per physical part).');
  if (dup.length) WARN('MODEL-NAMES', `model "${name}"`, `duplicate part names: ${dup.slice(0, 8).join(', ')}`, 'Only the first part with each name can be animated. Make names unique in CAD.');
  return tris;
}

/* ------------------------------------------------------------------ guide checks */
const STEP_KEYS = ['id', 'title', 'time', 'level', 'warnings', 'media', 'body', 'details', 'diagram', 'diagrams', 'live', 'checks', 'checklistFrom', 'gate', 'troubleshoot', 'links', 'verify'];
const PHASE_KEYS = ['id', 'title', 'icon', 'summary', 'steps'];
const META_KEYS = ['id', 'title', 'drone', 'organization', 'support', 'version', 'updated', 'placeholder'];
const SETTINGS_KEYS = ['requireChecks', 'allowSkip', 'stickMode', 'rcMap', 'cells', 'models', 'partGroups', 'assetsBase', 'qa'];
const PART_KEYS = ['id', 'name', 'qty', 'image', 'note', 'group'];
const DIAGRAMS = ['quadX', 'wiring', 'vtx', 'sticks', 'parts', 'assembly3d'];
const LIVE = ['link', 'heartbeat', 'rc', 'sticks', 'attitude', 'gps', 'battery', 'messages'];
const AUTO = ['link', 'px4', 'disarmed', 'rc', 'attitude', 'gps3d', 'battery'];
const RICH_KEYS = ['ol', 'h', 'note', 'code', 'table', 'copy'];
function similar(word, list) {
  const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return m[a.length][b.length]; };
  let best = null, bd = Infinity; list.forEach(w => { const x = d(String(word), w); if (x < bd) { bd = x; best = w; } }); return bd <= Math.max(2, String(word).length / 3) ? best : null;
}
function keysCheck(obj, allowed, where) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  Object.keys(obj).forEach(k => { if (!allowed.includes(k)) { const s = similar(k, allowed); ERR('GUIDE-KEY', where, `unknown field "${k}" (it would be silently ignored)`, s ? `Did you mean "${s}"?` : `Allowed fields: ${allowed.join(', ')}.`); } });
}
function existsExactCase(absPath) {                 // catches "Photo.JPG" vs "photo.jpg": works on Windows/macOS, breaks on web servers
  if (!existsSync(absPath)) {                       // case-sensitive disk: look for a match with different capitals
    let cur = ROOT; const fixed = [];
    for (const p of relative(ROOT, absPath).split(sep)) {
      if (p === '..') { cur = resolve(cur, '..'); fixed.push(p); continue; }
      if (!existsSync(cur) || !statSync(cur).isDirectory()) return { ok: false };
      const real = readdirSync(cur).find(e => e.toLowerCase() === p.toLowerCase()); if (!real) return { ok: false };
      fixed.push(real); cur = join(cur, real);
    }
    return { ok: false, caseOf: fixed.join('/') };
  }
  const parts = relative(ROOT, absPath).split(sep); let cur = ROOT;
  for (const p of parts) { if (p === '..') { cur = resolve(cur, '..'); continue; } const entries = readdirSync(cur); if (!entries.includes(p)) { const real = entries.find(e => e.toLowerCase() === p.toLowerCase()); return { ok: false, caseOf: real }; } cur = join(cur, p); }
  return { ok: true };
}
function checkLocalFile(src, where, what) {
  if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
  const abs = resolve(dirname(guidePath), src), r = existsExactCase(abs);
  if (r.ok) return;
  if (r.caseOf) ERR('GUIDE-FILE-CASE', where, `${what} "${src}" exists only with different capitals ("${r.caseOf}")`, `Change the path to match exactly. It works on Windows/macOS but breaks on web servers.`);
  else ERR('GUIDE-FILE', where, `${what} "${src}" does not exist`, `Put the file at ${rel(abs)} (next to index.html), or fix the path. Leave src: "" to show a placeholder instead.`);
}
async function checkGuide() {
  if (!existsSync(guidePath)) { ERR('GUIDE-MISSING', rel(guidePath), 'guide file not found', 'Run QA from the repository folder, or pass the path: node tools/qa.mjs path/to/index.html'); return; }
  const html = readFileSync(guidePath, 'utf8');
  const at = html.indexOf('const GUIDE = {');
  if (at < 0) { ERR('GUIDE-SYNTAX', rel(guidePath), 'could not find "const GUIDE = {"', 'The content block must start with exactly: const GUIDE = {'); return; }
  const open = html.lastIndexOf('<script', at), codeStart = html.indexOf('>', open) + 1, codeEnd = html.indexOf('</script>', at);
  const code = html.slice(codeStart, codeEnd), lineOffset = html.slice(0, codeStart).split('\n').length - 1;
  let GUIDE;
  try { GUIDE = vm.runInThisContext('(function(){' + code + '\n;return GUIDE;})()', { filename: 'GUIDE' }); }
  catch (e) {
    const m = String(e.stack).match(/GUIDE:(\d+)/), line = m ? +m[1] + lineOffset : null, text = line ? html.split('\n')[line - 1] : '';
    const curly = /[“”‘’]/.test(code) ? ' The block contains curly quotes (“ ” ‘ ’). Replace them with straight quotes " and \'.' : '';
    ERR('GUIDE-SYNTAX', `${rel(guidePath)}${line ? ' line ' + line : ''}`, `JavaScript error in the GUIDE block: ${e.message}${text ? ` → ${text.trim().slice(0, 120)}` : ''}`,
      `Usually a missing comma between items, a missing closing quote/bracket, or an extra comma.${curly} The error is on this line or the line just before it.`);
    checksRun.push({ check: 'Guide syntax', ok: false }); return;
  }
  checksRun.push({ check: 'Guide syntax', ok: true });
  const before = findings.filter(f => f.level === 'error').length;
  const meta = GUIDE.meta || {}, settings = GUIDE.settings || {};
  keysCheck(meta, META_KEYS, 'GUIDE.meta'); keysCheck(settings, SETTINGS_KEYS, 'GUIDE.settings');
  if (settings.qa) {                                 // the allow-lists themselves must be well-formed
    const qa = settings.qa, pairOK = v => Array.isArray(v) && v.every(p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string'));
    const checkQA = (q, w) => { keysCheck(q, ['allow', 'floatingOK', 'ignore', 'tolerance', 'models'], w);
      if (q.allow != null && !pairOK(q.allow)) ERR('QA-CONFIG', `${w}.allow`, 'must be a list of pairs', 'Example: allow: [["motor*", "prop*"]].');
      ['floatingOK', 'ignore'].forEach(k => { if (q[k] != null && !(Array.isArray(q[k]) && q[k].every(x => typeof x === 'string'))) ERR('QA-CONFIG', `${w}.${k}`, 'must be a list of part names', `Example: ${k}: ["battery_lead"].`); });
      if (q.tolerance != null && !(typeof q.tolerance === 'number' && q.tolerance > 0 && q.tolerance < 0.05)) ERR('QA-CONFIG', `${w}.tolerance`, 'must be a small number (fraction of model size)', 'Leave it out (default 0.0015), or use e.g. 0.003.'); };
    checkQA(qa, 'GUIDE.settings.qa');
    Object.entries(qa.models || {}).forEach(([m, q]) => checkQA(q, `GUIDE.settings.qa.models["${m}"]`));
  }
  if (meta.placeholder) WARN('GUIDE-TEMPLATE', 'GUIDE.meta.placeholder', 'is true, so the "Template content" ribbon still shows', 'Set placeholder: false once the real materials are in.');
  ['drone', 'support', 'organization'].forEach(k => { if (!meta[k] || /^\[.*\]$/.test(meta[k])) WARN('GUIDE-META', `GUIDE.meta.${k}`, `is still a placeholder (${JSON.stringify(meta[k] || '')})`, `Fill in the real ${k}.`); });
  // glossary
  const gloss = Object.fromEntries(Object.keys(GUIDE.glossary || {}).map(k => [k.toLowerCase(), k]));
  const inline = (txt, where, inCopy) => {
    if (typeof txt !== 'string') { ERR('GUIDE-TEXT', where, `expected text, got ${Array.isArray(txt) ? 'a list' : typeof txt}`, 'Use a string in quotes here.'); return; }
    for (const m of txt.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) if (!gloss[m[1].toLowerCase().trim()]) {
      const s = similar(m[1], Object.keys(GUIDE.glossary || {})); ERR('GUIDE-GLOSSARY', where, `[[${m[1]}]] is not in GUIDE.glossary`, s ? `Did you mean [[${s}]]? Otherwise add "${m[1]}": "plain-English definition" to GUIDE.glossary.` : `Add "${m[1]}": "plain-English definition" to GUIDE.glossary, or remove the [[ ]].`); }
    for (const m of txt.matchAll(/\{\{([\w.]+)\}\}/g)) if (!['drone', 'support', 'vtx'].includes(m[1]) && !(inCopy && /^f\.\w+$/.test(m[1]))) WARN('GUIDE-TOKEN', where, `unknown token {{${m[1]}}}`, 'Allowed: {{drone}}, {{support}}, {{vtx}} (and {{f.field}} inside copy blocks).');
    for (const m of txt.matchAll(/\]\(\s*javascript:/gi)) ERR('GUIDE-LINK', where, 'javascript: links are not allowed', 'Use an https:// link.');
    if (/[“”]/.test(txt) && /\[\[|\{\{/.test(txt)) WARN('GUIDE-TEXT', where, 'curly quotes next to markup', 'Use straight quotes.');
  };
  const copyIds = new Set();
  const rich = (b, where) => {
    if (b == null || b === '') return;
    if (typeof b === 'string') return inline(b, where);
    const items = Array.isArray(b) ? b : [b];
    items.forEach((it, i) => {
      const w = `${where}[${i}]`;
      if (typeof it === 'string') return inline(it, w);
      if (Array.isArray(it)) return it.forEach((li, j) => inline(li, `${w}[${j}]`));
      if (!it || typeof it !== 'object') return ERR('GUIDE-TEXT', w, `unsupported item ${JSON.stringify(it)}`, 'Use "text", ["bullet", ...], {ol:[...]}, {h:"..."}, {note:"..."}, {code:"..."}, {table:[[...]]} or {copy:{...}}.');
      const k = Object.keys(it); const known = k.filter(x => RICH_KEYS.includes(x));
      if (known.length !== 1) { const s = similar(k[0] || '', RICH_KEYS); return ERR('GUIDE-TEXT', w, `object with ${k.length ? 'fields ' + k.join(', ') : 'no fields'} is not a known block`, (s ? `Did you mean {${s}: ...}? ` : '') + 'Blocks: {ol:[...]}, {h:"..."}, {note:"..."}, {code:"..."}, {table:[[...]]}, {copy:{...}}.'); }
      const key = known[0], val = it[key];
      if (key === 'ol') return Array.isArray(val) ? val.forEach((li, j) => inline(li, `${w}.ol[${j}]`)) : ERR('GUIDE-TEXT', w, '"ol" must be a list', 'Example: {ol: ["first", "second"]}.');
      if (key === 'h' || key === 'note') return inline(val, `${w}.${key}`);
      if (key === 'table') { if (!Array.isArray(val) || !val.every(Array.isArray)) return ERR('GUIDE-TEXT', w, '"table" must be a list of rows', 'Example: {table: [["Header", "Header"], ["cell", "cell"]]}.');
        const n = val[0].length; val.forEach((row, r) => { if (row.length !== n) WARN('GUIDE-TABLE', `${w}.table[${r}]`, `row has ${row.length} cells, header has ${n}`, 'Give every row the same number of cells.'); row.forEach((c, j) => inline(String(c), `${w}.table[${r}][${j}]`)); }); return; }
      if (key === 'copy') {
        const c = val || {}; keysCheck(c, ['id', 'label', 'fields', 'text'], `${w}.copy`);
        if (!c.id) ERR('GUIDE-COPY', `${w}.copy`, 'has no "id"', 'Add a unique id, e.g. id: "qgc-ticket".'); else if (copyIds.has(c.id)) ERR('GUIDE-COPY', `${w}.copy`, `duplicate id "${c.id}"`, 'Each copy block needs its own id.'); else copyIds.add(c.id);
        const fkeys = (c.fields || []).map(f => f.key); (c.fields || []).forEach((f, j) => { keysCheck(f, ['key', 'label', 'options'], `${w}.copy.fields[${j}]`); if (!f.key || !f.label) ERR('GUIDE-COPY', `${w}.copy.fields[${j}]`, 'needs "key" and "label"', 'Example: { key: "name", label: "Your name" }.'); });
        [].concat(c.text || []).forEach((line, j) => { inline(line, `${w}.copy.text[${j}]`, true); for (const m of String(line).matchAll(/\{\{f\.(\w+)\}\}/g)) if (!fkeys.includes(m[1])) ERR('GUIDE-COPY', `${w}.copy.text[${j}]`, `{{f.${m[1]}}} has no matching field`, `Add { key: "${m[1]}", label: "..." } to fields, or fix the name. Fields: ${fkeys.join(', ') || '(none)'}.`); });
      }
    });
  };
  // parts list
  const partIds = new Set();
  (GUIDE.parts || []).forEach((p, i) => {
    const w = `GUIDE.parts[${i}]${p && p.id ? ` (${p.id})` : ''}`; keysCheck(p, PART_KEYS, w);
    if (!p.id) ERR('GUIDE-PART', w, 'has no "id"', 'Add a short unique id like "motors".'); else if (partIds.has(p.id)) ERR('GUIDE-PART', w, `duplicate id "${p.id}"`, 'Make part ids unique.'); else partIds.add(p.id);
    if (!p.name) ERR('GUIDE-PART', w, 'has no "name"', 'Add the name printed on the packaging.');
    if (typeof p.qty !== 'number' || p.qty < 1) ERR('GUIDE-PART', w, `"qty" must be a number ≥ 1 (got ${JSON.stringify(p.qty)})`, 'Write qty: 4 (no quotes).');
    if (p.group && settings.partGroups && !settings.partGroups[p.group]) WARN('GUIDE-PART', w, `group "${p.group}" has no heading in GUIDE.settings.partGroups`, `Add ${p.group}: "Heading text" to partGroups.`);
    checkLocalFile(p.image, w, 'image');
  });
  const noPhoto = (GUIDE.parts || []).filter(p => !p.image).map(p => p.id);
  if (noPhoto.length) WARN('GUIDE-PHOTO', 'GUIDE.parts', `${noPhoto.length} item(s) have no photo: ${noPhoto.slice(0, 10).join(', ')}${noPhoto.length > 10 ? ', …' : ''}`, 'Readers tap photos to confirm each item. Add image: "img/parts/<id>.jpg" for every item.');
  // models used by the guide
  (settings.models || []).forEach((m, i) => {
    const r = existsExactCase(resolve(dirname(guidePath), (settings.assetsBase || '') + m));
    if (!r.ok) { ERR('MODEL-FILE', `GUIDE.settings.models[${i}]`, r.caseOf ? `"${m}" exists only as "${r.caseOf}"` : `"${m}" does not exist`, 'Fix the path, or create it with tools/glb-to-js.mjs.'); return; }
    try { runFile(resolve(dirname(guidePath), (settings.assetsBase || '') + m)); } catch (e) { ERR('MODEL-FILE', `GUIDE.settings.models[${i}]`, `"${m}" has an error: ${e.message}`, 'Regenerate it with tools/glb-to-js.mjs.'); }
  });
  // phases & steps
  const ids = new Map(); const diagramsByModel = new Map(); let stepCount = 0, verifies = [];
  (GUIDE.phases || []).forEach((ph, pi) => {
    const pw = `phase ${pi + 1}${ph && ph.title ? ` ("${ph.title}")` : ''}`; keysCheck(ph, PHASE_KEYS, pw);
    if (!Array.isArray(ph.steps) || !ph.steps.length) ERR('GUIDE-PHASE', pw, 'has no steps', 'Add steps: [ {...} ] or remove the phase.');
    if (ph.summary) rich(ph.summary, `${pw}.summary`);
    (ph.steps || []).forEach((s, si) => {
      stepCount++;
      const w = `step "${s && s.id || '?'}" (${pw}, step ${si + 1})`;
      if (!s || typeof s !== 'object') return ERR('GUIDE-STEP', w, 'is not an object', 'Each step must be { id: "...", title: "...", ... }.');
      keysCheck(s, STEP_KEYS, w);
      if (!s.id) ERR('GUIDE-STEP', w, 'has no "id"', 'Add a unique id in lowercase-with-dashes.');
      else { if (ids.has(s.id)) ERR('GUIDE-STEP', w, `duplicate id "${s.id}" (also ${ids.get(s.id)})`, 'Step ids must be unique: rename one of them.'); else ids.set(s.id, w);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id)) WARN('GUIDE-STEP', w, `id "${s.id}" should be lowercase-with-dashes`, 'Ids appear in links (index.html#id).'); }
      if (!s.title) ERR('GUIDE-STEP', w, 'has no "title"', 'Add a short title starting with a verb.');
      if (s.level && !['easy', 'medium', 'hard'].includes(s.level)) WARN('GUIDE-STEP', w, `level "${s.level}" is not easy/medium/hard`, 'Use easy, medium or hard.');
      (s.warnings || []).forEach((x, i) => { keysCheck(x, ['level', 'text'], `${w}.warnings[${i}]`); if (!['danger', 'caution', 'tip', 'info'].includes(x.level)) WARN('GUIDE-STEP', `${w}.warnings[${i}]`, `level "${x.level}" is not danger/caution/tip/info`, 'Use danger, caution, tip or info.'); rich(x.text, `${w}.warnings[${i}].text`); });
      (s.media || []).forEach((m, i) => { keysCheck(m, ['type', 'src', 'alt', 'caption'], `${w}.media[${i}]`); if (m.type && !['image', 'video'].includes(m.type)) WARN('GUIDE-STEP', `${w}.media[${i}]`, `type "${m.type}"`, 'Use "image" or "video".'); checkLocalFile(m.src, `${w}.media[${i}]`, 'media file'); });
      rich(s.body, `${w}.body`); rich(s.details, `${w}.details`);
      if (s.gate) { keysCheck(s.gate, ['title', 'text', 'confirm'], `${w}.gate`); if (!s.gate.confirm) WARN('GUIDE-STEP', `${w}.gate`, 'has no "confirm" sentence', 'Add confirm: "I understand ..."'); rich(s.gate.text, `${w}.gate.text`); }
      (s.troubleshoot || []).forEach((t, i) => { keysCheck(t, ['q', 'a'], `${w}.troubleshoot[${i}]`); inline(t.q || '', `${w}.troubleshoot[${i}].q`); rich(t.a, `${w}.troubleshoot[${i}].a`); });
      (s.links || []).forEach((l, i) => { keysCheck(l, ['label', 'url'], `${w}.links[${i}]`); if (!/^https?:\/\//.test(l.url || '')) checkLocalFile(l.url, `${w}.links[${i}]`, 'linked file'); });
      (s.live || []).forEach(x => { if (!LIVE.includes(x)) { const sg = similar(x, LIVE); ERR('GUIDE-LIVE', w, `unknown live panel "${x}"`, (sg ? `Did you mean "${sg}"? ` : '') + `Panels: ${LIVE.join(', ')}.`); } });
      if (s.checklistFrom && s.checklistFrom !== 'parts') ERR('GUIDE-STEP', w, `checklistFrom "${s.checklistFrom}"`, 'The only value is "parts".');
      const checks = (s.checks || []).map(c => typeof c === 'string' ? { text: c } : c);
      checks.forEach((c, i) => { keysCheck(c, ['text', 'auto', 'id'], `${w}.checks[${i}]`); inline(c.text || '', `${w}.checks[${i}]`); if (c.auto && !AUTO.includes(c.auto)) { const sg = similar(c.auto, AUTO); ERR('GUIDE-AUTO', `${w}.checks[${i}]`, `unknown auto check "${c.auto}"`, (sg ? `Did you mean "${sg}"? ` : '') + `Auto checks: ${AUTO.join(', ')}.`); } });
      if (!checks.length && s.checklistFrom !== 'parts') ERR('GUIDE-CHECKS', w, 'has no checks, so readers can continue without confirming anything', 'Add checks: ["Something the reader can physically confirm"].');
      if (s.verify) verifies.push(`${s.id}: ${s.verify}`);
      const dgs = [...(s.diagram ? [s.diagram] : []), ...(s.diagrams || [])];
      dgs.forEach((d, di) => {
        const dw = `${w}.${s.diagram && di === 0 ? 'diagram' : `diagrams[${s.diagram ? di - 1 : di}]`}`;
        if (!d || !DIAGRAMS.includes(d.type)) { const sg = similar(d && d.type || '', DIAGRAMS); return ERR('GUIDE-DIAGRAM', dw, `unknown diagram type "${d && d.type}"`, (sg ? `Did you mean "${sg}"? ` : '') + `Types: ${DIAGRAMS.join(', ')}.`); }
        if (d.type === 'assembly3d') { if (!diagramsByModel.has(d.model)) diagramsByModel.set(d.model, []); diagramsByModel.get(d.model).push({ cfg: d, where: dw }); }
      });
    });
  });
  if (verifies.length) WARN('GUIDE-VERIFY', 'VERIFY notes', `${verifies.length} step(s) still have unresolved VERIFY notes`, 'Resolve each against the real materials, then delete the verify field:\n' + verifies.map(v => '    - ' + v).join('\n'));
  checksRun.push({ check: 'Guide content', detail: `${(GUIDE.phases || []).length} phases, ${stepCount} steps, ${(GUIDE.parts || []).length} parts`, ok: findings.filter(f => f.level === 'error').length === before });
  // animations + models
  for (const [model, list] of diagramsByModel) {
    const before2 = findings.filter(f => f.level === 'error').length;
    let root;
    try { root = await loadModel(model); }
    catch (e) {
      list.forEach(({ where }) => ERR('ANIM-MODEL', where, `model "${model}" can't be loaded: ${e.message}`, `Add the model's .js file to GUIDE.settings.models (registered models: ${[...Object.keys(A3D.builders), ...Object.keys(A3D.models)].join(', ') || 'none'}).`));
      checksRun.push({ check: `3D animations: ${model}`, ok: false }); continue;
    }
    const names = partNames(root), animated = [];
    list.forEach(({ cfg, where }) => {
      A3D.validate(cfg, names).forEach(x => (x.level === 'error' ? ERR : WARN)(x.level === 'error' ? 'ANIM-CONFIG' : 'ANIM-WARN', `${where} → ${x.where}`, x.msg, x.fix));
      (cfg.steps || []).forEach(st => { if (!st || !['insert', 'remove', 'move', undefined].includes(st.action) || !st.parts) return;
        [].concat(st.parts).forEach(p => { const re = globRe(p); root.traverse(o => { if (o !== root && re.test(o.name || '')) animated.push(o); }); }); });
    });
    const ok = findings.filter(f => f.level === 'error').length === before2;
    checksRun.push({ check: `3D animations: ${model}`, detail: `${list.length} animation(s), ${names.length} named parts`, ok });
    const fileForSize = A3D.models[model] && !/^data:/.test(A3D.models[model]) ? resolve(dirname(guidePath), A3D.models[model]) : (settings.models || []).map(m => resolve(dirname(guidePath), m)).find(f => readFileSync(f, 'utf8').includes(`[${JSON.stringify(model)}]`));
    const tris = modelHygiene(model, root, fileForSize);
    const qa = Object.assign({}, settings.qa || {}, ((settings.qa || {}).models || {})[model] || {});
    const anSet = [...new Set(animated)].filter(o => !animated.some(p => p !== o && isAncestor(p, o)));
    fitCheck(model, root, selectParts(root, anSet), qa);
    checksRun.find(c => c.check === `Fit: ${model}`).detail += `, ${Math.round(tris).toLocaleString()} triangles`;
  }
}
function isAncestor(a, b) { for (let x = b.parent; x; x = x.parent) if (x === a) return true; return false; }

/* ------------------------------------------------------------------ single-model mode */
function guideQA() {                                 // allow-lists from GUIDE.settings.qa also apply when checking one model
  try { const html = readFileSync(guidePath, 'utf8'), at = html.indexOf('const GUIDE = {'), open = html.lastIndexOf('<script', at), st = html.indexOf('>', open) + 1;
    const G = vm.runInThisContext('(function(){' + html.slice(st, html.indexOf('</script>', at)) + '\n;return GUIDE;})()'); return (G.settings && G.settings.qa) || {}; }
  catch (e) { return {}; }
}
async function checkModelFile(file) {
  const abs = resolve(file);
  if (!existsSync(abs)) { ERR('MODEL-FILE', file, 'does not exist', 'Check the path.'); return null; }
  let entries = [];
  if (/\.glb$/i.test(abs)) {
    const buf = readFileSync(abs);
    if (buf.readUInt32LE(0) !== 0x46546c67) { ERR('MODEL-FILE', rel(abs), 'is not a binary GLB', 'Export as GLB (binary glTF).'); return null; }
    const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    if ((json.extensionsUsed || []).includes('KHR_draco_mesh_compression')) { ERR('MODEL-DRACO', rel(abs), 'uses Draco compression, which the player cannot read', 'Re-export with Draco OFF (SolidWorks: Extended Reality export options). Meshopt or no compression is fine.'); return null; }
    entries.push([basename(abs).replace(/\.glb$/i, ''), () => parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))]);
  } else {
    const beforeB = new Set(Object.keys(A3D.builders)), beforeM = new Set(Object.keys(A3D.models));
    try { runFile(abs); } catch (e) { ERR('MODEL-FILE', rel(abs), `script error: ${e.message}`, 'Regenerate it with tools/glb-to-js.mjs.'); return null; }
    Object.keys(A3D.builders).filter(k => !beforeB.has(k)).forEach(k => entries.push([k, () => Promise.resolve(A3D.builders[k](THREE, {}))]));
    Object.keys(A3D.models).filter(k => !beforeM.has(k)).forEach(k => entries.push([k, () => loadModel(k)]));
    if (!entries.length) { ERR('MODEL-FILE', rel(abs), 'registers no model', 'Model files must be made by tools/glb-to-js.mjs (or define an ASSEMBLY_BUILDERS entry).'); return null; }
  }
  const gqa = guideQA();
  for (const [name, load] of entries) {
    let root; try { root = await load(); } catch (e) { ERR('MODEL-LOAD', name, `can't be read: ${e.message}`, 'Re-export the file as GLB.'); continue; }
    const tris = modelHygiene(name, root, abs);
    fitCheck(name, root, selectParts(root, []), Object.assign({}, gqa, (gqa.models || {})[name] || {}));
    checksRun.find(c => c.check === `Fit: ${name}`).detail += `, ${Math.round(tris).toLocaleString()} triangles`;
  }
}

/* ------------------------------------------------------------------ report */
function writeReport(title) {
  const errs = findings.filter(f => f.level === 'error'), warns = findings.filter(f => f.level === 'warning');
  const pass = errs.length === 0, when = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const item = (f, i) => `${i + 1}. **[${f.code}]** ${f.where}\n   - Problem: ${f.msg}\n   - Fix: ${f.fix}`;
  const md = [
    `# QA report: ${pass ? 'PASS ✅' : 'FAIL ❌'}`,
    '',
    `${title} · ${when} UTC · **${errs.length} error(s), ${warns.length} warning(s)**`,
    '',
    '| Check | Result | Details |', '|---|---|---|',
    ...checksRun.map(c => `| ${c.check} | ${c.ok ? '✅' : '❌'} | ${c.detail || ''} |`),
    '',
    ...(pass ? [] : [
      '## Instructions for the AI fixing this',
      '- Fix **every item under ERRORS**. Change only what each item says. Do not rename step ids, part names or files.',
      '- Keep every safety warning and safety gate.',
      '- **FIT errors on a real CAD model:** do not move or resize parts in the guide. Say which CAD parts need fixing, or (only if the fit is intended) add the pair to `GUIDE.settings.qa.allow`.',
      '- Return the **complete** updated file(s), not fragments.',
      '- Then fix warnings you can. List any you could not fix and why.',
      '',
      '## ERRORS (must fix)', '', ...errs.map(item), '']),
    ...(warns.length ? ['## WARNINGS (should fix)', '', ...warns.map(item), ''] : []),
    pass ? '_No errors. Warnings above are worth fixing but do not block._' : ''
  ].join('\n');
  writeFileSync(join(outDir, 'QA_REPORT.md'), md);
  writeFileSync(join(outDir, 'qa-report.json'), JSON.stringify({ pass, title, when, checks: checksRun, errors: errs, warnings: warns }, null, 2));
  const c = (s, n) => process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s;
  console.log('\n' + (pass ? c(' PASS ', '42;30') : c(' FAIL ', '41;97')) + `  ${title}: ${errs.length} error(s), ${warns.length} warning(s)\n`);
  checksRun.forEach(ch => console.log(`  ${ch.ok ? c('✓', 32) : c('✗', 31)} ${ch.check}${ch.detail ? c('  ' + ch.detail, 90) : ''}`));
  if (errs.length) { console.log('\n' + c('Errors:', 31)); errs.slice(0, 15).forEach((f, i) => console.log(`  ${i + 1}. [${f.code}] ${f.where}\n     ${f.msg}`)); if (errs.length > 15) console.log(`  … and ${errs.length - 15} more`); }
  console.log(`\nFull report: ${rel(join(outDir, 'QA_REPORT.md'))}${pass ? '' : '  ← paste this to the AI that edits the guide'}`);
  return pass;
}

/* ------------------------------------------------------------------ main */
(async () => {
  if (mode === 'list') {
    const name = opt('list-parts');
    if (existsSync(resolve(name))) { const b0 = new Set(Object.keys(A3D.builders)), m0 = new Set(Object.keys(A3D.models)); if (/\.glb$/i.test(name)) { const buf = readFileSync(resolve(name)); A3D.models.__file = 'data:;base64,' + buf.toString('base64'); } else runFile(resolve(name)); }
    else { const html = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : ''; const m = html.match(/models:\s*\[([^\]]*)\]/); if (m) [...m[1].matchAll(/"([^"]+)"/g)].forEach(x => { const f = resolve(dirname(guidePath), x[1]); if (existsSync(f)) runFile(f); }); }
    const key = A3D.builders[name] || A3D.models[name] ? name : (A3D.models.__file ? '__file' : Object.keys(A3D.models).concat(Object.keys(A3D.builders)).pop());
    try { const root = await loadModel(key); const lines = []; (function walk(o, d) { if (o.name) lines.push('  '.repeat(d) + o.name + (o.isMesh ? '' : '  (group)')); o.children.forEach(c => walk(c, d + (o.name ? 1 : 0))); })(root, 0); console.log(`Parts in "${name}":\n` + lines.join('\n')); }
    catch (e) { console.error(`Could not load "${name}": ${e.message}`); process.exit(2); }
    return;
  }
  if (mode === 'model') { await checkModelFile(modelArg); process.exit(writeReport(`Model check: ${rel(resolve(modelArg))}`) ? 0 : 1); }
  await checkGuide();
  process.exit(writeReport(`Guide check: ${rel(guidePath)}`) ? 0 : 1);
})().catch(e => { console.error('QA crashed: ' + (e && e.stack || e)); process.exit(2); });

#!/usr/bin/env node
/*
 * step-to-glb.mjs: convert a STEP (.step/.stp) CAD file into a GLB the assembly player can animate.
 * Each solid body / part becomes its own named node, with its pivot at the part's centre
 * (so "spin" rotates a motor or screw about itself, not about the drone).
 *
 * Usage:
 *   npm install occt-import-js            # one-time (OpenCascade STEP reader, LGPL-2.1; not shipped in this repo)
 *   node tools/step-to-glb.mjs drone.step drone.glb [--up z] [--front -x+y] [--deflection 0.001]
 *
 * Options:
 *   --up <axis>      Which axis is "up" in the CAD file. STEP exports are usually Z-up (default: z).
 *   --front <axes>   Which way the drone's FRONT points in the CAD file, in CAD axes, e.g. "+x", "-y", "-x+y"
 *                    (diagonal). Default: "+x". The output is rotated so up = +Y and front = -Z (the glTF
 *                    convention the guide expects), so "front", "left", "out" etc. work in animations.
 *   --deflection <r> Mesh fineness as a fraction of the model size (default 0.001; bigger = fewer triangles).
 *   --units <u>      Output units: mm (default) or m.
 *
 * Then wrap it for offline use and list the part names:
 *   node tools/glb-to-js.mjs drone.glb drone --out models/drone.glb.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > -1 ? args[i + 1] : d; };
const [inFile, outFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!inFile || !outFile) { console.log('Usage: node tools/step-to-glb.mjs <in.step> <out.glb> [--up z] [--front -x+y] [--deflection 0.001] [--units mm|m]'); process.exit(1); }

let occtFactory;
try { occtFactory = createRequire(import.meta.url)('occt-import-js'); }
catch (e) { console.error('Missing dependency. Run:  npm install occt-import-js'); process.exit(1); }

/* ---------- read STEP ---------- */
const stepBytes = readFileSync(inFile);
const occt = await occtFactory();
const res = occt.ReadStepFile(new Uint8Array(stepBytes), {
  linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: +opt('deflection', 0.001), angularDeflection: 0.5
});
if (!res.success) { console.error('Could not read the STEP file.'); process.exit(1); }

/* ---------- names: occt gives assembly/product names; many CAD tools (e.g. Fusion multi-body parts) only name the
   solid bodies, so fall back to the MANIFOLD_SOLID_BREP names in file order when the counts match ---------- */
const nameOfMesh = new Array(res.meshes.length).fill('');
(function walk(node, parentName) {
  (node.meshes || []).forEach(mi => { nameOfMesh[mi] = res.meshes[mi].name || ((node.meshes.length === 1 && node.name) ? node.name : ''); });
  (node.children || []).forEach(c => walk(c, c.name || parentName));
})(res.root, res.root.name);
const stepText = stepBytes.toString('latin1').replace(/[\r\n]/g, '');
const bodyNames = [...stepText.matchAll(/=\s*(?:MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS)\s*\(\s*'([^']*)'/g)].map(m => m[1]);
let recovered = false;
if (nameOfMesh.some(n => !n) && bodyNames.length === res.meshes.length && bodyNames.every(Boolean)) {
  nameOfMesh.forEach((n, i) => { if (!n) nameOfMesh[i] = bodyNames[i]; }); recovered = true;
}
const used = {};
const safe = nameOfMesh.map((n, i) => {
  let s = (n || 'part_' + (i + 1)).trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
  if (used[s] !== undefined) s += '_' + (++used[s]); else used[s] = 0;
  return s;
});

/* ---------- axes: build a rotation taking CAD (up, front) to glTF (+Y, -Z) ---------- */
const axisVec = s => {
  const v = [0, 0, 0]; let any = false;
  for (const m of String(s).toLowerCase().matchAll(/([+-]?)([xyz])/g)) { v['xyz'.indexOf(m[2])] += m[1] === '-' ? -1 : 1; any = true; }
  if (!any) throw new Error('Bad axis "' + s + '"'); const l = Math.hypot(...v); return v.map(c => c / l);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const up = axisVec(opt('up', 'z'));
let front = axisVec(opt('front', '+x'));
front = front.map((c, i) => c - dot(front, up) * up[i]); { const l = Math.hypot(...front); if (l < 1e-6) { console.error('--front must not be parallel to --up'); process.exit(1); } front = front.map(c => c / l); }
const right = cross(front, up);                    // CAD-space right
// output = R * input, rows: output X = right, output Y = up, output Z = -front
const R = [right, up, front.map(c => -c)];
const rot = p => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];
const scale = opt('units', 'mm') === 'm' ? 0.001 : 1;

/* ---------- build glTF ---------- */
const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gltf = { asset: { version: '2.0', generator: 'dronesim tools/step-to-glb.mjs' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
const chunks = []; let byteLen = 0;
const addView = (typed, target) => {
  const pad = (4 - (byteLen % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(bytes); gltf.bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: bytes.byteLength, target }); byteLen += bytes.byteLength;
  return gltf.bufferViews.length - 1;
};
const matIndex = new Map();
const material = color => {
  const c = color ? color.slice(0, 3) : [0.6, 0.6, 0.6], key = c.map(v => v.toFixed(3)).join(',');
  if (!matIndex.has(key)) {
    const lin = c.map(srgbToLinear), grey = Math.abs(c[0] - c[1]) < 0.02 && Math.abs(c[1] - c[2]) < 0.02;
    gltf.materials.push({ name: 'cad_' + key.replace(/,/g, '_'), pbrMetallicRoughness: { baseColorFactor: [...lin, 1], metallicFactor: grey && c[0] > 0.5 ? 0.6 : 0.05, roughnessFactor: 0.55 } });
    matIndex.set(key, gltf.materials.length - 1);
  }
  return matIndex.get(key);
};
gltf.nodes.push({ name: basename(inFile).replace(/\.(step|stp)$/i, '').replace(/[^\w.-]+/g, '_'), children: [] });
const report = [];
res.meshes.forEach((m, i) => {
  const src = m.attributes.position.array, nrm = m.attributes.normal ? m.attributes.normal.array : null, n = src.length / 3;
  const pos = new Float32Array(src.length), nor = nrm ? new Float32Array(nrm.length) : null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const p = rot([src[3 * k], src[3 * k + 1], src[3 * k + 2]]).map(v => v * scale);
    for (let a = 0; a < 3; a++) { pos[3 * k + a] = p[a]; mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
    if (nor) { const q = rot([nrm[3 * k], nrm[3 * k + 1], nrm[3 * k + 2]]); nor.set(q, 3 * k); }
  }
  const ctr = mn.map((v, a) => (v + mx[a]) / 2);                 // pivot at the part centre
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) pos[3 * k + a] -= ctr[a];
  const lmn = mn.map((v, a) => v - ctr[a]), lmx = mx.map((v, a) => v - ctr[a]);
  const idxSrc = m.index.array, idx = n > 65535 ? new Uint32Array(idxSrc) : new Uint16Array(idxSrc);
  const attrs = { POSITION: gltf.accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: lmn, max: lmx }) - 1 };
  if (nor) attrs.NORMAL = gltf.accessors.push({ bufferView: addView(nor, 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
  const ind = gltf.accessors.push({ bufferView: addView(idx, 34963), componentType: n > 65535 ? 5125 : 5123, count: idx.length, type: 'SCALAR' }) - 1;
  gltf.meshes.push({ name: safe[i], primitives: [{ attributes: attrs, indices: ind, material: material(m.color) }] });
  gltf.nodes.push({ name: safe[i], mesh: gltf.meshes.length - 1, translation: ctr });
  gltf.nodes[0].children.push(gltf.nodes.length - 1);
  report.push({ name: safe[i], tris: idx.length / 3, centre: ctr.map(v => +v.toFixed(scale === 1 ? 1 : 4)), size: mx.map((v, a) => +(v - mn[a]).toFixed(scale === 1 ? 1 : 4)) });
});

/* ---------- write GLB ---------- */
gltf.buffers.push({ byteLength: byteLen });
let json = Buffer.from(JSON.stringify(gltf), 'utf8'); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPad = (4 - (byteLen % 4)) % 4, bin = Buffer.concat([...chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), Buffer.alloc(binPad)]);
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(outFile, Buffer.concat([header, jh, json, bh, bin]));

console.log(`✓ ${inFile} → ${outFile}  (${res.meshes.length} parts, ${report.reduce((s, r) => s + r.tris, 0)} triangles, ${(byteLen / 1024).toFixed(0)} KB geometry)`);
if (recovered) console.log('ℹ Part names recovered from the STEP solid-body names (file order). Check them against the table below.');
if (safe.some(s => /^part_\d+$/.test(s))) console.warn('⚠ Some parts have no name in the STEP file. Name bodies/components in CAD before exporting.');
console.log(`  axes: CAD up=${opt('up', 'z')}, front=${opt('front', '+x')} → glTF up=+Y, front=-Z.  units: ${opt('units', 'mm')}`);
console.log('\n  part                     centre (x right, y up, z back)      size');
report.forEach(r => console.log('  ' + r.name.padEnd(24) + ' ' + JSON.stringify(r.centre).padEnd(34) + ' ' + r.size.join(' × ')));

// Reference converter (how examples/x500/x500.glb.js was made). Not needed to use the guide.
// Assembles the PX4 Gazebo x500 (Holybro X500) from its SDF meshes into one GLB with PX4-style part names:
// applies the SDF poses, converts Gazebo axes (X fwd, Z up) to glTF (-Z fwd, Y up), splits the body by material,
// strips embedded lights/cameras, and swaps legacy/texture-only materials for coloured PBR ones.
// Needs: npm i playwright three esbuild, plus conv.bundle.js built from three's ColladaLoader, STLLoader and GLTFExporter.
// Usage: node convert-x500.js <meshDir> <out.glb>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [meshDir, out] = process.argv.slice(2);
const read = f => fs.readFileSync(path.join(meshDir, f));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('console', m => console.log('[page]', m.text()));
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ path: path.join(__dirname, 'conv.bundle.js') });
  const files = {};
  for (const f of ['NXP-HGD-CF.dae', '5010Base.dae', '5010Bell.dae']) files[f] = read(f).toString('utf8');
  for (const f of ['1345_prop_ccw.stl', '1345_prop_cw.stl']) files[f] = read(f).toString('base64');
  const b64 = await p.evaluate(async files => {
    const { T, ColladaLoader, STLLoader, GLTFExporter } = window.CV;
    const dae = name => { const c = new ColladaLoader().parse(files[name], ''); const s = c.scene; s.rotation.set(0, 0, 0); s.updateMatrixWorld(true); return s; };
    const stlGeo = name => { const bin = Uint8Array.from(atob(files[name]), ch => ch.charCodeAt(0)); const g = new STLLoader().parse(bin.buffer); g.computeVertexNormals(); return g; };
    // pose "x y z roll pitch yaw" (SDF: extrinsic XYZ == Euler 'ZYX' order in three)
    const pose = (o, s) => { const [x, y, z, r, pi, ya] = s.split(/\s+/).map(Number); o.position.set(x, y, z); o.rotation.set(r, pi, ya, 'ZYX'); return o; };
    const wrap = (name, child) => { const g = new T.Group(); g.name = name; g.add(child); return g; };

    // root in glTF convention: gazebo (X fwd, Y left, Z up) -> glTF (X right, Y up, -Z fwd)
    const root = new T.Group(); root.name = 'x500';
    const gz = new T.Group(); gz.name = 'x500_gazebo_frame';
    gz.matrixAutoUpdate = true; gz.rotation.set(-Math.PI / 2, 0, 0); // Z-up -> Y-up (X stays forward... fixed below)
    // after -90° about X: gz X->X, gz Y-> -Z, gz Z->Y. We want gz X (fwd) -> -Z, gz Y (left) -> -X: extra yaw +90° about up
    const yawFix = new T.Group(); yawFix.rotation.set(0, Math.PI / 2, 0); yawFix.name = 'x500_axes';
    root.add(yawFix); yawFix.add(gz);

    // ---- body: split material groups into named top-level parts
    const body = dae('NXP-HGD-CF.dae');
    const bodyPose = pose(new T.Group(), '0 0 .025 0 0 3.141592654'); bodyPose.name = 'body';
    const partNames = { CarbonFiber: 'frame', Metal: 'hardware', FMUK66: 'fc', FMURubber: 'fc_dampers', LandingFoam: 'landing_foam', LandingRubber: 'landing_rubber', LandingPlastic: 'landing_gear', RailsRubber: 'rails_rubber', RailsAntennaHolder: 'antenna_holder' };
    const kids = [...body.children];
    kids.forEach(k => {
      if (k.isLight || /sun/i.test(k.name)) return;
      const n = partNames[k.name] || k.name;
      k.name = n + '_mesh'; const g = new T.Group(); g.name = n; g.add(k); bodyPose.add(g);
    });
    gz.add(bodyPose);

    // ---- motors (PX4 numbering = gazebo rotor index + 1)
    const rotors = [
      { i: 0, link: '0.174 -0.174 0.06 0 0 0', prop: '1345_prop_ccw.stl', dir: 'ccw' },
      { i: 1, link: '-0.174 0.174 0.06 0 0 0', prop: '1345_prop_ccw.stl', dir: 'ccw' },
      { i: 2, link: '0.174 0.174 0.06 0 0 0', prop: '1345_prop_cw.stl', dir: 'cw' },
      { i: 3, link: '-0.174 -0.174 0.06 0 0 0', prop: '1345_prop_cw.stl', dir: 'cw' }
    ];
    const baseScene = dae('5010Base.dae'), bellScene = dae('5010Bell.dae');
    const propMat = { cw: new T.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 }), ccw: new T.MeshStandardMaterial({ color: 0x2f8fff, roughness: 0.5 }) };
    const geos = { '1345_prop_ccw.stl': stlGeo('1345_prop_ccw.stl'), '1345_prop_cw.stl': stlGeo('1345_prop_cw.stl') };
    const basePoses = ['0.174 0.174 .032 0 0 -.45', '-0.174 0.174 .032 0 0 -.45', '0.174 -0.174 .032 0 0 -.45', '-0.174 -0.174 .032 0 0 -.45'];
    // base visual k sits at basePoses[k]; match it to the rotor above it
    rotors.forEach(r => {
      const n = r.i + 1;
      const lp = r.link.split(' ').map(Number);
      const k = basePoses.findIndex(s => { const q = s.split(' ').map(Number); return Math.abs(q[0] - lp[0]) < 1e-3 && Math.abs(q[1] - lp[1]) < 1e-3; });
      const base = pose(new T.Group(), basePoses[k]); base.name = 'motor' + n + '_base'; base.add(baseScene.clone(true)); gz.add(base);
      const link = pose(new T.Group(), r.link); link.name = 'rotor' + n + '_link'; gz.add(link);
      const bell = pose(new T.Group(), '0 0 -.032 0 0 0'); bell.name = 'motor' + n; bell.add(bellScene.clone(true)); link.add(bell);
      const prop = new T.Group(); prop.name = 'prop' + n; link.add(prop);
      const pm = new T.Mesh(geos[r.prop], propMat[r.dir]); pm.name = 'prop' + n + '_mesh';
      pose(pm, '-0.022 -0.14638461538461536 -0.016 0 0 0'); const sc = 0.8461538461538461; pm.scale.set(sc, sc, sc);
      prop.add(pm);
    });
    // strip scene lights/cameras that came along in the Collada files
    const extras = []; root.traverse(o => { if (o.isLight || o.isCamera || /^(light|camera)(\.\d+)?$/i.test(o.name)) extras.push(o); });
    extras.forEach(o => o.parent.remove(o));
    // drop empty groups (no mesh below them)
    const hasMesh = o => { let f = false; o.traverse(c => { if (c.isMesh) f = true; }); return f; };
    const empties = []; root.traverse(o => { if (o !== root && !o.isMesh && !hasMesh(o)) empties.push(o); });
    empties.forEach(o => o.parent && o.parent.remove(o));
    // readable, unique names for motor sub-parts: motor1_base_stator, motor1_bell_side ...
    for (let n = 1; n <= 4; n++) {
      [['motor' + n + '_base', 'motor' + n + '_base_'], ['motor' + n, 'motor' + n + '_']].forEach(([top, pre]) => {
        let k = 0; root.getObjectByName(top).traverse(o => { if (o.name !== top) o.name = pre + (o.isMesh ? 'mesh' : 'part') + (k++); });
      });
    }
    console.log('stripped', extras.length, 'lights/cameras,', empties.length, 'empty groups');

    // legacy Phong/Lambert materials (with missing texture files) -> plain PBR with the same colour
    const cache = new Map();
    root.traverse(o => {
      if (!o.isMesh) return;
      const conv = m => {
        if (m.isMeshStandardMaterial) { m.map = null; return m; }
        if (!cache.has(m)) {
          const metal = /metal|screw|steel|alu/i.test(m.name);
          // texture-only materials (texture file not shipped) would render white: give them a plausible colour
          let color = m.color ? m.color.clone() : new T.Color(0x888888);
          if (m.map && color.getHex() === 0xffffff) color = new T.Color(/carbon|cf/i.test(m.name) ? 0x1d2024 : 0x3a3f46);
          cache.set(m, new T.MeshStandardMaterial({ name: m.name || 'textured_fallback', color, roughness: metal ? 0.35 : 0.6, metalness: metal ? 0.8 : 0.05, side: m.side, transparent: m.transparent, opacity: m.opacity }));
        }
        return cache.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    root.updateMatrixWorld(true);
    let tris = 0; root.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const box = new T.Box3().setFromObject(root);
    console.log('triangles', Math.round(tris), 'size', box.getSize(new T.Vector3()).toArray().map(v => v.toFixed(3)).join(' x '));
    // sanity: motor1 should be front-right in glTF: x>0, z<0
    const m1 = new T.Vector3(); root.getObjectByName('motor1').getWorldPosition(m1); console.log('motor1 world', m1.toArray().map(v => v.toFixed(3)).join(','));
    const ab = await new GLTFExporter().parseAsync(root, { binary: true });
    let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }, files);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
  await b.close();
})();

/*
 * Placeholder quadcopter: a procedural stand-in model so 3D animations work before real CAD arrives.
 * Replace it by exporting your real drone to GLB with the SAME (or mapped) part names; see ASSEMBLY_ANIMATION_GUIDE.md.
 *
 * Conventions: units = millimetres, +Y = up, FRONT = -Z, RIGHT = +X (glTF standard).
 * Part names (use these in animation "parts"; * wildcards allowed):
 *   frame_bottom, arm_fr, arm_fl, arm_rl, arm_rr, standoff_1..4, frame_top,
 *   motor1..motor4 (PX4 numbering: 1 front-right, 2 rear-left, 3 front-left, 4 rear-right),
 *   prop1..prop4 (above the matching motor), esc, pm (power module), fc (+ fc_arrow), gps_mast, gps,
 *   rx, rx_antenna, camera, vtx, vtx_antenna, battery, strap
 */
(window.ASSEMBLY_BUILDERS = window.ASSEMBLY_BUILDERS || {})['placeholder-quad'] = function (THREE) {
  const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.1 }, o));
  const mat = {
    carbon: M(0x2b2f36, { roughness: 0.45, metalness: 0.3 }), metal: M(0xb9c0c9, { metalness: 0.85, roughness: 0.3 }),
    dark: M(0x1d2026), pcb: M(0x1f7a46), fcb: M(0x2a2f3a), accent: M(0xffb020, { emissive: 0x000000 }),
    cw: M(0xff8a1f), ccw: M(0x2f8fff), batt: M(0x3a66b0), strap: M(0xd23c3c), black: M(0x111111), lens: M(0x223344, { metalness: 0.9, roughness: 0.1 })
  };
  const box = (name, w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.name = name; o.position.set(x, y, z); return o; };
  const cyl = (name, r, h, m, x = 0, y = 0, z = 0, seg = 28) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.name = name; o.position.set(x, y, z); return o; };
  const group = (name, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); return g; };

  const root = group('placeholder_quad');
  const R = 82;                                    // motor centre offset on each axis
  // PX4 Quad X: 1 FR CCW, 2 RL CCW, 3 FL CW, 4 RR CW
  const corners = { 1: [R, -R, 'ccw', 'fr'], 2: [-R, R, 'ccw', 'rl'], 3: [-R, -R, 'cw', 'fl'], 4: [R, R, 'cw', 'rr'] };

  // Frame
  root.add(box('frame_bottom', 64, 3, 100, mat.carbon, 0, 1.5, 0));
  Object.values(corners).forEach(([x, z, , tag]) => {
    const a = box('arm_' + tag, 120, 4, 14, mat.carbon);
    const d = new THREE.Vector3(x, 0, z).normalize();
    a.position.set(d.x * 62, 5, d.z * 62); a.rotation.y = Math.atan2(-d.z, d.x);
    root.add(a);
  });
  [[26, -42], [-26, -42], [-26, 42], [26, 42]].forEach(([x, z], i) => root.add(cyl('standoff_' + (i + 1), 2.5, 28, mat.metal, x, 21, z, 12)));
  root.add(box('frame_top', 60, 2.5, 96, mat.carbon, 0, 36.25, 0));

  // Motors + props
  Object.entries(corners).forEach(([n, [x, z, dir]]) => {
    const m = group('motor' + n, x, 7, z);
    m.add(cyl('motor' + n + '_base', 13, 4, mat.dark, 0, 2, 0));
    m.add(cyl('motor' + n + '_bell', 14, 13, mat.metal, 0, 10.5, 0));
    m.add(cyl('motor' + n + '_cap', 14.2, 2.4, dir === 'cw' ? mat.cw : mat.ccw, 0, 18, 0));
    root.add(m);
    const p = group('prop' + n, x, 30, z);
    p.add(cyl('prop' + n + '_hub', 5, 6, mat.black, 0, 0, 0, 16));
    [-1, 1].forEach(s => { const b = box('prop' + n + '_blade' + (s > 0 ? 'A' : 'B'), 60, 1.6, 11, dir === 'cw' ? mat.cw : mat.ccw, s * 32, 0, 0); b.rotation.x = s * (dir === 'cw' ? 0.28 : -0.28); p.add(b); });
    p.rotation.y = n % 2 ? 0.4 : -0.6;
    root.add(p);
  });

  // Electronics stack
  root.add(box('esc', 32, 5, 32, mat.pcb, 0, 12, 0));
  root.add(box('pm', 18, 7, 26, mat.pcb, 0, 6.5, 40));
  const fc = group('fc', 0, 24, 0);
  fc.add(box('fc_board', 36, 7, 36, mat.fcb));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 16), mat.accent); arrow.name = 'fc_arrow';
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 4.5, -6); fc.add(arrow);
  root.add(fc);

  // GPS
  root.add(cyl('gps_mast', 1.8, 40, mat.metal, 0, 57.5, 42, 10));
  const gps = group('gps', 0, 81, 42);
  gps.add(cyl('gps_puck', 17, 7, mat.dark, 0, 0, 0, 36));
  const ga = new THREE.Mesh(new THREE.ConeGeometry(3.5, 8, 12), mat.accent); ga.name = 'gps_arrow'; ga.rotation.x = -Math.PI / 2; ga.position.set(0, 4, -6); gps.add(ga);
  root.add(gps);

  // Receiver
  root.add(box('rx', 12, 4, 18, mat.dark, -16, 6, -30));
  const ant = cyl('rx_antenna', 0.9, 38, mat.black, -16, 3, 58, 8); ant.rotation.x = Math.PI / 2.3; root.add(ant);

  // FPV
  const cam = group('camera', 0, 22, -54); cam.rotation.x = 0.25;
  cam.add(box('camera_body', 19, 19, 19, mat.dark));
  const lens = cyl('camera_lens', 6.5, 7, mat.lens, 0, 0, -12, 20); lens.rotation.x = Math.PI / 2; cam.add(lens);
  root.add(cam);
  root.add(box('vtx', 20, 5, 22, mat.pcb, 0, 31, 30));
  const va = group('vtx_antenna', 0, 38, 50); va.rotation.x = -0.6;
  va.add(cyl('vtx_antenna_stem', 1.2, 30, mat.black, 0, 15, 0, 8));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), mat.black); tip.name = 'vtx_antenna_tip'; tip.position.y = 31; va.add(tip);
  root.add(va);

  // Battery + strap
  root.add(box('battery', 34, 28, 72, mat.batt, 0, 51.5, 0));
  const strap = group('strap', 0, 51.5, 0);
  strap.add(box('strap_top', 37, 1.6, 14, mat.strap, 0, 14.8, 0));
  strap.add(box('strap_left', 1.6, 31, 14, mat.strap, -18.3, 0.5, 0));
  strap.add(box('strap_right', 1.6, 31, 14, mat.strap, 18.3, 0.5, 0));
  root.add(strap);

  return root;
};

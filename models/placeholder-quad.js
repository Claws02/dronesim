/*
 * Placeholder quadcopter: a procedural stand-in so the 3D animations work before real CAD arrives.
 * Generic, unbranded, roughly a 5-inch-class X frame with a Pixhawk-style flight controller.
 * Replace it with your real drone (GLB or STEP); see ASSEMBLY_ANIMATION_GUIDE.md.
 *
 * Conventions: units = millimetres, +Y = up, FRONT = -Z, RIGHT = +X (glTF standard).
 * Part names (animations use these; * wildcards allowed). Positions match earlier versions so existing animations still fit:
 *   frame_bottom, arm_fr, arm_fl, arm_rl, arm_rr, standoff_1..4, frame_top,
 *   motor1..motor4 (PX4 numbering: 1 front-right, 2 rear-left, 3 front-left, 4 rear-right),
 *   prop1..prop4 (above the matching motor), esc, pm (power module), fc (+ fc_arrow), gps_mast, gps (+ gps_arrow),
 *   rx, rx_antenna, camera, vtx, vtx_antenna, battery, strap
 * Materials: meshes carry userData.preset (carbon, anodized, pcb, ...); assembly3d.js turns those into realistic materials.
 */
(window.ASSEMBLY_BUILDERS = window.ASSEMBLY_BUILDERS || {})['placeholder-quad'] = function (THREE) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /* fallback colours (used if the presets are unavailable); presets replace these at load */
  const FALLBACK = { carbon: 0x24272b, anodized: 0xd8342c, aluminum: 0xc9ced6, steel: 0xa4aab2, 'black-metal': 0x2a2c30, copper: 0xc8794a,
    plastic: 0x3a3f46, 'glossy-plastic': 0xf2f2f2, rubber: 0x16171a, pcb: 0x1d6b3e, lipo: 0x2b5fb3, lens: 0x0a1626, prop: 0x2f8fff };
  const mesh = (name, geo, preset, color) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color ?? FALLBACK[preset] ?? 0x888888, roughness: 0.5 }));
    m.name = name; m.userData.preset = color != null ? { preset, color } : preset; return m;
  };
  const group = (name, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); return g; };
  const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

  /* ---------- geometry helpers ---------- */
  const roundedRect = (w, d, r) => { const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  const circle = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };
  const slot = (cx, cy, len, r) => { const p = new THREE.Path(); p.absarc(cx - len / 2, cy, r, Math.PI / 2, Math.PI * 1.5, false); p.absarc(cx + len / 2, cy, r, Math.PI * 1.5, Math.PI / 2, false); return p; };
  /* extrude a 2D shape (x,z plan view, +z = back) into a flat part of thickness t centred on y = 0 */
  const flat = (shape, t, bevel = 0.4) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: t - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -(t - 2 * bevel) / 2); g.rotateX(Math.PI / 2); return g;
  };
  /* exact outer size w x h x d: shrink the outline by the bevel, because extrude bevels grow outward */
  const roundedBox = (w, h, d, r) => { const b = Math.min(r * 0.6, h / 2 - 0.01, w / 4, d / 4);
    return flat(roundedRect(w - 2 * b, d - 2 * b, Math.max(0.05, Math.min(r - b, (w - 2 * b) / 2 - 0.01, (d - 2 * b) / 2 - 0.01))), h, b); };
  const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const tube = (pts, r, seg = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V(...p))), seg, r, 8, false);
  const arrowShape = (len, w) => { const s = new THREE.Shape(); s.moveTo(0, -len / 2); s.lineTo(w / 2, 0); s.lineTo(w / 5, 0); s.lineTo(w / 5, len / 2); s.lineTo(-w / 5, len / 2); s.lineTo(-w / 5, 0); s.lineTo(-w / 2, 0); s.closePath(); return s; };

  const root = group('placeholder_quad');
  const R = 82;
  const corners = { 1: [R, -R, 'ccw', 'fr'], 2: [-R, R, 'ccw', 'rl'], 3: [-R, -R, 'cw', 'fl'], 4: [R, R, 'cw', 'rr'] };

  /* ---------- frame ---------- */
  { const s = roundedRect(64, 100, 8);
    [[0, -30], [0, 30]].forEach(([x, z]) => s.holes.push(slot(x, z, 22, 4)));
    s.holes.push(circle(0, 0, 9));
    [[26, -42], [-26, -42], [-26, 42], [26, 42]].forEach(([x, z]) => s.holes.push(circle(x, z, 1.6)));
    root.add(at(mesh('frame_bottom', flat(s, 3), 'carbon'), 0, 1.5, 0)); }

  Object.values(corners).forEach(([x, z, , tag]) => {
    const L = 120, W = 14, s = new THREE.Shape();
    s.moveTo(-L / 2, -W / 2 + 1); s.lineTo(L / 2 - W / 2, -W / 2); s.absarc(L / 2 - W / 2, 0, W / 2 + 1, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-L / 2, W / 2 - 1); s.closePath();
    s.holes.push(slot(-10, 0, 26, 2.6));                                     // lightening slot
    s.holes.push(circle(L / 2 - W / 2, 0, 2.8));                             // motor shaft clearance
    [[0, 4.7], [0, -4.7], [4.7, 0], [-4.7, 0]].forEach(([dx, dz]) => s.holes.push(circle(L / 2 - W / 2 + dx * 0.0 + dx, dz, 0.9)));
    const a = mesh('arm_' + tag, flat(s, 4), 'carbon');
    const d = V(x, 0, z).normalize();
    a.position.set(d.x * 62, 5, d.z * 62); a.rotation.y = Math.atan2(-d.z, d.x);
    root.add(a);
  });

  [[26, -42], [-26, -42], [-26, 42], [26, 42]].forEach(([x, z], i) =>
    root.add(at(mesh('standoff_' + (i + 1), new THREE.CylinderGeometry(2.6, 2.6, 28, 6), 'anodized', 0xd8342c), x, 21, z)));

  { const s = roundedRect(60, 96, 8);
    s.holes.push(slot(0, -30, 16, 3.5)); s.holes.push(slot(0, 30, 16, 3.5));
    [[-14, 0], [14, 0]].forEach(([x, z]) => s.holes.push(slot(x, z, 1, 3)));     // battery strap slots
    root.add(at(mesh('frame_top', flat(s, 2.5), 'carbon'), 0, 36.25, 0)); }

  /* ---------- motors + props ---------- */
  const propGeo = (cw) => {                                                  // twisted, tapered 2-blade prop, ~5"
    const pos = [], idx = [], RT = 62, R0 = 6, NS = 14, NC = 7, pitch = 100;
    const blade = sgn => {
      const base = pos.length / 3;
      for (let i = 0; i <= NS; i++) {
        const r = R0 + (RT - R0) * i / NS, u = i / NS;
        const chord = 7 + 6 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) * (1 - 0.65 * u * u), th = Math.max(0.5, 1.6 * (1 - u * 0.7));
        const twist = Math.atan(pitch / (2 * Math.PI * Math.max(r, 12)));
        for (let j = 0; j < NC; j++) {
          const a = j / NC * Math.PI * 2, cx = Math.cos(a) * chord / 2, cy = Math.sin(a) * th / 2 + (1 - Math.cos(a) ** 2) * th * 0.3;
          const lx = cx * Math.cos(twist) - cy * Math.sin(twist), ly = cx * Math.sin(twist) + cy * Math.cos(twist);
          pos.push(sgn * r, ly, sgn * lx);
        }
      }
      for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
        const a = base + i * NC + j, b = base + i * NC + (j + 1) % NC, c = a + NC, d = b + NC; idx.push(a, c, b, b, c, d);
      }
      const tip = pos.length / 3; pos.push(sgn * (RT + 1), 0, 0);
      for (let j = 0; j < NC; j++) idx.push(base + NS * NC + j, tip, base + NS * NC + (j + 1) % NC);
    };
    blade(1); blade(-1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    if (cw) g.scale(1, 1, -1);                                               // mirror = opposite rotation
    g.computeVertexNormals(); return g;
  };
  const geoCW = propGeo(true), geoCCW = propGeo(false);
  const bellGeo = lathe([[0, 0], [12.5, 0], [13.6, 0.8], [14, 2.5], [14, 11.5], [13.2, 12.8], [9, 13.2], [3, 13.6], [0, 13.6]], 28);
  const baseGeo = lathe([[0, 0], [13, 0], [13, 1.6], [10, 4], [0, 4]], 20);
  /* the six vent windows of a motor as ONE mesh (fewer draw calls) */
  const ventGeo = (() => { const parts = []; for (let k = 0; k < 6; k++) { const g = new THREE.BoxGeometry(5.2, 6.5, 0.6).toNonIndexed(), a = k / 6 * Math.PI * 2;
      g.rotateY(-a + Math.PI / 2); g.translate(Math.cos(a) * 13.85, 10.5, Math.sin(a) * 13.85); parts.push(g); }
    const pos = [], nor = []; parts.forEach(g => { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); });
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return m; })();
  const hubGeo = lathe([[0, -3], [6, -3], [6.5, -1], [5, 3], [0, 3]], 16);

  Object.entries(corners).forEach(([n, [x, z, dir]]) => {
    const m = group('motor' + n, x, 7, z);
    m.add(mesh('motor' + n + '_base', baseGeo, 'black-metal'));
    const bell = at(mesh('motor' + n + '_bell', bellGeo, 'black-metal'), 0, 4.2, 0); m.add(bell);
    m.add(mesh('motor' + n + '_vents', ventGeo, 'copper'));                 // copper windings showing through the bell vents
    m.add(at(mesh('motor' + n + '_cap', new THREE.CylinderGeometry(9, 9.6, 1.4, 32), 'anodized', dir === 'cw' ? 0xff7a1a : 0x2f8fff), 0, 18.4, 0));
    m.add(at(mesh('motor' + n + '_shaft', new THREE.CylinderGeometry(2.5, 2.5, 7, 16), 'steel'), 0, 21, 0));
    root.add(m);

    const p = group('prop' + n, x, 30, z);
    p.add(mesh('prop' + n + '_hub', hubGeo, 'prop', dir === 'cw' ? 0xff7a1a : 0x2f8fff));
    const bl = mesh('prop' + n + '_blades', dir === 'cw' ? geoCW : geoCCW, 'prop', dir === 'cw' ? 0xff7a1a : 0x2f8fff);
    bl.material.side = THREE.DoubleSide; p.add(bl);
    p.add(at(mesh('prop' + n + '_nut', new THREE.CylinderGeometry(3.6, 3.6, 4, 6), 'anodized', 0xd8342c), 0, 4.6, 0));
    p.rotation.y = n % 2 ? 0.4 : -0.6;
    root.add(p);
  });

  /* ---------- electronics stack ---------- */
  const board = (name, w, d, t, preset, color) => mesh(name, roundedBox(w, t, d, 2), preset || 'pcb', color);
  { const esc = group('esc', 0, 12, 0);
    esc.add(board('esc_board', 32, 32, 1.6, 'pcb', 0x161a1f));
    [[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([x, z], i) => esc.add(at(mesh('esc_fet' + i, new THREE.BoxGeometry(5, 1.2, 6), 'plastic', 0x111111), x, 1.4, z)));
    esc.add(at(mesh('esc_mcu', new THREE.BoxGeometry(6, 1, 6), 'plastic', 0x0b0b0b), 0, 1.3, 0));
    esc.add(at(mesh('esc_cap', new THREE.CylinderGeometry(4, 4, 11, 20), 'plastic', 0x22262b), 0, 2.2, 22, Math.PI / 2, 0, 0));
    root.add(esc); }

  { const pm = group('pm', 0, 6.5, 40);
    pm.add(board('pm_board', 18, 22, 1.6, 'pcb', 0x1d6b3e));
    pm.add(at(mesh('pm_shunt', new THREE.BoxGeometry(8, 1.4, 3), 'copper'), 0, 1.4, -4));
    pm.add(at(mesh('pm_xt60', roundedBox(16, 8, 8, 1.5), 'plastic', 0xf2c200), 0, 0, 14));
    pm.add(mesh('pm_wire_red', tube([[3, 0, 9], [4, 2, 4], [5, 4, -6]], 1.3, 16), 'rubber', 0xc62828));
    pm.add(mesh('pm_wire_black', tube([[-3, 0, 9], [-4, 2, 4], [-5, 4, -6]], 1.3, 16), 'rubber'));
    root.add(pm); }

  { const fc = group('fc', 0, 24, 0);                                       // Pixhawk-style flight controller in a case
    fc.add(mesh('fc_case', roundedBox(36, 7, 36, 4), 'glossy-plastic', 0xe9ecef));
    fc.add(at(mesh('fc_case_band', roundedBox(36.6, 1.6, 36.6, 4.2), 'aluminum', 0x8c949e), 0, -2, 0));
    for (let k = 0; k < 5; k++) fc.add(at(mesh('fc_port' + k, new THREE.BoxGeometry(5, 2.4, 1.6), 'plastic', 0x1a1c1f), -12 + k * 6, 0.2, 18.4));
    fc.add(at(mesh('fc_usb', new THREE.BoxGeometry(7, 2.2, 1.6), 'steel'), 0, 0.2, -18.4));
    const arrow = mesh('fc_arrow', flat(arrowShape(14, 10), 0.6, 0.15), 'plastic', 0xffb020);
    arrow.position.set(0, 3.8, -2); fc.add(arrow);
    root.add(fc); }

  /* ---------- GPS ---------- */
  { const mast = group('gps_mast', 0, 57.5, 42);
    mast.add(mesh('gps_mast_tube', new THREE.CylinderGeometry(2, 2, 40, 16), 'carbon'));
    mast.add(at(mesh('gps_mast_clamp', new THREE.CylinderGeometry(3.6, 4.2, 5, 16), 'anodized', 0xd8342c), 0, -18, 0));
    mast.add(at(mesh('gps_mast_top', new THREE.CylinderGeometry(6, 6, 2, 20), 'plastic', 0x1a1c1f), 0, 20, 0));
    root.add(mast); }
  { const gps = group('gps', 0, 81, 42);
    gps.add(mesh('gps_puck', lathe([[0, -3.5], [17, -3.5], [17.5, -1.5], [16.5, 1.5], [12, 3.4], [0, 3.8]], 48), 'glossy-plastic', 0x1c1e22));
    const ga = mesh('gps_arrow', flat(arrowShape(11, 8), 0.5, 0.12), 'plastic', 0xffb020); ga.position.set(0, 4, -4); gps.add(ga);
    gps.add(at(mesh('gps_led', new THREE.CylinderGeometry(1.4, 1.4, 0.6, 12), 'glossy-plastic', 0x3ad16b), 0, 3.9, 8));
    root.add(gps); }

  /* ---------- receiver ---------- */
  { const rx = group('rx', -16, 6, -30);
    rx.add(mesh('rx_board', roundedBox(12, 3, 18, 1.5), 'lipo', 0x3a7bd5));     // receiver in clear blue heat-shrink
    rx.add(at(mesh('rx_led', new THREE.BoxGeometry(1.6, 0.6, 1.6), 'glossy-plastic', 0x3ad16b), 2, 1.7, -5));
    root.add(rx); }
  { const ant = group('rx_antenna', -16, 3, 58);
    ant.add(mesh('rx_antenna_coax', tube([[0, 3, -88], [0, 1, -60], [0, 0, -30], [0, 0, 0]], 0.7, 24), 'rubber'));
    ant.add(at(mesh('rx_antenna_dipole', new THREE.CylinderGeometry(0.9, 0.9, 30, 10), 'rubber'), 0, 0, 0, 0, 0, Math.PI / 2));
    root.add(ant); }

  /* ---------- FPV camera + VTX ---------- */
  { const cam = group('camera', 0, 22, -54); cam.rotation.x = 0.25;
    cam.add(mesh('camera_body', roundedBox(19, 19, 17, 3), 'black-metal'));
    cam.add(at(mesh('camera_barrel', lathe([[7, 0], [7, 4], [6.2, 4.6], [6.2, 9], [5.4, 9.6], [0, 9.6]], 32), 'black-metal'), 0, 0, -8.5, -Math.PI / 2, 0, 0));
    cam.add(at(mesh('camera_lens', new THREE.SphereGeometry(4.8, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), 'lens'), 0, 0, -17.6, -Math.PI / 2, 0, 0));
    [-10.6, 10.6].forEach((x, i) => cam.add(at(mesh('camera_side' + i, roundedBox(2, 21, 20, 3), 'plastic', 0xff6a2a), x, 0, 0)));
    root.add(cam); }
  { const vtx = group('vtx', 0, 31, 30);
    vtx.add(board('vtx_board', 20, 22, 1.6, 'pcb', 0x161a1f));
    vtx.add(at(mesh('vtx_shield', roundedBox(14, 2.4, 14, 1), 'aluminum'), 0, 2, -2));
    vtx.add(at(mesh('vtx_ufl', new THREE.CylinderGeometry(1.3, 1.3, 1.6, 12), 'steel'), 6, 1.6, 8));
    root.add(vtx); }
  { const va = group('vtx_antenna', 0, 38, 50); va.rotation.x = -0.6;
    va.add(at(mesh('vtx_antenna_stem', new THREE.CylinderGeometry(1.4, 1.6, 30, 12), 'rubber'), 0, 15, 0));
    const tip = mesh('vtx_antenna_tip', new THREE.SphereGeometry(5, 16, 10), 'glossy-plastic', 0x1a1c1f); tip.scale.set(1, 0.75, 1); tip.position.y = 31; va.add(tip);
    root.add(va); }

  /* ---------- battery + strap ---------- */
  { const bat = group('battery', 0, 51.5, 0);
    bat.add(mesh('battery_pack', roundedBox(34, 28, 72, 4), 'lipo', 0x23324d));
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');     // generic, unbranded label
    g.fillStyle = '#f2b705'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#111'; g.font = 'bold 64px sans-serif'; g.textBaseline = 'middle';
    g.fillText('4S  LiPo', 24, 52); g.font = 'bold 30px sans-serif'; g.fillText('14.8 V · HANDLE WITH CARE', 26, 102);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(56, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
    label.name = 'battery_label'; label.rotation.set(0, Math.PI / 2, 0); label.position.set(17.15, 2, 0); bat.add(label);
    const l2 = label.clone(); l2.name = 'battery_label_2'; l2.rotation.y = -Math.PI / 2; l2.position.x = -17.15; bat.add(l2);
    bat.add(mesh('battery_lead_red', tube([[4, -6, 36], [5, -6, 46], [6, -2, 54]], 1.5, 16), 'rubber', 0xc62828));
    bat.add(mesh('battery_lead_black', tube([[-4, -6, 36], [-5, -6, 46], [-6, -2, 54]], 1.5, 16), 'rubber'));
    bat.add(at(mesh('battery_xt60', roundedBox(16, 8, 8, 1.5), 'plastic', 0xf2c200), 0, -1, 58));
    bat.add(mesh('battery_balance', tube([[-10, 6, 36], [-12, 9, 44], [-8, 12, 50]], 0.9, 16), 'rubber', 0xf2f2f2));
    root.add(bat); }
  { const strap = group('strap', 0, 51.5, 0);
    const path = new THREE.CurvePath(), hw = 18.4, top = 15, bot = -14.5, r = 3;
    [[V(-hw, bot, 0), V(-hw, top - r, 0)], [V(-hw + r, top, 0), V(hw - r, top, 0)], [V(hw, top - r, 0), V(hw, bot, 0)]].forEach(([a, b]) => path.add(new THREE.LineCurve3(a, b)));
    const shape = new THREE.Shape([new THREE.Vector2(-0.7, -7), new THREE.Vector2(0.7, -7), new THREE.Vector2(0.7, 7), new THREE.Vector2(-0.7, 7)]);
    const geo = new THREE.ExtrudeGeometry(shape, { steps: 28, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(path.getSpacedPoints(28)) });
    strap.add(mesh('strap_band', geo, 'rubber', 0xb32020));
    strap.add(at(mesh('strap_buckle', roundedBox(10, 1.6, 16, 1.5), 'aluminum'), 0, top + 0.9, 0));
    root.add(strap); }

  return root;
};

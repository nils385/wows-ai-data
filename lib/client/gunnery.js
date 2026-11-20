// Gunnery lab: penetration checker + 3D firing simulation.
// Ballistics, penetration and dispersion use the site's calculation code (ported from WoWs ShipBuilder):
// shell flight with air drag, AP penetration by impact speed, dispersion ellipse with sigma.
// The target is a simplified shape built from its real length, beam and height, with the thickest plate per
// armor area from the official wiki. There is no citadel, spaced armor or shell normalization in this model.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { computeConfiguration, upgradeGroups, setConsumableTitles, dispersion } from "../lib/ship.js";
import { trajectoryTable, at, trajectoryPath } from "../lib/ballistics.js";
import { captainSkills, captainModifiers } from "../lib/builder.js";
import { esc } from "../lib/site.js";
import { plateResult } from "../lib/penetration.js";

const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const ZONES = [["belt_mm", "Belt (side, middle)"], ["extremities_mm", "Bow and stern"], ["deck_mm", "Deck"], ["superstructure_mm", "Superstructure"]];
const HORIZONTAL = new Set(["deck_mm"]);
const RESULT = {
  pen: ["Penetrates", "var(--up)"], overpen: ["Penetrates, fuse may not arm (overpenetration)", "#c9a227"], nopen: ["Does not penetrate", "var(--down)"],
  ric: ["Ricochets", "#7c5cc4"], mayric: ["May ricochet", "#7c5cc4"], miss: ["Miss", "#8aa0b3"],
};

async function main(root) {
  const base = root.dataset.base ?? "";
  const qs = new URLSearchParams(location.search);
  root.innerHTML = `<p class="note">Loading…</p>`;
  const [common, targets] = await Promise.all([json(`${base}/api/build/common.json`), json(`${base}/api/build/targets.json`)]);
  setConsumableTitles(common.consumable_titles);
  const all = Object.entries(targets.ships).map(([index, s]) => ({ index, ...s })).sort((a, b) => a.name.localeCompare(b.name));
  const label = (s) => `${s.name} (tier ${s.tier} ${s.nation})`;
  const ifheSkill = captainSkills(common.default_captain, "Cruiser", common.L).find((s) => s.key === "HeShellPenetration" || /Inertia Fuse/.test(s.name));

  root.innerHTML = `<div class="gl">
  <div class="gl-controls">
    <label class="bt-field"><span>Your ship</span><input list="gl-guns" data-k="ship" value="" autocomplete="off" placeholder="Type a ship name"></label>
    <datalist id="gl-guns">${all.filter((s) => s.guns).map((s) => `<option value="${esc(label(s))}">`).join("")}</datalist>
    <label class="bt-field"><span>Shell</span><select data-k="shell"></select></label>
    <label class="chk" data-out="ifhebox" hidden><input type="checkbox" data-k="ifhe"> With Inertia Fuse for HE Shells (captain skill)</label>
    <label class="bt-field"><span>Target</span><input list="gl-targets" data-k="target" autocomplete="off" placeholder="Type a ship name"></label>
    <datalist id="gl-targets">${all.filter((s) => s.armor).map((s) => `<option value="${esc(label(s))}">`).join("")}</datalist>
    <label class="bt-field"><span>Distance: <output data-out="dist"></output> km</span><input type="range" data-k="dist" min="1" max="20" step="0.1" value="12"></label>
    <label class="bt-field"><span>Target angle: <output data-out="ang"></output>° <span class="note">(0° = broadside, 90° = bow on)</span></span><input type="range" data-k="ang" min="0" max="90" step="1" value="0"></label>
    <p class="gl-presets"><button type="button" class="btn sm" data-ang="0">Broadside</button> <button type="button" class="btn sm" data-ang="30">Angled 30°</button> <button type="button" class="btn sm" data-ang="45">45°</button> <button type="button" class="btn sm" data-ang="65">Hard angled</button></p>
    <div data-out="facts" class="gl-facts"></div>
  </div>
  <div class="gl-main">
    <h2>Penetration check</h2><div data-out="table"></div>
    <h2>Penetration by distance</h2><div data-out="chart"></div>
    <h2>Firing simulation</h2>
    <p class="gl-bar"><button type="button" class="btn" data-act="fire">Fire a salvo</button> <button type="button" class="btn" data-act="fire100">Fire 100 salvos (statistics)</button> <button type="button" class="btn" data-act="clear">Clear</button> <label class="chk"><input type="checkbox" data-k="armorcol" checked> Armor colors</label></p>
    <div class="gl-3d" data-out="three" role="img" aria-label="3D view of the target ship with shells hitting it. Drag to rotate, scroll to zoom."></div>
    <p class="gl-legend" data-out="legend3d"></p>
    <div data-out="simres" role="status"></div>
    <h2>Shell flight</h2><div data-out="arc"></div>
    <p class="note">How this works: shell flight, penetration loss with distance and dispersion are calculated with the same formulas as the rest of the site (ported from WoWs ShipBuilder). The target is a simplified shape built from its real length, beam and height. Its armor is the thickest plate in each area from the official wiki, so real ships have thinner spots and spaced armor, there is no citadel, and shell normalization is not modeled (it is not in the game data). Use it to compare shells, distances and angles, not as an exact in-game result.</p>
  </div></div>`;
  const $ = (n) => root.querySelector(`[data-out="${n}"]`), inp = (k) => root.querySelector(`[data-k="${k}"]`);
  const find = (v) => { v = (v || "").trim().toLowerCase(); return all.find((s) => label(s).toLowerCase() === v || s.name.toLowerCase() === v || s.index.toLowerCase() === v); };

  let gun = null; // { index, data, ctx, stats, shells, art, rangeM }
  async function loadGun(index) {
    const data = await json(`${base}/api/build/ships/${index}.json`);
    const L = { ...common.L, ...data.L };
    const ctx = { projectiles: data.projectiles, aircraft: data.aircraft, abilities: data.abilities, L, name: (k) => (k ? L[String(k).toUpperCase()] ?? null : null) };
    const groups = upgradeGroups(data.ship);
    const cfg = Object.fromEntries(Object.entries(groups).map(([t, l]) => [t, l[l.length - 1]]));
    const opts = cfg.Artillery?.components?.Artillery ?? [], hullList = cfg.Hull?.components?.Artillery ?? [];
    const art = data.ship.mainBatteryModuleList?.[hullList.find((k) => opts.includes(k)) ?? opts[0]];
    gun = { index, data, ctx, cfg, art };
    computeGun();
  }
  function computeGun() {
    const ifhe = inp("ifhe").checked && ifheSkill ? captainModifiers({ skills: [ifheSkill], cls: gun.data.ship_class }) : [];
    gun.stats = computeConfiguration(gun.ctx, gun.data.ship, gun.cfg, ifhe, { tables: false, accel: false });
    const mb = gun.stats.main_battery;
    gun.rangeM = mb.range_km * 1000;
    gun.shells = Object.values(mb.shells).filter((s) => !s.missing_data);
    const sel = inp("shell"), prev = sel.value;
    sel.innerHTML = gun.shells.map((s) => `<option value="${esc(s.id)}">${esc(s.type)}: ${esc(s.name)} (${s.damage} damage)</option>`).join("");
    if (gun.shells.some((s) => s.id === prev)) sel.value = prev;
    else sel.value = (gun.shells.find((s) => s.type === "AP") ?? gun.shells[0]).id;
    $("ifhebox").hidden = !gun.shells.some((s) => s.type === "HE") || !ifheSkill;
    const d = inp("dist"); d.max = String(mb.range_km); if (Number(d.value) > mb.range_km) d.value = String(mb.range_km);
  }
  const shell = () => gun?.shells.find((s) => s.id === inp("shell").value) ?? gun?.shells[0];
  const target = () => find(inp("target").value);

  // ---------- penetration check ----------
  function ballistic(sh, rangeM) {
    const raw = gun.ctx.projectiles[sh.id];
    const table = trajectoryTable(raw, gun.rangeM);
    const p = at(table, Math.min(rangeM, table[table.length - 1].range_m));
    return { raw, table, p, pen: sh.type === "AP" ? p.penetration_mm : sh.penetration_mm };
  }
  function check() {
    const sh = shell(), tg = target();
    $("dist").textContent = f1(Number(inp("dist").value)); $("ang").textContent = inp("ang").value;
    if (!gun || !sh) { $("table").innerHTML = `<p class="note">Choose your ship.</p>`; return null; }
    const rangeM = Number(inp("dist").value) * 1000, phi = Number(inp("ang").value);
    const b = ballistic(sh, rangeM), fall = b.p.impact_angle_deg;
    $("facts").innerHTML = `<table class="kv"><tbody>
      <tr><th scope="row">Penetration at this distance</th><td>${f1(b.pen)} mm${sh.type === "AP" ? "" : " (fixed)"}</td></tr>
      <tr><th scope="row">Fall angle</th><td>${f1(fall)}°</td></tr><tr><th scope="row">Flight time</th><td>${f1(b.p.flight_time_s)} s</td></tr>
      <tr><th scope="row">Impact speed</th><td>${Math.round(b.p.impact_velocity_m_s)} m/s</td></tr>
      ${sh.type !== "HE" ? `<tr><th scope="row">Overmatches plates up to</th><td>${sh.overmatch_mm} mm</td></tr>` : ""}
      ${sh.ricochet_start_angle_deg ? `<tr><th scope="row">Ricochet angles</th><td>${sh.ricochet_start_angle_deg}° – ${sh.ricochet_always_angle_deg}°</td></tr>` : ""}
      ${sh.arming_threshold_mm ? `<tr><th scope="row">Fuse arms on plates from</th><td>${sh.arming_threshold_mm} mm</td></tr>` : ""}
    </tbody></table>`;
    if (!tg?.armor) { $("table").innerHTML = `<p class="note">Choose a target (ships with armor data from the wiki).</p>`; return { sh, b, rangeM, phi, fall }; }
    const rows = ZONES.filter(([k]) => tg.armor[k]).map(([k, name]) => {
      const inc = HORIZONTAL.has(k) ? 90 - fall : deg(Math.acos(Math.cos(rad(fall)) * Math.cos(rad(phi))));
      const r = plateResult(sh, b.pen, tg.armor[k], inc);
      const [txt, col] = RESULT[r.key];
      return `<tr><th scope="row">${esc(name)}</th><td>${tg.armor[k]} mm</td><td>${f1(inc)}°</td><td>${sh.type === "AP" ? `${f1(r.eff)} mm` : "—"}</td><td><strong style="color:${col}">${esc(txt)}</strong>${r.note ? ` <span class="note">${esc(r.note)}</span>` : ""}</td></tr>`;
    });
    $("table").innerHTML = `<p>${esc(sh.type)} shell (${f1(b.pen)} mm) at ${f1(rangeM / 1000)} km against <strong>${esc(tg.name)}</strong> at ${phi}°:</p>
      <div class="scroll"><table class="grid compact"><thead><tr><th scope="col">Area</th><th scope="col">Thickest plate</th><th scope="col">Hit angle</th><th scope="col">Effective thickness</th><th scope="col">Result</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <p class="note">Hit angle: 0° = straight into the plate. Effective thickness = plate ÷ cos(hit angle), which is what AP has to get through. Overmatch: a shell whose caliber is more than 14.3 × the plate thickness cannot ricochet.</p>`;
    return { sh, b, rangeM, phi, fall, tg };
  }

  // ---------- penetration by distance (SVG) ----------
  function chart(st) {
    if (!st) { $("chart").innerHTML = ""; return; }
    const { sh, tg, phi } = st;
    const table = st.b.table, maxR = gun.rangeM;
    const W = 640, H = 260, pad = { l: 46, r: 12, t: 12, b: 32 };
    const pts = [];
    for (let r = 500; r <= maxR; r += Math.max(100, maxR / 120)) { const p = at(table, r); if (p) pts.push({ r, pen: sh.type === "AP" ? p.penetration_mm : sh.penetration_mm, fall: p.impact_angle_deg }); }
    const eff = (k, p) => { const inc = HORIZONTAL.has(k) ? 90 - p.fall : deg(Math.acos(Math.cos(rad(p.fall)) * Math.cos(rad(phi)))); return sh.type === "AP" ? tg.armor[k] / Math.max(Math.cos(rad(inc)), 0.05) : tg.armor[k]; };
    const lines = tg?.armor ? ZONES.filter(([k]) => tg.armor[k]).map(([k, n], i) => ({ k, n, col: ["#d1495b", "#edae49", "#00798c", "#66a182"][i], v: pts.map((p) => eff(k, p)) })) : [];
    const maxY = Math.min(Math.max(...pts.map((p) => p.pen), ...lines.flatMap((l) => l.v)) * 1.08, Math.max(...pts.map((p) => p.pen)) * 2.5);
    const x = (r) => pad.l + ((W - pad.l - pad.r) * r) / maxR, y = (v) => pad.t + (H - pad.t - pad.b) * (1 - Math.min(v, maxY) / maxY);
    const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(pts[i].r).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const ticks = []; for (let km = 0; km <= maxR / 1000; km += maxR > 15000 ? 5 : 2) ticks.push(km);
    const yt = []; const step = maxY > 600 ? 200 : maxY > 250 ? 100 : 50; for (let v = 0; v <= maxY; v += step) yt.push(v);
    const cur = Number(inp("dist").value) * 1000;
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="gl-chart" role="img" aria-label="Shell penetration and target armor by distance">
      ${yt.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="gl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${ticks.map((km) => `<text x="${x(km * 1000)}" y="${H - 10}" text-anchor="middle">${km} km</text>`).join("")}
      <line x1="${x(cur)}" x2="${x(cur)}" y1="${pad.t}" y2="${H - pad.b}" class="gl-cur"/>
      ${lines.map((l) => `<path d="${path(l.v)}" fill="none" stroke="${l.col}" stroke-width="2" stroke-dasharray="6 4"/>`).join("")}
      <path d="${path(pts.map((p) => p.pen))}" fill="none" stroke="currentColor" stroke-width="2.5"/>
    </svg><p class="gl-legend"><span><i style="background:currentColor"></i>${esc(sh.type)} penetration (mm)</span>${lines.map((l) => `<span><i style="background:${l.col}"></i>${esc(l.n)}: armor to get through at ${phi}°</span>`).join("")}</p>
    <p class="note">Where the solid line is above a dashed line, the shell has enough penetration for that area (ricochets aside).${sh.type === "AP" ? "" : " HE and SAP penetration does not change with distance."}</p>`;
  }

  // ---------- shell flight (SVG side view) ----------
  function arcView(st) {
    if (!st) { $("arc").innerHTML = ""; return; }
    const { b, rangeM } = st;
    const path = trajectoryPath(b.raw, b.p.launch_angle_rad, 8);
    const apex = Math.max(...path.map((p) => p.y_m));
    const W = 640, H = 170, pad = 24, sx = (W - 2 * pad) / rangeM, sy = Math.min((H - 2 * pad) / Math.max(apex, 1), sx * 8);
    const d = path.map((p, i) => `${i ? "L" : "M"}${(pad + p.x_m * sx).toFixed(1)},${(H - pad - p.y_m * sy).toFixed(1)}`).join("");
    $("arc").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="gl-chart" role="img" aria-label="Side view of the shell's flight path"><line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="gl-grid"/>
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="2"/><text x="${pad}" y="${H - 6}">your ship</text><text x="${W - pad}" y="${H - 6}" text-anchor="end">target, ${f1(rangeM / 1000)} km</text>
      <text x="${W / 2}" y="${H - pad - apex * sy - 6}" text-anchor="middle">highest point ${Math.round(apex)} m</text></svg>
      <p class="note">Height is stretched ×${f1(sy / sx)} so the arc is visible. Launch angle ${f1(deg(b.p.launch_angle_rad))}°, flight time ${f1(b.p.flight_time_s)} s.</p>`;
  }

  // ---------- 3D ----------
  const box = $("three");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd4e6);
  scene.fog = new THREE.Fog(0xbcd4e6, 1500, 5000);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.49; controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x335577, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(300, 500, -200); scene.add(sun);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: 0x2a6f97, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2; scene.add(water);
  let shipGroup = null, geo = null, markerSize = 3;
  const fx = new THREE.Group(); scene.add(fx);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 30, -700), 350, 0xffffff, 40, 20); scene.add(arrow);

  const armorColor = (mm, max) => new THREE.Color().setHSL(0.6 - 0.6 * Math.sqrt(Math.min(1, mm / Math.max(max, 1))), 0.75, 0.5); // sqrt: thin plates stay distinguishable
  function buildShip(tg) {
    if (shipGroup) scene.remove(shipGroup);
    const s = tg.size_m ?? { length: 150, width: 16, height: 25 };
    const L = s.length, W = s.width, hH = Math.min(Math.max(0.22 * s.height, 4), 13), draft = 0.45 * hH, supTop = hH + 0.55 * Math.max(s.height - hH, 4);
    geo = { L, W, hH, supTop, sup: { x0: -0.16 * L, x1: 0.04 * L, z: 0.3 * W } };
    const g = new THREE.Group();
    const a = tg.armor ?? {}, max = Math.max(a.belt_mm ?? 0, a.deck_mm ?? 0, a.extremities_mm ?? 0, a.superstructure_mm ?? 0, 1);
    const colored = inp("armorcol").checked;
    const mat = (mm, fallback) => new THREE.MeshStandardMaterial({ color: colored && mm ? armorColor(mm, max) : fallback, roughness: 0.7, metalness: 0.2 });
    const outline = new THREE.Shape();
    outline.moveTo(-L / 2, -W * 0.36); outline.quadraticCurveTo(-L / 2 - W * 0.15, 0, -L / 2, W * 0.36);
    outline.lineTo(-0.3 * L, W / 2); outline.lineTo(0.2 * L, W / 2); outline.quadraticCurveTo(0.42 * L, W * 0.4, L / 2, 0);
    outline.quadraticCurveTo(0.42 * L, -W * 0.4, 0.2 * L, -W / 2); outline.lineTo(-0.3 * L, -W / 2); outline.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(outline, { depth: hH + draft, bevelEnabled: false });
    hullGeo.rotateX(-Math.PI / 2); hullGeo.translate(0, -draft, 0);
    g.add(new THREE.Mesh(hullGeo, mat(a.extremities_mm, 0x6b7785)));
    const beltLen = 0.6 * L;
    for (const side of [-1, 1]) { const belt = new THREE.Mesh(new THREE.BoxGeometry(beltLen, hH * 0.75 + 1.5, 0.6), mat(a.belt_mm, 0x59636e)); belt.position.set(-0.05 * L, hH * 0.35, side * (W / 2 + 0.3)); g.add(belt); }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(beltLen, 0.6, W * 0.98), mat(a.deck_mm, 0x8a8f86)); deck.position.set(-0.05 * L, hH + 0.3, 0); g.add(deck);
    const sup = new THREE.Mesh(new THREE.BoxGeometry(geo.sup.x1 - geo.sup.x0, supTop - hH, 2 * geo.sup.z), mat(a.superstructure_mm, 0xa7adb3));
    sup.position.set((geo.sup.x0 + geo.sup.x1) / 2, (hH + supTop) / 2, 0); g.add(sup);
    const turMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6 });
    const r = Math.min(W * 0.28, 8);
    // turret order 0..6 from bow to stern, spread over the hull (simplified positions)
    (tg.turrets ?? []).forEach((tu) => {
      const x = L * (0.36 - Math.min(tu.order, 6) * 0.13), dir = tu.aft ? -1 : 1;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 20), turMat); t.position.set(x, hH + 1.5, 0); g.add(t);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, r * 2.2, 8), turMat); barrel.rotation.z = Math.PI / 2; barrel.position.set(x + dir * r * 1.4, hH + 2, 0); g.add(barrel);
    });
    shipGroup = g; scene.add(g);
    camera.position.set(-L * 0.55, L * 0.32, -L * 0.8); controls.target.set(0, hH, 0); controls.update();
    markerSize = Math.max(2.5, L / 60);
    $("legend3d").innerHTML = tg.armor ? `<span class="note">Armor colors (thickest plate):</span> ${ZONES.filter(([k]) => a[k]).map(([k, nm]) => `<span><i style="background:#${armorColor(a[k], max).getHexString()}"></i>${esc(nm)} ${a[k]} mm</span>`).join("")}` : "";
  }
  function orientShip(phi) { if (shipGroup) shipGroup.rotation.y = -rad(phi); } // 0 = broadside (length across the line of fire)
  // ship frame: length along x (bow at +x), beam along z. World: shells travel towards +z.
  const toLocal = (v, phi) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rad(phi));
  const toWorldDir = (v, phi) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -rad(phi));
  function rayBox(o, d, min, max) {
    let t0 = 0, t1 = Infinity, axis = -1, sign = 0;
    for (let i = 0; i < 3; i++) {
      const k = ["x", "y", "z"][i];
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return null; continue; }
      let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k], s = -1;
      if (a > b) { [a, b] = [b, a]; s = 1; }
      if (a > t0) { t0 = a; axis = i; sign = s; }
      t1 = Math.min(t1, b); if (t0 > t1) return null;
    }
    if (axis < 0) return null;
    const n = new THREE.Vector3(); n.setComponent(axis, sign);
    return { t: t0, n };
  }
  // One shell: lands at ground point G (world) unless the ship is in the way.
  function shoot(st, G) {
    const fall = rad(st.fall), dir = new THREE.Vector3(0, -Math.sin(fall), Math.cos(fall));
    const S0 = 3000, O = G.clone().addScaledVector(dir, -S0);
    const oL = toLocal(O, st.phi), dL = toLocal(dir, st.phi);
    const { L, W, hH, supTop, sup } = geo;
    const hits = [
      ["hull", rayBox(oL, dL, new THREE.Vector3(-L / 2, -50, -W / 2), new THREE.Vector3(L / 2, hH, W / 2))],
      ["sup", rayBox(oL, dL, new THREE.Vector3(sup.x0, hH, -sup.z), new THREE.Vector3(sup.x1, supTop, sup.z))],
    ].filter(([, h]) => h && h.t <= S0 + 1).sort((a, b) => a[1].t - b[1].t);
    if (!hits.length) return { at: G, start: O, key: "miss" };
    const [part, h] = hits[0];
    const pL = oL.clone().addScaledVector(dL, h.t);
    if (pL.y < 0 && part === "hull") return { at: G, start: O, key: "miss", under: true };
    const zone = part === "sup" ? "superstructure_mm" : h.n.y > 0.5 ? (Math.abs(pL.x + 0.05 * L) <= 0.3 * L ? "deck_mm" : "extremities_mm") : Math.abs(pL.x + 0.05 * L) <= 0.3 * L && h.n.x === 0 ? "belt_mm" : "extremities_mm";
    const nW = toWorldDir(h.n, st.phi);
    const inc = deg(Math.acos(Math.min(1, Math.max(-1, -dir.dot(nW)))));
    const r = plateResult(st.sh, st.b.pen, st.tg.armor[zone], inc);
    return { at: O.clone().addScaledVector(dir, h.t), start: O, key: r.key, zone, inc };
  }
  // Dispersion sample, as in ShipBuilder's DispersionPlotHelper (truncated normal along a random direction).
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function landing(st) {
    const sigma = gun.stats.main_battery.sigma, gunDisp = gun.art.guns[0].dispersion;
    const disp = dispersion(gunDisp, gun.rangeM, 1, st.rangeM);
    const a = 2 * Math.PI * Math.random();
    let len = gauss() / sigma; if (len < -1 || len > 1) len = Math.random() * 2 - 1;
    const x = len * disp.horizontal_m * Math.cos(a);
    let y = len * disp.vertical_m * Math.sin(a);
    if (y > 0) y = 300 * Math.log((0.1 * y) / 30 + 1);
    return new THREE.Vector3(x, 0, y / Math.sin(rad(st.fall)));
  }
  const tally = () => ({ shells: 0, pen: 0, overpen: 0, nopen: 0, ric: 0, mayric: 0, miss: 0, zones: {} });
  let stats = tally();
  function addMarker(res) {
    const col = new THREE.Color(RESULT[res.key][1].startsWith("var") ? (res.key === "pen" ? "#2fae66" : "#d64545") : RESULT[res.key][1]);
    const m = new THREE.Mesh(new THREE.SphereGeometry(markerSize, 12, 8), new THREE.MeshBasicMaterial({ color: res.key === "miss" ? 0xffffff : col }));
    m.position.copy(res.at); fx.add(m);
    if (res.key === "miss") { const s = new THREE.Mesh(new THREE.CylinderGeometry(markerSize, markerSize * 1.6, markerSize * 5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.6 })); s.position.copy(res.at).setY(markerSize * 2.5); fx.add(s); }
  }
  function count(res) { stats.shells++; stats[res.key]++; if (res.zone) stats.zones[res.zone] = (stats.zones[res.zone] ?? 0) + 1; }
  function showStats(salvos) {
    const pct = (n) => (stats.shells ? Math.round((100 * n) / stats.shells) : 0);
    const hitsN = stats.shells - stats.miss;
    $("simres").innerHTML = `<p><strong>${stats.shells} shells</strong> (${salvos} salvo${salvos === 1 ? "" : "s"}): ${hitsN} hits (${pct(hitsN)}%) ·
      <span style="color:var(--up)">${stats.pen} penetrations</span> · ${stats.overpen ? `${stats.overpen} overpenetrations · ` : ""}${stats.ric ? `${stats.ric} ricochets · ` : ""}${stats.mayric ? `${stats.mayric} possible ricochets · ` : ""}<span style="color:var(--down)">${stats.nopen} no penetration</span> · ${stats.miss} misses</p>
      ${hitsN ? `<p class="note">Hits by area: ${Object.entries(stats.zones).map(([z, n]) => `${esc(ZONES.find(([k]) => k === z)[1])} ${n}`).join(" · ")}</p>` : ""}`;
  }
  let salvoCount = 0, flying = [];
  function fire(n, animate) {
    const st = current; if (!st?.tg || !gun) return;
    const shellsPer = gun.stats.main_battery.total_barrels;
    for (let s = 0; s < n; s++) for (let i = 0; i < shellsPer; i++) {
      const res = shoot(st, landing(st)); count(res);
      if (animate) flying.push({ res, t: -i * 0.06 });
      else if (s >= n - 1) addMarker(res);
    }
    salvoCount += n; showStats(salvoCount);
  }
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xffcc55 });
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    flying = flying.filter((f) => {
      f.t += dt;
      if (!f.mesh) { if (f.t < 0) return true; f.mesh = new THREE.Mesh(new THREE.SphereGeometry(markerSize * 0.8, 8, 6), shellMat); fx.add(f.mesh); f.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([f.res.start, f.res.start]), new THREE.LineBasicMaterial({ color: 0xffe9a8 })); fx.add(f.line); }
      const k = Math.min(1, f.t / 1.1);
      const p = f.res.start.clone().lerp(f.res.at, 0.72 + 0.28 * k);
      f.mesh.position.copy(p); f.line.geometry.setFromPoints([f.res.start.clone().lerp(f.res.at, Math.max(0.6, 0.72 + 0.28 * k - 0.12)), p]);
      if (k >= 1) { fx.remove(f.mesh); fx.remove(f.line); addMarker(f.res); return false; }
      return true;
    });
    controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop);
  }
  function resize() { const w = box.clientWidth, h = Math.max(300, Math.min(520, w * 0.6)); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(box); resize(); requestAnimationFrame(loop);

  // ---------- wiring ----------
  let current = null, shownTarget = null;
  const clear = () => { fx.clear(); flying = []; stats = tally(); salvoCount = 0; $("simres").innerHTML = `<p class="note">Fire to see where the shells land: green = penetration, red = no penetration, purple = ricochet, yellow = overpenetration, white = miss.</p>`; };
  function refresh() {
    current = check(); chart(current); arcView(current);
    const tg = target();
    if (tg && tg !== shownTarget) { shownTarget = tg; buildShip(tg); clear(); }
    if (tg) orientShip(Number(inp("ang").value));
    arrow.setDirection(new THREE.Vector3(0, -Math.sin(rad(current?.fall ?? 10)), Math.cos(rad(current?.fall ?? 10))).normalize());
    const u = new URL(location.href); if (gun) u.searchParams.set("ship", gun.index); if (tg) u.searchParams.set("target", tg.index); u.searchParams.set("km", inp("dist").value); u.searchParams.set("angle", inp("ang").value); history.replaceState(null, "", u);
  }
  root.addEventListener("change", async (e) => {
    const k = e.target.dataset.k;
    if (k === "ship") { const s = find(e.target.value); if (s) { await loadGun(s.index); clear(); } }
    else if (k === "ifhe") computeGun();
    else if (k === "armorcol" && shownTarget) { shownTarget = null; }
    else if (k === "shell") clear();
    refresh();
  });
  root.addEventListener("input", (e) => { if (["dist", "ang"].includes(e.target.dataset.k)) { refresh(); if (e.target.dataset.k === "dist") clear(); } });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ang) { inp("ang").value = b.dataset.ang; refresh(); }
    if (b.dataset.act === "fire") fire(1, true);
    if (b.dataset.act === "fire100") { clear(); fire(100, false); }
    if (b.dataset.act === "clear") clear();
  });
  const startShip = all.find((s) => s.index === qs.get("ship")) ?? all.find((s) => s.index === "PASB018") ?? all.find((s) => s.guns);
  const startTarget = all.find((s) => s.index === qs.get("target") && s.armor) ?? all.find((s) => s.index === "PJSB018") ?? all.find((s) => s.armor);
  inp("ship").value = label(startShip); inp("target").value = label(startTarget);
  if (qs.get("angle")) inp("ang").value = qs.get("angle");
  await loadGun(startShip.index);
  if (qs.get("km")) inp("dist").value = String(Math.min(Number(qs.get("km")), gun.stats.main_battery.range_km));
  clear(); refresh();
}

const el = document.getElementById("gunnery");
if (el) main(el).catch((e) => { el.innerHTML = `<p class="error">The gunnery lab could not load: ${esc(e.message)}</p>`; console.error(e); });

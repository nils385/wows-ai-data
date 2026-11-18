// Ship stat calculations. Faithful port of WoWs ShipBuilder's DataContainers (MIT, WoWs-Builder-Team):
// https://github.com/WoWs-Builder-Team/WoWs-ShipBuilder/tree/development/src/WoWsShipBuilder.Common/Features/DataContainers
// Every formula, constant, rounding step and modifier hook ("property selector") matches ShipBuilder,
// so values equal what ShipBuilder shows for the same modules and modifiers.

import { accelerationTimes } from "./acceleration.mjs";
import { trajectoryTable, at, apPenetration } from "./ballistics.mjs";

export const KNOTS_TO_MPS = 2.6854;
const AA_INTERVAL = 0.285714285714; // AntiAirAura.DamageInterval

// ---------- numeric helpers ----------
// C# Math.Round default is banker's rounding (midpoint to even).
export function rnd(v, d = 0) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** d, x = v * f, t = Math.trunc(x);
  if (Math.abs(Math.abs(x - t) - 0.5) < 1e-9) return (t % 2 === 0 ? t : t + Math.sign(x)) / f;
  return Math.round(x) / f;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------- modifiers (port of Modifier.ApplyModifier / DataContainerUtility.ApplyModifiers) ----------
function applyOne(m, v) {
  const x = m.value;
  switch (m.valueProcessingKind) {
    case "AddPercentage": return v + x * 100;
    case "SubtractPercentage": return v - x / 100;
    case "Multiplier": return v * x;
    case "PositiveMultiplier": return v * (1 + x / 100);
    case "NegativeMultiplier": return v * (1 - x / 100);
    case "RawAdd": return v + x;
    default: return v;
  }
}
function applyOneInt(m, v) {
  const x = Math.trunc(m.value);
  switch (m.valueProcessingKind) {
    case "AddPercentage": return v + x * 100;
    case "SubtractPercentage": return v - Math.trunc(x / 100);
    case "Multiplier": return v * x;
    case "PositiveMultiplier": return v * (1 + Math.trunc(x / 100));
    case "RawAdd": return v + x;
    default: return v;
  }
}
export const apply = (mods, prop, base) => mods.reduce((v, m) => (m.affectedProperties?.includes(prop) ? applyOne(m, v) : v), base);
export const applyInt = (mods, prop, base) => mods.reduce((v, m) => (m.affectedProperties?.includes(prop) ? applyOneInt(m, v) : v), base);

const UNIT = { Kilometers: "km", Meters: "m", Seconds: "s", Percent: "pct", Knots: "knots", Hitpoints: "hp", Degrees: "deg", MetersPerSecond: "m_per_s",
  DegreesPerSecond: "deg_per_s", PercentPerSecond: "pct_per_s", DamagePerSecond: "damage_per_s", ShotsPerMinute: "shots_per_min", FiresPerMinute: "fires_per_min",
  Millimeters: "mm", Kilograms: "kg" };
// Consumable index (PCY016) -> English name, set by the build so unlabeled effects can be named.
const CONSUMABLE_TITLES = {};
export function setConsumableTitles(map) { Object.assign(CONSUMABLE_TITLES, map); }
// "timeWaitDelayAttack" -> "time wait delay attack"
export const humanize = (s) => String(s ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim();
export const snakeId = (s) => slug(humanize(s));
const TRANSLIT = { ł: "l", Ł: "L", ø: "o", Ø: "O", æ: "ae", Æ: "AE", ß: "ss", đ: "d", Đ: "D", œ: "oe", Œ: "OE", þ: "th" };
export const slug = (s) => String(s ?? "").replace(/[łŁøØæÆßđĐœŒþ]/g, (c) => TRANSLIT[c]).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Human/AI-readable effect of one modifier, following Modifier.ToDisplayValue.
export function describeModifier(L, m) {
  const k = m.displayValueProcessingKind, v = m.value;
  if (k === "Discard") {
    // ShipBuilder hides these (e.g. Inertia Fuse for HE Shells' fire-chance factor), but they change stats.
    if (typeof v !== "number" || v === 1 || v === 0 || !m.gameLocalizationKey || !L[m.gameLocalizationKey.toUpperCase()]) return null;
    const lab = L[m.gameLocalizationKey.toUpperCase()].replace(/\s+/g, " ").trim();
    const pct = rnd((v - 1) * 100, 2);
    return { id: m.name, label: lab, value: pct, unit: "pct_change", display: `${pct > 0 ? "+" : ""}${pct}%`, raw_value: v, applies_to: m.affectedProperties?.length ? m.affectedProperties : undefined };
  }
  let value = v, unit = UNIT[m.unit] ?? null, display;
  switch (k) {
    case "BigWorldToKm": case "BigWorldToKmDecimal": value = rnd((v * 30) / 1000, 2); unit = "km"; display = `${value} km`; break;
    case "MeterToKm": value = rnd(v / 1000, 2); unit = "km"; display = `${value} km`; break;
    case "PositivePercentage": value = rnd((v - 1) * 100, 2); unit = "pct_change"; display = `+${value}%`; break;
    case "NegativePercentage": value = -Math.trunc(rnd(v * 100, 0)); unit = "pct_change"; display = `${value}%`; break;
    case "InverseNegativePercentage": value = -rnd((1 - v) * 100, 0); unit = "pct_change"; display = `${value}%`; break;
    case "VariablePercentage": value = rnd(rnd(v * 100, 2) - 100, 2); unit = "pct_change"; display = `${value > 0 ? "+" : ""}${value}%`; break;
    case "IntVariablePercentage": value = Math.trunc(rnd(v * 100, 2) - 100); unit = "pct_change"; display = `${value > 0 ? "+" : ""}${value}%`; break;
    case "DecimalRoundedPercentage": value = v > 1 ? rnd((v - 1) * 100, 2) : -rnd((1 - v) * 100, 2); unit = "pct_change"; display = `${value > 0 ? "+" : ""}${value}%`; break;
    case "RoundedPercentage": value = rnd(v * 100, 0); unit = "pct"; display = `${value > 0 ? "+" : ""}${value}%`; break;
    case "RawOrPercentage": if (v > 1) { display = `+${v}`; } else { value = rnd(v * 100, 2); unit = "pct"; display = `+${value}%`; } break;
    case "ToNegative": value = -v; display = `${value}${unit ? " " + unit : ""}`; break;
    case "ToPositive": display = `+${v}${unit ? " " + unit : ""}`; break;
    case "ToInt": value = Math.trunc(v); display = `${value > 0 ? "+" : ""}${value}`; break;
    default: display = `${v}${unit ? " " + unit : ""}`;
  }
  let label = (m.gameLocalizationKey && L[m.gameLocalizationKey.toUpperCase()]) || null;
  if (!label) {
    const target = (m.affectedProperties ?? []).map((p) => p.match(/^ConsumableDataContainer\.(Reload|WorkTime|Uses)\.(PCY\d+)$/)).find(Boolean);
    const cname = target ? CONSUMABLE_TITLES[target[2]] : null;
    label = cname ? `${cname} ${{ Reload: "reload time", WorkTime: "action time", Uses: "charges" }[target[1]]}` : humanize(m.name.replace(/^invisible_/, ""));
  }
  return { id: m.name, label: label.replace(/\s+/g, " ").trim(), value, unit, display, raw_value: v, applies_to: m.affectedProperties?.length ? m.affectedProperties : undefined };
}

// ---------- module configuration (port of ShipModuleHelper + Helpers.Get*ShipConfiguration) ----------
export function upgradeGroups(ship) {
  const ups = ship.shipUpgradeInfo?.shipUpgrades ?? [];
  const byName = Object.fromEntries(ups.map((u) => [u.name, u]));
  const depth = (u, seen = new Set()) => {
    if (!u.prev || !byName[u.prev] || seen.has(u.name)) return 0;
    seen.add(u.name);
    return 1 + depth(byName[u.prev], seen);
  };
  const groups = {};
  for (const u of ups) (groups[u.ucType] ??= []).push(u);
  for (const k of Object.keys(groups)) groups[k] = groups[k].map((u, i) => [u, depth(u), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
  return groups;
}

// Every combination of one upgrade per module type. Returns [{ id, cfg: {ucType: upgrade}, stock, top }]
export function allConfigurations(ship) {
  const groups = upgradeGroups(ship);
  const types = Object.keys(groups).sort();
  let combos = [{}];
  for (const t of types) combos = combos.flatMap((c) => groups[t].map((u) => ({ ...c, [t]: u })));
  return combos.map((cfg) => {
    const stock = types.every((t) => cfg[t] === groups[t][0]);
    const top = types.every((t) => cfg[t] === groups[t][groups[t].length - 1]);
    const id = types.map((t) => `${t.toLowerCase()}-${groups[t].indexOf(cfg[t]) + 1}`).join("_") || "default";
    return { id, cfg, stock, top };
  });
}

function moduleKey(cfg, type) {
  const up = cfg[type];
  const opts = up?.components?.[type] ?? [];
  if (!opts.length) return null;
  if (opts.length === 1) return opts[0];
  const hullList = cfg.Hull?.components?.[type] ?? [];
  return hullList.find((k) => opts.includes(k)) ?? opts[0];
}

// ---------- containers ----------
function shellStats(ctx, id, mods, barrels, shots, gunType) {
  const s = ctx.projectiles[id];
  if (!s) return { id, name: ctx.name(id) ?? id, missing_data: true };
  let arming = rnd(s.armingThreshold, 0), fuse = rnd(s.fuseTimer, 3), overmatch = Math.trunc((s.caliber * 1000) / 14.3);
  let dmg = s.damage, fc = s.fireChance * 100, pen = s.penetration;
  const g = gunType;
  if (s.shellType === "HE") {
    overmatch = 0;
    fc = apply(mods, `ShellDataContainer.FireChance.${g}.Multiplier`, fc);
    fc = apply(mods, s.caliber > 0.16 ? `ShellDataContainer.FireChance.${g}.Big.Additive` : `ShellDataContainer.FireChance.${g}.Small.Additive`, fc);
    fc = apply(mods, `ShellDataContainer.FireChance.${g}`, fc);
    pen = apply(mods, `ShellDataContainer.Penetration.${g}`, pen);
  }
  if (s.shellType === "HE" || s.shellType === "SAP") {
    arming = 0; fuse = 0;
    dmg = apply(mods, `ShellDataContainer.Damage.HESAP.${g}`, dmg);
  } else if (s.shellType === "AP") {
    if (s.caliber >= 0.19) dmg = apply(mods, "ShellDataContainer.Damage.BigAp", dmg);
    dmg = apply(mods, "ShellDataContainer.Damage.Ap", dmg);
  }
  const ric = [rnd(s.ricochetAngle, 1), rnd(s.alwaysRicochetAngle, 1)];
  const fcSalvo = 1 - Math.pow(1 - fc / 100, barrels * shots);
  return {
    id, name: ctx.name(id) ?? id, type: s.shellType,
    damage: rnd(dmg, 0), caliber_mm: rnd(s.caliber * 1000, 0), mass_kg: num(s.mass), muzzle_velocity_m_s: rnd(s.muzzleVelocity, 2), air_drag_coefficient: rnd(s.airDrag, 2),
    penetration_mm: s.shellType === "AP" ? null : rnd(pen, 1),
    fire_chance_pct: s.shellType === "HE" ? rnd(fc, 1) : null,
    fire_chance_per_salvo_pct: s.shellType === "HE" ? rnd(fcSalvo * 100, 1) : null,
    overmatch_mm: s.shellType === "AP" || s.shellType === "SAP" ? overmatch : null,
    arming_threshold_mm: s.shellType === "AP" ? arming : null,
    fuse_time_s: s.shellType === "AP" ? fuse : null,
    ricochet_start_angle_deg: ric[0] > 0 || ric[1] > 0 ? ric[0] : null,
    ricochet_always_angle_deg: ric[0] > 0 || ric[1] > 0 ? ric[1] : null,
    krupp: s.shellType === "AP" ? num(s.krupp) : null,
    explosion_radius_m: num(s.explosionRadius), splash_coefficient: num(s.splashCoeff),
    underwater_splash_radius_m: rnd(apply(mods, `ShellDataContainer.UnderwaterSplash.${g}`, s.depthSplashRadius), 1),
    splash_damage: rnd(dmg * s.splashDamageCoefficient, 0),
  };
}

function dispersionAt(d, range, mod = 1) {
  if (!d) return null;
  const r = range / 30, taper = d.taperDist / 30;
  const h = r <= taper
    ? ((r * (d.idealRadius - d.minRadius)) / d.idealDistance + d.minRadius * (r / taper)) * 30 * mod
    : ((r * (d.idealRadius - d.minRadius)) / d.idealDistance + d.minRadius) * 30 * mod;
  return h;
}
function verticalAt(d, maxRange, h, range = -1) {
  const mr = maxRange / 30, x = range >= 0 ? range / 30 : mr, delim = mr * d.delim;
  const c = x < delim ? d.radiusOnZero + (d.radiusOnDelim - d.radiusOnZero) * (x / delim) : d.radiusOnDelim + ((d.radiusOnMax - d.radiusOnDelim) * (x - delim)) / (mr - delim);
  return h * c;
}
function dispersion(d, maxRange, mod, range = -1) {
  if (!d) return { horizontal_m: null, vertical_m: null };
  const at = range >= 0 ? range : maxRange;
  const h = dispersionAt(d, at, mod);
  return { horizontal_m: rnd(h, 2), vertical_m: rnd(verticalAt(d, maxRange, h, range), 2) };
}

// [-150, 150] -> "-150 to 150 deg" (0 = straight ahead, 180/-180 = straight back)
const arc = (a) => (Array.isArray(a) && a.length === 2 ? `${a[0]} to ${a[1]} deg` : String(a ?? "n/a"));
function layout(guns) {
  const groups = {};
  for (const g of guns) (groups[g.numBarrels] ??= []).push(g);
  return Object.entries(groups).map(([b, list]) => ({ mounts: list.length, barrels_per_mount: Number(b), gun: list[0] })).sort((a, b) => a.mounts - b.mounts);
}
const keyByType = (list, typeOf) => {
  const out = {};
  for (const x of list) { const base = slug(typeOf(x)) || "item"; let k = base, i = 2; while (out[k]) k = `${base}_${i++}`; out[k] = x; }
  return out;
};

const BALLISTIC_RANGES_KM = Array.from({ length: 41 }, (_, i) => i); // 0..40 km in 1 km steps

function ballisticTable(ctx, shellId, maxRangeM) {
  const s = ctx.projectiles[shellId];
  if (!s || s.projectileType !== "Artillery" || !s.muzzleVelocity) return null;
  const table = trajectoryTable(s, maxRangeM);
  const rows = [];
  for (const km of BALLISTIC_RANGES_KM) {
    if (km * 1000 > maxRangeM + 999) break;
    const p = at(table, Math.min(km * 1000, maxRangeM));
    if (!p) break;
    rows.push({ range_km: rnd(Math.min(km * 1000, maxRangeM) / 1000, 2), penetration_mm: rnd(p.penetration_mm, 0), impact_velocity_m_s: rnd(p.impact_velocity_m_s, 0), flight_time_s: rnd(p.flight_time_s, 2), impact_angle_deg: rnd(p.impact_angle_deg, 2) });
  }
  const last = at(table, maxRangeM);
  if (last && rows[rows.length - 1]?.range_km !== rnd(maxRangeM / 1000, 2)) rows.push({ range_km: rnd(maxRangeM / 1000, 2), penetration_mm: rnd(last.penetration_mm, 0), impact_velocity_m_s: rnd(last.impact_velocity_m_s, 0), flight_time_s: rnd(last.flight_time_s, 2), impact_angle_deg: rnd(last.impact_angle_deg, 2) });
  return rows;
}

function mainBattery(ctx, art, suo, mods, withTables) {
  if (!art?.guns?.length) return null;
  const arr = layout(art.guns);
  const barrels = arr.reduce((n, a) => n + a.mounts * a.barrels_per_mount, 0);
  const gun = art.guns[0];
  const burst = art.burstModeAbility;
  const calc = (m) => {
    const isBurst = !!burst && m.some((x) => x.name.includes("BurstModeEnabled"));
    let reload = gun.reload, shots = 1;
    if (isBurst) { reload = burst.reloadAfterBurst; shots = burst.shotInBurst; }
    reload = apply(m, "MainBatteryDataContainer.Reload", reload);
    let burstReload = 1;
    if (isBurst && burst.shotInBurst > 1) burstReload = apply(m, "MainBatteryDataContainer.Reload", burst.reloadDuringBurst);
    const rof = isBurst ? 60 / (reload + burstReload * (burst.shotInBurst - 1)) : 60 / reload;
    const alt = burst?.alternateShells ?? [];
    const ammo = isBurst && alt.length ? alt : gun.ammoList;
    return { isBurst, reload, burstReload, shots, rof, ammo };
  };
  const base = calc(mods);
  const traverse = apply(mods, "MainBatteryDataContainer.TraverseSpeed", gun.horizontalRotationSpeed);
  const rangeM = apply(mods, "MainBatteryDataContainer.Range", art.maxRange * (suo?.maxRangeModifier ?? 1));
  const dispMod = apply(mods, "MainBatteryDataContainer.Dispersion.IdealRadius", 1);
  const shellsFor = (c) => c.ammo.map((id) => shellStats(ctx, id, mods, barrels, c.shots, "Main"));
  const shellList = shellsFor(base);
  const perType = (list, rof) => {
    const out = {};
    for (const t of ["HE", "AP", "SAP"]) {
      const sh = list.find((x) => x.type === t);
      if (!sh) continue;
      const k = t.toLowerCase();
      out[`${k}_damage_per_minute`] = rnd(sh.damage * barrels * rof, 0);
      out[`${k}_salvo_damage`] = rnd(sh.damage * barrels, 0);
      if (t === "HE") out.he_potential_fires_per_minute = rnd((sh.fire_chance_pct / 100) * barrels * rof, 2);
    }
    return out;
  };
  const shells = keyByType(shellList, (x) => x.type);
  if (withTables) for (const sh of Object.values(shells)) if (!sh.missing_data) sh.ballistics_by_range = ballisticTable(ctx, sh.id, rangeM);
  for (const sh of Object.values(shells)) {
    if (sh.missing_data || sh.type !== "AP") continue;
    const s = ctx.projectiles[sh.id];
    sh.penetration_at_muzzle_mm = rnd(apPenetration(s.muzzleVelocity, s.caliber, s.mass, s.krupp), 0);
  }
  const out = {
    range_km: rnd(rangeM / 1000, 2),
    reload_s: rnd(base.reload, 2),
    rate_of_fire_per_barrel_per_min: rnd(base.rof, 2),
    total_barrels: barrels,
    layout: arr.map((a) => `${a.mounts}x${a.barrels_per_mount}`).join(" + "),
    guns: arr.map((a) => ({ name: ctx.name(a.gun.name) ?? a.gun.name, id: a.gun.name, mounts: a.mounts, barrels_per_mount: a.barrels_per_mount, caliber_mm: rnd(a.gun.barrelDiameter * 1000, 0) })),
    caliber_mm: rnd(gun.barrelDiameter * 1000, 0),
    turret_traverse_speed_deg_per_s: rnd(traverse, 2),
    turret_180_turn_time_s: rnd(180 / traverse, 2),
    elevation_speed_deg_per_s: num(gun.verticalRotationSpeed),
    ammo_switch_time_s: rnd(apply(mods, "MainBatteryDataContainer.AmmoSwitchTime", base.reload * gun.ammoSwitchCoeff), 1),
    sigma: num(art.sigma),
    ...Object.fromEntries(Object.entries(dispersion(gun.dispersion, rangeM, dispMod)).map(([k, v]) => [`dispersion_at_max_range_${k}`, v])),
    ...perType(shellList, base.rof),
    shells,
  };
  if (withTables) {
    out.dispersion_by_range = [];
    for (let km = 1; km * 1000 <= rangeM; km++) out.dispersion_by_range.push({ range_km: km, ...dispersion(gun.dispersion, rangeM, dispMod, km * 1000) });
    out.turrets = art.guns.map((g) => ({ name: ctx.name(g.name) ?? g.name, barrels: g.numBarrels, firing_arc: arc(g.horizontalSector), dead_zones: g.horizontalDeadZones?.length ? g.horizontalDeadZones.map(arc).join(", ") : "none", position: `${g.horizontalPosition}/${g.verticalPosition}` }));
  }
  if (burst) {
    const bm = calc([...mods, ...(burst.modifiers ?? [])]);
    const bShells = bm.ammo.map((id) => shellStats(ctx, id, mods, barrels, bm.shots, "Main"));
    out.burst_fire_mode = {
      note: "Alternative firing mode. Values below are with burst mode switched on.",
      shots_per_burst: burst.shotInBurst,
      reload_between_shots_in_burst_s: rnd(bm.burstReload, 2),
      reload_after_burst_s: rnd(bm.reload, 2),
      effective_rate_of_fire_per_barrel_per_min: rnd(bm.rof, 2),
      ...perType(bShells, bm.rof),
      shells: keyByType(bShells, (x) => x.type),
      effects: (burst.modifiers ?? []).map((m) => describeModifier(ctx.L, m)).filter(Boolean),
    };
  }
  return out;
}

function secondaries(ctx, hull, mods) {
  const sec = hull.secondaryModule;
  if (!sec?.guns?.length) return null;
  const groups = {};
  for (const g of sec.guns) (groups[`${g.barrelDiameter}|${g.numBarrels}`] ??= []).push(g);
  const list = Object.values(groups).sort((a, b) => a[0].barrelDiameter - b[0].barrelDiameter || a[0].numBarrels - b[0].numBarrels);
  const dispMod = apply(mods, "SecondaryBatteryDataContainer.Dispersion.IdealRadius", 1);
  const rangeM = apply(mods, "SecondaryBatteryDataContainer.Range", sec.maxRange);
  const out = list.map((grp) => {
    const g = grp[0], barrels = grp.length * g.numBarrels;
    const reload = apply(mods, "SecondaryBatteryDataContainer.Reload", g.reload);
    const rof = 60 / reload;
    const shell = g.ammoList?.length ? shellStats(ctx, g.ammoList[0], mods, barrels, 1, "Secondary") : null;
    const fc = shell?.type === "HE" ? rnd((shell.fire_chance_pct / 100) * barrels * rof, 2) : null;
    return {
      name: ctx.name(g.name) ?? g.name, id: g.name, layout: `${grp.length}x${g.numBarrels}`, mounts: grp.length, barrels_per_mount: g.numBarrels, total_barrels: barrels,
      caliber_mm: rnd(g.barrelDiameter * 1000, 0), range_km: rnd(rangeM / 1000, 2), reload_s: rnd(reload, 2), shots_per_min_all_barrels: rnd(rof * barrels, 1),
      sigma: num(sec.sigma), ...Object.fromEntries(Object.entries(dispersion(g.dispersion, rangeM, dispMod)).map(([k, v]) => [`dispersion_at_max_range_${k}`, v])),
      damage_per_minute: shell?.damage != null ? rnd(shell.damage * barrels * rof, 0) : null, potential_fires_per_minute: fc, shell,
    };
  });
  return {
    range_km: rnd(rangeM / 1000, 2),
    total_barrels: out.reduce((n, g) => n + g.total_barrels, 0),
    total_damage_per_minute: out.reduce((n, g) => n + (g.damage_per_minute ?? 0), 0),
    total_potential_fires_per_minute: rnd(out.reduce((n, g) => n + (g.potential_fires_per_minute ?? 0), 0), 2),
    gun_groups: out,
  };
}

function torpedoStats(ctx, id, mods, fromPlane) {
  const t = ctx.projectiles[id];
  if (!t) return { id, name: ctx.name(id) ?? id, missing_data: true };
  const dmg = apply(mods, "TorpedoDataContainer.Damage", t.damage);
  const speed = apply(mods, fromPlane ? "TorpedoDataContainer.Damage.Plane" : "TorpedoDataContainer.Damage.Ship", t.speed); // selector names as in ShipBuilder
  const detect = apply(mods, "TorpedoDataContainer.Visibility", t.spottingRange);
  const arming = apply(mods, "TorpedoDataContainer.ArmingTime", t.armingTime);
  const flood = apply(mods, fromPlane ? "TorpedoDataContainer.FloodChance.Plane" : "TorpedoDataContainer.FloodChance.Ship", t.floodChance);
  const all = ["destroyer", "cruiser", "battleship", "aircraft_carrier"];
  const ignore = (t.ignoreClasses ?? []).map((c) => ({ AirCarrier: "aircraft_carrier" })[c] ?? c.toLowerCase());
  const out = {
    id, name: ctx.name(id) ?? id, type: snakeId(t.torpedoType),
    damage: rnd(dmg, 0), range_km: rnd(t.maxRange / 1000, 2), speed_knots: rnd(speed, 2), detectability_km: rnd(detect, 2),
    reaction_time_s: rnd((detect / (speed * KNOTS_TO_MPS)) * 1000, 2),
    arming_distance_m: rnd(speed * KNOTS_TO_MPS * arming, 0),
    flooding_chance_pct: rnd(flood * 100, 2),
    explosion_radius_m: num(t.explosionRadius), splash_coefficient: num(t.splashCoeff), caliber_mm: rnd(t.caliber * 1000, 0),
    can_hit_classes: ignore.length ? all.filter((c) => !ignore.includes(c)) : all.concat("submarine"),
  };
  const mp = t.magneticTorpedoParams;
  if (t.torpedoType === "Magnetic" && mp) {
    const fs = (a) => (a?.length ? { first_ping: rnd(a[0], 1), second_ping: rnd(a[a.length - 1], 1) } : null);
    out.homing = {
      max_turning_speed_deg_per_s: fs(mp.maxTurningSpeed), turning_acceleration: fs(mp.turningAcceleration), max_vertical_speed: fs(mp.maxVerticalSpeed),
      vertical_acceleration: fs(mp.verticalAcceleration), search_radius_km: fs(mp.searchRadius), search_angle_deg: fs(mp.searchAngle),
      stops_homing_at_distance_m: Object.fromEntries(Object.entries(mp.dropTargetAtDistance ?? {}).map(([c, v]) => [slug(c === "AirCarrier" ? "aircraft_carrier" : c), fs(v)])),
    };
  }
  return out;
}

function torpedoes(ctx, mod, mods) {
  if (!mod?.torpedoLaunchers?.length) return null;
  const launcher = mod.torpedoLaunchers[0];
  const arr = layout(mod.torpedoLaunchers);
  const tubes = arr.reduce((n, a) => n + a.mounts * a.barrels_per_mount, 0);
  const traverse = apply(mods, "TorpedoArmamentDataContainer.TraverseSpeed", launcher.horizontalRotationSpeed);
  const reload = apply(mods, "TorpedoArmamentDataContainer.Reload", launcher.reload);
  const list = (launcher.ammoList ?? []).map((id) => torpedoStats(ctx, id, mods, false));
  const opts = {};
  list.forEach((t, i) => {
    opts[i === 0 ? "primary" : list.length === 2 ? "alternative" : `alternative_${i}`] = {
      ...t, full_salvo_damage: t.damage != null ? t.damage * tubes : null, damage_per_minute: t.damage != null ? rnd((t.damage * tubes * 60) / reload, 0) : null,
    };
  });
  const loaders = {};
  let loaderSum = 0;
  for (const [pos, l] of Object.entries(mod.torpedoLoaders ?? {})) {
    if (!l?.length) continue;
    loaders[slug(pos.replace(/Loaders$/, "")) + "_loaders"] = l.join(" + ");
    loaderSum += l.map((x) => Number(String(x).split("x")[0])).reduce((a, b) => a + b, 0);
  }
  return {
    reload_s: rnd(reload, 2), total_tubes: tubes, layout: arr.map((a) => `${a.mounts}x${a.barrels_per_mount}`).join(" + "),
    launchers: arr.map((a) => ({ name: ctx.name(a.gun.name) ?? a.gun.name, mounts: a.mounts, tubes_per_mount: a.barrels_per_mount })),
    launcher_firing_arcs: mod.torpedoLaunchers.map((l) => arc(l.horizontalSector)).join("; "),
    launcher_traverse_speed_deg_per_s: rnd(traverse, 2), launcher_180_turn_time_s: rnd(180 / traverse, 2),
    spread_angles_deg: launcher.torpedoAngles ? [launcher.torpedoAngles[0], rnd(launcher.torpedoAngles[1], 1)] : null,
    torpedo_switch_time_s: rnd(reload * launcher.ammoSwitchCoeff, 1),
    ...(loaderSum ? { ...loaders, loaders_count: loaderSum } : {}),
    torpedoes: opts,
  };
}

function aura(a, flakAmount, flakBonus, constBonus) {
  if (!a) return null;
  const avg = flakAmount > 0 ? Math.trunc(flakAmount * a.hitChance) : null;
  return {
    range_km: rnd(a.maxRange / 1000, 2), min_range_km: rnd(a.minRange / 1000, 2),
    continuous_damage_per_s: rnd((a.constantDps / AA_INTERVAL) * constBonus, 2),
    flak_damage: a.flakDamage ? rnd((a.flakDamage / (AA_INTERVAL / 2)) * flakBonus, 2) : null,
    flak_bursts_per_salvo: flakAmount > 0 ? flakAmount : null, flak_bursts_average_hits: avg, flak_bursts_spread: avg !== null ? flakAmount - avg : null,
    hit_chance_pct: Math.trunc(rnd(a.hitChance * 100, 2)),
  };
}
function antiAir(shipClass, hull, art, mods) {
  if (shipClass === "Submarine") return null;
  const flakBonus = apply(mods, "AntiAirDataContainer.FlakDamage", 1), constBonus = apply(mods, "AntiAirDataContainer.ConstantDamage", 1);
  let long = hull.antiAir?.longRangeAura ?? null;
  if (art?.antiAir) long = long ? addAura(long, art.antiAir) : art.antiAir;
  const flak = long ? applyInt(mods, "AntiAirDataContainer.FlakAmount", long.flakCloudsNumber) : 0;
  const af = hull.antiAir?.aimedFire;
  const dur = (c, r) => (r > 0 ? rnd(c / r, 1) : 0);
  const out = {
    long_range: aura(long, flak, flakBonus, constBonus),
    medium_range: aura(hull.antiAir?.mediumRangeAura, 0, flakBonus, constBonus),
    short_range: aura(hull.antiAir?.shortRangeAura, 0, flakBonus, constBonus),
    aimed_fire: af ? {
      charge_up_time_s: dur(af.requiredCharge, af.chargeGainRate), active_duration_s: dur(af.requiredCharge, af.chargeSpendingRate),
      charge_decay_delay_s: rnd(af.decrementDelay, 1), charge_decay_time_s: dur(af.requiredCharge, af.decrementRate),
      aura_damage_multiplier: rnd(af.auraDamageMultiplier, 2), flak_damage_multiplier: rnd(af.bubbleDamageMultiplier, 2),
      instant_damage_cooldown_s: rnd(af.instantDamageCooldown, 1),
      instant_damage_pct_of_squadron_hp: Object.fromEntries(["Destroyer", "Cruiser", "Battleship", "AirCarrier", "Submarine"].map((c) => [c === "AirCarrier" ? "vs_aircraft_carrier_planes" : `vs_${c.toLowerCase()}_planes`, af.instantDamagePercentage?.[c] != null ? rnd(af.instantDamagePercentage[c] * 100, 2) : 0])),
    } : null,
  };
  if (!out.long_range && !out.medium_range && !out.short_range && !out.aimed_fire) return null;
  out.total_continuous_damage_per_s = rnd(["long_range", "medium_range", "short_range"].reduce((n, k) => n + (out[k]?.continuous_damage_per_s ?? 0), 0), 2);
  out.max_range_km = Math.max(...["long_range", "medium_range", "short_range"].map((k) => out[k]?.range_km ?? 0));
  return out;
}
function addAura(a, b) {
  return { constantDps: a.constantDps + b.constantDps, flakDamage: b.flakDamage, flakCloudsNumber: a.flakCloudsNumber + b.flakCloudsNumber, hitChance: b.hitChance, maxRange: b.maxRange, minRange: b.flakDamage > 0 ? a.minRange : b.minRange };
}

function bombStats(ctx, id, mods) {
  const b = ctx.projectiles[id];
  if (!b) return { id, name: ctx.name(id) ?? id, missing_data: true };
  const ap = b.bombType === "AP";
  const dmg = apply(mods, ap ? "BombDataContainer.Damage.Ap" : "BombDataContainer.Damage.He", b.damage);
  return {
    id, name: ctx.name(id) ?? id, kind: b.projectileType === "SkipBomb" ? "skip_bomb" : "bomb", type: b.bombType,
    damage: rnd(dmg, 2), penetration_mm: ap ? Math.round(rnd(apPenetration(b.muzzleVelocity, b.caliber, b.mass, b.krupp), 1)) : rnd(b.penetration, 1),
    fire_chance_pct: ap ? null : rnd(apply(mods, "BombDataContainer.FireChance", b.fireChance * 100), 1),
    fuse_time_s: ap ? num(b.fuseTimer) : null, arming_threshold_mm: ap ? Math.trunc(b.armingThreshold) : null,
    ricochet_start_angle_deg: ap ? num(b.ricochetAngle) : null, ricochet_always_angle_deg: ap ? num(b.alwaysRicochetAngle) : null,
    explosion_radius_m: num(b.explosionRadius), splash_coefficient: num(b.splashCoeff), underwater_splash_radius_m: rnd(b.depthSplashRadius, 1),
    splash_damage: rnd(dmg * b.splashDamageCoefficient, 0), krupp: num(b.krupp), caliber_mm: rnd(b.caliber * 1000, 0),
  };
}
function rocketStats(ctx, id, mods) {
  const r = ctx.projectiles[id];
  if (!r) return { id, name: ctx.name(id) ?? id, missing_data: true };
  const ap = r.rocketType === "AP";
  const dmg = ap ? apply(mods, "RocketDataContainer.Damage.Ap", r.damage) : r.damage;
  return {
    id, name: ctx.name(id) ?? id, kind: "rocket", type: r.rocketType,
    damage: rnd(dmg, 2), penetration_mm: ap ? rnd(apPenetration(r.muzzleVelocity, r.caliber, r.mass, r.krupp), 0) : rnd(r.penetration, 1),
    fire_chance_pct: ap ? null : rnd(apply(mods, "RocketDataContainer.FireChance", r.fireChance * 100), 1),
    fuse_time_s: ap ? num(r.fuseTimer) : null, arming_threshold_mm: ap ? Math.trunc(r.armingThreshold) : null,
    ricochet_start_angle_deg: ap ? num(r.ricochetAngle) : null, ricochet_always_angle_deg: ap ? num(r.alwaysRicochetAngle) : null,
    explosion_radius_m: num(r.explosionRadius), splash_coefficient: num(r.splashCoeff), underwater_splash_radius_m: rnd(r.depthSplashRadius, 1),
    splash_damage: rnd(dmg * r.splashDamageCoefficient, 0), krupp: num(r.krupp), caliber_mm: rnd(r.caliber * 1000, 0),
  };
}
function depthChargeStats(ctx, id, mods) {
  const d = ctx.projectiles[id];
  if (!d) return { id, name: ctx.name(id) ?? id, missing_data: true };
  const minS = d.sinkingSpeed * (1 - d.sinkingSpeedRng) * KNOTS_TO_MPS, maxS = d.sinkingSpeed * (1 + d.sinkingSpeedRng) * KNOTS_TO_MPS;
  const minT = d.detonationTimer - d.detonationTimerRng, maxT = d.detonationTimer + d.detonationTimerRng;
  return {
    id, name: ctx.name(id) ?? id, damage: rnd(apply(mods, "DepthChargeDataContainer.Damage", d.damage), 0),
    fire_chance_pct: rnd(d.fireChance * 100, 2), flooding_chance_pct: rnd(d.floodChance * 100, 2), explosion_radius_m: rnd(d.explosionRadius, 2),
    sink_speed_m_per_s: [rnd(minS, 1), rnd(maxS, 1)], detonation_timer_s: [rnd(minT, 1), rnd(maxT, 1)], detonation_depth_m: [rnd((minS * minT) / 2, 0), rnd((maxS * maxT) / 2, 0)],
    damage_by_depth: d.pointsOfDamage ?? undefined,
  };
}
function weaponStats(ctx, id, mods, fromPlane) {
  const p = ctx.projectiles[id];
  if (!p) return { id, name: ctx.name(id) ?? id, missing_data: true };
  if (p.projectileType === "Torpedo") return { kind: "torpedo", ...torpedoStats(ctx, id, mods, fromPlane) };
  if (p.projectileType === "Rocket") return rocketStats(ctx, id, mods);
  if (p.projectileType === "DepthCharge") return { kind: "depth_charge", ...depthChargeStats(ctx, id, mods) };
  return bombStats(ctx, id, mods);
}

const PLANE_HP_PROP = { TacticalFighter: "Rocket", Fighter: "Rocket", TacticalDiveBomber: "DiveBomber", DiveBomber: "DiveBomber", TacticalTorpedoBomber: "TorpedoBomber", TorpedoBomber: "TorpedoBomber", TacticalSkipBomber: "SkipBomber", SkipBomber: "SkipBomber" };
function cvPlane(ctx, planeId, tier, mods) {
  const p = ctx.aircraft[planeId.split("_")[0]];
  if (!p) return { id: planeId, name: ctx.name(planeId) ?? planeId, missing_data: true };
  const kind = PLANE_HP_PROP[p.planeType];
  let hp = p.maxHealth, speed = p.speed, minM = p.speedMinModifier, maxM = p.speedMaxModifier, aimRate = 1, aimTime = 0;
  if (kind) {
    hp = apply(mods, `CvAircraftDataContainer.Hp.${kind}`, hp);
    if (kind === "Rocket" || kind === "TorpedoBomber" || kind === "SkipBomber") aimTime = apply(mods, `CvAircraftDataContainer.AimingTime.${kind}`, p.aimingTime);
    if (kind === "DiveBomber") { speed = apply(mods, "CvAircraftDataContainer.CruisingSpeed.DiveBomber", speed); minM = apply(mods, "CvAircraftDataContainer.MinSpeed.DiveBomber", minM); maxM = apply(mods, "CvAircraftDataContainer.MaxSpeed.DiveBomber", maxM); }
    if (kind === "SkipBomber") speed = apply(mods, "CvAircraftDataContainer.CruisingSpeed.SkipBomber", speed);
    aimRate = apply(mods, `CvAircraftDataContainer.AimRate.${kind}`, aimRate);
  }
  let finalHp = Math.round(apply(mods, "CvAircraftDataContainer.Hp", hp));
  const extra = applyInt(mods, "CvAircraftDataContainer.HpPerTier", tier);
  if (extra > 15) finalHp += extra;
  const cruise = apply(mods, "CvAircraftDataContainer.Speed", speed);
  maxM = apply(mods, "CvAircraftDataContainer.MaxSpeed", maxM);
  const jatoDur = p.jatoData?.jatoDuration ?? 0, jatoMul = jatoDur ? p.jatoData.jatoSpeedMultiplier : 0;
  const fullAim = p.preparationTime + (1 - p.preparationTime * p.preparationAccuracyIncreaseRate * aimRate) / (p.aimingAccuracyIncreaseRate * aimRate);
  const weapon = p.bombName ? weaponStats(ctx, p.bombName, mods, true) : null;
  return {
    id: planeId, name: ctx.name(planeId) ?? planeId, type: snakeId(p.planeType),
    plane_hp: finalHp, squadron_hp: finalHp * p.numPlanesInSquadron, attack_flight_hp: finalHp * p.attackData.attackerSize,
    planes_in_squadron: p.numPlanesInSquadron, planes_per_attack_flight: p.attackData.attackerSize, weapons_per_plane_per_attack: p.attackData.attackCount,
    planes_on_deck_max: applyInt(mods, "CvAircraftDataContainer.MaxOnDeck", p.maxPlaneInHangar), plane_restoration_time_s: rnd(apply(mods, "CvAircraftDataContainer.RestorationTime", p.restorationTime), 2),
    cruising_speed_knots: rnd(cruise, 2), max_speed_knots: rnd(cruise * maxM, 0), min_speed_knots: rnd(cruise * minM, 0),
    engine_boost_duration_s: rnd(apply(mods, "CvAircraftDataContainer.BoostTime", p.maxEngineBoostDuration), 2),
    jato_duration_s: num(jatoDur) || null, jato_speed_bonus_pct: jatoMul > 1 ? rnd((jatoMul - 1) * 100, 0) : null,
    inner_ellipse_bomb_pct: weapon?.kind === "bomb" ? Math.trunc(p.innerBombsPercentage) : null,
    attack_cooldown_s: rnd(p.attackData.attackCooldown, 1), aiming_time_s: rnd(aimTime, 1), preparation_time_s: num(p.preparationTime),
    time_to_fully_aimed_s: rnd(fullAim, 1), aiming_rate_while_moving_pct: rnd((p.aimingAccuracyIncreaseRate + p.aimingAccuracyDecreaseRate) * 100, 1),
    post_attack_invulnerability_s: num(p.postAttackInvulnerabilityDuration), damage_taken_during_attack_pct: rnd(p.damageTakenMultiplier * 100, 0),
    detectability_by_ships_km: rnd(apply(mods, "CvAircraftDataContainer.Concealment", p.concealmentFromShips), 2),
    detectability_by_planes_km: rnd(apply(mods, "CvAircraftDataContainer.Concealment", p.concealmentFromPlanes), 2),
    spotting_range_ships_km: num(p.spottingOnShips),
    weapon,
    consumables: consumables(ctx, p.aircraftConsumable, mods, true, 0, "AirCarrier"),
  };
}

const CLASS_STR = { Destroyer: "Destroyer", Cruiser: "Cruiser", Battleship: "Battleship", AirCarrier: "AirCarrier", Submarine: "Submarine" };
function consumables(ctx, list, mods, isPlane, shipHp, shipClass) {
  const slots = {};
  for (const c of list ?? []) {
    const a = ctx.abilities[`${c.consumableName} ${c.consumableVariantName}`];
    const id = c.consumableName;
    const nameKey = `DOCK_CONSUME_TITLE_${(a?.descId || id).toUpperCase()}`;
    const name = ctx.L[nameKey] ?? ctx.L[`DOCK_CONSUME_TITLE_${id.toUpperCase()}`] ?? id;
    if (!a) { (slots[c.slot] ??= []).push({ id, variant: c.consumableVariantName, name, missing_data: true }); continue; }
    let uses = a.numConsumables, cd = a.reloadTime, work = a.workTime, tb = a.timeBasedActiveTime, prep = a.preparationTime;
    const effects = (a.modifiers ?? []).map((m) => ({ ...m }));
    const upd = (prop, modName) => { const m = effects.find((x) => x.name === modName); if (m) m.value = apply(mods, prop, m.value); };
    if (isPlane) {
      uses = applyInt(mods, "ConsumableDataContainer.Uses.Plane", uses); cd = apply(mods, "ConsumableDataContainer.Reload.Plane", cd);
      work = apply(mods, "ConsumableDataContainer.WorkTime.Plane", work); tb = apply(mods, "ConsumableDataContainer.TimeBasedActiveTime.Plane", tb);
    } else {
      uses = applyInt(mods, "ConsumableDataContainer.Uses.Ship", uses);
      cd = apply(mods, `ConsumableDataContainer.Reload.${CLASS_STR[shipClass] ?? shipClass}`, cd); cd = apply(mods, "ConsumableDataContainer.Reload.Ship", cd);
      work = apply(mods, "ConsumableDataContainer.WorkTime.Ship", work); tb = apply(mods, "ConsumableDataContainer.TimeBasedActiveTime.Ship", tb);
    }
    uses = applyInt(mods, `ConsumableDataContainer.Uses.${a.index}`, uses); cd = apply(mods, `ConsumableDataContainer.Reload.${a.index}`, cd);
    work = apply(mods, `ConsumableDataContainer.WorkTime.${a.index}`, work); tb = apply(mods, `ConsumableDataContainer.TimeBasedActiveTime.${a.index}`, tb);
    const extra = [];
    const plane = a.planeName ? ctx.aircraft[a.planeName.split("_")[0]] : null;
    if (isPlane) {
      if (id.includes("PCY036")) upd("ConsumableDataContainer.PlaneRegenerationRate.PCY036", "regenerationRate");
      else if (id.includes("PCY035")) {
        upd("ConsumableDataContainer.Radius.PCY035", "radius"); upd("ConsumableDataContainer.TimeDelayAttack.PCY035", "timeDelayAttack"); upd("ConsumableDataContainer.TimeDelayAppear.PCY035", "timeFromHeaven");
        if (plane) {
          extra.push({ id: "cruisingSpeed", label: "Cruising speed", value: plane.speed, unit: "knots" }, { id: "concealment", label: "Detectability", value: rnd(apply(mods, "ConsumableDataContainer.Concealment.PCY035", plane.concealmentFromShips), 2), unit: "km" });
          const f = effects.find((x) => x.name === "fightersNum"); if (f) extra.push({ id: "maxKills", label: "Maximum aircraft destroyed", value: f.value, unit: null });
          extra.push({ id: "maxViewDistance", label: "Spotting range", value: rnd(apply(mods, "ConsumableDataContainer.Interceptor", plane.spottingOnShips), 2), unit: "km" });
        }
      }
    } else if (id.includes("PCY010")) {
      upd("ConsumableDataContainer.RegenerationHpSpeed.PCY010", "consumable_regenerationHPSpeed");
      const r = effects.find((x) => x.name === "consumable_regenerationHPSpeed")?.value;
      if (r != null) extra.push(
        { id: "hpPerHeal", label: "HP restored per charge (full duration)", value: rnd(work * r * shipHp, 0), unit: "hp" },
        { id: "hpPerSecond", label: "HP restored per second", value: rnd(r * shipHp, 0), unit: "hp_per_s" },
      );
    } else if (id.includes("PCY016")) upd("ConsumableDataContainer.TorpDetection.PCY016", "distTorpedo");
    else if (id.includes("PCY014")) upd("ConsumableDataContainer.LifeTime.PCY014", "lifeTime");
    else if (id.includes("PCY012") || id.includes("PCY038")) {
      // ShipBuilder applies Reload.{index} a second time here, which made Consumable Specialist -14.4% on fighters
      // instead of the -7.5% it gives every other consumable. Applied once above, like all consumables.
      upd(`ConsumableDataContainer.ExtraFighters.${a.index}`, "fightersNum");
      if (plane) {
        const f = effects.find((x) => x.name === "fightersNum");
        extra.push({ id: "cruisingSpeed", label: "Cruising speed", value: plane.speed, unit: "knots" }, { id: "maxViewDistance", label: "Spotting range", value: num(plane.spottingOnShips), unit: "km" });
        if (f) extra.push({ id: "maxKills", label: "Maximum aircraft destroyed", value: f.value, unit: null });
        extra.push({ id: "concealment", label: "Detectability", value: rnd(apply(mods, `ConsumableDataContainer.Concealment.${a.index}`, plane.concealmentFromShips), 2), unit: "km" });
      }
    } else if (id.includes("PCY045")) upd("ConsumableDataContainer.HydrophoneUpdateFrequency.PCY045", "hydrophoneUpdateFrequency");
    else if (id.includes("PCY048")) prep = apply(mods, "ConsumableDataContainer.PrepTime.PCY048", prep);
    const desc = effects.map((m) => describeModifier(ctx.L, m)).filter(Boolean).map(({ applies_to, ...e }) => e);
    const all = [...desc, ...extra.filter((e) => !desc.some((d) => d.id === e.id))];
    (slots[c.slot] ??= []).push({
      id, variant: c.consumableVariantName, name,
      charges: a.numConsumables === -1 ? "unlimited" : uses,
      reload_s: rnd(cd, 1), duration_s: a.isTimeBased ? null : rnd(work, 1), preparation_time_s: rnd(prep, 1) || null,
      time_based: a.isTimeBased || undefined, time_based_active_time_s: a.isTimeBased ? rnd(tb, 1) : undefined,
      effects: Object.fromEntries(all.map((e) => [effectKey(e), { label: e.label, value: e.value, unit: e.unit, display: e.display }])),
    });
  }
  return Object.entries(slots).sort(([a], [b]) => a - b).map(([slot, options]) => ({ slot: Number(slot), options }));
}
export const effectKey = (e) => {
  const u = e.unit && e.unit !== "pct_change" ? e.unit : e.unit === "pct_change" ? "pct_change" : "";
  return [slug(e.label) || slug(e.id), u].filter(Boolean).join("_");
};

function airstrikes(ctx, ship, mods) {
  return Object.entries(ship.airStrikes ?? {}).map(([slot, s]) => {
    const p = ctx.aircraft[s.planeName.split("_")[0]];
    const asw = p?.planeCategory === "Asw";
    return {
      slot, kind: asw ? "anti_submarine_airstrike" : "airstrike", plane: ctx.name(s.planeName) ?? s.planeName,
      plane_hp: p ? Math.round(apply(mods, "AirstrikeDataContainer.PlaneHp", p.maxHealth)) : null,
      reload_s: rnd(apply(mods, "AirstrikeDataContainer.Reload", s.reloadTime), 2), charges: applyInt(mods, "AirstrikeDataContainer.Uses", s.charges),
      drop_time_s: num(s.dropTime), fly_away_time_s: num(s.flyAwayTime),
      max_distance_km: rnd(s.maximumDistance / 1000, 2), max_flight_distance_km: rnd(s.maximumFlightDistance / 1000, 2), min_distance_km: rnd(s.minimumDistance / 1000, 2),
      weapons_per_plane: p?.attackData?.attackCount ?? null, planes_per_attack: p?.attackData?.attackerSize ?? null,
      weapon: p?.bombName ? (asw ? { kind: "depth_charge", ...depthChargeStats(ctx, p.bombName, mods) } : bombStats(ctx, p.bombName, mods)) : null,
    };
  });
}

function depthCharges(ctx, hull, mods) {
  const a = hull.depthChargeArray;
  if (!a) return null;
  const perAttack = a.depthCharges.reduce((n, c) => n + c.depthChargesNumber, 0) * a.numShots;
  const ammo = a.depthCharges.find((c) => c.depthChargesNumber > 0)?.ammoList?.[0];
  return { reload_s: num(a.reload), charges: applyInt(mods, "DepthChargesLauncherDataContainer.NumberOfUses", a.maxPacks), depth_charges_per_attack: perAttack, depth_charge: ammo ? depthChargeStats(ctx, ammo, mods) : null };
}

function sonar(ship, cfg, mods) {
  const list = ship.pingerGunList ?? {};
  const keys = Object.keys(list);
  if (!keys.length) return null;
  const k = cfg.Sonar?.components?.Sonar?.[0] ?? keys[0];
  const p = list[k];
  if (!p) return null;
  const speed = apply(mods, "PingerGunDataContainer.WaveSpeed", p.waveParams[0].waveSpeed[0]);
  const t = p.rotationSpeed[0];
  return {
    range_km: p.waveDistance / 1000, reload_s: rnd(apply(mods, "PingerGunDataContainer.Reload", p.waveReloadTime), 2),
    ping_speed_m_per_s: rnd(speed, 0), ping_width: p.waveParams[0].startWaveWidth,
    first_ping_duration_s: rnd(apply(mods, "PingerGunDataContainer.PingDuration.First", p.sectorParams[0].lifetime), 1),
    second_ping_duration_s: rnd(apply(mods, "PingerGunDataContainer.PingDuration.Second", p.sectorParams[1]?.lifetime ?? 0), 1),
    traverse_speed_deg_per_s: t, turn_180_time_s: rnd(180 / t, 2),
  };
}

function specialAbility(ctx, ship) {
  const s = ship.specialAbility;
  if (!s) return null;
  const descKey = s.activatorName ? (s.activatorName === "RibbonActivator" ? `RAGE_MODE_TRIGGER_DESCRIPTION_${s.activatorName}` : `RAGE_MODE_DESCRIPTION_${s.activatorName}`) : null;
  return {
    name: ctx.L[`DOCK_RAGE_MODE_TITLE_${s.name}`.toUpperCase()] ?? s.name, id: s.name,
    how_to_activate: descKey ? ctx.L[descKey.toUpperCase()] ?? s.activatorName : null,
    duration_s: rnd(s.duration, 1), target_area_radius_km: rnd((s.activatorRadius ?? 0) / 1000, 1) || null,
    progress_per_action: num(s.progressPerAction), inactivity_delay_s: num(s.decrementDelay), progress_loss_interval_s: num(s.decrementPeriod), progress_loss_per_interval: num(s.decrementCount),
    effects: Object.fromEntries((s.modifiers ?? []).map((m) => describeModifier(ctx.L, m)).filter(Boolean).map(({ applies_to, ...e }) => [effectKey(e), e])),
  };
}

// ---------- full ship configuration ----------
// opts.tables: include per-km ballistic and dispersion tables. opts.accel: run the acceleration simulation.
export function computeConfiguration(ctx, ship, cfg, mods = [], opts = {}) {
  const hullKey = cfg.Hull?.components?.Hull?.[0] ?? Object.keys(ship.hulls)[0];
  const hull = ship.hulls[hullKey];
  if (!hull) return null;
  const engine = ship.engines[cfg.Engine?.components?.Engine?.[0]] ?? Object.values(ship.engines)[0] ?? { speedCoef: 0 };
  const suo = ship.fireControlList[cfg.Suo?.components?.Suo?.[0]] ?? null;
  const art = ship.mainBatteryModuleList[moduleKey(cfg, "Artillery")] ?? null;
  const tor = ship.torpedoModules[moduleKey(cfg, "Torpedoes")] ?? null;
  const cls = ship.shipClass;

  // survivability
  let hp = hull.health;
  const extraHp = applyInt(mods, "SurvivabilityDataContainer.Hp", ship.tier);
  if (extraHp > 15) hp += extraHp;
  hp = apply(mods, "SurvivabilityDataContainer.Hp.Permanent", hp);
  const hpInt = Math.ceil(hp);
  const fireDur = apply(mods, "SurvivabilityDataContainer.FireDuration", hull.fireDuration);
  const floodDur = apply(mods, "SurvivabilityDataContainer.FloodDuration", hull.floodingDuration);
  const baseFR = 1 - hull.fireResistance;
  const fireRes = baseFR + (1 - baseFR) * (1 - apply(mods, "SurvivabilityDataContainer.FireChanceResistance", 1));
  const floodCoeff = apply(mods, "SurvivabilityDataContainer.FloodChanceResistance", hull.floodingResistance * 3) * 100;
  const fireDps = apply(mods, "SurvivabilityDataContainer.FireDamageWeakness", (hp * hull.fireTickDamage) / 100);
  const floodDps = apply(mods, "SurvivabilityDataContainer.FloodDamageWeakness", (hp * hull.floodingTickDamage) / 100);
  const repMod = apply(mods, "SurvivabilityDataContainer.RepairableDamage", 0);
  const sections = {};
  for (const loc of hull.hitLocations ?? []) {
    sections[slug(loc.name)] = { hp: Math.ceil((loc.hp * (hpInt / hull.health)) / 50) * 50, repairable_damage_pct: rnd((loc.repairableDamage + repMod) * 100, 0) };
  }
  const survivability = {
    hit_points: hpInt,
    fire: { max_simultaneous_fires: applyInt(mods, "SurvivabilityDataContainer.FireResistance", hull.fireSpots), duration_s: rnd(fireDur, 1), fire_chance_reduction_pct: rnd(fireRes * 100, 1), damage_per_s: rnd(fireDps, 0), total_damage_per_fire: rnd(fireDur * fireDps, 0) },
    flooding: { max_simultaneous_floods: hull.floodingSpots, duration_s: rnd(floodDur, 1), torpedo_protection_damage_reduction_pct: rnd(100 - floodCoeff, 1), damage_per_s: rnd(floodDps, 0), total_damage_per_flood: rnd(floodDur * floodDps, 0) },
    hit_location_hp: sections,
    rudder_damage_protection: num(hull.steeringGearArmorCoeff), engine_damage_protection: num(engine.armorCoeff),
    ...(cls === "Submarine" ? { dive_capacity: rnd(hull.subBatteryCapacity * apply(mods, "SurvivabilityDataContainer.DiveCapacity", 1), 1), dive_capacity_recharge_per_s: rnd(hull.subBatteryRegenRate * apply(mods, "SurvivabilityDataContainer.DiveCapacityRecharge", 1), 1) } : {}),
  };

  // maneuverability
  let speedMod = apply(mods, "ManeuverabilityDataContainer.Speed", 1);
  const boost = apply(mods, "ManeuverabilityDataContainer.BoostCoeff.SpeedBoost", 0);
  if (boost !== 0) speedMod += boost + apply(mods, "ManeuverabilityDataContainer.SpeedBoostForsage", 0);
  const prop = apply(mods, "ManeuverabilityDataContainer.PropellerShaftSpeed", 1);
  const baseSpeed = hull.maxSpeed * ((engine.speedCoef ?? 0) + 1);
  let maxSpeed = baseSpeed * speedMod, maxReverse = (baseSpeed / 4 + 4.9) * speedMod;
  const maneuverability = {
    max_speed_knots: rnd(maxSpeed, 2), max_reverse_speed_knots: rnd(maxReverse, 2),
    rudder_shift_time_s: rnd((hull.rudderTime * apply(mods, "ManeuverabilityDataContainer.RudderShiftTime", 1)) / 1.305, 2),
    turning_circle_radius_m: num(hull.turningRadius),
    engine_power_hp: num(hull.enginePower), displacement_t: num(hull.tonnage),
  };
  if (opts.accel !== false) {
    const t = accelerationTimes(ship.index, hull, engine, cls, {
      speed: speedMod * prop, fwdUp: apply(mods, "ManeuverabilityDataContainer.EngineForwardUpTime", 1), backUp: apply(mods, "ManeuverabilityDataContainer.EngineBackwardUpTime", 1),
      fwdForsMax: apply(mods, "ManeuverabilityDataContainer.EngineForwardForsageMaxSpeed", 1), backForsMax: apply(mods, "ManeuverabilityDataContainer.EngineBackwardForsageMaxSpeed", 1),
      fwdForsPower: apply(mods, "ManeuverabilityDataContainer.EngineForwardForsagePower", 1), backForsPower: apply(mods, "ManeuverabilityDataContainer.EngineBackwardForsagePower", 1),
    }, {
      fwdForsMaxOverride: apply(mods, "ManeuverabilityDataContainer.ForwardEngineForsagMaxSpeed.SpeedBoost", 0), backForsMaxOverride: apply(mods, "ManeuverabilityDataContainer.BackwardEngineForsagMaxSpeed.SpeedBoost", 0),
      fwdForsOverride: apply(mods, "ManeuverabilityDataContainer.ForwardEngineForsag.SpeedBoost", 0), backForsOverride: apply(mods, "ManeuverabilityDataContainer.BackwardEngineForsag.SpeedBoost", 0),
    });
    maneuverability.time_to_full_speed_ahead_s = t.to_full_ahead_s;
    maneuverability.time_to_full_speed_reverse_s = t.to_full_reverse_s;
  }
  if (cls === "Submarine") {
    const c = hull.maxSpeedAtBuoyancyStateCoeff ?? {};
    Object.assign(maneuverability, {
      max_speed_knots: null, max_reverse_speed_knots: null,
      max_speed_surface_knots: rnd(maxSpeed * prop, 2), max_speed_periscope_depth_knots: rnd(maxSpeed * (c.Periscope ?? 0) * prop, 2), max_speed_max_depth_knots: rnd(maxSpeed * (c.DeepWater ?? 0), 2),
      max_reverse_speed_surface_knots: rnd(maxReverse * prop, 2), max_reverse_speed_periscope_depth_knots: rnd(maxReverse * (c.Periscope ?? 0) * prop, 2), max_reverse_speed_max_depth_knots: rnd(maxReverse * (c.DeepWater ?? 0), 2),
      dive_speed_m_per_s: rnd(hull.diveSpeed * apply(mods, "ManeuverabilityDataContainer.MaxDiveSpeed", 1), 2),
      diving_plane_shift_time_s: rnd(hull.divingPlaneShiftTime * apply(mods, "ManeuverabilityDataContainer.DivingPlaneShiftTime", 1), 2),
    });
  }

  // concealment
  let sea = apply(mods, "ConcealmentDataContainer.Visibility", hull.surfaceDetection);
  let air = apply(mods, "ConcealmentDataContainer.Visibility", hull.airDetection);
  let sub = apply(mods, "ConcealmentDataContainer.Visibility", hull.detectionBySubPeriscope);
  if (art?.guns?.[0]?.barrelDiameter >= 0.149) {
    sea = apply(mods, "ConcealmentDataContainer.Visibility.Big", sea); air = apply(mods, "ConcealmentDataContainer.Visibility.Big", air); sub = apply(mods, "ConcealmentDataContainer.Visibility.Big", sub);
  }
  const mainBatteryStats = mainBattery(ctx, art, suo, mods, opts.tables);
  const concealment = {
    detectability_by_ships_km: rnd(sea, 2), detectability_by_planes_km: rnd(air, 2),
    // Firing main guns outside smoke raises sea detectability to the guns' current max range (official wiki, Ship:Detection).
    detectability_by_ships_after_firing_main_battery_km: mainBatteryStats ? Math.max(rnd(sea, 2), mainBatteryStats.range_km) : null,
    detectability_when_firing_from_smoke_km: rnd(hull.smokeFiringDetection, 2),
    // While on fire: +2 km by sea, +3 km by air (ShipBuilder ConcealmentBySeaFire / ConcealmentByAirFire).
    detectability_by_ships_while_burning_km: rnd(sea + 2, 2), detectability_by_planes_while_burning_km: rnd(air + 3, 2),
    detectability_by_submarines_at_periscope_depth_km: rnd(sub, 2),
  };

  const planes = [];
  for (const t of ["Fighter", "TorpedoBomber", "DiveBomber", "SkipBomber"]) {
    const k = cfg[t]?.components?.[t]?.[0];
    for (const id of ship.cvPlanes?.[k] ?? []) planes.push(cvPlane(ctx, id, ship.tier, mods));
  }
  const strikes = airstrikes(ctx, ship, mods);

  return {
    modules: Object.fromEntries(Object.entries(cfg).sort(([a], [b]) => a.localeCompare(b)).map(([t, u]) => [slug(t), ctx.name(u.name) ?? u.name])),
    survivability, maneuverability, concealment,
    main_battery: mainBatteryStats,
    fire_control: suo ? { max_range_multiplier: num(suo.maxRangeModifier), sigma_multiplier: num(suo.sigmaModifier) } : null,
    secondaries: secondaries(ctx, hull, mods),
    torpedoes: torpedoes(ctx, tor, mods),
    anti_air: antiAir(cls, hull, art, mods),
    aircraft: planes.length ? keyByType(planes, (p) => p.type) : null,
    airstrikes: strikes.length ? strikes : null,
    depth_charges: depthCharges(ctx, hull, mods),
    sonar: sonar(ship, cfg, mods),
    consumables: consumables(ctx, ship.shipConsumable, mods, false, hpInt, cls),
    hull_size_m: hull.sizes ? { length: num(hull.sizes.length), width: num(hull.sizes.width), height: num(hull.sizes.height) } : null,
  };
}

export { specialAbility, shellStats, weaponStats, cvPlane, consumables as consumableSlots };

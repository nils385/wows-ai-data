#!/usr/bin/env node
// Builds a static, machine-readable World of Warships data site for AI agents.
//
//   node build.mjs                       download the latest data, then build into ./dist
//   node build.mjs --data-dir path       build from files you already downloaded
//
// Data comes from the public data server of WoWs ShipBuilder (https://app.wowssb.com),
// which extracts it from the game client every patch. No account or key needed.
// No dependencies: needs Node 18+. Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const argVal = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const DATA_DIR = argVal("--data-dir");
const OUT = path.resolve(process.env.OUT_DIR || "dist");
const SERVER = process.env.WOWS_SERVER || "live"; // "live" or "pts"
const CDN = `https://cdn.wowssb.com/api/${SERVER}`;
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const CATEGORIES = ["Ship", "Summary", "Projectile", "Aircraft", "Ability"];

// ---------- load ----------
async function getText(rel) {
  if (DATA_DIR) return readFile(path.join(DATA_DIR, rel), "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${CDN}/${rel}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 4) throw new Error(`download ${rel} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function loadData() {
  const version = JSON.parse(await getText("VersionInfo.json"));
  const data = {};
  for (const cat of CATEGORIES) {
    data[cat] = {};
    await Promise.all(version.categories[cat].map(async (f) => {
      const text = await getText(`${cat}/${f.fileName}`);
      const sum = createHash("sha256").update(text).digest("hex");
      if (sum !== f.checksum) throw new Error(`checksum mismatch for ${cat}/${f.fileName}`);
      data[cat][f.fileName] = JSON.parse(text);
    }));
  }
  const merge = (cat) => Object.assign({}, ...Object.values(data[cat]));
  return {
    version,
    ships: merge("Ship"),
    summary: Object.values(data.Summary).flat(),
    projectiles: merge("Projectile"),
    aircraft: merge("Aircraft"),
    abilities: merge("Ability"),
    loc: JSON.parse(await getText("Localization/en.json")),
  };
}

// ---------- helpers ----------
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r = (v, d = 2) => (num(v) === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const km = (m) => r(num(m) === null ? null : m / 1000, 2);
const pct = (v) => r(num(v) === null ? null : v * 100, 1);
const slugify = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

const NATIONS = {
  Usa: ["usa", "U.S.A."], Japan: ["japan", "Japan"], Germany: ["germany", "Germany"], UnitedKingdom: ["united_kingdom", "U.K."],
  Russia: ["ussr", "U.S.S.R."], France: ["france", "France"], Italy: ["italy", "Italy"], PanAsia: ["pan_asia", "Pan-Asia"],
  Europe: ["europe", "Europe"], PanAmerica: ["pan_america", "Pan-America"], Netherlands: ["netherlands", "The Netherlands"],
  Commonwealth: ["commonwealth", "Commonwealth"], Spain: ["spain", "Spain"],
};
const CLASSES = {
  Destroyer: ["destroyer", "Destroyer"], Cruiser: ["cruiser", "Cruiser"], Battleship: ["battleship", "Battleship"],
  AirCarrier: ["aircraft_carrier", "Aircraft Carrier"], Submarine: ["submarine", "Submarine"],
};
const CATEGORY = { TechTree: "tech_tree", Premium: "premium", Special: "special", TestShip: "test_ship" };
const nationId = (n) => NATIONS[n]?.[0] ?? slugify(n).replace(/-/g, "_");
const classId = (c) => CLASSES[c]?.[0] ?? slugify(c).replace(/-/g, "_");

function build(raw) {
  const L = raw.loc;
  const name = (key) => (key ? L[key.toUpperCase()] ?? null : null);
  const shipName = (index) => L[index] ?? L[index?.toUpperCase()] ?? index;
  const summaryByIndex = Object.fromEntries(raw.summary.map((s) => [s.index, s]));

  const shell = (id) => {
    const p = raw.projectiles[id];
    if (!p) return { id, name: name(id) };
    const base = { id, name: name(id) ?? id, type: p.shellType ?? p.torpedoType ?? p.projectileType, damage: r(p.damage, 0) };
    if (p.projectileType === "Artillery") return {
      ...base,
      caliber_mm: r(p.caliber * 1000, 0), mass_kg: num(p.mass), muzzle_velocity_m_s: num(p.muzzleVelocity),
      fire_chance_pct: pct(p.fireChance) || null,
      he_sap_penetration_mm: p.shellType !== "AP" && p.penetration ? num(p.penetration) : null,
      ap_krupp: p.shellType === "AP" ? num(p.krupp) : null,
      ricochet_angles_deg: p.shellType === "HE" ? null : [num(p.ricochetAngle), num(p.alwaysRicochetAngle)],
      fuse_time_s: p.shellType === "AP" ? num(p.fuseTimer) : null, arming_threshold_mm: p.shellType === "AP" ? num(p.armingThreshold) : null,
    };
    if (p.projectileType === "Torpedo") return {
      ...base, range_km: km(p.maxRange), speed_knots: num(p.speed), detectability_km: num(p.spottingRange),
      caliber_mm: r(p.caliber * 1000, 0), can_not_hit_classes: (p.ignoreClasses ?? []).map(classId),
    };
    return { ...base, fire_chance_pct: pct(p.fireChance) || null };
  };

  // group identical guns/launchers: [{name, count, barrels_each, ...}]
  const gunGroups = (guns) => {
    const groups = {};
    for (const g of guns ?? []) {
      const k = g.name;
      groups[k] ??= {
        id: g.name, name: name(g.name) ?? g.name, mounts: 0, barrels_per_mount: g.numBarrels,
        caliber_mm: r(g.barrelDiameter * 1000, 0), reload_s: num(g.reload),
        traverse_180_s: g.horizontalRotationSpeed ? r(180 / g.horizontalRotationSpeed, 1) : null,
        ammo: [...new Set(g.ammoList ?? [])],
      };
      groups[k].mounts++;
    }
    return Object.values(groups);
  };

  const aura = (a) => a ? { dps: num(a.constantDps), flak_damage: num(a.flakDamage) || null, flak_bursts: num(a.flakCloudsNumber) || null, hit_chance_pct: pct(a.hitChance), range_km: km(a.maxRange) } : null;

  const consumables = (list) => {
    const bySlot = {};
    for (const c of list ?? []) {
      const a = raw.abilities[`${c.consumableName} ${c.consumableVariantName}`];
      (bySlot[c.slot] ??= []).push({
        id: c.consumableName, variant: c.consumableVariantName,
        name: L[`DOCK_CONSUME_TITLE_${c.consumableName.toUpperCase()}`] ?? c.consumableName,
        charges: a ? (a.numConsumables === -1 ? "unlimited" : a.numConsumables) : null,
        reload_s: num(a?.reloadTime), duration_s: num(a?.workTime) || null,
      });
    }
    return Object.entries(bySlot).sort(([a], [b]) => a - b).map(([slot, options]) => ({ slot: Number(slot), options }));
  };

  // Choose modules for a configuration: "stock" = first module letter (A_), "top" = last (fully researched).
  function configuration(s, which) {
    const pick = (keys) => (keys.length ? [...keys].sort()[which === "stock" ? 0 : keys.length - 1] : null);
    const hullKey = pick(Object.keys(s.hulls));
    const hullUpgrade = s.shipUpgradeInfo?.shipUpgrades?.find((u) => u.ucType === "Hull" && u.components?.Hull?.includes(hullKey));
    const compat = (type, all) => {
      const allowed = hullUpgrade?.components?.[type];
      const keys = Object.keys(all ?? {});
      return pick(allowed?.length ? keys.filter((k) => allowed.includes(k)) : keys);
    };
    const hull = s.hulls[hullKey];
    if (!hull) return null;
    const engine = s.engines[pick(Object.keys(s.engines))];
    const fc = s.fireControlList[pick(Object.keys(s.fireControlList))];
    const artKey = compat("Artillery", s.mainBatteryModuleList), art = s.mainBatteryModuleList[artKey];
    const torKey = compat("Torpedoes", s.torpedoModules), tor = s.torpedoModules[torKey];

    const out = {
      hull_module: hullUpgrade ? name(hullUpgrade.name) ?? hullUpgrade.name : hullKey,
      hit_points: num(hull.health),
      max_speed_knots: r(hull.maxSpeed * (1 + (engine?.speedCoef ?? 0)), 2),
      rudder_shift_s: num(hull.rudderTime),
      turning_radius_m: num(hull.turningRadius),
      detectability_by_ship_km: num(hull.surfaceDetection),
      detectability_by_plane_km: num(hull.airDetection),
      tonnage_t: num(hull.tonnage),
      length_m: num(hull.sizes?.length),
      fire_spots: num(hull.fireSpots),
      flooding_spots: num(hull.floodingSpots),
      main_battery: null, secondaries: null, torpedoes: null, anti_air: null,
    };
    if (art) {
      const groups = gunGroups(art.guns);
      const ammo = [...new Set(groups.flatMap((g) => g.ammo))];
      out.main_battery = {
        range_km: km(art.maxRange * (fc?.maxRangeModifier ?? 1)),
        sigma: num(art.sigma) && r(art.sigma * (fc?.sigmaModifier ?? 1), 2),
        reload_s: groups[0]?.reload_s ?? null,
        total_barrels: groups.reduce((n, g) => n + g.mounts * g.barrels_per_mount, 0),
        guns: groups.map(({ ammo, ...g }) => g),
        shells: ammo.map(shell),
      };
    }
    if (hull.secondaryModule?.guns?.length) {
      const groups = gunGroups(hull.secondaryModule.guns);
      out.secondaries = {
        range_km: km(hull.secondaryModule.maxRange),
        guns: groups.map(({ ammo, ...g }) => g),
        shells: [...new Set(groups.flatMap((g) => g.ammo))].map(shell),
      };
    }
    if (tor?.torpedoLaunchers?.length) {
      const groups = gunGroups(tor.torpedoLaunchers);
      out.torpedoes = {
        launchers: groups.map(({ ammo, ...g }) => g),
        total_tubes: groups.reduce((n, g) => n + g.mounts * g.barrels_per_mount, 0),
        reload_s: groups[0]?.reload_s ?? null,
        torpedoes: [...new Set(groups.flatMap((g) => g.ammo))].map(shell),
      };
    }
    const aa = hull.antiAir;
    if (aa && (aa.longRangeAura || aa.mediumRangeAura || aa.shortRangeAura)) {
      out.anti_air = { long_range: aura(aa.longRangeAura), medium_range: aura(aa.mediumRangeAura), short_range: aura(aa.shortRangeAura) };
    }
    if (hull.subBatteryCapacity) {
      out.submarine = { battery_capacity: num(hull.subBatteryCapacity), battery_regen_per_s: num(hull.subBatteryRegenRate), dive_speed_m_s: num(hull.diveSpeed) };
    }
    return out;
  }

  const planes = (s) => Object.entries(s.cvPlanes ?? {}).flatMap(([slot, list]) => list.map((id) => {
    const a = raw.aircraft[id.split("_")[0]];
    return {
      slot, id, name: name(id) ?? id, type: slot.replace(/^[A-Z]+\d*_/, ""),
      squadron_size: num(a?.numPlanesInSquadron), attackers_per_attack: num(a?.attackData?.attackerSize),
      plane_hp: num(a?.maxHealth), cruise_speed_knots: num(a?.speed), hangar: num(a?.maxPlaneInHangar),
      restoration_time_s: num(a?.restorationTime), payload: a?.bombName ? shell(a.bombName) : null,
    };
  }));

  const ships = Object.values(raw.ships).map((s) => {
    const sum = summaryByIndex[s.index] ?? {};
    const nm = shipName(s.index);
    const info = s.shipUpgradeInfo ?? {};
    return {
      index: s.index,
      id: s.id,
      name: nm,
      full_name: L[`${s.index}_FULL`] ?? nm,
      slug: `${slugify(nm) || "ship"}-${s.index.toLowerCase()}`,
      tier: s.tier,
      tier_roman: ROMAN[s.tier] ?? String(s.tier),
      class: classId(s.shipClass),
      nation: nationId(s.shipNation),
      category: CATEGORY[s.shipCategory] ?? s.shipCategory,
      description: L[`${s.index}_DESCR`] ?? null,
      price_credits: num(info.costCredits) || null,
      price_doubloons: num(info.costGold) || null,
      research_xp: num(info.costXp) || null,
      previous_ship: sum.prevShipIndex ? { index: sum.prevShipIndex, name: shipName(sum.prevShipIndex) } : null,
      next_ships: (sum.nextShipIndexes ?? []).map((i) => ({ index: i, name: shipName(i) })),
      consumables: consumables(s.shipConsumable),
      aircraft: planes(s),
      stock: configuration(s, "stock"),
      top: configuration(s, "top"),
    };
  }).sort((a, b) => a.nation.localeCompare(b.nation) || a.class.localeCompare(b.class) || a.tier - b.tier || a.name.localeCompare(b.name));
  return ships;
}

// ---------- output ----------
const abs = (p) => (SITE_URL ? `${SITE_URL}/${p}` : `/${p}`);
async function out(rel, data) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof data === "string" ? data : JSON.stringify(data) + "\n");
}
const csvCell = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (v, unit = "") => (v === null || v === undefined ? "n/a" : `${v}${unit}`);
const get = (o, k) => k.split(".").reduce((a, p) => (a == null ? null : a[p]), o);
const shellOf = (s, type) => s.top?.main_battery?.shells?.find((x) => x.type === type);

const FLAT = {
  index: (s) => s.index, name: (s) => s.name, tier: (s) => s.tier, class: (s) => s.class, nation: (s) => s.nation, category: (s) => s.category,
  hit_points: (s) => get(s, "top.hit_points"), max_speed_knots: (s) => get(s, "top.max_speed_knots"),
  rudder_shift_s: (s) => get(s, "top.rudder_shift_s"), turning_radius_m: (s) => get(s, "top.turning_radius_m"),
  detectability_by_ship_km: (s) => get(s, "top.detectability_by_ship_km"), detectability_by_plane_km: (s) => get(s, "top.detectability_by_plane_km"),
  main_battery_range_km: (s) => get(s, "top.main_battery.range_km"), main_battery_reload_s: (s) => get(s, "top.main_battery.reload_s"),
  main_battery_caliber_mm: (s) => get(s, "top.main_battery.guns.0.caliber_mm"), main_battery_barrels: (s) => get(s, "top.main_battery.total_barrels"),
  main_battery_traverse_180_s: (s) => get(s, "top.main_battery.guns.0.traverse_180_s"),
  he_damage: (s) => shellOf(s, "HE")?.damage, he_fire_chance_pct: (s) => shellOf(s, "HE")?.fire_chance_pct,
  ap_damage: (s) => shellOf(s, "AP")?.damage, sap_damage: (s) => shellOf(s, "SAP")?.damage,
  torpedo_range_km: (s) => get(s, "top.torpedoes.torpedoes.0.range_km"), torpedo_damage: (s) => get(s, "top.torpedoes.torpedoes.0.damage"),
  torpedo_speed_knots: (s) => get(s, "top.torpedoes.torpedoes.0.speed_knots"), torpedo_reload_s: (s) => get(s, "top.torpedoes.reload_s"),
  torpedo_tubes: (s) => get(s, "top.torpedoes.total_tubes"),
  secondary_range_km: (s) => get(s, "top.secondaries.range_km"),
  price_credits: (s) => s.price_credits, price_doubloons: (s) => s.price_doubloons,
};

function shipMarkdown(s, meta) {
  const c = s.top ?? {};
  const row = (k, v) => `| ${k} | ${v} |`;
  const lines = [
    `## ${s.name} — tier ${s.tier_roman} ${s.nation} ${s.class} (${s.category})`, "",
    `index: ${s.index} · json: ${abs(`api/ships/${s.index}.json`)}`, "",
    s.description ? `> ${s.description.replace(/\s*\n+\s*/g, " ")}\n` : "",
    `Fully upgraded (top) configuration, hull "${c.hull_module ?? "n/a"}". No upgrades, skills or signals applied. Stock values are in the JSON.`, "",
    "| stat | value |", "|---|---|",
    row("hit points", fmt(c.hit_points)), row("max speed", fmt(c.max_speed_knots, " kn")),
    row("rudder shift", fmt(c.rudder_shift_s, " s")), row("turning radius", fmt(c.turning_radius_m, " m")),
    row("detectability by ship", fmt(c.detectability_by_ship_km, " km")), row("detectability by plane", fmt(c.detectability_by_plane_km, " km")),
  ];
  const mb = c.main_battery;
  if (mb) {
    lines.push(row("main battery range", fmt(mb.range_km, " km")), row("main battery reload", fmt(mb.reload_s, " s")),
      ...mb.guns.map((g) => row("main guns", `${g.mounts}× ${g.name} (${g.caliber_mm} mm, ${g.barrels_per_mount} barrels each, 180° in ${fmt(g.traverse_180_s, " s")})`)),
      ...mb.shells.map((x) => row(`${x.type} shell`, `${x.name}: ${fmt(x.damage)} dmg, ${fmt(x.muzzle_velocity_m_s, " m/s")}${x.fire_chance_pct ? `, ${x.fire_chance_pct}% fire` : ""}${x.he_sap_penetration_mm ? `, ${x.he_sap_penetration_mm} mm pen` : ""}`)));
  }
  if (c.secondaries) lines.push(row("secondary range", fmt(c.secondaries.range_km, " km")));
  if (c.torpedoes) lines.push(row("torpedo tubes", `${c.torpedoes.total_tubes}, reload ${fmt(c.torpedoes.reload_s, " s")}`),
    ...c.torpedoes.torpedoes.map((t) => row("torpedo", `${t.name}: ${fmt(t.damage)} dmg, ${fmt(t.range_km, " km")}, ${fmt(t.speed_knots, " kn")}, seen at ${fmt(t.detectability_km, " km")}`)));
  if (c.anti_air) for (const [k, a] of Object.entries(c.anti_air)) if (a) lines.push(row(`AA ${k.replace("_", " ")}`, `${a.dps} dps to ${a.range_km} km`));
  for (const p of s.aircraft) lines.push(row(`aircraft (${p.type})`, `${p.name}: ${fmt(p.squadron_size)} per squadron, ${fmt(p.plane_hp)} HP each`));
  for (const slot of s.consumables) lines.push(row(`consumable slot ${slot.slot}`, slot.options.map((o) => `${o.name} (${o.charges ?? "?"} charges, ${fmt(o.reload_s, " s")} reload)`).join(" or ")));
  if (s.price_credits) lines.push(row("price", `${s.price_credits} credits`));
  if (s.price_doubloons) lines.push(row("price", `${s.price_doubloons} doubloons`));
  if (s.previous_ship) lines.push(row("researched from", s.previous_ship.name));
  if (s.next_ships.length) lines.push(row("leads to", s.next_ships.map((n) => n.name).join(", ")));
  lines.push("");
  return lines.join("\n");
}

// ---------- main ----------
const raw = await loadData();
const all = build(raw);
const ships = all.filter((s) => s.category !== "test_ship");
const testShips = all.filter((s) => s.category === "test_ship");
const cv = raw.version.currentVersion;
const meta = {
  generated_at: new Date().toISOString(),
  game_version: `${cv.mainVersion}.${cv.dataIteration}`,
  server: SERVER,
  ship_count: ships.length,
  source: "WoWs ShipBuilder public data (https://app.wowssb.com), extracted from the World of Warships game client",
  license_note: "Game data © Wargaming.net. Unofficial site, not affiliated with Wargaming or WoWs ShipBuilder.",
};
const summary = (s) => ({ index: s.index, name: s.name, tier: s.tier, class: s.class, nation: s.nation, category: s.category, url: abs(`api/ships/${s.index}.json`) });
const nationList = [...new Set(ships.map((s) => s.nation))].sort();
const classList = [...new Set(ships.map((s) => s.class))].sort();
const tiers = [...new Set(ships.map((s) => s.tier))].sort((a, b) => a - b);
const label = (map, id) => Object.values(map).find(([i]) => i === id)?.[1] ?? id;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await out("api/meta.json", meta);
await out("api/ships.json", { meta, ships });
await out("api/index.json", { meta, ships: ships.map(summary) });
await out("api/test-ships.json", { meta, note: "Ships marked TestShip in the game files: in testing or unreleased. Not normally available to players. Numbers may change.", ships: testShips });
await out("api/nations.json", { meta, nations: nationList.map((id) => ({ id, label: label(NATIONS, id), count: ships.filter((s) => s.nation === id).length, url: abs(`api/by-nation/${id}.json`) })) });
await out("api/classes.json", { meta, classes: classList.map((id) => ({ id, label: label(CLASSES, id), count: ships.filter((s) => s.class === id).length, url: abs(`api/by-class/${id}.json`) })) });
for (const s of all) await out(`api/ships/${s.index}.json`, { meta, ship: s });
for (const n of nationList) await out(`api/by-nation/${n}.json`, { meta, nation: n, ships: ships.filter((s) => s.nation === n) });
for (const c of classList) await out(`api/by-class/${c}.json`, { meta, class: c, ships: ships.filter((s) => s.class === c) });
for (const t of tiers) await out(`api/by-tier/${t}.json`, { meta, tier: t, ships: ships.filter((s) => s.tier === t) });
const names = {};
const addName = (k, s) => { const key = k.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim(); (names[key] ??= []).includes(s.index) || names[key].push(s.index); };
for (const s of ships) { addName(s.name, s); addName(s.full_name, s); }
await out("api/name-lookup.json", { meta, note: "Keys are lowercase names without accents. Values are ship indexes; use /api/ships/{index}.json. Several ships can share a name (e.g. event versions); check category and tier.", names });

await out("ships.jsonl", ships.map((s) => JSON.stringify(s)).join("\n") + "\n");
const cols = Object.keys(FLAT);
await out("ships.csv", [cols.join(","), ...ships.map((s) => cols.map((k) => csvCell(FLAT[k](s))).join(","))].join("\n") + "\n");
for (const s of all) await out(`ships/${s.slug}.md`, `---\nindex: ${s.index}\nname: ${JSON.stringify(s.name)}\ngame_version: ${meta.game_version}\n---\n\n` + shipMarkdown(s, meta));

await out("api/schema.json", {
  description: "Field reference for ship records in api/ships.json (ships[]), ships.jsonl (one per line) and api/ships/{index}.json (ship). Units are in field names. null = no value or the ship lacks that part.",
  ship: {
    index: "string, game ship code, primary key used in URLs (e.g. PJSB018 = Yamato)", id: "integer, numeric game id",
    name: "string, English short name", full_name: "string, English full name", slug: "string, used for /ships/{slug}.md",
    tier: "integer 1-11", tier_roman: "string", class: `one of: ${classList.join(", ")}`, nation: `one of: ${nationList.join(", ")}`,
    category: "tech_tree | premium | special (event, reward, coal/steel and similar ships)",
    description: "string|null, in-game historical description", price_credits: "integer|null", price_doubloons: "integer|null", research_xp: "integer|null",
    previous_ship: "{index,name}|null, tech-tree predecessor", next_ships: "[{index,name}], tech-tree successors",
    consumables: "[{slot, options:[{id, variant, name, charges ('unlimited' or integer), reload_s, duration_s}]}]; options in one slot are alternatives",
    aircraft: "[{slot, id, name, type, squadron_size, attackers_per_attack, plane_hp, cruise_speed_knots, hangar, restoration_time_s, payload}] (carriers and some hybrids)",
    stock: "configuration object, first (unresearched) modules",
    top: "configuration object, fully researched modules. Use this by default: it is what players normally compare.",
  },
  configuration: {
    hull_module: "string", hit_points: "integer", max_speed_knots: "number", rudder_shift_s: "number", turning_radius_m: "number",
    detectability_by_ship_km: "number, base surface detectability", detectability_by_plane_km: "number", tonnage_t: "number", length_m: "number",
    fire_spots: "integer", flooding_spots: "integer",
    main_battery: "{range_km, sigma, reload_s, total_barrels, guns:[{id,name,mounts,barrels_per_mount,caliber_mm,reload_s,traverse_180_s}], shells:[shell]}|null",
    secondaries: "{range_km, guns:[...], shells:[shell]}|null",
    torpedoes: "{launchers:[...], total_tubes, reload_s, torpedoes:[torpedo]}|null; several torpedoes = selectable alternatives",
    anti_air: "{long_range, medium_range, short_range: {dps, flak_damage, flak_bursts, hit_chance_pct, range_km}|null}|null",
    submarine: "{battery_capacity, battery_regen_per_s, dive_speed_m_s}|null",
  },
  shell: "{id, name, type: HE|AP|SAP, damage, caliber_mm, mass_kg, muzzle_velocity_m_s, fire_chance_pct, he_sap_penetration_mm, ap_krupp, ricochet_angles_deg:[start,always], fuse_time_s, arming_threshold_mm}",
  torpedo: "{id, name, type, damage, range_km, speed_knots, detectability_km, caliber_mm, can_not_hit_classes}",
  caveats: [
    "Base values only: no commander skills, upgrades (modernizations), signals or camouflage applied.",
    "stock/top picks modules by their letter (A_ = stock, last letter = top); ships with branching hulls use the last one.",
    "No player statistics (win rate, average damage). This is ship data only.",
    "Test ships (in development) are excluded from the main lists; see /api/test-ships.json.",
  ],
});

const base = SITE_URL;
await out("llms.txt", `# World of Warships ship data for AI agents

> Machine-readable World of Warships ship stats: ${ships.length} ships, game version ${meta.game_version}, generated ${meta.generated_at}. Extracted from the game client (via WoWs ShipBuilder's public data). Static JSON, JSONL, CSV and Markdown. No auth, no JavaScript.

How to answer common questions:
- One ship by name: look it up in ${base}/api/name-lookup.json (lowercase name -> ship indexes), then fetch ${base}/api/ships/{index}.json
- Compare or filter many ships: fetch ${base}/ships.csv (flat, ${cols.length} columns, top configuration) or ${base}/ships.jsonl (full records) once, then filter
- All ships of one tier, nation or class: ${base}/api/by-tier/{1-11}.json, ${base}/api/by-nation/{nation}.json, ${base}/api/by-class/{class}.json
- Field meanings and units: ${base}/api/schema.json. Units are in field names (max_speed_knots, reload_s, range_km).
- Each ship has "stock" and "top" (fully researched) configurations. Use "top" unless asked about stock.
- Values are base stats without skills, upgrades or signals. No player win rates here.

## API

- [Ship index](${base}/api/index.json): index, name, tier, class, nation, category and URL for every ship
- [Name lookup](${base}/api/name-lookup.json): name -> ship indexes
- [All ships, full records](${base}/api/ships.json)
- [Schema](${base}/api/schema.json): every field, unit and caveat
- [Nations](${base}/api/nations.json): ${nationList.join(", ")}
- [Classes](${base}/api/classes.json): ${classList.join(", ")}
- [Build info](${base}/api/meta.json)

## Bulk

- [ships.csv](${base}/ships.csv): columns ${cols.join(", ")}
- [ships.jsonl](${base}/ships.jsonl): one full ship record per line

## Optional

- [All ships as Markdown](${base}/llms-full.txt): readable stat sheet for every ship in one file
- [Test ships](${base}/api/test-ships.json): ${testShips.length} unreleased or in-testing ships, kept separate on purpose
`);
await out("llms-full.txt", `# World of Warships ship data (all ships)\n\nGame version ${meta.game_version}. Generated ${meta.generated_at}. Source: ${meta.source}. Top configuration, base values.\n\n` + ships.map((s) => shipMarkdown(s, meta)).join("\n"));

await out("robots.txt", `# AI crawlers and agents are welcome.\nUser-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
if (SITE_URL) {
  const urls = ["", "llms.txt", "llms-full.txt", "api/index.json", "api/schema.json", "ships.csv", ...ships.map((s) => `api/ships/${s.index}.json`), ...ships.map((s) => `ships/${s.slug}.md`)];
  await out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(`${SITE_URL}/${u}`)}</loc></url>`).join("\n")}\n</urlset>\n`);
}

const jsonld = {
  "@context": "https://schema.org", "@type": "Dataset", name: "World of Warships ship data for AI agents",
  description: `Base stats for ${ships.length} World of Warships ships (game version ${meta.game_version}) as JSON, JSONL, CSV and Markdown.`,
  dateModified: meta.generated_at, version: meta.game_version, isAccessibleForFree: true,
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs("api/ships.json") },
    { "@type": "DataDownload", encodingFormat: "application/jsonl", contentUrl: abs("ships.jsonl") },
    { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: abs("ships.csv") },
  ],
};
const tcols = ["index", "name", "tier", "class", "nation", "category", "hit_points", "max_speed_knots", "detectability_by_ship_km", "main_battery_range_km", "main_battery_reload_s", "torpedo_range_km"];
await out("index.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WoWs Data for AIs</title>
<meta name="description" content="Machine-readable World of Warships ship data for AI agents. Start at /llms.txt">
<link rel="alternate" type="text/plain" href="${abs("llms.txt")}" title="llms.txt">
<link rel="alternate" type="application/json" href="${abs("api/ships.json")}" title="All ships (JSON)">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>body{font:13px/1.4 ui-monospace,monospace;margin:16px;background:#fff;color:#111}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px;text-align:left;white-space:nowrap}.w{overflow-x:auto}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}td,th{border-color:#444}a{color:#8ab4f8}}</style>
</head><body>
<h1>World of Warships ship data for AI agents</h1>
<p>This site is for machines. AI agents: read <a href="${abs("llms.txt")}">/llms.txt</a> first. Fields and units: <a href="${abs("api/schema.json")}">/api/schema.json</a>. Bulk: <a href="${abs("ships.csv")}">ships.csv</a>, <a href="${abs("ships.jsonl")}">ships.jsonl</a>, <a href="${abs("api/ships.json")}">api/ships.json</a>.</p>
<p>ships=${ships.length}; game_version=${esc(meta.game_version)}; generated_at=${meta.generated_at}; configuration=top; values=base (no skills/upgrades)</p>
<div class="w"><table><thead><tr>${tcols.map((c) => `<th>${c}</th>`).join("")}<th>json</th><th>md</th></tr></thead><tbody>
${ships.map((s) => `<tr>${tcols.map((c) => `<td>${esc(fmt(FLAT[c](s)))}</td>`).join("")}<td><a href="${abs(`api/ships/${s.index}.json`)}">json</a></td><td><a href="${abs(`ships/${s.slug}.md`)}">md</a></td></tr>`).join("\n")}
</tbody></table></div>
<p>Source: ${esc(meta.source)}. ${esc(meta.license_note)}</p>
</body></html>
`);
await out(".nojekyll", "");
console.log(`Built ${ships.length} ships (+${testShips.length} test ships), game version ${meta.game_version}, into ${OUT}`);

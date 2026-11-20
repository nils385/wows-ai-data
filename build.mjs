#!/usr/bin/env node
// Builds WoWs Data, an unofficial World of Warships encyclopedia for players (static HTML),
// plus structured data files (JSON, CSV, Markdown) generated from the same records.
// AI-specific files (llms.txt, llms-full.txt) are only built with AI_GUIDE=1: Wargaming's Player
// Content Policy (2.9) does not allow Wargaming IP as AI training or input material without written consent.
//
//   node build.mjs                    download the newest game data, build into ./dist
//   node build.mjs --data-dir DIR     build from already downloaded data files
//
// Env: SITE_URL (absolute links), WOWS_SERVER (live|pts), OUT_DIR. Needs Node 18+, no packages.
// Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.

import { mkdir, writeFile, rm, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { loadGameData } from "./lib/data.mjs";
import { moduleKey, normalizeName, setConsumableTitles, allConfigurations, computeConfiguration, specialAbility, shellStats, weaponStats, cvPlane, describeModifier, slug, consumableSlots } from "./lib/ship.mjs";
import { flatten, metricInfo } from "./lib/metrics.mjs";
import { eligibleModernizations, skillsFor, signalFlags, changesWith, bestWithUpgrades, describeEffects, clean, upgradeName } from "./lib/analysis.mjs";
import { toMarkdown } from "./lib/markdown.mjs";
import { makeLayout, renderShipPage, CSS, JS, esc, nationLabel as nationLabelOf } from "./lib/site.mjs";
import { renderNotFound, renderHome, renderShipsIndex, renderRankingsIndex, renderRankingPage, renderTextPage, renderGuidesIndex, renderUpgradesPage, renderCompare, renderAbout, renderLegal, redirectPage, renderToolsIndex, renderBuildToolPage, renderGunneryPage } from "./lib/pages.mjs";
import { validate } from "./lib/validate.mjs";
import { buildKnowledge } from "./lib/knowledge.mjs";
import { shipToolData, commonToolData, captainToolData } from "./lib/tooldata.mjs";

const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const FINAL_OUT = path.resolve(process.env.OUT_DIR || "dist");
const OUT = `${FINAL_OUT}.staging`; // build here; replace FINAL_OUT only if everything succeeds
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const SERVER = process.env.WOWS_SERVER || "live";
const AI_GUIDE = process.env.AI_GUIDE === "1"; // off unless Wargaming has given written consent
const AI_NOTICE = "No permission is granted to use this site's content as training or input material for AI models, platforms, tools or systems (Wargaming Player Content Policy, section 2.9).";
const abs = (p) => `${SITE_URL}/${p}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const ctx = await loadGameData({ server: SERVER, dataDir: argVal("--data-dir") });
log("data loaded, game version", ctx.gameVersion);
const L = ctx.L;
setConsumableTitles(ctx.consumableTitles);

// ---------- names and ids ----------
const NATIONS = { Usa: ["usa", "U.S.A."], Japan: ["japan", "Japan"], Germany: ["germany", "Germany"], UnitedKingdom: ["united_kingdom", "U.K."], Russia: ["ussr", "U.S.S.R."], France: ["france", "France"], Italy: ["italy", "Italy"], PanAsia: ["pan_asia", "Pan-Asia"], Europe: ["europe", "Europe"], PanAmerica: ["pan_america", "Pan-America"], Netherlands: ["netherlands", "The Netherlands"], Commonwealth: ["commonwealth", "Commonwealth"], Spain: ["spain", "Spain"] };
const CLASSES = { Destroyer: ["destroyer", "Destroyer"], Cruiser: ["cruiser", "Cruiser"], Battleship: ["battleship", "Battleship"], AirCarrier: ["aircraft_carrier", "Aircraft Carrier"], Submarine: ["submarine", "Submarine"] };
const CATEGORY = { TechTree: "tech_tree", Premium: "premium", Special: "special", TestShip: "test_ship" };
const nationId = (n) => NATIONS[n]?.[0] ?? slug(n);
const classId = (c) => CLASSES[c]?.[0] ?? slug(c);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
const shipName = (i) => clean(L[i] ?? L[i?.toUpperCase()]) ?? i;
const rawName = Object.fromEntries(Object.values(ctx.ships).map((s) => [s.name, s.index]));
const summaryBy = Object.fromEntries(ctx.summary.map((s) => [s.index, s]));
const COMMON_NOTE = "Base values: no captain skills, upgrades, signals or camouflage unless a section says otherwise. Units are in field names. null = not applicable.";

// ---------- output ----------
let fileCount = 0;
async function out(rel, data) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof data === "string" ? data : JSON.stringify(data));
  fileCount++;
}
const md = (title, intro, body) => `# ${title}\n\n${intro ? intro + "\n\n" : ""}${body}\n`;

// Previous build from the live site, to record what changed (optional; ignored if unreachable).
async function fetchPrev(rel, parse) { if (!SITE_URL) return null; try { const r = await fetch(abs(rel)); if (!r.ok) return null; return parse(await r.text()); } catch { return null; } }
const previousRows = await fetchPrev("ships.jsonl", (t) => t.trim().split("\n").map((l) => JSON.parse(l)));
const previousHistory = await fetchPrev("changes/history.json", JSON.parse);
log(previousRows ? `previous build found: ${previousRows.length} ships` : "no previous build reachable");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const SCHEMA_VERSION = "2.0.0";
const meta = {
  schema_version: SCHEMA_VERSION,
  generated_at: new Date().toISOString(), game_version: ctx.gameVersion, server: SERVER,
  data_source: "WoWs ShipBuilder public game data (https://app.wowssb.com), extracted from the World of Warships game client every patch",
  calculations: "Stat formulas are a line-by-line port of WoWs ShipBuilder's open-source calculations (MIT license).",
  license_note: "Game data © Wargaming.net. Unofficial site, not affiliated with Wargaming or WoWs ShipBuilder.",
  ai_use_notice: AI_NOTICE,
};

// ---------- ships ----------
// Armor from the official wiki (snapshot committed in verification/, refreshed with tools/extract_wiki_armor.py)
const wikiArmorFile = JSON.parse(await readFile(new URL("./verification/wiki-armor.json", import.meta.url), "utf8").catch(() => "{}"));
// Plausibility check: some wiki armor tables are wrong (e.g. Iowa's lists a 38 mm "belt"; the real belt is about 307 mm).
// No battleship has a belt under 100 mm, so such a record is not used at all; it is listed in status.json instead.
const armorRejected = [];
const wikiArmor = Object.fromEntries(Object.entries(wikiArmorFile.ships ?? {}).filter(([i, a]) => {
  const bad = ctx.ships[i]?.shipClass === "Battleship" && typeof a.belt_mm === "number" && a.belt_mm < 100;
  if (bad) armorRejected.push({ index: i, wiki_page: a.wiki_page, belt_mm: a.belt_mm, reason: "battleship belt under 100 mm: the wiki table is almost certainly wrong" });
  return !bad;
}).map(([i, a]) => { const { wiki_page, ...rest } = a; return [i, { ...rest, source: wiki_page }]; }));
// Change tracking: only when the game data version differs from the previous build, and only for metrics present in both
// (so renamed or new fields on this site are never reported as game changes).
const prevBy = Object.fromEntries((previousRows ?? []).map((r) => [r.index, r]));
const prevVersion = previousRows?.[0]?.game_version ?? null;
const versionChanged = !!prevVersion && prevVersion !== ctx.gameVersion;
const oldEntries = Array.isArray(previousHistory?.entries) ? previousHistory.entries : [];
const historyStart = previousHistory?.started_with ?? prevVersion ?? ctx.gameVersion;
const changedShips = [];
function changesSincePrevious(index, flat) {
  const p = prevBy[index]?.metrics;
  if (!versionChanged || !p) return [];
  return Object.keys(flat).filter((k) => k in p && typeof p[k] === "number" && Math.abs(p[k] - flat[k]) > 1e-9).map((k) => ({ metric: k, before: p[k], after: flat[k] }));
}
const historyByShip = {};
for (const e of oldEntries) for (const c of e.ships_changed ?? []) (historyByShip[c.index] ??= []).push({ game_version: e.game_version, previous_game_version: e.previous_game_version, changes: c.changes });
function shipHistory(index, current) {
  const list = current.length ? [{ game_version: ctx.gameVersion, previous_game_version: prevVersion, changes: current }] : [];
  for (const h of historyByShip[index] ?? []) list.push(h);
  return list;
}
const configIssues = [], configWarnings = [];
let configsChecked = 0;
const rows = [];            // one per released ship, used for lists, CSV and rankings
const upgradedRows = [];    // best values reachable with upgrades
const testShips = [];
const shipPages = [];       // for name-based pages
// Human pages: one HTML page per ship at /ships/{name-index}/, built from the same record as JSON/Markdown.
const slugByIndex = Object.fromEntries(Object.values(ctx.ships).map((x) => [x.index, `${slug(shipName(x.index)) || "ship"}-${x.index.toLowerCase()}`]));
const ORIGIN = SITE_URL ? new URL(SITE_URL).origin : "";
const BASE_PATH = SITE_URL ? new URL(SITE_URL).pathname.replace(/\/$/, "") : ""; // e.g. "/wows-ai-data"
const shipHtml = (index) => `${BASE_PATH}/ships/${slugByIndex[index]}/`;
const layout = makeLayout({ base: BASE_PATH, site: SITE_URL, gameVersion: ctx.gameVersion, updated: meta.generated_at.slice(0, 10) });
const ships = Object.values(ctx.ships).sort((a, b) => a.index.localeCompare(b.index));
const toolTargets = {}; // armor and hull size per ship, for the gunnery tools
// main battery turrets in order from bow to stern (verticalPosition) and whether they face aft (baseAngle 180), to draw the 3D target
function turretList(ship, cfg) {
  const guns = ship.mainBatteryModuleList?.[moduleKey(cfg, "Artillery")]?.guns ?? [];
  return guns.length ? guns.map((g) => ({ order: g.verticalPosition ?? 0, aft: Math.abs(g.baseAngle ?? 0) >= 90 })) : null;
}
let done = 0;
for (const s of ships) {
  const sum = summaryBy[s.index] ?? {};
  const info = s.shipUpgradeInfo ?? {};
  const name = shipName(s.index);
  const base = {
    index: s.index, numeric_id: s.id, name, full_name: clean(L[`${s.index}_FULL`]) ?? name, slug: `${slug(name) || "ship"}-${s.index.toLowerCase()}`,
    tier: s.tier, tier_roman: ROMAN[s.tier] ?? String(s.tier), class: classId(s.shipClass), nation: nationId(s.shipNation),
    category: CATEGORY[s.shipCategory] ?? slug(s.shipCategory),
  };
  const configs = allConfigurations(s).map((c) => ({ ...c, stats: computeConfiguration(ctx, s, c.cfg, [], { tables: c.top || c.stock }) }));
  const top = configs.find((c) => c.top) ?? configs[configs.length - 1];
  const stock = configs.find((c) => c.stock) ?? configs[0];
  const topFlatRaw = flatten(top.stats);
  const armor = wikiArmor[s.index] ?? null;
  if (armor) for (const [k, v] of Object.entries(armor)) if (typeof v === "number") topFlatRaw[`armor.${k}`] = v;
  // alphabetical, so two ships' stat lists line up line by line
  let topFlat = Object.fromEntries(Object.entries(topFlatRaw).sort(([a], [b]) => a.localeCompare(b)));

  // upgrades
  const slots = eligibleModernizations(ctx, s);
  const perOption = [];
  const upgradeSlots = slots.map((sl) => ({
    slot: sl.slot + 1,
    options: sl.options.map((o) => {
      const changes = changesWith(ctx, s, top.cfg, topFlat, o.modifiers);
      perOption.push({ index: o.index, changes });
      return { index: o.index, name: upgradeName(L, o), type: slug(o.type), effects: describeEffects(L, o.modifiers), stat_changes: changes };
    }),
  }));
  const best = bestWithUpgrades(ctx, s, top.cfg, topFlat, slots, perOption);
  const skills = skillsFor(ctx, s).map((k) => ({
    name: k.name, point_cost: k.point_cost, row: k.row, column: k.column, epic: k.epic || undefined, description: k.description,
    effects: describeEffects(L, k.all_mods.filter((x) => !x.name.includes("_") || x.name.includes("_" + s.shipClass) || x.name.includes("invisible_"))),
    stat_changes: k.special ? undefined : changesWith(ctx, s, top.cfg, topFlat, k.mods),
    note: k.special ? "Effect depends on battle conditions (for example remaining HP or activations), so no fixed stat change is shown. See effects." : undefined,
    conditional_effects: k.conditional.length ? k.conditional : undefined,
  }));
  const flags = signalFlags(ctx).map((f) => ({ name: f.name, description: f.description, effects: describeEffects(L, f.mods), stat_changes: changesWith(ctx, s, top.cfg, topFlat, f.mods) }));

  // Derived stats players ask for most, computed with the same formulas (not hand math):
  const derived = {}, derivedNotes = {};
  for (const [t, sh] of Object.entries(top.stats.main_battery?.shells ?? {})) {
    for (const row of sh.ballistics_by_range ?? []) {
      if (![5, 10, 15, 20].includes(row.range_km)) continue;
      if (t.startsWith("ap")) derived[`main_battery.shells.${t}.penetration_at_${row.range_km}km_mm`] = row.penetration_mm;
      if (row.range_km === 10 || row.range_km === 15) derived[`main_battery.shells.${t}.flight_time_at_${row.range_km}km_s`] = row.flight_time_s;
    }
  }
  const allSkills = skillsFor(ctx, s);
  const ifhe = allSkills.find((k) => k.name === "Inertia Fuse for HE Shells");
  if (ifhe && topFlat["main_battery.shells.he.penetration_mm"] !== undefined) {
    const c = changesWith(ctx, s, top.cfg, topFlat, ifhe.mods).find((x) => x.metric === "main_battery.shells.he.penetration_mm");
    if (c) {
      derived["main_battery.shells.he.penetration_with_ifhe_mm"] = c.after; derivedNotes.ifhe = "with the captain skill Inertia Fuse for HE Shells";
      const fc = changesWith(ctx, s, top.cfg, topFlat, ifhe.mods).find((x) => x.metric === "main_battery.shells.he.fire_chance_pct");
      if (fc) derived["main_battery.shells.he.fire_chance_with_ifhe_pct"] = fc.after;
    }
  }
  const ce = allSkills.find((k) => k.name === "Concealment Expert");
  const csm = slots.flatMap((sl) => sl.options).find((o) => upgradeName(L, o) === "Concealment System Modification 1");
  const concMods = [...(ce?.mods ?? []), ...(csm?.modifiers ?? [])];
  if (concMods.length) {
    const f = flatten(computeConfiguration(ctx, s, top.cfg, concMods, { tables: false, accel: false }));
    derived["concealment.min_detectability_by_ships_km"] = f["concealment.detectability_by_ships_km"];
    derived["concealment.min_detectability_by_planes_km"] = f["concealment.detectability_by_planes_km"];
    derivedNotes.min_detectability = `with ${[ce ? "Concealment Expert (captain skill)" : null, csm ? "Concealment System Modification 1 (upgrade)" : null].filter(Boolean).join(" + ")}; no camouflage`;
  }
  topFlat = Object.fromEntries(Object.entries({ ...topFlat, ...derived }).sort(([a], [b]) => a.localeCompare(b)));
  const shipChanges = changesSincePrevious(s.index, topFlat);
  if (shipChanges.length && s.shipCategory !== "TestShip") changedShips.push({ index: s.index, name: shipName(s.index), tier: s.tier, class: classId(s.shipClass), nation: nationId(s.shipNation), changes: shipChanges });

  const record = {
    about: `World of Warships ship data for ${name}. ${COMMON_NOTE} "configurations.top" is fully researched modules (what players normally use); "configurations.stock" is unresearched.`,
    game_version: ctx.gameVersion, schema_version: SCHEMA_VERSION,
    ...base,
    description: clean(L[`${s.index}_DESCR`]),
    price_credits: info.costCredits || null, price_doubloons: info.costGold || null, research_xp: info.costXp || null,
    previous_ship: sum.prevShipIndex ? { index: sum.prevShipIndex, name: shipName(sum.prevShipIndex) } : null,
    next_ships: (sum.nextShipIndexes ?? []).map((i) => ({ index: i, name: shipName(i) })),
    special_ability: specialAbility(ctx, s),
    armor: armor ? { about: "Armor thickness from the official wiki (the game data used elsewhere has no armor values). Maximum per area; *_min_mm where the wiki gives a range.", ...armor } : null,
    stat_changes_history: { about: `Stat changes of this ship between game versions, detected by this site (history started with ${historyStart}). Newest first.`, entries: shipHistory(s.index, shipChanges) },
    configurations: { top: top.stats, stock: stock.stats },
    module_combinations: { count: configs.length, url: abs(`api/ships/${s.index}/configurations.json`), note: "Every combination of researchable modules, with full stats." },
    upgrades: {
      about: "Upgrades (modernizations) this ship can mount, per slot. One per slot. stat_changes = exact effect on the top configuration alone.",
      slots: upgradeSlots,
      best_possible_values: { about: "For each stat separately: base value, and the best value reachable for THAT stat with one upgrade per slot, plus which upgrades give it. Each stat may need a different set of upgrades, so these are not one combined build.", metrics: best },
    },
    captain_skills: { about: "Captain skills for this ship's class. stat_changes = effect of that one skill alone on the top configuration.", skills },
    signal_flags: { about: "Signal flags (all ships can mount any of these). stat_changes = effect of that one flag alone on the top configuration.", flags },
    all_metrics_top_configuration: topFlat,
    derived_metric_notes: Object.keys(derivedNotes).length ? derivedNotes : undefined,
  };
  await out(`api/ships/${s.index}.json`, record);
  const allConfigs = configs.map((c) => ({ id: c.id, is_stock: c.stock, is_top: c.top, module_ids: Object.fromEntries(Object.entries(c.cfg).sort(([a], [b]) => a.localeCompare(b)).map(([t, u]) => [slug(t), u.name])), stats: computeConfiguration(ctx, s, c.cfg, [], { tables: false, accel: true }) }));
  // checks on every module combination, not only the top one
  if (new Set(allConfigs.map((c) => c.id)).size !== allConfigs.length) configIssues.push(`${s.index}: duplicate configuration ids`);
  if (allConfigs.filter((c) => c.is_stock).length !== 1 || allConfigs.filter((c) => c.is_top).length !== 1) configIssues.push(`${s.index}: expected exactly one stock and one top configuration`);
  for (const c of allConfigs) {
    const f = flatten(c.stats);
    const bad = Object.entries(f).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
    if (bad.length) configIssues.push(`${s.index} ${c.id}: non-finite ${bad.slice(0, 3).join(", ")}`);
    if (!(f["survivability.hit_points"] > 0)) configIssues.push(`${s.index} ${c.id}: hit points missing`);
    if (JSON.stringify(c.stats).includes('"missing_data":true')) configWarnings.push(`${s.index} ${c.id}: a referenced projectile, aircraft or consumable is missing in the game data`);
  }
  configsChecked += allConfigs.length;
  if (s.shipCategory !== "TestShip") toolTargets[s.index] = { name, tier: s.tier, class: s.shipClass, nation: nationId(s.shipNation), armor: armor ? { belt_mm: armor.belt_mm, deck_mm: armor.deck_mm, extremities_mm: armor.extremities_mm, superstructure_mm: armor.superstructure_mm } : null, size_m: top.stats.hull_size_m ?? null, guns: !!top.stats.main_battery, turrets: turretList(s, top.cfg) };
  // input data for the interactive tools (the browser runs the same calculation code)
  await out(`api/build/ships/${s.index}.json`, shipToolData(ctx, s, { name, gameVersion: ctx.gameVersion }));
  await out(`api/ships/${s.index}/configurations.json`, {
    about: `Every module combination for ${name} with full stats. ${COMMON_NOTE}`, game_version: ctx.gameVersion, index: s.index, name, configurations: allConfigs,
  });
  // Small pages so AI fetch tools (which often cut pages at ~50-100 KB) can read them whole.
  const title = `${name} (tier ${base.tier_roman} ${base.nation} ${base.class}, ${base.category})`;
  const sp = `ships/${base.slug}`;
  const links = [
    `- All stats of the top configuration (this page, below)`,
    `- [Full details: top and stock configurations, every shell with penetration per km](${abs(`${sp}/details.md`)})`,
    `- [Upgrades: every option per slot with exact stat changes, best reachable values](${abs(`${sp}/upgrades.md`)})`,
    `- [Captain skills with exact stat changes](${abs(`${sp}/captain-skills.md`)})`,
    `- [Signal flags with exact stat changes](${abs(`${sp}/signal-flags.md`)})`,
    `- [Every module combination](${abs(`api/ships/${s.index}/configurations.json`)}) (${configs.length})`,
    `- [Everything as one JSON file](${abs(`api/ships/${s.index}.json`)}) (large)`,
  ].join("\n");
  const hist = record.stat_changes_history.entries;
  const histMd = hist.length
    ? hist.slice(0, 5).map((e) => `### ${e.previous_game_version} -> ${e.game_version}\n\n${e.changes.map((d) => `- ${d.metric}: ${d.before} -> ${d.after}`).join("\n")}`).join("\n\n")
    : `No stat changes recorded for this ship since history started (game version ${historyStart}).`;
  const summaryMd = md(title, `${COMMON_NOTE} Values are the top (fully researched) configuration.`,
    `game version: ${ctx.gameVersion} (data updated ${meta.generated_at.slice(0, 10)})\n` +
    `index: ${s.index}\nname: ${name}\nfull name: ${record.full_name}\ntier: ${base.tier}\nclass: ${base.class}\nnation: ${base.nation}\ncategory: ${base.category}\n` +
    `detectability: ${topFlat["concealment.detectability_by_ships_km"]} km by ships, ${topFlat["concealment.detectability_by_planes_km"]} km by planes` +
    (derivedNotes.min_detectability ? `; best ${topFlat["concealment.min_detectability_by_ships_km"]} km / ${topFlat["concealment.min_detectability_by_planes_km"]} km ${derivedNotes.min_detectability}` : "") + "\n" +
    (topFlat["main_battery.reload_s"] !== undefined ? `main battery: ${topFlat["main_battery.range_km"]} km range, ${topFlat["main_battery.reload_s"]} s reload, ${top.stats.main_battery.layout} ${top.stats.main_battery.caliber_mm} mm\n` : "") +
    (topFlat["main_battery.shells.he.penetration_mm"] !== undefined ? `HE penetration: ${topFlat["main_battery.shells.he.penetration_mm"]} mm${topFlat["main_battery.shells.he.penetration_with_ifhe_mm"] !== undefined ? ` (${topFlat["main_battery.shells.he.penetration_with_ifhe_mm"]} mm with Inertia Fuse for HE Shells, which also lowers HE fire chance from ${topFlat["main_battery.shells.he.fire_chance_pct"]}% to ${topFlat["main_battery.shells.he.fire_chance_with_ifhe_pct"] ?? "?"}%)` : ""}\n` : "") +
    (topFlat["main_battery.shells.ap.penetration_at_10km_mm"] !== undefined ? `AP penetration: ${[5, 10, 15, 20].filter((k) => topFlat[`main_battery.shells.ap.penetration_at_${k}km_mm`] !== undefined).map((k) => `${topFlat[`main_battery.shells.ap.penetration_at_${k}km_mm`]} mm at ${k} km`).join(", ")}\n` : "") +
    (top.stats.torpedoes ? `torpedoes: ${top.stats.torpedoes.layout} tubes, ${top.stats.torpedoes.reload_s} s reload; ${Object.values(top.stats.torpedoes.torpedoes).map((t) => `${t.name}: ${t.damage} damage, ${t.range_km} km, ${t.speed_knots} kn, seen at ${t.detectability_km} km`).join(" | ")}\n` : "") +
    (top.stats.aircraft ? `aircraft: ${Object.values(top.stats.aircraft).map((p) => `${p.name} (${p.type.replace(/_/g, " ")}, ${p.planes_in_squadron} per squadron, ${p.plane_hp} HP each)`).join("; ")}\n` : "") +
    (top.stats.sonar ? `sonar: ${top.stats.sonar.range_km} km range, ${top.stats.sonar.reload_s} s reload\n` : "") +
    (armor ? `armor (official wiki): belt ${armor.belt_mm ?? "n/a"} mm, deck ${armor.deck_mm ?? "n/a"} mm, extremities ${armor.extremities_mm ?? "n/a"} mm, superstructure ${armor.superstructure_mm ?? "n/a"} mm\n` : "armor: not available\n") +
    `price: ${record.price_credits ? record.price_credits + " credits" : record.price_doubloons ? record.price_doubloons + " doubloons" : "n/a"}\n` +
    `researched from: ${record.previous_ship?.name ?? "n/a"}\nleads to: ${record.next_ships.map((n) => n.name).join(", ") || "n/a"}\n` +
    `modules (top): ${Object.entries(top.stats.modules).map(([k, v]) => `${k}=${v}`).join("; ")}\n` +
    `consumables: ${top.stats.consumables.map((sl) => `slot ${sl.slot}: ${sl.options.map((o) => `${o.name} (${o.charges} charges, ${o.reload_s} s reload${o.duration_s ? `, ${o.duration_s} s` : ""})`).join(" or ")}`).join("; ")}\n` +
    (record.special_ability ? `special ability: ${record.special_ability.name}\n` : "") +
    `\n## More\n\n${links}\n\n## Changes between game versions\n\n${histMd}\n\n## All stats (metric: value)\n\nSorted alphabetically; metric names are the same on every ship page, in rankings and in ships.csv, so two ships can be compared line by line. Units are in the names.\n\n${Object.entries(topFlat).map(([k, v]) => `${k}: ${v}`).join("\n")}`);
  await out(`${sp}.md`, summaryMd);
  const similar = Object.values(ctx.ships).filter((x) => x.index !== s.index && x.tier === s.tier && x.shipClass === s.shipClass && x.shipCategory !== "TestShip").map((x) => ({ index: x.index, name: shipName(x.index), nation: nationId(x.shipNation), cat: x.shipCategory })).sort((a, b) => (a.nation !== nationId(s.shipNation)) - (b.nation !== nationId(s.shipNation)) || (a.cat !== "TechTree") - (b.cat !== "TechTree") || a.name.localeCompare(b.name));
  await out(`${sp}/index.html`, renderShipPage({ layout, base: BASE_PATH, similar, rec: { ...record, generated_at: meta.generated_at }, shipUrl: `${sp}/`, mdUrl: abs(`${sp}.md`), jsonUrl: abs(`api/ships/${s.index}.json`), configsUrl: abs(`api/ships/${s.index}/configurations.json`), related: shipHtml }));
  await out(`${sp}/details.md`, md(`${title}: full details`, `${COMMON_NOTE} Summary: ${abs(`${sp}.md`)}`, toMarkdown({ description: record.description, special_ability: record.special_ability, configurations: record.configurations })));
  const changeLine = (c) => `${c.metric}: ${c.before} -> ${c.after}${c.change_pct !== null ? ` (${c.change_pct > 0 ? "+" : ""}${c.change_pct}%)` : ""}${c.better === true ? " better" : c.better === false ? " worse" : ""}`;
  const optMd = (o) => `### ${o.name}\n\n${o.description ? o.description + "\n\n" : ""}effects: ${(o.effects ?? []).map((e) => `${e.display} ${e.label}`).join("; ") || "none listed"}\n\n${o.stat_changes?.length ? "stat changes on this ship:\n" + o.stat_changes.map((c) => "- " + changeLine(c)).join("\n") : o.note ?? "no stat this site calculates changes (the effect is listed above)"}\n${o.conditional_effects ? "\nconditional effects:\n" + o.conditional_effects.map((g) => `- when ${g.trigger}: ${g.effects.map((e) => `${e.display} ${e.label}`).join("; ")}`).join("\n") + "\n" : ""}`;
  await out(`${sp}/upgrades.md`, md(`${title}: upgrades`, `One upgrade per slot. Stat changes are for that upgrade alone on the top configuration. Combine multiplier effects by multiplying. Summary: ${abs(`${sp}.md`)}`,
    upgradeSlots.map((sl) => `## Slot ${sl.slot}\n\n${sl.options.map(optMd).join("\n")}`).join("\n") +
    `\n## Best reachable value per stat (one upgrade per slot)\n\nEach line is the best for that stat alone; different stats may need different upgrades, so this is not one combined build.\n\n${Object.entries(best).map(([k, b]) => `- ${k}: ${b.base} -> ${b.best} with ${b.upgrades.map((u) => `${u.name} (slot ${u.slot + 1})`).join(" + ")}`).join("\n")}`));
  await out(`${sp}/captain-skills.md`, md(`${title}: captain skills`, `Each skill alone on the top configuration. A captain has 21 points. Summary: ${abs(`${sp}.md`)}`,
    skills.map((k) => optMd({ ...k, name: `${k.name} (cost ${k.point_cost}, row ${k.row}, column ${k.column})` })).join("\n")));
  await out(`${sp}/signal-flags.md`, md(`${title}: signal flags`, `Each flag alone on the top configuration. Summary: ${abs(`${sp}.md`)}`, flags.map(optMd).join("\n")));
  shipPages.push({ name, slug: base.slug, index: s.index, tier: base.tier, class: base.class, nation: base.nation, category: base.category, test: s.shipCategory === "TestShip", summaryMd });

  const row = { ...base, url: abs(`api/ships/${s.index}.json`), metrics: topFlat };
  if (s.shipCategory === "TestShip") testShips.push(row); else {
    rows.push(row);
    const up = { ...topFlat };
    const via = {};
    for (const [k, b] of Object.entries(best)) if (b.best !== null) { up[k] = b.best; via[k] = b.upgrades.map((u) => u.name); }
    upgradedRows.push({ ...base, url: row.url, metrics: up, via });
  }
  if (++done % 100 === 0) log(`ships ${done}/${ships.length}`);
}
log("ships done");

// ---------- lists ----------
const listEntry = (r) => ({ index: r.index, name: r.name, tier: r.tier, class: r.class, nation: r.nation, category: r.category, url: r.url });
const nations = [...new Set(rows.map((r) => r.nation))].sort();
const classes = [...new Set(rows.map((r) => r.class))].sort();
const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => a - b);
meta.ship_count = rows.length;
meta.test_ship_count = testShips.length;
await out("api/meta.json", meta);
await out("api/index.json", { about: "Every released ship. Fetch url for full data.", ...meta, ships: rows.map(listEntry) });
await out("api/test-ships.json", { about: "Ships marked as test ships in the game files: in development or not normally available. Kept out of all lists and rankings. Numbers may change.", ships: testShips.map(listEntry) });
const names = {};
const addName = (k, i) => { const key = normalizeName(k); if (!(names[key] ??= []).includes(i)) names[key].push(i); };
for (const r of rows) addName(r.name, r.index);
for (const s of Object.values(ctx.ships)) if (s.shipCategory !== "TestShip") addName(clean(L[`${s.index}_FULL`]) ?? shipName(s.index), s.index);
await out("api/name-lookup.json", { about: "Lowercase ship name (accents removed) -> ship indexes. Several ships can share a name (event or alternate versions): check tier and category in api/index.json.", names });
// Name-based pages: /ship/{name}.md. Several ships with one name -> a short page listing them.
const byName = {};
for (const p of shipPages.filter((p) => !p.test)) (byName[slug(p.name) || p.index.toLowerCase()] ??= []).push(p);
for (const [n, list] of Object.entries(byName)) {
  if (list.length === 1) { await out(`ship/${n}.md`, list[0].summaryMd); await out(`ship/${n}/index.html`, redirectPage({ to: ORIGIN + shipHtml(list[0].index), title: list[0].name })); }
  else {
    await out(`ship/${n}/index.html`, layout({ title: `${list[0].name}: several ships`, description: `Several World of Warships ships are called ${list[0].name}.`, path: `ship/${n}/`, crumbs: [["Ships", "ships/"]], body: `<h1>Several ships are called “${esc(list[0].name)}”</h1><ul>${list.map((p) => `<li><a href="${shipHtml(p.index)}">${esc(p.name)}</a>, tier ${p.tier} ${esc(p.nation)} ${esc(p.class)} (${esc(p.category)})</li>`).join("")}</ul>` }));
    await out(`ship/${n}.md`, md(`Several ships are called "${list[0].name}"`, "Pick one:", list.map((p) => `- [${p.name}, tier ${p.tier} ${p.nation} ${p.class}, ${p.category}](${abs(`ships/${p.slug}.md`)})`).join("\n")));
  }
}
const shipLine = (r) => `| ${r.name} | ${r.tier} | ${r.class} | ${r.nation} | ${r.category} | ${abs(`ship/${slug(r.name) || r.index.toLowerCase()}.md`)} |`;
const shipTable = (list) => `| name | tier | class | nation | category | page |\n|---|---|---|---|---|---|\n${list.map(shipLine).join("\n")}`;
await out("ships.md", md("All ships", `${rows.length} released ships. Page per ship: ${abs("ship/{name}.md")} (lowercase, spaces and symbols become _). Split lists: ${abs("ships/class/{class}.md")}.`,
  classes.map((c) => `- [${c}](${abs(`ships/class/${c}.md`)}): ${rows.filter((r) => r.class === c).length} ships`).join("\n")));
for (const c of classes) await out(`ships/class/${c}.md`, md(`All ${c} ships`, "Sorted by tier, then nation.", shipTable(rows.filter((r) => r.class === c).sort((a, b) => a.tier - b.tier || a.nation.localeCompare(b.nation) || a.name.localeCompare(b.name)))));
// All stats split by class and tier, so each file is small enough to read whole.
const statsBlock = (r) => `## ${r.name} | index ${r.index} | tier ${r.tier} | ${r.class} | ${r.nation} | ${r.category}\n\n${Object.entries(r.metrics).map(([k, v]) => `${k}: ${v}`).join("\n")}\n`;
const statFiles = [];
for (const c of classes) for (const t of tiers) {
  for (const n of nations) {
    const list = rows.filter((r) => r.class === c && r.tier === t && r.nation === n);
    if (!list.length) continue;
    await out(`all-stats/${c}/tier-${t}/${n}.txt`, `# All stats: tier ${t} ${n} ${c}s (${list.length} ships)\n\nTop configuration, base values. ${COMMON_NOTE}\n\n${list.map(statsBlock).join("\n")}`);
    statFiles.push({ c, t, n, count: list.length });
  }
}
await out("all-stats/index.md", md("All stats of all ships, split by class, tier and nation", `Each file lists every ship of one class, tier and nation with every stat as "metric: value" (small enough to read whole). URL pattern: ${abs("all-stats/{class}/tier-{n}/{nation}.txt")}. ${AI_GUIDE ? `Everything in one file (very large): ${abs("llms-full.txt")}` : ""}`,
  classes.map((c) => `## ${c}\n\n${tiers.filter((t) => statFiles.some((f) => f.c === c && f.t === t)).map((t) => `- tier ${t}: ${statFiles.filter((f) => f.c === c && f.t === t).map((f) => `[${f.n}](${abs(`all-stats/${c}/tier-${t}/${f.n}.txt`)}) (${f.count})`).join(", ")}`).join("\n")}`).join("\n\n")));

for (const [kind, key, values] of [["by-nation", "nation", nations], ["by-class", "class", classes], ["by-tier", "tier", tiers]]) {
  for (const v of values) {
    const list = rows.filter((r) => r[key] === v);
    await out(`api/${kind}/${v}.json`, { about: `All released ships where ${key} = ${v}, with every metric of the top configuration.`, game_version: ctx.gameVersion, [key]: v, ships: list.map((r) => ({ ...listEntry(r), metrics: r.metrics })) });
  }
}
await out("api/nations.json", { nations: nations.map((n) => ({ id: n, label: Object.values(NATIONS).find(([i]) => i === n)?.[1] ?? n, ships: rows.filter((r) => r.nation === n).length, url: abs(`api/by-nation/${n}.json`) })) });
await out("api/classes.json", { classes: classes.map((c) => ({ id: c, label: Object.values(CLASSES).find(([i]) => i === c)?.[1] ?? c, ships: rows.filter((r) => r.class === c).length, url: abs(`api/by-class/${c}.json`) })) });

// ---------- bulk ----------
const allMetrics = [...new Set(rows.flatMap((r) => Object.keys(r.metrics)))].sort();
const csvCell = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const infoCols = ["index", "name", "tier", "class", "nation", "category"];
await out("ships.csv", [[...infoCols, ...allMetrics].join(","), ...rows.map((r) => [...infoCols.map((c) => csvCell(r[c])), ...allMetrics.map((m) => csvCell(r.metrics[m]))].join(","))].join("\n") + "\n");
await out("ships.jsonl", rows.map((r) => JSON.stringify({ ...listEntry(r), game_version: ctx.gameVersion, metrics: r.metrics })).join("\n") + "\n");
// ---------- knowledge pages and change history ----------
const wikiTerms = JSON.parse(await readFile(new URL("./verification/wiki-terminology.json", import.meta.url), "utf8").catch(() => "{}")).terms ?? [];
const COMMUNITY_VERSION = "15.10.1"; // game version when lib/community.md was last collected
let communityMd = (await readFile(new URL("./lib/community.md", import.meta.url), "utf8").catch(() => "")).replaceAll("{BASE}", SITE_URL).replaceAll("{VERSION}", COMMUNITY_VERSION);
if (communityMd && COMMUNITY_VERSION !== ctx.gameVersion) communityMd = communityMd.replace(/^(# .*\n)/, `$1\n**Warning: collected for game version ${COMMUNITY_VERSION}; the game is now on ${ctx.gameVersion}. Ships, skills or upgrades may have changed since. Check ${abs("changes/index.md")} and say the advice may be outdated.**\n`);
const knowledge = buildKnowledge({ ctx, rows, abs, md, slug, terms: wikiTerms, community: communityMd });
for (const [rel, body] of knowledge.pages) await out(rel, body);
const knowledgePage = Object.fromEntries(knowledge.pages);
// Alias pages: full names and community nicknames -> the ship's page (only if the alias is not a ship name itself)
{
  const pageByName = Object.fromEntries(shipPages.filter((p) => !p.test).map((p) => [p.name, p]));
  const taken = new Set(Object.keys(byName));
  const fullNames = shipPages.filter((p) => !p.test).map((p) => [clean(L[`${p.index}_FULL`]), p.name]).filter(([f, n]) => f && f !== n);
  for (const [alias, name] of [...fullNames, ...knowledge.aliases]) {
    for (const part of String(alias).split(/\s*\/\s*/)) {
      const key = slug(part);
      const p = pageByName[name];
      if (!key || !p || taken.has(key)) continue;
      taken.add(key);
      await out(`ship/${key}.md`, `> "${part}" is another name for ${name}. This is the same page as ${abs(`ship/${slug(name) || p.index.toLowerCase()}.md`)}.\n\n` + p.summaryMd);
      await out(`ship/${key}/index.html`, redirectPage({ to: ORIGIN + shipHtml(p.index), title: name }));
    }
  }
}
if (knowledge.dropped.length) log("glossary entries dropped (not found in game data):", knowledge.dropped.join(", "));
let entry = null;
if (versionChanged) {
  const curIdx = new Set(rows.map((r) => r.index));
  entry = {
    game_version: ctx.gameVersion, previous_game_version: prevVersion, detected_at: meta.generated_at,
    ships_added: rows.filter((r) => !prevBy[r.index]).map((r) => ({ index: r.index, name: r.name, tier: r.tier, class: r.class, nation: r.nation })),
    ships_removed: (previousRows ?? []).filter((r) => !curIdx.has(r.index)).map((r) => ({ index: r.index, name: r.name })),
    ships_changed: changedShips,
  };
  if (!entry.ships_added.length && !entry.ships_removed.length && !entry.ships_changed.length) entry = null;
}
const history = { started_with: historyStart, entries: entry ? [entry, ...oldEntries].slice(0, 60) : oldEntries };
for (const e of history.entries) {
  await out(`changes/${e.game_version}.md`, md(`Changes in game version ${e.game_version}`, `Compared with ${e.previous_game_version}. Base stats, top configuration.`, entryMd(e)));
}
await out("changes/history.json", { about: "Stat changes detected between builds of this site (each build uses the newest game data). Newest first.", ...history });
function entryMd(e) {
  return `## ${e.previous_game_version ?? "?"} -> ${e.game_version} (detected ${e.detected_at.slice(0, 10)})\n\n` +
  (e.ships_added.length ? `New ships: ${e.ships_added.map((x) => `${x.name} (tier ${x.tier} ${x.nation} ${x.class})`).join(", ")}\n\n` : "") +
  (e.ships_removed.length ? `Removed ships: ${e.ships_removed.map((x) => x.name).join(", ")}\n\n` : "") +
  e.ships_changed.map((c) => `### ${c.name} (tier ${c.tier} ${c.nation} ${c.class})\n\n${c.changes.map((d) => `- ${d.metric}: ${d.before} -> ${d.after}`).join("\n")}`).join("\n\n");
}
const changesMd = md("What changed between game versions", `Detected by comparing each build of this site with the previous one. History started with game version ${history.started_with}. JSON: ${abs("changes/history.json")}`,
  history.entries.length ? history.entries.map(entryMd).join("\n\n") : `No changes recorded yet: this site started recording with game version ${history.started_with}. The first change will appear here after the next patch. For earlier patches, see the official patch notes at https://worldofwarships.com/en/news/ (updates are listed as "Update X.Y").`);
await out("changes/index.md", changesMd);
const llmsFull = `# All World of Warships ships with all their stats\n\nGame version ${ctx.gameVersion}. ${rows.length} ships. Top (fully researched) configuration, base values: ${COMMON_NOTE} Metric names are the same as in the rankings and ships.csv. Full details per ship: ${abs("api/ships/{index}.json")}\n\n` +
  rows.map((r) => `## ${r.name} | index ${r.index} | tier ${r.tier} | ${r.class} | ${r.nation} | ${r.category}\n\n${Object.entries(r.metrics).map(([k, v]) => `${k}: ${v}`).join("\n")}\n`).join("\n");
const llmsFullBytes = Buffer.byteLength(llmsFull);
if (AI_GUIDE) await out("llms-full.txt", llmsFull);
log("lists and bulk done");

// ---------- rankings ----------
function rank(list, metric, direction) {
  const withV = list.filter((r) => typeof r.metrics[metric] === "number");
  withV.sort((a, b) => (direction === "lower_is_better" ? a.metrics[metric] - b.metrics[metric] : b.metrics[metric] - a.metrics[metric]) || a.name.localeCompare(b.name));
  let prev = null, prevRank = 0;
  return withV.map((r, i) => {
    const v = r.metrics[metric];
    const rk = v === prev ? prevRank : i + 1;
    prev = v; prevRank = rk;
    return { rank: rk, index: r.index, name: r.name, tier: r.tier, class: r.class, nation: r.nation, category: r.category, value: v, ...(r.via?.[metric] ? { upgrades_used: r.via[metric] } : {}) };
  });
}
const rankingRule = (d) => (d === "lower_is_better" ? "rank 1 = lowest value (lower is better)" : d === "higher_is_better" ? "rank 1 = highest value (higher is better)" : "rank 1 = highest value (no better/worse direction for this stat)");
const metricIndex = [];
for (const [family, list, label] of [["rankings", rows, "base stats, top configuration"], ["rankings-with-upgrades", upgradedRows, "best value reachable with upgrades, top configuration"]]) {
  const metrics = family === "rankings" ? allMetrics : [...new Set(upgradedRows.flatMap((r) => Object.keys(r.via)))].sort();
  for (const m of metrics) {
    const { unit, direction } = metricInfo(m);
    const all = rank(list, m, direction);
    if (all.length < 2) continue;
    const head = { metric: m, unit, direction, ranking_rule: rankingRule(direction), values: label, game_version: ctx.gameVersion };
    await out(`api/${family}/${m}.json`, { about: `All released ships ranked by ${m}. To filter by several nations, classes or tiers, keep only matching rows: the order stays correct.`, ...head, count: all.length, ships: all });
    await out(`${family}/${m}.md`, md(`Ranking: ${m}`, `${label}. ${rankingRule(direction)}. Unit: ${unit ?? "none"}. JSON: ${abs(`api/${family}/${m}.json`)}`,
      `| rank | ship | tier | class | nation | category | value${family === "rankings" ? "" : " | upgrades used"} |\n|---|---|---|---|---|---|---${family === "rankings" ? "" : "|---"}|\n` + all.map((r) => `| ${r.rank} | ${r.name} | ${r.tier} | ${r.class} | ${r.nation} | ${r.category} | ${r.value}${family === "rankings" ? "" : ` | ${(r.upgrades_used ?? []).join(" + ") || "none"}`} |`).join("\n")));
    const filtered = async (rel, rowsF, what) => {
      const rk = rank(rowsF, m, direction);
      if (rk.length >= 2) await out(`api/${family}/${m}/${rel}.json`, { about: `Ships ranked by ${m}, only ${what}.`, ...head, count: rk.length, ships: rk });
      return rk.length >= 2;
    };
    const avail = { classes: [], class_tiers: [], tiers: [], nations: [] };
    for (const c of classes) {
      if (await filtered(`class/${c}`, list.filter((r) => r.class === c), `class ${c}`)) avail.classes.push(c);
      for (const t of tiers) if (await filtered(`class/${c}/tier-${t}`, list.filter((r) => r.class === c && r.tier === t), `class ${c}, tier ${t}`)) avail.class_tiers.push(`${c}/tier-${t}`);
    }
    for (const t of tiers) if (await filtered(`tier/${t}`, list.filter((r) => r.tier === t), `tier ${t}`)) avail.tiers.push(t);
    for (const n of nations) if (await filtered(`nation/${n}`, list.filter((r) => r.nation === n), `nation ${n}`)) avail.nations.push(n);
    avail.class_nations = [];
    for (const c of classes) for (const n of nations) if (await filtered(`class/${c}/nation/${n}`, list.filter((r) => r.class === c && r.nation === n), `class ${c}, nation ${n}`)) avail.class_nations.push(`${c}/nation/${n}`);
    metricIndex.push({ family, metric: m, unit, direction, ships: all.length, url: abs(`api/${family}/${m}.json`), markdown: abs(`${family}/${m}.md`), filtered: avail });
  }
  log(`${family} done`);
}
// Rankings index split by topic, so every page is small. Filtered versions follow one URL pattern.
const FILTER_HELP = `Filtered versions (ranks recomputed inside the filter): replace ".json" with "/class/{class}.json", "/class/{class}/tier-{n}.json", "/class/{class}/nation/{nation}.json", "/tier/{n}.json" or "/nation/{nation}.json" (only lists with 2+ ships exist). For several nations at once, fetch the full list and keep those nations; the order stays correct. Markdown version of each full list: ${abs("rankings/{metric}.md")} (with upgrades: ${abs("rankings-with-upgrades/{metric}.md")}).`;
const groupOf = (m) => m.split(".")[0];
const groups = [...new Set(metricIndex.map((r) => groupOf(r.metric)))].sort();
const groupSummary = [];
for (const g of groups) {
  const items = metricIndex.filter((r) => groupOf(r.metric) === g);
  const compact = items.map((r) => ({ family: r.family, metric: r.metric, unit: r.unit, direction: r.direction, ships: r.ships, url: r.url }));
  await out(`api/rankings/groups/${g}.json`, { about: `Rankings for "${g}" stats. ${FILTER_HELP}`, game_version: ctx.gameVersion, rankings: compact });
  const line = (r) => `- ${r.metric} (${r.unit ?? "no unit"}, ${r.direction.replace(/_/g, " ")}, ${r.ships} ships): ${r.markdown}`;
  await out(`rankings/groups/${g}.md`, md(`Rankings: ${g}`, FILTER_HELP,
    `## Base stats\n\n${items.filter((r) => r.family === "rankings").map(line).join("\n") || "none"}\n\n## Best value reachable with upgrades\n\n${items.filter((r) => r.family !== "rankings").map(line).join("\n") || "none"}`));
  groupSummary.push({ group: g, rankings: items.length, markdown: abs(`rankings/groups/${g}.md`), json: abs(`api/rankings/groups/${g}.json`) });
}
await out("api/rankings/index.json", {
  about: `Every numeric stat of every ship is ranked (nothing hand-picked), grouped by topic. 'rankings' = base stats, 'rankings-with-upgrades' = best value reachable with upgrades. Open a group to see its rankings. ${FILTER_HELP}`,
  game_version: ctx.gameVersion, total_rankings: metricIndex.length, url_pattern: abs("api/rankings/{metric}.json"), groups: groupSummary,
});
await out("rankings/index.md", md("All rankings", `${metricIndex.length} rankings, grouped by topic. ${FILTER_HELP}`, groupSummary.map((g) => `- [${g.group}](${g.markdown}): ${g.rankings} rankings`).join("\n")));

// ---------- extra datasets ----------
const nationName = (n) => nationId(n);
const upgradesDoc = {
  about: "Every upgrade (modernization) in the game, with its effects and which ships can mount it. Slot numbers start at 1.", game_version: ctx.gameVersion,
  upgrades: Object.values(ctx.modernizations).sort((a, b) => a.slot - b.slot || a.index.localeCompare(b.index)).map((m) => ({
    index: m.index, name: upgradeName(L, m), slot: m.slot + 1, type: slug(m.type), description: clean(L[`DESC_${m.name}`.toUpperCase()]),
    tiers: m.shipLevel, classes: (m.shipClasses ?? []).map(classId), nations: (m.allowedNations ?? []).map(nationName),
    also_on_ships: (m.additionalShips ?? []).map((n) => shipName(rawName[n] ?? n)), not_on_ships: (m.blacklistedShips ?? []).map((n) => shipName(rawName[n] ?? n)),
    effects: describeEffects(L, m.modifiers ?? []),
  })),
};
const upgradesData = upgradesDoc.upgrades;
await out("api/upgrades.json", upgradesDoc);
const captain = ctx.captains?.["Common.json"]?.Default;
const skillsByClass = {};
for (const c of Object.keys(CLASSES)) {
  const fake = { shipClass: c, tier: 10, index: "", name: "" };
  skillsByClass[classId(c)] = skillsFor(ctx, fake).map((k) => ({ name: k.name, point_cost: k.point_cost, row: k.row, column: k.column, epic: k.epic || undefined, description: k.description, effects: describeEffects(L, k.all_mods.filter((x) => !x.name.includes("_") || x.name.includes("_" + c) || x.name.includes("invisible_"))), conditional_effects: k.conditional.length ? k.conditional : undefined }));
}
await out("api/captain-skills.json", { about: "Captain skills per ship class: point cost, position in the skill grid (row/column), effects and conditional effects. A captain has 21 points.", game_version: ctx.gameVersion, skills_by_class: skillsByClass });
await out("api/signal-flags.json", { about: "Signal flags and their effects.", game_version: ctx.gameVersion, flags: signalFlags(ctx).map((f) => ({ index: f.index, name: f.name, description: f.description, effects: describeEffects(L, f.mods) })) });
const consumableList = Object.entries(ctx.abilities).map(([key, a]) => {
  const [slotList] = consumableSlots(ctx, [{ slot: 0, consumableName: a.name, consumableVariantName: a.consumableVariantName }], [], a.group === "plane", 0, "Cruiser");
  return { variant_key: key, ...slotList.options[0], used_by: a.group === "plane" ? "aircraft" : "ship" };
}).sort((x, y) => x.variant_key.localeCompare(y.variant_key));
await out("api/consumables.json", { about: "Every consumable variant: charges, reload, duration and effects (base values). Ships list their exact variants in their own file. Repair Party HP values need a ship's HP, so they are only in ship files.", game_version: ctx.gameVersion, consumables: consumableList });
const projectiles = Object.keys(ctx.projectiles).sort().map((id) => {
  const p = ctx.projectiles[id];
  return p.projectileType === "Artillery" ? { kind: "shell", ...shellStats(ctx, id, [], 1, 1, "Main") } : weaponStats(ctx, id, [], p.projectileType !== "Torpedo" ? true : false);
});
await out("api/projectiles.json", { about: "Every shell, torpedo, bomb, rocket and depth charge in the game, base values. fire_chance_per_salvo_pct here assumes 1 barrel.", game_version: ctx.gameVersion, projectiles });
await out("api/aircraft.json", { about: "Every aircraft type (carrier squadrons, airstrikes, consumable planes), base values.", game_version: ctx.gameVersion, aircraft: Object.values(ctx.aircraft).sort((a, b) => a.index.localeCompare(b.index)).map((a) => ({ category: slug(a.planeCategory), ...cvPlane(ctx, a.name, 10, []) })) });
log("datasets done");

// ---------- validation ----------
const report = validate({ rows, testShips, ctx, metricIndex });
report.checks.push({ name: "every module combination: unique ids, one stock and one top, finite numbers, hit points", level: "error", checked: configsChecked, failures: configIssues.length, examples: configIssues.slice(0, 20) });
report.checks.push({ name: "every module combination: all referenced projectiles, aircraft and consumables exist", level: "warning", checked: configsChecked, failures: configWarnings.length, examples: configWarnings.slice(0, 20) });
report.errors.push(...configIssues); report.warnings.push(...configWarnings);
report.error_count = report.errors.length; report.warning_count = report.warnings.length; report.passed = report.errors.length === 0;
await out("api/validation.json", report);
let verification = null;
try { verification = JSON.parse(await readFile("verification/wiki-crosscheck.json", "utf8")); await out("api/verification.json", verification); } catch { /* optional */ }
const statusDoc = {
  about: "Read this to decide how much to trust the data right now.", ai_use_notice: AI_NOTICE,
  schema_version: SCHEMA_VERSION, game_version: ctx.gameVersion, server: SERVER, generated_at: meta.generated_at,
  data_source: "game files via WoWs ShipBuilder, every file checksum-verified",
  wiki_armor_not_used: { about: "Wiki armor tables that failed a plausibility check and are not shown.", count: armorRejected.length, ships: armorRejected },
  validation: { passed: report.passed, errors: report.error_count, warnings: report.warning_count, report: abs("api/validation.json") },
  wiki_crosscheck: verification ? { checked_on: verification.checked_on ?? null, ships_compared: verification.ships_compared, values_compared: verification.values_compared,
    match_rate_any_module_pct: verification.match_rate_pct, match_rate_top_configuration_pct: verification.strict?.match_rate_pct ?? null, report: abs("api/verification.json"),
    note: "Most remaining differences are outdated wiki pages; see the report's assessment." } : null,
  armor_source: "official wiki snapshot (not updated automatically)", community_page: "manually collected opinion, may be older than the current game version",
};
await out("api/status.json", statusDoc);

// ---------- schema, llms.txt, index ----------
const UNIT_WORDS = { s: "seconds", km: "kilometres", m: "metres", mm: "millimetres", kg: "kilograms", knots: "knots", pct: "percent", pct_change: "percent change", deg: "degrees", deg_per_s: "degrees per second", m_per_s: "metres per second", m_s: "metres per second", hp: "hit points", hp_per_s: "hit points per second", t: "tonnes", per_s: "per second", per_min: "per minute" };
function describeMetric(m) {
  const { unit } = metricInfo(m);
  const parts = m.split(".").map((x) => x.replace(unit ? new RegExp(`_${unit}$`) : /^$/, "").replace(/_/g, " "));
  let text = `${parts.slice(0, -1).join(" > ")}${parts.length > 1 ? ": " : ""}${parts.at(-1)}${unit ? ` (${UNIT_WORDS[unit] ?? unit})` : ""}`;
  if (m.startsWith("armor.")) text += ". Maximum armor thickness in that area, from the official wiki.";
  if (m.startsWith("consumables.")) text += ". Only ships that carry this consumable have a value.";
  if (m.endsWith("min_detectability_by_ships_km") || m.endsWith("min_detectability_by_planes_km")) text += ". With Concealment Expert and Concealment System Modification 1 where the ship can use them; no camouflage.";
  if (m.endsWith("penetration_with_ifhe_mm")) text += ". With the captain skill Inertia Fuse for HE Shells.";
  if (/penetration_at_\d+km_mm$/.test(m)) text += ". Raw penetration against a plate hit straight on; at long range the steeper fall angle makes vertical belts effectively thicker.";
  if (m.endsWith("reaction_time_s")) text += ". Seconds between the torpedo being seen and reaching the ship (detectability / speed); for homing torpedoes, before homing starts.";
  if (m.endsWith("fire_chance_with_ifhe_pct")) text += ". HE fire chance after Inertia Fuse for HE Shells, which lowers it.";
  if (m.endsWith("flooding_chance_pct")) text += ". Base flooding chance from the game files before the target's torpedo protection reduces it, so values over 100% are normal.";
  if (m.includes("depth_charge") && m.endsWith("explosion_radius_m")) text += ". Value as stored in the game files and shown by ShipBuilder; it looks large and has not been verified independently.";
  return text;
}
const metricKind = (m) => /damage_per_minute|potential_fires|salvo_damage/.test(m) ? "theoretical (every shell hits)" : /min_detectability|with_ifhe/.test(m) ? "with skills/upgrades as stated" : "base value";
const metricGroups = [];
const rankedBase = new Set(metricIndex.filter((r) => r.family === "rankings").map((r) => r.metric));
const metricDocs = allMetrics.map((m) => {
  const have = rows.filter((r) => typeof r.metrics[m] === "number");
  return { metric: m, description: describeMetric(m), ...metricInfo(m), value_kind: metricKind(m), source: m.startsWith("armor.") ? "official wiki (wiki.worldofwarships.com)" : "game files via WoWs ShipBuilder, ShipBuilder formulas",
    ships_with_value: have.length, classes: [...new Set(have.map((r) => r.class))].sort(), ranking: rankedBase.has(m) ? abs(`api/rankings/${m}.json`) : null };
});
await out("api/metrics.json", { about: "Dictionary of every metric (stat name) used on ship pages, in rankings, ships.csv and all-stats files: description, unit, which direction is better, kind of value, source, and which ship classes have it.", schema_version: SCHEMA_VERSION, game_version: ctx.gameVersion, count: metricDocs.length, metrics: metricDocs });
for (const g of [...new Set(metricDocs.map((d) => d.metric.split(".")[0]))].sort()) {
  metricGroups.push(g);
  await out(`metrics/${g}.md`, md(`Metric dictionary: ${g}`, `Every "${g}" metric. Full JSON: ${abs("api/metrics.json")}`, metricDocs.filter((d) => d.metric.split(".")[0] === g).map((d) => `- ${d.metric}: ${d.description}. ${d.direction.replace(/_/g, " ")}; ${d.value_kind}; ${d.ships_with_value} ships (${d.classes.join(", ")})`).join("\n")));
}
await out("api/schema.json", {
  about: "How the data is organized. Every ship file has the same structure. Units are in field names: _s seconds, _km kilometres, _m metres, _mm millimetres, _kg kilograms, _knots knots, _pct percent, _pct_change percent change, _deg degrees, _per_s per second, _per_minute per minute, _hp hit points. null = not applicable.",
  ship_file: {
    "index": "game ship code, primary key (e.g. PJSB018 = Yamato)", "name/full_name": "English names", "tier": "1-11", "class": classes.join(" | "), "nation": nations.join(" | "),
    "category": "tech_tree | premium | special (event/reward/coal/steel/research-bureau ships)",
    "configurations.top": "fully researched modules, base values. Use by default.", "configurations.stock": "unresearched modules",
    "configurations.*.survivability": "hit points, fire and flooding, torpedo protection, HP per hit location", "configurations.*.maneuverability": "speed, rudder, turning circle, acceleration",
    "configurations.*.concealment": "detectability", "configurations.*.main_battery": "guns, reload, range, dispersion, damage per minute, shells (with penetration and flight time per km in ballistics_by_range), burst fire mode",
    "configurations.*.secondaries": "secondary guns", "configurations.*.torpedoes": "launchers and torpedo options", "configurations.*.anti_air": "AA auras, flak, aimed fire",
    "configurations.*.aircraft": "carrier squadrons", "configurations.*.airstrikes": "airstrikes and ASW airstrikes", "configurations.*.depth_charges": "depth charges", "configurations.*.sonar": "submarine sonar",
    "configurations.*.consumables": "consumable slots; options in one slot are alternatives; effects with values",
    "upgrades.slots": "upgrades per slot with exact stat changes", "upgrades.best_possible_values": "best reachable value per stat with upgrades",
    "captain_skills.skills": "each skill with its exact stat changes", "signal_flags.flags": "each flag with its exact stat changes",
    "all_metrics_top_configuration": "every numeric stat of the top configuration as flat metric -> value (same names as rankings and ships.csv)",
  },
  combining_effects: "Effects stack by multiplying: a stat with base B under effects m1, m2... (multiplier kind) is B*m1*m2. Example: reload 30 s with -12% (x0.88) and -5% (x0.95) = 30*0.88*0.95 = 25.08 s. Each upgrade/skill/flag stat_changes shows its effect alone, so you can combine them: new = base * (after1/base) * (after2/base) for multiplier effects. Additive effects (raw_value with unit, e.g. +1 charge) add up.",
  caveats: [
    "Values are what WoWs ShipBuilder calculates from the game files. Things the game files do not expose (armor thickness, module HP) are not included.",
    "concealment: detectability_by_ships_after_firing_main_battery_km = main battery range (firing outside smoke raises sea detectability to the guns' max range for 20 s, per the official wiki); detectability_when_firing_from_smoke_km comes from the game files; *_while_burning_km = +2 km by sea / +3 km by air while on fire.",
    "Secondary battery range: for some ships (mostly aircraft carriers and a few secondary-focused battleships) the official wiki lists a longer secondary range than the game files used here. This is unresolved; see api/verification.json.",
    "Penetration of HE/SAP shells is the exact game value (for example 54.9 mm); the game client may round it.",
    "Anti-air and the large-caliber concealment rule use the main battery module that the hull can actually mount. ShipBuilder picks the first listed module there, so about 10 ships' AA values differ from ShipBuilder (this site is the consistent one).",
    "No player statistics (win rate, average damage).",
    "Test ships are excluded from lists and rankings: api/test-ships.json.",
  ],
  metrics: `Every metric with its unit and direction is listed per topic in ${abs("rankings/index.md")} (${metricDocs.length} base metrics).`,
});

await out("metrics/index.md", md("Metric dictionary", `What every stat name means, its unit and which direction is better. One page per topic. All in one JSON (large): ${abs("api/metrics.json")}`, metricGroups.map((g) => `- [${g}](${abs(`metrics/${g}.md`)})`).join("\n")));
if (AI_GUIDE) await out("llms.txt", await llmsTxt());
async function llmsTxt() {
  const guide = (await readFile(new URL("./lib/llms-guide.md", import.meta.url), "utf8").catch(() => "")).replaceAll("{BASE}", SITE_URL);
  return `# World of Warships data for AI agents

> Complete World of Warships ship data: ${rows.length} ships, game version ${ctx.gameVersion}, generated ${meta.generated_at}. Every stat of every ship (all module combinations), what every upgrade, captain skill and signal flag changes, and ${metricIndex.length} rankings of every numeric stat with filters by class, tier and nation. Static JSON, CSV and Markdown. No auth, no JavaScript. Source: game files via WoWs ShipBuilder; calculations ported from ShipBuilder.

All pages in "Start here" are small enough to read whole. Files marked (large) are for download and code, not for reading in one fetch.

## Start here

- One ship: ${abs("ship/{name}.md")}: name in lowercase, accents removed (ü -> u, å -> a, é -> e), every space or symbol replaced by "_" (e.g. ${abs("ship/yamato.md")}, ${abs("ship/des_moines.md")}, ${abs("ship/g_kurfurst.md")}). Shows all stats plus links to upgrades, captain skills, signal flags and full details (shells with penetration per km). If several ships share the name, the page lists them.
- [All ships by class](${abs("ships.md")}): links to one list per class (names, tiers, nations, page links)
- [All rankings by topic](${abs("rankings/index.md")}): ${metricIndex.length} rankings, every metric with unit and better-direction
- [All stats of all ships, split by class and tier](${abs("all-stats/index.md")})
- [Name lookup](${abs("api/name-lookup.json")}): name -> ship index, for the JSON files ${abs("api/ships/{index}.json")}
- [Metric dictionary](${abs("metrics/index.md")}): every stat name with description, unit, better-direction, source and which classes have it, one small page per topic (all in one JSON: ${abs("api/metrics.json")}, large)
- Human-readable encyclopedia (same data as HTML): homepage ${abs("")}, ship pages ${abs("ships/{name-index}/")} (map of every ship to its HTML, Markdown and JSON: ${abs("api/human-pages.json")}), rankings ${abs("rankings/{metric}/")}, comparison ${abs("compare.html")}. For reading data, the Markdown and JSON files are smaller.
- [Status](${abs("api/status.json")}): game version, last update, validation and wiki cross-check results. Check this to judge freshness.
- [Schema](${abs("api/schema.json")}): structure, units, how to combine upgrade effects, caveats

- [Glossary](${abs("glossary.md")}): player abbreviations (CE, IFHE, DCP, GFCS...) and nicknames (Shima, DM...) mapped to exact game names
- [Game mechanics](${abs("mechanics.md")}): the rules and formulas behind the numbers (DPM, overmatch, detection, dispersion, stacking)
- [Tech trees](${abs("tech-tree/index.md")}): research lines per nation
- [Community opinion: builds and meta](${abs("community.md")}): what current guides and player forums recommend, with sources (opinion, kept separate from game data)
- [What changed between game versions](${abs("changes/index.md")}): stat changes per ship, recorded on every update

${guide}
## Not on this site

- Player statistics (win rates, average damage, popularity) need Wargaming's player API; community sites such as wows-numbers.com publish them. Do not estimate them from this data.
- Armor thickness per plate and module HP are not in the game files used here.
- Opinions on which ship or build is "best": this site gives facts only.

## Data sets

- [Upgrades](${abs("api/upgrades.json")}) (about 110 KB), [Captain skills](${abs("api/captain-skills.json")}), [Signal flags](${abs("api/signal-flags.json")}), [Consumables](${abs("api/consumables.json")}) (large)
- [Shells, torpedoes, bombs, rockets, depth charges](${abs("api/projectiles.json")}) (large), [Aircraft](${abs("api/aircraft.json")}) (large)
- JSON lists with all metrics: ${abs("api/by-tier/{1-11}.json")}, ${abs("api/by-nation/{nation}.json")} (${nations.join(", ")}), ${abs("api/by-class/{class}.json")} (${classes.join(", ")}) (large)
- Bulk (large): [ships.jsonl](${abs("ships.jsonl")}) (one ship per line, only the metrics it has: best for code), [ships.csv](${abs("ships.csv")}) (one row per ship, ${allMetrics.length} metric columns, mostly empty per row: for spreadsheets), [llms-full.txt](${abs("llms-full.txt")}) (every ship and stat in one file, about ${Math.round(llmsFullBytes / 1e6)} MB), [ship index JSON](${abs("api/index.json")})

## Trust

- [Validation report](${abs("api/validation.json")}): automatic checks run on every build
${verification ? `- [Wiki cross-check](${abs("api/verification.json")}): values compared with the official World of Warships wiki\n` : ""}- [Build info](${abs("api/meta.json")})
`;
}


// ---------- human encyclopedia pages ----------
{
  await out("assets/site.css", CSS);
  await out("assets/site.js", JS);
  // Interactive tools: the calculation modules are served as-is (pure JavaScript, no Node APIs), plus the tool scripts.
  for (const f of ["ship", "acceleration", "ballistics", "metrics", "builder", "site", "penetration"]) {
    const src = await readFile(new URL(`./lib/${f}.mjs`, import.meta.url), "utf8");
    await out(`assets/lib/${f}.js`, src.replace(/from "\.\/([a-z]+)\.mjs"/g, 'from "./$1.js"'));
  }
  for (const f of ["build-tool", "gunnery"]) await out(`assets/tools/${f}.js`, await readFile(new URL(`./lib/client/${f}.js`, import.meta.url), "utf8"));
  await out("api/build/common.json", commonToolData(ctx));
  await out("api/build/targets.json", { about: "Per ship: armor (thickest plate per area, from the official wiki), hull size and whether it has a main battery. Used by the gunnery tools.", game_version: ctx.gameVersion, ships: toolTargets });
  for (const [nation, captains] of Object.entries(captainToolData(ctx))) await out(`api/build/captains/${nation}.json`, { about: "Unique commanders of this nation: skills that differ from the standard commander, and talents.", game_version: ctx.gameVersion, captains });
  await out("tools/index.html", renderToolsIndex({ layout, base: BASE_PATH }));
  await out("tools/build/index.html", renderBuildToolPage({ layout, base: BASE_PATH }));
  await out("tools/gunnery/index.html", renderGunneryPage({ layout, base: BASE_PATH }));
  for (const f of ["three.module.min.js", "OrbitControls.js", "LICENSE"]) await out(`assets/vendor/three/${f}`, await readFile(new URL(`./vendor/three/${f}`, import.meta.url), "utf8"));
  const date = meta.generated_at.slice(0, 10);
  await out("index.html", renderHome({ layout, base: BASE_PATH, rows, gameVersion: ctx.gameVersion, updated: date, nations, counts: { rankings: metricIndex.length } }));
  await out("ships/index.html", renderShipsIndex({ layout, base: BASE_PATH, rows, nations, shipUrl: shipHtml }));
  for (const c of classes) await out(`ships/class/${c}/index.html`, renderShipsIndex({ layout, base: BASE_PATH, rows, nations, shipUrl: shipHtml, onlyClass: c }));
  await out("404.html", renderNotFound({ layout, base: BASE_PATH }));
  await out("guide.html", redirectPage({ to: abs("ships/"), title: "Ships" }));
  await out("compare.html", renderCompare({ layout, base: BASE_PATH }));
  await out("about/index.html", renderAbout({ layout, base: BASE_PATH, status: JSON.parse(JSON.stringify(statusDoc)), meta }));
  await out("legal/index.html", renderLegal({ layout, aiNotice: AI_NOTICE }));
  await out("guides/index.html", renderGuidesIndex({ layout, base: BASE_PATH, nations }));
  // In human pages, link to human pages instead of the Markdown data files.
  const toHumanLinks = (t) => [["glossary.md", "guides/glossary/"], ["mechanics.md", "guides/mechanics/"], ["community.md", "guides/community/"], ["changes/index.md", "guides/changes/"], ["tech-tree/index.md", "guides/tech-tree/"], ["rankings/index.md", "rankings/"], ["ships.md", "ships/"]]
    .reduce((acc, [from, to]) => acc.replaceAll(abs(from), `${BASE_PATH}/${to}`), t)
    .replace(new RegExp(`${abs("ship/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([a-z0-9_]+)\\.md`, "g"), (m0, n) => `${BASE_PATH}/ship/${n}/`)
    .replace(new RegExp(`${abs("rankings/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}groups/[a-z_]+\\.md`, "g"), `${BASE_PATH}/rankings/`);
  const textPages = [
    ["guides/mechanics/", "Game mechanics", "How damage, penetration, overmatch, detection and dispersion work in World of Warships.", knowledgePage["mechanics.md"]],
    ["guides/glossary/", "Glossary", "World of Warships abbreviations, terms and ship nicknames.", knowledgePage["glossary.md"]],
    ["guides/community/", "Community builds and opinions", "What current World of Warships guides and forums recommend, with sources.", knowledgePage["community.md"]],
    ["guides/changes/", "Changes between game versions", "World of Warships ship stat changes recorded patch by patch.", changesMd],
  ];
  for (const [path, title, description, mdText] of textPages) if (mdText) await out(`${path}index.html`, renderTextPage({ layout, title, description, path, md: toHumanLinks(mdText), crumbs: [["Guides", "guides/"], [title, path]] }));
  const ttNations = Object.keys(knowledgePage).filter((k) => /^tech-tree\/(?!index)/.test(k)).map((k) => k.slice(10, -3));
  await out("guides/tech-tree/index.html", layout({ title: "Tech trees", description: "World of Warships research lines for every nation.", path: "guides/tech-tree/", crumbs: [["Guides", "guides/"], ["Tech trees", "guides/tech-tree/"]],
    body: `<h1>Tech trees</h1><div class="cards">${ttNations.map((n) => `<a class="card" href="${abs(`guides/tech-tree/${n}/`)}"><h3>${esc(nationLabelOf(n))}</h3><p>Research lines</p></a>`).join("")}</div>` }));
  for (const n of ttNations) {
    const mdText = knowledgePage[`tech-tree/${n}.md`].replace(/^- ([a-z_]+): (.*)$/gm, (m0, cls, line) => `- **${cls.replace(/_/g, " ")}**: ${line.replace(/([^>;(]+?) \((\d+)\)/g, (m1, nm, t) => { const r = rows.find((x) => x.name === nm.trim() && x.nation === n) ?? rows.find((x) => x.name === nm.trim()); return r ? `[${nm.trim()}](${shipHtml(r.index)}) (${t})` : `${nm} (${t})`; })}`);
    await out(`guides/tech-tree/${n}/index.html`, renderTextPage({ layout, title: `Tech tree: ${nationLabelOf(n)}`, description: `World of Warships ${nationLabelOf(n)} research lines.`, path: `guides/tech-tree/${n}/`, md: mdText, crumbs: [["Guides", "guides/"], ["Tech trees", "guides/tech-tree/"], [nationLabelOf(n), `guides/tech-tree/${n}/`]] }));
  }
  await out("guides/upgrades/index.html", renderUpgradesPage({ layout, base: BASE_PATH, upgrades: upgradesData, skillsByClass, flags: signalFlags(ctx).map((f) => ({ name: f.name, effects: describeEffects(L, f.mods) })) }));
  // rankings
  const docBy = Object.fromEntries(metricDocs.map((d) => [d.metric, d]));
  const groupsHtml = [...new Set(metricIndex.map((r) => r.metric.split(".")[0]))].sort().map((g) => ({ group: g, items: metricIndex.filter((r) => r.metric.split(".")[0] === g) }));
  await out("rankings/index.html", renderRankingsIndex({ layout, base: BASE_PATH, groups: groupsHtml, metricDocs }));
  const upgradedSet = new Set(metricIndex.filter((r) => r.family !== "rankings").map((r) => r.metric));
  for (const r of metricIndex.filter((x) => x.family === "rankings")) {
    const doc = docBy[r.metric];
    if (!doc) continue;
    const ranked = rank(rows, r.metric, r.direction);
    const upgraded = upgradedSet.has(r.metric) ? rank(upgradedRows, r.metric, r.direction) : null;
    await out(`rankings/${r.metric}/index.html`, renderRankingPage({ layout, base: BASE_PATH, metric: r.metric, doc, ranked, upgraded, shipUrl: shipHtml, nations }));
  }
  // map of every ship to its human page and its structured data
  await out("api/human-pages.json", { about: "Every ship's human-readable page and its structured data, generated from the same record.", game_version: ctx.gameVersion,
    ships: shipPages.map((p) => ({ index: p.index, name: p.name, test_ship: p.test || undefined, html: `${SITE_URL}/ships/${slugByIndex[p.index]}/`, markdown: abs(`ships/${p.slug}.md`), json: abs(`api/ships/${p.index}.json`) })) });
}
// Search engines are welcome. AI training crawlers are asked not to collect this site (Wargaming Player Content Policy 2.9).
const AI_TRAINING_BOTS = ["GPTBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "CCBot", "Applebot-Extended", "Bytespider", "meta-externalagent", "PerplexityBot", "cohere-training-data-crawler", "Diffbot", "omgili"];
await out("robots.txt", `# WoWs Data: unofficial World of Warships fan encyclopedia.\n# ${AI_NOTICE}\n\n${AI_TRAINING_BOTS.map((b) => `User-agent: ${b}\nDisallow: /\n`).join("\n")}\nUser-agent: *\nAllow: /\n${SITE_URL ? `\nSitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
if (SITE_URL) await out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", ...(AI_GUIDE ? ["llms.txt"] : []), "api/index.json", "api/schema.json", "api/rankings/index.json", ...rows.map((r) => `api/ships/${r.index}.json`), ...rows.map((r) => `ships/${r.slug}.md`), ...[...new Set(rows.map((r) => `ship/${slug(r.name) || r.index.toLowerCase()}.md`))], "ships.md", "rankings/index.md", "all-stats/index.md", "glossary.md", "mechanics.md", "community.md", "tech-tree/index.md", "changes/index.md", "api/metrics.json", "api/status.json", "ships/", "rankings/", "compare.html", "tools/", "tools/build/", "tools/gunnery/", "guides/", "guides/mechanics/", "guides/glossary/", "guides/tech-tree/", "guides/upgrades/", "guides/community/", "guides/changes/", "about/", "legal/", ...rows.map((r) => `ships/${slugByIndex[r.index]}/`), ...metricIndex.filter((r) => r.family === "rankings").map((r) => `rankings/${r.metric}/`)].map((u) => `<url><loc>${abs(u)}</loc></url>`).join("\n")}\n</urlset>\n`);
await out(".nojekyll", "");

log(`built ${rows.length} ships (+${testShips.length} test), ${metricIndex.length} rankings, ${fileCount} files into ${OUT}`);
if (report.errors.length) { console.error(`VALIDATION FAILED: ${report.errors.length} errors, first: ${JSON.stringify(report.errors.slice(0, 5))}. Previous output in ${FINAL_OUT} left untouched.`); process.exit(1); }
for (const must of [...(AI_GUIDE ? ["llms.txt"] : []), "index.html", "api/index.json", "api/schema.json", "api/rankings/index.json", "ships.md"]) {
  try { await readFile(path.join(OUT, must)); } catch { console.error(`BUILD INCOMPLETE: ${must} missing. Previous output left untouched.`); process.exit(1); }
}
await rm(`${FINAL_OUT}.old`, { recursive: true, force: true });
const hadPrevious = await rename(FINAL_OUT, `${FINAL_OUT}.old`).then(() => true, () => false);
try {
  await rename(OUT, FINAL_OUT);
} catch (e) {
  if (hadPrevious) await rename(`${FINAL_OUT}.old`, FINAL_OUT).catch(() => {}); // put the previous output back
  console.error(`PUBLISH FAILED: ${e.message}. Previous output restored.`);
  process.exit(1);
}
await rm(`${FINAL_OUT}.old`, { recursive: true, force: true });
log(`published to ${FINAL_OUT}`);

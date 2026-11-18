#!/usr/bin/env node
// Builds a static World of Warships data site made for AI agents (not people).
//
//   node build.mjs                    download the newest game data, build into ./dist
//   node build.mjs --data-dir DIR     build from already downloaded data files
//
// Env: SITE_URL (absolute links), WOWS_SERVER (live|pts), OUT_DIR. Needs Node 18+, no packages.
// Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.

import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { loadGameData } from "./lib/data.mjs";
import { allConfigurations, computeConfiguration, specialAbility, shellStats, weaponStats, cvPlane, describeModifier, slug, consumableSlots } from "./lib/ship.mjs";
import { flatten, metricInfo } from "./lib/metrics.mjs";
import { eligibleModernizations, skillsFor, signalFlags, changesWith, bestWithUpgrades, describeEffects, clean, upgradeName } from "./lib/analysis.mjs";
import { toMarkdown } from "./lib/markdown.mjs";
import { validate } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const OUT = path.resolve(process.env.OUT_DIR || "dist");
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const SERVER = process.env.WOWS_SERVER || "live";
const abs = (p) => `${SITE_URL}/${p}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const ctx = await loadGameData({ server: SERVER, dataDir: argVal("--data-dir") });
log("data loaded, game version", ctx.gameVersion);
const L = ctx.L;

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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const meta = {
  generated_at: new Date().toISOString(), game_version: ctx.gameVersion, server: SERVER,
  data_source: "WoWs ShipBuilder public game data (https://app.wowssb.com), extracted from the World of Warships game client every patch",
  calculations: "Stat formulas are a line-by-line port of WoWs ShipBuilder's open-source calculations (MIT license).",
  license_note: "Game data © Wargaming.net. Unofficial site, not affiliated with Wargaming or WoWs ShipBuilder.",
};

// ---------- ships ----------
const rows = [];            // one per released ship, used for lists, CSV and rankings
const upgradedRows = [];    // best values reachable with upgrades
const testShips = [];
const ships = Object.values(ctx.ships).sort((a, b) => a.index.localeCompare(b.index));
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
  const topFlat = flatten(top.stats);

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

  const record = {
    about: `World of Warships ship data for ${name}. ${COMMON_NOTE} "configurations.top" is fully researched modules (what players normally use); "configurations.stock" is unresearched.`,
    game_version: ctx.gameVersion,
    ...base,
    description: clean(L[`${s.index}_DESCR`]),
    price_credits: info.costCredits || null, price_doubloons: info.costGold || null, research_xp: info.costXp || null,
    previous_ship: sum.prevShipIndex ? { index: sum.prevShipIndex, name: shipName(sum.prevShipIndex) } : null,
    next_ships: (sum.nextShipIndexes ?? []).map((i) => ({ index: i, name: shipName(i) })),
    special_ability: specialAbility(ctx, s),
    configurations: { top: top.stats, stock: stock.stats },
    module_combinations: { count: configs.length, url: abs(`api/ships/${s.index}/configurations.json`), note: "Every combination of researchable modules, with full stats." },
    upgrades: {
      about: "Upgrades (modernizations) this ship can mount, per slot. One per slot. stat_changes = exact effect on the top configuration alone.",
      slots: upgradeSlots,
      best_possible_values: { about: "For each stat an upgrade can improve: base value, best value with the best upgrade in each slot, and which upgrades give it.", metrics: best },
    },
    captain_skills: { about: "Captain skills for this ship's class. stat_changes = effect of that one skill alone on the top configuration.", skills },
    signal_flags: { about: "Signal flags (all ships can mount any of these). stat_changes = effect of that one flag alone on the top configuration.", flags },
    all_metrics_top_configuration: topFlat,
  };
  await out(`api/ships/${s.index}.json`, record);
  await out(`api/ships/${s.index}/configurations.json`, {
    about: `Every module combination for ${name} with full stats. ${COMMON_NOTE}`, game_version: ctx.gameVersion, index: s.index, name,
    configurations: configs.map((c) => ({ id: c.id, is_stock: c.stock, is_top: c.top, stats: computeConfiguration(ctx, s, c.cfg, [], { tables: false, accel: true }) })),
  });
  await out(`ships/${base.slug}.md`, md(`${name} (tier ${base.tier_roman} ${base.nation} ${base.class}, ${base.category})`, `${COMMON_NOTE} JSON: ${abs(`api/ships/${s.index}.json`)}`, toMarkdown(record)));

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
const addName = (k, i) => { const key = k.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim(); if (!(names[key] ??= []).includes(i)) names[key].push(i); };
for (const r of rows) addName(r.name, r.index);
for (const s of Object.values(ctx.ships)) if (s.shipCategory !== "TestShip") addName(clean(L[`${s.index}_FULL`]) ?? shipName(s.index), s.index);
await out("api/name-lookup.json", { about: "Lowercase ship name (accents removed) -> ship indexes. Several ships can share a name (event or alternate versions): check tier and category in api/index.json.", names });
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
await out("ships.jsonl", rows.map((r) => JSON.stringify({ ...listEntry(r), metrics: r.metrics })).join("\n") + "\n");
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
    metricIndex.push({ family, metric: m, unit, direction, ships: all.length, url: abs(`api/${family}/${m}.json`), markdown: abs(`${family}/${m}.md`), filtered: avail });
  }
  log(`${family} done`);
}
await out("api/rankings/index.json", {
  about: "Every ranking on this site. Every numeric stat of every ship is ranked (nothing hand-picked). 'rankings' = base stats; 'rankings-with-upgrades' = best value reachable with upgrades. Filtered lists: {url without .json}/class/{class}.json, /class/{class}/tier-{n}.json, /tier/{n}.json, /nation/{nation}.json. For several nations at once, filter the full list.",
  game_version: ctx.gameVersion, count: metricIndex.length, rankings: metricIndex,
});

// ---------- extra datasets ----------
const nationName = (n) => nationId(n);
await out("api/upgrades.json", {
  about: "Every upgrade (modernization) in the game, with its effects and which ships can mount it. Slot numbers start at 1.", game_version: ctx.gameVersion,
  upgrades: Object.values(ctx.modernizations).sort((a, b) => a.slot - b.slot || a.index.localeCompare(b.index)).map((m) => ({
    index: m.index, name: upgradeName(L, m), slot: m.slot + 1, type: slug(m.type), description: clean(L[`DESC_${m.name}`.toUpperCase()]),
    tiers: m.shipLevel, classes: (m.shipClasses ?? []).map(classId), nations: (m.allowedNations ?? []).map(nationName),
    also_on_ships: (m.additionalShips ?? []).map((n) => shipName(rawName[n] ?? n)), not_on_ships: (m.blacklistedShips ?? []).map((n) => shipName(rawName[n] ?? n)),
    effects: describeEffects(L, m.modifiers ?? []),
  })),
});
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
await out("api/validation.json", report);
let verification = null;
try { verification = JSON.parse(await readFile("verification/wiki-crosscheck.json", "utf8")); await out("api/verification.json", verification); } catch { /* optional */ }

// ---------- schema, llms.txt, index ----------
const metricDocs = allMetrics.map((m) => ({ metric: m, ...metricInfo(m), ships_with_value: rows.filter((r) => typeof r.metrics[m] === "number").length }));
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
    "No player statistics (win rate, average damage).",
    "Test ships are excluded from lists and rankings: api/test-ships.json.",
  ],
  metrics: metricDocs,
});

await out("llms.txt", await llmsTxt());
async function llmsTxt() {
  const guide = (await readFile(new URL("./lib/llms-guide.md", import.meta.url), "utf8").catch(() => "")).replaceAll("{BASE}", SITE_URL);
  return `# World of Warships data for AI agents

> Complete World of Warships ship data: ${rows.length} ships, game version ${ctx.gameVersion}, generated ${meta.generated_at}. Every stat of every ship (all module combinations), what every upgrade, captain skill and signal flag changes, and ${metricIndex.length} rankings of every numeric stat with filters by class, tier and nation. Static JSON, CSV and Markdown. No auth, no JavaScript. Source: game files via WoWs ShipBuilder; calculations ported from ShipBuilder.

## Start here

- [Ship index](${abs("api/index.json")}): every ship with index, name, tier, class, nation, category
- [Name lookup](${abs("api/name-lookup.json")}): ship name -> index. Then fetch ${abs("api/ships/{index}.json")} (or ${abs("ships/{name-index}.md")})
- [Rankings index](${abs("api/rankings/index.json")}): every ranking and its filtered versions
- [Schema](${abs("api/schema.json")}): structure, units, how to combine upgrade effects, every metric with its unit and better-direction

${guide}
## Data sets

- [Upgrades](${abs("api/upgrades.json")}), [Captain skills](${abs("api/captain-skills.json")}), [Signal flags](${abs("api/signal-flags.json")}), [Consumables](${abs("api/consumables.json")})
- [Shells, torpedoes, bombs, rockets, depth charges](${abs("api/projectiles.json")}), [Aircraft](${abs("api/aircraft.json")})
- Lists: ${abs("api/by-tier/{1-11}.json")}, ${abs("api/by-nation/{nation}.json")} (${nations.join(", ")}), ${abs("api/by-class/{class}.json")} (${classes.join(", ")})
- Bulk: [ships.csv](${abs("ships.csv")}) (one row per ship, ${allMetrics.length} metric columns), [ships.jsonl](${abs("ships.jsonl")})

## Trust

- [Validation report](${abs("api/validation.json")}): automatic checks run on every build
${verification ? `- [Wiki cross-check](${abs("api/verification.json")}): values compared with the official World of Warships wiki\n` : ""}- [Build info](${abs("api/meta.json")})
`;
}

const tcols = ["survivability.hit_points", "maneuverability.max_speed_knots", "concealment.detectability_by_ships_km", "main_battery.range_km", "main_battery.reload_s"];
await out("index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WoWs Data for AIs</title>
<meta name="description" content="Complete World of Warships ship data for AI agents. Start at /llms.txt">
<link rel="alternate" type="text/plain" href="${abs("llms.txt")}" title="llms.txt">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset", name: "World of Warships ship data for AI agents", description: `Every stat of ${rows.length} World of Warships ships (game version ${ctx.gameVersion}), upgrades, skills, signals and rankings.`, dateModified: meta.generated_at, version: ctx.gameVersion, isAccessibleForFree: true, distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: abs("ships.csv") }, { "@type": "DataDownload", encodingFormat: "application/jsonl", contentUrl: abs("ships.jsonl") }] })}</script>
<style>body{font:13px/1.4 ui-monospace,monospace;margin:16px;background:#fff;color:#111}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px;text-align:left;white-space:nowrap}.w{overflow-x:auto}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}td,th{border-color:#444}a{color:#8ab4f8}}</style></head><body>
<h1>World of Warships data for AI agents</h1>
<p>This site is for AI agents. Read <a href="${abs("llms.txt")}">/llms.txt</a>. Structure and units: <a href="${abs("api/schema.json")}">/api/schema.json</a>. Rankings: <a href="${abs("api/rankings/index.json")}">/api/rankings/index.json</a>.</p>
<p>ships=${rows.length}; game_version=${ctx.gameVersion}; generated_at=${meta.generated_at}; rankings=${metricIndex.length}</p>
<div class="w"><table><thead><tr><th>index</th><th>name</th><th>tier</th><th>class</th><th>nation</th><th>category</th>${tcols.map((c) => `<th>${c}</th>`).join("")}<th>json</th><th>md</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${r.index}</td><td>${r.name.replace(/</g, "&lt;")}</td><td>${r.tier}</td><td>${r.class}</td><td>${r.nation}</td><td>${r.category}</td>${tcols.map((c) => `<td>${r.metrics[c] ?? ""}</td>`).join("")}<td><a href="${r.url}">json</a></td><td><a href="${abs(`ships/${r.slug}.md`)}">md</a></td></tr>`).join("\n")}
</tbody></table></div><p>${meta.data_source}. ${meta.calculations} ${meta.license_note}</p></body></html>
`);
await out("robots.txt", `# AI crawlers and agents are welcome.\nUser-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
if (SITE_URL) await out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", "llms.txt", "api/index.json", "api/schema.json", "api/rankings/index.json", ...rows.map((r) => `api/ships/${r.index}.json`), ...rows.map((r) => `ships/${r.slug}.md`)].map((u) => `<url><loc>${abs(u)}</loc></url>`).join("\n")}\n</urlset>\n`);
await out(".nojekyll", "");

log(`built ${rows.length} ships (+${testShips.length} test), ${metricIndex.length} rankings, ${fileCount} files into ${OUT}`);
if (report.errors.length) { console.error(`VALIDATION FAILED: ${report.errors.length} errors, first: ${JSON.stringify(report.errors.slice(0, 5))}`); process.exit(1); }

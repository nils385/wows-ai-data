#!/usr/bin/env node
// Regression and integrity tests on the built site. Run after `node build.mjs`:  node tests/check-output.mjs [dist]
// Known values were cross-checked against the official wiki and in-game numbers for game version 15.10.
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve(process.argv[2] || "dist");
const MAX_SITE_BYTES = 950e6; // GitHub Pages limit is 1 GB
let failures = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failures++; console.error("FAIL:", msg); } };
const json = async (p) => JSON.parse(await readFile(path.join(DIST, p), "utf8"));
const exists = (p) => stat(path.join(DIST, p)).then(() => true, () => false);
// URL -> file in dist, whether the site is served at the domain root or under a path like /wows-ai-data/
const relOf = async (u, suffix = "") => { const p = new URL(u).pathname.replace(/^\//, ""); const alt = p.split("/").slice(1).join("/"); return (await exists(p + suffix)) ? p + suffix : alt + suffix; };
const existsUrl = async (u, suffix = "") => exists(await relOf(u, suffix));

// 1. Known values (top configuration, base values)
const KNOWN = [
  ["PJSB018", "survivability.hit_points", 97200], ["PJSB018", "main_battery.reload_s", 30], ["PJSB018", "main_battery.range_km", 26.63],
  ["PJSB018", "maneuverability.rudder_shift_time_s", 22.05], ["PJSB018", "concealment.detectability_by_ships_km", 17.46],
  ["PJSB018", "main_battery.shells.ap.damage", 14800], ["PJSB018", "main_battery.shells.he.fire_chance_pct", 35], ["PJSB018", "anti_air.short_range.continuous_damage_per_s", 388.5],
  ["PJSD012", "concealment.detectability_by_ships_km", 6.9], ["PJSD012", "concealment.min_detectability_by_ships_km", 5.59],
  ["PASC020", "main_battery.reload_s", 5.5], ["PASC020", "survivability.hit_points", 50600],
];
const cache = {};
for (const [idx, metric, expected] of KNOWN) {
  cache[idx] ??= await json(`api/ships/${idx}.json`).catch(() => null);
  const v = cache[idx]?.all_metrics_top_configuration?.[metric];
  ok(typeof v === "number" && Math.abs(v - expected) < 1e-6, `${idx} ${metric} = ${v}, expected ${expected}`);
}
// Upgrade effect known from the game: Gun Fire Control System Modification 2 = +16% range on Yamato
const gfcs = cache.PJSB018?.upgrades?.slots.flatMap((s) => s.options).find((o) => o.name === "Gun Fire Control System Modification 2");
ok(gfcs?.stat_changes?.some((c) => c.metric === "main_battery.range_km" && c.after === 30.89), "Yamato GFCS2 range 26.63 -> 30.89");
// No fake "-> null" stat changes
ok(!JSON.stringify(cache.PJSB018?.captain_skills ?? {}).includes('"after":null'), "no '-> null' changes in captain skills");

// 2. Every released ship has its pages and data
const index = (await json("api/index.json")).ships;
ok(index.length > 900, `ship index has ${index.length} ships`);
const human = (await json("api/human-pages.json")).ships;
const humanBy = Object.fromEntries(human.map((h) => [h.index, h]));
let missing = 0;
for (const s of index) {
  const h = humanBy[s.index];
  if (!h) { missing++; continue; }
  if (!(await existsUrl(h.html, "index.html")) || !(await existsUrl(h.markdown)) || !(await exists(`api/ships/${s.index}.json`))) missing++;
}
ok(missing === 0, `${missing} ships missing an HTML page, Markdown or JSON`);

// 3. Core pages exist and HTML pages have a title and one h1
for (const p of ["index.html", "ships/index.html", "compare.html", "rankings/index.html", "guides/mechanics/index.html", "guides/glossary/index.html", "about/index.html", "legal/index.html", "llms.txt", "api/schema.json", "api/metrics.json", "api/status.json", "ships.jsonl", "ships.csv", "sitemap.xml", "robots.txt"]) ok(await exists(p), `missing ${p}`);
for (const p of ["index.html", "ships/index.html", await relOf(humanBy.PJSB018.html, "index.html"), "rankings/main_battery.reload_s/index.html", "legal/index.html"]) {
  const t = await readFile(path.join(DIST, p), "utf8").catch(() => "");
  ok(/<title>[^<]+<\/title>/.test(t), `${p} has a title`);
  ok((t.match(/<h1[\s>]/g) ?? []).length === 1, `${p} has exactly one h1`);
  ok(t.includes("This work is unofficial and is not endorsed by Wargaming"), `${p} has the Wargaming disclaimer`);
}

// 4. Validation passed and site size is within limits
const status = await json("api/status.json");
ok(status.validation?.passed === true, "build validation passed");
async function size(dir) { let n = 0; for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await size(path.join(dir, e.name)) : (await stat(path.join(dir, e.name))).size; return n; }
const bytes = await size(DIST);
ok(bytes < MAX_SITE_BYTES, `site size ${(bytes / 1e6).toFixed(0)} MB (limit ${MAX_SITE_BYTES / 1e6} MB)`);

console.log(`${passed} passed, ${failures} failed (site ${(bytes / 1e6).toFixed(0)} MB)`);
process.exit(failures ? 1 : 0);

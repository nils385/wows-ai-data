// Human-facing encyclopedia pages (HTML). Every number comes from the same records used for the JSON,
// Markdown and CSV outputs, so the formats cannot drift apart. Pages work without JavaScript; the small
// script only adds filtering and the comparison tool.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CLASS_LABEL = { destroyer: "Destroyer", cruiser: "Cruiser", battleship: "Battleship", aircraft_carrier: "Aircraft carrier", submarine: "Submarine" };
const CLASS_PLURAL = { destroyer: "Destroyers", cruiser: "Cruisers", battleship: "Battleships", aircraft_carrier: "Aircraft carriers", submarine: "Submarines" };
const NATION_LABEL = { usa: "U.S.A.", japan: "Japan", germany: "Germany", united_kingdom: "U.K.", ussr: "U.S.S.R.", france: "France", italy: "Italy", pan_asia: "Pan-Asia", europe: "Europe", pan_america: "Pan-America", netherlands: "The Netherlands", commonwealth: "Commonwealth", spain: "Spain" };
const CATEGORY_LABEL = { tech_tree: "Tech tree", premium: "Premium", special: "Special", test_ship: "Test ship" };
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
export const classLabel = (c) => CLASS_LABEL[c] ?? c;
export const nationLabel = (n) => NATION_LABEL[n] ?? n;
export const categoryLabel = (c) => CATEGORY_LABEL[c] ?? c;
export const roman = (t) => ROMAN[t] ?? String(t);

// ---------- labels and units from field names ----------
const UNITS = [
  ["_deg_per_s", "°/s"], ["_m_per_s", "m/s"], ["_m_s", "m/s"], ["_hp_per_s", "HP/s"], ["_damage_per_s", "dmg/s"], ["_per_s", "/s"], ["_per_minute", "/min"], ["_per_min", "/min"],
  ["_pct_change", "%"], ["_pct", "%"], ["_knots", "kn"], ["_km", "km"], ["_mm", "mm"], ["_kg", "kg"], ["_deg", "°"], ["_hp", "HP"], ["_s", "s"], ["_m", "m"], ["_t", "t"],
];
const WORDS = { hp: "HP", aa: "AA", ap: "AP", he: "HE", sap: "SAP", ifhe: "IFHE", dps: "DPS", km: "km", asw: "ASW", cv: "CV" };
export function splitUnit(key) {
  for (const [suf, u] of UNITS) if (key.endsWith(suf)) return [key.slice(0, -suf.length), u];
  return [key, ""];
}
export function prettyKey(key) {
  const [base] = splitUnit(key);
  const words = base.split("_").filter(Boolean).map((w) => WORDS[w] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// "main_battery.shells.ap.penetration_at_15km_mm" -> "Main battery: AP shell penetration at 15 km"
const GROUP = { main_battery: "Main battery", secondaries: "Secondary battery", torpedoes: "Torpedoes", anti_air: "Anti-aircraft", survivability: "Survivability", maneuverability: "Maneuverability", concealment: "Concealment", aircraft: "Aircraft", airstrikes: "Airstrikes", depth_charges: "Depth charges", sonar: "Sonar", consumables: "Consumable", armor: "Armor", hull_size_m: "Hull size", fire_control: "Fire control" };
const FRIENDLY = {
  "concealment.min_detectability_by_ships_km": "Best concealment (with concealment build)", "concealment.detectability_by_ships_km": "Detectability by ships",
  "main_battery.reload_s": "Main battery reload", "main_battery.range_km": "Main battery range", "main_battery.he_damage_per_minute": "HE damage per minute",
  "main_battery.ap_damage_per_minute": "AP damage per minute", "main_battery.sap_damage_per_minute": "SAP damage per minute", "main_battery.shells.ap.penetration_at_15km_mm": "AP penetration at 15 km",
  "survivability.hit_points": "Hit points", "maneuverability.max_speed_knots": "Top speed", "torpedoes.torpedoes.primary.damage": "Torpedo damage",
  "torpedoes.torpedoes.primary.range_km": "Torpedo range", "consumables.surveillance_radar.detection_of_ships_km": "Radar range",
  "consumables.hydroacoustic_search.detection_of_ships_km": "Hydro range (ships)", "anti_air.total_continuous_damage_per_s": "AA damage per second", "armor.belt_mm": "Belt armor",
  "main_battery.he_potential_fires_per_minute": "Fires per minute (HE)", "maneuverability.rudder_shift_time_s": "Rudder shift time", "main_battery.turret_180_turn_time_s": "Turret 180° turn time",
};
export function metricTitle(m) {
  if (FRIENDLY[m]) return FRIENDLY[m];
  const parts = m.split(".");
  const g = GROUP[parts[0]] ?? prettyKey(parts[0]);
  const last = parts.at(-1);
  let [, u] = splitUnit(last);
  const words = (p, isLast) => {
    const base = isLast && u && u !== "HP" ? splitUnit(p)[0] : p.replace(/_hp$/, "_HP");
    return base.split("_").filter(Boolean).map((w) => WORDS[w] ?? (w === "HP" ? "HP" : w)).join(" ");
  };
  const rest = parts.slice(1).filter((p, i, a) => !(["torpedoes", "shells", "primary"].includes(p) && i < a.length - 1)).map((p, i, a) => words(p, i === a.length - 1));
  if (u === "HP") u = "";
  return `${g}: ${rest.join(" ")}`.replace(/\s+/g, " ").trim() + (u ? ` (${u})` : "");
}
export function fmtNum(v) {
  if (typeof v !== "number") return esc(v);
  if (Number.isInteger(v) && Math.abs(v) >= 10000) return v.toLocaleString("en-US");
  return String(v);
}
export function fmtVal(key, v) {
  if (v === null || v === undefined || v === "") return '<span class="na">—</span>';
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return esc(v.join(" – "));
  const [, u] = splitUnit(key);
  return typeof v === "number" ? `${fmtNum(v)}${u ? `<span class="u">${u === "%" || u === "°" ? "" : "\u00a0"}${esc(u)}</span>` : ""}` : esc(v);
}

// ---------- page layout ----------
export function makeLayout({ base, site, gameVersion, updated }) {
  const href = (p) => `${base}/${p}`; // short site-relative links
  return function layout({ title, description, path, body, crumbs = [], jsonld, wide = false, alternates = [] }) {
    const canonical = `${site ?? base}/${path}`; // full address for canonical links
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="7cGDI-8VyfYPPf1PgyNxdrlf9xqnO7k4GD46lmJXsug">
<title>${esc(title)} — WoWs Data</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${alternates.map((a) => `<link rel="alternate" type="${esc(a.type)}" href="${esc(a.href)}" title="${esc(a.title)}">`).join("\n")}
<link rel="stylesheet" href="${href("assets/site.css")}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9A%93%3C/text%3E%3C/svg%3E">
<meta name="color-scheme" content="light dark">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="top-in">
    <a class="brand" href="${href("")}"><span class="brand-mark" aria-hidden="true">⚓</span> WoWs Data <span class="brand-sub">fan encyclopedia</span></a>
    <nav aria-label="Main">
      <a href="${href("ships/")}">Ships</a>
      <a href="${href("compare.html")}">Compare</a>
      <a href="${href("rankings/")}">Rankings</a>
      <a href="${href("guides/mechanics/")}">Mechanics</a>
      <a href="${href("guides/")}">Guides</a>
    </nav>
    <form class="search" action="${href("ships/")}" method="get" role="search">
      <label for="q" class="sr">Search ships</label>
      <input id="q" name="q" type="search" placeholder="Search ships…" autocomplete="off">
    </form>
  </div>
</header>
${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${[["Home", ""], ...crumbs].map(([t, p], i, a) => i === a.length - 1 ? `<li aria-current="page">${esc(t)}</li>` : `<li><a href="${href(p)}">${esc(t)}</a></li>`).join("")}</ol></nav>` : ""}
<main id="main" class="${wide ? "wide" : ""}">
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <p>Game version <strong>${esc(gameVersion)}</strong> · data updated ${esc(updated)} · <a href="${href("about/")}">About the data</a> · <a href="${href("legal/")}">Legal &amp; attribution</a> · <a href="${href("about/#data")}">Data downloads</a></p>
    <p class="disclaimer">This work is unofficial and is not endorsed by Wargaming. World of Warships and all related names are trademarks of Wargaming.net. Ship statistics are calculated from public game data files of WoWs ShipBuilder; armor values come from the official World of Warships wiki. Non-commercial fan project: no ads, no tracking, no accounts.</p>
  </div>
</footer>
<script src="${href("assets/site.js")}" defer></script>
</body>
</html>
`;
  };
}

// ---------- generic tables ----------
export function kvTable(obj, { caption, skip = [] } = {}) {
  const rows = Object.entries(obj ?? {}).filter(([k, v]) => !skip.includes(k) && v !== undefined && (v === null || typeof v !== "object" || (Array.isArray(v) && v.every((x) => typeof x !== "object"))));
  if (!rows.length) return "";
  return `<table class="kv">${caption ? `<caption>${esc(caption)}</caption>` : ""}<tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(prettyKey(k))}</th><td>${fmtVal(k, v)}</td></tr>`).join("")}</tbody></table>`;
}
export function gridTable(list, { caption, cols, labels = {}, cls = "grid" } = {}) {
  if (!list?.length) return "";
  const keys = cols ?? [...new Set(list.flatMap((x) => Object.keys(x).filter((k) => x[k] === null || typeof x[k] !== "object" || (Array.isArray(x[k]) && x[k].every((y) => typeof y !== "object")))))];
  return `<div class="scroll"><table class="${cls}">${caption ? `<caption>${esc(caption)}</caption>` : ""}<thead><tr>${keys.map((k) => `<th scope="col">${esc(labels[k] ?? prettyKey(k))}</th>`).join("")}</tr></thead><tbody>${list.map((x) => `<tr>${keys.map((k, i) => (i === 0 ? `<th scope="row">${fmtVal(k, x[k])}</th>` : `<td>${fmtVal(k, x[k])}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---------- minimal Markdown to HTML for the site's own generated Markdown ----------
export function mdToHtml(md) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|\/[^)\s]*)\)/g, (m, t, u) => (/[{}]/.test(u) ? t : `<a href="${u}">${t}</a>`))
    // plain URLs become links, except templates like {name}; trailing punctuation stays outside the link
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (m, p, u) => { if (/[{}]/.test(u)) return m; const t = u.match(/[.,;:!?]+$/)?.[0] ?? ""; const url = t ? u.slice(0, -t.length) : u; return `${p}<a href="${url}">${url}</a>${t}`; });
  const out = [];
  const lines = md.split("\n");
  let list = null, code = null, table = null;
  const flushList = () => { if (list) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const [head, , ...body] = table;
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    out.push(`<div class="scroll"><table class="grid"><thead><tr>${cells(head).map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    table = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code !== null) { if (line.startsWith("```")) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(raw); continue; }
    if (line.startsWith("```")) { flushList(); flushTable(); code = []; continue; }
    if (line.startsWith("|")) { flushList(); (table ??= []).push(line); continue; } else flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushList(); const n = Math.min(h[1].length + 1, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { (list ??= []).push(li[1]); continue; }
    flushList();
    if (line.startsWith("> ")) { out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flushList(); flushTable();
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}

// ---------- ship page ----------
export function renderShipPage({ layout, base, rec, shipUrl, mdUrl, jsonUrl, configsUrl, related, similar = [] }) {
  const href = (p) => `${base}/${p}`;
  const top = rec.configurations.top;
  const m = rec.all_metrics_top_configuration;
  const title = rec.name;
  const sub = `Tier ${roman(rec.tier)} ${nationLabel(rec.nation)} ${classLabel(rec.class).toLowerCase()}`;
  const sec = (id, h, inner) => (inner && inner.trim() ? `<section id="${id}"><h2>${esc(h)}</h2>${inner}</section>` : "");
  const toc = [];
  const add = (id, h, inner) => { const s = sec(id, h, inner); if (s) toc.push([id, h]); return s; };

  const info = [
    ["Tier", roman(rec.tier)], ["Class", classLabel(rec.class)], ["Nation", nationLabel(rec.nation)], ["Type", categoryLabel(rec.category)],
    ["Price", rec.price_credits ? `${fmtNum(rec.price_credits)} credits` : rec.price_doubloons ? `${fmtNum(rec.price_doubloons)} doubloons` : null],
    ["Research", rec.research_xp ? `${fmtNum(rec.research_xp)} XP` : null],
  ].filter(([, v]) => v);
  const nav = [
    rec.previous_ship ? `<p><span class="lbl">Researched from</span> <a href="${related(rec.previous_ship.index)}">${esc(rec.previous_ship.name)}</a></p>` : "",
    rec.next_ships?.length ? `<p><span class="lbl">Leads to</span> ${rec.next_ships.map((n) => `<a href="${related(n.index)}">${esc(n.name)}</a>`).join(", ")}</p>` : "",
  ].join("");
  const armor = rec.armor ? `<table class="kv"><caption>Armor (from the official wiki)</caption><tbody>${["belt_mm", "deck_mm", "extremities_mm", "superstructure_mm"].filter((k) => rec.armor[k] !== undefined).map((k) => `<tr><th scope="row">${esc(prettyKey(k))}</th><td>${fmtVal(k, rec.armor[k])}</td></tr>`).join("")}</tbody></table>` : "";

  const key = [
    ["Hit points", "survivability.hit_points"], ["Max speed", "maneuverability.max_speed_knots"], ["Max speed (surface)", "maneuverability.max_speed_surface_knots"],
    ["Detectability by ships", "concealment.detectability_by_ships_km"], ["… with concealment build", "concealment.min_detectability_by_ships_km"],
    ["Main battery range", "main_battery.range_km"], ["Main battery reload", "main_battery.reload_s"], ["Torpedo range", "torpedoes.torpedoes.primary.range_km"],
  ].filter(([, k]) => m[k] !== undefined);
  const keyHtml = `<dl class="keystats">${key.map(([l, k]) => `<div><dt>${esc(l)}</dt><dd>${fmtVal(k, m[k])}</dd></div>`).join("")}</dl>`;

  // sections
  const s = top.survivability;
  const survival = kvTable({ hit_points: s.hit_points, rudder_damage_protection: s.rudder_damage_protection, engine_damage_protection: s.engine_damage_protection, dive_capacity: s.dive_capacity, dive_capacity_recharge_per_s: s.dive_capacity_recharge_per_s }, { caption: "General" })
    + kvTable(s.fire, { caption: "Fire" }) + kvTable(s.flooding, { caption: "Flooding" })
    + gridTable(Object.entries(s.hit_location_hp ?? {}).map(([loc, v]) => ({ section: prettyKey(loc), hp: v.hp, repairable_damage_pct: v.repairable_damage_pct })), { caption: "HP by hit location" });
  const conc = { ...top.concealment };
  if (m["concealment.min_detectability_by_ships_km"] !== undefined) { conc.min_detectability_by_ships_km = m["concealment.min_detectability_by_ships_km"]; conc.min_detectability_by_planes_km = m["concealment.min_detectability_by_planes_km"]; }
  const concealment = kvTable(conc, { caption: "Detectability (lower is stealthier)" }) + (rec.derived_metric_notes?.min_detectability ? `<p class="note">“Min” values: ${esc(rec.derived_metric_notes.min_detectability)}.</p>` : "");

  let mb = "";
  if (top.main_battery) {
    const b = top.main_battery;
    const shells = Object.values(b.shells ?? {});
    mb = kvTable(b, { caption: "Main battery", skip: ["shells", "guns", "turrets", "dispersion_by_range", "burst_fire_mode"] })
      + gridTable(b.guns, { caption: "Guns", cols: ["name", "mounts", "barrels_per_mount", "caliber_mm"] })
      + gridTable(shells, { caption: "Shells", cols: ["type", "name", "damage", "muzzle_velocity_m_s", "penetration_mm", "fire_chance_pct", "overmatch_mm", "mass_kg", "air_drag_coefficient", "ricochet_start_angle_deg", "ricochet_always_angle_deg", "fuse_time_s", "arming_threshold_mm"].filter((k) => shells.some((x) => x[k] !== null && x[k] !== undefined)) });
    const ap = shells.find((x) => x.type === "AP" && x.ballistics_by_range?.length) ?? shells.find((x) => x.ballistics_by_range?.length);
    if (ap) mb += gridTable(ap.ballistics_by_range, { caption: `Ballistics: ${ap.name} (${ap.type}) by range. Penetration is against a plate hit straight on.` });
    if (b.dispersion_by_range?.length) mb += gridTable(b.dispersion_by_range, { caption: "Dispersion by range" });
    if (b.turrets?.length) mb += gridTable(b.turrets, { caption: "Turrets and firing arcs (0° = straight ahead)" });
    if (b.burst_fire_mode) mb += kvTable(b.burst_fire_mode, { caption: "Burst fire mode" });
  }
  let secHtml = "";
  if (top.secondaries) secHtml = kvTable(top.secondaries, { caption: "Secondary battery" }) + gridTable(top.secondaries.gun_groups.map((g) => ({ name: g.name, layout: g.layout, caliber_mm: g.caliber_mm, reload_s: g.reload_s, damage_per_minute: g.damage_per_minute, potential_fires_per_minute: g.potential_fires_per_minute, shell: g.shell?.name, shell_damage: g.shell?.damage, penetration_mm: g.shell?.penetration_mm, fire_chance_pct: g.shell?.fire_chance_pct })), { caption: "Gun groups" });
  let torp = "";
  if (top.torpedoes) torp = kvTable(top.torpedoes, { caption: "Torpedo launchers" }) + gridTable(Object.entries(top.torpedoes.torpedoes).map(([k, t]) => ({ option: prettyKey(k), name: t.name, type: t.type, damage: t.damage, range_km: t.range_km, speed_knots: t.speed_knots, detectability_km: t.detectability_km, reaction_time_s: t.reaction_time_s, flooding_chance_pct: t.flooding_chance_pct, full_salvo_damage: t.full_salvo_damage })), { caption: "Torpedoes" });
  let aa = "";
  if (top.anti_air) aa = gridTable(["long_range", "medium_range", "short_range"].filter((k) => top.anti_air[k]).map((k) => ({ aura: prettyKey(k), ...top.anti_air[k] })), { caption: "AA auras" }) + kvTable(top.anti_air.aimed_fire ?? {}, { caption: "Aimed fire" });
  let air = "";
  if (top.aircraft) air = gridTable(Object.values(top.aircraft).map((p) => ({ name: p.name, type: prettyKey(p.type), plane_hp: p.plane_hp, planes_in_squadron: p.planes_in_squadron, planes_per_attack_flight: p.planes_per_attack_flight, cruising_speed_knots: p.cruising_speed_knots, planes_on_deck_max: p.planes_on_deck_max, plane_restoration_time_s: p.plane_restoration_time_s, weapon: p.weapon?.name, weapon_damage: p.weapon?.damage })), { caption: "Squadrons" });
  if (top.airstrikes) air += gridTable(top.airstrikes.map((a) => ({ kind: prettyKey(a.kind), plane: a.plane, charges: a.charges, reload_s: a.reload_s, max_distance_km: a.max_distance_km, weapon: a.weapon?.name, weapon_damage: a.weapon?.damage })), { caption: "Airstrikes" });
  let asw = "";
  if (top.depth_charges) asw += kvTable({ reload_s: top.depth_charges.reload_s, charges: top.depth_charges.charges, depth_charges_per_attack: top.depth_charges.depth_charges_per_attack, damage: top.depth_charges.depth_charge?.damage }, { caption: "Depth charges" });
  if (top.sonar) asw += kvTable(top.sonar, { caption: "Sonar" });
  const cons = top.consumables.map((sl) => `<div class="slot"><h3>Slot ${sl.slot + 1}</h3>${sl.options.map((o) => `<div class="cons"><p class="cons-name">${esc(o.name)}</p><p class="cons-meta">${o.charges === "unlimited" ? "Unlimited charges" : `${esc(o.charges)} charges`} · ${fmtVal("x_s", o.reload_s)} cooldown${o.duration_s ? ` · ${fmtVal("x_s", o.duration_s)} action time` : ""}${o.preparation_time_s ? ` · ${fmtVal("x_s", o.preparation_time_s)} preparation` : ""}</p>${(() => { const eff = Object.values(o.effects ?? {}).filter(showEffect); return eff.length ? `<ul>${eff.map((e) => `<li>${esc(e.label.charAt(0).toUpperCase() + e.label.slice(1))}: ${esc(e.display ?? `${e.value}${unitText(e.unit)}`)}</li>`).join("")}</ul>` : ""; })()}</div>`).join('<p class="or">or</p>')}</div>`).join("");
  const special = rec.special_ability ? kvTable({ name: rec.special_ability.name, how_to_activate: rec.special_ability.how_to_activate, duration_s: rec.special_ability.duration_s }) + `<ul>${Object.values(rec.special_ability.effects ?? {}).map((e) => `<li>${esc(e.label)}: ${esc(e.display)}</li>`).join("")}</ul>` : "";

  const changeList = (ch) => (ch?.length ? `<ul class="changes">${ch.map((c) => `<li class="${c.better === true ? "up" : c.better === false ? "down" : ""}">${esc(prettyKey(c.metric.split(".").slice(-1)[0]))} <span class="path">(${esc(c.metric)})</span>: ${fmtVal(c.metric, c.before)} → ${fmtVal(c.metric, c.after)}${c.change_pct !== null && c.change_pct !== undefined ? ` <span class="pct">${c.change_pct > 0 ? "+" : ""}${c.change_pct}%</span>` : ""}</li>`).join("")}</ul>` : "");
  const effectsText = (e) => (e?.length ? e.map((x) => `${esc(x.display)} ${esc(x.label)}`).join("; ") : "");
  const upgrades = rec.upgrades.slots.map((sl) => `<div class="slot"><h3>Slot ${sl.slot}</h3>${sl.options.map((o) => `<details><summary><strong>${esc(o.name)}</strong> <span class="eff">${effectsText(o.effects)}</span></summary>${changeList(o.stat_changes) || '<p class="note">No calculated stat on this site changes; see the effect above.</p>'}</details>`).join("")}</div>`).join("")
    + (Object.keys(rec.upgrades.best_possible_values?.metrics ?? {}).length ? `<details><summary><strong>Best value for each stat</strong> (each line may need different upgrades)</summary><div class="scroll"><table class="grid"><thead><tr><th scope="col">Stat</th><th scope="col">Base</th><th scope="col">Best</th><th scope="col">Upgrades</th></tr></thead><tbody>${Object.entries(rec.upgrades.best_possible_values.metrics).map(([k, b]) => `<tr><th scope="row">${esc(k)}</th><td>${fmtVal(k, b.base)}</td><td>${fmtVal(k, b.best)}</td><td>${esc(b.upgrades.map((u) => u.name).join(" + "))}</td></tr>`).join("")}</tbody></table></div></details>` : "");
  const skills = `<p class="note">A commander has 21 skill points; a skill costs its row number in points.</p>` + rec.captain_skills.skills.slice().sort((a, b) => (a.row - b.row) || (a.column - b.column)).map((k) => `<details><summary><strong>${esc(k.name)}</strong> <span class="badge">${esc(k.point_cost)} pt</span> <span class="eff">${effectsText(k.effects)}</span></summary>${k.description ? `<p>${esc(k.description)}</p>` : ""}${changeList(k.stat_changes)}${k.note ? `<p class="note">${esc(k.note)}</p>` : ""}${k.conditional_effects ? `<ul>${k.conditional_effects.map((g) => `<li>${g.trigger ? `When ${esc(g.trigger)}: ` : ""}${effectsText(g.effects)}</li>`).join("")}</ul>` : ""}</details>`).join("");
  const flags = rec.signal_flags.flags.map((f) => `<details><summary><strong>${esc(f.name)}</strong> <span class="eff">${effectsText(f.effects)}</span></summary>${changeList(f.stat_changes) || '<p class="note">No calculated stat on this site changes.</p>'}</details>`).join("");
  const modules = `<p>${rec.module_combinations.count} module combination${rec.module_combinations.count === 1 ? "" : "s"}. Values on this page use the fully researched (“top”) modules: ${esc(Object.values(top.modules).join(", "))}.</p>`
    + (rec.configurations.stock ? gridTable([["Hit points", "survivability", "hit_points"], ["Max speed", "maneuverability", "max_speed_knots"], ["Rudder shift", "maneuverability", "rudder_shift_time_s"], ["Detectability", "concealment", "detectability_by_ships_km"], ["Main battery range", "main_battery", "range_km"], ["Main battery reload", "main_battery", "reload_s"]].filter(([, g, k]) => top[g]?.[k] !== undefined).map(([l, g, k]) => ({ stat: l, stock: fmtPlain(k, rec.configurations.stock[g]?.[k]), top: fmtPlain(k, top[g]?.[k]) })), { caption: "Stock vs top modules" }) : "")
    + `<p>Every combination with full stats: <a href="${configsUrl}">module combinations (JSON)</a>.</p>`;
  const hist = rec.stat_changes_history.entries.length ? rec.stat_changes_history.entries.map((e) => `<h3>${esc(e.previous_game_version)} → ${esc(e.game_version)}</h3><ul>${e.changes.map((c) => `<li>${esc(c.metric)}: ${fmtVal(c.metric, c.before)} → ${fmtVal(c.metric, c.after)}</li>`).join("")}</ul>`).join("") : `<p>No stat changes recorded for this ship since this site started tracking (${esc(rec.stat_changes_history.about.match(/started with ([^)]+)\)/)?.[1] ?? "")}).</p>`;
  const all = `<details><summary>Show all ${Object.keys(m).length} stats</summary><div class="scroll"><table class="grid compact"><thead><tr><th scope="col">Metric</th><th scope="col">Value</th></tr></thead><tbody>${Object.entries(m).map(([k, v]) => `<tr><th scope="row"><code>${esc(k)}</code></th><td>${fmtVal(k, v)}</td></tr>`).join("")}</tbody></table></div></details>`;

  const sections = [
    add("survivability", "Survivability", survival),
    add("maneuverability", "Maneuverability", kvTable(top.maneuverability)),
    add("concealment", "Concealment", concealment),
    add("main-battery", "Main battery", mb),
    add("secondaries", "Secondary battery", secHtml),
    add("torpedoes", "Torpedoes", torp),
    add("anti-air", "Anti-aircraft", aa),
    add("aircraft", "Aircraft", air),
    add("asw", "Anti-submarine and sonar", asw),
    add("consumables", "Consumables", cons),
    add("special", "Special ability", special),
    add("modules", "Modules", modules),
    add("upgrades", "Upgrades", upgrades),
    add("skills", "Commander skills", skills),
    add("signals", "Signal flags", flags),
    add("history", "Changes between game versions", hist),
    add("all-stats", "All stats", all),
    add("similar", `Other tier ${roman(rec.tier)} ${classLabel(rec.class).toLowerCase()}s`, similar.length ? `<p class="similar">${similar.map((x) => `<a href="${related(x.index)}">${esc(x.name)}</a> <span class="note">(${esc(nationLabel(x.nation))})</span>`).join(" · ")}</p><p><a href="${href(`compare.html?ships=${[rec.index, ...similar.slice(0, 3).map((x) => x.index)].join(",")}`)}">Compare ${esc(rec.name)} with ${similar.length > 3 ? "three of them" : "them"}</a></p>` : ""),
    add("data", "Data and sources", `<ul><li><a href="${mdUrl}">This ship as Markdown</a> · <a href="${jsonUrl}">as JSON</a> · <a href="${configsUrl}">all module combinations (JSON)</a></li><li>Values are base values (no commander skills, upgrades, signals or camouflage) unless a section says otherwise, calculated from game data with WoWs ShipBuilder's formulas.${rec.armor ? ` Armor: <a href="${esc(rec.armor.source)}">official wiki</a>.` : ""}</li></ul>`),
  ].join("\n");

  const body = `<article class="ship">
<header class="ship-head">
  <div><p class="kicker">${esc(sub)}</p><h1>${esc(title)}</h1>${rec.full_name && rec.full_name !== rec.name ? `<p class="full">${esc(rec.full_name)}</p>` : ""}</div>
  <a class="btn" href="${href(`compare.html?ships=${encodeURIComponent(rec.index)}`)}">Compare</a>
</header>
<div class="ship-grid">
  <aside class="infobox" aria-label="Summary">
    <table class="kv"><tbody>${info.map(([l, v]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
    ${nav}${armor}
    <nav class="toc" aria-label="On this page"><p class="lbl">On this page</p><ol>${toc.map(([id, h]) => `<li><a href="#${id}">${esc(h)}</a></li>`).join("")}</ol></nav>
  </aside>
  <div class="ship-main">
    ${rec.description ? `<p class="lead">${esc(rec.description)}</p><p class="note">In-game description © Wargaming.</p>` : ""}
    ${keyHtml}
    ${sections}
  </div>
</div>
</article>`;
  return layout({
    title: `${title} — ${sub}`, description: `${title}: ${sub}. Stats, armor, guns, torpedoes, consumables, upgrades and commander skills (game version ${rec.game_version}).`,
    path: shipUrl, body, crumbs: [["Ships", "ships/"], [classLabel(rec.class) + "s", `ships/class/${rec.class}/`], [title, shipUrl]],
    alternates: [{ type: "text/markdown", href: mdUrl, title: "Markdown" }, { type: "application/json", href: jsonUrl, title: "JSON" }],
    jsonld: { "@context": "https://schema.org", "@type": "WebPage", name: `${title} (World of Warships)`, about: { "@type": "Thing", name: title, description: sub }, dateModified: rec.generated_at, isPartOf: { "@type": "WebSite", name: "WoWs Data", url: href("") } },
  });
}
// Effects named only by an internal game field (lowercase, no English label) or with a 0 value are left out of the
// human page; they stay in the JSON and Markdown data.
const showEffect = (e) => e && !(typeof e.value === "number" && e.value === 0) && /^[A-Z]/.test(e.label ?? "");
const UNIT_TEXT = { hp: " HP", hp_per_s: " HP/s", km: " km", s: " s", m: " m", knots: " kn", pct: "%", pct_change: "%", mm: " mm", deg: "°", kg: " kg", m_per_s: " m/s", deg_per_s: "°/s" };
const unitText = (u) => (u ? UNIT_TEXT[u] ?? ` ${u}` : "");
const fmtPlain = (k, v) => (v === null || v === undefined ? null : v);

// ---------- stylesheet ----------
export const CSS = `
:root{--bg:#f6f3ec;--paper:#fffdf8;--ink:#1b2430;--muted:#5d6876;--line:#ddd5c4;--navy:#14304f;--navy2:#1d4470;--brass:#a5782b;--accent:#1f6fb2;--up:#1f7a4d;--down:#b3402a;--row:#f3eee2;--code:#efe9db}
@media (prefers-color-scheme:dark){:root{--bg:#0f1620;--paper:#151e2a;--ink:#e3e8ee;--muted:#9aa7b6;--line:#2a3646;--navy:#0b1a2b;--navy2:#13304f;--brass:#d2a457;--accent:#7fb7ea;--up:#5cc28f;--down:#ef8a73;--row:#1a2533;--code:#1d2938}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}a:hover{text-decoration-thickness:2px}
h1,h2,h3{font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;line-height:1.2;color:var(--ink)}
h1{font-size:clamp(1.8rem,4vw,2.6rem);margin:.1em 0}h2{font-size:1.45rem;margin:2rem 0 .75rem;padding-bottom:.35rem;border-bottom:2px solid var(--line)}h3{font-size:1.1rem;margin:1.2rem 0 .5rem}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:.05em .3em;border-radius:3px}
pre{background:var(--code);padding:1rem;overflow:auto;border-radius:6px}pre code{background:none;padding:0}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--paper);padding:.5rem;z-index:9}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.top{background:linear-gradient(180deg,var(--navy2),var(--navy));color:#fff;border-bottom:3px solid var(--brass)}
.top-in{max-width:1200px;margin:0 auto;padding:.6rem 16px;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.25rem}
.brand{color:#fff;text-decoration:none;font:700 1.25rem/1 Georgia,serif;display:flex;align-items:center;gap:.4rem}.brand-mark{color:var(--brass)}.brand-sub{font:400 .78rem/1 system-ui,sans-serif;opacity:.75;margin-left:.2rem}
.top nav{display:flex;flex-wrap:wrap;gap:.2rem .9rem}.top nav a{color:#e8eef5;text-decoration:none;font-weight:500;padding:.2rem 0;border-bottom:2px solid transparent}.top nav a:hover{border-bottom-color:var(--brass)}
.search{margin-left:auto;flex:1 1 200px;max-width:320px}.search input{width:100%;padding:.45rem .7rem;border-radius:6px;border:1px solid #4a6a8f;background:#0e2440;color:#fff;font:inherit}.search input::placeholder{color:#a9bbd0}
.crumbs{max-width:1200px;margin:0 auto;padding:.6rem 16px 0;font-size:.88rem;color:var(--muted)}.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap}.crumbs li+li:before{content:"›";margin:0 .45rem;color:var(--muted)}
main{max-width:1200px;margin:0 auto;padding:1rem 16px 3rem}
.foot{background:var(--paper);border-top:1px solid var(--line);color:var(--muted);font-size:.88rem}.foot-in{max-width:1200px;margin:0 auto;padding:1.2rem 16px}.disclaimer{font-size:.82rem}
table{border-collapse:collapse;width:100%;background:var(--paper)}caption{text-align:left;font-weight:600;padding:.5rem 0 .35rem;color:var(--ink)}
th,td{padding:.38rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}thead th{background:var(--row);font-size:.85rem;color:var(--muted);font-weight:600;white-space:nowrap;position:sticky;top:0}
.kv{margin:.4rem 0 1rem;max-width:680px}.kv th{width:55%;font-weight:500;color:var(--muted)}.kv td{font-variant-numeric:tabular-nums}
.grid td,.grid th{font-variant-numeric:tabular-nums}.grid tbody tr:nth-child(even){background:var(--row)}.grid.compact td,.grid.compact th{padding:.2rem .5rem;font-size:.9rem}
.scroll{overflow-x:auto;margin:.4rem 0 1rem;border:1px solid var(--line);border-radius:6px}.scroll table{margin:0}
.u{color:var(--muted);font-size:.9em}.na{color:var(--muted)}.note{color:var(--muted);font-size:.9rem}
.lead{font-size:1.05rem}.kicker{margin:0;color:var(--brass);font-weight:600;letter-spacing:.02em}.full{margin:0;color:var(--muted)}
.ship-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin:.5rem 0 1rem}
.btn{display:inline-block;background:var(--navy2);color:#fff;text-decoration:none;padding:.45rem .9rem;border-radius:6px;font-weight:600;white-space:nowrap}.btn:hover{background:var(--navy)}
.ship-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:1.5rem}.ship-main{min-width:0}@media (max-width:860px){.ship-grid{grid-template-columns:minmax(0,1fr)}.toc{display:none}.infobox{position:static;max-height:none}}
.infobox{background:var(--paper);border:1px solid var(--line);border-top:4px solid var(--brass);border-radius:6px;padding:.75rem;align-self:start;position:sticky;top:.75rem;max-height:calc(100vh - 1.5rem);overflow:auto}
.infobox .kv th{width:45%}.lbl{display:block;font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.infobox p{margin:.5rem 0}
.toc ol{margin:.25rem 0 0;padding-left:1.1rem;font-size:.92rem}
.keystats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem;margin:1rem 0;padding:0}.keystats div{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:.55rem .7rem}.keystats dt{font-size:.8rem;color:var(--muted)}.keystats dd{margin:.1rem 0 0;font-size:1.25rem;font-weight:600;font-variant-numeric:tabular-nums}
.slot{border-left:3px solid var(--line);padding-left:.8rem;margin:.6rem 0 1rem}.cons-name{font-weight:600;margin:.3rem 0 0}.cons-meta{margin:0;color:var(--muted);font-size:.92rem}.cons ul{margin:.2rem 0 .4rem;padding-left:1.2rem;font-size:.92rem}.or{margin:.2rem 0;color:var(--muted);font-style:italic;font-size:.9rem}
details{background:var(--paper);border:1px solid var(--line);border-radius:6px;margin:.35rem 0;padding:.4rem .7rem}summary{cursor:pointer}.eff{color:var(--muted);font-size:.9rem}.badge{display:inline-block;background:var(--row);border:1px solid var(--line);border-radius:10px;padding:0 .45rem;font-size:.78rem}
.changes{margin:.4rem 0;padding-left:1.2rem;font-size:.92rem}.changes .up{color:var(--up)}.changes .down{color:var(--down)}.path{color:var(--muted);font-size:.85em}.pct{font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.9rem;margin:1rem 0}.card{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:1rem;text-decoration:none;color:var(--ink);display:block}.card:hover{border-color:var(--brass)}.card h3{margin:0 0 .3rem}.card p{margin:0;color:var(--muted);font-size:.93rem}
.hero{background:linear-gradient(135deg,var(--navy2),var(--navy));color:#fff;border-radius:10px;padding:2rem 1.5rem;margin:1rem 0 1.5rem;border-bottom:4px solid var(--brass)}.hero h1{color:#fff;margin:0 0 .4rem}.hero p{margin:.2rem 0;color:#dbe5f0;max-width:60ch}
.hero form{margin-top:1rem;display:flex;gap:.5rem;max-width:520px}.hero input{flex:1;padding:.65rem .8rem;border-radius:6px;border:0;font:inherit}.hero button{padding:.65rem 1rem;border-radius:6px;border:0;background:var(--brass);color:#fff;font-weight:700;cursor:pointer}
.filters{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end;margin:.8rem 0;padding:.7rem;background:var(--paper);border:1px solid var(--line);border-radius:6px}.filters label{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted);gap:.15rem}.filters select,.filters input{font:inherit;padding:.35rem .5rem;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink)}
.count{color:var(--muted);font-size:.9rem;margin:.3rem 0}
.cmp-pick{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0}.cmp-pick input{font:inherit;padding:.45rem .6rem;border:1px solid var(--line);border-radius:5px;min-width:220px;background:var(--paper);color:var(--ink)}.cmp-pick .chk{display:flex;align-items:center;gap:.35rem;color:var(--muted)}.cmp-pick .chk input{min-width:0}.cmp-pick button{font:inherit;padding:.45rem .8rem;border-radius:5px;border:1px solid var(--line);background:var(--paper);color:var(--ink);cursor:pointer}
td.best{font-weight:700;color:var(--up)}th.grp{background:var(--row);text-transform:capitalize;font-family:Georgia,serif;font-size:1rem;color:var(--ink)}
.prose{max-width:75ch}.similar{line-height:1.9}.prose,.ship-main{overflow-wrap:anywhere}ul.cols{columns:3 260px;padding-left:1.1rem}ul.cols li{break-inside:avoid;margin:.1rem 0}
@media (max-width:560px){.search{max-width:none;flex-basis:100%}.hero{padding:1.4rem 1rem}.hero form{flex-wrap:wrap}.hero input{min-width:0}.brand-sub{display:none}}
`;

// ---------- small script: table filters, search from ?q=, comparison ----------
export const JS = `
(function(){
  var qs=new URLSearchParams(location.search);
  // Filterable tables: <table data-filter> with rows carrying data-* attributes
  document.querySelectorAll('[data-filter-form]').forEach(function(form){
    var table=document.getElementById(form.getAttribute('data-filter-form'));if(!table)return;
    var rows=[].slice.call(table.tBodies[0].rows);var count=document.getElementById(form.getAttribute('data-count'));
    var inputs=[].slice.call(form.querySelectorAll('input,select'));
    inputs.forEach(function(i){if(qs.has(i.name))i.value=qs.get(i.name);});
    function apply(){var f={};inputs.forEach(function(i){f[i.name]=(i.value||'').toLowerCase().trim();});var n=0;
      rows.forEach(function(r){var ok=true;for(var k in f){if(!f[k])continue;var v=(r.getAttribute('data-'+k)||'').toLowerCase();if(k==='q'){if(v.indexOf(f[k].normalize('NFKD').replace(/[\\u0300-\\u036f]/g,''))<0)ok=false;}else if(v!==f[k])ok=false;}r.hidden=!ok;if(ok)n++;});
      if(count)count.textContent=n+' ship'+(n===1?'':'s')+' shown';}
    inputs.forEach(function(i){i.addEventListener('input',apply);i.addEventListener('change',apply);});
    form.addEventListener('submit',function(e){e.preventDefault();});apply();
  });
  // Comparison tool
  var cmp=document.getElementById('compare-app');if(!cmp)return;
  var base=cmp.getAttribute('data-base');var list=null;var chosen=(qs.get('ships')||'').split(',').filter(Boolean);
  var diffBox=document.getElementById('cmp-diff');if(diffBox)diffBox.addEventListener('change',function(){render();});
  var input=document.getElementById('cmp-input'),addBtn=document.getElementById('cmp-add'),out=document.getElementById('cmp-out'),dl=document.getElementById('cmp-list');
  fetch(base+'/api/index.json').then(function(r){return r.json();}).then(function(d){list=d.ships;dl.innerHTML=list.map(function(s){return '<option value="'+s.name.replace(/"/g,'&quot;')+' (tier '+s.tier+' '+s.nation+')">';}).join('');render();});
  function find(v){v=(v||'').trim().toLowerCase();return list.filter(function(s){return (s.name+' (tier '+s.tier+' '+s.nation+')').toLowerCase()===v||s.name.toLowerCase()===v||s.index.toLowerCase()===v;})[0];}
  addBtn.addEventListener('click',function(){var s=find(input.value);if(s&&chosen.indexOf(s.index)<0&&chosen.length<4){chosen.push(s.index);input.value='';render();}});
  input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();addBtn.click();}});
  function render(){history.replaceState(null,'',chosen.length?'?ships='+chosen.join(','):location.pathname);
    if(!chosen.length){out.innerHTML='<p class="note">Add up to four ships to compare them side by side.</p>';return;}
    Promise.all(chosen.map(function(i){return fetch(base+'/api/ships/'+i+'.json').then(function(r){return r.json();});})).then(function(ships){
      var keys={};ships.forEach(function(s){Object.keys(s.all_metrics_top_configuration).forEach(function(k){keys[k]=1;});});
      var dirs={};return fetch(base+'/api/metrics.json').then(function(r){return r.json();}).then(function(md){md.metrics.forEach(function(m){dirs[m.metric]=m.direction;});
      var ORDER=['survivability','armor','maneuverability','concealment','main_battery','secondaries','torpedoes','anti_air','aircraft','airstrikes','depth_charges','sonar','consumables'];
      var groups={};Object.keys(keys).sort().forEach(function(k){var g=k.split('.')[0];(groups[g]=groups[g]||[]).push(k);});
      var gnames=Object.keys(groups).sort(function(a,b){var ia=ORDER.indexOf(a),ib=ORDER.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);});
      var U=[['_deg_per_s','°/s'],['_m_per_s','m/s'],['_per_minute','/min'],['_per_s','/s'],['_pct_change','%'],['_pct','%'],['_knots','kn'],['_km','km'],['_mm','mm'],['_kg','kg'],['_deg','°'],['_hp','HP'],['_s','s'],['_m','m']];
      function label(k){var p=k.split('.').slice(1);var last=p.pop()||k;var u='';for(var i=0;i<U.length;i++){if(last.slice(-U[i][0].length)===U[i][0]){u=U[i][1];last=last.slice(0,-U[i][0].length);break;}}return p.concat([last]).join(' › ').replace(/_/g,' ')+(u?' ('+u+')':'');}
      var onlyDiff=document.getElementById('cmp-diff')&&document.getElementById('cmp-diff').checked;
      var h='<div class="scroll"><table class="grid compact"><thead><tr><th scope="col">Stat</th>'+ships.map(function(s,i){return '<th scope="col"><a href="'+base+'/ships/'+s.slug+'/">'+s.name+'</a> <button type="button" data-rm="'+i+'" aria-label="Remove '+s.name+'">×</button><br><span class="note">tier '+s.tier+' '+s.nation.replace(/_/g,' ')+' '+s.class.replace(/_/g,' ')+'</span></th>';}).join('')+'</tr></thead><tbody>';
      var KEY=['survivability.hit_points','maneuverability.max_speed_knots','maneuverability.rudder_shift_time_s','concealment.detectability_by_ships_km','concealment.min_detectability_by_ships_km','main_battery.range_km','main_battery.reload_s','main_battery.he_damage_per_minute','main_battery.ap_damage_per_minute','main_battery.shells.ap.penetration_at_15km_mm','main_battery.shells.he.penetration_mm','torpedoes.torpedoes.primary.damage','torpedoes.torpedoes.primary.range_km','anti_air.total_continuous_damage_per_s','armor.belt_mm'].filter(function(k){return keys[k];});
      groups={key:KEY};Object.keys(keys).sort().forEach(function(k){var g=k.split('.')[0];(groups[g]=groups[g]||[]).push(k);});gnames=['key'].concat(gnames.filter(function(g){return g!=='key';}));
      var label0=label;label=function(k){return KEY.indexOf(k)>=0&&k.split('.').length>1?k.split('.')[0].replace(/_/g,' ')+' › '+label0(k):label0(k);};
      gnames.forEach(function(g){var rowsH='';
        groups[g].forEach(function(k){var vals=ships.map(function(s){return s.all_metrics_top_configuration[k];});var nums=vals.filter(function(v){return typeof v==='number';});
          var differ=vals.some(function(v){return v!==vals[0];});if(onlyDiff&&!differ)return;var best=null;
          if(differ&&nums.length>1&&dirs[k]==='higher_is_better')best=Math.max.apply(null,nums);if(differ&&nums.length>1&&dirs[k]==='lower_is_better')best=Math.min.apply(null,nums);
          rowsH+='<tr><th scope="row" title="'+k+'">'+label(k)+'</th>'+vals.map(function(v){return '<td'+(best!==null&&v===best?' class="best"':'')+'>'+(v===undefined?'—':v)+'</td>';}).join('')+'</tr>';});
        if(rowsH)h+='<tr><th colspan="'+(ships.length+1)+'" scope="rowgroup" class="grp">'+(g==='key'?'Key stats':g.replace(/_/g,' '))+'</th></tr>'+rowsH;});
      out.innerHTML=h+'</tbody></table></div><p class="note">Green = better value where “better” is clear. Base values, fully researched modules. Hover a stat for its exact name in the data.</p>';
      out.querySelectorAll('[data-rm]').forEach(function(b){b.addEventListener('click',function(){chosen.splice(+b.getAttribute('data-rm'),1);render();});});});});}
})();
`;

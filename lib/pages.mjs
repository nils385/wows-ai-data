// Encyclopedia pages other than individual ships. All content is plain HTML; JavaScript only filters.
import { esc, fmtVal, prettyKey, classLabel, nationLabel, categoryLabel, roman, mdToHtml, metricTitle } from "./site.mjs";

const CLASS_ORDER = ["destroyer", "cruiser", "battleship", "aircraft_carrier", "submarine"];
const CLASS_BLURB = {
  destroyer: "Fast and stealthy. Torpedoes, smoke and capturing points.",
  cruiser: "Versatile gunships with fast-firing guns and support consumables like radar.",
  battleship: "Heavy armor, big guns and a lot of hit points.",
  aircraft_carrier: "Command squadrons of aircraft from far behind the front.",
  submarine: "Dive, ping and launch homing torpedoes.",
};

export function renderHome({ layout, base, rows, gameVersion, updated, nations, counts }) {
  const href = (p) => `${base}/${p}`;
  const byClass = (c) => rows.filter((r) => r.class === c).length;
  const body = `
<section class="hero">
  <h1>World of Warships encyclopedia</h1>
  <p>Stats for all ${rows.length} ships, calculated from the game files of version ${esc(gameVersion)}: armor, guns, shells, torpedoes, concealment, consumables, upgrades and commander skills.</p>
  <form action="${href("ships/")}" method="get" role="search"><label for="hq" class="sr">Search ships</label><input id="hq" name="q" type="search" placeholder="Search a ship, e.g. Yamato"><button type="submit">Search</button></form>
</section>
<h2>Browse by class</h2>
<div class="cards">${CLASS_ORDER.filter(byClass).map((c) => `<a class="card" href="${href(`ships/class/${c}/`)}"><h3>${esc(classLabel(c))}s</h3><p>${esc(CLASS_BLURB[c])}</p><p>${byClass(c)} ships</p></a>`).join("")}</div>
<h2>Browse by nation</h2>
<p>${nations.map((n) => `<a href="${href(`ships/?nation=${n}`)}">${esc(nationLabel(n))}</a> (${rows.filter((r) => r.nation === n).length})`).join(" · ")}</p>
<h2>Tools and guides</h2>
<div class="cards">
  <a class="card" href="${href("compare.html")}"><h3>Compare ships</h3><p>Put up to four ships side by side, stat by stat.</p></a>
  <a class="card" href="${href("rankings/")}"><h3>Rankings</h3><p>${counts.rankings} leaderboards: concealment, reload, range, penetration and more, by class, tier and nation.</p></a>
  <a class="card" href="${href("guides/mechanics/")}"><h3>Game mechanics</h3><p>How damage, penetration, detection and dispersion work, with the formulas behind the numbers.</p></a>
  <a class="card" href="${href("guides/glossary/")}"><h3>Glossary</h3><p>Abbreviations and nicknames: CE, IFHE, DCP, Big Mamie and more.</p></a>
  <a class="card" href="${href("guides/tech-tree/")}"><h3>Tech trees</h3><p>Research lines for every nation.</p></a>
  <a class="card" href="${href("guides/upgrades/")}"><h3>Upgrades, skills and signals</h3><p>Every upgrade, commander skill and signal flag with its effects.</p></a>
  <a class="card" href="${href("guides/changes/")}"><h3>Changes between versions</h3><p>Ship stat changes recorded patch by patch.</p></a>
  <a class="card" href="${href("guides/community/")}"><h3>Community builds and opinions</h3><p>What current guides and forums recommend, with sources. Opinion, not game data.</p></a>
</div>
<p class="note">Game version ${esc(gameVersion)} · updated ${esc(updated)} · <a href="${href("about/")}">how the numbers are calculated and checked</a></p>`;
  return layout({ title: "World of Warships encyclopedia", description: `Unofficial World of Warships encyclopedia: stats for all ${rows.length} ships, rankings, comparisons and game mechanics (game version ${gameVersion}).`, path: "", body,
    jsonld: { "@context": "https://schema.org", "@type": "WebSite", name: "WoWs Data", url: href(""), potentialAction: { "@type": "SearchAction", target: `${href("ships/")}?q={search_term_string}`, "query-input": "required name=search_term_string" } } });
}

const COLS = [
  ["survivability.hit_points", "HP"], ["maneuverability.max_speed_knots", "Speed"], ["concealment.detectability_by_ships_km", "Detect."],
  ["main_battery.range_km", "Range"], ["main_battery.reload_s", "Reload"], ["torpedoes.torpedoes.primary.range_km", "Torp. range"],
];
const plain = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function renderShipsIndex({ layout, base, rows, nations, shipUrl, onlyClass = null }) {
  const href = (p) => `${base}/${p}`;
  const sorted = [...rows].sort((a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || a.tier - b.tier || a.nation.localeCompare(b.nation) || a.name.localeCompare(b.name));
  const opt = (vals, lab) => vals.map((v) => `<option value="${esc(v)}">${esc(lab(v))}</option>`).join("");
  const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => a - b);
  if (onlyClass) rows = rows.filter((r) => r.class === onlyClass);
  const heading = onlyClass ? `${classLabel(onlyClass)}s` : "Ships";
  const body = `<h1>${esc(heading)}</h1>
${onlyClass ? `<p>${esc(CLASS_BLURB[onlyClass])} Other classes: ${CLASS_ORDER.filter((c) => c !== onlyClass).map((c) => `<a href="${href(`ships/class/${c}/`)}">${esc(classLabel(c))}s</a>`).join(" · ")} · <a href="${href("ships/")}">all ships</a></p>` : `<p>By class: ${CLASS_ORDER.map((c) => `<a href="${href(`ships/class/${c}/`)}">${esc(classLabel(c))}s</a>`).join(" · ")}</p>`}
<p>${onlyClass ? `All ${rows.length} ${esc(classLabel(onlyClass).toLowerCase())}s.` : `All ${rows.length} released ships.`} Values are base values with fully researched modules. Click a column name in a ranking for the full leaderboard.</p>
<form class="filters" data-filter-form="ship-table" data-count="ship-count">
  <label>Search<input name="q" type="search" placeholder="Name"></label>
  ${onlyClass ? "" : `<label>Class<select name="class"><option value="">All</option>${opt(CLASS_ORDER.filter((c) => rows.some((r) => r.class === c)), classLabel)}</select></label>`}
  <label>Tier<select name="tier"><option value="">All</option>${opt(tiers.map(String), (t) => roman(+t))}</select></label>
  <label>Nation<select name="nation"><option value="">All</option>${opt(nations, nationLabel)}</select></label>
  <label>Type<select name="category"><option value="">All</option>${opt(["tech_tree", "premium", "special"], categoryLabel)}</select></label>
</form>
<p class="count" id="ship-count" aria-live="polite">${rows.length} ships</p>
<div class="scroll"><table class="grid" id="ship-table"><thead><tr><th scope="col">Ship</th><th scope="col">Tier</th><th scope="col">Class</th><th scope="col">Nation</th><th scope="col">Type</th>${COLS.map(([k, l]) => `<th scope="col"><a href="${href(`rankings/${k}/`)}">${esc(l)}</a></th>`).join("")}</tr></thead><tbody>
${sorted.map((r) => `<tr data-q="${esc(plain(r.name))}" data-class="${r.class}" data-tier="${r.tier}" data-nation="${r.nation}" data-category="${r.category}"><th scope="row"><a href="${shipUrl(r.index)}">${esc(r.name)}</a></th><td>${roman(r.tier)}</td><td>${esc(classLabel(r.class))}</td><td>${esc(nationLabel(r.nation))}</td><td>${esc(categoryLabel(r.category))}</td>${COLS.map(([k]) => `<td>${fmtVal(k, r.metrics[k])}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>
<noscript><p class="note">Filters need JavaScript; the full list above works without it. Lists per class are also in <a href="${href("ships.md")}">Markdown</a>.</p></noscript>`;
  const path = onlyClass ? `ships/class/${onlyClass}/` : "ships/";
  return layout({ title: onlyClass ? `${classLabel(onlyClass)}s` : "All ships", description: `Searchable list of ${onlyClass ? `all World of Warships ${classLabel(onlyClass).toLowerCase()}s` : `all ${rows.length} World of Warships ships`} with tier, nation and key stats.`, path, body, crumbs: onlyClass ? [["Ships", "ships/"], [`${classLabel(onlyClass)}s`, path]] : [["Ships", "ships/"]] });
}

const RANK_ORDER = ["survivability", "maneuverability", "concealment", "main_battery", "secondaries", "torpedoes", "anti_air", "armor", "consumables", "depth_charges", "sonar", "airstrikes", "aircraft", "hull_size_m", "fire_control"];
const rankOrder = (g) => (RANK_ORDER.includes(g) ? RANK_ORDER.indexOf(g) : 99);
export function renderRankingsIndex({ layout, base, groups, metricDocs }) {
  const href = (p) => `${base}/${p}`;
  const docBy = Object.fromEntries(metricDocs.map((d) => [d.metric, d]));
  const POPULAR = ["concealment.min_detectability_by_ships_km", "main_battery.reload_s", "main_battery.range_km", "main_battery.he_damage_per_minute", "main_battery.ap_damage_per_minute", "main_battery.shells.ap.penetration_at_15km_mm", "survivability.hit_points", "maneuverability.max_speed_knots", "torpedoes.torpedoes.primary.damage", "consumables.surveillance_radar.detection_of_ships_km", "anti_air.total_continuous_damage_per_s", "armor.belt_mm"];
  const body = `<h1>Rankings</h1><p>Every numeric stat of every ship, ranked. Each leaderboard can be filtered by class, tier and nation.</p>
<h2>Popular</h2><div class="cards">${POPULAR.filter((m) => docBy[m]).map((m) => `<a class="card" href="${href(`rankings/${m}/`)}"><h3>${esc(metricTitle(m))}</h3><p>${esc(docBy[m].direction === "lower_is_better" ? "Lowest first" : "Highest first")} · ${docBy[m].ships_with_value} ships</p></a>`).join("")}</div>
<h2>All rankings by topic</h2>
${[...groups].sort((a, b) => rankOrder(a.group) - rankOrder(b.group) || a.group.localeCompare(b.group)).map((g, i) => { const items = g.items.filter((r) => r.family === "rankings"); return items.length ? `<details${rankOrder(g.group) < 8 ? " open" : ""}><summary><strong>${esc(metricTitle(g.group + ".x").split(":")[0])}</strong> <span class="note">(${items.length})</span></summary><ul class="cols">${items.map((r) => `<li><a href="${href(`rankings/${r.metric}/`)}">${esc(metricTitle(r.metric).replace(/^[^:]+: /, ""))}</a> <span class="note">(${r.ships})</span></li>`).join("")}</ul></details>` : ""; }).join("\n")}`;
  return layout({ title: "Rankings", description: "World of Warships ship rankings for every stat, filterable by class, tier and nation.", path: "rankings/", body, crumbs: [["Rankings", "rankings/"]] });
}

export function renderRankingPage({ layout, base, metric, doc, ranked, upgraded, shipUrl, nations }) {
  const href = (p) => `${base}/${p}`;
  const dirText = doc.direction === "lower_is_better" ? "Lower is better." : doc.direction === "higher_is_better" ? "Higher is better." : "No better or worse direction; sorted from highest.";
  const opt = (vals, lab) => vals.map((v) => `<option value="${esc(v)}">${esc(lab(v))}</option>`).join("");
  const tiers = [...new Set(ranked.map((r) => r.tier))].sort((a, b) => a - b);
  const via = Object.fromEntries((upgraded ?? []).map((r) => [r.index, r]));
  const title = metricTitle(metric);
  const body = `<h1>${esc(title)}</h1>
<p>${esc(doc.description)}. ${dirText} ${ranked.length} ships. Base values, fully researched modules.${upgraded ? " The last column shows the best value reachable with upgrades." : ""}</p>
<form class="filters" data-filter-form="rank-table" data-count="rank-count">
  <label>Class<select name="class"><option value="">All</option>${opt(CLASS_ORDER.filter((c) => ranked.some((r) => r.class === c)), classLabel)}</select></label>
  <label>Tier<select name="tier"><option value="">All</option>${opt(tiers.map(String), (t) => roman(+t))}</select></label>
  <label>Nation<select name="nation"><option value="">All</option>${opt(nations.filter((n) => ranked.some((r) => r.nation === n)), nationLabel)}</select></label>
</form>
<p class="count" id="rank-count" aria-live="polite">${ranked.length} ships</p>
<div class="scroll"><table class="grid" id="rank-table"><thead><tr><th scope="col">Rank</th><th scope="col">Ship</th><th scope="col">Tier</th><th scope="col">Class</th><th scope="col">Nation</th><th scope="col">Value</th>${upgraded ? '<th scope="col">With upgrades</th>' : ""}</tr></thead><tbody>
${ranked.map((r) => `<tr data-class="${r.class}" data-tier="${r.tier}" data-nation="${r.nation}"><td>${r.rank}</td><th scope="row"><a href="${shipUrl(r.index)}">${esc(r.name)}</a></th><td>${roman(r.tier)}</td><td>${esc(classLabel(r.class))}</td><td>${esc(nationLabel(r.nation))}</td><td>${fmtVal(metric, r.value)}</td>${upgraded ? `<td>${via[r.index] ? `${fmtVal(metric, via[r.index].value)}${via[r.index].upgrades_used ? ` <span class="note">(${esc(via[r.index].upgrades_used.join(" + "))})</span>` : ""}` : '<span class="na">—</span>'}</td>` : ""}</tr>`).join("\n")}
</tbody></table></div>
<p class="note">Ranks are for the full list; with filters on, the order still holds. Data: <a href="${href(`api/rankings/${metric}.json`)}">JSON</a> · <a href="${href(`rankings/${metric}.md`)}">Markdown</a>.</p>`;
  return layout({ title: `Ranking: ${title}`, description: `World of Warships ships ranked by ${title.toLowerCase()}.`, path: `rankings/${metric}/`, body, crumbs: [["Rankings", "rankings/"], [title, `rankings/${metric}/`]], alternates: [{ type: "application/json", href: href(`api/rankings/${metric}.json`), title: "JSON" }] });
}

export function renderTextPage({ layout, title, description, path, md, crumbs }) {
  // The Markdown sources start with their own "# Title" line; the page already has a heading.
  const html = mdToHtml(md.replace(/^# .*\n/, ""));
  return layout({ title, description, path, crumbs, body: `<div class="prose"><h1>${esc(title)}</h1>${html}</div>` });
}

export function renderGuidesIndex({ layout, base, nations }) {
  const href = (p) => `${base}/${p}`;
  const body = `<h1>Guides</h1><div class="cards">
<a class="card" href="${href("guides/mechanics/")}"><h3>Game mechanics</h3><p>Damage, penetration, overmatch, detection, dispersion and how upgrades stack.</p></a>
<a class="card" href="${href("guides/glossary/")}"><h3>Glossary</h3><p>Player abbreviations and ship nicknames.</p></a>
<a class="card" href="${href("guides/tech-tree/")}"><h3>Tech trees</h3><p>${nations.length} nations, every research line.</p></a>
<a class="card" href="${href("guides/upgrades/")}"><h3>Upgrades, skills and signals</h3><p>All of them with their effects.</p></a>
<a class="card" href="${href("guides/changes/")}"><h3>Changes between versions</h3><p>Recorded ship stat changes.</p></a>
<a class="card" href="${href("guides/community/")}"><h3>Community builds and opinions</h3><p>Sourced opinion, kept separate from game data.</p></a>
</div>`;
  return layout({ title: "Guides", description: "World of Warships guides: mechanics, glossary, tech trees, upgrades and community builds.", path: "guides/", body, crumbs: [["Guides", "guides/"]] });
}

export function renderUpgradesPage({ layout, base, upgrades, skillsByClass, flags }) {
  const eff = (e) => (e?.length ? e.map((x) => `${esc(x.display)} ${esc(x.label)}`).join("; ") : "");
  const bySlot = {};
  for (const u of upgrades) (bySlot[u.slot] ??= []).push(u);
  const body = `<h1>Upgrades, commander skills and signals</h1>
<p>Effects as stored in the game data. Each ship's page shows the exact effect of every option on that ship.</p>
<h2 id="upgrades">Upgrades</h2>${Object.entries(bySlot).map(([slot, list]) => `<h3>Slot ${esc(slot)}</h3><div class="scroll"><table class="grid"><thead><tr><th scope="col">Upgrade</th><th scope="col">Effects</th><th scope="col">Tiers</th><th scope="col">Classes</th></tr></thead><tbody>${list.map((u) => `<tr><th scope="row">${esc(u.name)}</th><td>${eff(u.effects)}</td><td>${esc(u.tiers.map(roman).join(", "))}</td><td>${esc(u.classes.map(classLabel).join(", "))}${u.also_on_ships?.length ? `<br><span class="note">also: ${esc(u.also_on_ships.slice(0, 8).join(", "))}${u.also_on_ships.length > 8 ? "…" : ""}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`).join("")}
<h2 id="skills">Commander skills</h2><p class="note">A commander has 21 points; a skill costs its row number.</p>
${Object.entries(skillsByClass).map(([c, list]) => `<h3>${esc(classLabel(c))}</h3><div class="scroll"><table class="grid"><thead><tr><th scope="col">Skill</th><th scope="col">Cost</th><th scope="col">Effects</th></tr></thead><tbody>${list.slice().sort((a, b) => a.row - b.row || a.column - b.column).map((k) => `<tr><th scope="row">${esc(k.name)}</th><td>${k.point_cost}</td><td>${eff(k.effects)}${k.conditional_effects ? `<br><span class="note">${k.conditional_effects.map((g) => `${g.trigger ? `When ${esc(g.trigger)}: ` : ""}${eff(g.effects)}`).join("<br>")}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`).join("")}
<h2 id="signals">Signal flags</h2><div class="scroll"><table class="grid"><thead><tr><th scope="col">Flag</th><th scope="col">Effects</th></tr></thead><tbody>${flags.map((f) => `<tr><th scope="row">${esc(f.name)}</th><td>${eff(f.effects)}</td></tr>`).join("")}</tbody></table></div>`;
  return layout({ title: "Upgrades, commander skills and signals", description: "Every World of Warships upgrade, commander skill and signal flag with its effects.", path: "guides/upgrades/", body, crumbs: [["Guides", "guides/"], ["Upgrades, skills and signals", "guides/upgrades/"]] });
}

export function renderCompare({ layout, base }) {
  const body = `<h1>Compare ships</h1>
<div id="compare-app" data-base="${esc(base)}">
  <div class="cmp-pick"><label for="cmp-input" class="sr">Ship name</label><input id="cmp-input" list="cmp-list" placeholder="Type a ship name, e.g. Des Moines"><datalist id="cmp-list"></datalist><button type="button" id="cmp-add">Add ship</button><label class="chk"><input type="checkbox" id="cmp-diff"> Show only differences</label></div>
  <div id="cmp-out"><noscript><p>The comparison tool needs JavaScript. Without it, open two ship pages side by side: their “All stats” tables use the same order. Or use the <a href="${esc(base)}/rankings/">rankings</a>.</p></noscript></div>
</div>`;
  return layout({ title: "Compare ships", description: "Compare World of Warships ships side by side, stat by stat.", path: "compare.html", body, crumbs: [["Compare", "compare.html"]], wide: true });
}

export function renderAbout({ layout, base, status, meta }) {
  const href = (p) => `${base}/${p}`;
  const v = status.wiki_crosscheck;
  const body = `<div class="prose"><h1>About the data</h1>
<p>WoWs Data is an unofficial, non-commercial fan encyclopedia. Every number is generated automatically from the game files and checked on every update.</p>
<h2>Where the numbers come from</h2>
<ul>
<li><strong>Game data</strong>: the public data files of <a href="https://app.wowssb.com">WoWs ShipBuilder</a>, extracted from the World of Warships game client each patch. Every file's checksum is verified.</li>
<li><strong>Calculations</strong>: a line-by-line port of WoWs ShipBuilder's open-source formulas (MIT license). Where ShipBuilder rounds away information, this site keeps more precision. One known ShipBuilder error is corrected: commander skills that shorten consumable cooldowns were applied twice to fighters.</li>
<li><strong>Armor thickness</strong>: the official World of Warships wiki (not contained in the game files used here). It is a snapshot and is updated by hand.</li>
<li><strong>Community opinion</strong>: the <a href="${href("guides/community/")}">community page</a> summarizes build guides and forums with links. It is opinion, not game data.</li>
</ul>
<h2>How the numbers are checked</h2>
<ul>
<li>Every update runs automatic checks on all ships and all ${esc(status.validation?.errors === 0 ? "module combinations" : "data")}: current result <strong>${status.validation?.passed ? "passed" : "failed"}</strong> (<a href="${href("api/validation.json")}">report</a>). If a check fails, the previous version stays online.</li>
${v ? `<li>Compared with the official wiki: ${esc(v.values_compared)} values on ${esc(v.ships_compared)} ships, <strong>${esc(v.match_rate_any_module_pct)}%</strong> match (<a href="${href("api/verification.json")}">report</a>). Most differences come from outdated wiki pages; every one is listed in the report.</li>` : ""}
</ul>
<h2>Version</h2><p>Game version <strong>${esc(meta.game_version)}</strong>, updated ${esc(meta.generated_at.slice(0, 16).replace("T", " "))} UTC. The site checks for new game data every 6 hours.</p>
<h2>For developers and AI tools</h2>
<p>All data is available in machine-readable form: <a href="${href("llms.txt")}">llms.txt</a> (start here), <a href="${href("api/schema.json")}">schema</a>, <a href="${href("api/metrics.json")}">metric dictionary</a>, <a href="${href("ships.jsonl")}">ships.jsonl</a>, <a href="${href("ships.csv")}">ships.csv</a>, and JSON and Markdown for every ship. Source code: <a href="https://github.com/nils385/wows-ai-data">GitHub</a>.</p></div>`;
  return layout({ title: "About the data", description: "Where WoWs Data's ship statistics come from and how they are checked.", path: "about/", body, crumbs: [["About", "about/"]] });
}

export function renderLegal({ layout }) {
  const body = `<div class="prose"><h1>Legal and attribution</h1>
<h2>Unofficial fan project</h2>
<p><strong>This work is unofficial and is not endorsed by Wargaming.</strong> WoWs Data is a non-commercial fan project. It is not affiliated with, sponsored by or approved by Wargaming.net or WoWs ShipBuilder. It has no advertising, no paid features, no accounts and no tracking.</p>
<h2>Trademarks and game content</h2>
<p>World of Warships, Wargaming and related names and marks are trademarks of Wargaming.net. Ship names, in-game descriptions and game statistics are © Wargaming.net and are used for reference only, in line with Wargaming's <a href="https://legal.wargaming.net/en/user-documents/content-policies/player-content-policy/view">Player Content Policy</a>. This site uses no Wargaming logos, artwork or images.</p>
<h2>Sources</h2>
<ul>
<li>Game data files: <a href="https://app.wowssb.com">WoWs ShipBuilder</a>. Calculation formulas ported from <a href="https://github.com/WoWs-Builder-Team/WoWs-ShipBuilder">WoWs ShipBuilder</a> (MIT license, © WoWs-Builder-Team).</li>
<li>Armor values and community terms: the official <a href="https://wiki.worldofwarships.com">World of Warships wiki</a>. Values are facts used for reference; definitions are linked rather than copied.</li>
<li>Community opinion: each statement links to its source.</li>
</ul>
<h2>Corrections and removal requests</h2>
<p>To report an error or ask for content to be removed, open an issue on <a href="https://github.com/nils385/wows-ai-data/issues">GitHub</a>.</p>
<h2>Privacy</h2>
<p>This site sets no cookies and runs no analytics. It is hosted on GitHub Pages; GitHub may keep standard server logs under its own privacy policy.</p></div>`;
  return layout({ title: "Legal and attribution", description: "Legal notice, trademarks, sources and privacy for WoWs Data.", path: "legal/", body, crumbs: [["Legal", "legal/"]] });
}

export function renderNotFound({ layout, base }) {
  const href = (p) => `${base}/${p}`;
  return layout({ title: "Page not found", description: "This page does not exist.", path: "404.html", body: `<h1>Page not found</h1><p>This page does not exist (anymore). Try the <a href="${href("ships/")}">ship list</a>, the <a href="${href("rankings/")}">rankings</a> or the <a href="${href("")}">homepage</a>.</p><form action="${href("ships/")}" method="get" role="search" class="cmp-pick"><label for="nf" class="sr">Search ships</label><input id="nf" name="q" type="search" placeholder="Search a ship"><button type="submit">Search</button></form>` });
}

export function redirectPage({ to, title }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="canonical" href="${esc(to)}"><meta http-equiv="refresh" content="0; url=${esc(to)}"><meta name="robots" content="noindex"></head><body><p>This page has moved to <a href="${esc(to)}">${esc(to)}</a>.</p></body></html>`;
}

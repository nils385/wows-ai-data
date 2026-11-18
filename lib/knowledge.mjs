// Pages that answer the questions AIs otherwise have to search many websites for:
// glossary (player abbreviations and nicknames), mechanics, tech tree lines, what changed between versions.
// Every abbreviation/nickname target is checked against the real game names at build time; unknown ones are dropped.

const SKILLS = {
  CE: "Concealment Expert", SI: "Superintendent", AR: "Adrenaline Rush", PT: "Priority Target", IFHE: "Inertia Fuse for HE Shells",
  DE: "Demolition Expert", RL: "Radio Location", PM: "Preventive Maintenance", BoS: "Basics of Survivability", TAM: "Torpedo Aiming Master",
  FP: "Fire Prevention Expert", FPE: "Fire Prevention Expert", SE: "Survivability Expert", MSBA: "Manual Secondary Battery Aiming", LS: "Last Stand",
  CS: "Consumable Specialist", SHAP: "Super-Heavy AP Shells", IFA: "Incoming Fire Alert", EM: "Grease the Gears",
  BFT: "Main Battery and AA Specialist", AFT: "Main Battery and AA Expert", "Pyro": "Pyrotechnician",
};
const SKILL_NOTES = { EM: "old name 'Expert Marksman'", BFT: "old name 'Basic Firing Training'", AFT: "old name 'Advanced Firing Training'" };
const UPGRADES = {
  GFCS: "Gun Fire Control System Modification 2", MBM3: "Main Battery Modification 3", MBM2: "Main Battery Modification 2", ASM1: "Aiming Systems Modification 1",
  CSM: "Concealment System Modification 1", "CSM1": "Concealment System Modification 1", SG2: "Steering Gears Modification 2", SGM2: "Steering Gears Modification 2",
  MA1: "Main Armaments Modification 1", TTM3: "Torpedo Tubes Modification 3", "DCSM1": "Damage Control System Modification 1", "APRM1": "Artillery Plotting Room Modification 1",
};
const CONSUMABLES = {
  DCP: "Damage Control Party", "DC": "Damage Control Party", "Heal": "Repair Party", RP: "Repair Party", Radar: "Surveillance Radar", Hydro: "Hydroacoustic Search",
  Smoke: "Smoke Generator", TRB: "Torpedo Reload Booster", MBRB: "Main Battery Reload Booster", "Speed boost": "Engine Boost", Spotter: "Spotting Aircraft",
};
const NICKNAMES = {
  Shima: "Shimakaze", DM: "Des Moines", Yama: "Yamato", Monty: "Montana", Mino: "Minotaur", Hindy: "Hindenburg", GK: "G. Kurfürst",
  Conq: "Conqueror", Petro: "Petropavlovsk", Khaba: "Khabarovsk", Haru: "Harugumo",
};
const CLASSES = { DD: "destroyer", CA: "cruiser (heavy cruiser, 155-203 mm guns)", CL: "cruiser (light cruiser, guns up to about 155 mm)", BB: "battleship", BC: "battlecruiser (listed as battleship or cruiser in game data)", CV: "aircraft carrier", SS: "submarine", SUB: "submarine" };
const TERMS = {
  HE: "high-explosive shell: fixed penetration, can start fires", AP: "armor-piercing shell: penetration falls with distance, can citadel", SAP: "semi-armor-piercing shell: fixed high penetration, no fires",
  DPM: "damage per minute (theoretical: all shells hit for full damage)", "Pen": "penetration (mm of armor a shell can go through)", "Citadel / cit": "the heavily armored core of a ship; hits there deal much more damage",
  Overmatch: "a shell can never bounce off armor thinner than its caliber / 14.3", "Detect / concealment": "distance at which enemies can see the ship (lower is stealthier)",
  Bloom: "detectability increase after firing the main guns (to the guns' max range for 20 s)", Sigma: "how strongly shells cluster toward the center of the aiming ellipse (higher = more accurate)",
  Kiting: "sailing away while firing back with rear guns", "Torp": "torpedo", "Reaction time": "seconds between seeing a torpedo and it arriving (detectability / speed)",
  "Tier": "ship level I-XI; matchmaking is based on it", "Tech tree / TT": "ships researched with XP and bought with credits", "Premium": "ships bought with doubloons or money",
  "Special": "event, reward, coal, steel or research-bureau ships", "Module": "researchable hull, guns, torpedoes, engine, fire control or aircraft", "Stock / top": "first (unresearched) / fully researched modules",
};

export function buildKnowledge({ ctx, rows, abs, md, slug, terms = [], community = "" }) {
  const pages = [];
  const skillNames = new Set();
  const cap = ctx.captains?.["Common.json"]?.Default?.skills ?? {};
  for (const k of Object.keys(cap)) skillNames.add(ctx.L[`SKILL_${k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`]);
  const upgradeNames = new Set(Object.values(ctx.modernizations).map((m) => (ctx.L[`TITLE_${m.name}`.toUpperCase()] ?? "").replace(/\s+/g, " ").trim()));
  const consumableNames = new Set(Object.keys(ctx.L).filter((k) => k.startsWith("DOCK_CONSUME_TITLE_")).map((k) => ctx.L[k].replace(/\s+/g, " ").trim()));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  const dropped = [];
  const section = (title, map, known, link) => {
    const lines = [];
    for (const [abbr, full] of Object.entries(map)) {
      if (!full) continue;
      if (known && !known(full)) { dropped.push(`${abbr} -> ${full}`); continue; }
      lines.push(`- ${abbr}: ${full}${SKILL_NOTES[abbr] ? ` (${SKILL_NOTES[abbr]})` : ""}${link ? ` - ${link(full)}` : ""}`);
    }
    return `## ${title}\n\n${lines.join("\n")}`;
  };
  const shipLink = (n) => abs(`ship/${slug(n)}.md`);
  // Link nickname definitions to ship pages ("Nickname for Tier X USN cruiser Des Moines" -> link)
  const names = [...byName.keys()].filter((n) => n.length > 3).sort((a, b) => b.length - a.length);
  const termLine = (t) => {
    let link = "";
    if (/nickname/i.test(t.definition)) {
      const low = t.definition.toLowerCase();
      const hit = names.find((n) => new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(low));
      if (hit) link = ` - ${shipLink(byName.get(hit).name)}`;
    }
    return `- ${t.term}: ${t.definition}${link}`;
  };
  pages.push(["glossary.md", md("Glossary: player abbreviations and nicknames", "What players mean, mapped to the exact in-game names used on this site. Every entry is checked against the game data on each build.",
    [
      section("Ship classes", CLASSES),
      section("Captain skills", SKILLS, (n) => skillNames.has(n), () => abs("api/captain-skills.json")),
      section("Upgrades (modernizations)", UPGRADES, (n) => upgradeNames.has(n), () => abs("api/upgrades.json")),
      section("Consumables", CONSUMABLES, (n) => consumableNames.has(n)),
      section("Ship nicknames", NICKNAMES, (n) => byName.has(n.toLowerCase()), shipLink),
      `## Terms\n\n${Object.entries(TERMS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
      terms.length ? `## Community terms and nicknames (official wiki, Ship:Terminology)\n\nSource: https://wiki.worldofwarships.com/Ship:Terminology. Ship nicknames link to the ship's page on this site.\n\n${terms.map(termLine).join("\n")}` : "",
    ].join("\n\n"))]);
  if (community) pages.push(["community.md", community]);

  pages.push(["mechanics.md", md("Game mechanics used in this data", "Short, exact rules behind the numbers. Formulas are the ones used to calculate this site's data (ported from WoWs ShipBuilder) or come from the official wiki (wiki.worldofwarships.com).", `
## Damage
- Damage per minute (DPM) = shell damage x number of barrels x (60 / reload in s). Theoretical: every shell hits for full damage. Real damage depends on penetration, armor and hit location.
- Fire chance per salvo = 1 - (1 - fire chance per shell)^(number of barrels).
- Potential fires per minute = fire chance per shell x barrels x shots per minute.
- HE and SAP shells have a fixed penetration (penetration_mm). AP penetration falls with distance; see ballistics_by_range in each ship's details page (penetration, impact speed, flight time and impact angle every 1 km).
- AP penetration values are raw penetration against a plate hit straight on. At long range shells fall at a steeper angle (impact_angle_deg), so the effective thickness of a vertical belt is larger and a shell can fail to penetrate a belt thinner than its raw penetration, while decks become easier to hit. Do not say a shell penetrates a belt just because raw penetration is higher.
- Overmatch: a shell can never ricochet off armor thinner than its caliber / 14.3 (overmatch_mm).
- AP shells ricochet sometimes from ricochet_start_angle_deg and always from ricochet_always_angle_deg; they only arm (fuse) on armor at least arming_threshold_mm thick.

## Detection (official wiki, Ship:Detection)
- detectability_by_ships_km / detectability_by_planes_km: the distance at which enemies see the ship. Lower is stealthier.
- Firing the main guns outside smoke raises sea detectability to the guns' current max range for 20 s. Firing torpedoes or secondaries does not.
- Firing from smoke: detectability_when_firing_from_smoke_km. While on fire: +2 km by sea, +3 km by air.
- Torpedo reaction time = torpedo detectability / torpedo speed (with the game's speed scale of 2.6854 m/s per knot). For submarine homing torpedoes this uses the normal torpedo detectability; homing behaviour is under torpedoes.torpedoes.*.homing.

## Accuracy
- Dispersion: size of the area shells land in at a range (horizontal and vertical, metres). dispersion_at_max_range_* is at max range; details pages list it every 1 km.
- Sigma: how strongly shells cluster toward the center. Higher = more shells near the aim point.

## Survivability
- Torpedo protection damage reduction: % less damage from torpedo hits. Fire and flooding deal damage per second for their duration.
- Each hit location (citadel, bow, stern, casemate, superstructure, hull) has its own HP pool; repairable_damage_pct is how much Repair Party can heal back.

## Upgrades, skills, signals
- One upgrade per slot. A captain has 21 skill points; a skill costs its row number (1-4) in points.
- Effects stack by multiplying: reload 30 s with -12% and -5% = 30 x 0.88 x 0.95 = 25.08 s. Each ship page lists every upgrade/skill/flag with its exact effect alone.

## Values on this site
- Base values: no skills, upgrades, signals or camouflage unless stated.
- "top" = fully researched modules; "stock" = unresearched.
`)]);

  // Tech tree lines from the game's research links
  const sum = Object.fromEntries(ctx.summary.map((s) => [s.index, s]));
  const rowBy = Object.fromEntries(rows.map((r) => [r.index, r]));
  const lines = {};
  for (const r of rows.filter((x) => x.category === "tech_tree")) {
    const s = sum[r.index];
    if (s?.prevShipIndex && rowBy[s.prevShipIndex]) continue; // not a root
    const walk = (i, path) => {
      const kids = (sum[i]?.nextShipIndexes ?? []).filter((k) => rowBy[k]);
      if (!kids.length) { (lines[r.nation] ??= []).push(path); return; }
      for (const k of kids) walk(k, [...path, k]);
    };
    walk(r.index, [r.index]);
  }
  const tt = [];
  for (const n of Object.keys(lines).sort()) {
    // Show each line as its own class only, plus the ship it is unlocked from (research can cross classes).
    const seen = new Set();
    const body = lines[n].map((p) => {
      const cls = rowBy[p.at(-1)].class;
      let start = p.length - 1;
      while (start > 0 && rowBy[p[start - 1]].class === cls) start--;
      const own = p.slice(start), from = start > 0 ? rowBy[p[start - 1]] : null;
      return { cls, text: `${own.map((i) => `${rowBy[i].name} (${rowBy[i].tier})`).join(" -> ")}${from ? `; unlocked from ${from.name} (${from.class}, tier ${from.tier})` : ""}` };
    }).filter((l) => !seen.has(l.text) && seen.add(l.text)).sort((a, b) => a.cls.localeCompare(b.cls)).map((l) => `- ${l.cls}: ${l.text}`).join("\n");
    pages.push([`tech-tree/${n}.md`, md(`Tech tree: ${n}`, `Research paths from the game files: each line runs from the first ship to a top ship. Numbers are tiers. Ship pages: ${abs("ship/{name}.md")} (research XP and price are on each page).`, body)]);
    tt.push(`- [${n}](${abs(`tech-tree/${n}.md`)}): ${lines[n].length} lines`);
  }
  pages.push(["tech-tree/index.md", md("Tech trees", "Research lines per nation.", tt.join("\n"))]);
  return { pages, dropped };
}

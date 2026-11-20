// Data files for the interactive tools (ship build tool, optimizer, penetration checker, firing simulation).
// The browser runs the same calculation code as the site generator (lib/ship.mjs etc.), so it needs the raw game data
// of one ship plus exactly the projectiles, aircraft, consumables and text it uses. Which ones are used is found by
// running the calculation for every module combination while recording what it reads.
import { computeConfiguration, allConfigurations } from "./ship.mjs";
import { eligibleModernizations, signalFlags, upgradeName, clean } from "./analysis.mjs";
import { captainTalents } from "./builder.mjs";

function recordingCtx(ctx) {
  const used = { projectiles: new Set(), aircraft: new Set(), abilities: new Set(), L: new Set() };
  const wrap = (obj, set) => new Proxy(obj, { get(t, k) { if (typeof k === "string" && k in t) set.add(k); return t[k]; } });
  const L = wrap(ctx.L, used.L);
  const rc = { ...ctx, projectiles: wrap(ctx.projectiles, used.projectiles), aircraft: wrap(ctx.aircraft, used.aircraft), abilities: wrap(ctx.abilities, used.abilities), L, name: (k) => (k ? L[String(k).toUpperCase()] ?? null : null) };
  return { rc, used };
}
const pick = (obj, keys) => Object.fromEntries([...keys].sort().map((k) => [k, obj[k]]));

export function shipToolData(ctx, ship, { name, gameVersion }) {
  const { rc, used } = recordingCtx(ctx);
  const slots = eligibleModernizations(ctx, ship);
  const allUpgradeMods = slots.flatMap((s) => s.options.flatMap((o) => o.modifiers));
  for (const c of allConfigurations(ship)) {
    computeConfiguration(rc, ship, c.cfg, [], { tables: c.top, accel: false });
    if (c.top) computeConfiguration(rc, ship, c.cfg, allUpgradeMods, { tables: false, accel: false });
  }
  return {
    about: "Input data for this site's interactive tools: raw game data of one ship (from WoWs ShipBuilder's public data) and what its calculations need.",
    game_version: gameVersion, index: ship.index, name, tier: ship.tier, ship_class: ship.shipClass, nation: ship.shipNation,
    ship,
    projectiles: pick(ctx.projectiles, used.projectiles), aircraft: pick(ctx.aircraft, used.aircraft), abilities: pick(ctx.abilities, used.abilities), L: pick(ctx.L, used.L),
    upgrades: slots.map((s) => ({ slot: s.slot, options: s.options.map((o) => ({ index: o.index, name: upgradeName(ctx.L, o), type: o.type ?? null, modifiers: o.modifiers })) })),
  };
}

export function commonToolData(ctx) {
  const L = Object.fromEntries(Object.entries(ctx.L).filter(([k]) => k.startsWith("SKILL_")));
  const def = ctx.captains?.["Common.json"]?.Default;
  return {
    about: "Shared input data for the interactive tools: signal flags, consumable names, captain skill names and the standard commander.",
    game_version: ctx.gameVersion,
    signals: signalFlags(ctx).map((f) => ({ index: f.index, name: f.name, description: f.description, mods: f.mods })),
    consumable_titles: ctx.consumableTitles,
    L,
    default_captain: def ? { index: def.index, name: "Standard commander", skills: def.skills, talents: [] } : null,
  };
}

// One file per nation with its unique commanders (their skills can differ from the standard commander's).
export function captainToolData(ctx) {
  const byNation = {};
  const def = ctx.captains?.["Common.json"]?.Default?.skills ?? {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [file, list] of Object.entries(ctx.captains ?? {})) {
    if (file === "Common.json") continue;
    for (const c of Object.values(list)) {
      // only the skills that differ from the standard commander's (the browser merges them)
      const skills_override = Object.fromEntries(Object.entries(c.skills ?? {}).filter(([k, v]) => !same(v, def[k])));
      const missing = Object.keys(def).filter((k) => !(k in (c.skills ?? {})));
      (byNation[c.nation] ??= []).push({ index: c.index, name: clean(ctx.L[String(c.name).toUpperCase()]) ?? c.name, skills_override, skills_missing: missing.length ? missing : undefined, talents: captainTalents(c, ctx.L) });
    }
  }
  for (const v of Object.values(byNation)) {
    v.sort((a, b) => a.name.localeCompare(b.name) || a.index.localeCompare(b.index));
    const n = {}; for (const c of v) n[c.name] = (n[c.name] ?? 0) + 1;
    for (const c of v) if (n[c.name] > 1) c.name = `${c.name} (${c.index})`;
  }
  return byNation;
}

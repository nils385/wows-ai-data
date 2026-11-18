// What changes when a ship gets upgrades (modernizations), captain skills or signal flags.
// Eligibility and modifier filtering follow WoWs ShipBuilder (UpgradePanelViewModelBase,
// CaptainSkillSelectorViewModel, SignalSelectorViewModel).
import { computeConfiguration, describeModifier, slug } from "./ship.mjs";
import { flatten, diff, metricInfo } from "./metrics.mjs";

const SPECIAL_SKILLS = new Set([23, 82, 81, 44]); // Adrenaline Rush (x2), Furious, Improved Repair Party Readiness: effect depends on battle state.
// Manual Secondary Battery Aiming (26) applies its normal modifiers; only its priority-target bonus is conditional.
const INTERCEPTOR = 22;
const FIRE_PREVENTION = 14;

const affectsAcceleration = (mods) => mods.some((m) => (m.affectedProperties ?? []).some((p) => p.startsWith("ManeuverabilityDataContainer.")));
const effects = (L, mods) => mods.map((m) => describeModifier(L, m)).filter(Boolean).map(({ applies_to, ...e }) => e);

export function eligibleModernizations(ctx, ship) {
  const all = Object.values(ctx.modernizations);
  const base = all
    .filter((m) => !(m.blacklistedShips ?? []).includes(ship.name))
    .filter((m) => (m.shipLevel ?? []).includes(ship.tier))
    .filter((m) => ship.shipNation === "Common" || (m.allowedNations ?? []).includes(ship.shipNation))
    .filter((m) => (m.shipClasses ?? []).includes(ship.shipClass));
  const extra = all.filter((m) => (m.additionalShips ?? []).includes(ship.name));
  const list = [...new Set([...base, ...extra])].map((m) => ({ ...m, modifiers: (m.modifiers ?? []).filter((x) => !x.name.includes("_") || x.name.includes("_" + ship.shipClass)) }));
  const slots = {};
  for (const m of list) (slots[m.slot] ??= []).push(m);
  for (const k of Object.keys(slots)) slots[k].sort((a, b) => String(a.type).localeCompare(String(b.type)) || a.index.localeCompare(b.index));
  return Object.entries(slots).sort(([a], [b]) => a - b).map(([slot, options]) => ({ slot: Number(slot), options }));
}

export function skillsFor(ctx, ship) {
  const captain = ctx.captains?.["Common.json"]?.Default;
  if (!captain) return [];
  return Object.entries(captain.skills).filter(([, s]) => (s.learnableOn ?? []).includes(ship.shipClass)).map(([key, s]) => {
    const tier = s.tiers.find((t) => t.shipClass === ship.shipClass);
    let mods = (s.modifiers ?? []).filter((x) => !x.name.includes("_") || x.name.includes("_" + ship.shipClass) || x.name.includes("invisible_"));
    if (s.skillNumber === FIRE_PREVENTION) mods = [...mods, { name: "fireResistanceEnabled", value: -1, affectedProperties: ["SurvivabilityDataContainer.FireResistance"], valueProcessingKind: "RawAdd", displayValueProcessingKind: "Raw", unit: "None" }];
    if (s.skillNumber === INTERCEPTOR) mods = [...mods, { name: "interceptorSelected", value: 0, affectedProperties: ["ConsumableDataContainer.Interceptor"], valueProcessingKind: "Multiplier", displayValueProcessingKind: "Discard", unit: "None" }];
    const special = SPECIAL_SKILLS.has(s.skillNumber);
    return {
      key, number: s.skillNumber, special, epic: !!s.isEpic,
      name: ctx.L[`SKILL_${snake(key)}`] ?? key, description: clean(ctx.L[`SKILL_DESC_${snake(key)}`]),
      point_cost: tier ? tier.tier + 1 : null, row: tier ? tier.tier + 1 : null, column: tier ? tier.xPosition + 1 : null,
      mods: special ? [] : mods, all_mods: s.modifiers ?? [],
      conditional: (s.conditionalModifierGroups ?? []).map((g) => ({
        trigger: clean(ctx.L[g.triggerDescription?.toUpperCase()] ?? ctx.L[`SKILL_TRIGGER_${g.triggerType}`.toUpperCase()]) ?? g.triggerType ?? null,
        max_activations: g.activationLimit ?? null, effects: effects(ctx.L, g.modifiers ?? []),
      })),
    };
  });
}

export function signalFlags(ctx) {
  return Object.values(ctx.exteriors).filter((e) => e.type === "Flags" && (e.group ?? 0) === 0).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((e) => ({
    index: e.index, name: ctx.L[e.name?.toUpperCase()] ?? e.name, description: clean(ctx.L[`${e.name}_DESCRIPTION`.toUpperCase()]), mods: e.modifiers ?? [],
  }));
}

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toUpperCase();
export const clean = (s) => (s ? s.replace(/\s+/g, " ").trim() || null : null);
export const upgradeName = (L, m) => clean(L[`TITLE_${m.name}`.toUpperCase()]) ?? m.name;

// Effect of one set of modifiers on a configuration: before -> after for every metric that changes.
export function changesWith(ctx, ship, cfg, baseFlat, mods) {
  if (!mods.length) return [];
  const after = flatten(computeConfiguration(ctx, ship, cfg, mods, { tables: false, accel: affectsAcceleration(mods) }));
  const before = affectsAcceleration(mods) ? baseFlat : withoutAccel(baseFlat);
  // Only compare metrics computed in both: wiki armor and derived stats are added later to the base and are not
  // recomputed here, so they must not show up as "-> null".
  return diff(before, affectsAcceleration(mods) ? after : withoutAccel(after)).filter((c) => c.after !== null || c.metric in after);
}
const withoutAccel = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.includes("time_to_full_speed")));

// For every metric any upgrade can change: the best value reachable with one upgrade per slot, and which upgrades give it.
// Upgrades in different slots stack; within a slot only one can be fitted, so the best per slot is chosen for each metric.
export function bestWithUpgrades(ctx, ship, cfg, baseFlat, slots, perOption) {
  const metrics = new Set();
  for (const o of perOption) for (const c of o.changes) if (c.better !== null) metrics.add(c.metric);
  const out = {};
  for (const metric of metrics) {
    const { direction } = metricInfo(metric);
    const chosen = [];
    for (const slot of slots) {
      let best = null;
      for (const opt of slot.options) {
        const c = perOption.find((p) => p.index === opt.index)?.changes.find((x) => x.metric === metric);
        if (!c || !c.better) continue;
        if (!best || (direction === "higher_is_better" ? c.after > best.after : c.after < best.after)) best = { opt, after: c.after };
      }
      if (best) chosen.push(best.opt);
    }
    if (!chosen.length) continue;
    const mods = chosen.flatMap((o) => o.modifiers);
    const value = chosen.length === 1
      ? perOption.find((p) => p.index === chosen[0].index).changes.find((x) => x.metric === metric).after
      : flatten(computeConfiguration(ctx, ship, cfg, mods, { tables: false, accel: affectsAcceleration(mods) }))[metric];
    out[metric] = { base: baseFlat[metric] ?? null, best: value ?? null, direction, upgrades: chosen.map((o) => ({ slot: o.slot, index: o.index, name: upgradeName(ctx.L, o) })) };
  }
  return out;
}

export function describeEffects(L, mods) {
  return effects(L, mods);
}
export { affectsAcceleration };

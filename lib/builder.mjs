// Ship build logic shared by the site generator (Node) and the build tool in the browser.
// Port of WoWs ShipBuilder (MIT): CaptainSkillSelectorViewModel, SkillItemViewModel, SkillActivationItemViewModel,
// SignalSelectorViewModel, UpgradePanelViewModelBase and ConsumableViewModel. Modifier order follows ShipViewModel:
// upgrades, signals, captain, consumables.
// No Node APIs here: this file is also served to browsers.

export const SKILL = { AR: 23, AR_SUB: 82, FURIOUS: 81, IRPR: 44, MSBA: 26, FIRE_PREVENTION: 14, INTERCEPTOR: 22 };
export const MAX_SKILL_POINTS = 21;
const SPECIAL = new Set([SKILL.AR, SKILL.AR_SUB, SKILL.FURIOUS, SKILL.IRPR, SKILL.MSBA]);
const THRESHOLD_KEYS = ["requiredCount", "damageIncrement", "thresholdPerMaxHealth"];

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toUpperCase();
const clean = (s) => (s ? String(s).replace(/\s+/g, " ").trim() || null : null);
const copyMod = (m, value, name = m.name) => ({ ...m, name, value });

export const skillTier = (skill, cls) => skill.tiers.find((t) => t.shipClass === cls)?.tier ?? null;

// Skills a captain can learn on a ship class, in grid order.
export function captainSkills(captain, cls, L = {}) {
  return Object.entries(captain?.skills ?? {})
    .filter(([, s]) => (s.learnableOn ?? []).includes(cls))
    .map(([key, s]) => {
      const pos = s.tiers.find((t) => t.shipClass === cls);
      return {
        key, number: s.skillNumber, tier: pos.tier, column: pos.xPosition, cost: pos.tier + 1, epic: !!s.isEpic,
        name: L[`SKILL_${snake(key)}`] ?? key, description: clean(L[`SKILL_DESC_${snake(key)}`]),
        raw: s,
        // what the skill list shows (SkillItemViewModel)
        shown_modifiers: (s.modifiers ?? []).filter((x) => !x.name.includes("_") || x.name.startsWith("repeatable_") || x.name.includes("_" + cls)),
        conditional_groups: s.conditionalModifierGroups ?? [],
      };
    })
    .sort((a, b) => a.tier - b.tier || a.column - b.column);
}

// SkillItemViewModel.CanAddSkill / CanRemoveSkill. `chosen` = selected skill objects from captainSkills().
export function canAddSkill(chosen, skill) {
  const points = chosen.reduce((n, s) => n + s.cost, 0);
  if (points + skill.cost > MAX_SKILL_POINTS) return false;
  if (skill.tier === 0) return true;
  return chosen.some((s) => s.tier === skill.tier - 1);
}
export function canRemoveSkill(chosen, skill) {
  if (skill.tier === 3) return true;
  const higher = chosen.filter((s) => s.tier > skill.tier).length;
  const same = chosen.filter((s) => s.tier === skill.tier).length;
  return higher > 0 ? same > 1 : true;
}

// Conditional effects a set of chosen skills offers (CreateItemViewModelForSkill). Each item: { id, skill, number, modifiers, max_activations }.
// max_activations > 1 means a count can be chosen (Furious fires, Improved Repair Party Readiness uses).
export function conditionalItems(chosen) {
  const out = [];
  for (const s of chosen) {
    const groups = s.raw.conditionalModifierGroups ?? [];
    if (!groups.length) continue;
    if (s.number === SKILL.FURIOUS) out.push({ id: `${s.key}#0`, skill: s.key, number: s.number, name: s.name, modifiers: groups[0].modifiers ?? [], max_activations: norm(groups[0].activationLimit) });
    else if (s.number === SKILL.IRPR) groups.slice(0, 2).forEach((g, i) => out.push({ id: `${s.key}#${i}`, skill: s.key, number: s.number, name: s.name, modifiers: g.modifiers ?? [], max_activations: norm(g.activationLimit) }));
    else groups.forEach((g, i) => out.push({ id: `${s.key}#${i}`, skill: s.key, number: s.number, name: s.name, modifiers: g.modifiers ?? [], max_activations: 0 }));
  }
  return out;
}
const norm = (n) => (n === -1 ? 99 : n ?? 0);

// Unique commander talents usable in random battles (operations copies skipped), with their tiers.
export function captainTalents(captain, L = {}) {
  const out = [];
  for (const [key, t] of Object.entries(captain?.uniqueSkills ?? {})) {
    if (t.battleGroup === "Operations") continue;
    const modifiers = Object.values(t.skillEffects ?? {}).flatMap((e) => e.modifiers ?? []).filter((m) => m.name !== "workTime");
    const tiered = Object.values(t.skillEffects ?? {}).filter((e) => e.levels?.length);
    const constant = Object.values(t.skillEffects ?? {}).filter((e) => !e.levels?.length).flatMap((e) => e.modifiers ?? []);
    const ladder = [...new Set(tiered.flatMap((e) => e.levels.map((l) => l.level)))].sort((a, b) => a - b);
    const tiers = ladder.map((tier) => {
      const reached = tiered.map((e) => e.levels.filter((l) => l.level <= tier).sort((a, b) => b.level - a.level)[0] ?? [...e.levels].sort((a, b) => a.level - b.level)[0]).filter(Boolean);
      const lvl = t.trigger?.levels?.find((l) => l.level === tier);
      let threshold = null, threshold_key = null;
      if (lvl) {
        for (const k of THRESHOLD_KEYS) if (lvl.thresholds?.[k]) { threshold = lvl.thresholds[k]; threshold_key = k; break; }
        if (threshold === null) { const r = Object.entries(lvl.thresholds ?? {}).filter(([, v]) => v).sort(([a], [b]) => (a < b ? -1 : 1))[0]; if (r) [threshold_key, threshold] = r; }
      }
      return { level: tier, modifiers: [...reached.flatMap((l) => l.cumulativeModifiers ?? []), ...constant].filter((m) => m.name !== "workTime"), threshold, threshold_key };
    });
    const group = String(t.battleGroup ?? "Regular").toUpperCase();
    out.push({
      id: key, name: L[t.translationId?.toUpperCase()] ?? t.translationId ?? key,
      description: clean(L[`${t.translationId}_DESCRIPTION_BATTLE_GROUP_${group}`.toUpperCase()] ?? L[`${t.translationId}_DESCRIPTION_BATTLE_GROUP_REGULAR`.toUpperCase()]),
      modifiers, tiers, max_activations: Math.max(t.maxTriggerNum ?? 0, tiers.length),
    });
  }
  return out;
}

// Consumable modifiers when a consumable is switched on (ConsumableViewModel.GetModifiers).
export function consumableActiveModifiers(ability, consumableName) {
  const mods = ability?.modifiers ?? [];
  if (consumableName.includes("PCY015")) return mods.map((m) => ({ ...m, name: "speedBoost_" + m.name, affectedProperties: (m.affectedProperties ?? []).map((p) => p + ".SpeedBoost") }));
  if (consumableName.includes("PCY010")) return mods.map((m) => ({ ...m, name: "heal_" + m.name, affectedProperties: (m.affectedProperties ?? []).map((p) => p + ".Heal") }));
  return mods;
}

// All modifiers of a build, in ShipBuilder's order.
// build = { upgrades: [modernization with class-filtered .modifiers], signals: [flag with .mods], skills: [captainSkills() items],
//           cls, conditional: { [itemId]: { on, count } }, arHpPct (0-100, HP left), talents: [captainTalents() items], talentState: { [id]: { on, count } },
//           consumables: [{ ability, name }] }
export function buildModifiers(build) {
  const mods = [];
  for (const u of build.upgrades ?? []) mods.push(...(u.modifiers ?? []));
  for (const f of build.signals ?? []) mods.push(...(f.mods ?? f.modifiers ?? []));
  mods.push(...captainModifiers(build));
  for (const c of build.consumables ?? []) mods.push(...consumableActiveModifiers(c.ability, c.name));
  return mods;
}

export function captainModifiers({ skills = [], cls, conditional = {}, arHpPct = 100, talents = [], talentState = {} }) {
  const out = [];
  out.push(...skills.filter((s) => (s.raw.modifiers ?? []).length && !SPECIAL.has(s.number)).flatMap((s) => s.raw.modifiers)
    .filter((x) => !x.name.includes("_") || x.name.includes("_" + cls) || x.name.includes("invisible_")));
  if (skills.some((s) => s.number === SKILL.FIRE_PREVENTION)) out.push({ name: "fireResistanceEnabled", value: -1, affectedProperties: ["SurvivabilityDataContainer.FireResistance"], valueProcessingKind: "RawAdd", displayValueProcessingKind: "Raw", unit: "None" });
  if (skills.some((s) => s.number === SKILL.INTERCEPTOR)) out.push({ name: "interceptorSelected", value: 0, affectedProperties: ["ConsumableDataContainer.Interceptor"], valueProcessingKind: "Multiplier", displayValueProcessingKind: "Raw", unit: "None" });

  const items = conditionalItems(skills);
  const st = (it) => conditional[it.id] ?? { on: false, count: 1 };
  if (items.length) {
    out.push(...items.filter((it) => st(it).on && it.number !== SKILL.FURIOUS && it.max_activations <= 1 && it.number !== SKILL.MSBA).flatMap((it) => it.modifiers));
    const fur = items.find((it) => it.number === SKILL.FURIOUS);
    if (fur && st(fur).on) {
      const first = fur.modifiers.find((x) => x.name === "repeatable_first_GMShotDelay");
      let mult = first.value;
      const n = st(fur).count ?? 1;
      if (n > 1) mult *= Math.pow(fur.modifiers.find((x) => x.name === "repeatable_other_GMShotDelay").value, n - 1);
      out.push(copyMod(first, mult, "repeatableTotalGMShotDelay"));
    }
    for (const it of items.filter((x) => x.number === SKILL.IRPR && st(x).on && x.max_activations !== 1)) {
      const m = it.modifiers.find((x) => x.name === "regenCrewReloadCoeff");
      if (m) out.push(copyMod(m, Math.pow(m.value, st(it).count ?? 1)));
    }
    const msba = skills.find((s) => s.number === SKILL.MSBA), msbaItem = items.find((it) => it.number === SKILL.MSBA);
    if (msba && msbaItem) {
      out.push(...(msba.raw.modifiers ?? []).filter((x) => x.name !== "GSIdealRadius" && x.name !== "GSPriorityTargetIdealRadius"));
      const pick = st(msbaItem).on ? msbaItem.modifiers.find((x) => x.name === "GSPriorityTargetIdealRadius") : (msba.raw.modifiers ?? []).find((x) => x.name === "GSIdealRadius");
      if (pick) out.push(pick);
    }
  }
  const ar = skills.find((s) => s.number === SKILL.AR || s.number === SKILL.AR_SUB);
  if (ar) {
    const m = (ar.raw.modifiers ?? []).find((x) => x.name === "lastChanceReloadCoefficient");
    if (m) out.push(copyMod(m, m.value * (100 - arHpPct)));
  }
  for (const t of talents) {
    const s = talentState[t.id];
    if (!s?.on) continue;
    const n = s.count ?? 1;
    if (t.tiers.length) out.push(...t.tiers[Math.min(Math.max(n, 1), t.tiers.length) - 1].modifiers);
    else if (t.modifiers.some((m) => m.name === "burnProbabilityBonus")) out.push(...t.modifiers.map((m) => copyMod(m, Math.round(m.value * n * 100) / 100)));
    else if (t.max_activations <= 1) out.push(...t.modifiers);
    else out.push(...t.modifiers.map((m) => copyMod(m, Math.pow(m.value, n))));
  }
  return out;
}

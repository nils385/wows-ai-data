#!/usr/bin/env node
// Compares this project's calculations with WoWs ShipBuilder's own C# code, value by value.
// Input: a JSONL file written by the reference harness (ShipBuilder's DataContainers run on the same game data),
// one line per ship + module combination (+ optional single upgrade).
// Usage: node tools/shipbuilder_parity.mjs DATA_DIR REFERENCE.jsonl OUT_REPORT.json
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import readline from "node:readline";
import { loadGameData } from "../lib/data.mjs";
import { computeConfiguration, upgradeGroups, setConsumableTitles } from "../lib/ship.mjs";
import { eligibleModernizations } from "../lib/analysis.mjs";

const [dataDir, refFile, outFile] = process.argv.slice(2);
const ctx = await loadGameData({ dataDir });
setConsumableTitles(ctx.consumableTitles);

// Deliberate differences (documented on the site), compared with a wider tolerance or skipped:
// - penetration: this site keeps 1 decimal, ShipBuilder truncates      -> compare truncated values
// - 180-degree turn times, torpedo range: 2 decimals here, 1 in ShipBuilder -> tolerance 0.05
const num = (v) => (typeof v === "string" ? Number(v.replace(/'/g, "")) : v);
const stats = {}; // field -> {ok, bad, examples}
const record = (field, theirs, mine, tol = 1e-6, ctxInfo) => {
  if (theirs === undefined || theirs === null) return;
  const s = (stats[field] ??= { compared: 0, different: 0, examples: [] });
  s.compared++;
  const a = num(theirs), b = typeof mine === "number" ? mine : num(mine);
  const same = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tol + 1e-9 : String(a) === String(b);
  if (!same) { s.different++; if (s.examples.length < 5) s.examples.push({ ...ctxInfo, shipbuilder: theirs, this_site: mine ?? null }); }
};
const trunc = (v) => (typeof v === "number" ? Math.trunc(v) : v);

const modsCache = {};
function upgradeMods(ship, name) {
  modsCache[ship.index] ??= Object.fromEntries(eligibleModernizations(ctx, ship).flatMap((s) => s.options).map((o) => [o.name, o.modifiers]));
  return modsCache[ship.index][name] ?? null;
}

let lines = 0, skipped = 0;
const rl = readline.createInterface({ input: createReadStream(refFile), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const ref = JSON.parse(line);
  if (!ref.data) { skipped++; continue; }
  const ship = ctx.ships[ref.ship];
  const groups = upgradeGroups(ship);
  const cfg = {};
  for (const [t, list] of Object.entries(groups)) cfg[t] = list.find((u) => ref.modules.includes(u.name)) ?? list[list.length - 1];
  let mods = [];
  if (ref.upgrade) { mods = upgradeMods(ship, ref.upgrade); if (!mods) { skipped++; continue; } }
  lines++;
  const me = computeConfiguration(ctx, ship, cfg, mods, { tables: false, accel: true });
  const where = { ship: ref.ship, upgrade: ref.upgrade ?? undefined };
  const d = ref.data;

  const sv = d.SurvivabilityDataContainer, s = me.survivability;
  if (sv) {
    record("survivability.hit_points", sv.HitPoints, s.hit_points, 0, where);
    record("survivability.fire.duration_s", sv.FireDuration, s.fire.duration_s, 0, where);
    record("survivability.fire.max_simultaneous_fires", sv.FireAmount, s.fire.max_simultaneous_fires, 0, where);
    record("survivability.fire.fire_chance_reduction_pct", sv.FireReduction, s.fire.fire_chance_reduction_pct, 0, where);
    record("survivability.fire.damage_per_s", sv.FireDPS, s.fire.damage_per_s, 0, where);
    record("survivability.fire.total_damage_per_fire", sv.FireTotalDamage, s.fire.total_damage_per_fire, 0, where);
    record("survivability.flooding.duration_s", sv.FloodDuration, s.flooding.duration_s, 0, where);
    record("survivability.flooding.torpedo_protection_damage_reduction_pct", sv.FloodTorpedoProtection, s.flooding.torpedo_protection_damage_reduction_pct, 0, where);
    record("survivability.flooding.damage_per_s", sv.FloodDPS, s.flooding.damage_per_s, 0, where);
    record("survivability.flooding.total_damage_per_flood", sv.FloodTotalDamage, s.flooding.total_damage_per_flood, 0, where);
    for (const [k, loc] of [["CitadelHp", "citadel"], ["BowHp", "bow"], ["SternHp", "stern"], ["CasemateHp", "casemate"], ["SuperstructureHp", "superstructure"], ["HullHp", "hull"], ["AuxiliaryRoomsHp", "auxiliaryrooms"]])
      if (sv[k]) record(`survivability.hit_location_hp.${loc}.hp`, sv[k], s.hit_location_hp?.[loc]?.hp, 0, where);
    if (sv.DiveCapacity) record("survivability.dive_capacity", sv.DiveCapacity, s.dive_capacity, 0, where);
  }
  const mv = d.ManeuverabilityDataContainer, m = me.maneuverability;
  if (mv) {
    if (mv.ManeuverabilityMaxSpeed) record("maneuverability.max_speed_knots", mv.ManeuverabilityMaxSpeed, m.max_speed_knots, 0, where);
    if (mv.ManeuverabilityMaxReverseSpeed) record("maneuverability.max_reverse_speed_knots", mv.ManeuverabilityMaxReverseSpeed, m.max_reverse_speed_knots, 0, where);
    if (mv.ManeuverabilitySubsMaxSpeedOnSurface) record("maneuverability.max_speed_surface_knots", mv.ManeuverabilitySubsMaxSpeedOnSurface, m.max_speed_surface_knots, 0, where);
    if (mv.ManeuverabilitySubsMaxSpeedAtPeriscope) record("maneuverability.max_speed_periscope_depth_knots", mv.ManeuverabilitySubsMaxSpeedAtPeriscope, m.max_speed_periscope_depth_knots, 0, where);
    if (mv.ManeuverabilitySubsMaxDiveSpeed) record("maneuverability.dive_speed_m_per_s", mv.ManeuverabilitySubsMaxDiveSpeed, m.dive_speed_m_per_s, 0, where);
    record("maneuverability.rudder_shift_time_s", mv.ManeuverabilityRudderShiftTime, m.rudder_shift_time_s, 0, where);
    record("maneuverability.turning_circle_radius_m", mv.ManeuverabilityTurningCircle, m.turning_circle_radius_m, 0, where);
    record("maneuverability.time_to_full_speed_ahead_s", mv.ForwardMaxSpeedTime, m.time_to_full_speed_ahead_s, 0.011, where);
    record("maneuverability.time_to_full_speed_reverse_s", mv.ReverseMaxSpeedTime, m.time_to_full_speed_reverse_s, 0.011, where);
  }
  const cv = d.ConcealmentDataContainer, c = me.concealment;
  if (cv) {
    record("concealment.detectability_by_ships_km", cv.ConcealmentBySea, c.detectability_by_ships_km, 0, where);
    record("concealment.detectability_by_planes_km", cv.ConcealmentByAir, c.detectability_by_planes_km, 0, where);
    record("concealment.detectability_when_firing_from_smoke_km", cv.ConcealmentBySeaFiringSmoke, c.detectability_when_firing_from_smoke_km, 0, where);
    record("concealment.detectability_by_ships_while_burning_km", cv.ConcealmentBySeaFire, c.detectability_by_ships_while_burning_km, 0, where);
    record("concealment.detectability_by_submarines_at_periscope_depth_km", cv.FromSubsAtPeriscopeDepth, c.detectability_by_submarines_at_periscope_depth_km, 0, where);
  }
  const mb = d.MainBatteryDataContainer, b = me.main_battery;
  if (mb && b) {
    record("main_battery.range_km", mb.Range, b.range_km, 0, where);
    if (!mb.DisplayBurstReload) record("main_battery.reload_s", mb.Reload, b.reload_s, 0, where);
    record("main_battery.turret_180_turn_time_s", mb.TurnTime, b.turret_180_turn_time_s, 0.05, where);
    record("main_battery.turret_traverse_speed_deg_per_s", mb.TraverseSpeed, b.turret_traverse_speed_deg_per_s, 0, where);
    record("main_battery.ammo_switch_time_s", mb.AmmoSwitchTime, b.ammo_switch_time_s, 0, where);
    record("main_battery.total_barrels", mb.BarrelsCount, b.total_barrels, 0, where);
    record("main_battery.sigma", mb.Sigma, b.sigma, 0, where);
    record("main_battery.dispersion_at_max_range_horizontal_m", mb.HorizontalDisp, b.dispersion_at_max_range_horizontal_m, 0.011, where);
    record("main_battery.dispersion_at_max_range_vertical_m", mb.VerticalDisp, b.dispersion_at_max_range_vertical_m, 0.011, where);
    if (mb.DisplayHeDpm) record("main_battery.he_damage_per_minute", mb.TheoreticalHeDpm, b.he_damage_per_minute, 0, where);
    if (mb.DisplayApDpm) record("main_battery.ap_damage_per_minute", mb.TheoreticalApDpm, b.ap_damage_per_minute, 0, where);
    if (mb.DisplaySapDpm) record("main_battery.sap_damage_per_minute", mb.TheoreticalSapDpm, b.sap_damage_per_minute, 0, where);
    if (mb.DisplayHeDpm) record("main_battery.he_potential_fires_per_minute", mb.PotentialFpm, b.he_potential_fires_per_minute, 0, where);
    const mine = Object.values(b.shells ?? {});
    for (const sh of mb.AllShellData ?? []) {
      const t = sh.Type.replace("ArmamentType_", "");
      const x = mine.find((y) => y.id === sh.Name) ?? Object.values(b.burst_fire_mode?.shells ?? {}).find((y) => y.id === sh.Name);
      if (!x) { record(`main_battery.shells.${t}.present`, sh.Name, null, 0, where); continue; }
      record(`main_battery.shells.${t}.damage`, sh.Damage, x.damage, 0, where);
      record(`main_battery.shells.${t}.muzzle_velocity_m_s`, sh.ShellVelocity, x.muzzle_velocity_m_s, 0, where);
      record(`main_battery.shells.${t}.mass_kg`, sh.Mass, x.mass_kg, 0, where);
      if (t !== "AP") record(`main_battery.shells.${t}.penetration_mm (truncated)`, sh.Penetration, trunc(x.penetration_mm), 0, where);
      if (t === "HE") { record("main_battery.shells.HE.fire_chance_pct", sh.ShellFireChance, x.fire_chance_pct, 0, where); record("main_battery.shells.HE.fire_chance_per_salvo_pct", sh.FireChancePerSalvo, x.fire_chance_per_salvo_pct, 0, where); }
      if (t !== "HE") record(`main_battery.shells.${t}.overmatch_mm`, sh.Overmatch, x.overmatch_mm, 0, where);
      if (t === "AP") { record("main_battery.shells.AP.krupp", sh.Krupp, x.krupp, 0, where); record("main_battery.shells.AP.fuse_time_s", sh.FuseTimer, x.fuse_time_s, 0, where); record("main_battery.shells.AP.arming_threshold_mm", sh.ArmingThreshold, x.arming_threshold_mm, 0, where); }
      if (sh.MinRicochetAngle) record(`main_battery.shells.${t}.ricochet_start_angle_deg`, sh.MinRicochetAngle, x.ricochet_start_angle_deg, 0, where);
      record(`main_battery.shells.${t}.splash_damage`, sh.SplashDmg, x.splash_damage, 0, where);
      record(`main_battery.shells.${t}.underwater_splash_radius_m`, sh.SplashRadius, x.underwater_splash_radius_m, 0, where);
    }
  }
  const secs = d.Secondaries ?? [];
  secs.forEach((g, i) => {
    const x = me.secondaries?.gun_groups?.[i];
    record("secondaries.range_km", g.Range, me.secondaries?.range_km, 0, where);
    if (!x) { record("secondaries.group_present", g.Name, null, 0, where); return; }
    record("secondaries.gun_groups.reload_s", g.Reload, x.reload_s, 0, where);
    record("secondaries.gun_groups.shots_per_min_all_barrels", g.RoF, x.shots_per_min_all_barrels, 0, where);
    record("secondaries.gun_groups.damage_per_minute", g.Dpm, x.damage_per_minute, 0, where);
    if (g.PotentialFpm) record("secondaries.gun_groups.potential_fires_per_minute", g.PotentialFpm, x.potential_fires_per_minute, 0, where);
    record("secondaries.gun_groups.caliber_mm", g.GunCaliber, x.caliber_mm, 0, where);
    record("secondaries.gun_groups.total_barrels", g.BarrelsCount, x.total_barrels, 0, where);
  });
  const ta = d.TorpedoArmamentDataContainer, t = me.torpedoes;
  if (ta && t) {
    record("torpedoes.reload_s", ta.Reload, t.reload_s, 0, where);
    record("torpedoes.launcher_180_turn_time_s", ta.TurnTime, t.launcher_180_turn_time_s, 0.05, where);
    record("torpedoes.total_tubes", ta.TorpCount, t.total_tubes, 0, where);
    record("torpedoes.torpedo_switch_time_s", ta.TimeToSwitch, t.torpedo_switch_time_s, 0, where);
    const mine = Object.values(t.torpedoes);
    for (const tp of ta.Torpedoes ?? []) {
      const x = mine.find((y) => y.id === tp.Name);
      if (!x) { record("torpedoes.torpedo_present", tp.Name, null, 0, where); continue; }
      record("torpedoes.torpedoes.damage", tp.Damage, x.damage, 0, where);
      record("torpedoes.torpedoes.range_km", tp.Range, x.range_km, 0.05, where);
      record("torpedoes.torpedoes.speed_knots", tp.Speed, x.speed_knots, 0, where);
      record("torpedoes.torpedoes.detectability_km", tp.Detectability, x.detectability_km, 0, where);
      record("torpedoes.torpedoes.reaction_time_s", tp.ReactionTime, x.reaction_time_s, 0, where);
      record("torpedoes.torpedoes.arming_distance_m", tp.ArmingDistance, x.arming_distance_m, 0, where);
      record("torpedoes.torpedoes.flooding_chance_pct", tp.FloodingChance, x.flooding_chance_pct, 0, where);
    }
  }
  const aa = d.AntiAirDataContainer;
  if (aa && me.anti_air) for (const [k, mk] of [["LongRangeAura", "long_range"], ["MediumRangeAura", "medium_range"], ["ShortRangeAura", "short_range"]]) {
    const a = aa[k], x = me.anti_air[mk];
    if (!a) continue;
    record(`anti_air.${mk}.continuous_damage_per_s`, a.ConstantDamage, x?.continuous_damage_per_s, 0, where);
    record(`anti_air.${mk}.range_km`, a.Range, x?.range_km, 0, where);
    record(`anti_air.${mk}.hit_chance_pct`, a.HitChance, x?.hit_chance_pct, 0, where);
    if (a.FlakDamage) record(`anti_air.${mk}.flak_damage`, a.FlakDamage, x?.flak_damage, 0, where);
  }
  for (const p of d.CvAircraftDataContainer ?? []) {
    const x = Object.values(me.aircraft ?? {}).find((y) => y.id.split("_")[0] === p.Name.split("_")[0] && y.id === p.Name) ?? Object.values(me.aircraft ?? {}).find((y) => y.id === p.Name);
    if (!x) { record("aircraft.present", p.Name, null, 0, where); continue; }
    record("aircraft.plane_hp", p.PlaneHp, x.plane_hp, 0, where);
    record("aircraft.squadron_hp", p.SquadronHp, x.squadron_hp, 0, where);
    record("aircraft.planes_in_squadron", p.NumberInSquad, x.planes_in_squadron, 0, where);
    record("aircraft.planes_on_deck_max", p.MaxNumberOnDeck, x.planes_on_deck_max, 0, where);
    record("aircraft.plane_restoration_time_s", p.RestorationTime, x.plane_restoration_time_s, 0, where);
    record("aircraft.cruising_speed_knots", p.CruisingSpeed, x.cruising_speed_knots, 0, where);
    record("aircraft.max_speed_knots", p.MaxSpeed, x.max_speed_knots, 0, where);
    record("aircraft.time_to_fully_aimed_s", p.TimeToFullyAimed, x.time_to_fully_aimed_s, 0, where);
    record("aircraft.detectability_by_ships_km", p.ConcealmentFromShips, x.detectability_by_ships_km, 0, where);
  }
  for (const [k, kind] of [["AirstrikeDataContainer", "airstrike"], ["AswAirstrikeDataContainer", "anti_submarine_airstrike"]]) {
    const a = d[k], x = me.airstrikes?.find((y) => y.kind === kind);
    if (!a) continue;
    if (!x) { record(`airstrikes.${kind}.present`, a.Name, null, 0, where); continue; }
    record(`airstrikes.${kind}.plane_hp`, a.PlaneHp, x.plane_hp, 0, where);
    record(`airstrikes.${kind}.reload_s`, a.ReloadTime, x.reload_s, 0, where);
    record(`airstrikes.${kind}.charges`, a.NumberOfUses, x.charges, 0, where);
    record(`airstrikes.${kind}.max_distance_km`, a.MaximumDistance, x.max_distance_km, 0, where);
  }
  const dc = d.DepthChargeLauncherDataContainer;
  if (dc) {
    record("depth_charges.reload_s", dc.Reload, me.depth_charges?.reload_s, 0, where);
    record("depth_charges.charges", dc.NumberOfUses, me.depth_charges?.charges, 0, where);
    record("depth_charges.depth_charges_per_attack", dc.BombsPerCharge, me.depth_charges?.depth_charges_per_attack, 0, where);
  }
  const pg = d.PingerGunDataContainer;
  if (pg) {
    record("sonar.range_km", pg.Range, me.sonar?.range_km, 0, where);
    record("sonar.reload_s", pg.Reload, me.sonar?.reload_s, 0, where);
    record("sonar.ping_speed_m_per_s", pg.PingSpeed, me.sonar?.ping_speed_m_per_s, 0, where);
    record("sonar.first_ping_duration_s", pg.FirstPingDuration, me.sonar?.first_ping_duration_s, 0, where);
  }
}

// Known, deliberate differences (this site follows the game where ShipBuilder simplifies):
const EXPLAINED = [
  [/^anti_air\./, "Ships whose hulls carry different gun mounts (e.g. Seattle, Benson): the game pairs each hull with its own mount, and this site uses that mount's AA. ShipBuilder's AA code always takes the first mount listed, so its AA for the other hull belongs to the wrong mount."],
  [/fire_chance_per_salvo/, "Alternative burst-fire HE shells: this site computes their per-salvo chance with the shots of a burst (as fired); ShipBuilder uses one shot unless burst mode is switched on in its UI."],
];
const fields = Object.entries(stats).sort((a, b) => b[1].different - a[1].different);
const total = fields.reduce((n, [, s]) => n + s.compared, 0), diff = fields.reduce((n, [, s]) => n + s.different, 0);
const report = {
  about: "This site's calculations compared with WoWs ShipBuilder's own C# code (compiled and run on the same game data), for every ship, every module combination and every eligible upgrade on its own.",
  cases: lines, skipped, values_compared: total, values_different: diff, match_rate_pct: Math.round((10000 * (total - diff)) / total) / 100,
  fields_with_differences: fields.filter(([, s]) => s.different).map(([f, s]) => ({ field: f, ...s, explanation: EXPLAINED.find(([re]) => re.test(f))?.[1] })),
  fields_all_equal: fields.filter(([, s]) => !s.different).map(([f, s]) => ({ field: f, compared: s.compared })),
};
await writeFile(outFile, JSON.stringify(report, null, 1));
console.log(`cases ${lines} (skipped ${skipped}), values ${total}, different ${diff}, match ${report.match_rate_pct}%`);
for (const f of report.fields_with_differences.slice(0, 25)) console.log(f.different, "/", f.compared, f.field, JSON.stringify(f.examples[0]));

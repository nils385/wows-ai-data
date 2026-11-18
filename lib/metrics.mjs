// Turns a computed ship configuration into a flat map of metric name -> number.
// Every numeric value becomes a metric. Nothing is hand-picked.
import { slug } from "./ship.mjs";

const SKIP = new Set(["ballistics_by_range", "dispersion_by_range", "turrets", "guns", "launchers", "gun_groups", "can_hit_classes", "homing", "damage_by_depth", "modules", "effects_raw"]);

export function flatten(stats) {
  const out = {};
  const walk = (o, prefix) => {
    if (o === null || o === undefined) return;
    if (typeof o === "number") { if (Number.isFinite(o)) out[prefix] = o; return; }
    if (Array.isArray(o)) return;
    if (typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (SKIP.has(k)) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (k === "consumables" && Array.isArray(v)) {
        for (const slot of v) for (const c of slot.options) {
          // two different consumables with the same English name get _2, _3 ... instead of being dropped
          const first = `${p}.${slug(c.name) || slug(c.id)}`;
          let base = first, n = 2;
          while (out[`${base}.reload_s`] !== undefined) base = `${first}_${n++}`;
          walk({ charges: c.charges === "unlimited" ? undefined : c.charges, reload_s: c.reload_s, duration_s: c.duration_s, preparation_time_s: c.preparation_time_s, time_based_active_time_s: c.time_based_active_time_s }, base);
          for (const [ek, ev] of Object.entries(c.effects ?? {})) if (typeof ev.value === "number") out[`${base}.${ek}`] = ev.value;
        }
        continue;
      }
      if (k === "airstrikes" && Array.isArray(v)) {
        for (const a of v) walk(a, `${p}.${a.kind}`);
        continue;
      }
      if (k === "secondaries" && v) {
        walk({ range_km: v.range_km, total_barrels: v.total_barrels, total_damage_per_minute: v.total_damage_per_minute, total_potential_fires_per_minute: v.total_potential_fires_per_minute }, p);
        const biggest = [...(v.gun_groups ?? [])].sort((a, b) => b.caliber_mm - a.caliber_mm)[0];
        if (biggest) out[`${p}.largest_caliber_mm`] = biggest.caliber_mm;
        continue;
      }
      walk(v, p);
    }
  };
  walk(stats, "");
  return out;
}

// ----- metric metadata -----
const LOWER = [
  /reload_s$/, /reload_after_burst_s$/, /reload_between_shots_in_burst_s$/, /turn_time_s$/, /turn_180_time_s$/, /rudder_shift_time_s$/, /turning_circle_radius_m$/,
  /time_to_full_speed_(ahead|reverse)_s$/, /switch_time_s$/, /detectability/, /dispersion/, /survivability\.fire\.(duration_s|damage_per_s|total_damage_per_fire|max_simultaneous_fires)$/,
  /survivability\.flooding\.(duration_s|damage_per_s|total_damage_per_flood|max_simultaneous_floods)$/, /aiming_time_s$/, /time_to_fully_aimed_s$/, /attack_cooldown_s$/,
  /restoration_time_s$/, /damage_taken_during_attack_pct$/, /arming_distance_m$/, /preparation_time_s$/, /diving_plane_shift_time_s$/, /consumables\.[^.]+\.reload_s$/,
  /charge_up_time_s$/, /instant_damage_cooldown_s$/,
];
const HIGHER = [
  /^armor\./, /hit_points$/, /\.hp$/, /_hp$/, /damage$/, /damage_per_minute$/, /salvo_damage$/, /fires_per_minute$/, /range_km$/, /speed_knots$/, /velocity_m_s$/, /penetration/, /fire_chance/, /flooding_chance_pct$/,
  /total_barrels$/, /total_tubes$/, /rate_of_fire/, /traverse_speed/, /continuous_damage_per_s$/, /flak_damage$/, /flak_bursts_per_salvo$/, /hit_chance_pct$/, /\.charges$/, /consumables\.[^.]+\.duration_s$/,
  /torpedo_protection/, /fire_chance_reduction_pct$/, /sigma$/, /krupp$/, /overmatch_mm$/, /explosion_radius_m$/, /splash_damage$/, /full_salvo_damage$/, /planes_in_squadron$/, /planes_on_deck_max$/,
  /reaction_time_s$/, /dive_capacity/, /consumables\.[^.]+\.[^.]+_km$/, /max_range_km$/, /total_continuous_damage_per_s$/, /active_duration_s$/, /hp_restored|hp_per_s$/, /largest_caliber_mm$/, /time_based_active_time_s$/,
];
export function metricInfo(path) {
  const unit = (path.match(/_(km|m|s|mm|kg|knots|pct|pct_change|deg|deg_per_s|m_per_s|m_s|hp|hp_per_s|t|per_s|per_min)$/) || [])[1] ?? null;
  let direction = "neutral";
  if (/price|research_xp|displacement|engine_power|length|width|height|caliber_mm$|mass_kg|arming_threshold|fuse_time|ricochet|splash_coefficient|air_drag|min_range|layout|barrels_per_mount|tubes_per_mount|mounts$|spread_angles|ping_width|loaders_count|weapons_per|planes_per_attack|max_simultaneous_floods/.test(path) && !/largest_caliber/.test(path)) direction = "neutral";
  else if (LOWER.some((r) => r.test(path))) direction = "lower_is_better";
  else if (HIGHER.some((r) => r.test(path))) direction = "higher_is_better";
  return { unit, direction };
}

// Compare two flat metric maps. Returns [{metric, before, after, change, change_pct, better}]
export function diff(before, after) {
  const out = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k], b = after[k];
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) continue;
    const { direction } = metricInfo(k);
    const change = typeof a === "number" && typeof b === "number" ? Math.round((b - a) * 1000) / 1000 : null;
    out.push({
      metric: k, before: a ?? null, after: b ?? null, change,
      change_pct: change !== null && a ? Math.round((change / Math.abs(a)) * 10000) / 100 : null,
      better: change === null || direction === "neutral" ? null : direction === "higher_is_better" ? change > 0 : change < 0,
    });
  }
  return out.sort((x, y) => x.metric.localeCompare(y.metric));
}

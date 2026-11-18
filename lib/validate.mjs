// Automatic sanity checks run on every build. Errors stop the build; warnings are reported.

export function validate({ rows, testShips, ctx, metricIndex }) {
  const checks = [];
  const errors = [], warnings = [];
  const check = (name, level, list, test, describe) => {
    const failures = [];
    for (const x of list) { try { if (!test(x)) failures.push(describe(x)); } catch (e) { failures.push(`${describe(x)} (exception: ${e.message})`); } }
    checks.push({ name, level, checked: list.length, failures: failures.length, examples: failures.slice(0, 20) });
    (level === "error" ? errors : warnings).push(...failures.map((f) => `${name}: ${f}`));
  };
  const m = (r, k) => r.metrics[k];
  const id = (r) => `${r.index} ${r.name}`;
  const between = (v, a, b) => typeof v === "number" && v >= a && v <= b;
  const all = [...rows, ...testShips];
  const indexes = new Set(Object.keys(ctx.ships));

  check("tier is 1-11", "error", all, (r) => between(r.tier, 1, 11), id);
  check("class is known", "error", all, (r) => ["destroyer", "cruiser", "battleship", "aircraft_carrier", "submarine"].includes(r.class), (r) => `${id(r)} class=${r.class}`);
  check("ship has an English name", "warning", all, (r) => r.name && r.name !== r.index, id);
  check("hit points > 0", "error", all, (r) => m(r, "survivability.hit_points") > 0, id);
  check("surface ships: max speed 10-60 knots", "error", all.filter((r) => r.class !== "submarine"), (r) => between(m(r, "maneuverability.max_speed_knots"), 10, 60), (r) => `${id(r)} ${m(r, "maneuverability.max_speed_knots")}`);
  check("submarines: surface speed 10-60 knots", "error", all.filter((r) => r.class === "submarine"), (r) => between(m(r, "maneuverability.max_speed_surface_knots"), 10, 60), (r) => `${id(r)} ${m(r, "maneuverability.max_speed_surface_knots")}`);
  check("rudder shift 1-40 s", "error", all, (r) => between(m(r, "maneuverability.rudder_shift_time_s"), 1, 40), (r) => `${id(r)} ${m(r, "maneuverability.rudder_shift_time_s")}`);
  check("detectability by ships 1-25 km", "error", all, (r) => between(m(r, "concealment.detectability_by_ships_km"), 1, 25), (r) => `${id(r)} ${m(r, "concealment.detectability_by_ships_km")}`);
  const withMb = all.filter((r) => m(r, "main_battery.range_km") !== undefined);
  check("main battery range 1-40 km", "error", withMb, (r) => between(m(r, "main_battery.range_km"), 1, 40), (r) => `${id(r)} ${m(r, "main_battery.range_km")}`);
  check("main battery reload 0.5-120 s", "error", withMb, (r) => between(m(r, "main_battery.reload_s"), 0.5, 120), (r) => `${id(r)} ${m(r, "main_battery.reload_s")}`);
  check("surface gunships have a main battery", "warning", all.filter((r) => ["destroyer", "cruiser", "battleship"].includes(r.class)), (r) => m(r, "main_battery.range_km") !== undefined, id);
  check("main battery shells have damage", "error", withMb, (r) => ["he", "ap", "sap"].some((t) => m(r, `main_battery.shells.${t}.damage`) > 0), id);
  const withTorp = all.filter((r) => m(r, "torpedoes.torpedoes.primary.range_km") !== undefined);
  check("torpedo range 0.5-30 km", "error", withTorp, (r) => between(m(r, "torpedoes.torpedoes.primary.range_km"), 0.5, 30), (r) => `${id(r)} ${m(r, "torpedoes.torpedoes.primary.range_km")}`);
  check("torpedo speed 20-120 knots", "error", withTorp, (r) => between(m(r, "torpedoes.torpedoes.primary.speed_knots"), 20, 120), (r) => `${id(r)} ${m(r, "torpedoes.torpedoes.primary.speed_knots")}`);
  check("torpedo damage > 0", "error", withTorp, (r) => m(r, "torpedoes.torpedoes.primary.damage") > 0, id);
  check("carriers have aircraft", "warning", all.filter((r) => r.class === "aircraft_carrier"), (r) => Object.keys(r.metrics).some((k) => k.startsWith("aircraft.")), id);
  check("all metric values are finite numbers", "error", all, (r) => Object.values(r.metrics).every((v) => typeof v === "number" && Number.isFinite(v)), id);
  const summaryLinks = ctx.summary.flatMap((s) => [s.prevShipIndex, ...(s.nextShipIndexes ?? [])].filter(Boolean).map((t) => ({ from: s.index, to: t })));
  check("tech tree links point to existing ships", "error", summaryLinks, (l) => indexes.has(l.to), (l) => `${l.from} -> ${l.to}`);
  check("every released ship is ranked somewhere", "error", rows, (r) => Object.keys(r.metrics).length > 20, id);
  check("there are rankings", "error", [metricIndex], (x) => x.length > 100, (x) => `only ${x.length}`);

  return {
    about: "Automatic checks run on every build. Errors stop the build (the site keeps its previous version). Warnings are reported here.",
    game_version: ctx.gameVersion, generated_at: new Date().toISOString(),
    passed: errors.length === 0, error_count: errors.length, warning_count: warnings.length, checks, errors: errors.slice(0, 200), warnings: warnings.slice(0, 200),
  };
}

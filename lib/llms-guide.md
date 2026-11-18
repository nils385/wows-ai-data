## How to answer common player questions

Rankings list every released ship. Filtered versions add /class/{class}, /class/{class}/tier-{n}, /tier/{n} or /nation/{nation} before .json, for example {BASE}/api/rankings/main_battery.reload_s/class/cruiser/tier-10.json. For several nations at once, take the full list and keep only those nations; the order stays correct.

- "Which ship is stealthiest / has the best concealment?" -> {BASE}/api/rankings/concealment.detectability_by_ships_km.json (lower is better). Air detection: concealment.detectability_by_planes_km. Best reachable with the concealment upgrade: {BASE}/api/rankings-with-upgrades/concealment.detectability_by_ships_km.json
- "Fastest gun reload?" -> main_battery.reload_s. "Most damage per minute (DPM)?" -> main_battery.he_damage_per_minute, main_battery.ap_damage_per_minute, main_battery.sap_damage_per_minute. DPM is theoretical (every shell hits); also check penetration before calling a ship strong.
- "Most fires?" -> main_battery.he_potential_fires_per_minute and main_battery.shells.he.fire_chance_pct.
- "Longest range?" -> main_battery.range_km (base) or {BASE}/api/rankings-with-upgrades/main_battery.range_km.json (with range upgrade).
- "Which ships have radar / hydro, and how far?" -> rankings named consumables.surveillance_radar.* and consumables.hydroacoustic_search.* (search {BASE}/api/rankings/index.json for "consumables."). Only ships that have the consumable appear in those lists.
- "What does a shell overmatch?" -> main_battery.shells.ap.overmatch_mm: plates thinner than this cannot bounce that shell (caliber / 14.3).
- "AP penetration at X km / shell flight time?" -> ship file, configurations.top.main_battery.shells.ap.ballistics_by_range (every 1 km up to max range). HE/SAP penetration is fixed: shells.he.penetration_mm.
- "Most HP / tankiest?" -> survivability.hit_points; torpedo protection: survivability.flooding.torpedo_protection_damage_reduction_pct; fire: survivability.fire.*.
- "Fastest / most agile?" -> maneuverability.max_speed_knots, maneuverability.rudder_shift_time_s, maneuverability.turning_circle_radius_m, maneuverability.time_to_full_speed_ahead_s.
- "Best torpedoes?" -> torpedoes.torpedoes.primary.damage, .range_km, .speed_knots, .reaction_time_s (higher = harder to dodge), .detectability_km, torpedoes.reload_s, torpedoes.torpedoes.primary.damage_per_minute.
- "Best AA?" -> anti_air.total_continuous_damage_per_s, anti_air.long_range.flak_damage, anti_air.max_range_km.
- "Turret turn speed?" -> main_battery.turret_180_turn_time_s.
- "Which upgrades / captain skills / flags for ship X?" -> ship file: upgrades.slots (every option with exact stat changes), upgrades.best_possible_values, captain_skills.skills, signal_flags.flags. This site gives facts (what each option changes), not opinions on which build is best.
- "Compare ship A and B" -> fetch both ship files and compare all_metrics_top_configuration (same metric names for every ship).
- "Stock vs upgraded hull/guns?" -> ship file configurations.stock vs configurations.top, or every module combination at {BASE}/api/ships/{index}/configurations.json.

Notes for correct answers:
- Base values exclude captain skills, upgrades, signals and camouflage. Say so when you quote them, or use the upgrade and skill data to add them.
- Names can be shared by several ships (event or alternate versions). Check tier and category.
- category "special" = event, reward, coal, steel or research-bureau ships, not bought with doubloons.
- There are no player statistics (win rates, average damage) on this site.


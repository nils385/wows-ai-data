## How to answer common player questions

Rankings list every released ship. Filtered versions add /class/{class}, /class/{class}/tier-{n}, /tier/{n} or /nation/{nation} before .json, for example {BASE}/api/rankings/main_battery.reload_s/class/cruiser/tier-10.json. For several nations at once, take the full list and keep only those nations; the order stays correct.

- "Which ship is stealthiest / has the best concealment?" -> players usually mean the full concealment build: {BASE}/api/rankings/concealment.min_detectability_by_ships_km.json (with Concealment Expert + Concealment System Modification 1, no camouflage). Base value: concealment.detectability_by_ships_km. Lower is better.
- "Fastest gun reload?" -> main_battery.reload_s. "Most damage per minute (DPM)?" -> main_battery.he_damage_per_minute, main_battery.ap_damage_per_minute, main_battery.sap_damage_per_minute. DPM is theoretical (every shell hits); also check penetration before calling a ship strong.
- "Most fires?" -> main_battery.he_potential_fires_per_minute and main_battery.shells.he.fire_chance_pct.
- "Longest range?" -> main_battery.range_km (base) or {BASE}/api/rankings-with-upgrades/main_battery.range_km.json (with range upgrade).
- "Which ships have radar / hydro, and how far?" -> rankings named consumables.surveillance_radar.* and consumables.hydroacoustic_search.* (list: {BASE}/rankings/groups/consumables.md). Only ships that have the consumable appear in those lists.
- "What does a shell overmatch?" -> main_battery.shells.ap.overmatch_mm: plates thinner than this cannot bounce that shell (caliber / 14.3).
- "AP penetration at X km / shell flight time?" -> on the ship page: main_battery.shells.ap.penetration_at_{5,10,15,20}km_mm and flight_time_at_{10,15}km_s (also ranked). Every 1 km: the ship's details page (ballistics_by_range). HE/SAP penetration is fixed: shells.he.penetration_mm; with IFHE: shells.he.penetration_with_ifhe_mm.
- "Can this HE shell damage X mm plating?" -> it can if penetration_mm (or penetration_with_ifhe_mm) is greater than the plate thickness. Common plates: 16 mm (low-tier bow/stern), 19 mm (destroyers, cruisers up to tier VII), 25-27 mm (tier VIII-IX cruiser and battleship bow/stern), 30 mm (tier X cruisers), 32 mm (tier X battleship bow/stern). See armor.* on ship pages.
- "Most HP / tankiest?" -> survivability.hit_points; torpedo protection: survivability.flooding.torpedo_protection_damage_reduction_pct; fire: survivability.fire.*.
- "Fastest / most agile?" -> maneuverability.max_speed_knots, maneuverability.rudder_shift_time_s, maneuverability.turning_circle_radius_m, maneuverability.time_to_full_speed_ahead_s.
- "Best torpedoes?" -> torpedoes.torpedoes.primary.damage, .range_km, .speed_knots, .reaction_time_s (higher = harder to dodge), .detectability_km, torpedoes.reload_s, torpedoes.torpedoes.primary.damage_per_minute.
- "Best AA?" -> anti_air.total_continuous_damage_per_s, anti_air.long_range.flak_damage, anti_air.max_range_km.
- "Turret turn speed?" -> main_battery.turret_180_turn_time_s.
- "Which upgrades / captain skills / flags for ship X?" -> ship file: upgrades.slots (every option with exact stat changes), upgrades.best_possible_values, captain_skills.skills, signal_flags.flags. This site gives facts (what each option changes), not opinions on which build is best.
- "Compare ship A and B" -> fetch {BASE}/ship/{a}.md and {BASE}/ship/{b}.md and compare the "All stats" lines (same metric names for every ship).
- "Stock vs upgraded hull/guns?" -> ship file configurations.stock vs configurations.top, or every module combination at {BASE}/api/ships/{index}/configurations.json.

- Submarines and anti-submarine weapons: ship depth charges = depth_charges.* (launched from the ship); anti-submarine airstrike = airstrikes.anti_submarine_airstrike.* (planes); submarine sonar pings = sonar.*; submarine dive battery = survivability.dive_capacity; speeds at depth = maneuverability.max_speed_periscope_depth_knots / max_speed_max_depth_knots. Consumables: Submarine Surveillance and Hydrophone are in consumables.*.

Code examples (for agents that can run code):

```python
import json, urllib.request
ships = [json.loads(l) for l in urllib.request.urlopen("{BASE}/ships.jsonl")]
# tier X cruisers with radar range over 10 km, sorted by best concealment
hits = [s for s in ships if s["tier"] == 10 and s["class"] == "cruiser"
        and s["metrics"].get("consumables.surveillance_radar.detection_of_ships_km", 0) > 10]
for s in sorted(hits, key=lambda s: s["metrics"].get("concealment.min_detectability_by_ships_km", 99)):
    print(s["name"], s["metrics"].get("consumables.surveillance_radar.detection_of_ships_km"), s["metrics"].get("concealment.min_detectability_by_ships_km"))
```

```bash
curl -s {BASE}/ships.jsonl | jq -r 'select(.tier==10 and .class=="destroyer") | [.name, .metrics["concealment.min_detectability_by_ships_km"]] | @tsv' | sort -t$'\t' -k2 -n | head
```

Notes for correct answers:
- Base values exclude captain skills, upgrades, signals and camouflage. Say so when you quote them, or use the upgrade and skill data to add them.
- Names can be shared by several ships (event or alternate versions). Check tier and category.
- category "special" = event, reward, coal, steel or research-bureau ships, not bought with doubloons.
- There are no player statistics (win rates, average damage) on this site.


// Penetration rules for one armor plate, used by the gunnery lab (and its tests).
// AP: raw penetration vs effective thickness (plate / cos(hit angle)); ricochet between the shell's ricochet angles
// unless it overmatches (caliber > 14.3 x plate); fuse arming threshold for overpenetration. HE: penetration vs
// plate, angle does not matter. SAP: penetration vs plate, ricochet angles apply.
// Not modeled (not in the game data): shell normalization, spaced armor, citadel layout.
const rad = (d) => (d * Math.PI) / 180;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
export function plateResult(shell, pen, thickness, incidence) {
  if (!thickness) return { key: "pen", eff: 0, note: "no armor value" };
  const caliber = shell.caliber_mm, type = shell.type;
  const overmatch = (type === "AP" || type === "SAP") && caliber / 14.3 >= thickness;
  const eff = thickness / Math.max(Math.cos(rad(incidence)), 1e-6);
  if (type === "HE") return { key: pen >= thickness ? "pen" : "nopen", eff: thickness, note: "HE: angle does not matter" };
  if (!overmatch && shell.ricochet_always_angle_deg && incidence >= shell.ricochet_always_angle_deg) return { key: "ric", eff, note: `${f1(incidence)}° ≥ ${shell.ricochet_always_angle_deg}° always-ricochet angle` };
  const may = !overmatch && shell.ricochet_start_angle_deg && incidence >= shell.ricochet_start_angle_deg;
  if (type === "SAP") return { key: pen >= thickness ? (may ? "mayric" : "pen") : "nopen", eff: thickness, overmatch, note: overmatch ? "overmatch: cannot ricochet" : "SAP: angle only matters for ricochets" };
  const goes = overmatch || pen >= eff;
  if (!goes) return { key: may ? "mayric" : "nopen", eff, note: may ? "would bounce or shatter" : "shatters" };
  if (may) return { key: "mayric", eff, overmatch, note: "penetrates if it does not ricochet" };
  return { key: shell.arming_threshold_mm && thickness < shell.arming_threshold_mm ? "overpen" : "pen", eff, overmatch, note: overmatch ? "overmatch" : "" };
}


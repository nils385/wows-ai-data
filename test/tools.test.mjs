import test from "node:test";
import assert from "node:assert/strict";
import { plateResult } from "../lib/penetration.mjs";
import { canAddSkill, canRemoveSkill, captainModifiers, captainTalents, SKILL } from "../lib/builder.mjs";
import { trajectoryTable, trajectoryPath, at } from "../lib/ballistics.mjs";

const ap460 = { type: "AP", caliber_mm: 460, ricochet_start_angle_deg: 45, ricochet_always_angle_deg: 60, arming_threshold_mm: 76 };

test("penetration rules: AP effective thickness, ricochet, overmatch, overpenetration", () => {
  assert.equal(plateResult(ap460, 500, 410, 0).key, "pen");
  assert.equal(plateResult(ap460, 400, 410, 0).key, "nopen");
  assert.equal(plateResult(ap460, 460, 410, 30).key, "nopen", "410 / cos 30° = 473 mm effective");
  assert.equal(plateResult(ap460, 480, 410, 30).key, "pen");
  assert.ok(Math.abs(plateResult(ap460, 500, 410, 30).eff - 410 / Math.cos(Math.PI / 6)) < 1e-9);
  assert.equal(plateResult(ap460, 900, 410, 50).key, "mayric");
  assert.equal(plateResult(ap460, 900, 410, 65).key, "ric");
  // 460 mm overmatches 32 mm (460 / 14.3 = 32.2): no ricochet even at a steep angle
  assert.equal(plateResult(ap460, 900, 32, 75).key, "overpen", "overmatched, but 32 mm is below the fuse arming threshold");
  assert.equal(plateResult(ap460, 900, 33, 75).key, "ric", "33 mm is not overmatched");
  assert.equal(plateResult(ap460, 900, 80, 10).key, "pen");
});

test("penetration rules: HE ignores angle, SAP ricochets", () => {
  const he = { type: "HE", caliber_mm: 203, penetration_mm: 34 };
  assert.equal(plateResult(he, 34, 34, 80).key, "pen");
  assert.equal(plateResult(he, 34, 35, 0).key, "nopen");
  const sap = { type: "SAP", caliber_mm: 203, ricochet_start_angle_deg: 60, ricochet_always_angle_deg: 75 };
  assert.equal(plateResult(sap, 60, 50, 80).key, "ric");
  assert.equal(plateResult(sap, 60, 50, 65).key, "mayric");
  assert.equal(plateResult(sap, 60, 50, 10).key, "pen");
  assert.equal(plateResult(sap, 60, 70, 10).key, "nopen");
});

const sk = (key, tier, number = 0, extra = {}) => ({ key, tier, cost: tier + 1, number, raw: { modifiers: [], conditionalModifierGroups: [], ...extra } });

test("skill point rules match the game (21 points, row before needed)", () => {
  const t0 = sk("a", 0), t1 = sk("b", 1), t2 = sk("c", 2), t3 = sk("d", 3);
  assert.equal(canAddSkill([], t0), true);
  assert.equal(canAddSkill([], t1), false);
  assert.equal(canAddSkill([t0], t1), true);
  assert.equal(canAddSkill([t0, t1, t2], t3), true);
  const full = [sk("x", 3), sk("y", 3), sk("z", 3), sk("w", 3), sk("v", 2), sk("u", 1)]; // 4*4 + 3 + 2 = 21
  assert.equal(canAddSkill(full, t0), false);
  assert.equal(canRemoveSkill([t0, t1], t0), false, "cannot remove the only row-1 skill while a row-2 skill needs it");
  assert.equal(canRemoveSkill([t0, sk("a2", 0), t1], t0), true);
  assert.equal(canRemoveSkill([t0, t1, t2, t3], t3), true);
});

test("captain modifiers: Adrenaline Rush scales with HP lost, class filter, Furious stacking", () => {
  const ar = sk("ar", 1, SKILL.AR, { modifiers: [{ name: "lastChanceReloadCoefficient", value: 0.2, affectedProperties: ["MainBatteryDataContainer.Reload"], valueProcessingKind: "None" }] });
  const m = captainModifiers({ skills: [ar], cls: "Battleship", arHpPct: 20 });
  assert.equal(m.length, 1);
  assert.ok(Math.abs(m[0].value - 16) < 1e-9, "80% HP lost x 0.2 = 16");
  const gs = sk("g", 0, 1, { modifiers: [{ name: "GMShotDelay_Battleship", value: 0.9 }, { name: "GMShotDelay_Cruiser", value: 0.8 }, { name: "plain", value: 1.1 }] });
  assert.deepEqual(captainModifiers({ skills: [gs], cls: "Battleship" }).map((x) => x.name), ["GMShotDelay_Battleship", "plain"]);
  const fur = sk("f", 2, SKILL.FURIOUS, { conditionalModifierGroups: [{ activationLimit: 4, modifiers: [{ name: "repeatable_first_GMShotDelay", value: 0.95 }, { name: "repeatable_other_GMShotDelay", value: 0.9 }] }] });
  const off = captainModifiers({ skills: [fur], cls: "Battleship" });
  assert.equal(off.length, 0, "conditional effects are off until switched on");
  const on = captainModifiers({ skills: [fur], cls: "Battleship", conditional: { "f#0": { on: true, count: 3 } } });
  assert.ok(Math.abs(on[0].value - 0.95 * 0.9 * 0.9) < 1e-9);
});

test("talents: tiers and operations copies", () => {
  const cap = { uniqueSkills: {
    t1: { battleGroup: "Regular", translationId: "T1", maxTriggerNum: 1, skillEffects: { e: { modifiers: [{ name: "x", value: 0.9 }, { name: "workTime", value: 5 }], levels: [] } } },
    t1ops: { battleGroup: "Operations", translationId: "T1", maxTriggerNum: 1, skillEffects: { e: { modifiers: [{ name: "x", value: 0.8 }], levels: [] } } },
    t2: { battleGroup: "Regular", translationId: "T2", maxTriggerNum: 3, skillEffects: { e: { modifiers: [{ name: "y", value: 1 }], levels: [] } } },
  } };
  const t = captainTalents(cap, {});
  assert.deepEqual(t.map((x) => x.id), ["t1", "t2"]);
  assert.deepEqual(t[0].modifiers.map((m) => m.name), ["x"], "workTime is not a stat effect");
  const m = captainModifiers({ talents: t, talentState: { t2: { on: true, count: 3 } }, cls: "Cruiser" });
  assert.equal(m[0].value, 1);
});

test("flight path ends where the range table says", () => {
  const shell = { id: 1, name: "t", shellType: "AP", caliber: 0.406, mass: 1225, krupp: 2574, airDrag: 0.352, muzzleVelocity: 762, penetration: 0 };
  const table = trajectoryTable(shell, 20000);
  const p = at(table, 15000);
  const path = trajectoryPath(shell, p.launch_angle_rad, 1);
  const end = path[path.length - 1];
  assert.ok(Math.abs(end.x_m - 15000) < 60, `path ends at ${end.x_m}`);
  assert.ok(Math.abs(end.t_s - p.flight_time_s) < 0.1);
});

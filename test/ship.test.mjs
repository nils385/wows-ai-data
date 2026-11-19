
import test from "node:test";
import assert from "node:assert/strict";
import { rnd, apply, applyInt } from "../lib/ship.mjs";

test("rnd uses C# midpoint-to-even rounding", () => {
  assert.equal(rnd(2.5, 0), 2);
  assert.equal(rnd(3.5, 0), 4);
  assert.equal(rnd(-2.5, 0), -2);
  assert.equal(rnd(-3.5, 0), -4);
  assert.equal(rnd(1.005, 2), 1);
});

test("floating modifier application covers the supported operations", () => {
  const base = 100;
  const modifier = (valueProcessingKind, value) => ({ affectedProperties: ["Test.Value"], valueProcessingKind, value });
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not near ${expected}`);
  near(apply([modifier("AddPercentage", 0.1)], "Test.Value", base), 110);
  near(apply([modifier("SubtractPercentage", 10)], "Test.Value", base), 99.9);
  near(apply([modifier("Multiplier", 1.2)], "Test.Value", base), 120);
  near(apply([modifier("PositiveMultiplier", 10)], "Test.Value", base), 110);
  near(apply([modifier("NegativeMultiplier", 10)], "Test.Value", base), 90);
  near(apply([modifier("RawAdd", 7)], "Test.Value", base), 107);
  near(apply([modifier("RawAdd", 7)], "Other.Value", base), 100);
});

test("integer modifier application truncates modifier values as intended", () => {
  const modifier = (valueProcessingKind, value) => ({ affectedProperties: ["Test.Value"], valueProcessingKind, value });
  assert.equal(applyInt([modifier("AddPercentage", 2.9)], "Test.Value", 100), 300);
  assert.equal(applyInt([modifier("SubtractPercentage", 250.9)], "Test.Value", 100), 98);
  assert.equal(applyInt([modifier("Multiplier", 1.9)], "Test.Value", 100), 100);
  assert.equal(applyInt([modifier("PositiveMultiplier", 150.9)], "Test.Value", 100), 200);
  assert.equal(applyInt([modifier("RawAdd", -2.9)], "Test.Value", 100), 98);
});




import test from "node:test";
import assert from "node:assert/strict";
import { slug, normalizeName } from "../lib/ship.mjs";

test("slug transliterates Latin letters that NFKD does not decompose", () => {
  assert.equal(slug("Błyskawica"), "blyskawica");
  assert.equal(slug("Østergötland"), "ostergotland");
  assert.equal(slug("Ægir"), "aegir");
  assert.equal(slug("Süßhofen"), "susshofen");
});

test("slug keeps ordinary accent and punctuation normalization", () => {
  assert.equal(slug("Piñatapolis"), "pinatapolis");
  assert.equal(slug("W. Virginia '41"), "w_virginia_41");
});

test("name lookup normalization uses the same transliteration as ship slugs", () => {
  assert.equal(normalizeName("Błyskawica"), "blyskawica");
  assert.equal(normalizeName("Süßhofen"), "susshofen");
  assert.equal(normalizeName("Ægir"), "aegir");
});

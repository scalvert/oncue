/**
 * Python-compatible number formatting. Props and timings were made by Python; these pin the
 * rounding the published videos depend on (ties to even, on the exact binary value).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dumps } from "../src/core/json.ts";
import { fixed, pyFloat, round } from "../src/core/numbers.ts";
import { pyRepr } from "../src/core/text.ts";

test("round() rounds the exact binary value, ties to even", () => {
  assert.equal(round(2.5), 2);
  assert.equal(round(3.5), 4);
  assert.equal(round(0.125, 2), 0.12); // exactly representable: a true tie
  assert.equal(round(2.675, 2), 2.67); // 2.67499999... in binary
  assert.equal(round(1.005, 2), 1); // 1.00499999...
  assert.equal(round(-0.5), -0);
});

test("fixed() is Python's f-string formatting", () => {
  assert.equal(fixed(0.125, 2), "0.12");
  assert.equal(fixed(54.475, 1), "54.5");
  assert.equal(fixed(-1.5, 0), "-2");
  assert.equal(fixed(7, 2), "7.00");
});

test("display helpers match Python", () => {
  assert.equal(pyFloat(34), "34.0");
  assert.equal(pyFloat(34.43), "34.43");
  assert.equal(pyRepr(["a", "it's"]), `['a', "it's"]`);
  assert.equal(pyRepr(null), "None");
});

test("dumps() matches json.dumps for the shapes gv writes", () => {
  assert.equal(dumps({ a: [], b: {}, c: "é" }, { indent: 2, ensureAscii: false }), '{\n  "a": [],\n  "b": {},\n  "c": "é"\n}');
  assert.equal(dumps({ c: "é" }), '{"c": "\\u00e9"}');
});

// Pins composition/src/runtime's animation math, so a change can't silently move every frame.
// Run with npm test (bundles the runtime with esbuild, then node:test).
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";

const outfile = new URL("./.runtime.test.bundle.mjs", import.meta.url).pathname;
await build({
  entryPoints: [new URL("../src/runtime/index.tsx", import.meta.url).pathname],
  bundle: true, outfile, format: "esm", platform: "node", jsx: "automatic", logLevel: "error",
  external: ["react", "react/jsx-runtime"],
});
const { interpolate, spring } = await import(outfile);
after(() => rmSync(outfile, { force: true }));

// spring() at 30 fps for the configs the Explainer uses, measured black-box from Remotion's public
// spring() and rounded to 4 places.
const GOLDEN = [
  [{ damping: 24, stiffness: 140, mass: 0.8 }, { 1: 0.0729, 2: 0.2209, 3: 0.3813, 4: 0.5263, 5: 0.6466, 6: 0.7413, 10: 0.9342, 20: 0.9985, 30: 1 }],
  [{ damping: 20, stiffness: 140, mass: 0.8 }, { 1: 0.0739, 2: 0.2262, 3: 0.3929, 4: 0.5441, 5: 0.6691, 6: 0.7663, 10: 0.9536, 20: 1.0001 }],
  [{ damping: 18, stiffness: 140, mass: 0.8 }, { 1: 0.0757, 2: 0.2359, 3: 0.4144, 4: 0.5776, 5: 0.7115, 6: 0.8136, 10: 0.9882, 20: 1.0009 }],
  [{ damping: 16, stiffness: 140, mass: 0.8 }, { 1: 0.0776, 2: 0.2462, 3: 0.4381, 4: 0.6151, 5: 0.7597, 6: 0.8675, 10: 1.0241, 20: 0.9996 }],
  [{ damping: 14, stiffness: 140, mass: 0.8 }, { 1: 0.0795, 2: 0.2574, 3: 0.4642, 4: 0.6574, 5: 0.8148, 6: 0.9295, 10: 1.0612, 20: 0.9964, 30: 1.0002 }],
  [{ damping: 15, stiffness: 190 }, { 1: 0.0884, 2: 0.2909, 3: 0.5294, 4: 0.7509, 5: 0.9259, 6: 1.0442, 10: 1.0969, 20: 0.9947 }],
];

test("spring matches the published renders", () => {
  for (const [config, values] of GOLDEN) {
    for (const [frame, want] of Object.entries(values)) {
      const got = spring({ frame: Number(frame), fps: 30, config });
      assert.ok(Math.abs(got - want) <= 5e-5, `${JSON.stringify(config)} frame ${frame}: ${got} != ${want}`);
    }
  }
});

test("spring rests at `from` until frame 1", () => {
  for (const frame of [-10, -1, 0]) assert.equal(spring({ frame, fps: 30 }), 0);
  assert.equal(spring({ frame: -1, fps: 30, from: 5, to: 9 }), 5);
});

test("interpolate: linear, clamped, extended, multi-segment", () => {
  assert.equal(interpolate(5, [0, 10], [0, 1]), 0.5);
  assert.equal(interpolate(-5, [0, 10], [0, 1], { extrapolateLeft: "clamp" }), 0);
  assert.equal(interpolate(15, [0, 10], [0, 1], { extrapolateRight: "clamp" }), 1);
  assert.equal(interpolate(15, [0, 10], [0, 1]), 1.5);
  assert.equal(interpolate(-5, [0, 10], [0, 1]), -0.5);
  assert.equal(interpolate(15, [0, 10], [0, 1], { extrapolateRight: "identity" }), 15);
  // The Explainer's fade: [0, .25, until-.25, until] -> [0, 1, 1, 0]
  const fade = (t) => interpolate(t, [1, 1.25, 2.75, 3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  assert.deepEqual([0, 1, 1.125, 2, 2.875, 3, 4].map(fade), [0, 0, 0.5, 1, 0.5, 0, 0]);
});

test("interpolate rejects ranges that aren't strictly increasing", () => {
  assert.throws(() => interpolate(1, [0, 0], [0, 1]), /strictly increasing/);
  assert.throws(() => interpolate(1, [0], [0]), /same length/);
});

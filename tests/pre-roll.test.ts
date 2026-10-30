/** A pre-roll moves the narration and every scene later, and changes nothing when it's 0. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPreRoll, NARRATION_OFFSET, planRetime } from "../src/audio/retime.ts";
import { Timeline } from "../src/builder/timeline.ts";
import { round } from "../src/core/numbers.ts";
import type { NarrationLock } from "../src/narration/lock.ts";

const SILENT = -80;
const SPEECH = -15;
const levels = (...runs: [number, number][]) => runs.flatMap(([secs, db]) => Array<number>(round(secs * 100)).fill(db));

// Two segments with a pause between them, and a take whose levels match.
const lock = {
  text: "",
  voice: {},
  segments: [
    { id: "s1", start: 0.5, end: 1.5 },
    { id: "s2", start: 2.5, end: 3.5 },
  ],
  words: [
    { word: "Hello", start: 0.5, end: 1.5 },
    { word: "again", start: 2.5, end: 3.5 },
  ],
} as unknown as NarrationLock;
const take = levels([0.5, SILENT], [1.0, SPEECH], [1.0, SILENT], [1.0, SPEECH], [0.5, SILENT]);
const order = ["s1", "s2"];
const shifted = (a: number, b: number) => assert.equal(round(b - a, 6), 2.4);

test("a pre-roll shifts every segment and word by its length", () => {
  const base = planRetime(lock, take);
  const pre = planRetime(lock, take, { preRoll: 2.4 });
  for (const id of order) {
    shifted(base.segments[id]!.start, pre.segments[id]!.start);
    shifted(base.segments[id]!.end, pre.segments[id]!.end);
  }
  base.words.forEach((w, i) => shifted(w.start, pre.words[i]!.start));
  // The audio is the same cut; only where it plays moves.
  assert.equal(pre.filterGraph, base.filterGraph);
});

test("preRoll 0 is the same plan as no preRoll", () => {
  assert.deepEqual(planRetime(lock, take, { preRoll: 0 }), planRetime(lock, take));
});

test("the narration still starts NARRATION_OFFSET after the pre-roll", () => {
  const pre = planRetime(lock, take, { preRoll: 2.4 });
  assert.ok(pre.segments.s1!.start >= 2.4 + NARRATION_OFFSET - 0.2, String(pre.segments.s1!.start));
});

test("the first scene starts at the pre-roll; the others keep their bounds", () => {
  const base = planRetime(lock, take);
  const pre = planRetime(lock, take, { preRoll: 2.4 });
  const a = new Timeline(base.words, base.segments, order);
  const b = new Timeline(pre.words, pre.segments, order, 2.4);
  assert.equal(a.span("s1")[0], 0);
  assert.equal(b.span("s1")[0], 2.4);
  shifted(a.span("s1")[1], b.span("s1")[1]);
  shifted(a.span("s2")[0], b.span("s2")[0]);
  shifted(a.end, b.end);
});

test("a negative or non-numeric pre-roll is rejected", () => {
  assert.throws(() => checkPreRoll(-1), /preRoll/);
  assert.throws(() => checkPreRoll(Number.NaN), /preRoll/);
  assert.throws(() => planRetime(lock, take, { preRoll: -0.5 }), /preRoll/);
  assert.equal(checkPreRoll(0), 0);
});

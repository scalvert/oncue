/** Clip cuts start where the speech starts, even when the aligner marks it late, and end cleanly. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fadeOut, MAX_LEAD, PAD_IN, safeStart } from "../src/audio/cuts.ts";
import { levels as takeLevels } from "../src/audio/levels.ts";
import { ffmpeg } from "../src/media/ffmpeg.ts";
import { round } from "../src/core/numbers.ts";
import { tempDir } from "./helpers.ts";

const SILENT = -80;
const SPEECH = -15;

/** 10 ms level frames from [seconds, dB] runs. */
const levels = (...runs: [number, number][]) => runs.flatMap(([secs, db]) => Array<number>(round(secs * 100)).fill(db));

test("quiet before the aligned start keeps the usual cut", () => {
  assert.equal(safeStart(levels([2.0, SILENT], [1.0, SPEECH]), 2.0), round(2.0 - PAD_IN, 3));
});

test("speech already under way is kept", () => {
  // Speech really starts at 1.80; the aligner says 2.05 (the "Next" -> "...xt" case).
  const a = safeStart(levels([1.8, SILENT], [1.2, SPEECH]), 2.05);
  assert.ok(a >= 1.75 && a <= 1.8, String(a));
});

test("levels hear a fricative", () => {
  // An "s" is mostly energy above 4 kHz. levels() must not read it as silence, or safeStart cuts
  // into it ("Start" played as "...tart"). A 6 kHz tone at -20 dBFS stands in for the hiss.
  const mp3 = join(tempDir(), "hiss.mp3");
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=6000:duration=0.5", "-af", "volume=-17dB", "-ar", "44100", mp3]);
  assert.ok(Math.min(...takeLevels(mp3).slice(5, 40)) > -45);
});

test("a cut in silence gets the short fade", () => {
  assert.equal(fadeOut(levels([2.0, SPEECH], [1.0, SILENT]), 0.0, 2.5), 0.03);
});

test("a take that stops mid-word decays instead of stopping dead", () => {
  // The take ends at 3.0 s with the last word still sounding (the "com." case).
  assert.equal(fadeOut(levels([3.0, SPEECH]), 1.0, 3.0), 0.15);
});

test("never reaches back into the previous segment", () => {
  assert.ok(safeStart(levels([3.0, SPEECH]), 2.0, 1.9) >= 1.9);
});

test("never reaches back more than MAX_LEAD", () => {
  assert.ok(safeStart(levels([5.0, SPEECH]), 4.0) >= 4.0 - PAD_IN - MAX_LEAD - 0.03);
});

test("the first segment starts at zero", () => {
  assert.equal(safeStart(levels([1.0, SPEECH]), 0.02), 0.0);
});

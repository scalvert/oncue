/** The placeholder voice: offline takes whose timings line up with the text. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { alignWords } from "../src/narration/alignment.ts";
import { placeholderSynthesizer, placeholderTimings } from "../src/narration/placeholder.ts";
import { takeText } from "../src/narration/script.ts";

const text = takeText(
  [
    { id: "s1", text: "Hello there, friend." },
    { id: "s2", text: "Second line." },
  ],
  "oncue-placeholder",
);

test("timings cover the exact text, in order", () => {
  const { alignment } = placeholderTimings(text);
  assert.equal(alignment.characters.join(""), text);
  for (let i = 1; i < alignment.starts.length; i++) assert.ok(alignment.starts[i]! >= alignment.starts[i - 1]!);
});

test("break tags are pauses, not words", () => {
  const words = alignWords(placeholderTimings(text).alignment);
  assert.deepEqual(words.map((w) => w.word), ["Hello", "there,", "friend.", "Second", "line."]);
  const gap = words[3]!.start - words[2]!.end;
  assert.ok(gap > 0.9, `gap ${gap}`);
});

test("a word's tone ends with its last letter, not after the pause", () => {
  const { words } = placeholderTimings("One. Two.");
  assert.ok(words[1]![0] - words[0]![1] >= 0.3);
});

test("the take is an MP3, the same every time", async () => {
  const a = await placeholderSynthesizer.synthesize(text, { voice_id: "oncue-placeholder", model_id: "oncue-placeholder", settings: {} });
  const b = await placeholderSynthesizer.synthesize(text, { voice_id: "oncue-placeholder", model_id: "oncue-placeholder", settings: {} });
  assert.ok(a.audio.length > 1000);
  assert.ok(a.audio.subarray(0, 3).toString() === "ID3" || (a.audio[0] === 0xff && (a.audio[1]! & 0xe0) === 0xe0));
  assert.deepEqual(a.audio, b.audio);
});

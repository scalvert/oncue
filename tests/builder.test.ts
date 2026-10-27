/** Builder helpers: spoken text, captions, and the JSON view terminal scenes use. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { captionWords, type SpokenForm } from "../src/builder/captions.ts";
import { jsonView, type JsonPath } from "../src/builder/json-view.ts";
import { Term } from "../src/builder/term.ts";
import { spokenText } from "../src/narration/script.ts";

test("spoken text drops audio tags", () => {
  assert.equal(spokenText("[upbeat] Your teams use AI. [speaking slowly] Claude."), "Your teams use AI. Claude.");
  assert.equal(spokenText("It works with any MCP host."), "It works with any MCP host.");
});

function captions(sentence: string, extra: SpokenForm[] = []) {
  const words = sentence.split(" ").map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));
  return captionWords(words, [words.at(-1)!.end], ["docs dot acme dot dev", ...extra]);
}

test("spoken URLs are written as URLs", () => {
  assert.deepEqual(captions("Go to docs dot acme dot dev.").map((c) => c.word), ["Go", "to", "docs.acme.dev."]);
});

test("spoken/written pairs", () => {
  assert.deepEqual(captions("It uses X A A today.", [["X A A", "XAA"]]).map((c) => c.word), ["It", "uses", "XAA", "today."]);
});

test("lines break after sentences and at segment ends", () => {
  assert.deepEqual(captions("One. Two").map((c) => c.breakAfter), [true, true]);
});

test("stream keeps the text's own line breaks and wraps each line on its own", () => {
  const texts = (t: Term) => t.steps.map((s) => s.text);
  assert.deepEqual(texts(new Term(0).stream("Use OAuth instead.\nSource: https://example.com/docs")), [
    "Use OAuth instead.",
    "Source: https://example.com/docs",
  ]);
  assert.deepEqual(texts(new Term(0).stream("one two three\n\nfour", { width: 8 })), ["one two", "three", "", "four"]);
});

test("newlines at the start and end of streamed text add no step and no time", () => {
  const plain = new Term(0).stream("Answer").out("next");
  const padded = new Term(0).stream("\n\nAnswer\n").out("next");
  assert.deepEqual(padded.steps, plain.steps);
});

test("blank streamed text adds no step and no time", () => {
  for (const blank of ["", "\n", "\n\n", "  \n "]) {
    const t = new Term(0).stream(blank);
    assert.deepEqual(t.steps, [], JSON.stringify(blank));
    assert.equal(t.cursor, new Term(0).cursor);
  }
});

const DOC = { a: 1, results: [{ t: "x", u: "y", z: [1, 2] }, { t: "w", u: "v" }], w: [] };

test("a JSON view that keeps everything is JSON.stringify", () => {
  assert.deepEqual(jsonView(DOC, () => true).lines, JSON.stringify(DOC, null, 2).split("\n"));
});

test("dropped runs collapse and kept lines are verbatim", () => {
  const keep = new Set([[], ["results"], ["results", 0], ["results", 0, "t"], ["results", 1], ["results", 1, "u"]].map((p) => JSON.stringify(p)));
  const view = jsonView(DOC, (p: JsonPath) => keep.has(JSON.stringify(p)));
  const full = JSON.stringify(DOC, null, 2).split("\n");
  assert.deepEqual(view.lines, [
    "{",
    "  ...",
    '  "results": [',
    "    {",
    '      "t": "x",',
    "      ...",
    "    },",
    "    {",
    "      ...",
    '      "u": "v"',
    "    }",
    "  ],",
    "  ...",
    "}",
  ]);
  assert.ok(view.lines.every((ln) => ln.trim() === "..." || full.includes(ln)));
  assert.equal(view.lines[view.line("results", 0, "t")], '      "t": "x",');
});

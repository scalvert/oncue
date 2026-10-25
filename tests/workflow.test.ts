/** `next` (what a video needs, and who does it) and `review` (the approver's page). */
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assess } from "../src/release/status.ts";
import { next } from "../src/workflow/next.ts";
import { reviewPage, wordsToCheck } from "../src/workflow/review.ts";
import { newVideo } from "../src/workspace/scaffold.ts";
import { Workspace } from "../src/workspace/workspace.ts";
import { exampleConfig, exampleRoot, tempDir, writeFile } from "./helpers.ts";

/** A copy of the example repo with no renders and no release state. */
function copy(): Workspace {
  const root = join(tempDir(), "repo");
  cpSync(exampleRoot, root, { recursive: true, filter: (s) => !/[\\/](node_modules|renders)([\\/]|$)/.test(s) });
  for (const f of ["registry.json", "versions.json"]) rmSync(join(root, f), { force: true });
  return new Workspace(root, exampleConfig);
}
const hello = (ws: Workspace) => ws.projects().find((p) => p.name === "hello")!;
const stageOf = async (ws: Workspace, name: string) => {
  const p = ws.projects().find((x) => x.name === name)!;
  const state = (await assess(ws, { offline: true })).find((s) => s.id === p.id);
  return next(ws, p, state);
};

test("a new video starts with the person describing it and approving a script", async () => {
  const ws = copy();
  newVideo(ws, { folder: "intro", id: "intro", title: "Intro", track: ws.catalog().tracks[0]!.id });
  const r = await stageOf(ws, "intro");
  assert.equal(r.stage, "script");
  assert.deepEqual(r.steps.map((s) => s.who), ["person", "agent", "person"]);
});

test("a changed script needs a new take; the placeholder voice needs no OK or key", async () => {
  const ws = copy();
  appendFileSync(hello(ws).tsv, "s9\tOne more line.\n");
  const r = await stageOf(ws, "hello");
  assert.equal(r.stage, "narrate");
  assert.match(r.summary, /the script changed/);
  const narrate = r.steps.find((s) => s.command?.includes("narrate hello"))!;
  assert.equal(narrate.command, "oncue narrate hello"); // as is, no backticks
  assert.ok(!narrate.ask);
  assert.ok(!r.steps.some((s) => s.what.includes("ELEVENLABS_API_KEY")));
  assert.ok(r.later.some((l) => l.includes("placeholder")));
});

test("an unrendered video renders next; a render then goes to the person for review", async () => {
  const ws = copy();
  assert.equal((await stageOf(ws, "hello")).stage, "render");
  const p = hello(ws);
  writeFile(p.output, "mp4");
  writeFile(p.poster, "webp");
  const r = await stageOf(ws, "hello");
  assert.equal(r.stage, "review");
  assert.ok(r.steps.some((s) => s.who === "person" && /Watch and listen/.test(s.what)));
  const accept = r.steps.find((s) => s.command?.includes("registry --accept hello"))!;
  assert.equal(accept.ask, true);
});

test("words a voice often gets wrong are listed for the reviewer", () => {
  const words = wordsToCheck("[upbeat] Use the X A A flow with the ID-JAG profile. OAuth and the API are next. Hello there.");
  for (const w of ["X A A", "ID-JAG", "OAuth", "API"]) assert.ok(words.includes(w), w);
  for (const w of ["upbeat", "Hello", "Use"]) assert.ok(!words.includes(w), w);
});

test("the review page has the render, each scene, and a way to send feedback", () => {
  const ws = copy();
  const p = hello(ws);
  writeFile(p.output, "mp4");
  const html = reviewPage(ws, p);
  assert.match(html, /<video[^>]+src="hello-final\.mp4"/);
  for (const row of readFileSync(p.tsv, "utf8").trim().split("\n")) assert.ok(html.includes(`data-scene="${row.split("\t")[0]}"`));
  assert.match(html, /Copy feedback/);
  assert.ok(existsSync(p.tsv));
});

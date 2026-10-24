/** `status`: what each video needs next, after a render or a toolkit change. */
import assert from "node:assert/strict";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dumps, update } from "../src/release/registry.ts";
import { status } from "../src/release/status.ts";
import { saveLedger, writeSidecar } from "../src/release/versions.ts";
import { Workspace } from "../src/workspace/workspace.ts";
import { exampleConfig, exampleRoot, tempDir, writeFile } from "./helpers.ts";

/** A copy of the example repo with `hello` accepted from a fake render, then the toolkit changed. */
function acceptedThenToolkitChanged() {
  const root = join(tempDir(), "repo");
  cpSync(exampleRoot, root, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes(join("dist", "media")) });
  for (const f of ["registry.json", "versions.json"]) rmSync(join(root, f), { force: true });
  const ws = new Workspace(root, exampleConfig);
  const p = ws.projects().find((x) => x.name === "hello")!;
  writeFile(p.output, "mp4 bytes");
  writeFile(p.poster, "webp bytes");
  const u = update(ws, { accept: new Set(["hello"]), duration: () => 30, transcript: () => ["Hello."] });
  writeFileSync(ws.paths.registry, dumps(u.data));
  // The accepted version was rendered by an older toolkit: its fingerprint no longer matches.
  const ledger = u.ledger;
  ledger.videos.hello![0]!.fingerprint = { inputs: "old-inputs", renderer: "old-renderer" };
  saveLedger(ledger, ws.paths.ledger);
  return { ws, p };
}

async function rows(ws: Workspace): Promise<string[]> {
  const out: string[] = [];
  await status(ws, { log: (l) => out.push(l) });
  return out;
}

test("a stale fingerprint with no fresh render asks for a re-render", async () => {
  const { ws } = acceptedThenToolkitChanged();
  const out = await rows(ws);
  assert.match(out.find((l) => l.startsWith("hello"))!, /re-render: inputs, renderer/);
  assert.ok(out.some((l) => l.includes("render hello")));
});

test("a fresh render with the accepted bytes says reproduced, and to record it", async () => {
  const { ws, p } = acceptedThenToolkitChanged();
  writeSidecar(ws, p); // rendered from the current sources, same files as v1
  const out = await rows(ws);
  assert.match(out.find((l) => l.startsWith("hello"))!, /reproduced, not recorded/);
  assert.ok(out.some((l) => l.includes("registry --accept hello") && l.includes("no new version")));
  assert.ok(!out.some((l) => l.includes("render hello")));
});

test("a fresh render with different bytes asks for review and accept, not another render", async () => {
  const { ws, p } = acceptedThenToolkitChanged();
  writeFile(p.output, "new mp4 bytes");
  writeSidecar(ws, p);
  const out = await rows(ws);
  assert.match(out.find((l) => l.startsWith("hello"))!, /changed: inputs, renderer; rendered\s+new render waiting/);
  assert.ok(out.some((l) => l.includes("compare <video>") && l.includes("registry --accept hello")));
  assert.ok(!out.some((l) => l.includes("render hello")));
});

test("recording the reproduction makes it up to date without a new version", async () => {
  const { ws, p } = acceptedThenToolkitChanged();
  writeSidecar(ws, p);
  const u = update(ws, { accept: new Set(["hello"]), duration: () => 30, transcript: () => ["Hello."] });
  saveLedger(u.ledger, ws.paths.ledger);
  assert.equal(u.ledger.videos.hello!.length, 1);
  assert.equal(u.ledger.videos.hello![0]!.reproducedBy?.length, 1);
  assert.match((await rows(ws)).find((l) => l.startsWith("hello"))!, /up to date/);
});

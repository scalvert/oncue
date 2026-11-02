/** `registry --same-as`: a render-code change that doesn't change a video is recorded, nothing else. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { dumps, update } from "../src/release/registry.ts";
import { sameAs } from "../src/release/same-as.ts";
import { assess, status } from "../src/release/status.ts";
import { type Fingerprint, type Ledger, saveLedger, writeSidecar } from "../src/release/versions.ts";
import { next } from "../src/workflow/next.ts";
import { Workspace } from "../src/workspace/workspace.ts";
import { exampleConfig, exampleRoot, tempDir, writeFile } from "./helpers.ts";

const OLD: Fingerprint = { inputs: "old-inputs", renderer: "old-renderer" };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * A copy of the example repo with `hello` v1 accepted ("mp4 bytes") from the old sources (OLD),
 * then the toolkit changed and `hello` re-rendered as `bytes`. Beside it, a checkout of the old
 * sources whose render is `oldBytes`, with a sidecar naming `oldFp`.
 */
function setup({ bytes = "mp4 bytes", oldBytes = "mp4 bytes", oldFp = OLD } = {}) {
  const dir = tempDir();
  const root = join(dir, "repo");
  cpSync(exampleRoot, root, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes(join("dist", "media")) });
  for (const f of ["registry.json", "versions.json"]) rmSync(join(root, f), { force: true });
  const ws = new Workspace(root, exampleConfig);
  const p = ws.projects().find((x) => x.name === "hello")!;
  writeFile(p.output, "mp4 bytes");
  writeFile(p.poster, "webp bytes");
  const u = update(ws, { accept: new Set(["hello"]), duration: () => 30, transcript: () => ["Hello."] });
  writeFileSync(ws.paths.registry, dumps(u.data));
  u.ledger.videos.hello![0]!.fingerprint = OLD;
  saveLedger(u.ledger, ws.paths.ledger);

  writeFile(p.output, bytes);
  writeSidecar(ws, p);

  const old = join(dir, "old");
  const at = (f: string) => join(old, relative(root, f));
  writeFile(at(p.output), oldBytes);
  writeFile(at(p.poster), "webp bytes");
  writeFile(at(p.sidecar), JSON.stringify({ sha256: sha256(oldBytes), posterSha256: sha256("webp bytes"), fingerprint: oldFp }));
  return { ws, p, old };
}

const ledgerOf = (ws: Workspace) => JSON.parse(readFileSync(ws.paths.ledger, "utf8")) as Ledger;
const hello = (r: ReturnType<typeof sameAs>) => r.results.find((x) => x.id === "hello")!;
const sourceOf = async (ws: Workspace) => (await assess(ws, { offline: true })).find((s) => s.id === "hello")!.source;

test("matching renders record the current sources, with what they matched, and no new version", async () => {
  const { ws, p, old } = setup();
  const r = sameAs(ws, old);
  assert.equal(hello(r).outcome, "recorded");
  saveLedger(r.ledger, ws.paths.ledger);

  const versions = ledgerOf(ws).videos.hello!;
  assert.equal(versions.length, 1);
  const entry = versions[0]!.reproducedBy!.at(-1)!;
  assert.deepEqual(entry.sameAs, OLD);
  const now = (JSON.parse(readFileSync(p.sidecar, "utf8")) as { fingerprint: Fingerprint }).fingerprint;
  assert.deepEqual({ inputs: entry.inputs, renderer: entry.renderer }, now);
  assert.equal(await sourceOf(ws), "up-to-date");

  // Running it again records nothing more.
  assert.equal(hello(sameAs(ws, old)).outcome, "current");
});

test("the renders need to match each other, not the accepted bytes", async () => {
  // Another machine renders old and new alike, but not as the accepted "mp4 bytes".
  const { ws, old } = setup({ bytes: "other bytes", oldBytes: "other bytes" });
  assert.equal(await sourceOf(ws), "rendered");
  const r = sameAs(ws, old);
  assert.equal(hello(r).outcome, "recorded");
  saveLedger(r.ledger, ws.paths.ledger);
  assert.equal(await sourceOf(ws), "up-to-date");
  // The local bytes differ from v1 because of the machine, so nothing asks to accept them.
  const state = (await assess(ws, { offline: true })).find((s) => s.id === "hello")!;
  assert.equal(state.renderWaiting, false);
  const out: string[] = [];
  await status(ws, { offline: true, log: (l) => out.push(l) });
  assert.ok(!out.some((l) => l.includes("registry --accept hello")));
  assert.ok(!update(ws, { writeMedia: false, duration: () => 30 }).pending.includes("hello"));
});

test("renders that differ are skipped, and nothing is recorded", () => {
  const { ws, old } = setup({ bytes: "new bytes" });
  const r = sameAs(ws, old);
  assert.equal(hello(r).outcome, "skipped");
  assert.match(hello(r).reason!, /renders differ \(MP4\)/);
  assert.equal(r.ledger.videos.hello![0]!.reproducedBy, undefined);
  assert.ok(update(ws, { writeMedia: false, duration: () => 30 }).pending.includes("hello"), "still pending review");
});

test("a render from sources not known to produce the accepted version is skipped", () => {
  const { ws, old } = setup({ oldFp: { inputs: "other", renderer: "other" } });
  const r = hello(sameAs(ws, old));
  assert.equal(r.outcome, "skipped");
  assert.match(r.reason!, /isn't from sources known to produce v1/);
});

test("a render here that isn't from the current sources is skipped", () => {
  const { ws, p, old } = setup();
  writeFile(p.output, "edited after rendering");
  const r = hello(sameAs(ws, old));
  assert.equal(r.outcome, "skipped");
  assert.match(r.reason!, /isn't from the current sources/);
});

test("when only the render code changed, status and next say to check with --same-as before review", async () => {
  const { ws, p } = setup({ bytes: "other bytes" });
  // v1 came from these inputs; only the renderer differs.
  const now = (JSON.parse(readFileSync(p.sidecar, "utf8")) as { fingerprint: Fingerprint }).fingerprint;
  const ledger = ledgerOf(ws);
  ledger.videos.hello![0]!.fingerprint = { inputs: now.inputs, renderer: "old-renderer" };
  saveLedger(ledger, ws.paths.ledger);

  const out: string[] = [];
  await status(ws, { offline: true, log: (l) => out.push(l) });
  assert.ok(out.some((l) => l.includes("registry --same-as <old checkout>") && l.includes("1 changed only by render code")));

  const state = (await assess(ws, { offline: true })).find((s) => s.id === "hello");
  const r = next(ws, p, state);
  assert.equal(r.stage, "review");
  assert.match(r.steps[0]!.command!, /registry --same-as/);
  assert.ok(r.steps.some((s) => s.who === "person" && /Watch and listen/.test(s.what)), "review still follows if they differ");
});

test("it needs another checkout, not this one", () => {
  const { ws } = setup();
  assert.throws(() => sameAs(ws, ws.root), /another checkout/);
});

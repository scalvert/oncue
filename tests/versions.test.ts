/** Versions: numbered per accepted render, fingerprinted, and never rewritten. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { update } from "../src/release/registry.ts";
import {
  inputsFingerprint,
  knownFingerprints,
  latest,
  loadLedger,
  type Media,
  record,
  sidecarFingerprint,
  versionOf,
} from "../src/release/versions.ts";
import { repo, sandbox, tempDir, writeFile } from "./helpers.ts";

function media(tag: string): Media {
  const sha = tag.repeat(64).slice(0, 64);
  return { file: `x.${sha.slice(0, 10)}.mp4`, sha256: sha, poster: `x.${sha.slice(0, 10)}.webp`, posterSha256: sha, bytes: 1, width: 1920, height: 1080 };
}

test("versions count up only when the files change", () => {
  const { ws } = sandbox();
  const p = ws.projects()[0]!;
  const ledger = loadLedger(ws.paths.ledger);
  assert.equal(record(ws, ledger, p, media("a"), null, "first"), 1);
  assert.equal(record(ws, ledger, p, media("a"), null, "same files"), 1);
  assert.equal(record(ws, ledger, p, media("b"), { inputs: "i", renderer: "r" }, "second"), 2);
  assert.deepEqual(ledger.videos[p.id]!.map((v) => v.version), [1, 2]);
  assert.equal(versionOf(ledger, p.id, media("a").sha256, media("a").posterSha256), 1);
  assert.equal(latest(ledger, p.id, media("b").sha256, media("b").posterSha256)!.note, "second");
});

test("a sidecar fingerprint applies only to the files it describes", () => {
  const sidecar = writeFile(join(tempDir(), "render.json"), JSON.stringify({ sha256: "a", posterSha256: "b", fingerprint: { inputs: "i" } }));
  assert.deepEqual(sidecarFingerprint(sidecar, "a", "b"), { inputs: "i" });
  assert.equal(sidecarFingerprint(sidecar, "a", "other"), null);
});

test("accepting records a version and the registry carries it", () => {
  const { ws, dir } = sandbox();
  const d = join(dir, "renders");
  for (const id of ws.catalog().order) {
    writeFile(join(d, "videos", `${id}.mp4`), `mp4 ${id}`);
    writeFile(join(d, "posters", `${id}.webp`), `webp ${id}`);
  }
  const u = update(ws, { mediaFrom: d, acceptAll: true, duration: () => 60, prior: { videos: [] } as never, note: "test" });
  assert.deepEqual(new Set(u.data.videos.map((v) => v.version)), new Set([1]));
  for (const history of Object.values(u.ledger.videos)) {
    assert.equal(history[0]!.note, "test");
    assert.equal(history[0]!.fingerprint, null);
  }
});

test("the inputs fingerprint changes with the props", () => {
  const { ws } = sandbox();
  const p = ws.projects()[0]!;
  writeFile(p.propsPath, '{"a": 1}');
  const one = inputsFingerprint(p);
  writeFile(p.propsPath, '{"a": 2}');
  assert.notEqual(inputsFingerprint(p), one);
  assert.ok(!p.propsPath.startsWith(repo.paths.public), "the sandbox must not write to composer/public");
});

test("the same files from new sources are recorded as reproductions", () => {
  const { ws } = sandbox();
  const p = ws.projects()[0]!;
  const ledger = loadLedger(ws.paths.ledger);
  record(ws, ledger, p, media("a"), { inputs: "i1", renderer: "r1" }, null);
  assert.equal(record(ws, ledger, p, media("a"), { inputs: "i1", renderer: "r2" }, null), 1);
  assert.equal(record(ws, ledger, p, media("a"), { inputs: "i1", renderer: "r2" }, null), 1);
  assert.deepEqual(knownFingerprints(ledger.videos[p.id]![0]!), [
    { inputs: "i1", renderer: "r1" },
    { inputs: "i1", renderer: "r2" },
  ]);
});

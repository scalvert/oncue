/** The example's projects: every video is valid, locked, and clean. The CI gate in test form. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../src/checks/checks.ts";
import { dumps, update } from "../src/release/registry.ts";
import { loadLedger, versionOf } from "../src/release/versions.ts";
import { loadRegistry } from "../src/release/registry.ts";
import { readFileSync } from "node:fs";
import { repo } from "./helpers.ts";

test("every project passes the static checks", () => {
  assert.deepEqual(check(repo, repo.projects()).errors, []);
});

test("catalog order lists every project", () => {
  assert.deepEqual(repo.projects().map((p) => p.id).sort(), [...repo.catalog().order].sort());
});

test("the committed registry is current (oncue registry --check)", () => {
  assert.equal(dumps(update(repo, { writeMedia: false }).data), readFileSync(repo.paths.registry, "utf8"));
});

test("the committed versions cover the registry", () => {
  const ledger = loadLedger(repo.paths.ledger);
  for (const v of loadRegistry(repo.paths.registry)!.videos) {
    assert.equal(versionOf(ledger, v.id, v.media.sha256, v.media.posterSha256), v.version, v.id);
  }
});

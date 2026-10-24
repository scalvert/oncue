import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "node:test";
import { loadConfig, resolveConfig } from "../src/config/load.ts";
import { Workspace } from "../src/workspace/workspace.ts";

/** The example repo (examples/acme): tests that check real projects read it, and never write to it. */
export const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "acme");
export const exampleConfig = resolveConfig(await loadConfig(exampleRoot));
export const repo = new Workspace(exampleRoot, exampleConfig);

/** A temporary directory, removed when the test file finishes. */
export function tempDir(prefix = "oncue-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeFile(path: string, data: string | Uint8Array): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

/**
 * The example's catalog and projects, but release state (media, ledger, registry, public) in a
 * temporary directory, so registry and version tests can write freely.
 */
export function sandbox(): { ws: Workspace; dir: string } {
  const dir = tempDir();
  const ws = new Workspace(repo.root, exampleConfig, {
    media: join(dir, "dist-media"),
    ledger: join(dir, "versions.json"),
    registry: join(dir, "registry.json"),
    public: join(dir, "public"),
  });
  return { ws, dir };
}

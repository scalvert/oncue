import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { run } from "./exec.ts";

/** HEAD's short hash, with "+dirty" when `paths` have uncommitted changes. */
export function commitLabel(root: string, paths: string[]): string {
  const head = run("git", ["rev-parse", "--short=10", "HEAD"], { cwd: root, check: false }).stdout.trim();
  const dirty = run("git", ["status", "--porcelain", "--", ...paths], { cwd: root, check: false }).stdout.trim();
  return head + (dirty ? "+dirty" : "");
}

/** Every file under `dir`, recursively (absolute paths, sorted). */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

/**
 * Files git would commit under `path`: tracked plus untracked-but-not-ignored. Without git (the
 * Docker image has no .git), every file outside the ignored folders.
 */
export function committableFiles(root: string, path: string): string[] {
  const r = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", path], { cwd: root, check: false });
  if (r.status === 0) {
    return r.stdout
      .split("\0")
      .filter(Boolean)
      .map((f) => join(root, f))
      .filter((f) => existsSync(f) && statSync(f).isFile());
  }
  const ignored = new Set(["raw", "renders", "__pycache__", "node_modules"]);
  return walk(path).filter((f) => !relative(root, f).split(sep).some((part) => ignored.has(part)));
}

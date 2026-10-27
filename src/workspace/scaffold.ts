/**
 * `init` and `new`: a starter repo, and a video in it, from the package's templates (or the repo's
 * own video template, config `paths.videoTemplate`).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fail } from "../core/errors.ts";
import { dumps } from "../core/json.ts";
import { packageRoot } from "../core/program.ts";
import { pyRepr } from "../core/text.ts";
import { installSkills, skillStates } from "./skills.ts";
import type { Workspace } from "./workspace.ts";

/** Template files npm would drop or rewrite are stored under these names. */
const RENAMES: Record<string, string> = { _gitignore: ".gitignore", "_env.example": ".env.example" };

const today = () => new Date().toLocaleDateString("sv-SE");

/**
 * Copy templates/repo into `dir`, never overwriting a file that's there. Returns the files it
 * wrote, relative to `dir`.
 */
export function initRepo(dir: string, name = basename(resolve(dir))): string[] {
  const src = join(packageRoot(), "templates", "repo");
  const out: string[] = [];
  const copy = (from: string, to: string) => {
    for (const entry of readdirSync(from)) {
      const f = join(from, entry);
      const t = join(to, RENAMES[entry] ?? entry);
      if (statSync(f).isDirectory()) {
        mkdirSync(t, { recursive: true });
        copy(f, t);
      } else if (!existsSync(t)) {
        writeFileSync(t, readFileSync(f, "utf8").replaceAll("__NAME__", name));
        out.push(relative(dir, t));
      }
    }
  };
  mkdirSync(dir, { recursive: true });
  copy(src, dir);
  // The agent skills, unless the repo has them already: `oncue skills` refreshes them.
  if (skillStates(dir).every((s) => s.state === "missing")) out.push(...installSkills(dir));
  for (const d of ["projects", "public"]) mkdirSync(join(dir, d), { recursive: true });
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) {
    // ES modules, so Node runs the TypeScript config and build scripts without a warning.
    writeFileSync(pkg, dumps({ name: basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, "-"), private: true, type: "module" }, { indent: 2 }) + "\n");
    out.push("package.json");
  } else if (canSetModuleType(dir)) {
    // A fresh repo (npm init, then npm install) has a package.json with no type yet.
    const meta = JSON.parse(readFileSync(pkg, "utf8")) as Record<string, unknown>;
    writeFileSync(pkg, JSON.stringify({ ...meta, type: "module" }, null, 2) + "\n");
    out.push("package.json");
  }
  return out.sort();
}

/**
 * Whether setting `"type": "module"` is safe: package.json has no type, no `main`, and the folder
 * has no top-level JavaScript (which the change could break).
 */
function canSetModuleType(dir: string): boolean {
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { type?: string; main?: string };
  if (meta.type) return false;
  if (meta.main && existsSync(join(dir, meta.main))) return false;
  return !readdirSync(dir).some((f) => /\.(c?js|jsx)$/.test(f));
}

/** Whether the repo's package.json makes .ts files ES modules (else Node warns on every run). */
export function isEsmRepo(dir: string): boolean {
  const pkg = join(dir, "package.json");
  return existsSync(pkg) && (JSON.parse(readFileSync(pkg, "utf8")) as { type?: string }).type === "module";
}

export interface NewVideo {
  folder: string;
  id: string;
  title: string;
  track: string;
}

/** Scaffold projects/<folder> from the video template and add it to the catalog order. */
export function newVideo(ws: Workspace, o: NewVideo): string {
  const dst = join(ws.paths.projects, o.folder);
  if (existsSync(dst)) fail(`${dst} already exists`);
  const cat = ws.catalog();
  if (!cat.tracks.some((t) => t.id === o.track)) fail(`unknown track ${pyRepr(o.track)}; tracks: ${pyRepr(cat.tracks.map((t) => t.id))}`);
  cpSync(ws.paths.videoTemplate, dst, { recursive: true });
  const metaPath = join(dst, "video.json");
  const meta = { ...JSON.parse(readFileSync(metaPath, "utf8")), id: o.id, title: o.title, track: o.track, updated: today() };
  writeFileSync(metaPath, dumps(meta, { indent: 2, ensureAscii: false }) + "\n");
  for (const f of ["build.ts", "STORYBOARD.md"]) {
    const p = join(dst, f);
    if (existsSync(p)) writeFileSync(p, readFileSync(p, "utf8").replaceAll("__FOLDER__", o.folder).replaceAll("__TITLE__", o.title));
  }
  if (!cat.order.includes(o.id)) {
    cat.order.push(o.id);
    writeFileSync(ws.catalogFile, dumps(cat, { indent: 2, ensureAscii: false }) + "\n");
  }
  return dst;
}

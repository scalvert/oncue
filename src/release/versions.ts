/**
 * Versions: which accepted render each video is on, and what it needs next.
 *
 * versions.json (committed, append-only) lists every accepted render of every video:
 *
 *   {"version": 2, "accepted": "2026-10-06", "file": ..., "sha256": ..., "poster": ..., "posterSha256": ...,
 *    "renderer": "frame_render", "fingerprint": {"inputs": ..., "renderer": ...}, "commit": ..., "note": ...}
 *
 * A new version is recorded when `registry --accept` pins a different MP4 or poster.
 * registry.json carries each video's current `version`.
 *
 * The fingerprint says what went into a render:
 *   inputs    <public>/<video>/: props.json (every word, timing, layout and theme value), the
 *             narration, captures, and assets
 *   renderer  oncue's composition and runtime, the render page, bundled fonts, src/render/, the
 *             oncue version, the installed React, esbuild and Playwright (so Chromium) versions,
 *             and the repo's own composition folder if the config names one
 * `render` writes it next to the MP4 (<name>-final.render.json); accepting copies it into the
 * version if the hashes there match the files being accepted.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { sha256File } from "../core/files.ts";
import { commitLabel, walk } from "../core/git.ts";
import { dumps, jsonEqual, readJson } from "../core/json.ts";
import { packageRoot, packageVersion } from "../core/program.ts";
import type { Project } from "../workspace/project.ts";
import type { Workspace } from "../workspace/workspace.ts";

/** What decides a video's pixels and sound in the package: [directory, recursive], and single files. */
const RENDERER_DIRS: [string, boolean][] = [
  ["composition/src", true],
  ["composition/public/fonts/google", false],
  ["src/render", true],
  ["dist/src/render", true],
];
const RENDERER_SINGLE = ["composition/render/entry.tsx", "composition/render/index.html"];
const PINNED_PACKAGES = ["react", "react-dom", "scheduler", "esbuild", "playwright", "playwright-core"];

export interface Fingerprint {
  inputs: string | null;
  renderer: string;
}

export interface Version {
  version: number;
  accepted: string;
  file: string;
  sha256: string;
  poster: string;
  posterSha256: string;
  renderer: string;
  fingerprint: Fingerprint | null;
  commit: string;
  note: string | null;
  reproducedBy?: (Fingerprint & { date: string; commit: string })[];
}

export interface Ledger {
  $comment?: string;
  videos: Record<string, Version[]>;
}

export interface Media {
  file: string;
  poster: string;
  sha256: string;
  posterSha256: string;
  bytes: number;
  width: number;
  height: number;
}

/** Order-independent digest of (name, value) pairs. */
function digest(entries: [string, string][]): string {
  const h = createHash("sha256");
  const sorted = [...entries].sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  for (const [name, value] of sorted) h.update(`${name}\0${value}\n`);
  return h.digest("hex").slice(0, 16);
}

const posix = (root: string, f: string) => relative(root, f).split(sep).join("/");

/** The installed version of a package oncue depends on, found the way Node would from oncue. */
function installedVersion(name: string): string {
  for (let d = packageRoot(); ; d = dirname(d)) {
    const pkg = join(d, "node_modules", name, "package.json");
    if (existsSync(pkg)) return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
    if (dirname(d) === d) return "?";
  }
}

export function rendererFingerprint(ws: Workspace): string {
  const pkg = packageRoot();
  const entries: [string, string][] = [];
  const add = (root: string, label: string, dirs: [string, boolean][], single: string[] = []) => {
    const files = new Set<string>();
    for (const [dir, recursive] of dirs) {
      const abs = join(root, dir);
      for (const f of walk(abs)) if (recursive || relative(abs, f).split(sep).length === 1) files.add(f);
    }
    for (const f of single) if (existsSync(join(root, f))) files.add(join(root, f));
    for (const f of files) entries.push([`${label}${posix(root, f)}`, sha256File(f)]);
  };
  add(pkg, "oncue:", RENDERER_DIRS, RENDERER_SINGLE);
  if (ws.config.composition) add(ws.root, "", [[dirname(ws.config.composition), true]]);
  entries.push(["oncue", packageVersion()], ...PINNED_PACKAGES.map((n): [string, string] => [`npm:${n}`, installedVersion(n)]));
  return digest(entries);
}

export function inputsFingerprint(p: Project): string | null {
  if (!existsSync(p.propsPath)) return null;
  const files = walk(p.publicDir).filter((f) => !posix(p.publicDir, f).split("/").at(-1)!.startsWith("."));
  return digest(files.map((f) => [posix(p.publicDir, f), sha256File(f)]));
}

export function fingerprint(ws: Workspace, p: Project): Fingerprint {
  return { inputs: inputsFingerprint(p), renderer: rendererFingerprint(ws) };
}

/** Every source fingerprint shown to produce this version's exact files, newest last. */
export function knownFingerprints(version: Partial<Version>): Fingerprint[] {
  const fps = version.fingerprint ? [version.fingerprint] : [];
  return [...fps, ...(version.reproducedBy ?? []).map((r) => ({ inputs: r.inputs, renderer: r.renderer }))];
}

const commit = (ws: Workspace) => commitLabel(ws.root, [ws.config.paths.projects, ws.config.paths.catalog, ...(ws.config.composition ? [dirname(ws.config.composition)] : [])]);
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time

/** Local time with offset, to the second (what Python's isoformat(timespec="seconds") gives). */
function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

// ---- Render sidecar -------------------------------------------------------------------------

/** After `gv render`: what this MP4 and poster were made from. */
export function writeSidecar(ws: Workspace, p: Project): void {
  const data = {
    sha256: sha256File(p.output),
    posterSha256: sha256File(p.poster),
    fingerprint: fingerprint(ws, p),
    rendered: nowIso(),
    commit: commit(ws),
  };
  writeFileSync(p.sidecar, JSON.stringify(data, null, 2) + "\n");
}

/** The fingerprint a sidecar gives these exact files, or null if it's missing or describes other files. */
export function sidecarFingerprint(sidecar: string, sha: string, posterSha: string): Fingerprint | null {
  if (!existsSync(sidecar)) return null;
  const data = readJson<{ sha256?: string; posterSha256?: string; fingerprint?: Fingerprint }>(sidecar);
  if (data.sha256 !== sha || data.posterSha256 !== posterSha) return null;
  return data.fingerprint ?? null;
}

// ---- Ledger ---------------------------------------------------------------------------------

/** The ledger at `path`, or a new one with `comment` (config `ledger.comment`). */
export function loadLedger(path: string, comment = ""): Ledger {
  return existsSync(path) ? readJson<Ledger>(path) : { $comment: comment, videos: {} };
}

export function saveLedger(data: Ledger, path: string): void {
  writeFileSync(path, dumps(data, { indent: 2, ensureAscii: false }) + "\n");
}

export function versionOf(ledger: Ledger, videoId: string, sha: string, posterSha: string): number | null {
  const history = ledger.videos[videoId] ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.sha256 === sha && history[i]!.posterSha256 === posterSha) return history[i]!.version;
  }
  return null;
}

export function latest(ledger: Ledger, videoId: string, sha: string, posterSha: string): Version | null {
  const n = versionOf(ledger, videoId, sha, posterSha);
  return (ledger.videos[videoId] ?? []).find((v) => v.version === n) ?? null;
}

/** Append a version for these files unless the latest version already is them. Returns its number. */
export function record(ws: Workspace, ledger: Ledger, p: Project, media: Media, fp: Fingerprint | null, note: string | null): number {
  const history = (ledger.videos[p.id] ??= []);
  const last = history.at(-1);
  if (last && last.sha256 === media.sha256 && last.posterSha256 === media.posterSha256) {
    // Same bytes from different sources (e.g. a renderer change that doesn't touch this video):
    // record that those sources reproduce this version, so `status` counts them as current.
    const reproduced = (last.reproducedBy ?? []).map((r) => ({ inputs: r.inputs, renderer: r.renderer }));
    if (fp && !jsonEqual(fp, last.fingerprint) && !reproduced.some((r) => jsonEqual(r, fp))) {
      (last.reproducedBy ??= []).push({ ...fp, date: today(), commit: commit(ws) });
    }
    return last.version;
  }
  const n = last ? last.version + 1 : 1;
  history.push({
    version: n,
    accepted: today(),
    file: media.file,
    sha256: media.sha256,
    poster: media.poster,
    posterSha256: media.posterSha256,
    renderer: "frame_render",
    fingerprint: fp,
    commit: commit(ws),
    note,
  });
  return n;
}

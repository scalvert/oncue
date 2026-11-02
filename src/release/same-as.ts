/**
 * `registry --same-as <dir>`: record that the current sources still produce each accepted version,
 * because they render the same bytes as another checkout whose sources are known to.
 *
 * A change to oncue's render code changes every video's renderer fingerprint, so `status` asks to
 * re-render every video, even when no pixel changed. The accepted bytes can't always settle it:
 * another machine or OS version can move a few pixels of text for old and new code alike. What
 * can settle it is rendering with the old sources and the new ones on one machine and comparing.
 *
 * <dir> is a checkout of the old sources (a worktree of the base branch, say) with renders. For
 * each video in the registry, the current fingerprint is recorded in the accepted version's
 * `reproducedBy`, with `sameAs` naming the fingerprint it matched, only when:
 *
 *   here   the render was made from the current sources (its sidecar says so)
 *   there  the render at the same path was made from sources already known to produce the
 *          accepted version: its fingerprint, or one in reproducedBy
 *   both   the MP4s and the posters are byte-identical
 *
 * Nothing else changes: no new version, and registry.json and dist/media stay as they are.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fail } from "../core/errors.ts";
import { sha256File } from "../core/files.ts";
import { jsonEqual } from "../core/json.ts";
import { cmd } from "../core/program.ts";
import type { Workspace } from "../workspace/workspace.ts";
import { loadRegistry } from "./registry.ts";
import {
  type Fingerprint,
  inputsFingerprint,
  knownFingerprints,
  latest,
  type Ledger,
  loadLedger,
  recordSameAs,
  rendererFingerprint,
  sidecarFingerprint,
} from "./versions.ts";

export interface SameAsResult {
  id: string;
  folder: string;
  /** recorded: added to reproducedBy. current: already known. skipped: see reason. */
  outcome: "recorded" | "current" | "skipped";
  version: number | null;
  reason?: string;
}

/** A render's files and the fingerprint its sidecar gives them (null if missing or stale). */
function render(output: string, poster: string, sidecar: string): { sha: string; posterSha: string; fp: Fingerprint | null } | null {
  if (!existsSync(output) || !existsSync(poster)) return null;
  const sha = sha256File(output);
  const posterSha = sha256File(poster);
  return { sha, posterSha, fp: sidecarFingerprint(sidecar, sha, posterSha) };
}

/** Check every registry video against `other`; the ledger comes back with what was recorded. */
export function sameAs(ws: Workspace, other: string): { ledger: Ledger; results: SameAsResult[] } {
  const root = resolve(other);
  if (!existsSync(root)) fail(`--same-as: ${other} doesn't exist`);
  if (root === resolve(ws.root)) fail("--same-as needs another checkout (of the old sources), not this one");
  const data = loadRegistry(ws.paths.registry);
  if (!data) fail(`no ${relative(ws.root, ws.paths.registry)}: nothing is accepted yet`);
  const ledger = loadLedger(ws.paths.ledger, ws.config.ledger.comment);
  const projects = new Map(ws.projects().map((p) => [p.id, p]));
  const renderer = rendererFingerprint(ws);
  const there = (path: string) => join(root, relative(ws.root, path));

  const results: SameAsResult[] = [];
  for (const v of data.videos) {
    const p = projects.get(v.id);
    if (!p) fail(`registry.json lists ${v.id}, which has no project`);
    const version = latest(ledger, v.id, v.media.sha256, v.media.posterSha256);
    const r: SameAsResult = { id: v.id, folder: p.name, outcome: "skipped", version: version?.version ?? null };
    results.push(r);
    const skip = (reason: string) => void (r.reason = reason);
    if (!version) {
      skip("its accepted files aren't in versions.json");
      continue;
    }
    const now: Fingerprint = { inputs: inputsFingerprint(p), renderer };
    const known = knownFingerprints(version);
    if (known.some((k) => jsonEqual(k, now))) {
      r.outcome = "current";
      continue;
    }
    const here = render(p.output, p.poster, p.sidecar);
    if (!here) {
      skip(`no render here: ${cmd(`render ${p.name}`)}`);
      continue;
    }
    if (!here.fp || !jsonEqual(here.fp, now)) {
      skip(`the render here isn't from the current sources: ${cmd(`render ${p.name}`)}`);
      continue;
    }
    const old = render(there(p.output), there(p.poster), there(p.sidecar));
    if (!old) {
      skip(`no render at ${there(p.output)}`);
      continue;
    }
    if (!old.fp) {
      skip("the render there has no sidecar for its files");
      continue;
    }
    if (!known.some((k) => jsonEqual(k, old.fp))) {
      skip(`the render there isn't from sources known to produce v${version.version}`);
      continue;
    }
    if (old.sha !== here.sha || old.posterSha !== here.posterSha) {
      skip(`the renders differ (${old.sha !== here.sha ? "MP4" : "poster"}): compare them; accepting a new version needs a person's review`);
      continue;
    }
    if (recordSameAs(ws, version, now, old.fp)) r.outcome = "recorded";
    else r.outcome = "current";
  }
  return { ledger, results };
}

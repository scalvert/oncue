/**
 * `status`: per video, which version is accepted and what it needs next.
 *
 *     VIDEO        VER  SOURCE                 RENDER          DEPLOY        SITE
 *     platform-why v2   up to date             -               deployed      v2
 *     hitl-agent   v2   re-render: inputs      -               deployed      v1 (behind)
 *     ema          v2   up to date             -               held: legal   -
 *
 * SOURCE compares the accepted version's fingerprint with the current sources (props are rebuilt
 * first): `inputs` changed means this video's script, narration, captures, or props did;
 * `renderer` means the shared composition or render code did. "reproduced" means the render in
 * projects/ came from the current sources and has the accepted bytes: nothing needs re-rendering,
 * and accepting it records that (no new version). RENDER flags a render in projects/
 * that isn't accepted yet. DEPLOY checks the media host for the version's files. SITE (--site)
 * reads the registry snapshot the site last synced (config `site`, read with `gh`).
 */
import { existsSync } from "node:fs";
import { fail } from "../core/errors.ts";
import { run } from "../core/exec.ts";
import { sha256File } from "../core/files.ts";
import { jsonEqual } from "../core/json.ts";
import { cmd } from "../core/program.ts";
import type { Workspace } from "../workspace/workspace.ts";
import { heldBy, loadRegistry, type Registry } from "./registry.ts";
import {
  type Fingerprint,
  inputsFingerprint,
  knownFingerprints,
  latest,
  loadLedger,
  rendererFingerprint,
  sidecarFingerprint,
  versionOf,
} from "./versions.ts";

async function exists(url: string): Promise<boolean> {
  const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`HEAD ${url}: HTTP ${r.status}`);
  return true;
}

function siteRegistry(site: { repo: string; snapshot: string }): Registry | null {
  const r = run("gh", ["api", `repos/${site.repo}/contents/${site.snapshot}`, "-H", "Accept: application/vnd.github.raw"], { check: false });
  return r.status === 0 ? (JSON.parse(r.stdout) as Registry) : null;
}

export interface StatusOptions {
  /** Rebuild every project's props first, so SOURCE reflects the current scripts. */
  rebuild?: () => Promise<void>;
  site?: boolean;
  /** CI: only check that every hosted version is deployed. */
  check?: boolean;
  log?: (line: string) => void;
}

/** Whether the render in projects/ was made from the current sources (its sidecar says so). */
function freshRender(output: string, poster: string, sidecar: string, now: Fingerprint): boolean {
  if (!existsSync(output) || !existsSync(poster)) return false;
  const fp = sidecarFingerprint(sidecar, sha256File(output), sha256File(poster));
  return fp !== null && jsonEqual(fp, now);
}

/** Left-aligned columns, two spaces apart, without trailing spaces. */
export function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...r[i]!].length)));
  return rows.map((r) => r.map((x, i) => x + " ".repeat(widths[i]! - [...x].length)).join("  ").trimEnd());
}

export async function status(ws: Workspace, { rebuild, site = false, check = false, log = console.log }: StatusOptions = {}): Promise<void> {
  const data = loadRegistry(ws.paths.registry) ?? ({ videos: [] } as unknown as Registry);
  const ledger = loadLedger(ws.paths.ledger, ws.config.ledger.comment);
  const cat = ws.catalog();
  if (site && !ws.config.site) fail("--site needs `site: { repo, snapshot }` in the config");
  const base = (cat.mediaBaseUrl ?? "").replace(/\/+$/, "");
  const projects = new Map(ws.projects().map((p) => [p.id, p]));

  if (rebuild) await rebuild();
  const rendererNow = check ? null : rendererFingerprint(ws);

  const siteVer = new Map<string, string>();
  if (site) {
    for (const v of siteRegistry(ws.config.site!)?.videos ?? []) {
      const n = versionOf(ledger, v.id, v.media.sha256, v.media.posterSha256);
      siteVer.set(v.id, n ? `v${n}` : "?");
    }
  }

  const rows: string[][] = [];
  const todo = { render: [] as string[], accept: [] as string[], record: [] as string[], site: [] as string[] };
  const undeployed: string[] = [];
  const listed = new Set(data.videos.map((v) => v.id));
  for (const v of data.videos) {
    const p = projects.get(v.id);
    if (!p) fail(`registry.json lists ${v.id}, which has no project`);
    const m = v.media;
    const ver = latest(ledger, v.id, m.sha256, m.posterSha256);
    const label = ver ? `v${ver.version}` : "v?";

    let source = "-";
    if (!check) {
      const known = knownFingerprints(ver ?? {});
      if (!known.length) source = "unknown (no fingerprint)";
      else {
        const now: Fingerprint = { inputs: inputsFingerprint(p), renderer: rendererNow! };
        const fp = known.find((k) => jsonEqual(k, now)) ?? known.at(-1)!;
        const changed = (["inputs", "renderer"] as const).filter((k) => now[k] !== fp[k]);
        const fresh = freshRender(p.output, p.poster, p.sidecar, now);
        if (!changed.length) source = "up to date";
        else if (fresh && sha256File(p.output) === m.sha256 && sha256File(p.poster) === m.posterSha256) {
          source = "reproduced, not recorded";
          todo.record.push(v.id);
        } else if (fresh) {
          source = `changed: ${changed.join(", ")}; rendered`; // RENDER says what to do with it
        } else {
          source = `re-render: ${changed.join(", ")}`;
          todo.render.push(p.name);
        }
      }
    }

    let render = "-";
    if (!check && existsSync(p.output) && sha256File(p.output) !== m.sha256) {
      render = "new render waiting";
      todo.accept.push(v.id);
    }

    let deploy: string;
    if (!v.hosted) deploy = `held: ${heldBy(p.meta, ws.config.metadata.approvals).join(", ")}`;
    else if (!base) deploy = "no host yet";
    else if ((await exists(`${base}/${m.file}`)) && (await exists(`${base}/${m.poster}`))) deploy = "deployed";
    else {
      deploy = "NOT deployed";
      undeployed.push(v.id);
    }

    let live = "-";
    if (site) {
      live = siteVer.get(v.id) ?? "-";
      if (v.hosted && live !== label) {
        live = live !== "-" ? `${live} (behind)` : "not on site";
        todo.site.push(v.id);
      }
    }
    rows.push([v.id, label, String(v.visibility ?? ""), source, render, deploy, live]);
  }

  for (const [id, p] of projects) {
    if (!listed.has(id) && cat.order.includes(id)) rows.push([id, "-", String(p.meta.visibility ?? ""), "-", "never accepted", "-", "-"]);
  }

  const head = ["VIDEO", "VER", "VISIBILITY", "SOURCE", "RENDER", "DEPLOY", ...(site ? ["SITE"] : [])];
  for (const line of table([head, ...rows.map((r) => r.slice(0, head.length))])) log(line);

  if (check) {
    if (undeployed.length) fail(`\nNot on the media host: ${undeployed.join(", ")}. Run ${cmd("deploy")} (needs the token) and push again.`);
    return;
  }
  const next: string[] = [];
  if (todo.render.length) next.push(`${cmd(`render ${todo.render.join(" ")}`)}    # sources changed since the accepted version`);
  if (todo.accept.length) next.push(`${cmd("compare <video> <accepted.mp4>")}, then ${cmd(`registry --accept ${todo.accept.join(" ")} --note '...'`)}`);
  if (todo.record.length) next.push(`${cmd(`registry --accept ${todo.record.join(" ")} --note '...'`)}    # same files from the current sources: records it, no new version`);
  if (undeployed.length) next.push(cmd("deploy"));
  if (!base && data.videos.some((v) => v.hosted)) next.push(`${cmd("deploy")}    # first deploy: needs the media store's token in .env; sets mediaBaseUrl`);
  if (todo.site.length) next.push("run the site's registry sync and merge its PR");
  log(next.length ? `\nnext:\n  ${next.join("\n  ")}` : "\nEverything is up to date.");
}

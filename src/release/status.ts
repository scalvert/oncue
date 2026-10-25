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
 *
 * `assess` computes all of it as data (`status --json`, and `next` reads it); `status` prints it.
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

/** Whether the render in projects/ was made from the current sources (its sidecar says so). */
function freshRender(output: string, poster: string, sidecar: string, now: Fingerprint): boolean {
  if (!existsSync(output) || !existsSync(poster)) return false;
  const fp = sidecarFingerprint(sidecar, sha256File(output), sha256File(poster));
  return fp !== null && jsonEqual(fp, now);
}

/** One video's release state. */
export interface VideoState {
  id: string;
  /** The project folder under projects/. */
  folder: string;
  /** The accepted version, or null if it was never accepted. */
  version: number | null;
  visibility: string;
  /**
   * How the sources compare with the accepted version:
   *   up-to-date   the accepted files came from these sources
   *   reproduced   the render in projects/ came from these sources and has the accepted bytes
   *   rendered     the sources changed, and the render in projects/ is from the new sources
   *   re-render    the sources changed since the render (or there is no render)
   *   unknown      the accepted version has no fingerprint
   *   unaccepted   never accepted
   *   unchecked    `check` mode skips it
   */
  source: "up-to-date" | "reproduced" | "rendered" | "re-render" | "unknown" | "unaccepted" | "unchecked";
  /** What changed, for re-render / rendered / reproduced. */
  changed: ("inputs" | "renderer")[];
  /** Whether projects/ holds a render that isn't the accepted one. */
  renderWaiting: boolean;
  /** Whether projects/ holds a render at all. */
  rendered: boolean;
  /** deployed, missing (hosted but not on the store), held (sign-offs), no-host (never deployed), unlisted, unchecked (offline). */
  deploy: "deployed" | "missing" | "held" | "no-host" | "unlisted" | "unchecked";
  /** The sign-offs holding hosting. */
  heldBy: string[];
  /** The accepted MP4 on the media store, when there is one. */
  acceptedUrl?: string;
  /** The version the site has (--site): "v3", "?", or null when it has none. */
  site?: string | null;
}

export interface AssessOptions {
  /** Rebuild every project's props first, so `source` reflects the current scripts. */
  rebuild?: () => Promise<void>;
  site?: boolean;
  /** CI: only check that every hosted version is deployed. */
  check?: boolean;
  /** Skip the media host (no network). */
  offline?: boolean;
}

export async function assess(ws: Workspace, { rebuild, site = false, check = false, offline = false }: AssessOptions = {}): Promise<VideoState[]> {
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

  const out: VideoState[] = [];
  const listed = new Set(data.videos.map((v) => v.id));
  for (const v of data.videos) {
    const p = projects.get(v.id);
    if (!p) fail(`registry.json lists ${v.id}, which has no project`);
    const m = v.media;
    const ver = latest(ledger, v.id, m.sha256, m.posterSha256);
    const s: VideoState = {
      id: v.id,
      folder: p.name,
      version: ver?.version ?? null,
      visibility: String(v.visibility ?? ""),
      source: "unchecked",
      changed: [],
      renderWaiting: false,
      rendered: existsSync(p.output),
      deploy: "no-host",
      heldBy: [],
      ...(base && m.file ? { acceptedUrl: `${base}/${m.file}` } : {}),
    };

    if (!check) {
      const known = knownFingerprints(ver ?? {});
      if (!known.length) s.source = "unknown";
      else {
        const now: Fingerprint = { inputs: inputsFingerprint(p), renderer: rendererNow! };
        const fp = known.find((k) => jsonEqual(k, now)) ?? known.at(-1)!;
        s.changed = (["inputs", "renderer"] as const).filter((k) => now[k] !== fp[k]);
        const fresh = freshRender(p.output, p.poster, p.sidecar, now);
        if (!s.changed.length) s.source = "up-to-date";
        else if (fresh && sha256File(p.output) === m.sha256 && sha256File(p.poster) === m.posterSha256) s.source = "reproduced";
        else s.source = fresh ? "rendered" : "re-render";
      }
      s.renderWaiting = s.rendered && sha256File(p.output) !== m.sha256;
    }

    if (!v.hosted) {
      s.deploy = "held";
      s.heldBy = heldBy(p.meta, ws.config.metadata.approvals);
    } else if (!base) s.deploy = "no-host";
    else if (offline) s.deploy = "unchecked";
    else s.deploy = (await exists(`${base}/${m.file}`)) && (await exists(`${base}/${m.poster}`)) ? "deployed" : "missing";

    if (site) s.site = siteVer.get(v.id) ?? null;
    out.push(s);
  }

  for (const [id, p] of projects) {
    if (listed.has(id) || !cat.order.includes(id)) continue;
    out.push({
      id,
      folder: p.name,
      version: null,
      visibility: String(p.meta.visibility ?? ""),
      source: "unaccepted",
      changed: [],
      renderWaiting: existsSync(p.output),
      rendered: existsSync(p.output),
      deploy: "unlisted",
      heldBy: heldBy(p.meta, ws.config.metadata.approvals),
    });
  }
  return out;
}

export interface StatusOptions extends AssessOptions {
  log?: (line: string) => void;
}

/** Left-aligned columns, two spaces apart, without trailing spaces. */
export function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...r[i]!].length)));
  return rows.map((r) => r.map((x, i) => x + " ".repeat(widths[i]! - [...x].length)).join("  ").trimEnd());
}

const SOURCE_LABEL: Record<VideoState["source"], (s: VideoState) => string> = {
  "up-to-date": () => "up to date",
  reproduced: () => "reproduced, not recorded",
  rendered: (s) => `changed: ${s.changed.join(", ")}; rendered`,
  "re-render": (s) => `re-render: ${s.changed.join(", ")}`,
  unknown: () => "unknown (no fingerprint)",
  unaccepted: () => "-",
  unchecked: () => "-",
};

export async function status(ws: Workspace, o: StatusOptions = {}): Promise<VideoState[]> {
  const log = o.log ?? console.log;
  const states = await assess(ws, o);
  const site = o.site ?? false;
  const base = (ws.catalog().mediaBaseUrl ?? "").replace(/\/+$/, "");

  const rows = states.map((s) => {
    const render = s.source === "unaccepted" ? "never accepted" : s.renderWaiting ? "new render waiting" : "-";
    const deploy = { deployed: "deployed", missing: "NOT deployed", held: `held: ${s.heldBy.join(", ")}`, "no-host": "no host yet", unlisted: "-", unchecked: "not checked" }[s.deploy];
    const live = !site || s.deploy === "unlisted" ? "-" : s.deploy !== "held" && s.site !== `v${s.version}` ? (s.site ? `${s.site} (behind)` : "not on site") : (s.site ?? "-");
    return [s.id, s.version ? `v${s.version}` : s.source === "unaccepted" ? "-" : "v?", s.visibility, SOURCE_LABEL[s.source](s), render, deploy, live];
  });
  const head = ["VIDEO", "VER", "VISIBILITY", "SOURCE", "RENDER", "DEPLOY", ...(site ? ["SITE"] : [])];
  for (const line of table([head, ...rows.map((r) => r.slice(0, head.length))])) log(line);

  const undeployed = states.filter((s) => s.deploy === "missing").map((s) => s.id);
  if (o.check) {
    if (undeployed.length) fail(`\nNot on the media host: ${undeployed.join(", ")}. Run ${cmd("deploy")} (needs the token) and push again.`);
    return states;
  }
  const render = states.filter((s) => s.source === "re-render").map((s) => s.folder);
  const accept = states.filter((s) => s.renderWaiting && s.source !== "unaccepted").map((s) => s.id);
  const record = states.filter((s) => s.source === "reproduced").map((s) => s.id);
  const behind = states.filter((s) => site && s.deploy !== "held" && s.deploy !== "unlisted" && s.site !== `v${s.version}`);
  const next: string[] = [];
  if (render.length) next.push(`${cmd(`render ${render.join(" ")}`)}    # sources changed since the accepted version`);
  if (accept.length) next.push(`${cmd("compare <video> <accepted.mp4>")}, then ${cmd(`registry --accept ${accept.join(" ")} --note '...'`)}`);
  if (record.length) next.push(`${cmd(`registry --accept ${record.join(" ")} --note '...'`)}    # same files from the current sources: records it, no new version`);
  if (undeployed.length) next.push(cmd("deploy"));
  if (!base && states.some((s) => s.deploy === "no-host")) next.push(`${cmd("deploy")}    # first deploy: needs the media store's token in .env; sets mediaBaseUrl`);
  if (behind.length) next.push("run the site's registry sync and merge its PR");
  log(next.length ? `\nnext:\n  ${next.join("\n  ")}` : "\nEverything is up to date.");
  return states;
}

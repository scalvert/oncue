/**
 * `check`: what must be true before a video is reviewed, merged, or released.
 *
 * Errors fail the command (and CI). Warnings print but pass. Metadata values, sign-offs, and
 * redaction rules come from the config; the secret patterns are always on.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { ApprovalKind, RedactRule } from "../config/config.ts";
import type { ResolvedConfig } from "../config/load.ts";
import { isLfsPointer, sha256File } from "../core/files.ts";
import { cmd } from "../core/program.ts";
import { committableFiles } from "../core/git.ts";
import { jsonEqual, readJson } from "../core/json.ts";
import { fixed, pyFloat } from "../core/numbers.ts";
import { pyRepr } from "../core/text.ts";
import { scanStarts, scanTails } from "../audio/scan.ts";
import { loudness, probe } from "../media/ffmpeg.ts";
import { readLock } from "../narration/lock.ts";
import { isPlaceholder } from "../narration/placeholder.ts";
import { readScript, takeText } from "../narration/script.ts";
import { type Voice, voiceForRun } from "../narration/voice.ts";
import type { Project } from "../workspace/project.ts";
import type { Catalog } from "../workspace/types.ts";
import type { Workspace } from "../workspace/workspace.ts";

const REQUIRED = ["id", "title", "summary", "track", "type", "visibility", "updated"];

/** Anything that looks like a credential, a key, or a raw (unredacted) session. Values never print. */
const SECRET_PATTERNS: Record<string, RegExp> = {
  JWT: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  "bearer token": /\bbearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  "OAuth token field": /"(access|refresh|id)_token"\s*:\s*"[A-Za-z0-9._-]{12,}/i,
  "client secret": /client_secret"?\s*[:=]\s*"?[A-Za-z0-9._-]{12,}/i,
  "OAuth code": /[?&]code=[A-Za-z0-9._-]{16,}/i,
  "API key": /(xi-api-key|api[_-]?key)"?\s*[:=]\s*"?[A-Za-z0-9]{20,}/i,
  "secret key": /\bsk[-_](live|proj|ant)?[-_]?[A-Za-z0-9_-]{20,}/,
  "private key": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  "raw agent session": /"(session_id|hook_started|thread\.started)"/,
};
/** Provenance notes (where a capture came from) may name a source; data files may not. */
const NOTE_FILES = new Set([".ts", ".md", ".mjs"]);
const BINARY = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".mp4", ".wav", ".m4a", ".woff", ".woff2", ".otf", ".ttf"]);
const SERIES_NUMBER_RE = /seriesTag["']?\s*:\s*["'`][^"'`]*\d[^"'`]*["'`]/;

export class Report {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  err(where: string, msg: string): void {
    this.errors.push(`${where}: ${msg}`);
  }
  warn(where: string, msg: string): void {
    this.warnings.push(`${where}: ${msg}`);
  }
}

const sortedStrings = (xs: Iterable<string>) => [...xs].sort();
const readLoose = (f: string) => new TextDecoder("utf-8", { fatal: false }).decode(readFileSync(f)).replace(/\uFFFD/g, "");

const globalRe = (re: RegExp) => (re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g"));

/** Secrets anywhere, and the repo's redaction rules (config `checks.redact`). */
export function scanText(rel: string, text: string, r: Report, rules: RedactRule[] = []): void {
  for (const [name, pat] of Object.entries(SECRET_PATTERNS)) {
    if (pat.test(text)) r.err(rel, `looks like it contains a ${name}. Redact it, or keep the file in capture/raw/ (git-ignored).`);
  }
  const note = NOTE_FILES.has(extname(rel));
  for (const rule of rules) {
    if (note && rule.dataFilesOnly !== false) continue;
    const t = rule.normalize ? rule.normalize(text) : text;
    const allow = new Set(rule.allow ?? []);
    const found = new Set([...t.matchAll(globalRe(rule.pattern))].map((m) => m[0]).filter((x) => !allow.has(x)));
    if (found.size) r.err(rel, rule.message(sortedStrings(found)));
  }
}

function scanFiles(ws: Workspace, dir: string, r: Report): void {
  for (const f of committableFiles(ws.root, dir)) {
    if (BINARY.has(extname(f).toLowerCase())) continue;
    scanText(relative(ws.root, f), readLoose(f), r, ws.config.checks.redact);
  }
}

function checkMeta(p: Project, cat: Catalog, c: ResolvedConfig, r: Report): void {
  const m = p.meta as unknown as Record<string, unknown>;
  const w = p.name;
  const { visibilities, types, summaryMax, approvals } = c.metadata;
  const required = Object.keys(approvals).length ? [...REQUIRED, "approvals"] : REQUIRED;
  for (const k of required) if (!(k in m)) r.err(w, `video.json is missing ${pyRepr(k)}`);
  const tracks = cat.tracks.map((t) => t.id);
  if (!tracks.includes(m.track as string)) r.err(w, `track ${pyRepr(m.track)} isn't in catalog/catalog.json (${pyRepr(sortedStrings(tracks))})`);
  const series = m.series as { id?: string } | undefined;
  if (series && !(series.id! in (cat.series ?? {}))) r.err(w, `series ${pyRepr(series.id)} isn't in catalog/catalog.json`);
  if (!visibilities.includes(m.visibility as string)) r.err(w, `visibility must be one of ${pyRepr(visibilities)}`);
  if ("gallery" in m && m.gallery !== false) r.err(w, "gallery is either absent (listed on /videos) or false (only on its doc page)");
  if (m.gallery === false && !(m.related as { doc?: string } | undefined)?.doc) {
    r.err(w, "gallery: false needs related.doc, the page that shows the video instead");
  }
  if (m.visibility === "preview" && !m.previewReason) r.err(w, "preview videos need a previewReason (what's blocking release)");
  if ([...String(m.summary ?? "")].length > summaryMax) r.err(w, `summary is over ${summaryMax} characters (the site's card limit)`);
  if (!types.includes(m.type as string)) r.err(w, `type must be one of ${pyRepr(types)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.updated ?? ""))) r.err(w, "updated must be YYYY-MM-DD");
  if (c.metadata.unnumberedSeriesTags && existsSync(p.buildScript) && SERIES_NUMBER_RE.test(readFileSync(p.buildScript, "utf8"))) {
    r.err(w, "series tag has a number; name the series only (order lives in series.position)");
  }
  if (!existsSync(p.tsv)) r.err(w, `no narration script at ${basename(p.tsv)}`);
  if (!existsSync(p.buildScript)) r.err(w, `no build script at ${basename(p.buildScript)}`);
  if (!cat.order.includes(m.id as string)) r.err(w, `${pyRepr(m.id)} isn't in catalog order, so it won't be published`);
}

/** The text and voice `narrate` would lock, without calling anything. */
export function expectedNarration(ws: Workspace, p: Project): { text: string; voice: Voice } {
  const voice = voiceForRun(ws.houseVoice(), ws.config.narration.envPrefix);
  return { text: takeText(readScript(p.tsv), voice.model_id), voice };
}

function checkNarration(ws: Workspace, p: Project, r: Report): void {
  const w = p.name;
  if (!existsSync(p.lock) || !existsSync(p.take)) {
    r.err(w, `no locked narration. Run ${cmd(`narrate ${w}`)}.`);
    return;
  }
  if (isLfsPointer(p.take)) {
    r.err(w, "narration.mp3 is a Git LFS pointer. Run `git lfs pull`.");
    return;
  }
  const lock = readLock(p.lock)!;
  const { text, voice } = expectedNarration(ws, p);
  if (lock.text !== text) r.err(w, `narration is stale: ${basename(p.tsv)} changed since the take was made. Run ${cmd(`narrate ${w}`)}.`);
  if (!jsonEqual(lock.voice, voice)) r.err(w, `narration was made with a different voice than catalog/voice.json. Run ${cmd(`narrate ${w}`)} or restore the voice.`);
  if (isPlaceholder(lock.voice)) r.warn(w, "placeholder narration (tones, not a voice): set a real house voice in catalog/voice.json before release");
  if (!lock.audioSha256) r.err(w, "narration lock has no audioSha256");
  else if (lock.audioSha256 !== sha256File(p.take)) r.err(w, "narration.mp3 doesn't match its lock (audioSha256)");

  for (const f of scanTails(p.lock)) {
    const msg = `${f.segment}: sound after the aligned end (${pyFloat(f.from)}-${pyFloat(f.to)}s) -> ${f.verdict}`;
    if (f.verdict.startsWith("AT RISK")) r.err(w, msg);
    else r.warn(w, msg);
  }
  for (const f of scanStarts(p.lock)) {
    if (f.verdict.startsWith("AT RISK")) r.err(w, `${f.segment}: speech starts before the aligned start (${pyFloat(f.alignedStart)}s) -> ${f.verdict}`);
  }
}

function checkRender(p: Project, r: Report): void {
  const w = p.name;
  if (!existsSync(p.output)) {
    r.warn(w, "not rendered yet");
    return;
  }
  const info = probe(p.output);
  if (info.width !== 1920 || info.height !== 1080) r.err(w, `render is ${info.width}x${info.height}, expected 1920x1080`);
  if (!info.audio) r.err(w, "render has no audio track");
  if (existsSync(p.propsPath)) {
    const want = readJson<{ durationSeconds: number }>(p.propsPath).durationSeconds;
    if (Math.abs(info.duration - want) > 0.25) r.err(w, `render is ${fixed(info.duration, 2)}s but the props say ${fixed(want, 2)}s. Re-render.`);
  }
  const lufs = loudness(p.output);
  if (lufs === null || Math.abs(lufs + 16) > 1.0) r.err(w, `loudness ${lufs === null ? "None" : pyFloat(lufs)} LUFS, expected -16 +/- 1`);
  if (!existsSync(p.poster)) r.warn(w, `no poster yet (${cmd("render")} makes one)`);
}

/**
 * A public video needs every required sign-off and every other one its video.json lists
 * (config `metadata.approvals`).
 */
export function checkRelease(p: Pick<Project, "name" | "meta">, kinds: Record<string, ApprovalKind>, r: Report): void {
  if (p.meta.visibility !== "public") return;
  const approvals = (p.meta.approvals ?? {}) as Record<string, unknown>;
  const known = Object.keys(kinds);
  const unknown = Object.keys(approvals).filter((a) => !known.includes(a)).sort();
  if (unknown.length) r.err(p.name, `unknown approvals ${pyRepr(unknown)}; use ${known.join(", ") || "none (the config lists no sign-offs)"}`);
  const required = known.filter((k) => kinds[k]!.required);
  const missing = [...new Set([...required, ...Object.keys(approvals)])].filter((a) => !approvals[a]);
  if (missing.length) r.err(p.name, `public, but approvals not recorded: ${missing.join(", ")}`);
}

/** The quick checks `list` shows: metadata and narration, no file scans or media. */
export function quickCheck(ws: Workspace, p: Project): Report {
  const r = new Report();
  checkMeta(p, ws.catalog(), ws.config, r);
  checkNarration(ws, p, r);
  return r;
}

export interface CheckOptions {
  /** Also check the render: size, audio, duration, loudness, poster (slow: decodes the MP4). */
  media?: boolean;
  /** Also check what a public release needs: every sign-off recorded. */
  release?: boolean;
}

export function check(ws: Workspace, projects: Project[], { media = false, release = false }: CheckOptions = {}): Report {
  const r = new Report();
  const cat = ws.catalog();
  const ids = new Map<string, string>();
  for (const p of ws.projects()) {
    if (ids.has(p.id)) r.err(p.name, `duplicate id ${pyRepr(p.id)} (also ${ids.get(p.id)})`);
    ids.set(p.id, p.name);
  }
  for (const vid of cat.order) if (!ids.has(vid)) r.err("catalog/catalog.json", `order lists ${pyRepr(vid)}, which has no project`);
  for (const p of projects) {
    checkMeta(p, cat, ws.config, r);
    checkNarration(ws, p, r);
    scanFiles(ws, p.dir, r);
    if (media) checkRender(p, r);
    if (release) {
      checkRelease(p, ws.config.metadata.approvals, r);
      const lock = readLock(p.lock);
      if (lock && isPlaceholder(lock.voice)) r.err(p.name, "placeholder narration can't be released; narrate it with a real voice");
    }
  }
  for (const dir of ws.config.checks.scan) scanFiles(ws, join(ws.root, dir), r);
  return r;
}

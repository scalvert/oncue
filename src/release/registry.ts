/**
 * The registry: registry.json, the contract between this repo and the site that shows the videos.
 *
 * This repo owns what each video is; the site owns presentation. The site pulls registry.json and
 * resolves media URLs from it.
 *
 * Updating the registry is how a render gets approved:
 *
 * - Each entry pins its MP4 and poster by SHA-256. Metadata (title, summary, visibility, ...) always
 *   follows video.json, but the media, transcript, and duration change only with `--accept <id>`.
 *   A re-render never silently replaces an approved video, and a new video isn't listed until it's
 *   accepted.
 * - Accepted files are copied to the media folder (default dist/media) as <id>.<sha10>.<ext>. That
 *   folder is append-only (oncue never deletes from it), so every approved render stays available
 *   to compare against.
 * - `mediaBaseUrl` (catalog/catalog.json) is where the media folder is hosted. While it's null, the
 *   site can only sync from a local checkout, which copies the files from the media folder.
 * - `hosted` says whether a video's media may be on mediaBaseUrl: true once every sign-off its
 *   video.json lists that blocks hosting is recorded (config `metadata.approvals`). `deploy`
 *   uploads only hosted videos, and the site lists only hosted videos. Preview videos can be
 *   hosted (preview isn't secret); a video with an open hosting sign-off can't.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fail } from "../core/errors.ts";
import { sha256File } from "../core/files.ts";
import { dumps as jsonDumps, readJson } from "../core/json.ts";
import { round } from "../core/numbers.ts";
import { cmd } from "../core/program.ts";
import type { ApprovalKind } from "../config/config.ts";
import { duration as probeDuration } from "../media/ffmpeg.ts";
import type { Project } from "../workspace/project.ts";
import type { Catalog, Track, VideoMeta } from "../workspace/types.ts";
import type { Workspace } from "../workspace/workspace.ts";
import { type Ledger, loadLedger, type Media, record, sidecarFingerprint, versionOf } from "./versions.ts";

/** Fields that stay in this repo (build config, release bookkeeping). */
const PRIVATE_FIELDS = new Set(["build", "approvals", "updated"]);

export interface RegistryVideo {
  id: string;
  durationSeconds: number;
  updated: string;
  hosted: boolean;
  version: number | null;
  media: Media;
  transcript: string[];
  visibility?: string;
  [key: string]: unknown;
}

export interface Registry {
  $comment: string;
  mediaBaseUrl: string | null;
  tracks: Track[];
  videos: RegistryVideo[];
}

/** The narration as the site's transcript shows it: one line per segment, spoken forms written out. */
export function transcript(ws: Workspace, p: Project): string[] {
  const reps = ws.spokenReplacements().map(([a, b]) => [new RegExp(a, "g"), b] as const);
  const rows: string[] = [];
  for (const line of readFileSync(p.tsv, "utf8").split(/\r\n|\n|\r/)) {
    if (!line.includes("\t")) continue;
    let text = line.slice(line.indexOf("\t") + 1).trim();
    for (const [re, b] of reps) text = text.replace(re, b);
    rows.push(text);
  }
  return rows;
}

/** Whole seconds, as the site shows them. */
export const duration = (path: string): number => round(probeDuration(path));

/** Immutable, content-addressed file name: safe to cache forever. */
export const hashedName = (videoId: string, sha: string, ext: string) => `${videoId}.${sha.slice(0, 10)}.${ext}`;

export function metadata(p: Project, cat: Catalog): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.meta)) {
    if (PRIVATE_FIELDS.has(k)) continue;
    if (k === "series") {
      const s = v as NonNullable<VideoMeta["series"]>;
      e[k] = { id: s.id, label: cat.series?.[s.id]?.label, position: s.position };
    } else e[k] = v;
  }
  return e;
}

/**
 * The MP4 and poster that `--accept` would approve: the project's render, or
 * <dir>/videos/<id>.mp4 and <dir>/posters/<id>.webp (the layout of an approved-renders backup).
 */
export function candidate(p: Project, mediaFrom: string | null): [string, string] {
  return mediaFrom ? [join(mediaFrom, "videos", `${p.id}.mp4`), join(mediaFrom, "posters", `${p.id}.webp`)] : [p.output, p.poster];
}

/** Copy an accepted file into dist/media. Append-only: an existing name must have the same content. */
function stage(ws: Workspace, src: string, name: string, sha: string): void {
  const dst = join(ws.paths.media, name);
  if (existsSync(dst)) {
    if (sha256File(dst) !== sha) fail(`${dst} exists with different content. dist/media is append-only; investigate before continuing.`);
    return;
  }
  mkdirSync(ws.paths.media, { recursive: true });
  copyFileSync(src, dst);
  const st = statSync(src);
  utimesSync(dst, st.atime, st.mtime);
}

/** The listed sign-offs that block hosting and aren't recorded yet. Empty means hostable. */
export function heldBy(meta: Partial<VideoMeta>, kinds: Record<string, ApprovalKind> = {}): string[] {
  return Object.entries(meta.approvals ?? {})
    .filter(([k, v]) => kinds[k]?.blocksHosting !== false && !v)
    .map(([k]) => k);
}

export function loadRegistry(path: string): Registry | null {
  return existsSync(path) ? readJson<Registry>(path) : null;
}

export interface UpdateOptions {
  accept?: Set<string>;
  acceptAll?: boolean;
  mediaFrom?: string | null;
  /** Copy accepted files into dist/media and record versions. False for a dry comparison. */
  writeMedia?: boolean;
  /** The registry to update (default: registry.json). */
  prior?: Registry | null;
  note?: string | null;
  /** How long an MP4 is, in whole seconds (tests replace it). */
  duration?: (path: string) => number;
  /** The transcript an accepted video gets (tests replace it). */
  transcript?: (p: Project) => string[];
}

export interface Update {
  data: Registry;
  /** versions.json, with any new versions appended. */
  ledger: Ledger;
  accepted: string[];
  /** The render differs from the approved one. */
  pending: string[];
  /** Never accepted, so not in the registry. */
  unlisted: string[];
  removed: string[];
}

export function update(ws: Workspace, o: UpdateOptions = {}): Update {
  const accept = o.accept ?? new Set<string>();
  const writeMedia = o.writeMedia ?? true;
  const dur = o.duration ?? duration;
  const transcriptOf = o.transcript ?? ((p: Project) => transcript(ws, p));
  const mediaFrom = o.mediaFrom ?? null;
  const ledger = loadLedger(ws.paths.ledger, ws.config.ledger.comment);
  const cat = ws.catalog();
  const prior = o.prior !== undefined && o.prior !== null ? o.prior : (loadRegistry(ws.paths.registry) ?? { videos: [] as RegistryVideo[] });
  const oldById = new Map((prior.videos ?? []).map((v) => [v.id, v]));
  const ps = ws.projects().filter((p) => cat.order.includes(p.id));
  const unknown = [...accept].filter((id) => !ps.some((p) => p.id === id)).sort();
  if (unknown.length) fail(`--accept: no such video in the catalog: ${JSON.stringify(unknown)}`);

  const u: Update = { data: {} as Registry, ledger, accepted: [], pending: [], unlisted: [], removed: [] };
  const videos: RegistryVideo[] = [];
  for (const p of ps) {
    const old = oldById.get(p.id);
    const [mp4, poster] = candidate(p, mediaFrom);
    const have = existsSync(mp4) && existsSync(poster);
    let held: Pick<RegistryVideo, "durationSeconds" | "media" | "transcript">;
    if (o.acceptAll || accept.has(p.id)) {
      if (!have) {
        const shown = mp4.startsWith(ws.root) ? relative(ws.root, mp4) : mp4;
        fail(`${p.name}: nothing to accept (no ${shown} or poster). Run ${cmd(`render ${p.name}`)}.`);
      }
      const sha = sha256File(mp4);
      const psha = sha256File(poster);
      const media: Media = {
        file: hashedName(p.id, sha, "mp4"),
        poster: hashedName(p.id, psha, "webp"),
        sha256: sha,
        posterSha256: psha,
        bytes: statSync(mp4).size,
        width: 1920,
        height: 1080,
      };
      if (writeMedia) {
        stage(ws, mp4, media.file, sha);
        stage(ws, poster, media.poster, psha);
        const fp = mediaFrom ? null : sidecarFingerprint(p.sidecar, sha, psha);
        record(ws, ledger, p, media, fp, o.note ?? null);
      }
      held = { durationSeconds: dur(mp4), media, transcript: transcriptOf(p) };
      if (!old || old.media.sha256 !== sha) u.accepted.push(p.id);
    } else if (old) {
      held = { durationSeconds: old.durationSeconds, media: old.media, transcript: old.transcript };
      if (have && p.output === mp4 && sha256File(mp4) !== old.media.sha256) u.pending.push(p.id);
    } else {
      u.unlisted.push(p.id);
      continue;
    }
    videos.push({
      ...metadata(p, cat),
      id: p.id,
      durationSeconds: held.durationSeconds,
      updated: p.meta.updated,
      hosted: heldBy(p.meta, ws.config.metadata.approvals).length === 0,
      version: versionOf(ledger, p.id, held.media.sha256, held.media.posterSha256),
      media: held.media,
      transcript: held.transcript,
    });
  }
  const listed = new Set(videos.map((v) => v.id));
  u.removed = [...oldById.keys()].filter((id) => !listed.has(id));
  u.data = { $comment: ws.config.registry.comment, mediaBaseUrl: cat.mediaBaseUrl ?? null, tracks: cat.tracks, videos };
  return u;
}

/** Approved files that aren't in this checkout's dist/media (needed to sync the site locally). */
export function missingMedia(ws: Workspace, data: Registry): string[] {
  return data.videos.flatMap((v) => [v.media.file, v.media.poster]).filter((name) => !existsSync(join(ws.paths.media, name)));
}

export function dumps(data: Registry): string {
  return jsonDumps(data, { indent: 2, ensureAscii: false }) + "\n";
}

export function writeRegistry(data: Registry, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, dumps(data));
}

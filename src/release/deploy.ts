/**
 * `deploy`: put every hosted video's accepted version on the media host (config `mediaStore`,
 * default a Vercel Blob store).
 *
 * Uploads only registry entries with `hosted: true` (src/release/registry.ts), straight from the
 * media folder, under their content-hashed names, so each version is its own file. Files already on
 * the store are skipped; nothing is overwritten or deleted, so earlier versions stay available for
 * rollback. Every hosted file is then fetched back from its public URL and checked: SHA-256,
 * content type, and a byte-range request (seeking). The first upload records the store's public
 * URL as catalog `mediaBaseUrl` and refreshes registry.json; commit both.
 *
 * The store's credentials come from the environment or the repo's git-ignored .env.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../core/errors.ts";
import { loadEnv, sha256File } from "../core/files.ts";
import { dumps as jsonDumps } from "../core/json.ts";
import { cmd } from "../core/program.ts";
import type { Workspace } from "../workspace/workspace.ts";
import type { MediaStore } from "./blob.ts";
import { dumps, loadRegistry, update, writeRegistry } from "./registry.ts";

const TYPES: Record<string, string> = { mp4: "video/mp4", webp: "image/webp" };
const typeOf = (name: string) => TYPES[name.slice(name.lastIndexOf(".") + 1)]!;

async function verify(url: string, sha: string, ctype: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) fail(`${url}: HTTP ${r.status}`);
  const gotType = r.headers.get("content-type") ?? "";
  const got = createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
  if (got !== sha) fail(`${url}: SHA-256 mismatch after upload`);
  if (!gotType.startsWith(ctype)) fail(`${url}: served as ${JSON.stringify(gotType)}, expected ${ctype}`);
  if (ctype === "video/mp4") {
    const range = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(60_000) });
    await range.arrayBuffer();
    if (range.status !== 206) fail(`${url}: range request returned ${range.status}, not 206 (seeking won't work)`);
  }
}

export interface DeployOptions {
  dryRun?: boolean;
  store?: MediaStore;
  log?: (line: string) => void;
}

export async function deploy(ws: Workspace, { dryRun = false, store = ws.config.mediaStore, log = console.log }: DeployOptions = {}): Promise<void> {
  const data = loadRegistry(ws.paths.registry);
  if (!data) fail(`No registry.json. Run ${cmd("registry --accept <id>")} first.`);
  if (dumps(update(ws, { writeMedia: false }).data) !== dumps(data)) fail(`registry.json is out of date. Run ${cmd("registry")} first.`);
  const hosted = data.videos.filter((v) => v.hosted);
  for (const v of data.videos) {
    if (!v.hosted) log(`held    ${v.id}: not hosted until its hosting sign-offs are recorded (video.json approvals)`);
  }
  const files: [string, string][] = [
    ...hosted.map((v): [string, string] => [v.media.file, v.media.sha256]),
    ...hosted.map((v): [string, string] => [v.media.poster, v.media.posterSha256]),
  ];
  for (const [name, sha] of files) {
    const local = join(ws.paths.media, name);
    if (!existsSync(local) || sha256File(local) !== sha) fail(`${local} is missing or doesn't match the registry. Re-accept it first.`);
  }
  if (dryRun) {
    for (const [name] of files) log(`would upload ${name}`);
    log(`${files.length} file(s) for ${hosted.length} hosted video(s)`);
    return;
  }

  loadEnv(ws.paths.env);
  const missing = store.missing?.();
  if (missing) fail(`${store.name}: ${missing}`);
  const cat = JSON.parse(readFileSync(ws.catalogFile, "utf8")) as { mediaBaseUrl?: string | null };
  let base = cat.mediaBaseUrl ?? null;
  let uploaded = 0;
  for (const v of hosted) log(`${v.id.padEnd(18)} v${v.version || "?"}`);
  for (const [name] of files) {
    const r = await store.put(join(ws.paths.media, name), name, typeOf(name));
    const urlBase = r.url.slice(0, r.url.lastIndexOf("/"));
    if (base && urlBase !== base.replace(/\/+$/, "")) fail(`The store's URL is ${urlBase}, but catalog mediaBaseUrl is ${base}. Wrong token?`);
    base = base || urlBase;
    if (!r.existed) uploaded++;
    log(`${r.existed ? "exists  " : "uploaded"} ${name}`);
  }
  if (!base) {
    log("Nothing to deploy: no video is hosted yet.");
    return;
  }
  if (cat.mediaBaseUrl !== base) {
    cat.mediaBaseUrl = base;
    writeFileSync(ws.catalogFile, jsonDumps(cat, { indent: 2, ensureAscii: false }) + "\n");
    writeRegistry(update(ws, { writeMedia: false }).data, ws.paths.registry);
    log(`set mediaBaseUrl to ${base} (catalog/catalog.json, registry.json): commit both`);
  }
  for (const [name, sha] of files) await verify(`${base.replace(/\/+$/, "")}/${name}`, sha, typeOf(name));
  log(`verified ${files.length} file(s) for ${hosted.length} hosted video(s) at ${base} (${uploaded} new)`);
}

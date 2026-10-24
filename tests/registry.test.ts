/** The registry gate: an approved render is never replaced without --accept. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OncueError } from "../src/core/errors.ts";
import { sha256File } from "../src/core/files.ts";
import { hashedName, heldBy, type Registry, type RegistryVideo, update, type UpdateOptions } from "../src/release/registry.ts";
import { exampleConfig, repo, sandbox, writeFile } from "./helpers.ts";

const order = repo.catalog().order;
const kinds = exampleConfig.metadata.approvals;

/** A fake approved-renders dir (videos/<id>.mp4, posters/<id>.webp). */
function renders(dir: string, name: string, changed: Set<string> = new Set()): string {
  const d = join(dir, name);
  for (const id of order) {
    const tag = changed.has(id) ? name : "v1";
    writeFile(join(d, "videos", `${id}.mp4`), `mp4 ${id} ${tag}`);
    writeFile(join(d, "posters", `${id}.webp`), `webp ${id} ${tag}`);
  }
  return d;
}

const empty = { videos: [] } as unknown as Registry;
const byId = (data: Registry) => new Map<string, RegistryVideo>(data.videos.map((v) => [v.id, v]));

function setup() {
  const { ws, dir } = sandbox();
  const run = (o: UpdateOptions) => update(ws, { duration: () => 60, ...o });
  return { ws, dir, run };
}

test("new videos are unlisted until accepted", () => {
  const { dir, run } = setup();
  const u = run({ mediaFrom: renders(dir, "v1"), prior: empty });
  assert.deepEqual(u.data.videos, []);
  assert.deepEqual([...u.unlisted].sort(), [...order].sort());
});

test("accept-all pins and stages media", () => {
  const { ws, dir, run } = setup();
  const u = run({ mediaFrom: renders(dir, "v1"), acceptAll: true, prior: empty });
  assert.equal(u.data.videos.length, order.length);
  for (const v of u.data.videos) {
    const m = v.media;
    assert.equal(m.file, `${v.id}.${m.sha256.slice(0, 10)}.mp4`);
    assert.equal(readFileSync(join(ws.paths.media, m.file), "utf8"), `mp4 ${v.id} v1`);
    assert.equal(sha256File(join(ws.paths.media, m.poster)), m.posterSha256);
    assert.ok(v.transcript.length);
    assert.equal(v.durationSeconds, 60);
    assert.ok(!("build" in v) && !("approvals" in v));
  }
});

test("a changed render is held until accepted", () => {
  const { ws, dir, run } = setup();
  const approved = run({ mediaFrom: renders(dir, "v1"), acceptAll: true, prior: empty }).data;
  const target = order[0]!;
  const v2 = renders(dir, "v2", new Set([target]));

  const held = run({ mediaFrom: v2, prior: approved }).data;
  assert.deepEqual(byId(held).get(target)!.media, byId(approved).get(target)!.media);

  const accepted = run({ mediaFrom: v2, accept: new Set([target]), prior: approved });
  assert.deepEqual(accepted.accepted, [target]);
  const next = byId(accepted.data);
  assert.notEqual(next.get(target)!.media.sha256, byId(approved).get(target)!.media.sha256);
  for (const id of order.filter((i) => i !== target)) assert.deepEqual(next.get(id)!.media, byId(approved).get(id)!.media);
  // Append-only: the approved file is still there to compare against.
  assert.ok(existsSync(join(ws.paths.media, byId(approved).get(target)!.media.file)));
});

test("a held entry keeps its transcript", () => {
  // A narration edit doesn't rewrite the transcript of the video that's still published.
  const { dir, run } = setup();
  const approved = run({ mediaFrom: renders(dir, "v1"), acceptAll: true, prior: empty }).data;
  const target = order[0]!;
  const held = byId(run({ mediaFrom: renders(dir, "v2"), prior: approved, transcript: () => ["edited"] }).data).get(target)!;
  assert.deepEqual(held.transcript, byId(approved).get(target)!.transcript);
});

test("metadata always follows video.json", () => {
  const { dir, run } = setup();
  const approved = run({ mediaFrom: renders(dir, "v1"), acceptAll: true, prior: empty }).data;
  const stale = JSON.parse(JSON.stringify(approved)) as Registry;
  stale.videos[0]!.title = "Stale title";
  const fresh = run({ mediaFrom: renders(dir, "v2"), prior: stale }).data;
  const p = repo.projects().find((x) => x.id === stale.videos[0]!.id)!;
  assert.equal(byId(fresh).get(p.id)!.title, p.meta.title);
});

test("the media folder is never overwritten", () => {
  const { ws, dir, run } = setup();
  const d = renders(dir, "v1");
  const id = order[0]!;
  const name = hashedName(id, sha256File(join(d, "videos", `${id}.mp4`)), "mp4");
  writeFile(join(ws.paths.media, name), "other bytes under the same name");
  assert.throws(() => run({ mediaFrom: d, accept: new Set([id]), prior: empty }), /append-only/);
  assert.equal(readFileSync(join(ws.paths.media, name), "utf8"), "other bytes under the same name");
});

test("accepting an unknown id fails", () => {
  const { dir, run } = setup();
  assert.throws(() => run({ mediaFrom: renders(dir, "v1"), accept: new Set(["nope"]), prior: empty }), (e: Error) => {
    return e instanceof OncueError && /no such video/.test(e.message);
  });
});

test("an open hosting sign-off holds a video off the host", () => {
  assert.deepEqual(heldBy({ approvals: { product: null } } as never, kinds), []);
  assert.deepEqual(heldBy({ approvals: { product: { by: "x" }, legal: null } } as never, kinds), ["legal"]);
  // A sign-off the config doesn't know holds hosting, to be safe.
  assert.deepEqual(heldBy({ approvals: { product: null, captures: null, legal: { by: "x" } } } as never, kinds), ["captures"]);
});

test("hosted follows the sign-offs", () => {
  const { dir, run } = setup();
  const videos = byId(run({ mediaFrom: renders(dir, "v1"), acceptAll: true, prior: empty }).data);
  for (const p of repo.projects()) assert.equal(videos.get(p.id)!.hosted, heldBy(p.meta, kinds).length === 0, p.id);
  assert.equal(videos.get("hello")!.hosted, true);
  assert.equal(videos.get("search-api")!.hosted, false);
});

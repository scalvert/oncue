/** The narration lock: frozen builds never call ElevenLabs and refuse stale or tampered takes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sha256File } from "../src/core/files.ts";
import { ElevenLabs } from "../src/narration/elevenlabs.ts";
import { lockedTake, type NarrationMode } from "../src/narration/narrator.ts";
import { readScript, takeText } from "../src/narration/script.ts";
import type { Voice } from "../src/narration/voice.ts";
import { repo, tempDir, writeFile } from "./helpers.ts";

const house = repo.houseVoice();

function project(o: { text?: string; voice?: Voice; audio?: string; sha?: boolean } = {}) {
  const root = tempDir();
  const script = writeFile(join(root, "narration.tsv"), "s1\tHello there.\ns2\tSecond line.\n");
  const take = writeFile(join(root, "assets/audio/narration.mp3"), o.audio ?? "ID3fake");
  const lock = join(root, "assets/audio/narration_words.json");
  const data: Record<string, unknown> = {
    text: o.text ?? takeText(readScript(script), house.model_id),
    voice: o.voice ?? house,
    words: [
      { word: "Hello", start: 0.0, end: 0.3 },
      { word: "there.", start: 0.3, end: 0.6 },
      { word: "Second", start: 1.0, end: 1.3 },
      { word: "line.", start: 1.3, end: 1.6 },
    ],
    segments: [
      { id: "s1", start: 0.0, end: 0.6 },
      { id: "s2", start: 1.0, end: 1.6 },
    ],
  };
  if (o.sha ?? true) data.audioSha256 = sha256File(take);
  writeFile(lock, JSON.stringify(data));
  return { root, script, take, lock };
}

const take = (p: ReturnType<typeof project>, mode: NarrationMode = "frozen") =>
  lockedTake({
    folder: "t",
    script: p.script,
    take: p.take,
    lock: p.lock,
    voice: house,
    mode,
    synthesizer: () => new ElevenLabs(undefined),
  });

test("a fresh lock loads without a key", async () => {
  const lock = await take(project());
  assert.deepEqual(lock.segments.map((s) => s.id), ["s1", "s2"]);
});

test("a changed script fails when frozen", async () => {
  await assert.rejects(take(project({ text: "something else" })), /the script changed/);
});

test("a changed voice fails when frozen", async () => {
  await assert.rejects(take(project({ voice: { ...house, voice_id: "someone-else" } })), /the voice changed/);
});

test("tampered audio fails", async () => {
  const p = project();
  writeFile(p.take, "ID3different");
  await assert.rejects(take(p), /doesn't match its lock/);
});

test("a Git LFS pointer is explained", async () => {
  await assert.rejects(take(project({ audio: "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n" })), /git lfs pull/);
});

test("update mode needs a key, and leaves the old take alone", async () => {
  const p = project({ text: "something else" });
  const before = readFileSync(p.take);
  await assert.rejects(take(p, "update"), /ELEVENLABS_API_KEY/);
  assert.deepEqual(readFileSync(p.take), before);
});

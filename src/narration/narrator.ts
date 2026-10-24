import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fail } from "../core/errors.ts";
import { ensureRealFile, sha256File } from "../core/files.ts";
import { dumps } from "../core/json.ts";
import { cmd } from "../core/program.ts";
import { alignWords, segmentWords } from "./alignment.ts";
import type { SpeechSynthesizer } from "./elevenlabs.ts";
import { type NarrationLock, readLock, staleness } from "./lock.ts";
import { readScript, takeText } from "./script.ts";
import type { Voice } from "./voice.ts";

/**
 * `frozen` (builds, renders, CI): use the locked take, and fail if it's stale.
 * `update` (`narrate`): regenerate a stale take.
 */
export type NarrationMode = "frozen" | "update";

export interface TakeRequest {
  /** The project folder name, for messages ("oncue narrate <folder>"). */
  folder: string;
  script: string;
  take: string;
  lock: string;
  voice: Voice;
  mode: NarrationMode;
  /** Only called in update mode, for a stale take. */
  synthesizer: () => SpeechSynthesizer;
  log?: (line: string) => void;
}

/**
 * The narration a video is built on: one take for all script rows, with word timings. Generated
 * once and locked: the lock records the text, the voice, and the audio's hash, so the same lock
 * always yields the same timeline, and a changed script can't silently ship an old take.
 */
export async function lockedTake(req: TakeRequest): Promise<NarrationLock> {
  const rows = readScript(req.script);
  const text = takeText(rows, req.voice.model_id);
  const cached = readLock(req.lock);
  const hasTake = existsSync(req.take);
  if (hasTake) ensureRealFile(req.take);
  const why = staleness(cached, text, req.voice, hasTake);
  if (!why && cached!.audioSha256 && cached!.audioSha256 !== sha256File(req.take)) {
    fail(`${req.take} doesn't match its lock (audioSha256). Restore it, or run ${cmd(`narrate ${req.folder}`)}.`);
  }
  if (!why) return cached!;
  if (req.mode === "frozen") {
    fail(
      `${req.folder}: narration is stale (${why}). Run ${cmd(`narrate ${req.folder}`)} ` +
        "(a real voice needs ELEVENLABS_API_KEY), listen to it, and commit the new take.",
    );
  }
  const { audio, alignment } = await req.synthesizer().synthesize(text, req.voice);
  if (alignment.characters.join("") !== text) throw new Error("alignment does not match text");
  mkdirSync(dirname(req.take), { recursive: true });
  writeFileSync(req.take, audio);
  const words = alignWords(alignment);
  const lock: NarrationLock = { text, voice: req.voice, words, segments: segmentWords(rows, words), audioSha256: sha256File(req.take) };
  writeFileSync(req.lock, dumps(lock, { indent: 1 }));
  req.log?.(`narration: generated ${[...text].length} chars`);
  return lock;
}

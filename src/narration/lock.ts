import { existsSync } from "node:fs";
import { jsonEqual, readJson } from "../core/json.ts";
import type { Voice } from "./voice.ts";

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
}

/**
 * assets/audio/narration_words.json: the take a video is locked to. Builds never regenerate it;
 * they fail if the script or voice no longer match it.
 */
export interface NarrationLock {
  text: string;
  voice: Voice;
  words: Word[];
  segments: Segment[];
  audioSha256?: string;
}

export function readLock(path: string): NarrationLock | null {
  return existsSync(path) ? readJson<NarrationLock>(path) : null;
}

/** Why a lock no longer matches the script and voice, or null when it's current. */
export function staleness(lock: NarrationLock | null, text: string, voice: Voice, takeExists: boolean): string | null {
  if (!lock) return "no locked take";
  if (lock.text !== text) return "the script changed";
  if (!jsonEqual(lock.voice, voice)) return "the voice changed";
  if (!takeExists) return "the audio file is missing";
  return null;
}

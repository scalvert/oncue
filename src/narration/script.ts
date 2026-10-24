import { readFileSync } from "node:fs";
import { fail } from "../core/errors.ts";

/** One row of narration.tsv: a segment id (s1, s2, ...) and what's said in it. */
export interface ScriptRow {
  id: string;
  text: string;
}

export function readScript(path: string): ScriptRow[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line, i) => {
      const tab = line.indexOf("\t");
      if (tab < 0) fail(`${path}:${i + 1}: expected "<segment id><TAB><text>"`);
      return { id: line.slice(0, tab), text: line.slice(tab + 1) };
    });
}

const AUDIO_TAG = /\[[^\]]*\]/g;

/** A narration line without its eleven_v3 audio tags: what captions and cues match against. */
export function spokenText(line: string): string {
  return words(line.replace(AUDIO_TAG, " ")).join(" ");
}

/** Python's str.split(): whitespace-separated words, no empties. */
export function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** v3/v4 don't take <break> tags; retime() inserts the scene gaps anyway. */
export function supportsSsmlBreaks(modelId: string): boolean {
  return !modelId.startsWith("eleven_v3") && !modelId.startsWith("eleven_v4");
}

/** The single text sent to the voice model for all rows: what the narration lock records. */
export function takeText(rows: ScriptRow[], modelId: string): string {
  const joiner = supportsSsmlBreaks(modelId) ? ' <break time="0.9s" /> ' : "\n\n";
  return rows.map((r) => r.text.trim()).join(joiner);
}

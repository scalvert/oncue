import { round } from "../core/numbers.ts";
import type { Segment, Word } from "./lock.ts";
import { type ScriptRow, spokenText, words } from "./script.ts";

/** Per-character timings from the speech service, for exactly the text that was sent. */
export interface CharAlignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

/**
 * The spoken words of a take, with times. <break> tags and eleven_v3 audio tags ([upbeat],
 * [speaking slowly]) are in the text but aren't words, so they're dropped.
 */
export function alignWords(a: CharAlignment): Word[] {
  const tokens: [string, number, number][] = [];
  let cur = "";
  let cs = 0;
  let ce = 0;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) tokens.push([cur, cs, ce]);
      cur = "";
      return;
    }
    if (!cur) cs = a.starts[i]!;
    cur += c;
    ce = a.ends[i]!;
  });
  if (cur) tokens.push([cur, cs, ce]);

  const out: Word[] = [];
  let inBreak = false;
  let inTag = false;
  for (const [w, s, e] of tokens) {
    if (w.startsWith("<break")) {
      inBreak = true;
      continue;
    }
    if (inBreak) {
      if (w.endsWith("/>")) inBreak = false;
      continue;
    }
    if (w.startsWith("[") || inTag) {
      inTag = !w.endsWith("]");
      continue;
    }
    out.push({ word: w, start: round(s, 3), end: round(e, 3) });
  }
  return out;
}

/** Split the take's words into the script's segments, by word count. */
export function segmentWords(rows: ScriptRow[], spoken: Word[]): Segment[] {
  let i = 0;
  const segs = rows.map((r) => {
    const n = words(spokenText(r.text)).length;
    const ws = spoken.slice(i, i + n);
    i += n;
    if (!ws.length) throw new Error(`segment ${r.id} has no aligned words`);
    return { id: r.id, start: ws[0]!.start, end: ws[ws.length - 1]!.end };
  });
  if (i !== spoken.length) throw new Error(`word count mismatch: the script has ${i} words, the take ${spoken.length}`);
  return segs;
}

import type { CaptionWord } from "../../composition/src/props.ts";
import { round } from "../core/numbers.ts";
import type { Word } from "../narration/lock.ts";

/**
 * A term the narration spells out, shown as written in captions: a spoken form whose " dot " means
 * "." ("docs dot acme dot dev" -> "docs.acme.dev"), or a [spoken, written] pair ("X A A" -> "XAA").
 * A repo's own forms go in its config (`captions.spoken`); a video adds more with `extraSpoken`.
 */
export type SpokenForm = string | [spoken: string, written: string];

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Caption words with line breaks: after sentence punctuation and at the end of each segment.
 * Spoken forms collapse to one caption word, keeping the spoken word's end punctuation.
 */
export function captionWords(words: readonly Word[], segmentEnds: number[], spoken: SpokenForm[]): CaptionWord[] {
  const ends = new Set(segmentEnds.map((e) => round(e, 3)));
  const caps: CaptionWord[] = words.map((w) => ({ ...w, breakAfter: /[.?!]$/.test(w.word) || ends.has(round(w.end, 3)) }));
  for (const item of spoken) {
    const [form, writtenAs] = typeof item === "string" ? [item, item.replaceAll(" dot ", ".")] : item;
    const pattern = form.split(/\s+/).filter(Boolean).map(norm);
    const n = pattern.length;
    for (let i = 0; i <= caps.length - n; i++) {
      if (!pattern.every((p, j) => norm(caps[i + j]!.word) === p)) continue;
      const last = caps[i + n - 1]!;
      const punct = /[.,!?]+$/.exec(last.word)?.[0] ?? "";
      caps.splice(i, n, { word: writtenAs + punct, start: caps[i]!.start, end: last.end, breakAfter: last.breakAfter });
    }
  }
  return caps;
}

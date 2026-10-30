import { fail } from "../core/errors.ts";
import { round } from "../core/numbers.ts";
import type { Word } from "../narration/lock.ts";

/** Seconds after the last word before the video ends. */
export const TAIL = 2.8;

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The narration on the video's clock: when each word and segment is spoken, and the span each
 * scene gets. The first scene starts at `start` (the pre-roll, 0 by default), the other bounds are
 * the midpoints of the pauses between segments, and the video ends TAIL seconds after the last
 * word.
 */
export class Timeline {
  readonly words: readonly Word[];
  readonly segments: Readonly<Record<string, { start: number; end: number }>>;
  readonly order: readonly string[];
  readonly end: number;
  readonly #spans: Map<string, [number, number]>;

  constructor(words: Word[], segments: Record<string, { start: number; end: number }>, order: string[], start = 0) {
    this.words = words;
    this.segments = segments;
    this.order = order;
    const seg = (id: string) => segments[id] ?? fail(`no segment ${id}`);
    const bounds = [start];
    for (let i = 0; i + 1 < order.length; i++) bounds.push(round((seg(order[i]!).end + seg(order[i + 1]!).start) / 2, 3));
    this.end = round(seg(order[order.length - 1]!).end + TAIL, 3);
    bounds.push(this.end);
    this.#spans = new Map(order.map((id, i) => [id, [bounds[i]!, bounds[i + 1]!]]));
  }

  segment(id: string): { start: number; end: number } {
    return this.segments[id] ?? fail(`no segment ${id} (segments: ${this.order.join(", ")})`);
  }

  /** A scene's [start, end] on the video's clock. */
  span(id: string): [number, number] {
    const s = this.#spans.get(id) ?? fail(`no segment ${id} (segments: ${this.order.join(", ")})`);
    return [s[0], s[1]];
  }

  /**
   * When `phrase` starts in segment `seg`: the first word's start time. Matching ignores case and
   * punctuation. Put visuals on cues so they never run ahead of the voice.
   */
  cue(seg: string, phrase: string): number {
    const s = this.segment(seg);
    const target = phrase.split(/\s+/).filter(Boolean).map(norm);
    const idx: number[] = [];
    this.words.forEach((w, i) => {
      if (s.start - 1e-3 <= w.start && w.start <= s.end + 1e-3) idx.push(i);
    });
    for (let k = 0; k + target.length <= idx.length; k++) {
      if (target.every((t, j) => norm(this.words[idx[k + j]!]!.word) === t)) return this.words[idx[k]!]!.start;
    }
    return fail(`cue '${phrase}' not found in ${seg}`);
  }

  /** `t` (video seconds) relative to the start of scene `id`. */
  rel(id: string, t: number): number {
    return round(t - this.span(id)[0], 3);
  }
}

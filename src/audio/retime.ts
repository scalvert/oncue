import { fixed, round } from "../core/numbers.ts";
import { ffmpeg } from "../media/ffmpeg.ts";
import type { NarrationLock, Word } from "../narration/lock.ts";
import { fadeOut, PAD_OUT, safeEnd, safeStart } from "./cuts.ts";
import type { Levels } from "./levels.ts";

/** Where the narration starts in the video, so the first frame can register. */
export const NARRATION_OFFSET = 0.6;

/** Check a pre-roll length: seconds before the first scene, which a composition can fill. */
export function checkPreRoll(preRoll: number): number {
  if (!Number.isFinite(preRoll) || preRoll < 0) throw new Error(`preRoll must be a number of seconds >= 0 (got ${preRoll})`);
  return preRoll;
}

export interface RetimeOptions {
  /** Silence after each segment, by id (seconds). Segments not listed get `defaultGap`. */
  gaps?: Record<string, number>;
  defaultGap?: number;
  /**
   * How each clip's end is cut. `safe` (default) stops short of stray sound the aligner didn't
   * attribute to a word; `pad` always keeps PAD_OUT after the last word.
   */
  endCut?: "safe" | "pad";
  /**
   * Seconds before the first scene (default 0). The narration and every scene start this much
   * later, and a composition can draw an intro in [0, preRoll).
   */
  preRoll?: number;
}

/** The retimed narration: segment and word times on the video's clock, and how to make the audio. */
export interface RetimePlan {
  segments: Record<string, { start: number; end: number }>;
  words: Word[];
  /** ffmpeg -filter_complex graph from the take ([0:a]) to [out]. */
  filterGraph: string;
}

/**
 * Cut the take at segment boundaries and put silence after each segment. Only silence is
 * inserted, and words are never moved within a segment, so the same lock always gives the same
 * timeline. Pure: the caller supplies the take's levels and runs the graph (applyRetime).
 */
export function planRetime(lock: NarrationLock, level: Levels, opts: RetimeOptions = {}): RetimePlan {
  const { gaps = {}, defaultGap = 0.8, endCut = "safe", preRoll = 0 } = opts;
  const takeEnd = level.length / 100;
  const filters: string[] = [];
  const labels: string[] = [];
  const segments: RetimePlan["segments"] = {};
  const words: Word[] = [];
  let t = checkPreRoll(preRoll) + NARRATION_OFFSET;
  let prevEnd = 0;
  lock.segments.forEach((s, i) => {
    const a = safeStart(level, s.start, prevEnd);
    const b = Math.min(endCut === "safe" ? safeEnd(level, s.end) : s.end + PAD_OUT, takeEnd);
    prevEnd = b;
    const shift = t - a;
    segments[s.id] = { start: s.start + shift, end: s.end + shift };
    for (const w of lock.words) {
      if (s.start - 1e-3 <= w.start && w.start <= s.end + 1e-3) {
        words.push({ word: w.word, start: round(w.start + shift, 3), end: round(w.end + shift, 3) });
      }
    }
    const fade = fadeOut(level, a, b);
    filters.push(
      `[0:a]atrim=start=${fixed(a, 3)}:end=${fixed(b, 3)},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${fixed(Math.max(0, b - a - fade), 3)}:d=${fixed(fade, 3)}[a${i}]`,
    );
    labels.push(`[a${i}]`);
    const last = i === lock.segments.length - 1;
    const gap = last ? 0 : (gaps[s.id] ?? defaultGap);
    if (gap > 0) {
      filters.push(`anullsrc=r=44100:cl=mono,atrim=duration=${fixed(gap, 3)}[g${i}]`);
      labels.push(`[g${i}]`);
    }
    t += b - a + gap;
  });
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
  return { segments, words, filterGraph: filters.join(";") };
}

/** Write the retimed narration (mono MP3, 160 kbps). */
export function applyRetime(take: string, plan: RetimePlan, out: string): void {
  ffmpeg(["-i", take, "-filter_complex", plan.filterGraph, "-map", "[out]", "-ac", "1", "-b:a", "160k", out]);
}

/**
 * The untrimmed take, faded out at its end: it often stops before its last word has died away
 * (fadeOut in cuts.ts). For videos that play the take as recorded instead of retiming it.
 */
export function writeFadedTake(take: string, level: Levels, out: string): void {
  const end = level.length / 100;
  const fade = fadeOut(level, 0, end);
  ffmpeg(["-i", take, "-af", `afade=t=out:st=${fixed(end - fade, 3)}:d=${fixed(fade, 3)}`, "-ac", "1", "-b:a", "160k", out]);
}

/**
 * For audio that plays the take untrimmed: silence everything between segments (stray breaths or
 * artifacts the aligner didn't attribute to a word), using the same cuts as planRetime().
 * `offset` is where the take starts in `src`. Returns the number of gaps silenced.
 */
export function gateGaps(lock: NarrationLock, level: Levels, src: string, dst: string, offset = 0): number {
  const windows: string[] = [];
  const segs = lock.segments;
  for (let k = 0; k + 1 < segs.length; k++) {
    const end = safeEnd(level, segs[k]!.end);
    const lo = end + offset;
    const hi = safeStart(level, segs[k + 1]!.start, end) + offset;
    if (hi - lo > 0.05) windows.push(`between(t,${fixed(lo, 3)},${fixed(hi, 3)})`);
  }
  const af = windows.length ? `volume=0:enable='${windows.join("+")}'` : "anull";
  ffmpeg(["-i", src, "-af", af, "-b:a", "160k", dst]);
  return windows.length;
}

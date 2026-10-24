import { join, dirname } from "node:path";
import { readJson } from "../core/json.ts";
import { round } from "../core/numbers.ts";
import type { NarrationLock } from "../narration/lock.ts";
import { PAD_IN, safeEnd, safeStart } from "./cuts.ts";
import { levels, windowedLevel } from "./levels.ts";

/**
 * Speech the aligner may have missed. The ElevenLabs alignment sometimes misses a trailing sound
 * (a repeated word, a breath, an artifact), which a cut at the aligned end would chop mid-way.
 * It also sometimes marks a segment's first word late. `gv narrate` and `gv check` report both;
 * "AT RISK" means a person listens to that segment.
 */

export interface TailFinding {
  segment: string;
  alignedEnd: number;
  from: number;
  to: number;
  verdict: string;
}

export interface StartFinding {
  segment: string;
  alignedStart: number;
  clipStart: number;
  verdict: string;
}

const takeOf = (lockPath: string) => join(dirname(lockPath), "narration.mp3");

/** Speech-level sound between a segment's aligned end and the next segment's start. */
export function scanTails(lockPath: string): TailFinding[] {
  const d = readJson<NarrationLock>(lockPath);
  const take = windowedLevel(takeOf(lockPath));
  const segs = d.segments;
  const hits: TailFinding[] = [];
  segs.forEach((s, k) => {
    const next = k + 1 < segs.length ? segs[k + 1]!.start : take.duration;
    const loud: number[] = [];
    for (let t = s.end + 0.1; t < next - 0.1; t += 0.05) {
      if (take.at(t) > -35) loud.push(round(t, 2));
    }
    if (loud.length < 3) return;
    // A quiet gap right after the last word means the cut lands in silence and drops the stray
    // sound cleanly. No gap means speech may run past the aligned end: listen to that segment.
    let quietest = Infinity;
    for (let j = 2; j < 11; j++) quietest = Math.min(quietest, take.at(s.end + j * 0.02));
    hits.push({
      segment: s.id,
      alignedEnd: round(s.end, 2),
      from: loud[0]!,
      to: loud[loud.length - 1]!,
      verdict: quietest < -50 ? "cut cleanly" : "AT RISK: listen",
    });
  });
  return hits;
}

/** Every segment whose clip start safeStart() moved, and any it still can't reclaim. */
export function scanStarts(lockPath: string): StartFinding[] {
  const d = readJson<NarrationLock>(lockPath);
  const level = levels(takeOf(lockPath)); // the same levels retime cuts with
  const hits: StartFinding[] = [];
  let prevEnd = 0;
  for (const s of d.segments) {
    const a = safeStart(level, s.start, prevEnd);
    const moved = a < round(Math.max(0, s.start - PAD_IN), 3) - 1e-6;
    const i = Math.trunc(a * 100);
    // Sound just before the cut is lost only if the previous clip doesn't reach it either.
    const still = i > 0 && level[i - 1]! > -45 && a > prevEnd + 0.011;
    prevEnd = safeEnd(level, s.end);
    if (still) hits.push({ segment: s.id, alignedStart: round(s.start, 2), clipStart: round(a, 2), verdict: "AT RISK: speech runs up to the cut, listen" });
    else if (moved) hits.push({ segment: s.id, alignedStart: round(s.start, 2), clipStart: round(a, 2), verdict: "start reclaimed" });
  }
  return hits;
}

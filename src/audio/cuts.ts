import type { Levels } from "./levels.ts";

/** Where a segment's clip is cut from the take. Pure functions over a level array (levels.ts). */

/** Lead-in kept before a segment's first aligned word. */
export const PAD_IN = 0.04;
/** Tail kept after a segment's last aligned word. */
export const PAD_OUT = 0.22;
/** Most speech safeStart() will reclaim before a segment's aligned start. */
export const MAX_LEAD = 0.8;

const frame = (t: number) => Math.trunc(t * 100);

/**
 * Cut at start - PAD_IN, unless speech is already under way there. The aligner sometimes marks a
 * segment's first word late (often after an audio tag), and cutting there drops the word's
 * opening ("Next" plays as "...xt"). Then walk back through the continuous sound to where it
 * starts, never past `floor` (the previous segment's cut) or more than MAX_LEAD.
 */
export function safeStart(level: Levels, start: number, floor = 0): number {
  const a = Math.max(0, start - PAD_IN);
  let i = Math.min(frame(a), level.length - 1);
  const lo = Math.max(frame(floor) + 1, frame(a - MAX_LEAD), 0);
  if (i <= lo || level[i - 1]! <= -45) return a;
  while (i > lo && level[i - 1]! > -45) i -= 1;
  return Math.max(floor, i / 100 - 0.02);
}

/**
 * Cut at end + PAD_OUT, unless sound the aligner didn't attribute to a word (a stray breath,
 * repeat, or artifact) starts inside the pad. Then cut in the quiet gap before it, so it isn't
 * chopped mid-way.
 */
export function safeEnd(level: Levels, end: number): number {
  const b = end + PAD_OUT;
  const i0 = frame(end);
  const i1 = Math.min(frame(b), level.length - 1);
  let quiet: number | null = null;
  for (let i = i0; i <= i1; i++) {
    if (level[i]! < -50 && quiet === null) quiet = i;
    else if (quiet !== null && level[i]! > -40) return quiet / 100 + 0.03;
  }
  return b;
}

/**
 * Fade length at a clip's cut. Usually the cut is in silence and 30 ms just avoids a click. But
 * an ElevenLabs take often stops before its last word has died away ("com." ends at -28 dB), and
 * cutting there is audible. Then fade over 150 ms so the word decays instead of stopping dead.
 */
export function fadeOut(level: Levels, a: number, b: number): number {
  const tail = level.slice(Math.max(0, frame(b) - 4), frame(b));
  const live = tail.length > 0 && Math.max(...tail) > -45;
  return Math.min(live ? 0.15 : 0.03, Math.max(0, b - a));
}

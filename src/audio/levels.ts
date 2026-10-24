import { decodePcm } from "../media/ffmpeg.ts";

/**
 * Loudness envelopes of a take. A level array has one RMS value (dBFS) per 10 ms frame: index i
 * covers [i/100, (i+1)/100) seconds.
 */
export type Levels = readonly number[];

/** Frames per second in a level array. */
export const FRAMES_PER_SECOND = 100;

const dbfs = (sumSquares: number, n: number) => 20 * Math.log10(Math.max(Math.sqrt(sumSquares / n), 1) / 32768);

function rms(pcm: Int16Array, start: number, n: number): number {
  let sum = 0;
  for (let i = start; i < start + n; i++) sum += pcm[i]! * pcm[i]!;
  return dbfs(sum, n);
}

/**
 * Per-10 ms level of a take, for the cut points in cuts.ts. Measured at 16 kHz: an "s" or "f"
 * carries most of its energy above 4 kHz, so at 8 kHz a word's opening hiss read as
 * near-silence, and the start cut clipped it ("Start" lost its "s").
 */
export function levels(take: string): number[] {
  const rate = 16000;
  const n = rate / FRAMES_PER_SECOND;
  const pcm = decodePcm(take, rate);
  const out: number[] = [];
  for (let i = 0; i < pcm.length - n; i += n) out.push(rms(pcm, i, n));
  return out;
}

/** A take's samples with a level function over 50 ms windows at any time, for scan.ts. */
export function windowedLevel(take: string): { duration: number; at: (t: number) => number } {
  const rate = 16000;
  const n = rate / 20;
  const pcm = decodePcm(take, rate);
  return {
    duration: pcm.length / rate,
    at(t) {
      const i = Math.trunc(t * rate);
      const len = Math.max(0, Math.min(n, pcm.length - i));
      return len ? rms(pcm, i, len) : -99;
    },
  };
}

import { run, runBytes } from "../core/exec.ts";

/**
 * ffmpeg and ffprobe, the only media tools gv uses (plus cwebp for posters). Every call is
 * synchronous: renders are long anyway, and ordering is simpler to reason about.
 */

/** Run ffmpeg quietly (-v error), failing on a non-zero exit. */
export function ffmpeg(args: string[]): void {
  runBytes("ffmpeg", ["-v", "error", "-y", ...args], { capture: false });
}

/** ffmpeg's stderr report (loudnorm, ssim) for an analysis pass that writes no file. */
export function ffmpegReport(args: string[]): string {
  return run("ffmpeg", ["-hide_banner", ...args, "-f", "null", "-"], { check: false }).stderr;
}

/** Decode audio to mono signed 16-bit PCM at `rate` Hz. */
export function decodePcm(path: string, rate: number): Int16Array {
  const out = runBytes("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]).stdout;
  const copy = new Uint8Array(out.byteLength - (out.byteLength % 2));
  copy.set(out.subarray(0, copy.byteLength));
  return new Int16Array(copy.buffer);
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  audio: boolean;
}

export function probe(path: string): Probe {
  const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]).stdout;
  const j = JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] };
  const v = j.streams.find((s) => s.codec_type === "video");
  return {
    duration: Number(j.format.duration),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    audio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

/** Container duration in seconds. */
export function duration(path: string): number {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout.trim());
}

/** Width and height of an image or video's first stream. */
export function dimensions(path: string): [number, number] {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]).stdout;
  const [w, h] = out.trim().split(",").map(Number);
  return [w!, h!];
}

/** Integrated loudness (LUFS), or null if ffmpeg didn't report it. */
export function loudness(path: string): number | null {
  const m = /Input Integrated:\s+(-?[\d.]+)/.exec(ffmpegReport(["-i", path, "-af", "loudnorm=print_format=summary"]));
  return m ? Number(m[1]) : null;
}

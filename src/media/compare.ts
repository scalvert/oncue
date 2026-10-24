import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../core/exec.ts";
import { round } from "../core/numbers.ts";
import { ffmpeg, ffmpegReport, probe } from "./ffmpeg.ts";

export interface Comparison {
  ssim: number;
  audioIdentical: boolean;
  durationDelta: number;
}

/**
 * Is `a` the same video as `b`? Chrome rendering isn't bit-exact, so video is compared by SSIM;
 * audio is compared exactly (decoded PCM).
 */
export function compare(a: string, b: string): Comparison {
  const m = /All:([\d.]+)/.exec(ffmpegReport(["-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim"]));
  const pcm = [a, b].map((f) => run("ffmpeg", ["-v", "error", "-i", f, "-map", "0:a", "-f", "md5", "-"], { check: false }).stdout.trim());
  return {
    ssim: m ? Number(m[1]) : 0,
    audioIdentical: pcm[0] === pcm[1] && Boolean(pcm[0]),
    durationDelta: round(Math.abs(probe(a).duration - probe(b).duration), 3),
  };
}

/** Same video: SSIM >= 0.999, identical audio, and lengths within 50 ms. */
export const isSame = (c: Comparison) => c.ssim >= 0.999 && c.audioIdentical && c.durationDelta < 0.05;

export interface FrameEvent {
  first: number;
  last: number;
  worst: number;
  ssim: number;
  image?: string;
  time?: number;
}

/**
 * Where do `a` and `b` visibly differ? Groups consecutive frames under `threshold` (SSIM) into
 * events and writes a side-by-side PNG (top: a, bottom: b) of each event's worst frame.
 */
export function frameReport(a: string, b: string, outDir: string, threshold = 0.99, maxEvents = 8): FrameEvent[] {
  mkdirSync(outDir, { recursive: true });
  const stats = join(outDir, "ssim.txt");
  run("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", `[0:v][1:v]ssim=stats_file=${stats}`, "-f", "null", "-"]);
  const events: FrameEvent[] = [];
  let cur: FrameEvent | null = null;
  for (const ln of readFileSync(stats, "utf8").split("\n").filter((l) => l.trim())) {
    const parts = Object.fromEntries(ln.split(/\s+/).filter((p) => p.includes(":")).map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]));
    const n = Number(parts.n) - 1;
    const s = Number(parts.All);
    if (s >= threshold) {
      cur = null;
      continue;
    }
    if (cur && n === cur.last + 1) {
      cur.last = n;
      if (s < cur.ssim) Object.assign(cur, { worst: n, ssim: s });
    } else {
      cur = { first: n, last: n, worst: n, ssim: s };
      events.push(cur);
    }
  }
  events.sort((x, y) => x.ssim - y.ssim);
  for (const e of events.slice(0, maxEvents)) {
    const n = e.worst;
    e.image = join(outDir, `frame-${String(n).padStart(5, "0")}.png`);
    ffmpeg([
      "-i", a, "-i", b, "-filter_complex",
      `[0:v]select=eq(n\\,${n}),scale=1280:-1[x];[1:v]select=eq(n\\,${n}),scale=1280:-1[y];[x][y]vstack`,
      "-frames:v", "1", e.image,
    ]);
    e.time = round(n / 30, 2);
  }
  return events;
}

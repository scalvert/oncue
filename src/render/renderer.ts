import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExplainerProps } from "../../composition/src/props.ts";
import { fixed, round } from "../core/numbers.ts";
import { ffmpeg, ffmpegReport } from "../media/ffmpeg.ts";
import { bundle, compositionDir, DEFAULT_WORKERS, explainerEntry, FPS, RenderPage, withBrowser } from "./page.ts";
import { StaticServer } from "./server.ts";

/**
 * The renderer: composition props -> frames in headless Chromium -> video, with ffmpeg.
 *
 *   renderRaw(props, raw)     -> raw.mov: x264 CRF 18 full-range yuvj420p, 90 kHz timescale, PCM narration
 *   finishAudio(raw, final)   -> the MP4: two-pass loudnorm to -16 LUFS, AAC 192k, faststart
 *   still(props, frame, png)  -> one lossless PNG (posters)
 *
 * Everything that decides a video's pixels and sound is here, in the package's composition/, or
 * in the repo's own composition: release/versions.ts fingerprints them to tell when a video needs
 * re-rendering.
 */
export class Renderer {
  readonly publicRoot: string;
  /** The composition module to mount (default: the built-in Explainer). */
  readonly composition: string;

  constructor(publicRoot: string, composition: string = explainerEntry()) {
    this.publicRoot = publicRoot;
    this.composition = composition;
  }

  async #serve<T>(fn: (server: StaticServer) => Promise<T>): Promise<T> {
    const page = mkdtempSync(join(tmpdir(), "oncue-page-"));
    try {
      await bundle(page, this.composition);
      const server = await StaticServer.start(page, this.publicRoot, join(compositionDir(), "public"));
      try {
        return await fn(server);
      } finally {
        await server.close();
      }
    } finally {
      rmSync(page, { recursive: true, force: true });
    }
  }

  /** Render the props at `propsPath` (under the public root) to `raw` (a .mov). Returns the frame count. */
  async renderRaw(propsPath: string, raw: string, workers = DEFAULT_WORKERS): Promise<number> {
    const props = JSON.parse(readFileSync(propsPath, "utf8")) as ExplainerProps;
    const frames = mkdtempSync(join(tmpdir(), "oncue-frames-"));
    try {
      const total = await this.#serve((server) => capture(server.url, server.pathOf(propsPath), frames, workers));
      this.#encode(frames, props, total, raw);
      return total;
    } finally {
      rmSync(frames, { recursive: true, force: true });
    }
  }

  #encode(frames: string, props: ExplainerProps, total: number, raw: string): void {
    const args = ["-framerate", String(FPS), "-i", join(frames, "%06d.jpg")];
    if (props.narrationSrc) {
      // The composition starts the narration at <Sequence from={round(narrationOffset * fps)}>.
      const start = round((round((props.narrationOffset ?? 0) * FPS) / FPS) * 48000);
      args.push(
        "-i", join(this.publicRoot, props.narrationSrc), "-map", "0:v", "-map", "1:a",
        "-af", `aresample=48000,adelay=delays=${start}S:all=1,apad`, "-ac", "2", "-c:a", "pcm_s16le",
      );
    }
    // JPEG frames go straight to full-range yuvj420p (no color conversion). A 90 kHz timescale
    // gives exact 3000-tick frames; millisecond containers make frame timestamps drift.
    args.push(
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuvj420p", "-colorspace", "bt470bg", "-color_range", "pc",
      "-video_track_timescale", "90000", "-t", fixed(total / FPS, 6), raw,
    );
    ffmpeg(args);
  }

  /**
   * Two-pass loudnorm (measure, then apply linearly to land on -16 LUFS / -1.5 dBTP), AAC 192k,
   * video stream copied, faststart.
   */
  finishAudio(raw: string, final: string): void {
    const meas = ffmpegReport(["-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json"]);
    const m = JSON.parse(meas.slice(meas.lastIndexOf("{"), meas.lastIndexOf("}") + 1)) as Record<string, string>;
    const af =
      `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    ffmpeg([
      "-i", raw, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
      "-video_track_timescale", "90000", "-movflags", "+faststart", final,
    ]);
  }

  /** One frame of `props` as a lossless PNG. */
  async still(props: ExplainerProps, frame: number, png: string): Promise<void> {
    mkdirSync(this.publicRoot, { recursive: true });
    const dir = mkdtempSync(join(this.publicRoot, ".oncue-still-"));
    try {
      const propsPath = join(dir, "props.json");
      writeFileSync(propsPath, JSON.stringify(props));
      await this.#serve((server) =>
        withBrowser(async (browser) => {
          const page = await RenderPage.open(browser, server.url, server.pathOf(propsPath));
          await page.frame(frame);
          await page.page.screenshot({ path: png, type: "png" });
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Capture every frame as JPEG, splitting the frames across `workers` pages. */
async function capture(base: string, propsUrl: string, dir: string, workers: number): Promise<number> {
  return withBrowser(async (browser) => {
    const first = await RenderPage.open(browser, base, propsUrl);
    const total = first.config.durationInFrames;
    const chunk = Math.ceil(total / workers);
    const pages = [first];
    for (let i = 1; i < workers; i++) pages.push(await RenderPage.open(browser, base, propsUrl));
    await Promise.all(
      pages.map(async (pg, i) => {
        for (let n = i * chunk; n < Math.min(total, (i + 1) * chunk); n++) {
          await pg.frame(n);
          await pg.page.screenshot({ path: join(dir, `${String(n).padStart(6, "0")}.jpg`), type: "jpeg", quality: 80 });
        }
      }),
    );
    return total;
  });
}

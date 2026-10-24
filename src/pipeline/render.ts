import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExplainerProps } from "../../composition/src/props.ts";
import { run } from "../core/exec.ts";
import { fixed, round } from "../core/numbers.ts";
import { duration, ffmpeg, loudness } from "../media/ffmpeg.ts";
import { Renderer } from "../render/renderer.ts";
import { writeSidecar } from "../release/versions.ts";
import type { Project } from "../workspace/project.ts";
import type { Workspace } from "../workspace/workspace.ts";
import { type BuildOptions, buildProject } from "./build.ts";

/** The renderer for a workspace: its public root, and its own composition if the config names one. */
export const rendererFor = (ws: Workspace): Renderer =>
  new Renderer(ws.paths.public, ws.config.composition ? join(ws.root, ws.config.composition) : undefined);

/** Move the previous render to renders/archive/<name>-<mtime>.mp4, so a new one never overwrites it. */
export function archive(p: Project): void {
  if (!existsSync(p.output)) return;
  const dir = join(dirname(p.output), "archive");
  mkdirSync(dir, { recursive: true });
  const d = statSync(p.output).mtime;
  const n = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}${n(d.getMonth() + 1)}${n(d.getDate())}-${n(d.getHours())}${n(d.getMinutes())}${n(d.getSeconds())}`;
  renameSync(p.output, join(dir, `${basename(p.output, ".mp4")}-${stamp}.mp4`));
}

/** QA contact sheet: one 640px frame per time, tiled three wide, at renders/qa/sheet.png. */
export function qaSheet(video: string, qaDir: string, times: number[]): { sheet: string; rows: number } {
  mkdirSync(qaDir, { recursive: true });
  const frames = times.map((t) => {
    const f = join(qaDir, `${fixed(t, 2)}.png`);
    ffmpeg(["-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=640:-1", f]);
    return f;
  });
  while (frames.length % 3) frames.push(frames.at(-1)!);
  const layout = frames.map((_, i) => `${(i % 3) * 640}_${Math.floor(i / 3) * 360}`).join("|");
  const fc = frames.map((_, i) => `[${i}]`).join("") + `xstack=inputs=${frames.length}:layout=${layout}[o]`;
  const sheet = join(qaDir, "sheet.png");
  ffmpeg([...frames.flatMap((f) => ["-i", f]), "-filter_complex", fc, "-map", "[o]", sheet]);
  return { sheet, rows: frames.length / 3 };
}

/** 1280x720 WebP of the last moment of the first scene, captions off (the title card). */
export async function poster(p: Project, renderer: Renderer): Promise<string> {
  const props = JSON.parse(readFileSync(p.propsPath, "utf8")) as ExplainerProps;
  props.captions = [];
  const frame = Math.trunc((props.scenes[0]!.end - 0.4) * 30);
  const tmp = mkdtempSync(join(tmpdir(), "oncue-poster-"));
  try {
    const png = join(tmp, "poster.png");
    await renderer.still(props, frame, png);
    mkdirSync(dirname(p.poster), { recursive: true });
    const small = join(tmp, "poster-720.png");
    ffmpeg(["-i", png, "-vf", "scale=1280:720:flags=lanczos", small]);
    // cwebp, not ffmpeg: many ffmpeg builds (Homebrew's included) ship without libwebp.
    run("cwebp", ["-quiet", "-q", "82", small, "-o", p.poster]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return p.poster;
}

export interface RenderOptions extends BuildOptions {
  renderer?: Renderer;
  workers?: number;
}

/** Build, render, normalize loudness, QA sheet, poster, and the fingerprint sidecar. */
export async function renderProject(ws: Workspace, p: Project, opts: RenderOptions = {}): Promise<string> {
  const log = opts.log ?? console.log;
  const renderer = opts.renderer ?? rendererFor(ws);
  archive(p);
  const props = await buildProject(ws, p, { ...opts, mode: "frozen" });
  mkdirSync(p.rendersDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), `oncue-${p.publicName}-`));
  try {
    const raw = join(tmp, "raw.mov");
    await renderer.renderRaw(p.propsPath, raw, opts.workers);
    renderer.finishAudio(raw, p.output);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const { sheet, rows } = qaSheet(p.output, p.qaDir, props.scenes.map((s) => round((s.start + s.end) / 2, 2)));
  const lufs = loudness(p.output);
  log(`rendered ${p.output} (${fixed(duration(p.output), 1)}s, ${lufs ?? "?"} LUFS); QA sheet: ${sheet} (${rows} rows)`);
  await poster(p, renderer);
  writeSidecar(ws, p);
  return p.output;
}

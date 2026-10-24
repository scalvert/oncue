/**
 * `doctor`: whether this machine can narrate, render, and capture, and what to install if not.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findRoot } from "../config/load.ts";
import { run } from "../core/exec.ts";
import { loadEnv } from "../core/files.ts";
import { packageRoot } from "../core/program.ts";

export interface Finding {
  ok: boolean;
  /** Missing but only needed for some commands. */
  optional?: boolean;
  what: string;
  detail: string;
}

const has = (cmd: string, args = ["-version"]) => {
  try {
    return run(cmd, args, { check: false }).status === 0;
  } catch {
    return false;
  }
};

export async function doctor(from: string = process.cwd()): Promise<Finding[]> {
  const out: Finding[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  out.push({
    ok: major > 22 || (major === 22 && minor >= 18),
    what: "Node.js >= 22.18",
    detail: `found ${process.versions.node}; oncue runs TypeScript configs and build scripts with Node's type stripping`,
  });
  out.push({ ok: has("ffmpeg"), what: "ffmpeg", detail: "encodes renders and measures audio (brew install ffmpeg / apt install ffmpeg)" });
  out.push({ ok: has("ffprobe"), what: "ffprobe", detail: "reads durations and streams (comes with ffmpeg)" });
  out.push({ ok: has("cwebp", ["-version"]), what: "cwebp", detail: "writes posters (brew install webp / apt install webp)" });

  let chromium = false;
  try {
    const { chromium: c } = await import("playwright");
    chromium = existsSync(c.executablePath());
  } catch {
    chromium = false;
  }
  out.push({ ok: chromium, what: "Playwright Chromium", detail: "renders frames (npx playwright install chromium)" });

  let pty = false;
  try {
    createRequire(join(packageRoot(), "package.json")).resolve("node-pty");
    pty = true;
  } catch {
    pty = false;
  }
  out.push({ ok: pty, optional: true, what: "node-pty", detail: "only for `capture cli` (an optional dependency; needs build tools)" });

  const root = findRoot(from);
  out.push({ ok: root !== null, what: "oncue.config.ts", detail: root ? `repo at ${root}` : "not in an oncue repo (run `oncue init`)" });
  if (root) {
    loadEnv(join(root, ".env"));
    out.push({ ok: existsSync(join(root, "catalog", "voice.json")), what: "house voice", detail: "catalog/voice.json" });
  }
  out.push({
    ok: Boolean(process.env.ELEVENLABS_API_KEY),
    optional: true,
    what: "ELEVENLABS_API_KEY",
    detail: "only for `narrate` (set it in .env); builds and renders use the locked takes",
  });
  return out;
}

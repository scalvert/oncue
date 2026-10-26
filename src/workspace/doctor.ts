/**
 * `doctor`: whether this machine can narrate, render, and capture, and how to fix what's missing.
 *
 * Each finding has a `fix`: a command for this OS when there is one, otherwise a plain
 * instruction. An agent setting up a machine for someone runs the fixes (asking first for
 * anything that installs software) and runs `doctor` again.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findRoot } from "../config/load.ts";
import { run } from "../core/exec.ts";
import { loadEnv } from "../core/files.ts";
import { packageRoot } from "../core/program.ts";
import { isPlaceholder } from "../narration/placeholder.ts";
import { SKILLS_DIR, skillStates } from "./skills.ts";

export interface Finding {
  ok: boolean;
  /** Missing but only needed for some commands. */
  optional?: boolean;
  what: string;
  detail: string;
  /** How to fix it: a command for this OS, or what the person has to do. */
  fix?: string;
}

const has = (cmd: string, args = ["-version"]) => {
  try {
    return run(cmd, args, { check: false }).status === 0;
  } catch {
    return false;
  }
};

/** The install command for a system package on this OS. */
function install(pkg: { brew: string; apt: string; winget?: string }): string {
  if (process.platform === "darwin") return has("brew", ["--version"]) ? `brew install ${pkg.brew}` : `install Homebrew (https://brew.sh), then: brew install ${pkg.brew}`;
  if (process.platform === "win32") return pkg.winget ? `winget install ${pkg.winget}` : `install ${pkg.brew}`;
  return `sudo apt-get install -y ${pkg.apt}`;
}

export async function doctor(from: string = process.cwd()): Promise<Finding[]> {
  const out: Finding[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  out.push({
    ok: major > 22 || (major === 22 && minor >= 18),
    what: "Node.js >= 22.18",
    detail: `found ${process.versions.node}; oncue runs TypeScript configs and build scripts with Node's type stripping`,
    fix: install({ brew: "node@22", apt: "nodejs (22.18 or later, from https://nodejs.org)", winget: "OpenJS.NodeJS.LTS" }),
  });
  out.push({ ok: has("ffmpeg"), what: "ffmpeg", detail: "encodes renders and measures audio", fix: install({ brew: "ffmpeg", apt: "ffmpeg", winget: "Gyan.FFmpeg" }) });
  out.push({ ok: has("ffprobe"), what: "ffprobe", detail: "reads durations and streams (comes with ffmpeg)", fix: install({ brew: "ffmpeg", apt: "ffmpeg", winget: "Gyan.FFmpeg" }) });
  out.push({ ok: has("cwebp", ["-version"]), what: "cwebp", detail: "writes posters", fix: install({ brew: "webp", apt: "webp" }) });

  let chromium = false;
  try {
    const { chromium: c } = await import("playwright");
    chromium = existsSync(c.executablePath());
  } catch {
    chromium = false;
  }
  out.push({ ok: chromium, what: "Playwright Chromium", detail: "renders frames", fix: "npx playwright install chromium" });

  let pty = false;
  try {
    createRequire(join(packageRoot(), "package.json")).resolve("node-pty");
    pty = true;
  } catch {
    pty = false;
  }
  out.push({
    ok: pty,
    optional: true,
    what: "node-pty",
    detail: "only for `capture cli` (an optional dependency; needs build tools)",
    fix: process.platform === "darwin" ? "xcode-select --install, then npm rebuild node-pty" : "install a C++ toolchain, then npm rebuild node-pty",
  });

  const root = findRoot(from);
  out.push({ ok: root !== null, what: "oncue.config.ts", detail: root ? `repo at ${root}` : "not in an oncue repo", fix: "npx oncue init" });
  let placeholder = true;
  if (root) {
    loadEnv(join(root, ".env"));
    const voiceFile = join(root, "catalog", "voice.json");
    const voice = existsSync(voiceFile);
    out.push({ ok: voice, what: "house voice", detail: "catalog/voice.json", fix: "npx oncue init (writes the placeholder voice)" });
    for (const s of skillStates(root)) {
      out.push({
        ok: s.state === "current",
        // Agents work without it; it's how they learn the workflow.
        optional: true,
        what: `agent skill ${s.name}`,
        detail:
          s.state === "current"
            ? `${SKILLS_DIR}/${s.name} matches this oncue`
            : s.state === "missing"
              ? `not in ${SKILLS_DIR}; agents learn the workflow from it`
              : `${SKILLS_DIR}/${s.name} differs from this oncue's (an upgrade, or a local edit it would replace)`,
        fix: "npx oncue skills",
      });
    }
    if (voice) {
      try {
        placeholder = isPlaceholder(JSON.parse(readFileSync(voiceFile, "utf8")) as { voice_id: string });
      } catch {
        placeholder = true;
      }
    }
  }
  out.push({
    ok: Boolean(process.env.ELEVENLABS_API_KEY),
    // Only `narrate` needs it: building, rendering, and checking use the locked takes.
    optional: true,
    what: "ELEVENLABS_API_KEY",
    detail: placeholder
      ? "not needed yet: the house voice is the offline placeholder"
      : "needed to record narration with the house voice; builds and renders use the locked takes",
    fix: "the person adds ELEVENLABS_API_KEY=... to .env themselves (never paste a key into a chat)",
  });
  return out;
}

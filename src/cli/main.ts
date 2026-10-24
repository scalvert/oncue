#!/usr/bin/env node
/**
 * The oncue CLI. Run it anywhere inside a repo with an oncue.config.ts.
 *
 * Every command is a thin wrapper: the work happens in src/pipeline, src/release, src/checks, and
 * src/media, which take a Workspace and can be called from scripts and tests the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Command, Option } from "commander";
import { check, quickCheck } from "../checks/checks.ts";
import { findRoot } from "../config/load.ts";
import { OncueError, fail } from "../core/errors.ts";
import { loadEnv } from "../core/files.ts";
import { dumps } from "../core/json.ts";
import { pyFloat } from "../core/numbers.ts";
import { cmd, packageVersion } from "../core/program.ts";
import { padEnd, pyRepr, slice } from "../core/text.ts";
import { scanTails } from "../audio/scan.ts";
import { compare, frameReport, isSame } from "../media/compare.ts";
import { buildProject, narrate } from "../pipeline/build.ts";
import { poster, rendererFor, renderProject } from "../pipeline/render.ts";
import { deploy } from "../release/deploy.ts";
import * as registry from "../release/registry.ts";
import { saveLedger } from "../release/versions.ts";
import { status } from "../release/status.ts";
import { doctor } from "../workspace/doctor.ts";
import { initRepo, isEsmRepo, newVideo } from "../workspace/scaffold.ts";
import { Workspace } from "../workspace/workspace.ts";

async function loadRepo(): Promise<Workspace | null> {
  if (!findRoot()) return null;
  try {
    return await Workspace.load();
  } catch (e) {
    if (!(e instanceof OncueError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}

// The repo, if we're in one. `init` and `doctor` work without it; every other command needs it.
const found = await loadRepo();
// API keys and the experiment-only voice overrides (.env.example). Real environment variables win.
if (found) loadEnv(found.paths.env);
const repo = (): Workspace => found ?? fail(`no oncue.config.ts here or in any parent folder. Run ${cmd("init")} to create one.`);
const rel = (p: string) => relative(found?.root ?? process.cwd(), p);
const heading = (name: string) => console.log(`\n=== ${name}`);
const home = (p: string) => resolve(p.replace(/^~(?=\/)/, process.env.HOME ?? "~"));

const program = new Command(found?.config.cli.name ?? "oncue")
  .description(found?.config.cli.description ?? "Narrated developer videos. <video> is a folder under projects/ or a video id.")
  .version(packageVersion())
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: false });

program
  .command("init")
  .description("create a video repo here (or in DIR): config, catalog, house voice, and a first video")
  .argument("[dir]", "where", ".")
  .option("--name <name>", "brand label for the videos (default: the folder name)")
  .action(async (dir: string, o: { name?: string }) => {
    const root = resolve(dir);
    const wrote = initRepo(root, o.name);
    for (const f of wrote) console.log(`wrote ${f}`);
    if (!wrote.length) console.log("nothing to write: every template file is already there");
    const ws = await Workspace.load(root);
    if (!existsSync(join(ws.paths.projects, "hello"))) {
      newVideo(ws, { folder: "hello", id: "hello", title: "Hello", track: "getting-started" });
      console.log("wrote projects/hello/");
    }
    if (!isEsmRepo(root)) console.log("note: add \"type\": \"module\" to package.json, or Node warns each time it loads oncue.config.ts");
    console.log(
      [
        "",
        "Next:",
        "  npm install --save-dev oncue        # if this repo doesn't have it yet",
        "  npx playwright install chromium",
        "  npx oncue doctor",
        "  npx oncue narrate hello && npx oncue render hello",
        "",
        "The house voice is a placeholder (tones), so that works offline. For a real voice, set",
        "catalog/voice.json to an ElevenLabs voice and put ELEVENLABS_API_KEY in .env (see .env.example).",
      ].join("\n"),
    );
  });

program
  .command("doctor")
  .description("check this machine and repo: Node, ffmpeg, cwebp, Chromium, keys")
  .action(async () => {
    const findings = await doctor();
    for (const f of findings) console.log(`${f.ok ? "ok     " : f.optional ? "skip   " : "MISSING"} ${padEnd(f.what, 22)} ${f.detail}`);
    process.exitCode = findings.some((f) => !f.ok && !f.optional) ? 1 : 0;
  });

program
  .command("list")
  .description("every video, its status, and what's blocking it")
  .action(() => {
    const ws = repo();
    console.log(`${padEnd("folder", 24)} ${padEnd("id", 18)} ${padEnd("vis", 8)} ${padEnd("render", 7)} status`);
    for (const p of ws.projects()) {
      const r = quickCheck(ws, p);
      let line = r.errors.length ? slice(r.errors[0]!.slice(r.errors[0]!.indexOf(": ") + 2), 0, 70) : "ok";
      if (p.meta.visibility === "preview" && !r.errors.length) line = slice(p.meta.previewReason ?? "", 0, 70);
      const vis = padEnd(String(p.meta.visibility ?? "?"), 8);
      console.log(`${padEnd(p.name, 24)} ${padEnd(p.id, 18)} ${vis} ${padEnd(existsSync(p.output) ? "yes" : "-", 7)} ${line}`);
    }
  });

program
  .command("new")
  .description("scaffold a video from the video template")
  .argument("<folder>", "folder name under projects/")
  .requiredOption("--id <id>", "video id (stable; the site's URL)")
  .requiredOption("--title <title>", "video title")
  .requiredOption("--track <track>", "track id from catalog/catalog.json")
  .action((folder: string, o: { id: string; title: string; track: string }) => {
    const ws = repo();
    const dst = newVideo(ws, { folder, ...o });
    console.log(`created ${rel(dst)}. Next: write narration.tsv, then ${cmd(`narrate ${folder}`)}.`);
  });

const videosCommand = (name: string, description: string) =>
  program.command(name).description(description).argument("[videos...]", "folders or ids").option("--all", "every video");

videosCommand("narrate", "(re)generate the narration take with the house voice (ElevenLabs needs ELEVENLABS_API_KEY)").action(async (videos: string[], o: { all?: boolean }) => {
  const ws = repo();
  for (const p of ws.resolve(videos, o.all)) {
    heading(p.name);
    await narrate(ws, p, { mode: "update" });
    await buildProject(ws, p, { mode: "frozen" });
    for (const f of scanTails(p.lock)) console.log(`  ${f.segment}: sound after the aligned end (${pyFloat(f.from)}-${pyFloat(f.to)}s) -> ${f.verdict}`);
    console.log(`  locked take: ${rel(p.take)}. Listen to it before you commit it.`);
  }
});

videosCommand("build", "narration lock -> props (frozen: never calls the voice)").action(async (videos: string[], o: { all?: boolean }) => {
  const ws = repo();
  for (const p of ws.resolve(videos, o.all)) {
    heading(p.name);
    await buildProject(ws, p, { mode: "frozen" });
  }
});

videosCommand("render", "build + render + loudness + QA sheet + poster")
  .addOption(new Option("--workers <n>", "browser pages rendering in parallel").argParser(Number))
  .action(async (videos: string[], o: { all?: boolean; workers?: number }) => {
    const ws = repo();
    const renderer = rendererFor(ws);
    const done = [];
    for (const p of ws.resolve(videos, o.all)) {
      heading(p.name);
      await renderProject(ws, p, { renderer, workers: o.workers });
      done.push(p);
    }
    heading("rendered");
    for (const p of done) console.log(`${padEnd(p.name, 24)} ${rel(p.output)}  QA: ${rel(join(p.qaDir, "sheet.png"))}`);
  });

videosCommand("poster", "just the poster (from the current props)").action(async (videos: string[], o: { all?: boolean }) => {
  const ws = repo();
  const renderer = rendererFor(ws);
  for (const p of ws.resolve(videos, o.all)) console.log(rel(await poster(p, renderer)));
});

program
  .command("compare")
  .description("same video? (SSIM >= 0.999, identical audio, same length); exits 1 if not")
  .argument("<video>", "folder or id: compares its current render")
  .argument("<other>", "the MP4 to compare against (an accepted version, say)")
  .option("--frames <dir>", "list visibly different frames and save side-by-sides to DIR")
  .action((video: string, other: string, o: { frames?: string }) => {
    const p = repo().resolve([video])[0]!;
    const against = home(other);
    const r = compare(p.output, against);
    let same = isSame(r);
    console.log(
      `SSIM ${r.ssim.toFixed(6)}  audio ${r.audioIdentical ? "identical" : "DIFFERENT"}  ` +
        `duration delta ${pyFloat(r.durationDelta)}s  ->  ${same ? "same video" : "DIFFERENT"}`,
    );
    if (o.frames) {
      const events = frameReport(p.output, against, o.frames);
      console.log(`${events.length} stretch(es) of visibly different frames (SSIM < 0.99). Top = this render, bottom = other:`);
      for (const e of events.slice(0, 8)) {
        console.log(`  ${e.time!.toFixed(2).padStart(7)}s  frames ${e.first}-${e.last}  worst SSIM ${e.ssim.toFixed(3)}  ${e.image}`);
      }
      same &&= events.length === 0;
    }
    process.exitCode = same ? 0 : 1;
  });

program
  .command("check")
  .description("metadata, narration locks, and the redaction gate; errors exit 1")
  .argument("[videos...]", "folders or ids (default: every video)")
  .option("--all", "the default when no videos are named")
  .option("--media", "also check renders (resolution, duration, loudness)")
  .option("--release", "also require recorded approvals for public videos")
  .action((videos: string[], o: { media?: boolean; release?: boolean }) => {
    const ws = repo();
    const ps = ws.resolve(videos, videos.length === 0);
    const r = check(ws, ps, { media: o.media, release: o.release });
    for (const w of r.warnings) console.log(`warn   ${w}`);
    for (const e of r.errors) console.log(`ERROR  ${e}`);
    console.log(`\n${ps.length} video(s): ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
    process.exitCode = r.errors.length ? 1 : 0;
  });

program
  .command("registry")
  .description("update registry.json (what the site pulls); --accept approves renders")
  .option("--accept <ids...>", "approve these videos' current renders", [])
  .option("--accept-all", "approve every video's current render")
  .option("--media-from <dir>", "accept <DIR>/videos/<id>.mp4 + <DIR>/posters/<id>.webp instead of renders")
  .option("--check", "fail if registry.json is stale (CI); writes nothing")
  .option("--note <text>", "why this version (recorded in the ledger)")
  .action((o: { accept: string[]; acceptAll?: boolean; mediaFrom?: string; check?: boolean; note?: string }) => {
    const ws = repo();
    const u = registry.update(ws, {
      accept: new Set(o.accept),
      acceptAll: o.acceptAll,
      mediaFrom: o.mediaFrom ? home(o.mediaFrom) : null,
      writeMedia: !o.check,
      note: o.note ?? null,
    });
    const next = registry.dumps(u.data);
    const old = existsSync(ws.paths.registry) ? readFileSync(ws.paths.registry, "utf8") : "";
    for (const i of u.pending) console.log(`pending  ${i}: render differs from the approved one (kept). Compare, then ${cmd(`registry --accept ${i}`)}.`);
    for (const i of u.unlisted) console.log(`unlisted ${i}: never approved, so not in the registry. ${cmd(`registry --accept ${i}`)} when it is.`);
    for (const i of u.removed) console.log(`removed  ${i}: no longer in catalog/catalog.json order`);
    if (o.check) {
      if (next !== old) fail(`registry.json is out of date with video.json/catalog. Run ${cmd("registry")} and commit it.`);
      console.log(`registry.json is up to date (${u.data.videos.length} videos)`);
      return;
    }
    if (next !== old) registry.writeRegistry(u.data, ws.paths.registry);
    saveLedger(u.ledger, ws.paths.ledger);
    const byId = new Map(u.data.videos.map((v) => [v.id, v]));
    for (const i of u.accepted) console.log(`accepted ${i}: v${byId.get(i)!.version}`);
    if (u.accepted.length) console.log(`next: ${cmd("deploy")}, then commit ${rel(ws.paths.registry)} and ${rel(ws.paths.ledger)}`);
    console.log(`${next !== old ? "wrote" : "unchanged"} registry.json (${u.data.videos.length} videos)`);
    const missing = registry.missingMedia(ws, u.data);
    if (missing.length) {
      console.log(`note: ${missing.length} approved file(s) aren't in ${rel(ws.paths.media)} here, so a local site sync will fail: ${pyRepr(missing.slice(0, 3))}`);
    }
  });

program
  .command("deploy")
  .description("put hosted videos' accepted versions on the media host, then verify them")
  .option("--dry-run", "list what would be uploaded; needs no token")
  .action((o: { dryRun?: boolean }) => deploy(repo(), { dryRun: o.dryRun }));

program
  .command("status")
  .description("per video: version, and whether it needs re-render / accept / deploy")
  .option("--site", "also show which version the live site has (needs gh and config `site`)")
  .option("--no-build", "don't rebuild props first (source column may be stale)")
  .option("--check", "CI: fail if a hosted version isn't deployed")
  .action((o: { site?: boolean; build: boolean; check?: boolean }) => {
    const ws = repo();
    return status(ws, {
      site: o.site,
      check: o.check,
      rebuild:
        o.build && !o.check
          ? async () => {
              try {
                for (const p of ws.projects()) await buildProject(ws, p, { mode: "frozen", log: () => {} });
              } catch (e) {
                fail(`${cmd("build --all")} failed (${(e as Error).message}); fix it, or run ${cmd("status --no-build")}.`);
              }
            }
          : undefined,
    });
  });

const capture = program.command("capture").description("record real assets: CLI output in a TTY, 2x page captures");
const collect = (v: string, prev: string[]) => [...prev, v];

capture
  .command("cli")
  .description("run a recipe CLI in a real TTY against the replay server; save its exact output")
  .requiredOption("--cwd <dir>", "the recipe directory")
  .requiredOption("--scenario <file>", "replay server routes (see `capture serve`)")
  .requiredOption("--out <file>", "where the output goes; requests go to <out>.requests.log")
  .requiredOption("--cmd <command>", "the command to run (bash -c)")
  .option("--answer <PROMPT=REPLY>", "type REPLY after PROMPT appears (repeatable)", collect, [])
  .option("--port <port>", "replay server port", "8787")
  .option("--env <KEY=VALUE>", "extra environment for the CLI (repeatable)", collect, [])
  .option("--timeout <seconds>", "give up after this long", Number, 60)
  .action(async (o: { cwd: string; scenario: string; out: string; cmd: string; answer: string[]; port: string; env: string[]; timeout: number }) => {
    const { captureCli } = await import("../capture/cli.ts");
    const r = await captureCli({ ...o, answers: o.answer, timeoutMs: o.timeout * 1000 });
    console.log(r.text);
    console.log(`[exit ${r.exitCode}] requests logged to ${r.log}`);
  });

capture
  .command("serve")
  .description("run the loopback replay server by hand (for a browser or a receiver); logs requests to stderr")
  .argument("<scenario>", "scenario.json: routes and canned responses")
  .argument("[port]", "port", "8787")
  .action(async (scenario: string, port: string) => {
    const { replayServer } = await import("../capture/cli.ts");
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [replayServer(), resolve(scenario), port], { stdio: "inherit" });
    await new Promise<void>((r) => child.on("exit", () => r()));
  });

capture
  .command("fetch-preload")
  .description("print the path of the fetch() redirect preload, for NODE_OPTIONS=--import")
  .action(async () => {
    const { fetchPreload } = await import("../capture/cli.ts");
    console.log(fetchPreload());
  });

capture
  .command("page")
  .description("a region of a public page at 2x, with boxes for target strings (<out>.targets.json)")
  .argument("<url>")
  .argument("<out>", "PNG path")
  .option("--top-text <text>", "start just above this text")
  .option("--bottom-text <text>", "end at this text")
  .option("--height <px>", "CSS px when there's no bottom text", Number, 1400)
  .option("--clip-x <px>", "left edge, CSS px", Number, 300)
  .option("--clip-w <px>", "width, CSS px", Number, 880)
  .option("--target <text>", "box this string (repeatable)", collect, [])
  .option("--dark", "dark color scheme")
  .action(async (url: string, out: string, o: { topText?: string; bottomText?: string; height: number; clipX: number; clipW: number; target: string[]; dark?: boolean }) => {
    const { captureRegion } = await import("../capture/pages.ts");
    console.log(dumps(await captureRegion({ url, out, ...o, targets: o.target }), { indent: 1 }));
  });

capture
  .command("pages")
  .description("viewport captures of public pages from a spec file (see docs/capture.md)")
  .argument("<spec>", "spec.json")
  .action(async (spec: string) => {
    const { capturePages } = await import("../capture/pages.ts");
    await capturePages(spec);
  });

capture
  .command("browser-shot")
  .description("decode a browser-automation screenshot log (JSON with a base64 PNG) into a PNG")
  .argument("<log>")
  .argument("<out>", "PNG path")
  .action(async (log: string, out: string) => {
    const { saveBrowserShot } = await import("../capture/pages.ts");
    console.log(saveBrowserShot(log, out));
  });

try {
  await program.parseAsync();
} catch (e) {
  if (!(e instanceof OncueError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}

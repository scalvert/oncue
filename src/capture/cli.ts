/**
 * Run a command in a real TTY and save its exact output. With a scenario, the replay server is up
 * for anything the command calls.
 *
 *   oncue capture cli --cwd <dir> --out out.txt --cmd "npx my-tool --help"
 *   oncue capture cli --cwd <recipe dir> --scenario scenario.json --out out.txt \
 *     --cmd "npm start --silent -- --query 'x' --server-url http://127.0.0.1:8787" \
 *     --answer "Choose a field [1]: =1" --answer "Choose a value [1]: =1"
 *
 * Answers are typed only after their prompt appears, like a person would. The output has
 * ANSI/readline control sequences and CRs stripped. With a scenario, every request the command
 * makes is logged to <out>.requests.log, so the capture shows which calls it made.
 */
import { spawn as spawnProcess } from "node:child_process";
import { chmodSync, existsSync, openSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fail } from "../core/errors.ts";
import { cmd, packageRoot } from "../core/program.ts";

/** The loopback replay server (`capture serve` runs it by hand). */
export const replayServer = (): string => join(packageRoot(), "assets", "capture", "replay-server.mjs");

/** The fetch() redirect preload for recipes that need an HTTPS origin (`capture fetch-preload` prints it). */
export const fetchPreload = (): string => join(packageRoot(), "assets", "capture", "redirect-fetch.mjs");
/** A CSI sequence (colors, cursor moves, erases), an OSC sequence (window titles), or one character. */
const TOKEN = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\s\S]/gu;
/** The right edge for cursor moves. A real terminal stops at its width; this keeps `ESC[999999999G` from allocating a line that long. */
const MAX_COL = 1000;

/**
 * The text a terminal would show once `raw` has played: each line ends up as what's left after
 * carriage returns, cursor-to-column moves, erases, and backspaces overwrite it. So a spinner
 * (npm's `ESC[1G ESC[0K |`) leaves nothing, and a progress line leaves only its last state. Colors
 * and window titles are dropped.
 */
export function terminalText(raw: string): string {
  return raw
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => {
      let cells: string[] = [];
      let col = 0;
      for (const m of line.matchAll(TOKEN)) {
        const [tok, params, final] = m;
        if (final !== undefined) {
          const n = Number(params?.split(";")[0] || 0);
          if (final === "G") col = Math.min(MAX_COL, Math.max(0, (n || 1) - 1));
          else if (final === "C") col = Math.min(MAX_COL, col + (n || 1));
          else if (final === "D") col = Math.max(0, col - (n || 1));
          else if (final === "K") cells = n === 1 ? cells.map((c, i) => (i <= col ? " " : c)) : n === 2 ? [] : cells.slice(0, col);
          continue;
        }
        if (tok.startsWith("\x1b")) continue;
        if (tok === "\r") col = 0;
        else if (tok === "\b") col = Math.max(0, col - 1);
        else if (tok >= " " || tok === "\t") {
          while (cells.length < col) cells.push(" ");
          cells[col++] = tok;
        }
      }
      return cells.join("").trimEnd();
    })
    .join("\n");
}

export interface CliCapture {
  cwd: string;
  /** Replay server routes. Without one, no server starts and nothing is logged. */
  scenario?: string;
  out: string;
  cmd: string;
  /** "PROMPT=REPLY": type REPLY once PROMPT has appeared. */
  answers?: string[];
  port?: string;
  /** "KEY=VALUE" pairs added to the CLI's environment. */
  env?: string[];
  timeoutMs?: number;
}

/**
 * The part of node-pty this uses. Declared here rather than imported, so the repo type-checks where
 * the optional dependency didn't install (no build tools, as in the render image).
 */
interface PtyProcess {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (e: { exitCode: number }) => void): unknown;
  write(data: string): void;
  kill(signal?: string): void;
}
interface Pty {
  spawn(file: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; cols?: number; rows?: number }): PtyProcess;
}

/** node-pty, an optional dependency. npm installs its macOS helper without the execute bit. */
function loadPty(): Pty {
  const require = createRequire(import.meta.url);
  let pty: Pty;
  try {
    pty = require("node-pty") as Pty;
  } catch {
    fail(`${cmd("capture cli")} needs node-pty (an optional dependency). Run \`npm install\` on macOS or Linux with build tools.`);
  }
  const helper = join(dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
  return pty;
}

const pairs = (xs: string[]) => xs.map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)] as [string, string]);

export interface CliCaptureResult {
  text: string;
  exitCode: number;
  /** The replay server's request log, or null when no scenario was given. */
  log: string | null;
}

/** With a scenario, there's always a request log. */
export function captureCli(o: CliCapture & { scenario: string }): Promise<CliCaptureResult & { log: string }>;
export function captureCli(o: CliCapture): Promise<CliCaptureResult>;
export async function captureCli(o: CliCapture): Promise<CliCaptureResult> {
  const pty = loadPty();
  const log = o.scenario ? o.out.replace(/\.[^./]*$/, "") + ".requests.log" : null;
  const server =
    o.scenario && log
      ? spawnProcess("node", [replayServer(), resolve(o.scenario), o.port ?? "8787"], { stdio: ["ignore", "ignore", openSync(log, "w")] })
      : null;
  if (server) await sleep(800);
  let term: PtyProcess | undefined;
  let running = true;
  try {
    term = pty.spawn("/bin/bash", ["-c", o.cmd], {
      cwd: o.cwd,
      env: { ...process.env, ...Object.fromEntries(pairs(o.env ?? [])) } as Record<string, string>,
      cols: 160,
      rows: 60,
    });
    let buf = "";
    const exited = new Promise<number>((done) =>
      term!.onExit((e) => {
        running = false;
        done(e.exitCode);
      }),
    );
    term.onData((d) => (buf += d));
    const deadline = Date.now() + (o.timeoutMs ?? 60_000);
    let seen = 0;
    for (const [prompt, reply] of pairs(o.answers ?? [])) {
      while (buf.indexOf(prompt, seen) < 0) {
        if (Date.now() > deadline) fail(`timed out waiting for the prompt ${JSON.stringify(prompt)}`);
        await sleep(50);
      }
      seen = buf.indexOf(prompt, seen) + prompt.length;
      await sleep(600);
      term.write(reply + "\r");
    }
    // Abort the timer once the CLI exits: a pending timer would keep this process alive.
    const timer = new AbortController();
    const timeout = sleep(Math.max(0, deadline - Date.now()), undefined, { signal: timer.signal }).then(
      () => fail("timed out waiting for the CLI to exit"),
      () => -1,
    );
    const exitCode = await Promise.race([exited, timeout]).finally(() => timer.abort());
    const text = terminalText(buf);
    writeFileSync(o.out, text);
    return { text, exitCode, log };
  } finally {
    if (term && running) term.kill();
    server?.kill();
  }
}

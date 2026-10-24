import { spawnSync } from "node:child_process";
import { OncueError } from "./errors.ts";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Throw a OncueError when the command exits non-zero. Default true. */
  check?: boolean;
  /** Capture stdout and stderr instead of passing them through to the terminal. Default true. */
  capture?: boolean;
  input?: string | Buffer;
}

export interface RunResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

const MAX_BUFFER = 1 << 30;

/** Run a program to completion (no shell). */
export function runBytes(cmd: string, args: string[], opts: RunOptions = {}): RunResult {
  const { cwd, env, check = true, capture = true, input } = opts;
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    input,
    maxBuffer: MAX_BUFFER,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    throw new OncueError(code === "ENOENT" ? `${cmd} isn't installed (or isn't on PATH).` : `${cmd}: ${r.error.message}`);
  }
  const result = { status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ?? Buffer.alloc(0) };
  if (check && result.status !== 0) {
    const tail = result.stderr.toString("utf8").trim().split("\n").slice(-12).join("\n");
    throw new OncueError(`${cmd} ${args.slice(0, 3).join(" ")}... exited ${result.status}${tail ? `:\n${tail}` : ""}`);
  }
  return result;
}

/** Run a program and return its output as text. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): { status: number; stdout: string; stderr: string } {
  const r = runBytes(cmd, args, opts);
  return { status: r.status, stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8") };
}

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { OncueError } from "./errors.ts";

/** SHA-256 of a file, read in 1 MiB chunks. */
export function sha256File(path: string): string {
  const h = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** True when Git LFS hasn't fetched a binary: the file is a small text pointer. */
export function isLfsPointer(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(40);
    const n = readSync(fd, head, 0, 40, 0);
    return head.subarray(0, n).toString("latin1").startsWith("version https://git-lfs");
  } finally {
    closeSync(fd);
  }
}

/** Fail clearly when Git LFS hasn't fetched a binary. */
export function ensureRealFile(path: string): void {
  if (isLfsPointer(path)) throw new OncueError(`${path} is a Git LFS pointer. Run \`git lfs pull\` first.`);
}

/**
 * Minimal KEY=VALUE loader for the repo's git-ignored .env. Real environment variables win over
 * the file.
 */
export function loadEnv(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']+|["']+$/g, "");
    if (env[key] === undefined) env[key] = value;
  }
}

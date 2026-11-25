import { execFileSync } from "node:child_process";
import { OncueError } from "./errors.ts";

/**
 * API keys from the environment or .env. A value can be a 1Password secret reference
 * (op://vault/item/field): oncue reads it with the 1Password CLI the first time a command needs
 * it, so only commands that use a key (narrate, deploy) ask 1Password. The value is kept in
 * memory, not written back to process.env, so child processes (ffmpeg, the browser) never see it.
 */

/** Reads one secret reference. The default runs `op read`; tests pass their own. */
export type SecretReader = (ref: string) => string;

export function isSecretReference(value: string | undefined): boolean {
  return value?.startsWith("op://") ?? false;
}

const cache = new Map<string, string>();

/** The variable's value, with a 1Password reference resolved; undefined when it isn't set. */
export function secret(name: string, env: NodeJS.ProcessEnv = process.env, read: SecretReader = opRead): string | undefined {
  const value = env[name];
  if (!value || !isSecretReference(value)) return value || undefined;
  const hit = cache.get(value);
  if (hit !== undefined) return hit;
  let resolved: string;
  try {
    resolved = read(value).trim();
  } catch (e) {
    throw new OncueError(`${name} is a 1Password reference (${value}), and reading it failed: ${(e as Error).message}`);
  }
  if (!resolved) throw new OncueError(`${name} is a 1Password reference (${value}), and it resolved to an empty value.`);
  cache.set(value, resolved);
  return resolved;
}

/** `op read`, with errors that say what to do. op's own messages never contain the secret. */
export function opRead(ref: string): string {
  try {
    return execFileSync("op", ["read", "--no-newline", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error("the 1Password CLI (op) isn't installed. Install it, or run the command under `op run --env-file=.env -- ...`");
    }
    const why = (err.stderr ?? "").trim().split("\n").pop()?.replace(/^\[ERROR\]\s*\S+\s+\S+\s*/, "") || err.message;
    throw new Error(`${why}. Sign in to 1Password (\`op signin\`, or unlock the app with CLI integration on) and try again`);
  }
}

/** Forget resolved values. Tests only. */
export function clearSecretCache(): void {
  cache.clear();
}

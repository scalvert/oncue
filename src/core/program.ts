import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let name = "npx oncue";

/** The command name messages tell people to run: "npx oncue" unless the repo's config renames it. */
export function programName(): string {
  return name;
}

export function setProgramName(n: string): void {
  name = n;
}

/** A command to run, for messages: cmd("narrate ema") -> "`oncue narrate ema`". */
export function cmd(args: string): string {
  return `\`${name} ${args}\``;
}

let root: string | undefined;

/**
 * The installed oncue package's root (where composition/, assets/ and templates/ live). The same
 * code runs from src/ in a checkout and from dist/src/ when installed, so walk up to package.json.
 */
export function packageRoot(): string {
  if (root) return root;
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = join(d, "package.json");
    if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "oncue") return (root = d);
    const up = dirname(d);
    if (up === d) throw new Error("oncue: can't find its own package.json");
    d = up;
  }
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as { version: string }).version;
}

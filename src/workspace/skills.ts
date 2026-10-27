/**
 * The agent skills oncue ships (`skills/<name>/` in the package), copied into a repo so coding
 * agents find them. `oncue init` installs them; `oncue skills` refreshes them after an upgrade;
 * `oncue doctor` says when a copy differs from the installed oncue's.
 *
 * The default folder is `.claude/skills`, where Claude Code looks. Other agents read AGENTS.md,
 * which points at the same files.
 */
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { packageRoot } from "../core/program.ts";

export const SKILLS_DIR = ".claude/skills";

const shipped = () => join(packageRoot(), "skills");

/** Every file under `dir`, relative to it. */
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else out.push(relative(dir, f));
    }
  };
  walk(dir);
  return out.sort();
}

/** The names of the skills this oncue ships. */
export function skillNames(): string[] {
  const src = shipped();
  return existsSync(src) ? readdirSync(src).filter((n) => statSync(join(src, n)).isDirectory()).sort() : [];
}

/**
 * Copy every shipped skill into `<root>/<dir>/<name>/`, replacing the files oncue owns there.
 * Files the repo added alongside them stay. Returns the files written, relative to `root`.
 */
export function installSkills(root: string, dir = SKILLS_DIR): string[] {
  const out: string[] = [];
  for (const name of skillNames()) {
    const from = join(shipped(), name);
    const to = join(root, dir, name);
    cpSync(from, to, { recursive: true });
    out.push(...files(from).map((f) => relative(root, join(to, f))));
  }
  return out;
}

export interface SkillState {
  name: string;
  /** "current": every shipped file matches; "stale": one differs or is missing; "missing": not installed. */
  state: "current" | "stale" | "missing";
}

/** Whether each shipped skill's copy in the repo matches this oncue's. */
export function skillStates(root: string, dir = SKILLS_DIR): SkillState[] {
  return skillNames().map((name) => {
    const from = join(shipped(), name);
    const to = join(root, dir, name);
    if (!existsSync(to)) return { name, state: "missing" };
    const same = files(from).every((f) => existsSync(join(to, f)) && readFileSync(join(to, f)).equals(readFileSync(join(from, f))));
    return { name, state: same ? "current" : "stale" };
  });
}

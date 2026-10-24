import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { SansFont } from "../../composition/src/props.ts";
import type { LocalSansFont } from "../config/config.ts";

const FONT_FILES = [".woff2", ".woff", ".otf", ".ttf"];

/**
 * The config's local sans family, if this machine has its files under <public>/<dir> (licensed
 * fonts are usually git-ignored). Each file gets the weights its name's keyword maps to. Without
 * the files the composition uses DM Sans, which oncue bundles.
 */
export function localSansFont(publicRoot: string, spec: LocalSansFont | null): SansFont | null {
  if (!spec) return null;
  const d = join(publicRoot, spec.dir);
  if (!existsSync(d)) return null;
  const exclude = (spec.exclude ?? []).map((x) => x.toLowerCase());
  const files = readdirSync(d)
    .sort()
    .filter((f) => FONT_FILES.includes(extname(f).toLowerCase()))
    .filter((f) => !exclude.some((x) => f.toLowerCase().includes(x)));
  const out: { src: string; weight: string }[] = [];
  for (const f of files) {
    for (const [key, weights] of spec.weights) {
      if (f.toLowerCase().includes(key.toLowerCase())) out.push(...weights.map((weight) => ({ src: `${spec.dir}/${f}`, weight })));
    }
  }
  if (spec.boldFallback && !out.some((o) => o.weight === "700")) {
    out.push(...out.filter((o) => o.weight === spec.boldFallback).map((o) => ({ ...o, weight: "700" })));
  }
  return out.length ? { family: spec.family, files: out } : null;
}

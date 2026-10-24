import { dumps } from "../core/json.ts";
import { fail } from "../core/errors.ts";

/** A location in parsed JSON: object keys and array indexes, e.g. ["results", 0, "title"]. */
export type JsonPath = readonly (string | number)[];

const key = (p: JsonPath) => JSON.stringify(p);

/** A predicate that's true for exactly these paths. */
export function pathSet(...paths: JsonPath[]): (p: JsonPath) => boolean {
  const s = new Set(paths.map(key));
  return (p) => s.has(key(p));
}

export interface JsonView {
  lines: string[];
  /** The line index of a kept value. Throws for a path that wasn't kept. */
  line(...path: JsonPath): number;
}

/**
 * Pretty-print a captured response (the layout of JSON.stringify(value, null, 2)), keeping only
 * some lines. `keep(path)` decides per value. A container's closing line follows its opening line.
 * Each run of dropped lines becomes one `...` line, so kept lines stay verbatim.
 */
export function jsonView(value: unknown, keep: (path: JsonPath) => boolean, indent = 2): JsonView {
  const rows: { text: string; path: JsonPath | null; opener: JsonPath | null }[] = [];
  const emit = (v: unknown, path: JsonPath, depth: number, prefix: string, comma: boolean) => {
    const pad = " ".repeat(indent * depth);
    const tail = comma ? "," : "";
    const container = typeof v === "object" && v !== null;
    const items: [string | number, unknown][] = !container
      ? []
      : Array.isArray(v)
        ? v.map((x, i) => [i, x])
        : Object.entries(v as Record<string, unknown>);
    if (container && items.length) {
      const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
      rows.push({ text: pad + prefix + open, path, opener: null });
      items.forEach(([k, x], i) => {
        const label = typeof k === "string" ? dumps(k, { ensureAscii: false }) + ": " : "";
        emit(x, [...path, k], depth + 1, label, i < items.length - 1);
      });
      rows.push({ text: pad + close + tail, path: null, opener: path });
    } else {
      rows.push({ text: pad + prefix + dumps(v, { ensureAscii: false }) + tail, path, opener: null });
    }
  };
  emit(value, [], 0, "", false);

  const lines: string[] = [];
  const at = new Map<string, number>();
  let dropping = false;
  for (const { text, path, opener } of rows) {
    if (keep((path ?? opener)!)) {
      if (path) at.set(key(path), lines.length);
      lines.push(text);
      dropping = false;
    } else if (!dropping) {
      lines.push(" ".repeat(text.length - text.trimStart().length) + "...");
      dropping = true;
    }
  }
  return { lines, line: (...p) => at.get(key(p)) ?? fail(`jsonView: ${key(p)} isn't a kept line`) };
}

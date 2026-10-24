import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write `data` as indented JSON. `newline` adds the trailing newline that committed files carry. */
export function writeJson(path: string, data: unknown, { indent = 2, newline = true } = {}): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, indent) + (newline ? "\n" : ""));
}

/**
 * Python's json.dumps(value, indent=..., ensure_ascii=...), for text that appears on screen: a
 * captured request pretty-printed into an exchange pane must keep the layout it always had.
 * Differences from JSON.stringify: without `indent`, items are separated by ", " and keys by ": ";
 * with `ensureAscii` (Python's default), every non-ASCII character is escaped as \uXXXX; and
 * non-integers print as Python's repr would (1e-05, not 0.00001).
 */
export function dumps(value: unknown, { indent, ensureAscii = true }: { indent?: number; ensureAscii?: boolean } = {}): string {
  const str = (s: string) => {
    const j = JSON.stringify(s);
    return ensureAscii ? j.replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) : j;
  };
  const enc = (v: unknown, level: number): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return pyNumber(v);
    if (typeof v === "string") return str(v);
    const isArray = Array.isArray(v);
    const entries: [string | null, unknown][] = isArray
      ? (v as unknown[]).map((x) => [null, x])
      : Object.entries(v as Record<string, unknown>);
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    if (!entries.length) return open + close;
    const item = ([k, x]: [string | null, unknown]) => (k === null ? "" : str(k) + ": ") + enc(x, level + 1);
    if (indent === undefined) return open + entries.map(item).join(", ") + close;
    const pad = "\n" + " ".repeat(indent * (level + 1));
    return open + pad + entries.map(item).join("," + pad) + "\n" + " ".repeat(indent * level) + close;
  };
  return enc(value, 0);
}

/**
 * A number as Python prints it. JavaScript can't tell 1 from 1.0, so integral values print as
 * integers; others use Python's repr rules (fixed notation for exponents -4..15).
 */
function pyNumber(v: number): string {
  if (!Number.isFinite(v)) throw new RangeError(`dumps: ${v} isn't valid JSON`);
  if (Number.isInteger(v)) return BigInt(v).toString();
  const [mant, expStr] = v.toExponential().split("e") as [string, string];
  const exp = Number(expStr);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  let out: string;
  if (exp >= -4 && exp < 16) {
    if (exp < 0) out = "0." + "0".repeat(-exp - 1) + digits;
    else if (digits.length > exp + 1) out = digits.slice(0, exp + 1) + "." + digits.slice(exp + 1);
    else out = digits + "0".repeat(exp + 1 - digits.length) + ".0";
  } else {
    const m = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    out = `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return (neg ? "-" : "") + out;
}

/** Deep equality for parsed JSON, ignoring key order (Python's == on dicts and lists). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => jsonEqual(x, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

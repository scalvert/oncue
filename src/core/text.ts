/**
 * Text helpers with Python's semantics, where on-screen text depends on them: textwrap.wrap()
 * decides where terminal lines break, and lengths count code points (what you see), not UTF-16
 * units.
 */

/** Length in code points ("●" and "é" are 1, an emoji is 1). */
export function length(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** s[start:end] in code points. */
export function slice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join("");
}

/** s padded on the right with spaces to `width` code points (Python's f"{s:30s}"). */
export function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - length(s)));
}

/** Python's str.strip(chars): strip any of `chars` from both ends. */
export function stripChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a]!)) a++;
  while (b > a && chars.includes(s[b - 1]!)) b--;
  return s.slice(a, b);
}

/** Python's str.isdigit() for the strings we test (non-empty, every character a decimal digit). */
export function isDigits(s: string): boolean {
  return /^\p{Nd}+$/u.test(s);
}

// ---------------------------------------------------------------------------------- textwrap

const WS = "[\\t\\n\\x0b\\x0c\\r ]";
const NWS = "[^\\t\\n\\x0b\\x0c\\r ]";
const W = "[\\p{L}\\p{N}_]"; // Python's \w on str
const WP = "[\\p{L}\\p{N}_!\"'&.,?]"; // word_punct
const LT = "[\\p{L}\\p{Nl}\\p{No}_]"; // [^\d\W]: a word character that isn't a decimal digit

// TextWrapper.wordsep_re, with Python's \w and \d widened to Unicode classes.
const WORDSEP = new RegExp(
  `(${WS}+` +
    `|(?<=${WP})-{2,}(?=${W})` +
    `|${NWS}+?(?:` +
    `-(?:(?<=${LT}{2}-)|(?<=${LT}-${LT}-))(?=${LT}-?${LT})` +
    `|(?=${WS}|$)` +
    `|(?<=${WP})(?=-{2,}${W})` +
    `))`,
  "u",
);

function expandTabs(text: string, tabsize = 8): string {
  let out = "";
  let col = 0;
  for (const c of text) {
    if (c === "\t") {
      const n = tabsize - (col % tabsize);
      out += " ".repeat(n);
      col += n;
    } else {
      out += c;
      col = c === "\n" || c === "\r" ? 0 : col + 1;
    }
  }
  return out;
}

const blank = (s: string) => s.trim() === "";

/**
 * Python's textwrap.wrap(text, width) with its defaults: tabs expanded, whitespace collapsed to
 * spaces, long words broken (after a hyphen when there is one), hyphenated words split, and
 * whitespace dropped at line edges.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) throw new RangeError(`invalid width ${width} (must be > 0)`);
  const munged = expandTabs(text).replace(/[\t\n\x0b\x0c\r]/g, " ");
  const chunks = munged.split(WORDSEP).filter((c) => c);
  chunks.reverse();
  const lines: string[] = [];
  while (chunks.length) {
    const line: string[] = [];
    let len = 0;
    if (lines.length && blank(chunks[chunks.length - 1]!)) chunks.pop();
    while (chunks.length) {
      const l = length(chunks[chunks.length - 1]!);
      if (len + l > width) break;
      line.push(chunks.pop()!);
      len += l;
    }
    if (chunks.length && length(chunks[chunks.length - 1]!) > width) {
      // _handle_long_word: break the word to fill the line, after its last hyphen if it has one.
      const spaceLeft = width - len;
      const chunk = chunks[chunks.length - 1]!;
      let end = spaceLeft;
      if (length(chunk) > spaceLeft) {
        const hyphen = Array.from(chunk).slice(0, spaceLeft).lastIndexOf("-");
        if (hyphen > 0 && Array.from(chunk).slice(0, hyphen).some((c) => c !== "-")) end = hyphen + 1;
      }
      line.push(slice(chunk, 0, end));
      chunks[chunks.length - 1] = slice(chunk, end);
      len = line.reduce((n, c) => n + length(c), 0);
    }
    if (line.length && blank(line[line.length - 1]!)) {
      len -= length(line.pop()!);
    }
    if (line.length) lines.push(line.join(""));
  }
  return lines;
}

/** Python's repr() for the values messages show: strings, numbers, booleans, null, and lists of them. */
export function pyRepr(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (typeof x === "boolean") return x ? "True" : "False";
  if (Array.isArray(x)) return `[${x.map(pyRepr).join(", ")}]`;
  if (typeof x === "string") {
    const q = x.includes("'") && !x.includes('"') ? '"' : "'";
    const body = x.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
    return q + (q === "'" ? body.replace(/'/g, "\\'") : body) + q;
  }
  return String(x);
}

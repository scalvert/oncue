import type { TermStep, Tone } from "../../composition/src/props.ts";
import { round } from "../core/numbers.ts";
import { length, wrap } from "../core/text.ts";

/** An absolute time (video seconds), or null/undefined for "right after the previous step". */
type At = number | null | undefined;

export interface TermDefaults {
  /** Pause after an output line before the next step. */
  outGap?: number;
  /** How long a pill stays up. */
  pillDuration?: number;
}

/**
 * Terminal steps laid out on a cursor, so lines never overlap. A step with a cue lands on it, or
 * as soon after it as the previous step allows; a step without one follows the previous step.
 * Times passed in are absolute video seconds; steps store scene-relative times.
 */
export class Term {
  readonly t0: number;
  readonly steps: TermStep[] = [];
  /** Scene-relative time the next step can start at. */
  cursor = 0.35;
  readonly #outGap: number;
  readonly #pillDuration: number;

  constructor(sceneStart: number, defaults: TermDefaults = {}) {
    this.t0 = sceneStart;
    this.#outGap = defaults.outGap ?? 0.12;
    this.#pillDuration = defaults.pillDuration ?? 2.6;
  }

  #at(at: At): number {
    return round(at == null ? this.cursor : Math.max(this.cursor, at - this.t0), 3);
  }

  /** A typed command. `prefix` replaces the prompt (a reply typed after a CLI's question); `typeAt` delays the typing. */
  cmd(text: string, opts: { at?: At; prompt?: string; cs?: number; hold?: number; prefix?: string; typeAt?: number } = {}): this {
    const { prompt = "$", cs = 0.028, hold = 0.3, prefix, typeAt } = opts;
    const a = this.#at(opts.at);
    const st: TermStep = { kind: "cmd", at: a, text, prompt, charSeconds: cs };
    if (prefix !== undefined) st.prefix = prefix;
    const ta = typeAt === undefined ? a : Math.max(a, round(typeAt - this.t0, 3));
    if (typeAt !== undefined) st.typeAt = ta;
    this.steps.push(st);
    this.cursor = ta + length(text) * cs + hold;
    return this;
  }

  /** Streamed model output: wrapped like a terminal would wrap it, and revealed progressively. */
  stream(text: string, opts: { at?: At; width?: number; cs?: number; gap?: number } = {}): this {
    const { width = 86, cs = 0.022, gap = 0.05 } = opts;
    // Wrap each line on its own, so the text's own line breaks and blank lines survive. Newlines at
    // the start and end add no step, as before.
    const lines = text
      .replace(/^\n+|\n+$/g, "")
      .split("\n")
      .flatMap((ln) => (ln.trim() ? wrap(ln, width) : [""]));
    (lines.length ? lines : [""]).forEach((ln, i) => {
      const a = this.#at(i === 0 ? opts.at : null);
      this.steps.push({ kind: "cmd", at: a, text: ln, prefix: "", plain: true, charSeconds: cs } as TermStep);
      this.cursor = a + length(ln) * cs + gap;
    });
    return this;
  }

  /** One output line. */
  out(text: string, opts: { at?: At; tone?: Tone; gap?: number } = {}): this {
    const { tone = "default", gap = this.#outGap } = opts;
    const a = this.#at(opts.at);
    this.steps.push({ kind: "out", at: a, text, tone });
    this.cursor = a + gap;
    return this;
  }

  /** A block of output; the first line lands on `at`. */
  lines(text: string, opts: { at?: At; tone?: Tone; gap?: number } = {}): this {
    const { tone = "default", gap = 0.08 } = opts;
    text
      .replace(/\n+$/, "")
      .split("\n")
      .forEach((ln, i) => this.out(ln, { at: i === 0 ? opts.at : null, tone, gap }));
    return this;
  }

  /** A callout pill above the terminal (e.g. "POST /api/triggers"), at `at` or at the cursor. */
  pill(text: string, opts: { at?: At; duration?: number } = {}): this {
    const at = opts.at == null ? this.cursor : opts.at - this.t0;
    this.steps.push({ kind: "pill", at: round(at, 3), text, duration: opts.duration ?? this.#pillDuration });
    return this;
  }

  /**
   * Replay a captured transcript verbatim.
   *   anchors: { linePrefix: time }: the first line starting with the prefix lands on that cue.
   *   tone:    line -> tone name.
   *   answers: { promptPrefix: [reply, time] }: a line like "Choose a field [1]: 1" becomes the
   *            prompt with the reply typed at the cue.
   */
  feed(
    transcript: string,
    opts: {
      anchors?: Record<string, number>;
      tone?: (line: string) => Tone;
      answers?: Record<string, [string, number]>;
      gap?: number;
      stripLeadingBlank?: boolean;
    } = {},
  ): this {
    const { tone, gap = 0.07, stripLeadingBlank = true } = opts;
    const anchors = new Map(Object.entries(opts.anchors ?? {}));
    const answers = new Map(Object.entries(opts.answers ?? {}));
    const lines = transcript.replace(/\n+$/, "").split("\n");
    if (stripLeadingBlank) while (lines.length && !lines[0]!.trim()) lines.shift();
    for (const ln of lines) {
      let at: number | null = null;
      for (const [pre, t] of anchors) {
        if (ln.startsWith(pre)) {
          at = t;
          anchors.delete(pre);
          break;
        }
      }
      const answer = [...answers].find(([pre]) => ln.startsWith(pre));
      if (answer) {
        const [pre, [reply, tReply]] = answer;
        answers.delete(pre);
        this.cmd(reply, { at, prefix: pre, cs: 0.05, typeAt: tReply, hold: 0.15 });
      } else {
        this.out(ln, { at, tone: tone ? tone(ln) : "default", gap });
      }
    }
    return this;
  }
}

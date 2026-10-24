import { copyFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { CaptionWord, CaptureSceneProps, ExchangeSceneProps, ExplainerProps, SansFont, Scene } from "../../composition/src/props.ts";
import type { Theme } from "../../composition/src/theme.ts";
import { fail } from "../core/errors.ts";
import { readJson } from "../core/json.ts";
import { length } from "../core/text.ts";
import { levels, type Levels } from "../audio/levels.ts";
import { applyRetime, gateGaps, NARRATION_OFFSET, planRetime, type RetimeOptions, writeFadedTake } from "../audio/retime.ts";
import type { NarrationLock } from "../narration/lock.ts";
import { Capture, type CaptureOptions } from "./capture.ts";
import { captionWords, type SpokenForm } from "./captions.ts";
import { Term, type TermDefaults } from "./term.ts";
import { Timeline } from "./timeline.ts";

/** The repo-wide look and caption forms every video's props start from (oncue.config.ts). */
export interface VideoDefaults {
  brandLabel: string;
  theme: Theme;
  /** Spoken forms every video's captions show as written. */
  spoken: SpokenForm[];
  /** The local sans family, if its files are present. */
  sans: SansFont | null;
}

/** What the build pipeline hands a video's build script. */
export interface VideoContext {
  /** Folder under the public root that props and assets go in. */
  name: string;
  /** The project folder. Relative paths in build scripts resolve against it. */
  root: string;
  /** The renderer's web root. */
  publicRoot: string;
  /** The locked take this video is built on. */
  lock: NarrationLock;
  /** The locked take's audio file. */
  take: string;
  defaults: VideoDefaults;
  log: (line: string) => void;
}

/** [text, cue phrase]: a chip or item that appears when the phrase is spoken. */
export type CuedText = [text: string, phrase: string];

export interface ExchangeRequest {
  method: string;
  /** At most 40 characters: longer paths are clipped. Show the documented template instead. */
  path: string;
  lines: string[];
  at: number;
}

export interface ExchangeResponse {
  status: string;
  lines: string[];
  at: number;
}

export interface ExchangeHighlight {
  pane: "request" | "response";
  /** 0-based line indexes, inclusive. */
  from: number;
  to: number;
  at: number;
  until?: number | null;
  note?: string | null;
}

export interface PropsOptions {
  /** Small top-left label on hero, statement, and end scenes, e.g. "Acme Cookbook". Default: the config's brandLabel. */
  brandLabel?: string;
  seriesTag?: string;
  look?: "classic" | "v2";
  /** Spoken forms to show as written in captions, beyond the config's `captions.spoken`. */
  extraSpoken?: SpokenForm[];
  /** Captions, if the video builds its own (default: captionWords with the spoken forms). */
  captions?: CaptionWord[];
  /** Use the config's local sans family when this machine has its files. Default true. */
  localSans?: boolean;
  /** Extra props, e.g. showCaptions. */
  extra?: Record<string, unknown>;
}

/**
 * The authoring API for one video. A build script gets a Video with its narration already
 * loaded, lays out the timeline (retime or playTake), adds scenes on narration cues, and returns
 * props(). All times are video seconds unless a name says otherwise.
 */
export class Video {
  readonly name: string;
  readonly root: string;
  readonly publicDir: string;
  readonly lock: NarrationLock;
  readonly scenes: Scene[] = [];
  readonly #ctx: VideoContext;
  #timeline: Timeline | undefined;
  #levels: Levels | undefined;

  constructor(ctx: VideoContext) {
    this.#ctx = ctx;
    this.name = ctx.name;
    this.root = ctx.root;
    this.lock = ctx.lock;
    this.publicDir = join(ctx.publicRoot, ctx.name);
    mkdirSync(this.publicDir, { recursive: true });
  }

  // ------------------------------------------------------------------ files

  /** A path in the project folder. */
  path(...parts: string[]): string {
    return parts.length === 1 && isAbsolute(parts[0]!) ? parts[0]! : join(this.root, ...parts);
  }

  /** A text file in the project folder (a captured transcript, say). */
  readText(rel: string): string {
    return readFileSync(this.path(rel), "utf8");
  }

  /** A JSON file in the project folder (a captured response, say). */
  readJson<T = any>(rel: string): T {
    return readJson<T>(this.path(rel));
  }

  /** Copy a file into the renderer's public folder. Returns the path props use for it. */
  asset(src: string, name?: string): string {
    const n = name ?? basename(src);
    copyFileSync(this.path(src), join(this.publicDir, n));
    return `${this.name}/${n}`;
  }

  // ------------------------------------------------------------------ narration

  get #level(): Levels {
    return (this.#levels ??= levels(this.#ctx.take));
  }

  /**
   * Cut the take at segment boundaries and insert silence after each segment (default 0.8 s).
   * Writes the retimed narration the video plays.
   */
  retime(gaps: Record<string, number> = {}, opts: Omit<RetimeOptions, "gaps"> = {}): this {
    const plan = planRetime(this.lock, this.#level, { ...opts, gaps });
    applyRetime(this.#ctx.take, plan, join(this.publicDir, "narration.mp3"));
    this.#timeline = new Timeline(plan.words, plan.segments, this.lock.segments.map((s) => s.id));
    return this;
  }

  /**
   * Play the take as recorded instead of retiming it, starting NARRATION_OFFSET in, with its end
   * faded. `gate` silences the gaps between segments (stray breaths the aligner didn't attribute
   * to a word).
   */
  playTake(opts: { gate?: boolean } = {}): this {
    const out = join(this.publicDir, "narration.mp3");
    writeFadedTake(this.#ctx.take, this.#level, out);
    if (opts.gate) {
      const tmp = out.replace(/\.mp3$/, ".gated.mp3");
      const n = gateGaps(this.lock, this.#level, out, tmp);
      renameSync(tmp, out);
      this.#ctx.log(`  gated ${n} inter-segment gaps`);
    }
    const shift = (x: { start: number; end: number }) => ({ start: x.start + NARRATION_OFFSET, end: x.end + NARRATION_OFFSET });
    const words = this.lock.words.map((w) => ({ word: w.word, ...shift(w) }));
    const segments = Object.fromEntries(this.lock.segments.map((s) => [s.id, shift(s)]));
    this.#timeline = new Timeline(words, segments, this.lock.segments.map((s) => s.id));
    return this;
  }

  /** The narration on the video's clock. Call retime() or playTake() first. */
  get timeline(): Timeline {
    return this.#timeline ?? fail(`${this.name}: call retime() or playTake() before laying out scenes`);
  }

  /** When `phrase` starts in segment `seg`. Matching ignores case and punctuation. */
  readonly cue = (seg: string, phrase: string): number => this.timeline.cue(seg, phrase);

  /** When segment `seg`'s last word ends. */
  readonly segEnd = (seg: string): number => this.timeline.segment(seg).end;

  /** `t` relative to the start of scene `id`. */
  readonly rel = (id: string, t: number): number => this.timeline.rel(id, t);

  /** Scene `id`'s [start, end]. */
  readonly span = (id: string): [number, number] => this.timeline.span(id);

  get end(): number {
    return this.timeline.end;
  }

  /** A terminal laid out from scene `id`'s start. */
  term(id: string, defaults?: TermDefaults): Term {
    return new Term(this.span(id)[0], defaults);
  }

  capture(opts: CaptureOptions): Capture {
    return new Capture(opts);
  }

  // ------------------------------------------------------------------ scenes

  add<S extends Scene>(scene: S): S {
    this.scenes.push(scene);
    return scene;
  }

  #cued(id: string, items: readonly CuedText[]) {
    return items.map(([text, phrase]) => ({ text, at: this.rel(id, this.cue(id, phrase)) }));
  }

  hero(id: string, lines: string[], chips: readonly CuedText[] = []): Scene {
    const [start, end] = this.span(id);
    return this.add({ id, type: "hero", start, end, lines: [...lines], chips: this.#cued(id, chips) });
  }

  statement(id: string, line1: string, line2: string, highlightCue: string): Scene {
    const [start, end] = this.span(id);
    return this.add({ id, type: "statement", start, end, line1, line2, highlightAt: this.rel(id, this.cue(id, highlightCue)) });
  }

  /** A terminal scene. `endId` stretches it to the end of a later scene. */
  terminal(id: string, term: Term, label: string, title: string, opts: { fontSize?: number; endId?: string } = {}): Scene {
    const start = this.span(id)[0];
    const end = this.span(opts.endId ?? id)[1];
    const sc: Scene = { id, type: "terminal", start, end, label, title, steps: term.steps };
    if (opts.fontSize) sc.fontSize = opts.fontSize;
    return this.add(sc);
  }

  /** A document card with items that appear on cues (the composition's "permissions" scene). */
  card(id: string, label: string, heading: string, items: readonly CuedText[], doc: Extract<Scene, { type: "permissions" }>["doc"]): Scene {
    const [start, end] = this.span(id);
    return this.add({ id, type: "permissions", start, end, label, heading, items: this.#cued(id, items), doc });
  }

  /** A sequence diagram. Message and note times are video seconds. */
  flow(
    id: string,
    label: string,
    o: {
      lanes: { id: string; title: string; sub?: string }[];
      messages?: { from: string; to: string; label: string; at: number }[];
      notes?: { lane: string; text: string; at: number }[];
      tag?: string;
    },
  ): Scene {
    const [start, end] = this.span(id);
    const sc: Scene = {
      id,
      type: "flow",
      start,
      end,
      label,
      lanes: o.lanes.map(({ id: lane, title, sub }) => ({ id: lane, title, sub })),
      messages: (o.messages ?? []).map((m) => ({ from: m.from, to: m.to, label: m.label, at: this.rel(id, m.at) })),
      notes: (o.notes ?? []).map((n) => ({ lane: n.lane, text: n.text, at: this.rel(id, n.at) })),
    };
    if (o.tag) sc.tag = o.tag;
    return this.add(sc);
  }

  /**
   * One API call: the request on the left, the response on the right. Lines are shown verbatim:
   * pass real captured output (trimmed with `...` lines by jsonView, never edited).
   */
  exchange(
    id: string,
    label: string,
    o: { request: ExchangeRequest; response: ExchangeResponse; highlights?: ExchangeHighlight[]; tag?: string; lineSeconds?: number },
  ): Scene {
    const [start, end] = this.span(id);
    const { request: req, response: res } = o;
    // JetBrains Mono at 21px is 12.6px a character: what fits each pane (the Explainer's exchange layout).
    // The request header fits about 40 characters next to the method chip. For longer paths, show
    // the documented template ("/api/agents/{agent_id}/runs") and name the real IDs in `tag`.
    if (length(req.path) > 40) fail(`${id}: path over 40 chars (it would be clipped): '${req.path}'`);
    for (const [pane, lines, limit] of [["request", req.lines, 46], ["response", res.lines, 69]] as const) {
      const long = lines.find((ln) => length(ln) > limit);
      if (long !== undefined) fail(`${id}: ${pane} line over ${limit} chars (it would be clipped): '${long}'`);
    }
    const sc: ExchangeSceneProps = {
      id,
      type: "exchange",
      start,
      end,
      label,
      request: { method: req.method, path: req.path, lines: [...req.lines], at: this.rel(id, req.at) },
      response: { status: res.status, lines: [...res.lines], at: this.rel(id, res.at), lineSeconds: o.lineSeconds ?? 0.03 },
      highlights: (o.highlights ?? []).map((h) => ({
        pane: h.pane,
        from: h.from,
        to: h.to,
        at: this.rel(id, h.at),
        ...(h.until != null ? { until: this.rel(id, h.until) } : {}),
        ...(h.note ? { note: h.note } : {}),
      })),
    };
    if (o.tag) sc.tag = o.tag;
    return this.add(sc);
  }

  /**
   * Closing card. Keep `footnote` empty for anything public-facing (no credits, channels, or
   * internal notes); disclosures belong on the hosting page, not in the video.
   */
  endCard(id: string, headline: string, url: string, footnote = ""): Scene {
    const [start, end] = this.span(id);
    return this.add({ id, type: "end", start, end, headline, url, footnote });
  }

  /** A capture scene, ending at `end`. */
  addCapture(c: Capture, id: string, end: number): CaptureSceneProps {
    return this.add(c.scene(id, end));
  }

  // ------------------------------------------------------------------ output

  /** Caption words, with the config's spoken forms and `extraSpoken` shown as written. */
  captions(extraSpoken: SpokenForm[] = []): CaptionWord[] {
    const tl = this.timeline;
    return captionWords(tl.words, Object.values(tl.segments).map((s) => s.end), [...this.#ctx.defaults.spoken, ...extraSpoken]);
  }

  /** The composition's props. The pipeline writes them to <public>/<video>/props.json. */
  props(o: PropsOptions = {}): ExplainerProps {
    const d = this.#ctx.defaults;
    const props: ExplainerProps = {
      durationSeconds: this.end,
      brandLabel: o.brandLabel ?? d.brandLabel,
      look: o.look ?? "v2",
      narrationSrc: `${this.name}/narration.mp3`,
      narrationOffset: NARRATION_OFFSET,
      scenes: this.scenes,
      captions: o.captions ?? this.captions(o.extraSpoken),
      ...o.extra,
    };
    if (o.seriesTag) props.seriesTag = o.seriesTag;
    props.theme = d.theme;
    if (o.localSans !== false && d.sans) props.sans = d.sans;
    return props;
  }
}

/** A video's build: lays out scenes on a narrated Video and returns its props. */
export type BuildFn = (v: Video) => ExplainerProps | Promise<ExplainerProps>;

export interface VideoDefinition {
  readonly kind: "oncue-video";
  readonly build: BuildFn;
}

/** The default export of every projects/<folder>/build.ts. */
export function defineVideo(build: BuildFn): VideoDefinition {
  return { kind: "oncue-video", build };
}

export function isVideoDefinition(x: unknown): x is VideoDefinition {
  return typeof x === "object" && x !== null && (x as VideoDefinition).kind === "oncue-video" && typeof (x as VideoDefinition).build === "function";
}

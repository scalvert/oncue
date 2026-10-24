import type { Theme } from "./theme.ts";

/**
 * The props contract between a video's build (projects/<name>/build.ts, through the builder) and
 * the composition. Types only, so the builder can import them without React.
 *
 * Every timed field (`at`, `until`, `typeAt`) is seconds from its scene's start; scene `start`
 * and `end` are seconds on the video's clock.
 */

export type Tone = "default" | "dim" | "ok" | "agent";

export type TermStep =
  | { kind: "cmd"; at: number; text: string; prompt?: string; charSeconds?: number; prefix?: string; typeAt?: number; plain?: boolean }
  | { kind: "out"; at: number; text: string; tone?: Tone }
  | { kind: "pill"; at: number; text: string; duration?: number };

export type Timed = { text: string; at: number };

export type Scene =
  | { id: string; type: "hero"; start: number; end: number; lines: string[]; chips: Timed[] }
  | { id: string; type: "statement"; start: number; end: number; line1: string; line2: string; highlightAt: number }
  | { id: string; type: "terminal"; start: number; end: number; label: string; title: string; steps: TermStep[]; fontSize?: number }
  | {
      id: string;
      type: "permissions";
      start: number;
      end: number;
      label: string;
      heading: string;
      items: Timed[];
      doc: { title: string; source: string; visibleTo?: string[]; chipsLabel?: string; checkbox?: string; checkboxNote?: string };
    }
  | CaptureSceneProps
  | { id: string; type: "end"; start: number; end: number; headline: string; url: string; footnote: string }
  | {
      id: string;
      type: "flow";
      start: number;
      end: number;
      label: string;
      tag?: string;
      lanes: { id: string; title: string; sub?: string }[];
      messages: { from: string; to: string; label: string; at: number }[];
      notes: { lane: string; text: string; at: number }[];
    }
  | ExchangeSceneProps;

/** A browser capture: images under a keyframed camera, with cursor clicks and highlight rings. */
export type CaptureSceneProps = {
  id: string;
  type: "capture";
  start: number;
  end: number;
  url: string;
  imgW: number;
  imgH: number;
  images: { src: string; at: number }[];
  camera: { at: number; dur?: number; cx: number; cy: number; w: number }[];
  cursor?: { at: number; dur?: number; x: number; y: number; click?: boolean }[];
  highlights?: { at: number; until: number; x: number; y: number; w: number; h: number }[];
  eyebrows: Timed[];
};

/** One API call: the request on the left, the response on the right, with highlighted lines.
 * `lines` are shown verbatim (monospace, JSON-colored); line indexes in highlights are 0-based. */
export type ExchangeSceneProps = {
  id: string;
  type: "exchange";
  start: number;
  end: number;
  label: string;
  tag?: string;
  request: { method: string; path: string; lines: string[]; at: number };
  response: { status: string; lines: string[]; at: number; lineSeconds?: number };
  highlights: { pane: "request" | "response"; from: number; to: number; at: number; until?: number; note?: string }[];
};

export type CaptionWord = { word: string; start: number; end: number; breakAfter?: boolean };

/** A local sans family to use instead of the bundled DM Sans, with its files under the public root. */
export interface SansFont {
  family: string;
  files: { src: string; weight: string }[];
}

export interface ExplainerProps {
  [key: string]: unknown;
  durationSeconds: number;
  narrationSrc?: string;
  narrationOffset?: number;
  scenes: Scene[];
  captions: CaptionWord[];
  showCaptions?: boolean;
  /** Small top-left label on hero, statement, and end scenes, e.g. "Acme Cookbook". */
  brandLabel?: string;
  /** "classic" = flat paper background. "v2" = soft drifting backdrop and the theme's wordmark. */
  look?: "classic" | "v2";
  /** v2 only: small series tag next to the wordmark, e.g. "Platform APIs". */
  seriesTag?: string;
  /** Colors, backdrop and wordmark (absent = oncue's default theme). */
  theme?: Theme;
  /** A local sans family (absent = DM Sans). */
  sans?: SansFont;
}

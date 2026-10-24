/**
 * The built-in composition's look: colors, the wordmark, and the "v2" backdrop. A repo sets it in
 * oncue.config.ts (`theme`); the builder resolves it into every video's props, so a render depends
 * only on its props.
 */

export interface ThemeColors {
  /** Eyebrows, the second hero line, active diagram arrows, highlight rings. */
  accent: string;
  /** Statement highlight, check marks, terminal prompts and success lines. */
  highlight: string;
  /** The page background (the "classic" look; also cards' light text on dark). */
  paper: string;
  /** Headlines and body text. */
  text: string;
  /** Cards and checkboxes. */
  white: string;
  /** Terminal and response pane background; text on highlight chips. */
  ink: string;
  /** Terminal and pane title bars. */
  inkBar: string;
  /** Secondary text: tags, sources, sub-labels. */
  muted: string;
  /** Terminal text. */
  termText: string;
  /** Dim terminal output. */
  termDim: string;
  /** Agent replies, GET chips, highlighted response lines. */
  info: string;
  /** PUT/PATCH chips, JSON numbers. */
  warn: string;
  /** DELETE chips, error statuses. */
  danger: string;
}

export interface Theme {
  colors: ThemeColors;
  /** The "v2" look's soft backdrop: three drifting glows over a vertical gradient. */
  backdrop: {
    /** RGB triplets, e.g. [216, 253, 73]: top left, top right, bottom. */
    glows: [[number, number, number], [number, number, number], [number, number, number]];
    /** Top and bottom of the base gradient. */
    base: [string, string];
  };
  /** The wordmark in the "v2" look's top-right corner: a path under the public root. */
  logo: { src: string; height: number } | null;
}

export type ThemeInput = {
  colors?: Partial<ThemeColors>;
  backdrop?: Partial<Theme["backdrop"]>;
  logo?: Theme["logo"];
};

/** oncue's own look: neutral slate with a blue accent and a yellow highlight. */
export const defaultTheme: Theme = {
  colors: {
    accent: "#2563EB",
    highlight: "#FACC15",
    paper: "#F8FAFC",
    text: "#0F172A",
    white: "#FFFFFF",
    ink: "#0B1020",
    inkBar: "#161B2E",
    muted: "#64748B",
    termText: "#E2E8F0",
    termDim: "#94A3B8",
    info: "#38BDF8",
    warn: "#FB923C",
    danger: "#F87171",
  },
  backdrop: {
    glows: [
      [250, 204, 21],
      [147, 197, 253],
      [153, 246, 228],
    ],
    base: ["#F8FAFC", "#EEF2F7"],
  },
  logo: null,
};

export function resolveTheme(input: ThemeInput = {}): Theme {
  return {
    colors: { ...defaultTheme.colors, ...input.colors },
    backdrop: { ...defaultTheme.backdrop, ...input.backdrop },
    logo: input.logo === undefined ? defaultTheme.logo : input.logo,
  };
}

/** `#RRGGBB` at `alpha`, as `rgba(r,g,b,a)`. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

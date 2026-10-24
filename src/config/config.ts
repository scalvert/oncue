/**
 * oncue.config.ts: everything that differs between one video repo and another.
 *
 * A repo's config sets its paths, brand and theme, voice, caption forms, the metadata its videos
 * carry, the sign-offs a release needs, what `check` treats as a leak, and where media and the
 * site live. Every field is optional; the defaults suit a small open-source project.
 */
import type { ThemeInput } from "../../composition/src/theme.ts";
import type { SpokenForm } from "../builder/captions.ts";
import type { MediaStore } from "../release/blob.ts";

/** A sign-off a video can need before it's released (recorded in video.json `approvals`). */
export interface ApprovalKind {
  /** Who gives it, for docs and messages, e.g. "Legal". */
  who?: string;
  /** Every public video needs it, whether or not its video.json lists it. */
  required?: boolean;
  /**
   * The video's media can't be hosted until it's recorded (e.g. legal or capture clearance).
   * Default true, so a sign-off the config doesn't know holds hosting; set false for one that
   * only gates going public (e.g. product).
   */
  blocksHosting?: boolean;
}

/** Text that mustn't be committed: an internal host name, an employee email, a customer name. */
export interface RedactRule {
  /** A global regex (the `g` flag is added if missing). Every match not in `allow` is a finding. */
  pattern: RegExp;
  /** Matches that are fine: placeholders and fictional demo values. */
  allow?: string[];
  /** The error, given the sorted distinct findings. */
  message: (found: string[]) => string;
  /**
   * Skip provenance notes (code and Markdown, where a capture's source is recorded) and scan only
   * data files: captured output, JSON, transcripts. Default true.
   */
  dataFilesOnly?: boolean;
  /** Normalize text before matching, e.g. decode %2F inside URL-encoded redirect URIs. */
  normalize?: (text: string) => string;
}

/** Font files a repo may have locally (licensed, git-ignored) and prefer over the bundled sans. */
export interface LocalSansFont {
  /** The CSS family name, e.g. "PolySans". */
  family: string;
  /** Folder under the public root, e.g. "fonts/polysans". */
  dir: string;
  /** File-name keyword -> CSS weights, e.g. [["median", ["500", "600", "700"]]]. */
  weights: [keyword: string, weights: string[]][];
  /** Skip files whose names contain any of these, e.g. ["italic", "mono"]. */
  exclude?: string[];
  /** Weight to fall back to for bold (700) when no file provides it, e.g. "800". */
  boldFallback?: string;
}

export interface OncueConfig {
  /** The command name in messages and help ("Run `<name> narrate x`"). Default "oncue". */
  cli?: { name?: string; description?: string };
  /** Locations, relative to the repo root. */
  paths?: {
    /** One folder per video. Default "projects". */
    projects?: string;
    /** catalog.json, voice.json, spoken.json. Default "catalog". */
    catalog?: string;
    /** The renderer's web root: brand assets, local fonts, each video's built props. Default "public". */
    public?: string;
    /** Every accepted MP4 and poster, content-addressed and append-only. Default "dist/media". */
    media?: string;
    /** What the site pulls. Default "registry.json". */
    registry?: string;
    /** Every accepted render. Default "versions.json". */
    ledger?: string;
    /** The git-ignored file with API keys. Default ".env". */
    env?: string;
    /** What `new` copies. Default: the template oncue ships. */
    videoTemplate?: string;
  };
  /** The small label on hero, statement and end scenes when a video doesn't set its own. */
  brandLabel?: string;
  /** Colors, fonts, logo and backdrop for the built-in composition. */
  theme?: ThemeInput;
  /** Licensed sans files the composition uses when they're present. */
  localSans?: LocalSansFont;
  /**
   * A custom composition instead of the built-in one: a .tsx module (relative to the root) whose
   * default export is a React component taking the video's props.
   */
  composition?: string;
  captions?: {
    /** Spoken forms every video's captions show as written ("docs dot example dot com"). */
    spoken?: SpokenForm[];
  };
  narration?: {
    /** Prefix for the experiment-only voice overrides: <PREFIX>_VOICE_ID, _MODEL_ID, _VOICE_SETTINGS. Default "ONCUE". */
    envPrefix?: string;
  };
  /** What video.json may and must say. */
  metadata?: {
    visibilities?: string[];
    types?: string[];
    /** Sign-offs, by video.json `approvals` key. Default: none. */
    approvals?: Record<string, ApprovalKind>;
    /** Longest summary the site's cards show. Default 160. */
    summaryMax?: number;
    /** Fail a build script whose seriesTag has a number (the order lives in series.position). */
    unnumberedSeriesTags?: boolean;
  };
  checks?: {
    redact?: RedactRule[];
    /** Folders, besides each project, whose committed text files are scanned. Default ["catalog"]. */
    scan?: string[];
  };
  registry?: {
    /** The registry's $comment. */
    comment?: string;
  };
  ledger?: {
    /** versions.json's $comment, for a new ledger. */
    comment?: string;
  };
  /** Where the site keeps its copy of the registry, for `status --site`. */
  site?: { repo: string; snapshot: string };
  /** Where `deploy` puts media. Default: the Vercel Blob store BLOB_READ_WRITE_TOKEN points at. */
  mediaStore?: MediaStore;
}

/** The identity function, for type-checked config files. */
export function defineConfig(config: OncueConfig): OncueConfig {
  return config;
}

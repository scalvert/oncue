/** The shapes of the committed JSON files that describe the videos (catalog/, projects/*\/video.json). */

export interface Track {
  id: string;
  label?: string;
  [key: string]: unknown;
}

/** catalog/catalog.json: tracks, series, and the publishing order. */
export interface Catalog {
  tracks: Track[];
  series?: Record<string, { label: string }>;
  order: string[];
  /** Where dist/media is hosted (set by the first `gv deploy`). */
  mediaBaseUrl?: string | null;
  [key: string]: unknown;
}

/** How a project's build differs from the defaults (all optional). */
export interface BuildConfig {
  /** Folder under composer/public/ (default: the project folder name). */
  public?: string;
  /** Narration script (default: narration.tsv). */
  tsv?: string;
  /** Render file name under renders/ (default: <folder>-final.mp4). */
  output?: string;
}

export type Approval = { by: string; date?: string; [key: string]: unknown } | null;

/** projects/<folder>/video.json. Fields not listed here pass through to the registry. */
export interface VideoMeta {
  id: string;
  title: string;
  summary: string;
  track: string;
  type: string;
  visibility: string;
  updated: string;
  build?: BuildConfig;
  approvals: Record<string, Approval>;
  series?: { id: string; position: number };
  related?: { doc?: string; docLabel?: string };
  gallery?: boolean;
  previewReason?: string;
  [key: string]: unknown;
}

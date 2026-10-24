import { basename, join } from "node:path";
import { readJson } from "../core/json.ts";
import type { BuildConfig, VideoMeta } from "./types.ts";

/**
 * One video: a folder under projects/ with a video.json, a narration script, and a build.ts.
 * Knows where the project's files are; doesn't read or write anything except video.json.
 */
export class Project {
  readonly dir: string;
  /** composer/public, where builds write props and assets for the renderer. */
  readonly publicRoot: string;
  #meta: VideoMeta | undefined;

  constructor(dir: string, publicRoot: string) {
    this.dir = dir;
    this.publicRoot = publicRoot;
  }

  get meta(): VideoMeta {
    return (this.#meta ??= readJson<VideoMeta>(join(this.dir, "video.json")));
  }

  /** Replace the metadata in memory (tests). */
  set meta(value: VideoMeta) {
    this.#meta = value;
  }

  /** Folder name. Commands and render file names use it. */
  get name(): string {
    return basename(this.dir);
  }

  /** Public video id (URLs, the site registry). */
  get id(): string {
    return this.meta.id;
  }

  get build(): BuildConfig {
    return this.meta.build ?? {};
  }

  get tsv(): string {
    return join(this.dir, this.build.tsv ?? "narration.tsv");
  }

  /** Folder name under composer/public/ (the renderer serves assets from there). */
  get publicName(): string {
    return this.build.public ?? this.name;
  }

  get publicDir(): string {
    return join(this.publicRoot, this.publicName);
  }

  get propsPath(): string {
    return join(this.publicDir, "props.json");
  }

  get rendersDir(): string {
    return join(this.dir, "renders");
  }

  get output(): string {
    return join(this.rendersDir, this.build.output ?? `${this.name}-final.mp4`);
  }

  get poster(): string {
    return join(this.rendersDir, "poster.webp");
  }

  /** What `gv render` records next to the MP4: the fingerprint of what it was made from. */
  get sidecar(): string {
    return this.output.replace(/\.mp4$/, ".render.json");
  }

  get qaDir(): string {
    return join(this.rendersDir, "qa");
  }

  /** The narration lock: text, voice, word timings, and the take's hash. */
  get lock(): string {
    return join(this.dir, "assets/audio/narration_words.json");
  }

  /** The locked ElevenLabs take. */
  get take(): string {
    return join(this.dir, "assets/audio/narration.mp3");
  }

  get buildScript(): string {
    return join(this.dir, "build.ts");
  }
}

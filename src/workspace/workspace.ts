import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRoot, loadConfig, resolveConfig, type ResolvedConfig } from "../config/load.ts";
import type { OncueConfig } from "../config/config.ts";
import { fail } from "../core/errors.ts";
import { readJson } from "../core/json.ts";
import { cmd, packageRoot, programName, setProgramName } from "../core/program.ts";
import type { Voice } from "../narration/voice.ts";
import { Project } from "./project.ts";
import type { Catalog } from "./types.ts";

/** Every location oncue reads or writes. Tests point some of them at temporary directories. */
export interface WorkspacePaths {
  root: string;
  projects: string;
  catalog: string;
  /** The renderer's web root: brand assets, local fonts, each video's built props and assets. */
  public: string;
  /** Every approved MP4 and poster, content-addressed and append-only. */
  media: string;
  /** What the site pulls. */
  registry: string;
  /** Every accepted render of every video. */
  ledger: string;
  /** The git-ignored .env with API keys. */
  env: string;
  /** What `new` copies. */
  videoTemplate: string;
}

/** A video repo: its config, paths, catalog, and projects. */
export class Workspace {
  readonly paths: WorkspacePaths;
  readonly config: ResolvedConfig;

  /** `config` is resolved (resolveConfig); Workspace.create takes a config file's object. */
  constructor(root: string, config: ResolvedConfig = resolveConfig(), overrides: Partial<WorkspacePaths> = {}) {
    const r = resolve(root);
    this.config = config;
    const p = config.paths;
    this.paths = {
      root: r,
      projects: join(r, p.projects),
      catalog: join(r, p.catalog),
      public: join(r, p.public),
      media: join(r, p.media),
      registry: join(r, p.registry),
      ledger: join(r, p.ledger),
      env: join(r, p.env),
      videoTemplate: p.videoTemplate ? join(r, p.videoTemplate) : join(packageRoot(), "templates", "video"),
      ...overrides,
    };
  }

  static create(root: string, config: OncueConfig = {}, overrides: Partial<WorkspacePaths> = {}): Workspace {
    return new Workspace(root, resolveConfig(config), overrides);
  }

  /**
   * The repo that contains `from` (default: the working directory), found by its oncue config.
   * Also sets the program name messages use.
   */
  static async load(from: string = process.cwd()): Promise<Workspace> {
    const root = findRoot(from) ?? fail(`no oncue.config.ts here or in any parent folder. Run ${cmd("init")} to create one.`);
    const ws = Workspace.create(root, await loadConfig(root));
    setProgramName(ws.config.cli.name);
    return ws;
  }

  get root(): string {
    return this.paths.root;
  }

  get catalogFile(): string {
    return join(this.paths.catalog, "catalog.json");
  }

  /** Read fresh each call: `deploy` and `new` change it mid-run. */
  catalog(): Catalog {
    return readJson<Catalog>(this.catalogFile);
  }

  /** The house voice (catalog/voice.json), so every machine narrates the same way. */
  houseVoice(): Voice {
    const f = join(this.paths.catalog, "voice.json");
    if (!existsSync(f)) fail(`no house voice at ${f}. See the README's "Voice" section.`);
    const v = readJson<Voice>(f);
    return { voice_id: v.voice_id, model_id: v.model_id, settings: v.settings };
  }

  /** Transcript display forms (catalog/spoken.json): [regex on the narration, written form]. */
  spokenReplacements(): [string, string][] {
    const f = join(this.paths.catalog, "spoken.json");
    return existsSync(f) ? readJson<{ replacements: [string, string][] }>(f).replacements : [];
  }

  project(dir: string): Project {
    return new Project(dir, this.paths.public);
  }

  /** Every project, in the catalog's display order (projects missing from it last). */
  projects(): Project[] {
    if (!existsSync(this.paths.projects)) return [];
    const dirs = readdirSync(this.paths.projects, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.paths.projects, d.name, "video.json")))
      .map((d) => d.name)
      .sort();
    const ps = dirs.map((d) => this.project(join(this.paths.projects, d)));
    const order = new Map((this.catalog().order ?? []).map((id, i) => [id, i]));
    const rank = (p: Project) => order.get(p.id) ?? order.size;
    return ps.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
  }

  /** Projects by folder name or video id; every project with `all`. */
  resolve(names: string[], all = false): Project[] {
    const ps = this.projects();
    if (all) return ps;
    if (!names.length) fail("name one or more videos (folder or id), or pass --all");
    return names.map((n) => ps.find((p) => p.name === n || p.id === n) ?? fail(`no video '${n}'. \`${programName()} list\` shows them all.`));
  }
}

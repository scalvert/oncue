import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { packageRoot } from "../core/program.ts";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DEFAULT_WORKERS = Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2)));

/** What window.oncue.init returns (composition/render/entry.tsx). */
export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}

/** The package's composition folder: the render page, the built-in Explainer, bundled fonts. */
export const compositionDir = (): string => join(packageRoot(), "composition");

/** The built-in composition. */
export const explainerEntry = (): string => join(compositionDir(), "src", "Explainer.tsx");

/**
 * Resolves `oncue:composition` to the composition to mount, and React to the package's own copy,
 * so a repo's composition and the runtime share one React.
 */
function compositionPlugin(entry: string): Plugin {
  const req = createRequire(join(packageRoot(), "package.json"));
  return {
    name: "oncue-composition",
    setup(b) {
      b.onResolve({ filter: /^oncue:composition$/ }, () => ({ path: entry }));
      b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: req.resolve(args.path) }));
    },
  };
}

/**
 * Bundle the render page into <out>/_render. `composition` is the module to mount (default: the
 * built-in Explainer); it default-exports a component that takes ExplainerProps.
 */
export async function bundle(out: string, composition: string = explainerEntry()): Promise<void> {
  const dir = join(out, "_render");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(compositionDir(), "render", "index.html"), join(dir, "index.html"));
  await build({
    absWorkingDir: compositionDir(),
    entryPoints: ["render/entry.tsx"],
    bundle: true,
    format: "iife",
    target: "chrome120",
    jsx: "automatic",
    logLevel: "warning",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [compositionPlugin(resolve(composition))],
    outfile: join(dir, "bundle.js"),
  });
}

/**
 * The composition, mounted in headless Chromium. frame(n) resolves once frame n is laid out,
 * fonts are loaded, every image is decoded, and nothing holds the render, so captures are never
 * half-painted and the same props always give the same pixels.
 */
export class RenderPage {
  readonly page: Page;
  readonly config: VideoConfig;

  private constructor(page: Page, config: VideoConfig) {
    this.page = page;
    this.config = config;
  }

  static async open(browser: Browser, base: string, propsUrl: string): Promise<RenderPage> {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/_render/index.html`);
    const config = await page.evaluate((u) => (window as any).oncue.init(u) as Promise<VideoConfig>, propsUrl);
    if (errors.length) throw new Error(`composition error: ${errors[0]}`);
    return new RenderPage(page, config);
  }

  async frame(n: number): Promise<void> {
    await this.page.evaluate((i) => (window as any).oncue.frame(i) as Promise<void>, n);
  }
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

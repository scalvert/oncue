/**
 * Real 2x captures of public pages, with element boxes in image pixels for zooms and highlights.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { dumps } from "../core/json.ts";
import { round } from "../core/numbers.ts";
import { type Box, boxOf } from "./index.ts";

export interface RegionCapture {
  url: string;
  out: string;
  /** The clip starts 20 CSS px above the first element with this text (default: the page top). */
  topText?: string;
  /** The clip ends at the first element with this text (default: `height` below the top). */
  bottomText?: string;
  height?: number;
  clipX?: number;
  clipW?: number;
  /** Strings to box: up to 8 matches each, inside the clip. */
  targets?: string[];
  dark?: boolean;
}

/**
 * A region of a page at 2x. Writes `out` (a PNG) and <out>.targets.json:
 * {target: [{x, y, width, height}, ...]} in image pixels.
 */
export async function captureRegion(o: RegionCapture): Promise<{ size: [number, number]; targets: Record<string, Box[]> }> {
  const clipX = o.clipX ?? 300;
  const clipW = o.clipW ?? 880;
  const browser = await chromium.launch();
  try {
    const pg = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: o.dark ? "dark" : "light" });
    await pg.goto(o.url, { waitUntil: "networkidle" });
    await pg.waitForTimeout(800);
    const yOf = async (text: string) => (await pg.getByText(text, { exact: false }).first().boundingBox())!.y;
    const top = o.topText ? (await yOf(o.topText)) - 20 : 0;
    const bottom = o.bottomText ? await yOf(o.bottomText) : top + (o.height ?? 1400);
    await pg.screenshot({ path: o.out, fullPage: true, clip: { x: clipX, y: top, width: clipW, height: bottom - top } });
    const targets: Record<string, Box[]> = {};
    for (const t of o.targets ?? []) {
      const loc = pg.getByText(t, { exact: false });
      const boxes: Box[] = [];
      for (let i = 0; i < Math.min(await loc.count(), 8); i++) {
        const bb = await loc.nth(i).boundingBox();
        if (bb && top <= bb.y && bb.y <= bottom) {
          boxes.push({ x: round((bb.x - clipX) * 2), y: round((bb.y - top) * 2), width: round(bb.width * 2), height: round(bb.height * 2) });
        }
      }
      targets[t] = boxes;
    }
    writeFileSync(o.out.replace(/\.[^./]*$/, "") + ".targets.json", dumps(targets, { indent: 1 }));
    return { size: [clipW * 2, round((bottom - top) * 2)], targets };
  } finally {
    await browser.close();
  }
}

export interface PagesSpec {
  out_dir?: string;
  shots?: { name: string; url: string; heading?: string; items?: Record<string, string>; offset?: number }[];
  images?: { name: string; url: string }[];
}

/**
 * Viewport captures from a spec file:
 *
 *   {"out_dir": "capture", "shots": [
 *      {"name": "why", "url": "https://...", "heading": "Why a gateway",
 *       "items": {"risk1": "Unvetted sources"}, "offset": 140}
 *   ], "images": [{"name": "arch", "url": "https://.../diagram.png"}]}
 *
 * Each shot scrolls the heading to `offset` px from the top, screenshots the viewport, and
 * records boxes for the heading and for each item (the first li/p/td/tr/h3 containing the text).
 * `images` downloads published page images as-is (real assets, never redrawn). Writes
 * <out_dir>/<name>.png and <out_dir>/targets.json (merged with any existing file).
 */
export async function capturePages(specPath: string, log: (line: string) => void = console.log): Promise<void> {
  const spec = JSON.parse(readFileSync(resolve(specPath), "utf8")) as PagesSpec;
  const outDir = resolve(dirname(resolve(specPath)), spec.out_dir ?? ".");
  mkdirSync(outDir, { recursive: true });
  const tfile = join(outDir, "targets.json");
  const targets = (existsSync(tfile) ? JSON.parse(readFileSync(tfile, "utf8")) : {}) as Record<string, unknown>;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    for (const shot of spec.shots ?? []) {
      await page.goto(shot.url, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      const t: Record<string, Box | null> = {};
      if (shot.heading) {
        const h = page.getByRole("heading", { name: shot.heading }).first();
        await h.scrollIntoViewIfNeeded();
        await page.evaluate((y) => window.scrollBy(0, y), (await h.boundingBox())!.y - (shot.offset ?? 140));
        await page.waitForTimeout(400);
        t.heading = await boxOf(h, 2);
      }
      for (const [key, text] of Object.entries(shot.items ?? {})) {
        const loc = page.locator("li, p, td, tr, h3").filter({ hasText: text });
        t[key] = (await loc.count()) ? await boxOf(loc, 2) : null;
        if (!t[key]) log(`  ! ${shot.name}.${key}: no element contains ${JSON.stringify(text)}`);
      }
      await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
      targets[shot.name] = t;
      log(`${shot.name}.png ${JSON.stringify(t)}`);
    }
  } finally {
    await browser.close();
  }
  for (const img of spec.images ?? []) {
    const dest = join(outDir, `${img.name}${extname(new URL(img.url).pathname) || ".png"}`);
    const r = await fetch(img.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`${img.url}: HTTP ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, bytes);
    log(`${dest.split("/").at(-1)} ${bytes.length}B (published image, unmodified)`);
  }
  writeFileSync(tfile, dumps(targets, { indent: 1 }));
}

/**
 * Decode a Browser Operator screenshot log (JSON with a base64 PNG) into a PNG. Screenshots of a
 * signed-in Chrome come back as JSON; the host spills large results to a log file.
 */
export function saveBrowserShot(src: string, out: string): string {
  const data = JSON.parse(readFileSync(src, "utf8")) as { screenshot: string; viewport_width: number; viewport_height: number };
  const png = Buffer.from(data.screenshot, "base64");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  return `${out} ${png.length}B viewport=${data.viewport_width}x${data.viewport_height}`;
}

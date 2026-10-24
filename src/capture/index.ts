/**
 * Helpers for capture scripts (projects/<video>/capture/*.ts): real screenshots and recorded
 * output that a video shows. Each script runs on its own with `node <script>.ts`.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "playwright";
import { round } from "../core/numbers.ts";

/** The directory a script lives in (pass import.meta.url): captures go next to it. */
export const here = (moduleUrl: string) => dirname(fileURLToPath(moduleUrl));

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The first match's bounding box in image pixels (CSS px x scale), or null when it isn't shown. */
export async function boxOf(locator: Locator, scale: number): Promise<Box | null> {
  const bb = await locator.first().boundingBox();
  return bb ? { x: round(bb.x * scale), y: round(bb.y * scale), width: round(bb.width * scale), height: round(bb.height * scale) } : null;
}

/**
 * oncue/capture: helpers for a project's capture scripts (projects/<folder>/capture/*.ts).
 */
export { boxOf, here, type Box } from "./capture/index.ts";
export { captureRegion, capturePages, saveBrowserShot, type PagesSpec, type RegionCapture } from "./capture/pages.ts";
export { captureCli, fetchPreload, replayServer } from "./capture/cli.ts";
/** The Playwright oncue renders with, so captures and renders use the same Chromium. */
export { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

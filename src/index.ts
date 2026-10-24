/**
 * oncue: what build scripts and configs import.
 *
 *   import { defineVideo } from "oncue";          // projects/<folder>/build.ts
 *   import { defineConfig } from "oncue";         // oncue.config.ts
 *
 * The pipeline (workspace, build, render, registry) is "oncue/engine"; capture helpers are
 * "oncue/capture".
 */
export * from "./builder/index.ts";
export { defineConfig, type ApprovalKind, type LocalSansFont, type OncueConfig, type RedactRule } from "./config/config.ts";
export { defaultTheme, type Theme, type ThemeColors, type ThemeInput } from "../composition/src/theme.ts";
export type { MediaStore, Uploaded } from "./release/blob.ts";
export { vercelBlob } from "./release/blob.ts";
export { OncueError } from "./core/errors.ts";
export { round, fixed } from "./core/numbers.ts";
export { isDigits, padEnd, slice, stripChars, wrap } from "./core/text.ts";
export { dimensions, ffmpeg } from "./media/ffmpeg.ts";

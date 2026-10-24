/**
 * oncue/engine: the pipeline the CLI wraps, for scripts, CI jobs, and tests. Every function takes
 * a Workspace (Workspace.load() finds the repo from the working directory).
 */
export { Workspace, type WorkspacePaths } from "./workspace/workspace.ts";
export { Project } from "./workspace/project.ts";
export type { Approval, BuildConfig, Catalog, Track, VideoMeta } from "./workspace/types.ts";
export { findRoot, loadConfig, resolveConfig, type ResolvedConfig } from "./config/load.ts";
export { initRepo, newVideo, type NewVideo } from "./workspace/scaffold.ts";
export { doctor, type Finding } from "./workspace/doctor.ts";

export { buildProject, narrate, summary, videoDefaults, type BuildOptions } from "./pipeline/build.ts";
export { poster, rendererFor, renderProject } from "./pipeline/render.ts";
export { Renderer } from "./render/renderer.ts";
export { bundle, explainerEntry } from "./render/page.ts";

export { ElevenLabs, type SpeechSynthesizer } from "./narration/elevenlabs.ts";
export { lockedTake, type NarrationMode } from "./narration/narrator.ts";
export { readLock, type NarrationLock } from "./narration/lock.ts";
export { voiceForRun, type Voice } from "./narration/voice.ts";

export { check, checkRelease, quickCheck, Report, scanText, type CheckOptions } from "./checks/checks.ts";
export { compare, frameReport, isSame } from "./media/compare.ts";

export * as registry from "./release/registry.ts";
export { deploy, type DeployOptions } from "./release/deploy.ts";
export { status, type StatusOptions } from "./release/status.ts";
export { inputsFingerprint, latest, loadLedger, rendererFingerprint, saveLedger, versionOf, type Ledger } from "./release/versions.ts";
export { vercelBlob, type MediaStore, type Uploaded } from "./release/blob.ts";

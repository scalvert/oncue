import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ExplainerProps } from "../../composition/src/props.ts";
import { fail } from "../core/errors.ts";
import { fixed } from "../core/numbers.ts";
import { localSansFont } from "../builder/fonts.ts";
import { isVideoDefinition, Video, type VideoDefaults } from "../builder/video.ts";
import { ElevenLabs } from "../narration/elevenlabs.ts";
import type { NarrationLock } from "../narration/lock.ts";
import { lockedTake, type NarrationMode } from "../narration/narrator.ts";
import type { SpeechSynthesizer } from "../narration/elevenlabs.ts";
import { isPlaceholder, placeholderSynthesizer } from "../narration/placeholder.ts";
import { type Voice, voiceForRun } from "../narration/voice.ts";
import type { Project } from "../workspace/project.ts";
import type { Workspace } from "../workspace/workspace.ts";

export interface BuildOptions {
  mode?: NarrationMode;
  /** What makes a new take in update mode (default: ElevenLabs with ELEVENLABS_API_KEY). */
  synthesizer?: () => SpeechSynthesizer;
  log?: (line: string) => void;
}

/** What makes a take with `voice`: the offline placeholder, or ElevenLabs. */
export function synthesizerFor(voice: Voice): () => SpeechSynthesizer {
  return isPlaceholder(voice) ? () => placeholderSynthesizer : () => new ElevenLabs(process.env.ELEVENLABS_API_KEY);
}

/** The project's locked take: regenerated only in update mode (`narrate`). */
export function narrate(ws: Workspace, p: Project, opts: BuildOptions = {}): Promise<NarrationLock> {
  const voice = voiceForRun(ws.houseVoice(), ws.config.narration.envPrefix);
  return lockedTake({
    folder: p.name,
    script: p.tsv,
    take: p.take,
    lock: p.lock,
    voice,
    mode: opts.mode ?? "frozen",
    synthesizer: opts.synthesizer ?? synthesizerFor(voice),
    log: opts.log,
  });
}

/** The look and caption forms every video in this workspace starts from. */
export function videoDefaults(ws: Workspace): VideoDefaults {
  const c = ws.config;
  return { brandLabel: c.brandLabel, theme: c.theme, spoken: c.captions.spoken, sans: localSansFont(ws.paths.public, c.localSans) };
}

/**
 * Build one video: load its locked narration, run its build.ts, and write the props and assets
 * the renderer reads (<public>/<name>/).
 */
export async function buildProject(ws: Workspace, p: Project, opts: BuildOptions = {}): Promise<ExplainerProps> {
  const log = opts.log ?? console.log;
  if (!existsSync(p.buildScript)) fail(`${p.name}: no build.ts`);
  const mod = (await import(pathToFileURL(p.buildScript).href)) as { default?: unknown };
  if (!isVideoDefinition(mod.default)) fail(`${p.buildScript}: the default export must be defineVideo(...)`);
  const lock = await narrate(ws, p, { ...opts, log });
  const video = new Video({ name: p.publicName, root: p.dir, publicRoot: ws.paths.public, lock, take: p.take, defaults: videoDefaults(ws), log });
  const props = await mod.default.build(video);
  writeFileSync(p.propsPath, JSON.stringify(props, null, 1));
  for (const line of summary(p.publicName, props)) log(line);
  return props;
}

/** What a build prints: the length and each scene's span. */
export function summary(name: string, props: ExplainerProps): string[] {
  return [
    `${name}: ${fixed(props.durationSeconds, 1)}s, ${props.scenes.length} scenes`,
    ...props.scenes.map((sc) => `  ${sc.id.padStart(6)} ${sc.type.padEnd(12)} ${fixed(sc.start, 2).padStart(6)}-${fixed(sc.end, 2).padStart(6)}`),
  ];
}

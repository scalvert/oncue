/**
 * `next`: what a video needs now, in plain words, and who does each step.
 *
 * It's the entry point for an agent working with someone who doesn't use the CLI: run
 * `next <video> --json`, do the agent steps, and ask the person for the person steps. Steps
 * marked `ask` need the person's OK first, because they cost money, change what's published, or
 * need a secret only the person has.
 *
 * The stages, in order; the first unfinished one decides the steps:
 *   script     narration.tsv is missing or still the template
 *   fix        video.json or the catalog has errors
 *   narrate    no take, or the script or voice changed since it was made
 *   render     no render, or the sources changed since it
 *   review     a render a person hasn't approved yet
 *   sign-off   approvals the video lists are still open
 *   deploy     an accepted version isn't on the media store
 *   done
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { metadataCheck } from "../checks/checks.ts";
import { programName } from "../core/program.ts";
import { readLock, staleness } from "../narration/lock.ts";
import { isPlaceholder } from "../narration/placeholder.ts";
import { readScript, takeText } from "../narration/script.ts";
import { voiceForRun } from "../narration/voice.ts";
import type { VideoState } from "../release/status.ts";
import type { Project } from "../workspace/project.ts";
import type { Workspace } from "../workspace/workspace.ts";

/** A command to run as is (no backticks: `next --json` hands these to agents). */
const cmd = (args: string): string => `${programName()} ${args}`;

export type Stage = "script" | "fix" | "narrate" | "render" | "review" | "sign-off" | "deploy" | "done";

export interface Step {
  /** Who does it: the agent runs commands and edits files; the person decides, listens, and approves. */
  who: "agent" | "person";
  /** What to do, in plain words. */
  what: string;
  /** The command the agent runs, when there is one. */
  command?: string;
  /** The agent must ask the person before doing it. */
  ask?: boolean;
}

export interface NextReport {
  video: string;
  folder: string;
  title: string;
  stage: Stage;
  /** One sentence on where the video is. */
  summary: string;
  steps: Step[];
  /** Not blocking now, but needed before release. */
  later: string[];
}

/** The open sign-offs: listed but unrecorded, or required and not listed. */
export function openSignOffs(ws: Workspace, p: Project): { key: string; who: string }[] {
  const kinds = ws.config.metadata.approvals;
  const listed = (p.meta.approvals ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(listed), ...Object.entries(kinds).filter(([, k]) => k.required).map(([key]) => key)]);
  return [...keys].filter((k) => !listed[k]).sort().map((key) => ({ key, who: kinds[key]?.who ?? key }));
}

function isTemplateScript(ws: Workspace, p: Project): boolean {
  if (!existsSync(p.tsv)) return true;
  const tpl = join(ws.paths.videoTemplate, "narration.tsv");
  return existsSync(tpl) && readFileSync(tpl, "utf8").trim() === readFileSync(p.tsv, "utf8").trim();
}

/** `buildError`: why the build script failed, when it did (only tried once the take is current). */
export function next(ws: Workspace, p: Project, state: VideoState | undefined, buildError?: string): NextReport {
  const v = p.name;
  const report = (stage: Stage, summary: string, steps: Step[], later: string[] = []): NextReport => ({
    video: p.id,
    folder: v,
    title: String(p.meta.title ?? p.id),
    stage,
    summary,
    steps,
    later,
  });

  const voice = voiceForRun(ws.houseVoice(), ws.config.narration.envPrefix);
  const placeholder = isPlaceholder(voice);
  const later: string[] = [];
  if (placeholder) later.push("The house voice is a placeholder (tones). Before release, the person picks a real voice for catalog/voice.json.");
  const signOffs = openSignOffs(ws, p);
  if (signOffs.length) later.push(`Open sign-offs: ${signOffs.map((s) => `${s.key} (${s.who})`).join(", ")}.`);

  if (isTemplateScript(ws, p)) {
    return report(
      "script",
      "The video has no script yet.",
      [
        { who: "person", what: "Say what the video is about, who it's for, and what viewers should do after watching." },
        { who: "agent", what: `Draft ${relative(ws.root, p.tsv)}: one row per scene, short spoken sentences, about 45-90 seconds in total. Read it back to the person scene by scene.` },
        { who: "person", what: "Approve the script, or say what to change." },
      ],
      later,
    );
  }

  const meta = metadataCheck(ws, p).errors.map((e) => e.slice(e.indexOf(": ") + 2));
  if (meta.length) {
    return report("fix", "The video's details need fixing first.", meta.map((e) => ({ who: "agent" as const, what: `Fix: ${e}` })), later);
  }

  const lock = readLock(p.lock);
  const stale = staleness(lock, takeText(readScript(p.tsv), voice.model_id), voice, existsSync(p.take));
  if (stale) {
    const paid = !placeholder;
    return report(
      "narrate",
      stale === "no locked take" ? "The script is ready to be recorded." : `The narration needs re-recording: ${stale}.`,
      [
        ...(paid && !process.env.ELEVENLABS_API_KEY
          ? [{ who: "person" as const, what: "Put the ElevenLabs API key in .env as ELEVENLABS_API_KEY=... (the agent never handles the key)." }]
          : []),
        { who: "agent", what: paid ? "Record the narration with the house voice. It uses ElevenLabs credits." : "Record the narration (the offline placeholder voice).", command: cmd(`narrate ${v}`), ask: paid },
        ...(paid ? [{ who: "person" as const, what: "Listen to the new take, especially names and acronyms. Say which words sound wrong." }] : []),
      ],
      later,
    );
  }

  if (buildError) {
    return report("fix", "The build script fails.", [{ who: "agent", what: `Fix ${relative(ws.root, p.buildScript)}: ${buildError}`, command: cmd(`build ${v}`) }], later);
  }

  const s = state;
  const needsRender = !s ? !existsSync(p.output) : s.source === "re-render" || s.source === "unknown" || (s.source === "unaccepted" && !s.rendered);
  if (needsRender) {
    const summary = existsSync(p.output)
      ? "The video changed since its last render."
      : s?.version
        ? `Something it's built from changed since v${s.version} was accepted. Render it to see whether the video changed.`
        : "The video hasn't been rendered yet.";
    return report(
      "render",
      summary,
      [{ who: "agent", what: "Render the video, then look at the QA sheet and frames at each transition.", command: cmd(`render ${v}`) }],
      later,
    );
  }

  if (s && (s.renderWaiting || s.source === "rendered")) {
    return report(
      "review",
      s.version ? `A new render is waiting to replace v${s.version}.` : "The first render is ready for review.",
      [
        { who: "agent", what: "Open the review page for the person.", command: cmd(`review ${v}`) },
        { who: "person", what: "Watch and listen to the whole video. Say what to change, or approve it." },
        ...(s.version
          ? [
              {
                who: "agent" as const,
                what: `Compare it with v${s.version} and explain each difference to the person in plain words.`,
                command: cmd(`compare ${v} ${s.acceptedUrl ?? "<accepted.mp4>"} --frames /tmp/compare-${v}`),
              },
            ]
          : []),
        { who: "agent", what: "Once the person approves, accept the render with their note.", command: cmd(`registry --accept ${p.id} --note "<the person's reason>"`), ask: true },
      ],
      later,
    );
  }
  if (s?.source === "reproduced") {
    return report(
      "review",
      "The current sources reproduce the accepted version exactly.",
      [{ who: "agent", what: "Record that (no new version, nothing published changes).", command: cmd(`registry --accept ${p.id} --note "reproduced"`), ask: true }],
      later,
    );
  }

  if (signOffs.length) {
    return report(
      "sign-off",
      `The video is approved but waiting on ${signOffs.length === 1 ? "a sign-off" : "sign-offs"}.`,
      [
        ...signOffs.map((o) => ({ who: "person" as const, what: `Get the ${o.key} sign-off from ${o.who}.` })),
        { who: "agent", what: 'Record each one in video.json approvals as {"by", "date", "note"}, as the person reports it.' },
      ],
      later.filter((l) => !l.startsWith("Open sign-offs")),
    );
  }

  if (s && (s.deploy === "missing" || s.deploy === "no-host")) {
    return report(
      "deploy",
      "The accepted version isn't on the media store yet.",
      [
        { who: "agent", what: "Upload it. This publishes the files.", command: cmd("deploy"), ask: true },
        { who: "agent", what: "Commit registry.json and versions.json, and open a pull request.", ask: true },
      ],
      later,
    );
  }

  return report("done", s?.version ? `v${s.version} is accepted and published.` : "Nothing to do.", [], later);
}

/** Plain-text form for people and terminals. */
export function formatNext(r: NextReport): string {
  const lines = [`${r.title} (${r.folder}): ${r.summary}`];
  r.steps.forEach((s, i) => {
    const who = s.who === "person" ? "You" : "Agent";
    lines.push(`  ${i + 1}. ${who}: ${s.what}${s.ask ? " (ask first)" : ""}`);
    if (s.command) lines.push(`       ${s.command}`);
  });
  for (const l of r.later) lines.push(`  Later: ${l}`);
  return lines.join("\n");
}

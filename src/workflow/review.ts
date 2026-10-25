/**
 * `review`: a self-contained page for the person who approves a video. It shows the render, the
 * script scene by scene (click a time to jump there), the words most likely to be mispronounced,
 * the storyboard, and a feedback box per scene. "Copy feedback" puts the notes on the clipboard in
 * a form the person can paste back to the agent.
 *
 * The page lives next to the render (renders/review.html) and reads it with a relative path, so
 * it works from the file system with no server.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fail } from "../core/errors.ts";
import { cmd } from "../core/program.ts";
import { readScript } from "../narration/script.ts";
import type { Project } from "../workspace/project.ts";
import type { Workspace } from "../workspace/workspace.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Words a voice often gets wrong: acronyms (API, SDK), spelled-out letters ("X A A"), mixed case
 * (OAuth, GitHub), hyphenated codes (ID-JAG), and words with digits. Delivery tags are skipped.
 */
export function wordsToCheck(text: string): string[] {
  const clean = text.replace(/\[[a-z ]+\]/g, " ");
  const found = new Set<string>();
  for (const m of clean.matchAll(/\b(?:[A-Z](?: [A-Z]){1,5})\b/g)) found.add(m[0]); // X A A
  for (const m of clean.matchAll(/[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)+/g)) if (/[A-Z]/.test(m[0]) && !/^[A-Z][a-z]+\.$/.test(m[0])) found.add(m[0]);
  for (const m of clean.matchAll(/\b[A-Za-z]*(?:[A-Z]{2,}|[a-z][A-Z]|\d)[A-Za-z0-9]*\b/g)) {
    const w = m[0];
    if (w.length > 1 && !/^\d+$/.test(w) && ![...found].some((f) => f.includes(w))) found.add(w);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

interface Scene {
  id: string;
  start: number;
}

export function reviewPage(ws: Workspace, p: Project): string {
  if (!existsSync(p.output)) fail(`${p.name} has no render yet. Run ${cmd(`render ${p.name}`)} first.`);
  const rows = readScript(p.tsv);
  const props = existsSync(p.propsPath) ? (JSON.parse(readFileSync(p.propsPath, "utf8")) as { scenes?: Scene[]; durationSeconds?: number }) : {};
  const starts = new Map((props.scenes ?? []).map((s) => [s.id, s.start]));
  const renders = p.rendersDir;
  const video = relative(renders, p.output);
  const poster = existsSync(p.poster) ? relative(renders, p.poster) : "";
  const sheet = join(p.qaDir, "sheet.png");
  const storyboard = join(p.dir, "STORYBOARD.md");
  const words = wordsToCheck(rows.map((r) => r.text).join(" "));
  const title = String(p.meta.title ?? p.id);

  const sceneRows = rows
    .map((r) => {
      const t = starts.get(r.id);
      const at = t === undefined ? "" : `<button class="t" data-t="${t}">${clock(t)}</button>`;
      return `<tr><td class="id">${esc(r.id)}</td><td>${at}</td><td class="say">${esc(r.text).replace(/\[[a-z ]+\]/g, (t) => `<span class="tag" title="how the voice says it; not spoken">${t}</span>`)}</td><td><textarea data-scene="${esc(r.id)}" placeholder="What should change here?"></textarea></td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Review: ${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 24px; color: #111; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; }
  .sub { color: #555; margin: 0 0 16px; }
  video { width: 100%; border-radius: 8px; background: #000; }
  ol.how li { margin: 4px 0; }
  .words span { display: inline-block; background: #FFF4C2; border-radius: 6px; padding: 2px 8px; margin: 3px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 8px 6px; border-top: 1px solid #ddd; }
  td.id { color: #777; width: 36px; } td.say { width: 50%; } .tag { color: #999; font-size: 13px; }
  button.t { font: inherit; border: 1px solid #bbb; background: #f6f6f6; border-radius: 6px; padding: 0 8px; cursor: pointer; }
  textarea { width: 100%; min-height: 48px; font: inherit; }
  .actions { margin: 12px 0; display: flex; gap: 12px; align-items: center; }
  .actions button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 0; background: #2563EB; color: #fff; cursor: pointer; }
  pre { white-space: pre-wrap; background: #f6f6f6; padding: 12px; border-radius: 8px; font-size: 13px; }
  img.sheet { width: 100%; border: 1px solid #ddd; border-radius: 8px; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${esc(p.name)} · ${props.durationSeconds ? `${props.durationSeconds.toFixed(1)} s` : ""} · rendered file: ${esc(basename(p.output))}</p>
<video id="v" controls preload="metadata" src="${esc(video)}"${poster ? ` poster="${esc(poster)}"` : ""}></video>

<h2>How to review</h2>
<ol class="how">
  <li>Watch the whole video once with sound on.</li>
  <li>Listen closely to the words below. Voices often get these wrong.</li>
  <li>Check that every claim is true and every screen is real (the storyboard says which are examples).</li>
  <li>Write what should change next to each scene, then press <b>Copy feedback</b> and paste it to your agent.</li>
  <li>If nothing needs to change, tell your agent you approve the video.</li>
</ol>

<h2>Words to listen for</h2>
<p class="words">${words.length ? words.map((w) => `<span>${esc(w)}</span>`).join("") : "None found."}</p>

<h2>Script</h2>
<table>${sceneRows}</table>
<div class="actions"><button id="copy">Copy feedback</button><span id="copied"></span></div>
<p><label>Anything else: <textarea id="general" placeholder="Pacing, music, the overall message..."></textarea></label></p>

${existsSync(storyboard) ? `<h2>Storyboard</h2><pre>${esc(readFileSync(storyboard, "utf8"))}</pre>` : ""}
${existsSync(sheet) ? `<h2>Contact sheet</h2><img class="sheet" alt="frames from the video" src="${esc(relative(renders, sheet))}">` : ""}

<script>
  const v = document.getElementById("v");
  for (const b of document.querySelectorAll("button.t")) b.onclick = () => { v.currentTime = Number(b.dataset.t); v.play(); };
  document.getElementById("copy").onclick = async () => {
    const notes = [...document.querySelectorAll("textarea[data-scene]")].filter((t) => t.value.trim()).map((t) => "- " + t.dataset.scene + ": " + t.value.trim());
    const general = document.getElementById("general").value.trim();
    const text = ["Feedback on ${esc(p.name)}:", ...notes, ...(general ? ["- overall: " + general] : [])].join("\\n");
    try { await navigator.clipboard.writeText(text); document.getElementById("copied").textContent = "Copied. Paste it to your agent."; }
    catch { prompt("Copy this and paste it to your agent:", text); }
  };
</script>
</body></html>
`;
}

/** Write renders/review.html and return its path. */
export function writeReview(ws: Workspace, p: Project): string {
  const out = join(p.rendersDir, "review.html");
  writeFileSync(out, reviewPage(ws, p));
  return out;
}

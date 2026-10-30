# Builder API

A video is `projects/<name>/narration.tsv` plus `projects/<name>/build.ts`. The build script's
default export is `defineVideo(...)`. oncue loads the locked narration, passes your function a
`Video`, and writes the props it returns to `<public>/<video>/props.json`.

Times passed to helpers are absolute video seconds, almost always from `v.cue(...)`. The helpers
convert them to scene-relative times.

```ts
import { defineVideo, lines } from "oncue";

export default defineVideo((v) => {
  v.retime({ s3: 1.1 }); // a 1.1 s pause after s3
  const { cue } = v;
  v.hero("s1", ["Line one.", "Line two."], [["Search", "Search,"]]);
  // ...
  v.endCard("s6", "Try the recipe.", "docs.example.com/recipes/search");
  return v.props({ seriesTag: "API basics" });
});
```

`oncue build <video>` runs it with the locked narration. `oncue render <video>` also renders. Your
editor type-checks every call; run `tsc --noEmit` in CI.

## Video

| Method | Purpose |
|---|---|
| `retime(gaps={sid: secs}, {defaultGap: 0.8, preRoll: 0})` | Cut the take at segment boundaries and insert silence after each. Cuts land in the quiet gap before any stray sound and fade over 30 ms. Words never change. `preRoll` leaves that many seconds before the first scene (see below) |
| `playTake({gate, preRoll: 0})` | Play the take as recorded instead. `gate: true` silences the gaps between segments |
| `cue(seg, "phrase")` | Start time of the first word of `phrase` in segment `seg`. Ignores punctuation; fails if not found |
| `segEnd(seg)`, `span(sid)`, `rel(sid, t)` | A segment's end; a scene's `[start, end]`; `t` relative to a scene's start |
| `hero(sid, lines, chips=[[text, cuePhrase]])` | Two-line title; chips pop in on their cues |
| `statement(sid, line1, line2, highlightCue)` | Big statement; line 2 is highlighted at the cue |
| `terminal(sid, term, label, title, {fontSize, endId})` | Dark terminal window. `label` is the eyebrow, `title` the window title. `endId` spans several segments |
| `card(sid, label, heading, items=[[text, cuePhrase]], doc)` | Checklist on the left, concept card on the right. `doc = {source, title, visibleTo, chipsLabel}` |
| `flow(sid, label, {lanes, messages, notes, tag})` | Sequence diagram (messages) or per-system steps (notes), animated on cues. Messages take one row each, in order, below the lane headers. Notes stack from the top of their lane, so a note covers the first message labels that cross that lane: put it on a lane those arrows don't cross, and check the frame |
| `exchange(sid, label, {request, response, highlights, tag})` | One API call: request left, response right. Lines are verbatim; trim with `jsonView`, never edit |
| `endCard(sid, headline, url)` | Closing card |
| `capture({...})`, `addCapture(c, sid, end)` | A browser-capture scene (below) |
| `add(scene)` | Add a raw scene, typed as the composition's `Scene` union |
| `asset(path, name?)` | Copy a file into `<public>/<video>/` and return the path props use |
| `readText(rel)`, `readJson(rel)`, `path(...)` | Read captured files from the project folder |
| `props({brandLabel, seriesTag, look, extraSpoken, captions, localSans, extra})` | The props to return. `extraSpoken` adds spoken forms to caption as written (`"x dot y"`, or `["slash API", "/api"]`). `localSans: false` skips the config's local font |

Helpers: `lines(text)`, `splitLines(text)`, `jsonLines(value)`, `jsonView(value, keep)` with
`pathSet(...paths)` (a captured response with dropped runs collapsed to `...`), `wrap`, `round`,
`dumps`, and `fail`.

## Terminal steps (`const t = v.term(sid)`)

Steps sit on a cursor so lines never overlap. A step whose cue is earlier than the cursor moves
later, so check the timeline that `oncue build` prints.

| Method | Use |
|---|---|
| `cmd(text, {at, prompt="$", cs=0.028, hold=0.3})` | A typed command |
| `out(text, {at, tone: "default" \| "ok" \| "dim" \| "agent"})` | One output line |
| `lines(block, {at, tone})` | A block of output; the first line lands on `at` |
| `stream(text, {at, width=86, cs=0.022})` | Streamed model output, wrapped and revealed progressively |
| `feed(transcript, {anchors, tone, answers})` | Replay a captured TTY transcript verbatim. `anchors` pin lines to cues; `answers` become typed replies after prompts |
| `pill(text, {at, duration=2.6})` | A callout above the terminal, such as `POST /v1/search` |

## Browser captures (`const c = v.capture({start, url, size, image, wide: {cx, cy, w}, eyebrow})`)

The viewport is 1600×628. The camera's `w` is the visible image width in pixels; the visible height
is `w * 628/1600`. Camera keyframe times are arrival times: a move runs over `[at - dur, at]`.

| Method | Use |
|---|---|
| `cam(at, {cy, w=1380, cx, dur=0.9})` | Move or zoom. The default `cx = w/2 + 20` keeps the left margin in frame |
| `backWide(at)` | Return to the wide shot |
| `hl(at, until, x, y, w, h)` | A highlight ring in image pixels. Use the boxes `oncue capture page` records |
| `click(at, [x, y], {image, label})` | Animated cursor click; can swap the image and the eyebrow |
| `eyebrow(at, text)` | Change the eyebrow mid-scene |
| `image(at, src)` | Swap images without a click. Every image in one scene must be the same size |

## Scenes in the composition

`hero`, `statement`, `terminal`, `capture`, `permissions` (card), `flow`, `exchange`, and `end`. Their
props are typed in `composition/src/props.ts` and drawn by `composition/src/Explainer.tsx`.

To use your own composition, set `composition` in the config to a `.tsx` module whose default
export is a React component that takes the video's props. oncue bundles it with esbuild and renders
it the same way (see `composition/render/README.md` for the frame contract).

A custom composition can also wrap the built-in one, to add an intro or an overlay without
redrawing the scenes. Import it from `oncue/composition/Explainer.tsx`, and import the frame clock
(`useCurrentFrame`, `interpolate`, `AbsoluteFill`) from `oncue/composition/runtime/index.tsx`.

### Pre-roll for an intro

`v.retime(gaps, { preRoll: 2.4 })` starts the first scene 2.4 s in, and the narration 2.4 s later
than usual. Every cue moves with it, so a build script needs no other change. The props carry
`preRoll`, and the composition can draw an intro, such as an animated logo, in `[0, preRoll)`.
The built-in composition shows only its backdrop during the pre-roll. Then it fades in the first
scene and the wordmark. Without a pre-roll, the props and every frame are unchanged.

## The engine

`oncue/engine` exports each step so scripts and tests can call it directly:

| Export | Owns |
|---|---|
| `Workspace`, `Project` | The repo: config, paths, catalog, projects, `video.json` |
| `buildProject`, `renderProject` | What `oncue build` and `oncue render` run |
| `check` | `oncue check` |
| `registry`, `loadLedger`, `versionOf`, fingerprints | Versions and the public registry |

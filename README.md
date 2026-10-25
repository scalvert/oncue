# oncue

Narrated explainer videos from code. You write a script and a small TypeScript build file. oncue
records the narration, lines up every visual with the word it belongs to, burns in captions, and
renders an MP4 and a poster with headless Chromium and ffmpeg.

It's built for product and developer videos that have to stay correct: terminal sessions replayed
from real output, browser captures from real pages, and a release flow that never changes published
media by accident.

```ts
// projects/search-api/build.ts (trimmed from examples/acme)
import { defineVideo } from "oncue";

export default defineVideo((v) => {
  v.retime({ s1: 0.8, s2: 1.0 });
  v.hero("s1", ["One search call,", "start to finish."], [["POST /v1/search", "one search call"]]);

  // Real output, captured by running curl against oncue's replay server.
  const t = v.term("s2");
  t.cmd(`curl -s -X POST $ACME/v1/search -d '{"query":"refund policy"}' | jq .`, { at: v.cue("s2", "post a query") });
  t.lines(v.readText("capture/search.jq.txt"), { at: v.cue("s2", "the response") });
  v.terminal("s2", t, "THE REQUEST", "terminal");

  v.endCard("s3", "Read the full reference.", "docs.acme.dev");
  return v.props({ seriesTag: "Search API" });
});
```

## Quick start

You need Node 22.18 or later and ffmpeg.

```bash
mkdir my-videos && cd my-videos
npx oncue init                 # config, catalog, voice, and a "hello" video
npm install --save-dev oncue
npx playwright install chromium
npx oncue doctor               # checks Node, ffmpeg, Chromium, and the voice
npx oncue narrate hello        # records the take (offline placeholder voice by default)
npx oncue render hello         # projects/hello/renders/hello-final.mp4
```

The starter voice is a placeholder that makes tones instead of speech. It lets you draft, time, and
render without an account. Release checks reject it. For real narration, set `catalog/voice.json` to
an ElevenLabs voice and put `ELEVENLABS_API_KEY` in `.env`.

## Making a video with an AI agent

You don't need to use the terminal. Open the repo in a coding agent (Claude Code, Codex, Cursor,
Glean, and others) and say what video you want. `oncue init` writes an `AGENTS.md` that tells the
agent how to work with you:

1. You say what the video is about and who it's for. The agent drafts the script and reads it back.
2. You approve the script. The agent records the narration, after asking, because a real voice
   costs money.
3. You listen. The agent can't hear audio, so you check names and acronyms.
4. The agent renders the video and opens a review page (`oncue review`): the video, the script with
   timestamps, the words to listen for, and a feedback box for each scene.
5. You approve it or paste your feedback back. The agent repeats until you approve, then records the
   sign-offs you collect.

The agent finds each step with `oncue next --json`. It reports every video's stage (script, narrate,
render, review, sign-off, deploy) and the next steps, each marked `agent` or `person`. Steps that
cost money or change what's published are marked `ask`, so the agent checks with you first. People
can run `oncue next` too:

```text
$ npx oncue next hello
Acme in one minute (hello): The first render is ready for review.
  1. Agent: Open the review page for the person.
       oncue review hello
  2. You: Watch and listen to the whole video. Say what to change, or approve it.
  3. Agent: Once the person approves, accept the render with their note. (ask first)
       oncue registry --accept hello --note "<the person's reason>"
```

The agent never handles API keys. You put them in `.env` yourself.

## How it works

Each video is a folder under `projects/`:

| File | What it is |
|---|---|
| `narration.tsv` | The script: one `sN<TAB>text` row per scene |
| `build.ts` | Places visuals on narration cues and returns the composition's props |
| `video.json` | Id, title, series, and sign-offs |
| `narration.lock.json` | The recorded take: audio hash, word timings, and the voice it used |
| `capture/` | Real material the build reads: terminal output, screenshots, API responses |
| `STORYBOARD.md` | Scenes, sources for each claim, and what's real versus illustrative |

`oncue narrate` is the only step that calls the voice. It records each scene and aligns every word,
then writes the lock. `oncue build` and `oncue render` never call it; they replay the locked take.
That keeps renders reproducible, and a script edit can't silently change the audio.

Visuals go on words, not timestamps: `v.cue("s2", "back")` is the moment the narrator says "back" in
scene s2. If you rewrite a line, the visuals move with the new take.

## Commands

| Command | Does |
|---|---|
| `oncue init [dir]` | Scaffold a repo: config, catalog, voice, and a starter video |
| `oncue new <folder> --id <id> --title <title>` | Add a video from the template |
| `oncue next [video] [--json]` | What each video needs now, and who does it (start here) |
| `oncue review <video>` | A review page for the approver: the video, the script, words to listen for |
| `oncue doctor [--json]` | Check the toolchain and the voice setup, with a fix for each problem |
| `oncue narrate <video>` | Record and lock the narration |
| `oncue build <video>` | Locked narration to props (no voice calls) |
| `oncue render <video>` | Build, then render the MP4, poster, and QA contact sheet |
| `oncue check [video] [--media] [--release]` | Metadata, narration locks, captions, and the redaction scan |
| `oncue compare <video> <approved.mp4>` | Compare a new render with an approved one: audio and frames |
| `oncue capture cli \| page \| pages \| serve` | Record real terminal sessions and page captures |
| `oncue registry [--check \| --accept <id>]` | Write the public registry, or accept a render as a new version |
| `oncue deploy` / `oncue status` | Upload accepted media to the media store, and report what's live |

`<video>` is a folder under `projects/` or a video id. `--all` works wherever a video is accepted.
`list`, `check`, `status`, `next`, and `doctor` take `--json` for agents and scripts.

## Configuration

`oncue.config.ts` holds everything specific to your videos: brand, colors, fonts, the words to
caption as written (`docs dot example dot com` becomes `docs.example.com`), the sign-offs a video
needs before it's hosted, redaction rules, and where accepted media is stored. See
[docs/config.md](docs/config.md).

```ts
import { defineConfig } from "oncue";

export default defineConfig({
  brandLabel: "Acme Developers",
  theme: { colors: { accent: "#0F62FE", highlight: "#A6F4C5" }, logo: { src: "brand/acme.svg" } },
  captions: { spoken: ["docs dot acme dot dev"] },
});
```

## Releasing

A render isn't published until someone accepts it. `oncue registry --accept <id>` records the render
as a new version in `versions.json` and updates `registry.json`. Media files are content-addressed and
append-only, so an older version stays available for comparison and rollback. `oncue deploy` uploads
accepted files to the media store (Vercel Blob by default). See [docs/releasing.md](docs/releasing.md).

## Docs

- [Builder API](docs/api.md): `defineVideo`, scenes, terminal steps, and browser-capture scenes
- [Configuration](docs/config.md): every `oncue.config.ts` option
- [Captures](docs/capture.md): terminal sessions, page captures, and the replay server
- [Releasing](docs/releasing.md): versions, the registry, sign-offs, and deploys
- [Example repo](examples/acme): two fictional videos, rendered with the placeholder voice

## Using oncue as a library

`oncue` exports the builder (`defineVideo`, `defineConfig`, and helpers). `oncue/engine` exports the
pipeline (workspace, build, render, checks, registry), so scripts and tests can call each step.
`oncue/capture` exports the capture tools and the Playwright build oncue renders with.

## License

MIT

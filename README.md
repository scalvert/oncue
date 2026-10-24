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
| `oncue doctor` | Check the toolchain and the voice setup |
| `oncue narrate <video>` | Record and lock the narration |
| `oncue build <video>` | Locked narration to props (no voice calls) |
| `oncue render <video>` | Build, then render the MP4, poster, and QA contact sheet |
| `oncue check [video] [--media] [--release]` | Metadata, narration locks, captions, and the redaction scan |
| `oncue compare <video> <approved.mp4>` | Compare a new render with an approved one: audio and frames |
| `oncue capture cli \| page \| pages \| serve` | Record real terminal sessions and page captures |
| `oncue registry [--check \| --accept <id>]` | Write the public registry, or accept a render as a new version |
| `oncue deploy` / `oncue status` | Upload accepted media to the media store, and report what's live |

`<video>` is a folder under `projects/` or a video id. `--all` works wherever a video is accepted.

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

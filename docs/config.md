# Configuration

oncue reads `oncue.config.ts` (or `.mts`, `.js`, `.mjs`) from the repo root. Every field is
optional. The defaults suit a small open-source project: oncue's own theme, no sign-offs, and no
redaction rules. Wrap the object in `defineConfig` to get type checking.

```ts
import { defineConfig } from "oncue";

export default defineConfig({
  cli: { name: "./vid" },
  brandLabel: "Acme Developers",
  theme: {
    colors: { accent: "#0F62FE", highlight: "#A6F4C5" },
    backdrop: { glows: [[166, 244, 197], [190, 210, 255], [255, 220, 180]] },
    logo: { src: "brand/acme-wordmark.svg", height: 36 },
  },
  captions: { spoken: ["docs dot acme dot dev", ["slash v one slash search", "/v1/search"]] },
  narration: { envPrefix: "ACME_VIDEO" },
  metadata: {
    approvals: {
      product: { who: "the product owner", required: true, blocksHosting: false },
      legal: { who: "Legal" },
    },
  },
  checks: {
    redact: [
      {
        pattern: /[a-z0-9-]+\.internal\.acme\.dev/g,
        allow: ["demo.internal.acme.dev"],
        message: (found) => `internal host(s) ${found.join(", ")}. Use demo.internal.acme.dev.`,
      },
    ],
  },
  site: { repo: "acme/developer-site", snapshot: "data/videos.json" },
});
```

## Fields

| Field | Default | What it sets |
|---|---|---|
| `cli.name` | `"oncue"` | The command shown in messages, such as `Run ./vid narrate hello`. Use it when a wrapper script runs oncue |
| `cli.description` | | The `--help` description |
| `paths.projects` | `"projects"` | One folder per video |
| `paths.catalog` | `"catalog"` | `catalog.json` (series and order), `voice.json`, and an optional `spoken.json` |
| `paths.public` | `"public"` | The renderer's web root: brand assets, local fonts, and each video's built props |
| `paths.media` | `"dist/media"` | Accepted MP4s and posters, content-addressed and append-only |
| `paths.registry` | `"registry.json"` | The public registry the site reads |
| `paths.ledger` | `"versions.json"` | Every accepted render of every video |
| `paths.env` | `".env"` | The git-ignored file with API keys. oncue loads it at startup |
| `paths.videoTemplate` | oncue's template | The folder `oncue new` copies |
| `brandLabel` | `""` | The small label on hero, statement, and end scenes when a video doesn't set one |
| `theme` | oncue's slate theme | Colors, the `v2` backdrop, and the wordmark. Partial values merge over the default |
| `localSans` | none | Licensed font files to prefer over DM Sans when they're present (below) |
| `composition` | the built-in one | A `.tsx` module whose default export renders the video's props |
| `captions.spoken` | `[]` | Spoken forms that every video's captions show as written |
| `narration.envPrefix` | `"ONCUE"` | Prefix for experiment-only voice overrides: `<PREFIX>_VOICE_ID`, `_MODEL_ID`, `_VOICE_SETTINGS` |
| `metadata.visibilities` | `preview`, `public` | Allowed `video.json` `visibility` values |
| `metadata.types` | `explainer`, `walkthrough` | Allowed `video.json` `type` values |
| `metadata.approvals` | none | The sign-offs a video can need (below) |
| `metadata.summaryMax` | `160` | The longest summary the site's cards show |
| `metadata.unnumberedSeriesTags` | `false` | Fail a build whose `seriesTag` has a number; the order lives in `series.position` |
| `checks.redact` | none | Text that must never be committed (below) |
| `checks.scan` | `["catalog"]` | Folders, besides each project, that the redaction scan reads |
| `registry.comment` | | The registry's `$comment` |
| `ledger.comment` | | `versions.json`'s `$comment`, for a new ledger |
| `site` | none | The site repo and the path of its registry copy, for `oncue status --site` |
| `mediaStore` | Vercel Blob | Where `oncue deploy` uploads media (below) |

## Theme colors

`accent` (the brand color: highlights, arrows, the cursor), `highlight` (the marker behind a
statement's second line, success states), `paper`, `text`, `white`, `muted`, `ink` and `inkBar`
(terminal background and title bar), `termText`, `termDim`, `info`, `warn`, and `danger` (HTTP
method chips and error states).

## Local fonts

Some brand fonts are licensed and can't be committed. `localSans` uses them when their files are
in `<public>/<dir>/`, and falls back to DM Sans otherwise:

```ts
localSans: {
  family: "PolySans",
  dir: "fonts/polysans",
  weights: [["neutral", ["400"]], ["median", ["500", "600", "700"]]],
  exclude: ["italic", "mono"],
  boldFallback: "800",
},
```

Each `weights` entry maps a file-name keyword to CSS weights. A machine without the files renders
with DM Sans, so a font change shows up in a render comparison. Use one machine, or the Docker
image, for release renders.

## Sign-offs

`metadata.approvals` names the sign-offs a video can need. Each `video.json` lists the ones that
apply to it in `approvals`, with `null` until someone gives it. `required: true` makes a sign-off
apply to every public video. A sign-off holds hosting until it's recorded, unless it sets
`blocksHosting: false`. Use that for a sign-off that only gates making the video public.

## Redaction

Each `checks.redact` rule is a regex, an allow list, and a message. `oncue check` scans each
project's committed data files (captured output, JSON, transcripts) and the `checks.scan` folders.
Set `dataFilesOnly: false` to also scan code and Markdown. Use `normalize` to decode text first,
such as `%2F` in URL-encoded redirect URIs.

## Media stores

The default store is the Vercel Blob store that `BLOB_READ_WRITE_TOKEN` points at. To upload
somewhere else, pass an object with `name`, an optional `missing()` that says why it can't upload
yet, and `put(file, pathname, contentType)`. `put` must never overwrite an existing path.

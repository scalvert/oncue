# Releasing

```
change ──► oncue check, oncue registry --check, render what changed, review the MP4 and QA sheet
   │
approve ──► oncue registry --accept <id> --note "why"   (a new version, pinned by SHA-256)
   │
deploy ──► oncue deploy                                  (upload to the media store, verify)
   │
   └──► your site reads registry.json
```

`oncue status` shows, per video, the current version and whether it needs a re-render, an accept,
or a deploy. `oncue status --site` also shows which version the site has, when `site` is set in
the config.

## Review

Watch every render. Someone has to listen to it: a person catches the mispronounced product name
that no check will. Read `renders/qa/sheet.png` and single frames at transitions and the end card.

If a render replaces an approved one, compare them first:

```bash
oncue compare <video> path/to/approved.mp4 --frames /tmp/cmp-<video>
```

The audio should be identical unless the narration changed on purpose. Look at every frame pair it
lists, and explain each difference in the change's description.

## Accepting a render

`registry.json` lists each accepted video with its metadata, media URLs, and hashes. Metadata
follows `video.json`. Media, transcript, and duration change only when you accept:

```bash
oncue registry                         # refresh metadata; lists renders that differ ("pending")
oncue registry --accept search-api --note "New response shape"
oncue deploy
git add registry.json versions.json && git commit
```

Each accept that changes the files adds a version (v1, v2, ...) to `versions.json`, with its date,
hashes, note, and a fingerprint of the inputs it was rendered from. `oncue status` compares those
fingerprints with the current sources. A changed script, take, capture, or theme shows as
"re-render" on the videos it affects.

Accepting a render that's identical to an accepted version adds no version. It records that the
version was reproduced (`reproducedBy`), which is how you show a toolkit change didn't move it.

Accepted files go to `dist/media/<id>.<sha10>.mp4` and `.webp`. That folder is append-only, so
every approved render stays available for comparison and rollback. A new video isn't listed in the
registry until its first accept.

## Sign-offs and visibility

The config's `metadata.approvals` names the sign-offs; each `video.json` lists the ones that apply.
Record each one as `{"by": "Name", "date": "YYYY-MM-DD", "note": "..."}`. `oncue check --release`
fails while a public video has an open sign-off, lists one the config doesn't know, or uses the
placeholder voice.

A video is hosted (`hosted: true` in the registry) once every sign-off that holds hosting is
recorded. Only hosted videos are uploaded.

## Media hosting

```bash
# .env (git-ignored): BLOB_READ_WRITE_TOKEN=...
oncue deploy --dry-run   # what would go up; needs no token
oncue deploy             # upload, then fetch each file back and check its hash
```

File names are content hashes, so uploads never overwrite and files can be cached for a long time.
Rolling back means accepting the earlier render again; its file is still in the store. The first
upload sets `mediaBaseUrl` in `catalog/catalog.json` and refreshes the registry. Commit both.

Treat anything on a public store as published, previews included.

## In CI

These need no secrets: `oncue check`, `oncue registry --check` (the committed registry is current),
and `oncue status --check` (every hosted version is in the store; it only reads public URLs).

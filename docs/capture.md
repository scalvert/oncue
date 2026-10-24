# Captures

The rule: what's on screen happened. Run the real CLI or open the real page, and record what it
did. When a CLI needs a live service, serve it the service's real response shapes, filled with
fictional data, from a local replay server. Then record its real output in a real TTY.

## CLI output

1. **Write a scenario.** Take the response shapes from the service's docs, tests, or fixtures:

   ```json
   {"routes": [{"method": "POST", "path": "^/v1/search$", "responses": [{"results": []}]},
               {"method": "POST", "path": "^/v1/chat$", "sse": [{"delta": "Hi"}], "sseDelayMs": 40}]}
   ```

   `responses` are served in order, and the last one repeats. `sse` streams `text/event-stream`.
   `queryHas` and `queryLacks` match on query parameters.

2. **Capture the CLI in a TTY.** `oncue capture cli` starts the replay server on `--port` (default
   8787) and logs every request to `<out>.requests.log`. Keep the log as evidence of which calls
   the CLI made.

   ```bash
   oncue capture cli --cwd path/to/cli --scenario capture/scenario.json --out capture/run.txt \
     --cmd "npm start --silent -- --server-url http://127.0.0.1:8787" --answer "Choose a field [1]: =1"
   ```

   `--answer PROMPT=REPLY` types the reply only after the prompt appears. `--env KEY=VALUE` sets
   environment variables, and `--timeout` (default 60 s) bounds the run. The output has ANSI and
   carriage-return sequences stripped. The CLI's exit code is recorded, not raised, so a capture of
   an error is still a capture. Interactive capture needs the optional `node-pty` dependency.

3. **CLIs that require an HTTPS origin** reject `http://` server URLs. Preload the fetch redirect:

   ```bash
   NODE_OPTIONS="--import $(oncue capture fetch-preload)" \
     REPLAY_FROM=https://api.example.com REPLAY_TO=http://127.0.0.1:8787 npm start
   ```

4. **Show it** with `t.feed(v.readText("capture/run.txt"), { anchors, answers })` or `t.lines(...)`.
   If the command on screen differs from the one you ran, say so in STORYBOARD.md.

To serve a scenario by hand, for a browser or a webhook receiver, run
`oncue capture serve scenario.json 8787`. It logs requests to stderr.

`examples/acme/projects/search-api` shows the whole loop with curl.

## Web pages

```bash
oncue capture page https://docs.example.com/search capture/page.png \
  --top-text "Heading" --bottom-text "Next heading" --target "query" --target "Send"
```

- The output is a 2x PNG plus `page.targets.json`: target boxes in image pixels, for `hl()` and
  `click()`.
- `oncue capture pages spec.json` takes several viewport shots with heading and item boxes, and can
  download a page's published images as they are:

  ```json
  {"out_dir": "capture", "shots": [
     {"name": "why", "url": "https://docs.example.com/gateway", "heading": "Why a gateway",
      "items": {"risk1": "Unvetted sources"}, "offset": 140}
   ], "images": [{"name": "arch", "url": "https://docs.example.com/img/diagram.png"}]}
  ```

  Each shot scrolls the heading to `offset` pixels from the top and screenshots the viewport. It
  records boxes for the heading and for each item: the first `li`, `p`, `td`, `tr`, or `h3` that
  contains the text. It writes `<out_dir>/<name>.png` and merges the boxes into
  `<out_dir>/targets.json`.
- `oncue capture browser-shot <log> <out.png>` decodes a screenshot saved as JSON with a base64 PNG,
  as browser-automation tools write them.
- Hide floating overlays (cookie banners, chat bubbles) before the screenshot. Never change content.
- For multi-step UIs, capture each state at the same clip, so every image in a scene is the same
  size.

`oncue/capture` exports `chromium` from the Playwright build oncue renders with, plus `boxOf` and
`here`, for custom capture scripts.

## Agent sessions and raw material

Keep raw material, such as full agent transcripts or unredacted logs, in `capture/raw/` and
git-ignore it. Commit a minimized, redacted copy with only the fields the build reads. Add
`checks.redact` rules for anything that must never be committed, so `oncue check` catches it.

## Never

- Invent terminal output, API responses the service wouldn't produce, or UI states.
- Commit tokens, secrets, real emails, raw sessions, or internal host names.
- Present a third party's pages publicly without their OK.

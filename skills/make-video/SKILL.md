---
name: make-video
description: Make, update, re-render, or release a narrated explainer video with oncue, with real captures, a locked narration take, and burned-in captions. Use for "make a video", "explainer video", "demo video for <project>", "update the video", "re-render", "what does the video need", and turning a library, CLI, API, or feature into a short video. Works with people who don't use a terminal.
---

# Make a narrated video with oncue

The request names a topic (a library, a CLI, an API, a feature) or a video to update. If it doesn't,
ask what the video covers and who watches it.

Work in a repo that has `oncue.config.ts`. If there isn't one, ask where the videos should live, then
run `npx oncue init` there. Read the repo's `AGENTS.md` first: its rules override this skill.

## Start every session with `next`

```bash
npx oncue next --json            # every video: its stage and the next steps
npx oncue next <video> --json    # one video
```

Each step says who does it: `agent` (you, with the exact command) or `person`. A step with
`"ask": true` needs the person's OK first. Do the agent steps, ask for the person steps, then run
`next` again. Never skip a stage. `npx oncue list --json` lists the videos: updating one beats adding
a near-duplicate.

If a command fails because the machine isn't set up, run `npx oncue doctor --json` and work through
each `fix`. Ask before you install software.

## The loop

1. **Research.** Read the project's README, docs, and changelog, and run it. Note a source for every
   claim you'll make (a docs page, a file and line, a command's output). Check its status: if
   it's experimental or beta, the video says so.
2. **Scaffold.** `npx oncue new <folder> --id <id> --title "..." --track <track>`, or copy the closest
   existing video.
3. **Capture.** Real material only, into `projects/<video>/capture/` (see Captures below).
4. **Script.** Write `narration.tsv` (see Writing the script). Read it back to the person, scene by
   scene, and get their OK before recording with a real voice.
5. **Narrate.** `npx oncue narrate <video>`. With the placeholder voice this is free and offline;
   with a real voice it costs money, so ask first. You can't hear the result: ask the person to
   listen, especially to names, acronyms, and URLs.
6. **Build.** Put visuals on spoken words in `build.ts`: `v.cue("s2", "the response")` is the moment
   the narrator says those words. Check the timeline `npx oncue build <video>` prints.
7. **Render and QA.** `npx oncue render <video>`, then look at `renders/qa/sheet.png` and at single
   frames at each transition, highlight, and the end card (see QA below).
8. **Check.** `npx oncue check <video> --media` must pass.
9. **Storyboard.** Fill in `STORYBOARD.md`: each scene, what's real and what's illustrative, the
   source of each claim, captures and redactions, and what still blocks release.
10. **Review.** `npx oncue review <video>` opens a page with the video, the timestamped script, the
    words to listen for, and a feedback box per scene. The person pastes their feedback back to you.
    Repeat from the step the feedback touches.
11. **Release, only when the person says so.** `npx oncue registry --accept <id> --note "<their
    reason>"` records a new version. `npx oncue deploy` uploads it. Both are `ask` steps.

## Writing the script

- **45 to 90 seconds**, about 170 to 190 words a minute. One row per scene: `sN<TAB>text`. Five to
  ten scenes.
- **Write for the ear.** Short sentences, one idea each, contractions. Spell out what a voice
  would misread: "docs dot example dot com", "M C P", "J S O N" (or "jason", if that's how the
  project says it). Add the written forms to `captions.spoken` in the config so captions show them as
  written.
- **Lead with the viewer's problem**, then what the project is, in one sentence. A good shape for
  developer tools: the problem, what it is, setup (the real install or config), it working (real
  output), the one thing that makes it different, and where to start (the end card URL).
- **Introduce before you use.** If a step needs something you set up (a config file, a demo site, a
  server), say what it is by name first. Don't put raw IDs or tokens on screen as labels.
- **Don't sell table stakes.** Pagination, JSON, and "it's open source" aren't features unless the
  video is about them.
- **No numbers on screen** for series order. A video gets watched on its own.
- **Cue phrases are exact words** from the script. When you edit a line, keep its cue phrases or
  update the build to match.

## Captures

- **Terminal output** comes from running the real command:
  `npx oncue capture cli --cwd <dir> --cmd "<command>" --out projects/<video>/capture/run.txt` records
  it in a real TTY. For a service you can't run, replay its response shapes with fictional data
  (`--scenario`, see `capture.md`).
- **Screens** come from real pages: `npx oncue capture page <url>` writes a 2x screenshot and the
  boxes of the elements you'll highlight.
- **Agent sessions** (a chat client calling a tool) are real sessions you ran. Keep raw transcripts
  and unredacted logs in `capture/raw/`, which isn't committed. Commit only the minimized, redacted
  files the build reads.
- **No fake product UI.** Use diagrams (`flow`), concept cards (`card`), and real captures. Anything
  illustrative says so in its own label ("example", "diagram").

## QA

After every render, look, don't assume:

- `renders/qa/sheet.png`: every scene is legible, nothing overflows or overlaps, highlights sit on
  what they point at.
- Single frames at each scene change, each click and highlight, and the end card. Extract one with
  `ffmpeg -ss <seconds> -i <mp4> -frames:v 1 /tmp/frame.png`.
- Captions match the words and show URLs and names as written.
- `npx oncue check <video> --media` reports loudness and stray audio between segments. "AT RISK"
  means a person listens to that spot.

When a render replaces one that was accepted, compare them:
`npx oncue compare <video> <accepted.mp4 or URL> --frames /tmp/cmp-<video>`. Look at every side by
side it lists and say what each difference is.

## Talking with the person

Use plain words: "the script", "the voice recording", "the video", "sign-off". Don't say props, lock,
take, fingerprint, or registry unless they do. Show them what you changed after each round.

## Never

- Record with a real voice, accept, deploy, commit, push, open a pull request, or message anyone
  without the person's OK.
- Handle secrets. The person puts API keys in `.env` themselves. Never ask them to paste a key into
  the chat, and never print `.env`.
- Claim the narration sounds right. You can't hear it.
- Overwrite or delete accepted media, or replace an accepted render without the comparison.
- Commit anything from `capture/raw/`.

## Reference

These ship with oncue, in `node_modules/oncue/docs/`:

| Read | For |
| --- | --- |
| `api.md` | `defineVideo`, the scenes, terminal steps, browser-capture scenes |
| `capture.md` | Recording terminal sessions and pages, the replay server |
| `config.md` | Every `oncue.config.ts` option: brand, captions, sign-offs, redaction |
| `releasing.md` | Versions, the registry, sign-offs, deploys |

## Report back

The render and QA sheet paths, what's real and what's illustrative, what the person needs to listen
to or look at, the comparison if you replaced a render, and what still blocks release.

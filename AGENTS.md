# Working in the oncue repo

This repo is the toolkit. Videos live in other repos that depend on it.

## If someone wants to make a video

Don't make it here. Make a new repo for their videos and follow the `AGENTS.md` it gets:

```bash
mkdir my-videos && cd my-videos && npm init -y
npm install --save-dev github:scalvert/oncue
npx oncue init "Their brand"
npx oncue next
```

To try oncue without a new repo, `examples/acme` is a complete one: `cd examples/acme`, then run
`node --conditions=oncue-source ../../src/cli/main.ts next`.

## If you're changing oncue

- `npm run typecheck` and `npm test` must pass. CI also renders the example on Linux.
- Keep it generic. Brands, sign-off kinds, redaction rules, and hosting belong in a repo's
  `oncue.config.ts`, never in `src/`.
- A change to the composition, the renderer, or the builder can change every video's pixels. Say
  so in the PR, and check the examples with `oncue compare` against renders from before the change.
- Commands do their work in `src/` modules that take a `Workspace`; `src/cli/main.ts` only parses
  arguments and prints. Anything a person reads also comes as `--json` for agents.
- `templates/repo/AGENTS.md` is what every new video repo's agent reads. Keep it in plain words:
  the person using it may not be technical.

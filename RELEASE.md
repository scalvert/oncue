# Releasing oncue

Releases use [release-it](https://github.com/release-it/release-it/) and
[lerna-changelog](https://github.com/lerna/lerna-changelog/). This is about publishing the oncue
package to npm. For releasing videos, see [docs/releasing.md](docs/releasing.md).

## Before a release

Check that every pull request merged since the last release has a changelog label and a title that
makes sense to someone using oncue. The changelog is built from them, and pull requests without a
label are left out.

- `breaking`: a change that can break a video repo, such as a renamed command, a changed config
  field, or a builder API change.
- `enhancement`: a new feature.
- `bug`: a fix for something in an earlier release.
- `documentation`: docs only.
- `internal`: a change worth a line in the changelog that isn't one of the above.

A change to the composition, the renderer, or the builder can change the pixels of every video in
every repo that upgrades. Say so in the pull request's title or description, so it reaches the
changelog.

## Release

Releases run in the Release workflow (`.github/workflows/release.yml`). It publishes to npm with
[trusted publishing](https://docs.npmjs.com/trusted-publishers), so it needs no npm token and no
one-time password.

1. Check the labels and titles (above).
2. Do a dry run, and read the changelog in the run's log:

   ```sh
   gh workflow run release.yml -R scalvert/oncue -f increment=minor -f dry_run=true
   ```

3. Release:

   ```sh
   gh workflow run release.yml -R scalvert/oncue -f increment=minor
   ```

4. Check the result: the run succeeded (`gh run watch`), `npm view oncue version` shows the new
   version, and the GitHub release exists.

The workflow runs `npx release-it <increment> --ci`. That bumps the version and publishes to npm
(`prepublishOnly` builds, type-checks, and tests first). Then it commits `Release <version>`, tags
`v<version>`, pushes both to `main`, creates the GitHub release, and comments on the pull requests
it includes.

While oncue is below 1.0, use `minor` for a release with a breaking change and `patch` for the rest.

A pull request that changes `release.yml` or `.release-it.js` gets a dry run.

## One-time setup

npm can add a trusted publisher only to a package that exists, so the first release runs from a
laptop:

1. On an up-to-date `main`, sign in to npm as the package's owner: `npm login`.
2. Release `0.1.0`. In fish:

   ```sh
   env GITHUB_AUTH=(gh auth token) npx release-it minor
   ```

   It opens the changelog in `$EDITOR` before it commits, and npm asks for your one-time password
   when it publishes.

3. On npmjs.com, in the package's Settings, add a GitHub Actions trusted publisher: owner
   `scalvert`, repository `oncue`, workflow `release.yml`, environment `npm`.
4. Set publishing access to "Require two-factor authentication and disallow tokens". Trusted
   publishing still works with that setting.
5. In the GitHub repository's settings, add an environment named `npm` that deploys only from
   `main`.

Every later release uses the workflow.

## If a release fails after publishing

release-it publishes to npm before it commits and tags. If a later step fails, npm has the new
version and GitHub doesn't. Don't rerun the workflow: it would try to publish the same version
again, and npm versions can't be republished. Finish the GitHub side from an up-to-date checkout of
`main` instead. In fish, where `CI=true` turns off the changelog editor and the npm checks:

```sh
env CI=true GITHUB_AUTH=(gh auth token) npx release-it <version> --no-npm.publish
```

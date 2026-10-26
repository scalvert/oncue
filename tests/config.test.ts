/** Config: defaults, the theme, and what the builder puts in every video's props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTheme, resolveTheme, rgba } from "../composition/src/theme.ts";
import { resolveConfig } from "../src/config/load.ts";
import { buildProject } from "../src/pipeline/build.ts";
import { exampleConfig, sandbox } from "./helpers.ts";

test("an empty config is a working default", () => {
  const c = resolveConfig();
  assert.equal(c.cli.name, "npx oncue");
  assert.equal(c.paths.public, "public");
  assert.deepEqual(c.theme, defaultTheme);
  assert.deepEqual(c.metadata.approvals, {});
  assert.deepEqual(c.checks.redact, []);
  assert.equal(c.narration.envPrefix, "ONCUE");
  assert.match(c.registry.comment, /oncue registry --accept/);
});

test("a renamed CLI shows up in generated comments", () => {
  assert.match(resolveConfig({ cli: { name: "acme-video" } }).registry.comment, /acme-video registry/);
});

test("theme colors merge over the defaults", () => {
  const t = resolveTheme({ colors: { accent: "#0F766E" } });
  assert.equal(t.colors.accent, "#0F766E");
  assert.equal(t.colors.highlight, defaultTheme.colors.highlight);
  assert.deepEqual(t.backdrop, defaultTheme.backdrop);
});

test("rgba matches the hand-written tints", () => {
  assert.equal(rgba("#343CED", 0.14), "rgba(52,60,237,0.14)");
  assert.equal(rgba("#F6F3EB", 0.55), "rgba(246,243,235,0.55)");
});

test("every video's props carry the repo's theme and label", async () => {
  const { ws } = sandbox();
  const props = await buildProject(ws, ws.projects()[0]!, { log: () => {} });
  assert.equal(props.brandLabel, exampleConfig.brandLabel);
  assert.deepEqual(props.theme, exampleConfig.theme);
  assert.equal(props.sans, undefined);
});

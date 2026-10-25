/** A new user's first run: init, new, narrate (placeholder), build, check. No keys, no network. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { check } from "../src/checks/checks.ts";
import { buildProject, narrate } from "../src/pipeline/build.ts";
import { bundle } from "../src/render/page.ts";
import { initRepo, newVideo } from "../src/workspace/scaffold.ts";
import { Workspace } from "../src/workspace/workspace.ts";
import { tempDir } from "./helpers.ts";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A fresh repo that has oncue installed (a symlink to this checkout). */
function freshRepo(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(pkg, join(dir, "node_modules", "oncue"), "dir");
  return dir;
}

test("init writes a starter repo and never overwrites", () => {
  const dir = freshRepo();
  const wrote = initRepo(dir, "Acme");
  for (const f of ["oncue.config.ts", "catalog/catalog.json", "catalog/voice.json", ".gitignore", ".env.example", "package.json", "AGENTS.md", "CLAUDE.md"]) assert.ok(wrote.includes(f), f);
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).type, "module");
  assert.match(readFileSync(join(dir, "oncue.config.ts"), "utf8"), /brandLabel: "Acme"/);
  writeFileSync(join(dir, "oncue.config.ts"), "// mine\nexport default {};\n");
  assert.ok(!initRepo(dir).includes("oncue.config.ts"));
  assert.equal(readFileSync(join(dir, "oncue.config.ts"), "utf8"), "// mine\nexport default {};\n");
});

test("init makes an npm-init package.json an ES module, but leaves a CommonJS project alone", () => {
  const fresh = freshRepo();
  writeFileSync(join(fresh, "package.json"), JSON.stringify({ name: "vids", version: "1.0.0", devDependencies: { oncue: "x" } }));
  assert.ok(initRepo(fresh).includes("package.json"));
  const meta = JSON.parse(readFileSync(join(fresh, "package.json"), "utf8"));
  assert.equal(meta.type, "module");
  assert.deepEqual(meta.devDependencies, { oncue: "x" });

  const cjs = freshRepo();
  writeFileSync(join(cjs, "package.json"), JSON.stringify({ name: "app" }));
  writeFileSync(join(cjs, "server.js"), "module.exports = {};\n");
  assert.ok(!initRepo(cjs).includes("package.json"));
  assert.equal(JSON.parse(readFileSync(join(cjs, "package.json"), "utf8")).type, undefined);
});

test("a new repo narrates, builds, and checks without an API key", async () => {
  const dir = freshRepo();
  initRepo(dir, "Acme");
  const ws = await Workspace.load(dir);
  newVideo(ws, { folder: "hello", id: "hello", title: "Hello", track: "getting-started" });
  const p = ws.resolve(["hello"])[0]!;
  const lock = await narrate(ws, p, { mode: "update", log: () => {} });
  assert.equal(lock.voice.voice_id, "oncue-placeholder");
  const props = await buildProject(ws, p, { log: () => {} });
  assert.equal(props.scenes.length, 3);
  assert.equal(props.brandLabel, "Acme");
  assert.ok(existsSync(p.propsPath));
  const r = check(ws, ws.projects());
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /placeholder narration/.test(w)));
  const release = check(ws, ws.projects(), { release: true });
  assert.ok(release.errors.some((e) => /placeholder narration can't be released/.test(e)));
});

test("a repo's own composition replaces the Explainer", async () => {
  const dir = tempDir();
  const comp = join(dir, "Custom.tsx");
  writeFileSync(
    comp,
    'import React from "react";\nimport { useCurrentFrame } from "oncue/composition/runtime/index.tsx";\n' +
      "export default function Custom() { const f = useCurrentFrame(); return <div>custom-composition-marker {f}</div>; }\n",
  );
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(pkg, join(dir, "node_modules", "oncue"), "dir");
  await bundle(dir, comp);
  const js = readFileSync(join(dir, "_render", "bundle.js"), "utf8");
  assert.match(js, /custom-composition-marker/);
  assert.doesNotMatch(js, /permissions/, "the Explainer isn't bundled");
});

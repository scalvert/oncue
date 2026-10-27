/** The agent skills oncue ships: init installs them, `oncue skills` refreshes them, doctor flags drift. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { doctor } from "../src/workspace/doctor.ts";
import { initRepo } from "../src/workspace/scaffold.ts";
import { installSkills, SKILLS_DIR, skillNames, skillStates } from "../src/workspace/skills.ts";
import { tempDir } from "./helpers.ts";

const skill = (dir: string) => join(dir, SKILLS_DIR, "make-video", "SKILL.md");

test("oncue ships a make-video skill with a name that matches its folder", () => {
  assert.ok(skillNames().includes("make-video"));
  const text = readFileSync(join(import.meta.dirname, "..", "skills", "make-video", "SKILL.md"), "utf8");
  assert.match(text, /^---\nname: make-video\ndescription: .+\n---\n/);
});

test("init installs the skills, and a second init leaves a local edit alone", () => {
  const dir = tempDir();
  assert.ok(initRepo(dir, "Acme").includes(join(SKILLS_DIR, "make-video", "SKILL.md")));
  assert.deepEqual(skillStates(dir), [{ name: "make-video", state: "current" }]);
  writeFileSync(skill(dir), "mine\n");
  initRepo(dir, "Acme");
  assert.equal(readFileSync(skill(dir), "utf8"), "mine\n");
});

test("skillStates reports stale and missing copies; installSkills fixes both and keeps extra files", () => {
  const dir = tempDir();
  installSkills(dir);
  writeFileSync(skill(dir), "an older version\n");
  writeFileSync(join(dir, SKILLS_DIR, "make-video", "NOTES.md"), "ours\n");
  assert.equal(skillStates(dir)[0]!.state, "stale");
  installSkills(dir);
  assert.equal(skillStates(dir)[0]!.state, "current");
  assert.ok(existsSync(join(dir, SKILLS_DIR, "make-video", "NOTES.md")));
  rmSync(join(dir, SKILLS_DIR), { recursive: true });
  assert.equal(skillStates(dir)[0]!.state, "missing");
});

test("doctor reports a stale skill as optional, with the refresh command", async () => {
  const dir = tempDir();
  initRepo(dir, "Acme");
  writeFileSync(skill(dir), "an older version\n");
  const f = (await doctor(dir)).find((x) => x.what === "agent skill make-video")!;
  assert.deepEqual([f.ok, f.optional, f.fix], [false, true, "npx oncue skills"]);
});

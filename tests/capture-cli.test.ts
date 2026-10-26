/** `capture cli`: a real TTY run, with or without the replay server. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { captureCli, terminalText } from "../src/capture/cli.ts";
import { tempDir } from "./helpers.ts";

let pty = true;
try {
  createRequire(import.meta.url).resolve("node-pty");
} catch {
  pty = false;
}

test("terminalText keeps what a terminal shows: spinners and progress overwrite in place", () => {
  // npm's spinner: column 1, erase, a frame; then the result line.
  assert.equal(terminalText("\x1b[1G\x1b[0K\\\x1b[1G\x1b[0K|\x1b[1G\x1b[0K\r\nadded 1 package in 2s\r\n"), "\nadded 1 package in 2s\n");
  assert.equal(terminalText("downloading 10%\rdownloading 100%\n"), "downloading 100%\n");
  assert.equal(terminalText("abc\b\bXY\n"), "aXY\n");
  assert.equal(terminalText("\x1b[32m✓\x1b[39m ok \x1b]0;title\x07done"), "✓ ok done");
  assert.equal(terminalText("keep this\x1b[5G\x1b[0K"), "keep");
  assert.equal(terminalText("🚀 emoji survive"), "🚀 emoji survive");
});

test("a plain command needs no scenario: no server, no request log, control sequences stripped", { skip: !pty && "node-pty isn't installed" }, async () => {
  const dir = tempDir();
  const out = join(dir, "run.txt");
  // An OSC window title (npm sets one), a color, then the text.
  const r = await captureCli({ cwd: dir, out, cmd: String.raw`printf '\033]0;npm build\007\033[32mok\033[0m done\n'; exit 3` });
  assert.equal(r.text, "ok done\n");
  assert.equal(readFileSync(out, "utf8"), "ok done\n");
  assert.equal(r.exitCode, 3);
  assert.equal(r.log, null);
  assert.ok(!existsSync(join(dir, "run.requests.log")));
});

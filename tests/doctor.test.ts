/** `doctor`: what this machine is missing, and which gaps only some commands care about. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { doctor } from "../src/workspace/doctor.ts";
import { tempDir, writeFile } from "./helpers.ts";

test("a missing ElevenLabs key never fails doctor, even with a real voice: only narrate needs it", async () => {
  const dir = tempDir();
  writeFile(join(dir, "oncue.config.ts"), "export default {};\n");
  writeFile(join(dir, "catalog", "voice.json"), JSON.stringify({ voice_id: "a-real-voice", model_id: "eleven_v3" }));
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const key = (await doctor(dir)).find((f) => f.what === "ELEVENLABS_API_KEY")!;
    assert.equal(key.ok, false);
    assert.equal(key.optional, true);
    assert.match(key.detail, /needed to record narration/);
  } finally {
    if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
  }
});

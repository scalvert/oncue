/** Keys in .env can be 1Password references, read only when a command uses them. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { clearSecretCache, isSecretReference, opRead, secret } from "../src/core/secrets.ts";
import { tempDir } from "./helpers.ts";

const calls: { fn: string; options: Record<string, unknown> }[] = [];
vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: async (_pathname: string, options: Record<string, unknown>) => {
      calls.push({ fn: "head", options });
      throw new BlobNotFoundError("not found");
    },
    put: async (pathname: string, _body: unknown, options: Record<string, unknown>) => {
      calls.push({ fn: "put", options });
      return { url: `https://blob.example/${pathname}`, pathname };
    },
  };
});

afterEach(() => {
  clearSecretCache();
  calls.length = 0;
});

test("a plain value passes through, and an unset or empty one is undefined", () => {
  const env = { A: "sk_plain", EMPTY: "" };
  assert.equal(secret("A", env, () => assert.fail("read a plain value")), "sk_plain");
  assert.equal(secret("MISSING", env), undefined);
  assert.equal(secret("EMPTY", env), undefined);
  assert.equal(isSecretReference("op://Private/ElevenLabs/credential"), true);
  assert.equal(isSecretReference("sk_plain"), false);
});

test("a 1Password reference is read once, trimmed, and never written back to the environment", () => {
  const env = { ELEVENLABS_API_KEY: "op://Private/ElevenLabs/credential" };
  const reads: string[] = [];
  const read = (ref: string) => (reads.push(ref), "sk_resolved\n");
  assert.equal(secret("ELEVENLABS_API_KEY", env, read), "sk_resolved");
  assert.equal(secret("ELEVENLABS_API_KEY", env, read), "sk_resolved");
  assert.deepEqual(reads, ["op://Private/ElevenLabs/credential"]);
  assert.equal(env.ELEVENLABS_API_KEY, "op://Private/ElevenLabs/credential");
});

test("a failed read names the variable and the reference", () => {
  const env = { ELEVENLABS_API_KEY: "op://Private/ElevenLabs/credential" };
  assert.throws(
    () => secret("ELEVENLABS_API_KEY", env, () => { throw new Error("not signed in"); }),
    /ELEVENLABS_API_KEY is a 1Password reference \(op:\/\/Private\/ElevenLabs\/credential\), and reading it failed: not signed in/,
  );
  assert.throws(() => secret("ELEVENLABS_API_KEY", env, () => "  "), /resolved to an empty value/);
});

test("without the op CLI, the error says how to install it or use op run", () => {
  const path = process.env.PATH;
  process.env.PATH = tempDir();
  try {
    assert.throws(() => opRead("op://Private/ElevenLabs/credential"), /op\) isn't installed.*op run --env-file=\.env/);
  } finally {
    process.env.PATH = path;
  }
});

test("op's own error comes through, without its log prefix", () => {
  const bin = tempDir();
  writeFileSync(join(bin, "op"), '#!/bin/sh\necho "[ERROR] 2026/11/03 11:31:06 account is not signed in" >&2\nexit 1\n', { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = bin;
  try {
    assert.throws(() => opRead("op://Private/ElevenLabs/credential"), /^Error: account is not signed in\. Sign in to 1Password/);
  } finally {
    process.env.PATH = path;
  }
});

test("the Vercel Blob store passes the token itself, so the library never reads a raw reference", async () => {
  const { vercelBlob } = await import("../src/release/blob.ts");
  const file = join(tempDir(), "take.mp4");
  writeFileSync(file, "media");
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
  try {
    await vercelBlob.put(file, "videos/take.mp4", "video/mp4");
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
  assert.deepEqual(calls.map((c) => [c.fn, c.options.token]), [["head", "vercel_blob_rw_test"], ["put", "vercel_blob_rw_test"]]);
});

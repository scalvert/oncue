/** The redaction gate and the release rules. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRelease, Report, scanText } from "../src/checks/checks.ts";
import type { VideoMeta } from "../src/workspace/types.ts";
import { exampleConfig } from "./helpers.ts";

const rules = exampleConfig.checks.redact;
const scan = (rel: string, text: string) => {
  const r = new Report();
  scanText(rel, text, r, rules);
  return r.errors;
};

test("placeholders and the demo tenant pass", () => {
  assert.deepEqual(scan("capture/x.txt", "https://{tenant}.acme-cloud.dev/mcp and https://demo.acme-cloud.dev"), []);
  assert.deepEqual(scan("capture/x.txt", "redirect=https%3A%2F%2F{tenant}.acme-cloud.dev%2Fcb"), []);
});

test("a real tenant host fails in data, but not in provenance notes", () => {
  assert.equal(scan("capture/x.txt", "https://bigco.acme-cloud.dev/api").length, 1);
  assert.match(scan("capture/x.txt", "https://bigco.acme-cloud.dev/api")[0]!, /bigco\.acme-cloud\.dev/);
  assert.deepEqual(scan("build.ts", "// captured on bigco.acme-cloud.dev"), []);
});

test("a rule can cover notes too", () => {
  const r = new Report();
  scanText("build.ts", "ACME-1234", r, [{ pattern: /ACME-\d+/, dataFilesOnly: false, message: (f) => `ticket ${f.join(", ")}` }]);
  assert.deepEqual(r.errors, ["build.ts: ticket ACME-1234"]);
});

test("without rules, only secrets are checked", () => {
  const r = new Report();
  scanText("capture/x.txt", "https://bigco.acme-cloud.dev/api", r);
  assert.deepEqual(r.errors, []);
});

test("credentials fail everywhere, notes included", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  for (const text of [
    jwt,
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    '"access_token": "abcdefghijklmnop"',
    "-----BEGIN RSA PRIVATE KEY-----",
    "xi-api-key: abcdefghijklmnopqrstuvwxyz",
  ]) {
    assert.ok(scan("build.ts", text).length, text);
  }
});

test("raw agent sessions fail", () => {
  assert.ok(scan("capture/s.jsonl", '{"type":"system","subtype":"hook_started","session_id":"x"}').length);
});

test("a search cursor is not a JWT", () => {
  // Search cursors are base64 JSON ("eyJ...") without the three-part JWT shape.
  assert.deepEqual(scan("capture/s.jsonl", 'cursor="eyJSZXN1bHRTdGFydCI6NTAsIlJhbmRvbUNhY2hlS2V5IjoiMzc5"'), []);
});

test("the release gate needs every required and every listed sign-off", () => {
  const errors = (approvals: Record<string, unknown>) => {
    const r = new Report();
    checkRelease({ name: "x", meta: { visibility: "public", approvals } as unknown as VideoMeta }, exampleConfig.metadata.approvals, r);
    return r.errors.join(" ");
  };
  const ok = { by: "x", date: "2026-10-06" };
  assert.equal(errors({ product: ok }), "");
  assert.match(errors({}), /product/);
  assert.match(errors({ product: ok, legal: null }), /legal/);
  assert.match(errors({ product: ok, marketing: ok }), /unknown approvals/);
});

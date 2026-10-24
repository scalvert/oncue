/**
 * One search call: the request in a terminal, then the same exchange with the fields that matter
 * highlighted.
 *
 * capture/search.json is real output: curl against oncue's replay server serving
 * capture/scenario.json (fictional Acme data); capture/search.jq.txt is `jq .` of it.
 * capture/requests.log is the server's record of the call. See STORYBOARD.md.
 */
import { defineVideo, jsonLines, jsonView, pathSet } from "oncue";

const QUERY = { query: "refund policy" };

export default defineVideo((v) => {
  v.retime({ s1: 0.8, s2: 1.0, s3: 1.0 });
  const response = JSON.parse(v.readText("capture/search.json")) as unknown;

  v.hero("s1", ["One search call,", "start to finish."], [["POST /v1/search", "one search call"]]);

  const t = v.term("s2");
  t.cmd(`curl -s -X POST $ACME/v1/search -d '${JSON.stringify(QUERY)}' | jq .`, { at: v.cue("s2", "post a query") });
  t.lines(v.readText("capture/search.jq.txt"), { at: v.cue("s2", "the response") });
  v.terminal("s2", t, "THE REQUEST", "terminal");

  const view = jsonView(response, pathSet(["query"], ["results", 0, "title"], ["results", 0, "source"], ["results", 0, "score"], ["took_ms"]));
  v.exchange("s3", "THE RESPONSE", {
    request: { method: "POST", path: "/v1/search", lines: jsonLines(QUERY), at: v.cue("s3", "each result") },
    response: { status: "200 OK", lines: view.lines, at: v.cue("s3", "each result") + 0.3 },
    highlights: [
      { pane: "response", from: view.line("results", 0, "title"), to: view.line("results", 0, "score"), at: v.cue("s3", "a title") },
      { pane: "response", from: view.line("results", 0, "source"), to: view.line("results", 0, "source"), at: v.cue("s3", "cite its source"), note: "cite this" },
    ],
  });

  v.endCard("s4", "Read the full reference.", "docs.acme.dev");
  return v.props({ look: "v2", seriesTag: "Search API" });
});

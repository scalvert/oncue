/**
 * Acme in one minute: a title, one idea, and where to go next. The smallest useful video.
 */
import { defineVideo } from "oncue";

export default defineVideo((v) => {
  v.retime({ s1: 0.8, s2: 0.9 });
  v.hero("s1", ["One API for", "search and answers."], [["Search", "search"], ["Answers", "answers"]]);
  v.statement("s2", "Ask a question.", "Get ranked results.", "ranked results");
  v.endCard("s3", "Start with the quickstart.", "docs.acme.dev");
  return v.props({ look: "v2", seriesTag: "Getting started" });
});

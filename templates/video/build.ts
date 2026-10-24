/**
 * __TITLE__.
 *
 * Scene by scene: what's on screen and where it came from lives in STORYBOARD.md.
 * Run: oncue narrate __FOLDER__ (once per script change), then oncue render __FOLDER__.
 */
import { defineVideo } from "oncue";

export default defineVideo((v) => {
  v.retime({ s2: 0.9 });
  // v.cue("s2", "one idea") is the time that phrase is spoken: put visuals on cues.
  // Chips and items take [text, cue phrase]; the phrase must be in that scene's narration.
  v.hero("s1", ["__TITLE__"], [["In one minute", "one short sentence"]]);
  v.statement("s2", "One idea", "to remember.", "one idea");
  v.endCard("s3", "Start building.", "docs.example.com");

  return v.props();
});

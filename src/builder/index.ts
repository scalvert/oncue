/**
 * The authoring API for projects/<folder>/build.ts:
 *
 *   import { defineVideo } from "oncue";
 *
 *   export default defineVideo((v) => {
 *     v.retime({ s3: 1.8 });                      // widen the pause after s3
 *     v.hero("s1", ["Line one.", "Line two."]);   // scenes on narration cues: v.cue(seg, phrase)
 *     ...
 *     return v.props({ seriesTag: "..." });
 *   });
 *
 * `oncue build <folder>` runs it with the video's locked narration; docs/api.md has the full API.
 */
export { Capture, type CameraView, type CaptureOptions } from "./capture.ts";
export { captionWords, type SpokenForm } from "./captions.ts";
export { jsonView, pathSet, type JsonPath, type JsonView } from "./json-view.ts";
export { Term, type TermDefaults } from "./term.ts";
export { TAIL, Timeline } from "./timeline.ts";
export {
  defineVideo,
  Video,
  type BuildFn,
  type CuedText,
  type ExchangeHighlight,
  type ExchangeRequest,
  type ExchangeResponse,
  type PropsOptions,
  type VideoContext,
  type VideoDefaults,
  type VideoDefinition,
} from "./video.ts";
export { NARRATION_OFFSET } from "../audio/retime.ts";
import { dumps } from "../core/json.ts";
export { dumps };
export { fail } from "../core/errors.ts";
export type { CaptionWord, ExplainerProps, SansFont, Scene, TermStep, Tone } from "../../composition/src/props.ts";

/** A captured transcript's lines, without leading or trailing blank lines. */
export function lines(text: string): string[] {
  return text.replace(/^\n+|\n+$/g, "").split("\n");
}

/** A file's lines, split at any line break, with no empty last line for a trailing newline. */
export function splitLines(text: string): string[] {
  const out = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** A captured request body as the pane shows it: 2-space indented JSON, non-ASCII escaped. */
export function jsonLines(value: unknown): string[] {
  return dumps(value, { indent: 2 }).split("\n");
}

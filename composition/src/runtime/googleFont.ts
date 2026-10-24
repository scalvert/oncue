/**
 * Loads a bundled Google Font (OFL) from composer/public/fonts/google, holding the render until it's
 * ready. Bundled, not fetched at render time, so renders don't depend on the network.
 */
import { continueRender, delayRender, staticFile } from "./index";

// Google Fonts' "latin" subset.
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

export function googleFont(family: string, file: string) {
  return (style: string = "normal", options: { weights?: string[]; subsets?: string[] } = {}) => {
    const weights = options.weights ?? ["400"];
    const handle = delayRender(`Loading ${family}`);
    Promise.all(
      weights.map((weight) =>
        new FontFace(family, `url(${staticFile(file)}) format("woff2")`, {
          style,
          weight,
          unicodeRange: LATIN,
          display: "block",
        })
          .load()
          .then((face) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(face)),
      ),
    )
      .then(() => continueRender(handle))
      .catch((err) => {
        console.error(`${family} failed to load`, err);
        continueRender(handle);
      });
    return { fontFamily: `"${family}"` };
  };
}

# The render page

`src/render/` renders every video: Playwright opens `index.html` here in headless Chromium,
`entry.tsx` mounts the composition on its runtime (`../src/runtime/`), and each frame is set,
allowed to settle, and captured as a JPEG. ffmpeg encodes the frames (x264, CRF 18, full-range
yuvj420p, 90 kHz timescale) with the narration, then applies a two-pass loudness pass.

The composition is the built-in Explainer (`../src/Explainer.tsx`) unless the repo's config names
its own; `entry.tsx` imports it as `oncue:composition`, which the bundler resolves. The props
contract is `../src/props.ts`: the builder produces it, the composition consumes it, and both
type-check against it.

A frame is captured only when fonts are loaded, nothing holds `delayRender`, and every image on the
page is loaded and decoded. The same props always give a byte-identical MP4 on the same machine
image (`Dockerfile` pins one).

`src/runtime/` is a clean-room implementation of the dozen Remotion APIs the composition uses,
written from their documented behavior; Remotion is not a dependency. Three details keep frames
stable: `box-sizing: border-box` globally (`index.html`), a 90 kHz video timescale (millisecond
timescales make every third frame's timestamp drift), and `spring()` using the critically damped
curve at or above critical damping (`runtime.test.mjs` pins the values).

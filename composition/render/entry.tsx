/**
 * Page the frame renderer (src/render/) loads: mounts the composition and exposes
 *   window.oncue.init(propsUrl) -> video config
 *   window.oncue.frame(n)       -> resolves once frame n is laid out, fonts are loaded,
 *                                  every image is decoded, and nothing is holding the render
 *
 * "oncue:composition" is the built-in Explainer, or the repo's own composition (config
 * `composition`); the bundler resolves it.
 */
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";
import Composition from "oncue:composition";
import type { ExplainerProps } from "../src/props";
import { pendingRenders, RenderRoot, VideoConfig } from "../src/runtime";

const FPS = 30;
let root: Root | null = null;
let setFrame: (n: number) => void = () => {};

const App: React.FC<{ props: ExplainerProps; config: VideoConfig }> = ({ props, config }) => {
  const [frame, set] = React.useState(0);
  setFrame = set;
  return (
    <RenderRoot frame={frame} config={config}>
      <Composition {...props} />
    </RenderRoot>
  );
};

const settle = (img: HTMLImageElement) =>
  (img.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      })
  ).then(() => img.decode().catch(() => undefined));

async function ready(): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(images.map(settle));
    if (pendingRenders() === 0 && images.every((img) => img.complete)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  // Let the browser paint what React committed.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

declare global {
  interface Window {
    oncue: { init: (propsUrl: string) => Promise<VideoConfig>; frame: (n: number) => Promise<void> };
  }
}

window.oncue = {
  async init(propsUrl) {
    const props = (await (await fetch(propsUrl)).json()) as ExplainerProps & { durationSeconds?: number };
    const config: VideoConfig = {
      id: "oncue",
      fps: FPS,
      width: 1920,
      height: 1080,
      durationInFrames: Math.ceil((props.durationSeconds || 10) * FPS),
    };
    root = createRoot(document.getElementById("root")!);
    flushSync(() => root!.render(<App props={props} config={config} />));
    await ready();
    return config;
  },
  async frame(n) {
    flushSync(() => setFrame(n));
    await ready();
  },
};

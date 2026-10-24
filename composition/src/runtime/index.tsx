/**
 * The runtime compositions are written against: frame and video config, sequences, layout, media,
 * and animation math. The renderer (src/render/) renders it frame by frame in headless Chromium.
 *
 * The API mirrors a small part of Remotion's, so compositions written that way port directly. It's
 * a clean-room implementation of that documented behavior (no Remotion code), and Remotion is not
 * a dependency.
 */
import React, { createContext, useContext } from "react";

export type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number; id: string };

const FrameContext = createContext(0);
/** Cumulative `from` of the enclosing <Sequence>s. */
const OffsetContext = createContext(0);
const ConfigContext = createContext<VideoConfig>({ fps: 30, width: 1920, height: 1080, durationInFrames: 1, id: "" });

export const RenderRoot: React.FC<{ frame: number; config: VideoConfig; children: React.ReactNode }> = ({
  frame,
  config,
  children,
}) => (
  <ConfigContext.Provider value={config}>
    <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>
  </ConfigContext.Provider>
);

/** The frame relative to the enclosing <Sequence> (absolute frame outside any Sequence). */
export const useCurrentFrame = (): number => useContext(FrameContext) - useContext(OffsetContext);
export const useVideoConfig = (): VideoConfig => useContext(ConfigContext);

// --- Holding a frame until async work (fonts, data) is done -------------------------------------

const pending = new Set<number>();
let nextHandle = 0;
export const delayRender = (_label?: string): number => {
  nextHandle += 1;
  pending.add(nextHandle);
  return nextHandle;
};
export const continueRender = (handle: number): void => {
  pending.delete(handle);
};
export const pendingRenders = (): number => pending.size;

/** URL of a file in composer/public. */
export const staticFile = (path: string): string =>
  "/" + path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

// --- Layout ---------------------------------------------------------------------------------------

const FILL: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

export const AbsoluteFill = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => <div ref={ref} style={{ ...FILL, ...style }} {...rest} />,
);
AbsoluteFill.displayName = "AbsoluteFill";

/** Shows its children from `from` for `durationInFrames`; inside, frames count from 0. */
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  layout?: "absolute-fill" | "none";
  style?: React.CSSProperties;
  name?: string;
  children?: React.ReactNode;
}> = ({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", style, children }) => {
  const parentOffset = useContext(OffsetContext);
  const local = useContext(FrameContext) - parentOffset - from;
  if (local < 0 || local >= durationInFrames) return null;
  const inner = <OffsetContext.Provider value={parentOffset + from}>{children}</OffsetContext.Provider>;
  return layout === "none" ? inner : <AbsoluteFill style={style}>{inner}</AbsoluteFill>;
};

// --- Media ---------------------------------------------------------------------------------------

/** An <img>. The renderer waits until every image on the page is loaded and decoded before
 * capturing a frame, so a capture is never half-painted. */
export const Img = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>((props, ref) => (
  <img ref={ref} {...props} />
));
Img.displayName = "Img";

/** Audio isn't drawn. The renderer muxes the narration from props (narrationSrc, narrationOffset). */
export const Audio: React.FC<{ src: string; volume?: number }> = () => null;

// --- Animation math ------------------------------------------------------------------------------

type Extrapolate = "extend" | "clamp" | "identity";

/** Piecewise-linear map of `input` through inputRange -> outputRange. */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate; easing?: (t: number) => number } = {},
): number {
  if (inputRange.length !== outputRange.length || inputRange.length < 2) {
    throw new Error("interpolate: inputRange and outputRange need the same length, at least 2");
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i] > inputRange[i - 1])) {
      throw new Error(`interpolate: inputRange must be strictly increasing, got [${inputRange.join(", ")}]`);
    }
  }
  const { extrapolateLeft = "extend", extrapolateRight = "extend", easing = (t: number) => t } = options;
  let i = 1;
  while (i < inputRange.length - 1 && inputRange[i] < input) i++;
  const a = inputRange[i - 1];
  const b = inputRange[i];
  const c = outputRange[i - 1];
  const d = outputRange[i];
  let x = input;
  if (x < a) {
    if (extrapolateLeft === "clamp") return c;
    if (extrapolateLeft === "identity") return x;
  }
  if (x > b) {
    if (extrapolateRight === "clamp") return d;
    if (extrapolateRight === "identity") return x;
  }
  const t = easing((x - a) / (b - a));
  return c + t * (d - c);
}

/**
 * A damped spring from `from` to `to`, released at frame 0 with zero velocity (closed form).
 * Underdamped springs use the exact solution. At or above critical damping (zeta >= 1) the
 * critically damped curve is used for every zeta, which is how the published videos were
 * rendered. render/runtime.test.mjs pins the values (measured black-box from those renders' spring).
 */
export function spring({
  frame,
  fps,
  config = {},
  from = 0,
  to = 1,
}: {
  frame: number;
  fps: number;
  config?: { mass?: number; damping?: number; stiffness?: number; overshootClamping?: boolean };
  from?: number;
  to?: number;
}): number {
  const { mass = 1, damping = 10, stiffness = 100, overshootClamping = false } = config;
  if (frame <= 0) return from;
  const t = frame / fps;
  const x0 = from - to; // displacement from the target
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((zeta * w0 * x0) / wd) * Math.sin(wd * t));
  } else {
    x = Math.exp(-w0 * t) * (x0 + w0 * x0 * t);
  }
  const value = to + x;
  if (overshootClamping) return to >= from ? Math.min(value, to) : Math.max(value, to);
  return value;
}

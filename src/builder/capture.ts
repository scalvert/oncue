import type { CaptureSceneProps, Timed } from "../../composition/src/props.ts";
import { round } from "../core/numbers.ts";

export interface CameraView {
  cx: number;
  cy: number;
  w: number;
}

export interface CaptureOptions {
  /** Scene start (video seconds). */
  start: number;
  /** What the browser frame's URL bar shows. */
  url: string;
  /** Image size in pixels. Every image in one capture scene must be this size: pad them. */
  size: [number, number];
  /** The first image (a public path from Video#asset). */
  image: string;
  /** The wide shot the camera starts on and returns to. */
  wide: CameraView;
  eyebrow: string;
}

/**
 * A browser-capture scene: real screenshots under a keyframed camera, with cursor clicks and
 * highlight rings. The viewport is 1600x628; a camera's `w` is the visible image width in pixels.
 * Camera keyframe times are arrival times: the move runs over [at - dur, at].
 * Times passed in are absolute video seconds.
 */
export class Capture {
  readonly start: number;
  readonly url: string;
  readonly size: [number, number];
  readonly wide: CameraView;
  readonly camera: CaptureSceneProps["camera"];
  readonly images: CaptureSceneProps["images"];
  readonly highlights: NonNullable<CaptureSceneProps["highlights"]> = [];
  readonly cursor: NonNullable<CaptureSceneProps["cursor"]> = [];
  readonly eyebrows: Timed[];

  constructor(o: CaptureOptions) {
    this.start = o.start;
    this.url = o.url;
    this.size = o.size;
    this.wide = o.wide;
    this.camera = [{ at: 0, ...o.wide }];
    this.images = [{ src: o.image, at: 0 }];
    this.eyebrows = [{ text: o.eyebrow, at: 0 }];
  }

  /** `t` (video seconds) relative to the scene start. */
  r(t: number): number {
    return round(t - this.start, 3);
  }

  /** Move or zoom. The default cx = w/2 + 20 keeps the image's left margin in frame. */
  cam(at: number, o: { cy: number; w?: number; cx?: number; dur?: number }): this {
    const w = o.w ?? 1380;
    this.camera.push({ at: this.r(at), dur: o.dur ?? 0.9, cx: o.cx ?? w / 2 + 20, cy: o.cy, w });
    return this;
  }

  /** Return to the wide shot. */
  backWide(at: number, dur = 0.8): this {
    this.camera.push({ at: this.r(at), dur, ...this.wide });
    return this;
  }

  /** A highlight ring from `at` to `until`, in image pixels. */
  hl(at: number, until: number, x: number, y: number, w: number, h: number): this {
    this.highlights.push({ at: this.r(at), until: this.r(until), x, y, w, h });
    return this;
  }

  /** Change the eyebrow mid-scene. */
  eyebrow(at: number, text: string): this {
    this.eyebrows.push({ text, at: this.r(at) });
    return this;
  }

  /** Swap to another image (same size) without a click. */
  image(at: number, src: string): this {
    this.images.push({ src, at: this.r(at) });
    return this;
  }

  /**
   * An animated cursor click at `at` on `target` (image pixels). Optionally swap to the next image
   * and eyebrow on the click. By default the camera pulls back to the wide shot first.
   */
  click(at: number, target: [number, number], o: { image?: string; label?: string; from?: [number, number]; pullBack?: boolean } = {}): this {
    const [fx, fy] = o.from ?? [1420, 700];
    if (o.pullBack ?? true) this.backWide(at - 0.35);
    this.cursor.push({ at: this.r(at - 0.9), x: fx, y: fy });
    this.cursor.push({ at: this.r(at - 0.12), dur: 0.7, x: target[0], y: target[1] });
    this.cursor.push({ at: this.r(at), dur: 0.1, x: target[0], y: target[1], click: true });
    if (o.image) this.images.push({ src: o.image, at: this.r(at) });
    if (o.label) this.eyebrows.push({ text: o.label, at: this.r(at) });
    return this;
  }

  /** The scene, ending at `end` (video seconds). One URL bar per scene: use separate scenes for separate sites. */
  scene(id: string, end: number): CaptureSceneProps {
    return {
      id,
      type: "capture",
      start: this.start,
      end,
      url: this.url,
      imgW: this.size[0],
      imgH: this.size[1],
      images: this.images,
      camera: this.camera,
      cursor: this.cursor,
      highlights: this.highlights,
      eyebrows: this.eyebrows,
    };
  }
}

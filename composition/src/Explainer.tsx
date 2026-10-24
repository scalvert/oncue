/**
 * Explainer: the built-in composition for narrated developer explainers.
 *
 * Driven entirely by props built in projects/<name>/build.ts (types in ./props). Every timed
 * element carries an explicit `at` (seconds from its scene start), so visuals land
 * exactly on narration cues derived from the TTS word alignment.
 *
 * Look: the props' theme (./theme) for colors, backdrop and wordmark; DM Sans unless the props
 * name a local sans family; JetBrains Mono for terminals.
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "./runtime";
import { loadFont as loadDMSans } from "./runtime/fonts/DMSans";
import { loadFont as loadMono } from "./runtime/fonts/JetBrainsMono";
import { defaultTheme, rgba, type Theme, type ThemeColors } from "./theme";

const { fontFamily: DM_SANS } = loadDMSans("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});
const { fontFamily: MONO } = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

// All sans text resolves through this variable, so a local family (props.sans) can replace
// DM Sans without touching individual components.
const SANS = `var(--oncue-sans, ${DM_SANS})`;

const ThemeContext = React.createContext<Theme>(defaultTheme);
const useTheme = () => React.useContext(ThemeContext);
const useColors = (): ThemeColors => useTheme().colors;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { CaptionWord, ExchangeSceneProps, ExplainerProps, Scene, TermStep, Timed, Tone } from "./props";

export type { CaptionWord, ExchangeSceneProps, ExplainerProps, Scene, TermStep } from "./props";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { t: frame / fps, frame, fps };
};

const rise = (frame: number, fps: number, atSec: number, damping = 18) =>
  spring({ frame: frame - Math.round(atSec * fps), fps, config: { damping, stiffness: 140, mass: 0.8 } });

const Eyebrow: React.FC<{ text: string }> = ({ text }) => {
  const C = useColors();
  const { frame, fps } = useT();
  const a = rise(frame, fps, 0.1);
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 160,
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: a,
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.accent,
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: 3, background: C.accent }} />
      {text}
    </div>
  );
};

const BrandLabel = React.createContext("");
const BrandEyebrow: React.FC = () => <Eyebrow text={React.useContext(BrandLabel)} />;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const HeroScene: React.FC<{ s: Extract<Scene, { type: "hero" }> }> = ({ s }) => {
  const C = useColors();
  const { frame, fps } = useT();
  return (
    <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center" }}>
      <BrandEyebrow />
      {s.lines.map((line, i) => {
        const a = rise(frame, fps, 0.15 + i * 0.35, 20);
        return (
          <div
            key={i}
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 132,
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              color: i === 0 ? C.text : C.accent,
              opacity: a,
              transform: `translateY(${interpolate(a, [0, 1], [36, 0])}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 20, marginTop: 64 }}>
        {s.chips.map((c, i) => {
          const a = rise(frame, fps, c.at, 16);
          return (
            <div
              key={i}
              style={{
                opacity: a,
                transform: `translateY(${interpolate(a, [0, 1], [18, 0])}px)`,
                padding: "16px 26px",
                borderRadius: 14,
                background: C.white,
                border: `2px solid ${C.text}`,
                fontFamily: MONO,
                fontSize: 30,
                color: C.text,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  border: `2px solid ${C.muted}`,
                  display: "inline-block",
                }}
              />
              {c.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const StatementScene: React.FC<{ s: Extract<Scene, { type: "statement" }> }> = ({ s }) => {
  const C = useColors();
  const { frame, fps } = useT();
  const a1 = rise(frame, fps, 0.1, 20);
  const a2 = rise(frame, fps, Math.max(0.5, s.highlightAt - 0.6), 20);
  const sweep = interpolate(frame, [s.highlightAt * fps, (s.highlightAt + 0.45) * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const big: React.CSSProperties = {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 148,
    lineHeight: 1.08,
    letterSpacing: "-0.04em",
    color: C.text,
  };
  return (
    <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center" }}>
      <BrandEyebrow />
      <div style={{ ...big, opacity: a1, transform: `translateY(${interpolate(a1, [0, 1], [36, 0])}px)` }}>
        {s.line1}
      </div>
      <div style={{ position: "relative", alignSelf: "flex-start", opacity: a2, marginTop: 8 }}>
        <div
          style={{
            position: "absolute",
            left: -12,
            right: -12,
            top: "18%",
            bottom: "6%",
            background: C.highlight,
            borderRadius: 10,
            transformOrigin: "left center",
            transform: `scaleX(${sweep})`,
          }}
        />
        <div style={{ ...big, position: "relative" }}>{s.line2}</div>
      </div>
    </AbsoluteFill>
  );
};

const toneColor = (C: ThemeColors, tone?: Tone) =>
  tone === "ok" ? C.highlight : tone === "dim" ? C.termDim : tone === "agent" ? C.termText : C.termText;

const TerminalScene: React.FC<{ s: Extract<Scene, { type: "terminal" }> }> = ({ s }) => {
  const C = useColors();
  const { t, frame, fps } = useT();
  const win = rise(frame, fps, 0.0, 24);
  const lines = s.steps.filter((st) => st.kind !== "pill" && t >= st.at) as Exclude<TermStep, { kind: "pill" }>[];
  const FS = s.fontSize ?? 29;
  const MAX = Math.floor((680 - 52 - 60) / (FS * 1.62));
  const shown = lines.slice(Math.max(0, lines.length - MAX));
  const pills = s.steps.filter((st) => st.kind === "pill") as Extract<TermStep, { kind: "pill" }>[];
  const blink = Math.floor(frame / (fps * 0.5)) % 2 === 0;
  const activePills = pills.filter((p) => t >= p.at && t <= p.at + (p.duration ?? 3));

  return (
    <AbsoluteFill>
      <Eyebrow text={s.label} />
      <div
        style={{
          position: "absolute",
          left: 160,
          right: 160,
          top: 150,
          height: 680,
          borderRadius: 20,
          overflow: "hidden",
          background: C.ink,
          boxShadow: "0 30px 80px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)",
          opacity: win,
          transform: `translateY(${interpolate(win, [0, 1], [24, 0])}px)`,
        }}
      >
        <div
          style={{
            height: 52,
            background: C.inkBar,
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            gap: 10,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 13, height: 13, borderRadius: 999, background: "#3A3A46" }} />
          ))}
          <div
            style={{
              flex: 1,
              textAlign: "center",
              marginRight: 70,
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: 19,
              color: "#9C9A92",
            }}
          >
            {s.title}
          </div>
        </div>
        <div style={{ padding: "30px 44px", fontFamily: MONO, fontSize: FS, lineHeight: 1.62 }}>
          {shown.map((ln, i) => {
            if (ln.kind === "cmd") {
              const cs = ln.charSeconds ?? 0.028;
              const t0 = ln.typeAt ?? ln.at;
              const n = Math.floor(interpolate(t, [t0, t0 + ln.text.length * cs + 0.001], [0, ln.text.length], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }));
              const typing = t < t0 + ln.text.length * cs + 0.25;
              const isLast = i === shown.length - 1;
              const prompt = ln.prompt ?? "$";
              return (
                <div key={i} style={{ display: "flex", whiteSpace: "pre", color: C.termText }}>
                  {ln.prefix === undefined && (
                    <span style={{ color: C.highlight, fontWeight: 500, width: 40 }}>{prompt}</span>
                  )}
                  {ln.prefix !== undefined && <span>{ln.prefix}</span>}
                  <span style={ln.prefix !== undefined && !ln.plain ? { color: C.highlight, fontWeight: 500 } : undefined}>
                    {ln.text.slice(0, n)}
                  </span>
                  {isLast && typing && blink && (
                    <span style={{ width: 14, height: 32, background: C.termText, marginLeft: 2, transform: "translateY(6px)" }} />
                  )}
                </div>
              );
            }
            const a = interpolate(t, [ln.at, ln.at + 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const isAgent = ln.tone === "agent";
            return (
              <div key={i} style={{ whiteSpace: "pre", color: toneColor(C, ln.tone), opacity: a, display: "flex" }}>
                {isAgent && <span style={{ color: C.info, width: 40 }}>●</span>}
                <span>{ln.text || "\u00A0"}</span>
              </div>
            );
          })}
        </div>
        {activePills.map((p, i) => {
          const local = t - p.at;
          const dur = p.duration ?? 3;
          const aIn = spring({ frame: Math.round(local * fps), fps, config: { damping: 15, stiffness: 190 } });
          const aOut = interpolate(local, [dur - 0.3, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div
              key={`${p.at}-${i}`}
              style={{
                position: "absolute",
                right: 36,
                top: 82 + i * 70,
                padding: "13px 24px",
                borderRadius: 999,
                background: C.highlight,
                color: C.text,
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 24,
                opacity: Math.min(aIn, aOut),
                transform: `translateY(${interpolate(aIn, [0, 1], [14, 0])}px)`,
              }}
            >
              {p.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Browser capture with a keyframed camera, cursor, and highlight rings.
// Coordinates are image pixels in the captured screenshot.
// ---------------------------------------------------------------------------

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function keyframed<T extends { at: number; dur?: number }>(
  frames: T[],
  t: number,
  fields: (keyof T)[],
  defaultDur = 0.9,
): Record<string, number> {
  const out: Record<string, number> = {};
  const first = frames[0];
  fields.forEach((f) => (out[f as string] = first[f] as unknown as number));
  for (let i = 1; i < frames.length; i++) {
    const k = frames[i];
    const prev = frames[i - 1];
    const dur = k.dur ?? defaultDur;
    const p = easeInOut(Math.min(1, Math.max(0, (t - (k.at - dur)) / dur)));
    if (t < k.at - dur) break;
    fields.forEach((f) => {
      const a = prev[f] as unknown as number;
      const b = k[f] as unknown as number;
      out[f as string] = a + (b - a) * p;
    });
  }
  return out;
}

const CaptureScene: React.FC<{ s: Extract<Scene, { type: "capture" }> }> = ({ s }) => {
  const C = useColors();
  const { t, frame, fps } = useT();
  const win = rise(frame, fps, 0.0, 24);
  const VW = 1600;
  const VH = 680 - 52;
  const cam = keyframed(s.camera, t, ["cx", "cy", "w"]);
  const scale = VW / cam.w;
  let tx = VW / 2 - cam.cx * scale;
  let ty = VH / 2 - cam.cy * scale;
  tx = Math.min(0, Math.max(VW - s.imgW * scale, tx));
  ty = Math.min(0, Math.max(VH - s.imgH * scale, ty));
  const toScreen = (x: number, y: number) => ({ x: tx + x * scale, y: ty + y * scale });

  const eyebrow = [...s.eyebrows].reverse().find((e) => t >= e.at) ?? s.eyebrows[0];
  const cur = s.cursor && s.cursor.length ? keyframed(s.cursor, t, ["x", "y"], 0.7) : null;
  const lastClick = s.cursor?.filter((c) => c.click && t >= c.at).pop();
  const clickAge = lastClick ? t - lastClick.at : 99;
  // Cursor shows only around its keyframes (each Next click), fading in/out.
  const cursorAlpha = (s.cursor ?? []).reduce((m, k) => {
    const a = interpolate(t, [k.at - 1.2, k.at - 0.9, k.at + 0.35, k.at + 0.6], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return Math.max(m, a);
  }, 0);
  const cursorVisible = cursorAlpha > 0;

  return (
    <AbsoluteFill>
      <div key={eyebrow.text}>
        <Eyebrow text={eyebrow.text} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          right: 160,
          top: 150,
          height: 680,
          borderRadius: 20,
          overflow: "hidden",
          background: C.white,
          boxShadow: "0 30px 80px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)",
          opacity: win,
          transform: `translateY(${interpolate(win, [0, 1], [24, 0])}px)`,
        }}
      >
        <div
          style={{
            height: 52,
            background: "#EFECE4",
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            gap: 10,
            borderBottom: "1px solid #E2DED3",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 13, height: 13, borderRadius: 999, background: "#CFCABD" }} />
          ))}
          <div style={{ flex: 1, display: "flex", justifyContent: "center", marginRight: 70 }}>
            <div
              style={{
                background: C.white,
                borderRadius: 8,
                padding: "6px 18px",
                fontFamily: SANS,
                fontSize: 18,
                color: "#55534A",
                minWidth: 560,
                textAlign: "center",
              }}
            >
              {s.url}
            </div>
          </div>
        </div>
        <div style={{ position: "relative", width: VW, height: VH, overflow: "hidden" }}>
          {s.images.map((im, i) => {
            const next = s.images[i + 1];
            const aIn = i === 0 ? 1 : interpolate(t, [im.at, im.at + 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const aOut = next ? interpolate(t, [next.at + 0.25, next.at + 0.3], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
            if (t < im.at && i !== 0) return null;
            // Every image is loaded and decoded before a frame is captured (src/render/page.ts).
            // Before that guarantee, large captures were sometimes captured half-painted.
            return (
              <Img
                key={im.src}
                src={staticFile(im.src)}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: s.imgW,
                  height: s.imgH,
                  transformOrigin: "0 0",
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  opacity: Math.min(aIn, aOut),
                }}
              />
            );
          })}
          {(s.highlights ?? []).map((h, i) => {
            const a = interpolate(t, [h.at, h.at + 0.25, h.until - 0.25, h.until], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            if (a <= 0) return null;
            const p = toScreen(h.x, h.y);
            const grow = interpolate(a, [0, 1], [10, 0]);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: p.x - 10 - grow,
                  top: p.y - 8 - grow,
                  width: h.w * scale + 20 + grow * 2,
                  height: h.h * scale + 16 + grow * 2,
                  borderRadius: 12,
                  border: `4px solid ${C.accent}`,
                  boxShadow: `0 0 0 6px ${rgba(C.accent, 0.14)}`,
                  opacity: a,
                }}
              />
            );
          })}
          {cur && cursorVisible ? (
            (() => {
              const p = toScreen(cur.x, cur.y);
              const pulse = clickAge < 0.5 ? clickAge / 0.5 : 1;
              const press = clickAge < 0.15 ? 0.88 : 1;
              return (
                <>
                  {clickAge < 0.5 && (
                    <div
                      style={{
                        position: "absolute",
                        left: p.x - 30 * pulse - 6,
                        top: p.y - 30 * pulse - 6,
                        width: 60 * pulse + 12,
                        height: 60 * pulse + 12,
                        borderRadius: 999,
                        border: `3px solid ${C.accent}`,
                        opacity: 1 - pulse,
                      }}
                    />
                  )}
                  <svg
                    width={34}
                    height={40}
                    viewBox="0 0 17 20"
                    style={{ position: "absolute", left: p.x - 3, top: p.y - 2, opacity: cursorAlpha, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }}
                  >
                    <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" fill="#000" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                </>
              );
            })()
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Flow: sequence diagram. Lanes across the top, messages as arrows that draw on cue,
// notes stacked under a lane (used for multi-system setup steps).
// ---------------------------------------------------------------------------

const FlowScene: React.FC<{ s: Extract<Scene, { type: "flow" }> }> = ({ s }) => {
  const C = useColors();
  const { t, frame, fps } = useT();
  const L = 160;
  const W = 1600;
  const n = s.lanes.length;
  const laneX = (id: string) => {
    const i = s.lanes.findIndex((l) => l.id === id);
    return L + (W / n) * (i + 0.5);
  };
  const headTop = 140;
  const headH = 112;
  const rowTop = headTop + headH + 70;
  const rowGap = Math.min(124, (880 - rowTop) / Math.max(1, s.messages.length));
  const lastActive = s.messages.filter((m) => t >= m.at).length - 1;
  return (
    <AbsoluteFill>
      <Eyebrow text={s.label} />
      {s.tag && (
        <div style={{ position: "absolute", top: 100, left: 160, fontFamily: SANS, fontSize: 20, color: C.muted }}>{s.tag}</div>
      )}
      {s.lanes.map((l, i) => {
        const a = rise(frame, fps, 0.1 + i * 0.12, 20);
        const x = laneX(l.id);
        const boxW = Math.min(340, W / n - 40);
        return (
          <React.Fragment key={l.id}>
            <div
              style={{
                position: "absolute",
                left: x - boxW / 2,
                top: headTop,
                width: boxW,
                height: headH,
                borderRadius: 18,
                background: C.white,
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                opacity: a,
                transform: `translateY(${interpolate(a, [0, 1], [16, 0])}px)`,
              }}
            >
              <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 30, color: C.text }}>{l.title}</div>
              {l.sub && <div style={{ fontFamily: SANS, fontSize: 19, color: C.muted, marginTop: 4 }}>{l.sub}</div>}
            </div>
            <div
              style={{
                position: "absolute",
                left: x - 1,
                top: headTop + headH,
                width: 2,
                height: 900 - headTop - headH,
                backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0) 50%)`,
                backgroundSize: "2px 14px",
                opacity: a,
              }}
            />
          </React.Fragment>
        );
      })}
      {s.messages.map((m, i) => {
        if (t < m.at) return null;
        const p = interpolate(t, [m.at, m.at + 0.45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const x1 = laneX(m.from);
        const x2 = laneX(m.to);
        const y = rowTop + i * rowGap;
        const dir = x2 >= x1 ? 1 : -1;
        const len = Math.abs(x2 - x1) * p;
        const active = i === lastActive;
        const color = active ? C.accent : "#2B2B33";
        const left = dir > 0 ? x1 : x1 - len;
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: 0 }}>
            <div style={{ position: "absolute", left, top: y, width: len, height: active ? 4 : 3, background: color, borderRadius: 2 }} />
            {p > 0.95 && (
              <div
                style={{
                  position: "absolute",
                  left: x2 - (dir > 0 ? 16 : -2),
                  top: y - 9,
                  width: 0,
                  height: 0,
                  borderTop: "10px solid transparent",
                  borderBottom: "10px solid transparent",
                  [dir > 0 ? "borderLeft" : "borderRight"]: `16px solid ${color}`,
                } as React.CSSProperties}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: Math.min(x1, x2),
                width: Math.abs(x2 - x1),
                top: y - 44,
                textAlign: "center",
                fontFamily: SANS,
                fontWeight: active ? 700 : 500,
                fontSize: 28,
                color: active ? C.accent : C.text,
                opacity: interpolate(p, [0.4, 1], [0, 1]),
              }}
            >
              <span style={{ background: "rgba(247,246,240,0.92)", padding: "2px 10px", borderRadius: 8 }}>{m.label}</span>
            </div>
          </div>
        );
      })}
      {s.lanes.map((l) => {
        const notes = s.notes.filter((nt) => nt.lane === l.id);
        const x = laneX(l.id);
        const boxW = Math.min(360, W / n - 30);
        return notes.map((nt, j) => {
          const a = rise(frame, fps, nt.at, 16);
          if (t < nt.at - 0.05) return null;
          return (
            <div
              key={`${l.id}-${j}`}
              style={{
                position: "absolute",
                left: x - boxW / 2,
                top: headTop + headH + 40 + j * 118,
                width: boxW,
                padding: "16px 18px",
                borderRadius: 14,
                background: C.white,
                border: `2px solid ${C.accent}`,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                opacity: a,
                transform: `translateY(${interpolate(a, [0, 1], [14, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 28, height: 28, borderRadius: 7, background: C.highlight, flexShrink: 0, display: "flex",
                  alignItems: "center", justifyContent: "center", fontFamily: SANS, fontWeight: 700, fontSize: 18, color: C.text,
                }}
              >
                {j + 1}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 23, lineHeight: 1.3, color: C.text }}>{nt.text}</div>
            </div>
          );
        });
      })}
    </AbsoluteFill>
  );
};

const PermissionsScene: React.FC<{ s: Extract<Scene, { type: "permissions" }> }> = ({ s }) => {
  const C = useColors();
  const { frame, fps } = useT();
  const h = rise(frame, fps, 0.1, 20);
  const card = rise(frame, fps, 0.5, 18);
  const lock = rise(frame, fps, s.items[0]?.at ?? 1, 14);
  return (
    <AbsoluteFill style={{ padding: "0 160px", flexDirection: "row", alignItems: "center", gap: 90 }}>
      <Eyebrow text={s.label} />
      <div style={{ flex: 1.1 }}>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 104,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
            color: C.text,
            opacity: h,
            transform: `translateY(${interpolate(h, [0, 1], [30, 0])}px)`,
            marginBottom: 56,
          }}
        >
          {s.heading}
        </div>
        {s.items.map((it, i) => {
          const a = rise(frame, fps, it.at, 16);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                marginBottom: 26,
                opacity: a,
                transform: `translateX(${interpolate(a, [0, 1], [-20, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 10,
                  background: C.highlight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: 30,
                  color: C.text,
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 500, color: C.text }}>{it.text}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          flex: 0.9,
          opacity: card,
          transform: `translateY(${interpolate(card, [0, 1], [30, 0])}px)`,
          background: C.white,
          borderRadius: 24,
          padding: 44,
          boxShadow: "0 30px 80px rgba(0,0,0,0.10)",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 22, color: C.muted, marginBottom: 14 }}>{s.doc.source}</div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 46, color: C.text, marginBottom: 28 }}>
          {s.doc.title}
        </div>
        {[0.92, 0.78, 0.86, 0.6].map((w, i) => (
          <div key={i} style={{ height: 16, width: `${w * 100}%`, borderRadius: 8, background: "#ECE8DD", marginBottom: 16 }} />
        ))}
        <div
          style={{
            marginTop: 30,
            paddingTop: 26,
            borderTop: "1px solid #ECE8DD",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            opacity: lock,
          }}
        >
          {s.doc.visibleTo && s.doc.visibleTo.length > 0 && (
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: C.accent,
              }}
            >
              {s.doc.chipsLabel ?? "Visible to"}
            </div>
          )}
          {s.doc.checkbox && (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 30, height: 30, borderRadius: 6, border: `2.5px solid ${C.text}`, background: C.white, flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 500, color: C.text }}>{s.doc.checkbox}</div>
                {s.doc.checkboxNote && (
                  <div style={{ fontFamily: SANS, fontSize: 20, color: C.accent, fontWeight: 700, marginTop: 4 }}>{s.doc.checkboxNote}</div>
                )}
              </div>
            </div>
          )}
          {(s.doc.visibleTo ?? []).map((g) => (
            <div
              key={g}
              style={{
                fontFamily: MONO,
                fontSize: 24,
                padding: "8px 16px",
                borderRadius: 999,
                background: C.accent,
                color: C.white,
              }}
            >
              {g}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndScene: React.FC<{ s: Extract<Scene, { type: "end" }> }> = ({ s }) => {
  const C = useColors();
  const { frame, fps } = useT();
  const a = rise(frame, fps, 0.1, 20);
  const b = rise(frame, fps, 0.6, 18);
  const c = rise(frame, fps, 1.2, 20);
  // Fit one line: ~0.52em per headline glyph, ~0.6em per mono glyph, 1600px column.
  const headSize = Math.min(132, Math.floor(1600 / (s.headline.length * 0.5)));
  const urlSize = Math.min(44, Math.floor((1600 - 70) / (s.url.length * 0.61)));
  return (
    <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center" }}>
      <BrandEyebrow />
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: headSize,
          lineHeight: 1.04,
          letterSpacing: "-0.035em",
          color: C.text,
          opacity: a,
          transform: `translateY(${interpolate(a, [0, 1], [30, 0])}px)`,
        }}
      >
        {s.headline}
      </div>
      <div
        style={{
          alignSelf: "flex-start",
          marginTop: 56,
          padding: "22px 34px",
          borderRadius: 16,
          background: C.text,
          color: C.highlight,
          fontFamily: MONO,
          fontSize: urlSize,
          whiteSpace: "nowrap",
          opacity: b,
          transform: `translateY(${interpolate(b, [0, 1], [20, 0])}px)`,
        }}
      >
        {s.url}
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          bottom: 150, // clear of the caption bar
          fontFamily: SANS,
          fontSize: 22,
          color: C.muted,
          opacity: c,
        }}
      >
        {s.footnote}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const Captions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
  const C = useColors();
  const { t } = useT();
  // Build pages: up to 8 words, break on breakAfter.
  const pages: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 8 || w.breakAfter) {
      pages.push(cur);
      cur = [];
    }
  }
  if (cur.length) pages.push(cur);
  const idx = pages.findIndex((p, i) => {
    const next = pages[i + 1];
    const endAt = next ? Math.min(next[0].start, p[p.length - 1].end + 0.8) : p[p.length - 1].end + 0.8;
    return t >= p[0].start - 0.05 && t < endAt;
  });
  if (idx < 0) return null;
  const page = pages[idx];
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54 }}>
      <div
        style={{
          background: "rgba(0,0,0,0.86)",
          borderRadius: 14,
          padding: "12px 26px",
          maxWidth: 1500,
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: 36,
          lineHeight: 1.35,
          textAlign: "center",
        }}
      >
        {page.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.05;
          const past = t >= w.end;
          return (
            <span key={i} style={{ color: active ? C.highlight : past ? C.paper : rgba(C.paper, 0.55) }}>
              {w.word}
              {i < page.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Root composition
// ---------------------------------------------------------------------------

// --- Exchange: request / response --------------------------------------------------------------

const EX = { top: 150, height: 680, left: 160, gap: 28, reqW: 640, head: 64, padY: 26, padX: 30, fs: 21, lh: 1.55 };

/** Minimal JSON-ish coloring: keys, strings, numbers and literals. Anything else stays plain. */
const colorize = (C: ThemeColors, line: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) {
      out.push(<span key={k++} style={{ color: m[2] ? C.info : C.highlight }}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else {
      out.push(<span key={k++} style={{ color: C.warn }}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
};

const methodColors = (C: ThemeColors): Record<string, string> => ({ GET: C.info, POST: C.highlight, PUT: C.warn, PATCH: C.warn, DELETE: C.danger });

const ExchangePane: React.FC<{
  x: number;
  w: number;
  appear: number;
  header: React.ReactNode;
  lines: string[];
  visibleCount: number;
  highlights: ExchangeSceneProps["highlights"];
  t: number;
}> = ({ x, w, appear, header, lines, visibleCount, highlights, t }) => {
  const C = useColors();
  const lineH = EX.fs * EX.lh;
  const capacity = Math.floor((EX.height - EX.head - EX.padY * 2) / lineH);
  // Scroll so the latest started highlight sits in view; ease between targets.
  const targets = highlights
    .filter((h) => h.to >= capacity - 1)
    .map((h) => ({ at: h.at, off: Math.max(0, Math.min(lines.length - capacity, Math.round((h.from + h.to) / 2 - capacity / 2))) }));
  let off = 0;
  for (const tg of targets) {
    off = interpolate(t, [tg.at - 0.5, tg.at], [off, tg.off], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: EX.top,
        width: w,
        height: EX.height,
        borderRadius: 20,
        overflow: "hidden",
        background: C.ink,
        boxShadow: "0 30px 80px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)",
        opacity: appear,
        transform: `translateY(${interpolate(appear, [0, 1], [24, 0])}px)`,
      }}
    >
      <div style={{ height: EX.head, background: C.inkBar, display: "flex", alignItems: "center", padding: "0 26px", gap: 14 }}>
        {header}
      </div>
      <div style={{ position: "relative", height: EX.height - EX.head, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: EX.padY - off * lineH }}>
          {highlights.map((h, i) => {
            const a = interpolate(t, [h.at, h.at + 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
              (h.until === undefined ? 1 : interpolate(t, [h.until - 0.25, h.until], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
            if (a <= 0) return null;
            return (
              <div key={i} style={{ position: "absolute", left: 12, right: 12, top: h.from * lineH - 3, height: (h.to - h.from + 1) * lineH + 6, opacity: a }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 8, background: rgba(C.info, 0.16), borderLeft: `4px solid ${C.info}` }} />
                {h.note ? (
                  <div
                    style={{
                      position: "absolute",
                      right: 14,
                      top: 0,
                      transform: `translateY(-62%) scale(${interpolate(a, [0, 1], [0.92, 1])})`,
                      boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                      background: C.highlight,
                      color: C.ink,
                      fontFamily: SANS,
                      fontWeight: 700,
                      fontSize: 19,
                      padding: "6px 14px",
                      borderRadius: 999,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.note}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div style={{ position: "relative", padding: `0 ${EX.padX}px`, fontFamily: MONO, fontSize: EX.fs, lineHeight: EX.lh, color: C.termText, whiteSpace: "pre" }}>
            {lines.slice(0, visibleCount).map((ln, i) => (
              <div key={i} style={{ height: lineH }}>{ln === "" ? "\u00a0" : colorize(C, ln)}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ExchangeScene: React.FC<{ s: ExchangeSceneProps }> = ({ s }) => {
  const C = useColors();
  const { t, frame, fps } = useT();
  const reqA = rise(frame, fps, s.request.at, 24);
  const resA = rise(frame, fps, s.response.at, 24);
  const per = s.response.lineSeconds ?? 0.03;
  const shown = t < s.response.at ? 0 : Math.min(s.response.lines.length, 1 + Math.floor((t - s.response.at) / per));
  const resX = EX.left + EX.reqW + EX.gap;
  const resW = 1920 - EX.left - resX;
  const method = s.request.method.toUpperCase();
  const ok = /^2/.test(s.response.status);
  return (
    <AbsoluteFill>
      <Eyebrow text={s.label} />
      <ExchangePane
        x={EX.left}
        w={EX.reqW}
        appear={reqA}
        t={t}
        lines={s.request.lines}
        visibleCount={s.request.lines.length}
        highlights={s.highlights.filter((h) => h.pane === "request")}
        header={
          <>
            <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 20, color: C.ink, background: methodColors(C)[method] ?? C.termDim, padding: "4px 12px", borderRadius: 8 }}>
              {method}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 21, color: C.termText }}>{s.request.path}</span>
          </>
        }
      />
      <ExchangePane
        x={resX}
        w={resW}
        appear={resA}
        t={t}
        lines={s.response.lines}
        visibleCount={shown}
        highlights={s.highlights.filter((h) => h.pane === "response")}
        header={
          <>
            <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 19, letterSpacing: "0.08em", color: "#9C9A92" }}>RESPONSE</span>
            <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 20, color: C.ink, background: ok ? C.highlight : C.danger, padding: "4px 12px", borderRadius: 8 }}>
              {s.response.status}
            </span>
          </>
        }
      />
      {s.tag ? (
        <div style={{ position: "absolute", left: EX.left, top: EX.top + EX.height + 26, fontFamily: SANS, fontWeight: 500, fontSize: 22, color: C.muted, opacity: reqA }}>
          {s.tag}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const SceneSwitch: React.FC<{ s: Scene }> = ({ s }) => {
  switch (s.type) {
    case "hero":
      return <HeroScene s={s} />;
    case "statement":
      return <StatementScene s={s} />;
    case "terminal":
      return <TerminalScene s={s} />;
    case "permissions":
      return <PermissionsScene s={s} />;
    case "capture":
      return <CaptureScene s={s} />;
    case "flow":
      return <FlowScene s={s} />;
    case "exchange":
      return <ExchangeScene s={s} />;
    case "end":
      return <EndScene s={s} />;
  }
};

const Fade: React.FC<{ dur: number; children: React.ReactNode; first: boolean; last: boolean }> = ({
  dur,
  children,
  first,
  last,
}) => {
  const { t } = useT();
  const fin = first ? 1 : interpolate(t, [0, 0.35], [0, 1], { extrapolateRight: "clamp" });
  const fout = last ? interpolate(t, [dur - 0.8, dur], [1, 0], { extrapolateLeft: "clamp" }) : interpolate(t, [dur - 0.3, dur], [1, 0], { extrapolateLeft: "clamp" });
  return <AbsoluteFill style={{ opacity: Math.min(fin, fout) }}>{children}</AbsoluteFill>;
};

// ---------------------------------------------------------------------------
// v2 look: three slow-drifting glows over a soft gradient (theme.backdrop), and the
// theme's wordmark in the top-right corner.
// ---------------------------------------------------------------------------

const V2Backdrop: React.FC = () => {
  const { glows, base } = useTheme().backdrop;
  const { t } = useT();
  const dx = Math.sin(t / 9) * 4;
  const dy = Math.cos(t / 11) * 3;
  const glow = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(60% 70% at ${12 + dx}% ${18 + dy}%, ${glow(glows[0], 0.55)} 0%, ${glow(glows[0], 0)} 60%)`,
          `radial-gradient(55% 65% at ${88 - dx}% ${22 - dy}%, ${glow(glows[1], 0.55)} 0%, ${glow(glows[1], 0)} 62%)`,
          `radial-gradient(70% 60% at ${55 + dy}% ${105 - dx}%, ${glow(glows[2], 0.55)} 0%, ${glow(glows[2], 0)} 60%)`,
          `linear-gradient(180deg, ${base[0]} 0%, ${base[1]} 100%)`,
        ].join(", "),
      }}
    />
  );
};

const V2Bug: React.FC<{ seriesTag?: string }> = ({ seriesTag }) => {
  const { colors: C, logo } = useTheme();
  return (
    <div style={{ position: "absolute", top: 52, right: 160, display: "flex", alignItems: "center", gap: 18 }}>
      {seriesTag && (
        <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 22, color: C.text, opacity: 0.7 }}>{seriesTag}</div>
      )}
      {logo && <Img src={staticFile(logo.src)} style={{ height: logo.height }} />}
    </div>
  );
};

const useSansFont = (sans?: ExplainerProps["sans"]) => {
  const files = sans?.files;
  const [handle] = React.useState(() => (files && files.length ? delayRender(`Loading ${sans!.family}`) : null));
  React.useEffect(() => {
    if (!sans || !files || !files.length || handle === null) return;
    Promise.all(
      files.map((f) =>
        new FontFace(sans.family, `url(${staticFile(f.src)})`, { weight: f.weight })
          .load()
          .then((loaded) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded)),
      ),
    )
      .then(() => continueRender(handle))
      .catch((err) => {
        console.error(`${sans.family} failed to load; falling back to DM Sans`, err);
        continueRender(handle);
      });
  }, [sans, files, handle]);
};

export const Explainer: React.FC<ExplainerProps> = ({
  scenes,
  captions,
  narrationSrc,
  narrationOffset = 0,
  showCaptions = true,
  brandLabel = "",
  look = "classic",
  seriesTag,
  theme = defaultTheme,
  sans,
}) => {
  const { fps } = useVideoConfig();
  useSansFont(sans);
  const sansStack = sans && sans.files.length ? `${sans.family}, ${DM_SANS}` : DM_SANS;
  const C = theme.colors;
  return (
    <ThemeContext.Provider value={theme}>
    <BrandLabel.Provider value={brandLabel}>
    <AbsoluteFill style={{ background: C.paper, fontFamily: SANS, ["--oncue-sans" as string]: sansStack } as React.CSSProperties}>
      {look === "v2" && <V2Backdrop />}
      {scenes.map((s, i) => (
        <Sequence key={s.id} from={Math.round(s.start * fps)} durationInFrames={Math.round((s.end - s.start) * fps)}>
          <Fade dur={s.end - s.start} first={i === 0} last={i === scenes.length - 1}>
            <SceneSwitch s={s} />
          </Fade>
        </Sequence>
      ))}
      {look === "v2" && <V2Bug seriesTag={seriesTag} />}
      {showCaptions && <Captions words={captions} />}
      {narrationSrc && (
        <Sequence from={Math.round(narrationOffset * fps)}>
          <Audio src={staticFile(narrationSrc)} />
        </Sequence>
      )}
    </AbsoluteFill>
    </BrandLabel.Provider>
    </ThemeContext.Provider>
  );
};

export default Explainer;

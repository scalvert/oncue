/**
 * The placeholder voice: an offline take for drafting a video before it has a real voice.
 *
 * Each word is a soft tone on an even speaking rhythm (about 180 words a minute, with pauses at
 * punctuation and <break> tags), with exact per-character timings. Cues, captions, and layout
 * work the same as with a real take, so a video can be built and rendered end to end without an
 * API key. `check --release` refuses a placeholder take.
 *
 * Use it by naming it as the house voice (catalog/voice.json):
 *   { "voice_id": "oncue-placeholder", "model_id": "oncue-placeholder", "settings": {} }
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "../media/ffmpeg.ts";
import type { CharAlignment } from "./alignment.ts";
import type { SpeechSynthesizer } from "./elevenlabs.ts";
import type { Voice } from "./voice.ts";

export const PLACEHOLDER_VOICE = "oncue-placeholder";

export const isPlaceholder = (v: Pick<Voice, "voice_id">): boolean => v.voice_id === PLACEHOLDER_VOICE;

const RATE = 44100;
const CHAR = 1 / 17;
const PAUSE: Record<string, number> = { ".": 0.3, "?": 0.3, "!": 0.3, ",": 0.12, ";": 0.12, ":": 0.12 };
const BREAK = /<break\s+time="([\d.]+)s"\s*\/>/g;

/** Per-character timings for `text`: tags take no time, except a <break>, which is its pause. */
export function placeholderTimings(text: string): { alignment: CharAlignment; words: [number, number][] } {
  const chars = [...text];
  const starts: number[] = new Array(chars.length);
  const ends: number[] = new Array(chars.length);
  const breaks = new Map<number, { end: number; seconds: number }>();
  for (const m of text.matchAll(BREAK)) {
    const at = [...text.slice(0, m.index)].length;
    breaks.set(at, { end: at + [...m[0]].length, seconds: Number(m[1]) });
  }
  const words: [number, number][] = [];
  let t = 0.25;
  let wordStart: number | null = null;
  let wordEnd = 0;
  let inTag = false;
  for (let i = 0; i < chars.length; i++) {
    const br = breaks.get(i);
    if (br) {
      const step = br.seconds / (br.end - i);
      for (let j = i; j < br.end; j++, t += step) [starts[j], ends[j]] = [t, t + step];
      i = br.end - 1;
      continue;
    }
    const c = chars[i]!;
    if (c === "[") inTag = true;
    if (inTag) {
      [starts[i], ends[i]] = [t, t];
      if (c === "]") inTag = false;
      continue;
    }
    if (/\s/.test(c)) {
      if (wordStart !== null) words.push([wordStart, wordEnd]);
      wordStart = null;
      [starts[i], ends[i]] = [t, t + CHAR];
      t += CHAR;
      continue;
    }
    if (wordStart === null) wordStart = t;
    [starts[i], ends[i]] = [t, t + CHAR];
    wordEnd = t + CHAR;
    t += CHAR + (PAUSE[c] && (i + 1 >= chars.length || /\s/.test(chars[i + 1]!)) ? PAUSE[c]! : 0);
  }
  if (wordStart !== null) words.push([wordStart, wordEnd]);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { alignment: { characters: chars, starts: starts.map(r), ends: ends.map(r) }, words };
}

/** A soft tone per word, 0.25 s of silence after the last. */
function tones(words: [number, number][]): Int16Array {
  const end = (words.at(-1)?.[1] ?? 0) + 0.25;
  const pcm = new Int16Array(Math.ceil(end * RATE));
  const fade = Math.round(0.012 * RATE);
  words.forEach(([s, e], w) => {
    const freq = 196 + (w % 5) * 14;
    const a = Math.round(s * RATE);
    const b = Math.min(pcm.length, Math.round(Math.max(e - 0.03, s + 0.04) * RATE));
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / fade, (b - i) / fade);
      pcm[i] = Math.round(Math.sin((2 * Math.PI * freq * (i - a)) / RATE) * 0.3 * env * 32767);
    }
  });
  return pcm;
}

/** The placeholder voice's synthesizer: MP3, 44.1 kHz, 128 kbps, like a real take. */
export const placeholderSynthesizer: SpeechSynthesizer = {
  async synthesize(text) {
    const { alignment, words } = placeholderTimings(text);
    const dir = mkdtempSync(join(tmpdir(), "oncue-placeholder-"));
    try {
      const raw = join(dir, "take.pcm");
      const mp3 = join(dir, "take.mp3");
      const pcm = tones(words);
      writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      ffmpeg(["-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", raw, "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", "-fflags", "+bitexact", mp3]);
      return { audio: readFileSync(mp3), alignment };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

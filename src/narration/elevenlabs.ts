import { OncueError } from "../core/errors.ts";
import type { CharAlignment } from "./alignment.ts";
import type { Voice } from "./voice.ts";

/** Something that turns text into one take with per-character timings. */
export interface SpeechSynthesizer {
  synthesize(text: string, voice: Voice): Promise<{ audio: Buffer; alignment: CharAlignment }>;
}

interface TimestampsResponse {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/** ElevenLabs text-to-speech with timestamps (MP3, 44.1 kHz, 128 kbps). */
export class ElevenLabs implements SpeechSynthesizer {
  readonly #apiKey: string;

  constructor(apiKey: string | undefined) {
    if (!apiKey) throw new OncueError("ELEVENLABS_API_KEY is not set. Add it to .env (never commit it) or the CI secret.");
    this.#apiKey = apiKey;
  }

  async synthesize(text: string, voice: Voice): Promise<{ audio: Buffer; alignment: CharAlignment }> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}/with-timestamps?output_format=mp3_44100_128`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.#apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: voice.model_id, voice_settings: voice.settings }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!r.ok) throw new OncueError(`ElevenLabs: ${r.status} ${r.statusText}: ${(await r.text()).slice(0, 500)}`);
    const j = (await r.json()) as TimestampsResponse;
    const a = j.alignment;
    return {
      audio: Buffer.from(j.audio_base64, "base64"),
      alignment: { characters: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds },
    };
  }
}

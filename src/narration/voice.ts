/**
 * The voice a take is made with. Field names match the narration lock (and ElevenLabs's API), so a
 * lock compares directly against the voice of the current run.
 */
export interface Voice {
  voice_id: string;
  model_id: string;
  settings: Record<string, unknown>;
}

/**
 * The voice for this run: the house voice, unless environment variables override it
 * (<PREFIX>_VOICE_ID, <PREFIX>_MODEL_ID, <PREFIX>_VOICE_SETTINGS as JSON). The overrides are for
 * experiments only; `check` fails a take that doesn't match the house voice.
 */
export function voiceForRun(house: Voice, prefix = "ONCUE", env: NodeJS.ProcessEnv = process.env): Voice {
  const raw = env[`${prefix}_VOICE_SETTINGS`];
  const settings = raw ? (JSON.parse(raw) as Record<string, unknown> | null) : null;
  return {
    voice_id: env[`${prefix}_VOICE_ID`] || house.voice_id,
    model_id: env[`${prefix}_MODEL_ID`] || house.model_id,
    settings: settings || house.settings,
  };
}

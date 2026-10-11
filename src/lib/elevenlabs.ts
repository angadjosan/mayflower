// ElevenLabs speech for iMessage voice notes: transcribe incoming voice memos, voice outgoing replies.
// Docs: POST /v1/speech-to-text (multipart file + model_id), POST /v1/text-to-speech/{voice_id}.

const API = "https://api.elevenlabs.io/v1";

export const elevenEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

const key = () => process.env.ELEVENLABS_API_KEY ?? "";
const STT_MODEL = () => process.env.ELEVENLABS_STT_MODEL || "scribe_v2";
const TTS_MODEL = () => process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2";
// Override with ELEVENLABS_VOICE_ID; list yours with GET /v1/voices.
const VOICE_ID = () => process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ";

/** An ElevenLabs HTTP error; `status` 401/402/429 means the key, plan or quota, not the audio. */
export class ElevenLabsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function fail(what: string, res: Response): Promise<never> {
  throw new ElevenLabsError(`[elevenlabs] ${what} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`, res.status);
}

/** Speech to text. Returns the transcript, trimmed ("" if nothing was said). */
export async function transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  form.append("model_id", STT_MODEL());
  form.append("tag_audio_events", "false");
  const res = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) await fail("speech-to-text", res);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

/** Text to speech. Returns mp3 bytes. */
export async function synthesize(text: string): Promise<Buffer> {
  const res = await fetch(`${API}/text-to-speech/${VOICE_ID()}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL(),
      apply_text_normalization: "auto",
      // speed 1.2 (the max) reads ~22% faster; eleven_v3 ignores speed, so it is not the default.
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true, speed: 1.2 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await fail("text-to-speech", res);
  return Buffer.from(await res.arrayBuffer());
}

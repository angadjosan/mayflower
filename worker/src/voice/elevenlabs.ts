import type { Voice } from '../core/ports.js';

const API = 'https://api.elevenlabs.io/v1';
const STT_MODEL = 'scribe_v2';
const TTS_MODEL = 'eleven_flash_v2_5';
const MAX_TTS_CHARS = 400;

function clip(text: string): string {
  if (text.length <= MAX_TTS_CHARS) return text;
  const cut = text.slice(0, MAX_TTS_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 150 ? cut.slice(0, end + 1) : cut;
}

export class ElevenLabsVoice implements Voice {
  readonly mode = 'elevenlabs' as const;

  constructor(private readonly apiKey: string, private readonly voiceId: string) {}

  async transcribe(audio: Buffer, mime: string): Promise<string> {
    const form = new FormData();
    form.set('model_id', STT_MODEL);
    form.set('file', new Blob([new Uint8Array(audio)], { type: mime }), 'voice-memo');
    const res = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': this.apiKey }, body: form });
    if (!res.ok) throw new Error(`ElevenLabs STT failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { text?: string };
    return (json.text ?? '').trim();
  }

  async speak(text: string): Promise<{ data: Buffer; mime: string; filename: string } | null> {
    const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clip(text), model_id: TTS_MODEL }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg', filename: 'mayflower.mp3' };
  }
}

export class NoVoice implements Voice {
  readonly mode = 'none' as const;

  async transcribe(): Promise<string> {
    throw new Error('voice memos need ELEVENLABS_API_KEY');
  }

  async speak(): Promise<null> {
    return null;
  }
}

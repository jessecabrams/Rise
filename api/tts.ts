import { guard, HttpError, json, need, readBody } from './_lib.js';

interface TtsReq {
  text: string;
  provider: 'openai' | 'elevenlabs';
  voice: string;
  style?: string;
}

export const POST = guard(async (req) => {
  const { text, provider, voice, style } = await readBody<TtsReq>(req, 50_000);
  if (!text || !text.trim()) throw new HttpError(400, 'Nothing to read.');
  if (text.length > 3500) throw new HttpError(400, 'That sentence is too long to voice in one go.');

  if (provider === 'elevenlabs') {
    const key = need('ELEVENLABS_API_KEY');
    const id = encodeURIComponent(voice || 'JBFqnCBsd6RMkjVDRZzb');
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${id}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'
        })
      }
    );
    if (!r.ok) throw new HttpError(502, `ElevenLabs said ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: any = await r.json();
    return json({
      audio: data.audio_base64,
      mime: 'audio/mpeg',
      starts: data.alignment?.character_start_times_seconds || null
    });
  }

  const key = need('OPENAI_API_KEY');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: voice || 'coral',
      input: text,
      instructions: style || undefined,
      response_format: 'mp3'
    })
  });
  if (!r.ok) throw new HttpError(502, `OpenAI voice said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return json({ audio: buf.toString('base64'), mime: 'audio/mpeg', starts: null });
});

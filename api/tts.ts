import { guard, HttpError, json, need, readBody } from './_lib.js';
import { kokoroClip } from './_voice.js';

interface TtsReq {
  text: string;
  /** Several sentences at once (Natural voice only), for fast downloads. */
  texts?: string[];
  provider: 'openai' | 'elevenlabs' | 'kokoro';
  voice: string;
  style?: string;
}

export const POST = guard(async (req) => {
  const { text, texts, provider, voice, style } = await readBody<TtsReq>(req, 80_000);
  if (Array.isArray(texts)) {
    if (provider !== 'kokoro') throw new HttpError(400, 'Batches work with the Natural voice only.');
    const list = texts.slice(0, 16).map((t) => String(t || '').slice(0, 3500));
    const clips: ({ audio: string; mime: string; starts: null } | { error: string })[] = new Array(list.length);
    let next = 0;
    const lane = async () => {
      while (next < list.length) {
        const i = next++;
        try {
          clips[i] = list[i].trim() ? await kokoroClip(list[i], voice) : { audio: '', mime: 'audio/mpeg', starts: null };
        } catch (e: any) {
          clips[i] = { error: e?.message || 'failed' };
          // A problem with the key or balance affects every sentence: stop and say so.
          if (/key|balance/i.test(e?.message || '')) throw e;
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, lane));
    return json({ clips });
  }
  if (!text || !text.trim()) throw new HttpError(400, 'Nothing to read.');
  if (text.length > 3500) throw new HttpError(400, 'That sentence is too long to voice in one go.');

  if (provider === 'kokoro') return json(await kokoroClip(text, voice));

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

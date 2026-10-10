import { guard, HttpError, json, need, readBody } from './_lib.js';

export const POST = guard(async (req) => {
  const { audio, mime } = await readBody<{ audio: string; mime: string }>(req);
  if (!audio) throw new HttpError(400, 'No audio arrived.');
  const key = need('OPENAI_API_KEY');
  const type = (mime || 'audio/webm').split(';')[0];
  const ext = type.includes('mp4') || type.includes('m4a') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';

  const form = new FormData();
  form.append('file', new Blob([Buffer.from(audio, 'base64')], { type }), `answer.${ext}`);
  form.append('model', process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form
  });
  if (!r.ok) throw new HttpError(502, `Transcription said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return json({ text: (data.text || '').trim() });
});

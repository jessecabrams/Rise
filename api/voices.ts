import { guard, json } from './_lib.js';

const OPENAI_VOICES = [
  { id: 'coral', name: 'Coral', desc: 'Warm, bright, friendly' },
  { id: 'sage', name: 'Sage', desc: 'Calm and clear' },
  { id: 'nova', name: 'Nova', desc: 'Upbeat and youthful' },
  { id: 'shimmer', name: 'Shimmer', desc: 'Soft and gentle' },
  { id: 'alloy', name: 'Alloy', desc: 'Balanced, neutral' },
  { id: 'ash', name: 'Ash', desc: 'Grounded, conversational' },
  { id: 'ballad', name: 'Ballad', desc: 'Expressive storyteller' },
  { id: 'echo', name: 'Echo', desc: 'Steady and even' },
  { id: 'fable', name: 'Fable', desc: 'British narrator' },
  { id: 'onyx', name: 'Onyx', desc: 'Deep and resonant' },
  { id: 'verse', name: 'Verse', desc: 'Lively and dynamic' }
];

export const GET = guard(async () => {
  let elevenlabs: { id: string; name: string; desc: string }[] = [];
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
      if (r.ok) {
        const data: any = await r.json();
        elevenlabs = (data.voices || []).map((v: any) => ({
          id: v.voice_id,
          name: v.name,
          desc: Object.values(v.labels || {}).join(', ')
        }));
      }
    } catch {
      /* fall through with an empty list */
    }
  }
  return json({ openai: process.env.OPENAI_API_KEY ? OPENAI_VOICES : [], elevenlabs });
});

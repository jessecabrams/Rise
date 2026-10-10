import { guard, HttpError, json, need, readBody } from './_lib.js';
import { AI_TASKS, buildPrompt, parseJson, type AiTask } from './_prompts.js';

export const POST = guard(async (req) => {
  const { task, payload } = await readBody<{ task: AiTask; payload: any }>(req);
  if (!AI_TASKS.includes(task)) throw new HttpError(400, 'Unknown AI task.');
  const key = need('ANTHROPIC_API_KEY');
  const p = buildPrompt(task, payload || {});
  const model =
    p.tier === 'fast'
      ? process.env.AI_MODEL_FAST || 'claude-haiku-5-5'
      : process.env.AI_MODEL || 'claude-sonnet-5-5';

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: p.maxTokens,
      system: p.system,
      messages: [{ role: 'user', content: p.user }]
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new HttpError(502, `The AI service said ${r.status}: ${t.slice(0, 300)}`);
  }
  const data: any = await r.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return json({ result: parseJson(text) });
});

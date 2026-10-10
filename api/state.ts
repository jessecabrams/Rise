import { guard, HttpError, json, readBody, store } from './_lib.js';

const KEY = 'rise:state';

function db() {
  const r = store();
  if (!r) throw new HttpError(503, 'Sync storage is not connected yet. Add Upstash Redis in your Vercel project.');
  return r;
}

export const GET = guard(async () => {
  const state = await db().get(KEY);
  return json({ state: state ?? null });
});

export const PUT = guard(async (req) => {
  const { state } = await readBody<{ state: any }>(req, 2_000_000);
  if (!state || state.v !== 1) throw new HttpError(400, 'That progress data is not in the right format.');
  await db().set(KEY, state);
  return json({ ok: true });
});

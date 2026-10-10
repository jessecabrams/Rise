import { guard, HttpError, json, readBody, store } from './_lib.js';

const ID = /^[\w-]{6,64}$/;

function db() {
  const r = store();
  if (!r) throw new HttpError(503, 'Sync storage is not connected yet.');
  return r;
}

function idFrom(req: Request): string {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!ID.test(id)) throw new HttpError(400, 'Missing or invalid document id.');
  return id;
}

export const GET = guard(async (req) => {
  const body = await db().get(`rise:doc:${idFrom(req)}`);
  return json({ body: body ?? null });
});

export const PUT = guard(async (req) => {
  const { body } = await readBody<{ body: any }>(req);
  if (!body || !ID.test(body.id || '')) throw new HttpError(400, 'Missing document.');
  await db().set(`rise:doc:${body.id}`, body);
  return json({ ok: true });
});

export const DELETE = guard(async (req) => {
  await db().del(`rise:doc:${idFrom(req)}`);
  return json({ ok: true });
});

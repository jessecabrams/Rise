import { guard, HttpError, json, readBody, store, type Person } from './_lib.js';

const ID = /^[\w-]{6,64}$/;
/** Parts of a piece that belong to one person: their Ask chat and answers waiting for the coach. */
const PERSONAL = ['chat', 'askedQuestions', 'pending', 'reviews'] as const;

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

const mineKey = (me: Person, id: string) => `rise:docp:${me.id}:${id}`;

export const GET = guard(async (req, me) => {
  const id = idFrom(req);
  const [shared, mine] = await Promise.all([db().get<any>(`rise:doc:${id}`), db().get<any>(mineKey(me, id))]);
  if (!shared) return json({ body: null });
  const body = { ...shared };
  if (mine) Object.assign(body, mine);
  else if (!me.owner) for (const k of PERSONAL) delete body[k];
  return json({ body });
});

export const PUT = guard(async (req, me) => {
  const { body } = await readBody<{ body: any }>(req);
  if (!body || !ID.test(body.id || '')) throw new HttpError(400, 'Missing document.');
  const shared = { ...body };
  const mine: Record<string, unknown> = {};
  for (const k of PERSONAL) {
    if (k in shared) mine[k] = shared[k];
    delete shared[k];
  }
  await Promise.all([db().set(`rise:doc:${body.id}`, shared), db().set(mineKey(me, body.id), mine)]);
  return json({ ok: true });
});

export const DELETE = guard(async (req, me) => {
  const id = idFrom(req);
  await db().del(mineKey(me, id));
  const lib = await db().hget<any>('rise:library', id);
  if (me.owner || !lib || lib.by === me.id) await db().del(`rise:doc:${id}`);
  return json({ ok: true });
});

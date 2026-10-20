import { randomInt } from 'node:crypto';
import { codeHash, guard, HttpError, json, readBody, store } from './_lib.js';

const WORDS = 'amber anchor aspen beacon bloom brook canyon cedar comet coral crest dawn ember fern glow harbor horizon juniper lark maple meadow moss nova ocean orchid pebble pine prairie quartz river saffron sage sparrow spruce summit sun tide willow'.split(' ');
const newCode = () => `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${randomInt(1000, 9999)}`;

function db() {
  const r = store();
  if (!r) throw new HttpError(503, 'Sync storage is not connected yet.');
  return r;
}

/** Everyone who can use Rise, for the leaderboard and (for the owner) managing invites. */
export const GET = guard(async (req, me) => {
  const r = db();
  const ids = ((await r.smembers('rise:people')) || []) as string[];
  const people = (await Promise.all(ids.map((id) => r.get<any>(`rise:profile:${id}`)))).filter(Boolean).map((p: any) => ({ id: p.id, name: p.name, createdAt: p.createdAt }));
  if (new URL(req.url).searchParams.has('board')) {
    const boards = await Promise.all(['owner', ...people.map((p) => p.id)].map((id) => r.get<any>(`rise:board:${id}`)));
    return json({ me: me.id, board: boards.filter(Boolean) });
  }
  return json({ me: me.id, owner: me.owner, people });
});

export const POST = guard(async (req, me) => {
  if (!me.owner) throw new HttpError(403, 'Only the owner can invite people.');
  const { name, id: renew } = await readBody<{ name?: string; id?: string }>(req, 2000);
  const r = db();
  const code = newCode();
  if (renew) {
    const p = await r.get<any>(`rise:profile:${renew}`);
    if (!p) throw new HttpError(404, 'That person is not in Rise.');
    if (p.codeHash) await r.del(`rise:invite:${p.codeHash}`);
    p.codeHash = codeHash(code);
    await r.set(`rise:profile:${p.id}`, p);
    await r.set(`rise:invite:${p.codeHash}`, p.id);
    return json({ id: p.id, name: p.name, code });
  }
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new HttpError(400, 'Add a name.');
  const id = `p${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  const p = { id, name: clean, createdAt: Date.now(), codeHash: codeHash(code) };
  await r.set(`rise:profile:${id}`, p);
  await r.set(`rise:invite:${p.codeHash}`, id);
  await r.sadd('rise:people', id);
  return json({ id, name: clean, code });
});

export const DELETE = guard(async (req, me) => {
  if (!me.owner) throw new HttpError(403, 'Only the owner can remove people.');
  const id = new URL(req.url).searchParams.get('id') || '';
  const r = db();
  const p = await r.get<any>(`rise:profile:${id}`);
  if (p?.codeHash) await r.del(`rise:invite:${p.codeHash}`);
  await r.del(`rise:profile:${id}`, `rise:board:${id}`);
  await r.srem('rise:people', id);
  return json({ ok: true });
});

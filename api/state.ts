import { guard, HttpError, json, readBody, store, type Person } from './_lib.js';

/** The owner's progress keeps its original key; each invited person has their own. */
const keyFor = (me: Person) => (me.owner ? 'rise:state' : `rise:state:${me.id}`);
const LIBRARY = 'rise:library';
const LIT = 80;

function db() {
  const r = store();
  if (!r) throw new HttpError(503, 'Sync storage is not connected yet. Add Upstash Redis in your Vercel project.');
  return r;
}

export const GET = guard(async (_req, me) => {
  const r = db();
  const [state, library, removed] = await Promise.all([r.get(keyFor(me)), r.hgetall(LIBRARY), r.hgetall('rise:removed')]);
  return json({ state: state ?? null, library: library ?? {}, removed: removed ?? {} });
});

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The numbers the leaderboard shows, worked out from someone's progress. */
function summary(state: any, me: Person) {
  const docs = Object.values(state.docs || {}) as any[];
  const g = state.game || {};
  const week = new Set<string>();
  for (let k = 0; k < 7; k++) week.add(dayKey(new Date(Date.now() - k * 86_400_000)));
  const weekXp = Object.entries(g.days || {}).reduce((a, [k, v]) => a + (week.has(k) ? Number(v) || 0 : 0), 0);
  return {
    id: me.id,
    name: (state.settings?.name || me.name || (me.owner ? 'Owner' : 'Friend')).slice(0, 40),
    xp: g.xp || 0,
    weekXp,
    streak: g.streak?.current || 0,
    bestStreak: g.streak?.best || 0,
    starsLit: docs.reduce((a, d) => a + Object.values(d.ideas || {}).filter((i: any) => (i?.best || 0) >= LIT).length, 0),
    chaptersRisen: docs.reduce((a, d) => a + Object.keys(d.risen || {}).length, 0),
    booksMastered: docs.filter((d) => d.mastered).length,
    quizzes: docs.reduce((a, d) => a + (d.quiz?.taken || 0), 0),
    minutes: Math.round((g.counters?.secondsListened || 0) / 60),
    at: Date.now()
  };
}

export const PUT = guard(async (req, me) => {
  const { state } = await readBody<{ state: any }>(req, 2_000_000);
  if (!state || state.v !== 1) throw new HttpError(400, 'That progress data is not in the right format.');
  const r = db();
  await r.set(keyFor(me), state);
  // Shared library: every piece anyone adds shows up for everyone.
  const lib = ((await r.hgetall(LIBRARY)) || {}) as Record<string, any>;
  const add: Record<string, any> = {};
  for (const d of Object.values(state.docs || {}) as any[]) {
    if (!d?.id || lib[d.id]) continue;
    add[d.id] = { id: d.id, title: d.title, source: d.source, sourceUrl: d.sourceUrl, createdAt: d.createdAt, wordCount: d.wordCount, sentenceCount: d.sentenceCount, by: me.id };
  }
  if (Object.keys(add).length) await r.hset(LIBRARY, add);
  // Removing a piece you added removes it for everyone.
  for (const id of Object.keys(state.deleted || {})) {
    const entry = lib[id];
    if (entry && (entry.by === me.id || me.owner) && !state.docs?.[id]) {
      await r.hdel(LIBRARY, id);
      await r.hset('rise:removed', { [id]: Date.now() });
    }
  }
  await r.set(`rise:board:${me.id}`, summary(state, me));
  return json({ ok: true });
});

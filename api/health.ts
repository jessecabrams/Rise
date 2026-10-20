import { authorized, features, json, store } from './_lib.js';

export async function GET(req: Request): Promise<Response> {
  // Recent crash notes (only step names and sizes, nothing from your books), for troubleshooting.
  if (new URL(req.url).searchParams.has('crashes')) {
    const list = (await store()?.lrange('rise:crashes', 0, 9)) || [];
    return json({ crashes: list });
  }
  return json({
    ok: true,
    app: 'rise',
    passcode: !!process.env.APP_PASSCODE,
    authed: authorized(req),
    features: features()
  });
}

/** Crash reports from the app: written to the server log so problems on a phone can be traced. */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ ok: false }, 401);
  const text = (await req.text()).slice(0, 20_000);
  console.log('[rise-crash]', text);
  try {
    const r = store();
    if (r) {
      await r.lpush('rise:crashes', `${new Date().toISOString()} ${text}`);
      await r.ltrim('rise:crashes', 0, 19);
    }
  } catch {
    /* logging only */
  }
  return json({ ok: true });
}

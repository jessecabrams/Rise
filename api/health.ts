import { authorized, features, json } from './_lib.js';

export async function GET(req: Request): Promise<Response> {
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
  return json({ ok: true });
}

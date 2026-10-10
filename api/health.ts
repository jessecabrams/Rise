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

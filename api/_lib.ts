import { createHash, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export interface Person {
  id: string;
  name: string;
  owner: boolean;
}

export const OWNER: Person = { id: 'owner', name: '', owner: true };
export const codeHash = (code: string) => createHash('sha256').update(code.trim().toLowerCase()).digest('hex');

/** Who is calling: the owner (main passcode) or someone with an invite code. Null if neither. */
export async function who(req: Request): Promise<Person | null> {
  const need = process.env.APP_PASSCODE;
  const key = (req.headers.get('x-rise-key') || '').trim();
  if (!need) return OWNER;
  if (key && safeEqual(key, need)) return OWNER;
  if (!key) return null;
  const r = store();
  if (!r) return null;
  try {
    const id = await r.get<string>(`rise:invite:${codeHash(key)}`);
    if (!id) return null;
    const p = await r.get<{ id: string; name: string }>(`rise:profile:${id}`);
    return p ? { id: p.id, name: p.name, owner: false } : null;
  } catch {
    return null;
  }
}

/** Kept for simple checks: true for the owner or any invited person. */
export async function authorized(req: Request): Promise<boolean> {
  return !!(await who(req));
}

let redis: Redis | null | undefined;
export function store(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

export function features() {
  return {
    ai: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    kokoro: !!process.env.DEEPINFRA_API_KEY,
    storage: !!store()
  };
}

export async function readBody<T>(req: Request, max = 4_500_000): Promise<T> {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'That is too large to send in one go.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.');
  }
}

export function guard(fn: (req: Request, me: Person) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const me = await who(req);
      if (!me) return json({ error: 'Enter your passcode to continue.' }, 401);
      return await fn(req, me);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e?.message || 'Something went wrong on the server.' }, status);
    }
  };
}

export function need(name: string): string {
  // Pasted keys sometimes carry spaces, quotes or a line break.
  const v = (process.env[name] || '').trim().replace(/^["']|["']$/g, '');
  if (!v) throw new HttpError(503, `${name} is not set in your Vercel project settings.`);
  return v;
}

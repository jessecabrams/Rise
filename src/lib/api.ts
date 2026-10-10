import { useSyncExternalStore } from 'react';

export interface Features {
  ai: boolean;
  openai: boolean;
  elevenlabs: boolean;
  storage: boolean;
}

interface ServerState {
  checked: boolean;
  reachable: boolean;
  passcode: boolean;
  authed: boolean;
  features: Features;
}

const KEY = 'rise-key';
let snapshot: ServerState = {
  checked: false,
  reachable: false,
  passcode: false,
  authed: false,
  features: { ai: false, openai: false, elevenlabs: false, storage: false }
};
const subs = new Set<() => void>();
function set(patch: Partial<ServerState>) {
  snapshot = { ...snapshot, ...patch };
  subs.forEach((f) => f());
}

export const server = {
  get state() {
    return snapshot;
  },
  /** True when the server is up and we are allowed to call it. */
  ok(): boolean {
    return snapshot.reachable && (!snapshot.passcode || snapshot.authed);
  },
  has(f: keyof Features): boolean {
    return server.ok() && snapshot.features[f];
  },
  async probe(): Promise<ServerState> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('/api/health', { headers: { 'x-rise-key': getKey() }, signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json();
      if (!r.ok || data.app !== 'rise') throw new Error('not rise');
      set({ checked: true, reachable: true, passcode: !!data.passcode, authed: !!data.authed, features: data.features });
    } catch {
      set({ checked: true, reachable: false });
    }
    return snapshot;
  }
};

export function useServer(): ServerState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snapshot
  );
}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setKey(k: string) {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* storage blocked */
  }
}

export class AuthError extends Error {}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-rise-key': getKey() },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal
  });
  if (r.status === 401) {
    set({ authed: false });
    throw new AuthError('Enter your passcode to continue.');
  }
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status}).`);
  return data as T;
}

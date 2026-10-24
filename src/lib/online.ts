import { useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    online = true;
    subs.forEach((f) => f());
  });
  window.addEventListener('offline', () => {
    online = false;
    subs.forEach((f) => f());
  });
}

export function isOnline(): boolean {
  return online;
}

/** Call when a request fails at the network level, so the app switches to offline behavior right away. */
export function noteNetworkFailure() {
  if (typeof navigator !== 'undefined' && !navigator.onLine && online) {
    online = false;
    subs.forEach((f) => f());
  }
}

export function onOnline(fn: () => void): () => void {
  const h = () => fn();
  window.addEventListener('online', h);
  return () => window.removeEventListener('online', h);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => online
  );
}

/** True for fetch failures caused by no connection, not by a server error. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e as any)?.name === 'AbortError' || /Failed to fetch|NetworkError|Load failed|network/i.test(String((e as any)?.message || ''));
}

/** Ask the browser not to clear downloaded material when space runs low. */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage || 0, quota: e.quota || 0 } : null;
  } catch {
    return null;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/** Keeps the screen on during a long download. iPhones pause web pages when the screen locks. */
export async function holdAwake(): Promise<() => void> {
  let lock: any = null;
  const take = async () => {
    try {
      lock = await (navigator as any).wakeLock?.request?.('screen');
    } catch {
      lock = null;
    }
  };
  await take();
  // The lock is dropped whenever the page is hidden; take it again when you come back.
  const onVis = () => document.visibilityState === 'visible' && take();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    try {
      lock?.release?.();
    } catch {
      /* already released */
    }
  };
}

/** Resolves once the page is on screen again (downloads wait instead of failing while the phone is locked). */
export function whenVisible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((res) => {
    const on = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', on);
        res();
      }
    };
    document.addEventListener('visibilitychange', on);
  });
}

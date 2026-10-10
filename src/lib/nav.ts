import { useSyncExternalStore } from 'react';
import type { QuizFocus } from './types';

export type DocTab = 'listen' | 'learn' | 'map' | 'quiz' | 'ask';
export type View =
  | { name: 'library' }
  | { name: 'doc'; id: string; tab: DocTab; focus?: QuizFocus; nonce?: number }
  | { name: 'progress' }
  | { name: 'settings' };

let view: View = { name: 'library' };
const subs = new Set<() => void>();

export function go(v: View) {
  view = v.name === 'doc' && v.focus ? { ...v, nonce: Date.now() } : v;
  subs.forEach((f) => f());
  try {
    document.querySelector('main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
}

export function useView(): View {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => view
  );
}

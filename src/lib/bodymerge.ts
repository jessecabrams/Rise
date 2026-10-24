/**
 * Two people share each book's learning material (idea maps, practice questions, learning guides).
 * When either saves, merge with what's already stored instead of overwriting the other person's work.
 * (A copy of this lives in api/_merge.ts for the server.)
 */
export function mergeShared(old: any, incoming: any): any {
  if (!old) return incoming;
  if (!incoming) return old;
  const out: any = { ...old, ...incoming };
  out.text = incoming.text || old.text;
  const map: Record<string, any> = { ...(old.map || {}) };
  for (const [k, cm] of Object.entries<any>(incoming.map || {})) if (!map[k] || (cm?.builtAt || 0) >= (map[k]?.builtAt || 0)) map[k] = cm;
  out.map = map;
  const bank: Record<string, any> = { ...(old.bank || {}) };
  for (const [k, qs] of Object.entries<any>(incoming.bank || {})) if (Array.isArray(qs) && qs.length) bank[k] = qs;
  out.bank = bank;
  const lessons = new Map<string, any>();
  for (const l of [...(old.lessons || []), ...(incoming.lessons || [])]) if (l?.id) lessons.set(l.id, l);
  // One guide per chapter: keep the newest.
  const bySection = new Map<number, any>();
  for (const l of lessons.values()) {
    const cur = bySection.get(l.sectionIndex);
    if (!cur || (l.createdAt || 0) >= (cur.createdAt || 0)) bySection.set(l.sectionIndex, l);
  }
  out.lessons = [...bySection.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return out;
}

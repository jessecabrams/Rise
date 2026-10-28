import { crumb } from './crumbs';
import { mergeShared } from './bodymerge';
import { useSyncExternalStore } from 'react';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { AppState, DocBody, DocMeta, GameState, Settings, SourceKind } from './types';
import { api, server } from './api';
import { countWords, forget, normalize, structure, uid } from './text';
import { SAMPLE_TEXT, SAMPLE_TITLE } from './sample';

export const defaultSettings: Settings = {
  name: 'Jesse',
  provider: 'device',
  deviceVoice: '',
  openaiVoice: 'coral',
  elevenVoice: '',
  neuralVoice: 'af_heart',
  naturalWhere: 'cloud',
  voiceStyle: 'Warm, clear and encouraging, like a great coach reading aloud.',
  rate: 1.15,
  theme: 'auto',
  readingFont: 'atkinson',
  fontSize: 20,
  lineHeight: 1.7,
  autoScroll: true,
  wordHighlight: true,
  focusMode: false,
  sounds: true,
  celebrations: true,
  dailyGoalMin: 10,
  quizCount: 5,
  quizFocus: 'mix',
  answerMode: 'voice',
  readQuestions: true,
  handsFree: false
};

export function freshGame(): GameState {
  return {
    xp: 0,
    counters: {},
    achievements: {},
    streak: { current: 0, best: 0, lastDay: '' },
    daily: { day: '', progress: {}, done: false },
    log: []
  };
}

function freshState(): AppState {
  return { v: 1, updatedAt: 0, settings: { ...defaultSettings }, game: freshGame(), docs: {}, deleted: {} };
}

function migrate(s: any): AppState {
  const base = freshState();
  return {
    ...base,
    ...s,
    settings: { ...base.settings, ...(s?.settings || {}) },
    game: { ...base.game, ...(s?.game || {}) },
    docs: s?.docs || {},
    deleted: s?.deleted || {}
  };
}

/* ---------- local persistence (IndexedDB with an in-memory fallback) ---------- */
const mem = new Map<string, unknown>();
async function kvGet<T>(k: string): Promise<T | undefined> {
  try {
    const v = await idbGet(k);
    if (v !== undefined) return v as T;
  } catch {
    /* blocked storage */
  }
  return mem.get(k) as T | undefined;
}
async function kvSet(k: string, v: unknown) {
  mem.set(k, v);
  try {
    await idbSet(k, v);
  } catch {
    /* blocked storage */
  }
}
async function kvDel(k: string) {
  mem.delete(k);
  try {
    await idbDel(k);
  } catch {
    /* blocked storage */
  }
}

/* ---------- reactive store ---------- */
let state: AppState = freshState();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function getState(): AppState {
  return state;
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => select(state)
  );
}

export function update(fn: (draft: AppState) => void) {
  const next = structuredClone(state);
  fn(next);
  next.updatedAt = Date.now();
  state = next;
  emit();
  scheduleSave();
}

export function setSettings(patch: Partial<Settings>) {
  update((s) => Object.assign(s.settings, patch));
}

/* ---------- sync ---------- */
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';
let syncStatus: SyncStatus = 'local';
const syncSubs = new Set<() => void>();
function setSync(s: SyncStatus) {
  syncStatus = s;
  syncSubs.forEach((f) => f());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (f) => {
      syncSubs.add(f);
      return () => syncSubs.delete(f);
    },
    () => syncStatus
  );
}

const canSync = () => server.has('storage');

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 3000);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  await kvSet('rise:state', state);
  if (!canSync()) return;
  try {
    setSync('syncing');
    await api('/api/state', { method: 'PUT', body: { state } });
    setSync('synced');
  } catch {
    setSync('error');
  }
}

export function mergeState(a: AppState, b: AppState): AppState {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const deleted: Record<string, number> = { ...a.deleted };
  for (const [k, v] of Object.entries(b.deleted)) deleted[k] = Math.max(deleted[k] || 0, v);

  const docs: Record<string, DocMeta> = {};
  for (const d of [...Object.values(a.docs), ...Object.values(b.docs)]) {
    if (!docs[d.id] || d.updatedAt > docs[d.id].updatedAt) docs[d.id] = d;
  }
  for (const [id, at] of Object.entries(deleted)) if (docs[id] && docs[id].updatedAt <= at) delete docs[id];

  const ga = a.game;
  const gb = b.game;
  const counters: Record<string, number> = { ...ga.counters };
  for (const [k, v] of Object.entries(gb.counters)) counters[k] = Math.max(counters[k] || 0, v);
  const achievements: Record<string, number> = { ...ga.achievements };
  for (const [k, v] of Object.entries(gb.achievements)) achievements[k] = Math.min(achievements[k] || v, v);
  const streak = ga.streak.lastDay >= gb.streak.lastDay ? { ...ga.streak } : { ...gb.streak };
  streak.best = Math.max(ga.streak.best, gb.streak.best);
  let daily = ga.daily.day >= gb.daily.day ? ga.daily : gb.daily;
  if (ga.daily.day === gb.daily.day) {
    const progress = { ...ga.daily.progress };
    for (const [k, v] of Object.entries(gb.daily.progress)) progress[k] = Math.max(progress[k] || 0, v);
    daily = { day: ga.daily.day, progress, done: ga.daily.done || gb.daily.done };
  }
  const days: Record<string, number> = { ...(ga.days || {}) };
  for (const [k, v] of Object.entries(gb.days || {})) days[k] = Math.max(days[k] || 0, v);
  const game: GameState = {
    days,
    xp: Math.max(ga.xp, gb.xp),
    counters,
    achievements,
    streak,
    daily,
    log: newer.game.log
  };
  return { ...newer, docs, deleted, game, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
}

export async function pull() {
  if (!canSync()) {
    setSync('local');
    return;
  }
  try {
    setSync('syncing');
    const r = await api<{ state: AppState | null; library?: Record<string, any>; removed?: Record<string, number> }>('/api/state');
    if (r.state) {
      state = mergeState(state, migrate(r.state));
      emit();
    }
    // The shared library: pieces the other person added appear here too, with your own fresh progress.
    let added = false;
    for (const d of Object.values(r.library || {})) {
      if (!d?.id || state.docs[d.id] || state.deleted[d.id]) continue;
      state.docs[d.id] = {
        id: d.id,
        title: d.title || 'Untitled',
        source: d.source || 'paste',
        sourceUrl: d.sourceUrl,
        createdAt: d.createdAt || Date.now(),
        updatedAt: Date.now(),
        wordCount: d.wordCount || 0,
        sentenceCount: d.sentenceCount || 0,
        position: 0,
        furthest: 0,
        quiz: { taken: 0, answered: 0, totalScore: 0, best: 0 },
        lessonCount: 0
      };
      added = true;
    }
    // A shared piece the other person removed: hide it here too.
    for (const [id, at] of Object.entries(r.removed || {})) {
      const d = state.docs[id];
      if (d && Number(at) > d.createdAt) {
        delete state.docs[id];
        state.deleted[id] = Number(at);
        added = true;
      }
    }
    if (added) {
      state = { ...state, updatedAt: Date.now() };
      emit();
    }
    await saveNow();
  } catch {
    setSync('error');
  }
}

/**
 * Progress on this device belongs to one person. If someone else signs in here (for example, with an
 * invite code), start them fresh instead of mixing in the other person's progress. Downloaded books stay.
 */
export async function claimProfile() {
  const p = server.state.profile;
  if (!p || !server.state.authed) return;
  const theirs = (s: Settings): Settings => ({ ...s, name: p.name, provider: server.has('kokoro') ? 'neural' : s.provider });
  if (!state.profile) {
    state = { ...state, profile: p.id };
    // A new person on this device: use their name, and the Natural voice when it's available.
    if (!p.owner && (!state.settings.name || state.settings.name === defaultSettings.name)) state.settings = theirs(state.settings);
    emit();
    await kvSet('rise:state', state);
    return;
  }
  if (state.profile === p.id) return;
  const fresh = freshState();
  state = { ...fresh, profile: p.id, settings: p.owner ? fresh.settings : theirs(fresh.settings), updatedAt: Date.now() };
  emit();
  await kvSet('rise:state', state);
}

export async function boot() {
  crumb('boot');
  const local = await kvGet<AppState>('rise:state');
  crumb(`boot: ${local ? Object.keys(local.docs || {}).length + ' pieces' : 'fresh'}`);
  if (local && local.v === 1) {
    state = migrate(local);
    emit();
  }
  await server.probe();
  await claimProfile();
  if (canSync()) await pull();
  const oldSample = state.docs['sample'] && !state.docs['sample'].ideaTotal && !state.docs['sample'].quiz.taken && state.docs['sample'].wordCount !== countWords(SAMPLE_TEXT);
  if ((!Object.keys(state.docs).length && !state.deleted['sample']) || oldSample) {
    await addDoc({ title: SAMPLE_TITLE, text: SAMPLE_TEXT, source: 'sample' }, 'sample');
  }
}

/* ---------- documents ---------- */
export async function getBody(id: string): Promise<DocBody | null> {
  crumb(`open piece`);
  let b = await kvGet<DocBody>(`rise:doc:${id}`);
  crumb(`piece loaded: ${b ? Math.round((b.text || '').length / 1024) + ' KB text, ' + Math.round(JSON.stringify(b).length / 1024) + ' KB total' : 'not on device'}`);
  if (!b && canSync()) {
    try {
      const r = await api<{ body: DocBody | null }>(`/api/doc?id=${encodeURIComponent(id)}`);
      if (r.body) {
        b = r.body;
        await kvSet(`rise:doc:${id}`, b);
      }
    } catch {
      /* offline */
    }
  }
  else if (b && canSync()) refreshBody(id, b);
  if (b) b = { ...b, lessons: b.lessons || [], chat: b.chat || [] };
  return b ?? null;
}

const refreshed = new Map<string, number>();
/** Picks up idea maps, questions and guides the other person made since this device last looked. */
function refreshBody(id: string, local: DocBody) {
  if (Date.now() - (refreshed.get(id) || 0) < 30_000) return;
  refreshed.set(id, Date.now());
  crumb('checking for shared updates');
  api<{ body: DocBody | null }>(`/api/doc?id=${encodeURIComponent(id)}`)
    .then(async (r) => {
      if (!r.body) return;
      const merged = mergeShared(r.body, local) as DocBody;
      // Your own chat: keep whichever copy has more.
      if ((r.body.chat?.length || 0) > (local.chat?.length || 0)) merged.chat = r.body.chat;
      if (JSON.stringify(merged) === JSON.stringify(local)) return crumb('shared: no changes');
      crumb('shared: saving updates');
      await kvSet(`rise:doc:${id}`, merged);
      window.dispatchEvent(new CustomEvent('rise-body', { detail: id }));
    })
    .catch(() => {});
}

export async function saveBody(b: DocBody) {
  await kvSet(`rise:doc:${b.id}`, b);
  if (canSync()) api('/api/doc', { method: 'PUT', body: { body: b } }).catch(() => setSync('error'));
}

export async function addDoc(
  input: { title: string; text: string; source: SourceKind; sourceUrl?: string },
  fixedId?: string
): Promise<string> {
  const id = fixedId || uid();
  const text = normalize(input.text);
  forget(id);
  const s = structure(text, id);
  const now = Date.now();
  const meta: DocMeta = {
    id,
    title: input.title.trim() || 'Untitled',
    source: input.source,
    sourceUrl: input.sourceUrl,
    createdAt: now,
    updatedAt: now,
    wordCount: countWords(text),
    sentenceCount: s.sentences.length,
    position: 0,
    furthest: 0,
    quiz: { taken: 0, answered: 0, totalScore: 0, best: 0 },
    lessonCount: 0
  };
  await saveBody({ id, text, lessons: [], chat: [] });
  update((st) => {
    st.docs[id] = meta;
    delete st.deleted[id];
  });
  return id;
}

export function patchDoc(id: string, fn: (d: DocMeta) => void) {
  update((s) => {
    const d = s.docs[id];
    if (!d) return;
    fn(d);
    d.updatedAt = Date.now();
  });
}

export async function removeDoc(id: string) {
  update((s) => {
    delete s.docs[id];
    s.deleted[id] = Date.now();
  });
  forget(id);
  await kvDel(`rise:doc:${id}`);
  if (canSync()) api(`/api/doc?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

/* ---------- backup ---------- */
export async function exportAll(): Promise<string> {
  const bodies: DocBody[] = [];
  for (const id of Object.keys(state.docs)) {
    const b = await getBody(id);
    if (b) bodies.push(b);
  }
  return JSON.stringify({ app: 'rise', exportedAt: new Date().toISOString(), state, bodies }, null, 2);
}

export async function importAll(json: string) {
  const data = JSON.parse(json);
  if (data.app !== 'rise' || !data.state) throw new Error('That file is not a Rise backup.');
  for (const b of data.bodies || []) await saveBody(b);
  state = mergeState(state, migrate(data.state));
  emit();
  await saveNow();
}

export async function resetProgress() {
  update((s) => {
    s.game = freshGame();
  });
  await saveNow();
}

import type { GameState, Settings } from './types';
import { getState, update } from './store';

/* ---------- levels ---------- */
export const LEVEL_TITLES = [
  'Night Sky',
  'First Light',
  'Dawn Chorus',
  'Daybreak',
  'Sunrise',
  'Morning Glow',
  'Bright Spark',
  'Golden Hour',
  'Full Sun',
  'High Noon',
  'Solar Flare',
  'Sunstorm',
  'Supernova',
  'Constellation',
  'Galaxy Brain'
];

export const xpForLevel = (level: number) => 75 * (level - 1) * level;

export function levelInfo(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    into: xp - base,
    span: next - base,
    pct: (xp - base) / (next - base),
    toNext: next - xp
  };
}

/* ---------- badges ---------- */
export type Tier = 'common' | 'rare' | 'epic' | 'legendary';
export interface Badge {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tier: Tier;
  goal?: [counter: string, target: number];
  test?: (g: GameState, level: number) => boolean;
}

const TIER_XP: Record<Tier, number> = { common: 15, rare: 40, epic: 100, legendary: 250 };

export const BADGES: Badge[] = [
  { id: 'first-listen', name: 'First Light', desc: 'Listen to your first few sentences.', icon: 'headphones', tier: 'common', goal: ['sentencesHeard', 5] },
  { id: 'tuned-in', name: 'Tuned In', desc: 'Listen for 30 minutes total.', icon: 'headphones', tier: 'rare', goal: ['secondsListened', 1800] },
  { id: 'audiophile', name: 'Audiophile', desc: 'Listen for 5 hours total.', icon: 'headphones', tier: 'epic', goal: ['secondsListened', 18000] },
  { id: 'bookworm', name: 'Bookworm Supreme', desc: 'Hear 100,000 words.', icon: 'book', tier: 'legendary', goal: ['wordsHeard', 100000] },
  { id: 'speed-demon', name: 'Speed Demon', desc: 'Listen 10 minutes at 2x or faster.', icon: 'bolt', tier: 'rare', goal: ['fastSeconds', 600] },
  { id: 'collector', name: 'Collector', desc: 'Add something to your library.', icon: 'plus', tier: 'common', goal: ['docsAdded', 1] },
  { id: 'librarian', name: 'Librarian', desc: 'Add 10 things to your library.', icon: 'layers', tier: 'rare', goal: ['docsAdded', 10] },
  { id: 'pop-quiz', name: 'Pop Quiz', desc: 'Finish your first quiz.', icon: 'target', tier: 'common', goal: ['quizzesTaken', 1] },
  { id: 'quiz-machine', name: 'Quiz Machine', desc: 'Finish 10 quizzes.', icon: 'target', tier: 'epic', goal: ['quizzesTaken', 10] },
  { id: 'say-it', name: 'Say It Loud', desc: 'Answer a question out loud.', icon: 'mic', tier: 'common', goal: ['spokenAnswers', 1] },
  { id: 'voice-of-reason', name: 'Voice of Reason', desc: 'Give 25 spoken answers.', icon: 'mic', tier: 'rare', goal: ['spokenAnswers', 25] },
  { id: 'podcast-ready', name: 'Podcast Ready', desc: 'Give 100 spoken answers.', icon: 'mic', tier: 'legendary', goal: ['spokenAnswers', 100] },
  { id: 'nailed-it', name: 'Nailed It', desc: 'Score 90 or higher on an answer.', icon: 'star', tier: 'common', goal: ['perfectAnswers', 1] },
  { id: 'deep-understanding', name: 'Deep Understanding', desc: 'Score 90 or higher 10 times.', icon: 'brain', tier: 'epic', goal: ['perfectAnswers', 10] },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Retry a missed question and score 80+.', icon: 'refresh', tier: 'rare', goal: ['comebacks', 1] },
  { id: 'lightbulb', name: 'Lightbulb', desc: 'Build your first learning guide.', icon: 'spark', tier: 'common', goal: ['lessonsBuilt', 1] },
  { id: 'hands-on', name: 'Hands On', desc: 'Finish a deep-dive exercise.', icon: 'pen', tier: 'common', goal: ['exercisesDone', 1] },
  { id: 'deep-diver', name: 'Deep Diver', desc: 'Finish 10 deep-dive exercises.', icon: 'dive', tier: 'epic', goal: ['exercisesDone', 10] },
  { id: 'the-teacher', name: 'The Teacher', desc: 'Complete a teach-back exercise.', icon: 'chat', tier: 'rare', goal: ['teachBacks', 1] },
  { id: 'flashcard-flow', name: 'Card Shark', desc: 'Review 50 flashcards.', icon: 'cards', tier: 'rare', goal: ['flashcardsReviewed', 50] },
  { id: 'curious', name: 'Curious Mind', desc: 'Ask your material 10 questions.', icon: 'question', tier: 'rare', goal: ['askQuestions', 10] },
  { id: 'kindling', name: 'Kindling', desc: 'Learn 3 days in a row.', icon: 'flame', tier: 'common', test: (g) => g.streak.best >= 3 },
  { id: 'on-fire', name: 'On Fire', desc: 'Learn 7 days in a row.', icon: 'flame', tier: 'rare', test: (g) => g.streak.best >= 7 },
  { id: 'unstoppable', name: 'Unstoppable', desc: 'Learn 30 days in a row.', icon: 'flame', tier: 'legendary', test: (g) => g.streak.best >= 30 },
  { id: 'questing', name: 'Questing', desc: 'Complete 7 daily quests.', icon: 'flag', tier: 'epic', goal: ['questsDone', 7] },
  { id: 'early-riser', name: 'Early Riser', desc: 'Learn something before 7am.', icon: 'sun', tier: 'rare', goal: ['earlyBird', 1] },
  { id: 'night-owl', name: 'Night Owl', desc: 'Learn something after 11pm.', icon: 'moon', tier: 'rare', goal: ['nightOwl', 1] },
  { id: 'cartographer', name: 'Cartographer', desc: 'Map the ideas in 5 chapters.', icon: 'map', tier: 'common', goal: ['chaptersMapped', 5] },
  { id: 'first-star', name: 'First Star', desc: 'Light your first idea star.', icon: 'star', tier: 'common', goal: ['ideasLit', 1] },
  { id: 'star-gazer', name: 'Star Gazer', desc: 'Light 25 idea stars.', icon: 'star', tier: 'rare', goal: ['ideasLit', 25] },
  { id: 'galaxy', name: 'Galaxy', desc: 'Light 100 idea stars.', icon: 'star', tier: 'legendary', goal: ['ideasLit', 100] },
  { id: 'chapter-sunrise', name: 'Chapter Sunrise', desc: 'Raise the sun on a chapter.', icon: 'sun', tier: 'rare', goal: ['chaptersRisen', 1] },
  { id: 'ten-suns', name: 'Ten Suns', desc: 'Raise the sun on 10 chapters.', icon: 'sun', tier: 'epic', goal: ['chaptersRisen', 10] },
  { id: 'whole-sky', name: 'Whole Sky', desc: 'Master every chapter of a piece.', icon: 'trophy', tier: 'epic', goal: ['booksMastered', 1] },
  { id: 'keeper', name: 'Keeper of the Flame', desc: 'Revive 5 fading stars.', icon: 'flame', tier: 'rare', goal: ['fadingRevived', 5] },
  { id: 'sunrise', name: 'Sunrise', desc: 'Reach level 5.', icon: 'sun', tier: 'rare', test: (_g, l) => l >= 5 },
  { id: 'solar-flare', name: 'Solar Flare', desc: 'Reach level 10.', icon: 'sun', tier: 'legendary', test: (_g, l) => l >= 10 }
];

export function badgeProgress(b: Badge, g: GameState): [number, number] | null {
  if (!b.goal) return null;
  const [k, target] = b.goal;
  return [Math.min(g.counters[k] || 0, target), target];
}

function earned(b: Badge, g: GameState, level: number): boolean {
  if (b.goal) return (g.counters[b.goal[0]] || 0) >= b.goal[1];
  return !!b.test?.(g, level);
}

/* ---------- daily quests ---------- */
export interface Quest {
  id: string;
  label: string;
  counter: string;
  target: number;
  format?: (n: number) => string;
}

export function dayKey(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function questsFor(day: string, s: Settings): Quest[] {
  const pool: Quest[] = [
    { id: 'answer', label: 'Answer 3 quiz questions', counter: 'questionsAnswered', target: 3 },
    { id: 'voice', label: 'Answer 2 questions out loud', counter: 'spokenAnswers', target: 2 },
    { id: 'exercise', label: 'Finish a deep-dive exercise', counter: 'exercisesDone', target: 1 },
    { id: 'cards', label: 'Review 8 flashcards', counter: 'flashcardsReviewed', target: 8 },
    { id: 'ask', label: 'Ask your material a question', counter: 'askQuestions', target: 1 },
    { id: 'nail', label: 'Score 90+ on one answer', counter: 'perfectAnswers', target: 1 },
    { id: 'star', label: 'Light a new idea star', counter: 'ideasLit', target: 1 },
    { id: 'idea', label: 'Quiz yourself on one idea', counter: 'ideaQuizzes', target: 1 }
  ];
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = pool[h % pool.length];
  const rest = pool.filter((q) => q !== a);
  const b = rest[(h >> 4) % rest.length];
  return [
    {
      id: 'listen',
      label: `Listen for ${s.dailyGoalMin} minutes`,
      counter: 'secondsListened',
      target: s.dailyGoalMin * 60,
      format: (n) => `${Math.floor(n / 60)} of ${s.dailyGoalMin} min`
    },
    a,
    b
  ];
}

/* ---------- celebrations ---------- */
export type Celebration =
  | { kind: 'xp'; amount: number; label: string }
  | { kind: 'badge'; badge: Badge }
  | { kind: 'level'; level: number; title: string }
  | { kind: 'quest' }
  | { kind: 'streak'; days: number }
  | { kind: 'star'; title: string }
  | { kind: 'risen'; title: string; chapter: number }
  | { kind: 'book'; title: string }
  | { kind: 'note'; text: string };

const csubs = new Set<(c: Celebration) => void>();
export function celebrate(c: Celebration) {
  csubs.forEach((f) => f(c));
}
export function onCelebrate(fn: (c: Celebration) => void) {
  csubs.add(fn);
  return () => {
    csubs.delete(fn);
  };
}

/** Adds XP and counters, updates streaks, quests, badges and levels, then fires celebrations. */
export function award(label: string, xp: number, counters: Record<string, number> = {}, opts: { quiet?: boolean } = {}) {
  const events: Celebration[] = [];
  let gained = xp;
  update((s) => {
    const g = s.game;
    const today = dayKey();
    if (g.streak.lastDay !== today) {
      const yesterday = dayKey(Date.now() - 86_400_000);
      g.streak.current = g.streak.lastDay === yesterday ? g.streak.current + 1 : 1;
      g.streak.lastDay = today;
      g.streak.best = Math.max(g.streak.best, g.streak.current);
      if (g.streak.current > 1) {
        gained += 15;
        events.push({ kind: 'streak', days: g.streak.current });
      }
    }
    if (g.daily.day !== today) g.daily = { day: today, progress: {}, done: false };
    const before = levelInfo(g.xp).level;
    g.xp += gained;
    for (const [k, v] of Object.entries(counters)) {
      g.counters[k] = (g.counters[k] || 0) + v;
      g.daily.progress[k] = (g.daily.progress[k] || 0) + v;
    }
    const hour = new Date().getHours();
    if (hour < 7) g.counters.earlyBird = 1;
    if (hour >= 23) g.counters.nightOwl = 1;

    if (!g.daily.done && questsFor(today, s.settings).every((q) => (g.daily.progress[q.counter] || 0) >= q.target)) {
      g.daily.done = true;
      g.xp += 50;
      g.counters.questsDone = (g.counters.questsDone || 0) + 1;
      events.push({ kind: 'quest' });
    }
    for (let pass = 0; pass < 3; pass++) {
      const lvl = levelInfo(g.xp).level;
      let changed = false;
      for (const b of BADGES) {
        if (!g.achievements[b.id] && earned(b, g, lvl)) {
          g.achievements[b.id] = Date.now();
          g.xp += TIER_XP[b.tier];
          events.push({ kind: 'badge', badge: b });
          changed = true;
        }
      }
      if (!changed) break;
    }
    const after = levelInfo(g.xp);
    if (after.level > before) events.push({ kind: 'level', level: after.level, title: after.title });
    if (!opts.quiet && xp > 0) {
      g.log.unshift({ at: Date.now(), xp, label });
      g.log = g.log.slice(0, 40);
    }
  });
  if (!opts.quiet && xp > 0) csubs.forEach((f) => f({ kind: 'xp', amount: xp, label }));
  events.forEach((e) => csubs.forEach((f) => f(e)));
}

/* ---------- sounds ---------- */
let ctx: AudioContext | null = null;
export function chime(kind: 'xp' | 'badge' | 'level' | 'tap') {
  if (!getState().settings.sounds) return;
  try {
    ctx ||= new AudioContext();
    const notes = { tap: [880], xp: [660, 990], badge: [523, 659, 784, 1047], level: [392, 523, 659, 784, 1047, 1319] }[kind];
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = t0 + i * 0.07;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {
    /* audio blocked */
  }
}

/** XP for one quiz answer. */
export function answerXp(score: number, spoken: boolean): number {
  return 5 + Math.round(score / 10) + (spoken ? 5 : 0) + (score >= 90 ? 10 : 0);
}

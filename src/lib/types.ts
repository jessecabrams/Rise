export type SourceKind = 'paste' | 'pdf' | 'epub' | 'docx' | 'text' | 'web' | 'gdoc' | 'sample';

export interface DocMeta {
  id: string;
  title: string;
  source: SourceKind;
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  wordCount: number;
  sentenceCount: number;
  position: number;
  furthest: number;
  quiz: { taken: number; answered: number; totalScore: number; best: number };
  lessonCount: number;
  /** Understanding game. */
  chapterTotal?: number;
  ideaTotal?: number;
  mappedChapters?: number;
  ideas?: Record<string, IdeaStat>;
  risen?: Record<string, number>;
  mastered?: number;
  /** Offline download status. */
  offline?: { at: number; chapters: number; audio?: string; audioAt?: number };
  /** Hand-picked chapter starts (sentence indexes of headings). Empty means automatic. */
  chapterStarts?: number[];
  pending?: number;
}

/** How well one idea is understood. `s` is the last blended score; strength fades from it over time. */
export interface IdeaStat {
  s: number;
  n: number;
  at: number;
  best: number;
  ch: number;
}

export interface IdeaNode {
  id: string;
  title: string;
  summary: string;
  anchor: number; // sentence index where the idea is explained
}

export interface ChapterMap {
  index: number;
  title: string;
  ideas: IdeaNode[];
  builtAt: number;
}

export type QuizFocus = { mode: 'chapter'; chapter: number } | { mode: 'idea'; chapter: number; idea: string } | { mode: 'review' };

export type ExerciseType = 'teach-back' | 'apply' | 'scenario' | 'connect' | 'challenge' | 'visualize' | 'reflect';

export interface Exercise {
  id: string;
  type: ExerciseType;
  title: string;
  prompt: string;
  why: string;
  done?: boolean;
  lastScore?: number;
  lastResponse?: string;
  lastFeedback?: string;
}

export interface Lesson {
  id: string;
  sectionLabel: string;
  sectionIndex: number;
  createdAt: number;
  bigIdea: string;
  simple: string;
  keyIdeas: { title: string; explanation: string }[];
  flashcards: { front: string; back: string }[];
  exercises: Exercise[];
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

export interface DocBody {
  id: string;
  text: string;
  lessons: Lesson[];
  chat: ChatMsg[];
  askedQuestions?: string[];
  /** Idea map, keyed by chapter index. */
  map?: Record<string, ChapterMap>;
  /** Downloaded question bank for offline quizzes, keyed by chapter index. */
  bank?: Record<string, QuizQuestion[]>;
  pending?: PendingReview[];
  reviews?: CoachReview[];
}

export interface QuizQuestion {
  id: string;
  kind: 'explain' | 'apply' | 'scenario' | 'compare' | 'choice' | 'followup';
  question: string;
  choices?: string[];
  answerIndex?: number;
  idealAnswer: string;
  keyPoints: string[];
  ideaId?: string;
}

export interface Grade {
  score: number;
  verdict: 'nailed' | 'solid' | 'partial' | 'missed';
  gotRight: string[];
  missing: string[];
  feedback: string;
  followUp?: string;
  /** Graded on the device without the full coach. */
  offline?: boolean;
}

/** An answer given offline, waiting for the full coach. */
export interface PendingReview {
  id: string;
  kind: 'grade' | 'exercise';
  at: number;
  label: string;
  answer: string;
  payload: any;
  ideaId?: string;
  offlineScore?: number;
  lessonId?: string;
  exerciseId?: string;
}

export interface CoachReview {
  id: string;
  at: number;
  label: string;
  answer: string;
  offlineScore?: number;
  score: number;
  feedback: string;
  missing: string[];
}

export type Provider = 'device' | 'openai' | 'elevenlabs' | 'neural';

export interface Settings {
  name: string;
  provider: Provider;
  deviceVoice: string;
  openaiVoice: string;
  elevenVoice: string;
  neuralVoice: string;
  /** Where the Natural voice is made while listening, when both are available. */
  naturalWhere?: 'cloud' | 'device';
  voiceStyle: string;
  rate: number;
  theme: 'auto' | 'light' | 'dark';
  readingFont: 'atkinson' | 'lexend' | 'serif';
  fontSize: number;
  lineHeight: number;
  autoScroll: boolean;
  wordHighlight: boolean;
  focusMode: boolean;
  sounds: boolean;
  celebrations: boolean;
  dailyGoalMin: number;
  quizCount: number;
  quizFocus: 'mix' | 'big' | 'details' | 'apply';
  answerMode: 'voice' | 'type';
  readQuestions: boolean;
  handsFree: boolean;
}

export interface GameState {
  xp: number;
  counters: Record<string, number>;
  achievements: Record<string, number>;
  streak: { current: number; best: number; lastDay: string };
  daily: { day: string; progress: Record<string, number>; done: boolean };
  log: { at: number; xp: number; label: string }[];
  /** XP earned each day (last two weeks), for the leaderboard. */
  days?: Record<string, number>;
}

export interface AppState {
  v: 1;
  /** Which person this progress belongs to. */
  profile?: string;
  updatedAt: number;
  settings: Settings;
  game: GameState;
  docs: Record<string, DocMeta>;
  deleted: Record<string, number>;
}

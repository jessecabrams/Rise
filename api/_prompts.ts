// Shared by the server (/api/ai) and the browser (preview mode). No Node or DOM imports here.

export type AiTask = 'lesson' | 'more' | 'quiz' | 'grade' | 'exercise' | 'ask' | 'ideas' | 'bank';
export const AI_TASKS: AiTask[] = ['lesson', 'more', 'quiz', 'grade', 'exercise', 'ask', 'ideas', 'bank'];

interface IdeaRef {
  id: string;
  title: string;
  summary: string;
}

function quizScope(p: any): string {
  const ideas: IdeaRef[] = p.ideas || [];
  if (!ideas.length) return '';
  const list = ideas.map((i) => `- ${i.id}: ${i.title}. ${i.summary}`).join('\n');
  if (p.mode === 'idea') {
    const i = ideas[0];
    return `Every question tests ONE idea, "${i.title}" (${i.summary}), from a different angle: explain it, apply it to a real situation, spot it in a scenario, handle a tricky edge case or a common misunderstanding. Set "ideaId" to "${i.id}" on every question.`;
  }
  if (p.mode === 'review') {
    return `These ideas are fading from memory. Write exactly one question per idea, in this order, and set "ideaId" to that idea's id. Vary the angle.\nIDEAS:\n${list}`;
  }
  return `The material contains these ideas. Spread the questions across them, covering as many as you can, and set "ideaId" on each question to the id of the idea it tests.\nIDEAS:\n${list}`;
}

export interface Prompt {
  system: string;
  user: string;
  tier: 'fast' | 'smart';
  maxTokens: number;
}

const VOICE = `You are Rise, the learning coach inside an app made by Jesse Abrams Coaching ("Build Your Life Around Your Brain").
Style: warm, direct, energizing, concrete. Short sentences. Plain words. Concrete scenarios over statistics.
Never use em dashes. Write periods instead.
You care about real understanding, not memorized wording. ADHD-friendly: scannable, specific, no filler.
Always reply with ONLY valid JSON in the exact shape requested. No markdown fences, no commentary.`;

export function clip(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '\n[material continues beyond this point]' : s;
}

const FOCUS: Record<string, string> = {
  mix: 'a balanced mix: big ideas, how ideas connect, and applying them to real life',
  big: 'the big ideas and why they matter',
  details: 'the important specifics and how they connect to each other',
  apply: 'applying the ideas to concrete situations in my own life and work'
};

const GRADE_SHAPE = `{"score": 0-100 integer, "verdict": "nailed" | "solid" | "partial" | "missed", "gotRight": ["short phrases naming what the answer showed"], "missing": ["short phrases naming what was missing or off"], "feedback": "2-3 sentences, coach voice, specific to what was said", "followUp": "one probing question that would deepen understanding, or an empty string"}
Verdict bands: nailed 90-100, solid 70-89, partial 40-69, missed 0-39.`;

const EXERCISE_SHAPE = `{"type": "teach-back" | "apply" | "scenario" | "connect" | "challenge" | "visualize" | "reflect", "title": "3-6 words", "prompt": "what to do, 1-3 sentences, specific to this material, answerable out loud in 1-2 minutes", "why": "one sentence on what this builds"}`;

export function buildPrompt(task: AiTask, p: any): Prompt {
  switch (task) {
    case 'lesson':
      return {
        tier: 'smart',
        maxTokens: 6000,
        system: VOICE,
        user: `Build a learning guide that helps me deeply understand this material, not just remember it.
TITLE: ${p.title}
SECTION: ${p.section || 'Whole piece'}
<material>
${clip(p.text, 150000)}
</material>

Return JSON in this shape:
{"bigIdea": "1-2 sentences: the single most important idea",
 "simple": "Explain the whole thing like I'm 12. 4-6 sentences with one vivid everyday example.",
 "keyIdeas": [{"title": "3-6 words", "explanation": "2-4 plain sentences grounded in the material"}],
 "flashcards": [{"front": "a question that tests understanding, not trivia", "back": "a short, clear answer"}],
 "exercises": [${EXERCISE_SHAPE}]}
Give 4-7 keyIdeas, 6-10 flashcards and 5 exercises covering at least 4 different types. Always include one teach-back exercise.`
      };
    case 'more':
      return {
        tier: 'smart',
        maxTokens: 2500,
        system: VOICE,
        user: `I want to go deeper on this material. Create 4 NEW exercises that push further than these existing ones: ${JSON.stringify(p.existing || [])}.
Make them harder, more personal and more creative. Use at least 3 different types. Include one "challenge" that argues against the material.
TITLE: ${p.title}
<material>
${clip(p.text, 120000)}
</material>
Return JSON: {"exercises": [${EXERCISE_SHAPE}]}`
      };
    case 'quiz':
      return {
        tier: 'smart',
        maxTokens: 4000,
        system: VOICE,
        user: `Write ${p.count || 5} quiz questions that test whether I UNDERSTAND this material. Focus on ${FOCUS[p.focus] || FOCUS.mix}.
Mostly open-ended questions I can answer out loud in under a minute: explain, apply, scenario, compare. At most 1 in 4 may be multiple choice.
Avoid trivia like dates, names and exact numbers unless they are central.
${quizScope(p)}
${p.avoid?.length ? `Do not repeat these earlier questions: ${JSON.stringify(p.avoid)}` : ''}
TITLE: ${p.title}${p.chapter ? `\nCHAPTER: ${p.chapter}` : ''}
<material>
${clip(p.text, 120000)}
</material>
Return JSON: {"questions": [{"kind": "explain" | "apply" | "scenario" | "compare" | "choice", "question": "...", "choices": ["only for choice: 4 options"], "answerIndex": 0, "idealAnswer": "what a strong answer says, 2-4 sentences", "keyPoints": ["2-4 ideas a strong answer would show"], "ideaId": "id from the idea list, or empty"}]}`
      };
    case 'grade':
      return {
        tier: 'fast',
        maxTokens: 900,
        system: VOICE,
        user: `Grade my answer for UNDERSTANDING, not wording. Reward the right idea in my own words. Give generous partial credit.
${p.spoken ? 'I answered out loud and this is a speech transcript. Ignore filler words, false starts, run-ons and transcription mistakes.' : ''}
QUESTION: ${p.question}
WHAT A STRONG ANSWER SHOWS: ${JSON.stringify(p.keyPoints || [])}
MODEL ANSWER: ${p.idealAnswer || '(none given: judge from the material)'}
${p.excerpt ? `<material>\n${clip(p.excerpt, 30000)}\n</material>` : ''}
MY ANSWER: ${p.answer}
Return JSON: ${GRADE_SHAPE}`
      };
    case 'exercise':
      return {
        tier: 'fast',
        maxTokens: 900,
        system: VOICE,
        user: `Coach me on this learning exercise. Judge how well my response shows real understanding and useful thinking. Be encouraging and specific, then push me one step further.
${p.spoken ? 'I answered out loud. Ignore filler words and transcription mistakes.' : ''}
EXERCISE (${p.type}): ${p.prompt}
<material>
${clip(p.text, 40000)}
</material>
MY RESPONSE: ${p.response}
Return JSON: ${GRADE_SHAPE}`
      };
    case 'ideas': {
      const len = (p.text || '').length;
      const n = len < 1500 ? '2 to 3' : len < 6000 ? '3 to 5' : '4 to 6';
      return {
        tier: 'smart',
        maxTokens: 2000,
        system: VOICE,
        user: `Map the core ideas in this chapter so I can master them one at a time.
PIECE: ${p.title}
CHAPTER: ${p.chapter}
<material>
${clip(p.text, 80000)}
</material>
Give ${n} ideas, in the order they appear. Each must be a distinct, testable claim or insight, not a topic label. Skip filler like thanks, previews and housekeeping.
Return JSON: {"ideas": [{"title": "3-7 words, a memorable name for the idea", "summary": "2-3 plain sentences: what the idea says and why it matters", "anchor": "5-12 words copied exactly from the material where the idea is explained"}]}`
      };
    }
    case 'bank': {
      const ideas: IdeaRef[] = p.ideas || [];
      return {
        tier: 'smart',
        maxTokens: 7000,
        system: VOICE,
        user: `Build an offline question bank so I can quiz myself on this chapter without internet. A small on-device grader will compare my spoken answers against your key points, so key points must be short, concrete and distinct.
PIECE: ${p.title}
CHAPTER: ${p.chapter}
IDEAS:
${ideas.map((i) => `- ${i.id}: ${i.title}. ${i.summary}`).join('\n')}
<material>
${clip(p.text, 80000)}
</material>
Write 3 questions for EACH idea: one "explain", one "apply" (a real situation from work or daily life), and one "scenario". Open-ended, answerable out loud in under a minute. No trivia.
Return JSON: {"questions": [{"ideaId": "id from the list", "kind": "explain" | "apply" | "scenario", "question": "...", "idealAnswer": "2-3 sentences", "keyPoints": ["2-4 short phrases, each one idea a strong answer must include"]}]}`
      };
    }
    case 'ask':
      return {
        tier: 'fast',
        maxTokens: 1500,
        system: VOICE,
        user: `Answer my question about this material. Ground the answer in the material. If the material does not cover it, say so in one sentence, then answer from general knowledge and label that part.
Keep it tight: 2-5 short paragraphs or a short list. Plain text, no markdown headers.
TITLE: ${p.title}
<material>
${clip(p.text, 120000)}
</material>
${p.history?.length ? `EARLIER IN OUR CHAT: ${JSON.stringify(p.history.slice(-6))}` : ''}
MY QUESTION: ${p.question}
Return JSON: {"answer": "..."}`
      };
  }
}

export function parseJson<T = any>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The coach replied in an unexpected format. Try again.');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

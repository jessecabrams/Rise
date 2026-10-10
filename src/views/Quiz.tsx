import { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Icon, ScoreRing, Segmented, Thinking, Toggle } from '../components/ui';
import { AnswerBox } from '../components/AnswerBox';
import { Feedback } from './Learn';
import { isOfflineError, runAi } from '../lib/ai';
import { bankFor } from '../lib/offline';
import { queueReview } from '../lib/review';
import { isOnline, useOnline } from '../lib/online';
import { answerXp, award } from '../lib/game';
import { say, stopSay } from '../lib/speech';
import { patchDoc, setSettings, useApp } from '../lib/store';
import { chapters, sectionText, uid } from '../lib/text';
import { buildIdeas, chapterStats, docStats, recordIdea, reviewPicks, type IdeaDelta } from '../lib/mastery';
import { go } from '../lib/nav';
import type { ChapterMap, Grade, IdeaNode, QuizFocus, QuizQuestion, Settings } from '../lib/types';
import type { DocCtx } from './Doc';

type Phase = 'setup' | 'loading' | 'question' | 'summary';
interface Result {
  score: number;
  spoken: boolean;
  grade: Grade;
  attempts: number;
}

const QUIZ_LINES = ['Writing questions that test understanding…', 'Skipping the trivia…', 'Making them answerable out loud…'];
const MAP_LINES = ['Mapping the ideas in this chapter first…', 'Finding what is worth mastering…', 'Placing the stars…'];
const GRADE_LINES = ['Listening for the idea, not the wording…', 'Checking what you nailed…'];

function scopeLabel(f: QuizFocus, chs: { title: string }[], idea?: IdeaNode) {
  if (f.mode === 'idea') return `Idea: ${idea?.title || 'one idea'}`;
  if (f.mode === 'review') return 'Fading stars review';
  return chs.length > 1 ? `Chapter ${f.chapter + 1}: ${chs[f.chapter]?.title}` : 'Whole piece';
}

export function Quiz({ ctx, focus }: { ctx: DocCtx; focus?: QuizFocus }) {
  const st = useApp((s) => s.settings);
  const meta = useApp((s) => s.docs[ctx.id]);
  useOnline();
  const chs = useMemo(() => chapters(ctx.s, ctx.title), [ctx.s, ctx.title]);
  const [pick, setPick] = useState<QuizFocus>(focus || { mode: 'chapter', chapter: 0 });
  const [scope, setScope] = useState<QuizFocus>(pick);
  const [phase, setPhase] = useState<Phase>('setup');
  const [loadingLines, setLoadingLines] = useState(QUIZ_LINES);
  const [qs, setQs] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [grade, setGrade] = useState<Grade | null>(null);
  const [delta, setDelta] = useState<IdeaDelta | null>(null);
  const [touched, setTouched] = useState<Record<string, IdeaDelta>>({});
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');
  const [listenKey, setListenKey] = useState(0);
  const [autoListen, setAutoListen] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  const q = qs[idx];
  const ds = docStats(meta, ctx.body);
  const ideaOf = (id?: string) => (id ? Object.values(ctx.bodyRef.current.map || {}).flatMap((m) => m.ideas).find((i) => i.id === id) : undefined);

  useEffect(() => () => stopSay(), []);
  useEffect(() => {
    if (focus) start(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'question' || !q || grade) return;
    setAutoListen(false);
    if (!st.readQuestions) return;
    let live = true;
    const spoken = q.choices?.length ? `${q.question} ${q.choices.map((c, i) => `${String.fromCharCode(65 + i)}: ${c}.`).join(' ')}` : q.question;
    say(spoken).then(() => {
      if (live && st.handsFree && q.kind !== 'choice') {
        setAutoListen(true);
        setListenKey((k) => k + 1);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, q?.id]);

  function fromBank(f: QuizFocus): QuizQuestion[] {
    const b = ctx.bodyRef.current;
    const avoid = (b.askedQuestions || []).slice(-30);
    if (f.mode === 'chapter') return bankFor(b.bank, [f.chapter], { count: st.quizCount, avoid });
    if (f.mode === 'idea') return bankFor(b.bank, [f.chapter], { count: 3, idea: f.idea, avoid });
    const picks = reviewPicks(meta, b, 5);
    const chIdx = [...new Set(picks.map((i) => Object.values(b.map || {}).find((m) => m.ideas.includes(i))!.index))];
    return bankFor(b.bank, chIdx, { count: picks.length, perIdea: picks.map((i) => i.id), avoid });
  }

  function begin(list: QuizQuestion[]) {
    setQs(list);
    setIdx(0);
    setResults({});
    setTouched({});
    setGrade(null);
    setDelta(null);
    setPicked(null);
    setXpEarned(0);
    setPhase('question');
    ctx.update((b) => ({ ...b, askedQuestions: [...(b.askedQuestions || []), ...list.map((x) => x.question)].slice(-40) }));
  }

  async function start(f: QuizFocus = pick) {
    setScope(f);
    setPhase('loading');
    setLoadingLines(QUIZ_LINES);
    setError('');
    if (!isOnline()) {
      const offlineQs = fromBank(f);
      if (offlineQs.length) return begin(offlineQs);
    }
    try {
      let ideas: IdeaNode[] = [];
      let text = '';
      let count = st.quizCount;
      let chapterTitle = '';
      if (f.mode === 'chapter') {
        const ch = chs[Math.min(f.chapter, chs.length - 1)];
        let cm: ChapterMap | undefined = ctx.bodyRef.current.map?.[ch.index];
        if (!cm) {
          setLoadingLines(MAP_LINES);
          cm = await buildIdeas(ctx, ch);
          setLoadingLines(QUIZ_LINES);
        }
        ideas = cm.ideas;
        text = sectionText(ctx.s.sentences, ch);
        chapterTitle = chs.length > 1 ? ch.title : '';
      } else if (f.mode === 'idea') {
        const ch = chs[f.chapter];
        const idea = ctx.bodyRef.current.map?.[f.chapter]?.ideas.find((i) => i.id === f.idea);
        if (!ch || !idea) throw new Error('That idea is no longer on your map. Remap the chapter and try again.');
        ideas = [idea];
        text = sectionText(ctx.s.sentences, ch);
        chapterTitle = ch.title;
        count = 3;
      } else {
        ideas = reviewPicks(meta, ctx.bodyRef.current, 5);
        if (!ideas.length) throw new Error('Map a chapter first. Then Rise can review the ideas you are losing.');
        const used = new Set(ideas.map((i) => Object.values(ctx.bodyRef.current.map || {}).find((m) => m.ideas.includes(i))!.index));
        text = [...used].map((c) => `${chs[c]?.title}\n${sectionText(ctx.s.sentences, chs[c]).slice(0, 24000)}`).join('\n\n');
        count = ideas.length;
      }
      const r = await runAi<{ questions: Omit<QuizQuestion, 'id'>[] }>('quiz', {
        title: ctx.title,
        chapter: chapterTitle,
        text,
        count,
        focus: st.quizFocus,
        mode: f.mode,
        ideas: ideas.map(({ id, title, summary }) => ({ id, title, summary })),
        avoid: (ctx.bodyRef.current.askedQuestions || []).slice(-20)
      });
      const valid = new Set(ideas.map((i) => i.id));
      const list = (r.questions || [])
        .filter((x) => x.question)
        .map((x) => ({
          ...x,
          id: uid(),
          keyPoints: x.keyPoints || [],
          idealAnswer: x.idealAnswer || '',
          ideaId: f.mode === 'idea' ? ideas[0].id : x.ideaId && valid.has(x.ideaId) ? x.ideaId : undefined
        }));
      if (!list.length) throw new Error('The coach did not return any questions. Try again.');
      begin(list);
    } catch (e: any) {
      const offlineQs = isOfflineError(e) || !isOnline() ? fromBank(f) : [];
      if (offlineQs.length) return begin(offlineQs);
      setError(e.message);
      setPhase('setup');
    }
  }

  function record(g: Grade, spoken: boolean, masteryScore = g.score) {
    const prev = results[q.id];
    const attempts = (prev?.attempts || 0) + 1;
    const comeback = prev && prev.score < 70 && g.score >= 80 ? 1 : 0;
    const xp = attempts === 1 ? answerXp(g.score, spoken) : Math.round(answerXp(g.score, spoken) / 2) + comeback * 10;
    setResults((r) => ({ ...r, [q.id]: { score: g.score, spoken, grade: g, attempts } }));
    setGrade(g);
    setXpEarned((x) => x + xp);
    award(g.score >= 90 ? 'Nailed a question' : 'Answered a question', xp, {
      questionsAnswered: attempts === 1 ? 1 : 0,
      spokenAnswers: spoken ? 1 : 0,
      perfectAnswers: g.score >= 90 ? 1 : 0,
      comebacks: comeback
    });
    if (q.ideaId) {
      const d = recordIdea(ctx.id, ctx.bodyRef.current, q.ideaId, masteryScore);
      setDelta(d);
      if (d) setTouched((t) => ({ ...t, [d.ideaId]: { ...d, before: t[d.ideaId]?.before ?? d.before } }));
    } else setDelta(null);
    if (st.readQuestions) say(g.feedback);
  }

  async function answer(text: string, spoken: boolean) {
    setGrading(true);
    setError('');
    stopSay();
    try {
      const idea = ideaOf(q.ideaId);
      const g = await runAi<Grade>('grade', {
        question: q.question,
        idealAnswer: q.idealAnswer,
        keyPoints: q.keyPoints.length ? q.keyPoints : idea ? [idea.summary] : [],
        answer: text,
        spoken,
        excerpt: q.kind === 'followup' && scope.mode !== 'review' ? sectionText(ctx.s.sentences, chs[scope.chapter]) : undefined
      });
      const score = Math.max(0, Math.min(100, Math.round(g.score)));
      if (g.offline) {
        queueReview(ctx.id, ctx.update, {
          kind: 'grade',
          label: q.question,
          answer: text,
          ideaId: q.ideaId,
          offlineScore: score,
          payload: { question: q.question, idealAnswer: q.idealAnswer, keyPoints: q.keyPoints.length ? q.keyPoints : idea ? [idea.summary] : [], answer: text, spoken }
        });
      }
      record({ ...g, score }, spoken);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGrading(false);
    }
  }

  function choose(i: number) {
    if (grade) return;
    setPicked(i);
    const right = i === q.answerIndex;
    record(
      {
        score: right ? 100 : 0,
        verdict: right ? 'nailed' : 'missed',
        gotRight: right ? ['Picked the right answer'] : [],
        missing: right ? [] : [`The answer was: ${q.choices?.[q.answerIndex ?? 0]}`],
        feedback: q.idealAnswer || (right ? 'Correct.' : 'Not this time.'),
        followUp: ''
      },
      false,
      right ? 85 : 30
    );
  }

  function next() {
    stopSay();
    setGrade(null);
    setDelta(null);
    setPicked(null);
    setError('');
    if (idx + 1 < qs.length) setIdx(idx + 1);
    else finish();
  }

  function retry() {
    stopSay();
    setGrade(null);
    setDelta(null);
    setPicked(null);
  }

  function addFollowUp() {
    if (!grade?.followUp) return;
    const fq: QuizQuestion = { id: uid(), kind: 'followup', question: grade.followUp, idealAnswer: '', keyPoints: [], ideaId: q.ideaId };
    setQs((list) => [...list.slice(0, idx + 1), fq, ...list.slice(idx + 1)]);
    stopSay();
    setGrade(null);
    setDelta(null);
    setPicked(null);
    setIdx(idx + 1);
  }

  function finish() {
    const rs = Object.values(results);
    const avg = rs.length ? Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.length) : 0;
    patchDoc(ctx.id, (d) => {
      d.quiz.taken += 1;
      d.quiz.answered += rs.length;
      d.quiz.totalScore += rs.reduce((a, r) => a + r.score, 0);
      d.quiz.best = Math.max(d.quiz.best, avg);
    });
    award('Finished a quiz', 25, { quizzesTaken: 1, ideaQuizzes: scope.mode === 'idea' ? 1 : 0 });
    setXpEarned((x) => x + 25);
    setPhase('summary');
  }

  if (phase === 'setup')
    return <QuizSetup ctx={ctx} st={st} chs={chs} pick={pick} setPick={setPick} onStart={() => start(pick)} onReview={() => start({ mode: 'review' })} fading={ds.fading} mapped={ds.mapped} error={error} />;
  if (phase === 'loading') return <Thinking lines={loadingLines} />;

  if (phase === 'summary') {
    const rs = qs.map((x) => ({ q: x, r: results[x.id] })).filter((x) => x.r);
    const avg = rs.length ? Math.round(rs.reduce((a, x) => a + x.r.score, 0) / rs.length) : 0;
    const weak = rs.filter((x) => x.r.score < 70);
    const moved = Object.values(touched);
    return (
      <div className="quiz-summary">
        <div className="summary-hero">
          <ScoreRing score={avg} size={120} />
          <div>
            <span className="eyebrow">{scopeLabel(scope, chs, ideaOf((scope as any).idea))}</span>
            <h2>{avg >= 90 ? 'You really get this.' : avg >= 70 ? 'Strong grasp.' : avg >= 40 ? 'The shape is there.' : 'Good first pass.'}</h2>
            <p className="tabular">
              +{xpEarned} XP · {rs.filter((x) => x.r.spoken).length} answered out loud
            </p>
          </div>
        </div>
        {moved.length > 0 && (
          <section className="card stack">
            <div className="section-head">
              <h3>Your stars moved</h3>
              <button className="btn btn-ghost sm" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'map' })}>
                <Icon name="map" size={16} /> See your map
              </button>
            </div>
            {moved.map((d) => (
              <IdeaMeter key={d.ideaId} delta={d} />
            ))}
          </section>
        )}
        <ul className="summary-list">
          {rs.map(({ q: x, r }) => (
            <li key={x.id}>
              <span className={`score-pill v-${r.grade.verdict}`}>{r.score}</span>
              <span className="grow">{x.question}</span>
              {r.spoken && <Icon name="mic" size={16} label="Answered out loud" />}
            </li>
          ))}
        </ul>
        <div className="row gap wrap">
          {weak.length > 0 && (
            <button
              className="btn btn-sun"
              onClick={() => {
                setQs(weak.map((w) => ({ ...w.q, id: uid() })));
                setIdx(0);
                setResults({});
                setXpEarned(0);
                setPhase('question');
              }}
            >
              <Icon name="refresh" size={18} /> Retry the {weak.length} I missed
            </button>
          )}
          <button className={weak.length ? 'btn btn-ghost' : 'btn btn-sun'} onClick={() => start(scope)}>
            <Icon name="target" size={18} /> New questions
          </button>
          <button className="btn btn-ghost" onClick={() => setPhase('setup')}>
            Pick another chapter or idea
          </button>
        </div>
      </div>
    );
  }

  const idea = ideaOf(q.ideaId);
  return (
    <div className="quiz">
      <div className="quiz-scope">
        <Icon name={scope.mode === 'idea' ? 'star' : scope.mode === 'review' ? 'flame' : 'book'} size={16} />
        <span>{scopeLabel(scope, chs, ideaOf((scope as any).idea))}</span>
      </div>
      <div className="quiz-progress">
        {qs.map((x, i) => (
          <span key={x.id} className={`dot ${i === idx ? 'now' : ''} ${results[x.id] ? `v-${results[x.id].grade.verdict}` : ''}`} aria-hidden="true" />
        ))}
        <span className="hint tabular">
          {idx + 1} / {qs.length}
        </span>
        <button className="btn btn-ghost sm" onClick={finish}>
          End quiz
        </button>
      </div>

      <div className="question-card">
        <span className="eyebrow">
          {q.kind === 'followup' ? 'Bonus: go deeper' : { explain: 'Explain', apply: 'Apply it', scenario: 'Scenario', compare: 'Compare', choice: 'Pick one', followup: '' }[q.kind]}
          {idea && scope.mode !== 'idea' && <span className="q-idea"> · ★ {idea.title}</span>}
        </span>
        <h2 className="question">{q.question}</h2>
        <button className="icon-btn" onClick={() => say(q.question)} aria-label="Read question aloud">
          <Icon name="speaker" size={20} />
        </button>
      </div>

      {q.kind === 'choice' && q.choices?.length ? (
        <div className="choices">
          {q.choices.map((c, i) => {
            const state = grade ? (i === q.answerIndex ? 'right' : i === picked ? 'wrong' : '') : '';
            return (
              <button key={i} className={`choice ${state}`} onClick={() => choose(i)} disabled={!!grade}>
                <span className="choice-key">{String.fromCharCode(65 + i)}</span>
                {c}
              </button>
            );
          })}
        </div>
      ) : (
        !grade && (grading ? <Thinking lines={GRADE_LINES} /> : <AnswerBox key={`${q.id}-${listenKey}`} id={`q-${q.id}`} onSubmit={answer} busy={grading} autoListen={autoListen} />)
      )}

      {error && <ErrorNote message={error} />}

      {grade && (
        <>
          {delta && <IdeaMeter delta={delta} live />}
          <Feedback grade={grade} onNext={next} nextLabel={idx + 1 < qs.length ? 'Next question' : 'See results'} onAgain={q.kind !== 'choice' ? retry : undefined} />
          {grade.followUp && (
            <button className="followup" onClick={addFollowUp}>
              <span className="eyebrow">Want to go deeper?</span>
              <span>{grade.followUp}</span>
              <span className="hint">Answer this bonus question</span>
            </button>
          )}
          {q.idealAnswer && q.kind !== 'choice' && (
            <details className="ideal">
              <summary>See a strong answer</summary>
              <p>{q.idealAnswer}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** Shows an idea's understanding moving from before to after, as a star and a horizon bar. */
export function IdeaMeter({ delta, live }: { delta: IdeaDelta; live?: boolean }) {
  const [shown, setShown] = useState(live ? delta.before : delta.after);
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setShown(delta.after), 120);
    return () => clearTimeout(t);
  }, [live, delta.after]);
  const up = delta.after >= delta.before;
  const state = shown >= 80 ? 'lit' : shown >= 50 ? 'glow' : 'dim';
  return (
    <div className={`idea-meter ${live ? 'live' : ''} ${delta.lit ? 'just-lit' : ''}`}>
      <svg className={`meter-star s-${state}`} viewBox="-12 -12 24 24" width="34" height="34" aria-hidden="true">
        <path d="M0 -11 L2.6 -2.6 L11 0 L2.6 2.6 L0 11 L-2.6 2.6 L-11 0 L-2.6 -2.6 Z" />
      </svg>
      <div className="grow">
        <div className="row between gap">
          <strong>{delta.title}</strong>
          <span className={`tabular meter-num ${up ? 'up' : 'down'}`}>
            {delta.before} → {delta.after}
          </span>
        </div>
        <div className="horizon thin">
          <span className="horizon-fill" style={{ width: `${shown}%` }} />
        </div>
        {(delta.lit || delta.revived || delta.risen) && (
          <span className="meter-tag">{delta.risen ? `Sunrise over “${delta.risen}”` : delta.lit ? 'Star lit' : 'Star revived'}</span>
        )}
      </div>
    </div>
  );
}

function QuizSetup({
  ctx,
  st,
  chs,
  pick,
  setPick,
  onStart,
  onReview,
  fading,
  mapped,
  error
}: {
  ctx: DocCtx;
  st: Settings;
  chs: ReturnType<typeof chapters>;
  pick: QuizFocus;
  setPick: (f: QuizFocus) => void;
  onStart: () => void;
  onReview: () => void;
  fading: number;
  mapped: number;
  error: string;
}) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const online = useOnline();
  const chIndex = pick.mode === 'review' ? 0 : pick.chapter;
  const banked = Object.values(ctx.body.bank || {}).reduce((a, l) => a + l.length, 0);
  const cm = ctx.body.map?.[chIndex];
  const ideaId = pick.mode === 'idea' ? pick.idea : '';
  return (
    <div className="quiz-setup">
      <div className="cta-card">
        <div className="cta-art" aria-hidden="true">
          <Icon name="target" size={34} />
        </div>
        <h2>Prove you've got it</h2>
        <p>Pick a chapter or a single idea. Questions test understanding, not trivia. Every answer lights up, or dims, a star on your map.</p>
        <button className="btn btn-sun" onClick={onStart}>
          <Icon name="play" size={18} /> {pick.mode === 'idea' ? 'Quiz this idea' : chs.length > 1 ? 'Quiz this chapter' : 'Start quiz'}
        </button>
        {error && <ErrorNote message={error} onRetry={onStart} />}
      </div>

      {!online && (
        <div className={`offline-banner ${banked ? '' : 'warn'}`} role="status">
          <Icon name="wifiOff" size={20} />
          <span>
            {banked
              ? `You're offline. Quizzes come from the ${banked} questions you downloaded, and answers are checked on your device.`
              : "You're offline and this piece isn't downloaded, so quizzes need the on-device coach. Next time, tap the download button at the top while you have signal."}
          </span>
        </div>
      )}
      {(meta?.pending || 0) > 0 && (
        <p className="hint">
          {meta!.pending} offline {meta!.pending === 1 ? 'answer is' : 'answers are'} waiting for the full coach. They're reviewed automatically when you're back online.
        </p>
      )}
      {(ctx.body.reviews?.length || 0) > 0 && <CoachReviews ctx={ctx} />}
      {fading > 0 && (
        <button className="review-cta" onClick={onReview}>
          <span className="review-flame" aria-hidden="true">
            <Icon name="flame" size={22} />
          </span>
          <span className="grow">
            <strong>
              {fading} {fading === 1 ? 'star is' : 'stars are'} fading
            </strong>
            <span className="hint">A quick review brings them back and makes them fade slower next time.</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      <div className="card stack">
        {chs.length > 1 && (
          <div className="field">
            <span>Chapter</span>
            <div className="chapter-picks" role="radiogroup" aria-label="Chapter">
              {chs.map((c) => {
                const cs = chapterStats(meta, ctx.body.map?.[c.index]);
                const on = chIndex === c.index;
                return (
                  <button key={c.index} role="radio" aria-checked={on} className={`chapter-pick ${on ? 'on' : ''}`} onClick={() => setPick({ mode: 'chapter', chapter: c.index })}>
                    <span className="cp-num tabular">{c.index + 1}</span>
                    <span className="grow">{c.title}</span>
                    {cs.total > 0 ? (
                      <span className={`cp-stars tabular ${cs.risen ? 'risen' : ''}`}>
                        ★ {cs.lit}/{cs.total}
                      </span>
                    ) : (
                      <span className="hint">not mapped</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="field">
          <span>Focus</span>
          {cm ? (
            <div className="chips">
              <button className={`chip ${pick.mode === 'chapter' ? 'on' : ''}`} onClick={() => setPick({ mode: 'chapter', chapter: chIndex })}>
                {chs.length > 1 ? 'Whole chapter' : 'Everything'}
              </button>
              {cm.ideas.map((i) => (
                <button key={i.id} className={`chip ${ideaId === i.id ? 'on' : ''}`} onClick={() => setPick({ mode: 'idea', chapter: chIndex, idea: i.id })}>
                  ★ {i.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Rise maps this {chs.length > 1 ? "chapter's" : ''} ideas when you start, so afterwards you can quiz one idea at a time.</p>
          )}
        </div>
        {pick.mode === 'chapter' && (
          <div className="field">
            <span>Questions</span>
            <Segmented
              label="Number of questions"
              value={String(st.quizCount) as '3' | '5' | '8' | '12'}
              onChange={(v) => setSettings({ quizCount: Number(v) })}
              options={[
                { value: '3', label: '3' },
                { value: '5', label: '5' },
                { value: '8', label: '8' },
                { value: '12', label: '12' }
              ]}
            />
          </div>
        )}
        <div className="field">
          <span>Angle</span>
          <Segmented
            label="Quiz angle"
            value={st.quizFocus}
            onChange={(v) => setSettings({ quizFocus: v })}
            options={[
              { value: 'mix', label: 'Mix' },
              { value: 'big', label: 'Big ideas' },
              { value: 'details', label: 'Details' },
              { value: 'apply', label: 'My life' }
            ]}
          />
        </div>
        <div className="field">
          <span>I'll answer by</span>
          <Segmented
            label="Answer mode"
            value={st.answerMode}
            onChange={(v) => setSettings({ answerMode: v })}
            options={[
              { value: 'voice', label: 'Speaking' },
              { value: 'type', label: 'Typing' }
            ]}
          />
        </div>
        <Toggle id="rq" checked={st.readQuestions} onChange={(v) => setSettings({ readQuestions: v })} label="Read questions and feedback aloud" />
        <Toggle id="hf" checked={st.handsFree} onChange={(v) => setSettings({ handsFree: v })} label="Hands-free mode" hint="After each question is read, Rise starts listening and submits when you pause." />
        {mapped > 0 && fading === 0 && <p className="hint">No fading stars right now. Nice.</p>}
      </div>
    </div>
  );
}

function CoachReviews({ ctx }: { ctx: DocCtx }) {
  const list = ctx.body.reviews || [];
  return (
    <details className="card coach-reviews">
      <summary>
        <Icon name="chat" size={18} /> Coach notes on {list.length} offline {list.length === 1 ? 'answer' : 'answers'}
      </summary>
      <ul>
        {list.map((r) => (
          <li key={r.id}>
            <div className="row between gap">
              <strong>{r.label}</strong>
              <span className="tabular hint">
                {typeof r.offlineScore === 'number' ? `${r.offlineScore} → ` : ''}
                {r.score}
              </span>
            </div>
            <p className="hint">You said: “{r.answer}”</p>
            <p>{r.feedback}</p>
            {r.missing.length > 0 && <p className="hint">Add next time: {r.missing.join('; ')}</p>}
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost sm" onClick={() => ctx.update((b) => ({ ...b, reviews: [] }))}>
        Clear these notes
      </button>
    </details>
  );
}

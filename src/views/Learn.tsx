import { useMemo, useState } from 'react';
import { ErrorNote, Icon, ScoreRing, Thinking } from '../components/ui';
import { AnswerBox } from '../components/AnswerBox';
import { isOfflineError, runAi } from '../lib/ai';
import { queueReview } from '../lib/review';
import { award } from '../lib/game';
import { say } from '../lib/speech';
import { chapters, sectionText, uid } from '../lib/text';
import { ideasFromList, saveChapterMap, starState, strength } from '../lib/mastery';
import { useApp } from '../lib/store';
import { go } from '../lib/nav';
import type { Exercise, Grade, Lesson } from '../lib/types';
import type { DocCtx } from './Doc';

const TYPE_LABEL: Record<string, string> = {
  'teach-back': 'Teach it back',
  apply: 'Apply it',
  scenario: 'Scenario',
  connect: 'Connect it',
  challenge: 'Challenge it',
  visualize: 'Picture it',
  reflect: 'Reflect'
};

const BUILD_LINES = ['Reading closely…', 'Finding the big idea…', 'Writing flashcards…', 'Designing exercises just for this…', 'Almost there…'];

export function Learn({ ctx }: { ctx: DocCtx }) {
  const secs = useMemo(() => chapters(ctx.s, ctx.title), [ctx.s, ctx.title]);
  const [secIndex, setSecIndex] = useState(() => Math.min(ctx.body.lessons[ctx.body.lessons.length - 1]?.sectionIndex ?? 0, secs.length - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lesson = ctx.body.lessons.find((l) => l.sectionIndex === secIndex);
  const sec = secs[Math.min(secIndex, secs.length - 1)];

  async function build() {
    setBusy(true);
    setError('');
    try {
      const r = await runAi<Omit<Lesson, 'id' | 'sectionLabel' | 'sectionIndex' | 'createdAt'>>('lesson', { title: ctx.title, section: sec.title, text: sectionText(ctx.s.sentences, sec) });
      const l: Lesson = {
        id: uid(),
        sectionIndex: sec.index,
        sectionLabel: sec.title,
        createdAt: Date.now(),
        bigIdea: r.bigIdea || '',
        simple: r.simple || '',
        keyIdeas: r.keyIdeas || [],
        flashcards: r.flashcards || [],
        exercises: (r.exercises || []).map((e) => ({ ...e, id: uid() }))
      };
      ctx.update((b) => ({ ...b, lessons: [...b.lessons.filter((x) => x.sectionIndex !== sec.index), l] }));
      // The guide's key ideas become this chapter's stars if it has no map yet.
      if (!ctx.bodyRef.current.map?.[sec.index] && l.keyIdeas.length) {
        const ideas = ideasFromList(ctx, sec, l.keyIdeas);
        if (ideas.length) saveChapterMap(ctx, { index: sec.index, title: sec.title, ideas, builtAt: Date.now() });
      }
      award('Built a learning guide', 15, { lessonsBuilt: 1 });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const saveLesson = (l: Lesson) => ctx.update((b) => ({ ...b, lessons: b.lessons.map((x) => (x.id === l.id ? l : x)) }));

  return (
    <div className="learn">
      {secs.length > 1 && (
        <label className="field section-pick" htmlFor="learn-sec">
          <span>Chapter</span>
          <select id="learn-sec" value={secIndex} onChange={(e) => setSecIndex(Number(e.target.value))}>
            {secs.map((x) => (
              <option key={x.index} value={x.index}>
                {x.label}
                {ctx.body.lessons.some((l) => l.sectionIndex === x.index) ? '  ✓ guide' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {!lesson && !busy && (
        <div className="cta-card">
          <div className="cta-art" aria-hidden="true">
            <Icon name="spark" size={34} />
          </div>
          <h2>Turn this into a learning guide</h2>
          <p>The big idea, a plain-language explanation, key ideas you can listen to, flashcards, and hands-on exercises built from this exact material.</p>
          <button className="btn btn-sun" onClick={build}>
            <Icon name="spark" size={18} /> Build my guide
          </button>
          {error && <ErrorNote message={error} onRetry={build} />}
        </div>
      )}

      {busy && <Thinking lines={BUILD_LINES} />}

      {lesson && !busy && <LessonView lesson={lesson} ctx={ctx} onChange={saveLesson} onRebuild={build} sectionText={sectionText(ctx.s.sentences, sec)} />}
    </div>
  );
}

function LessonView({ lesson, ctx, onChange, onRebuild, sectionText }: { lesson: Lesson; ctx: DocCtx; onChange: (l: Lesson) => void; onRebuild: () => void; sectionText: string }) {
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  async function goDeeper() {
    setMore(true);
    setError('');
    try {
      const r = await runAi<{ exercises: Exercise[] }>('more', { title: ctx.title, text: sectionText, existing: lesson.exercises.map((e) => e.title) });
      onChange({ ...lesson, exercises: [...lesson.exercises, ...(r.exercises || []).map((e) => ({ ...e, id: uid() }))] });
      award('Went deeper', 5);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMore(false);
    }
  }

  return (
    <div className="lesson">
      <section className="big-idea">
        <span className="eyebrow">The big idea</span>
        <p>{lesson.bigIdea}</p>
        <button className="icon-btn on-sun" onClick={() => say(lesson.bigIdea)} aria-label="Read the big idea aloud">
          <Icon name="speaker" size={20} />
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Explain it like I'm 12</h3>
          <button className="icon-btn" onClick={() => say(lesson.simple)} aria-label="Read aloud">
            <Icon name="speaker" size={18} />
          </button>
        </div>
        <p className="prose">{lesson.simple}</p>
      </section>

      <KeyIdeas lesson={lesson} ctx={ctx} />

      {lesson.flashcards.length > 0 && <Flashcards cards={lesson.flashcards} />}

      <section>
        <div className="section-head">
          <h3>Deep-dive exercises</h3>
          <span className="hint tabular">
            {lesson.exercises.filter((e) => e.done).length} of {lesson.exercises.length} done
          </span>
        </div>
        <div className="exercises">
          {lesson.exercises.map((ex) => (
            <ExerciseCard key={ex.id} ex={ex} ctx={ctx} text={sectionText} onDone={(next) => onChange({ ...lesson, exercises: lesson.exercises.map((e) => (e.id === next.id ? next : e)) })} />
          ))}
        </div>
        <div className="row gap wrap">
          <button className="btn btn-sun" onClick={goDeeper} disabled={more}>
            <Icon name="dive" size={18} /> {more ? 'Designing harder ones…' : 'Go deeper'}
          </button>
          <button className="btn btn-ghost" onClick={onRebuild}>
            <Icon name="refresh" size={18} /> Rebuild guide
          </button>
        </div>
        {error && <ErrorNote message={error} />}
      </section>
    </div>
  );
}

/** Key ideas. When the chapter is mapped these are its stars, each quizzable on its own. */
function KeyIdeas({ lesson, ctx }: { lesson: Lesson; ctx: DocCtx }) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const cm = ctx.body.map?.[lesson.sectionIndex];
  const items = cm ? cm.ideas.map((i) => ({ id: i.id, title: i.title, text: i.summary })) : lesson.keyIdeas.map((k, n) => ({ id: String(n), title: k.title, text: k.explanation }));
  return (
    <section>
      <div className="section-head">
        <h3>Key ideas</h3>
        <div className="row gap">
          <button className="btn btn-ghost sm" onClick={() => say(items.map((k) => `${k.title}. ${k.text}`).join(' '))}>
            <Icon name="speaker" size={16} /> Listen to all
          </button>
          {cm && (
            <button className="btn btn-ghost sm" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'map' })}>
              <Icon name="map" size={16} /> Map
            </button>
          )}
        </div>
      </div>
      <ol className="key-ideas">
        {items.map((k) => {
          const st = cm ? meta?.ideas?.[k.id] : undefined;
          return (
            <li key={k.id}>
              <div className="grow">
                <strong>{k.title}</strong>
                <p>{k.text}</p>
                {cm && (
                  <div className="ki-foot">
                    <span className={`ki-state s-${starState(st)}`}>★ {st?.n ? `${strength(st)}%` : 'not tested'}</span>
                    <button className="btn btn-ghost sm" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'quiz', focus: { mode: 'idea', chapter: lesson.sectionIndex, idea: k.id } })}>
                      <Icon name="target" size={16} /> Quiz this idea
                    </button>
                  </div>
                )}
              </div>
              <button className="icon-btn" onClick={() => say(`${k.title}. ${k.text}`)} aria-label={`Read ${k.title} aloud`}>
                <Icon name="speaker" size={18} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Flashcards({ cards }: { cards: { front: string; back: string }[] }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [got, setGot] = useState(0);
  const done = pos >= order.length;
  const card = cards[order[pos]];

  function rate(ok: boolean) {
    award(ok ? 'Flashcard, got it' : 'Flashcard, again', ok ? 3 : 1, { flashcardsReviewed: 1 }, { quiet: true });
    if (ok) setGot((g) => g + 1);
    else setOrder((o) => [...o, o[pos]]);
    setFlipped(false);
    setPos((p) => p + 1);
  }

  return (
    <section>
      <div className="section-head">
        <h3>Flashcards</h3>
        <span className="hint tabular">{done ? 'Deck done' : `${pos + 1} / ${order.length}`}</span>
      </div>
      {done ? (
        <div className="card center">
          <p>
            You got <strong>{got}</strong> on the first or later try. Nice work.
          </p>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setOrder([...cards.keys()].sort(() => Math.random() - 0.5));
              setPos(0);
              setGot(0);
            }}
          >
            <Icon name="refresh" size={18} /> Shuffle and go again
          </button>
        </div>
      ) : (
        <div className="flash-wrap">
          <button className={`flash ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show question' : 'Show answer'}>
            <span className="flash-face front">
              <span className="eyebrow">Question</span>
              {card.front}
              <span className="hint">Tap to flip</span>
            </span>
            <span className="flash-face back">
              <span className="eyebrow">Answer</span>
              {card.back}
            </span>
          </button>
          {flipped && (
            <div className="row gap center">
              <button className="btn btn-ghost" onClick={() => rate(false)}>
                Again
              </button>
              <button className="btn btn-sun" onClick={() => rate(true)}>
                Got it
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ExerciseCard({ ex, ctx, text, onDone }: { ex: Exercise; ctx: DocCtx; text: string; onDone: (e: Exercise) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function submit(response: string, spoken: boolean) {
    setBusy(true);
    setError('');
    const payload = { type: ex.type, prompt: ex.prompt, text, response, spoken };
    const lessonId = ctx.bodyRef.current.lessons.find((l) => l.exercises.some((e) => e.id === ex.id))?.id;
    try {
      let g: Grade;
      try {
        g = await runAi<Grade>('exercise', payload);
      } catch (e) {
        if (!isOfflineError(e)) throw e;
        // Offline with no on-device coach: save the response and let the full coach review it later.
        queueReview(ctx.id, ctx.update, { kind: 'exercise', label: ex.title, answer: response, payload, lessonId, exerciseId: ex.id });
        onDone({ ...ex, done: true, lastResponse: response, lastFeedback: 'Saved offline. Coach feedback arrives when you are back online.' });
        if (!ex.done) award(`Exercise: ${ex.title}`, 20 + (spoken ? 5 : 0), { exercisesDone: 1, teachBacks: ex.type === 'teach-back' ? 1 : 0, spokenAnswers: spoken ? 1 : 0 });
        setSaved(true);
        return;
      }
      if (g.offline) queueReview(ctx.id, ctx.update, { kind: 'exercise', label: ex.title, answer: response, payload, lessonId, exerciseId: ex.id });
      setGrade(g);
      const first = !ex.done;
      onDone({ ...ex, done: true, lastScore: g.score, lastResponse: response, lastFeedback: g.feedback });
      award(
        first ? `Exercise: ${ex.title}` : `Exercise again: ${ex.title}`,
        (first ? 20 : 8) + (spoken ? 5 : 0) + (g.score >= 90 ? 10 : 0),
        { exercisesDone: first ? 1 : 0, teachBacks: first && ex.type === 'teach-back' ? 1 : 0, spokenAnswers: spoken ? 1 : 0, perfectAnswers: g.score >= 90 ? 1 : 0 }
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`exercise ${ex.done ? 'done' : ''} ${open ? 'open' : ''}`}>
      <button className="exercise-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`type-chip t-${ex.type}`}>{TYPE_LABEL[ex.type] || ex.type}</span>
        <strong className="grow">{ex.title}</strong>
        {ex.done ? <span className="done-dot" aria-label="Done"><Icon name="check" size={14} /></span> : <Icon name="chevron" size={18} />}
      </button>
      {open && (
        <div className="exercise-body">
          <p className="prompt">{ex.prompt}</p>
          <p className="hint">Why: {ex.why}</p>
          <button className="btn btn-ghost sm" onClick={() => say(ex.prompt)}>
            <Icon name="speaker" size={16} /> Read it to me
          </button>
          {saved && (
            <div className="offline-banner" role="status">
              <Icon name="check" size={18} />
              <span>Saved offline. +XP earned now. Coach feedback arrives when you're back online.</span>
            </div>
          )}
          {!grade && !saved && <AnswerBox id={`ex-${ex.id}`} onSubmit={submit} busy={busy} submitLabel="Get coaching" placeholder="Work through it here…" compact />}
          {grade && <Feedback grade={grade} onAgain={() => setGrade(null)} />}
          {!grade && ex.lastFeedback && (
            <p className="hint">
              Last time ({ex.lastScore}): {ex.lastFeedback}
            </p>
          )}
          {error && <ErrorNote message={error} />}
        </div>
      )}
    </article>
  );
}

export function Feedback({ grade, onAgain, onNext, nextLabel }: { grade: Grade; onAgain?: () => void; onNext?: () => void; nextLabel?: string }) {
  const verdict = { nailed: 'Nailed it', solid: 'Solid', partial: 'Getting there', missed: 'Not yet' }[grade.verdict] || 'Feedback';
  return (
    <div className={`feedback v-${grade.verdict}`} role="status">
      <div className="feedback-top">
        <ScoreRing score={Math.round(grade.score)} />
        <div className="grow">
          <span className="eyebrow">Understanding</span>
          <h4>{verdict}</h4>
          <p>{grade.feedback}</p>
        </div>
        <button className="icon-btn" onClick={() => say(grade.feedback)} aria-label="Read feedback aloud">
          <Icon name="speaker" size={18} />
        </button>
      </div>
      {(grade.gotRight?.length > 0 || grade.missing?.length > 0) && (
        <div className="feedback-cols">
          {grade.gotRight?.length > 0 && (
            <div>
              <span className="eyebrow good">You showed</span>
              <ul>
                {grade.gotRight.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {grade.missing?.length > 0 && (
            <div>
              <span className="eyebrow warn">Add next time</span>
              <ul>
                {grade.missing.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="row gap wrap">
        {onNext && (
          <button className="btn btn-sun" onClick={onNext} autoFocus>
            {nextLabel || 'Next'}
          </button>
        )}
        {onAgain && (
          <button className="btn btn-ghost" onClick={onAgain}>
            <Icon name="refresh" size={18} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

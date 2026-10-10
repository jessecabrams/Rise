import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Icon, Thinking } from '../components/ui';
import { AnswerBox } from '../components/AnswerBox';
import { isOfflineError, runAi } from '../lib/ai';
import { isOnline, useOnline } from '../lib/online';
import { searchPassages } from '../lib/offline';
import { coachChat, coachReady } from '../lib/localllm';
import { award } from '../lib/game';
import { say } from '../lib/speech';
import type { DocCtx } from './Doc';

const STARTERS = ['What is the one thing I should remember?', 'Give me a real-life example of this.', 'What would someone who disagrees say?', 'How could I use this at work this week?'];

export function Ask({ ctx }: { ctx: DocCtx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [indexing, setIndexing] = useState(false);
  const [k, setK] = useState(0);
  const online = useOnline();
  const end = useRef<HTMLDivElement>(null);
  const chat = ctx.body.chat || [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat.length, busy]);

  async function askOffline(question: string): Promise<string> {
    const found = await searchPassages(ctx.id, ctx.s.sentences, question, 4, () => setIndexing(true));
    setIndexing(false);
    if (coachReady()) {
      const reply = await coachChat(
        'You are Rise, a warm, direct learning coach. Answer only from the passages. If they do not cover it, say so. Plain text, 2-4 short paragraphs. Never use em dashes.',
        `PASSAGES FROM "${ctx.title}":\n${found.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n')}\n\nMY QUESTION: ${question}`,
        { maxTokens: 450 }
      );
      return `${reply.trim()}\n\n(On-device coach, offline)`;
    }
    return `You're offline, so here's what the piece itself says about that:\n\n${found
      .slice(0, 2)
      .map((p) => `“${p.text}”`)
      .join('\n\n')}\n\nTurn on the on-device coach in Settings for offline answers in plain words.`;
  }

  async function ask(question: string, spoken = false) {
    setBusy(true);
    setError('');
    const withQ = [...chat, { role: 'user' as const, text: question }];
    ctx.setBody({ ...ctx.body, chat: withQ });
    try {
      let answer: string;
      try {
        if (!isOnline()) throw Object.assign(new Error('offline'), { offline: true });
        answer = (await runAi<{ answer: string }>('ask', { title: ctx.title, text: ctx.body.text, question, history: chat.slice(-6) })).answer;
      } catch (e) {
        if (!isOfflineError(e) && isOnline()) throw e;
        answer = await askOffline(question);
      }
      ctx.setBody({ ...ctx.body, chat: [...withQ, { role: 'assistant', text: answer }] });
      award('Asked a question', 3 + (spoken ? 2 : 0), { askQuestions: 1, spokenAnswers: spoken ? 1 : 0 });
      setK((n) => n + 1);
    } catch (e: any) {
      setError(e.message);
      ctx.setBody({ ...ctx.body, chat });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      {chat.length === 0 && (
        <div className="ask-intro">
          <h2>Ask your material anything</h2>
          <p>{online ? 'Out loud or typed. Answers come from this piece first.' : "You're offline. Rise searches this piece on your device and answers from it."}</p>
          <div className="chips">
            {STARTERS.map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="chat">
        {chat.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <p>{m.text}</p>
            {m.role === 'assistant' && (
              <button className="icon-btn" onClick={() => say(m.text)} aria-label="Read answer aloud">
                <Icon name="speaker" size={16} />
              </button>
            )}
          </div>
        ))}
        {busy && <Thinking lines={indexing ? ['Indexing this piece on your device…', 'Only needed once…'] : ['Looking through the material…', 'Putting it in plain words…']} />}
        <div ref={end} />
      </div>
      {error && <ErrorNote message={error} />}
      <AnswerBox key={k} id="ask-input" onSubmit={(t, spoken) => ask(t, spoken)} busy={busy} submitLabel="Ask" placeholder="What do you want to know?" compact />
      {chat.length > 0 && (
        <button className="btn btn-ghost sm" onClick={() => ctx.setBody({ ...ctx.body, chat: [] })}>
          Clear conversation
        </button>
      )}
    </div>
  );
}

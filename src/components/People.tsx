import { useEffect, useState } from 'react';
import { ErrorNote, Icon } from './ui';
import { api, useServer } from '../lib/api';

interface Person {
  id: string;
  name: string;
  createdAt: number;
}

interface Board {
  id: string;
  name: string;
  xp: number;
  weekXp: number;
  streak: number;
  bestStreak: number;
  starsLit: number;
  chaptersRisen: number;
  booksMastered: number;
  quizzes: number;
  minutes: number;
}

/** Owner only: invite someone with their own code, see who's in, remove or reissue a code. */
export function PeopleSettings() {
  const srv = useServer();
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const owner = !!srv.profile?.owner;

  const load = () => api<{ people: Person[] }>('/api/people').then((r) => setPeople(r.people || []), () => {});
  useEffect(() => {
    if (owner && srv.features.storage) load();
  }, [owner, srv.features.storage]);

  if (!srv.authed) return <p className="hint">Unlock Rise first to invite people.</p>;
  if (!owner) return <p className="hint">You're signed in as {srv.profile?.name}. Your progress is your own; the books are shared.</p>;
  if (!srv.features.storage) return <p className="hint">Inviting people needs sync storage (Upstash) connected.</p>;

  async function invite(e?: React.FormEvent, renew?: string) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ name: string; code: string }>('/api/people', { method: 'POST', body: renew ? { id: renew } : { name } });
      setMade(r);
      setName('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="hint">Each person gets their own code. They see the same books, with their own progress, scores and streaks, and you can compete on the leaderboard.</p>
      {people.length > 0 && (
        <ul className="status-list">
          {people.map((p) => (
            <li key={p.id} className="on">
              <span className="status-dot" aria-hidden="true" />
              <span className="grow">{p.name}</span>
              <button className="link-btn" onClick={() => invite(undefined, p.id)} disabled={busy}>
                New code
              </button>
              <button
                className="link-btn"
                onClick={async () => {
                  if (confirm !== p.id) return setConfirm(p.id);
                  await api(`/api/people?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => {});
                  setConfirm('');
                  load();
                }}
              >
                {confirm === p.id ? 'Tap again to remove' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="row gap wrap" onSubmit={(e) => invite(e)}>
        <input aria-label="Name" placeholder="Their name" value={name} onChange={(e) => setName(e.target.value)} className="grow" />
        <button className="btn btn-sun" type="submit" disabled={!name.trim() || busy}>
          <Icon name="plus" size={18} /> Add person
        </button>
      </form>
      {error && <ErrorNote message={error} />}
      {made && (
        <div className="invite-card">
          <strong>{made.name}'s code</strong>
          <code className="invite-code">{made.code}</code>
          <p className="hint">
            Send {made.name} this: open <b>rise-bice.vercel.app</b> on your phone, go to Settings, and enter <b>{made.code}</b> where it asks for the passcode. Then tap Share › Add to
            Home Screen. This code is shown once; you can make a new one any time.
          </p>
          <button
            className="btn btn-ghost sm"
            onClick={() => {
              const text = `Join me on Rise! Open https://rise-bice.vercel.app on your phone, go to Settings, and enter this code where it asks for the passcode: ${made.code}`;
              if ((navigator as any).share) (navigator as any).share({ text }).catch(() => {});
              else navigator.clipboard?.writeText(text);
            }}
          >
            <Icon name="link" size={16} /> Share invite
          </button>
        </div>
      )}
    </div>
  );
}

const COLUMNS: { key: keyof Board; label: string; hint: string }[] = [
  { key: 'weekXp', label: 'XP this week', hint: 'Resets each week' },
  { key: 'streak', label: 'Streak', hint: 'Days in a row' },
  { key: 'starsLit', label: 'Stars lit', hint: 'Ideas you understand' },
  { key: 'chaptersRisen', label: 'Suns risen', hint: 'Chapters mastered' },
  { key: 'quizzes', label: 'Quizzes', hint: 'Taken' },
  { key: 'minutes', label: 'Minutes', hint: 'Listened' },
  { key: 'xp', label: 'All-time XP', hint: '' }
];

/** Friendly competition: who's ahead this week, and on each game. */
export function Leaderboard() {
  const srv = useServer();
  const [board, setBoard] = useState<Board[] | null>(null);
  const [me, setMe] = useState('');
  const [by, setBy] = useState<keyof Board>('weekXp');
  useEffect(() => {
    if (!srv.authed || !srv.features.storage) return;
    api<{ me: string; board: Board[] }>('/api/people?board=1').then(
      (r) => {
        setBoard(r.board || []);
        setMe(r.me);
      },
      () => setBoard([])
    );
  }, [srv.authed, srv.features.storage]);
  if (!board || board.length < 2) return null;
  const sorted = [...board].sort((a, b) => Number(b[by]) - Number(a[by]));
  const top = Number(sorted[0][by]) || 1;
  const col = COLUMNS.find((c) => c.key === by)!;
  return (
    <section className="card stack leaderboard">
      <div className="row between wrap gap">
        <h2>Leaderboard</h2>
        <span className="hint">{col.hint}</span>
      </div>
      <div className="chip-row" role="tablist" aria-label="Rank by">
        {COLUMNS.map((c) => (
          <button key={c.key} role="tab" aria-selected={by === c.key} className={`chip ${by === c.key ? 'on' : ''}`} onClick={() => setBy(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <ol className="board-list">
        {sorted.map((b, i) => (
          <li key={b.id} className={b.id === me ? 'me' : ''}>
            <span className="board-rank tabular">{i === 0 && Number(b[by]) > 0 ? '👑' : i + 1}</span>
            <span className="grow">
              <strong>{b.id === me ? `${b.name} (you)` : b.name}</strong>
              <span className="board-bar" aria-hidden="true">
                <span style={{ width: `${(Number(b[by]) / top) * 100}%` }} />
              </span>
            </span>
            <span className="board-val tabular">{Number(b[by]).toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

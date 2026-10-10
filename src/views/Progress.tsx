import { Horizon, Icon } from '../components/ui';
import { useApp } from '../lib/store';
import { BADGES, badgeProgress, dayKey, levelInfo, questsFor } from '../lib/game';
import { metaSummary } from '../lib/mastery';
import { go } from '../lib/nav';

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Progress() {
  const g = useApp((s) => s.game);
  const settings = useApp((s) => s.settings);
  const docs = useApp((s) => s.docs);
  const lvl = levelInfo(g.xp);
  const c = (k: string) => g.counters[k] || 0;
  const answered = Object.values(docs).reduce((a, d) => a + d.quiz.answered, 0);
  const total = Object.values(docs).reduce((a, d) => a + d.quiz.totalScore, 0);
  const today = dayKey();
  const quests = questsFor(today, settings);
  const progress = g.daily.day === today ? g.daily.progress : {};
  const unlocked = BADGES.filter((b) => g.achievements[b.id]).length;
  const skies = Object.values(docs)
    .map((d) => ({ d, s: metaSummary(d) }))
    .filter((x) => x.s.ideas > 0)
    .sort((a, b) => b.s.fading - a.s.fading || b.s.lit / b.s.ideas - a.s.lit / a.s.ideas);

  return (
    <div className="page">
      <section className="level-hero" aria-label="Level">
        <div className="sky" style={{ ['--rise' as any]: lvl.pct }} aria-hidden="true">
          <div className="sky-rays" />
          <div className="sky-sun" />
          <div className="sky-stripes">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="level-copy">
          <span className="eyebrow">Level {lvl.level}</span>
          <h1>{lvl.title}</h1>
          <Horizon pct={lvl.pct} label="Progress to next level" />
          <p className="tabular">
            {g.xp.toLocaleString()} XP total · {lvl.toNext} to level {lvl.level + 1}
          </p>
        </div>
      </section>

      <section className="stats" aria-label="Stats">
        <div className="stat">
          <Icon name="flame" />
          <strong className="tabular">{g.streak.current}</strong>
          <span>day streak (best {g.streak.best})</span>
        </div>
        <div className="stat">
          <Icon name="headphones" />
          <strong className="tabular">{fmtTime(c('secondsListened'))}</strong>
          <span>listened</span>
        </div>
        <div className="stat">
          <Icon name="book" />
          <strong className="tabular">{c('wordsHeard').toLocaleString()}</strong>
          <span>words heard</span>
        </div>
        <div className="stat">
          <Icon name="target" />
          <strong className="tabular">{c('questionsAnswered')}</strong>
          <span>questions answered</span>
        </div>
        <div className="stat">
          <Icon name="mic" />
          <strong className="tabular">{c('spokenAnswers')}</strong>
          <span>spoken answers</span>
        </div>
        <div className="stat">
          <Icon name="brain" />
          <strong className="tabular">{answered ? Math.round(total / answered) : '–'}</strong>
          <span>avg understanding</span>
        </div>
      </section>

      {skies.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Your maps</h2>
            <span className="hint tabular">★ {c('ideasLit')} stars lit all time</span>
          </div>
          <ul className="sky-list">
            {skies.map(({ d, s }) => (
              <li key={d.id}>
                <button onClick={() => go({ name: 'doc', id: d.id, tab: 'map' })}>
                  <span className="grow">
                    <strong>{d.title}</strong>
                    <span className="hint tabular">
                      ★ {s.lit}/{s.ideas} lit{s.chapters > 1 ? ` · ☀ ${s.risen}/${s.chapters} risen` : ''}
                      {s.fading > 0 && <span className="fade-tag">{s.fading} fading</span>}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
                <Horizon pct={s.ideas ? s.lit / s.ideas : 0} thin label={`${d.title} stars lit`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Today's quests</h2>
          {g.daily.day === today && g.daily.done && <span className="done-tag">+50 XP earned</span>}
        </div>
        <ul className="quest-list">
          {quests.map((q) => {
            const n = Math.min(progress[q.counter] || 0, q.target);
            return (
              <li key={q.id}>
                <div className="row between">
                  <span>{q.label}</span>
                  <span className="hint tabular">{q.format ? q.format(n) : `${n}/${q.target}`}</span>
                </div>
                <Horizon pct={n / q.target} thin label={q.label} />
              </li>
            );
          })}
        </ul>
        <p className="hint">Finish all three for a 50 XP bonus. New quests every day.</p>
      </section>

      <section>
        <div className="section-head">
          <h2>Badges</h2>
          <span className="hint tabular">
            {unlocked} of {BADGES.length}
          </span>
        </div>
        <div className="badges">
          {BADGES.map((b) => {
            const got = !!g.achievements[b.id];
            const p = badgeProgress(b, g);
            return (
              <div key={b.id} className={`badge ${got ? 'got' : 'locked'}`}>
                <span className={`medal tier-${b.tier}`}>
                  <Icon name={got ? b.icon : 'lock'} size={22} />
                </span>
                <strong>{b.name}</strong>
                <small>{b.desc}</small>
                {!got && p && <Horizon pct={p[0] / p[1]} thin label={`${b.name} progress`} />}
                <span className={`tier-label tier-text-${b.tier}`}>{b.tier}</span>
              </div>
            );
          })}
        </div>
      </section>

      {g.log.length > 0 && (
        <section className="card">
          <h2>Recent XP</h2>
          <ul className="xp-log">
            {g.log.slice(0, 12).map((l, i) => (
              <li key={i}>
                <span className="xp-amt tabular">+{l.xp}</span>
                <span className="grow">{l.label}</span>
                <span className="hint">{ago(l.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

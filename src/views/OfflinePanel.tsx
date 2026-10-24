import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Horizon, Icon, Toggle } from '../components/ui';
import { prepareOffline, type PrepProgress } from '../lib/offline';
import { chapterAt } from '../lib/text';
import { canDownloadAudio, downloadAudio, removeAudio, savedSet, usePlayer, voiceKey } from '../lib/speech';
import { importAudioPack, makeAudioPacks, packEstimateMB, saveFile, type PackFile, type PackProgress } from '../lib/audiopack';
import { localNatural, NATURAL_VOICES } from '../lib/localtts';
import { ANSWER_PACK_MB, downloadAnswerPack, packReady, removeAnswerPack, usePack } from '../lib/localml';
import { COACH_MODELS, downloadCoach, removeCoach, useCoach, webgpuSupported } from '../lib/localllm';
import { NATURAL_MB, downloadNatural, isIOS, removeNatural, stopNatural, useNatural } from '../lib/localtts';
import { setSettings } from '../lib/store';
import { AppleVoicesHelp } from '../components/AppleVoices';
import { fmtBytes, keepStorage, storageUsage, useOnline } from '../lib/online';
import { patchDoc, useApp } from '../lib/store';
import { go } from '../lib/nav';
import type { DocCtx } from './Doc';

/** Download one piece for offline use: audio to listen, and quizzes. */
export function DocOffline({ ctx }: { ctx: DocCtx }) {
  return (
    <div className="stack">
      <AudioDownload ctx={ctx} />
      <QuizDownload ctx={ctx} />
      <AudioForPhone ctx={ctx} />
    </div>
  );
}

type Scope = 'chapter' | 'rest' | 'all';
const standalone = () => (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || !!(navigator as any).standalone;

function AudioDownload({ ctx }: { ctx: DocCtx }) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const provider = useApp((s) => s.settings.provider);
  const online = useOnline();
  const p = usePlayer();
  const vk = voiceKey();
  const canDl = canDownloadAudio();
  const [scope, setScope] = useState<Scope>('chapter');
  const [saved, setSaved] = useState<Set<string> | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [eta, setEta] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stopping, setStopping] = useState(false);
  const cancel = useRef(false);

  const at = p.docId === ctx.id ? p.index : meta?.position || 0;
  const cur = chapterAt(ctx.chs, at) || ctx.chs[0];
  const range = (sc: Scope) =>
    sc === 'all' || !cur ? { start: 0, end: ctx.s.sentences.length } : sc === 'chapter' ? { start: cur.start, end: cur.end } : { start: cur.start, end: ctx.s.sentences.length };
  const textsFor = (sc: Scope) => {
    const r = range(sc);
    return [...new Set(ctx.s.sentences.slice(r.start, r.end))];
  };

  const refresh = () => (vk ? savedSet(vk).then(setSaved) : Promise.resolve());
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vk, ctx.id]);

  if (!vk) return <Card title="Listen offline" hint="Your device voice works offline. There's nothing to download." />;
  if (!canDl)
    return (
      <Card
        title="Listen offline"
        hint={provider === 'neural' ? 'To get the Natural voice on this phone, add an audio file made on your computer (below).' : 'This voice can’t be downloaded right now.'}
      />
    );

  const texts = textsFor(scope);
  const have = saved ? texts.filter((x) => saved.has(x)).length : 0;
  const left = texts.length - have;
  const leftWords = texts.filter((x) => !saved?.has(x)).reduce((a, x) => a + (x.match(/\S+/g) || []).length, 0);
  const mbPerMin = provider === 'neural' ? 0.24 : 1;
  const leftMb = Math.max(1, Math.round((leftWords / 150) * mbPerMin));
  const allTexts = textsFor('all');
  const allHave = saved ? allTexts.filter((x) => saved.has(x)).length : 0;
  const finishedTexts = cur ? [...new Set(ctx.s.sentences.slice(0, cur.start))].filter((x) => saved?.has(x)) : [];

  async function run() {
    cancel.current = false;
    setError('');
    setNote('');
    setPct(0);
    setStopping(false);
    const started = Date.now();
    let lastRefresh = started;
    try {
      await keepStorage();
      const r = await downloadAudio(
        texts,
        (f) => {
          setPct(f);
          if (Date.now() - lastRefresh > 3000) {
            lastRefresh = Date.now();
            refresh();
          }
          const spent = (Date.now() - started) / 1000;
          if (f > 0.03 && f < 1) {
            const sec = (spent / f) * (1 - f);
            setEta(sec > 90 ? `about ${Math.round(sec / 60)} min left` : 'less than 2 min left');
          }
        },
        cancel
      );
      await refresh();
      if (cancel.current) setNote('Stopped. Tap Download to pick up where you left off.');
      else if (r.failed) setNote(`${r.failed} sentences didn’t download. Tap Download again to finish them.`);
      else setNote('Done. This part plays without a connection.');
      const all = await savedSet(vk!);
      if (allTexts.every((x) => all.has(x) || !/[A-Za-z]{2,}|[0-9]{2,}/.test(x))) patchDoc(ctx.id, (d) => (d.offline = { ...(d.offline || { at: Date.now(), chapters: 0 }), audio: vk!, audioAt: Date.now() }));
    } catch (e: any) {
      setError(e.message || 'The download stopped. Try again.');
    } finally {
      setPct(null);
      setEta('');
    }
  }

  async function remove(list: string[], label: string) {
    if (confirm !== label) return setConfirm(label);
    setConfirm('');
    await removeAudio(list, vk!);
    if (label === 'all') patchDoc(ctx.id, (d) => d.offline && delete d.offline.audio);
    await refresh();
  }

  return (
    <div className="group">
      <div className="group-head">
        <h3>Listen offline</h3>
        <span className="hint tabular">
          {allHave.toLocaleString()} of {allTexts.length.toLocaleString()} sentences saved
        </span>
      </div>
      <div className="seg" role="radiogroup" aria-label="What to download">
        {(
          [
            ['chapter', ctx.chs.length > 1 ? 'This chapter' : 'All of it'],
            ['rest', 'To the end'],
            ['all', 'Whole book']
          ] as [Scope, string][]
        )
          .filter(([k]) => ctx.chs.length > 1 || k === 'chapter')
          .map(([k, label]) => (
            <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)} disabled={pct !== null}>
              {label}
            </button>
          ))}
      </div>
      <p className="hint tabular">
        {left === 0 ? 'All saved on this device.' : `${left.toLocaleString()} sentences to get · about ${leftMb} MB`}
        {ctx.chs.length > 1 && scope !== 'all' && cur ? ` · starting at ${cur.label}` : ''}
      </p>
      {pct !== null ? (
        <div className="stack" role="status">
          <Horizon pct={pct} label="Download progress" />
          <div className="row between">
            <span className="hint tabular">
              {Math.round(pct * 100)}%{eta ? ` · ${eta}` : ''}
            </span>
            <button
              className="btn btn-ghost sm"
              disabled={stopping}
              onClick={() => {
                cancel.current = true;
                setStopping(true);
              }}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
          <p className="hint">Keep Rise open. The screen stays on while it downloads.</p>
        </div>
      ) : (
        left > 0 && (
          <button className="btn btn-sun" onClick={run} disabled={!online}>
            <Icon name="download" size={18} /> Download
          </button>
        )
      )}
      {!online && pct === null && left > 0 && <p className="hint warn">You're offline. Downloading needs a connection.</p>}
      {note && <p className="hint">{note}</p>}
      {error && <ErrorNote message={error} />}
      {isIOS() && !standalone() && allHave > 0 && (
        <p className="hint warn">Add Rise to your Home Screen (Share › Add to Home Screen). In a Safari tab, iPhone can clear downloads after a week of not opening Rise.</p>
      )}
      {pct === null && (allHave > 0 || finishedTexts.length > 0) && (
        <div className="row gap wrap">
          {finishedTexts.length > 20 && (
            <button className="link-btn" onClick={() => remove(finishedTexts, 'done')}>
              {confirm === 'done' ? 'Tap again to remove' : 'Free up space: remove chapters you’ve finished'}
            </button>
          )}
          {allHave > 0 && (
            <button className="link-btn" onClick={() => remove(allTexts, 'all')}>
              {confirm === 'all' ? 'Tap again to remove all audio' : 'Remove this book’s audio'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="group">
      <div className="group-head">
        <h3>{title}</h3>
      </div>
      <p className="hint">{hint}</p>
    </div>
  );
}

function QuizDownload({ ctx }: { ctx: DocCtx }) {
  const online = useOnline();
  const chs = ctx.chs;
  const mapped = chs.filter((c) => ctx.body.map?.[c.index]).length;
  const banked = chs.filter((c) => ctx.body.bank?.[c.index]?.length).length;
  const questions = Object.values(ctx.body.bank || {}).reduce((a, l) => a + l.length, 0);
  const [prog, setProg] = useState<PrepProgress | null>(null);
  const [error, setError] = useState('');
  const cancel = useRef(false);
  const ready = banked === chs.length && mapped === chs.length;

  async function run() {
    cancel.current = false;
    setError('');
    setProg({ label: 'Starting…', pct: 0 });
    try {
      await prepareOffline(ctx, { audio: false }, setProg, cancel);
    } catch (e: any) {
      setError(e.message || 'That stopped. Try again.');
    } finally {
      setProg(null);
    }
  }

  return (
    <div className="group">
      <div className="group-head">
        <h3>Quiz offline</h3>
        <span className="hint tabular">{ready ? `${questions} questions ready` : `${banked} of ${chs.length} ${chs.length === 1 ? 'piece' : 'chapters'} ready`}</span>
      </div>
      <p className="hint">Idea maps and practice questions for every chapter, so you can quiz yourself with no connection.</p>
      {prog ? (
        <div className="stack" role="status">
          <span className="hint">{prog.label}</span>
          <Horizon pct={prog.pct} label="Progress" />
          <button className="btn btn-ghost sm" onClick={() => (cancel.current = true)}>
            Stop
          </button>
        </div>
      ) : (
        !ready && (
          <button className="btn btn-ghost" onClick={run} disabled={!online}>
            <Icon name="target" size={18} /> Get quizzes ready
          </button>
        )
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

/** Device-wide offline setup, shown in Settings. */
export function OfflineSettings() {
  const pack = usePack();
  const natural = useNatural();
  const coach = useCoach();
  const online = useOnline();
  const docs = useApp((s) => s.docs);
  const [model, setModel] = useState<string>(coach.model || COACH_MODELS[0].id);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirm, setConfirm] = useState<'pack' | 'coach' | 'natural' | null>(null);
  const gpu = webgpuSupported();

  useEffect(() => {
    storageUsage().then(setUsage);
  }, [pack.status, coach.status, natural.status]);

  const offlineDocs = Object.values(docs).filter((d) => d.offline);

  return (
    <div className="stack">
      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>Offline answers</h3>
            <p className="hint">Grades your answers and turns your voice into text on this device. About {ANSWER_PACK_MB} MB, downloaded once.</p>
          </div>
          {pack.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {pack.status === 'downloading' && <Horizon pct={pack.pct} label="Offline answers download" />}
        {pack.status === 'error' && <ErrorNote message={pack.error} />}
        <div className="row gap wrap">
          {pack.status !== 'ready' && (
            <button
              className="btn btn-sun"
              disabled={!online || pack.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadAnswerPack();
              }}
            >
              <Icon name="download" size={18} /> {pack.status === 'downloading' ? `Downloading ${Math.round(pack.pct * 100)}%` : 'Download'}
            </button>
          )}
          {pack.status === 'ready' && (
            <button className="link-btn" onClick={() => (confirm === 'pack' ? (removeAnswerPack(), setConfirm(null)) : setConfirm('pack'))}>
              {confirm === 'pack' ? 'Tap again to remove it from this device' : 'Remove from this device'}
            </button>
          )}
        </div>
      </div>

      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>Natural voice</h3>
            <p className="hint">A lifelike voice that runs on this device, about {NATURAL_MB} MB. It reads anything offline, including coach feedback and Ask answers. You can also choose it as your main voice. Free and private.</p>
          </div>
          {natural.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {natural.status === 'downloading' && <Horizon pct={natural.pct} label="Natural voice download" />}
        {natural.stage && <p className="hint">{natural.stage}</p>}
        {natural.status === 'error' && <ErrorNote message={natural.error} />}
        {isIOS() && natural.status !== 'ready' && <AppleVoicesHelp />}
        <div className="row gap wrap">
          {natural.status === 'downloading' && (
            <button className="btn btn-ghost sm" onClick={stopNatural}>
              Stop
            </button>
          )}
          {natural.status !== 'ready' && !isIOS() && (
            <button
              className="btn btn-sun"
              disabled={!online || natural.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadNatural();
              }}
            >
              <Icon name="download" size={18} /> {natural.status === 'downloading' ? `Downloading ${Math.round(natural.pct * 100)}%` : isIOS() ? 'Try it anyway' : 'Download'}
            </button>
          )}
          {natural.status === 'ready' && (
            <>
              <button className="btn btn-ghost sm" onClick={() => setSettings({ provider: 'neural' })}>
                <Icon name="wave" size={16} /> Make it my main voice
              </button>
              <button className="link-btn" onClick={() => (confirm === 'natural' ? (removeNatural(), setConfirm(null)) : setConfirm('natural'))}>
                {confirm === 'natural' ? 'Tap again to remove it' : 'Remove'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>On-device coach</h3>
            <p className="hint">Optional. Answers your questions in Ask and gives written feedback with no connection. Simpler than the online coach.</p>
          </div>
          {coach.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {!gpu && <p className="hint warn">This browser can't run it. It needs WebGPU: recent Chrome or Edge on a computer, Chrome on Android, or Safari on iOS 26 or later.</p>}
        {coach.status !== 'ready' && gpu && (
          <div className="model-picks" role="radiogroup" aria-label="Coach size">
            {COACH_MODELS.map((m) => (
              <button key={m.id} role="radio" aria-checked={model === m.id} className={`model-pick ${model === m.id ? 'on' : ''}`} onClick={() => setModel(m.id)} disabled={coach.status === 'downloading'}>
                <strong>
                  {m.name} <span className="hint">{m.size}</span>
                </strong>
                <span className="hint">{m.note}</span>
              </button>
            ))}
          </div>
        )}
        {(coach.status === 'downloading' || coach.status === 'loading') && (
          <div className="stack">
            <Horizon pct={coach.pct} label="Coach download" />
            <span className="hint">{coach.text.replace(/\[.*?\]\s*/g, '').slice(0, 120)}</span>
          </div>
        )}
        {coach.status === 'error' && <ErrorNote message={coach.error} />}
        <div className="row gap wrap">
          {coach.status !== 'ready' && gpu && (
            <button
              className="btn btn-sun"
              disabled={!online || coach.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadCoach(model);
              }}
            >
              <Icon name="download" size={18} /> {coach.status === 'downloading' ? `Downloading ${Math.round(coach.pct * 100)}%` : `Download ${COACH_MODELS.find((m) => m.id === model)?.name}`}
            </button>
          )}
          {coach.status === 'ready' && (
            <>
              <span className="hint">{COACH_MODELS.find((m) => m.id === coach.model)?.name} coach installed</span>
              <button className="link-btn" onClick={() => (confirm === 'coach' ? (removeCoach(), setConfirm(null)) : setConfirm('coach'))}>
                {confirm === 'coach' ? 'Tap again to remove it' : 'Remove'}
              </button>
            </>
          )}
        </div>
      </div>

      {offlineDocs.length > 0 && (
        <div className="offline-card">
          <h3>Downloaded pieces</h3>
          <ul className="status-list">
            {offlineDocs.map((d) => (
              <li key={d.id} className="on">
                <span className="status-dot" aria-hidden="true" />
                <button className="grow link-like" onClick={() => go({ name: 'doc', id: d.id, tab: 'listen' })}>
                  {d.title}
                </button>
                <span className="hint">{d.offline?.audio ? 'with audio' : 'text and quizzes'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {usage && (
        <p className="hint tabular">
          Rise is using {fmtBytes(usage.used)} on this device{usage.quota ? ` of ${fmtBytes(usage.quota)} available` : ''}.
        </p>
      )}
    </div>
  );
}


/** Natural voice audio: made free on a computer, carried to the phone as a file. */
function AudioForPhone({ ctx }: { ctx: DocCtx }) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const voice = useApp((s) => s.settings.neuralVoice) || 'af_heart';
  const where = useApp((s) => s.settings.naturalWhere);
  const [which, setWhich] = useState<string>('all');
  const [prog, setProg] = useState<PackProgress | null>(null);
  const [files, setFiles] = useState<PackFile[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const cancel = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const vname = NATURAL_VOICES.find((v) => v.id === voice)?.name || voice;

  if (!localNatural()) {
    // On the phone: bring in a file made on the computer.
    return (
      <div className="offline-card stack">
        <h3>Natural voice audio from your computer</h3>
        <p className="hint">On your computer, open this piece, tap the download button and choose Make audio for iPhone. Send the file here with AirDrop or iCloud Drive, then add it below.</p>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setError('');
            setNote('Adding the audio…');
            try {
              const r = await importAudioPack(f, (p) => setNote(`Adding the audio… ${Math.round(p * 100)}%`));
              setNote(`Added ${r.clips} sentences of audio${r.parts > 1 ? ` (file ${r.part} of ${r.parts})` : ''}. The Natural voice is now your voice.`);
            } catch (err: any) {
              setNote('');
              setError(err.message);
            }
          }}
        />
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> Add audio file
        </button>
        {note && <p className="hint">{note}</p>}
        {error && <ErrorNote message={error} />}
      </div>
    );
  }

  const chosen = which === 'all' ? [] : ctx.chs.filter((c) => String(c.index) === which);
  const words = which === 'all' ? meta?.wordCount || 0 : Math.round((chosen[0]?.chars || 0) / 5.5);

  async function make() {
    cancel.current = false;
    setError('');
    setFiles([]);
    setProg({ done: 0, total: 1, label: 'Starting the Natural voice…' });
    try {
      const out = await makeAudioPacks({ id: ctx.id, title: ctx.title, s: ctx.s, body: ctx.bodyRef.current }, chosen, setProg, cancel);
      setFiles(out);
      if (out.length === 1) saveFile(out[0]);
    } catch (e: any) {
      if (e.message !== 'Stopped.') setError(e.message || 'Making the audio stopped. Try again.');
    } finally {
      setProg(null);
    }
  }

  return (
    <div className="offline-card stack">
      <h3>Make audio for iPhone</h3>
      <p className="hint">
        Saves the piece in the Natural voice ({vname}) as a file. Put the file on your iPhone and it plays there with no connection.{' '}
        {where === 'device' ? 'Made on this computer for free, which is slower.' : 'Made in the cloud, which is quick: about 60¢ for a long book.'}
      </p>
      {ctx.chs.length > 1 && (
        <label className="field" htmlFor="pack-which">
          <span>What to include</span>
          <select id="pack-which" value={which} onChange={(e) => setWhich(e.target.value)} disabled={!!prog}>
            <option value="all">The whole piece</option>
            {ctx.chs.map((c) => (
              <option key={c.index} value={String(c.index)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint tabular">About {packEstimateMB(words)} MB. Sentences you've already heard are reused, so it gets faster each time.</p>
      {prog ? (
        <div className="stack" role="status">
          <span className="hint">{prog.label}</span>
          <Horizon pct={prog.done / Math.max(1, prog.total)} label="Making audio" />
          <button className="btn btn-ghost sm" onClick={() => (cancel.current = true)}>
            Stop
          </button>
        </div>
      ) : (
        <button className="btn btn-sun" onClick={make}>
          <Icon name="wave" size={18} /> Make audio for iPhone
        </button>
      )}
      {error && <ErrorNote message={error} />}
      {files.length > 0 && (
        <div className="stack">
          <p className="hint">
            {files.length === 1 ? 'Saved to your Downloads folder.' : `Ready in ${files.length} files. Save each one.`} Then AirDrop it to your iPhone (or put it in iCloud
            Drive). On the iPhone, open this piece in Rise, tap the download button, and choose Add audio file.
          </p>
          {files.map((f) => (
            <button key={f.name} className="btn btn-ghost sm" onClick={() => saveFile(f)}>
              <Icon name="download" size={16} /> Save {f.name} ({f.mb} MB)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

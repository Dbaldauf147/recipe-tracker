import { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { subscribeMealVote, saveMealVoteSettings } from '../utils/mealVoteStore';
import {
  MEAL_VOTE_COLUMN_LABEL, MEAL_VOTE_DAY_NAMES, MEAL_VOTE_MAX_VOTERS,
  latestBallot, tallyBallot, weekLabel, normalizeMealVoteSettings,
} from '../utils/mealVote';
import { SUGGEST_CATEGORIES } from '../utils/suggestForecast';
import styles from './MealVotePanel.module.css';

const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

/**
 * The weekly meal vote on the Recipes page: this week's ballot with who voted
 * for what, and the settings for the email that collects the votes.
 *
 * Shows nothing until the vote is switched on or a ballot exists, so accounts
 * that don't use it never see it. Settings open from the Suggested Meals gear.
 */
export function MealVotePanel({
  user, settings, onSettingsChange, settingsOpen, onCloseSettings, onOpenSettings,
  weeklyPlan, onSelect, onAddToWeek, recipeIds,
}) {
  const uid = user?.uid;
  const [weeks, setWeeks] = useState({});
  useEffect(() => subscribeMealVote(uid, setWeeks), [uid]);

  const ballot = useMemo(() => latestBallot(weeks), [weeks]);

  // People vote by replying to the email, and a cron reads the replies every
  // ten minutes. Opening the page asks for a read now, so a vote sent a moment
  // ago is here without the wait; it arrives through the subscription above.
  const ballotWeek = ballot?.weekOf;
  useEffect(() => {
    if (!uid || !ballotWeek) return;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        await fetch('/api/collect-meal-vote', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // The cron will pick the replies up.
      }
    })();
  }, [uid, ballotWeek]);
  const tally = useMemo(() => (ballot ? tallyBallot(ballot) : null), [ballot]);
  const inWeek = useMemo(() => new Set(weeklyPlan || []), [weeklyPlan]);
  const clean = normalizeMealVoteSettings(settings);

  return (
    <>
      {(ballot || clean.enabled) && (
        <section className={styles.panel} aria-label="Meal vote">
          <div className={styles.headRow}>
            <h3 className={styles.heading}>
              Meal vote{ballot ? <span className={styles.week}> · week of {weekLabel(ballot.weekOf)}</span> : null}
            </h3>
            <button className={styles.linkBtn} onClick={onOpenSettings}>Settings</button>
          </div>
          {!ballot && (
            <p className={styles.empty}>
              The first email goes out {MEAL_VOTE_DAY_NAMES[clean.sendDay]} at {hourLabel(clean.sendHour)} Eastern.
              Votes show up here as they come in.
            </p>
          )}
          {ballot && tally && (
            <>
              <p className={styles.status}>
                {tally.voters.map(v => (
                  <span key={v.id} className={v.voted ? styles.voted : styles.waiting}>
                    {v.name}: {v.voted ? 'voted' : 'not yet'}
                  </span>
                ))}
              </p>
              <div className={styles.columns}>
                {SUGGEST_CATEGORIES.map(cat => (
                  <div key={cat} className={styles.column}>
                    <div className={styles.columnLabel}>{MEAL_VOTE_COLUMN_LABEL[cat]}</div>
                    {(tally.columns[cat] || []).length === 0 && <p className={styles.empty}>None offered.</p>}
                    <ul className={styles.list}>
                      {(tally.columns[cat] || []).map(row => {
                        const known = !recipeIds || recipeIds.has(row.id);
                        return (
                          <li key={row.id} className={`${styles.row}${row.voters.length ? '' : ` ${styles.rowNone}`}`}>
                            {known
                              ? <button className={styles.meal} onClick={() => onSelect?.(row.id)}>{row.title}</button>
                              : <span className={styles.mealGone}>{row.title}</span>}
                            <span className={styles.chips}>
                              {row.voters.map(name => <span key={name} className={styles.chip}>{name}</span>)}
                            </span>
                            {row.voters.length > 0 && known && onAddToWeek && (
                              inWeek.has(row.id)
                                ? <span className={styles.inWeek}>In this week</span>
                                : <button className={styles.addBtn} onClick={() => onAddToWeek(row.id)}>Add to week</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {settingsOpen && (
        <MealVoteSettings
          user={user}
          settings={clean}
          onSaved={onSettingsChange}
          onClose={onCloseSettings}
        />
      )}
    </>
  );
}

function MealVoteSettings({ user, settings, onSaved, onClose }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [voters, setVoters] = useState(() => (
    settings.voters.length > 0
      ? settings.voters.map(v => ({ ...v }))
      : [{ name: (user?.displayName || '').split(' ')[0] || '', email: user?.email || '' }, { name: '', email: '' }]
  ));
  const [sendDay, setSendDay] = useState(settings.sendDay);
  const [sendHour, setSendHour] = useState(settings.sendHour);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const draft = { enabled, voters, sendDay, sendHour };
  const valid = normalizeMealVoteSettings(draft).voters;
  const typed = voters.filter(v => v.email.trim()).length;

  function setVoter(i, patch) {
    setVoters(prev => prev.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }

  async function save() {
    if (typed !== valid.length) {
      setMessage({ bad: true, text: 'One of the email addresses isn\'t valid, or is listed twice.' });
      return null;
    }
    if (enabled && valid.length === 0) {
      setMessage({ bad: true, text: 'Add at least one voter with an email address.' });
      return null;
    }
    const saved = await saveMealVoteSettings(user.uid, draft);
    onSaved?.(saved);
    return saved;
  }

  async function handleSave() {
    setBusy('save');
    setMessage(null);
    try {
      if (await save()) onClose();
    } catch (err) {
      setMessage({ bad: true, text: `Couldn't save: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy('');
    }
  }

  async function handleSendNow() {
    setBusy('send');
    setMessage(null);
    try {
      const saved = await save();
      if (!saved) return;
      if (saved.voters.length === 0) {
        setMessage({ bad: true, text: 'Add at least one voter with an email address.' });
        return;
      }
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/send-meal-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const missed = (data.failed || []).map(f => f.email);
      setMessage({
        bad: missed.length > 0,
        text: `Sent to ${data.sentTo.join(' and ')}.${missed.length ? ` Could not send to ${missed.join(', ')}.` : ''}`,
      });
    } catch (err) {
      setMessage({ bad: true, text: err?.message || 'The email could not be sent.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Weekly meal vote email" onClick={e => e.stopPropagation()}>
        <h3 className={styles.dialogTitle}>Weekly meal vote email</h3>
        <p className={styles.dialogNote}>
          Once a week, each voter is emailed the top 5 breakfasts and top 5 lunch &amp; dinner meals from
          Suggested Meals, numbered. They vote by replying to the email with the numbers they want —
          nothing to open — and the votes show on this page within a few minutes.
        </p>
        <label className={styles.check}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Send the email every week
        </label>

        <div className={styles.fieldLabel}>Voters</div>
        {voters.map((v, i) => (
          <div key={i} className={styles.voterRow}>
            <input
              className={styles.input}
              placeholder="Name"
              aria-label={`Voter ${i + 1} name`}
              value={v.name}
              onChange={e => setVoter(i, { name: e.target.value })}
            />
            <input
              className={`${styles.input} ${styles.inputWide}`}
              type="email"
              placeholder="Email"
              aria-label={`Voter ${i + 1} email`}
              value={v.email}
              onChange={e => setVoter(i, { email: e.target.value })}
            />
            <button
              className={styles.removeBtn}
              aria-label={`Remove voter ${i + 1}`}
              onClick={() => setVoters(prev => prev.filter((_, j) => j !== i))}
            >×</button>
          </div>
        ))}
        {voters.length < MEAL_VOTE_MAX_VOTERS && (
          <button className={styles.linkBtn} onClick={() => setVoters(prev => [...prev, { name: '', email: '' }])}>+ Add a voter</button>
        )}

        <div className={styles.fieldLabel}>Send on</div>
        <div className={styles.whenRow}>
          <select className={styles.input} aria-label="Send day" value={sendDay} onChange={e => setSendDay(Number(e.target.value))}>
            {MEAL_VOTE_DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <select className={styles.input} aria-label="Send hour" value={sendHour} onChange={e => setSendHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
          <span className={styles.tz}>Eastern</span>
        </div>

        {message && <p className={message.bad ? styles.msgBad : styles.msgOk} role="status">{message.text}</p>}

        <div className={styles.actions}>
          <button className={styles.secondaryBtn} onClick={handleSendNow} disabled={!!busy}>
            {busy === 'send' ? 'Sending…' : 'Save & send now'}
          </button>
          <span className={styles.spacer} />
          <button className={styles.secondaryBtn} onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className={styles.primaryBtn} onClick={handleSave} disabled={!!busy}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

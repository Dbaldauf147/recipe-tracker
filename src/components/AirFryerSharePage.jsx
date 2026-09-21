import { useCallback, useEffect, useMemo, useState } from 'react';
import GUIDE, {
  AIR_FRYER_CATEGORIES, AIR_FRYER_RULES, airFryerKey, toCelsius,
} from '../data/airFryerGuide.js';
import { mergeAirFryerGuide, cookLegs } from '../utils/airFryerRecipes';
import { loadSharedAirFryer } from '../utils/firestoreSync';
import styles from './AirFryerSharePage.module.css';

/**
 * The air fryer table on a public url — no account, no login, no app.
 *
 * Whoever opens this was sent a link and is standing in a kitchen with a bag
 * of frozen something in one hand. So: no sign-up wall, no "open in app"
 * interstitial, nothing above the search box, and the temperature big enough
 * to read at arm's length. The one piece of Prep Day on the page is a bar at
 * the top they can ignore.
 *
 * READ-ONLY BY CONSTRUCTION. There is no writer here at all — the owner's page
 * (AirFryerPage) owns every edit, and this file only ever draws. That's also
 * why the built-in table is imported from the same module rather than sent
 * over the wire: the response carries only what its owner CHANGED, which keeps
 * it tiny and keeps the two pages from ever showing different built-ins.
 */
export function AirFryerSharePage({ token }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | error
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSharedAirFryer(token)
      .then(d => {
        if (cancelled) return;
        if (!d) { setState('missing'); return; }
        setData(d);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [token]);

  // The owner's table: the built-in rows, their edits layered on, their own
  // rows added, anything they hid taken out.
  const rows = useMemo(
    () => mergeAirFryerGuide(GUIDE, data?.rows || [], data?.hidden || []),
    [data],
  );

  // Memoized rather than `data?.spices || {}` inline: a fresh {} on every
  // render would re-run the filter and the grouping on every keystroke.
  const spices = useMemo(() => data?.spices || {}, [data]);
  const oils = useMemo(() => data?.oils || {}, [data]);
  const timeNotes = useMemo(() => data?.timeNotes || {}, [data]);
  const names = useMemo(() => data?.names || {}, [data]);

  // The name the owner calls it, which is what they'd say out loud if you
  // asked them. The guide's own wording rides along in the search text so
  // looking up "chicken breast" still finds the row they call "cutlets".
  const displayName = useCallback(
    (row) => names[airFryerKey(row.name)] || row.name,
    [names],
  );

  // Only the categories that survived hiding — an empty chip is a dead end.
  const liveCats = useMemo(() => {
    const present = new Set(rows.map(r => r.cat).filter(Boolean));
    const known = AIR_FRYER_CATEGORIES.filter(c => present.has(c));
    const extra = Array.from(present).filter(c => !AIR_FRYER_CATEGORIES.includes(c)).sort();
    return [...known, ...extra];
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (cat && r.cat !== cat) return false;
      if (!q) return true;
      const key = airFryerKey(r.name);
      const hay = [
        r.name, names[key], r.note, r.stop,
        ...(spices[key] || []), ...(oils[key] || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, cat, names, spices, oils]);

  // Grouped by category, in the guide's own order. A stranger has no "this
  // week's shopping list" to sort by, so the shape of the page is the shape of
  // the food: all the chicken together, all the frozen things together.
  const groups = useMemo(() => {
    const byCat = new Map();
    for (const r of visible) {
      const c = r.cat || 'Other';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(r);
    }
    const order = [...liveCats, 'Other'];
    return order
      .filter(c => byCat.has(c))
      .map(c => [c, byCat.get(c).sort((a, b) => displayName(a).localeCompare(displayName(b)))]);
  }, [visible, liveCats, displayName]);

  const sharedBy = (data?.sharedByName || '').trim();

  const brandBar = (
    <header className={styles.brandBar}>
      <a className={styles.brandLink} href={window.location.origin}>
        <img className={styles.brandLogo} src="/prep-day-logo.png" alt="" />
        <span className={styles.brandName}>Prep Day</span>
      </a>
      <a className={styles.brandCta} href={window.location.origin}>Try it free</a>
    </header>
  );

  if (state === 'loading') {
    return <div className={styles.page}>{brandBar}<div className={styles.status}>Loading…</div></div>;
  }
  if (state === 'missing') {
    return (
      <div className={styles.page}>
        {brandBar}
        <div className={styles.status}>This link has expired or was turned off.</div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className={styles.page}>
        {brandBar}
        <div className={styles.status}>
          Couldn’t load the table.
          <button className={styles.retry} onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {brandBar}

      <div className={styles.container}>
        <div className={styles.head}>
          <h1 className={styles.title}>Air fryer times &amp; temperatures</h1>
          <p className={styles.sub}>
            {sharedBy ? `${sharedBy}’s table.` : 'A shared table.'}{' '}
            Every time assumes a preheated basket and one uncrowded layer.
          </p>
        </div>

        <input
          className={styles.search}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search — salmon, wings, frozen fries…"
          type="search"
          autoComplete="off"
        />

        <div className={styles.chips}>
          <button
            className={`${styles.chip} ${!cat ? styles.chipOn : ''}`}
            onClick={() => setCat('')}
          >All</button>
          {liveCats.map(c => (
            <button
              key={c}
              className={`${styles.chip} ${cat === c ? styles.chipOn : ''}`}
              onClick={() => setCat(cat === c ? '' : c)}
            >{c}</button>
          ))}
        </div>

        {/* The rules that apply to every row. Collapsed, because a visitor who
            came for "how long do wings take" shouldn't have to scroll six
            bullet points to reach the search box — but expandable, because
            unlike the owner they've never read them. */}
        <button className={styles.rulesToggle} onClick={() => setShowRules(v => !v)}>
          {showRules ? 'Hide the basics' : 'The basics — read these once'}
        </button>
        {showRules && (
          <ul className={styles.rules}>
            {AIR_FRYER_RULES.map(r => <li key={r}>{r}</li>)}
          </ul>
        )}

        {visible.length === 0 ? (
          <div className={styles.empty}>
            {query.trim() ? `Nothing for “${query.trim()}”.` : 'Nothing in this table yet.'}
          </div>
        ) : (
          groups.map(([c, list]) => (
            <section key={c} className={styles.group}>
              <h2 className={styles.groupHead}>
                {c}<span className={styles.groupCount}>{list.length}</span>
              </h2>
              <ul className={styles.list}>
                {list.map(row => (
                  <Row
                    key={airFryerKey(row.name)}
                    row={row}
                    name={displayName(row)}
                    spices={spices[airFryerKey(row.name)] || []}
                    oils={oils[airFryerKey(row.name)] || []}
                    notes={timeNotes[airFryerKey(row.name)] || {}}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        <p className={styles.foot}>
          Times are a guide — fryers vary by hundreds of watts. Start at the low
          end; meat is done at its internal temperature, not the clock.
        </p>
      </div>
    </div>
  );
}

/**
 * One ingredient.
 *
 * A card, not a table row, at every width. The owner's page is a real table
 * because they're scanning thirty rows against a shopping list on a laptop;
 * whoever opens this link is on a phone looking up exactly one thing, and a
 * seven-column table on a phone is how you end up reading 18 next to the wrong
 * name. The card puts the answer — temperature, then the cook as a sequence —
 * on its own line under the name, at a size that survives a kitchen.
 */
function Row({ row, name, spices, oils, notes }) {
  const legs = cookLegs(row);
  const min = Number(row.min) || 0;
  const max = Number(row.max) || 0;
  const single = !min || !max || min === max;
  // The owner's notes on each end of the range: "18 min — still soft".
  const ends = [
    !single && notes.low ? { mins: min, text: notes.low } : null,
    !single && notes.high ? { mins: max, text: notes.high } : null,
    single && (notes.low || notes.high) ? { mins: min || max, text: notes.low || notes.high } : null,
  ].filter(Boolean);

  return (
    <li className={styles.row}>
      <div className={styles.rowName}>
        {name}
        {row.doneF ? <span className={styles.done}>done at {row.doneF}°F</span> : null}
      </div>

      <div className={styles.nums}>
        <span className={styles.temp}>
          {row.tempF ? `${row.tempF}°F` : '—'}
          {row.tempF ? <span className={styles.tempC}>{toCelsius(row.tempF)}°C</span> : null}
        </span>
        {/* The cook read left to right the way you do it: ten minutes, flip,
            another fifteen. "No flip" is a real answer, not a blank. */}
        <span className={styles.legs}>
          <span className={styles.legTime}>{legs.first || '—'}</span>
          <span className={styles.legAction}>{legs.action}</span>
          {/* No trailing dash on a row with nothing after the stop. The owner's
              page needs one to hold its column open; a card has no column, so
              "22–26 min · NO FLIP ·  —" would just be a dangling mark. */}
          {legs.second && <span className={styles.legTime}>{legs.second}</span>}
        </span>
      </div>

      {(spices.length > 0 || oils.length > 0) && (
        <div className={styles.tags}>
          {spices.length > 0 && (
            <span className={styles.tagGroup}>
              <span className={styles.tagLabel}>Spices</span>
              {spices.map(s => <span key={s} className={styles.tag}>{s}</span>)}
            </span>
          )}
          {oils.length > 0 && (
            <span className={styles.tagGroup}>
              <span className={styles.tagLabel}>Oil / sauce</span>
              {oils.map(s => <span key={s} className={`${styles.tag} ${styles.tagOil}`}>{s}</span>)}
            </span>
          )}
        </div>
      )}

      {ends.length > 0 && (
        <ul className={styles.timeNotes}>
          {ends.map(e => (
            <li key={e.mins + e.text}>
              <strong>{e.mins} min</strong> — {e.text}
            </li>
          ))}
        </ul>
      )}

      {/* The one thing that makes it come out right. Shown outright rather
          than behind a tap: the owner already knows it, a stranger doesn't,
          and it's the difference between crisp and pale. */}
      {row.note && <p className={styles.note}>{row.note}</p>}
    </li>
  );
}

export default AirFryerSharePage;

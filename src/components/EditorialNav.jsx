import styles from './EditorialNav.module.css';

/**
 * Navigation for the optional Editorial layout: a slim icon rail that widens
 * into a grouped menu on hover or keyboard focus, floating over the page rather
 * than pushing it. On a phone it is the same slide-in drawer as the classic
 * sidebar, opened by the same button.
 *
 * It renders only what it is handed — `groups` comes from the classic sidebar's
 * already-filtered entries, and `children` is the very same Settings block the
 * classic sidebar shows — so there is no second copy of the navigation rules.
 */
export function EditorialNav({ groups, view, homeActive, onHome, onNav, badges = {}, open, pinned, bottomAlert, children }) {
  return (
    <aside
      className={`${styles.rail}${open ? ` ${styles.open}` : ''}${pinned ? ` ${styles.pinned}` : ''}`}
      aria-label="Main navigation"
      data-layout="editorial"
    >
      <div className={styles.inner}>
        <button type="button" className={styles.brand} onClick={onHome} aria-label="Prep Day home">
          <span className={styles.mark} aria-hidden="true">P</span>
          <span className={styles.brandText}>
            <span className={styles.wordmark}>Prep Day</span>
            <span className={styles.tagline}>The Digital Epicurean</span>
          </span>
        </button>

        <nav className={styles.nav}>
          <button
            type="button"
            className={`${styles.item}${homeActive ? ` ${styles.itemActive}` : ''}`}
            onClick={onHome}
            aria-current={homeActive ? 'page' : undefined}
            title="Home"
          >
            <span className={`material-symbols-outlined ${styles.icon}`} aria-hidden="true">home</span>
            <span className={styles.label}>Home</span>
          </button>

          {groups.map(group => (
            <div key={group.key} className={styles.group} role="group" aria-label={group.label}>
              <div className={styles.groupLabel} aria-hidden="true"><span>{group.label}</span></div>
              {group.items.map(item => {
                const key = item.action || item.id;
                const active = item.action ? view === item.action : view === 'list';
                const badge = badges[key];
                return (
                  <button
                    type="button"
                    key={key}
                    className={`${styles.item}${active ? ` ${styles.itemActive}` : ''}`}
                    onClick={() => onNav(item)}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className={`material-symbols-outlined ${styles.icon}`} aria-hidden="true">{item.icon}</span>
                    <span className={styles.label}>{item.label}</span>
                    {badge > 0 && <span className={styles.badge} aria-label={`${badge} outstanding`}>{badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.bottom}>
          {children}
          {bottomAlert && <span className={styles.bottomDot} aria-hidden="true" />}
        </div>
      </div>
    </aside>
  );
}

import styles from './StarRating.module.css';
import { MAX_STARS, ratingSummary, ratingDetail } from '../utils/mealRating';

// One star, filled `fill` of the way across (0–1). The fill is drawn as a
// clipped copy laid over the empty star rather than as a half-star glyph, so
// the half is exactly half at any font size.
function Star({ fill }) {
  const clamped = Math.max(0, Math.min(1, fill));
  return (
    <span className={styles.star} aria-hidden="true">
      <span className={styles.starEmpty}>★</span>
      {clamped > 0 && (
        <span className={styles.starFill} style={{ width: `${clamped * 100}%` }}>★</span>
      )}
    </span>
  );
}

/**
 * `rating` is a result from mealRating.rateRecipe — or null, which renders
 * nothing at all. A recipe whose nutrition has never been computed has no
 * rating to show, and five empty stars would read as a bad one.
 */
export function StarRating({ rating, size = '0.85rem', showCount = false, className = '' }) {
  if (!rating) return null;
  const detail = ratingDetail(rating);
  return (
    <span
      className={`${styles.wrap} ${className}`}
      style={{ fontSize: size }}
      title={detail ? `${ratingSummary(rating)}\n\n${detail}` : ratingSummary(rating)}
      role="img"
      aria-label={ratingSummary(rating)}
    >
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <Star key={i} fill={rating.stars - i} />
      ))}
      {showCount && (
        <span className={styles.count}>{rating.met}/{rating.total}</span>
      )}
    </span>
  );
}

export default StarRating;

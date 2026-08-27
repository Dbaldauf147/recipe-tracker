/**
 * Local calendar day keys.
 *
 * `new Date().toISOString().slice(0, 10)` is the tempting one-liner and it is
 * wrong west of UTC: at UTC-4 it returns TOMORROW from 8pm local onwards. Every
 * place that stamped "today" onto user data that way filed an evening entry
 * under the next day — a workout logged Tuesday night landing on Wednesday, an
 * evening weigh-in dated tomorrow — and any "days ago" figure measured from the
 * real local today then disagreed with it by one.
 *
 * These build the key from local calendar parts instead, so the key always
 * matches the date the user sees on their own clock.
 */

const pad2 = (v) => String(v).padStart(2, '0');

/** 'YYYY-MM-DD' for `d` in the local timezone. */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' for today, local. */
export function todayKey() {
  return dayKey(new Date());
}

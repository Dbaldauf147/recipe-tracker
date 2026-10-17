// Click a number in the Suggested Meals "why?" table → how that number was
// worked out, for that one meal. Pure, so node --test can check the sums.
//
// `item` is a suggestions row from RecipeList: { recipe, seasonalMatches,
// breakdown: { lastCooked, recipeDays, requeued, ingredientDetails,
// macroScore, macroDetail, boostBonus, totalScore, seasonalRaw, macroRaw,
// stalenessPoints, ingredientPoints, seasonalBonus, macroBonus } } and
// `weights` the suggestWeights map read through `weightFor`.

const NEVER = 9999;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(key) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return key || '';
  const [y, m, d] = key.split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}`;
}
const n = (x) => Math.round(x).toLocaleString('en-US');
const pct = (x) => `${Math.round(x)}%`;

/** " × 2 (weight) = 40" — or nothing extra when the weight is 1. */
function weighted(raw, w) {
  if (w === 1) return ` = ${n(raw)}`;
  return ` = ${n(raw)} × ${w} (weight) = ${n(raw * w)}`;
}

/**
 * { title, lines: string[], formula: string } for one term of one meal.
 * term: 'staleness' | 'ingredients' | 'seasonal' | 'macro' | 'total'.
 */
export function explainScoreTerm(term, item, weightFor) {
  const b = item.breakdown;
  const w = (key) => weightFor(key);

  if (term !== 'total' && w(term) === 0) {
    const name = { staleness: 'Days since cooked', ingredients: 'Key ingredients', seasonal: 'In season', macro: 'Macro fit' }[term];
    return { title: name, lines: ['This term is switched off in the weights above, so it adds nothing.'], formula: '0' };
  }

  if (term === 'staleness') {
    const lines = [];
    if (b.recipeDays === NEVER) {
      lines.push('Never cooked, as far as the log shows, so it counts as 9,999 days (that keeps it near the top until you make it).');
    } else if (b.requeued) {
      lines.push(`Sent to the back of the line on ${shortDate(b.lastCooked)}, so that counts as the last time you ate it.`);
      lines.push(`That was ${n(b.recipeDays)} day${b.recipeDays === 1 ? '' : 's'} ago.`);
    } else {
      lines.push(`Last cooked ${shortDate(b.lastCooked)}, ${n(b.recipeDays)} day${b.recipeDays === 1 ? '' : 's'} ago.`);
    }
    lines.push('One point per day since you last had it.');
    return { title: 'Days since cooked', lines, formula: `${n(b.recipeDays)} days${weighted(b.recipeDays, w('staleness'))}` };
  }

  if (term === 'ingredients') {
    const det = b.ingredientDetails || [];
    if (det.length === 0) {
      return { title: 'Key ingredients', lines: ['None of your key ingredients are in this meal.'], formula: '0' };
    }
    const lines = det.map(d => d.days === NEVER
      ? `${d.label}: never eaten → 9,999 days`
      : `${d.label}: last eaten ${shortDate(d.lastEaten)} → ${n(d.days)} day${d.days === 1 ? '' : 's'}`);
    lines.push('Each key ingredient adds the days since you last ate it.');
    const sum = det.map(d => n(d.days)).join(' + ');
    return {
      title: 'Key ingredients',
      lines,
      formula: `${det.length > 1 ? sum : `${n(b.ingredientScore)} days`}${weighted(b.ingredientScore, w('ingredients'))}`,
    };
  }

  if (term === 'seasonal') {
    const m = item.seasonalMatches || [];
    if (m.length === 0) {
      return { title: 'In season', lines: ['Nothing in this meal is in season where you are this month.'], formula: '0' };
    }
    return {
      title: 'In season',
      lines: [`In season now: ${m.join(', ')}.`, '50 points for each in-season ingredient.'],
      formula: `${m.length} × 50${weighted(b.seasonalRaw, w('seasonal'))}`,
    };
  }

  if (term === 'macro') {
    const md = b.macroDetail;
    if (!md) {
      return {
        title: 'Macro fit',
        lines: ['No macro score: this browser has no nutrition for the meal yet, or no calorie goal is set.'],
        formula: '0',
      };
    }
    const gaps = ['protein', 'carbs', 'fat'].map(k => Math.abs(md.meal[k] - md.goal[k]));
    const avg = (gaps[0] + gaps[1] + gaps[2]) / 3;
    const lines = [
      `This meal’s calories: protein ${pct(md.meal.protein)} · carbs ${pct(md.meal.carbs)} · fat ${pct(md.meal.fat)}.`,
      `Your goal: protein ${pct(md.goal.protein)} · carbs ${pct(md.goal.carbs)} · fat ${pct(md.goal.fat)}.`,
      `Average gap ${avg.toFixed(1)} points → fit ${md.score}/100 (100 minus 3⅓ per point of gap, never below 0).`,
      'The fit counts double.',
    ];
    return { title: 'Macro fit', lines, formula: `${md.score} × 2${weighted(b.macroRaw, w('macro'))}` };
  }

  // total
  const parts = [
    ['Days', b.stalenessPoints],
    ['Ingredients', b.ingredientPoints],
    ['Season', b.seasonalBonus],
    ['Macro', b.macroBonus],
  ];
  if (b.boostBonus) parts.push(['Boost', b.boostBonus]);
  return {
    title: 'Score',
    lines: ['The four terms added up. The column is sorted by this, highest first.'],
    formula: `${parts.map(([k, v]) => `${k} ${n(v)}`).join(' + ')} = ${n(b.totalScore)}`,
  };
}

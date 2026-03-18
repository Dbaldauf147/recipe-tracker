import { useState, useEffect, useRef, useCallback } from 'react';
import { NUTRIENTS } from '../utils/nutrition';
import styles from './NutritionGoalsPage.module.css';

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'transFat', 'cholesterol'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'phosphorus', 'selenium', 'copper', 'manganese', 'chromium'];
const VITAMINS = ['vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminK', 'vitaminB1', 'vitaminB2', 'vitaminB3', 'vitaminB5', 'vitaminB6', 'vitaminB7', 'vitaminB9', 'vitaminB12'];
const AMINO_ACIDS = ['leucine', 'isoleucine', 'valine', 'histidine', 'lysine', 'methionine', 'phenylalanine', 'threonine', 'tryptophan'];
const FATTY_ACIDS = ['omega3', 'omega6'];

// Custom goals not in the USDA NUTRIENTS list
const CUSTOM_GOALS = [
  { key: 'fruitServings', label: 'Fruit Servings', unit: 'servings', decimals: 0 },
  { key: 'vegServings', label: 'Vegetable Servings', unit: 'servings', decimals: 0 },
];

const PLATE_GOALS = [
  { key: 'plateProtein', label: 'Protein', unit: '%', decimals: 0 },
  { key: 'plateCarbs', label: 'Carbs', unit: '%', decimals: 0 },
  { key: 'plateFat', label: 'Fat', unit: '%', decimals: 0 },
];

const GROUPS = [
  { title: 'Macros', keys: MACROS },
  { title: 'Sugars & Fiber', keys: SUGARS_FIBER },
  { title: 'Minerals', keys: MINERALS },
  { title: 'Vitamins', keys: VITAMINS },
  { title: 'Amino Acids', keys: AMINO_ACIDS },
  { title: 'Fatty Acids', keys: FATTY_ACIDS },
];

const DEFAULT_TARGETS = {
  calories: 2000,
  protein: 50,
  carbs: 275,
  fat: 78,
  saturatedFat: 20,
  transFat: 0,
  cholesterol: 300,
  sugar: 50,
  addedSugar: 25,
  fiber: 28,
  sodium: 2300,
  potassium: 4700,
  calcium: 1000,
  iron: 18,
  magnesium: 420,
  zinc: 11,
  phosphorus: 700,
  selenium: 55,
  copper: 0.9,
  manganese: 2.3,
  chromium: 35,
  vitaminA: 900,
  vitaminC: 90,
  vitaminD: 20,
  vitaminE: 15,
  vitaminK: 120,
  vitaminB1: 1.2,
  vitaminB2: 1.3,
  vitaminB3: 16,
  vitaminB5: 5,
  vitaminB6: 1.7,
  vitaminB7: 30,
  vitaminB9: 400,
  vitaminB12: 2.4,
  leucine: 2.5,
  isoleucine: 1.3,
  valine: 1.8,
  histidine: 1.0,
  lysine: 2.1,
  methionine: 0.7,
  phenylalanine: 1.1,
  threonine: 1.0,
  tryptophan: 0.28,
  omega3: 1.6,
  omega6: 17,
  fruitServings: 4,
  vegServings: 5,
  fermentedFoods: 2,
  plateProtein: 30,
  plateCarbs: 45,
  plateFat: 25,
};

const DEFAULT_SELECTED = new Set(['calories', 'protein', 'carbs', 'fat']);

const WEIGHT_GOALS = [
  { key: 'lose',       label: 'Lose Weight',    calOffset: -500, proteinMult: 1.1, carbPct: 0.40, fatPct: 0.35 },
  { key: 'maintain',   label: 'Maintain',       calOffset: 0,    proteinMult: 1.0, carbPct: 0.50, fatPct: 0.30 },
  { key: 'gain',       label: 'Gain Weight',    calOffset: 400,  proteinMult: 1.0, carbPct: 0.55, fatPct: 0.25 },
  { key: 'muscle',     label: 'Build Muscle',   calOffset: 300,  proteinMult: 1.3, carbPct: 0.45, fatPct: 0.25 },
];

// Keep BODY_GOALS reference for computeTargets compatibility
const BODY_GOALS = WEIGHT_GOALS;

const MEAL_TRACKING_GOALS = [
  { key: 'trackDaily',  label: 'Track Meals Daily' },
  { key: 'trackWeekly', label: 'Track Meals Weekly' },
  { key: 'weighFood',   label: 'Weigh Food' },
];

const FRUIT_VEG_GOALS = [
  { key: 'trackFruit', label: 'Track Fruit Servings' },
  { key: 'trackVeg',   label: 'Track Vegetable Servings' },
];

const ACTIVITY_LEVELS = [
  { key: 'sedentary',  label: 'Sedentary',       desc: 'Little or no exercise',          multiplier: 1.2,  proteinPerLb: 0.6 },
  { key: 'light',      label: 'Lightly Active',  desc: 'Exercise 1-2 days/week',         multiplier: 1.375, proteinPerLb: 0.7 },
  { key: 'moderate',   label: 'Moderately Active', desc: 'Exercise 3-5 days/week',       multiplier: 1.55, proteinPerLb: 0.8 },
  { key: 'active',     label: 'Very Active',     desc: 'Hard exercise 6-7 days/week',    multiplier: 1.725, proteinPerLb: 0.9 },
];

function computeTargets(gender, heightFt, heightIn, weight, age, activityLevel, bodyGoalKey) {
  const kg = Math.round(weight / 2.205 * 10) / 10;
  const totalInches = heightFt * 12 + heightIn;
  const cm = Math.round(totalInches * 2.54 * 10) / 10;

  // Mifflin-St Jeor BMR
  let bmr;
  if (gender === 'male') {
    bmr = (10 * kg) + (6.25 * cm) - (5 * age) + 5;
  } else {
    bmr = (10 * kg) + (6.25 * cm) - (5 * age) - 161;
  }
  bmr = Math.round(bmr);

  const activity = ACTIVITY_LEVELS.find(a => a.key === activityLevel) || ACTIVITY_LEVELS[2];
  const goal = BODY_GOALS.find(g => g.key === bodyGoalKey) || BODY_GOALS[1];
  const tdeeBase = Math.round(bmr * activity.multiplier);
  const tdee = tdeeBase + goal.calOffset;

  const proteinG = Math.round(weight * activity.proteinPerLb * goal.proteinMult);
  const carbsG = Math.round((tdee * goal.carbPct) / 4);
  const fatG = Math.round((tdee * goal.fatPct) / 9);

  return {
    targets: {
      calories: tdee,
      protein: proteinG,
      carbs: carbsG,
      fat: fatG,
      saturatedFat: Math.round((tdee * 0.10) / 9),
      transFat: 0,
      cholesterol: 300,
      sugar: Math.round(tdee * 0.025),
      addedSugar: 25,
      fiber: Math.round(tdee / 1000 * 14),
      sodium: 2300,
      potassium: 4700,
      calcium: 1000,
      iron: gender === 'male' ? 8 : 18,
      magnesium: gender === 'male' ? 420 : 320,
      zinc: gender === 'male' ? 11 : 8,
      phosphorus: 700,
      selenium: 55,
      copper: 0.9,
      manganese: gender === 'male' ? 2.3 : 1.8,
      chromium: gender === 'male' ? 35 : 25,
      vitaminA: gender === 'male' ? 900 : 700,
      vitaminC: gender === 'male' ? 90 : 75,
      vitaminD: 20,
      vitaminE: 15,
      vitaminK: gender === 'male' ? 120 : 90,
      vitaminB1: gender === 'male' ? 1.2 : 1.1,
      vitaminB2: gender === 'male' ? 1.3 : 1.1,
      vitaminB3: gender === 'male' ? 16 : 14,
      vitaminB5: 5,
      vitaminB6: 1.7,
      vitaminB7: 30,
      vitaminB9: 400,
      vitaminB12: 2.4,
      leucine: bodyGoalKey === 'muscle' ? 3.0 : 2.5,
      isoleucine: bodyGoalKey === 'muscle' ? 1.5 : 1.3,
      valine: bodyGoalKey === 'muscle' ? 2.1 : 1.8,
      histidine: 1.0,
      lysine: bodyGoalKey === 'muscle' ? 2.5 : 2.1,
      methionine: 0.7,
      phenylalanine: 1.1,
      threonine: 1.0,
      tryptophan: 0.28,
      omega3: gender === 'male' ? 1.6 : 1.1,
      omega6: gender === 'male' ? 17 : 12,
      fruitServings: 4,
      vegServings: 5,
      fermentedFoods: 2,
      plateProtein: (() => { const p = Math.round((proteinG * 4 / tdee) * 100); return p; })(),
      plateCarbs: Math.round((carbsG * 4 / tdee) * 100),
      plateFat: (() => { const p = Math.round((proteinG * 4 / tdee) * 100); const c = Math.round((carbsG * 4 / tdee) * 100); return 100 - p - c; })(),
    },
    math: {
      kg,
      cm,
      bmr,
      activityMultiplier: activity.multiplier,
      activityLabel: activity.label,
      tdeeBase,
      goalLabel: goal.label,
      calOffset: goal.calOffset,
      tdee,
      proteinPerLb: activity.proteinPerLb,
      proteinMult: goal.proteinMult,
      proteinG,
      carbPct: goal.carbPct,
      carbsG,
      fatPct: goal.fatPct,
      fatG,
      gender,
    },
  };
}

const WEIGHT_KEY = 'sunday-weight-log';

function getWeightTrend() {
  try {
    const log = JSON.parse(localStorage.getItem(WEIGHT_KEY) || '[]');
    if (log.length < 2) return null;
    // Look at last 4 weeks
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const recent = log.filter(e => e.date >= cutoffStr);
    if (recent.length < 2) {
      // Fall back to last 2 entries
      const last = log[log.length - 1].weight;
      const prev = log[log.length - 2].weight;
      const change = last - prev;
      return { change: Math.round(change * 10) / 10, direction: change > 0.3 ? 'up' : change < -0.3 ? 'down' : 'stable' };
    }
    const first = recent[0].weight;
    const last = recent[recent.length - 1].weight;
    const change = last - first;
    return { change: Math.round(change * 10) / 10, direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'stable' };
  } catch { return null; }
}

export function NutritionGoalsPage({ onComplete, onBack, onSkip, initialSelected, initialTargets, initialStats }) {
  const isSettings = !!initialTargets;
  const [selected, setSelected] = useState(() =>
    initialSelected ? new Set(initialSelected) : new Set(DEFAULT_SELECTED)
  );
  const [targets, setTargets] = useState(() =>
    initialTargets ? { ...DEFAULT_TARGETS, ...initialTargets } : { ...DEFAULT_TARGETS }
  );

  const [gender, setGender] = useState(() => initialStats?.gender || '');
  const [heightFt, setHeightFt] = useState(() => initialStats?.heightFt ?? '');
  const [heightIn, setHeightIn] = useState(() => initialStats?.heightIn ?? '');
  const [weight, setWeight] = useState(() => initialStats?.weight ?? '');
  const [age, setAge] = useState(() => initialStats?.age ?? '');
  const [activityLevel, setActivityLevel] = useState(() => initialStats?.activityLevel || '');
  const [weightGoals, setWeightGoals] = useState(() => {
    if (initialStats?.weightGoals) return new Set(initialStats.weightGoals);
    if (initialStats?.bodyGoals) return new Set(initialStats.bodyGoals);
    if (initialStats?.bodyGoal) return new Set([initialStats.bodyGoal]);
    return new Set(['maintain']);
  });
  const [mealTrackingGoals, setMealTrackingGoals] = useState(() => {
    if (initialStats?.mealTrackingGoals) return new Set(initialStats.mealTrackingGoals);
    if (initialStats?.trackingMode) return new Set([initialStats.trackingMode === 'weekly' ? 'trackWeekly' : 'trackDaily']);
    return new Set(['trackDaily']);
  });
  const [fruitVegGoals, setFruitVegGoals] = useState(() => {
    return new Set(initialStats?.fruitVegGoals || []);
  });
  const [macroApproach, setMacroApproach] = useState(() => initialStats?.macroApproach || '');
  const [trackPlate, setTrackPlate] = useState(() => initialStats?.trackPlate || false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(!isSettings); // new setup is always "dirty"
  const [mathBreakdown, setMathBreakdown] = useState(null);
  const [macroMode, setMacroMode] = useState('grams'); // 'grams' or 'percent'
  const [macroPcts, setMacroPcts] = useState(() => {
    const cal = initialTargets?.calories || DEFAULT_TARGETS.calories;
    const p = Math.round(((initialTargets?.protein || DEFAULT_TARGETS.protein) * 4 / cal) * 100);
    const c = Math.round(((initialTargets?.carbs || DEFAULT_TARGETS.carbs) * 4 / cal) * 100);
    return {
      protein: p,
      carbs: c,
      fat: 100 - p - c,
    };
  });

  // Recalculate targets when all stats are filled
  useEffect(() => {
    const ft = Number(heightFt);
    const inch = Number(heightIn);
    const w = Number(weight);
    const a = Number(age);
    if (gender && ft > 0 && inch >= 0 && w > 0 && a > 0) {
      // Use the primary calorie-affecting goal for computation
      const calorieGoals = ['lose', 'maintain', 'gain', 'muscle'];
      const primaryGoal = calorieGoals.find(g => weightGoals.has(g)) || 'maintain';
      const { targets: computed, math } = computeTargets(gender, ft, inch, w, a, activityLevel, primaryGoal);
      setTargets(prev => ({ ...prev, ...computed }));
      setMathBreakdown(math);
    } else {
      setMathBreakdown(null);
    }
  }, [gender, heightFt, heightIn, weight, age, activityLevel, weightGoals]);

  const autoSaveRef = useRef(null);
  const savedTimerRef = useRef(null);
  const initialRender = useRef(true);

  const doAutoSave = useCallback(() => {
    if (!isSettings) return;
    const result = {};
    for (const key of selected) {
      result[key] = targets[key];
    }
    const stats = {};
    if (gender) stats.gender = gender;
    if (heightFt !== '') stats.heightFt = Number(heightFt);
    if (heightIn !== '') stats.heightIn = Number(heightIn);
    if (weight !== '') stats.weight = Number(weight);
    if (age !== '') stats.age = Number(age);
    if (activityLevel) stats.activityLevel = activityLevel;
    if (weightGoals.size > 0) stats.weightGoals = [...weightGoals];
    if (mealTrackingGoals.size > 0) stats.mealTrackingGoals = [...mealTrackingGoals];
    if (fruitVegGoals.size > 0) stats.fruitVegGoals = [...fruitVegGoals];
    if (macroApproach) stats.macroApproach = macroApproach;
    stats.trackPlate = trackPlate;
    onComplete(result, Object.keys(stats).length > 0 ? stats : null);
    setSaved(true);
    setDirty(false);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, [isSettings, selected, targets, gender, heightFt, heightIn, weight, age, activityLevel, weightGoals, mealTrackingGoals, fruitVegGoals, macroApproach, trackPlate, onComplete]);

  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
    setSaved(false);
    if (isSettings) {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(doAutoSave, 1000);
    }
    return () => clearTimeout(autoSaveRef.current);
  }, [gender, heightFt, heightIn, weight, age, activityLevel, weightGoals, mealTrackingGoals, fruitVegGoals, macroApproach, trackPlate, selected, targets]); // eslint-disable-line react-hooks/exhaustive-deps

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function toggle(key) {
    markDirty();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setTarget(key, value) {
    markDirty();
    setTargets(prev => ({ ...prev, [key]: value }));
    // If changing calories in percent mode, recalculate grams
    if (key === 'calories' && macroMode === 'percent') {
      const cal = value || 1;
      setTargets(prev => ({
        ...prev,
        [key]: value,
        protein: Math.round((macroPcts.protein / 100) * cal / 4),
        carbs: Math.round((macroPcts.carbs / 100) * cal / 4),
        fat: Math.round((macroPcts.fat / 100) * cal / 9),
      }));
    }
  }

  function setMacroPct(macro, pct) {
    markDirty();
    const newPcts = { ...macroPcts, [macro]: pct };
    setMacroPcts(newPcts);
    const cal = targets.calories || 1;
    const calPerG = macro === 'fat' ? 9 : 4;
    setTargets(prev => ({
      ...prev,
      [macro]: Math.round((pct / 100) * cal / calPerG),
    }));
  }

  function switchToPercentMode() {
    setMacroMode('percent');
    const cal = targets.calories || 1;
    const p = Math.round((targets.protein * 4 / cal) * 100);
    const c = Math.round((targets.carbs * 4 / cal) * 100);
    setMacroPcts({ protein: p, carbs: c, fat: 100 - p - c });
  }

  function handleContinue() {
    const result = {};
    for (const key of selected) {
      result[key] = targets[key];
    }
    const stats = {};
    if (gender) stats.gender = gender;
    if (heightFt !== '') stats.heightFt = Number(heightFt);
    if (heightIn !== '') stats.heightIn = Number(heightIn);
    if (weight !== '') stats.weight = Number(weight);
    if (age !== '') stats.age = Number(age);
    if (activityLevel) stats.activityLevel = activityLevel;
    if (weightGoals.size > 0) stats.weightGoals = [...weightGoals];
    if (mealTrackingGoals.size > 0) stats.mealTrackingGoals = [...mealTrackingGoals];
    if (fruitVegGoals.size > 0) stats.fruitVegGoals = [...fruitVegGoals];
    if (macroApproach) stats.macroApproach = macroApproach;
    stats.trackPlate = trackPlate;
    onComplete(result, Object.keys(stats).length > 0 ? stats : null);
    if (isSettings) {
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack}>
            &larr; Back
          </button>
        )}
        <h2 className={styles.title}>Own Your Nutrition</h2>
        <div className={styles.topRight}>
          <div className={styles.saveRow}>
            {saved && <span className={styles.savedMsg}>Saved!</span>}
            {!isSettings && (
              <button
                className={styles.continueBtn}
                onClick={handleContinue}
                disabled={selected.size === 0}
              >
                Continue
              </button>
            )}
          </div>
          {onSkip && (
            <button className={styles.skipBtn} onClick={onSkip}>
              Skip for now
            </button>
          )}
        </div>
      </div>
      <div className={styles.twoCol}>
        <div className={styles.card}>
          <p className={styles.subtitle}>Enter your info to get personalized targets, or set them manually.</p>
          <div className={styles.goalsAndInfo}>
            <div className={styles.goalsCol}>
              <h4 className={styles.groupTitle}>Goals</h4>
              <table className={styles.goalsTable}>
                <tbody>
                  <tr>
                    <td className={styles.goalsTableLabel}>Weight Goal</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'lose', label: 'Lose Weight' }, { key: 'maintain', label: 'Maintain' }, { key: 'gain', label: 'Gain Weight' }].map(g => (
                        <button key={g.key} type="button" className={weightGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { if (weightGoals.has(g.key)) { setWeightGoals(prev => { const next = new Set(prev); next.delete(g.key); return next; }); } else { setWeightGoals(new Set([g.key])); } }}>{g.label}</button>
                      ))}
                      {!['lose', 'maintain', 'gain'].some(k => weightGoals.has(k)) && (
                        <span className={styles.goalNotTracked}>Weight not tracked</span>
                      )}
                      {['lose', 'maintain', 'gain'].some(k => weightGoals.has(k)) && (() => {
                        const trend = getWeightTrend();
                        if (!trend) return null;
                        const goal = weightGoals.has('lose') ? 'lose' : (weightGoals.has('gain') || weightGoals.has('muscle')) ? 'gain' : 'maintain';
                        const onTrack = (goal === 'lose' && trend.direction === 'down')
                          || (goal === 'gain' && trend.direction === 'up')
                          || (goal === 'maintain' && trend.direction === 'stable');
                        const offTrack = (goal === 'lose' && trend.direction === 'up')
                          || (goal === 'gain' && trend.direction === 'down');
                        const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
                        const sign = trend.change > 0 ? '+' : '';
                        const directionText = trend.direction === 'up' ? 'Gaining weight' : trend.direction === 'down' ? 'Losing weight' : 'Weight stable';
                        return (
                          <span className={onTrack ? styles.trendOnTrack : offTrack ? styles.trendOffTrack : styles.trendNeutral}>
                            {arrow} {sign}{trend.change} lbs — {directionText} {onTrack ? '(on track)' : offTrack ? '(off track)' : ''}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.goalsTableLabel}>Looking to Gain Muscle</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'muscle', label: 'Yes' }, { key: 'no-muscle', label: 'No' }].map(g => (
                        <button key={g.key} type="button" className={weightGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { setWeightGoals(prev => { const next = new Set(prev); if (next.has(g.key)) { next.delete(g.key); } else { next.delete('muscle'); next.delete('no-muscle'); next.add(g.key); } return next; }); }}>{g.label}</button>
                      ))}
                      {!weightGoals.has('muscle') && !weightGoals.has('no-muscle') && (
                        <span className={styles.goalNotTracked}>Muscle goal not set</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.goalsTableLabel}>Weigh Your Food</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'weighFood', label: 'Yes' }, { key: 'noWeighFood', label: 'No' }].map(g => (
                        <button key={g.key} type="button" className={mealTrackingGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { setMealTrackingGoals(prev => { const next = new Set(prev); if (next.has(g.key)) { next.delete(g.key); } else { next.delete('weighFood'); next.delete('noWeighFood'); next.add(g.key); } return next; }); }}>{g.label}</button>
                      ))}
                      {!mealTrackingGoals.has('weighFood') && !mealTrackingGoals.has('noWeighFood') && (
                        <span className={styles.goalNotTracked}>Food weigh tracking not enabled</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.goalsTableLabel}>Track Your Meals</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'trackDaily', label: '3 Meals a Day' }, { key: 'trackWeekly', label: 'Per Grocery Shop' }].map(g => (
                        <button key={g.key} type="button" className={mealTrackingGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { setMealTrackingGoals(prev => { const next = new Set(prev); if (next.has(g.key)) { next.delete(g.key); } else { next.delete('trackDaily'); next.delete('trackWeekly'); next.add(g.key); } return next; }); }}>{g.label}</button>
                      ))}
                      {!mealTrackingGoals.has('trackDaily') && !mealTrackingGoals.has('trackWeekly') && (
                        <span className={styles.goalNotTracked}>Meal tracking not enabled</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.goalsTableLabel}>Weigh Yourself</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'weighDaily', label: 'Daily' }, { key: 'weighWeekly', label: 'Weekly' }, { key: 'weighMonthly', label: 'Monthly' }].map(g => (
                        <button key={g.key} type="button" className={mealTrackingGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { setMealTrackingGoals(prev => { const next = new Set(prev); if (next.has(g.key)) { next.delete(g.key); } else { next.delete('weighDaily'); next.delete('weighWeekly'); next.delete('weighMonthly'); next.add(g.key); } return next; }); }}>{g.label}</button>
                      ))}
                      {!mealTrackingGoals.has('weighDaily') && !mealTrackingGoals.has('weighWeekly') && !mealTrackingGoals.has('weighMonthly') && (
                        <span className={styles.goalNotTracked}>Weight tracking not enabled</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.goalsTableLabel}>Track Vitamins & Minerals</td>
                    <td className={styles.goalsTableBtns}>
                      {[{ key: 'trackMinerals', label: 'Minerals' }, { key: 'trackVitamins', label: 'Vitamins' }, { key: 'trackAminos', label: 'Amino Acids/Fatty Acids' }].map(g => (
                        <button key={g.key} type="button" className={mealTrackingGoals.has(g.key) ? styles.goalBtnActive : styles.goalBtn} onClick={() => { setMealTrackingGoals(prev => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; }); }}>{g.label}</button>
                      ))}
                      {!mealTrackingGoals.has('trackMinerals') && !mealTrackingGoals.has('trackVitamins') && !mealTrackingGoals.has('trackAminos') && (
                        <span className={styles.goalNotTracked}>Vitamin & mineral tracking not enabled</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

            </div>
            {macroApproach === 'manual' && (
              <div className={styles.infoCol}>
                <h4 className={styles.groupTitle}>Macro % Targets</h4>
                <p className={styles.goalHint}>Set your macro split</p>
                <div className={styles.manualMacroField}>
                  <span className={styles.statsLabel}>Protein %</span>
                  <div className={styles.pctInputRow}>
                    <input
                      type="number"
                      className={styles.statsInput}
                      value={macroPcts.protein}
                      onChange={e => setMacroPct('protein', parseInt(e.target.value) || 0)}
                      min={0} max={100}
                    />
                    <span className={styles.pctGrams}>{targets.protein}g</span>
                  </div>
                </div>
                <div className={styles.manualMacroField}>
                  <span className={styles.statsLabel}>Carbs %</span>
                  <div className={styles.pctInputRow}>
                    <input
                      type="number"
                      className={styles.statsInput}
                      value={macroPcts.carbs}
                      onChange={e => setMacroPct('carbs', parseInt(e.target.value) || 0)}
                      min={0} max={100}
                    />
                    <span className={styles.pctGrams}>{targets.carbs}g</span>
                  </div>
                </div>
                <div className={styles.manualMacroField}>
                  <span className={styles.statsLabel}>Fat %</span>
                  <div className={styles.pctInputRow}>
                    <input
                      type="number"
                      className={styles.statsInput}
                      value={macroPcts.fat}
                      onChange={e => setMacroPct('fat', parseInt(e.target.value) || 0)}
                      min={0} max={100}
                    />
                    <span className={styles.pctGrams}>{targets.fat}g</span>
                  </div>
                </div>
                {(() => {
                  const total = macroPcts.protein + macroPcts.carbs + macroPcts.fat;
                  return (
                    <div className={`${styles.pctTotalRow} ${total !== 100 ? styles.pctTotalWarn : ''}`}>
                      Total: {total}%{total !== 100 && ' (should be 100%)'}
                    </div>
                  );
                })()}
              </div>
            )}
            {macroApproach === 'calculate' && (
              <div className={styles.infoCol}>
                <h4 className={styles.groupTitle}>Your Info</h4>
                <div className={styles.statsGrid}>
                  <div className={styles.statsField}>
                    <span className={styles.statsLabel}>Gender</span>
                    <div className={styles.genderBtns}>
                      <button
                        type="button"
                        className={gender === 'male' ? styles.genderBtnActive : styles.genderBtn}
                        onClick={() => setGender('male')}
                      >Male</button>
                      <button
                        type="button"
                        className={gender === 'female' ? styles.genderBtnActive : styles.genderBtn}
                        onClick={() => setGender('female')}
                      >Female</button>
                    </div>
                  </div>
                  <div className={styles.statsField}>
                    <span className={styles.statsLabel}>Age</span>
                    <input
                      type="number"
                      className={styles.statsInput}
                      value={age}
                      onChange={e => setAge(e.target.value)}
                      placeholder="yrs"
                      min={1}
                      max={120}
                    />
                  </div>
                  <div className={styles.statsField}>
                    <span className={styles.statsLabel}>Height</span>
                    <div className={styles.heightInputs}>
                      <input
                        type="number"
                        className={styles.statsInput}
                        value={heightFt}
                        onChange={e => setHeightFt(e.target.value)}
                        placeholder="ft"
                        min={1}
                        max={8}
                      />
                      <input
                        type="number"
                        className={styles.statsInput}
                        value={heightIn}
                        onChange={e => setHeightIn(e.target.value)}
                        placeholder="in"
                        min={0}
                        max={11}
                      />
                    </div>
                  </div>
                  <div className={styles.statsField}>
                    <span className={styles.statsLabel}>Weight</span>
                    <input
                      type="number"
                      className={styles.statsInput}
                      value={weight}
                      onChange={e => setWeight(e.target.value)}
                      placeholder="lbs"
                      min={1}
                    />
                  </div>
                </div>
                <div className={styles.activitySection}>
                  <span className={styles.statsLabel}>Activity Level</span>
                  <div className={styles.activityGrid}>
                    {ACTIVITY_LEVELS.map(a => (
                      <button
                        key={a.key}
                        type="button"
                        className={activityLevel === a.key ? styles.activityBtnActive : styles.activityBtn}
                        onClick={() => setActivityLevel(a.key)}
                      >
                        <span className={styles.activityBtnLabel}>{a.label}</span>
                        <span className={styles.activityBtnDesc}>{a.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {macroApproach === 'calculate' && mathBreakdown && (
            <details className={styles.mathSection}>
              <summary className={styles.mathSummary}>How we calculated your targets</summary>
              <div className={styles.mathCardLayout}>
                <div className={styles.mathCard}>
                  <div className={styles.mathStep}>
                    <span className={styles.mathLabel}>Step 1: Convert units</span>
                    <span className={styles.mathFormula}>
                      {weight} lbs = {mathBreakdown.kg} kg &nbsp;&bull;&nbsp; {heightFt}'{heightIn}" = {mathBreakdown.cm} cm
                    </span>
                  </div>
                  <div className={styles.mathStep}>
                    <span className={styles.mathLabel}>Step 2: BMR (Mifflin-St Jeor)</span>
                    <span className={styles.mathFormula}>
                      (10 &times; {mathBreakdown.kg}) + (6.25 &times; {mathBreakdown.cm}) - (5 &times; {age}) {mathBreakdown.gender === 'male' ? '+ 5' : '- 161'}
                    </span>
                    <span className={styles.mathResult}>= {mathBreakdown.bmr} cal/day</span>
                  </div>
                  <div className={styles.mathStep}>
                    <span className={styles.mathLabel}>Step 3: TDEE</span>
                    <span className={styles.mathFormula}>
                      {mathBreakdown.bmr} &times; {mathBreakdown.activityMultiplier} ({mathBreakdown.activityLabel})
                    </span>
                    <span className={styles.mathResult}>= {mathBreakdown.tdeeBase} cal/day</span>
                  </div>
                  {mathBreakdown.calOffset !== 0 && (
                    <div className={styles.mathStep}>
                      <span className={styles.mathLabel}>Step 4: {mathBreakdown.goalLabel}</span>
                      <span className={styles.mathFormula}>
                        {mathBreakdown.tdeeBase} {mathBreakdown.calOffset > 0 ? '+' : ''} {mathBreakdown.calOffset}
                      </span>
                      <span className={styles.mathResult}>= {mathBreakdown.tdee} cal/day</span>
                    </div>
                  )}
                </div>
                <div className={styles.mathMacros}>
                  <div className={styles.mathMacroItem}>
                    <span className={styles.mathMacroLabel}>Protein ({Math.round((mathBreakdown.proteinG * 4 / mathBreakdown.tdee) * 100)}%)</span>
                    <span className={styles.mathFormula}>
                      {weight} lbs &times; {mathBreakdown.proteinPerLb} g/lb{mathBreakdown.proteinMult !== 1 ? ` \u00d7 ${mathBreakdown.proteinMult}` : ''}
                    </span>
                    <span className={styles.mathMacroResult}>{mathBreakdown.proteinG}g</span>
                  </div>
                  <div className={styles.mathMacroItem}>
                    <span className={styles.mathMacroLabel}>Carbs ({Math.round(mathBreakdown.carbPct * 100)}%)</span>
                    <span className={styles.mathFormula}>
                      {mathBreakdown.tdee} &times; {mathBreakdown.carbPct} &divide; 4
                    </span>
                    <span className={styles.mathMacroResult}>{mathBreakdown.carbsG}g</span>
                  </div>
                  <div className={styles.mathMacroItem}>
                    <span className={styles.mathMacroLabel}>Fat ({Math.round(mathBreakdown.fatPct * 100)}%)</span>
                    <span className={styles.mathFormula}>
                      {mathBreakdown.tdee} &times; {mathBreakdown.fatPct} &divide; 9
                    </span>
                    <span className={styles.mathMacroResult}>{mathBreakdown.fatG}g</span>
                  </div>
                </div>
              </div>
            </details>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.subtitleRow}>
            <p className={styles.subtitle}>Select the type of nutrition data you would like to set goals around.</p>
            <button
              type="button"
              className={styles.deselectBtn}
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              Deselect All
            </button>
          </div>
          <div className={styles.nutrientGrid}>
          {GROUPS.filter(group => {
            if (group.title === 'Minerals' && !mealTrackingGoals.has('trackMinerals')) return false;
            if (group.title === 'Vitamins' && !mealTrackingGoals.has('trackVitamins')) return false;
            if ((group.title === 'Amino Acids' || group.title === 'Fatty Acids') && !mealTrackingGoals.has('trackAminos')) return false;
            return true;
          }).map(group => {
            const isMacros = group.title === 'Macros';
            const pctTotal = macroPcts.protein + macroPcts.carbs + macroPcts.fat;
            return (
            <div key={group.title} className={styles.group}>
              <div className={styles.groupHeaderRow}>
                <h4 className={styles.groupTitle}>{group.title}</h4>
                <div className={styles.groupHeaderActions}>
                  {isMacros && (
                    <div className={styles.macroModeToggle}>
                      <button
                        type="button"
                        className={macroMode === 'grams' ? styles.modeActive : styles.modeBtn}
                        onClick={() => setMacroMode('grams')}
                      >Grams</button>
                      <button
                        type="button"
                        className={macroMode === 'percent' ? styles.modeActive : styles.modeBtn}
                        onClick={switchToPercentMode}
                      >% of Calories</button>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.groupToggleBtn}
                    onClick={() => {
                      const allSelected = group.keys.every(k => selected.has(k));
                      setSelected(prev => {
                        const next = new Set(prev);
                        group.keys.forEach(k => allSelected ? next.delete(k) : next.add(k));
                        return next;
                      });
                    }}
                  >
                    {group.keys.every(k => selected.has(k)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>
              {group.keys.map(key => {
                const n = NUTRIENTS.find(x => x.key === key);
                if (!n) return null;
                const checked = selected.has(key);
                const isPctMacro = isMacros && macroMode === 'percent' && ['protein', 'carbs', 'fat'].includes(key);
                return (
                  <div key={key} className={styles.nutrientRow}>
                    <input
                      type="checkbox"
                      className={styles.nutrientCheck}
                      checked={checked}
                      onChange={() => toggle(key)}
                    />
                    <label className={styles.nutrientLabel} onClick={() => toggle(key)}>
                      {n.label}
                    </label>
                    {checked && isPctMacro ? (
                      <>
                        <input
                          type="number"
                          className={styles.nutrientInput}
                          value={macroPcts[key]}
                          onChange={e => setMacroPct(key, parseInt(e.target.value) || 0)}
                          min={0}
                          max={100}
                          step={1}
                        />
                        <span className={styles.nutrientUnit}>%</span>
                        <span className={styles.pctGrams}>{targets[key]}{n.unit}</span>
                      </>
                    ) : checked ? (
                      <>
                        <input
                          type="number"
                          className={styles.nutrientInput}
                          value={targets[key]}
                          onChange={e => setTarget(key, parseFloat(e.target.value) || 0)}
                          min={0}
                          step={n.decimals > 0 ? Math.pow(10, -n.decimals) : 1}
                        />
                        <span className={styles.nutrientUnit}>{n.unit || 'cal'}</span>
                      </>
                    ) : null}
                  </div>
                );
              })}
              {isMacros && macroMode === 'percent' && (
                <div className={`${styles.pctTotalRow} ${pctTotal !== 100 ? styles.pctTotalWarn : ''}`}>
                  Total: {pctTotal}%{pctTotal !== 100 && ` (should be 100%)`}
                </div>
              )}
            </div>
            );
          })}

          <div className={styles.group}>
            <h4 className={styles.groupTitle}>Other Goals</h4>
            {CUSTOM_GOALS.map(g => {
              const checked = selected.has(g.key);
              return (
                <div key={g.key} className={styles.nutrientRow}>
                  <input
                    type="checkbox"
                    className={styles.nutrientCheck}
                    checked={checked}
                    onChange={() => toggle(g.key)}
                  />
                  <label className={styles.nutrientLabel} onClick={() => toggle(g.key)}>
                    {g.label}
                  </label>
                  {checked && (
                    <>
                      <input
                        type="number"
                        className={styles.nutrientInput}
                        value={targets[g.key]}
                        onChange={e => setTarget(g.key, parseFloat(e.target.value) || 0)}
                        min={0}
                        step={g.decimals > 0 ? Math.pow(10, -g.decimals) : 1}
                      />
                      <span className={styles.nutrientUnit}>{g.unit}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </div>

          <p className={styles.disclaimer}>
            Recommended values are based on guidelines from the USDA Dietary Guidelines for Americans (2020–2025),
            the National Institutes of Health (NIH) Dietary Reference Intakes, the Institute of Medicine (IOM),
            and the American College of Sports Medicine (ACSM). Calorie estimates use the Mifflin-St Jeor equation.
            These are general recommendations and not medical advice — consult a healthcare professional for personalized guidance.
          </p>
        </div>
      </div>
    </div>
  );
}

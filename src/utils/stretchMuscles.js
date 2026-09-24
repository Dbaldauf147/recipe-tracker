// Which muscles a stretch routine lengthens — the data behind the routine
// editor's front/back body map.
//
// Everything here speaks in plain muscle NAMES ("hamstrings, calves"), never in
// a body-map library's ids: the website's react-body-highlighter and the
// phone's react-native-body-highlighter use different id sets, and each app
// already has a nameToMuscles that turns names into its own. So this table can
// be byte-for-byte the same on both sides.
//
// MIRRORED from the mobile app's src/utils/stretchMuscles.ts — change both.

import { buildCueSequence } from './stretchRoutine.js';
import { stretchRegionFor } from './stretchGoal.js';

// Common poses by name. Most stretches are typed in by hand and filed under
// "Yoga" with no muscle columns filled in, so the pose name is usually the best
// signal there is. EVERY matching row counts, so "Standing quad and calf
// stretch" lands on both.
const POSE_MUSCLES = [
  [/downward dog|down dog/i, 'hamstrings, calves, latissimus'],
  [/forward fold|toe touch|uttanasana|seated forward|jefferson curl/i, 'hamstrings, lower back'],
  [/hamstring/i, 'hamstrings'],
  [/pigeon|figure\s*(4|four)|piriformis|90\s*\/\s*90/i, 'glutes'],
  [/couch stretch|hip flexor|psoas|\blunge|lizard/i, 'quadriceps, glutes'],
  [/butterfly|frog|groin|adductor|straddle|pancake|\bsplits?\b/i, 'adductors'],
  [/\bsplits?\b/i, 'hamstrings, quadriceps'],
  [/happy baby/i, 'adductors, glutes, lower back'],
  [/\bquads?\b|quadricep/i, 'quadriceps'],
  [/calf|calves|achilles|soleus/i, 'calves'],
  [/it ?band|iliotibial|abductor/i, 'abductors'],
  [/child'?s pose/i, 'lower back, latissimus'],
  [/cat[- ]?cow|thoracic|spinal|spine/i, 'upper back, lower back'],
  [/twist/i, 'obliques, lower back'],
  [/cobra|sphinx|upward dog|up dog|\bcamel\b|\bwheel\b|bridge/i, 'abs, chest'],
  [/doorway|\bpecs?\b|chest/i, 'chest, front delts'],
  [/cross[- ]?body|sleeper|rear delt/i, 'rear delts'],
  [/thread the needle/i, 'upper back, rear delts'],
  [/eagle arm/i, 'upper back, rear delts'],
  [/side bend|side stretch|\blats?\b|latissimus/i, 'obliques, latissimus'],
  [/tricep/i, 'triceps'],
  [/bicep/i, 'biceps'],
  [/wrist|forearm/i, 'forearms'],
  [/\bneck\b|\btraps?\b|trapezius|levator/i, 'neck, traps'],
  [/\bshoulders?\b|\bdelts?\b/i, 'shoulders'],
  [/lower back|low back/i, 'lower back'],
  [/upper back|rhomboid/i, 'upper back'],
];

// Last resort: the goal board's region for the pose, spread over the muscles
// that region covers. Coarse — a "Legs" stretch shades the whole leg — but it
// means a pose the table doesn't know still shows up somewhere sensible.
const REGION_MUSCLES = {
  Chest: 'chest',
  Back: 'upper back, lower back, traps',
  Shoulders: 'shoulders',
  Arms: 'biceps, triceps, forearms',
  Abdominals: 'abs, obliques',
  'Hips/Glutes': 'glutes, adductors',
  Legs: 'quadriceps, hamstrings, calves',
};

function splitNames(s) {
  return String(s || '').split(/[,;/&]/).map(x => x.trim()).filter(Boolean);
}

/**
 * The muscle names one pose stretches, and where that answer came from.
 *
 * `lib` is the pose's library row as `{ primary, secondary, group }` (any of
 * them may be missing). Its Primary/Secondary columns win outright when filled
 * — that's the user saying so. Then the pose name, then the region.
 * `source` is 'library' | 'name' | 'region' | '' (nothing found).
 */
export function stretchPoseMuscleNames(poseName, lib = {}) {
  const fromLib = [...splitNames(lib.primary), ...splitNames(lib.secondary)];
  if (fromLib.length) return { names: [...new Set(fromLib)], source: 'library' };

  const name = String(poseName || '');
  const byName = [];
  for (const [re, muscles] of POSE_MUSCLES) if (re.test(name)) byName.push(...splitNames(muscles));
  if (byName.length) return { names: [...new Set(byName)], source: 'name' };

  const region = stretchRegionFor(name, lib.group);
  if (region && REGION_MUSCLES[region]) return { names: splitNames(REGION_MUSCLES[region]), source: 'region' };
  return { names: [], source: '' };
}

/**
 * Seconds each muscle is held for in ONE run of the routine.
 *
 * Time comes from the same cue sequence the player walks, so reps, both-sides
 * poses and per-pose holds are all counted exactly as they'll be played.
 * `musclesForPose(name)` returns the app's own body-map ids for a pose — the
 * caller supplies it because only it knows the library and its id set.
 *
 * Returns `{ muscles: { [id]: { seconds, poses[] } }, unmapped: string[] }`;
 * `unmapped` lists poses nothing could be found for, so the map can say so
 * instead of silently leaving them off.
 */
export function routineMuscleSeconds(routine, musclesForPose) {
  const byPose = new Map();
  for (const cue of buildCueSequence(routine)) {
    if (cue.kind !== 'hold') continue;
    byPose.set(cue.stepName, (byPose.get(cue.stepName) || 0) + cue.seconds);
  }
  const muscles = {};
  const unmapped = [];
  for (const [pose, seconds] of byPose) {
    const ids = [...new Set(musclesForPose(pose) || [])];
    if (ids.length === 0) { unmapped.push(pose); continue; }
    for (const id of ids) {
      const m = muscles[id] || (muscles[id] = { seconds: 0, poses: [] });
      m.seconds += seconds;
      m.poses.push(pose);
    }
  }
  return { muscles, unmapped };
}

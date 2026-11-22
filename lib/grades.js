export const GRADE_THRESHOLDS = [
  { label: "A+", min: 97 }, { label: "A", min: 93 }, { label: "A-", min: 90 },
  { label: "B+", min: 87 }, { label: "B", min: 83 }, { label: "B-", min: 80 },
  { label: "C+", min: 77 }, { label: "C", min: 73 }, { label: "C-", min: 70 },
  { label: "D+", min: 67 }, { label: "D", min: 63 }, { label: "D-", min: 60 },
  { label: "F", min: 0 },
];

export function letterGrade(pct) {
  return GRADE_THRESHOLDS.find((g) => pct >= g.min)?.label || "F";
}

export function gradeColor(pct) {
  if (pct >= 90) return "var(--success)";
  if (pct >= 80) return "var(--accent)";
  if (pct >= 70) return "var(--warning)";
  return "var(--error)";
}

export function calcClass(categories) {
  let earnedWeighted = 0, totalWeight = 0, remainingWeight = 0;
  const remaining = []; // names of the categories not graded yet (what the "need" applies to)
  for (const cat of categories) {
    const e = parseFloat(cat.earned), p = parseFloat(cat.possible);
    if (!isNaN(e) && !isNaN(p) && p > 0) {
      earnedWeighted += (e / p) * cat.weight;
      totalWeight += cat.weight;
    } else {
      remainingWeight += cat.weight;
      if (cat.weight > 0) remaining.push(cat.name);
    }
  }
  const currentPct = totalWeight > 0 ? (earnedWeighted / totalWeight) * 100 : null;
  // average % needed on all remaining categories to finish at each letter's minimum
  const neededFor = {};
  const allWeight = totalWeight + remainingWeight;
  for (const { label, min } of GRADE_THRESHOLDS) {
    neededFor[label] = remainingWeight > 0 ? ((min / 100) * allWeight - earnedWeighted) / remainingWeight * 100 : null;
  }
  return { currentPct, earnedWeighted, totalWeight, remainingWeight, neededFor, remaining };
}

// best letter still reachable for a class: { label, need, on } (need <= 0 means already locked in;
// `on` = the ungraded categories the need averages over), or null with no scores yet
export function bestReachable(categories) {
  const { currentPct, remainingWeight, neededFor, remaining } = calcClass(categories);
  if (currentPct === null) return null;
  if (remainingWeight === 0) return { label: letterGrade(currentPct), need: 0, on: [] };
  const g = GRADE_THRESHOLDS.find(({ label }) => neededFor[label] <= 100);
  return { label: g.label, need: neededFor[g.label], on: remaining };
}

// likely final grades from what's done so far: keep the same average on the rest, or do 10 points
// worse / better. [{ name, avg, final, letter }], or [] with no scores yet or nothing left to grade
export function outcomes(categories) {
  const { currentPct, earnedWeighted, totalWeight, remainingWeight } = calcClass(categories);
  if (currentPct === null || remainingWeight === 0) return [];
  const finalAt = (avg) => (earnedWeighted + (avg / 100) * remainingWeight) / (totalWeight + remainingWeight) * 100;
  const clamp = (x) => Math.min(100, Math.max(0, x));
  return [["10 pts worse", currentPct - 10], ["Same as so far", currentPct], ["10 pts better", currentPct + 10]]
    .map(([name, avg]) => ({ name, avg: clamp(avg), final: finalAt(clamp(avg)), letter: letterGrade(finalAt(clamp(avg))) }));
}

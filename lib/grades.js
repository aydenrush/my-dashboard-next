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
  for (const cat of categories) {
    const e = parseFloat(cat.earned), p = parseFloat(cat.possible);
    if (!isNaN(e) && !isNaN(p) && p > 0) {
      earnedWeighted += (e / p) * cat.weight;
      totalWeight += cat.weight;
    } else {
      remainingWeight += cat.weight;
    }
  }
  const currentPct = totalWeight > 0 ? (earnedWeighted / totalWeight) * 100 : null;
  // average % needed on all remaining categories to finish at each letter's minimum
  const neededFor = {};
  const allWeight = totalWeight + remainingWeight;
  for (const { label, min } of GRADE_THRESHOLDS) {
    neededFor[label] = remainingWeight > 0 ? ((min / 100) * allWeight - earnedWeighted) / remainingWeight * 100 : null;
  }
  return { currentPct, earnedWeighted, totalWeight, remainingWeight, neededFor };
}

// best letter still reachable for a class: { label, need } (need <= 0 means already locked in), or null with no scores yet
export function bestReachable(categories) {
  const { currentPct, remainingWeight, neededFor } = calcClass(categories);
  if (currentPct === null) return null;
  if (remainingWeight === 0) return { label: letterGrade(currentPct), need: 0 };
  const g = GRADE_THRESHOLDS.find(({ label }) => neededFor[label] <= 100);
  return { label: g.label, need: neededFor[g.label] };
}

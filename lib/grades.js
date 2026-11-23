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

// weights come from text boxes and may be "" while you type; treat anything blank as 0
const withWeights = (categories) => categories.map((c) => ({ ...c, weight: parseFloat(c.weight) || 0 }));

export function calcClass(categories) {
  categories = withWeights(categories);
  let earnedWeighted = 0, totalWeight = 0, remainingWeight = 0;
  const remaining = []; // names of the categories not graded yet (what the "need" applies to)
  for (const cat of categories) {
    const e = parseFloat(cat.earned), p = parseFloat(cat.possible);
    if (!isNaN(e) && !isNaN(p) && p > 0) {
      earnedWeighted += (e / p) * cat.weight;
      totalWeight += cat.weight;
    } else {
      remainingWeight += cat.weight;
      if (cat.weight > 0) remaining.push(cat.name || "unnamed item");
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

const isExam = (name) => /midterm|exam|final|test/i.test(name || "");
const graded = (c) => { const e = parseFloat(c.earned), p = parseFloat(c.possible); return !isNaN(e) && !isNaN(p) && p > 0; };
const weightedAvg = (cats) => {
  const w = cats.reduce((s, c) => s + c.weight, 0);
  return w > 0 ? cats.reduce((s, c) => s + (parseFloat(c.earned) / parseFloat(c.possible)) * 100 * c.weight, 0) / w : null;
};

// likely final grades from what's done so far. Ungraded exams (final, midterms) are predicted from your
// graded exam scores, everything else from your graded non-exam work (each falls back to your overall %).
// Returns { examAvg, restAvg, rows: [{ name, avg, final, letter }] } for expected / 10 pts worse / better,
// or null with no scores yet or nothing left to grade.
export function outcomes(categories) {
  categories = withWeights(categories);
  const { currentPct, earnedWeighted, totalWeight, remainingWeight } = calcClass(categories);
  if (currentPct === null || remainingWeight === 0) return null;
  const done = categories.filter(graded);
  const examAvg = weightedAvg(done.filter((c) => isExam(c.name)));
  const restAvg = weightedAvg(done.filter((c) => !isExam(c.name)));
  const left = categories.filter((c) => !graded(c) && c.weight > 0);
  const clamp = (x) => Math.min(100, Math.max(0, x));
  const row = (name, shift) => {
    const pts = left.reduce((s, c) => s + clamp(((isExam(c.name) ? examAvg : restAvg) ?? currentPct) + shift) / 100 * c.weight, 0);
    const final = (earnedWeighted + pts) / (totalWeight + remainingWeight) * 100;
    return { name, avg: (pts / remainingWeight) * 100, final, letter: letterGrade(final) };
  };
  return { examAvg, restAvg, rows: [row("10 pts worse", -10), row("Expected", 0), row("10 pts better", 10)] };
}

"use client";
import { useState } from "react";

const GRADE_THRESHOLDS = [
  { label: "A+", min: 97 }, { label: "A", min: 93 }, { label: "A-", min: 90 },
  { label: "B+", min: 87 }, { label: "B", min: 83 }, { label: "B-", min: 80 },
  { label: "C+", min: 77 }, { label: "C", min: 73 }, { label: "C-", min: 70 },
  { label: "D+", min: 67 }, { label: "D", min: 63 }, { label: "D-", min: 60 },
  { label: "F", min: 0 },
];

function letterGrade(pct) {
  return GRADE_THRESHOLDS.find((g) => pct >= g.min)?.label || "F";
}

function gradeColor(pct) {
  if (pct >= 90) return "var(--success)";
  if (pct >= 80) return "var(--accent)";
  if (pct >= 70) return "var(--warning)";
  return "var(--error)";
}

const INITIAL_CLASSES = [
  { name: "CS 25000", categories: [{ name: "Labs", weight: 15, earned: "", possible: "" }, { name: "Homework", weight: 20, earned: "", possible: "" }, { name: "Midterm 1", weight: 15, earned: "", possible: "" }, { name: "Midterm 2", weight: 15, earned: "", possible: "" }, { name: "Final", weight: 35, earned: "", possible: "" }] },
  { name: "CS 25100", categories: [{ name: "Homework", weight: 25, earned: "", possible: "" }, { name: "Midterm 1", weight: 15, earned: "", possible: "" }, { name: "Midterm 2", weight: 15, earned: "", possible: "" }, { name: "Final", weight: 35, earned: "", possible: "" }, { name: "Participation", weight: 10, earned: "", possible: "" }] },
  { name: "MA 26500", categories: [{ name: "Homework", weight: 15, earned: "", possible: "" }, { name: "Midterm 1", weight: 15, earned: "", possible: "" }, { name: "Midterm 2", weight: 15, earned: "", possible: "" }, { name: "Midterm 3", weight: 20, earned: "", possible: "" }, { name: "Final", weight: 35, earned: "", possible: "" }] },
  { name: "POL 23500", categories: [{ name: "Assignments", weight: 40, earned: "", possible: "" }, { name: "Midterm", weight: 25, earned: "", possible: "" }, { name: "Final", weight: 35, earned: "", possible: "" }] },
  { name: "POL 32700", categories: [{ name: "Discussion Posts", weight: 20, earned: "", possible: "" }, { name: "Papers", weight: 45, earned: "", possible: "" }, { name: "Final Essay", weight: 35, earned: "", possible: "" }] },
];

function calcClass(categories) {
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
  const neededFor = {};
  for (const { label, min } of GRADE_THRESHOLDS) {
    if (remainingWeight > 0 && totalWeight > 0) {
      const needed = ((min - earnedWeighted) / remainingWeight) * 100;
      neededFor[label] = Math.max(0, needed);
    } else {
      neededFor[label] = null;
    }
  }
  return { currentPct, earnedWeighted, totalWeight, remainingWeight, neededFor };
}

export default function GradesPage() {
  const [classes, setClasses] = useState(INITIAL_CLASSES);
  const [addingClass, setAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  function updateCat(ci, cati, field, val) {
    setClasses((prev) => {
      const next = prev.map((c, i) => i === ci ? { ...c, categories: c.categories.map((cat, j) => j === cati ? { ...cat, [field]: val } : cat) } : c);
      return next;
    });
  }

  function addCategory(ci) {
    setClasses((prev) => prev.map((c, i) => i === ci ? { ...c, categories: [...c.categories, { name: "New Category", weight: 0, earned: "", possible: "" }] } : c));
  }

  function removeCategory(ci, cati) {
    setClasses((prev) => prev.map((c, i) => i === ci ? { ...c, categories: c.categories.filter((_, j) => j !== cati) } : c));
  }

  function removeClass(ci) {
    setClasses((prev) => prev.filter((_, i) => i !== ci));
  }

  function addClass() {
    if (!newClassName.trim()) return;
    setClasses((prev) => [...prev, { name: newClassName.trim(), categories: [{ name: "Category 1", weight: 50, earned: "", possible: "" }, { name: "Category 2", weight: 50, earned: "", possible: "" }] }]);
    setNewClassName("");
    setAddingClass(false);
  }

  return (
    <div>
      <h1 className="page-title">Final Grade Calculator</h1>

      {classes.map((cls, ci) => {
        const { currentPct, earnedWeighted, totalWeight, remainingWeight, neededFor } = calcClass(cls.categories);
        const weightSum = cls.categories.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);
        return (
          <details key={ci} open className="card" style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{cls.name}</span>
              <span style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                {currentPct !== null && (
                  <span style={{ color: gradeColor(currentPct), fontWeight: 700 }}>
                    {currentPct.toFixed(1)}% ({letterGrade(currentPct)})
                  </span>
                )}
                <button className="btn" onClick={(e) => { e.preventDefault(); removeClass(ci); }} style={{ fontSize: "0.75rem", padding: "2px 8px", color: "var(--error)" }}>Remove</button>
              </span>
            </summary>

            <div style={{ marginTop: "0.75rem" }}>
              {weightSum !== 100 && <div className="alert alert-warning" style={{ marginBottom: "0.5rem" }}>Weights sum to {weightSum}% (should be 100%)</div>}

              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ width: 70 }}>Weight %</th>
                    <th style={{ width: 90 }}>Earned</th>
                    <th style={{ width: 90 }}>Possible</th>
                    <th style={{ width: 70 }}>Score</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cls.categories.map((cat, cati) => {
                    const e = parseFloat(cat.earned), p = parseFloat(cat.possible);
                    const pct = !isNaN(e) && !isNaN(p) && p > 0 ? (e / p) * 100 : null;
                    return (
                      <tr key={cati}>
                        <td><input type="text" value={cat.name} onChange={(ev) => updateCat(ci, cati, "name", ev.target.value)} style={{ width: "100%", background: "transparent", border: "none", color: "var(--fg)", fontSize: "0.9rem" }} /></td>
                        <td><input type="number" value={cat.weight} onChange={(ev) => updateCat(ci, cati, "weight", parseFloat(ev.target.value) || 0)} style={{ width: "100%" }} /></td>
                        <td><input type="number" value={cat.earned} onChange={(ev) => updateCat(ci, cati, "earned", ev.target.value)} placeholder="—" style={{ width: "100%" }} /></td>
                        <td><input type="number" value={cat.possible} onChange={(ev) => updateCat(ci, cati, "possible", ev.target.value)} placeholder="—" style={{ width: "100%" }} /></td>
                        <td style={{ color: pct !== null ? gradeColor(pct) : "var(--muted)" }}>{pct !== null ? `${pct.toFixed(1)}%` : "—"}</td>
                        <td><button onClick={() => removeCategory(ci, cati)} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "1rem" }}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button className="btn" onClick={() => addCategory(ci)} style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>+ Category</button>

              {currentPct !== null && remainingWeight > 0 && (
                <div style={{ marginTop: "0.75rem", padding: "0.5rem", background: "var(--sidebar-bg)", borderRadius: 6 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>To get a ___ you need ___ on remaining ({remainingWeight}% of grade):</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {["A", "B", "C", "D"].map((target) => {
                      const need = neededFor[target];
                      if (need === null) return null;
                      const impossible = need > 100;
                      const guaranteed = need <= 0;
                      return (
                        <span key={target} style={{ fontSize: "0.85rem", padding: "2px 8px", borderRadius: 4, background: "var(--card-bg)", border: "1px solid var(--border)", color: impossible ? "var(--error)" : guaranteed ? "var(--success)" : "var(--fg)" }}>
                          {target}: {guaranteed ? "Guaranteed" : impossible ? "Not possible" : `${need.toFixed(1)}%`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </details>
        );
      })}

      {addingClass ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="text" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="Class name" onKeyDown={(e) => e.key === "Enter" && addClass()} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={addClass}>Add</button>
          <button className="btn" onClick={() => setAddingClass(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn" onClick={() => setAddingClass(true)}>+ Add Class</button>
      )}
    </div>
  );
}

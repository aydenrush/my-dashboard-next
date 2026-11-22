"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { GRADE_THRESHOLDS, letterGrade, gradeColor, calcClass, outcomes } from "@/lib/grades";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function GradesPage() {
  const [classes, setClasses] = useState([]);
  const [addingClass, setAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const dirty = useRef(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.from("grade_classes").select("*").order("id").then(({ data }) => { if (data) { setClasses(data); setLoaded(true); } });
  }, []);

  // save edited classes ~0.6s after typing stops, and right away when you leave the page or switch tabs
  const latest = useRef(classes);
  latest.current = classes;
  const flush = useCallback(() => {
    const ids = [...dirty.current];
    dirty.current.clear();
    for (const c of latest.current.filter((c) => ids.includes(c.id))) {
      supabase.from("grade_classes")
        .update({ categories: c.categories, meetings: c.meetings || [], term_start: c.term_start || null, term_end: c.term_end || null }).eq("id", c.id)
        .then(() => {});
    }
  }, []);
  useEffect(() => {
    if (!dirty.current.size) return;
    const t = setTimeout(flush, 600);
    return () => clearTimeout(t);
  }, [classes, flush]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); flush(); };
  }, [flush]);

  function patchClass(ci, fn) {
    setClasses((prev) => prev.map((c, i) => { if (i !== ci) return c; dirty.current.add(c.id); return fn(c); }));
  }

  function updateCat(ci, cati, field, val) {
    patchClass(ci, (c) => ({ ...c, categories: c.categories.map((cat, j) => j === cati ? { ...cat, [field]: val } : cat) }));
  }

  function addCategory(ci) {
    patchClass(ci, (c) => ({ ...c, categories: [...c.categories, { name: "New Category", weight: 0, earned: "", possible: "" }] }));
  }

  function removeCategory(ci, cati) {
    patchClass(ci, (c) => ({ ...c, categories: c.categories.filter((_, j) => j !== cati) }));
  }

  // class meeting times (Home's timeline reads these)
  function updateMeeting(ci, mi, field, val) {
    patchClass(ci, (c) => ({ ...c, meetings: (c.meetings || []).map((m, j) => (j === mi ? { ...m, [field]: val } : m)) }));
  }
  function toggleDay(ci, mi, d) {
    const days = (classes[ci].meetings || [])[mi].days;
    updateMeeting(ci, mi, "days", days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  }

  async function removeClass(ci) {
    if (!confirm(`Delete ${classes[ci].name} and all its scores? This can't be undone.`)) return;
    const cls = classes[ci];
    setClasses((prev) => prev.filter((_, i) => i !== ci));
    await supabase.from("grade_classes").delete().eq("id", cls.id);
  }

  // end of semester: download a backup of every class, then clear them for the next term
  async function newTerm() {
    if (!confirm("Start a new term? This downloads a backup of your classes and scores, then removes them all.")) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(classes, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `grades-backup-${new Date().toISOString().slice(0, 7)}.json`; a.click();
    URL.revokeObjectURL(url);
    const { error } = await supabase.from("grade_classes").delete().in("id", classes.map((c) => c.id));
    if (!error) setClasses([]);
  }

  async function addClass() {
    if (!newClassName.trim()) return;
    const row = { name: newClassName.trim(), categories: [{ name: "Category 1", weight: 50, earned: "", possible: "" }, { name: "Category 2", weight: 50, earned: "", possible: "" }] };
    const { data, error } = await supabase.from("grade_classes").insert(row).select().single();
    if (error) return;
    setClasses((prev) => [...prev, data]);
    setNewClassName("");
    setAddingClass(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="page-title">Final Grade Calculator</h1>
        {classes.length > 0 && <button className="btn" onClick={newTerm} title="Back up and clear all classes">New term</button>}
      </div>
      {loaded && !classes.length && <p className="empty">No classes yet. Add one below, then set its grade categories and meeting times.</p>}

      {classes.map((cls, ci) => {
        const { currentPct, remainingWeight, neededFor, remaining } = calcClass(cls.categories);
        const out = outcomes(cls.categories);
        const weightSum = cls.categories.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);
        return (
          <details key={cls.id} open className="card" style={{ marginBottom: "1rem" }}>
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

              {remainingWeight > 0 && (
                <div style={{ marginTop: "0.75rem", padding: "0.5rem", background: "var(--sidebar-bg)", borderRadius: 6 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                    Average you need on <strong>{remaining.join(" + ")}</strong> ({remainingWeight}% of grade):
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "0.4rem" }}>
                    {GRADE_THRESHOLDS.filter((g) => g.label !== "F").map(({ label }) => {
                      const need = neededFor[label];
                      const impossible = need > 100;
                      const locked = need <= 0;
                      return (
                        <span key={label} style={{ fontSize: "0.85rem", padding: "2px 8px", borderRadius: 4, background: "var(--card-bg)", border: "1px solid var(--border)", color: impossible ? "var(--error)" : locked ? "var(--success)" : "var(--fg)" }}>
                          <strong>{label}</strong>: {locked ? "Locked in" : impossible ? "Out of reach" : `${need.toFixed(1)}%`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {out && (
                <div style={{ marginTop: "0.5rem" }}>
                  <div className="muted" style={{ marginBottom: "0.25rem" }}>
                    Likely final grade: remaining exams predicted from your exam average
                    {out.examAvg !== null ? ` (${out.examAvg.toFixed(1)}%)` : " (no exams graded yet, so your overall %)"},
                    other work from {out.restAvg !== null ? `your other scores (${out.restAvg.toFixed(1)}%)` : "your overall %"}:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "0.4rem" }}>
                    {out.rows.map((o) => (
                      <span key={o.name} style={{ fontSize: "0.85rem", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                        <span className="muted">{o.name} ({o.avg.toFixed(0)}% avg)</span><br />
                        <strong style={{ color: gradeColor(o.final) }}>{o.letter}</strong> · {o.final.toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {remainingWeight === 0 && currentPct !== null && (
                <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>All coursework entered — final grade is {currentPct.toFixed(1)}% ({letterGrade(currentPct)}).</p>
              )}

              <details style={{ marginTop: "0.75rem" }}>
                <summary className="muted">
                  Schedule {(cls.meetings || []).length ? `· ${cls.meetings.map((m) => `${m.label ? m.label + " " : ""}${m.days.map((d) => DAYS[d]).join("/")} ${m.start}`).join(", ")}` : "· online / none"}
                </summary>
                <div className="row" style={{ alignItems: "center" }}>
                  <span className="muted">Term</span>
                  <input type="date" value={cls.term_start || ""} onChange={(e) => patchClass(ci, (c) => ({ ...c, term_start: e.target.value }))} aria-label="Term start" />
                  <span className="muted">to</span>
                  <input type="date" value={cls.term_end || ""} onChange={(e) => patchClass(ci, (c) => ({ ...c, term_end: e.target.value }))} aria-label="Term end" />
                </div>
                {(cls.meetings || []).map((m, mi) => (
                  <div key={mi} className="row" style={{ alignItems: "center" }}>
                    <input value={m.label} onChange={(e) => updateMeeting(ci, mi, "label", e.target.value)} placeholder="Lec/Lab" style={{ width: 70 }} aria-label="Meeting label" />
                    {DAYS.map((name, d) => (
                      <button key={d} type="button" className={`btn${m.days.includes(d) ? " btn-primary" : ""}`} style={{ padding: "2px 6px", fontSize: "0.75rem" }} onClick={() => toggleDay(ci, mi, d)} aria-pressed={m.days.includes(d)}>{name}</button>
                    ))}
                    <input type="time" value={m.start} onChange={(e) => updateMeeting(ci, mi, "start", e.target.value)} aria-label="Start time" />
                    <input type="time" value={m.end} onChange={(e) => updateMeeting(ci, mi, "end", e.target.value)} aria-label="End time" />
                    <input value={m.room} onChange={(e) => updateMeeting(ci, mi, "room", e.target.value)} placeholder="Room" style={{ width: 80 }} aria-label="Room" />
                    <button onClick={() => patchClass(ci, (c) => ({ ...c, meetings: c.meetings.filter((_, j) => j !== mi) }))} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer" }} aria-label="Remove meeting">×</button>
                  </div>
                ))}
                <button className="btn" style={{ fontSize: "0.8rem" }}
                  onClick={() => patchClass(ci, (c) => ({ ...c, meetings: [...(c.meetings || []), { label: "", days: [], start: "09:00", end: "09:50", room: "" }] }))}>+ Meeting time</button>
              </details>
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

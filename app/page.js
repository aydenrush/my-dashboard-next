"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ACTIVITY_TYPES } from "@/lib/constants";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCHOOL_SCHEDULE = [
  { name: "CS 25000 Lab", days: [3], time: "9:30 - 11:20 AM", start: "2026-08-27", end: "2026-12-10", room: "SL 251" },
  { name: "CS 25100 Pso", days: [2], time: "11:30 AM - 12:20 PM", start: "2026-08-26", end: "2026-12-09", room: "SL 247" },
  { name: "CS 25000", days: [1, 3], time: "1:30 - 2:45 PM", start: "2026-08-25", end: "2026-12-10", room: "ES 2107" },
  { name: "CS 25100", days: [0, 2, 4], time: "2:30 - 3:20 PM", start: "2026-08-24", end: "2026-12-11", room: "ES 2107" },
  { name: "MA 26500", days: [0, 2, 4], time: "4:30 - 5:20 PM", start: "2026-08-24", end: "2026-12-11", room: "SL 011" },
];

function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function getMonday(d) { const r = new Date(d); const day = r.getDay(); r.setDate(r.getDate() - ((day + 6) % 7)); return r; }
function jsWeekday(d) { return (new Date(d).getDay() + 6) % 7; }

export default function HomePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [focusDate, setFocusDate] = useState(isoDate(new Date()));
  const [activities, setActivities] = useState([]);
  const [runSchedule, setRunSchedule] = useState([]);
  const [books, setBooks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickType, setQuickType] = useState("running");
  const [quickSlot, setQuickSlot] = useState("Morning");
  const [quickNotes, setQuickNotes] = useState("");
  const [calEvents, setCalEvents] = useState([]);
  const [icalUrl, setIcalUrl] = useState("");
  const [showIcalSetup, setShowIcalSetup] = useState(false);

  const today = useMemo(() => isoDate(new Date()), []);
  const weekStart = useMemo(() => {
    const mon = getMonday(new Date());
    return addDays(mon, weekOffset * 7);
  }, [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart]);

  async function loadAll() {
    const [{ data: act }, { data: run }, { data: bk }, { data: td }] = await Promise.all([
      supabase.from("activities").select("*").order("date"),
      supabase.from("running_schedule").select("*").order("date"),
      supabase.from("books").select("*"),
      supabase.from("todos").select("*").order("created_at"),
    ]);
    setActivities(act || []);
    setRunSchedule(run || []);
    setBooks(bk || []);
    setTodos((td || []).filter((t) => !t.completed));
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const saved = localStorage.getItem("ical_url");
    if (saved) {
      setIcalUrl(saved);
      fetch(`/api/ical?url=${encodeURIComponent(saved)}`)
        .then((r) => r.ok ? r.json() : [])
        .then((events) => setCalEvents(events || []))
        .catch(() => {});
    }
  }, []);

  const focusDay = jsWeekday(focusDate);
  const focusDateObj = new Date(focusDate + "T00:00:00");
  const isToday = focusDate === today;

  const focusClasses = SCHOOL_SCHEDULE.filter((c) =>
    c.days.includes(focusDay) && focusDate >= c.start && focusDate <= c.end
  );
  const focusActs = activities.filter((a) => a.date === focusDate);
  const focusRuns = runSchedule.filter((r) => r.date === focusDate);
  const reading = books.filter((b) => b.status === "reading");
  const focusCal = calEvents.filter((e) => {
    const eDate = (e.start || "").slice(0, 10);
    return eDate === focusDate;
  });

  const completedDates = new Set();
  activities.filter((a) => a.completed).forEach((a) => completedDates.add(a.date));
  runSchedule.filter((r) => r.completed).forEach((r) => completedDates.add(r.date));

  let streak = 0;
  let check = new Date();
  if (!completedDates.has(isoDate(check))) check = addDays(check, -1);
  while (streak < 365 && completedDates.has(isoDate(check))) {
    streak++;
    check = addDays(check, -1);
  }

  const weekActs = activities.filter((a) => weekDates.includes(a.date));
  const weekRuns = runSchedule.filter((r) => weekDates.includes(r.date));
  const weekActDone = weekActs.filter((a) => a.completed).length;
  const weekRunDone = weekRuns.filter((r) => r.completed && !(r.workout_type || r.workout || "").startsWith("Rest")).length;
  const weekRunTotal = weekRuns.filter((r) => !(r.workout_type || r.workout || "").startsWith("Rest")).length;

  async function quickAdd(e) {
    e.preventDefault();
    await supabase.from("activities").insert({
      date: focusDate, activity_type: quickType, time_slot: quickSlot,
      notes: quickNotes.trim() || null, completed: false,
    });
    setQuickNotes("");
    setShowQuickAdd(false);
    loadAll();
  }

  async function toggleActivity(id, current) {
    await supabase.from("activities").update({ completed: !current }).eq("id", id);
    loadAll();
  }

  async function toggleRun(id, current) {
    await supabase.from("running_schedule").update({ completed: !current }).eq("id", id);
    loadAll();
  }

  async function completeTodo(id) {
    await supabase.from("todos").delete().eq("id", id);
    loadAll();
  }

  const dayLabel = DAY_NAMES[focusDay];
  const dateDisplay = focusDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>{dayLabel}, {dateDisplay}</h1>
        {!isToday && <button className="btn" onClick={() => { setFocusDate(today); setWeekOffset(0); }}>Today</button>}
      </div>

      <div className="metrics-row" style={{ marginBottom: "1rem" }}>
        <div className="metric"><div className="metric-label">Streak</div><div className="metric-value">{streak}d</div></div>
        <div className="metric"><div className="metric-label">Activities</div><div className="metric-value">{weekActDone}/{weekActs.length}</div></div>
        <div className="metric"><div className="metric-label">Runs</div><div className="metric-value">{weekRunDone}/{weekRunTotal}</div></div>
        <div className="metric"><div className="metric-label">Reading</div><div className="metric-value">{reading.length}</div></div>
      </div>

      <hr className="divider" />

      {focusClasses.map((c, i) => (
        <div key={i} style={{ borderLeft: "3px solid #2196F3", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem" }}>
          <span style={{ color: "#2196F3", fontSize: "0.8rem" }}>{c.time}</span> {c.name} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{c.room}</span>
        </div>
      ))}

      {focusCal.map((e, i) => {
        const time = e.start?.length > 10
          ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "All day";
        return (
          <div key={i} style={{ borderLeft: "3px solid #9C27B0", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem" }}>
            <span style={{ color: "#9C27B0", fontSize: "0.8rem" }}>{time}</span> {e.summary}
            {e.location && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> · {e.location}</span>}
          </div>
        );
      })}

      {focusRuns.map((r) => {
        const wo = r.workout_type || r.workout || "";
        const isRest = wo.startsWith("Rest");
        return (
          <div key={r.id} style={{
            borderLeft: `3px solid ${isRest ? "#607D8B" : "#F44336"}`,
            padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem",
            opacity: r.completed ? 0.5 : 1, textDecoration: r.completed ? "line-through" : "none",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span><span style={{ color: "#F44336", fontSize: "0.8rem" }}>Run</span> {wo}{r.distance ? ` · ${r.distance} mi` : ""}{r.notes ? ` — ${r.notes}` : ""}</span>
            {!isRest && <button className="btn" onClick={() => toggleRun(r.id, r.completed)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>{r.completed ? "Undo" : "Done"}</button>}
          </div>
        );
      })}

      {focusActs.map((a) => {
        const at = ACTIVITY_TYPES[a.activity_type] || { label: a.activity_type, color: "#607D8B" };
        return (
          <div key={a.id} style={{
            borderLeft: `3px solid ${at.color}`, padding: "4px 8px", margin: "4px 0",
            borderRadius: "3px", fontSize: "0.9rem",
            opacity: a.completed ? 0.5 : 1, textDecoration: a.completed ? "line-through" : "none",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span><span style={{ color: at.color, fontSize: "0.8rem" }}>{a.time_slot}</span> {at.label}{a.notes ? ` — ${a.notes}` : ""}</span>
            <button className="btn" onClick={() => toggleActivity(a.id, a.completed)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>{a.completed ? "Undo" : "Done"}</button>
          </div>
        );
      })}

      {focusClasses.length === 0 && focusRuns.length === 0 && focusActs.length === 0 && focusCal.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Nothing scheduled.</p>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        <button className="btn" onClick={() => setShowQuickAdd(!showQuickAdd)} style={{ fontSize: "0.8rem" }}>
          {showQuickAdd ? "Cancel" : "+ Add Activity"}
        </button>
      </div>

      {showQuickAdd && (
        <form onSubmit={quickAdd} style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0", flexWrap: "wrap" }}>
          <select value={quickType} onChange={(e) => setQuickType(e.target.value)}>
            {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={quickSlot} onChange={(e) => setQuickSlot(e.target.value)}>
            {["Morning", "Midday", "Afternoon", "Evening"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} placeholder="Notes" style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      )}

      <hr className="divider" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <button className="btn" onClick={() => setWeekOffset((w) => w - 1)} style={{ padding: "4px 12px" }}>&lt;</button>
        <span style={{ fontWeight: 600 }}>
          {addDays(weekStart, 0).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — {addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
        <button className="btn" onClick={() => setWeekOffset((w) => w + 1)} style={{ padding: "4px 12px" }}>&gt;</button>
      </div>

      <div style={{ display: "flex", gap: "4px", marginBottom: "1rem" }}>
        {weekDates.map((d, i) => {
          const dayActs = activities.filter((a) => a.date === d);
          const dayRuns = runSchedule.filter((r) => r.date === d);
          const hasDone = dayActs.some((a) => a.completed) || dayRuns.some((r) => r.completed);
          const isActive = d === focusDate;
          const isTodayDate = d === today;
          return (
            <div
              key={d}
              onClick={() => setFocusDate(d)}
              style={{
                flex: 1, textAlign: "center", padding: "8px 4px",
                borderRadius: "6px", cursor: "pointer",
                background: isActive ? "var(--accent)" : isTodayDate ? "rgba(33,150,243,0.1)" : "var(--card-bg)",
                color: isActive ? "white" : "inherit",
                border: isTodayDate && !isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: "0.85rem" }}>{new Date(d + "T00:00:00").getDate()}</div>
              {hasDone && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: isActive ? "white" : "#4CAF50", margin: "2px auto 0" }} />}
              {dayRuns.length > 0 && <div style={{ fontSize: "0.6rem", color: isActive ? "rgba(255,255,255,0.8)" : "#F44336", marginTop: "2px" }}>
                {(dayRuns[0].workout_type || dayRuns[0].workout || "").slice(0, 8)}
              </div>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {reading.length > 0 && (
          <div style={{ flex: 1, minWidth: "200px" }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Reading</h3>
            {reading.map((b) => {
              const pct = b.total_pages ? ((b.current_page || 0) / b.total_pages * 100).toFixed(0) : null;
              return (
                <p key={b.id} style={{ fontSize: "0.85rem", margin: "2px 0" }}>
                  {b.title}{pct ? ` — ${pct}%` : ""}
                </p>
              );
            })}
          </div>
        )}

        {todos.length > 0 && (
          <div style={{ flex: 1, minWidth: "200px" }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>To Do</h3>
            {todos.slice(0, 5).map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }}>
                <button className="btn" onClick={() => completeTodo(t.id)} style={{ padding: "1px 6px", fontSize: "0.7rem" }}>x</button>
                <span style={{ fontSize: "0.85rem" }}>{t.task}</span>
              </div>
            ))}
            {todos.length > 5 && <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>+{todos.length - 5} more</p>}
          </div>
        )}
      </div>

      <hr className="divider" />
      <button className="btn" onClick={() => setShowIcalSetup(!showIcalSetup)} style={{ fontSize: "0.8rem" }}>
        {showIcalSetup ? "Close" : icalUrl ? "Change Calendar" : "Connect Google Calendar"}
      </button>
      {showIcalSetup && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}>
            Paste your Google Calendar iCal URL (Settings &gt; calendar &gt; Secret address in iCal format)
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="text" value={icalUrl} onChange={(e) => setIcalUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..." style={{ flex: 1, fontSize: "0.8rem" }} />
            <button className="btn btn-primary" onClick={() => {
              if (icalUrl.trim()) {
                localStorage.setItem("ical_url", icalUrl.trim());
                fetch(`/api/ical?url=${encodeURIComponent(icalUrl.trim())}`)
                  .then((r) => r.ok ? r.json() : [])
                  .then((events) => { setCalEvents(events || []); setShowIcalSetup(false); })
                  .catch(() => {});
              } else {
                localStorage.removeItem("ical_url");
                setCalEvents([]);
                setShowIcalSetup(false);
              }
            }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ACTIVITY_TYPES, PRIORITY_COLORS } from "@/lib/constants";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = ["Morning", "Midday", "Afternoon", "Evening"];
const TIME_DISPLAY = { Morning: "8 AM", Midday: "11 AM", Afternoon: "2 PM", Evening: "5:30 PM" };
const TIME_HOURS = { Morning: [8, 0], Midday: [11, 0], Afternoon: [14, 0], Evening: [17, 30] };
const DURATION_MAP = { lifting: 45, cycling: 60, frisbee_golf: 120, rap_writing: 90, running: 45, other: 60 };

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
function fmtDay(d) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }); }

export default function HomePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [focusDate, setFocusDate] = useState(isoDate(new Date()));
  const [activities, setActivities] = useState([]);
  const [runSchedule, setRunSchedule] = useState([]);
  const [books, setBooks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [icalUrl, setIcalUrl] = useState("");

  // quick add
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickType, setQuickType] = useState("running");
  const [quickSlot, setQuickSlot] = useState("Morning");
  const [quickNotes, setQuickNotes] = useState("");

  // tool panels
  const [openTool, setOpenTool] = useState(null);

  // add activity form
  const [addType, setAddType] = useState("running");
  const [addDate, setAddDate] = useState("");
  const [addSlot, setAddSlot] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addDuration, setAddDuration] = useState("");
  const [addNotes, setAddNotes] = useState("");

  // plan the week
  const [planTypes, setPlanTypes] = useState(Array(7).fill("---"));
  const [planTitles, setPlanTitles] = useState(Array(7).fill(""));

  const today = useMemo(() => isoDate(new Date()), []);
  const thisYear = new Date().getFullYear();
  const weekStart = useMemo(() => {
    const mon = getMonday(new Date());
    return addDays(mon, weekOffset * 7);
  }, [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart]);

  const loadAll = useCallback(async () => {
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
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setAddDate(focusDate); }, [focusDate]);

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
  const focusCal = calEvents.filter((e) => (e.start || "").slice(0, 10) === focusDate);

  const completedDates = new Set();
  activities.filter((a) => a.completed).forEach((a) => completedDates.add(a.date));
  runSchedule.filter((r) => r.completed).forEach((r) => completedDates.add(r.date));

  let streak = 0;
  let check = new Date();
  if (!completedDates.has(isoDate(check))) check = addDays(check, -1);
  while (streak < 365 && completedDates.has(isoDate(check))) { streak++; check = addDays(check, -1); }

  const weekActs = activities.filter((a) => weekDates.includes(a.date));
  const weekRuns = runSchedule.filter((r) => weekDates.includes(r.date));
  const weekActDone = weekActs.filter((a) => a.completed).length;
  const weekRunDone = weekRuns.filter((r) => r.completed && !(r.workout || "").startsWith("Rest")).length;
  const weekRunTotal = weekRuns.filter((r) => !(r.workout || "").startsWith("Rest")).length;

  // year stats
  const yearStart = `${thisYear}-01-01`;
  const yrActs = activities.filter((a) => a.date >= yearStart && a.completed);
  const yrRuns = runSchedule.filter((r) => r.date >= yearStart && r.completed && !(r.workout || "").startsWith("Rest"));
  const yrBooks = books.filter((b) => b.status === "completed" && (b.end_date || "") >= yearStart);
  const yrPages = yrBooks.reduce((s, b) => s + (b.total_pages || 0), 0);

  // activity type breakdown for year
  const yrTypeCounts = {};
  yrActs.forEach((a) => {
    const label = (ACTIVITY_TYPES[a.activity_type] || ACTIVITY_TYPES.other).label;
    yrTypeCounts[label] = (yrTypeCounts[label] || 0) + 1;
  });
  const yrTypeMax = Math.max(...Object.values(yrTypeCounts), 1);

  async function quickAdd(e) {
    e.preventDefault();
    await supabase.from("activities").insert({
      date: focusDate, activity_type: quickType, time_slot: quickSlot,
      notes: quickNotes.trim() || null, completed: false,
    });
    setQuickNotes(""); setShowQuickAdd(false); loadAll();
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

  async function addActivity(e) {
    e.preventDefault();
    await supabase.from("activities").insert({
      date: addDate,
      activity_type: addType,
      title: addTitle.trim() || null,
      time_slot: addSlot || null,
      duration_min: addDuration ? parseInt(addDuration) : null,
      notes: addNotes.trim() || null,
      completed: false,
    });
    setAddTitle(""); setAddDuration(""); setAddNotes(""); loadAll();
  }

  async function deleteActivity(id) {
    await supabase.from("activities").delete().eq("id", id);
    loadAll();
  }

  async function planWeekSubmit() {
    let added = 0;
    for (let i = 0; i < 7; i++) {
      if (planTypes[i] !== "---") {
        await supabase.from("activities").insert({
          date: weekDates[i], activity_type: planTypes[i],
          title: planTitles[i].trim() || null, completed: false,
        });
        added++;
      }
    }
    if (added) {
      setPlanTypes(Array(7).fill("---"));
      setPlanTitles(Array(7).fill(""));
      loadAll();
    }
  }

  function buildIcs() {
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyDashboard//Planner//EN",
      "CALSCALE:GREGORIAN", "X-WR-CALNAME:Training Plan",
      "X-WR-TIMEZONE:America/Indiana/Indianapolis",
    ];
    const tz = "America/Indiana/Indianapolis";

    activities.forEach((act) => {
      const at = ACTIVITY_TYPES[act.activity_type] || ACTIVITY_TYPES.other;
      const summary = act.title ? `${at.label}: ${act.title}` : at.label;
      const [h, m] = TIME_HOURS[act.time_slot] || [8, 0];
      const dur = act.duration_min || DURATION_MAP[act.activity_type] || 60;
      const d = act.date.replace(/-/g, "");
      const dtstart = `${d}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
      const endMin = h * 60 + m + dur;
      const eh = Math.floor(endMin / 60), em = endMin % 60;
      const dtend = `${d}T${String(eh).padStart(2, "0")}${String(em).padStart(2, "0")}00`;
      lines.push("BEGIN:VEVENT", `UID:act-${act.id}@mydashboard`,
        `DTSTART;TZID=${tz}:${dtstart}`, `DTEND;TZID=${tz}:${dtend}`,
        `SUMMARY:${summary}`, "END:VEVENT");
    });

    runSchedule.forEach((run) => {
      const wo = run.workout || "";
      if (!wo.trim() || wo.startsWith("Rest")) return;
      const title = wo.split("\n")[0];
      const d = run.date.replace(/-/g, "");
      lines.push("BEGIN:VEVENT", `UID:run-${run.id}@mydashboard`,
        `DTSTART;TZID=${tz}:${d}T210000`, `DTEND;TZID=${tz}:${d}T220000`,
        `SUMMARY:Running: ${title}`, "END:VEVENT");
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  const [syncMsg, setSyncMsg] = useState("");

  async function publishFeed() {
    setSyncMsg("Publishing...");
    const icsBytes = new TextEncoder().encode(buildIcs());
    const opts = { contentType: "text/calendar", cacheControl: "max-age=300", upsert: true };
    const { error } = await supabase.storage.from("ical").upload("training_plan.ics", icsBytes, opts);
    if (error) {
      setSyncMsg("Error: " + error.message);
    } else {
      setSyncMsg("Published! Subscribe with the URL below.");
    }
  }

  function downloadIcs() {
    const blob = new Blob([buildIcs()], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "training_plan.ics"; a.click();
    URL.revokeObjectURL(url);
  }

  function toggleTool(name) {
    setOpenTool(openTool === name ? null : name);
  }

  const dayLabel = DAY_NAMES[focusDay];
  const dateDisplay = focusDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>{dayLabel}, {dateDisplay}</h1>
        {!isToday && <button className="btn" onClick={() => { setFocusDate(today); setWeekOffset(0); }}>Today</button>}
      </div>

      {/* Metrics */}
      <div className="metrics-row" style={{ marginBottom: "1rem" }}>
        <div className="metric"><div className="metric-label">Streak</div><div className="metric-value">{streak}d</div></div>
        <div className="metric"><div className="metric-label">Activities</div><div className="metric-value">{weekActDone}/{weekActs.length}</div></div>
        <div className="metric"><div className="metric-label">Runs</div><div className="metric-value">{weekRunDone}/{weekRunTotal}</div></div>
        <div className="metric"><div className="metric-label">Reading</div><div className="metric-value">{reading.length}</div></div>
      </div>

      <hr className="divider" />

      {/* Day schedule */}
      {focusClasses.map((c, i) => (
        <div key={i} style={{ borderLeft: "3px solid #FF6F00", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem", background: "rgba(255,111,0,0.08)" }}>
          <span style={{ color: "#FF6F00", fontSize: "0.8rem" }}>{c.time}</span> {c.name} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{c.room}</span>
        </div>
      ))}

      {focusCal.map((e, i) => {
        const time = e.start?.length > 10
          ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "All day";
        return (
          <div key={i} style={{ borderLeft: "3px solid #e94560", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem" }}>
            <span style={{ color: "#e94560", fontSize: "0.8rem" }}>{time}</span> {e.summary}
            {e.location && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> · {e.location}</span>}
          </div>
        );
      })}

      {focusRuns.map((r) => {
        const wo = r.workout || "";
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
        const title = a.title || at.label;
        const timeStr = TIME_DISPLAY[a.time_slot] || a.time_slot || "";
        return (
          <div key={a.id} style={{
            borderLeft: `3px solid ${at.color}`, padding: "4px 8px", margin: "4px 0",
            borderRadius: "3px", fontSize: "0.9rem",
            opacity: a.completed ? 0.5 : 1, textDecoration: a.completed ? "line-through" : "none",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>
              <span style={{ color: at.color, fontSize: "0.8rem" }}>{timeStr ? `${timeStr} ` : ""}{at.label}</span> {title !== at.label ? title : ""}
              {a.notes ? ` — ${a.notes}` : ""}
            </span>
            <button className="btn" onClick={() => toggleActivity(a.id, a.completed)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>{a.completed ? "Undo" : "Done"}</button>
          </div>
        );
      })}

      {focusClasses.length === 0 && focusRuns.length === 0 && focusActs.length === 0 && focusCal.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Nothing scheduled.</p>
      )}

      {/* Currently Reading */}
      {isToday && reading.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}>Currently Reading</p>
          {reading.map((b) => {
            const pct = b.total_pages ? ((b.current_page || 0) / b.total_pages * 100).toFixed(0) : null;
            return (
              <p key={b.id} style={{ fontSize: "0.85rem", margin: "2px 0" }}>
                <strong>{b.title}</strong>{b.author ? ` — ${b.author}` : ""}{pct ? ` · ${pct}%` : ""}
              </p>
            );
          })}
        </div>
      )}

      {/* Active To-Dos */}
      {isToday && todos.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}>To Do</p>
          {todos.slice(0, 5).map((t) => {
            const color = PRIORITY_COLORS[t.priority] || "#FF9800";
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }}>
                <button className="btn" onClick={() => completeTodo(t.id)} style={{ padding: "1px 6px", fontSize: "0.7rem" }}>x</button>
                <span style={{ borderLeft: `3px solid ${color}`, paddingLeft: "8px", fontSize: "0.85rem" }}>{t.task}</span>
              </div>
            );
          })}
          {todos.length > 5 && <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>+{todos.length - 5} more</p>}
        </div>
      )}

      {/* Quick Add */}
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
            {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} placeholder="Title / Notes" style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      )}

      {/* ============= WEEK VIEW ============= */}
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
            <div key={d} onClick={() => setFocusDate(d)} style={{
              flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: "6px", cursor: "pointer",
              background: isActive ? "var(--accent)" : isTodayDate ? "rgba(33,150,243,0.1)" : "var(--card-bg)",
              color: isActive ? "white" : "inherit",
              border: isTodayDate && !isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
            }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: "0.85rem" }}>{new Date(d + "T00:00:00").getDate()}</div>
              {hasDone && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: isActive ? "white" : "#4CAF50", margin: "2px auto 0" }} />}
              {dayRuns.length > 0 && <div style={{ fontSize: "0.6rem", color: isActive ? "rgba(255,255,255,0.8)" : "#F44336", marginTop: "2px" }}>
                {(dayRuns[0].workout || "").slice(0, 8)}
              </div>}
            </div>
          );
        })}
      </div>

      {/* ============= TOOL PANELS ============= */}
      <hr className="divider" />

      {/* Add Activity */}
      <details open={openTool === "add"} onToggle={(e) => { if (e.target.open) setOpenTool("add"); else if (openTool === "add") setOpenTool(null); }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Add Activity</summary>
        <form onSubmit={addActivity} style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <select value={addType} onChange={(e) => setAddType(e.target.value)} style={{ flex: 1 }}>
              {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} style={{ flex: 1 }} />
            <select value={addSlot} onChange={(e) => setAddSlot(e.target.value)} style={{ flex: 1 }}>
              <option value="">Time of Day</option>
              {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <input type="text" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Title (optional)" style={{ flex: 2 }} />
            <input type="number" value={addDuration} onChange={(e) => setAddDuration(e.target.value)} placeholder="Duration (min)" min="0" max="300" style={{ flex: 1 }} />
          </div>
          <input type="text" value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Notes (optional)" style={{ width: "100%", marginBottom: "0.5rem" }} />
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </details>

      {/* Manage Activities */}
      {activities.length > 0 && (
        <details onToggle={(e) => { if (e.target.open) setOpenTool("manage"); else if (openTool === "manage") setOpenTool(null); }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Manage Activities</summary>
          <div style={{ marginBottom: "1rem" }}>
            {weekActs.length === 0 ? (
              <p className="alert alert-info">No activities this week.</p>
            ) : (
              weekActs.map((act) => {
                const at = ACTIVITY_TYPES[act.activity_type] || ACTIVITY_TYPES.other;
                const title = act.title || at.label;
                return (
                  <div key={act.id} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0", fontSize: "0.85rem" }}>
                    <span style={{ flex: 1, color: "var(--muted)" }}>{fmtDay(act.date)} — {at.label}: {title}</span>
                    {!act.completed ? (
                      <button className="btn" onClick={() => toggleActivity(act.id, false)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>Done</button>
                    ) : (
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Done</span>
                    )}
                    <button className="btn" onClick={() => deleteActivity(act.id)} style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#F44336" }}>Del</button>
                  </div>
                );
              })
            )}
          </div>
        </details>
      )}

      {/* Plan the Week */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("plan"); else if (openTool === "plan") setOpenTool(null); }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Plan the Week</summary>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>Quickly add multiple activities for the week.</p>
        <div style={{ marginBottom: "0.5rem" }}>
          {weekDates.map((d, i) => (
            <div key={d} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ minWidth: "90px", fontWeight: 600, fontSize: "0.85rem" }}>
                {DAY_NAMES[i]} {new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
              </span>
              <select value={planTypes[i]} onChange={(e) => {
                const next = [...planTypes]; next[i] = e.target.value; setPlanTypes(next);
              }} style={{ flex: 1 }}>
                <option value="---">---</option>
                {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input type="text" value={planTitles[i]} onChange={(e) => {
                const next = [...planTitles]; next[i] = e.target.value; setPlanTitles(next);
              }} placeholder="Title" style={{ flex: 1 }} />
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={planWeekSubmit}>Add All</button>
      </details>

      {/* Sync to phone */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("sync"); else if (openTool === "sync") setOpenTool(null); }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Sync to phone</summary>
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Publish your training plan so your phone calendar updates automatically.
          </p>
          <div style={{ display: "flex", gap: "8px", marginBottom: "0.5rem" }}>
            <button className="btn btn-primary" onClick={publishFeed}>Publish feed</button>
            <button className="btn" onClick={downloadIcs}>Download .ics</button>
          </div>
          {syncMsg && <p style={{ fontSize: "0.85rem", color: syncMsg.startsWith("Error") ? "var(--danger)" : "var(--success)", marginBottom: "0.5rem" }}>{syncMsg}</p>}
          <code style={{ display: "block", fontSize: "0.75rem", wordBreak: "break-all", padding: "6px 8px", background: "var(--bg-secondary)", borderRadius: "4px", marginBottom: "4px" }}>
            {process.env.NEXT_PUBLIC_SUPABASE_URL?.replace("https://", "webcal://")}/storage/v1/object/public/ical/training_plan.ics
          </code>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Add this URL as a calendar subscription on your phone. It refreshes automatically.
          </p>
        </div>
      </details>

      {/* Year in Review */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("review"); else if (openTool === "review") setOpenTool(null); }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>{thisYear} in Review</summary>
        <div style={{ marginBottom: "1rem" }}>
          <div className="metrics-row" style={{ marginBottom: "1rem" }}>
            <div className="metric"><div className="metric-label">Activities</div><div className="metric-value">{yrActs.length}</div></div>
            <div className="metric"><div className="metric-label">Run Workouts</div><div className="metric-value">{yrRuns.length}</div></div>
            <div className="metric">
              <div className="metric-label">Books Read</div>
              <div className="metric-value">{yrBooks.length}</div>
              {yrPages > 0 && <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{yrPages.toLocaleString()} pages</div>}
            </div>
          </div>

          {Object.keys(yrTypeCounts).length > 0 && (
            <div>
              <p style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.5rem" }}>Activity Breakdown</p>
              {Object.entries(yrTypeCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ minWidth: "100px", fontSize: "0.85rem" }}>{label}</span>
                  <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
                    <div style={{ width: `${(count / yrTypeMax) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                  </div>
                  <span style={{ minWidth: "24px", fontSize: "0.85rem" }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* iCal Setup */}
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>
          {icalUrl ? "Change Calendar" : "Connect Google Calendar"}
        </summary>
        <div style={{ marginBottom: "1rem" }}>
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
                  .then((events) => setCalEvents(events || []))
                  .catch(() => {});
              } else {
                localStorage.removeItem("ical_url");
                setCalEvents([]);
              }
            }}>Save</button>
          </div>
        </div>
      </details>
    </div>
  );
}

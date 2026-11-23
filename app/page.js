"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import Link from "next/link";
import { ACTIVITY_TYPES, PALETTE } from "@/lib/constants";
import { bestRunMessage, loadLocation, fetchWeather } from "@/lib/weather";
import { getSetting, setSetting } from "@/lib/settings";
import { isoDate, addDays, mondayOf, weekdayIndex, DAY_NAMES } from "@/lib/dates";
import { bestReachable, outcomes, niceToHave } from "@/lib/grades";
import { planRow, isRestText } from "@/lib/runs";
import { buildIcs, parseTimeSlot, actStart } from "@/lib/ics";
import { publishFeed, queuePublish } from "@/lib/feed";


// class meeting times come from Grades (grade_classes.meetings, days 0 = Mon)
function classMeetings(gradeClasses) {
  return gradeClasses.flatMap((g) => (g.meetings || []).filter((m) => m.start).map((m) => {
    const [h, min] = m.start.split(":").map(Number);
    return {
      name: m.label ? `${g.name} ${m.label}` : g.name, days: m.days || [], room: m.room, startMin: h * 60 + min,
      time: [m.start, m.end].filter(Boolean).map(timeValToSlot).join(" - "),
      start: g.term_start || "0000-01-01", end: g.term_end || "9999-12-31",
    };
  }));
}

function fmtDay(d) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }); }

function formatTime(slot) {
  if (!slot) return "";
  const [h, m] = parseTimeSlot(slot);
  const ap = h >= 12 ? "PM" : "AM", h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function timeValToSlot(val) {
  if (!val) return null;
  const [h, m] = val.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM", h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function slotToTimeVal(slot) {
  const [h, m] = parseTimeSlot(slot);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function HomePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [focusDate, setFocusDate] = useState(isoDate(new Date()));
  const [activities, setActivities] = useState([]);
  const [books, setBooks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [icalUrl, setIcalUrl] = useState("");
  const [gradeClasses, setGradeClasses] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [weather, setWeather] = useState(null);

  // tool panels
  const [openTool, setOpenTool] = useState(null);

  // add activity form
  const [addType, setAddType] = useState("running");
  const [newTodo, setNewTodo] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addSlot, setAddSlot] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addDuration, setAddDuration] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [editId, setEditId] = useState(null);
  const [editGroup, setEditGroup] = useState(null);
  const [addRecur, setAddRecur] = useState(""); // empty = no repeat

  // recurring templates
  const [newTpl, setNewTpl] = useState({ activity_type: "lifting", title: "", time: "19:00", duration: "", notes: "", days: [], weeks: 8 });


  const today = isoDate(); // per render, so a tab left open overnight rolls over
  const thisYear = new Date().getFullYear();
  const weekStart = useMemo(() => {
    return addDays(mondayOf(isoDate()), weekOffset * 7);
  }, [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const loadAll = useCallback(async () => {
    const [{ data: act }, { data: bk }, { data: td }, { data: gc }, { data: pn }] = await Promise.all([
      supabase.from("activities").select("*").order("date"),
      supabase.from("books").select("*"),
      supabase.from("notes").select("*, note_tags(color)").eq("tag", "To Do").order("pinned", { ascending: false }).order("created_at"),
      supabase.from("grade_classes").select("*").order("id"),
      supabase.from("notes").select("id, content").eq("pinned", true).or('tag.is.null,tag.neq."To Do"').order("created_at", { ascending: false }).limit(3),
    ]);
    setActivities(act || []);
    setBooks(bk || []);
    setTodos(td || []);
    setGradeClasses(gc || []);
    setPinned(pn || []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setAddDate(focusDate); }, [focusDate]);
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem("last_activity") || "null");
      if (last) { setAddType(last.type); setAddSlot(last.slot || ""); setAddDuration(last.duration || ""); }
    } catch {}
  }, []);

  useEffect(() => {
    loadLocation().then((loc) => loc && fetchWeather(loc)).then((w) => w && setWeather(w)).catch(() => {});
  }, []);

  useEffect(() => {
    getSetting("ical_url").then((saved) => {
      if (!saved) return;
      setIcalUrl(saved);
      fetch(`/api/ical?url=${encodeURIComponent(saved)}`)
        .then((r) => r.ok ? r.json() : [])
        .then((events) => setCalEvents(events || []))
        .catch(() => {});
    });
  }, []);

  const focusDay = weekdayIndex(focusDate);
  const focusDateObj = new Date(focusDate + "T00:00:00");
  const isToday = focusDate === today;

  const focusClasses = classMeetings(gradeClasses).filter((c) =>
    c.days.includes(focusDay) && focusDate >= c.start && focusDate <= c.end
  );
  // planned runs are activities of type "running"; they get their own row style, so split them out
  const runSchedule = activities.filter((a) => a.activity_type === "running").map(planRow);
  const otherActs = activities.filter((a) => a.activity_type !== "running");
  // recurring schedules are rebuilt from their activities (grouped by gcal_event_id), so every device sees them
  const recurTemplates = Object.values(activities.filter((a) => a.gcal_event_id?.startsWith("recur_")).reduce((g, a) => {
    (g[a.gcal_event_id] ||= []).push(a);
    return g;
  }, {})).map((acts) => {
    const last = acts.reduce((m, a) => (a.date > m.date ? a : m));
    return {
      id: last.gcal_event_id, groupId: last.gcal_event_id, activity_type: last.activity_type, title: last.title, notes: last.notes,
      time: slotToTimeVal(last.time_slot), duration: last.duration_min, days: [...new Set(acts.map((a) => weekdayIndex(a.date)))].sort(),
    };
  });
  const focusActs = otherActs.filter((a) => a.date === focusDate).sort((a, b) => {
    const [ah, am] = parseTimeSlot(a.time_slot);
    const [bh, bm] = parseTimeSlot(b.time_slot);
    return (ah * 60 + am) - (bh * 60 + bm);
  });
  const focusRuns = runSchedule.filter((r) => r.date === focusDate);
  const reading = books.filter((b) => b.status === "reading");
  // timed events can be UTC ("...Z"), so take their local day. All-day events are plain dates and can span
  // several days: they run up to, but not including, their end date.
  const focusCal = calEvents.filter((e) => e.start && (e.start.length > 10
    ? isoDate(new Date(e.start)) === focusDate
    : focusDate >= e.start && focusDate < (e.end && e.end.length === 10 && e.end > e.start ? e.end : addDays(e.start, 1))));

  const focusTimeline = [
    ...focusClasses.map((c) => ({ type: "class", sortMin: c.startMin, data: c })),
    ...focusCal.map((e) => ({ type: "cal", sortMin: e.start?.length > 10 ? new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes() : 0, data: e })),
    ...focusRuns.map((r) => { const [h, m] = actStart(r); return { type: "run", sortMin: h * 60 + m, data: r }; }),
    ...focusActs.map((a) => { const [h, m] = parseTimeSlot(a.time_slot); return { type: "act", sortMin: h * 60 + m, data: a }; }),
  ].sort((a, b) => a.sortMin - b.sortMin);

  const completedDates = new Set();
  // rest days are auto-marked done on the Running page, so they don't count toward the streak
  activities.filter((a) => a.completed && !(a.activity_type === "running" && isRestText(a.title))).forEach((a) => completedDates.add(a.date));

  let streak = 0;
  let check = today;
  if (!completedDates.has(check)) check = addDays(check, -1);
  while (streak < 365 && completedDates.has(check)) { streak++; check = addDays(check, -1); }

  const weekActs = activities.filter((a) => weekDates.includes(a.date)); // Manage list: everything, runs included
  const weekOther = otherActs.filter((a) => weekDates.includes(a.date));
  const weekRuns = runSchedule.filter((r) => weekDates.includes(r.date));
  const weekActDone = weekOther.filter((a) => a.completed).length;
  const weekRunDone = weekRuns.filter((r) => r.completed && !isRestText(r.workout)).length;
  const weekRunTotal = weekRuns.filter((r) => !isRestText(r.workout)).length;

  // year stats
  const yearStart = `${thisYear}-01-01`;
  const yrActs = otherActs.filter((a) => a.date >= yearStart && a.completed);
  const yrRuns = runSchedule.filter((r) => r.date >= yearStart && r.completed && !isRestText(r.workout));
  const yrBooks = books.filter((b) => b.status === "completed" && (b.end_date || "") >= yearStart);
  const yrPages = yrBooks.reduce((s, b) => s + (b.total_pages || 0), 0);

  // activity type breakdown for year
  const yrTypeCounts = {};
  yrActs.forEach((a) => {
    const label = (ACTIVITY_TYPES[a.activity_type] || ACTIVITY_TYPES.other).label;
    yrTypeCounts[label] = (yrTypeCounts[label] || 0) + 1;
  });
  const yrTypeMax = Math.max(...Object.values(yrTypeCounts), 1);

  async function toggleActivity(id, current) {
    await supabase.from("activities").update({ completed: !current }).eq("id", id);
    loadAll(); queuePublish();
  }

  async function toggleRun(id, current) {
    await supabase.from("activities").update({ completed: !current }).eq("id", id);
    loadAll(); queuePublish();
  }

  // quick add from Home: a note tagged "To Do" (the tag is created the first time if needed)
  async function addTodo(e) {
    e.preventDefault();
    const content = newTodo.trim();
    if (!content) return;
    await supabase.from("note_tags").upsert({ name: "To Do", color: "rose" }, { onConflict: "name", ignoreDuplicates: true });
    const { error } = await supabase.from("notes").insert({ content, tag: "To Do" });
    if (error) return;
    setNewTodo("");
    loadAll();
  }

  async function completeTodo(id) {
    await supabase.from("notes").delete().eq("id", id);
    loadAll(); queuePublish();
  }

  async function addActivity(e) {
    e.preventDefault();
    const row = {
      activity_type: addType,
      title: addTitle.trim() || null,
      time_slot: timeValToSlot(addSlot) || null,
      duration_min: addDuration ? parseInt(addDuration) : null,
      notes: addNotes.trim() || null,
    };
    if (editId) {
      await supabase.from("activities").update({ ...row, date: addDate }).eq("id", editId);
      setEditId(null); setEditGroup(null);
    } else {
      const rows = [];
      const repeat = Math.max(0, parseInt(addRecur) || 0);
      const groupId = repeat > 0 ? `recur_${Date.now()}` : null;
      for (let w = 0; w <= repeat; w++) {
        rows.push({ ...row, date: addDays(addDate, w * 7), completed: false, gcal_event_id: groupId });
      }
      await supabase.from("activities").insert(rows);
    }
    if (!editId) localStorage.setItem("last_activity", JSON.stringify({ type: addType, slot: addSlot, duration: addDuration }));
    setAddTitle(""); setAddNotes(""); setAddRecur(""); loadAll(); queuePublish();
  }

  async function deleteActivity(id) {
    if (!(await askConfirm("Delete this activity?"))) return;
    await supabase.from("activities").delete().eq("id", id);
    loadAll(); queuePublish();
  }

  async function deleteSeriesActivity(groupId) {
    if (!(await askConfirm("Delete every activity in this repeating series?"))) return;
    await supabase.from("activities").delete().eq("gcal_event_id", groupId);
    loadAll(); queuePublish();
  }

  async function editSeriesActivity(act) {
    setEditId(act.id);
    setEditGroup(act.gcal_event_id);
    setAddType(act.activity_type);
    setAddDate(act.date);
    setAddSlot(slotToTimeVal(act.time_slot));
    setAddTitle(act.title || "");
    setAddDuration(act.duration_min ? String(act.duration_min) : "");
    setAddNotes(act.notes || "");
    setOpenTool("add");
  }

  async function updateSeries() {
    if (!editGroup) return;
    const row = {
      activity_type: addType,
      title: addTitle.trim() || null,
      time_slot: timeValToSlot(addSlot) || null,
      duration_min: addDuration ? parseInt(addDuration) : null,
      notes: addNotes.trim() || null,
    };
    await supabase.from("activities").update(row).eq("gcal_event_id", editGroup);
    setEditId(null); setEditGroup(null);
    setAddTitle(""); setAddDuration(""); setAddNotes(""); loadAll(); queuePublish();
  }

  async function updateFutureSeries() {
    if (!editGroup) return;
    const row = {
      activity_type: addType,
      title: addTitle.trim() || null,
      time_slot: timeValToSlot(addSlot) || null,
      duration_min: addDuration ? parseInt(addDuration) : null,
      notes: addNotes.trim() || null,
    };
    await supabase.from("activities").update(row).eq("gcal_event_id", editGroup).gte("date", addDate);
    setEditId(null); setEditGroup(null);
    setAddTitle(""); setAddDuration(""); setAddNotes(""); loadAll(); queuePublish();
  }

  async function createTemplate(e) {
    e.preventDefault();
    if (newTpl.days.length === 0) return;
    const groupId = `recur_${Date.now()}`;
    const tpl = { ...newTpl, groupId, duration: newTpl.duration ? parseInt(newTpl.duration) : null };
    await generateInstances(tpl, Math.max(1, parseInt(tpl.weeks) || 8)); // empty box = 8 weeks
    setNewTpl({ activity_type: "lifting", title: "", time: "19:00", duration: "", notes: "", days: [], weeks: 8 });
  }

  // adds `weeks` more weeks after the series' last activity (or from this week for a new one)
  async function generateInstances(tpl, weeks) {
    const rows = [];
    const last = activities.filter((a) => a.gcal_event_id === tpl.groupId).reduce((m, a) => (a.date > m ? a.date : m), "");
    const thisMon = mondayOf(today);
    const startMon = last && last >= thisMon ? addDays(mondayOf(last), 7) : thisMon;
    for (let w = 0; w < weeks; w++) {
      for (const day of tpl.days) {
        const d = addDays(startMon, w * 7 + day);
        if (d < today) continue;
        if (activities.some(a => a.gcal_event_id === tpl.groupId && a.date === d)) continue;
        rows.push({
          date: d, activity_type: tpl.activity_type, title: tpl.title || null,
          time_slot: timeValToSlot(tpl.time), duration_min: tpl.duration || null,
          notes: tpl.notes || null, completed: false, gcal_event_id: tpl.groupId,
        });
      }
    }
    if (rows.length > 0) {
      await supabase.from("activities").insert(rows);
      loadAll(); queuePublish();
    }
    return rows.length;
  }

  async function deleteTemplateAndInstances(tpl) {
    if (!(await askConfirm("Delete this recurring schedule and its upcoming activities?"))) return;
    await supabase.from("activities").delete().eq("gcal_event_id", tpl.groupId).gte("date", today);
    // keep past ones as history, but unlink them so the schedule drops off the list
    await supabase.from("activities").update({ gcal_event_id: null }).eq("gcal_event_id", tpl.groupId);
    loadAll(); queuePublish();
  }

  const [syncMsg, setSyncMsg] = useState("");

  async function publishNow() {
    setSyncMsg("Publishing...");
    const { error } = await publishFeed();
    if (error) {
      setSyncMsg("Error: " + error.message);
    } else {
      setSyncMsg("Published! Subscribe with the URL below.");
    }
  }

  function downloadIcs() {
    const blob = new Blob([buildIcs(activities)], { type: "text/calendar" });
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

      {/* Today at a glance: one line from each area */}
      {isToday && (() => {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const nextClass = focusClasses.filter((c) => c.startMin > nowMin).sort((a, b) => a.startMin - b.startMin)[0];
        const run = focusRuns[0];
        const runText = (run?.workout || "").split("\n")[0];
        const isRest = isRestText(runText);
        const runTip = run && !isRest && !run.completed ? bestRunMessage(weather) : null;
        const grades = gradeClasses.map((g) => ({ name: g.name, best: bestReachable(g.categories), pace: outcomes(g.categories)?.rows[1], nice: niceToHave(g.categories) })).filter((g) => g.best);
        return (
          <div className="card hub">
            <div><span className="hub-label">Class</span>{nextClass ? <>{nextClass.name} at {nextClass.time.split(" - ")[0]} · {nextClass.room}</> : <span className="muted">{focusClasses.length ? "Done for today" : "No classes today"}</span>}</div>
            <div><span className="hub-label">Run</span><Link href="/running">{run ? (isRest ? "Rest day" : `${runText}${run.completed ? " ✓" : ""}`) : <span className="muted">Nothing planned</span>}</Link>{runTip && <span className="muted"> · {runTip.replace("Best time to run: ", "best at ")}</span>}</div>
            {pinned.length > 0 && <div><span className="hub-label">Pinned</span><Link href="/brain-dump">{pinned.map((n) => n.content.split("\n")[0]).join(" · ")}</Link></div>}
            {grades.map((g, i) => (
              <div key={g.name}>
                <span className="hub-label">{i === 0 ? "Grades" : ""}</span>
                <Link href="/grades">
                  <strong>{g.name}</strong>{" "}
                  {g.pace && <>likely <strong>{g.pace.letter}</strong> ({g.pace.final.toFixed(2)}%) · </>}
                  {g.nice && <>would be nice <strong>{g.nice.label}</strong>, needs {(Math.ceil(g.nice.need * 100) / 100).toFixed(2)}% · </>}
                  {!g.best.on.length
                    ? <>final grade <strong>{g.best.label}</strong></>
                    : g.best.need <= 0
                      ? <><strong>{g.best.label}</strong> locked in</>
                      : <>best possible <strong>{g.best.label}</strong>, needs {(Math.ceil(g.best.need * 100) / 100).toFixed(2)}% {g.best.on.length > 1 ? "average " : ""}on {g.best.on.join(" + ")}</>}
                </Link>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Metrics */}
      <div className="metrics-row" style={{ marginBottom: "1rem" }}>
        <div className="metric"><div className="metric-label">Streak</div><div className="metric-value">{streak}d</div></div>
        <div className="metric"><div className="metric-label">Activities</div><div className="metric-value">{weekActDone}/{weekActs.length}</div></div>
        <div className="metric"><div className="metric-label">Runs</div><div className="metric-value">{weekRunDone}/{weekRunTotal}</div></div>
        <div className="metric"><div className="metric-label">Reading</div><div className="metric-value">{reading.length}</div></div>
      </div>

      <hr className="divider" />

      {/* Day schedule — unified timeline */}
      {focusTimeline.map((item, i) => {
        if (item.type === "class") {
          const c = item.data;
          return (
            <div key={`c${i}`} style={{ borderLeft: "3px solid #FF6F00", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem", background: "rgba(255,111,0,0.08)" }}>
              <span style={{ color: "#FF6F00", fontSize: "0.8rem" }}>{c.time}</span> {c.name} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{c.room}</span>
            </div>
          );
        }
        if (item.type === "cal") {
          const e = item.data;
          const time = e.start?.length > 10 ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "All day";
          return (
            <div key={`e${i}`} style={{ borderLeft: "3px solid #e94560", padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem" }}>
              <span style={{ color: "#e94560", fontSize: "0.8rem" }}>{time}</span> {e.summary}
              {e.location && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> · {e.location}</span>}
            </div>
          );
        }
        if (item.type === "run") {
          const r = item.data;
          const wo = r.workout || "";
          const isRest = isRestText(wo);
          return (
            <div key={`r${r.id}`} style={{
              borderLeft: `3px solid ${isRest ? "#64748b" : "#f43f5e"}`,
              padding: "4px 8px", margin: "4px 0", borderRadius: "3px", fontSize: "0.9rem",
              opacity: r.completed ? 0.5 : 1, textDecoration: r.completed ? "line-through" : "none",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span><span style={{ color: "#f43f5e", fontSize: "0.8rem" }}>Run</span> {wo}</span>
              {!isRest && <button className="btn" onClick={() => toggleRun(r.id, r.completed)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>{r.completed ? "Undo" : "Done"}</button>}
            </div>
          );
        }
        const a = item.data;
        const at = ACTIVITY_TYPES[a.activity_type] || { label: a.activity_type, color: "#64748b" };
        const title = a.title || at.label;
        const timeStr = formatTime(a.time_slot);
        return (
          <div key={`a${a.id}`} style={{
            borderLeft: `3px solid ${at.color}`, padding: "4px 8px", margin: "4px 0",
            borderRadius: "3px", fontSize: "0.9rem",
            opacity: a.completed ? 0.5 : 1, textDecoration: a.completed ? "line-through" : "none",
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          }}>
            <div>
              <span style={{ color: at.color, fontSize: "0.8rem" }}>{timeStr ? `${timeStr} ` : ""}{at.label}</span> {title !== at.label ? title : ""}
              {a.notes && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "1px" }}>{a.notes}</div>}
            </div>
            <button className="btn" onClick={() => toggleActivity(a.id, a.completed)} style={{ padding: "2px 8px", fontSize: "0.75rem", flexShrink: 0 }}>{a.completed ? "Undo" : "Done"}</button>
          </div>
        );
      })}

      {focusTimeline.length === 0 && (
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
      {isToday && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}><Link href="/brain-dump">To Do</Link></p>
          {todos.slice(0, 5).map((t) => {
            const color = PALETTE[t.note_tags?.color] || PALETTE.rose;
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }}>
                <button className="btn" onClick={() => completeTodo(t.id)} title="Done (deletes the note)" style={{ padding: "1px 6px", fontSize: "0.7rem" }}>x</button>
                <span style={{ borderLeft: `3px solid ${color}`, paddingLeft: "8px", fontSize: "0.85rem" }}>{t.pinned ? "📌 " : ""}{t.content.split("\n")[0]}</span>
              </div>
            );
          })}
          {todos.length > 5 && <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}><Link href="/brain-dump">+{todos.length - 5} more</Link></p>}
          <form onSubmit={addTodo} style={{ marginTop: "4px" }}>
            <input value={newTodo} onChange={(e) => setNewTodo(e.target.value)} placeholder="+ to-do (Enter to add)" aria-label="New to-do"
              style={{ width: "100%", maxWidth: 360, fontSize: "0.85rem", padding: "3px 8px" }} />
          </form>
        </div>
      )}

      {/* ============= WEEK VIEW ============= */}
      <hr className="divider" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <button className="btn" onClick={() => setWeekOffset((w) => w - 1)} style={{ padding: "4px 12px" }}>&lt;</button>
        <span style={{ fontWeight: 600 }}>
          {new Date(weekStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — {new Date(addDays(weekStart, 6) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
              {hasDone && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: isActive ? "white" : "#10b981", margin: "2px auto 0" }} />}
              {dayRuns.length > 0 && <div style={{ fontSize: "0.6rem", color: isActive ? "rgba(255,255,255,0.8)" : "#f43f5e", marginTop: "2px" }}>
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
        <summary>{editId ? "Edit Activity" : "Add Activity"}</summary>
        <form onSubmit={addActivity} style={{ marginBottom: "1rem" }}>
          <div className="row">
            <select value={addType} onChange={(e) => setAddType(e.target.value)} style={{ flex: "1 1 120px", minWidth: 0 }}>
              {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} style={{ flex: "1 1 120px", minWidth: 0 }} />
            <input type="time" value={addSlot} onChange={(e) => setAddSlot(e.target.value)} style={{ flex: "1 1 100px", minWidth: 0 }} />
          </div>
          <div className="row">
            <input type="text" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Title (optional)" style={{ flex: 2 }} />
            <input type="number" value={addDuration} onChange={(e) => setAddDuration(e.target.value)} placeholder="Duration (min)" min="0" max="300" style={{ flex: 1 }} />
          </div>
          <input type="text" value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Notes (optional)" style={{ width: "100%", marginBottom: "0.5rem" }} />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary">{editId ? "Save This" : "Add"}</button>
            {editGroup && <button type="button" className="btn btn-primary" onClick={updateSeries}>Save All</button>}
            {editGroup && <button type="button" className="btn" onClick={updateFutureSeries}>Save Future</button>}
            {editId && <button type="button" className="btn" onClick={() => { setEditId(null); setEditGroup(null); setAddTitle(""); setAddDuration(""); setAddNotes(""); setAddSlot(""); }}>Cancel</button>}
            {!editId && (
              <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "4px" }}>
                Repeat weekly <input type="number" value={addRecur} placeholder="0" onChange={(e) => setAddRecur(e.target.value)} min="0" max="52" style={{ width: "50px" }} /> wks
              </label>
            )}
          </div>
        </form>
      </details>

      {/* Manage Activities */}
      {activities.length > 0 && (
        <details onToggle={(e) => { if (e.target.open) setOpenTool("manage"); else if (openTool === "manage") setOpenTool(null); }}>
          <summary>Manage Activities</summary>
          <div style={{ marginBottom: "1rem" }}>
            {weekActs.length === 0 ? (
              <p className="alert alert-info">No activities this week.</p>
            ) : (
              weekActs.map((act) => {
                const at = ACTIVITY_TYPES[act.activity_type] || ACTIVITY_TYPES.other;
                const title = act.title || at.label;
                const isSeries = act.gcal_event_id?.startsWith("recur_");
                return (
                  <div key={act.id} style={{ display: "flex", alignItems: "center", gap: "6px", margin: "4px 0", fontSize: "0.85rem", flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 100%", color: "var(--muted)", minWidth: 0 }}>
                      {fmtDay(act.date)} — {at.label}: {title}{act.time_slot ? ` · ${formatTime(act.time_slot)}` : ""}
                      {isSeries && <span title="Recurring series"> ↻</span>}
                    </span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => editSeriesActivity(act)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>Edit</button>
                      {!act.completed ? (
                        <button className="btn" onClick={() => toggleActivity(act.id, false)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>Done</button>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)", padding: "2px 8px" }}>Done</span>
                      )}
                      <button className="btn" onClick={() => deleteActivity(act.id)} style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#f43f5e" }}>Del</button>
                      {isSeries && <button className="btn" onClick={() => deleteSeriesActivity(act.gcal_event_id)} style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#f43f5e" }}>Del All</button>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </details>
      )}

      {/* Recurring Schedules */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("recur"); else if (openTool === "recur") setOpenTool(null); }}>
        <summary>Recurring Schedules</summary>
        <div style={{ marginBottom: "1rem" }}>
          {recurTemplates.length > 0 && recurTemplates.map((tpl) => {
            const at = ACTIVITY_TYPES[tpl.activity_type] || ACTIVITY_TYPES.other;
            const dayNames = (tpl.days || []).map(d => DAY_NAMES[d]).join(", ");
            const instances = activities.filter(a => a.gcal_event_id === tpl.groupId);
            const futureCount = instances.filter(a => a.date >= today).length;
            const lastDate = instances.length ? instances.sort((a, b) => a.date > b.date ? 1 : -1)[instances.length - 1].date : null;
            return (
              <div key={tpl.id} style={{ borderLeft: `3px solid ${at.color}`, padding: "6px 8px", margin: "6px 0", borderRadius: "3px", fontSize: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span><strong>{at.label}{tpl.title ? `: ${tpl.title}` : ""}</strong> — {dayNames} @ {formatTime(tpl.time)}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>
                  {futureCount} upcoming{lastDate ? ` · through ${new Date(lastDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                </div>
                <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                  <button className="btn" onClick={() => generateInstances(tpl, 4)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>+4 wks</button>
                  <button className="btn" onClick={() => generateInstances(tpl, 8)} style={{ padding: "2px 8px", fontSize: "0.75rem" }}>+8 wks</button>
                  <button className="btn" onClick={() => deleteTemplateAndInstances(tpl)} style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#f43f5e" }}>Delete</button>
                </div>
              </div>
            );
          })}
          {recurTemplates.length === 0 && <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>No recurring schedules yet.</p>}
          <form onSubmit={createTemplate} style={{ marginTop: "0.5rem", padding: "8px", background: "var(--bg-secondary)", borderRadius: "6px" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>New Recurring Schedule</p>
            <div className="row">
              <select value={newTpl.activity_type} onChange={(e) => setNewTpl(p => ({ ...p, activity_type: e.target.value }))} style={{ flex: 1 }}>
                {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input type="time" value={newTpl.time} onChange={(e) => setNewTpl(p => ({ ...p, time: e.target.value }))} style={{ flex: 1 }} />
              <input type="number" value={newTpl.duration} onChange={(e) => setNewTpl(p => ({ ...p, duration: e.target.value }))} placeholder="Min" min="0" max="300" style={{ width: "60px" }} />
            </div>
            <div className="row">
              <input type="text" value={newTpl.title} onChange={(e) => setNewTpl(p => ({ ...p, title: e.target.value }))} placeholder="Title (optional)" style={{ flex: 1 }} />
              <input type="text" value={newTpl.notes} onChange={(e) => setNewTpl(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              {DAY_NAMES.map((name, i) => (
                <button key={i} type="button" onClick={() => setNewTpl(p => ({ ...p, days: p.days.includes(i) ? p.days.filter(d => d !== i) : [...p.days, i].sort() }))}
                  style={{ padding: "4px 8px", fontSize: "0.75rem", borderRadius: "4px", border: "1px solid var(--border)", background: newTpl.days.includes(i) ? "var(--accent)" : "transparent", color: newTpl.days.includes(i) ? "white" : "inherit", cursor: "pointer" }}>
                  {name}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button type="submit" className="btn btn-primary" disabled={newTpl.days.length === 0}>Create</button>
              <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "4px" }}>
                Generate <input type="number" value={newTpl.weeks} placeholder="8" onChange={(e) => setNewTpl(p => ({ ...p, weeks: e.target.value }))} min="1" max="52" style={{ width: "50px" }} /> wks
              </label>
            </div>
          </form>
        </div>
      </details>

      {/* Sync to phone */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("sync"); else if (openTool === "sync") setOpenTool(null); }}>
        <summary>Sync to phone</summary>
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Your plan publishes to your phone automatically whenever you change it. Use Publish now to force an update.
          </p>
          <div style={{ display: "flex", gap: "8px", marginBottom: "0.5rem" }}>
            <button className="btn btn-primary" onClick={publishNow}>Publish now</button>
            <button className="btn" onClick={downloadIcs}>Download .ics</button>
          </div>
          {syncMsg && <p style={{ fontSize: "0.85rem", color: syncMsg.startsWith("Error") ? "var(--error)" : "var(--success)", marginBottom: "0.5rem" }}>{syncMsg}</p>}
          <code style={{ display: "block", fontSize: "0.75rem", wordBreak: "break-all", padding: "6px 8px", background: "var(--bg-secondary)", borderRadius: "4px", marginBottom: "4px" }}>
            {process.env.NEXT_PUBLIC_SUPABASE_URL?.replace("https://", "webcal://")}/storage/v1/object/public/ical/training_plan.ics
          </code>
          <p className="muted">
            Add this URL as a calendar subscription on your phone. It refreshes automatically.
          </p>
        </div>
      </details>

      {/* Year in Review */}
      <details onToggle={(e) => { if (e.target.open) setOpenTool("review"); else if (openTool === "review") setOpenTool(null); }}>
        <summary>{thisYear} in Review</summary>
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
        <summary>
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
                setSetting("ical_url", icalUrl.trim());
                fetch(`/api/ical?url=${encodeURIComponent(icalUrl.trim())}`)
                  .then((r) => r.ok ? r.json() : [])
                  .then((events) => setCalEvents(events || []))
                  .catch(() => {});
              } else {
                setSetting("ical_url", null);
                setCalEvents([]);
              }
            }}>Save</button>
          </div>
        </div>
      </details>
    </div>
  );
}

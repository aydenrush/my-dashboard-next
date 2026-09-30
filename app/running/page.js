"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { bestRunHour, fmtHour } from "@/lib/weather";
import { ACTIVITY_TYPES } from "@/lib/constants";

// --- constants ---

const TYPE_COLORS = {
  rest: "#888888", easy: "#4CAF50", tempo: "#FF9800",
  hills: "#9C27B0", speed: "#F44336", long: "#2196F3",
};
const TYPE_LABELS = {
  rest: "Rest", easy: "Easy", tempo: "Tempo",
  hills: "Hills", speed: "Speed", long: "Long Run",
};

function workoutType(text) {
  const t = (text || "").split("\n")[0].trim();
  if (t === "Rest Day") return "rest";
  if (/Rest|Cross/i.test(t)) return "rest";
  if (/Tempo/i.test(t)) return "tempo";
  if (/Hill/i.test(t)) return "hills";
  if (/Fartlek|Speed|Repeat|Interval/i.test(t)) return "speed";
  if (/Long|Aerobic/i.test(t)) return "long";
  return "easy";
}

function fmtPace(secs) {
  if (!secs || secs <= 0) return "--";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}/mi`;
}

function fmtDuration(secs) {
  if (!secs || secs <= 0) return "--";
  secs = Math.round(secs);
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toDate(d) {
  if (!d) return null;
  const s = typeof d === "string" ? d.slice(0, 10) : d;
  return s;
}

function isoToday() {
  // America/Indiana/Indianapolis
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" })
  ).toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const d = new Date(iso + "T12:00:00");
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtShortDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "2-digit", day: "2-digit" });
}

function fmtMD(iso) {
  const d = new Date(iso + "T12:00:00");
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ============================================================

export default function RunningPage() {
  const [schedule, setSchedule] = useState([]);
  const [runLogs, setRunLogs] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState(null);
  const [tab, setTab] = useState("schedule");
  const [analyticsTab, setAnalyticsTab] = useState("mileage");
  const [showRest, setShowRest] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);

  // manual run log form
  const [mrDate, setMrDate] = useState("");
  const [mrDist, setMrDist] = useState("");
  const [mrMins, setMrMins] = useState("");
  const [mrSecs, setMrSecs] = useState("");
  const [mrNotes, setMrNotes] = useState("");
  const [showLogForm, setShowLogForm] = useState(false);

  // add schedule form
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);

  // edit schedule
  const [editingId, setEditingId] = useState(null);
  const [editWorkout, setEditWorkout] = useState("");

  const today = isoToday();

  const load = useCallback(async () => {
    const [{ data: sched }, { data: logs }, { data: acts }] = await Promise.all([
      supabase.from("running_schedule").select("*").order("date"),
      supabase.from("run_logs").select("*").order("date"),
      supabase.from("activities").select("*").order("date"),
    ]);
    setSchedule((sched || []).map((r) => ({ ...r, date: toDate(r.date), _type: workoutType(r.workout) })));
    setRunLogs((logs || []).map((r) => ({ ...r, date: toDate(r.date) })));
    setActivities((acts || []).map((r) => ({ ...r, date: toDate(r.date) })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // auto-complete past rest days
  useEffect(() => {
    if (!schedule.length) return;
    const pastRest = schedule.filter((r) => r.date <= today && r._type === "rest" && !r.completed);
    if (pastRest.length) {
      Promise.all(pastRest.map((r) =>
        supabase.from("running_schedule").update({ completed: true }).eq("id", r.id)
      )).then(load);
    }
  }, [schedule.length, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // fetch weather
  useEffect(() => {
    const saved = localStorage.getItem("weather_location");
    if (!saved) return;
    const loc = JSON.parse(saved);
    fetch(`/api/weather?lat=${loc.lat}&lon=${loc.lon}&days=1`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setWeather(data); })
      .catch(() => {});
  }, []);

  useEffect(() => { setMrDate(today); }, [today]);

  // --- derived data ---
  const hasSchedule = schedule.length > 0;
  const hasLogs = runLogs.length > 0;

  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const weekSchedule = schedule.filter((r) => r.date >= weekStart && r.date <= weekEnd);

  const todayRow = schedule.find((r) => r.date === today);
  const todayLogs = runLogs.filter((r) => r.date === today);

  // snapshot metrics
  const lastWkStart = addDays(weekStart, -7);
  const lastWkEnd = addDays(weekStart, -1);
  const thisWkLogs = runLogs.filter((r) => r.date >= weekStart && r.date <= weekEnd);
  const lastWkLogs = runLogs.filter((r) => r.date >= lastWkStart && r.date <= lastWkEnd);
  const thisWkMi = thisWkLogs.reduce((s, r) => s + (r.distance_miles || 0), 0);
  const lastWkMi = lastWkLogs.reduce((s, r) => s + (r.distance_miles || 0), 0);

  // ACWR
  const sortedLogs = [...runLogs].sort((a, b) => a.date.localeCompare(b.date));
  let acwr = 0;
  if (sortedLogs.length >= 2) {
    const ld = sortedLogs[sortedLogs.length - 1].date;
    const acuteStart = addDays(ld, -6);
    const chronicStart = addDays(ld, -27);
    const ac = sortedLogs.filter((r) => r.date >= acuteStart && r.date <= ld)
      .reduce((s, r) => s + (r.distance_miles || 0), 0);
    const ch = sortedLogs.filter((r) => r.date >= chronicStart && r.date <= ld)
      .reduce((s, r) => s + (r.distance_miles || 0), 0) / 4;
    acwr = ch > 0 ? +(ac / ch).toFixed(2) : 0;
  }

  const paceVals = runLogs.filter((r) => r.pace_seconds > 0).map((r) => r.pace_seconds);
  const last5Pace = paceVals.length >= 5
    ? paceVals.slice(-5).reduce((s, v) => s + v, 0) / 5
    : paceVals.length ? paceVals.reduce((s, v) => s + v, 0) / paceVals.length : 0;
  const overallPace = paceVals.length ? paceVals.reduce((s, v) => s + v, 0) / paceVals.length : 0;

  const medianPace = paceVals.length
    ? [...paceVals].sort((a, b) => a - b)[Math.floor(paceVals.length / 2)]
    : 0;
  const easyCount = medianPace > 0 ? paceVals.filter((p) => p > medianPace * 1.05).length : 0;
  const easyPct = paceVals.length ? (easyCount / paceVals.length) * 100 : 0;

  // best run hour from weather
  let bestHourMsg = null;
  if (weather?.hourly) {
    const temps = weather.hourly.temperature_2m;
    const apparent = weather.hourly.apparent_temperature || temps;
    const humids = weather.hourly.relative_humidity_2m;
    const precip = weather.hourly.precipitation_probability || Array(24).fill(0);
    const dewpoint = weather.hourly.dewpoint_2m || null;
    const now = new Date().getHours();
    const br = bestRunHour(temps, humids, precip, now, { apparent, dewpoint });
    if (br !== null) {
      const t = temps[br], f = apparent[br], h = humids[br];
      const p = br < precip.length ? precip[br] : 0;
      const rain = p > 0 ? `, ${p}% rain` : "";
      const feels = Math.abs(f - t) >= 2 ? ` (feels ${Math.round(f)}°F)` : "";
      bestHourMsg = `Best time to run: ${fmtHour(br)} — ${Math.round(t)}°F${feels}, ${h}% humidity${rain}`;
    }
  }

  // --- actions ---

  async function markComplete(id) {
    await supabase.from("running_schedule").update({ completed: true }).eq("id", id);
    load();
  }

  async function saveEdit(id) {
    await supabase.from("running_schedule").update({ workout: editWorkout }).eq("id", id);
    setEditingId(null);
    load();
  }

  async function deleteScheduleRow(id) {
    await supabase.from("running_schedule").delete().eq("id", id);
    load();
  }

  async function logRun(e) {
    e.preventDefault();
    const dist = parseFloat(mrDist);
    if (!dist || dist <= 0) return;
    const totalSecs = (parseInt(mrMins) || 0) * 60 + (parseInt(mrSecs) || 0);
    const pace = totalSecs > 0 && dist > 0 ? Math.round(totalSecs / dist) : null;
    await supabase.from("run_logs").insert({
      date: mrDate,
      distance_miles: +dist.toFixed(2),
      duration_seconds: totalSecs > 0 ? totalSecs : null,
      pace_seconds: pace,
      notes: mrNotes.trim() || null,
      source: "manual",
    });
    // auto-complete matching schedule entry
    const match = schedule.find((r) => r.date === mrDate && !r.completed);
    if (match) {
      await supabase.from("running_schedule").update({ completed: true }).eq("id", match.id);
    }
    setMrDist(""); setMrMins(""); setMrSecs(""); setMrNotes("");
    setShowLogForm(false);
    load();
  }

  async function deleteRunLog(id) {
    await supabase.from("run_logs").delete().eq("id", id);
    load();
  }

  async function uploadSchedule() {
    if (!pasteText.trim()) return;
    const rows = [];
    for (const line of pasteText.trim().split("\n")) {
      let parts = line.split("\t");
      if (parts.length < 2) parts = line.split(/\s+(.+)/);
      if (parts.length < 2) continue;
      const dateStr = parts[0].trim();
      const workout = parts[1].trim().replace(/•/g, "\n-");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      rows.push({ date: dateStr, workout: workout || "Rest Day", completed: false });
    }
    if (!rows.length) return;
    if (replaceExisting) {
      await supabase.from("running_schedule").delete().neq("id", 0);
    }
    await supabase.from("running_schedule").insert(rows);
    setPasteText(""); setShowAddSchedule(false);
    load();
  }

  // --- weekly mileage for chart ---
  function weeklyMileage() {
    const byWeek = {};
    for (const r of sortedLogs) {
      const wk = mondayOf(r.date);
      byWeek[wk] = (byWeek[wk] || 0) + (r.distance_miles || 0);
    }
    const weeks = Object.keys(byWeek).sort();
    return weeks.map((w) => ({ week: w, miles: +byWeek[w].toFixed(1) }));
  }

  // --- pace trend for chart ---
  function paceTrend() {
    const withPace = sortedLogs.filter((r) => r.pace_seconds > 0);
    if (withPace.length < 2) return [];
    return withPace.map((r, i, arr) => {
      const slice = arr.slice(Math.max(0, i - 6), i + 1);
      const avg7 = slice.reduce((s, v) => s + v.pace_seconds, 0) / slice.length;
      return { date: r.date, pace: r.pace_seconds, avg7: Math.round(avg7) };
    });
  }

  // --- training load ACWR over time ---
  function acwrTrend() {
    if (sortedLogs.length < 2) return [];
    const dates = [...new Set(sortedLogs.map((r) => r.date))].sort();
    return dates.map((d) => {
      const acStart = addDays(d, -6);
      const chStart = addDays(d, -27);
      const ac = sortedLogs.filter((r) => r.date >= acStart && r.date <= d)
        .reduce((s, r) => s + (r.distance_miles || 0), 0);
      const ch = sortedLogs.filter((r) => r.date >= chStart && r.date <= d)
        .reduce((s, r) => s + (r.distance_miles || 0), 0) / 4;
      return { date: d, acwr: ch > 0 ? +(ac / ch).toFixed(2) : 0 };
    });
  }

  if (loading) return <div><h1 className="page-title">Training</h1><p>Loading...</p></div>;

  const acwrStatus = acwr > 1.5 ? "High risk" : acwr > 1.3 ? "Caution" : acwr >= 0.8 ? "Sweet spot" : "Detraining";

  // schedule display
  const displaySchedule = showRest ? schedule : schedule.filter((r) => r._type !== "rest");
  const upcomingSchedule = displaySchedule.filter((r) => r.date >= today);
  const pastSchedule = [...displaySchedule.filter((r) => r.date < today)].reverse();

  // progress
  const totalWorkouts = schedule.filter((r) => r._type !== "rest").length;
  const completedWorkouts = schedule.filter((r) => r._type !== "rest" && r.completed).length;
  const progressPct = totalWorkouts > 0 ? Math.round((completedWorkouts / totalWorkouts) * 100) : 0;

  // run log display
  const sortedRunLogs = [...runLogs].sort((a, b) => b.date.localeCompare(a.date));
  const rlWeekMi = thisWkLogs.reduce((s, r) => s + (r.distance_miles || 0), 0);
  const rlTotalMi = runLogs.reduce((s, r) => s + (r.distance_miles || 0), 0);
  const rlBestPace = paceVals.length ? Math.min(...paceVals) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="page-title">Training</h1>
        <a href="https://www.strava.com/dashboard" target="_blank" rel="noopener noreferrer"
          className="btn" style={{ fontSize: "0.85rem" }}>Strava</a>
      </div>

      {/* Best run hour */}
      {bestHourMsg && <div className="alert alert-success">{bestHourMsg}</div>}

      {/* No schedule message */}
      {!hasSchedule && <div className="alert alert-info">No schedule loaded yet. Add workouts below.</div>}

      {/* Today's Workout */}
      {hasSchedule && todayRow && (
        <div style={{
          borderLeft: `5px solid ${TYPE_COLORS[todayRow._type]}`,
          padding: "12px 16px", borderRadius: "4px", marginBottom: "16px",
        }}>
          <span style={{ color: TYPE_COLORS[todayRow._type], fontWeight: "bold", fontSize: "0.85em" }}>
            {TYPE_LABELS[todayRow._type].toUpperCase()}
          </span>
          <h3 style={{ margin: "4px 0" }}>Today&apos;s Workout</h3>
          <p style={{ whiteSpace: "pre-line", margin: 0 }}>{todayRow.workout}</p>
          {!todayRow.completed ? (
            <button className="btn btn-primary" style={{ marginTop: "8px" }}
              onClick={() => markComplete(todayRow.id)}>Mark Complete</button>
          ) : (
            <div className="alert alert-success" style={{ marginTop: "8px" }}>Completed!</div>
          )}
          {todayLogs.map((tl) => {
            const parts = [];
            if (tl.distance_miles) parts.push(`${(+tl.distance_miles).toFixed(2)} mi`);
            if (tl.duration_seconds > 0) parts.push(fmtDuration(tl.duration_seconds));
            if (tl.pace_seconds > 0) parts.push(fmtPace(tl.pace_seconds));
            if (tl.elevation_gain_ft > 0) parts.push(`↑${Math.round(tl.elevation_gain_ft)} ft`);
            return parts.length ? (
              <p key={tl.id} style={{ fontSize: "0.85em", color: "#888", margin: "4px 0 0" }}>
                Actual: {parts.join(" · ")}
              </p>
            ) : null;
          })}
        </div>
      )}
      {hasSchedule && !todayRow && (
        <div className="alert alert-info">No workout scheduled for today.</div>
      )}

      {hasSchedule && <div className="divider" />}

      {/* This Week */}
      {hasSchedule && (
        <>
          <h2>This Week</h2>
          {weekSchedule.length === 0 ? (
            <div className="alert alert-info">No workouts scheduled this week.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
              {DAY_NAMES.map((name, i) => {
                const day = addDays(weekStart, i);
                const row = weekSchedule.find((r) => r.date === day);
                const isToday = day === today;
                return (
                  <div key={i} style={{ textAlign: "center", padding: "6px 2px" }}>
                    <div style={{ fontSize: "0.8em", color: "#888", fontWeight: isToday ? "bold" : "normal" }}>
                      {name} {fmtMD(day)}
                    </div>
                    {row ? (
                      <>
                        <div style={{
                          color: TYPE_COLORS[row._type], fontSize: "0.85em",
                          fontWeight: isToday ? "bold" : "normal",
                          textDecoration: row.completed ? "line-through" : "none",
                        }}>
                          {row.workout.split("\n")[0]}
                        </div>
                        {row.completed && <div style={{ fontSize: "0.75em", color: "#888" }}>Done</div>}
                      </>
                    ) : (
                      <div style={{ fontSize: "0.85em", color: "#888" }}>--</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Snapshot Metrics */}
      {hasLogs && runLogs.length >= 2 && (
        <>
          <div className="divider" />
          <h2>Snapshot</h2>
          <div className="metrics-row">
            <div className="metric">
              <div className="metric-label">This Week</div>
              <div className="metric-value">{thisWkMi.toFixed(1)} mi</div>
              <div style={{ fontSize: "0.8em", color: "#888" }}>
                {(thisWkMi - lastWkMi) >= 0 ? "+" : ""}{(thisWkMi - lastWkMi).toFixed(1)} vs last
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">ACWR</div>
              <div className="metric-value">{acwr.toFixed(2)}</div>
              <div style={{ fontSize: "0.8em", color: "#888" }}>{acwrStatus}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Avg Pace (Last 5)</div>
              <div className="metric-value">{last5Pace > 0 ? fmtPace(last5Pace) : "--"}</div>
              <div style={{ fontSize: "0.8em", color: "#888" }}>
                {overallPace > 0 && last5Pace > 0
                  ? `${(overallPace - last5Pace) >= 0 ? "+" : ""}${Math.round(overallPace - last5Pace)}s vs overall`
                  : ""}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Easy Runs</div>
              <div className="metric-value">{easyPct.toFixed(0)}%</div>
              <div style={{ fontSize: "0.8em", color: "#888" }}>
                {easyPct < 70 ? "aim ~80%" : "good balance"}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="divider" />

      {/* Tabs: Schedule / Progress / Analytics */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {["schedule", "progress", "analytics", "log"].map((t) => (
          <button key={t} className={`btn${tab === t ? " btn-primary" : ""}`}
            onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>
            {t === "log" ? "Run Log" : t}
          </button>
        ))}
      </div>

      {/* ===== SCHEDULE TAB ===== */}
      {tab === "schedule" && hasSchedule && (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px", fontSize: "0.9em" }}>
            <input type="checkbox" checked={showRest} onChange={(e) => setShowRest(e.target.checked)} />
            Show rest days
          </label>

          <table style={{ width: "100%" }}>
            <thead>
              <tr><th style={{ width: "120px" }}>Date</th><th>Workout</th><th style={{ width: "100px" }}>Action</th></tr>
            </thead>
            <tbody>
              {upcomingSchedule.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: row.date === today ? "bold" : "normal" }}>
                    {fmtShortDate(row.date)}
                  </td>
                  <td>
                    {editingId === row.id ? (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input type="text" value={editWorkout}
                          onChange={(e) => setEditWorkout(e.target.value)}
                          style={{ flex: 1 }} />
                        <button className="btn btn-primary" onClick={() => saveEdit(row.id)}>Save</button>
                        <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div onClick={() => { setEditingId(row.id); setEditWorkout(row.workout); }}
                        style={{ cursor: "pointer" }}>
                        <span style={{ color: TYPE_COLORS[row._type], fontWeight: "bold", fontSize: "0.8em", marginRight: "6px" }}>
                          {TYPE_LABELS[row._type].toUpperCase()}
                        </span>
                        <span style={{ textDecoration: row.completed ? "line-through" : "none" }}>
                          {row.workout.split("\n")[0]}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {!row.completed && row._type !== "rest" ? (
                      <button className="btn" onClick={() => markComplete(row.id)}
                        style={{ fontSize: "0.85em" }}>Done</button>
                    ) : row.completed ? (
                      <span style={{ fontSize: "0.85em", color: "#888" }}>Done</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pastSchedule.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <button className="btn" onClick={() => setShowPast(!showPast)}>
                {showPast ? "Hide" : "Show"} Past Workouts ({pastSchedule.length})
              </button>
              {showPast && (
                <table style={{ width: "100%", marginTop: "8px" }}>
                  <tbody>
                    {pastSchedule.map((row) => (
                      <tr key={row.id}>
                        <td style={{ width: "120px" }}>{fmtShortDate(row.date)}</td>
                        <td>
                          <span style={{ color: TYPE_COLORS[row._type], fontWeight: "bold", fontSize: "0.8em", marginRight: "6px" }}>
                            {TYPE_LABELS[row._type].toUpperCase()}
                          </span>
                          <span style={{ textDecoration: row.completed ? "line-through" : "none" }}>
                            {row.workout.split("\n")[0]}
                          </span>
                        </td>
                        <td style={{ width: "100px" }}>
                          {row.completed
                            ? <span style={{ fontSize: "0.85em", color: "#888" }}>Done</span>
                            : <button className="btn" onClick={() => markComplete(row.id)} style={{ fontSize: "0.85em" }}>Done</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="divider" />
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn" onClick={() => setShowAddSchedule(!showAddSchedule)}>
              {showAddSchedule ? "Cancel" : "Add Schedule"}
            </button>
          </div>

          {showAddSchedule && (
            <div className="card" style={{ marginTop: "12px" }}>
              <p style={{ fontSize: "0.9em", marginBottom: "8px" }}>
                Paste tab-separated rows: <code>Date</code> and <code>Workout</code>
              </p>
              <pre style={{ fontSize: "0.8em", color: "#888", margin: "0 0 8px" }}>
                2026-08-17{"\t"}Easy Run - 30 min{"\n"}2026-08-18{"\t"}Rest Day
              </pre>
              <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste rows here..." style={{ width: "100%", marginBottom: "8px" }} />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.9em", marginBottom: "8px" }}>
                <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                Replace existing schedule
              </label>
              <button className="btn btn-primary" onClick={uploadSchedule}>Upload</button>
            </div>
          )}
        </div>
      )}

      {/* ===== PROGRESS TAB ===== */}
      {tab === "progress" && hasSchedule && (
        <div>
          <div className="metrics-row">
            <div className="metric">
              <div className="metric-label">Total Workouts</div>
              <div className="metric-value">{totalWorkouts}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Completed</div>
              <div className="metric-value">{completedWorkouts}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Remaining</div>
              <div className="metric-value">{totalWorkouts - completedWorkouts}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Progress</div>
              <div className="metric-value">{progressPct}%</div>
            </div>
          </div>
          <div style={{
            background: "#333", borderRadius: "4px", height: "8px", marginTop: "12px",
          }}>
            <div style={{
              background: "#4CAF50", height: "100%", borderRadius: "4px",
              width: `${progressPct}%`, transition: "width 0.3s",
            }} />
          </div>

          <h3 style={{ marginTop: "24px" }}>By Workout Type</h3>
          <table style={{ width: "100%" }}>
            <thead>
              <tr><th>Type</th><th>Total</th><th>Done</th><th>Remaining</th></tr>
            </thead>
            <tbody>
              {Object.keys(TYPE_LABELS).filter((t) => t !== "rest").map((type) => {
                const ofType = schedule.filter((r) => r._type === type);
                const done = ofType.filter((r) => r.completed).length;
                return (
                  <tr key={type}>
                    <td style={{ color: TYPE_COLORS[type] }}>{TYPE_LABELS[type]}</td>
                    <td>{ofType.length}</td>
                    <td>{done}</td>
                    <td>{ofType.length - done}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== ANALYTICS TAB ===== */}
      {tab === "analytics" && (
        <div>
          {!hasLogs || runLogs.length < 2 ? (
            <div className="alert alert-info">Need at least 2 logged runs for analytics.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                {["mileage", "pace", "load"].map((t) => (
                  <button key={t} className={`btn${analyticsTab === t ? " btn-primary" : ""}`}
                    onClick={() => setAnalyticsTab(t)} style={{ textTransform: "capitalize" }}>
                    {t === "load" ? "Training Load" : t}
                  </button>
                ))}
              </div>

              {/* Mileage bar chart */}
              {analyticsTab === "mileage" && <BarChart data={weeklyMileage()} label="Weekly Miles" />}

              {/* Pace trend */}
              {analyticsTab === "pace" && (
                <div>
                  {paceTrend().length < 2 ? (
                    <div className="alert alert-info">Need at least 2 runs with pace data.</div>
                  ) : (
                    <>
                      <PaceChart data={paceTrend()} />
                      {(() => {
                        const wp = sortedLogs.filter((r) => r.pace_seconds > 0);
                        if (wp.length < 10) return null;
                        const first5 = wp.slice(0, 5).reduce((s, r) => s + r.pace_seconds, 0) / 5;
                        const last5 = wp.slice(-5).reduce((s, r) => s + r.pace_seconds, 0) / 5;
                        const diff = first5 - last5;
                        return (
                          <p style={{ fontSize: "0.85em", color: "#888", marginTop: "8px" }}>
                            {diff > 0 ? `Pace improved by ${Math.round(diff)}s/mi` : diff < 0 ? `Pace slowed by ${Math.round(Math.abs(diff))}s/mi` : "Pace unchanged"} (first 5 vs last 5 runs)
                          </p>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {/* Training Load ACWR */}
              {analyticsTab === "load" && (
                <div>
                  <ACWRChart data={acwrTrend()} />
                  <div className={`alert ${acwr > 1.5 ? "alert-warning" : acwr < 0.8 ? "alert-warning" : "alert-success"}`}
                    style={{ marginTop: "12px" }}>
                    ACWR: {acwr.toFixed(2)} {"—"} {acwr > 1.5 ? "injury risk zone" : acwr < 0.8 ? "detraining zone" : "sweet spot (0.8–1.3 is optimal)"}
                  </div>
                  <p style={{ fontSize: "0.85em", color: "#888" }}>
                    Acute:Chronic Workload Ratio {"—"} 7-day mileage ÷ 28-day weekly avg
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== RUN LOG TAB ===== */}
      {tab === "log" && (
        <div>
          {hasLogs && (
            <>
              <div className="metrics-row">
                <div className="metric">
                  <div className="metric-label">This Week</div>
                  <div className="metric-value">{rlWeekMi.toFixed(1)} mi</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Total Logged</div>
                  <div className="metric-value">{rlTotalMi.toFixed(1)} mi</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Best Pace</div>
                  <div className="metric-value">{fmtPace(rlBestPace)}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Runs Logged</div>
                  <div className="metric-value">{runLogs.length}</div>
                </div>
              </div>

              {sortedRunLogs.slice(0, showAllRuns ? undefined : 5).map((run) => (
                <div key={run.id} style={{ padding: "6px 0", borderBottom: "1px solid #333" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      <strong>{fmtShortDate(run.date)}</strong>
                      {" · "}{(+run.distance_miles).toFixed(2)} mi
                      {" · "}{fmtDuration(run.duration_seconds)}
                      {" · "}{fmtPace(run.pace_seconds)}
                      {run.elevation_gain_ft > 0 && ` · ↑${Math.round(run.elevation_gain_ft)} ft`}
                      {run.route_name && ` · ${run.route_name}`}
                    </span>
                    <button className="btn" onClick={() => deleteRunLog(run.id)}
                      style={{ fontSize: "0.75em", padding: "2px 8px" }}>×</button>
                  </div>
                  {run.notes && <p style={{ fontSize: "0.85em", color: "#888", margin: "2px 0 0" }}>{run.notes}</p>}
                </div>
              ))}

              {sortedRunLogs.length > 5 && (
                <button className="btn" style={{ marginTop: "8px" }}
                  onClick={() => setShowAllRuns(!showAllRuns)}>
                  {showAllRuns ? "Show Less" : `All Runs (${sortedRunLogs.length})`}
                </button>
              )}
            </>
          )}

          <div style={{ marginTop: "16px" }}>
            <button className="btn btn-primary" onClick={() => setShowLogForm(!showLogForm)}>
              {showLogForm ? "Cancel" : "Log a Run"}
            </button>
          </div>

          {showLogForm && (
            <form onSubmit={logRun} className="card" style={{ marginTop: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="metric-label">Date</label>
                  <input type="date" value={mrDate} onChange={(e) => setMrDate(e.target.value)} />
                </div>
                <div>
                  <label className="metric-label">Distance (miles)</label>
                  <input type="number" step="0.1" min="0" value={mrDist}
                    onChange={(e) => setMrDist(e.target.value)} placeholder="0.0" />
                </div>
                <div>
                  <label className="metric-label">Minutes</label>
                  <input type="number" min="0" value={mrMins}
                    onChange={(e) => setMrMins(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="metric-label">Seconds</label>
                  <input type="number" min="0" max="59" value={mrSecs}
                    onChange={(e) => setMrSecs(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div style={{ marginTop: "8px" }}>
                <label className="metric-label">Notes</label>
                <input type="text" value={mrNotes} onChange={(e) => setMrNotes(e.target.value)}
                  placeholder="How did it feel?" style={{ width: "100%" }} />
              </div>
              {mrDist && parseFloat(mrDist) > 0 && (parseInt(mrMins) || parseInt(mrSecs)) ? (
                <p style={{ fontSize: "0.85em", color: "#888", marginTop: "4px" }}>
                  Pace: {fmtPace(((parseInt(mrMins) || 0) * 60 + (parseInt(mrSecs) || 0)) / parseFloat(mrDist))}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary" style={{ marginTop: "12px" }}>Log Run</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CSS Bar Chart components (no charting library)
// ============================================================

function BarChart({ data, label }) {
  if (!data.length) return <div className="alert alert-info">No data yet.</div>;
  const max = Math.max(...data.map((d) => d.miles), 1);
  return (
    <div>
      <h3>{label}</h3>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "200px", marginTop: "12px" }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
              <div
                style={{
                  width: "100%", background: "#4CAF50", borderRadius: "3px 3px 0 0",
                  height: `${(d.miles / max) * 100}%`, minHeight: d.miles > 0 ? "4px" : "0",
                  transition: "height 0.3s",
                }}
                title={`${d.week}: ${d.miles} mi`}
              />
            </div>
            <div style={{ fontSize: "0.65em", color: "#888", marginTop: "4px", textAlign: "center" }}>
              {d.week.slice(5)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75em", color: "#888", marginTop: "4px" }}>
        <span>{data[0]?.week.slice(5)}</span>
        <span>{data[data.length - 1]?.week.slice(5)}</span>
      </div>
    </div>
  );
}

function PaceChart({ data }) {
  if (!data.length) return null;
  const allVals = data.flatMap((d) => [d.pace, d.avg7]);
  const minP = Math.min(...allVals) - 10;
  const maxP = Math.max(...allVals) + 10;
  const range = maxP - minP || 1;
  return (
    <div>
      <h3>Pace Trend</h3>
      <div style={{ position: "relative", height: "200px", marginTop: "12px" }}>
        {/* dots for individual paces */}
        {data.map((d, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${(i / (data.length - 1)) * 100}%`,
            bottom: `${((maxP - d.pace) / range) * 100}%`,
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#2196F3", transform: "translate(-3px, 3px)",
          }} title={`${d.date}: ${fmtPace(d.pace)}`} />
        ))}
        {/* 7-run avg line approximation with dots */}
        {data.map((d, i) => (
          <div key={`a${i}`} style={{
            position: "absolute",
            left: `${(i / (data.length - 1)) * 100}%`,
            bottom: `${((maxP - d.avg7) / range) * 100}%`,
            width: "4px", height: "4px", borderRadius: "50%",
            background: "#FF9800", transform: "translate(-2px, 2px)",
          }} title={`7-run avg: ${fmtPace(d.avg7)}`} />
        ))}
        {/* Y-axis labels */}
        <div style={{ position: "absolute", left: "-40px", top: 0, fontSize: "0.7em", color: "#888" }}>
          {fmtPace(minP)}
        </div>
        <div style={{ position: "absolute", left: "-40px", bottom: 0, fontSize: "0.7em", color: "#888" }}>
          {fmtPace(maxP)}
        </div>
      </div>
      <div style={{ display: "flex", gap: "16px", fontSize: "0.8em", color: "#888", marginTop: "8px" }}>
        <span><span style={{ color: "#2196F3" }}>{"●"}</span> Pace</span>
        <span><span style={{ color: "#FF9800" }}>{"●"}</span> 7-Run Avg</span>
      </div>
    </div>
  );
}

function ACWRChart({ data }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.acwr), 2);
  return (
    <div>
      <h3>ACWR Over Time</h3>
      <div style={{ position: "relative", height: "200px", marginTop: "12px" }}>
        {/* sweet spot zone */}
        <div style={{
          position: "absolute", left: 0, right: 0,
          bottom: `${(0.8 / max) * 100}%`,
          height: `${((1.3 - 0.8) / max) * 100}%`,
          background: "rgba(76, 175, 80, 0.1)", borderTop: "1px dashed #4CAF50",
          borderBottom: "1px dashed #4CAF50",
        }} />
        {/* danger line at 1.5 */}
        <div style={{
          position: "absolute", left: 0, right: 0,
          bottom: `${(1.5 / max) * 100}%`,
          borderTop: "1px dashed #F44336",
        }} />
        {/* data dots */}
        {data.map((d, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${(i / Math.max(data.length - 1, 1)) * 100}%`,
            bottom: `${(d.acwr / max) * 100}%`,
            width: "6px", height: "6px", borderRadius: "50%",
            background: d.acwr > 1.5 ? "#F44336" : d.acwr < 0.8 ? "#FF9800" : "#4CAF50",
            transform: "translate(-3px, 3px)",
          }} title={`${d.date}: ${d.acwr}`} />
        ))}
      </div>
    </div>
  );
}

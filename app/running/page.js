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

function fmtPaceMin(p) {
  if (!p || !isFinite(p)) return "--";
  const ts = Math.round(p * 60);
  return `${Math.floor(ts / 60)}:${String(ts % 60).padStart(2, "0")}/mi`;
}

function toDate(d) {
  if (!d) return null;
  const s = typeof d === "string" ? d.slice(0, 10) : d;
  return s;
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

// --- GPX / Strava helpers ---

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const trkpts = doc.querySelectorAll("trkpt");
  if (!trkpts.length) throw new Error("No trackpoints found in GPX file");

  const points = Array.from(trkpts).map((pt) => ({
    lat: parseFloat(pt.getAttribute("lat")),
    lon: parseFloat(pt.getAttribute("lon")),
    ele: pt.querySelector("ele") ? parseFloat(pt.querySelector("ele").textContent) : null,
    time: pt.querySelector("time") ? new Date(pt.querySelector("time").textContent) : null,
  }));

  let totalDist = 0;
  let elevGain = 0;
  let movingTime = 0;
  const splits = [];
  let splitStart = 0;
  let splitDist = 0;
  let splitMoving = 0;

  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    totalDist += d;
    splitDist += d;

    // elevation gain
    if (points[i].ele != null && points[i - 1].ele != null) {
      const diff = points[i].ele - points[i - 1].ele;
      if (diff > 0) elevGain += diff;
    }

    // moving time: skip gaps > 60s and speed < 2 mph
    if (points[i].time && points[i - 1].time) {
      const dt = (points[i].time - points[i - 1].time) / 1000;
      if (dt > 0 && dt <= 60) {
        const speed = d / (dt / 3600); // mph
        if (speed >= 2) {
          movingTime += dt;
          splitMoving += dt;
        }
      }
    }

    // per-mile splits
    if (splitDist >= 1.0) {
      splits.push({ mile: splits.length + 1, pace_seconds: splitMoving > 0 ? Math.round(splitMoving / splitDist) : 0 });
      splitDist = 0;
      splitMoving = 0;
    }
  }
  // partial last split
  if (splitDist > 0.1) {
    splits.push({ mile: splits.length + 1, pace_seconds: splitMoving > 0 ? Math.round(splitMoving / splitDist) : 0 });
  }

  const firstTime = points.find((p) => p.time)?.time;
  const lastTime = [...points].reverse().find((p) => p.time)?.time;
  const elapsed = firstTime && lastTime ? (lastTime - firstTime) / 1000 : 0;
  // elevation from meters to feet
  const elevGainFt = Math.round(elevGain * 3.28084);
  const pace = totalDist > 0 && movingTime > 0 ? Math.round(movingTime / totalDist) : 0;
  const date = firstTime
    ? `${firstTime.getFullYear()}-${String(firstTime.getMonth() + 1).padStart(2, "0")}-${String(firstTime.getDate()).padStart(2, "0")}`
    : isoToday();

  return {
    date,
    distance_miles: +totalDist.toFixed(2),
    duration_seconds: Math.round(elapsed),
    moving_time_seconds: Math.round(movingTime),
    pace_seconds: pace,
    elevation_gain_ft: elevGainFt,
    splits,
  };
}

function parseStravaCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iDate = idx("Activity Date");
  const iType = idx("Activity Type");
  const iElapsed = idx("Elapsed Time");
  const iDist = idx("Distance");
  const iMoving = idx("Moving Time");
  const iElev = idx("Elevation Gain");
  if (iDate < 0 || iDist < 0) throw new Error("CSV missing required columns (Activity Date, Distance)");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // handle quoted CSV fields
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur.trim());

    const type = iType >= 0 ? vals[iType] : "Run";
    if (type !== "Run") continue;

    const rawDate = vals[iDate];
    // Strava dates: "Oct 1, 2026, 7:30:00 AM" or "2026-10-01 ..."
    let date;
    try { date = new Date(rawDate).toISOString().slice(0, 10); }
    catch { continue; }

    const distKm = parseFloat(vals[iDist]) || 0;
    const distMi = +(distKm / 1.60934).toFixed(2);
    const elapsed = parseInt(vals[iElapsed]) || 0;
    const moving = iMoving >= 0 ? (parseInt(vals[iMoving]) || elapsed) : elapsed;
    const elev = iElev >= 0 ? parseFloat(vals[iElev]) || 0 : 0;
    const elevFt = Math.round(elev * 3.28084);
    const pace = distMi > 0 && moving > 0 ? Math.round(moving / distMi) : 0;

    rows.push({ date, distance_miles: distMi, duration_seconds: elapsed, moving_time_seconds: moving, pace_seconds: pace, elevation_gain_ft: elevFt });
  }
  return rows;
}

// --- TCX parser (uses Garmin laps + speed data) ---

function parseTcx(text) {
  const lapBlocks = text.split("<Lap ").slice(1);
  if (!lapBlocks.length) throw new Error("No laps found in TCX file");
  let totalDist = 0, totalTime = 0, elevGain = 0;
  const splits = [];
  for (const blk of lapBlocks) {
    const dur = parseFloat(blk.match(/<TotalTimeSeconds>([\d.]+)/)?.[1] || 0);
    const dist = parseFloat(blk.match(/<DistanceMeters>([\d.]+)/)?.[1] || 0);
    totalTime += dur;
    totalDist += dist;
  }
  // per-mile splits from trackpoints' cumulative distance
  const trkBlocks = text.split("<Trackpoint>").slice(1);
  let prevDist = 0, prevTime = null, splitStart = 0, splitDist = 0, splitTime = 0, prevEle = null;
  for (const blk of trkBlocks) {
    const cumDist = parseFloat(blk.match(/<DistanceMeters>([\d.]+)/)?.[1] || 0);
    const timeM = blk.match(/<Time>([^<]+)/)?.[1];
    const eleM = blk.match(/<AltitudeMeters>([\d.]+)/)?.[1];
    const t = timeM ? new Date(timeM) : null;
    const segDist = (cumDist - prevDist) / 1609.34;
    if (eleM && prevEle != null) { const d = parseFloat(eleM) - prevEle; if (d > 0) elevGain += d; }
    if (eleM) prevEle = parseFloat(eleM);
    if (t && prevTime) splitTime += (t - prevTime) / 1000;
    splitDist += segDist;
    if (splitDist >= 1.0) {
      splits.push({ mile: splits.length + 1, pace_seconds: splitTime > 0 ? Math.round(splitTime / splitDist) : 0 });
      splitDist = 0; splitTime = 0;
    }
    prevDist = cumDist; prevTime = t;
  }
  if (splitDist > 0.1) splits.push({ mile: splits.length + 1, pace_seconds: splitTime > 0 ? Math.round(splitTime / splitDist) : 0 });

  const firstTime = text.match(/<Time>([^<]+)/)?.[1];
  const ft = firstTime ? new Date(firstTime) : null;
  const date = ft ? `${ft.getFullYear()}-${String(ft.getMonth() + 1).padStart(2, "0")}-${String(ft.getDate()).padStart(2, "0")}` : isoToday();
  const distMi = totalDist / 1609.34;
  return {
    date, distance_miles: +distMi.toFixed(2), duration_seconds: Math.round(totalTime),
    moving_time_seconds: Math.round(totalTime), pace_seconds: distMi > 0 ? Math.round(totalTime / distMi) : 0,
    elevation_gain_ft: Math.round(elevGain * 3.28084), splits,
  };
}

function analyzeTcx(text) {
  const lapBlocks = text.split("<Lap ").slice(1);
  const laps = lapBlocks.map((blk) => {
    const dur = parseFloat(blk.match(/<TotalTimeSeconds>([\d.]+)/)?.[1] || 0);
    const dist = parseFloat(blk.match(/<DistanceMeters>([\d.]+)/)?.[1] || 0);
    const avgHR = parseInt(blk.match(/<AverageHeartRateBpm>\s*<Value>(\d+)/)?.[1] || 0);
    return { dur, dist, avgHR, pace: dur > 0 && dist > 0 ? (dur / 60) / (dist / 1609.34) : 99 };
  });
  if (!laps.length) return null;

  // build paceData from trackpoint Garmin speed (moving time, pauses filtered)
  const trkBlocks = text.split("<Trackpoint>").slice(1);
  const pd = [];
  let cumTime = 0, prevTrkTime = null;
  for (const blk of trkBlocks) {
    const timeM = blk.match(/<Time>([^<]+)/)?.[1];
    const spdM = blk.match(/<ns3:Speed>([\d.]+)/)?.[1];
    const hrM = blk.match(/<Value>(\d+)/)?.[1];
    const t = timeM ? new Date(timeM) : null;
    if (t && prevTrkTime) {
      const dt = (t - prevTrkTime) / 1000;
      const spd = spdM ? parseFloat(spdM) : 0;
      const pause = (dt > 10 && spd < 0.5) || dt > 60;
      cumTime += pause ? 0 : dt;
    }
    prevTrkTime = t;
    if (spdM) {
      const spd = parseFloat(spdM);
      if (spd > 0.5) pd.push({ t: cumTime, pace: (1 / spd) * (1609.34 / 60), hr: hrM ? parseInt(hrM) : null });
    }
  }

  // classify laps: rest (>12 min/mi), hard, easy
  const restThresh = 12;
  const activeLaps = laps.filter((l) => l.pace < restThresh);
  if (!activeLaps.length) return { type: "easy", summary: "Easy run", reps: [], paceData: pd, laps };

  const paces = activeLaps.map((l) => l.pace);
  const avgPace = paces.reduce((a, b) => a + b) / paces.length;
  const paceRange = Math.max(...paces) - Math.min(...paces);

  // find hard laps: flanked by rest laps or significantly faster than average
  const hardThresh = avgPace - paceRange * 0.3;
  const lapTypes = laps.map((l) => l.pace >= restThresh ? "rest" : l.pace < hardThresh ? "hard" : "easy");

  const hardIdxs = lapTypes.map((t, i) => t === "hard" ? i : -1).filter((i) => i >= 0);
  if (!hardIdxs.length) return { type: "easy", summary: "Easy run", reps: [], paceData: pd, laps };

  const reps = hardIdxs.map((i) => ({
    duration: laps[i].dur, pace: laps[i].pace, hr: laps[i].avgHR, dist: laps[i].dist / 1609.34,
  }));

  // warmup = everything before first hard lap
  const wuLaps = laps.slice(0, hardIdxs[0]);
  const wuS = wuLaps.reduce((a, l) => a + l.dur, 0);
  // cooldown = skip rest laps after last hard rep, then count the rest
  let cdStart = hardIdxs[hardIdxs.length - 1] + 1;
  while (cdStart < laps.length && laps[cdStart].pace >= restThresh) cdStart++;
  const cdS = laps.slice(cdStart).reduce((a, l) => a + l.dur, 0);
  // recoveries between all hard laps (including rest after last rep)
  const recoveries = [];
  for (let i = 0; i < hardIdxs.length - 1; i++) {
    const between = laps.slice(hardIdxs[i] + 1, hardIdxs[i + 1]);
    recoveries.push(between.reduce((a, l) => a + l.dur, 0));
  }
  const lastRestLaps = laps.slice(hardIdxs[hardIdxs.length - 1] + 1, cdStart);
  if (lastRestLaps.length) recoveries.push(lastRestLaps.reduce((a, l) => a + l.dur, 0));

  // tempo: single hard lap > 600s
  if (reps.length === 1 && reps[0].duration > 600) {
    return { type: "tempo", summary: `Tempo: ${(reps[0].duration / 60).toFixed(1)} min @ ${fmtPaceMin(reps[0].pace)}`, reps, paceData: pd, laps, fastPace: reps[0].pace, easyPace: avgPace, threshold: hardThresh };
  }

  const avgRepPace = reps.reduce((a, r) => a + r.pace, 0) / reps.length;
  const avgRec = recoveries.length ? recoveries.reduce((a, b) => a + b) / recoveries.length : 0;
  const avgRepDur = reps.reduce((a, r) => a + r.duration, 0) / reps.length;
  const allSame = reps.length > 1 && reps.every((r) => Math.abs(r.duration - reps[0].duration) < 15);

  let summary = "";
  if (wuS > 60) summary += `${(wuS / 60).toFixed(0)} min WU → `;
  if (allSame) {
    summary += `${reps.length} x ${(avgRepDur / 60).toFixed(1)} min @ ${fmtPaceMin(avgRepPace)}`;
  } else {
    summary += reps.map((r) => `${(r.duration / 60).toFixed(1)}min @ ${fmtPaceMin(r.pace)}`).join(" → ");
  }
  if (avgRec > 0) summary += ` / ${(avgRec / 60).toFixed(1)} min rest`;
  if (cdS > 60) summary += ` → ${(cdS / 60).toFixed(0)} min CD`;

  return { type: "intervals", warmup_s: wuS, cooldown_s: cdS, workout_s: reps.reduce((a, r) => a + r.duration, 0), reps, recoveries, paceData: pd, laps, fastPace: Math.min(...reps.map((r) => r.pace)), easyPace: avgPace, threshold: hardThresh, summary };
}

// --- Workout analyzer (ports scratchpad/analyze-gpx.mjs to client-side) ---

function analyzeWorkout(gpxText) {
  const blocks = gpxText.split("<trkpt ").slice(1);
  const pts = [];
  for (const blk of blocks) {
    const latM = blk.match(/lat="([^"]+)"/);
    const lonM = blk.match(/lon="([^"]+)"/);
    const timeM = blk.match(/<time>([^<]+)/);
    if (!latM || !lonM || !timeM) continue;
    const hrM = blk.match(/<(?:gpxtpx:)?hr>(\d+)/);
    const cadM = blk.match(/<(?:gpxtpx:)?cad>(\d+)/);
    pts.push({
      lat: parseFloat(latM[1]), lon: parseFloat(lonM[1]),
      time: new Date(timeM[1]),
      hr: hrM ? parseInt(hrM[1]) : null,
      cad: cadM ? parseInt(cadM[1]) : null,
    });
  }
  if (pts.length < 20) return null;

  const hav = (a, b) => {
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  };

  const mt = [0];
  const pauseAt = new Set();
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].time - pts[i - 1].time;
    const d = hav(pts[i - 1], pts[i]);
    const spd = d / (dt / 1000);
    const pause = (dt > 10000 && spd < 1) || dt > 60000;
    mt.push(mt[i - 1] + (pause ? 0 : dt / 1000));
    if (pause) pauseAt.add(i);
  }

  const pd = [];
  for (let i = 1; i < pts.length; i++) {
    let j = i;
    while (j > 0 && mt[i] - mt[j] < 15 && !pauseAt.has(j)) j--;
    if (pauseAt.has(j)) j++;
    if (j >= i) continue;
    const dt = mt[i] - mt[j];
    if (dt < 5) continue;
    let dist = 0;
    for (let k = j; k < i; k++) dist += hav(pts[k], pts[k + 1]);
    if (dist < 1) continue;
    pd.push({ t: mt[i], pace: (dt / 60) / (dist / 1609.34), hr: pts[i].hr });
  }
  if (pd.length < 20) return null;

  const rp = pd.map((p) => p.pace).filter((p) => p > 4 && p < 12);
  if (rp.length < 20) return null;
  let c1 = Math.min(...rp), c2 = Math.max(...rp);
  for (let it = 0; it < 20; it++) {
    const g1 = rp.filter((p) => Math.abs(p - c1) <= Math.abs(p - c2));
    const g2 = rp.filter((p) => Math.abs(p - c1) > Math.abs(p - c2));
    if (!g1.length || !g2.length) break;
    c1 = g1.reduce((a, b) => a + b) / g1.length;
    c2 = g2.reduce((a, b) => a + b) / g2.length;
  }
  const thr = c1 + (c2 - c1) * 0.3;

  // if clusters are within 0.4 min/mi, it's a steady run — no real fast/easy split
  if (c2 - c1 < 0.4) return { type: "easy", summary: "Easy run", reps: [], segments: [], paceData: pd, pts, mt, fastPace: c1, easyPace: c2, threshold: thr };

  let segs = [];
  let cz = null, segS = 0;
  for (const p of pd) {
    const z = p.pace < thr ? "fast" : p.pace < 12 ? "easy" : "slow";
    if (z !== cz) {
      if (cz) segs.push({ z: cz, s: segS, e: p.t });
      cz = z; segS = p.t;
    }
  }
  if (cz) segs.push({ z: cz, s: segS, e: pd[pd.length - 1].t });

  let merged = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].e - segs[i].s < 30) merged[merged.length - 1].e = segs[i].e;
    else merged.push({ ...segs[i] });
  }

  let m2 = [merged[0]];
  for (let i = 1; i < merged.length; i++) {
    const prev = m2[m2.length - 1], cur = merged[i];
    if (prev.z === "fast" && cur.z === "fast" && cur.s - prev.e < 40) prev.e = cur.e;
    else if (prev.z === "fast" && cur.z !== "fast" && cur.e - cur.s < 40 && i + 1 < merged.length && merged[i + 1].z === "fast") { prev.e = merged[i + 1].e; i++; }
    else m2.push({ ...cur });
  }

  for (const s of m2) {
    if (s.z !== "fast") continue;
    if (s.e - s.s < 60) { s.z = "easy"; continue; }
    const sp = pd.filter((p) => p.t >= s.s && p.t <= s.e);
    const ap = sp.reduce((a, p) => a + p.pace, 0) / sp.length;
    const hp = sp.filter((p) => p.hr);
    const ah = hp.length ? hp.reduce((a, p) => a + p.hr, 0) / hp.length : 0;
    if (ap > thr) { s.z = "easy"; continue; }
    if (ah && ah < 155) s.z = "easy";
  }

  let fin = [m2[0]];
  for (let i = 1; i < m2.length; i++) {
    if (m2[i].z === fin[fin.length - 1].z) fin[fin.length - 1].e = m2[i].e;
    else fin.push({ ...m2[i] });
  }

  const fast = fin.filter((s) => s.z === "fast");
  const tt = pd[pd.length - 1].t;

  if (!fast.length) return { type: "easy", summary: "Easy run", reps: [], segments: fin, paceData: pd, pts, mt, fastPace: c1, easyPace: c2, threshold: thr };

  if (fast.length === 1 && fast[0].e - fast[0].s > 600) {
    const sp = pd.filter((p) => p.t >= fast[0].s && p.t <= fast[0].e);
    const ap = sp.reduce((a, p) => a + p.pace, 0) / sp.length;
    return { type: "tempo", summary: `Tempo: ${((fast[0].e - fast[0].s) / 60).toFixed(1)} min @ ${fmtPaceMin(ap)}`, reps: [{ duration: fast[0].e - fast[0].s, pace: ap, hr: 0 }], segments: fin, paceData: pd, pts, mt, fastPace: c1, easyPace: c2, threshold: thr };
  }

  const wu = fast[0].s, cd = tt - fast[fast.length - 1].e;
  const wkDur = fast[fast.length - 1].e - fast[0].s;
  const reps = fast.map((s) => {
    const sp = pd.filter((p) => p.t >= s.s && p.t <= s.e);
    const ap = sp.reduce((a, p) => a + p.pace, 0) / sp.length;
    const hp = sp.filter((p) => p.hr);
    const ah = hp.length ? hp.reduce((a, p) => a + p.hr, 0) / hp.length : 0;
    return { duration: s.e - s.s, pace: ap, hr: ah };
  });
  const recs = [];
  for (let i = 0; i < fast.length - 1; i++) recs.push(fast[i + 1].s - fast[i].e);

  // auto-snap: if reps are roughly uniform, snap to nearest 30s and recalculate
  if (reps.length >= 3) {
    const durs = reps.map((r) => r.duration);
    const mean = durs.reduce((a, b) => a + b) / durs.length;
    const cv = Math.sqrt(durs.reduce((a, d) => a + (d - mean) ** 2, 0) / durs.length) / mean;
    if (cv < 0.2) {
      const snapped = Math.round(mean / 30) * 30;
      for (let i = 0; i < reps.length; i++) {
        const start = fast[i].s;
        const sp = pd.filter((p) => p.t >= start && p.t <= start + snapped);
        if (sp.length) {
          reps[i].duration = snapped;
          reps[i].pace = sp.reduce((a, p) => a + p.pace, 0) / sp.length;
          const hp = sp.filter((p) => p.hr);
          reps[i].hr = hp.length ? hp.reduce((a, p) => a + p.hr, 0) / hp.length : 0;
        }
      }
    }
  }

  const avgDur = reps.reduce((a, r) => a + r.duration, 0) / reps.length;
  const avgPace = reps.reduce((a, r) => a + r.pace, 0) / reps.length;
  const avgRec = recs.length ? recs.reduce((a, b) => a + b) / recs.length : 0;

  let summary = "";
  if (wu > 120) summary += `${(wu / 60).toFixed(1)} min WU → `;
  summary += `${(wkDur / 60).toFixed(1)} min — ${reps.length} x ${(avgDur / 60).toFixed(1)} min @ ${fmtPaceMin(avgPace)}`;
  if (avgRec > 0) summary += ` / ${(avgRec / 60).toFixed(1)} min easy`;
  if (cd > 120) summary += ` → ${(cd / 60).toFixed(1)} min CD`;

  return { type: "intervals", warmup_s: wu, cooldown_s: cd, workout_s: wkDur, reps, recoveries: recs, segments: fin, paceData: pd, pts, mt, fastPace: c1, easyPace: c2, threshold: thr, summary };
}

function refitWorkout(analysis, { warmup, reps: repDefs, cooldown }) {
  if (!repDefs?.length) return null;
  const { paceData: pd, pts, mt, threshold } = analysis;
  // TCX fallback: use both lap data + paceData, prefer laps when they agree
  if ((!pts || !mt) && (analysis.laps?.length || analysis.paceData?.length)) {
    const { laps, paceData: pd } = analysis;
    const warmupS = (warmup || 0) * 60;
    const cooldownS = (cooldown || 0) * 60;
    const cumT = laps ? [0] : [];
    if (laps) for (let j = 0; j < laps.length; j++) cumT.push(cumT[j] + laps[j].dur);
    let t = warmupS;
    const reps = [], recoveries = [];
    for (let i = 0; i < repDefs.length; i++) {
      const hardS = repDefs[i].hard * 60;
      const easyS = (repDefs[i].easy || 0) * 60;
      let lapPace = null, lapHR = 0, pdPace = null, pdHR = 0;
      // lap-based: proportional overlap
      if (laps) {
        let dur = 0, dist = 0, hrS = 0, hrN = 0;
        for (let j = 0; j < laps.length; j++) {
          const ovS = Math.max(cumT[j], t), ovE = Math.min(cumT[j + 1], t + hardS);
          if (ovE > ovS) {
            const frac = (ovE - ovS) / laps[j].dur;
            dur += ovE - ovS; dist += laps[j].dist * frac;
            if (laps[j].avgHR) { hrS += laps[j].avgHR; hrN++; }
          }
        }
        if (dur > 0 && dist > 0) { lapPace = (dur / 60) / (dist / 1609.34); lapHR = hrN ? hrS / hrN : 0; }
      }
      // paceData-based: average speed sensor points in window
      if (pd?.length) {
        const repPts = pd.filter(p => p.t >= t && p.t < t + hardS);
        if (repPts.length >= 2) {
          pdPace = repPts.reduce((a, p) => a + p.pace, 0) / repPts.length;
          const hrPts = repPts.filter(p => p.hr);
          pdHR = hrPts.length ? hrPts.reduce((a, p) => a + p.hr, 0) / hrPts.length : 0;
        }
      }
      // pick: if both exist and agree (within 0.5 min/mi), prefer laps (better distance); otherwise paceData
      if (lapPace != null && pdPace != null) {
        const agree = Math.abs(lapPace - pdPace) < 0.5;
        reps.push({ duration: hardS, pace: agree ? lapPace : pdPace, hr: agree ? lapHR : pdHR });
      } else if (pdPace != null) {
        reps.push({ duration: hardS, pace: pdPace, hr: pdHR });
      } else if (lapPace != null) {
        reps.push({ duration: hardS, pace: lapPace, hr: lapHR });
      }
      t += hardS;
      if (i < repDefs.length - 1 && easyS > 0) { recoveries.push(easyS); t += easyS; }
    }
    if (!reps.length) return null;
    const avgPace = reps.reduce((a, r) => a + r.pace, 0) / reps.length;
    const allSame = reps.length > 1 && repDefs.every(r => r.hard === repDefs[0].hard);
    let summary = "";
    if (warmupS) summary += `${(warmupS / 60).toFixed(0)} min WU → `;
    if (allSame) {
      summary += `${reps.length} x ${repDefs[0].hard} min @ ${fmtPaceMin(avgPace)}`;
      const avgRec = recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : 0;
      if (avgRec > 0) summary += ` / ${(avgRec / 60).toFixed(1)} min rest`;
    } else {
      summary += reps.map((r, i) => `${repDefs[i].hard}min @ ${fmtPaceMin(r.pace)}`).join(" → ");
    }
    if (cooldownS) summary += ` → ${(cooldownS / 60).toFixed(0)} min CD`;
    return { type: "intervals", reps, recoveries, warmup_s: warmupS, cooldown_s: cooldownS, summary, corrected: true };
  }
  if (!pts || !mt) return null;
  const cooldownS = (cooldown || 0) * 60;

  const hav = (a, b) => {
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  };

  // compute reps starting from a given offset, seeking past slow sections
  function tryOffset(startT) {
    const thr = threshold || 9;
    const result = [];
    let t = startT;
    for (let i = 0; i < repDefs.length; i++) {
      const hardS = repDefs[i].hard * 60;
      const seekPts = pd.filter((p) => p.t >= t && p.t < t + 600);
      const fastPt = seekPts.find((p) => p.pace < thr);
      if (fastPt) t = Math.max(t, fastPt.t - 10);
      let iStart = -1, iEnd = -1;
      for (let k = 0; k < pts.length; k++) {
        if (mt[k] >= t && iStart < 0) iStart = k;
        if (mt[k] <= t + hardS) iEnd = k;
      }
      if (iStart >= 0 && iEnd > iStart) {
        let dist = 0, hrSum = 0, hrN = 0;
        for (let k = iStart; k < iEnd; k++) {
          if (mt[k + 1] > mt[k]) dist += hav(pts[k], pts[k + 1]);
          if (pts[k].hr) { hrSum += pts[k].hr; hrN++; }
        }
        const elapsed = mt[iEnd] - mt[iStart];
        if (dist > 0 && elapsed > 0) {
          result.push({ duration: hardS, pace: (elapsed / 60) / (dist / 1609.34), hr: hrN ? hrSum / hrN : 0 });
        }
      }
      t += hardS;
      if (i < repDefs.length - 1) {
        const nextFast = pd.find((p) => p.t > t + 30 && p.pace < thr);
        if (nextFast) t = nextFast.t - 10;
        else t += (repDefs[i].easy || 0) * 60;
      }
    }
    return result;
  }

  // try offsets around the user's warmup to find best alignment (fastest avg rep pace)
  const warmupS = (warmup || 0) * 60;
  let bestReps = null, bestPace = Infinity, bestWu = warmupS;
  const step = 15, range = 120;
  for (let off = Math.max(0, warmupS - range); off <= warmupS + range; off += step) {
    const r = tryOffset(off);
    if (r.length === repDefs.length) {
      const avg = r.reduce((a, x) => a + x.pace, 0) / r.length;
      if (avg < bestPace) { bestPace = avg; bestReps = r; bestWu = off; }
    }
  }
  const reps = bestReps || tryOffset(warmupS);
  if (!reps.length) return null;

  const workoutS = reps.reduce((a, r) => a + r.duration, 0) + repDefs.slice(0, -1).reduce((a, r) => a + (r.easy || 0) * 60, 0);
  const avgPace = reps.reduce((a, r) => a + r.pace, 0) / reps.length;
  const allSame = reps.length > 1 && reps.every((r) => r.duration === reps[0].duration);

  let summary = "";
  if (bestWu) summary += `${(bestWu / 60).toFixed(0)} min WU → `;
  if (allSame) {
    summary += `${reps.length} x ${repDefs[0].hard} min @ ${fmtPaceMin(avgPace)}`;
    if (repDefs[0].easy) summary += ` / ${repDefs[0].easy} min easy`;
  } else {
    summary += reps.map((r, i) => `${repDefs[i].hard}min @ ${fmtPaceMin(r.pace)}`).join(" → ");
  }
  if (cooldownS) summary += ` → ${cooldown} min CD`;

  const recoveries = repDefs.slice(0, -1).map((r) => (r.easy || 0) * 60);
  return { type: "intervals", warmup_s: warmupS, cooldown_s: cooldownS, workout_s: workoutS, reps, recoveries, summary, corrected: true };
}

// ============================================================

export default function RunningPage() {
  const [schedule, setSchedule] = useState([]);
  const [runLogs, setRunLogs] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState(null);
  const [analyticsTab, setAnalyticsTab] = useState("mileage");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
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

  // GPX / Strava upload
  const [gpxPreview, setGpxPreview] = useState(null);
  const [gpxAnalysis, setGpxAnalysis] = useState(null);
  const [stravaRows, setStravaRows] = useState(null);
  const [showGpx, setShowGpx] = useState(false);
  const [showStrava, setShowStrava] = useState(false);
  const [stravaPaste, setStravaPaste] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [corReps, setCorReps] = useState([{ start: "", end: "" }]);

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

  function handleGpxFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const isTcx = file.name.toLowerCase().endsWith(".tcx");
        setGpxPreview(isTcx ? parseTcx(text) : parseGpx(text));
        setGpxAnalysis(isTcx ? analyzeTcx(text) : analyzeWorkout(text));
        setShowCorrection(false);
      } catch (err) { alert(err.message); }
    };
    reader.readAsText(file);
  }

  async function saveGpx() {
    if (!gpxPreview) return;
    const { splits, moving_time_seconds, ...row } = gpxPreview;
    const notes = gpxAnalysis?.summary || null;
    let workoutData = null;
    if (gpxAnalysis) {
      const { segments, pts, mt, laps, ...storable } = gpxAnalysis;
      workoutData = storable;
    }
    await supabase.from("run_logs").insert({ ...row, source: "gpx", notes, workout_data: workoutData });
    const match = schedule.find((r) => r.date === row.date && !r.completed);
    if (match) await supabase.from("running_schedule").update({ completed: true }).eq("id", match.id);
    setGpxPreview(null); setGpxAnalysis(null); setShowGpx(false); setShowCorrection(false);
    load();
  }

  function handleStravaFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setStravaRows(parseStravaCsv(reader.result)); }
      catch (err) { alert(err.message); }
    };
    reader.readAsText(file);
  }

  function handleStravaPaste() {
    try { setStravaRows(parseStravaCsv(stravaPaste)); }
    catch (err) { alert(err.message); }
  }

  async function saveStravaRows() {
    if (!stravaRows?.length) return;
    const inserts = stravaRows.map(({ moving_time_seconds, ...r }) => ({ ...r, source: "strava" }));
    await supabase.from("run_logs").insert(inserts);
    for (const r of stravaRows) {
      const match = schedule.find((s) => s.date === r.date && !s.completed);
      if (match) await supabase.from("running_schedule").update({ completed: true }).eq("id", match.id);
    }
    setStravaRows(null); setShowStrava(false); setStravaPaste(""); load();
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
        <div style={{ display: "flex", gap: "6px" }}>
          <a href="https://connect.garmin.com/app/profile/93c62c27-a769-4778-834c-3f2a210ec2a0" target="_blank" rel="noopener noreferrer"
            className="btn" style={{ fontSize: "0.85rem" }}>Garmin</a>
          <a href="https://www.strava.com/dashboard" target="_blank" rel="noopener noreferrer"
            className="btn" style={{ fontSize: "0.85rem" }}>Strava</a>
        </div>
      </div>

      {bestHourMsg && <div className="alert alert-success">{bestHourMsg}</div>}

      {/* ===== TODAY’S WORKOUT ===== */}
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

      {/* ===== THIS WEEK ===== */}
      {hasSchedule && weekSchedule.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "16px" }}>
          {DAY_NAMES.map((name, i) => {
            const day = addDays(weekStart, i);
            const row = weekSchedule.find((r) => r.date === day);
            const dayLog = runLogs.find((r) => r.date === day);
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
                    {dayLog && <div style={{ fontSize: "0.7em", color: "#888" }}>{(+dayLog.distance_miles).toFixed(1)} mi</div>}
                    {!dayLog && row.completed && <div style={{ fontSize: "0.75em", color: "#888" }}>Done</div>}
                  </>
                ) : (
                  <div style={{ fontSize: "0.85em", color: "#888" }}>--</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== QUICK ACTIONS ===== */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <button className={`btn${showLogForm ? " btn-primary" : ""}`}
          onClick={() => { setShowLogForm(!showLogForm); setShowGpx(false); setShowStrava(false); }}>
          {showLogForm ? "Cancel" : "Log a Run"}
        </button>
        <button className={`btn${showGpx ? " btn-primary" : ""}`}
          onClick={() => { setShowGpx(!showGpx); setShowLogForm(false); setShowStrava(false); }}>
          {showGpx ? "Cancel" : "Upload GPX/TCX"}
        </button>
        <button className={`btn${showStrava ? " btn-primary" : ""}`}
          onClick={() => { setShowStrava(!showStrava); setShowLogForm(false); setShowGpx(false); }}>
          {showStrava ? "Cancel" : "Import Strava"}
        </button>
      </div>

      {/* --- Manual Log Form --- */}
      {showLogForm && (
        <form onSubmit={logRun} className="card" style={{ marginBottom: "16px" }}>
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

      {/* --- GPX/TCX Upload --- */}
      {showGpx && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <input type="file" accept=".gpx,.tcx" onChange={handleGpxFile} />
          {gpxPreview && (
            <div style={{ marginTop: "12px" }}>
              <div className="metrics-row">
                <div className="metric"><div className="metric-label">Date</div><div className="metric-value">{gpxPreview.date}</div></div>
                <div className="metric"><div className="metric-label">Distance</div><div className="metric-value">{gpxPreview.distance_miles} mi</div></div>
                <div className="metric"><div className="metric-label">Pace</div><div className="metric-value">{fmtPace(gpxPreview.pace_seconds)}</div></div>
                <div className="metric"><div className="metric-label">Elev Gain</div><div className="metric-value">{gpxPreview.elevation_gain_ft} ft</div></div>
              </div>
              {gpxPreview.splits.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <strong style={{ fontSize: "0.85em" }}>Splits:</strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                    {gpxPreview.splits.map((s) => (
                      <span key={s.mile} style={{ fontSize: "0.8em", padding: "2px 6px", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "4px" }}>
                        Mi {s.mile}: {fmtPace(s.pace_seconds)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {gpxAnalysis && (
                <div style={{ marginTop: "12px", padding: "12px", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: "0.75em", fontWeight: "bold", padding: "2px 8px", borderRadius: "3px",
                      background: gpxAnalysis.type === "intervals" ? "#F44336" : gpxAnalysis.type === "tempo" ? "#FF9800" : "#4CAF50",
                      color: "white",
                    }}>
                      {gpxAnalysis.type === "intervals" ? "INTERVALS" : gpxAnalysis.type === "tempo" ? "TEMPO" : "EASY"}
                    </span>
                    <button className="btn" style={{ fontSize: "0.8em" }}
                      onClick={() => {
                        if (!showCorrection && gpxAnalysis) {
                          const a = gpxAnalysis;
                          const fmtS = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
                          if (a.reps?.length) {
                            let t = a.warmup_s || 0;
                            setCorReps(a.reps.map((r, i) => {
                              const start = t;
                              const end = t + r.duration;
                              t = end + (a.recoveries?.[i] || 0);
                              return { start: fmtS(start), end: fmtS(end) };
                            }));
                          } else {
                            setCorReps([{ start: "", end: "" }]);
                          }
                        }
                        setShowCorrection(!showCorrection);
                      }}>
                      {showCorrection ? "Cancel" : "Doesn’t look right?"}
                    </button>
                  </div>

                  <p style={{ margin: "8px 0 0", fontSize: "0.9em" }}>{gpxAnalysis.summary}</p>
                  {gpxAnalysis.type === "easy" && gpxAnalysis.easyPace && gpxAnalysis.fastPace && (
                    <p style={{ margin: "4px 0 0", fontSize: "0.8em", color: "#888" }}>
                      No intervals detected — pace stayed within {((gpxAnalysis.easyPace - gpxAnalysis.fastPace) * 60).toFixed(0)}s/mi range. Use &quot;Doesn&apos;t look right?&quot; to define the workout.
                    </p>
                  )}

                  {(() => {
                    const planned = schedule.find((s) => s.date === gpxPreview.date);
                    if (!planned) return null;
                    return (
                      <div style={{ marginTop: "8px", fontSize: "0.85em", color: "#888" }}>
                        Planned: <strong style={{ color: TYPE_COLORS[planned._type] }}>{planned.workout.split("\n")[0]}</strong>
                      </div>
                    );
                  })()}

                  {gpxAnalysis.paceData && gpxAnalysis.paceData.length > 0 && (() => {
                    const data = gpxAnalysis.paceData;
                    const segs = gpxAnalysis.segments || [];
                    const maxT = data[data.length - 1].t;
                    const paces = data.map((p) => p.pace).filter((p) => p > 4 && p < 14);
                    if (!paces.length) return null;
                    const minP = Math.min(...paces) - 0.5;
                    const maxP = Math.max(...paces) + 0.5;
                    const range = maxP - minP || 1;
                    const step = Math.max(1, Math.floor(data.length / 200));
                    const sampled = data.filter((_, i) => i % step === 0);
                    return (
                      <div style={{ marginTop: "12px" }}>
                        <strong style={{ fontSize: "0.8em" }}>Pace Profile</strong>
                        <div style={{ position: "relative", height: "120px", marginTop: "4px", background: "rgba(255,255,255,0.03)", borderRadius: "4px", overflow: "hidden" }}>
                          {segs.map((s, i) => (
                            <div key={i} style={{
                              position: "absolute", bottom: 0, top: 0,
                              left: `${(s.s / maxT) * 100}%`,
                              width: `${((s.e - s.s) / maxT) * 100}%`,
                              background: s.z === "fast" ? "rgba(244,67,54,0.12)" : "transparent",
                            }} />
                          ))}
                          {gpxAnalysis.laps && (() => {
                            let cumT = 0;
                            return gpxAnalysis.laps.slice(0, -1).map((l, i) => {
                              cumT += l.dur;
                              return <div key={`lap${i}`} style={{
                                position: "absolute", top: 0, bottom: 0,
                                left: `${(cumT / maxT) * 100}%`,
                                width: "1px", background: "rgba(255,255,255,0.2)",
                                borderLeft: "1px dashed rgba(255,255,255,0.3)",
                              }} />;
                            });
                          })()}
                          {showCorrection && corReps.map((rep, i) => {
                            const ps = (s) => { const p = s.split(":").map(Number); return (p[0]||0)*60+(p[1]||0); };
                            const s = ps(rep.start || "0"), e = ps(rep.end || "0");
                            if (!s && !e) return null;
                            return <div key={`zone${i}`} style={{
                              position: "absolute", top: 0, bottom: 0,
                              left: `${(s / maxT) * 100}%`,
                              width: `${((e - s) / maxT) * 100}%`,
                              background: "rgba(244,67,54,0.2)",
                              borderLeft: "2px solid rgba(244,67,54,0.6)",
                              borderRight: "2px solid rgba(244,67,54,0.6)",
                            }} />;
                          })}
                          {sampled.map((p, i) => {
                            const x = (p.t / maxT) * 100;
                            const clampedPace = Math.min(Math.max(p.pace, minP), maxP);
                            const y = ((clampedPace - minP) / range) * 100;
                            const seg = segs.find((s) => p.t >= s.s && p.t <= s.e);
                            const color = seg?.z === "fast" ? "#F44336" : "#4CAF50";
                            return (
                              <div key={i} style={{
                                position: "absolute",
                                left: `${x}%`, bottom: `${100 - y}%`,
                                width: "2px", height: "2px", borderRadius: "50%",
                                background: color,
                              }} />
                            );
                          })}
                          <div style={{ position: "absolute", left: 0, top: "2px", fontSize: "0.65em", color: "#888" }}>
                            {fmtPaceMin(minP)}
                          </div>
                          <div style={{ position: "absolute", left: 0, bottom: "2px", fontSize: "0.65em", color: "#888" }}>
                            {fmtPaceMin(maxP)}
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7em", color: "#888", marginTop: "2px" }}>
                          <span>0:00</span>
                          <span>{Math.floor(maxT / 60)} min</span>
                        </div>
                      </div>
                    );
                  })()}

                  {gpxAnalysis.reps && gpxAnalysis.reps.length > 1 && (() => {
                    const hasHR = gpxAnalysis.reps.some((r) => r.hr > 0);
                    return (
                      <div style={{ marginTop: "8px", overflowX: "auto" }}>
                        <table style={{ fontSize: "0.8em", width: "100%" }}>
                          <thead>
                            <tr><th>Rep</th><th>Time</th><th>Pace</th>{hasHR && <th>HR</th>}</tr>
                          </thead>
                          <tbody>
                            {gpxAnalysis.reps.map((r, i) => (
                              <tr key={i}>
                                <td>{i + 1}</td>
                                <td>{(r.duration / 60).toFixed(1)} min</td>
                                <td>{fmtPaceMin(r.pace)}</td>
                                {hasHR && <td>{r.hr > 0 ? `${Math.round(r.hr)} bpm` : "--"}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {gpxAnalysis.laps && gpxAnalysis.laps.length > 0 && (
                    <details style={{ marginTop: "8px" }}>
                      <summary style={{ fontSize: "0.8em", cursor: "pointer", color: "#888" }}>Garmin Laps ({gpxAnalysis.laps.length})</summary>
                      <div style={{ overflowX: "auto", marginTop: "4px" }}>
                        <table style={{ fontSize: "0.75em", width: "100%" }}>
                          <thead>
                            <tr><th>Lap</th><th>Start</th><th>Time</th><th>Dist</th><th>Pace</th><th>Avg HR</th></tr>
                          </thead>
                          <tbody>
                            {(() => {
                              let cumT = 0;
                              return gpxAnalysis.laps.map((l, i) => {
                                const startT = cumT;
                                cumT += l.dur;
                                const isHard = gpxAnalysis.reps?.some(r => Math.abs(r.pace - l.pace) < 0.05 && Math.abs(r.duration - l.dur) < 2);
                                const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
                                return (
                                  <tr key={i} style={isHard ? { fontWeight: 600, color: "var(--accent, #e53935)" } : undefined}>
                                    <td>{i + 1}</td>
                                    <td>{fmtT(startT)}</td>
                                    <td>{l.dur >= 60 ? fmtT(l.dur) : `0:${String(Math.round(l.dur)).padStart(2, "0")}`}</td>
                                    <td>{(l.dist / 1609.34).toFixed(2)} mi</td>
                                    <td>{fmtPaceMin(l.pace)}</td>
                                    <td>{l.avgHR || "--"}</td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {showCorrection && (() => {
                    const parseMmSs = (s) => { const p = s.split(":").map(Number); return (p[0] || 0) * 60 + (p[1] || 0); };
                    const fmtS = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
                    const shiftAll = (delta) => setCorReps(corReps.map(r => ({
                      start: fmtS(Math.max(0, parseMmSs(r.start) + delta)),
                      end: fmtS(Math.max(0, parseMmSs(r.end) + delta)),
                    })));
                    return (
                    <div style={{ marginTop: "12px", padding: "8px", background: "var(--card-bg)", borderRadius: "4px", fontSize: "0.85em" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                        <label className="metric-label" style={{ margin: 0 }}>Shift all:</label>
                        <button className="btn" style={{ padding: "2px 8px" }} onClick={() => shiftAll(-15)}>-15s</button>
                        <button className="btn" style={{ padding: "2px 8px" }} onClick={() => shiftAll(-5)}>-5s</button>
                        <button className="btn" style={{ padding: "2px 8px" }} onClick={() => shiftAll(5)}>+5s</button>
                        <button className="btn" style={{ padding: "2px 8px" }} onClick={() => shiftAll(15)}>+15s</button>
                      </div>
                      <label className="metric-label">Reps</label>
                      {corReps.map((rep, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
                          <span style={{ width: "18px", color: "#888", fontSize: "0.85em" }}>{i + 1}</span>
                          <input type="text" value={rep.start} placeholder="0:00" style={{ width: "55px", textAlign: "center" }}
                            onChange={(e) => { const r = [...corReps]; r[i] = { ...r[i], start: e.target.value }; setCorReps(r); }} />
                          <span style={{ color: "#888" }}>→</span>
                          <input type="text" value={rep.end} placeholder="2:00" style={{ width: "55px", textAlign: "center" }}
                            onChange={(e) => { const r = [...corReps]; r[i] = { ...r[i], end: e.target.value }; setCorReps(r); }} />
                          <span style={{ color: "#666", fontSize: "0.8em", minWidth: "45px" }}>
                            {rep.start && rep.end ? `${((parseMmSs(rep.end) - parseMmSs(rep.start)) / 60).toFixed(1)}m` : ""}
                          </span>
                          {corReps.length > 1 && (
                            <button className="btn" style={{ padding: "2px 6px" }}
                              onClick={() => setCorReps(corReps.filter((_, j) => j !== i))}>×</button>
                          )}
                        </div>
                      ))}
                      <button className="btn" style={{ marginTop: "6px", fontSize: "0.85em" }}
                        onClick={() => {
                          const last = corReps[corReps.length - 1];
                          const lastEnd = parseMmSs(last.end);
                          const dur = parseMmSs(last.end) - parseMmSs(last.start);
                          const gap = corReps.length > 1 ? parseMmSs(corReps[corReps.length - 1].start) - parseMmSs(corReps[corReps.length - 2].end) : 60;
                          setCorReps([...corReps, { start: fmtS(lastEnd + gap), end: fmtS(lastEnd + gap + dur) }]);
                        }}>+ Rep</button>
                      <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                        <button className="btn btn-primary" onClick={() => {
                          const windows = corReps.filter(r => r.start && r.end).map(r => ({ s: parseMmSs(r.start), e: parseMmSs(r.end) }));
                          if (!windows.length) return;
                          const pd = gpxAnalysis.paceData;
                          const laps = gpxAnalysis.laps;
                          const cumT = laps ? [0] : [];
                          if (laps) for (let j = 0; j < laps.length; j++) cumT.push(cumT[j] + laps[j].dur);
                          const reps = windows.map(w => {
                            const hardS = w.e - w.s;
                            let lapPace = null, lapHR = 0, pdPace = null, pdHR = 0;
                            if (laps) {
                              let dur = 0, dist = 0, hrS = 0, hrN = 0;
                              for (let j = 0; j < laps.length; j++) {
                                const ovS = Math.max(cumT[j], w.s), ovE = Math.min(cumT[j+1], w.e);
                                if (ovE > ovS) { const frac = (ovE-ovS)/laps[j].dur; dur += ovE-ovS; dist += laps[j].dist*frac; if (laps[j].avgHR) { hrS += laps[j].avgHR; hrN++; } }
                              }
                              if (dur > 0 && dist > 0) { lapPace = (dur/60)/(dist/1609.34); lapHR = hrN ? hrS/hrN : 0; }
                            }
                            if (pd?.length) {
                              const pts = pd.filter(p => p.t >= w.s && p.t < w.e);
                              if (pts.length >= 2) { pdPace = pts.reduce((a,p)=>a+p.pace,0)/pts.length; const hp = pts.filter(p=>p.hr); pdHR = hp.length ? hp.reduce((a,p)=>a+p.hr,0)/hp.length : 0; }
                            }
                            const agree = lapPace != null && pdPace != null && Math.abs(lapPace-pdPace) < 0.5;
                            const pace = agree ? lapPace : (pdPace ?? lapPace);
                            const hr = agree ? lapHR : (pdHR || lapHR);
                            return { duration: hardS, pace: pace || 0, hr: hr || 0 };
                          });
                          const recoveries = windows.slice(0,-1).map((w,i) => windows[i+1].s - w.e);
                          const warmupS = windows[0].s;
                          const avgPace = reps.reduce((a,r)=>a+r.pace,0)/reps.length;
                          const allSame = reps.length > 1 && reps.every(r => Math.abs(r.duration - reps[0].duration) < 5);
                          let summary = "";
                          if (warmupS > 0) summary += `${Math.round(warmupS/60)} min WU → `;
                          if (allSame) {
                            summary += `${reps.length} x ${(reps[0].duration/60).toFixed(1)} min @ ${fmtPaceMin(avgPace)}`;
                            const avgRec = recoveries.length ? recoveries.reduce((a,b)=>a+b,0)/recoveries.length : 0;
                            if (avgRec > 0) summary += ` / ${(avgRec/60).toFixed(1)} min rest`;
                          } else {
                            summary += reps.map(r => `${(r.duration/60).toFixed(1)}min @ ${fmtPaceMin(r.pace)}`).join(" → ");
                          }
                          const totalEnd = gpxAnalysis.paceData?.[gpxAnalysis.paceData.length-1]?.t || 0;
                          const cdS = totalEnd - windows[windows.length-1].e;
                          if (cdS > 60) summary += ` → ${Math.round(cdS/60)} min CD`;
                          setGpxAnalysis({ ...gpxAnalysis, type: "intervals", reps, recoveries, warmup_s: warmupS, cooldown_s: cdS, summary, corrected: true });
                          setShowCorrection(false);
                        }}>Re-analyze</button>
                        <button className="btn" onClick={() => {
                          setGpxAnalysis({ ...gpxAnalysis, type: "easy", summary: "Easy run", reps: [], segments: [], corrected: true });
                          setShowCorrection(false);
                        }}>Just an easy run</button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}

              <button className="btn btn-primary" onClick={saveGpx} style={{ marginTop: "12px" }}>Save to Log</button>
            </div>
          )}
        </div>
      )}

      {/* --- Strava Import --- */}
      {showStrava && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <p style={{ fontSize: "0.8em", color: "var(--muted)", marginBottom: "8px" }}>
            Upload activities.csv from Strava data export, or paste contents below.
          </p>
          <input type="file" accept=".csv" onChange={handleStravaFile} />
          <div style={{ marginTop: "8px" }}>
            <textarea rows={4} value={stravaPaste} onChange={(e) => setStravaPaste(e.target.value)}
              placeholder="Or paste CSV content here..." style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8em" }} />
            <button className="btn" onClick={handleStravaPaste} style={{ marginTop: "4px" }}>Parse Pasted CSV</button>
          </div>
          {stravaRows && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ fontSize: "0.85em" }}>{stravaRows.length} run{stravaRows.length !== 1 ? "s" : ""} found</p>
              {stravaRows.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: "8px" }}>
                  <table style={{ fontSize: "0.8em" }}>
                    <thead><tr><th>Date</th><th>Distance</th><th>Pace</th><th>Elev</th></tr></thead>
                    <tbody>
                      {stravaRows.slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td>{r.date}</td>
                          <td>{r.distance_miles} mi</td>
                          <td>{fmtPace(r.pace_seconds)}</td>
                          <td>{r.elevation_gain_ft} ft</td>
                        </tr>
                      ))}
                      {stravaRows.length > 10 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>...{stravaRows.length - 10} more</td></tr>}
                    </tbody>
                  </table>
                  <button className="btn btn-primary" onClick={saveStravaRows} style={{ marginTop: "8px" }}>
                    Import {stravaRows.length} Run{stravaRows.length !== 1 ? "s" : ""}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== STATS ===== */}
      {hasLogs && runLogs.length >= 2 && (
        <div className="metrics-row" style={{ marginBottom: "16px" }}>
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
      )}

      {/* ===== RECENT RUNS ===== */}
      {hasLogs && (
        <>
          <h2>Recent Runs</h2>
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

      <div className="divider" />

      {/* ===== SCHEDULE (collapsible) ===== */}
      <div style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        onClick={() => setShowSchedule(!showSchedule)}>
        <h2 style={{ margin: 0 }}>Schedule</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {hasSchedule && (
            <span style={{ fontSize: "0.8em", color: "#888" }}>
              {completedWorkouts}/{totalWorkouts} done ({progressPct}%)
            </span>
          )}
          <span style={{ color: "#888" }}>{showSchedule ? "▾" : "▸"}</span>
        </div>
      </div>
      {hasSchedule && (
        <div style={{ background: "#333", borderRadius: "4px", height: "6px", marginTop: "8px" }}>
          <div style={{
            background: "#4CAF50", height: "100%", borderRadius: "4px",
            width: `${progressPct}%`, transition: "width 0.3s",
          }} />
        </div>
      )}

      {showSchedule && (
        <div style={{ marginTop: "12px" }}>
          {!hasSchedule && <div className="alert alert-info">No schedule loaded yet.</div>}

          {hasSchedule && (
            <>
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
            </>
          )}

          <div style={{ marginTop: "12px" }}>
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

      <div className="divider" />

      {/* ===== ANALYTICS (collapsible) ===== */}
      <div style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        onClick={() => setShowAnalytics(!showAnalytics)}>
        <h2 style={{ margin: 0 }}>Analytics</h2>
        <span style={{ color: "#888" }}>{showAnalytics ? "▾" : "▸"}</span>
      </div>

      {showAnalytics && (
        <div style={{ marginTop: "12px" }}>
          {!hasLogs || runLogs.length < 2 ? (
            <div className="alert alert-info">Need at least 2 logged runs for analytics.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
                {["mileage", "pace", "load", "workouts"].map((t) => (
                  <button key={t} className={`btn${analyticsTab === t ? " btn-primary" : ""}`}
                    onClick={() => setAnalyticsTab(t)} style={{ textTransform: "capitalize" }}>
                    {t === "load" ? "Training Load" : t}
                  </button>
                ))}
              </div>

              {analyticsTab === "mileage" && <BarChart data={weeklyMileage()} label="Weekly Miles" />}

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
                        const last5p = wp.slice(-5).reduce((s, r) => s + r.pace_seconds, 0) / 5;
                        const diff = first5 - last5p;
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

              {analyticsTab === "workouts" && (() => {
                const workouts = runLogs
                  .filter((r) => r.workout_data)
                  .map((r) => ({ ...(typeof r.workout_data === "string" ? JSON.parse(r.workout_data) : r.workout_data), date: r.date, distance: r.distance_miles }))
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                if (!workouts.length) return (
                  <div className="alert alert-info">No workouts analyzed yet. Upload a GPX/TCX file to get started.</div>
                );
                const intervals = workouts.filter((w) => w.type === "intervals").reverse();
                return (
                  <div>
                    <h3>Workout History</h3>
                    {workouts.map((w, i) => (
                      <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #333" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>
                            <strong>{fmtShortDate(w.date)}</strong>
                            {w.distance && ` · ${w.distance} mi`}
                          </span>
                          <span style={{
                            fontSize: "0.7em", fontWeight: "bold", padding: "1px 6px", borderRadius: "3px",
                            background: w.type === "intervals" ? "#F44336" : w.type === "tempo" ? "#FF9800" : "#4CAF50",
                            color: "white",
                          }}>
                            {(w.type || "easy").toUpperCase()}
                          </span>
                        </div>
                        <p style={{ fontSize: "0.85em", color: "#888", margin: "2px 0 0" }}>{w.summary}</p>
                      </div>
                    ))}

                    {intervals.length >= 2 && (
                      <>
                        <h3 style={{ marginTop: "16px" }}>Interval Pace Trend</h3>
                        {(() => {
                          const paces = intervals.map((w) => w.reps.reduce((a, r) => a + r.pace, 0) / w.reps.length);
                          const minP = Math.min(...paces) - 0.5;
                          const maxP = Math.max(...paces) + 0.5;
                          const range = maxP - minP || 1;
                          return (
                            <div>
                              <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "150px" }}>
                                {intervals.map((w, i) => {
                                  const pct = ((maxP - paces[i]) / range) * 100;
                                  return (
                                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                                      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
                                        <div style={{
                                          width: "100%", background: "#F44336", borderRadius: "3px 3px 0 0",
                                          height: `${Math.max(pct, 5)}%`, transition: "height 0.3s",
                                        }} title={`${fmtShortDate(w.date)}: ${fmtPaceMin(paces[i])}`} />
                                      </div>
                                      <div style={{ fontSize: "0.6em", color: "#888", marginTop: "4px" }}>{w.date.slice(5)}</div>
                                    </div>
                                  );
                                })}
                              </div>
                              <p style={{ fontSize: "0.8em", color: "#888", marginTop: "4px" }}>
                                Taller = faster. Avg rep pace: {fmtPaceMin(paces[0])} → {fmtPaceMin(paces[paces.length - 1])}
                                {paces[paces.length - 1] < paces[0] ? " (getting faster)" : paces[paces.length - 1] > paces[0] ? " (slowing)" : ""}
                              </p>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}
            </>
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

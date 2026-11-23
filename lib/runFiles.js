// Readers for run files: GPX (with interval detection), TCX (Garmin laps) and the Strava activities.csv export.
// Pure functions (parseGpx/analyzeWorkout need the browser DOMParser), kept out of the page so they can be tested.
import { isoDate } from "./dates.js"; // relative so `npm test` (plain node) can load this file

export function fmtPaceMin(p) {
  if (!p || !isFinite(p)) return "--";
  const ts = Math.round(p * 60);
  return `${Math.floor(ts / 60)}:${String(ts % 60).padStart(2, "0")}/mi`;
}

// --- GPX / Strava helpers ---

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseGpx(xmlText) {
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
    : isoDate();

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

// Strava's "Activity Date" is UTC ("Oct 2, 2026, 2:00:00 AM" or "2026-10-02 02:00:00"); return the local
// day, so a 9 PM run in Indiana stays on the day you ran it. Parsed by hand because Safari's Date parsing differs.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function stravaDate(raw) {
  const s = (raw || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let utc;
  if (m) utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  else if ((m = s.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?(AM|PM)?/i))) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon < 0) return null;
    let h = +m[4] % 12;
    if ((m[7] || "").toUpperCase() === "PM") h += 12;
    else if (!m[7]) h = +m[4];
    utc = Date.UTC(+m[3], mon, +m[2], h, +m[5], +(m[6] || 0));
  } else return null;
  return isoDate(new Date(utc));
}

export function parseStravaCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iDate = idx("Activity Date");
  const iType = idx("Activity Type");
  const iElapsed = idx("Elapsed Time");
  // Strava's export has two "Distance" columns: the first is in your account's units (km or miles),
  // the second is always meters. Use the meters one; a file with just one Distance column is treated as km.
  const distCols = headers.flatMap((h, i) => (h.toLowerCase() === "distance" ? [i] : []));
  const iDist = distCols.length ? distCols[distCols.length - 1] : -1;
  const distToMiles = distCols.length > 1 ? (v) => v / 1609.34 : (v) => v / 1.60934;
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

    const date = stravaDate(vals[iDate]);
    if (!date) continue;

    const distMi = +distToMiles(parseFloat(vals[iDist]) || 0).toFixed(2);
    const elapsed = parseInt(vals[iElapsed]) || 0;
    const moving = iMoving >= 0 ? (parseInt(vals[iMoving]) || elapsed) : elapsed;
    const elev = iElev >= 0 ? parseFloat(vals[iElev]) || 0 : 0;
    const elevFt = Math.round(elev * 3.28084);
    const pace = distMi > 0 && moving > 0 ? Math.round(moving / distMi) : 0;

    rows.push({ date, distance_miles: distMi, duration_seconds: elapsed, moving_time_seconds: moving, pace_seconds: pace, elevation_gain_ft: elevFt });
  }
  return rows;
}

// Strava's export always has your whole history, so drop runs already in the log:
// same date and within 0.05 mi. Returns { fresh, dupes }.
export function splitNewRuns(rows, logs) {
  const fresh = [], dupes = [];
  for (const r of rows) {
    const seen = logs.some((l) => l.date === r.date && Math.abs((l.distance_miles || 0) - r.distance_miles) < 0.05)
      || fresh.some((f) => f.date === r.date && Math.abs(f.distance_miles - r.distance_miles) < 0.05);
    (seen ? dupes : fresh).push(r);
  }
  return { fresh, dupes };
}

// --- TCX parser (uses Garmin laps + speed data) ---

export function parseTcx(text) {
  const lapBlocks = text.split("<Lap ").slice(1);
  if (!lapBlocks.length) throw new Error("No laps found in TCX file");
  let totalDist = 0, totalTime = 0, elevGain = 0, hrSum = 0, hrCount = 0;
  const splits = [];
  for (const blk of lapBlocks) {
    const dur = parseFloat(blk.match(/<TotalTimeSeconds>([\d.]+)/)?.[1] || 0);
    const dist = parseFloat(blk.match(/<DistanceMeters>([\d.]+)/)?.[1] || 0);
    const avgHR = parseInt(blk.match(/<AverageHeartRateBpm>\s*<Value>(\d+)/)?.[1] || 0);
    totalTime += dur;
    totalDist += dist;
    if (avgHR > 0) { hrSum += avgHR * dur; hrCount += dur; }
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
  const date = ft ? `${ft.getFullYear()}-${String(ft.getMonth() + 1).padStart(2, "0")}-${String(ft.getDate()).padStart(2, "0")}` : isoDate();
  const distMi = totalDist / 1609.34;
  return {
    date, distance_miles: +distMi.toFixed(2), duration_seconds: Math.round(totalTime),
    moving_time_seconds: Math.round(totalTime), pace_seconds: distMi > 0 ? Math.round(totalTime / distMi) : 0,
    elevation_gain_ft: Math.round(elevGain * 3.28084), avg_heart_rate: hrCount > 0 ? Math.round(hrSum / hrCount) : null, splits,
  };
}

export function analyzeTcx(text) {
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
      const pause = dt > 10 && spd < 0.5;
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

  const sortedPaces = [...paces].sort((a, b) => a - b);
  let maxGap = 0, gapIdx = 0;
  for (let i = 1; i < sortedPaces.length; i++) {
    const gap = sortedPaces[i] - sortedPaces[i - 1];
    if (gap > maxGap) { maxGap = gap; gapIdx = i; }
  }
  const hardThresh = maxGap > 0.5 ? (sortedPaces[gapIdx - 1] + sortedPaces[gapIdx]) / 2 : avgPace - paceRange * 0.3;
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
  let cdS = laps.slice(cdStart).reduce((a, l) => a + l.dur, 0);
  // recoveries between all hard laps (including rest after last rep)
  const recoveries = [];
  for (let i = 0; i < hardIdxs.length - 1; i++) {
    const between = laps.slice(hardIdxs[i] + 1, hardIdxs[i + 1]);
    recoveries.push(between.reduce((a, l) => a + l.dur, 0));
  }
  const lastRestLaps = laps.slice(hardIdxs[hardIdxs.length - 1] + 1, cdStart);
  if (lastRestLaps.length) recoveries.push(lastRestLaps.reduce((a, l) => a + l.dur, 0));

  // scan paceData for missed reps after last lap-based hard rep (e.g. missed lap press)
  if (pd.length > 20) {
    const cumLapT = [0];
    for (let j = 0; j < laps.length; j++) cumLapT.push(cumLapT[j] + laps[j].dur);
    const lastHardEnd = cumLapT[hardIdxs[hardIdxs.length - 1] + 1];
    const totalTime = cumLapT[cumLapT.length - 1];
    const rp = pd.map(p => p.pace).filter(p => p > 4 && p < 12);
    if (rp.length > 20) {
      let pc1 = Math.min(...rp), pc2 = Math.max(...rp);
      for (let it = 0; it < 20; it++) {
        const g1 = rp.filter(p => Math.abs(p - pc1) <= Math.abs(p - pc2));
        const g2 = rp.filter(p => Math.abs(p - pc1) > Math.abs(p - pc2));
        if (!g1.length || !g2.length) break;
        pc1 = g1.reduce((a, b) => a + b) / g1.length;
        pc2 = g2.reduce((a, b) => a + b) / g2.length;
      }
      if (pc2 - pc1 >= 0.4) {
        const pdThr = pc1 + (pc2 - pc1) * 0.3;
        const postPd = pd.filter(p => p.t > lastHardEnd);
        const extraSegs = [];
        let inF = false, fS = 0;
        for (let k = 0; k <= postPd.length; k++) {
          const p = k < postPd.length ? postPd[k] : null;
          if (p && p.pace < pdThr && !inF) { inF = true; fS = p.t; }
          if (inF && (!p || p.pace >= pdThr)) {
            const fE = postPd[Math.max(0, k - 1)].t;
            if (fE - fS >= 60) extraSegs.push({ s: fS, e: fE });
            inF = false;
          }
        }
        if (extraSegs.length) {
          if (recoveries.length > hardIdxs.length - 1) recoveries.pop();
          let prevEnd = lastHardEnd;
          for (const seg of extraSegs) {
            recoveries.push(seg.s - prevEnd);
            const rPts = pd.filter(pp => pp.t >= seg.s && pp.t <= seg.e);
            const aP = rPts.reduce((a, pp) => a + pp.pace, 0) / rPts.length;
            const hPts = rPts.filter(pp => pp.hr);
            const aH = hPts.length ? hPts.reduce((a, pp) => a + pp.hr, 0) / hPts.length : 0;
            reps.push({ duration: seg.e - seg.s, pace: aP, hr: Math.round(aH), dist: 0 });
            prevEnd = seg.e;
          }
          cdS = totalTime - extraSegs[extraSegs.length - 1].e;
        }
      }
    }
  }

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

export function analyzeWorkout(gpxText) {
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

export function refitWorkout(analysis, { warmup, reps: repDefs, cooldown }) {
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

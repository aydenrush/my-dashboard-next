// Parse a Google Calendar iCal feed into [{ summary, start, end, location, description }].
// start/end: "YYYY-MM-DD" (all day), "YYYY-MM-DDTHH:MM" (local wall time) or a UTC ISO string ("...Z").
// Repeating events (RRULE) are expanded into one entry per occurrence inside the window.

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_MS = 86400000;

export function parseIcal(text, { from, to } = defaultWindow()) {
  const raw = [];
  let ev = null;
  for (const line of unfold(text).split("\n")) {
    if (line.startsWith("BEGIN:VEVENT")) { ev = { exdates: [] }; continue; }
    if (line.startsWith("END:VEVENT") && ev) { raw.push(ev); ev = null; continue; }
    if (!ev) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1).trim();
    const key = keyPart.split(";")[0];
    if (key === "SUMMARY") ev.summary = unescapeIcal(val);
    else if (key === "DTSTART") ev.start = parseIcalDate(val, keyPart);
    else if (key === "DTEND") ev.end = parseIcalDate(val, keyPart);
    else if (key === "LOCATION") ev.location = unescapeIcal(val);
    else if (key === "DESCRIPTION") ev.description = unescapeIcal(val).slice(0, 200);
    else if (key === "UID") ev.uid = val;
    else if (key === "RRULE") ev.rrule = val;
    else if (key === "EXDATE") ev.exdates.push(...val.split(",").map((v) => dayOf(parseIcalDate(v, keyPart))));
    else if (key === "RECURRENCE-ID") ev.recurrenceId = dayOf(parseIcalDate(val, keyPart));
  }

  // a moved/edited single occurrence comes as its own VEVENT with RECURRENCE-ID; skip that day in the series
  const overridden = {};
  for (const e of raw) if (e.uid && e.recurrenceId) (overridden[e.uid] ||= new Set()).add(e.recurrenceId);

  const out = [];
  for (const { uid, rrule, exdates, recurrenceId, ...e } of raw) {
    if (!e.summary || !e.start) continue;
    if (!rrule) { out.push(e); continue; }
    const skip = new Set([...exdates, ...(overridden[uid] || [])]);
    for (const day of occurrences(dayOf(e.start), rrule, from, to)) {
      if (skip.has(day)) continue;
      const shift = (s) => (s ? shiftDays(s, daysBetween(dayOf(e.start), day)) : s);
      out.push({ ...e, start: shift(e.start), end: shift(e.end) });
    }
  }
  return out;
}

function defaultWindow() {
  const today = new Date().toISOString().slice(0, 10);
  return { from: addDays(today, -30), to: addDays(today, 120) };
}

// days (YYYY-MM-DD) a DAILY or WEEKLY rule hits between from and to. Other rules keep just the first day.
// shortcut: no MONTHLY/YEARLY, BYMONTHDAY or BYSETPOS; add them if a monthly event ever goes missing
export function occurrences(startDay, rrule, from, to) {
  const r = Object.fromEntries(rrule.split(";").map((p) => p.split("=")));
  const interval = Math.max(1, parseInt(r.INTERVAL) || 1);
  const count = r.COUNT ? parseInt(r.COUNT) : Infinity;
  const until = r.UNTIL ? dayOf(parseIcalDate(r.UNTIL, "")) : "9999-12-31";
  if (r.FREQ !== "DAILY" && r.FREQ !== "WEEKLY") return startDay >= from && startDay <= to ? [startDay] : [];
  const byDay = r.FREQ === "WEEKLY" && r.BYDAY
    ? new Set(r.BYDAY.split(",").map((d) => DAY_CODES.indexOf(d.slice(-2))))
    : null;
  const days = [];
  let n = 0;
  // walk day by day; weekly rules count weeks from the week of the first event
  const weekStart = addDays(startDay, -weekday(startDay));
  for (let day = startDay, guard = 0; day <= until && day <= to && n < count && guard < 3000; day = addDays(day, 1), guard++) {
    let hit;
    if (r.FREQ === "DAILY") hit = daysBetween(startDay, day) % interval === 0;
    else {
      const week = Math.floor(daysBetween(weekStart, day) / 7);
      hit = week % interval === 0 && (byDay ? byDay.has(weekday(day)) : weekday(day) === weekday(startDay));
    }
    if (!hit) continue;
    n++; // COUNT includes occurrences before the window
    if (day >= from) days.push(day);
  }
  return days;
}

function unfold(text) {
  return text.replace(/\r\n /g, "").replace(/\r\n\t/g, "").replace(/\r/g, "");
}

function unescapeIcal(s) {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\").replace(/\\;/g, ";");
}

function parseIcalDate(val, keyPart) {
  if (keyPart.includes("VALUE=DATE") || /^\d{8}$/.test(val)) return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
  // 20261001T143000Z or 20261001T143000
  const y = val.slice(0, 4), m = val.slice(4, 6), d = val.slice(6, 8);
  const hh = val.slice(9, 11), mm = val.slice(11, 13);
  if (val.endsWith("Z")) return new Date(`${y}-${m}-${d}T${hh}:${mm}:00Z`).toISOString();
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

// day part of a start value; for UTC values that's the UTC day, which is what the rule's BYDAY uses
const dayOf = (s) => s.slice(0, 10);
const utc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const addDays = (day, n) => new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
const weekday = (day) => new Date(utc(day)).getUTCDay();
const shiftDays = (s, n) => addDays(dayOf(s), n) + s.slice(10);

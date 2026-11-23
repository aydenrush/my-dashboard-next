// The phone calendar feed (training_plan.ics) and the activity start-time rules it shares with Home.
// Relative imports so `npm test` (plain node) can load this file.
import { ACTIVITY_TYPES } from "./constants.js";
import { isRestText } from "./runs.js";
import { addDays } from "./dates.js";

export const DURATION_MAP = { lifting: 45, cycling: 60, frisbee_golf: 120, running: 45, other: 60 };

// "7:00 PM" / "Evening" / null -> [hour, minute]
export function parseTimeSlot(slot) {
  if (!slot) return [8, 0];
  const presets = { Morning: [8, 0], Midday: [11, 0], Afternoon: [14, 0], Evening: [17, 30] };
  if (presets[slot]) return presets[slot];
  const m = slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) { let h = parseInt(m[1]), min = parseInt(m[2]); if (m[3]?.toUpperCase() === "PM" && h < 12) h += 12; if (m[3]?.toUpperCase() === "AM" && h === 12) h = 0; return [h, min]; }
  return [8, 0];
}

// start [hour, minute] for an activity; runs with no time default to 9 PM (night runs), same on Home and in the phone feed
export function actStart(a) {
  if (a.time_slot) return parseTimeSlot(a.time_slot);
  return a.activity_type === "running" && !isRestText(a.title) ? [21, 0] : [8, 0];
}

const TZ = "America/Indiana/Indianapolis";
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;

// activities -> iCal text. Rest days are left out.
export function buildIcs(activities) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyDashboard//Planner//EN",
    "CALSCALE:GREGORIAN", "X-WR-CALNAME:Training Plan", `X-WR-TIMEZONE:${TZ}`,
  ];
  for (const act of activities) {
    if (act.activity_type === "running" && isRestText(act.title)) continue;
    const at = ACTIVITY_TYPES[act.activity_type] || ACTIVITY_TYPES.other;
    const summary = act.title ? `${at.label}: ${act.title}` : at.label;
    const [h, m] = actStart(act);
    const startMin = h * 60 + m;
    const endMin = startMin + (act.duration_min || DURATION_MAP[act.activity_type] || 60);
    // an 11:30 PM + 60 min event ends at 12:30 AM the next day, not "24:30"
    const endDay = addDays(act.date, Math.floor(endMin / 1440));
    lines.push("BEGIN:VEVENT", `UID:act-${act.id}@mydashboard`,
      `DTSTART;TZID=${TZ}:${act.date.replace(/-/g, "")}T${hhmm(startMin)}`,
      `DTEND;TZID=${TZ}:${endDay.replace(/-/g, "")}T${hhmm(endMin % 1440)}`,
      `SUMMARY:${esc(summary)}`);
    if (act.notes) lines.push(`DESCRIPTION:${esc(act.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// All dates in the app are local "YYYY-MM-DD" strings. Never use toISOString() for a date: it gives the
// UTC day, which is tomorrow for anything after 7–8 PM in Indiana.

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// noon avoids daylight-saving edges when adding days
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// 0 = Monday ... 6 = Sunday (the app's week starts Monday)
export function weekdayIndex(iso) {
  return (new Date(iso + "T12:00:00").getDay() + 6) % 7;
}

export function mondayOf(iso) {
  const d = new Date(iso + "T12:00:00");
  return addDays(iso, -((d.getDay() + 6) % 7));
}

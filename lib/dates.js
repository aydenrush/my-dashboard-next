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

export function mondayOf(iso) {
  const d = new Date(iso + "T12:00:00");
  return addDays(iso, -((d.getDay() + 6) % 7));
}

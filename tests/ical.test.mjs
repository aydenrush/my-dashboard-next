import assert from "node:assert";
const { parseIcal, occurrences } = await import("../lib/ical.js");
const win = { from: "2026-11-01", to: "2026-11-30" };
const cal = (...evs) => ["BEGIN:VCALENDAR", ...evs.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

// weekend job: Sat + Sun weekly since August, local times
const shift = ["UID:job", "SUMMARY:Work", "DTSTART;TZID=America/Indiana/Indianapolis:20260815T110000",
  "DTEND;TZID=America/Indiana/Indianapolis:20260815T160000", "RRULE:FREQ=WEEKLY;BYDAY=SA,SU"];
let evs = parseIcal(cal(shift), win);
assert.deepEqual(evs.map((e) => e.start.slice(0, 10)),
  ["2026-11-01", "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"]);
assert.equal(evs[0].start, "2026-11-01T11:00"); // wall time kept
assert.equal(evs[0].end, "2026-11-01T16:00");

// a skipped day (EXDATE) and a moved day (RECURRENCE-ID override) don't double up
evs = parseIcal(cal(
  [...shift, "EXDATE;TZID=America/Indiana/Indianapolis:20261107T110000"],
  ["UID:job", "SUMMARY:Work (late)", "RECURRENCE-ID;TZID=America/Indiana/Indianapolis:20261114T110000",
    "DTSTART;TZID=America/Indiana/Indianapolis:20261114T130000", "DTEND;TZID=America/Indiana/Indianapolis:20261114T180000"],
), win);
const days = evs.map((e) => `${e.start.slice(0, 10)} ${e.summary}`).sort();
assert.ok(!days.includes("2026-11-07 Work"), "EXDATE removed");
assert.deepEqual(days.filter((d) => d.startsWith("2026-11-14")), ["2026-11-14 Work (late)"], "override replaces the series day");

// COUNT counts from the first event, even before the window; UNTIL stops it
assert.deepEqual(occurrences("2026-10-26", "FREQ=DAILY;COUNT=10", win.from, win.to), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
assert.deepEqual(occurrences("2026-11-02", "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261201T045959Z", win.from, win.to), ["2026-11-02", "2026-11-16", "2026-11-30"]);
// unsupported (monthly) keeps just the first if it's in the window
assert.deepEqual(occurrences("2026-11-05", "FREQ=MONTHLY", win.from, win.to), ["2026-11-05"]);

// plain event and UTC event untouched
evs = parseIcal(cal(["SUMMARY:Dinner", "DTSTART:20261122T010000Z", "DTEND:20261122T020000Z"], ["SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261126"]), win);
assert.deepEqual(evs.map((e) => e.start), ["2026-11-22T01:00:00.000Z", "2026-11-26"]);
console.log("ical ok");

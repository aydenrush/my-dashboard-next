import assert from "node:assert";
const { buildIcs, actStart, parseTimeSlot } = await import("../lib/ics.js");

const ics = buildIcs([
  { id: 1, date: "2026-11-24", activity_type: "lifting", title: "Upper, push; pull", time_slot: "11:30 PM", duration_min: 60, notes: "bench\nrows" },
  { id: 2, date: "2026-11-25", activity_type: "running", title: "Easy 20 min", time_slot: null, duration_min: null },
  { id: 3, date: "2026-11-26", activity_type: "running", title: "Rest Day", time_slot: null },
  { id: 4, date: "2026-12-31", activity_type: "other", title: null, time_slot: "11:00 PM", duration_min: 120 },
]);
const ev = (id) => ics.split("BEGIN:VEVENT").find((b) => b.includes(`UID:act-${id}@`));

// past midnight rolls into the next day instead of "24:30"
assert.match(ev(1), /DTSTART;TZID=America\/Indiana\/Indianapolis:20261124T233000/);
assert.match(ev(1), /DTEND;TZID=America\/Indiana\/Indianapolis:20261125T003000/);
// commas, semicolons and newlines are escaped
assert.ok(ev(1).includes("SUMMARY:Lifting: Upper\\, push\\; pull"));
assert.ok(ev(1).includes("DESCRIPTION:bench\\nrows"));
// runs without a time: 9 PM, 45 min default
assert.match(ev(2), /T210000[\s\S]*T214500/);
// rest days skipped; end of year rolls into the new year
assert.equal(ev(3), undefined);
assert.match(ev(4), /DTEND;TZID=America\/Indiana\/Indianapolis:20270101T010000/);
assert.ok(ics.startsWith("BEGIN:VCALENDAR") && ics.endsWith("END:VCALENDAR"));

assert.deepEqual(parseTimeSlot("12:15 AM"), [0, 15]);
assert.deepEqual(parseTimeSlot("12:15 PM"), [12, 15]);
assert.deepEqual(actStart({ activity_type: "running", title: "Rest Day" }), [8, 0]);
console.log("ics ok");

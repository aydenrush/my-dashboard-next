process.env.TZ = "America/Indiana/Indianapolis";
import assert from "node:assert";
const { isoDate, addDays, mondayOf, weekdayIndex } = await import("../lib/dates.js");

assert.equal(addDays("2026-11-01", 1), "2026-11-02"); // across the Nov 1 DST change
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
assert.equal(addDays("2026-03-01", -1), "2026-02-28");
assert.equal(mondayOf("2026-11-22"), "2026-11-16"); // Sunday belongs to the week before
assert.equal(mondayOf("2026-11-23"), "2026-11-23");
assert.deepEqual(["2026-11-23", "2026-11-29"].map(weekdayIndex), [0, 6]);
assert.equal(isoDate(new Date(2026, 10, 21, 23, 30)), "2026-11-21"); // 11:30 PM stays on its local day
console.log("dates ok");

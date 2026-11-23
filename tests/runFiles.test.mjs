process.env.TZ = "America/Indiana/Indianapolis";
import assert from "node:assert";
const { stravaDate, parseStravaCsv, parseTcx, fmtPaceMin } = await import("../lib/runFiles.js");
// Strava writes UTC: a 9 PM Oct 1 run in Indiana is "Oct 2, 2026, 1:00:00 AM" (EDT, UTC-4)
assert.equal(stravaDate("Oct 2, 2026, 1:00:00 AM"), "2026-10-01");
assert.equal(stravaDate("2026-10-02 01:00:00"), "2026-10-01");
assert.equal(stravaDate("Oct 1, 2026, 3:30:00 PM"), "2026-10-01"); // 11:30 AM local, same day
assert.equal(stravaDate("Dec 5, 2026, 12:15:00 AM"), "2026-12-04"); // 12 AM UTC = 7:15 PM EST the day before
assert.equal(stravaDate("garbage"), null);

const csv = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Elevation Gain',
  '1,"Oct 2, 2026, 1:00:00 AM",Night run,Run,1800,5.0,1750,20',
  '2,"Oct 3, 2026, 2:00:00 PM",Ride,Ride,3600,20,3500,100',
].join("\n");
const rows = parseStravaCsv(csv);
assert.equal(rows.length, 1, "rides skipped");
assert.deepEqual([rows[0].date, rows[0].distance_miles, rows[0].pace_seconds, rows[0].elevation_gain_ft], ["2026-10-01", 3.11, 563, 66]);

const tcx = `<TrainingCenterDatabase><Activities><Activity><Lap StartTime="2026-11-10T02:00:00Z">
<TotalTimeSeconds>960</TotalTimeSeconds><DistanceMeters>3218.68</DistanceMeters><AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm>
<Track><Trackpoint><Time>2026-11-10T02:00:00Z</Time><DistanceMeters>0</DistanceMeters><AltitudeMeters>200</AltitudeMeters></Trackpoint>
<Trackpoint><Time>2026-11-10T02:08:00Z</Time><DistanceMeters>1609.34</DistanceMeters><AltitudeMeters>205</AltitudeMeters></Trackpoint>
<Trackpoint><Time>2026-11-10T02:16:00Z</Time><DistanceMeters>3218.68</DistanceMeters><AltitudeMeters>203</AltitudeMeters></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
const t = parseTcx(tcx);
assert.equal(t.date, "2026-11-09", "9 PM local run keeps its local day");
assert.deepEqual([t.distance_miles, t.duration_seconds, t.pace_seconds, t.avg_heart_rate, t.elevation_gain_ft], [2, 960, 480, 150, 16]);
assert.deepEqual(t.splits.map((s) => s.pace_seconds), [480, 480]);
assert.equal(fmtPaceMin(8.5), "8:30/mi");
assert.throws(() => parseTcx("<nothing/>"), /No laps/);
console.log("run files ok");

// real Strava exports have two Distance columns: account units first, meters second
const { splitNewRuns } = await import("../lib/runFiles.js");
const twoCols = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Elevation Gain,Distance',
  '1,"Oct 2, 2026, 1:00:00 AM",Night run,Run,1800,3.11,1750,20,5004.6',
].join("\n");
assert.equal(parseStravaCsv(twoCols)[0].distance_miles, 3.11, "miles account: meters column used, not 3.11 km");

// re-importing the same export skips runs already logged (same date, within 0.05 mi), and dupes inside the file
const logs = [{ date: "2026-10-01", distance_miles: 3.12 }];
const incoming = [
  { date: "2026-10-01", distance_miles: 3.11 },
  { date: "2026-10-01", distance_miles: 1.5 }, // second run same day: new
  { date: "2026-10-03", distance_miles: 4 },
  { date: "2026-10-03", distance_miles: 4.01 },
];
const { fresh, dupes } = splitNewRuns(incoming, logs);
assert.deepEqual(fresh.map((r) => r.distance_miles), [1.5, 4]);
assert.equal(dupes.length, 2);
console.log("strava dedupe ok");

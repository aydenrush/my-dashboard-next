import assert from "node:assert";
const { planRow, workoutFields, planActivity, isRestText } = await import("../lib/runs.js");

const w = "Tempo Run\n- 1 mi warmup\n- 3 mi @ tempo";
assert.deepEqual(workoutFields(w), { title: "Tempo Run", notes: "- 1 mi warmup\n- 3 mi @ tempo" });
assert.equal(planRow({ id: 1, ...workoutFields(w) }).workout, w, "round trip keeps the workout text");
assert.deepEqual(workoutFields("Easy 30 min"), { title: "Easy 30 min", notes: null });
assert.equal(planRow({ title: "Easy 30 min", notes: null }).workout, "Easy 30 min");
assert.deepEqual(workoutFields(""), { title: "Rest Day", notes: null });

const run = planActivity("2026-11-24", "Easy 20 min test run");
assert.deepEqual([run.activity_type, run.time_slot, run.duration_min, run.gcal_event_id, run.completed], ["running", "9:00 PM", 60, "run_plan", false]);
const rest = planActivity("2026-11-25", "Rest Day");
assert.deepEqual([rest.time_slot, rest.duration_min], [null, null]);
assert.ok(isRestText("Cross-train") && isRestText(" rest") && !isRestText("Tempo"));
console.log("runs ok");

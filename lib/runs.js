// Planned runs are activities with activity_type "running". The Running page and Home still think in
// "workout text" (first line = title, rest = details), so these convert between the two.

// same rule the Running page's workoutType() uses: "Rest" or "Cross" anywhere in the first line
export const isRestText = (text) => /rest|cross/i.test((text || "").split("\n")[0]);

// activity row -> plan row with a `workout` string
export function planRow(a) {
  return { ...a, workout: [a.title, a.notes].filter(Boolean).join("\n") };
}

// workout string -> title/notes columns
export function workoutFields(workout) {
  const [title, ...rest] = (workout || "Rest Day").split("\n");
  return { title: title.trim() || "Rest Day", notes: rest.join("\n").trim() || null };
}

// a new plan entry (from the paste/import box)
export function planActivity(date, workout) {
  const rest = isRestText(workout);
  return {
    date, activity_type: "running", ...workoutFields(workout), completed: false, gcal_event_id: "run_plan",
    time_slot: rest ? null : "9:00 PM", duration_min: rest ? null : 60,
  };
}

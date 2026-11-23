import { supabase } from "@/lib/supabase";
import { buildIcs } from "@/lib/ics";

// Uploads training_plan.ics (all activities) to Supabase Storage; phones subscribed to it pick up the change.
export async function publishFeed() {
  const { data, error } = await supabase.from("activities").select("*").order("date");
  if (error) return { error };
  const bytes = new TextEncoder().encode(buildIcs(data));
  return supabase.storage.from("ical").upload("training_plan.ics", bytes, { contentType: "text/calendar", cacheControl: "no-cache", upsert: true });
}

// Call after any change to activities; several quick changes publish once, 1.5s after the last one.
let timer;
export function queuePublish() {
  clearTimeout(timer);
  timer = setTimeout(publishFeed, 1500);
}

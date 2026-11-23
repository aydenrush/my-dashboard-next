import { supabase } from "@/lib/supabase";

// Device settings that should follow you everywhere (weather location, calendar link).
// The Supabase `settings` table is the shared copy; localStorage is a per-device cache so pages load fast.

function readLocal(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch { return raw; } // older versions stored the calendar link as plain text
}

export async function getSetting(key) {
  const local = readLocal(key);
  if (local !== undefined) {
    // one time per device: copy a setting saved before syncing existed up to Supabase
    if (!localStorage.getItem(`${key}__synced`)) {
      const { error } = await supabase.from("settings").upsert({ key, value: local });
      if (!error) localStorage.setItem(`${key}__synced`, "1");
    }
    return local;
  }
  const { data } = await supabase.from("settings").select("value").eq("key", key).limit(1);
  const value = data?.[0]?.value ?? null;
  if (value !== null) { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(`${key}__synced`, "1"); }
  return value;
}

// null clears it everywhere
export async function setSetting(key, value) {
  if (value == null) {
    localStorage.removeItem(key);
    await supabase.from("settings").delete().eq("key", key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
  const { error } = await supabase.from("settings").upsert({ key, value });
  if (!error) localStorage.setItem(`${key}__synced`, "1");
}

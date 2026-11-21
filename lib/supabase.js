import { createClient } from "@supabase/supabase-js";

// every failed Supabase request (read or write, any page) is announced so components/DbStatus.js can show it
async function reportingFetch(...args) {
  const say = (msg) => typeof window !== "undefined" && window.dispatchEvent(new CustomEvent("db-error", { detail: msg }));
  try {
    const res = await fetch(...args);
    if (!res.ok) {
      const body = await res.clone().json().catch(() => ({}));
      say(body.message || body.error || `${res.status} ${res.statusText}`);
    }
    return res;
  } catch (e) {
    say("Can't reach the database. Check your connection.");
    throw e;
  }
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY,
  { global: { fetch: reportingFetch } }
);

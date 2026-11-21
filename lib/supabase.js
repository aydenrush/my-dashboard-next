import { createClient } from "@supabase/supabase-js";

// every Supabase request (read or write, any page) is announced so components/DbStatus.js can show
// a loading bar while any are in flight and a banner when one fails
let inFlight = 0;
const emit = (name, detail) => typeof window !== "undefined" && window.dispatchEvent(new CustomEvent(name, { detail }));

async function reportingFetch(...args) {
  const say = (msg) => emit("db-error", msg);
  emit("db-busy", ++inFlight);
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
  } finally {
    emit("db-busy", --inFlight);
  }
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY,
  { global: { fetch: reportingFetch } }
);

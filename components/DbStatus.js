"use client";
import { useState, useEffect } from "react";

// app-wide loading bar + error banner for Supabase requests (events raised by lib/supabase.js)
export default function DbStatus() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let timer;
    const show = (e) => setMsg(e.detail);
    // wait 150ms before showing the bar so quick saves don't flicker it
    const onBusy = (e) => {
      clearTimeout(timer);
      if (e.detail > 0) timer = setTimeout(() => setBusy(true), 150);
      else setBusy(false);
    };
    window.addEventListener("db-error", show);
    window.addEventListener("db-busy", onBusy);
    return () => { clearTimeout(timer); window.removeEventListener("db-error", show); window.removeEventListener("db-busy", onBusy); };
  }, []);
  return (
    <>
      {busy && <div className="db-busy" role="progressbar" aria-label="Loading" />}
      {msg && (
        <div className="db-status" role="alert">
          <span>Couldn&apos;t save or load data: {msg}</span>
          <button onClick={() => setMsg(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  );
}

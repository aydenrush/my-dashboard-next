"use client";
import { useState, useEffect } from "react";

// app-wide banner for failed Supabase requests (raised by lib/supabase.js)
export default function DbStatus() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    const show = (e) => setMsg(e.detail);
    window.addEventListener("db-error", show);
    return () => window.removeEventListener("db-error", show);
  }, []);
  if (!msg) return null;
  return (
    <div className="db-status" role="alert">
      <span>Couldn&apos;t save or load data: {msg}</span>
      <button onClick={() => setMsg(null)} aria-label="Dismiss">✕</button>
    </div>
  );
}

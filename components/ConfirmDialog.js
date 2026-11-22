"use client";
import { useState, useEffect, useRef } from "react";

// app-styled replacement for window.confirm; opened by askConfirm() in lib/confirm.js.
// Uses <dialog>, so Esc, focus trapping and the backdrop come from the browser. Cancel is focused first.
export default function ConfirmDialog() {
  const [req, setReq] = useState(null);
  const ref = useRef(null);
  const answer = useRef(false);

  useEffect(() => {
    const open = (e) => { answer.current = false; setReq(e.detail); };
    window.addEventListener("ask-confirm", open);
    window.__confirmDialogReady = true;
    return () => { window.removeEventListener("ask-confirm", open); window.__confirmDialogReady = false; };
  }, []);

  useEffect(() => { if (req && !ref.current.open) ref.current.showModal(); }, [req]);

  function close(ok) {
    answer.current = ok;
    ref.current.close(); // fires onClose
  }

  return (
    <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-msg"
      onClose={() => { req?.resolve(answer.current); setReq(null); }}
      onClick={(e) => { if (e.target === ref.current) close(false); }}>
      {req && (
        <div className="confirm-body">
          <p id="confirm-msg">{req.message}</p>
          <div className="confirm-actions">
            <button className="btn" autoFocus onClick={() => close(false)}>Cancel</button>
            <button className="btn confirm-danger" onClick={() => close(true)}>{req.confirmLabel}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

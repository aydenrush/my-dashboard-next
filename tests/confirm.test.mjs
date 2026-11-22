import assert from "node:assert";
const { askConfirm } = await import("../lib/confirm.js");

// dialog mounted: the event carries the message/label and the caller gets the user's answer
globalThis.window = new EventTarget();
window.__confirmDialogReady = true;
let seen;
window.addEventListener("ask-confirm", (e) => { seen = e.detail; e.detail.resolve(e.detail.confirmLabel === "Delete"); });
assert.equal(await askConfirm("Delete this note?"), true);
assert.equal(seen.message, "Delete this note?");
assert.equal(await askConfirm("Start a new term?", { confirmLabel: "Start new term" }), false);

// not mounted yet: falls back to the browser's confirm
window.__confirmDialogReady = false;
window.confirm = (msg) => msg === "ok?";
assert.equal(await askConfirm("ok?"), true);
console.log("confirm ok");

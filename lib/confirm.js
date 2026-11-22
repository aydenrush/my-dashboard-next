// `if (!(await askConfirm("Delete this?"))) return;` shows the app's own confirm dialog
// (components/ConfirmDialog.js, mounted in the layout) and resolves true/false.
export function askConfirm(message, { confirmLabel = "Delete" } = {}) {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!window.__confirmDialogReady) return Promise.resolve(window.confirm(message)); // dialog not mounted yet
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent("ask-confirm", { detail: { message, confirmLabel, resolve } })));
}

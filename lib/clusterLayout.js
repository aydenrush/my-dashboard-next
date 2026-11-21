const STOP = new Set(("the and for are but not you all any can had her was one our out has him his how its may new now old see two who did get got let put say she too use way with that this from they have been were will what when your than then them there their these those which would could should about after again also into just like more most much only over some such very well here want need make know think really thing things gonna dont cant wont im ive its").split(" "));
const COLORS = ["blue", "emerald", "amber", "rose", "violet"];

function words(text) {
  const out = new Set();
  for (let w of text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/'/g, "").match(/[a-z0-9]{3,}/g) || []) {
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1); // runs -> run
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

// shortcut: groups by shared words only, so "jog" and "run" don't match; swap in an AI/embedding call if that matters
export function clusterByKeyword(notes) {
  const sets = notes.map((n) => ({ id: n.id, w: words(n.content || "") }));
  const left = new Set(sets.map((s) => s.id));
  const clusters = [];
  while (clusters.length < COLORS.length) {
    const count = {};
    for (const s of sets) if (left.has(s.id)) for (const w of s.w) count[w] = (count[w] || 0) + 1;
    const [best, n] = Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
    if (!best || n < 2) break;
    const ids = sets.filter((s) => left.has(s.id) && s.w.has(best)).map((s) => s.id);
    ids.forEach((id) => left.delete(id));
    clusters.push({ theme: best, color: COLORS[clusters.length], note_ids: ids });
  }
  if (left.size) clusters.push({ theme: "Other", color: "slate", note_ids: [...left] });
  return clusters;
}

// shortcut: fixed cell size, so very tall notes can overlap the next row; measure heights client-side if that bites
export function layout(clusters, { cellW = 260, cellH = 180, gap = 120, cols = 2 } = {}) {
  const perRow = Math.ceil(Math.sqrt(clusters.length));
  const blockW = cols * cellW + gap;
  let y = 0, rowH = 0;
  const out = [];
  clusters.forEach((c, k) => {
    if (k && k % perRow === 0) { y += rowH + gap; rowH = 0; }
    const x0 = (k % perRow) * blockW;
    c.note_ids.forEach((id, i) => out.push({ id, color: c.color, x: x0 + (i % cols) * cellW, y: y + Math.floor(i / cols) * cellH }));
    rowH = Math.max(rowH, Math.ceil(c.note_ids.length / cols) * cellH);
  });
  return out;
}

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

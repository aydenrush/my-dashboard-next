export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) return Response.json({ error: "url param required" }, { status: 400 });

  try {
    const resp = await fetch(url, { next: { revalidate: 300 } });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const text = await resp.text();
    const events = parseIcal(text);
    return Response.json(events);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function parseIcal(text) {
  const events = [];
  const lines = unfold(text).split("\n");
  let ev = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) { ev = {}; continue; }
    if (line.startsWith("END:VEVENT") && ev) { events.push(ev); ev = null; continue; }
    if (!ev) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1).trim();
    const key = keyPart.split(";")[0];

    if (key === "SUMMARY") ev.summary = unescapeIcal(val);
    else if (key === "DTSTART") ev.start = parseIcalDate(val, keyPart);
    else if (key === "DTEND") ev.end = parseIcalDate(val, keyPart);
    else if (key === "LOCATION") ev.location = unescapeIcal(val);
    else if (key === "DESCRIPTION") ev.description = unescapeIcal(val).slice(0, 200);
  }
  return events.filter((e) => e.summary && e.start);
}

function unfold(text) {
  return text.replace(/\r\n /g, "").replace(/\r\n\t/g, "").replace(/\r/g, "");
}

function unescapeIcal(s) {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\").replace(/\\;/g, ";");
}

function parseIcalDate(val, keyPart) {
  const isDate = keyPart.includes("VALUE=DATE");
  if (isDate || /^\d{8}$/.test(val)) {
    return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
  }
  // 20261001T143000Z or 20261001T143000
  const y = val.slice(0, 4), m = val.slice(4, 6), d = val.slice(6, 8);
  const hh = val.slice(9, 11), mm = val.slice(11, 13);
  if (val.endsWith("Z")) {
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:00Z`).toISOString();
  }
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

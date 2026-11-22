import { parseIcal } from "@/lib/ical";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) return Response.json({ error: "url param required" }, { status: 400 });
  // only Google Calendar feeds, so this route can't be used to fetch arbitrary URLs
  let parsed;
  try { parsed = new URL(url); } catch { return Response.json({ error: "invalid url" }, { status: 400 }); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "calendar.google.com") {
    return Response.json({ error: "only https://calendar.google.com links are allowed" }, { status: 400 });
  }

  try {
    const resp = await fetch(url, { next: { revalidate: 300 } });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    return Response.json(parseIcal(await resp.text()));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

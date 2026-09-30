export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const days = searchParams.get("days") || "3";

  if (!lat || !lon) {
    return Response.json({ error: "lat and lon required" }, { status: 400 });
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dewpoint_2m,precipitation_probability` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=${days}`;

  const resp = await fetch(url, { next: { revalidate: 600 } });
  if (!resp.ok) {
    return Response.json({ error: "Weather API failed" }, { status: 502 });
  }
  const data = await resp.json();
  return Response.json(data);
}

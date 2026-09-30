export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city");

  if (!city) {
    return Response.json({ error: "city required" }, { status: 400 });
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) {
    return Response.json({ error: "Geocoding failed" }, { status: 502 });
  }
  const data = await resp.json();
  const result = data.results?.[0];
  if (!result) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }
  return Response.json({
    lat: result.latitude,
    lon: result.longitude,
    city: result.name,
  });
}

"use client";
import { useState, useEffect, useCallback } from "react";
import { fmtHour, weatherCategory, bestRunHour, bestOutdoorHour } from "@/lib/weather";

export default function WeatherPage() {
  const [location, setLocation] = useState(null);
  const [cityInput, setCityInput] = useState("");
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deadline, setDeadline] = useState(22);

  // load saved location
  useEffect(() => {
    const saved = localStorage.getItem("weather_location");
    if (saved) {
      const loc = JSON.parse(saved);
      setLocation(loc);
      setCityInput(loc.city);
    }
  }, []);

  const fetchWeather = useCallback(async (loc) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/weather?lat=${loc.lat}&lon=${loc.lon}&days=3`);
      if (!resp.ok) throw new Error("Failed to fetch weather");
      const data = await resp.json();
      setWeather(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (location) fetchWeather(location);
  }, [location, fetchWeather]);

  async function handleSetLocation() {
    if (!cityInput.trim()) return;
    try {
      const resp = await fetch(`/api/geocode?city=${encodeURIComponent(cityInput.trim())}`);
      if (!resp.ok) {
        setError("City not found");
        return;
      }
      const loc = await resp.json();
      setLocation(loc);
      localStorage.setItem("weather_location", JSON.stringify(loc));
    } catch (e) {
      setError(e.message);
    }
  }

  const nowHour = new Date().getHours();

  if (!location) {
    return (
      <div>
        <h1 className="page-title">Weather</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <div>
            <label className="metric-label">City</label>
            <input
              type="text"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder="e.g. West Lafayette"
              onKeyDown={(e) => e.key === "Enter" && handleSetLocation()}
            />
          </div>
          <button className="btn btn-primary" onClick={handleSetLocation}>Set Location</button>
        </div>
        {error && <p className="alert alert-error" style={{ marginTop: "1rem" }}>{error}</p>}
      </div>
    );
  }

  if (loading || !weather) {
    return (
      <div>
        <h1 className="page-title">Weather</h1>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  const hours = weather.hourly;
  const temps = hours.temperature_2m;
  const apparent = hours.apparent_temperature || temps;
  const humids = hours.relative_humidity_2m;
  const dewpoint = hours.dewpoint_2m || Array(temps.length).fill(null);
  const precip = hours.precipitation_probability || Array(temps.length).fill(0);

  const cur = {
    temp: temps[nowHour],
    feels: apparent[nowHour],
    humid: humids[nowHour],
    dp: dewpoint[nowHour],
    precip: precip[nowHour] ?? 0,
    cat: weatherCategory(apparent[nowHour]),
  };

  const bestOut = bestOutdoorHour(temps, humids, precip, nowHour, { apparent });
  const bestRun = bestRunHour(temps, humids, precip, nowHour, { apparent, dewpoint });
  const customRun = bestRunHour(temps, humids, precip, nowHour, { deadline, apparent, dewpoint });

  const highDpHours = [];
  for (let i = nowHour; i < Math.min(24, dewpoint.length); i++) {
    if (dewpoint[i] != null && dewpoint[i] >= 65) highDpHours.push(i);
  }

  // 3-day summary
  const daySummaries = [];
  const now = new Date();
  for (let d = 0; d < 3; d++) {
    const start = d * 24;
    const end = Math.min((d + 1) * 24, temps.length);
    if (start >= temps.length) break;
    const dTemps = temps.slice(start, end);
    const dFeels = apparent.slice(start, end);
    const dHumids = humids.slice(start, end);
    const dPrecip = precip.slice(start, end);
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() + d);
    daySummaries.push({
      date: dayDate.toLocaleDateString("en-US", { weekday: "long", month: "numeric", day: "numeric" }),
      high: Math.max(...dTemps),
      low: Math.min(...dTemps),
      feelsHigh: Math.max(...dFeels),
      feelsLow: Math.min(...dFeels),
      avgHumid: Math.round(dHumids.reduce((a, b) => a + b, 0) / dHumids.length),
      maxRain: Math.max(...dPrecip),
      cat: weatherCategory((Math.max(...dFeels) + Math.min(...dFeels)) / 2),
    });
  }

  return (
    <div>
      <h1 className="page-title">Weather</h1>

      {/* location bar */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "end", marginBottom: "1.5rem" }}>
        <div>
          <label className="metric-label">City</label>
          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSetLocation()}
          />
        </div>
        <button className="btn" onClick={handleSetLocation}>Set Location</button>
        <button className="btn" onClick={() => fetchWeather(location)}>Refresh</button>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      {/* current conditions */}
      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Now in {location.city}</h2>
      <div className="metrics-row">
        <div className="metric">
          <div className="metric-label">Temperature</div>
          <div className="metric-value">{cur.temp?.toFixed(0)}°F</div>
        </div>
        <div className="metric">
          <div className="metric-label">Feels Like</div>
          <div className="metric-value">{cur.feels?.toFixed(0)}°F</div>
        </div>
        <div className="metric">
          <div className="metric-label">Dew Point</div>
          <div className="metric-value">{cur.dp != null ? `${cur.dp.toFixed(0)}°F` : "—"}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Humidity</div>
          <div className="metric-value">{cur.humid}%</div>
        </div>
        <div className="metric">
          <div className="metric-label">Rain Chance</div>
          <div className="metric-value">{cur.precip}%</div>
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Dress for: <strong>{cur.cat}</strong></p>

      <hr className="divider" />

      {/* best times */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {bestOut != null && (
          <div className="alert alert-info" style={{ flex: 1 }}>
            Best time to go out: <strong>{fmtHour(bestOut)}</strong> — {temps[bestOut]?.toFixed(0)}°F
            {Math.abs(apparent[bestOut] - temps[bestOut]) >= 2 ? ` (feels ${apparent[bestOut]?.toFixed(0)}°F)` : ""}
            , {humids[bestOut]}% humidity
          </div>
        )}
        {bestRun != null && (
          <div className="alert alert-success" style={{ flex: 1 }}>
            Best time to run: <strong>{fmtHour(bestRun)}</strong> — {temps[bestRun]?.toFixed(0)}°F
            {Math.abs(apparent[bestRun] - temps[bestRun]) >= 2 ? ` (feels ${apparent[bestRun]?.toFixed(0)}°F)` : ""}
            {dewpoint[bestRun] != null ? `, dew point ${dewpoint[bestRun]?.toFixed(0)}°F` : ""}
            {precip[bestRun] > 0 ? `, ${precip[bestRun]}% rain` : ""}
          </div>
        )}
      </div>

      {/* deadline slider */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          I won&apos;t run later than: <strong>{fmtHour(deadline)}</strong>
        </label>
        <input
          type="range"
          min={17}
          max={23}
          value={deadline}
          onChange={(e) => setDeadline(Number(e.target.value))}
          style={{ width: "100%", marginTop: "0.25rem" }}
        />
      </div>
      {customRun != null && customRun !== bestRun && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          With that cutoff: best run time is {fmtHour(customRun)} — {temps[customRun]?.toFixed(0)}°F
          {Math.abs(apparent[customRun] - temps[customRun]) >= 2 ? ` (feels ${apparent[customRun]?.toFixed(0)}°F)` : ""}
          {dewpoint[customRun] != null ? `, dew point ${dewpoint[customRun]?.toFixed(0)}°F` : ""}
        </p>
      )}

      {highDpHours.length > 0 && (
        <div className="alert alert-warning">
          {dewpoint[highDpHours[0]] >= 70 ? "Oppressive" : "Uncomfortable"} dew point (
          {dewpoint[highDpHours[0]]?.toFixed(0)}°F) starting around {fmtHour(highDpHours[0])} — consider an easy effort
        </div>
      )}

      <hr className="divider" />

      {/* today hourly */}
      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Today — Hourly</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Hour</th>
              <th>Temp</th>
              <th>Feels</th>
              <th>Humidity</th>
              <th>Dew Pt</th>
              <th>Rain</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(24, temps.length) }, (_, i) => (
              <tr key={i} style={i === nowHour ? { fontWeight: 600 } : undefined}>
                <td>{fmtHour(i)}</td>
                <td>{temps[i]?.toFixed(0)}°</td>
                <td>{apparent[i]?.toFixed(0)}°</td>
                <td>{humids[i]}%</td>
                <td>{dewpoint[i] != null ? `${dewpoint[i].toFixed(0)}°` : "—"}</td>
                <td>{precip[i] ?? 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <hr className="divider" />

      {/* 3-day forecast */}
      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>3-Day Forecast</h2>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {daySummaries.map((d) => (
          <div key={d.date} className="card" style={{ flex: 1, minWidth: "200px" }}>
            <strong>{d.date}</strong>
            <div className="metric-value" style={{ margin: "0.5rem 0" }}>
              {d.high.toFixed(0)}° / {d.low.toFixed(0)}°
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Feels like: {d.feelsHigh.toFixed(0)}° / {d.feelsLow.toFixed(0)}°
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Humidity avg: {d.avgHumid}%</p>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Max rain chance: {d.maxRain}%</p>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Dress for: {d.cat}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

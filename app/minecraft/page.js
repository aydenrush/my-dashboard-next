"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const SEED = "7338286372832099621";
const CHUNKBASE_URL = "https://www.chunkbase.com/apps/seed-map#seed=7338286372832099621&platform=bedrock_26_0&dimension=overworld&x=895&z=-7&zoom=0.927";
const DIM_COLORS = { overworld: "#4CAF50", nether: "#F44336", end: "#9C27B0" };
const DIM_BG = { overworld: "rgba(76,175,80,0.08)", nether: "rgba(244,67,54,0.08)", end: "rgba(156,39,176,0.08)" };
const DIM_ICONS = { overworld: "🌳", nether: "🔥", end: "⭐" };

export default function MinecraftPage() {
  const [coords, setCoords] = useState([]);
  const [label, setLabel] = useState("");
  const [x, setX] = useState("");
  const [z, setZ] = useState("");
  const [dimension, setDimension] = useState("overworld");

  async function load() {
    const { data } = await supabase.from("minecraft_coords").select("*").order("created_at");
    setCoords((data || []).filter((c) => c.label !== "__seed__"));
  }

  useEffect(() => { load(); }, []);

  async function addCoord(e) {
    e.preventDefault();
    if (!label.trim()) return;
    await supabase.from("minecraft_coords").insert({
      label: label.trim(), x: x.trim(), z: z.trim(), dimension,
    });
    setLabel(""); setX(""); setZ("");
    load();
  }

  async function deleteCoord(id) {
    await supabase.from("minecraft_coords").delete().eq("id", id);
    load();
  }

  async function convertCoord(row) {
    const ix = parseInt(row.x), iz = parseInt(row.z);
    if (isNaN(ix) || isNaN(iz)) return;
    const target = row.dimension === "overworld" ? "nether" : "overworld";
    const nx = row.dimension === "overworld" ? Math.round(ix / 8) : ix * 8;
    const nz = row.dimension === "overworld" ? Math.round(iz / 8) : iz * 8;
    await supabase.from("minecraft_coords").insert({
      label: row.label, x: String(nx), z: String(nz), dimension: target,
    });
    load();
  }

  function getConvert(row) {
    const ix = parseInt(row.x), iz = parseInt(row.z);
    if (isNaN(ix) || isNaN(iz)) return null;
    if (row.dimension === "nether") return { label: "Overworld", x: ix * 8, z: iz * 8 };
    if (row.dimension === "overworld") return { label: "Nether", x: Math.round(ix / 8), z: Math.round(iz / 8) };
    return null;
  }

  return (
    <div>
      <h1 className="page-title">Minecraft</h1>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Important Coordinates</h2>

      {coords.length === 0 && <p className="alert alert-info">No coordinates saved yet. Add one below.</p>}

      {["overworld", "nether", "end"].map((dim) => {
        const dimCoords = coords.filter((c) => (c.dimension || "").toLowerCase() === dim);
        if (dimCoords.length === 0) return null;
        return dimCoords.map((row) => {
          const conv = getConvert(row);
          const negX = String(row.x).startsWith("-");
          const negZ = String(row.z).startsWith("-");
          return (
            <div
              key={row.id}
              style={{
                borderLeft: `4px solid ${DIM_COLORS[dim]}`,
                background: DIM_BG[dim],
                borderRadius: "8px",
                padding: "12px 16px",
                marginBottom: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <span style={{ fontWeight: 700, color: DIM_COLORS[dim], minWidth: "140px" }}>
                {DIM_ICONS[dim]} {row.label}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: "0.95rem", minWidth: "120px" }}>
                X: <span style={{ color: negX ? "#ef5350" : "inherit" }}>{row.x}</span>
                {" "}
                Z: <span style={{ color: negZ ? "#ef5350" : "inherit" }}>{row.z}</span>
              </span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", opacity: 0.7 }}>
                {dim}
              </span>
              {conv && (
                <span style={{ fontSize: "0.8rem", opacity: 0.5, fontStyle: "italic" }}>
                  {conv.label}: ~{conv.x}, ~{conv.z}
                </span>
              )}
              <div style={{ display: "flex", gap: "4px" }}>
                {(dim === "overworld" || dim === "nether") && (
                  <button
                    className="btn"
                    onClick={() => convertCoord(row)}
                    title={`Copy to ${dim === "overworld" ? "Nether" : "Overworld"}`}
                    style={{ padding: "4px 8px" }}
                  >
                    {DIM_ICONS[dim === "overworld" ? "nether" : "overworld"]}
                  </button>
                )}
                <button className="btn" onClick={() => deleteCoord(row.id)} style={{ padding: "4px 8px" }}>🗑</button>
              </div>
            </div>
          );
        });
      })}

      <hr className="divider" />

      <form onSubmit={addCoord} style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Add Coordinate</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" style={{ flex: 2 }} />
          <input type="text" value={x} onChange={(e) => setX(e.target.value)} placeholder="X" style={{ flex: 1 }} />
          <input type="text" value={z} onChange={(e) => setZ(e.target.value)} placeholder="Z" style={{ flex: 1 }} />
          <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
            <option value="overworld">Overworld</option>
            <option value="nether">Nether</option>
            <option value="end">End</option>
          </select>
          <button type="submit" className="btn btn-primary">Add</button>
        </div>
      </form>

      <hr className="divider" />

      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.6, fontSize: "0.85rem" }}>Seed: <code>{SEED}</code></span>
        <a
          href={CHUNKBASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            background: "linear-gradient(135deg,#2d7d32,#66bb6a)",
            color: "white", padding: "6px 16px", borderRadius: "6px",
            textDecoration: "none", fontWeight: 600, fontSize: "0.85rem",
          }}
        >
          🗺 Chunkbase
        </a>
      </div>
    </div>
  );
}

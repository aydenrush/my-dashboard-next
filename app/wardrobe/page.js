"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];
const WEATHER_TAGS = ["Hot (85+)", "Warm (70-85)", "Mild (55-70)", "Cool (40-55)", "Cold (<40)"];

function hexToHsl(hex) {
  const h = hex.replace("#", "");
  let r = parseInt(h.substring(0, 2), 16) / 255;
  let g = parseInt(h.substring(2, 4), 16) / 255;
  let b = parseInt(h.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0, light = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  return [hue * 360, sat * 100, light * 100];
}

function colorName(h, s, l) {
  if (s < 10) {
    if (l > 85) return "White";
    if (l < 15) return "Black";
    return "Gray";
  }
  if (l < 12) return "Black";
  if (l > 90) return "White";
  const names = [[0,"Red"],[15,"Red-Orange"],[30,"Orange"],[45,"Gold"],[55,"Yellow"],[75,"Yellow-Green"],[100,"Lime"],[130,"Green"],[160,"Teal"],[185,"Cyan"],[210,"Blue"],[240,"Indigo"],[265,"Violet"],[285,"Purple"],[310,"Magenta"],[335,"Pink"],[350,"Rose"],[360,"Red"]];
  let name = "Red";
  for (let i = 0; i < names.length - 1; i++) {
    if (h < names[i + 1][0]) { name = names[i][1]; break; }
  }
  if (l < 30) return `Dark ${name}`;
  if (l > 70) return `Light ${name}`;
  return name;
}

function colorsCompatible(c1, c2) {
  const [h1, s1, l1] = hexToHsl(c1);
  const [h2, s2, l2] = hexToHsl(c2);
  if (s1 < 12 || l1 < 12 || l1 > 88) return true;
  if (s2 < 12 || l2 < 12 || l2 > 88) return true;
  const hueDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
  if (hueDiff < 40) return true;
  if (hueDiff > 150 && hueDiff < 210) return true;
  if ((hueDiff > 100 && hueDiff < 140) || (hueDiff > 220 && hueDiff < 260)) return true;
  return false;
}

export default function WardrobePage() {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState("Tops");
  const [showAdd, setShowAdd] = useState(false);
  const [showOutfit, setShowOutfit] = useState(false);
  const [form, setForm] = useState({ name: "", category: "Tops", colors: ["#333333"], weather_tags: [], is_layer: false });
  const [outfit, setOutfit] = useState({});

  async function load() {
    const { data } = await supabase.from("wardrobe_items").select("*").order("created_at");
    setItems(data || []);
  }

  useEffect(() => { load(); }, []);

  const byCategory = items.filter((i) => i.category === category);

  async function addItem(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await supabase.from("wardrobe_items").insert({
      name: form.name.trim(), category: form.category,
      colors: form.colors.filter((c) => c), weather_tags: form.weather_tags,
      is_layer: form.is_layer,
    });
    setForm({ name: "", category: form.category, colors: ["#333333"], weather_tags: [], is_layer: false });
    load();
  }

  async function deleteItem(id) {
    await supabase.from("wardrobe_items").delete().eq("id", id);
    load();
  }

  function toggleOutfitItem(cat, item) {
    setOutfit((prev) => {
      const current = prev[cat];
      if (current?.id === item.id) {
        const next = { ...prev };
        delete next[cat];
        return next;
      }
      return { ...prev, [cat]: item };
    });
  }

  const outfitItems = Object.values(outfit);
  const outfitColors = outfitItems.flatMap((i) => (i.colors || []));
  let compatCount = 0, totalPairs = 0;
  for (let i = 0; i < outfitColors.length; i++) {
    for (let j = i + 1; j < outfitColors.length; j++) {
      totalPairs++;
      if (colorsCompatible(outfitColors[i], outfitColors[j])) compatCount++;
    }
  }
  const compatPct = totalPairs > 0 ? Math.round((compatCount / totalPairs) * 100) : 100;

  return (
    <div>
      <h1 className="page-title">Wardrobe</h1>

      <div className="metrics-row" style={{ marginBottom: "1rem" }}>
        {CATEGORIES.map((cat) => {
          const count = items.filter((i) => i.category === cat).length;
          return (
            <div key={cat} className="metric" style={{ cursor: "pointer", opacity: category === cat ? 1 : 0.6 }} onClick={() => setCategory(cat)}>
              <div className="metric-label">{cat}</div>
              <div className="metric-value">{count}</div>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>{category}</h2>
      {byCategory.length === 0 && <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No {category.toLowerCase()} added yet.</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "1rem" }}>
        {byCategory.map((item) => {
          const colors = item.colors || [];
          const isSelected = outfit[category]?.id === item.id;
          return (
            <div
              key={item.id}
              style={{
                border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: "8px", padding: "10px 14px", minWidth: "140px",
                background: isSelected ? "rgba(33,150,243,0.08)" : "var(--card-bg)",
                cursor: showOutfit ? "pointer" : "default",
              }}
              onClick={() => showOutfit && toggleOutfitItem(category, item)}
            >
              <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "4px" }}>{item.name}</div>
              <div style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                {colors.map((c, i) => {
                  const [h, s, l] = hexToHsl(c);
                  return (
                    <div key={i} title={colorName(h, s, l)} style={{
                      width: "20px", height: "20px", borderRadius: "4px",
                      background: c, border: "1px solid rgba(128,128,128,0.3)",
                    }} />
                  );
                })}
              </div>
              {item.weather_tags?.length > 0 && (
                <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{item.weather_tags.join(", ")}</div>
              )}
              {item.is_layer && <span style={{ fontSize: "0.7rem", color: "var(--accent)" }}>Layer</span>}
              {!showOutfit && (
                <button className="btn" onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }} style={{ padding: "2px 6px", fontSize: "0.7rem", marginTop: "4px" }}>Del</button>
              )}
            </div>
          );
        })}
      </div>

      <hr className="divider" />

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button className={`btn ${showOutfit ? "btn-primary" : ""}`} onClick={() => { setShowOutfit(!showOutfit); setOutfit({}); }}>
          {showOutfit ? "Exit Outfit Builder" : "Build Outfit"}
        </button>
        <button className={`btn ${showAdd ? "btn-primary" : ""}`} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Close" : "Add Item"}
        </button>
      </div>

      {showOutfit && outfitItems.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Your Outfit</h3>
          {outfitItems.map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{item.category}:</span>
              <span style={{ fontSize: "0.85rem" }}>{item.name}</span>
              {(item.colors || []).map((c, i) => (
                <div key={i} style={{ width: "14px", height: "14px", borderRadius: "3px", background: c, border: "1px solid rgba(128,128,128,0.3)" }} />
              ))}
            </div>
          ))}
          <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            Color compatibility: <strong style={{ color: compatPct >= 80 ? "#4CAF50" : compatPct >= 50 ? "#FF9800" : "#F44336" }}>{compatPct}%</strong>
          </p>
        </div>
      )}

      {showAdd && (
        <form onSubmit={addItem} style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Item name" style={{ flex: 2 }} />
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem" }}>Colors:</span>
            {form.colors.map((c, i) => (
              <input key={i} type="color" value={c} onChange={(e) => {
                const newColors = [...form.colors];
                newColors[i] = e.target.value;
                setForm((f) => ({ ...f, colors: newColors }));
              }} style={{ width: "36px", height: "36px", padding: 0, border: "none", cursor: "pointer" }} />
            ))}
            {form.colors.length < 4 && (
              <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, colors: [...f.colors, "#666666"] }))} style={{ padding: "4px 8px" }}>+</button>
            )}
            {form.colors.length > 1 && (
              <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, colors: f.colors.slice(0, -1) }))} style={{ padding: "4px 8px" }}>-</button>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            {WEATHER_TAGS.map((tag) => (
              <label key={tag} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem" }}>
                <input type="checkbox" checked={form.weather_tags.includes(tag)}
                  onChange={(e) => {
                    setForm((f) => ({
                      ...f,
                      weather_tags: e.target.checked
                        ? [...f.weather_tags, tag]
                        : f.weather_tags.filter((t) => t !== tag),
                    }));
                  }} />
                {tag}
              </label>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            <input type="checkbox" checked={form.is_layer} onChange={(e) => setForm((f) => ({ ...f, is_layer: e.target.checked }))} />
            Can be layered
          </label>
          <button type="submit" className="btn btn-primary">Add Item</button>
        </form>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { ROUND_ORDER, ageFromClass } from "@/lib/constants";

export default function CFBDynastyPage() {
  const [games, setGames] = useState({});
  const [selectedGame, setSelectedGame] = useState("");
  const [picks, setPicks] = useState([]);
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [tab, setTab] = useState("roster");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [form, setForm] = useState({ school: "", year: 2027, name: "", position: "", class: "", round: "1st", height: "", weight: 200, number: "", notes: "" });
  const [bulkSchool, setBulkSchool] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterRound, setFilterRound] = useState("");
  const [filterYear, setFilterYear] = useState("");

  async function loadGames() {
    const { data } = await supabase.from("game_registry").select("*").eq("game_type", "cfb").order("game_name");
    const g = {};
    (data || []).forEach((r) => { g[r.game_name] = r.prefix; });
    setGames(g);
    const names = Object.keys(g);
    if (names.length > 0 && !selectedGame) setSelectedGame(names[0]);
  }

  async function loadPicks() {
    if (!selectedGame || !games[selectedGame]) return;
    const table = `${games[selectedGame]}_draft_picks`;
    const { data } = await supabase.from(table).select("*").order("year");
    const d = data || [];
    setPicks(d);
    const s = [...new Set(d.map((p) => p.school).filter(Boolean))].sort();
    setSchools(s);
    if (s.length > 0 && !s.includes(selectedSchool)) setSelectedSchool(s[0]);
  }

  useEffect(() => { loadGames(); }, []);
  useEffect(() => { if (selectedGame) loadPicks(); }, [selectedGame, games]);

  const table = selectedGame && games[selectedGame] ? `${games[selectedGame]}_draft_picks` : null;
  const schoolPicks = picks.filter((p) => p.school === selectedSchool);
  let filtered = schoolPicks;
  if (filterPos) filtered = filtered.filter((p) => p.position === filterPos);
  if (filterRound) filtered = filtered.filter((p) => p.round === filterRound);
  if (filterYear) filtered = filtered.filter((p) => String(p.year) === filterYear);

  const positions = [...new Set(schoolPicks.map((p) => p.position).filter(Boolean))].sort();
  const rounds = [...new Set(schoolPicks.map((p) => p.round).filter(Boolean))];
  const years = [...new Set(schoolPicks.map((p) => p.year).filter(Boolean))].sort();

  const firstRd = schoolPicks.filter((p) => p.round === "1st");
  const top3 = schoolPicks.filter((p) => ["1st", "2nd", "3rd"].includes(p.round));
  const yearsActive = new Set(schoolPicks.map((p) => p.year)).size;

  async function addPick(e) {
    e.preventDefault();
    if (!form.name.trim() || !table) return;
    const calcAge = ageFromClass(form.class);
    await supabase.from(table).insert({
      school: form.school || selectedSchool, year: form.year, name: form.name.trim(),
      position: form.position || null, class: form.class || null, round: form.round,
      draft_age: calcAge, height: form.height || null,
      weight: form.weight > 0 ? form.weight : null, number: form.number || null,
      additional_notes: form.notes || null,
    });
    setForm((f) => ({ ...f, name: "", position: "", class: "", height: "", number: "", notes: "" }));
    loadPicks();
  }

  async function deletePick(id) {
    if (!table) return;
    await supabase.from(table).delete().eq("id", id);
    loadPicks();
  }

  async function bulkUpload() {
    if (!bulkText.trim() || !table) return;
    const rows = bulkText.trim().split("\n").map((line) => {
      const c = line.split("\t");
      let yr = null; try { yr = parseInt(c[0]); } catch {}
      let wt = null; try { wt = parseFloat((c[6] || "").replace("lbs", "")); } catch {}
      let age = null; try { age = parseInt(c[4]); } catch {}
      if (!age) age = ageFromClass(c[3]);
      return {
        school: bulkSchool || selectedSchool, year: yr, name: (c[1] || "").trim(),
        position: (c[2] || "").trim() || null, class: (c[3] || "").trim() || null,
        draft_age: age, height: (c[5] || "").trim() || null, weight: wt,
        number: (c[7] || "").replace("#", "").trim() || null,
        race: (c[8] || "").trim() || null, round: (c[9] || "").trim() || null,
        additional_notes: (c[10] || "").trim() || null,
      };
    }).filter((r) => r.name);
    if (rows.length > 0) {
      await supabase.from(table).insert(rows);
      setBulkText("");
      loadPicks();
    }
  }

  function analyticsByYear() {
    const byYear = {};
    schoolPicks.forEach((p) => { byYear[p.year] = (byYear[p.year] || 0) + 1; });
    return Object.entries(byYear).sort((a, b) => a[0] - b[0]);
  }

  function analyticsByRound() {
    const byRound = {};
    schoolPicks.forEach((p) => { if (p.round) byRound[p.round] = (byRound[p.round] || 0) + 1; });
    return ROUND_ORDER.map((r) => [r, byRound[r] || 0]).filter(([, c]) => c > 0);
  }

  function analyticsByPos() {
    const byPos = {};
    schoolPicks.forEach((p) => { if (p.position) byPos[p.position] = (byPos[p.position] || 0) + 1; });
    return Object.entries(byPos).sort((a, b) => b[1] - a[1]);
  }

  const maxBarCount = (data) => Math.max(...data.map((d) => d[1]), 1);

  const gameNames = Object.keys(games);

  return (
    <div>
      <h1 className="page-title">CFB Dynasty</h1>

      {gameNames.length === 0 && <p className="alert alert-info">No CFB games found. Add one in game_registry.</p>}

      {gameNames.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {gameNames.map((g) => (
              <button key={g} className={`btn ${g === selectedGame ? "btn-primary" : ""}`} onClick={() => setSelectedGame(g)}>{g}</button>
            ))}
          </div>

          {schools.length > 0 && (
            <select value={selectedSchool} onChange={(e) => setSelectedSchool(e.target.value)} style={{ marginBottom: "1rem" }}>
              {schools.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {schoolPicks.length > 0 && (
            <>
              <div className="metrics-row">
                <div className="metric"><div className="metric-label">Total Picks</div><div className="metric-value">{schoolPicks.length}</div></div>
                <div className="metric"><div className="metric-label">1st Rounders</div><div className="metric-value">{firstRd.length}</div></div>
                <div className="metric"><div className="metric-label">Top 3 Rounds</div><div className="metric-value">{top3.length}</div></div>
                <div className="metric"><div className="metric-label">Draft Classes</div><div className="metric-value">{yearsActive}</div></div>
                {yearsActive > 0 && <div className="metric"><div className="metric-label">Avg/Year</div><div className="metric-value">{(schoolPicks.length / yearsActive).toFixed(1)}</div></div>}
              </div>

              <hr className="divider" />

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                <select value={filterPos} onChange={(e) => setFilterPos(e.target.value)}>
                  <option value="">All Positions</option>
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={filterRound} onChange={(e) => setFilterRound(e.target.value)}>
                  <option value="">All Rounds</option>
                  {rounds.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                  <option value="">All Years</option>
                  {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                {["roster", "byYear", "byRound", "byPos"].map((t) => (
                  <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
                    {t === "roster" ? "Roster" : t === "byYear" ? "By Year" : t === "byRound" ? "By Round" : "By Position"}
                  </button>
                ))}
              </div>

              {tab === "roster" && (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>Year</th><th>Name</th><th>Pos</th><th>Class</th><th>Age</th>
                      <th>Ht</th><th>Wt</th><th>#</th><th>Round</th><th>Notes</th><th></th>
                    </tr></thead>
                    <tbody>
                      {filtered.map((p) => (
                        <tr key={p.id}>
                          <td>{p.year}</td><td>{p.name}</td><td>{p.position}</td><td>{p.class}</td>
                          <td>{p.draft_age}</td><td>{p.height}</td><td>{p.weight}</td>
                          <td>{p.number}</td><td>{p.round}</td><td>{p.additional_notes}</td>
                          <td><button className="btn" onClick={() => deletePick(p.id)} style={{ padding: "2px 6px" }}>Del</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "byYear" && (() => {
                const data = analyticsByYear();
                const max = maxBarCount(data);
                return (
                  <div>
                    {data.map(([year, count]) => (
                      <div key={year} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ minWidth: "50px", fontSize: "0.85rem" }}>{year}</span>
                        <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
                          <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                        </div>
                        <span style={{ minWidth: "24px", fontSize: "0.85rem" }}>{count}</span>
                      </div>
                    ))}
                    {firstRd.length > 0 && (
                      <>
                        <p style={{ fontWeight: 600, marginTop: "1rem" }}>1st Round Picks</p>
                        {[...firstRd].sort((a, b) => b.year - a.year).map((p) => (
                          <p key={p.id} style={{ fontSize: "0.85rem", margin: "2px 0" }}>{p.year} — {p.name} ({p.position})</p>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}

              {tab === "byRound" && (() => {
                const data = analyticsByRound();
                const max = maxBarCount(data);
                return (
                  <div>
                    {data.map(([round, count]) => (
                      <div key={round} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ minWidth: "50px", fontSize: "0.85rem" }}>{round}</span>
                        <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
                          <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                        </div>
                        <span style={{ minWidth: "24px", fontSize: "0.85rem" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {tab === "byPos" && (() => {
                const data = analyticsByPos();
                const max = maxBarCount(data);
                return (
                  <div>
                    {data.map(([pos, count]) => (
                      <div key={pos} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ minWidth: "60px", fontSize: "0.85rem" }}>{pos}</span>
                        <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
                          <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                        </div>
                        <span style={{ minWidth: "24px", fontSize: "0.85rem" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {picks.length === 0 && <p className="alert alert-info">No picks yet. Add some below.</p>}

          <hr className="divider" />

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Add Pick</summary>
            <form onSubmit={addPick}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <input type="text" value={form.school || selectedSchool} onChange={(e) => setForm((f) => ({ ...f, school: e.target.value }))} placeholder="School" style={{ flex: 1 }} />
                <input type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))} style={{ width: "80px" }} />
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Player Name" style={{ flex: 2 }} />
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <input type="text" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder="Position" style={{ flex: 1 }} />
                <input type="text" value={form.class} onChange={(e) => setForm((f) => ({ ...f, class: e.target.value }))} placeholder="Class (SR, JR(RS))" style={{ flex: 1 }} />
                <select value={form.round} onChange={(e) => setForm((f) => ({ ...f, round: e.target.value }))}>
                  {ROUND_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <input type="text" value={form.height} onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))} placeholder="Height" style={{ flex: 1 }} />
                <input type="number" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))} style={{ width: "80px" }} />
                <input type="text" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="#" style={{ width: "60px" }} />
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" style={{ flex: 2 }} />
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>Age auto-calculated from class</p>
              <button type="submit" className="btn btn-primary">Add Pick</button>
            </form>
          </details>

          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Bulk Add</summary>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Paste tab-separated: Year, Name, Position, Class, Age, Height, Weight, Number, Race, Round, Notes</p>
            <input type="text" value={bulkSchool || selectedSchool} onChange={(e) => setBulkSchool(e.target.value)} placeholder="School for all rows" style={{ marginBottom: "0.5rem", width: "100%" }} />
            <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }} />
            <button className="btn btn-primary" onClick={bulkUpload} style={{ marginTop: "0.5rem" }}>Upload</button>
          </details>
        </>
      )}
    </div>
  );
}

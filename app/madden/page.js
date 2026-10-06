"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  SEASON_DISPLAY_COLS, SEASON_COL_NAMES, AWARD_COLS,
  NFL_DIVISIONS, ALL_DIV_TEAMS,
  AP_POSITIONS_OFF, AP_POSITIONS_DEF, AP_POSITIONS_ST, AP_POSITIONS_ALL,
  apDisplayLabel, NFL_COLORS,
} from "@/lib/constants";

const AWARD_FIELD_COLS = [...Object.keys(AWARD_COLS), "ninety_nine_club"];

function parseTeamOvr(text) {
  if (!text?.trim()) return { team: null, ovr: null };
  const parts = text.trim().split(/\s+/);
  let team = null, ovr = null;
  for (const p of parts) {
    if (/^\d+$/.test(p)) ovr = parseInt(p);
    else team = p.toUpperCase();
  }
  return { team, ovr };
}

function parseRecord(rec) {
  const parts = rec.trim().split("-");
  const w = parseInt(parts[0]);
  return isNaN(w) ? null : w;
}

function CssBar({ label, value, max, minLabel = "50px" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
      <span style={{ minWidth: minLabel, fontSize: "0.85rem" }}>{label}</span>
      <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
        <div style={{ width: `${(value / (max || 1)) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
      </div>
      <span style={{ minWidth: "24px", fontSize: "0.85rem" }}>{value}</span>
    </div>
  );
}

export default function MaddenFranchisePage() {
  const [games, setGames] = useState({});
  const [selectedGame, setSelectedGame] = useState("");
  const [franchises, setFranchises] = useState([]);
  const [selectedFranchise, setSelectedFranchise] = useState("");
  const [seasons, setSeasons] = useState([]);
  const [wins, setWins] = useState([]);
  const [allpro, setAllpro] = useState([]);
  const [tab, setTab] = useState("awards");
  const [addTab, setAddTab] = useState("eos");
  const [msg, setMsg] = useState(null);
  // Edit states
  const [editRow, setEditRow] = useState(null);
  const [editVals, setEditVals] = useState({});
  // Sub-selectors
  const [winsYear, setWinsYear] = useState(null);
  const [divYear, setDivYear] = useState(null);
  const [apYear, setApYear] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  // EOS form
  const [eosForm, setEosForm] = useState({});
  const [eosCustom, setEosCustom] = useState("");
  // Single season form
  const [singleForm, setSingleForm] = useState({});
  // Bulk seasons
  const [bulkFran, setBulkFran] = useState("");
  const [bulkText, setBulkText] = useState("");
  // Add wins form
  const [winsFormFran, setWinsFormFran] = useState("");
  const [winsFormYear, setWinsFormYear] = useState(2027);
  const [winsFormRecs, setWinsFormRecs] = useState({});
  const [winsFormCustom, setWinsFormCustom] = useState("");
  // Add allpro form
  const [apFormYear, setApFormYear] = useState(2027);
  const [apFormPlayers, setApFormPlayers] = useState({});
  const [apFormTeamOvr, setApFormTeamOvr] = useState({});
  // Bulk allpro
  const [bulkApYear, setBulkApYear] = useState(2027);
  const [bulkApText, setBulkApText] = useState("");
  // New franchise
  const [newFranName, setNewFranName] = useState("");

  const prefix = games[selectedGame] || "";
  const seasonsTable = `${prefix}_seasons`;
  const winsTable = `${prefix}_team_wins`;
  const allproTable = `${prefix}_all_pro`;

  async function loadGames() {
    const { data } = await supabase.from("game_registry").select("*").eq("game_type", "madden").order("display_name");
    const g = {};
    (data || []).forEach((r) => { g[r.display_name] = r.table_prefix; });
    setGames(g);
    const names = Object.keys(g);
    if (names.length > 0 && !selectedGame) setSelectedGame(names[0]);
  }

  async function loadData() {
    if (!prefix) return;
    const [s, w, ap, cfg] = await Promise.all([
      supabase.from(`${prefix}_seasons`).select("*").order("year"),
      supabase.from(`${prefix}_team_wins`).select("*").order("year"),
      supabase.from(`${prefix}_all_pro`).select("*").order("year"),
      supabase.from("franchise_config").select("*").eq("game", prefix),
    ]);
    const sd = s.data || [];
    const wd = w.data || [];
    const apd = ap.data || [];
    setSeasons(sd);
    setWins(wd);
    setAllpro(apd);

    const configFrans = (cfg.data || []).map((r) => r.franchise);
    const dataFrans = [...new Set(sd.map((r) => r.franchise))];
    const winFrans = [...new Set(wd.map((r) => r.franchise))];
    const all = [...new Set([...configFrans, ...dataFrans, ...winFrans])].sort();
    setFranchises(all);
    if (all.length > 0 && !all.includes(selectedFranchise)) setSelectedFranchise(all[0]);
  }

  useEffect(() => { loadGames(); }, []);
  useEffect(() => { if (selectedGame) loadData(); }, [selectedGame, games]);

  const franSeasons = useMemo(() =>
    seasons.filter((s) => s.franchise === selectedFranchise).sort((a, b) => a.year - b.year),
    [seasons, selectedFranchise]
  );
  const franWins = useMemo(() =>
    wins.filter((w) => w.franchise === selectedFranchise).sort((a, b) => a.year - b.year),
    [wins, selectedFranchise]
  );

  const defaultYear = franSeasons.length > 0 ? Math.max(...franSeasons.map((s) => s.year)) + 1 : 2027;

  // Award helpers
  function hasAwardData(row) {
    return AWARD_FIELD_COLS.some((c) => row[c] && String(row[c]).trim());
  }
  const displaySeasons = showEmpty ? franSeasons : franSeasons.filter(hasAwardData);

  // Wins helpers
  const winsClean = franWins.filter((w) => w.wins != null);
  const winsYears = [...new Set(winsClean.map((w) => w.year))].sort();
  const selectedWinsYear = winsYear ?? (winsYears.length > 0 ? winsYears[winsYears.length - 1] : null);

  // All-Pro helpers
  const apYears = [...new Set(allpro.map((a) => a.year))].sort();
  const selectedApYear = apYear ?? (apYears.length > 0 ? apYears[apYears.length - 1] : null);
  const yearAp = allpro.filter((a) => a.year === selectedApYear);

  // Award leaders
  const awardLeaders = useMemo(() => {
    const leaders = [];
    for (const [col, label] of Object.entries(AWARD_COLS)) {
      const vals = franSeasons.map((s) => s[col]).filter(Boolean);
      if (vals.length === 0) continue;
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      leaders.push({ award: label, leader: sorted[0][0], times: sorted[0][1], total: sorted.length });
    }
    return leaders;
  }, [franSeasons]);

  // Dynasty streaks
  const sbWinners = franSeasons.map((s) => s.sb_winner).filter(Boolean);
  const sbCounts = useMemo(() => {
    const c = {};
    sbWinners.forEach((w) => { c[w] = (c[w] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [franSeasons]);

  const longestStreak = useMemo(() => {
    let max = 0, cur = 0, team = "", prev = null;
    for (const s of franSeasons) {
      const w = s.sb_winner;
      if (w && w === prev) { cur++; if (cur > max) { max = cur; team = w; } }
      else cur = 1;
      prev = w;
    }
    return max > 1 ? { team, count: max } : null;
  }, [franSeasons]);

  // --- CRUD ---
  async function saveRow(table, id, updates) {
    await supabase.from(table).update(updates).eq("id", id);
    setEditRow(null);
    setEditVals({});
    flash("Saved.");
    loadData();
  }

  async function deleteRow(table, id) {
    await supabase.from(table).delete().eq("id", id);
    flash("Deleted.");
    loadData();
  }

  async function insertSeason(data) {
    await supabase.from(seasonsTable).insert(data);
    flash("Season added.");
    loadData();
  }

  async function insertWins(rows) {
    if (rows.length === 0) return;
    await supabase.from(winsTable).insert(rows);
    flash(`${rows.length} team records added.`);
    loadData();
  }

  async function insertAllpro(rows) {
    if (rows.length === 0) return;
    await supabase.from(allproTable).insert(rows);
    flash(`${rows.length} All-Pro selections added.`);
    loadData();
  }

  async function createFranchise() {
    if (!newFranName.trim()) return;
    await supabase.from("franchise_config").upsert({ game: prefix, franchise: newFranName.trim(), primary_team: null });
    setNewFranName("");
    flash("Franchise created.");
    loadData();
  }

  function flash(text) {
    setMsg(text);
    setTimeout(() => setMsg(null), 3000);
  }

  // --- Collect form helpers ---
  function collectTeamWins(recs, franchise, year, customText) {
    const rows = [];
    for (const team of ALL_DIV_TEAMS) {
      const rec = recs[team]?.trim();
      if (!rec) continue;
      const w = parseRecord(rec);
      if (w == null) continue;
      rows.push({ franchise, year, team, wins: w });
    }
    if (customText?.trim()) {
      for (const line of customText.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const abbr = parts[0].toUpperCase();
        const w = parseRecord(parts[1]);
        if (w == null) continue;
        rows.push({ franchise, year, team: abbr, wins: w });
      }
    }
    return rows;
  }

  function collectAllproRows(players, teamOvrs, year, tovrPrefix = "") {
    const rows = [];
    for (const pos of AP_POSITIONS_ALL) {
      const player = players[pos]?.trim();
      if (!player) continue;
      const { team, ovr } = parseTeamOvr(teamOvrs[`${tovrPrefix}${pos}`]);
      rows.push({ year, position_label: pos, player, team, ovr });
    }
    return rows;
  }

  // --- Submit handlers ---
  async function submitEos(e) {
    e.preventDefault();
    const fran = eosForm.newFran?.trim() || eosForm.franchise || selectedFranchise;
    if (!fran) { flash("Franchise required."); return; }
    const year = parseInt(eosForm.year) || defaultYear;

    await supabase.from(seasonsTable).insert({
      franchise: fran, year,
      sb_winner: eosForm.sb_winner || null, sb_mvp: eosForm.sb_mvp || null,
      nfl_mvp: eosForm.nfl_mvp || null, coach_of_year: eosForm.coach_of_year || null,
      opoy: eosForm.opoy || null, dpoy: eosForm.dpoy || null,
      oroy: eosForm.oroy || null, droy: eosForm.droy || null,
      ninety_nine_club: eosForm.ninety_nine_club || null,
    });

    const wRows = collectTeamWins(eosForm, fran, year, eosCustom);
    if (wRows.length) await supabase.from(winsTable).insert(wRows);

    const apRows = collectAllproRows(eosForm, eosForm, year, "tovr_");
    if (apRows.length) await supabase.from(allproTable).insert(apRows);

    const parts = ["1 season"];
    if (wRows.length) parts.push(`${wRows.length} team records`);
    if (apRows.length) parts.push(`${apRows.length} All-Pro picks`);
    flash(`Uploaded: ${parts.join(", ")}.`);
    setEosForm({});
    setEosCustom("");
    loadData();
  }

  async function submitSingleSeason(e) {
    e.preventDefault();
    const fran = singleForm.newFran?.trim() || singleForm.franchise || selectedFranchise;
    if (!fran) { flash("Franchise required."); return; }
    await insertSeason({
      franchise: fran, year: parseInt(singleForm.year) || defaultYear,
      sb_winner: singleForm.sb_winner || null, sb_mvp: singleForm.sb_mvp || null,
      nfl_mvp: singleForm.nfl_mvp || null, coach_of_year: singleForm.coach_of_year || null,
      opoy: singleForm.opoy || null, dpoy: singleForm.dpoy || null,
      oroy: singleForm.oroy || null, droy: singleForm.droy || null,
      ninety_nine_club: singleForm.ninety_nine_club || null,
    });
    setSingleForm({});
  }

  async function submitBulkSeasons() {
    if (!bulkText.trim()) return;
    const fran = bulkFran || selectedFranchise;
    if (!fran) { flash("Franchise required."); return; }
    const rows = bulkText.trim().split("\n").map((line) => {
      const c = line.split("\t");
      const yr = parseInt(c[0]);
      if (isNaN(yr)) return null;
      return {
        franchise: fran, year: yr,
        sb_winner: c[1]?.trim() || null, sb_mvp: c[2]?.trim() || null,
        nfl_mvp: c[3]?.trim() || null, coach_of_year: c[4]?.trim() || null,
        opoy: c[5]?.trim() || null, dpoy: c[6]?.trim() || null,
        oroy: c[7]?.trim() || null, droy: c[8]?.trim() || null,
        ninety_nine_club: c[9]?.trim() || null,
      };
    }).filter(Boolean);
    if (rows.length) {
      await supabase.from(seasonsTable).insert(rows);
      flash(`Uploaded ${rows.length} seasons.`);
      setBulkText("");
      loadData();
    }
  }

  async function submitTeamWins(e) {
    e.preventDefault();
    const fran = winsFormFran || selectedFranchise;
    if (!fran) { flash("Franchise required."); return; }
    const rows = collectTeamWins(winsFormRecs, fran, winsFormYear, winsFormCustom);
    if (rows.length) {
      await insertWins(rows);
      setWinsFormRecs({});
      setWinsFormCustom("");
    } else flash("No records entered.");
  }

  async function submitAllpro(e) {
    e.preventDefault();
    const rows = collectAllproRows(apFormPlayers, apFormTeamOvr, apFormYear);
    if (rows.length) {
      await insertAllpro(rows);
      setApFormPlayers({});
      setApFormTeamOvr({});
    } else flash("No players entered.");
  }

  async function submitBulkAllpro() {
    if (!bulkApText.trim()) return;
    const rows = bulkApText.trim().split("\n").map((line) => {
      const p = line.split("\t");
      if (p.length < 2 || !p[1].trim()) return null;
      let ovrVal = null;
      if (p[3]?.trim() && /^\d+$/.test(p[3].trim())) ovrVal = parseInt(p[3]);
      return {
        year: bulkApYear,
        position_label: p[0].trim(),
        player: p[1].trim(),
        team: p[2]?.trim().toUpperCase() || null,
        ovr: ovrVal,
      };
    }).filter(Boolean);
    if (rows.length) {
      await insertAllpro(rows);
      setBulkApText("");
    }
  }

  // --- Wins analytics ---
  const totalByTeam = useMemo(() => {
    const t = {};
    winsClean.forEach((w) => { t[w.team] = (t[w.team] || 0) + Number(w.wins); });
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [winsClean]);

  const avgByTeam = useMemo(() => {
    const sums = {}, counts = {};
    winsClean.forEach((w) => {
      sums[w.team] = (sums[w.team] || 0) + Number(w.wins);
      counts[w.team] = (counts[w.team] || 0) + 1;
    });
    return Object.entries(sums).map(([t, s]) => [t, s / counts[t]]).sort((a, b) => b[1] - a[1]);
  }, [winsClean]);

  const gameNames = Object.keys(games);

  // --- Render helpers ---
  function DivisionInputs({ recs, setRec, keyPrefix }) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {Object.entries(NFL_DIVISIONS).map(([divName, teams]) => (
          <div key={divName}>
            <p style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "4px" }}>{divName}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
              {teams.map((team) => (
                <div key={team} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <label style={{ fontSize: "0.8rem", minWidth: "36px" }}>{team}</label>
                  <input
                    type="text" placeholder="W-L"
                    value={recs[team] || ""}
                    onChange={(e) => setRec(team, e.target.value)}
                    style={{ width: "60px", fontSize: "0.8rem" }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function AllproInputs({ players, teamOvrs, setPlayer, setTeamOvr }) {
    return (
      <>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Player name + optional team &amp; OVR (e.g., &quot;KC 99&quot;)
        </p>
        {[["Offense", AP_POSITIONS_OFF], ["Defense", AP_POSITIONS_DEF], ["Special Teams", AP_POSITIONS_ST]].map(([section, positions]) => (
          <div key={section}>
            <p style={{ fontWeight: 600, marginTop: "0.5rem" }}>{section}</p>
            {positions.map((pos) => (
              <div key={pos} style={{ display: "flex", gap: "4px", marginBottom: "2px", alignItems: "center" }}>
                <label style={{ fontSize: "0.8rem", minWidth: "70px" }}>{pos}</label>
                <input
                  type="text" placeholder="Player"
                  value={players[pos] || ""}
                  onChange={(e) => setPlayer(pos, e.target.value)}
                  style={{ flex: 3, fontSize: "0.85rem" }}
                />
                <input
                  type="text" placeholder="TM 99"
                  value={teamOvrs[pos] || ""}
                  onChange={(e) => setTeamOvr(pos, e.target.value)}
                  style={{ flex: 1, fontSize: "0.85rem" }}
                />
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }

  function AwardForm({ form, setField, yearDefault }) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
        <div><label style={{ fontSize: "0.8rem" }}>Year</label><input type="number" value={form.year ?? yearDefault} onChange={(e) => setField("year", e.target.value)} style={{ width: "100%" }} /></div>
        <div><label style={{ fontSize: "0.8rem" }}>Franchise</label><select value={form.franchise || selectedFranchise} onChange={(e) => setField("franchise", e.target.value)} style={{ width: "100%" }}>
          {franchises.map((f) => <option key={f} value={f}>{f}</option>)}
        </select></div>
        <div><label style={{ fontSize: "0.8rem" }}>Or new franchise</label><input type="text" value={form.newFran || ""} onChange={(e) => setField("newFran", e.target.value)} style={{ width: "100%" }} /></div>
        {Object.entries(AWARD_COLS).map(([col, label]) => (
          <div key={col}><label style={{ fontSize: "0.8rem" }}>{label}</label><input type="text" value={form[col] || ""} onChange={(e) => setField(col, e.target.value)} style={{ width: "100%" }} /></div>
        ))}
        <div><label style={{ fontSize: "0.8rem" }}>99 Club</label><input type="text" value={form.ninety_nine_club || ""} onChange={(e) => setField("ninety_nine_club", e.target.value)} style={{ width: "100%" }} /></div>
      </div>
    );
  }

  // --- 99 Club ---
  const ninetyNineData = useMemo(() => {
    const members = [];
    for (const s of franSeasons) {
      const val = s.ninety_nine_club;
      if (!val?.trim()) continue;
      const names = val.split(/[,/;]+/).map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        const apMatch = allpro.find((a) => a.year === s.year && a.player?.toLowerCase() === name.toLowerCase());
        members.push({ player: name, year: s.year, team: apMatch?.team || "" });
      }
    }
    return members;
  }, [franSeasons, allpro]);

  return (
    <div>
      <h1 className="page-title">Madden Franchise</h1>

      {msg && <p className="alert alert-success">{msg}</p>}

      {gameNames.length === 0 && <p className="alert alert-info">No Madden games found. Add one in game_registry.</p>}

      {gameNames.length > 0 && (
        <>
          {/* Game selector */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {gameNames.map((g) => (
              <button key={g} className={`btn ${g === selectedGame ? "btn-primary" : ""}`} onClick={() => setSelectedGame(g)}>{g}</button>
            ))}
          </div>

          {/* Franchise selector */}
          {franchises.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
              <select value={selectedFranchise} onChange={(e) => setSelectedFranchise(e.target.value)}>
                {franchises.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <input type="text" placeholder="New franchise" value={newFranName} onChange={(e) => setNewFranName(e.target.value)} style={{ width: "150px" }} />
              <button className="btn" onClick={createFranchise}>Create</button>
            </div>
          )}

          {franchises.length === 0 && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
              <p className="alert alert-info" style={{ margin: 0 }}>No franchises yet.</p>
              <input type="text" placeholder="Franchise name" value={newFranName} onChange={(e) => setNewFranName(e.target.value)} style={{ width: "150px" }} />
              <button className="btn btn-primary" onClick={createFranchise}>Create</button>
            </div>
          )}

          {/* Metrics */}
          {selectedFranchise && (
            <div className="metrics-row">
              <div className="metric"><div className="metric-label">Seasons</div><div className="metric-value">{franSeasons.length}</div></div>
              <div className="metric"><div className="metric-label">SB Winners</div><div className="metric-value">{sbWinners.length}</div></div>
              <div className="metric"><div className="metric-label">Unique MVPs</div><div className="metric-value">{[...new Set(franSeasons.map((s) => s.nfl_mvp).filter(Boolean))].length}</div></div>
              {totalByTeam.length > 0 && (
                <>
                  <div className="metric"><div className="metric-label">Top Win Team</div><div className="metric-value">{totalByTeam[0][0]} ({Math.round(totalByTeam[0][1])})</div></div>
                  {avgByTeam.length > 0 && <div className="metric"><div className="metric-label">Best Avg Wins</div><div className="metric-value">{avgByTeam[0][0]} ({avgByTeam[0][1].toFixed(1)})</div></div>}
                </>
              )}
            </div>
          )}

          <hr className="divider" />

          {/* Tab buttons */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[["awards", "Season Awards"], ["records", "Team Records"], ["allpro", "All-Pro Teams"], ["insights", "Insights"]].map(([k, label]) => (
              <button key={k} className={`btn ${tab === k ? "btn-primary" : ""}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {/* ========== SEASON AWARDS TAB ========== */}
          {tab === "awards" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h2 style={{ marginBottom: "0.5rem" }}>Season Awards</h2>
              <label style={{ fontSize: "0.85rem" }}>
                <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show seasons with no awards
              </label>

              {displaySeasons.length === 0 && <p className="alert alert-info" style={{ marginTop: "0.5rem" }}>No season award data entered yet.</p>}

              {displaySeasons.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
                  <table>
                    <thead><tr>
                      {SEASON_DISPLAY_COLS.map((c) => <th key={c}>{SEASON_COL_NAMES[c]}</th>)}
                      <th></th>
                    </tr></thead>
                    <tbody>
                      {displaySeasons.map((s) => (
                        <tr key={s.id}>
                          {editRow === s.id ? (
                            <>
                              {SEASON_DISPLAY_COLS.map((c) => (
                                <td key={c}><input type="text" value={editVals[c] ?? s[c] ?? ""} onChange={(e) => setEditVals((v) => ({ ...v, [c]: e.target.value }))} style={{ width: "100%", fontSize: "0.85rem" }} /></td>
                              ))}
                              <td style={{ whiteSpace: "nowrap" }}>
                                <button className="btn btn-primary" style={{ padding: "2px 6px", marginRight: "4px" }} onClick={() => saveRow(seasonsTable, s.id, Object.fromEntries(SEASON_DISPLAY_COLS.map((c) => [c, (editVals[c] ?? s[c]) || null])))}>Save</button>
                                <button className="btn" style={{ padding: "2px 6px" }} onClick={() => { setEditRow(null); setEditVals({}); }}>Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              {SEASON_DISPLAY_COLS.map((c) => <td key={c}>{s[c] ?? ""}</td>)}
                              <td><button className="btn" style={{ padding: "2px 6px" }} onClick={() => setEditRow(s.id)}>Edit</button></td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Award Leaders */}
              {awardLeaders.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1rem" }}>Award Leaders</h3>
                  <table>
                    <thead><tr><th>Award</th><th>Leader</th><th>Times</th><th>Total Winners</th></tr></thead>
                    <tbody>
                      {awardLeaders.map((l) => (
                        <tr key={l.award}><td>{l.award}</td><td>{l.leader}</td><td>{l.times}</td><td>{l.total}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Award Counts */}
              {Object.entries(AWARD_COLS).map(([col, label]) => {
                const vals = franSeasons.map((s) => s[col]).filter(Boolean);
                if (vals.length === 0) return null;
                const counts = {};
                vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
                const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
                const max = sorted[0]?.[1] || 1;
                return (
                  <details key={col} style={{ marginTop: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>{label}</summary>
                    <div style={{ padding: "0.5rem 0" }}>
                      {sorted.map(([name, count]) => <CssBar key={name} label={name} value={count} max={max} minLabel="120px" />)}
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {/* ========== TEAM RECORDS TAB ========== */}
          {tab === "records" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h2 style={{ marginBottom: "0.5rem" }}>Team Records</h2>

              {winsClean.length === 0 && <p className="alert alert-info">No team win records for this franchise.</p>}

              {winsClean.length > 0 && (
                <>
                  {/* Metrics */}
                  {totalByTeam.length > 0 && (
                    <div className="metrics-row">
                      <div className="metric"><div className="metric-label">Most Total Wins</div><div className="metric-value">{totalByTeam[0][0]} ({Math.round(totalByTeam[0][1])})</div></div>
                      <div className="metric"><div className="metric-label">Fewest Total Wins</div><div className="metric-value">{totalByTeam[totalByTeam.length - 1][0]} ({Math.round(totalByTeam[totalByTeam.length - 1][1])})</div></div>
                      <div className="metric"><div className="metric-label">Highest Avg</div><div className="metric-value">{avgByTeam[0][0]} ({avgByTeam[0][1].toFixed(1)})</div></div>
                      {(() => {
                        const best = winsClean.reduce((a, b) => Number(a.wins) > Number(b.wins) ? a : b);
                        return <div className="metric"><div className="metric-label">Best Season</div><div className="metric-value">{best.team} ({Math.round(Number(best.wins))}w, Yr {best.year})</div></div>;
                      })()}
                    </div>
                  )}

                  {/* Year selector + bar chart */}
                  <div style={{ marginTop: "0.5rem" }}>
                    <select value={selectedWinsYear ?? ""} onChange={(e) => setWinsYear(parseInt(e.target.value))}>
                      {winsYears.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  {selectedWinsYear && (() => {
                    const yearData = winsClean.filter((w) => w.year === selectedWinsYear).sort((a, b) => Number(b.wins) - Number(a.wins));
                    const max = yearData.length > 0 ? Math.max(...yearData.map((w) => Number(w.wins))) : 1;
                    return (
                      <div style={{ marginTop: "0.5rem" }}>
                        {yearData.map((w) => <CssBar key={w.id} label={w.team} value={Number(w.wins)} max={max} />)}
                      </div>
                    );
                  })()}

                  {/* All-Time Wins */}
                  <h3 style={{ marginTop: "1rem" }}>All-Time Team Wins</h3>
                  {(() => {
                    const max = totalByTeam[0]?.[1] || 1;
                    return totalByTeam.map(([team, total]) => <CssBar key={team} label={team} value={Math.round(total)} max={Math.round(max)} />);
                  })()}

                  {/* Average Wins */}
                  <h3 style={{ marginTop: "1rem" }}>Average Wins per Season</h3>
                  {(() => {
                    const max = avgByTeam[0]?.[1] || 1;
                    return avgByTeam.map(([team, avg]) => <CssBar key={team} label={team} value={parseFloat(avg.toFixed(1))} max={parseFloat(max.toFixed(1))} />);
                  })()}

                  {/* Division Standings */}
                  <h3 style={{ marginTop: "1rem" }}>Division Standings</h3>
                  <select value={divYear ?? selectedWinsYear ?? ""} onChange={(e) => setDivYear(parseInt(e.target.value))}>
                    {winsYears.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {(() => {
                    const yr = divYear ?? selectedWinsYear;
                    if (!yr) return null;
                    const yearData = winsClean.filter((w) => w.year === yr);
                    if (yearData.length === 0) return null;
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
                        {Object.entries(NFL_DIVISIONS).map(([divName, divTeams]) => {
                          const rows = yearData.filter((w) => divTeams.includes(w.team)).sort((a, b) => Number(b.wins) - Number(a.wins));
                          if (rows.length === 0) return null;
                          return (
                            <div key={divName}>
                              <p style={{ fontWeight: 700, marginBottom: "4px" }}>{divName}</p>
                              {rows.map((r) => (
                                <p key={r.id} style={{ fontSize: "0.85rem", margin: "2px 0" }}>
                                  <span style={{ fontWeight: 600 }}>{r.team}</span>
                                  <span style={{ opacity: 0.6, marginLeft: "4px" }}>{Math.round(Number(r.wins))}W</span>
                                </p>
                              ))}
                            </div>
                          );
                        })}
                        {/* Custom/relocated teams */}
                        {(() => {
                          const custom = yearData.filter((w) => !ALL_DIV_TEAMS.includes(w.team));
                          if (custom.length === 0) return null;
                          return (
                            <div>
                              <p style={{ fontWeight: 700, marginBottom: "4px" }}>Custom / Relocated</p>
                              {custom.sort((a, b) => Number(b.wins) - Number(a.wins)).map((r) => (
                                <p key={r.id} style={{ fontSize: "0.85rem", margin: "2px 0" }}>
                                  <span style={{ fontWeight: 600 }}>{r.team}</span>
                                  <span style={{ opacity: 0.6, marginLeft: "4px" }}>{Math.round(Number(r.wins))}W</span>
                                </p>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* ========== ALL-PRO TAB ========== */}
          {tab === "allpro" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h2 style={{ marginBottom: "0.5rem" }}>All-Pro Teams</h2>

              {allpro.length === 0 && <p className="alert alert-info">No All-Pro data for this game.</p>}

              {allpro.length > 0 && (
                <>
                  <select value={selectedApYear ?? ""} onChange={(e) => setApYear(parseInt(e.target.value))}>
                    {apYears.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>

                  {yearAp.length > 0 && (
                    <div style={{ marginTop: "0.5rem" }}>
                      {[["Offense", AP_POSITIONS_OFF, [
                        { label: "RB 1st", x: 50, y: 12 },
                        { label: "FB 1st", x: 50, y: 25 },
                        { label: "QB 1st", x: 50, y: 38 },
                        { label: "WR 1st", x: 8, y: 55 }, { label: "WR 2nd", x: 92, y: 55 }, { label: "WR 3rd", x: 18, y: 62 },
                        { label: "TE 1st", x: 28, y: 62 },
                        { label: "OT 1st", x: 32, y: 72 }, { label: "OT 2nd", x: 68, y: 72 },
                        { label: "OG 1st", x: 40, y: 72 }, { label: "OG 2nd", x: 60, y: 72 },
                        { label: "C 1st", x: 50, y: 72 },
                      ]], ["Defense", AP_POSITIONS_DEF, [
                        { label: "EDGE 1st", x: 12, y: 82 }, { label: "EDGE 2nd", x: 88, y: 82 },
                        { label: "DT 1st", x: 40, y: 82 }, { label: "DT 2nd", x: 60, y: 82 },
                        { label: "WILL 1st", x: 25, y: 62 },
                        { label: "MIKE 1st", x: 50, y: 62 },
                        { label: "SAM 1st", x: 75, y: 62 },
                        { label: "CB 1st", x: 8, y: 38 }, { label: "CB 2nd", x: 92, y: 38 },
                        { label: "S 1st", x: 35, y: 18 }, { label: "S 2nd", x: 65, y: 18 },
                      ]]].map(([section, positions, layout]) => {
                        const sectionPlayers = yearAp.filter((a) => positions.includes(a.position_label));
                        if (sectionPlayers.length === 0) return null;
                        return (
                          <div key={section} style={{ marginBottom: "1.5rem" }}>
                            <p style={{ fontWeight: 700, fontSize: "0.95rem", borderBottom: "2px solid var(--border)", paddingBottom: "4px", marginBottom: "10px" }}>{section}</p>
                            <div style={{ position: "relative", width: "100%", paddingTop: "55%", background: "linear-gradient(180deg, #1b5e20 0%, #2e7d32 30%, #388e3c 70%, #2e7d32 100%)", borderRadius: "10px", overflow: "hidden", border: "3px solid rgba(255,255,255,0.15)" }}>
                              {[16, 33, 50, 66, 83].map((pct) => (
                                <div key={pct} style={{ position: "absolute", left: "3%", right: "3%", top: `${pct}%`, borderTop: "1px solid rgba(255,255,255,0.12)" }} />
                              ))}
                              <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", borderLeft: "1px dashed rgba(255,255,255,0.08)" }} />
                              {layout.map(({ label, x, y }) => {
                                const match = yearAp.find((a) => a.position_label === label);
                                if (!match) return null;
                                const posAbbr = label.split(" ")[0];
                                const lastName = match.player?.split(" ").pop() || "";
                                const tc = match.team && NFL_COLORS[match.team.toUpperCase()];
                                const bg = tc ? tc[0] : "rgba(0,0,0,0.5)";
                                const border = tc ? tc[1] : "rgba(255,255,255,0.3)";
                                const posColor = tc ? tc[1] : "#FFD700";
                                return (
                                  <div key={label} style={{
                                    position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)",
                                    textAlign: "center", zIndex: 2,
                                  }}>
                                    <div style={{ background: bg, border: `2px solid ${border}`, borderRadius: "8px", padding: "4px 8px", minWidth: "60px", boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
                                      <div style={{ fontSize: "0.55rem", fontWeight: 700, color: posColor, letterSpacing: "0.5px" }}>{posAbbr}</div>
                                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#fff", whiteSpace: "nowrap" }}>{lastName}</div>
                                      {match.ovr && <div style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.7)" }}>{match.ovr} OVR</div>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* list view below */}
                            <div style={{ marginTop: "8px" }}>
                            {positions.map((pos) => {
                              const p = yearAp.find((a) => a.position_label === pos);
                              if (!p) return null;
                              const extras = [p.team, p.ovr != null && `${p.ovr} OVR`].filter(Boolean).join(" · ");
                              return (
                                <div key={pos} style={{ display: "flex", gap: "8px", alignItems: "baseline", margin: "3px 0" }}>
                                  <span style={{ fontWeight: 700, minWidth: "60px", fontSize: "0.85rem", color: "var(--accent)" }}>{apDisplayLabel(pos)}</span>
                                  <span style={{ fontSize: "0.85rem" }}>{p.player}{extras ? ` (${extras})` : ""}</span>
                                </div>
                              );
                            })}
                            </div>
                          </div>
                        );
                      })}
                      {/* Special Teams - list only */}
                      {(() => {
                        const stPlayers = yearAp.filter((a) => AP_POSITIONS_ST.includes(a.position_label));
                        if (stPlayers.length === 0) return null;
                        return (
                          <div style={{ marginBottom: "0.5rem" }}>
                            <p style={{ fontWeight: 700, fontSize: "0.95rem", borderBottom: "2px solid var(--border)", paddingBottom: "4px" }}>Special Teams</p>
                            {AP_POSITIONS_ST.map((pos) => {
                              const p = yearAp.find((a) => a.position_label === pos);
                              if (!p) return null;
                              const extras = [p.team, p.ovr != null && `${p.ovr} OVR`].filter(Boolean).join(" · ");
                              return (
                                <div key={pos} style={{ display: "flex", gap: "8px", alignItems: "baseline", margin: "3px 0" }}>
                                  <span style={{ fontWeight: 700, minWidth: "60px", fontSize: "0.85rem", color: "var(--accent)" }}>{apDisplayLabel(pos)}</span>
                                  <span style={{ fontSize: "0.85rem" }}>{p.player}{extras ? ` (${extras})` : ""}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Edit year data */}
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit Year Data</summary>
                    <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
                      <table>
                        <thead><tr><th>Position</th><th>Player</th><th>Team</th><th>OVR</th><th></th></tr></thead>
                        <tbody>
                          {yearAp.map((a) => (
                            <tr key={a.id}>
                              {editRow === a.id ? (
                                <>
                                  <td><input type="text" value={editVals.position_label ?? a.position_label ?? ""} onChange={(e) => setEditVals((v) => ({ ...v, position_label: e.target.value }))} style={{ width: "80px" }} /></td>
                                  <td><input type="text" value={editVals.player ?? a.player ?? ""} onChange={(e) => setEditVals((v) => ({ ...v, player: e.target.value }))} /></td>
                                  <td><input type="text" value={editVals.team ?? a.team ?? ""} onChange={(e) => setEditVals((v) => ({ ...v, team: e.target.value }))} style={{ width: "50px" }} /></td>
                                  <td><input type="number" value={editVals.ovr ?? a.ovr ?? ""} onChange={(e) => setEditVals((v) => ({ ...v, ovr: e.target.value }))} style={{ width: "50px" }} /></td>
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    <button className="btn btn-primary" style={{ padding: "2px 6px", marginRight: "4px" }} onClick={() => saveRow(allproTable, a.id, { position_label: editVals.position_label ?? a.position_label, player: editVals.player ?? a.player, team: (editVals.team ?? a.team) || null, ovr: parseInt(editVals.ovr ?? a.ovr) || null })}>Save</button>
                                    <button className="btn" style={{ padding: "2px 6px" }} onClick={() => { setEditRow(null); setEditVals({}); }}>Cancel</button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td>{a.position_label}</td>
                                  <td>{a.player}</td>
                                  <td>{a.team}</td>
                                  <td>{a.ovr}</td>
                                  <td><button className="btn" style={{ padding: "2px 6px" }} onClick={() => setEditRow(a.id)}>Edit</button></td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>

                  {/* Player Tracker */}
                  {(() => {
                    const counts = {};
                    allpro.forEach((a) => { const n = a.player?.trim(); if (n) counts[n] = (counts[n] || 0) + 1; });
                    const repeats = Object.entries(counts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
                    if (repeats.length === 0) return null;
                    return (
                      <>
                        <h3 style={{ marginTop: "1rem" }}>Most All-Pro Selections</h3>
                        {(() => {
                          const max = repeats[0]?.[1] || 1;
                          return repeats.slice(0, 15).map(([name, count]) => <CssBar key={name} label={name} value={count} max={max} minLabel="120px" />);
                        })()}

                        {/* Highest Rated */}
                        {allpro.some((a) => a.ovr != null) && (
                          <>
                            <h3 style={{ marginTop: "1rem" }}>Highest Rated All-Pros</h3>
                            <table>
                              <thead><tr><th>Player</th><th>Position</th><th>Year</th><th>Team</th><th>OVR</th></tr></thead>
                              <tbody>
                                {[...allpro].filter((a) => a.ovr != null).sort((a, b) => Number(b.ovr) - Number(a.ovr)).slice(0, 10).map((a) => (
                                  <tr key={a.id}><td>{a.player}</td><td>{apDisplayLabel(a.position_label)}</td><td>{a.year}</td><td>{a.team}</td><td>{a.ovr}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        )}

                        {/* Teams with most selections */}
                        {allpro.some((a) => a.team) && (() => {
                          const teamCounts = {};
                          allpro.forEach((a) => { if (a.team) teamCounts[a.team] = (teamCounts[a.team] || 0) + 1; });
                          const sorted = Object.entries(teamCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
                          const max = sorted[0]?.[1] || 1;
                          return (
                            <>
                              <h3 style={{ marginTop: "1rem" }}>Teams with Most All-Pro Selections</h3>
                              {sorted.map(([team, count]) => <CssBar key={team} label={team} value={count} max={max} />)}
                            </>
                          );
                        })()}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* ========== INSIGHTS TAB ========== */}
          {tab === "insights" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h2 style={{ marginBottom: "0.5rem" }}>Insights</h2>

              {/* Dynasty Streaks */}
              {sbCounts.length > 0 && (
                <>
                  <h3>Most Super Bowl Wins</h3>
                  {(() => {
                    const max = sbCounts[0]?.[1] || 1;
                    return sbCounts.map(([team, count]) => <CssBar key={team} label={team} value={count} max={max} minLabel="120px" />);
                  })()}
                  {longestStreak && (
                    <div className="metrics-row" style={{ marginTop: "0.5rem" }}>
                      <div className="metric"><div className="metric-label">Longest SB Win Streak</div><div className="metric-value">{longestStreak.team} ({longestStreak.count} in a row)</div></div>
                    </div>
                  )}
                </>
              )}

              {/* Award Diversity */}
              {awardLeaders.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1rem" }}>Award Diversity</h3>
                  <table>
                    <thead><tr><th>Award</th><th>Unique Winners</th></tr></thead>
                    <tbody>
                      {awardLeaders.map((l) => <tr key={l.award}><td>{l.award}</td><td>{l.total}</td></tr>)}
                    </tbody>
                  </table>
                </>
              )}

              {/* Parity Index */}
              {winsClean.length > 0 && (() => {
                const byYear = {};
                winsClean.forEach((w) => {
                  if (!byYear[w.year]) byYear[w.year] = [];
                  byYear[w.year].push(Number(w.wins));
                });
                const parity = Object.entries(byYear).map(([yr, vals]) => {
                  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
                  return [Number(yr), parseFloat(std.toFixed(2))];
                }).sort((a, b) => a[0] - b[0]);
                if (parity.length === 0) return null;
                const max = Math.max(...parity.map((p) => p[1]));
                return (
                  <>
                    <h3 style={{ marginTop: "1rem" }}>Parity Index</h3>
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Std dev of wins per year -- lower = more parity</p>
                    {parity.map(([yr, std]) => <CssBar key={yr} label={yr} value={std} max={max} />)}
                  </>
                );
              })()}

              {/* 99 Club */}
              {ninetyNineData.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1rem" }}>99 Club</h3>
                  <div className="metrics-row">
                    <div className="metric"><div className="metric-label">Total 99 Ratings</div><div className="metric-value">{ninetyNineData.length}</div></div>
                    <div className="metric"><div className="metric-label">Unique Players</div><div className="metric-value">{[...new Set(ninetyNineData.map((m) => m.player))].length}</div></div>
                  </div>

                  {/* Repeat members */}
                  {(() => {
                    const counts = {};
                    ninetyNineData.forEach((m) => { counts[m.player] = (counts[m.player] || 0) + 1; });
                    const repeats = Object.entries(counts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
                    if (repeats.length === 0) return null;
                    return (
                      <>
                        <p style={{ fontWeight: 600, marginTop: "0.5rem" }}>Repeat Members</p>
                        {repeats.map(([player, count]) => {
                          const pRows = ninetyNineData.filter((m) => m.player === player).sort((a, b) => a.year - b.year);
                          const parts = pRows.map((r) => r.team ? `${r.year} (${r.team})` : String(r.year));
                          return <p key={player} style={{ fontSize: "0.85rem", margin: "2px 0" }}><strong>{player}</strong> -- {count}x: {parts.join(", ")}</p>;
                        })}
                      </>
                    );
                  })()}

                  <p style={{ fontWeight: 600, marginTop: "0.5rem" }}>By Year</p>
                  {[...new Set(ninetyNineData.map((m) => m.year))].sort((a, b) => b - a).map((yr) => {
                    const members = ninetyNineData.filter((m) => m.year === yr);
                    const labels = members.map((m) => m.team ? `${m.player} (${m.team})` : m.player);
                    return <p key={yr} style={{ fontSize: "0.85rem", margin: "2px 0" }}><strong>Year {yr}</strong>: {labels.join(", ")}</p>;
                  })}
                </>
              )}
            </div>
          )}

          <hr className="divider" />

          {/* ========== ADD DATA SECTION ========== */}
          <h2>Add Data</h2>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[["eos", "End of Season"], ["single", "Single Season"], ["bulk", "Bulk Seasons"], ["addwins", "Team Wins"], ["addap", "All-Pro"]].map(([k, label]) => (
              <button key={k} className={`btn ${addTab === k ? "btn-primary" : ""}`} onClick={() => setAddTab(k)}>{label}</button>
            ))}
          </div>

          {/* End of Season */}
          {addTab === "eos" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h3>End of Season Entry</h3>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Enter all season data at once: awards, team records, and All-Pro selections.</p>
              <form onSubmit={submitEos}>
                <AwardForm form={eosForm} setField={(k, v) => setEosForm((f) => ({ ...f, [k]: v }))} yearDefault={defaultYear} />

                <h4 style={{ marginTop: "1rem" }}>Team Records (W-L)</h4>
                <DivisionInputs
                  recs={eosForm}
                  setRec={(team, val) => setEosForm((f) => ({ ...f, [team]: val }))}
                />
                <div style={{ marginTop: "0.5rem" }}>
                  <label style={{ fontSize: "0.8rem" }}>Custom / Relocated (one per line: ABBR W-L)</label>
                  <textarea value={eosCustom} onChange={(e) => setEosCustom(e.target.value)} rows={3} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }} />
                </div>

                <h4 style={{ marginTop: "1rem" }}>All-Pro Team</h4>
                <AllproInputs
                  players={eosForm}
                  teamOvrs={eosForm}
                  setPlayer={(pos, val) => setEosForm((f) => ({ ...f, [pos]: val }))}
                  setTeamOvr={(pos, val) => setEosForm((f) => ({ ...f, [`tovr_${pos}`]: val }))}
                />

                <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }}>Submit Full Season</button>
              </form>
            </div>
          )}

          {/* Single Season */}
          {addTab === "single" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h3>Add Single Season</h3>
              <form onSubmit={submitSingleSeason}>
                <AwardForm form={singleForm} setField={(k, v) => setSingleForm((f) => ({ ...f, [k]: v }))} yearDefault={defaultYear} />
                <button type="submit" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Add Season</button>
              </form>
            </div>
          )}

          {/* Bulk Seasons */}
          {addTab === "bulk" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h3>Bulk Add Seasons</h3>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Paste tab-separated: Year, SB Winner, SB MVP, NFL MVP, Coach of Year, OPOY, DPOY, OROY, DROY, 99 Club</p>
              <input type="text" placeholder="Franchise for all rows" value={bulkFran || selectedFranchise} onChange={(e) => setBulkFran(e.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
              <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }} />
              <button className="btn btn-primary" onClick={submitBulkSeasons} style={{ marginTop: "0.5rem" }}>Upload</button>
            </div>
          )}

          {/* Add Team Wins */}
          {addTab === "addwins" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h3>Add Team Wins</h3>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Enter records (W-L). Wins are extracted automatically.</p>
              <form onSubmit={submitTeamWins}>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input type="text" placeholder="Franchise" value={winsFormFran || selectedFranchise} onChange={(e) => setWinsFormFran(e.target.value)} style={{ flex: 1 }} />
                  <input type="number" value={winsFormYear} onChange={(e) => setWinsFormYear(parseInt(e.target.value))} style={{ width: "80px" }} />
                </div>
                <DivisionInputs
                  recs={winsFormRecs}
                  setRec={(team, val) => setWinsFormRecs((r) => ({ ...r, [team]: val }))}
                />
                <div style={{ marginTop: "0.5rem" }}>
                  <label style={{ fontSize: "0.8rem" }}>Custom / Relocated (one per line: ABBR W-L)</label>
                  <textarea value={winsFormCustom} onChange={(e) => setWinsFormCustom(e.target.value)} rows={3} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Submit Records</button>
              </form>
            </div>
          )}

          {/* Add All-Pro */}
          {addTab === "addap" && (
            <div className="card" style={{ padding: "1rem" }}>
              <h3>Add All-Pro Selections</h3>
              <form onSubmit={submitAllpro}>
                <div style={{ marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.8rem" }}>Year</label>
                  <input type="number" value={apFormYear} onChange={(e) => setApFormYear(parseInt(e.target.value))} style={{ width: "80px", marginLeft: "0.5rem" }} />
                </div>
                <AllproInputs
                  players={apFormPlayers}
                  teamOvrs={apFormTeamOvr}
                  setPlayer={(pos, val) => setApFormPlayers((p) => ({ ...p, [pos]: val }))}
                  setTeamOvr={(pos, val) => setApFormTeamOvr((t) => ({ ...t, [pos]: val }))}
                />
                <button type="submit" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Submit All-Pro Team</button>
              </form>

              <details style={{ marginTop: "1rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Bulk Paste All-Pro</summary>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Tab-separated: Position, Player, Team, OVR</p>
                <div style={{ marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.8rem" }}>Year</label>
                  <input type="number" value={bulkApYear} onChange={(e) => setBulkApYear(parseInt(e.target.value))} style={{ width: "80px", marginLeft: "0.5rem" }} />
                </div>
                <textarea value={bulkApText} onChange={(e) => setBulkApText(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }} />
                <button className="btn btn-primary" onClick={submitBulkAllpro} style={{ marginTop: "0.5rem" }}>Upload</button>
              </details>
            </div>
          )}

          {/* ========== DELETE SECTION ========== */}
          {(franSeasons.length > 0 || franWins.length > 0 || allpro.length > 0) && (
            <>
              <hr className="divider" />
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--muted)" }}>Delete Data</summary>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", marginTop: "0.5rem" }}>
                  {[["delSeasons", "Seasons"], ["delWins", "Win Records"], ["delAp", "All-Pro"]].map(([k, label]) => (
                    <button key={k} className={`btn ${showDelete === k ? "btn-primary" : ""}`} onClick={() => setShowDelete(showDelete === k ? false : k)}>{label}</button>
                  ))}
                </div>

                {showDelete === "delSeasons" && franSeasons.map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "0.85rem" }}>Year {s.year} -- SB: {s.sb_winner || "--"}</span>
                    <button className="btn" style={{ padding: "2px 6px" }} onClick={() => deleteRow(seasonsTable, s.id)}>Del</button>
                  </div>
                ))}

                {showDelete === "delWins" && franWins.map((w) => (
                  <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "0.85rem" }}>Yr {w.year} -- {w.team} {Math.round(Number(w.wins))}W</span>
                    <button className="btn" style={{ padding: "2px 6px" }} onClick={() => deleteRow(winsTable, w.id)}>Del</button>
                  </div>
                ))}

                {showDelete === "delAp" && allpro.map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "0.85rem" }}>Yr {a.year} -- {a.position_label}: {a.player}</span>
                    <button className="btn" style={{ padding: "2px 6px" }} onClick={() => deleteRow(allproTable, a.id)}>Del</button>
                  </div>
                ))}
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}

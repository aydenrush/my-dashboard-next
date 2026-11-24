"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import { PALETTE } from "@/lib/constants";
import { indexSpecies, parseBatch, decideBatch, transferList, explain, ROLE_LABEL, RULES, BORDER } from "@/lib/pogo";

const ROLE_COLOR = { raid: PALETTE.rose, max: PALETTE.violet, gl: PALETTE.blue, ul: PALETTE.amber, ml: PALETTE.emerald, trophy: PALETTE.slate };
const FLAG_ORDER = ["mighty", "shadow", "purified", "lucky", "shiny", "costume", "background", "dynamax", "gigantamax"];

function Chip({ color, children }) {
  return <span style={{ display: "inline-block", fontSize: "0.72rem", padding: "1px 7px", borderRadius: 999, border: `1px solid ${color}`, color, marginRight: 4 }}>{children}</span>;
}

const cap = (t) => t[0].toUpperCase() + t.slice(1);
const yes = (ok, near) => <span style={{ color: ok ? PALETTE.emerald : near ? PALETTE.amber : PALETTE.rose }} title={ok ? "qualifies" : near ? "borderline" : "doesn't qualify"}>{ok ? "✓" : near ? "≈" : "✗"}</span>;
// "raid" + type -> "Raids · Dragon"; also reads saved box roles like "raid:dragon"
const jobKey = (c) => c.role + (c.rtype ? `:${c.rtype}` : "");
const jobLabel = (key) => { const [role, type] = key.split(":"); return ROLE_LABEL[role] + (type ? ` · ${cap(type)}` : ""); };
const VERDICT = {
  keep: { label: "KEEP", color: PALETTE.emerald },
  backup: { label: "Backup", color: PALETTE.blue },
  borderline: { label: "Borderline", color: PALETTE.amber },
  transfer: { label: "Transfer", color: PALETTE.slate },
};
const ORDER = ["keep", "backup", "borderline", "transfer"];

// the "Why?" breakdown under a result: every form and league it was judged on, and why each did or didn't count
function Why({ entry, idx }) {
  const w = explain(entry, idx);
  const td = { padding: "2px 8px 2px 0", whiteSpace: "nowrap" };
  return (
    <div style={{ fontSize: "0.82rem", marginTop: 6 }}>
      <div style={{ fontWeight: 600, marginTop: 4 }}>Raids</div>
      <div className="muted">Attack {entry.ivs[0]} {yes(w.raidAtk)} {w.raidAtk ? "meets" : "misses"} your 15-Attack rule. Counts if a form is top {w.rules.raidTop} in some type (≈ = top {BORDER.raidTop}).</div>
      {w.raid.length === 0 && <div className="muted">No raid data for this family.</div>}
      {w.raid.map((r) => (
        <div key={r.form}>
          {yes(r.counts, r.near)} <strong>{r.form}</strong>: {r.types.map((t, i) => (
            <span key={t.type} className={i ? "muted" : ""}>{i ? " · " : ""}#{t.rank} {cap(t.type)} ({t.pct}% of the #1){i === 0 ? `, ${t.moves}${t.elite ? " (legacy/elite move)" : ""}` : ""}</span>
          ))}
        </div>
      ))}
      {w.max && <><div style={{ fontWeight: 600, marginTop: 6 }}>Max Battles</div><div className="muted">{w.max}</div></>}
      <div style={{ fontWeight: 600, marginTop: 6 }}>PvP</div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr className="muted">{["", "League", "As", "Species rank", "Your IV rank", "Stats", "Level", "CP"].map((h) => <th key={h} style={{ ...td, textAlign: "left", fontWeight: 400 }}>{h}</th>)}</tr></thead>
        <tbody>
          {["gl", "ul", "ml"].flatMap((lg) => w.pvp[lg].map((r) => (
            <tr key={lg + r.form}>
              <td style={td}>{yes(r.ok, r.near)}</td>
              <td style={td}>{ROLE_LABEL[lg]}</td>
              <td style={td}>{r.form}</td>
              <td style={td}>{r.speciesRank ? `#${r.speciesRank}` : "unranked"} {!r.meta && <span className="muted">(needs top {lg === "ml" ? w.rules.mlTop : w.rules.pvpTop})</span>}</td>
              <td style={td}>#{r.ivRank} of 4096 {lg !== "ml" && !r.ivOk && <span className="muted">(needs top {w.rules.ivTop})</span>}{lg === "ml" && !r.ivOk && <span className="muted">(needs 15/14+/14+)</span>}</td>
              <td style={td}>{(r.pct * 100).toFixed(1)}%</td>
              <td style={td}>{r.level}</td>
              <td style={td}>{r.cp ?? "—"}{r.overCap && <span className="muted"> (Mighty: already over the cap at level 40+)</span>}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

export default function PokemonGoPage() {
  const [idx, setIdx] = useState(null);
  const [box, setBox] = useState([]);
  const [text, setText] = useState("");
  const [results, setResults] = useState(null);
  const [errors, setErrors] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/pogo-data.json").then((r) => r.json()).then((d) => setIdx(indexSpecies(d))).catch(() => setMsg("Couldn't load the Pokémon data file."));
    setText(localStorage.getItem("pogo_draft") || "");
    loadBox();
  }, []);
  useEffect(() => { if (text) localStorage.setItem("pogo_draft", text); else localStorage.removeItem("pogo_draft"); }, [text]);

  async function loadBox() {
    const { data } = await supabase.from("pogo_box").select("*").order("created_at");
    if (data) setBox(data);
  }

  // saved box rows -> entries the engine understands
  const boxEntries = useMemo(() => (idx ? box.filter((b) => idx.byId[b.species_id]).map((b) => ({
    id: b.id, species: idx.byId[b.species_id], ivs: [b.atk, b.def, b.hp], flags: Object.fromEntries(b.flags.map((f) => [f, true])), roles: b.roles,
  })) : []), [idx, box]);

  function check(e) {
    e?.preventDefault();
    if (!idx || !text.trim()) return;
    const { entries, errors } = parseBatch(text, idx);
    setErrors(errors);
    const res = decideBatch(entries, idx, boxEntries);
    setResults(ORDER.flatMap((v) => res.filter((r) => r.verdict === v)));
    setMsg("");
  }

  async function saveKeepers() {
    const rows = results.filter((r) => r.keep).map((r) => ({
      species_id: r.entry.species.id, atk: r.entry.ivs[0], def: r.entry.ivs[1], hp: r.entry.ivs[2],
      flags: Object.keys(r.entry.flags), roles: r.roles.map(jobKey),
    }));
    if (!rows.length) return;
    const { error } = await supabase.from("pogo_box").insert(rows);
    if (error) return;
    setMsg(`Saved ${rows.length} keeper${rows.length > 1 ? "s" : ""} to your box.`);
    loadBox();
  }

  async function copyTransfers() {
    await navigator.clipboard.writeText(transferList(results));
    setMsg("Transfer list copied.");
  }

  async function removeFromBox(b) {
    if (!(await askConfirm(`Remove ${b.species.name} ${b.ivs.join("/")} from your box?`, { confirmLabel: "Remove" }))) return;
    const { error } = await supabase.from("pogo_box").delete().eq("id", b.id);
    if (!error) setBox((bx) => bx.filter((x) => x.id !== b.id));
  }

  const keepers = results?.filter((r) => r.keep) || [];
  const transfers = results?.filter((r) => r.verdict === "transfer") || [];

  return (
    <div>
      <h1 className="page-title">Pokémon GO</h1>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        Paste one or a batch, e.g. <code>14/14/6 shadow gabite</code> or <code>phantump 8/15/15 purified, 14/10/15, 8/13/11 shadow</code>. A piece with no name reuses the last one.
        Flags: mighty, shadow, purified, lucky, shiny, costume, background, dynamax, gigantamax.
      </p>

      <form onSubmit={check}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="15/12/13 dynamax machop, 13/11/13 gigantamax machamp … (Enter to check, Shift+Enter for a new line)"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) check(e); }}
          style={{ width: "100%", padding: "8px 10px", font: "inherit", resize: "vertical" }} aria-label="Pokémon to check" />
        <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
          <button type="submit" className="btn btn-primary" disabled={!idx}>{idx ? "Check" : "Loading data…"}</button>
          {results && keepers.length > 0 && <button type="button" className="btn" onClick={saveKeepers}>Save {keepers.length} keeper{keepers.length > 1 ? "s" : ""} to box</button>}
          {results && transfers.length > 0 && <button type="button" className="btn" onClick={copyTransfers}>Copy transfer list</button>}
          {msg && <span className="muted">{msg}</span>}
        </div>
      </form>

      {errors.length > 0 && <p className="status error">{errors.join(" · ")}</p>}

      {results && (
        <div style={{ marginTop: "1rem" }}>
          {results.length === 0 && <p className="empty">Nothing recognized.</p>}
          {results.map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: "10px 12px", borderLeft: `4px solid ${VERDICT[r.verdict].color}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ color: VERDICT[r.verdict].color }}>{VERDICT[r.verdict].label}</strong>
                <strong>{r.entry.species.name}</strong>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.entry.ivs.join("/")}</span>
                <span className="muted">{FLAG_ORDER.filter((f) => r.entry.flags[f]).join(" · ")}</span>
                {r.roles.map((c) => <Chip key={jobKey(c)} color={ROLE_COLOR[c.role]}>{jobLabel(jobKey(c))}</Chip>)}
              </div>
              {r.roles.map((c) => (
                <div key={jobKey(c)} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: ROLE_COLOR[c.role] }}>{jobLabel(jobKey(c))}:</span> {c.detail}. <span className="muted">{c.invest}.</span>
                  {c.evo && <span className="muted"> Evolve to {c.evo.to}{c.evo.candy ? `; don't evolve until you have all ${c.evo.candy} candy (one go)` : ""}.</span>}
                  {c.note && <span style={{ color: PALETTE.amber }}> {c.note}.</span>}
                </div>
              ))}
              {r.backup.map((c) => (
                <div key={jobKey(c)} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.blue }}>Backup for {jobLabel(jobKey(c))}</span> behind {c.behind}: {c.detail}. <span className="muted">Hold untouched; promote it if the keeper goes.</span>
                </div>
              ))}
              {r.borderline.map((c) => (
                <div key={c.role} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.amber }}>Borderline for {ROLE_LABEL[c.role]}:</span> {c.detail}. <span className="muted">Your call; hold untouched if unsure.</span>
                </div>
              ))}
              {r.reasons.length > 0 && <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>{r.reasons.join(" · ")}</div>}
              <details style={{ marginTop: 4 }}><summary className="muted" style={{ fontWeight: 400, marginBottom: 0 }}>Why?</summary><Why entry={r.entry} idx={idx} /></details>
            </div>
          ))}
        </div>
      )}

      <details style={{ marginTop: "1.5rem" }}>
        <summary>Your box ({boxEntries.length})</summary>
        {boxEntries.length === 0 && <p className="empty">Keepers you save show up here, and new batches are compared against them.</p>}
        {boxEntries.map((b) => (
          <div key={b.id} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
            <span style={{ minWidth: 180 }}><strong>{b.species.name}</strong> {b.ivs.join("/")}</span>
            <span className="muted">{FLAG_ORDER.filter((f) => b.flags[f]).join(" · ")}</span>
            {b.roles.map((r) => <Chip key={r} color={ROLE_COLOR[r.split(":")[0]]}>{jobLabel(r)}</Chip>)}
            <button className="btn" onClick={() => removeFromBox(b)} aria-label={`Remove ${b.species.name} from box`} style={{ padding: "1px 8px", fontSize: "0.75rem" }}>✕</button>
          </div>
        ))}
      </details>

      {idx && <p className="muted" style={{ marginTop: "1rem" }}>Data: PvPoke rankings from {idx.data.pvpokeTimestamp?.slice(0, 10)}, built {idx.data.built?.slice(0, 10)}. Raid picks = top {RULES.raidTop} in an attacking type (top {RULES.raidXl} = worth XL); PvP = species top {RULES.pvpTop} + IVs top {RULES.ivTop}; Master League = top {RULES.mlTop}. Raid ranks are an estimate, not a full sim.</p>}
    </div>
  );
}

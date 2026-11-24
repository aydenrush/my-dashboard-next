"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import { PALETTE } from "@/lib/constants";
import { indexSpecies, parseBatch, decideBatch, transferList, explain, lookupSpecies, pickableNames, ROLE_LABEL, RULES, BORDER } from "@/lib/pogo";

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

const FLAG_LABEL = { mighty: "Mighty", shadow: "Shadow", purified: "Purified", lucky: "Lucky", shiny: "Shiny", costume: "Costume", background: "Background", dynamax: "Dynamax", gigantamax: "G-Max" };

// quick entry: name (suggested as you type), three IV boxes that jump ahead as you type, tap-to-toggle flags.
// Enter adds to the batch and keeps the name, so a run of the same Pokémon is just IVs + Enter.
function QuickEntry({ idx, onAdd }) {
  const [name, setName] = useState("");
  const [ivs, setIvs] = useState(["", "", ""]); // strings: empty stays empty
  const [flags, setFlags] = useState({});
  const [err, setErr] = useState("");
  const refs = [useRef(null), useRef(null), useRef(null)];
  const names = useMemo(() => pickableNames(idx), [idx]);

  function setIv(i, v) {
    if (!/^\d{0,2}$/.test(v) || Number(v) > 15) return;
    setIvs((p) => p.map((x, j) => (j === i ? v : x)));
    // one digit is complete unless it's a 1 (could be 10–15); two digits always are
    if (i < 2 && (v.length === 2 || (v.length === 1 && v !== "1"))) refs[i + 1].current?.focus();
  }

  function add(e) {
    e?.preventDefault();
    const species = lookupSpecies(name, idx);
    if (!species) return setErr(name.trim() ? `Don't know "${name}"` : "Pick a Pokémon");
    if (ivs.some((v) => v === "")) return setErr("Fill in all three IVs");
    onAdd({ species, ivs: ivs.map(Number), flags });
    setIvs(["", "", ""]); setFlags({}); setErr("");
    refs[0].current?.focus();
  }

  const field = { padding: "6px 8px", font: "inherit" };
  return (
    <form onSubmit={add} className="card" style={{ padding: "10px 12px" }}>
      <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
        <input list="pogo-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pokémon" aria-label="Pokémon" autoFocus
          style={{ ...field, flex: "1 1 180px", minWidth: 0 }} />
        <datalist id="pogo-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        {["Atk", "Def", "HP"].map((label, i) => (
          <input key={label} ref={refs[i]} inputMode="numeric" value={ivs[i]} onChange={(e) => setIv(i, e.target.value)} placeholder={label} aria-label={`${label} IV`}
            style={{ ...field, width: 56, textAlign: "center" }} />
        ))}
        <button type="submit" className="btn btn-primary">Add</button>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        {FLAG_ORDER.map((f) => (
          <button key={f} type="button" aria-pressed={!!flags[f]} onClick={() => setFlags((p) => ({ ...p, [f]: !p[f] }))}
            className={`btn${flags[f] ? " btn-primary" : ""}`} style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0 }}>
            {FLAG_LABEL[f]}
          </button>
        ))}
      </div>
      {err && <p className="status error" style={{ marginTop: 6, marginBottom: 0 }}>{err}</p>}
    </form>
  );
}

export default function PokemonGoPage() {
  const [idx, setIdx] = useState(null);
  const [box, setBox] = useState([]);
  const [batch, setBatch] = useState([]); // [{ id, ivs, flags: [] }], kept in this browser until cleared
  const [paste, setPaste] = useState("");
  const [errors, setErrors] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/pogo-data.json").then((r) => r.json()).then((d) => setIdx(indexSpecies(d))).catch(() => setMsg("Couldn't load the Pokémon data file."));
    try { setBatch(JSON.parse(localStorage.getItem("pogo_batch") || "[]")); } catch {}
    loadBox();
  }, []);
  useEffect(() => { localStorage.setItem("pogo_batch", JSON.stringify(batch)); }, [batch]);

  async function loadBox() {
    const { data } = await supabase.from("pogo_box").select("*").order("created_at");
    if (data) setBox(data);
  }

  const addRows = (entries) => setBatch((b) => [...b, ...entries.map((e) => ({ id: e.species.id, ivs: e.ivs, flags: Object.keys(e.flags).filter((f) => e.flags[f]) }))]);

  // saved box rows -> entries the engine understands
  const boxEntries = useMemo(() => (idx ? box.filter((b) => idx.byId[b.species_id]).map((b) => ({
    id: b.id, species: idx.byId[b.species_id], ivs: [b.atk, b.def, b.hp], flags: Object.fromEntries(b.flags.map((f) => [f, true])), roles: b.roles,
  })) : []), [idx, box]);

  // results update live as the batch changes
  const results = useMemo(() => {
    if (!idx || !batch.length) return null;
    const entries = batch.filter((r) => idx.byId[r.id]).map((r) => ({ species: idx.byId[r.id], ivs: r.ivs, flags: Object.fromEntries(r.flags.map((f) => [f, true])) }));
    const res = decideBatch(entries, idx, boxEntries);
    return ORDER.flatMap((v) => res.filter((r) => r.verdict === v));
  }, [idx, batch, boxEntries]);

  function addPasted() {
    const { entries, errors } = parseBatch(paste, idx);
    setErrors(errors);
    addRows(entries);
    if (!errors.length) setPaste("");
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
      {!idx ? <p className="muted">{msg || "Loading Pokémon data…"}</p> : <QuickEntry idx={idx} onAdd={(e) => addRows([e])} />}

      {idx && batch.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <strong>Batch ({batch.length})</strong>
            {keepers.length > 0 && <button type="button" className="btn" onClick={saveKeepers}>Save {keepers.length} keeper{keepers.length > 1 ? "s" : ""} to box</button>}
            {transfers.length > 0 && <button type="button" className="btn" onClick={copyTransfers}>Copy transfer list</button>}
            <button type="button" className="btn" onClick={() => setBatch([])}>Clear batch</button>
            {msg && <span className="muted">{msg}</span>}
          </div>
          <div className="row">
            {batch.map((r, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: "0.82rem" }}>
                {idx.byId[r.id]?.name} {r.ivs.join("/")}{r.flags.length ? <span className="muted">{r.flags.map((f) => FLAG_LABEL[f]).join(", ")}</span> : null}
                <button type="button" onClick={() => setBatch((b) => b.filter((_, j) => j !== i))} aria-label="Remove from batch" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ fontWeight: 400 }}>Paste a list instead</summary>
        <p className="muted" style={{ marginBottom: 6 }}>e.g. <code>phantump 8/15/15 purified, 14/10/15, 8/13/11 shadow</code> (a piece with no name reuses the last one)</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} style={{ width: "100%", padding: "8px 10px", font: "inherit" }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addPasted(); } }} aria-label="Paste Pokémon" />
        <button type="button" className="btn" onClick={addPasted} disabled={!idx}>Add to batch</button>
      </details>
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

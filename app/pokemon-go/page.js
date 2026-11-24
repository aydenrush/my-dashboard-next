"use client";
import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import { PALETTE } from "@/lib/constants";
import { indexSpecies, parseBatch, decideBatch, transferList, tradeList, explain, lookupSpecies, flagsToList, listToFlags, projects, pickableNames, ROLE_LABEL, RULES, BORDER } from "@/lib/pogo";

const ROLE_COLOR = { raid: PALETTE.rose, max: PALETTE.violet, gl: PALETTE.blue, ul: PALETTE.amber, ml: PALETTE.emerald, gym: PALETTE.slate, trophy: PALETTE.slate };
const FLAG_ORDER = ["mighty", "shadow", "purified", "lucky", "shiny", "costume", "background", "dynamax", "gigantamax", "oneoff", "legacy", "xxl", "old", "keep"];

function Chip({ color, children }) {
  return <span style={{ display: "inline-block", fontSize: "0.72rem", padding: "1px 7px", borderRadius: 999, border: `1px solid ${color}`, color, marginRight: 4 }}>{children}</span>;
}

const cap = (t) => t[0].toUpperCase() + t.slice(1);
const yes = (ok, near) => <span style={{ color: ok ? PALETTE.emerald : near ? PALETTE.amber : PALETTE.rose }} title={ok ? "qualifies" : near ? "borderline" : "doesn't qualify"}>{ok ? "✓" : near ? "≈" : "✗"}</span>;
// "raid" + type -> "Raids · Dragon"; also reads saved box roles like "raid:dragon"
const jobKey = (c) => c.role + (c.rtype ? `:${c.rtype}` : "");
// saved holds are "hold:raid:grass" -> "Hold · Raids · Grass"
const PREFIX = { "hold:": "Hold", "backup:": "Backup", "near:": "Borderline" };
const jobLabel = (key) => { const p = Object.keys(PREFIX).find((x) => key.startsWith(x)); if (p) return `${PREFIX[p]} · ${jobLabel(key.slice(p.length))}`; const [role, type] = key.split(":"); return ROLE_LABEL[role] + (type ? ` · ${cap(type)}` : ""); };
const VERDICT = {
  keep: { label: "KEEP", color: PALETTE.emerald },
  backup: { label: "Backup", color: PALETTE.blue },
  hold: { label: "Hold", color: PALETTE.blue },
  trade: { label: "Trade bait", color: PALETTE.violet },
  borderline: { label: "Borderline", color: PALETTE.amber },
  transfer: { label: "Transfer", color: PALETTE.slate },
};
const ORDER = ["keep", "backup", "borderline", "hold", "trade", "transfer"];
const SECTION = {
  keep: "Keep",
  backup: "Backup (hold untouched)",
  hold: "Hold: hard to replace (legendary, Ultra Beast, regional), waiting on better IVs",
  trade: "Trade bait (hold for trades, never transfer)",
  borderline: "Borderline (your call)",
  transfer: "Transfer (what Copy transfer list copies)",
};

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

const FLAG_LABEL = { mighty: "Mighty", shadow: "Shadow", purified: "Purified", lucky: "Lucky", shiny: "Shiny", costume: "Costume", background: "Background", dynamax: "Dynamax", gigantamax: "G-Max", oneoff: "One-off", legacy: "Legacy move", xxl: "XXL", old: "Old catch", keep: "Keep anyway" };
// 13/14/15 -> "93%" (the in-game appraisal percentage)
// what one evolution step costs: "100 candy", "50 candy + Metal Coat", "999 Gimmighoul Coins"; "?" when the data doesn't say
const evoCost = (t) => [t.candy ? `${t.candy} candy` : t.candy == null ? "? candy" : null, t.evoItem, ...(t.evoNotes || [])].filter(Boolean).join(" + ");
const ivPct = (ivs) => `${Math.round(ivs.reduce((x, y) => x + y, 0) / 0.45)}%`;
const VARIANT = ["costume", "background"]; // these carry a number: which costume/background it is
// { costume: 2, shiny: true } -> "Shiny · Costume 2"
const flagNames = (flags, sep = " · ") => FLAG_ORDER.filter((f) => flags[f]).map((f) => FLAG_LABEL[f] + (flags[f] === true ? "" : ` ${flags[f]}`)).join(sep);

// quick entry: name (suggested as you type), three IV boxes that jump ahead as you type, tap-to-toggle flags.
// Enter adds to the batch and keeps the name, so a run of the same Pokémon is just IVs + Enter.
function QuickEntry({ idx, onAdd, edit, onCancel }) {
  const [name, setName] = useState("");
  const [ivs, setIvs] = useState(["", "", ""]); // strings: empty stays empty
  const [flags, setFlags] = useState({});
  const [err, setErr] = useState("");
  const refs = [useRef(null), useRef(null), useRef(null)];
  const names = useMemo(() => pickableNames(idx), [idx]);
  // our own suggestion list (the browser's datalist pops up in odd places and matches mid-word)
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const sugg = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const starts = names.filter((n) => n.toLowerCase().startsWith(q));
    const words = names.filter((n) => !starts.includes(n) && n.toLowerCase().split(/[ (]/).some((w) => w.startsWith(q)));
    return [...starts, ...words].slice(0, 8);
  }, [name, names]);
  const pick = (n) => { setName(n); setOpen(false); refs[0].current?.focus(); };
  function nameKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); setOpen(true);
      setHi((h) => (sugg.length ? (h + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // Enter here picks the name and moves on to Attack, never submits
      pick(open && sugg[hi] ? sugg[hi] : name);
    } else if (e.key === "Escape") setOpen(false);
  }

  // editing a batch row: load it into the form
  useEffect(() => {
    if (!edit) return;
    setName(idx.byId[edit.id]?.name || ""); setIvs(edit.ivs.map(String)); setFlags(listToFlags(edit.flags)); setErr("");
    refs[0].current?.focus();
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); setOpen(true); setHi(0); }} onKeyDown={nameKey} onBlur={() => setOpen(false)}
            placeholder="Pokémon" aria-label="Pokémon" autoFocus autoComplete="off" role="combobox" aria-expanded={open && sugg.length > 0}
            style={{ ...field, width: "100%", boxSizing: "border-box" }} />
          {open && sugg.length > 0 && (
            <ul role="listbox" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, margin: "2px 0 0", padding: 4, listStyle: "none", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
              {sugg.map((n, i) => (
                <li key={n} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); pick(n); }} onMouseEnter={() => setHi(i)}
                  style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer", background: i === hi ? "var(--bg-secondary)" : "transparent" }}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        {["Atk", "Def", "HP"].map((label, i) => (
          <input key={label} ref={refs[i]} inputMode="numeric" value={ivs[i]} onChange={(e) => setIv(i, e.target.value)} enterKeyHint={i === 2 ? "done" : "next"}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); i === 2 ? add() : refs[i + 1].current?.focus(); } }} placeholder={label} aria-label={`${label} IV`}
            style={{ ...field, width: 56, textAlign: "center" }} />
        ))}
        <button type="submit" className="btn btn-primary">{edit ? "Save" : "Add"}</button>
        {edit && <button type="button" className="btn" onClick={() => { setIvs(["", "", ""]); setFlags({}); setErr(""); onCancel(); }}>Cancel</button>}
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        {FLAG_ORDER.map((f) => (
          <span key={f} style={{ display: "inline-flex", gap: 2 }}>
            <button type="button" aria-pressed={!!flags[f]} onClick={() => setFlags((p) => ({ ...p, [f]: p[f] ? false : VARIANT.includes(f) ? 1 : true }))}
              className={`btn${flags[f] ? " btn-primary" : ""}`} style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0 }}>
              {FLAG_LABEL[f]}
            </button>
            {VARIANT.includes(f) && flags[f] && (
              <select value={flags[f] === true ? "" : flags[f]} onChange={(e) => setFlags((p) => ({ ...p, [f]: Number(e.target.value) || true }))} aria-label={`Which ${f}`} style={{ fontSize: "0.8rem" }}>
                {flags[f] === true && <option value="">?</option>}
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </span>
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
  const [editing, setEditing] = useState(null); // index of the batch row loaded into the form
  const [editingBox, setEditingBox] = useState(null); // or the id of the box row loaded into it

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

  const addRows = (entries) => {
    setMsg("");
    setBatch((b) => [...b, ...entries.map((e) => ({ id: e.species.id, ivs: e.ivs, flags: flagsToList(e.flags) }))]);
  };

  // saved box rows -> entries the engine understands
  const boxEntries = useMemo(() => (idx ? box.filter((b) => idx.byId[b.species_id]).map((b) => ({
    id: b.id, species: idx.byId[b.species_id], ivs: [b.atk, b.def, b.hp], flags: listToFlags(b.flags), roles: b.roles,
  })) : []), [idx, box]);

  // results update live as the batch changes
  // i = the batch row it came from, so a result card can open that row for editing
  const entries = useMemo(() => (idx ? batch.map((r, i) => ({ i, species: idx.byId[r.id], ivs: r.ivs, flags: listToFlags(r.flags) })).filter((e) => e.species) : []), [idx, batch]);
  const results = useMemo(() => {
    if (!idx || !batch.length) return null;
    const res = decideBatch(entries, idx, boxEntries);
    return ORDER.flatMap((v) => res.filter((r) => r.verdict === v));
  }, [idx, batch.length, entries, boxEntries]);
  // per family: which keeper (batch or box) to power up first
  const projectList = useMemo(() => (idx && entries.length ? projects(decideBatch(entries, idx, boxEntries, { includeBox: true })) : []), [idx, entries, boxEntries]);

  function addPasted() {
    const { entries, errors } = parseBatch(paste, idx);
    setErrors(errors);
    addRows(entries);
    if (!errors.length) setPaste("");
  }

  // save results to the box (keepers and holds via the batch button; a borderline or backup one via its own button)
  async function saveToBox(list) {
    const rows = list.map((r) => ({
      species_id: r.entry.species.id, atk: r.entry.ivs[0], def: r.entry.ivs[1], hp: r.entry.ivs[2], flags: flagsToList(r.entry.flags),
      roles: [...r.roles.map(jobKey), ...r.hold.map((g) => `hold:${g.job}`), ...r.backup.map((c) => `backup:${jobKey(c)}`), ...r.borderline.map((c) => `near:${c.role}`)],
    }));
    if (!rows.length) return;
    const { error } = await supabase.from("pogo_box").insert(rows);
    if (error) return;
    // saved ones leave the batch, so they can't be saved twice
    const gone = new Set(list.map((r) => r.entry.i));
    setBatch((b) => b.filter((_, j) => !gone.has(j)));
    setEditing(null);
    setMsg(`Saved ${rows.length} to your box.`);
    loadBox();
  }
  const saveKeepers = () => saveToBox(results.filter((r) => r.keep || r.verdict === "hold"));

  async function copyTrades() {
    await navigator.clipboard.writeText(tradeList(results));
    setMsg("Trade list copied.");
  }

  async function copyTransfers() {
    await navigator.clipboard.writeText(transferList(results));
    setMsg("Transfer list copied.");
  }

  // the box row being edited, in the batch-row shape the form reads (memoized: the form reloads when this changes)
  const boxEdit = useMemo(() => {
    const b = box.find((x) => x.id === editingBox);
    return b ? { id: b.species_id, ivs: [b.atk, b.def, b.hp], flags: b.flags } : null;
  }, [box, editingBox]);

  // save an edited box row in place; its jobs are worked out again against the rest of the box
  async function saveBoxEdit(e) {
    const entry = { id: editingBox, species: e.species, ivs: e.ivs, flags: e.flags };
    const res = decideBatch([], idx, boxEntries.map((b) => (b.id === editingBox ? entry : b)), { includeBox: true });
    const r = res.find((x) => x.entry === entry);
    const { error } = await supabase.from("pogo_box").update({
      species_id: e.species.id, atk: e.ivs[0], def: e.ivs[1], hp: e.ivs[2], flags: flagsToList(e.flags),
      roles: r ? [...r.roles.map(jobKey), ...r.hold.map((g) => `hold:${g.job}`)] : [],
    }).eq("id", editingBox);
    if (error) return;
    setEditingBox(null);
    setMsg(`Updated ${e.species.name} in your box.`);
    loadBox();
  }

  async function removeFromBox(b) {
    if (!(await askConfirm(`Remove ${b.species.name} ${b.ivs.join("/")} from your box?`, { confirmLabel: "Remove" }))) return;
    const { error } = await supabase.from("pogo_box").delete().eq("id", b.id);
    if (!error) { setBox((bx) => bx.filter((x) => x.id !== b.id)); if (editingBox === b.id) setEditingBox(null); }
  }

  const keepers = results?.filter((r) => r.keep || r.verdict === "hold") || [];
  const transfers = results?.filter((r) => r.verdict === "transfer") || [];
  const tradeBait = results?.filter((r) => r.verdict === "trade") || [];
  // one Dex evolve hint per family, on the most-evolved transfer that can still evolve: every branch (Eevee, Gloom...)
  // to its final stage. Stages you obviously have (in the batch or box) are registered already, so paths stop before them.
  const branches = (s) => {
    const next = s.evolutions.map((id) => idx?.byId[id]).filter(Boolean);
    return next.length ? next.flatMap((t) => branches(t).map((p) => [t, ...p])) : [[]];
  };
  const owned = new Set([...(results || []), ...boxEntries.map((entry) => ({ entry }))].map((r) => r.entry.species.id));
  const dexHint = new Map(); // result -> [path of stages, ...]
  const best = {};
  for (const r of transfers) {
    const paths = branches(r.entry.species).map((p) => p.slice(0, p.findLastIndex((t) => !owned.has(t.id)) + 1)).filter((p) => p.length);
    const size = paths.reduce((n, p) => n + p.length, 0);
    const cur = best[r.entry.species.family];
    if (paths.length && (!cur || size < cur.size)) best[r.entry.species.family] = { r, paths, size };
  }
  for (const { r, paths } of Object.values(best)) dexHint.set(r, paths);

  return (
    <div>
      <h1 className="page-title">Pokémon GO</h1>
      {!idx ? <p className="muted">{msg || "Loading Pokémon data…"}</p> : <QuickEntry idx={idx} edit={editing === null ? boxEdit : batch[editing]} onCancel={() => { setEditing(null); setEditingBox(null); }}
        onAdd={(e) => {
          if (editingBox) return saveBoxEdit(e);
          if (editing === null) return addRows([e]);
          setBatch((b) => b.map((r, j) => (j === editing ? { id: e.species.id, ivs: e.ivs, flags: flagsToList(e.flags) } : r)));
          setEditing(null);
        }} />}

      {idx && batch.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <strong>Batch ({batch.length})</strong>
            {keepers.length > 0 && <button type="button" className="btn" onClick={saveKeepers}>Save {keepers.length} to box</button>}
            {tradeBait.length > 0 && <button type="button" className="btn" onClick={copyTrades}>Copy trade list</button>}
            {transfers.length > 0 && <button type="button" className="btn" onClick={copyTransfers}>Copy transfer list</button>}
            <button type="button" className="btn" onClick={() => { setBatch([]); setEditing(null); }}>Clear batch</button>
            {msg && <span className="muted">{msg}</span>}
          </div>
          <div className="row">
            {batch.map((r, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${editing === i ? "var(--accent)" : "var(--border)"}`, borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: "0.82rem" }}>
                <button type="button" onClick={() => { setEditing(i); setEditingBox(null); }} title="Edit" style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
                  {idx.byId[r.id]?.name} {r.ivs.join("/")} <span className="muted">{ivPct(r.ivs)}</span>{r.flags.length ? <span className="muted"> {flagNames(listToFlags(r.flags), ", ")}</span> : null}
                </button>
                <button type="button" onClick={() => { setBatch((b) => b.filter((_, j) => j !== i)); setEditing(null); }} aria-label="Remove from batch" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
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

      {projectList.length > 0 && (
        <details open className="card" style={{ marginTop: "1rem", padding: "10px 12px" }}>
          <summary>Projects: what to power up first</summary>
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>Per family, best investment first (your box included). Already done #1? Look at the next one.</p>
          {projectList.map((p) => (
            <div key={p.family} style={{ marginBottom: 8 }}>
              <strong>{p.items[0].jobs[0].target.name.replace(/ \(.*\)$/, "")} line</strong>
              <ol style={{ margin: "4px 0 0", paddingLeft: 22, fontSize: "0.85rem" }}>
                {p.items.map((x, i) => {
                  const e = x.result.entry, j = x.jobs[0];
                  return (
                    <li key={i} style={{ marginBottom: 2 }}>
                      <strong>{e.species.name} {e.ivs.join("/")}</strong> <span className="muted">{ivPct(e.ivs)}</span>{flagNames(e.flags) && <span className="muted"> {flagNames(e.flags, ", ")}</span>}
                      {x.result.fromBox && <span className="muted"> (in your box)</span>}{x.backup && <span className="muted"> (backup)</span>}
                      {" "}<Chip color={ROLE_COLOR[j.role]}>{jobLabel(jobKey(j))}</Chip>
                      {x.jobs.slice(1).map((o) => <Chip key={jobKey(o)} color={ROLE_COLOR[o.role]}>{jobLabel(jobKey(o))}</Chip>)}
                      <span className="muted">{x.backup ? "Only if the keeper above goes." : `${j.evo ? `Evolve to ${j.evo.to}${j.evo.candy ? ` (${j.evo.candy} candy${j.evo.items?.length ? ` + ${j.evo.items.join(" + ")}` : ""})` : ""}, then ` : ""}${j.invest[0].toLowerCase() + j.invest.slice(1)}.`}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </details>
      )}

      {results && (
        <div style={{ marginTop: "1rem" }}>
          {results.length === 0 && <p className="empty">Nothing recognized.</p>}
          {results.map((r, i) => (
            <Fragment key={i}>
            {(i === 0 || results[i - 1].verdict !== r.verdict) && (
              <h3 style={{ fontSize: "0.9rem", color: VERDICT[r.verdict].color, margin: "14px 0 6px" }}>
                {SECTION[r.verdict]} · {results.filter((x) => x.verdict === r.verdict).length}
              </h3>
            )}
            <div className="card" style={{ marginBottom: 8, padding: "10px 12px", borderLeft: `4px solid ${VERDICT[r.verdict].color}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ color: VERDICT[r.verdict].color }}>{VERDICT[r.verdict].label}</strong>
                {r.entry.i != null && (r.verdict === "borderline" || r.verdict === "backup") && (
                  <button type="button" className="btn" onClick={() => saveToBox([r])} style={{ order: 98, marginLeft: "auto", padding: "1px 10px", fontSize: "0.75rem", minHeight: 0 }}>Save to box</button>
                )}
                {r.entry.i != null && (
                  <button type="button" className="btn" onClick={() => { setEditing(r.entry.i); setEditingBox(null); }} aria-label={`Edit ${r.entry.species.name}`}
                    style={{ order: 99, marginLeft: r.verdict === "borderline" || r.verdict === "backup" ? 0 : "auto", padding: "1px 10px", fontSize: "0.75rem", minHeight: 0 }}>Edit</button>
                )}
                <strong>{r.entry.species.name}</strong>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.entry.ivs.join("/")}</span>
                <span className="muted">{ivPct(r.entry.ivs)}</span>
                <span className="muted">{flagNames(r.entry.flags)}</span>
                {r.roles.map((c) => <Chip key={jobKey(c)} color={ROLE_COLOR[c.role]}>{jobLabel(jobKey(c))}</Chip>)}
              </div>
              {r.roles.map((c) => (
                <div key={jobKey(c)} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: ROLE_COLOR[c.role] }}>{jobLabel(jobKey(c))}:</span> {c.detail}. <span className="muted">{c.invest}.</span>
                  {c.evo && <span className="muted"> Evolve to {c.evo.to}{c.evo.candy ? `; don't evolve until you have all ${c.evo.candy} candy (one go)` : ""}{c.evo.items?.length ? `; needs ${c.evo.items.join(" + ")}` : ""}.</span>}
                  {c.note && <span style={{ color: PALETTE.amber }}> {c.note}.</span>}
                </div>
              ))}
              {r.backup.map((c) => (
                <div key={jobKey(c)} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.blue }}>Backup for {jobLabel(jobKey(c))}</span> behind {c.behind}: {c.detail}. <span className="muted">Hold untouched; promote it if the keeper goes.</span>
                </div>
              ))}
              {r.trade.map((c) => (
                <div key={c.kind} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.violet }}>Trade bait:</span> {c.behind ? <>duplicate {c.kind}, you already keep {c.behind}.</> : <>{c.note}.</>} <span className="muted">Don't power it up; trade it.</span>
                </div>
              ))}
              {r.hold.map((g) => (
                <div key={g.job} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.blue }}>Good species for {g.label}</span> ({g.what}), but it needs {g.needs}. <span className="muted">Nothing better yet: hold it untouched (no candy or Stardust) and transfer it once a better one turns up.</span>
                  {g.replaces && <span style={{ color: PALETTE.amber }}> Better than your box's {g.replaces}: transfer that one and remove it from your box.</span>}
                </div>
              ))}
              {r.speciesNote && <div style={{ fontSize: "0.85rem", marginTop: 4 }}>{r.speciesNote}</div>}
              {r.borderline.map((c) => (
                <div key={c.role} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: PALETTE.amber }}>Borderline for {ROLE_LABEL[c.role]}:</span> {c.detail}. <span className="muted">Your call; hold untouched if unsure.</span>
                </div>
              ))}
              {r.reasons.length > 0 && <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>{r.reasons.join(" · ")}</div>}
              {dexHint.has(r) && (
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  {dexHint.get(r).length === 1
                    ? <>Dex: if {dexHint.get(r)[0].map((t) => t.name).join(" or ")} {dexHint.get(r)[0].length > 1 ? "aren't" : "isn't"} registered yet, evolve this one to {dexHint.get(r)[0].at(-1).name} first ({dexHint.get(r)[0].map(evoCost).join(", then ")}), then transfer.</>
                    : <>Dex: evolve spares into any you haven't registered, then transfer: {dexHint.get(r).map((p) => `${p.at(-1).name} (${p.map(evoCost).join(", then ")})`).join("; ")}.</>}
                </div>
              )}
              <details style={{ marginTop: 4 }}><summary className="muted" style={{ fontWeight: 400, marginBottom: 0 }}>Why?</summary><Why entry={r.entry} idx={idx} /></details>
            </div>
            </Fragment>
          ))}
        </div>
      )}

      <details style={{ marginTop: "1.5rem" }}>
        <summary>Your box ({boxEntries.length})</summary>
        {boxEntries.length === 0 && <p className="empty">Keepers you save show up here, and new batches are compared against them.</p>}
        {boxEntries.map((b) => (
          <div key={b.id} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
            <span style={{ minWidth: 180 }}><strong>{b.species.name}</strong> {b.ivs.join("/")} <span className="muted">{ivPct(b.ivs)}</span></span>
            <span className="muted">{flagNames(b.flags)}</span>
            {b.roles.map((r) => <Chip key={r} color={r.startsWith("near:") ? PALETTE.amber : r.startsWith("hold:") || r.startsWith("backup:") ? PALETTE.blue : ROLE_COLOR[r.split(":")[0]]}>{jobLabel(r)}</Chip>)}
            <button className="btn" onClick={() => { setEditingBox(b.id); setEditing(null); }} aria-label={`Edit ${b.species.name} in box`}
              style={{ padding: "1px 8px", fontSize: "0.75rem", borderColor: editingBox === b.id ? "var(--accent)" : undefined }}>Edit</button>
            <button className="btn" onClick={() => removeFromBox(b)} aria-label={`Remove ${b.species.name} from box`} style={{ padding: "1px 8px", fontSize: "0.75rem" }}>✕</button>
          </div>
        ))}
      </details>

      {idx && <p className="muted" style={{ marginTop: "1rem" }}>Data: PvPoke rankings from {idx.data.pvpokeTimestamp?.slice(0, 10)}, built {idx.data.built?.slice(0, 10)}. Raid picks = top {RULES.raidTop} in an attacking type (top {RULES.raidXl} = worth XL); PvP = species top {RULES.pvpTop} + IVs top {RULES.ivTop}; Master League = top {RULES.mlTop}. Raid ranks are an estimate, not a full sim.</p>}
    </div>
  );
}

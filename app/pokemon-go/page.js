"use client";
import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import { getSetting, setSetting } from "@/lib/settings";
import { PALETTE } from "@/lib/constants";
import { indexSpecies, parseBatch, decideBatch, transferList, tradeList, explain, lookupSpecies, flagsToList, listToFlags, projects, wanted, pickableNames, ROLE_LABEL, RULES, BORDER } from "@/lib/pogo";

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
      <div className="muted">Attack {entry.ivs[0]} {yes(w.raidAtk)} {w.raidAtk ? "meets" : "misses"} your {w.minAtk}-Attack rule{entry.flags.mighty ? " (13 for a Mighty: it is already level 40+)" : ""}. Counts if a form is top {w.rules.raidTop} in some type (≈ = top {BORDER.raidTop}).</div>
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
// "Dragon / Ground" next to a name (the data pads single types with "none")
const Types = ({ s }) => <span className="muted" style={{ fontSize: "0.78rem" }}> {s.types.filter((t) => t && t !== "none").map(cap).join(" / ")}</span>;
const ivPct = (ivs) => `${Math.round(ivs.reduce((x, y) => x + y, 0) / 0.45)}%`;
const VARIANT = ["costume", "background"]; // these carry a number: which costume/background it is
// { costume: 2, shiny: true } -> "Shiny · Costume 2"
const flagNames = (flags, sep = " · ") => FLAG_ORDER.filter((f) => flags[f]).map((f) => FLAG_LABEL[f] + (flags[f] === true ? "" : ` ${flags[f]}`)).join(sep);

// "Evolve…" picker listing every later stage (all branches); picking one records that you evolved it in the game
function EvolveSelect({ s, idx, onPick }) {
  const opts = [];
  const walk = (x) => { for (const id of x.evolutions) { const t = idx.byId[id]; if (t && !opts.includes(t)) { opts.push(t); walk(t); } } };
  walk(s);
  if (!opts.length) return null;
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} aria-label={`Evolve ${s.name}`} style={{ fontSize: "0.75rem", order: 97 }}>
      <option value="">Evolve…</option>
      {opts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

// the whole evolution line, every branch: "Gible → Gabite (25 candy) → Garchomp (100 candy) → Mega Garchomp",
// with this Pokémon in bold. Shadows can't Mega Evolve, so their line stops before the Mega.
// family: every box Pokémon in this line ({ b, tags, n }), already in Top projects order; n = its Top projects number
function EvoLine({ s, idx, flags, family = [], selfId }) {
  let root = s;
  while (root.parent && idx.byId[root.parent]) root = idx.byId[root.parent];
  const paths = (t) => { const next = t.evolutions.map((id) => idx.byId[id]).filter(Boolean); return next.length ? next.flatMap((n) => paths(n).map((p) => [t, ...p])) : [[t]]; };
  // each Mega is its own line (Charizard has X and Y)
  const lines = paths(root).flatMap((p) => { const megas = flags.shadow ? [] : idx.data.species.filter((m) => (m.id.startsWith(`${p.at(-1).id}_mega`) || m.id === `${p.at(-1).id}_primal`)); return megas.length ? megas.map((m) => [...p, m]) : [p]; });
  if (lines.every((l) => l.length === 1) && family.length < 2) return null;
  const members = family;
  return (
    <details style={{ marginTop: 4 }}>
      <summary className="muted" style={{ fontWeight: 400, marginBottom: 0 }}>Evo line</summary>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: "0.82rem", marginTop: 4 }}>
          {l.map((t, k) => (
            <Fragment key={t.id}>
              {k > 0 && " → "}
              <span style={{ fontWeight: t.id === s.id ? 700 : 400 }}>{t.name}</span>
              {k > 0 && <span className="muted"> ({t.tags.includes("mega") ? "Mega Energy" : evoCost(t) || "free"})</span>}
            </Fragment>
          ))}
        </div>
      ))}
      {members.length > 0 && (
        <div style={{ marginTop: 8, fontSize: "0.82rem" }}>
          <div className="muted" style={{ marginBottom: 2 }}>In your box ({members.length})</div>
          {members.map(({ b, tags, n }) => (
            <div key={b.id} style={{ marginTop: 3, fontWeight: b.id === selfId ? 700 : 400 }}>
              <span className="muted" style={{ display: "inline-block", minWidth: 28 }}>{n ? `#${n}` : "–"}</span>
              {b.species.name} <span style={{ fontVariantNumeric: "tabular-nums" }}>{b.ivs.join("/")}</span> <span className="muted">{ivPct(b.ivs)}</span>
              {flagNames(b.flags) && <span className="muted"> · {flagNames(b.flags, ", ")}</span>}
              {b.roles.includes("done") && <span className="muted"> · done</span>}{" "}
              {tags.length ? tags.map((t) => <Chip key={t} color={t.startsWith("near:") ? PALETTE.amber : t.startsWith("hold:") || t.startsWith("backup:") ? PALETTE.blue : ROLE_COLOR[t.split(":")[0]]}>{jobLabel(t)}</Chip>)
                : <span className="muted">no job now</span>}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

// what to catch for a Wanted pick: the line from its first stage up to it, with each step's cost.
// Any stage counts (evolve it up); a Shadow pick needs Shadow ones, a Mega/Primal needs the base form plus Mega Energy.
function CatchLine({ t, idx }) {
  const base = idx.byId[t.id.replace(/_shadow$|_(mega|primal).*$/, "")] || t;
  const chain = [base];
  while (chain[0].parent && idx.byId[chain[0].parent]) chain.unshift(idx.byId[chain[0].parent]);
  const shadow = t.tags.includes("shadow"), mega = !shadow && t.id !== base.id;
  return (
    <div style={{ fontSize: "0.82rem", marginLeft: 2 }}>
      <span className="muted">Catch{chain.length > 1 ? " any stage" : ""}:</span>{" "}
      {chain.map((c, k) => (
        <Fragment key={c.id}>
          {k > 0 && " → "}
          <span style={{ fontWeight: k === 0 ? 600 : 400 }}>{shadow ? "Shadow " : ""}{c.name}</span>
          {k > 0 && <span className="muted"> ({evoCost(c) || "free"})</span>}
        </Fragment>
      ))}
      {mega && <> → {t.name} <span className="muted">(Mega Energy)</span></>}
    </div>
  );
}

// elite = top of its job: top-5 raider, top-10 Great/Ultra League, top-5 Master League, 85%+ Max attacker or G-Max.
// When a Pokémon can do several jobs, this says which to build it for (every elite one, else its best one).
const ELITE = { raid: 5, gl: 10, ul: 10, ml: 5 };
const jobRank = (j) => j.rank ?? (j.role === "raid" ? j.raidRank : j.role === "gl" || j.role === "ul" ? j.target?.[j.role] : j.role === "ml" ? j.target?.ml : null);
const isElite = (j) => (j.role === "max" ? j.pct >= 85 || /^Gigantamax/.test(j.detail || "") : ELITE[j.role] != null && jobRank(j) != null && jobRank(j) <= ELITE[j.role]);
function Recommend({ jobs, labelOf }) {
  if (jobs.length < 2) return null;
  const elite = jobs.filter(isElite);
  const pick = elite.length ? elite : [jobs[0]];
  return (
    <div style={{ fontSize: "0.85rem", marginTop: 4 }}>
      <span className="muted">{elite.length > 1 ? "Elite at:" : "Recommended:"}</span> <strong>{pick.map(labelOf).join(", ")}</strong>
      {elite.length > 1 && <span className="muted"> (worth building for {elite.length === 2 ? "both" : "all of them"})</span>}
    </div>
  );
}

// one project: rank, Pokémon, its jobs, and what to do (evolve / power up), with Done when it's in your box
function ProjectCard({ n, x, idx, onDone, onEvolve, inBox, family }) {
  const e = x.result.entry, j = x.jobs[0];
  return (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", marginBottom: 6 }}>
      <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--muted)", minWidth: 24, textAlign: "right", lineHeight: 1.2 }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>
          <strong>{e.species.name}</strong><Types s={e.species} /> <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: 6 }}>{e.ivs.join("/")}</span> <span className="muted">{ivPct(e.ivs)}</span>
          {flagNames(e.flags) && <span className="muted"> · {flagNames(e.flags, ", ")}</span>}
          {x.result.fromBox && !inBox && <span className="muted"> · in your box</span>}
        </div>
        <div style={{ marginTop: 4 }}>{x.jobs.map((o) => <Chip key={jobKey(o)} color={ROLE_COLOR[o.role]}>{jobLabel(jobKey(o))}</Chip>)}</div>
        {!x.near && !x.backup && <Recommend jobs={x.jobs} labelOf={(o) => jobLabel(jobKey(o))} />}
        {x.near ? x.jobs.map((c) => <div key={c.role} style={{ fontSize: "0.85rem", marginTop: 6 }}><span className="muted">Borderline:</span> {c.detail}</div>)
          : x.backup ? <div style={{ fontSize: "0.85rem", marginTop: 6 }}><span className="muted">Backup:</span> only if the one above goes</div> : <>
          {j.evo && !j.evo.to && <div style={{ fontSize: "0.85rem", marginTop: 6 }}><span className="muted">Mega:</span> Mega Evolve it for raids (needs Mega Energy)</div>}
          {j.evo?.to && (
            <div style={{ fontSize: "0.85rem", marginTop: 6 }}>
              <span className="muted">Evolve:</span> {j.evo.to}{j.evo.candy ? ` · ${j.evo.candy} candy` : ""}{j.evo.items?.length ? ` · ${j.evo.items.join(", ")}` : ""}
            </div>
          )}
          <div style={{ fontSize: "0.85rem", marginTop: j.evo ? 2 : 6 }}><span className="muted">Power up:</span> {j.invest}</div>
          {x.jobs.filter((o) => o.moves).map((o) => (
            <div key={jobKey(o)} style={{ fontSize: "0.85rem", marginTop: 2 }}>
              <span className="muted">Moves{x.jobs.filter((q) => q.moves).length > 1 ? ` (${jobLabel(jobKey(o))})` : ""}:</span> {o.moves}
            </div>
          ))}
        </>}
        {inBox && <EvoLine s={e.species} idx={idx} flags={e.flags} family={family} selfId={e.id} />}
        <details style={{ marginTop: 4 }}><summary className="muted" style={{ fontWeight: 400, marginBottom: 0 }}>Why?</summary><Why entry={e} idx={idx} /></details>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {onEvolve && j.evo?.to && !x.backup && (
          <button type="button" className="btn" onClick={() => onEvolve(j.target.id.replace(/_shadow$|_(mega|primal).*$/, ""))} title={`Mark it evolved to ${j.evo.to.replace(/, then Mega Evolve$/, "")}`}
            style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0 }}>Evolved</button>
        )}
        {onDone && <button type="button" className="btn" onClick={onDone} style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0 }}>Done</button>}
      </div>
    </div>
  );
}

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
  // candy you have per family ({ FAMILY_GIBLE: "87" }), typed in the Buddy plan; strings so an empty box stays empty.
  // Saved to the settings table so it follows you between devices.
  const [candyHave, setCandyHave] = useState({});
  const candyLoaded = useRef(false);
  useEffect(() => { getSetting("pogo_candy").then((v) => { if (v) setCandyHave(v); candyLoaded.current = true; }); }, []);
  useEffect(() => {
    if (!candyLoaded.current) return;
    const t = setTimeout(() => setSetting("pogo_candy", Object.fromEntries(Object.entries(candyHave).filter(([, v]) => v !== ""))), 600);
    return () => clearTimeout(t);
  }, [candyHave]);
  const [tab, setTabState] = useState("check"); // Check / Plan / Box, remembered on this device
  useEffect(() => { const t = localStorage.getItem("pogo_tab"); if (t) setTabState(t); }, []);
  const setTab = (t) => { setTabState(t); localStorage.setItem("pogo_tab", t); };
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [boxQ, setBoxQ] = useState(""); // box search / filter / sort
  const [boxFilter, setBoxFilter] = useState("all");
  const [boxSort, setBoxSort] = useState("newest");

  useEffect(() => {
    fetch("/pogo-data.json").then((r) => r.json()).then((d) => setIdx(indexSpecies(d))).catch(() => setMsg("Couldn't load the Pokémon data file."));
    try { setBatch(JSON.parse(localStorage.getItem("pogo_batch") || "[]")); } catch {}
    loadBox();
  }, []);
  useEffect(() => { localStorage.setItem("pogo_batch", JSON.stringify(batch)); }, [batch]);

  async function loadBox() {
    const { data } = await supabase.from("pogo_box").select("*").order("created_at").order("id"); // id breaks ties: rows saved in one click share a timestamp
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
  // everything, including ones the rules say to trade or transfer: asks first, since that breaks zero-waste
  async function saveAll() {
    const extra = results.filter((r) => !r.keep && r.verdict !== "hold").length;
    if (extra && !(await askConfirm(`Save all ${results.length} to your box? ${extra} of them aren't keepers (borderline, backup, trade bait or transfer).`, { confirmLabel: "Save all" }))) return;
    saveToBox(results);
  }

  async function copyTrades() {
    await navigator.clipboard.writeText(tradeList(results));
    setMsg("Trade list copied.");
  }

  async function copyTransfers() {
    await navigator.clipboard.writeText(transferList(results));
    setMsg("Transfer list copied.");
  }

  // box tags are worked out live from the whole box (saved roles go stale when another box row changes).
  // A saved Hold has no live job, so it keeps its saved hold tag.
  const boxView = useMemo(() => (idx && boxEntries.length ? decideBatch([], idx, boxEntries, { includeBox: true }) : []), [idx, boxEntries]);
  // box Pokémon that are only borderline (no real job): listed under Top projects as "your call"
  const boxBorderline = boxView.filter((r) => r.borderline.length && !r.roles.some((c) => c.role !== "trophy") && !r.entry.roles.includes("done"))
    .map((r) => ({ result: r, jobs: r.borderline, near: true }));
  const boxTags = useMemo(() => {
    const res = boxView;
    return new Map(res.map((r) => [r.entry.id, [...r.roles.map(jobKey), ...r.backup.map((c) => `backup:${jobKey(c)}`), ...r.borderline.map((c) => `near:${c.role}`)]]));
  }, [boxView]);
  // the whole box ranked by what to power up next; ones you mark Done (stored as "done" in roles) drop off
  const boxProjects = useMemo(() => (idx && boxEntries.length
    ? projects(boxView, { all: true }).flatMap((p) => p.items).filter((x) => !x.backup).sort((x, y) => y.value - x.value)
    : []), [idx, boxEntries]);
  // you evolved a box Pokémon in the game: switch its species (IVs and flags carry over)
  async function evolveBox(b, id) {
    const { error } = await supabase.from("pogo_box").update({ species_id: id }).eq("id", b.id);
    if (error) return;
    setBox((bx) => bx.map((x) => (x.id === b.id ? { ...x, species_id: id } : x)));
    setMsg(`${b.species.name} evolved to ${idx.byId[id].name}.`);
  }

  // Plan shows the top 10 projects and top 10 borderline; Buddy plan and numbers follow what's shown
  const openProjects = boxProjects.filter((x) => !x.result.entry.roles.includes("done"));
  // one search / job filter / sort bar for the whole Plan tab; lists filter first, then show their top 10.
  // Numbers stay each Pokémon's overall rank, so #14 is still #14 when a filter puts it on screen.
  const [planQ, setPlanQ] = useState("");
  const [planJob, setPlanJob] = useState("all");
  const [planSort, setPlanSort] = useState("rank");
  const JOB_GROUPS = { all: "All jobs", raid: "Raids", pvp: "Great / Ultra", ml: "Master League", max: "Max Battles", gym: "Gym" };
  const inGroup = (role) => planJob === "all" || (planJob === "pvp" ? role === "gl" || role === "ul" : role === planJob);
  const planMatch = (name, roles) => (!planQ.trim() || name.toLowerCase().includes(planQ.trim().toLowerCase())) && roles.some(inGroup);
  const ivSum = (e) => e.ivs.reduce((p, q) => p + q, 0);
  const planSorted = (list) => (planSort === "rank" ? list
    : [...list].sort(planSort === "name" ? (x, y) => x.result.entry.species.name.localeCompare(y.result.entry.species.name) : (x, y) => ivSum(y.result.entry) - ivSum(x.result.entry)));
  const projNum = new Map(openProjects.map((x, i) => [x.result.entry.id, i + 1]));
  const topList = planSorted(openProjects.filter((x) => planMatch(x.result.entry.species.name, x.jobs.map((j) => j.role)))).slice(0, 10);
  const borderNum = new Map(boxBorderline.map((x, i) => [x.result.entry.id, openProjects.length + i + 1]));
  const borderShown = planSorted(boxBorderline.filter((x) => planMatch(x.result.entry.species.name, x.jobs.map((j) => j.role)))).slice(0, 10);

  // buddy plan: projects whose evolution needs a buddy (walk km, hearts, buddy quests), then the top projects that
  // want XL Candy (walking a buddy earns it). Numbers match Top projects.
  // walk for evolution candy: the top projects that still need to evolve (one per family; buddy candy goes to the
  // whole family). km = candy still needed x the walker's km per candy (Magikarp 1, Gible 5).
  const walkFams = new Set();
  const buddyWalk = topList.map((x) => ({ x, n: projNum.get(x.result.entry.id), job: x.jobs.find((j) => j.evo?.to && j.evo.candy > 0) }))
    .filter(({ x, job }) => job && x.result.entry.species.buddyKm && !walkFams.has(x.result.entry.species.family) && walkFams.add(x.result.entry.species.family))
    .slice(0, 5)
    .map((b) => {
      const fam = b.x.result.entry.species.family, have = parseInt(candyHave[fam]);
      const left = Math.max(0, b.job.evo.candy - (Number.isNaN(have) ? 0 : have));
      return { ...b, fam, left, km: left * b.x.result.entry.species.buddyKm, known: !Number.isNaN(have) };
    });
  // meta picks for jobs the box doesn't cover yet
  const wantedList = useMemo(() => (idx ? wanted(boxView, idx) : []), [idx, boxView]);
  const shownWanted = wantedList.filter((w) => planMatch(w.species.name, w.jobs.map((j) => j.job.split(":")[0])))
    .sort((x, y) => (planSort === "name" ? x.species.name.localeCompare(y.species.name) : 0));
  // Rare Candy (and XL) turns into any species' candy, so spend it where candy is hard to farm: legendaries, mythicals,
  // Ultra Beasts and 20 km buddies first (raid-only candy), then 5 km lines; common 1-3 km lines you can just walk.
  const rareCandy = openProjects.map((x) => {
    const sp = x.result.entry.species, fam = sp.family;
    const hard = ["legendary", "mythical", "ultrabeast"].some((t) => sp.tags.includes(t)) || sp.buddyKm >= 20 ? 2 : sp.buddyKm >= 5 ? 1 : 0;
    const evoJob = x.jobs.find((j) => j.evo?.to && j.evo.candy > 0);
    const have = parseInt(candyHave[fam]);
    const left = evoJob ? Math.max(0, evoJob.evo.candy - (Number.isNaN(have) ? 0 : have)) : 0;
    const xl = x.jobs.some((j) => /XL Candy is worth it|XL Candy only/.test(j.invest)) && !x.result.entry.flags.mighty;
    const use = left > 0 ? `Rare Candy for the evolution (${Number.isNaN(have) ? "up to " : ""}${left} more to ${evoJob.evo.to.replace(/, then Mega Evolve$/, "")})`
      : xl ? "Rare Candy XL to power it past level 40" : "Rare Candy for power-ups";
    return { x, n: projNum.get(x.result.entry.id), hard, use, why: hard === 2 ? "candy only comes from raids / 20 km walks" : "5 km per candy" };
  }).filter((r) => r.hard > 0 && planMatch(r.x.result.entry.species.name, r.x.jobs.map((j) => j.role)))
    .sort((a, b) => b.hard - a.hard || a.n - b.n).slice(0, 5);
  const buddyEvolve = topList.map((x) => ({ x, n: projNum.get(x.result.entry.id), job: x.jobs.find((j) => j.evo?.items?.some((t) => /buddy/.test(t))) }))
    .filter((b) => b.job).map((b) => ({ ...b, need: b.job.evo.items.filter((t) => /buddy/.test(t)) }));
  // buddy candy goes to the whole family, so one per family
  const xlFams = new Set();
  const buddyXl = topList.map((x) => ({ x, n: projNum.get(x.result.entry.id) }))
    .filter(({ x }) => x.jobs.some((j) => /XL Candy is worth it|XL Candy only/.test(j.invest)) && !xlFams.has(x.result.entry.species.family) && xlFams.add(x.result.entry.species.family))
    .slice(0, 3);

  async function toggleDone(b) {
    const roles = b.roles.includes("done") ? b.roles.filter((r) => r !== "done") : [...b.roles, "done"];
    const { error } = await supabase.from("pogo_box").update({ roles }).eq("id", b.id);
    if (!error) setBox((bx) => bx.map((x) => (x.id === b.id ? { ...x, roles } : x)));
  }
  // a family's box Pokémon in Top projects order (projects, then borderline, then the rest by IVs), with their numbers
  const familyRows = (fam) => {
    const num = new Map([...projNum, ...borderNum]);
    const pos = new Map([...boxProjects, ...boxBorderline].map((x, i) => [x.result.entry.id, i]));
    const sum = (b) => b.ivs.reduce((p, q) => p + q, 0);
    return boxEntries.filter((b) => b.species.family === fam)
      .sort((x, y) => (pos.get(x.id) ?? 1e9) - (pos.get(y.id) ?? 1e9) || sum(y) - sum(x))
      .map((b) => ({ b, tags: tagsFor(b), n: num.get(b.id) }));
  };
  const tagsFor = (b) => { const live = boxTags.get(b.id) || []; return live.length ? live : b.roles.filter((r) => r.startsWith("hold:")); };

  // reload the box from Supabase and rewrite each row's saved tags to what the rules say now (Done marks kept)
  const [boxMsg, setBoxMsg] = useState("");
  async function refreshBox() {
    setBoxMsg("Refreshing…");
    const stale = boxEntries.map((b) => ({ b, roles: [...tagsFor(b), ...(b.roles.includes("done") ? ["done"] : [])] }))
      .filter(({ b, roles }) => roles.join() !== b.roles.join());
    const res = await Promise.all(stale.map(({ b, roles }) => supabase.from("pogo_box").update({ roles }).eq("id", b.id)));
    await loadBox();
    setBoxMsg(res.some((r) => r.error) ? "Some rows didn't save; try again." : `Refreshed: ${stale.length} row${stale.length === 1 ? "" : "s"} had old tags.`);
  }

  // the box list after search, filter and sort
  const BOX_FILTERS = {
    all: ["All", () => true],
    job: ["Has a job", (b) => tagsFor(b).some((t) => !t.startsWith("hold:"))],
    nojob: ["No job now", (b) => tagsFor(b).length === 0],
    hold: ["Hold", (b) => tagsFor(b).some((t) => t.startsWith("hold:"))],
    done: ["Done", (b) => b.roles.includes("done")],
    raid: ["Raids", (b) => tagsFor(b).some((t) => t.startsWith("raid"))],
    pvp: ["PvP", (b) => tagsFor(b).some((t) => /^(gl|ul|ml)/.test(t))],
    max: ["Max", (b) => tagsFor(b).some((t) => t.startsWith("max"))],
    gym: ["Gym", (b) => tagsFor(b).includes("gym")],
    shiny: ["Shiny", (b) => b.flags.shiny],
    shadow: ["Shadow", (b) => b.flags.shadow],
  };
  const boxList = useMemo(() => {
    const q = boxQ.trim().toLowerCase();
    const rank = new Map(boxProjects.map((x, i) => [x.result.entry.id, i]));
    const sum = (b) => b.ivs.reduce((x, y) => x + y, 0);
    const sorts = {
      newest: (x, y) => boxEntries.indexOf(y) - boxEntries.indexOf(x),
      name: (x, y) => x.species.name.localeCompare(y.species.name),
      iv: (x, y) => sum(y) - sum(x),
      atk: (x, y) => y.ivs[0] - x.ivs[0] || sum(y) - sum(x),
      project: (x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9),
    };
    return boxEntries.filter((b) => (!q || b.species.name.toLowerCase().includes(q)) && BOX_FILTERS[boxFilter][1](b)).sort(sorts[boxSort]);
  }, [boxEntries, boxQ, boxFilter, boxSort, boxProjects, boxTags]); // eslint-disable-line react-hooks/exhaustive-deps

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
      roles: [...(r ? [...r.roles.map(jobKey), ...r.hold.map((g) => `hold:${g.job}`)] : []), ...(box.find((x) => x.id === editingBox)?.roles.includes("done") ? ["done"] : [])], // keep a Done mark
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
  // a good species with the wrong IVs gets no hint: its candy belongs to the one you keep, which registers the Dex anyway
  for (const r of transfers.filter((t) => !t.good.length)) {
    const paths = branches(r.entry.species).map((p) => p.slice(0, p.findLastIndex((t) => !owned.has(t.id)) + 1)).filter((p) => p.length);
    const size = paths.reduce((n, p) => n + p.length, 0);
    const cur = best[r.entry.species.family];
    if (paths.length && (!cur || size < cur.size)) best[r.entry.species.family] = { r, paths, size };
  }
  for (const { r, paths } of Object.values(best)) dexHint.set(r, paths);

  // which verdicts the Check tab shows ("all" or one verdict)
  const shownResults = results ? (verdictFilter === "all" ? results : results.filter((r) => r.verdict === verdictFilter)) : null;
  const TABS = [["check", `Check${batch.length ? ` (${batch.length})` : ""}`], ["plan", `Plan${openProjects.length ? ` (${openProjects.length})` : ""}`], ["box", `Box (${boxEntries.length})`]];

  return (
    <div>
      <h1 className="page-title">Pokémon GO</h1>
      <div className="row" role="tablist" style={{ marginBottom: 12, gap: 6 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? " btn-primary" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {(tab === "check" || editingBox) && (
        <>
        {!idx ? <p className="muted">{msg || "Loading Pokémon data…"}</p> : <QuickEntry idx={idx} edit={editing === null ? boxEdit : batch[editing]} onCancel={() => { setEditing(null); setEditingBox(null); }}
          onAdd={(e) => {
            if (editingBox) return saveBoxEdit(e);
            if (editing === null) return addRows([e]);
            setBatch((b) => b.map((r, j) => (j === editing ? { id: e.species.id, ivs: e.ivs, flags: flagsToList(e.flags) } : r)));
            setEditing(null);
          }} />}
          {editingBox && tab !== "check" && <p className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>Editing a box Pokémon: Save updates it in your box.</p>}
        </>
      )}

      {tab === "check" && (
        <>
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ fontWeight: 400 }}>Paste a list instead</summary>
          <p className="muted" style={{ marginBottom: 6 }}>e.g. <code>phantump 8/15/15 purified, 14/10/15, 8/13/11 shadow</code> (a piece with no name reuses the last one)</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} style={{ width: "100%", padding: "8px 10px", font: "inherit" }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addPasted(); } }} aria-label="Paste Pokémon" />
          <button type="button" className="btn" onClick={addPasted} disabled={!idx}>Add to batch</button>
        </details>
        {errors.length > 0 && <p className="status error">{errors.join(" · ")}</p>}

          {idx && batch.length > 0 && (
            <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "8px 0", marginTop: 10 }}>
              <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
                <strong>Batch ({batch.length})</strong>
                {keepers.length > 0 && <button type="button" className="btn" onClick={saveKeepers}>Save {keepers.length} keeper{keepers.length > 1 ? "s" : ""}</button>}
                {results?.length > keepers.length && <button type="button" className="btn" onClick={saveAll}>Save all {results.length}</button>}
                {tradeBait.length > 0 && <button type="button" className="btn" onClick={copyTrades}>Copy trade list</button>}
                {transfers.length > 0 && <button type="button" className="btn" onClick={copyTransfers}>Copy transfer list</button>}
                <button type="button" className="btn" onClick={() => { setBatch([]); setEditing(null); }}>Clear batch</button>
                {msg && <span className="muted">{msg}</span>}
              </div>
              {results?.length > 0 && (
                <div className="row" style={{ gap: 6, marginBottom: 0 }}>
                  {[["all", "All", results.length], ...ORDER.map((v) => [v, VERDICT[v].label, results.filter((r) => r.verdict === v).length])].filter(([, , n]) => n > 0).map(([v, label, n]) => (
                    <button key={v} type="button" aria-pressed={verdictFilter === v} onClick={() => setVerdictFilter(v)}
                      className={`btn${verdictFilter === v ? " btn-primary" : ""}`} style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0, color: verdictFilter === v ? undefined : (VERDICT[v]?.color) }}>
                      {label} {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        {projectList.length > 0 && (
          <details style={{ marginTop: "1rem" }}>
            <summary>Projects: what to power up first</summary>
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>Per family, best investment first (your box included). Already done #1? Look at the next one.</p>
            {projectList.map((p) => (
              <div key={p.family} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, margin: "4px 0 6px" }}>{p.items[0].jobs[0].target.name.replace(/ \(.*\)$/, "")} line</div>
                {p.items.map((x, i) => <ProjectCard key={i} n={i + 1} x={x} idx={idx} />)}
              </div>
            ))}
          </details>
        )}

        {results && (
          <div style={{ marginTop: "1rem" }}>
            {results.length === 0 && <p className="empty">Nothing recognized.</p>}
            {shownResults.map((r, i) => (
              <Fragment key={i}>
              {(i === 0 || shownResults[i - 1].verdict !== r.verdict) && (
                <h3 style={{ fontSize: "0.9rem", color: VERDICT[r.verdict].color, margin: "14px 0 6px" }}>
                  {SECTION[r.verdict]} · {results.filter((x) => x.verdict === r.verdict).length}
                </h3>
              )}
              <div className="card" style={{ marginBottom: 8, padding: "10px 12px", borderLeft: `4px solid ${VERDICT[r.verdict].color}`, outline: r.entry.i != null && editing === r.entry.i ? "2px solid var(--accent)" : undefined }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ color: VERDICT[r.verdict].color }}>{VERDICT[r.verdict].label}</strong>
                  {r.entry.i != null && (
                    <button type="button" className="btn" onClick={() => saveToBox([r])} style={{ order: 98, marginLeft: "auto", padding: "1px 10px", fontSize: "0.75rem", minHeight: 0 }}>Save to box</button>
                  )}
                  {r.entry.i != null && (
                    <button type="button" className="btn" onClick={() => { setEditing(r.entry.i); setEditingBox(null); }} aria-label={`Edit ${r.entry.species.name}`}
                      style={{ order: 99, marginLeft: 0, padding: "1px 10px", fontSize: "0.75rem", minHeight: 0 }}>Edit</button>
                  )}
                  {r.entry.i != null && (
                    <EvolveSelect s={r.entry.species} idx={idx} onPick={(id) => setBatch((b) => b.map((x, j) => (j === r.entry.i ? { ...x, id } : x)))} />
                  )}
                  {r.entry.i != null && (
                    <button type="button" className="btn" onClick={() => { setBatch((b) => b.filter((_, j) => j !== r.entry.i)); setEditing(null); }} aria-label={`Remove ${r.entry.species.name} from batch`}
                      style={{ order: 100, padding: "1px 10px", fontSize: "0.75rem", minHeight: 0 }}>Remove</button>
                  )}
                  <strong>{r.entry.species.name}</strong><Types s={r.entry.species} />
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.entry.ivs.join("/")}</span>
                  <span className="muted">{ivPct(r.entry.ivs)}</span>
                  <span className="muted">{flagNames(r.entry.flags)}</span>
                  {r.roles.map((c) => <Chip key={jobKey(c)} color={ROLE_COLOR[c.role]}>{jobLabel(jobKey(c))}</Chip>)}
                </div>
                {r.roles.map((c) => (
                  <div key={jobKey(c)} style={{ fontSize: "0.85rem", marginTop: 4 }}>
                    <span style={{ color: ROLE_COLOR[c.role] }}>{jobLabel(jobKey(c))}:</span> {c.detail}. <span className="muted">{c.invest}.</span>
                    {c.moves && <span> Moves: {c.moves}.</span>}
                    {c.evo && !c.evo.to && <span className="muted"> Mega Evolve it for raids (needs Mega Energy).</span>}
                    {c.evo?.to && <span className="muted"> Evolve to {c.evo.to}{c.evo.candy ? `; don't evolve until you have all ${c.evo.candy} candy (one go)` : ""}{c.evo.items?.length ? `; needs ${c.evo.items.join(" + ")}` : ""}.</span>}
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
        </>
      )}

      {tab === "plan" && (
        <>
          {(openProjects.length > 0 || boxBorderline.length > 0 || wantedList.length > 0) && (
            <div className="row" style={{ alignItems: "center", marginBottom: 10 }}>
              <input value={planQ} onChange={(e) => setPlanQ(e.target.value)} placeholder="Search projects, buddy, wanted" aria-label="Search the plan" style={{ padding: "6px 8px", font: "inherit", flex: "1 1 180px", minWidth: 0 }} />
              <select value={planJob} onChange={(e) => setPlanJob(e.target.value)} aria-label="Filter by job">
                {Object.entries(JOB_GROUPS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <select value={planSort} onChange={(e) => setPlanSort(e.target.value)} aria-label="Sort the plan">
                <option value="rank">Best first</option><option value="iv">IV %</option><option value="name">Name</option>
              </select>
            </div>
          )}
          {!openProjects.length && !boxBorderline.length && <p className="empty">Save keepers to your box and your projects show up here.</p>}
          {(openProjects.length > 0 || boxBorderline.length > 0) && !topList.length && !borderShown.length && <p className="empty">No projects match.</p>}
          <div className="plan-grid">
          <div>
        {(topList.length > 0 || borderShown.length > 0) && (
          <div style={{ margin: "8px 0 16px" }}>
            <div style={{ marginBottom: 6 }}><strong>Top projects</strong> <span className="muted" style={{ fontSize: "0.82rem" }}>best investment first; tap Done once it's powered up</span></div>
            {topList.map((x, i) => (
              <ProjectCard key={x.result.entry.id} n={projNum.get(x.result.entry.id)} x={x} idx={idx} inBox family={familyRows(x.result.entry.species.family)} onDone={() => toggleDone(x.result.entry)} onEvolve={(id) => evolveBox(x.result.entry, id)} />
            ))}
            {borderShown.length > 0 && <div style={{ margin: "12px 0 6px", color: PALETTE.amber, fontWeight: 600, fontSize: "0.9rem" }}>Borderline (your call)</div>}
            {borderShown.map((x) => (
              <ProjectCard key={x.result.entry.id} n={borderNum.get(x.result.entry.id)} x={x} idx={idx} inBox family={familyRows(x.result.entry.species.family)} onDone={() => toggleDone(x.result.entry)} />
            ))}
          </div>
        )}
          </div>
          <div>
        {rareCandy.length > 0 && (
          <div style={{ margin: "8px 0 16px" }}>
          <div style={{ marginBottom: 6 }}><strong>Rare Candy</strong> <span className="muted" style={{ fontSize: "0.82rem" }}>where it's worth the most</span></div>
          <div className="card" style={{ padding: "4px 12px 10px", fontSize: "0.85rem" }}>
            {rareCandy.map(({ x, n, use, why }) => (
              <div key={x.result.entry.id} style={{ marginTop: 6 }}>
                <span className="muted" style={{ display: "inline-block", minWidth: 28 }}>#{n}</span>
                <strong>{x.result.entry.species.name}</strong> {x.result.entry.ivs.join("/")}: {use}
                <div className="muted" style={{ marginLeft: 28, fontSize: "0.8rem" }}>{why}</div>
              </div>
            ))}
            <div className="muted" style={{ marginTop: 8, fontSize: "0.8rem" }}>Lines that walk 1–3 km per candy aren't listed: walk or catch those instead.</div>
          </div>
          </div>
        )}
        {(buddyEvolve.length > 0 || buddyXl.length > 0 || buddyWalk.length > 0) && (
          <div style={{ margin: "8px 0 16px" }}>
          <div style={{ marginBottom: 6 }}><strong>Buddy plan</strong> <span className="muted" style={{ fontSize: "0.82rem" }}>in Top projects order</span></div>
          <div className="card" style={{ padding: "4px 12px 10px", fontSize: "0.85rem" }}>
            {buddyEvolve.length > 0 && <div className="muted" style={{ marginTop: 6 }}>Needs a buddy to evolve</div>}
            {buddyEvolve.map(({ x, n, need, job }) => (
              <div key={x.result.entry.id} style={{ marginTop: 3 }}>
                <span className="muted" style={{ display: "inline-block", minWidth: 28 }}>#{n}</span>
                <strong>{x.result.entry.species.name}</strong> {x.result.entry.ivs.join("/")}: {need.join(", ")}, then evolve to {job.evo.to}
              </div>
            ))}
            {buddyWalk.length > 0 && <div className="muted" style={{ marginTop: 8 }}>Walk for evolution candy (type the candy you have to see how far is left)</div>}
            {buddyWalk.map(({ x, n, job, fam, left, km, known }) => (
              <div key={fam} style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted" style={{ display: "inline-block", minWidth: 28 }}>#{n}</span>
                <strong>{x.result.entry.species.name}</strong> {x.result.entry.ivs.join("/")} → {job.evo.to.replace(/, then Mega Evolve$/, "")}:
                <span>{job.evo.candy} candy, {x.result.entry.species.buddyKm} km each</span>
                <input inputMode="numeric" value={candyHave[fam] ?? ""} placeholder="have" aria-label={`Candy you have for ${x.result.entry.species.name}`}
                  onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setCandyHave((c) => ({ ...c, [fam]: e.target.value }))}
                  style={{ width: 56, padding: "2px 6px", font: "inherit", textAlign: "center" }} />
                <span className={known ? "" : "muted"}>{left === 0 ? "enough to evolve now" : `${known ? "" : "up to "}${left} candy = ${km} km`}</span>
              </div>
            ))}
            {buddyXl.length > 0 && <div className="muted" style={{ marginTop: 8 }}>Walk for XL Candy (buddies earn it at trainer level 31+)</div>}
            {buddyXl.map(({ x, n }) => (
              <div key={x.result.entry.id} style={{ marginTop: 3 }}>
                <span className="muted" style={{ display: "inline-block", minWidth: 28 }}>#{n}</span>
                <strong>{x.result.entry.species.name}</strong> {x.result.entry.ivs.join("/")}: {x.jobs.map((j) => jobLabel(jobKey(j))).join(", ")}
              </div>
            ))}
          </div>
          </div>
        )}
          </div>
          </div>
        {shownWanted.length > 0 && (
          <details open className="card" style={{ padding: "10px 12px", margin: "0 0 16px", fontSize: "0.85rem" }}>
            <summary style={{ fontSize: "0.95rem" }}>Wanted ({shownWanted.length}) <span className="muted" style={{ fontSize: "0.82rem", fontWeight: 400 }}>meta picks for jobs your box doesn't cover yet</span></summary>
            {shownWanted.map((w) => (
              <div key={w.species.id} style={{ marginTop: 10 }}>
                <div>
                  <strong>{w.species.name}</strong><Types s={w.species} />{" "}
                  {w.jobs.map((j) => <Chip key={j.job} color={ROLE_COLOR[j.job.split(":")[0]]}>{j.label}</Chip>)}
                  {w.rarity.length > 0 && <span className="muted"> {w.rarity.join(" · ")}</span>}
                </div>
                {w.jobs.map((j) => <div key={j.job} className="muted" style={{ marginLeft: 2 }}>{j.label}: {j.what}</div>)}
                <div style={{ marginLeft: 2 }}><Recommend jobs={w.jobs} labelOf={(j) => j.label} /></div>
                <div style={{ marginLeft: 2 }}><span className="muted">Look for:</span> {(() => {
                  // different jobs want different IVs: "15 Attack (Raids) · 15 / 14+ / 14+ (Master League)"
                  const by = {};
                  for (const j of w.jobs) (by[j.lookFor] ||= []).push(j.job.split(":")[0] === "raid" ? "Raids" : j.label);
                  const groups = Object.entries(by);
                  return groups.length === 1 ? groups[0][0] : groups.map(([look, jobs]) => `${look} (${[...new Set(jobs)].join(", ")})`).join(" · ");
                })()}</div>
                <CatchLine t={w.species} idx={idx} />
              </div>
            ))}
          </details>
        )}
        </>
      )}

      {tab === "box" && (
        <>
        <div className="row" style={{ alignItems: "center", margin: "6px 0" }}>
          <button type="button" className="btn" onClick={refreshBox} style={{ padding: "2px 10px", fontSize: "0.8rem", minHeight: 0 }}>Refresh box</button>
          {boxMsg && <span className="muted" style={{ fontSize: "0.82rem" }}>{boxMsg}</span>}
        </div>
        {boxEntries.length === 0 && <p className="empty">Keepers you save show up here, and new batches are compared against them.</p>}
        {boxEntries.length > 0 && (
          <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
            <input value={boxQ} onChange={(e) => setBoxQ(e.target.value)} placeholder="Search your box" aria-label="Search your box" style={{ padding: "6px 8px", font: "inherit", flex: "1 1 160px", minWidth: 0 }} />
            <select value={boxFilter} onChange={(e) => setBoxFilter(e.target.value)} aria-label="Filter box">
              {Object.entries(BOX_FILTERS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select value={boxSort} onChange={(e) => setBoxSort(e.target.value)} aria-label="Sort box">
              <option value="newest">Newest</option><option value="project">Best project</option><option value="iv">IV %</option><option value="atk">Attack</option><option value="name">Name</option>
            </select>
            {boxList.length !== boxEntries.length && <span className="muted">{boxList.length} of {boxEntries.length}</span>}
          </div>
        )}
        {boxEntries.length > 0 && boxList.length === 0 && <p className="empty">Nothing matches.</p>}
        {boxList.map((b) => (
          <div key={b.id} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
            <span style={{ minWidth: 180 }}><strong>{b.species.name}</strong><Types s={b.species} /> {b.ivs.join("/")} <span className="muted">{ivPct(b.ivs)}</span></span>
            <span className="muted">{flagNames(b.flags)}</span>
            {b.roles.includes("done") && <button type="button" onClick={() => toggleDone(b)} title="Powered up. Click to put it back in Top projects" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}><Chip color={PALETTE.emerald}>Done ✓</Chip></button>}
            {tagsFor(b).length === 0 && <span className="muted" style={{ fontSize: "0.8rem" }}>no job now (a better one in your box took it)</span>}
            {tagsFor(b).map((r) => <Chip key={r} color={r.startsWith("near:") ? PALETTE.amber : r.startsWith("hold:") || r.startsWith("backup:") ? PALETTE.blue : ROLE_COLOR[r.split(":")[0]]}>{jobLabel(r)}</Chip>)}
            <EvolveSelect s={b.species} idx={idx} onPick={(id) => evolveBox(b, id)} />
            <button className="btn" onClick={() => { setEditingBox(b.id); setEditing(null); }} aria-label={`Edit ${b.species.name} in box`}
              style={{ padding: "1px 8px", fontSize: "0.75rem", borderColor: editingBox === b.id ? "var(--accent)" : undefined }}>Edit</button>
            <button className="btn" onClick={() => removeFromBox(b)} aria-label={`Remove ${b.species.name} from box`} style={{ padding: "1px 8px", fontSize: "0.75rem" }}>✕</button>
          </div>
        ))}
        </>
      )}

      {idx && <p className="muted" style={{ marginTop: "2rem", fontSize: "0.75rem" }}>Data: PvPoke rankings from {idx.data.pvpokeTimestamp?.slice(0, 10)}, built {idx.data.built?.slice(0, 10)}. Raid picks = top {RULES.raidTop} in an attacking type (top {RULES.raidXl} = worth XL); PvP = species top {RULES.pvpTop} + IVs top {RULES.ivTop}; Master League = top {RULES.mlTop}. Raid ranks are an estimate, not a full sim.</p>}
    </div>
  );
}

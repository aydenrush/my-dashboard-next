"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { askConfirm } from "@/lib/confirm";
import "./brain-dump.css";

import { PALETTE as COLORS } from "@/lib/constants";
const URL_RE = /(https?:\/\/[^\s]+)/g;

// plain text + "# " headers, "- " bullets, "- [ ] " checklists, clickable URL badges
function NoteView({ text, onToggle }) {
  // split() with a capture group puts the URLs at odd indexes
  const linkify = (s) => s.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="nd-link" onClick={(e) => e.stopPropagation()}>
        {(() => { try { return new URL(part).hostname.replace(/^www\./, ""); } catch { return part; } })()}
      </a>
    ) : part
  );
  return text.split("\n").map((line, i) => {
    const check = line.match(/^- \[( |x)\] (.*)/i);
    if (check) {
      return (
        <label key={i} className="nd-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={check[1] !== " "} onChange={() => onToggle(i)} />
          <span style={{ textDecoration: check[1] !== " " ? "line-through" : "none" }}>{linkify(check[2])}</span>
        </label>
      );
    }
    if (line.startsWith("# ")) return <div key={i} className="nd-h">{linkify(line.slice(2))}</div>;
    if (line.startsWith("- ")) return <div key={i} className="nd-bullet">• {linkify(line.slice(2))}</div>;
    return <div key={i}>{line ? linkify(line) : " "}</div>;
  });
}

function toggleLine(content, i) {
  return content.split("\n").map((l, j) => (j === i ? l.replace(/^- \[( |x)\]/i, (m) => (m[3] === " " ? "- [x]" : "- [ ]")) : l)).join("\n");
}

function grow(el) { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }

function NoteCard({ note, tags, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // copies the raw text (markdown and all); the ✓ shows for 1.5s
  function copy() {
    navigator.clipboard.writeText(note.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  }
  const [draft, setDraft] = useState(note.content);
  const ref = useRef(null);
  const color = COLORS[tags.find((t) => t.name === note.tag)?.color] || COLORS.slate;

  useEffect(() => { if (editing) { grow(ref.current); ref.current.focus(); } }, [editing]);
  useEffect(() => { if (!editing) setDraft(note.content); }, [note.content, editing]);
  // closing or hiding the tab mid-edit doesn't blur the box, so save the draft then
  useEffect(() => {
    if (!editing) return;
    const onHide = () => {
      if (document.visibilityState === "hidden" && draft.trim() && draft !== note.content) onSave(note, { content: draft });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [editing, draft, note, onSave]);

  function finish() {
    setEditing(false);
    if (!draft.trim()) onDelete(note);
    else if (draft !== note.content) onSave(note, { content: draft });
  }

  return (
    <div className="nd-card" style={{ "--nd-accent": color }}>
      {editing ? (
        <textarea ref={ref} className="nd-text" value={draft}
          onChange={(e) => { setDraft(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
          onBlur={finish} />
      ) : (
        <div className="nd-body" onClick={() => setEditing(true)}>
          <NoteView text={note.content} onToggle={(i) => onSave(note, { content: toggleLine(note.content, i) })} />
        </div>
      )}
      <div className="nd-foot">
        <select value={note.tag || ""} onChange={(e) => onSave(note, { tag: e.target.value || null })} aria-label="Tag">
          <option value="">No tag</option>
          {tags.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <span className="nd-actions">
          <button className={copied ? "on" : ""} onClick={copy} title={copied ? "Copied" : "Copy text"} aria-label="Copy note text">{copied ? "✓" : "⧉"}</button>
          <button className={note.pinned ? "on" : ""} onClick={() => onSave(note, { pinned: !note.pinned })} title={note.pinned ? "Unpin" : "Pin"} aria-label={note.pinned ? "Unpin note" : "Pin note"}>📌</button>
          <button onClick={() => askConfirm("Delete this note?").then((ok) => ok && onDelete(note))} title="Delete" aria-label="Delete note">✕</button>
        </span>
      </div>
    </div>
  );
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const sortNotes = (ns) => [...ns].sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at));

export default function BrainDumpPage() {
  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  // the add box keeps an unfinished thought in this browser until you add it
  useEffect(() => { setText(localStorage.getItem("brain_dump_draft") || ""); }, []);
  useEffect(() => { if (text) localStorage.setItem("brain_dump_draft", text); else localStorage.removeItem("brain_dump_draft"); }, [text]);
  const [filter, setFilter] = useState(null);
  const [query, setQuery] = useState("");
  const [newTag, setNewTag] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const [{ data: t, error: e1 }, { data: n, error: e2 }] = await Promise.all([
        supabase.from("note_tags").select("*").order("name"),
        supabase.from("notes").select("*"),
      ]);
      if (e1 || e2) return;
      setTags(t);
      setNotes(sortNotes(n));
      setLoaded(true);
    })();
  }, []);

  async function addNote(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    const { data, error } = await supabase.from("notes").insert({ content: text.trim(), tag: filter }).select().single();
    if (error) return;
    setNotes((ns) => sortNotes([data, ...ns]));
    setText("");
  }

  async function saveNote(note, patch) {
    const updated = { ...patch, updated_at: new Date().toISOString() };
    setNotes((ns) => sortNotes(ns.map((n) => (n.id === note.id ? { ...n, ...updated } : n))));
    await supabase.from("notes").update(updated).eq("id", note.id);
  }

  async function deleteNote(note) {
    setNotes((ns) => ns.filter((n) => n.id !== note.id));
    await supabase.from("notes").delete().eq("id", note.id);
  }

  async function addTag(e) {
    e.preventDefault();
    const name = newTag.name.trim();
    if (!name || tags.some((t) => t.name === name)) return setNewTag(null);
    const { error } = await supabase.from("note_tags").insert({ name, color: newTag.color });
    if (error) return;
    setTags((ts) => [...ts, { name, color: newTag.color }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTag(null);
  }

  async function deleteTag(name) {
    if (!(await askConfirm(`Delete tag "${name}"? Its notes stay, just untagged.`))) return;
    const { error } = await supabase.from("note_tags").delete().eq("name", name);
    if (error) return;
    setTags((ts) => ts.filter((t) => t.name !== name));
    setNotes((ns) => ns.map((n) => (n.tag === name ? { ...n, tag: null } : n)));
    if (filter === name) setFilter(null);
  }

  function exportMd() {
    const groups = {};
    for (const n of notes) (groups[n.tag || "Untagged"] ||= []).push(n.content.trim());
    const md = ["# Brain Dump", `_Exported ${new Date().toLocaleString()}_`, ""];
    for (const [tag, items] of Object.entries(groups)) md.push(`## ${tag}`, "", ...items.flatMap((t) => [t, "", "---", ""]));
    download("brain-dump.md", md.join("\n"), "text/markdown");
  }

  const q = query.trim().toLowerCase();
  const shown = notes.filter((n) => (!filter || n.tag === filter) && (!q || n.content.toLowerCase().includes(q)));

  return (
    <div>
      <h1 className="page-title">Brain Dump</h1>

      <form onSubmit={addNote} className="bd-add">
        <textarea value={text} rows={2} placeholder={`Dump a thought${filter ? ` into ${filter}` : ""}… (Enter to add, Shift+Enter for a new line)`}
          onChange={(e) => { setText(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); } }} />
        <button type="submit" className="btn btn-primary">Add</button>
      </form>

      <div className="bd-bar">
        <button className={`bd-chip${!filter ? " on" : ""}`} onClick={() => setFilter(null)}>All <span>{notes.length}</span></button>
        {tags.map((t) => (
          <span key={t.name} className={`bd-chip${filter === t.name ? " on" : ""}`} style={{ "--chip": COLORS[t.color] }}>
            <button onClick={() => setFilter(t.name)}>{t.name} <span>{notes.filter((n) => n.tag === t.name).length}</span></button>
            {filter === t.name && <button className="bd-chip-x" onClick={() => deleteTag(t.name)} aria-label={`Delete tag ${t.name}`}>✕</button>}
          </span>
        ))}
        {newTag ? (
          <form onSubmit={addTag} className="bd-newtag">
            <input autoFocus value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} placeholder="Tag name" />
            {Object.entries(COLORS).map(([name, hex]) => (
              <button type="button" key={name} aria-label={`Color ${name}`} className={`nd-dot${newTag.color === name ? " on" : ""}`} style={{ background: hex }}
                onClick={() => setNewTag({ ...newTag, color: name })} />
            ))}
            <button type="submit" className="btn">Save</button>
            <button type="button" className="btn" onClick={() => setNewTag(null)}>Cancel</button>
          </form>
        ) : (
          <button className="bd-chip" onClick={() => setNewTag({ name: "", color: "blue" })}>+ Tag</button>
        )}
        <span className="bd-tools">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search notes" />
          <button className="btn" onClick={exportMd}>.md</button>
          <button className="btn" onClick={() => download("brain-dump.json", JSON.stringify({ tags, notes }, null, 2), "application/json")}>.json</button>
        </span>
      </div>

      {loaded && !shown.length && <p className="empty">{notes.length ? "No notes match." : "Nothing here yet. Type above to add your first note."}</p>}

      <div className="bd-grid">
        {shown.map((n) => <NoteCard key={n.id} note={n} tags={tags} onSave={saveNote} onDelete={deleteNote} />)}
      </div>
    </div>
  );
}

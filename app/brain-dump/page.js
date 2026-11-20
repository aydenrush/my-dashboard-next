"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Handle, Position,
  NodeResizer, addEdge, useReactFlow, useViewport, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/style.css";
import "./brain-dump.css";

const COLORS = { slate: "#64748b", blue: "#3b82f6", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", violet: "#8b5cf6" };
const STORE_KEY = "brain_dump";
const URL_RE = /(https?:\/\/[^\s]+)/g;

function isTyping(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

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
  if (!text.trim()) return <div className="nd-empty">Empty note</div>;
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
    return <div key={i} className="nd-line">{line ? linkify(line) : " "}</div>;
  });
}

function NoteNode({ id, data, selected }) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const [editing, setEditing] = useState(!!data.editing);
  const ref = useRef(null);

  const fit = () => { const t = ref.current; if (t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; } };
  useEffect(() => { if (editing) { fit(); ref.current?.focus(); } }, [editing]);

  const setContent = (content) => updateNodeData(id, { content, updatedAt: Date.now() });
  const toggleLine = (i) => setContent(data.content.split("\n").map((l, j) =>
    j === i ? l.replace(/^- \[( |x)\]/i, (m) => (m[3] === " " ? "- [x]" : "- [ ]")) : l).join("\n"));

  return (
    <div className={`nd-card${selected ? " selected" : ""}`} style={{ "--nd-accent": COLORS[data.color] || COLORS.slate }}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={60} color={COLORS[data.color]} />
      <Handle type="target" position={Position.Left} />
      <div className="nd-handle">
        <span className="nd-grip">⋮⋮</span>
        <span className="nd-actions">
          {Object.entries(COLORS).map(([name, hex]) => (
            <button key={name} title={name} aria-label={`Color ${name}`} className={`nd-dot${data.color === name ? " on" : ""}`} style={{ background: hex }}
              onClick={() => updateNodeData(id, { color: name, updatedAt: Date.now() })} />
          ))}
          <button className="nd-trash" title="Delete" aria-label="Delete note" onClick={() => deleteElements({ nodes: [{ id }] })}>✕</button>
        </span>
      </div>
      {editing ? (
        <textarea
          ref={ref}
          className="nd-text nodrag nowheel"
          value={data.content}
          placeholder="Type a thought… (# header, - bullet, - [ ] todo)"
          onChange={(e) => { setContent(e.target.value); fit(); }}
          onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
          onBlur={() => { setEditing(false); if (!data.content.trim()) deleteElements({ nodes: [{ id }] }); }}
        />
      ) : (
        <div className="nd-body" onClick={() => setEditing(true)}>
          <NoteView text={data.content} onToggle={toggleLine} />
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { note: NoteNode };

function toNote(n) {
  const { editing, ...d } = n.data;
  return { id: n.id, content: d.content, x: n.position.x, y: n.position.y, width: n.width, color: d.color, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Canvas() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [viewport, setViewport] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [clusterMsg, setClusterMsg] = useState("");
  const wrapRef = useRef(null);
  const mouse = useRef(null);
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();
  const { zoom } = useViewport();

  // load once on the client (localStorage isn't available during server render)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s) {
        setNodes((s.notes || []).map((n) => ({
          id: n.id, type: "note", position: { x: n.x, y: n.y }, width: n.width, dragHandle: ".nd-handle",
          data: { content: n.content, color: n.color, createdAt: n.createdAt, updatedAt: n.updatedAt },
        })));
        setEdges((s.edges || []).map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } })));
        setViewport(s.viewport || null);
      }
    } catch {}
    setLoaded(true);
    fetch("/api/cluster").then((r) => r.json()).then((d) => setAiEnabled(!!d.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const out = { notes: nodes.map(toNote), edges: edges.map(({ id, source, target, label }) => ({ id, source, target, label })), viewport };
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  }, [nodes, edges, viewport, loaded]);

  const center = useCallback(() => {
    const r = wrapRef.current.getBoundingClientRect();
    return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [screenToFlowPosition]);

  const addNote = useCallback((pos, content = "") => {
    const now = Date.now();
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), {
      id: crypto.randomUUID(), type: "note", position: pos, width: 240, dragHandle: ".nd-handle", selected: true,
      data: { content, color: "slate", createdAt: now, updatedAt: now, editing: !content },
    }]);
  }, []);

  // paste, N, Cmd/Ctrl+K
  useEffect(() => {
    const onPaste = (e) => {
      if (isTyping(document.activeElement)) return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (text) { e.preventDefault(); addNote(center(), text); }
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); return; }
      if (e.key === "Escape" && searchOpen) { setSearchOpen(false); setQuery(""); return; }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        addNote(mouse.current ? screenToFlowPosition(mouse.current) : center());
      }
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("paste", onPaste); document.removeEventListener("keydown", onKey); };
  }, [addNote, center, screenToFlowPosition, searchOpen]);

  const q = query.trim().toLowerCase();
  const matches = q ? nodes.filter((n) => n.data.content.toLowerCase().includes(q)) : [];
  const shown = useMemo(() => q
    ? nodes.map((n) => ({ ...n, className: n.data.content.toLowerCase().includes(q) ? "nd-hit" : "nd-dim" }))
    : nodes, [nodes, q]);

  function goTo(n) {
    const w = n.measured?.width || n.width || 240, h = n.measured?.height || 100;
    setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(zoom, 1), duration: 400 });
    setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === n.id })));
  }

  const selected = nodes.filter((n) => n.selected);
  function recolorSelected(color) {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, color, updatedAt: Date.now() } } : n)));
  }

  function exportJson() {
    download("brain-dump.json", JSON.stringify({ notes: nodes.map(toNote), edges: edges.map(({ id, source, target, label }) => ({ id, source, target, label })) }, null, 2), "application/json");
  }
  function exportMd() {
    const byColor = {};
    for (const n of nodes) (byColor[n.data.color] ||= []).push(n.data.content.trim());
    const md = ["# Brain Dump", `_Exported ${new Date().toLocaleString()}_`, ""];
    for (const [color, items] of Object.entries(byColor)) {
      md.push(`## ${color[0].toUpperCase() + color.slice(1)}`, "", ...items.flatMap((t) => [t, "", "---", ""]));
    }
    download("brain-dump.md", md.join("\n"), "text/markdown");
  }

  async function autoCluster() {
    if (!nodes.length) return;
    setClusterMsg("Clustering…");
    try {
      const resp = await fetch("/api/cluster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: nodes.map((n) => ({ id: n.id, content: n.data.content, x: n.position.x, y: n.position.y })) }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || resp.statusText);
      const byId = Object.fromEntries(out.notes.map((n) => [n.id, n]));
      setNodes((ns) => ns.map((n) => byId[n.id]
        ? { ...n, position: { x: byId[n.id].x, y: byId[n.id].y }, data: { ...n.data, color: byId[n.id].color, updatedAt: Date.now() } }
        : n));
      setClusterMsg(out.clusters.map((c) => c.theme).join(" · "));
      setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 50);
    } catch (e) {
      setClusterMsg(`Cluster failed: ${e.message}`);
    }
  }

  if (!loaded) return <div className="bd-wrap" ref={wrapRef} />;

  return (
    <div
      className="bd-wrap"
      ref={wrapRef}
      onMouseMove={(e) => { mouse.current = { x: e.clientX, y: e.clientY }; }}
      onDoubleClick={(e) => {
        if (e.target.classList.contains("react-flow__pane")) addNote(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((ns) => changes.applyTo(ns))}
        onEdgesChange={(changes) => setEdges((es) => changes.applyTo(es))}
        onConnect={(c) => setEdges((es) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, es))}
        onMoveEnd={(_, vp) => setViewport(vp)}
        defaultViewport={viewport || { x: 0, y: 0, zoom: 1 }}
        fitView={!viewport && nodes.length > 0}
        panOnDrag={[1]}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.1}
        maxZoom={3}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="bd-hint">Double-click anywhere, press <kbd>N</kbd>, or paste to add a note</div>
      )}

      {searchOpen && (
        <div className="bd-search">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…"
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) goTo(matches[0]); }} />
          {matches.slice(0, 8).map((n) => (
            <button key={n.id} className="bd-result" onClick={() => goTo(n)}>
              <span className="bd-swatch" style={{ background: COLORS[n.data.color] }} />
              {n.data.content.split("\n")[0].slice(0, 80)}
            </button>
          ))}
          {q && !matches.length && <div className="bd-none">No matches</div>}
        </div>
      )}

      <div className="bd-hud">
        <span className="bd-zoom">{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => fitView({ duration: 300, padding: 0.15 })}>Fit</button>
        <button className="btn" onClick={() => setSearchOpen((o) => !o)} title="Ctrl/Cmd + K">Search</button>
        <button className="btn" onClick={exportMd}>.md</button>
        <button className="btn" onClick={exportJson}>.json</button>
        <button className="btn" onClick={autoCluster} disabled={!aiEnabled || !nodes.length}
          title={aiEnabled ? "Group related notes with Claude" : "Set ANTHROPIC_API_KEY to enable"}>Auto-Cluster</button>
        {selected.length > 1 && (
          <span className="bd-batch">
            {selected.length} selected
            {Object.entries(COLORS).map(([name, hex]) => (
              <button key={name} aria-label={`Color selected ${name}`} className="nd-dot" style={{ background: hex }} onClick={() => recolorSelected(name)} />
            ))}
          </span>
        )}
        {clusterMsg && <span className="bd-msg">{clusterMsg}</span>}
      </div>
    </div>
  );
}

export default function BrainDumpPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const PRIORITY_COLORS = { high: "#F44336", medium: "#FF9800", low: "#4CAF50" };

export default function TodoPage() {
  const [todos, setTodos] = useState([]);
  const [task, setTask] = useState("");
  const [priority, setPriority] = useState("medium");
  const [editingId, setEditingId] = useState(null);
  const [editTask, setEditTask] = useState("");
  const [editPriority, setEditPriority] = useState("medium");

  async function load() {
    const { data } = await supabase.from("todos").select("*").order("created_at");
    setTodos((data || []).filter((t) => !t.completed));
  }

  useEffect(() => { load(); }, []);

  async function addTodo(e) {
    e.preventDefault();
    if (!task.trim()) return;
    await supabase.from("todos").insert({ task: task.trim(), priority, completed: false });
    setTask("");
    load();
  }

  async function complete(id) {
    await supabase.from("todos").delete().eq("id", id);
    load();
  }

  async function saveEdit(id) {
    await supabase.from("todos").update({ task: editTask.trim(), priority: editPriority }).eq("id", id);
    setEditingId(null);
    load();
  }

  const grouped = ["high", "medium", "low"].map((p) => ({
    priority: p,
    items: todos.filter((t) => t.priority === p),
  }));

  return (
    <div>
      <h1 className="page-title">To Do</h1>

      <form onSubmit={addTodo} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What needs doing?"
          style={{ flex: 1 }}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button type="submit" className="btn btn-primary">Add</button>
      </form>

      <hr className="divider" />

      {todos.length === 0 && <p className="alert alert-info">Nothing to do. Nice.</p>}

      {grouped.map(({ priority: p, items }) =>
        items.map((todo) => (
          <div key={todo.id} style={{ marginBottom: "0.5rem" }}>
            {editingId === todo.id ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="text"
                  value={editTask}
                  onChange={(e) => setEditTask(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button className="btn" onClick={() => saveEdit(todo.id)}>Save</button>
                <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button className="btn" onClick={() => complete(todo.id)} style={{ padding: "4px 8px" }}>✅</button>
                <span style={{ flex: 1, borderLeft: `3px solid ${PRIORITY_COLORS[p]}`, paddingLeft: "8px" }}>
                  {todo.task}
                </span>
                <button
                  className="btn"
                  onClick={() => { setEditingId(todo.id); setEditTask(todo.task); setEditPriority(todo.priority); }}
                  style={{ padding: "4px 8px" }}
                >✏️</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

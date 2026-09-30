"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const STATUS_LABELS = { reading: "Currently Reading", completed: "Completed", want_to_read: "Want to Read" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function bookLine(book, includePages = true) {
  let line = book.title;
  if (book.author) line += ` — ${book.author}`;
  if (book.genre) line += ` · ${book.genre}`;
  if (book.year_published) line += ` · ${book.year_published}`;
  if (includePages && book.total_pages) line += ` · ${book.total_pages}p`;
  return line;
}

export default function BooksPage() {
  const [books, setBooks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [newBook, setNewBook] = useState({ title: "", author: "", status: "want_to_read", genre: "", total_pages: 0, year_published: 0, notes: "" });
  const [pageUpdates, setPageUpdates] = useState({});
  const [noteInputs, setNoteInputs] = useState({});
  const [editingBook, setEditingBook] = useState(null);

  async function load() {
    const { data: bData } = await supabase.from("books").select("*").order("created_at");
    setBooks(bData || []);
    const { data: nData } = await supabase.from("book_notes").select("*").order("created_at");
    setNotes(nData || []);
  }

  useEffect(() => { load(); }, []);

  const reading = books.filter((b) => b.status === "reading");
  const completed = books.filter((b) => b.status === "completed");
  const wantToRead = books.filter((b) => b.status === "want_to_read");

  async function updatePage(bookId, newPage, totalPages) {
    const updates = { current_page: newPage };
    if (totalPages && newPage >= totalPages) {
      updates.status = "completed";
      updates.end_date = today();
      updates.current_page = totalPages;
    }
    await supabase.from("books").update(updates).eq("id", bookId);
    load();
  }

  async function finishBook(bookId, totalPages) {
    const updates = { status: "completed", end_date: today() };
    if (totalPages) updates.current_page = totalPages;
    await supabase.from("books").update(updates).eq("id", bookId);
    load();
  }

  async function startBook(bookId) {
    await supabase.from("books").update({ status: "reading", start_date: today(), current_page: 0 }).eq("id", bookId);
    load();
  }

  async function addBook(e) {
    e.preventDefault();
    if (!newBook.title.trim()) return;
    const row = {
      title: newBook.title.trim(),
      author: newBook.author.trim() || null,
      status: newBook.status,
      genre: newBook.genre.trim() || null,
      total_pages: newBook.total_pages > 0 ? newBook.total_pages : null,
      current_page: 0,
      year_published: newBook.year_published > 0 ? newBook.year_published : null,
      notes: newBook.notes.trim() || null,
    };
    if (newBook.status === "reading") row.start_date = today();
    if (newBook.status === "completed") {
      row.start_date = today();
      row.end_date = today();
      if (newBook.total_pages > 0) row.current_page = newBook.total_pages;
    }
    await supabase.from("books").insert(row);
    setNewBook({ title: "", author: "", status: "want_to_read", genre: "", total_pages: 0, year_published: 0, notes: "" });
    load();
  }

  async function deleteBook(id) {
    await supabase.from("books").delete().eq("id", id);
    load();
  }

  async function addNote(bookId, content, pageNum) {
    if (!content.trim()) return;
    await supabase.from("book_notes").insert({
      book_id: bookId, content: content.trim(), page_number: pageNum > 0 ? pageNum : null,
    });
    setNoteInputs((prev) => ({ ...prev, [bookId]: "" }));
    load();
  }

  async function deleteNote(id) {
    await supabase.from("book_notes").delete().eq("id", id);
    load();
  }

  const totalPagesRead = completed.reduce((s, b) => s + (b.total_pages || 0), 0)
    + reading.reduce((s, b) => s + (b.current_page || 0), 0);

  return (
    <div>
      <h1 className="page-title">Reading Log</h1>

      {reading.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Currently Reading</h2>
          {reading.map((book) => {
            const cur = book.current_page || 0;
            const total = book.total_pages || 0;
            const pct = total > 0 ? cur / total : 0;
            const days = book.start_date ? daysBetween(book.start_date, today()) : 0;
            const pgDay = days > 0 && cur > 0 ? Math.round(cur / days) : 0;
            const bookNotes = notes.filter((n) => n.book_id === book.id);
            const pageVal = pageUpdates[book.id] ?? cur;

            return (
              <div key={book.id} className="card" style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ flex: 1 }}>
                    <strong>{book.title}</strong>
                    {book.author && <span> — {book.author}</span>}
                    {book.genre && <span> · {book.genre}</span>}
                    {total > 0 && <span> · p.{cur}/{total} ({(pct * 100).toFixed(0)}%)</span>}
                    {days > 0 && <span> · {days}d in</span>}
                    {pgDay > 0 && <span> · {pgDay} pg/day</span>}
                    {total > 0 && (
                      <div style={{ marginTop: "0.5rem", background: "var(--border)", borderRadius: "4px", height: "6px", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      value={pageVal}
                      onChange={(e) => setPageUpdates((p) => ({ ...p, [book.id]: Number(e.target.value) }))}
                      style={{ width: "80px" }}
                      min={0}
                      max={Math.max(total, 9999)}
                    />
                    {pageVal !== cur && (
                      <button className="btn" onClick={() => { updatePage(book.id, pageVal, total); setPageUpdates((p) => { const n = { ...p }; delete n[book.id]; return n; }); }}>
                        {pageVal > cur ? `+${pageVal - cur}p` : "Set"}
                      </button>
                    )}
                    <button className="btn" onClick={() => finishBook(book.id, total)}>Finish</button>
                  </div>
                </div>

                <details style={{ marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--muted)" }}>
                    Notes ({bookNotes.length})
                  </summary>
                  {bookNotes.sort((a, b) => b.created_at?.localeCompare(a.created_at)).map((n) => (
                    <div key={n.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "4px 0" }}>
                      <blockquote style={{ flex: 1, margin: 0, paddingLeft: "8px", borderLeft: "2px solid var(--border)", fontSize: "0.85rem" }}>
                        {n.content}{n.page_number ? ` · p.${n.page_number}` : ""}
                      </blockquote>
                      <button className="btn" onClick={() => deleteNote(n.id)} style={{ padding: "2px 6px", fontSize: "0.75rem" }}>Del</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <input
                      type="text"
                      value={noteInputs[book.id] || ""}
                      onChange={(e) => setNoteInputs((p) => ({ ...p, [book.id]: e.target.value }))}
                      placeholder="Add a note..."
                      style={{ flex: 1 }}
                      onKeyDown={(e) => e.key === "Enter" && addNote(book.id, noteInputs[book.id] || "", cur)}
                    />
                    <button className="btn" onClick={() => addNote(book.id, noteInputs[book.id] || "", cur)}>Add</button>
                  </div>
                </details>
              </div>
            );
          })}
          <hr className="divider" />
        </>
      )}

      {books.length > 0 && (
        <div className="metrics-row" style={{ marginBottom: "1.5rem" }}>
          <div className="metric"><div className="metric-label">Reading</div><div className="metric-value">{reading.length}</div></div>
          <div className="metric"><div className="metric-label">Completed</div><div className="metric-value">{completed.length}</div></div>
          <div className="metric"><div className="metric-label">Want to Read</div><div className="metric-value">{wantToRead.length}</div></div>
          <div className="metric"><div className="metric-label">Pages Read</div><div className="metric-value">{totalPagesRead > 0 ? totalPagesRead.toLocaleString() : "—"}</div></div>
        </div>
      )}

      {completed.length > 0 && (
        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Completed ({completed.length})</summary>
          {[...completed].sort((a, b) => (b.end_date || "").localeCompare(a.end_date || "")).map((book) => {
            let line = bookLine(book);
            if (book.start_date && book.end_date) {
              const days = daysBetween(book.start_date, book.end_date);
              line += ` · ${days}d`;
              if (book.total_pages && days > 0) line += ` (${Math.round(book.total_pages / days)} pg/day)`;
              line += ` · finished ${new Date(book.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
            }
            return <p key={book.id} style={{ fontSize: "0.9rem", margin: "4px 0" }}>{line}</p>;
          })}
        </details>
      )}

      {wantToRead.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Want to Read ({wantToRead.length})</summary>
          {wantToRead.map((book) => (
            <div key={book.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0" }}>
              <span style={{ fontSize: "0.9rem" }}>{bookLine(book)}</span>
              <button className="btn" onClick={() => startBook(book.id)} style={{ padding: "4px 8px" }}>Start</button>
            </div>
          ))}
        </details>
      )}

      <hr className="divider" />

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Add Book</summary>
        <form onSubmit={addBook}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <input type="text" value={newBook.title} onChange={(e) => setNewBook((p) => ({ ...p, title: e.target.value }))} placeholder="Title" style={{ flex: 2 }} />
            <input type="text" value={newBook.author} onChange={(e) => setNewBook((p) => ({ ...p, author: e.target.value }))} placeholder="Author" style={{ flex: 2 }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <select value={newBook.status} onChange={(e) => setNewBook((p) => ({ ...p, status: e.target.value }))}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="text" value={newBook.genre} onChange={(e) => setNewBook((p) => ({ ...p, genre: e.target.value }))} placeholder="Genre" style={{ flex: 1 }} />
            <input type="number" value={newBook.total_pages || ""} onChange={(e) => setNewBook((p) => ({ ...p, total_pages: Number(e.target.value) }))} placeholder="Pages" style={{ width: "80px" }} />
            <input type="number" value={newBook.year_published || ""} onChange={(e) => setNewBook((p) => ({ ...p, year_published: Number(e.target.value) }))} placeholder="Year" style={{ width: "80px" }} />
          </div>
          <button type="submit" className="btn btn-primary">Add Book</button>
        </form>
      </details>

      {books.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Manage Books</summary>
          {books.map((book) => (
            <div key={book.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "4px 0", fontSize: "0.85rem" }}>
              <span style={{ flex: 1 }}>
                {book.title}{book.author ? ` — ${book.author}` : ""} · {STATUS_LABELS[book.status] || book.status}
              </span>
              {book.status !== "reading" && <button className="btn" onClick={() => startBook(book.id)} style={{ padding: "2px 8px" }}>Read</button>}
              {book.status === "reading" && <button className="btn" onClick={() => finishBook(book.id, book.total_pages)} style={{ padding: "2px 8px" }}>Done</button>}
              <button className="btn" onClick={() => deleteBook(book.id)} style={{ padding: "2px 8px" }}>Del</button>
            </div>
          ))}
        </details>
      )}

      {completed.length >= 2 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "0.5rem" }}>Analytics</summary>
          {(() => {
            const genres = {};
            completed.forEach((b) => { if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1; });
            const genreEntries = Object.entries(genres).sort((a, b) => b[1] - a[1]);
            const maxGenre = genreEntries.length > 0 ? genreEntries[0][1] : 1;

            const decades = {};
            completed.forEach((b) => {
              if (b.year_published) {
                const dec = Math.floor(b.year_published / 10) * 10 + "s";
                decades[dec] = (decades[dec] || 0) + 1;
              }
            });
            const decadeEntries = Object.entries(decades).sort((a, b) => a[0].localeCompare(b[0]));
            const maxDecade = decadeEntries.length > 0 ? Math.max(...decadeEntries.map((d) => d[1])) : 1;

            return (
              <>
                {genreEntries.length > 0 && (
                  <>
                    <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Books by Genre</p>
                    {genreEntries.map(([genre, count]) => (
                      <div key={genre} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ minWidth: "100px", fontSize: "0.85rem" }}>{genre}</span>
                        <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "16px", overflow: "hidden" }}>
                          <div style={{ width: `${(count / maxGenre) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                        </div>
                        <span style={{ fontSize: "0.85rem", minWidth: "24px" }}>{count}</span>
                      </div>
                    ))}
                  </>
                )}
                {decadeEntries.length > 0 && (
                  <>
                    <p style={{ fontWeight: 600, margin: "1rem 0 0.5rem" }}>Books by Decade</p>
                    {decadeEntries.map(([dec, count]) => (
                      <div key={dec} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ minWidth: "60px", fontSize: "0.85rem" }}>{dec}</span>
                        <div style={{ flex: 1, background: "var(--border)", borderRadius: "4px", height: "16px", overflow: "hidden" }}>
                          <div style={{ width: `${(count / maxDecade) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "4px" }} />
                        </div>
                        <span style={{ fontSize: "0.85rem", minWidth: "24px" }}>{count}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            );
          })()}
        </details>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","is","it",
  "i","me","my","we","he","she","be","do","so","no","if","up","as","by",
  "am","are","was","has","had","not","that","this","with","from","they",
  "them","their","you","your","all","can","will","just",
]);

const STATUS_LABELS = { draft: "Draft", in_progress: "In Progress", finished: "Finished" };

const GRADE_COLORS = { S: "#FFD700", A: "#4CAF50", B: "#2196F3", C: "#FF9800", D: "#F44336", F: "#9E9E9E" };

// --- Syllable heuristic (no CMU dict) ---
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let count = 0;
  let prevVowel = false;
  for (const ch of w) {
    const isV = "aeiouy".includes(ch);
    if (isV && !prevVowel) count++;
    prevVowel = isV;
  }
  if (w.endsWith("e") && count > 1) count--;
  if (w.endsWith("le") && w.length > 2 && !"aeiouy".includes(w[w.length - 3])) count++;
  return Math.max(count, 1);
}

function lineSyllables(line) {
  const words = line.match(/[a-zA-Z']+/g) || [];
  return words.reduce((s, w) => s + countSyllables(w), 0);
}

function lastWord(line) {
  const words = line.match(/[a-zA-Z']+/g) || [];
  return words.length ? words[words.length - 1].toLowerCase() : "";
}

function getWords(line) {
  return (line.match(/[a-zA-Z']+/g) || [])
    .map((w) => w.toLowerCase().replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 1);
}

// --- Suffix-based rhyme check (no phonemes) ---
function rhymeSuffix(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length < 2) return "";
  // Take last 2-3 chars as rhyme key
  return w.length >= 3 ? w.slice(-3) : w.slice(-2);
}

function suffixRhymes(a, b) {
  if (a === b) return false;
  const sa = rhymeSuffix(a);
  const sb = rhymeSuffix(b);
  if (!sa || !sb) return false;
  // Match if last 2+ chars are the same
  if (sa.length >= 3 && sb.length >= 3 && sa === sb) return true;
  return sa.slice(-2) === sb.slice(-2);
}

// --- Analyzer helpers ---
function countAlliteration(bars) {
  let total = 0;
  for (const bar of bars) {
    const words = getWords(bar).filter((w) => !STOP_WORDS.has(w));
    const starts = {};
    for (const w of words) {
      starts[w[0]] = (starts[w[0]] || 0) + 1;
    }
    for (const c of Object.values(starts)) {
      if (c >= 3) total += c;
    }
  }
  return total;
}

function countSimiles(bars) {
  let total = 0;
  for (const bar of bars) {
    const matches = bar.match(/\blike\b/gi);
    if (matches) total += matches.length;
  }
  return total;
}

function uniqueRatio(bars) {
  const words = [];
  for (const bar of bars) {
    for (const w of getWords(bar)) {
      if (w.length > 1) words.push(w);
    }
  }
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

// Build end-rhyme scheme labels using suffix matching + custom DB groups
function detectScheme(bars, rhymeGroups) {
  const endWords = bars.map(lastWord);

  // Build word -> group IDs map from custom rhymes
  const wordToGroups = {};
  for (const g of rhymeGroups) {
    for (const w of g.words) {
      const wl = w.toLowerCase();
      if (!wordToGroups[wl]) wordToGroups[wl] = new Set();
      wordToGroups[wl].add(g.id);
    }
  }

  let nextLabel = 0;
  const result = [];
  for (let i = 0; i < endWords.length; i++) {
    const word = endWords[i];
    if (!word) { result.push("-"); continue; }

    const myGroups = wordToGroups[word] || new Set();
    let assigned = false;

    for (let j = 0; j < i; j++) {
      const prevGroups = wordToGroups[endWords[j]] || new Set();
      // Check custom DB groups overlap
      if (myGroups.size && prevGroups.size) {
        for (const g of myGroups) {
          if (prevGroups.has(g)) { assigned = true; break; }
        }
      }
      // Check suffix rhyme
      if (!assigned && suffixRhymes(word, endWords[j])) {
        assigned = true;
      }
      if (assigned) {
        result.push(result[j]);
        break;
      }
    }
    if (!assigned) {
      result.push(String.fromCharCode(65 + (nextLabel % 26)));
      nextLabel++;
    }
  }
  return result;
}

// Build internal rhyme map: positions where words rhyme within/across bars
function buildRhymeMap(bars, rhymeGroups) {
  // Collect word occurrences
  const occs = [];
  for (let bi = 0; bi < bars.length; bi++) {
    let m;
    const re = /[a-zA-Z']+/g;
    while ((m = re.exec(bars[bi])) !== null) {
      const w = m[0].toLowerCase().replace(/^'+|'+$/g, "");
      if (w.length > 1 && !STOP_WORDS.has(w)) {
        occs.push({ bi, s: m.index, e: m.index + m[0].length, w });
      }
    }
  }

  // Group by suffix
  const bySuffix = {};
  for (const occ of occs) {
    const suf = rhymeSuffix(occ.w);
    if (suf.length >= 2) {
      const key = suf.slice(-2);
      if (!bySuffix[key]) bySuffix[key] = [];
      bySuffix[key].push(occ);
    }
  }

  // Group by custom DB
  const wordToGroups = {};
  for (const g of rhymeGroups) {
    for (const w of g.words) {
      const wl = w.toLowerCase();
      if (!wordToGroups[wl]) wordToGroups[wl] = new Set();
      wordToGroups[wl].add(g.id);
    }
  }
  const byDb = {};
  for (const occ of occs) {
    const groups = wordToGroups[occ.w];
    if (groups) {
      for (const gid of groups) {
        const key = `_db${gid}`;
        if (!byDb[key]) byDb[key] = [];
        byDb[key].push(occ);
      }
    }
  }

  // Build clusters: groups of rhyming word positions
  const raw = [];
  for (const [, members] of Object.entries(bySuffix)) {
    const uniqueWords = new Set(members.map((m) => m.w));
    const barsHit = new Set(members.map((m) => m.bi));
    if (uniqueWords.size >= 2 && barsHit.size >= 2) {
      raw.push(new Set(members.map((m) => `${m.bi},${m.s},${m.e}`)));
    }
  }
  for (const [, members] of Object.entries(byDb)) {
    const uniqueWords = new Set(members.map((m) => m.w));
    if (uniqueWords.size >= 2) {
      raw.push(new Set(members.map((m) => `${m.bi},${m.s},${m.e}`)));
    }
  }

  // Merge overlapping clusters
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        // Check word overlap
        const wordsI = new Set();
        const wordsJ = new Set();
        for (const k of raw[i]) {
          const [bi, s, e] = k.split(",").map(Number);
          wordsI.add(bars[bi].slice(s, e).toLowerCase());
        }
        for (const k of raw[j]) {
          const [bi, s, e] = k.split(",").map(Number);
          wordsJ.add(bars[bi].slice(s, e).toLowerCase());
        }
        let overlap = false;
        for (const w of wordsI) { if (wordsJ.has(w)) { overlap = true; break; } }
        if (overlap) {
          for (const k of raw[j]) raw[i].add(k);
          raw.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Convert to map: "bi,s,e" -> cluster index
  const cmap = {};
  for (let ci = 0; ci < raw.length; ci++) {
    for (const key of raw[ci]) {
      cmap[key] = ci;
    }
  }
  return cmap;
}

// --- Scoring ---
function rateVerse(bars, density, internalN, cmap) {
  const n = bars.length;
  if (n === 0) return { score: 0, grade: "?", extras: {} };

  const uniqueBars = new Set(bars.map((b) => b.toLowerCase().trim())).size;
  const repeatRatio = uniqueBars / n;

  const rhymeSc = Math.min(density / 100, 1) * 10;
  const intPerBar = internalN / n;
  const internalSc = Math.min(intPerBar / 1, 1) * 10;

  const syls = bars.map(lineSyllables);
  const meanS = syls.reduce((a, b) => a + b, 0) / n;
  const variance = syls.reduce((a, s) => a + (s - meanS) ** 2, 0) / n;
  const cv = meanS > 0 ? Math.sqrt(variance) / meanS : 1;
  const flowSc = Math.max(0, (1 - cv * 0.5)) * 10;

  const totalWords = bars.reduce((a, b) => a + b.split(/\s+/).filter(Boolean).length, 0);
  const sylTotal = syls.reduce((a, b) => a + b, 0);
  const sylPerWord = totalWords > 0 ? sylTotal / totalWords : 1;
  const vocabSc = Math.min((sylPerWord - 1) / 0.7, 1) * 10;

  const nClusters = new Set(Object.values(cmap)).size;
  const clusterSc = Math.min(nClusters / Math.max(n * 0.4, 1), 1) * 10;

  const allitN = countAlliteration(bars);
  const simileN = countSimiles(bars);
  const uniqueR = uniqueRatio(bars);

  // Multisyllabic: rhyming words with 3+ syllables
  let multiN = 0;
  for (const key of Object.keys(cmap)) {
    const [bi, s, e] = key.split(",").map(Number);
    const word = bars[bi].slice(s, e);
    if (countSyllables(word) >= 3) multiN++;
  }

  const multiSc = Math.min(multiN / Math.max(n * 0.5, 1), 1) * 10;

  const allitBonus = Math.min(allitN / Math.max(n * 1.5, 1), 1) * 0.8;
  const simileBonus = Math.min(simileN / Math.max(n * 0.3, 1), 1) * 0.4;

  let raw = rhymeSc * 0.20 + internalSc * 0.20 + flowSc * 0.10
    + vocabSc * 0.10 + clusterSc * 0.15 + multiSc * 0.25;
  raw += allitBonus + simileBonus;

  const uniqueMult = Math.min(uniqueR / 0.7, 1);
  const repeatMult = Math.min(repeatRatio / 0.8, 1);
  raw *= uniqueMult * repeatMult;

  const score = Math.max(0, Math.min(10, raw));
  let grade;
  if (score >= 9) grade = "S";
  else if (score >= 8) grade = "A";
  else if (score >= 6.5) grade = "B";
  else if (score >= 5) grade = "C";
  else if (score >= 3) grade = "D";
  else grade = "F";

  const components = [
    { name: "Multisyllabic", sc: multiSc, weight: 0.25 },
    { name: "End Rhyme", sc: rhymeSc, weight: 0.20 },
    { name: "Internal Rhyme", sc: internalSc, weight: 0.20 },
    { name: "Rhyme Variety", sc: clusterSc, weight: 0.15 },
    { name: "Flow", sc: flowSc, weight: 0.10 },
    { name: "Vocabulary", sc: vocabSc, weight: 0.10 },
  ];
  const bonuses = [
    { name: "Alliteration", val: allitBonus, max: 0.8 },
    { name: "Similes", val: simileBonus, max: 0.4 },
  ];

  return {
    score: Math.round(score * 10) / 10,
    grade,
    extras: {
      allitN, simileN, uniqueR, multiN,
      components, bonuses, uniqueMult, repeatMult,
    },
  };
}

// --- Rhyme group helper: convert flat rows to grouped structure ---
function groupRhymes(rows) {
  const map = {};
  for (const r of rows) {
    const gid = r.rhyme_group;
    if (!map[gid]) map[gid] = { id: gid, words: [], rowIds: [] };
    map[gid].words.push(r.word);
    map[gid].rowIds.push(r.id);
  }
  return Object.values(map);
}

export default function LyricLabPage() {
  const [rhymeRows, setRhymeRows] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [rhymeInput, setRhymeInput] = useState("");
  const [sylInput, setSylInput] = useState("");
  const [cmuData, setCmuData] = useState(null);
  const [cmuLoading, setCmuLoading] = useState(false);
  const [pasteArea, setPasteArea] = useState("");
  const [loadedId, setLoadedId] = useState(null);
  const [loadedTitle, setLoadedTitle] = useState("");
  const [saveTitle, setSaveTitle] = useState("");
  const [saveStatus, setSaveStatus] = useState("draft");
  const [showSave, setShowSave] = useState(false);
  const [addRhymeInput, setAddRhymeInput] = useState("");
  const [rhymeFilter, setRhymeFilter] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [showRhymeDb, setShowRhymeDb] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    const { data: rData } = await supabase.from("rhymes").select("*").order("rhyme_group");
    setRhymeRows(rData || []);
    const { data: lData } = await supabase.from("lyrics").select("*").order("updated_at", { ascending: false });
    setLyrics(lData || []);
  }

  useEffect(() => { load(); }, []);

  function flash(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }

  const rhymeGroups = groupRhymes(rhymeRows);

  // --- Rhyme Finder ---
  function findRhymesDb(word) {
    if (!word || !rhymeRows.length) return [];
    const wl = word.toLowerCase();
    const matchedGroups = new Set();
    for (const r of rhymeRows) {
      if (r.word.toLowerCase() === wl) matchedGroups.add(r.rhyme_group);
    }
    if (!matchedGroups.size) {
      for (const r of rhymeRows) {
        if (r.word.toLowerCase().includes(wl)) matchedGroups.add(r.rhyme_group);
      }
    }
    const results = [];
    const seen = new Set();
    for (const r of rhymeRows) {
      if (matchedGroups.has(r.rhyme_group) && r.word.toLowerCase() !== wl && !seen.has(r.word.toLowerCase())) {
        seen.add(r.word.toLowerCase());
        results.push(r.word);
      }
    }
    return results;
  }

  async function lookupCmu(word) {
    if (!word) { setCmuData(null); return; }
    setCmuLoading(true);
    try {
      const resp = await fetch(`/api/cmu?word=${encodeURIComponent(word)}`);
      const data = await resp.json();
      setCmuData(data);
    } catch { setCmuData(null); }
    setCmuLoading(false);
  }

  const rhymeWord = rhymeInput.trim();
  const rhymeResults = rhymeWord ? findRhymesDb(rhymeWord) : [];
  const rhymeBySyl = {};
  for (const r of rhymeResults) {
    const s = countSyllables(r);
    if (!rhymeBySyl[s]) rhymeBySyl[s] = [];
    rhymeBySyl[s].push(r);
  }

  // --- Syllable Counter ---
  const sylWords = sylInput.trim() ? (sylInput.match(/[a-zA-Z']+/g) || []) : [];
  const sylPairs = sylWords.map((w) => [w, countSyllables(w)]);
  const sylTotal = sylPairs.reduce((a, [, s]) => a + s, 0);

  // --- Analyzer ---
  let analysis = null;
  if (pasteArea.trim()) {
    const bars = pasteArea.split("\n")
      .map((l) => l.replace(/\([^)]*\)/g, "").trim())
      .filter(Boolean);
    if (bars.length) {
      const wc = bars.reduce((a, b) => a + b.split(/\s+/).filter(Boolean).length, 0);
      const ts = bars.reduce((a, b) => a + lineSyllables(b), 0);
      const avg = ts / bars.length;

      const scheme = detectScheme(bars, rhymeGroups);
      const cmap = buildRhymeMap(bars, rhymeGroups);

      const rhyN = scheme.filter((l, i) => scheme.filter((x) => x === l).length > 1 && l !== "-").length;
      const density = scheme.length ? (rhyN / scheme.length) * 100 : 0;

      // Internal rhymes: rhyming positions that aren't the last word of their line
      const lastWordPos = new Set();
      for (let bi = 0; bi < bars.length; bi++) {
        const matches = [...bars[bi].matchAll(/[a-zA-Z']+/g)];
        if (matches.length) {
          const last = matches[matches.length - 1];
          lastWordPos.add(`${bi},${last.index},${last.index + last[0].length}`);
        }
      }
      const internalN = Object.keys(cmap).filter((k) => !lastWordPos.has(k)).length;

      const { score, grade, extras } = rateVerse(bars, density, internalN, cmap);

      // Literary devices
      const simileHits = [];
      const allitHits = [];
      for (let i = 0; i < bars.length; i++) {
        // Similes
        let m;
        const likeRe = /\blike\b/gi;
        while ((m = likeRe.exec(bars[i])) !== null) {
          const ctx = bars[i].slice(Math.max(0, m.index - 20), m.index + 30).trim();
          simileHits.push({ bar: i + 1, ctx });
        }
        // Alliteration
        const words = getWords(bars[i]).filter((w) => !STOP_WORDS.has(w));
        const starts = {};
        for (const w of words) {
          if (!starts[w[0]]) starts[w[0]] = [];
          starts[w[0]].push(w);
        }
        for (const [letter, ws] of Object.entries(starts)) {
          if (ws.length >= 3) allitHits.push({ bar: i + 1, letter: letter.toUpperCase(), words: ws });
        }
      }

      // Unrhymed endings
      const unrhymed = [];
      for (let i = 0; i < bars.length; i++) {
        const lw = lastWord(bars[i]);
        if (!lw) continue;
        const lbl = scheme[i] || "-";
        if (!(scheme.filter((x) => x === lbl).length > 1 && lbl !== "-")) {
          unrhymed.push(lw);
        }
      }

      analysis = {
        bars, wc, ts, avg, scheme, density, internalN,
        score, grade, extras,
        simileHits, allitHits, unrhymed, cmap,
      };
    }
  }

  // --- Save / Update ---
  async function saveNew() {
    if (!saveTitle.trim() || !pasteArea.trim()) return;
    await supabase.from("lyrics").insert({
      title: saveTitle.trim(),
      content: pasteArea,
      status: saveStatus,
    });
    flash(`Saved '${saveTitle.trim()}'`);
    setSaveTitle("");
    setShowSave(false);
    load();
  }

  async function updateLyric() {
    if (!loadedId) return;
    await supabase.from("lyrics").update({
      content: pasteArea,
      updated_at: new Date().toISOString(),
    }).eq("id", loadedId);
    flash(`Updated '${loadedTitle}'`);
    load();
  }

  async function deleteLyric(id, title) {
    await supabase.from("lyrics").delete().eq("id", id);
    if (loadedId === id) { setLoadedId(null); setLoadedTitle(""); }
    setDeleteConfirm(null);
    flash(`Deleted '${title}'`);
    load();
  }

  function loadLyric(ly) {
    setLoadedId(ly.id);
    setLoadedTitle(ly.title);
    setPasteArea(ly.content || "");
    setShowArchive(false);
  }

  // --- Custom Rhymes ---
  async function addRhymeSet() {
    const words = addRhymeInput.split(",").map((w) => w.trim()).filter(Boolean);
    if (words.length < 2) return;
    const maxGroup = rhymeRows.length
      ? Math.max(...rhymeRows.map((r) => r.rhyme_group)) + 1
      : 1;
    const rows = words.map((w) => ({ word: w, rhyme_group: maxGroup }));
    await supabase.from("rhymes").insert(rows);
    setAddRhymeInput("");
    flash(`Added: ${words.join(" / ")}`);
    load();
  }

  async function deleteRhymeRow(id) {
    await supabase.from("rhymes").delete().eq("id", id);
    load();
  }

  // --- Filtered rhyme DB ---
  const filteredGroups = rhymeFilter
    ? rhymeGroups.filter((g) => g.words.some((w) => w.toLowerCase().includes(rhymeFilter.toLowerCase())))
    : rhymeGroups;

  return (
    <div>
      <h1 className="page-title">Lyric Lab</h1>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {/* Tools row */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        {/* Rhyme Finder */}
        <div style={{ flex: "3 1 300px" }}>
          <h3>Rhyme Finder</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Type a word..."
              value={rhymeInput}
              onChange={(e) => { setRhymeInput(e.target.value); setCmuData(null); }}
              onKeyDown={(e) => e.key === "Enter" && lookupCmu(rhymeInput.trim())}
              style={{ flex: 1, padding: 8, boxSizing: "border-box" }}
            />
            <button className="btn btn-primary" onClick={() => lookupCmu(rhymeInput.trim())} disabled={cmuLoading || !rhymeInput.trim()}>
              {cmuLoading ? "..." : "CMU Lookup"}
            </button>
          </div>
          {rhymeWord && (
            rhymeResults.length ? (
              <div>
                <p><strong>{rhymeResults.length} rhymes</strong> for <em>{rhymeWord}</em> ({countSyllables(rhymeWord)} syl)</p>
                {Object.keys(rhymeBySyl).sort((a, b) => a - b).map((s) => (
                  <p key={s} style={{ color: "#888", fontSize: "0.85em", margin: "2px 0" }}>
                    {s} syl &mdash; {rhymeBySyl[s].join(" / ")}
                  </p>
                ))}
                <pre style={{ background: "#1a1a2e", padding: 8, borderRadius: 4, fontSize: "0.85em", whiteSpace: "pre-wrap" }}>
                  {rhymeResults.join(" / ")}
                </pre>
              </div>
            ) : (
              <p style={{ color: "#888", fontSize: "0.85em" }}>No rhymes found for <em>{rhymeWord}</em> ({countSyllables(rhymeWord)} syl)</p>
            )
          )}
          {cmuData && cmuData.phonemes && (
            <div style={{ marginTop: 12, padding: 8, background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
              <p style={{ fontSize: "0.9em", fontWeight: 600 }}>CMU Phonemes</p>
              <p style={{ fontSize: "0.85em", fontFamily: "monospace", margin: "4px 0" }}>{cmuData.phonemes[0]}</p>
              <p style={{ fontSize: "0.8em", color: "var(--muted)" }}>
                {cmuData.syllables} syllable{cmuData.syllables !== 1 ? "s" : ""} &middot; stress: {cmuData.stress.split("").map((s) => s === "1" ? "PRIMARY" : s === "2" ? "SECONDARY" : "none").join(", ")}
              </p>
              {cmuData.rhymes.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: "0.85em", fontWeight: 600 }}>{cmuData.rhymes.length} phoneme rhymes:</p>
                  <pre style={{ background: "#1a1a2e", padding: 8, borderRadius: 4, fontSize: "0.85em", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
                    {cmuData.rhymes.join(" / ")}
                  </pre>
                </div>
              )}
            </div>
          )}
          {cmuData && !cmuData.phonemes && (
            <p style={{ fontSize: "0.8em", color: "#888", marginTop: 4 }}>Not in CMU dictionary</p>
          )}
        </div>

        {/* Syllable Counter */}
        <div style={{ flex: "2 1 200px" }}>
          <h3>Syllable Counter</h3>
          <input
            type="text"
            placeholder="Type or paste a bar..."
            value={sylInput}
            onChange={(e) => setSylInput(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
          />
          {sylInput.trim() && (
            <div>
              <p><strong>{sylTotal} syllables</strong></p>
              <p style={{ color: "#888", fontSize: "0.85em" }}>
                {sylPairs.map(([w, s]) => `${w}(${s})`).join("  ")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="divider" />

      {/* Analyzer */}
      <h3>Analyze</h3>
      {loadedId && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#888", fontSize: "0.85em" }}>Editing: <strong>{loadedTitle}</strong></span>
          <button className="btn" onClick={() => { setLoadedId(null); setLoadedTitle(""); setPasteArea(""); }}>Clear</button>
        </div>
      )}
      <textarea
        placeholder="Paste your bars..."
        value={pasteArea}
        onChange={(e) => setPasteArea(e.target.value)}
        rows={12}
        style={{ width: "100%", padding: 8, fontFamily: "monospace", boxSizing: "border-box" }}
      />

      {analysis && (
        <div>
          {/* Metrics */}
          <div className="metrics-row" style={{ marginTop: 12 }}>
            <div className="metric">
              <div className="metric-label">Bars</div>
              <div className="metric-value">{analysis.bars.length}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Words</div>
              <div className="metric-value">{analysis.wc}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Avg Syl/Bar</div>
              <div className="metric-value">{analysis.avg.toFixed(1)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Verdict</div>
              <div className="metric-value">
                <span style={{ color: GRADE_COLORS[analysis.grade] || "#666", fontWeight: 800 }}>
                  {analysis.grade}
                </span>
                <span style={{ fontSize: "0.6em", color: "#888", marginLeft: 4 }}>
                  {(analysis.score * 10).toFixed(0)}/100
                </span>
              </div>
            </div>
          </div>

          <div className="metrics-row" style={{ marginTop: 8 }}>
            <div className="metric"><div className="metric-label">End Rhyme</div><div className="metric-value">{analysis.density.toFixed(0)}%</div></div>
            <div className="metric"><div className="metric-label">Internal</div><div className="metric-value">{analysis.internalN}</div></div>
            <div className="metric"><div className="metric-label">Multi-syl</div><div className="metric-value">{analysis.extras.multiN}</div></div>
            <div className="metric"><div className="metric-label">Allit.</div><div className="metric-value">{analysis.extras.allitN}</div></div>
            <div className="metric"><div className="metric-label">Similes</div><div className="metric-value">{analysis.extras.simileN}</div></div>
            <div className="metric"><div className="metric-label">Unique</div><div className="metric-value">{(analysis.extras.uniqueR * 100).toFixed(0)}%</div></div>
          </div>

          {/* Score Breakdown (collapsible) */}
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setShowBreakdown(!showBreakdown)}>
              {showBreakdown ? "Hide" : "Show"} Score Breakdown
            </button>
            {showBreakdown && (
              <div className="card" style={{ marginTop: 8 }}>
                {[...analysis.extras.components].sort((a, b) => a.sc - b.sc).map((c) => {
                  const pct = (c.sc / 10) * 100;
                  const barClr = pct >= 80 ? "#4CAF50" : pct >= 50 ? "#FF9800" : "#F44336";
                  return (
                    <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                      <span style={{ minWidth: 120, fontSize: "0.85em" }}>{c.name} ({(c.weight * 100).toFixed(0)}%)</span>
                      <div style={{ flex: 1, background: "#333", borderRadius: 4, height: 16, overflow: "hidden" }}>
                        <div style={{ width: `${pct.toFixed(0)}%`, height: "100%", background: barClr, borderRadius: 4 }} />
                      </div>
                      <span style={{ minWidth: 40, textAlign: "right", fontSize: "0.85em", color: "#888" }}>{c.sc.toFixed(1)}/10</span>
                    </div>
                  );
                })}
                {analysis.extras.bonuses.filter((b) => b.val > 0).length > 0 && (
                  <div style={{ marginTop: 6, fontSize: "0.82em", color: "#888" }}>
                    Bonuses: {analysis.extras.bonuses.filter((b) => b.val > 0).map((b) => `${b.name} +${b.val.toFixed(1)}`).join(" · ")}
                  </div>
                )}
                {(analysis.extras.uniqueMult < 1 || analysis.extras.repeatMult < 1) && (
                  <div style={{ marginTop: 4, fontSize: "0.82em", color: "#F44336" }}>
                    Penalties: {[
                      analysis.extras.uniqueMult < 1 && `Low unique words (${(analysis.extras.uniqueMult * 100).toFixed(0)}%)`,
                      analysis.extras.repeatMult < 1 && `Repeated lines (${(analysis.extras.repeatMult * 100).toFixed(0)}%)`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                )}
                {(() => {
                  const weakest = [...analysis.extras.components].sort((a, b) => a.sc - b.sc)[0];
                  return (
                    <div style={{ marginTop: 8, padding: 8, background: "#1a1a2e", borderRadius: 6, borderLeft: "3px solid #F44336", fontSize: "0.85em" }}>
                      Biggest opportunity: <strong>{weakest.name}</strong> &mdash; scoring {weakest.sc.toFixed(1)}/10 at {(weakest.weight * 100).toFixed(0)}% weight
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Bars with scheme labels and syllable counts */}
          <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: "0.95em" }}>
            {analysis.bars.map((bar, i) => {
              const s = lineSyllables(bar);
              const lbl = analysis.scheme[i] || "-";
              const SCHEME_COLORS = ["#F44336","#2196F3","#4CAF50","#FF9800","#9C27B0","#00BCD4","#FF5722","#8BC34A"];
              const ci = lbl !== "-" ? (lbl.charCodeAt(0) - 65) : -1;
              const lclr = ci >= 0 ? SCHEME_COLORS[ci % SCHEME_COLORS.length] : "#666";
              return (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "3px 0" }}>
                  <span style={{ color: lclr, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{lbl}</span>
                  <span style={{ color: "#888", minWidth: 30, textAlign: "right", fontSize: "0.85em" }}>{s}s</span>
                  <span>{bar}</span>
                </div>
              );
            })}
          </div>

          {/* Literary Devices */}
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setShowDevices(!showDevices)}>
              {showDevices ? "Hide" : "Show"} Literary Devices
            </button>
            {showDevices && (
              <div className="card" style={{ marginTop: 8 }}>
                {analysis.simileHits.length > 0 && (
                  <div>
                    <strong>Similes</strong>
                    {analysis.simileHits.map((h, i) => (
                      <div key={i} style={{ fontSize: "0.85em", color: "#888", margin: "2px 0" }}>
                        Bar {h.bar}: &ldquo;...{h.ctx}...&rdquo;
                      </div>
                    ))}
                  </div>
                )}
                {analysis.allitHits.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Alliteration</strong>
                    {analysis.allitHits.map((h, i) => (
                      <div key={i} style={{ fontSize: "0.85em", color: "#888", margin: "2px 0" }}>
                        Bar {h.bar} ({h.letter}): {h.words.join(", ")}
                      </div>
                    ))}
                  </div>
                )}
                {!analysis.simileHits.length && !analysis.allitHits.length && (
                  <p style={{ color: "#888", fontSize: "0.85em" }}>No notable devices detected.</p>
                )}
              </div>
            )}
          </div>

          {/* Rhyme Suggestions for unrhymed endings */}
          {analysis.unrhymed.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowSuggestions(!showSuggestions)}>
                {showSuggestions ? "Hide" : "Show"} Rhyme Suggestions ({analysis.unrhymed.length} unrhymed)
              </button>
              {showSuggestions && (
                <div className="card" style={{ marginTop: 8 }}>
                  {analysis.unrhymed.slice(-8).map((word, i) => {
                    const rh = findRhymesDb(word);
                    return rh.length ? (
                      <pre key={i} style={{ background: "#1a1a2e", padding: 6, borderRadius: 4, fontSize: "0.85em", margin: "4px 0", whiteSpace: "pre-wrap" }}>
                        {word} &rarr; {rh.slice(0, 10).join(" / ")}
                      </pre>
                    ) : (
                      <p key={i} style={{ color: "#888", fontSize: "0.85em", margin: "2px 0" }}><strong>{word}</strong> &mdash; no rhymes found</p>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Save / Update */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {loadedId && (
              <button className="btn btn-primary" onClick={updateLyric}>Update in Archive</button>
            )}
            <button className="btn" onClick={() => setShowSave(!showSave)}>Save as New</button>
          </div>
          {showSave && (
            <div className="card" style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="Title"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
              />
              <select value={saveStatus} onChange={(e) => setSaveStatus(e.target.value)} style={{ padding: 8, marginBottom: 8 }}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn btn-primary" onClick={saveNew} style={{ marginLeft: 8 }}>Save</button>
            </div>
          )}
        </div>
      )}

      <div className="divider" />

      {/* Archive */}
      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => setShowArchive(!showArchive)}>
          {showArchive ? "Hide" : "Show"} Archive ({lyrics.length})
        </button>
        {showArchive && (
          <div className="card" style={{ marginTop: 8 }}>
            {!lyrics.length ? (
              <p style={{ color: "#888", fontSize: "0.85em" }}>No saved lyrics yet. Paste bars above and save them.</p>
            ) : (
              lyrics.map((ly) => {
                const ct = ly.content || "";
                const bn = ct.split("\n").filter((l) => l.trim()).length;
                const wn = ct.split(/\s+/).filter(Boolean).length;
                const sn = ct.split("\n").filter((l) => l.trim()).reduce((a, l) => a + lineSyllables(l), 0);
                const st = STATUS_LABELS[ly.status] || "Draft";
                return (
                  <div key={ly.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #333" }}>
                    <div style={{ flex: 1 }}>
                      <strong>{ly.title}</strong> &mdash; {st} &middot; {bn} bars &middot; {wn} words &middot; {sn} syl
                    </div>
                    <button className="btn" onClick={() => loadLyric(ly)}>Load</button>
                    {deleteConfirm === ly.id ? (
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="btn" style={{ color: "#F44336" }} onClick={() => deleteLyric(ly.id, ly.title)}>Yes</button>
                        <button className="btn" onClick={() => setDeleteConfirm(null)}>No</button>
                      </span>
                    ) : (
                      <button className="btn" onClick={() => setDeleteConfirm(ly.id)}>Del</button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Custom Rhymes Database */}
      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => setShowRhymeDb(!showRhymeDb)}>
          {showRhymeDb ? "Hide" : "Show"} Custom Rhymes{rhymeRows.length ? ` (${rhymeRows.length} entries, ${rhymeGroups.length} sets)` : ""}
        </button>
        {showRhymeDb && (
          <div className="card" style={{ marginTop: 8 }}>
            <p style={{ color: "#888", fontSize: "0.85em", marginBottom: 8 }}>
              Teach the analyzer rhymes it cannot detect: phrases, slang, your pronunciation.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="orange, door hinge, four inch"
                value={addRhymeInput}
                onChange={(e) => setAddRhymeInput(e.target.value)}
                style={{ flex: 1, padding: 8, boxSizing: "border-box" }}
                onKeyDown={(e) => { if (e.key === "Enter") addRhymeSet(); }}
              />
              <button className="btn btn-primary" onClick={addRhymeSet}>Add</button>
            </div>

            {rhymeRows.length > 0 && (
              <>
                <input
                  type="text"
                  placeholder="Search..."
                  value={rhymeFilter}
                  onChange={(e) => setRhymeFilter(e.target.value)}
                  style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
                />
                {filteredGroups.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #333" }}>
                    <div style={{ flex: 1, fontSize: "0.9em" }}>
                      {g.words.map((w, wi) => (
                        <span key={wi}>
                          {wi > 0 && " / "}
                          {rhymeFilter && w.toLowerCase().includes(rhymeFilter.toLowerCase())
                            ? <strong>{w}</strong>
                            : w
                          }
                        </span>
                      ))}
                    </div>
                    {g.rowIds.map((rid, ri) => (
                      <button key={rid} className="btn" style={{ fontSize: "0.7em", padding: "2px 6px" }}
                        onClick={() => deleteRhymeRow(rid)} title={`Delete "${g.words[ri]}"`}>
                        x
                      </button>
                    ))}
                  </div>
                ))}
                {rhymeFilter && !filteredGroups.length && (
                  <p style={{ color: "#888", fontSize: "0.85em" }}>No matches.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

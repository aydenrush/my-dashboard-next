// Pokémon GO keep/transfer engine for Ayden's "zero-waste" rules. Pure functions over public/pogo-data.json
// (built by scripts/pogo-data.mjs), so it can be tested with plain node.
//
// Roles a Pokémon can win (one winner per role per evolution family, across the batch + your saved box):
//   raid   15 Attack and the family reaches a top-20 attacker in some type (as itself, Shadow or Mega)
//   max    Dynamax / Gigantamax (G-Max first; IVs barely matter)
//   gl/ul  species is a PvP pick (PvPoke top 75) and the IVs are top 100 of 4096 for that league
//   ml     species is a Master League pick (top 40) and IVs are 15 / 14+ / 14+
//   trophy hundo / 98%+, shiny, costume or background (every trophy is kept)

export const RULES = { pvpTop: 75, ivTop: 100, mlTop: 40, maxLevelIndex: 98 /* level 50 */ };
// Borderline = misses one rule by a little: worth a look, your call (never in the copied transfer list)
export const BORDER = { raidTop: 30, pvpTop: 150, ivTop: 300, mlTop: 75, mlIvTop: 100 };
export const ROLE_LABEL = { raid: "Raids", max: "Max Battles", gl: "Great League", ul: "Ultra League", ml: "Master League", trophy: "Trophy" };
const CAPS = { gl: 1500, ul: 2500, ml: Infinity };

const FLAG_WORDS = {
  shadow: "shadow", purified: "purified", lucky: "lucky", shiny: "shiny", costume: "costume",
  background: "background", bg: "background", dynamax: "dynamax", dmax: "dynamax", "d-max": "dynamax",
  gigantamax: "gigantamax", gmax: "gigantamax", "g-max": "gigantamax",
};
const FORM_ALIASES = { alola: "alolan", galar: "galarian", hisui: "hisuian", paldea: "paldean" };

const norm = (s) => s.toLowerCase().replace(/\((.*?)\)/g, " $1 ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// name -> species index (shadow/mega forms come from flags and evolutions, not from typed names)
export function indexSpecies(data) {
  const byId = Object.fromEntries(data.species.map((s) => [s.id, s]));
  const byName = {};
  for (const s of data.species) {
    if (s.tags.includes("shadow") || s.tags.includes("mega") || /_mega/.test(s.id)) continue;
    for (const key of [norm(s.name), norm(s.id.replace(/_/g, " "))]) byName[key] ??= s;
  }
  return { byId, byName, data };
}

function findSpecies(words, idx) {
  const w = words.map((x) => FORM_ALIASES[x] || x);
  const tries = [w.join(" "), [...w.slice(1), w[0]].join(" "), [...w].reverse().join(" ")];
  for (const t of tries) if (idx.byName[t]) return idx.byName[t];
  const pre = Object.keys(idx.byName).filter((k) => k.startsWith(w.join(" ")));
  return pre.length === 1 ? idx.byName[pre[0]] : null;
}

// "phantump 8/15/15 purified, 14/10/15, 8/13/11 shadow" -> entries; a piece without a name reuses the last one
export function parseBatch(text, idx) {
  const entries = [], errors = [];
  let last = null;
  for (const raw of text.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) { errors.push(`"${raw}": no IVs like 15/14/13`); continue; }
    const ivs = m.slice(1, 4).map(Number);
    if (ivs.some((v) => v > 15)) { errors.push(`"${raw}": IVs go up to 15`); continue; }
    const flags = {};
    const words = [];
    for (const word of norm(raw.replace(m[0], " ")).split(" ").filter(Boolean)) {
      if (FLAG_WORDS[word]) flags[FLAG_WORDS[word]] = true;
      else if (!["special", "and", "the", "a"].includes(word)) words.push(word);
    }
    const species = words.length ? findSpecies(words, idx) : last;
    if (!species) { errors.push(`"${raw}": couldn't tell which Pokémon${words.length ? ` "${words.join(" ")}" is` : ""}`); continue; }
    last = species;
    entries.push({ raw, species, ivs, flags });
  }
  return { entries, errors };
}

// ---- PvP IV rank (stat product among all 4096 spreads, best level under the CP cap, max level 50) ----

const cpAt = (s, [a, d, h], c) => Math.max(10, Math.floor((s.atk + a) * Math.sqrt(s.def + d) * Math.sqrt(s.hp + h) * c * c / 10));

function bestLevel(s, ivs, cap, cpm, maxIdx) {
  if (cpAt(s, ivs, cpm[maxIdx]) <= cap) return maxIdx;
  let lo = 0, hi = maxIdx;
  if (cpAt(s, ivs, cpm[0]) > cap) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cpAt(s, ivs, cpm[mid]) <= cap) lo = mid; else hi = mid - 1; }
  return lo;
}

const statProduct = (s, [a, d, h], c) => (s.atk + a) * c * (s.def + d) * c * Math.floor((s.hp + h) * c);

const rankCache = new Map();
export function ivRank(s, ivs, league, cpm, maxIdx = RULES.maxLevelIndex) {
  const cap = CAPS[league];
  const key = `${s.id}|${league}`;
  let table = rankCache.get(key);
  if (!table) {
    table = new Map();
    const all = [];
    for (let a = 0; a <= 15; a++) for (let d = 0; d <= 15; d++) for (let h = 0; h <= 15; h++) {
      const li = bestLevel(s, [a, d, h], cap, cpm, maxIdx);
      all.push([`${a}/${d}/${h}`, li < 0 ? 0 : statProduct(s, [a, d, h], cpm[li]), li]);
    }
    all.sort((x, y) => y[1] - x[1]);
    let rank = 0;
    all.forEach(([k, sp, li], i) => {
      const [a, d, h] = k.split("/").map(Number);
      if (i === 0 || sp !== all[i - 1][1]) rank = i + 1; // equal stat products share a rank
      table.set(k, { rank, pct: sp / all[0][1], level: (li + 2) / 2, cp: li < 0 ? null : cpAt(s, [a, d, h], cpm[li]) });
    });
    rankCache.set(key, table);
  }
  return table.get(ivs.join("/"));
}

// ---- one Pokémon: which roles could it fill, with a score for comparing inside its family ----

const typesOf = (t) => t.raidTypes || (t.raid ? [t.raid] : []); // older data files only have the best type

function descendants(s, idx) {
  const out = [s];
  for (let i = 0; i < out.length; i++) for (const e of out[i].evolutions) if (idx.byId[e] && !out.includes(idx.byId[e])) out.push(idx.byId[e]);
  return out;
}

function candyTo(target, from, idx, purified) {
  let total = 0, cur = target;
  while (cur && cur.id !== from.id) {
    total += (purified ? cur.candyPurified : cur.candy) || 0;
    cur = idx.byId[cur.parent];
  }
  return total;
}

export function evaluate(entry, idx) {
  const { species: s, ivs: [a, d, h], flags } = entry;
  const cpm = idx.data.cpm, raidTop = idx.data.raidTop || 20;
  const fam = descendants(s, idx);
  const shadowOf = (t) => (flags.shadow && idx.byId[`${t.id}_shadow`]) || t;
  // evolution needed to reach a target form (Megas evolve to the base form first, then Mega Evolve)
  const evo = (t) => {
    const base = idx.byId[t.id.replace(/_shadow$|_mega.*$/, "")] || t;
    if (base.id === s.id) return t.tags.includes("mega") ? { to: `${base.name}, then Mega Evolve`, candy: 0 } : null;
    return { to: base.name + (t.tags.includes("mega") ? ", then Mega Evolve" : ""), candy: candyTo(base, s, idx, flags.purified) };
  };
  const cands = [];

  // raids: best form the family can become (Shadow keeps its Shadow form; Megas are open to non-Shadows)
  const raidForms = fam.flatMap((t) => [shadowOf(t), ...(flags.shadow ? [] : idx.data.species.filter((m) => m.id.startsWith(`${t.id}_mega`)))]);
  const bestRaid = raidForms.filter((t) => t.raid && t.raid.rank <= raidTop).sort((x, y) => x.raid.rank - y.raid.rank)[0];
  // one raid job per attacking type: Mega Garchomp (Dragon) and Shadow Garchomp (Ground), or Ninetales (Fire)
  // and Alolan Ninetales (Ice), are different jobs. For each type, this Pokémon's best form in that type.
  if (a === 15) {
    const byType = {};
    for (const t of raidForms) for (const r of typesOf(t)) {
      if (r.rank <= raidTop && (!byType[r.type] || r.rank < byType[r.type].r.rank)) byType[r.type] = { t, r };
    }
    for (const [type, { t, r }] of Object.entries(byType)) {
      cands.push({ role: "raid", rtype: type, score: r.pct * 100 + d + h, target: t, evo: evo(t),
        detail: `#${r.rank} ${type} attacker as ${t.name}`,
        invest: r.rank <= 5 ? "Level 40; XL Candy is worth it here" : "Level 30–35; save XL Candy",
        note: r.elite ? `needs ${titleMove(r.charged)} (Elite TM or Community Day)` : null });
    }
  }

  if (flags.gigantamax || (flags.dynamax && a === 15)) {
    cands.push({ role: "max", score: (flags.gigantamax ? 1000 : 0) + a * 10 + (d + h) / 10, target: s, evo: null,
      detail: flags.gigantamax ? "Gigantamax: G-Max move power beats any IVs" : "Dynamax",
      invest: flags.gigantamax ? "Level 30–35 + Max Attack level 2; save XL Candy" : "Hold untouched unless you need a Max attacker" });
  }

  for (const lg of ["gl", "ul"]) {
    const opts = fam.map(shadowOf).filter((t) => t[lg] && t[lg] <= RULES.pvpTop)
      .map((t) => ({ t, r: ivRank(t, [a, d, h], lg, cpm) })).filter((o) => o.r && o.r.rank <= RULES.ivTop)
      .sort((x, y) => x.r.rank - y.r.rank || x.t[lg] - y.t[lg]);
    if (opts[0]) {
      const { t, r } = opts[0];
      cands.push({ role: lg, score: 10000 - r.rank, target: t, evo: evo(t), rank: r.rank,
        detail: `IV rank #${r.rank} (${(r.pct * 100).toFixed(1)}%) as ${t.name}, #${t[lg]} in ${ROLE_LABEL[lg]}`,
        invest: `Power up to level ${r.level} for the ${CAPS[lg]} CP cap` });
    }
  }

  const ml = fam.map(shadowOf).filter((t) => t.ml && t.ml <= RULES.mlTop).sort((x, y) => x.ml - y.ml)[0];
  if (ml && a === 15 && d >= 14 && h >= 14) {
    cands.push({ role: "ml", score: a + d + h, target: ml, evo: evo(ml), detail: `#${ml.ml} in Master League as ${ml.name}`, invest: "Level 40+, XL Candy only if you play Master League" });
  }

  if (a + d + h >= 44 || flags.shiny || flags.costume || flags.background) {
    const why = [a + d + h === 45 ? "hundo" : a + d + h >= 44 ? `${Math.round(((a + d + h) / 45) * 100)}%` : null, flags.shiny && "shiny", flags.costume && "costume", flags.background && "background"].filter(Boolean);
    cands.push({ role: "trophy", score: 0, target: s, evo: null, detail: why.join(" + "), invest: "No resources needed" });
  }

  // near-misses for jobs it didn't qualify for
  const near = [];
  const has = (role) => cands.some((c) => c.role === role);
  const nearRaid = raidForms.filter((t) => t.raid && t.raid.rank <= BORDER.raidTop).sort((x, y) => x.raid.rank - y.raid.rank)[0];
  if (!has("raid") && nearRaid && a === 15) {
    near.push({ role: "raid", detail: `#${nearRaid.raid.rank} ${nearRaid.raid.type} as ${nearRaid.name}, just outside the top ${raidTop}` });
  }
  for (const lg of ["gl", "ul"]) {
    if (has(lg)) continue;
    const o = fam.map(shadowOf).filter((t) => t[lg] && t[lg] <= BORDER.pvpTop)
      .map((t) => ({ t, r: ivRank(t, [a, d, h], lg, cpm) })).filter((x) => x.r.rank <= BORDER.ivTop)
      .sort((x, y) => x.r.rank - y.r.rank)[0];
    if (o) near.push({ role: lg, detail: `IV rank #${o.r.rank} as ${o.t.name} (#${o.t[lg]} in ${ROLE_LABEL[lg]})${o.t[lg] > RULES.pvpTop ? `, species just outside the top ${RULES.pvpTop}` : ""}${o.r.rank > RULES.ivTop ? `, IVs just outside the top ${RULES.ivTop}` : ""}` });
  }
  if (!has("ml")) {
    const o = fam.map(shadowOf).filter((t) => t.ml && t.ml <= BORDER.mlTop)
      .map((t) => ({ t, r: ivRank(t, [a, d, h], "ml", cpm) }))
      .filter((x) => (a === 15 && d >= 14 && h >= 14) || x.r.rank <= BORDER.mlIvTop).sort((x, y) => x.t.ml - y.t.ml)[0];
    if (o) near.push({ role: "ml", detail: `#${o.t.ml} in Master League as ${o.t.name}, IV rank #${o.r.rank}${o.t.ml > RULES.mlTop ? ` (species just outside the top ${RULES.mlTop})` : ""}${a < 15 ? ` (${a} Attack, your rule wants 15)` : ""}` });
  }

  return { entry, cands, near, why: transferReasons(entry, idx, { bestRaid, fam: fam.map(shadowOf), cpm }) };
}

// short reasons for when nothing wins (most useful first)
function transferReasons({ ivs: [a, d, h], flags }, idx, { bestRaid, fam, cpm }) {
  const out = [];
  if (bestRaid && a < 15) out.push(`${a} Attack misses your 15-Attack raid rule`);
  if (!bestRaid) out.push("not a top-20 raid attacker in any form");
  for (const lg of ["gl", "ul"]) {
    const t = fam.filter((x) => x[lg] && x[lg] <= RULES.pvpTop).sort((x, y) => x[lg] - y[lg])[0];
    if (t) { const r = ivRank(t, [a, d, h], lg, cpm); out.push(`IV rank #${r.rank} for ${ROLE_LABEL[lg]} as ${t.name} (needs top ${RULES.ivTop})`); }
  }
  if (!fam.some((x) => (x.gl && x.gl <= RULES.pvpTop) || (x.ul && x.ul <= RULES.pvpTop))) out.push("not a Great/Ultra League pick");
  return out;
}

const titleMove = (id) => id.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const ivText = (e) => `${e.ivs.join("/")}${Object.keys(e.flags).length ? ` ${Object.keys(e.flags).join(" ")}` : ""}`;

// ---- a batch: one winner per role per family, compared against your saved box too ----
export function decideBatch(entries, idx, box = []) {
  const evals = entries.map((e) => evaluate(e, idx));
  const boxEvals = box.map((e) => ({ ...evaluate(e, idx), fromBox: true }));
  const fams = {};
  for (const ev of [...evals, ...boxEvals]) (fams[ev.entry.species.family] ||= []).push(ev);

  const wins = new Map(), backups = new Map();
  for (const group of Object.values(fams)) {
    const jobs = [...new Set(group.flatMap((ev) => ev.cands.filter((c) => c.role !== "trophy").map((c) => c.role + (c.rtype ? `:${c.rtype}` : ""))))];
    for (const job of jobs) {
      const [role, rtype] = job.split(":");
      const contenders = group.map((ev) => ({ ev, c: ev.cands.find((c) => c.role === role && (c.rtype || "") === (rtype || "")) })).filter((x) => x.c).sort((x, y) => y.c.score - x.c.score);
      if (!contenders.length) continue;
      const [top, ...rest] = contenders;
      if (!top.ev.fromBox) wins.set(top.ev, [...(wins.get(top.ev) || []), top.c]);
      // runners-up still pass the rules for this job: they become backups, not transfers
      const behind = `${top.ev.fromBox ? "your box's" : ""} ${top.ev.entry.species.name} ${ivText(top.ev.entry)}`.trim();
      for (const r of rest) if (!r.ev.fromBox) backups.set(r.ev, [...(backups.get(r.ev) || []), { ...r.c, behind }]);
    }
    for (const ev of group) { const t = ev.cands.find((c) => c.role === "trophy"); if (t && !ev.fromBox) wins.set(ev, [...(wins.get(ev) || []), t]); }
  }

  return evals.map((ev) => {
    const roles = wins.get(ev) || [];
    // shown on every result, keepers included (a trophy can still be a backup raider or borderline ML)
    const won = new Set(roles.map((c) => c.role));
    const backup = backups.get(ev) || []; // a raid backup can be for a different type than the one it won
    const borderline = ev.near.filter((c) => !won.has(c.role) && !backup.some((x) => x.role === c.role));
    return {
      entry: ev.entry, keep: roles.length > 0, backup, borderline, roles,
      verdict: roles.length ? "keep" : backup.length ? "backup" : borderline.length ? "borderline" : "transfer",
      reasons: roles.length || backup.length || borderline.length ? [] : ev.why.slice(0, 2),
    };
  });
}

export function transferList(results) {
  return results.filter((r) => r.verdict === "transfer").map((r) => `${r.entry.species.name} ${ivText(r.entry)}`).join("\n");
}

// ---- the "Why?" breakdown: every role, every form the family can become, and why the others rank lower ----
export function explain(entry, idx) {
  const { species: s, ivs: [a, d, h], flags } = entry;
  const cpm = idx.data.cpm, raidTop = idx.data.raidTop || 20;
  const fam = descendants(s, idx);
  const forms = fam.flatMap((t) => [
    (flags.shadow && idx.byId[`${t.id}_shadow`]) || t,
    ...(flags.shadow ? [] : idx.data.species.filter((m) => m.id.startsWith(`${t.id}_mega`))),
  ]);

  const raid = forms.filter((t) => typesOf(t).length).map((t) => ({
    form: t.name,
    counts: typesOf(t)[0].rank <= raidTop,
    near: typesOf(t)[0].rank > raidTop && typesOf(t)[0].rank <= BORDER.raidTop,
    types: typesOf(t).map((r) => ({ type: r.type, rank: r.rank, pct: r.pct, moves: `${titleMove(r.fast)} + ${titleMove(r.charged)}`, elite: r.elite })),
  })).sort((x, y) => x.types[0].rank - y.types[0].rank).slice(0, 3); // its 3 strongest forms
  const raidAtk = a === 15;

  const pvp = {};
  for (const lg of ["gl", "ul", "ml"]) {
    const rows = forms.filter((t) => !t.tags.includes("mega")).map((t) => {
      const r = ivRank(t, [a, d, h], lg, cpm);
      const metaTop = lg === "ml" ? RULES.mlTop : RULES.pvpTop;
      const meta = Boolean(t[lg] && t[lg] <= metaTop);
      const ivOk = lg === "ml" ? a === 15 && d >= 14 && h >= 14 : r.rank <= RULES.ivTop;
      const near = !(meta && ivOk) && (lg === "ml"
        ? Boolean(t.ml && t.ml <= BORDER.mlTop && (ivOk || r.rank <= BORDER.mlIvTop))
        : Boolean(t[lg] && t[lg] <= BORDER.pvpTop && r.rank <= BORDER.ivTop));
      return { form: t.name, speciesRank: t[lg], meta, ivRank: r.rank, pct: r.pct, level: r.level, cp: r.cp, ivOk, ok: meta && ivOk, near };
    }).sort((x, y) => (y.ok - x.ok) || ((x.speciesRank || 9999) - (y.speciesRank || 9999)));
    // only forms PvPoke ranks in this league (unranked pre-evolutions are noise); else just the last form
    const ranked = rows.filter((r) => r.speciesRank);
    pvp[lg] = ranked.length ? ranked.slice(0, 3) : rows.filter((r) => r.form === forms.filter((t) => !t.tags.includes("mega")).at(-1).name);
  }

  return {
    raid, raidAtk, pvp,
    max: flags.gigantamax ? "Gigantamax: its G-Max move hits harder than any Dynamax, so IVs barely matter (1–3%)." : flags.dynamax ? "Dynamax: usable in Max Battles, but any Gigantamax of the family beats it." : null,
    rules: { raidTop, pvpTop: RULES.pvpTop, ivTop: RULES.ivTop, mlTop: RULES.mlTop },
  };
}

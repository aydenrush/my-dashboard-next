// Pokémon GO keep/transfer engine for Ayden's "zero-waste" rules. Pure functions over public/pogo-data.json
// (built by scripts/pogo-data.mjs), so it can be tested with plain node.
//
// Roles a Pokémon can win (per evolution family, across the batch + your saved box; usually one winner per role,
// but jobs you field as a team keep a team: see teamSize):
//   raid   15 Attack and the family reaches a top-12 attacker in some type (as itself, Shadow or Mega); top 5 = XL-worthy
//   max    caught as Dynamax/G-Max: G-Max always; attacker = 15 Attack and 70%+ of the best Max attacker of that
//          Max move type (= its fast move's type); tank = top 40 bulk with Defense/HP 13+ (Max Guard/Spirit)
//   gl/ul  species is a PvP pick (PvPoke top 75) and the IVs are top 100 of 4096 for that league
//   ml     species is a Master League pick (top 40) and IVs are 15 / 14+ / 14+
//   gym    a classic gym wall (Blissey, Snorlax...) with Defense and HP 13+; Attack doesn't matter
//   trophy hundo or nundo (0/0/0, just as rare) (a 98% is judged on its jobs like anything else), shiny, XXL, numbered costume/background, mythical/one-off, legacy move, Keep anyway

// strict zero-waste cutoffs (tightened after Gemini review, Nov 2026)
export const RULES = { raidTop: 12, raidXl: 5, pvpTop: 60, ivTop: 75, mlTop: 30, maxPct: 70, maxTankTop: 40, maxLevelIndex: 98 /* level 50 */ };
// Borderline = misses one rule by a little: worth a look, your call (never in the copied transfer list)
export const BORDER = { raidTop: 20, pvpTop: 120, ivTop: 200, mlTop: 60, mlIvTop: 100, maxPct: 60, maxTankTop: 80 };
export const ROLE_LABEL = { raid: "Raids", max: "Max Battles", gl: "Great League", ul: "Ultra League", ml: "Master League", gym: "Gym defender", trophy: "Trophy" };
// shortcut: hand-picked gym walls (no gym rankings in the data file); add species here if the gym meta shifts
const GYM_DEFENDERS = ["blissey", "chansey", "snorlax", "slaking", "togekiss", "wobbuffet", "melmetal"];
const CAPS = { gl: 1500, ul: 2500, ml: Infinity };
// Mighty Pokémon are caught at level 40–50 (IVs 13+), so they skip most of the Stardust/XL cost of powering up,
// but can't go down to a CP cap. Level 40 = cpm index 78.
// minAtk: a Mighty is already level 40+, worth ~7% over a level-30 raider, while each Attack IV point is ~0.3%,
// so 13 Attack is enough for raid and Max attacker jobs
const MIGHTY = { raid: 20, max: 30, ml: 5, minLevelIndex: 78, minAtk: 13 };
const minAtkFor = (flags) => (flags.mighty ? MIGHTY.minAtk : 15);
// Lucky: half Stardust to power up, so it wins ties for jobs you'd invest in (never a reason to keep on its own)
const LUCKY = { raid: 10, ml: 3 };
const overCapIfMighty = (t, ivs, lg, flags, cpm) => flags.mighty && CAPS[lg] !== Infinity && cpAt(t, ivs, cpm[MIGHTY.minLevelIndex]) > CAPS[lg];

const FLAG_WORDS = {
  shadow: "shadow", purified: "purified", lucky: "lucky", shiny: "shiny", costume: "costume",
  background: "background", bg: "background", dynamax: "dynamax", dmax: "dynamax", "d-max": "dynamax",
  gigantamax: "gigantamax", gmax: "gigantamax", "g-max": "gigantamax", mighty: "mighty",
  oneoff: "oneoff", "one-off": "oneoff", research: "oneoff",
  legacy: "legacy", xxl: "xxl", keep: "keep", old: "old",
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

// a typed name ("alolan ninetales", "Ninetales (Alolan)", "gab" if unique) -> species, or null
export const lookupSpecies = (text, idx) => { const w = norm(text).split(" ").filter(Boolean); return w.length ? findSpecies(w, idx) : null; };

// names to suggest in the quick-entry box (no Shadow/Mega forms: those come from flags and evolutions)
export const pickableNames = (idx) => [...new Set(Object.values(idx.byName).map((s) => s.name))].sort();

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
      const v = word.match(/^(costume|background|bg)(\d+)$/); // "costume2", "bg1": which costume/background
      if (v) flags[FLAG_WORDS[v[1]]] = Number(v[2]);
      else if (FLAG_WORDS[word]) flags[FLAG_WORDS[word]] = true;
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
// what else the evolution needs on the way: items (Metal Coat, Sinnoh Stone...) and conditions (night only, buddy km, quests)
function itemsTo(target, from, idx) {
  const out = [];
  for (let cur = target; cur && cur.id !== from.id; cur = idx.byId[cur.parent]) out.unshift(...[cur.evoItem, ...(cur.evoNotes || [])].filter(Boolean));
  return out;
}

export function evaluate(entry, idx) {
  const { species: s, ivs: [a, d, h], flags } = entry;
  const cpm = idx.data.cpm, raidTop = RULES.raidTop;
  const fam = descendants(s, idx);
  const shadowOf = (t) => (flags.shadow && idx.byId[`${t.id}_shadow`]) || t;
  // evolution needed to reach a target form (Megas evolve to the base form first, then Mega Evolve)
  const evo = (t) => {
    const base = idx.byId[t.id.replace(/_shadow$|_(mega|primal).*$/, "")] || t;
    if (base.id === s.id) return t.tags.includes("mega") ? { to: null, mega: true, candy: 0 } : null; // already there: just Mega Evolve
    return { to: base.name + (t.tags.includes("mega") ? ", then Mega Evolve" : ""), mega: t.tags.includes("mega"), candy: candyTo(base, s, idx, flags.purified), items: itemsTo(base, s, idx) };
  };
  const cands = [];

  // raids: best form the family can become (Shadow keeps its Shadow form; Megas are open to non-Shadows)
  const raidForms = fam.flatMap((t) => [shadowOf(t), ...(flags.shadow ? [] : idx.data.species.filter((m) => (m.id.startsWith(`${t.id}_mega`) || m.id === `${t.id}_primal`)))]);
  const bestRaid = raidForms.filter((t) => t.raid && t.raid.rank <= raidTop).sort((x, y) => x.raid.rank - y.raid.rank)[0];
  // one raid job per attacking type: Mega Garchomp (Dragon) and Shadow Garchomp (Ground), or Ninetales (Fire)
  // and Alolan Ninetales (Ice), are different jobs. For each type, this Pokémon's best form in that type.
  const minAtk = minAtkFor(flags);
  if (a >= minAtk) {
    const byType = {};
    for (const t of raidForms) for (const r of typesOf(t)) {
      if (r.rank <= raidTop && (!byType[r.type] || r.rank < byType[r.type].r.rank)) byType[r.type] = { t, r };
    }
    for (const [type, { t, r }] of Object.entries(byType)) {
      cands.push({ role: "raid", rtype: type, raidRank: r.rank, moves: `${mv(t, r.fast)} + ${mv(t, r.charged)}`, moveSet: moveSet(t, r.fast, [r.charged], idx), mega: t.tags.includes("mega"), score: r.pct * 100 + a * 3 + d + h + (flags.mighty ? MIGHTY.raid : 0) + (flags.lucky ? LUCKY.raid : 0), target: t, evo: evo(t),
        detail: `#${r.rank} ${type} attacker as ${t.name}`,
        invest: (flags.mighty ? "Already level 40+ (Mighty): little or no Stardust/XL needed" : r.rank <= RULES.raidXl ? "Level 40; XL Candy is worth it here" : "Level 30–35; save XL Candy") + (flags.lucky ? " (Lucky: half Stardust)" : ""),
        note: r.elite ? `needs ${titleMove(r.charged)} (Elite TM or Community Day)` : null });
    }
  }

  // Max Battles: only if you caught it as Dynamax/G-Max (it stays that way when it evolves). Shadows/Megas can't.
  const mighty = flags.mighty ? MIGHTY.max : 0;
  if (flags.gigantamax) {
    cands.push({ role: "max", score: 1000 + a * 10 + (d + h) / 10 + mighty, target: s, evo: null,
      detail: "Gigantamax: G-Max move power beats any IVs", invest: "Level 30–35 + Max Attack level 2; save XL Candy" });
  }
  const maxAtk = {}; // per Max move type: the family's strongest form
  let maxTank = null;
  if (flags.dynamax || flags.gigantamax) {
    for (const t of fam) {
      for (const m of t.maxTypes || []) if (!maxAtk[m.type] || m.pct > maxAtk[m.type].m.pct) maxAtk[m.type] = { t, m };
      if (t.maxTank && (!maxTank || t.maxTank < maxTank.maxTank)) maxTank = t;
    }
    // a G-Max beats a Dynamax of the same family at the same job
    if (a >= minAtk) for (const [type, { t, m }] of Object.entries(maxAtk)) if (m.pct >= RULES.maxPct) {
      cands.push({ role: "max", rtype: type, pct: m.pct, moves: m.fast ? `${mv(t, m.fast)} (→ Max ${type[0].toUpperCase() + type.slice(1)})` : null, moveSet: m.fast ? { ...moveSet(t, m.fast, [], idx), max: type } : null, score: m.pct * 10 + d + h + mighty + (flags.gigantamax ? 50 : 0), target: t, evo: evo(t),
        detail: `${m.pct}% of the best ${type} Max attacker (#${m.rank} of everything) as ${t.name}`,
        invest: "Level 40 + Max Attack level 2–3; XL Candy only for your best one" });
    }
    if (maxTank && maxTank.maxTank <= RULES.maxTankTop && d >= 13 && h >= 13) {
      cands.push({ role: "max", rtype: "tank", score: d + h + mighty + (flags.gigantamax ? 5 : 0), target: maxTank, evo: evo(maxTank),
        detail: `#${maxTank.maxTank} bulkiest for Max Guard/Spirit as ${maxTank.name} (Def ${d}, HP ${h})`,
        invest: "Level 40 for bulk + Max Guard or Max Spirit level 2; Attack doesn't matter" });
    }
  }

  for (const lg of ["gl", "ul"]) {
    const opts = fam.map(shadowOf).filter((t) => t[lg] && t[lg] <= RULES.pvpTop && !overCapIfMighty(t, [a, d, h], lg, flags, cpm))
      .map((t) => ({ t, r: ivRank(t, [a, d, h], lg, cpm) })).filter((o) => o.r && o.r.rank <= RULES.ivTop)
      .sort((x, y) => x.r.rank - y.r.rank || x.t[lg] - y.t[lg]);
    if (opts[0]) {
      const { t, r } = opts[0];
      cands.push({ role: lg, score: 10000 - r.rank, moves: pvpMovesText(t, lg), moveSet: t.pvpMoves?.[lg] ? moveSet(t, t.pvpMoves[lg][0], t.pvpMoves[lg].slice(1), idx) : null, target: t, evo: evo(t), rank: r.rank,
        detail: `IV rank #${r.rank} (${(r.pct * 100).toFixed(1)}%) as ${t.name}, #${t[lg]} in ${ROLE_LABEL[lg]}`,
        invest: `Power up to level ${r.level} for the ${CAPS[lg]} CP cap` });
    }
  }

  // gyms: Defense/HP are what count; Shadows take more damage, so they're out
  const gym = !flags.shadow && fam.filter((t) => GYM_DEFENDERS.includes(t.id)).at(-1); // most evolved: Chansey -> Blissey
  if (gym && d >= 13 && h >= 13) {
    cands.push({ role: "gym", score: d + h + (flags.mighty ? 5 : 0) + (flags.lucky ? 3 : 0), target: gym, evo: evo(gym),
      detail: `Gym defender as ${gym.name} (Def ${d}, HP ${h})`, invest: "Level 30 is plenty; no XL Candy" + (flags.lucky ? " (Lucky: half Stardust)" : "") });
  }

  const ml = fam.map(shadowOf).filter((t) => t.ml && t.ml <= RULES.mlTop).sort((x, y) => x.ml - y.ml)[0];
  if (ml && a === 15 && d >= 14 && h >= 14) {
    cands.push({ role: "ml", moves: pvpMovesText(ml, "ml"), moveSet: ml.pvpMoves?.ml ? moveSet(ml, ml.pvpMoves.ml[0], ml.pvpMoves.ml.slice(1), idx) : null, score: a + d + h + (flags.mighty ? MIGHTY.ml : 0) + (flags.lucky ? LUCKY.ml : 0), target: ml, evo: evo(ml), detail: `#${ml.ml} in Master League as ${ml.name}`, invest: "Level 40+, XL Candy only if you play Master League" + (flags.lucky ? " (Lucky: half Stardust)" : "") });
  }

  const mythical = s.tags.includes("mythical") || flags.oneoff; // one-off = you tapped it (a research legendary, say)
  if (a + d + h === 45 || a + d + h === 0 || flags.shiny || flags.costume || flags.background || mythical || flags.legacy || flags.xxl || flags.keep) {
    const why = [a + d + h === 45 && "hundo", a + d + h === 0 && "nundo (0/0/0)", flags.shiny && "shiny", variantText(flags, "costume"), variantText(flags, "background"), mythical && (flags.oneoff ? "one-off (can't be replaced)" : "mythical (can't be traded or replaced)"),
      flags.xxl && "XXL (Showcases)", flags.legacy && "legacy move (only an Elite TM gets it back)", flags.keep && "you marked it Keep anyway"].filter(Boolean);
    cands.push({ role: "trophy", score: 0, target: s, evo: null, detail: why.join(" + "), invest: "No resources needed" });
  }

  // near-misses for jobs it didn't qualify for
  const near = [];
  const has = (role) => cands.some((c) => c.role === role);
  const nearRaid = raidForms.filter((t) => t.raid && t.raid.rank <= BORDER.raidTop).sort((x, y) => x.raid.rank - y.raid.rank)[0];
  if (!has("raid") && nearRaid && a >= minAtk) {
    near.push({ role: "raid", detail: `#${nearRaid.raid.rank} ${nearRaid.raid.type} as ${nearRaid.name}, just outside the top ${raidTop}` });
  }
  // 14 Attack on a top-5 attacker line costs well under 1% damage: your call, not an automatic transfer
  const topRaid = raidForms.flatMap((t) => typesOf(t).map((r) => ({ t, r }))).filter(({ r }) => r.rank <= RULES.raidXl).sort((x, y) => x.r.rank - y.r.rank)[0];
  if (!has("raid") && a === minAtk - 1 && topRaid) {
    const { t, r } = topRaid;
    near.push({ role: "raid", detail: `#${r.rank} ${r.type} as ${t.name}, but ${a} Attack (your rule wants ${minAtk}; about ${(100 / (t.atk + 15)).toFixed(1)}% less damage)${r.elite ? `; needs ${titleMove(r.charged)} (Elite TM or Community Day)` : ""}` });
  }
  for (const lg of ["gl", "ul"]) {
    if (has(lg)) continue;
    const o = fam.map(shadowOf).filter((t) => t[lg] && t[lg] <= BORDER.pvpTop && !overCapIfMighty(t, [a, d, h], lg, flags, cpm))
      .map((t) => ({ t, r: ivRank(t, [a, d, h], lg, cpm) })).filter((x) => x.r.rank <= BORDER.ivTop)
      .sort((x, y) => x.r.rank - y.r.rank)[0];
    if (o) near.push({ role: lg, detail: `IV rank #${o.r.rank} as ${o.t.name} (#${o.t[lg]} in ${ROLE_LABEL[lg]})${o.t[lg] > RULES.pvpTop ? `, species just outside the top ${RULES.pvpTop}` : ""}${o.r.rank > RULES.ivTop ? `, IVs just outside the top ${RULES.ivTop}` : ""}` });
  }
  if ((flags.dynamax || flags.gigantamax) && !cands.some((c) => c.role === "max" && c.rtype)) {
    const m = Object.values(maxAtk).sort((x, y) => y.m.pct - x.m.pct)[0];
    if (m && a >= 14 && m.m.pct >= BORDER.maxPct) near.push({ role: "max", detail: `${m.m.pct}% of the best ${m.m.type} Max attacker as ${m.t.name}${m.m.pct < RULES.maxPct ? ` (your cutoff is ${RULES.maxPct}%)` : ""}${a < 15 ? ` (${a} Attack, wants 15)` : ""}` });
    else if (maxTank && maxTank.maxTank <= BORDER.maxTankTop && d >= 12 && h >= 12) near.push({ role: "max", detail: `#${maxTank.maxTank} bulkiest as ${maxTank.name}, Def ${d} / HP ${h} (tank wants top ${RULES.maxTankTop}, 13+/13+)` });
  }
  if (!has("ml")) {
    const o = fam.map(shadowOf).filter((t) => t.ml && t.ml <= BORDER.mlTop)
      .map((t) => ({ t, r: ivRank(t, [a, d, h], "ml", cpm) }))
      .filter((x) => (a === 15 && d >= 14 && h >= 14) || x.r.rank <= BORDER.mlIvTop).sort((x, y) => x.t.ml - y.t.ml)[0];
    if (o) near.push({ role: "ml", detail: `#${o.t.ml} in Master League as ${o.t.name}, IV rank #${o.r.rank}${o.t.ml > RULES.mlTop ? ` (species just outside the top ${RULES.mlTop})` : ""}${a < 15 ? ` (${a} Attack, your rule wants 15)` : ""}` });
  }

  // jobs the species is good at whatever its IVs: lets a transfer say "good species, IVs miss" vs "not worth it",
  // and lets the first one of a good species be held until a better one turns up
  const good = [];
  for (const t of raidForms) for (const r of typesOf(t)) {
    if (r.rank <= raidTop && !good.some((g) => g.job === `raid:${r.type}`)) {
      good.push({ job: `raid:${r.type}`, label: `Raids · ${r.type[0].toUpperCase() + r.type.slice(1)}`, what: `#${r.rank} ${r.type} as ${t.name}`, needs: `${minAtk} Attack`, score: a * 100 + d + h });
    }
  }
  for (const lg of ["gl", "ul"]) {
    const t = fam.map(shadowOf).filter((x) => x[lg] && x[lg] <= RULES.pvpTop && !overCapIfMighty(x, [a, d, h], lg, flags, cpm)).sort((x, y) => x[lg] - y[lg])[0];
    const r = t && ivRank(t, [a, d, h], lg, cpm);
    if (r) good.push({ job: lg, label: ROLE_LABEL[lg], what: `#${t[lg]} as ${t.name}`, needs: `IVs in the top ${RULES.ivTop} (yours: #${r.rank})`, score: 10000 - r.rank });
  }
  if (ml) good.push({ job: "ml", label: ROLE_LABEL.ml, what: `#${ml.ml} as ${ml.name}`, needs: "15 / 14+ / 14+", score: a * 100 + d + h });
  if (gym) good.push({ job: "gym", label: ROLE_LABEL.gym, what: `as ${gym.name}`, needs: "Defense and HP 13+", score: d + h });

  // Community Day moves: a job whose best moveset has a legacy move, on a Pokémon that still has to evolve, should wait.
  // Evolving during a Community Day (or a CD Classic / the December recap) teaches it for free; otherwise it takes an
  // Elite TM. Regular TMs can't. Shadows also need Frustration removed first (Charged TM, only during Rocket events).
  for (const c of cands) {
    if (!c.evo?.to || !c.moveSet) continue;
    const legacy = [c.moveSet.fast, ...c.moveSet.charged].filter((m) => m.legacy).map((m) => m.name);
    if (legacy.length) c.cd = { moves: legacy, shadow: !!flags.shadow };
  }

  return { entry, cands, near, good, why: transferReasons(entry, idx, { bestRaid, fam: fam.map(shadowOf), cpm }) };
}

// short reasons for when nothing wins (most useful first)
function transferReasons({ ivs: [a, d, h], flags }, idx, { bestRaid, fam, cpm }) {
  const out = [];
  if (bestRaid && a < minAtkFor(flags)) out.push(`${a} Attack misses your ${minAtkFor(flags)}-Attack raid rule${flags.mighty ? " (Mighty)" : ""}`);
  if (!bestRaid) out.push(`not a top-${RULES.raidTop} raid attacker in any form`);
  for (const lg of ["gl", "ul"]) {
    const t = fam.filter((x) => x[lg] && x[lg] <= RULES.pvpTop).sort((x, y) => x[lg] - y[lg])[0];
    if (t && overCapIfMighty(t, [a, d, h], lg, flags, cpm)) out.push(`Mighty (level 40+) is already over the ${CAPS[lg]} CP cap for ${ROLE_LABEL[lg]}`);
    else if (t) {
      const r = ivRank(t, [a, d, h], lg, cpm);
      // low-friendship trades can roll low Attack; a Lucky trade floors IVs at 12/12/12, which ruins PvP spreads
      const trade = !flags.shadow && !flags.lucky && !t.tags.includes("mythical") ? "; trade it to re-roll the IVs (low friendship is best; a Lucky trade floors IVs at 12)" : "";
      out.push(`IV rank #${r.rank} for ${ROLE_LABEL[lg]} as ${t.name} (needs top ${RULES.ivTop}${trade})`);
    }
  }
  if (!fam.some((x) => (x.gl && x.gl <= RULES.pvpTop) || (x.ul && x.ul <= RULES.pvpTop))) out.push("not a Great/Ultra League pick");
  const gym = fam.filter((t) => GYM_DEFENDERS.includes(t.id.replace(/_shadow$/, ""))).at(-1);
  if (gym && (flags.shadow || d < 13 || h < 13)) out.unshift(flags.shadow ? `Shadow ${gym.name} is a poor gym defender (takes extra damage)` : `Def ${d} / HP ${h}: a ${gym.name} gym defender wants 13+ in both`);
  return out;
}

const titleMove = (id) => id.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// a move by name, marked when it's a legacy (Elite TM / Community Day) move for that form
const mv = (t, id) => titleMove(id) + (t.elite?.includes(id) ? " (legacy)" : "");
// PvPoke's league moveset: "Dragon Tail + Twister / Sand Tomb"
// the same moves with their types, for colored pills: { fast: { name, type, legacy }, charged: [...] }
const moveSet = (t, fast, charged, idx) => {
  const one = (id) => ({ name: titleMove(id), type: idx.data.moveTypes?.[id] || null, legacy: !!t.elite?.includes(id) });
  return { fast: one(fast), charged: charged.map(one) };
};
const pvpMovesText = (t, lg) => { const m = t.pvpMoves?.[lg]; return m ? `${mv(t, m[0])} + ${m.slice(1).map((id) => mv(t, id)).join(" / ")}` : null; };
// costume/background can carry a number (which one): true = "some costume", 2 = "costume 2"
const variantText = (flags, k) => flags[k] && (flags[k] === true ? k : `${k} ${flags[k]}`);
const flagText = (flags) => Object.keys(flags).filter((k) => flags[k]).map((k) => variantText(flags, k)).join(" ");
const ivText = (e) => `${e.ivs.join("/")}${flagText(e.flags) ? ` ${flagText(e.flags)}` : ""}`;
// flags <-> the list form saved in the batch and the box ("costume:2")
export const flagsToList = (flags) => Object.keys(flags).filter((k) => flags[k]).map((k) => (flags[k] === true ? k : `${k}:${flags[k]}`));
export const listToFlags = (list) => Object.fromEntries(list.map((f) => { const [k, n] = f.split(":"); return [k, n ? Number(n) : true]; }));

// how many of one job are worth keeping: you defend several gyms at once (coins), a raid team is 6 (only for
// XL-worthy top-5 types), a Max Battle team is 3. Everything else (PvP, ML, trophies) needs one. A raid job whose
// form is a Mega keeps one too: only one Pokémon can be Mega Evolved in a raid at a time.
// shortcut: counted per family, not across species (6 Garchomp and 6 Groudon can both be kept for Ground)
export const TEAM = { gym: 6, raid: 6, max: 3 };
const teamSize = (c) => (c.role === "gym" || c.role === "max" ? TEAM[c.role] : c.role === "raid" && c.raidRank <= RULES.raidXl && !c.target.tags.includes("mega") ? TEAM.raid : 1);

// ---- a batch: winners per role per family, compared against your saved box too ----
// includeBox: also return results for the box entries (fromBox: true), with the jobs they hold
export function decideBatch(entries, idx, box = [], { includeBox = false } = {}) {
  const evals = entries.map((e) => evaluate(e, idx));
  const boxEvals = box.map((e) => ({ ...evaluate(e, idx), fromBox: true }));
  const fams = {};
  for (const ev of [...evals, ...boxEvals]) (fams[ev.entry.species.family] ||= []).push(ev);

  const wins = new Map(), backups = new Map(), boxed = new Map(), trades = new Map(), trophyWins = new Set();
  const filled = new Set(); // "family|job" that something in the batch or box already qualifies for
  for (const group of Object.values(fams)) {
    // a Mega raid job is separate from the same type without a Mega: one Mega per raid, but Shadows (which can't Mega)
    // still fill the regular team. "raid:ground+mega" vs "raid:ground".
    const jobId = (c) => c.role + (c.rtype ? `:${c.rtype}` : "") + (c.mega ? "+mega" : "");
    const jobs = [...new Set(group.flatMap((ev) => ev.cands.filter((c) => c.role !== "trophy").map(jobId)))];
    for (const job of jobs) {
      const [role, rtypeRaw] = job.split(":");
      const rtype = rtypeRaw?.replace("+mega", "");
      const contenders = group.map((ev) => ({ ev, c: ev.cands.find((c) => jobId(c) === job) })).filter((x) => x.c).sort((x, y) => y.c.score - x.c.score);
      if (!contenders.length) continue;
      filled.add(`${group[0].entry.species.family}|${job.replace("+mega", "")}`);
      const n = teamSize(contenders[0].c);
      const team = contenders.slice(0, n), rest = contenders.slice(n);
      for (const w of team) if (!w.ev.fromBox || includeBox) wins.set(w.ev, [...(wins.get(w.ev) || []), w.c]);
      // runners-up in this batch still pass the rules, so they're backups. But if your saved box already holds
      // a spot on the team, the box is the anchor (zero-waste): anything behind a full team is a transfer.
      const last = team[team.length - 1];
      const who = n > 1 ? `a full team of ${n}` : `${last.ev.entry.species.name} ${ivText(last.ev.entry)}`;
      const label = ROLE_LABEL[role] + (rtype ? ` · ${rtype[0].toUpperCase() + rtype.slice(1)}` : "") + (job.endsWith("+mega") ? " (Mega)" : "");
      for (const r of rest) {
        if (r.ev.fromBox) continue;
        if (team.some((w) => w.ev.fromBox)) boxed.set(r.ev, [...(boxed.get(r.ev) || []), `${label}: your box already has ${who}`]);
        else backups.set(r.ev, [...(backups.get(r.ev) || []), { ...r.c, behind: who }]);
      }
    }
    // trophies keep one per species; the rest are trade bait. Shadow shiny counts separately.
    // Costume/background are deduped only when numbered (costume 2 vs costume 2); an unnumbered one is always kept.
    // Mythicals (Celebi, Mew...) and anything marked One-off keep one per family: most are one per account and can't be traded.
    // Extra ones (Meltan, Genesect raids) are judged on their own merits, never trade bait.
    // XXL keeps one per species (extras are trade bait); a legacy move keeps one per species (extras judged normally).
    for (const kind of ["perfect", "nundo", "shiny", "costume", "background", "mythical", "xxl", "legacy"]) {
      const bySpecies = {};
      for (const ev of group) {
        const { ivs: [a, d, h], flags, species } = ev.entry;
        const has = kind === "perfect" ? a + d + h === 45 : kind === "nundo" ? a + d + h === 0 : kind === "shiny" ? flags.shiny : kind === "mythical" ? species.tags.includes("mythical") || flags.oneoff : kind === "xxl" || kind === "legacy" ? flags[kind] : typeof flags[kind] === "number";
        const key = kind === "mythical" ? species.family : species.id + (kind === "shiny" && flags.shadow ? "_shadow" : "") + (kind === "costume" || kind === "background" ? `_${flags[kind]}` : "");
        if (has) (bySpecies[key] ||= []).push(ev);
      }
      for (const list of Object.values(bySpecies)) {
        const score = (ev) => ev.entry.ivs.reduce((x, y) => x + y, 0) + (ev.entry.flags.mighty ? 0.5 : 0) + (ev.entry.flags.lucky ? 0.25 : 0) + (ev.fromBox ? 0.1 : 0) + ev.entry.ivs[0] / 100; // a tie goes to the one you already own, then higher Attack
        const [top, ...rest] = [...list].sort((x, y) => score(y) - score(x));
        if (!top.fromBox || includeBox) trophyWins.add(top);
        const what = kind === "perfect" ? "hundo" : kind === "nundo" ? "nundo" : kind === "shiny" ? "shiny" : kind === "xxl" ? "XXL" : variantText(top.entry.flags, kind);
        if (kind === "mythical" || kind === "legacy") continue;
        for (const r of rest) if (!r.fromBox) trades.set(r, [...(trades.get(r) || []), { kind: what, behind: `${top.fromBox ? "your box's " : ""}${top.entry.species.name} ${ivText(top.entry)}` }]);
      }
    }
    for (const ev of group) {
      const t = ev.cands.find((c) => c.role === "trophy");
      if (t && (!ev.fromBox || includeBox) && (trophyWins.has(ev) || ev.entry.flags.costume === true || ev.entry.flags.background === true || ev.entry.flags.keep)) wins.set(ev, [...(wins.get(ev) || []), t]);
    }
  }

  const out = (includeBox ? [...evals, ...boxEvals] : evals).map((ev) => {
    const roles = wins.get(ev) || [];
    // shown on every result, keepers included (a trophy can still be a backup raider or borderline ML)
    const won = new Set(roles.map((c) => c.role));
    const backup = backups.get(ev) || []; // a raid backup can be for a different type than the one it won
    const borderline = ev.near.filter((c) => !won.has(c.role) && !backup.some((x) => x.role === c.role));
    let verdict = roles.length ? "keep" : backup.length ? "backup" : trades.has(ev) ? "trade" : borderline.length ? "borderline" : "transfer";
    let trade = trades.get(ev) || [];
    // an old catch (2016–2020) has better Lucky odds in a trade, so it's worth more traded than transferred
    const { flags, species } = ev.entry;
    if (verdict === "transfer" && flags.old && !flags.shadow && !species.tags.includes("mythical")) {
      verdict = "trade";
      trade = [{ kind: "old catch", note: "Caught 2016–2020: better odds of a Lucky trade (IVs 12+, half Stardust)" }];
    }
    return {
      entry: ev.entry, fromBox: !!ev.fromBox, keep: roles.length > 0, backup, borderline, roles, trade, verdict, hold: [], good: ev.good,
      reasons: verdict === "transfer" ? [...(boxed.get(ev) || []), ...ev.why].slice(0, 2) : [],
    };
  });

  // Hold: a good species that's hard to replace (legendary, Ultra Beast, regional exclusive) whose job nobody in the
  // batch or box qualifies for yet. The best of those is held untouched until one with the right IVs shows up.
  // Easy-to-catch species aren't held: transfer them and spend the candy on the good one when it comes.
  const hardToReplace = (sp) => ["legendary", "ultrabeast", "regional"].some((t) => sp.tags.includes(t));
  const pick = {};
  // a borderline one already does the placeholder's job (it's held too, and closer to the rules)
  for (const r of out) if (r.verdict === "borderline") for (const c of r.borderline) filled.add(`${r.entry.species.family}|${c.role}`);
  const isFilled = (fam, job) => filled.has(`${fam}|${job}`) || filled.has(`${fam}|${job.split(":")[0]}`);
  // a placeholder you saved to your box competes too (it wins ties): a new one only replaces it if it's better
  const boxPick = {};
  for (const ev of boxEvals.filter((e) => hardToReplace(e.entry.species))) for (const g of ev.good) {
    const k = `${ev.entry.species.family}|${g.job}`;
    if (!isFilled(ev.entry.species.family, g.job) && (!boxPick[k] || g.score > boxPick[k].g.score)) boxPick[k] = pick[k] = { box: ev, g };
  }
  for (const r of out) {
    if (r.verdict !== "transfer" || r.fromBox || !hardToReplace(r.entry.species)) continue;
    for (const g of r.good) {
      const k = `${r.entry.species.family}|${g.job}`;
      if (!isFilled(r.entry.species.family, g.job) && (!pick[k] || g.score > pick[k].g.score)) pick[k] = { r, g };
    }
  }
  const boxHeld = {}; // "family|job" -> the box placeholder still holding it
  for (const [k, { r, g, box }] of Object.entries(pick)) {
    if (box) { boxHeld[k] = `${box.entry.species.name} ${ivText(box.entry)}`; continue; }
    const old = boxPick[k]?.box;
    r.verdict = "hold"; r.reasons = [];
    r.hold.push({ ...g, replaces: old ? `${old.entry.species.name} ${ivText(old.entry)}` : null });
  }
  // every transfer says which side of the line it's on: good species with the wrong IVs, or not worth it at all
  for (const r of out) {
    if (r.verdict !== "transfer") continue;
    r.speciesNote = !r.good.length ? "Not worth keeping at any IVs: not a top raider, PvP, Master League or gym pick."
      : `Good species (${r.good.map((g) => g.label).join(", ")}), wrong IVs: needs ${[...new Set(r.good.map((g) => g.needs))].join(" / ")}. `
        + (r.good.every((g) => isFilled(r.entry.species.family, g.job)) ? "You already have a better one, kept or held."
          : r.good.map((g) => boxHeld[`${r.entry.species.family}|${g.job}`]).find(Boolean) ? `Your box's ${r.good.map((g) => boxHeld[`${r.entry.species.family}|${g.job}`]).find(Boolean)} is already the placeholder.`
          : hardToReplace(r.entry.species) ? "A better placeholder is being held."
          : "Easy to catch again: transfer it and save the candy for one with the right IVs.");
  }
  return out;
}

// ---- projects: per family, which keeper to spend candy/Stardust on first ----
// shortcut: one rough 0–100 value scale across jobs (raid rank, PvP/ML species rank); tune if the order feels off
function jobValue(c) {
  const t = c.target;
  if (c.role === "raid") return 100 - 3 * (typesOf(t).find((r) => r.type === c.rtype)?.rank ?? 12);
  if (c.role === "gl" || c.role === "ul") return 90 - 0.5 * (t[c.role] ?? 60);
  if (c.role === "ml") return 85 - (t.ml ?? 30);
  if (c.role === "max") return c.detail.startsWith("Gigantamax") ? 80 : c.rtype === "tank" ? 45 : c.pct - 10;
  if (c.role === "gym") return 40;
  return 0;
}
// results from decideBatch(..., { includeBox: true }) -> [{ family, items: [{ result, jobs, value }] }], best first.
// One item per Pokémon (its jobs best first). Only families the batch has a keeper in, so the whole box doesn't show every time.
// all: every family (for ranking your whole box), not just ones the batch touches
export function projects(results, { all = false } = {}) {
  const fams = {};
  for (const r of results) {
    // a backup is next in line for a job someone else holds: it goes below the keepers
    const backup = !r.roles.some((c) => c.role !== "trophy");
    const jobs = (backup ? r.backup : r.roles.filter((c) => c.role !== "trophy")).map((c) => ({ ...c, value: jobValue(c) - (backup ? 100 : 0) })).sort((x, y) => y.value - x.value);
    if (jobs.length) (fams[r.entry.species.family] ||= []).push({ result: r, jobs, value: jobs[0].value, backup });
  }
  return Object.entries(fams)
    .filter(([, items]) => all || items.some((x) => !x.result.fromBox))
    .map(([family, items]) => ({ family, items: items.sort((x, y) => y.value - x.value || (x.jobs[0].evo?.candy || 0) - (y.jobs[0].evo?.candy || 0)) }));
}

// ---- wanted: meta picks for jobs your box doesn't cover yet ----
// A raid type or gyms count as covered once anything in your box holds that job; a league once you have a team of 3
// different families for it. Each uncovered job gets its top ${WANTED_PER_JOB} picks, then picks you'd catch the same way
// (Rayquaza and Mega Rayquaza, or one species good at two jobs) merge into one entry listing every job it fills.
// Suggestions come from the data's rankings; Max Battles are left out because the data can't tell what can Dynamax.
const WANTED_PER_JOB = 5;
const RARITY = [["mythical", "mythical (research)"], ["legendary", "legendary (raids)"], ["ultrabeast", "Ultra Beast (raids)"], ["regional", "regional"]];
const LOOK_FOR = {
  raid: "15 Attack (13 if Mighty)",
  gl: `low Attack, high Defense/HP (IVs in the top ${RULES.ivTop})`,
  ul: `low Attack, high Defense/HP (IVs in the top ${RULES.ivTop})`,
  ml: "15 / 14+ / 14+",
  gym: "Defense and HP 13+",
};
// easy: skip what a mid-level trainer can't just go catch (legendaries, mythicals, Ultra Beasts, Megas/Primals,
// Shadow legendaries), so each job's top 5 are things you can find in the wild, eggs, Rocket or trades
const hardToGet = (t) => ["legendary", "mythical", "ultrabeast", "mega"].some((g) => t.tags.includes(g));
export function wanted(boxResults, idx, { easy = false } = {}) {
  const holders = {}; // job -> families in your box holding it
  for (const r of boxResults) for (const c of r.roles) if (c.role !== "trophy") (holders[`${c.role}${c.rtype ? `:${c.rtype}` : ""}`] ||= new Set()).add(r.entry.species.family);
  const need = (job) => (holders[job]?.size || 0) < (/^(gl|ul|ml)$/.test(job) ? 3 : 1);
  const out = [];
  const add = (t, job, value, what, rank = null, moves = null) => {
    const fam = (idx.byId[t.id.replace(/_shadow$|_(mega|primal).*$/, "")] || t).family;
    if (!need(job) || holders[job]?.has(fam) || (easy && hardToGet(t))) return;
    const rarity = [
      ...RARITY.filter(([tag]) => t.tags.includes(tag)).map(([, label]) => label),
      t.tags.includes("shadow") && "Shadow (Team GO Rocket)", t.tags.includes("mega") && "Mega: catch the base form, then Mega Energy",
    ].filter(Boolean);
    const [role, type] = job.split(":");
    out.push({ species: t, job, label: ROLE_LABEL[role] + (type ? ` · ${type[0].toUpperCase() + type.slice(1)}` : ""), what: `${what} as ${t.name}`, lookFor: LOOK_FOR[role], rarity, value, rank, moveSet: moves });
  };
  for (const t of idx.data.species) {
    for (const r of typesOf(t)) if (r.rank <= RULES.raidTop) add(t, `raid:${r.type}`, 100 - 3 * r.rank, `#${r.rank} ${r.type} attacker`, r.rank, moveSet(t, r.fast, [r.charged], idx));
    for (const lg of ["gl", "ul"]) if (t[lg] && t[lg] <= 20) add(t, lg, 90 - 0.5 * t[lg], `#${t[lg]} in ${ROLE_LABEL[lg]}`, t[lg], t.pvpMoves?.[lg] ? moveSet(t, t.pvpMoves[lg][0], t.pvpMoves[lg].slice(1), idx) : null);
    if (t.ml && t.ml <= 15) add(t, "ml", 85 - t.ml, `#${t.ml} in Master League`, t.ml, t.pvpMoves?.ml ? moveSet(t, t.pvpMoves.ml[0], t.pvpMoves.ml.slice(1), idx) : null);
    if (GYM_DEFENDERS.includes(t.id) && !t.evolutions.some((e) => GYM_DEFENDERS.includes(e))) add(t, "gym", 40, "classic gym wall");
  }
  // top picks per job, one per family (Mega X / Mega Y / Shadow of the same line count once)
  const per = {};
  const picks = out.sort((x, y) => y.value - x.value).filter((w) => {
    const seen = (per[w.job] ||= new Set());
    const fam = (idx.byId[w.species.id.replace(/_shadow$|_(mega|primal).*$/, "")] || w.species).family;
    if (seen.has(fam) || seen.size >= WANTED_PER_JOB) return false;
    return seen.add(fam);
  });
  // merge by what you'd catch: the base form (Mega/Primal stripped); Shadows stay separate since you catch those from Rocket
  const merged = new Map();
  for (const w of picks) {
    const shadow = w.species.tags.includes("shadow");
    const catchAs = shadow ? w.species : idx.byId[w.species.id.replace(/_(mega|primal).*$/, "")] || w.species;
    const m = merged.get(catchAs.id);
    const job = { job: w.job, role: w.job.split(":")[0], label: w.label, what: w.what, lookFor: w.lookFor, rank: w.rank, moveSet: w.moveSet };
    if (!m) merged.set(catchAs.id, { species: catchAs, jobs: [job], rarity: [...w.rarity], value: w.value });
    else { m.jobs.push(job); m.rarity = [...new Set([...m.rarity, ...w.rarity])]; m.value = Math.max(m.value, w.value) + 1; } // a bit higher for covering more
  }
  return [...merged.values()].sort((x, y) => y.value - x.value);
}

export function tradeList(results) {
  return results.filter((r) => r.verdict === "trade").map((r) => `${r.entry.species.name} ${ivText(r.entry)}`).join("\n");
}

export function transferList(results) {
  return results.filter((r) => r.verdict === "transfer").map((r) => `${r.entry.species.name} ${ivText(r.entry)}`).join("\n");
}

// ---- the "Why?" breakdown: every role, every form the family can become, and why the others rank lower ----
export function explain(entry, idx) {
  const { species: s, ivs: [a, d, h], flags } = entry;
  const cpm = idx.data.cpm, raidTop = RULES.raidTop;
  const fam = descendants(s, idx);
  const forms = fam.flatMap((t) => [
    (flags.shadow && idx.byId[`${t.id}_shadow`]) || t,
    ...(flags.shadow ? [] : idx.data.species.filter((m) => (m.id.startsWith(`${t.id}_mega`) || m.id === `${t.id}_primal`))),
  ]);

  const raid = forms.filter((t) => typesOf(t).length).map((t) => ({
    form: t.name,
    counts: typesOf(t)[0].rank <= raidTop,
    near: typesOf(t)[0].rank > raidTop && typesOf(t)[0].rank <= BORDER.raidTop,
    types: typesOf(t).map((r) => ({ type: r.type, rank: r.rank, pct: r.pct, moves: `${titleMove(r.fast)} + ${titleMove(r.charged)}`, elite: r.elite })),
  })).sort((x, y) => x.types[0].rank - y.types[0].rank).slice(0, 3); // its 3 strongest forms
  const minAtk = minAtkFor(flags), raidAtk = a >= minAtk;

  const pvp = {};
  for (const lg of ["gl", "ul", "ml"]) {
    const rows = forms.filter((t) => !t.tags.includes("mega")).map((t) => {
      const r = ivRank(t, [a, d, h], lg, cpm);
      const metaTop = lg === "ml" ? RULES.mlTop : RULES.pvpTop;
      const meta = Boolean(t[lg] && t[lg] <= metaTop);
      const ivOk = lg === "ml" ? a === 15 && d >= 14 && h >= 14 : r.rank <= RULES.ivTop;
      const overCap = overCapIfMighty(t, [a, d, h], lg, flags, cpm);
      const near = !overCap && !(meta && ivOk) && (lg === "ml"
        ? Boolean(t.ml && t.ml <= BORDER.mlTop && (ivOk || r.rank <= BORDER.mlIvTop))
        : Boolean(t[lg] && t[lg] <= BORDER.pvpTop && r.rank <= BORDER.ivTop));
      return { form: t.name, speciesRank: t[lg], meta, ivRank: r.rank, pct: r.pct, level: r.level, cp: r.cp, ivOk, ok: meta && ivOk && !overCap, near, overCap };
    }).sort((x, y) => (y.ok - x.ok) || ((x.speciesRank || 9999) - (y.speciesRank || 9999)));
    // only forms PvPoke ranks in this league (unranked pre-evolutions are noise); else just the last form
    const ranked = rows.filter((r) => r.speciesRank);
    pvp[lg] = ranked.length ? ranked.slice(0, 3) : rows.filter((r) => r.form === forms.filter((t) => !t.tags.includes("mega")).at(-1)?.name);
  }

  return {
    raid, raidAtk, minAtk, pvp,
    max: flags.gigantamax || flags.dynamax ? [
      flags.gigantamax && "Gigantamax: its G-Max move hits harder than any Dynamax, so IVs barely matter (1–3%).",
      "Max move type = fast move type. " + (fam.flatMap((t) => (t.maxTypes || []).map((m) => `${t.name} ${m.type} ${m.pct}%`)).join(", ") || "No Max ranking for this family.")
        + ` Attacker needs 15 Attack and ${RULES.maxPct}%+ of the best.`,
      fam.some((t) => t.maxTank) && `Tank (Max Guard/Spirit): bulk rank ${fam.filter((t) => t.maxTank).map((t) => `${t.name} #${t.maxTank}`).join(", ")}; needs top ${RULES.maxTankTop} and Def/HP 13+.`,
    ].filter(Boolean).join(" ") : null,
    rules: { raidTop, pvpTop: RULES.pvpTop, ivTop: RULES.ivTop, mlTop: RULES.mlTop },
  };
}

// ---- shiny odds (independent Bernoulli trials) ----
// Niantic doesn't publish shiny rates; these are the community-measured rates by encounter type (estimates).
export const SHINY_RATES = [
  { label: "Wild, standard species", oneIn: 512, note: "most wild spawns (often quoted as ~1/500)" },
  { label: "Wild, boosted species", oneIn: 64, note: "permanently or event-boosted species" },
  { label: "Mega raid boss", oneIn: 64, note: "most Mega raids" },
  { label: "Community Day featured", oneIn: 25, note: "during the event hours" },
  { label: "Legendary raid (5-star)", oneIn: 20, note: "also most Mythical / Ultra Beast raids" },
  { label: "Raid Day / Hatch Day", oneIn: 10, note: "the featured Pokémon" },
];
// chance of at least one shiny in n encounters
export const chanceIn = (oneIn, n) => 1 - Math.pow(1 - 1 / oneIn, n);
// encounters needed to reach a target chance (nothing guarantees it: 100% is never reached)
export const encountersFor = (oneIn, target) => Math.ceil(Math.log(1 - target) / Math.log(1 - 1 / oneIn));

// ---- trades: Stardust cost and what the re-roll can land ----
// Costs by friendship (Friend costs the same as Good). "special" = shiny / legendary / mythical / Pokémon the
// receiver hasn't registered. Figures from the published trade charts; trade events can discount them.
export const TRADE_LEVELS = [
  { key: "good", label: "Good Friend", floor: 1, regular: 100, newOrSpecial: 20000, specialNew: 1000000 },
  { key: "great", label: "Great Friend", floor: 2, regular: 100, newOrSpecial: 16000, specialNew: 800000 },
  { key: "ultra", label: "Ultra Friend", floor: 3, regular: 100, newOrSpecial: 1600, specialNew: 80000 },
  { key: "best", label: "Best Friend", floor: 5, regular: 100, newOrSpecial: 800, specialNew: 40000 },
  { key: "lucky", label: "Lucky trade", floor: 12, regular: null, newOrSpecial: null, specialNew: null },
];
// odds for one traded Pokémon when each IV rolls evenly from the floor to 15
export function tradeOdds(floor) {
  const n = 16 - floor, atLeast = (v) => Math.max(0, 16 - Math.max(v, floor)) / n, atMost = (v) => Math.max(0, v - floor + 1) / n;
  return {
    hundo: (1 / n) ** 3,
    raid15: 1 / n, // 15 Attack (raid keeper rule)
    raidIdeal: (1 / n) * atLeast(14) ** 2, // 15 / 14+ / 14+
    pvpLowAtk: atMost(2), // 0–2 Attack, the Great/Ultra League shape
    pvpIdeal: atMost(2) * atLeast(12) ** 2, // 0–2 Attack with 12+ Defense and HP
  };
}

// ---- trade fairness: a rough value for one side of a trade ----
// IVs re-roll on arrival, so value comes from the species and the traits that survive a trade (shiny, costume,
// background, XXL size), never the current IVs. Points are a rough scale for comparing two sides, not a price.
export function tradeValue(species, flags, idx) {
  const parts = [];
  const add = (pts, why) => pts > 0 && parts.push({ pts: Math.round(pts), why });
  const tag = (t) => species.tags.includes(t);
  if (flags.shiny) add(40, "shiny");
  if (tag("mythical")) add(45, "mythical");
  else if (tag("legendary")) add(40, "legendary");
  else if (tag("ultrabeast")) add(35, "Ultra Beast");
  if (tag("regional")) add(20, "regional exclusive");
  if (flags.costume) add(15, "costume");
  if (flags.background) add(15, "special background");
  if (flags.xxl) add(10, "XXL");
  // how useful the line is, whatever the IVs: its best raid / PvP / Master League rank
  const fam = descendants(species, idx).flatMap((t) => [t, ...idx.data.species.filter((m) => m.id.startsWith(`${t.id}_mega`) || m.id === `${t.id}_primal`)]);
  const raid = Math.min(...fam.flatMap((t) => typesOf(t).map((r) => r.rank)), Infinity);
  const pvp = Math.min(...fam.flatMap((t) => [t.gl, t.ul].filter(Boolean)), Infinity);
  const ml = Math.min(...fam.map((t) => t.ml).filter(Boolean), Infinity);
  if (raid <= RULES.raidTop) add(40 - 2 * raid, `#${raid} raid attacker in its line`);
  if (pvp <= RULES.pvpTop) add(30 - pvp / 2, `#${pvp} PvP pick in its line`);
  if (ml <= RULES.mlTop) add(30 - ml, `#${ml} Master League pick in its line`);
  // why it's locked: mythicals (all but Meltan's line), Zygarde (built from Cells), special-research rewards, else just locked
  const untradeable = flags.shadow ? "Shadow Pokémon can't be traded"
    : !species.tags.includes("untradeable") ? null
    : tag("mythical") ? `${species.name} is mythical, and mythicals can't be traded`
    : species.id.startsWith("zygarde") ? `${species.name} is built from Zygarde Cells, so it can't be traded`
    : /^(kubfu|urshifu|poipole|naganadel)/.test(species.id) ? `${species.name} comes from special research, so it can't be traded`
    : `the game doesn't allow trading ${species.name}`;
  const special = !!(flags.shiny || tag("legendary") || tag("mythical") || tag("ultrabeast"));
  return { total: parts.reduce((n, p) => n + p.pts, 0), parts, special, untradeable };
}
// from your side: what you give vs what you get. Within 15 points (or 20%) counts as about even.
export function tradeFairness(give, get) {
  const diff = get.total - give.total, close = Math.abs(diff) <= Math.max(15, 0.2 * Math.max(give.total, get.total));
  return { diff, verdict: close ? "even" : diff > 0 ? "good" : "giving" };
}

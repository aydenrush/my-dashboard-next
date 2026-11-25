// Builds public/pogo-data.json for the Pokémon GO page from two free sources:
//  - PvPoke (MIT): species, base stats, moves, families, Great/Ultra/Master League rankings
//  - PokeMiners' copy of the game master: raid (PvE) move power/energy/duration, evolution candy, CP multipliers
// Max Battle ranks are our own estimate from stats (no free source has them).
// Run: npm run pogo-data. If a download fails the existing file is kept, so a deploy never breaks on it.
import { writeFileSync, existsSync } from "node:fs";

const PVPOKE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";
const GM = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json";
const OUT = new URL("../public/pogo-data.json", import.meta.url);

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

const STAB = 1.2, SE = 1.6, SHADOW_ATK = 1.2, SHADOW_DEF = 5 / 6;
const RAID_TOP = 12; // for the log line only; the cutoffs live in lib/pogo.js RULES

async function main() {
  const [pv, gl, ul, ml, game] = await Promise.all([
    get(`${PVPOKE}/gamemaster.json`),
    get(`${PVPOKE}/rankings/all/overall/rankings-1500.json`),
    get(`${PVPOKE}/rankings/all/overall/rankings-2500.json`),
    get(`${PVPOKE}/rankings/all/overall/rankings-10000.json`),
    get(GM),
  ]);

  // CP multiplier per level 1..51 in half-level steps (index 0 = level 1)
  const whole = game.find((e) => e.templateId === "PLAYER_LEVEL_SETTINGS").data.playerLevel.cpMultiplier.slice(0, 51);
  const cpm = [];
  whole.forEach((c, i) => {
    cpm.push(c);
    if (i < whole.length - 1) cpm.push(Math.sqrt((c * c + whole[i + 1] ** 2) / 2));
  });

  // raid (PvE) moves, keyed like PvPoke's move ids (fast moves drop the _FAST suffix)
  const pve = {};
  for (const e of game) {
    if (!/^V\d+_MOVE_/.test(e.templateId) || !e.data.moveSettings) continue;
    const m = e.data.moveSettings;
    pve[String(m.movementId).replace(/_FAST$/, "")] = {
      type: String(m.pokemonType || "").replace("POKEMON_TYPE_", "").toLowerCase(),
      power: m.power || 0, dur: (m.durationMs || 1000) / 1000, energy: m.energyDelta || 0,
    };
  }

  // evolution candy (+ item): child id -> { candy, purified, item }. Keyed by the form too ("aegislash_shield"),
  // since PvPoke ids use forms where the game master's evolution name doesn't.
  const ITEM_NAMES = { ITEM_GEN4_EVOLUTION_STONE: "Sinnoh Stone", ITEM_GEN5_EVOLUTION_STONE: "Unova Stone", ITEM_OTHER_EVOLUTION_STONE_A: "Gimmighoul Coins" };
  const title = (x) => x.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  // "ITEM_METAL_COAT" -> "Metal Coat", lure "ITEM_TROY_DISK_MAGNETIC" -> "Magnetic Lure"
  // game-master names that don't match what the game shows
  const FIX = { "Kings Rock": "King's Rock", "Up Grade": "Upgrade", Beans: "Zygarde Cells", "Other Evolution Stone Maple A": "Sweet Apple", "Other Evolution Stone Maple B": "Tart Apple", "Other Evolution Stone Maple C": "Syrupy Apple" };
  const itemName = (id, cost) => {
    const name = ITEM_NAMES[id] || (/TROY_DISK_/.test(id) ? `${title(id.replace(/^ITEM_TROY_DISK_/, ""))} Lure` : title(id.replace(/^ITEM_/, "")));
    return (cost ? `${cost} ` : "") + (FIX[name] || name);
  };
  // evolution quests: "ANNIHILAPE_EVOLUTION_QUEST" -> "quest: fight type ghost psychic ×30"
  const quests = {};
  for (const e of game) {
    const q = e.data?.evolutionQuestTemplate;
    if (!q) continue;
    let what = (q.display?.description || q.questType || "").replace(/^quest_|^QUEST_/, "").replace(/_(plural|singular)$/, "").toLowerCase().replace(/_/g, " ");
    const n = q.goals?.[0]?.target;
    if (/buddy affection/.test(what)) what = "earn buddy hearts"; // Sylveon
    if (/^land excellent/.test(what)) what = "land excellent throws";
    quests[e.templateId] = `quest: ${what}${n > 1 ? ` ×${n}` : ""}`;
  }
  // conditions on one evolution branch, in words
  const conditions = (b) => [
    b.onlyDaytime && "daytime only", b.onlyNighttime && "night only", b.onlyDuskPeriod && "at dusk", b.onlyFullMoon && "full moon only",
    b.onlyUpsideDown && "phone upside down",
    b.kmBuddyDistanceRequirement ? `walk ${b.kmBuddyDistanceRequirement} km as buddy` : b.mustBeBuddy && "must be your buddy",
    b.genderRequirement && `${b.genderRequirement.toLowerCase()} only`,
    ...(b.questDisplay || []).map((q) => quests[q.questRequirementTemplateId]).filter((q) => q && !(b.kmBuddyDistanceRequirement && /buddy walk/.test(q))),
    b.noCandyCostViaTrade && "free if traded first",
  ].filter(Boolean);
  // buddy walking: km per candy ("magikarp" -> 1), keyed like the candy map
  const buddyKm = {};
  for (const e of game) {
    const km = e.data?.pokemonSettings?.kmBuddyDistance;
    const m = e.templateId.match(/^V\d+_POKEMON_([A-Z0-9_]+)$/);
    if (km && m) buddyKm[m[1].toLowerCase().replace(/_normal$/, "")] ??= km;
  }
  const candy = {};
  for (const e of game) {
    const ps = e.data?.pokemonSettings;
    if (!ps?.evolutionBranch || !/^V\d+_POKEMON_[A-Z0-9_]+$/.test(e.templateId)) continue;
    for (const b of ps.evolutionBranch) {
      const item = b.evolutionItemRequirement || b.lureItemRequirement;
      if (!b.evolution) continue;
      const v = { candy: b.candyCost || 0, purified: b.candyCostPurified || b.candyCost || 0, item: item ? itemName(item, b.evolutionItemRequirementCost) : null, notes: conditions(b) };
      for (const key of [b.evolution, b.form?.replace(/_NORMAL$/, "")].filter(Boolean)) candy[key.toLowerCase()] ??= v;
    }
  }

  const rankOf = (list) => Object.fromEntries(list.map((r, i) => [r.speciesId, i + 1]));
  const ranks = { gl: rankOf(gl), ul: rankOf(ul), ml: rankOf(ml) };
  // PvPoke's recommended moveset per league: [fast, charged, charged]
  const movesOf = (list) => Object.fromEntries(list.map((r) => [r.speciesId, r.moveset]));
  const pvpMoves = { gl: movesOf(gl), ul: movesOf(ul), ml: movesOf(ml) };

  const released = pv.pokemon.filter((p) => p.released !== false);
  const cpm40 = cpm[78]; // level 40

  // raid estimate per attacking type: best moveset whose charged move is that type.
  // Score ~ (DPS^3 * TDO)^(1/4) with TDO ∝ DPS * bulk, i.e. DPS * (def*hp)^(1/4). Relative numbers only.
  function raidScores(p) {
    const shadow = p.tags?.includes("shadow");
    const atk = (p.baseStats.atk + 15) * cpm40 * (shadow ? SHADOW_ATK : 1);
    const def = (p.baseStats.def + 15) * cpm40 * (shadow ? SHADOW_DEF : 1);
    const hp = (p.baseStats.hp + 15) * cpm40;
    const out = {};
    const charged = [...new Set([...p.chargedMoves, ...(p.eliteMoves || [])])];
    for (const fId of p.fastMoves) {
      const f = pve[fId];
      if (!f || f.energy <= 0) continue;
      for (const cId of charged) {
        const c = pve[cId];
        if (!c || c.energy >= 0 || !c.type) continue;
        const T = c.type;
        const mult = (m) => (p.types.includes(m.type) ? STAB : 1) * (m.type === T ? SE : 1);
        const n = -c.energy / f.energy;
        const dps = (n * f.power * mult(f) + c.power * mult(c)) / (n * f.dur + c.dur) * atk;
        const score = dps * Math.pow(def * hp, 0.25);
        if (!out[T] || score > out[T].score) {
          out[T] = { score, fast: fId, charged: cId, elite: (p.eliteMoves || []).some((m) => m === fId || m === cId) };
        }
      }
    }
    return out;
  }

  const scored = released.map((p) => ({ p, raid: raidScores(p) }));
  const byType = {};
  for (const { p, raid } of scored) for (const [T, r] of Object.entries(raid)) (byType[T] ||= []).push([p.speciesId, r.score]);
  const typeRank = {};
  for (const [T, list] of Object.entries(byType)) {
    list.sort((a, b) => b[1] - a[1]);
    list.forEach(([id], i) => { (typeRank[id] ||= {})[T] = { rank: i + 1, pct: Math.round((list[i][1] / list[0][1]) * 100) }; });
  }

  // Max Battles: a Max move's type is the fast move's type and its power is fixed, so an attacker is
  // Attack x STAB (bulk a little, it has to survive). Tanks/healers (Max Guard/Spirit) are pure bulk.
  // Shadows and Megas can't Dynamax.
  const maxPool = released.filter((p) => !p.tags?.includes("shadow") && !p.tags?.includes("mega") && !/_mega/.test(p.speciesId));
  const maxByType = {};
  for (const p of maxPool) {
    const atk = (p.baseStats.atk + 15) * cpm40, bulk = (p.baseStats.def + 15) * (p.baseStats.hp + 15) * cpm40 * cpm40;
    for (const T of new Set(p.fastMoves.map((m) => pve[m]?.type).filter(Boolean))) {
      // the fast move to run for that Max move type: the hardest-hitting one of that type
      const fast = p.fastMoves.filter((m) => pve[m]?.type === T).sort((x, y) => pve[y].power / pve[y].dur - pve[x].power / pve[x].dur)[0];
      (maxByType[T] ||= []).push([p.speciesId, atk * (p.types.includes(T) ? STAB : 1) * Math.pow(bulk, 0.125), fast]);
    }
  }
  const maxRank = {};
  for (const [T, list] of Object.entries(maxByType)) {
    list.sort((a, b) => b[1] - a[1]);
    list.forEach(([id, sc, fast], i) => (maxRank[id] ||= []).push({ type: T, rank: i + 1, pct: Math.round((sc / list[0][1]) * 100), fast }));
  }
  const tankList = maxPool.map((p) => [p.speciesId, (p.baseStats.def + 15) * (p.baseStats.hp + 15)]).sort((a, b) => b[1] - a[1]);
  const tankRank = Object.fromEntries(tankList.map(([id], i) => [id, i + 1]));

  const species = scored.map(({ p, raid }) => {
    // best attacking type for this species = its best rank across types
    // its 3 best attacking types (best first), each with rank, % of the type's #1, and the moveset used
    const raidTypes = Object.entries(typeRank[p.speciesId] || {})
      .map(([T, tr]) => ({ type: T, ...tr, fast: raid[T].fast, charged: raid[T].charged, elite: raid[T].elite }))
      .sort((x, y) => x.rank - y.rank).slice(0, 3);
    const best = raidTypes[0] || null;
    const base = p.speciesId.replace(/_(shadow|mega.*|alolan|galarian|hisuian|paldean).*$/, "");
    return {
      id: p.speciesId, name: p.speciesName, dex: p.dex, types: p.types,
      atk: p.baseStats.atk, def: p.baseStats.def, hp: p.baseStats.hp,
      tags: p.tags || [], family: p.family?.id || p.speciesId, parent: p.family?.parent || null,
      evolutions: p.family?.evolutions || [], elite: p.eliteMoves || [],
      gl: ranks.gl[p.speciesId] || null, ul: ranks.ul[p.speciesId] || null, ml: ranks.ml[p.speciesId] || null,
      pvpMoves: Object.fromEntries(["gl", "ul", "ml"].map((lg) => [lg, pvpMoves[lg][p.speciesId] || null])),
      raid: best, // the page decides what counts as raid-relevant (raidTop)
      raidTypes,
      maxTypes: (maxRank[p.speciesId] || []).sort((x, y) => x.rank - y.rank).slice(0, 3), // Max attacker rank per Max move type
      maxTank: tankRank[p.speciesId] || null, // bulk rank among everything that can Dynamax
      candy: candy[p.speciesId]?.candy ?? candy[base]?.candy ?? null,
      candyPurified: candy[p.speciesId]?.purified ?? candy[base]?.purified ?? null,
      evoItem: candy[p.speciesId]?.item ?? candy[base]?.item ?? null, // e.g. "Metal Coat" to evolve into this
      evoNotes: (candy[p.speciesId] ?? candy[base])?.notes || [], // e.g. "night only", "walk 10 km as buddy"
      buddyKm: buddyKm[p.speciesId] ?? buddyKm[base] ?? buddyKm[p.speciesId.split("_")[0]] ?? null, // km walked per candy
    };
  });

  const data = {
    built: new Date().toISOString(), pvpokeTimestamp: pv.timestamp, gameMasterEntries: game.length,
    raidTop: RAID_TOP, cpm: cpm.map((c) => +c.toFixed(8)), species,
  };
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`pogo-data: ${species.length} species, ${species.filter((s) => s.raid && s.raid.rank <= RAID_TOP).length} raid-relevant (top ${RAID_TOP} of a type), ${cpm.length} CP levels`);
}

main().catch((e) => {
  if (existsSync(OUT)) { console.warn(`pogo-data: ${e.message}; keeping the existing public/pogo-data.json`); return; }
  console.error(e); process.exit(1);
});

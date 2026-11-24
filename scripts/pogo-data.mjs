// Builds public/pogo-data.json for the Pokémon GO page from two free sources:
//  - PvPoke (MIT): species, base stats, moves, families, Great/Ultra/Master League rankings
//  - PokeMiners' copy of the game master: raid (PvE) move power/energy/duration, evolution candy, CP multipliers
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
const RAID_TOP = 20; // a species "matters" in raids if it is in the top 20 of its best attacking type

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

  // evolution candy: child pokemonId -> { candy, purified }
  const candy = {};
  for (const e of game) {
    const ps = e.data?.pokemonSettings;
    if (!ps?.evolutionBranch || !/^V\d+_POKEMON_[A-Z0-9_]+$/.test(e.templateId)) continue;
    for (const b of ps.evolutionBranch) {
      if (!b.evolution || !b.candyCost) continue;
      const key = b.evolution.toLowerCase();
      candy[key] ??= { candy: b.candyCost, purified: b.candyCostPurified || b.candyCost };
    }
  }

  const rankOf = (list) => Object.fromEntries(list.map((r, i) => [r.speciesId, i + 1]));
  const ranks = { gl: rankOf(gl), ul: rankOf(ul), ml: rankOf(ml) };

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

  const species = scored.map(({ p, raid }) => {
    // best attacking type for this species = its best rank across types
    let best = null;
    for (const [T, tr] of Object.entries(typeRank[p.speciesId] || {})) {
      if (!best || tr.rank < best.rank) best = { type: T, ...tr, fast: raid[T].fast, charged: raid[T].charged, elite: raid[T].elite };
    }
    const base = p.speciesId.replace(/_(shadow|mega.*|alolan|galarian|hisuian|paldean).*$/, "");
    return {
      id: p.speciesId, name: p.speciesName, dex: p.dex, types: p.types,
      atk: p.baseStats.atk, def: p.baseStats.def, hp: p.baseStats.hp,
      tags: p.tags || [], family: p.family?.id || p.speciesId, parent: p.family?.parent || null,
      evolutions: p.family?.evolutions || [], elite: p.eliteMoves || [],
      gl: ranks.gl[p.speciesId] || null, ul: ranks.ul[p.speciesId] || null, ml: ranks.ml[p.speciesId] || null,
      raid: best, // the page decides what counts as raid-relevant (raidTop)
      candy: candy[p.speciesId]?.candy ?? candy[base]?.candy ?? null,
      candyPurified: candy[p.speciesId]?.purified ?? candy[base]?.purified ?? null,
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

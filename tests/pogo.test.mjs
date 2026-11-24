import assert from "node:assert";
const { indexSpecies, parseBatch, decideBatch, ivRank, transferList } = await import("../lib/pogo.js");

// small fixed dataset, so these tests don't change when the real data is refreshed
const cpm = Array.from({ length: 99 }, (_, i) => 0.094 + (0.84 - 0.094) * Math.sqrt(i / 98)); // rising curve, L1..L50
const sp = (id, name, extra) => ({ id, name, dex: 1, types: ["ground"], atk: 100, def: 100, hp: 100, tags: [], family: "FAM_" + id, parent: null, evolutions: [], elite: [], gl: null, ul: null, ml: null, raid: null, candy: null, candyPurified: null, ...extra });
const data = {
  raidTop: 20, cpm,
  species: [
    sp("gible", "Gible", { family: "G", evolutions: ["gabite"] }),
    sp("gabite", "Gabite", { family: "G", parent: "gible", evolutions: ["garchomp"], candy: 25, candyPurified: 22 }),
    sp("garchomp", "Garchomp", { family: "G", parent: "gabite", atk: 261, def: 193, hp: 239, candy: 100, candyPurified: 90, gl: 400, ul: 300, ml: 30, raid: { type: "ground", rank: 15, pct: 80, fast: "MUD_SHOT", charged: "EARTH_POWER", elite: true } }),
    sp("garchomp_shadow", "Garchomp (Shadow)", { family: "G", tags: ["shadow"], atk: 261, def: 193, hp: 239, raid: { type: "ground", rank: 6, pct: 90, fast: "MUD_SHOT", charged: "EARTHQUAKE", elite: false } }),
    sp("garchomp_mega", "Garchomp (Mega)", { family: "G", tags: ["mega"], atk: 339, def: 222, hp: 239, raid: { type: "dragon", rank: 2, pct: 95, fast: "DRAGON_TAIL", charged: "OUTRAGE", elite: false } }),
    sp("azumarill", "Azumarill", { family: "A", atk: 112, def: 152, hp: 225, gl: 5, ul: 60 }),
    sp("ninetales_alolan", "Ninetales (Alolan)", { family: "N" }),
    sp("rhyperior", "Rhyperior", { family: "R", atk: 241, def: 190, hp: 251, ml: 59, raid: { type: "rock", rank: 11, pct: 82, fast: "SMACK_DOWN", charged: "ROCK_WRECKER", elite: true } }),
  ],
};
const idx = indexSpecies(data);

// parsing: names, forms, flags, and pieces without a name reuse the last Pokémon
const { entries, errors } = parseBatch("14/14/6 shadow gabite, 15/14/13 lucky, alolan ninetales 15/15/15 shiny\n0/15/15 azumarill; bulbasaur 1/2/3; gible 16/1/1", idx);
assert.deepEqual(entries.map((e) => [e.species.id, e.ivs.join("/"), Object.keys(e.flags).sort().join(",")]), [
  ["gabite", "14/14/6", "shadow"], ["gabite", "15/14/13", "lucky"], ["ninetales_alolan", "15/15/15", "shiny"], ["azumarill", "0/15/15", ""],
]);
assert.equal(errors.length, 2); // unknown name + IV over 15

// IV rank: under a CP cap low Attack wins; with no cap (Master League) the hundo is #1
const azu = idx.byId.azumarill;
assert.equal(ivRank(azu, [15, 15, 15], "ml", cpm).rank, 1);
assert.ok(ivRank(azu, [0, 15, 15], "gl", cpm).rank < ivRank(azu, [15, 15, 15], "gl", cpm).rank);
assert.ok(ivRank(azu, [0, 15, 15], "gl", cpm).pct <= 1);

// batch decisions
const batch = parseBatch(`15/14/14 gible
15/15/15 purified gible
14/14/6 shadow gabite
15/12/15 shadow gible
0/15/15 azumarill, 15/15/15 azumarill
15/15/15 shiny alolan ninetales`, idx).entries;
const res = decideBatch(batch, idx);
const by = (ivs, id) => res.find((r) => r.entry.ivs.join("/") === ivs && r.entry.species.id === id);

// raids: the non-shadow 15-Attack Gible line can become Mega Garchomp (#2 dragon) -> best raid pick
// one raid winner per family: the hundo (Mega Garchomp, #2) beats the 15/14/14 and the Shadow (#6) line
const raidWin = res.filter((r) => r.roles.some((c) => c.role === "raid"));
assert.equal(raidWin.length, 1);
const hundoGible = by("15/15/15", "gible");
assert.equal(raidWin[0], hundoGible);
// the runner-up still passes the raid rules, so it's a Backup (kept out of the transfer list)
const runnerUp = by("15/14/14", "gible");
assert.equal(runnerUp.verdict, "backup");
assert.deepEqual(runnerUp.backup.map((b) => [b.role, b.behind]), [["raid", "Gible 15/15/15 purified"], ["ml", "Gible 15/15/15 purified"]]);
assert.doesNotMatch(transferList(res), /Gible 15\/14\/14/);
assert.ok(hundoGible.keep);
assert.ok(hundoGible.roles.some((c) => c.role === "trophy"), "hundo is a trophy");
const shadowGabite = by("14/14/6", "gabite");
assert.equal(shadowGabite.keep, false);
assert.match(shadowGabite.reasons.join(" "), /14 Attack misses your 15-Attack raid rule/);

// evolution candy and Mega text, purified discount
const raidRole = hundoGible.roles.find((c) => c.role === "raid");
assert.equal(raidRole.evo.to, "Garchomp, then Mega Evolve");
assert.equal(raidRole.evo.candy, 112); // purified: 22 + 90

// PvP: low-Attack Azumarill wins Great League; the hundo loses Great League but is a trophy
assert.ok(by("0/15/15", "azumarill").roles.some((c) => c.role === "gl"));
assert.ok(by("15/15/15", "azumarill").roles.every((c) => c.role !== "gl"));
assert.ok(by("15/15/15", "ninetales_alolan").roles.some((c) => c.role === "trophy"));

// saved box: a better one already saved makes the new one a backup behind it
const box = parseBatch("15/15/15 gible", idx).entries;
const vsBox = decideBatch(parseBatch("15/14/14 gible", idx).entries, idx, box);
assert.equal(vsBox[0].verdict, "backup");
assert.equal(vsBox[0].backup[0].behind, "your box's Gible 15/15/15");

// Dynamax needs 15 Attack; Gigantamax doesn't
const mx = decideBatch(parseBatch("13/10/14 dynamax alolan ninetales, 15/12/13 dynamax alolan ninetales, 10/10/10 gigantamax alolan ninetales", idx).entries, idx);
assert.deepEqual(mx.map((r) => r.verdict), ["transfer", "backup", "keep"]);

assert.match(transferList(res), /Gabite 14\/14\/6 shadow/);
console.log("pogo ok");

// "Why?" breakdown: forms ranked best-first, every league row, CP under the cap
const { explain } = await import("../lib/pogo.js");
const why = explain(parseBatch("15/14/14 gible", idx).entries[0], idx);
assert.deepEqual(why.raid.map((r) => r.form), ["Garchomp (Mega)", "Garchomp"]); // Mega #2 dragon before regular #15 ground
assert.equal(why.raid[0].types[0].moves, "Dragon Tail + Outrage");
assert.equal(why.raidAtk, true);
const shadowWhy = explain(parseBatch("14/14/6 shadow gabite", idx).entries[0], idx);
assert.deepEqual(shadowWhy.raid.map((r) => r.form), ["Garchomp (Shadow)"]); // shadows can't Mega Evolve
assert.equal(shadowWhy.raidAtk, false);
const azuWhy = explain(parseBatch("0/15/15 azumarill", idx).entries[0], idx);
const glRow = azuWhy.pvp.gl[0];
assert.ok(glRow.ok && glRow.meta && glRow.cp <= 1500);
assert.equal(azuWhy.pvp.ml[0].ok, false); // not a Master League pick
console.log("explain ok");

// Borderline: 13/15/15 Rhyperior (Master League #59, just outside the top 40; great stats but not 15 Attack)
const rhy = decideBatch(parseBatch("13/15/15 rhyperior", idx).entries, idx)[0];
assert.equal(rhy.verdict, "borderline");
assert.equal(rhy.borderline[0].role, "ml");
assert.match(rhy.borderline[0].detail, /#59 in Master League/);
assert.doesNotMatch(transferList([rhy]), /Rhyperior/); // borderline stays out of the transfer list
const rhyWhy = explain(parseBatch("13/15/15 rhyperior", idx).entries[0], idx);
assert.equal(rhyWhy.pvp.ml[0].near, true);

// Dynamax Pokémon are still judged for normal raids
const dmaxRaid = decideBatch(parseBatch("15/13/14 dynamax rhyperior", idx).entries, idx)[0];
assert.ok(dmaxRaid.roles.some((c) => c.role === "raid"));
console.log("borderline ok");

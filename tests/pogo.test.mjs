import assert from "node:assert";
const { indexSpecies, parseBatch, decideBatch, ivRank, transferList, TEAM } = await import("../lib/pogo.js");
const TEAM_REAL = { ...TEAM };
Object.assign(TEAM, { gym: 1, raid: 1, max: 1 }); // the older tests below were written for one winner per job; team tests at the end

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
    sp("celebi", "Celebi", { tags: ["mythical"] }),
    sp("snorlax", "Snorlax"),
    sp("azumarill", "Azumarill", { family: "A", atk: 112, def: 152, hp: 225, gl: 5, ul: 60 }),
    sp("ninetales_alolan", "Ninetales (Alolan)", { family: "N", maxTypes: [{ type: "ice", rank: 40, pct: 55 }], maxTank: 300 }),
    sp("rhyperior", "Rhyperior", { family: "R", atk: 241, def: 190, hp: 251, ml: 59, maxTypes: [{ type: "rock", rank: 9, pct: 81 }], maxTank: 30, raid: { type: "rock", rank: 11, pct: 82, fast: "SMACK_DOWN", charged: "ROCK_WRECKER", elite: true } }),
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

// raids: one winner per family per attacking type. The hundo becomes Mega Garchomp for Dragon (#2);
// the Shadow Gible becomes Shadow Garchomp for Ground (#6, beats regular Garchomp #15). Both are kept.
const raidJobs = res.flatMap((r) => r.roles.filter((c) => c.role === "raid").map((c) => [`${r.entry.ivs.join("/")} ${r.entry.species.id}`, c.rtype, c.target.id]));
assert.deepEqual(raidJobs.sort(), [["15/12/15 gible", "ground", "garchomp_shadow"], ["15/15/15 gible", "dragon", "garchomp_mega"]].sort());
const hundoGible = by("15/15/15", "gible");
// the runner-up still passes the raid rules for both types, so it's a Backup (kept out of the transfer list)
const runnerUp = by("15/14/14", "gible");
assert.equal(runnerUp.verdict, "backup");
assert.deepEqual(runnerUp.backup.map((b) => [b.role, b.rtype || "", b.behind]).sort(), [
  ["ml", "", "Gible 15/15/15 purified"], ["raid", "dragon", "Gible 15/15/15 purified"], // regular Garchomp (#15 Ground) is outside the top 12 now
]);
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

// saved box: your box keeper is the anchor, so a worse new one is a Transfer (zero-waste), with that reason
const box = parseBatch("15/15/15 gible", idx).entries;
const vsBox = decideBatch(parseBatch("15/14/14 gible", idx).entries, idx, box);
assert.equal(vsBox[0].verdict, "transfer");
assert.equal(vsBox[0].reasons[0], "Raids · Dragon: your box already has Gible 15/15/15");
assert.match(transferList(vsBox), /Gible 15\/14\/14/);
// inside one batch (nothing saved yet) the runner-up is still a Backup
assert.equal(decideBatch(parseBatch("15/15/15 gible, 15/14/14 gible", idx).entries, idx)[1].verdict, "backup");

// Dynamax needs 15 Attack; Gigantamax doesn't
// ...and a Dynamax attacker needs 70%+ of the best of its Max move type (Alolan Ninetales here is 55%); G-Max always counts
const mx = decideBatch(parseBatch("13/10/14 dynamax alolan ninetales, 15/12/13 dynamax alolan ninetales, 10/10/10 gigantamax alolan ninetales", idx).entries, idx);
assert.deepEqual(mx.map((r) => r.verdict), ["transfer", "transfer", "keep"]);
const realMax = decideBatch(parseBatch("15/12/13 dynamax rhyperior", idx).entries, idx)[0]; // Rhyperior is #11 Rock
assert.ok(realMax.roles.some((c) => c.role === "max"));

// Lucky wins ties for raids (half Stardust) and says so; trade hint for PvP species with bad IVs
const lk = decideBatch(parseBatch("15/14/14 rhyperior, 15/13/13 lucky rhyperior", idx).entries, idx);
const lkRaid = lk.find((r) => r.entry.flags.lucky).roles.find((c) => c.role === "raid");
assert.ok(lkRaid && lkRaid.invest.includes("Lucky: half Stardust"));
// 0/15/15 covers Great League; the first bad one is held for Ultra League (nothing qualifies yet), the second is a transfer
const azus = decideBatch(parseBatch("0/15/15 azumarill, 15/0/0 azumarill, 15/0/0 azumarill", idx).entries, idx);
assert.deepEqual(azus.map((r) => r.verdict), ["keep", "hold", "transfer"]);
assert.equal(azus[1].hold[0].job, "ul");
const badAzu = azus[2];
assert.ok(badAzu.reasons.join(" ").includes("trade it to re-roll the IVs"));
assert.match(badAzu.speciesNote, /^Good species .*A better placeholder is being held/);
assert.ok(!decideBatch(parseBatch("0/15/15 shadow azumarill, 15/0/0 shadow azumarill, 15/0/0 shadow azumarill", idx).entries, idx)[2].reasons.join(" ").includes("trade")); // shadows can't be traded
// alone, a bad one of a good species is held until a better one shows up
assert.equal(decideBatch(parseBatch("15/0/0 azumarill", idx).entries, idx)[0].verdict, "hold");

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

// regional forms share a family but attack with different types, so both can be kept for raids
const ninetalesData = { ...data, species: [...data.species.filter((x) => x.family !== "N"),
  sp("ninetales", "Ninetales", { family: "V", raid: { type: "fire", rank: 8, pct: 70, fast: "FIRE_SPIN", charged: "OVERHEAT", elite: false } }),
  sp("ninetales_alolan", "Ninetales (Alolan)", { family: "V", raid: { type: "ice", rank: 9, pct: 69, fast: "POWDER_SNOW", charged: "BLIZZARD", elite: false } }),
] };
const nIdx = indexSpecies(ninetalesData);
const nine = decideBatch(parseBatch("15/10/10 ninetales, 15/11/11 alolan ninetales", nIdx).entries, nIdx);
assert.deepEqual(nine.map((r) => [r.verdict, r.roles.map((c) => c.rtype).join()]), [["keep", "fire"], ["keep", "ice"]]);
console.log("per-type raids ok");

// Mighty: already level 40+, so it beats a slightly better non-Mighty copy for raids...
const mighty = decideBatch(parseBatch("15/15/15 rhyperior, 15/13/13 mighty rhyperior", idx).entries, idx);
const mRaid = mighty.find((r) => r.entry.flags.mighty).roles.find((c) => c.role === "raid");
assert.ok(mRaid, "mighty wins the raid job");
assert.match(mRaid.invest, /Already level 40\+/);
assert.equal(mighty.find((r) => !r.entry.flags.mighty).backup[0].role, "raid");
// ...but it can't drop to a CP cap: a level-40+ Swampert is over 1500 CP, so not a Great League pick
const swData = { ...data, species: [...data.species, sp("swampert", "Swampert", { family: "S", atk: 208, def: 175, hp: 225, gl: 50 })] };
const swIdx = indexSpecies(swData);
const mSw = decideBatch(parseBatch("0/15/15 mighty swampert", swIdx).entries, swIdx)[0];
assert.ok(mSw.roles.every((c) => c.role !== "gl"));
assert.ok(mSw.reasons.join(" ").includes("Mighty (level 40+) is already over the 1500 CP cap"));
assert.equal(explain(parseBatch("0/15/15 mighty swampert", swIdx).entries[0], swIdx).pvp.gl[0].overCap, true);
// a Mighty Azumarill is still under 1500 at level 40, so it stays a Great League pick
assert.ok(decideBatch(parseBatch("0/15/15 mighty azumarill", idx).entries, idx)[0].roles.some((c) => c.role === "gl"));
console.log("mighty ok");

// quick-entry form: every suggested name maps back to that exact species; partial and form-first names work too
const { lookupSpecies, pickableNames } = await import("../lib/pogo.js");
for (const n of pickableNames(idx)) assert.equal(lookupSpecies(n, idx)?.name, n);
assert.equal(lookupSpecies("alolan ninetales", idx).id, "ninetales_alolan");
assert.equal(lookupSpecies("rhyp", idx).id, "rhyperior");
assert.equal(lookupSpecies("", idx), null);
assert.ok(!pickableNames(idx).some((n) => /Shadow|Mega/.test(n)));
console.log("quick entry ok");

// duplicate trophies: one hundo and one shiny per species is kept; extras are trade bait (not transfers)
const { tradeList } = await import("../lib/pogo.js");
const tro = decideBatch(parseBatch("3/4/5 shiny alolan ninetales, 10/12/14 shiny alolan ninetales, 1/1/1 costume alolan ninetales, 2/2/2 costume alolan ninetales, 6/6/6 shiny shadow alolan ninetales", idx).entries, idx);
assert.deepEqual(tro.map((r) => r.verdict), ["trade", "keep", "keep", "keep", "keep"]); // costumes always kept; shadow shiny separate
assert.equal(tro[0].trade[0].kind, "shiny");
assert.equal(tro[0].trade[0].behind, "Ninetales (Alolan) 10/12/14 shiny");
assert.match(tradeList(tro), /Ninetales \(Alolan\) 3\/4\/5 shiny/);
assert.doesNotMatch(transferList(tro), /3\/4\/5/);
// against the saved box too
const troBox = decideBatch(parseBatch("15/15/15 alolan ninetales", idx).entries, idx, parseBatch("15/15/15 alolan ninetales", idx).entries);
assert.equal(troBox[0].verdict, "trade");
assert.equal(troBox[0].trade[0].behind, "your box's Ninetales (Alolan) 15/15/15");
console.log("trophy dupes ok");

// numbered costumes/backgrounds: same number = duplicate (trade bait), different numbers both kept
const { flagsToList, listToFlags } = await import("../lib/pogo.js");
const cos = decideBatch(parseBatch("1/1/1 costume2 alolan ninetales, 5/5/5 costume2 alolan ninetales, 2/2/2 costume3 alolan ninetales, 3/3/3 bg1 alolan ninetales", idx).entries, idx);
assert.deepEqual(cos.map((r) => r.verdict), ["trade", "keep", "keep", "keep"]);
assert.equal(cos[0].trade[0].kind, "costume 2");
assert.deepEqual(listToFlags(flagsToList({ costume: 2, shiny: true })), { costume: 2, shiny: true });

// mythicals: one per family is always kept, whatever the IVs; a second one is judged normally, never trade bait
const myth = decideBatch(parseBatch("1/2/3 celebi, 0/0/0 celebi", idx).entries, idx);
assert.deepEqual(myth.map((r) => r.verdict), ["keep", "transfer"]);
assert.match(myth[0].roles[0].detail, /mythical/);
// One-off flag (a research legendary): kept whatever the IVs, like a mythical
assert.equal(decideBatch(parseBatch("0/1/2 gible oneoff", idx).entries, idx)[0].verdict, "keep");

// Keep anyway, legacy move, XXL (extras trade bait), old catch (bad IVs -> trade bait, not transfer)
const fl = decideBatch(parseBatch("0/1/2 gible keep, 0/1/3 gible legacy, 1/1/1 gible xxl, 2/2/2 gible xxl, 0/0/4 gible old, 0/0/5 gible", idx).entries, idx);
assert.deepEqual(fl.map((r) => r.verdict), ["keep", "keep", "trade", "keep", "trade", "hold"]); // the plain one is held: nothing qualifies for Gible raids yet
assert.equal(fl[2].trade[0].kind, "XXL");
assert.match(fl[4].trade[0].note, /Lucky/);
assert.doesNotMatch(transferList(fl), /0\/0\/4/);
// gym defenders: Defense/HP 13+ (Attack ignored); the runner-up is a backup
const gy = decideBatch(parseBatch("0/15/15 snorlax, 0/13/14 snorlax, 0/12/15 snorlax, 0/15/15 shadow snorlax", idx).entries, idx);
assert.deepEqual(gy.map((r) => r.verdict), ["keep", "backup", "transfer", "transfer"]);

// projects: one ranked list per family, box keepers included, best job first
const { projects } = await import("../lib/pogo.js");
const pb = decideBatch(parseBatch("15/14/14 gible", idx).entries, idx, parseBatch("0/15/15 gible", idx).entries, { includeBox: true });
const pj = projects(pb);
assert.equal(pj.length, 1);
assert.ok(pj[0].items.length >= 1);
assert.ok(pj[0].items.every((x, i, a) => !i || a[i - 1].value >= x.value));
assert.deepEqual(projects(decideBatch([], idx, parseBatch("15/14/14 gible", idx).entries, { includeBox: true })), []); // box-only families stay out

// Max Battles: attacker per Max move type (G-Max beats Dynamax at the same job), tank by bulk with Def/HP 13+
const mb = decideBatch(parseBatch("15/10/10 dynamax rhyperior, 15/11/11 gigantamax rhyperior, 2/14/15 dynamax rhyperior, 15/10/10 rhyperior", idx).entries, idx);
assert.ok(mb[1].roles.some((c) => c.role === "max" && c.rtype === "rock"));
assert.ok(!mb[0].roles.some((c) => c.role === "max" && c.rtype === "rock")); // behind the G-Max
assert.ok(mb[2].roles.some((c) => c.role === "max" && c.rtype === "tank"));
assert.ok(!mb[3].roles.some((c) => c.role === "max")); // not caught as Dynamax

// 14 Attack on a top-5 raid line is borderline, not a transfer (Mega Garchomp is #2 Dragon in the fixture)
const g14 = decideBatch(parseBatch("14/15/15 gible", idx).entries, idx)[0];
assert.ok(g14.borderline.some((c) => c.role === "raid" && c.detail.includes("14 Attack")));

// team sizes: top-5 raid types keep up to 6, gyms up to 6, Max up to 3; a box keeper takes a team spot
Object.assign(TEAM, TEAM_REAL);
const six = decideBatch(parseBatch("15/15/15 gible, 15/14/14 gible, 15/13/13 gible", idx).entries, idx); // Mega Garchomp #2 Dragon
assert.deepEqual(six.map((r) => r.verdict), ["keep", "keep", "keep"]);
const rock = decideBatch(parseBatch("15/10/10 rhyperior, 15/9/9 rhyperior", idx).entries, idx); // #11 Rock: one is enough
assert.ok(!rock[1].roles.some((c) => c.role === "raid"));
const gyms = decideBatch(parseBatch("0/15/15 snorlax, 0/14/14 snorlax, 0/13/13 snorlax", idx).entries, idx);
assert.ok(gyms.every((r) => r.roles.some((c) => c.role === "gym")));
const fullTeam = decideBatch(parseBatch("0/13/13 snorlax", idx).entries, idx, parseBatch("0/15/15 snorlax, 0/15/15 snorlax, 0/15/14 snorlax, 0/14/15 snorlax, 0/14/14 snorlax, 0/14/13 snorlax", idx).entries)[0];
assert.ok(!fullTeam.roles.some((c) => c.role === "gym"));
// a gym-line transfer says why (HP under 13)
assert.match(decideBatch(parseBatch("0/15/15 snorlax, 0/15/12 snorlax", idx).entries, idx)[1].reasons.join(" "), /HP 12/);
// a 98% with no job is just a transfer; a hundo is still a trophy
assert.deepEqual(decideBatch(parseBatch("15/15/14 alolan ninetales, 15/15/15 alolan ninetales", idx).entries, idx).map((r) => r.verdict), ["transfer", "keep"]);

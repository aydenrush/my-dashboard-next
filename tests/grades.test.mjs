import assert from "node:assert";
const { calcClass, bestReachable, outcomes } = await import("../lib/grades.js");
let n = 0;
const cat = (weight, earned = "", possible = "", name = `C${++n}`) => ({ name, weight, earned, possible });

// same cases as before the move
const r = calcClass([cat(50, 85, 100), cat(50)]);
assert.equal(r.neededFor.A.toFixed(1), "101.0");
assert.equal(r.neededFor.B.toFixed(1), "81.0");

// 85% on half: A out of reach, A- needs 95% on the ungraded parts (weight-0 extras ignored)
assert.deepEqual(bestReachable([cat(50, 85, 100, "Homework"), cat(15, "", "", "Midterm 3"), cat(35, "", "", "Final"), cat(0, "", "", "Bonus")]),
  { label: "A-", need: 95, on: ["Midterm 3", "Final"] });
// all done: final letter, need 0
assert.deepEqual(bestReachable([cat(100, 88, 100)]), { label: "B+", need: 0, on: [] });
// no scores yet
assert.equal(bestReachable([cat(100)]), null);
// 99% on 98% of grade = 97.02 points: A+ already locked in (need <= 0)
assert.ok(bestReachable([cat(98, 99, 100), cat(2)]).need <= 0);
// 99% on 90%: A+ still needs 79% on the rest
assert.equal(bestReachable([cat(90, 99, 100), cat(10)]).need.toFixed(0), "79");
const round = (o) => o.rows.map((x) => [x.name, +x.avg.toFixed(2), +x.final.toFixed(2), x.letter]);

// midterms drive the final: HW 95%, midterms 70/80 (avg 75), Final + Participation left
const real = [cat(20, 95, 100, "Homework"), cat(15, 70, 100, "Midterm 1"), cat(15, 80, 100, "Midterm 2"),
  cat(35, "", "", "Final"), cat(15, "", "", "Participation")];
const r1 = outcomes(real);
assert.deepEqual([r1.examAvg, r1.restAvg], [75, 95]);
// expected: Final at 75 -> 26.25 pts, Participation at 95 -> 14.25 pts; (41.5 + 26.25 + 14.25) / 100 = 82 -> B-
assert.deepEqual(round(r1)[1], ["Expected", 81.0, 82, "B-"]);
// worse/better shift both predictions by 10
assert.deepEqual(round(r1)[0], ["10 pts worse", 71, 77, "C+"]);
// better: Final 85 -> 29.75, Participation 95+10 caps at 100 -> 15; (41.5 + 44.75) = 86.25 -> B
assert.deepEqual(round(r1)[2], ["10 pts better", 89.5, 86.25, "B"]);

// no exams graded yet: the final falls back to the overall average
const r2 = outcomes([cat(50, 85, 100, "Homework"), cat(50, "", "", "Final")]);
assert.equal(r2.examAvg, null);
assert.deepEqual(round(r2).map((x) => x[3]), ["B-", "B", "A-"]);
// caps at 100
assert.equal(round(outcomes([cat(50, 95, 100, "Labs"), cat(50, "", "", "Labs 2")]))[2][1], 100);
assert.equal(outcomes([cat(100)]), null);
assert.equal(outcomes([cat(100, 90, 100)]), null);
console.log("grades lib ok");

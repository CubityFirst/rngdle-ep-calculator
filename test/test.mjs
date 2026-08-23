import { compute, BADGES, BADGE_HISTORY, BADGE_PORT_DATE, badgeAdded } from '../src/index.js';

console.log(`Loaded ${BADGES.length} badge definitions\n`);

// Spot-check specific numbers: print earned badge ids + total.
for (const n of [69, 777, 0, 7, 696969, 123456, 314159, 8008, 1234, 111111, 100000, 999999]) {
  const r = compute(n);
  console.log(`${String(n).padStart(7)} -> ${r.count} badges, ${r.totalEP.toLocaleString()} EP`);
  console.log('         ' + r.badges.map(b => b.id).join(', '));
}

// Sanity assertions.
const must = (n, id) => {
  if (!compute(n).badges.some(b => b.id === id)) throw new Error(`${n} should have ${id}`);
};
const mustNot = (n, id) => {
  if (compute(n).badges.some(b => b.id === id)) throw new Error(`${n} should NOT have ${id}`);
};
const epEq = (n, ep) => { const got = compute(n).totalEP; if (got !== ep) throw new Error(`${n} EP = ${got}, expected ${ep}`); };
const epOf = (n, id) => { const b = compute(n).badges.find(x => x.id === id); return b ? b.ep : null; };

must(69, 'NICE_EXACT'); must(69, 'NICE');
must(777, 'JACKPOT_EXACT'); must(777, 'JACKPOT');
must(0, 'DIGIT_ZERO'); must(0, 'ONE_DIGIT'); must(0, 'EVEN');
must(123456, 'CASCADE'); must(123456, 'SEQUENCE_6'); must(123456, 'SIX_DIGITS');
// 1234 is a 4-digit ascending SEQUENCE, not "4 consecutive numbers": prod's consecutive-
// number badges need a multi-digit part (single-digit runs are sequences), so 1234 earns
// SEQUENCE_4/Cascade, not CONSEC_QUAD_EXACT.
must(1234, 'SEQUENCE_4'); must(1234, 'CASCADE'); must(1234, 'ASCENSION'); must(1234, 'FOUR_DIGITS');
mustNot(1234, 'CONSEC_QUAD_EXACT');
must(314159, 'PI'); must(314159, 'PI_CONTAINS_5');
must(8008, 'EXACT_BOOB'); must(8008, 'BOOB_8008');
must(111111, 'HOMOGENEOUS'); must(111111, 'QUADS'); must(111111, 'PALINDROME');
must(999999, 'COLOSSAL'); must(100000, 'MILLENNIUM'); mustNot(100000, 'COLOSSAL');
must(64, 'POWER_OF_TWO'); must(64, 'SIXTH_POWER'); must(64, 'SQUARE'); must(64, 'CUBE');
must(120, 'FACTORIAL'); must(13, 'FIBONACCI'); must(12, 'PRONIC'); must(12, 'DOZEN');
// Single digits: prod awards Palindrome / Flush / Heterogeneous (trivially true), but NOT
// Homogeneous / Equilibrium (those imply repetition / two positions). Confirmed via 2.
mustNot(7, 'HOMOGENEOUS'); mustNot(7, 'EQUILIBRIUM');
must(7, 'PALINDROME'); must(7, 'FLUSH'); must(7, 'HETEROGENEOUS');
if (epOf(7, 'ONE_DIGIT') !== 0) throw new Error('Single Digit should be superseded by the exact digit badge');
must(1, 'POWER_OF_TWO'); must(1, 'POWER_OF_THREE'); // prod counts 1 = 2^0 = 3^0
must(1, 'SQUARE'); must(1, 'NINETEENTH_POWER'); // 1 = 1^k: perfect power of every exponent (assumed)
if (epOf(1, 'SQUARE') !== 0) throw new Error('1: lower powers should be superseded');
// The 13th/17th/19th powers all share the max EP 33,333,367; prod keeps the first (13th)
// and zeroes the rest, so the 13th is the one that scores.
if (epOf(1, 'THIRTEENTH_POWER') !== 33333367) throw new Error('1: max-EP power tier should score');
if (epOf(1, 'NINETEENTH_POWER') !== 0) throw new Error('1: NINETEENTH superseded by the equal-EP 13th');
must(121, 'PALINDROME'); must(120, 'CLEAN'); must(125, 'SEMI_CLEAN');
must(1212, 'ZIPPER'); must(1212, 'MINI_ECHO'); must(1212, 'ECHO');
must(666, 'DEVIL'); must(420, 'BOTANIST'); must(911, 'EMERGENCY');

// "Consecutive Numbers" badges need a multi-digit part; single-digit runs are Neighbors.
mustNot(3125, 'CONSEC_PAIR_ADJACENT'); must(3125, 'NEIGHBORS');
// 3125 = 5^5: since the 2026-07-16 batch it also earns Ouroboros (nⁿ, in the POWER family,
// so it supersedes 5th Power) and the standalone Power of Five, plus Mini Scramble ("312");
// the 2026-08-22 batch added Quarter-Century (ends in "25"), worth another 10,000.
if (compute(3125).totalEP !== 25429196) throw new Error('3125 EP regression: ' + compute(3125).totalEP);
must(3125, 'QUARTER_CENTURY');
must(3125, 'OUROBOROS'); must(3125, 'POWER_OF_FIVE'); must(3125, 'MINI_SCRAMBLE');
if (epOf(3125, 'FIFTH_POWER') !== 0) throw new Error('3125: 5th Power should be superseded by Ouroboros');
// EXACT = the whole number splits into two consecutive integers; ADJACENT ("Contains") is
// two adjacent consecutive substrings that do NOT span the whole number - so they're disjoint.
must(1213, 'CONSEC_PAIR_EXACT'); mustNot(1213, 'CONSEC_PAIR_ADJACENT');
must(91011, 'CONSEC_PAIR_ADJACENT'); mustNot(91011, 'CONSEC_PAIR_EXACT');
mustNot(12, 'CONSEC_PAIR_EXACT');

// Confirmed prod totals.
epEq(2, 119610065);     // single digit: +Palindrome/Flush/Heterogeneous, Single Digit superseded
epEq(0, 139927162);     // 0 is a perfect power of every exponent; powers supersede to the top tier
must(0, 'SQUARE'); must(0, 'NINETEENTH_POWER'); must(0, 'SPY');
if (epOf(0, 'SQUARE') !== 0) throw new Error('0: lower powers should be superseded');
if (epOf(0, 'THIRTEENTH_POWER') !== 33333367) throw new Error('0: max-EP power tier should score');
mustNot(2, 'SPY'); // single non-zero digits do NOT get Spy
epEq(3125, 25429196);  // 5^5: Ouroboros (supersedes 5th Power) + Power of Five + Mini Scramble + Quarter-Century
epEq(634700, 18194); // Pair scores 0 because Contiguous Pair (the "00") is present
epEq(455000, 1194114); // as above + the 2026-08-22 Contiguous Two Pair rewrite: "5500" now wins PAIRS
epEq(407777, 412805);   // tier supersession + Pocket Mirror ("7777") + Canyon from the 2026-07-16 batch

// 407777: lower tiers superseded, but Contiguous Pair (base badge) still scores.
if (epOf(407777, 'JACKPOT') !== 0) throw new Error('Jackpot superseded by Jackpot Four');
if (epOf(407777, 'CONTIGUOUS_TRIPS') !== 0) throw new Error('Contiguous Trips superseded by Contiguous Quads');
// 407777 has four 7s, so it earns Four of a Kind (Quads), NOT Three of a Kind: prod's Trips
// is "exactly three", so Trips is not earned here at all (Quads is the OF_A_KIND scorer).
mustNot(407777, 'TRIPS'); must(407777, 'QUADS');
if (epOf(407777, 'RHYME') !== 0) throw new Error('Rhyme superseded by Mini Echo');
if (epOf(407777, 'CONTIGUOUS_PAIR') !== 249) throw new Error('Contiguous Pair should still score');

// 455000 specifics: since 2026-08-22 a triple DOES carry a pair; overlapping repeat is
// still not a rhyme.
must(455000, 'TWO_PAIR');            // 5x2 + 0x3: two digits seen twice or more
must(455000, 'CONTIGUOUS_TWO_PAIR'); // the "5500" window is aabb
mustNot(455000, 'RHYME');            // "00" inside "000" overlaps
must(455000, 'DEEP_VOID'); must(455000, 'BOAT'); // displayed...
if (epOf(455000, 'DEEP_VOID') !== 0) throw new Error('Deep Void superseded by Deep Void (3)');
if (epOf(455000, 'BOAT') !== 0) throw new Error('Full House superseded by Contiguous Full House');
must(1122, 'TWO_PAIR'); must(1122, 'CONTIGUOUS_TWO_PAIR'); // genuine two pair still works
// The 2026-08-22 pair rewrite, straight off prod's own match/reject vectors: a run of 3+
// carries a pair, but a lone triple with no second repeated digit does not.
must(11122, 'TWO_PAIR'); must(11122, 'CONTIGUOUS_TWO_PAIR');
must(111222, 'TWO_PAIR'); must(111222, 'CONTIGUOUS_TWO_PAIR');
mustNot(1112, 'TWO_PAIR'); mustNot(1112, 'CONTIGUOUS_TWO_PAIR');
must(1221, 'TWO_PAIR'); mustNot(1221, 'CONTIGUOUS_TWO_PAIR'); // pairs must be adjacent, not nested
must(441599, 'TWO_PAIR'); mustNot(441599, 'CONTIGUOUS_TWO_PAIR'); // ...and the two pairs adjacent to each other
// The whole PAIRS family collapses to its highest-EP member: 6161 earns both PAIR and
// TWO_PAIR, so TWO_PAIR (447) scores and PAIR (120) is superseded to 0 (confirmed vs prod).
if (epOf(6161, 'TWO_PAIR') !== 377) throw new Error('6161 Two Pair should score 377');
if (epOf(6161, 'PAIR') !== 0) throw new Error('6161 Pair should be superseded by Two Pair');
// A lone pair (no other PAIRS-family badge) still scores in full.
if (compute(5051).badges.find(b => b.id === 'PAIR').ep !== 120) throw new Error('5051 Pair should score 120');

// Tier supersession: only the highest earned tier scores; lower tiers display but score 0.
if (epOf(314159, 'PI_CONTAINS_5') !== 0) throw new Error('Pi Slice (5) should be superseded by exact Pi');
if (epOf(314159, 'PI_CONTAINS_3') !== 0) throw new Error('Pi Slice (3) should be superseded');
if (epOf(93141, 'PI_CONTAINS_4') !== 333334) throw new Error('Pi Slice (4) should score when it is the top tier');
if (epOf(93141, 'PI_CONTAINS_3') !== 0) throw new Error('Pi Slice (3) should be superseded by Slice (4)');
if (epOf(231459, 'PI_CONTAINS_3') !== 25006) throw new Error('lone Pi Slice (3) should score');

// --- 2026-07-16 batch: earn + supersession parity ---
must(823543, 'OUROBOROS'); must(823543, 'POWER_OF_SEVEN'); // 7^7 = 7-to-itself
if (epOf(823543, 'SEVENTH_POWER') !== 0) throw new Error('823543: 7th Power superseded by Ouroboros');
must(69420, 'ULTIMEME_EXACT'); must(69420, 'ULTIMEME');
if (epOf(69420, 'ULTIMEME') !== 0) throw new Error('69420: Funny Numbers superseded by exact');
must(694203, 'ULTIMEME'); mustNot(694203, 'ULTIMEME_EXACT'); // contains 69 and 420, not exact
must(404, 'ERROR_EXACT'); must(404, 'ERROR');
if (epOf(404, 'ERROR') !== 0) throw new Error('404: Error 404 superseded by Not Found');
must(666666, 'INFERNAL'); must(666666, 'DEVIL');
if (epOf(666666, 'DEVIL') !== 0) throw new Error('666666: Devil superseded by Infernal');
must(6283, 'TAU'); must(62831, 'TAU'); must(62835, 'TAU_SLICE_4');
if (epOf(62831, 'TAU_SLICE_5') !== 0) throw new Error('62831: Tau Slice (5) superseded by exact Tau');
must(1618, 'GOLDEN_RATIO'); must(86400, 'FULL_DAY'); must(17776, 'FOOTBALL_17776');
must(247365, 'ALWAYS');
if (epOf(247365, 'CALENDAR') !== 0) throw new Error('247365: Calendar superseded by Always');
must(112233, 'ARITHMETIC'); must(112233, 'STEPS'); // 11,22,33 (diff 11) and non-decreasing
must(1248, 'GEOMETRIC'); must(312, 'EQUATION'); // 1,2,4,8 (ratio 2); 3*1... 3=1*... actually 3,1,2? →test
must(155551, 'FRAMED_QUAD'); must(555555, 'FIVE_OF_A_KIND');
must(12321, 'POCKET_MIRROR'); must(9800, 'SLOPES');
mustNot(111111, 'STEPS'); mustNot(111111, 'SLOPES'); // homogeneous is neither

// --- badge history: every badge knows when it arrived, retired ones stay recorded ---
// BADGE_HISTORY is the only record that a retired badge ever existed, so the frozen
// [id, label, emoji, ep, description] tuple has to stay complete after the badge is
// gone from BADGES - nothing else in the codebase can rebuild it.
{
  const seen = new Set();
  let prevDate = BADGE_PORT_DATE;
  for (const batch of BADGE_HISTORY) {
    if (!(batch.date > prevDate)) throw new Error(`BADGE_HISTORY is out of order at ${batch.date}`);
    prevDate = batch.date;
    for (const id of batch.added) {
      if (seen.has(id)) throw new Error(`${id} is listed as added twice`);
      seen.add(id);
      if (!BADGES.some(b => b[0] === id)) throw new Error(`${id} was added on ${batch.date} but is not in BADGES`);
    }
    for (const [id, label, emoji, ep, desc] of batch.retired) {
      if (BADGES.some(b => b[0] === id)) throw new Error(`${id} is listed as retired but is still in BADGES`);
      if (!label || !emoji || !(ep > 0) || !desc) throw new Error(`retired ${id} lost part of its frozen label/emoji/EP/description`);
    }
  }
  // Every live badge dates from the port or from a batch - nothing is undated.
  for (const [id] of BADGES) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(badgeAdded(id))) throw new Error(`${id} has no arrival date`);
  }
  const retired = BADGE_HISTORY.flatMap(b => b.retired);
  console.log(`\nBadge history: ${BADGE_HISTORY.length} batches since ${BADGE_PORT_DATE}, `
    + `${seen.size} badges added, ${retired.length} retired (${retired.map(r => r[1]).join(', ') || 'none'})`);
}

console.log('\nAll assertions passed.');

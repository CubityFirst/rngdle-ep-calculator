import { compute, BADGES } from '../src/index.js';

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
if (compute(3125).totalEP !== 6271772) throw new Error('3125 EP regression: ' + compute(3125).totalEP);
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
epEq(3125, 6271772);   // 5th power is its only power badge, so it still scores in full
epEq(634700, 18194); // Pair scores 0 because Contiguous Pair (the "00") is present
epEq(455000, 1188838); // full reconciliation: false-positive + supersession fixes
epEq(407777, 409497);   // tier supersession: Jackpot, Contiguous Trips, 3-of-a-kind, Rhyme

// 407777: lower tiers superseded, but Contiguous Pair (base badge) still scores.
if (epOf(407777, 'JACKPOT') !== 0) throw new Error('Jackpot superseded by Jackpot Four');
if (epOf(407777, 'CONTIGUOUS_TRIPS') !== 0) throw new Error('Contiguous Trips superseded by Contiguous Quads');
// 407777 has four 7s, so it earns Four of a Kind (Quads), NOT Three of a Kind: prod's Trips
// is "exactly three", so Trips is not earned here at all (Quads is the OF_A_KIND scorer).
mustNot(407777, 'TRIPS'); must(407777, 'QUADS');
if (epOf(407777, 'RHYME') !== 0) throw new Error('Rhyme superseded by Mini Echo');
if (epOf(407777, 'CONTIGUOUS_PAIR') !== 249) throw new Error('Contiguous Pair should still score');

// 455000 specifics: a triple is not a pair; overlapping repeat is not a rhyme.
mustNot(455000, 'TWO_PAIR');            // 5x2 + 0x3 is a full house, not two pair
mustNot(455000, 'CONTIGUOUS_TWO_PAIR'); // 55 + 000 = contiguous full house
mustNot(455000, 'RHYME');               // "00" inside "000" overlaps
must(455000, 'DEEP_VOID'); must(455000, 'BOAT'); // displayed...
if (epOf(455000, 'DEEP_VOID') !== 0) throw new Error('Deep Void superseded by Deep Void (3)');
if (epOf(455000, 'BOAT') !== 0) throw new Error('Full House superseded by Contiguous Full House');
must(1122, 'TWO_PAIR'); must(1122, 'CONTIGUOUS_TWO_PAIR'); // genuine two pair still works
// The whole PAIRS family collapses to its highest-EP member: 6161 earns both PAIR and
// TWO_PAIR, so TWO_PAIR (447) scores and PAIR (120) is superseded to 0 (confirmed vs prod).
if (epOf(6161, 'TWO_PAIR') !== 447) throw new Error('6161 Two Pair should score 447');
if (epOf(6161, 'PAIR') !== 0) throw new Error('6161 Pair should be superseded by Two Pair');
// A lone pair (no other PAIRS-family badge) still scores in full.
if (compute(5051).badges.find(b => b.id === 'PAIR').ep !== 120) throw new Error('5051 Pair should score 120');

// Tier supersession: only the highest earned tier scores; lower tiers display but score 0.
if (epOf(314159, 'PI_CONTAINS_5') !== 0) throw new Error('Pi Slice (5) should be superseded by exact Pi');
if (epOf(314159, 'PI_CONTAINS_3') !== 0) throw new Error('Pi Slice (3) should be superseded');
if (epOf(93141, 'PI_CONTAINS_4') !== 333334) throw new Error('Pi Slice (4) should score when it is the top tier');
if (epOf(93141, 'PI_CONTAINS_3') !== 0) throw new Error('Pi Slice (3) should be superseded by Slice (4)');
if (epOf(231459, 'PI_CONTAINS_3') !== 25006) throw new Error('lone Pi Slice (3) should score');

console.log('\nAll assertions passed.');

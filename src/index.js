// RNGdle badge / EP calculator - Cloudflare Worker
//
// Enter any number 0..1000000 and get the total EP plus the list of badges it earns.
// EP per badge = the "Score (Decimal)" column from the source CSV.
//
// The badge `test` functions and the FAMILIES map are reconciled to full parity with the
// live game: every number 0..1,000,000 yields the identical earned/scoring badges and total
// EP as rngdle.com (see README.md and test/full-membership.mjs).

// Beta renderer only: per-badge digit "contributors" (which positions each badge
// highlights). Generated from the rngdle.com bundle (test/gen-contributors.mjs).
// Does NOT affect EP math; compute() below stays the single source of truth.
import { prodContributors } from './contributors.gen.js';
// rngdle.com's exact EP -> percentile table (test/gen-percentiles.mjs), for the
// beta card's "TOP X%". Replaces the borrowed neocities curve fit with real data.
import { exactPercentile } from './percentiles.gen.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ipow(b, e) { let r = 1; for (let i = 0; i < e; i++) r *= b; return r; }

// Perfect b^exp. 0 and 1 both count as perfect powers of every exponent (0 = 0^exp,
// 1 = 1^exp) and earn all 13 power badges (superseded to the top tier). Both confirmed
// against prod: 0 = 139,927,162, 1 = 162,575,449.
function isPerfectPower(n, exp) {
  if (n <= 1) return true;
  for (let b = 2; ; b++) {
    const v = ipow(b, exp);
    if (v > n) return false;
    if (v === n) return true;
  }
}

// k^m for m >= 1 (so 1 is NOT counted as a power of k).
function isPowerOf(n, k) {
  if (n < k) return false;
  let v = k;
  while (v < n) v *= k;
  return v === n;
}

const FACTORIALS = new Set([1, 2, 6, 24, 120, 720, 5040, 40320, 362880]); // 0!..9! within range
const FIBS = (() => {
  const s = new Set([0, 1]);
  let a = 0, b = 1;
  while (b <= 1000000) { s.add(b); [a, b] = [b, a + b]; }
  return s;
})();
const PRONICS = (() => {
  const s = new Set();
  for (let k = 0; k * (k + 1) <= 1000000; k++) s.add(k * (k + 1));
  return s;
})();

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

// Partition a string into `count` non-empty contiguous parts.
function partitions(str, count) {
  const res = [];
  (function rec(start, parts) {
    if (parts.length === count) { if (start === str.length) res.push(parts.slice()); return; }
    const remaining = count - parts.length;
    for (let end = start + 1; end <= str.length - (remaining - 1); end++) {
      parts.push(str.slice(start, end));
      rec(end, parts);
      parts.pop();
    }
  })(0, []);
  return res;
}
const validPart = p => p.length === 1 || p[0] !== '0'; // no leading zeros except "0"

// Can `str` split into `count` parts that are consecutive integers ascending in order?
// multiDigit: require at least one part to be 2+ digits (so single-digit runs like
// "12" are NOT counted as "consecutive numbers" - those are Neighbors instead).
function consecAsc(str, count, multiDigit) {
  for (const parts of partitions(str, count)) {
    if (!parts.every(validPart)) continue;
    if (multiDigit && !parts.some(p => p.length >= 2)) continue;
    const nums = parts.map(Number);
    let ok = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] !== 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
// Can `str` split into `count` consecutive integers but NOT in ascending order?
function consecScrambled(str, count) {
  for (const parts of partitions(str, count)) {
    if (!parts.every(validPart)) continue;
    const nums = parts.map(Number);
    const sorted = [...nums].sort((a, b) => a - b);
    let isSet = true;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] !== 1) { isSet = false; break; }
    if (!isSet) continue;
    let asc = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] !== 1) { asc = false; break; }
    if (!asc) return true;
  }
  return false;
}
// Does any contiguous substring split into `count` consecutive integers ascending?
function containsConsec(str, count, multiDigit) {
  const minLen = count; // each part >= 1 digit
  for (let i = 0; i < str.length; i++)
    for (let j = i + minLen; j <= str.length; j++)
      if (consecAsc(str.slice(i, j), count, multiDigit)) return true;
  return false;
}
// Two non-adjacent substrings that are consecutive integers (a then a+1, with a gap between).
// multiDigit: at least one of the two must be 2+ digits.
function pairNearby(s, multiDigit) {
  const subs = [];
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j <= s.length; j++) {
      const t = s.slice(i, j);
      if (validPart(t)) subs.push({ v: Number(t), i, j });
    }
  for (const a of subs)
    for (const b of subs) {
      if (a.j <= b.i && b.i - a.j >= 1 && b.v === a.v + 1) {
        if (!multiDigit || (a.j - a.i >= 2 || b.j - b.i >= 2)) return true;
      }
    }
  return false;
}

// Contiguous ascending run of L consecutive digits (each +1).
function seqAsc(d, L) {
  for (let i = 0; i + L <= d.length; i++) {
    let ok = true;
    for (let k = 1; k < L; k++) if (d[i + k] - d[i + k - 1] !== 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
// Contiguous run of L consecutive digits, ascending OR descending.
function straightRun(d, L) {
  for (let i = 0; i + L <= d.length; i++) {
    let asc = true, desc = true;
    for (let k = 1; k < L; k++) {
      if (d[i + k] - d[i + k - 1] !== 1) asc = false;
      if (d[i + k] - d[i + k - 1] !== -1) desc = false;
    }
    if (asc || desc) return true;
  }
  return false;
}

function mountain(d) {
  const n = d.length; if (n < 3) return false;
  let i = 0;
  while (i + 1 < n && d[i] < d[i + 1]) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && d[i] > d[i + 1]) i++;
  return i === n - 1;
}
function valley(d) {
  const n = d.length; if (n < 3) return false;
  let i = 0;
  while (i + 1 < n && d[i] > d[i + 1]) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && d[i] < d[i + 1]) i++;
  return i === n - 1;
}
function hills(d) {
  if (d.length < 3) return false;
  let prev = 0;
  for (let i = 1; i < d.length; i++) {
    const diff = d[i] - d[i - 1];
    if (diff === 0) return false;
    const sign = diff > 0 ? 1 : -1;
    if (prev !== 0 && sign === prev) return false;
    prev = sign;
  }
  return true;
}
const strictInc = d => { for (let i = 1; i < d.length; i++) if (d[i] <= d[i - 1]) return false; return d.length >= 2; };
const strictDec = d => { for (let i = 1; i < d.length; i++) if (d[i] >= d[i - 1]) return false; return d.length >= 2; };
const consecInc = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== 1) return false; return d.length >= 2; };
const consecDec = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== -1) return false; return d.length >= 2; };
const arithmetic = d => { if (d.length < 3) return false; const diff = d[1] - d[0]; for (let i = 2; i < d.length; i++) if (d[i] - d[i - 1] !== diff) return false; return true; };
const absArith = d => { if (d.length < 3) return false; const a = Math.abs(d[1] - d[0]); for (let i = 2; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) !== a) return false; return true; };
const turtle = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) > 1) return false; return true; };
const alternator = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (d[i] % 2 === d[i - 1] % 2) return false; return true; };
const allSameParity = d => { if (d.length < 1) return false; const p = d[0] % 2; return d.every(x => x % 2 === p); };

// Lengths of maximal runs of identical digits, e.g. "455000" -> [1, 2, 3].
function runLengths(s) {
  const r = [];
  let i = 0;
  while (i < s.length) { let j = i; while (j < s.length && s[j] === s[i]) j++; r.push(j - i); i = j; }
  return r;
}

function strobogrammatic(s) {
  const map = { '0': '0', '1': '1', '6': '9', '8': '8', '9': '6' };
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) { const m = map[s[i]]; if (m === undefined) return false; out += m; }
  return out === s;
}

// ---------------------------------------------------------------------------
// Prod-ported helpers: transcribed (faithful semantics) from the live game's
// BADGE_DEFINITIONS util module so the consecutive / sequence / contiguous-pair
// badges match rngdle.com byte-for-byte. Do not "simplify" without re-checking
// parity (test/divergence.mjs). These operate on the raw digit string.
// ---------------------------------------------------------------------------
function pLeadingZero(s) { return s.length > 1 && s[0] === '0'; }
function pMultiPart(parts) { return parts.some(p => p.length >= 2); }
function pConsecSet(nums) { const t = [...nums].sort((a, b) => a - b); for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] !== 1) return false; return true; }
function pDigitCounts(s) { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1); return m; }
function pContig(s, digit, count) { return s.includes(digit.repeat(count)); }
function pOrdered(nums) { if (nums.length < 2) return true; let inc = true, dec = true; for (let i = 1; i < nums.length; i++) { if (nums[i] <= nums[i - 1]) inc = false; if (nums[i] >= nums[i - 1]) dec = false; } return inc || dec; }
function pHasSequence(s, len, strictAsc = true) {
  if (s.length < len || len <= 0) return false;
  for (let i = 0; i <= s.length - len; i++) {
    const a = s.charCodeAt(i);
    if (strictAsc) {
      let ok = true; for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k) { ok = false; break; }
      if (ok) return true;
    } else {
      const dir = s.charCodeAt(i + 1) - a;
      if (dir === 1 || dir === -1) { let ok = true; for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k * dir) { ok = false; break; } if (ok) return true; }
    }
  }
  return false;
}
function pPairExact(s) {
  for (let t = 1; t < s.length; t++) {
    const i = s.slice(0, t), r = s.slice(t);
    if (pLeadingZero(i) || pLeadingZero(r) || !pMultiPart([i, r])) continue;
    const a = parseInt(i, 10), b = parseInt(r, 10);
    if (Math.abs(a - b) === 1) return { numbers: [a, b], splits: [0, t] };
  }
  return null;
}
function pTripleExact(s) {
  for (let t = 1; t < s.length - 1; t++) for (let i = t + 1; i < s.length; i++) {
    const parts = [s.slice(0, t), s.slice(t, i), s.slice(i)];
    if (parts.some(pLeadingZero) || !pMultiPart(parts)) continue;
    const nums = parts.map(p => parseInt(p, 10));
    if (pConsecSet(nums)) return { numbers: nums, splits: [0, t, i] };
  }
  return null;
}
function pQuadExact(s) {
  for (let t = 1; t < s.length - 2; t++) for (let i = t + 1; i < s.length - 1; i++) for (let r = i + 1; r < s.length; r++) {
    const parts = [s.slice(0, t), s.slice(t, i), s.slice(i, r), s.slice(r)];
    if (parts.some(pLeadingZero) || !pMultiPart(parts)) continue;
    const nums = parts.map(p => parseInt(p, 10));
    if (pConsecSet(nums)) return { numbers: nums, splits: [0, t, i, r] };
  }
  return null;
}
function pPairAdjacent(s) {
  for (let t = 0; t < s.length; t++) for (let i = 1; i <= s.length - t - 1; i++) {
    const r = s.slice(t, t + i); if (pLeadingZero(r)) continue;
    const a = parseInt(r, 10);
    for (const v of [a + 1, a - 1]) {
      if (v < 0) continue;
      const ns = v.toString(), o = t + i + ns.length; if (o > s.length) continue;
      const seg = s.slice(t + i, o);
      if (seg === ns && pMultiPart([r, seg])) { if (t === 0 && o === s.length) continue; return { numbers: [a, v], splits: [t, t + i], start: t }; }
    }
  }
  return null;
}
function pPairNearby(s) {
  const subs = [];
  for (let i = 0; i < s.length; i++) for (let r = 1; r <= s.length - i; r++) { const a = s.slice(i, i + r); if (!pLeadingZero(a)) subs.push({ value: parseInt(a, 10), start: i, end: i + r, str: a }); }
  for (let e = 0; e < subs.length; e++) for (let i = e + 1; i < subs.length; i++) {
    const r = subs[e], a = subs[i];
    if (Math.abs(r.value - a.value) === 1 && pMultiPart([r.str, a.str]) &&
        ((!(r.end > a.start) && !(a.end > r.start)) || r.end <= a.start || a.end <= r.start) &&
        r.end !== a.start && a.end !== r.start) return { a: r, b: a };
  }
  return null;
}
function pNAdjacentBuild(s, start, firstLen, firstVal, dir, count) {
  const numbers = [firstVal], splits = [start]; let cursor = start + firstLen; const parts = [s.slice(start, start + firstLen)];
  for (let k = 1; k < count; k++) {
    const v = firstVal + k * dir; if (v < 0) return null;
    const vs = v.toString(); if (cursor + vs.length > s.length) return null;
    const seg = s.slice(cursor, cursor + vs.length); if (seg !== vs) return null;
    numbers.push(v); splits.push(cursor); parts.push(seg); cursor += vs.length;
  }
  return pMultiPart(parts) ? { numbers, splits, start, end: cursor } : null;
}
function pNAdjacentAt(s, count, start) {
  if (count < 2) return null;
  for (let len = 1; len <= s.length - start - (count - 1); len++) {
    const part = s.slice(start, start + len); if (pLeadingZero(part)) continue;
    const val = parseInt(part, 10);
    const up = pNAdjacentBuild(s, start, len, val, 1, count); if (up) return up;
    const down = pNAdjacentBuild(s, start, len, val, -1, count); if (down) return down;
  }
  return null;
}
function pNAdjacent(s, count) {
  for (let i = 0; i < s.length; i++) {
    const r = pNAdjacentAt(s, count, i);
    if (r) { if (r.start === 0 && r.end === s.length) continue; return r; }
  }
  return null;
}
// Start indices of "contiguous pairs": a digit that occurs EXACTLY twice in the whole
// number, with both occurrences adjacent ("dd"). Contiguous Two/Three Pair then look for
// 2 or 3 of these starting exactly 2 apart (ddee / ddeeff).
function pContigPairStarts(s) {
  const counts = pDigitCounts(s);
  const starts = [];
  for (const [digit, n] of counts.entries()) {
    if (n === 2 && pContig(s, digit, 2)) {
      for (let t = 0; t < s.length - 1; t++) if (s[t] === digit && s[t + 1] === digit) { starts.push(t); break; }
    }
  }
  starts.sort((a, b) => a - b);
  return starts;
}

// ---------------------------------------------------------------------------
// Badge definitions: [id, label, emoji, ep, rarity, test(c)]
// c = { n, s, len, d, counts, distinct, sum, prod, maxCount, has(sub), cnt(digit), withCount(k) }
// ---------------------------------------------------------------------------

const BADGES = [
  // --- Mythic exacts ---
  ['NICE_EXACT', 'Exact Nice', '😏', 100000100, 'Mythic', c => c.n === 69],
  ['JACKPOT_EXACT', 'Exact Jackpot', '💰', 100000100, 'Mythic', c => c.n === 777],
  ['JACKPOT_SIX', 'Jackpot Six', '🏦', 100000100, 'Mythic', c => c.has('777777')],
  ['BOTANIST_EXACT', 'Exact Botanist', '🌿', 100000100, 'Mythic', c => c.n === 420],
  ['DEVIL_EXACT', 'Exact Devil', '😈', 100000100, 'Mythic', c => c.n === 666],
  ['LEET_EXACT', 'Exact Leet', '💻', 100000100, 'Mythic', c => c.n === 1337],
  ['EXACT_HELL', 'Exact Hell', '👹', 100000100, 'Mythic', c => c.n === 7734],
  ['EXACT_BOOB_80085', 'Exact 80085', '💎', 100000100, 'Mythic', c => c.n === 80085],
  ['MEANING_EXACT', 'Exact Meaning', '🌌', 100000100, 'Mythic', c => c.n === 42],
  ['EMERGENCY_EXACT', 'Exact Emergency', '🚑', 100000100, 'Mythic', c => c.n === 911],
  ['VERY_VERY_NICE', 'Very Very Nice', '😏', 100000100, 'Mythic', c => c.n === 696969],
  ['HOTBOX', 'Hotbox', '🌿', 100000100, 'Mythic', c => c.n === 420420],
  ['MAYDAY', 'Mayday', '🚑', 100000100, 'Mythic', c => c.n === 911911],
  ['UNIVERSAL_ANSWER', 'Universal Answer', '🌌', 100000100, 'Mythic', c => c.n === 424242],
  ['BIG_BROTHER_EXACT', 'Orwellian', '👁️', 100000100, 'Mythic', c => c.n === 1984],
  ['DIGIT_ZERO', 'Zero', '0️⃣', 100000100, 'Mythic', c => c.n === 0],
  ['DIGIT_ONE', 'One', '1️⃣', 100000100, 'Mythic', c => c.n === 1],
  ['DIGIT_TWO', 'Two', '2️⃣', 100000100, 'Mythic', c => c.n === 2],
  ['DIGIT_THREE', 'Three', '3️⃣', 100000100, 'Mythic', c => c.n === 3],
  ['DIGIT_FOUR', 'Four', '4️⃣', 100000100, 'Mythic', c => c.n === 4],
  ['DIGIT_FIVE', 'Five', '5️⃣', 100000100, 'Mythic', c => c.n === 5],
  ['DIGIT_SIX', 'Six', '6️⃣', 100000100, 'Mythic', c => c.n === 6],
  ['DIGIT_SEVEN', 'Seven', '7️⃣', 100000100, 'Mythic', c => c.n === 7],
  ['DIGIT_EIGHT', 'Eight', '8️⃣', 100000100, 'Mythic', c => c.n === 8],
  ['DIGIT_NINE', 'Nine', '9️⃣', 100000100, 'Mythic', c => c.n === 9],
  ['TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 100000100, 'Mythic', c => c.n === 350],
  ['SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 100000100, 'Mythic', c => c.n === 67],
  ['EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 100000100, 'Mythic', c => c.n === 86],
  ['ORIENTATION_EXACT', 'Exact Orientation', '🧭', 100000100, 'Mythic', c => c.n === 101],
  ['CALENDAR_EXACT', 'Exact Calendar', '📅', 100000100, 'Mythic', c => c.n === 365],
  ['BRAINROT', 'Brainrot', '🫠', 100000100, 'Mythic', c => c.n === 676767],
  ['GROUNDHOG_DAY', 'Groundhog Day', '📅', 100000100, 'Mythic', c => c.n === 365365],
  ['EXACT_BOOB', 'Exact Boob', '🍈', 50000050, 'Mythic', c => c.n === 8008 || c.n === 58008],

  // --- Powers / math (Mythic/Anomaly) ---
  ['THIRTEENTH_POWER', '13th Power', '💀', 33333367, 'Mythic', c => isPerfectPower(c.n, 13)],
  ['SEVENTEENTH_POWER', '17th Power', '🧙', 33333367, 'Mythic', c => isPerfectPower(c.n, 17)],
  ['NINETEENTH_POWER', '19th Power', '🌑', 33333367, 'Mythic', c => isPerfectPower(c.n, 19)],
  ['TENTH_POWER', '10th Power', '🔟', 25000025, 'Mythic', c => isPerfectPower(c.n, 10)],
  ['ELEVENTH_POWER', '11th Power', '🕚', 25000025, 'Mythic', c => isPerfectPower(c.n, 11)],
  ['PI', 'Pi', '🥧', 25000025, 'Mythic', c => [314, 3141, 31415, 314159].includes(c.n)],
  ['E', "Euler's Number", '📈', 25000025, 'Mythic', c => [271, 2718, 27182, 271828].includes(c.n)],
  ['CONSEC_QUAD_EXACT', '4 Consecutive Numbers', '⛓️', 25000025, 'Mythic', c => { const r = pQuadExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['NINTH_POWER', '9th Power', '☁️', 20000020, 'Mythic', c => isPerfectPower(c.n, 9)],
  ['EIGHTH_POWER', '8th Power', '🎱', 16666683, 'Mythic', c => isPerfectPower(c.n, 8)],
  ['SEVENTH_POWER', '7th Power', '🌈', 12500013, 'Mythic', c => isPerfectPower(c.n, 7)],
  ['FACTORIAL', 'Factorial', '❗', 11111122, 'Mythic', c => FACTORIALS.has(c.n)],
  ['HELLO', 'Hello', '👋', 11111122, 'Mythic', c => c.has('07734')],
  ['SEQUENCE_6', 'Sequence (6)', '🔢', 11111122, 'Mythic', c => pHasSequence(c.s, 6, false)],
  ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, 'Mythic', c => /(\d)\1{5}/.test(c.s)],
  ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, 'Mythic', c => c.has('00000')],
  ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, 'Mythic', c => c.len === 1],
  ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, 'Mythic', c => c.s.endsWith('99999')],
  ['SIXTH_POWER', '6th Power', '🎲', 9090918, 'Anomaly', c => isPerfectPower(c.n, 6)],
  ['POWER_OF_THREE', 'Power of Three', '🔺', 7692315, 'Anomaly', c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 3; return v === c.n; }], // prod: 1 (=3^0) counts
  ['FIFTH_POWER', '5th Power', '🖐️', 6250006, 'Anomaly', c => isPerfectPower(c.n, 5)],
  ['JACKPOT_FIVE', 'Jackpot Five', '💰💰💰', 5263163, 'Anomaly', c => c.has('77777')],
  ['POWER_OF_TWO', 'Power of Two', '💾', 5000005, 'Anomaly', c => c.n > 0 && (c.n & (c.n - 1)) === 0], // prod: 1 (=2^0) counts
  ['ROYAL_FLUSH', 'Royal Flush', '👑', 5000005, 'Anomaly', c => c.has('56789')],
  ['BOOB_58008', '58008', '🔠', 5000005, 'Anomaly', c => c.has('58008')],
  ['BOOB_80085', '80085', '🅱️', 5000005, 'Anomaly', c => c.has('80085')],
  ['PI_CONTAINS_5', 'Pi Slice (5)', '🥧', 5000005, 'Anomaly', c => c.has('31415')],
  ['E_CONTAINS_5', 'E Slice (5)', '📈', 5000005, 'Anomaly', c => c.has('27182')],
  ['CASCADE', 'Cascade', '🌊', 3333337, 'Anomaly', c => consecInc(c.d)],
  ['FIBONACCI', 'Fibonacci Number', '🐚', 3333337, 'Anomaly', c => FIBS.has(c.n)],
  ['FOURTH_POWER', '4th Power', '📦', 3125003, 'Anomaly', c => isPerfectPower(c.n, 4)],
  ['WATERFALL', 'Waterfall', '🚿', 2857146, 'Anomaly', c => consecDec(c.d)],
  ['CONSEC_QUAD_CONTAINS', '4 Consecutive Numbers (Contains)', '🔗', 2631582, 'Anomaly', c => pNAdjacent(c.s, 4) !== null],
  ['CONSEC_QUAD_SCRAMBLED', '4 Consecutive Numbers (Scrambled)', '🔀', 2272730, 'Anomaly', c => { const r = pQuadExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['HOMOGENEOUS', 'Homogeneous', '🥛', 2222224, 'Anomaly', c => c.len >= 2 && c.distinct === 1],
  ['BINARY_SOUL', 'Binary Soul', '🤖', 1538463, 'Anomaly', c => /^[01]+$/.test(c.s)],
  ['STRAIGHT_FLUSH', 'Straight Flush', '🃏', 1449277, 'Anomaly', c => c.has('02468') || c.has('13579') || c.has('86420') || c.has('97531')],
  ['TWO_DIGITS', 'Two Digits', '✌️', 1111112, 'Anomaly', c => c.len === 2],
  // sum === product. Excludes single digits (1..9 are trivially true) but prod DOES
  // award it to 0 (sum 0 = product 0), so 0 is allowed through. Confirmed via 0 vs 2.
  ['SPY', 'Spy Number', '🕵️', 1030929, 'Anomaly', c => c.n !== 1 && c.n !== 2 && c.sum === c.prod], // prod excludes only 1 and 2
  ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, 'Anomaly', c => c.s.endsWith('9999')],
  ['SEMI_EPOCH', 'Semi-Epoch', '🗿', 1000001, 'Anomaly', c => c.s.endsWith('5000')],
  ['CUBE', '3rd Power', '🧊', 990100, 'Anomaly', c => isPerfectPower(c.n, 3)],
  ['EVEN_SPACING', 'Even Spacing', '📏', 862070, 'Anomaly', c => arithmetic(c.d)],

  // --- Epic ---
  ['CONSEC_TRIPLE_EXACT', '3 Consecutive Numbers', '⛓️', 555556, 'Epic', c => { const r = pTripleExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['CONTIGUOUS_FIVES', 'Contiguous Fives', '➖➖➖', 552487, 'Epic', c => /(\d)\1{4}/.test(c.s)],
  ['DEEP_VOID_FOUR', 'Deep Void (4)', '🌌', 552487, 'Epic', c => c.has('0000')],
  ['STROBOGRAMMATIC', 'Strobogrammatic', '🙃', 502513, 'Epic', c => strobogrammatic(c.s)],
  ['STRAIGHT', 'Straight', '📏', 454546, 'Epic', c => straightRun(c.d, 5)],
  ['JACKPOT_FOUR', 'Jackpot Four', '💰💰', 357143, 'Epic', c => c.has('7777')],
  ['VERY_NICE', 'Very Nice', '🥵', 334448, 'Epic', c => c.has('6969')],
  ['DEEPER_MEANING', 'Deeper Meaning', '🌌', 334448, 'Epic', c => c.has('4242')],
  ['SIXTY_SEVEN_DOUBLE', '6767', '🫠', 334448, 'Epic', c => c.has('6767')],
  ['LEET', 'Leet', '💻', 333334, 'Epic', c => c.has('1337')],
  ['HELL', 'Hell', '🔥', 333334, 'Epic', c => c.has('7734')],
  ['BOOB_8008', '8008', '🔢', 333334, 'Epic', c => c.has('8008')],
  ['BIG_BROTHER', 'Big Brother', '👁️', 333334, 'Epic', c => c.has('1984')],
  ['PI_CONTAINS_4', 'Pi Slice (4)', '🥧', 333334, 'Epic', c => c.has('3141')],
  ['E_CONTAINS_4', 'E Slice (4)', '📈', 333334, 'Epic', c => c.has('2718')],
  ['CONSEC_TRIPLE_SCRAMBLED', '3 Consecutive Numbers (Scrambled)', '🔀', 277778, 'Epic', c => { const r = pTripleExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['ZIPPER', 'Zipper', '🤐', 246914, 'Epic', c => c.len >= 2 && c.distinct === 2 && c.d.every((x, i) => i === 0 || x !== c.d[i - 1])],
  ['ASCENSION', 'Ascension', '📈', 219298, 'Epic', c => strictInc(c.d)],
  ['CONSEC_TRIPLE_CONTAINS', '3 Consecutive Numbers (Contains)', '🔗', 157978, 'Epic', c => pNAdjacent(c.s, 3) !== null],
  ['CONTIGUOUS_THREE_PAIR', 'Contiguous Three Pair', '👨‍👩‍👧‍👦👯', 154321, 'Epic', c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 2; i++) if (a[i] + 2 === a[i + 1] && a[i + 1] + 2 === a[i + 2]) return true; return false; }],
  ['FRAMED_PAIR', 'Framed Pair', '🖼️', 137174, 'Epic', c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1]],
  ['FRAMED_TRIPLE', 'Framed Triple', '🖼️🖼️', 137174, 'Epic', c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1]],
  ['DECAY', 'Decay', '📉', 119474, 'Epic', c => strictDec(c.d)],
  ['THREE_DIGITS', 'Three Digits', '🤟', 111111, 'Epic', c => c.len === 3],
  ['ECHO', 'Echo', '📣', 100100, 'Epic', c => c.len >= 2 && c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2)],
  ['MILLENNIUM', 'Millennium', '🗓️', 100000, 'Epic', c => c.s.endsWith('000')],
  ['PRONIC', 'Pronic Number', '🧮', 100000, 'Epic', c => PRONICS.has(c.n)],
  ['TRIPLE_NINE', 'Triple Nine', '🎉', 100000, 'Epic', c => c.s.endsWith('999')],
  ['SEMI_MILLENNIUM', 'Semi-Millennium', '📜', 100000, 'Epic', c => c.s.endsWith('500')],
  ['COLOSSAL', 'Colossal', '🪨', 100000, 'Epic', c => c.n > 999000],
  ['SQUARE', '2nd Power', '🟦', 99900, 'Epic', c => isPerfectPower(c.n, 2)],
  ['EVEN_SPACING_ABS', 'Even Spacing (Absolute)', '📐', 90992, 'Epic', c => absArith(c.d)],
  ['FIREFLY', 'Firefly', '🪲', 82237, 'Epic', c => {
    if (c.len < 4 || c.distinct !== 2) return false; // prod requires length >= 4
    return Object.values(c.counts).some(v => v === 1); // one digit appears exactly once
  }],
  ['CONSEC_PAIR_EXACT', '2 Consecutive Numbers', '🔗', 50505, 'Epic', c => pPairExact(c.s) !== null],
  ['PALINDROME', 'Palindrome', '🪞', 50025, 'Epic', c => c.s === [...c.s].reverse().join('')],

  // --- Rare ---
  ['CONTIGUOUS_QUADS', 'Contiguous Quads', '➖➖', 37023, 'Rare', c => /(\d)\1{3}/.test(c.s)],
  ['DEEP_VOID_THREE', 'Deep Void (3)', '🌑', 37023, 'Rare', c => c.has('000')],
  ['TURTLE', 'Turtle', '🐢', 36049, 'Rare', c => turtle(c.d)],
  ['SECRET_AGENT', 'Secret Agent', '🕶️', 34614, 'Rare', c => c.has('007')],
  ['HEAVY', 'Heavy', '🧱', 33300, 'Rare', c => c.sum > 45],
  ['CONTIGUOUS_BOAT', 'Contiguous Full House', '🏰', 30111, 'Rare', c => {
    const m = c.s.match(/(\d)\1\1(\d)\2/); if (m && m[1] !== m[2]) return true;
    const m2 = c.s.match(/(\d)\1(\d)\2\2/); return !!(m2 && m2[1] !== m2[2]);
  }],
  ['JACKPOT', 'Jackpot', '💰', 27027, 'Rare', c => c.has('777')],
  ['DEVIL', 'Devil', '😈', 27027, 'Rare', c => c.has('666')],
  ['SEQUENCE_4', 'Sequence (4)', '🔢', 25907, 'Rare', c => pHasSequence(c.s, 4, false)],
  ['ERROR', 'Error 404', '🚫', 25132, 'Rare', c => c.has('404')],
  ['ORIENTATION', 'Orientation', '🧭', 25132, 'Rare', c => c.has('101')],
  ['BOTANIST', 'Botanist', '🌿', 25006, 'Rare', c => c.has('420')],
  ['EMERGENCY', 'Emergency', '🚑', 25006, 'Rare', c => c.has('911')],
  ['PI_CONTAINS_3', 'Pi Slice (3)', '🥧', 25006, 'Rare', c => c.has('314')],
  ['E_CONTAINS_3', 'E Slice (3)', '📈', 25006, 'Rare', c => c.has('271')],
  ['TREE_FIDDY', 'Tree Fiddy', '🦕', 25006, 'Rare', c => c.has('350')],
  ['CALENDAR', 'Calendar', '📅', 25006, 'Rare', c => c.has('365')],
  ['DIVISIBLE_BY_THREE', 'Divisible by Three', '🔺', 24414, 'Rare', c => c.d.every(x => x % 3 === 0)],
  ['SCRAMBLE', 'Scramble', '🔀', 22722, 'Rare', c => c.len >= 2 && c.distinct === c.len && (Math.max(...c.d) - Math.min(...c.d)) === c.len - 1],
  ['DUALITY', 'Duality', '☯️', 21654, 'Rare', c => c.distinct === 2],
  ['FRAMED_DOUBLE', 'Framed Double', '🖼️🖼️🖼️', 15242, 'Rare', c => c.len === 6 && c.d[1] === c.d[2] && c.d[3] === c.d[4] && c.d[1] !== c.d[3] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
  ['PAIRED_BOOKENDS', 'Paired Bookends', '👐', 11122, 'Rare', c => c.len >= 4 && c.d[0] === c.d[1] && c.d[c.len - 1] === c.d[c.len - 2] && c.d[0] !== c.d[c.len - 1]],
  ['FOUR_DIGITS', 'Four Digits', '🍀', 11111, 'Rare', c => c.len === 4],
  ['THREE_PAIR', 'Three Pair', '👯‍♀️👯', 10288, 'Rare', c => c.countExact(2) >= 3],
  ['BOOKENDS', 'Bookends', '📚', 10010, 'Rare', c => c.len >= 4 && c.s.slice(0, 2) === c.s.slice(-2)],
  ['MIRROR_BOOKENDS', 'Mirror Bookends', '📖', 10010, 'Rare', c => c.len >= 4 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2]],
  ['CENTURY', 'Century', '💯', 10000, 'Rare', c => c.s.endsWith('00')],
  ['DOUBLE_NINE', 'Double Nine', '🎈', 10000, 'Rare', c => c.s.endsWith('99')],
  ['SEMI_CENTURY', 'Semi-Century', '🗓️', 10000, 'Rare', c => c.s.endsWith('50')],

  // --- Uncommon ---
  ['QUADS', 'Four of a Kind', '🍀', 8436, 'Uncommon', c => c.maxCount >= 4],
  ['LOW_BALL', 'Low Ball', '📉', 6400, 'Uncommon', c => /^[0-4]+$/.test(c.s)],
  ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 6142, 'Uncommon', c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 1; i++) if (a[i] + 2 === a[i + 1]) return true; return false; }],
  ['MOUNTAIN', 'Mountain', '🏔️', 5885, 'Uncommon', c => mountain(c.d)],
  ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, 'Uncommon', c => { if (c.len < 5 || c.distinct < 2) return false; for (let e = 0; e <= c.len - 5; e++) if (c.s[e + 2] === c.s[e] && c.s[e + 4] === c.s[e]) return true; return false; }],
  ['HIGH_ROLLER', 'High Roller', '🤑', 5120, 'Uncommon', c => /^[5-9]+$/.test(c.s)],
  ['VALLEY', 'Valley', '🏜️', 4199, 'Uncommon', c => valley(c.d)],
  ['MINI_ECHO', 'Mini Echo', '🔂', 3704, 'Uncommon', c => /(\d\d)\1/.test(c.s)],
  ['ALTERNATOR', 'Alternator', '⚡', 2845, 'Uncommon', c => alternator(c.d)],
  ['FLUSH', 'Flush', '🎨', 2845, 'Uncommon', c => allSameParity(c.d)],
  ['CONTIGUOUS_TRIPS', 'Contiguous Trips', '➖', 2784, 'Uncommon', c => /(\d)\1\1/.test(c.s)],
  ['DEEP_VOID', 'Deep Void', '🕳️', 2784, 'Uncommon', c => c.has('00')],
  ['FEATHER', 'Feather', '🪶', 2667, 'Uncommon', c => c.sum < 15],
  ['BLACKJACK', 'Blackjack', '♠️', 2521, 'Uncommon', c => c.sum === 21],
  ['BOAT', 'Full House', '🏠', 2397, 'Uncommon', c => { const v = Object.values(c.counts).sort((a, b) => b - a); return v[0] >= 3 && (v[1] || 0) >= 2; }],
  ['SNAKE_EYES', 'Snake Eyes', '🎲', 2121, 'Uncommon', c => { if ((c.counts[1] || 0) !== 2) return false; for (const k in c.counts) if (k !== '1' && c.counts[k] >= 2) return false; return true; }],
  ['NICE', 'Nice', '😏', 2024, 'Uncommon', c => c.has('69')],
  ['MEANING', 'Meaning of Life', '🌌', 2024, 'Uncommon', c => c.has('42')],
  ['SIXTY_SEVEN', 'Six-Seven', '🫠', 2024, 'Uncommon', c => c.has('67')],
  ['EIGHTY_SIX', 'Eighty-Six', '🍽️', 2024, 'Uncommon', c => c.has('86')],
  ['BALANCED', 'Balanced', '⚖️', 1959, 'Uncommon', c => {
    if (c.len < 2 || c.len % 2 !== 0) return false; // prod: even length only
    const h = c.len / 2;
    let a = 0, b = 0;
    for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[h + i]; }
    return a === b;
  }],
  ['RHYME', 'Rhyme', '🎶', 1872, 'Uncommon', c => {
    // Same 2+ digit substring appears twice WITHOUT overlapping (so "00" inside "000"
    // does not count - that's why 455000 gets no Rhyme).
    for (let L = 2; L <= c.len - 1; L++)
      for (let i = 0; i + L <= c.len; i++)
        if (c.s.indexOf(c.s.slice(i, i + L), i + L) !== -1) return true;
    return false;
  }],
  ['SEQUENCE_3', 'Sequence (3)', '🔢', 1716, 'Uncommon', c => pHasSequence(c.s, 3, false)],
  ['CONSEC_PAIR_ADJACENT', '2 Consecutive Numbers (Contains)', '🔗', 1659, 'Uncommon', c => pPairAdjacent(c.s) !== null],
  ['CONSEC_PAIR_NEARBY', '2 Consecutive Numbers (Nearby)', '🔗', 1575, 'Uncommon', c => pPairNearby(c.s) !== null],
  ['PRIME', 'Prime Number', '💎', 1274, 'Uncommon', c => isPrime(c.n)],
  ['TRINITY', 'Trinity', '⚜️', 1265, 'Uncommon', c => c.distinct === 3],
  ['DOZEN', 'Dozen', '🍩', 1200, 'Uncommon', c => c.n > 0 && c.n % 12 === 0],
  ['FIVE_DIGITS', 'Five Digits', '🖐️', 1111, 'Uncommon', c => c.len === 5],
  ['ELEVEN', 'Eleven', '🕚', 1100, 'Uncommon', c => c.n > 0 && c.n % 11 === 0],
  ['HARSHAD', 'Harshad Number', '🤝', 1048, 'Uncommon', c => c.sum > 0 && c.n % c.sum === 0],
  ['CLEAN', 'Clean', '🧼', 1000, 'Uncommon', c => c.s.endsWith('0')],
  ['SEMI_CLEAN', 'Semi-Clean', '🧹', 1000, 'Uncommon', c => c.s.endsWith('5')],
  ['EQUILIBRIUM', 'Equilibrium', '🧘', 1000, 'Uncommon', c => c.len >= 2 && c.d[0] === c.d[c.len - 1]],
  ['SANDWICH', 'Sandwich', '🥪', 1000, 'Uncommon', c => c.len >= 3 && c.d[0] === c.d[c.len - 1] && c.d.slice(1, -1).some(x => x !== c.d[0])],

  // --- Common ---
  ['HILLS', 'Hills', '🏞️', 733, 'Common', c => c.len >= 4 && hills(c.d)], // prod requires length >= 4
  ['TRIPS', 'Three of a Kind', '🎰', 724, 'Common', c => c.countExact(3) > 0], // exactly 3 (a quad is not trips)
  ['LUCKY_SEVEN_DIV', 'Lucky Seven (Divisible)', '🎰', 700, 'Common', c => c.n > 0 && c.n % 7 === 0],
  ['HETEROGENEOUS', 'Heterogeneous', '🥗', 593, 'Common', c => c.distinct === c.len],
  ['GAP_ONE', 'Gap One', '↕️', 529, 'Common', c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1],
  ['TWO_PAIR', 'Two Pair', '👯‍♀️', 447, 'Common', c => c.countExact(2) >= 2],
  ['HOPSCOTCH', 'Hopscotch', '🦘', 312, 'Common', c => {
    if (c.len < 3 || c.distinct < 2) return false;
    for (let e = 0; e <= c.len - 3; e++) {
      if (c.s[e + 2] === c.s[e]) {
        const ahead = c.len > e + 4 && c.s[e + 4] === c.s[e];
        const behind = e >= 2 && c.s[e - 2] === c.s[e];
        if (!ahead && !behind) return true; // exactly a 2-long every-other run
      }
    }
    return false;
  }],
  ['GHOST', 'Ghost', '👻', 309, 'Common', c => (c.counts[0] || 0) === 1],
  ['QUARTET', 'Quartet', '🎻', 290, 'Common', c => c.distinct === 4],
  ['HYDROGEN', 'Hydrogen (1)', '💧', 282, 'Common', c => (c.counts[1] || 0) === 1],
  ['HELIUM', 'Helium (2)', '🎈', 282, 'Common', c => (c.counts[2] || 0) === 1],
  ['CARBON', 'Carbon (6)', '✏️', 282, 'Common', c => (c.counts[6] || 0) === 1],
  ['OXYGEN', 'Oxygen (8)', '💨', 282, 'Common', c => (c.counts[8] || 0) === 1],
  ['LITHIUM', 'Lithium (3)', '🔋', 282, 'Common', c => (c.counts[3] || 0) === 1],
  ['BERYLLIUM', 'Beryllium (4)', '💎', 282, 'Common', c => (c.counts[4] || 0) === 1],
  ['BORON', 'Boron (5)', '🧼', 282, 'Common', c => (c.counts[5] || 0) === 1],
  ['NITROGEN', 'Nitrogen (7)', '❄️', 282, 'Common', c => (c.counts[7] || 0) === 1],
  ['FLUORINE', 'Fluorine (9)', '🦷', 282, 'Common', c => (c.counts[9] || 0) === 1],
  ['GROUNDED', 'Grounded', '⚓', 250, 'Common', c => c.len >= 2 && c.d[0] < c.d[c.len - 1]],
  ['CONTIGUOUS_PAIR', 'Contiguous Pair', '🫂', 249, 'Common', c => /(\d)\1/.test(c.s)],
  ['LUCKY_7', 'Lucky Seven', '7️⃣', 213, 'Common', c => c.has('7')],
  ['EVEN', 'Even', '⚖️', 200, 'Common', c => c.n % 2 === 0],
  ['ODD', 'Odd', '🦄', 200, 'Common', c => c.n % 2 === 1],
  ['LIFTOFF', 'Liftoff', '🚀', 200, 'Common', c => c.len >= 2 && c.d[0] > c.d[c.len - 1]],
  ['VOID', 'Void', '🕳️', 167, 'Common', c => !c.has('0')],
  ['NEIGHBORS', 'Neighbors', '🏘️', 161, 'Common', c => {
    for (let i = 0; i + 1 < c.len; i++) if (Math.abs(c.d[i] - c.d[i + 1]) === 1) return true; // adjacent positions only
    return false;
  }],
  // CSV lists Pair at 120, but the live game scores it 0 (see the "Pair Fix" toggle /
  // the pairFix option in compute()). Inferred from prod: 634700 = 18,194.
  ['PAIR', 'Pair', '👯', 120, 'Common', c => c.maxCount >= 2],
  ['SIX_DIGITS', 'Six Digits', '🐝', 111, 'Common', c => c.len === 6],
];

// ---------------------------------------------------------------------------
// Human-readable requirement per badge (from the source CSV "Description").
// Shown in the hover tooltip alongside the probability below.
// ---------------------------------------------------------------------------

const DESCRIPTIONS = {
  NICE_EXACT: 'Exactly "69".',
  JACKPOT_EXACT: 'Exactly "777".',
  JACKPOT_SIX: 'Contains six 7s in a row.',
  BOTANIST_EXACT: 'Exactly "420".',
  DEVIL_EXACT: 'Exactly "666".',
  LEET_EXACT: 'Exactly "1337".',
  EXACT_HELL: 'Exactly "7734".',
  EXACT_BOOB_80085: 'Exactly "80085".',
  MEANING_EXACT: 'Exactly "42".',
  EMERGENCY_EXACT: 'Exactly "911".',
  VERY_VERY_NICE: 'Exactly "696969".',
  HOTBOX: 'Exactly "420420".',
  MAYDAY: 'Exactly "911911".',
  UNIVERSAL_ANSWER: 'Exactly "424242".',
  BIG_BROTHER_EXACT: 'Exactly "1984".',
  DIGIT_ZERO: 'The number zero.',
  DIGIT_ONE: 'The number one.',
  DIGIT_TWO: 'The number two.',
  DIGIT_THREE: 'The number three.',
  DIGIT_FOUR: 'The number four.',
  DIGIT_FIVE: 'The number five.',
  DIGIT_SIX: 'The number six.',
  DIGIT_SEVEN: 'The number seven.',
  DIGIT_EIGHT: 'The number eight.',
  DIGIT_NINE: 'The number nine.',
  TREE_FIDDY_EXACT: 'Exactly "350".',
  SIXTY_SEVEN_EXACT: 'Exactly "67".',
  EIGHTY_SIX_EXACT: 'Exactly "86".',
  ORIENTATION_EXACT: 'Exactly "101".',
  CALENDAR_EXACT: 'Exactly "365".',
  BRAINROT: 'Exactly "676767".',
  GROUNDHOG_DAY: 'Exactly "365365".',
  EXACT_BOOB: 'Exactly "8008" or "58008".',
  THIRTEENTH_POWER: 'A perfect thirteenth power (n¹³).',
  SEVENTEENTH_POWER: 'A perfect seventeenth power (n¹⁷).',
  NINETEENTH_POWER: 'A perfect nineteenth power (n¹⁹).',
  TENTH_POWER: 'A perfect tenth power (n¹⁰).',
  ELEVENTH_POWER: 'A perfect eleventh power (n¹¹).',
  PI: 'Exactly π (314, 3141, 31415, or 314159).',
  E: 'The number e (271, 2718, 27182, or 271828).',
  CONSEC_QUAD_EXACT: 'The entire number splits into four consecutive integers in order.',
  NINTH_POWER: 'A perfect ninth power (n⁹).',
  EIGHTH_POWER: 'A perfect eighth power (n⁸).',
  SEVENTH_POWER: 'A perfect seventh power (n⁷).',
  FACTORIAL: 'A factorial number (n!).',
  HELLO: 'Contains "07734" (spells HELLO upside-down).',
  SEQUENCE_6: 'Contains a sequence of 6 consecutive digits.',
  CONTIGUOUS_SIXES: 'Six identical consecutive digits.',
  DEEP_VOID_FIVE: 'Contains "00000".',
  ONE_DIGIT: 'Has exactly one digit.',
  QUINT_NINE: 'Ends in 99999.',
  SIXTH_POWER: 'A perfect sixth power (n⁶).',
  POWER_OF_THREE: 'A power of 3 (3ⁿ).',
  FIFTH_POWER: 'A perfect fifth power (n⁵).',
  JACKPOT_FIVE: 'Contains five 7s in a row.',
  POWER_OF_TWO: 'A power of 2 (2ⁿ).',
  ROYAL_FLUSH: 'Contains 56789 - the highest possible straight.',
  BOOB_58008: 'Contains "58008" (spells BOOBS upside-down).',
  BOOB_80085: 'Contains "80085" (spells BOOBS).',
  PI_CONTAINS_5: 'Contains "31415".',
  E_CONTAINS_5: 'Contains "27182".',
  CASCADE: 'Every digit increases by exactly 1 from the previous.',
  FIBONACCI: 'Part of the golden ratio sequence found in nature.',
  FOURTH_POWER: 'A perfect fourth power (n⁴).',
  WATERFALL: 'Every digit decreases by exactly 1 from the previous.',
  CONSEC_QUAD_CONTAINS: 'Contains four adjacent consecutive integers.',
  CONSEC_QUAD_SCRAMBLED: 'The entire number splits into four consecutive integers, but not in order.',
  HOMOGENEOUS: 'All digits are the same.',
  BINARY_SOUL: 'Only 0s and 1s.',
  STRAIGHT_FLUSH: 'Contains 5 consecutive same-parity digits (02468, 13579, or their reverse).',
  TWO_DIGITS: 'Has exactly two digits.',
  SPY: 'The sum of its digits equals the product of its digits.',
  QUAD_NINE: 'Ends in 9999.',
  SEMI_EPOCH: 'Ends in "5000".',
  CUBE: 'A perfect cube (n³).',
  EVEN_SPACING: 'All digits are evenly spaced in an arithmetic sequence.',
  CONSEC_TRIPLE_EXACT: 'The entire number splits into three consecutive integers in order.',
  CONTIGUOUS_FIVES: 'Five identical consecutive digits.',
  DEEP_VOID_FOUR: 'Contains "0000".',
  STROBOGRAMMATIC: 'Looks the same when rotated 180 degrees.',
  STRAIGHT: 'Contains a sequence of 5 consecutive digits (ascending or descending).',
  JACKPOT_FOUR: 'Contains four 7s in a row.',
  VERY_NICE: 'Contains "6969".',
  DEEPER_MEANING: 'Contains "4242".',
  SIXTY_SEVEN_DOUBLE: 'Contains "6767".',
  LEET: 'Contains "1337".',
  HELL: 'Contains "7734" (spells HELL upside-down).',
  BOOB_8008: 'Contains "8008" (spells BOOB upside-down).',
  BIG_BROTHER: 'Contains "1984".',
  PI_CONTAINS_4: 'Contains "3141".',
  E_CONTAINS_4: 'Contains "2718".',
  CONSEC_TRIPLE_SCRAMBLED: 'The entire number splits into three consecutive integers, but not in order.',
  ZIPPER: 'Two digits alternating perfectly.',
  ASCENSION: 'Every digit is strictly larger than the previous.',
  CONSEC_TRIPLE_CONTAINS: 'Contains three adjacent consecutive integers.',
  CONTIGUOUS_THREE_PAIR: 'Contains three adjacent contiguous pairs.',
  FRAMED_PAIR: 'A 4-digit number where the middle two digits match each other but differ from both end digits.',
  FRAMED_TRIPLE: 'A triple in the middle, bookended by different digits.',
  DECAY: 'Every digit is strictly smaller than the previous.',
  THREE_DIGITS: 'Has exactly three digits.',
  ECHO: 'The first half repeats as the second half.',
  MILLENNIUM: 'Ends in triple zeros.',
  PRONIC: 'The product of two consecutive integers (n * n+1).',
  TRIPLE_NINE: 'Ends in 999.',
  SEMI_MILLENNIUM: 'Ends in "500".',
  COLOSSAL: 'A number greater than 999,000.',
  SQUARE: 'A perfect square (n²).',
  EVEN_SPACING_ABS: 'All digits have the same absolute spacing (e.g., ±2 each time).',
  FIREFLY: 'One unique digit among identical others.',
  CONSEC_PAIR_EXACT: 'The entire number splits into two consecutive integers.',
  PALINDROME: 'Reads the same forwards and backwards.',
  CONTIGUOUS_QUADS: 'Four identical consecutive digits.',
  DEEP_VOID_THREE: 'Contains "000".',
  TURTLE: 'All consecutive digits differ by at most 1.',
  SECRET_AGENT: 'Contains "007".',
  HEAVY: 'The sum of its digits exceeds 45.',
  CONTIGUOUS_BOAT: 'Contains a contiguous set of three adjacent to a contiguous set of two.',
  JACKPOT: 'Contains "777".',
  DEVIL: 'Contains "666".',
  SEQUENCE_4: 'Contains a sequence of 4 consecutive digits.',
  ERROR: 'Contains "404".',
  ORIENTATION: 'Contains "101" (intro course number).',
  BOTANIST: 'Contains "420".',
  EMERGENCY: 'Contains "911".',
  PI_CONTAINS_3: 'Contains "314".',
  E_CONTAINS_3: 'Contains "271".',
  TREE_FIDDY: 'Contains "350" (the Loch Ness Monster\'s request).',
  CALENDAR: 'Contains "365" (days in a year).',
  DIVISIBLE_BY_THREE: 'Every digit is divisible by 3.',
  SCRAMBLE: 'All digits form a consecutive sequence when sorted.',
  DUALITY: 'Uses exactly two different digits.',
  FRAMED_DOUBLE: 'Two pairs in the middle, bookended by different digits.',
  PAIRED_BOOKENDS: 'Starts with a pair and ends with a different pair.',
  FOUR_DIGITS: 'Has exactly four digits.',
  THREE_PAIR: 'Contains three distinct pairs of matching digits.',
  BOOKENDS: 'The first two digits match the last two.',
  MIRROR_BOOKENDS: 'First two digits are reversed as the last two.',
  CENTURY: 'Ends in double zeros.',
  DOUBLE_NINE: 'Ends in 99.',
  SEMI_CENTURY: 'Ends in "50".',
  QUADS: 'Contains four identical digits.',
  LOW_BALL: 'Contains only digits from 0 to 4.',
  CONTIGUOUS_TWO_PAIR: 'Contains two adjacent contiguous pairs.',
  MOUNTAIN: 'Digits ascend to a peak and then descend.',
  DOUBLE_HOP: 'A digit appears at every other position (3 times).',
  HIGH_ROLLER: 'Contains only digits from 5 to 9.',
  VALLEY: 'Digits descend to a trough and then ascend.',
  MINI_ECHO: 'Contains an adjacent 2-digit repeat.',
  ALTERNATOR: 'Digits strictly alternate between even and odd.',
  FLUSH: 'All digits are either all even or all odd.',
  CONTIGUOUS_TRIPS: 'Three identical consecutive digits.',
  DEEP_VOID: 'Contains "00".',
  FEATHER: 'The sum of its digits is less than 15.',
  BLACKJACK: 'Digits sum exactly to 21.',
  BOAT: 'Contains a set of three and a set of two.',
  SNAKE_EYES: 'Contains a single pair of ones and no other pairs.',
  NICE: 'Contains the number 69.',
  MEANING: 'Contains "42".',
  SIXTY_SEVEN: 'Contains "67".',
  EIGHTY_SIX: 'Contains "86" (restaurant slang for "out of").',
  BALANCED: 'Sum of first half of digits equals sum of second half.',
  RHYME: 'Contains the same 2+ digit substring twice.',
  SEQUENCE_3: 'Contains a sequence of 3 consecutive digits.',
  CONSEC_PAIR_ADJACENT: 'Contains two adjacent substrings that are consecutive integers.',
  CONSEC_PAIR_NEARBY: 'Contains two non-adjacent substrings that are consecutive integers.',
  PRIME: 'Divisible only by 1 and itself.',
  TRINITY: 'Uses exactly three different digits.',
  DOZEN: 'Divisible by 12.',
  FIVE_DIGITS: 'Has exactly five digits.',
  ELEVEN: 'Divisible by 11.',
  HARSHAD: 'Divisible by the sum of its own digits.',
  CLEAN: 'Ends in a zero.',
  SEMI_CLEAN: 'Ends in a 5.',
  EQUILIBRIUM: 'The first and last digits are identical.',
  SANDWICH: 'First and last digits match, with at least one different digit between them.',
  HILLS: 'Digits strictly alternate between rising and falling.',
  TRIPS: 'Contains three identical digits.',
  LUCKY_SEVEN_DIV: 'Divisible by 7.',
  HETEROGENEOUS: 'No repeated digits.',
  GAP_ONE: 'The first and last digits differ by exactly 1.',
  TWO_PAIR: 'Contains two distinct pairs of matching digits.',
  HOPSCOTCH: 'A digit appears at every other position (2 times).',
  GHOST: 'Contains exactly one "0".',
  QUARTET: 'Uses exactly four different digits.',
  HYDROGEN: 'Contains exactly one "1".',
  HELIUM: 'Contains exactly one "2".',
  CARBON: 'Contains exactly one "6".',
  OXYGEN: 'Contains exactly one "8".',
  LITHIUM: 'Contains exactly one "3".',
  BERYLLIUM: 'Contains exactly one "4".',
  BORON: 'Contains exactly one "5".',
  NITROGEN: 'Contains exactly one "7".',
  FLUORINE: 'Contains exactly one "9".',
  GROUNDED: 'The first digit is smaller than the last.',
  CONTIGUOUS_PAIR: 'Contains a contiguous pair of matching digits.',
  LUCKY_7: 'Contains the number 7.',
  EVEN: 'Divisible by 2.',
  ODD: 'Not divisible by 2.',
  LIFTOFF: 'The first digit is larger than the last.',
  VOID: 'Contains no zeros.',
  NEIGHBORS: 'Contains two digits that are adjacent in value.',
  PAIR: 'Contains a pair of matching digits.',
  SIX_DIGITS: 'Has exactly six digits.',
};

// Exact share of all numbers 0..999999 that earn each badge (as a percent).
// Computed by running every test across the full 0..999999 range.
const PROBABILITIES = {
  NICE_EXACT: 0.0001, JACKPOT_EXACT: 0.0001, JACKPOT_SIX: 0.0001, BOTANIST_EXACT: 0.0001,
  DEVIL_EXACT: 0.0001, LEET_EXACT: 0.0001, EXACT_HELL: 0.0001, EXACT_BOOB_80085: 0.0001,
  MEANING_EXACT: 0.0001, EMERGENCY_EXACT: 0.0001, VERY_VERY_NICE: 0.0001, HOTBOX: 0.0001,
  MAYDAY: 0.0001, UNIVERSAL_ANSWER: 0.0001, BIG_BROTHER_EXACT: 0.0001, DIGIT_ZERO: 0.0001,
  DIGIT_ONE: 0.0001, DIGIT_TWO: 0.0001, DIGIT_THREE: 0.0001, DIGIT_FOUR: 0.0001,
  DIGIT_FIVE: 0.0001, DIGIT_SIX: 0.0001, DIGIT_SEVEN: 0.0001, DIGIT_EIGHT: 0.0001,
  DIGIT_NINE: 0.0001, TREE_FIDDY_EXACT: 0.0001, SIXTY_SEVEN_EXACT: 0.0001, EIGHTY_SIX_EXACT: 0.0001,
  ORIENTATION_EXACT: 0.0001, CALENDAR_EXACT: 0.0001, BRAINROT: 0.0001, GROUNDHOG_DAY: 0.0001,
  EXACT_BOOB: 0.0002, THIRTEENTH_POWER: 0.0001, SEVENTEENTH_POWER: 0.0001, NINETEENTH_POWER: 0.0001,
  TENTH_POWER: 0.0002, ELEVENTH_POWER: 0.0002, PI: 0.0004, E: 0.0004,
  CONSEC_QUAD_EXACT: 0.0008, NINTH_POWER: 0.0003, EIGHTH_POWER: 0.0004, SEVENTH_POWER: 0.0006,
  FACTORIAL: 0.0009, HELLO: 0.0009, SEQUENCE_6: 0.0004, CONTIGUOUS_SIXES: 0.0009,
  DEEP_VOID_FIVE: 0.0009, ONE_DIGIT: 0.001, QUINT_NINE: 0.001, SIXTH_POWER: 0.0008,
  POWER_OF_THREE: 0.0012, FIFTH_POWER: 0.0014, JACKPOT_FIVE: 0.0019, POWER_OF_TWO: 0.0019,
  ROYAL_FLUSH: 0.002, BOOB_58008: 0.002, BOOB_80085: 0.002, PI_CONTAINS_5: 0.002,
  E_CONTAINS_5: 0.002, CASCADE: 0.003, FIBONACCI: 0.003, FOURTH_POWER: 0.003,
  WATERFALL: 0.0035, CONSEC_QUAD_CONTAINS: 0.19, CONSEC_QUAD_SCRAMBLED: 0.0202, HOMOGENEOUS: 0.0045,
  BINARY_SOUL: 0.0064, STRAIGHT_FLUSH: 0.0069, TWO_DIGITS: 0.009, SPY: 0.0089,
  QUAD_NINE: 0.01, SEMI_EPOCH: 0.01, CUBE: 0.0098, EVEN_SPACING: 0.0116,
  CONSEC_TRIPLE_EXACT: 0.0097, CONTIGUOUS_FIVES: 0.018, DEEP_VOID_FOUR: 0.018, STROBOGRAMMATIC: 0.0199,
  STRAIGHT: 0.022, JACKPOT_FOUR: 0.028, VERY_NICE: 0.0299, DEEPER_MEANING: 0.0299,
  SIXTY_SEVEN_DOUBLE: 0.0299, LEET: 0.03, HELL: 0.03, BOOB_8008: 0.03,
  BIG_BROTHER: 0.03, PI_CONTAINS_4: 0.03, E_CONTAINS_4: 0.03, CONSEC_TRIPLE_SCRAMBLED: 0.0489,
  ZIPPER: 0.0324, ASCENSION: 0.0456, CONSEC_TRIPLE_CONTAINS: 2.9234, CONTIGUOUS_THREE_PAIR: 0.09,
  FRAMED_PAIR: 0.0729, FRAMED_TRIPLE: 0.0729, DECAY: 0.0837, THREE_DIGITS: 0.09,
  ECHO: 0.099, MILLENNIUM: 0.0999, PRONIC: 0.1, TRIPLE_NINE: 0.1,
  SEMI_MILLENNIUM: 0.1, COLOSSAL: 0.0999, SQUARE: 0.0998, EVEN_SPACING_ABS: 0.1099,
  FIREFLY: 0.1458, CONSEC_PAIR_EXACT: 0.099, PALINDROME: 0.1989, CONTIGUOUS_QUADS: 0.27,
  DEEP_VOID_THREE: 0.27, TURTLE: 0.2773, SECRET_AGENT: 0.2889, HEAVY: 0.3003,
  CONTIGUOUS_BOAT: 0.3321, JACKPOT: 0.37, DEVIL: 0.37, SEQUENCE_4: 0.188,
  ERROR: 0.3979, ORIENTATION: 0.3979, BOTANIST: 0.3999, EMERGENCY: 0.3999,
  PI_CONTAINS_3: 0.3999, E_CONTAINS_3: 0.3999, TREE_FIDDY: 0.3999, CALENDAR: 0.3999,
  DIVISIBLE_BY_THREE: 0.4096, SCRAMBLE: 0.4401, DUALITY: 0.4617, FRAMED_DOUBLE: 0.6561,
  PAIRED_BOOKENDS: 0.8991, FOUR_DIGITS: 0.9, THREE_PAIR: 0.972, BOOKENDS: 0.999,
  MIRROR_BOOKENDS: 0.999, CENTURY: 0.9999, DOUBLE_NINE: 1, SEMI_CENTURY: 1,
  QUADS: 1.1853, LOW_BALL: 1.5625, CONTIGUOUS_TWO_PAIR: 2.781, MOUNTAIN: 1.6992,
  DOUBLE_HOP: 1.881, HIGH_ROLLER: 1.953, VALLEY: 2.3817, MINI_ECHO: 2.7,
  ALTERNATOR: 3.5145, FLUSH: 3.5145, CONTIGUOUS_TRIPS: 3.5919, DEEP_VOID: 3.5919,
  FEATHER: 3.75, BLACKJACK: 3.9662, BOAT: 4.1715, SNAKE_EYES: 4.7139,
  NICE: 4.9401, MEANING: 4.9401, SIXTY_SEVEN: 4.9401, EIGHTY_SIX: 4.9401,
  BALANCED: 5.7276, RHYME: 8.6139, SEQUENCE_3: 2.8848, CONSEC_PAIR_ADJACENT: 3.1273,
  CONSEC_PAIR_NEARBY: 3.2022, PRIME: 7.8498, TRINITY: 7.9056, DOZEN: 8.3334,
  FIVE_DIGITS: 9, ELEVEN: 9.091, HARSHAD: 9.5427, CLEAN: 10,
  SEMI_CLEAN: 10, EQUILIBRIUM: 9.9999, SANDWICH: 9.9954, HILLS: 13.695,
  TRIPS: 14.9886, LUCKY_SEVEN_DIV: 14.2858, HETEROGENEOUS: 16.8561, GAP_ONE: 18.8887,
  TWO_PAIR: 26.5518, HOPSCOTCH: 33.57, GHOST: 32.3848, QUARTET: 34.4736,
  HYDROGEN: 35.4294, HELIUM: 35.4294, CARBON: 35.4294, OXYGEN: 35.4294,
  LITHIUM: 35.4294, BERYLLIUM: 35.4294, BORON: 35.4294, NITROGEN: 35.4294,
  FLUORINE: 35.4294, GROUNDED: 39.9996, CONTIGUOUS_PAIR: 40.2129, LUCKY_7: 46.8559,
  EVEN: 50, ODD: 50, LIFTOFF: 49.9995, VOID: 59.787,
  NEIGHBORS: 89.6109, PAIR: 83.1429, SIX_DIGITS: 90,
};

// Format a percentage for display, keeping small values legible.
function fmtProb(p) {
  if (p === undefined) return '-';
  if (p === 0) return '0%';
  if (p >= 1) return `${Number(p.toFixed(2))}%`;
  if (p >= 0.01) return `${Number(p.toFixed(3))}%`;
  return `${Number(p.toFixed(4))}%`;
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

// Supersession families: prod tags each badge with a `family` and, within a family, only
// the single HIGHEST-EP earned badge scores - the rest are still displayed as earned but
// score 0, because the higher tier already implies them. This list is the full family map
// extracted from the live game's BADGE_DEFINITIONS (35 families / 138 badges); the remaining
// 65 badges are standalone and always score. Member order is irrelevant - the scorer keeps
// the max-EP member - but each family is listed highest-EP first for readability.
const FAMILIES = [
  ['THIRTEENTH_POWER', 'SEVENTEENTH_POWER', 'NINETEENTH_POWER', 'TENTH_POWER', 'ELEVENTH_POWER', 'NINTH_POWER', 'EIGHTH_POWER', 'SEVENTH_POWER', 'SIXTH_POWER', 'FIFTH_POWER', 'FOURTH_POWER', 'CUBE', 'SQUARE'], // POWER
  ['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR', 'DIGIT_FIVE', 'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE', 'ONE_DIGIT'], // SINGLE_DIGIT
  ['CONSEC_QUAD_EXACT', 'CONSEC_QUAD_CONTAINS', 'CONSEC_QUAD_SCRAMBLED', 'CONSEC_TRIPLE_EXACT', 'CONSEC_TRIPLE_SCRAMBLED', 'CONSEC_TRIPLE_CONTAINS', 'CONSEC_PAIR_EXACT', 'CONSEC_PAIR_ADJACENT', 'CONSEC_PAIR_NEARBY'], // CONSECUTIVE
  ['SEQUENCE_6', 'CASCADE', 'WATERFALL', 'EVEN_SPACING', 'EVEN_SPACING_ABS', 'TURTLE', 'SEQUENCE_4', 'SCRAMBLE', 'SEQUENCE_3'], // PROGRESSION
  ['CONTIGUOUS_THREE_PAIR', 'FRAMED_PAIR', 'FRAMED_DOUBLE', 'THREE_PAIR', 'CONTIGUOUS_TWO_PAIR', 'TWO_PAIR', 'CONTIGUOUS_PAIR', 'PAIR'], // PAIRS
  ['EXACT_BOOB_80085', 'EXACT_BOOB', 'BOOB_58008', 'BOOB_80085', 'BOOB_8008'], // BOOB
  ['BOTANIST_EXACT', 'MEANING_EXACT', 'HOTBOX', 'BOTANIST', 'MEANING'], // BOTANIST
  ['JACKPOT_EXACT', 'JACKPOT_SIX', 'JACKPOT_FIVE', 'JACKPOT_FOUR', 'JACKPOT'], // JACKPOT
  ['CONTIGUOUS_SIXES', 'CONTIGUOUS_FIVES', 'CONTIGUOUS_QUADS', 'CONTIGUOUS_TRIPS'], // CONTIGUOUS_RUN
  ['E', 'E_CONTAINS_5', 'E_CONTAINS_4', 'E_CONTAINS_3'], // E
  ['NICE_EXACT', 'VERY_VERY_NICE', 'VERY_NICE', 'NICE'], // NICE
  ['QUINT_NINE', 'QUAD_NINE', 'TRIPLE_NINE', 'DOUBLE_NINE'], // NINE_ENDING
  ['PI', 'PI_CONTAINS_5', 'PI_CONTAINS_4', 'PI_CONTAINS_3'], // PI
  ['SIXTY_SEVEN_EXACT', 'BRAINROT', 'SIXTY_SEVEN_DOUBLE', 'SIXTY_SEVEN'], // SIXTY_SEVEN
  ['DEEP_VOID_FIVE', 'DEEP_VOID_FOUR', 'DEEP_VOID_THREE', 'DEEP_VOID'], // VOID_DEPTH
  ['PAIRED_BOOKENDS', 'BOOKENDS', 'MIRROR_BOOKENDS'], // BOOKENDS
  ['CALENDAR_EXACT', 'GROUNDHOG_DAY', 'CALENDAR'], // CALENDAR
  ['EMERGENCY_EXACT', 'MAYDAY', 'EMERGENCY'], // EMERGENCY
  ['FRAMED_TRIPLE', 'QUADS', 'TRIPS'], // OF_A_KIND
  ['ROYAL_FLUSH', 'STRAIGHT_FLUSH', 'STRAIGHT'], // STRAIGHT
  ['BIG_BROTHER_EXACT', 'BIG_BROTHER'], // BIG_BROTHER
  ['CONTIGUOUS_BOAT', 'BOAT'], // BOAT
  ['DEVIL_EXACT', 'DEVIL'], // DEVIL
  ['FIREFLY', 'DUALITY'], // DUALITY
  ['EIGHTY_SIX_EXACT', 'EIGHTY_SIX'], // EIGHTY_SIX
  ['EQUILIBRIUM', 'SANDWICH'], // EQUILIBRIUM
  ['EXACT_HELL', 'HELL'], // HELL
  ['DOUBLE_HOP', 'HOPSCOTCH'], // HOPSCOTCH
  ['LEET_EXACT', 'LEET'], // LEET
  ['UNIVERSAL_ANSWER', 'DEEPER_MEANING'], // MEANING
  ['ASCENSION', 'DECAY'], // MONOTONIC
  ['ORIENTATION_EXACT', 'ORIENTATION'], // ORIENTATION
  ['MOUNTAIN', 'VALLEY'], // PEAK
  ['MINI_ECHO', 'RHYME'], // REPEAT
  ['TREE_FIDDY_EXACT', 'TREE_FIDDY'], // TREE_FIDDY
];

function compute(n) {
  const s = String(n);
  const d = [...s].map(ch => ch.charCodeAt(0) - 48);
  const counts = {};
  for (const x of d) counts[x] = (counts[x] || 0) + 1;
  const c = {
    n, s, len: s.length, d, counts,
    distinct: Object.keys(counts).length,
    sum: d.reduce((a, b) => a + b, 0),
    prod: d.reduce((a, b) => a * b, 1),
    maxCount: Math.max(...Object.values(counts)),
    has: sub => s.includes(sub),
    cnt: digit => counts[digit] || 0,
    withCount: k => Object.values(counts).filter(v => v >= k).length,
    countExact: k => Object.values(counts).filter(v => v === k).length,
    runs: runLengths(s),
  };
  const earned = [];
  for (const [id, label, emoji, ep, rarity, test] of BADGES) {
    let ok = false;
    try { ok = test(c); } catch (e) { ok = false; }
    if (ok) earned.push({ id, label, emoji, ep, rarity, desc: DESCRIPTIONS[id], prob: PROBABILITIES[id] });
  }
  // Apply family supersession: within each family, only the highest-EP earned badge scores;
  // the rest stay in the earned list (displayed) but score 0. Matches prod's max-score-wins.
  for (const fam of FAMILIES) {
    const members = earned.filter(b => fam.includes(b.id));
    if (members.length < 2) continue;
    let top = members[0];
    for (const b of members) if (b.ep > top.ep) top = b;
    for (const b of members) if (b !== top) b.ep = 0;
  }
  const total = earned.reduce((s, b) => s + b.ep, 0);
  earned.sort((a, b) => b.ep - a.ep);
  return { number: n, totalEP: total, count: earned.length, badges: earned };
}

// ---------------------------------------------------------------------------
// Browser engine (for the "Analyze all scores" feature)
//
// Computing all 1,000,000 numbers x 203 badge tests is far beyond a single
// Worker request's CPU budget, so the analysis runs client-side in a Web Worker.
// Rather than duplicate the 200+ badge rules, we GENERATE a self-contained ES
// module from the live definitions via Function.prototype.toString(). Any edit to
// a `test` function above automatically flows into this engine - no second copy.
// ---------------------------------------------------------------------------

function engineModuleSource() {
  // Named function declarations (hoisted) used by the badge tests.
  const named = [
    ipow, isPerfectPower, isPowerOf, isPrime, partitions, consecAsc, consecScrambled,
    containsConsec, pairNearby, seqAsc, straightRun, mountain, valley, hills,
    runLengths, strobogrammatic,
    // prod-ported helpers (must ship to the browser engine too)
    pLeadingZero, pMultiPart, pConsecSet, pDigitCounts, pContig, pOrdered, pHasSequence,
    pPairExact, pTripleExact, pQuadExact, pPairAdjacent, pPairNearby,
    pNAdjacentBuild, pNAdjacentAt, pNAdjacent, pContigPairStarts,
  ];
  const namedSrc = named.map(f => f.toString()).join('\n');

  // const-arrow helpers (toString gives only the arrow, so re-emit the binding).
  const constArrows = [
    ['validPart', validPart], ['strictInc', strictInc], ['strictDec', strictDec],
    ['consecInc', consecInc], ['consecDec', consecDec], ['arithmetic', arithmetic],
    ['absArith', absArith], ['turtle', turtle], ['alternator', alternator],
    ['allSameParity', allSameParity],
  ];
  const constSrc = constArrows.map(([n, f]) => `const ${n} = ${f.toString()};`).join('\n');

  // Precomputed sets: serialize the VALUES (don't re-run the builders).
  const dataSrc =
    `const FACTORIALS = new Set([${[...FACTORIALS].join(',')}]);\n` +
    `const FIBS = new Set([${[...FIBS].join(',')}]);\n` +
    `const PRONICS = new Set([${[...PRONICS].join(',')}]);`;

  // The badge table, with each test re-emitted from its source.
  const badgesSrc = 'const BADGES = [\n' + BADGES.map(b =>
    `  [${JSON.stringify(b[0])},${JSON.stringify(b[1])},${JSON.stringify(b[2])},` +
    `${b[3]},${JSON.stringify(b[4])},${b[5].toString()}]`
  ).join(',\n') + '\n];';

  const supSrc = `const FAMILIES = ${JSON.stringify(FAMILIES)};`;

  // Lean compute: post-supersession total EP + earned badge indices, no UI metadata.
  const rest = `
const BADGE_META = BADGES.map(b => ({ id: b[0], label: b[1], emoji: b[2], rarity: b[4] }));
const SUP_INDEX = (() => {
  const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
  return FAMILIES.map(g => g.map(id => idToIdx.get(id)).filter(i => i !== undefined));
})();

function computeLean(n) {
  const s = String(n);
  const d = [...s].map(ch => ch.charCodeAt(0) - 48);
  const counts = {};
  for (const x of d) counts[x] = (counts[x] || 0) + 1;
  const c = {
    n, s, len: s.length, d, counts,
    distinct: Object.keys(counts).length,
    sum: d.reduce((a, b) => a + b, 0),
    prod: d.reduce((a, b) => a * b, 1),
    maxCount: Math.max(...Object.values(counts)),
    has: sub => s.includes(sub),
    cnt: digit => counts[digit] || 0,
    withCount: k => Object.values(counts).filter(v => v >= k).length,
    countExact: k => Object.values(counts).filter(v => v === k).length,
    runs: runLengths(s),
  };
  const earned = [];
  const epOf = new Map();
  for (let i = 0; i < BADGES.length; i++) {
    let ok = false;
    try { ok = BADGES[i][5](c); } catch (e) { ok = false; }
    if (ok) { earned.push(i); epOf.set(i, BADGES[i][3]); }
  }
  const earnedSet = new Set(earned);
  for (const g of SUP_INDEX) {
    const members = g.filter(i => earnedSet.has(i));
    if (members.length < 2) continue;
    let top = members[0];
    for (const i of members) if (epOf.get(i) > epOf.get(top)) top = i;
    for (const i of members) if (i !== top) epOf.set(i, 0); // zero all but the max-EP member
  }
  let total = 0;
  for (const v of epOf.values()) total += v;
  return { ep: total, earned };
}

export { computeLean, BADGE_META };
`;
  // __name shim: when this Worker is bundled (esbuild keepNames), function source returned
  // by toString() contains __name(fn,"fn") calls. That helper only exists in the bundled
  // scope, so we redefine a no-op here for the browser module context. Harmless unbundled.
  return ['var __name = (f) => f;', namedSrc, constSrc, dataSrc, badgesSrc, supSrc, rest].join('\n');
}

// ---------------------------------------------------------------------------
// Analysis: client-side Web Worker + page controller.
//
// These two functions never run on the server - they are serialized with
// Function.prototype.toString() and shipped to the browser. The worker holds
// the full 0..999,999 result cache (EP per number + a per-number badge bitmask)
// so that re-filtering by length / badge is instant after the one-time sweep.
// They must be self-contained (browser globals + args only - no module scope).
// ---------------------------------------------------------------------------

function analysisWorker() {
  let E = null, origin = '';
  let epArr = null, lenArr = null, idxArr = null, bits = null, count = 0, ROW = 0, computedMax = 0;
  let examples = null, lastStride = 1, lastLengths = [1, 2, 3, 4, 5, 6], lastSampled6 = false;
  const EX_PER_BADGE = 12;                       // examples[badgeIdx] = [[n, ep], ...], capped
  const LRANGE = { 1: [0, 9], 2: [10, 99], 3: [100, 999], 4: [1000, 9999], 5: [10000, 99999], 6: [100000, 999999], 7: [1000000, 1000000] };
  const LSIZE = { 1: 10, 2: 90, 3: 900, 4: 9000, 5: 90000, 6: 900000, 7: 1 };
  async function engine() { if (!E) E = await import(origin + '/engine.js'); return E; }
  // `badges` (DO): number must earn every one of them. `exclude` (DON'T): number must earn
  // none of them. Both are applied together, so you can require some badges while excluding
  // others (e.g. HAS Equilibrium but NOT Sandwich). Empty lists impose no constraint.
  function matches(k, badges, exclude) {
    const base = k * ROW;
    for (let j = 0; j < badges.length; j++) { const bi = badges[j]; if (!(bits[base + (bi >> 3)] & (1 << (bi & 7)))) return false; }
    if (exclude) for (let j = 0; j < exclude.length; j++) { const bi = exclude[j]; if (bits[base + (bi >> 3)] & (1 << (bi & 7))) return false; }
    return true;
  }
  // Build a bitmask of digit-lengths to keep. Length is a pure post-compute filter (the full
  // 1..6 set is always computed once), so toggling lengths re-queries instantly - no recompute.
  // An empty/missing list means "all lengths".
  function lengthMask(lengths) {
    if (!lengths || !lengths.length) return 0xFE; // bits 1..7 set
    let m = 0; for (const L of lengths) m |= (1 << L); return m;
  }

  // --- Local cache (IndexedDB) -------------------------------------------------
  // The full 1,000,000-number sweep is ~tens of seconds, so we run it once and stash the
  // resulting typed arrays in IndexedDB (localStorage is far too small). A cached dataset is
  // reused for TTL_MS, and is keyed by a hash of engine.js so any scoring change busts it.
  const CACHE_DB = 'rngdle-analysis', CACHE_STORE = 'ds', CACHE_KEY = 'full', TTL_MS = 86400000;
  function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
  function idbStore(mode) {
    return new Promise((res, rej) => {
      const open = indexedDB.open(CACHE_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(CACHE_STORE);
      open.onsuccess = () => res(open.result.transaction(CACHE_STORE, mode).objectStore(CACHE_STORE));
      open.onerror = () => rej(open.error);
    });
  }
  async function idbGet(key) { return idbReq((await idbStore('readonly')).get(key)); }
  async function idbPut(key, val) { return idbReq((await idbStore('readwrite')).put(val, key)); }
  async function idbDel(key) { return idbReq((await idbStore('readwrite')).delete(key)); }
  async function engineVersion() {
    try { const t = await (await fetch(origin + '/engine.js')).text(); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + t.length; }
    catch (e) { return 'na'; }
  }

  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      if (m.cmd === 'init') {
        origin = m.origin;
        await engine();
        self.postMessage({ type: 'meta', badges: E.BADGE_META });
        return;
      }

      if (m.cmd === 'purgeCache') {
        await idbDel(CACHE_KEY).catch(() => {});
        self.postMessage({ type: 'purged' });
        return;
      }

      if (m.cmd === 'compute') {
        await engine();
        const ver = await engineVersion();
        lastStride = 1; lastLengths = [1, 2, 3, 4, 5, 6]; lastSampled6 = false;

        // 1) Reuse a fresh cached sweep if one exists (and the engine hasn't changed).
        if (!m.force) {
          const hit = await idbGet(CACHE_KEY).catch(() => null);
          if (hit && hit.ver === ver && (Date.now() - hit.ts) < TTL_MS) {
            epArr = hit.ep; lenArr = hit.len; idxArr = hit.idx; bits = hit.bits;
            ROW = hit.row; count = hit.count; computedMax = hit.max; examples = hit.examples;
            self.postMessage({ type: 'computed', count, maxEP: computedMax, lengths: lastLengths, domainTrue: count, cached: true, ts: hit.ts });
            return;
          }
        }

        // 2) Otherwise sweep every number 0..1,000,000 exactly (no sampling). Length 7 is the
        //    single 7-digit value 1,000,000 - the top of the live game's roll range.
        const lengths = [1, 2, 3, 4, 5, 6, 7];
        const B = E.BADGE_META.length;
        ROW = (B + 7) >> 3;                        // bytes of badge bitmask per number
        const cap = 1000001;
        epArr = new Float64Array(cap);
        lenArr = new Uint8Array(cap);
        idxArr = new Int32Array(cap);
        bits = new Uint8Array(cap * ROW);
        examples = []; for (let i = 0; i < B; i++) examples.push([]);
        let maxEP = 0, k = 0, scanned = 0;
        for (const L of lengths) {
          const lo = LRANGE[L][0], hi = LRANGE[L][1];
          for (let n = lo; n <= hi; n++) {
            const r = E.computeLean(n);
            epArr[k] = r.ep; lenArr[k] = L; idxArr[k] = n;
            if (r.ep > maxEP) maxEP = r.ep;
            const base = k * ROW, earned = r.earned;
            for (let j = 0; j < earned.length; j++) {
              const bi = earned[j];
              bits[base + (bi >> 3)] |= (1 << (bi & 7));
              if (examples[bi].length < EX_PER_BADGE) examples[bi].push([n, r.ep]);
            }
            k++; scanned++;
            if ((scanned % 25000) === 0) self.postMessage({ type: 'progress', pct: scanned / cap });
          }
        }
        count = k; computedMax = maxEP;

        // 3) Stash it for next time (best-effort - ignore quota/private-mode failures).
        await idbPut(CACHE_KEY, { ver, ts: Date.now(), ep: epArr, len: lenArr, idx: idxArr, bits, row: ROW, count, max: computedMax, examples }).catch(() => {});
        self.postMessage({ type: 'computed', count, maxEP, lengths, domainTrue: count, cached: false });
        return;
      }

      if (m.cmd === 'filter') {
        const badges = m.badges || [], exclude = m.exclude || [];
        const lenMask = lengthMask(m.lengths);     // which digit-lengths to include (bitmask over 1..7)
        const epMin = (m.epMin == null) ? -Infinity : m.epMin;   // "scores more than" (exclusive)
        const epMax = (m.epMax == null) ? Infinity : m.epMax;    // "and less than" (exclusive)
        const STEP = 0.25;                         // histogram resolution, in decades (dex)
        const MAXB = 2 + Math.ceil(Math.log10(Math.max(10, computedMax)) / STEP);
        const counts = new Float64Array(MAXB);
        let total = 0, raw = 0, sum = 0, mn = Infinity, mx = 0;
        for (let k = 0; k < count; k++) {
          if (!(lenMask & (1 << lenArr[k]))) continue;
          const v = epArr[k];
          if (v <= epMin || v >= epMax) continue;
          if (!matches(k, badges, exclude)) continue;
          const w = 1;                             // exhaustive sweep - every number counts once
          raw++; total += w; sum += v * w; if (v < mn) mn = v; if (v > mx) mx = v;
          let bidx = v <= 0 ? 0 : 1 + Math.floor(Math.log10(v) / STEP);
          if (bidx >= MAXB) bidx = MAXB - 1; if (bidx < 0) bidx = 0;
          counts[bidx] += w;
        }
        const buckets = [];
        for (let i = 0; i < MAXB; i++) {
          const lo = i === 0 ? 0 : Math.pow(10, (i - 1) * STEP);
          const hi = i === 0 ? 0 : Math.pow(10, i * STEP);
          buckets.push({ i, lo, hi, count: counts[i] });
        }
        self.postMessage({ type: 'histogram', buckets, stats: { total: Math.round(total), raw, mean: total ? sum / total : 0, min: raw ? mn : 0, max: mx, estimated: lastSampled6 } });
        return;
      }

      if (m.cmd === 'exportExamples') {
        const out = E.BADGE_META.map((b, i) => ({ id: b.id, label: b.label, emoji: b.emoji, rarity: b.rarity, items: examples ? examples[i] : [] }));
        self.postMessage({ type: 'examples', badges: out, stride: lastStride, lengths: lastLengths });
        return;
      }

      if (m.cmd === 'exportFilter') {
        const badges = m.badges || [], exclude = m.exclude || [];
        const lenMask = lengthMask(m.lengths);
        const epMin = (m.epMin == null) ? -Infinity : m.epMin;
        const epMax = (m.epMax == null) ? Infinity : m.epMax;
        const rows = [];
        for (let k = 0; k < count; k++) {
          if (!(lenMask & (1 << lenArr[k]))) continue;
          const v = epArr[k];
          if (v <= epMin || v >= epMax) continue;
          if (!matches(k, badges, exclude)) continue;
          rows.push([idxArr[k], v]);
        }
        rows.sort((a, b) => a[0] - b[0]);
        self.postMessage({ type: 'filterRows', rows, capped: false, stride: lastStride, lengths: lastLengths });
        return;
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

function analysisClient(WORKER_SRC) {
  const $ = id => document.getElementById(id);
  const panel = $('analysis'), btn = $('an-btn'), statusEl = $('an-status');
  const chartEl = $('an-chart'), statsEl = $('an-stats'), lenWrap = $('an-lengths');
  const badgeList = $('an-badge-list'), badgeSearch = $('an-badge-search'), purgeBtn = $('an-purge');
  const epMinEl = $('an-ep-min'), epMaxEl = $('an-ep-max');

  let worker = null, meta = [], computed = false, computing = false;
  const selectedBadges = new Set();   // require: matching numbers must earn these
  const excludedBadges = new Set();   // exclude: matching numbers must NOT earn these

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = n => {
    n = Math.round(n);
    if (n < 1000) return '' + n;
    const u = ['K', 'M', 'B']; let i = -1, x = n;
    while (x >= 1000 && i < 2) { x /= 1000; i++; }
    return (x < 10 ? x.toFixed(1) : '' + Math.round(x)) + u[i];
  };

  function makeWorker() {
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
    w.onmessage = onMsg;
    w.onerror = e => { statusEl.textContent = 'Worker error: ' + (e.message || e); };
    w.postMessage({ cmd: 'init', origin: location.origin });
    return w;
  }

  // Length tiles (1..7 digits, all glowing/on by default; 7 = the lone value 1,000,000). The
  // full set is computed once, so toggling a length is a pure instant re-filter of the stored
  // data - it never triggers a recompute (only purging the cache does).
  for (let L = 1; L <= 7; L++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'an-len-' + L;
    b.className = 'an-len on';
    b.value = L;
    b.textContent = L;
    b.title = L + (L === 1 ? ' digit' : ' digits');
    b.setAttribute('aria-pressed', 'true');
    lenWrap.appendChild(b);
  }
  lenWrap.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.an-len');
    if (!b) return;
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
    scheduleFilter();
  });

  // EP score range: keep only numbers whose total EP is more than min and/or less than max.
  // Blank or non-numeric means that bound is open. Re-filters instantly (no recompute).
  epMinEl.addEventListener('input', scheduleFilter);
  epMaxEl.addEventListener('input', scheduleFilter);
  function epBounds() {
    const p = el => { const v = parseFloat(el.value); return Number.isFinite(v) && v >= 0 ? v : null; };
    return { min: p(epMinEl), max: p(epMaxEl) };
  }

  function buildBadgeList(filter) {
    const f = (filter || '').toLowerCase();
    badgeList.innerHTML = '';
    meta.forEach((b, i) => {
      if (f && !(b.label.toLowerCase().includes(f) || b.rarity.toLowerCase().includes(f))) return;
      const doOn = selectedBadges.has(i), dontOn = excludedBadges.has(i);
      const row = document.createElement('div');
      row.className = 'an-badge';
      row.innerHTML = '<span class="an-tri" data-bi="' + i + '">' +
          '<button type="button" data-act="do" class="' + (doOn ? 'on' : '') + '" title="Require this badge">✓</button>' +
          '<button type="button" data-act="dont" class="' + (dontOn ? 'on' : '') + '" title="Exclude this badge">✕</button>' +
        '</span><span class="an-badge-name">' + b.emoji + ' ' + esc(b.label) + '</span><em>' + esc(b.rarity) + '</em>';
      badgeList.appendChild(row);
    });
  }
  badgeSearch.addEventListener('input', () => buildBadgeList(badgeSearch.value));
  // Each badge is tri-state: neutral, require (✓), or exclude (✕). The two are mutually
  // exclusive - turning one on clears the other; clicking an active button returns to neutral.
  badgeList.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.an-tri button');
    if (!btn) return;
    const i = +btn.parentElement.getAttribute('data-bi');
    if (btn.getAttribute('data-act') === 'do') {
      if (selectedBadges.has(i)) selectedBadges.delete(i);
      else { selectedBadges.add(i); excludedBadges.delete(i); }
    } else {
      if (excludedBadges.has(i)) excludedBadges.delete(i);
      else { excludedBadges.add(i); selectedBadges.delete(i); }
    }
    buildBadgeList(badgeSearch.value);
    renderSelected();
    scheduleFilter();
  });
  function chipsFor(set, kind) {
    return [...set].map(i => '<span class="an-chip an-chip-' + kind + '" data-bi="' + i + '">' +
      meta[i].emoji + ' ' + esc(meta[i].label) + ' &times;</span>').join(' ');
  }
  function renderSelected() {
    const sel = $('an-badge-sel');
    if (!selectedBadges.size && !excludedBadges.size) { sel.innerHTML = ''; return; }
    let html = '';
    if (selectedBadges.size) html += '<div>Must earn: ' + chipsFor(selectedBadges, 'do') + '</div>';
    if (excludedBadges.size) html += '<div>Must <em>not</em> earn: ' + chipsFor(excludedBadges, 'dont') + '</div>';
    sel.innerHTML = html;
  }
  $('an-badge-sel').addEventListener('click', e => {
    const chip = e.target.closest && e.target.closest('.an-chip');
    if (!chip) return;
    const i = +chip.getAttribute('data-bi');
    selectedBadges.delete(i); excludedBadges.delete(i);
    renderSelected(); buildBadgeList(badgeSearch.value); scheduleFilter();
  });

  // Purge the locally cached 1M sweep and recompute from scratch.
  purgeBtn.addEventListener('click', () => {
    if (!worker) worker = makeWorker();
    purgeBtn.disabled = true;
    computing = true; computed = false; setExportEnabled(false);
    chartEl.innerHTML = ''; statsEl.innerHTML = '';
    setBusy('Purging cached data…');
    worker.postMessage({ cmd: 'purgeCache' });
  });

  btn.addEventListener('click', () => {
    panel.hidden = false;
    if (!worker) worker = makeWorker();
    if (!computed && !computing) runCompute();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('an-export-examples').addEventListener('click', () => { if (computed) worker.postMessage({ cmd: 'exportExamples' }); });
  $('an-export-csv').addEventListener('click', () => { if (computed) { const ep = epBounds(); worker.postMessage({ cmd: 'exportFilter', badges: [...selectedBadges], exclude: [...excludedBadges], lengths: selectedLengths(), epMin: ep.min, epMax: ep.max }); } });

  function setExportEnabled(on) { $('an-export-examples').disabled = !on; $('an-export-csv').disabled = !on; }
  setExportEnabled(false);

  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Status helpers: a centered spinner + message while busy; plain left-aligned text otherwise.
  // setBusyText only swaps the label so the spinner keeps spinning smoothly across progress ticks.
  function setBusy(msg) {
    statusEl.className = 'computing';
    statusEl.innerHTML = '<span class="an-spinner"></span><span class="an-ctext"></span>';
    statusEl.querySelector('.an-ctext').textContent = msg;
  }
  function setBusyText(msg) { const t = statusEl.querySelector('.an-ctext'); if (t) t.textContent = msg; else setBusy(msg); }
  function setStatus(msg) { statusEl.className = ''; statusEl.textContent = msg; }

  function runCompute(force) {
    if (!worker) worker = makeWorker();
    computing = true; computed = false; setExportEnabled(false); purgeBtn.disabled = true;
    chartEl.innerHTML = ''; statsEl.innerHTML = '';
    setBusy(force ? 'Recomputing every number 0-1,000,000…' : 'Computing every number 0-1,000,000…');
    // One exhaustive sweep of every number; the worker reuses a cached copy when fresh.
    // `force` skips the cache (used after a purge). Length selection is an instant filter.
    worker.postMessage({ cmd: 'compute', force: !!force });
  }

  let filterTimer = null;
  function scheduleFilter() { if (!computed) return; clearTimeout(filterTimer); filterTimer = setTimeout(runFilter, 60); }
  function selectedLengths() { const out = []; for (let L = 1; L <= 7; L++) { const b = $('an-len-' + L); if (b && b.classList.contains('on')) out.push(L); } return out; }
  function runFilter() { const ep = epBounds(); worker.postMessage({ cmd: 'filter', badges: [...selectedBadges], exclude: [...excludedBadges], lengths: selectedLengths(), epMin: ep.min, epMax: ep.max }); }

  function computedStatus(m) {
    let s = 'Analyzed all ' + m.domainTrue.toLocaleString() + ' numbers (every number, all lengths)';
    if (m.cached) {
      const mins = Math.max(0, Math.round((Date.now() - m.ts) / 60000));
      const age = mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' hr';
      s += ' - loaded from local cache (' + age + ' old).';
    } else s += ' - freshly computed and cached for 1 day.';
    return s;
  }

  function onMsg(e) {
    const m = e.data;
    if (m.type === 'meta') { meta = m.badges; buildBadgeList(''); }
    else if (m.type === 'progress') { setBusyText('Computing every number 0-1,000,000… ' + Math.round(m.pct * 100) + '%'); }
    else if (m.type === 'computed') {
      computing = false; computed = true; setExportEnabled(true); purgeBtn.disabled = false;
      setStatus(computedStatus(m));
      runFilter();
    }
    else if (m.type === 'purged') { runCompute(true); }
    else if (m.type === 'histogram') { renderChart(m.buckets, m.stats); }
    else if (m.type === 'examples') { exportExamplesFile(m); }
    else if (m.type === 'filterRows') { exportCsvFile(m); }
    else if (m.type === 'error') { setStatus('Error: ' + m.message); computing = false; purgeBtn.disabled = false; }
  }

  function exportExamplesFile(m) {
    const lines = [];
    lines.push('# RNGdle - example numbers for each badge');
    lines.push('# Columns: number, totalEP   (up to ' + (m.badges[0] ? Math.max(...m.badges.map(b => b.items.length)) : 0) + ' examples per badge)');
    lines.push('# Drawn from: every number 0..1,000,000 (all lengths)');
    lines.push('');
    for (const b of m.badges) {
      lines.push('== ' + b.emoji + ' ' + b.label + ' (' + b.rarity + ') ==');
      if (!b.items.length) { lines.push('  (no example found in the analyzed set)'); }
      else for (const [n, ep] of b.items) lines.push('  ' + String(n).padEnd(8) + ' ' + Math.round(ep).toLocaleString() + ' EP');
      lines.push('');
    }
    download('rngdle-badge-examples.txt', lines.join('\n'), 'text/plain');
  }

  function exportCsvFile(m) {
    const picked = [...selectedBadges].map(i => meta[i].label);
    const banned = [...excludedBadges].map(i => meta[i].label);
    const head = ['number,totalEP'];
    const body = m.rows.map(r => r[0] + ',' + Math.round(r[1]));
    const note = m.capped ? '\n# (truncated to ' + m.rows.length.toLocaleString() + ' rows)' : '';
    const slug = picked.concat(banned.map(l => 'no-' + l)).join('+').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const fname = 'rngdle-' + (slug || 'numbers') + '.csv';
    const ep = epBounds();
    let desc = 'all analyzed numbers';
    if (picked.length || banned.length) {
      const parts = [];
      if (picked.length) parts.push('earning: ' + picked.join(' + '));
      if (banned.length) parts.push('NOT earning: ' + banned.join(', '));
      desc = 'numbers ' + parts.join('; ');
    }
    let epDesc = '';
    if (ep.min != null && ep.max != null) epDesc = ' with EP between ' + ep.min.toLocaleString() + ' and ' + ep.max.toLocaleString();
    else if (ep.min != null) epDesc = ' with EP > ' + ep.min.toLocaleString();
    else if (ep.max != null) epDesc = ' with EP < ' + ep.max.toLocaleString();
    download(fname, '# ' + desc + epDesc + note + '\n' + head.concat(body).join('\n'), 'text/csv');
  }

  function renderChart(buckets, stats) {
    if (!stats.total) {
      chartEl.innerHTML = '<p class="an-empty">No numbers match these filters.</p>';
      statsEl.innerHTML = '';
      return;
    }
    // Trim empty buckets on BOTH ends so the axis spans only where numbers actually exist -
    // EP is never 0 and the lowest scores sit well above 1, so the bottom decades are all empty.
    let first = -1, last = 0;
    for (let i = 0; i < buckets.length; i++) if (buckets[i].count > 0) { if (first < 0) first = i; last = i; }
    if (first < 0) first = 0;
    const bs = buckets.slice(first, last + 1);
    const maxCount = Math.max(...bs.map(b => b.count));
    const W = 720, H = 320, padL = 48, padR = 12, padT = 14, padB = 60;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const nb = bs.length, bw = plotW / nb;
    const logTop = Math.log10(maxCount) + 1;                  // log y-scale (counts span decades)
    const yOf = c => c > 0 ? padT + plotH - ((Math.log10(c) + 1) / logTop) * plotH : padT + plotH;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="EP distribution histogram">';
    // y gridlines + labels at powers of ten
    for (let p = 1; p <= maxCount; p *= 10) {
      const y = yOf(p);
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#24262d"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" fill="#8b8e97" font-size="10" text-anchor="end">' + fmt(p) + '</text>';
    }
    // bars
    const tickEvery = Math.ceil(nb / 16);
    bs.forEach((b, i) => {
      const x = padL + i * bw, y = yOf(b.count), h = padT + plotH - y;
      const label = b.i === 0 ? '0 EP' : fmt(b.lo) + '-' + fmt(b.hi) + ' EP';
      const pct = (b.count / stats.total * 100);
      const fill = b.i === 0 ? '#4a4d55' : '#7aa2ff';
      svg += '<rect x="' + (x + 1).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0, bw - 2).toFixed(1) +
        '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + fill + '" rx="1">' +
        '<title>' + esc(label) + ': ' + Math.round(b.count).toLocaleString() + ' numbers (' + pct.toFixed(pct < 1 ? 2 : 1) + '%)</title></rect>';
      if (i % tickEvery === 0) {
        const lx = x + bw / 2, ly = padT + plotH + 12;
        const lab = b.i === 0 ? '0' : fmt(b.lo);
        svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#8b8e97" font-size="10" text-anchor="end" transform="rotate(-45 ' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ')">' + lab + '</text>';
      }
    });
    svg += '<text x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" fill="#8b8e97" font-size="11" text-anchor="middle">Total EP (log scale) - bar height = count (log scale)</text>';
    svg += '</svg>';
    chartEl.innerHTML = svg;

    statsEl.innerHTML =
      stat('Matching', (stats.estimated ? '≈' : '') + stats.total.toLocaleString()) +
      stat('Mean EP', Math.round(stats.mean).toLocaleString()) +
      stat('Min EP', Math.round(stats.min).toLocaleString()) +
      stat('Max EP', Math.round(stats.max).toLocaleString()) +
      (stats.estimated ? '<p class="an-note">≈ counts scaled to the full 0-999,999 range from the 6-digit sample (' + stats.raw.toLocaleString() + ' numbers actually scanned).</p>' : '');
  }
  function stat(k, v) { return '<div class="an-stat"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const RARITY_COLORS = {
  Mythic: '#ff4d6d', Anomaly: '#c77dff', Epic: '#9d4edd',
  Rare: '#4895ef', Uncommon: '#52b788', Common: '#adb5bd',
};

// --- Beta renderer: overall-number rarity tier ----------------------------
// Card tier is percentile-driven on rngdle.com; the EP cutoffs below are the
// exact boundaries derived from its shipped percentile table (test/rngdle-dump/
// SCORE_PERCENTILES.json -> percentiles 1/50/75/90/95/99). Palette colours are
// the rngdle.com RARITY_PALETTE highlight accents.
const CARD_TIERS = [
  [2050, 'trash'], [5349, 'common'], [8642, 'uncommon'],
  [20245, 'rare'], [33971, 'epic'], [150679, 'anomaly'],
]; // >= 150679 -> mythic
function cardTier(ep) { for (const [t, name] of CARD_TIERS) if (ep < t) return name; return 'mythic'; }
// accent = RARITY_PALETTE.highlight.border (saturated); hl = highlight.primary
// (lighter fill used to light up digits). Both lifted verbatim from rngdle.com.
const TIER_PALETTE = {
  trash:    { accent: '#7C5A2E', hl: '#C8A87C', glow: 'rgba(124,90,46,.35)',  label: 'TRASH' },
  common:   { accent: '#6B7280', hl: '#D1D5DB', glow: 'rgba(107,114,128,.30)', label: 'COMMON' },
  uncommon: { accent: '#059669', hl: '#6EE7B7', glow: 'rgba(5,150,105,.40)',  label: 'UNCOMMON' },
  rare:     { accent: '#2563EB', hl: '#93C5FD', glow: 'rgba(37,99,235,.45)',  label: 'RARE' },
  epic:     { accent: '#7C3AED', hl: '#C4B5FD', glow: 'rgba(124,58,237,.50)', label: 'EPIC' },
  anomaly:  { accent: '#EA580C', hl: '#FDBA74', glow: 'rgba(234,88,12,.50)',  label: 'ANOMALY' },
  mythic:   { accent: '#DB2777', hl: '#F9A8D4', glow: 'rgba(219,39,119,.55)', label: 'MYTHIC' },
};

// Escape text for safe insertion into HTML (attribute values and text content).
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseN(raw) {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return NaN;
  const n = parseInt(raw.trim(), 10);
  if (n < 0 || n > 1000000) return NaN;
  return n;
}

// A few rngdle.com badges score on a number but their getContributors returns
// nothing (the highlight logic is narrower than the check): "Pair" only resolves
// a digit appearing exactly twice (so 12131's triple-1 highlights nothing), and
// "Snake Eyes" only resolves adjacent "11" (so 101's split 1s highlight nothing).
// Fall back to the digits that actually justify the badge so something lights up.
function fallbackCells(label, s) {
  const l = label.toLowerCase();
  if (l === 'snake eyes') {
    const idx = []; for (let i = 0; i < s.length; i++) if (s[i] === '1') idx.push(i); return idx;
  }
  if (l === 'pair') {
    const counts = {}; for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    for (let i = 0; i < s.length; i++) if (counts[s[i]] >= 2) {
      const occ = []; for (let j = 0; j < s.length; j++) if (s[j] === s[i]) occ.push(j);
      return occ.slice(0, 2); // show "a pair": the first two matching digits
    }
  }
  return [];
}

// Beta renderer: rngdle.com-style card. The number lives in an editable card you
// click into and type; the digits are spans so a badge can light up the exact
// positions it scores on. The pieces below are split so the live /beta endpoint
// can re-render the number + output as you type without rebuilding the input.
const BETA_PLACEHOLDER = '??????';

function betaTier(result) {
  if (!result) return { tier: 'empty', pal: { accent: '#3a3e49', glow: 'rgba(0,0,0,0)', label: '' } };
  const tier = cardTier(result.totalEP);
  return { tier, pal: TIER_PALETTE[tier] };
}

// The digit row (or the ?????? placeholder when nothing is entered).
function betaNumberHTML(s) {
  if (!s) return `<span class="bn-ph">${BETA_PLACEHOLDER}</span>`;
  return [...s].map((d, i) => `<span class="bn-d" data-i="${i}">${d}</span>`).join('');
}

// Everything below the card: tier pill + percentile + EP, then the badge pills.
function betaOutHTML(result) {
  if (!result) return '';
  const s = String(result.number);
  const contrib = prodContributors(result.number);
  const { pal } = betaTier(result);

  const scoring = result.badges.filter(b => b.ep > 0).slice().sort((a, b) => b.ep - a.ep);
  const pills = scoring.map(b => {
    let cells = contrib[b.label.toLowerCase()] || [];
    if (!cells.length) cells = fallbackCells(b.label, s);
    // Pill border + digit-highlight colours come from rngdle.com's RARITY_PALETTE,
    // keyed by this badge's own rarity tier (so anomaly reads orange, epic purple, etc.).
    const pal2 = TIER_PALETTE[b.rarity.toLowerCase()] || TIER_PALETTE.common;
    const req = b.desc || 'No description.';
    const tip = esc(`${req}\n${b.rarity} · ${fmtProb(b.prob)} earn this · +${b.ep.toLocaleString()} EP`);
    return `<button type="button" class="bn-b" style="--bc:${pal2.accent}"
       data-cells="${cells.join(',')}" data-hl="${pal2.hl}" data-tip="${tip}"
       aria-label="${esc(b.label)}. ${tip}">${b.emoji} <span>${esc(b.label)}</span> <em>+${b.ep.toLocaleString()}</em></button>`;
  }).join('');

  // Exact percentile from rngdle.com's shipped table: % of all numbers 0..1,000,000
  // that score at or below this EP.
  const pr = exactPercentile(result.totalEP);
  const prTxt = pr <= 0 ? '' :
    pr >= 99.5 ? 'TOP &lt;1%' :
    pr >= 50 ? `TOP ${Math.max(Math.round(100 - pr), 1)}%` :
    `BOTTOM ${Math.max(Math.round(pr), 1)}%`;

  return `
    <div class="bn-meta">
      <span class="bn-pill">${pal.label}</span>
      ${prTxt ? `<span class="bn-pct" title="exact percentile of all numbers 0-1,000,000 by EP">${prTxt}</span>` : ''}
      <span class="bn-ep">${result.totalEP.toLocaleString()} EP</span>
    </div>
    <div class="bn-sub">${result.count} badge${result.count === 1 ? '' : 's'} · hover a badge to see where it scores</div>
    <div class="bn-badges">${pills}</div>`;
}

// JSON the /beta endpoint returns so the client can update live without a reload.
function betaData(result, n) {
  const { tier, pal } = betaTier(result);
  return { number: n, tier, accent: pal.accent, glow: pal.glow,
    numberHTML: betaNumberHTML(result ? String(n) : ''), outHTML: betaOutHTML(result) };
}

function renderBeta(result) {
  const s = result ? String(result.number) : '';
  const { tier, pal } = betaTier(result);
  return `
    <div class="bn" id="bn" data-tier="${tier}" style="--accent:${pal.accent};--glow:${pal.glow}">
      <div class="bn-card" id="bn-card" title="Click and type a number">
        <div class="bn-number" id="bn-number" data-len="${s.length || 6}">${betaNumberHTML(s)}</div>
        <input id="bn-input" class="bn-input" type="text" inputmode="numeric" autocomplete="off"
               spellcheck="false" maxlength="7" aria-label="Enter a number from 0 to 1,000,000"
               value="${s}">
      </div>
      <div class="bn-out" id="bn-out">${betaOutHTML(result)}</div>
    </div>`;
}

function renderHTML(result) {
  // The click-to-type number card is the one and only renderer.
  const body = renderBeta(result);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RNGdle EP Calculator</title>
<style>
  :root {
    color-scheme: dark;
    --bg:#0b0c0e; --surface:#131419; --surface-2:#181a20; --border:#24262d; --border-2:#30333c;
    --text:#e7e8ea; --muted:#8b8e97; --faint:#595c65; --accent:#7aa2ff; --accent-soft:#1a2336;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg);
    color:var(--text); margin:0; padding:3.5rem 1.25rem 4rem; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:660px; margin:0 auto; }

  h1 { font-size:1.45rem; font-weight:600; letter-spacing:-.02em; margin:0 0 .3rem; }
  p.tag { color:var(--muted); margin:0 0 2rem; font-size:.92rem; }

  input { font-size:1.05rem; padding:.65rem .8rem; border-radius:8px; border:1px solid var(--border);
    background:var(--surface); color:var(--text); font-variant-numeric:tabular-nums; }
  input::placeholder { color:var(--faint); }
  input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  button { font-size:.92rem; padding:.65rem 1.1rem; border-radius:8px; cursor:pointer; font-weight:500;
    border:1px solid var(--border-2); background:var(--surface-2); color:var(--text);
    transition:background .12s, border-color .12s, opacity .12s; }
  button:hover { background:#20232c; border-color:#3a3e49; }
  .grid-btn { display:inline-flex; align-items:center; gap:.45rem; text-decoration:none;
    font-size:.92rem; font-weight:500; padding:.65rem 1.1rem; border-radius:8px;
    border:1px solid var(--border-2); background:var(--surface-2); color:var(--text);
    transition:background .12s, border-color .12s; }
  .grid-btn:hover { background:#20232c; border-color:#3a3e49; }
  footer { margin-top:2.5rem; color:var(--faint); font-size:.8rem; }
  footer code { color:var(--muted); font-family:var(--mono); }
  a { color:var(--accent); }

  /* --- Analysis panel --- */
  .an-bar { margin:2rem 0 1.5rem; }
  #an-btn { width:100%; padding:.7rem; font-weight:500; }
  #analysis { border:1px solid var(--border); border-radius:10px; padding:1.1rem 1.15rem 1.3rem; margin-bottom:1.5rem; }
  #analysis h2 { font-size:1.05rem; font-weight:600; letter-spacing:-.01em; margin:0 0 1rem; }
  .an-controls { display:flex; flex-wrap:wrap; align-items:flex-start; gap:1rem; margin-bottom:1rem; }
  .an-controls fieldset { border:1px solid var(--border); border-radius:8px; padding:.55rem .7rem .7rem; margin:0; min-width:200px; flex:1; }
  .an-controls legend { color:var(--faint); font-size:.68rem; text-transform:uppercase; letter-spacing:.07em; padding:0 .35rem; font-weight:600; }
  .an-controls .an-badges-fs { flex:2 1 300px; min-width:260px; }
  /* Left column: number length on top, EP score range below it. */
  .an-col-left { display:flex; flex-direction:column; gap:1rem; flex:1 1 210px; min-width:210px; }
  .an-col-left fieldset { flex:0 0 auto; min-width:0; }
  .an-len-fs { display:flex; flex-direction:column; }
  #an-lengths { display:grid; grid-template-columns:repeat(7, 1fr); gap:.35rem; }
  .an-ep-row { display:flex; flex-direction:column; gap:.5rem; }
  .an-ep-row label { display:flex; align-items:center; justify-content:space-between; gap:.6rem; font-size:.82rem; color:var(--muted); white-space:nowrap; }
  .an-ep-row input { width:7.5rem; flex:0 0 auto; font-size:.85rem; padding:.34rem .5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-variant-numeric:tabular-nums; }
  .an-ep-row input:focus { outline:none; border-color:var(--accent); }
  .an-len { display:flex; align-items:center; justify-content:center; padding:.2rem 0;
    font-size:1.5rem; font-weight:700; font-variant-numeric:tabular-nums;
    border:none; background:none; color:var(--text); cursor:pointer; line-height:1;
    transition:opacity .15s, color .15s, text-shadow .15s; }
  .an-len:not(.on) { opacity:.28; }
  .an-len:hover { opacity:1; }
  .an-len.on { color:#cdd9ff; text-shadow:0 0 16px rgba(122,162,255,.95), 0 0 6px rgba(122,162,255,.85); }
  .an-badge { display:flex; align-items:center; gap:.4rem; font-size:.85rem; cursor:pointer; }
  #an-badge-search { width:100%; font-size:.85rem; padding:.4rem .55rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); margin-bottom:.45rem; }
  #an-badge-search:focus { outline:none; border-color:var(--accent); }
  .an-badge-list { max-height:150px; overflow:auto; display:flex; flex-direction:column; gap:.1rem; padding-right:.3rem; }
  .an-badge { justify-content:flex-start; padding:.12rem .25rem; border-radius:5px; cursor:default; }
  .an-badge:hover { background:var(--surface-2); }
  .an-badge-name { flex:1; min-width:0; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .an-badge em { flex:0 0 auto; text-align:right; color:var(--faint); font-style:normal; font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; }
  .an-tri { flex:0 0 auto; display:inline-flex; }
  .an-tri button { font-size:.72rem; line-height:1; padding:.12rem .34rem; border:1px solid var(--border-2);
    background:var(--surface-2); color:var(--faint); cursor:pointer; }
  .an-tri button:first-child { border-radius:4px 0 0 4px; }
  .an-tri button:last-child { border-radius:0 4px 4px 0; border-left:none; }
  .an-tri button:hover { color:var(--text); }
  .an-tri button[data-act="do"].on { background:#1d6b3f; border-color:#2c9b58; color:#fff; }
  .an-tri button[data-act="dont"].on { background:#7a2230; border-color:#b3344a; color:#fff; }
  .an-badge-sel { margin-top:.55rem; font-size:.78rem; color:var(--muted); line-height:1.9; }
  .an-badge-sel em { font-style:normal; font-weight:600; color:#e88; }
  .an-chip { display:inline-block; border:1px solid var(--border-2); color:var(--text); padding:.08rem .5rem; border-radius:999px; cursor:pointer; font-size:.78rem; }
  .an-chip:hover { border-color:#444a57; background:var(--surface-2); }
  .an-chip-do { border-color:#2c9b58; }
  .an-chip-dont { border-color:#b3344a; }
  .an-actions .an-purge-btn { margin-left:auto; background:transparent; border:1px solid var(--border-2); color:var(--muted); }
  .an-actions .an-purge-btn:hover:not(:disabled) { border-color:#b3344a; color:#e88; }
  #an-status { color:var(--muted); font-size:.85rem; min-height:1.2em; margin:.3rem 0 .7rem; }
  #an-status.computing { display:flex; align-items:center; justify-content:center; gap:.55rem; color:var(--text); font-size:.95rem; padding:1.1rem 0 .9rem; }
  .an-spinner { width:1.05em; height:1.05em; flex:0 0 auto; border:2px solid var(--border-2); border-top-color:var(--accent); border-radius:50%; animation:an-spin .7s linear infinite; }
  @keyframes an-spin { to { transform:rotate(360deg); } }
  #an-chart svg { background:var(--bg); border:1px solid var(--border); border-radius:8px; }
  .an-empty { color:var(--muted); text-align:center; padding:1.5rem; }
  #an-stats { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:.9rem; }
  .an-stat { border:1px solid var(--border); border-radius:8px; padding:.5rem .7rem; flex:1; min-width:110px; }
  .an-stat span { display:block; color:var(--faint); font-size:.66rem; text-transform:uppercase; letter-spacing:.06em; margin-bottom:.15rem; }
  .an-stat strong { color:var(--text); font-size:1.05rem; font-family:var(--mono); font-weight:600; font-variant-numeric:tabular-nums; }
  .an-note { flex-basis:100%; color:var(--muted); font-size:.75rem; margin:.3rem 0 0; }
  .an-actions { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:1rem; }
  .an-actions button { font-size:.85rem; padding:.5rem .9rem; }
  .an-actions button:disabled { opacity:.4; cursor:not-allowed; }

  /* --- Top bar: "not affiliated" disclaimer + beta toggle (top-right) --- */
  .topbar { position:fixed; top:0; left:0; right:0; z-index:50; display:flex; align-items:center; justify-content:center;
    padding:.4rem .8rem; background:#120d05; border-bottom:1px solid #3a2e10; }
  .disclaimer { text-align:center; color:#e9c46a; font-size:.76rem; letter-spacing:.01em; }
  .disclaimer strong { color:#f4d58d; }

  /* --- Number card (rngdle.com-style, click-to-type) --- */
  .bn { margin-bottom:1.5rem; }
  .bn-card { position:relative; display:flex; justify-content:center; align-items:center; min-height:6.4rem;
    padding:1.6rem 1rem; border-radius:16px; border:2px solid var(--accent); cursor:text;
    background:radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%), var(--surface);
    box-shadow:0 0 26px var(--glow), inset 0 0 30px color-mix(in srgb, var(--accent) 10%, transparent);
    transition:border-color .25s, box-shadow .25s; }
  .bn-card:focus-within { box-shadow:0 0 30px var(--glow), 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent), inset 0 0 30px color-mix(in srgb, var(--accent) 12%, transparent); }
  /* Transparent input overlays the card: clicking anywhere focuses it, typing drives the digits. */
  .bn-input { position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0; border:0; border-radius:16px;
    background:transparent; color:transparent; caret-color:var(--accent); text-align:center; cursor:text;
    font-family:var(--mono); font-weight:700; letter-spacing:.08em; font-size:clamp(2.4rem, 11vw, 4rem); }
  .bn-input:focus { outline:none; }
  .bn-number { display:flex; gap:.06em; font-family:var(--mono); font-weight:700; letter-spacing:.02em;
    font-size:clamp(2.4rem, 11vw, 4rem); line-height:1; pointer-events:none; }
  .bn-number[data-len="1"], .bn-number[data-len="2"], .bn-number[data-len="3"] { font-size:4rem; }
  .bn-ph { color:var(--faint); letter-spacing:.18em; }
  .bn-d { display:inline-block; padding:0 .05em; border-radius:8px; transition:background .12s, color .12s, box-shadow .12s, transform .12s; }
  .bn-d.hl { background:var(--hc,#fff); color:#0b0c0e; box-shadow:0 0 14px var(--hc,#fff); transform:translateY(-2px); }
  .bn[data-tier="empty"] .bn-card { border-style:dashed; }
  .bn[data-tier="empty"] .bn-pill { display:none; }
  .bn-meta { display:flex; align-items:center; justify-content:center; gap:.55rem; margin-top:1rem; flex-wrap:wrap; }
  .bn-pill { font-size:.72rem; font-weight:700; letter-spacing:.1em; padding:.18rem .6rem; border-radius:999px;
    color:var(--accent); border:1px solid var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .bn-pct { font-size:.82rem; color:var(--accent); font-weight:600; }
  .bn-ep { font-family:var(--mono); font-weight:600; font-variant-numeric:tabular-nums; color:var(--text); font-size:1.05rem; }
  .bn-sub { text-align:center; color:var(--muted); font-size:.8rem; margin-top:.4rem; }
  .bn-badges { display:flex; flex-wrap:wrap; gap:.45rem; justify-content:center; margin-top:1.2rem; }
  .bn-b { position:relative; display:inline-flex; align-items:center; gap:.35rem; font-size:.8rem; font-weight:500;
    padding:.28rem .6rem; border-radius:999px; cursor:pointer; color:var(--text);
    border:1px solid color-mix(in srgb, var(--bc) 55%, var(--border-2)); background:var(--surface-2); transition:background .12s, border-color .12s; }
  .bn-b:hover, .bn-b:focus-visible { outline:none; border-color:var(--bc); background:color-mix(in srgb, var(--bc) 16%, var(--surface-2)); }
  .bn-b em { font-style:normal; font-family:var(--mono); font-size:.72rem; color:var(--muted); }
  .bn-b::after { content:attr(data-tip); white-space:pre-line; position:absolute; left:50%; transform:translateX(-50%);
    bottom:calc(100% + 8px); min-width:13rem; max-width:18rem; padding:.5rem .65rem; border-radius:8px; background:#06070a;
    border:1px solid var(--border-2); box-shadow:0 8px 24px rgba(0,0,0,.6); font-size:.75rem; font-weight:450; line-height:1.4;
    text-align:left; color:var(--text); opacity:0; pointer-events:none; transition:opacity .12s; z-index:10; }
  .bn-b:hover::after, .bn-b:focus-visible::after { opacity:1; }
  .bn-badges .none { color:var(--muted); }
</style></head>
<body>
  <div class="topbar">
    <div class="disclaimer">This site is not affiliated with <strong>rngdle.com</strong>. Scoring is reverse-engineered.</div>
  </div>
  <div class="wrap">
  <h1>RNGdle EP Calculator</h1>
  <p class="tag">Click the box and type a number from 0 to 1,000,000 to see its EP and badges.</p>
  ${body}

  <div class="an-bar"><button type="button" id="an-btn">Analyze all scores</button></div>

  <section id="analysis" hidden>
    <h2>EP distribution across 0-1,000,000</h2>
    <div class="an-controls">
      <div class="an-col-left">
        <fieldset class="an-len-fs">
          <legend>Number length</legend>
          <div id="an-lengths"></div>
        </fieldset>
        <fieldset class="an-ep-fs">
          <legend>EP score range</legend>
          <div class="an-ep-row">
            <label>Scores more than <input id="an-ep-min" type="number" min="0" step="1" placeholder="any" inputmode="numeric"></label>
            <label>and less than <input id="an-ep-max" type="number" min="0" step="1" placeholder="any" inputmode="numeric"></label>
          </div>
        </fieldset>
      </div>
      <fieldset class="an-badges-fs">
        <legend>Badges: require ✓ / exclude ✕</legend>
        <input id="an-badge-search" type="text" placeholder="filter badges…" autocomplete="off">
        <div id="an-badge-list" class="an-badge-list"></div>
        <div id="an-badge-sel" class="an-badge-sel"></div>
      </fieldset>
    </div>
    <div id="an-status"></div>
    <div id="an-chart"></div>
    <div id="an-stats"></div>
    <div class="an-actions">
      <button type="button" id="an-export-csv">Matching numbers (.csv)</button>
      <button type="button" id="an-export-examples">Examples per badge (.txt)</button>
      <button type="button" id="an-purge" class="an-purge-btn">Purge cache</button>
    </div>
  </section>

  <div class="an-bar"><a class="grid-btn" href="/grid">🗺️ Explore all 1,000,000 numbers &rarr;</a></div>

  <footer>JSON API: <code>/api?n=696969</code></footer>
</div>
<script>
// The click-to-type number card: digits light up where each badge scores,
// and typing fetches /beta to re-render the tier colour + badge pills live.
(function () {
  var bn = document.getElementById('bn');
  var input = document.getElementById('bn-input');
  var numEl = document.getElementById('bn-number');
  var outEl = document.getElementById('bn-out');
  if (input) input.focus();

  // per-digit highlighting (re-wired after every live render)
  var digits = [];
  function refreshDigits() { digits = [].slice.call(numEl.querySelectorAll('.bn-d')); }
  function highlight(cells, color) {
    digits.forEach(function (d) {
      var on = cells.indexOf(Number(d.dataset.i)) !== -1;
      d.classList.toggle('hl', on);
      if (on && color) d.style.setProperty('--hc', color); else d.style.removeProperty('--hc');
    });
  }
  function clearHl() { digits.forEach(function (d) { d.classList.remove('hl'); d.style.removeProperty('--hc'); }); }
  function wireBadges() {
    [].slice.call(outEl.querySelectorAll('.bn-b')).forEach(function (b) {
      var cells = (b.dataset.cells || '').split(',').filter(Boolean).map(Number);
      var color = (b.dataset.hl || '').trim() || '#fff';
      b.addEventListener('mouseenter', function () { highlight(cells, color); });
      b.addEventListener('mouseleave', clearHl);
      b.addEventListener('focus', function () { highlight(cells, color); });
      b.addEventListener('blur', clearHl);
    });
  }
  refreshDigits(); wireBadges();

  // --- click-to-type live editing ---
  if (input) {
    var card = document.getElementById('bn-card');
    if (card) card.addEventListener('mousedown', function (e) { if (e.target !== input) { e.preventDefault(); input.focus(); } });

    function setNumber(v) {
      numEl.dataset.len = v ? v.length : 6;
      numEl.innerHTML = v
        ? v.split('').map(function (d, i) { return '<span class="bn-d" data-i="' + i + '">' + d + '</span>'; }).join('')
        : '<span class="bn-ph">??????</span>';
      refreshDigits();
    }

    var timer;
    function onInput() {
      var v = input.value.replace(/\D/g, '');
      if (v.length > 1) v = v.replace(/^0+/, '') || '0';   // no leading zeros
      if (Number(v) > 1000000) v = '1000000';
      if (v !== input.value) input.value = v;
      setNumber(v);                                         // instant digit feedback
      clearTimeout(timer);
      if (!v) {                                             // empty -> ?????? placeholder
        bn.dataset.tier = 'empty';
        bn.style.setProperty('--accent', '#3a3e49');
        bn.style.setProperty('--glow', 'rgba(0,0,0,0)');
        outEl.innerHTML = '';
        return;
      }
      timer = setTimeout(function () {                      // debounced score lookup
        var q = v;
        fetch('/beta?n=' + q).then(function (r) { return r.json(); }).then(function (d) {
          if (input.value.replace(/\D/g, '') !== q) return; // stale response
          bn.dataset.tier = d.tier;
          bn.style.setProperty('--accent', d.accent);
          bn.style.setProperty('--glow', d.glow);
          numEl.innerHTML = d.numberHTML; refreshDigits();
          outEl.innerHTML = d.outHTML; wireBadges();
          if (history.replaceState) history.replaceState(null, '', '/?n=' + q);
        }).catch(function () {});
      }, 140);
    }
    input.addEventListener('input', onInput);
  }
})();
</script>
<script type="module">
// __name no-op shim: when bundled (esbuild keepNames), the serialized client/worker source
// below references a __name() helper that only exists in the bundled Worker scope. Redefine
// it here (page context) and inside the worker blob so the source runs standalone.
var __name = (f) => f;
const __WORKER_SRC = ${JSON.stringify('var __name=(f)=>f;(' + analysisWorker.toString() + ')()')};
(${analysisClient.toString()})(__WORKER_SRC);
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// /grid - interactive 1,000,000-number map
//
// One pixel per number on a 1000x1000 canvas (number n at x = n % 1000,
// y = floor(n / 1000)). The default /grid view is a monochrome badge-COUNT
// heatmap; picking a badge from the list switches to its membership map (which
// numbers earn it), computed from the same engine.js sweep - no images needed.
// The sweep (per-number count + packed earned-badge bitmask) runs once in a Web
// Worker and is cached in IndexedDB, so reloads and badge switches are instant.
// Zoom/pan the canvas, hover for details, click a cell to open it on /.
// ---------------------------------------------------------------------------

function gridWorker() {
  let E = null, origin = '';
  let counts = null, bits = null, epArr = null, ROW = 0, cmin = 0, cmax = 0, emin = 0, emax = 0;
  const DB = 'rngdle-grid', STORE = 'ds', KEY = 'sweep';
  function idbStore(mode) {
    return new Promise((res, rej) => {
      const o = indexedDB.open(DB, 1);
      o.onupgradeneeded = () => o.result.createObjectStore(STORE);
      o.onsuccess = () => res(o.result.transaction(STORE, mode).objectStore(STORE));
      o.onerror = () => rej(o.error);
    });
  }
  function idbReq(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { return await idbReq((await idbStore('readonly')).get(k)); } catch (e) { return null; } }
  async function idbPut(k, v) { try { await idbReq((await idbStore('readwrite')).put(v, k)); } catch (e) {} }
  // Cache key busts whenever engine.js changes (so a scoring edit reshades the grid).
  async function version() {
    try { const t = await (await fetch(origin + '/engine.js')).text(); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + t.length; }
    catch (e) { return 'na'; }
  }

  // Membership of a single badge index: which numbers earn it (1) or not (0).
  function membership(idx) {
    const N = counts.length, m = new Uint8Array(N), byte = idx >> 3, bit = 1 << (idx & 7);
    for (let n = 0; n < N; n++) if (bits[n * ROW + byte] & bit) m[n] = 1;
    return m;
  }

  self.onmessage = async (ev) => {
    const msg = ev.data;
    try {
      // Per-badge highlight: bits stays resident in the worker, so this is instant.
      if (msg.cmd === 'membership') {
        const m = membership(msg.idx);
        self.postMessage({ type: 'membership', idx: msg.idx, member: m.buffer }, [m.buffer]);
        return;
      }
      if (msg.cmd !== 'compute') return;
      origin = msg.origin;
      if (!E) E = await import(origin + '/engine.js');
      self.postMessage({ type: 'meta', badges: E.BADGE_META });

      const ver = await version();
      const hit = msg.force ? null : await idbGet(KEY);
      if (hit && hit.ver === ver && hit.counts && hit.counts.length === 1000000 && hit.ep) {
        counts = hit.counts; bits = hit.bits; epArr = hit.ep; ROW = hit.row;
        cmin = hit.min; cmax = hit.max; emin = hit.emin; emax = hit.emax;
      } else {
        // Full 0..999,999 sweep: per-number badge count, total EP, and a packed
        // earned-badge bitmask (for per-badge membership maps).
        const N = 1000000, B = E.BADGE_META.length;
        ROW = (B + 7) >> 3;
        counts = new Uint8Array(N);
        epArr = new Float64Array(N);
        bits = new Uint8Array(N * ROW);
        let mn = 255, mx = 0, en = Infinity, ex = 0;
        for (let n = 0; n < N; n++) {
          const r = E.computeLean(n), earned = r.earned, len = earned.length;
          counts[n] = len; epArr[n] = r.ep;
          if (len < mn) mn = len;
          if (len > mx) mx = len;
          if (r.ep < en) en = r.ep;
          if (r.ep > ex) ex = r.ep;
          const base = n * ROW;
          for (let j = 0; j < len; j++) { const bi = earned[j]; bits[base + (bi >> 3)] |= (1 << (bi & 7)); }
          if ((n & 0x7FFF) === 0) self.postMessage({ type: 'progress', pct: n / N });
        }
        cmin = mn; cmax = mx; emin = en; emax = ex;
        await idbPut(KEY, { ver, counts, ep: epArr, bits, row: ROW, min: mn, max: mx, emin: en, emax: ex });
      }
      // counts + bits stay resident for membership(); ship the page copies of counts + ep.
      const c = counts.slice(), e = epArr.slice();
      self.postMessage({ type: 'done', counts: c.buffer, ep: e.buffer, min: cmin, max: cmax, emin: emin, emax: emax, cached: !!hit }, [c.buffer, e.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
  };
}

function gridClient(WORKER_SRC, LABELS) {
  const SIZE = 1000;
  const cv = document.getElementById('grid');
  const ctx = cv.getContext('2d');
  const tip = document.getElementById('tip');
  const ov = document.getElementById('ov');
  const bar = document.getElementById('bar');
  const ovtext = document.getElementById('ovtext');
  const listEl = document.getElementById('list');
  const searchEl = document.getElementById('search');
  const legendEl = document.getElementById('legbar');
  const cmapSel = document.getElementById('cmap');
  const titleEl = document.getElementById('vtitle');
  const toast = document.getElementById('toast');
  let toastT = 0;
  function flash(msg) {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  let counts = null, cmin = 0, cmax = 1;
  let epArr = null, emin = 0, emax = 1;
  let countCanvas = null;          // badge-count heatmap (the default view)
  let epCanvas = null;             // log-scaled total-EP heatmap
  let src = null;                  // currently displayed 1000x1000 source canvas
  let member = null;               // Uint8Array membership for the active badge (or null in count/ep mode)
  let view = 'count';              // 'count' | 'ep' | a badge label
  const memCache = new Map();      // label -> Uint8Array, so re-selecting a badge is instant
  let scale = 1, ox = 0, oy = 0, minScale = 1;
  const maxScale = 80;
  let cw = 0, ch = 0, dpr = 1;

  // Perceptually-uniform colour scales (anchor stops, evenly spaced over [0,1]).
  // Grayscale is the default; the others are matplotlib's viridis family.
  const CMAPS = {
    Grayscale: [[0,0,0],[255,255,255]],
    Viridis: [[68,1,84],[72,40,120],[62,73,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]],
    Magma: [[0,0,4],[28,16,68],[79,18,123],[129,37,129],[181,54,122],[229,80,100],[251,135,97],[254,194,135],[252,253,191]],
    Inferno: [[0,0,4],[31,12,72],[85,15,109],[136,34,106],[186,54,85],[227,89,51],[249,140,10],[249,201,50],[252,255,164]],
    Plasma: [[13,8,135],[84,2,163],[139,10,165],[185,50,137],[219,92,104],[244,136,73],[254,188,43],[240,249,33]],
    Cividis: [[0,32,76],[0,42,102],[45,63,112],[76,85,107],[108,110,107],[142,136,96],[179,164,77],[219,194,55],[255,233,69]],
  };
  let currentCmap = 'Grayscale';
  function cmap(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = CMAPS[currentCmap], n = s.length - 1, x = t * n, i = Math.floor(x), f = x - i;
    if (i >= n) return s[n];
    const a = s[i], b = s[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function buildLUT() {
    const L = new Uint8ClampedArray(768);
    for (let i = 0; i < 256; i++) { const c = cmap(i / 255), q = i * 3; L[q] = c[0]; L[q + 1] = c[1]; L[q + 2] = c[2]; }
    return L;
  }
  function cmapCSS() {
    const s = CMAPS[currentCmap], n = s.length - 1;
    return s.map((c, i) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ') ' + Math.round(i / n * 100) + '%').join(',');
  }

  function grayCanvas(paint) {
    const cnv = document.createElement('canvas');
    cnv.width = SIZE; cnv.height = SIZE;
    paint(cnv.getContext('2d'));
    return cnv;
  }
  function buildCount() {
    const L = buildLUT();
    countCanvas = grayCanvas(sctx => {
      const img = sctx.createImageData(SIZE, SIZE), d = img.data;
      for (let i = 0; i < counts.length; i++) {
        const t = cmax === cmin ? 0 : (counts[i] - cmin) / (cmax - cmin);
        const q = ((t * 255 + 0.5) | 0) * 3, p = i << 2;
        d[p] = L[q]; d[p + 1] = L[q + 1]; d[p + 2] = L[q + 2]; d[p + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
    });
  }
  function buildMember(m) {
    const hi = cmap(1), hr = hi[0] | 0, hg = hi[1] | 0, hb = hi[2] | 0;   // members: colormap's hot end
    const lo = cmap(0), lr = lo[0] | 0, lg = lo[1] | 0, lb = lo[2] | 0;   // non-members: colormap's dark end (black for Grayscale)
    return grayCanvas(sctx => {
      const img = sctx.createImageData(SIZE, SIZE), d = img.data;
      for (let i = 0; i < m.length; i++) {
        const p = i << 2;
        if (m[i]) { d[p] = hr; d[p + 1] = hg; d[p + 2] = hb; } else { d[p] = lr; d[p + 1] = lg; d[p + 2] = lb; }
        d[p + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
    });
  }
  // EP spans many orders of magnitude, so the EP heatmap is log-scaled.
  function buildEP() {
    const L = buildLUT(), lo = Math.log(emin + 1), span = (Math.log(emax + 1) - lo) || 1;
    epCanvas = grayCanvas(sctx => {
      const img = sctx.createImageData(SIZE, SIZE), d = img.data;
      for (let i = 0; i < epArr.length; i++) {
        const t = (Math.log(epArr[i] + 1) - lo) / span, q = ((t * 255 + 0.5) | 0) * 3, p = i << 2;
        d[p] = L[q]; d[p + 1] = L[q + 1]; d[p + 2] = L[q + 2]; d[p + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
    });
  }
  function fmtEP(n) {
    n = Math.round(n);
    if (n < 1000) return '' + n;
    const u = ['K', 'M', 'B']; let i = -1, x = n;
    while (x >= 1000 && i < 2) { x /= 1000; i++; }
    return (x < 10 ? x.toFixed(1) : '' + Math.round(x)) + u[i];
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    cw = cv.clientWidth; ch = cv.clientHeight;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  }
  function fit() {
    minScale = Math.min(cw / SIZE, ch / SIZE);
    scale = minScale;
    ox = (cw - SIZE * scale) / 2;
    oy = (ch - SIZE * scale) / 2;
  }
  function clampPan() {
    const w = SIZE * scale, h = SIZE * scale;
    // Let the grid be dragged until an edge reaches the window centre (not just the
    // viewport edge), so corners are easy to reach when zoomed in.
    ox = w <= cw ? (cw - w) / 2 : Math.min(cw / 2, Math.max(cw / 2 - w, ox));
    oy = h <= ch ? (ch - h) / 2 : Math.min(ch / 2, Math.max(ch / 2 - h, oy));
  }
  function render() {
    if (!src) return;
    clampPan();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, ox, oy, SIZE * scale, SIZE * scale);
  }
  function numberAt(mx, my) {
    const sx = Math.floor((mx - ox) / scale), sy = Math.floor((my - oy) / scale);
    if (sx < 0 || sy < 0 || sx >= SIZE || sy >= SIZE) return null;
    return { x: sx, y: sy, n: sy * SIZE + sx };
  }
  function zoomAt(mx, my, factor) {
    const ns = Math.min(maxScale, Math.max(minScale, scale * factor));
    if (ns === scale) return;
    ox = mx - (mx - ox) * (ns / scale);
    oy = my - (my - oy) * (ns / scale);
    scale = ns; render();
  }
  function rel(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // Test hooks: number under canvas-relative (x, y), and the live transform.
  window.__numAt = (x, y) => { const h = numberAt(x, y); return h ? h.n : null; };
  window.__view = () => ({ scale: scale, ox: ox, oy: oy });

  // --- view selection -------------------------------------------------------
  function fmtPct(p) { return (p < 1 ? p.toFixed(3) : p.toFixed(2)) + '%'; }
  function scaleSpan(grad) { return '<span class="scale" style="background:linear-gradient(90deg,' + grad + ')"></span>'; }
  function updateLegend() {
    if (view === 'count') {
      titleEl.textContent = 'All numbers - badge count';
      legendEl.innerHTML = '<span class="lab">' + cmin + '</span>' + scaleSpan(cmapCSS()) + '<span class="lab">' + cmax + ' badges</span>';
    } else if (view === 'ep') {
      titleEl.textContent = 'Total EP - ' + fmtEP(emin) + ' to ' + fmtEP(emax) + ' (log scale)';
      legendEl.innerHTML = '<span class="lab">' + fmtEP(emin) + '</span>' + scaleSpan(cmapCSS()) + '<span class="lab">' + fmtEP(emax) + ' EP</span>';
    } else {
      let cnt = 0; if (member) for (let i = 0; i < member.length; i++) cnt += member[i];
      titleEl.textContent = member ? (view + ' - ' + cnt.toLocaleString() + ' / 1,000,000 (' + fmtPct(cnt / 1e6 * 100) + ')') : (view + ' …');
      const hi = cmap(1), lo = cmap(0);
      const hc = 'rgb(' + (hi[0] | 0) + ',' + (hi[1] | 0) + ',' + (hi[2] | 0) + ')';
      const lc = 'rgb(' + (lo[0] | 0) + ',' + (lo[1] | 0) + ',' + (lo[2] | 0) + ')';
      legendEl.innerHTML = '<span class="lab">none</span>' + scaleSpan(lc + ' 0 50%, ' + hc + ' 50% 100%') + '<span class="lab">earns ' + view + '</span>';
    }
  }
  function highlight() {
    for (const b of listEl.children) b.classList.toggle('on', b.dataset.v === view);
  }
  // Each view has a shareable URL via the hash: /grid (count), /grid#ep, or
  // /grid#<badge label>. The address bar tracks the active view, loading such a
  // URL opens straight to it, and editing the hash / back-forward re-selects.
  const labelIdx = new Map();
  for (let i = 0; i < LABELS.length; i++) labelIdx.set(LABELS[i], i);
  function curHash() { try { return decodeURIComponent(location.hash.replace(/^#/, '')); } catch (_) { return ''; } }
  function setHash(v) {
    const h = v === 'count' ? '' : '#' + encodeURIComponent(v);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search + h);
    else location.hash = h;
  }
  function go(v) {
    if (v === 'ep') selectEP();
    else if (v && v !== 'count' && labelIdx.has(v)) selectBadge(v, labelIdx.get(v));
    else selectCount();
  }
  function selectCount() {
    view = 'count'; member = null;
    if (!countCanvas) buildCount();
    src = countCanvas;
    highlight(); updateLegend(); render(); setHash('count');
  }
  function selectEP() {
    view = 'ep'; member = null;
    if (!epCanvas) buildEP();
    src = epCanvas;
    highlight(); updateLegend(); render(); setHash('ep');
  }
  // Repaint the active view with the current colormap (invalidates cached canvases).
  function recolor() {
    countCanvas = null; epCanvas = null;
    if (view === 'count') selectCount();
    else if (view === 'ep') selectEP();
    else if (member) applyMember(view);
    else updateLegend();
  }
  function applyMember(label) {
    member = memCache.get(label);
    src = buildMember(member);
    highlight(); updateLegend(); render();
  }
  function selectBadge(label, idx) {
    view = label;
    setHash(label);
    highlight(); updateLegend();
    if (memCache.has(label)) applyMember(label);
    else worker.postMessage({ cmd: 'membership', idx: idx });
  }
  function buildList() {
    listEl.innerHTML = '';
    const items = [
      { label: 'All numbers (badge count)', v: 'count', idx: -1 },
      { label: 'Total EP', v: 'ep', idx: -2 },
    ];
    for (let i = 0; i < LABELS.length; i++) items.push({ label: LABELS[i], v: LABELS[i], idx: i });
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'item'; b.textContent = it.label; b.dataset.v = it.v; b.dataset.idx = it.idx;
      b.onclick = () => { it.v === 'count' ? selectCount() : it.v === 'ep' ? selectEP() : selectBadge(it.label, it.idx); };
      listEl.appendChild(b);
    }
    highlight();
  }
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.toLowerCase();
    for (const b of listEl.children) {
      if (Number(b.dataset.idx) < 0) continue;   // keep the count + EP entries pinned
      b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none';
    }
  });

  // --- interaction ----------------------------------------------------------
  // Pointer handling: 1 pointer pans (and click/tap opens a number); 2 pointers
  // pinch-zoom toward their midpoint (and pan together). touch-action:none on the
  // canvas keeps the browser from hijacking the gesture.
  const pointers = new Map();      // pointerId -> {x, y}
  let moved = 0, lx = 0, ly = 0, pinch = null;
  function startPinch() {
    const pts = [...pointers.values()];
    const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
    pinch = { dist: Math.hypot(dx, dy) || 1, mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2, scale, ox, oy };
    moved = 999;                   // a pinch is never a click
  }
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [mx, my] = rel(e);
    zoomAt(mx, my, e.deltaY < 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // ignore right/middle mouse
    const [x, y] = rel(e);
    pointers.set(e.pointerId, { x, y });
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size === 1) { moved = 0; lx = x; ly = y; }
    else if (pointers.size === 2) startPinch();
  });
  cv.addEventListener('pointermove', e => {
    const [x, y] = rel(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1, mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      const ns = Math.min(maxScale, Math.max(minScale, pinch.scale * dist / pinch.dist));
      const sx = (pinch.mx - pinch.ox) / pinch.scale, sy = (pinch.my - pinch.oy) / pinch.scale;
      scale = ns; ox = mx - sx * ns; oy = my - sy * ns; render();
      return;
    }
    if (pointers.size === 1 && pointers.has(e.pointerId)) {
      ox += x - lx; oy += y - ly; moved += Math.abs(x - lx) + Math.abs(y - ly); lx = x; ly = y; render();
      return;
    }
    if (pointers.size === 0) {     // hover (mouse only)
      const hit = numberAt(x, y);
      if (hit) {
        let detail;
        if (view === 'count') { const c = counts[hit.n]; detail = c + ' badge' + (c === 1 ? '' : 's'); }
        else if (view === 'ep') { detail = Math.round(epArr[hit.n]).toLocaleString() + ' EP'; }
        else { detail = (member && member[hit.n]) ? 'earns ' + view : 'no ' + view; }
        tip.style.display = 'block';
        tip.innerHTML = '<b>' + hit.n.toLocaleString() + '</b><span>' + detail + ' - click to open</span>';
        tip.style.left = Math.min(cw - 160, x + 16) + 'px';
        tip.style.top = Math.min(ch - 44, y + 16) + 'px';
        cv.style.cursor = 'pointer';
      } else { tip.style.display = 'none'; cv.style.cursor = 'grab'; }
    }
  });
  function endPointer(e) {
    const had = pointers.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size === 1) {     // pinch -> single drag: rebase, don't treat as a tap
      const p = [...pointers.values()][0]; lx = p.x; ly = p.y; pinch = null; moved = 999;
    } else if (pointers.size === 0) {
      pinch = null;
      if (had && moved < 5) { const [x, y] = rel(e); const hit = numberAt(x, y); if (hit) location.href = '/?n=' + hit.n; }
    }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; });
  cv.addEventListener('pointerleave', () => { if (pointers.size === 0) tip.style.display = 'none'; });
  cv.addEventListener('dblclick', e => { e.preventDefault(); const [mx, my] = rel(e); zoomAt(mx, my, 2.2); });
  // Right-click copies a PNG of the current 1000x1000 view to the clipboard.
  cv.addEventListener('contextmenu', async e => {
    e.preventDefault();
    if (!src) { flash('Still building the grid…'); return; }
    try {
      const blob = await new Promise((res, rej) => src.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const what = view === 'count' ? 'badge-count grid' : view === 'ep' ? 'total-EP grid' : view + ' grid';
      flash('Copied ' + what + ' to clipboard');
    } catch (err) {
      flash('Copy failed: ' + (err && err.message || err));
    }
  });
  window.addEventListener('resize', () => { const wasFit = scale <= minScale + 1e-6; resize(); if (wasFit) fit(); render(); });
  window.addEventListener('hashchange', () => { if (counts) go(curHash() || 'count'); });
  document.getElementById('zin').onclick = () => zoomAt(cw / 2, ch / 2, 1.5);
  document.getElementById('zout').onclick = () => zoomAt(cw / 2, ch / 2, 1 / 1.5);
  document.getElementById('zreset').onclick = () => { fit(); render(); };
  document.getElementById('zlink').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); flash('Link copied'); }
    catch (_) { flash('Copy failed'); }
  };
  const sidehideBtn = document.getElementById('sidehide');
  const TRAY_HINT_KEY = 'rngdle-tray-hint';
  // Flash the sidebar toggle until the user collapses the tray for the first time.
  try { if (!localStorage.getItem(TRAY_HINT_KEY)) sidehideBtn.classList.add('hint'); } catch (_) {}
  sidehideBtn.onclick = () => {
    document.body.classList.add('nav-collapsed');
    sidehideBtn.classList.remove('hint');
    try { localStorage.setItem(TRAY_HINT_KEY, '1'); } catch (_) {}
  };
  document.getElementById('sideshow').onclick = () => document.body.classList.remove('nav-collapsed');
  cmapSel.addEventListener('change', () => { currentCmap = cmapSel.value; recolor(); });

  // --- worker ---------------------------------------------------------------
  const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') {
      const pct = Math.round(m.pct * 100);
      bar.style.width = pct + '%';
      ovtext.textContent = 'Scoring ' + pct + '% of 1,000,000 numbers…';
    } else if (m.type === 'done') {
      counts = new Uint8Array(m.counts); cmin = m.min; cmax = m.max;
      epArr = new Float64Array(m.ep); emin = m.emin; emax = m.emax;
      epCanvas = null;
      buildCount();
      ov.style.display = 'none';
      buildList();
      go(curHash() || 'count');
      resize(); fit(); render();
    } else if (m.type === 'membership') {
      const label = LABELS[m.idx];
      memCache.set(label, new Uint8Array(m.member));
      if (view === label) applyMember(label);
    } else if (m.type === 'error') {
      ov.style.display = 'flex';
      ovtext.textContent = 'Error: ' + m.message;
    }
  };
  worker.onerror = e => { ovtext.textContent = 'Worker error: ' + (e.message || e); };
  worker.postMessage({ cmd: 'compute', origin: location.origin });
}

function renderGrid() {
  const labels = JSON.stringify(BADGES.map(b => b[1]));
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="robots" content="noindex">
<title>RNGdle - Number Grid</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #05060a; color: #e8eaf0;
    font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    overflow: hidden; -webkit-user-select: none; user-select: none; }
  #grid { position: fixed; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
  #grid:active { cursor: grabbing; }
  .panel { position: fixed; z-index: 5; background: rgba(12,14,22,.86);
    border: 1px solid rgba(255,255,255,.12); border-radius: 10px; backdrop-filter: blur(6px); }
  #side { top: 12px; left: 12px; bottom: 12px; width: 250px; max-width: calc(100vw - 24px);
    display: flex; flex-direction: column; padding: 12px; gap: 10px; transition: transform .25s ease; }
  body.nav-collapsed #side { transform: translateX(calc(-100% - 16px)); }
  .sidehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .sidehead h1 { flex: 1; }
  #sidehide, #sideshow { flex: 0 0 auto; width: 32px; height: 32px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center; color: #e8eaf0;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; cursor: pointer; }
  #sidehide svg, #sideshow svg { width: 19px; height: 19px; }
  #sidehide:hover, #sideshow:hover { background: rgba(255,255,255,.14); }
  #sideshow { position: fixed; top: 12px; left: 12px; z-index: 7; display: none; }
  body.nav-collapsed #sideshow { display: inline-flex; }
  #sidehide.hint { color: #ffb295; animation: trayhint 1.15s ease-in-out infinite; }
  @keyframes trayhint { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,138,92,0); border-color: rgba(255,255,255,.14); }
    50% { box-shadow: 0 0 0 5px rgba(255,138,92,.32); border-color: #ff8a5c; } }
  @media (max-width: 640px) {
    #side { left: 10px; right: 10px; width: auto; max-width: none; top: 10px; bottom: 10px; padding: 14px; gap: 12px; }
    #search { padding: 11px 12px; font-size: 15px; }
    .item { padding: 11px 10px; font-size: 14px; }
    #ctrls { gap: 8px; padding: 7px; }
    #ctrls button { width: 42px; height: 42px; font-size: 20px; }
    #sidehide, #sideshow { width: 40px; height: 40px; }
    #sidehide svg, #sideshow svg { width: 22px; height: 22px; }
    #cmap { font-size: 13px; padding: 6px 8px; }
    body:not(.nav-collapsed) #ctrls, body:not(.nav-collapsed) #legend { display: none; }
  }
  #side h1 { margin: 0; font-size: 14px; font-weight: 650; }
  #side .credit { font-size: 12px; color: #9aa1b2; }
  #side .credit b { color: #ff8a5c; font-weight: 600; }
  #side .nav { font-size: 12px; color: #9aa1b2; }
  #side .nav a { color: #ff8a5c; text-decoration: none; }
  #side .nav a:hover { text-decoration: underline; }
  #vtitle { font-size: 12px; color: #cfd3df; min-height: 16px; }
  #search { width: 100%; padding: 8px 10px; font-size: 13px; line-height: 1.4; color: #e8eaf0;
    -webkit-appearance: none; appearance: none; font-family: inherit;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; }
  #list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; padding: 0 4px; }
  .item { flex: 0 0 auto; display: block; width: 100%; text-align: left; padding: 6px 8px; font-size: 12.5px;
    line-height: 1.5; font-family: inherit;
    color: #c8ccd8; background: transparent; border: 0; border-radius: 6px; cursor: pointer; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .item:hover { background: rgba(255,255,255,.07); }
  .item.on { background: rgba(255,138,92,.18); color: #ffd9c9; }
  #ctrls { top: 12px; right: 12px; display: flex; gap: 6px; padding: 6px; }
  #ctrls button { width: 34px; height: 34px; font-size: 17px; color: #e8eaf0;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; cursor: pointer; }
  #ctrls button:hover { background: rgba(255,255,255,.14); }
  #legend { bottom: 12px; right: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  #legbar { display: flex; align-items: center; gap: 8px; }
  #legend .scale { width: 150px; height: 10px; border-radius: 5px; }
  #legend .lab { color: #9aa1b2; }
  #cmap { font-family: inherit; font-size: 12px; color: #e8eaf0; background: rgba(255,255,255,.06);
    -webkit-appearance: none; appearance: none; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 3px 6px; cursor: pointer; }
  #cmap option { color: #000; }
  #tip { position: fixed; z-index: 6; display: none; pointer-events: none; padding: 6px 9px;
    background: rgba(8,10,16,.92); border: 1px solid rgba(255,255,255,.18); border-radius: 8px; font-size: 12px; white-space: nowrap; }
  #tip b { font-size: 14px; }
  #tip span { display: block; color: #9aa1b2; font-size: 11px; margin-top: 1px; }
  #toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 8;
    padding: 8px 14px; font-size: 13px; color: #e8eaf0; background: rgba(8,10,16,.94);
    border: 1px solid rgba(255,255,255,.18); border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  #toast.show { opacity: 1; }
  #ov { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; background: #05060a; }
  #ov h2 { margin: 0; font-weight: 600; font-size: 16px; }
  #ovtext { color: #9aa1b2; font-size: 13px; }
  #track { width: min(320px, 70vw); height: 8px; border-radius: 4px; background: rgba(255,255,255,.1); overflow: hidden; }
  #bar { height: 100%; width: 0; background: linear-gradient(90deg, #888, #fff); transition: width .15s; }
</style></head>
<body>
<canvas id="grid"></canvas>
<button id="sideshow" class="panel" title="Show panel" aria-label="Show panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg></button>
<div id="side" class="panel">
  <div class="sidehead"><h1>All 1,000,000 numbers</h1><button id="sidehide" title="Hide panel" aria-label="Hide panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg></button></div>
  <div class="credit">Heavily inspired by <b>basiliotornado</b></div>
  <div class="nav"><a href="/">&larr; calculator</a></div>
  <div id="vtitle">All numbers - badge count</div>
  <input id="search" type="search" placeholder="Filter 203 badges…" autocomplete="off">
  <div id="list"></div>
  <div class="nav">Pick a badge to highlight which numbers earn it. Click any cell to open it.</div>
</div>
<div id="ctrls" class="panel">
  <button id="zout" title="Zoom out">−</button>
  <button id="zreset" title="Fit">⤢</button>
  <button id="zin" title="Zoom in">+</button>
  <button id="zlink" title="Copy link to this view">🔗</button>
</div>
<div id="legend" class="panel">
  <select id="cmap" title="Colour scale (perceptually uniform)">
    <option>Grayscale</option><option>Viridis</option><option>Magma</option><option>Inferno</option><option>Plasma</option><option>Cividis</option>
  </select>
  <div id="legbar"></div>
</div>
<div id="tip"></div>
<div id="toast"></div>
<div id="ov">
  <h2>Building the grid…</h2>
  <div id="track"><div id="bar"></div></div>
  <div id="ovtext">Scoring 1,000,000 numbers (one-time; cached after)…</div>
</div>
<script type="module">
var __name = (f) => f;
const __GRID_WORKER_SRC = ${JSON.stringify('var __name=(f)=>f;(' + gridWorker.toString() + ')()')};
(${gridClient.toString()})(__GRID_WORKER_SRC, ${labels});
</script>
</body></html>`;
}

export { compute, BADGES, engineModuleSource };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get('n');

    // Browser engine for the client-side "Analyze all scores" Web Worker.
    if (url.pathname === '/engine.js') {
      return new Response(engineModuleSource(), {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (url.pathname === '/api') {
      const n = parseN(raw);
      if (n === null || Number.isNaN(n)) {
        return new Response(JSON.stringify({ error: 'Provide n as an integer from 0 to 1000000.' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(compute(n)), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    // Live data for the beta renderer's click-to-type card (number + tier + badges).
    if (url.pathname === '/beta') {
      const n = parseN(raw);
      if (n === null || Number.isNaN(n)) {
        return new Response(JSON.stringify({ error: 'Provide n as an integer from 0 to 1000000.' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(betaData(compute(n), n)), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    // Hidden interactive 1,000,000-number map; click a cell to open it on /.
    if (url.pathname === '/grid') {
      return new Response(renderGrid(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      const n = parseN(raw);
      const result = (n !== null && !Number.isNaN(n)) ? compute(n) : null;
      return new Response(renderHTML(result), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

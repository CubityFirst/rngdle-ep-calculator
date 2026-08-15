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
// Full-scan snapshot data (research/gen-snapshot.mjs, `npm run gen`): example
// numbers per badge for the /badges index, and each badge's exact share of all
// 1,000,001 inputs. Regenerate + commit whenever a badge test / EP / family changes.
import { EXAMPLES } from './examples.gen.js';
import { PROBABILITIES } from './probabilities.gen.js';
// Shared design system: one token set, one set of primitives (.btn/.field/.pill/.card/
// .stat/.kv/.progress) and one site nav, used by every page below. See src/ui.js.
import { pageShell } from './ui.js';
// /beta - the experimental data-vis lab. Its pages render from the same badge table and
// the same client-side sweep as everything else; betaCtx() below is the one hand-off.
import { handleBeta } from './beta.js';

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
// pTripleExact / pQuadExact are each asked for by TWO badges (in-order + scrambled) about
// the same string, so every second call is a guaranteed repeat - a one-entry cache halves
// the cost of the four most expensive badges in the full-range sweep. The cache lives on
// the function object rather than in module scope because these helpers are shipped to the
// browser engine via Function.prototype.toString(), which only carries the body.
function pTripleExact(s) {
  if (pTripleExact.k !== s) { pTripleExact.k = s; pTripleExact.v = pTripleExactScan(s); }
  return pTripleExact.v;
}
function pQuadExact(s) {
  if (pQuadExact.k !== s) { pQuadExact.k = s; pQuadExact.v = pQuadExactScan(s); }
  return pQuadExact.v;
}
function pTripleExactScan(s) {
  for (let t = 1; t < s.length - 1; t++) for (let i = t + 1; i < s.length; i++) {
    const parts = [s.slice(0, t), s.slice(t, i), s.slice(i)];
    if (parts.some(pLeadingZero) || !pMultiPart(parts)) continue;
    const nums = parts.map(p => parseInt(p, 10));
    if (pConsecSet(nums)) return { numbers: nums, splits: [0, t, i] };
  }
  return null;
}
function pQuadExactScan(s) {
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
// Prod-ported helpers for the 2026-07-16 badge batch (Metronome / Crescendo /
// Equation / Pocket Mirror / Mini Scramble). Transcribed from the live game's
// BADGE_DEFINITIONS util module (research/rngdle-dump-2026-07-16), so these
// match rngdle.com. Verified against each badge's shipped match/reject cases and
// the published earn-probabilities. Do not "simplify" without re-checking parity.
// ---------------------------------------------------------------------------

// Partition `s` into exactly `count` non-empty parts (no leading zeros) and test
// pred(numbers); returns {splits, numbers} for the first passing split or null. (prod `_`)
function pSplitParts(s, count, pred) {
  const splits = Array(count), nums = Array(count);
  const rec = (idx, start) => {
    if (idx === count - 1) {
      const part = s.slice(start);
      if (pLeadingZero(part)) return false;
      splits[idx] = start; nums[idx] = Number(part);
      return pred(nums);
    }
    const remaining = count - idx - 1;
    for (let end = start + 1; end <= s.length - remaining; end++) {
      const part = s.slice(start, end);
      if (pLeadingZero(part)) continue;
      splits[idx] = start; nums[idx] = Number(part);
      if (rec(idx + 1, end)) return true;
    }
    return false;
  };
  return rec(0, 0) ? { splits: [...splits], numbers: [...nums] } : null;
}
// 3+ parts forming an arithmetic sequence with common difference d where |d| >= 2
// (a diff of 0/±1 is Homogeneous / Cascade / Waterfall, not "Metronome"). (prod `S`)
function findArithmeticSplit(s) {
  for (let count = 3; count <= s.length; count++) {
    const r = pSplitParts(s, count, nums => {
      const diff = nums[1] - nums[0];
      if (diff === -1 || diff === 0 || diff === 1) return false;
      for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i - 1] !== diff) return false;
      return true;
    });
    if (r) return r;
  }
  return null;
}
// 3+ positive parts forming a geometric sequence (constant ratio via b^2 = a*c). (prod `A`)
function findGeometricSplit(s) {
  for (let count = 3; count <= s.length; count++) {
    const r = pSplitParts(s, count, nums => {
      if (nums.some(v => v <= 0) || nums[0] === nums[1]) return false;
      for (let t = 0; t + 2 < nums.length; t++) if (nums[t + 1] * nums[t + 1] !== nums[t] * nums[t + 2]) return false;
      return true;
    });
    if (r) return r;
  }
  return null;
}
// Splits into 3 non-zero parts a,b,c where inserting one of + - * / makes a op b === c. (prod `w`)
function findEquation(s) {
  return pSplitParts(s, 3, nums => {
    const [a, b, c] = nums;
    if (a === 0 || b === 0 || c === 0) return false;
    return a + b === c || a - b === c || a * b === c || (a % b === 0 && a / b === c);
  });
}
// Plain string palindrome (used by Pocket Mirror over substrings). (prod `r`)
function isPalindromeStr(s) { for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false; return true; }
// `s` has >= minLen digits that, sorted ascending, form a run of consecutive values. (prod `N`)
function isScrambledSeq(s, minLen) {
  if (s.length < minLen) return false;
  const arr = [...s].map(Number).sort((a, b) => a - b);
  for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1] + 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Badge definitions: [id, label, emoji, ep, test(c)]
// c = { n, s, len, d, counts, distinct, sum, prod, maxCount, has(sub), cnt(digit), withCount(k) }
//
// Rarity is NOT stored per-badge. Like rngdle.com, it is derived from the badge's
// EP score via the BADGE_RARITY_THRESHOLDS cutoffs (reverse-engineered from the
// shipped chunk_6d375db2482ce7e8.js: getBadgeRarityTier). Any future EP change
// therefore keeps rarity self-correcting - no second value to forget.
// ---------------------------------------------------------------------------

const BADGE_RARITY_THRESHOLDS = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 };

// Returns rarity tier (lowercase) for a given EP score, matching rngdle.com.
function tierFromScore(ep) {
  const t = BADGE_RARITY_THRESHOLDS;
  return ep < t.common ? 'common'
       : ep < t.uncommon ? 'uncommon'
       : ep < t.rare ? 'rare'
       : ep < t.epic ? 'epic'
       : ep < t.anomaly ? 'anomaly'
       : 'mythic';
}

// Capitalized rarity label (used in tooltips / exports / pill rendering).
function rarityFromScore(ep) {
  const t = tierFromScore(ep);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const BADGES = [
  // --- Mythic exacts ---
  ['NICE_EXACT', 'Exact Nice', '😏', 100000100, c => c.n === 69],
  ['JACKPOT_EXACT', 'Exact Jackpot', '💰', 100000100, c => c.n === 777],
  ['JACKPOT_SIX', 'Jackpot Six', '🏦', 100000100, c => c.has('777777')],
  ['BOTANIST_EXACT', 'Exact Botanist', '🌿', 100000100, c => c.n === 420],
  ['DEVIL_EXACT', 'Exact Devil', '😈', 100000100, c => c.n === 666],
  ['LEET_EXACT', 'Exact Leet', '💻', 100000100, c => c.n === 1337],
  ['EXACT_HELL', 'Exact Hell', '👹', 100000100, c => c.n === 7734],
  ['EXACT_BOOB_80085', 'Exact 80085', '💎', 100000100, c => c.n === 80085],
  ['MEANING_EXACT', 'Exact Meaning', '🌌', 100000100, c => c.n === 42],
  ['EMERGENCY_EXACT', 'Exact Emergency', '🚑', 100000100, c => c.n === 911],
  ['VERY_VERY_NICE', 'Very Very Nice', '😏', 100000100, c => c.n === 696969],
  ['HOTBOX', 'Hotbox', '🌿', 100000100, c => c.n === 420420],
  ['MAYDAY', 'Mayday', '🚑', 100000100, c => c.n === 911911],
  ['UNIVERSAL_ANSWER', 'Universal Answer', '🌌', 100000100, c => c.n === 424242],
  ['BIG_BROTHER_EXACT', 'Orwellian', '👁️', 100000100, c => c.n === 1984],
  ['DIGIT_ZERO', 'Zero', '0️⃣', 100000100, c => c.n === 0],
  ['DIGIT_ONE', 'One', '1️⃣', 100000100, c => c.n === 1],
  ['DIGIT_TWO', 'Two', '2️⃣', 100000100, c => c.n === 2],
  ['DIGIT_THREE', 'Three', '3️⃣', 100000100, c => c.n === 3],
  ['DIGIT_FOUR', 'Four', '4️⃣', 100000100, c => c.n === 4],
  ['DIGIT_FIVE', 'Five', '5️⃣', 100000100, c => c.n === 5],
  ['DIGIT_SIX', 'Six', '6️⃣', 100000100, c => c.n === 6],
  ['DIGIT_SEVEN', 'Seven', '7️⃣', 100000100, c => c.n === 7],
  ['DIGIT_EIGHT', 'Eight', '8️⃣', 100000100, c => c.n === 8],
  ['DIGIT_NINE', 'Nine', '9️⃣', 100000100, c => c.n === 9],
  ['TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 100000100, c => c.n === 350],
  ['SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 100000100, c => c.n === 67],
  ['EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 100000100, c => c.n === 86],
  ['ORIENTATION_EXACT', 'Exact Orientation', '🧭', 100000100, c => c.n === 101],
  ['CALENDAR_EXACT', 'Exact Calendar', '📅', 100000100, c => c.n === 365],
  ['BRAINROT', 'Brainrot', '🫠', 100000100, c => c.n === 676767],
  ['GROUNDHOG_DAY', 'Groundhog Day', '📅', 100000100, c => c.n === 365365],
  ['ONE_MILLION', 'One Million', '🐐', 100000100, c => c.n === 1000000],
  ['ERROR_EXACT', 'Not Found', '🚫', 100000100, c => c.n === 404],
  ['FULL_DAY', 'Full Day', '⏳', 100000100, c => c.n === 86400],
  ['FOOTBALL_17776', '17776', '🏈', 100000100, c => c.n === 17776],
  ['INFERNAL', 'Infernal', '🔱', 100000100, c => c.n === 666666],
  ['ALWAYS', 'Always', '♾️', 50000050, c => c.s === '247365' || c.s === '365247'],
  ['ULTIMEME_EXACT', 'Funny Number', '😂', 50000050, c => c.s === '69420' || c.s === '42069'],
  ['EXACT_BOOB', 'Exact Boob', '🍈', 50000050, c => c.n === 8008 || c.n === 58008],

  // --- Powers / math (Mythic/Anomaly) ---
  ['THIRTEENTH_POWER', '13th Power', '💀', 33333367, c => isPerfectPower(c.n, 13)],
  ['SEVENTEENTH_POWER', '17th Power', '🧙', 33333367, c => isPerfectPower(c.n, 17)],
  ['NINETEENTH_POWER', '19th Power', '🌑', 33333367, c => isPerfectPower(c.n, 19)],
  ['TAU', 'Tau', '🌀', 33333367, c => c.s === '6283' || c.s === '62831' || c.s === '628318'],
  ['GOLDEN_RATIO', 'Golden Ratio', '🐚', 33333367, c => c.s === '1618' || c.s === '16180' || c.s === '161803'],
  ['TENTH_POWER', '10th Power', '🔟', 25000025, c => isPerfectPower(c.n, 10)],
  ['ELEVENTH_POWER', '11th Power', '🕚', 25000025, c => isPerfectPower(c.n, 11)],
  ['PI', 'Pi', '🥧', 25000025, c => [314, 3141, 31415, 314159].includes(c.n)],
  ['E', "Euler's Number", '📈', 25000025, c => [271, 2718, 27182, 271828].includes(c.n)],
  ['CONSEC_QUAD_EXACT', '4 Consecutive Numbers', '⛓️', 25000025, c => { const r = pQuadExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['NINTH_POWER', '9th Power', '☁️', 20000020, c => isPerfectPower(c.n, 9)],
  ['EIGHTH_POWER', '8th Power', '🎱', 16666683, c => isPerfectPower(c.n, 8)],
  ['OUROBOROS', 'Ouroboros', '🐍', 14285729, c => c.n === 1 || c.n === 4 || c.n === 27 || c.n === 256 || c.n === 3125 || c.n === 46656 || c.n === 823543],
  ['SEVENTH_POWER', '7th Power', '🌈', 12500013, c => isPerfectPower(c.n, 7)],
  ['POWER_OF_SEVEN', 'Power of Seven', '7️⃣', 12500013, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 7; return v === c.n; }],
  ['FACTORIAL', 'Factorial', '❗', 11111122, c => FACTORIALS.has(c.n)],
  ['POWER_OF_FIVE', 'Power of Five', '5️⃣', 11111122, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 5; return v === c.n; }],
  ['HELLO', 'Hello', '👋', 11111122, c => c.has('07734')],
  ['SEQUENCE_6', 'Sequence (6)', '🔢', 11111122, c => pHasSequence(c.s, 6, false)],
  ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, c => /(\d)\1{5}/.test(c.s)],
  ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, c => c.has('00000')],
  ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, c => c.len === 1],
  ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, c => c.s.endsWith('99999')],
  ['SIXTH_POWER', '6th Power', '🎲', 9090918, c => isPerfectPower(c.n, 6)],
  ['POWER_OF_THREE', 'Power of Three', '🔺', 7692315, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 3; return v === c.n; }], // prod: 1 (=3^0) counts
  ['FIFTH_POWER', '5th Power', '🖐️', 6250006, c => isPerfectPower(c.n, 5)],
  ['JACKPOT_FIVE', 'Jackpot Five', '💰💰💰', 5263163, c => c.has('77777')],
  ['POWER_OF_TWO', 'Power of Two', '💾', 5000005, c => c.n > 0 && (c.n & (c.n - 1)) === 0], // prod: 1 (=2^0) counts
  ['ROYAL_FLUSH', 'Royal Flush', '👑', 5000005, c => c.has('56789')],
  ['BOOB_58008', '58008', '🔠', 5000005, c => c.has('58008')],
  ['BOOB_80085', '80085', '🅱️', 5000005, c => c.has('80085')],
  ['PI_CONTAINS_5', 'Pi Slice (5)', '🥧', 5000005, c => c.has('31415')],
  ['E_CONTAINS_5', 'E Slice (5)', '📈', 5000005, c => c.has('27182')],
  ['TAU_SLICE_5', 'Tau Slice (5)', '🌀', 5000005, c => c.has('62831')],
  ['CASCADE', 'Cascade', '🌊', 3333337, c => consecInc(c.d)],
  ['FIBONACCI', 'Fibonacci Number', '🐚', 3333337, c => FIBS.has(c.n)],
  ['FOURTH_POWER', '4th Power', '📦', 3125003, c => isPerfectPower(c.n, 4)],
  ['WATERFALL', 'Waterfall', '🚿', 2857146, c => consecDec(c.d)],
  ['CONSEC_QUAD_CONTAINS', '4 Consecutive Numbers (Contains)', '🔗', 2631582, c => pNAdjacent(c.s, 4) !== null],
  ['CONSEC_QUAD_SCRAMBLED', '4 Consecutive Numbers (Scrambled)', '🔀', 2272730, c => { const r = pQuadExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['HOMOGENEOUS', 'Homogeneous', '🥛', 2222224, c => c.len >= 2 && c.distinct === 1],
  ['ULTIMEME', 'Funny Numbers', '😂', 1666668, c => c.has('69') && c.has('420')],
  ['BINARY_SOUL', 'Binary Soul', '🤖', 1538463, c => /^[01]+$/.test(c.s)],
  ['STRAIGHT_FLUSH', 'Straight Flush', '🃏', 1449277, c => c.has('02468') || c.has('13579') || c.has('86420') || c.has('97531')],
  ['TWO_DIGITS', 'Two Digits', '✌️', 1111112, c => c.len === 2],
  // sum === product. Excludes single digits (1..9 are trivially true) but prod DOES
  // award it to 0 (sum 0 = product 0), so 0 is allowed through. Confirmed via 0 vs 2.
  ['SPY', 'Spy Number', '🕵️', 1030929, c => c.n !== 1 && c.n !== 2 && c.sum === c.prod], // prod excludes only 1 and 2
  ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, c => c.s.endsWith('9999')],
  ['SEMI_EPOCH', 'Semi-Epoch', '🗿', 1000001, c => c.s.endsWith('5000')],
  ['CUBE', '3rd Power', '🧊', 990100, c => isPerfectPower(c.n, 3)],
  ['EVEN_SPACING', 'Even Spacing', '📏', 862070, c => arithmetic(c.d)],

  // --- Epic ---
  ['CONSEC_TRIPLE_EXACT', '3 Consecutive Numbers', '⛓️', 555556, c => { const r = pTripleExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['CONTIGUOUS_FIVES', 'Contiguous Fives', '➖➖➖', 552487, c => /(\d)\1{4}/.test(c.s)],
  ['DEEP_VOID_FOUR', 'Deep Void (4)', '🌌', 552487, c => c.has('0000')],
  ['STROBOGRAMMATIC', 'Strobogrammatic', '🙃', 502513, c => strobogrammatic(c.s)],
  ['STRAIGHT', 'Straight', '📏', 454546, c => straightRun(c.d, 5)],
  ['JACKPOT_FOUR', 'Jackpot Four', '💰💰', 357143, c => c.has('7777')],
  ['VERY_NICE', 'Very Nice', '🥵', 334448, c => c.has('6969')],
  ['DEEPER_MEANING', 'Deeper Meaning', '🌌', 334448, c => c.has('4242')],
  ['SIXTY_SEVEN_DOUBLE', '6767', '🫠', 334448, c => c.has('6767')],
  ['LEET', 'Leet', '💻', 333334, c => c.has('1337')],
  ['HELL', 'Hell', '🔥', 333334, c => c.has('7734')],
  ['BOOB_8008', '8008', '🔢', 333334, c => c.has('8008')],
  ['BIG_BROTHER', 'Big Brother', '👁️', 333334, c => c.has('1984')],
  ['PI_CONTAINS_4', 'Pi Slice (4)', '🥧', 333334, c => c.has('3141')],
  ['E_CONTAINS_4', 'E Slice (4)', '📈', 333334, c => c.has('2718')],
  ['TAU_SLICE_4', 'Tau Slice (4)', '🌀', 333334, c => c.has('6283')],
  ['CONSEC_TRIPLE_SCRAMBLED', '3 Consecutive Numbers (Scrambled)', '🔀', 277778, c => { const r = pTripleExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['ZIPPER', 'Zipper', '🤐', 246914, c => c.len >= 2 && c.distinct === 2 && c.d.every((x, i) => i === 0 || x !== c.d[i - 1])],
  ['ASCENSION', 'Ascension', '📈', 219298, c => strictInc(c.d)],
  ['GEOMETRIC', 'Crescendo', '🔊', 208334, c => findGeometricSplit(c.s) !== null],
  ['FIVE_OF_A_KIND', 'Five of a Kind', '🃏', 198020, c => c.maxCount >= 5],
  ['CONSEC_TRIPLE_CONTAINS', '3 Consecutive Numbers (Contains)', '🔗', 157978, c => pNAdjacent(c.s, 3) !== null],
  ['CONTIGUOUS_THREE_PAIR', 'Contiguous Three Pair', '👨‍👩‍👧‍👦👯', 154321, c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 2; i++) if (a[i] + 2 === a[i + 1] && a[i + 1] + 2 === a[i + 2]) return true; return false; }],
  ['FRAMED_PAIR', 'Framed Pair', '🖼️', 137174, c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1]],
  ['FRAMED_TRIPLE', 'Framed Triple', '🖼️🖼️', 137174, c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1]],
  ['FRAMED_QUAD', 'Framed Quad', '🪟', 137174, c => c.len === 6 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[3] === c.d[4] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
  ['DECAY', 'Decay', '📉', 119474, c => strictDec(c.d)],
  ['THREE_DIGITS', 'Three Digits', '🤟', 111111, c => c.len === 3],
  ['ECHO', 'Echo', '📣', 100100, c => c.len >= 2 && c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2)],
  ['MILLENNIUM', 'Millennium', '🗓️', 100000, c => c.s.endsWith('000')],
  ['PRONIC', 'Pronic Number', '🧮', 100000, c => PRONICS.has(c.n)],
  ['TRIPLE_NINE', 'Triple Nine', '🎉', 100000, c => c.s.endsWith('999')],
  ['SEMI_MILLENNIUM', 'Semi-Millennium', '📜', 100000, c => c.s.endsWith('500')],
  ['COLOSSAL', 'Colossal', '🪨', 100000, c => c.n > 999000],
  ['SQUARE', '2nd Power', '🟦', 99900, c => isPerfectPower(c.n, 2)],
  ['EVEN_SPACING_ABS', 'Even Spacing (Absolute)', '📐', 90992, c => absArith(c.d)],
  ['FIREFLY', 'Firefly', '🪲', 82237, c => {
    if (c.len < 4 || c.distinct !== 2) return false; // prod requires length >= 4
    return Object.values(c.counts).some(v => v === 1); // one digit appears exactly once
  }],
  ['CONSEC_PAIR_EXACT', '2 Consecutive Numbers', '🔗', 50505, c => pPairExact(c.s) !== null],
  ['PALINDROME', 'Palindrome', '🪞', 50025, c => c.s === [...c.s].reverse().join('')],

  // --- Rare ---
  ['CONTIGUOUS_QUADS', 'Contiguous Quads', '➖➖', 37023, c => /(\d)\1{3}/.test(c.s)],
  ['DEEP_VOID_THREE', 'Deep Void (3)', '🌑', 37023, c => c.has('000')],
  ['TURTLE', 'Turtle', '🐢', 36049, c => turtle(c.d)],
  ['SECRET_AGENT', 'Secret Agent', '🕶️', 34614, c => c.has('007')],
  ['HEAVY', 'Heavy', '🧱', 33300, c => c.sum > 45],
  ['CONTIGUOUS_BOAT', 'Contiguous Full House', '🏰', 30111, c => {
    const m = c.s.match(/(\d)\1\1(\d)\2/); if (m && m[1] !== m[2]) return true;
    const m2 = c.s.match(/(\d)\1(\d)\2\2/); return !!(m2 && m2[1] !== m2[2]);
  }],
  ['JACKPOT', 'Jackpot', '💰', 27027, c => c.has('777')],
  ['DEVIL', 'Devil', '😈', 27027, c => c.has('666')],
  ['SEQUENCE_4', 'Sequence (4)', '🔢', 25907, c => pHasSequence(c.s, 4, false)],
  ['ERROR', 'Error 404', '🚫', 25132, c => c.has('404')],
  ['ORIENTATION', 'Orientation', '🧭', 25132, c => c.has('101')],
  ['BOTANIST', 'Botanist', '🌿', 25006, c => c.has('420')],
  ['EMERGENCY', 'Emergency', '🚑', 25006, c => c.has('911')],
  ['PI_CONTAINS_3', 'Pi Slice (3)', '🥧', 25006, c => c.has('314')],
  ['E_CONTAINS_3', 'E Slice (3)', '📈', 25006, c => c.has('271')],
  ['TREE_FIDDY', 'Tree Fiddy', '🦕', 25006, c => c.has('350')],
  ['CALENDAR', 'Calendar', '📅', 25006, c => c.has('365')],
  ['DIVISIBLE_BY_THREE', 'Divisible by Three', '🔺', 24414, c => c.d.every(x => x % 3 === 0)],
  ['SCRAMBLE', 'Scramble', '🔀', 22722, c => c.len >= 2 && c.distinct === c.len && (Math.max(...c.d) - Math.min(...c.d)) === c.len - 1],
  ['DUALITY', 'Duality', '☯️', 21654, c => c.distinct === 2],
  ['STEPS', 'Steps', '🪜', 20202, c => { if (c.len < 2) return false; let rose = false; for (let i = 1; i < c.len; i++) { if (c.d[i] < c.d[i - 1]) return false; if (c.d[i] > c.d[i - 1]) rose = true; } return rose; }],
  ['ARITHMETIC', 'Metronome', '🎼', 17784, c => findArithmeticSplit(c.s) !== null],
  ['FRAMED_DOUBLE', 'Framed Double', '🖼️🖼️🖼️', 15242, c => c.len === 6 && c.d[1] === c.d[2] && c.d[3] === c.d[4] && c.d[1] !== c.d[3] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
  ['SLOPES', 'Slopes', '🛝', 12582, c => { if (c.len < 2) return false; let fell = false; for (let i = 1; i < c.len; i++) { if (c.d[i] > c.d[i - 1]) return false; if (c.d[i] < c.d[i - 1]) fell = true; } return fell; }],
  ['PAIRED_BOOKENDS', 'Paired Bookends', '👐', 11122, c => c.len >= 4 && c.d[0] === c.d[1] && c.d[c.len - 1] === c.d[c.len - 2] && c.d[0] !== c.d[c.len - 1]],
  ['FOUR_DIGITS', 'Four Digits', '🍀', 11111, c => c.len === 4],
  ['THREE_PAIR', 'Three Pair', '👯‍♀️👯', 10288, c => c.countExact(2) >= 3],
  ['BOOKENDS', 'Bookends', '📚', 10010, c => c.len >= 4 && c.s.slice(0, 2) === c.s.slice(-2)],
  ['MIRROR_BOOKENDS', 'Mirror Bookends', '📖', 10010, c => c.len >= 4 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2]],
  ['CENTURY', 'Century', '💯', 10000, c => c.s.endsWith('00')],
  ['DOUBLE_NINE', 'Double Nine', '🎈', 10000, c => c.s.endsWith('99')],
  ['SEMI_CENTURY', 'Semi-Century', '🗓️', 10000, c => c.s.endsWith('50')],

  // --- Uncommon ---
  ['QUADS', 'Four of a Kind', '🍀', 8436, c => c.maxCount >= 4],
  ['EQUATION', 'Equation', '🟰', 7720, c => findEquation(c.s) !== null],
  ['LOW_BALL', 'Low Ball', '📉', 6400, c => /^[0-4]+$/.test(c.s)],
  ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 6142, c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 1; i++) if (a[i] + 2 === a[i + 1]) return true; return false; }],
  ['MOUNTAIN', 'Mountain', '🏔️', 5885, c => mountain(c.d)],
  ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, c => { if (c.len < 5 || c.distinct < 2) return false; for (let e = 0; e <= c.len - 5; e++) if (c.s[e + 2] === c.s[e] && c.s[e + 4] === c.s[e]) return true; return false; }],
  ['HIGH_ROLLER', 'High Roller', '🤑', 5120, c => /^[5-9]+$/.test(c.s)],
  ['VALLEY', 'Valley', '🏜️', 4199, c => valley(c.d)],
  ['MINI_ECHO', 'Mini Echo', '🔂', 3704, c => /(\d\d)\1/.test(c.s)],
  ['ALTERNATOR', 'Alternator', '⚡', 2845, c => alternator(c.d)],
  ['FLUSH', 'Flush', '🎨', 2845, c => allSameParity(c.d)],
  ['CONTIGUOUS_TRIPS', 'Contiguous Trips', '➖', 2784, c => /(\d)\1\1/.test(c.s)],
  ['DEEP_VOID', 'Deep Void', '🕳️', 2784, c => c.has('00')],
  ['FEATHER', 'Feather', '🪶', 2667, c => c.sum < 15],
  ['BLACKJACK', 'Blackjack', '♠️', 2521, c => c.sum === 21],
  ['BOAT', 'Full House', '🏠', 2397, c => { const v = Object.values(c.counts).sort((a, b) => b - a); return v[0] >= 3 && (v[1] || 0) >= 2; }],
  ['POCKET_MIRROR', 'Pocket Mirror', '🪞', 2124, c => { for (let L = 4; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isPalindromeStr(c.s.slice(i, i + L))) return true; return false; }],
  ['SNAKE_EYES', 'Snake Eyes', '🎲', 2121, c => { if ((c.counts[1] || 0) !== 2) return false; for (const k in c.counts) if (k !== '1' && c.counts[k] >= 2) return false; return true; }],
  ['NICE', 'Nice', '😏', 2024, c => c.has('69')],
  ['MEANING', 'Meaning of Life', '🌌', 2024, c => c.has('42')],
  ['SIXTY_SEVEN', 'Six-Seven', '🫠', 2024, c => c.has('67')],
  ['EIGHTY_SIX', 'Eighty-Six', '🍽️', 2024, c => c.has('86')],
  ['BALANCED', 'Balanced', '⚖️', 1959, c => {
    if (c.len < 2 || c.len % 2 !== 0) return false; // prod: even length only
    const h = c.len / 2;
    let a = 0, b = 0;
    for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[h + i]; }
    return a === b;
  }],
  ['RHYME', 'Rhyme', '🎶', 1872, c => {
    // Same 2+ digit substring appears twice WITHOUT overlapping (so "00" inside "000"
    // does not count - that's why 455000 gets no Rhyme).
    for (let L = 2; L <= c.len - 1; L++)
      for (let i = 0; i + L <= c.len; i++)
        if (c.s.indexOf(c.s.slice(i, i + L), i + L) !== -1) return true;
    return false;
  }],
  ['SEQUENCE_3', 'Sequence (3)', '🔢', 1716, c => pHasSequence(c.s, 3, false)],
  ['CONSEC_PAIR_ADJACENT', '2 Consecutive Numbers (Contains)', '🔗', 1659, c => pPairAdjacent(c.s) !== null],
  ['CONSEC_PAIR_NEARBY', '2 Consecutive Numbers (Nearby)', '🔗', 1575, c => pPairNearby(c.s) !== null],
  ['MESA', 'Mesa', '🗻', 1568, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a > b) { if (fell) return false; rose = true; } else if (a < b) fell = true; } return rose && fell; }],
  ['PRIME', 'Prime Number', '💎', 1274, c => isPrime(c.n)],
  ['TRINITY', 'Trinity', '⚜️', 1265, c => c.distinct === 3],
  ['DOZEN', 'Dozen', '🍩', 1200, c => c.n > 0 && c.n % 12 === 0],
  ['CANYON', 'Canyon', '🪨', 1184, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a < b) { if (rose) return false; fell = true; } else if (a > b) rose = true; } return rose && fell; }],
  ['FIVE_DIGITS', 'Five Digits', '🖐️', 1111, c => c.len === 5],
  ['ELEVEN', 'Eleven', '🕚', 1100, c => c.n > 0 && c.n % 11 === 0],
  ['HARSHAD', 'Harshad Number', '🤝', 1048, c => c.sum > 0 && c.n % c.sum === 0],
  ['CLEAN', 'Clean', '🧼', 1000, c => c.s.endsWith('0')],
  ['SEMI_CLEAN', 'Semi-Clean', '🧹', 1000, c => c.s.endsWith('5')],
  ['EQUILIBRIUM', 'Equilibrium', '🧘', 1000, c => c.len >= 2 && c.d[0] === c.d[c.len - 1]],
  ['SANDWICH', 'Sandwich', '🥪', 1000, c => c.len >= 3 && c.d[0] === c.d[c.len - 1] && c.d.slice(1, -1).some(x => x !== c.d[0])],

  // --- Common ---
  ['HILLS', 'Hills', '🏞️', 733, c => c.len >= 4 && hills(c.d)], // prod requires length >= 4
  ['TRIPS', 'Three of a Kind', '🎰', 724, c => c.countExact(3) > 0], // exactly 3 (a quad is not trips)
  ['LUCKY_SEVEN_DIV', 'Lucky Seven (Divisible)', '🎰', 700, c => c.n > 0 && c.n % 7 === 0],
  ['HETEROGENEOUS', 'Heterogeneous', '🥗', 593, c => c.distinct === c.len],
  ['MINI_SCRAMBLE', 'Mini Scramble', '🧩', 579, c => { for (let L = 3; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isScrambledSeq(c.s.slice(i, i + L), 3)) return true; return false; }],
  ['GAP_ONE', 'Gap One', '↕️', 529, c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1],
  ['TWO_PAIR', 'Two Pair', '👯‍♀️', 447, c => c.countExact(2) >= 2],
  ['DUNES', 'Dunes', '🐫', 364, c => { let coll = c.s[0] ?? ''; for (let i = 1; i < c.len; i++) if (c.s[i] !== c.s[i - 1]) coll += c.s[i]; if (coll.length < 4) return false; for (let i = 2; i < coll.length; i++) { const p = +coll[i - 2], q = +coll[i - 1], r = +coll[i], a = q - p, b = r - q; if (a > 0 && b > 0 || a < 0 && b < 0) return false; } return true; }],
  ['HOPSCOTCH', 'Hopscotch', '🦘', 312, c => {
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
  ['GHOST', 'Ghost', '👻', 309, c => (c.counts[0] || 0) === 1],
  ['QUARTET', 'Quartet', '🎻', 290, c => c.distinct === 4],
  ['HYDROGEN', 'Hydrogen (1)', '💧', 282, c => (c.counts[1] || 0) === 1],
  ['HELIUM', 'Helium (2)', '🎈', 282, c => (c.counts[2] || 0) === 1],
  ['CARBON', 'Carbon (6)', '✏️', 282, c => (c.counts[6] || 0) === 1],
  ['OXYGEN', 'Oxygen (8)', '💨', 282, c => (c.counts[8] || 0) === 1],
  ['LITHIUM', 'Lithium (3)', '🔋', 282, c => (c.counts[3] || 0) === 1],
  ['BERYLLIUM', 'Beryllium (4)', '💎', 282, c => (c.counts[4] || 0) === 1],
  ['BORON', 'Boron (5)', '🧼', 282, c => (c.counts[5] || 0) === 1],
  ['NITROGEN', 'Nitrogen (7)', '❄️', 282, c => (c.counts[7] || 0) === 1],
  ['FLUORINE', 'Fluorine (9)', '🦷', 282, c => (c.counts[9] || 0) === 1],
  ['GROUNDED', 'Grounded', '⚓', 250, c => c.len >= 2 && c.d[0] < c.d[c.len - 1]],
  ['CONTIGUOUS_PAIR', 'Contiguous Pair', '🫂', 249, c => /(\d)\1/.test(c.s)],
  ['LUCKY_7', 'Lucky Seven', '7️⃣', 213, c => c.has('7')],
  ['EVEN', 'Even', '⚖️', 200, c => c.n % 2 === 0],
  ['ODD', 'Odd', '🦄', 200, c => c.n % 2 === 1],
  ['LIFTOFF', 'Liftoff', '🚀', 200, c => c.len >= 2 && c.d[0] > c.d[c.len - 1]],
  ['VOID', 'Void', '🕳️', 167, c => !c.has('0')],
  ['NEIGHBORS', 'Neighbors', '🏘️', 161, c => {
    for (let i = 0; i + 1 < c.len; i++) if (Math.abs(c.d[i] - c.d[i + 1]) === 1) return true; // adjacent positions only
    return false;
  }],
  // CSV lists Pair at 120, but the live game scores it 0 (see the "Pair Fix" toggle /
  // the pairFix option in compute()). Inferred from prod: 634700 = 18,194.
  ['PAIR', 'Pair', '👯', 120, c => c.maxCount >= 2],
  ['SIX_DIGITS', 'Six Digits', '🐝', 111, c => c.len === 6],
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
  ONE_MILLION: 'The number one million.',
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
  // --- 2026-07-16 batch ---
  STEPS: 'Digits never decrease.',
  SLOPES: 'Digits never increase.',
  MESA: 'Digits rise to a peak, then fall (flat stretches allowed).',
  CANYON: 'Digits fall to a floor, then rise (flat stretches allowed).',
  DUNES: 'Rises and falls keep alternating (flat stretches allowed).',
  POCKET_MIRROR: 'Contains a palindrome of 4 or more digits.',
  ARITHMETIC: 'Splits into three or more numbers with a constant difference.',
  GEOMETRIC: 'Splits into three or more numbers with a constant ratio.',
  EQUATION: 'Insert one of + − × ÷ and an equals sign to make a true equation.',
  FIVE_OF_A_KIND: 'Contains five identical digits.',
  FRAMED_QUAD: 'Four of a kind in the middle, bookended by different digits.',
  OUROBOROS: 'A number raised to itself: nⁿ (1¹, 2², … 7⁷).',
  POWER_OF_FIVE: 'A power of 5 (5ⁿ).',
  POWER_OF_SEVEN: 'A power of 7 (7ⁿ).',
  TAU: 'Exactly τ (6283, 62831, or 628318).',
  TAU_SLICE_4: 'Contains "6283".',
  TAU_SLICE_5: 'Contains "62831".',
  GOLDEN_RATIO: 'Exactly φ (1618, 16180, or 161803).',
  ALWAYS: 'Exactly "247365" or "365247" (24/7, 365).',
  FULL_DAY: 'Exactly "86400", the number of seconds in a day.',
  FOOTBALL_17776: 'Exactly "17776".',
  ERROR_EXACT: 'Exactly "404".',
  INFERNAL: 'Exactly "666666".',
  ULTIMEME: 'Contains both "69" and "420".',
  ULTIMEME_EXACT: 'Exactly "69420" or "42069".',
  MINI_SCRAMBLE: 'Contains 3 or more adjacent digits that form a run when sorted.',
};

// PROBABILITIES (exact share of all 1,000,001 inputs 0..1,000,000 that earn each
// badge, as a percent) is generated by research/gen-snapshot.mjs (`npm run gen`)
// from a full-range scan - it self-corrects whenever a badge test changes.
// (The previous hand-embedded copy had drifted badly from the prod-parity rules.)

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
// extracted from the live game's BADGE_DEFINITIONS (40 families / 161 badges); the remaining
// 69 badges are standalone and always score. Member order is irrelevant - the scorer keeps
// the max-EP member - but each family is listed highest-EP first for readability.
const FAMILIES = [
  ['THIRTEENTH_POWER', 'SEVENTEENTH_POWER', 'NINETEENTH_POWER', 'TENTH_POWER', 'ELEVENTH_POWER', 'NINTH_POWER', 'EIGHTH_POWER', 'SEVENTH_POWER', 'SIXTH_POWER', 'FIFTH_POWER', 'FOURTH_POWER', 'CUBE', 'SQUARE', 'OUROBOROS'], // POWER
  ['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR', 'DIGIT_FIVE', 'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE', 'ONE_DIGIT'], // SINGLE_DIGIT
  ['CONSEC_QUAD_EXACT', 'CONSEC_QUAD_CONTAINS', 'CONSEC_QUAD_SCRAMBLED', 'CONSEC_TRIPLE_EXACT', 'CONSEC_TRIPLE_SCRAMBLED', 'CONSEC_TRIPLE_CONTAINS', 'CONSEC_PAIR_EXACT', 'CONSEC_PAIR_ADJACENT', 'CONSEC_PAIR_NEARBY'], // CONSECUTIVE
  ['SEQUENCE_6', 'CASCADE', 'WATERFALL', 'EVEN_SPACING', 'EVEN_SPACING_ABS', 'TURTLE', 'SEQUENCE_4', 'SCRAMBLE', 'SEQUENCE_3', 'GEOMETRIC', 'ARITHMETIC', 'MINI_SCRAMBLE'], // PROGRESSION
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
  ['CALENDAR_EXACT', 'GROUNDHOG_DAY', 'CALENDAR', 'ALWAYS'], // CALENDAR
  ['EMERGENCY_EXACT', 'MAYDAY', 'EMERGENCY'], // EMERGENCY
  ['FRAMED_TRIPLE', 'FRAMED_QUAD', 'QUADS', 'FIVE_OF_A_KIND', 'TRIPS'], // OF_A_KIND
  ['ROYAL_FLUSH', 'STRAIGHT_FLUSH', 'STRAIGHT'], // STRAIGHT
  ['BIG_BROTHER_EXACT', 'BIG_BROTHER'], // BIG_BROTHER
  ['CONTIGUOUS_BOAT', 'BOAT'], // BOAT
  ['DEVIL_EXACT', 'INFERNAL', 'DEVIL'], // DEVIL
  ['FIREFLY', 'DUALITY'], // DUALITY
  ['EIGHTY_SIX_EXACT', 'EIGHTY_SIX'], // EIGHTY_SIX
  ['EQUILIBRIUM', 'SANDWICH'], // EQUILIBRIUM
  ['EXACT_HELL', 'HELL'], // HELL
  ['DOUBLE_HOP', 'HOPSCOTCH'], // HOPSCOTCH
  ['LEET_EXACT', 'LEET'], // LEET
  ['UNIVERSAL_ANSWER', 'DEEPER_MEANING'], // MEANING
  ['ASCENSION', 'DECAY', 'STEPS', 'SLOPES'], // MONOTONIC
  ['ORIENTATION_EXACT', 'ORIENTATION'], // ORIENTATION
  ['MOUNTAIN', 'VALLEY', 'MESA', 'CANYON'], // PEAK
  ['MINI_ECHO', 'RHYME'], // REPEAT
  ['TREE_FIDDY_EXACT', 'TREE_FIDDY'], // TREE_FIDDY
  ['ERROR_EXACT', 'ERROR'], // ERROR (2026-07-16)
  ['HILLS', 'DUNES'], // HILLS (2026-07-16)
  ['PALINDROME', 'POCKET_MIRROR'], // PALINDROME (2026-07-16)
  ['TAU', 'TAU_SLICE_5', 'TAU_SLICE_4'], // TAU (2026-07-16)
  ['ULTIMEME_EXACT', 'ULTIMEME'], // ULTIMEME (2026-07-16)
];

// Display names for FAMILIES, index-aligned with the array above (same order as
// prod's family tags). Only used by the /badges index page.
const FAMILY_NAMES = [
  'Power', 'Single Digit', 'Consecutive', 'Progression', 'Pairs', 'Boob', 'Botanist',
  'Jackpot', 'Contiguous Run', 'E', 'Nice', 'Nine Ending', 'Pi', 'Sixty-Seven',
  'Void Depth', 'Bookends', 'Calendar', 'Emergency', 'Of a Kind', 'Straight',
  'Big Brother', 'Boat', 'Devil', 'Duality', 'Eighty-Six', 'Equilibrium', 'Hell',
  'Hopscotch', 'Leet', 'Meaning', 'Monotonic', 'Orientation', 'Peak', 'Repeat',
  'Tree Fiddy', 'Error', 'Hills', 'Palindrome', 'Tau', 'Ultimeme',
];

// Badges added to this tool after the initial full-parity port, keyed to the date we
// added them here. Powers the "Newly added" section + per-card markers on /badges.
// When a fresh batch lands (see CLAUDE.md), append entries with the new date and bump
// LATEST_BADGE_BATCH so only the most recent batch gets the highlight.
const BADGE_ADDED = {
  STEPS: '2026-07-16', SLOPES: '2026-07-16', MESA: '2026-07-16', CANYON: '2026-07-16',
  DUNES: '2026-07-16', POCKET_MIRROR: '2026-07-16', ARITHMETIC: '2026-07-16',
  GEOMETRIC: '2026-07-16', EQUATION: '2026-07-16', FIVE_OF_A_KIND: '2026-07-16',
  FRAMED_QUAD: '2026-07-16', OUROBOROS: '2026-07-16', POWER_OF_FIVE: '2026-07-16',
  POWER_OF_SEVEN: '2026-07-16', TAU: '2026-07-16', TAU_SLICE_4: '2026-07-16',
  TAU_SLICE_5: '2026-07-16', GOLDEN_RATIO: '2026-07-16', ALWAYS: '2026-07-16',
  FULL_DAY: '2026-07-16', FOOTBALL_17776: '2026-07-16', ERROR_EXACT: '2026-07-16',
  INFERNAL: '2026-07-16', ULTIMEME: '2026-07-16', ULTIMEME_EXACT: '2026-07-16',
  MINI_SCRAMBLE: '2026-07-16',
};
// Badges added on this date get the "Newly added" treatment on /badges.
const LATEST_BADGE_BATCH = '2026-07-16';

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
  for (const [id, label, emoji, ep, test] of BADGES) {
    let ok = false;
    try { ok = test(c); } catch (e) { ok = false; }
    if (ok) earned.push({ id, label, emoji, ep, rarity: rarityFromScore(ep), desc: DESCRIPTIONS[id], prob: PROBABILITIES[id] });
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
// Computing all 1,000,000 numbers x 230 badge tests is far beyond a single
// Worker request's CPU budget, so the analysis runs client-side in a Web Worker.
// Rather than duplicate the 200+ badge rules, we GENERATE a self-contained ES
// module from the live definitions via Function.prototype.toString(). Any edit to
// a `test` function above automatically flows into this engine - no second copy.
// ---------------------------------------------------------------------------

// The two functions below never run in the Cloudflare Worker: like analysisWorker /
// gridClient, they are serialized into the generated engine module and only execute in
// the browser, where computeLean / BADGE_META and the Worker API exist. Kept as real
// source (rather than strings inside engineModuleSource) so they stay readable.

// Sweep lo..hi inclusive in the CALLING thread, packing per-number results:
//   ep[k]   total EP,   cnt[k]  number of badges earned,   bits[k*ROW..]  earned bitmask
// exPerBadge > 0 also collects the first N [n, ep] earners per badge within the range.
function sweepRange(lo, hi, ROW, exPerBadge) {
  const N = hi - lo + 1;
  const ep = new Float64Array(N), cnt = new Uint8Array(N), bits = new Uint8Array(N * ROW);
  const examples = exPerBadge ? BADGE_META.map(() => []) : null;
  for (let n = lo; n <= hi; n++) {
    const r = computeLean(n), earned = r.earned, k = n - lo, base = k * ROW;
    ep[k] = r.ep; cnt[k] = earned.length;
    for (let j = 0; j < earned.length; j++) {
      const bi = earned[j];
      bits[base + (bi >> 3)] |= (1 << (bi & 7));
      if (examples && examples[bi].length < exPerBadge) examples[bi].push([n, r.ep]);
    }
  }
  return { ep, cnt, bits, examples };
}

// Parallel version of sweepRange: cuts the range into chunks and farms them out to shard
// workers - this same engine module, loaded under the name 'rngdle-shard' (see the
// epilogue in engineModuleSource) - so the badge engine exists in exactly one place.
// More chunks than workers, handed out on demand, keeps every core busy to the end.
// Falls back to sweeping in the calling thread when nested workers are unavailable
// (older Safari) or a shard fails; the stitched result is identical either way.
// onProgress(fraction) fires as chunks land.
async function sweepAll(engineUrl, lo, hi, exPerBadge, onProgress) {
  const ROW = (BADGE_META.length + 7) >> 3;
  const N = hi - lo + 1, CHUNK = 25000;
  const ep = new Float64Array(N), cnt = new Uint8Array(N), bits = new Uint8Array(N * ROW);
  const chunks = [];
  for (let s = lo; s <= hi; s += CHUNK) chunks.push([s, Math.min(s + CHUNK - 1, hi)]);
  const chunkEx = new Array(chunks.length);
  let done = 0;
  const absorb = (ci, r) => {
    const k = chunks[ci][0] - lo;
    ep.set(r.ep, k); cnt.set(r.cnt, k); bits.set(r.bits, k * ROW);
    chunkEx[ci] = r.examples;
    if (onProgress) onProgress(++done / chunks.length);
  };

  let pool = [], shardUrl = null;
  const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
  const want = Math.min(chunks.length, Math.max(1, hw - 1));
  try {
    if (want > 1 && typeof Worker !== 'undefined') {
      // Fetch the engine source ONCE and start every shard from a single blob. Pointing
      // the shards at engineUrl directly would ask for it once per core - the shards are
      // constructed together, so they would race the HTTP cache rather than share it -
      // and this also guarantees every shard runs byte-identical code.
      shardUrl = URL.createObjectURL(new Blob([await (await fetch(engineUrl)).text()], { type: 'text/javascript' }));
      for (let i = 0; i < want; i++) pool.push(new Worker(shardUrl, { type: 'module', name: 'rngdle-shard' }));
    }
  } catch (e) { pool.forEach(w => w.terminate()); pool = []; }  // no nested workers here

  if (pool.length) {
    const pending = new Set(chunks.keys());
    let next = 0;
    try {
      await new Promise((resolve, reject) => {
        const feed = w => { if (next < chunks.length) { const ci = next++; w.postMessage({ ci, lo: chunks[ci][0], hi: chunks[ci][1], ROW, exPerBadge }); } };
        for (const w of pool) {
          w.onmessage = ev => {
            const m = ev.data;
            absorb(m.ci, { ep: new Float64Array(m.ep), cnt: new Uint8Array(m.cnt), bits: new Uint8Array(m.bits), examples: m.examples });
            pending.delete(m.ci);
            if (!pending.size) resolve(); else feed(w);
          };
          w.onerror = reject;
          feed(w);
        }
      });
    } catch (e) {
      next = chunks.length;                      // stop feeding, finish what's left here
    }
    pool.forEach(w => w.terminate());
    for (const ci of pending) absorb(ci, sweepRange(chunks[ci][0], chunks[ci][1], ROW, exPerBadge));
  } else {
    for (let ci = 0; ci < chunks.length; ci++) absorb(ci, sweepRange(chunks[ci][0], chunks[ci][1], ROW, exPerBadge));
  }
  if (shardUrl) URL.revokeObjectURL(shardUrl);

  // Chunk examples are per-chunk firsts; stitch in range order for the overall firsts.
  let examples = null;
  if (exPerBadge) {
    examples = BADGE_META.map(() => []);
    for (const per of chunkEx)
      for (let i = 0; i < examples.length; i++)
        for (const e of per[i]) { if (examples[i].length >= exPerBadge) break; examples[i].push(e); }
  }
  return { ep, cnt, bits, ROW, examples };
}

// The one full-range sweep that /, /grid and /chains all share. Lives in the engine
// module (every worker already imports it), so the three pages hit one IndexedDB entry
// instead of sweeping separately into two of their own.
//
// It always sweeps the SUPERSET of what the three need - 0..1,000,000 inclusive, with
// per-badge examples - because /analyze needs exactly that and the other two are strict
// subsets (they take .subarray(0, 1e6) and ignore `examples`). Anything a page can
// recompute from these arrays in a 1M-element loop (digit lengths, min/max, n -> EP
// edges) is derived on load rather than stored; at single-digit milliseconds it is far
// cheaper than the megabytes it would add.
function sweepCacheSource() {
  return `
const SWEEP_DB = 'rngdle', SWEEP_STORE = 'ds', SWEEP_KEY = 'sweep-v1';
const SWEEP_CAP = 1000001;              // 0..1,000,000 inclusive - the live roll range
const SWEEP_EX_PER_BADGE = 12;          // examples[badgeIdx] = [[n, ep], ...], capped
const SWEEP_TTL_MS = 7 * 86400000;      // belt-and-braces; VER is what guarantees freshness
// Superseded by SWEEP_KEY - drop them so a returning visitor gets ~26MB back.
const SWEEP_LEGACY_DBS = ['rngdle-analysis', 'rngdle-grid'];

function sweepIdbReq(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function sweepIdbStore(mode) {
  return new Promise((res, rej) => {
    const o = indexedDB.open(SWEEP_DB, 1);
    o.onupgradeneeded = () => o.result.createObjectStore(SWEEP_STORE);
    o.onsuccess = () => res(o.result.transaction(SWEEP_STORE, mode).objectStore(SWEEP_STORE));
    o.onerror = () => rej(o.error);
  });
}
async function sweepCacheGet() { try { return await sweepIdbReq((await sweepIdbStore('readonly')).get(SWEEP_KEY)); } catch (e) { return null; } }
async function sweepCachePut(v) { try { await sweepIdbReq((await sweepIdbStore('readwrite')).put(v, SWEEP_KEY)); } catch (e) {} }
async function sweepCachePurge() { try { await sweepIdbReq((await sweepIdbStore('readwrite')).delete(SWEEP_KEY)); } catch (e) {} }
function sweepDropLegacy() { for (const n of SWEEP_LEGACY_DBS) { try { indexedDB.deleteDatabase(n); } catch (e) {} } }

// Cache key: a hash of engine.js, so any scoring edit invalidates every page at once.
async function sweepVersion(origin) {
  try {
    const t = await (await fetch(origin + '/engine.js')).text();
    let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return h.toString(36) + '.' + t.length;
  } catch (e) { return 'na'; }
}

function sweepFresh(hit, ver) {
  return !!hit && hit.ver === ver && hit.ep && hit.ep.length === SWEEP_CAP &&
    (Date.now() - hit.ts) < SWEEP_TTL_MS;
}

// { ep, cnt, bits, ROW, examples, ver, ts, cached }.
// onProgress(pct) fires only when an actual sweep runs.
async function sweepShared(origin, onProgress, force) {
  const ver = await sweepVersion(origin);
  if (!force) {
    const hit = await sweepCacheGet();
    if (sweepFresh(hit, ver)) { sweepDropLegacy(); return { ...hit, cached: true }; }
  }

  // Two tabs opened cold (say /grid and /chains) would otherwise each run the full
  // sweep. Hold a lock across it so the second waits and then reads the cache.
  const run = async () => {
    if (!force) {
      const hit = await sweepCacheGet();          // the lock holder may have just written it
      if (sweepFresh(hit, ver)) return { ...hit, cached: true };
    }
    const swept = await sweepAll(origin + '/engine.js', 0, SWEEP_CAP - 1, SWEEP_EX_PER_BADGE, onProgress);
    const rec = { ver, ts: Date.now(), ep: swept.ep, cnt: swept.cnt, bits: swept.bits,
                  ROW: swept.ROW, examples: swept.examples };
    await sweepCachePut(rec);
    sweepDropLegacy();
    return { ...rec, cached: false };
  };
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('rngdle-sweep', run);
  }
  return run();
}
`;
}

function engineModuleSource() {
  // Named function declarations (hoisted) used by the badge tests.
  const named = [
    ipow, isPerfectPower, isPowerOf, isPrime, partitions, consecAsc, consecScrambled,
    containsConsec, pairNearby, seqAsc, straightRun, mountain, valley, hills,
    runLengths, strobogrammatic,
    // prod-ported helpers (must ship to the browser engine too)
    pLeadingZero, pMultiPart, pConsecSet, pDigitCounts, pContig, pOrdered, pHasSequence,
    pPairExact, pTripleExact, pQuadExact, pTripleExactScan, pQuadExactScan, pPairAdjacent, pPairNearby,
    pNAdjacentBuild, pNAdjacentAt, pNAdjacent, pContigPairStarts,
    // 2026-07-16 batch helpers (Metronome / Crescendo / Equation / Pocket Mirror / Mini Scramble)
    pSplitParts, findArithmeticSplit, findGeometricSplit, findEquation, isPalindromeStr, isScrambledSeq,
    // full-range sweep (used by /analyze and /grid, and by this module in shard mode)
    sweepRange, sweepAll,
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
    `${b[3]},${b[4].toString()}]`
  ).join(',\n') + '\n];';

  const supSrc = `const FAMILIES = ${JSON.stringify(FAMILIES)};`;

  // Lean compute: post-supersession total EP + earned badge indices, no UI metadata.
  // CARD_TIERS/cardTier are serialized from the server constants (not re-declared) so the
  // browser's rarity breakdown uses the exact same cutoffs as the /beta card renderer.
  const rest = `
const CARD_TIERS = ${JSON.stringify(CARD_TIERS)};
const CARD_TIER_NAMES = [${CARD_TIERS.map(t => JSON.stringify(t[1])).join(',')},"mythic"];
function cardTier(ep) { for (const [t, name] of CARD_TIERS) if (ep < t) return name; return 'mythic'; }
const BADGE_RARITY_THRESHOLDS = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 };
function tierFromScore(ep){const t=BADGE_RARITY_THRESHOLDS;return ep<t.common?'common':ep<t.uncommon?'uncommon':ep<t.rare?'rare':ep<t.epic?'epic':ep<t.anomaly?'anomaly':'mythic';}
function rarityFromScore(ep){const t=tierFromScore(ep);return t.charAt(0).toUpperCase()+t.slice(1);}
const BADGE_META = BADGES.map(b => ({ id: b[0], label: b[1], emoji: b[2], rarity: rarityFromScore(b[3]) }));
const SUP_INDEX = (() => {
  const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
  return FAMILIES.map(g => g.map(id => idToIdx.get(id)).filter(i => i !== undefined));
})();

// Flat lookup tables for the sweep hot loop: computeLean runs 1,000,001 times, so the
// per-badge property loads (BADGES[i][3] / [4]) and the family lookup are hoisted out.
const BADGE_EP = Float64Array.from(BADGES, b => b[3]);
const BADGE_TEST = BADGES.map(b => b[4]);
const FAM_OF = (() => {                       // badge index -> family index, -1 = standalone
  const a = new Int16Array(BADGES.length).fill(-1);
  SUP_INDEX.forEach((g, f) => g.forEach(i => { a[i] = f; }));
  return a;
})();
// Scratch: winning (max-EP) earned member per family, or -1. Reused across calls -
// computeLean is synchronous, so it is always refilled before it is read.
const FAM_TOP = new Int32Array(SUP_INDEX.length);

function computeLean(n) {
  const s = String(n);
  const len = s.length;
  const d = new Array(len);
  const counts = {};
  let sum = 0, prod = 1;
  for (let i = 0; i < len; i++) {
    const x = s.charCodeAt(i) - 48;
    d[i] = x; sum += x; prod *= x;
    counts[x] = (counts[x] || 0) + 1;
  }
  let distinct = 0, maxCount = 0;
  for (const k in counts) { distinct++; if (counts[k] > maxCount) maxCount = counts[k]; }
  const c = {
    n, s, len, d, counts, distinct, sum, prod, maxCount,
    has: sub => s.includes(sub),
    cnt: digit => counts[digit] || 0,
    withCount: k => Object.values(counts).filter(v => v >= k).length,
    countExact: k => Object.values(counts).filter(v => v === k).length,
    runs: runLengths(s),
  };
  // One pass: run every test, and fold supersession in as we go (per family, the
  // max-EP earned member wins, first-on-tie - same rule as compute()).
  const earned = [];
  let total = 0;
  FAM_TOP.fill(-1);
  for (let i = 0; i < BADGE_TEST.length; i++) {
    let ok = false;
    try { ok = BADGE_TEST[i](c); } catch (e) { ok = false; }
    if (!ok) continue;
    earned.push(i);
    const f = FAM_OF[i];
    if (f < 0) { total += BADGE_EP[i]; continue; } // standalone badges always score
    const top = FAM_TOP[f];
    if (top < 0 || BADGE_EP[i] > BADGE_EP[top]) FAM_TOP[f] = i; // strict > keeps first of a tie
  }
  for (let f = 0; f < FAM_TOP.length; f++) if (FAM_TOP[f] >= 0) total += BADGE_EP[FAM_TOP[f]];
  return { ep: total, earned };
}

export { computeLean, BADGE_META, sweepRange, sweepAll, CARD_TIERS, CARD_TIER_NAMES, cardTier,
         sweepShared, sweepCachePurge, SWEEP_CAP, SWEEP_EX_PER_BADGE };

// Shard mode: when this module is loaded as a Worker named 'rngdle-shard' (which is how
// sweepAll fans a sweep across cores) it answers range requests instead of just being
// imported for its exports. Loaded any other way - a plain import from /analyze, /grid,
// or the page - self.name is '' and this does nothing.
if (typeof self !== 'undefined' && self.name === 'rngdle-shard') {
  self.onmessage = (ev) => {
    const m = ev.data;
    const r = sweepRange(m.lo, m.hi, m.ROW, m.exPerBadge);
    self.postMessage({ ci: m.ci, ep: r.ep.buffer, cnt: r.cnt.buffer, bits: r.bits.buffer, examples: r.examples },
      [r.ep.buffer, r.cnt.buffer, r.bits.buffer]);
  };
}
`;
  // __name shim: when this Worker is bundled (esbuild keepNames), function source returned
  // by toString() contains __name(fn,"fn") calls. That helper only exists in the bundled
  // scope, so we redefine a no-op here for the browser module context. Harmless unbundled.
  return ['var __name = (f) => f;', namedSrc, constSrc, dataSrc, badgesSrc, supSrc,
    sweepCacheSource(), rest].join('\n');
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
  const LRANGE = { 1: [0, 9], 2: [10, 99], 3: [100, 999], 4: [1000, 9999], 5: [10000, 99999], 6: [100000, 999999], 7: [1000000, 1000000] };
  const LSIZE = { 1: 10, 2: 90, 3: 900, 4: 9000, 5: 90000, 6: 900000, 7: 1 };
  // Card-rarity cutoffs, lifted from the engine module so the breakdown uses the same
  // tiers as the number card. TCUT[i] is the exclusive EP ceiling of tier i; anything at
  // or above the last cutoff is the top tier (mythic), hence NT = TCUT.length + 1 tiers.
  let TCUT = null, TNAMES = null, NT = 0;
  async function engine() {
    if (!E) {
      E = await import(origin + '/engine.js');
      TCUT = E.CARD_TIERS.map(t => t[0]); TNAMES = E.CARD_TIER_NAMES; NT = TNAMES.length;
    }
    return E;
  }
  // Tier index (0 = trash … NT-1 = mythic) for a total-EP value. Inlined cutoff scan
  // rather than E.cardTier() since this runs once per number in the filter loop.
  function tierOf(v) { for (let i = 0; i < TCUT.length; i++) if (v < TCUT[i]) return i; return TCUT.length; }
  // Bitmask of tiers to keep. Empty/missing means "all tiers".
  function tierMaskOf(tiers) {
    if (!tiers || !tiers.length) return -1 >>> 0;
    let m = 0; for (const t of tiers) m |= (1 << t); return m;
  }
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
        await engine();
        await E.sweepCachePurge();
        self.postMessage({ type: 'purged' });
        return;
      }

      if (m.cmd === 'compute') {
        await engine();
        lastStride = 1; lastLengths = [1, 2, 3, 4, 5, 6]; lastSampled6 = false;

        // The shared sweep (engine.js) already covers 0..1,000,000 with examples, which is
        // exactly this page's domain - /grid and /chains read the same cached entry. Length
        // 7 is the single 7-digit value 1,000,000, the top of the live game's roll range.
        const swept = await E.sweepShared(origin, pct => self.postMessage({ type: 'progress', pct }), m.force);
        const cap = swept.ep.length;
        ROW = swept.ROW;                           // bytes of badge bitmask per number
        epArr = swept.ep; bits = swept.bits; examples = swept.examples;

        // Derived, not stored: at 1M elements this is a few ms, against 5MB of cache.
        // The sweep is contiguous and ascending, so slot k is simply the number k.
        const lengths = [1, 2, 3, 4, 5, 6, 7];
        lenArr = new Uint8Array(cap);
        idxArr = new Int32Array(cap);
        let maxEP = 0;
        for (const L of lengths) {
          const hi = Math.min(LRANGE[L][1], cap - 1);
          for (let n = LRANGE[L][0]; n <= hi; n++) { lenArr[n] = L; idxArr[n] = n; }
        }
        for (let k = 0; k < cap; k++) if (epArr[k] > maxEP) maxEP = epArr[k];
        count = cap; computedMax = maxEP;

        self.postMessage({ type: 'computed', count, maxEP, lengths, domainTrue: count,
          cached: swept.cached, ts: swept.ts });
        return;
      }

      if (m.cmd === 'filter') {
        const badges = m.badges || [], exclude = m.exclude || [];
        const lenMask = lengthMask(m.lengths);     // which digit-lengths to include (bitmask over 1..7)
        const epMin = (m.epMin == null) ? -Infinity : m.epMin;   // "scores more than" (exclusive)
        const epMax = (m.epMax == null) ? Infinity : m.epMax;    // "and less than" (exclusive)
        const epEq = (m.epEq == null) ? null : m.epEq;           // "scores exactly" (overrides the range)
        const tierMask = tierMaskOf(m.tiers);      // which rarity tiers to include
        const STEP = 0.25;                         // histogram resolution, in decades (dex)
        const MAXB = 2 + Math.ceil(Math.log10(Math.max(10, computedMax)) / STEP);
        // counts[bucket * NT + tier]: a quarter-decade bucket can straddle a tier cutoff
        // (the uncommon band is narrower than one bucket), so the bucket is tallied per
        // tier and drawn as a stacked bar rather than being assigned a single colour.
        const counts = new Float64Array(MAXB * NT);
        // Per-tier rollup. `tierAll` deliberately ignores the tier filter itself (facet
        // counts): with only "mythic" selected you still see how many of the numbers
        // matching the OTHER filters landed in each tier, so the breakdown stays useful
        // as a picker. tierSum/tierMin/tierMax describe the same (unfiltered-by-tier) set.
        const tierAll = new Float64Array(NT), tierSum = new Float64Array(NT);
        const tierMin = new Float64Array(NT).fill(Infinity), tierMax = new Float64Array(NT);
        let total = 0, raw = 0, sum = 0, mn = Infinity, mx = 0, domain = 0;
        for (let k = 0; k < count; k++) {
          if (!(lenMask & (1 << lenArr[k]))) continue;
          const v = epArr[k];
          if (epEq != null ? v !== epEq : (v <= epMin || v >= epMax)) continue;
          if (!matches(k, badges, exclude)) continue;
          const t = tierOf(v);
          domain++;
          tierAll[t]++; tierSum[t] += v;
          if (v < tierMin[t]) tierMin[t] = v;
          if (v > tierMax[t]) tierMax[t] = v;
          if (!(tierMask & (1 << t))) continue;
          const w = 1;                             // exhaustive sweep - every number counts once
          raw++; total += w; sum += v * w; if (v < mn) mn = v; if (v > mx) mx = v;
          let bidx = v <= 0 ? 0 : 1 + Math.floor(Math.log10(v) / STEP);
          if (bidx >= MAXB) bidx = MAXB - 1; if (bidx < 0) bidx = 0;
          counts[bidx * NT + t] += w;
        }
        const buckets = [];
        for (let i = 0; i < MAXB; i++) {
          const lo = i === 0 ? 0 : Math.pow(10, (i - 1) * STEP);
          const hi = i === 0 ? 0 : Math.pow(10, i * STEP);
          const byTier = Array.from(counts.subarray(i * NT, i * NT + NT));
          buckets.push({ i, lo, hi, count: byTier.reduce((a, b) => a + b, 0), byTier });
        }
        const tiers = [];
        for (let t = 0; t < NT; t++) tiers.push({
          tier: t, name: TNAMES[t], count: tierAll[t],
          share: domain ? tierAll[t] / domain : 0,
          mean: tierAll[t] ? tierSum[t] / tierAll[t] : 0,
          min: tierAll[t] ? tierMin[t] : 0, max: tierMax[t],
        });
        self.postMessage({ type: 'histogram', buckets, tiers, domain,
          stats: { total: Math.round(total), raw, mean: total ? sum / total : 0, min: raw ? mn : 0, max: mx, estimated: lastSampled6 } });
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
        const epEq = (m.epEq == null) ? null : m.epEq;
        const tierMask = tierMaskOf(m.tiers);
        const rows = [];
        for (let k = 0; k < count; k++) {
          if (!(lenMask & (1 << lenArr[k]))) continue;
          const v = epArr[k];
          if (epEq != null ? v !== epEq : (v <= epMin || v >= epMax)) continue;
          if (!matches(k, badges, exclude)) continue;
          const t = tierOf(v);
          if (!(tierMask & (1 << t))) continue;
          rows.push([idxArr[k], v, TNAMES[t]]);
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

// TIERS: card-rarity tiers low->high, injected from the server's CARD_TIERS/TIER_PALETTE
// as [{ key, label, accent, hl, lo, hi }] so the panel colours match the number card.
function analysisClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const panel = $('analysis'), btn = $('an-btn'), statusEl = $('an-status');
  const chartEl = $('an-chart'), statsEl = $('an-stats'), lenWrap = $('an-lengths');
  const badgeList = $('an-badge-list'), badgeSearch = $('an-badge-search'), purgeBtn = $('an-purge');
  const epMinEl = $('an-ep-min'), epMaxEl = $('an-ep-max'), epEqEl = $('an-ep-eq');
  const tierWrap = $('an-tiers'), tierOut = $('an-tier-breakdown');

  let worker = null, meta = [], computed = false, computing = false;
  const selectedBadges = new Set();   // require: matching numbers must earn these
  const excludedBadges = new Set();   // exclude: matching numbers must NOT earn these
  const offTiers = new Set();         // rarity tiers toggled OFF (empty = all tiers shown)

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

  // Rarity tier chips (trash..mythic, all on by default). Like lengths, tier is a pure
  // post-compute filter on the already-swept EP values - toggling never recomputes.
  TIERS.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'an-tier on';
    b.dataset.tier = i;
    b.textContent = t.label;
    b.title = t.label + ' - ' + tierRangeText(i);
    b.style.setProperty('--tc', t.accent);
    b.setAttribute('aria-pressed', 'true');
    tierWrap.appendChild(b);
  });
  tierWrap.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.an-tier');
    if (b) toggleTier(+b.dataset.tier);
  });
  // The breakdown rows under the chart are the same toggles, so a tier can be isolated
  // straight from the number it shows.
  tierOut.addEventListener('click', e => {
    const row = e.target.closest && e.target.closest('.an-tb-row');
    if (!row) return;
    // Shift-click isolates the tier; a plain click just includes/excludes it.
    const i = +row.dataset.tier;
    if (e.shiftKey) { offTiers.clear(); TIERS.forEach((_, j) => { if (j !== i) offTiers.add(j); }); syncTierChips(); scheduleFilter(); }
    else toggleTier(i);
  });
  function toggleTier(i) {
    if (offTiers.has(i)) offTiers.delete(i); else offTiers.add(i);
    if (offTiers.size === TIERS.length) offTiers.clear();   // never filter everything away
    syncTierChips();
    scheduleFilter();
  }
  function syncTierChips() {
    tierWrap.querySelectorAll('.an-tier').forEach(b => {
      const on = !offTiers.has(+b.dataset.tier);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    tierOut.querySelectorAll('.an-tb-row').forEach(r => r.classList.toggle('off', offTiers.has(+r.dataset.tier)));
  }
  function selectedTiers() { const out = []; TIERS.forEach((_, i) => { if (!offTiers.has(i)) out.push(i); }); return out; }
  function tierRangeText(i) {
    const t = TIERS[i];
    if (t.lo == null) return 'under ' + t.hi.toLocaleString() + ' EP';
    if (t.hi == null) return t.lo.toLocaleString() + ' EP and up';
    return t.lo.toLocaleString() + '-' + (t.hi - 1).toLocaleString() + ' EP';
  }

  // EP score range: keep only numbers whose total EP is more than min and/or less than
  // max - or exactly the "Scores exactly" value, which overrides the range while set
  // (the range inputs are disabled so the precedence is visible). Blank or non-numeric
  // means that bound is open. Re-filters instantly (no recompute).
  epMinEl.addEventListener('input', scheduleFilter);
  epMaxEl.addEventListener('input', scheduleFilter);
  epEqEl.addEventListener('input', () => {
    epMinEl.disabled = epMaxEl.disabled = epBounds().eq != null;
    scheduleFilter();
  });
  function epBounds() {
    const p = el => { const v = parseFloat(el.value); return Number.isFinite(v) && v >= 0 ? v : null; };
    return { min: p(epMinEl), max: p(epMaxEl), eq: p(epEqEl) };
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
  $('an-export-csv').addEventListener('click', () => { if (computed) { const ep = epBounds(); worker.postMessage({ cmd: 'exportFilter', badges: [...selectedBadges], exclude: [...excludedBadges], lengths: selectedLengths(), tiers: selectedTiers(), epMin: ep.min, epMax: ep.max, epEq: ep.eq }); } });

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
    statusEl.innerHTML = '<span class="spinner"></span><span class="an-ctext"></span>';
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
  function runFilter() { const ep = epBounds(); worker.postMessage({ cmd: 'filter', badges: [...selectedBadges], exclude: [...excludedBadges], lengths: selectedLengths(), tiers: selectedTiers(), epMin: ep.min, epMax: ep.max, epEq: ep.eq }); }

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
    else if (m.type === 'histogram') { renderChart(m.buckets, m.stats); renderTiers(m.tiers, m.domain); }
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
    const head = ['number,totalEP,rarity'];
    const body = m.rows.map(r => r[0] + ',' + Math.round(r[1]) + ',' + r[2]);
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
    const tierDesc = offTiers.size ? '\n# rarity tiers: ' + selectedTiers().map(i => TIERS[i].key).join(', ') : '';
    download(fname, '# ' + desc + epDesc + tierDesc + note + '\n' + head.concat(body).join('\n'), 'text/csv');
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
      // Each bar is stacked by rarity tier (lowest at the bottom), so the histogram reads
      // as a rarity breakdown even where a quarter-decade bucket straddles a tier cutoff -
      // which it always does for uncommon, a band narrower than one bucket. Bar HEIGHT is
      // log-scaled by the bucket total; the segments split that height by share of the
      // bucket, so a segment shows composition, not an absolute count. The tooltip has
      // the exact numbers.
      const rw = Math.max(0, bw - 2).toFixed(1), rx = (x + 1).toFixed(1);
      const parts = [];
      let off = 0;
      for (let t = 0; t < b.byTier.length; t++) {
        const c = b.byTier[t];
        if (!c) continue;
        const frac = c / b.count, segH = h * frac;
        // Stack upward from the baseline: lowest tier at the bottom of the bar.
        const segY = padT + plotH - off - segH;
        parts.push('<rect x="' + rx + '" y="' + segY.toFixed(1) + '" width="' + rw +
          '" height="' + Math.max(0, segH).toFixed(1) + '" fill="' + TIERS[t].accent + '"/>');
        off += segH;
      }
      if (!parts.length) parts.push('<rect x="' + rx + '" y="' + y.toFixed(1) + '" width="' + rw + '" height="0" fill="#4a4d55"/>');
      const mix = b.byTier.map((c, t) => c ? TIERS[t].label + ' ' + Math.round(c).toLocaleString() : null)
        .filter(Boolean).reverse().join(', ');
      svg += '<g><title>' + esc(label) + ': ' + Math.round(b.count).toLocaleString() + ' numbers (' +
        pct.toFixed(pct < 1 ? 2 : 1) + '%)\n' + esc(mix) + '</title>' + parts.join('') + '</g>';
      if (i % tickEvery === 0) {
        const lx = x + bw / 2, ly = padT + plotH + 12;
        const lab = b.i === 0 ? '0' : fmt(b.lo);
        svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#8b8e97" font-size="10" text-anchor="end" transform="rotate(-45 ' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ')">' + lab + '</text>';
      }
    });
    svg += '<text x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" fill="#8b8e97" font-size="11" text-anchor="middle">Total EP (log scale) - bar height = count (log scale), stacked by rarity tier</text>';
    svg += '</svg>';
    chartEl.innerHTML = svg;

    statsEl.innerHTML =
      stat('Matching', (stats.estimated ? '≈' : '') + stats.total.toLocaleString()) +
      stat('Mean EP', Math.round(stats.mean).toLocaleString()) +
      stat('Min EP', Math.round(stats.min).toLocaleString()) +
      stat('Max EP', Math.round(stats.max).toLocaleString()) +
      (stats.estimated ? '<p class="an-note">≈ counts scaled to the full 0-999,999 range from the 6-digit sample (' + stats.raw.toLocaleString() + ' numbers actually scanned).</p>' : '');
  }
  function stat(k, v) { return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

  // Largest-remainder (Hamilton) apportionment of the tier shares into hundredths of a
  // percent: floor each tier's exact share, then hand the leftover units to the largest
  // fractional parts. Guarantees the displayed shares sum to exactly 100.00% while every
  // tier stays within one unit (0.01pp) of its true share. Empty tiers are excluded, so
  // a tier with no numbers can never be handed a leftover unit.
  function apportionShares(tiers, domain) {
    const units = tiers.map(() => 0), rem = tiers.map(() => -1);
    if (!domain) return units;
    let used = 0;
    for (const t of tiers) {
      if (!t.count) continue;
      const exact = t.count / domain * 10000;
      units[t.tier] = Math.floor(exact);
      rem[t.tier] = exact - units[t.tier];
      used += units[t.tier];
    }
    const order = rem.map((_, i) => i).filter(i => rem[i] >= 0)
      .sort((a, b) => rem[b] - rem[a] || a - b);   // ties: lower tier first, for stability
    for (let k = 0, left = 10000 - used; k < left && order.length; k++) units[order[k % order.length]]++;
    return units;
  }

  // Rarity breakdown: how the numbers matching the length / EP / badge filters split
  // across the seven card tiers. Counts deliberately ignore the tier toggles themselves
  // (see the worker) so the breakdown keeps working as a picker once a tier is isolated.
  function renderTiers(tiers, domain) {
    if (!tiers) { tierOut.innerHTML = ''; return; }
    // Shares are apportioned by largest remainder so the column sums to exactly 100.00%.
    // Rounding each row on its own overshoots: over the full range common is 48.969% and
    // uncommon 24.989%, which at one decimal read as 49.0 + 25.0 and push the total to
    // 100.04. Units below are hundredths of a percent, so 10,000 units == 100%.
    const units = apportionShares(tiers, domain);
    // A tier with numbers in it but under half a unit shows "<0.01%" rather than "0.00%";
    // it was apportioned 0 either way, so the visible column still totals 100.00%.
    const pct = t => !t.count ? '-' : (units[t.tier] ? (units[t.tier] / 100).toFixed(2) + '%' : '<0.01%');
    // Stacked share bar, highest tier first so the rare slivers sit on the readable end.
    const seg = [...tiers].reverse().filter(t => t.count > 0).map(t =>
      '<i style="width:' + (t.share * 100).toFixed(4) + '%;background:' + TIERS[t.tier].accent + '"' +
      ' title="' + esc(TIERS[t.tier].label + ': ' + t.count.toLocaleString() + ' (' + pct(t) + ')') + '"></i>').join('');

    const rows = [...tiers].reverse().map(t => {
      const T = TIERS[t.tier];
      const on = !offTiers.has(t.tier);
      // Tooltip: the tier's own EP window, then the EP actually spanned by the matching
      // numbers inside it (which can be much narrower than the window).
      const tip = T.label + ' - ' + tierRangeText(t.tier) +
        (t.count ? '\nmatching: ' + Math.round(t.min).toLocaleString() + ' - ' + Math.round(t.max).toLocaleString() + ' EP' : '\nno matching numbers') +
        (on ? '' : '\n(excluded from the chart and exports)');
      return '<div class="an-tb-row' + (on ? '' : ' off') + (t.count ? '' : ' empty') + '" data-tier="' + t.tier + '"' +
        ' role="button" tabindex="0" aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' title="' + esc(tip) + '">' +
        '<span class="an-tb-sw" style="background:' + T.accent + '"></span>' +
        '<span class="an-tb-name">' + esc(T.label) + '</span>' +
        '<span class="an-tb-n">' + Math.round(t.count).toLocaleString() + '</span>' +
        '<span class="an-tb-p">' + pct(t) + '</span>' +
        '<span class="an-tb-track"><i style="width:' + (t.share * 100).toFixed(4) + '%;background:' + T.accent + '"></i></span>' +
        '<span class="an-tb-ep">' + (t.count ? 'mean ' + Math.round(t.mean).toLocaleString() + ' EP' : '-') + '</span>' +
        '</div>';
    }).join('');

    tierOut.innerHTML =
      '<div class="an-tb-head">Rarity breakdown' +
        '<span>' + Math.round(domain || 0).toLocaleString() + ' numbers match the other filters</span></div>' +
      '<div class="an-tb-bar">' + seg + '</div>' +
      '<div class="an-tb-rows">' + rows + '</div>' +
      '<p class="an-tb-note">Click a tier to include or exclude it; shift-click to show only that tier. ' +
        'Counts cover every number passing the length, EP and badge filters, whether or not its tier is currently shown.</p>';
  }
  // Keyboard parity with the chips for the breakdown rows.
  tierOut.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('.an-tb-row');
    if (!row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    row.click();
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const RARITY_COLORS = {
  Mythic: '#ff4d6d', Anomaly: '#c77dff', Epic: '#9d4edd',
  Rare: '#4895ef', Uncommon: '#52b788', Common: '#adb5bd',
};

// --- Beta renderer: overall-number rarity tier ----------------------------
// Card tier is percentile-driven on rngdle.com (CARD_PERCENTILE_THRESHOLDS =
// trash<1, common<50, uncommon<75, rare<90, epic<95, anomaly<99, else mythic).
// The EP cutoffs below are the exact boundaries derived from its shipped
// SCORE_PERCENTILES table (each cutoff = smallest EP whose percentile >= the
// threshold). Because the total-EP distribution shifts whenever the badge set
// changes, these MUST be re-derived alongside src/percentiles.gen.js - these
// values are from the 2026-07-16 bundle (230 badges). Palette colours are the
// rngdle.com RARITY_PALETTE highlight accents.
const CARD_TIERS = [
  [2098, 'trash'], [5761, 'common'], [9644, 'uncommon'],
  [23077, 'rare'], [35744, 'epic'], [164953, 'anomaly'],
]; // >= 164953 -> mythic
function cardTier(ep) { for (const [t, name] of CARD_TIERS) if (ep < t) return name; return 'mythic'; }
// Tier names low -> high; the top tier has no cutoff row, hence the extra entry.
const CARD_TIER_NAMES = [...CARD_TIERS.map(t => t[1]), 'mythic'];
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

// Tier descriptors handed to the analysis panel (as JSON) so its rarity chips, stacked
// bar and histogram colours come from the same CARD_TIERS/TIER_PALETTE the card uses.
// lo is null for the bottom tier and hi is null for mythic - both ends are open.
function tierMeta() {
  return CARD_TIER_NAMES.map((key, i) => ({
    key,
    label: TIER_PALETTE[key].label,
    accent: TIER_PALETTE[key].accent,
    hl: TIER_PALETTE[key].hl,
    lo: i === 0 ? null : CARD_TIERS[i - 1][0],
    hi: i < CARD_TIERS.length ? CARD_TIERS[i][0] : null,
  }));
}

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

// Some rngdle.com badges score on a number but their getContributors returns
// nothing - either the highlight logic is narrower than the check ("Pair" only
// resolves a digit appearing exactly twice, "Snake Eyes" only adjacent "11"), or
// the badge shipped without any (most of the 2026-07-16 batch: Five of a Kind,
// Framed Quad, the exact-number badges). Fall back to the digits that actually
// justify the badge so something lights up on hover.
function fallbackCells(id, s) {
  // All positions of the first digit (in string order) appearing >= min times.
  const firstWith = min => {
    const counts = {}; for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    for (let i = 0; i < s.length; i++) if (counts[s[i]] >= min) {
      const occ = []; for (let j = 0; j < s.length; j++) if (s[j] === s[i]) occ.push(j);
      return occ;
    }
    return [];
  };
  switch (id) {
    case 'SNAKE_EYES': { const idx = []; for (let i = 0; i < s.length; i++) if (s[i] === '1') idx.push(i); return idx; }
    case 'PAIR': return firstWith(2).slice(0, 2); // show "a pair": the first two matching digits
    case 'FIVE_OF_A_KIND': return firstWith(5);
    // Framed runs: light the of-a-kind middle (the bookends are "anything different").
    case 'FRAMED_TRIPLE': return [1, 2, 3];
    case 'FRAMED_QUAD': return [1, 2, 3, 4];
    // Whole-number identity badges: the entire number is the badge.
    case 'ERROR_EXACT': case 'FULL_DAY': case 'FOOTBALL_17776': case 'INFERNAL':
    case 'ALWAYS': case 'ULTIMEME_EXACT': case 'TAU': case 'GOLDEN_RATIO': case 'E':
      return [...s].map((_, i) => i);
    default: return [];
  }
}

// Digit-group boundaries for the badges whose number splits into constituent numbers
// (Metronome / Crescendo / Equation, the whole Consecutive Numbers family, and Echo).
// The split-finding helpers already return the part start-indices, so we turn them into
// [start,end) ranges; the beta card slides these parts apart on hover to reveal the
// split. Returns null for badges that aren't group-based (or when no split is found).
function badgeGroups(id, s) {
  // Contiguous parts from a list of split start-indices, ending at `end`.
  const rng = (splits, end) => splits.map((st, i) => [st, i + 1 < splits.length ? splits[i + 1] : end]);
  let r;
  switch (id) {
    case 'ARITHMETIC': r = findArithmeticSplit(s); return r ? rng(r.splits, s.length) : null;
    case 'GEOMETRIC':  r = findGeometricSplit(s);  return r ? rng(r.splits, s.length) : null;
    case 'EQUATION':   r = findEquation(s);        return r ? rng(r.splits, s.length) : null;
    // Consecutive Numbers (whole number splits into the parts) - Exact + Scrambled.
    case 'CONSEC_PAIR_EXACT':      r = pPairExact(s);  return r ? rng(r.splits, s.length) : null;
    case 'CONSEC_TRIPLE_EXACT':
    case 'CONSEC_TRIPLE_SCRAMBLED': r = pTripleExact(s); return r ? rng(r.splits, s.length) : null;
    case 'CONSEC_QUAD_EXACT':
    case 'CONSEC_QUAD_SCRAMBLED':   r = pQuadExact(s);   return r ? rng(r.splits, s.length) : null;
    // Consecutive Numbers found inside a longer number - split only that sub-run.
    case 'CONSEC_TRIPLE_CONTAINS': r = pNAdjacent(s, 3); return r ? rng(r.splits, r.end) : null;
    case 'CONSEC_QUAD_CONTAINS':   r = pNAdjacent(s, 4); return r ? rng(r.splits, r.end) : null;
    case 'CONSEC_PAIR_ADJACENT': {
      r = pPairAdjacent(s); if (!r) return null;
      const b = r.splits[1]; // second part starts here; its length = the printed second value
      return [[r.splits[0], b], [b, b + String(r.numbers[1]).length]];
    }
    case 'CONSEC_PAIR_NEARBY': {
      r = pPairNearby(s); if (!r) return null;
      return [[r.a.start, r.a.end], [r.b.start, r.b.end]]; // two non-adjacent runs
    }
    case 'ECHO':
      return s.length >= 2 && s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2)
        ? [[0, s.length / 2], [s.length / 2, s.length]] : null;
    // Even Spacing: every digit is its own part, so the card spreads the whole
    // number evenly apart - mirroring the constant step the badge is about.
    case 'EVEN_SPACING':
    case 'EVEN_SPACING_ABS':
      return [...s].map((_, i) => [i, i + 1]);
    default: return null;
  }
}

// Scramble / Mini Scramble: "from:to" slot moves that sort the scrambled digits into
// their consecutive run, so the beta card can animate the unscramble on hover.
// Scramble covers the whole number; Mini Scramble covers the LONGEST substring that
// sorts consecutive (leftmost on ties). The badge test itself stops at the first
// shortest match - existence is the same either way - but the longest run is the
// more honest thing to show (90213 contains 0213, not just 021).
function scramblePerm(id, s) {
  const permOf = (str, off) => [...str].map((ch, j) => [Number(ch), off + j])
    .sort((a, b) => a[0] - b[0]).map((e, k) => `${e[1]}:${off + k}`).join(',');
  if (id === 'SCRAMBLE') return permOf(s, 0);
  for (let L = s.length; L >= 3; L--) for (let i = 0; i + L <= s.length; i++)
    if (isScrambledSeq(s.slice(i, i + L), 3)) return permOf(s.slice(i, i + L), i);
  return null;
}

// A short "why it scores" breakdown for the arithmetic-property badges, shown as a
// caption on hover (these have no meaningful digit-position highlight on their own).
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = k => [...String(k)].map(c => SUP[+c]).join('');
function powNote(base, n) {
  let k = 0, v = 1;
  while (v < n) { v *= base; k++; }
  return v === n ? `${base}${sup(k)} = ${n.toLocaleString()}` : null;
}
// k-th root breakdown for the fixed-exponent power badges (2nd Power … 19th Power).
function rootNote(n, p) {
  const k = Math.round(Math.pow(n, 1 / p));
  for (const c of [k - 1, k, k + 1]) if (c >= 0 && Math.pow(c, p) === n) return `${c}${sup(p)} = ${n.toLocaleString()}`;
  return null;
}
function badgeNote(id, r) {
  const d = [...String(r.number)].map(ch => ch.charCodeAt(0) - 48);
  const sum = d.reduce((a, b) => a + b, 0);
  switch (id) {
    case 'HARSHAD': return `${d.join(' + ')} = ${sum},  ${r.number} ÷ ${sum} = ${r.number / sum}`;
    case 'SPY':     return `${d.join(' + ')} = ${sum} = ${d.join(' × ')}`;
    case 'BLACKJACK': return `${d.join(' + ')} = 21`;
    case 'HEAVY':   return `digit sum ${sum} - over 45`;
    case 'FEATHER': return `digit sum ${sum} - under 15`;
    case 'EVEN_SPACING': { const g = d[1] - d[0]; return `${d.join(', ')}  →  ${g >= 0 ? '+' : ''}${g} each step`; }
    case 'EVEN_SPACING_ABS': return `${d.join(', ')}  →  ±${Math.abs(d[1] - d[0])} each step`;
    case 'OUROBOROS': { for (let k = 1; k <= 7; k++) if (Math.pow(k, k) === r.number) return `${k}${sup(k)} = ${r.number.toLocaleString()}`; return null; }
    case 'POWER_OF_TWO': return powNote(2, r.number);
    case 'POWER_OF_THREE': return powNote(3, r.number);
    case 'POWER_OF_FIVE': return powNote(5, r.number);
    case 'POWER_OF_SEVEN': return powNote(7, r.number);
    case 'SQUARE': return rootNote(r.number, 2);
    case 'CUBE': return rootNote(r.number, 3);
    case 'FOURTH_POWER': return rootNote(r.number, 4);
    case 'FIFTH_POWER': return rootNote(r.number, 5);
    case 'SIXTH_POWER': return rootNote(r.number, 6);
    case 'SEVENTH_POWER': return rootNote(r.number, 7);
    case 'EIGHTH_POWER': return rootNote(r.number, 8);
    case 'NINTH_POWER': return rootNote(r.number, 9);
    case 'TENTH_POWER': return rootNote(r.number, 10);
    case 'ELEVENTH_POWER': return rootNote(r.number, 11);
    case 'THIRTEENTH_POWER': return rootNote(r.number, 13);
    case 'SEVENTEENTH_POWER': return rootNote(r.number, 17);
    case 'NINETEENTH_POWER': return rootNote(r.number, 19);
    case 'FACTORIAL': { let k = 1, v = 1; while (v < r.number) { k++; v *= k; } return v === r.number ? `${k}! = ${r.number.toLocaleString()}` : null; }
    case 'FIBONACCI': { let a = 0, b = 1; while (b < r.number) { const t = a + b; a = b; b = t; } return r.number >= 2 && b === r.number ? `${(r.number - a).toLocaleString()} + ${a.toLocaleString()} = ${r.number.toLocaleString()}` : null; }
    case 'PRONIC': { const k = Math.floor(Math.sqrt(r.number)); return k * (k + 1) === r.number ? `${k} × ${k + 1} = ${r.number.toLocaleString()}` : null; }
    case 'LUCKY_SEVEN_DIV': return `${r.number.toLocaleString()} ÷ 7 = ${(r.number / 7).toLocaleString()}`;
    case 'BALANCED': {
      const h = d.length / 2, a = d.slice(0, h), b = d.slice(h);
      const sa = a.reduce((x, y) => x + y, 0), sb = b.reduce((x, y) => x + y, 0);
      return `${a.join('+')} = ${sa}   ∥   ${b.join('+')} = ${sb}`;
    }
    default: return null;
  }
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
    if (!cells.length) cells = fallbackCells(b.id, s);
    // Group badges (Metronome / Crescendo / Equation) light up every digit in the split
    // and carry their part boundaries so the card can slide the parts apart on hover.
    const groups = badgeGroups(b.id, s);
    let groupsAttr = '';
    if (groups) {
      cells = groups.flatMap(([a, z]) => { const r = []; for (let i = a; i < z; i++) r.push(i); return r; });
      groupsAttr = ` data-groups="${groups.map(g => `${g[0]}-${g[1]}`).join('|')}"`;
    }
    // Scramble / Mini Scramble carry the digit moves that sort their run into order,
    // so the card can animate the unscramble on hover (and highlight exactly the run).
    let permAttr = '';
    if (b.id === 'MINI_SCRAMBLE' || b.id === 'SCRAMBLE') {
      const perm = scramblePerm(b.id, s);
      if (perm) {
        permAttr = ` data-perm="${perm}"`;
        cells = perm.split(',').map(m => Number(m.split(':')[0])).sort((x, y) => x - y);
      }
    }
    // Property badges (Harshad / Spy / Blackjack / …) carry a formula breakdown that
    // shows in the caption line on hover, since digit highlighting can't explain them.
    const note = badgeNote(b.id, result);
    const noteAttr = note ? ` data-note="${esc(note)}"` : '';
    // Pill border + digit-highlight colours come from rngdle.com's RARITY_PALETTE,
    // keyed by this badge's own rarity tier (so anomaly reads orange, epic purple, etc.).
    const pal2 = TIER_PALETTE[b.rarity.toLowerCase()] || TIER_PALETTE.common;
    const req = b.desc || 'No description.';
    const tip = esc(`${req}\n${b.rarity} · ${fmtProb(b.prob)} earn this · +${b.ep.toLocaleString()} EP`);
    return `<button type="button" class="bn-b" style="--bc:${pal2.accent}"
       data-cells="${cells.join(',')}" data-hl="${pal2.hl}" data-tip="${tip}"${groupsAttr}${permAttr}${noteAttr}
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
      <span class="pill pill-lg">${pal.label}</span>
      ${prTxt ? `<span class="bn-pct" title="exact percentile of all numbers 0-1,000,000 by EP">${prTxt}</span>` : ''}
      <span class="bn-ep">${result.totalEP.toLocaleString()} EP</span>
    </div>
    <div class="bn-sub">${result.count} badge${result.count === 1 ? '' : 's'} · hover a badge to see where it scores</div>
    <div class="bn-note" id="bn-note" aria-live="polite"></div>
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

  const css = `
  p.tag { margin:0 0 2rem; }

  /* --- Analysis panel --- */
  .an-bar { margin:2rem 0 1.5rem; display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; }
  #analysis { border:1px solid var(--border); border-radius:var(--r-card); padding:1.1rem 1.15rem 1.3rem; margin-bottom:1.5rem; }
  #analysis h2 { font-size:1.05rem; font-weight:600; letter-spacing:-.01em; margin:0 0 1rem; }
  .an-controls { display:flex; flex-wrap:wrap; align-items:flex-start; gap:1rem; margin-bottom:1rem; }
  .an-controls fieldset { border:1px solid var(--border); border-radius:var(--r-ctl); padding:.55rem .7rem .7rem; margin:0; min-width:200px; flex:1; }
  .an-controls legend { color:var(--faint); font-size:.68rem; text-transform:uppercase; letter-spacing:.07em; padding:0 .35rem; font-weight:600; }
  .an-controls .an-badges-fs { flex:2 1 300px; min-width:260px; }
  /* Left column: number length on top, EP score range below it. */
  .an-col-left { display:flex; flex-direction:column; gap:1rem; flex:1 1 210px; min-width:210px; }
  .an-col-left fieldset { flex:0 0 auto; min-width:0; }
  .an-len-fs { display:flex; flex-direction:column; }
  #an-lengths { display:grid; grid-template-columns:repeat(7, 1fr); gap:.35rem; }
  .an-ep-row { display:flex; flex-direction:column; gap:.5rem; }
  .an-ep-row label { display:flex; align-items:center; justify-content:space-between; gap:.6rem; font-size:.82rem; color:var(--muted); white-space:nowrap; }
  .an-ep-row input { width:7.5rem; flex:0 0 auto; font-size:.85rem; padding:.34rem .5rem;
    border-radius:var(--r-sm); background:var(--bg); }
  .an-ep-row input:focus { box-shadow:none; }
  .an-ep-row label:has(input:disabled) { opacity:.45; }
  .an-len { display:flex; align-items:center; justify-content:center; padding:.2rem 0;
    font-size:1.5rem; font-weight:700; font-variant-numeric:tabular-nums;
    border:none; border-radius:0; background:none; color:var(--text); line-height:1;
    transition:opacity .15s, color .15s, text-shadow .15s; }
  .an-len:not(.on) { opacity:.28; }
  .an-len:hover { opacity:1; background:none; border:none; }
  .an-len.on { color:#c9dbf2; text-shadow:0 0 16px rgba(91,147,214,.95), 0 0 6px rgba(91,147,214,.85); }
  .an-badge { display:flex; align-items:center; gap:.4rem; font-size:.85rem; cursor:pointer; }
  #an-badge-search { width:100%; font-size:.85rem; padding:.4rem .55rem; border-radius:var(--r-sm);
    background:var(--bg); margin-bottom:.45rem; }
  #an-badge-search:focus { box-shadow:none; }
  .an-badge-list { max-height:150px; overflow:auto; display:flex; flex-direction:column; gap:.1rem; padding-right:.3rem; }
  .an-badge { justify-content:flex-start; padding:.12rem .25rem; border-radius:5px; cursor:default; }
  .an-badge:hover { background:var(--surface-2); }
  .an-badge-name { flex:1; min-width:0; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .an-badge em { flex:0 0 auto; text-align:right; color:var(--faint); font-style:normal; font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; }
  .an-tri { flex:0 0 auto; display:inline-flex; }
  .an-tri button { font-size:.72rem; font-weight:500; line-height:1; padding:.12rem .34rem; border-radius:0;
    border:1px solid var(--border-2); background:var(--surface-2); color:var(--faint); }
  .an-tri button:first-child { border-radius:4px 0 0 4px; }
  .an-tri button:last-child { border-radius:0 4px 4px 0; border-left:none; }
  .an-tri button:hover { color:var(--text); background:var(--surface-2); border-color:var(--border-2); }
  .an-tri button[data-act="do"].on { background:#1d6b3f; border-color:#2c9b58; color:#fff; }
  .an-tri button[data-act="dont"].on { background:#7a2230; border-color:#b3344a; color:#fff; }
  .an-badge-sel { margin-top:.55rem; font-size:.78rem; color:var(--muted); line-height:1.9; }
  .an-badge-sel em { font-style:normal; font-weight:600; color:#e88; }
  .an-chip { display:inline-block; border:1px solid var(--border-2); color:var(--text); padding:.08rem .5rem; border-radius:var(--r-pill); cursor:pointer; font-size:.78rem; }
  .an-chip:hover { border-color:#444a57; background:var(--surface-2); }
  .an-chip-do { border-color:#2c9b58; }
  .an-chip-dont { border-color:#b3344a; }
  .an-actions .an-purge-btn { margin-left:auto; background:transparent; color:var(--muted); }
  .an-actions .an-purge-btn:hover:not(:disabled) { background:transparent; border-color:#b3344a; color:#e88; }
  #an-status { color:var(--muted); font-size:.85rem; min-height:1.2em; margin:.3rem 0 .7rem; }
  #an-status.computing { display:flex; align-items:center; justify-content:center; gap:.55rem; color:var(--text); font-size:.95rem; padding:1.1rem 0 .9rem; }
  #an-chart svg { background:var(--bg); border:1px solid var(--border); border-radius:var(--r-ctl); }
  .an-empty { color:var(--muted); text-align:center; padding:1.5rem; }

  /* --- Rarity: filter chips + breakdown --- */
  .an-controls .an-tier-fs { flex:1 1 100%; min-width:0; }
  #an-tiers { display:flex; flex-wrap:wrap; gap:.35rem; }
  .an-tier { font-size:.7rem; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    padding:.28rem .6rem; border-radius:var(--r-pill); line-height:1;
    border:1px solid var(--tc); background:transparent; color:var(--tc);
    transition:opacity .15s, background .15s, box-shadow .15s; }
  .an-tier.on { background:color-mix(in srgb, var(--tc) 22%, transparent); box-shadow:0 0 10px -2px var(--tc); color:#fff; }
  .an-tier:not(.on) { opacity:.34; border-style:dashed; }
  .an-tier:hover { opacity:1; background:transparent; border-color:var(--tc); }
  .an-tier.on:hover { background:color-mix(in srgb, var(--tc) 22%, transparent); }
  #an-tier-breakdown:empty { display:none; }
  #an-tier-breakdown { margin-top:.9rem; border:1px solid var(--border); border-radius:var(--r-ctl); padding:.7rem .8rem .5rem; }
  .an-tb-head { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.5rem;
    font-size:.72rem; text-transform:uppercase; letter-spacing:.07em; color:var(--faint); font-weight:600; margin-bottom:.55rem; }
  .an-tb-head span { text-transform:none; letter-spacing:0; font-weight:400; font-size:.76rem; color:var(--muted); }
  .an-tb-bar { display:flex; height:.55rem; border-radius:var(--r-pill); overflow:hidden; background:var(--surface-2); margin-bottom:.6rem; }
  .an-tb-bar i { display:block; min-width:1px; }
  .an-tb-rows { display:flex; flex-direction:column; gap:.05rem; }
  .an-tb-row { display:grid; grid-template-columns:.7rem 5.5rem 5rem 4rem 1fr 8rem; align-items:center; gap:.5rem;
    padding:.22rem .3rem; border-radius:5px; cursor:pointer; font-size:.8rem;
    transition:background .12s, opacity .12s; }
  .an-tb-row:hover { background:var(--surface-2); }
  .an-tb-row.off { opacity:.36; }
  .an-tb-row.empty { opacity:.3; cursor:default; }
  .an-tb-row.off.empty { opacity:.2; }
  .an-tb-sw { width:.7rem; height:.7rem; border-radius:3px; }
  .an-tb-name { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; font-weight:600; color:var(--text); }
  .an-tb-n, .an-tb-p { font-family:var(--mono); font-variant-numeric:tabular-nums; text-align:right; }
  .an-tb-p { color:var(--muted); }
  .an-tb-track { height:.4rem; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .an-tb-track i { display:block; height:100%; min-width:1px; opacity:.85; }
  .an-tb-ep { font-size:.72rem; color:var(--faint); font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }
  .an-tb-note { color:var(--faint); font-size:.72rem; margin:.5rem 0 .1rem; }
  @media (max-width:640px) {
    .an-tb-row { grid-template-columns:.7rem 4.6rem 4.4rem 3.4rem; }
    .an-tb-track, .an-tb-ep { display:none; }
  }
  #an-stats { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:.9rem; }
  #an-stats .stat { flex:1; min-width:110px; }
  .an-note { flex-basis:100%; color:var(--muted); font-size:.75rem; margin:.3rem 0 0; }
  .an-actions { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:1rem; }
  .an-actions button { font-size:.85rem; padding:.5rem .9rem; }

  /* --- Number card (rngdle.com-style, click-to-type) --- */
  .bn { margin-bottom:1.5rem; }
  .bn-card { position:relative; display:flex; justify-content:center; align-items:center; min-height:6.4rem;
    padding:1.6rem 1rem; border-radius:var(--r-hero); border:1.5px solid color-mix(in srgb, var(--accent) 55%, var(--border)); cursor:text;
    background:radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 62%), var(--surface);
    box-shadow:0 14px 34px -18px var(--glow);
    transition:border-color .25s, box-shadow .25s; }
  .bn-card:focus-within { border-color:var(--accent); box-shadow:0 14px 34px -16px var(--glow), 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
  /* Transparent input overlays the card: clicking anywhere focuses it, typing drives the digits.
     Its (invisible) text must keep the same per-glyph pitch as .bn-number, or text selection
     drifts off the drawn digits: .18em = .02em letter-spacing + 2x.05em .bn-d padding + .06em gap. */
  .bn-input { position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0; border:0; border-radius:var(--r-hero);
    background:transparent; color:transparent; caret-color:var(--accent); text-align:center; cursor:text;
    font-family:var(--mono); font-weight:700; letter-spacing:.18em; font-size:clamp(2.4rem, 11vw, 4rem); }
  .bn-input:focus { outline:none; box-shadow:none; }
  .bn-number[data-len="1"]+.bn-input, .bn-number[data-len="2"]+.bn-input, .bn-number[data-len="3"]+.bn-input { font-size:4rem; }
  .bn-number { display:flex; gap:.06em; font-family:var(--mono); font-weight:700; letter-spacing:.02em;
    font-size:clamp(2.4rem, 11vw, 4rem); line-height:1; pointer-events:none; }
  .bn-number[data-len="1"], .bn-number[data-len="2"], .bn-number[data-len="3"] { font-size:4rem; }
  .bn-ph { color:var(--faint); letter-spacing:.18em; }
  .bn-d { display:inline-block; padding:0 .05em; border-radius:8px; transition:background .12s, color .12s, box-shadow .12s, transform .12s, margin-left .22s cubic-bezier(.34,1.4,.5,1); }
  .bn-d.hl { background:var(--hc,#fff); color:#08090c; box-shadow:0 0 14px var(--hc,#fff); transform:translateY(-2px); }
  /* Group badges slide their split-parts apart: a gap opens before each part after the first. */
  .bn-d.grp-gap { margin-left:.85em; }
  /* Mini Scramble: digits of the hidden run glide into sorted order (springy, slower than hl). */
  .bn-d.prm { position:relative; z-index:1;
    transition:background .12s, color .12s, box-shadow .12s, transform .38s cubic-bezier(.34,1.4,.5,1); }
  /* Formula caption for property badges (Harshad / Spy / …), shown on hover. */
  .bn-note { min-height:1.2em; margin-top:.35rem; text-align:center; font-family:var(--mono);
    font-size:.82rem; color:var(--accent); font-variant-numeric:tabular-nums; letter-spacing:.01em;
    opacity:0; transition:opacity .12s; }
  .bn-note.show { opacity:1; }
  .bn[data-tier="empty"] .bn-card { border-style:dashed; }
  .bn[data-tier="empty"] .pill { display:none; }
  .bn-meta { display:flex; align-items:center; justify-content:center; gap:.55rem; margin-top:1rem; flex-wrap:wrap; }
  .bn-pct { font-size:.82rem; color:var(--accent); font-weight:600; }
  .bn-ep { font-family:var(--mono); font-weight:600; font-variant-numeric:tabular-nums; color:var(--text); font-size:1.05rem; }
  .bn-sub { text-align:center; color:var(--muted); font-size:.8rem; margin-top:.4rem; }
  .bn-badges { display:flex; flex-wrap:wrap; gap:.45rem; justify-content:center; margin-top:1.2rem; }
  .bn-b { position:relative; display:inline-flex; align-items:center; gap:.35rem; font-size:.8rem; font-weight:500;
    padding:.28rem .6rem; border-radius:var(--r-pill); cursor:pointer; color:var(--text);
    border:1px solid color-mix(in srgb, var(--bc) 55%, var(--border-2)); background:var(--surface-2); transition:background .12s, border-color .12s; }
  .bn-b:hover, .bn-b:focus-visible { outline:none; border-color:var(--bc); background:color-mix(in srgb, var(--bc) 16%, var(--surface-2)); }
  .bn-b em { font-style:normal; font-family:var(--mono); font-size:.72rem; color:var(--muted); }
  .bn-b::after { content:attr(data-tip); white-space:pre-line; position:absolute; left:50%; transform:translateX(-50%);
    bottom:calc(100% + 8px); min-width:13rem; max-width:18rem; padding:.5rem .65rem; border-radius:var(--r-ctl); background:#06070a;
    border:1px solid var(--border-2); box-shadow:0 8px 24px rgba(0,0,0,.6); font-size:.75rem; font-weight:450; line-height:1.4;
    text-align:left; color:var(--text); opacity:0; pointer-events:none; transition:opacity .12s; z-index:10; }
  .bn-b:hover::after, .bn-b:focus-visible::after { opacity:1; }
  .bn-badges .none { color:var(--muted); }`;

  const page = `<div class="wrap">
  <h1>RNGdle EP Calculator</h1>
  <p class="tag">Click the box and type a number from 0 to 1,000,000 to see its EP and badges.</p>
  ${body}

  <div class="an-bar"><button type="button" id="an-btn" class="btn-primary">Analyze all scores</button></div>

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
            <label>or scores exactly <input id="an-ep-eq" type="number" min="0" step="1" placeholder="unset" inputmode="numeric"></label>
          </div>
        </fieldset>
      </div>
      <fieldset class="an-badges-fs">
        <legend>Badges: require ✓ / exclude ✕</legend>
        <input id="an-badge-search" type="text" placeholder="filter badges…" autocomplete="off">
        <div id="an-badge-list" class="an-badge-list"></div>
        <div id="an-badge-sel" class="an-badge-sel"></div>
      </fieldset>
      <fieldset class="an-tier-fs">
        <legend>Rarity tier</legend>
        <div id="an-tiers"></div>
      </fieldset>
    </div>
    <div id="an-status"></div>
    <div id="an-chart"></div>
    <div id="an-tier-breakdown"></div>
    <div id="an-stats"></div>
    <div class="an-actions">
      <button type="button" id="an-export-csv">Matching numbers (.csv)</button>
      <button type="button" id="an-export-examples">Examples per badge (.txt)</button>
      <button type="button" id="an-purge" class="an-purge-btn">Purge cache</button>
    </div>
  </section>

  <footer>JSON API: <code>/api?n=696969</code></footer>
</div>`;

  const script = `
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
  // Group badges (Metronome / Crescendo / Equation): slide the split's parts apart so
  // the constant-difference / -ratio / equation numbers read as separate chunks.
  function slideGroups(spec) {
    if (!spec) return;
    spec.split('|').forEach(function (g, gi) {
      var p = g.split('-'), a = Number(p[0]);
      if (gi > 0 && digits[a]) digits[a].classList.add('grp-gap'); // gap before every part after the first
    });
  }
  function clearSlide() { digits.forEach(function (d) { d.classList.remove('grp-gap'); }); }
  // Mini Scramble: glide each digit of the run to its sorted slot ("from:to" pairs,
  // measured in px so it works at any font size). translateY(-2px) keeps the lift
  // the .hl class would otherwise apply (inline transform overrides it).
  function permute(spec) {
    if (!spec) return;
    spec.split(',').forEach(function (m) {
      var p = m.split(':'), el = digits[Number(p[0])], tgt = digits[Number(p[1])];
      if (!el || !tgt) return;
      el.classList.add('prm');
      el.style.transform = 'translateX(' + (tgt.offsetLeft - el.offsetLeft) + 'px) translateY(-2px)';
    });
  }
  function clearPerm() { digits.forEach(function (d) { d.classList.remove('prm'); d.style.transform = ''; }); }
  // Formula caption (Harshad / Spy / …): show the badge's breakdown on hover.
  function showNote(note) { var el = document.getElementById('bn-note'); if (!el) return; el.textContent = note || ''; el.classList.toggle('show', !!note); }
  function clearNote() { var el = document.getElementById('bn-note'); if (el) { el.textContent = ''; el.classList.remove('show'); } }
  function wireBadges() {
    [].slice.call(outEl.querySelectorAll('.bn-b')).forEach(function (b) {
      var cells = (b.dataset.cells || '').split(',').filter(Boolean).map(Number);
      var color = (b.dataset.hl || '').trim() || '#fff';
      var groups = b.dataset.groups || '';
      var perm = b.dataset.perm || '';
      var note = b.dataset.note || '';
      function on() { highlight(cells, color); slideGroups(groups); permute(perm); showNote(note); }
      function off() { clearHl(); clearSlide(); clearPerm(); clearNote(); }
      b.addEventListener('mouseenter', on);
      b.addEventListener('mouseleave', off);
      b.addEventListener('focus', on);
      b.addEventListener('blur', off);
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
        fetch('/api/card?n=' + q).then(function (r) { return r.json(); }).then(function (d) {
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

// __name no-op shim: when bundled (esbuild keepNames), the serialized client/worker source
// below references a __name() helper that only exists in the bundled Worker scope. Redefine
// it here (page context) and inside the worker blob so the source runs standalone.
var __name = (f) => f;
const __WORKER_SRC = ${JSON.stringify('var __name=(f)=>f;(' + analysisWorker.toString() + ')()')};
(${analysisClient.toString()})(__WORKER_SRC, ${JSON.stringify(tierMeta())});`;

  return pageShell({ title: 'RNGdle EP Calculator', nav: 'calc', width: '660px', css, body: page, script });
}

// ---------------------------------------------------------------------------
// /grid - interactive 1,000,000-number map
//
// One pixel per number on a 1000x1000 canvas (number n at x = n % 1000,
// y = floor(n / 1000)). The default /grid view is a monochrome badge-COUNT
// heatmap; picking a badge from the list switches to its membership map (which
// numbers earn it), computed from the same engine.js sweep - no images needed.
// The sweep (per-number count + packed earned-badge bitmask) runs once in a Web
// Worker and is cached in IndexedDB - the same entry / and /chains use - so reloads
// and badge switches are instant, and only the first page visited pays for it.
// Zoom/pan the canvas, hover for details, click a cell to open it on /.
// ---------------------------------------------------------------------------

function gridWorker() {
  let E = null, origin = '';
  let counts = null, bits = null, epArr = null, ROW = 0, cmin = 0, cmax = 0, emin = 0, emax = 0;
  const N = 1000000;                    // the grid is a 1000x1000 canvas: 0..999,999 only

  // Membership of a single badge index: which numbers earn it (1) or not (0).
  function membership(idx) {
    const m = new Uint8Array(N), byte = idx >> 3, bit = 1 << (idx & 7);
    for (let n = 0; n < N; n++) if (bits[n * ROW + byte] & bit) m[n] = 1;
    return m;
  }
  // Numbers that earn badge idx but where some dominator badge (a same-family member
  // that would win supersession) is ALSO earned, so idx scores 0 there.
  function supersededMask(idx, doms) {
    const m = new Uint8Array(N), byte = idx >> 3, bit = 1 << (idx & 7);
    const db = doms.map(d => d >> 3), dm = doms.map(d => 1 << (d & 7));
    for (let n = 0; n < N; n++) {
      const row = n * ROW;
      if (!(bits[row + byte] & bit)) continue;
      for (let k = 0; k < doms.length; k++) if (bits[row + db[k]] & dm[k]) { m[n] = 1; break; }
    }
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
      if (msg.cmd === 'supersede') {
        const m = supersededMask(msg.idx, msg.doms);
        self.postMessage({ type: 'supersede', idx: msg.idx, mask: m.buffer }, [m.buffer]);
        return;
      }
      if (msg.cmd !== 'compute') return;
      origin = msg.origin;
      if (!E) E = await import(origin + '/engine.js');
      self.postMessage({ type: 'meta', badges: E.BADGE_META });

      // Shared sweep (engine.js): per-number badge count, total EP and the packed
      // earned-badge bitmask, cached once for this page, / and /chains alike. It covers
      // 0..1,000,000; the grid canvas is 1000x1000, so take the first 1,000,000 only.
      const swept = await E.sweepShared(origin, pct => self.postMessage({ type: 'progress', pct }), msg.force);
      counts = swept.cnt.subarray(0, N);
      epArr = swept.ep.subarray(0, N);
      bits = swept.bits.subarray(0, N * swept.ROW);
      ROW = swept.ROW;

      // Derived rather than stored - a single 1M pass costs a few ms.
      let mn = 255, mx = 0, en = Infinity, ex = 0;
      for (let n = 0; n < N; n++) {
        if (counts[n] < mn) mn = counts[n];
        if (counts[n] > mx) mx = counts[n];
        if (epArr[n] < en) en = epArr[n];
        if (epArr[n] > ex) ex = epArr[n];
      }
      cmin = mn; cmax = mx; emin = en; emax = ex;

      // counts + bits stay resident for membership(); ship the page copies of counts + ep.
      const c = counts.slice(), e = epArr.slice();
      self.postMessage({ type: 'done', counts: c.buffer, ep: e.buffer, min: cmin, max: cmax, emin: emin, emax: emax, cached: swept.cached }, [c.buffer, e.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
  };
}

function gridClient(WORKER_SRC, LABELS, DOMS) {
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
  let supHide = false;             // "Hide superseded" toggle (off by default)
  let supMode = 'grey';            // 'grey' darkens superseded cells, 'black' hides them entirely
  let sup = null;                  // Uint8Array superseded-mask applied to the current view (or null)
  const supCache = new Map();      // label -> Uint8Array superseded mask
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
  function buildMember(m, s) {
    const hi = cmap(1), hr = hi[0] | 0, hg = hi[1] | 0, hb = hi[2] | 0;   // members: colormap's hot end
    const lo = cmap(0), lr = lo[0] | 0, lg = lo[1] | 0, lb = lo[2] | 0;   // non-members: colormap's dark end (black for Grayscale)
    // Superseded members ("Hide superseded" on): grey mode darkens to 30% of the way
    // up the scale; black mode drops them to the dark end, same as non-members.
    const df = supMode === 'black' ? 0 : 0.3;
    const dr = (lr + (hr - lr) * df) | 0, dg = (lg + (hg - lg) * df) | 0, db = (lb + (hb - lb) * df) | 0;
    return grayCanvas(sctx => {
      const img = sctx.createImageData(SIZE, SIZE), d = img.data;
      for (let i = 0; i < m.length; i++) {
        const p = i << 2;
        if (m[i]) {
          if (s && s[i]) { d[p] = dr; d[p + 1] = dg; d[p + 2] = db; }
          else { d[p] = hr; d[p + 1] = hg; d[p + 2] = hb; }
        } else { d[p] = lr; d[p + 1] = lg; d[p + 2] = lb; }
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
    ctx.fillStyle = '#08090c';
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
      let sc = 0; if (sup) for (let i = 0; i < sup.length; i++) sc += sup[i];
      titleEl.textContent = member
        ? (view + ' - ' + cnt.toLocaleString() + ' / 1,000,000 (' + fmtPct(cnt / 1e6 * 100) + ')' + (sup ? ' · ' + sc.toLocaleString() + ' superseded' : ''))
        : (view + ' …');
      const hi = cmap(1), lo = cmap(0);
      const hc = 'rgb(' + (hi[0] | 0) + ',' + (hi[1] | 0) + ',' + (hi[2] | 0) + ')';
      const lc = 'rgb(' + (lo[0] | 0) + ',' + (lo[1] | 0) + ',' + (lo[2] | 0) + ')';
      if (sup && supMode === 'grey') {
        const dc = 'rgb(' + ((lo[0] + (hi[0] - lo[0]) * 0.3) | 0) + ',' + ((lo[1] + (hi[1] - lo[1]) * 0.3) | 0) + ',' + ((lo[2] + (hi[2] - lo[2]) * 0.3) | 0) + ')';
        legendEl.innerHTML = '<span class="lab">none / superseded</span>' + scaleSpan(lc + ' 0 33%, ' + dc + ' 33% 67%, ' + hc + ' 67% 100%') + '<span class="lab">scores ' + view + '</span>';
      } else if (sup) {
        legendEl.innerHTML = '<span class="lab">none / superseded</span>' + scaleSpan(lc + ' 0 50%, ' + hc + ' 50% 100%') + '<span class="lab">scores ' + view + '</span>';
      } else {
        legendEl.innerHTML = '<span class="lab">none</span>' + scaleSpan(lc + ' 0 50%, ' + hc + ' 50% 100%') + '<span class="lab">earns ' + view + '</span>';
      }
    }
  }
  function highlight() {
    for (const b of listEl.children) b.classList.toggle('on', b.dataset.v === view);
    updateSupBtn();
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
    haltLife();
    view = 'count'; member = null; sup = null;
    if (!countCanvas) buildCount();
    src = countCanvas;
    highlight(); updateLegend(); render(); setHash('count');
  }
  function selectEP() {
    haltLife();
    view = 'ep'; member = null; sup = null;
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
    sup = (supHide && supCache.get(label)) || null;
    src = buildMember(member, sup);
    highlight(); updateLegend(); render();
  }
  // Fetch the superseded mask for a badge when the toggle needs it and it isn't cached.
  function ensureSup(label, idx) {
    if (!supHide || idx === undefined || !DOMS[idx].length || supCache.has(label)) return;
    worker.postMessage({ cmd: 'supersede', idx: idx, doms: DOMS[idx] });
  }
  function selectBadge(label, idx) {
    haltLife();
    view = label;
    setHash(label);
    highlight(); updateLegend();
    ensureSup(label, idx);
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
        else if (member && member[hit.n]) { detail = 'earns ' + view + (sup && sup[hit.n] ? ' (superseded)' : ''); }
        else { detail = 'no ' + view; }
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

  // "Hide superseded" toggle: darken members where a dominating family badge is also
  // earned. Only meaningful for badges in a family with a higher tier above them.
  // The grey/black pair picks how hard superseded cells are knocked back: grey keeps
  // them faintly visible, black paints them like non-members.
  const supBtn = document.getElementById('supbtn');
  const supGrey = document.getElementById('supgrey');
  const supBlack = document.getElementById('supblack');
  function updateSupBtn() {
    const idx = labelIdx.get(view);
    const off = idx === undefined || !DOMS[idx].length;
    supBtn.disabled = off;
    supGrey.disabled = off;
    supBlack.disabled = off;
    supBtn.classList.toggle('on', supHide);
    supGrey.classList.toggle('on', supMode === 'grey');
    supBlack.classList.toggle('on', supMode === 'black');
  }
  function supRepaint() {
    const idx = labelIdx.get(view);
    if (idx === undefined || !DOMS[idx].length || !member) return;
    ensureSup(view, idx);
    applyMember(view);          // repaints without the mask until 'supersede' arrives
  }
  supBtn.onclick = () => {
    supHide = !supHide;
    updateSupBtn();
    supRepaint();
  };
  supGrey.onclick = () => { supMode = 'grey'; updateSupBtn(); if (supHide) supRepaint(); };
  supBlack.onclick = () => { supMode = 'black'; updateSupBtn(); if (supHide) supRepaint(); };

  // --- Konami code: Conway's Game of Life seeded from the current view ------
  // ↑↑↓↓←→←→BA turns the visible map into a torus-wrapped Game of Life. Alive
  // cells are the "lit" half of the active view (members for a badge view, above
  // the midpoint for count/EP). Esc - or the code again - stops it and restores
  // the normal view. Pan/zoom keep working while it runs.
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiPos = 0;
  let life = null;                 // { cur, nxt, gen, timer, canvas, img }
  function lifeSeed() {
    const N = SIZE * SIZE, a = new Uint8Array(N);
    if (view === 'count' && counts) {
      const mid = (cmin + cmax) / 2;
      for (let i = 0; i < N; i++) a[i] = counts[i] > mid ? 1 : 0;
    } else if (view === 'ep' && epArr) {
      const lo = Math.log(emin + 1), span = (Math.log(emax + 1) - lo) || 1;
      for (let i = 0; i < N; i++) a[i] = (Math.log(epArr[i] + 1) - lo) / span >= 0.5 ? 1 : 0;
    } else if (member) {
      a.set(member);
    } else return null;
    return a;
  }
  function paintLife() {
    const lctx = life.canvas.getContext('2d'), d = life.img.data;
    const hi = cmap(1), hr = hi[0] | 0, hg = hi[1] | 0, hb = hi[2] | 0;
    const lo = cmap(0), lr = lo[0] | 0, lg = lo[1] | 0, lb = lo[2] | 0;
    const cur = life.cur;
    let alive = 0;
    for (let i = 0; i < cur.length; i++) {
      const p = i << 2;
      if (cur[i]) { alive++; d[p] = hr; d[p + 1] = hg; d[p + 2] = hb; } else { d[p] = lr; d[p + 1] = lg; d[p + 2] = lb; }
      d[p + 3] = 255;
    }
    lctx.putImageData(life.img, 0, 0);
    src = life.canvas;
    titleEl.textContent = "Conway's Game of Life - gen " + life.gen + ' · ' + alive.toLocaleString() + ' alive';
    render();
  }
  function stepLife() {
    const cur = life.cur, nxt = life.nxt, S = SIZE;
    for (let y = 0; y < S; y++) {
      const row = y * S, up = (y === 0 ? S - 1 : y - 1) * S, dn = (y === S - 1 ? 0 : y + 1) * S;
      for (let x = 0; x < S; x++) {
        const l = x === 0 ? S - 1 : x - 1, r = x === S - 1 ? 0 : x + 1;
        const nb = cur[up + l] + cur[up + x] + cur[up + r] + cur[row + l] + cur[row + r] + cur[dn + l] + cur[dn + x] + cur[dn + r];
        nxt[row + x] = (nb === 3 || (nb === 2 && cur[row + x])) ? 1 : 0;
      }
    }
    life.cur = nxt; life.nxt = cur;
    life.gen++;
    paintLife();
  }
  function haltLife() { if (life) { clearInterval(life.timer); life = null; } }
  function stopLife() { haltLife(); go(curHash() || 'count'); flash('Game of Life stopped'); }
  function startLife() {
    const seed = lifeSeed();
    if (!seed) { flash('Still building the grid…'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    life = { cur: seed, nxt: new Uint8Array(seed.length), gen: 0, timer: 0,
      canvas: canvas, img: canvas.getContext('2d').createImageData(SIZE, SIZE) };
    paintLife();
    life.timer = setInterval(stepLife, 100);
    flash("Conway's Game of Life - Esc to stop");
  }
  document.addEventListener('keydown', e => {
    if (life && e.key === 'Escape') { stopLife(); return; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiPos = k === KONAMI[konamiPos] ? konamiPos + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiPos === KONAMI.length) { konamiPos = 0; if (life) stopLife(); else startLife(); }
  });

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
    } else if (m.type === 'supersede') {
      const label = LABELS[m.idx];
      supCache.set(label, new Uint8Array(m.mask));
      // Repaint only if the membership map is already in; otherwise the pending
      // 'membership' reply will pick this mask up when it applies.
      if (view === label && supHide && memCache.has(label)) applyMember(label);
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
  // Per-badge dominator lists for the "Hide superseded" toggle: doms[i] = badge indices
  // in i's family that win supersession over i when co-earned (higher EP, or equal EP
  // and earlier in BADGES order - the same first-of-a-tie rule the scorer uses).
  const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
  const doms = BADGES.map(() => []);
  for (const fam of FAMILIES) {
    const idxs = fam.map(id => idToIdx.get(id)).filter(i => i !== undefined);
    for (const a of idxs) for (const b of idxs) {
      if (b !== a && (BADGES[b][3] > BADGES[a][3] || (BADGES[b][3] === BADGES[a][3] && b < a))) doms[a].push(b);
    }
  }
  const css = `
  /* Full-bleed canvas app: everything is fixed-positioned, so each overlay clears the
     icon rail itself rather than relying on body padding. The canvas is inset too -
     it stays clickable edge to edge instead of hiding a column under the rail. */
  body { font-size: 14px; line-height: 1.4; -webkit-user-select: none; user-select: none; }
  /* Explicit width, not left+right+auto: <canvas> is a replaced element, so width:auto
     resolves to its intrinsic (attribute) size and ignores the insets entirely. */
  #grid { position: fixed; top: 0; left: var(--rail-w); height: 100%;
    width: calc(100% - var(--rail-w)); display: block; cursor: grab; touch-action: none; }
  #grid:active { cursor: grabbing; }
  .glass { position: fixed; z-index: 5; background: rgba(12,14,22,.86);
    border: 1px solid rgba(255,255,255,.12); border-radius: var(--r-card); backdrop-filter: blur(6px); }
  #side { top: 12px; left: calc(var(--rail-w) + 12px); bottom: 12px; width: 250px;
    max-width: calc(100vw - var(--rail-w) - 24px);
    display: flex; flex-direction: column; padding: 12px; gap: 10px; transition: transform .25s ease; }
  body.nav-collapsed #side { transform: translateX(calc(-100% - 16px)); }
  .sidehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .sidehead h1 { flex: 1; }
  #sidehide, #sideshow { flex: 0 0 auto; width: 32px; height: 32px; padding: 0; color: var(--text);
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: var(--r-ctl); }
  #sidehide svg, #sideshow svg { width: 19px; height: 19px; }
  #sidehide:hover, #sideshow:hover { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.14); }
  #sideshow { position: fixed; top: 12px; left: calc(var(--rail-w) + 12px); z-index: 7; display: none; }
  body.nav-collapsed #sideshow { display: inline-flex; }
  #sidehide.hint { color: var(--hl-lt); animation: trayhint 1.15s ease-in-out infinite; }
  @keyframes trayhint { 0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: rgba(255,255,255,.14); }
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--hl) 32%, transparent); border-color: var(--hl); } }
  @media (max-width: 640px) {
    #side { left: calc(var(--rail-w) + 10px); right: 10px; width: auto; max-width: none;
      top: 10px; bottom: 10px; padding: 14px; gap: 12px; }
    #search { padding: 11px 12px; font-size: 15px; }
    #supbtn { padding: 10px 12px; font-size: 14px; }
    #supmode button { padding: 0 10px; font-size: 13px; }
    .item { padding: 11px 10px; font-size: 14px; }
    #ctrls { gap: 8px; padding: 7px; }
    #ctrls button { width: 42px; height: 42px; font-size: 20px; }
    #sidehide, #sideshow { width: 40px; height: 40px; }
    #sidehide svg, #sideshow svg { width: 22px; height: 22px; }
    #cmap { font-size: 13px; padding: 6px 8px; }
    body:not(.nav-collapsed) #ctrls, body:not(.nav-collapsed) #legend { display: none; }
  }
  #side h1 { margin: 0; font-size: 14px; font-weight: 650; }
  #side .credit { font-size: 12px; color: var(--muted); }
  #side .credit b { color: var(--accent); font-weight: 600; }
  #side .hint-text { font-size: 12px; color: var(--muted); }
  #vtitle { font-size: 12px; color: #cfd3df; min-height: 16px; }
  #suprow { display: flex; gap: 6px; align-items: stretch; }
  #supbtn { flex: 1; min-width: 0; justify-content: flex-start; gap: 8px; padding: 7px 10px;
    font-size: 12.5px; font-weight: 500; text-align: left; color: var(--dim);
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
  #supbtn:hover:not(:disabled) { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.14); }
  #supbtn:disabled { opacity: .38; cursor: default; }
  #supbtn .dot { flex: 0 0 auto; width: 12px; height: 12px; border-radius: 3px;
    border: 1px solid rgba(255,255,255,.35); }
  #supbtn.on { background: color-mix(in srgb, var(--hl) 18%, transparent); color: #f6dcc0;
    border-color: color-mix(in srgb, var(--hl) 45%, transparent); }
  #supbtn.on .dot { background: var(--hl); border-color: var(--hl); }
  #supmode { flex: 0 0 auto; display: flex; align-items: stretch;
    border: 1px solid rgba(255,255,255,.14); border-radius: var(--r-ctl); overflow: hidden; }
  #supmode button { padding: 0 8px; font-size: 11.5px; font-weight: 400; color: var(--dim);
    background: transparent; border: 0; border-radius: 0; }
  #supmode button + button { border-left: 1px solid rgba(255,255,255,.14); }
  #supmode button:hover:not(:disabled) { background: rgba(255,255,255,.12); }
  #supmode button:disabled { opacity: .38; cursor: default; }
  #supmode button.on { background: color-mix(in srgb, var(--hl) 18%, transparent); color: #f6dcc0; }
  #search { width: 100%; padding: 8px 10px; font-size: 13px; line-height: 1.4;
    background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.14); }
  #search:focus { box-shadow: none; border-color: var(--accent); }
  #list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; padding: 0 4px; }
  .item { flex: 0 0 auto; display: block; width: 100%; text-align: left; padding: 6px 8px; font-size: 12.5px;
    font-weight: 400; line-height: 1.5;
    color: var(--dim); background: transparent; border: 0; border-radius: var(--r-sm); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .item:hover { background: rgba(255,255,255,.07); border: 0; }
  .item.on { background: color-mix(in srgb, var(--hl) 18%, transparent); color: #f6dcc0; }
  #ctrls { top: 12px; right: 12px; display: flex; gap: 6px; padding: 6px; }
  #ctrls button { width: 34px; height: 34px; padding: 0; font-size: 17px; color: var(--text);
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
  #ctrls button:hover { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.14); }
  #legend { bottom: 12px; right: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  #legbar { display: flex; align-items: center; gap: 8px; }
  #legend .scale { width: 150px; height: 10px; border-radius: 5px; }
  #legend .lab { color: var(--muted); }
  #cmap { font-size: 12px; color: var(--text); background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.14); border-radius: var(--r-sm); padding: 3px 6px; }
  #cmap:focus { box-shadow: none; }
  #tip { position: fixed; z-index: 6; display: none; pointer-events: none; padding: 6px 9px;
    background: rgba(8,10,16,.92); border: 1px solid rgba(255,255,255,.18); border-radius: var(--r-ctl); font-size: 12px; white-space: nowrap; }
  #tip b { font-size: 14px; }
  #tip span { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
  #toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 8;
    padding: 8px 14px; font-size: 13px; color: var(--text); background: rgba(8,10,16,.94);
    border: 1px solid rgba(255,255,255,.18); border-radius: var(--r-ctl); opacity: 0; transition: opacity .2s; pointer-events: none; }
  #toast.show { opacity: 1; }
  #ov { position: fixed; top: 0; right: 0; bottom: 0; left: var(--rail-w); z-index: 10;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; background: var(--bg); }
  #ov h2 { margin: 0; font-weight: 600; font-size: 16px; }
  #ovtext { color: var(--muted); font-size: 13px; }
  #track { width: min(320px, 70vw); }`;

  const body = `<canvas id="grid"></canvas>
<button id="sideshow" class="glass" title="Show panel" aria-label="Show panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg></button>
<div id="side" class="glass">
  <div class="sidehead"><h1>All 1,000,000 numbers</h1><button id="sidehide" title="Hide panel" aria-label="Hide panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg></button></div>
  <div class="credit">Heavily inspired by <b>basiliotornado</b></div>
  <div id="vtitle">All numbers - badge count</div>
  <div id="suprow">
    <button id="supbtn" disabled title="Darken numbers where a higher badge in the same family supersedes the selected badge (it still shows as earned but scores 0 there)"><span class="dot"></span>Hide superseded badges</button>
    <div id="supmode" title="Grey keeps superseded numbers faintly visible; black hides them entirely"><button id="supgrey" class="on" disabled>grey</button><button id="supblack" disabled>black</button></div>
  </div>
  <input id="search" type="search" placeholder="Filter 230 badges…" autocomplete="off">
  <div id="list"></div>
  <div class="hint-text">Pick a badge to highlight which numbers earn it. Click any cell to open it.</div>
</div>
<div id="ctrls" class="glass">
  <button id="zout" title="Zoom out">−</button>
  <button id="zreset" title="Fit">⤢</button>
  <button id="zin" title="Zoom in">+</button>
  <button id="zlink" title="Copy link to this view">🔗</button>
</div>
<div id="legend" class="glass">
  <select id="cmap" title="Colour scale (perceptually uniform)">
    <option>Grayscale</option><option>Viridis</option><option>Magma</option><option>Inferno</option><option>Plasma</option><option>Cividis</option>
  </select>
  <div id="legbar"></div>
</div>
<div id="tip"></div>
<div id="toast"></div>
<div id="ov">
  <h2>Building the grid…</h2>
  <div id="track" class="progress"><i id="bar"></i></div>
  <div id="ovtext">Scoring 1,000,000 numbers (one-time; cached after)…</div>
</div>`;

  const script = `
var __name = (f) => f;
const __GRID_WORKER_SRC = ${JSON.stringify('var __name=(f)=>f;(' + gridWorker.toString() + ')()')};
(${gridClient.toString()})(__GRID_WORKER_SRC, ${labels}, ${JSON.stringify(doms)});`;

  return pageShell({
    title: 'RNGdle - Number Grid', nav: 'grid', full: true, noindex: true, css, body, script,
    viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
  });
}

// ---------------------------------------------------------------------------
// /chains - the graph of n -> EP(n).
//
// Every number is a node with one outgoing edge, to its own EP score; if that score
// exceeds 1,000,000 it is not a legal input and the chain ends there (a "sink").
// Out-degree 1 makes this a functional graph: disjoint basins, each draining into
// either a sink or a cycle.
//
// Nothing here is precomputed or committed - the worker sweeps the live engine, so
// the graph always reflects the current badge rules. Like /analyze and /grid it runs
// client-side, off the same shared sweepShared() cache; only the graph build (edges,
// loops, radial layout) is specific to this page.
// ---------------------------------------------------------------------------

function chainsWorker() {
  const N = 1000001;
  // Layout kept here after the build so the plate can be panned and zoomed: the page
  // asks for a viewport and gets it rasterized at full resolution, rather than scaling
  // up one fixed bitmap. Positions never cross to the page - picking happens here too.
  let LAY = null;
  const HUES = [[255, 90, 92], [255, 176, 64], [110, 225, 140], [120, 170, 255], [225, 125, 255]];
  const SINK = [120, 145, 175];

  // Rasterize the layout rectangle [x0,y0]..[x1,y1] into an S x S RGBA buffer. Nodes and
  // edges are accumulated additively, then tone-mapped with a log rolloff, because the
  // core is thousands of times denser than the rim and would otherwise clip to white.
  function raster(x0, y0, x1, y1, S) {
    const { X, Y, nextOf, depth, attractor, cycIdx, roots } = LAY;
    const px = new Float32Array(S * S * 3);
    const sx = S / (x1 - x0), sy = S / (y1 - y0);
    const scale = Math.min(sx, sy);
    // Edge weight is per-pixel, so zooming in spreads the same ink over more pixels;
    // scale it down as we magnify or the zoomed view blows out to solid white.
    const w = 0.14 / Math.max(1, scale / LAY.baseScale);
    const nodeW = 0.5 / Math.max(1, scale / LAY.baseScale);
    const add = (x, y, c, k) => {
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      const i = ((y | 0) * S + (x | 0)) * 3;
      px[i] += c[0] * k; px[i + 1] += c[1] * k; px[i + 2] += c[2] * k;
    };
    const pad = 40 / scale;                     // keep edges that cross the view
    for (let n = 0; n < N; n++) {
      const nx = X[n], ny = Y[n];
      const p = nextOf[n], hasEdge = p >= 0 && depth[n] > 0;
      const px2 = hasEdge ? X[p] : nx, py2 = hasEdge ? Y[p] : ny;
      if (Math.max(nx, px2) < x0 - pad || Math.min(nx, px2) > x1 + pad ||
          Math.max(ny, py2) < y0 - pad || Math.min(ny, py2) > y1 + pad) continue;
      const a = attractor[n];
      const c = cycIdx.has(a) ? HUES[cycIdx.get(a) % HUES.length] : SINK;
      const ax = (nx - x0) * sx, ay = (ny - y0) * sy;
      if (hasEdge) {
        const bx = (px2 - x0) * sx, by = (py2 - y0) * sy;
        const dx = bx - ax, dy = by - ay;
        const steps = Math.min(4000, Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy))));
        for (let s = 0; s <= steps; s++) add(ax + dx * s / steps, ay + dy * s / steps, c, w);
      }
      add(ax, ay, c, nodeW);
    }
    for (const r of roots) {
      const c = cycIdx.has(attractor[r]) ? HUES[cycIdx.get(attractor[r]) % HUES.length] : SINK;
      const ax = (X[r] - x0) * sx, ay = (Y[r] - y0) * sy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(ax + dx, ay + dy, c, 2.2 * nodeW / 0.5);
    }
    const rgba = new Uint8ClampedArray(S * S * 4);
    const denom = Math.log1p(255 * 0.05);
    for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
      for (let k = 0; k < 3; k++) rgba[j + k] = Math.pow(Math.log1p(px[i + k] * 0.05) / denom, 0.75) * 255;
      rgba[j + 3] = 255;
    }
    return rgba;
  }

  // Nearest node to a layout point, searched through a uniform bucket grid.
  function pick(x, y, radius) {
    const { X, Y, grid, gw, gh, gx0, gy0, cell } = LAY;
    const c0 = Math.max(0, Math.floor((x - radius - gx0) / cell)), c1 = Math.min(gw - 1, Math.floor((x + radius - gx0) / cell));
    const r0 = Math.max(0, Math.floor((y - radius - gy0) / cell)), r1 = Math.min(gh - 1, Math.floor((y + radius - gy0) / cell));
    let best = -1, bestD = radius * radius;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      for (const n of (grid[r * gw + c] || [])) {
        const dx = X[n] - x, dy = Y[n] - y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    return best;
  }

  // The local graph around one number, for the network view: breadth-first over the
  // UNDIRECTED graph, so it picks up both what `focus` scores its way toward and the
  // numbers that score their way into it. Capped, because a readable node-link diagram
  // tops out in the low hundreds - the whole million only reads as the radial plate.
  function neighbourhood(focus, cap, hops) {
    const { nextOf, depth, attractor, cycIdx, inOff, inSrc } = LAY;
    const idx = new Map([[focus, 0]]);
    const order = [focus];
    const hop = [0];
    let reachedHopLimit = false;
    for (let head = 0; head < order.length && order.length < cap; head++) {
      const n = order[head];
      if (hop[head] >= hops) { reachedHopLimit = true; continue; }
      if (nextOf[n] >= 0 && !idx.has(nextOf[n])) { idx.set(nextOf[n], order.length); order.push(nextOf[n]); hop.push(hop[head] + 1); }
      for (let i = inOff[n]; i < inOff[n + 1]; i++) {
        if (order.length >= cap) break;
        const q = inSrc[i];
        if (idx.has(q)) continue;
        idx.set(q, order.length); order.push(q); hop.push(hop[head] + 1);
      }
    }
    const edges = [];
    for (const n of order) {
      const p = nextOf[n];
      if (p >= 0 && idx.has(p)) edges.push(idx.get(n), idx.get(p));
    }
    // Flat typed arrays rather than objects: at tens of thousands of nodes the object
    // allocation and the structured clone both start to show.
    const num = new Int32Array(order.length), dep = new Int32Array(order.length);
    const slot = new Int8Array(order.length), flag = new Uint8Array(order.length), deg = new Int32Array(order.length);
    order.forEach((n, i) => {
      num[i] = n; dep[i] = depth[n];
      slot[i] = cycIdx.has(attractor[n]) ? cycIdx.get(attractor[n]) : -1;
      flag[i] = (depth[n] === 0 && nextOf[n] >= 0 ? 1 : 0) | (nextOf[n] < 0 ? 2 : 0);   // 1 loop, 2 sink
      deg[i] = inOff[n + 1] - inOff[n];
    });
    const eArr = Int32Array.from(edges);
    return { focus, count: order.length, num, dep, slot, flag, deg, edges: eArr,
             truncated: order.length >= cap, hopLimited: reachedHopLimit };
  }

  self.onmessage = async (ev) => {
    const m = ev.data;
    if (m.cmd === 'view' && LAY) {
      const img = raster(m.x0, m.y0, m.x1, m.y1, m.size);
      self.postMessage({ type: 'view', id: m.id, size: m.size, image: img.buffer }, [img.buffer]);
      return;
    }
    if (m.cmd === 'pick' && LAY) {
      const n = pick(m.x, m.y, m.radius);
      self.postMessage({ type: 'pick', id: m.id, n, next: n >= 0 ? LAY.nextOf[n] : -1, depth: n >= 0 ? LAY.depth[n] : -1 });
      return;
    }
    if (m.cmd === 'neigh' && LAY) {
      const r = neighbourhood(m.focus, m.cap || 220, m.hops == null ? 99 : m.hops);
      self.postMessage({ type: 'neigh', id: m.id, ...r },
        [r.num.buffer, r.dep.buffer, r.slot.buffer, r.flag.buffer, r.deg.buffer, r.edges.buffer]);
      return;
    }
    if (m.cmd !== 'build') return;
    const say = (phase, pct) => self.postMessage({ type: 'progress', phase, pct });
    try {
      const E = await import(m.origin + '/engine.js');
      say('Scoring every number', 0);
      // Shared with / and /grid: on a warm cache this returns immediately and only the
      // graph build below (edges, loops, layout) actually costs anything.
      const swept = await E.sweepShared(m.origin, p => say('Scoring every number', p));
      const EP = swept.ep;

      // --- edges -----------------------------------------------------------
      say('Building edges', 0);
      const nextOf = new Int32Array(N);
      let sinkCount = 0;
      for (let n = 0; n < N; n++) {
        const e = EP[n];
        nextOf[n] = (Number.isInteger(e) && e >= 0 && e < N) ? e : -1;
        if (nextOf[n] < 0) sinkCount++;
      }

      // --- attractors + depth ----------------------------------------------
      // Walk each unvisited number until it meets a settled node, the end of a chain,
      // or itself (a cycle), then unwind assigning depth outward from the attractor.
      say('Finding loops', 0);
      const depth = new Int32Array(N).fill(-1);
      const attractor = new Int32Array(N).fill(-1);
      const state = new Uint8Array(N);              // 0 unseen, 1 on current path, 2 settled
      const attractors = [];                        // {kind, node|members}
      const path = [];
      for (let start = 0; start < N; start++) {
        if (state[start]) continue;
        if ((start & 0x3FFFF) === 0) say('Finding loops', start / N);
        let n = start;
        while (n >= 0 && state[n] === 0) { state[n] = 1; path.push(n); n = nextOf[n]; }
        let attr, base = 0;
        if (n < 0) {                                // ran off the end: last node is a sink
          const sink = path.pop();
          attr = attractors.push({ kind: 'sink', node: sink, ep: EP[sink] }) - 1;
          attractor[sink] = attr; depth[sink] = 0; state[sink] = 2;
        } else if (state[n] === 1) {                // closed a loop
          const at = path.lastIndexOf(n);
          const members = path.slice(at);
          attr = attractors.push({ kind: 'cycle', members }) - 1;
          for (const c of members) { attractor[c] = attr; depth[c] = 0; state[c] = 2; }
          path.length = at;
        } else { attr = attractor[n]; base = depth[n]; }
        while (path.length) { const q = path.pop(); attractor[q] = attr; depth[q] = ++base; state[q] = 2; }
      }

      // --- radial layout ----------------------------------------------------
      // Radius is depth; angle is a leaf-proportional sector, which spreads the
      // outermost nodes evenly (sizing by subtree mass collapses long thin branches).
      say('Laying out', 0);
      let maxDepth = 0;
      for (let n = 0; n < N; n++) if (depth[n] > maxDepth) maxDepth = depth[n];
      const byDepth = [];
      for (let d = 0; d <= maxDepth; d++) byDepth.push([]);
      for (let n = 0; n < N; n++) byDepth[depth[n]].push(n);
      const kids = new Int32Array(N);
      for (let n = 0; n < N; n++) if (depth[n] > 0) kids[nextOf[n]]++;
      const leaves = new Int32Array(N);
      for (let n = 0; n < N; n++) if (kids[n] === 0) leaves[n] = 1;
      for (let d = maxDepth; d >= 1; d--) for (const n of byDepth[d]) leaves[nextOf[n]] += leaves[n];

      const a0 = new Float64Array(N), span = new Float64Array(N);
      const roots = byDepth[0].slice().sort((x, y) => attractor[x] - attractor[y] || x - y);
      let total = 0; for (const r of roots) total += leaves[r];
      let cur = 0;
      for (const r of roots) { a0[r] = cur / total * Math.PI * 2; span[r] = leaves[r] / total * Math.PI * 2; cur += leaves[r]; }
      for (let d = 0; d < maxDepth; d++) {
        const used = new Map();
        for (const n of byDepth[d + 1]) {
          const p = nextOf[n], u = used.get(p) || 0;
          a0[n] = a0[p] + span[p] * (u / leaves[p]);
          span[n] = span[p] * (leaves[n] / leaves[p]);
          used.set(p, u + leaves[n]);
        }
      }

      // --- layout coordinates ------------------------------------------------
      // Kept in worker-local units; raster() maps whatever rectangle the page asks for
      // into pixels, so zooming re-renders at full resolution instead of magnifying.
      say('Laying out', 0.5);
      const cycIdx = new Map();                     // attractor index -> colour slot
      attractors.forEach((a, i) => { if (a.kind === 'cycle') cycIdx.set(i, cycIdx.size); });
      const X = new Float32Array(N), Y = new Float32Array(N);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let n = 0; n < N; n++) {
        const ang = a0[n] + span[n] / 2, rad = depth[n] + 0.7;
        const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
        X[n] = x; Y[n] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      // Square the extent so the page can map view rectangles without distortion.
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const half = Math.max(maxX - minX, maxY - minY) / 2 * 1.02;
      const bounds = { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half };

      // Uniform bucket grid for hit-testing, ~1,000 buckets across.
      const cell = (half * 2) / 1000, gw = 1002, gh = 1002;
      const grid = new Array(gw * gh);
      for (let n = 0; n < N; n++) {
        const c = Math.floor((X[n] - bounds.x0) / cell), r = Math.floor((Y[n] - bounds.y0) / cell);
        if (c < 0 || r < 0 || c >= gw || r >= gh) continue;
        const k = r * gw + c;
        (grid[k] || (grid[k] = [])).push(n);
      }

      // Reverse adjacency (CSR), so the network view can walk in-edges: which numbers
      // score their way INTO a given number. Out-edges are just nextOf.
      const inOff = new Int32Array(N + 2);
      for (let n = 0; n < N; n++) if (nextOf[n] >= 0) inOff[nextOf[n] + 1]++;
      for (let i = 1; i <= N; i++) inOff[i] += inOff[i - 1];
      const inSrc = new Int32Array(N - sinkCount);
      const cursor = inOff.slice(0, N + 1);
      for (let n = 0; n < N; n++) if (nextOf[n] >= 0) inSrc[cursor[nextOf[n]]++] = n;

      const S = m.size || 1500;
      LAY = { X, Y, nextOf, depth, attractor, cycIdx, roots, bounds, inOff, inSrc,
              grid, gw, gh, gx0: bounds.x0, gy0: bounds.y0, cell,
              baseScale: S / (half * 2) };

      say('Drawing', 0);
      const rgba = raster(bounds.x0, bounds.y0, bounds.x1, bounds.y1, S);

      // --- structures for the page -----------------------------------------
      const basin = new Int32Array(attractors.length);
      const hist = {};
      let deepest = 0;
      for (let n = 0; n < N; n++) {
        basin[attractor[n]]++;
        hist[depth[n]] = (hist[depth[n]] || 0) + 1;
        if (depth[n] > depth[deepest]) deepest = n;
      }
      const walk = (from, cap) => { const out = [], seen = new Set(); for (let n = from; n >= 0 && !seen.has(n); n = nextOf[n]) { seen.add(n); out.push(n); if (out.length >= cap) break; } return out; };
      const cycles = attractors.map((a, i) => ({ a, i })).filter(o => o.a.kind === 'cycle')
        .map(o => ({ length: o.a.members.length, basin: basin[o.i], members: o.a.members, slot: cycIdx.get(o.i) }))
        .sort((p, q) => q.basin - p.basin);
      const sinks = attractors.map((a, i) => ({ a, i })).filter(o => o.a.kind === 'sink')
        .map(o => ({ sink: o.a.node, ep: o.a.ep, basin: basin[o.i] }))
        .sort((p, q) => q.basin - p.basin);
      let deepestSink = 0;
      for (let n = 0; n < N; n++) if (!cycIdx.has(attractor[n]) && depth[n] > depth[deepestSink]) deepestSink = n;
      const escNodes = walk(deepestSink, depth[deepestSink] + 1);

      // The page traces user-entered numbers itself, so it gets the successor of every
      // number. In-range steps need nothing else - the next number IS the score - so only
      // the 1,065 out-of-range scores ride along beside it. It's a COPY: the original
      // stays here for the plate's re-renders and hit-testing, and transferring would
      // detach it.
      const sinkEP = {};
      for (const s of sinks) sinkEP[s.sink] = s.ep;
      const nextCopy = nextOf.slice();

      self.postMessage({
        type: 'done', size: S, image: rgba.buffer, nextOf: nextCopy.buffer, sinkEP, bounds,
        counts: {
          nodes: N, edges: N - sinkCount, sinks: sinkCount, maxDepth,
          inCycles: cycles.reduce((s, c) => s + c.basin, 0),
          inSinks: sinks.reduce((s, c) => s + c.basin, 0),
        },
        cycles, topSinks: sinks.slice(0, 15), hist,
        deepestChain: { start: deepest, depth: depth[deepest], nodes: walk(deepest, depth[deepest] + 1) },
        // `ep` is the SINK's score - the out-of-range value that ends the chain.
        escapeChain: { start: deepestSink, depth: depth[deepestSink], nodes: escNodes, ep: EP[escNodes[escNodes.length - 1]] },
      }, [rgba.buffer, nextCopy.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

function chainsClient(WORKER_SRC) {
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-US');
  const HUES = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
  const status = $('status'), bar = $('bar');

  let viewHandlers = null;                     // set once the plate is interactive
  const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
  w.onmessage = ev => {
    const m = ev.data;
    if (viewHandlers && viewHandlers[m.type]) { viewHandlers[m.type](m); return; }
    if (m.type === 'progress') {
      status.textContent = m.phase + '…';
      bar.style.width = Math.round((m.pct || 0) * 100) + '%';
      return;
    }
    if (m.type === 'error') {
      status.textContent = 'Could not build the graph: ' + m.message;
      bar.parentElement.style.display = 'none';
      return;
    }
    render(m);
  };
  w.postMessage({ cmd: 'build', origin: location.origin, size: 1500 });

  function render(D) {
    $('loading').style.display = 'none';
    document.body.classList.add('ready');

    // --- the plate: pan, zoom, hover, click --------------------------------
    // The worker owns the layout, so a new view is a fresh full-resolution raster
    // rather than a magnified bitmap. While the view is moving we transform the last
    // frame we have (fast but soft) and swap in the crisp one once it settles.
    const cv = $('plate'), ctx = cv.getContext('2d');
    const B = D.bounds;
    let img = null, imgView = null;            // last raster + the rect it covers
    let view = { x0: B.x0, y0: B.y0, x1: B.x1, y1: B.y1 };
    let pending = 0, reqId = 0, hoverId = 0;

    const bmp = document.createElement('canvas');
    const setImg = (buf, size, rect) => {
      bmp.width = size; bmp.height = size;
      bmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf), size, size), 0, 0);
      img = bmp; imgView = rect;
      paint();
    };
    function paint() {
      const dpr = Math.min(2, self.devicePixelRatio || 1);
      const w = cv.clientWidth || 700;
      if (cv.width !== Math.round(w * dpr)) { cv.width = cv.height = Math.round(w * dpr); }
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (!img) return;
      // Map the raster's rect into the current view.
      const s = cv.width / (view.x1 - view.x0);
      const dx = (imgView.x0 - view.x0) * s, dy = (imgView.y0 - view.y0) * s;
      const dw = (imgView.x1 - imgView.x0) * s, dh = (imgView.y1 - imgView.y0) * s;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    function requestView() {
      clearTimeout(pending);
      pending = setTimeout(() => {
        const id = ++reqId;
        $('plate-wrap').classList.add('busy');
        w.postMessage({ cmd: 'view', id, x0: view.x0, y0: view.y0, x1: view.x1, y1: view.y1, size: D.size });
      }, 180);
    }
    viewHandlers = {
      view: msg => {
        if (msg.id !== reqId) return;            // a newer view already asked
        $('plate-wrap').classList.remove('busy');
        setImg(msg.image, msg.size, { x0: view.x0, y0: view.y0, x1: view.x1, y1: view.y1 });
      },
      pick: msg => {
        if (msg.id !== hoverId) return;
        const el = $('plate-readout');
        if (msg.n < 0) { el.textContent = ''; cv.style.cursor = 'grab'; hoverN = -1; return; }
        hoverN = msg.n;
        cv.style.cursor = 'pointer';
        el.innerHTML = '<strong>' + fmt(msg.n) + '</strong> → ' +
          (msg.next < 0 ? 'ends here' : fmt(msg.next)) + ' · ' + msg.depth + ' step' + (msg.depth === 1 ? '' : 's') + ' from settling';
      },
    };
    setImg(D.image, D.size, { x0: B.x0, y0: B.y0, x1: B.x1, y1: B.y1 });

    const toLayout = e => {
      const r = cv.getBoundingClientRect();
      return { x: view.x0 + (e.clientX - r.left) / r.width * (view.x1 - view.x0),
               y: view.y0 + (e.clientY - r.top) / r.height * (view.y1 - view.y0) };
    };
    function zoomAt(pt, factor) {
      const w0 = (view.x1 - view.x0) * factor;
      const full = B.x1 - B.x0;
      if (w0 > full * 1.05 || w0 < full / 4000) return;
      const fx = (pt.x - view.x0) / (view.x1 - view.x0), fy = (pt.y - view.y0) / (view.y1 - view.y0);
      view = { x0: pt.x - w0 * fx, y0: pt.y - w0 * fy, x1: pt.x + w0 * (1 - fx), y1: pt.y + w0 * (1 - fy) };
      paint(); requestView(); updateZoom();
    }
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (mode === 'network') {
        if (!net) return;
        net.autofit = false;
        net.scale = Math.max(0.25, Math.min(6, net.scale * (e.deltaY > 0 ? 0.85 : 1.18)));
        drawNet();
        return;
      }
      zoomAt(toLayout(e), e.deltaY > 0 ? 1.25 : 0.8);
    }, { passive: false });

    let drag = null, hoverN = -1;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
      if (mode === 'network') {
        if (!net) return;
        const hit = netPick(netAt(e));
        drag = { sx: e.clientX, sy: e.clientY, ox: net.ox, oy: net.oy, node: hit, moved: false };
        if (hit >= 0) { net.held = hit; net.alpha = Math.max(net.alpha, 0.35); tick(); }
        return;
      }
      drag = { ...toLayout(e), moved: false };
    });
    cv.addEventListener('pointermove', e => {
      if (mode === 'network') {
        if (!net) return;
        if (drag) {
          if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2) drag.moved = true;
          net.autofit = false;
          if (drag.node >= 0) {                             // drag the node itself
            const pt = netAt(e);
            net.x[drag.node] = pt.x; net.y[drag.node] = pt.y;
            drawNet();
          } else {                                          // pan the whole graph
            net.ox = drag.ox + (e.clientX - drag.sx);
            net.oy = drag.oy + (e.clientY - drag.sy);
            drawNet();
          }
          return;
        }
        const hit = netPick(netAt(e));
        if (hit !== netHover) {
          netHover = hit;
          cv.style.cursor = hit >= 0 ? 'pointer' : 'grab';
          const d = hit >= 0 ? net.deg[hit] : 0;
          $('plate-readout').innerHTML = hit >= 0
            ? '<strong>' + fmt(net.num[hit]) + '</strong> · ' +
              ((net.flag[hit] & 2) ? 'ends here' : (net.flag[hit] & 1) ? 'in a loop'
                : net.dep[hit] + ' step' + (net.dep[hit] === 1 ? '' : 's') + ' from settling') +
              ' · ' + fmt(d) + (d === 1 ? ' number scores it' : ' numbers score it')
            : '';
          drawNet();
        }
        return;
      }
      if (drag) {
        const p = toLayout(e);
        const dx = drag.x - p.x, dy = drag.y - p.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
        view = { x0: view.x0 + dx, y0: view.y0 + dy, x1: view.x1 + dx, y1: view.y1 + dy };
        paint(); requestView();
        return;
      }
      const p = toLayout(e);
      const id = ++hoverId;
      w.postMessage({ cmd: 'pick', id, x: p.x, y: p.y, radius: (view.x1 - view.x0) / cv.clientWidth * 6 });
    });
    const endDrag = () => {
      if (!drag) return;
      const wasClick = !drag.moved, node = drag.node;
      drag = null; cv.style.cursor = 'grab';
      if (mode === 'network') {
        if (net) net.held = -1;
        if (wasClick && node >= 0) { const n = net.num[node]; trace(n, true); loadNet(n); }  // click re-centres
        return;
      }
      if (wasClick && hoverN >= 0) { trace(hoverN, true); $('trace-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', () => { $('plate-readout').textContent = ''; hoverN = -1; netHover = -1; if (mode === 'network') drawNet(); });

    function updateZoom() {
      const z = (B.x1 - B.x0) / (view.x1 - view.x0);
      $('plate-zoom').textContent = z < 1.05 ? 'whole graph' : z.toFixed(z < 10 ? 1 : 0) + '× zoom';
      $('plate-reset').hidden = z < 1.05;
    }
    $('plate-reset').addEventListener('click', () => {
      if (mode === 'network') { if (net) { net.autofit = true; net.alpha = 1; tick(); } return; }
      view = { x0: B.x0, y0: B.y0, x1: B.x1, y1: B.y1 };
      paint(); requestView(); updateZoom();
    });
    addEventListener('resize', () => (mode === 'network' ? drawNet() : paint()));
    updateZoom();

    // --- network view: the local graph around one number ---------------------
    // Small circular nodes and links, laid out by a plain force simulation. Only the
    // neighbourhood is drawn - a node-link diagram stops being readable in the low
    // hundreds, which is exactly what the radial plate is for.
    let mode = 'radial', net = null, netReq = 0, raf = 0;
    const NET_HUE = ['#FF5A5C', '#FFB040', '#6EE18C', '#78AAFF', '#E17DFF'];
    const SINK_HUE = '#7891AF';
    const netColour = d => d.sink ? SINK_HUE : (d.slot >= 0 ? NET_HUE[d.slot % NET_HUE.length] : SINK_HUE);

    viewHandlers.neigh = msg => {
      if (msg.id !== netReq) return;
      $('plate-wrap').classList.remove('busy');
      const C = msg.count;
      const num = new Int32Array(msg.num), dep = new Int32Array(msg.dep);
      const slot = new Int8Array(msg.slot), flag = new Uint8Array(msg.flag), deg = new Int32Array(msg.deg);
      // Seed on a spiral sized to the node count, so a big neighbourhood does not start
      // as one hopelessly overlapped ring and spend its whole budget untangling.
      const R = 34 * Math.sqrt(C);
      const x = new Float32Array(C), y = new Float32Array(C);
      const vx = new Float32Array(C), vy = new Float32Array(C), rad = new Float32Array(C);
      for (let i = 0; i < C; i++) {
        const t = i / C, a = t * Math.PI * 2 * Math.ceil(Math.sqrt(C) / 2);
        x[i] = Math.cos(a) * R * Math.sqrt(t); y[i] = Math.sin(a) * R * Math.sqrt(t);
        const r = Math.min(9, 3.2 + Math.sqrt(deg[i]) * 1.1);
        rad[i] = i === 0 ? Math.max(5.5, r) : r;
      }
      x[0] = y[0] = 0;
      net = {
        focus: msg.focus, truncated: msg.truncated, hopLimited: msg.hopLimited, count: C,
        num, dep, slot, flag, deg, x, y, vx, vy, rad, edges: new Int32Array(msg.edges),
        scale: 1, ox: 0, oy: 0, alpha: 1, held: -1, autofit: true,
        // Repulsion is short-range, so it only ever needs nearby nodes. Shrinking the
        // cutoff as the graph grows keeps the per-cell neighbour count bounded, which is
        // what turns this from O(n^2) into something that survives tens of thousands.
        cut: Math.max(26, 300 / Math.sqrt(Math.max(1, C / 220))),
      };
      $('net-count').textContent = fmt(C) + ' node' + (C === 1 ? '' : 's') +
        (msg.truncated ? ' (capped)' : msg.hopLimited ? '' : ' - whole basin');
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (let i = 0; i < Math.min(300, 90000 / Math.sqrt(C)); i++) step();
        net.alpha = 0;
      }
      tick();
    };

    function step() {
      const { x, y, vx, vy, count: L, edges, cut } = net;
      // Bucket every node by cell, so repulsion only visits the 3x3 cells around it.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < L; i++) {
        if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
        if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
      }
      const gw = Math.max(1, Math.min(600, Math.ceil((x1 - x0) / cut) + 1));
      const gh = Math.max(1, Math.min(600, Math.ceil((y1 - y0) / cut) + 1));
      const cw = (x1 - x0) / gw || 1, ch = (y1 - y0) / gh || 1;
      // Buffers are reused across frames - at a few hundred thousand nodes, allocating
      // three typed arrays per step costs more than the forces do.
      if (!net.buf || net.buf.head.length < gw * gh || net.buf.nxt.length < L)
        net.buf = { head: new Int32Array(Math.max(gw * gh, 4096)), nxt: new Int32Array(L), cellOf: new Int32Array(L) };
      const { nxt, cellOf } = net.buf;
      const head = net.buf.head;
      head.fill(-1, 0, gw * gh);
      for (let i = 0; i < L; i++) {
        const c = Math.min(gw - 1, Math.max(0, ((x[i] - x0) / cw) | 0));
        const r = Math.min(gh - 1, Math.max(0, ((y[i] - y0) / ch) | 0));
        const k = r * gw + c;
        cellOf[i] = k; nxt[i] = head[k]; head[k] = i;
      }
      const cut2 = cut * cut, K = 900 * Math.min(1, cut / 300);
      for (let i = 0; i < L; i++) {
        const ci = cellOf[i], cr = (ci / gw) | 0, cc = ci - cr * gw;
        for (let r = Math.max(0, cr - 1); r <= Math.min(gh - 1, cr + 1); r++) {
          for (let c = Math.max(0, cc - 1); c <= Math.min(gw - 1, cc + 1); c++) {
            for (let j = head[r * gw + c]; j >= 0; j = nxt[j]) {
              if (j <= i) continue;
              let dx = x[i] - x[j], dy = y[i] - y[j];
              let d2 = dx * dx + dy * dy;
              if (d2 > cut2) continue;
              if (d2 < 1e-4) { dx = (i % 7) - 3; dy = (j % 7) - 3; d2 = dx * dx + dy * dy + 1e-4; }
              // Clamped: K/d2 diverges as two nodes coincide, and one such kick flings a
              // node clear of the cluster, which then wrecks the auto-framing.
              const f = Math.min(3.5, K / d2), d = Math.sqrt(d2);
              const ux = dx / d * f, uy = dy / d * f;
              vx[i] += ux; vy[i] += uy; vx[j] -= ux; vy[j] -= uy;
            }
          }
        }
      }
      const rest = net.count > 4000 ? 26 : 46;
      for (let e = 0; e < edges.length; e += 2) {           // springs
        const s = edges[e], t = edges[e + 1];
        const dx = x[t] - x[s], dy = y[t] - y[s];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
        const f = Math.max(-6, Math.min(6, (d - rest) * 0.045));
        const ux = dx / d * f, uy = dy / d * f;
        vx[s] += ux; vy[s] += uy; vx[t] -= ux; vy[t] -= uy;
      }
      const pull = 0.0025 * Math.min(1, 220 / Math.max(1, net.count)) + 0.0004;
      for (let i = 0; i < L; i++) {                         // centring + damping
        vx[i] -= x[i] * pull; vy[i] -= y[i] * pull;
        if (i === net.held) { vx[i] = vy[i] = 0; continue; }
        vx[i] *= 0.86; vy[i] *= 0.86;
        const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);  // terminal velocity, same reason
        if (sp > 14) { vx[i] = vx[i] / sp * 14; vy[i] = vy[i] / sp * 14; }
        x[i] += vx[i]; y[i] += vy[i];
      }
    }

    function drawNet() {
      const dpr = Math.min(2, self.devicePixelRatio || 1);
      const w = cv.clientWidth || 700;
      if (cv.width !== Math.round(w * dpr)) { cv.width = cv.height = Math.round(w * dpr); }
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (!net) return;
      const S = cv.width;
      // Keep the whole neighbourhood framed while it settles; the moment the reader
      // pans, zooms or drags a node, the framing is theirs and we stop interfering.
      const { x, y, rad, num, slot, flag, count: L, edges } = net;
      if (net.autofit) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < L; i++) {
          if (x[i] - rad[i] < x0) x0 = x[i] - rad[i]; if (x[i] + rad[i] > x1) x1 = x[i] + rad[i];
          if (y[i] - rad[i] < y0) y0 = y[i] - rad[i]; if (y[i] + rad[i] > y1) y1 = y[i] + rad[i];
        }
        const span = Math.max(x1 - x0, y1 - y0, 1);
        net.scale = Math.max(0.02, Math.min(6, (cv.clientWidth || 700) * 0.86 / span * 1.6));
        net.ox = -((x0 + x1) / 2) * (net.scale / 1.6);
        net.oy = -((y0 + y1) / 2) * (net.scale / 1.6);
      }
      // Past a few thousand nodes, circles and per-node strokes stop being legible and
      // stop being affordable, so the marks thin out: fainter links, flat dots, no labels.
      const big = L > 3000, huge = L > 30000;
      ctx.save();
      ctx.translate(S / 2 + net.ox * dpr, S / 2 + net.oy * dpr);
      ctx.scale(net.scale * dpr / 1.6, net.scale * dpr / 1.6);
      const k = 1.6 / net.scale;                            // keep strokes ~constant on screen
      ctx.lineWidth = (huge ? 0.5 : big ? 0.8 : 1.1) * k;
      // Alpha falls with node count: thousands of overlapping links at a fixed alpha
      // accumulate to a solid white disc that says nothing.
      const ea = Math.max(0.012, Math.min(0.30, 0.30 * Math.sqrt(1200 / Math.max(1, L))));
      ctx.strokeStyle = 'rgba(188,198,220,' + ea.toFixed(3) + ')';
      ctx.beginPath();
      for (let e = 0; e < edges.length; e += 2) {
        ctx.moveTo(x[edges[e]], y[edges[e]]); ctx.lineTo(x[edges[e + 1]], y[edges[e + 1]]);
      }
      ctx.stroke();
      // One path per basin rather than a fill call per node. Swept by colour slot rather
      // than bucketed into arrays first: at this size, building the buckets each frame
      // costs more than the extra passes.
      ctx.globalAlpha = huge ? .7 : .88;
      for (let sl = -1; sl < NET_HUE.length; sl++) {
        ctx.fillStyle = sl < 0 ? SINK_HUE : NET_HUE[sl];
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < L; i++) {
          const s = (flag[i] & 2) ? -1 : (slot[i] >= 0 ? slot[i] % NET_HUE.length : -1);
          if (s !== sl) continue;
          const r = huge ? Math.max(0.7, rad[i] * 0.35) : big ? Math.max(1.4, rad[i] * 0.6) : rad[i];
          ctx.moveTo(x[i] + r, y[i]);
          ctx.arc(x[i], y[i], r, 0, Math.PI * 2);
          any = true;
        }
        if (any) ctx.fill();
      }
      ctx.globalAlpha = 1;
      // The focus always keeps its ring; loop members only while they are distinguishable.
      for (let i = 0; i < L; i++) {
        const isFocus = num[i] === net.focus;
        if (!isFocus && (big || !(flag[i] & 1))) continue;
        const col = (flag[i] & 2) ? SINK_HUE : (slot[i] >= 0 ? NET_HUE[slot[i] % NET_HUE.length] : SINK_HUE);
        ctx.lineWidth = (isFocus ? 2.4 : 1.4) * k;
        ctx.strokeStyle = isFocus ? '#fff' : col;
        ctx.beginPath(); ctx.arc(x[i], y[i], rad[i] + 3.4 * k, 0, Math.PI * 2); ctx.stroke();
      }
      if (!big) {
        ctx.font = (11 * k) + 'px ui-monospace, monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < L; i++) {
          if (num[i] !== net.focus && rad[i] < 5.4 && i !== netHover) continue;
          ctx.fillStyle = num[i] === net.focus ? '#fff' : 'rgba(215,222,235,.9)';
          ctx.fillText(num[i].toLocaleString('en-US'), x[i], y[i] - rad[i] - 5 * k);
        }
      }
      ctx.restore();
    }

    function tick() {
      cancelAnimationFrame(raf);
      const run = () => {
        if (mode !== 'network' || !net) return;
        if (net.alpha > 0) { step(); net.alpha -= 0.0045; }
        drawNet();
        if (net.alpha > 0 || net.held) raf = requestAnimationFrame(run);
      };
      raf = requestAnimationFrame(run);
    }

    let netHover = -1;
    const netAt = e => {                                   // screen -> sim coords
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - r.width / 2 - net.ox) / (net.scale / 1.6),
               y: (e.clientY - r.top - r.height / 2 - net.oy) / (net.scale / 1.6) };
    };
    const netPick = pt => {
      const reach = 15 / (net.scale / 1.6);                // constant on screen, not in sim units
      let best = -1, bd = reach * reach;
      for (let i = 0; i < net.count; i++) {
        const dx = net.x[i] - pt.x, dy = net.y[i] - pt.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };

    function loadNet(focus) {
      const sel = $('net-depth');
      const [hops, cap] = sel.value.split(':').map(Number);
      $('plate-wrap').classList.add('busy');
      $('net-count').textContent = 'expanding…';
      w.postMessage({ cmd: 'neigh', id: ++netReq, focus, cap, hops });
    }
    $('net-depth').addEventListener('change', () => { if (mode === 'network') loadNet(net ? net.focus : lastTraced); });
    function setMode(next, focus) {
      mode = next;
      document.body.classList.toggle('net-mode', next === 'network');
      for (const btn of $('plate-modes').querySelectorAll('button')) btn.classList.toggle('on', btn.dataset.mode === next);
      $('plate-reset').hidden = next === 'network' ? false : (B.x1 - B.x0) / (view.x1 - view.x0) < 1.05;
      $('plate-readout').textContent = '';
      if (next === 'radial') { cancelAnimationFrame(raf); updateZoom(); paint(); return; }
      $('plate-zoom').textContent = '';
      loadNet(focus != null ? focus : (lastTraced >= 0 ? lastTraced : D.deepestChain.start));
    }
    $('plate-modes').addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      setMode(btn.dataset.mode);
    });

    // --- figures -----------------------------------------------------------
    const c = D.counts;
    const figs = [
      ['Numbers', fmt(c.nodes), 'every input 0–1,000,000'],
      ['Arrows', fmt(c.edges), 'scores that stay in range'],
      ['Sinks', fmt(c.sinks), 'chains that end'],
      ['Loops', String(D.cycles.length), 'lengths ' + D.cycles.map(x => x.length).join(', ')],
      ['Deepest', String(c.maxDepth), 'steps, from ' + fmt(D.deepestChain.start)],
    ];
    $('figures').innerHTML = figs.map(f =>
      '<div class="stat stat-lg"><span class="k">' + f[0] + '</span><span class="v">' + f[1] +
      '<span class="sub">' + f[2] + '</span></span></div>').join('');

    $('loop-lede').textContent = 'Follow the arrows far enough and you almost never fall off the end - you land in a cycle and go round forever. There are exactly ' + D.cycles.length +
      ', holding ' + fmt(c.inCycles) + ' numbers between them (' + (c.inCycles / c.nodes * 100).toFixed(1) + '% of the range). Hover a node to read its step.';

    // --- loops as node-link rings -----------------------------------------
    $('loops').innerHTML = D.cycles.map(cy => {
      const n = cy.members.length, big = n > 24, S = 210, C = S / 2, R = S / 2 - (big ? 16 : 34);
      const pt = i => { const a = -Math.PI / 2 + i / n * Math.PI * 2; return [C + Math.cos(a) * R, C + Math.sin(a) * R]; };
      let g = '';
      for (let i = 0; i < n; i++) {
        const p = pt(i), q = pt((i + 1) % n);
        g += '<line x1="' + p[0].toFixed(1) + '" y1="' + p[1].toFixed(1) + '" x2="' + q[0].toFixed(1) + '" y2="' + q[1].toFixed(1) +
             '" stroke="' + HUES[cy.slot % HUES.length] + '" stroke-width="1" opacity=".45"/>';
      }
      for (let i = 0; i < n; i++) {
        const p = pt(i);
        g += '<g class="node" tabindex="0" role="button" data-n="' + cy.members[i] + '" data-next="' + cy.members[(i + 1) % n] + '">' +
             '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (big ? 2.6 : 4) + '" fill="' + HUES[cy.slot % HUES.length] + '"/></g>';
        if (!big) g += '<text x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" dy="-9" text-anchor="middle" font-size="9" ' +
             'fill="currentColor" opacity=".72" font-family="ui-monospace,monospace">' + cy.members[i] + '</text>';
      }
      return '<div class="loop"><h3><span class="swatch" style="background:' + HUES[cy.slot % HUES.length] + '"></span>' +
        cy.length + '-step loop</h3><p class="meta mono">' + fmt(cy.basin) + ' numbers drain into it · ' +
        (cy.basin / c.nodes * 100).toFixed(1) + '%</p><svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="Ring diagram of a ' +
        cy.length + '-step loop">' + g + '</svg><div class="readout mono" data-readout><span class="dim">hover a node</span></div></div>';
    }).join('');
    const show = e => {
      const g = e.target.closest && e.target.closest('.node'); if (!g) return;
      g.closest('.loop').querySelector('[data-readout]').innerHTML =
        '<a href="/?n=' + g.dataset.n + '">' + fmt(+g.dataset.n) + '</a> scores <a href="/?n=' + g.dataset.next + '">' + fmt(+g.dataset.next) + '</a>';
    };
    $('loops').addEventListener('pointerover', show);
    $('loops').addEventListener('focusin', show);

    // --- chains ------------------------------------------------------------
    const chips = (el, nodes, terminal, loopFrom, loopHue) => {
      if (loopHue) el.style.setProperty('--loop-hue', loopHue);
      el.innerHTML = nodes.map((n, i) => {
        const inLoop = loopFrom != null && i >= loopFrom;
        return (i ? '<span class="arrow">→</span>' : '') +
          '<a class="chain-chip mono' + (terminal && i === nodes.length - 1 ? ' terminal' : '') +
          (inLoop ? ' in-loop' : '') + '" href="/?n=' + n + '">' + fmt(n) + '</a>';
      }).join('');
    };

    // --- trace any number ---------------------------------------------------
    // The successor of every number is resident here, so a trace is a plain walk:
    // follow the arrows until the chain ends or revisits something it has seen.
    const nextOf = new Int32Array(D.nextOf);
    let lastTraced = -1;                         // what the network view centres on
    const loopOf = new Map();                    // loop member -> its cycle
    D.cycles.forEach(cy => cy.members.forEach(mm => loopOf.set(mm, cy)));
    const form = $('trace-form'), input = $('trace-n'), msg = $('trace-msg'), out = $('trace-out');

    function trace(raw, pushUrl) {
      const n = Number(String(raw).replace(/[\s,]/g, ''));
      if (!Number.isInteger(n) || n < 0 || n > 1000000) {
        msg.textContent = 'Enter a whole number from 0 to 1,000,000.';
        out.hidden = true;
        return;
      }
      const path = [], seen = new Set();
      let cur = n;
      while (cur >= 0 && !seen.has(cur)) { seen.add(cur); path.push(cur); cur = nextOf[cur]; }

      const endsAtSink = cur < 0;
      const last = path[path.length - 1];
      const loop = endsAtSink ? null : loopOf.get(cur);
      const loopFrom = loop ? path.indexOf(cur) : null;
      const steps = loop ? loopFrom : path.length - 1;   // steps taken before it settles
      let v;
      if (endsAtSink && path.length === 1) {
        v = '<strong>' + fmt(n) + '</strong> scores <strong>' + fmt(D.sinkEP[last]) + '</strong>, which is past the top of the range - ' +
            'so it is one of the ' + fmt(c.sinks) + ' numbers whose chain ends immediately.';
      } else if (endsAtSink) {
        v = '<strong>' + fmt(n) + '</strong> runs for <strong>' + steps + ' step' + (steps === 1 ? '' : 's') +
            '</strong> and ends at <strong>' + fmt(last) + '</strong>, which scores ' + fmt(D.sinkEP[last]) + ' - ' +
            fmt(D.sinkEP[last] - 1000000) + ' past the top of the range, so there is nowhere left to go.';
      } else if (loop && loopFrom === 0) {
        v = '<strong>' + fmt(n) + '</strong> is itself part of the <strong>' + loop.length + '-step loop</strong>, ' +
            'so it returns to itself after ' + loop.length + ' steps and never escapes.';
      } else if (loop) {
        v = '<strong>' + fmt(n) + '</strong> runs for <strong>' + steps + ' step' + (steps === 1 ? '' : 's') +
            '</strong>, then joins the <strong>' + loop.length + '-step loop</strong> at ' + fmt(cur) +
            ' and repeats forever - ' + fmt(path.length) + ' distinct numbers in all.';
      } else {
        v = '<strong>' + fmt(n) + '</strong> returns to a number it has already visited after ' + steps + ' steps.';
      }
      const vEl = $('trace-verdict');
      vEl.innerHTML = v;
      vEl.className = 'verdict' + (endsAtSink ? ' is-sink' : '');
      chips($('trace-chain'), path, endsAtSink, loopFrom, loop ? HUES[loop.slot % HUES.length] : null);
      msg.textContent = endsAtSink
        ? 'Highlighted: the number the chain stops at.'
        : 'Highlighted: the ' + loop.length + ' numbers that belong to the loop.';
      out.hidden = false;
      input.value = String(n);
      lastTraced = n;
      // Keep the network view centred on whatever is being traced, unless the trace
      // came from clicking a node there (loadNet already ran for that one).
      if (mode === 'network' && (!net || net.focus !== n)) loadNet(n);
      if (pushUrl) history.replaceState(null, '', '/chains?n=' + n);
    }

    form.addEventListener('submit', e => { e.preventDefault(); trace(input.value, true); });
    $('trace-random').addEventListener('click', () => trace(Math.floor(Math.random() * 1000001), true));
    // Seed with the deepest number so the section shows what it does; only a real
    // trace rewrites the URL, so arriving at /chains doesn't silently gain a query.
    const q = new URLSearchParams(location.search).get('n');
    trace(q == null || q === '' ? D.deepestChain.start : q, q != null && q !== '');
    const deep = D.deepestChain;
    $('deep-title').textContent = fmt(deep.start) + ' takes ' + deep.depth + ' steps to reach a loop';
    chips($('deep-chain'), deep.nodes, false);
    const joined = deep.nodes[deep.nodes.length - 1];
    const joinedLoop = D.cycles.find(x => x.members.indexOf(joined) >= 0);
    $('deep-note').textContent = 'After ' + deep.depth + ' steps it arrives at ' + fmt(joined) +
      ', already a member of the ' + (joinedLoop ? joinedLoop.length : '?') + '-step loop - from there it repeats forever, ' +
      (joinedLoop ? deep.depth + ' + ' + joinedLoop.length + ' = ' + (deep.depth + joinedLoop.length) + ' distinct numbers in all.' : '');

    const esc = D.escapeChain;
    $('esc-title').textContent = fmt(esc.start) + ' is the longest chain that actually ends';
    chips($('esc-chain'), esc.nodes, true);
    const sinkNode = esc.nodes[esc.nodes.length - 1];
    const sinkRow = D.topSinks.filter(s => s.sink === sinkNode)[0];
    $('esc-note').innerHTML = '<span class="mono">' + fmt(sinkNode) + '</span> scores <span class="mono">' + fmt(esc.ep) +
      '</span> - ' + fmt(esc.ep - 1000000) + ' past the top of the range, so there is nowhere left to go.' +
      (sinkRow ? ' ' + fmt(sinkRow.basin) + ' numbers finish here, more than at any other sink.' : '');

    // --- depth profile -----------------------------------------------------
    const keys = Object.keys(D.hist).map(Number).sort((a, b) => a - b);
    const max = Math.max.apply(null, keys.map(k => D.hist[k]));
    const W = 1000, H = 220, PAD = 26, bw = (W - PAD * 2) / keys.length;
    let s = '';
    for (const k of keys) {
      const h = D.hist[k] / max * (H - PAD * 2);
      s += '<rect class="bar" x="' + (PAD + k * bw).toFixed(2) + '" y="' + (H - PAD - h).toFixed(2) + '" width="' +
        Math.max(0.8, bw - 0.6).toFixed(2) + '" height="' + h.toFixed(2) + '"><title>depth ' + k + ' - ' + fmt(D.hist[k]) + ' numbers</title></rect>';
    }
    for (const k of [0, 20, 40, 60, 80, 100]) if (k <= c.maxDepth)
      s += '<text x="' + (PAD + k * bw).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + k + '</text>';
    s += '<text x="' + PAD + '" y="14">' + fmt(max) + ' numbers at the peak</text>';
    $('profile').innerHTML = s;

    // --- sinks -------------------------------------------------------------
    $('sinks').innerHTML = D.topSinks.map(x =>
      '<tr><td><a class="mono" href="/?n=' + x.sink + '">' + fmt(x.sink) + '</a></td><td class="mono">' + fmt(x.ep) +
      '</td><td class="mono">+' + fmt(x.ep - 1000000) + '</td><td class="mono">' + fmt(x.basin) + '</td></tr>').join('');
    $('sink-lede').textContent = 'The ' + fmt(c.sinks) + ' numbers whose EP lands outside the range, ranked by how many numbers eventually drain through them. ' +
      fmt(c.inSinks) + ' numbers end at one - just ' + (c.inSinks / c.nodes * 100).toFixed(1) + '% of the range.';
  }
}

function renderChains() {
  // The chains page keeps its editorial rhythm (full-width sections, big hero, figure
  // grid) but is skinned entirely from the shared tokens: --ink/--rule/--panel are now
  // aliases so the long tail of rules below didn't have to be rewritten by hand.
  const css = `
  :root{
    --ink:var(--text); --ink-dim:var(--dim); --rule:var(--border); --panel:var(--surface); --ground:var(--bg);
    --c0:#FF5A5C; --c1:#FFB040; --c2:#6EE18C; --c3:#78AAFF; --c4:#E17DFF; --sink:#7891AF;
  }
  body{font-size:16px;line-height:1.6}
  .wrap{padding:0 24px}
  section{padding-block:clamp(36px,5.5vw,64px);border-top:1px solid var(--rule)}
  section:first-of-type{border-top:0}
  h1{font-size:clamp(2.1rem,6vw,3.6rem);line-height:1.02;letter-spacing:-.035em;font-weight:680;margin:0;text-wrap:balance}
  h2{font-size:clamp(1.15rem,2.4vw,1.5rem);letter-spacing:-.02em;font-weight:640;margin:0 0 6px;text-wrap:balance}
  p{margin:0;max-width:66ch;color:var(--ink-dim)}
  .lede{font-size:1.06rem;margin-top:18px}
  .note{font-size:.9rem;color:var(--muted);margin-top:14px}
  .head{display:flex;flex-direction:column;gap:4px;margin-bottom:26px}
  .hero{padding-top:clamp(20px,3vw,40px)}
  .plate{margin:30px 0 0;background:#08090C;border:1px solid var(--rule);border-radius:var(--r-card);overflow:hidden}
  #plate-wrap{position:relative;line-height:0}
  .plate canvas{display:block;width:100%;aspect-ratio:1;height:auto;cursor:grab;touch-action:none}
  .plate canvas:active{cursor:grabbing}
  .plate canvas:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  #plate-hud{position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:8px;
    line-height:1.4;font-size:.75rem;color:#8A93A6;pointer-events:none}
  #plate-hud button{pointer-events:auto;padding:4px 10px;font:inherit;font-size:.75rem;color:var(--dim);
    background:rgba(12,14,22,.82);border:1px solid rgba(255,255,255,.16);border-radius:var(--r-sm)}
  #plate-hud button:hover{border-color:var(--accent);color:var(--accent);background:rgba(12,14,22,.82)}
  #net-depth-wrap,#net-count{display:none}
  body.net-mode #net-depth-wrap,body.net-mode #net-count{display:inline-flex;align-items:center}
  #net-depth{pointer-events:auto;padding:4px 6px;font:inherit;font-size:.75rem;color:var(--dim);
    background:rgba(12,14,22,.9);border:1px solid rgba(255,255,255,.16);border-radius:var(--r-sm)}
  #net-depth:focus{box-shadow:none}
  #net-depth:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  #net-count{color:#8A93A6}
  #plate-modes{display:inline-flex;pointer-events:auto}
  #plate-modes button{border-radius:0;margin-left:-1px}
  #plate-modes button:first-child{border-radius:var(--r-sm) 0 0 var(--r-sm);margin-left:0}
  #plate-modes button:last-child{border-radius:0 var(--r-sm) var(--r-sm) 0}
  #plate-modes button.on{color:var(--on-accent);background:var(--accent);border-color:var(--accent)}
  #plate-hud button:focus-visible,#plate-modes button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  #plate-readout{position:absolute;left:12px;bottom:10px;font-size:.78rem;color:#C7CEDA;
    line-height:1.4;pointer-events:none;text-shadow:0 1px 3px #000}
  #plate-readout strong{color:#fff}
  #plate-wrap.busy::after{content:"";position:absolute;top:10px;left:12px;width:7px;height:7px;
    border-radius:50%;background:var(--accent);opacity:.85;animation:plate-pulse 1s ease-in-out infinite}
  @keyframes plate-pulse{0%,100%{opacity:.2}50%{opacity:.9}}
  .plate figcaption{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;padding:14px 18px;
    border-top:1px solid rgba(255,255,255,.09);font-size:.8rem;color:#8A93A6;background:#0B0D12}
  .key{display:flex;align-items:center;gap:7px;white-space:nowrap}
  .swatch{width:9px;height:9px;border-radius:50%;flex:none}
  #loading{margin-top:30px;padding:26px;border:1px solid var(--rule);border-radius:var(--r-card);background:var(--panel)}
  #track{margin-top:14px}
  body:not(.ready) .needs-data{display:none}
  .figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem;margin:0}
  .figures .stat{background:var(--panel);padding:16px 18px}
  .loops{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:18px}
  .loop{background:var(--panel);border:1px solid var(--rule);border-radius:var(--r-card);padding:16px}
  .loop h3{margin:0;font-size:.95rem;font-weight:620;display:flex;align-items:center;gap:8px}
  .loop .meta{font-size:.8rem;color:var(--muted);margin:3px 0 10px}
  .loop svg{display:block;width:100%;height:auto;overflow:visible}
  .node{cursor:pointer}
  .node circle{transition:r .12s ease}
  .node:hover circle,.node:focus-visible circle{r:6}
  .node:focus-visible{outline:none}
  .node:focus-visible circle{stroke:var(--ink);stroke-width:1.5}
  .readout{min-height:1.5em;margin-top:10px;font-size:.84rem;border-top:1px dashed var(--rule);padding-top:9px}
  .readout .dim{color:var(--muted)}
  #trace-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  #trace-n{flex:1 1 200px;max-width:280px;font-size:1rem}
  .verdict{margin-top:18px;padding:14px 16px;border-left:2px solid var(--accent);border-radius:0 var(--r-ctl) var(--r-ctl) 0;
    background:var(--panel);font-size:.95rem}
  .verdict strong{color:var(--ink)}
  .verdict.is-sink{border-left-color:var(--sink)}
  .chain{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:16px}
  .chain-chip{display:inline-block;padding:3px 9px;border:1px solid var(--rule);border-radius:var(--r-sm);
    background:var(--panel);font-size:.84rem;color:var(--ink);text-decoration:none}
  .chain-chip:hover{border-color:var(--accent);color:var(--accent)}
  .chain-chip.terminal{border-color:var(--sink);color:var(--sink);font-weight:600}
  /* --loop-hue is set per trace, so the highlight matches the loop it lands in */
  .chain-chip.in-loop{border-color:var(--loop-hue,var(--c0));color:var(--loop-hue,var(--c0))}
  .arrow{color:var(--muted);font-size:.8rem}
  .escape{margin-top:16px;padding:13px 16px;border-left:2px solid var(--sink);border-radius:0 var(--r-ctl) var(--r-ctl) 0;
    background:var(--panel);font-size:.9rem}
  .profile{width:100%;height:auto;display:block;margin-top:8px;overflow:visible}
  .profile .bar{fill:var(--accent);opacity:.75}
  .profile .bar:hover{opacity:1}
  .profile text{fill:var(--muted);font-size:10px}
  .scroll{overflow-x:auto;margin-top:8px}
  table{border-collapse:collapse;width:100%;min-width:460px;font-size:.88rem}
  th,td{text-align:right;padding:9px 12px;border-bottom:1px solid var(--rule);white-space:nowrap}
  th:first-child,td:first-child{text-align:left}
  th{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
  tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
  footer{margin-top:0;padding:34px 0 56px;border-top:1px solid var(--rule)}
  footer p{color:var(--muted);font-size:.84rem}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

  const body = `<div class="wrap">
  <section class="hero">
    <p class="eyebrow">RNGdle &middot; every number 0&ndash;1,000,000</p>
    <h1>Each number points at its own score.</h1>
    <p class="lede">Take any number, work out the EP it earns, and treat that score as the next number.
      Almost every number can do this, so the whole range becomes one graph with a single arrow leaving
      every node. This is all of them - scored in your browser from the live badge rules, not from a
      stored snapshot.</p>
    <div id="loading">
      <p id="status" class="mono">Starting…</p>
      <div id="track" class="progress"><i id="bar"></i></div>
    </div>
    <figure class="plate needs-data">
      <div id="plate-wrap">
        <canvas id="plate" width="1500" height="1500" aria-label="Radial diagram of all 1,000,001 numbers, each joined to the number its EP points at. Drag to pan, scroll to zoom, click a node to trace it."></canvas>
        <div id="plate-hud">
          <span id="plate-zoom" class="mono"></span>
          <button type="button" id="plate-reset" hidden>Reset</button>
          <label id="net-depth-wrap"><span class="sr-only">Neighbourhood size</span>
            <select id="net-depth">
              <option value="2:220">2 hops</option>
              <option value="3:600">3 hops</option>
              <option value="4:2000">4 hops</option>
              <option value="6:8000">6 hops</option>
              <option value="10:40000">10 hops</option>
              <option value="999999:40000">Whole basin &middot; 40k</option>
              <option value="999999:150000">Whole basin &middot; 150k (dense)</option>
            </select>
          </label>
          <span id="net-count" class="mono"></span>
          <span id="plate-modes" role="group" aria-label="Graph view">
            <button type="button" data-mode="radial" class="on">Radial</button>
            <button type="button" data-mode="network">Network</button>
          </span>
        </div>
        <div id="plate-readout" class="mono" aria-live="polite"></div>
      </div>
      <figcaption>
        <span class="key"><span class="swatch" style="background:#FF5A5C"></span>largest loop basin</span>
        <span class="key"><span class="swatch" style="background:#FFB040"></span>2nd</span>
        <span class="key"><span class="swatch" style="background:#6EE18C"></span>3rd</span>
        <span class="key"><span class="swatch" style="background:#78AAFF"></span>4th</span>
        <span class="key"><span class="swatch" style="background:#E17DFF"></span>5th</span>
        <span class="key"><span class="swatch" style="background:#7891AF"></span>ends at a sink</span>
        <span style="margin-left:auto">drag to pan &middot; scroll to zoom &middot; click a node to trace it</span>
      </figcaption>
    </figure>
  </section>

  <section class="needs-data">
    <div class="figures" id="figures"></div>
    <p class="note">A number is a <strong>sink</strong> when its EP exceeds 1,000,000 and the chain simply stops.
      Mean EP sits around 21,500, comfortably inside the range, so the map points overwhelmingly inward.</p>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Trace</p><h2>Follow any number</h2>
      <p>Enter a number and watch it score its way along until it either joins a loop or
        runs off the end of the range.</p></div>
    <form id="trace-form" autocomplete="off">
      <label class="sr-only" for="trace-n">Number to trace</label>
      <input id="trace-n" class="mono" type="text" inputmode="numeric" placeholder="e.g. 70076" aria-describedby="trace-msg">
      <button type="submit" class="btn-primary">Trace</button>
      <button type="button" id="trace-random" class="btn-ghost">Random</button>
    </form>
    <p class="note" id="trace-msg"></p>
    <div id="trace-out" hidden>
      <div class="verdict" id="trace-verdict"></div>
      <div class="chain" id="trace-chain"></div>
    </div>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Attractors</p><h2>The loops</h2><p id="loop-lede"></p></div>
    <div class="loops" id="loops"></div>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Longest run</p><h2 id="deep-title"></h2>
      <p>The deepest number in the graph: the most steps any number takes before it stops making progress.</p></div>
    <div class="chain" id="deep-chain"></div>
    <p class="note" id="deep-note"></p>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Longest escape</p><h2 id="esc-title"></h2>
      <p>Chains that terminate are the rare case. This is the longest of them - each number scoring the
        next, until the final score overshoots the range.</p></div>
    <div class="chain" id="esc-chain"></div>
    <div class="escape" id="esc-note"></div>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Depth profile</p><h2>How far every number sits from its attractor</h2>
      <p>Distance in steps to the loop or sink a number drains into.</p></div>
    <svg class="profile" id="profile" viewBox="0 0 1000 220" role="img" aria-label="Histogram of how many numbers sit at each depth."></svg>
  </section>

  <section class="needs-data">
    <div class="head"><p class="eyebrow">Sinks</p><h2>Where the terminating chains stop</h2><p id="sink-lede"></p></div>
    <div class="scroll"><table>
      <thead><tr><th>Sink</th><th>Its EP</th><th>Overshoot</th><th>Numbers draining through it</th></tr></thead>
      <tbody id="sinks"></tbody>
    </table></div>
  </section>

  <footer><p>Every number scored with the same engine as <a href="/">the calculator</a>; edges are
    <span class="mono">n &rarr; EP(n)</span>, kept only where the score is itself a legal input. Loops are
    found by walking each number until it meets a settled node or itself. Any number here opens in the
    calculator. See also <a href="/grid">the grid</a> and <a href="/badges">every badge</a>.</p></footer>
</div>`;

  const script = `
// __name shim, page scope: when this Worker is bundled (esbuild keepNames), the source
// returned by toString() carries __name(fn,"fn") calls for any nested function
// declaration - and chainsClient has several. That helper only exists in the bundled
// module scope, so without this the page dies on "__name is not defined". The worker
// source below and engineModuleSource() each carry their own copy for the same reason.
var __name = (f) => f;
const __CHAINS_WORKER_SRC = ${JSON.stringify('var __name=(f)=>f;(' + chainsWorker.toString() + ')()')};
(${chainsClient.toString()})(__CHAINS_WORKER_SRC);`;

  return pageShell({ title: 'RNGdle - The EP Graph', nav: 'chains', width: '1080px', css, body, script });
}

// ---------------------------------------------------------------------------
// /badges - browsable index of every badge: obtainment method, EP, rarity tier,
// share of numbers that earn it, family/supersession relations, and example
// numbers (clickable into the calculator) + a link to its /grid highlight view.
// All 230 cards are server-rendered; a small inline script does search / rarity
// filtering / sorting on the DOM.
// ---------------------------------------------------------------------------

// The badge index is fully static per deploy (every input is a generated file or
// the badge table), but it's also the biggest page (~260KB / 230 cards), so render
// it once per isolate instead of per request.
let badgeIndexHTML = null;

function renderBadgeIndex() {
  if (badgeIndexHTML) return badgeIndexHTML;
  const idToFam = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) idToFam.set(id, fi); });
  const byId = new Map(BADGES.map(b => [b[0], b]));

  const tierCounts = { mythic: 0, anomaly: 0, epic: 0, rare: 0, uncommon: 0, common: 0 };
  const newBadges = [];
  const cards = BADGES.map(([id, label, emoji, ep]) => {
    const tier = tierFromScore(ep);
    tierCounts[tier]++;
    const pal = TIER_PALETTE[tier];
    const desc = DESCRIPTIONS[id] || 'No description.';
    const prob = PROBABILITIES[id];
    const isNew = BADGE_ADDED[id] === LATEST_BADGE_BATCH;
    if (isNew) newBadges.push([id, label, emoji]);
    const ex = (EXAMPLES[id] || []).map(n => `<a href="/?n=${n}">${n.toLocaleString()}</a>`).join(' · ');

    // Family relations: within a family only the highest-EP earned badge scores,
    // so show who outranks whom (ties happen - the POWER top three share one EP).
    let famHTML = '';
    const fi = idToFam.get(id);
    if (fi !== undefined) {
      const others = FAMILIES[fi].filter(x => x !== id);
      const list = arr => arr.map(x => `<a href="#${x}">${byId.get(x)[2]} ${esc(byId.get(x)[1])}</a>`).join(', ');
      const above = others.filter(x => byId.get(x)[3] > ep);
      const ties = others.filter(x => byId.get(x)[3] === ep);
      const below = others.filter(x => byId.get(x)[3] < ep);
      const parts = [];
      if (above.length) parts.push(`outranked by ${list(above)}`);
      if (ties.length) parts.push(`ties with ${list(ties)}`);
      if (below.length) parts.push(`outranks ${list(below)}`);
      famHTML = `<div class="bd-fam"><b>${esc(FAMILY_NAMES[fi])} family</b> · ${parts.join('; ')}</div>`;
    }

    const search = `${label} ${id} ${desc} ${tier}${isNew ? ' new newly added' : ''}`.toLowerCase();
    return `<article class="bd${isNew ? ' is-new' : ''}" id="${id}" data-search="${esc(search)}" data-ep="${ep}" data-prob="${prob ?? -1}" data-tier="${tier}" data-new="${isNew ? '1' : '0'}" style="--tc:${pal.accent}">
  <header><span class="bd-emoji">${emoji}</span><h2>${esc(label)}</h2>${isNew ? '<span class="bd-new">New</span>' : ''}<span class="pill">${pal.label}</span></header>
  <p class="bd-desc">${esc(desc)}</p>
  <div class="bd-stats"><span class="bd-ep">+${ep.toLocaleString()} EP</span><span class="bd-prob" title="Exact share of all inputs 0-1,000,000 that earn this badge">${fmtProb(prob)} of numbers</span></div>
  ${famHTML}
  <div class="bd-ex">e.g. ${ex}<a class="bd-map" href="/grid#${encodeURIComponent(label)}" title="Highlight every number that earns this badge on the 1,000,000-number grid">map &rarr;</a></div>
</article>`;
  }).join('\n');

  const chip = (t, label, count) =>
    `<button type="button" class="chip${t ? '' : ' on'}" data-tier="${t}"${t ? ` style="--tc:${TIER_PALETTE[t].accent}"` : ''}>${label} <em>${count}</em></button>`;
  const chips = [
    chip('', 'All', BADGES.length),
    ...['mythic', 'anomaly', 'epic', 'rare', 'uncommon', 'common'].map(t => chip(t, TIER_PALETTE[t].label, tierCounts[t])),
  ].join('');

  // "Newly added" banner: the most recent batch, linking to each new badge's card.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const [by, bm, bd] = LATEST_BADGE_BATCH.split('-').map(Number);
  const batchDate = `${bd} ${MONTHS[bm - 1]} ${by}`;
  const newBox = newBadges.length ? `<section class="newbox">
    <div class="newbox-head"><span class="newbox-tag">✨ Newly added</span>
      <span class="newbox-date">${newBadges.length} new badge${newBadges.length === 1 ? '' : 's'} · ${batchDate}</span>
      <button type="button" id="only-new" class="newbox-btn">Show only new</button></div>
    <div class="newbox-list">${newBadges.map(([id, label, emoji]) =>
      `<a class="newbox-chip" href="#${id}">${emoji} ${esc(label)}</a>`).join('')}</div>
  </section>` : '';

  const css = `
  /* --- toolbar --- */
  .bar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; align-items:center; gap:.5rem;
    padding:.7rem 0 .6rem; margin-bottom:1rem; background:linear-gradient(var(--bg) 88%, transparent);
    border-bottom:1px solid var(--border); }
  #q { flex:1 1 200px; min-width:160px; }
  #sort { font-size:.85rem; padding:.45rem .55rem; border-color:var(--border-2); background:var(--surface-2); }
  #count { flex-basis:100%; color:var(--faint); font-size:.78rem; }

  /* --- cards --- */
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:.7rem; }
  .bd { border:1px solid var(--border); border-left:3px solid var(--tc); border-radius:var(--r-card);
    background:var(--surface); padding:.75rem .9rem .8rem; display:flex; flex-direction:column; gap:.4rem;
    scroll-margin-top:4rem;
    /* Only lay out / paint the cards in view: with 230 server-rendered cards this is
       most of the page's first-paint cost (and the flash on navigating here). The
       intrinsic size is a rough card height so the scrollbar stays stable. */
    content-visibility:auto; contain-intrinsic-size:auto 180px; }
  .bd:target { border-color:var(--tc); box-shadow:0 0 0 3px color-mix(in srgb, var(--tc) 25%, transparent); }
  .bd header { display:flex; align-items:center; gap:.5rem; }
  .bd-emoji { font-size:1.25rem; flex:0 0 auto; }
  .bd h2 { flex:1; font-size:1rem; font-weight:600; margin:0; letter-spacing:-.01em; min-width:0; }
  .bd-new { flex:0 0 auto; font-size:.62rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
    padding:.14rem .45rem; border-radius:var(--r-pill); color:var(--on-ok); background:var(--ok); border:1px solid var(--ok); }
  .bd.is-new { border-color:color-mix(in srgb, var(--ok) 45%, var(--border)); }
  .bd.is-new:target { box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent); }

  /* --- newly-added banner --- */
  .newbox { border:1px solid color-mix(in srgb, var(--ok) 40%, var(--border)); border-radius:var(--r-card);
    background:color-mix(in srgb, var(--ok) 7%, var(--surface)); padding:.85rem 1rem; margin-bottom:1.1rem; }
  .newbox-head { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem .7rem; margin-bottom:.6rem; }
  .newbox-tag { font-size:.9rem; font-weight:700; color:#7ee6ab; letter-spacing:.01em; }
  .newbox-date { font-size:.8rem; color:var(--muted); }
  .newbox-btn { margin-left:auto; font-size:.78rem; font-weight:600; padding:.32rem .7rem; border-radius:var(--r-pill);
    color:#7ee6ab; border-color:color-mix(in srgb, var(--ok) 45%, var(--border-2)); background:transparent; }
  .newbox-btn:hover { background:color-mix(in srgb, var(--ok) 16%, transparent); color:var(--text);
    border-color:color-mix(in srgb, var(--ok) 45%, var(--border-2)); }
  .newbox-btn.on { background:var(--ok); color:var(--on-ok); border-color:var(--ok); }
  .newbox-list { display:flex; flex-wrap:wrap; gap:.4rem; }
  .newbox-chip { font-size:.8rem; text-decoration:none; padding:.28rem .6rem; border-radius:var(--r-ctl);
    color:var(--text); background:var(--surface-2); border:1px solid var(--border-2); white-space:nowrap; }
  .newbox-chip:hover { border-color:var(--ok); }
  .bd-desc { margin:0; font-size:.86rem; color:var(--dim); }
  .bd-stats { display:flex; align-items:baseline; gap:.8rem; font-size:.82rem; }
  .bd-ep { font-family:var(--mono); font-weight:600; font-variant-numeric:tabular-nums; }
  .bd-prob { color:var(--muted); }
  .bd-fam { font-size:.76rem; color:var(--muted); line-height:1.6; }
  .bd-fam b { color:var(--dim); font-weight:600; }
  .bd-fam a { color:var(--muted); text-decoration:none; border-bottom:1px dotted var(--faint); }
  .bd-fam a:hover { color:var(--text); }
  .bd-ex { margin-top:auto; padding-top:.15rem; display:flex; align-items:baseline; gap:.45rem; flex-wrap:wrap;
    font-size:.78rem; color:var(--faint); font-variant-numeric:tabular-nums; }
  .bd-ex a { text-decoration:none; }
  .bd-ex a:hover { text-decoration:underline; }
  .bd-map { margin-left:auto; white-space:nowrap; }
  footer { max-width:760px; }`;

  const body = `<div class="wrap">
  <h1>Badge Index</h1>
  ${newBox}
  <div class="bar">
    <input id="q" type="search" placeholder="Search ${BADGES.length} badges (name, rule, rarity)…" autocomplete="off">
    ${chips}
    <select id="sort" title="Sort badges" aria-label="Sort badges">
      <option value="ep-desc">Sort: Highest EP</option>
      <option value="ep-asc">Sort: Lowest EP</option>
      <option value="prob-asc">Sort: Rarest first</option>
      <option value="prob-desc">Sort: Most common first</option>
      <option value="name">Sort: A&ndash;Z</option>
    </select>
    <div id="count"></div>
  </div>
  <div id="cards">
${cards}
  </div>
  <footer>
    <b>Rarity</b> is derived from a badge's EP score exactly like rngdle.com:
    Common &lt; 1,000 &le; Uncommon &lt; 10,000 &le; Rare &lt; 100,000 &le; Epic &lt; 1,000,000 &le; Anomaly &lt; 10,000,000 &le; Mythic.
    <b>Families:</b> when a number earns several badges from one family, only the highest-EP one scores -
    the rest are displayed but add 0 EP. <b>&ldquo;% of numbers&rdquo;</b> is the exact share of all
    1,000,001 inputs (0&ndash;1,000,000) that earn the badge.
  </footer>
</div>`;

  const script = `
(function () {
  var grid = document.getElementById('cards');
  var cards = [].slice.call(grid.children);
  var q = document.getElementById('q');
  var sortEl = document.getElementById('sort');
  var countEl = document.getElementById('count');
  var chips = [].slice.call(document.querySelectorAll('.chip'));
  var onlyNewBtn = document.getElementById('only-new');
  var tier = '';
  var onlyNew = false;

  function cmp(a, b) {
    switch (sortEl.value) {
      case 'ep-asc': return a.dataset.ep - b.dataset.ep;
      case 'prob-asc': return a.dataset.prob - b.dataset.prob;
      case 'prob-desc': return b.dataset.prob - a.dataset.prob;
      case 'name': return a.querySelector('h2').textContent.localeCompare(b.querySelector('h2').textContent);
      default: return b.dataset.ep - a.dataset.ep;
    }
  }
  function apply() {
    var f = q.value.trim().toLowerCase();
    cards.slice().sort(cmp).forEach(function (c) { grid.appendChild(c); });
    var shown = 0;
    cards.forEach(function (c) {
      var ok = (!tier || c.dataset.tier === tier) && (!f || c.dataset.search.indexOf(f) !== -1)
        && (!onlyNew || c.dataset.new === '1');
      c.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    countEl.textContent = shown === cards.length ? cards.length + ' badges' : shown + ' of ' + cards.length + ' badges';
  }
  q.addEventListener('input', apply);
  sortEl.addEventListener('change', apply);
  if (onlyNewBtn) onlyNewBtn.addEventListener('click', function () {
    onlyNew = !onlyNew;
    onlyNewBtn.classList.toggle('on', onlyNew);
    apply();
  });
  chips.forEach(function (ch) {
    ch.addEventListener('click', function () {
      tier = ch.dataset.tier;
      chips.forEach(function (c) { c.classList.toggle('on', c === ch); });
      apply();
    });
  });
  // Cross-family links (#BADGE_ID): if the target card is filtered out, clear the
  // filters so the jump actually lands somewhere visible.
  function reveal() {
    var id = location.hash.slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el || !el.classList.contains('bd')) return;
    if (el.style.display === 'none') {
      q.value = ''; tier = '';
      onlyNew = false;
      if (onlyNewBtn) onlyNewBtn.classList.remove('on');
      chips.forEach(function (c) { c.classList.toggle('on', !c.dataset.tier); });
      apply();
    }
    el.scrollIntoView({ block: 'center' });
  }
  window.addEventListener('hashchange', reveal);
  apply();
  reveal();
})();`;

  badgeIndexHTML = pageShell({
    title: 'RNGdle - Badge Index', nav: 'badges', width: '1100px', noindex: true, css, body, script,
  });
  return badgeIndexHTML;
}

// ---------------------------------------------------------------------------
// User profiles: pull a player's rolls from rngdle.com's public API and compute
// their collection summary ourselves. rngdle doesn't export this summary; its
// /api/users/<name>/rolls endpoint is offset-paginated ({rolls, hasMore}). Our
// compute() reproduces the stored per-roll score exactly (verified 0 mismatches
// over a real profile), so every stat below is derived locally at full fidelity.
// ---------------------------------------------------------------------------

// tier key -> [display label, percentile blurb, square emoji], highest first.
const PROFILE_TIERS = [
  ['mythic', 'Mythic', 'Top 1%', '🟥'], ['anomaly', 'Anomaly', 'Top 5%', '🟧'],
  ['epic', 'Epic', 'Top 10%', '🟪'], ['rare', 'Rare', 'Top 25%', '🟦'],
  ['uncommon', 'Uncommon', 'Top 50%', '🟩'], ['common', 'Common', 'Bottom 50%', '⬜'],
  ['trash', 'Trash', 'Bottom 1%', '🟫'],
];
const VALID_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;
// How many players a single combined view may merge. Each player costs one subrequest
// per 100 rolls, and a Worker invocation is capped at 50 subrequests, so this leaves
// room for ~500 rolls each before we'd hit the ceiling.
const MAX_COMBINE = 10;

/**
 * Split a free-form list of usernames ("a\nb, c", one per line from the textarea)
 * into unique valid names, in the order given. Usernames are [A-Za-z0-9_-], so every
 * other character is a separator - which also means a pasted "@name" loses its @.
 */
function parseUsernames(str) {
  const out = [], seen = new Set();
  for (const name of String(str || '').split(/[^A-Za-z0-9_-]+/)) {
    if (!name || !VALID_USERNAME.test(name)) continue;
    const key = name.toLowerCase(); // don't count the same player twice
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function fetchUserRolls(username) {
  const rolls = [];
  for (let offset = 0; offset < 20000; offset += 100) { // hard safety cap
    const api = `https://www.rngdle.com/api/users/${encodeURIComponent(username)}/rolls?limit=100&offset=${offset}`;
    const res = await fetch(api, { headers: { 'user-agent': 'rngdle-ep-calculator (github.com/CubityFirst/rngdle-ep-calculator)' } });
    if (!res.ok) { if (offset === 0) { const e = new Error('not_found'); e.status = res.status; throw e; } break; }
    const data = await res.json();
    const page = data.rolls || [];
    rolls.push(...page);
    if (!data.hasMore || page.length === 0) break;
  }
  return rolls;
}

// Derive the collection summary from a rolls list using our own scorer.
function profileSummary(rolls) {
  const tierCounts = { mythic: 0, anomaly: 0, epic: 0, rare: 0, uncommon: 0, common: 0, trash: 0 };
  const badgeSet = new Set();
  let totalEP = 0, best = null;
  const scored = rolls.map(roll => {
    const ep = roll.totalScore ?? 0;
    const tier = cardTier(ep);
    tierCounts[tier]++;
    totalEP += ep;
    if (!best || ep > best.ep) best = { number: roll.number, ep, at: roll.rolledAt, owner: roll.owner };
    // Distinct badges ever earned (compute keeps superseded badges in the list too).
    for (const b of compute(roll.number).badges) badgeSet.add(b.id);
    return { number: roll.number, ep, tier, badgeCount: roll.badgeCount, at: roll.rolledAt, owner: roll.owner };
  });
  // Max streak: longest run of consecutive UTC days with at least one roll.
  const days = [...new Set(rolls.map(r => (r.rolledAt || '').slice(0, 10)).filter(Boolean))].sort();
  let maxStreak = 0, streak = 0, prevDay = null;
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00Z');
    streak = prevDay !== null && t - prevDay === 86400000 ? streak + 1 : 1;
    prevDay = t;
    if (streak > maxStreak) maxStreak = streak;
  }
  return { totalRolls: rolls.length, tierCounts, distinctBadges: badgeSet.size, totalEP, best, maxStreak, scored };
}

/**
 * Fetch several players at once. One bad name shouldn't sink the whole combined view,
 * so a failed player comes back as { username, error: <status> } and the caller decides
 * whether enough of them loaded to render something.
 */
async function fetchProfiles(names) {
  return Promise.all(names.map(async username => {
    try { return { username, rolls: await fetchUserRolls(username) }; } catch (e) { return { username, error: e.status || 502 }; }
  }));
}

/**
 * Merge several players into one summary, as if their rolls were a single collection.
 *
 * Every stat falls out of running profileSummary() over the concatenated rolls, which
 * gives the right thing for each kind: counts and EP add up, badges become the union
 * (the group's shared collection), best roll is the group's best, and the streak
 * becomes the longest run of days on which *someone* rolled. Each roll is tagged with
 * its owner so the rolls table can attribute it. `members` keeps the per-player
 * summaries for the breakdown table.
 */
function combinedSummary(loaded) {
  const all = [];
  for (const m of loaded) for (const r of m.rolls) all.push({ ...r, owner: m.username });
  const sum = profileSummary(all);
  // Per-player scored lists would just duplicate sum.scored (which carries `owner`), so
  // drop them - they'd double the JSON on /api/profile for nothing.
  sum.members = loaded.map(m => {
    const { scored, ...rest } = profileSummary(m.rolls);
    return { username: m.username, ...rest };
  });
  return sum;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
}
// ISO-style YYYY-MM-DD for the copy-text summary (e.g. "2026-07-04").
function fmtDateNumeric(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
// Expected share of rolls landing in each card tier, from the percentile thresholds
// (trash<1, common<50, uncommon<75, rare<90, epic<95, anomaly<99, else mythic).
const TIER_EXPECTED_RATE = { mythic: .01, anomaly: .04, epic: .05, rare: .15, uncommon: .25, common: .49, trash: .01 };
// Structured data for the "Copy text" button. The text itself is assembled client-side
// so localStorage settings (gear popover) can change what appears without a reload.
function profileCopyData(sum) {
  const share = n => sum.totalRolls ? `${(n / sum.totalRolls * 100).toFixed(1)}%` : '0%';
  const b = sum.best;
  const combined = !!sum.members;
  const bestWho = b && b.owner ? ` by @${b.owner}` : '';
  const stats = [
    ['totalRolls', `🧮 ${sum.totalRolls.toLocaleString()} Total Rolls`],
    ['streak', `🔥 ${sum.maxStreak.toLocaleString()} Day ${combined ? 'Combined' : 'Max'} Streak`],
    ['badges', `🏅 ${sum.distinctBadges} Badges`],
    ['ep', `📈 ${sum.totalEP.toLocaleString()} (Total) EP`],
    ['bestRoll', `🎲 Best Roll: ${b ? `${b.number} (${b.ep.toLocaleString()} EP)${bestWho} on ${fmtDateNumeric(b.at)}` : '-'}`],
  ];
  // Combined views name the players they merged; the checkbox for this line is only
  // rendered there, so on a single profile the setting has nothing to switch on.
  if (combined) {
    stats.unshift(['players', `👥 ${sum.members.length} Player${sum.members.length === 1 ? '' : 's'}: ` +
      sum.members.map(m => '@' + m.username).join(', ')]);
  }
  return {
    tiers: PROFILE_TIERS.map(([key, label, pct, emoji]) => ({
      emoji, label, pct, n: sum.tierCounts[key], share: share(sum.tierCounts[key]),
      exp: sum.totalRolls * TIER_EXPECTED_RATE[key],
    })),
    stats,
  };
}

// Page-specific CSS for /u and /u/<name>; everything else comes from src/ui.js.
const PROFILE_CSS = `
  h1 { font-size:1.5rem; margin:0 0 .2rem; }
  h1 .at { color:var(--faint); font-weight:400; }
  .phead { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
  .copy-btn { font-size:.85rem; font-weight:600; white-space:nowrap; padding:.5rem .85rem; }
  .copy-btn:hover { border-color:var(--accent); background:var(--surface-2); }
  .copy-btn.ok { color:var(--on-ok); background:var(--ok); border-color:var(--ok); }
  .pbtns { position:relative; display:flex; gap:.4rem; flex:0 0 auto; align-items:flex-start; }
  .cfg-btn { padding:.5rem .6rem; }
  .cfg-modal { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; padding:1rem; }
  .cfg-modal[hidden] { display:none; }
  .cfg-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.62); }
  .cfg-dialog { position:relative; width:min(880px,100%); max-height:88vh; overflow:auto; background:var(--surface);
    border:1px solid var(--border-2); border-radius:var(--r-hero); padding:1rem 1.15rem 1.15rem; box-shadow:0 18px 48px rgba(0,0,0,.6); }
  .cfg-head { display:flex; align-items:center; justify-content:space-between; margin:0 0 .8rem; }
  .cfg-head h3 { font-size:.72rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0; }
  .cfg-x { background:none; border:none; color:var(--muted); font-size:.95rem; padding:.2rem .35rem; border-radius:var(--r-sm); }
  .cfg-x:hover { color:var(--text); background:var(--surface-2); border:none; }
  .cfg-body { display:grid; grid-template-columns:1fr 1.25fr; gap:1.2rem; align-items:start; }
  @media (max-width:640px) { .cfg-body { grid-template-columns:1fr; } }
  .cfg-preview h4 { font-size:.68rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin:0 0 .45rem; }
  .cfg-preview pre { margin:0; font-family:var(--mono); font-size:.74rem; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere;
    background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-card); padding:.7rem .8rem; }
  .cfg-foot { display:flex; justify-content:space-between; align-items:center; gap:.6rem; margin-top:1.1rem; }
  .cfg-reset { color:var(--muted); font-weight:500; }
  .cfg-reset:hover { color:var(--text); }
  .cfg-row { display:flex; gap:.55rem; align-items:flex-start; font-size:.85rem; cursor:pointer; }
  .cfg-row input { margin:.2rem 0 0; flex:0 0 auto; }
  .cfg-row + .cfg-row { margin-top:.55rem; }
  .cfg-mini + .cfg-mini { margin-top:.3rem; }
  .cfg-mini input { margin-top:.15rem; }
  .cfg-sub { font-size:.66rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin:.95rem 0 .5rem; }
  .cfg-sub:first-child { margin-top:0; }
  .cfg-row small { display:block; color:var(--muted); font-size:.74rem; line-height:1.35; margin-top:.1rem; }
  p.tag { margin:.1rem 0 1.5rem; }
  .uform { display:flex; gap:.5rem; max-width:420px; margin:1rem 0; }
  .uform input { flex:1; font-size:.95rem; }
  .mform { max-width:420px; margin:.6rem 0 0; }
  .mform textarea { display:block; width:100%; font-size:.95rem; font-family:var(--mono); line-height:1.6;
    min-height:6.5rem; resize:vertical; }
  .mform button { margin-top:.5rem; }
  .or { display:flex; align-items:center; gap:.7rem; max-width:420px; margin:1.4rem 0 .2rem;
    font-size:.7rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); }
  .or::before, .or::after { content:''; flex:1; height:1px; background:var(--border); }
  .edit-list { margin:0 0 1.3rem; }
  .edit-list summary { cursor:pointer; color:var(--muted); font-size:.85rem; width:max-content; }
  .edit-list summary:hover { color:var(--text); }
  .sect { font-size:.78rem; font-weight:700; letter-spacing:.09em; text-transform:uppercase;
    color:var(--muted); margin:0 0 .55rem; }
  .rolls + .sect { margin-top:1.5rem; }
  .who { font-family:var(--mono); font-size:.82rem; text-decoration:none; }
  .who:hover { text-decoration:underline; }
  .who .at { color:var(--faint); }
  .grid2 { display:grid; grid-template-columns:1.1fr 1fr; gap:1rem; margin-bottom:1.3rem; }
  /* On a combined view the best-roll value also carries the player, so let the value
     wrap rather than squeezing the label onto two lines. */
  .grid2 .kv .k { white-space:nowrap; }
  @media (max-width:680px) { .grid2 { grid-template-columns:1fr; } }
  .tier-row { display:flex; align-items:center; gap:.6rem; padding:.28rem 0; font-size:.92rem; }
  .tier-dot { width:.62rem; height:.62rem; border-radius:50%; flex:0 0 auto; background:var(--tc); box-shadow:0 0 8px var(--tc); }
  .tier-name { font-weight:600; } .tier-pct { color:var(--faint); font-size:.8rem; }
  .tier-n { margin-left:auto; font-family:var(--mono); font-variant-numeric:tabular-nums; font-weight:600; }
  .tier-share { flex:0 0 3.2rem; text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums;
    font-size:.78rem; color:var(--muted); }
  .tier-row.zero { opacity:.4; }
  .tier-total { margin-top:.35rem; padding-top:.5rem; padding-left:1.22rem; border-top:1px solid var(--border); }
  .rolls { border:1px solid var(--border); border-radius:var(--r-card); overflow:hidden; }
  .rolls table { width:100%; border-collapse:collapse; font-size:.88rem; }
  .rolls th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--faint);
    padding:.55rem .8rem; background:var(--surface-2); font-weight:600; }
  .rolls td { padding:.5rem .8rem; border-top:1px solid var(--border); font-variant-numeric:tabular-nums; }
  .rolls tr:hover td { background:var(--surface-2); }
  .rolls .num a { font-family:var(--mono); text-decoration:none; }
  .rolls .num a:hover { text-decoration:underline; }
  .ep { font-family:var(--mono); }`;

/** Wrap a profile page body in the shared shell. */
function profilePage(title, body, script) {
  return pageShell({
    title: esc(title), nav: 'profiles', width: '920px', noindex: true,
    css: PROFILE_CSS, body, script,
  });
}

// The username search form (shown at /u with no name, and atop each profile).
function profileForm(value) {
  return `<form class="uform" action="/u" method="get" onsubmit="var v=this.u.value.trim();if(v){location.href='/u/'+encodeURIComponent(v);}return false;">
    <input name="u" placeholder="rngdle username, e.g. cubityfirst" value="${esc(value || '')}" autocomplete="off" spellcheck="false">
    <button type="submit" class="btn-primary">View</button>
  </form>`;
}

// The multi-username form: one name per line, merged into a single combined summary.
// Submitting is handled here rather than by the GET action so the result gets a clean,
// shareable /u/a,b,c URL; the action= is the no-JS fallback (the route reads `us` too).
function profileMultiForm(names, label) {
  return `<form class="mform" action="/u" method="get" onsubmit="var ns=this.us.value.split(/[^A-Za-z0-9_-]+/).filter(Boolean);if(ns.length){location.href='/u/'+ns.map(encodeURIComponent).join(',');}return false;">
    <textarea name="us" rows="4" spellcheck="false" autocomplete="off"
      placeholder="one username per line, e.g.&#10;cubityfirst&#10;someone-else">${esc((names || []).join('\n'))}</textarea>
    <button type="submit" class="btn-primary">${label || 'Combine'}</button>
  </form>`;
}

function renderProfileForm(prefill) {
  return profilePage('RNGdle - Player Profile', `<div class="wrap">
  <h1>Player Profile</h1>
  <p class="tag">Enter a rngdle.com username to compute their collection summary.</p>
  ${profileForm(prefill)}
  <div class="or">or combine players</div>
  <p class="tag" style="margin-bottom:0">List up to ${MAX_COMBINE} usernames, one per line, to pool their rolls into a
    single summary.</p>
  ${profileMultiForm(null, 'Combine')}
</div>`);
}

function renderProfileError(username, status) {
  const msg = status === 404 ? `No rngdle profile found for <b>${esc(username)}</b>.` : `Couldn't load <b>${esc(username)}</b> from rngdle (status ${status}).`;
  return profilePage('RNGdle - Profile not found', `<div class="wrap">
  <h1>Player Profile</h1>
  ${profileForm(username)}
  <div class="err">${msg}</div>
</div>`);
}

// "@name", linking to that player's own profile.
const userLink = name => `<a class="who" href="/u/${encodeURIComponent(name)}"><span class="at">@</span>${esc(name)}</a>`;

/**
 * The profile page, rendered from a summary. One player and several combined players
 * are the same page - header with the copy-text button, rarity/collection cards, rolls
 * table - so both go through here; `o` carries only what differs:
 *
 *   o.title      <title> text            o.head    heading markup (h1 contents)
 *   o.tag        tagline markup          o.sum     summary from profileSummary/combinedSummary
 *   o.top        markup above the cards (edit form, failed-player warning)
 *
 * A summary with `members` is a combined one: rolls get an owner column, the collection
 * card gains a player count, and a per-player breakdown table appears above the rolls.
 */
function renderProfileView(o) {
  const sum = o.sum;
  const members = sum.members || null;
  const share = n => sum.totalRolls ? `${(n / sum.totalRolls * 100).toFixed(1)}%` : '0%';
  const tierRows = PROFILE_TIERS.map(([key, label, pct]) => {
    const n = sum.tierCounts[key];
    const acc = TIER_PALETTE[key].accent;
    return `<div class="tier-row${n === 0 ? ' zero' : ''}" style="--tc:${acc}">
      <span class="tier-dot"></span><span class="tier-name">${label}</span>
      <span class="tier-pct">${pct}</span><span class="tier-n">${n}</span>
      <span class="tier-share">${share(n)}</span></div>`;
  }).join('') + `<div class="tier-row tier-total">
      <span class="tier-name">Total</span>
      <span class="tier-n">${sum.totalRolls.toLocaleString()}</span>
      <span class="tier-share">100%</span></div>`;

  const b = sum.best;
  const bestHTML = b ? `<a href="/?n=${b.number}">${b.number.toLocaleString()}</a> <small>(${b.ep.toLocaleString()} EP)</small>` +
    `${b.owner ? ` · ${userLink(b.owner)}` : ''} · ${fmtDate(b.at)}` : '-';

  const rows = sum.scored.slice().sort((a, c) => new Date(c.at) - new Date(a.at)).map(r => {
    const acc = TIER_PALETTE[r.tier].accent;
    return `<tr>
      <td class="muted">${fmtDate(r.at)}</td>${members ? `<td>${userLink(r.owner)}</td>` : ''}
      <td class="num"><a href="/?n=${r.number}">${r.number.toLocaleString()}</a></td>
      <td><span class="pill" style="--tc:${acc}">${TIER_PALETTE[r.tier].label}</span></td>
      <td class="ep">${r.ep.toLocaleString()}</td>
      <td class="muted">${r.badgeCount ?? ''}</td>
    </tr>`;
  }).join('');

  // Per-player breakdown, best collection first - a mini leaderboard for the group.
  const memberRows = !members ? '' : members.slice().sort((x, y) => y.totalEP - x.totalEP).map(m => `<tr>
      <td>${userLink(m.username)}</td>
      <td class="ep">${m.totalRolls.toLocaleString()}</td>
      <td class="ep">${m.totalEP.toLocaleString()}</td>
      <td class="muted">${m.distinctBadges}</td>
      <td class="muted">${m.maxStreak.toLocaleString()}</td>
      <td class="num">${m.best ? `<a href="/?n=${m.best.number}">${m.best.number.toLocaleString()}</a> <span class="muted">(${m.best.ep.toLocaleString()} EP)</span>` : '-'}</td>
    </tr>`).join('');
  const membersHTML = !members ? '' : `<h2 class="sect">Players</h2>
  <div class="rolls"><table>
    <thead><tr><th>Player</th><th>Rolls</th><th>EP</th><th>Badges</th><th>Streak</th><th>Best roll</th></tr></thead>
    <tbody>${memberRows}</tbody>
  </table></div>
  <h2 class="sect">All rolls</h2>
  `;

  const copyData = profileCopyData(sum);
  const body = `<div class="wrap">
  <div class="phead">
    <div>
      <h1>${o.head}</h1>
      <p class="tag">${o.tag}</p>
    </div>
    <div class="pbtns">
      <button type="button" id="copy-btn" class="copy-btn" title="Copy the summary as text">📋 Copy text</button>
      <button type="button" id="cfg-btn" class="copy-btn cfg-btn" title="Copy text settings" aria-haspopup="dialog">⚙️</button>
      <div id="cfg-modal" class="cfg-modal" hidden>
        <div id="cfg-backdrop" class="cfg-backdrop"></div>
        <div class="cfg-dialog" role="dialog" aria-modal="true" aria-labelledby="cfg-title">
          <div class="cfg-head"><h3 id="cfg-title">Copy text settings</h3>
            <button type="button" id="cfg-close" class="cfg-x" aria-label="Close">✕</button></div>
          <div class="cfg-body">
            <div class="cfg-opts">
              <h4 class="cfg-sub">Tier lines</h4>
              <label class="cfg-row"><input type="checkbox" id="cfg-pct">
                <span>Percentile labels
                  <small>Show the &quot;Top X% / Bottom X%&quot; blurb next to each tier name.</small></span></label>
              <label class="cfg-row"><input type="checkbox" id="cfg-share">
                <span>Roll share percentages
                  <small>Show what % of your rolls landed in each tier, e.g. &quot;· 5.0%&quot;.</small></span></label>
              <label class="cfg-row"><input type="checkbox" id="cfg-expected">
                <span>Expected-rate markers
                  <small>Per tier: 🟢 above / 🔴 below the expected count for your total rolls, ❌ when you have none.</small></span></label>
              <label class="cfg-row"><input type="checkbox" id="cfg-expected-count">
                <span>Expected counts
                  <small>Append the expected number of rolls per tier, e.g. &quot;(Expected: 3)&quot;.</small></span></label>
              <h4 class="cfg-sub">Stat lines</h4>${members ? `
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-players"><span>👥 Players</span></label>` : ''}
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-totalRolls"><span>🧮 Total Rolls</span></label>
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-streak"><span>🔥 Day ${members ? 'Combined' : 'Max'} Streak</span></label>
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-badges"><span>🏅 Badges</span></label>
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-ep"><span>📈 Total EP</span></label>
              <label class="cfg-row cfg-mini"><input type="checkbox" id="cfg-stat-bestRoll"><span>🎲 Best Roll</span></label>
            </div>
            <div class="cfg-preview"><h4>Preview</h4><pre id="cfg-preview-text"></pre></div>
          </div>
          <div class="cfg-foot">
            <button type="button" id="cfg-reset" class="copy-btn cfg-reset" title="Reset all settings to their defaults">↺ Reset to default</button>
            <button type="button" id="cfg-copy" class="copy-btn" title="Copy the summary as text">📋 Copy text</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script type="application/json" id="copy-data">${JSON.stringify(copyData).replace(/</g, '\\u003c')}</script>
  ${o.top || ''}<div class="grid2">
    <div class="card"><h2>Rarity spread</h2>${tierRows}</div>
    <div class="card"><h2>Collection</h2>${members ? `
      <div class="kv"><span class="k">Players</span><span class="v">${members.length}</span></div>` : ''}
      <div class="kv"><span class="k">Total Rolls</span><span class="v">${sum.totalRolls.toLocaleString()}</span></div>
      <div class="kv"><span class="k">Badges collected</span><span class="v">${sum.distinctBadges} <small>/ ${BADGES.length}</small></span></div>
      <div class="kv"><span class="k">Total EP</span><span class="v">${sum.totalEP.toLocaleString()}</span></div>
      <div class="kv"><span class="k" title="${members ? 'Longest run of days on which at least one of these players rolled' : 'Longest run of days with at least one roll'}">${members ? 'Combined streak' : 'Max streak'}</span><span class="v">${sum.maxStreak.toLocaleString()} <small>day${sum.maxStreak === 1 ? '' : 's'}</small></span></div>
      <div class="kv"><span class="k">Best roll</span><span class="v" style="font-weight:500">${bestHTML}</span></div>
    </div>
  </div>
  ${membersHTML}<div class="rolls"><table>
    <thead><tr><th>Date</th>${members ? '<th>Player</th>' : ''}<th>Number</th><th>Tier</th><th>EP</th><th>Badges</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;

  const script = `
(function () {
  var btn = document.getElementById('copy-btn'), data = document.getElementById('copy-data');
  if (!btn || !data) return;
  var d = JSON.parse(data.textContent);

  // Settings live in localStorage; unknown keys are ignored so old stores stay valid.
  var KEY = 'rngdle-profile-copy-settings';
  // 'players' only appears on a combined view; on a single profile there is no such
  // stat line and no checkbox for it, so the setting simply sits unused.
  var DEFAULTS = { pct: true, share: true, expected: false, expectedCount: false,
    players: true, totalRolls: true, streak: true, badges: true, ep: true, bestRoll: true };
  var cfg = {};
  for (var dk in DEFAULTS) cfg[dk] = DEFAULTS[dk];
  try {
    var stored = JSON.parse(localStorage.getItem(KEY));
    if (stored && typeof stored === 'object') for (var k in cfg) if (k in stored) cfg[k] = !!stored[k];
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  function marker(t) { return t.n === 0 ? '❌' : t.n >= t.exp ? '🟢' : '🔴'; }
  function fmtExp(x) { var e = Math.round(x * 10) / 10; return e % 1 ? e.toFixed(1) : String(e); }
  function buildText() {
    var lines = d.tiers.map(function (t) {
      var l = t.emoji + ' ' + t.label + (cfg.pct ? ' (' + t.pct + ')' : '') + ' ' + t.n + (cfg.share ? ' · ' + t.share : '');
      if (cfg.expected) l += ' ' + marker(t);
      if (cfg.expectedCount) l += ' (Expected: ' + fmtExp(t.exp) + ')';
      return l;
    });
    var out = lines.join('\\n');
    var statLines = d.stats.filter(function (s) { return cfg[s[0]]; }).map(function (s) { return s[1]; });
    if (statLines.length) out += '\\n\\n' + statLines.join('\\n');
    return out;
  }

  var gear = document.getElementById('cfg-btn'), modal = document.getElementById('cfg-modal');
  var preview = document.getElementById('cfg-preview-text');
  function updatePreview() { if (preview) preview.textContent = buildText(); }
  var MAP = [['cfg-pct', 'pct'], ['cfg-share', 'share'], ['cfg-expected', 'expected'], ['cfg-expected-count', 'expectedCount'],
    ['cfg-stat-players', 'players'],
    ['cfg-stat-totalRolls', 'totalRolls'], ['cfg-stat-streak', 'streak'], ['cfg-stat-badges', 'badges'],
    ['cfg-stat-ep', 'ep'], ['cfg-stat-bestRoll', 'bestRoll']];
  function syncBoxes() { MAP.forEach(function (m) { var cb = document.getElementById(m[0]); if (cb) cb.checked = cfg[m[1]]; }); }
  MAP.forEach(function (m) {
    var cb = document.getElementById(m[0]);
    if (cb) cb.addEventListener('change', function () { cfg[m[1]] = cb.checked; save(); updatePreview(); });
  });
  syncBoxes();
  var resetBtn = document.getElementById('cfg-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    for (var rk in DEFAULTS) cfg[rk] = DEFAULTS[rk];
    try { localStorage.removeItem(KEY); } catch (e) {}
    syncBoxes(); updatePreview();
  });
  if (gear && modal) {
    function openModal() { updatePreview(); modal.hidden = false; }
    function closeModal() { modal.hidden = true; }
    gear.addEventListener('click', openModal);
    document.getElementById('cfg-close').addEventListener('click', closeModal);
    document.getElementById('cfg-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  }

  function bindCopy(b) {
    if (!b) return;
    b.addEventListener('click', function () {
      var text = buildText();
      function done() { b.textContent = '✓ Copied'; b.classList.add('ok'); setTimeout(function () { b.textContent = '📋 Copy text'; b.classList.remove('ok'); }, 1400); }
      function fallback() {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta); done();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else { fallback(); }
    });
  }
  bindCopy(btn);
  bindCopy(document.getElementById('cfg-copy'));
})();`;

  return profilePage(o.title, body, script);
}

// Every name in a combined list failed to load: show the list back with the reasons.
function renderCombinedError(names, failed) {
  const why = f => f.error === 404 ? 'no such profile' : 'status ' + f.error;
  return profilePage('RNGdle - Profiles not found', `<div class="wrap">
  <h1>Combined Profile</h1>
  <div class="err" style="margin-bottom:1.2rem">Couldn't load
    ${failed.map(f => `<b>${esc(f.username)}</b> (${why(f)})`).join(', ')}.</div>
  ${profileMultiForm(names, 'Try again')}
</div>`);
}

function renderProfile(username, sum) {
  return renderProfileView({
    title: 'RNGdle - ' + username,
    head: `<span class="at">@</span>${esc(username)}`,
    tag: `${sum.totalRolls.toLocaleString()} roll${sum.totalRolls === 1 ? '' : 's'}
      · <a href="https://www.rngdle.com/u/${encodeURIComponent(username)}" target="_blank" rel="noopener">on rngdle &rarr;</a>`,
    sum,
  });
}

/**
 * Several players pooled into one collection. `failed` holds the names that couldn't be
 * loaded ([{username, error}]) - they're reported in a banner rather than failing the
 * whole page, so one typo in a list of six still gives you the other five.
 */
function renderCombined(names, sum, failed, dropped) {
  const head = names.map(n => `<span class="at">@</span>${esc(n)}`).join(' <span class="at">+</span> ');
  const notes = [];
  if (failed.length) {
    notes.push(`Couldn't load ${failed.map(f => `<b>${esc(f.username)}</b> (${f.error === 404 ? 'no such profile' : 'status ' + f.error})`).join(', ')} -
      combined from the other ${names.length} player${names.length === 1 ? '' : 's'}.`);
  }
  if (dropped && dropped.length) {
    notes.push(`At most ${MAX_COMBINE} players can be combined at once, so
      ${dropped.map(n => `<b>${esc(n)}</b>`).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} left out.`);
  }
  const warn = !notes.length ? '' : `<div class="err" style="margin-bottom:1.3rem">${notes.join('<br>')}</div>`;
  return renderProfileView({
    title: 'RNGdle - ' + names.join(' + '),
    head,
    tag: `${names.length} player${names.length === 1 ? '' : 's'} · ${sum.totalRolls.toLocaleString()} roll${sum.totalRolls === 1 ? '' : 's'} pooled`,
    top: `${warn}<details class="edit-list"><summary>Edit this list</summary>${profileMultiForm(names, 'Recombine')}</details>
  `,
    sum,
  });
}

export { compute, BADGES, FAMILIES, engineModuleSource, CARD_TIERS, cardTier };

// Everything src/beta.js renders from, passed in rather than imported, so beta.js has no
// import edge back into this file (which would be a cycle - index.js imports beta.js).
function betaCtx() {
  return {
    BADGES, FAMILIES, FAMILY_NAMES, DESCRIPTIONS, PROBABILITIES, EXAMPLES,
    TIER_PALETTE, CARD_TIERS, CARD_TIER_NAMES, tierFromScore, esc, fmtProb,
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get('n');

    // Browser engine for the client-side workers on /, /grid and /chains. It also carries
    // sweepShared(), the one cached full-range sweep all three of them read.
    if (url.pathname === '/engine.js') {
      // Short browser cache: one page load fetches this up to three times (the worker's
      // module import, the version hash, and sweepAll's shard blob), and 15 min is long
      // enough that they collapse to one origin hit while a scoring change still reaches
      // everyone within the quarter hour. The shared sweep cache is keyed by a hash of
      // this file, so a stale copy self-corrects as soon as the entry expires - keep
      // max-age well under that cache's TTL.
      return new Response(engineModuleSource(), {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'public, max-age=900',
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

    // Live data for the calculator's click-to-type card (number + tier + badges).
    // `/beta?n=` is the original spelling of this endpoint and still answers, because
    // /beta itself is now the beta lab's index page; /api/card is the name to use.
    if (url.pathname === '/api/card' || (url.pathname === '/beta' && raw !== null)) {
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

    // /beta - the experimental data-vis lab, and /beta/<tool> for each experiment.
    if (url.pathname === '/beta' || url.pathname.startsWith('/beta/')) {
      const html = handleBeta(url.pathname, betaCtx());
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // Hidden interactive 1,000,000-number map; click a cell to open it on /.
    if (url.pathname === '/grid') {
      return new Response(renderGrid(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // The n -> EP(n) graph: every number linked to its own score, computed in-browser.
    if (url.pathname === '/chains') {
      return new Response(renderChains(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // Browsable index of every badge: rule, EP, rarity, families, examples.
    if (url.pathname === '/badges') {
      return new Response(renderBadgeIndex(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // Player profiles: /u (search form), /u/<name> (computed summary), and a JSON
    // endpoint /api/profile?u=<name>. Rolls come from rngdle's public API; every
    // stat is computed locally with compute(). Cached at the edge to be polite.
    if (url.pathname === '/api/profile') {
      const u = (url.searchParams.get('u') || '').trim();
      // Comma/newline-separated `u` (or `us`) merges several players into one summary,
      // the same as /u/a,b,c. A single name keeps the original response shape.
      const list = parseUsernames(`${u}\n${url.searchParams.get('us') || ''}`);
      if (list.length > 1) {
        const names = list.slice(0, MAX_COMBINE);
        const loaded = await fetchProfiles(names);
        const ok = loaded.filter(m => m.rolls);
        if (!ok.length) {
          return new Response(JSON.stringify({ error: 'no users could be loaded', users: loaded.map(m => ({ username: m.username, error: m.error })) }),
            { status: 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
        }
        const sum = combinedSummary(ok);
        return new Response(JSON.stringify({ usernames: ok.map(m => m.username), failed: loaded.filter(m => !m.rolls), ...sum }), {
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
        });
      }
      if (!VALID_USERNAME.test(u)) {
        return new Response(JSON.stringify({ error: 'Provide u as a valid username.' }),
          { status: 400, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }
      try {
        const sum = profileSummary(await fetchUserRolls(u));
        return new Response(JSON.stringify({ username: u, ...sum }), {
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message === 'not_found' ? 'user not found' : 'fetch failed', status: e.status || 502 }),
          { status: e.status === 404 ? 404 : 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }
    }
    if (url.pathname === '/u' || url.pathname === '/u/') {
      // `u` is the single-name field, `us` the multi-line textarea (no-JS fallback);
      // either way we normalise to the canonical /u/<name>[,<name>...] URL.
      const u = (url.searchParams.get('u') || '').trim();
      const names = parseUsernames(`${u}\n${url.searchParams.get('us') || ''}`);
      // Over-long lists are trimmed at render time, not here, so the page can say so.
      if (names.length) return Response.redirect(`${url.origin}/u/${names.map(encodeURIComponent).join(',')}`, 302);
      return new Response(renderProfileForm(u), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    // /u/<a>,<b>,<c> pools several players into one combined summary.
    if (url.pathname.startsWith('/u/') && decodeURIComponent(url.pathname.slice(3)).includes(',')) {
      const seg = decodeURIComponent(url.pathname.slice(3));
      const asked = parseUsernames(seg);
      if (!asked.length) return new Response(renderProfileForm(''), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      // "a," or "a,,": nothing to combine, so it's just a normal profile.
      if (asked.length === 1) return Response.redirect(`${url.origin}/u/${encodeURIComponent(asked[0])}`, 302);
      // Normalise first (repeats, stray separators, "@name"): one player listed twice
      // must not be counted twice, and the shared URL should be the canonical one.
      const canon = asked.map(encodeURIComponent).join(',');
      if (canon !== seg) return Response.redirect(`${url.origin}/u/${canon}`, 302);
      const names = asked.slice(0, MAX_COMBINE);
      const loaded = await fetchProfiles(names);
      const ok = loaded.filter(m => m.rolls);
      const failed = loaded.filter(m => !m.rolls);
      if (!ok.length) {
        return new Response(renderCombinedError(names, failed), {
          status: failed.every(f => f.error === 404) ? 404 : 502, headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(renderCombined(ok.map(m => m.username), combinedSummary(ok), failed, asked.slice(MAX_COMBINE)), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }
    if (url.pathname.startsWith('/u/')) {
      const u = decodeURIComponent(url.pathname.slice(3)).trim();
      if (!VALID_USERNAME.test(u)) return new Response(renderProfileForm(u), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      try {
        const sum = profileSummary(await fetchUserRolls(u));
        return new Response(renderProfile(u, sum), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
        });
      } catch (e) {
        return new Response(renderProfileError(u, e.status || 502), { status: e.status === 404 ? 404 : 502, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
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

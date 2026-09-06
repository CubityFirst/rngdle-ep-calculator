// RNGdle badge engine + legacy tools - Cloudflare Worker
//
// The badge table, the scorer (compute), the browser engine (/engine.js), the JSON APIs
// and the tools that were never ported to the new front end (/chains and /beta/<tool>).
// The front end itself - the calculator, /badges, /grid, /u - is the static site under
// site/, in rngdle's own furniture; src/worker.js serves it and mounts this module for
// the legacy routes, and this module's old paths redirect there (see FRONT_END below).
// EP per badge = the "Score (Decimal)" column from the source CSV.
//
// The badge `test` functions and the FAMILIES map are reconciled to full parity with the
// live game: every number 0..1,000,000 yields the identical earned/scoring badges and total
// EP as rngdle.com (see README.md and test/full-membership.mjs).

// numbers per badge for the /badges index, and each badge's exact share of all
// 1,000,001 inputs. Regenerate + commit whenever a badge test / EP / family changes.
import { EXAMPLES } from './examples.gen.js';
import { PROBABILITIES } from './probabilities.gen.js';
// Shared design system: one token set, one set of primitives (.btn/.field/.pill/.card/
// .stat/.kv/.progress) and one site nav, used by every page below. See src/ui.js.
import { pageShell } from './ui.js';
// /beta - the experimental data-vis lab. Its pages render from the same badge table and
// the same client-side sweep as everything else; betaCtx() below is the one hand-off.
import { handleBeta, renderSharedBox, legacyCatalogue } from './beta.js';

// Palette gallery for /beta/boxes - the only route that reads or writes storage.
import { handleGallery, handleMyLikes, loadDesign } from './gallery.js';

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
  ['EON', 'Eon', '🗿', 10000010, c => c.s.endsWith('00000')],
  ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, c => /(\d)\1{5}/.test(c.s)],
  ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, c => c.has('00000')],
  ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, c => c.len === 1],
  ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, c => c.s.endsWith('99999')],
  ['SEMI_EON', 'Semi-Eon', '🦴', 10000010, c => c.s.endsWith('50000')],
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
  ['EPOCH', 'Epoch', '🏛️', 1000001, c => c.s.endsWith('0000')],
  ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, c => c.s.endsWith('9999')],
  ['SEMI_EPOCH', 'Semi-Epoch', '⌛', 1000001, c => c.s.endsWith('5000')],
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
  ['QUARTER_CENTURY', 'Quarter-Century', '🪙', 10000, c => c.s.endsWith('25')],
  ['SEMI_CENTURY', 'Semi-Century', '🗓️', 10000, c => c.s.endsWith('50')],
  ['THREE_QUARTER_CENTURY', 'Three-Quarter Century', '🕰️', 10000, c => c.s.endsWith('75')],

  // --- Uncommon ---
  ['QUADS', 'Four of a Kind', '🍀', 8436, c => c.maxCount >= 4],
  ['EQUATION', 'Equation', '🟰', 7720, c => findEquation(c.s) !== null],
  ['LOW_BALL', 'Low Ball', '📉', 6400, c => /^[0-4]+$/.test(c.s)],
  ['MOUNTAIN', 'Mountain', '🏔️', 5885, c => mountain(c.d)],
  ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, c => { if (c.len < 5 || c.distinct < 2) return false; for (let e = 0; e <= c.len - 5; e++) if (c.s[e + 2] === c.s[e] && c.s[e + 4] === c.s[e]) return true; return false; }],
  ['HIGH_ROLLER', 'High Roller', '🤑', 5120, c => /^[5-9]+$/.test(c.s)],
  ['VALLEY', 'Valley', '🏜️', 4199, c => valley(c.d)],
  // 2026-08-22: a plain 4-wide aabb window (a !== b), so a run of 3+ carries a pair with
  // it (11122 scores). The old rule scanned non-overlapping pair starts and skipped those.
  ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 3957, c => { for (let i = 0; i + 3 < c.len; i++) if (c.s[i] === c.s[i + 1] && c.s[i + 2] === c.s[i + 3] && c.s[i] !== c.s[i + 2]) return true; return false; }],
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
  ['CANYON', 'Canyon', '🌄', 1184, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a < b) { if (rose) return false; fell = true; } else if (a > b) rose = true; } return rose && fell; }],
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
  // 2026-08-22: any two digits seen twice OR MORE, so a triple now carries a pair (1112 is
  // still out - one digit - but 11122 is in). Was countExact(2) >= 2.
  ['TWO_PAIR', 'Two Pair', '👯‍♀️', 377, c => c.withCount(2) >= 2],
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
  SEMI_EON: 'Ends in "50000".',
  EPOCH: 'Ends in four zeros.',
  EON: 'Ends in five zeros.',
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
  QUARTER_CENTURY: 'Ends in "25".',
  THREE_QUARTER_CENTURY: 'Ends in "75".',
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
// extracted from the live game's BADGE_DEFINITIONS (39 families / 168 badges); the remaining
// 65 badges are standalone and always score. Member order is irrelevant - the scorer keeps
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
  // VOID_DEPTH: since 2026-09-05 the "ends in zeros" ladder (Clean → Eon) and the
  // "ends in 5-then-zeros" ladder (Semi-Century → Semi-Eon) share this family with the
  // Deep Voids, so 100000 pays Eon alone - not Eon + Millennium + Century + Clean + the
  // Deep Voids on top. Eon, Semi-Eon and Deep Void (5) tie at 10,000,010; BADGES order
  // (Eon first) breaks the tie exactly as prod's definition order does.
  ['EON', 'SEMI_EON', 'DEEP_VOID_FIVE', 'EPOCH', 'SEMI_EPOCH', 'DEEP_VOID_FOUR', 'MILLENNIUM',
    'SEMI_MILLENNIUM', 'DEEP_VOID_THREE', 'CENTURY', 'SEMI_CENTURY', 'DEEP_VOID', 'CLEAN'], // VOID_DEPTH
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
  'Error', 'Hills', 'Palindrome', 'Tau', 'Ultimeme',
];

// ---------------------------------------------------------------------------
// Badge history: every change to the badge set since the initial full-parity port,
// oldest first. `added` lists ids that joined BADGES that day; `retired` keeps a
// frozen copy of each badge that left it - [id, label, emoji, ep, description] as it
// stood on its last day - because once a badge is out of BADGES nothing else in the
// codebase remembers it existed. Dates are when the change landed *here*, which for
// the two ported batches is the day prod's bundle changed.
//
// This is the single source for "when did this badge arrive": BADGE_ADDED, the
// per-card "Added" line, the "Newly added" banner and the history panel on /badges
// all derive from it. When a fresh batch lands (see CLAUDE.md), append one entry -
// nothing else needs bumping.
//
// The pre-2026-08-22 entries were recovered from git history after the fact
// (research/badge-history.mjs walks every revision of this file and diffs the id
// sets), so they are the real dates, not a reconstruction.
// ---------------------------------------------------------------------------

// The original port. Every badge without a BADGE_HISTORY entry dates from here.
const BADGE_PORT_DATE = '2026-06-09';
const BADGE_HISTORY = [
  {
    date: '2026-07-13',
    note: 'One Million - the badge at the very top of the range - had been missed by ' +
      'the original port; the first full-range scan turned it up (203 → 204).',
    added: ['ONE_MILLION'],
    retired: [],
  },
  {
    date: '2026-07-16',
    note: "26 badges from prod's 2026-07-16 bundle (204 → 230), with five new families " +
      '(Hills, Palindrome, Tau, Ultimeme, Error) and five prod-ported helpers. No ' +
      'existing badge changed EP.',
    added: [
      'STEPS', 'SLOPES', 'MESA', 'CANYON', 'DUNES', 'POCKET_MIRROR', 'ARITHMETIC',
      'GEOMETRIC', 'EQUATION', 'FIVE_OF_A_KIND', 'FRAMED_QUAD', 'OUROBOROS',
      'POWER_OF_FIVE', 'POWER_OF_SEVEN', 'TAU', 'TAU_SLICE_4', 'TAU_SLICE_5',
      'GOLDEN_RATIO', 'ALWAYS', 'FULL_DAY', 'FOOTBALL_17776', 'ERROR_EXACT',
      'INFERNAL', 'ULTIMEME', 'ULTIMEME_EXACT', 'MINI_SCRAMBLE',
    ],
    retired: [],
  },
  {
    date: '2026-08-22',
    note: "prod's 2026-08-22 bundle (230 → 233): five standalone \"ends in\" badges " +
      'arrived, the whole Tree Fiddy family was retired, Two Pair now counts a digit ' +
      'seen twice or more (EP 447 → 377) and Contiguous Two Pair became a plain 4-wide ' +
      'aabb window (EP 6,142 → 3,957). Semi-Epoch swapped its moai for an hourglass ' +
      '(Eon took the moai) and Canyon its rock for a sunrise.',
    added: ['EON', 'SEMI_EON', 'EPOCH', 'QUARTER_CENTURY', 'THREE_QUARTER_CENTURY'],
    retired: [
      ['TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 100000100, 'Exactly "350".'],
      ['TREE_FIDDY', 'Tree Fiddy', '🦕', 25006, 'Contains "350" (the Loch Ness Monster\'s request).'],
    ],
  },
  {
    date: '2026-09-05',
    note: "prod's 2026-09-05 bundle: no badge came or went, but the Void Depth family grew " +
      'from the four Deep Voids to thirteen - Clean, Century, Millennium, Epoch and Eon plus ' +
      'their Semi- halves now collapse to one payout, so 100000 pays Eon alone instead of ' +
      'Eon + Millennium + Century + Clean + the Deep Voids. No EP changed; the card ' +
      'percentiles moved with the new totals.',
    added: [],
    retired: [],
  },
];

// id -> the date it arrived. Badges from the original port are absent; badgeAdded()
// falls back to BADGE_PORT_DATE, so every live badge has a date.
const BADGE_ADDED = Object.fromEntries(
  BADGE_HISTORY.flatMap(b => b.added.map(id => [id, b.date])));
const badgeAdded = id => BADGE_ADDED[id] || BADGE_PORT_DATE;

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
// Computing all 1,000,000 numbers x 233 badge tests is far beyond a single
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
// HTTP
// ---------------------------------------------------------------------------

// --- Beta renderer: overall-number rarity tier ----------------------------
// Card tier is percentile-driven on rngdle.com (CARD_PERCENTILE_THRESHOLDS =
// trash<1, common<50, uncommon<75, rare<90, epic<95, anomaly<99, else mythic).
// The EP cutoffs below are the exact boundaries derived from its shipped
// SCORE_PERCENTILES table (each cutoff = smallest EP whose percentile >= the
// threshold). Because the total-EP distribution shifts whenever the badge set
// changes, these MUST be re-derived from the percentile table in the current bundle
// (rngdle.tools vendors it as vendor/rngdle-engine.js) - these values are from the
// 2026-09-05 bundle (233 badges). Palette colours are the rngdle.com RARITY_PALETTE
// highlight accents.
const CARD_TIERS = [
  [2087, 'trash'], [5802, 'common'], [10074, 'uncommon'],
  [22293, 'rare'], [35469, 'epic'], [162292, 'anomaly'],
]; // >= 162292 -> mythic
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
        '<a href="/n/' + g.dataset.n + '">' + fmt(+g.dataset.n) + '</a> scores <a href="/n/' + g.dataset.next + '">' + fmt(+g.dataset.next) + '</a>';
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
          (inLoop ? ' in-loop' : '') + '" href="/n/' + n + '">' + fmt(n) + '</a>';
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
      '<tr><td><a class="mono" href="/n/' + x.sink + '">' + fmt(x.sink) + '</a></td><td class="mono">' + fmt(x.ep) +
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

  <footer><p>Every number scored with the same engine as <a href="/">the sandbox</a>; edges are
    <span class="mono">n &rarr; EP(n)</span>, kept only where the score is itself a legal input. Loops are
    found by walking each number until it meets a settled node or itself. Any number here opens in the
    sandbox. See also <a href="/grid">the grid</a> and <a href="/badges">every badge</a>.</p></footer>
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
// User profiles: pull a player's rolls from rngdle.com's public API and compute
// their collection summary ourselves. rngdle doesn't export this summary; its
// /api/users/<name>/rolls endpoint is offset-paginated ({rolls, hasMore}). Our
// compute() reproduces the stored per-roll score exactly (verified 0 mismatches
// over a real profile), so every stat below is derived locally at full fidelity.
// ---------------------------------------------------------------------------

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

export { compute, BADGES, FAMILIES, engineModuleSource, CARD_TIERS, cardTier,
  BADGE_HISTORY, BADGE_PORT_DATE, badgeAdded, legacyCatalogue };

// ---------------------------------------------------------------------------
// The new front end
// ---------------------------------------------------------------------------

// Every page this module used to render itself - the calculator, /badges, /grid, /u -
// is now the static front end under site/, served by src/worker.js from the same
// origin. That Worker only hands this module the legacy paths, so the redirects below
// are for this module served on its own (`node test/browser.mjs`, an old deploy):
// they go to env.FRONT_END when the caller names one, else to the request's origin.
const FRONT_END = '';

// Paths the front end owns. A link the legacy pages emit (/n/123, /grid/pronic,
// /other) redirects there rather than 404ing when this module is browsed on its own.
const FRONT_END_PATHS = /^\/(?:$|beta\/?$|n\/\d|other$|analysis$|ep$|(?:grid|neighbours|luck|badges|u)(?:\/|$))/;

// Old URL -> its home on the new front end. `/?n=696969` is `/n/696969` there and the old
// /beta index is the "Other" tab; everything else keeps its path, which rngdle.tools
// routes the same way (/badges/<slug>, /grid/<slug>, /u/<name>).
function frontEndPath(url) {
  if (url.pathname === '/' || url.pathname === '') {
    const n = parseN(url.searchParams.get('n'));
    return n !== null && !Number.isNaN(n) ? `/n/${n}` : '/';
  }
  if (url.pathname === '/beta' || url.pathname === '/beta/') return '/other';
  return url.pathname + url.search;
}

// Everything src/beta.js renders from, passed in rather than imported, so beta.js has no
// import edge back into this file (which would be a cycle - index.js imports beta.js).
function betaCtx() {
  return {
    BADGES, FAMILIES, FAMILY_NAMES, DESCRIPTIONS, PROBABILITIES, EXAMPLES,
    TIER_PALETTE, CARD_TIERS, CARD_TIER_NAMES, tierFromScore, esc, fmtProb,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const raw = url.searchParams.get('n');

    // Browser engine for the client-side workers on /chains and the /beta tools. It also
    // carries sweepShared(), the one cached full-range sweep all of them read.
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

    // A published rarity, by link. Has to be matched before handleBeta, which would
    // read the whole tail as a tool slug and 404. Rendered server-side because the
    // unfurl metadata has to be in the HTML - crawlers do not run the page's script.
    const shareId = url.pathname.match(/^\/beta\/boxes\/r\/([a-z0-9]{4,32})$/);
    if (shareId) {
      const found = await loadDesign(env, shareId[1]);
      // Plain text, matching the worker's own 404 for every other unmatched path.
      if (!found) return new Response('No rarity with that link.', { status: 404 });
      return new Response(renderSharedBox(betaCtx(), { ...found, url: url.href }), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // Shared palette gallery (POST to publish, GET to browse). Answers 503 rather
    // than 500 when no D1 binding is present, so a deployment without one still
    // serves every other route normally.
    const gallery = await handleGallery(url, request, env)
      || await handleMyLikes(url, request, env);
    if (gallery) return gallery;

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

    // /beta/<tool> - the tools that were not ported to the new front end. The old /beta
    // index is gone: rngdle.tools' "Other" tab draws its cards from legacyCatalogue().
    if (url.pathname.startsWith('/beta/')) {
      const html = handleBeta(url.pathname, betaCtx());
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // The n -> EP(n) graph: every number linked to its own score, computed in-browser.
    if (url.pathname === '/chains') {
      return new Response(renderChains(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // Player summaries as JSON: /api/profile?u=<name>, or several names to pool them
    // (/beta/collection reads this). Rolls come from rngdle's public API; every stat
    // is computed locally with compute(). Cached at the edge to be polite.
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
    // Everything this Worker used to render itself now lives on the new front end.
    if (FRONT_END_PATHS.test(url.pathname)) {
      return Response.redirect(`${(env && env.FRONT_END) || FRONT_END || url.origin}${frontEndPath(url)}`, 301);
    }

    return new Response('Not found', { status: 404 });
  },
};

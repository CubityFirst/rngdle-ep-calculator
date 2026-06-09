// RNGdle badge / EP calculator - Cloudflare Worker
//
// Enter any number 0..999999 and get the total EP plus the list of badges it earns.
// EP per badge = the "Score (Decimal)" column from the source CSV.
//
// NOTE: Several badge rules in the CSV are described in prose and are ambiguous.
// The interpretations below are best-effort. See README.md "Assumptions" and adjust
// the test functions if they disagree with the live game.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ipow(b, e) { let r = 1; for (let i = 0; i < e; i++) r *= b; return r; }

// Perfect b^exp. 0 and 1 both count as perfect powers of every exponent (0 = 0^exp,
// 1 = 1^exp) and earn all 13 power badges (superseded to the top tier). 0 is confirmed
// against prod (0 = 139,927,162); 1 is assumed by request (pending prod confirmation).
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
  while (b <= 999999) { s.add(b); [a, b] = [b, a + b]; }
  return s;
})();
const PRONICS = (() => {
  const s = new Set();
  for (let k = 0; k * (k + 1) <= 999999; k++) s.add(k * (k + 1));
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
  ['CONSEC_QUAD_EXACT', '4 Consecutive Numbers', '⛓️', 25000025, 'Mythic', c => consecAsc(c.s, 4)],
  ['NINTH_POWER', '9th Power', '☁️', 20000020, 'Mythic', c => isPerfectPower(c.n, 9)],
  ['EIGHTH_POWER', '8th Power', '🎱', 16666683, 'Mythic', c => isPerfectPower(c.n, 8)],
  ['SEVENTH_POWER', '7th Power', '🌈', 12500013, 'Mythic', c => isPerfectPower(c.n, 7)],
  ['FACTORIAL', 'Factorial', '❗', 11111122, 'Mythic', c => FACTORIALS.has(c.n)],
  ['HELLO', 'Hello', '👋', 11111122, 'Mythic', c => c.has('07734')],
  ['SEQUENCE_6', 'Sequence (6)', '🔢', 11111122, 'Mythic', c => seqAsc(c.d, 6)],
  ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, 'Mythic', c => /(\d)\1{5}/.test(c.s)],
  ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, 'Mythic', c => c.has('00000')],
  ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, 'Mythic', c => c.len === 1],
  ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, 'Mythic', c => c.s.endsWith('99999')],
  ['SIXTH_POWER', '6th Power', '🎲', 9090918, 'Anomaly', c => isPerfectPower(c.n, 6)],
  ['POWER_OF_THREE', 'Power of Three', '🔺', 7692315, 'Anomaly', c => isPowerOf(c.n, 3)],
  ['FIFTH_POWER', '5th Power', '🖐️', 6250006, 'Anomaly', c => isPerfectPower(c.n, 5)],
  ['JACKPOT_FIVE', 'Jackpot Five', '💰💰💰', 5263163, 'Anomaly', c => c.has('77777')],
  ['POWER_OF_TWO', 'Power of Two', '💾', 5000005, 'Anomaly', c => isPowerOf(c.n, 2)],
  ['ROYAL_FLUSH', 'Royal Flush', '👑', 5000005, 'Anomaly', c => c.has('56789')],
  ['BOOB_58008', '58008', '🔠', 5000005, 'Anomaly', c => c.has('58008')],
  ['BOOB_80085', '80085', '🅱️', 5000005, 'Anomaly', c => c.has('80085')],
  ['PI_CONTAINS_5', 'Pi Slice (5)', '🥧', 5000005, 'Anomaly', c => c.has('31415')],
  ['E_CONTAINS_5', 'E Slice (5)', '📈', 5000005, 'Anomaly', c => c.has('27182')],
  ['CASCADE', 'Cascade', '🌊', 3333337, 'Anomaly', c => consecInc(c.d)],
  ['FIBONACCI', 'Fibonacci Number', '🐚', 3333337, 'Anomaly', c => FIBS.has(c.n)],
  ['FOURTH_POWER', '4th Power', '📦', 3125003, 'Anomaly', c => isPerfectPower(c.n, 4)],
  ['WATERFALL', 'Waterfall', '🚿', 2857146, 'Anomaly', c => consecDec(c.d)],
  ['CONSEC_QUAD_CONTAINS', '4 Consecutive Numbers (Contains)', '🔗', 2631582, 'Anomaly', c => containsConsec(c.s, 4)],
  ['CONSEC_QUAD_SCRAMBLED', '4 Consecutive Numbers (Scrambled)', '🔀', 2272730, 'Anomaly', c => consecScrambled(c.s, 4)],
  ['HOMOGENEOUS', 'Homogeneous', '🥛', 2222224, 'Anomaly', c => c.len >= 2 && c.distinct === 1],
  ['BINARY_SOUL', 'Binary Soul', '🤖', 1538463, 'Anomaly', c => /^[01]+$/.test(c.s)],
  ['STRAIGHT_FLUSH', 'Straight Flush', '🃏', 1449277, 'Anomaly', c => c.has('02468') || c.has('13579') || c.has('86420') || c.has('97531')],
  ['TWO_DIGITS', 'Two Digits', '✌️', 1111112, 'Anomaly', c => c.len === 2],
  // sum === product. Excludes single digits (1..9 are trivially true) but prod DOES
  // award it to 0 (sum 0 = product 0), so 0 is allowed through. Confirmed via 0 vs 2.
  ['SPY', 'Spy Number', '🕵️', 1030929, 'Anomaly', c => (c.len >= 2 || c.n === 0) && c.sum === c.prod],
  ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, 'Anomaly', c => c.s.endsWith('9999')],
  ['SEMI_EPOCH', 'Semi-Epoch', '🗿', 1000001, 'Anomaly', c => c.s.endsWith('5000')],
  ['CUBE', '3rd Power', '🧊', 990100, 'Anomaly', c => isPerfectPower(c.n, 3)],
  ['EVEN_SPACING', 'Even Spacing', '📏', 862070, 'Anomaly', c => arithmetic(c.d)],

  // --- Epic ---
  ['CONSEC_TRIPLE_EXACT', '3 Consecutive Numbers', '⛓️', 555556, 'Epic', c => consecAsc(c.s, 3)],
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
  ['CONSEC_TRIPLE_SCRAMBLED', '3 Consecutive Numbers (Scrambled)', '🔀', 277778, 'Epic', c => consecScrambled(c.s, 3)],
  ['ZIPPER', 'Zipper', '🤐', 246914, 'Epic', c => c.len >= 3 && c.distinct === 2 && [...c.s].every((ch, i) => ch === c.s[i % 2]) && c.s[0] !== c.s[1]],
  ['ASCENSION', 'Ascension', '📈', 219298, 'Epic', c => strictInc(c.d)],
  ['CONSEC_TRIPLE_CONTAINS', '3 Consecutive Numbers (Contains)', '🔗', 157978, 'Epic', c => containsConsec(c.s, 3)],
  ['CONTIGUOUS_THREE_PAIR', 'Contiguous Three Pair', '👨‍👩‍👧‍👦👯', 154321, 'Epic', c => { for (let i = 0; i + 2 < c.runs.length; i++) if (c.runs[i] === 2 && c.runs[i + 1] === 2 && c.runs[i + 2] === 2) return true; return false; }],
  ['FRAMED_PAIR', 'Framed Pair', '🖼️', 137174, 'Epic', c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1]],
  ['FRAMED_TRIPLE', 'Framed Triple', '🖼️🖼️', 137174, 'Epic', c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1]],
  ['DECAY', 'Decay', '📉', 119474, 'Epic', c => strictDec(c.d)],
  ['THREE_DIGITS', 'Three Digits', '🤟', 111111, 'Epic', c => c.len === 3],
  ['ECHO', 'Echo', '📣', 100100, 'Epic', c => c.len >= 4 && c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2)],
  ['MILLENNIUM', 'Millennium', '🗓️', 100000, 'Epic', c => c.s.endsWith('000')],
  ['PRONIC', 'Pronic Number', '🧮', 100000, 'Epic', c => PRONICS.has(c.n)],
  ['TRIPLE_NINE', 'Triple Nine', '🎉', 100000, 'Epic', c => c.s.endsWith('999')],
  ['SEMI_MILLENNIUM', 'Semi-Millennium', '📜', 100000, 'Epic', c => c.s.endsWith('500')],
  ['COLOSSAL', 'Colossal', '🪨', 100000, 'Epic', c => c.n > 999000],
  ['SQUARE', '2nd Power', '🟦', 99900, 'Epic', c => isPerfectPower(c.n, 2)],
  ['EVEN_SPACING_ABS', 'Even Spacing (Absolute)', '📐', 90992, 'Epic', c => absArith(c.d)],
  ['FIREFLY', 'Firefly', '🪲', 82237, 'Epic', c => {
    if (c.len < 3 || c.distinct !== 2) return false;
    const cs = Object.values(c.counts).sort((a, b) => a - b);
    return cs[0] === 1 && cs[1] === c.len - 1;
  }],
  ['CONSEC_PAIR_EXACT', '2 Consecutive Numbers', '🔗', 50505, 'Epic', c => consecAsc(c.s, 2, true)],
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
  ['SEQUENCE_4', 'Sequence (4)', '🔢', 25907, 'Rare', c => seqAsc(c.d, 4)],
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
  ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 6142, 'Uncommon', c => { for (let i = 0; i + 1 < c.runs.length; i++) if (c.runs[i] === 2 && c.runs[i + 1] === 2) return true; return false; }],
  ['MOUNTAIN', 'Mountain', '🏔️', 5885, 'Uncommon', c => mountain(c.d)],
  ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, 'Uncommon', c => { for (let k = 0; k + 4 < c.len; k++) if (c.s[k] === c.s[k + 2] && c.s[k] === c.s[k + 4]) return true; return false; }],
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
    if (c.len < 2) return false;
    const h = Math.floor(c.len / 2);
    let a = 0, b = 0;
    for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[c.len - 1 - i]; }
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
  ['SEQUENCE_3', 'Sequence (3)', '🔢', 1716, 'Uncommon', c => seqAsc(c.d, 3)],
  ['CONSEC_PAIR_ADJACENT', '2 Consecutive Numbers (Contains)', '🔗', 1659, 'Uncommon', c => containsConsec(c.s, 2, true)],
  ['CONSEC_PAIR_NEARBY', '2 Consecutive Numbers (Nearby)', '🔗', 1575, 'Uncommon', c => pairNearby(c.s, true)],
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
  ['HILLS', 'Hills', '🏞️', 733, 'Common', c => hills(c.d)],
  ['TRIPS', 'Three of a Kind', '🎰', 724, 'Common', c => c.maxCount >= 3],
  ['LUCKY_SEVEN_DIV', 'Lucky Seven (Divisible)', '🎰', 700, 'Common', c => c.n > 0 && c.n % 7 === 0],
  ['HETEROGENEOUS', 'Heterogeneous', '🥗', 593, 'Common', c => c.distinct === c.len],
  ['GAP_ONE', 'Gap One', '↕️', 529, 'Common', c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1],
  ['TWO_PAIR', 'Two Pair', '👯‍♀️', 447, 'Common', c => c.countExact(2) >= 2],
  ['HOPSCOTCH', 'Hopscotch', '🦘', 312, 'Common', c => { for (let k = 0; k + 2 < c.len; k++) if (c.s[k] === c.s[k + 2]) return true; return false; }],
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
    for (let i = 0; i < c.len; i++) for (let j = i + 1; j < c.len; j++) if (Math.abs(c.d[i] - c.d[j]) === 1) return true;
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

// Supersession: within each group (ordered highest-tier first), only the highest-tier
// earned badge scores EP. Lower tiers are still displayed as earned but score 0, because
// the higher tier already implies them. Confirmed against prod for the Pair and Pi families.
const SUPERSEDE_GROUPS = [
  ['PI', 'PI_CONTAINS_5', 'PI_CONTAINS_4', 'PI_CONTAINS_3'],
  ['E', 'E_CONTAINS_5', 'E_CONTAINS_4', 'E_CONTAINS_3'],
  ['CONTIGUOUS_PAIR', 'PAIR'],
  ['DEEP_VOID_FIVE', 'DEEP_VOID_FOUR', 'DEEP_VOID_THREE', 'DEEP_VOID'], // contains 00000>0000>000>00
  ['CONTIGUOUS_BOAT', 'BOAT'], // Contiguous Full House supersedes Full House
  ['JACKPOT_SIX', 'JACKPOT_FIVE', 'JACKPOT_FOUR', 'JACKPOT'], // 7s in a row: 6>5>4>3
  // Contiguous run tiers collapse to the highest - but Contiguous Pair is a base badge that
  // always scores (it's never in this group). Confirmed: 407777 keeps Contiguous Pair.
  ['CONTIGUOUS_SIXES', 'CONTIGUOUS_FIVES', 'CONTIGUOUS_QUADS', 'CONTIGUOUS_TRIPS'],
  ['QUADS', 'TRIPS'],      // Four of a Kind supersedes Three of a Kind
  ['MINI_ECHO', 'RHYME'],  // a Mini Echo (adjacent repeat) is a more specific Rhyme
  // Single Digit is displayed but scores 0 - the exact digit badge (Two, Three…) implies it.
  // Confirmed against prod: 2 = 119,610,065 (Single Digit's 10,000,010 is zeroed).
  ['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR', 'DIGIT_FIVE',
    'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE', 'ONE_DIGIT'],
  // Perfect powers are one tier family - only the highest exponent earned scores; the rest
  // display as 0. Confirmed via 0 (a perfect power of every exponent): only one 33,333,367
  // (the 19/17/13th tier) scores, the other 12 power badges are zeroed.
  ['NINETEENTH_POWER', 'SEVENTEENTH_POWER', 'THIRTEENTH_POWER', 'ELEVENTH_POWER', 'TENTH_POWER',
    'NINTH_POWER', 'EIGHTH_POWER', 'SEVENTH_POWER', 'SIXTH_POWER', 'FIFTH_POWER', 'FOURTH_POWER',
    'CUBE', 'SQUARE'],
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
  // Apply tier supersession: keep only the highest earned tier scoring in each group.
  const earnedIds = new Set(earned.map(b => b.id));
  for (const group of SUPERSEDE_GROUPS) {
    const present = group.filter(id => earnedIds.has(id));
    for (const b of earned) if (present.slice(1).includes(b.id)) b.ep = 0; // zero all but the top tier
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

  const supSrc = `const SUPERSEDE_GROUPS = ${JSON.stringify(SUPERSEDE_GROUPS)};`;

  // Lean compute: post-supersession total EP + earned badge indices, no UI metadata.
  const rest = `
const BADGE_META = BADGES.map(b => ({ id: b[0], label: b[1], emoji: b[2], rarity: b[4] }));
const SUP_INDEX = (() => {
  const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
  return SUPERSEDE_GROUPS.map(g => g.map(id => idToIdx.get(id)).filter(i => i !== undefined));
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
    const present = g.filter(i => earnedSet.has(i));
    for (let j = 1; j < present.length; j++) epOf.set(present[j], 0); // zero lower tiers
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
  const LRANGE = { 1: [0, 9], 2: [10, 99], 3: [100, 999], 4: [1000, 9999], 5: [10000, 99999], 6: [100000, 999999] };
  const LSIZE = { 1: 10, 2: 90, 3: 900, 4: 9000, 5: 90000, 6: 900000 };
  async function engine() { if (!E) E = await import(origin + '/engine.js'); return E; }
  function matches(k, badges) {
    const base = k * ROW;
    for (let j = 0; j < badges.length; j++) { const bi = badges[j]; if (!(bits[base + (bi >> 3)] & (1 << (bi & 7)))) return false; }
    return true;
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

      if (m.cmd === 'compute') {
        await engine();
        const stride = Math.max(1, m.stride || 1);
        const lengths = (m.lengths && m.lengths.length ? m.lengths.slice() : [1, 2, 3, 4, 5, 6]).sort((a, b) => a - b);
        lastStride = stride; lastLengths = lengths; lastSampled6 = lengths.includes(6) && stride > 1;
        // Only the 6-digit bucket (900k numbers) is ever sampled - lengths 1..5 total
        // just 100k, so they are always computed exactly. Sampling uses a hash of n,
        // NOT an arithmetic stride: a fixed stride only visits one residue class, which
        // wrecks every badge that depends on n mod d (Even/Odd/Prime/Eleven/last-digit).
        const mix = x => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };
        let cap = 0, domainTrue = 0, domainScan = 0;
        for (const L of lengths) {
          domainTrue += LSIZE[L];
          if (L === 6 && stride > 1) { cap += Math.ceil(LSIZE[6] / stride * 1.15) + 1000; domainScan += Math.ceil(LSIZE[6] / stride); }
          else { cap += LSIZE[L]; domainScan += LSIZE[L]; }
        }
        const B = E.BADGE_META.length;
        ROW = (B + 7) >> 3;                        // bytes of badge bitmask per number
        epArr = new Float64Array(cap);
        lenArr = new Uint8Array(cap);
        idxArr = new Int32Array(cap);
        bits = new Uint8Array(cap * ROW);
        examples = []; for (let i = 0; i < B; i++) examples.push([]);
        let maxEP = 0, k = 0, scanned = 0;
        for (const L of lengths) {
          const lo = LRANGE[L][0], hi = LRANGE[L][1], sample = (L === 6 && stride > 1);
          for (let n = lo; n <= hi; n++) {
            if (sample && (mix(n) % stride) !== 0) continue;
            if (k >= cap) break;
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
            if ((scanned % 25000) === 0) self.postMessage({ type: 'progress', pct: domainScan ? scanned / domainScan : 1 });
          }
        }
        count = k; computedMax = maxEP;
        self.postMessage({ type: 'computed', count, maxEP, stride, lengths, domainTrue, sampled6: lengths.includes(6) && stride > 1 });
        return;
      }

      if (m.cmd === 'filter') {
        const badges = m.badges || [];
        const STEP = 0.25;                         // histogram resolution, in decades (dex)
        const MAXB = 2 + Math.ceil(Math.log10(Math.max(10, computedMax)) / STEP);
        const counts = new Float64Array(MAXB);
        let total = 0, raw = 0, sum = 0, mn = Infinity, mx = 0;
        for (let k = 0; k < count; k++) {
          if (!matches(k, badges)) continue;
          // Each sampled 6-digit number stands in for `lastStride` real numbers, so weight
          // its contribution accordingly - keeps the histogram true to the full 0..999,999.
          const w = (lenArr[k] === 6 && lastStride > 1) ? lastStride : 1;
          const v = epArr[k];
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
        const badges = m.badges || [];
        const CAP = 200000;
        const rows = []; let capped = false;
        for (let k = 0; k < count; k++) {
          if (!matches(k, badges)) continue;
          if (rows.length >= CAP) { capped = true; break; }
          rows.push([idxArr[k], epArr[k]]);
        }
        rows.sort((a, b) => a[0] - b[0]);
        self.postMessage({ type: 'filterRows', rows, capped, stride: lastStride, lengths: lastLengths });
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
  const badgeList = $('an-badge-list'), badgeSearch = $('an-badge-search'), resSel = $('an-res');

  let worker = null, meta = [], computed = false, computing = false;
  let wantStride = Number(resSel.value) || 1, computedStride = 0;
  const selectedBadges = new Set();

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

  // Length filter checkboxes (1..6 digits, all on). Changing the length set changes
  // WHICH numbers are computed (lengths 1..5 are only 100k total, so they cost almost
  // nothing) - so a length change recomputes rather than just re-filtering.
  for (let L = 1; L <= 6; L++) {
    const lab = document.createElement('label');
    lab.innerHTML = '<input type="checkbox" id="an-len-' + L + '" value="' + L + '" checked> ' + L + (L === 1 ? ' digit' : ' digits');
    lenWrap.appendChild(lab);
  }
  lenWrap.addEventListener('change', () => { if (selectedLengths().length) runCompute(); });

  function buildBadgeList(filter) {
    const f = (filter || '').toLowerCase();
    badgeList.innerHTML = '';
    meta.forEach((b, i) => {
      if (f && !(b.label.toLowerCase().includes(f) || b.rarity.toLowerCase().includes(f))) return;
      const lab = document.createElement('label');
      lab.className = 'an-badge';
      lab.innerHTML = '<input type="checkbox" data-bi="' + i + '"' + (selectedBadges.has(i) ? ' checked' : '') +
        '> <span>' + b.emoji + ' ' + esc(b.label) + '</span> <em>' + esc(b.rarity) + '</em>';
      badgeList.appendChild(lab);
    });
  }
  badgeSearch.addEventListener('input', () => buildBadgeList(badgeSearch.value));
  badgeList.addEventListener('change', e => {
    const attr = e.target.getAttribute && e.target.getAttribute('data-bi');
    if (attr === null || attr === undefined) return;
    const i = +attr;
    if (e.target.checked) selectedBadges.add(i); else selectedBadges.delete(i);
    renderSelected();
    scheduleFilter();
  });
  function renderSelected() {
    const sel = $('an-badge-sel');
    if (!selectedBadges.size) { sel.innerHTML = ''; return; }
    sel.innerHTML = 'Matching numbers must earn: ' + [...selectedBadges]
      .map(i => '<span class="an-chip" data-bi="' + i + '">' + meta[i].emoji + ' ' + esc(meta[i].label) + ' &times;</span>').join(' ');
  }
  $('an-badge-sel').addEventListener('click', e => {
    const chip = e.target.closest && e.target.closest('.an-chip');
    if (!chip) return;
    const i = +chip.getAttribute('data-bi');
    selectedBadges.delete(i); renderSelected(); buildBadgeList(badgeSearch.value); scheduleFilter();
  });

  resSel.addEventListener('change', () => { wantStride = Number(resSel.value) || 1; if (computed || computing) runCompute(); });

  btn.addEventListener('click', () => {
    panel.hidden = false;
    if (!worker) worker = makeWorker();
    if (!computed && !computing) runCompute();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('an-export-examples').addEventListener('click', () => { if (computed) worker.postMessage({ cmd: 'exportExamples' }); });
  $('an-export-csv').addEventListener('click', () => { if (computed) worker.postMessage({ cmd: 'exportFilter', badges: [...selectedBadges] }); });

  function setExportEnabled(on) { $('an-export-examples').disabled = !on; $('an-export-csv').disabled = !on; }
  setExportEnabled(false);

  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function runCompute() {
    if (!worker) worker = makeWorker();
    computing = true; computed = false; setExportEnabled(false);
    chartEl.innerHTML = ''; statsEl.innerHTML = '';
    statusEl.textContent = 'Computing… 0%';
    worker.postMessage({ cmd: 'compute', lengths: selectedLengths(), stride: wantStride });
  }

  let filterTimer = null;
  function scheduleFilter() { if (!computed) return; clearTimeout(filterTimer); filterTimer = setTimeout(runFilter, 60); }
  function selectedLengths() { const out = []; for (let L = 1; L <= 6; L++) { const cb = $('an-len-' + L); if (cb && cb.checked) out.push(L); } return out; }
  function runFilter() { worker.postMessage({ cmd: 'filter', badges: [...selectedBadges] }); }

  function computedStatus(m) {
    const lenTxt = m.lengths.length === 6 ? 'all lengths' : 'length ' + m.lengths.join('/');
    let s = 'Analyzed ' + m.domainTrue.toLocaleString() + ' numbers (' + lenTxt + ')';
    if (m.sampled6) s += ' - 6-digit sampled 1 in ' + m.stride + ' (' + m.count.toLocaleString() + ' scanned).';
    else s += ' - every number.';
    return s;
  }

  function onMsg(e) {
    const m = e.data;
    if (m.type === 'meta') { meta = m.badges; buildBadgeList(''); }
    else if (m.type === 'progress') { statusEl.textContent = 'Computing… ' + Math.round(m.pct * 100) + '%'; }
    else if (m.type === 'computed') {
      computing = false; computed = true; computedStride = m.stride; setExportEnabled(true);
      statusEl.textContent = computedStatus(m);
      runFilter();
    }
    else if (m.type === 'histogram') { renderChart(m.buckets, m.stats); }
    else if (m.type === 'examples') { exportExamplesFile(m); }
    else if (m.type === 'filterRows') { exportCsvFile(m); }
    else if (m.type === 'error') { statusEl.textContent = 'Error: ' + m.message; computing = false; }
  }

  function exportExamplesFile(m) {
    const lines = [];
    lines.push('# RNGdle - example numbers for each badge');
    lines.push('# Columns: number, totalEP   (up to ' + (m.badges[0] ? Math.max(...m.badges.map(b => b.items.length)) : 0) + ' examples per badge)');
    lines.push('# Drawn from: ' + (m.lengths.length === 6 ? 'all lengths' : 'length ' + m.lengths.join('/')) +
      (m.stride > 1 ? ', 6-digit sampled 1 in ' + m.stride + ' (some rare badges may have few/no examples - use Full resolution for complete coverage)' : ', every number'));
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
    const head = ['number,totalEP'];
    const body = m.rows.map(r => r[0] + ',' + Math.round(r[1]));
    const note = m.capped ? '\n# (truncated to ' + m.rows.length.toLocaleString() + ' rows)' : '';
    const fname = 'rngdle-' + (picked.length ? picked.join('+').replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'numbers') + '.csv';
    download(fname, '# ' + (picked.length ? 'numbers earning: ' + picked.join(' + ') : 'all analyzed numbers') +
      (m.stride > 1 ? ' (6-digit numbers are a 1-in-' + m.stride + ' sample)' : '') + note + '\n' + head.concat(body).join('\n'), 'text/csv');
  }

  function renderChart(buckets, stats) {
    if (!stats.total) {
      chartEl.innerHTML = '<p class="an-empty">No numbers match these filters.</p>';
      statsEl.innerHTML = '';
      return;
    }
    let last = 0;
    for (let i = 0; i < buckets.length; i++) if (buckets[i].count > 0) last = i;
    const bs = buckets.slice(0, last + 1);
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
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#23262f"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" fill="#868e96" font-size="10" text-anchor="end">' + fmt(p) + '</text>';
    }
    // bars
    const tickEvery = Math.ceil(nb / 16);
    bs.forEach((b, i) => {
      const x = padL + i * bw, y = yOf(b.count), h = padT + plotH - y;
      const label = b.i === 0 ? '0 EP' : fmt(b.lo) + '–' + fmt(b.hi) + ' EP';
      const pct = (b.count / stats.total * 100);
      const fill = b.i === 0 ? '#5c636a' : '#4895ef';
      svg += '<rect x="' + (x + 1).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0, bw - 2).toFixed(1) +
        '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + fill + '" rx="1">' +
        '<title>' + esc(label) + ': ' + Math.round(b.count).toLocaleString() + ' numbers (' + pct.toFixed(pct < 1 ? 2 : 1) + '%)</title></rect>';
      if (i % tickEvery === 0) {
        const lx = x + bw / 2, ly = padT + plotH + 12;
        const lab = b.i === 0 ? '0' : fmt(b.lo);
        svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#868e96" font-size="10" text-anchor="end" transform="rotate(-45 ' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ')">' + lab + '</text>';
      }
    });
    svg += '<text x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" fill="#adb5bd" font-size="11" text-anchor="middle">Total EP (log scale) - bar height = count (log scale)</text>';
    svg += '</svg>';
    chartEl.innerHTML = svg;

    statsEl.innerHTML =
      stat('Matching', (stats.estimated ? '≈' : '') + stats.total.toLocaleString()) +
      stat('Mean EP', Math.round(stats.mean).toLocaleString()) +
      stat('Min EP', Math.round(stats.min).toLocaleString()) +
      stat('Max EP', Math.round(stats.max).toLocaleString()) +
      (stats.estimated ? '<p class="an-note">≈ counts scaled to the full 0–999,999 range from the 6-digit sample (' + stats.raw.toLocaleString() + ' numbers actually scanned).</p>' : '');
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

// RNGdle Discord invite - where users should report discrepancies (warning banner).
const DISCORD_URL = 'https://discord.gg/kdD2P2xFY5';

// Escape text for safe insertion into HTML (attribute values and text content).
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Pick black or white text for legibility on a given hex background.
function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#11131a';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  // Relative luminance (sRGB-ish); bright backgrounds get dark text.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#11131a' : '#fff';
}

function parseN(raw) {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return NaN;
  const n = parseInt(raw.trim(), 10);
  if (n < 0 || n > 999999) return NaN;
  return n;
}

function renderHTML(result, raw) {
  let body = '';
  if (result) {
    const rows = result.badges.map(b => {
      const color = RARITY_COLORS[b.rarity] || '#888';
      const req = b.desc || 'No description.';
      const stat = `${b.rarity} · ${fmtProb(b.prob)} of all numbers earn this`;
      const tip = esc(`${req}\n${stat}`);
      return `<tr>
         <td class="emoji">${b.emoji}</td>
         <td><span class="badge-pill" style="background:${color};color:${textColorFor(color)}"
                   tabindex="0" data-tip="${tip}" aria-label="${esc(b.label)}. ${tip}">${esc(b.label)}</span></td>
         <td class="ep">${b.ep.toLocaleString()}</td>
       </tr>`;
    }).join('');
    body = `
      <div class="result">
        <div class="summary">
          <div class="big">${result.totalEP.toLocaleString()} <span>EP</span></div>
          <div class="sub">${result.count} badge${result.count === 1 ? '' : 's'} for <strong>${result.number.toLocaleString()}</strong></div>
        </div>
        <table>
          <thead><tr><th></th><th>Badge</th><th>EP</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" class="none">No badges</td></tr>'}</tbody>
        </table>
      </div>`;
  } else if (raw !== null && raw !== undefined && raw !== '') {
    body = `<p class="error">Please enter a whole number from 0 to 999,999.</p>`;
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RNGdle EP Calculator</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#11131a; color:#e9ecef; margin:0; padding:2rem 1rem; }
  .wrap { max-width:760px; margin:0 auto; }
  .warn { background:#2a210f; border:1px solid #6b4e16; border-left:4px solid #ffb703; color:#ffe2a8;
    padding:.85rem 1.05rem; border-radius:10px; margin:0 0 1.5rem; font-size:.92rem; line-height:1.55; }
  .warn strong { color:#ffd166; }
  .warn a { color:#ffd166; font-weight:700; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  p.tag { color:#868e96; margin:0 0 1.5rem; }
  form { display:flex; gap:.5rem; margin-bottom:1.5rem; }
  input { flex:1; font-size:1.4rem; padding:.6rem .8rem; border-radius:10px; border:1px solid #2b2f3a; background:#1a1d27; color:#fff; }
  button { font-size:1.1rem; padding:.6rem 1.4rem; border:0; border-radius:10px; background:#4895ef; color:#fff; cursor:pointer; font-weight:600; }
  button:hover { background:#5aa0f2; }
  .summary { text-align:center; margin-bottom:1.25rem; }
  .big { font-size:3rem; font-weight:800; color:#ffd166; }
  .big span { font-size:1.2rem; color:#868e96; }
  .sub { color:#adb5bd; }
  table { width:100%; border-collapse:collapse; background:#1a1d27; border-radius:12px; overflow:visible; }
  th,td { text-align:left; padding:.55rem .8rem; border-bottom:1px solid #23262f; }
  th { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:#868e96; }
  td.emoji { font-size:1.3rem; width:2.2rem; }
  td.ep { text-align:right; font-variant-numeric:tabular-nums; font-weight:600; color:#ffd166; }
  .badge-pill { position:relative; display:inline-block; padding:.18rem .6rem; border-radius:999px;
    font-size:.85rem; font-weight:700; cursor:help; outline:none; }
  /* Hover/focus tooltip: requirement on line 1, rarity + probability on line 2. */
  .badge-pill::after, .badge-pill::before { opacity:0; pointer-events:none; transition:opacity .12s; position:absolute; z-index:10; }
  .badge-pill::after {
    content:attr(data-tip); white-space:pre-line; left:0; bottom:calc(100% + 8px);
    min-width:14rem; max-width:20rem; padding:.5rem .65rem; border-radius:8px;
    background:#0a0c12; color:#e9ecef; border:1px solid #2b2f3a; box-shadow:0 6px 20px rgba(0,0,0,.5);
    font-size:.78rem; font-weight:500; line-height:1.35; text-align:left; }
  .badge-pill::before {
    content:""; left:1rem; bottom:calc(100% + 2px); border:6px solid transparent; border-top-color:#0a0c12; }
  .badge-pill:hover::after, .badge-pill:hover::before,
  .badge-pill:focus::after, .badge-pill:focus::before { opacity:1; }
  .none { text-align:center; color:#868e96; }
  .error { color:#ff6b6b; }
  footer { margin-top:2rem; color:#5c636a; font-size:.8rem; text-align:center; }
  a { color:#4895ef; }

  /* --- Analysis panel --- */
  .an-bar { display:flex; justify-content:center; margin:-.5rem 0 1.5rem; }
  #an-btn { background:#2b2f3a; }
  #an-btn:hover { background:#3a3f4d; }
  #analysis { background:#1a1d27; border:1px solid #23262f; border-radius:12px; padding:1rem 1.1rem 1.25rem; margin-bottom:1.5rem; }
  #analysis h2 { font-size:1.1rem; margin:.1rem 0 .9rem; }
  .an-controls { display:flex; flex-wrap:wrap; gap:1rem; margin-bottom:.9rem; }
  .an-controls fieldset { border:1px solid #2b2f3a; border-radius:10px; padding:.5rem .7rem .65rem; margin:0; min-width:200px; flex:1; }
  .an-controls legend { color:#868e96; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; padding:0 .3rem; }
  #an-lengths { display:flex; flex-wrap:wrap; gap:.35rem .9rem; }
  #an-lengths label, .an-badge { display:flex; align-items:center; gap:.35rem; font-size:.85rem; cursor:pointer; }
  #an-badge-search { width:100%; font-size:.85rem; padding:.35rem .5rem; border-radius:8px; border:1px solid #2b2f3a; background:#11131a; color:#fff; margin-bottom:.4rem; }
  .an-badge-list { max-height:150px; overflow:auto; display:flex; flex-direction:column; gap:.15rem; padding-right:.3rem; }
  .an-badge { justify-content:flex-start; padding:.1rem .15rem; border-radius:6px; }
  .an-badge:hover { background:#23262f; }
  .an-badge span { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .an-badge em { color:#5c636a; font-style:normal; font-size:.72rem; }
  .an-badge-sel { margin-top:.5rem; font-size:.78rem; color:#868e96; line-height:1.8; }
  .an-chip { display:inline-block; background:#2b2f3a; color:#cdd3da; padding:.1rem .45rem; border-radius:999px; cursor:pointer; }
  .an-chip:hover { background:#3a3f4d; color:#fff; }
  .an-res { font-size:.85rem; padding:.35rem .5rem; border-radius:8px; border:1px solid #2b2f3a; background:#11131a; color:#fff; }
  #an-status { color:#adb5bd; font-size:.85rem; min-height:1.2em; margin:.2rem 0 .6rem; }
  #an-chart svg { background:#11131a; border-radius:10px; }
  .an-empty { color:#868e96; text-align:center; padding:1.5rem; }
  #an-stats { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:.8rem; }
  .an-stat { background:#11131a; border:1px solid #23262f; border-radius:10px; padding:.45rem .7rem; flex:1; min-width:110px; text-align:center; }
  .an-stat span { display:block; color:#868e96; font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; }
  .an-stat strong { color:#ffd166; font-size:1.1rem; font-variant-numeric:tabular-nums; }
  .an-note { flex-basis:100%; color:#868e96; font-size:.75rem; margin:.2rem 0 0; }
  .an-actions { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:1rem; }
  .an-actions button { background:#2b2f3a; font-size:.9rem; padding:.5rem 1rem; }
  .an-actions button:hover { background:#3a3f4d; }
  .an-actions button:disabled { opacity:.4; cursor:not-allowed; }
</style></head>
<body><div class="wrap">
  <div class="warn" role="alert">
    ⚠️ <strong>Heads up - this is full of assumptions.</strong> Many RNGdle badge rules are
    ambiguous, so a lot of this calculator is my best guess and <em>may not match the live game</em>.
    Spotted a number that scores differently in-game? <a href="${esc(DISCORD_URL)}" target="_blank" rel="noopener">Ping me in the RNGdle Discord</a>
    - and please include a <strong>link to the prod result</strong> so I can verify and fix it.
  </div>
  <h1>🎲 RNGdle EP Calculator</h1>
  <p class="tag">Enter a number from 0 to 999,999 to see its total EP and badges.</p>
  <form method="GET" action="/">
    <input type="number" name="n" min="0" max="999999" step="1" placeholder="e.g. 696969"
           value="${raw !== null && raw !== undefined ? String(raw).replace(/"/g, '') : ''}" autofocus>
    <button type="submit">Calculate</button>
  </form>
  ${body}

  <div class="an-bar"><button type="button" id="an-btn">📊 Analyze all scores</button></div>

  <section id="analysis" hidden>
    <h2>EP distribution across 0–999,999</h2>
    <div class="an-controls">
      <fieldset>
        <legend>Number length</legend>
        <div id="an-lengths"></div>
      </fieldset>
      <fieldset>
        <legend>Badges (match all selected)</legend>
        <input id="an-badge-search" type="text" placeholder="filter badges…" autocomplete="off">
        <div id="an-badge-list" class="an-badge-list"></div>
        <div id="an-badge-sel" class="an-badge-sel"></div>
      </fieldset>
      <fieldset style="flex:0 0 auto; min-width:0;">
        <legend>Resolution</legend>
        <select id="an-res" class="an-res">
          <option value="1">Full · all 1,000,000 (slow)</option>
          <option value="5">Sampled · ~1 in 5</option>
          <option value="10" selected>Sampled · ~1 in 10 (rough)</option>
          <option value="50">Sampled · ~1 in 50 (fast)</option>
        </select>
      </fieldset>
    </div>
    <div id="an-status"></div>
    <div id="an-chart"></div>
    <div id="an-stats"></div>
    <div class="an-actions">
      <button type="button" id="an-export-csv">⬇ Matching numbers (.csv)</button>
      <button type="button" id="an-export-examples">⬇ Examples per badge (.txt)</button>
    </div>
  </section>

  <footer>JSON API: <code>/api?n=696969</code></footer>
</div>
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
        return new Response(JSON.stringify({ error: 'Provide n as an integer from 0 to 999999.' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(compute(n)), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      const n = parseN(raw);
      const result = (n !== null && !Number.isNaN(n)) ? compute(n) : null;
      return new Response(renderHTML(result, raw), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

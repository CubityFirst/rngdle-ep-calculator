// Full parity: the engine in src/index.js against rngdle's own scorer, replayed from a
// saved bundle, on every number 0..1,000,000 - total EP, the set of badges that score
// after family supersession, and the set of badges earned at all.
//
//   node tools/parity.cjs                    against the newest research/rngdle-<date>
//   node tools/parity.cjs --bundle <file>    against a particular one
//   node tools/parity.cjs --quick            every 97th number (~1 s) instead of all
//
// Exit 1 on any mismatch, with the first few numbers and which side has what. EP alone
// is not enough: two different badge sets can add to the same total, so the scoring set
// is what pins a rule down, and the earned set catches a badge that is superseded in
// both (invisible in EP) but wrongly earned in one.
const path = require("path");
const { pathToFileURL } = require("url");
const { loadBundle, latestBundle } = require("./prod-bundle.cjs");

const args = process.argv.slice(2);
const i = args.indexOf("--bundle");
const file = i >= 0 ? path.resolve(args[i + 1]) : latestBundle();
const step = args.includes("--quick") ? 97 : 1;

(async () => {
  globalThis.__name = globalThis.__name || (f => f);
  const { compute } = await import(pathToFileURL(path.join(__dirname, "..", "src", "index.js")).href);
  const prod = loadBundle(file);
  console.log(`src/index.js vs ${path.basename(prod.file)} (${prod.DEFS.length} badges), step ${step}`);

  const key = a => [...a].sort().join();
  let n_ = 0, ep = 0, scoring = 0, earned = 0, shown = 0;
  const t0 = Date.now();
  for (let n = 0; n <= 1000000; n += step) {
    n_++;
    const a = compute(n), p = prod.score(n);
    const aScoring = a.badges.filter(b => b.ep > 0).map(b => b.id), aEarned = a.badges.map(b => b.id);
    const epOk = a.totalEP === p.totalScore;
    const sOk = key(aScoring) === key(p.scoringIds);
    const eOk = key(aEarned) === key(p.earned);
    if (!epOk) ep++;
    if (!sOk) scoring++;
    if (!eOk) earned++;
    if ((!epOk || !sOk || !eOk) && shown++ < 15) {
      const only = (x, y) => x.filter(v => !y.has(v)).join(",") || "-";
      const pS = p.scoringIds, pE = new Set(p.earned), aS = new Set(aScoring), aE = new Set(aEarned);
      console.log(`  ${String(n).padStart(7)}  EP ours ${a.totalEP} prod ${p.totalScore}` +
        `  scoring ours-only [${only(aScoring, pS)}] prod-only [${only([...pS], aS)}]` +
        `  earned ours-only [${only(aEarned, pE)}] prod-only [${only(p.earned, aE)}]`);
    }
  }
  console.log(`${n_.toLocaleString("en-GB")} numbers in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`  EP mismatches          : ${ep}`);
  console.log(`  scoring-set mismatches : ${scoring}`);
  console.log(`  earned-set mismatches  : ${earned}`);
  process.exit(ep || scoring || earned ? 1 : 0);
})().catch(e => { console.error(e.message || e); process.exit(1); });

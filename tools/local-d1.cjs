// Run SQL files against the local D1 that `cf dev` serves as env.DB.
//
//   node tools/local-d1.cjs schema.sql                         # npm run db:local
//   node tools/local-d1.cjs --persist-to <dir> schema.sql seed.sql
//
// The Worker config is cloudflare.config.ts, and `npx wrangler d1 execute --local` only
// finds a database through a wrangler.toml binding (the remote form, `--remote`, looks the
// database up by name and still works). `cf d1 query --local` has no local backend yet.
// So this opens the same Miniflare D1 that cf dev / wrangler dev persist under
// <dir>/v3/d1 (default .wrangler/state), keyed by the database id read out of
// cloudflare.config.ts, and runs each file in it. Stop `cf dev` first if a write seems
// not to land - both hold the SQLite file open.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const REPO = path.resolve(__dirname, "..");

// Split a .sql file into statements on the semicolons that are not inside a string,
// a quoted identifier or a comment. Comments are dropped. (No CREATE TRIGGER bodies
// here, so BEGIN ... END needs no special case.)
function splitSql(text) {
  const out = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      cur += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) i = text.length;
      else i++;
      cur += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      // SQLite escapes a quote by doubling it, which this loop handles by closing and
      // immediately reopening the literal.
      let j = i + 1;
      while (j < text.length && text[j] !== c) j++;
      cur += text.slice(i, j + 1);
      i = j;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let persistTo = path.join(REPO, ".wrangler", "state");
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--persist-to") persistTo = path.resolve(args[++i]);
    else if (args[i].startsWith("--persist-to=")) persistTo = path.resolve(args[i].slice(13));
    else files.push(path.resolve(args[i]));
  }
  if (!files.length) {
    console.error("usage: node tools/local-d1.cjs [--persist-to <dir>] <file.sql>...");
    process.exit(2);
  }

  const cfg = fs.readFileSync(path.join(REPO, "cloudflare.config.ts"), "utf8");
  const m = /\bDB:\s*bindings\.d1\(\{[^}]*\bid:\s*"([^"]+)"/.exec(cfg);
  if (!m) throw new Error("cloudflare.config.ts has no DB: bindings.d1({ id }) binding");

  // The Miniflare cf dev runs on is wrangler's own copy (cf dev hands off to wrangler's
  // dev server), so load that one, and build it the way `wrangler d1 execute --local`
  // does - same options, same storage layout - so both see one database.
  const fromWrangler = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = fromWrangler("miniflare");
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "",
    resourcePersistencePath: path.join(persistTo, "v3"),
    d1Databases: { DATABASE: m[1] },
  }));
  try {
    const db = await mf.getD1Database("DATABASE");
    for (const file of files) {
      const sql = splitSql(fs.readFileSync(file, "utf8"));
      // One batch per file, as wrangler does: a file applies whole or not at all.
      await db.batch(sql.map((stmt) => db.prepare(stmt)));
      console.log(`ok  ${path.relative(REPO, file) || file}: ${sql.length} statements -> ${path.relative(REPO, persistTo) || persistTo}`);
    }
  } finally {
    await mf.dispose();
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});

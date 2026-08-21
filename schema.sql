-- D1 schema for the Box Lab palette gallery (/beta/boxes).
--
-- Apply it with:
--   npx wrangler d1 execute rngdle --file=schema.sql --local    # the local wrangler dev db
--   npx wrangler d1 execute rngdle --file=schema.sql --remote   # the real database
--
-- Everything here is IF NOT EXISTS, so re-running is safe - which is also how an index
-- added here reaches an existing database: re-apply the file, it is the migration.
-- `node serve.mjs` passes no bindings at all, so the gallery is simply 503 there - use
-- `npx wrangler dev` to work on it.
--
-- Every index below exists because some query would otherwise scan a whole table, and
-- D1 bills rows read. The comment on each names the query it is for; if that query
-- changes shape, check the plan again (EXPLAIN QUERY PLAN) rather than assuming.

CREATE TABLE IF NOT EXISTS palettes (
  id          TEXT    PRIMARY KEY,          -- short opaque id, also the share URL
  name        TEXT    NOT NULL,             -- what the author calls this palette
  author      TEXT    NOT NULL DEFAULT '',  -- optional display name
  note        TEXT    NOT NULL DEFAULT '',  -- optional one-line pitch
  tiers       TEXT    NOT NULL,             -- JSON [{word,hex,lo}], validated before insert
  tier_count  INTEGER NOT NULL,
  created     INTEGER NOT NULL,             -- epoch ms
  author_key  TEXT    NOT NULL,             -- salted hash of the submitter's IP, never the IP
  likes       INTEGER NOT NULL DEFAULT 0,   -- denormalised count of palette_likes
  hidden      INTEGER NOT NULL DEFAULT 0    -- moderation tombstone; hidden, never deleted
);

-- The three orderings the gallery offers. hidden leads all of them so the filter is
-- covered and each one can be walked in order rather than sorted.
CREATE INDEX IF NOT EXISTS palettes_new  ON palettes (hidden, created DESC);
CREATE INDEX IF NOT EXISTS palettes_top  ON palettes (hidden, likes DESC, created DESC);

-- `hot`, the default. This is an index on an expression, and SQLite will only use it
-- when the ORDER BY spells that expression the same way character for character - so
-- it has to stay in step with HOT_RANK in src/gallery.js, where the 3.0 is HEART_DAYS.
-- Changing HEART_DAYS means changing this line and re-applying the file, or the
-- default sort silently goes back to reading every visible row and sorting it.
--
-- The rank the Worker orders by was once `likes * 3.0 + (created - now) / 86400000.0`.
-- `now` is the same value for every row in one query, so subtracting it shifts them all
-- equally and cannot change the order - and dropping it is what leaves an expression of
-- columns alone, which is the only kind an index can hold.
CREATE INDEX IF NOT EXISTS palettes_hot  ON palettes
  (hidden, (likes * 3.0 + created / 86400000.0) DESC, created DESC);

-- Rate limiting reads (author_key, created); the publish-dedupe check reads the same
-- pair and filters tiers off the row.
CREATE INDEX IF NOT EXISTS palettes_rate ON palettes (author_key, created);

-- One row per (palette, voter). The PK is the dedupe: a second like from the same
-- voter is a primary-key conflict, not a second vote.
CREATE TABLE IF NOT EXISTS palette_likes (
  palette_id TEXT    NOT NULL,
  voter_key  TEXT    NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (palette_id, voter_key)
);

-- The PK covers "has this voter hearted this palette", which is the toggle. It cannot
-- cover "everything this voter has hearted" - voter_key is its second column - and
-- that is the query every Box Lab page load makes to draw its own hearts as filled.
-- Without this index that lookup scans the whole table on every page view.
CREATE INDEX IF NOT EXISTS palette_likes_voter ON palette_likes (voter_key, palette_id);

-- Every heart and un-heart, one row per action. palette_likes holds only the current
-- state, so it cannot answer "how many times has this caller hearted in the last
-- hour" - a toggle loop leaves no trace there. This table is that trace, and it is
-- what the per-IP heart rate limit counts.
--
-- Rows here are transient: gallery.js deletes anything older than the rate-limit
-- window on every write, so the table holds about an hour of activity and no more.
-- Nothing reads it beyond that window, and a spent row is a stored identifier doing
-- no work.
CREATE TABLE IF NOT EXISTS like_events (
  voter_key TEXT    NOT NULL,
  created   INTEGER NOT NULL
);
-- Counting one caller's recent hearts.
CREATE INDEX IF NOT EXISTS like_events_rate    ON like_events (voter_key, created);
-- The prune filters on created alone, which the index above leads with voter_key and
-- so cannot serve. Without this one, every heart scans the whole table to delete the
-- handful of expired rows it is actually after.
CREATE INDEX IF NOT EXISTS like_events_created ON like_events (created);

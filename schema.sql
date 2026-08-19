-- D1 schema for the Box Lab palette gallery (/beta/boxes).
--
-- Apply it with:
--   npx wrangler d1 execute rngdle --file=schema.sql --local    # the local wrangler dev db
--   npx wrangler d1 execute rngdle --file=schema.sql --remote   # the real database
--
-- Everything here is IF NOT EXISTS, so re-running is safe. `node serve.mjs` passes no
-- bindings at all, so the gallery is simply 503 there - use `npx wrangler dev` to work
-- on it.

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

-- The two orderings the gallery offers. hidden leads both so the filter is covered.
CREATE INDEX IF NOT EXISTS palettes_new  ON palettes (hidden, created DESC);
CREATE INDEX IF NOT EXISTS palettes_top  ON palettes (hidden, likes DESC, created DESC);
-- Rate limiting reads (author_key, created) and nothing else.
CREATE INDEX IF NOT EXISTS palettes_rate ON palettes (author_key, created);

-- One row per (palette, voter). The PK is the dedupe: a second like from the same
-- voter is a primary-key conflict, not a second vote.
CREATE TABLE IF NOT EXISTS palette_likes (
  palette_id TEXT    NOT NULL,
  voter_key  TEXT    NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (palette_id, voter_key)
);

-- Every heart and un-heart, one row per action. palette_likes holds only the current
-- state, so it cannot answer "how many times has this caller hearted in the last
-- hour" - a toggle loop leaves no trace there. This table is that trace, and it is
-- what the per-IP heart rate limit counts.
CREATE TABLE IF NOT EXISTS like_events (
  voter_key TEXT    NOT NULL,
  created   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS like_events_rate ON like_events (voter_key, created);

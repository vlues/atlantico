-- Signed-in browsers: the passcode is typed once per device and swapped for a long-lived session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,   -- sha-256 of the session token; the token itself lives only in that browser
  label TEXT NOT NULL,           -- "iPhone · Safari"
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);

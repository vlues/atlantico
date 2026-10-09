-- Songs guests add from their phone; the wall and lamps mark them when they play.
CREATE TABLE IF NOT EXISTS song_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  uri TEXT NOT NULL,              -- spotify:track:…
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  played_at INTEGER
);
CREATE INDEX IF NOT EXISTS song_requests_recent ON song_requests (queued_at);

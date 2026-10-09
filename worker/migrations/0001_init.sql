-- Atlántico schema. Times are unix milliseconds.
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,           -- random; seeds the star dot position
  first_name TEXT NOT NULL,
  delete_token TEXT NOT NULL,    -- given only to the guest, lets them remove the entry
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- panel | plant | lights
  name TEXT NOT NULL,
  token_hash TEXT,               -- sha-256 of the device token; null for simulated
  simulated INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  device_id TEXT,
  rules TEXT NOT NULL,           -- JSON: moisture thresholds, dose, temps, min interval
  last_check TEXT,               -- latest one-line note from the daily Claude check
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id TEXT NOT NULL,
  device_id TEXT,
  ts INTEGER NOT NULL,
  moisture REAL,                 -- % volumetric-ish, 0-100
  temp REAL,                     -- °C
  reservoir REAL                 -- % full
);
CREATE INDEX IF NOT EXISTS readings_plant_ts ON readings (plant_id, ts);

CREATE TABLE IF NOT EXISTS waterings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ml INTEGER NOT NULL,
  source TEXT NOT NULL           -- rule | owner | local-fallback | simulator
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- plant | device | system
  subject TEXT,
  message TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

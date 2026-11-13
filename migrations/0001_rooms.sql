CREATE TABLE rooms (
  code TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rooms_expiry ON rooms(expires_at);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);

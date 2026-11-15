CREATE TABLE passkey_accounts (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, subject TEXT NOT NULL, handle TEXT NOT NULL,
  name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  PRIMARY KEY(school_id,owner_id), UNIQUE(school_id,handle),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY, school_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, created_at INTEGER NOT NULL,
  FOREIGN KEY(school_id,owner_id) REFERENCES passkey_accounts(school_id,owner_id)
);
CREATE INDEX passkey_credentials_owner ON passkey_credentials(school_id,owner_id);
CREATE TABLE passkey_flows (
  browser_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX passkey_flows_expiry ON passkey_flows(expires_at);

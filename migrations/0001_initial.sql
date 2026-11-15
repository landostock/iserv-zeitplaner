PRAGMA foreign_keys = ON;
CREATE TABLE users (
  school_id TEXT NOT NULL, id TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY(school_id,id), UNIQUE(school_id,subject)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, school_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL,
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
  nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE connections (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(school_id,owner_id),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE TABLE jobs (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preparing','scheduled','publishing','retry_wait','reconciling','published','cancelled','conflict','needs_auth','needs_review','failed')),
  due_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER, operation_started_at INTEGER,
  confirmed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  error_code TEXT, staging_etag TEXT,
  PRIMARY KEY(school_id,owner_id,id), UNIQUE(school_id,owner_id,idempotency_key),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE INDEX jobs_due ON jobs(status,next_attempt_at);
CREATE INDEX jobs_leases ON jobs(status,lease_until);
CREATE INDEX jobs_owner ON jobs(school_id,owner_id,created_at);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY, school_id TEXT NOT NULL, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
  phase TEXT NOT NULL, at INTEGER NOT NULL, code TEXT,
  FOREIGN KEY(school_id,owner_id,job_id) REFERENCES jobs(school_id,owner_id,id)
);
CREATE INDEX attempts_job ON attempts(school_id,owner_id,job_id,at);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, school_id TEXT NOT NULL, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
  revision INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
  read_at INTEGER, UNIQUE(school_id,owner_id,job_id,revision,kind),
  FOREIGN KEY(school_id,owner_id,job_id) REFERENCES jobs(school_id,owner_id,id)
);
CREATE TABLE system_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Local demonstration only. Never stores real IServ files or credentials.
CREATE TABLE demo_files (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, path TEXT NOT NULL,
  kind TEXT NOT NULL, writable INTEGER NOT NULL DEFAULT 1,
  content TEXT, etag TEXT, PRIMARY KEY(school_id,owner_id,path)
);

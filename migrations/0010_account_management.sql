ALTER TABLE passkey_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE passkey_accounts ADD COLUMN deleted_at INTEGER;
ALTER TABLE passkey_credentials ADD COLUMN label TEXT NOT NULL DEFAULT 'Passkey';
ALTER TABLE passkey_credentials ADD COLUMN last_used_at INTEGER;
ALTER TABLE sessions ADD COLUMN created_at INTEGER;
ALTER TABLE sessions ADD COLUMN credential_id TEXT;
-- The existing personal pilot can have exactly one bootstrap account. Never guess among multiple accounts.
UPDATE passkey_accounts SET role='admin' WHERE (SELECT COUNT(*) FROM passkey_accounts)=1;
CREATE TABLE account_invitations (
 token_hash TEXT PRIMARY KEY, school_id TEXT NOT NULL, created_by TEXT NOT NULL,
 label TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX invitations_school_expiry ON account_invitations(school_id,expires_at);
CREATE TABLE account_recovery (
 school_id TEXT NOT NULL, owner_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, PRIMARY KEY(school_id,owner_id)
);
CREATE TABLE account_erasure (
 school_id TEXT NOT NULL, owner_id TEXT NOT NULL, requested_at INTEGER NOT NULL,
 finished_at INTEGER, PRIMARY KEY(school_id,owner_id)
);

ALTER TABLE jobs ADD COLUMN operation_phase TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN last_accepted_at INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN last_http INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN last_error TEXT;
CREATE TABLE original_name_proofs (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, connection_binding TEXT NOT NULL,
  folder_hash TEXT NOT NULL, verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, proof TEXT NOT NULL,
  PRIMARY KEY(school_id,owner_id,connection_binding,folder_hash),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE INDEX original_name_proofs_expiry ON original_name_proofs(school_id,expires_at);

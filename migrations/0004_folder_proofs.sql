CREATE TABLE folder_proofs (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, connection_binding TEXT NOT NULL,
  folder_hash TEXT NOT NULL, verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, proof TEXT NOT NULL,
  PRIMARY KEY(school_id,owner_id,connection_binding,folder_hash),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE INDEX folder_proofs_expiry ON folder_proofs(expires_at);

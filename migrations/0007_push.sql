CREATE TABLE push_subscriptions (
  school_id TEXT NOT NULL, owner_id TEXT NOT NULL, id TEXT NOT NULL,
  subscription TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_event TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0, delivery_failed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(school_id,owner_id,id),
  FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE INDEX notifications_owner_unread ON notifications(school_id,owner_id,read_at,kind,created_at);
CREATE INDEX jobs_owner_due ON jobs(school_id,owner_id,status,due_at);

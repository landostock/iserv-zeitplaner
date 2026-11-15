ALTER TABLE jobs ADD COLUMN replacement_key TEXT;
ALTER TABLE jobs ADD COLUMN manual_read_only INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX jobs_active_replacement ON jobs(school_id,owner_id,replacement_key) WHERE replacement_key IS NOT NULL AND status IN ('preparing','scheduled','publishing','retry_wait','reconciling','needs_auth','needs_review');

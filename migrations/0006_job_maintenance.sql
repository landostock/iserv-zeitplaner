CREATE INDEX jobs_source_cleanup ON jobs(school_id,source_cleaned_at,status,updated_at);
CREATE INDEX jobs_history_cleanup ON jobs(school_id,updated_at);

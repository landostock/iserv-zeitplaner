ALTER TABLE connections ADD COLUMN credential_kind TEXT;
ALTER TABLE connections ADD COLUMN discard_after INTEGER;
CREATE INDEX connections_retention ON connections(credential_kind,discard_after);

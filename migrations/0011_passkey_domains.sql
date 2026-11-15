-- Existing credentials keep their original RP binding; NULL means the stable identity domain.
ALTER TABLE passkey_credentials ADD COLUMN rp_id TEXT;
ALTER TABLE passkey_credentials ADD COLUMN last_login_at INTEGER;
CREATE INDEX passkey_credentials_domain ON passkey_credentials(school_id,owner_id,rp_id);

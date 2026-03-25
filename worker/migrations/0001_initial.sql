-- Payer Mapping Tool - D1 Schema
-- Initial migration

-- Admin configuration (single row for admin passphrase)
CREATE TABLE IF NOT EXISTS admin_config (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    passphrase_hash TEXT NOT NULL,
    updated_at      INTEGER DEFAULT (unixepoch()),
    CHECK (id = 1)
);

-- Client accounts
CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passphrase_hash TEXT NOT NULL,
    created_at      INTEGER DEFAULT (unixepoch()),
    last_updated    INTEGER DEFAULT (unixepoch())
);

-- Payer mappings (normalized from the Firestore JSON blob)
CREATE TABLE IF NOT EXISTS payer_mappings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id           INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    state_name          TEXT NOT NULL,
    plan_name           TEXT NOT NULL,
    availity_payer_id   TEXT,
    availity_payer_name TEXT,
    updated_at          INTEGER DEFAULT (unixepoch()),
    UNIQUE(client_id, state_name, plan_name)
);

CREATE INDEX IF NOT EXISTS idx_mappings_client ON payer_mappings(client_id);
CREATE INDEX IF NOT EXISTS idx_mappings_client_state ON payer_mappings(client_id, state_name);

-- Availity reference payer data (seeded from availity_payers.xlsx)
CREATE TABLE IF NOT EXISTS availity_payers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    state_name TEXT NOT NULL,
    payer_name TEXT NOT NULL,
    payer_id   TEXT NOT NULL,
    UNIQUE(state_name, payer_id)
);

CREATE INDEX IF NOT EXISTS idx_availity_state ON availity_payers(state_name);

-- HIPAA audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time  INTEGER DEFAULT (unixepoch()),
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    client_name TEXT,
    detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(event_time);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);

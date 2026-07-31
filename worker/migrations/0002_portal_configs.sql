-- Portal-specific configurations per client (e.g. UHC TaxID→Facility mapping)
CREATE TABLE IF NOT EXISTS portal_configs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  portal      TEXT NOT NULL,
  config_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, portal)
);

CREATE INDEX IF NOT EXISTS idx_portal_configs_client ON portal_configs(client_id);

-- Stable public Site Addresses (issue #48, FINAL-DECISION-RECORD decision 132).
--
-- One address `https://{site-slug}.wazibiz.co.ke` per Site identity, allocated
-- exactly once at canonical Site creation. The address belongs to the Site,
-- never to a Build Version: it does not change across Revisions, Builds,
-- Automated Repair, Site Generations, Build Mode changes, Publication,
-- Rollback or later Business name changes. `slug` and `host` are UNIQUE —
-- the UNIQUE constraints are the final collision authority; the domain
-- service resolves candidate collisions with bounded `-2`, `-3`, ... retries.
-- The wildcard site gateway resolves host -> this row -> canonical
-- site_published_state.current_publication_id -> the exact publications row.

CREATE TABLE site_addresses (
  site_id TEXT PRIMARY KEY REFERENCES site_identities(id),
  slug TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_site_addresses_host ON site_addresses(host);

CREATE TRIGGER site_addresses_no_update BEFORE UPDATE ON site_addresses
BEGIN
  SELECT RAISE(ABORT, 'SITE_ADDRESS_IMMUTABLE');
END;

CREATE TRIGGER site_addresses_no_delete BEFORE DELETE ON site_addresses
BEGIN
  SELECT RAISE(ABORT, 'SITE_ADDRESS_IMMUTABLE');
END;

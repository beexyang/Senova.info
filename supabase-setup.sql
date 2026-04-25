-- Drop the old table if it exists and recreate with correct columns
DROP TABLE IF EXISTS sync_log;
DROP TABLE IF EXISTS providers;

-- Create providers table
CREATE TABLE providers (
  id BIGSERIAL PRIMARY KEY,
  ccn TEXT UNIQUE NOT NULL,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  telephone TEXT,
  ownership_type TEXT,
  quality_rating NUMERIC,
  certification_date TEXT,
  offers_nursing BOOLEAN DEFAULT false,
  offers_pt BOOLEAN DEFAULT false,
  offers_ot BOOLEAN DEFAULT false,
  offers_speech BOOLEAN DEFAULT false,
  offers_medical_social BOOLEAN DEFAULT false,
  offers_aide BOOLEAN DEFAULT false,
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_providers_zip ON providers (zip_code);
CREATE INDEX idx_providers_state ON providers (state);
CREATE INDEX idx_providers_type ON providers (provider_type);
CREATE INDEX idx_providers_state_type ON providers (state, provider_type);

-- Sync log table
CREATE TABLE sync_log (
  id BIGSERIAL PRIMARY KEY,
  dataset TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  error_message TEXT
);

-- Row-level security: read-only for the public anon key.
-- WRITES are intentionally NOT given a policy here. Server-side endpoints
-- use SUPABASE_SERVICE_KEY (which bypasses RLS) for writes; without a
-- policy granting INSERT/UPDATE/DELETE to anon or authenticated, the
-- public anon key cannot tamper with provider data.
--
-- The previous version used `USING (true) WITH CHECK (true)` which let
-- ANYONE with the anon key insert, update, or delete rows. See
-- supabase-secure-rls.sql for the full hardened policy set covering
-- every other table (leads, vendors, users, etc.).
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_public_read" ON providers
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_log_public_read" ON sync_log
  FOR SELECT TO anon, authenticated USING (true);

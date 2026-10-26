-- Migration 003: Gemini Multi-Account Pool & Quota Tracking

CREATE TABLE IF NOT EXISTS gemini_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 1,
  requests_today INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gemini_accounts_status ON gemini_accounts(status);
CREATE INDEX IF NOT EXISTS idx_gemini_accounts_priority ON gemini_accounts(priority);

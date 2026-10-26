-- Migration 002: Pending Approvals for Sensitive Tasks

CREATE TABLE IF NOT EXISTS pending_approvals (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  action TEXT NOT NULL,
  repository_id TEXT,
  prompt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES commands(id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_token ON pending_approvals(token);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON pending_approvals(status);

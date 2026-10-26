-- Initial Schema Migration for wemoteit

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_definitions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL DEFAULT '[]',
  configuration TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_definition_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  health_status TEXT NOT NULL DEFAULT 'healthy',
  last_connected_at TEXT,
  last_error_code TEXT,
  configuration_ref TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (channel_definition_id) REFERENCES channel_definitions(id)
);

CREATE TABLE IF NOT EXISTS incoming_messages (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'user',
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  received_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  CONSTRAINT uq_channel_provider_msg UNIQUE (channel_connection_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  arguments TEXT NOT NULL DEFAULT '{}',
  target_repository_id TEXT,
  target_agent_profile_id TEXT,
  authorization_decision TEXT NOT NULL,
  authorization_reason TEXT,
  approval_requirement INTEGER NOT NULL DEFAULT 0,
  approval_token TEXT,
  source_message_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_message_id) REFERENCES incoming_messages(id)
);

CREATE TABLE IF NOT EXISTS repository_profiles (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  allowed_operations TEXT NOT NULL DEFAULT '["read","review"]',
  allowed_branches TEXT NOT NULL DEFAULT '["main","master"]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL DEFAULT '[]',
  supported_operations TEXT NOT NULL DEFAULT '[]',
  execution_mode TEXT NOT NULL DEFAULT 'mock',
  configuration_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  repository_id TEXT,
  agent_profile_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  result_ref TEXT,
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES commands(id),
  FOREIGN KEY (source_message_id) REFERENCES incoming_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_correlation ON jobs(correlation_id);

CREATE TABLE IF NOT EXISTS job_state_transitions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS execution_results (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  output_ref TEXT,
  artifacts TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  correlation_id TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason_code TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  delivered_at TEXT,
  correlation_id TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

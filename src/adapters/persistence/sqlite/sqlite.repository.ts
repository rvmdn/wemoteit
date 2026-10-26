import { PersistencePort } from "../../../ports/persistence.port.js";
import { SqliteDatabase } from "./sqlite.database.js";
import {
  Workspace,
  ChannelDefinition,
  ChannelConnection,
  NormalizedIncomingMessage,
  Command,
  RepositoryProfile,
  AgentProfile,
  Job,
  JobStateTransition,
  ExecutionResult,
  AuditEvent,
  JobStatus,
  WorkspaceSchema,
  ChannelDefinitionSchema,
  ChannelConnectionSchema,
  NormalizedIncomingMessageSchema,
  CommandSchema,
  RepositoryProfileSchema,
  AgentProfileSchema,
  JobSchema,
  ExecutionResultSchema,
  AuditEventSchema,
  PendingApproval,
  PendingApprovalSchema,
  DeliveryAttempt,
  DeliveryAttemptSchema,
  GeminiAccountInstance,
  GeminiAccountInstanceSchema,
  GeminiAccountStatus,
} from "../../../domain/index.js";

export class SqlitePersistenceRepository implements PersistencePort {
  constructor(private readonly dbHelper: SqliteDatabase) {}

  public async initialize(): Promise<void> {
    this.dbHelper.migrate();
  }

  public async close(): Promise<void> {
    this.dbHelper.close();
  }

  // Workspaces
  public async saveWorkspace(workspace: Workspace): Promise<void> {
    const validated = WorkspaceSchema.parse(workspace);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO workspaces (id, schema_version, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.name,
      validated.status,
      validated.createdAt,
      validated.updatedAt
    );
  }

  public async getWorkspace(id: string): Promise<Workspace | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
    if (!row) return null;
    return WorkspaceSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  // Channel Definitions & Connections
  public async saveChannelDefinition(definition: ChannelDefinition): Promise<void> {
    const validated = ChannelDefinitionSchema.parse(definition);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO channel_definitions (id, schema_version, provider, display_name, enabled, capabilities, configuration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        capabilities = excluded.capabilities,
        configuration = excluded.configuration,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.provider,
      validated.displayName,
      validated.enabled ? 1 : 0,
      JSON.stringify(validated.capabilities),
      JSON.stringify(validated.configuration),
      validated.createdAt,
      validated.updatedAt
    );
  }

  public async getChannelDefinition(id: string): Promise<ChannelDefinition | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM channel_definitions WHERE id = ?").get(id) as any;
    if (!row) return null;
    return ChannelDefinitionSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      provider: row.provider,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      capabilities: JSON.parse(row.capabilities),
      configuration: JSON.parse(row.configuration),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public async saveChannelConnection(connection: ChannelConnection): Promise<void> {
    const validated = ChannelConnectionSchema.parse(connection);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO channel_connections (id, workspace_id, channel_definition_id, status, health_status, last_connected_at, last_error_code, configuration_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        health_status = excluded.health_status,
        last_connected_at = excluded.last_connected_at,
        last_error_code = excluded.last_error_code,
        configuration_ref = excluded.configuration_ref
    `).run(
      validated.id,
      validated.workspaceId,
      validated.channelDefinitionId,
      validated.status,
      validated.healthStatus,
      validated.lastConnectedAt,
      validated.lastErrorCode,
      validated.configurationRef
    );
  }

  public async getChannelConnection(id: string): Promise<ChannelConnection | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM channel_connections WHERE id = ?").get(id) as any;
    if (!row) return null;
    return ChannelConnectionSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      channelDefinitionId: row.channel_definition_id,
      status: row.status,
      healthStatus: row.health_status,
      lastConnectedAt: row.last_connected_at,
      lastErrorCode: row.last_error_code,
      configurationRef: row.configuration_ref,
    });
  }

  // Messages
  public async saveIncomingMessage(message: NormalizedIncomingMessage): Promise<void> {
    const validated = NormalizedIncomingMessageSchema.parse(message);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO incoming_messages (
        id, schema_version, workspace_id, channel_connection_id, source_type,
        provider_message_id, conversation_id, sender_id, sender_type,
        message_type, text, attachments, received_at, correlation_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_connection_id, provider_message_id) DO NOTHING
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.workspaceId,
      validated.channelConnectionId,
      validated.sourceType,
      validated.providerMessageId,
      validated.conversationId,
      validated.senderId,
      validated.senderType,
      validated.messageType,
      validated.text,
      JSON.stringify(validated.attachments),
      validated.receivedAt,
      validated.correlationId,
      JSON.stringify(validated.metadata)
    );
  }

  public async getMessageByProviderId(
    channelConnectionId: string,
    providerMessageId: string
  ): Promise<NormalizedIncomingMessage | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare(`
      SELECT * FROM incoming_messages
      WHERE channel_connection_id = ? AND provider_message_id = ?
    `).get(channelConnectionId, providerMessageId) as any;
    if (!row) return null;
    return NormalizedIncomingMessageSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      workspaceId: row.workspace_id,
      channelConnectionId: row.channel_connection_id,
      sourceType: row.source_type,
      providerMessageId: row.provider_message_id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderType: row.sender_type,
      messageType: row.message_type,
      text: row.text,
      attachments: JSON.parse(row.attachments),
      receivedAt: row.received_at,
      correlationId: row.correlation_id,
      metadata: JSON.parse(row.metadata),
    });
  }

  public async getRecentMessages(
    conversationId: string,
    limit: number = 5
  ): Promise<NormalizedIncomingMessage[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db
      .prepare(`
        SELECT * FROM incoming_messages
        WHERE conversation_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `)
      .all(conversationId, limit) as any[];

    return rows.reverse().map((row) =>
      NormalizedIncomingMessageSchema.parse({
        id: row.id,
        schemaVersion: row.schema_version,
        workspaceId: row.workspace_id,
        channelConnectionId: row.channel_connection_id,
        sourceType: row.source_type,
        providerMessageId: row.provider_message_id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderType: row.sender_type,
        messageType: row.message_type,
        text: row.text,
        attachments: JSON.parse(row.attachments),
        receivedAt: row.received_at,
        correlationId: row.correlation_id,
        metadata: JSON.parse(row.metadata),
      })
    );
  }

  // Commands
  public async saveCommand(command: Command): Promise<void> {
    const validated = CommandSchema.parse(command);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO commands (
        id, schema_version, workspace_id, command_type, requested_action,
        arguments, target_repository_id, target_agent_profile_id,
        authorization_decision, authorization_reason, approval_requirement,
        approval_token, source_message_id, correlation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        authorization_decision = excluded.authorization_decision,
        authorization_reason = excluded.authorization_reason,
        approval_requirement = excluded.approval_requirement,
        approval_token = excluded.approval_token
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.workspaceId,
      validated.commandType,
      validated.requestedAction,
      JSON.stringify(validated.arguments),
      validated.targetRepositoryId,
      validated.targetAgentProfileId,
      validated.authorizationDecision,
      validated.authorizationReason ?? null,
      validated.approvalRequirement ? 1 : 0,
      validated.approvalToken,
      validated.sourceMessageId,
      validated.correlationId,
      validated.createdAt
    );
  }

  public async getCommand(id: string): Promise<Command | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as any;
    if (!row) return null;
    return CommandSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      workspaceId: row.workspace_id,
      commandType: row.command_type,
      requestedAction: row.requested_action,
      arguments: JSON.parse(row.arguments),
      targetRepositoryId: row.target_repository_id,
      targetAgentProfileId: row.target_agent_profile_id,
      authorizationDecision: row.authorization_decision,
      authorizationReason: row.authorization_reason,
      approvalRequirement: Boolean(row.approval_requirement),
      approvalToken: row.approval_token,
      sourceMessageId: row.source_message_id,
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    });
  }

  // Repositories & Agents
  public async saveRepositoryProfile(repo: RepositoryProfile): Promise<void> {
    const validated = RepositoryProfileSchema.parse(repo);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO repository_profiles (
        id, schema_version, workspace_id, name, description, path,
        allowed_operations, allowed_branches, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        path = excluded.path,
        allowed_operations = excluded.allowed_operations,
        allowed_branches = excluded.allowed_branches,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.workspaceId,
      validated.name,
      validated.description,
      validated.path,
      JSON.stringify(validated.allowedOperations),
      JSON.stringify(validated.allowedBranches),
      validated.enabled ? 1 : 0,
      validated.createdAt,
      validated.updatedAt
    );
  }

  public async getRepositoryProfile(id: string): Promise<RepositoryProfile | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM repository_profiles WHERE id = ?").get(id) as any;
    if (!row) return null;
    return RepositoryProfileSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      path: row.path,
      allowedOperations: JSON.parse(row.allowed_operations),
      allowedBranches: JSON.parse(row.allowed_branches),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public async listRepositoryProfiles(workspaceId: string): Promise<RepositoryProfile[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare("SELECT * FROM repository_profiles WHERE workspace_id = ?").all(workspaceId) as any[];
    return rows.map((row) =>
      RepositoryProfileSchema.parse({
        id: row.id,
        schemaVersion: row.schema_version,
        workspaceId: row.workspace_id,
        name: row.name,
        description: row.description,
        path: row.path,
        allowedOperations: JSON.parse(row.allowed_operations),
        allowedBranches: JSON.parse(row.allowed_branches),
        enabled: Boolean(row.enabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }

  public async saveAgentProfile(agent: AgentProfile): Promise<void> {
    const validated = AgentProfileSchema.parse(agent);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO agent_profiles (
        id, schema_version, provider, display_name, enabled,
        capabilities, supported_operations, execution_mode, configuration_ref,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        capabilities = excluded.capabilities,
        supported_operations = excluded.supported_operations,
        execution_mode = excluded.execution_mode,
        configuration_ref = excluded.configuration_ref,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.provider,
      validated.displayName,
      validated.enabled ? 1 : 0,
      JSON.stringify(validated.capabilities),
      JSON.stringify(validated.supportedOperations),
      validated.executionMode,
      validated.configurationRef,
      validated.createdAt,
      validated.updatedAt
    );
  }

  public async getAgentProfile(id: string): Promise<AgentProfile | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM agent_profiles WHERE id = ?").get(id) as any;
    if (!row) return null;
    return AgentProfileSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      provider: row.provider,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      capabilities: JSON.parse(row.capabilities),
      supportedOperations: JSON.parse(row.supported_operations),
      executionMode: row.execution_mode,
      configurationRef: row.configuration_ref,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  // Jobs
  public async saveJob(job: Job): Promise<void> {
    const validated = JobSchema.parse(job);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO jobs (
        id, schema_version, workspace_id, command_id, source_message_id,
        repository_id, agent_profile_id, status, priority, attempt,
        max_attempts, idempotency_key, correlation_id, result_ref,
        error_code, error_summary, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        attempt = excluded.attempt,
        result_ref = excluded.result_ref,
        error_code = excluded.error_code,
        error_summary = excluded.error_summary,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.workspaceId,
      validated.commandId,
      validated.sourceMessageId,
      validated.repositoryId,
      validated.agentProfileId,
      validated.status,
      validated.priority,
      validated.attempt,
      validated.maxAttempts,
      validated.idempotencyKey,
      validated.correlationId,
      validated.resultRef,
      validated.errorCode,
      validated.errorSummary,
      validated.createdAt,
      validated.startedAt,
      validated.completedAt,
      validated.updatedAt
    );
  }

  public async getJob(id: string): Promise<Job | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapJobRow(row);
  }

  public async getJobByIdempotencyKey(key: string): Promise<Job | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(key) as any;
    if (!row) return null;
    return this.mapJobRow(row);
  }

  public async listJobsByStatus(status: JobStatus): Promise<Job[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC").all(status) as any[];
    return rows.map((r) => this.mapJobRow(r));
  }

  public async listJobs(limit = 50): Promise<Job[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => this.mapJobRow(r));
  }

  public async recordJobTransition(transition: JobStateTransition): Promise<void> {
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO job_state_transitions (id, job_id, from_status, to_status, reason, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      transition.id,
      transition.jobId,
      transition.fromStatus,
      transition.toStatus,
      transition.reason ?? null,
      transition.occurredAt
    );
  }

  public async getJobTransitions(jobId: string): Promise<JobStateTransition[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare("SELECT * FROM job_state_transitions WHERE job_id = ? ORDER BY occurred_at ASC").all(jobId) as any[];
    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason,
      occurredAt: r.occurred_at,
    }));
  }

  // Results & Audits
  public async saveExecutionResult(result: ExecutionResult): Promise<void> {
    const validated = ExecutionResultSchema.parse(result);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO execution_results (
        id, schema_version, job_id, status, summary, output_ref,
        artifacts, started_at, completed_at, duration_ms, error_code, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        summary = excluded.summary,
        output_ref = excluded.output_ref,
        artifacts = excluded.artifacts,
        completed_at = excluded.completed_at,
        duration_ms = excluded.duration_ms,
        error_code = excluded.error_code
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.jobId,
      validated.status,
      validated.summary,
      validated.outputRef,
      JSON.stringify(validated.artifacts),
      validated.startedAt,
      validated.completedAt,
      validated.durationMs,
      validated.errorCode,
      validated.correlationId
    );
  }

  public async getExecutionResult(jobId: string): Promise<ExecutionResult | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM execution_results WHERE job_id = ?").get(jobId) as any;
    if (!row) return null;
    return ExecutionResultSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      jobId: row.job_id,
      status: row.status,
      summary: row.summary,
      outputRef: row.output_ref,
      artifacts: JSON.parse(row.artifacts),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
      correlationId: row.correlation_id,
    });
  }

  public async saveAuditEvent(event: AuditEvent): Promise<void> {
    const validated = AuditEventSchema.parse(event);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO audit_events (
        id, schema_version, workspace_id, actor_type, actor_id,
        event_type, resource_type, resource_id, outcome, reason_code,
        correlation_id, occurred_at, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      validated.id,
      validated.schemaVersion,
      validated.workspaceId,
      validated.actorType,
      validated.actorId,
      validated.eventType,
      validated.resourceType,
      validated.resourceId,
      validated.outcome,
      validated.reasonCode,
      validated.correlationId,
      validated.occurredAt,
      JSON.stringify(validated.details)
    );
  }

  public async listAuditEvents(correlationId?: string): Promise<AuditEvent[]> {
    const db = this.dbHelper.getRawDb();
    let rows: any[];
    if (correlationId) {
      rows = db.prepare("SELECT * FROM audit_events WHERE correlation_id = ? ORDER BY occurred_at ASC").all(correlationId);
    } else {
      rows = db.prepare("SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT 100").all();
    }
    return rows.map((r) =>
      AuditEventSchema.parse({
        id: r.id,
        schemaVersion: r.schema_version,
        workspaceId: r.workspace_id,
        actorType: r.actor_type,
        actorId: r.actor_id,
        eventType: r.event_type,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        outcome: r.outcome,
        reasonCode: r.reason_code,
        correlationId: r.correlation_id,
        occurredAt: r.occurred_at,
        details: JSON.parse(r.details),
      })
    );
  }

  // Pending Approvals
  public async savePendingApproval(approval: PendingApproval): Promise<void> {
    const validated = PendingApprovalSchema.parse(approval);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO pending_approvals (
        id, command_id, token, workspace_id, requested_by, action,
        repository_id, prompt, expires_at, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status
    `).run(
      validated.id,
      validated.commandId,
      validated.token,
      validated.workspaceId,
      validated.requestedBy,
      validated.action,
      validated.repositoryId,
      validated.prompt,
      validated.expiresAt,
      validated.status,
      validated.createdAt
    );
  }

  public async getPendingApprovalByToken(token: string): Promise<PendingApproval | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM pending_approvals WHERE token = ?").get(token) as any;
    if (!row) return null;
    return PendingApprovalSchema.parse({
      id: row.id,
      commandId: row.command_id,
      token: row.token,
      workspaceId: row.workspace_id,
      requestedBy: row.requested_by,
      action: row.action,
      repositoryId: row.repository_id,
      prompt: row.prompt,
      expiresAt: row.expires_at,
      status: row.status,
      createdAt: row.created_at,
    });
  }

  public async updatePendingApprovalStatus(
    id: string,
    status: "pending" | "approved" | "rejected" | "expired"
  ): Promise<void> {
    const db = this.dbHelper.getRawDb();
    db.prepare("UPDATE pending_approvals SET status = ? WHERE id = ?").run(status, id);
  }

  public async listPendingApprovals(workspaceId: string): Promise<PendingApproval[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare(
      "SELECT * FROM pending_approvals WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC"
    ).all(workspaceId) as any[];
    return rows.map((row) =>
      PendingApprovalSchema.parse({
        id: row.id,
        commandId: row.command_id,
        token: row.token,
        workspaceId: row.workspace_id,
        requestedBy: row.requested_by,
        action: row.action,
        repositoryId: row.repository_id,
        prompt: row.prompt,
        expiresAt: row.expires_at,
        status: row.status,
        createdAt: row.created_at,
      })
    );
  }

  // Delivery Attempts
  public async recordDeliveryAttempt(attempt: DeliveryAttempt): Promise<void> {
    const validated = DeliveryAttemptSchema.parse(attempt);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO delivery_attempts (
        id, job_id, channel_connection_id, conversation_id,
        status, error_message, attempt, delivered_at, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        error_message = excluded.error_message,
        attempt = excluded.attempt,
        delivered_at = excluded.delivered_at
    `).run(
      validated.id,
      validated.jobId,
      validated.channelConnectionId,
      validated.conversationId,
      validated.status,
      validated.errorMessage,
      validated.attempt,
      validated.deliveredAt,
      validated.correlationId
    );
  }

  public async listDeliveryAttempts(jobId?: string): Promise<DeliveryAttempt[]> {
    const db = this.dbHelper.getRawDb();
    let rows: any[];
    if (jobId) {
      rows = db.prepare("SELECT * FROM delivery_attempts WHERE job_id = ? ORDER BY attempt ASC").all(jobId);
    } else {
      rows = db.prepare("SELECT * FROM delivery_attempts ORDER BY rowid DESC LIMIT 50").all();
    }
    return rows.map((r) =>
      DeliveryAttemptSchema.parse({
        id: r.id,
        jobId: r.job_id,
        channelConnectionId: r.channel_connection_id,
        conversationId: r.conversation_id,
        status: r.status,
        errorMessage: r.error_message,
        attempt: r.attempt,
        deliveredAt: r.delivered_at,
        correlationId: r.correlation_id,
      })
    );
  }

  public async listFailedDeliveries(): Promise<DeliveryAttempt[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare(
      "SELECT * FROM delivery_attempts WHERE status = 'failed' ORDER BY rowid DESC LIMIT 50"
    ).all() as any[];
    return rows.map((r) =>
      DeliveryAttemptSchema.parse({
        id: r.id,
        jobId: r.job_id,
        channelConnectionId: r.channel_connection_id,
        conversationId: r.conversation_id,
        status: r.status,
        errorMessage: r.error_message,
        attempt: r.attempt,
        deliveredAt: r.delivered_at,
        correlationId: r.correlation_id,
      })
    );
  }

  private mapJobRow(row: any): Job {
    return JobSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      workspaceId: row.workspace_id,
      commandId: row.command_id,
      sourceMessageId: row.source_message_id,
      repositoryId: row.repository_id,
      agentProfileId: row.agent_profile_id,
      status: row.status,
      priority: row.priority,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      resultRef: row.result_ref,
      errorCode: row.error_code,
      errorSummary: row.error_summary,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    });
  }

  // Gemini Multi-Account Pool
  public async saveGeminiAccount(account: GeminiAccountInstance): Promise<void> {
    const validated = GeminiAccountInstanceSchema.parse(account);
    const db = this.dbHelper.getRawDb();
    db.prepare(`
      INSERT INTO gemini_accounts (
        id, label, api_key, model, tier, status, priority,
        requests_today, cooldown_until, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        api_key = excluded.api_key,
        model = excluded.model,
        tier = excluded.tier,
        status = excluded.status,
        priority = excluded.priority,
        requests_today = excluded.requests_today,
        cooldown_until = excluded.cooldown_until,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at
    `).run(
      validated.id,
      validated.label,
      validated.apiKey,
      validated.model,
      validated.tier,
      validated.status,
      validated.priority,
      validated.requestsToday,
      validated.cooldownUntil,
      validated.lastUsedAt,
      validated.createdAt,
      validated.updatedAt
    );
  }

  public async getGeminiAccount(id: string): Promise<GeminiAccountInstance | null> {
    const db = this.dbHelper.getRawDb();
    const row = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapGeminiAccountRow(row);
  }

  public async listGeminiAccounts(): Promise<GeminiAccountInstance[]> {
    const db = this.dbHelper.getRawDb();
    const rows = db.prepare("SELECT * FROM gemini_accounts ORDER BY priority ASC, rowid ASC").all() as any[];
    return rows.map((r) => this.mapGeminiAccountRow(r));
  }

  public async updateGeminiAccountStatus(
    id: string,
    status: GeminiAccountStatus,
    cooldownUntil: string | null = null
  ): Promise<void> {
    const db = this.dbHelper.getRawDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE gemini_accounts SET status = ?, cooldown_until = ?, updated_at = ? WHERE id = ?"
    ).run(status, cooldownUntil, now, id);
  }

  public async incrementGeminiAccountUsage(id: string): Promise<void> {
    const db = this.dbHelper.getRawDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE gemini_accounts SET requests_today = requests_today + 1, last_used_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, id);
  }

  public async deleteGeminiAccount(id: string): Promise<void> {
    const db = this.dbHelper.getRawDb();
    db.prepare("DELETE FROM gemini_accounts WHERE id = ?").run(id);
  }

  private mapGeminiAccountRow(row: any): GeminiAccountInstance {
    return GeminiAccountInstanceSchema.parse({
      id: row.id,
      schemaVersion: 1,
      label: row.label,
      apiKey: row.api_key,
      model: row.model,
      tier: row.tier,
      status: row.status,
      priority: row.priority,
      requestsToday: row.requests_today,
      cooldownUntil: row.cooldown_until,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

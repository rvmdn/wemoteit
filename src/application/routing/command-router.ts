import { NormalizedIncomingMessage } from "../../domain/message/message.entity.js";
import { PersistencePort } from "../../ports/persistence.port.js";
import { CommandAuthorizer } from "../authorization/command-authorizer.js";
import { JobManager } from "../jobs/job-manager.js";
import { ExecutionCoordinator } from "../execution/execution-coordinator.js";
import { ResultDeliveryService } from "../delivery/result-delivery.service.js";
import { ConfigService } from "../../adapters/configuration/config.service.js";
import { logger } from "../../adapters/logging/logger.js";
import { AuditEvent } from "../../domain/audit/audit.entity.js";

export class CommandRouter {
  constructor(
    private readonly persistence: PersistencePort,
    private readonly authorizer: CommandAuthorizer,
    private readonly jobManager: JobManager,
    private readonly executionCoordinator: ExecutionCoordinator,
    private readonly deliveryService: ResultDeliveryService,
    private readonly configService: ConfigService
  ) {}

  public async processIncomingMessage(message: NormalizedIncomingMessage): Promise<void> {
    const correlationLogger = logger.child({
      correlationId: message.correlationId,
      providerMessageId: message.providerMessageId,
      senderId: message.senderId,
    });

    correlationLogger.info("Processing incoming message");

    // 1. Deduplication check
    const existing = await this.persistence.getMessageByProviderId(
      message.channelConnectionId,
      message.providerMessageId
    );
    if (existing) {
      correlationLogger.warn("Duplicate message detected; ignoring idempotently");
      return;
    }

    // Persist message
    await this.persistence.saveIncomingMessage(message);

    // 2. Authorization & Parsing
    const authResult = this.authorizer.authorizeAndParse(message);

    if (authResult.decision === "deny") {
      correlationLogger.warn({ reason: authResult.reason }, "Message authorization denied");
      await this.recordAudit(message, "authorization_denied", "denied", authResult.reason);
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `⚠️ Request Denied: ${authResult.reason || "Unauthorized action"}`
      );
      return;
    }

    if (authResult.decision === "require_approval" && authResult.command) {
      await this.persistence.saveCommand(authResult.command);
      await this.recordAudit(message, "approval_requested", "pending", authResult.reason);
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `🔒 Action requires approval. To execute, reply with:\n/run ${authResult.command.targetRepositoryId} ${authResult.command.arguments.prompt} --approve=<token>`
      );
      return;
    }

    const command = authResult.command;
    if (!command) {
      correlationLogger.error("Authorized decision returned without command object");
      return;
    }

    await this.persistence.saveCommand(command);
    await this.recordAudit(message, "authorization_allowed", "success");

    // Handle immediate informational commands without spawning background jobs
    if (command.commandType === "help") {
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `🤖 *wemoteit Commands:*\n` +
          `• /status - View system status & health\n` +
          `• /repos - List authorized repositories\n` +
          `• /jobs - View recent job history\n` +
          `• /review <repo> - Perform read-only codebase review\n` +
          `• /run <repo> <prompt> - Execute agent task\n` +
          `• /cancel <jobId> - Cancel a queued or running job`
      );
      return;
    }

    if (command.commandType === "status") {
      const runningJobs = await this.persistence.listJobsByStatus("running");
      const queuedJobs = await this.persistence.listJobsByStatus("queued");
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `📊 *wemoteit Status:*\n• Active Jobs: ${runningJobs.length}\n• Queued Jobs: ${queuedJobs.length}\n• Environment: Healthy`
      );
      return;
    }

    if (command.commandType === "list_repositories") {
      const repos = await this.persistence.listRepositoryProfiles(message.workspaceId);
      const repoList = repos.map((r) => `• *${r.id}* - ${r.name} (${r.path})`).join("\n");
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `📂 *Authorized Repositories:*\n${repoList || "No repositories registered."}`
      );
      return;
    }

    // 3. Create Durable Job
    const job = await this.jobManager.createJob(command);
    await this.recordAudit(message, "job_created", "success", undefined, job.id);

    // Send immediate acknowledgement
    await this.deliveryService.deliverAcknowledgement(
      message.conversationId,
      message.workspaceId,
      message.channelConnectionId,
      message.correlationId,
      `⏳ Job *${job.id}* accepted and queued for '${command.requestedAction}' on '${command.targetRepositoryId || "workspace"}'.`
    );

    // 4. Execute Job asynchronously
    try {
      const result = await this.executionCoordinator.executeJob(job, command);
      await this.deliveryService.deliverResult(
        job,
        message.conversationId,
        message.channelConnectionId,
        result
      );
    } catch (err: any) {
      correlationLogger.error({ jobId: job.id, error: err.message }, "Job execution failed");
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `❌ Job *${job.id}* failed: ${err.message}`
      );
    }
  }

  private async recordAudit(
    message: NormalizedIncomingMessage,
    eventType: any,
    outcome: "success" | "denied" | "failure" | "pending",
    reasonCode?: string,
    resourceId?: string
  ): Promise<void> {
    const event: AuditEvent = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      schemaVersion: 1,
      workspaceId: message.workspaceId,
      actorType: "user",
      actorId: message.senderId,
      eventType,
      resourceType: resourceId ? "job" : "message",
      resourceId: resourceId || message.id,
      outcome,
      reasonCode: reasonCode || null,
      correlationId: message.correlationId,
      occurredAt: new Date().toISOString(),
      details: {
        text: message.text.slice(0, 100),
        channelConnectionId: message.channelConnectionId,
      },
    };
    await this.persistence.saveAuditEvent(event);
  }
}

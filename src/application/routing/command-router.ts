import crypto from "node:crypto";
import { NormalizedIncomingMessage } from "../../domain/message/message.entity.js";
import { PersistencePort } from "../../ports/persistence.port.js";
import { CommandAuthorizer } from "../authorization/command-authorizer.js";
import { JobManager } from "../jobs/job-manager.js";
import { ExecutionCoordinator } from "../execution/execution-coordinator.js";
import { ResultDeliveryService } from "../delivery/result-delivery.service.js";
import { ConfigService } from "../../adapters/configuration/config.service.js";
import { logger } from "../../adapters/logging/logger.js";
import { AuditEvent } from "../../domain/audit/audit.entity.js";
import { PendingApproval } from "../../domain/approval/approval.entity.js";
import { GeminiIntentRouter } from "../../adapters/agents/gemini/gemini-intent-router.js";
import { WindowsActionAdapter } from "../../adapters/os/windows/windows-action.adapter.js";

export class CommandRouter {
  constructor(
    private readonly persistence: PersistencePort,
    private readonly authorizer: CommandAuthorizer,
    private readonly jobManager: JobManager,
    private readonly executionCoordinator: ExecutionCoordinator,
    private readonly deliveryService: ResultDeliveryService,
    private readonly configService: ConfigService,
    private readonly intentRouter?: GeminiIntentRouter,
    private readonly windowsActionAdapter: WindowsActionAdapter = new WindowsActionAdapter()
  ) {}

  public async processIncomingMessage(message: NormalizedIncomingMessage): Promise<void> {
    const correlationLogger = logger.child({
      correlationId: message.correlationId,
      providerMessageId: message.providerMessageId,
      senderId: message.senderId,
    });

    correlationLogger.info("Processing incoming message");

    // Strictly ignore bot notification replies to prevent echo loops in self-chat
    if (/^[⚠️✅⏳🔒🛑🤖💻📊📂📋🔍🌙☀️🔋💾⚡📸]/.test(message.text.trim())) {
      correlationLogger.debug("Message is an automated bot response; ignoring silently to prevent feedback loop");
      return;
    }

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
    await this.recordAudit(message, "message_received", "success");

    // 2. Dual-Engine: Natural Language vs Fast-Path Slash Commands
    const isSlashCommand = message.text.trim().startsWith("/");

    if (!isSlashCommand && this.intentRouter) {
      // First verify sender authorization before doing NLU
      const senderCheck = this.authorizer.authorizeAndParse({
        ...message,
        text: "/status", // probe to check sender channel authorization
      });

      if (senderCheck.decision === "deny") {
        correlationLogger.warn({ reason: senderCheck.reason }, "Sender not authorized for natural language command");
        await this.recordAudit(message, "authorization_denied", "denied", senderCheck.reason);
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `⚠️ *Request Denied:*\n${senderCheck.reason || "Unauthorized action"}`
        );
        return;
      }

      // Query recent conversation history and registered repos for contextual intent resolution
      const recentHistory = await this.persistence.getRecentMessages(message.conversationId, 4);
      const repos = await this.persistence.listRepositoryProfiles(message.workspaceId);
      const registeredRepoIds = repos.map((r) => r.id);

      correlationLogger.info("Resolving natural language intent via GeminiIntentRouter");
      const intent = await this.intentRouter.resolveIntent(message, recentHistory, registeredRepoIds);

      if (intent.type === "slash_command") {
        correlationLogger.info({ command: intent.commandText }, "Natural language mapped to slash command");
        const resolvedMsg: NormalizedIncomingMessage = {
          ...message,
          id: `${message.id}-mapped`,
          providerMessageId: `${message.providerMessageId}-mapped`,
          text: intent.commandText,
        };
        // Process the synthesized slash command directly
        return this.processIncomingMessage(resolvedMsg);
      }

      if (intent.type === "launch_app") {
        correlationLogger.info({ app: intent.appName }, "Executing Windows launch_app action");
        const res = await this.windowsActionAdapter.launchApp(intent.appName, intent.args);
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          res.message
        );
        return;
      }

      if (intent.type === "get_system_status") {
        correlationLogger.info({ metrics: intent.metrics }, "Querying Windows system status");
        const status = await this.windowsActionAdapter.getSystemStatus(intent.metrics);
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          status.summary
        );
        return;
      }

      if (intent.type === "schedule_power") {
        correlationLogger.info({ action: intent.action }, "Executing Windows schedule_power action");
        const res = await this.windowsActionAdapter.schedulePower(intent.action, intent.time);
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          res.message
        );
        return;
      }

      if (intent.type === "capture_screen") {
        correlationLogger.info("Executing Windows capture_screen action");
        const res = await this.windowsActionAdapter.captureScreen();
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          res.message
        );
        return;
      }

      // conversational_reply
      correlationLogger.info("Delivering natural language conversational reply");
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `🤖 ${intent.replyText}`
      );
      return;
    }

    // Fast-path authorization & parsing for slash commands (or fallback if intentRouter is not active)
    const authResult = this.authorizer.authorizeAndParse(message);

    if (authResult.decision === "deny") {
      correlationLogger.warn({ reason: authResult.reason }, "Message authorization denied");
      await this.recordAudit(message, "authorization_denied", "denied", authResult.reason);
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `⚠️ *Request Denied:*\n${authResult.reason || "Unauthorized action"}`
      );
      return;
    }

    if (authResult.decision === "require_approval" && authResult.command && authResult.suggestedApprovalToken) {
      const command = authResult.command;
      const token = authResult.suggestedApprovalToken;
      await this.persistence.saveCommand(command);

      const pendingApproval: PendingApproval = {
        id: `appr-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
        commandId: command.id,
        token,
        workspaceId: command.workspaceId,
        requestedBy: message.senderId,
        action: command.requestedAction,
        repositoryId: command.targetRepositoryId,
        prompt: (command.arguments.prompt as string) || command.requestedAction,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15-minute TTL
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      await this.persistence.savePendingApproval(pendingApproval);
      await this.recordAudit(message, "approval_requested", "pending", authResult.reason, command.id);

      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `🔒 *Approval Required for Task Execution*\n` +
          `• *Action:* ${command.requestedAction}\n` +
          `• *Repository:* ${command.targetRepositoryId}\n` +
          `• *Prompt:* "${command.arguments.prompt}"\n\n` +
          `To authorize and execute this task, reply with:\n👉 */approve ${token}*`
      );
      return;
    }

    const command = authResult.command;
    if (!command) {
      correlationLogger.error("Authorized decision returned without command object");
      return;
    }

    await this.persistence.saveCommand(command);
    await this.recordAudit(message, "authorization_allowed", "success", undefined, command.id);

    // 3. Handle immediate / non-job commands
    if (command.commandType === "help") {
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `🤖 *wemoteit Commands:*\n` +
          `• */status* - View system status & health\n` +
          `• */repos* - List authorized repositories\n` +
          `• */jobs* - View recent jobs\n` +
          `• */job <jobId>* - Inspect details of a specific job\n` +
          `• */review <repo> [prompt]* - Read-only codebase review\n` +
          `• */run <repo> <prompt>* - Execute task (requires approval)\n` +
          `• */approve <token>* - Confirm pending task execution\n` +
          `• */cancel <jobId>* - Cancel a queued or running job`
      );
      return;
    }

    if (command.commandType === "status") {
      const runningJobs = await this.persistence.listJobsByStatus("running");
      const queuedJobs = await this.persistence.listJobsByStatus("queued");
      const pendingApprovals = await this.persistence.listPendingApprovals(message.workspaceId);
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `📊 *wemoteit System Status:*\n` +
          `• Active Jobs: ${runningJobs.length}\n` +
          `• Queued Jobs: ${queuedJobs.length}\n` +
          `• Pending Approvals: ${pendingApprovals.length}\n` +
          `• Health: Healthy (Local-First)`
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

    if (command.commandType === "job_status") {
      const jobs = await this.persistence.listJobs(5);
      if (jobs.length === 0) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `📋 No recent jobs found.`
        );
        return;
      }
      const listText = jobs
        .map(
          (j) =>
            `• *${j.id}* [${j.status.toUpperCase()}] on *${j.repositoryId || "workspace"}*`
        )
        .join("\n");
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `📋 *Recent Jobs:*\n${listText}\n\n_Type /job <jobId> for full details._`
      );
      return;
    }

    if (command.commandType === "job_detail") {
      const targetJobId = command.arguments.targetJobId as string;
      const job = await this.persistence.getJob(targetJobId);
      if (!job) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Job *${targetJobId}* not found.`
        );
        return;
      }

      const transitions = await this.persistence.getJobTransitions(job.id);
      const result = await this.persistence.getExecutionResult(job.id);

      const timeline = transitions
        .map((t) => `  ↳ [${t.toStatus}] (${t.reason || "transition"})`)
        .join("\n");

      let detailsText =
        `🔍 *Job Details: ${job.id}*\n` +
        `• Status: *${job.status.toUpperCase()}*\n` +
        `• Repository: *${job.repositoryId || "none"}*\n` +
        `• Created: ${job.createdAt}\n` +
        `• Timeline:\n${timeline}\n`;

      if (result) {
        detailsText += `\n*Result Summary:*\n${result.summary}\n• Duration: ${result.durationMs}ms`;
      }
      if (job.errorSummary) {
        detailsText += `\n*Error:* ${job.errorSummary}`;
      }

      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        detailsText
      );
      return;
    }

    if (command.commandType === "cancel_job") {
      const targetJobId = command.arguments.targetJobId as string;
      const job = await this.persistence.getJob(targetJobId);
      if (!job) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Cannot cancel: Job *${targetJobId}* not found.`
        );
        return;
      }

      if (["completed", "failed", "cancelled"].includes(job.status)) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `⚠️ Job *${targetJobId}* is already ${job.status}.`
        );
        return;
      }

      try {
        await this.jobManager.transitionJob(job.id, "cancel_requested", "Cancelled by user request");
        await this.jobManager.transitionJob(job.id, "cancelled", "Cancelled successfully");
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `🛑 Job *${targetJobId}* has been cancelled successfully.`
        );
      } catch (err: any) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Failed to cancel job *${targetJobId}*: ${err.message}`
        );
      }
      return;
    }

    if (command.commandType === "approve_task") {
      const token = command.arguments.token as string;
      const approval = await this.persistence.getPendingApprovalByToken(token);

      if (!approval) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Invalid approval token: *${token}*`
        );
        return;
      }

      if (approval.status !== "pending") {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `⚠️ Approval token *${token}* has already been ${approval.status}.`
        );
        return;
      }

      if (new Date(approval.expiresAt).getTime() < Date.now()) {
        await this.persistence.updatePendingApprovalStatus(approval.id, "expired");
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `⏳ Approval token *${token}* has expired. Please re-run the command.`
        );
        return;
      }

      // Mark token approved
      await this.persistence.updatePendingApprovalStatus(approval.id, "approved");
      await this.recordAudit(message, "job_created", "success", "approval_granted", approval.commandId);

      // Fetch original command and execute
      const originalCommand = await this.persistence.getCommand(approval.commandId);
      if (!originalCommand) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Associated command not found for approval *${token}*.`
        );
        return;
      }

      // Create durable job
      const approvedJob = await this.jobManager.createJob(originalCommand);
      await this.deliveryService.deliverAcknowledgement(
        message.conversationId,
        message.workspaceId,
        message.channelConnectionId,
        message.correlationId,
        `✅ *Approval Granted for ${token}!*\nJob *${approvedJob.id}* queued for execution.`
      );

      // Execute job asynchronously
      try {
        const result = await this.executionCoordinator.executeJob(approvedJob, originalCommand);
        await this.deliveryService.deliverResult(
          approvedJob,
          message.conversationId,
          message.channelConnectionId,
          result
        );
      } catch (err: any) {
        await this.deliveryService.deliverAcknowledgement(
          message.conversationId,
          message.workspaceId,
          message.channelConnectionId,
          message.correlationId,
          `❌ Approved Job *${approvedJob.id}* failed: ${err.message}`
        );
      }
      return;
    }

    // 4. Create and execute durable job for review_repository or run_task
    const job = await this.jobManager.createJob(command);
    await this.recordAudit(message, "job_created", "success", undefined, job.id);

    // Immediate acknowledgement
    await this.deliveryService.deliverAcknowledgement(
      message.conversationId,
      message.workspaceId,
      message.channelConnectionId,
      message.correlationId,
      `⏳ Job *${job.id}* accepted and queued for '${command.requestedAction}' on '${command.targetRepositoryId || "workspace"}'.`
    );

    // Asynchronously execute
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

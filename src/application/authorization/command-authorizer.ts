import crypto from "node:crypto";
import path from "node:path";
import {
  NormalizedIncomingMessage,
  Command,
  CommandSchema,
  CommandType,
  AuthorizationDecision,
} from "../../domain/index.js";
import { ConfigService } from "../../adapters/configuration/config.service.js";

export interface AuthorizationResult {
  decision: AuthorizationDecision;
  reason?: string;
  command?: Command;
  suggestedApprovalToken?: string;
}

export class CommandAuthorizer {
  constructor(private readonly configService: ConfigService) {}

  public authorizeAndParse(message: NormalizedIncomingMessage): AuthorizationResult {
    const config = this.configService.getConfig();

    // 1. Channel sender & conversation verification
    const channelConfig =
      message.sourceType === "whatsapp"
        ? config.channels.whatsapp
        : config.channels.mock;

    if (!channelConfig.enabled) {
      return {
        decision: "deny",
        reason: `Channel provider '${message.sourceType}' is disabled in configuration.`,
      };
    }

    const normalizeSender = (id: string) => id.replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/[^a-zA-Z0-9]/g, "");
    const authSenderNorm = normalizeSender(channelConfig.authorizedSenderId);
    const msgSenderNorm = normalizeSender(message.senderId);

    const isAuthorizedSender =
      channelConfig.authorizedSenderId === "*" ||
      channelConfig.authorizedSenderId === message.senderId ||
      authSenderNorm === msgSenderNorm ||
      (channelConfig.authorizedSenderId === "self" && message.senderId === "self");

    if (!isAuthorizedSender) {
      return {
        decision: "deny",
        reason: `Sender ID '${message.senderId}' is not authorized.`,
      };
    }

    if (
      channelConfig.authorizedConversationId !== "*" &&
      channelConfig.authorizedConversationId !== message.conversationId
    ) {
      return {
        decision: "deny",
        reason: `Conversation ID '${message.conversationId}' is not authorized.`,
      };
    }

    // 2. Command Parsing
    const parsedCommand = this.parseMessageText(message);
    if (!parsedCommand) {
      return {
        decision: "deny",
        reason: "Unrecognized command format. Type /help to see available commands.",
      };
    }

    // 3. Command-specific authorization checks
    if (parsedCommand.type === "run_task" || parsedCommand.type === "review_repository") {
      const repoId = parsedCommand.targetRepoId;
      if (!repoId) {
        return {
          decision: "deny",
          reason: "Target repository ID is required for task execution.",
        };
      }

      // Check path traversal attempts in repository ID
      if (repoId.includes("..") || repoId.includes("/") || repoId.includes("\\")) {
        return {
          decision: "deny",
          reason: "Path traversal or directory separators detected in repository ID.",
        };
      }

      const repo = this.configService.resolveRepository(repoId);
      if (!repo) {
        return {
          decision: "deny",
          reason: `Repository '${repoId}' is not registered or is disabled.`,
        };
      }

      // Verify canonical root boundary
      const canonicalPath = path.resolve(repo.path);
      if (!canonicalPath.startsWith(path.resolve(repo.path))) {
        return {
          decision: "deny",
          reason: "Repository path boundary violation detected.",
        };
      }

      const isReadOnly = parsedCommand.type === "review_repository";
      if (!isReadOnly && config.policies.requireApprovalForModification && !parsedCommand.approvalToken) {
        const approvalToken = `APP-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
        const cmd = this.buildDomainCommand(
          message,
          parsedCommand,
          "require_approval",
          "Task requires explicit approval token or approval confirmation."
        );
        return {
          decision: "require_approval",
          reason: "Mutating task requires explicit approval.",
          command: cmd,
          suggestedApprovalToken: approvalToken,
        };
      }
    }

    const command = this.buildDomainCommand(message, parsedCommand, "allow");
    return {
      decision: "allow",
      command,
    };
  }

  private parseMessageText(message: NormalizedIncomingMessage): {
    type: CommandType;
    action: string;
    targetRepoId?: string;
    prompt?: string;
    args: Record<string, unknown>;
    approvalToken?: string;
  } | null {
    const text = message.text.trim();

    if (text === "/help" || text === "help") {
      return { type: "help", action: "display_help", args: {} };
    }

    if (text === "/status" || text === "status") {
      return { type: "status", action: "display_status", args: {} };
    }

    if (text === "/repos" || text === "/repositories" || text === "list_repositories") {
      return { type: "list_repositories", action: "list_repositories", args: {} };
    }

    if (text === "/jobs" || text === "jobs") {
      return { type: "job_status", action: "list_jobs", args: {} };
    }

    // Match /job <jobId>
    const jobDetailMatch = text.match(/^\/(?:job)\s+([a-zA-Z0-9_-]+)/i);
    if (jobDetailMatch) {
      return {
        type: "job_detail",
        action: "inspect_job",
        args: { targetJobId: jobDetailMatch[1] },
      };
    }

    // Match /approve <token>
    const approveMatch = text.match(/^\/(?:approve)\s+([a-zA-Z0-9_-]+)/i);
    if (approveMatch) {
      return {
        type: "approve_task",
        action: "grant_approval",
        approvalToken: approveMatch[1],
        args: { token: approveMatch[1] },
      };
    }

    // Match /review <repo> [prompt] [--agent=<name>]
    const reviewMatch = text.match(/^\/(?:review)\s+([a-zA-Z0-9_.-]+)(?:\s+(.+))?/is);
    if (reviewMatch) {
      let prompt = (reviewMatch[2] || "").trim() || "Review codebase for improvements";
      let targetAgent: string | undefined;

      const agentMatch = prompt.match(/--agent=([a-zA-Z0-9_-]+)/i);
      if (agentMatch) {
        targetAgent = agentMatch[1];
        prompt = prompt.replace(agentMatch[0], "").trim();
      }
      if (!prompt) {
        prompt = "Review codebase for improvements";
      }

      return {
        type: "review_repository",
        action: "review",
        targetRepoId: reviewMatch[1],
        targetAgent,
        prompt,
        args: { repositoryId: reviewMatch[1], prompt },
      };
    }

    // Match /run <repo> <prompt> [--approve=<token>] [--agent=<name>]
    const runMatch = text.match(/^\/(?:run|task)\s+([a-zA-Z0-9_.-]+)\s+(.+)/is);
    if (runMatch) {
      let prompt = runMatch[2].trim();
      let approvalToken: string | undefined;
      let targetAgent: string | undefined;

      const agentMatch = prompt.match(/--agent=([a-zA-Z0-9_-]+)/i);
      if (agentMatch) {
        targetAgent = agentMatch[1];
        prompt = prompt.replace(agentMatch[0], "").trim();
      }

      const tokenMatch = prompt.match(/--approve=([a-zA-Z0-9_-]+)/);
      if (tokenMatch) {
        approvalToken = tokenMatch[1];
        prompt = prompt.replace(tokenMatch[0], "").trim();
      }

      return {
        type: "run_task",
        action: "run_task",
        targetRepoId: runMatch[1],
        targetAgent,
        prompt,
        args: { prompt, repositoryId: runMatch[1] },
        approvalToken,
      };
    }

    // Match /cancel <jobId>
    const cancelMatch = text.match(/^\/(?:cancel)\s+([a-zA-Z0-9_-]+)/i);
    if (cancelMatch) {
      return {
        type: "cancel_job",
        action: "cancel_job",
        args: { targetJobId: cancelMatch[1] },
      };
    }

    return null;
  }

  private buildDomainCommand(
    message: NormalizedIncomingMessage,
    parsed: {
      type: CommandType;
      action: string;
      targetRepoId?: string;
      targetAgent?: string;
      prompt?: string;
      args: Record<string, unknown>;
      approvalToken?: string;
    },
    decision: AuthorizationDecision,
    reason?: string
  ): Command {
    const commandId = `cmd-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const config = this.configService.getConfig();
    const defaultAgent =
      message.sourceType === "whatsapp" && config.agents.antigravity?.enabled
        ? "antigravity"
        : "mock";
    const targetAgent = parsed.targetAgent || defaultAgent;

    return CommandSchema.parse({
      id: commandId,
      schemaVersion: 1,
      workspaceId: message.workspaceId,
      commandType: parsed.type,
      requestedAction: parsed.action,
      arguments: parsed.args,
      targetRepositoryId: parsed.targetRepoId ?? null,
      targetAgentProfileId: targetAgent,
      authorizationDecision: decision,
      authorizationReason: reason,
      approvalRequirement: decision === "require_approval",
      approvalToken: parsed.approvalToken ?? null,
      sourceMessageId: message.id,
      correlationId: message.correlationId,
      createdAt: new Date().toISOString(),
    });
  }
}

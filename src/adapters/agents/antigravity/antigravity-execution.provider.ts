import {
  ExecutionProvider,
  ExecutionCapabilities,
  ExecutionRequest,
  ExecutionContext,
  ExecutionHandle,
  ExecutionStatus,
  CancellationResult,
} from "../../../ports/execution-provider.port.js";
import { ProviderError } from "../../../shared/errors/app-error.js";
import { logger } from "../../logging/logger.js";

/**
 * AntigravityExecutionProvider
 *
 * NOTE: Marked as PENDING VALIDATION in Phase 0/1.
 * This adapter manages communication with Google Antigravity via verified
 * mechanisms (CLI `agy` or local Python SDK `google-antigravity`).
 */
export class AntigravityExecutionProvider implements ExecutionProvider {
  public readonly provider = "antigravity";
  private isVerified = false;

  constructor(
    private readonly config: {
      cliPath?: string;
      maxTimeoutMs?: number;
      executionMode?: "cli" | "sdk" | "ui_automation" | "mock";
    } = {}
  ) {}

  public async getCapabilities(): Promise<ExecutionCapabilities> {
    return {
      supportsStreaming: false,
      supportsCancellation: true,
      supportedLanguages: ["typescript", "javascript", "python", "html", "css", "csharp", "sql"],
      supportedTools: ["read_file", "write_to_file", "run_command", "view_file"],
      maxTimeoutMs: this.config.maxTimeoutMs ?? 120000,
    };
  }

  public async execute(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionHandle> {
    if (!this.isVerified) {
      logger.warn(
        { jobId: request.jobId, provider: this.provider },
        "Antigravity adapter invoked while pending environment validation. Operating under pending validation protocol."
      );
      throw new ProviderError(
        "Antigravity adapter requires host validation before executing real tasks. Please verify CLI/SDK installation or use mock provider.",
        this.provider
      );
    }

    const handle: ExecutionHandle = {
      id: `agy-${request.jobId}-${Date.now()}`,
      provider: this.provider,
      startedAt: new Date().toISOString(),
    };

    return handle;
  }

  public async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    return {
      handleId: handle.id,
      state: "failed",
      progressSummary: "Antigravity provider integration pending verification.",
    };
  }

  public async requestCancellation(handle: ExecutionHandle): Promise<CancellationResult> {
    return {
      cancelled: false,
      reason: "Antigravity provider integration pending verification.",
    };
  }

  public setVerified(verified: boolean): void {
    this.isVerified = verified;
  }
}

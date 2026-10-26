import fs from "node:fs";
import path from "node:path";
import {
  ExecutionProvider,
  ExecutionCapabilities,
  ExecutionRequest,
  ExecutionContext,
  ExecutionHandle,
  ExecutionStatus,
  CancellationResult,
} from "../../../ports/execution-provider.port.js";
import { ExecutionResult } from "../../../domain/result/result.entity.js";
import { GeminiAccountPoolManager } from "./gemini-account-pool.js";
import { GeminiAccountInstance } from "../../../domain/agent/gemini-account.entity.js";
import { logger } from "../../logging/logger.js";
import { redactSecrets } from "../../../shared/security/redactor.js";

export interface GeminiProviderConfig {
  defaultModel?: string;
  maxTimeoutMs?: number;
}

interface ActiveJobState {
  handleId: string;
  status: ExecutionStatus;
  startedAt: string;
  abortController: AbortController;
  request: ExecutionRequest;
}

export class GeminiExecutionProvider implements ExecutionProvider {
  public readonly provider = "gemini";
  private activeJobs = new Map<string, ActiveJobState>();

  constructor(
    private readonly poolManager: GeminiAccountPoolManager,
    private readonly config: GeminiProviderConfig = {}
  ) {}

  public async getCapabilities(): Promise<ExecutionCapabilities> {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportedLanguages: [
        "typescript",
        "javascript",
        "python",
        "csharp",
        "html",
        "css",
        "json",
        "markdown",
        "sql",
      ],
      supportedTools: ["read_file", "list_dir", "inspect_repo"],
      maxTimeoutMs: this.config.maxTimeoutMs ?? 60000,
    };
  }

  public async execute(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionHandle> {
    const handleId = `gemini-${request.jobId}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    const handle: ExecutionHandle = {
      id: handleId,
      provider: this.provider,
      startedAt,
    };

    const state: ActiveJobState = {
      handleId,
      status: {
        handleId,
        state: "running",
        progressSummary: "Acquiring Gemini account from pool...",
      },
      startedAt,
      abortController,
      request,
    };
    this.activeJobs.set(handleId, state);

    // Run execution asynchronously without blocking caller
    this.runGeneration(request, context, state).catch((err) => {
      logger.error({ jobId: request.jobId, error: err.message }, "Unhandled error in Gemini generation");
    });

    return handle;
  }

  private async runGeneration(
    request: ExecutionRequest,
    context: ExecutionContext,
    state: ActiveJobState
  ): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;
    const targetCwd = context.workingDirectory || request.repositoryPath || process.cwd();

    // Prepare contextual repository data
    const repoContext = this.extractRepoContext(targetCwd);

    while (attempt < maxRetries) {
      attempt++;
      let account: GeminiAccountInstance;

      try {
        account = await this.poolManager.acquireAccount();
      } catch (err: any) {
        this.markFailed(state, `Account pool exhausted: ${err.message}`, "ACCOUNT_POOL_EXHAUSTED");
        return;
      }

      state.status.progressSummary = `Processing with ${account.label} (${account.model})...`;

      try {
        const textResult = await this.callGeminiApi(
          account,
          request.prompt,
          repoContext,
          state.abortController.signal
        );

        // Success: record usage & complete job
        await this.poolManager.reportSuccess(account.id);

        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(state.startedAt).getTime();
        const safeSummary = redactSecrets(textResult.slice(0, 3500));

        const result: ExecutionResult = {
          id: `res-${state.handleId}`,
          schemaVersion: 1,
          jobId: request.jobId,
          status: "success",
          summary: safeSummary,
          outputRef: null,
          artifacts: [],
          startedAt: state.startedAt,
          completedAt,
          durationMs,
          errorCode: null,
          correlationId: request.correlationId,
        };

        state.status = {
          handleId: state.handleId,
          state: "completed",
          progressSummary: `Successfully completed with ${account.label}`,
          result,
        };
        return;
      } catch (err: any) {
        if (state.abortController.signal.aborted) {
          this.markFailed(state, "Execution cancelled by operator", "CANCELLED");
          return;
        }

        const isRateLimit =
          err.status === 429 ||
          err.message?.includes("RESOURCE_EXHAUSTED") ||
          err.message?.includes("429");

        if (isRateLimit) {
          logger.warn(
            { accountId: account.id, label: account.label, attempt },
            "Rate limit (429) hit. Rotating to next Gemini account in pool..."
          );
          await this.poolManager.reportRateLimit(account.id, 60);
          continue; // Retry with next account in loop
        }

        // Other non-retryable error
        this.markFailed(state, `Gemini API error: ${err.message}`, "API_ERROR");
        return;
      }
    }

    this.markFailed(state, "All accounts in Gemini pool exceeded rate limit.", "ALL_ACCOUNTS_LIMITED");
  }

  private async callGeminiApi(
    account: GeminiAccountInstance,
    userPrompt: string,
    repoContext: string,
    signal: AbortSignal
  ): Promise<string> {
    const model = account.model || this.config.defaultModel || "gemini-1.5-pro";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${account.apiKey}`;

    const systemInstruction =
      "You are wemoteit, an intelligent software engineering assistant and remote OS copilot. " +
      "Provide concise, actionable, and clear answers in Indonesian or English matching the user language. " +
      "Use repository context when provided.";

    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `${repoContext ? `[Workspace Context]\n${repoContext}\n\n` : ""}[User Request]\n${userPrompt}`,
          },
        ],
      },
    ];

    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err: any = new Error(`HTTP ${response.status}: ${errorText}`);
      err.status = response.status;
      throw err;
    }

    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      throw new Error("No text generated by Gemini model");
    }

    return textPart.trim();
  }

  private extractRepoContext(targetCwd: string): string {
    const parts: string[] = [`Workspace Path: ${targetCwd}`];
    try {
      if (fs.existsSync(targetCwd)) {
        const readmePath = path.join(targetCwd, "README.md");
        if (fs.existsSync(readmePath)) {
          const content = fs.readFileSync(readmePath, "utf-8").trim().slice(0, 1500);
          parts.push(`README.md Preview:\n${content}`);
        }

        const pkgPath = path.join(targetCwd, "package.json");
        if (fs.existsSync(pkgPath)) {
          const content = fs.readFileSync(pkgPath, "utf-8").trim().slice(0, 800);
          parts.push(`package.json Preview:\n${content}`);
        }

        const entries = fs.readdirSync(targetCwd, { withFileTypes: true });
        const files = entries
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .slice(0, 15);
        parts.push(`Files: ${files.join(", ")}`);
      }
    } catch {
      // Ignore inspection errors
    }
    return parts.join("\n\n");
  }

  private markFailed(state: ActiveJobState, message: string, errorCode: string): void {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(state.startedAt).getTime();

    const result: ExecutionResult = {
      id: `res-${state.handleId}`,
      schemaVersion: 1,
      jobId: state.request.jobId,
      status: "failure",
      summary: message,
      outputRef: null,
      artifacts: [],
      startedAt: state.startedAt,
      completedAt,
      durationMs,
      errorCode,
      correlationId: state.request.correlationId,
    };

    state.status = {
      handleId: state.handleId,
      state: "failed",
      progressSummary: message,
      result,
    };
  }

  public async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    const state = this.activeJobs.get(handle.id);
    if (!state) {
      return {
        handleId: handle.id,
        state: "failed",
        progressSummary: "Handle not found in Gemini active jobs",
      };
    }
    return state.status;
  }

  public async requestCancellation(handle: ExecutionHandle): Promise<CancellationResult> {
    const state = this.activeJobs.get(handle.id);
    if (!state) return { cancelled: false, reason: "Handle not found" };

    if (state.status.state !== "running") {
      return { cancelled: false, reason: `Job already ${state.status.state}` };
    }

    state.abortController.abort();
    return { cancelled: true };
  }
}

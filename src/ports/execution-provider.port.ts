import { ExecutionResult } from "../domain/result/result.entity.js";

export interface ExecutionCapabilities {
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  supportedLanguages: string[];
  supportedTools: string[];
  maxTimeoutMs: number;
}

export interface ExecutionRequest {
  jobId: string;
  workspaceId: string;
  repositoryPath?: string;
  action: string;
  prompt: string;
  arguments: Record<string, unknown>;
  correlationId: string;
  timeoutMs?: number;
}

export interface ExecutionContext {
  workingDirectory?: string;
  environment?: Record<string, string>;
  cancelSignal?: AbortSignal;
}

export interface ExecutionHandle {
  id: string;
  provider: string;
  startedAt: string;
}

export interface ExecutionStatus {
  handleId: string;
  state: "running" | "completed" | "failed" | "cancelled";
  progressSummary?: string;
  result?: ExecutionResult;
}

export interface CancellationResult {
  cancelled: boolean;
  reason?: string;
}

export interface ExecutionProvider {
  readonly provider: string;

  getCapabilities(): Promise<ExecutionCapabilities>;
  execute(request: ExecutionRequest, context: ExecutionContext): Promise<ExecutionHandle>;
  getStatus(handle: ExecutionHandle): Promise<ExecutionStatus>;
  requestCancellation(handle: ExecutionHandle): Promise<CancellationResult>;
}

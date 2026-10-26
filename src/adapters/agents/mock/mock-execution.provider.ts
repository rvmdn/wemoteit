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

export class MockExecutionProvider implements ExecutionProvider {
  public readonly provider = "mock";
  private handles = new Map<string, ExecutionStatus>();

  public simulatedDurationMs = 50;
  public shouldFail = false;
  public failureMessage = "Simulated provider failure";

  public async getCapabilities(): Promise<ExecutionCapabilities> {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportedLanguages: ["typescript", "javascript", "python", "markdown"],
      supportedTools: ["read_file", "search", "run_test"],
      maxTimeoutMs: 30000,
    };
  }

  public async execute(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionHandle> {
    const handleId = `handle-${request.jobId}-${Date.now()}`;
    const handle: ExecutionHandle = {
      id: handleId,
      provider: this.provider,
      startedAt: new Date().toISOString(),
    };

    const initialStatus: ExecutionStatus = {
      handleId,
      state: "running",
      progressSummary: `Executing ${request.action} on ${request.repositoryPath || "workspace"}`,
    };
    this.handles.set(handleId, initialStatus);

    // Asynchronously resolve execution without blocking ingestion
    setTimeout(() => {
      const current = this.handles.get(handleId);
      if (!current || current.state === "cancelled") return;

      const completedAt = new Date().toISOString();
      const startTime = new Date(handle.startedAt).getTime();
      const durationMs = Date.now() - startTime;

      if (this.shouldFail) {
        const failureResult: ExecutionResult = {
          id: `res-${handleId}`,
          schemaVersion: 1,
          jobId: request.jobId,
          status: "failure",
          summary: this.failureMessage,
          outputRef: null,
          artifacts: [],
          startedAt: handle.startedAt,
          completedAt,
          durationMs,
          errorCode: "SIMULATED_FAILURE",
          correlationId: request.correlationId,
        };
        this.handles.set(handleId, {
          handleId,
          state: "failed",
          progressSummary: "Failed execution",
          result: failureResult,
        });
      } else {
        const successResult: ExecutionResult = {
          id: `res-${handleId}`,
          schemaVersion: 1,
          jobId: request.jobId,
          status: "success",
          summary: `Successfully completed action '${request.action}' on prompt: '${request.prompt.slice(0, 50)}...'`,
          outputRef: null,
          artifacts: [
            {
              id: `art-${handleId}-1`,
              name: "summary.txt",
              mimeType: "text/plain",
              path: "/tmp/mock/summary.txt",
              sizeBytes: 128,
            },
          ],
          startedAt: handle.startedAt,
          completedAt,
          durationMs,
          errorCode: null,
          correlationId: request.correlationId,
        };
        this.handles.set(handleId, {
          handleId,
          state: "completed",
          progressSummary: "Completed successfully",
          result: successResult,
        });
      }
    }, this.simulatedDurationMs);

    return handle;
  }

  public async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    const status = this.handles.get(handle.id);
    if (!status) {
      return {
        handleId: handle.id,
        state: "failed",
        progressSummary: "Handle not found",
      };
    }
    return status;
  }

  public async requestCancellation(handle: ExecutionHandle): Promise<CancellationResult> {
    const status = this.handles.get(handle.id);
    if (!status) {
      return { cancelled: false, reason: "Handle not found" };
    }
    if (status.state === "completed" || status.state === "failed") {
      return { cancelled: false, reason: `Job already in ${status.state} state` };
    }

    this.handles.set(handle.id, {
      ...status,
      state: "cancelled",
      progressSummary: "Cancellation requested by operator",
    });
    return { cancelled: true };
  }
}

import { ExecutionProvider } from "../../ports/execution-provider.port.js";
import { PersistencePort } from "../../ports/persistence.port.js";
import { JobManager } from "../jobs/job-manager.js";
import { Job, Command, ExecutionResult } from "../../domain/index.js";
import { logger } from "../../adapters/logging/logger.js";

export class ExecutionCoordinator {
  constructor(
    private readonly jobManager: JobManager,
    private readonly persistence: PersistencePort,
    private readonly providerRegistry: Map<string, ExecutionProvider>
  ) {}

  public async executeJob(job: Job, command: Command): Promise<ExecutionResult> {
    const provider = this.providerRegistry.get(job.agentProfileId);
    if (!provider) {
      await this.jobManager.transitionJob(job.id, "failed", `Provider '${job.agentProfileId}' not registered`, {
        errorCode: "PROVIDER_NOT_FOUND",
        errorSummary: `Execution provider '${job.agentProfileId}' is not loaded.`,
      });
      throw new Error(`Execution provider '${job.agentProfileId}' is not registered`);
    }

    // Move to validated -> queued -> running
    await this.jobManager.transitionJob(job.id, "validated", "Command validated successfully");
    await this.jobManager.transitionJob(job.id, "queued", "Job placed in execution queue");
    await this.jobManager.transitionJob(job.id, "running", "Execution started with provider");

    const repoProfile = job.repositoryId
      ? await this.persistence.getRepositoryProfile(job.repositoryId)
      : null;

    try {
      const prompt = (command.arguments.prompt as string) || command.requestedAction;
      const handle = await provider.execute(
        {
          jobId: job.id,
          workspaceId: job.workspaceId,
          repositoryPath: repoProfile?.path,
          action: command.requestedAction,
          prompt,
          arguments: command.arguments,
          correlationId: job.correlationId,
        },
        {
          workingDirectory: repoProfile?.path,
        }
      );

      // Determine provider timeout from capabilities
      const capabilities = await provider.getCapabilities();
      const timeoutMs = capabilities.maxTimeoutMs || 60000;

      // Poll or wait for completion (non-blocking for external events)
      let status = await provider.getStatus(handle);
      const startTime = Date.now();

      while (status.state === "running" && Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 50));
        status = await provider.getStatus(handle);
      }

      if (status.state === "running") {
        await provider.requestCancellation(handle);
        const timeoutMsg = `Job execution timed out after ${timeoutMs}ms`;
        await this.jobManager.transitionJob(job.id, "failed", timeoutMsg, {
          errorCode: "TIMEOUT",
          errorSummary: timeoutMsg,
        });
        throw new Error(timeoutMsg);
      }

      if (status.state === "completed" && status.result) {
        await this.persistence.saveExecutionResult(status.result);
        await this.jobManager.transitionJob(job.id, "completed", "Execution finished successfully");
        return status.result;
      }

      if (status.state === "cancelled") {
        await this.jobManager.transitionJob(job.id, "cancelled", "Execution was cancelled");
        throw new Error("Job execution was cancelled");
      }

      const errorMessage = status.result?.summary || "Provider execution failed";
      await this.jobManager.transitionJob(job.id, "failed", errorMessage, {
        errorCode: status.result?.errorCode || "PROVIDER_FAILED",
        errorSummary: errorMessage,
      });

      if (status.result) {
        await this.persistence.saveExecutionResult(status.result);
        return status.result;
      }

      throw new Error(errorMessage);
    } catch (err: any) {
      logger.error({ jobId: job.id, error: err.message }, "Error during job execution");
      if (job.status !== "failed") {
        await this.jobManager.transitionJob(job.id, "failed", err.message, {
          errorCode: "EXECUTION_EXCEPTION",
          errorSummary: err.message,
        });
      }
      throw err;
    }
  }
}

import crypto from "node:crypto";
import { PersistencePort } from "../../ports/persistence.port.js";
import { ClockPort, SystemClock } from "../../ports/clock.port.js";
import {
  Job,
  JobSchema,
  JobStatus,
  canTransitionJob,
  JobStateTransition,
  Command,
} from "../../domain/index.js";
import { ConflictError, ValidationError } from "../../shared/errors/app-error.js";
import { logger } from "../../adapters/logging/logger.js";

export class JobManager {
  constructor(
    private readonly persistence: PersistencePort,
    private readonly clock: ClockPort = new SystemClock()
  ) {}

  public async createJob(command: Command): Promise<Job> {
    const idempotencyKey = `idemp-${command.sourceMessageId}-${command.commandType}`;

    const existing = await this.persistence.getJobByIdempotencyKey(idempotencyKey);
    if (existing) {
      logger.info({ jobId: existing.id, idempotencyKey }, "Job already exists for idempotency key");
      return existing;
    }

    const now = this.clock.nowIso();
    const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const job: Job = JobSchema.parse({
      id: jobId,
      schemaVersion: 1,
      workspaceId: command.workspaceId,
      commandId: command.id,
      sourceMessageId: command.sourceMessageId,
      repositoryId: command.targetRepositoryId,
      agentProfileId: command.targetAgentProfileId || "mock",
      status: "received",
      priority: 0,
      attempt: 0,
      maxAttempts: 3,
      idempotencyKey,
      correlationId: command.correlationId,
      resultRef: null,
      errorCode: null,
      errorSummary: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    });

    await this.persistence.saveJob(job);
    await this.recordTransition(job.id, "received", "received", "Initial job creation");

    return job;
  }

  public async transitionJob(
    jobId: string,
    toStatus: JobStatus,
    reason?: string,
    errorDetails?: { errorCode?: string; errorSummary?: string }
  ): Promise<Job> {
    const job = await this.persistence.getJob(jobId);
    if (!job) {
      throw new ValidationError(`Job '${jobId}' not found`);
    }

    if (!canTransitionJob(job.status, toStatus)) {
      throw new ConflictError(
        `Invalid job state transition from '${job.status}' to '${toStatus}' for job '${jobId}'`
      );
    }

    const now = this.clock.nowIso();
    const updatedJob: Job = {
      ...job,
      status: toStatus,
      updatedAt: now,
      startedAt: toStatus === "running" && !job.startedAt ? now : job.startedAt,
      completedAt:
        ["completed", "failed", "cancelled"].includes(toStatus) && !job.completedAt
          ? now
          : job.completedAt,
      errorCode: errorDetails?.errorCode ?? job.errorCode,
      errorSummary: errorDetails?.errorSummary ?? job.errorSummary,
    };

    await this.persistence.saveJob(updatedJob);
    await this.recordTransition(job.id, job.status, toStatus, reason);

    logger.info(
      { jobId, fromStatus: job.status, toStatus, correlationId: job.correlationId },
      "Job status transitioned"
    );

    return updatedJob;
  }

  public async recoverStalledJobs(): Promise<number> {
    const runningJobs = await this.persistence.listJobsByStatus("running");
    let recoveredCount = 0;

    for (const job of runningJobs) {
      logger.warn(
        { jobId: job.id, correlationId: job.correlationId },
        "Recovering interrupted running job after system restart"
      );
      await this.transitionJob(
        job.id,
        "failed",
        "Interrupted by unexpected system shutdown / restart",
        {
          errorCode: "UNEXPECTED_SYSTEM_RESTART",
          errorSummary: "Job was running when host process terminated unexpectedly.",
        }
      );
      recoveredCount++;
    }

    return recoveredCount;
  }

  private async recordTransition(
    jobId: string,
    fromStatus: JobStatus,
    toStatus: JobStatus,
    reason?: string
  ): Promise<void> {
    const transition: JobStateTransition = {
      id: `trans-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      jobId,
      fromStatus,
      toStatus,
      reason,
      occurredAt: this.clock.nowIso(),
    };
    await this.persistence.recordJobTransition(transition);
  }
}

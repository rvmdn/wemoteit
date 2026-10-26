import { OutputChannelAdapter, OutgoingDeliveryRequest } from "../../ports/output-channel.port.js";
import { ExecutionResult, Job, DeliveryAttempt } from "../../domain/index.js";
import { PersistencePort } from "../../ports/persistence.port.js";
import { redactSecrets } from "../../shared/security/redactor.js";
import { logger } from "../../adapters/logging/logger.js";

export class ResultDeliveryService {
  constructor(
    private readonly outputAdapter: OutputChannelAdapter,
    private readonly persistence?: PersistencePort
  ) {}

  public async deliverAcknowledgement(
    conversationId: string,
    workspaceId: string,
    channelConnectionId: string,
    correlationId: string,
    message: string,
    attachments?: Array<{ name: string; path: string; mimeType: string }>
  ): Promise<void> {
    const request: OutgoingDeliveryRequest = {
      id: `ack-${Date.now()}`,
      workspaceId,
      channelConnectionId,
      conversationId,
      correlationId,
      text: redactSecrets(message),
      attachments,
    };

    try {
      await this.outputAdapter.sendReply(request);
    } catch (err: any) {
      logger.error(
        { correlationId, error: err.message },
        "Failed to deliver acknowledgement reply"
      );
    }
  }

  public async deliverResult(
    job: Job,
    conversationId: string,
    channelConnectionId: string,
    result: ExecutionResult
  ): Promise<void> {
    const statusEmoji = result.status === "success" ? "✅" : "❌";
    const header = `${statusEmoji} *Job ${job.id} [${result.status.toUpperCase()}]*\n`;
    const details = `*Duration:* ${result.durationMs}ms\n*Summary:*\n${result.summary}\n`;

    let artifactsText = "";
    if (result.artifacts.length > 0) {
      artifactsText =
        `\n*Artifacts:*\n` +
        result.artifacts.map((a) => `- ${a.name} (${a.mimeType})`).join("\n");
    }

    const fullMessage = redactSecrets(`${header}${details}${artifactsText}`);

    // Bounded chunking for WhatsApp message limit (max 4000 characters)
    const chunks = this.chunkMessage(fullMessage, 4000);

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n${chunks[i]}` : chunks[i];
      const deliveryAttemptId = `deliv-${job.id}-${i}`;

      const request: OutgoingDeliveryRequest = {
        id: deliveryAttemptId,
        workspaceId: job.workspaceId,
        channelConnectionId,
        conversationId,
        correlationId: job.correlationId,
        text: chunkText,
      };

      try {
        const deliveryResult = await this.outputAdapter.sendReply(request);
        const isSuccess = deliveryResult.success;

        if (this.persistence) {
          const attemptRecord: DeliveryAttempt = {
            id: deliveryAttemptId,
            jobId: job.id,
            channelConnectionId,
            conversationId,
            status: isSuccess ? "delivered" : "failed",
            errorMessage: deliveryResult.error || null,
            attempt: 1,
            deliveredAt: isSuccess ? new Date().toISOString() : null,
            correlationId: job.correlationId,
          };
          await this.persistence.recordDeliveryAttempt(attemptRecord);
        }

        if (!isSuccess) {
          logger.warn(
            { jobId: job.id, chunkIndex: i, error: deliveryResult.error },
            "Delivery attempt returned unsuccessful status (Job execution state preserved)"
          );
        }
      } catch (err: any) {
        logger.error(
          { jobId: job.id, chunkIndex: i, error: err.message },
          "Delivery attempt threw exception (Job execution state preserved)"
        );

        if (this.persistence) {
          const failedRecord: DeliveryAttempt = {
            id: deliveryAttemptId,
            jobId: job.id,
            channelConnectionId,
            conversationId,
            status: "failed",
            errorMessage: err.message,
            attempt: 1,
            deliveredAt: null,
            correlationId: job.correlationId,
          };
          await this.persistence.recordDeliveryAttempt(failedRecord);
        }
      }
    }
  }

  public async retryFailedDelivery(attempt: DeliveryAttempt, text: string): Promise<boolean> {
    const request: OutgoingDeliveryRequest = {
      id: `${attempt.id}-retry-${attempt.attempt + 1}`,
      workspaceId: "ws-primary",
      channelConnectionId: attempt.channelConnectionId,
      conversationId: attempt.conversationId,
      correlationId: attempt.correlationId,
      text: redactSecrets(text),
    };

    try {
      const res = await this.outputAdapter.sendReply(request);
      if (res.success && this.persistence) {
        await this.persistence.recordDeliveryAttempt({
          ...attempt,
          status: "delivered",
          attempt: attempt.attempt + 1,
          deliveredAt: new Date().toISOString(),
          errorMessage: null,
        });
        return true;
      }
    } catch (err: any) {
      if (this.persistence) {
        await this.persistence.recordDeliveryAttempt({
          ...attempt,
          attempt: attempt.attempt + 1,
          errorMessage: err.message,
        });
      }
    }
    return false;
  }

  private chunkMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitIdx = remaining.lastIndexOf("\n", maxLen);
      if (splitIdx === -1 || splitIdx < maxLen / 2) {
        splitIdx = maxLen;
      }
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }
    return chunks;
  }
}

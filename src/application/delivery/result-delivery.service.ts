import { OutputChannelAdapter, OutgoingDeliveryRequest } from "../../ports/output-channel.port.js";
import { ExecutionResult, Job } from "../../domain/index.js";
import { redactSecrets } from "../../shared/security/redactor.js";
import { logger } from "../../adapters/logging/logger.js";

export class ResultDeliveryService {
  constructor(private readonly outputAdapter: OutputChannelAdapter) {}

  public async deliverAcknowledgement(
    conversationId: string,
    workspaceId: string,
    channelConnectionId: string,
    correlationId: string,
    message: string
  ): Promise<void> {
    const request: OutgoingDeliveryRequest = {
      id: `ack-${Date.now()}`,
      workspaceId,
      channelConnectionId,
      conversationId,
      correlationId,
      text: redactSecrets(message),
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
      artifactsText = `\n*Artifacts:*\n` + result.artifacts.map((a) => `- ${a.name} (${a.mimeType})`).join("\n");
    }

    const fullMessage = redactSecrets(`${header}${details}${artifactsText}`);

    // Bounded chunking for WhatsApp message limit (max 4000 characters)
    const chunks = this.chunkMessage(fullMessage, 4000);

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n${chunks[i]}` : chunks[i];
      const request: OutgoingDeliveryRequest = {
        id: `deliv-${job.id}-${i}-${Date.now()}`,
        workspaceId: job.workspaceId,
        channelConnectionId,
        conversationId,
        correlationId: job.correlationId,
        text: chunkText,
      };

      try {
        const deliveryResult = await this.outputAdapter.sendReply(request);
        if (!deliveryResult.success) {
          logger.warn(
            { jobId: job.id, chunkIndex: i, error: deliveryResult.error },
            "Delivery attempt returned unsuccessful status"
          );
        }
      } catch (err: any) {
        logger.error(
          { jobId: job.id, chunkIndex: i, error: err.message },
          "Delivery attempt threw exception (Execution state preserved)"
        );
      }
    }
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

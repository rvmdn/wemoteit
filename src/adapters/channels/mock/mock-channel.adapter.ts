import { InputChannelAdapter, ChannelHealth } from "../../../ports/input-channel.port.js";
import { OutputChannelAdapter, OutgoingDeliveryRequest, DeliveryResult } from "../../../ports/output-channel.port.js";
import { NormalizedIncomingMessage } from "../../../domain/message/message.entity.js";

export class MockChannelAdapter implements InputChannelAdapter, OutputChannelAdapter {
  public readonly provider = "mock";
  private running = false;
  private messageHandler: ((message: NormalizedIncomingMessage) => Promise<void>) | null = null;
  public readonly sentReplies: OutgoingDeliveryRequest[] = [];

  public async initialize(): Promise<void> {
    // No-op for mock
  }

  public async start(): Promise<void> {
    this.running = true;
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return {
      status: this.running ? "healthy" : "unhealthy",
      lastCheck: new Date().toISOString(),
      details: {
        sentCount: this.sentReplies.length,
      },
    };
  }

  public onMessage(handler: (message: NormalizedIncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  // Method for test fixtures to simulate incoming messages
  public async simulateIncomingMessage(message: NormalizedIncomingMessage): Promise<void> {
    if (!this.running) {
      throw new Error("MockChannelAdapter is not started");
    }
    if (!this.messageHandler) {
      throw new Error("No message handler registered on MockChannelAdapter");
    }
    await this.messageHandler(message);
  }

  // Output channel implementation
  public async sendReply(request: OutgoingDeliveryRequest): Promise<DeliveryResult> {
    this.sentReplies.push(request);
    return {
      success: true,
      deliveredMessageId: `mock-delivered-${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  }
}

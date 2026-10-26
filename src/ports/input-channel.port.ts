import { NormalizedIncomingMessage } from "../domain/message/message.entity.js";

export interface ChannelHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: string;
  details?: Record<string, unknown>;
}

export interface InputChannelAdapter {
  readonly provider: string;

  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  healthCheck(): Promise<ChannelHealth>;
  onMessage(handler: (message: NormalizedIncomingMessage) => Promise<void>): void;
}

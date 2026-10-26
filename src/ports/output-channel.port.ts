export interface OutgoingDeliveryRequest {
  id: string;
  workspaceId: string;
  channelConnectionId: string;
  conversationId: string;
  replyToProviderMessageId?: string;
  correlationId: string;
  text: string;
  attachments?: Array<{
    name: string;
    path: string;
    mimeType: string;
  }>;
}

export interface DeliveryResult {
  success: boolean;
  deliveredMessageId?: string;
  deliveredAt: string;
  error?: string;
  retryable?: boolean;
}

export interface OutputChannelAdapter {
  readonly provider: string;

  sendReply(request: OutgoingDeliveryRequest): Promise<DeliveryResult>;
}

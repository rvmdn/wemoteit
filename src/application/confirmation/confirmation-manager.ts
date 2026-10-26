export type QuickConfirmationActionType =
  | "sleep"
  | "shutdown"
  | "restart"
  | "terminate_app"
  | "run_task";

export interface PendingQuickConfirmation {
  id: string;
  conversationId: string;
  senderId: string;
  actionType: QuickConfirmationActionType;
  description: string;
  payload: Record<string, any>;
  expiresAt: number; // ms timestamp
  createdAt: number;
}

export class ConfirmationManager {
  private pendingMap: Map<string, PendingQuickConfirmation> = new Map();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = 2 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Register a pending confirmation for a specific conversation and sender
   */
  public setPending(
    conversationId: string,
    senderId: string,
    actionType: QuickConfirmationActionType,
    description: string,
    payload: Record<string, any>,
    ttlMs?: number
  ): PendingQuickConfirmation {
    const key = `${conversationId}:${senderId}`;
    const now = Date.now();
    const item: PendingQuickConfirmation = {
      id: `conf-${now}-${Math.random().toString(36).substring(2, 7)}`,
      conversationId,
      senderId,
      actionType,
      description,
      payload,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    };
    this.pendingMap.set(key, item);
    return item;
  }

  /**
   * Retrieve active pending confirmation if not expired
   */
  public getPending(conversationId: string, senderId: string): PendingQuickConfirmation | null {
    const key = `${conversationId}:${senderId}`;
    const item = this.pendingMap.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.pendingMap.delete(key);
      return null;
    }

    return item;
  }

  /**
   * Clear pending confirmation
   */
  public clearPending(conversationId: string, senderId: string): void {
    const key = `${conversationId}:${senderId}`;
    this.pendingMap.delete(key);
  }

  /**
   * Check if a text message is a single-word or short affirmative response
   */
  public isAffirmative(text: string): boolean {
    const clean = text.trim().toUpperCase().replace(/[!.,?]/g, "").replace(/\s+/g, " ");
    const affirmatives = new Set([
      "YA",
      "YES",
      "Y",
      "OKE",
      "OK",
      "SETUJU",
      "LANJUT",
      "LANJUTKAN",
      "BENAR",
      "SIAP",
      "CONFIRM",
      "BOLEH",
      "YA SILAKAN",
      "YA TOLONG",
      "YA LANJUT",
      "OKE LANJUT",
      "SIAP LANJUT",
      "OK LANJUT",
      "YA BOLEH",
      "GAS",
    ]);
    return affirmatives.has(clean);
  }

  /**
   * Check if a text message is a single-word or short negative/cancellation response
   */
  public isNegative(text: string): boolean {
    const clean = text.trim().toUpperCase().replace(/[!.,?]/g, "").replace(/\s+/g, " ");
    const negatives = new Set([
      "BATAL",
      "BATALKAN",
      "CANCEL",
      "TIDAK",
      "NO",
      "N",
      "JANGAN",
      "GA",
      "GAK",
      "ENGGAK",
      "ABORT",
      "TOLAK",
      "GAK JADI",
      "GA JADI",
      "BATAL AJA",
      "CANCEL AJA",
      "JANGAN DULU",
      "TIDAK JADI",
    ]);
    return negatives.has(clean);
  }
}

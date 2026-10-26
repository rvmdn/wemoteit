import { PersistencePort } from "../../../ports/persistence.port.js";
import { GeminiAccountInstance, GeminiAccountStatus } from "../../../domain/agent/gemini-account.entity.js";
import { logger } from "../../logging/logger.js";
import { redactSecrets } from "../../../shared/security/redactor.js";

export interface AccountPoolStats {
  totalAccounts: number;
  activeAccounts: number;
  coolingDownAccounts: number;
  exhaustedAccounts: number;
  totalRequestsToday: number;
}

export class GeminiAccountPoolManager {
  constructor(private readonly persistence: PersistencePort) {}

  /**
   * Acquire the next available healthy Gemini account.
   * Auto-recovers accounts whose cooldown period has expired.
   */
  public async acquireAccount(): Promise<GeminiAccountInstance> {
    const accounts = await this.persistence.listGeminiAccounts();
    const now = new Date();

    if (accounts.length === 0) {
      throw new Error(
        "No Gemini accounts registered in pool. Please add an API key via the Web Dashboard or config."
      );
    }

    // Auto-recover expired cooling_down accounts
    for (const acc of accounts) {
      if (acc.status === "cooling_down" && acc.cooldownUntil) {
        if (new Date(acc.cooldownUntil) <= now) {
          logger.info(
            { accountId: acc.id, label: acc.label },
            "Gemini account cooldown expired; restored to active status"
          );
          await this.persistence.updateGeminiAccountStatus(acc.id, "active", null);
          acc.status = "active";
          acc.cooldownUntil = null;
        }
      }
    }

    // Find first active account by priority
    const active = accounts.find((a) => a.status === "active");
    if (active) {
      return active;
    }

    // If none are active, find the one with the earliest cooldown expiry
    const coolingAccounts = accounts
      .filter((a) => a.status === "cooling_down" && a.cooldownUntil)
      .sort((a, b) => new Date(a.cooldownUntil!).getTime() - new Date(b.cooldownUntil!).getTime());

    if (coolingAccounts.length > 0) {
      const nextAvailable = coolingAccounts[0];
      const waitSeconds = Math.ceil(
        (new Date(nextAvailable.cooldownUntil!).getTime() - now.getTime()) / 1000
      );
      throw new Error(
        `All Gemini accounts are currently rate-limited. Next account (${nextAvailable.label}) available in ${waitSeconds}s.`
      );
    }

    throw new Error("All registered Gemini accounts are currently disabled or exhausted.");
  }

  /**
   * Report an account hitting a rate limit (HTTP 429 / QuotaExceeded).
   * Automatically places it on cooldown.
   */
  public async reportRateLimit(accountId: string, cooldownSeconds: number = 60): Promise<void> {
    const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
    logger.warn(
      { accountId, cooldownSeconds, cooldownUntil },
      "Gemini account rate limit (429) hit; placed on cooldown"
    );
    await this.persistence.updateGeminiAccountStatus(accountId, "cooling_down", cooldownUntil);
  }

  /**
   * Report successful execution on an account.
   */
  public async reportSuccess(accountId: string): Promise<void> {
    await this.persistence.incrementGeminiAccountUsage(accountId);
  }

  /**
   * Get pool statistics for Web Dashboard and status reports.
   */
  public async getStats(): Promise<AccountPoolStats> {
    const accounts = await this.persistence.listGeminiAccounts();
    return {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter((a) => a.status === "active").length,
      coolingDownAccounts: accounts.filter((a) => a.status === "cooling_down").length,
      exhaustedAccounts: accounts.filter((a) => a.status === "exhausted" || a.status === "disabled").length,
      totalRequestsToday: accounts.reduce((sum, a) => sum + (a.requestsToday || 0), 0),
    };
  }

  /**
   * List all accounts with masked API keys for secure UI presentation.
   */
  public async listMaskedAccounts(): Promise<Array<Omit<GeminiAccountInstance, "apiKey"> & { maskedKey: string }>> {
    const accounts = await this.persistence.listGeminiAccounts();
    return accounts.map((a) => {
      const key = a.apiKey;
      const maskedKey =
        key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "[REDACTED]";
      const { apiKey, ...rest } = a;
      return { ...rest, maskedKey };
    });
  }
}

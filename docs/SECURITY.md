# Security Architecture & Threat Model: wemoteit

## 1. Threat Model & Mitigations

| Threat | Risk Level | Mitigation Strategy |
|---|---|---|
| **Unauthorized Message Ingestion** (Spoofed sender, attacker messages user) | **CRITICAL** | Strict whitelist check on both `senderId` and `conversationId`. In the self-chat scenario, the incoming message must originate from the authenticated self-user account and match the registered self JID/number. All external group or unverified direct chats are rejected and dropped at ingestion. |
| **Arbitrary Command Execution / Remote Shell** | **CRITICAL** | Never allow raw shell execution from chat. Commands are parsed strictly through a closed vocabulary parser (`help`, `status`, `review_repository`, `run_task`, `job_status`). Arbitrary bash/powershell strings are rejected with an authorization error. |
| **Path Traversal & Filesystem Escapes** | **HIGH** | User cannot specify raw filesystem paths in chat messages. Targets must reference registered `repositoryId` aliases (e.g. `wedocit`, `scanwitme`). Repositories are resolved strictly to configured root directories, canonicalized using `path.resolve()`, and verified that the target path remains within boundary. |
| **Prompt Injection & Policy Overrides** | **HIGH** | Execution requests are wrapped in structured task containers with explicit system guardrails. Read-only tasks run under read-only sandboxes. Operations that write or delete files require explicit approval tokens. |
| **Secret & Token Leakage** | **HIGH** | API keys, passwords, and tokens are stored in environment variables, never committed to config files or persisted in SQLite job payloads. Logging and result delivery pipeline applies automated regex redaction to masks (e.g. `sk-***`, `Bearer ***`, API keys). |
| **Replay Attacks & Duplicate Processing** | **MEDIUM** | Every incoming message is identified by unique `(channelConnectionId, providerMessageId)` with a UNIQUE database constraint. Replayed or duplicate messages are discarded idempotently without spawning duplicate jobs. |
| **Denial of Service via Giant Payloads** | **MEDIUM** | Strict message length limits (e.g., maximum 8,000 characters) and rate limits enforced at the ingestion port. Overly large messages or unsupported binary attachments are rejected. |
| **Crash Loops & Unchecked Replays** | **MEDIUM** | Jobs interrupted by unexpected system restarts transition to `failed` (`UNEXPECTED_SYSTEM_RESTART`) rather than blindly re-executing unverified actions. |

---

## 2. Principle of Least Privilege

1. **Local User Context**: The orchestrator runs in normal user space without requiring Administrator elevation.
2. **Network Restrictions**:
   - Zero inbound listening ports open to the public internet or LAN.
   - All network traffic is outbound-only (polling WhatsApp Web or connecting via local loopback).
3. **Execution Sandboxing**:
   - Agent execution operates with explicit capability grants (e.g. `allowedOperations: ["read", "review"]`).
   - Destructive operations are disallowed unless explicitly unlocked.

---

## 3. Secret Redaction Pipeline

All text emitted to logs, persisted to audit tables, or returned to WhatsApp passes through a redaction filter matching:
- High-entropy tokens (`[A-Za-z0-9_-]{32,}`)
- Bearer tokens (`Bearer\s+[A-Za-z0-9._-]+`)
- API keys (`(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["']?([^"' \r\n]+)`)
- Cloud service credentials (Google, OpenAI, Anthropic, AWS tokens)

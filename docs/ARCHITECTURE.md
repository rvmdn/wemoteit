# Architectural Specification: wemoteit

## 1. System Overview

`wemoteit` is a local-first, extensible orchestration platform for Windows. It receives commands from messaging channels (initially WhatsApp self-chat), normalizes and authorizes them against strict security policies, schedules them as durable jobs in SQLite, executes them via designated execution providers (such as Google Antigravity IDE, Google Gemini Multi-Account Pool, or native Windows automation), and delivers execution summaries and media directly back to the user's messaging channel.

```text
+-----------------------------------------------------------------------------------+
|                                 INPUT CHANNELS                                    |
|   +------------------------------------+   +----------------------------------+   |
|   |  WhatsApp Channel Adapter          |   |  Web Dashboard UI                |   |
|   |  (WhatsApp Web Automation / Local) |   |  (http://localhost:3100)         |   |
|   +-----------------+------------------+   +----------------+-----------------+   |
|                     |                                       |                     |
+---------------------|---------------------------------------|---------------------+
                      | NormalizedIncomingMessage             | REST / WebSocket
                      v                                       v
+-----------------------------------------------------------------------------------+
|                              APPLICATION CORE                                     |
|                                                                                   |
|  1. Ingestion, Deduplication & Echo Suppression:                                  |
|     - Validates schema against Zod definitions                                    |
|     - Deduplicates via (channelConnectionId, providerMessageId)                   |
|     - Echo filter suppresses bot notifications in self-chat                       |
|                                                                                   |
|  2. Dual-Engine Routing Pipeline:                                                 |
|     - Fast-Path Engine: Instant regex execution for slash commands (/status, etc.)|
|     - NLU Copilot Engine: Gemini Function Calling for conversational language     |
|     - Short-term context memory (retains last 3-4 interactions)                   |
|                                                                                   |
|  3. Two-Tier Authorization & Confirmation Manager:                                |
|     - Validates workspace ownership, sender identity, and conversation ID         |
|     - Tier 1 (Safe): Auto-approved (reviews, status, screenshots, app launch)    |
|     - Tier 2 (Destructive): Gated by ConfirmationManager (2-min TTL)              |
|       Accepts conversational quick replies (YA / BATAL) or legacy /approve tokens |
|                                                                                   |
|  4. Durable Job Manager & State Machine:                                          |
|     - Persisted to SQLite (received -> validated -> queued -> running -> done)   |
|     - Recovers stalled / queued jobs on system reboot                             |
|                                                                                   |
|  5. Execution Coordinator & Result Delivery:                                      |
|     - Dispatches to Antigravity IDE, Gemini Pool, or Windows Action Adapter       |
|     - Result delivery worker handles text formatting and media attachments        |
|     - Delivery failures are isolated from underlying job outcomes                 |
+-----------------------------------------------------------------------------------+
       |                                   |                              |
       v                                   v                              v
+---------------------+   +--------------------------------+   +--------------------+
|  PERSISTENCE LAYER  |   |      EXECUTION PROVIDERS       |   |   WINDOWS ACTIONS  |
|  SQLite (WAL Mode)  |   |  - Antigravity IDE CLI         |   |  - Apps Launcher   |
|  - Workspaces       |   |  - Gemini Multi-Account Pool   |   |  - Process Killer  |
|  - Messages & Jobs  |   |    (5 accounts failover/429)   |   |  - Hardware Stats  |
|  - Gemini Accounts  |   |  - Mock Execution Provider     |   |  - Power/Sleep/Lock|
|  - Audit Log        |   |                                |   |  - Screen Captures |
+---------------------+   +--------------------------------+   +--------------------+
```

---

## 2. Hexagonal Ports & Adapters Architecture

### Core Inbound Ports
- **`InputChannelAdapter`**:
  - `initialize(): Promise<void>`
  - `start(): Promise<void>`
  - `stop(): Promise<void>`
  - `healthCheck(): Promise<ChannelHealth>`
  - `onMessage(handler: (msg: NormalizedIncomingMessage) => Promise<void>): void`

### Core Outbound Ports
- **`OutputChannelAdapter`**:
  - `sendReply(reply: OutgoingDeliveryRequest): Promise<DeliveryResult>`
- **`ExecutionProvider`**:
  - `getCapabilities(): Promise<ExecutionCapabilities>`
  - `execute(request: ExecutionRequest, ctx: ExecutionContext): Promise<ExecutionHandle>`
  - `getStatus(handle: ExecutionHandle): Promise<ExecutionStatus>`
  - `requestCancellation(handle: ExecutionHandle): Promise<CancellationResult>`
- **`PersistencePort`**:
  - Encapsulates type-safe SQLite transactions, migrations, and repositories for workspaces, repositories, commands, jobs, audit events, approvals, and Gemini pool accounts.

---

## 3. Two-Tier Policy & Confirmation Engine

```text
[Incoming Message]
       │
       ▼
[Sender Allowlist Check] ──(Not Authorized)──► [Drop / Audit Reject]
       │
       ▼
[Routing Engine: Slash Command or NLU Intent]
       │
       ├──► Tier 1 (Safe: review, status, capture_screen, launch_app, lock) ──► [Immediate Execution]
       │
       └──► Tier 2 (Destructive: sleep, terminate_app, /run mutating task)
              │
              ▼
       [Register Pending in ConfirmationManager (TTL: 2 Minutes)]
              │
              ▼
       [Prompt User on WhatsApp: "Balas YA dalam 2 menit, atau BATAL"]
              │
              ├──► Operator replies "YA" / "YES" / "OKE" ──► [Execute Job]
              ├──► Operator replies "BATAL" / "CANCEL"    ──► [Cancel & Clear]
              └──► 2 Minutes Expire                       ──► [Auto-Discard]
```

---

## 4. Multi-Account Gemini Pool Engine

- Maintains up to 5 Google Gemini accounts in SQLite (`gemini_account_instances`).
- Account states: `active`, `cooling_down` (60s on HTTP 429/503), `exhausted`, `disabled`.
- Dynamic failover: when an account encounters `RESOURCE_EXHAUSTED` (HTTP 429), it enters cooldown and the request is instantly retried with the next priority account.
- Secret keys are masked in database representations, dashboard views, and logs.

---

## 5. Job State Machine & Crash Recovery

```text
  [received]
      │
      ▼
  [validated] ───────────────► [failed]
      │                           ▲
      ▼                           │ (error / timeout)
   [queued]  ─────────────────────┤
      │                           │
      ▼                           │
  [running]  ─────────────────────┤
      │                           │
      ├──────────────────────────► [cancel_requested] ──► [cancelled]
      │
      ▼
  [completed]
```

### Safety & Crash Recovery Rules
- Upon startup, any job left in `running` state is marked as `failed` (reason: `UNEXPECTED_SYSTEM_RESTART`) rather than blindly replaying potentially destructive actions.
- Any job in `queued` state is evaluated against its idempotency key and queue policy before rescheduling.
- Every state transition is recorded in the `job_state_transitions` table with UTC timestamp and actor.

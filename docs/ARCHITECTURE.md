# Architectural Specification: wemoteit

## 1. System Overview

`wemoteit` is a local-first, extensible orchestration platform for Windows. It receives commands from messaging channels (initially WhatsApp self-chat), normalizes and authorizes them against strict security policies, schedules them as durable jobs in SQLite, executes them via designated execution providers (such as Antigravity AI IDE or local runners), and delivers execution summaries back to the user's messaging channel.

```text
+-----------------------------------------------------------------------------------+
|                                 INPUT CHANNELS                                    |
|   +------------------------------------+   +----------------------------------+   |
|   |  WhatsApp Channel Adapter          |   |  Mock / Future Channels          |   |
|   |  (WhatsApp Web Automation / Local) |   |  (Telegram, CLI, Webhook, etc.)  |   |
|   +-----------------+------------------+   +----------------+-----------------+   |
+---------------------|---------------------------------------|---------------------+
                      | NormalizedIncomingMessage             |
                      v                                       v
+-----------------------------------------------------------------------------------+
|                              APPLICATION CORE                                     |
|                                                                                   |
|  1. Ingestion & Deduplication:                                                    |
|     - Validates schema against Zod definitions                                    |
|     - Deduplicates via providerMessageId & idempotencyKey                         |
|                                                                                   |
|  2. Authorization & Policy Engine:                                                |
|     - Validates workspace ownership, sender identity, and conversation ID         |
|     - Restricts commands to allowlist (`help`, `status`, `run_task`, etc.)        |
|     - Validates target repository against registered RepositoryProfiles           |
|     - Enforces capability gates (Read-only auto-allowed; modifications gated)     |
|                                                                                   |
|  3. Job Manager & State Machine:                                                  |
|     - Durable Job entity persisted to SQLite                                      |
|     - Transitions: received -> validated -> queued -> running -> completed/failed|
|     - Recovers stalled / queued jobs on application restart                       |
|                                                                                   |
|  4. Execution Coordinator:                                                        |
|     - Resolves registered AgentProfile                                            |
|     - Invokes ExecutionProvider asynchronously without blocking message ingestion |
|                                                                                   |
|  5. Result Delivery Worker:                                                       |
|     - Normalizes ExecutionResult (bounded output, artifacts, secret redaction)    |
|     - Returns structured reply to originating channel connection                  |
|     - Separates delivery failure from execution failure                           |
+-----------------------------------------------------------------------------------+
                      |                                       |
                      v                                       v
+------------------------------------+   +------------------------------------------+
|        PERSISTENCE LAYER           |   |           EXECUTION PROVIDERS            |
|  +------------------------------+  |   |  +------------------------------------+  |
|  |  SQLite Database             |  |   |  |  Antigravity Execution Provider    |  |
|  |  - Workspaces                |  |   |  |  - Workspace context               |  |
|  |  - Messages & Commands       |  |   |  |  - CLI / SDK / UI Adapter          |  |
|  |  - Repositories & Profiles   |  |   |  +------------------------------------+  |
|  |  - Jobs & Transitions        |  |   |  +------------------------------------+  |
|  |  - Results & Artifacts       |  |   |  |  Mock Execution Provider           |  |
|  |  - Audit Log (append-only)   |  |   |  |  - Deterministic test harness      |  |
|  +------------------------------+  |   |  +------------------------------------+  |
+------------------------------------+   +------------------------------------------+
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
  - Encapsulates type-safe SQLite transactions, migrations, and repositories for all domain aggregates.

---

## 3. Job State Machine

Jobs strictly follow the verified state machine:
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

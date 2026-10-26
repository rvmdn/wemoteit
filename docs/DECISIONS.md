# Architectural Decision Records (ADRs)

## ADR-001: Local-First Runtime & Language Choice
- **Status**: Accepted
- **Context**: The orchestrator must run reliably on a Windows 11 host, manage local agent processes, interface with local browsers/WhatsApp, and persist state safely.
- **Decision**: Use Node.js 22 LTS with strict TypeScript (`tsconfig.json` `strict: true`, ES2022 target, ESM module resolution) and `tsx` for high-velocity local execution.
- **Consequences**: Fast native asynchronous execution, rich ecosystem for browser automation (Playwright/Puppeteer), strong type safety, and zero external daemon runtime requirements.

---

## ADR-002: WhatsApp Integration Strategy
- **Status**: Accepted
- **Context**: The primary user journey is messaging oneself ("Message yourself" chat) from a phone and having the message processed on the desktop.
- **Options Evaluated**:
  1. *Meta Cloud API*: Rejected for MVP. Requires Meta Business verification, custom domain webhooks, and separate phone numbers. Cannot access personal WhatsApp user-to-self chat.
  2. *Reverse-engineered WebSocket libraries (e.g., Baileys / WPPConnect)*: High risk of account ban / suspension; frequent protocol desynchronization.
  3. *Browser Automation of WhatsApp Web via Playwright / Puppeteer with Persistent Profile*: Preferred. Runs real Chrome/Edge with a dedicated local user data directory. The user scans the QR code once. Operates in the user's local security context with lowest account risk.
- **Decision**: Define clean generic `InputChannelAdapter` and `OutputChannelAdapter` interfaces. Implement a deterministic `MockChannelAdapter` for unit/integration tests and development, and implement the WhatsApp Web browser adapter for live testing.

---

## ADR-003: Antigravity Execution Provider Strategy
- **Status**: Accepted
- **Context**: Antigravity is an AI development platform with multiple surfaces (VS Code-based Antigravity IDE, Antigravity 2.0 desktop Electron app, `agy` CLI, and `google-antigravity` Python SDK).
- **Decision**: Define an explicit `ExecutionProvider` interface. Implement `MockExecutionProvider` with deterministic test fixtures (success, syntax error, timeouts, cancellation) for hermetic tests. Scaffold `AntigravityExecutionProvider` with configurable execution targets (CLI execution or local SDK bridge) marked as pending validation until verified against the host environment.
- **Consequences**: Tests remain 100% deterministic and do not depend on external AI rate limits or network availability.

---

## ADR-004: Persistence Engine
- **Status**: Accepted
- **Context**: Durable job queue, idempotency tracking, audit logging, and message archiving are required without external database servers (e.g. Postgres, Redis).
- **Decision**: Use SQLite with `better-sqlite3`. Enable WAL mode (`PRAGMA journal_mode = WAL`), foreign keys, and synchronous NORMAL.
- **Consequences**: Zero network latency, single-file durable storage, full ACID transactions, and zero external services to install.

---

## ADR-005: Authorization & Least Privilege Policy
- **Status**: Accepted
- **Context**: Exposing an execution environment to a chat interface presents serious prompt injection and unauthorized execution risks.
- **Decision**:
  1. Strict Sender Verification: Only messages matching the configured `authorizedSenderId` and `authorizedConversationId` are processed.
  2. Strict Repository Boundary: Only repositories explicitly declared in `config/repositories.yaml` can be targeted. Absolute path canonicalization (`path.resolve()`) is enforced to prevent path traversal.
  3. Command Allowlisting: Only known actions (`help`, `status`, `review_repository`, `run_task`, `job_status`) are permitted.
  4. Non-Destructive Default: Read-only tasks run automatically; modifying tasks require explicit approval token or configured policy flag.

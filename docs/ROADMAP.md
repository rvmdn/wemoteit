# Implementation Roadmap: wemoteit

## Phase 0: Discovery, Environment Verification & System Design (CURRENT)
- [x] Inspect local Windows environment, Node.js runtime, tools.
- [x] Analyze WhatsApp integration paths (WhatsApp Web vs Baileys vs Cloud API).
- [x] Analyze Antigravity integration surfaces (`agy` CLI, Python SDK, IDE).
- [x] Create core architectural specifications, ADRs, threat model, and roadmap.

## Phase 1: Core Foundation & Domain Model (IN PROGRESS)
- [ ] Configure TypeScript, strict type safety, tsconfig, package scripts.
- [ ] Implement typed domain entities with Zod schemas (`Workspace`, `Channel`, `Message`, `Command`, `Repository`, `Agent`, `Job`, `Result`, `Audit`).
- [ ] Implement SQLite migrations engine & schema tables.
- [ ] Implement structured logging with Pino (with secret redaction).
- [ ] Implement `MockChannelAdapter` and `MockExecutionProvider`.
- [ ] Implement CLI health & diagnostic commands (`wemoteit status`, `wemoteit inspect-jobs`).
- [ ] Unit & contract test suite for domain, state machine, idempotency, and SQLite persistence.

## Phase 2: WhatsApp Listener Proof of Concept
- [ ] Browser automation adapter for WhatsApp Web (`whatsapp-web-adapter.ts`).
- [ ] Persistent user session directory configuration.
- [ ] Self-chat conversation selector & incoming message stream.
- [ ] Deduplication & historical message filtering (ignore old messages on startup).
- [ ] Proof-of-concept validation: send test message from phone, assert exactly-once event reception.

## Phase 3: Command Ingestion & Authorization Pipeline
- [ ] Message normalization to `NormalizedIncomingMessage`.
- [ ] Sender, conversation, and workspace identity verification.
- [ ] Command parser (`/status`, `/help`, `/run <repo> <prompt>`, `/jobs`).
- [ ] Path canonicalization & repository boundary validation.
- [ ] Capability authorization & approval token gate.
- [ ] Durable job creation & immediate WhatsApp acknowledgement reply.

## Phase 4: Antigravity Execution Adapter
- [ ] Implement execution bridge adapter with timeouts and cancellation tokens.
- [ ] Workspace context propagation (`targetRepositoryId` mapping).
- [ ] Non-blocking execution polling & status tracking.
- [ ] Output artifact capture & bounded result truncation.
- [ ] Error isolation & crash handling.

## Phase 5: End-to-End Orchestration & Result Delivery
- [ ] Output delivery worker with independent retry queue.
- [ ] Message formatting & chunking for WhatsApp message limits (4096 chars).
- [ ] Full correlation tracking from message ingestion to delivered result.
- [ ] Recovery test: simulate process kill during job execution, assert non-destructive restart.

## Phase 6: Hardening, Operational Setup & Documentation
- [x] Comprehensive security regression suite (prompt injection, path traversal, replay attacks).
- [x] Configuration validation tooling.
- [x] Operator runbook & QR code setup documentation.
- [x] Graceful termination handling (`SIGINT` / `SIGTERM`).

## Phase 7: Web Management Dashboard & Account Security Gate
- [x] Lightweight HTTP REST Server (`src/interfaces/web/server.ts`).
- [x] Interactive Control Dashboard Web UI (`src/interfaces/web/public/index.html`).
- [x] Playwright QR code canvas extraction & non-blocking login monitoring.
- [x] Account locking & sender whitelist persistence (`config/channels.yaml`).
- [x] Live job queue inspection & 1-click token approval (`/approve APP-XXXX`).
- [x] CLI entrypoint (`npm run dashboard` / `wemoteit dashboard`).
- [x] Vitest automated test suite covering all dashboard APIs (53 passing tests).

## Phase 8 (Backlog / Future Development): Native Multi-Account Gemini Pool
- [ ] Direct `@google/genai` standalone agent integration inside wemoteit (native function calling for file exploration, editing, test execution).
- [ ] Multi-account quota pooling (up to 5 Google accounts).
- [ ] Circuit breaker & automatic HTTP 429 failover ("amunisi cadangan" quota rotation).
- [ ] Multi-instance OAuth / API Key credential manager in Web Dashboard.


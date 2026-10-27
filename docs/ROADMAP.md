# Implementation Roadmap: wemoteit

## Phase 0: Discovery, Environment Verification & System Design
- [x] Inspect local Windows environment, Node.js runtime, tools.
- [x] Analyze WhatsApp integration paths (WhatsApp Web vs Baileys vs Cloud API).
- [x] Analyze Antigravity integration surfaces (`agy` CLI, Python SDK, IDE).
- [x] Create core architectural specifications, ADRs, threat model, and roadmap.

## Phase 1: Core Foundation & Domain Model
- [x] Configure TypeScript, strict type safety, tsconfig, package scripts.
- [x] Implement typed domain entities with Zod schemas (`Workspace`, `Channel`, `Message`, `Command`, `Repository`, `Agent`, `Job`, `Result`, `Audit`).
- [x] Implement SQLite migrations engine & schema tables (`001_initial_schema.sql`).
- [x] Implement structured logging with Pino (with secret redaction).
- [x] Implement `MockChannelAdapter` and `MockExecutionProvider`.
- [x] Implement CLI health & diagnostic commands (`wemoteit status`, `wemoteit inspect-jobs`, `wemoteit test-pipeline`).
- [x] Unit & contract test suite for domain, state machine, idempotency, and SQLite persistence.

## Phase 2: WhatsApp Listener Proof of Concept
- [x] Browser automation adapter for WhatsApp Web (`whatsapp-web-adapter.ts`) via Playwright.
- [x] Persistent user session directory configuration (`./data/whatsapp_session`).
- [x] Self-chat conversation selector & incoming message stream.
- [x] Deduplication & historical message filtering (ignore old messages on startup).
- [x] Proof-of-concept validation: send test message from phone, assert exactly-once event reception.

## Phase 3: Command Ingestion & Authorization Pipeline
- [x] Message normalization to `NormalizedIncomingMessage`.
- [x] Sender, conversation, and workspace identity verification.
- [x] Command parser (`/status`, `/help`, `/run <repo> <prompt>`, `/repos`, `/jobs`, `/job <id>`, `/cancel`).
- [x] Path canonicalization & repository boundary validation (`path.resolve()`).
- [x] Capability authorization & approval token gate (`pending_approvals` table, 15-min TTL).
- [x] Durable job creation & immediate WhatsApp acknowledgement reply.

## Phase 4: Antigravity Execution Adapter
- [x] Implement execution bridge adapter with timeouts and cancellation tokens (`antigravity-execution.provider.ts`).
- [x] Discovered local Antigravity IDE 1.107.0 CLI binary (`antigravity-ide.cmd`).
- [x] Workspace context propagation (`targetRepositoryId` mapping).
- [x] Non-blocking execution polling & status tracking.
- [x] Output artifact capture & bounded result truncation.
- [x] Error isolation & crash handling.

## Phase 5: End-to-End Orchestration & Result Delivery
- [x] Output delivery worker (`result-delivery.service.ts`) with independent retry queue.
- [x] Message formatting & chunking for WhatsApp message limits (4096 chars).
- [x] Full correlation tracking from message ingestion to delivered result (`correlationId`).
- [x] Recovery test: simulate process kill during job execution, assert non-destructive restart.

## Phase 6: Hardening, Operational Setup & Documentation
- [x] Comprehensive security regression suite (prompt injection, path traversal, replay attacks).
- [x] Configuration validation tooling (`config.service.ts`).
- [x] Operator runbook & QR code setup documentation (`docs/OPERATIONS.md`).
- [x] Graceful termination handling (`SIGINT` / `SIGTERM`) via `LifecycleManager`.

## Phase 7: Web Management Dashboard & Account Security Gate
- [x] Lightweight native HTTP REST Server (`src/interfaces/web/server.ts`).
- [x] Interactive Control Dashboard Web UI (`src/interfaces/web/public/index.html`) on port 3100.
- [x] Playwright QR code canvas extraction & non-blocking login monitoring.
- [x] Account locking & sender whitelist persistence (`config/channels.yaml`).
- [x] Live job queue inspection & 1-click token approval (`/approve APP-XXXX`).
- [x] CLI entrypoint (`npm run dashboard` / `wemoteit dashboard`).
- [x] Vitest automated test suite covering all dashboard APIs.

## Phase 8: Multi-Account Gemini Pool Engine & Hardening
- [x] Standalone Gemini execution provider (`GeminiExecutionProvider`) via direct REST API without heavy external dependencies.
- [x] Multi-account failover pool for up to 5 Google Gemini accounts (`gemini-account-pool.ts`).
- [x] Persistent schema for pool instances (`migrations/003_gemini_accounts.sql`).
- [x] Circuit breaker & automatic HTTP 429/503 failover with 60-second cooldown and daily request tracking.
- [x] Web Dashboard tab "AI Account Pool" with live status badges, ping test console, and token masking.

## Phase 9: Natural Language Intent Router (NLU Copilot)
- [x] Gemini Function Calling schema (`FunctionDeclaration`) for structured command mapping.
- [x] Dual-Engine router (`GeminiIntentRouter`): instant fast-path for slash commands, intelligent parsing for natural language.
- [x] Short-term context memory (`getRecentMessages`) preserving conversation continuity.
- [x] Mapping conversational requests to Windows actions and coding operations.

## Phase 10: Windows OS Automation Provider & Media Delivery
- [x] Safe desktop application launcher (`launchApp`) with argument sanitization against shell injection.
- [x] Application termination controller (`terminateApp`) with strict process whitelist.
- [x] Windows hardware health & metrics (`getSystemStatus`: Battery, RAM, CPU, and Disk partitions).
- [x] Power scheduler (`schedulePower`): Instant Sleep, Lock Workstation, Stay-Awake anti-sleep, and scheduled sleep via `schtasks`.
- [x] High-resolution desktop screenshot capture (`captureScreen`) and direct WhatsApp media attachment delivery.
- [x] Automated screenshot storage cleanup (keeping latest 30 files).

## Phase 11: Two-Tier Confirmation & Security Hardening
- [x] Tiered Policy Enforcement: Tier 1 (Safe / Auto-Approve) vs Tier 2 (Destructive / Power / Mutating Actions).
- [x] Conversational Quick Confirmation (`ConfirmationManager`) with 2-minute TTL.
- [x] Natural Indonesian & English affirmative (`YA`, `YES`, `OKE`, `SETUJU`, `LANJUT`, `SIAP`) and negative (`BATAL`, `CANCEL`, `TIDAK`, `NO`) recognition.
- [x] Full backward compatibility for `/approve <token>` slash commands.
- [x] WhatsApp self-chat echo prevention regex filter.
- [x] Recursive Windows process tree termination (`taskkill /T /F`) for agent timeouts and cancellations.

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
  3. *Browser Automation of WhatsApp Web via Playwright with Persistent Profile*: Preferred. Runs real Chrome/Edge with a dedicated local user data directory. The user scans the QR code once. Operates in the user's local security context with lowest account risk.
- **Decision**: Define clean generic `InputChannelAdapter` and `OutputChannelAdapter` interfaces. Implement a deterministic `MockChannelAdapter` for unit/integration tests and development, and implement the WhatsApp Web browser adapter for live testing.

---

## ADR-003: Antigravity Execution Provider Strategy
- **Status**: Accepted
- **Context**: Antigravity is an AI development platform with multiple surfaces (VS Code-based Antigravity IDE, Antigravity 2.0 desktop Electron app, `agy` CLI, and `google-antigravity` Python SDK).
- **Decision**: Define an explicit `ExecutionProvider` interface. Implement `MockExecutionProvider` with deterministic test fixtures (success, syntax error, timeouts, cancellation) for hermetic tests. Scaffold `AntigravityExecutionProvider` targeting the discovered local Antigravity IDE CLI binary (`antigravity-ide.cmd`). Implement safe process tree termination via `taskkill /T /F` on Windows to prevent orphaned background processes.
- **Consequences**: Tests remain 100% deterministic, and production agent jobs execute directly inside the operator's active IDE context without process leaks.

---

## ADR-004: Persistence Engine
- **Status**: Accepted
- **Context**: Durable job queue, idempotency tracking, audit logging, and message archiving are required without external database servers (e.g. Postgres, Redis).
- **Decision**: Use Node.js 22 built-in `node:sqlite` (`DatabaseSync`). Enable WAL mode (`PRAGMA journal_mode = WAL`), foreign keys, and synchronous NORMAL.
- **Consequences**: Zero network latency, single-file durable storage, full ACID transactions, and zero external services or native binary rebuild dependencies.

---

## ADR-005: Authorization & Least Privilege Policy
- **Status**: Accepted
- **Context**: Exposing an execution environment to a chat interface presents serious prompt injection and unauthorized execution risks.
- **Decision**:
  1. Strict Sender Verification: Only messages matching the configured `authorizedSenderId` and `authorizedConversationId` are processed.
  2. Strict Repository Boundary: Only repositories explicitly declared in `config/repositories.yaml` can be targeted. Absolute path canonicalization (`path.resolve()`) is enforced to prevent path traversal.
  3. Command Allowlisting: Only known actions (`help`, `status`, `review_repository`, `run_task`, `job_status`) are permitted.
  4. Non-Destructive Default: Read-only tasks run automatically; modifying tasks require explicit approval token or configured policy flag.

---

## ADR-006: Web Management Dashboard Architecture (Phase 7)
- **Status**: Accepted
- **Context**: Operators need a zero-friction way to visually pair WhatsApp via QR code, lock their authorized phone number, monitor running agent jobs, and approve pending mutating actions without relying solely on CLI terminal commands.
- **Decision**: Implement a native, lightweight HTTP REST server (`DashboardWebServer`) running on `http://localhost:3100` serving a responsive Vanilla HTML/CSS/JS dashboard without heavy frontend build steps.
- **Consequences**: Operators gain visual pairing and live monitoring with zero build overhead, accessible locally and securely bounded to loopback.

---

## ADR-007: Multi-Account Gemini Pool Engine (Phase 8)
- **Status**: Accepted
- **Context**: Free-tier Google Gemini API accounts are subject to rate limits (HTTP 429 / RESOURCE_EXHAUSTED) and occasional model overload (HTTP 503). Tasks should not fail when an individual key hits its quota limit.
- **Decision**: Implement `GeminiAccountPoolManager` supporting up to 5 Google Gemini accounts stored in SQLite (`gemini_account_instances`). Maintain daily usage counts and automatic 60-second cooldown triggers on 429/503 errors, instantly routing requests to the next healthy standby account without interrupting in-flight user jobs. All keys are encrypted/masked in logs and dashboard views.
- **Consequences**: Seamless high-availability AI agent reviews without incurring API costs.

---

## ADR-008: Dual-Engine NLU Intent Router (Phase 9)
- **Status**: Accepted
- **Context**: Mobile WhatsApp users communicate in natural, conversational Indonesian or English (e.g. *"review wedocit apa ini"*, *"nyalakan teams"*, *"baterai laptop tinggal berapa"*). Rigid slash commands alone create high friction on mobile touchscreens.
- **Decision**: Build a Dual-Engine router:
  1. *Fast-Path Engine*: Commands starting with `/` (`/review`, `/status`, `/help`, etc.) execute immediately via deterministic regex with zero latency.
  2. *NLU Copilot Engine*: Natural language messages are routed through `GeminiIntentRouter` using official Gemini Function Calling schemas to map intents to system actions or repository operations.
- **Consequences**: Retains instant speed and reliability for automated scripts while providing an intelligent conversational interface for mobile users.

---

## ADR-009: Windows OS Automation Provider & Media Delivery (Phase 10)
- **Status**: Accepted
- **Context**: Remote PC management requires safe OS-level automation: launching and closing desktop apps, checking hardware metrics (battery, memory, CPU, disk), power control (sleep, lock, awake), and desktop visual verification via screenshots delivered to WhatsApp.
- **Decision**: Implement `WindowsActionAdapter` using native PowerShell and Windows API commands without external dependencies:
  1. Safe application launching (`Start-Process`) with argument sanitization against shell injection.
  2. Whitelist-bounded process termination (`terminateApp`).
  3. Hardware telemetries via CIM/WMI (`Win32_Battery`, `Win32_OperatingSystem`, `Win32_Processor`, `Win32_LogicalDisk`).
  4. Full-screen capture via .NET `System.Drawing` and native WhatsApp file input delivery via Playwright.
- **Consequences**: Rich, native Windows automation with zero third-party agent daemon overhead.

---

## ADR-010: Two-Tier Confirmation Policy & Conversational Quick Approval (Phase 11)
- **Status**: Accepted
- **Context**: Typing token strings like `/approve APP-99A1` on mobile keyboards is awkward. However, executing destructive commands (killing processes, sleeping PC, mutating repositories) without confirmation poses severe operational safety risks.
- **Decision**: Introduce a Two-Tier Security Policy and `ConfirmationManager`:
  - **Tier 1 (Safe / Auto-Approve)**: Read-only inquiries, status checks, app launches, screen captures, lock screen, and stay-awake execute automatically.
  - **Tier 2 (Destructive / Mutating Actions)**: Sleep/shutdown, killing apps, and `/run` code changes prompt the operator:
    > *"⚠️ Konfirmasi: Laptop Anda akan masuk mode Sleep pada pukul 23:00 WIB. Balas **YA** dalam 2 menit untuk melanjutkan, atau **BATAL** untuk membatalkan."*
  - The state machine accepts natural affirmative (`YA`, `YES`, `OKE`, `SETUJU`, `LANJUT`, `SIAP`) or negative (`BATAL`, `CANCEL`, `TIDAK`, `NO`) single-word or short replies within a 2-minute TTL.
  - Backward compatibility for `/approve <token>` is strictly preserved.
- **Consequences**: Maximum operational safety combined with effortless mobile-friendly confirmation.

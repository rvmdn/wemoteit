# wemoteit — WhatsApp AI Agent Orchestrator

> **Local-first, extensible orchestration platform for controlling AI coding agents on Windows via WhatsApp self-chat.**

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green.svg)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-lightgrey.svg)](https://sqlite.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

---

## Overview

`wemoteit` bridges personal messaging channels (WhatsApp self-chat) with desktop AI developer environments (Google Antigravity IDE) running on your local Windows PC.

Send natural language commands and reviews from your mobile phone while away from your desk, track progress in real-time, enforce approval gates before modifying code, and receive execution summaries directly in WhatsApp.

```text
WHATSAPP (Phone) ──► WHATSAPP WEB (Local PC) ──► NORMALIZATION & SECURITY GATE
                                                         │
                                                         ▼
WHATSAPP (Phone) ◄── RESULT DELIVERY ◄── DURABLE JOB ◄── COMMAND ROUTER ──► ANTIGRAVITY IDE
```

---

## Key Architecture & Features

- **Hexagonal / Ports & Adapters Architecture**: Generic `InputChannelAdapter`, `OutputChannelAdapter`, and `ExecutionProvider` ports ensure zero coupling between WhatsApp, Antigravity, and business logic.
- **Strict Security Boundaries**:
  - Closed-vocabulary command parsing (`/help`, `/status`, `/repos`, `/jobs`, `/job`, `/review`, `/run`, `/approve`, `/cancel`).
  - Strict sender & conversation allowlists.
  - Zero arbitrary shell execution.
  - Path traversal & repository boundary escape prevention (`../`, `..\`).
  - Automated secret redaction (Bearer tokens, OpenAI keys, Google API keys, passwords) across all logs and messages.
- **Approval Gate Workflow**:
  - Mutating tasks (`/run <repo> <prompt>`) demand explicit approval.
  - Generates token `APP-XXXX` with 15-minute TTL.
  - Operator confirms via `/approve APP-XXXX` from their phone to start execution.
- **Durable Persistence & Crash Safety**:
  - Node.js 22 built-in `node:sqlite` (`DatabaseSync`) in WAL mode.
  - State machine: `received -> validated -> queued -> running -> completed`.
  - Stalled running jobs automatically transition to `failed: UNEXPECTED_SYSTEM_RESTART` on reboot rather than replaying destructive operations.
- **Delivery Failure Separation**:
  - Transient WhatsApp network disconnects do not fail or rerun completed agent jobs. Independent retry queue provided.
- **End-to-End Traceability**:
  - Every interaction carries a single `correlationId` traceable across messages, commands, jobs, state transitions, delivery attempts, and audit events.

---

## Quick Start

### 1. Installation
Clone the repository and install dependencies:
```powershell
git clone https://github.com/rvmdn/wemoteit.git
cd wemoteit
npm install
npm run build
```

### 2. Verify System Status
```powershell
npm run cli -- status
```

### 3. Run Hermetic Test Pipeline
Execute an offline, end-to-end simulated run without requiring WhatsApp or Antigravity:
```powershell
npm run cli -- test-pipeline
```

### 4. Launch Interactive Web Dashboard (Recommended)
Launch the visual Web Dashboard to link your browser, scan QR code, and lock authorized accounts:
```powershell
npm run dashboard
```
*Open [http://localhost:3100](http://localhost:3100) in your browser.*

### 5. Link WhatsApp via CLI (Alternative)
Launch the visual helper and scan the QR code using WhatsApp on your phone:
```powershell
npm run cli -- login-whatsapp
```
*Once scanned, press `Ctrl+C`. Credentials are saved to `./data/whatsapp_session`.*

### 6. Start Headless Orchestrator Daemon
```powershell
npm run cli -- start-whatsapp
```

---

## Chat Commands

| Command | Action |
|---|---|
| `/help` | Display list of commands and syntax |
| `/status` | View system health, active jobs, and queued tasks |
| `/repos` | List authorized local repositories |
| `/jobs` | View recent job history |
| `/job <jobId>` | Inspect state transitions and result details for a specific job |
| `/review <repo> [prompt]` | Read-only codebase review (auto-authorized) |
| `/run <repo> <prompt>` | Request mutating agent task (requires confirmation) |
| `/approve <token>` | Confirm and execute pending mutating task |
| `/cancel <jobId>` | Cancel a queued or running job |

---

## Documentation

- [Architecture Specification](docs/ARCHITECTURE.md)
- [Architectural Decision Records (ADRs)](docs/DECISIONS.md)
- [Security Threat Model & Controls](docs/SECURITY.md)
- [Operations & Troubleshooting Runbook](docs/OPERATIONS.md)
- [Implementation Roadmap](docs/ROADMAP.md)
- [Project Status & Phase History](docs/PROJECT_STATUS.md)

---

## Testing

```powershell
# Run full automated test suite (Unit, Integration, Security)
npm test
```
All 46+ automated tests execute with 100% pass rate.

# wemoteit — WhatsApp AI Agent Orchestrator

> **Local-first, extensible orchestration platform for controlling AI coding agents and automating Windows desktop systems via WhatsApp self-chat.**

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green.svg)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-lightgrey.svg)](https://sqlite.org/)
[![Tests](https://img.shields.io/badge/Tests-104%20passed%20(17%20suites)-brightgreen.svg)](https://vitest.dev/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

---

## Overview

`wemoteit` bridges personal messaging channels (WhatsApp self-chat) with local AI developer environments (Google Antigravity IDE & Google Gemini Multi-Account Pool) and Windows OS automations running on your local PC.

Send natural language requests or fast-path commands from your phone while away from your desk, inspect codebase reviews, control Windows desktop applications, take real-time screenshots delivered straight to your chat, manage power states, and confirm destructive actions effortlessly.

```text
WHATSAPP (Phone) ──► WHATSAPP WEB (Local PC) ──► NORMALIZATION & SECURITY GATE
                                                         │
                                                         ▼
WHATSAPP (Phone) ◄── MEDIA / TEXT DELIVERY ◄── DUAL-ENGINE ROUTER (NLU & SLASH)
                                                         │
                     ┌───────────────────────────────────┼──────────────────────────────────┐
                     ▼                                   ▼                                  ▼
             ANTIGRAVITY IDE CLI                GEMINI 5-ACCOUNT POOL              WINDOWS OS AUTOMATION
         (Local Coding Agent Runner)          (Failover AI Engine)          (Apps, Power, Health, Screen)
```

---

## Key Architecture & Features

- **Hexagonal / Ports & Adapters Architecture**: Generic `InputChannelAdapter`, `OutputChannelAdapter`, `ExecutionProvider`, and `PersistencePort` ensure zero coupling between WhatsApp, AI agents, and business logic.
- **Web Management Dashboard (`http://localhost:3100`)**:
  - Live WhatsApp Web pairing with dynamic QR Code canvas visualizer.
  - 1-click authorized account locking & runtime persistence.
  - Multi-Account Gemini Pool manager (up to 5 accounts with automatic 60s cooldown and quota failover).
  - Live job monitor and 1-click token approvals.
- **Dual-Engine NLU Intent Router**:
  - *Fast-Path Engine*: Instant regex execution for slash commands (`/review`, `/status`, `/help`, etc.).
  - *NLU Copilot Engine*: Gemini Function Calling translates natural Indonesian or English requests into structured actions.
  - *Short-Term Context Memory*: Retains recent conversation history for intuitive follow-up instructions.
- **Windows OS Remote Automation**:
  - Application launcher (`launchApp`) and whitelist-protected process termination (`terminateApp`).
  - Hardware health metrics (Battery status, RAM usage, CPU load, Disk partition capacity).
  - Power management: Instant Sleep, Lock Workstation, Stay-Awake anti-sleep, and scheduled sleep via Task Scheduler.
  - High-resolution desktop screenshot capture delivered directly to WhatsApp chat as an image attachment.
- **Two-Tier Policy & Conversational Confirmation**:
  - **Tier 1 (Safe / Auto-Approve)**: Read-only tasks, app launches, screen captures, status checks, and lock screen execute immediately.
  - **Tier 2 (Destructive Actions)**: Sleep/shutdown, closing applications, and `/run` code changes prompt the operator:
    > *"⚠️ Konfirmasi: Laptop Anda akan masuk mode Sleep pada pukul 23:00 WIB. Balas **YA** dalam 2 menit untuk melanjutkan, atau **BATAL** untuk membatalkan."*
  - Natural affirmative (`YA`, `YES`, `OKE`, `SETUJU`, `LANJUT`, `SIAP`) and negative (`BATAL`, `CANCEL`, `TIDAK`, `NO`) recognition with 2-minute TTL.
  - Full backward compatibility for `/approve <token>`.
- **Durable SQLite Persistence & Crash Safety**:
  - Node.js 22 built-in `node:sqlite` (`DatabaseSync`) in WAL mode.
  - Stalled running jobs transition to `failed: UNEXPECTED_SYSTEM_RESTART` on reboot rather than replaying unverified operations.
  - Recursive process tree termination (`taskkill /T /F`) prevents lingering agent processes.
- **Strict Security Boundaries**:
  - Path traversal protection (`path.resolve()` with canonical boundary verification).
  - Self-chat echo feedback loop suppression.
  - Automated regex secret redaction across all logs, delivery payloads, and web views.

---

## Quick Start

### 1. Installation
```powershell
git clone https://github.com/rvmdn/wemoteit.git
cd wemoteit
npm install
npm run build
```

### 2. Launch Interactive Web Dashboard (Recommended)
```powershell
npm run dashboard
```
*Open [http://localhost:3100](http://localhost:3100) in your browser to link WhatsApp via QR code, set authorized sender, and manage Gemini accounts.*

### 3. Run Headless Orchestrator Daemon (Alternative)
```powershell
npm run cli -- start-whatsapp
```

### 4. Run Hermetic Test Pipeline
```powershell
npm run cli -- test-pipeline
```

---

## Chat Commands & Natural Language

### Fast-Path Slash Commands
| Command | Action | Tier |
|---|---|---|
| `/help` | Display list of commands and syntax | Tier 1 (Safe) |
| `/status` | View system health, active jobs, and queued tasks | Tier 1 (Safe) |
| `/repos` | List authorized local repositories | Tier 1 (Safe) |
| `/jobs` | View recent job history | Tier 1 (Safe) |
| `/job <jobId>` | Inspect state transitions and result details for a specific job | Tier 1 (Safe) |
| `/review <repo> [prompt]` | Read-only codebase review | Tier 1 (Safe) |
| `/run <repo> <prompt>` | Request mutating agent task (requires confirmation) | **Tier 2 (Confirmation)** |
| `/approve <token>` | Confirm and execute pending mutating task | Tier 2 Approval |
| `/cancel <jobId>` | Cancel a queued or running job | Tier 1 (Safe) |

### Natural Language Examples
- *"Tolong review repositori wedocit"*
- *"Baterai laptop tinggal berapa?"*
- *"Cek kapasitas harddisk C dan D"*
- *"Screenshot layar sekarang"* ➔ *Delivers image to chat*
- *"Buka Microsoft Teams"*
- *"Kunci layar laptop"*
- *"Tidurkan laptop jam 23:00"* ➔ *Replies: Balas **YA** untuk konfirmasi*

---

## Documentation

- [Architecture Specification](docs/ARCHITECTURE.md)
- [Architectural Decision Records (ADRs)](docs/DECISIONS.md)
- [Security Threat Model & Controls](docs/SECURITY.md)
- [Operations & Troubleshooting Runbook](docs/OPERATIONS.md)
- [Implementation Roadmap](docs/ROADMAP.md)
- [Project Status & Phase History](docs/PROJECT_STATUS.md)
- [v2 Specifications & Roadmap](docs/V2_ROADMAP_AND_SPEC.md)

---

## Testing

```powershell
npm test
```
**104 automated tests passing across 17 test suites (100% pass rate).**

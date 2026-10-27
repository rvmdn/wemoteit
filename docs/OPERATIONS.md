# Operations Runbook & Administration Guide: wemoteit

## 1. System Prerequisites & Environment

| Component | Minimum Requirement | Verified Host Environment |
|---|---|---|
| **Operating System** | Windows 10/11 64-bit | Windows 11 Enterprise (x64) |
| **Node.js** | Node.js 22 LTS (ESM + native `node:sqlite`) | `v22.13.1` LTS |
| **Package Manager** | npm 10+ | `npm 11.12.1` |
| **Browser Runtime** | Microsoft Edge or Google Chrome installed | `msedge.exe` & `chrome.exe` verified |
| **Agent Provider** | Antigravity IDE 1.107.0+ | `C:\Users\822117\AppData\Local\Programs\Antigravity IDE` |
| **Optional Provider** | Google Gemini API Keys (Up to 5 accounts) | Google AI Studio Free/Payg Keys |

---

## 2. Web Management Dashboard (Recommended)

The Web Dashboard is the central control center for linking WhatsApp, managing Gemini pool accounts, and monitoring jobs.

### Starting the Dashboard
```powershell
npm run dashboard
```
Open **`http://localhost:3100`** in your browser.

### Key Capabilities in Dashboard
1. **WhatsApp Web Pairing**:
   - Displays real-time connection status (`disconnected`, `launching`, `needs_qr_login`, `authenticated`, `listening`).
   - Dynamically renders the WhatsApp Web QR Code canvas for scanning.
   - Pilihan browser: Microsoft Edge (default) atau Google Chrome, dengan mode Headless atau Headful.
2. **Authorized Account Lock**:
   - Enter your WhatsApp number / JID (e.g. `628123456789@c.us` or `self`).
   - Click **"Lock Account"** to immediately persist and enforce sender allowlist restrictions.
3. **AI Account Pool Manager**:
   - Manage up to 5 Google Gemini accounts.
   - Live status badges: `Active`, `Cooldown (60s)`, `Exhausted`, `Disabled`.
   - Built-in **Ping Test Console** to verify API keys with 10-second timeout.
   - All secret keys are automatically masked.
4. **Live Job Monitor & 1-Click Approvals**:
   - Real-time job queue and historical execution results.
   - 1-click **Approve** or **Reject** buttons for pending mutating actions.

---

## 3. Alternative CLI Operations

### Headless Orchestrator Daemon
```powershell
npm run cli -- start-whatsapp
```
Runs the WhatsApp listener daemon in headless mode using saved session credentials in `./data/whatsapp_session`.

### Diagnostic & Status Check
```powershell
npm run cli -- status
```

### Hermetic Pipeline Simulation
```powershell
npm run cli -- test-pipeline
```
Runs an offline simulation from message normalization to job completion without opening WhatsApp or Antigravity.

---

## 4. Mobile Chat Interaction Guide

Send messages directly to yourself in WhatsApp ("Message yourself" chat):

### Fast-Path Slash Commands
| Command | Description | Tier / Approval |
|---|---|---|
| `/help` | Displays available commands and syntax. | Tier 1 (Safe) |
| `/status` | Shows real-time system health, active jobs, and queued tasks. | Tier 1 (Safe) |
| `/repos` | Lists all authorized local repositories and canonical paths. | Tier 1 (Safe) |
| `/jobs` | Lists the most recent jobs and execution statuses. | Tier 1 (Safe) |
| `/job <jobId>` | Detailed inspection of a specific job (timeline, results). | Tier 1 (Safe) |
| `/review <repo> [prompt]` | Read-only codebase review (Antigravity or Gemini). | Tier 1 (Safe) |
| `/run <repo> <prompt>` | Request mutating agent task (modifies code/files). | **Tier 2 (Requires Confirmation)** |
| `/approve <token>` | Legacy slash command approval for `APP-XXXX`. | Tier 2 Approval |
| `/cancel <jobId>` | Requests cancellation of a queued or running job. | Tier 1 (Safe) |

### Conversational & Windows OS Automation Examples
You can speak naturally in Indonesian or English:

- **Reviewing Code**:
  - *"Tolong review repositori wedocit"*
  - *"Cek kode di scanwitme apa yang bisa ditingkatkan"*
- **Hardware Telemetry**:
  - *"Baterai laptop tinggal berapa?"*
  - *"Cek status RAM dan CPU sekarang"*
  - *"Berapa sisa kapasitas harddisk C dan D?"*
- **Desktop Screenshots**:
  - *"Screenshot layar sekarang"* (Bot will capture and upload image directly to WhatsApp chat)
- **App Control**:
  - *"Buka Microsoft Teams"*
  - *"Tutup notepad"* (Tier 2: Prompting for confirmation)
- **Power Management**:
  - *"Kunci layar laptop"* (Tier 1: Locks workstation immediately)
  - *"Jangan biarkan laptop tidur"* (Tier 1: Enables stay-awake anti-sleep)
  - *"Tidurkan laptop jam 23:00"* (Tier 2: Schedules sleep via Task Scheduler)
  - *"Batalkan jadwal sleep"* (Tier 1: Cancels scheduled sleep task)

### Quick Confirmation Workflow
When a Tier 2 action is requested, the bot replies:
> *"⚠️ Konfirmasi Tindakan Sistem (Tier 2)*
> *Anda akan menutup aplikasi notepad. Balas **YA** dalam 2 menit untuk melanjutkan, atau **BATAL** untuk membatalkan."*

- **To confirm**: Reply with `YA`, `YES`, `OKE`, `SETUJU`, `LANJUT`, `SIAP`, `YA SILAKAN`.
- **To cancel**: Reply with `BATAL`, `CANCEL`, `TIDAK`, `NO`, `GAK JADI`.

---

## 5. Troubleshooting Runbook

### Issue: WhatsApp Disconnected or Session Expired
- **Symptom**: Dashboard shows `disconnected` or daemon logs authentication timeout.
- **Remedy**:
  1. Open Dashboard at `http://localhost:3100`.
  2. Click **"Relink WhatsApp"** or run `npm run cli -- login-whatsapp`.
  3. Scan the fresh QR code using your phone.

### Issue: Gemini Account Hits HTTP 429 (Rate Limit)
- **Symptom**: Log shows `RESOURCE_EXHAUSTED` for an API key.
- **Remedy**: WemoteIt automatically puts that key into a 60-second cooldown and rotates to the next available account in the pool. No manual action is needed. You can add more backup keys in the Dashboard tab "AI Account Pool".

### Issue: Desktop Screenshot Capture Fails
- **Symptom**: Log reports screen resolution error.
- **Remedy**: Ensure the Windows user session is active (not locked by another Remote Desktop session). `wemoteit` automatically prunes screenshots in `./data/screenshots` to prevent disk bloat.

### Issue: Agent Process Times Out
- **Symptom**: Job status transitions to `timeout`.
- **Remedy**: WemoteIt terminates the entire Windows process tree via `taskkill /pid <pid> /T /F`. Check `maxTimeoutMs` in `config/agents.yaml` if tasks require more execution time.

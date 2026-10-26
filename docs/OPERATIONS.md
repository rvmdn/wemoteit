# Operations Runbook & Administration Guide: wemoteit

## 1. System Prerequisites & Environment

| Component | Minimum Requirement | Verified Host Environment |
|---|---|---|
| **Operating System** | Windows 10/11 64-bit | Windows 11 Enterprise (x64) |
| **Node.js** | Node.js 22 LTS (ESM + native `node:sqlite`) | `v22.13.1` LTS |
| **Package Manager** | npm 10+ | `npm 11.12.1` |
| **Browser Runtime** | Microsoft Edge or Google Chrome installed | `msedge.exe` & `chrome.exe` verified |
| **Agent Provider** | Antigravity IDE 1.107.0+ | `C:\Users\822117\AppData\Local\Programs\Antigravity IDE` |

---

## 2. Initial Setup: WhatsApp Web Authentication

WhatsApp Web uses a persistent Chromium profile stored in `./data/whatsapp_session`. A one-time QR code scan is required to link your WhatsApp account.

### Step 1: Launch Authentication Helper
Run the following command in PowerShell:
```powershell
npm run cli -- login-whatsapp
```
This opens Microsoft Edge in visible (*headful*) mode navigating to `https://web.whatsapp.com`.

### Step 2: Scan QR Code
1. Open WhatsApp on your mobile phone.
2. Go to **Settings > Linked Devices > Link a Device**.
3. Scan the QR code displayed on your PC screen.
4. Once the chat list loads on your screen, press `Ctrl+C` in your terminal to save and close the session.

Your authenticated credentials are now preserved inside `./data/whatsapp_session`. Future launches will operate headless without requesting QR codes.

---

## 3. Starting the Orchestrator

### Production Mode (Headless)
```powershell
npm run cli -- start-whatsapp
```
The orchestrator starts in the background, connects to the saved WhatsApp Web session, initializes SQLite tables, recovers any stalled jobs, and begins listening for incoming messages from your configured authorized self-chat.

### Debug Mode (Headful with DevTools)
To observe browser interactions visually while debugging:
```powershell
npm run cli -- start-whatsapp --headful
```

---

## 4. Configuration Reference

All settings are stored in human-readable, versioned YAML files inside the `config/` directory:

- **`config/defaults.yaml`**: Primary workspace identity and policy defaults.
- **`config/channels.yaml`**:
  ```yaml
  channels:
    whatsapp:
      enabled: true
      authorizedSenderId: "self"          # Or user JID / phone number
      authorizedConversationId: "self"    # Or self-chat ID
      headless: true
      sessionDataDir: "./data/whatsapp_session"
  ```
- **`config/agents.yaml`**:
  ```yaml
  agents:
    antigravity:
      enabled: true
      executionMode: "cli"
      cliPath: "C:\\Users\\822117\\AppData\\Local\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd"
      maxTimeoutMs: 120000
  ```
- **`config/repositories.yaml`**:
  Explicit allowlist of repositories that may be operated on. Arbitrary directory traversal is denied.

---

## 5. Command Reference (Mobile WhatsApp Chat)

Send these commands from your phone to your own self-chat:

| Command | Description | Approval Required? |
|---|---|---|
| `/help` | Displays available commands and syntax. | No |
| `/status` | Shows real-time system health, active jobs, and queued items. | No |
| `/repos` | Lists all authorized repositories and their canonical paths. | No |
| `/jobs` | Lists the 5 most recent jobs and their statuses. | No |
| `/job <jobId>` | Detailed inspection of a specific job (timeline, results, errors). | No |
| `/review <repo> [prompt]` | Read-only codebase review on the target repo. | No (Auto-allowed) |
| `/run <repo> <prompt>` | Request a mutating agent task (e.g., refactoring). | **YES** (Generates token `APP-XXXX`) |
| `/approve <token>` | Approves and immediately starts a pending mutating task. | No (Grants execution) |
| `/cancel <jobId>` | Gracefully requests cancellation of a running or queued job. | No |

---

## 6. Troubleshooting Runbook

### Issue A: WhatsApp Web Disconnected or Asks for QR Code Again
- **Symptoms**: CLI reports `needs_qr_login` or health check reports `degraded`.
- **Cause**: WhatsApp Web session expired on the phone, or browser cookies were cleared.
- **Resolution**:
  1. Stop the running orchestrator (`Ctrl+C`).
  2. Re-run `npm run cli -- login-whatsapp`.
  3. Scan the QR code again from your phone.
  4. Restart `npm run cli -- start-whatsapp`.

### Issue B: Antigravity IDE Agent Times Out
- **Symptoms**: Job fails with error code `EXECUTION_TIMEOUT`.
- **Resolution**:
  1. Check if Antigravity IDE is open on your machine.
  2. Inspect `config/agents.yaml` and increase `maxTimeoutMs` (e.g. from 120,000 to 300,000 for large tasks).
  3. Run `npm run cli -- trace <correlationId>` to inspect exact failure duration.

### Issue C: SQLite Database Locked
- **Symptoms**: Error message `SQLITE_BUSY: database is locked`.
- **Resolution**:
  1. The database operates in WAL mode (`journal_mode = WAL`). Ensure no zombie Node processes are holding the file:
     ```powershell
     Get-Process node | Stop-Process -Force
     ```
  2. Restart the orchestrator; WAL checkpoint recovery runs automatically.

---

## 7. Backup & Disaster Recovery

### Database Backup
The primary database file is `./data/wemoteit.db`. To take a hot backup without stopping the service:
```powershell
# Copy DB safely using sqlite backup or file copy when idle:
Copy-Item "./data/wemoteit.db" "./data/wemoteit.db.backup"
```

### Crash Recovery Guarantee
If the host PC loses power or crashes during task execution:
1. Upon restart, `JobManager.recoverStalledJobs()` detects any job left in `running` state.
2. Interrupted jobs transition safely to `failed` with code `UNEXPECTED_SYSTEM_RESTART`.
3. Destructive operations are **never** blindly replayed without operator approval.

---

## 8. Build, Test, and Release

```powershell
# Compile TypeScript to dist/
npm run build

# Run complete automated test suite (Unit, Integration, Security)
npm test

# Run hermetic end-to-end pipeline test
npm run cli -- test-pipeline
```

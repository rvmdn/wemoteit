# Security Architecture & Threat Model: wemoteit

## 1. Threat Model & Mitigations

| Threat | Risk Level | Mitigation Strategy |
|---|---|---|
| **Unauthorized Message Ingestion** (Spoofed sender, attacker messages user) | **CRITICAL** | Strict whitelist check on both `senderId` and `conversationId`. In the self-chat scenario, the incoming message must originate from the authenticated self-user account and match the registered self JID/number. All external group or unverified direct chats are rejected and dropped at ingestion. Web Dashboard allows 1-click sender locking with instant runtime propagation. |
| **Arbitrary Command Execution / Remote Shell** | **CRITICAL** | Never allow raw shell execution from chat. Commands are parsed strictly through a closed vocabulary parser (`help`, `status`, `review`, `run`, `jobs`) or mapped via strict Gemini Function Calling declarations. Arbitrary bash/powershell strings are rejected with an authorization error. |
| **Path Traversal & Filesystem Escapes** | **HIGH** | User cannot specify raw filesystem paths in chat messages. Targets must reference registered `repositoryId` aliases (e.g. `wedocit`, `scanwitme`). Repositories are resolved strictly to configured root directories, canonicalized using `path.resolve()`, and verified that the target path remains within boundary (`canonicalPath.startsWith(...)`). |
| **Prompt Injection & Unintended File Mutation** | **HIGH** | Two-tier confirmation policy enforces that mutating code execution (`/run`) is gated by explicit operator approval (`APP-XXXX` token or quick conversational `YA` reply with 2-minute TTL). Unapproved tasks are never scheduled or executed. |
| **Destructive Windows OS Operations** | **HIGH** | Application termination (`terminateApp`) strictly enforces a whitelist of safe user applications (Teams, Edge, Chrome, Notepad, Calc, Code, Terminal, Spotify). System-critical processes (e.g. `lsass`, `winlogon`, `csrss`, `svchost`) are strictly blocked. Power operations (sleep, shutdown, restart) are classified as Tier 2 and demand explicit confirmation. |
| **PowerShell Argument Injection** | **HIGH** | All arguments passed to desktop applications via `launchApp` or scheduled via `schtasks` are sanitized with regex character filters to strip dangerous shell meta-characters (`;`, `&`, `|`, `` ` ``, `$`, `\r`, `\n`). |
| **Secret & Token Leakage** | **HIGH** | API keys and tokens are stored in environment variables or masked in SQLite. All outgoing logs, delivery messages, and web dashboard payloads pass through automated regex redaction masks (`Bearer ***`, `AIza...`, `sk-***`, high-entropy secret patterns). |
| **Replay Attacks & Duplicate Processing** | **MEDIUM** | Every incoming message is identified by unique `(channelConnectionId, providerMessageId)` with a database constraint. Replayed or duplicate messages are discarded idempotently without spawning duplicate jobs. |
| **Self-Chat Echo Feedback Loops** | **MEDIUM** | In WhatsApp self-chat, messages sent by the bot appear in the same chat timeline. Strict regex echo suppression (`/^[⚠️✅⏳🔒🛑🤖💻📊📂📋🔍🌙☀️🔋💾⚡📸❌ℹ️⏹️⏰🚀]/`) drops bot notification echoes immediately to prevent infinite self-trigger loops. |
| **Denial of Service via Giant Payloads & Storage Exhaustion** | **MEDIUM** | Ingestion limits incoming messages to a maximum of 4,096 characters. Screenshot files in `./data/screenshots` are automatically pruned to retain only the 30 most recent captures. |
| **Process Tree Leakage / Zombie Agent Processes** | **MEDIUM** | Child processes spawned for Antigravity or local runners that exceed timeout thresholds or are cancelled by the operator are terminated via Windows `taskkill /pid <pid> /T /F`, killing the entire process tree rather than just the shell wrapper. |
| **Crash Loops & Unchecked Replays** | **MEDIUM** | Jobs interrupted by unexpected system restarts transition to `failed` (`UNEXPECTED_SYSTEM_RESTART`) rather than blindly re-executing unverified actions. |

---

## 2. Principle of Least Privilege & Two-Tier Policy

### Tier 1 (Safe / Auto-Approve)
Operations that are strictly read-only or harmless execute immediately without prompting for confirmation:
- Reviewing codebases (`/review <repo>`)
- Querying system health & hardware metrics (battery, memory, CPU, disk)
- Capturing screenshots (`capture_screen`)
- Launching whitelisted desktop applications (`launch_app`)
- Locking the workstation (`lock`)
- Enabling Stay-Awake mode (`awake`)
- Cancelling scheduled sleep (`cancel_sleep`)
- Conversational inquiries and help requests

### Tier 2 (Destructive / Power / Mutating Actions)
Operations that modify files or affect system availability strictly require operator confirmation:
- Putting the PC to sleep or scheduling sleep (`sleep`)
- Terminating running desktop applications (`terminate_app`)
- Executing mutating agent coding tasks (`/run <repo> <prompt>`)

---

## 3. Secret Redaction Pipeline

All text emitted to logs, persisted to audit tables, or returned to WhatsApp passes through a redaction filter matching:
- High-entropy tokens (`[A-Za-z0-9_-]{32,}`)
- Bearer tokens (`Bearer\s+[A-Za-z0-9._-]+`)
- API keys (`(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["']?([^"' \r\n]+)`)
- Cloud service credentials (Google, OpenAI, Anthropic, AWS tokens)

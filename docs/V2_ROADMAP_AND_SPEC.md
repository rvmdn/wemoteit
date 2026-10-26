# wemoteit v2.0 Architecture Blueprint & Implementation Plan
**Codename:** *Smart Remote OS & Multi-Account AI Copilot*

---

## 1. Vision & Core Objectives

**wemoteit v1.0.0** berhasil membangun fondasi jembatan WhatsApp, orkestrator Antigravity IDE, Web Management Dashboard, dan registrasi 10 workspace proyek.

**wemoteit v2.0** bertujuan mentransformasi wemoteit dari sekadar bot berbasis perintah kaku (*closed-vocabulary slash commands*) menjadi **Asisten Remote Personal Berbahasa Alami** yang mampu mengendalikan sistem operasi Windows dan proyek pengembangan Anda dari jarak jauh via WhatsApp.

### Key Deliverables v2:
1. **Natural Language Understanding (NLU)**: Memahami bahasa santai, gaul, dan percakapan Indonesia/Inggris tanpa harus mengingat format `/slash`.
2. **Windows OS Remote Automation**: Mengontrol aplikasi (Teams, Browser), daya (Sleep, Awake, Lock), monitoring baterai/RAM, dan tangkapan layar desktop.
3. **Embedded Multi-Account Gemini Pool**: Menanamkan engine Gemini 1.5 Pro dengan rotasi otomatis hingga 5 akun Google sebagai amunisi kuota (7.500 request gratis/hari, auto-failover pada HTTP 429).
4. **Two-Tier Safety Gate**: Aksi aman dieksekusi instan; aksi kritis (sleep, modifikasi sistem) meminta konfirmasi cepat satu kata (`"YA"`).

---

## 2. High-Level Architecture (v2)

```
                            WhatsApp Message
      ("Tolong buka Teams, cek baterai, dan jadwalkan sleep jam 23:00")
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   wemoteit Natural Intent Router                       │
│                                                                        │
│  Menerima pesan santai ➔ Mengirim ke Gemini via GeminiPoolManager      │
│  Gemini memproses konteks & memanggil Tools (Function Calling):        │
│    1. call: launch_app(app: "teams")                                  │
│    2. call: get_system_metrics(metrics: ["battery"])                   │
│    3. call: schedule_power(action: "sleep", time: "23:00")             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
┌───────────────────────────────┐         ┌──────────────────────────────┐
│  Gemini Multi-Account Pool    │         │  Windows OS Action Adapter   │
│                               │         │                              │
│  • Akun 1: Active (Quota OK)  │         │  • PowerShell App Launcher   │
│  • Akun 2: Standby            │         │  • Windows Task Scheduler    │
│  • Akun 3: Standby            │         │  • Screenshot Grabber        │
│  • Akun 4: Standby            │         │  • Hardware Metrics Reader   │
│  • Akun 5: Standby            │         │  • Antigravity IDE Delegate  │
│  Auto-failover on HTTP 429    │         │                              │
└───────────────────────────────┘         └──────────────┬───────────────┘
                                                         │
                                                         ▼
                                          Balasan WhatsApp Instan
```

---

## 3. Phased Implementation Plan

### Phase 8: Multi-Account Gemini Pool Engine
*Tujuan: Menanamkan engine Gemini Pro mandiri dengan manajemen kuota 5 akun.*

- [ ] **Data Model & SQLite Persistence**:
  - Tabel `gemini_account_instances`:
    - `id` (string, PK)
    - `label` (e.g., "Akun Pribadi 1", "Akun Cadangan 2")
    - `apiKeyEncrypted` (string)
    - `tier` (enum: `free`, `payg`)
    - `status` (enum: `active`, `cooling_down`, `exhausted`, `disabled`)
    - `cooldownUntil` (ISO timestamp)
    - `requestsToday` (integer)
    - `lastUsedAt` (ISO timestamp)
- [ ] **`GeminiPoolManager`**:
  - Implementasi adapter [`GeminiExecutionProvider`](file:///f:/Project/Desktop/wemoteit/src/adapters/agents/) menggunakan SDK `@google/genai`.
  - Strategi seleksi akun:
    - `failover` (gunakan Akun 1 hingga 429, baru pindah ke Akun 2).
    - `round-robin` (bagi beban merata tiap request).
  - Circuit Breaker: Deteksi status HTTP `429 Too Many Requests` / `RESOURCE_EXHAUSTED`, otomatis set cooldown 60 detik atau reset harian, lalu ulangi request ke akun standby tanpa menggugurkan job.
- [ ] **Web Dashboard Integration**:
  - Halaman tab baru: **"AI Account Pool"** di `http://localhost:3100`.
  - Form input dan validasi status koneksi 5 Akun Google.
  - Indikator bar visual kuota harian dan status aktif per akun.

---

### Phase 9: Natural Language Intent Router (NLU Copilot)
*Tujuan: Menerjemahkan bahasa percakapan bebas menjadi perintah terstruktur.*

- [ ] **Prompt Engineering & Tool Calling Schema**:
  - Definisikan schema tools resmi Gemini (`FunctionDeclaration`):
    - `launch_app(appName, args)`
    - `terminate_app(appName)`
    - `schedule_power(action: "sleep"|"shutdown"|"restart", timeString)`
    - `get_system_status(query: "battery"|"ram"|"cpu"|"all")`
    - `capture_screen(displayIndex)`
    - `explore_workspace(repoId, action: "list"|"read"|"search", target)`
    - `delegate_coding_task(repoId, prompt, mutating)`
- [ ] **Dual-Engine Routing Pipeline**:
  - Jika pesan diawali slash (`/review`, `/status`, `/help`), jalankan fast path Regex lama (100% backward compatible).
  - Jika pesan berupa teks santai, teruskan ke `GeminiIntentRouter` untuk diproses via Function Calling.
- [ ] **Context & History Retention**:
  - Menyimpan histori singkat percakapan (3–5 pesan terakhir) agar asisten memahami konteks lanjutan (misal: *"buka repo wedocit"* lalu *"coba jelaskan file background.js nya"*).

---

### Phase 10: Windows OS Automation Provider
*Tujuan: Menyediakan pustaka tool otomasi sistem Windows yang aman dan handal.*

- [x] **Application Controller (`WindowsAppAdapter`)**:
  - Whitelist aplikasi umum: Microsoft Teams (`msteams:`), Browser (`msedge`, `chrome`), Media Player (`spotify:`), Terminal (`wt`, `powershell`).
  - Safe process launcher via PowerShell `Start-Process` tanpa shell injection.
  - Safe process termination controller via `terminateApp` dengan whitelist proses.
- [x] **Power & Sleep Scheduler (`PowerAutomationAdapter`)**:
  - Eksekusi sleep instan via PowerShell:
    ```powershell
    Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)
    ```
  - Penjadwalan sleep berbasis waktu (misal jam 23:00) menggunakan `schtasks.exe` temporer.
  - Mode Stay-Awake / Anti-Sleep (`kernel32.dll SetThreadExecutionState`) sementara.
- [x] **Desktop Snapshot & Media Delivery (`DesktopCaptureAdapter`)**:
  - Mengambil tangkapan layar resolusi layar penuh tanpa pihak ketiga via .NET System.Drawing / PowerShell.
  - Mengirim file gambar `.png` langsung ke chat WhatsApp sebagai media attachment via Playwright input.
- [x] **Hardware Health & System Metrics**:
  - Membaca status baterai: `Get-CimInstance Win32_Battery`.
  - Membaca utilisasi RAM & CPU: `Get-CimInstance Win32_OperatingSystem` & `Win32_Processor`.
  - Membaca partisi penyimpanan disk: `Get-CimInstance Win32_LogicalDisk`.

---

### Phase 11: Two-Tier Confirmation & Security Hardening
*Tujuan: Memastikan PC Anda tetap aman saat diakses dari WhatsApp.*

- [ ] **Tiered Policy Enforcement**:
  - **Tier 1 (Safe / Auto-Approve)**: Buka aplikasi, ambil screenshot, baca status baterai/file, review kode.
  - **Tier 2 (Destructive / Power Action)**: Sleep, shutdown, kill process, edit kode/file.
- [ ] **Conversational Quick Confirmation**:
  - Alih-alih token rumit seperti `APP-99A1`, bot akan bertanya ramah:
    > *"⚠️ Konfirmasi: Laptop Anda akan masuk mode Sleep pada pukul 23:00 WIB. Balas **YA** dalam 2 menit untuk melanjutkan."*
  - State machine mengenali balasan satu kata `"YA"` atau `"BATAL"` dari pengirim yang sah (`self`).

---

## 4. Timeline & Milestones

| Milestone | Target Waktu | Output Utama |
|---|---|---|
| **M1: Gemini Pool Core** | Sprint 1 | SQLite table, SDK `@google/genai`, failover logic 429, unit tests. |
| **M2: Dashboard Account Manager** | Sprint 2 | UI slot 5 akun Google di Web Dashboard, enkripsi token/key. |
| **M3: NLU Intent Router** | Sprint 3 | Function calling schema, parsing bahasa alami santai via WhatsApp. |
| **M4: Windows OS Automation** | Sprint 4 | PowerShell launchers (Teams, Browser, Sleep, Baterai, Screenshot). |
| **M5: End-to-End Acceptance** | Sprint 5 | Uji coba menyeluruh dari WhatsApp tanpa perintah baku. |

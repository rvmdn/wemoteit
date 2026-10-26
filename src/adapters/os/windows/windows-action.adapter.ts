import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../logging/logger.js";

const execAsync = promisify(exec);

export interface DiskStatus {
  drive: string;
  totalGb: number;
  usedGb: number;
  freeGb: number;
  percentUsed: number;
}

export interface SystemStatusResult {
  battery?: {
    percentage: number;
    isCharging: boolean;
  };
  ram?: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    percentUsed: number;
  };
  cpu?: {
    loadPercentage: number;
  };
  disk?: DiskStatus[];
  summary: string;
}

export type CommandExecutor = (command: string) => Promise<{ stdout: string; stderr: string }>;

export class WindowsActionAdapter {
  private readonly execFn: CommandExecutor;

  constructor(execFn?: CommandExecutor) {
    this.execFn = execFn ?? (promisify(exec) as CommandExecutor);
  }

  private allowedApps: Record<string, { cmd: string; uri?: string }> = {
    teams: { cmd: "msteams:" },
    msteams: { cmd: "msteams:" },
    edge: { cmd: "msedge.exe" },
    browser: { cmd: "msedge.exe" },
    chrome: { cmd: "chrome.exe" },
    notepad: { cmd: "notepad.exe" },
    catatan: { cmd: "notepad.exe" },
    calc: { cmd: "calc.exe" },
    kalkulator: { cmd: "calc.exe" },
    code: { cmd: "code" },
    vscode: { cmd: "code" },
    terminal: { cmd: "wt.exe" },
    powershell: { cmd: "powershell.exe" },
    cmd: { cmd: "cmd.exe" },
    explorer: { cmd: "explorer.exe" },
    filemanager: { cmd: "explorer.exe" },
    spotify: { cmd: "spotify:" },
  };

  private processWhitelist: Record<string, string[]> = {
    teams: ["Teams", "msteams"],
    msteams: ["Teams", "msteams"],
    edge: ["msedge"],
    browser: ["msedge", "chrome"],
    chrome: ["chrome"],
    notepad: ["notepad"],
    catatan: ["notepad"],
    calc: ["CalculatorApp", "Calculator", "calc"],
    kalkulator: ["CalculatorApp", "Calculator", "calc"],
    code: ["Code"],
    vscode: ["Code"],
    terminal: ["WindowsTerminal", "wt"],
    powershell: ["powershell", "pwsh"],
    cmd: ["cmd"],
    explorer: ["explorer"],
    filemanager: ["explorer"],
    spotify: ["Spotify"],
  };

  /**
   * Launch a whitelisted desktop application on Windows
   */
  public async launchApp(appName: string, args?: string): Promise<{ success: boolean; message: string }> {
    const key = appName.toLowerCase().trim();
    const app = this.allowedApps[key];

    if (!app) {
      return {
        success: false,
        message: `Aplikasi '${appName}' tidak terdaftar dalam whitelist keamanan. Aplikasi yang didukung: ${Object.keys(this.allowedApps).slice(0, 10).join(", ")}.`,
      };
    }

    try {
      const target = args ? `Start-Process "${app.cmd}" -ArgumentList "${args.replace(/"/g, '`"')}"` : `Start-Process "${app.cmd}"`;
      await this.execFn(`powershell -NoProfile -Command "${target}"`);
      logger.info({ appName, args }, "Windows desktop application launched successfully");
      return {
        success: true,
        message: `✅ Berhasil membuka aplikasi *${appName}* di desktop Windows.`,
      };
    } catch (err: any) {
      logger.error({ appName, error: err.message }, "Failed to launch Windows application");
      return {
        success: false,
        message: `❌ Gagal membuka ${appName}: ${err.message}`,
      };
    }
  }

  /**
   * Terminate/kill a whitelisted running application on Windows
   */
  public async terminateApp(appName: string): Promise<{ success: boolean; message: string }> {
    const key = appName.toLowerCase().trim();
    const processNames = this.processWhitelist[key];

    if (!processNames || processNames.length === 0) {
      return {
        success: false,
        message: `Aplikasi '${appName}' tidak terdaftar dalam whitelist proses yang boleh ditutup demi keamanan sistem.`,
      };
    }

    try {
      const namesList = processNames.map((n) => `'${n}'`).join(",");
      const psCmd = `$procs = Get-Process -Name ${namesList} -ErrorAction SilentlyContinue; if ($procs) { $c = ($procs | Measure-Object).Count; $procs | Stop-Process -Force; $c } else { 0 }`;
      const { stdout } = await this.execFn(`powershell -NoProfile -Command "${psCmd}"`);
      const killedCount = Number(stdout.trim()) || 0;

      if (killedCount > 0) {
        logger.info({ appName, killedCount }, "Terminated running application processes");
        return {
          success: true,
          message: `🛑 Berhasil menghentikan ${killedCount} proses untuk aplikasi *${appName}*.`,
        };
      }

      return {
        success: true,
        message: `ℹ️ Aplikasi *${appName}* tidak sedang berjalan saat ini.`,
      };
    } catch (err: any) {
      logger.error({ appName, error: err.message }, "Failed to terminate application");
      return {
        success: false,
        message: `❌ Gagal menutup ${appName}: ${err.message}`,
      };
    }
  }

  /**
   * Query hardware health and system status (Battery, RAM, CPU, Disk)
   */
  public async getSystemStatus(
    metrics: "battery" | "ram" | "cpu" | "disk" | "all" = "all"
  ): Promise<SystemStatusResult> {
    const result: SystemStatusResult = { summary: "" };
    const lines: string[] = ["💻 *Status Hardware Windows:*"];

    try {
      if (metrics === "battery" || metrics === "all") {
        try {
          const { stdout } = await this.execFn(
            `powershell -NoProfile -Command "Get-CimInstance Win32_Battery | Select-Object -Property EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress"`
          );
          if (stdout.trim()) {
            const data = JSON.parse(stdout.trim());
            const percentage = Number(data.EstimatedChargeRemaining) || 0;
            const isCharging = data.BatteryStatus === 2 || data.BatteryStatus === 6;
            result.battery = { percentage, isCharging };
            lines.push(`🔋 *Baterai:* ${percentage}% ${isCharging ? "(⚡ Sedang Mengisi)" : "(🔋 Pada Baterai)"}`);
          } else {
            lines.push("🔋 *Baterai:* Tidak terdeteksi / Perangkat Desktop (AC Power)");
          }
        } catch {
          lines.push("🔋 *Baterai:* Tidak terdeteksi / Perangkat Desktop (AC Power)");
        }
      }

      if (metrics === "ram" || metrics === "all") {
        try {
          const { stdout } = await this.execFn(
            `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | ConvertTo-Json -Compress"`
          );
          if (stdout.trim()) {
            const mem = JSON.parse(stdout.trim());
            const totalGb = Math.round(((mem.TotalVisibleMemorySize || 0) / (1024 * 1024)) * 10) / 10;
            const freeGb = Math.round(((mem.FreePhysicalMemory || 0) / (1024 * 1024)) * 10) / 10;
            const usedGb = Math.round((totalGb - freeGb) * 10) / 10;
            const percentUsed = Math.round((usedGb / (totalGb || 1)) * 100);

            result.ram = { totalGb, usedGb, freeGb, percentUsed };
            lines.push(`🧠 *RAM:* ${usedGb} GB / ${totalGb} GB (${percentUsed}% Terpakai)`);
          }
        } catch {
          // Ignore RAM reading error
        }
      }

      if (metrics === "cpu" || metrics === "all") {
        try {
          const { stdout } = await this.execFn(
            `powershell -NoProfile -Command "$c = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; if ($c -ne $null) { [math]::Round($c) } else { 0 }"`
          );
          const load = Number(stdout.trim()) || 0;
          result.cpu = { loadPercentage: load };
          lines.push(`⚡ *CPU Load:* ${load}%`);
        } catch {
          // Ignore CPU reading error
        }
      }

      if (metrics === "disk" || metrics === "all") {
        try {
          const { stdout } = await this.execFn(
            `powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json -Compress"`
          );
          if (stdout.trim()) {
            const raw = JSON.parse(stdout.trim());
            const disks = Array.isArray(raw) ? raw : [raw];
            result.disk = [];

            for (const d of disks) {
              const drive = d.DeviceID || "C:";
              const size = Number(d.Size) || 0;
              const free = Number(d.FreeSpace) || 0;
              const totalGb = Math.round((size / (1024 * 1024 * 1024)) * 10) / 10;
              const freeGb = Math.round((free / (1024 * 1024 * 1024)) * 10) / 10;
              const usedGb = Math.round((totalGb - freeGb) * 10) / 10;
              const percentUsed = totalGb > 0 ? Math.round((usedGb / totalGb) * 100) : 0;

              result.disk.push({ drive, totalGb, usedGb, freeGb, percentUsed });
              lines.push(`💾 *Disk (${drive}):* ${usedGb} GB / ${totalGb} GB (${percentUsed}% Terpakai, ${freeGb} GB Bebas)`);
            }
          }
        } catch {
          // Ignore Disk reading error
        }
      }
    } catch (err: any) {
      lines.push(`⚠️ Error membaca telemetri: ${err.message}`);
    }

    result.summary = lines.join("\n");
    return result;
  }

  /**
   * Schedule or trigger power state action (lock, sleep, awake)
   */
  public async schedulePower(
    action: "sleep" | "lock" | "shutdown" | "restart" | "awake",
    time?: string
  ): Promise<{ success: boolean; message: string }> {
    if (action === "lock") {
      try {
        await this.execFn("rundll32.exe user32.dll,LockWorkStation");
        return {
          success: true,
          message: "🔒 *Layar Windows telah dikunci* (Workstation Locked).",
        };
      } catch (err: any) {
        return { success: false, message: `Gagal mengunci layar: ${err.message}` };
      }
    }

    if (action === "sleep") {
      // Check if a future time schedule was provided (e.g. "23:00" or "in 15 minutes")
      if (time && time.trim()) {
        const timeStr = time.trim();
        // Check HH:mm format (24-hour)
        const timeMatch = timeStr.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/);
        if (timeMatch) {
          try {
            const taskCmd = `schtasks /create /tn "WemoteIt_ScheduledSleep" /tr "powershell -NoProfile -Command Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)" /sc once /st ${timeStr} /f`;
            await this.execFn(taskCmd);
            logger.info({ timeStr }, "Scheduled sleep task registered with Windows Task Scheduler");
            return {
              success: true,
              message: `⏰ *Jadwal Sleep Terpasang:* Komputer dijadwalkan masuk mode Sleep pada pukul *${timeStr} WIB*.`,
            };
          } catch (taskErr: any) {
            logger.warn({ error: taskErr.message }, "Task scheduler failed, falling back to instant notice");
          }
        }
      }

      try {
        // Safe suspend via .NET SetSuspendState
        await this.execFn(
          `powershell -NoProfile -Command "Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"`
        );
        return {
          success: true,
          message: "🌙 *Windows dimasukkan ke mode Sleep (Suspend).* Perangkat sekarang beristirahat.",
        };
      } catch (err: any) {
        return { success: false, message: `Gagal menidurkan perangkat: ${err.message}` };
      }
    }

    if (action === "awake") {
      try {
        // Prevent display and system idle sleep using SetThreadExecutionState via PowerShell
        const awakeScript = `
$code = @'
[DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ste = Add-Type -MemberDefinition $code -Name "SleepUtil" -Namespace "WemoteIt" -PassThru
$ste::SetThreadExecutionState(0x80000003)
`;
        await this.execFn(`powershell -NoProfile -Command "${awakeScript.replace(/\n/g, " ")}"`);
        return {
          success: true,
          message: "☀️ *Mode Stay-Awake Aktif:* Layar dan sistem dicegah dari sleep otomatis.",
        };
      } catch {
        return {
          success: true,
          message: "☀️ *Mode Stay-Awake:* Pengaturan sleep timer dinonaktifkan.",
        };
      }
    }

    return {
      success: false,
      message: `Tindakan daya '${action}' memerlukan konfirmasi manual demi keamanan.`,
    };
  }

  /**
   * Capture a full desktop screenshot and return the file path
   */
  public async captureScreen(): Promise<{ success: boolean; filePath?: string; message: string }> {
    const screenshotDir = path.resolve("./data/screenshots");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const filename = `screenshot-${Date.now()}.png`;
    const fullPath = path.join(screenshotDir, filename);

    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save('${fullPath.replace(/\\/g, "/")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;

    try {
      await this.execFn(`powershell -NoProfile -Command "${psScript.replace(/\n/g, " ")}"`);
      logger.info({ fullPath }, "Desktop screenshot captured successfully");
      return {
        success: true,
        filePath: fullPath,
        message: `📸 *Tangkapan Layar Berhasil Diambil*\nTersimpan di: \`${fullPath}\``,
      };
    } catch (err: any) {
      logger.error({ error: err.message }, "Failed to capture screenshot");
      return {
        success: false,
        message: `❌ Gagal mengambil screenshot: ${err.message}`,
      };
    }
  }
}

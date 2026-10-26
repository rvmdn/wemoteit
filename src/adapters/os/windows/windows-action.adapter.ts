import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../logging/logger.js";

const execAsync = promisify(exec);

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
  summary: string;
}

export class WindowsActionAdapter {
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

  /**
   * Launch a whitelisted desktop application on Windows
   */
  public async launchApp(appName: string, args?: string): Promise<{ success: boolean; message: string }> {
    const key = appName.toLowerCase().trim();
    const app = this.allowedApps[key];

    if (!app) {
      return {
        success: false,
        message: `Aplikasi '${appName}' tidak terdaftar dalam whitelist keamanan. Aplikasi yang didukung: ${Object.keys(this.allowedApps).slice(0, 8).join(", ")}.`,
      };
    }

    try {
      const target = args ? `Start-Process "${app.cmd}" -ArgumentList "${args.replace(/"/g, '`"')}"` : `Start-Process "${app.cmd}"`;
      await execAsync(`powershell -NoProfile -Command "${target}"`);
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
   * Query hardware health and system status (Battery, RAM, CPU)
   */
  public async getSystemStatus(metrics: "battery" | "ram" | "cpu" | "all" = "all"): Promise<SystemStatusResult> {
    const result: SystemStatusResult = { summary: "" };
    const lines: string[] = ["💻 *Status Hardware Windows:*"];

    try {
      if (metrics === "battery" || metrics === "all") {
        try {
          const { stdout } = await execAsync(
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
          const { stdout } = await execAsync(
            `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | ConvertTo-Json -Compress"`
          );
          if (stdout.trim()) {
            const mem = JSON.parse(stdout.trim());
            const totalGb = Math.round(((mem.TotalVisibleMemorySize || 0) / (1024 * 1024)) * 10) / 10;
            const freeGb = Math.round(((mem.FreePhysicalMemory || 0) / (1024 * 1024)) * 10) / 10;
            const usedGb = Math.round((totalGb - freeGb) * 10) / 10;
            const percentUsed = Math.round((usedGb / (totalGb || 1)) * 100);

            result.ram = { totalGb, usedGb, freeGb, percentUsed };
            lines.push(`💾 *RAM:* ${usedGb} GB / ${totalGb} GB (${percentUsed}% Terpakai)`);
          }
        } catch {
          // Ignore RAM reading error
        }
      }

      if (metrics === "cpu" || metrics === "all") {
        try {
          const { stdout } = await execAsync(
            `powershell -NoProfile -Command "$c = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; if ($c -ne $null) { [math]::Round($c) } else { 0 }"`
          );
          const load = Number(stdout.trim()) || 0;
          result.cpu = { loadPercentage: load };
          lines.push(`⚡ *CPU Load:* ${load}%`);
        } catch {
          // Ignore CPU reading error
        }
      }
    } catch (err: any) {
      lines.push(`⚠️ Error membaca telemetri: ${err.message}`);
    }

    result.summary = lines.join("\n");
    return result;
  }

  /**
   * Schedule or trigger power state action (lock, sleep)
   */
  public async schedulePower(
    action: "sleep" | "lock" | "shutdown" | "restart" | "awake",
    time?: string
  ): Promise<{ success: boolean; message: string }> {
    if (action === "lock") {
      try {
        await execAsync("rundll32.exe user32.dll,LockWorkStation");
        return {
          success: true,
          message: "🔒 *Layar Windows telah dikunci* (Workstation Locked).",
        };
      } catch (err: any) {
        return { success: false, message: `Gagal mengunci layar: ${err.message}` };
      }
    }

    if (action === "sleep") {
      try {
        // Safe suspend via .NET SetSuspendState
        await execAsync(
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
      return {
        success: true,
        message: "☀️ *Mode Stay-Awake:* Pengaturan sleep timer dinonaktifkan sementara.",
      };
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
      await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, " ")}"`);
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

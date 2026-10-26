import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WindowsActionAdapter, CommandExecutor } from "../../src/adapters/os/windows/windows-action.adapter.js";
import { ResultDeliveryService } from "../../src/application/delivery/result-delivery.service.js";
import { OutputChannelAdapter, OutgoingDeliveryRequest, DeliveryResult } from "../../src/ports/output-channel.port.js";

describe("Phase 10: Windows OS Automation Provider & Media Delivery", () => {
  let mockExec: ReturnType<typeof vi.fn>;
  let adapter: WindowsActionAdapter;

  beforeEach(() => {
    mockExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    adapter = new WindowsActionAdapter(mockExec as unknown as CommandExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Application Controller (launchApp & terminateApp)", () => {
    it("should reject launching applications that are not in the whitelist", async () => {
      const result = await adapter.launchApp("malware.exe");
      expect(result.success).toBe(false);
      expect(result.message).toContain("tidak terdaftar dalam whitelist keamanan");
    });

    it("should launch whitelisted application successfully", async () => {
      const result = await adapter.launchApp("notepad");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Berhasil membuka aplikasi *notepad*");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('Start-Process "notepad.exe"'));
    });

    it("should reject terminating applications that are not in the process whitelist", async () => {
      const result = await adapter.terminateApp("system_critical_service");
      expect(result.success).toBe(false);
      expect(result.message).toContain("tidak terdaftar dalam whitelist");
    });

    it("should allow terminating whitelisted application when process is running", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "2\n", stderr: "" });

      const result = await adapter.terminateApp("notepad");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Berhasil menghentikan 2 proses untuk aplikasi *notepad*");
    });

    it("should handle terminating whitelisted application when process is not running", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "0\n", stderr: "" });

      const result = await adapter.terminateApp("spotify");
      expect(result.success).toBe(true);
      expect(result.message).toContain("tidak sedang berjalan saat ini");
    });
  });

  describe("Hardware Health & System Metrics (getSystemStatus)", () => {
    it("should query disk space and parse correctly", async () => {
      const fakeDisks = [
        { DeviceID: "C:", Size: 500 * 1024 * 1024 * 1024, FreeSpace: 200 * 1024 * 1024 * 1024 },
        { DeviceID: "D:", Size: 1000 * 1024 * 1024 * 1024, FreeSpace: 800 * 1024 * 1024 * 1024 },
      ];
      mockExec.mockResolvedValueOnce({ stdout: JSON.stringify(fakeDisks), stderr: "" });

      const status = await adapter.getSystemStatus("disk");
      expect(status.disk).toBeDefined();
      expect(status.disk?.length).toBe(2);
      expect(status.disk?.[0].drive).toBe("C:");
      expect(status.disk?.[0].totalGb).toBe(500);
      expect(status.disk?.[0].freeGb).toBe(200);
      expect(status.disk?.[0].usedGb).toBe(300);
      expect(status.disk?.[0].percentUsed).toBe(60);
      expect(status.summary).toContain("Disk (C:)");
      expect(status.summary).toContain("Disk (D:)");
    });

    it("should query full system status ('all') including battery, RAM, CPU, and Disk", async () => {
      mockExec
        // Battery
        .mockResolvedValueOnce({ stdout: JSON.stringify({ EstimatedChargeRemaining: 88, BatteryStatus: 2 }), stderr: "" })
        // RAM (16 GB total, 8 GB free)
        .mockResolvedValueOnce({ stdout: JSON.stringify({ TotalVisibleMemorySize: 16777216, FreePhysicalMemory: 8388608 }), stderr: "" })
        // CPU
        .mockResolvedValueOnce({ stdout: "25\n", stderr: "" })
        // Disk
        .mockResolvedValueOnce({ stdout: JSON.stringify({ DeviceID: "C:", Size: 500 * 1024 * 1024 * 1024, FreeSpace: 250 * 1024 * 1024 * 1024 }), stderr: "" });

      const status = await adapter.getSystemStatus("all");
      expect(status.battery?.percentage).toBe(88);
      expect(status.battery?.isCharging).toBe(true);
      expect(status.ram?.totalGb).toBe(16);
      expect(status.ram?.usedGb).toBe(8);
      expect(status.cpu?.loadPercentage).toBe(25);
      expect(status.disk?.[0].percentUsed).toBe(50);
      expect(status.summary).toContain("88%");
      expect(status.summary).toContain("RAM");
      expect(status.summary).toContain("*CPU Load:* 25%");
      expect(status.summary).toContain("Disk (C:)");
    });
  });

    it("should sanitize arguments in launchApp to prevent PowerShell injection", async () => {
      await adapter.launchApp("edge", "https://example.com;$malicious;`calc`");
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('Start-Process "msedge.exe" -ArgumentList "https://example.commaliciouscalc"')
      );
    });

  describe("Power & Sleep Scheduler (schedulePower)", () => {
    it("should schedule sleep task when future time is provided with auto-padding", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "SUCCESS", stderr: "" });

      const result = await adapter.schedulePower("sleep", "8:30");
      expect(result.success).toBe(true);
      expect(result.message).toContain("08:30 WIB");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('schtasks /create /tn "WemoteIt_ScheduledSleep"'));
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("/st 08:30"));
    });

    it("should cancel active scheduled sleep task", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "SUCCESS", stderr: "" });

      const result = await adapter.schedulePower("cancel_sleep");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Jadwal Sleep Dibatalkan");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('schtasks /delete /tn "WemoteIt_ScheduledSleep" /f'));
    });

    it("should execute instant sleep when no time is provided", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const result = await adapter.schedulePower("sleep");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Sleep (Suspend)");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("SetSuspendState"));
    });

    it("should activate stay-awake anti-sleep mode", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const result = await adapter.schedulePower("awake");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Stay-Awake");
    });

    it("should lock Windows workstation immediately", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const result = await adapter.schedulePower("lock");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Layar Windows telah dikunci");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("LockWorkStation"));
    });
  });

  describe("Desktop Screen Capture (captureScreen)", () => {
    it("should execute desktop screenshot capture and return path", async () => {
      mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const res = await adapter.captureScreen();
      expect(res.success).toBe(true);
      expect(res.filePath).toBeDefined();
      expect(res.filePath).toContain(".png");
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("System.Drawing.Bitmap"));
    });
  });

  describe("Media Delivery Service (ResultDeliveryService with attachments)", () => {
    it("should deliver acknowledgement with attached media files", async () => {
      let sentRequest: OutgoingDeliveryRequest | null = null;
      const mockOutputAdapter: OutputChannelAdapter = {
        provider: "whatsapp",
        sendReply: async (req: OutgoingDeliveryRequest): Promise<DeliveryResult> => {
          sentRequest = req;
          return { success: true, deliveredAt: new Date().toISOString() };
        },
      };

      const deliveryService = new ResultDeliveryService(mockOutputAdapter);
      const attachments = [
        { name: "screenshot-test.png", path: "C:/data/screenshot-test.png", mimeType: "image/png" },
      ];

      await deliveryService.deliverAcknowledgement(
        "conv-1",
        "ws-1",
        "conn-1",
        "corr-1",
        "Screenshot ready",
        attachments
      );

      expect(sentRequest).not.toBeNull();
      expect(sentRequest!.attachments).toBeDefined();
      expect(sentRequest!.attachments!.length).toBe(1);
      expect(sentRequest!.attachments![0].name).toBe("screenshot-test.png");
      expect(sentRequest!.attachments![0].path).toBe("C:/data/screenshot-test.png");
    });
  });
});

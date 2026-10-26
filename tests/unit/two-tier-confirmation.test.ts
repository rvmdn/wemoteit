import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ConfirmationManager } from "../../src/application/confirmation/confirmation-manager.js";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { WindowsActionAdapter } from "../../src/adapters/os/windows/windows-action.adapter.js";
import { CommandRouter } from "../../src/application/routing/command-router.js";
import { CommandAuthorizer } from "../../src/application/authorization/command-authorizer.js";
import { JobManager } from "../../src/application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../../src/application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../../src/application/delivery/result-delivery.service.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { MockExecutionProvider } from "../../src/adapters/agents/mock/mock-execution.provider.js";
import { NormalizedIncomingMessage } from "../../src/domain/message/message.entity.js";

describe("Phase 11: Two-Tier Confirmation & Security Hardening", () => {
  describe("ConfirmationManager Unit Tests", () => {
    let manager: ConfirmationManager;

    beforeEach(() => {
      manager = new ConfirmationManager(2 * 60 * 1000); // 2 minutes TTL
    });

    it("recognizes various Indonesian and English affirmative keywords", () => {
      expect(manager.isAffirmative("YA")).toBe(true);
      expect(manager.isAffirmative("ya")).toBe(true);
      expect(manager.isAffirmative("YES")).toBe(true);
      expect(manager.isAffirmative("y")).toBe(true);
      expect(manager.isAffirmative("oke")).toBe(true);
      expect(manager.isAffirmative("ok!")).toBe(true);
      expect(manager.isAffirmative("lanjut")).toBe(true);
      expect(manager.isAffirmative("setuju.")).toBe(true);
      expect(manager.isAffirmative("siap")).toBe(true);
      expect(manager.isAffirmative("ya silakan")).toBe(true);
      expect(manager.isAffirmative("ya lanjut")).toBe(true);
      expect(manager.isAffirmative("oke lanjut")).toBe(true);
      expect(manager.isAffirmative("random text")).toBe(false);
    });

    it("recognizes various cancellation keywords", () => {
      expect(manager.isNegative("BATAL")).toBe(true);
      expect(manager.isNegative("batal!")).toBe(true);
      expect(manager.isNegative("cancel")).toBe(true);
      expect(manager.isNegative("tidak")).toBe(true);
      expect(manager.isNegative("no")).toBe(true);
      expect(manager.isNegative("n")).toBe(true);
      expect(manager.isNegative("jangan")).toBe(true);
      expect(manager.isNegative("gak")).toBe(true);
      expect(manager.isNegative("gak jadi")).toBe(true);
      expect(manager.isNegative("ga jadi")).toBe(true);
      expect(manager.isNegative("batal aja")).toBe(true);
      expect(manager.isNegative("oke")).toBe(false);
    });

    it("stores and expires pending confirmations correctly", () => {
      manager.setPending("conv-1", "user-1", "sleep", "Sleep mode", { time: "23:00" }, 50); // 50ms TTL
      expect(manager.getPending("conv-1", "user-1")).not.toBeNull();
      expect(manager.getPending("conv-1", "user-1")?.actionType).toBe("sleep");

      // Clear pending
      manager.clearPending("conv-1", "user-1");
      expect(manager.getPending("conv-1", "user-1")).toBeNull();
    });

    it("returns null when TTL has expired", async () => {
      manager.setPending("conv-2", "user-2", "terminate_app", "Terminate edge", { appName: "edge" }, 10); // 10ms
      await new Promise((r) => setTimeout(r, 20));
      expect(manager.getPending("conv-2", "user-2")).toBeNull();
    });
  });

  describe("CommandRouter Two-Tier Policy & Conversational Confirmation", () => {
    let db: SqliteDatabase;
    let persistence: SqlitePersistenceRepository;
    let windowsAdapter: WindowsActionAdapter;
    let commandRouter: CommandRouter;
    let authorizer: CommandAuthorizer;
    let jobManager: JobManager;
    let coordinator: ExecutionCoordinator;
    let deliveryService: ResultDeliveryService;
    let configService: ConfigService;
    let confirmationManager: ConfirmationManager;
    let deliveredMessages: string[];

    const baseMsg: NormalizedIncomingMessage = {
      id: "msg-confirm-test-1",
      schemaVersion: 1,
      workspaceId: "ws-default",
      channelConnectionId: "conn-wa-1",
      sourceType: "whatsapp",
      providerMessageId: "prov-confirm-test-1",
      conversationId: "self",
      senderId: "self",
      senderType: "user",
      messageType: "text",
      correlationId: "corr-confirm-test-1",
      text: "",
      attachments: [],
      receivedAt: new Date().toISOString(),
    };

    beforeEach(async () => {
      deliveredMessages = [];
      db = new SqliteDatabase(":memory:");
      db.migrate();
      persistence = new SqlitePersistenceRepository(db);

      configService = new ConfigService();
      authorizer = new CommandAuthorizer(configService);
      const mockProvider = new MockExecutionProvider();
      mockProvider.simulatedDurationMs = 5;
      const providerRegistry = new Map();
      providerRegistry.set("mock", mockProvider);
      providerRegistry.set("antigravity", mockProvider);

      jobManager = new JobManager(persistence);
      coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);
      confirmationManager = new ConfirmationManager(2 * 60 * 1000);

      const mockOutputAdapter = {
        provider: "whatsapp",
        sendReply: async (req: any) => {
          deliveredMessages.push(req.text);
          return { success: true, deliveredAt: new Date().toISOString() };
        },
      };

      deliveryService = new ResultDeliveryService(mockOutputAdapter, persistence);
      windowsAdapter = new WindowsActionAdapter();

      commandRouter = new CommandRouter(
        persistence,
        authorizer,
        jobManager,
        coordinator,
        deliveryService,
        configService,
        undefined, // no intent router needed for direct tests
        windowsAdapter,
        confirmationManager
      );

      // Register authorized repository for run_task tests
      await persistence.saveRepositoryProfile({
        id: "wedocit",
        schemaVersion: 1,
        workspaceId: "ws-primary",
        name: "wedocit",
        description: "Test Document Editor",
        path: "F:/Project/Desktop/wedocit",
        allowedOperations: ["read", "review", "modify"],
        allowedBranches: ["main"],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    afterEach(async () => {
      db.close();
      vi.restoreAllMocks();
    });

    it("Tier 2 Mutating Command (/run): asks for quick confirmation and executes upon 'YA'", async () => {
      // Step 1: User requests mutating task
      const runMsg = { ...baseMsg, text: "/run wedocit add error handling" };
      await commandRouter.processIncomingMessage(runMsg);

      expect(deliveredMessages.length).toBe(1);
      expect(deliveredMessages[0]).toContain("Konfirmasi Tugas Coding (Tier 2)");
      expect(deliveredMessages[0]).toContain("Balas *YA* dalam 2 menit");

      // Verify pending confirmation was registered
      const pending = confirmationManager.getPending("self", "self");
      expect(pending).not.toBeNull();
      expect(pending?.actionType).toBe("run_task");

      // Step 2: User confirms with quick reply "YA"
      const confirmMsg = {
        ...baseMsg,
        id: "msg-confirm-ya",
        providerMessageId: "prov-confirm-ya",
        text: "YA",
      };
      await commandRouter.processIncomingMessage(confirmMsg);

      expect(deliveredMessages.length).toBe(3);
      expect(deliveredMessages[1]).toContain("Konfirmasi Diterima!");
      expect(deliveredMessages[1]).toContain("telah dimasukkan ke dalam antrean eksekusi");
      expect(deliveredMessages[2]).toContain("SUCCESS");

      // Verify job was created and executed in SQLite
      const jobs = await persistence.listJobs();
      expect(jobs.length).toBe(1);
      expect(jobs[0].repositoryId).toBe("wedocit");
      expect(jobs[0].status).toBe("completed");

      // Pending confirmation should be cleared
      expect(confirmationManager.getPending("self", "self")).toBeNull();
    });

    it("Tier 2 Mutating Command (/run): cancels task upon 'BATAL'", async () => {
      const runMsg = { ...baseMsg, text: "/run wedocit delete temp files" };
      await commandRouter.processIncomingMessage(runMsg);

      expect(deliveredMessages.length).toBe(1);
      expect(deliveredMessages[0]).toContain("Konfirmasi Tugas Coding (Tier 2)");

      // User cancels with "BATAL"
      const cancelMsg = {
        ...baseMsg,
        id: "msg-confirm-batal",
        providerMessageId: "prov-confirm-batal",
        text: "BATAL",
      };
      await commandRouter.processIncomingMessage(cancelMsg);

      expect(deliveredMessages.length).toBe(2);
      expect(deliveredMessages[1]).toContain("Tindakan Dibatalkan:");
      expect(confirmationManager.getPending("self", "self")).toBeNull();

      // Ensure no job was created
      const jobs = await persistence.listJobs();
      expect(jobs.length).toBe(0);
    });

    it("handles Tier 2 Windows Action (sleep) with 'YA' confirmation", async () => {
      // Register pending sleep
      confirmationManager.setPending("self", "self", "sleep", "Sleep mode", { time: "23:00" });

      const sleepSpy = vi.spyOn(windowsAdapter, "schedulePower").mockResolvedValue({
        success: true,
        message: "⏰ Komputer dijadwalkan masuk mode Sleep pada pukul 23:00 WIB.",
      });

      const confirmMsg = { ...baseMsg, text: "ya" };
      await commandRouter.processIncomingMessage(confirmMsg);

      expect(sleepSpy).toHaveBeenCalledWith("sleep", "23:00");
      expect(deliveredMessages.some((m) => m.includes("Konfirmasi Diterima!"))).toBe(true);
      expect(confirmationManager.getPending("self", "self")).toBeNull();
    });

    it("handles Tier 2 Windows Action (terminate_app) with 'BATAL' cancellation", async () => {
      confirmationManager.setPending("self", "self", "terminate_app", "Menutup aplikasi teams", { appName: "teams" });

      const terminateSpy = vi.spyOn(windowsAdapter, "terminateApp");

      const cancelMsg = { ...baseMsg, text: "batal" };
      await commandRouter.processIncomingMessage(cancelMsg);

      expect(terminateSpy).not.toHaveBeenCalled();
      expect(deliveredMessages.some((m) => m.includes("Tindakan Dibatalkan"))).toBe(true);
      expect(confirmationManager.getPending("self", "self")).toBeNull();
    });

    it("gracefully informs user when 'YA' is sent without any pending action", async () => {
      const msg = { ...baseMsg, text: "YA" };
      await commandRouter.processIncomingMessage(msg);

      expect(deliveredMessages.length).toBe(1);
      expect(deliveredMessages[0]).toContain("Tidak ada tindakan tertunda yang membutuhkan konfirmasi");
    });

    it("gracefully informs user when 'BATAL' is sent without any pending action", async () => {
      const msg = { ...baseMsg, text: "BATAL" };
      await commandRouter.processIncomingMessage(msg);

      expect(deliveredMessages.length).toBe(1);
      expect(deliveredMessages[0]).toContain("Tidak ada tindakan tertunda");
    });

    it("still supports backward-compatible /approve token command", async () => {
      const runMsg = { ...baseMsg, text: "/run wedocit update documentation" };
      await commandRouter.processIncomingMessage(runMsg);

      // Extract generated token from persistence
      const pendingApprovals = await persistence.listPendingApprovals("ws-default");
      expect(pendingApprovals.length).toBe(1);
      const token = pendingApprovals[0].token;

      // Approve via slash command
      const approveMsg = {
        ...baseMsg,
        id: "msg-approve-token",
        providerMessageId: "prov-approve-token",
        text: `/approve ${token}`,
      };
      await commandRouter.processIncomingMessage(approveMsg);

      expect(deliveredMessages.some((m) => m.includes("Approval Granted for"))).toBe(true);
      const jobs = await persistence.listJobs();
      expect(jobs.length).toBe(1);
      expect(jobs[0].status).toBe("completed");
    });
  });
});

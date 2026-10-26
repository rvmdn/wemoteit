#!/usr/bin/env node
import { Command as Commander } from "commander";
import { ConfigService } from "../../adapters/configuration/config.service.js";
import { SqliteDatabase } from "../../adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../adapters/persistence/sqlite/sqlite.repository.js";
import { MockChannelAdapter } from "../../adapters/channels/mock/mock-channel.adapter.js";
import { MockExecutionProvider } from "../../adapters/agents/mock/mock-execution.provider.js";
import { CommandAuthorizer } from "../../application/authorization/command-authorizer.js";
import { JobManager } from "../../application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../../application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../../application/delivery/result-delivery.service.js";
import { CommandRouter } from "../../application/routing/command-router.js";
import { MessageNormalizer } from "../../application/normalization/message-normalizer.js";
import { logger } from "../../adapters/logging/logger.js";

const program = new Commander();

program
  .name("wemoteit")
  .description("WhatsApp AI Agent Orchestrator CLI")
  .version("1.0.0");

program
  .command("status")
  .description("Check orchestrator health, database state, and job counts")
  .action(async () => {
    try {
      const configService = new ConfigService();
      const config = configService.getConfig();
      const dbHelper = new SqliteDatabase(config.policies.databasePath);
      dbHelper.migrate();
      const repo = new SqlitePersistenceRepository(dbHelper);

      const runningJobs = await repo.listJobsByStatus("running");
      const queuedJobs = await repo.listJobsByStatus("queued");
      const completedJobs = await repo.listJobsByStatus("completed");
      const failedJobs = await repo.listJobsByStatus("failed");

      console.log("\n=======================================================");
      console.log("            WEMOTEIT SYSTEM STATUS                     ");
      console.log("=======================================================");
      console.log(`Workspace ID   : ${config.workspace.id} (${config.workspace.name})`);
      console.log(`Database File  : ${config.policies.databasePath}`);
      console.log(`Active Jobs    : ${runningJobs.length}`);
      console.log(`Queued Jobs    : ${queuedJobs.length}`);
      console.log(`Completed Jobs : ${completedJobs.length}`);
      console.log(`Failed Jobs    : ${failedJobs.length}`);
      console.log(`Repositories   : ${config.repositories.length} registered`);
      for (const r of config.repositories) {
        console.log(`  - [${r.id}] ${r.name} -> ${r.path} (enabled: ${r.enabled})`);
      }
      console.log("=======================================================\n");

      dbHelper.close();
    } catch (err: any) {
      console.error("Error checking status:", err.message);
      process.exit(1);
    }
  });

program
  .command("inspect-jobs")
  .description("List recent jobs with their statuses and correlation IDs")
  .option("-l, --limit <number>", "Number of jobs to list", "10")
  .action(async (options) => {
    try {
      const configService = new ConfigService();
      const config = configService.getConfig();
      const dbHelper = new SqliteDatabase(config.policies.databasePath);
      dbHelper.migrate();
      const repo = new SqlitePersistenceRepository(dbHelper);

      const limit = parseInt(options.limit, 10);
      const jobs = await repo.listJobs(limit);

      console.log("\n=======================================================");
      console.log(`            RECENT JOBS (Limit: ${limit})              `);
      console.log("=======================================================");
      if (jobs.length === 0) {
        console.log("No jobs found in database.");
      } else {
        for (const j of jobs) {
          console.log(`Job ID         : ${j.id}`);
          console.log(`Status         : ${j.status.toUpperCase()}`);
          console.log(`Correlation ID : ${j.correlationId}`);
          console.log(`Repository     : ${j.repositoryId || "workspace"}`);
          console.log(`Created At     : ${j.createdAt}`);
          if (j.errorSummary) {
            console.log(`Error Summary  : ${j.errorSummary}`);
          }
          console.log("-------------------------------------------------------");
        }
      }
      console.log("");
      dbHelper.close();
    } catch (err: any) {
      console.error("Error inspecting jobs:", err.message);
      process.exit(1);
    }
  });

program
  .command("test-pipeline")
  .description("Execute an end-to-end hermetic test using the mock channel and provider")
  .option("-p, --prompt <string>", "Test prompt", "review code for security issues")
  .action(async (options) => {
    try {
      console.log("\n[1/5] Initializing Test Orchestration Pipeline...");
      const configService = new ConfigService();
      const dbHelper = new SqliteDatabase(":memory:");
      dbHelper.migrate();
      const persistence = new SqlitePersistenceRepository(dbHelper);

      // Register initial workspace
      await persistence.saveWorkspace({
        id: "ws-primary",
        schemaVersion: 1,
        name: "Test Workspace",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Register test repo
      await persistence.saveRepositoryProfile({
        id: "wedocit",
        schemaVersion: 1,
        workspaceId: "ws-primary",
        name: "wedocit",
        description: "Test Document Editor",
        path: "F:/Project/Desktop/wedocit",
        allowedOperations: ["read", "review"],
        allowedBranches: ["main"],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mockChannel = new MockChannelAdapter();
      await mockChannel.start();

      const mockProvider = new MockExecutionProvider();
      const providerRegistry = new Map();
      providerRegistry.set("mock", mockProvider);

      const jobManager = new JobManager(persistence);
      const authorizer = new CommandAuthorizer(configService);
      const coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);
      const delivery = new ResultDeliveryService(mockChannel);
      const router = new CommandRouter(
        persistence,
        authorizer,
        jobManager,
        coordinator,
        delivery,
        configService
      );

      mockChannel.onMessage(async (msg) => {
        await router.processIncomingMessage(msg);
      });

      console.log("[2/5] Normalizing Test WhatsApp Message...");
      const incoming = MessageNormalizer.normalize({
        workspaceId: "ws-primary",
        channelConnectionId: "conn-mock-1",
        sourceType: "mock",
        providerMessageId: `msg-${Date.now()}`,
        conversationId: "chat_123",
        senderId: "user_123",
        text: `/review wedocit ${options.prompt}`,
      });

      console.log(`[3/5] Simulating Ingestion (Correlation: ${incoming.correlationId})...`);
      await mockChannel.simulateIncomingMessage(incoming);

      console.log("[4/5] Pipeline Processed Successfully!");
      console.log(`[5/5] Delivered WhatsApp Replies (${mockChannel.sentReplies.length} messages):`);
      for (const reply of mockChannel.sentReplies) {
        console.log("\n--- [DELIVERED CHAT MESSAGE] ---");
        console.log(reply.text);
      }

      console.log("\n✅ End-to-End Test Pipeline Succeeded Hermetically!\n");
      dbHelper.close();
    } catch (err: any) {
      console.error("Test pipeline failed:", err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

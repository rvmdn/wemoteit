import { ConfigService } from "../../adapters/configuration/config.service.js";
import { SqliteDatabase } from "../../adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../adapters/persistence/sqlite/sqlite.repository.js";
import { MockExecutionProvider } from "../../adapters/agents/mock/mock-execution.provider.js";
import { AntigravityExecutionProvider } from "../../adapters/agents/antigravity/antigravity-execution.provider.js";
import { WhatsAppWebAdapter } from "../../adapters/channels/whatsapp/whatsapp-web.adapter.js";
import { CommandAuthorizer } from "../../application/authorization/command-authorizer.js";
import { JobManager } from "../../application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../../application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../../application/delivery/result-delivery.service.js";
import { CommandRouter } from "../../application/routing/command-router.js";
import { LifecycleManager } from "../../app/lifecycle.js";
import { DashboardWebServer } from "./server.js";
import { logger } from "../../adapters/logging/logger.js";

export async function startDashboard(port = 3100) {
  const lifecycle = new LifecycleManager();
  lifecycle.setupSignalHandlers();

  logger.info("Initializing wemoteit Web Dashboard");

  const configService = new ConfigService();
  const config = configService.getConfig();

  // 1. Persistence
  const dbHelper = new SqliteDatabase(config.policies.databasePath);
  dbHelper.migrate();
  const persistence = new SqlitePersistenceRepository(dbHelper);
  lifecycle.register({ name: "SqliteDatabase", close: () => dbHelper.close() });

  // 2. Seed workspace & repositories
  await persistence.saveWorkspace({
    id: config.workspace.id,
    schemaVersion: 1,
    name: config.workspace.name,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  for (const repo of config.repositories) {
    await persistence.saveRepositoryProfile({
      id: repo.id,
      schemaVersion: 1,
      workspaceId: config.workspace.id,
      name: repo.name,
      description: repo.description,
      path: repo.path,
      allowedOperations: repo.allowedOperations as any,
      allowedBranches: repo.allowedBranches,
      enabled: repo.enabled,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // 3. Stalled jobs recovery
  const jobManager = new JobManager(persistence);
  await jobManager.recoverStalledJobs();

  // 4. Execution Providers
  const mockProvider = new MockExecutionProvider();
  const antigravityProvider = new AntigravityExecutionProvider(config.agents.antigravity);

  const providerRegistry = new Map();
  providerRegistry.set("mock", mockProvider);
  providerRegistry.set("antigravity", antigravityProvider);

  // 5. WhatsApp Web Adapter
  const waConfig = config.channels.whatsapp;
  const whatsappAdapter = new WhatsAppWebAdapter({
    workspaceId: config.workspace.id,
    channelConnectionId: "conn-wa-1",
    authorizedSenderId: waConfig.authorizedSenderId,
    authorizedConversationId: waConfig.authorizedConversationId,
    sessionDataDir: waConfig.sessionDataDir,
    headless: waConfig.headless,
    browserChannel: "msedge",
  });
  lifecycle.register({ name: "WhatsAppWebAdapter", close: () => whatsappAdapter.stop() });

  // 6. Application Routing & Pipeline
  const authorizer = new CommandAuthorizer(configService);
  const coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);
  const delivery = new ResultDeliveryService(whatsappAdapter, persistence);

  const router = new CommandRouter(
    persistence,
    authorizer,
    jobManager,
    coordinator,
    delivery,
    configService
  );

  whatsappAdapter.onMessage(async (msg) => {
    await router.processIncomingMessage(msg);
  });

  // 7. Dashboard Web Server
  const dashboardServer = new DashboardWebServer({
    port,
    configService,
    persistence,
    whatsappAdapter,
    jobManager,
    commandRouter: router,
  });

  lifecycle.register({ name: "DashboardWebServer", close: () => dashboardServer.stop() });

  const { port: runningPort } = await dashboardServer.start();

  console.log("\n=======================================================");
  console.log("       WEMOTEIT WEB DASHBOARD & ACCOUNT GATE           ");
  console.log("=======================================================");
  console.log(` Dashboard URL : http://localhost:${runningPort}`);
  console.log(` Status        : Listening on port ${runningPort}`);
  console.log(` Database      : ${config.policies.databasePath}`);
  console.log(` Locked Sender : ${config.channels.whatsapp.authorizedSenderId}`);
  console.log(" Press Ctrl+C to terminate cleanly.");
  console.log("=======================================================\n");

  return { dashboardServer, whatsappAdapter, router, lifecycle };
}

if (process.argv[1] && (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))) {
  const port = parseInt(process.env.PORT || "3100", 10);
  startDashboard(port).catch((err) => {
    logger.error({ error: err.message }, "Fatal dashboard startup error");
    process.exit(1);
  });
}

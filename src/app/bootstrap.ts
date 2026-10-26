import { ConfigService } from "../adapters/configuration/config.service.js";
import { SqliteDatabase } from "../adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../adapters/persistence/sqlite/sqlite.repository.js";
import { MockExecutionProvider } from "../adapters/agents/mock/mock-execution.provider.js";
import { AntigravityExecutionProvider } from "../adapters/agents/antigravity/antigravity-execution.provider.js";
import { GeminiAccountPoolManager } from "../adapters/agents/gemini/gemini-account-pool.js";
import { GeminiExecutionProvider } from "../adapters/agents/gemini/gemini-execution.provider.js";
import { WhatsAppWebAdapter } from "../adapters/channels/whatsapp/whatsapp-web.adapter.js";
import { CommandAuthorizer } from "../application/authorization/command-authorizer.js";
import { JobManager } from "../application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../application/delivery/result-delivery.service.js";
import { CommandRouter } from "../application/routing/command-router.js";
import { GeminiIntentRouter } from "../adapters/agents/gemini/gemini-intent-router.js";
import { LifecycleManager } from "./lifecycle.js";
import { logger } from "../adapters/logging/logger.js";

export async function bootstrap() {
  const lifecycle = new LifecycleManager();
  lifecycle.setupSignalHandlers();

  logger.info("Initializing wemoteit orchestrator bootstrap sequence");

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

  // 3. Crash recovery
  const jobManager = new JobManager(persistence);
  const recovered = await jobManager.recoverStalledJobs();
  if (recovered > 0) {
    logger.warn({ recoveredCount: recovered }, "Recovered stalled running jobs from previous process run");
  }

  // 4. Execution Providers
  const mockProvider = new MockExecutionProvider();
  const antigravityProvider = new AntigravityExecutionProvider(config.agents.antigravity);
  const geminiPoolManager = new GeminiAccountPoolManager(persistence);
  const geminiProvider = new GeminiExecutionProvider(geminiPoolManager);

  const providerRegistry = new Map();
  providerRegistry.set("mock", mockProvider);
  providerRegistry.set("antigravity", antigravityProvider);
  providerRegistry.set("gemini", geminiProvider);

  // 5. Channel Adapter
  const waConfig = config.channels.whatsapp;
  const channelAdapter = new WhatsAppWebAdapter({
    workspaceId: config.workspace.id,
    channelConnectionId: "conn-wa-1",
    authorizedSenderId: waConfig.authorizedSenderId,
    authorizedConversationId: waConfig.authorizedConversationId,
    sessionDataDir: waConfig.sessionDataDir,
    headless: waConfig.headless,
    browserChannel: "msedge",
  });
  lifecycle.register({ name: "WhatsAppWebAdapter", close: () => channelAdapter.stop() });

  // 6. Application Routing & Pipeline
  const authorizer = new CommandAuthorizer(configService);
  const coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);
  const delivery = new ResultDeliveryService(channelAdapter, persistence);
  const intentRouter = new GeminiIntentRouter(geminiPoolManager);

  const router = new CommandRouter(
    persistence,
    authorizer,
    jobManager,
    coordinator,
    delivery,
    configService,
    intentRouter
  );

  channelAdapter.onMessage(async (msg) => {
    await router.processIncomingMessage(msg);
  });

  await channelAdapter.initialize();
  await channelAdapter.start();

  logger.info("wemoteit WhatsApp Orchestrator successfully bootstrapped and listening");
  return { lifecycle, router, persistence };
}

if (process.argv[1] && process.argv[1].endsWith("bootstrap.ts")) {
  bootstrap().catch((err) => {
    logger.error({ error: err.message }, "Fatal bootstrap error");
    process.exit(1);
  });
}

import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { ValidationError } from "../../shared/errors/app-error.js";

const WhatsappChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.literal("whatsapp").default("whatsapp"),
  authorizedSenderId: z.string().default("self"),
  authorizedConversationId: z.string().default("self"),
  headless: z.boolean().default(true),
  sessionDataDir: z.string().default("./data/whatsapp_session"),
});

const MockChannelConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.literal("mock").default("mock"),
  authorizedSenderId: z.string().default("user_123"),
  authorizedConversationId: z.string().default("chat_123"),
});

const AntigravityAgentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  executionMode: z.enum(["cli", "sdk", "ui_automation", "mock"]).default("mock"),
  cliPath: z.string().optional(),
  maxTimeoutMs: z.number().int().default(120000),
});

const MockAgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  executionMode: z.literal("mock").default("mock"),
  maxTimeoutMs: z.number().int().default(30000),
});

export const AppConfigSchema = z.object({
  version: z.number().int().default(1),
  workspace: z
    .object({
      id: z.string().default("ws-default"),
      name: z.string().default("Default Workspace"),
    })
    .default({ id: "ws-default", name: "Default Workspace" }),
  channels: z
    .object({
      whatsapp: WhatsappChannelConfigSchema.default({
        enabled: false,
        provider: "whatsapp",
        authorizedSenderId: "self",
        authorizedConversationId: "self",
        headless: true,
        sessionDataDir: "./data/whatsapp_session",
      }),
      mock: MockChannelConfigSchema.default({
        enabled: true,
        provider: "mock",
        authorizedSenderId: "user_123",
        authorizedConversationId: "chat_123",
      }),
    })
    .default({
      whatsapp: {
        enabled: false,
        provider: "whatsapp",
        authorizedSenderId: "self",
        authorizedConversationId: "self",
        headless: true,
        sessionDataDir: "./data/whatsapp_session",
      },
      mock: {
        enabled: true,
        provider: "mock",
        authorizedSenderId: "user_123",
        authorizedConversationId: "chat_123",
      },
    }),
  agents: z
    .object({
      antigravity: AntigravityAgentConfigSchema.default({
        enabled: false,
        executionMode: "mock",
        maxTimeoutMs: 120000,
      }),
      mock: MockAgentConfigSchema.default({
        enabled: true,
        executionMode: "mock",
        maxTimeoutMs: 30000,
      }),
    })
    .default({
      antigravity: {
        enabled: false,
        executionMode: "mock",
        maxTimeoutMs: 120000,
      },
      mock: {
        enabled: true,
        executionMode: "mock",
        maxTimeoutMs: 30000,
      },
    }),
  repositories: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().default(""),
        path: z.string().min(1),
        allowedOperations: z.array(z.string()).default(["read", "review"]),
        allowedBranches: z.array(z.string()).default(["main", "master"]),
        enabled: z.boolean().default(true),
      })
    )
    .default([]),
  policies: z
    .object({
      allowArbitraryShell: z.literal(false).default(false),
      autoApproveReadOnly: z.boolean().default(true),
      requireApprovalForModification: z.boolean().default(true),
      maxMessageLength: z.number().int().default(8000),
      maxExecutionTimeMs: z.number().int().default(300000),
      databasePath: z.string().default("./data/wemoteit.db"),
    })
    .default({
      allowArbitraryShell: false,
      autoApproveReadOnly: true,
      requireApprovalForModification: true,
      maxMessageLength: 8000,
      maxExecutionTimeMs: 300000,
      databasePath: "./data/wemoteit.db",
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export class ConfigService {
  private config: AppConfig;

  constructor(customConfig?: Partial<AppConfig>) {
    this.config = this.load(customConfig);
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public resolveRepository(repoId: string) {
    const repo = this.config.repositories.find((r) => r.id === repoId && r.enabled);
    if (!repo) return null;
    const resolvedPath = path.resolve(repo.path);
    return {
      ...repo,
      canonicalPath: resolvedPath,
    };
  }

  private load(override?: Partial<AppConfig>): AppConfig {
    const defaultConfig = AppConfigSchema.parse({});
    const configDir = path.resolve(process.cwd(), "config");
    let loadedYaml: Record<string, unknown> = {};

    if (fs.existsSync(configDir)) {
      const files = ["defaults.yaml", "workspace.yaml", "repositories.yaml", "channels.yaml", "agents.yaml", "policies.yaml"];
      for (const file of files) {
        const fullPath = path.join(configDir, file);
        if (fs.existsSync(fullPath)) {
          try {
            const raw = fs.readFileSync(fullPath, "utf-8");
            const parsed = yaml.parse(raw);
            if (parsed && typeof parsed === "object") {
              loadedYaml = this.deepMerge(loadedYaml, parsed);
            }
          } catch (err: any) {
            throw new ValidationError(`Failed to parse configuration file ${file}: ${err.message}`);
          }
        }
      }
    }

    const merged = this.deepMerge(defaultConfig, this.deepMerge(loadedYaml, override || {}));
    const parseResult = AppConfigSchema.safeParse(merged);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid application configuration: ${parseResult.error.message}`, {
        issues: parseResult.error.issues,
      });
    }

    return parseResult.data;
  }

  private deepMerge(target: any, source: any): any {
    if (!source) return target;
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && !Array.isArray(source[key]) && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }
}

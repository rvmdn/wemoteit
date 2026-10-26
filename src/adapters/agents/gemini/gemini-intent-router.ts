import { GeminiAccountPoolManager } from "./gemini-account-pool.js";
import { GeminiAccountInstance } from "../../../domain/agent/gemini-account.entity.js";
import { NormalizedIncomingMessage } from "../../../domain/message/message.entity.js";
import { logger } from "../../logging/logger.js";

export type ResolvedIntent =
  | {
      type: "slash_command";
      commandText: string;
      explanation?: string;
    }
  | {
      type: "launch_app";
      appName: string;
      args?: string;
      explanation?: string;
    }
  | {
      type: "get_system_status";
      metrics: "battery" | "ram" | "cpu" | "all";
      explanation?: string;
    }
  | {
      type: "schedule_power";
      action: "sleep" | "lock" | "shutdown" | "restart" | "awake";
      time?: string;
      explanation?: string;
    }
  | {
      type: "capture_screen";
      note?: string;
      explanation?: string;
    }
  | {
      type: "conversational_reply";
      replyText: string;
    };

export class GeminiIntentRouter {
  constructor(
    private readonly poolManager: GeminiAccountPoolManager,
    private readonly defaultModel: string = "gemini-1.5-pro"
  ) {}

  /**
   * Resolves a natural language user message into a structured intent using Gemini Function Calling.
   */
  public async resolveIntent(
    message: NormalizedIncomingMessage,
    recentHistory: NormalizedIncomingMessage[] = [],
    registeredRepos: string[] = []
  ): Promise<ResolvedIntent> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      let account: GeminiAccountInstance;

      try {
        account = await this.poolManager.acquireAccount();
      } catch (err: any) {
        logger.warn({ error: err.message }, "Cannot acquire account for intent routing; falling back to direct reply");
        return {
          type: "conversational_reply",
          replyText: `⚠️ Layanan AI sedang sibuk atau semua akun pool sedang cooldown (${err.message}). Ketik /help untuk melihat perintah langsung.`,
        };
      }

      try {
        const intent = await this.callGeminiFunctionCalling(
          account,
          message.text,
          recentHistory,
          registeredRepos
        );
        await this.poolManager.reportSuccess(account.id);
        return intent;
      } catch (err: any) {
        const isRateLimitOrOverload =
          err.status === 429 ||
          err.status === 503 ||
          err.message?.includes("RESOURCE_EXHAUSTED") ||
          err.message?.includes("429") ||
          err.message?.includes("503") ||
          err.message?.includes("overloaded");

        if (isRateLimitOrOverload) {
          logger.warn(
            { accountId: account.id, label: account.label, attempt },
            "Intent router hit 429/503. Rotating to next Gemini account..."
          );
          await this.poolManager.reportRateLimit(account.id, 60);
          continue;
        }

        logger.error({ error: err.message }, "Error during intent resolution");
        return {
          type: "conversational_reply",
          replyText: `Maaf, terjadi kendala saat memproses perintah Anda: ${err.message}`,
        };
      }
    }

    return {
      type: "conversational_reply",
      replyText: "Semua akun AI saat ini sedang mencapai limit kuota (429/503). Silakan coba lagi beberapa saat lagi atau gunakan perintah langsung dengan awalan /.",
    };
  }

  private async callGeminiFunctionCalling(
    account: GeminiAccountInstance,
    userText: string,
    history: NormalizedIncomingMessage[],
    registeredRepos: string[]
  ): Promise<ResolvedIntent> {
    const model = account.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${account.apiKey}`;

    const systemInstruction =
      "You are wemoteit Natural Language Intent Router, the personal remote OS assistant for a developer on Windows 11.\n" +
      `Registered repositories: [${registeredRepos.join(", ")}].\n` +
      "Analyze the user's Indonesian or English input and call the best-matching tool.\n" +
      "Rules:\n" +
      "1. If user asks to review, explain, or inspect a repo (e.g. 'review wedocit apa itu', 'jelaskan repo scanwitme', 'baca repo wedocit'), call 'execute_slash_command' with command: '/review <repo> <prompt>'.\n" +
      "2. If user asks to run a mutating task or build a feature (e.g. 'buatkan fitur x di wedocit', 'jalankan coding di dasborin'), call 'execute_slash_command' with command: '/run <repo> <prompt>'.\n" +
      "3. If user asks to list repos, check bot status, or check jobs (e.g. 'ada repo apa aja', 'cek status bot', 'lihat pekerjaan'), call 'execute_slash_command' with '/repos', '/status', or '/jobs'.\n" +
      "4. If user asks to open or start an application (e.g. 'nyalakan teams', 'buka browser', 'buka edge', 'buka notepad', 'buka visual studio code'), call 'launch_app'.\n" +
      "5. If user asks about battery, cpu, or ram (e.g. 'cek baterai laptop', 'sisa baterai berapa', 'cek ram'), call 'get_system_status'.\n" +
      "6. If user asks to sleep or lock Windows (e.g. 'tidurkan laptop', 'kunci layar', 'sleep sekarang'), call 'schedule_power'.\n" +
      "7. If user asks for screenshot (e.g. 'foto layar desktop', 'screenshot desktop'), call 'capture_screen'.\n" +
      "8. For greetings or general questions, reply politely and conversationally in Indonesian without calling tools.";

    const tools = [
      {
        functionDeclarations: [
          {
            name: "execute_slash_command",
            description: "Execute a wemoteit slash command for workspace or job orchestration.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: {
                  type: "STRING",
                  description: "The formatted command, e.g. '/review wedocit apa itu' or '/status'",
                },
                explanation: {
                  type: "STRING",
                  description: "Short Indonesian explanation of what is being executed",
                },
              },
              required: ["command"],
            },
          },
          {
            name: "launch_app",
            description: "Launch or open a desktop application on Windows (e.g. teams, edge, chrome, notepad, code, calc).",
            parameters: {
              type: "OBJECT",
              properties: {
                appName: {
                  type: "STRING",
                  description: "Application name: 'teams', 'edge', 'chrome', 'notepad', 'code', 'calc', 'terminal', 'spotify'",
                },
                args: {
                  type: "STRING",
                  description: "Optional URL or file argument",
                },
                explanation: {
                  type: "STRING",
                  description: "Short Indonesian explanation",
                },
              },
              required: ["appName"],
            },
          },
          {
            name: "get_system_status",
            description: "Query Windows hardware metrics like battery percentage, RAM, CPU usage, or uptime.",
            parameters: {
              type: "OBJECT",
              properties: {
                metrics: {
                  type: "STRING",
                  enum: ["battery", "ram", "cpu", "all"],
                  description: "Metric to inspect",
                },
                explanation: {
                  type: "STRING",
                  description: "Short Indonesian explanation",
                },
              },
              required: ["metrics"],
            },
          },
          {
            name: "schedule_power",
            description: "Control Windows power state such as sleep (suspend), lock screen, awake, or shutdown.",
            parameters: {
              type: "OBJECT",
              properties: {
                action: {
                  type: "STRING",
                  enum: ["sleep", "lock", "shutdown", "restart", "awake"],
                  description: "Power action to perform",
                },
                time: {
                  type: "STRING",
                  description: "Optional time schedule like '23:00' or 'in 15 minutes'",
                },
                explanation: {
                  type: "STRING",
                  description: "Short Indonesian explanation",
                },
              },
              required: ["action"],
            },
          },
          {
            name: "capture_screen",
            description: "Capture full desktop screenshot of current Windows desktop workspace.",
            parameters: {
              type: "OBJECT",
              properties: {
                note: {
                  type: "STRING",
                  description: "Optional reason for capture",
                },
              },
            },
          },
        ],
      },
    ];

    // Build conversation context
    const contents: any[] = [];
    const recent = history.slice(-3);
    for (const h of recent) {
      contents.push({
        role: "user",
        parts: [{ text: h.text }],
      });
      contents.push({
        role: "model",
        parts: [{ text: "Siap, dipahami." }],
      });
    }

    contents.push({
      role: "user",
      parts: [{ text: userText }],
    });

    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools,
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text();
      const err: any = new Error(`HTTP ${response.status}: ${errText}`);
      err.status = response.status;
      throw err;
    }

    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (part?.functionCall) {
      const call = part.functionCall;
      const fnName = call.name;
      const args = call.args || {};

      if (fnName === "execute_slash_command") {
        return {
          type: "slash_command",
          commandText: String(args.command || "").trim(),
          explanation: args.explanation,
        };
      }

      if (fnName === "launch_app") {
        return {
          type: "launch_app",
          appName: String(args.appName || "").toLowerCase().trim(),
          args: args.args,
          explanation: args.explanation,
        };
      }

      if (fnName === "get_system_status") {
        return {
          type: "get_system_status",
          metrics: (args.metrics as any) || "all",
          explanation: args.explanation,
        };
      }

      if (fnName === "schedule_power") {
        return {
          type: "schedule_power",
          action: (args.action as any) || "lock",
          time: args.time,
          explanation: args.explanation,
        };
      }

      if (fnName === "capture_screen") {
        return {
          type: "capture_screen",
          note: args.note,
        };
      }
    }

    const text = part?.text || "Perintah Anda telah saya terima.";
    return {
      type: "conversational_reply",
      replyText: text.trim(),
    };
  }
}
